/**
 * CONSTRUTIVO OBRAS — Helpers LDAP
 * Autenticação via Active Directory usando ldapjs.
 */
const ldapjs = require('ldapjs');

/** Cria um cliente ldapjs com as configurações fornecidas. */
function _ldapClient(cfg) {
  const port  = cfg.ssl ? (cfg.portaSSL || 636) : (cfg.porta || 389);
  const proto = cfg.ssl ? 'ldaps' : 'ldap';
  return ldapjs.createClient({
    url: `${proto}://${cfg.servidor}:${port}`,
    timeout: 10000,
    connectTimeout: 10000,
    tlsOptions: { rejectUnauthorized: false },
  });
}

/**
 * Escapa caracteres especiais para filtros LDAP (RFC 4515).
 * ldapjs v3 removeu ldapjs.escapeFilter — implementação própria.
 */
function _ldapEscape(str) {
  return String(str).replace(/[\\*()\x00]/g, c =>
    '\\' + c.charCodeAt(0).toString(16).padStart(2, '0')
  );
}

/**
 * Normaliza mensagens de erro do ldapjs.
 * "client destroyed" indica falha de conexão (DNS/rede inacessível).
 */
function _ldapErr(err, connError) {
  const msg = err?.message ? err.message : String(err);
  if (msg === 'client destroyed' || msg.includes('client destroyed')) {
    return connError || new Error(
      'Não foi possível conectar ao servidor LDAP (servidor inacessível ou porta incorreta)'
    );
  }
  return err;
}

/**
 * Testa conectividade com o servidor LDAP (bind de serviço).
 * @returns {Promise<{ok: true}>}
 */
function testLdapConnection(cfg) {
  return new Promise((resolve, reject) => {
    if (!cfg.servidor) return reject(new Error('Servidor LDAP não configurado'));
    const client = _ldapClient(cfg);
    let connError = null;
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      try { client.destroy(); } catch (_) {}
      err ? reject(err) : resolve(val);
    };
    client.on('error', err => {
      connError = new Error(`Conexão recusada: ${err.message}`);
      finish(connError);
    });
    client.bind(cfg.usuarioServico || '', cfg.senhaServico || '', (err) => {
      if (err) return finish(_ldapErr(err, connError) || new Error(`Bind falhou: ${err.message}`));
      finish(null, { ok: true });
    });
  });
}

/**
 * Autentica um usuário via LDAP e retorna seus atributos.
 * Fluxo: bind serviço → busca DN do usuário → bind com senha do usuário.
 * @returns {Promise<{login, nome, email, grupos_ad}>}
 */
function ldapAuth(login, senha, cfg) {
  return new Promise((resolve, reject) => {
    const client = _ldapClient(cfg);
    let connError = null;
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      try { client.destroy(); } catch (_) {}
      err ? reject(err) : resolve(val);
    };

    client.on('error', err => {
      connError = new Error(`Servidor LDAP inacessível (${cfg.servidor}): ${err.message}`);
      finish(connError);
    });

    // 1) Bind com conta de serviço para buscar o usuário
    client.bind(cfg.usuarioServico || '', cfg.senhaServico || '', (err) => {
      if (err) {
        const e = _ldapErr(err, connError);
        return finish(e || new Error(`Falha na conta de serviço LDAP: ${err.message}`));
      }

      const attrLogin  = cfg.atributoLogin  || 'sAMAccountName';
      const attrNome   = cfg.atributoNome   || 'displayName';
      const attrEmail  = cfg.atributoEmail  || 'mail';
      const attrGrupos = cfg.atributoGrupos || 'memberOf';

      // 2) Busca o DN do usuário pelo login
      client.search(cfg.baseDN || '', {
        filter: `(${attrLogin}=${_ldapEscape(login)})`,
        scope: 'sub',
        attributes: ['dn', attrLogin, attrNome, attrEmail, attrGrupos],
      }, (err, res) => {
        if (err) return finish(_ldapErr(err, connError) || new Error(`Busca LDAP falhou: ${err.message}`));

        let entry = null;
        res.on('searchEntry', e => { entry = e; });
        res.on('error', e => finish(_ldapErr(e, connError) || new Error(`Busca: ${e.message}`)));
        res.on('end', () => {
          if (done) return;
          if (!entry) return finish(new Error('Usuário não encontrado no Active Directory'));

          const userDN = entry.objectName || entry.dn;

          // 3) Bind com a senha do usuário para validar
          client.bind(userDN, senha, (err) => {
            if (err) {
              const e = _ldapErr(err, connError);
              return finish(e || new Error('Usuário ou senha incorretos'));
            }

            // 4) Extrai atributos
            const get = (attr) => {
              const a = entry.attributes.find(x => x.type === attr);
              return a ? (Array.isArray(a.values) ? a.values : [a.values]) : [];
            };
            const grupos = get(attrGrupos).map(g => {
              const m = g.match(/^CN=([^,]+)/i);
              return m ? m[1] : g;
            });

            finish(null, {
              login,
              nome:      get(attrNome)[0]  || login,
              email:     get(attrEmail)[0] || '',
              grupos_ad: grupos,
            });
          });
        });
      });
    });
  });
}

module.exports = { testLdapConnection, ldapAuth };
