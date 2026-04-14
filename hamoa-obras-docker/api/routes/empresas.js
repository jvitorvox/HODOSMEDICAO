/**
 * CONSTRUTIVO OBRAS — Rotas de Empresas
 * GET    /api/empresas
 * POST   /api/empresas
 * PUT    /api/empresas/:id
 * DELETE /api/empresas/:id
 */
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { perm } = require('../middleware/perm');
const audit  = require('../middleware/audit');

router.get('/', auth, async (req, res) => {
  const r = await db.query('SELECT * FROM empresas ORDER BY razao_social');
  res.json(r.rows);
});

router.post('/', auth, perm('cadastros'), async (req, res) => {
  const { razao_social, nome_fantasia, cnpj } = req.body;
  const r = await db.query(
    'INSERT INTO empresas(razao_social,nome_fantasia,cnpj) VALUES($1,$2,$3) RETURNING *',
    [razao_social, nome_fantasia, cnpj]
  );
  const row = r.rows[0];
  await audit(req, 'criar', 'empresa', row.id, `Empresa "${row.razao_social}" criada`);
  res.status(201).json(row);
});

router.put('/:id', auth, perm('cadastros'), async (req, res) => {
  const { razao_social, nome_fantasia, cnpj, ativo } = req.body;
  const r = await db.query(
    'UPDATE empresas SET razao_social=$1,nome_fantasia=$2,cnpj=$3,ativo=$4 WHERE id=$5 RETURNING *',
    [razao_social, nome_fantasia, cnpj, ativo, req.params.id]
  );
  const row = r.rows[0];
  await audit(req, 'editar', 'empresa', row.id, `Empresa "${row.razao_social}" atualizada`);
  res.json(row);
});

router.delete('/:id', auth, perm('cadastros'), async (req, res) => {
  const prev = await db.query('SELECT razao_social FROM empresas WHERE id=$1', [req.params.id]);
  await db.query('DELETE FROM empresas WHERE id=$1', [req.params.id]);
  const nome = prev.rows[0]?.razao_social || req.params.id;
  await audit(req, 'excluir', 'empresa', parseInt(req.params.id), `Empresa "${nome}" excluída`);
  res.status(204).end();
});

// ── Importação em massa (CSV) ────────────────────────────────────
router.post('/bulk', auth, perm('cadastros'), async (req, res) => {
  const registros = req.body; // array de objetos
  if (!Array.isArray(registros) || registros.length === 0)
    return res.status(400).json({ error: 'Envie um array de registros.' });

  const resultados = [];
  for (let i = 0; i < registros.length; i++) {
    const { razao_social, nome_fantasia, cnpj } = registros[i];
    const linha = i + 2; // linha no CSV (1=cabeçalho)
    if (!razao_social || !cnpj) {
      resultados.push({ linha, status: 'erro', motivo: 'razao_social e cnpj são obrigatórios' });
      continue;
    }
    try {
      const r = await db.query(
        'INSERT INTO empresas(razao_social,nome_fantasia,cnpj) VALUES($1,$2,$3) RETURNING id',
        [razao_social.trim(), nome_fantasia?.trim() || null, cnpj.trim()]
      );
      await audit(req, 'criar', 'empresa', r.rows[0].id, `Empresa "${razao_social}" importada em massa`);
      resultados.push({ linha, status: 'ok', id: r.rows[0].id, razao_social });
    } catch (e) {
      resultados.push({ linha, status: 'erro', motivo: e.detail || e.message, razao_social });
    }
  }
  const ok = resultados.filter(r => r.status === 'ok').length;
  const erros = resultados.filter(r => r.status === 'erro').length;
  res.json({ total: registros.length, importados: ok, erros, resultados });
});

module.exports = router;
