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
// IMPORTANTE: D4Sign exige tokenAPI e cryptKey TANTO na URL quanto no corpo
// do formulário para o endpoint /createhttps. Sem isso retorna text/html vazio.
function _reqForm(apiKey, cryptKey, method, path, fields) {
  return new Promise((resolve, reject) => {
    const url    = _buildUrl(apiKey, cryptKey, path);
    const parsed = new URL(url);

    // Inclui tokenAPI e cryptKey no corpo do form (além da URL)
    const allFields = {
      tokenAPI:  apiKey,
      cryptKey:  cryptKey || '',
      ...fields,
    };
    const bodyStr = Object.entries(allFields)
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
          const msg = parsed2?.message || parsed2?.error || parsed2?.raw || `HTTP ${res.statusCode}`;
          const isRateLimit = typeof msg === 'string' && /tempo limite|rate.?limit|atingiu/i.test(msg);
          const err = new Error(isRateLimit
            ? `D4Sign: API key atingiu o limite de requisições. Aguarde 1–2 horas e tente novamente.`
            : `D4Sign: ${msg}`);
          err.statusCode = res.statusCode;
          err.body = parsed2;
          return reject(err);
        }
        // D4Sign pode retornar HTTP 200 com status:false indicando erro
        if (parsed2 && typeof parsed2 === 'object' && parsed2.status === false) {
          const msg = parsed2.error || parsed2.message || JSON.stringify(parsed2).slice(0, 200);
          const isRateLimit = typeof msg === 'string' && /tempo limite|rate.?limit|atingiu/i.test(msg);
          const err = new Error(isRateLimit
            ? `D4Sign: API key atingiu o limite de requisições. Aguarde 1–2 horas e tente novamente.`
            : `D4Sign: ${msg}`);
          err.body = parsed2;
          return reject(err);
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

// ── 1b. Aguardar documento ser processado pela D4Sign (polling) ──────────────
// D4Sign processa o upload assincronamente. Este helper faz polling do status
// do documento a cada 5 segundos até ficar pronto (statusId=2 = "Processado /
// Aguardando signatários"). Timeout de 90 segundos para PDFs grandes.
//
// Mapeamento de statusId D4Sign:
//   1 = Aguardando processamento
//   2 = Aguardando signatários  ← estado correto para addSignatories
//   3 = Aguardando assinaturas
//   4 = Concluído
//   5 = Arquivado
async function waitDocumentReady(apiKey, cryptKey, docUuid, { pollIntervalMs = 5000, timeoutMs = 90000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    // Primeiro tentativa: aguarda um delay inicial mínimo de 5s
    await new Promise(r => setTimeout(r, pollIntervalMs));

    let statusId, rawBody;
    try {
      const r = await _req(apiKey, cryptKey, 'GET', `/documents/${docUuid}`, null);
      const doc = Array.isArray(r) ? r[0] : r;
      statusId = doc?.statusId ?? doc?.status_id ?? doc?.['statusId'] ?? doc?.status ?? doc?.statusName;
      rawBody  = JSON.stringify(r).slice(0, 300);
    } catch (e) {
      console.warn(`[D4Sign] Polling tentativa ${attempt}: erro ao checar status — ${e.message}. Tentando novamente...`);
      continue;
    }

    console.log(`[D4Sign] Polling tentativa ${attempt}: doc=${docUuid} statusId=${statusId} | body=${rawBody}`);

    // statusId=2 ("Aguardando Signatários") ou string equivalente
    const prontoNum  = [2, '2'].includes(statusId);
    const prontoStr  = typeof statusId === 'string' &&
                       /aguardando.signat|waiting.sign|processed/i.test(statusId);

    if (prontoNum || prontoStr) {
      console.log(`[D4Sign] Documento ${docUuid} está pronto para receber signatários (tentativa ${attempt}).`);
      return;
    }

    // statusId=1 ("Processando") = continua aguardando
    const processando = [1, '1'].includes(statusId) ||
      (typeof statusId === 'string' && /process|aguardando.process/i.test(statusId));
    if (!processando && statusId !== undefined && statusId !== null) {
      // Status inesperado — mas tentamos continuar mesmo assim
      console.warn(`[D4Sign] Status inesperado "${statusId}" — tentando adicionar signatários mesmo assim.`);
      return;
    }
  }

  // Timeout esgotado — tenta continuar mesmo assim (melhor do que travar o fluxo)
  console.warn(`[D4Sign] Timeout de ${timeoutMs}ms aguardando processamento do doc ${docUuid}. Continuando...`);
}

// ── 2. Verificar signatários já adicionados ao documento ────────────────────
// Endpoint correto conforme SDK oficial: GET /documents/{uuid}/list
async function getSignatories(apiKey, cryptKey, docUuid) {
  try {
    const r = await _req(apiKey, cryptKey, 'GET', `/documents/${docUuid}/list`, null);
    const list = Array.isArray(r) ? r : (r?.signers || r?.data || []);
    console.log(`[D4Sign] getSignatories doc=${docUuid}: ${list.length} signatário(s).`);
    return list;
  } catch (e) {
    console.warn(`[D4Sign] getSignatories falhou: ${e.message}`);
    return [];
  }
}

// ── 3. Adicionar signatários ──────────────────────────────────────────────────
// Endpoint correto: POST /documents/{uuid}/createlist
// Body: signers=<JSON-array> (form-urlencoded, todos de uma vez)
// Ref: https://github.com/d4sign/d4sign-php (SDK oficial)
//
// act: "1"=Assinar, "2"=Aprovar, "3"=Reconhecer firma, "4"=Assinar como parte
// signatories = [{ email, act?, name?, cpf?, birthday?, whatsappNumber? }]
async function addSignatories(apiKey, cryptKey, docUuid, signatories) {
  // Monta o array de signers no formato D4Sign
  const signers = signatories.map(s => {
    const wppRaw    = s.whatsappNumber || '';
    const wppDigits = wppRaw.replace(/\D/g, '');
    const wppFinal  = wppDigits
      ? (wppDigits.startsWith('55') ? wppDigits : `55${wppDigits}`)
      : '';

    const signer = {
      email:                 s.email,
      act:                   String(s.act || '1'),
      foreign:               '0',
      certificadoicpbr:      '0',
      assinatura_presencial: '0',
      embed_methodauth:      'email',  // método de autenticação padrão
    };
    if (s.name)    signer.display_name    = s.name;
    if (wppFinal)  signer.embed_smsnumber = wppFinal;

    return signer;
  });

  console.log(`[D4Sign] createlist doc=${docUuid} signers=`, JSON.stringify(signers));

  // Envia todos os signatários de uma vez via POST /createlist
  const r = await _reqForm(apiKey, cryptKey, 'POST', `/documents/${docUuid}/createlist`, {
    signers: JSON.stringify(signers),
  });

  const rawBody = JSON.stringify(r);
  console.log(`[D4Sign] createlist resposta: ${rawBody.slice(0, 500)}`);

  // Verifica se houve erro explícito na resposta
  const respMsg = r?.message || r?.msg || '';
  const isError = typeof respMsg === 'string' && respMsg.length > 0 &&
    /erro|error|inválid|invalid|falha|failed|not found/i.test(respMsg);
  if (isError) {
    throw new Error(`D4Sign createlist: ${respMsg.slice(0, 200)}`);
  }

  // Registra informações adicionais (nome, CPF) para cada signatário que retornou uuid
  // A resposta pode ser um array ou objeto com array
  const responseList = Array.isArray(r) ? r : (r?.signers || r?.data || []);
  for (const s of signatories) {
    if (!s.name && !s.cpf && !s.birthday) continue;
    // Tenta encontrar o uuid-signatory correspondente na resposta
    const sigEntry = responseList.find(x =>
      x?.email === s.email || x?.['uuid-signatory'] || x?.key
    );
    const sigUuid = sigEntry?.['uuid-signatory'] || sigEntry?.['key-signatory'] || sigEntry?.key;
    if (sigUuid) {
      try {
        const infoPayload = { key_signer: sigUuid, email: s.email };
        if (s.name)     infoPayload.display_name  = s.name;
        if (s.cpf)      infoPayload.documentation = s.cpf.replace(/\D/g, '');
        if (s.birthday) infoPayload.birthday       = _fmtBirthday(s.birthday);
        console.log(`[D4Sign] addinfo signatário ${s.email}:`, JSON.stringify(infoPayload));
        const infoRes = await _reqForm(apiKey, cryptKey, 'POST',
          `/documents/${docUuid}/addinfo`, infoPayload);
        console.log(`[D4Sign] addinfo resposta:`, JSON.stringify(infoRes).slice(0, 300));
      } catch (infoErr) {
        console.warn(`[D4Sign] Aviso addinfo ${s.email}: ${infoErr.message}`);
      }
    }
  }

  return r;
}

// Formata data para DD/MM/YYYY (aceita YYYY-MM-DD ou Date)
function _fmtBirthday(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d; // já formatado
  const dt = typeof d === 'string' ? new Date(d + 'T12:00:00') : new Date(d);
  if (isNaN(dt)) return String(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

// ── 3b. Registrar webhook no documento D4Sign ────────────────────────────────
// D4Sign chama esta URL quando todos assinam (evento "finished")
async function registerWebhook(apiKey, cryptKey, docUuid, webhookUrl) {
  if (!webhookUrl) return;
  try {
    const r = await _reqForm(apiKey, cryptKey, 'POST', `/documents/${docUuid}/webhooks`, {
      url: webhookUrl,
    });
    console.log(`[D4Sign] Webhook registrado: ${webhookUrl} → ${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    console.warn(`[D4Sign] Aviso ao registrar webhook: ${e.message}`);
  }
}

// ── 4. Enviar para assinatura ─────────────────────────────────────────────────
async function sendToSign(apiKey, cryptKey, docUuid, message) {
  // Endpoint conforme SDK oficial: /sendtosigner (com 'r')
  const payload = {
    message:    message || 'Por favor, assine o documento de Autorização de Emissão de Nota Fiscal.',
    workflow:   '0',  // 0 = todos assinam em paralelo
    skip_email: '0',
  };
  console.log(`[D4Sign] Enviando doc ${docUuid} para assinatura...`);
  const r = await _reqForm(apiKey, cryptKey, 'POST', `/documents/${docUuid}/sendtosigner`, payload);
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
  webhookUrl,   // URL que o D4Sign chamará ao concluir todas as assinaturas
}) {
  const { d4ApiKey, d4Token: safeUuid, d4CryptKey } = cfg;
  // Usa webhookUrl da cfg se não passado explicitamente
  const wUrl = webhookUrl || cfg.webhookUrl || null;
  if (!d4ApiKey)    throw new Error('API Key do D4Sign não configurada (d4ApiKey)');
  if (!safeUuid)    throw new Error('UUID do cofre D4Sign não configurado (d4Token)');
  if (!signerEmail) throw new Error('E-mail do signatário é obrigatório');

  // 1. Upload
  const docUuid = await uploadDocument(d4ApiKey, d4CryptKey, safeUuid, pdfBuffer, filename);

  // 1b. Polling: aguarda o documento ficar pronto para receber signatários
  // (D4Sign processa o PDF assincronamente — pode levar de 5s a 60s dependendo do tamanho)
  await waitDocumentReady(d4ApiKey, d4CryptKey, docUuid, { pollIntervalMs: 5000, timeoutMs: 90000 });

  // 2. Signatários
  const sigs = [{
    email:          signerEmail,
    act:            '1',
    name:           signerName     || undefined,
    whatsappNumber: signerWhatsapp || undefined,
  }];
  if (signerEmail2 && signerEmail2 !== signerEmail) {
    sigs.push({ email: signerEmail2, act: '1', name: signerName2 || undefined }); // act 1 = Assinar (mais compatível)
  }
  await addSignatories(d4ApiKey, d4CryptKey, docUuid, sigs);

  // 2b. Verificação informativa — não fatal.
  // O endpoint GET /signataries retorna text/html vazio em alguns planos D4Sign.
  // A validação definitiva é feita pelo sendToSign: se não houver signatários,
  // D4Sign rejeita com "Nenhum signatário cadastrado".
  await new Promise(r => setTimeout(r, 3000));
  const sigList = await getSignatories(d4ApiKey, d4CryptKey, docUuid);
  if (sigList.length === 0) {
    console.warn(`[D4Sign] Verificação via GET /signataries retornou 0 signatários — pode ser limitação da API. Prosseguindo para sendToSign...`);
  } else {
    console.log(`[D4Sign] ✅ ${sigList.length} signatário(s) confirmado(s) via GET /signataries.`);
  }

  // 2c. Registra webhook no documento para receber evento de conclusão
  if (wUrl) {
    await registerWebhook(d4ApiKey, d4CryptKey, docUuid, wUrl);
  }

  // 3. Enviar — D4Sign valida internamente se há signatários cadastrados
  await sendToSign(d4ApiKey, d4CryptKey, docUuid, message);

  const linkVisualizacao = `https://secure.d4sign.com.br/desk/viewblob/${docUuid}`;
  console.log(`[D4Sign] ✅ Fluxo concluído. docUuid=${docUuid} | link=${linkVisualizacao}`);
  return { docUuid, linkVisualizacao };
}

module.exports = { uploadDocument, addSignatories, sendToSign, registerWebhook, testConnection, enviarParaAssinatura };
