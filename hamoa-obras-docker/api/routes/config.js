/**
 * HAMOA OBRAS — Rotas de Configurações
 * GET  /api/config/:chave
 * PUT  /api/config/:chave
 * POST /api/config/ldap/test
 */
const router  = require('express').Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const { testLdapConnection } = require('../helpers/ldap');

router.get('/:chave', auth, async (req, res) => {
  const r = await db.query('SELECT * FROM configuracoes WHERE chave=$1', [req.params.chave]);
  res.json(r.rows[0] || null);
});

router.put('/:chave', auth, async (req, res) => {
  const r = await db.query(
    `INSERT INTO configuracoes(chave,valor) VALUES($1,$2)
     ON CONFLICT(chave) DO UPDATE SET valor=$2,atualizado_em=NOW()
     RETURNING *`,
    [req.params.chave, req.body]
  );
  res.json(r.rows[0]);
});

router.post('/ldap/test', auth, async (req, res) => {
  try {
    const cfg = req.body;
    if (!cfg || !cfg.servidor)
      return res.status(400).json({ error: 'Informe pelo menos o servidor LDAP' });
    await testLdapConnection(cfg);
    res.json({ ok: true, message: `Conexão com ${cfg.servidor} estabelecida e bind de serviço bem-sucedido!` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Teste de conexão ClickSign ────────────────────────────────────
router.post('/clicksign/test', auth, async (req, res) => {
  try {
    const { accessToken, ambiente } = req.body;
    if (!accessToken)
      return res.status(400).json({ error: 'Informe o Access Token do ClickSign' });
    const baseUrl = ambiente === 'producao'
      ? 'https://app.clicksign.com'
      : 'https://sandbox.clicksign.com';
    const { testConnection } = require('../helpers/clicksign');
    await testConnection(baseUrl, accessToken);
    const env = ambiente === 'producao' ? 'Produção' : 'Sandbox';
    res.json({ ok: true, message: `✓ Token válido — ClickSign ${env} acessível` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
