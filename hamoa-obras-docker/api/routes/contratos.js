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
           ELSE 0 END AS pct_executado_real
    FROM contratos c
    JOIN obras        o ON c.obra_id       = o.id
    JOIN fornecedores f ON c.fornecedor_id = f.id
    JOIN empresas     e ON c.empresa_id    = e.id
    LEFT JOIN (
      SELECT m.contrato_id, SUM(mi.valor_item) AS valor_executado
      FROM medicao_itens mi
      JOIN medicoes m ON m.id = mi.medicao_id
      WHERE m.status NOT IN ('Rascunho','Reprovado')
      GROUP BY m.contrato_id
    ) ex ON ex.contrato_id = c.id`;

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

  const acumR = await db.query(`
    SELECT
      mi.contrato_item_id,
      SUM(mi.qtd_mes)    AS qtd_acumulada,
      SUM(mi.valor_item) AS valor_acumulado
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
      qtd_acumulada:   parseFloat(r.qtd_acumulada)  || 0,
      valor_acumulado: parseFloat(r.valor_acumulado) || 0,
    };
  });

  const itens = itensR.rows.map(ci => {
    const a        = acumMap[ci.id] || { qtd_acumulada: 0, valor_acumulado: 0 };
    const qtdTot   = parseFloat(ci.qtd_total)      || 0;
    const qtdAcum  = a.qtd_acumulada;
    const qtdSaldo = Math.max(0, parseFloat((qtdTot - qtdAcum).toFixed(4)));
    const pctExec  = qtdTot > 0
      ? parseFloat(Math.min(100, (qtdAcum / qtdTot) * 100).toFixed(2))
      : 0;
    return {
      id:              ci.id,
      ordem:           ci.ordem,
      descricao:       ci.descricao,
      unidade:         ci.unidade,
      qtd_total:       qtdTot,
      valor_unitario:  parseFloat(ci.valor_unitario) || 0,
      valor_total:     parseFloat(ci.valor_total)    || 0,
      qtd_acumulada:   qtdAcum,
      qtd_saldo:       qtdSaldo,
      pct_executado:   pctExec,
      valor_acumulado: a.valor_acumulado,
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

router.post('/', auth, async (req, res) => {
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
    res.status(201).json(r.rows[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.put('/:id', auth, async (req, res) => {
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
    res.json(r.rows[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/:id', auth, async (req, res) => {
  await db.query('DELETE FROM contratos WHERE id=$1', [req.params.id]);
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
    "observacoes": "Informações relevantes adicionais (prazo de execução, local de obra, condições especiais) — null se não encontrado"
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
- Se não houver planilha orçamentária, retorne "itens" como array vazio [].`,
    });

    const cleaned = await _iaCall(apiKey, parts);
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
    } catch {
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

    res.json({ contrato: contratoSan, fornecedor: fornSan, itens, total: itens.length, modelo: 'gemini-2.5-flash' });
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
router.post('/:id/atividades', auth, async (req, res) => {
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
