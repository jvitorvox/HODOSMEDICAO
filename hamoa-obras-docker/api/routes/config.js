/**
 * CONSTRUTIVO OBRAS — Rotas de Configurações
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

// ── Diagnóstico D4Sign ─────────────────────────────────────────────
// Faz upload de PDF mínimo, aguarda 10s, testa addSignatory nos 3 formatos
router.post('/d4sign/diagnose', auth, async (req, res) => {
  try {
    const { d4ApiKey, d4Token, d4CryptKey, email } = req.body;
    if (!d4ApiKey || !d4Token) return res.status(400).json({ error: 'd4ApiKey e d4Token são obrigatórios' });
    if (!email) return res.status(400).json({ error: 'email é obrigatório' });

    const https  = require('https');
    const D4BASE = 'https://secure.d4sign.com.br/api/v1';
    const crypt  = d4CryptKey ? `&cryptKey=${encodeURIComponent(d4CryptKey)}` : '';

    // PDF mínimo válido (1 página em branco)
    const pdfBuffer = Buffer.from(
      '%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj ' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
      '3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF'
    );

    // ── Upload ─────────────────────────────────────────────────────
    const boundary = `ConstrutivoDiag${Date.now()}`;
    const CRLF = '\r\n';
    const formBody = Buffer.concat([
      Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="diag.pdf"${CRLF}Content-Type: application/pdf${CRLF}${CRLF}`),
      pdfBuffer,
      Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
    ]);

    const docUuid = await new Promise((resolve, reject) => {
      const uploadUrl = new URL(`${D4BASE}/documents/${d4Token}/upload?tokenAPI=${encodeURIComponent(d4ApiKey)}${crypt}`);
      const opts = {
        hostname: uploadUrl.hostname, port: 443,
        path: uploadUrl.pathname + uploadUrl.search, method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': formBody.length },
      };
      const r = https.request(opts, res2 => {
        const chunks = []; res2.on('data', c => chunks.push(c));
        res2.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let parsed; try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
          const uuid = parsed.uuid || parsed.document?.uuid || parsed[0]?.uuid;
          if (!uuid) return reject(new Error(`Upload falhou: ${body.slice(0,300)}`));
          resolve(uuid);
        });
      });
      r.on('error', reject); r.write(formBody); r.end();
    });

    // ── Aguarda processamento ──────────────────────────────────────
    await new Promise(r => setTimeout(r, 10000));

    // Helper para fazer requests de teste
    const testReq = (method, path, ct, body) => new Promise(resolve => {
      const u = new URL(`${D4BASE}${path}?tokenAPI=${encodeURIComponent(d4ApiKey)}${crypt}`);
      const bodyBuf = body ? Buffer.from(body) : null;
      const opts = {
        hostname: u.hostname, port: 443, path: u.pathname + u.search, method,
        headers: {
          'Accept': 'application/json', 'Accept-Encoding': 'identity',
          ...(bodyBuf ? { 'Content-Type': ct, 'Content-Length': bodyBuf.length } : {}),
        },
      };
      const r = https.request(opts, res2 => {
        const chunks = []; res2.on('data', c => chunks.push(c));
        res2.on('end', () => {
          resolve({ status: res2.statusCode, body: Buffer.concat(chunks).toString('utf8'), headers: res2.headers });
        });
      });
      r.on('error', e => resolve({ error: e.message }));
      if (bodyBuf) r.write(bodyBuf);
      r.end();
    });

    const sigPayloadForm = `email=${encodeURIComponent(email)}&act=1&foreign=0&certificadoicpbr=0&assinatura_presencial=0&embed_methodauth=email&embed_smsnumber=`;
    const sigPayloadJson = JSON.stringify({ email, act:'1', foreign:'0', certificadoicpbr:'0', assinatura_presencial:'0', embed_methodauth:'email', embed_smsnumber:'' });

    const results = { docUuid };

    // 1. GET do documento — ver status atual
    results['GET documento'] = await testReq('GET', `/documents/${docUuid}`, null, null);

    // 2. Endpoints alternativos para addSignatory
    const testes = [
      { nome: 'POST createhttps (form)',  method:'POST', path:`/documents/${docUuid}/createhttps`,  ct:'application/x-www-form-urlencoded', body: sigPayloadForm },
      { nome: 'POST createhttps (json)',  method:'POST', path:`/documents/${docUuid}/createhttps`,  ct:'application/json',                  body: sigPayloadJson },
      { nome: 'POST signatarios',         method:'POST', path:`/documents/${docUuid}/signatarios`,  ct:'application/json',                  body: sigPayloadJson },
      { nome: 'POST signatories',         method:'POST', path:`/documents/${docUuid}/signatories`,  ct:'application/json',                  body: sigPayloadJson },
      { nome: 'GET acts',                 method:'GET',  path:`/acts`,                              ct: null,                               body: null },
    ];

    for (const t of testes) {
      results[t.nome] = await testReq(t.method, t.path, t.ct, t.body);
    }

    res.json({ ok: true, resultados: results });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// ── Teste de conexão S3 ───────────────────────────────────────────
router.post('/storage/test-s3', auth, async (req, res) => {
  try {
    const { s3 } = req.body;
    await storage.testS3(s3 || {});
    res.json({ ok: true, message: `✓ Bucket "${s3.bucket}" acessível na região ${s3.region || 'sa-east-1'}` });
  } catch (e) {
    console.error('[config/storage/test-s3]', e);
    res.status(400).json({ error: e.message });
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
