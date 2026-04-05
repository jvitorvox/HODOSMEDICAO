/**
 * HAMOA OBRAS — Rotas de Contratos
 * GET    /api/contratos[?obra_id=&fornecedor_id=&disponivel=1]
 * GET    /api/contratos/:id/itens
 * GET    /api/contratos/:id/acumulados
 * POST   /api/contratos
 * PUT    /api/contratos/:id
 * DELETE /api/contratos/:id
 * POST   /api/contratos/interpretar  (IA: extrai planilha + metadados + fornecedor)
 */
const router  = require('express').Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const { perm } = require('../middleware/perm');
const { uploadMem, _iaGetKey, _iaFileToParts, _iaCall, _parseDate } = require('../helpers/ia');

// ── Helper interno: salva itens de contrato (delete + re-insert) ──
async function _saveContratoItens(client, contrato_id, itens) {
  await client.query('DELETE FROM contrato_itens WHERE contrato_id=$1', [contrato_id]);
  const arr = Array.isArray(itens) ? itens : [];
  for (let i = 0; i < arr.length; i++) {
    const it   = arr[i];
    const qtd  = parseFloat(it.qtd_total)      || 0;
    const vun  = parseFloat(it.valor_unitario) || 0;
    const vtot = parseFloat((qtd * vun).toFixed(2));
    await client.query(
      `INSERT INTO contrato_itens(contrato_id,ordem,descricao,unidade,qtd_total,valor_unitario,valor_total)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [contrato_id, i, it.descricao, it.unidade || 'un', qtd, vun, vtot]
    );
  }
  // Recalcula valor_total do contrato a partir dos itens
  if (arr.length) {
    const sum = arr.reduce((s, it) =>
      s + (parseFloat(it.qtd_total)||0) * (parseFloat(it.valor_unitario)||0), 0
    );
    await client.query('UPDATE contratos SET valor_total=$1 WHERE id=$2',
      [parseFloat(sum.toFixed(2)), contrato_id]);
  }
}

// ── Listagem com filtros ─────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  const baseQ = `
    SELECT c.*, o.nome AS obra_nome,
      COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) AS fornecedor_nome,
      COALESCE(NULLIF(e.nome_fantasia,''), e.razao_social) AS empresa_nome,
      COALESCE(ex.valor_executado, 0)::NUMERIC(15,2) AS valor_executado_real,
      CASE WHEN c.valor_total > 0
           THEN LEAST(100, ROUND(COALESCE(ex.valor_executado,0) / c.valor_total * 100, 2))
           ELSE 0 END AS pct_executado_real,
      -- ── Dados de adiantamento e descompasso financeiro-físico ──────────────
      COALESCE(adt.total_adiantado, 0)::NUMERIC(15,2)   AS total_adiantado,
      COALESCE(adt.total_financeiro, 0)::NUMERIC(15,2)  AS total_financeiro_pago,
      -- Valor físico executado (Normal + AvFis, baseado em itens)
      COALESCE(phys.valor_fisico, 0)::NUMERIC(15,2)     AS valor_fisico_executado,
      -- % físico = valor_fisico / valor_total × 100
      CASE WHEN c.valor_total > 0
           THEN LEAST(100, ROUND(COALESCE(phys.valor_fisico,0) / c.valor_total * 100, 2))
           ELSE 0 END::NUMERIC(5,2)                     AS pct_fisico_executado,
      -- Descompasso = financeiro pago - valor físico executado
      CASE WHEN c.valor_total > 0
           THEN ROUND(
             COALESCE(adt.total_financeiro, 0)
             - COALESCE(phys.valor_fisico, 0),
           2)
           ELSE 0 END::NUMERIC(15,2) AS descompasso
    FROM contratos c
    JOIN obras        o ON c.obra_id       = o.id
    JOIN fornecedores f ON c.fornecedor_id = f.id
    JOIN empresas     e ON c.empresa_id    = e.id
    LEFT JOIN (
      -- Valor financeiro pago em medições Normais (para pct_executado_real)
      SELECT m.contrato_id, SUM(mi.valor_item) AS valor_executado
      FROM medicao_itens mi
      JOIN medicoes m ON m.id = mi.medicao_id
      WHERE m.status NOT IN ('Rascunho','Reprovado')
        AND COALESCE(m.tipo,'Normal') = 'Normal'
      GROUP BY m.contrato_id
    ) ex ON ex.contrato_id = c.id
    LEFT JOIN (
      -- Totais financeiros (Normal + Adiantamento)
      SELECT
        m.contrato_id,
        SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Adiantamento'
                      AND m.status NOT IN ('Rascunho','Reprovado')
                 THEN m.valor_medicao ELSE 0 END) AS total_adiantado,
        SUM(CASE WHEN COALESCE(m.tipo,'Normal') IN ('Normal','Adiantamento')
                      AND m.status NOT IN ('Rascunho','Reprovado')
                 THEN m.valor_medicao ELSE 0 END) AS total_financeiro
      FROM medicoes m
      GROUP BY m.contrato_id
    ) adt ON adt.contrato_id = c.id
    LEFT JOIN (
      -- Valor físico executado calculado direto dos itens (independe de unidade %)
      -- Normal:       usa valor_item (qtd_mes × valor_unitario)
      -- Avanco_Fisico: usa qtd_mes × valor_unitario (armazenado do contrato_itens)
      SELECT m.contrato_id,
        SUM(
          CASE WHEN COALESCE(m.tipo,'Normal') = 'Normal'        THEN mi.valor_item
               WHEN COALESCE(m.tipo,'Normal') = 'Avanco_Fisico' THEN mi.qtd_mes * mi.valor_unitario
               ELSE 0 END
        ) AS valor_fisico
      FROM medicoes m
      JOIN medicao_itens mi ON mi.medicao_id = m.id
      WHERE m.status NOT IN ('Rascunho','Reprovado')
        AND COALESCE(m.tipo,'Normal') IN ('Normal','Avanco_Fisico')
      GROUP BY m.contrato_id
    ) phys ON phys.contrato_id = c.id`;

  const params     = [];
  const conditions = [];
  if (req.query.obra_id)       { params.push(req.query.obra_id);       conditions.push(`c.obra_id=$${params.length}`); }
  if (req.query.fornecedor_id) { params.push(req.query.fornecedor_id); conditions.push(`c.fornecedor_id=$${params.length}`); }
  if (req.query.disponivel === '1') {
    conditions.push(`c.status = 'Vigente'`);
    conditions.push(`(c.valor_total = 0 OR COALESCE(ex.valor_executado,0) < c.valor_total)`);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  res.json((await db.query(baseQ + where + ' ORDER BY c.numero', params)).rows);
});

// ── Itens de um contrato ─────────────────────────────────────────

router.get('/:id/itens', auth, async (req, res) => {
  const r = await db.query(
    'SELECT * FROM contrato_itens WHERE contrato_id=$1 ORDER BY ordem,id',
    [req.params.id]
  );
  res.json(r.rows);
});

// ── Acumulados (saldo por item para pré-preenchimento de medição) ─

router.get('/:id/acumulados', auth, async (req, res) => {
  const contId = req.params.id;
  const contR  = await db.query('SELECT * FROM contratos WHERE id=$1', [contId]);
  if (!contR.rows[0]) return res.status(404).json({ error: 'Contrato não encontrado' });
  const cont = contR.rows[0];

  const itensR = await db.query(
    'SELECT * FROM contrato_itens WHERE contrato_id=$1 ORDER BY ordem,id', [contId]
  );

  // Acumula quantidades separadas por tipo para cálculo correto de saldos:
  // qtd_normal  = medições Normal (físico+financeiro)
  // qtd_adt     = adiantamentos (financeiro apenas, físico pendente)
  // qtd_avfis   = avanço físico (confirma fisicamente os adiantamentos)
  const acumR = await db.query(`
    SELECT
      mi.contrato_item_id,
      SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Normal'        THEN mi.qtd_mes ELSE 0 END) AS qtd_normal,
      SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Adiantamento'  THEN mi.qtd_mes ELSE 0 END) AS qtd_adt,
      SUM(CASE WHEN COALESCE(m.tipo,'Normal') = 'Avanco_Fisico' THEN mi.qtd_mes ELSE 0 END) AS qtd_avfis,
      SUM(CASE WHEN COALESCE(m.tipo,'Normal') IN ('Normal','Adiantamento') THEN mi.valor_item ELSE 0 END) AS valor_financeiro
    FROM medicao_itens mi
    JOIN medicoes m ON m.id = mi.medicao_id
    WHERE m.contrato_id = $1
      AND m.status NOT IN ('Rascunho','Reprovado')
      AND mi.contrato_item_id IS NOT NULL
    GROUP BY mi.contrato_item_id
  `, [contId]);

  const acumMap = {};
  acumR.rows.forEach(r => {
    acumMap[r.contrato_item_id] = {
      qtd_normal:  parseFloat(r.qtd_normal)  || 0,
      qtd_adt:     parseFloat(r.qtd_adt)     || 0,
      qtd_avfis:   parseFloat(r.qtd_avfis)   || 0,
      valor_financeiro: parseFloat(r.valor_financeiro) || 0,
    };
  });

  const itens = itensR.rows.map(ci => {
    const a      = acumMap[ci.id] || { qtd_normal: 0, qtd_adt: 0, qtd_avfis: 0, valor_financeiro: 0 };
    const qtdTot = parseFloat(ci.qtd_total) || 0;
    // Saldo para nova Normal ou novo Adiantamento = qtd_total - Normal - Adt (ambos consomem financeiro)
    const qtdSaldoFinanceiro = Math.max(0, parseFloat((qtdTot - a.qtd_normal - a.qtd_adt).toFixed(4)));
    // Saldo ADT pendente de confirmação física = Adt - AvFis
    const qtdSaldoAdtPendente = Math.max(0, parseFloat((a.qtd_adt - a.qtd_avfis).toFixed(4)));
    // Quantidade acumulada financeira (para exibição)
    const qtdAcumFinanceiro = a.qtd_normal + a.qtd_adt;
    // % físico executado = Normal + AvFis
    const qtdFisicoExec = a.qtd_normal + a.qtd_avfis;
    const pctExec = qtdTot > 0
      ? parseFloat(Math.min(100, (qtdFisicoExec / qtdTot) * 100).toFixed(2))
      : 0;
    return {
      id:                    ci.id,
      ordem:                 ci.ordem,
      descricao:             ci.descricao,
      unidade:               ci.unidade,
      qtd_total:             qtdTot,
      valor_unitario:        parseFloat(ci.valor_unitario) || 0,
      valor_total:           parseFloat(ci.valor_total)    || 0,
      // Campos separados por tipo
      qtd_normal:            a.qtd_normal,
      qtd_adt:               a.qtd_adt,
      qtd_avfis:             a.qtd_avfis,
      // Compatibilidade legada (usa saldo financeiro como "acumulada")
      qtd_acumulada:         qtdAcumFinanceiro,
      qtd_saldo:             qtdSaldoFinanceiro,
      qtd_saldo_adt_pendente: qtdSaldoAdtPendente,
      pct_executado:         pctExec,
      valor_acumulado:       a.valor_financeiro,
    };
  });

  const totalValCont = itens.reduce((s, i) => s + i.valor_total, 0);
  const totalValAcum = itens.reduce((s, i) => s + i.valor_acumulado, 0);
  const pctGeral     = totalValCont > 0
    ? parseFloat(Math.min(100, (totalValAcum / totalValCont) * 100).toFixed(2))
    : parseFloat(cont.pct_executado) || 0;

  res.json({
    contrato_id:   parseInt(contId),
    valor_total:   parseFloat(cont.valor_total) || 0,
    pct_executado: pctGeral,
    itens,
  });
});

// ── CRUD ────────────────────────────────────────────────────────
const audit = require('../middleware/audit');

router.post('/', auth, perm('cadastros'), async (req, res) => {
  const { empresa_id, obra_id, fornecedor_id, numero, objeto,
          valor_total, inicio, termino, status, obs, itens } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO contratos
         (empresa_id,obra_id,fornecedor_id,numero,objeto,valor_total,inicio,termino,status,obs)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [empresa_id, obra_id, fornecedor_id, numero, objeto,
       valor_total||0, inicio||null, termino||null, status||'Vigente', obs||null]
    );
    if (Array.isArray(itens) && itens.length) {
      await _saveContratoItens(client, r.rows[0].id, itens);
    }
    await client.query('COMMIT');
    const row = r.rows[0];
    await audit(req, 'criar', 'contrato', row.id,
      `Contrato "${row.numero}" criado — valor: R$ ${Number(row.valor_total).toLocaleString('pt-BR',{minimumFractionDigits:2})}`);
    res.status(201).json(row);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.put('/:id', auth, perm('cadastros'), async (req, res) => {
  const { empresa_id, obra_id, fornecedor_id, numero, objeto, valor_total,
          pct_executado, inicio, termino, status, obs, itens } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE contratos SET
         empresa_id=$1,obra_id=$2,fornecedor_id=$3,numero=$4,objeto=$5,
         valor_total=$6,pct_executado=$7,inicio=$8,termino=$9,status=$10,obs=$11
       WHERE id=$12 RETURNING *`,
      [empresa_id, obra_id, fornecedor_id, numero, objeto,
       valor_total||0, pct_executado||0, inicio||null, termino||null, status, obs||null, req.params.id]
    );
    if (Array.isArray(itens)) {
      await _saveContratoItens(client, req.params.id, itens);
    }
    await client.query('COMMIT');
    const row = r.rows[0];
    await audit(req, 'editar', 'contrato', row.id,
      `Contrato "${row.numero}" atualizado — status: ${row.status}`);
    res.json(row);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/:id', auth, perm('cadastros'), async (req, res) => {
  const prev = await db.query('SELECT numero FROM contratos WHERE id=$1', [req.params.id]);
  await db.query('DELETE FROM contratos WHERE id=$1', [req.params.id]);
  await audit(req, 'excluir', 'contrato', parseInt(req.params.id),
    `Contrato "${prev.rows[0]?.numero || req.params.id}" excluído`);
  res.status(204).end();
});

