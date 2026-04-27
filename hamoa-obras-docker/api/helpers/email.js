'use strict';
/**
 * helpers/email.js
 * Utilitário de envio de e-mail via SMTP configurado no painel de Configurações.
 */
const db = require('../db');

async function sendMail(to, subject, html) {
  let smtpHost = process.env.SMTP_HOST || '';
  let smtpPort = parseInt(process.env.SMTP_PORT || '587');
  let smtpUser = process.env.SMTP_USER || '';
  let smtpPass = process.env.SMTP_PASS || '';
  let smtpFrom = process.env.SMTP_FROM || 'CONSTRUTIVO AI <noreply@construtivo.com.br>';

  try {
    const cfgR = await db.query("SELECT valor FROM configuracoes WHERE chave='notificacoes'");
    const cfg  = cfgR.rows[0]?.valor || {};
    if (cfg.smtpHost)  smtpHost = cfg.smtpHost;
    if (cfg.smtpPorta) smtpPort = parseInt(cfg.smtpPorta);
    if (cfg.smtpUser)  smtpUser = cfg.smtpUser;
    if (cfg.smtpPass)  smtpPass = cfg.smtpPass;
    if (cfg.remetente) smtpFrom = cfg.remetente;
  } catch (e) {
    console.warn('[email] Aviso ao carregar config SMTP:', e.message);
  }

  if (!smtpHost) {
    console.warn(`[email] SMTP não configurado — e-mail NÃO enviado para ${to}`);
    return false;
  }

  const nodemailer  = require('nodemailer');
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

/**
 * Monta e envia o e-mail de notificação de aprovação ao fornecedor.
 * @param {object} med - objeto com dados da medição + fornecedor
 * @param {string} portalBaseUrl - URL base do portal (ex: https://obras.empresa.com.br/portal.html)
 */
async function notificarAprovacaoFornecedor(med, portalBaseUrl) {
  const email = med.fornecedor_email_nf || med.fornecedor_email;
  if (!email) {
    console.warn(`[email] Fornecedor id=${med.fornecedor_id} sem e-mail cadastrado — notificação não enviada`);
    return false;
  }

  const fmt = v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPer = p => {
    if (!p) return '—';
    const [y, m] = p.split('-');
    const ms = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    return `${ms[parseInt(m)]}/${y}`;
  };
  const fmtPct = v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Tipo de medição — rótulo e cor
  const tipoMap = {
    Normal:        { label: 'Normal',     cor: '#1e3a5f', bg: '#eff6ff', border: '#bfdbfe' },
    Adiantamento:  { label: 'Financeira', cor: '#92400e', bg: '#fffbeb', border: '#fde68a' },
    Avanco_Fisico: { label: 'Física',     cor: '#065f46', bg: '#f0fdf4', border: '#bbf7d0' },
  };
  const tipoInfo = tipoMap[med.tipo] || tipoMap.Normal;

  // Cálculos de progresso
  const contratoValor = parseFloat(med.contrato_valor_total || 0);
  const totalAprovado = parseFloat(med.total_financeiro_aprovado || 0);
  const pctFinanceiro = contratoValor > 0 ? Math.min(100, (totalAprovado / contratoValor) * 100) : 0;
  const pctFisico     = Math.min(100, parseFloat(med.pct_fisico_acumulado || 0));
  const pctFinStr     = fmtPct(pctFinanceiro);
  const pctFisStr     = fmtPct(pctFisico);
  const pctFinBar     = Math.round(Math.min(100, pctFinanceiro));
  const pctFisBar     = Math.round(Math.min(100, pctFisico));

  // Medição financeira (Adiantamento) não avança o físico — alerta de descompasso
  const isFinanceira   = med.tipo === 'Adiantamento';
  const isFisica       = med.tipo === 'Avanco_Fisico';
  const descompassoMsg = isFinanceira
    ? `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:12px 14px;margin-top:10px;font-size:12px;color:#92400e">
         ⚠️ <strong>Atenção — Progresso físico pendente:</strong> Esta medição é do tipo <strong>Financeira</strong>
         e avança apenas o progresso financeiro do contrato. O progresso físico permanece em
         <strong>${pctFisStr}%</strong> e deverá ser regularizado por uma medição do tipo <strong>Física</strong>
         ou <strong>Normal</strong>.
       </div>`
    : '';

  const progressoBloco = contratoValor > 0 ? `
    <!-- Progresso do contrato -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#94a3b8;margin-bottom:14px">PROGRESSO DO CONTRATO${med.contrato_numero ? ' — ' + med.contrato_numero : ''}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:4px">
        <tr>
          <td style="padding:2px 0;color:#64748b">Valor total do contrato</td>
          <td style="padding:2px 0;text-align:right;font-weight:600">R$ ${fmt(contratoValor)}</td>
        </tr>
        <tr>
          <td style="padding:2px 0;color:#64748b">Total medido aprovado</td>
          <td style="padding:2px 0;text-align:right;font-weight:600">R$ ${fmt(totalAprovado)}</td>
        </tr>
      </table>

      <!-- Progresso Financeiro -->
      <div style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span style="color:#374151;font-weight:600">💰 Progresso Financeiro</span>
          <span style="color:#1e3a5f;font-weight:700">${pctFinStr}%</span>
        </div>
        <div style="background:#e2e8f0;border-radius:999px;height:10px;overflow:hidden">
          <div style="background:#1e3a5f;width:${pctFinBar}%;height:100%;border-radius:999px"></div>
        </div>
      </div>

      <!-- Progresso Físico -->
      <div style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span style="color:#374151;font-weight:600">🏗️ Progresso Físico${isFinanceira ? ' <span style="color:#b45309;font-size:11px">(não alterado por esta medição)</span>' : ''}</span>
          <span style="color:${isFinanceira ? '#b45309' : '#0284c7'};font-weight:700">${pctFisStr}%${isFinanceira ? ' ⚠️' : ''}</span>
        </div>
        <div style="background:#e2e8f0;border-radius:999px;height:10px;overflow:hidden">
          <div style="background:${isFinanceira ? '#fbbf24' : '#0284c7'};width:${pctFisBar > 0 ? pctFisBar : 1}%;height:100%;border-radius:999px"></div>
        </div>
      </div>

      ${descompassoMsg}
    </div>` : '';

  const portalLink = portalBaseUrl || process.env.PORTAL_URL || '';
  const linkBtn    = portalLink
    ? `<div style="text-align:center;margin:28px 0">
         <a href="${portalLink}"
            style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:6px;
                   text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">
           📤 Acessar Portal do Fornecedor
         </a>
         <div style="margin-top:12px;font-size:12px;color:#64748b">
           Ou copie e cole o endereço abaixo no seu navegador:<br>
           <a href="${portalLink}" style="color:#1e3a5f;word-break:break-all">${portalLink}</a>
         </div>
       </div>`
    : `<div style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:14px;margin:20px 0;font-size:13px;color:#713f12">
         ⚠️ <strong>Acesse o Portal do Fornecedor</strong> para visualizar suas medições e enviar a Nota Fiscal.<br>
         Se não souber o endereço, entre em contato com o responsável pelo contrato.
       </div>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;color:#1e293b">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">CONSTRUTIVO AI</h2>
    <p style="color:#93c5fd;margin:4px 0 0;font-size:13px">Portal do Fornecedor — Notificação de Aprovação</p>
  </div>
  <div style="background:#f8fafc;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
    <p>Olá, <strong>${med.fornecedor_nome || 'Fornecedor'}</strong>!</p>
    <p>Sua medição foi <strong style="color:#16a34a">aprovada em todas as alçadas</strong> e está apta para emissão e envio da Nota Fiscal.</p>

    <!-- Detalhes da medição -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:20px 0">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#94a3b8;margin-bottom:14px">DETALHES DA MEDIÇÃO</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <td style="padding:6px 0;color:#64748b;width:40%">Código</td>
          <td style="padding:6px 0;font-weight:600">${med.codigo || '—'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Tipo</td>
          <td style="padding:6px 0">
            <span style="display:inline-block;background:${tipoInfo.bg};color:${tipoInfo.cor};border:1px solid ${tipoInfo.border};
                         border-radius:4px;padding:2px 10px;font-size:11px;font-weight:700;letter-spacing:.5px">
              ${tipoInfo.label}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Obra</td>
          <td style="padding:6px 0;font-weight:600">${med.obra_nome || '—'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Empresa</td>
          <td style="padding:6px 0">${med.empresa_nome || '—'}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Período</td>
          <td style="padding:6px 0">${fmtPer(med.periodo)}</td>
        </tr>
        <tr style="border-top:2px solid #e2e8f0">
          <td style="padding:10px 0 6px;color:#64748b;font-weight:600">Valor da Medição</td>
          <td style="padding:10px 0 6px;font-size:18px;font-weight:700;color:#1e3a5f">R$ ${fmt(med.valor_medicao)}</td>
        </tr>
      </table>
    </div>

    ${progressoBloco}

    <p style="font-size:13px;color:#374151">
      Para prosseguir, acesse o <strong>Portal do Fornecedor</strong>, localize esta medição e faça o upload da Nota Fiscal correspondente.
    </p>

    ${linkBtn}

    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:14px;margin-top:8px;font-size:12px;color:#854d0e">
      ⚠️ <strong>Importante:</strong> O valor da Nota Fiscal deve corresponder ao valor da medição aprovada (R$ ${fmt(med.valor_medicao)}).
      Caso tenha dúvidas, entre em contato com o responsável pelo contrato.
    </div>

    <!-- Orientações sobre o preenchimento da NF -->
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:14px;margin-top:10px;font-size:12px;color:#1e40af">
      <strong>📝 Orientações para preenchimento da Nota Fiscal:</strong>
      <ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">
        <li>Informe o <strong>número da NF</strong> e o <strong>valor exato</strong> da medição aprovada.</li>
        <li>Para NFS-e, inclua a <strong>chave de acesso</strong> (44 dígitos) no campo correspondente.</li>
        <li>No campo <strong>Observação</strong> da Nota Fiscal, informe obrigatoriamente o código da medição: <strong>${med.codigo || ''}</strong>. Isso garante o rastreamento correto do pagamento.</li>
      </ul>
    </div>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:11px;color:#94a3b8;margin:0">
      CONSTRUTIVO AI — Sistema de Gestão de Obras e Medições<br>
      Este é um e-mail automático. Não responda diretamente a esta mensagem.
    </p>
  </div>
</body>
</html>`;

  return sendMail(
    email,
    `✅ Medição aprovada — ${med.codigo || ''} — R$ ${fmt(med.valor_medicao)}`,
    html
  );
}

/**
 * Notifica por e-mail todos os aprovadores que já atuaram em uma medição
 * quando o status dela muda (aprovação de qualquer nível, reprovação, assinatura).
 *
 * @param {number} medicaoId  - ID da medição
 * @param {string} novoStatus - Novo status após a ação
 * @param {string} acao       - 'aprovado' | 'reprovado' | 'assinado'
 * @param {string} nivel      - 'N1' | 'N2' | 'N3' | 'Sistema'
 * @param {string} quem       - Nome de quem realizou a ação
 * @param {string} comentario - Comentário/motivo (opcional)
 * @param {object} dbPool     - Pool do pg (require('../db'))
 */
async function notificarAprovadoresStatusChange(medicaoId, novoStatus, acao, nivel, quem, comentario, dbPool) {
  try {
    // 1. Busca dados completos da medição
    const medR = await dbPool.query(`
      SELECT m.id, m.codigo, m.periodo, m.valor_medicao,
             COALESCE(m.tipo,'Normal') AS tipo,
             o.nome         AS obra_nome,
             e.razao_social AS empresa_nome,
             f.razao_social AS fornecedor_nome
        FROM medicoes m
        JOIN contratos c    ON c.id = m.contrato_id
        JOIN obras o        ON o.id = c.obra_id
        JOIN empresas e     ON e.id = c.empresa_id
        JOIN fornecedores f ON f.id = m.fornecedor_id
       WHERE m.id = $1`, [medicaoId]);

    const med = medR.rows[0];
    if (!med) return;

    // 2. Busca todos os aprovadores que já atuaram nesta medição
    const apvR = await dbPool.query(`
      SELECT DISTINCT usuario FROM aprovacoes
       WHERE medicao_id = $1
         AND acao IN ('aprovado','reprovado')
         AND usuario IS NOT NULL
         AND usuario <> ''
         AND usuario <> $2`, [medicaoId, quem]); // exclui quem acabou de agir (já sabe o que fez)

    if (!apvR.rows.length) return;

    // 3. Busca e-mails dos aprovadores pelo nome (campo usuario é o nome do usuário)
    const nomes = apvR.rows.map(r => r.usuario);
    const usrR  = await dbPool.query(
      `SELECT nome, email FROM usuarios WHERE nome = ANY($1) AND email IS NOT NULL AND email <> ''`,
      [nomes]
    );

    if (!usrR.rows.length) return;

    // 4. Monta e envia o e-mail para cada aprovador
    const fmt = v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPer = p => {
      if (!p) return '—';
      const [y, m] = p.split('-');
      const ms = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${ms[parseInt(m)]}/${y}`;
    };

    const statusLabel = {
      'Rascunho':       { label: 'Rascunho',         cor: '#64748b', bg: '#f8fafc' },
      'Aguardando N1':  { label: 'Aguardando N1',    cor: '#92400e', bg: '#fffbeb' },
      'Aguardando N2':  { label: 'Aguardando N2',    cor: '#7c3aed', bg: '#f5f3ff' },
      'Aguardando N3':  { label: 'Aguardando N3',    cor: '#1d4ed8', bg: '#eff6ff' },
      'Aprovado':       { label: 'Aprovada',          cor: '#166534', bg: '#f0fdf4' },
      'Em Assinatura':  { label: 'Em Assinatura',    cor: '#0369a1', bg: '#f0f9ff' },
      'Assinado':       { label: 'Assinada',          cor: '#166534', bg: '#f0fdf4' },
      'Reprovado':      { label: 'Reprovada',         cor: '#991b1b', bg: '#fef2f2' },
      'Concluído':      { label: 'Concluída',         cor: '#166534', bg: '#f0fdf4' },
      'Pago':           { label: 'Paga',              cor: '#065f46', bg: '#ecfdf5' },
      'Integrado ERP':  { label: 'Integrada ao ERP', cor: '#1d4ed8', bg: '#eff6ff' },
    };
    const st = statusLabel[novoStatus] || { label: novoStatus, cor: '#374151', bg: '#f8fafc' };

    const acaoLabel = acao === 'aprovado'      ? `✅ Aprovação ${nivel}`
                    : acao === 'reprovado'    ? `❌ Reprovação ${nivel}`
                    : acao === 'assinado'     ? `✍️ Documento Assinado`
                    : acao === 'pago'         ? `💰 Pagamento Registrado`
                    : acao === 'integrado_erp'? `🔗 Integrado ao ERP`
                    :                           acao;

    const comentarioBloco = comentario
      ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 14px;margin:14px 0;font-size:13px;color:#374151">
           <strong>💬 Comentário:</strong> ${comentario}
         </div>`
      : '';

    const tipoMap = {
      Normal:        'Normal',
      Adiantamento:  'Financeira',
      Avanco_Fisico: 'Física',
    };

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;color:#1e293b">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">CONSTRUTIVO AI</h2>
    <p style="color:#93c5fd;margin:4px 0 0;font-size:13px">Atualização de Status — Medição</p>
  </div>
  <div style="background:#f8fafc;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">

    <p style="margin-top:0">Olá! A medição abaixo teve uma atualização de status.</p>

    <!-- Status badge -->
    <div style="text-align:center;margin:20px 0">
      <div style="display:inline-block;background:${st.bg};color:${st.cor};border:1px solid ${st.cor}33;
                  border-radius:6px;padding:8px 24px;font-size:15px;font-weight:700;letter-spacing:.5px">
        ${st.label}
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:8px">${acaoLabel} por <strong>${quem}</strong></div>
    </div>

    ${comentarioBloco}

    <!-- Detalhes da medição -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#94a3b8;margin-bottom:14px">DETALHES DA MEDIÇÃO</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <td style="padding:5px 0;color:#64748b;width:38%">Código</td>
          <td style="padding:5px 0;font-weight:700;color:#1e3a5f">${med.codigo || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Tipo</td>
          <td style="padding:5px 0">${tipoMap[med.tipo] || med.tipo || 'Normal'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Obra</td>
          <td style="padding:5px 0;font-weight:600">${med.obra_nome || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Empresa</td>
          <td style="padding:5px 0">${med.empresa_nome || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Fornecedor</td>
          <td style="padding:5px 0">${med.fornecedor_nome || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Período</td>
          <td style="padding:5px 0">${fmtPer(med.periodo)}</td>
        </tr>
        <tr style="border-top:2px solid #e2e8f0">
          <td style="padding:10px 0 4px;color:#64748b;font-weight:600">Valor</td>
          <td style="padding:10px 0 4px;font-size:17px;font-weight:700;color:#1e3a5f">R$ ${fmt(med.valor_medicao)}</td>
        </tr>
      </table>
    </div>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:11px;color:#94a3b8;margin:0">
      CONSTRUTIVO AI — Sistema de Gestão de Obras e Medições<br>
      Este é um e-mail automático. Não responda diretamente a esta mensagem.
    </p>
  </div>
</body>
</html>`;

    const subjectEmoji = acao === 'aprovado' ? '✅' : acao === 'reprovado' ? '❌' : '✍️';
    const subject = `${subjectEmoji} Medição ${med.codigo} — ${st.label}`;

    for (const u of usrR.rows) {
      try {
        await sendMail(u.email, subject, html);
        console.log(`[email] Notificação de status enviada para aprovador ${u.nome} <${u.email}> — medicao=${medicaoId} status=${novoStatus}`);
      } catch (e) {
        console.warn(`[email] Falha ao notificar aprovador ${u.nome}:`, e.message);
      }
    }
  } catch (e) {
    console.warn('[email] notificarAprovadoresStatusChange erro:', e.message);
  }
}

/**
 * Notifica por e-mail os aprovadores do próximo nível quando uma medição
 * aguarda aprovação (criação, submissão de rascunho ou aprovação de nível anterior).
 *
 * Regras de destinatário:
 *  - Pertence a algum dos grupos do nível (ex: n1_grupos) da alçada da obra/empresa.
 *  - Tem acesso à obra: obras_permitidas IS NULL ou '{}' (vê tudo) OU obra_id está em obras_permitidas.
 *
 * @param {object} med    - Objeto com pelo menos: id, codigo, status, obra_id, empresa_id,
 *                          obra_nome, empresa_nome, fornecedor_nome, periodo, valor_medicao, tipo
 * @param {object} dbPool - Pool do pg
 */
async function notificarPendenciaAprovacao(med, dbPool) {
  try {
    console.log(`[email] notificarPendenciaAprovacao — medicao=${med.id} status="${med.status}" empresa=${med.empresa_id} obra=${med.obra_id}`);

    const nivelMap = {
      'Aguardando N1': { nivel: 'N1', colGrupos: 'n1_grupos' },
      'Aguardando N2': { nivel: 'N2', colGrupos: 'n2_grupos' },
      'Aguardando N3': { nivel: 'N3', colGrupos: 'n3_grupos' },
    };
    const info = nivelMap[med.status];
    if (!info) {
      console.log(`[email] Status "${med.status}" não requer notificação de pendência — ignorando`);
      return;
    }

    // 1. Busca alçada da obra (específica) ou da empresa (global)
    const alcR = await dbPool.query(
      `SELECT ${info.colGrupos} AS grupos, id, nome, obra_id
         FROM alcadas
        WHERE empresa_id = $1
          AND (obra_id = $2 OR obra_id IS NULL)
          AND (ativo IS NULL OR ativo = true)
        ORDER BY (obra_id IS NOT NULL) DESC  -- alçada específica da obra tem prioridade
        LIMIT 1`,
      [med.empresa_id, med.obra_id]
    );

    if (!alcR.rows[0]) {
      console.warn(`[email] Nenhuma alçada encontrada — empresa=${med.empresa_id} obra=${med.obra_id}`);
      return;
    }
    if (!alcR.rows[0].grupos?.length) {
      console.warn(`[email] Alçada id=${alcR.rows[0].id} "${alcR.rows[0].nome}" sem grupos para ${info.nivel} — notificação ignorada`);
      return;
    }

    const grupos = alcR.rows[0].grupos; // text[]
    console.log(`[email] Alçada id=${alcR.rows[0].id} "${alcR.rows[0].nome}" — grupos ${info.nivel}: ${JSON.stringify(grupos)}`);

    // 2. Busca usuários que pertencem aos grupos E têm acesso à obra
    const usrR = await dbPool.query(
      `SELECT u.id, u.nome, u.email
         FROM usuarios u
        WHERE u.ativo = true
          AND u.email IS NOT NULL AND u.email <> ''
          AND u.grupos_ad IS NOT NULL
          AND u.grupos_ad && $1::text[]
          AND (
            u.obras_permitidas IS NULL
            OR u.obras_permitidas = '{}'::integer[]
            OR $2 = ANY(u.obras_permitidas)
          )`,
      [grupos, med.obra_id]
    );

    if (!usrR.rows.length) {
      console.warn(`[email] Nenhum aprovador ${info.nivel} com e-mail e acesso à obra encontrado — grupos=${JSON.stringify(grupos)} obra=${med.obra_id}`);
      return;
    }
    console.log(`[email] Aprovadores ${info.nivel} encontrados: ${usrR.rows.map(u => `${u.nome} <${u.email}>`).join(', ')}`);

    // 3. Monta e-mail
    const fmt = v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPer = p => {
      if (!p) return '—';
      const [y, m] = p.split('-');
      const ms = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${ms[parseInt(m)]}/${y}`;
    };

    const tipoMap = { Normal: 'Normal', Adiantamento: 'Financeira', Avanco_Fisico: 'Física' };
    const tipoLabel = tipoMap[med.tipo] || med.tipo || 'Normal';

    const nivelColors = {
      N1: { cor: '#92400e', bg: '#fffbeb', border: '#fde68a', label: 'N1' },
      N2: { cor: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', label: 'N2' },
      N3: { cor: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', label: 'N3' },
    };
    const nc = nivelColors[info.nivel];

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;color:#1e293b">
  <div style="background:#1e3a5f;padding:24px 32px;border-radius:8px 8px 0 0">
    <h2 style="color:#fff;margin:0;font-size:18px">CONSTRUTIVO AI</h2>
    <p style="color:#93c5fd;margin:4px 0 0;font-size:13px">Medição Pendente de Aprovação</p>
  </div>
  <div style="background:#f8fafc;padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">

    <p style="margin-top:0">Olá! Existe uma medição pendente de aprovação sob sua responsabilidade.</p>

    <!-- Nível badge -->
    <div style="text-align:center;margin:20px 0">
      <div style="display:inline-block;background:${nc.bg};color:${nc.cor};border:1px solid ${nc.border};
                  border-radius:6px;padding:10px 28px;font-size:16px;font-weight:700;letter-spacing:.5px">
        ⏳ Aguardando Aprovação ${nc.label}
      </div>
    </div>

    <!-- Detalhes da medição -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:16px 0">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#94a3b8;margin-bottom:14px">DETALHES DA MEDIÇÃO</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr>
          <td style="padding:5px 0;color:#64748b;width:38%">Código</td>
          <td style="padding:5px 0;font-weight:700;color:#1e3a5f">${med.codigo || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Tipo</td>
          <td style="padding:5px 0">${tipoLabel}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Obra</td>
          <td style="padding:5px 0;font-weight:600">${med.obra_nome || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Empresa</td>
          <td style="padding:5px 0">${med.empresa_nome || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Fornecedor</td>
          <td style="padding:5px 0">${med.fornecedor_nome || '—'}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;color:#64748b">Período</td>
          <td style="padding:5px 0">${fmtPer(med.periodo)}</td>
        </tr>
        <tr style="border-top:2px solid #e2e8f0">
          <td style="padding:10px 0 4px;color:#64748b;font-weight:600">Valor</td>
          <td style="padding:10px 0 4px;font-size:17px;font-weight:700;color:#1e3a5f">R$ ${fmt(med.valor_medicao)}</td>
        </tr>
      </table>
    </div>

    <p style="font-size:13px;color:#374151">
      Acesse o <strong>CONSTRUTIVO AI</strong> para revisar e aprovar esta medição.
    </p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
    <p style="font-size:11px;color:#94a3b8;margin:0">
      CONSTRUTIVO AI — Sistema de Gestão de Obras e Medições<br>
      Este é um e-mail automático. Não responda diretamente a esta mensagem.
    </p>
  </div>
</body>
</html>`;

    const subject = `⏳ Medição ${med.codigo || ''} aguardando aprovação ${info.nivel} — ${med.obra_nome || ''}`;

    for (const u of usrR.rows) {
      try {
        await sendMail(u.email, subject, html);
        console.log(`[email] Pendência ${info.nivel} notificada → ${u.nome} <${u.email}> — medicao=${med.id}`);
      } catch (e) {
        console.warn(`[email] Falha ao notificar aprovador ${u.nome}:`, e.message);
      }
    }
  } catch (e) {
    console.warn('[email] notificarPendenciaAprovacao erro:', e.message);
  }
}

module.exports = { sendMail, notificarAprovacaoFornecedor, notificarAprovadoresStatusChange, notificarPendenciaAprovacao };
