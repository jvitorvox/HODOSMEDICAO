/**
 * CONSTRUTIVO OBRAS — Helper D4Sign
 * Integração com a API REST da D4Sign para envio de documentos
 * para assinatura eletrônica.
 *
 * Referência: https://developers.d4sign.com.br/
 *
 * Campos de configuração (salvos em configuracoes WHERE chave='assinatura'):
 *   d4ApiKey  — Token de API (gerado no painel D4Sign em Integrações → Token API)
 *   d4Token   — UUID do cofre onde os documentos serão armazenados
 *   d4CryptKey— Crypt Key para webhooks (opcional)
 */
'use strict';

const https = require('https');
const http  = require('http');

const D4SIGN_BASE = 'https://secure.d4sign.com.br/api/v1';

// ── Wrapper HTTP (JSON) ───────────────────────────────────────────────────────
function _buildUrl(apiKey, cryptKey, path) {
  // cryptKey é sempre incluído na URL — mesmo vazio — pois a D4Sign exige o parâmetro presente
  // (o upload sempre inclui &cryptKey= e funciona; omitir o parâmetro causa HTTP 401)
  return `${D4SIGN_BASE}${path}?tokenAPI=${encodeURIComponent(apiKey)}&cryptKey=${encodeURIComponent(cryptKey || '')}`;
}

function _req(apiKey, cryptKey, method, path, body) {
  return new Promise((resolve, reject) => {
    const url    = _buildUrl(apiKey, cryptKey, path);
    const parsed = new URL(url);
    const isJson = body !== null && !(body instanceof Buffer) && typeof body === 'object';
    const bodyStr = isJson ? JSON.stringify(body) : null;

    const opts = {
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Accept':           'application/json',
        'Accept-Encoding':  'identity',
        ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed2;
        try { parsed2 = JSON.parse(raw); } catch { parsed2 = { raw }; }

        const hdrs = JSON.stringify(res.headers).slice(0, 400);
        console.log(`[D4Sign] ${method} ${path} → HTTP ${res.statusCode} | headers: ${hdrs} | body: ${JSON.stringify(parsed2).slice(0, 500)}`);

        if (res.statusCode >= 400) {
          const msg = parsed2?.message || parsed2?.error || parsed2?.raw || `HTTP ${res.statusCode}`;
          const isRateLimit = typeof msg === 'string' && /tempo limite|rate.?limit|atingiu/i.test(msg);
          const err = new Error(isRateLimit
            ? `D4Sign: API key atingiu o limite de requisições. Aguarde 1–2 horas e tente novamente.`
            : `D4Sign: ${msg}`);
          err.statusCode = res.statusCode;
          err.body = parsed2;
          return reject(err);
        }

        // D4Sign frequentemente retorna HTTP 200 mesmo em caso de erro
        // Verificar body para indicadores de erro
        if (parsed2 && typeof parsed2 === 'object' && !Array.isArray(parsed2)) {
          const msg = parsed2.message;
          const statusCode = parsed2.status_code ?? parsed2.statusCode;
          // status_code=1 significa sucesso na D4Sign
          if (statusCode !== undefined && statusCode !== 1 && statusCode !== '1') {
            const err = new Error(`D4Sign erro (status_code=${statusCode}): ${msg || JSON.stringify(parsed2).slice(0, 200)}`);
            err.body = parsed2;
            return reject(err);
          }
          // Se tem "message" mas não tem campos esperados de sucesso, pode ser erro
          if (msg && typeof msg === 'string' &&
              /erro|error|invalid|inválid|not found|não encontr|falha|failed/i.test(msg)) {
            const err = new Error(`D4Sign: ${msg}`);
            err.body = parsed2;
            return reject(err);
          }
        }

        resolve(parsed2);
      });
    });
    req.on('error', e => reject(new Error('Erro de rede ao chamar D4Sign: ' + e.message)));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Wrapper HTTP (form-urlencoded) — usado em createhttps ─────────────────────
