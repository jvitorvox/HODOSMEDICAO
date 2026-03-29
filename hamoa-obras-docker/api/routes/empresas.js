/**
 * HAMOA OBRAS — Rotas de Empresas
 * GET    /api/empresas
 * POST   /api/empresas
 * PUT    /api/empresas/:id
 * DELETE /api/empresas/:id
 */
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const r = await db.query('SELECT * FROM empresas ORDER BY razao_social');
  res.json(r.rows);
});

router.post('/', auth, async (req, res) => {
  const { razao_social, nome_fantasia, cnpj } = req.body;
  const r = await db.query(
    'INSERT INTO empresas(razao_social,nome_fantasia,cnpj) VALUES($1,$2,$3) RETURNING *',
    [razao_social, nome_fantasia, cnpj]
  );
  res.status(201).json(r.rows[0]);
});

router.put('/:id', auth, async (req, res) => {
  const { razao_social, nome_fantasia, cnpj, ativo } = req.body;
  const r = await db.query(
    'UPDATE empresas SET razao_social=$1,nome_fantasia=$2,cnpj=$3,ativo=$4 WHERE id=$5 RETURNING *',
    [razao_social, nome_fantasia, cnpj, ativo, req.params.id]
  );
  res.json(r.rows[0]);
});

router.delete('/:id', auth, async (req, res) => {
  await db.query('DELETE FROM empresas WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
