/**
 * CONSTRUTIVO OBRAS — Portal do Fornecedor
 *
 * Acesso externo por token mágico enviado por e-mail (sem senha).
 * O fornecedor consegue:
 *   - Ver suas medições e histórico de aprovação
 *   - Fazer upload de Nota Fiscal após aprovação
 *   - Assinar documentos via D4Sign (link de assinatura)
 *
 * Rotas públicas (sem auth JWT interno):
 *   POST /api/portal/solicitar-acesso   — envia e-mail com link de acesso
 *   GET  /api/portal/verificar?token=   — valida token e retorna session JWT do portal
 *
 * Rotas autenticadas pelo portal (JWT próprio com role='fornecedor'):
 *   GET  /api/portal/me                 — dados do fornecedor logado
 *   GET  /api/portal/medicoes           — medições do fornecedor
 *   GET  /api/portal/medicoes/:id       — detalhe da medição
 *   POST /api/portal/medicoes/:id/nf    — upload de nota fiscal
 *   GET  /api/portal/medicoes/:id/nfs   — notas fiscais enviadas
 */
'use strict';

const router  = require('express').Router();
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db');
const storageHelper = require('../helpers/storage');
const authInterno   = require('../middleware/auth'); // auth JWT interno (backoffice)

const TOKEN_EXPIRY_HOURS = 24;

// ── Helper: envio de e-mail via SMTP ──────────────────────────────
// Lê configurações do banco (painel Admin → Notificações) com fallback para env.
// Retorna true se enviou, false se SMTP não está configurado.
async function _sendMail(to, subject, html) {
  // 1. Tenta carregar config do banco (painel de configurações)
  let smtpHost = process.env.SMTP_HOST || '';
  let smtpPort = parseInt(process.env.SMTP_PORT || '587');
  let smtpUser = process.env.SMTP_USER || '';
  let smtpPass = process.env.SMTP_PASS || '';
  let smtpFrom = process.env.SMTP_FROM || 'CONSTRUTIVO OBRAS <noreply@construtivo.com.br>';

  try {
    const cfgR = await db.query("SELECT valor FROM configuracoes WHERE chave='notificacoes'");
    const cfg  = cfgR.rows[0]?.valor || {};
    if (cfg.smtpHost) smtpHost = cfg.smtpHost;
    if (cfg.smtpPorta) smtpPort = parseInt(cfg.smtpPorta);
    if (cfg.smtpUser) smtpUser = cfg.smtpUser;
    if (cfg.smtpPass) smtpPass = cfg.smtpPass;
    if (cfg.remetente) smtpFrom = cfg.remetente;
  } catch (e) {
    console.warn('[Portal] Aviso ao carregar config SMTP do banco:', e.message);
  }

  if (!smtpHost) {
    console.warn(`[Portal] SMTP não configurado — e-mail NÃO enviado para ${to}.`);
    return false;
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host:   smtpHost,
    port:   smtpPort,
    secure: smtpPort === 465,
    auth:   { user: smtpUser, pass: smtpPass },
    tls:    { rejectUnauthorized: false },
  });
  await transporter.sendMail({ from: smtpFrom, to, subject, html });
  return true;
}

// ── Helper: URL base do sistema ────────────────────────────────────
function _baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host  = req.headers['x-forwarded-host']  || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

// ── Middleware de autenticação do portal ───────────────────────────
function portalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token de acesso ao portal não fornecido.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    if (payload.role !== 'fornecedor') return res.status(403).json({ error: 'Acesso restrito ao portal do fornecedor.' });
    req.fornecedor = payload; // { fornecedor_id, nome, email, role }
    next();
  } catch {
    res.status(401).json({ error: 'Token expirado ou inválido. Solicite um novo acesso.' });
  }
}

// Upload de NF — multer em /app/uploads
const uploadNF = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/app/uploads'),
    filename:    (req, file, cb) => cb(null, `nf-${uuidv4()}${path.extname(file.originalname)}`),
  }),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.xml', '.png', '.jpg', '.jpeg'].includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(null, ok);
  },
});

// ═══════════════════════════════════════════════════════════════════
// ROTAS PÚBLICAS
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/portal/solicitar-acesso
 * Body: { email }
 * Busca o fornecedor pelo e-mail (email, email_nf ou email_assin),
 * gera um token e envia link por e-mail.
 */