function _reqForm(apiKey, cryptKey, method, path, fields) {
  return new Promise((resolve, reject) => {
    const url    = _buildUrl(apiKey, cryptKey, path);
    const parsed = new URL(url);
    const bodyStr = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const opts = {
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type':    'application/x-www-form-urlencoded',
        'Content-Length':  Buffer.byteLength(bodyStr),
        'Accept':          'application/json',
        'Accept-Encoding': 'identity',
      },
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed2;
        try { parsed2 = JSON.parse(raw); } catch { parsed2 = { raw }; }
        console.log(`[D4Sign][form] ${method} ${path} → HTTP ${res.statusCode} | body: ${JSON.stringify(parsed2).slice(0, 500)}`);
        if (res.statusCode >= 400) {
          const msg = parsed2?.message || parsed2?.raw || `HTTP ${res.statusCode}`;
          return reject(new Error(`D4Sign: ${msg}`));
        }
        resolve(parsed2);
      });
    });
    req.on('error', e => reject(new Error('Erro de rede D4Sign: ' + e.message)));
    req.write(bodyStr);
    req.end();
  });
}

// ── Upload multipart (PDF em Buffer) ─────────────────────────────────────────
// D4Sign exige multipart/form-data com o campo "file"
function _upload(apiKey, cryptKey, safeUuid, pdfBuffer, filename) {
  return new Promise((resolve, reject) => {
    const boundary = `----ConstrutivoBoundary${Date.now()}`;
    const CRLF = '\r\n';

    // Monta o corpo multipart manualmente
    const header = Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: application/pdf${CRLF}${CRLF}`
    );
    const footer = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
    const formBody = Buffer.concat([header, pdfBuffer, footer]);

    const sep = safeUuid.includes('?') ? '&' : '?';
    const url = `${D4SIGN_BASE}/documents/${safeUuid}/upload${sep}tokenAPI=${encodeURIComponent(apiKey)}&cryptKey=${encodeURIComponent(cryptKey || '')}`;
    const parsed = new URL(url);

    const opts = {
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formBody.length,
        'Accept':         'application/json',
      },
    };

    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed2;
        try { parsed2 = JSON.parse(raw); } catch { parsed2 = { raw }; }
        if (res.statusCode >= 400) {
          const msg = parsed2?.message || parsed2?.error || raw.slice(0, 200) || `HTTP ${res.statusCode}`;
          const isRateLimit = typeof msg === 'string' && /tempo limite|rate.?limit|atingiu/i.test(msg);
          const err = new Error(isRateLimit
            ? `D4Sign: API key atingiu o limite de requisições. Aguarde 1–2 horas e tente novamente.`
            : `D4Sign upload: ${msg}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        resolve(parsed2);
      });
    });
    req.on('error', e => reject(new Error('Erro de rede no upload D4Sign: ' + e.message)));
    req.write(formBody);
    req.end();
  });
}

// ── 1. Upload do PDF ──────────────────────────────────────────────────────────
async function uploadDocument(apiKey, cryptKey, safeUuid, pdfBuffer, filename) {
  console.log(`[D4Sign] Uploading "${filename}" to safe ${safeUuid}...`);
  const r = await _upload(apiKey, cryptKey, safeUuid, pdfBuffer, filename);
  // Resposta: { uuid: "...", name: "...", ... }
  const uuid = r.uuid || r.document?.uuid || r[0]?.uuid;
  if (!uuid) throw new Error(`D4Sign upload: UUID do documento não retornado. Resposta: ${JSON.stringify(r).slice(0, 300)}`);
  console.log(`[D4Sign] Documento criado. uuid=${uuid}`);
  return uuid; // UUID do documento
}

// ── 1b. Aguardar documento ser processado pela D4Sign ────────────────────────
// D4Sign processa o upload assincronamente; aguardamos um delay fixo antes de
// adicionar signatários para evitar o erro "Aguardando processamento".
// Não usamos polling para não exceder o rate limit da API key.
async function waitDocumentReady(docUuid, delayMs = 6000) {
  console.log(`[D4Sign] Aguardando ${delayMs}ms para processamento do doc ${docUuid}...`);
  await new Promise(res => setTimeout(res, delayMs));
  console.log(`[D4Sign] Delay concluído. Prosseguindo com signatários.`);
}

