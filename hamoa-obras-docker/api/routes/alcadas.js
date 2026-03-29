/**
 * HAMOA OBRAS — Rotas de Alçadas
 * GET    /api/alcadas[?empresa_id=]
 * POST   /api/alcadas
 * PUT    /api/alcadas/:id
 * DELETE /api/alcadas/:id
 */
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const q = req.query.empresa_id
    ? `SELECT a.*,e.nome_fantasia as empresa_nome,o.nome as obra_nome
       FROM alcadas a
       JOIN empresas e ON a.empresa_id=e.id
       LEFT JOIN obras o ON a.obra_id=o.id
       WHERE a.empresa_id=$1 ORDER BY a.nome`
    : `SELECT a.*,e.nome_fantasia as empresa_nome,o.nome as obra_nome
       FROM alcadas a
       JOIN empresas e ON a.empresa_id=e.id
       LEFT JOIN obras o ON a.obra_id=o.id
       ORDER BY a.nome`;
  const r = await db.query(q, req.query.empresa_id ? [req.query.empresa_id] : []);
  res.json(r.rows);
});

router.post('/', auth, async (req, res) => {
  const { empresa_id, obra_id, nome,
          n1_titulo, n1_grupos, n1_prazo,
          n2_titulo, n2_grupos, n2_prazo,
          n3_titulo, n3_grupos, n3_prazo,
          escalonamento, escalonamento_dias, email_copia } = req.body;
  const r = await db.query(
    `INSERT INTO alcadas
       (empresa_id,obra_id,nome,
        n1_titulo,n1_grupos,n1_prazo,
        n2_titulo,n2_grupos,n2_prazo,
        n3_titulo,n3_grupos,n3_prazo,
        escalonamento,escalonamento_dias,email_copia)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [empresa_id, obra_id||null, nome,
     n1_titulo, n1_grupos||[], n1_prazo||3,
     n2_titulo, n2_grupos||[], n2_prazo||2,
     n3_titulo, n3_grupos||[], n3_prazo||5,
     !!escalonamento, escalonamento_dias||2, email_copia||'']
  );
  res.status(201).json(r.rows[0]);
});

router.put('/:id', auth, async (req, res) => {
  const { nome,
          n1_titulo, n1_grupos, n1_prazo,
          n2_titulo, n2_grupos, n2_prazo,
          n3_titulo, n3_grupos, n3_prazo,
          escalonamento, escalonamento_dias, email_copia, ativo } = req.body;
  const r = await db.query(
    `UPDATE alcadas SET
       nome=$1,
       n1_titulo=$2,n1_grupos=$3,n1_prazo=$4,
       n2_titulo=$5,n2_grupos=$6,n2_prazo=$7,
       n3_titulo=$8,n3_grupos=$9,n3_prazo=$10,
       escalonamento=$11,escalonamento_dias=$12,email_copia=$13,ativo=$14
     WHERE id=$15 RETURNING *`,
    [nome,
     n1_titulo, n1_grupos||[], n1_prazo||3,
     n2_titulo, n2_grupos||[], n2_prazo||2,
     n3_titulo, n3_grupos||[], n3_prazo||5,
     !!escalonamento, escalonamento_dias||2, email_copia||'', ativo!==false, req.params.id]
  );
  res.json(r.rows[0]);
});

router.delete('/:id', auth, async (req, res) => {
  await db.query('DELETE FROM alcadas WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