router.post('/solicitar-acesso', async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'E-mail é obrigatório.' });

  try {
    // Busca fornecedor pelo e-mail (qualquer campo de e-mail)
    const fR = await db.query(
      `SELECT id, razao_social, nome_fantasia, email, email_nf, email_assin
         FROM fornecedores
        WHERE ativo = true
          AND (LOWER(email) = LOWER($1)
            OR LOWER(email_nf) = LOWER($1)
            OR LOWER(email_assin) = LOWER($1))
        LIMIT 1`,
      [email.trim()]
    );

    // Responde sempre com sucesso (não revela se o e-mail existe — anti-enumeração)
    if (!fR.rows[0]) {
      console.warn(`[Portal] Solicitação de acesso para e-mail não cadastrado: ${email}`);
      return res.json({ ok: true, msg: 'Se o e-mail estiver cadastrado, você receberá o link em instantes.' });
    }

    const forn = fR.rows[0];

    // Invalida tokens anteriores não usados deste fornecedor
    await db.query(
      `DELETE FROM portal_tokens WHERE fornecedor_id = $1 AND usado_em IS NULL`,
      [forn.id]
    );

    // Gera token criptograficamente seguro
    const token   = crypto.randomBytes(48).toString('hex');
    const expira  = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO portal_tokens (token, fornecedor_id, email, expira_em)
       VALUES ($1, $2, $3, $4)`,
      [token, forn.id, email.trim(), expira]
    );

    const baseUrl = _baseUrl(req);
    const link    = `${baseUrl}/portal.html?token=${token}`;
    const nomeExib = forn.nome_fantasia || forn.razao_social;

    const emailEnviado = await _sendMail(email.trim(),
      '🔑 Seu link de acesso — Portal CONSTRUTIVO OBRAS',
      `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:40px auto;color:#1e293b">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">CONSTRUTIVO OBRAS</h2>
    <p style="color:#93c5fd;margin:4px 0 0;font-size:13px">Portal do Fornecedor</p>
  </div>
  <div style="background:#f8fafc;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
    <p>Olá, <strong>${nomeExib}</strong>!</p>
    <p>Clique no botão abaixo para acessar o portal e acompanhar suas medições:</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${link}"
         style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:6px;
                text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">
        🔑 Acessar Portal
      </a>
    </div>
    <p style="font-size:12px;color:#64748b">
      Este link é válido por <strong>${TOKEN_EXPIRY_HOURS} horas</strong> e só pode ser usado uma vez.<br>
      Se você não solicitou este acesso, ignore este e-mail.
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-size:11px;color:#94a3b8;margin:0">CONSTRUTIVO OBRAS — Sistema de Gestão de Obras</p>
  </div>
</body>
</html>`
    );

    if (emailEnviado) {
      console.log(`[Portal] Token enviado por e-mail para ${email} — fornecedor_id=${forn.id}`);
      res.json({ ok: true, msg: 'Se o e-mail estiver cadastrado, você receberá o link em instantes.' });
    } else {
      // Modo sem SMTP: retorna o link diretamente (uso interno / rede sem acesso a e-mail)
      console.log(`[Portal] Token gerado (sem SMTP) para ${email} | link=${link}`);
      res.json({
        ok:        true,
        semSmtp:   true,
        msg:       'SMTP não configurado. Use o link abaixo para acessar o portal.',
        link,
        expira_em: expira,
      });
    }
  } catch (e) {
    console.error('[Portal] solicitar-acesso:', e.message);
    res.status(500).json({ error: 'Erro ao processar solicitação. Tente novamente.' });
  }
});

/**
 * GET /api/portal/verificar?token=xxx
 * Valida o token mágico e retorna um JWT de sessão do portal.
 */
router.get('/verificar', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token não informado.' });

  try {
    const tR = await db.query(
      `SELECT pt.*, f.razao_social, f.nome_fantasia
         FROM portal_tokens pt
         JOIN fornecedores f ON f.id = pt.fornecedor_id
        WHERE pt.token = $1`,
      [token]
    );
    if (!tR.rows[0])       return res.status(401).json({ error: 'Link inválido ou já utilizado.' });
    if (tR.rows[0].usado_em) return res.status(401).json({ error: 'Este link já foi utilizado. Solicite um novo acesso.' });
    if (new Date(tR.rows[0].expira_em) < new Date())
      return res.status(401).json({ error: 'Link expirado. Solicite um novo acesso.' });

    const t    = tR.rows[0];
    const ip   = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const nome = t.nome_fantasia || t.razao_social;

    // Marca token como usado (single-use)
    await db.query(
      `UPDATE portal_tokens SET usado_em = NOW(), ip_usado = $1 WHERE id = $2`,
      [ip.slice(0, 50), t.id]
    );

    // Emite JWT de sessão do portal (validade: 8h)
    const sessionToken = jwt.sign(
      { fornecedor_id: t.fornecedor_id, nome, email: t.email, role: 'fornecedor' },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '8h' }
    );

    console.log(`[Portal] Acesso autenticado — fornecedor_id=${t.fornecedor_id} IP=${ip}`);
    res.json({ ok: true, token: sessionToken, fornecedor: { id: t.fornecedor_id, nome, email: t.email } });
  } catch (e) {
    console.error('[Portal] verificar:', e.message);
    res.status(500).json({ error: 'Erro ao validar link.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ROTAS AUTENTICADAS DO PORTAL
// ═══════════════════════════════════════════════════════════════════

/** GET /api/portal/me — dados do fornecedor logado */
router.get('/me', portalAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, razao_social, nome_fantasia, cnpj, tel, email, email_nf, email_assin,
              representante, cargo_representante, endereco
         FROM fornecedores WHERE id = $1`,
      [req.fornecedor.fornecedor_id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/portal/medicoes — medições do fornecedor (todas as empresas) */
router.get('/medicoes', portalAuth, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT m.id, m.codigo, m.periodo, m.status, m.tipo,
             m.valor_medicao, m.valor_acumulado, m.pct_total,
             m.descricao, m.criado_em, m.integrada_erp,
             o.nome  AS obra_nome,
             o.codigo AS obra_codigo,
             e.razao_social AS empresa_nome,
             e.nome_fantasia AS empresa_fantasia,
             c.numero AS contrato_numero,
             c.valor_total AS contrato_valor_total,
             -- NFs enviadas
             (SELECT COUNT(*) FROM portal_nfs pn WHERE pn.medicao_id = m.id) AS total_nfs,
             -- Aprovações resumidas
             COALESCE((
               SELECT json_agg(json_build_object(
                 'nivel', apv.nivel, 'acao', apv.acao,
                 'usuario', apv.usuario, 'data_hora', apv.data_hora,
                 'comentario', apv.comentario
               ) ORDER BY apv.data_hora)
               FROM aprovacoes apv WHERE apv.medicao_id = m.id
             ), '[]'::json) AS historico
        FROM medicoes m
        JOIN contratos c    ON c.id = m.contrato_id
        JOIN obras o        ON o.id = c.obra_id
        JOIN empresas e     ON e.id = c.empresa_id
       WHERE m.fornecedor_id = $1
       ORDER BY m.criado_em DESC
    `, [req.fornecedor.fornecedor_id]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/portal/medicoes/:id — detalhe + itens + evidências */
router.get('/medicoes/:id', portalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const r  = await db.query(`
      SELECT m.*,
             o.nome AS obra_nome, o.codigo AS obra_codigo,
             e.razao_social AS empresa_nome,
             c.numero AS contrato_numero, c.valor_total AS contrato_valor_total
        FROM medicoes m
        JOIN contratos c ON c.id = m.contrato_id
        JOIN obras o     ON o.id = c.obra_id
        JOIN empresas e  ON e.id = c.empresa_id
       WHERE m.id = $1 AND m.fornecedor_id = $2
    `, [id, req.fornecedor.fornecedor_id]);

    if (!r.rows[0]) return res.status(404).json({ error: 'Medição não encontrada.' });
    const med = r.rows[0];

    const [aprs, itens, evs, nfs] = await Promise.all([
      db.query('SELECT * FROM aprovacoes WHERE medicao_id=$1 ORDER BY data_hora', [id]),
      db.query('SELECT * FROM medicao_itens WHERE medicao_id=$1 ORDER BY ordem,id', [id]),
      db.query('SELECT id, nome, tipo, tamanho, criado_em FROM evidencias WHERE medicao_id=$1 ORDER BY criado_em', [id]),
      db.query('SELECT * FROM portal_nfs WHERE medicao_id=$1 ORDER BY enviado_em', [id]),
    ]);

    res.json({ ...med, historico: aprs.rows, itens: itens.rows, evidencias: evs.rows, nfs: nfs.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/portal/medicoes/:id/nf
 * Upload de Nota Fiscal pelo fornecedor.
 * Só aceita se a medição estiver nos status: Aprovado, Em Assinatura, Assinado.
 */
router.post('/medicoes/:id/nf', portalAuth, uploadNF.single('arquivo'), async (req, res) => {
  try {
    const id     = parseInt(req.params.id);
    const { numero_nf, valor_nf, chave_nfe, obs, dados_nfse: dadosNfseRaw, validacoes: validacoesRaw } = req.body;
    let dadosNfse = null;
    if (dadosNfseRaw) {
      try { dadosNfse = typeof dadosNfseRaw === 'string' ? JSON.parse(dadosNfseRaw) : dadosNfseRaw; } catch {}
    }
    let validacoes = null;
    if (validacoesRaw) {
      try { validacoes = typeof validacoesRaw === 'string' ? JSON.parse(validacoesRaw) : validacoesRaw; } catch {}
    }

    // Verifica que a medição pertence a este fornecedor
    const mR = await db.query(
      `SELECT id, status, codigo FROM medicoes WHERE id = $1 AND fornecedor_id = $2`,
      [id, req.fornecedor.fornecedor_id]
    );
    if (!mR.rows[0]) return res.status(404).json({ error: 'Medição não encontrada.' });

    const STATUS_ACEITOS = ['Aprovado', 'Em Assinatura', 'Assinado'];
    if (!STATUS_ACEITOS.includes(mR.rows[0].status)) {
      return res.status(422).json({
        error: `Não é possível anexar NF a uma medição com status "${mR.rows[0].status}". A medição precisa estar aprovada.`
      });
    }

    if (!req.file) return res.status(400).json({ error: 'Arquivo da NF é obrigatório.' });

    // ── Verifica se já existe uma NF para esta medição ────────────────────────
    const nfExistente = await db.query(
      `SELECT id, status_fin, provider, caminho FROM portal_nfs
        WHERE medicao_id = $1 AND fornecedor_id = $2
        ORDER BY enviado_em DESC LIMIT 1`,
      [id, req.fornecedor.fornecedor_id]
    );

    if (nfExistente.rows[0]) {
      const nfAnterior = nfExistente.rows[0];
      if (nfAnterior.status_fin !== 'Pendente') {
        // NF já está em processamento — não pode substituir
        return res.status(422).json({
          error: `Não é possível substituir a NF pois ela já está com status "${nfAnterior.status_fin}". `
               + `Entre em contato com o financeiro para cancelar antes de enviar uma nova nota.`,
        });
      }
      // Status Pendente — apaga arquivo antigo do storage e remove o registro
      try { await storageHelper.deleteFile(nfAnterior); } catch (e) {
        console.warn('[Portal NF] Aviso ao apagar arquivo anterior:', e.message);
      }
      await db.query(`DELETE FROM portal_nfs WHERE id = $1`, [nfAnterior.id]);
      console.log(`[Portal] NF anterior removida (substituição) — id=${nfAnterior.id} medicao=${id}`);
    }

    // Faz upload para o storage configurado (S3 / GDrive / local)
    let result = { provider: 'local', caminho: req.file.filename, url_storage: null };
    try {
      result = await storageHelper.uploadFile(req.file.path, req.file.originalname, req.file.mimetype);
    } catch (e) {
      console.error('[Portal NF] storage error:', e.message);
    }
    if (result.provider !== 'local') {
      try { require('fs').unlinkSync(req.file.path); } catch {}
    }

    const row = await db.query(
      `INSERT INTO portal_nfs
         (medicao_id, fornecedor_id, nome_arquivo, caminho, provider, url_storage,
          numero_nf, valor_nf, chave_nfe, obs, dados_nfse, validacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, req.fornecedor.fornecedor_id, req.file.originalname,
       result.caminho, result.provider, result.url_storage,
       numero_nf || null,
       valor_nf  ? parseFloat(valor_nf) : null,
       chave_nfe || null,
       obs       || null,
       dadosNfse   ? JSON.stringify(dadosNfse)   : null,
       validacoes  ? JSON.stringify(validacoes)   : null]
    );

    const acao = nfExistente.rows[0] ? 'substituída' : 'enviada';
    console.log(`[Portal] NF ${acao} — medicao=${id} fornecedor=${req.fornecedor.fornecedor_id} arquivo=${req.file.originalname}`);
    res.status(201).json(row.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Multer em memória para extração IA (não grava em disco) ──────────────────
const uploadNFMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.xml', '.png', '.jpg', '.jpeg'].includes(
      path.extname(file.originalname).toLowerCase()
    );
    cb(null, ok);
  },
});

