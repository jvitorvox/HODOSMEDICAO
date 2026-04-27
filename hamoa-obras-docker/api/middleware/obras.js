/**
 * CONSTRUTIVO OBRAS — Middleware de restrição de obras por usuário
 *
 * Cada usuário pode ter um array `obras_permitidas` no banco.
 * - ADM: nunca restringido (retorna null)
 * - obras_permitidas vazio ou null: vê tudo (retorna null)
 * - obras_permitidas com valores: vê apenas essas obras (retorna o array)
 *
 * Uso nas rotas:
 *   const { getObrasPermitidas, obraClause } = require('../middleware/obras');
 *
 *   // Dentro do handler:
 *   const obras = await getObrasPermitidas(req, db);
 *   // Em query com params array:
 *   const params = [val1, val2];
 *   const clause = obraClause(obras, 'o.id', params); // appende e retorna cláusula SQL
 *   await db.query(`SELECT ... WHERE ... ${clause}`, params);
 *
 *   // Para checar acesso a uma obra específica:
 *   if (!temAcessoObra(obras, obraId)) return res.status(403).json({...});
 */
'use strict';

const db = require('../db');

/**
 * Retorna o array de obras permitidas para o usuário, ou null (sem restrição).
 * @param {object} req - Request com req.user preenchido pelo middleware auth
 * @param {object} [dbPool] - Pool do pg (opcional, usa o global se omitido)
 * @returns {Promise<number[]|null>}
 */
async function getObrasPermitidas(req, dbPool) {
  if (req.user?.perfil === 'ADM') return null;
  const pool = dbPool || db;
  try {
    const r = await pool.query(
      'SELECT obras_permitidas FROM usuarios WHERE id=$1',
      [req.user.id]
    );
    const obras = r.rows[0]?.obras_permitidas;
    if (!obras || obras.length === 0) return null;
    return obras.map(Number);
  } catch (e) {
    console.error('[obras middleware] Erro ao buscar obras permitidas:', e.message);
    return null; // em caso de erro, não bloqueia (fail open)
  }
}

/**
 * Gera a cláusula SQL `AND coluna = ANY($N::int[])` e appende o valor em params.
 * Retorna string vazia se obras for null (sem restrição).
 * @param {number[]|null} obras - Resultado de getObrasPermitidas
 * @param {string} coluna       - Ex: 'o.id', 'm.obra_id', 'c.obra_id'
 * @param {Array}  params       - Array de parâmetros que será mutado
 * @returns {string}
 */
function obraClause(obras, coluna, params) {
  if (!obras) return '';
  params.push(obras);
  return `AND ${coluna} = ANY($${params.length}::int[])`;
}

/**
 * Verifica se o usuário tem acesso a uma obra específica.
 * @param {number[]|null} obras - Resultado de getObrasPermitidas
 * @param {number} obraId
 * @returns {boolean}
 */
function temAcessoObra(obras, obraId) {
  if (!obras) return true; // sem restrição
  return obras.includes(Number(obraId));
}

module.exports = { getObrasPermitidas, obraClause, temAcessoObra };
