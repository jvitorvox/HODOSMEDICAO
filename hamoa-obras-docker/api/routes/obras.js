/**
 * HAMOA OBRAS — Rotas de Obras
 * GET    /api/obras[?empresa_id=]
 * POST   /api/obras
 * PUT    /api/obras/:id
 * DELETE /api/obras/:id
 */
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const { perm } = require('../middleware/perm');
const audit  = require('../middleware/audit');

router.get('/', auth, async (req, res) => {
  const q = req.query.empresa_id
    ? 'SELECT o.*,e.nome_fantasia as empresa_nome FROM obras o JOIN empresas e ON o.empresa_id=e.id WHERE o.empresa_id=$1 ORDER BY o.nome'
    : 'SELECT o.*,e.nome_fantasia as empresa_nome FROM obras o JOIN empresas e ON o.empresa_id=e.id ORDER BY o.nome';
  const r = await db.query(q, req.query.empresa_id ? [req.query.empresa_id] : []);
  res.json(r.rows);
});

router.post('/', auth, perm('cadastros'), async (req, res) => {
  const { empresa_id, codigo, nome, localizacao, gestor, status } = req.body;
  const r = await db.query(
    'INSERT INTO obras(empresa_id,codigo,nome,localizacao,gestor,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [empresa_id, codigo, nome, localizacao, gestor, status || 'Em andamento']
  );
  const row = r.rows[0];
  await audit(req, 'criar', 'obra', row.id, `Obra "${row.nome}" (${row.codigo}) criada`);
  res.status(201).json(row);
});

router.put('/:id', auth, perm('cadastros'), async (req, res) => {
  const { empresa_id, codigo, nome, localizacao, gestor, status } = req.body;
  const r = await db.query(
    'UPDATE obras SET empresa_id=$1,codigo=$2,nome=$3,localizacao=$4,gestor=$5,status=$6 WHERE id=$7 RETURNING *',
    [empresa_id, codigo, nome, localizacao, gestor, status, req.params.id]
  );
  const row = r.rows[0];
  await audit(req, 'editar', 'obra', row.id, `Obra "${row.nome}" (${row.codigo}) atualizada — status: ${row.status}`);
  res.json(row);
});

router.delete('/:id', auth, perm('cadastros'), async (req, res) => {
  const prev = await db.query('SELECT nome, codigo FROM obras WHERE id=$1', [req.params.id]);
  await db.query('DELETE FROM obras WHERE id=$1', [req.params.id]);
  const o = prev.rows[0];
  await audit(req, 'excluir', 'obra', parseInt(req.params.id), `Obra "${o?.nome || ''}" (${o?.codigo || req.params.id}) excluída`);
  res.status(204).end();
});

module.exports = router;
