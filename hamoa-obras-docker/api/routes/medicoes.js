/**
 * CONSTRUTIVO OBRAS — Rotas de Medições
 * GET    /api/medicoes[?empresa_id=&status=&periodo=]
 * GET    /api/medicoes/:id
 * POST   /api/medicoes
 * PUT    /api/medicoes/:id
 * POST   /api/medicoes/:id/aprovar
 * POST   /api/medicoes/:id/reprovar
 * POST   /api/medicoes/:id/enviar-assinatura
 * POST   /api/medicoes/:id/evidencias
 */
const router  = require('express').Router();
const path    = require('path');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const db    = require('../db');
const auth  = require('../middleware/auth');
const { perm, checkPerm } = require('../middleware/perm');
const audit = require('../middleware/audit');
const { notificarAprovacaoFornecedor, notificarAprovadoresStatusChange, notificarPendenciaAprovacao } = require('../helpers/email');
const { getObrasPermitidas, obraClause, temAcessoObra } = require('../middleware/obras');

// Upload de evidências — multer grava temp em /app/uploads, depois storage.js replica para S3/GDrive
const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads'),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
// Extensões e tipos MIME permitidos para evidências
const ALLOWED_EXT  = new Set(['.jpg','.jpeg','.png','.gif','.webp','.heic','.pdf','.mp4','.mov','.avi','.mkv','.webm','.doc','.docx','.xls','.xlsx','.odt','.ods','.txt','.zip']);
const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/heic',
  'application/pdf',
  'video/mp4','video/quicktime','video/x-msvideo','video/x-matroska','video/webm',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet',
  'text/plain','application/zip',
]);
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase().split(';')[0].trim();
    if (ALLOWED_EXT.has(ext) && ALLOWED_MIME.has(mime)) return cb(null, true);
    cb(new Error(`Tipo de arquivo não permitido: ${file.originalname} (${mime})`));
  },
});
const storageHelper = require('../helpers/storage');
const wa = require('../helpers/whatsapp');

// ══════════════════════════════════════════════════════════════
// HELPER: Sincroniza progresso LBM quando uma medição é aprovada
// ══════════════════════════════════════════════════════════════
// Lógica: calcula o % físico acumulado do contrato (soma de todas
// as medições aprovadas) e distribui pelos locais ordenados:
//   - primeiros floor(pct% × total_locais) locais → "concluido"
//   - próximo local (se pct < 100%)              → "em_andamento"
//   - demais                                     → "nao_iniciado"
async function _syncLBMFromMedicao(medicaoId, contratoId, obraId) {
  try {
    if (!contratoId || !obraId) return;

    // 1. Calcula % físico acumulado do contrato
    // COALESCE(tipo,'Normal') trata medições antigas que tinham tipo NULL
    const pctRes = await db.query(`
      SELECT COALESCE(MAX(pct_total), 0) AS pct_acumulado,
             COUNT(*) FILTER (WHERE status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')) AS total_aprovadas
      FROM medicoes
      WHERE contrato_id = $1
        AND COALESCE(tipo,'Normal') IN ('Normal', 'Avanco_Fisico')
        AND status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
    `, [contratoId]);
    const pct = Math.min(100, Math.max(0, parseFloat(pctRes.rows[0]?.pct_acumulado) || 0));
    console.log(`[LBM Sync] contrato=${contratoId} obra=${obraId} — pct_acumulado=${pct}% (${pctRes.rows[0]?.total_aprovadas} medições aprovadas)`);
    if (pct === 0) {
      console.warn(`[LBM Sync] pct=0: medição pode ser Adiantamento ou ainda não aprovada. Abortando sync.`);
      return;
    }

    // 2. Serviços LBM desta obra vinculados a este contrato (via junction table)
    const servRes = await db.query(
      `SELECT DISTINCT sc.servico_id AS id
       FROM lbm_servico_contratos sc
       JOIN lbm_servicos s ON s.id = sc.servico_id
       WHERE s.obra_id=$1 AND sc.contrato_id=$2`,
      [obraId, contratoId]
    );
    if (!servRes.rows.length) return; // sem serviços vinculados → nada a fazer

    // 3. Locais da obra ordenados (plana, pela hierarquia depth-first)
    const locaisRes = await db.query(`
      WITH RECURSIVE hier AS (
        SELECT id, parent_id, nome, ordem, 0 AS nivel,
               LPAD(ordem::text, 5, '0') AS sort_path
        FROM lbm_locais WHERE obra_id=$1 AND parent_id IS NULL
        UNION ALL
        SELECT l.id, l.parent_id, l.nome, l.ordem, h.nivel+1,
               h.sort_path || '.' || LPAD(l.ordem::text, 5, '0')
        FROM lbm_locais l JOIN hier h ON l.parent_id=h.id
      )
      SELECT id FROM hier ORDER BY sort_path
    `, [obraId]);
    const locais = locaisRes.rows;
    const total  = locais.length;
    if (!total) return;

    const hoje = new Date().toISOString().slice(0, 10);

    // 4. DELETE + INSERT por serviço com pct calculado pela média dos contratos do serviço
    for (const serv of servRes.rows) {
      // Busca todos os contratos do serviço para calcular pct médio
      const allCRes = await db.query(
        'SELECT contrato_id FROM lbm_servico_contratos WHERE servico_id=$1', [serv.id]
      );
      const allContratoIds = allCRes.rows.map(r => r.contrato_id);
      const pctRows = await db.query(`
        SELECT COALESCE(MAX(pct_total), 0) AS pct_acumulado
        FROM medicoes
        WHERE contrato_id = ANY($1)
          AND COALESCE(tipo,'Normal') IN ('Normal','Avanco_Fisico')
          AND status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
        GROUP BY contrato_id
      `, [allContratoIds]);
      const pctServ = pctRows.rows.length
        ? Math.min(100, pctRows.rows.reduce((a, r) => a + parseFloat(r.pct_acumulado), 0) / pctRows.rows.length)
        : pct; // fallback para o pct do contrato atual se só tem 1

      const nConcluidos = Math.floor((pctServ / 100) * total);
      await db.query(`DELETE FROM lbm_progresso WHERE servico_id=$1`, [serv.id]);
      for (let i = 0; i < total; i++) {
        const localId = locais[i].id;
        let status, iniReal, fimReal;

        if (i < nConcluidos) {
          status  = 'concluido';
          fimReal = hoje;
        } else if (i === nConcluidos && pctServ < 100) {
          status  = 'em_andamento';
          iniReal = hoje;
        } else {
          status  = 'nao_iniciado';
        }

        await db.query(`
          INSERT INTO lbm_progresso
            (servico_id, local_id, status, data_inicio_real, data_fim_real, medicao_id, atualizado_em)
          VALUES ($1,$2,$3,$4,$5,$6,NOW())
        `, [serv.id, localId, status, iniReal||null, fimReal||null, medicaoId]);
      }
    }
    console.log(`[LBM Sync] medicao=${medicaoId} contrato=${contratoId} obra=${obraId} pct=${pct}% → ${nConcluidos}/${total} locais concluídos`);
  } catch (e) {
    // Não deixa falhar a aprovação por erro na sincronização LBM
    console.error('[LBM Sync] Erro (não crítico):', e.message);
  }
}

