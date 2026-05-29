/**
 * CONSTRUTIVO OBRAS — Rotas do Canteiro de Obras
 *
 * GET    /api/canteiro/pendencias-material      → atividades com gatilho compra material vencendo
 * GET    /api/canteiro/req-materiais            → lista requisições
 * POST   /api/canteiro/req-materiais            → abre nova requisição (multi-item + wbs)
 * GET    /api/canteiro/req-materiais/:id        → detalhe com histórico e anexos
 * PUT    /api/canteiro/req-materiais/:id        → atualiza status / campos
 * POST   /api/canteiro/req-materiais/:id/anexos → upload de arquivos (multipart)
 * GET    /api/canteiro/req-materiais/:id/anexos → lista anexos com URL
 * DELETE /api/canteiro/req-materiais/:id/anexos/:aid → remove anexo
 */
'use strict';

const multer = require('multer');
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { getObrasPermitidas } = require('../middleware/obras');
const storageHelper = require('../helpers/storage');

// ── Multer upload ─────────────────────────────────────────────
const _upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/app/uploads'),
    filename:    (req, file, cb) => cb(null, `rm-${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// ════════════════════════════════════════════════════════════════
// GET /api/canteiro/pendencias-material
// ════════════════════════════════════════════════════════════════
router.get('/pendencias-material', auth, async (req, res) => {
  try {
    const obrasPermitidas = await getObrasPermitidas(req, db);
    const obraId  = req.query.obra_id ? parseInt(req.query.obra_id) : null;
    const status  = req.query.status  || null;
    const semRm   = req.query.sem_rm  !== 'false';

    let cronQuery, cronParams = [];
    if (obrasPermitidas === null) {
      cronQuery = obraId
        ? 'SELECT id, obra_id FROM cronogramas WHERE obra_id=$1 AND ativo=true'
        : 'SELECT id, obra_id FROM cronogramas WHERE ativo=true';
      if (obraId) cronParams = [obraId];
    } else {
      const ids = obraId ? obrasPermitidas.filter(id => id === obraId) : obrasPermitidas;
      if (!ids.length) return res.json([]);
      cronQuery  = 'SELECT id, obra_id FROM cronogramas WHERE obra_id=ANY($1::int[]) AND ativo=true';
      cronParams = [ids];
    }

    const cronRows = (await db.query(cronQuery, cronParams)).rows;
    if (!cronRows.length) return res.json([]);

    const cronIds = cronRows.map(r => r.id);
    const obraMap = {};
    for (const r of cronRows) obraMap[r.id] = r.obra_id;

    const obrasResult = await db.query(
      'SELECT id, nome FROM obras WHERE id=ANY($1::int[])',
      [Object.values(obraMap)]
    );
    const obraNomes = {};
    for (const o of obrasResult.rows) obraNomes[o.id] = o.nome;

    const hoje = new Date(); hoje.setHours(0,0,0,0);

    const r = await db.query(`
      SELECT
        a.id, a.nome, a.wbs, a.cronograma_id,
        a.data_inicio, a.data_termino, a.gatilho_dias, a.campos_extras,
        a.eh_resumo,
        (SELECT p.nome FROM atividades_cronograma p WHERE p.id = a.parent_id) AS grupo_pai,
        (SELECT json_agg(json_build_object('id', rm.id, 'codigo', rm.codigo, 'status', rm.status))
           FROM req_materiais rm
          WHERE rm.atividade_id = a.id AND rm.status NOT IN ('cancelado')
          LIMIT 5) AS rms_ativas
      FROM atividades_cronograma a
      WHERE a.cronograma_id = ANY($1::int[])
        AND a.eh_resumo = false
        AND a.data_inicio IS NOT NULL
        AND (
          (a.campos_extras->>'Gatilho Compra Material') IS NOT NULL
          OR (a.campos_extras->>'Gatilho Projetos') IS NOT NULL
        )
      ORDER BY a.data_inicio ASC
    `, [cronIds]);

    const rows = r.rows.map(row => {
      const extras     = row.campos_extras || {};
      const gatilhoMat = extras['Gatilho Compra Material'] != null
        ? parseInt(extras['Gatilho Compra Material'])
        : extras['Gatilho Projetos'] != null ? parseInt(extras['Gatilho Projetos']) : null;
      if (gatilhoMat == null || isNaN(gatilhoMat)) return null;

      const obraId        = obraMap[row.cronograma_id];
      const dataInicio    = row.data_inicio ? new Date(row.data_inicio.toISOString().slice(0,10) + 'T12:00:00') : null;
      const dataLimite    = dataInicio ? new Date(dataInicio.getTime() - gatilhoMat * 86400000) : null;
      const diasRestantes = dataLimite ? Math.floor((dataLimite - hoje) / 86400000) : null;

      let statusGatilho;
      if (!dataLimite)            statusGatilho = 'sem_data';
      else if (hoje > dataLimite) statusGatilho = 'vencido';
      else if (diasRestantes <= 14) statusGatilho = 'proximo';
      else                        statusGatilho = 'ok';

      if (status === 'vencido' && statusGatilho !== 'vencido') return null;
      if (status === 'proximo' && !['vencido','proximo'].includes(statusGatilho)) return null;

      const rmsAtivas   = row.rms_ativas || [];
      const temRmAberta = rmsAtivas.some(rm => ['pendente','em_compra'].includes(rm.status));
      if (semRm && temRmAberta) return null;

      return {
        id: row.id, nome: row.nome, wbs: row.wbs, grupo_pai: row.grupo_pai,
        obra_id: obraId, obra_nome: obraNomes[obraId] || `Obra ${obraId}`,
        cronograma_id: row.cronograma_id,
        data_inicio: row.data_inicio ? row.data_inicio.toISOString().slice(0,10) : null,
        data_termino: row.data_termino ? row.data_termino.toISOString().slice(0,10) : null,
        gatilho_material: gatilhoMat,
        data_limite_compra: dataLimite ? dataLimite.toISOString().slice(0,10) : null,
        dias_restantes: diasRestantes, status_gatilho: statusGatilho,
        rms_ativas: rmsAtivas, tem_rm_aberta: temRmAberta,
      };
    }).filter(Boolean);

    rows.sort((a, b) => {
      const ord = { vencido: 0, proximo: 1, ok: 2, sem_data: 3 };
      const diff = (ord[a.status_gatilho]??3) - (ord[b.status_gatilho]??3);
      return diff !== 0 ? diff : (a.dias_restantes??999) - (b.dias_restantes??999);
    });

    res.json(rows);
  } catch (err) {
    console.error('[canteiro/pendencias-material]', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/canteiro/req-materiais
// ?origem=portal_fornecedor  → pedidos do portal (tela Canteiro redesenhada)
// ?origem=encarregado        → pedidos internos (fluxo legado)
// sem ?origem                → todos
// ════════════════════════════════════════════════════════════════
router.get('/req-materiais', auth, async (req, res) => {
  try {
    const obrasPermitidas = await getObrasPermitidas(req, db);
    const obraId    = req.query.obra_id    ? parseInt(req.query.obra_id)    : null;
    const empresaId = req.query.empresa_id ? parseInt(req.query.empresa_id) : null;
    const status    = req.query.status     || null;
    const origem    = req.query.origem     || null;
    const limit     = Math.min(parseInt(req.query.limit  || 100), 500);
    const offset    = parseInt(req.query.offset || 0);

    const conds = []; const params = []; let p = 1;
    if (obrasPermitidas !== null) {
      const ids = obraId ? obrasPermitidas.filter(id => id === obraId) : obrasPermitidas;
      if (!ids.length) return res.json([]);
      conds.push(`rm.obra_id = ANY($${p++}::int[])`); params.push(ids);
    } else if (obraId) {
      conds.push(`rm.obra_id = $${p++}`); params.push(obraId);
    }
    if (status)    { conds.push(`rm.status = $${p++}`);    params.push(status); }
    if (origem) {
      // Origem explícita: exibe todos os itens daquela origem (ex: Canteiro passa portal_fornecedor)
      conds.push(`rm.origem = $${p++}`); params.push(origem);
    } else {
      // Sem origem: exibe itens internos (encarregado) + itens de portal pós-aprovação
      // Itens pendentes/reprovados do portal ficam só na tela Canteiro (filtrada por origem)
      conds.push(`(rm.origem = 'encarregado' OR (rm.origem = 'portal_fornecedor' AND rm.status IN ('aprovado','em_compra','entregue','cancelado')))`);
    }
    if (empresaId) { conds.push(`o.empresa_id = $${p++}`); params.push(empresaId); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const r = await db.query(`
      SELECT
        rm.*,
        o.nome                AS obra_nome,
        e.id                  AS empresa_id,
        COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
        COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
        c.numero              AS contrato_numero,
        c.objeto              AS contrato_descricao,
        a.nome                AS atividade_nome,
        a.wbs                 AS atividade_wbs,
        (SELECT pp.nome FROM atividades_cronograma pp WHERE pp.id = a.parent_id) AS grupo_pai,
        (SELECT COUNT(*) FROM req_materiais_anexos x WHERE x.rm_id = rm.id) AS total_anexos
      FROM req_materiais rm
      LEFT JOIN obras        o ON o.id = rm.obra_id
      LEFT JOIN empresas     e ON e.id = o.empresa_id
      LEFT JOIN fornecedores f ON f.id = rm.fornecedor_id
      LEFT JOIN contratos    c ON c.id = rm.contrato_id
      LEFT JOIN atividades_cronograma a ON a.id = rm.atividade_id
      ${where}
      ORDER BY
        CASE rm.status WHEN 'pendente' THEN 0 WHEN 'aprovado' THEN 1 WHEN 'em_compra' THEN 2 WHEN 'entregue' THEN 3 ELSE 4 END,
        rm.criado_em DESC
      LIMIT $${p++} OFFSET $${p++}
    `, [...params, limit, offset]);

    res.json(r.rows);
  } catch (err) {
    console.error('[canteiro/req-materiais GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/canteiro/req-materiais
// Cria nova requisição com array de itens + wbs
// ════════════════════════════════════════════════════════════════
router.post('/req-materiais', auth, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const {
      atividade_id, cronograma_id, obra_id,
      descricao,    // título/resumo da RM (obrigatório)
      itens,        // array de itens [{nome, detalhes, quantidade, unidade, wbs}]
      wbs,          // wbs da atividade de origem
      observacao, data_necessidade,
    } = req.body;

    if (!obra_id)          return res.status(400).json({ error: 'obra_id é obrigatório' });
    if (!descricao?.trim()) return res.status(400).json({ error: 'descricao é obrigatória' });

    const usuario  = req.user?.login || req.user?.email || 'sistema';
    const nomeUser = req.user?.nome  || usuario;

    // Valida e normaliza itens
    const itensArr = Array.isArray(itens) ? itens.filter(i => i?.nome?.trim()) : [];

    const r = await client.query(`
      INSERT INTO req_materiais
        (atividade_id, cronograma_id, obra_id, descricao, wbs, itens,
         observacao, data_necessidade, criado_por, criado_por_nome, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendente')
      RETURNING *
    `, [
      atividade_id  || null,
      cronograma_id || null,
      parseInt(obra_id),
      descricao.trim(),
      wbs           || null,
      JSON.stringify(itensArr),
      observacao    || null,
      data_necessidade || null,
      usuario, nomeUser,
    ]);

    const rm = r.rows[0];
    await client.query(
      `INSERT INTO req_materiais_historico (rm_id, status_de, status_para, usuario, observacao)
       VALUES ($1, NULL, 'pendente', $2, 'Requisição criada')`,
      [rm.id, usuario]
    );

    await client.query('COMMIT');
    res.status(201).json(rm);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[canteiro/req-materiais POST]', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/canteiro/req-materiais/:id
// ════════════════════════════════════════════════════════════════
router.get('/req-materiais/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const r = await db.query(`
      SELECT
        rm.*,
        o.nome                                    AS obra_nome,
        o.uau_obra                                AS obra_uau_obra,
        o.uau_obra_fiscal                         AS obra_uau_obra_fiscal,
        COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
        e.uau_empresa                             AS empresa_uau_empresa,
        COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
        c.numero                                  AS contrato_numero,
        c.objeto                                  AS contrato_descricao,
        c.uau_empresa                             AS contrato_uau_empresa,
        c.uau_contrato                            AS contrato_uau_contrato,
        c.uau_produto_pl                          AS contrato_uau_produto_pl,
        c.uau_contrato_pl                         AS contrato_uau_contrato_pl,
        a.nome                                    AS atividade_nome,
        a.wbs                                     AS atividade_wbs,
        a.wbs_erp                                 AS atividade_wbs_erp,
        (SELECT pp.nome FROM atividades_cronograma pp WHERE pp.id = a.parent_id) AS grupo_pai,
        (SELECT COUNT(*) FROM req_materiais_anexos x WHERE x.rm_id = rm.id)      AS total_anexos
      FROM req_materiais rm
      LEFT JOIN obras                  o ON o.id = rm.obra_id
      LEFT JOIN empresas               e ON e.id = o.empresa_id
      LEFT JOIN fornecedores           f ON f.id = rm.fornecedor_id
      LEFT JOIN contratos              c ON c.id = rm.contrato_id
      LEFT JOIN atividades_cronograma  a ON a.id = rm.atividade_id
      WHERE rm.id = $1
    `, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });

    const contratoId = r.rows[0].contrato_id;
    const [hist, anexos, uauVinculos] = await Promise.all([
      db.query('SELECT * FROM req_materiais_historico WHERE rm_id=$1 ORDER BY criado_em ASC', [id]),
      db.query('SELECT * FROM req_materiais_anexos WHERE rm_id=$1 ORDER BY criado_em ASC', [id]),
      contratoId
        ? db.query('SELECT id, servico_pl, codigo_insumo_pl, codigo_insumo_servico_pl, descricao FROM contrato_uau_vinculos WHERE contrato_id=$1 ORDER BY id', [contratoId])
        : Promise.resolve({ rows: [] }),
    ]);

    const anexosComUrl = await Promise.all(anexos.rows.map(async a => ({
      ...a, url_view: await storageHelper.getViewUrl(a),
    })));

    // Enriquecer itens com CAP do cadastro de insumos
    const pedido = r.rows[0];
    if (Array.isArray(pedido.itens) && pedido.itens.length > 0) {
      const codigos = [...new Set(pedido.itens.map(it => it.codigo_insumo).filter(Boolean))];
      if (codigos.length > 0) {
        const insR = await db.query(
          `SELECT codigo, cap FROM insumos WHERE codigo = ANY($1)`,
          [codigos]
        );
        const capMap = {};
        insR.rows.forEach(ins => { capMap[ins.codigo] = ins.cap; });
        pedido.itens = pedido.itens.map(it => ({
          ...it,
          cap: it.cap || capMap[it.codigo_insumo] || null,
        }));
      }
    }

    res.json({ ...pedido, historico: hist.rows, anexos: anexosComUrl, uau_vinculos: uauVinculos.rows });
  } catch (err) {
    console.error('[canteiro/req-materiais/:id GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// PUT /api/canteiro/req-materiais/:id
// ════════════════════════════════════════════════════════════════
router.put('/req-materiais/:id', auth, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const id  = parseInt(req.params.id);
    const cur = await client.query('SELECT * FROM req_materiais WHERE id=$1 FOR UPDATE', [id]);
    if (!cur.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Não encontrado' }); }

    const { status, descricao, wbs, itens, observacao, atendido_por, obs_status } = req.body;
    const VALID = ['pendente','em_compra','entregue','cancelado','aprovado','reprovado'];
    if (status && !VALID.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Status inválido. Use: ${VALID.join(', ')}` });
    }

    const usuario   = req.user?.login || req.user?.email || 'sistema';
    const statusAnt = cur.rows[0].status;

    const itensJson = itens != null ? JSON.stringify(
      Array.isArray(itens) ? itens.filter(i => i?.nome?.trim()) : []
    ) : null;

    const r = await client.query(`
      UPDATE req_materiais SET
        status        = COALESCE($1, status),
        descricao     = COALESCE($2, descricao),
        wbs           = COALESCE($3, wbs),
        itens         = COALESCE($4::jsonb, itens),
        observacao    = COALESCE($5, observacao),
        atendido_por  = COALESCE($6, atendido_por),
        atualizado_em = NOW()
      WHERE id = $7
      RETURNING *
    `, [status||null, descricao||null, wbs||null, itensJson, observacao||null, atendido_por||null, id]);

    if (status && status !== statusAnt) {
      await client.query(
        `INSERT INTO req_materiais_historico (rm_id, status_de, status_para, usuario, observacao)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, statusAnt, status, usuario, obs_status||null]
      );
    }

    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[canteiro/req-materiais/:id PUT]', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/canteiro/req-materiais/:id/anexos — upload de arquivos
// ════════════════════════════════════════════════════════════════
router.post('/req-materiais/:id/anexos', auth, _upload.array('files', 10), async (req, res) => {
  const rmId = parseInt(req.params.id);
  if (!req.files?.length) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const salvos = [];
  try {
    for (const file of req.files) {
      const mime  = file.mimetype || '';
      let tipo    = 'other';
      if (mime.startsWith('image/'))                           tipo = 'img';
      else if (mime === 'application/pdf')                     tipo = 'pdf';
      else if (mime.includes('word') || mime.includes('document')) tipo = 'doc';
      else if (mime.includes('sheet') || mime.includes('excel'))   tipo = 'doc';

      const bytes   = file.size || 0;
      const tamanho = bytes < 1024 ? `${bytes} B`
        : bytes < 1024*1024 ? `${(bytes/1024).toFixed(1)} KB`
        : `${(bytes/1024/1024).toFixed(1)} MB`;

      let result = { provider: 'local', caminho: file.filename, url_storage: null };
      try { result = await storageHelper.uploadFile(file.path, file.originalname, file.mimetype); }
      catch (e) { console.error('[rm/anexos upload]', e.message); }

      if (result.provider !== 'local') {
        const fs = require('fs');
        try { fs.unlinkSync(file.path); } catch {}
      }

      const row = (await db.query(
        `INSERT INTO req_materiais_anexos (rm_id, nome, tipo, tamanho, caminho, provider, url_storage, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [rmId, file.originalname, tipo, tamanho, result.caminho, result.provider, result.url_storage||null, req.user?.login||'sistema']
      )).rows[0];
      row.url_view = await storageHelper.getViewUrl(row);
      salvos.push(row);
    }
    res.status(201).json(salvos);
  } catch (e) {
    console.error('[rm/anexos POST]', e);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/canteiro/req-materiais/:id/anexos
// ════════════════════════════════════════════════════════════════
router.get('/req-materiais/:id/anexos', auth, async (req, res) => {
  try {
    const rows = (await db.query(
      'SELECT * FROM req_materiais_anexos WHERE rm_id=$1 ORDER BY criado_em ASC',
      [parseInt(req.params.id)]
    )).rows;
    const withUrl = await Promise.all(rows.map(async a => ({ ...a, url_view: await storageHelper.getViewUrl(a) })));
    res.json(withUrl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// DELETE /api/canteiro/req-materiais/:id/anexos/:aid
// ════════════════════════════════════════════════════════════════
router.delete('/req-materiais/:id/anexos/:aid', auth, async (req, res) => {
  try {
    const row = (await db.query('SELECT * FROM req_materiais_anexos WHERE id=$1 AND rm_id=$2',
      [parseInt(req.params.aid), parseInt(req.params.id)])).rows[0];
    if (!row) return res.status(404).json({ error: 'Não encontrado' });
    if (row.provider === 'local') {
      const fs   = require('fs');
      const path = require('path');
      try { fs.unlinkSync(path.join('/app/uploads', row.caminho)); } catch {}
    } else {
      try { await storageHelper.deleteFile(row); } catch {}
    }
    await db.query('DELETE FROM req_materiais_anexos WHERE id=$1', [row.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