// ── 2. Verificar estado do documento antes de adicionar signatários ──────────
async function checkDocumentReady(apiKey, cryptKey, docUuid) {
  const r = await _req(apiKey, cryptKey, 'GET', `/documents/${docUuid}`, null);
  // D4Sign pode retornar objeto único ou array — normaliza
  const doc = Array.isArray(r) ? r[0] : r;
  // O campo statusId pode variar entre versões da API
  const statusId = doc?.statusId ?? doc?.status_id ?? doc?.['statusId'] ?? doc?.status;
  console.log(`[D4Sign] checkDocumentReady doc=${docUuid} statusId=${statusId} | fullBody=`, JSON.stringify(r).slice(0, 600));
  return { statusId, body: r, doc };
}

// ── 3. Adicionar signatários ──────────────────────────────────────────────────
// act: "1"=Assinar, "2"=Aprovar, "3"=Reconhecer firma, "4"=Assinar como parte, "5"=Acusar recebimento
// A D4Sign espera JSON no endpoint createhttps
async function addSignatories(apiKey, cryptKey, docUuid, signatories) {
  // signatories = [{ email, act?, whatsappNumber? }]
  const results = [];
  for (const s of signatories) {
    // whatsapp_number: D4Sign espera apenas dígitos, ex: 5511999999999
    const wppRaw = s.whatsappNumber || '';
    const wppDigits = wppRaw.replace(/\D/g, ''); // remove tudo exceto dígitos
    // Garante código de país 55 se o número for brasileiro (10 ou 11 dígitos sem código)
    let wppFinal = '';
    if (wppDigits) {
      wppFinal = wppDigits.startsWith('55') ? wppDigits : `55${wppDigits}`;
    }

    // Payload mínimo — sem campos opcionais que podem causar rejeição silenciosa
    const payload = {
      email:   s.email,
      act:     String(s.act || '1'),
      foreign: '0',
      certificadoicpbr: '0',
      assinatura_presencial: '0',
    };
    if (wppFinal) {
      payload.whatsapp_number = wppFinal;
    }
    console.log(`[D4Sign] addSignatory doc=${docUuid} payload=`, JSON.stringify(payload));

    // Tenta com JSON primeiro; se retornar corpo vazio, tenta form-urlencoded
    let r;
    let usedForm = false;
    r = await _req(apiKey, cryptKey, 'POST', `/documents/${docUuid}/createhttps`, payload);
    const rawBody1 = JSON.stringify(r);
    const isEmptyJson = rawBody1 === '{"raw":""}' || rawBody1 === 'null' || rawBody1 === '{}';

    if (isEmptyJson) {
      console.warn(`[D4Sign] JSON retornou corpo vazio — tentando form-urlencoded...`);
      r = await _reqForm(apiKey, cryptKey, 'POST', `/documents/${docUuid}/createhttps`, payload);
      usedForm = true;
    }

    const rawBody = JSON.stringify(r);
    console.log(`[D4Sign] addSignatory resposta (${usedForm ? 'form' : 'json'}) para ${s.email}: ${rawBody.slice(0, 400)}`);

    // Verifica se há erro explícito na resposta
    const sigUuid = r?.['uuid-signatory'] || r?.['key-signatory'] || r?.uuid || r?.key;
    const respMsg = r?.message || '';

    if (!sigUuid) {
      const isEmptyBody = rawBody === '{"raw":""}' || rawBody === 'null' || rawBody === '{}' || !rawBody;
      const isDuplicate = typeof respMsg === 'string' &&
        /já.*signat|signat.*já|already|duplicat/i.test(respMsg);
      const isExplicitError = typeof respMsg === 'string' && respMsg.length > 0 && !isDuplicate;

      if (isDuplicate) {
        console.warn(`[D4Sign] Signatário ${s.email} já estava cadastrado — continuando.`);
      } else if (isEmptyBody) {
        // Corpo vazio: D4Sign pode retornar assim em certos planos/configurações.
        // Continuamos — sendToSign vai validar se os signatários existem.
        console.warn(`[D4Sign] Resposta vazia para ${s.email} — continuando; sendToSign validará.`);
      } else if (isExplicitError) {
        throw new Error(`D4Sign createhttps: "${s.email}" — ${respMsg.slice(0, 200)}`);
      }
    } else {
      console.log(`[D4Sign] Signatário ${s.email} adicionado — uuid-signatory=${sigUuid}`);
    }

    results.push(r);
  }
  return results;
}