// ── Helper: valida saldo e salva itens de medição ─────────────────
// tipo: 'Normal' | 'Adiantamento' | 'Avanco_Fisico'
// - Normal/Adiantamento: valida contra saldo financeiro (qtd_total - Normal - Adt já aprovadas)
// - Avanco_Fisico: valida contra saldo de ADT pendente (Adt - AvFis já aprovadas)
async function _saveMedicaoItens(client, medicao_id, contrato_id, arr, isUpdate, tipo) {
  const tipoStr = tipo || 'Normal';

  // Pré-busca dados de todos os contrato_itens referenciados num único batch
  // para usar tanto na validação quanto no insert
  const linkedIds = [...new Set(arr.filter(it => it.contrato_item_id).map(it => +it.contrato_item_id))];
  const ciMap = {};  // contrato_item_id -> { qtd_total, descricao, valor_unitario }
  if (linkedIds.length > 0) {
    const batchR = await client.query(
      'SELECT id, qtd_total, descricao, valor_unitario FROM contrato_itens WHERE id = ANY($1::int[])',
      [linkedIds]
    );
    batchR.rows.forEach(r => {
      ciMap[r.id] = {
        qtd_total:      parseFloat(r.qtd_total)      || 0,
        descricao:      r.descricao,
        valor_unitario: parseFloat(r.valor_unitario) || 0,
      };
    });
  }

  for (const it of arr) {
    // Itens avulsos (sem vínculo com contrato_item) não têm validação de saldo
    // por item — o saldo global do contrato já foi verificado antes de chegar aqui.
    if (!it.contrato_item_id) continue;
    const qtdMes = parseFloat(it.qtd_mes) || 0;
    if (qtdMes <= 0) continue;

    const ci = ciMap[it.contrato_item_id];
    if (!ci) continue;
    const qtdTotal = ci.qtd_total;
    const descItem = ci.descricao;

    if (tipoStr === 'Avanco_Fisico') {
      // Só pode confirmar o que foi adiantado e ainda não confirmado
      const pendQ = await client.query(`
        SELECT
          SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Adiantamento'  THEN mi.qtd_mes ELSE 0 END) AS qtd_adt,
          SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Avanco_Fisico' THEN mi.qtd_mes ELSE 0 END) AS qtd_avfis
        FROM medicao_itens mi
        JOIN medicoes m ON m.id = mi.medicao_id
        WHERE mi.contrato_item_id = $1
          AND m.contrato_id = $2
          AND m.status NOT IN ('Rascunho','Reprovado')
          AND mi.medicao_id <> $3
      `, [it.contrato_item_id, contrato_id, isUpdate || 0]);
      const saldoPendente = parseFloat(
        ((parseFloat(pendQ.rows[0].qtd_adt) || 0) - (parseFloat(pendQ.rows[0].qtd_avfis) || 0)).toFixed(4)
      );
      if (qtdMes > saldoPendente + 0.0001) {
        throw new Error(
          `Item "${descItem}": ${qtdMes} excede o saldo de adiantamento pendente ${saldoPendente} ${it.unidade||''}.`
        );
      }
    } else {
      // Normal ou Adiantamento: valida saldo financeiro (Normal+Adt juntos não excedem qtd_total)
      const acumQ = await client.query(`
        SELECT COALESCE(SUM(mi.qtd_mes), 0) AS total
        FROM medicao_itens mi
        JOIN medicoes m ON m.id = mi.medicao_id
        WHERE mi.contrato_item_id = $1
          AND m.contrato_id = $2
          AND m.status NOT IN ('Rascunho','Reprovado')
          AND COALESCE(m.tipo,'Normal') IN ('Normal','Adiantamento')
          AND mi.medicao_id <> $3
      `, [it.contrato_item_id, contrato_id, isUpdate || 0]);
      const acumulado = parseFloat(acumQ.rows[0].total) || 0;
      const saldo     = parseFloat((qtdTotal - acumulado).toFixed(4));
      if (qtdMes > saldo + 0.0001) {
        throw new Error(
          `Item "${descItem}": quantidade ${qtdMes} excede o saldo disponível ${saldo} ${it.unidade||''}.`
        );
      }
    }
  }

  if (isUpdate) await client.query('DELETE FROM medicao_itens WHERE medicao_id=$1', [medicao_id]);

  for (let i = 0; i < arr.length; i++) {
    const it      = arr[i];
    const qtdAnt  = parseFloat(it.qtd_anterior)  || 0;
    const qtdMes  = parseFloat(it.qtd_mes)        || 0;
    const qtdAcum = parseFloat((qtdAnt + qtdMes).toFixed(4));

    // Para itens vinculados ao contrato: usa valor_unitario do banco (ciMap).
    // Para itens avulsos (sem contrato_item_id): usa o valor do frontend.
    // Avanço Físico mantém valor_item = 0 (sem impacto financeiro).
    let vun, valItem;
    if (it.contrato_item_id && ciMap[it.contrato_item_id]) {
      vun = ciMap[it.contrato_item_id].valor_unitario || parseFloat(it.valor_unitario) || 0;
    } else {
      vun = parseFloat(it.valor_unitario) || 0;
    }
    if (tipoStr === 'Avanco_Fisico') {
      valItem = 0; // Avanço Físico não gera pagamento
    } else {
      valItem = parseFloat((qtdMes * vun).toFixed(2));
    }

    await client.query(
      `INSERT INTO medicao_itens
         (medicao_id, contrato_item_id, ordem, descricao, unidade,
          qtd_contrato, qtd_anterior, qtd_mes, qtd_acumulada, valor_unitario, valor_item)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [medicao_id, it.contrato_item_id || null, i, it.descricao, it.unidade || '%',
       parseFloat(it.qtd_contrato) || 0, qtdAnt, qtdMes, qtdAcum, vun, valItem]
    );
  }
}

// ── Listagem ─────────────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  let q = `SELECT m.*,
             o.nome as obra_nome,
             COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) as fornecedor_nome,
             COALESCE(NULLIF(e.nome_fantasia,''), e.razao_social) as empresa_nome,
             c.numero as contrato_numero,
             c.valor_total AS contrato_valor_total,
             CASE WHEN c.valor_total > 0
               THEN ROUND(m.valor_medicao / c.valor_total * 100, 2)
               ELSE 0 END AS pct_desta_medicao_no_contrato,
             CASE WHEN c.valor_total > 0 THEN ROUND(
               COALESCE((
                 SELECT SUM(
                   CASE WHEN COALESCE(m.tipo,'Normal') = 'Normal'
                             THEN mi2.valor_item
                        WHEN COALESCE(m.tipo,'Normal') = 'Avanco_Fisico'
                             THEN mi2.qtd_mes * mi2.valor_unitario
                        ELSE 0 END
                 )
                 FROM medicao_itens mi2
                 WHERE mi2.medicao_id = m.id
               ), 0) / c.valor_total * 100, 2)
             ELSE 0 END AS pct_fisico_desta_medicao,
             -- Aprovações agregadas: nivel, acao, usuario, data_hora (ordenadas)
             COALESCE((
               SELECT json_agg(
                 json_build_object(
                   'nivel',    apv.nivel,
                   'acao',     apv.acao,
                   'usuario',  apv.usuario,
                   'data_hora',apv.data_hora
                 ) ORDER BY apv.data_hora
               )
               FROM aprovacoes apv
               WHERE apv.medicao_id = m.id
                 AND apv.acao IN ('aprovado','reprovado')
             ), '[]'::json) AS aprovacoes
           FROM medicoes m
           JOIN obras        o ON m.obra_id       = o.id
           JOIN fornecedores f ON m.fornecedor_id  = f.id
           JOIN empresas     e ON m.empresa_id     = e.id
           JOIN contratos    c ON m.contrato_id    = c.id
           WHERE 1=1`;
  const params = [];
  if (req.query.empresa_id) { params.push(req.query.empresa_id); q += ` AND m.empresa_id=$${params.length}`; }
  if (req.query.status)     { params.push(req.query.status);     q += ` AND m.status=$${params.length}`; }
  if (req.query.periodo)    { params.push(req.query.periodo);    q += ` AND m.periodo=$${params.length}`; }
  if (req.query.tipo)       { params.push(req.query.tipo);       q += ` AND m.tipo=$${params.length}`; }
  if (req.query.contrato_id){ params.push(req.query.contrato_id);q += ` AND m.contrato_id=$${params.length}`; }
  // Restrição de acesso por obra
  const obrasPermitidas = await getObrasPermitidas(req, db);
  q += ' ' + obraClause(obrasPermitidas, 'm.obra_id', params);
  q += ' ORDER BY m.criado_em DESC';
  res.json((await db.query(q, params)).rows);
});

// ── Descompasso financeiro-físico por contrato ────────────────────
// Retorna contratos que têm adiantamentos e o gap financeiro vs físico

router.get('/descompasso', auth, async (req, res) => {
  const params = [];
  let filter = '';
  if (req.query.obra_id)    { params.push(req.query.obra_id);    filter += ` AND c.obra_id=$${params.length}`; }
  if (req.query.empresa_id) { params.push(req.query.empresa_id); filter += ` AND c.empresa_id=$${params.length}`; }

  const rows = await db.query(`
    SELECT
      c.id                AS contrato_id,
      c.numero            AS contrato_numero,
      c.valor_total,
      COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) AS fornecedor_nome,
      -- Total financeiro pago (Normal + Adiantamento), excluindo Rascunho/Reprovado
      COALESCE(SUM(CASE WHEN m.tipo IN ('Normal','Adiantamento') AND m.status NOT IN ('Rascunho','Reprovado')
                        THEN m.valor_medicao ELSE 0 END), 0) AS total_financeiro,
      -- Total adiantado especificamente
      COALESCE(SUM(CASE WHEN m.tipo = 'Adiantamento' AND m.status NOT IN ('Rascunho','Reprovado')
                        THEN m.valor_medicao ELSE 0 END), 0) AS total_adiantado,
      -- % físico acumulado (Normal + Avanco_Fisico) — apenas medições aprovadas
      COALESCE(MAX(CASE WHEN m.tipo IN ('Normal','Avanco_Fisico') AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                        THEN m.pct_total END), 0) AS pct_fisico_acumulado,
      -- Valor equivalente ao físico executado
      CASE WHEN c.valor_total > 0
           THEN ROUND(c.valor_total * COALESCE(MAX(
             CASE WHEN m.tipo IN ('Normal','Avanco_Fisico') AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                  THEN m.pct_total END), 0) / 100, 2)
           ELSE 0 END AS valor_fisico_executado,
      -- Descompasso = financeiro pago - valor físico executado
      CASE WHEN c.valor_total > 0
           THEN ROUND(
             COALESCE(SUM(CASE WHEN m.tipo IN ('Normal','Adiantamento') AND m.status NOT IN ('Rascunho','Reprovado')
                               THEN m.valor_medicao ELSE 0 END), 0)
             - c.valor_total * COALESCE(MAX(
                 CASE WHEN m.tipo IN ('Normal','Avanco_Fisico') AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                      THEN m.pct_total END), 0) / 100,
           2)
           ELSE 0 END AS descompasso
    FROM contratos c
    JOIN fornecedores f ON f.id = c.fornecedor_id
    LEFT JOIN medicoes m ON m.contrato_id = c.id
    WHERE 1=1 ${filter}
    GROUP BY c.id, c.numero, c.valor_total, f.nome_fantasia, f.razao_social
    HAVING COALESCE(SUM(CASE WHEN m.tipo = 'Adiantamento' AND m.status NOT IN ('Rascunho','Reprovado')
                             THEN m.valor_medicao ELSE 0 END), 0) > 0
    ORDER BY descompasso DESC
  `, params);
  res.json(rows.rows);
});

// ── Adiantamentos pendentes de confirmação física ─────────────────
// Retorna itens do contrato que foram adiantados financeiramente mas
// ainda não tiveram a execução física confirmada via Avanço Físico.
// Usado para pré-carregar o formulário de Medição de Avanço Físico.

router.get('/adiantamentos-pendentes', auth, async (req, res) => {
  const { contrato_id } = req.query;
  if (!contrato_id) return res.status(400).json({ error: 'contrato_id obrigatório' });

  const rows = await db.query(`
    SELECT
      ci.id                AS contrato_item_id,
      ci.ordem,
      ci.descricao,
      ci.unidade,
      ci.qtd_total,
      ci.valor_unitario,
      SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Adiantamento'  THEN mi.qtd_mes ELSE 0 END) AS qtd_adiantada,
      SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Avanco_Fisico' THEN mi.qtd_mes ELSE 0 END) AS qtd_confirmada
    FROM contrato_itens ci
    JOIN medicao_itens mi ON mi.contrato_item_id = ci.id
    JOIN medicoes m ON m.id = mi.medicao_id
    WHERE ci.contrato_id = $1
      AND m.status NOT IN ('Rascunho','Reprovado')
      AND COALESCE(m.tipo,'Normal') IN ('Adiantamento','Avanco_Fisico')
    GROUP BY ci.id, ci.ordem, ci.descricao, ci.unidade, ci.qtd_total, ci.valor_unitario
    HAVING SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Adiantamento'  THEN mi.qtd_mes ELSE 0 END)
         > SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Avanco_Fisico' THEN mi.qtd_mes ELSE 0 END)
    ORDER BY ci.ordem
  `, [contrato_id]);

  res.json(rows.rows.map(r => ({
    contrato_item_id: r.contrato_item_id,
    ordem:            r.ordem,
    descricao:        r.descricao,
    unidade:          r.unidade,
    qtd_total:        parseFloat(r.qtd_total)       || 0,
    valor_unitario:   parseFloat(r.valor_unitario)  || 0,
    qtd_adiantada:    parseFloat(r.qtd_adiantada)   || 0,
    qtd_confirmada:   parseFloat(r.qtd_confirmada)  || 0,
    qtd_pendente:     parseFloat(
      (parseFloat(r.qtd_adiantada) - parseFloat(r.qtd_confirmada)).toFixed(4)
    ),
  })));
});

// ── Integração ERP ────────────────────────────────────────────────
// POST /api/medicoes/integrar-erp  — deve ficar ANTES de /:id
// Body: { ids: [1, 2, 3] }
router.post('/integrar-erp', auth, perm('integrarErp'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: 'Informe ao menos uma medição.' });

  const cfgRow = await db.query("SELECT valor FROM configuracoes WHERE chave='erp'");
  const cfg = cfgRow.rows[0]?.valor || {};
  if (!cfg.url) return res.status(503).json({ error: 'ERP não configurado. Acesse Configurações → Integração ERP.' });

  const statusPermitidos = ['Aprovado', 'Em Assinatura', 'Assinado'];
  const resultados = [];

  for (const id of ids) {
    try {
      const r = await db.query(`
        SELECT m.*,
               o.codigo         AS obra_codigo,
               o.nome           AS obra_nome,
               e.cnpj           AS empresa_cnpj,
               e.razao_social   AS empresa_razao,
               c.numero         AS contrato_numero,
               f.cnpj           AS fornecedor_cnpj,
               f.razao_social   AS fornecedor_razao
        FROM medicoes m
        JOIN contratos    c ON m.contrato_id   = c.id
        JOIN obras        o ON c.obra_id        = o.id
        JOIN empresas     e ON c.empresa_id     = e.id
        JOIN fornecedores f ON c.fornecedor_id  = f.id
        WHERE m.id = $1
      `, [id]);

      if (!r.rows.length) { resultados.push({ id, status: 'erro', motivo: 'Medição não encontrada' }); continue; }
      const m = r.rows[0];

      if (m.integrada_erp) { resultados.push({ id, status: 'ignorada', motivo: 'Já integrada anteriormente', codigo: m.codigo }); continue; }
      if (!statusPermitidos.includes(m.status)) {
        resultados.push({ id, status: 'erro', motivo: `Status "${m.status}" não permitido para integração`, codigo: m.codigo }); continue;
      }

      const payload = {
        codigo_medicao:   m.codigo,
        empresa_codigo:   cfg.campo_empresa_codigo === 'cnpj' ? m.empresa_cnpj : (m.obra_codigo?.split('-')[0] || m.empresa_cnpj),
        obra_codigo:      m.obra_codigo,
        contrato_numero:  m.contrato_numero,
        fornecedor_cnpj:  m.fornecedor_cnpj,
        fornecedor_razao: m.fornecedor_razao,
        valor_medicao:    parseFloat(m.valor_medicao) || 0,
        periodo_inicio:   m.periodo_inicio,
        periodo_fim:      m.periodo_fim,
        status:           m.status,
        ...(cfg.payload_extra || {}),
      };

      const headers = { 'Content-Type': 'application/json' };
      if (cfg.auth_header && cfg.auth_value) headers[cfg.auth_header] = cfg.auth_value;

      // HTTP nativo Node.js (sem dependência externa)
      const erpResult = await new Promise((resolve, reject) => {
        const https   = require('https');
        const http    = require('http');
        const urlObj  = new URL(cfg.url);
        const lib     = urlObj.protocol === 'https:' ? https : http;
        const body    = JSON.stringify(payload);
        const opts    = {
          hostname: urlObj.hostname,
          port:     urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path:     urlObj.pathname + urlObj.search,
          method:   cfg.method || 'POST',
          headers:  { ...headers, 'Content-Length': Buffer.byteLength(body) },
        };
        const req2 = lib.request(opts, resp => {
          let data = '';
          resp.on('data', c => data += c);
          resp.on('end', () => resolve({ ok: resp.statusCode < 300, status: resp.statusCode, body: data }));
        });
        req2.on('error', reject);
        req2.write(body);
        req2.end();
      });

      let erpJson;
      try { erpJson = JSON.parse(erpResult.body); } catch { erpJson = { raw: erpResult.body }; }

      if (!erpResult.ok) {
        resultados.push({ id, status: 'erro', motivo: `ERP retornou HTTP ${erpResult.status}`, codigo: m.codigo, erp_resp: erpJson });
        continue;
      }

      await db.query(`
        UPDATE medicoes SET
          integrada_erp      = TRUE,
          integrada_erp_em   = NOW(),
          integrada_erp_user = $1,
          integrada_erp_resp = $2
        WHERE id = $3
      `, [req.user?.login || req.user?.nome || 'sistema', JSON.stringify(erpJson), id]);

      await audit(req, 'integrar_erp', 'medicao', id,
        `Medição "${m.codigo}" integrada ao ERP — obra ${m.obra_codigo} · contrato ${m.contrato_numero} · R$ ${m.valor_medicao}`);

      // Notifica aprovadores que a medição foi integrada ao ERP
      notificarAprovadoresStatusChange(
        id, 'Integrado ERP', 'integrado_erp', 'Financeiro',
        req.user?.nome || req.user?.login || 'sistema',
        null, db
      ).catch(e => console.warn('[ERP] Falha ao notificar aprovadores sobre integração ERP:', e.message));

      resultados.push({ id, status: 'ok', codigo: m.codigo, erp_resp: erpJson });
    } catch (e) {
      resultados.push({ id, status: 'erro', motivo: e.message });
    }
  }

  const ok    = resultados.filter(r => r.status === 'ok').length;
  const erros = resultados.filter(r => r.status === 'erro').length;
  const ignor = resultados.filter(r => r.status === 'ignorada').length;
  res.json({ total: ids.length, integradas: ok, erros, ignoradas: ignor, resultados });
});

// ── Detalhe ──────────────────────────────────────────────────────

router.get('/:id', auth, async (req, res) => {
  const r = await db.query(`
    SELECT m.*,
      e.razao_social  AS empresa_nome,
      o.nome          AS obra_nome,
      f.razao_social  AS fornecedor_nome,
      f.email_assin   AS fornecedor_email_assin,
      f.email_nf      AS fornecedor_email_nf,
      f.tel           AS fornecedor_tel,
      c.numero        AS contrato_numero,
      c.valor_total   AS contrato_valor_total
    FROM medicoes m
    LEFT JOIN empresas    e ON e.id = m.empresa_id
    LEFT JOIN obras       o ON o.id = m.obra_id
    LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
    LEFT JOIN contratos   c ON c.id = m.contrato_id
    WHERE m.id = $1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  const med = r.rows[0];

  // Restrição de acesso por obra
  const _obras = await getObrasPermitidas(req, db);
  if (!temAcessoObra(_obras, med.obra_id))
    return res.status(403).json({ error: 'Acesso negado a esta medição.' });

  const execAnteriorR = await db.query(`
    SELECT COALESCE(SUM(mi.valor_item), 0) AS valor_executado
    FROM medicao_itens mi
    JOIN medicoes m ON m.id = mi.medicao_id
    WHERE m.contrato_id = $1
      AND m.status NOT IN ('Rascunho','Reprovado')
      AND m.id <> $2
  `, [med.contrato_id, req.params.id]);

  const valorExecAnterior = parseFloat(execAnteriorR.rows[0].valor_executado) || 0;
  const contratoValTotal  = parseFloat(med.contrato_valor_total) || 0;
  const valorMedicaoAtual = parseFloat(med.valor_medicao) || 0;
  const pctAnterior  = contratoValTotal > 0
    ? parseFloat(Math.min(100, (valorExecAnterior / contratoValTotal * 100)).toFixed(2)) : 0;
  const pctEstaMed   = contratoValTotal > 0
    ? parseFloat(Math.min(100, (valorMedicaoAtual / contratoValTotal * 100)).toFixed(2)) : 0;
  const pctAcumulado = parseFloat(Math.min(100, pctAnterior + pctEstaMed).toFixed(2));

  const [aprs, evs, itens] = await Promise.all([
    db.query('SELECT * FROM aprovacoes   WHERE medicao_id=$1 ORDER BY data_hora', [req.params.id]),
    db.query('SELECT * FROM evidencias   WHERE medicao_id=$1 ORDER BY criado_em', [req.params.id]),
    db.query('SELECT * FROM medicao_itens WHERE medicao_id=$1 ORDER BY ordem,id', [req.params.id]),
  ]);

  // Gera URLs de visualização para cada evidência (signed URL para S3 privado)
  const evidenciasComUrl = await Promise.all(evs.rows.map(async ev => ({
    ...ev,
    url_view: await storageHelper.getViewUrl(ev),
  })));

  res.json({
    ...med,
    valor_exec_anterior:    valorExecAnterior,
    pct_anterior_contrato:  pctAnterior,
    pct_esta_medicao:       pctEstaMed,
    pct_acumulado_contrato: pctAcumulado,
    aprovacoes: aprs.rows,
    evidencias: evidenciasComUrl,
    itens: itens.rows,
  });
});

