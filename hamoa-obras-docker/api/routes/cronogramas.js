/**
 * CONSTRUTIVO OBRAS — Rotas de Cronograma
 *
 * POST  /api/cronogramas/importar        Upload e parse de .mpp ou .xml MS Project
 * GET   /api/cronogramas[?obra_id=]      Lista cronogramas (+ número de atividades)
 * GET   /api/cronogramas/:id             Detalhe de um cronograma
 * GET   /api/cronogramas/:id/atividades  Árvore WBS com % realizado calculado dos contratos
 * PUT   /api/cronogramas/:id             Atualiza nome/ativo
 * PUT   /api/cronogramas/atividades/:id/pct  Atualização manual de % realizado
 * DELETE /api/cronogramas/:id            Remove cronograma + atividades
 */
const router  = require('express').Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const { perm } = require('../middleware/perm');
const audit   = require('../middleware/audit');
const { getObrasPermitidas, obraClause, temAcessoObra } = require('../middleware/obras');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

// ── Upload para pasta temporária (precisa de path para mpxj) ──
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mpp', '.xml'].includes(ext)) return cb(null, true);
    cb(new Error('Formato inválido. Use .mpp ou .xml (exportação MS Project).'));
  },
});

// ── Parser de arquivo MPP (MS Project binário) via mpxj ───────
// mpxj é um pacote OPCIONAL (requer Java instalado no servidor).
// Se não estiver disponível, retorna erro orientando exportar como XML.
async function _parseMPP(filePath) {
  let readProject;
  try {
    readProject = require('mpxj').readProject;
  } catch (_) {
    throw new Error(
      'Suporte a .mpp não está disponível nesta instalação. ' +
      'Exporte o cronograma como XML diretamente do MS Project: ' +
      'Arquivo → Salvar como → XML do Project (*.xml) — e importe o .xml aqui.'
    );
  }
  try {
    const project = await readProject(filePath);
    return _transformMpxjProject(project);
  } catch (err) {
    throw new Error('Falha ao ler arquivo .mpp: ' + err.message);
  }
}

// ── Transforma projeto mpxj em array plano de atividades ──────
function _transformMpxjProject(project) {
  const tasks  = project.getTasks();
  const result = { dataInicio: null, dataTermino: null, atividades: [] };
  let ordem = 0;

  for (const t of tasks) {
    // mpxj retorna uma tarefa "raiz" com ID 0 — pular
    if (!t.getName() || t.getID() === 0) continue;

    const start  = t.getStart()  ? new Date(t.getStart())  : null;
    const finish = t.getFinish() ? new Date(t.getFinish()) : null;

    if (start  && (!result.dataInicio  || start  < result.dataInicio))  result.dataInicio  = start;
    if (finish && (!result.dataTermino || finish > result.dataTermino)) result.dataTermino = finish;

    const durMs  = t.getDuration();
    const durDias = durMs ? Math.round(durMs.getDuration()) : null;

    const parent = t.getParentTask();
    const parentUID = (parent && parent.getID() !== 0) ? parent.getUniqueID() : null;

    result.atividades.push({
      uid_externo:   t.getUniqueID(),
      parent_uid:    parentUID,
      wbs:           t.getWBS()            || String(t.getID()),
      nome:          t.getName()           || '(sem nome)',
      data_inicio:   start  ? start.toISOString().slice(0, 10)  : null,
      data_termino:  finish ? finish.toISOString().slice(0, 10) : null,
      duracao:       durDias,
      nivel:         t.getOutlineLevel()   || 0,
      pct_planejado: parseFloat(t.getPercentageComplete()) || 0,
      eh_resumo:     !!t.getSummary(),
      ordem:         ordem++,
    });
  }
  return result;
}

