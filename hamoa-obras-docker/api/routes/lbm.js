/**
 * CONSTRUTIVO OBRAS — Rotas LBM (Location Based Management)
 *
 * GET  /api/lbm/:obraId/locais            — lista locais (hierárquicos)
 * POST /api/lbm/:obraId/locais            — criar local
 * PUT  /api/lbm/:obraId/locais/:id        — editar local
 * DELETE /api/lbm/:obraId/locais/:id      — excluir local
 * POST /api/lbm/:obraId/locais/reordenar  — reordenar locais
 *
 * GET  /api/lbm/:obraId/servicos          — lista serviços com fornecedor
 * POST /api/lbm/:obraId/servicos          — criar serviço
 * PUT  /api/lbm/:obraId/servicos/:id      — editar serviço
 * DELETE /api/lbm/:obraId/servicos/:id    — excluir serviço
 * POST /api/lbm/:obraId/servicos/reordenar— reordenar serviços
 *
 * GET  /api/lbm/:obraId/progresso         — matriz de progresso Local × Serviço
 * POST /api/lbm/:obraId/progresso         — criar/atualizar progresso de uma célula
 * POST /api/lbm/:obraId/progresso/batch   — atualizar múltiplas células
 *
 * GET  /api/lbm/:obraId/dashboard         — resumo executivo (% por serviço, conflitos)
 * POST /api/lbm/:obraId/calcular-plano    — gera datas planejadas baseado nos ritmos
 *
 * POST /api/lbm/:obraId/importar-ia       — interpreta arquivo via Gemini e retorna prévia
 * POST /api/lbm/:obraId/importar-ia/confirmar — aplica a importação confirmada no banco
 */
'use strict';

const router = require('express').Router({ mergeParams: true });
const db     = require('../db');
const auth   = require('../middleware/auth');
const audit  = require('../middleware/audit');
const { getObrasPermitidas, temAcessoObra } = require('../middleware/obras');
const { uploadMem, _iaGetKey, _iaFileToParts, _iaCall, _parseDate } = require('../helpers/ia');

const obraId = req => parseInt(req.params.obraId);