// ── Criar ────────────────────────────────────────────────────────

router.post('/', auth, perm('criarMedicao'), async (req, res) => {
  const { empresa_id, obra_id, fornecedor_id, contrato_id, periodo, codigo,
          pct_anterior, pct_mes, pct_total, descricao, status, itens,
          tipo = 'Normal', valor_adiantamento } = req.body;

  const tipoValido = ['Normal', 'Adiantamento', 'Avanco_Fisico'].includes(tipo) ? tipo : 'Normal';

  let valor_medicao, valor_acumulado, arr;

  arr = Array.isArray(itens) ? itens : [];

  if (tipoValido === 'Avanco_Fisico') {
    // Avanço físico: confirma itens adiantados — sem valor financeiro
    valor_medicao   = 0;
    valor_acumulado = 0;
  } else {
    // Normal e Adiantamento: geram valor financeiro.
    // Busca valor_unitario real do banco para itens vinculados ao contrato,
    // evitando depender do que o frontend enviou (pode chegar 0 por bugs).
    const linkedIds = [...new Set(arr.filter(it => it.contrato_item_id).map(it => +it.contrato_item_id))];
    const dbPriceMap = {};
    if (linkedIds.length > 0) {
      const prR = await db.query(
        `SELECT id, valor_unitario FROM contrato_itens WHERE id = ANY($1::int[])`,
        [linkedIds]
      );
      prR.rows.forEach(r => { dbPriceMap[r.id] = parseFloat(r.valor_unitario) || 0; });
    }
    valor_medicao = arr.reduce((s, it) => {
      const qtdMes = parseFloat(it.qtd_mes) || 0;
      const vun    = it.contrato_item_id
        ? (dbPriceMap[it.contrato_item_id] || parseFloat(it.valor_unitario) || 0)
        : (parseFloat(it.valor_unitario) || 0);
      return s + qtdMes * vun;
    }, 0);
    valor_medicao = parseFloat(valor_medicao.toFixed(2));
    // ── Valida e calcula saldo global do contrato ─────────────────
    // Usa m.valor_medicao direto da tabela medicoes (não medicao_itens)
    // para garantir que itens avulsos (sem contrato_item_id) também sejam contados.
    const contSaldoR = await db.query(`
      SELECT c.valor_total,
             COALESCE((
               SELECT SUM(m2.valor_medicao)
                 FROM medicoes m2
                WHERE m2.contrato_id = c.id
                  AND COALESCE(m2.tipo,'Normal') IN ('Normal','Adiantamento')
                  AND m2.status NOT IN ('Rascunho','Reprovado')
             ), 0) AS total_financeiro_anterior
        FROM contratos c WHERE c.id = $1
    `, [contrato_id]);

    const contratoValorTotal      = parseFloat(contSaldoR.rows[0]?.valor_total)               || 0;
    const totalFinanceiroAnterior = parseFloat(contSaldoR.rows[0]?.total_financeiro_anterior)  || 0;
    valor_acumulado = parseFloat((totalFinanceiroAnterior + valor_medicao).toFixed(2));

    if (contratoValorTotal > 0 && valor_acumulado > contratoValorTotal + 0.01) {
      const saldoDisp = parseFloat((contratoValorTotal - totalFinanceiroAnterior).toFixed(2));
      const fmtBR = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return res.status(422).json({
        error: `Saldo insuficiente no contrato. ` +
               `Valor da medição: R$ ${fmtBR(valor_medicao)} · ` +
               `Saldo disponível: R$ ${fmtBR(saldoDisp)} · ` +
               `Valor total do contrato: R$ ${fmtBR(contratoValorTotal)}.`
      });
    }
  }

  const statusFinal = status || 'Rascunho';

  // ── Calcula pct_total no backend (ignora o % enviado pelo frontend) ──────────
  // Evita depender de itens com unidade='%'. Usa valores financeiros vs valor_total
  // do contrato como proxy de progresso.
  // - Adiantamento: pct=0 (não avança físico)
  // - Normal: (físico anterior aprovado + este valor_medicao) / contrato_valor_total
  // - Avanco_Fisico: (físico anterior + valor dos itens × valor_unitario do contrato) / valor_total
  let pct_total_backend = 0;
  let pct_anterior_backend = 0;
  let pct_mes_backend = 0;

  if (tipoValido !== 'Adiantamento') {
    const contR = await db.query('SELECT valor_total FROM contratos WHERE id=$1', [contrato_id]);
    const contVal = parseFloat(contR.rows[0]?.valor_total) || 0;

    if (contVal > 0) {
      // Valor físico já aprovado (Normal item values + AvFis item values usando valor_unitario real)
      const prevR = await db.query(`
        SELECT COALESCE(SUM(
          CASE WHEN COALESCE(m.tipo,'Normal') = 'Normal'        THEN mi.valor_item
               WHEN COALESCE(m.tipo,'Normal') = 'Avanco_Fisico' THEN mi.qtd_mes * mi.valor_unitario
               ELSE 0 END
        ), 0) AS prev_fisico
        FROM medicao_itens mi
        JOIN medicoes m ON m.id = mi.medicao_id
        WHERE m.contrato_id = $1
          AND COALESCE(m.tipo,'Normal') IN ('Normal','Avanco_Fisico')
          AND m.status NOT IN ('Rascunho','Reprovado')
      `, [contrato_id]);
      const prevFisico = parseFloat(prevR.rows[0]?.prev_fisico) || 0;

      // Valor físico desta medição
      let thisPhysValue = 0;
      if (tipoValido === 'Normal') {
        thisPhysValue = valor_medicao;
      } else if (tipoValido === 'Avanco_Fisico') {
        // Busca valor_unitario real dos itens do contrato
        for (const it of arr) {
          if (!it.contrato_item_id) continue;
          const ciR = await db.query('SELECT valor_unitario FROM contrato_itens WHERE id=$1', [it.contrato_item_id]);
          const vun = parseFloat(ciR.rows[0]?.valor_unitario) || 0;
          thisPhysValue += (parseFloat(it.qtd_mes) || 0) * vun;
        }
      }

      pct_anterior_backend = parseFloat(Math.min(100, (prevFisico / contVal * 100)).toFixed(2));
      pct_mes_backend      = parseFloat(Math.min(100 - pct_anterior_backend, (thisPhysValue / contVal * 100)).toFixed(2));
      pct_total_backend    = parseFloat(Math.min(100, pct_anterior_backend + pct_mes_backend).toFixed(2));
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO medicoes
         (empresa_id,obra_id,fornecedor_id,contrato_id,periodo,codigo,
          pct_anterior,pct_mes,pct_total,valor_medicao,valor_acumulado,descricao,status,criado_por,tipo)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [empresa_id, obra_id, fornecedor_id, contrato_id, periodo, codigo,
       pct_anterior_backend, pct_mes_backend, pct_total_backend,
       parseFloat(valor_medicao.toFixed(2)), parseFloat(valor_acumulado.toFixed(2)),
       descricao, statusFinal, req.user.nome, tipoValido]
    );
    if (arr.length) {
      await _saveMedicaoItens(client, r.rows[0].id, contrato_id, arr, null, tipoValido);
    }
    if (statusFinal && statusFinal !== 'Rascunho') {
      await client.query(
        'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
        [r.rows[0].id, 'Sistema', 'lançado', req.user.nome,
         tipoValido === 'Avanco_Fisico' ? 'Avanço físico registrado' : 'Medição lançada para aprovação']
      );
    }
    await client.query('COMMIT');
    const row = r.rows[0];
    await audit(req, 'criar', 'medicao', row.id,
      `Medição "${row.codigo}" criada — valor: R$ ${Number(row.valor_medicao).toLocaleString('pt-BR',{minimumFractionDigits:2})} — status: ${row.status}`,
      { tipo: row.tipo, periodo: row.periodo });

    // Notifica aprovadores por e-mail quando lançada diretamente para aprovação
    if (row.status && row.status.startsWith('Aguardando')) {
      const medCompleta = await db.query(`
        SELECT m.*, o.nome AS obra_nome, e.razao_social AS empresa_nome, f.razao_social AS fornecedor_nome
          FROM medicoes m
          JOIN obras o    ON o.id = m.obra_id
          JOIN empresas e ON e.id = o.empresa_id
          JOIN fornecedores f ON f.id = m.fornecedor_id
         WHERE m.id = $1`, [row.id]);
      if (medCompleta.rows[0]) {
        notificarPendenciaAprovacao(medCompleta.rows[0], db).catch(e =>
          console.warn('[email] Falha ao notificar aprovadores na criação:', e.message)
        );
      }
    }

    res.status(201).json(row);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (e.message.includes('excede o saldo')) return res.status(422).json({ error: e.message });
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── Atualizar ────────────────────────────────────────────────────

// Statuses que permitem edição — somente medições em rascunho podem ser alteradas
const STATUS_EDITAVEIS = ['Rascunho'];

router.put('/:id', auth, perm('criarMedicao'), async (req, res) => {
  const m = await db.query('SELECT * FROM medicoes WHERE id=$1', [req.params.id]);
  if (!m.rows[0]) return res.status(404).json({ error: 'Não encontrado' });

  // Bloqueia edição de medições que já avançaram no fluxo de aprovação
  if (!STATUS_EDITAVEIS.includes(m.rows[0].status)) {
    return res.status(422).json({
      error: `Medição com status "${m.rows[0].status}" não pode ser editada. Apenas medições em Rascunho podem ser alteradas.`
    });
  }

  const { descricao, status, itens, pct_anterior, pct_mes, pct_total, contrato_id } = req.body;
  const arr             = Array.isArray(itens) ? itens : [];
  const cid             = contrato_id || m.rows[0].contrato_id;
  const valor_medicao   = arr.length
    ? arr.reduce((s, it) => s + (parseFloat(it.qtd_mes)||0) * (parseFloat(it.valor_unitario)||0), 0)
    : parseFloat(m.rows[0].valor_medicao);
  const valor_acumulado = arr.length
    ? arr.reduce((s, it) => s + (parseFloat(it.qtd_acumulada)||0) * (parseFloat(it.valor_unitario)||0), 0)
    : parseFloat(m.rows[0].valor_acumulado);

  // ── Valida saldo do contrato ao submeter para aprovação ──────────
  // Ao mover de Rascunho → Aguardando, inclui TODAS as medições do contrato
  // (exceto Reprovadas e a própria medição sendo submetida) para bloquear
  // o cenário de dois Rascunhos simultâneos que juntos estouram o saldo.
  const tipoAtual = m.rows[0].tipo || 'Normal';
  if (status && status.startsWith('Aguardando') && ['Normal','Adiantamento'].includes(tipoAtual)) {
    const saldoChkR = await db.query(`
      SELECT c.valor_total,
             COALESCE((
               SELECT SUM(m2.valor_medicao)
                 FROM medicoes m2
                WHERE m2.contrato_id = c.id
                  AND m2.id <> $2
                  AND COALESCE(m2.tipo,'Normal') IN ('Normal','Adiantamento')
                  AND m2.status NOT IN ('Reprovado')
             ), 0) AS total_outros
        FROM contratos c WHERE c.id = $1
    `, [cid, req.params.id]);

    const contratoVT  = parseFloat(saldoChkR.rows[0]?.valor_total)  || 0;
    const totalOutros = parseFloat(saldoChkR.rows[0]?.total_outros)  || 0;
    const projetado   = parseFloat((totalOutros + valor_medicao).toFixed(2));

    if (contratoVT > 0 && projetado > contratoVT + 0.01) {
      const saldoDisp = parseFloat((contratoVT - totalOutros).toFixed(2));
      const fmtBR = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return res.status(422).json({
        error: `Saldo insuficiente para submeter esta medição. ` +
               `Valor: R$ ${fmtBR(valor_medicao)} · ` +
               `Saldo disponível: R$ ${fmtBR(saldoDisp)} · ` +
               `Valor total do contrato: R$ ${fmtBR(contratoVT)}. ` +
               `Pode haver outro Rascunho em aberto comprometendo o saldo.`
      });
    }
  }

  // ── Recalcula pct no backend ao submeter rascunho para aprovação ───────────
  // Evita aceitar percentuais adulterados pelo frontend quando o status muda de
  // Rascunho → Aguardando. Em edições que permanecem como Rascunho, usa os
  // valores enviados (ainda é rascunho, sem impacto no fluxo de aprovação).
  let pct_ant_final = parseFloat(pct_anterior) || 0;
  let pct_mes_final = parseFloat(pct_mes)      || 0;
  let pct_tot_final = parseFloat(pct_total)    || 0;

  if (status && status.startsWith('Aguardando') && tipoAtual !== 'Adiantamento') {
    const contR = await db.query('SELECT valor_total FROM contratos WHERE id=$1', [cid]);
    const contVal = parseFloat(contR.rows[0]?.valor_total) || 0;
    if (contVal > 0) {
      const prevR = await db.query(`
        SELECT COALESCE(SUM(
          CASE WHEN COALESCE(m.tipo,'Normal') = 'Normal'        THEN mi.valor_item
               WHEN COALESCE(m.tipo,'Normal') = 'Avanco_Fisico' THEN mi.qtd_mes * mi.valor_unitario
               ELSE 0 END
        ), 0) AS prev_fisico
        FROM medicao_itens mi
        JOIN medicoes m ON m.id = mi.medicao_id
        WHERE m.contrato_id = $1
          AND m.id <> $2
          AND COALESCE(m.tipo,'Normal') IN ('Normal','Avanco_Fisico')
          AND m.status NOT IN ('Rascunho','Reprovado')
      `, [cid, req.params.id]);
      const prevFisico = parseFloat(prevR.rows[0]?.prev_fisico) || 0;

      let thisPhysValue = 0;
      if (tipoAtual === 'Normal') {
        thisPhysValue = valor_medicao;
      } else if (tipoAtual === 'Avanco_Fisico' && arr.length) {
        for (const it of arr) {
          if (!it.contrato_item_id) continue;
          const ciR = await db.query('SELECT valor_unitario FROM contrato_itens WHERE id=$1', [it.contrato_item_id]);
          thisPhysValue += (parseFloat(it.qtd_mes) || 0) * (parseFloat(ciR.rows[0]?.valor_unitario) || 0);
        }
      }
      pct_ant_final = parseFloat(Math.min(100, prevFisico / contVal * 100).toFixed(2));
      pct_mes_final = parseFloat(Math.min(100 - pct_ant_final, thisPhysValue / contVal * 100).toFixed(2));
      pct_tot_final = parseFloat(Math.min(100, pct_ant_final + pct_mes_final).toFixed(2));
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE medicoes SET
         descricao=$1,status=$2,pct_anterior=$3,pct_mes=$4,pct_total=$5,
         valor_medicao=$6,valor_acumulado=$7
       WHERE id=$8 RETURNING *`,
      [descricao, status, pct_ant_final, pct_mes_final, pct_tot_final,
       parseFloat(valor_medicao.toFixed(2)), parseFloat(valor_acumulado.toFixed(2)), req.params.id]
    );
    if (arr.length) {
      await _saveMedicaoItens(client, parseInt(req.params.id), cid, arr, parseInt(req.params.id));
    }
    await client.query('COMMIT');
    const row = r.rows[0];
    await audit(req, 'editar', 'medicao', row.id,
      `Medição "${row.codigo}" atualizada — status: ${row.status}`);

    // Notifica aprovadores por e-mail quando submetida para aprovação
    if (row.status && row.status.startsWith('Aguardando')) {
      const medCompleta = await db.query(`
        SELECT m.*, o.nome AS obra_nome, e.razao_social AS empresa_nome, f.razao_social AS fornecedor_nome
          FROM medicoes m
          JOIN obras o    ON o.id = m.obra_id
          JOIN empresas e ON e.id = o.empresa_id
          JOIN fornecedores f ON f.id = m.fornecedor_id
         WHERE m.id = $1`, [row.id]);
      if (medCompleta.rows[0]) {
        notificarPendenciaAprovacao(medCompleta.rows[0], db).catch(e =>
          console.warn('[email] Falha ao notificar aprovadores na submissão:', e.message)
        );
      }
    }

    res.json(row);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (e.message.includes('excede o saldo')) return res.status(422).json({ error: e.message });
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── Aprovações ───────────────────────────────────────────────────

router.post('/:id/aprovar', auth, async (req, res) => {
  const id  = parseInt(req.params.id);
  const { comentario } = req.body;
  const m   = await db.query('SELECT * FROM medicoes WHERE id=$1', [id]);
  if (!m.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  const med = m.rows[0];
  const lvMap = { 'Aguardando N1': 'N1', 'Aguardando N2': 'N2', 'Aguardando N3': 'N3' };
  const nivel = lvMap[med.status];
  if (!nivel) return res.status(400).json({ error: 'Medição não está em alçada de aprovação' });

  // ── Busca alçada antes de validar (usada tanto na validação de grupo quanto no nextStatus) ──
  const alcR = await db.query(
    `SELECT n1_grupos, n2_grupos, n3_grupos FROM alcadas
      WHERE empresa_id = (SELECT empresa_id FROM obras WHERE id = $1)
        AND (obra_id = $1 OR obra_id IS NULL)
        AND (ativo IS NULL OR ativo = true)
      ORDER BY obra_id NULLS LAST LIMIT 1`,
    [med.obra_id]
  );
  const alc    = alcR.rows[0] || {};
  const nKey   = nivel.toLowerCase(); // 'n1', 'n2', 'n3'
  const grupos = Array.isArray(alc[`${nKey}_grupos`]) ? alc[`${nKey}_grupos`] : [];
  const userGrupos = req.user?.grupos || [];

  // ── Validação 1: perfil genérico (ADM sempre pode) ──────────────────────────
  const permKey = `aprovar${nivel}`;
  if (!await checkPerm(userGrupos, req.user?.perfil, permKey))
    return res.status(403).json({ error: `Sem permissão para aprovar nível ${nivel}. Contate o administrador.` });

  // ── Validação 2: grupo AD real da alçada (se alçada tiver grupos configurados) ─
  // ADM bypassa a validação de grupo AD
  if (req.user?.perfil !== 'ADM' && grupos.length > 0) {
    const temGrupo = userGrupos.some(g => grupos.includes(g));
    if (!temGrupo) {
      return res.status(403).json({
        error: `Seu usuário não pertence aos grupos autorizados para aprovar o nível ${nivel} nesta obra. `
             + `Grupos necessários: ${grupos.join(', ')}. `
             + `Seus grupos: ${userGrupos.length ? userGrupos.join(', ') : '(nenhum)'}. `
             + `Contate o administrador.`,
      });
    }
  }

  // ── Segregação de funções: impede que o mesmo usuário aprove mais de um nível ─
  const jaAprovouR = await db.query(
    `SELECT nivel FROM aprovacoes
      WHERE medicao_id = $1
        AND acao = 'aprovado'
        AND LOWER(usuario) = LOWER($2)`,
    [id, req.user.nome]
  );
  if (jaAprovouR.rows.length > 0) {
    const niveisAnteriores = jaAprovouR.rows.map(r => r.nivel).join(', ');
    return res.status(403).json({
      error: `Conflito de segregação de funções: o usuário "${req.user.nome}" já aprovou esta medição no(s) nível(is) ${niveisAnteriores}. O mesmo usuário não pode aprovar múltiplos níveis de alçada.`,
    });
  }

  await db.query(
    'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
    [id, nivel, 'aprovado', req.user.nome, comentario||'']
  );

  // ── Determina próximo status pulando níveis não configurados na alçada ───────
  const temN2 = Array.isArray(alc.n2_grupos) ? alc.n2_grupos.length > 0 : false;
  const temN3 = Array.isArray(alc.n3_grupos) ? alc.n3_grupos.length > 0 : false;

  let novoStatus;
  if (med.status === 'Aguardando N1') {
    novoStatus = temN2 ? 'Aguardando N2' : (temN3 ? 'Aguardando N3' : 'Aprovado');
  } else if (med.status === 'Aguardando N2') {
    novoStatus = temN3 ? 'Aguardando N3' : 'Aprovado';
  } else {
    novoStatus = 'Aprovado';
  }

  if (novoStatus === 'Aprovado') {
    const assinCfg = await db.query("SELECT valor FROM configuracoes WHERE chave='assinatura'");
    const assin = assinCfg.rows[0] ? assinCfg.rows[0].valor : {};
    if (assin.ativo) novoStatus = 'Em Assinatura';
  }
  await db.query('UPDATE medicoes SET status=$1 WHERE id=$2', [novoStatus, id]);
  await audit(req, 'aprovar', 'medicao', id,
    `Medição "${med.codigo}" aprovada nível ${nivel} — novo status: ${novoStatus}`,
    { nivel, comentario: comentario || null });

  // Notifica próximo nível por e-mail (fire-and-forget)
  if (novoStatus.startsWith('Aguardando')) {
    const medCompleta = await db.query(`
      SELECT m.*, o.nome AS obra_nome, e.razao_social AS empresa_nome, f.razao_social AS fornecedor_nome
        FROM medicoes m
        JOIN obras o    ON o.id = m.obra_id
        JOIN empresas e ON e.id = o.empresa_id
        JOIN fornecedores f ON f.id = m.fornecedor_id
       WHERE m.id = $1`, [id]);
    if (medCompleta.rows[0]) {
      notificarPendenciaAprovacao({ ...medCompleta.rows[0], status: novoStatus }, db).catch(e =>
        console.warn('[email] Falha ao notificar aprovadores do próximo nível:', e.message)
      );
    }
  }

  // Sincroniza progresso LBM quando atinge aprovação final (sem bloqueio da resposta)
  const isFinalAprov = novoStatus === 'Aprovado' || novoStatus === 'Em Assinatura';
  if (isFinalAprov && med.contrato_id && med.obra_id) {
    _syncLBMFromMedicao(id, med.contrato_id, med.obra_id);   // fire-and-forget intencional
  }

  // ── Notificação email ao fornecedor após aprovação final ────────────────────
  // Dispara apenas quando status vai para "Aprovado" (sem assinatura eletrônica).
  // Quando D4Sign/ClickSign está ativo, status vai para "Em Assinatura" e o e-mail
  // ao fornecedor só será enviado após o webhook confirmar que todos assinaram ("Assinado").
  if (novoStatus === 'Aprovado') {
    (async () => {
      try {
        const medDetalhes = await db.query(`
          SELECT m.id, m.codigo, m.periodo, m.valor_medicao,
                 COALESCE(m.tipo, 'Normal') AS tipo,
                 o.nome         AS obra_nome,
                 e.razao_social AS empresa_nome,
                 c.numero       AS contrato_numero,
                 c.valor_total  AS contrato_valor_total,
                 -- Progresso financeiro: total aprovado/pago no contrato (inclui esta medição)
                 COALESCE((
                   SELECT SUM(m2.valor_medicao)
                     FROM medicoes m2
                    WHERE m2.contrato_id = m.contrato_id
                      AND COALESCE(m2.tipo,'Normal') IN ('Normal','Adiantamento')
                      AND (m2.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                           OR m2.id = m.id)
                 ), 0) AS total_financeiro_aprovado,
                 -- Progresso físico acumulado (recalculado dos itens, inclui esta medição)
                 COALESCE(
                   LEAST(100, ROUND(
                     COALESCE((
                       SELECT SUM(
                         CASE WHEN COALESCE(m2.tipo,'Normal') = 'Normal'
                              THEN mi2.valor_item
                              WHEN COALESCE(m2.tipo,'Normal') = 'Avanco_Fisico'
                              THEN mi2.qtd_mes * mi2.valor_unitario
                              ELSE 0 END
                       )
                         FROM medicao_itens mi2
                         JOIN medicoes m2 ON m2.id = mi2.medicao_id
                        WHERE m2.contrato_id = m.contrato_id
                          AND COALESCE(m2.tipo,'Normal') IN ('Normal','Avanco_Fisico')
                          AND (m2.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                               OR m2.id = m.id)
                     ), 0)
                     / NULLIF(c.valor_total, 0) * 100,
                   2))
                 , 0) AS pct_fisico_acumulado,
                 f.id           AS fornecedor_id,
                 f.razao_social AS fornecedor_nome,
                 f.email        AS fornecedor_email,
                 f.email_nf     AS fornecedor_email_nf
            FROM medicoes m
            JOIN contratos c   ON c.id = m.contrato_id
            JOIN obras o       ON o.id = c.obra_id
            JOIN empresas e    ON e.id = c.empresa_id
            JOIN fornecedores f ON f.id = m.fornecedor_id
           WHERE m.id = $1
        `, [id]);
        if (medDetalhes.rows[0]) {
          // Monta URL do portal: prioridade = config → env → auto-detect pelo header do request
          let portalUrl = process.env.PORTAL_URL || '';
          try {
            const notifCfgR = await db.query("SELECT valor FROM configuracoes WHERE chave='notificacoes'");
            const notifCfg  = notifCfgR.rows[0]?.valor || {};
            if (notifCfg.portalUrl) portalUrl = notifCfg.portalUrl;
          } catch (_) {}
          if (!portalUrl) {
            // Auto-detecta a partir dos headers do request (funciona com ou sem proxy reverso)
            const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
            const host  = req.headers['x-forwarded-host']  || req.headers.host || 'localhost';
            portalUrl   = `${proto}://${host}/portal.html`;
          }
          const enviado = await notificarAprovacaoFornecedor(medDetalhes.rows[0], portalUrl);
          if (enviado) {
            console.log(`[email] Notificação de aprovação enviada ao fornecedor — medicao=${id} status=${novoStatus} portal=${portalUrl}`);
          }
        }
      } catch (e) {
        console.warn('[email] Aviso ao enviar e-mail de aprovação ao fornecedor:', e.message);
      }
    })();
  }

  // Notifica aprovadores anteriores sobre a mudança de status (fire-and-forget)
  notificarAprovadoresStatusChange(id, novoStatus, 'aprovado', nivel, req.user.nome, comentario || '', db)
    .catch(e => console.warn('[email] Falha ao notificar aprovadores sobre mudança de status:', e.message));

  res.json({ ok: true, novoStatus });
});

