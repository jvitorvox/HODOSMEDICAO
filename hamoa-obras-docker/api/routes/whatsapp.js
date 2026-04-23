/**
 * CONSTRUTIVO OBRAS — Rotas WhatsApp
 *
 * GET  /api/whatsapp/status          — status da instância Evolution API
 * POST /api/whatsapp/webhook         — recebe mensagens da Evolution API
 * POST /api/whatsapp/teste           — envia mensagem de teste (ADM)
 * POST /api/whatsapp/notificar/:id   — força notificação de medição (ADM)
 *
 * Fluxo de aprovação por mensagem:
 *   Aprovador responde: APROVAR MED-2025-001
 *   Aprovador responde: REPROVAR MED-2025-001 O serviço não está concluído
 */
'use strict';

const router  = require('express').Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const audit   = require('../middleware/audit');
const { checkPerm } = require('../middleware/perm');
const wa      = require('../helpers/whatsapp');

// Faz a verificação de permissão de aprovação e atualiza o status
async function _processarAprovacao(medicao, nivel, acao, usuario, comentario) {
  const permKey = `aprovar${nivel}`; // 'aprovarN1' | 'aprovarN2' | 'aprovarN3'
  const temPerm = await checkPerm(usuario.grupos_ad || [], usuario.perfil, permKey);
  if (!temPerm) throw new Error(`Usuário ${usuario.nome} não tem permissão para ${acao} no nível ${nivel}`);

  await db.query(
    'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
    [medicao.id, nivel, acao, usuario.nome, comentario || '']
  );

  let novoStatus = medicao.status;
  if (acao === 'reprovado') {
    novoStatus = 'Reprovado';
  } else {
    const nextStatus = { 'Aguardando N1': 'Aguardando N2', 'Aguardando N2': 'Aguardando N3', 'Aguardando N3': 'Aprovado' };
    novoStatus = nextStatus[medicao.status] || medicao.status;
    if (novoStatus === 'Aprovado') {
      const assinCfg = await db.query("SELECT valor FROM configuracoes WHERE chave='assinatura'");
      const assin = assinCfg.rows[0]?.valor || {};
      if (assin.ativo) novoStatus = 'Em Assinatura';
    }
  }

  await db.query('UPDATE medicoes SET status=$1 WHERE id=$2', [novoStatus, medicao.id]);

  // Se ficou aprovado/em assinatura, notifica o próximo nível (se houver)
  if (novoStatus.startsWith('Aguardando')) {
    const medCompleta = await db.query(`
      SELECT m.*, o.nome AS obra_nome, f.razao_social AS fornecedor_nome
        FROM medicoes m
        JOIN obras o ON o.id = m.obra_id
        JOIN fornecedores f ON f.id = m.fornecedor_id
       WHERE m.id = $1`, [medicao.id]);
    wa.notificarAprovadores({ ...medCompleta.rows[0], status: novoStatus }).catch(e =>
      console.warn('[WhatsApp] Falha ao notificar próximo nível:', e.message)
    );
  }

  return novoStatus;
}

