/**
 * CONSTRUTIVO OBRAS — Rotas de Obras
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
const { getObrasPermitidas, obraClause } = require('../middleware/obras');

router.get('/', auth, async (req, res) => {
  const params = [];
  const conds  = [];

  if (req.query.empresa_id) {
    params.push(req.query.empresa_id);
    conds.push(`o.empresa_id=$${params.length}`);
  }

  // Restrição de acesso por obra
  const obras = await getObrasPermitidas(req, db);
  if (obras) {
    params.push(obras);
    conds.push(`o.id = ANY($${params.length}::int[])`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await db.query(
    `SELECT o.*,e.nome_fantasia as empresa_nome
       FROM obras o
       JOIN empresas e ON o.empresa_id=e.id
       ${where}
       ORDER BY o.nome`,
    params
  );
  res.json(r.rows);
});

router.post('/', auth, perm('cadastros'), async (req, res) => {
  const { empresa_id, codigo, nome, localizacao, gestor, status, metodologia } = req.body;
  const r = await db.query(
    'INSERT INTO obras(empresa_id,codigo,nome,localizacao,gestor,status,metodologia) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [empresa_id, codigo, nome, localizacao, gestor, status || 'Em andamento', metodologia || 'gantt']
  );
  const row = r.rows[0];
  await audit(req, 'criar', 'obra', row.id, `Obra "${row.nome}" (${row.codigo}) criada — metodologia: ${row.metodologia}`);
  res.status(201).json(row);
});

router.put('/:id', auth, perm('cadastros'), async (req, res) => {
  const { empresa_id, codigo, nome, localizacao, gestor, status, metodologia } = req.body;
  const r = await db.query(
    'UPDATE obras SET empresa_id=$1,codigo=$2,nome=$3,localizacao=$4,gestor=$5,status=$6,metodologia=$7 WHERE id=$8 RETURNING *',
    [empresa_id, codigo, nome, localizacao, gestor, status, metodologia || 'gantt', req.params.id]
  );
  const row = r.rows[0];
  await audit(req, 'editar', 'obra', row.id, `Obra "${row.nome}" (${row.codigo}) atualizada — status: ${row.status} | metodologia: ${row.metodologia}`);
  res.json(row);
});

router.delete('/:id', auth, perm('cadastros'), async (req, res) => {
  const prev = await db.query('SELECT nome, codigo FROM obras WHERE id=$1', [req.params.id]);
  await db.query('DELETE FROM obras WHERE id=$1', [req.params.id]);
  const o = prev.rows[0];
  await audit(req, 'excluir', 'obra', parseInt(req.params.id), `Obra "${o?.nome || ''}" (${o?.codigo || req.params.id}) excluída`);
  res.status(204).end();
});

// ── Importação em massa (CSV) ────────────────────────────────────
router.post('/bulk', auth, perm('cadastros'), async (req, res) => {
  const registros = req.body;
  if (!Array.isArray(registros) || registros.length === 0)
    return res.status(400).json({ error: 'Envie um array de registros.' });

  // Carrega mapa CNPJ → empresa_id para resolução
  const emps = await db.query('SELECT id, cnpj FROM empresas');
  const cnpjMap = {};
  emps.rows.forEach(e => { cnpjMap[e.cnpj.replace(/\D/g,'')] = e.id; });

  const resultados = [];
  for (let i = 0; i < registros.length; i++) {
    const { empresa_cnpj, codigo, nome, localizacao, gestor, status } = registros[i];
    const linha = i + 2;
    if (!empresa_cnpj || !codigo || !nome) {
      resultados.push({ linha, status: 'erro', motivo: 'empresa_cnpj, codigo e nome são obrigatórios' });
      continue;
    }
    const empresa_id = cnpjMap[empresa_cnpj.replace(/\D/g,'')];
    if (!empresa_id) {
      resultados.push({ linha, status: 'erro', motivo: `Empresa com CNPJ "${empresa_cnpj}" não encontrada`, codigo });
      continue;
    }
    try {
      const r = await db.query(
        'INSERT INTO obras(empresa_id,codigo,nome,localizacao,gestor,status,metodologia) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [empresa_id, codigo.trim(), nome.trim(), localizacao?.trim()||null, gestor?.trim()||null, status?.trim()||'Em andamento', 'gantt']
      );
      await audit(req, 'criar', 'obra', r.rows[0].id, `Obra "${nome}" (${codigo}) importada em massa`);
      resultados.push({ linha, status: 'ok', id: r.rows[0].id, codigo, nome });
    } catch (e) {
      resultados.push({ linha, status: 'erro', motivo: e.detail || e.message, codigo });
    }
  }
  const ok = resultados.filter(r => r.status === 'ok').length;
  const erros = resultados.filter(r => r.status === 'erro').length;
  res.json({ total: registros.length, importados: ok, erros, resultados });
});

module.exports = router;