router.post('/:id/reprovar', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { motivo } = req.body;
  if (!motivo) return res.status(400).json({ error: 'Motivo obrigatório' });
  const m = await db.query('SELECT * FROM medicoes WHERE id=$1', [id]);
  if (!m.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  const lvMap = { 'Aguardando N1': 'N1', 'Aguardando N2': 'N2', 'Aguardando N3': 'N3' };
  const nivel = lvMap[m.rows[0].status];
  if (!nivel) return res.status(400).json({ error: 'Status inválido para reprovação' });
  const permKey = `aprovar${nivel}`;
  if (!await checkPerm(req.user?.grupos || [], req.user?.perfil, permKey))
    return res.status(403).json({ error: `Sem permissão para reprovar nível ${nivel}. Contate o administrador.` });
  await db.query(
    'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
    [id, nivel, 'reprovado', req.user.nome, motivo]
  );
  await db.query("UPDATE medicoes SET status='Reprovado' WHERE id=$1", [id]);
  await audit(req, 'reprovar', 'medicao', id,
    `Medição "${m.rows[0].codigo}" reprovada nível ${nivel}`,
    { nivel, motivo });

  // Notifica aprovadores anteriores sobre a reprovação (fire-and-forget)
  notificarAprovadoresStatusChange(id, 'Reprovado', 'reprovado', nivel, req.user.nome, motivo, db)
    .catch(e => console.warn('[email] Falha ao notificar aprovadores sobre reprovação:', e.message));

  res.json({ ok: true });
});

