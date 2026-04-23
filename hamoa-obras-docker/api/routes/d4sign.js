/**
 * CONSTRUTIVO OBRAS — Rotas D4Sign
 *
 * POST /api/d4sign/webhook  — recebe eventos da D4Sign (sem auth — IP público D4Sign)
 *
 * Eventos tratados:
 *   type_event = "signature_signed"    → um signatário assinou
 *   type_event = "finished"            → todos assinaram → status = Assinado
 *   type_event = "canceled"            → documento cancelado → status volta para Aprovado
 *
 * D4Sign envia o webhook para a URL configurada em:
 *   Configurações → assinatura → webhookUrl
 *   (ex: https://seu-dominio.com.br/api/d4sign/webhook)
 *
 * O registro do webhook ocorre automaticamente ao enviar o documento via
 * api/routes/medicoes.js → helpers/d4sign.js → enviarParaAssinatura()
 */
'use strict';

const router = require('express').Router();
const db     = require('../db');

// ── Webhook D4Sign ────────────────────────────────────────────────────────────
// Responde 200 imediatamente (D4Sign exige resposta rápida)
router.post('/webhook', async (req, res) => {
  res.json({ ok: true });

  try {
    const body = req.body;
    console.log('[D4Sign webhook] Payload recebido:', JSON.stringify(body).slice(0, 800));

    // D4Sign envia diferentes formatos — normaliza os campos-chave
    // Ref: https://docapi.d4sign.com.br/reference/webhook
    const docUuid  = body?.uuid       || body?.uuid_doc    || body?.document?.uuid || '';
    const evento   = body?.type_event || body?.event       || body?.status         || '';
    const etapa    = body?.type_name  || body?.statusName  || '';

    if (!docUuid) {
      console.warn('[D4Sign webhook] Payload sem uuid — ignorado.');
      return;
    }

    console.log(`[D4Sign webhook] doc=${docUuid} evento="${evento}" etapa="${etapa}"`);

    // Busca a medição pelo d4sign_doc_uuid
    const medR = await db.query(
      `SELECT m.id, m.codigo, m.status, o.nome AS obra_nome
         FROM medicoes m
         JOIN obras o ON o.id = m.obra_id
        WHERE m.d4sign_doc_uuid = $1`,
      [docUuid]
    );

    if (!medR.rows[0]) {
      console.warn(`[D4Sign webhook] Nenhuma medição encontrada para doc=${docUuid}`);
      return;
    }

    const med = medR.rows[0];

    // ── Evento: documento totalmente assinado ─────────────────────────────────
    // type_event = "finished"  (todos os signatários assinaram)
    const isFinished = /finish|conclu|signed|assinado/i.test(evento + etapa);

    if (isFinished && med.status === 'Em Assinatura') {
      await db.query(
        "UPDATE medicoes SET status='Assinado' WHERE id=$1",
        [med.id]
      );
      await db.query(
        `INSERT INTO aprovacoes(medicao_id, nivel, acao, usuario, comentario)
         VALUES ($1, 'Sistema', 'assinado', 'D4Sign', $2)`,
        [med.id, `Documento assinado por todos os signatários via D4Sign. UUID: ${docUuid}`]
      );
      await db.query(
        `INSERT INTO audit_logs(usuario_id, usuario_login, usuario_nome, acao, entidade, entidade_id, descricao, ip)
         VALUES (NULL, 'sistema', 'D4Sign Webhook', 'assinatura_concluida', 'medicao', $1, $2, 'webhook')`,
        [med.id, `Medição "${med.codigo}" (${med.obra_nome}) assinada via D4Sign. Evento: ${evento}`]
      );
      console.log(`[D4Sign webhook] ✅ Medição ${med.codigo} marcada como Assinado.`);
      return;
    }

    // ── Evento: documento cancelado no D4Sign ─────────────────────────────────
    const isCanceled = /cancel/i.test(evento + etapa);

    if (isCanceled && med.status === 'Em Assinatura') {
      await db.query(
        "UPDATE medicoes SET status='Aprovado', d4sign_doc_uuid=NULL WHERE id=$1",
        [med.id]
      );
      await db.query(
        `INSERT INTO aprovacoes(medicao_id, nivel, acao, usuario, comentario)
         VALUES ($1, 'Sistema', 'cancelado', 'D4Sign', $2)`,
        [med.id, `Documento cancelado no D4Sign. UUID: ${docUuid}. Medição retornou para Aprovado.`]
      );
      console.log(`[D4Sign webhook] ⚠️ Medição ${med.codigo} voltou para Aprovado (documento cancelado).`);
      return;
    }

    // ── Evento: assinatura parcial (um signatário assinou, outros pendentes) ──
    const isSigned = /sign/i.test(evento);
    if (isSigned) {
      const signerEmail = body?.email || body?.signer?.email || '—';
      console.log(`[D4Sign webhook] ℹ️ Medição ${med.codigo} — assinatura parcial de ${signerEmail}. Aguardando demais signatários.`);
    }

  } catch (e) {
    console.error('[D4Sign webhook] Erro:', e.message);
  }
});

// ── Status do webhook (para diagnóstico) ─────────────────────────────────────
router.get('/webhook/status', require('../middleware/auth'), async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, codigo, status, d4sign_doc_uuid, atualizado_em
         FROM medicoes
        WHERE d4sign_doc_uuid IS NOT NULL
        ORDER BY atualizado_em DESC
        LIMIT 20`
    );
    res.json({ total: r.rows.length, medicoes: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