// ─── Helper: garante que a obra existe e o usuário tem acesso ──────────────
async function _checkObra(req, res) {
  const r = await db.query('SELECT id, nome, metodologia FROM obras WHERE id=$1', [obraId(req)]);
  if (!r.rows[0]) { res.status(404).json({ error: 'Obra não encontrada' }); return null; }
  const obras = await getObrasPermitidas(req, db);
  if (!temAcessoObra(obras, r.rows[0].id)) {
    res.status(403).json({ error: 'Acesso negado a esta obra.' });
    return null;
  }
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════════════
//  LOCAIS
// ════════════════════════════════════════════════════════════════════════

// Lista todos os locais da obra (árvore hierárquica)
router.get('/:obraId/locais', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT l.*,
              (SELECT COUNT(*) FROM lbm_locais c WHERE c.parent_id = l.id) AS filhos
       FROM lbm_locais l
       WHERE l.obra_id = $1
       ORDER BY l.parent_id NULLS FIRST, l.ordem, l.id`,
      [obraId(req)]
    );
    // Monta árvore
    const byId  = {};
    const roots = [];
    r.rows.forEach(row => { row.filhos = parseInt(row.filhos); row.children = []; byId[row.id] = row; });
    r.rows.forEach(row => {
      if (row.parent_id && byId[row.parent_id]) byId[row.parent_id].children.push(row);
      else roots.push(row);
    });
    res.json(roots);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista locais plana (para selects e tabelas)
router.get('/:obraId/locais/flat', auth, async (req, res) => {
  try {
    const r = await db.query(
      `WITH RECURSIVE hier AS (
         SELECT id, obra_id, parent_id, nome, tipo, ordem, 0 AS nivel,
                nome::text AS caminho_nome
         FROM lbm_locais WHERE obra_id=$1 AND parent_id IS NULL
         UNION ALL
         SELECT l.id, l.obra_id, l.parent_id, l.nome, l.tipo, l.ordem,
                h.nivel+1, (h.caminho_nome || ' > ' || l.nome)
         FROM lbm_locais l JOIN hier h ON l.parent_id=h.id
       )
       SELECT * FROM hier ORDER BY caminho_nome`,
      [obraId(req)]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Criar local
router.post('/:obraId/locais', auth, async (req, res) => {
  try {
    const { nome, tipo = 'local', parent_id = null, ordem = 0 } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome do local é obrigatório' });
    const r = await db.query(
      `INSERT INTO lbm_locais (obra_id, parent_id, nome, tipo, ordem)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [obraId(req), parent_id || null, nome, tipo, ordem]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editar local
router.put('/:obraId/locais/:id', auth, async (req, res) => {
  try {
    const { nome, tipo, parent_id, ordem } = req.body;
    const r = await db.query(
      `UPDATE lbm_locais SET nome=$1, tipo=$2, parent_id=$3, ordem=$4
       WHERE id=$5 AND obra_id=$6 RETURNING *`,
      [nome, tipo || 'local', parent_id || null, ordem ?? 0, req.params.id, obraId(req)]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Local não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Excluir local
router.delete('/:obraId/locais/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM lbm_locais WHERE id=$1 AND obra_id=$2', [req.params.id, obraId(req)]);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reordenar locais (recebe array de { id, ordem })
router.post('/:obraId/locais/reordenar', auth, async (req, res) => {
  try {
    const { itens } = req.body; // [{ id, ordem }]
    for (const item of (itens || [])) {
      await db.query('UPDATE lbm_locais SET ordem=$1 WHERE id=$2 AND obra_id=$3',
        [item.ordem, item.id, obraId(req)]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════
//  SERVIÇOS
// ════════════════════════════════════════════════════════════════════════

// Helper: carrega contratos vinculados a uma lista de serviço ids
async function _loadContratosDoServico(servicoIds) {
  if (!servicoIds.length) return {};
  const r = await db.query(`
    SELECT sc.servico_id, c.id, c.numero, c.descricao
    FROM lbm_servico_contratos sc
    JOIN contratos c ON c.id = sc.contrato_id
    WHERE sc.servico_id = ANY($1)
    ORDER BY sc.servico_id, c.numero
  `, [servicoIds]);
  const map = {};
  r.rows.forEach(row => {
    if (!map[row.servico_id]) map[row.servico_id] = [];
    map[row.servico_id].push({ id: row.id, numero: row.numero, descricao: row.descricao });
  });
  return map;
}

// Helper: upsert lista de contratos para um serviço
async function _upsertServContratos(servicoId, contratoIds) {
  await db.query('DELETE FROM lbm_servico_contratos WHERE servico_id=$1', [servicoId]);
  for (const cid of (contratoIds || [])) {
    if (cid) await db.query(
      'INSERT INTO lbm_servico_contratos(servico_id,contrato_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [servicoId, cid]
    );
  }
}

router.get('/:obraId/servicos', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT s.*, f.razao_social AS fornecedor_nome
       FROM lbm_servicos s
       LEFT JOIN fornecedores f ON f.id = s.fornecedor_id
       WHERE s.obra_id = $1
       ORDER BY s.ordem, s.id`,
      [obraId(req)]
    );
    const ids = r.rows.map(s => s.id);
    const contratosMap = await _loadContratosDoServico(ids);
    const rows = r.rows.map(s => ({ ...s, contratos: contratosMap[s.id] || [] }));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:obraId/servicos', auth, async (req, res) => {
  try {
    const {
      nome, unidade = 'un', cor = '#3B82F6',
      fornecedor_id, contrato_ids = [],
      ritmo_previsto, ritmo_unidade = 'local/dia',
      duracao_por_local = 1, ordem = 0,
    } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome do serviço é obrigatório' });
    const r = await db.query(
      `INSERT INTO lbm_servicos
         (obra_id,nome,unidade,cor,fornecedor_id,
          ritmo_previsto,ritmo_unidade,duracao_por_local,ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [obraId(req), nome, unidade, cor,
       fornecedor_id||null,
       ritmo_previsto||null, ritmo_unidade, duracao_por_local, ordem]
    );
    const serv = r.rows[0];
    await _upsertServContratos(serv.id, contrato_ids);
    const contratosMap = await _loadContratosDoServico([serv.id]);
    res.status(201).json({ ...serv, contratos: contratosMap[serv.id] || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:obraId/servicos/:id', auth, async (req, res) => {
  try {
    const {
      nome, unidade, cor, fornecedor_id, contrato_ids = [],
      ritmo_previsto, ritmo_unidade, duracao_por_local, ordem,
    } = req.body;
    const r = await db.query(
      `UPDATE lbm_servicos SET
         nome=$1, unidade=$2, cor=$3, fornecedor_id=$4,
         ritmo_previsto=$5, ritmo_unidade=$6, duracao_por_local=$7, ordem=$8
       WHERE id=$9 AND obra_id=$10 RETURNING *`,
      [nome, unidade||'un', cor||'#3B82F6', fornecedor_id||null,
       ritmo_previsto||null, ritmo_unidade||'local/dia',
       duracao_por_local||1, ordem??0,
       req.params.id, obraId(req)]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Serviço não encontrado' });
    const serv = r.rows[0];
    await _upsertServContratos(serv.id, contrato_ids);
    const contratosMap = await _loadContratosDoServico([serv.id]);
    res.json({ ...serv, contratos: contratosMap[serv.id] || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:obraId/servicos/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM lbm_servicos WHERE id=$1 AND obra_id=$2', [req.params.id, obraId(req)]);
    res.status(204).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:obraId/servicos/reordenar', auth, async (req, res) => {
  try {
    const { itens } = req.body;
    for (const item of (itens || [])) {
      await db.query('UPDATE lbm_servicos SET ordem=$1 WHERE id=$2 AND obra_id=$3',
        [item.ordem, item.id, obraId(req)]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════
//  PROGRESSO (matriz Local × Serviço)
// ════════════════════════════════════════════════════════════════════════

// Retorna a matriz completa de progresso para a obra
router.get('/:obraId/progresso', auth, async (req, res) => {
  try {
    // Locais planos (todos, em ordem de execução)
    const locaisR = await db.query(
      `WITH RECURSIVE hier AS (
         SELECT id, parent_id, nome, tipo, ordem, 0 AS nivel, nome::text AS caminho
         FROM lbm_locais WHERE obra_id=$1 AND parent_id IS NULL
         UNION ALL
         SELECT l.id, l.parent_id, l.nome, l.tipo, l.ordem,
                h.nivel+1, (h.caminho || ' > ' || l.nome)
         FROM lbm_locais l JOIN hier h ON l.parent_id=h.id
       )
       SELECT * FROM hier ORDER BY caminho`,
      [obraId(req)]
    );
    // Serviços
    const servicosR = await db.query(
      `SELECT s.*, f.razao_social AS fornecedor_nome
       FROM lbm_servicos s
       LEFT JOIN fornecedores f ON f.id = s.fornecedor_id
       WHERE s.obra_id=$1 ORDER BY s.ordem, s.id`,
      [obraId(req)]
    );
    // Progresso (todas as células preenchidas)
    const progR = await db.query(
      `SELECT p.*, m.codigo AS medicao_codigo
       FROM lbm_progresso p
       JOIN lbm_servicos s ON s.id = p.servico_id
       LEFT JOIN medicoes m ON m.id = p.medicao_id
       WHERE s.obra_id = $1`,
      [obraId(req)]
    );
    // Monta mapa { servico_id_local_id: progresso }
    const progMap = {};
    progR.rows.forEach(p => { progMap[`${p.servico_id}_${p.local_id}`] = p; });

    res.json({
      locais:   locaisR.rows,
      servicos: servicosR.rows,
      progresso: progMap,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Criar ou atualizar progresso de uma célula (Local × Serviço)
router.post('/:obraId/progresso', auth, async (req, res) => {
  try {
    const {
      servico_id, local_id, status,
      data_inicio_plan, data_fim_plan,
      data_inicio_real, data_fim_real,
      medicao_id, observacao,
    } = req.body;
    if (!servico_id || !local_id) return res.status(400).json({ error: 'servico_id e local_id são obrigatórios' });

    const r = await db.query(
      `INSERT INTO lbm_progresso
         (servico_id,local_id,status,data_inicio_plan,data_fim_plan,
          data_inicio_real,data_fim_real,medicao_id,observacao,atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT(servico_id,local_id) DO UPDATE SET
         status=$3, data_inicio_plan=$4, data_fim_plan=$5,
         data_inicio_real=$6, data_fim_real=$7,
         medicao_id=$8, observacao=$9, atualizado_em=NOW()
       RETURNING *`,
      [servico_id, local_id, status || 'nao_iniciado',
       data_inicio_plan||null, data_fim_plan||null,
       data_inicio_real||null, data_fim_real||null,
       medicao_id||null, observacao||null]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Batch update: atualiza várias células de uma vez
router.post('/:obraId/progresso/batch', auth, async (req, res) => {
  try {
    const { celulas } = req.body; // [{ servico_id, local_id, status, ... }]
    const results = [];
    for (const c of (celulas || [])) {
      const r = await db.query(
        `INSERT INTO lbm_progresso
           (servico_id,local_id,status,data_inicio_plan,data_fim_plan,
            data_inicio_real,data_fim_real,medicao_id,observacao,atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT(servico_id,local_id) DO UPDATE SET
           status=$3, data_inicio_plan=$4, data_fim_plan=$5,
           data_inicio_real=$6, data_fim_real=$7,
           medicao_id=$8, observacao=$9, atualizado_em=NOW()
         RETURNING *`,
        [c.servico_id, c.local_id, c.status || 'nao_iniciado',
         c.data_inicio_plan||null, c.data_fim_plan||null,
         c.data_inicio_real||null, c.data_fim_real||null,
         c.medicao_id||null, c.observacao||null]
      );
      results.push(r.rows[0]);
    }
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD / CÁLCULO DE PLANO
// ════════════════════════════════════════════════════════════════════════

router.get('/:obraId/dashboard', auth, async (req, res) => {
  try {
    const oid = obraId(req);

    // Total de locais (folhas — sem filhos)
    const totalLocaisR = await db.query(
      `SELECT COUNT(*) AS total FROM lbm_locais
       WHERE obra_id=$1 AND id NOT IN (
         SELECT DISTINCT parent_id FROM lbm_locais
         WHERE obra_id=$1 AND parent_id IS NOT NULL
       )`, [oid]
    );
    const totalLocais = parseInt(totalLocaisR.rows[0]?.total || 0);

    // Progresso por serviço
    const progR = await db.query(
      `SELECT s.id, s.nome, s.cor, s.ordem,
              f.razao_social AS fornecedor_nome,
              COUNT(p.id)                                         AS total_celulas,
              COUNT(p.id) FILTER (WHERE p.status='concluido')    AS concluidas,
              COUNT(p.id) FILTER (WHERE p.status='em_andamento') AS em_andamento,
              MIN(p.data_inicio_real) FILTER (WHERE p.data_inicio_real IS NOT NULL) AS inicio_real,
              MAX(p.data_fim_real)    FILTER (WHERE p.data_fim_real    IS NOT NULL) AS ultimo_fim
       FROM lbm_servicos s
       LEFT JOIN fornecedores f ON f.id = s.fornecedor_id
       LEFT JOIN lbm_progresso p ON p.servico_id = s.id
       WHERE s.obra_id = $1
       GROUP BY s.id, s.nome, s.cor, s.ordem, f.razao_social
       ORDER BY s.ordem, s.id`,
      [oid]
    );

    // Detecção de conflitos: dois serviços no mesmo local e datas que se sobrepõem
    const conflitosR = await db.query(
      `SELECT a.servico_id AS serv_a, sa.nome AS nome_a,
              b.servico_id AS serv_b, sb.nome AS nome_b,
              a.local_id, l.nome AS local_nome,
              a.data_inicio_plan AS ini_a, a.data_fim_plan AS fim_a,
              b.data_inicio_plan AS ini_b, b.data_fim_plan AS fim_b
       FROM lbm_progresso a
       JOIN lbm_progresso b
         ON a.local_id = b.local_id AND a.servico_id < b.servico_id
         AND a.data_inicio_plan IS NOT NULL AND a.data_fim_plan IS NOT NULL
         AND b.data_inicio_plan IS NOT NULL AND b.data_fim_plan IS NOT NULL
         AND a.data_inicio_plan <= b.data_fim_plan
         AND b.data_inicio_plan <= a.data_fim_plan
       JOIN lbm_servicos sa ON sa.id = a.servico_id
       JOIN lbm_servicos sb ON sb.id = b.servico_id
       JOIN lbm_locais   l  ON l.id  = a.local_id
       WHERE sa.obra_id = $1`,
      [oid]
    );

    const servicos = progR.rows.map(s => ({
      ...s,
      total_celulas: parseInt(s.total_celulas),
      concluidas:    parseInt(s.concluidas),
      em_andamento:  parseInt(s.em_andamento),
      pct: totalLocais > 0 ? Math.round(parseInt(s.concluidas) / totalLocais * 100) : 0,
    }));

    res.json({
      total_locais: totalLocais,
      servicos,
      conflitos: conflitosR.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Calcula e salva datas planejadas baseado nos ritmos de cada serviço
// Recebe: { data_inicio: 'YYYY-MM-DD' } — data de início da obra
router.post('/:obraId/calcular-plano', auth, async (req, res) => {
  try {
    const { data_inicio } = req.body;
    if (!data_inicio) return res.status(400).json({ error: 'Informe a data de início' });

    const oid = obraId(req);

    // Busca locais em ordem de execução (folhas apenas)
    const locaisR = await db.query(
      `WITH RECURSIVE hier AS (
         SELECT id, parent_id, nome, ordem, nome::text AS caminho
         FROM lbm_locais WHERE obra_id=$1 AND parent_id IS NULL
         UNION ALL
         SELECT l.id, l.parent_id, l.nome, l.ordem, h.caminho || ' > ' || l.nome
         FROM lbm_locais l JOIN hier h ON l.parent_id=h.id
       )
       SELECT id FROM hier
       WHERE id NOT IN (
         SELECT DISTINCT parent_id FROM lbm_locais WHERE obra_id=$1 AND parent_id IS NOT NULL
       )
       ORDER BY caminho`, [oid]
    );
    const locais = locaisR.rows;

    // Busca serviços em ordem
    const servicosR = await db.query(
      `SELECT id, ritmo_previsto, duracao_por_local, ordem
       FROM lbm_servicos WHERE obra_id=$1 ORDER BY ordem, id`, [oid]
    );

    // Para cada serviço, calcula as datas sequencialmente por local
    // Cada serviço começa quando o anterior terminou no primeiro local (ou na data_inicio)
    let servicoIniDate = new Date(data_inicio);
    const inserts = [];

    for (const serv of servicosR.rows) {
      const durDias = Math.max(1, parseInt(serv.duracao_por_local) || 1);
      let cur = new Date(servicoIniDate);

      for (const loc of locais) {
        const ini = new Date(cur);
        const fim = new Date(cur);
        fim.setDate(fim.getDate() + durDias - 1);

        inserts.push({
          servico_id: serv.id, local_id: loc.id,
          data_inicio_plan: ini.toISOString().slice(0, 10),
          data_fim_plan:    fim.toISOString().slice(0, 10),
        });

        cur.setDate(cur.getDate() + durDias);
      }
      // Próximo serviço começa na data em que este termina no primeiro local
      servicoIniDate = new Date(inserts[inserts.length - locais.length]?.data_inicio_plan || servicoIniDate);
      servicoIniDate.setDate(servicoIniDate.getDate() + durDias);
    }

    // Salva no banco
    for (const c of inserts) {
      await db.query(
        `INSERT INTO lbm_progresso (servico_id,local_id,status,data_inicio_plan,data_fim_plan,atualizado_em)
         VALUES ($1,$2,'nao_iniciado',$3,$4,NOW())
         ON CONFLICT(servico_id,local_id) DO UPDATE SET
           data_inicio_plan=$3, data_fim_plan=$4, atualizado_em=NOW()`,
        [c.servico_id, c.local_id, c.data_inicio_plan, c.data_fim_plan]
      );
    }

    res.json({ ok: true, total: inserts.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// SINCRONIZAÇÃO COM MEDIÇÕES (resync manual)
// ══════════════════════════════════════════════════════════════

// Helper: calcula pct_acumulado médio e medição mais recente para um array de contrato_ids
async function _calcPctServico(contratoIds) {
  if (!contratoIds.length) return { pct: 0, medicaoId: null, contratos: [] };
  const pctRows = await db.query(`
    SELECT contrato_id,
           COALESCE(MAX(pct_total), 0) AS pct_acumulado,
           (SELECT id FROM medicoes m2
            WHERE m2.contrato_id = m.contrato_id
              AND m2.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
            ORDER BY m2.periodo DESC LIMIT 1) AS medicao_id_recente
    FROM medicoes m
    WHERE contrato_id = ANY($1)
      AND COALESCE(tipo,'Normal') IN ('Normal','Avanco_Fisico')
      AND status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
    GROUP BY contrato_id
  `, [contratoIds]);

  const contratosInfo = pctRows.rows;
  if (!contratosInfo.length) return { pct: 0, medicaoId: null, contratos: [] };

  // Média simples dos pct_acumulado de cada contrato
  const soma = contratosInfo.reduce((acc, c) => acc + parseFloat(c.pct_acumulado), 0);
  const pct  = Math.min(100, soma / contratosInfo.length);

  // Medição mais recente dentre todos os contratos
  const medicaoId = contratosInfo[0]?.medicao_id_recente || null;

  return {
    pct,
    medicaoId,
    contratos: contratosInfo.map(c => ({
      contrato_id: c.contrato_id,
      pct_acumulado: parseFloat(c.pct_acumulado),
    })),
  };
}

// GET /api/lbm/:obraId/sincronizar-medicoes — diagnóstico: mostra o que será sincronizado
router.get('/:obraId/sincronizar-medicoes', auth, async (req, res) => {
  const oid = parseInt(req.params.obraId);
  try {
    // Serviços com pelo menos um contrato na junction table
    const servicos = await db.query(`
      SELECT DISTINCT s.id, s.nome
      FROM lbm_servicos s
      JOIN lbm_servico_contratos sc ON sc.servico_id = s.id
      WHERE s.obra_id = $1
    `, [oid]);

    const locaisTotal = await db.query(
      'SELECT COUNT(*) AS total FROM lbm_locais WHERE obra_id=$1', [oid]
    );
    const total = parseInt(locaisTotal.rows[0]?.total) || 0;

    const resultado = [];
    for (const s of servicos.rows) {
      // Contratos vinculados ao serviço
      const scRes = await db.query(`
        SELECT sc.contrato_id, c.numero AS contrato_numero
        FROM lbm_servico_contratos sc
        JOIN contratos c ON c.id = sc.contrato_id
        WHERE sc.servico_id = $1
      `, [s.id]);
      const contratoIds = scRes.rows.map(r => r.contrato_id);

      // Medições aprovadas de todos os contratos
      const medicoes = await db.query(`
        SELECT id, codigo, tipo, status, pct_total, contrato_id,
               (SELECT numero FROM contratos WHERE id = m.contrato_id) AS contrato_numero
        FROM medicoes m
        WHERE contrato_id = ANY($1)
          AND status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
        ORDER BY contrato_id, periodo
      `, [contratoIds]);

      const { pct, contratos } = await _calcPctServico(contratoIds);
      const nConcluidos = Math.floor((pct / 100) * total);

      resultado.push({
        servico_id:        s.id,
        servico_nome:      s.nome,
        contratos:         scRes.rows,
        pct_acumulado:     pct,
        pct_por_contrato:  contratos,
        total_locais:      total,
        locais_concluidos: nConcluidos,
        medicoes_aprovadas: medicoes.rows,
      });
    }

    res.json({ ok: true, servicos: resultado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/lbm/:obraId/sincronizar-medicoes — aplica o resync para todos os serviços com contrato
router.post('/:obraId/sincronizar-medicoes', auth, async (req, res) => {
  const oid = parseInt(req.params.obraId);
  try {
    // Serviços com pelo menos um contrato
    const servicos = await db.query(`
      SELECT DISTINCT s.id
      FROM lbm_servicos s
      JOIN lbm_servico_contratos sc ON sc.servico_id = s.id
      WHERE s.obra_id = $1
    `, [oid]);

    if (!servicos.rows.length) {
      return res.json({ ok: true, mensagem: 'Nenhum serviço com contrato vinculado encontrado.', celulas: 0 });
    }

    const locaisRes = await db.query(`
      WITH RECURSIVE hier AS (
        SELECT id, ordem, LPAD(ordem::text,5,'0') AS sort_path
        FROM lbm_locais WHERE obra_id=$1 AND parent_id IS NULL
        UNION ALL
        SELECT l.id, l.ordem, h.sort_path||'.'||LPAD(l.ordem::text,5,'0')
        FROM lbm_locais l JOIN hier h ON l.parent_id=h.id
      )
      SELECT id FROM hier ORDER BY sort_path
    `, [oid]);
    const locais = locaisRes.rows;
    const total  = locais.length;
    const hoje   = new Date().toISOString().slice(0, 10);
    let celulasAtualizadas = 0;

    for (const serv of servicos.rows) {
      const scRes = await db.query(
        'SELECT contrato_id FROM lbm_servico_contratos WHERE servico_id=$1', [serv.id]
      );
      const contratoIds = scRes.rows.map(r => r.contrato_id);
      const { pct, medicaoId } = await _calcPctServico(contratoIds);
      if (pct === 0) continue;

      const nConcluidos = Math.floor((pct / 100) * total);
      await db.query('DELETE FROM lbm_progresso WHERE servico_id=$1', [serv.id]);

      for (let i = 0; i < total; i++) {
        const localId = locais[i].id;
        let status, iniReal = null, fimReal = null;
        if (i < nConcluidos)                     { status = 'concluido';    fimReal = hoje; }
        else if (i === nConcluidos && pct < 100) { status = 'em_andamento'; iniReal = hoje; }
        else                                     { status = 'nao_iniciado'; }

        await db.query(`
          INSERT INTO lbm_progresso
            (servico_id,local_id,status,data_inicio_real,data_fim_real,medicao_id,atualizado_em)
          VALUES($1,$2,$3,$4,$5,$6,NOW())
        `, [serv.id, localId, status, iniReal, fimReal, medicaoId]);
        celulasAtualizadas++;
      }
    }

    await audit(req, 'sincronizar', 'lbm', oid,
      `LBM resync manual: ${servicos.rows.length} serviços, ${celulasAtualizadas} células atualizadas`);
    res.json({ ok: true, servicos: servicos.rows.length, celulas: celulasAtualizadas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// IMPORTAÇÃO VIA IA (Gemini)
// ══════════════════════════════════════════════════════════════

// Extração em DUAS FASES PARALELAS para evitar MAX_TOKENS em planilhas grandes:
// Fase A — apenas locais (hierarquia de locais)
// Fase B — apenas serviços + resumo
// Cada fase gera ~50% do output de uma chamada única, eliminando truncamentos.

const LBM_IA_PROMPT_LOCAIS = `Você é um engenheiro civil sênior com mais de 20 anos de experiência em planejamento e controle de obras, especialista em Location Based Management (LBM) e Linha de Balanço (LOB). Você conhece profundamente hierarquias de locais em edifícios residenciais, comerciais, industriais e de infraestrutura — blocos, pavimentos, apartamentos, trechos de via, torres, subsolos, áreas comuns, etc.

Analise o documento com olhar técnico de planejador de obras e extraia SOMENTE a lista hierárquica de locais da obra, exatamente como um engenheiro estruturaria no seu sistema de controle.

O documento pode ser planilha LOB, Linha de Balanço, cronograma de obra, lista de ambientes, EAP/WBS, memorial descritivo, etc.

== COMO LER PLANILHAS LOB (Linha de Balanço) ==
- As COLUNAS representam os LOCAIS de execução (pavimentos, apartamentos, trechos, etc.).
- Os cabeçalhos ficam nas primeiras linhas, frequentemente em 2-3 níveis hierárquicos (ex: Torre A → Pavimento 1 → Apto 101).
- Se aparecer "[... N colunas omitidas ...]", o engenheiro deduz o padrão construtivo e reconstrói a hierarquia completa (ex: se há Apto 101-104 no Pav 1, há Apto 201-204 no Pav 2, etc.).
- Agrupe locais por proximidade construtiva: subsolos → térreo → pavimentos tipo → cobertura → áreas externas.

== CRITÉRIOS TÉCNICOS DE HIERARQUIA ==
- Nível 1 (raiz): Torre, Bloco, Edifício, Trecho, Setor — o agrupador maior da obra.
- Nível 2: Pavimento, Andar, Subsolo, Térreo, Cobertura, Fundação.
- Nível 3: Apartamento, Sala, Unidade, Loja, Vaga, Área comum.
- Obras lineares (estradas, redes): Trecho → Segmento → Ponto.
- Use nomes exatamente como aparecem no documento. Não invente nomes que não existam.

== FORMATO DE SAÍDA ==
Retorne SOMENTE o JSON abaixo (sem markdown, sem texto adicional):

{"locais":[{"nome":"Nome","tipo":"bloco|pavimento|apartamento|sala|area|local","parent_nome":"Nome do pai ou null","ordem":1}]}

== REGRAS ==
- tipo: escolha entre bloco, pavimento, apartamento, sala, area, local. Padrão: "local".
- parent_nome: nome exato de outro item em locais[], ou null para raiz.
- Ordene do mais geral ao mais específico (Bloco → Pavimento → Apartamento).
- Máximo 200 locais. Se truncado, deduza e complete o padrão construtivo.
- NÃO inclua serviços, datas ou progresso.
`;

const LBM_IA_PROMPT_SERVICOS = `Você é um engenheiro civil sênior com mais de 20 anos de experiência em planejamento e controle de obras, especialista em Location Based Management (LBM) e Linha de Balanço (LOB). Você domina a sequência construtiva de obras civis — fundações, estrutura, vedações, instalações, revestimentos, acabamentos — e sabe identificar e nomear serviços com precisão técnica.

Analise o documento com olhar técnico de planejador de obras e extraia SOMENTE a lista de serviços/atividades e um resumo da obra.

O documento pode ser planilha LOB, Linha de Balanço, cronograma de obra, lista de atividades, EAP/WBS, memorial descritivo, etc.

== COMO LER PLANILHAS LOB (Linha de Balanço) ==
- As LINHAS representam os SERVIÇOS/ATIVIDADES (estrutura, alvenaria, pintura, etc.).
- O nome do serviço fica na primeira coluna (ou nas primeiras colunas, quando há agrupamentos).
- Se aparecer "[Rótulos das demais linhas]", essa seção lista os nomes dos serviços — leia todos.
- Não confunda serviços com fases ou agrupamentos genéricos (ex: "Estrutura" pode ser um agrupador de "Formas", "Armação", "Concretagem").

== CRITÉRIOS TÉCNICOS DE SERVIÇOS ==
- Use a nomenclatura técnica correta: "Revestimento cerâmico de piso", "Alvenaria de vedação", "Instalação elétrica", etc.
- Unidade de medida: use a unidade mais apropriada tecnicamente (m² para áreas, m³ para volumes, m para lineares, un para unidades discretas, vb para verbas).
- Duração por local: estime com base no tipo de serviço e porte típico de uma unidade (apartamento, pavimento). Ex: concretagem de laje ~2 dias/pavimento, pintura ~3 dias/apartamento.
- Ordene os serviços respeitando a sequência construtiva lógica: fundação → estrutura → vedação → instalações → revestimento → acabamento.
- Se o documento tiver subitens ou níveis de serviço, prefira o nível mais detalhado e operacional.

== FORMATO DE SAÍDA ==
Retorne SOMENTE o JSON abaixo (sem markdown, sem texto adicional):

{"servicos":[{"nome":"Nome do serviço","unidade":"m², m, un, vb, etc.","cor":"#3B82F6","duracao_por_local":1,"ordem":1}],"resumo":"Descrição breve (máx 120 chars)"}

== REGRAS ==
- cor: use cores distintas ciclando na sequência: #3B82F6, #22C55E, #F59E0B, #EF4444, #8B5CF6, #EC4899, #14B8A6, #F97316, #64748B, #06B6D4, #84CC16, #A855F7.
- duracao_por_local: estime em dias inteiros com base na complexidade técnica do serviço (padrão: 1).
- resumo: descreva o tipo de obra, número aproximado de locais e serviços identificados.
- Máximo 50 serviços.
- NÃO inclua locais, datas ou progresso.
`;

// POST /api/lbm/:obraId/importar-ia — interpreta o arquivo e retorna prévia (sem salvar)
// Usa extração em DUAS FASES PARALELAS para evitar MAX_TOKENS em planilhas grandes:
// Fase A = locais, Fase B = serviços+resumo. Cada chamada gera ~50% do output combinado.
router.post('/:obraId/importar-ia', auth, uploadMem.single('arquivo'), async (req, res) => {
  try {
    const apiKey = await _iaGetKey();
    if (!apiKey) return res.status(503).json({
      error: 'Chave da API Gemini não configurada.',
      dica: 'Acesse Configurações → Inteligência Artificial e informe sua chave em https://aistudio.google.com/app/apikey',
    });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

    // Converte o arquivo uma vez e reutiliza nas duas fases
    const fileParts = await _iaFileToParts(req.file);

    // Opções comuns: thinking desligado, tokens suficientes para cada fase individual
    const iaOpts = { maxOutputTokens: 16384, thinkingBudget: 0 };

    // Executa as duas fases em paralelo
    const [rawLocais, rawServicos] = await Promise.all([
      _iaCall(apiKey, [...fileParts, { text: LBM_IA_PROMPT_LOCAIS }],  iaOpts),
      _iaCall(apiKey, [...fileParts, { text: LBM_IA_PROMPT_SERVICOS }], iaOpts),
    ]);

    // Parseia fase A (locais)
    let dataLocais;
    try {
      dataLocais = JSON.parse(rawLocais);
    } catch (parseErr) {
      console.error('[LBM IA] JSON de locais inválido. Primeiros 500 chars:', rawLocais?.slice(0, 500));
      throw new Error(`Gemini retornou JSON inválido na extração de locais: ${parseErr.message}. Tente novamente.`);
    }

    // Parseia fase B (serviços + resumo)
    let dataServicos;
    try {
      dataServicos = JSON.parse(rawServicos);
    } catch (parseErr) {
      console.error('[LBM IA] JSON de serviços inválido. Primeiros 500 chars:', rawServicos?.slice(0, 500));
      throw new Error(`Gemini retornou JSON inválido na extração de serviços: ${parseErr.message}. Tente novamente.`);
    }

    res.json({
      ok:        true,
      locais:    dataLocais.locais     || [],
      servicos:  dataServicos.servicos || [],
      progresso: [],   // datas são geradas pelo "Calcular Plano" após importar
      resumo:    dataServicos.resumo   || '',
    });
  } catch (e) {
    console.error('[LBM IA] Erro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/lbm/:obraId/importar-ia/confirmar — aplica a importação confirmada no banco
router.post('/:obraId/importar-ia/confirmar', auth, async (req, res) => {
  const oid    = parseInt(req.params.obraId);
  const { locais = [], servicos = [], progresso = [], modo = 'mesclar' } = req.body;
  // modo: 'mesclar' (mantém dados existentes) | 'substituir' (limpa antes)
  const client = await require('../db').connect();
  try {
    await client.query('BEGIN');

    // Se modo=substituir, limpa tudo
    if (modo === 'substituir') {
      await client.query('DELETE FROM lbm_progresso WHERE servico_id IN (SELECT id FROM lbm_servicos WHERE obra_id=$1)', [oid]);
      await client.query('DELETE FROM lbm_servicos WHERE obra_id=$1', [oid]);
      await client.query('DELETE FROM lbm_locais WHERE obra_id=$1', [oid]);
    }

    // Insere locais — dois passes: raiz primeiro, depois filhos
    const nomeToId = {};

    // Obtém locais já existentes
    const existRes = await client.query('SELECT id, nome FROM lbm_locais WHERE obra_id=$1', [oid]);
    for (const r of existRes.rows) nomeToId[r.nome.toLowerCase()] = r.id;

    const sorted = [...locais].sort((a, b) => {
      const aRoot = !a.parent_nome;
      const bRoot = !b.parent_nome;
      if (aRoot && !bRoot) return -1;
      if (!aRoot && bRoot) return 1;
      return 0;
    });

    for (const [idx, l] of sorted.entries()) {
      const pId = l.parent_nome ? nomeToId[(l.parent_nome || '').toLowerCase()] || null : null;
      const key = (l.nome || '').toLowerCase();
      if (nomeToId[key]) continue; // já existe, não duplica
      const r = await client.query(
        `INSERT INTO lbm_locais(obra_id,nome,tipo,parent_id,ordem) VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [oid, l.nome, l.tipo || 'local', pId, l.ordem ?? idx]
      );
      nomeToId[key] = r.rows[0].id;
    }

    // Insere serviços
    const servNomeToId = {};
    const existServRes = await client.query('SELECT id, nome FROM lbm_servicos WHERE obra_id=$1', [oid]);
    for (const r of existServRes.rows) servNomeToId[r.nome.toLowerCase()] = r.id;

    for (const [idx, s] of servicos.entries()) {
      const key = (s.nome || '').toLowerCase();
      if (servNomeToId[key]) continue;
      const r = await client.query(
        `INSERT INTO lbm_servicos(obra_id,nome,unidade,cor,ritmo_previsto,ritmo_unidade,duracao_por_local,ordem)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [oid, s.nome, s.unidade||'un', s.cor||'#3B82F6',
         s.ritmo_previsto||null, s.ritmo_unidade||'local/dia',
         s.duracao_por_local||1, s.ordem??idx]
      );
      servNomeToId[key] = r.rows[0].id;
    }

    // Insere/atualiza progresso
    let cellsOk = 0;
    for (const p of progresso) {
      const sId = servNomeToId[(p.servico_nome || '').toLowerCase()];
      const lId = nomeToId[(p.local_nome || '').toLowerCase()];
      if (!sId || !lId) continue;
      await client.query(
        `INSERT INTO lbm_progresso(servico_id,local_id,status,data_inicio_plan,data_fim_plan,data_inicio_real,data_fim_real,atualizado_em)
         VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT(servico_id,local_id) DO UPDATE SET
           status=$3, data_inicio_plan=COALESCE($4,lbm_progresso.data_inicio_plan),
           data_fim_plan=COALESCE($5,lbm_progresso.data_fim_plan),
           data_inicio_real=COALESCE($6,lbm_progresso.data_inicio_real),
           data_fim_real=COALESCE($7,lbm_progresso.data_fim_real),
           atualizado_em=NOW()`,
        [sId, lId, p.status||'nao_iniciado',
         p.data_inicio_plan||null, p.data_fim_plan||null,
         p.data_inicio_real||null, p.data_fim_real||null]
      );
      cellsOk++;
    }

    await client.query('COMMIT');
    await audit(req, 'importar_ia', 'lbm', oid,
      `LBM importado via IA: ${locais.length} locais, ${servicos.length} serviços, ${cellsOk} células`);
    res.json({ ok: true, locais: Object.keys(nomeToId).length, servicos: Object.keys(servNomeToId).length, celulas: cellsOk });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[LBM IA Confirmar] Erro:', e.message);
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

module.exports = router;
