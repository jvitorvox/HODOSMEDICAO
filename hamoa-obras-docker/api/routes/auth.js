/**
 * HAMOA OBRAS — Rotas de autenticação
 * GET  /api/auth/mode   → modo de autenticação (local ou LDAP)
 * POST /api/auth/login  → login com retorno de JWT
 */
const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const db      = require('../db');
const { ldapAuth } = require('../helpers/ldap');

// Modo de autenticação (público, sem token)
router.get('/mode', async (req, res) => {
  try {
    const r    = await db.query("SELECT valor FROM configuracoes WHERE chave='ldap'");
    const ldap = r.rows[0] ? r.rows[0].valor : {};
    res.json({ mode: ldap.ativo ? 'ldap' : 'local', servidor: ldap.ativo ? (ldap.servidor || '') : '' });
  } catch (e) {
    res.json({ mode: 'local', servidor: '' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { login, senha } = req.body;
    if (!login || !senha) return res.status(400).json({ error: 'Login e senha obrigatórios' });

    const ldapCfg = await db.query("SELECT valor FROM configuracoes WHERE chave='ldap'");
    const ldap    = ldapCfg.rows[0] ? ldapCfg.rows[0].valor : {};
    let user;

    if (ldap.ativo) {
      // ── Autenticação LDAP ────────────────────────────────────────
      console.log(`[LOGIN] LDAP: "${login}" → ${ldap.servidor}`);
      let ldapUser;
      try {
        ldapUser = await ldapAuth(login, senha, ldap);
        console.log(`[LOGIN] LDAP OK: "${login}" grupos=${JSON.stringify(ldapUser.grupos_ad)}`);
      } catch (ldapErr) {
        console.error(`[LOGIN] LDAP falhou: "${login}" — ${ldapErr.message}`);
        // Fallback local apenas em erros de conectividade (não de credencial)
        const isConnErr = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|inacessível|destroyed|timeout/i.test(ldapErr.message);
        if (isConnErr) {
          const localR = await db.query(
            'SELECT * FROM usuarios WHERE login=$1 AND ativo=true AND senha_hash IS NOT NULL', [login]
          );
          if (localR.rows[0] && await bcrypt.compare(senha, localR.rows[0].senha_hash)) {
            console.warn(`[LOGIN] Fallback local para "${login}" (LDAP inacessível)`);
            user = localR.rows[0];
          }
        }
        if (!user) return res.status(401).json({ error: `LDAP: ${ldapErr.message}` });
      }

      if (!user) {
        // Upsert do usuário local para rastreamento de acesso
        const existing = await db.query('SELECT * FROM usuarios WHERE login=$1', [ldapUser.login]);
        if (existing.rows[0]) {
          await db.query(
            'UPDATE usuarios SET nome=$1, email=$2, grupos_ad=$3, ultimo_acesso=NOW() WHERE login=$4',
            [ldapUser.nome, ldapUser.email, ldapUser.grupos_ad, ldapUser.login]
          );
          user = { ...existing.rows[0], ...ldapUser };
        } else {
          const r = await db.query(
            `INSERT INTO usuarios(login,nome,email,grupos_ad,perfil,ativo) VALUES($1,$2,$3,$4,'N1',true) RETURNING *`,
            [ldapUser.login, ldapUser.nome, ldapUser.email, ldapUser.grupos_ad]
          );
          user = r.rows[0];
        }
      }
    } else {
      // ── Autenticação local ───────────────────────────────────────
      const r = await db.query('SELECT * FROM usuarios WHERE login=$1 AND ativo=true', [login]);
      if (!r.rows[0]) return res.status(401).json({ error: 'Usuário ou senha incorretos' });
      if (!await bcrypt.compare(senha, r.rows[0].senha_hash))
        return res.status(401).json({ error: 'Usuário ou senha incorretos' });
      user = r.rows[0];
    }

    if (user.id) await db.query('UPDATE usuarios SET ultimo_acesso=NOW() WHERE id=$1', [user.id]);
    const token = jwt.sign(
      { id: user.id, login: user.login, nome: user.nome, perfil: user.perfil, grupos: user.grupos_ad },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    res.json({ token, user: { id: user.id, login: user.login, nome: user.nome, perfil: user.perfil } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