// ── Webhook — recebe mensagens da Evolution API ───────────────────
router.post('/webhook', async (req, res) => {
  // Responde imediatamente (Evolution API exige resposta rápida)
  res.json({ ok: true });

  try {
    const body = req.body;
    // Evolution API envia diferentes tipos de eventos — filtra apenas mensagens recebidas
    if (body.event !== 'messages.upsert') return;
    const msg = body.data?.messages?.[0] || body.data;
    if (!msg) return;
    // Ignora mensagens próprias e de grupos
    if (msg.key?.fromMe || msg.key?.remoteJid?.includes('@g.us')) return;

    const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim().toUpperCase();
    const tel   = msg.key?.remoteJid?.replace('@s.whatsapp.net', '') || '';

    if (!texto || !tel) return;
    console.log(`[WhatsApp] Mensagem recebida de ${tel}: "${texto}"`);

    // ── Detecta padrão: APROVAR [codigo] ou REPROVAR [codigo] [motivo] ──
    const matchAprovar  = texto.match(/^APROVAR\s+([A-Z0-9\-_]+)/i);
    const matchReprovar = texto.match(/^REPROVAR\s+([A-Z0-9\-_]+)\s*(.*)/is);

    if (!matchAprovar && !matchReprovar) {
      // Mensagem não reconhecida — envia ajuda
      await wa.sendText(await _loadWaCfg(), tel,
        '❓ Não entendi sua resposta.\n\nPara *aprovar*: APROVAR [código]\nPara *reprovar*: REPROVAR [código] [motivo]'
      );
      return;
    }

    const codigo    = (matchAprovar || matchReprovar)[1].toUpperCase();
    const motivo    = matchReprovar ? (matchReprovar[2] || '').trim() : '';
    const acao      = matchAprovar ? 'aprovado' : 'reprovado';

    if (acao === 'reprovado' && !motivo) {
      await wa.sendText(await _loadWaCfg(), tel,
        `⚠️ Para reprovar a medição *${codigo}* você precisa informar o motivo.\n\nEx: REPROVAR ${codigo} O serviço não está concluído`
      );
      return;
    }

    // Busca a medição pelo código
    const medR = await db.query(`
      SELECT m.*, o.nome AS obra_nome, f.razao_social AS fornecedor_nome
        FROM medicoes m
        JOIN obras o ON o.id = m.obra_id
        JOIN fornecedores f ON f.id = m.fornecedor_id
       WHERE UPPER(m.codigo) = $1`, [codigo]);

    if (!medR.rows[0]) {
      await wa.sendText(await _loadWaCfg(), tel,
        `❌ Medição *${codigo}* não encontrada. Verifique o código e tente novamente.`
      );
      return;
    }
    const med = medR.rows[0];

    // Verifica se a medição está aguardando aprovação
    const lvMap = { 'Aguardando N1': 'N1', 'Aguardando N2': 'N2', 'Aguardando N3': 'N3' };
    const nivel = lvMap[med.status];
    if (!nivel) {
      await wa.sendText(await _loadWaCfg(), tel,
        `ℹ️ A medição *${codigo}* está com status *${med.status}* e não pode ser ${acao === 'aprovado' ? 'aprovada' : 'reprovada'} agora.`
      );
      return;
    }

    // Busca o usuário pelo telefone (formato normalizado)
    const telNorm = tel.replace(/\D/g,'').replace(/^55/,'');
    const usuR = await db.query(
      `SELECT * FROM usuarios WHERE ativo=true
         AND regexp_replace(telefone, '\\D', '', 'g') LIKE $1`,
      [`%${telNorm}`]
    );

    if (!usuR.rows[0]) {
      await wa.sendText(await _loadWaCfg(), tel,
        `❌ Seu número não está cadastrado no sistema. Entre em contato com o administrador.`
      );
      return;
    }
    const usuario = usuR.rows[0];

    // Processa a aprovação/reprovação
    let novoStatus;
    try {
      novoStatus = await _processarAprovacao(med, nivel, acao, usuario, motivo);
    } catch (e) {
      await wa.sendText(await _loadWaCfg(), tel, `❌ ${e.message}`);
      return;
    }

    // Registra auditoria (simula req.user para o middleware)
    await db.query(
      `INSERT INTO audit_logs(usuario_id,usuario_login,usuario_nome,acao,entidade,entidade_id,descricao,ip)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [usuario.id, usuario.login, usuario.nome,
       acao === 'aprovado' ? 'aprovar' : 'reprovar',
       'medicao', med.id,
       `Medição "${med.codigo}" ${acao} via WhatsApp — nível ${nivel} → ${novoStatus}`,
       tel]
    );

    // Confirmação para o aprovador
    const emoji = acao === 'aprovado' ? '✅' : '❌';
    await wa.sendText(await _loadWaCfg(), tel,
      `${emoji} *${acao === 'aprovado' ? 'Aprovação' : 'Reprovação'} registrada!*\n\n` +
      `Medição: *${med.codigo}*\n` +
      `Obra: ${med.obra_nome}\n` +
      `Novo status: *${novoStatus}*` +
      (motivo ? `\nMotivo: _${motivo}_` : '')
    );

    console.log(`[WhatsApp] Medição ${med.codigo} ${acao} por ${usuario.nome} via WhatsApp → ${novoStatus}`);
  } catch (e) {
    console.error('[WhatsApp webhook] Erro:', e.message);
  }
});

// ── Helpers ───────────────────────────────────────────────────────
async function _loadWaCfg() {
  const r = await db.query("SELECT valor FROM configuracoes WHERE chave='whatsapp'");
  return r.rows[0]?.valor || {};
}

// ── Status da instância ───────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const cfg = await _loadWaCfg();
    if (!cfg.api_url) return res.json({ conectado: false, msg: 'WhatsApp não configurado.' });
    const status = await wa.testConnection(cfg);
    res.json({ conectado: true, status });
  } catch (e) {
    res.json({ conectado: false, msg: e.message });
  }
});

// ── Enviar mensagem de teste ──────────────────────────────────────
router.post('/teste', auth, async (req, res) => {
  if (req.user?.perfil !== 'ADM')
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  const { telefone, mensagem } = req.body;
  if (!telefone) return res.status(400).json({ error: 'Telefone obrigatório.' });
  try {
    const cfg = await _loadWaCfg();
    await wa.sendText(cfg, telefone, mensagem || '✅ Teste CONSTRUTIVO OBRAS — WhatsApp funcionando!');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Forçar notificação de medição pendente ────────────────────────
router.post('/notificar/:id', auth, async (req, res) => {
  if (req.user?.perfil !== 'ADM')
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  try {
    const medR = await db.query(`
      SELECT m.*, o.nome AS obra_nome, f.razao_social AS fornecedor_nome
        FROM medicoes m
        JOIN obras o ON o.id = m.obra_id
        JOIN fornecedores f ON f.id = m.fornecedor_id
       WHERE m.id = $1`, [req.params.id]);
    if (!medR.rows[0]) return res.status(404).json({ error: 'Medição não encontrada.' });
    const result = await wa.notificarAprovadores(medR.rows[0]);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