// ── IA: interpretação de documento ──────────────────────────────

router.post('/interpretar', auth, uploadMem.single('arquivo'), async (req, res) => {
  try {
    const apiKey = await _iaGetKey();
    if (!apiKey) return res.status(503).json({
      error: 'Chave da API Gemini não configurada.',
      dica: 'Acesse Configurações → Inteligência Artificial e informe sua chave gratuita de https://aistudio.google.com/app/apikey',
    });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const obraId = parseInt(req.body?.obra_id) || null;

    const parts = await _iaFileToParts(req.file);
    parts.push({
      text: `Você é um especialista em contratos de obras e serviços de engenharia no Brasil.
Analise o documento e extraia TODAS as informações a seguir em um único objeto JSON.

Retorne SOMENTE o objeto JSON abaixo (sem markdown, sem explicações, sem texto adicional):

{
  "contrato": {
    "numero": "Número ou código do contrato (ex: CT-001/2024) — null se não encontrado",
    "objeto": "Descrição completa do objeto/escopo do contrato — null se não encontrado",
    "data_inicio": "Data de início/vigência inicial do contrato — retorne EXATAMENTE como aparece no documento (ex: '15/03/2024', '15 de março de 2024', '2024-03-15') — null se não encontrado",
    "data_termino": "Data de término/fim de vigência do contrato — retorne EXATAMENTE como aparece no documento (ex: '14/03/2025', '14 de março de 2025', '2025-03-14') — null se não encontrado",
    "observacoes": "Informações relevantes adicionais (prazo de execução, local de obra, condições especiais) — null se não encontrado",
    "wbs_codes": ["1.3.12", "2.4.1"]
  },
  "fornecedor": {
    "razao_social": "Razão Social completa do CONTRATADO/FORNECEDOR — null se não encontrado",
    "nome_fantasia": "Nome fantasia do fornecedor — null se não encontrado",
    "cnpj": "CNPJ do fornecedor no formato 00.000.000/0001-00 — null se não encontrado",
    "tel": "Telefone do fornecedor com DDD — null se não encontrado",
    "email": "E-mail de contato do fornecedor — null se não encontrado",
    "email_nf": "E-mail para nota fiscal do fornecedor — null se não encontrado",
    "email_assin": "E-mail para assinatura do representante do fornecedor — null se não encontrado",
    "representante": "Nome do representante legal do fornecedor — null se não encontrado",
    "cargo_representante": "Cargo do representante (ex: Sócio-Administrador) — null se não encontrado",
    "endereco": "Endereço completo do fornecedor — null se não encontrado"
  },
  "itens": [
    {
      "descricao": "Descrição completa do item/serviço da planilha orçamentária",
      "unidade": "Abreviatura técnica: m², m³, m, kg, un, vb, gl, hr, %, etc.",
      "qtd_total": 100.00,
      "valor_unitario": 50.00,
      "valor_total": 5000.00
    }
  ]
}

Regras gerais:
- O FORNECEDOR/CONTRATADO é a empresa que PRESTA o serviço, não o CONTRATANTE/TOMADOR.
- Datas: retorne EXATAMENTE como estão no documento — não converta o formato. O sistema fará a conversão.
- Números (qtd, valores): sem R$, sem ponto de milhar — use ponto como separador decimal (ex: 1500.50).
- Campos não encontrados devem ser null (nunca invente dados).
- Em "itens": inclua TODOS os itens da planilha orçamentária; exclua linhas de totais, subtotais e BDI.
- Se não houver planilha orçamentária, retorne "itens" como array vazio [].
- Em "wbs_codes": procure no documento por códigos de EAP/WBS — sequências numéricas hierárquicas separadas por ponto (ex: 1.3.12.4.1.3, 2.1, 4.2.3). Inclua todos os que encontrar. Se não houver, retorne [].

Regras CRÍTICAS para extração de itens (qtd_total e valor_unitario):
- Procure a planilha orçamentária em TODAS as tabelas do documento — pode estar em anexo, apêndice ou cláusula específica.
- Colunas comuns para quantidade: "Quant.", "Qtd", "Qtde", "Quantidade", "Qtd. Total", "Q".
- Colunas comuns para valor unitário: "V. Unit.", "Valor Unit.", "Preço Unit.", "PU", "Preço Unitário", "Valor Unitário".
- Colunas comuns para valor total do item: "Valor Total", "V. Total", "Total", "Preço Total", "PT".
- Se o valor_unitario não estiver explícito na tabela mas qtd_total e valor_total estiverem: calcule valor_unitario = valor_total / qtd_total.
- Se qtd_total não estiver explícito mas valor_total e valor_unitario estiverem: calcule qtd_total = valor_total / valor_unitario.
- Retorne null apenas se NENHUMA dessas derivações for possível — nunca retorne 0 para indicar "não encontrado".
- Itens com escopo global (ex: "Serviços gerais", "Administração local") frequentemente têm unidade "vb" (verba) ou "gl" (global) e qtd_total = 1; nesse caso use qtd_total=1 e valor_unitario=valor_total.
- Itens de percentual (BDI, bonificação) devem ser excluídos da lista de itens.`,
    });

    const cleaned = await _iaCall(apiKey, parts);
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
    } catch (parseErr) {
      console.error('[IA/contrato] JSON parse error:', parseErr.message);
      console.error('[IA/contrato] Raw response (primeiros 1000 chars):', cleaned.slice(0, 1000));
      return res.status(422).json({
        error: 'Formato inesperado retornado pelo modelo. Tente novamente.',
        raw: cleaned.slice(0, 800),
      });
    }

    const str = (v, max = 500) => (v && typeof v === 'string') ? v.trim().slice(0, max) : null;

    const contrato = parsed.contrato || {};
    const contratoSan = {
      numero:      str(contrato.numero, 50),
      objeto:      str(contrato.objeto, 500),
      data_inicio:  _parseDate(contrato.data_inicio),
      data_termino: _parseDate(contrato.data_termino),
      observacoes: str(contrato.observacoes, 1000),
    };

    const forn    = parsed.fornecedor || {};
    const fornSan = {
      razao_social:        str(forn.razao_social, 300),
      nome_fantasia:       str(forn.nome_fantasia, 200),
      cnpj:                str(forn.cnpj, 20),
      tel:                 str(forn.tel, 20),
      email:               str(forn.email, 200),
      email_nf:            str(forn.email_nf, 200),
      email_assin:         str(forn.email_assin, 200),
      representante:       str(forn.representante, 200),
      cargo_representante: str(forn.cargo_representante, 100),
      endereco:            str(forn.endereco, 500),
    };

    const itensRaw = Array.isArray(parsed.itens) ? parsed.itens : [];
    const itens    = itensRaw.map((item, idx) => ({
      ordem:          idx + 1,
      descricao:      str(item.descricao, 500) || '',
      unidade:        str(item.unidade, 20) || 'un',
      qtd_total:      parseFloat(item.qtd_total)      || 0,
      valor_unitario: parseFloat(item.valor_unitario) || 0,
      valor_total:    parseFloat(item.valor_total)
                      || (parseFloat(item.qtd_total) * parseFloat(item.valor_unitario))
                      || 0,
    })).filter(i => i.descricao);

    // ── WBS auto-link: busca atividades do cronograma da obra ────────
    let wbs_matches = [];
    const wbsCodes = Array.isArray(contrato.wbs_codes)
      ? contrato.wbs_codes.filter(c => typeof c === 'string' && /^\d[\d.]+$/.test(c.trim()))
      : [];

    if (obraId && wbsCodes.length > 0) {
      try {
        const wbsR = await db.query(
          `SELECT ac.id, ac.wbs, ac.nome, ac.nivel, ac.eh_resumo,
                  ac.data_inicio, ac.data_termino, ac.cronograma_id,
                  cr.nome AS cronograma_nome, cr.versao
             FROM atividades_cronograma ac
             JOIN cronogramas cr ON cr.id = ac.cronograma_id
            WHERE cr.obra_id = $1
              AND ac.wbs = ANY($2::text[])
            ORDER BY cr.versao DESC, ac.ordem`,
          [obraId, wbsCodes.map(c => c.trim())]
        );
        wbs_matches = wbsR.rows.map(r => ({
          atividade_id:   r.id,
          wbs:            r.wbs,
          nome:           r.nome,
          nivel:          r.nivel,
          eh_resumo:      r.eh_resumo,
          data_inicio:    r.data_inicio,
          data_termino:   r.data_termino,
          cronograma_id:  r.cronograma_id,
          cronograma_nome: r.cronograma_nome,
          versao:         r.versao,
        }));
      } catch(wbsErr) {
        console.warn('[IA/contrato] Erro ao buscar WBS:', wbsErr.message);
      }
    }

    res.json({ contrato: contratoSan, fornecedor: fornSan, itens, total: itens.length, modelo: 'gemini-2.5-flash', wbs_matches });
  } catch (e) {
    console.error('[IA/contrato]', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/contratos/:id/atividades — atividades do cronograma vinculadas
// ═══════════════════════════════════════════════════════════════
router.get('/:id/atividades', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.id, a.wbs, a.nome, a.data_inicio, a.data_termino,
              a.nivel, a.eh_resumo, a.pct_planejado,
              cron.nome AS cronograma_nome, cron.id AS cronograma_id
         FROM contratos_atividades ca
         JOIN atividades_cronograma a ON a.id = ca.atividade_id
         JOIN cronogramas cron ON cron.id = a.cronograma_id
        WHERE ca.contrato_id = $1
        ORDER BY a.ordem`,
      [parseInt(req.params.id)]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/contratos/:id/atividades — vincular/desvincular atividades
// Body: { atividade_ids: [1, 2, 3] }  — substitui vínculos existentes
// ═══════════════════════════════════════════════════════════════
router.post('/:id/atividades', auth, perm('cronogramaVinculos'), async (req, res) => {
  const contratoId = parseInt(req.params.id);
  const ids = Array.isArray(req.body.atividade_ids) ? req.body.atividade_ids.map(Number) : [];

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM contratos_atividades WHERE contrato_id=$1', [contratoId]);
    for (const atId of ids) {
      if (!atId) continue;
      await client.query(
        'INSERT INTO contratos_atividades (contrato_id, atividade_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [contratoId, atId]
      );
    }
    await client.query('COMMIT');
    const numCont = await db.query('SELECT numero FROM contratos WHERE id=$1', [contratoId]);
    await audit(req, 'vincular', 'contrato', contratoId,
      `Contrato "${numCont.rows[0]?.numero || contratoId}" vinculado a ${ids.length} atividade(s) do cronograma`,
      { atividade_ids: ids });
    res.json({ contrato_id: contratoId, atividades_vinculadas: ids.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/contratos/:id/cronograma-atividades-disponiveis
// Lista todas as atividades (não resumo) da obra do contrato
// para exibir no seletor do formulário
// ═══════════════════════════════════════════════════════════════
router.get('/:id/cronograma-atividades-disponiveis', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.id, a.wbs, a.nome, a.data_inicio, a.data_termino,
              a.nivel, a.eh_resumo,
              cron.id AS cronograma_id, cron.nome AS cronograma_nome, cron.versao,
              EXISTS (
                SELECT 1 FROM contratos_atividades ca2
                WHERE ca2.atividade_id = a.id AND ca2.contrato_id = $1
              ) AS vinculado
         FROM contratos c
         JOIN cronogramas cron ON cron.obra_id = c.obra_id AND cron.ativo = TRUE
         JOIN atividades_cronograma a ON a.cronograma_id = cron.id
        WHERE c.id = $1
        ORDER BY cron.versao DESC, a.ordem`,
      [parseInt(req.params.id)]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
