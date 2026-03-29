/**
 * HAMOA OBRAS — Rotas de Medições
 * GET    /api/medicoes[?empresa_id=&status=&periodo=]
 * GET    /api/medicoes/:id
 * POST   /api/medicoes
 * PUT    /api/medicoes/:id
 * POST   /api/medicoes/:id/aprovar
 * POST   /api/medicoes/:id/reprovar
 * POST   /api/medicoes/:id/enviar-assinatura
 * POST   /api/medicoes/:id/evidencias
 */
const router  = require('express').Router();
const path    = require('path');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const db   = require('../db');
const auth = require('../middleware/auth');

// Upload de evidências em disco
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/app/uploads'),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── Helper: valida saldo e salva itens de medição ─────────────────
async function _saveMedicaoItens(client, medicao_id, contrato_id, arr, isUpdate) {
  for (const it of arr) {
    if (!it.contrato_item_id) continue;
    const qtdMes = parseFloat(it.qtd_mes) || 0;
    if (qtdMes <= 0) continue;

    const acumQ = await client.query(`
      SELECT COALESCE(SUM(mi.qtd_mes), 0) AS total
      FROM medicao_itens mi
      JOIN medicoes m ON m.id = mi.medicao_id
      WHERE mi.contrato_item_id = $1
        AND m.contrato_id = $2
        AND m.status NOT IN ('Rascunho','Reprovado')
        AND mi.medicao_id <> $3
    `, [it.contrato_item_id, contrato_id, isUpdate || 0]);
    const acumulado = parseFloat(acumQ.rows[0].total) || 0;

    const ciR = await client.query(
      'SELECT qtd_total, descricao FROM contrato_itens WHERE id=$1',
      [it.contrato_item_id]
    );
    if (ciR.rows[0]) {
      const qtdTotal = parseFloat(ciR.rows[0].qtd_total) || 0;
      const saldo    = parseFloat((qtdTotal - acumulado).toFixed(4));
      if (qtdMes > saldo + 0.0001) {
        throw new Error(
          `Item "${ciR.rows[0].descricao}": quantidade ${qtdMes} excede o saldo disponível ${saldo} ${it.unidade||''}.`
        );
      }
    }
  }

  if (isUpdate) await client.query('DELETE FROM medicao_itens WHERE medicao_id=$1', [medicao_id]);

  for (let i = 0; i < arr.length; i++) {
    const it      = arr[i];
    const qtdAnt  = parseFloat(it.qtd_anterior)  || 0;
    const qtdMes  = parseFloat(it.qtd_mes)        || 0;
    const vun     = parseFloat(it.valor_unitario) || 0;
    const qtdAcum = parseFloat((qtdAnt + qtdMes).toFixed(4));
    const valItem = parseFloat((qtdMes * vun).toFixed(2));
    await client.query(
      `INSERT INTO medicao_itens
         (medicao_id, contrato_item_id, ordem, descricao, unidade,
          qtd_contrato, qtd_anterior, qtd_mes, qtd_acumulada, valor_unitario, valor_item)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [medicao_id, it.contrato_item_id || null, i, it.descricao, it.unidade || '%',
       parseFloat(it.qtd_contrato) || 0, qtdAnt, qtdMes, qtdAcum, vun, valItem]
    );
  }
}

// ── Listagem ─────────────────────────────────────────────────────

router.get('/', auth, async (req, res) => {
  let q = `SELECT m.*,
             o.nome as obra_nome,
             COALESCE(NULLIF(f.nome_fantasia,''), f.razao_social) as fornecedor_nome,
             COALESCE(NULLIF(e.nome_fantasia,''), e.razao_social) as empresa_nome,
             c.numero as contrato_numero,
             c.valor_total AS contrato_valor_total,
             CASE WHEN c.valor_total > 0
               THEN ROUND(m.valor_medicao / c.valor_total * 100, 2)
               ELSE 0 END AS pct_desta_medicao_no_contrato
           FROM medicoes m
           JOIN obras        o ON m.obra_id       = o.id
           JOIN fornecedores f ON m.fornecedor_id  = f.id
           JOIN empresas     e ON m.empresa_id     = e.id
           JOIN contratos    c ON m.contrato_id    = c.id
           WHERE 1=1`;
  const params = [];
  if (req.query.empresa_id) { params.push(req.query.empresa_id); q += ` AND m.empresa_id=$${params.length}`; }
  if (req.query.status)     { params.push(req.query.status);     q += ` AND m.status=$${params.length}`; }
  if (req.query.periodo)    { params.push(req.query.periodo);    q += ` AND m.periodo=$${params.length}`; }
  q += ' ORDER BY m.criado_em DESC';
  res.json((await db.query(q, params)).rows);
});

// ── Detalhe ──────────────────────────────────────────────────────

router.get('/:id', auth, async (req, res) => {
  const r = await db.query(`
    SELECT m.*,
      e.razao_social  AS empresa_nome,
      o.nome          AS obra_nome,
      f.razao_social  AS fornecedor_nome,
      f.email_assin   AS fornecedor_email_assin,
      f.email_nf      AS fornecedor_email_nf,
      f.tel           AS fornecedor_tel,
      c.numero        AS contrato_numero,
      c.valor_total   AS contrato_valor_total
    FROM medicoes m
    LEFT JOIN empresas    e ON e.id = m.empresa_id
    LEFT JOIN obras       o ON o.id = m.obra_id
    LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
    LEFT JOIN contratos   c ON c.id = m.contrato_id
    WHERE m.id = $1`, [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  const med = r.rows[0];

  const execAnteriorR = await db.query(`
    SELECT COALESCE(SUM(mi.valor_item), 0) AS valor_executado
    FROM medicao_itens mi
    JOIN medicoes m ON m.id = mi.medicao_id
    WHERE m.contrato_id = $1
      AND m.status NOT IN ('Rascunho','Reprovado')
      AND m.id <> $2
  `, [med.contrato_id, req.params.id]);

  const valorExecAnterior = parseFloat(execAnteriorR.rows[0].valor_executado) || 0;
  const contratoValTotal  = parseFloat(med.contrato_valor_total) || 0;
  const valorMedicaoAtual = parseFloat(med.valor_medicao) || 0;
  const pctAnterior  = contratoValTotal > 0
    ? parseFloat(Math.min(100, (valorExecAnterior / contratoValTotal * 100)).toFixed(2)) : 0;
  const pctEstaMed   = contratoValTotal > 0
    ? parseFloat(Math.min(100, (valorMedicaoAtual / contratoValTotal * 100)).toFixed(2)) : 0;
  const pctAcumulado = parseFloat(Math.min(100, pctAnterior + pctEstaMed).toFixed(2));

  const [aprs, evs, itens] = await Promise.all([
    db.query('SELECT * FROM aprovacoes   WHERE medicao_id=$1 ORDER BY data_hora', [req.params.id]),
    db.query('SELECT * FROM evidencias   WHERE medicao_id=$1', [req.params.id]),
    db.query('SELECT * FROM medicao_itens WHERE medicao_id=$1 ORDER BY ordem,id', [req.params.id]),
  ]);

  res.json({
    ...med,
    valor_exec_anterior:    valorExecAnterior,
    pct_anterior_contrato:  pctAnterior,
    pct_esta_medicao:       pctEstaMed,
    pct_acumulado_contrato: pctAcumulado,
    aprovacoes: aprs.rows,
    evidencias: evs.rows,
    itens: itens.rows,
  });
});

// ── Criar ────────────────────────────────────────────────────────

router.post('/', auth, async (req, res) => {
  const { empresa_id, obra_id, fornecedor_id, contrato_id, periodo, codigo,
          pct_anterior, pct_mes, pct_total, descricao, status, itens } = req.body;
  const arr             = Array.isArray(itens) ? itens : [];
  const valor_medicao   = arr.reduce((s, it) => s + (parseFloat(it.qtd_mes)||0) * (parseFloat(it.valor_unitario)||0), 0);
  const valor_acumulado = arr.reduce((s, it) => s + (parseFloat(it.qtd_acumulada)||0) * (parseFloat(it.valor_unitario)||0), 0);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO medicoes
         (empresa_id,obra_id,fornecedor_id,contrato_id,periodo,codigo,
          pct_anterior,pct_mes,pct_total,valor_medicao,valor_acumulado,descricao,status,criado_por)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [empresa_id, obra_id, fornecedor_id, contrato_id, periodo, codigo,
       pct_anterior||0, pct_mes||0, pct_total||0,
       parseFloat(valor_medicao.toFixed(2)), parseFloat(valor_acumulado.toFixed(2)),
       descricao, status||'Rascunho', req.user.nome]
    );
    await _saveMedicaoItens(client, r.rows[0].id, contrato_id, arr, null);
    if (status && status !== 'Rascunho') {
      await client.query(
        'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
        [r.rows[0].id, 'Sistema', 'lançado', req.user.nome, 'Medição lançada para aprovação']
      );
    }
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (e.message.includes('excede o saldo')) return res.status(422).json({ error: e.message });
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── Atualizar ────────────────────────────────────────────────────

router.put('/:id', auth, async (req, res) => {
  const m = await db.query('SELECT * FROM medicoes WHERE id=$1', [req.params.id]);
  if (!m.rows[0]) return res.status(404).json({ error: 'Não encontrado' });

  const { descricao, status, itens, pct_anterior, pct_mes, pct_total, contrato_id } = req.body;
  const arr             = Array.isArray(itens) ? itens : [];
  const valor_medicao   = arr.length
    ? arr.reduce((s, it) => s + (parseFloat(it.qtd_mes)||0) * (parseFloat(it.valor_unitario)||0), 0)
    : parseFloat(m.rows[0].valor_medicao);
  const valor_acumulado = arr.length
    ? arr.reduce((s, it) => s + (parseFloat(it.qtd_acumulada)||0) * (parseFloat(it.valor_unitario)||0), 0)
    : parseFloat(m.rows[0].valor_acumulado);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE medicoes SET
         descricao=$1,status=$2,pct_anterior=$3,pct_mes=$4,pct_total=$5,
         valor_medicao=$6,valor_acumulado=$7
       WHERE id=$8 RETURNING *`,
      [descricao, status, pct_anterior||0, pct_mes||0, pct_total||0,
       parseFloat(valor_medicao.toFixed(2)), parseFloat(valor_acumulado.toFixed(2)), req.params.id]
    );
    if (arr.length) {
      const cid = contrato_id || m.rows[0].contrato_id;
      await _saveMedicaoItens(client, parseInt(req.params.id), cid, arr, parseInt(req.params.id));
    }
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (e.message.includes('excede o saldo')) return res.status(422).json({ error: e.message });
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── Aprovações ───────────────────────────────────────────────────

router.post('/:id/aprovar', auth, async (req, res) => {
  const id  = parseInt(req.params.id);
  const { comentario } = req.body;
  const m   = await db.query('SELECT * FROM medicoes WHERE id=$1', [id]);
  if (!m.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  const med = m.rows[0];
  const lvMap = { 'Aguardando N1': 'N1', 'Aguardando N2': 'N2', 'Aguardando N3': 'N3' };
  const nivel = lvMap[med.status];
  if (!nivel) return res.status(400).json({ error: 'Medição não está em alçada de aprovação' });
  await db.query(
    'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
    [id, nivel, 'aprovado', req.user.nome, comentario||'']
  );
  const nextStatus = { 'Aguardando N1': 'Aguardando N2', 'Aguardando N2': 'Aguardando N3', 'Aguardando N3': 'Aprovado' };
  let novoStatus = nextStatus[med.status];
  if (novoStatus === 'Aprovado') {
    const assinCfg = await db.query("SELECT valor FROM configuracoes WHERE chave='assinatura'");
    const assin = assinCfg.rows[0] ? assinCfg.rows[0].valor : {};
    if (assin.ativo) novoStatus = 'Em Assinatura';
  }
  await db.query('UPDATE medicoes SET status=$1 WHERE id=$2', [novoStatus, id]);
  res.json({ ok: true, novoStatus });
});

router.post('/:id/reprovar', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { motivo } = req.body;
  if (!motivo) return res.status(400).json({ error: 'Motivo obrigatório' });
  const m = await db.query('SELECT * FROM medicoes WHERE id=$1', [id]);
  if (!m.rows[0]) return res.status(404).json({ error: 'Não encontrado' });
  const lvMap = { 'Aguardando N1': 'N1', 'Aguardando N2': 'N2', 'Aguardando N3': 'N3' };
  const nivel = lvMap[m.rows[0].status];
  if (!nivel) return res.status(400).json({ error: 'Status inválido para reprovação' });
  await db.query(
    'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
    [id, nivel, 'reprovado', req.user.nome, motivo]
  );
  await db.query("UPDATE medicoes SET status='Reprovado' WHERE id=$1", [id]);
  res.json({ ok: true });
});

// ── Enviar para assinatura ────────────────────────────────────────

router.post('/:id/enviar-assinatura', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { email_fornecedor, tel_fornecedor, email_remetente, canais = ['email'] } = req.body;
    const viaEmail    = canais.includes('email');
    const viaWhatsapp = canais.includes('whatsapp');
    if (!viaEmail && !viaWhatsapp)
      return res.status(400).json({ error: 'Selecione ao menos um canal de envio (email ou whatsapp)' });
    // E-mail sempre obrigatório — ClickSign usa como identificador único do signatário
    if (!email_fornecedor) return res.status(400).json({ error: 'E-mail do fornecedor é obrigatório (o ClickSign exige e-mail como identificador do signatário)' });
    if (viaWhatsapp && !tel_fornecedor) return res.status(400).json({ error: 'Telefone do fornecedor é obrigatório para envio por WhatsApp' });

    // ── Busca dados da medição ───────────────────────────────────
    const r = await db.query(`
      SELECT m.*, e.razao_social AS empresa_nome, o.nome AS obra_nome,
             f.razao_social AS fornecedor_nome, f.representante AS fornecedor_rep,
             c.numero AS contrato_numero
      FROM medicoes m
      LEFT JOIN empresas     e ON e.id = m.empresa_id
      LEFT JOIN obras        o ON o.id = m.obra_id
      LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
      LEFT JOIN contratos    c ON c.id = m.contrato_id
      WHERE m.id = $1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Medição não encontrada' });
    const med = r.rows[0];
    if (!['Aprovado','Em Assinatura'].includes(med.status))
      return res.status(400).json({ error: 'Medição não está aprovada' });

    // ── Helpers de formatação ───────────────────────────────────
    const fmt    = (v) => parseFloat(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtQtd = (v, un) => `${parseFloat(v||0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${un}`;
    const periodoLabel = (p) => {
      if (!p) return '—';
      const [y, m] = p.split('-');
      const meses = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return `${meses[parseInt(m)]}/${y}`;
    };

    // ── Monta texto do documento ────────────────────────────────
    const itensR = await db.query(
      'SELECT * FROM medicao_itens WHERE medicao_id=$1 ORDER BY ordem,id', [id]
    );
    const itens = itensR.rows;
    const itensTexto = itens.length
      ? itens.map((it, i) => [
          `  ${i+1}. ${it.descricao}`,
          `     Unidade: ${it.unidade} | Qtd Contratada: ${fmtQtd(it.qtd_contrato, it.unidade)}`,
          `     Anterior: ${fmtQtd(it.qtd_anterior, it.unidade)} | Este mês: ${fmtQtd(it.qtd_mes, it.unidade)} | Acumulado: ${fmtQtd(it.qtd_acumulada, it.unidade)}`,
          `     Valor Unit.: R$ ${fmt(it.valor_unitario)} | Valor do Item: R$ ${fmt(it.valor_item)}`,
        ].join('\n')).join('\n\n')
      : '  Conforme contrato vigente.';

    const linhasDoc = [
      `AUTORIZAÇÃO DE EMISSÃO DE NOTA FISCAL`,
      `${'='.repeat(58)}`,
      ``,
      `Empresa          : ${med.empresa_nome || '—'}`,
      `Obra             : ${med.obra_nome || '—'}`,
      `Fornecedor       : ${med.fornecedor_nome || '—'}`,
      `Contrato         : ${med.contrato_numero || '—'}`,
      `Código Medição   : ${med.codigo}`,
      `Período          : ${periodoLabel(med.periodo)}`,
      ``,
      `ITENS MEDIDOS NESTE PERÍODO`,
      `${'-'.repeat(58)}`,
      itensTexto,
      `${'-'.repeat(58)}`,
      ``,
      `VALOR AUTORIZADO PARA EMISSÃO DA NOTA FISCAL`,
      `Valor desta medição : R$ ${fmt(med.valor_medicao)}`,
      `Valor acumulado     : R$ ${fmt(med.valor_acumulado)}`,
      ``,
      `SERVIÇOS / OBSERVAÇÕES`,
      med.descricao || 'Conforme contrato vigente.',
      ``,
      `${'='.repeat(58)}`,
      `IMPORTANTE`,
      `A Nota Fiscal deverá ser emitida no valor de`,
      `R$ ${fmt(med.valor_medicao)} e incluir obrigatoriamente`,
      `o código ${med.codigo} no campo`,
      `"Observações / Dados Adicionais" da NF.`,
      `${'='.repeat(58)}`,
      ``,
      `Autorizado por : ${req.user.nome}`,
      `Data           : ${new Date().toLocaleDateString('pt-BR')}`,
    ];
    const docTexto = linhasDoc.join('\n');

    // ── Carrega configuração de assinatura ──────────────────────
    const cfgR = await db.query("SELECT valor FROM configuracoes WHERE chave='assinatura'");
    const cfgAssin = cfgR.rows[0]?.valor || {};

    let novoStatus = 'Em Assinatura';
    let destinatario = email_fornecedor;
    let clicksignKey = null;

    // ── Integração ClickSign (se configurado) ───────────────────
    if (cfgAssin.provedor === 'ClickSign' && cfgAssin.accessToken) {
      try {
        const PDFDocument = require('pdfkit');
        const clicksign   = require('../helpers/clicksign');

        // Gera PDF em memória
        const pdfBuffer = await new Promise((resolve, reject) => {
          const doc  = new PDFDocument({ margin: 50, size: 'A4', info: { Title: `Autorização NF — ${med.codigo}` } });
          const bufs = [];
          doc.on('data', c => bufs.push(c));
          doc.on('end',  () => resolve(Buffer.concat(bufs)));
          doc.on('error', reject);

          // Cabeçalho
          doc.font('Helvetica-Bold').fontSize(13).text('AUTORIZAÇÃO DE EMISSÃO DE NOTA FISCAL', { align: 'center' });
          doc.moveDown(0.3);
          doc.font('Helvetica').fontSize(9).text('='.repeat(80), { align: 'center' });
          doc.moveDown(0.8);

          // Dados
          const campos = [
            ['Empresa',         med.empresa_nome || '—'],
            ['Obra',            med.obra_nome    || '—'],
            ['Fornecedor',      med.fornecedor_nome || '—'],
            ['Contrato',        med.contrato_numero || '—'],
            ['Código Medição',  med.codigo],
            ['Período',         periodoLabel(med.periodo)],
          ];
          doc.font('Helvetica').fontSize(10);
          campos.forEach(([k, v]) => {
            doc.font('Helvetica-Bold').text(`${k}: `, { continued: true });
            doc.font('Helvetica').text(v);
          });

          // Itens
          if (itens.length) {
            doc.moveDown(0.8);
            doc.font('Helvetica-Bold').fontSize(10).text('ITENS MEDIDOS NESTE PERÍODO');
            doc.font('Helvetica').fontSize(9).text('-'.repeat(80));
            itens.forEach((it, i) => {
              doc.moveDown(0.3);
              doc.font('Helvetica-Bold').text(`${i+1}. ${it.descricao}`, { indent: 10 });
              doc.font('Helvetica').text(
                `Unidade: ${it.unidade}  |  Qtd Mês: ${fmtQtd(it.qtd_mes, it.unidade)}  |  Acumulado: ${fmtQtd(it.qtd_acumulada, it.unidade)}  |  Valor Item: R$ ${fmt(it.valor_item)}`,
                { indent: 20 }
              );
            });
          }

          // Valores e rodapé
          doc.moveDown(0.8);
          doc.font('Helvetica-Bold').fontSize(11).text(`Valor desta medição: R$ ${fmt(med.valor_medicao)}`);
          doc.font('Helvetica').fontSize(10).text(`Valor acumulado    : R$ ${fmt(med.valor_acumulado)}`);
          doc.moveDown(0.5);
          if (med.descricao) {
            doc.font('Helvetica-Bold').text('Observações:');
            doc.font('Helvetica').text(med.descricao);
            doc.moveDown(0.5);
          }
          doc.font('Helvetica').fontSize(9).text('='.repeat(80));
          doc.font('Helvetica-Bold').fontSize(9).text('IMPORTANTE: ', { continued: true });
          doc.font('Helvetica').text(
            `A Nota Fiscal deverá ser emitida no valor de R$ ${fmt(med.valor_medicao)} ` +
            `e incluir obrigatoriamente o código ${med.codigo} no campo "Observações / Dados Adicionais" da NF.`
          );
          doc.moveDown(1);
          doc.font('Helvetica').fontSize(9)
            .text(`Autorizado por: ${req.user.nome}   |   Data: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'right' });
          doc.end();
        });

        const baseUrl  = cfgAssin.ambiente === 'producao'
          ? 'https://app.clicksign.com'
          : 'https://sandbox.clicksign.com';
        const docPath  = `/HAMOA/medicao-${med.codigo}-${Date.now()}.pdf`;
        const pdfB64   = pdfBuffer.toString('base64');

        // Define auths conforme canal selecionado
        const auths = [];
        if (viaEmail)    auths.push('email');
        if (viaWhatsapp) auths.push('whatsapp');

        const result = await clicksign.enviarParaAssinatura(
          { accessToken: cfgAssin.accessToken, baseUrl },
          {
            pdfBase64:   pdfB64,
            docPath,
            signerEmail: email_fornecedor || undefined,
            signerPhone: tel_fornecedor   || undefined,
            signerName:  med.fornecedor_rep || med.fornecedor_nome || 'Representante',
            auths,
            message:     `Prezado(a), por favor assine a Autorização de Emissão de Nota Fiscal referente à medição ${med.codigo} da obra ${med.obra_nome}. Valor: R$ ${fmt(med.valor_medicao)}.`,
          }
        );
        clicksignKey = result.documentKey;
        novoStatus   = 'Em Assinatura';

        // Salva chave do documento ClickSign na medição
        await db.query("UPDATE medicoes SET obs_interna=COALESCE(obs_interna,'')||$1 WHERE id=$2",
          [`\n[ClickSign doc: ${clicksignKey}]`, id]);

      } catch (csErr) {
        console.error('[ClickSign]', csErr);
        return res.status(502).json({ error: 'Falha ao enviar para ClickSign: ' + csErr.message });
      }
    }

    // ── Atualiza status e registra histórico ────────────────────
    if (med.status === 'Aprovado') {
      await db.query("UPDATE medicoes SET status=$1 WHERE id=$2", [novoStatus, id]);
    }
    await db.query(
      'INSERT INTO aprovacoes(medicao_id,nivel,acao,usuario,comentario) VALUES($1,$2,$3,$4,$5)',
      [id, 'Sistema', 'lançado', req.user.nome,
       `Documento enviado para assinatura (${cfgAssin.provedor || 'manual'}) — Destinatário: ${email_fornecedor}${tel_fornecedor ? ' / '+tel_fornecedor : ''}${clicksignKey ? ' | ClickSign key: '+clicksignKey : ''}`]
    );

    res.json({
      ok:           true,
      novoStatus,
      docTexto,
      destinatario,
      clicksignKey,
      provedor: cfgAssin.provedor || 'manual',
    });
  } catch (e) {
    console.error('[enviar-assinatura]', e);
    res.status(500).json({ error: e.message || 'Erro interno' });
  }
});

// ── Upload de evidências ──────────────────────────────────────────

router.post('/:id/evidencias', auth, upload.array('files', 20), async (req, res) => {
  const medicaoId = parseInt(req.params.id);
  const inserted  = [];
  for (const file of req.files || []) {
    const ext  = path.extname(file.originalname).toLowerCase();
    const tipo = ['.jpg','.jpeg','.png','.gif'].includes(ext) ? 'img'
               : ['.pdf'].includes(ext) ? 'pdf'
               : ['.mp4','.mov','.avi'].includes(ext) ? 'video'
               : 'doc';
    const r = await db.query(
      'INSERT INTO evidencias(medicao_id,nome,tipo,tamanho,caminho) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [medicaoId, file.originalname, tipo, (file.size/1024/1024).toFixed(1)+'MB', file.filename]
    );
    inserted.push(r.rows[0]);
  }
  res.status(201).json(inserted);
});

module.exports = router;