/**
 * POST /api/portal/medicoes/:id/nf/extrair
 * Analisa o arquivo da NF com Gemini e retorna os dados estruturados.
 */
router.post('/medicoes/:id/nf/extrair', portalAuth, uploadNFMem.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo é obrigatório.' });

    // Carrega API key do Gemini
    let geminiKey = process.env.GEMINI_API_KEY || '';
    if (!geminiKey) {
      const cfgR = await db.query("SELECT valor FROM configuracoes WHERE chave='ia'");
      geminiKey = cfgR.rows[0]?.valor?.gemini_api_key || '';
    }
    if (!geminiKey) return res.status(422).json({ error: 'Chave Gemini não configurada. Configure em Configurações → IA.' });

    // Converte arquivo para parts do Gemini
    const ext  = path.extname(req.file.originalname).toLowerCase();
    const mime = req.file.mimetype;
    let parts  = [];

    if (ext === '.xml') {
      // XML da NFS-e — lê como texto
      const xmlText = req.file.buffer.toString('utf8');
      parts = [{ text: `ARQUIVO XML DA NFS-e:\n\n${xmlText}` }];
    } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
      // Imagem — inline_data
      const imgMime = mime.startsWith('image/') ? mime : `image/${ext.replace('.','') }`;
      parts = [{ inline_data: { mime_type: imgMime, data: req.file.buffer.toString('base64') } }];
    } else {
      // PDF — inline_data
      parts = [{ inline_data: { mime_type: 'application/pdf', data: req.file.buffer.toString('base64') } }];
    }

    const prompt = `Você é um especialista em Notas Fiscais de Serviço Eletrônicas (NFS-e) brasileiras.
Analise o documento e extraia TODOS os dados disponíveis da nota fiscal.
Retorne SOMENTE um objeto JSON válido, sem texto adicional, markdown ou explicações.

Campos a extrair (use null se não encontrar):
{
  "numero":                   "número da NF (somente dígitos)",
  "serie":                    "série da NF (ex: A1, 1)",
  "dataEmissao":              "data de emissão no formato YYYY-MM-DD",
  "competencia":              "competência/período no formato YYYY-MM (mês de referência)",
  "chaveAcesso":              "chave de acesso com 44 dígitos (somente números)",
  "codigoVerificacao":        "código de verificação da NF",
  "optanteSimplesNacional":   "1 se Simples Nacional, 2 se não",
  "naturezaOperacao":         "código da natureza (1=tributação no município, padrão=1)",
  "prestador": {
    "cnpj":                   "CNPJ somente dígitos (14 dígitos)",
    "inscricaoMunicipal":     "inscrição municipal somente dígitos",
    "razaoSocial":            "razão social completa",
    "municipio":              "nome do município",
    "codigoMunicipio":        "código IBGE do município (7 dígitos)",
    "uf":                     "UF de 2 letras"
  },
  "tomador": {
    "cnpj":                   "CNPJ somente dígitos (se pessoa jurídica)",
    "cpf":                    "CPF somente dígitos (se pessoa física)",
    "inscricaoMunicipal":     "inscrição municipal do tomador",
    "razaoSocial":            "razão social ou nome completo",
    "endereco":               "logradouro",
    "numero":                 "número do endereço",
    "complemento":            "complemento",
    "bairro":                 "bairro",
    "municipio":              "município",
    "codigoMunicipio":        "código IBGE (7 dígitos)",
    "uf":                     "UF de 2 letras",
    "cep":                    "CEP somente dígitos (8 dígitos)",
    "email":                  "e-mail do tomador",
    "telefone":               "telefone somente dígitos"
  },
  "servico": {
    "discriminacao":          "descrição completa dos serviços prestados",
    "itemListaServico":       "código LC 116/2003 (ex: 7.02, 7.04)",
    "codigoTributacao":       "código de tributação municipal",
    "codigoMunicipio":        "código IBGE do município de prestação (7 dígitos)"
  },
  "valores": {
    "valorServicos":          número (decimal, ponto como separador),
    "valorDeducoes":          número ou 0,
    "valorPis":               número ou 0,
    "valorCofins":            número ou 0,
    "valorInss":              número ou 0,
    "valorIr":                número ou 0,
    "valorCsll":              número ou 0,
    "issRetido":              "1 se ISS foi retido pelo tomador, 2 se não",
    "valorIss":               número,
    "aliquota":               número (percentual, ex: 5.00 para 5%),
    "valorLiquido":           número (valor líquido da NFS-e),
    "baseCalculo":            número (base de cálculo do ISS)
  },
  "rps": {
    "numero":                 "número do RPS",
    "serie":                  "série do RPS",
    "tipo":                   "1=RPS, 2=RPS-M, 3=Nota Fiscal Conjugada"
  }
}`;

    // Chama Gemini
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [...parts, { text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gemini: ${err?.error?.message || `HTTP ${response.status}`}`);
    }
    const data   = await response.json();
    const allPts = data?.candidates?.[0]?.content?.parts || [];
    let raw = allPts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim();

    // Limpa markdown
    raw = raw.replace(/^```[\w]*\r?\n?/i, '').replace(/\r?\n?```[\w]*\s*$/i, '').trim();
    if (!raw.startsWith('{')) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) raw = m[0];
    }

    const dados = JSON.parse(raw);
    console.log(`[Portal] NF extraída por IA — medicao=${req.params.id} numero=${dados.numero}`);

    // ── Validações cruzadas com dados do banco ───────────────────────────────
    const validacoes = [];
    const soDigitos = v => String(v || '').replace(/\D/g, '');
    const fmt2 = v => parseFloat(v || 0).toFixed(2);

    try {
      // Busca medição + CNPJ do fornecedor
      const medV = await db.query(`
        SELECT m.codigo, m.valor_medicao, f.cnpj,
               f.razao_social AS forn_razao
          FROM medicoes m
          JOIN fornecedores f ON f.id = m.fornecedor_id
         WHERE m.id = $1 AND m.fornecedor_id = $2
      `, [req.params.id, req.fornecedor.fornecedor_id]);
      const med = medV.rows[0];

      if (med) {
        // ── 1. CNPJ do Prestador ────────────────────────────────────────────
        const cnpjNF   = soDigitos(dados.prestador?.cnpj);
        const cnpjForn = soDigitos(med.cnpj);
        if (cnpjNF && cnpjForn && cnpjNF !== cnpjForn) {
          validacoes.push({
            campo: 'prestador.cnpj',
            nivel: 'erro',
            msg: `CNPJ na NF (${cnpjNF}) é diferente do CNPJ cadastrado para este fornecedor (${cnpjForn}). `
               + `Verifique se está enviando a nota do prestador correto.`,
          });
        }

        // ── 2. Valor da NF × Valor da Medição ──────────────────────────────
        const valorNF  = parseFloat(dados.valores?.valorServicos || 0);
        const valorMed = parseFloat(med.valor_medicao || 0);
        if (valorNF > 0 && valorMed > 0) {
          const diff    = Math.abs(valorNF - valorMed);
          const pctDiff = diff / valorMed;
          if (diff > 0.01) {
            validacoes.push({
              campo: 'valores.valorServicos',
              nivel: pctDiff > 0.005 ? 'erro' : 'aviso',
              msg: `Valor bruto da NF (R$ ${fmt2(valorNF)}) diverge do valor desta medição `
                 + `(R$ ${fmt2(valorMed)}). Diferença: R$ ${fmt2(diff)}.`,
            });
          }
        }

        // ── 3. Código da medição na discriminação ou observação ─────────────
        const disc   = (dados.servico?.discriminacao || '').toUpperCase();
        const codigoUp = med.codigo.trim().toUpperCase();
        if (codigoUp && !disc.includes(codigoUp)) {
          validacoes.push({
            campo: 'servico.discriminacao',
            nivel: 'aviso',
            msg: `O código da medição "${med.codigo}" não foi encontrado na discriminação da NF. `
               + `Recomendado: inclua o código da medição no campo de discriminação para rastreabilidade.`,
          });
        }

        // Expõe dados da medição para o frontend
        dados._medicao = { codigo: med.codigo, valor_medicao: med.valor_medicao };
      }
    } catch (eVal) {
      console.warn('[Portal] Aviso nas validações:', eVal.message);
    }

    // ── Verificações matemáticas dos tributos ────────────────────────────────
    const vv         = dados.valores || {};
    const valorServ  = parseFloat(vv.valorServicos || 0);

    if (valorServ > 0) {
      // ISS: valorIss ≈ valorServicos × aliquota / 100
      const aliq       = parseFloat(vv.aliquota || 0);
      const valorIssNF = parseFloat(vv.valorIss || 0);
      if (aliq > 0 && valorIssNF > 0) {
        const issEsp = valorServ * aliq / 100;
        if (Math.abs(issEsp - valorIssNF) > 0.05) {
          validacoes.push({
            campo: 'valores.valorIss',
            nivel: 'aviso',
            msg: `ISS calculado: ${aliq}% × R$ ${fmt2(valorServ)} = R$ ${fmt2(issEsp)}. `
               + `Valor na NF: R$ ${fmt2(valorIssNF)}. Verifique a alíquota ou base de cálculo.`,
          });
        }
      }

      // PIS — alíquota padrão 0,65% (regime não cumulativo: 1,65%)
      const pisTax = parseFloat(vv.valorPis || 0);
      if (pisTax > 0) {
        const pisMin = valorServ * 0.0065;
        const pisMax = valorServ * 0.0165;
        if (pisTax < pisMin * 0.9 || pisTax > pisMax * 1.1) {
          validacoes.push({
            campo: 'valores.valorPis',
            nivel: 'aviso',
            msg: `PIS declarado R$ ${fmt2(pisTax)}. Faixa esperada: `
               + `R$ ${fmt2(pisMin)} (0,65%) a R$ ${fmt2(pisMax)} (1,65%). Confira o regime tributário.`,
          });
        }
      }

      // COFINS — alíquota padrão 3% (regime não cumulativo: 7,6%)
      const cofTax = parseFloat(vv.valorCofins || 0);
      if (cofTax > 0) {
        const cofMin = valorServ * 0.03;
        const cofMax = valorServ * 0.076;
        if (cofTax < cofMin * 0.9 || cofTax > cofMax * 1.1) {
          validacoes.push({
            campo: 'valores.valorCofins',
            nivel: 'aviso',
            msg: `COFINS declarado R$ ${fmt2(cofTax)}. Faixa esperada: `
               + `R$ ${fmt2(cofMin)} (3%) a R$ ${fmt2(cofMax)} (7,6%). Confira o regime tributário.`,
          });
        }
      }

      // CSLL — 1% sobre serviços de limpeza, vigilância, etc.
      const csllTax = parseFloat(vv.valorCsll || 0);
      if (csllTax > 0) {
        const csllEsp = valorServ * 0.01;
        if (Math.abs(csllTax - csllEsp) > Math.max(0.10, csllEsp * 0.15)) {
          validacoes.push({
            campo: 'valores.valorCsll',
            nivel: 'aviso',
            msg: `CSLL declarado R$ ${fmt2(csllTax)}, esperado 1% = R$ ${fmt2(csllEsp)}.`,
          });
        }
      }

      // IR — 1,5% sobre serviços acima de R$ 666,05 no mês
      const irTax = parseFloat(vv.valorIr || 0);
      if (irTax > 0) {
        const irEsp = valorServ * 0.015;
        if (Math.abs(irTax - irEsp) > Math.max(0.10, irEsp * 0.15)) {
          validacoes.push({
            campo: 'valores.valorIr',
            nivel: 'aviso',
            msg: `IR declarado R$ ${fmt2(irTax)}, esperado 1,5% = R$ ${fmt2(irEsp)}.`,
          });
        }
      }

      // INSS — 11% (construção civil, outros) ou 3,5% (cessão de mão de obra)
      const inssTax = parseFloat(vv.valorInss || 0);
      if (inssTax > 0) {
        const inssMin = valorServ * 0.035; // 3,5%
        const inssMax = valorServ * 0.11;  // 11%
        if (inssTax < inssMin * 0.85 || inssTax > inssMax * 1.15) {
          validacoes.push({
            campo: 'valores.valorInss',
            nivel: 'aviso',
            msg: `INSS declarado R$ ${fmt2(inssTax)}. Faixa esperada: `
               + `R$ ${fmt2(inssMin)} (3,5% cessão m.o.) a R$ ${fmt2(inssMax)} (11% const. civil).`,
          });
        }
      }

      // Valor Líquido: deve bater com valorServicos − retenções declaradas
      const liquNF = parseFloat(vv.valorLiquido || 0);
      if (liquNF > 0) {
        const issRet   = vv.issRetido === '1' ? parseFloat(vv.valorIss    || 0) : 0;
        const totalRet = issRet
          + parseFloat(vv.valorPis    || 0)
          + parseFloat(vv.valorCofins || 0)
          + parseFloat(vv.valorCsll   || 0)
          + parseFloat(vv.valorIr     || 0)
          + parseFloat(vv.valorInss   || 0);
        const liquEsp = valorServ - parseFloat(vv.valorDeducoes || 0) - totalRet;
        if (Math.abs(liquEsp - liquNF) > 0.10) {
          validacoes.push({
            campo: 'valores.valorLiquido',
            nivel: 'aviso',
            msg: `Valor líquido declarado R$ ${fmt2(liquNF)}, `
               + `calculado R$ ${fmt2(liquEsp)} `
               + `(R$ ${fmt2(valorServ)} − retenções R$ ${fmt2(totalRet)}). Verifique as deduções.`,
          });
        }
      }
    }

    res.json({ ok: true, dados, validacoes });

  } catch (e) {
    console.error('[Portal] Extração NF IA:', e.message);
    res.status(500).json({ error: 'Erro ao extrair dados da NF: ' + e.message });
  }
});

// ── Helper: geração de XML NFS-e ABRASF 2.01 ─────────────────────────────────
// Reutilizado tanto pela rota do portal (fornecedor) quanto pelo backoffice admin.
function _gerarXmlNFSe(d) {
  const fmt    = (v, dec = 2) => { const n = parseFloat(v || 0); return isNaN(n) ? '0.00' : n.toFixed(dec); };
  const digits = v => String(v || '').replace(/\D/g, '');
  const esc    = v => String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const cnpjPrest = digits(d.prestador?.cnpj);
  const imPrest   = digits(d.prestador?.inscricaoMunicipal);
  const dataEmis  = d.dataEmissao ? `${d.dataEmissao}T00:00:00` : new Date().toISOString().slice(0,19);
  const numRps    = digits(d.rps?.numero || d.numero || '1') || '1';
  const serieRps  = esc(d.rps?.serie || d.serie || 'A1');
  const tipoRps   = d.rps?.tipo || '1';
  const natOp     = d.naturezaOperacao || '1';
  const simpNac   = d.optanteSimplesNacional || '2';
  const issRetido = d.valores?.issRetido || '2';
  const codMun    = digits(d.servico?.codigoMunicipio || d.prestador?.codigoMunicipio) || '0000000';
  const tomCnpj   = digits(d.tomador?.cnpj);
  const tomCpf    = digits(d.tomador?.cpf);
  const tomIdXml  = tomCnpj
    ? `<CpfCnpj><Cnpj>${tomCnpj}</Cnpj></CpfCnpj>`
    : (tomCpf ? `<CpfCnpj><Cpf>${tomCpf}</Cpf></CpfCnpj>` : '');
  const tomIM = digits(d.tomador?.inscricaoMunicipal);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EnviarLoteRpsEnvio xmlns="http://www.abrasf.org.br/nfse.xsd">
  <LoteRps Id="lote${numRps}" versao="2.01">
    <NumeroLote>${numRps}</NumeroLote>
    <CpfCnpj><Cnpj>${cnpjPrest}</Cnpj></CpfCnpj>
    <InscricaoMunicipal>${imPrest}</InscricaoMunicipal>
    <QuantidadeRps>1</QuantidadeRps>
    <ListaRps>
      <Rps>
        <InfRps Id="rps${numRps}" versao="2.01">
          <IdentificacaoRps>
            <Numero>${numRps}</Numero>
            <Serie>${serieRps}</Serie>
            <Tipo>${tipoRps}</Tipo>
          </IdentificacaoRps>
          <DataEmissao>${dataEmis}</DataEmissao>
          <NaturezaOperacao>${natOp}</NaturezaOperacao>
          <OptanteSimplesNacional>${simpNac}</OptanteSimplesNacional>
          <IncentivadorCultural>2</IncentivadorCultural>
          <Status>1</Status>
          <Servico>
            <Valores>
              <ValorServicos>${fmt(d.valores?.valorServicos)}</ValorServicos>
              <ValorDeducoes>${fmt(d.valores?.valorDeducoes)}</ValorDeducoes>
              <ValorPis>${fmt(d.valores?.valorPis)}</ValorPis>
              <ValorCofins>${fmt(d.valores?.valorCofins)}</ValorCofins>
              <ValorInss>${fmt(d.valores?.valorInss)}</ValorInss>
              <ValorIr>${fmt(d.valores?.valorIr)}</ValorIr>
              <ValorCsll>${fmt(d.valores?.valorCsll)}</ValorCsll>
              <IssRetido>${issRetido}</IssRetido>
              <ValorIss>${fmt(d.valores?.valorIss)}</ValorIss>
              <Aliquota>${fmt(d.valores?.aliquota)}</Aliquota>
              <ValorLiquidoNfse>${fmt(d.valores?.valorLiquido || d.valores?.valorServicos)}</ValorLiquidoNfse>
            </Valores>
            <ItemListaServico>${esc(d.servico?.itemListaServico || '')}</ItemListaServico>
            ${d.servico?.codigoTributacao ? `<CodigoTributacaoMunicipio>${esc(d.servico.codigoTributacao)}</CodigoTributacaoMunicipio>` : ''}
            <Discriminacao>${esc(d.servico?.discriminacao || '')}</Discriminacao>
            <CodigoMunicipio>${codMun}</CodigoMunicipio>
          </Servico>
          <Prestador>
            <CpfCnpj><Cnpj>${cnpjPrest}</Cnpj></CpfCnpj>
            <InscricaoMunicipal>${imPrest}</InscricaoMunicipal>
          </Prestador>
          ${(tomIdXml || d.tomador?.razaoSocial) ? `<Tomador>
            ${tomIdXml ? `<IdentificacaoTomador>
              ${tomIdXml}
              ${tomIM ? `<InscricaoMunicipal>${tomIM}</InscricaoMunicipal>` : ''}
            </IdentificacaoTomador>` : ''}
            ${d.tomador?.razaoSocial ? `<RazaoSocial>${esc(d.tomador.razaoSocial)}</RazaoSocial>` : ''}
            ${d.tomador?.endereco ? `<Endereco>
              <Endereco>${esc(d.tomador.endereco)}</Endereco>
              ${d.tomador.numero      ? `<Numero>${esc(d.tomador.numero)}</Numero>` : ''}
              ${d.tomador.complemento ? `<Complemento>${esc(d.tomador.complemento)}</Complemento>` : ''}
              ${d.tomador.bairro      ? `<Bairro>${esc(d.tomador.bairro)}</Bairro>` : ''}
              ${d.tomador.codigoMunicipio ? `<CodigoMunicipio>${digits(d.tomador.codigoMunicipio)}</CodigoMunicipio>` : ''}
              ${d.tomador.uf          ? `<Uf>${esc(d.tomador.uf)}</Uf>` : ''}
              ${d.tomador.cep         ? `<Cep>${digits(d.tomador.cep)}</Cep>` : ''}
            </Endereco>` : ''}
            ${(d.tomador?.telefone || d.tomador?.email) ? `<Contato>
              ${d.tomador.telefone ? `<Telefone>${digits(d.tomador.telefone)}</Telefone>` : ''}
              ${d.tomador.email    ? `<Email>${esc(d.tomador.email)}</Email>` : ''}
            </Contato>` : ''}
          </Tomador>` : ''}
        </InfRps>
      </Rps>
    </ListaRps>
  </LoteRps>
</EnviarLoteRpsEnvio>`;

  const nomeArq = `nfse-${String(d.numero || 'rps').replace(/\D/g,'')}-${digits(d.prestador?.cnpj || '').slice(0,8)}.xml`;
  return { xml, nomeArq };
}

/**
 * POST /api/portal/nf/xml
 * Gera o XML NFS-e no padrão ABRASF 2.01 a partir dos dados da NF.
 * Body: { dados: { prestador, tomador, servico, valores, ... } }
 */
router.post('/nf/xml', portalAuth, async (req, res) => {
  try {
    const d = req.body?.dados;
    if (!d) return res.status(400).json({ error: 'Dados da NF são obrigatórios.' });
    const { xml, nomeArq } = _gerarXmlNFSe(d);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArq}"`);
    res.send(xml);
  } catch (e) {
    console.error('[Portal] Geração XML NFS-e:', e.message);
    res.status(500).json({ error: 'Erro ao gerar XML: ' + e.message });
  }
});

