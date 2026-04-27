/**
 * CONSTRUTIVO OBRAS — Rotas de autenticação
 * GET  /api/auth/mode   → modo de autenticação (local ou LDAP)
 * POST /api/auth/login  → login com retorno de JWT
 */
const router  = require('express').Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcrypt');
const db      = require('../db');
const { ldapAuth } = require('../helpers/ldap');
const auth  = require('../middleware/auth');
const audit = require('../middleware/audit');

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
        // Fallback local desabilitado quando LDAP está ativo:
        // um atacante poderia derrubar o servidor LDAP para forçar autenticação local.
        return res.status(401).json({ error: `Autenticação LDAP falhou: ${ldapErr.message}` });
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
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    // Injeta user em req temporariamente para o audit poder extrair os dados
    req.user = { id: user.id, login: user.login, nome: user.nome };
    await audit(req, 'login', 'usuario', user.id, `Login de "${user.login}"`);
    res.json({ token, user: { id: user.id, login: user.login, nome: user.nome, perfil: user.perfil, grupos: user.grupos_ad || [] } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Trocar própria senha (autenticação local) ──────────────────────
router.put('/senha', auth, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;
    if (!senha_atual || !nova_senha)
      return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
    if (nova_senha.length < 6)
      return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres' });

    // Usuários LDAP não têm senha_hash — não podem trocar por aqui
    const r = await db.query('SELECT senha_hash FROM usuarios WHERE id=$1', [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (!user.senha_hash)
      return res.status(400).json({ error: 'Sua conta usa autenticação via Active Directory. A senha deve ser alterada pelo AD.' });

    if (!await bcrypt.compare(senha_atual, user.senha_hash))
      return res.status(401).json({ error: 'Senha atual incorreta' });

    const novoHash = await bcrypt.hash(nova_senha, 12);
    await db.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2', [novoHash, req.user.id]);
    await audit(req, 'trocar_senha', 'usuario', req.user.id,
      `Usuário "${req.user.login}" alterou a própria senha`);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
