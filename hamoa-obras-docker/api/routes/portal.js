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

const router    = require('express').Router();
const crypto    = require('crypto');
const jwt       = require('jsonwebtoken');
const multer    = require('multer');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const db        = require('../db');
const storageHelper = require('../helpers/storage');
const { sendMail: _sendMail, notificarAprovadoresStatusChange } = require('../helpers/email');
const authInterno   = require('../middleware/auth'); // auth JWT interno (backoffice)
const { perm }      = require('../middleware/perm');
const { getObrasPermitidas, obraClause } = require('../middleware/obras');

const TOKEN_EXPIRY_HOURS = 24;

// Rate limiter para rotas públicas do portal (anti-enumeration / brute-force)
const portalPublicLimiter = rateLimit({
  windowMs:   15 * 60 * 1000, // 15 minutos
  max:        10,              // máx 10 requisições por IP
  keyGenerator: req => req.ip,
  message:    { error: 'Muitas requisições ao portal. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Helper: envio de e-mail via SMTP ──────────────────────────────
// Mantido por compatibilidade — agora delega para helpers/email.js
async function _sendMailLegacy(to, subject, html) {
  // 1. Tenta carregar config do banco (painel de configurações)
  let smtpHost = process.env.SMTP_HOST || '';
  let smtpPort = parseInt(process.env.SMTP_PORT || '587');
  let smtpUser = process.env.SMTP_USER || '';
  let smtpPass = process.env.SMTP_PASS || '';
  let smtpFrom = process.env.SMTP_FROM || 'CONSTRUTIVO AI <noreply@construtivo.com.br>';

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
// (função legada acima mantida para não quebrar referências internas desta rota)

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
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'fornecedor') return res.status(403).json({ error: 'Acesso restrito ao portal do fornecedor.' });
    req.fornecedor = payload; // { fornecedor_id, nome, email, role }
    next();
  } catch {
    res.status(401).json({ error: 'Token expirado ou inválido. Solicite um novo acesso.' });
  }
}

// Upload de NF — multer em /app/uploads
const NF_ALLOWED = {
  '.pdf':  ['application/pdf'],
  '.xml':  ['application/xml', 'text/xml', 'application/octet-stream'],
  '.png':  ['image/png'],
  '.jpg':  ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
};
const uploadNF = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/app/uploads'),
    filename:    (req, file, cb) => cb(null, `nf-${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits:  { fileSize: 20 * 1024 * 1024, files: 1 }, // 20 MB, 1 arquivo por vez
  fileFilter: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase().split(';')[0].trim();
    const allowed = NF_ALLOWED[ext];
    if (!allowed) return cb(new Error(`Tipo de arquivo não permitido: ${ext}`));
    // XML pode vir como application/octet-stream em alguns navegadores — aceitar
    if (!allowed.includes(mime) && ext !== '.xml') {
      return cb(new Error(`Tipo MIME não compatível com a extensão (${mime})`));
    }
    cb(null, true);
  },
});

// ═══════════════════════════════════════════════════════════════════
// ROTAS PÚBLICAS
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/portal/solicitar-acesso
 * Body: { email }
 * Busca o fornecedor pelo e-mail (email ou email_nf),
 * gera um token e envia link por e-mail.
 */
router.post('/solicitar-acesso', portalPublicLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'E-mail é obrigatório.' });

  try {
    // Busca fornecedor pelo e-mail (qualquer campo de e-mail)
    const fR = await db.query(
      `SELECT id, razao_social, nome_fantasia, email, email_nf
         FROM fornecedores
        WHERE ativo = true
          AND (LOWER(email) = LOWER($1)
            OR LOWER(email_nf) = LOWER($1))
        LIMIT 1`,
      [email.trim()]
    );

    if (!fR.rows[0]) {
      console.warn(`[Portal] Solicitação de acesso para e-mail não cadastrado: ${email}`);
      return res.status(404).json({
        error: 'E-mail não encontrado',
        detalhe: `O endereço "${email}" não está cadastrado como e-mail de nenhum fornecedor ativo no sistema. Verifique o endereço informado ou entre em contato com o responsável pelo contrato.`,
      });
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

    // Prioridade: config do banco → env → auto-detect pelo request
    let baseUrl = process.env.PORTAL_URL || '';
    try {
      const cfgR = await db.query("SELECT valor FROM configuracoes WHERE chave='notificacoes'");
      const cfg  = cfgR.rows[0]?.valor || {};
      if (cfg.portalUrl) baseUrl = cfg.portalUrl.replace(/\/portal\.html.*$/, '');
    } catch (_) {}
    if (!baseUrl) baseUrl = _baseUrl(req);

    const link = `${baseUrl}/portal.html?token=${token}`;
    const nomeExib = forn.nome_fantasia || forn.razao_social;

    const emailEnviado = await _sendMail(email.trim(),
      '🔑 Seu link de acesso — Portal CONSTRUTIVO AI',
      `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:40px auto;color:#1e293b">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">CONSTRUTIVO AI</h2>
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
    <p style="font-size:11px;color:#94a3b8;margin:0">CONSTRUTIVO AI — Sistema de Gestão de Obras e Medições</p>
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
router.get('/verificar', portalPublicLimiter, async (req, res) => {
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
      process.env.JWT_SECRET,
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

/**
 * GET /api/portal/config/:chave
 * Retorna configuração permitida para o portal (ex: portal_pedido_compra).
 */
router.get('/config/:chave', portalAuth, async (req, res) => {
  try {
    const PERMITIDAS = ['portal_pedido_compra'];
    if (!PERMITIDAS.includes(req.params.chave)) return res.status(403).json({ error: 'Configuração não disponível.' });
    const r = await db.query('SELECT chave, valor FROM configuracoes WHERE chave=$1', [req.params.chave]);
    res.json(r.rows[0] || { chave: req.params.chave, valor: {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/portal/me — dados do fornecedor logado */
router.get('/me', portalAuth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, razao_social, nome_fantasia, cnpj, tel, email, email_nf,
              representante, cargo_representante, endereco, cep,
              inscricao_municipal, inscricao_estadual, cnae, optante_simples
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
             -- NFs enviadas + status da mais recente + flag de divergência
             (SELECT COUNT(*) FROM portal_nfs pn WHERE pn.medicao_id = m.id) AS total_nfs,
             (SELECT pn.status_fin FROM portal_nfs pn WHERE pn.medicao_id = m.id ORDER BY pn.enviado_em DESC LIMIT 1) AS nf_status_fin,
             (SELECT COALESCE(jsonb_array_length(pn.validacoes), 0) > 0
                FROM portal_nfs pn WHERE pn.medicao_id = m.id ORDER BY pn.enviado_em DESC LIMIT 1) AS nf_tem_divergencia,
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
             c.numero AS contrato_numero, c.valor_total AS contrato_valor_total,
             -- Progresso financeiro: total aprovado no contrato (inclui esta medição)
             COALESCE((
               SELECT SUM(m2.valor_medicao)
                 FROM medicoes m2
                WHERE m2.contrato_id = m.contrato_id
                  AND COALESCE(m2.tipo,'Normal') IN ('Normal','Adiantamento')
                  AND (m2.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                       OR m2.id = m.id)
             ), 0) AS total_financeiro_aprovado,
             -- Progresso físico acumulado (recalculado dos itens, inclui esta medição)
             COALESCE(
               LEAST(100, ROUND(
                 COALESCE((
                   SELECT SUM(
                     CASE WHEN COALESCE(m2.tipo,'Normal') = 'Normal'
                          THEN mi2.valor_item
                          WHEN COALESCE(m2.tipo,'Normal') = 'Avanco_Fisico'
                          THEN mi2.qtd_mes * mi2.valor_unitario
                          ELSE 0 END
                   )
                     FROM medicao_itens mi2
                     JOIN medicoes m2 ON m2.id = mi2.medicao_id
                    WHERE m2.contrato_id = m.contrato_id
                      AND COALESCE(m2.tipo,'Normal') IN ('Normal','Avanco_Fisico')
                      AND (m2.status IN ('Aprovado','Em Assinatura','Assinado','Concluído','Pago')
                           OR m2.id = m.id)
                 ), 0)
                 / NULLIF(c.valor_total, 0) * 100,
               2))
             , 0) AS pct_fisico_acumulado
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

    // ── Extração IA obrigatória (se Gemini estiver configurado) ───────────────
    // Valida que dados_nfse foi preenchido pela extração IA antes do upload.
    // Se o Gemini não estiver configurado, o envio sem análise é permitido.
    const geminiKey = process.env.GEMINI_API_KEY || '';
    if (geminiKey && !dadosNfse) {
      return res.status(422).json({
        error: 'Análise da NF pela IA é obrigatória antes de enviar. '
             + 'Selecione o arquivo novamente para que a extração automática seja realizada.',
      });
    }

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

    // Verifica que a medição pertence ao fornecedor autenticado (via m.fornecedor_id direto)
    const medOwn = await db.query(
      `SELECT m.id FROM medicoes m
        WHERE m.id = $1 AND m.fornecedor_id = $2`,
      [parseInt(req.params.id), req.fornecedor.fornecedor_id]
    );
    if (!medOwn.rows[0]) return res.status(403).json({ error: 'Acesso negado a esta medição.' });

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
router.get('/nfs/fila/stats', authInterno, perm('financeiro'), async (req, res) => {
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
router.get('/nfs/fila', authInterno, perm('financeiro'), async (req, res) => {
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

    // Restrição de acesso por obras permitidas do usuário interno
    const obrasPermitidas = await getObrasPermitidas(req, db);
    const obraFiltroStr   = obraClause(obrasPermitidas, 'o.id', params); // muta params, retorna "AND o.id = ANY($N)"

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
      WHERE ${where.join(' AND ')} ${obraFiltroStr}
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
router.get('/nfs/:id/xml', authInterno, perm('financeiro'), async (req, res) => {
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
router.get('/nfs/:id/arquivo', authInterno, perm('financeiro'), async (req, res) => {
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
router.put('/nfs/:id/status', authInterno, perm('financeiro'), async (req, res) => {
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

      // Notifica aprovadores que a medição foi paga
      notificarAprovadoresStatusChange(
        nf.medicao_id, 'Pago', 'pago', 'Financeiro',
        req.user?.nome || req.user?.login || 'Financeiro',
        processado_obs || null, db
      ).catch(e => console.warn('[Portal] Falha ao notificar aprovadores sobre pagamento:', e.message));
    }

    // ── Ao marcar como Integrado ERP: notifica aprovadores ─────────────────
    if (status_fin === 'Integrado ERP') {
      notificarAprovadoresStatusChange(
        nf.medicao_id, 'Integrado ERP', 'integrado_erp', 'Financeiro',
        req.user?.nome || req.user?.login || 'Financeiro',
        processado_obs || null, db
      ).catch(e => console.warn('[Portal] Falha ao notificar aprovadores sobre integração ERP (NF):', e.message));
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

// ════════════════════════════════════════════════════════════════════
// PEDIDO DE COMPRA — Portal do Fornecedor
//
// GET  /api/portal/pedidos/contratos-wbs  → itens WBS com saldo pendente
// GET  /api/portal/pedidos                → histórico de pedidos do fornecedor
// POST /api/portal/pedidos                → criar novo pedido de compra
// POST /api/portal/pedidos/:id/anexos     → upload de arquivos para o pedido
// ════════════════════════════════════════════════════════════════════

const _uploadPedido = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, '/app/uploads'),
    filename:    (req, file, cb) => cb(null, `pc-${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// ────────────────────────────────────────────────────────────────────
// GET /api/portal/pedidos/contratos-wbs
// Retorna itens WBS do cronograma vinculados a contratos do fornecedor
// que ainda possuem saldo financeiro pendente de medição.
// ────────────────────────────────────────────────────────────────────
router.get('/pedidos/contratos-wbs', portalAuth, async (req, res) => {
  try {
    const fornecedorId = req.fornecedor.fornecedor_id;

    const r = await db.query(`
      SELECT
        c.id                  AS contrato_id,
        c.numero              AS contrato_numero,
        c.objeto              AS contrato_descricao,
        c.valor_total         AS contrato_valor_total,
        o.id                  AS obra_id,
        o.nome                AS obra_nome,
        e.id                  AS empresa_id,
        COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
        a.id                  AS atividade_id,
        a.wbs                 AS wbs,
        a.nome                AS atividade_nome,
        a.data_inicio         AS atividade_inicio,
        a.data_termino        AS atividade_termino,
        (SELECT p.nome FROM atividades_cronograma p WHERE p.id = a.parent_id) AS grupo_pai,
        GREATEST(0,
          c.valor_total - COALESCE(
            (SELECT SUM(mi.valor_item)
               FROM medicao_itens mi
               JOIN medicoes m ON m.id = mi.medicao_id
              WHERE m.contrato_id = c.id
                AND m.status NOT IN ('reprovada','cancelada')),
            0)
        ) AS saldo_pendente
      FROM contratos c
      JOIN obras       o  ON o.id  = c.obra_id
      JOIN empresas    e  ON e.id  = o.empresa_id
      JOIN contratos_atividades ca ON ca.contrato_id = c.id
      JOIN atividades_cronograma a ON a.id = ca.atividade_id
      WHERE c.fornecedor_id = $1
        AND c.status IS DISTINCT FROM 'cancelado'
        AND GREATEST(0,
              c.valor_total - COALESCE(
                (SELECT SUM(mi2.valor_item)
                   FROM medicao_itens mi2
                   JOIN medicoes m2 ON m2.id = mi2.medicao_id
                  WHERE m2.contrato_id = c.id
                    AND m2.status NOT IN ('reprovada','cancelada')),
                0)
            ) > 0
      ORDER BY e.razao_social, o.nome, c.numero, a.wbs
    `, [fornecedorId]);

    // Agrupar por obra para facilitar a UI
    const agrupado = [];
    const obraMap  = {};
    for (const row of r.rows) {
      if (!obraMap[row.obra_id]) {
        const grupo = {
          obra_id:      row.obra_id,
          obra_nome:    row.obra_nome,
          empresa_id:   row.empresa_id,
          empresa_nome: row.empresa_nome,
          contratos:    [],
        };
        obraMap[row.obra_id] = grupo;
        agrupado.push(grupo);
      }
      const obraGrupo = obraMap[row.obra_id];
      let contrato = obraGrupo.contratos.find(c => c.contrato_id === row.contrato_id);
      if (!contrato) {
        contrato = {
          contrato_id:          row.contrato_id,
          contrato_numero:      row.contrato_numero,
          contrato_descricao:   row.contrato_descricao,
          contrato_valor_total: parseFloat(row.contrato_valor_total || 0),
          saldo_pendente:       parseFloat(row.saldo_pendente || 0),
          atividades:           [],
        };
        obraGrupo.contratos.push(contrato);
      }
      contrato.atividades.push({
        atividade_id:      row.atividade_id,
        wbs:               row.wbs,
        atividade_nome:    row.atividade_nome,
        atividade_inicio:  row.atividade_inicio  ? row.atividade_inicio.toISOString().slice(0,10)  : null,
        atividade_termino: row.atividade_termino ? row.atividade_termino.toISOString().slice(0,10) : null,
        grupo_pai:         row.grupo_pai,
      });
    }

    res.json(agrupado);
  } catch (err) {
    console.error('[portal/pedidos/contratos-wbs]', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /api/portal/pedidos
// Histórico de pedidos de compra enviados pelo fornecedor logado.
// ────────────────────────────────────────────────────────────────────
router.get('/pedidos', portalAuth, async (req, res) => {
  try {
    const fornecedorId = req.fornecedor.fornecedor_id;
    const limit  = Math.min(parseInt(req.query.limit || 50), 200);
    const offset = parseInt(req.query.offset || 0);

    const r = await db.query(`
      SELECT
        rm.id, rm.codigo, rm.descricao, rm.wbs, rm.itens, rm.observacao,
        rm.status, rm.uau_pedido_numero, rm.data_entrega, rm.criado_em, rm.atualizado_em,
        o.nome   AS obra_nome,
        COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
        c.numero AS contrato_numero,
        c.objeto AS contrato_descricao,
        a.nome   AS atividade_nome,
        a.wbs    AS atividade_wbs,
        (SELECT COUNT(*) FROM req_materiais_anexos x WHERE x.rm_id = rm.id) AS total_anexos
      FROM req_materiais rm
      JOIN obras     o ON o.id = rm.obra_id
      JOIN empresas  e ON e.id = o.empresa_id
      LEFT JOIN contratos c ON c.id = rm.contrato_id
      LEFT JOIN atividades_cronograma a ON a.id = rm.atividade_id
      WHERE rm.fornecedor_id = $1
      ORDER BY rm.criado_em DESC
      LIMIT $2 OFFSET $3
    `, [fornecedorId, limit, offset]);

    res.json(r.rows);
  } catch (err) {
    console.error('[portal/pedidos GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /api/portal/pedidos/:id
// Detalhe de um pedido do fornecedor logado (inclui itens + histórico).
// ────────────────────────────────────────────────────────────────────
router.get('/pedidos/:id', portalAuth, async (req, res) => {
  try {
    const fornecedorId = req.fornecedor.fornecedor_id;
    const rmId = parseInt(req.params.id);

    const r = await db.query(`
      SELECT
        rm.id, rm.codigo, rm.descricao, rm.wbs, rm.itens, rm.observacao,
        rm.status, rm.uau_pedido_numero, rm.data_entrega, rm.criado_em, rm.atualizado_em,
        o.nome   AS obra_nome,
        COALESCE(e.nome_fantasia, e.razao_social) AS empresa_nome,
        c.numero AS contrato_numero,
        c.objeto AS contrato_descricao,
        a.nome   AS atividade_nome,
        a.wbs    AS atividade_wbs,
        (SELECT COUNT(*) FROM req_materiais_anexos x WHERE x.rm_id = rm.id) AS total_anexos
      FROM req_materiais rm
      JOIN obras     o ON o.id = rm.obra_id
      JOIN empresas  e ON e.id = o.empresa_id
      LEFT JOIN contratos c ON c.id = rm.contrato_id
      LEFT JOIN atividades_cronograma a ON a.id = rm.atividade_id
      WHERE rm.id = $1
        AND rm.fornecedor_id = $2
    `, [rmId, fornecedorId]);

    if (!r.rows[0]) return res.status(404).json({ error: 'Pedido não encontrado.' });

    const [hist, anexosR] = await Promise.all([
      db.query(
        `SELECT status_de, status_para, usuario, observacao, criado_em
         FROM req_materiais_historico WHERE rm_id=$1 ORDER BY criado_em ASC`,
        [rmId]
      ),
      db.query(
        `SELECT id, nome, tipo, tamanho, caminho, provider, url_storage, criado_em
         FROM req_materiais_anexos WHERE rm_id=$1 ORDER BY criado_em ASC`,
        [rmId]
      ),
    ]);

    const storageHelper = require('../helpers/storage');
    const anexos = await Promise.all(anexosR.rows.map(async a => ({
      ...a,
      url_view: await storageHelper.getViewUrl(a),
    })));

    res.json({ ...r.rows[0], historico: hist.rows, anexos });
  } catch (err) {
    console.error('[portal/pedidos/:id GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/portal/pedidos
// Cria novo pedido de compra vindo do portal do fornecedor.
// Body: { atividade_id, contrato_id, obra_id, descricao, wbs, itens[], observacao }
// ────────────────────────────────────────────────────────────────────
router.post('/pedidos', portalAuth, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const fornecedorId = req.fornecedor.fornecedor_id;
    const {
      atividade_id, contrato_id, obra_id,
      descricao, wbs, itens, observacao,
    } = req.body;

    if (!obra_id)           { await client.query('ROLLBACK'); return res.status(400).json({ error: 'obra_id é obrigatório.' }); }
    if (!contrato_id)       { await client.query('ROLLBACK'); return res.status(400).json({ error: 'contrato_id é obrigatório.' }); }
    if (!descricao?.trim()) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'descricao é obrigatória.' }); }

    // Valida que o contrato pertence realmente ao fornecedor
    const cCheck = await client.query(
      'SELECT id FROM contratos WHERE id=$1 AND fornecedor_id=$2',
      [parseInt(contrato_id), fornecedorId]
    );
    if (!cCheck.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Contrato não encontrado ou não pertence ao seu cadastro.' });
    }

    // Busca cronograma_id via atividade
    let cronogramaId = null;
    if (atividade_id) {
      const aRow = await client.query(
        'SELECT cronograma_id FROM atividades_cronograma WHERE id=$1',
        [parseInt(atividade_id)]
      );
      cronogramaId = aRow.rows[0]?.cronograma_id || null;
    }

    const itensArr = Array.isArray(itens)
      ? itens.filter(i => i?.descricao?.trim())
      : [];

    if (!itensArr.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Informe ao menos um item no pedido.' });
    }

    // Busca dados do fornecedor para nome
    const fRow = await client.query(
      'SELECT nome_fantasia, razao_social FROM fornecedores WHERE id=$1',
      [fornecedorId]
    );
    const fNome = fRow.rows[0]?.nome_fantasia || fRow.rows[0]?.razao_social || `Fornecedor ${fornecedorId}`;

    const r = await client.query(`
      INSERT INTO req_materiais
        (atividade_id, cronograma_id, obra_id, contrato_id, fornecedor_id,
         descricao, wbs, itens, observacao,
         criado_por, criado_por_nome, status, origem)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pendente','portal_fornecedor')
      RETURNING *
    `, [
      atividade_id  ? parseInt(atividade_id) : null,
      cronogramaId,
      parseInt(obra_id),
      parseInt(contrato_id),
      fornecedorId,
      descricao.trim(),
      wbs || null,
      JSON.stringify(itensArr),
      observacao || null,
      req.fornecedor.email,
      fNome,
    ]);

    const rm = r.rows[0];

    await client.query(
      `INSERT INTO req_materiais_historico (rm_id, status_de, status_para, usuario, observacao)
       VALUES ($1, NULL, 'pendente', $2, 'Pedido criado pelo portal do fornecedor')`,
      [rm.id, req.fornecedor.email]
    );

    await client.query('COMMIT');
    res.status(201).json(rm);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[portal/pedidos POST]', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /api/portal/pedidos/:id/anexos
// Upload de arquivos para um pedido de compra do fornecedor.
// Usa o mesmo storageHelper das medições/canteiro.
// ────────────────────────────────────────────────────────────────────
router.post('/pedidos/:id/anexos', portalAuth, _uploadPedido.array('files', 10), async (req, res) => {
  const rmId         = parseInt(req.params.id);
  const fornecedorId = req.fornecedor.fornecedor_id;

  if (!req.files?.length) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  // Verifica que o pedido pertence ao fornecedor
  try {
    const check = await db.query(
      'SELECT id FROM req_materiais WHERE id=$1 AND fornecedor_id=$2 AND origem=$3',
      [rmId, fornecedorId, 'portal_fornecedor']
    );
    if (!check.rows[0]) return res.status(403).json({ error: 'Pedido não encontrado.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const salvos = [];
  try {
    for (const file of req.files) {
      const mime = file.mimetype || '';
      let tipo   = 'other';
      if (mime.startsWith('image/'))                               tipo = 'img';
      else if (mime === 'application/pdf')                         tipo = 'pdf';
      else if (mime.includes('word') || mime.includes('document')) tipo = 'doc';
      else if (mime.includes('sheet') || mime.includes('excel'))   tipo = 'doc';

      const bytes   = file.size || 0;
      const tamanho = bytes < 1024 ? `${bytes} B`
        : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

      let result = { provider: 'local', caminho: file.filename, url_storage: null };
      try { result = await storageHelper.uploadFile(file.path, file.originalname, file.mimetype); }
      catch (e) { console.error('[portal/pedidos/anexos upload]', e.message); }

      if (result.provider !== 'local') {
        const fs = require('fs');
        try { fs.unlinkSync(file.path); } catch {}
      }

      const row = (await db.query(
        `INSERT INTO req_materiais_anexos
           (rm_id, nome, tipo, tamanho, caminho, provider, url_storage, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [rmId, file.originalname, tipo, tamanho,
         result.caminho, result.provider, result.url_storage || null,
         req.fornecedor.email]
      )).rows[0];

      row.url_view = await storageHelper.getViewUrl(row);
      salvos.push(row);
    }
    res.status(201).json(salvos);
  } catch (e) {
    console.error('[portal/pedidos/anexos POST]', e);
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────
// PUT /api/portal/pedidos/:id/confirmar-entrega
// Fornecedor confirma recebimento — muda status de em_compra → entregue.
// ────────────────────────────────────────────────────────────────────
router.put('/pedidos/:id/confirmar-entrega', portalAuth, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const fornecedorId = req.fornecedor.fornecedor_id;
    const rmId = parseInt(req.params.id);

    const cur = await client.query(
      `SELECT id, status FROM req_materiais
       WHERE id=$1 AND fornecedor_id=$2 AND origem='portal_fornecedor' FOR UPDATE`,
      [rmId, fornecedorId]
    );
    if (!cur.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    if (cur.rows[0].status !== 'em_compra') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Só é possível confirmar entrega de pedidos com status "em_compra".' });
    }

    await client.query(
      `UPDATE req_materiais SET status='entregue', atualizado_em=NOW() WHERE id=$1`,
      [rmId]
    );
    await client.query(
      `INSERT INTO req_materiais_historico (rm_id, status_de, status_para, usuario)
       VALUES ($1,'em_compra','entregue',$2)`,
      [rmId, req.fornecedor.email || 'portal']
    );

    await client.query('COMMIT');
    res.json({ ok: true, status: 'entregue' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[portal/pedidos/:id/confirmar-entrega]', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /api/portal/insumos
// Lista o catálogo de insumos para uso no formulário de pedido.
// Acesso autenticado pelo portal (fornecedor).
// ────────────────────────────────────────────────────────────────────
router.get('/insumos', portalAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    let sql = 'SELECT id, codigo, nome, unidade FROM insumos';
    const params = [];
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      sql += ` WHERE LOWER(codigo) LIKE $1 OR LOWER(nome) LIKE $1`;
    }
    sql += ' ORDER BY nome ASC';
    const r = await db.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    console.error('[portal/insumos GET]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