/** GET /api/portal/medicoes/:id/nfs — lista NFs enviadas */
router.get('/medicoes/:id/nfs', portalAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Verifica ownership
    const mR = await db.query('SELECT id FROM medicoes WHERE id=$1 AND fornecedor_id=$2', [id, req.fornecedor.fornecedor_id]);
    if (!mR.rows[0]) return res.status(404).json({ error: 'Medição não encontrada.' });

    const r = await db.query('SELECT * FROM portal_nfs WHERE medicao_id=$1 ORDER BY enviado_em', [id]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ROTAS INTERNAS — BACKOFFICE FINANCEIRO (auth JWT interno)
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/portal/nfs/fila/stats
 * Contadores por status para os cards do painel.
 */
router.get('/nfs/fila/stats', authInterno, async (req, res) => {
  try {
    const r = await db.query(`
      SELECT
        COUNT(*)                                                      AS total,
        COUNT(*) FILTER (WHERE status_fin = 'Pendente')              AS pendente,
        COUNT(*) FILTER (WHERE status_fin = 'Em Processamento')      AS em_processamento,
        COUNT(*) FILTER (WHERE status_fin = 'Integrado ERP')         AS integrado_erp,
        COUNT(*) FILTER (WHERE status_fin = 'Pago')                  AS pago,
        COALESCE(SUM(valor_nf) FILTER (WHERE status_fin = 'Pendente'), 0)         AS valor_pendente,
        COALESCE(SUM(valor_nf) FILTER (WHERE status_fin = 'Em Processamento'), 0) AS valor_em_proc,
        COALESCE(SUM(valor_nf) FILTER (WHERE status_fin = 'Integrado ERP'), 0)    AS valor_integrado,
        COALESCE(SUM(valor_nf) FILTER (WHERE status_fin = 'Pago'), 0)             AS valor_pago
      FROM portal_nfs
    `);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/portal/nfs/fila
 * Lista todas as NFs recebidas com filtros para o backoffice.
 * Query params: obra_id, fornecedor_id, status_fin, periodo, empresa_id
 */
router.get('/nfs/fila', authInterno, async (req, res) => {
  try {
    const { obra_id, fornecedor_id, status_fin, periodo, empresa_id } = req.query;
    const where  = ['1=1'];
    const params = [];
    let   i      = 1;

    if (obra_id)       { where.push(`o.id = $${i++}`);         params.push(obra_id); }
    if (empresa_id)    { where.push(`e.id = $${i++}`);         params.push(empresa_id); }
    if (fornecedor_id) { where.push(`f.id = $${i++}`);         params.push(fornecedor_id); }
    if (status_fin)    { where.push(`pn.status_fin = $${i++}`);params.push(status_fin); }
    if (periodo)       { where.push(`m.periodo = $${i++}`);    params.push(periodo); }

    const r = await db.query(`
      SELECT
        pn.id, pn.nome_arquivo, pn.numero_nf, pn.valor_nf, pn.chave_nfe, pn.obs,
        pn.provider, pn.caminho, pn.url_storage,
        pn.status_fin, pn.processado_em, pn.processado_por, pn.processado_obs,
        pn.enviado_em, pn.validacoes,
        (pn.dados_nfse IS NOT NULL) AS tem_xml,
        m.id       AS medicao_id,   m.codigo  AS medicao_codigo,
        m.periodo  AS periodo,      m.status  AS medicao_status,
        m.valor_medicao,
        f.id       AS fornecedor_id, f.razao_social AS fornecedor_nome,
        f.cnpj     AS fornecedor_cnpj,
        o.id       AS obra_id,      o.nome   AS obra_nome,
        e.id       AS empresa_id,   e.razao_social AS empresa_nome
      FROM portal_nfs pn
      JOIN medicoes   m  ON m.id  = pn.medicao_id
      JOIN fornecedores f ON f.id = pn.fornecedor_id
      JOIN contratos  c  ON c.id  = m.contrato_id
      JOIN obras      o  ON o.id  = c.obra_id
      JOIN empresas   e  ON e.id  = c.empresa_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE pn.status_fin
          WHEN 'Pendente'         THEN 1
          WHEN 'Em Processamento' THEN 2
          WHEN 'Integrado ERP'    THEN 3
          WHEN 'Pago'             THEN 4
          ELSE 5
        END,
        pn.enviado_em DESC
    `, params);

    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/portal/nfs/:id/xml
 * Gera e devolve o XML NFS-e ABRASF 2.01 a partir dos dados_nfse salvos (backoffice).
 */
router.get('/nfs/:id/xml', authInterno, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT pn.dados_nfse, pn.numero_nf, f.cnpj AS fornecedor_cnpj
         FROM portal_nfs pn
         JOIN fornecedores f ON f.id = pn.fornecedor_id
        WHERE pn.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'NF não encontrada.' });
    const dados = r.rows[0].dados_nfse;
    if (!dados) return res.status(422).json({ error: 'Dados NFS-e não disponíveis para esta NF. O fornecedor não utilizou a extração por IA.' });
    const { xml, nomeArq } = _gerarXmlNFSe(dados);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArq}"`);
    res.send(xml);
  } catch (e) {
    console.error('[Portal/backoffice] XML NFS-e:', e.message);
    res.status(500).json({ error: 'Erro ao gerar XML: ' + e.message });
  }
});

/**
 * GET /api/portal/nfs/:id/arquivo
 * Retorna URL assinada (S3) ou redireciona para o arquivo da NF (backoffice).
 * Para provider local: serve o arquivo diretamente via stream.
 */
router.get('/nfs/:id/arquivo', authInterno, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT provider, caminho, url_storage, nome_arquivo FROM portal_nfs WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'NF não encontrada.' });
    const nf = r.rows[0];

    // GDrive ou S3 público — redireciona para URL já salva
    if (nf.url_storage) return res.redirect(nf.url_storage);

    // S3 privado — gera signed URL on-demand
    if (nf.provider === 's3') {
      const url = await storageHelper.getViewUrl(nf);
      if (!url) return res.status(422).json({ error: 'Não foi possível gerar URL de acesso ao arquivo S3.' });
      return res.redirect(url);
    }

    // Local — serve arquivo diretamente
    const fs   = require('fs');
    const path = require('path');
    const localPath = path.join('/app/uploads', nf.caminho || '');
    if (!fs.existsSync(localPath)) return res.status(404).json({ error: 'Arquivo não encontrado no servidor.' });
    res.setHeader('Content-Disposition', `attachment; filename="${nf.nome_arquivo}"`);
    res.sendFile(localPath);
  } catch (e) {
    console.error('[Portal/backoffice] Download arquivo NF:', e.message);
    res.status(500).json({ error: 'Erro ao acessar arquivo: ' + e.message });
  }
});