// ── 4. Enviar para assinatura ─────────────────────────────────────────────────
async function sendToSign(apiKey, cryptKey, docUuid, message) {
  const payload = {
    message:  message || 'Por favor, assine o documento de Autorização de Emissão de Nota Fiscal.',
    workflow: '0',  // 0 = todos assinam em paralelo
    skip_email: '0',
  };
  console.log(`[D4Sign] Enviando doc ${docUuid} para assinatura...`);
  const r = await _req(apiKey, cryptKey, 'POST', `/documents/${docUuid}/sendtosign`, payload);
  console.log(`[D4Sign] sendToSign resposta:`, JSON.stringify(r).slice(0, 300));

  // A D4Sign retorna HTTP 200 com corpo vazio para operações POST bem-sucedidas.
  // Só lança erro se a resposta indicar explicitamente falha (status_code != 1 ou mensagem de erro).
  const sc  = r?.status_code ?? r?.statusCode;
  const msg = r?.message || '';
  const rawBody = JSON.stringify(r);
  const isEmpty = rawBody === '{"raw":""}' || !rawBody || rawBody === 'null' || rawBody === '{}';

  if (sc !== undefined && sc !== 1 && sc !== '1') {
    throw new Error(`D4Sign sendtosign falhou (status_code=${sc}): ${msg || rawBody.slice(0, 200)}`);
  }
  // Detecta mensagem de erro explícita (ex: "Nenhum signatário cadastrado")
  if (msg && /erro|error|inválid|não.*signat|nenhum.*signat|sem.*signat/i.test(msg)) {
    throw new Error(`D4Sign sendtosign: ${msg}`);
  }
  // Corpo vazio ou resposta sem status_code = sucesso silencioso (comportamento normal da D4Sign)
  if (!isEmpty) {
    console.log(`[D4Sign] sendToSign concluído: ${msg || rawBody.slice(0, 100)}`);
  }
  return r;
}

// ── 4. Teste de conexão ───────────────────────────────────────────────────────
async function testConnection(apiKey, cryptKey) {
  return await _req(apiKey, cryptKey, 'GET', '/documents', null);
}

// ── Fluxo completo: upload → signatários → enviar ────────────────────────────
async function enviarParaAssinatura(cfg, {
  pdfBuffer, filename,
  signerEmail, signerName, signerWhatsapp,
  signerEmail2, signerName2,
  message,
}) {
  const { d4ApiKey, d4Token: safeUuid, d4CryptKey } = cfg;
  if (!d4ApiKey)    throw new Error('API Key do D4Sign não configurada (d4ApiKey)');
  if (!safeUuid)    throw new Error('UUID do cofre D4Sign não configurado (d4Token)');
  if (!signerEmail) throw new Error('E-mail do signatário é obrigatório');

  // 1. Upload
  const docUuid = await uploadDocument(d4ApiKey, d4CryptKey, safeUuid, pdfBuffer, filename);

  // 1b. Aguarda processamento do documento (delay fixo — sem polling para não consumir rate limit)
  console.log(`[D4Sign] Aguardando 8s para processamento do doc ${docUuid}...`);
  await new Promise(res => setTimeout(res, 8000));

  // 2. Signatários
  const sigs = [{
    email:          signerEmail,
    act:            '1',
    whatsappNumber: signerWhatsapp || undefined,
  }];
  if (signerEmail2 && signerEmail2 !== signerEmail) {
    sigs.push({ email: signerEmail2, act: '2' }); // act 2 = Aprovar
  }
  await addSignatories(d4ApiKey, d4CryptKey, docUuid, sigs);

  // 3. Enviar
  await sendToSign(d4ApiKey, d4CryptKey, docUuid, message);

  const linkVisualizacao = `https://secure.d4sign.com.br/desk/viewblob/${docUuid}`;
  console.log(`[D4Sign] ✅ Fluxo concluído. docUuid=${docUuid} | link=${linkVisualizacao}`);
  return { docUuid, linkVisualizacao };
}

module.exports = { uploadDocument, addSignatories, sendToSign, testConnection, enviarParaAssinatura };
