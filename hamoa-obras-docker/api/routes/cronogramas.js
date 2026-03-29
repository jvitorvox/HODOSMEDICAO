/**
 * HAMOA OBRAS — Rotas de Cronograma
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
  const FIELD_RE = /^\s*<(UID|ID|Name|WBS|OutlineNumber|OutlineLevel|Start|Finish|Duration|PercentComplete|Summary|Active)>(.*?)<\/\1>\s*$/;

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

    result.atividades.push({
      uid_externo:   uid,
      parent_uid:    parentUID,
      wbs:           decXml(t.WBS || t.OutlineNumber || t.ID || String(uid)).slice(0, 50),
      nome,
      data_inicio:   start  ? start.toISOString().slice(0, 10)  : null,
      data_termino:  finish ? finish.toISOString().slice(0, 10) : null,
      duracao:       durDias,
      nivel:         Math.max(0, parseInt(t.OutlineLevel) || 0),
      pct_planejado: Math.min(100, Math.max(0, parseFloat(t.PercentComplete) || 0)),
      eh_resumo:     t.Summary === '1',
      ordem:         ordem++,
    });
  }

  return result;
}

// ── Salva atividades em bulk (unnest) — 2 queries para qualquer volume ─────────
async function _saveAtividades(client, cronogramaId, atividades) {
  if (!atividades.length) return;

  // Prepara colunas como arrays paralelos para unnest do PostgreSQL
  const wbss = [], nomes = [], dataInis = [], dataFins = [],
        duracoes = [], niveis = [], pcts = [], ehResumos = [], ordens = [], uids = [];

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
  }

  // ── INSERT em bloco único via unnest — 1 roundtrip ao banco ─────────────────
  await client.query(`
    INSERT INTO atividades_cronograma
      (cronograma_id, wbs, nome, data_inicio, data_termino, duracao,
       nivel, pct_planejado, eh_resumo, ordem, uid_externo)
    SELECT $1,
           unnest($2::text[]),    unnest($3::text[]),
           unnest($4::date[]),    unnest($5::date[]),
           unnest($6::int[]),     unnest($7::int[]),
           unnest($8::numeric[]), unnest($9::bool[]),
           unnest($10::int[]),    unnest($11::int[])
  `, [cronogramaId, wbss, nomes, dataInis, dataFins,
      duracoes, niveis, pcts, ehResumos, ordens, uids]);

  // ── UPDATE parent_id em bloco único via unnest + self-join ──────────────────
  // Monta arrays apenas para atividades que têm pai
  const childUids = [], parentUids = [];
  for (const a of atividades) {
    if (a.uid_externo && a.parent_uid) {
      childUids .push(a.uid_externo);
      parentUids.push(a.parent_uid);
    }
  }

  if (childUids.length > 0) {
    await client.query(`
      UPDATE atividades_cronograma child
      SET parent_id = parent.id
      FROM unnest($2::int[], $3::int[]) AS m(child_uid, parent_uid_ext)
      JOIN atividades_cronograma parent
        ON parent.uid_externo = m.parent_uid_ext
       AND parent.cronograma_id = $1
      WHERE child.uid_externo  = m.child_uid
        AND child.cronograma_id = $1
    `, [cronogramaId, childUids, parentUids]);
  }
}

// ═══════════════════════════════════════════════════════════════
// ROTA: POST /importar
// ═══════════════════════════════════════════════════════════════
router.post('/importar', auth, (req, res, next) => {
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

      await _saveAtividades(client, cronogramaId, parsed.atividades);

      await client.query('COMMIT');

      res.status(201).json({
        id:          cronogramaId,
        nome,
        versao,
        substituido: !!replaceId,
        atividades:  parsed.atividades.length,
        dataInicio:  parsed.dataInicio,
        dataTermino: parsed.dataTermino,
      });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[cronogramas/importar]', err);
    res.status(500).json({ error: err.message || 'Erro ao importar cronograma.' });
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

    // Busca atividades com % realizado calculado dinamicamente dos contratos vinculados
    const r = await db.query(
      `SELECT
         a.id, a.cronograma_id, a.parent_id, a.wbs, a.nome,
         a.data_inicio, a.data_termino, a.duracao, a.nivel,
         a.pct_planejado, a.eh_resumo, a.ordem,
         -- Progresso calculado a partir dos contratos vinculados (média simples)
         COALESCE(
           (SELECT ROUND(AVG(
              CASE WHEN c.valor_total > 0
                   THEN LEAST(100, COALESCE(ex.valor_executado, 0) / c.valor_total * 100)
                   ELSE c.pct_executado END
            ), 2)
            FROM contratos_atividades ca
            JOIN contratos c ON c.id = ca.contrato_id
            LEFT JOIN (
              SELECT m.contrato_id, SUM(mi.valor_item) AS valor_executado
              FROM medicao_itens mi
              JOIN medicoes m ON m.id = mi.medicao_id
              WHERE m.status NOT IN ('Rascunho','Reprovado')
              GROUP BY m.contrato_id
            ) ex ON ex.contrato_id = c.id
            WHERE ca.atividade_id = a.id
           ),
           a.pct_realizado
         ) AS pct_realizado_calc,
         -- Contratos vinculados (resumo)
         (SELECT json_agg(json_build_object(
            'id', c.id,
            'numero', c.numero,
            'fornecedor', COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social)
          ))
          FROM contratos_atividades ca
          JOIN contratos c ON c.id = ca.contrato_id
          JOIN fornecedores f ON f.id = c.fornecedor_id
          WHERE ca.atividade_id = a.id
         ) AS contratos_vinculados
       FROM atividades_cronograma a
       WHERE a.cronograma_id = $1
       ORDER BY a.ordem`,
      [id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[GET /cronogramas/:id/atividades]', err);
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
router.put('/:id', auth, async (req, res) => {
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
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTA: PUT /atividades/:id — edição completa de uma atividade
// ═══════════════════════════════════════════════════════════════
router.put('/atividades/:id', auth, async (req, res) => {
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
router.put('/atividades/:id/pct', auth, async (req, res) => {
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
// ROTA: DELETE /:id
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM cronogramas WHERE id=$1', [parseInt(req.params.id)]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
