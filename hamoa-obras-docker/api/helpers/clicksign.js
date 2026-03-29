/**
 * HAMOA OBRAS — Helper ClickSign
 * Integração com a API REST da ClickSign para envio de documentos
 * para assinatura eletrônica.
 *
 * Referência: https://developers.clicksign.com/docs/
 */
'use strict';

const https = require('https');
const http  = require('http');

// ── Extrai mensagem de erro da resposta ClickSign ─────────────────────────────
// ClickSign pode retornar erros em vários formatos:
// { "errors": { "field": ["msg1","msg2"] } }
// { "errors": [{ "message": "..." }] }
// { "message": "..." }
// { "error": "..." }
function _extractError(parsed, statusCode) {
  if (!parsed) return `HTTP ${statusCode}`;

  // Formato objeto: { errors: { campo: ["mensagem"] } }
  if (parsed.errors && typeof parsed.errors === 'object' && !Array.isArray(parsed.errors)) {
    const msgs = [];
    for (const [field, errs] of Object.entries(parsed.errors)) {
      const errList = Array.isArray(errs) ? errs.join(', ') : String(errs);
      msgs.push(`${field}: ${errList}`);
    }
    if (msgs.length) return msgs.join(' | ');
  }

  // Formato array: { errors: [{ message: "..." }] }
  if (Array.isArray(parsed.errors) && parsed.errors.length) {
    return parsed.errors.map(e => e.message || JSON.stringify(e)).join(' | ');
  }

  // Campos simples
  if (parsed.message) return parsed.message;
  if (parsed.error)   return parsed.error;

  // Fallback: mostra o JSON bruto (truncado)
  const raw = JSON.stringify(parsed);
  return `HTTP ${statusCode} — ${raw.slice(0, 200)}`;
}

// ── Wrapper HTTP genérico (com retry para 429) ────────────────────────────────
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

