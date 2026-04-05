'use strict';
/**
 * HAMOA OBRAS — Rota de Auditoria
 * GET /api/audit  — lista logs com filtros e paginação
 */
const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// Somente ADM pode ver o log completo; outros usuários veem apenas seus próprios registros
router.get('/', auth, async (req, res) => {
  try {
    const isAdm   = req.user?.perfil === 'ADM';
    const { entidade, acao, usuario_login, data_inicio, data_fim, limit = 200, offset = 0 } = req.query;

    const conds  = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };

    if (!isAdm) {
      // Usuário comum: apenas seus próprios registros
      conds.push(`usuario_id = ${p(req.user.id)}`);
    } else if (usuario_login) {
      conds.push(`usuario_login ILIKE ${p('%' + usuario_login + '%')}`);
    }

    if (entidade)    conds.push(`entidade = ${p(entidade)}`);
    if (acao)        conds.push(`acao = ${p(acao)}`);
    if (data_inicio) conds.push(`criado_em >= ${p(data_inicio)}`);
    if (data_fim)    conds.push(`criado_em <  ${p(data_fim + 'T23:59:59')}`);

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const lim   = Math.min(parseInt(limit)  || 200, 1000);
    const off   = Math.max(parseInt(offset) || 0,   0);

    const [rows, total] = await Promise.all([
      db.query(
        `SELECT id, usuario_login, usuario_nome, acao, entidade, entidade_id,
                descricao, detalhes, ip,
                TO_CHAR(criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS') AS criado_em_fmt,
                criado_em
           FROM audit_logs
           ${where}
          ORDER BY criado_em DESC
          LIMIT ${lim} OFFSET ${off}`,
        params
      ),
      db.query(`SELECT COUNT(*)::int AS total FROM audit_logs ${where}`, params),
    ]);

    res.json({
      total: total.rows[0].total,
      limit: lim,
      offset: off,
      rows: rows.rows,
    });
  } catch (e) {
    console.error('[audit GET]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