// ── Parser de XML MS Project (exportação nativa) ──────────────
async function _parseXML(filePath) {
  // ── Leitura STREAMING linha a linha ──────────────────────────────────────────
  // Arquivos MS Project XML podem ter centenas de MB. Carregar tudo em memória
  // causa OOM e derruba o processo. A leitura linha a linha mantém uso de RAM
  // em ~5-20 MB independente do tamanho do arquivo.
  const readline = require('readline');

  // Campos que nos interessam — regex para capturar qualquer um em uma linha
  const FIELD_RE = /^\s*<(UID|ID|Name|WBS|OutlineNumber|OutlineLevel|Start|Finish|Duration|PercentComplete|Summary|Active|Cost|FixedCost)>(.*?)<\/\1>\s*$/;

  const rawTasks = [];
  let inTask   = false;
  let current  = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const t = line.trim();
    if (t === '<Task>') {
      inTask  = true;
      current = {};
      continue;
    }
    if (t === '</Task>') {
      inTask = false;
      if (current) rawTasks.push(current);
      current = null;
      continue;
    }
    if (inTask && current) {
      const m = t.match(FIELD_RE);
      if (m) current[m[1]] = m[2].trim();
    }
  }

  // ── Decodifica entidades XML básicas ─────────────────────────────────────────
  const decXml = (s) => (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"');

  // ── Constrói mapa OutlineNumber → UID para resolução de pai ──────────────────
  // MS Project XML não exporta <OutlineParent>; a hierarquia vem de OutlineNumber
  // Ex: "1.2.3" → pai tem OutlineNumber "1.2"
  const outlineToUid = {};
  for (const t of rawTasks) {
    if (t.OutlineNumber && t.UID) outlineToUid[t.OutlineNumber] = parseInt(t.UID);
  }

  // ── Processa tarefas ──────────────────────────────────────────────────────────
  const result = { dataInicio: null, dataTermino: null, atividades: [] };
  let ordem = 0;

  const toDate = (s) => {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  for (const t of rawTasks) {
    const uid  = parseInt(t.UID);
    const nome = decXml(t.Name || '').slice(0, 500);

    // Pula tarefa raiz (UID=0 ou OutlineNumber="0") e tarefas sem nome
    if (!uid || isNaN(uid) || !nome || t.OutlineNumber === '0') continue;

    // Deriva pai a partir do OutlineNumber: "1.2.3" → pai tem outline "1.2"
    let parentUID = null;
    if (t.OutlineNumber && t.OutlineNumber.includes('.')) {
      const parentOutline = t.OutlineNumber.split('.').slice(0, -1).join('.');
      parentUID = outlineToUid[parentOutline] || null;
    }

    const start  = toDate(t.Start);
    const finish = toDate(t.Finish);
    if (start  && (!result.dataInicio  || start  < result.dataInicio))  result.dataInicio  = start;
    if (finish && (!result.dataTermino || finish > result.dataTermino)) result.dataTermino = finish;

    // Duração: PT7294H0M0S → dias úteis (8 h/dia padrão MS Project)
    let durDias = null;
    if (t.Duration) {
      const dm = t.Duration.match(/PT(\d+(?:\.\d+)?)H/);
      if (dm) durDias = Math.round(parseFloat(dm[1]) / 8) || null;
    }

    // Custo planejado: MS Project armazena em Cost (total) ou FixedCost (custo fixo sem recursos).
    // Em projetos de obras sem recursos atribuídos, FixedCost = Cost. Usa Cost como prioritário.
    // IMPORTANTE: MS Project XML armazena valores monetários em centavos (1/100 da unidade monetária).
    // Ex: R$ 116.125.868,12 é armazenado como 11612586812 → dividir por 100.
    const _custoRaw = parseFloat(t.Cost) || parseFloat(t.FixedCost) || null;
    const custoRaw = _custoRaw !== null ? Math.round(_custoRaw) / 100 : null;

    result.atividades.push({
      uid_externo:    uid,
      parent_uid:     parentUID,
      wbs:            decXml(t.WBS || t.OutlineNumber || t.ID || String(uid)).slice(0, 50),
      nome,
      data_inicio:    start  ? start.toISOString().slice(0, 10)  : null,
      data_termino:   finish ? finish.toISOString().slice(0, 10) : null,
      duracao:        durDias,
      nivel:          Math.max(0, parseInt(t.OutlineLevel) || 0),
      pct_planejado:  Math.min(100, Math.max(0, parseFloat(t.PercentComplete) || 0)),
      eh_resumo:      t.Summary === '1',
      ordem:          ordem++,
      custo_planejado: custoRaw,
    });
  }

  return result;
}

// ── Salva atividades em bulk (unnest) — 2 queries para qualquer volume ─────────
// Retorna array de avisos (warnings) para repassar ao frontend
async function _saveAtividades(client, cronogramaId, atividades) {
  const avisos = [];
  if (!atividades.length) return avisos;

  // Prepara colunas como arrays paralelos para unnest do PostgreSQL
  const wbss = [], nomes = [], dataInis = [], dataFins = [],
        duracoes = [], niveis = [], pcts = [], ehResumos = [], ordens = [], uids = [], custos = [];

  let semData = 0, semDuracao = 0;
  for (const a of atividades) {
    wbss    .push((a.wbs  || String(a.uid_externo || a.ordem + 1)).slice(0, 50));
    nomes   .push((a.nome || 'Sem nome').slice(0, 500));
    dataInis.push(a.data_inicio  || null);
    dataFins.push(a.data_termino || null);
    duracoes.push(a.duracao      || null);
    niveis  .push(a.nivel        || 0);
    pcts    .push(Math.min(100, Math.max(0, parseFloat(a.pct_planejado) || 0)));
    ehResumos.push(a.eh_resumo   || false);
    ordens  .push(a.ordem        || 0);
    uids    .push(a.uid_externo  || null);
    custos  .push(a.custo_planejado != null ? parseFloat(a.custo_planejado) : null);

    if (!a.data_inicio && !a.data_termino) semData++;
    if (!a.duracao) semDuracao++;
  }

  if (semData > 0)     avisos.push({ nivel: 'info', msg: `${semData} atividade(s) sem data de início/término` });
  if (semDuracao > 0)  avisos.push({ nivel: 'info', msg: `${semDuracao} atividade(s) sem duração definida` });

  // ── INSERT em bloco único via unnest — 1 roundtrip ao banco ─────────────────
  await client.query(`
    INSERT INTO atividades_cronograma
      (cronograma_id, wbs, nome, data_inicio, data_termino, duracao,
       nivel, pct_planejado, eh_resumo, ordem, uid_externo, custo_planejado)
    SELECT $1,
           unnest($2::text[]),    unnest($3::text[]),
           unnest($4::date[]),    unnest($5::date[]),
           unnest($6::int[]),     unnest($7::int[]),
           unnest($8::numeric[]), unnest($9::bool[]),
           unnest($10::int[]),    unnest($11::int[]),
           unnest($12::numeric[])
  `, [cronogramaId, wbss, nomes, dataInis, dataFins,
      duracoes, niveis, pcts, ehResumos, ordens, uids, custos]);

  // ── UPDATE parent_id em bloco único via unnest + self-join ──────────────────
  const childUids = [], parentUids = [];
  for (const a of atividades) {
    if (a.uid_externo && a.parent_uid) {
      childUids .push(a.uid_externo);
      parentUids.push(a.parent_uid);
    }
  }

  if (childUids.length > 0) {
    const updR = await client.query(`
      UPDATE atividades_cronograma child
      SET parent_id = parent.id
      FROM unnest($2::int[], $3::int[]) AS m(child_uid, parent_uid_ext)
      JOIN atividades_cronograma parent
        ON parent.uid_externo = m.parent_uid_ext
       AND parent.cronograma_id = $1
      WHERE child.uid_externo  = m.child_uid
        AND child.cronograma_id = $1
    `, [cronogramaId, childUids, parentUids]);

    const linked  = updR.rowCount || 0;
    const orfas   = childUids.length - linked;
    if (orfas > 0) {
      const msg = `${orfas} atividade(s) ficaram sem hierarquia pai (parent_uid não encontrado no arquivo) — aparecerão no nível raiz da WBS`;
      console.warn(`[cronograma] ${msg} — cronograma=${cronogramaId}`);
      avisos.push({ nivel: 'aviso', msg });
    }
  }

  return avisos;
}

// ═══════════════════════════════════════════════════════════════
// ROTA: POST /importar
// ═══════════════════════════════════════════════════════════════
router.post('/importar', auth, perm('cronogramaEditar'), (req, res, next) => {
  upload.single('arquivo')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Arquivo muito grande — limite de 200 MB. Para arquivos maiores, considere filtrar tarefas ou exportar apenas parte do cronograma no MS Project.'
        : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
}, async (req, res) => {
  const tmpFile = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    const obraId    = parseInt(req.body.obra_id);
    const nome      = (req.body.nome || req.file.originalname).trim().slice(0, 255);
    const replaceId = req.body.replace_id ? parseInt(req.body.replace_id) : null;
    if (!obraId) return res.status(400).json({ error: 'obra_id obrigatório.' });

    // Verificar obra existe
    const obraChk = await db.query('SELECT id FROM obras WHERE id=$1', [obraId]);
    if (!obraChk.rows.length) return res.status(404).json({ error: 'Obra não encontrada.' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    let parsed;
    if (ext === '.mpp') {
      parsed = await _parseMPP(tmpFile);
    } else if (ext === '.xml') {
      parsed = await _parseXML(tmpFile);
    } else {
      return res.status(400).json({ error: 'Formato não suportado. Use .mpp ou .xml.' });
    }

    if (!parsed.atividades.length) {
      return res.status(422).json({ error: 'O arquivo não contém atividades ou não pôde ser lido.' });
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      let versao;
      if (replaceId) {
        // Substituição: pega versão do cronograma anterior e o apaga
        const oldR = await client.query('SELECT versao, obra_id FROM cronogramas WHERE id=$1', [replaceId]);
        if (!oldR.rows.length) return res.status(404).json({ error: 'Cronograma a substituir não encontrado.' });
        versao = oldR.rows[0].versao;
        await client.query('DELETE FROM cronogramas WHERE id=$1', [replaceId]);
      } else {
        // Nova importação: incrementa versão
        const vRes = await client.query('SELECT COUNT(*) FROM cronogramas WHERE obra_id=$1', [obraId]);
        versao = parseInt(vRes.rows[0].count) + 1;
      }

      const crRes = await client.query(
        `INSERT INTO cronogramas (obra_id, nome, versao, arquivo_nome, data_inicio, data_termino, importado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          obraId, nome, versao, req.file.originalname,
          parsed.dataInicio  ? parsed.dataInicio.toISOString().slice(0, 10)  : null,
          parsed.dataTermino ? parsed.dataTermino.toISOString().slice(0, 10) : null,
          req.user?.login || 'sistema',
        ]
      );
      const cronogramaId = crRes.rows[0].id;

      const avisos = await _saveAtividades(client, cronogramaId, parsed.atividades);

      await client.query('COMMIT');

      await audit(req, 'importar', 'cronograma', cronogramaId,
        `Cronograma "${nome}" v${versao} importado — ${parsed.atividades.length} atividades`,
        { substituido: !!replaceId, atividades: parsed.atividades.length, avisos: avisos.length });

      const resumos   = parsed.atividades.filter(a => a.eh_resumo).length;
      const folhas    = parsed.atividades.length - resumos;
      const comCusto  = parsed.atividades.filter(a => a.custo_planejado).length;

      res.status(201).json({
        id:          cronogramaId,
        nome,
        versao,
        substituido: !!replaceId,
        atividades:  parsed.atividades.length,
        resumos,
        folhas,
        comCusto,
        dataInicio:  parsed.dataInicio,
        dataTermino: parsed.dataTermino,
        avisos,
      });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[cronogramas/importar]', err);

    // Categoriza o erro para o frontend exibir dica adequada
    let tipo = 'erro_geral';
    let dica  = null;
    const msg = err.message || '';
    if (/200 MB|file size|LIMIT_FILE_SIZE/i.test(msg)) {
      tipo = 'arquivo_grande';
      dica = 'O arquivo excede o limite de 200 MB. Exporte apenas parte do cronograma no MS Project ou divida em múltiplos arquivos.';
    } else if (/\.mpp|mpxj|Java/i.test(msg)) {
      tipo = 'formato_mpp';
      dica = 'Para importar .mpp, o servidor precisa ter Java instalado. Alternativa: no MS Project, use Arquivo → Salvar Como → XML do Project (*.xml) e importe o .xml.';
    } else if (/não contém atividades|não pôde ser lido/i.test(msg)) {
      tipo = 'arquivo_vazio';
      dica = 'O arquivo parece estar vazio ou corrompido. Verifique se foi exportado corretamente do MS Project.';
    } else if (/Formato inválido|não suportado/i.test(msg)) {
      tipo = 'formato_invalido';
      dica = 'Use arquivos .mpp (MS Project binário) ou .xml (exportação XML do MS Project).';
    } else if (/ENOENT|cannot read|leitura/i.test(msg)) {
      tipo = 'leitura_arquivo';
      dica = 'Falha ao ler o arquivo no servidor. Tente novamente ou verifique se o arquivo não está corrompido.';
    } else if (/duplicate key|unique constraint/i.test(msg)) {
      tipo = 'conflito_banco';
      dica = 'Conflito ao salvar no banco. Se estiver substituindo um cronograma, selecione a opção "Substituir" em vez de importar como novo.';
    }

    res.status(500).json({ error: msg || 'Erro ao importar cronograma.', tipo, dica });
  } finally {
    if (tmpFile) fs.unlink(tmpFile, () => {});
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: GET /
// ═══════════════════════════════════════════════════════════════
router.get('/', auth, async (req, res) => {
  try {
    const conditions = ['c.ativo = TRUE'];
    const params     = [];

    if (req.query.obra_id) {
      params.push(parseInt(req.query.obra_id));
      conditions.push(`c.obra_id = $${params.length}`);
    }

    // Restrição de acesso por obra
    const obras = await getObrasPermitidas(req, db);
    if (obras) {
      params.push(obras);
      conditions.push(`c.obra_id = ANY($${params.length}::int[])`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const r = await db.query(
      `SELECT c.*, o.nome AS obra_nome,
              COUNT(a.id)::int AS total_atividades,
              COUNT(a.id) FILTER (WHERE NOT a.eh_resumo)::int AS total_tarefas
         FROM cronogramas c
         JOIN obras o ON o.id = c.obra_id
         LEFT JOIN atividades_cronograma a ON a.cronograma_id = c.id
         ${where}
         GROUP BY c.id, o.nome
         ORDER BY c.obra_id, c.versao DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /cronogramas]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: GET /:id/atividades  — árvore WBS com progresso calculado
// ═══════════════════════════════════════════════════════════════
router.get('/:id/atividades', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // Busca atividades com % calculado por medições (ponderado por valor_total)
    const r = await db.query(
      `SELECT
         a.id, a.cronograma_id, a.parent_id, a.wbs, a.nome,
         a.data_inicio, a.data_termino, a.duracao, a.nivel,
         a.pct_planejado, a.pct_realizado, a.eh_resumo, a.ordem,
         a.custo_planejado,

         -- ── % calculado pelas medições (join lateral evita subquery duplicada) ──
         med_calc.pct_medicoes,
         med_calc.qtd_contratos,
         med_calc.qtd_com_medicoes,

         -- % efetivo final: medições (se houver contrato vinculado) → manual → 0
         COALESCE(med_calc.pct_medicoes, a.pct_realizado) AS pct_realizado_calc,

         -- Contratos vinculados (para exibição de chips)
         (SELECT json_agg(json_build_object(
            'id',        c.id,
            'numero',    c.numero,
            'fornecedor', COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social),
            'valor_total', c.valor_total
          ))
          FROM contratos_atividades ca2
          JOIN contratos   c ON c.id = ca2.contrato_id
          JOIN fornecedores f ON f.id = c.fornecedor_id
          WHERE ca2.atividade_id = a.id
         ) AS contratos_vinculados

       FROM atividades_cronograma a

       -- ── LATERAL: calcula % de medições uma vez por atividade ──────────
       LEFT JOIN LATERAL (
         SELECT
           ROUND(
             CASE
               WHEN COUNT(ca.contrato_id) = 0 THEN NULL
               WHEN SUM(c.valor_total) > 0
                    THEN LEAST(100,
                           COALESCE(SUM(ex.val_fis), 0)
                           / NULLIF(SUM(c.valor_total), 0) * 100)
               ELSE NULL
             END, 2
           ) AS pct_medicoes,
           COUNT(ca.contrato_id)::int                                       AS qtd_contratos,
           SUM(CASE WHEN ex.contrato_id IS NOT NULL THEN 1 ELSE 0 END)::int AS qtd_com_medicoes,
           -- Valores brutos para roll-up ponderado por valor de contrato
           COALESCE(SUM(ex.val_fis), 0)     AS val_fis_sum,
           COALESCE(SUM(c.valor_total), 0)  AS val_total_sum
         FROM contratos_atividades ca
         JOIN contratos c ON c.id = ca.contrato_id
         LEFT JOIN (
           -- val_fis: valor físico executado por contrato.
           -- Prioridade de preço por item:
           --   1) mi.valor_unitario (preenchido pelas versões recentes do backend)
           --   2) ci.valor_unitario via contrato_item_id (pode ser NULL se ON DELETE SET NULL disparou)
           --   3) lookup por descrição exata em contrato_itens (recupera dados antigos após re-save)
           --   4) m.valor_medicao do cabeçalho da medição (fallback final para dados legados)
           SELECT
             sub.contrato_id,
             SUM(COALESCE(NULLIF(sub.val_itens, 0), sub.valor_medicao, 0)) AS val_fis
           FROM (
             SELECT
               m.contrato_id,
               m.id                         AS medicao_id,
               COALESCE(m.valor_medicao, 0) AS valor_medicao,
               COALESCE(SUM(
                 mi.qtd_mes * COALESCE(
                   NULLIF(mi.valor_unitario, 0),
                   ci.valor_unitario,
                   (SELECT ci2.valor_unitario
                      FROM contrato_itens ci2
                     WHERE ci2.contrato_id = m.contrato_id
                       AND LOWER(TRIM(ci2.descricao)) = LOWER(TRIM(mi.descricao))
                     ORDER BY ci2.id DESC LIMIT 1),
                   0
                 )
               ), 0) AS val_itens
             FROM medicoes m
             JOIN medicao_itens mi ON mi.medicao_id = m.id
             LEFT JOIN contrato_itens ci ON ci.id = mi.contrato_item_id
             WHERE m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
               AND m.tipo IN ('Normal','Avanco_Fisico')
             GROUP BY m.contrato_id, m.id, m.valor_medicao
           ) sub
           GROUP BY sub.contrato_id
         ) ex ON ex.contrato_id = c.id
         WHERE ca.atividade_id = a.id
       ) med_calc ON true

       WHERE a.cronograma_id = $1
       ORDER BY a.ordem`,
      [id]
    );

    // ── Diagnóstico: loga atividades com contratos para depuração ──
    const withContratos = r.rows.filter(x => x.qtd_contratos > 0);
    if (withContratos.length > 0) {
      console.log(`[CRON/${id}] Atividades com contratos vinculados:`);
      withContratos.forEach(x => {
        console.log(`  id=${x.id} nivel=${x.nivel} wbs=${x.wbs} qtd_contratos=${x.qtd_contratos} qtd_com_medicoes=${x.qtd_com_medicoes} pct_medicoes=${x.pct_medicoes} pct_realizado_calc=${x.pct_realizado_calc}`);
      });
    } else {
      console.log(`[CRON/${id}] Nenhuma atividade tem contrato vinculado em contratos_atividades.`);
    }

    // ── Roll-up bottom-up: computa pct_realizado_calc dos pais a partir dos filhos ──
    const rows = r.rows;
    _applyRollup(rows);

    res.json(rows);
  } catch (err) {
    console.error('[GET /cronogramas/:id/atividades]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: GET /:id/contratos-vinculos
// Retorna todos os contratos da obra deste cronograma,
// indicando a qual atividade cada um está vinculado (se estiver).
// ═══════════════════════════════════════════════════════════════
router.get('/:id/contratos-vinculos', auth, async (req, res) => {
  try {
    const cronId = parseInt(req.params.id);
    if (!cronId) return res.status(400).json({ error: 'ID inválido' });

    const r = await db.query(`
      SELECT
        c.id, c.numero, c.objeto, c.valor_total, c.status,
        COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) AS fornecedor_nome,
        -- atividade vinculada a ESTE cronograma (null se não vinculado)
        av.id          AS atividade_id,
        av.wbs         AS atividade_wbs,
        av.nome        AS atividade_nome,
        av.nivel       AS atividade_nivel
      FROM cronogramas cr
      JOIN obras o ON o.id = cr.obra_id
      JOIN contratos c ON c.obra_id = o.id
      JOIN fornecedores f ON f.id = c.fornecedor_id
      LEFT JOIN LATERAL (
        SELECT a.id, a.wbs, a.nome, a.nivel
          FROM contratos_atividades ca
          JOIN atividades_cronograma a ON a.id = ca.atividade_id
         WHERE ca.contrato_id = c.id
           AND a.cronograma_id = cr.id
         LIMIT 1
      ) av ON true
      WHERE cr.id = $1
      ORDER BY av.id NULLS LAST, c.numero`,
      [cronId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /cronogramas/:id/contratos-vinculos]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: GET /:id/atividades/debug  — diagnóstico dos dados brutos
// ═══════════════════════════════════════════════════════════════
router.get('/:id/atividades/debug', auth, perm('verObra'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // Se ID inválido, lista cronogramas disponíveis para o usuário saber qual usar
    if (!id || isNaN(id)) {
      const lista = await db.query(
        `SELECT c.id, c.nome, c.versao, o.nome AS obra_nome,
                COUNT(a.id) AS total_atividades
           FROM cronogramas c
           JOIN obras o ON o.id = c.obra_id
           LEFT JOIN atividades_cronograma a ON a.cronograma_id = c.id
          GROUP BY c.id, c.nome, c.versao, o.nome
          ORDER BY c.id DESC LIMIT 20`
      );
      return res.json({ erro: 'Informe o ID do cronograma na URL', cronogramas_disponiveis: lista.rows });
    }

    // 1. Contratos vinculados às atividades deste cronograma
    const vinc = await db.query(`
      SELECT ca.atividade_id, ca.contrato_id, c.numero, c.valor_total,
             a.wbs, a.nome AS at_nome
        FROM contratos_atividades ca
        JOIN contratos c ON c.id = ca.contrato_id
        JOIN atividades_cronograma a ON a.id = ca.atividade_id
       WHERE a.cronograma_id = $1
       ORDER BY a.ordem`, [id]);

    // 2. Medições aprovadas dos contratos acima, com itens
    const contIds = [...new Set(vinc.rows.map(r => r.contrato_id))];
    let medItems = { rows: [] };
    if (contIds.length > 0) {
      medItems = await db.query(`
        SELECT m.id AS medicao_id, m.contrato_id, m.tipo, m.status,
               m.valor_medicao, m.valor_acumulado,
               COUNT(mi.id) AS total_itens,
               SUM(mi.qtd_mes) AS soma_qtd_mes,
               SUM(mi.valor_unitario) AS soma_vun,
               SUM(mi.valor_item) AS soma_valor_item,
               SUM(CASE WHEN mi.contrato_item_id IS NOT NULL THEN 1 ELSE 0 END) AS itens_com_ci_id
          FROM medicoes m
          LEFT JOIN medicao_itens mi ON mi.medicao_id = m.id
         WHERE m.contrato_id = ANY($1::int[])
           AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
           AND m.tipo IN ('Normal','Avanco_Fisico')
         GROUP BY m.id
         ORDER BY m.contrato_id, m.id`, [contIds]);
    }

    // 3. Amostra de itens de medição com lookup de preço (inclui fallback por descrição)
    let itemSample = { rows: [] };
    if (contIds.length > 0) {
      itemSample = await db.query(`
        SELECT mi.id, mi.medicao_id, m.contrato_id, mi.contrato_item_id,
               mi.descricao, mi.qtd_mes,
               mi.valor_unitario          AS vun_medicao,
               ci.valor_unitario          AS vun_ci_direto,
               (SELECT ci2.valor_unitario
                  FROM contrato_itens ci2
                 WHERE ci2.contrato_id = m.contrato_id
                   AND LOWER(TRIM(ci2.descricao)) = LOWER(TRIM(mi.descricao))
                 ORDER BY ci2.id DESC LIMIT 1
               )                          AS vun_desc_lookup,
               COALESCE(
                 NULLIF(mi.valor_unitario, 0),
                 ci.valor_unitario,
                 (SELECT ci2.valor_unitario
                    FROM contrato_itens ci2
                   WHERE ci2.contrato_id = m.contrato_id
                     AND LOWER(TRIM(ci2.descricao)) = LOWER(TRIM(mi.descricao))
                   ORDER BY ci2.id DESC LIMIT 1),
                 0
               )                          AS vun_efetivo
          FROM medicao_itens mi
          JOIN medicoes m ON m.id = mi.medicao_id
          LEFT JOIN contrato_itens ci ON ci.id = mi.contrato_item_id
         WHERE m.contrato_id = ANY($1::int[])
           AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
           AND m.tipo IN ('Normal','Avanco_Fisico')
         LIMIT 30`, [contIds]);
    }

    // 4. val_fis calculado por contrato (usando a mesma lógica do endpoint principal)
    let valFisCalc = { rows: [] };
    if (contIds.length > 0) {
      valFisCalc = await db.query(`
        SELECT
          sub.contrato_id,
          SUM(COALESCE(NULLIF(sub.val_itens, 0), sub.valor_medicao, 0)) AS val_fis,
          SUM(sub.val_itens)    AS val_itens_total,
          SUM(sub.valor_medicao) AS val_medicao_total
        FROM (
          SELECT
            m.contrato_id,
            m.id                         AS medicao_id,
            COALESCE(m.valor_medicao, 0) AS valor_medicao,
            COALESCE(SUM(
              mi.qtd_mes * COALESCE(
                NULLIF(mi.valor_unitario, 0),
                ci.valor_unitario,
                (SELECT ci2.valor_unitario
                   FROM contrato_itens ci2
                  WHERE ci2.contrato_id = m.contrato_id
                    AND LOWER(TRIM(ci2.descricao)) = LOWER(TRIM(mi.descricao))
                  ORDER BY ci2.id DESC LIMIT 1),
                0
              )
            ), 0) AS val_itens
          FROM medicoes m
          JOIN medicao_itens mi ON mi.medicao_id = m.id
          LEFT JOIN contrato_itens ci ON ci.id = mi.contrato_item_id
          WHERE m.contrato_id = ANY($1::int[])
            AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
            AND m.tipo IN ('Normal','Avanco_Fisico')
          GROUP BY m.contrato_id, m.id, m.valor_medicao
        ) sub
        GROUP BY sub.contrato_id`, [contIds]);
    }

    res.json({
      cronograma_id: id,
      contratos_vinculados_a_atividades: vinc.rows,
      medicoes_aprovadas: medItems.rows,
      amostra_itens_medicao: itemSample.rows,
      val_fis_por_contrato: valFisCalc.rows,
    });
  } catch (err) {
    console.error('[debug]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Roll-up de progresso: percorre a árvore de baixo pra cima ────────────────
// Regra: cada filho direto tem peso igual (média simples).
//   • Atividade sem contrato → contribui 0%
//   • Atividade com contrato → contribui seu pct_realizado_calc
// Isso garante que o % do pai seja proporcional ao número de filhos com progresso,
// evitando que contratos em poucos filhos inflem artificialmente o pai.
function _applyRollup(rows) {
  if (!rows.length) return;

  const byId      = {};
  const childrenOf = {};

  rows.forEach(r => {
    r.pct_realizado_calc = parseFloat(r.pct_realizado_calc) || 0;
    r.eh_rollup          = false;
    r.rollup_filhos      = 0;
    r.rollup_com_med     = 0;
    r.pct_rollup         = null;
    byId[r.id]           = r;
    childrenOf[r.id]     = [];
  });

  rows.forEach(r => {
    if (r.parent_id != null && childrenOf[r.parent_id] !== undefined) {
      childrenOf[r.parent_id].push(r.id);
    }
  });

  // Ordena do nível mais profundo para o mais raso (bottom-up)
  const sorted = [...rows].sort((a, b) => (b.nivel || 0) - (a.nivel || 0));

  sorted.forEach(r => {
    const kids = childrenOf[r.id];
    if (!r.eh_resumo || !kids || kids.length === 0) return;

    const kidRows = kids.map(cid => byId[cid]).filter(Boolean);
    if (!kidRows.length) return;

    // ── Média simples: cada filho direto pesa 1/N ─────────────────────────
    // Filhos sem contrato contribuem 0%; filhos com contrato contribuem seu %.
    // Resultado = média proporcional ao total de filhos no nível.
    const pctRollup = Math.round(
      kidRows.reduce((s, k) => s + (parseFloat(k.pct_realizado_calc) || 0), 0)
      / kidRows.length
      * 100
    ) / 100;

    // Quantos filhos diretos têm medições ou roll-up com medições
    const comMed = kidRows.filter(k =>
      k.pct_medicoes != null || k.eh_rollup
    ).length;

    // Salva always o valor roll-up para exibição no front
    r.pct_rollup    = pctRollup;
    r.rollup_filhos = kidRows.length;
    r.rollup_com_med = comMed;

    // Substitui pct_realizado_calc apenas se o próprio nó não tem medições diretas
    if (r.pct_medicoes == null) {
      r.pct_realizado_calc = pctRollup;
      r.eh_rollup          = true;
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// ROTA: GET /:id/financeiro
// Retorna resumo financeiro: valor contratado vs. valor medido/executado
// para todos os contratos vinculados às atividades deste cronograma.
// ═══════════════════════════════════════════════════════════════
router.get('/:id/financeiro', auth, async (req, res) => {
  try {
    const cronId = parseInt(req.params.id);
    if (!cronId) return res.status(400).json({ error: 'ID inválido' });

    const r = await db.query(`
      WITH contratos_cron AS (
        -- Contratos vinculados a pelo menos uma atividade deste cronograma
        SELECT DISTINCT c.id AS contrato_id,
               c.valor_total,
               c.numero,
               c.status,
               COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) AS fornecedor
          FROM contratos_atividades ca
          JOIN atividades_cronograma a ON a.id = ca.atividade_id AND a.cronograma_id = $1
          JOIN contratos c ON c.id = ca.contrato_id
          JOIN fornecedores f ON f.id = c.fornecedor_id
         WHERE c.status NOT IN ('Cancelado')
      ),
      val_fis_calc AS (
        -- val_fis usando a mesma lógica de 4 níveis de fallback do endpoint de atividades
        SELECT sub.contrato_id,
          SUM(COALESCE(NULLIF(sub.val_itens, 0), sub.valor_medicao, 0)) AS val_fis
        FROM (
          SELECT m.contrato_id, m.id,
                 COALESCE(m.valor_medicao, 0) AS valor_medicao,
                 COALESCE(SUM(
                   mi.qtd_mes * COALESCE(
                     NULLIF(mi.valor_unitario, 0),
                     ci.valor_unitario,
                     (SELECT ci2.valor_unitario FROM contrato_itens ci2
                       WHERE ci2.contrato_id = m.contrato_id
                         AND LOWER(TRIM(ci2.descricao)) = LOWER(TRIM(mi.descricao))
                       ORDER BY ci2.id DESC LIMIT 1),
                     0
                   )
                 ), 0) AS val_itens
            FROM medicoes m
            JOIN medicao_itens mi ON mi.medicao_id = m.id
            LEFT JOIN contrato_itens ci ON ci.id = mi.contrato_item_id
           WHERE m.contrato_id IN (SELECT contrato_id FROM contratos_cron)
             AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
             AND m.tipo IN ('Normal','Avanco_Fisico')
           GROUP BY m.contrato_id, m.id, m.valor_medicao
        ) sub
        GROUP BY sub.contrato_id
      )
      SELECT
        COALESCE(SUM(cc.valor_total), 0)                       AS val_contratado,
        COALESCE(SUM(vf.val_fis), 0)                           AS val_medido,
        COUNT(cc.contrato_id)::int                             AS qtd_contratos,
        CASE WHEN SUM(cc.valor_total) > 0
          THEN ROUND(COALESCE(SUM(vf.val_fis),0) / SUM(cc.valor_total) * 100, 2)
          ELSE 0
        END                                                     AS pct_financeiro,
        -- Orçado: soma do custo_planejado das atividades raiz (nível mais alto, sem pai)
        -- Representa o orçamento total importado do MS Project
        (SELECT COALESCE(SUM(a2.custo_planejado), 0)
           FROM atividades_cronograma a2
          WHERE a2.cronograma_id = $1
            AND a2.parent_id IS NULL)                           AS val_orcado
      FROM contratos_cron cc
      LEFT JOIN val_fis_calc vf ON vf.contrato_id = cc.contrato_id
    `, [cronId]);

    res.json(r.rows[0] || { val_contratado: 0, val_medido: 0, qtd_contratos: 0, pct_financeiro: 0, val_orcado: 0 });
  } catch (err) {
    console.error('[GET /cronogramas/:id/financeiro]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: GET /:id
// ═══════════════════════════════════════════════════════════════
router.get('/:id', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT c.*, o.nome AS obra_nome
         FROM cronogramas c
         JOIN obras o ON o.id = c.obra_id
        WHERE c.id = $1`,
      [parseInt(req.params.id)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Cronograma não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: PUT /:id  — atualizar nome / ativo
// ═══════════════════════════════════════════════════════════════
router.put('/:id', auth, perm('cronogramaEditar'), async (req, res) => {
  try {
    const { nome, ativo } = req.body;
    const r = await db.query(
      `UPDATE cronogramas SET
         nome  = COALESCE($1, nome),
         ativo = COALESCE($2, ativo)
       WHERE id = $3 RETURNING *`,
      [nome || null, ativo != null ? ativo : null, parseInt(req.params.id)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Cronograma não encontrado.' });
    const row = r.rows[0];
    await audit(req, 'editar', 'cronograma', row.id,
      `Cronograma "${row.nome}" atualizado`);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: PUT /atividades/:id — edição completa de uma atividade
// ═══════════════════════════════════════════════════════════════
router.put('/atividades/:id', auth, perm('cronogramaEditar'), async (req, res) => {
  try {
    const { nome, wbs, data_inicio, data_termino, duracao, pct_planejado, pct_realizado } = req.body;
    const clamp = (v, lo, hi) => v != null ? Math.min(hi, Math.max(lo, parseFloat(v))) : null;
    const r = await db.query(
      `UPDATE atividades_cronograma SET
         nome          = COALESCE($1, nome),
         wbs           = COALESCE($2, wbs),
         data_inicio   = COALESCE($3::date, data_inicio),
         data_termino  = COALESCE($4::date, data_termino),
         duracao       = COALESCE($5::int,  duracao),
         pct_planejado = COALESCE($6::numeric, pct_planejado),
         pct_realizado = COALESCE($7::numeric, pct_realizado)
       WHERE id = $8 RETURNING *`,
      [
        nome  ? nome.trim().slice(0, 500) : null,
        wbs   ? wbs.trim().slice(0, 50)  : null,
        data_inicio  || null,
        data_termino || null,
        duracao  != null ? parseInt(duracao)               : null,
        pct_planejado != null ? clamp(pct_planejado, 0, 100) : null,
        pct_realizado != null ? clamp(pct_realizado, 0, 100) : null,
        parseInt(req.params.id),
      ]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Atividade não encontrada.' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[PUT /cronogramas/atividades/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: PUT /atividades/:id/pct — atualização manual de % realizado
// ═══════════════════════════════════════════════════════════════
router.put('/atividades/:id/pct', auth, perm('cronogramaEditar'), async (req, res) => {
  try {
    const pct = Math.min(100, Math.max(0, parseFloat(req.body.pct_realizado) || 0));
    const r = await db.query(
      'UPDATE atividades_cronograma SET pct_realizado=$1 WHERE id=$2 RETURNING *',
      [pct, parseInt(req.params.id)]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Atividade não encontrada.' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: GET /:id/export-xml — exporta cronograma como MS Project XML
// ═══════════════════════════════════════════════════════════════
router.get('/:id/export-xml', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const cronR = await db.query(
      'SELECT c.*, o.nome AS obra_nome FROM cronogramas c JOIN obras o ON o.id=c.obra_id WHERE c.id=$1',
      [id]
    );
    if (!cronR.rows.length) return res.status(404).json({ error: 'Cronograma não encontrado.' });
    const cron = cronR.rows[0];

    const r = await db.query(
      'SELECT * FROM atividades_cronograma WHERE cronograma_id=$1 ORDER BY ordem',
      [id]
    );
    const atividades = r.rows;

    // ── Helpers de geração XML ─────────────────────────────────
    const escXml = (s) => String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    const toMsDate = (d) => {
      if (!d) return null;
      const iso = new Date(d).toISOString().slice(0, 10);
      return iso + 'T08:00:00';
    };
    const toMsDateFinish = (d) => {
      if (!d) return null;
      const iso = new Date(d).toISOString().slice(0, 10);
      return iso + 'T17:00:00';
    };
    const durStr = (dias) => dias && dias > 0 ? `PT${dias * 8}H0M0S` : 'PT8H0M0S';

    // ── Monta <Task> para cada atividade ──────────────────────
    const taskXml = atividades.map((a, i) => {
      const uid  = a.uid_externo || (i + 2); // 1 reservado para tarefa raiz
      const sid  = i + 1;
      const di   = toMsDate(a.data_inicio);
      const df   = toMsDateFinish(a.data_termino);
      const pct  = Math.round(parseFloat(a.pct_planejado) || 0);
      const outl = a.wbs || String(sid);
      return [
        '    <Task>',
        `      <UID>${uid}</UID>`,
        `      <ID>${sid}</ID>`,
        `      <Name>${escXml(a.nome)}</Name>`,
        `      <WBS>${escXml(outl)}</WBS>`,
        `      <OutlineNumber>${escXml(outl)}</OutlineNumber>`,
        `      <OutlineLevel>${Math.max(1, a.nivel || 1)}</OutlineLevel>`,
        di ? `      <Start>${di}</Start>` : '',
        df ? `      <Finish>${df}</Finish>` : '',
        `      <Duration>${durStr(a.duracao)}</Duration>`,
        `      <PercentComplete>${pct}</PercentComplete>`,
        `      <Summary>${a.eh_resumo ? 1 : 0}</Summary>`,
        `      <Active>1</Active>`,
        '    </Task>',
      ].filter(Boolean).join('\n');
    }).join('\n');

    // ── Tarefa raiz (UID=0, obrigatória no formato MS Project) ─
    const projStart = cron.data_inicio ? toMsDate(cron.data_inicio) : '2025-01-01T08:00:00';
    const projFinish = cron.data_termino ? toMsDateFinish(cron.data_termino) : '2026-12-31T17:00:00';

    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>${escXml(cron.nome)}</Name>
  <Title>${escXml(cron.nome)}</Title>
  <StartDate>${projStart}</StartDate>
  <FinishDate>${projFinish}</FinishDate>
  <Tasks>
    <Task>
      <UID>0</UID>
      <ID>0</ID>
      <Name>${escXml(cron.nome)}</Name>
      <Start>${projStart}</Start>
      <Finish>${projFinish}</Finish>
      <Summary>1</Summary>
    </Task>
${taskXml}
  </Tasks>
</Project>`;

    const safeName = (cron.nome || 'cronograma').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60);
    const filename = `${safeName}_v${cron.versao}.xml`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err) {
    console.error('[GET /cronogramas/:id/export-xml]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: POST /:id/chat  — IA conversacional sobre o cronograma
// ═══════════════════════════════════════════════════════════════
router.post('/:id/chat', auth, perm('cronogramaIA'), async (req, res) => {
  try {
    const id      = parseInt(req.params.id);
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });

    const { _iaGetKey } = require('../helpers/ia');
    const apiKey = await _iaGetKey();
    if (!apiKey) return res.status(400).json({ error: 'Chave Gemini não configurada. Acesse Configurações → IA.' });

    // ── 1. Monta contexto do cronograma ──────────────────────────────────
    const [cronRow, atvsRow, contratosRow, medicoesRow] = await Promise.all([
      // Cronograma + obra
      db.query(
        `SELECT c.id, c.nome AS cron_nome, c.versao, c.data_inicio, c.data_termino,
                o.nome AS obra_nome, o.id AS obra_id
           FROM cronogramas c JOIN obras o ON o.id = c.obra_id
          WHERE c.id = $1`, [id]
      ),

      // TODAS as atividades com detalhe completo de medição por WBS
      db.query(
        `SELECT a.id, a.wbs, a.nome, a.nivel, a.duracao,
                a.data_inicio, a.data_termino,
                a.pct_planejado, a.pct_realizado, a.eh_resumo,
                a.custo_planejado,
                mc.qtd_contratos,
                mc.qtd_com_medicoes,
                mc.val_contratado,
                mc.val_medido,
                mc.pct_medicoes,
                COALESCE(mc.pct_medicoes, a.pct_realizado) AS pct_calc
           FROM atividades_cronograma a
           LEFT JOIN LATERAL (
             SELECT
               COUNT(DISTINCT ca.contrato_id)::int AS qtd_contratos,
               COUNT(DISTINCT ca.contrato_id) FILTER (
                 WHERE ex.val_fis > 0
               )::int AS qtd_com_medicoes,
               COALESCE(SUM(c.valor_total), 0) AS val_contratado,
               COALESCE(SUM(ex.val_fis), 0)    AS val_medido,
               CASE WHEN SUM(c.valor_total) > 0
                 THEN ROUND(COALESCE(SUM(ex.val_fis),0) / SUM(c.valor_total) * 100, 1)
                 ELSE NULL
               END AS pct_medicoes
             FROM contratos_atividades ca
             JOIN contratos c ON c.id = ca.contrato_id
             LEFT JOIN LATERAL (
               SELECT SUM(COALESCE(NULLIF(sub.val_itens,0), sub.valor_medicao, 0)) AS val_fis
               FROM (
                 SELECT m.id,
                   COALESCE(m.valor_medicao, 0) AS valor_medicao,
                   COALESCE(SUM(
                     mi.qtd_mes * COALESCE(
                       NULLIF(mi.valor_unitario,0),
                       ci.valor_unitario,
                       (SELECT ci2.valor_unitario FROM contrato_itens ci2
                         WHERE ci2.contrato_id = c.id
                           AND LOWER(TRIM(ci2.descricao)) = LOWER(TRIM(mi.descricao))
                         ORDER BY ci2.id DESC LIMIT 1),
                       0
                     )
                   ), 0) AS val_itens
                 FROM medicoes m
                 JOIN medicao_itens mi ON mi.medicao_id = m.id
                 LEFT JOIN contrato_itens ci ON ci.id = mi.contrato_item_id
                 WHERE m.contrato_id = c.id
                   AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                   AND m.tipo IN ('Normal','Avanco_Fisico')
                 GROUP BY m.id, m.valor_medicao
               ) sub
             ) ex ON true
             WHERE ca.atividade_id = a.id
           ) mc ON true
          WHERE a.cronograma_id = $1
          ORDER BY a.ordem
          LIMIT 300`, [id]
      ),

      // Contratos com medição detalhada (val_medido, pct_medido, qtd_medicoes)
      db.query(
        `SELECT c.numero, c.objeto, c.valor_total, c.status,
                COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) AS fornecedor,
                STRING_AGG(DISTINCT a.wbs, ', ' ORDER BY a.wbs) AS wbs_vinculadas,
                COUNT(DISTINCT m.id)::int AS qtd_medicoes,
                COALESCE(SUM(ex.val_fis), 0) AS val_medido,
                CASE WHEN c.valor_total > 0
                  THEN ROUND(COALESCE(SUM(ex.val_fis),0) / c.valor_total * 100, 1)
                  ELSE 0
                END AS pct_medido
           FROM contratos c
           JOIN obras o ON o.id = c.obra_id
           JOIN fornecedores f ON f.id = c.fornecedor_id
           LEFT JOIN contratos_atividades ca ON ca.contrato_id = c.id
           LEFT JOIN atividades_cronograma a ON a.id = ca.atividade_id AND a.cronograma_id = $1
           LEFT JOIN medicoes m ON m.contrato_id = c.id
             AND m.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
             AND m.tipo IN ('Normal','Avanco_Fisico')
           LEFT JOIN LATERAL (
             SELECT SUM(COALESCE(NULLIF(sub.val_itens,0), sub.valor_medicao, 0)) AS val_fis
             FROM (
               SELECT mm.id,
                 COALESCE(mm.valor_medicao, 0) AS valor_medicao,
                 COALESCE(SUM(
                   mi.qtd_mes * COALESCE(
                     NULLIF(mi.valor_unitario,0),
                     ci.valor_unitario,
                     0
                   )
                 ), 0) AS val_itens
               FROM medicoes mm
               JOIN medicao_itens mi ON mi.medicao_id = mm.id
               LEFT JOIN contrato_itens ci ON ci.id = mi.contrato_item_id
               WHERE mm.contrato_id = c.id
                 AND mm.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                 AND mm.tipo IN ('Normal','Avanco_Fisico')
               GROUP BY mm.id, mm.valor_medicao
             ) sub
           ) ex ON true
          WHERE o.id = (SELECT obra_id FROM cronogramas WHERE id = $1)
          GROUP BY c.numero, c.objeto, c.valor_total, c.status,
                   f.nome_fantasia, f.razao_social
          ORDER BY c.numero
          LIMIT 80`, [id]
      ),

      // Medições de todos os contratos vinculados ao cronograma — com status de aprovação
      db.query(
        `SELECT m.id, m.codigo, m.periodo, m.tipo, m.status,
                m.valor_medicao, m.pct_mes, m.pct_total,
                m.criado_em,
                c.numero AS contrato_numero,
                COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) AS fornecedor,
                -- Último evento de aprovação
                ap.ultimo_nivel, ap.ultima_acao, ap.ultimo_usuario, ap.ultima_data,
                -- Flag de assinatura enviada
                (m.status = 'Em Assinatura') AS enviado_assinatura
           FROM medicoes m
           JOIN contratos c ON c.id = m.contrato_id
           JOIN fornecedores f ON f.id = m.fornecedor_id
           -- Histórico de aprovação mais recente por medição (JOIN antes do WHERE)
           LEFT JOIN LATERAL (
             SELECT apv.nivel AS ultimo_nivel, apv.acao AS ultima_acao,
                    apv.usuario AS ultimo_usuario, apv.data_hora AS ultima_data
               FROM aprovacoes apv
              WHERE apv.medicao_id = m.id
              ORDER BY apv.data_hora DESC
              LIMIT 1
           ) ap ON true
           -- Filtra apenas contratos vinculados a atividades deste cronograma
          WHERE c.id IN (
             SELECT DISTINCT ca.contrato_id
               FROM contratos_atividades ca
               JOIN atividades_cronograma a ON a.id = ca.atividade_id
              WHERE a.cronograma_id = $1
           )
          ORDER BY m.criado_em DESC
          LIMIT 150`, [id]
      ),
    ]);

    if (!cronRow.rows.length) return res.status(404).json({ error: 'Cronograma não encontrado.' });
    const cron = cronRow.rows[0];

    // ── 2. Formata contexto como texto estruturado ────────────────────────
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
    const fmtPct  = (v) => v != null ? `${parseFloat(v).toFixed(1)}%` : '—';
    const fmtVal  = (v) => v != null ? parseFloat(v).toLocaleString('pt-BR', {style:'currency', currency:'BRL'}) : '—';

    // Separa atividades por status de medição para facilitar análise da IA
    const atividades = atvsRow.rows;
    const folhas          = atividades.filter(a => !a.eh_resumo);
    const folhasComMed    = folhas.filter(a => parseFloat(a.val_medido) > 0);
    const folhasSemMed    = folhas.filter(a => parseFloat(a.val_medido) === 0 && (a.qtd_contratos > 0));
    const folhasSemCont   = folhas.filter(a => (a.qtd_contratos || 0) === 0);
    const resumos         = atividades.filter(a => a.eh_resumo);

    // Linha por atividade: indenta por nível, marca status de medição
    const atvLines = atividades.map(a => {
      const ind    = '  '.repeat(a.nivel || 0);
      const tipo   = a.eh_resumo ? '[RESUMO]' : '[TAREFA]';
      const wbs    = a.wbs ? `[${a.wbs}]` : '';
      const plan   = `Plan:${fmtPct(a.pct_planejado)}`;
      const real   = `Real:${fmtPct(a.pct_calc)}`;
      const dur    = a.duracao ? `${a.duracao}d` : '—';
      const conts  = `Contratos:${a.qtd_contratos || 0}`;

      const custoPlan = a.custo_planejado != null && parseFloat(a.custo_planejado) > 0
        ? `CustoPlan:${fmtVal(a.custo_planejado)}`
        : '';

      if (a.eh_resumo) {
        return `${ind}${tipo} ${wbs} ${a.nome} | ${plan} | ${real} | Dur:${dur}${custoPlan ? ' | ' + custoPlan : ''}`;
      }

      // Folha com contrato
      if ((a.qtd_contratos || 0) > 0) {
        const medStatus = parseFloat(a.val_medido) > 0
          ? `MEDIDO(${fmtPct(a.pct_medicoes)}) ValMedido:${fmtVal(a.val_medido)} de ${fmtVal(a.val_contratado)}`
          : `NAO_MEDIDO ValContratado:${fmtVal(a.val_contratado)}`;
        return `${ind}${tipo} ${wbs} ${a.nome} | ${plan} | ${real} | Dur:${dur} | ${conts} | ${medStatus}${custoPlan ? ' | ' + custoPlan : ''}`;
      }

      // Folha sem contrato
      return `${ind}${tipo} ${wbs} ${a.nome} | ${plan} | ${real} | Dur:${dur} | SEM_CONTRATO${custoPlan ? ' | ' + custoPlan : ''}`;
    }).join('\n');

    // Resumo estatístico para orientar a IA
    const totalValCont = contratosRow.rows.reduce((s, c) => s + (parseFloat(c.valor_total)||0), 0);
    const totalValMed  = contratosRow.rows.reduce((s, c) => s + (parseFloat(c.val_medido)||0), 0);
    const pctGlobal    = totalValCont > 0 ? (totalValMed / totalValCont * 100).toFixed(1) : '0.0';

    const contLines = contratosRow.rows.map(c =>
      `• Contrato:${c.numero} | Fornecedor:${c.fornecedor} | Objeto:${(c.objeto||'—').substring(0,80)}` +
      ` | ValorContrato:${fmtVal(c.valor_total)} | Status:${c.status}` +
      ` | Medicoes:${c.qtd_medicoes} | ValMedido:${fmtVal(c.val_medido)} | %Medido:${fmtPct(c.pct_medido)}` +
      ` | WBS:${c.wbs_vinculadas || 'não vinculado'}`
    ).join('\n');

    // ── Formata medições com status de aprovação e assinatura ────
    const statusLabel = {
      'Rascunho':      'Rascunho (não submetida)',
      'Aguardando N1': 'Aguardando aprovação N1',
      'Aguardando N2': 'Aguardando aprovação N2',
      'Aguardando N3': 'Aguardando aprovação N3',
      'Aprovado':      'Aprovada (todas as alçadas)',
      'Em Assinatura': 'Enviada para assinatura digital',
      'Reprovado':     'Reprovada',
    };

    // Agrupa medições por contrato para melhor leitura
    const medByContrato = {};
    medicoesRow.rows.forEach(m => {
      if (!medByContrato[m.contrato_numero]) medByContrato[m.contrato_numero] = [];
      medByContrato[m.contrato_numero].push(m);
    });

    const medLines = Object.entries(medByContrato).map(([num, meds]) => {
      const linhas = meds.map(m => {
        const status    = statusLabel[m.status] || m.status;
        const val       = m.valor_medicao ? `ValorMedição:${fmtVal(m.valor_medicao)}` : '';
        const pct       = m.pct_mes != null ? `%Mês:${fmtPct(m.pct_mes)}` : '';
        const pctAcum   = m.pct_total != null ? `%Acum:${fmtPct(m.pct_total)}` : '';
        const assin     = m.enviado_assinatura ? ' | ✅ Enviada para assinatura' : '';
        const ultAp     = m.ultimo_nivel
          ? ` | ÚltimaAção:${m.ultima_acao} no ${m.ultimo_nivel} por ${m.ultimo_usuario} em ${fmtDate(m.ultima_data)}`
          : '';
        return `    - Medição:${m.codigo||'#'+m.id} | Período:${m.periodo||'—'} | Tipo:${m.tipo}` +
               ` | ${val} | ${pct} | ${pctAcum} | STATUS: ${status}${assin}${ultAp}`;
      }).join('\n');
      return `  Contrato ${num} | Fornecedor:${meds[0].fornecedor}:\n${linhas}`;
    }).join('\n\n');

    // Resumo do pipeline de aprovação
    const medRows = medicoesRow.rows;
    const aggStatus = {};
    medRows.forEach(m => { aggStatus[m.status] = (aggStatus[m.status]||0) + 1; });
    const pipelineLines = Object.entries(aggStatus)
      .map(([s, n]) => `  ${n}x ${statusLabel[s]||s}`)
      .join('\n');

    const systemContext = `Você é um assistente especializado em gestão de obras e cronogramas, chamado Construv IA.
Você tem acesso COMPLETO aos dados do cronograma abaixo e deve responder de forma clara, objetiva e em português brasileiro.
Você pode analisar progresso físico e financeiro, identificar itens não medidos, comparar planejado vs realizado, e explicar dados de contratos.
Seja direto e use linguagem técnica adequada para gestão de obras.

═══════════════════════════════════════════════════════
CRONOGRAMA: ${cron.cron_nome} (v${cron.versao})
OBRA: ${cron.obra_nome}
PERÍODO: ${fmtDate(cron.data_inicio)} → ${fmtDate(cron.data_termino)}
Data de hoje: ${new Date().toLocaleDateString('pt-BR')}
═══════════════════════════════════════════════════════

RESUMO FINANCEIRO GLOBAL:
• Total contratado: ${fmtVal(totalValCont)}
• Total medido/executado: ${fmtVal(totalValMed)}
• % medido sobre contratado: ${pctGlobal}%

RESUMO DAS ATIVIDADES (tarefas folha):
• Total de tarefas: ${folhas.length}
• Com medição registrada: ${folhasComMed.length} tarefas
• Com contrato mas SEM medição: ${folhasSemMed.length} tarefas
• Sem contrato associado: ${folhasSemCont.length} tarefas
• Resumos (nós pai): ${resumos.length}

═══════════════════════════════════════════════════════
TODAS AS ATIVIDADES DO CRONOGRAMA (todos os níveis):
Legenda: MEDIDO=tem medição aprovada | NAO_MEDIDO=tem contrato mas nenhuma medição | SEM_CONTRATO=sem contrato vinculado

${atvLines || '(nenhuma atividade encontrada)'}

═══════════════════════════════════════════════════════
CONTRATOS E SITUAÇÃO FINANCEIRA:
(ValMedido = soma das medições aprovadas; %Medido = ValMedido/ValorContrato)

${contLines || '(nenhum contrato cadastrado)'}

═══════════════════════════════════════════════════════
PIPELINE DE APROVAÇÃO DAS MEDIÇÕES:
(Fluxo: Rascunho → Aguardando N1 → Aguardando N2 → Aguardando N3 → Aprovado → Em Assinatura)

Situação atual:
${pipelineLines || '  Nenhuma medição cadastrada'}

DETALHE DE CADA MEDIÇÃO (por contrato):
${medLines || '(nenhuma medição encontrada)'}

═══════════════════════════════════════════════════════
Instruções: Responda sempre em português. Use os dados acima para:
- Identificar itens não medidos (atividades marcadas como NAO_MEDIDO)
- Informar em qual nível de aprovação está cada medição (N1/N2/N3)
- Dizer se uma medição foi enviada para assinatura digital
- Analisar progresso físico e financeiro por WBS e por contrato
- Identificar gargalos no fluxo de aprovação`;

    // ── 3. Monta histórico de conversa para o Gemini ─────────────────────
    const contents = [
      // Contexto do sistema como primeira mensagem do usuário + ack do modelo
      { role: 'user',  parts: [{ text: systemContext }] },
      { role: 'model', parts: [{ text: 'Entendido! Tenho acesso aos dados do cronograma e estou pronto para ajudar. Como posso auxiliá-lo?' }] },
      // Histórico da conversa atual
      ...history.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      })),
      // Mensagem atual do usuário
      { role: 'user', parts: [{ text: message.trim() }] },
    ];

    // ── 4. Chama Gemini ───────────────────────────────────────────────────
    const gResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!gResp.ok) {
      const err = await gResp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Erro na API Gemini: HTTP ${gResp.status}`);
    }
    const gData = await gResp.json();
    const allParts = gData?.candidates?.[0]?.content?.parts || [];
    const reply = allParts
      .filter(p => p.text && !p.thought)
      .map(p => p.text).join('')
      || allParts.map(p => p.text || '').join('');

    res.json({ reply: reply.trim() });
  } catch (err) {
    console.error('[POST /cronogramas/:id/chat]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: DELETE /:id
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', auth, perm('cronogramaEditar'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const prev = await db.query('SELECT nome, versao FROM cronogramas WHERE id=$1', [id]);
    await db.query('DELETE FROM cronogramas WHERE id=$1', [id]);
    const c = prev.rows[0];
    await audit(req, 'excluir', 'cronograma', id,
      `Cronograma "${c?.nome || id}" v${c?.versao || '?'} excluído`);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