function _reqOnce(baseUrl, token, method, path, body, stepName) {
  return new Promise((resolve, reject) => {
    const url    = `${baseUrl}${path}${path.includes('?') ? '&' : '?'}access_token=${token}`;
    const parsed = new URL(url);
    const opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers:  { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    const mod = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed2;
        try { parsed2 = JSON.parse(raw); } catch { parsed2 = { raw }; }

        if (res.statusCode >= 400) {
          const msg    = _extractError(parsed2, res.statusCode);
          const prefix = stepName ? `[${stepName}] ` : '';
          const err    = new Error(`ClickSign: ${prefix}${msg}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        resolve(parsed2);
      });
    });
    req.on('error', (e) => reject(new Error('Erro de rede ao chamar ClickSign: ' + e.message)));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Retry automático em caso de 429 (rate limit): backoff exponencial, até 5 tentativas
// Delays: 10s → 20s → 40s → 60s (total máx ~130s de espera)
async function _req(baseUrl, token, method, path, body, stepName) {
  const maxRetries = 5;
  const delays     = [10000, 20000, 40000, 60000]; // ms entre tentativas
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await _reqOnce(baseUrl, token, method, path, body, stepName);
    } catch (err) {
      if (err.statusCode === 429 && attempt < maxRetries) {
        const wait = delays[attempt - 1] || 60000;
        console.warn(`[ClickSign] Rate limit (429) na etapa [${stepName}] — aguardando ${wait/1000}s (tentativa ${attempt}/${maxRetries})`);
        await _sleep(wait);
      } else {
        throw err;
      }
    }
  }
}

// ── 1. Upload de documento (PDF em base64) ────────────────────────────────────
async function uploadDocument(baseUrl, token, { path: docPath, pdfBase64 }) {
  // deadline_at obrigatório: 30 dias no futuro
  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const r = await _req(baseUrl, token, 'POST', '/api/v1/documents', {
    document: {
      path:           docPath,
      content_base64: `data:application/pdf;base64,${pdfBase64}`,
      deadline_at:    deadline,
      auto_close:     true,
      locale:         'pt-BR',
      sequence_enabled: false,
    },
  }, 'upload');
  return r.document; // { key, status, ... }
}

// ── Busca signatário existente pelo e-mail ────────────────────────────────────
async function findSignerByEmail(baseUrl, token, email) {
  try {
    // ClickSign aceita filtro por email na listagem de signatários
    const r = await _req(baseUrl, token, 'GET',
      `/api/v1/signers?search[email]=${encodeURIComponent(email)}`, null, 'findSigner');
    // Resposta pode ser: { signers: [...] } ou { data: [...] } ou [...]
    const list = Array.isArray(r) ? r : (r.signers || r.data || []);
    const found = list.find(s => {
      const e = s.email || s.signer?.email || '';
      return e.toLowerCase() === email.toLowerCase();
    });
    if (found) {
      // Normaliza: garante que retornamos o objeto com .key no nível superior
      return found.signer || found;
    }
    return null;
  } catch (findErr) {
    console.warn('[ClickSign][findSigner] Falha ao buscar signatário existente:', findErr.message);
    return null; // Se busca falhar, retorna null e deixa o erro original aparecer
  }
}

// ── 2. Criar signatário ───────────────────────────────────────────────────────
async function createSigner(baseUrl, token, { email, phone, name, auths }) {
  const authMethods = auths && auths.length ? auths : ['email'];
  if (!email)
    throw new Error('E-mail do signatário é obrigatório (usado pelo ClickSign como identificador)');
  if (authMethods.includes('whatsapp') && !phone)
    throw new Error('Telefone do signatário é obrigatório para autenticação por WhatsApp');

  // ClickSign exige número no formato E.164: +5511999999999
  let phoneFormatted = phone || undefined;
  if (phoneFormatted) {
    phoneFormatted = phoneFormatted.replace(/[^\d+]/g, '');
    if (!phoneFormatted.startsWith('+')) {
      phoneFormatted = '+55' + phoneFormatted.replace(/^0/, '');
    }
  }

  // ClickSign exige nome completo (mínimo nome + sobrenome)
  let fullName = (name || '').trim();
  if (!fullName) fullName = 'Representante Fornecedor';
  else if (fullName.split(/\s+/).length < 2) fullName = fullName + ' Fornecedor';

  try {
    const r = await _req(baseUrl, token, 'POST', '/api/v1/signers', {
      signer: {
        email,
        phone_number:      phoneFormatted,
        auths:             authMethods,
        name:              fullName,
        has_documentation: false,
      },
    }, 'createSigner');
    return r.signer;
  } catch (err) {
    // "Autenticação deve ser única" = signatário com este e-mail já existe no ClickSign
    // Busca e reutiliza o cadastro existente
    const isUniqueError = /única|unique|já existe|already|duplicat/i.test(err.message);
    console.warn('[ClickSign][createSigner] Erro:', err.message, '| isUnique:', isUniqueError);
    if (isUniqueError && email) {
      const existing = await findSignerByEmail(baseUrl, token, email);
      if (existing) {
        console.log('[ClickSign][createSigner] Reutilizando signatário existente. key:', existing.key);
        return existing;
      }
    }
    throw err; // Se não encontrou, repassa o erro original
  }
}

// ── 3. Vincular signatário ao documento ──────────────────────────────────────
async function addSignerToDoc(baseUrl, token, { documentKey, signerKey, message }) {
  const r = await _req(baseUrl, token, 'POST', '/api/v1/lists', {
    list: {
      document_key: documentKey,
      signer_key:   signerKey,
      sign_as:      'sign',
      message:      message || 'Por favor, assine o documento de Autorização de Emissão de Nota Fiscal.',
    },
  }, 'addSigner');
  // A API ClickSign retorna: { list: { request_signature_key, document_key, signer_key, ... } }
  // O campo correto é `request_signature_key`, não `key`.
  const list = r.list || r;
  console.log('[ClickSign][addSigner] list keys:', Object.keys(list));
  return list;
}

// ── 4. Notificar signatário ───────────────────────────────────────────────────
// O ClickSign usa o `request_signature_key` retornado pelo POST /api/v1/lists,
// não os campos document_key + signer_key separados.
async function notifySigner(baseUrl, token, { requestSignatureKey }) {
  const r = await _req(baseUrl, token, 'POST', '/api/v1/notifications', {
    notification: { request_signature_key: requestSignatureKey },
  }, 'notify');
  return r;
}

// ── 5. Teste de conexão (GET /api/v1/documents) ──────────────────────────────
async function testConnection(baseUrl, token) {
  const r = await _req(baseUrl, token, 'GET', '/api/v1/documents?limit=1', null, 'test');
  return r;
}

// ── Fluxo completo: upload → signer → list → notify ─────────────────────────
async function enviarParaAssinatura(cfg, { pdfBase64, docPath, signerEmail, signerPhone, signerName, auths, message }) {
  const { accessToken, baseUrl } = cfg;
  if (!accessToken) throw new Error('Access Token do ClickSign não configurado');

  const doc    = await uploadDocument(baseUrl, accessToken, { path: docPath, pdfBase64 });
  console.log('[ClickSign] doc keys:', Object.keys(doc));

  const signer = await createSigner(baseUrl, accessToken, { email: signerEmail, phone: signerPhone, name: signerName, auths });
  console.log('[ClickSign] signer keys:', Object.keys(signer));

  // addSignerToDoc retorna o objeto list do ClickSign:
  // { request_signature_key, document_key, signer_key, ... }
  const list   = await addSignerToDoc(baseUrl, accessToken, { documentKey: doc.key, signerKey: signer.key, message });

  // ClickSign usa `request_signature_key` (não `key`) para identificar a solicitação de assinatura
  const requestSignatureKey = list.request_signature_key || list.key;
  if (!requestSignatureKey) {
    throw new Error(`[addSigner] request_signature_key não retornado pela ClickSign. Campos recebidos: ${Object.keys(list).join(', ')}`);
  }

  // Notificação: o ClickSign já envia automaticamente quando o signatário é vinculado ao
  // documento (POST /api/v1/lists). A chamada a /notifications serve apenas para reenvio.
  // Se retornar 404, significa que a notificação automática já foi disparada — não é erro.
  try {
    await notifySigner(baseUrl, accessToken, { requestSignatureKey });
    console.log('[ClickSign] Notificação enviada com sucesso.');
  } catch (notifyErr) {
    if (notifyErr.statusCode === 404) {
      console.warn('[ClickSign][notify] 404 — notificação automática já foi enviada pelo ClickSign ao vincular o signatário. Fluxo continua normalmente.');
    } else {
      // Para outros erros (ex: 422, 500), lançar o erro normalmente
      throw notifyErr;
    }
  }

  return {
    documentKey:          doc.key,
    signerKey:            signer.key,
    requestSignatureKey,
    linkVisualizacao:     `${baseUrl}/sign/${requestSignatureKey}`,
  };
}

module.exports = { uploadDocument, createSigner, addSignerToDoc, notifySigner, testConnection, enviarParaAssinatura };