// ── Marcar como Assinado manualmente (bypass D4Sign) ─────────────
// Útil quando D4Sign estiver desabilitado ou documento assinado fora do sistema

router.post('/:id/marcar-assinado', auth, perm('enviarAssinatura'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const m  = await db.query('SELECT * FROM medicoes WHERE id=$1', [id]);
    if (!m.rows[0]) return res.status(404).json({ error: 'Medição não encontrada.' });
    if (m.rows[0].status !== 'Em Assinatura') {
      return res.status(422).json({
        error: `Apenas medições com status "Em Assinatura" podem ser marcadas como assinadas manualmente. Status atual: "${m.rows[0].status}".`,
      });
    }

    await db.query("UPDATE medicoes SET status='Assinado' WHERE id=$1", [id]);
    await db.query(
      `INSERT INTO aprovacoes(medicao_id, nivel, acao, usuario, comentario)
       VALUES ($1, 'Sistema', 'assinado', $2, 'Documento marcado como assinado manualmente (sem D4Sign).')`,
      [id, req.user.nome]
    );
    await audit(req, 'marcar_assinado', 'medicao', id,
      `Medição "${m.rows[0].codigo}" marcada como Assinada manualmente por ${req.user.nome}`);

    res.json({ ok: true, novoStatus: 'Assinado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Reabrir medição reprovada ─────────────────────────────────────
// Retorna do status Reprovado para Rascunho para o fornecedor poder corrigir e reenviar

router.post('/:id/reabrir', auth, perm('criarMedicao'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const m  = await db.query('SELECT * FROM medicoes WHERE id=$1', [id]);
    if (!m.rows[0]) return res.status(404).json({ error: 'Medição não encontrada.' });
    if (m.rows[0].status !== 'Reprovado') {
      return res.status(422).json({
        error: `Apenas medições "Reprovadas" podem ser reabertas. Status atual: "${m.rows[0].status}".`,
      });
    }

    await db.query("UPDATE medicoes SET status='Rascunho' WHERE id=$1", [id]);
    await db.query(
      `INSERT INTO aprovacoes(medicao_id, nivel, acao, usuario, comentario)
       VALUES ($1, 'Sistema', 'reaberto', $2, 'Medição reaberta para correção.')`,
      [id, req.user.nome]
    );
    await audit(req, 'reabrir', 'medicao', id,
      `Medição "${m.rows[0].codigo}" reaberta (Reprovado → Rascunho) por ${req.user.nome}`);

    res.json({ ok: true, novoStatus: 'Rascunho' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Enviar para assinatura ────────────────────────────────────────

router.post('/:id/enviar-assinatura', auth, perm('enviarAssinatura'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      email_fornecedor, tel_fornecedor, email_remetente, canais = ['email'],
      cpf_fornecedor, data_nasc_fornecedor,   // dados do representante do fornecedor
      cpf_remetente,  data_nasc_remetente,    // dados do remetente (usuário logado)
    } = req.body;
    const viaEmail    = canais.includes('email');
    const viaWhatsapp = canais.includes('whatsapp');
    if (!viaEmail && !viaWhatsapp)
      return res.status(400).json({ error: 'Selecione ao menos um canal de envio (email ou whatsapp)' });
    // E-mail sempre obrigatório — ClickSign usa como identificador único do signatário
    if (!email_fornecedor) return res.status(400).json({ error: 'E-mail do fornecedor é obrigatório para identificar o signatário no provedor de assinatura.' });
    if (viaWhatsapp && !tel_fornecedor) return res.status(400).json({ error: 'Telefone do fornecedor é obrigatório para envio por WhatsApp' });

    // ── Busca dados da medição ───────────────────────────────────
    const r = await db.query(`
      SELECT m.*, e.razao_social AS empresa_nome, o.nome AS obra_nome,
             f.razao_social AS fornecedor_nome, f.representante AS fornecedor_rep,
             f.cpf_representante AS fornecedor_cpf,
             f.data_nasc_representante AS fornecedor_data_nasc,
             c.numero AS contrato_numero
      FROM medicoes m
      LEFT JOIN empresas     e ON e.id = m.empresa_id
      LEFT JOIN obras        o ON o.id = m.obra_id
      LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
      LEFT JOIN contratos    c ON c.id = m.contrato_id
      WHERE m.id = $1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Medição não encontrada' });
    const med = r.rows[0];
    if (med.tipo === 'Avanco_Fisico')
      return res.status(400).json({ error: 'Medição de Avanço Físico não gera Nota Fiscal nem requer assinatura.' });
    if (!['Aprovado','Em Assinatura'].includes(med.status))
      return res.status(400).json({ error: 'Medição não está aprovada' });

    // ── Helpers de formatação ───────────────────────────────────
    const fmt    = (v) => parseFloat(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtQtd = (v, un) => `${parseFloat(v||0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${un}`;
    const periodoLabel = (p) => {
      if (!p) return '—';
      const [y, m] = p.split('-');
      const meses = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${meses[parseInt(m)]}/${y}`;
    };

    // ── Monta texto do documento ────────────────────────────────
    const itensR = await db.query(
      'SELECT * FROM medicao_itens WHERE medicao_id=$1 ORDER BY ordem,id', [id]
    );
    const itens = itensR.rows;
    const itensTexto = itens.length
      ? itens.map((it, i) => [
          `  ${i+1}. ${it.descricao}`,
          `     Unidade: ${it.unidade} | Qtd Contratada: ${fmtQtd(it.qtd_contrato, it.unidade)}`,
          `     Anterior: ${fmtQtd(it.qtd_anterior, it.unidade)} | Este mês: ${fmtQtd(it.qtd_mes, it.unidade)} | Acumulado: ${fmtQtd(it.qtd_acumulada, it.unidade)}`,
          `     Valor Unit.: R$ ${fmt(it.valor_unitario)} | Valor do Item: R$ ${fmt(it.valor_item)}`,
        ].join('\n')).join('\n\n')
      : '  Conforme contrato vigente.';

    const linhasDoc = [
      `AUTORIZAÇÃO DE EMISSÃO DE NOTA FISCAL`,
      `${'='.repeat(58)}`,
      ``,
      `Empresa          : ${med.empresa_nome || '—'}`,
      `Obra             : ${med.obra_nome || '—'}`,
      `Fornecedor       : ${med.fornecedor_nome || '—'}`,
      `Contrato         : ${med.contrato_numero || '—'}`,
      `Código Medição   : ${med.codigo}`,
      `Período          : ${periodoLabel(med.periodo)}`,
      ``,
      `ITENS MEDIDOS NESTE PERÍODO`,
      `${'-'.repeat(58)}`,
      itensTexto,
      `${'-'.repeat(58)}`,
      ``,
      `VALOR AUTORIZADO PARA EMISSÃO DA NOTA FISCAL`,
      `Valor desta medição : R$ ${fmt(med.valor_medicao)}`,
      `Valor acumulado     : R$ ${fmt(med.valor_acumulado)}`,
      ``,
      `SERVIÇOS / OBSERVAÇÕES`,
      med.descricao || 'Conforme contrato vigente.',
      ``,
      `${'='.repeat(58)}`,
      `IMPORTANTE`,
      `A Nota Fiscal deverá ser emitida no valor de`,
      `R$ ${fmt(med.valor_medicao)} e incluir obrigatoriamente`,
      `o código ${med.codigo} no campo`,
      `"Observações / Dados Adicionais" da NF.`,
      `${'='.repeat(58)}`,
      ``,
      `Autorizado por : ${req.user.nome}`,
      `Data           : ${new Date().toLocaleDateString('pt-BR')}`,
    ];
    const docTexto = linhasDoc.join('\n');

    // ── Carrega configuração de assinatura ──────────────────────
    const cfgR = await db.query("SELECT valor FROM configuracoes WHERE chave='assinatura'");
    const cfgAssin = cfgR.rows[0]?.valor || {};

    let novoStatus = 'Em Assinatura';
    let destinatario = email_fornecedor;
    let clicksignKey = null;

    // ── Integração ClickSign (se configurado) ───────────────────
    if (cfgAssin.provedor === 'ClickSign' && cfgAssin.accessToken) {
      try {
        const PDFDocument = require('pdfkit');
        const clicksign   = require('../helpers/clicksign');

        // Gera PDF em memória
        const pdfBuffer = await new Promise((resolve, reject) => {
          const doc  = new PDFDocument({ margin: 50, size: 'A4', info: { Title: `Autorização NF — ${med.codigo}` } });
          const bufs = [];
          doc.on('data', c => bufs.push(c));
          doc.on('end',  () => resolve(Buffer.concat(bufs)));
          doc.on('error', reject);

          // Cabeçalho
          doc.font('Helvetica-Bold').fontSize(13).text('AUTORIZAÇÃO DE EMISSÃO DE NOTA FISCAL', { align: 'center' });
          doc.moveDown(0.3);
          doc.font('Helvetica').fontSize(9).text('='.repeat(80), { align: 'center' });
          doc.moveDown(0.8);

          // Dados
          const campos = [
            ['Empresa',         med.empresa_nome || '—'],
            ['Obra',            med.obra_nome    || '—'],
            ['Fornecedor',      med.fornecedor_nome || '—'],
            ['Contrato',        med.contrato_numero || '—'],
            ['Código Medição',  med.codigo],
            ['Período',         periodoLabel(med.periodo)],
          ];
          doc.font('Helvetica').fontSize(10);
          campos.forEach(([k, v]) => {
            doc.font('Helvetica-Bold').text(`${k}: `, { continued: true });
            doc.font('Helvetica').text(v);
          });

          // Itens
          if (itens.length) {
            doc.moveDown(0.8);
            doc.font('Helvetica-Bold').fontSize(10).text('ITENS MEDIDOS NESTE PERÍODO');
            doc.font('Helvetica').fontSize(9).text('-'.repeat(80));
            itens.forEach((it, i) => {
              doc.moveDown(0.3);
              doc.font('Helvetica-Bold').text(`${i+1}. ${it.descricao}`, { indent: 10 });
              doc.font('Helvetica').text(
                `Unidade: ${it.unidade}  |  Qtd Mês: ${fmtQtd(it.qtd_mes, it.unidade)}  |  Acumulado: ${fmtQtd(it.qtd_acumulada, it.unidade)}  |  Valor Item: R$ ${fmt(it.valor_item)}`,
                { indent: 20 }
              );
            });
          }

          // Valores e rodapé
          doc.moveDown(0.8);
          doc.font('Helvetica-Bold').fontSize(11).text(`Valor desta medição: R$ ${fmt(med.valor_medicao)}`);
          doc.font('Helvetica').fontSize(10).text(`Valor acumulado    : R$ ${fmt(med.valor_acumulado)}`);
          doc.moveDown(0.5);
          if (med.descricao) {
            doc.font('Helvetica-Bold').text('Observações:');
            doc.font('Helvetica').text(med.descricao);
            doc.moveDown(0.5);
          }
          doc.font('Helvetica').fontSize(9).text('='.repeat(80));
          doc.font('Helvetica-Bold').fontSize(9).text('IMPORTANTE: ', { continued: true });
          doc.font('Helvetica').text(
            `A Nota Fiscal deverá ser emitida no valor de R$ ${fmt(med.valor_medicao)} ` +
            `e incluir obrigatoriamente o código ${med.codigo} no campo "Observações / Dados Adicionais" da NF.`
          );
          doc.moveDown(1);
          doc.font('Helvetica').fontSize(9)
            .text(`Autorizado por: ${req.user.nome}   |   Data: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'right' });
          doc.end();
        });

        const baseUrl  = cfgAssin.ambiente === 'producao'
          ? 'https://app.clicksign.com'
          : 'https://sandbox.clicksign.com';
        const docPath  = `/CONSTRUTIVO/medicao-${med.codigo}-${Date.now()}.pdf`;
        const pdfB64   = pdfBuffer.toString('base64');

        // Define auths conforme canal selecionado
        const auths = [];
        if (viaEmail)    auths.push('email');
        if (viaWhatsapp) auths.push('whatsapp');

        const result = await clicksign.enviarParaAssinatura(
          { accessToken: cfgAssin.accessToken, baseUrl },
          {
            pdfBase64:    pdfB64,
            docPath,
            // Signatário 1 — fornecedor (quem deve assinar)
            signerEmail:    email_fornecedor || undefined,
            signerPhone:    tel_fornecedor   || undefined,
            signerName:     med.fornecedor_rep || med.fornecedor_nome || 'Representante',
            auths,
            // CPF e data de nascimento do fornecedor (do cadastro ou informado no modal)
            signerCpf:      cpf_fornecedor      || med.fornecedor_cpf      || undefined,
            signerBirthday: data_nasc_fornecedor|| (med.fornecedor_data_nasc ? med.fornecedor_data_nasc.toISOString?.().slice(0,10) : undefined) || undefined,
            // Signatário 2 — remetente/empresa (recebe cópia da notificação)
            signerEmail2:    email_remetente  || undefined,
            signerName2:     req.user.nome    || 'Responsável Empresa',
            signerCpf2:      cpf_remetente    || undefined,
            signerBirthday2: data_nasc_remetente || undefined,
            message:      `Prezado(a), por favor assine a Autorização de Emissão de Nota Fiscal referente à medição ${med.codigo} da obra ${med.obra_nome}. Valor: R$ ${fmt(med.valor_medicao)}.`,
          }
        );
        clicksignKey = result.documentKey;
        novoStatus   = 'Em Assinatura';
        // A chave do ClickSign e o ambiente são registrados no histórico de aprovacoes abaixo
        const ambienteLabel = baseUrl.includes('sandbox') ? 'sandbox' : 'produção';
        console.log(`[enviar-assinatura] ClickSign ${ambienteLabel} | doc=${clicksignKey} | forn=${email_fornecedor} | rem=${email_remetente||'—'} | RSK=${result.requestSignatureKey}`);

      } catch (csErr) {
        console.error('[ClickSign] ERRO COMPLETO:', csErr.message);
        console.error('[ClickSign] Stack:', csErr.stack);
        return res.status(502).json({ error: 'Falha ao enviar para ClickSign: ' + csErr.message });
      }
    }

    // ── Integração D4Sign (se configurado) ─────────────────────
    let d4signDocUuid = null;
    if (cfgAssin.provedor === 'D4Sign' && cfgAssin.d4ApiKey) {
      try {
        const PDFDocument = require('pdfkit');
        const d4sign      = require('../helpers/d4sign');

        // Gera PDF em memória (mesmo layout do ClickSign)
        const pdfBuffer = await new Promise((resolve, reject) => {
          const doc  = new PDFDocument({ margin: 50, size: 'A4', info: { Title: `Autorização NF — ${med.codigo}` } });
          const bufs = [];
          doc.on('data', c => bufs.push(c));
          doc.on('end',  () => resolve(Buffer.concat(bufs)));
          doc.on('error', reject);

          doc.font('Helvetica-Bold').fontSize(13).text('AUTORIZAÇÃO DE EMISSÃO DE NOTA FISCAL', { align: 'center' });
          doc.moveDown(0.3);
          doc.font('Helvetica').fontSize(9).text('='.repeat(80), { align: 'center' });
          doc.moveDown(0.8);

          const campos = [
            ['Empresa',        med.empresa_nome    || '—'],
            ['Obra',           med.obra_nome        || '—'],
            ['Fornecedor',     med.fornecedor_nome  || '—'],
            ['Contrato',       med.contrato_numero  || '—'],
            ['Código Medição', med.codigo],
            ['Período',        periodoLabel(med.periodo)],
          ];
          doc.font('Helvetica').fontSize(10);
          campos.forEach(([k, v]) => {
            doc.font('Helvetica-Bold').text(`${k}: `, { continued: true });
            doc.font('Helvetica').text(v);
          });

          if (itens.length) {
            doc.moveDown(0.8);
            doc.font('Helvetica-Bold').fontSize(10).text('ITENS MEDIDOS NESTE PERÍODO');
            doc.font('Helvetica').fontSize(9).text('-'.repeat(80));
            itens.forEach((it, i) => {
              doc.moveDown(0.3);
              doc.font('Helvetica-Bold').text(`${i+1}. ${it.descricao}`, { indent: 10 });
              doc.font('Helvetica').text(
                `Unidade: ${it.unidade}  |  Qtd Mês: ${fmtQtd(it.qtd_mes, it.unidade)}  |  Acumulado: ${fmtQtd(it.qtd_acumulada, it.unidade)}  |  Valor Item: R$ ${fmt(it.valor_item)}`,
                { indent: 20 }
              );
            });
          }

          doc.moveDown(0.8);
          doc.font('Helvetica-Bold').fontSize(11).text(`Valor desta medição: R$ ${fmt(med.valor_medicao)}`);
          doc.font('Helvetica').fontSize(10).text(`Valor acumulado    : R$ ${fmt(med.valor_acumulado)}`);
          doc.moveDown(0.5);
          if (med.descricao) {
            doc.font('Helvetica-Bold').text('Observações:');
            doc.font('Helvetica').text(med.descricao);
            doc.moveDown(0.5);
          }
          doc.font('Helvetica').fontSize(9).text('='.repeat(80));
          doc.font('Helvetica-Bold').fontSize(9).text('IMPORTANTE: ', { continued: true });
          doc.font('Helvetica').text(
            `A Nota Fiscal deverá ser emitida no valor de R$ ${fmt(med.valor_medicao)} ` +
            `e incluir obrigatoriamente o código ${med.codigo} no campo "Observações / Dados Adicionais" da NF.`
          );
          doc.moveDown(1);
          doc.font('Helvetica').fontSize(9)
            .text(`Autorizado por: ${req.user.nome}   |   Data: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'right' });
          doc.end();
        });

        const filename = `medicao-${med.codigo}-${Date.now()}.pdf`;
        const result   = await d4sign.enviarParaAssinatura(cfgAssin, {
          pdfBuffer,
          filename,
          signerEmail:      email_fornecedor,
          signerName:       med.fornecedor_rep || med.fornecedor_nome || 'Representante',
          signerWhatsapp:   tel_fornecedor     || undefined,
          signerEmail2:     email_remetente    || undefined,
          signerName2:      req.user.nome      || 'Responsável Empresa',
          message: `Prezado(a), por favor assine a Autorização de Emissão de Nota Fiscal referente à medição ${med.codigo} da obra ${med.obra_nome}. Valor: R$ ${fmt(med.valor_medicao)}.`,
        });

        d4signDocUuid = result.docUuid;
        novoStatus    = 'Em Assinatura';
        console.log(`[enviar-assinatura] D4Sign | doc=${d4signDocUuid} | forn=${email_fornecedor} | rem=${email_remetente||'—'}`);

      } catch (d4Err) {
        console.error('[D4Sign] ERRO COMPLETO:', d4Err.message);
        console.error('[D4Sign] Stack:', d4Err.stack);
        return res.status(502).json({ error: 'Falha ao enviar para D4Sign: ' + d4Err.message });
      }
    }

    // ── Atualiza status e registra histórico ────────────────────
    if (med.status === 'Aprovado') {
      if (d4signDocUuid) {
        await db.query(
          "UPDATE medicoes SET status=$1, d4sign_doc_uuid=$2 WHERE id=$3",
          [novoStatus, d4signDocUuid, id]
        );
      } else {
        await db.query("UPDATE medicoes SET status=$1 WHERE id=$2", [novoStatus, id]);
      }
    }
    const ambLabel = cfgAssin.provedor === 'ClickSign'
      ? ` [${(cfgAssin.ambiente === 'producao' ? 'PRODUÇÃO' : 'SANDBOX — emails não são reais')}]`
      : '';
    await db.query(
      'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
      [id, 'Sistema', 'lançado', req.user.nome,
       `Documento enviado para assinatura (${cfgAssin.provedor || 'manual'})${ambLabel}` +
       ` — Fornecedor: ${email_fornecedor}` +
       (tel_fornecedor ? ` / WhatsApp: ${tel_fornecedor}` : '') +
       (email_remetente ? ` — Cópia/Remetente: ${email_remetente}` : '') +
       (clicksignKey    ? ` | ClickSign doc: ${clicksignKey}` : '') +
       (d4signDocUuid   ? ` | D4Sign doc: ${d4signDocUuid}` : '')]
    );

    await audit(req, 'enviar_assinatura', 'medicao', id,
      `Medição "${med.codigo}" enviada para assinatura — ${email_fornecedor}`,
      { novoStatus, provedor: cfgAssin.provedor || 'manual' });
    res.json({
      ok:           true,
      novoStatus,
      docTexto,
      destinatario,
      clicksignKey,
      provedor: cfgAssin.provedor || 'manual',
    });
  } catch (e) {
    console.error('[enviar-assinatura]', e);
    res.status(500).json({ error: e.message || 'Erro interno' });
  }
});

// ── Upload de evidências ──────────────────────────────────────────
// POST /api/medicoes/:id/evidencias   multipart: files[] (máx 20 arquivos · 50 MB cada)
router.post('/:id/evidencias', auth, perm('criarMedicao'), upload.array('files', 20), async (req, res) => {
  const medicaoId = parseInt(req.params.id);
  if (!medicaoId) return res.status(400).json({ error: 'ID inválido' });

  // Verifica que a medição existe e está em Rascunho (evidências só podem ser alteradas antes de enviar para aprovação)
  const mCheck = await db.query('SELECT id, status FROM medicoes WHERE id=$1', [medicaoId]);
  if (!mCheck.rows.length) return res.status(404).json({ error: 'Medição não encontrada' });
  if (mCheck.rows[0].status !== 'Rascunho')
    return res.status(422).json({ error: `Não é possível adicionar evidências a uma medição com status "${mCheck.rows[0].status}". Apenas medições em Rascunho podem ser alteradas.` });

  const inserted = [];
  for (const file of req.files || []) {
    const ext  = path.extname(file.originalname).toLowerCase();
    const tipo = ['.jpg','.jpeg','.png','.gif','.webp','.heic'].includes(ext) ? 'img'
               : ['.pdf'].includes(ext) ? 'pdf'
               : ['.mp4','.mov','.avi','.mkv','.webm'].includes(ext) ? 'video'
               : 'doc';

    // Envia para o provider configurado (S3 / GDrive / local)
    let result = { provider: 'local', caminho: file.filename, url_storage: null };
    try {
      result = await storageHelper.uploadFile(file.path, file.originalname, file.mimetype);
    } catch (e) {
      console.error('[evidencias upload] storage error:', e.message);
    }

    // Se foi para S3 ou GDrive, remove o arquivo temporário local
    if (result.provider !== 'local') {
      try { require('fs').unlinkSync(file.path); } catch {}
    }

    const tamanho = file.size < 1024 * 1024
      ? `${(file.size / 1024).toFixed(0)} KB`
      : `${(file.size / 1024 / 1024).toFixed(1)} MB`;

    const r = await db.query(
      `INSERT INTO evidencias(medicao_id, nome, tipo, tamanho, caminho, provider, url_storage, enviado_por)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [medicaoId, file.originalname, tipo, tamanho,
       result.caminho, result.provider, result.url_storage,
       req.user?.login || req.user?.nome || 'sistema']
    );

    // Adiciona URL de visualização (signed URL para S3 privado)
    const ev = r.rows[0];
    ev.url_view = await storageHelper.getViewUrl(ev);
    inserted.push(ev);
  }

  await audit(req, 'upload_evidencia', 'medicao', medicaoId,
    `${inserted.length} arquivo(s) anexado(s) à medição #${medicaoId}`);

  res.status(201).json(inserted);
});

// ── Listagem de evidências com URL de visualização ────────────────
// GET /api/medicoes/:id/evidencias
router.get('/:id/evidencias', auth, async (req, res) => {
  try {
    const medicaoId = parseInt(req.params.id);
    const evs = await db.query('SELECT * FROM evidencias WHERE medicao_id=$1 ORDER BY criado_em', [medicaoId]);
    const rows = await Promise.all(evs.rows.map(async ev => ({
      ...ev,
      url_view: await storageHelper.getViewUrl(ev),
    })));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Remove evidência ──────────────────────────────────────────────
// DELETE /api/medicoes/:id/evidencias/:evId
router.delete('/:id/evidencias/:evId', auth, perm('criarMedicao'), async (req, res) => {
  try {
    const medicaoId = parseInt(req.params.id);
    const evId      = parseInt(req.params.evId);

    // Só permite remoção enquanto a medição está em Rascunho
    const mCheck = await db.query('SELECT status FROM medicoes WHERE id=$1', [medicaoId]);
    if (!mCheck.rows.length) return res.status(404).json({ error: 'Medição não encontrada' });
    if (mCheck.rows[0].status !== 'Rascunho')
      return res.status(422).json({ error: `Não é possível remover evidências de uma medição com status "${mCheck.rows[0].status}".` });

    const r = await db.query(
      'SELECT * FROM evidencias WHERE id=$1 AND medicao_id=$2', [evId, medicaoId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Evidência não encontrada' });

    const ev = r.rows[0];

    // Remove do storage (S3 / GDrive / local)
    await storageHelper.deleteFile(ev);

    await db.query('DELETE FROM evidencias WHERE id=$1', [evId]);
    await audit(req, 'excluir_evidencia', 'medicao', medicaoId,
      `Evidência "${ev.nome}" removida da medição #${medicaoId}`);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