/**
 * PUT /api/portal/nfs/:id/status
 * Atualiza o status financeiro de uma NF (backoffice).
 * Body: { status_fin, processado_obs }
 */
router.put('/nfs/:id/status', authInterno, async (req, res) => {
  try {
    const nfId     = parseInt(req.params.id);
    const { status_fin, processado_obs } = req.body;
    const STATUSES = ['Pendente', 'Em Processamento', 'Integrado ERP', 'Pago'];
    if (!STATUSES.includes(status_fin))
      return res.status(400).json({ error: `Status inválido. Use: ${STATUSES.join(', ')}.` });

    const r = await db.query(`
      UPDATE portal_nfs
         SET status_fin      = $1,
             processado_em   = NOW(),
             processado_por  = $2,
             processado_obs  = $3
       WHERE id = $4
       RETURNING *, medicao_id
    `, [status_fin, req.user?.nome || req.user?.login || 'sistema', processado_obs || null, nfId]);

    if (!r.rows[0]) return res.status(404).json({ error: 'NF não encontrada.' });

    const nf = r.rows[0];

    // ── Ao marcar como Pago: propaga status para a medição ──────────────────
    if (status_fin === 'Pago') {
      await db.query(
        `UPDATE medicoes SET status = 'Pago' WHERE id = $1`,
        [nf.medicao_id]
      ).catch(e => console.warn('[Portal] Aviso ao atualizar status da medição:', e.message));

      console.log(`[Portal] Medição ${nf.medicao_id} marcada como Paga — NF ${nfId}`);
    }

    // Audit log
    await db.query(
      `INSERT INTO audit_logs(usuario_id, usuario_login, usuario_nome, acao, entidade, entidade_id, descricao, ip)
       VALUES ($1,$2,$3,'nf_status','portal_nf',$4,$5,$6)`,
      [req.user?.id || null, req.user?.login || '', req.user?.nome || '',
       nfId, `Status NF → ${status_fin}`, req.ip || '']
    ).catch(() => {});

    res.json(nf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
