/**
 * HAMOA OBRAS — Middleware de Permissões por Grupo AD
 *
 * As permissões são configuradas em configuracoes.valor (chave='permissoes'):
 *   { "NomeGrupo": { "criarMedicao": true, "aprovarN1": false, ... } }
 *
 * Usuários com perfil='ADM' têm acesso total sem verificação.
 * Usuários LDAP: grupos vêm de req.user.grupos (array de strings).
 * Usuários locais: grupos_ad vem do banco via JWT (campo grupos).
 *
 * Uso nas rotas:
 *   router.post('/', auth, perm('criarMedicao'), handler)
 *
 * Para checar inline (quando a permissão depende de dados da requisição):
 *   const ok = await checkPerm(req.user.grupos, 'aprovarN1');
 *   if (!ok) return res.status(403).json({ error: '...' });
 */
'use strict';

const db = require('../db');

// ── Cache de permissões (evita hit no banco a cada request) ──────────
let _cache      = null;
let _cacheTime  = 0;
const CACHE_TTL = 30 * 1000; // 30 segundos

async function _loadPerms() {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL) return _cache;
  try {
    const r = await db.query("SELECT valor FROM configuracoes WHERE chave='permissoes'");
    _cache     = r.rows[0]?.valor || {};
    _cacheTime = now;
  } catch {
    _cache = _cache || {};
  }
  return _cache;
}

/** Invalida o cache (chamar após salvar permissões) */
function invalidatePermsCache() {
  _cache = null;
  _cacheTime = 0;
}

/**
 * Verifica se o usuário (via seus grupos) tem a permissão solicitada.
 * ADM sempre retorna true.
 * @param {string[]} grupos   - grupos do usuário (req.user.grupos)
 * @param {string}   perfil   - perfil do usuário (req.user.perfil)
 * @param {string}   permKey  - chave de permissão (ex: 'aprovarN1')
 * @returns {Promise<boolean>}
 */
async function checkPerm(grupos, perfil, permKey) {
  if (perfil === 'ADM') return true;
  const perms = await _loadPerms();
  const gruposUsuario = Array.isArray(grupos) ? grupos : [];
  return gruposUsuario.some(g => perms[g]?.[permKey] === true);
}

/**
 * Middleware factory — bloqueia se o usuário não tiver a permissão.
 * @param {string} permKey - chave de permissão
 */
function perm(permKey) {
  return async (req, res, next) => {
    try {
      const ok = await checkPerm(
        req.user?.grupos || [],
        req.user?.perfil,
        permKey
      );
      if (!ok) {
        return res.status(403).json({
          error: `Sem permissão para executar esta ação (${permKey}). Contate o administrador.`
        });
      }
      next();
    } catch (e) {
      console.error('[perm]', e.message);
      res.status(500).json({ error: 'Erro ao verificar permissões' });
    }
  };
}

module.exports = { perm, checkPerm, invalidatePermsCache };
