/**
 * HAMOA OBRAS — Rotas de Configurações
 * GET  /api/config/:chave
 * PUT  /api/config/:chave
 * POST /api/config/ldap/test
 */
const router  = require('express').Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const audit   = require('../middleware/audit');
const { testLdapConnection } = require('../helpers/ldap');
const storage = require('../helpers/storage');

// Mapa de chaves legíveis para exibição no log
const _chaveLabel = {
  permissoes:       'Permissões de grupos',
  ldap:             'Configuração LDAP',
  ia:               'Inteligência Artificial',
  clicksign:        'ClickSign (assinatura)',
  alcadas:          'Alçadas de aprovação',
  storage:          'Armazenamento de Evidências',
};

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
  const label = _chaveLabel[req.params.chave] || req.params.chave;
  await audit(req, 'salvar_config', 'configuracao', null, `Configuração "${label}" salva`);
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

// ── Teste de conexão S3 ───────────────────────────────────────────
router.post('/storage/test-s3', auth, async (req, res) => {
  try {
    const { s3 } = req.body;
    if (!s3?.bucket || !s3?.accessKeyId || !s3?.secretAccessKey)
      return res.status(400).json({ error: 'Preencha bucket, accessKeyId e secretAccessKey' });
    await storage.testS3(s3);
    res.json({ ok: true, message: `✓ Bucket "${s3.bucket}" acessível na região ${s3.region || 'sa-east-1'}` });
  } catch (e) {
    res.status(400).json({ error: `Erro S3: ${e.message}` });
  }
});

// ── Teste de conexão Google Drive ─────────────────────────────────
router.post('/storage/test-gdrive', auth, async (req, res) => {
  try {
    const { gdrive } = req.body;
    if (!gdrive?.folderId || !gdrive?.serviceAccountKey)
      return res.status(400).json({ error: 'Preencha folderId e serviceAccountKey' });
    await storage.testGDrive(gdrive);
    res.json({ ok: true, message: `✓ Pasta Google Drive "${gdrive.folderId}" acessível` });
  } catch (e) {
    res.status(400).json({ error: `Erro Google Drive: ${e.message}` });
  }
});

module.exports = router;
