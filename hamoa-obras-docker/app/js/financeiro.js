'use strict';
// ══════════════════════════════════════
// FINANCEIRO — Fila de NFs / Backoffice
// ══════════════════════════════════════

const Financeiro = {
  _nfAtual: null,
  _validacoesPorId: {}, // cache local: id → array de validações

  // ── Status helpers ─────────────────────────────────────────────
  _statusColor(s) {
    return {
      'Pendente':         'var(--yellow)',
      'Em Processamento': 'var(--blue)',
      'Integrado ERP':    'var(--teal)',
      'Pago':             'var(--green)',
    }[s] || 'var(--text3)';
  },

  _statusBg(s) {
    return {
      'Pendente':         'rgba(234,179,8,.12)',
      'Em Processamento': 'rgba(59,130,246,.12)',
      'Integrado ERP':    'rgba(20,184,166,.12)',
      'Pago':             'rgba(34,197,94,.12)',
    }[s] || '#f1f5f9';
  },

  // Rótulo exibido (o valor armazenado continua 'Integrado ERP')
  _statusLabel(s) {
    return s === 'Integrado ERP' ? 'Aprovado e Integrado' : (s || '—');
  },

  _statusBadge(s) {
    const c = this._statusColor(s);
    const b = this._statusBg(s);
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.3px;color:${c};background:${b}">
      <span style="width:5px;height:5px;border-radius:50%;background:${c};flex-shrink:0"></span>${this._statusLabel(s)}
    </span>`;
  },

  // ── Carrega fila com filtros ───────────────────────────────────
  async load() {
    const filters = {
      empresa_id:    H.el('fin-f-empresa')?.value    || '',
      obra_id:       H.el('fin-f-obra')?.value       || '',
      fornecedor_id: H.el('fin-f-fornecedor')?.value || '',
      status_fin:    H.el('fin-f-status')?.value     || '',
      periodo:       H.el('fin-f-periodo')?.value    || '',
    };

    // Remove filtros vazios
    Object.keys(filters).forEach(k => { if (!filters[k]) delete filters[k]; });

    const tbl = H.el('fin-table');
    tbl.innerHTML = '<div style="padding:48px;text-align:center;color:var(--text3);font-size:13px">Carregando…</div>';

    try {
      const [stats, nfs] = await Promise.all([API.finStats(), API.finFila(filters)]);
      this._renderStats(stats);
      this._renderTabela(nfs);

      // Badge no menu
      const nb = H.el('nb-financeiro');
      const pendentes = parseInt(stats.pendente || 0) + parseInt(stats.em_processamento || 0);
      if (nb) { nb.textContent = pendentes; nb.style.display = pendentes > 0 ? 'inline' : 'none'; }
    } catch(e) {
      tbl.innerHTML = `<div style="padding:24px;color:var(--red)">${e.message}</div>`;
    }
  },

  // ── Cards de resumo ────────────────────────────────────────────
  _renderStats(s) {
    const fmt = v => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    H.el('fin-stats').innerHTML = `
      <div class="sc" style="--sc-color:var(--yellow)">
        <div class="sc-lbl">Pendentes</div>
        <div class="sc-val" style="color:var(--yellow)">${s.pendente || 0}</div>
        <div class="sc-sub">R$ ${fmt(s.valor_pendente)}</div>
      </div>
      <div class="sc" style="--sc-color:var(--blue)">
        <div class="sc-lbl">Em Processamento</div>
        <div class="sc-val" style="color:var(--blue)">${s.em_processamento || 0}</div>
        <div class="sc-sub">R$ ${fmt(s.valor_em_proc)}</div>
      </div>
      <div class="sc" style="--sc-color:var(--teal)">
        <div class="sc-lbl">Aprovado e Integrado</div>
        <div class="sc-val" style="color:var(--teal)">${s.integrado_erp || 0}</div>
        <div class="sc-sub">R$ ${fmt(s.valor_integrado)}</div>
      </div>
      <div class="sc" style="--sc-color:var(--green)">
        <div class="sc-lbl">Pago</div>
        <div class="sc-val" style="color:var(--green)">${s.pago || 0}</div>
        <div class="sc-sub">R$ ${fmt(s.valor_pago)}</div>
      </div>
    `;
  },

  // ── Tabela de NFs ─────────────────────────────────────────────
  _renderTabela(nfs) {
    const tbl = H.el('fin-table');
    if (!nfs.length) {
      tbl.innerHTML = `
        <div style="padding:56px 24px;text-align:center;color:var(--text3)">
          <div style="font-size:36px;margin-bottom:12px;opacity:.5">📭</div>
          <div style="font-size:14px">Nenhuma NF encontrada com os filtros selecionados.</div>
        </div>`;
      return;
    }

    const fmt  = v => 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtD = v => v ? new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const per  = v => { if (!v) return '—'; const [y,m] = v.split('-'); const ms = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']; return `${ms[parseInt(m)]}/${y.slice(2)}`; };
    const esc  = v => (v || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Guarda validações + a NF inteira no cache local para o modal de detalhe
    this._validacoesPorId = {};
    this._nfsPorId        = {};
    nfs.forEach(n => {
      if (n.validacoes) this._validacoesPorId[n.id] = n.validacoes;
      this._nfsPorId[n.id] = n;
    });

    tbl.innerHTML = `
      <div class="tb-bar" style="padding:12px 16px">
        <span class="tb-bar-title">${nfs.length} NOTA${nfs.length !== 1 ? 'S' : ''} FISCAL${nfs.length !== 1 ? 'IS' : ''}</span>
      </div>
      <div style="overflow-x:auto">
      <table style="table-layout:auto">
        <thead>
          <tr>
            <th style="width:130px">Status</th>
            <th>NF / Arquivo</th>
            <th>Fornecedor</th>
            <th>Obra / Medição</th>
            <th style="text-align:right">Valores</th>
            <th>Datas</th>
            <th style="width:110px;text-align:center">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${nfs.map(n => {
            const nfNum   = esc(n.numero_nf) || '—';
            const arquivo = esc(n.nome_arquivo || '');
            const arqShort = arquivo.length > 22 ? arquivo.slice(0, 22) + '…' : arquivo;
            const xmlDis  = !n.tem_xml;

            // Divergências
            const vals = n.validacoes || [];
            const nErros  = vals.filter(v => v.nivel === 'erro').length;
            const nAvisos = vals.filter(v => v.nivel === 'aviso').length;
            const divBadges = vals.length ? `
              <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:5px">
                ${nErros  ? `<button onclick="Financeiro.verDivergencias(${n.id})" style="border:none;cursor:pointer;background:rgba(239,68,68,.12);color:var(--red);border-radius:12px;padding:2px 7px;font-size:9px;font-weight:700;letter-spacing:.3px">❌ ${nErros} ERRO${nErros>1?'S':''}</button>` : ''}
                ${nAvisos ? `<button onclick="Financeiro.verDivergencias(${n.id})" style="border:none;cursor:pointer;background:rgba(234,179,8,.12);color:var(--yellow);border-radius:12px;padding:2px 7px;font-size:9px;font-weight:700;letter-spacing:.3px">⚠ ${nAvisos} AVISO${nAvisos>1?'S':''}</button>` : ''}
              </div>` : '';

            return `
            <tr style="vertical-align:middle">
              <td>
                ${this._statusBadge(n.status_fin)}
                ${divBadges}
                ${n.processado_obs ? `<div style="font-size:10px;color:var(--text3);margin-top:4px;max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(n.processado_obs)}">💬 ${esc(n.processado_obs)}</div>` : ''}
              </td>
              <td>
                <div style="font-family:var(--font-m);font-size:12px;font-weight:600;color:var(--text1)">${nfNum !== '—' ? nfNum : '<span style="color:var(--text3);font-weight:400">Sem número</span>'}</div>
                <div style="font-size:10px;color:var(--text3);margin-top:2px">📄 ${arqShort}</div>
              </td>
              <td>
                <div class="tp" style="font-size:12px;font-weight:500;max-width:170px">${esc(n.fornecedor_nome)}</div>
                <div style="font-family:var(--font-m);font-size:10px;color:var(--text3);margin-top:2px">${esc(n.fornecedor_cnpj) || ''}</div>
              </td>
              <td>
                <div class="tp" style="font-size:12px;max-width:160px">${esc(n.obra_nome)}</div>
                <div style="margin-top:3px;display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                  <span class="cc" style="font-size:10px">${esc(n.medicao_codigo)}</span>
                  <span style="font-size:10px;color:var(--text3)">${per(n.periodo)}</span>
                </div>
              </td>
              <td style="text-align:right">
                <div style="font-family:var(--font-m);font-size:12px;font-weight:600;color:var(--text1)">${n.valor_nf != null ? fmt(n.valor_nf) : '<span style="color:var(--text3);font-weight:400">—</span>'}</div>
                <div style="font-size:10px;color:var(--text3);margin-top:2px">Med: ${fmt(n.valor_medicao)}</div>
              </td>
              <td>
                <div style="font-size:10px;color:var(--text2)">
                  <div>📤 ${fmtD(n.enviado_em)}</div>
                  ${n.processado_por ? `<div style="margin-top:3px;color:var(--text3)" title="${fmtD(n.processado_em)}">✅ ${esc(n.processado_por)}</div>` : ''}
                </div>
              </td>
              <td style="text-align:center">
                <div style="display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:nowrap">
                  <button
                    onclick="Financeiro.abrirModal(${n.id})"
                    title="Atualizar status"
                    style="border:none;background:var(--accent);color:#fff;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0"
                  >✏</button>
                  <button
                    onclick="Financeiro.baixarArquivo(${n.id}, '${esc(n.nome_arquivo).replace(/'/g,"\\'")}' )"
                    title="Baixar arquivo da NF"
                    style="border:none;background:var(--surface2,#e2e8f0);color:var(--text1);border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0"
                  >📄</button>
                  <button
                    onclick="${xmlDis ? '' : `Financeiro.baixarXml(${n.id}, '${esc(n.numero_nf || '').replace(/'/g,"\\'")}' )`}"
                    title="${xmlDis ? 'XML disponível somente quando o fornecedor usou extração por IA' : 'Baixar XML NFS-e ABRASF 2.01'}"
                    ${xmlDis ? 'disabled' : ''}
                    style="border:none;background:${xmlDis ? 'var(--surface2,#e2e8f0)' : 'rgba(20,184,166,.12)'};color:${xmlDis ? 'var(--text3)' : 'var(--teal)'};border-radius:6px;width:28px;height:28px;cursor:${xmlDis ? 'default' : 'pointer'};font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;${xmlDis ? 'opacity:.45' : ''}"
                  >📋</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    `;
  },

  _fileUrl(n) {
    if (n.url_storage) return n.url_storage;
    if (n.provider === 'local' || !n.provider) return `/uploads/${n.caminho}`;
    return null; // S3 privado — precisa de rota autenticada
  },

  // ── Download autenticado (usa token da sessão) ─────────────────
  _downloadAutenticado(url, nomeArquivo) {
    const token = sessionStorage.getItem('construtivo_token');
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nomeArquivo || 'download';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      })
      .catch(e => UI.toast('Erro no download: ' + e.message, 'error'));
  },

  baixarArquivo(nfId, nomeArquivo) {
    this._downloadAutenticado(`/api/portal/nfs/${nfId}/arquivo`, nomeArquivo);
  },

  baixarXml(nfId, numeroNf) {
    this._downloadAutenticado(`/api/portal/nfs/${nfId}/xml`, `nfse-${numeroNf || nfId}.xml`);
  },

  // ── Painel de análise da NF ───────────────────────────────────
  async abrirModal(id) {
    this._nfAtual = id;
    const body = H.el('fin-modal-body');
    if (body) body.innerHTML = '<div style="padding:48px;text-align:center;color:var(--text3)">⏳ Carregando…</div>';
    UI.openModal('modal-fin-status');
    try {
      const nf = await API.finNfDetalhe(id);
      this._nfDetalhe = nf;
      if (body) body.innerHTML = this._renderModalBody(nf);
      const venc = H.el('fin-uau-vencimento');
      if (venc) venc.value = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    } catch (e) {
      if (body) body.innerHTML = `<div style="padding:24px;color:var(--red)">Erro ao carregar: ${e.message}</div>`;
    }
  },

  _renderModalBody(nf) {
    const esc   = v => (v == null ? '' : String(v)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const money = v => v == null ? '—' : 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dt    = v => v ? new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    const per   = v => { if (!v) return '—'; const [y,m] = v.split('-'); const ms=['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']; return `${ms[parseInt(m)]||m}/${y}`; };
    const cnpj  = v => { const d=String(v||'').replace(/\D/g,''); return d.length===14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,'$1.$2.$3/$4-$5') : (esc(v)||'—'); };

    const row = (label, val, strong) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:11px;color:var(--text3)">${label}</span>
      <span style="font-size:12px;color:var(--text1);text-align:right;${strong?'font-weight:700':''}">${val}</span></div>`;
    const sec = (titulo, conteudo) => `<div style="margin-bottom:14px">
      <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${titulo}</div>
      ${conteudo}</div>`;

    const header = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:2px solid var(--border)">
      <div style="min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--text1)">NF ${esc(nf.numero_nf)||'(sem número)'} · ${money(nf.valor_nf)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${esc(nf.fornecedor_nome)} · ${cnpj(nf.fornecedor_cnpj)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">📄 ${esc(nf.nome_arquivo)} · enviada ${dt(nf.enviado_em)}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">${this._statusBadge(nf.status_fin)}</div>
    </div>`;

    const medSec = sec('Medição',
      row('Código', esc(nf.medicao_codigo), true) +
      row('Status no Construtivo', esc(nf.medicao_status)) +
      row('Tipo', esc(nf.medicao_tipo || 'Normal')) +
      row('Valor da medição', money(nf.valor_medicao)) +
      row('Período', per(nf.periodo)) +
      row('Obra', esc(nf.obra_nome)) +
      row('Empresa', esc(nf.empresa_nome)) +
      row('Contrato', esc(nf.contrato_numero || '—')));

    const uauSec = sec('Integração UAU (ERP)',
      row('Nº Medição UAU', nf.uau_medicao_id ? `<b>${esc(nf.uau_medicao_id)}</b>` : '<span style="color:var(--yellow)">não integrada</span>') +
      row('Nº Processo de Pagamento', nf.uau_processo_pagamento ? `<b>${esc(nf.uau_processo_pagamento)}</b>` : '—') +
      row('Cód. Fornecedor UAU', esc(nf.uau_codigo_fornecedor || '—')) +
      row('Integrada em', dt(nf.uau_integrado_em)));

    const aprs = nf.aprovacoes || [];
    const aprHtml = aprs.length
      ? aprs.map(a => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
          <span class="rbadge r${esc(a.nivel)}" style="font-size:9px;padding:1px 6px">${esc(a.nivel)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;color:var(--text1);font-weight:600">${esc(a.usuario)} <span style="font-weight:400;color:var(--text3)">· ${a.acao==='aprovado'?'aprovou':esc(a.acao)}</span></div>
            ${a.comentario ? `<div style="font-size:10px;color:var(--text3)">💬 ${esc(a.comentario)}</div>` : ''}
          </div>
          <span style="font-size:10px;color:var(--text3);white-space:nowrap">${dt(a.data_hora)}</span>
        </div>`).join('')
      : '<div style="font-size:12px;color:var(--text3);font-style:italic">Nenhuma aprovação registrada.</div>';
    const alcSec = sec('Trilha de aprovação (alçadas)', aprHtml);

    const d = nf.dados_nfse || {};
    const chave = nf.chave_nfe || nf.codigo_verificacao || d.chaveAcesso || d.codigoVerificacao || '—';
    const nomeEsc = esc(nf.nome_arquivo).replace(/'/g, "\\'");
    const notaSec = sec('Nota fiscal',
      row('Número', esc(nf.numero_nf || '—')) +
      row('Chave / Cód. verificação', esc(chave)) +
      `<div style="display:flex;gap:8px;margin-top:10px">
        ${nf.url_view ? `<button class="btn btn-o btn-sm" onclick="window.open('${esc(nf.url_view)}','_blank')">📄 Abrir nota</button>` : ''}
        <button class="btn btn-o btn-sm" onclick="Financeiro.baixarArquivo(${nf.id}, '${nomeEsc}')">⬇ Baixar</button>
      </div>`);

    const vals = nf.validacoes || [];
    const valHtml = vals.length
      ? vals.map(v => `<div style="display:flex;gap:8px;padding:6px 8px;border-radius:6px;margin-bottom:4px;background:${v.nivel==='erro'?'rgba(239,68,68,.08)':'rgba(234,179,8,.08)'}">
          <span>${v.nivel==='erro'?'❌':'⚠️'}</span><span style="font-size:11px;color:var(--text2)">${esc(v.msg)}</span></div>`).join('')
      : '<div style="font-size:12px;color:var(--green)">✅ Sem divergências registradas.</div>';
    const valSec = sec('Validações da IA', valHtml);

    // Ação contextual conforme o estado da NF
    let acaoHtml;
    if (nf.status_fin === 'Pago') {
      acaoHtml = `<div style="padding:12px 14px;border-radius:8px;background:rgba(34,197,94,.10);color:var(--green);font-size:13px;font-weight:600">✅ Pagamento confirmado. Nenhuma ação pendente.</div>`;
    } else if (nf.status_fin === 'Integrado ERP') {
      acaoHtml = `
        <div id="fin-uau-feedback" style="display:none;margin-bottom:8px;padding:8px 12px;border-radius:6px;font-size:12px;line-height:1.5"></div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px">✅ Aprovado e integrado no UAU${nf.uau_processo_pagamento?` — processo <b>${esc(nf.uau_processo_pagamento)}</b>`:''}. Quando o pagamento for efetivado, registre abaixo.</div>
        <button class="btn btn-a btn-sm" id="fin-pago-btn" style="background:#15803d" onclick="Financeiro.marcarPago()">💲 Marcar como Pago</button>`;
    } else {
      acaoHtml = `
        <div id="fin-uau-feedback" style="display:none;margin-bottom:8px;padding:8px 12px;border-radius:6px;font-size:12px;line-height:1.5"></div>
        <div style="margin-bottom:8px">
          <label class="fl" style="font-size:11px">Vencimento da parcela</label>
          <input type="date" class="fi" id="fin-uau-vencimento">
          <div style="font-size:10px;color:var(--text3);margin-top:3px">Usado só quando o processo ainda não existe. Padrão: hoje + 30 dias.</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-o btn-sm" onclick="Financeiro.vincularNfUAU(true)">🔍 Pré-visualizar</button>
          <button class="btn btn-a btn-sm" id="fin-uau-btn" style="background:#16a34a" onclick="Financeiro.vincularNfUAU(false)">🔗 Aprovar e Integrar</button>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:6px">Gera o processo de pagamento (se necessário), pergunta se vincula a nota, e marca como “Aprovado e Integrado” — o fornecedor acompanha pelo portal.</div>`;
    }
    const controles = `
      <div id="fin-uau-block" style="border-top:2px solid var(--border);margin-top:6px;padding-top:12px">
        <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Ação</div>
        ${acaoHtml}
      </div>`;

    return header + medSec + uauSec + alcSec + notaSec + valSec + controles;
  },

  // ── Integração UAU: gera processo (se preciso) e vincula a NFS-e ──
  _uauFeedback(html, bg) {
    const fb = H.el('fin-uau-feedback');
    if (!fb) return;
    fb.style.display = '';
    fb.style.background = bg || 'var(--surface2)';
    fb.innerHTML = html;
  },

  async vincularNfUAU(dryRun) {
    const id = this._nfAtual;
    if (!id) return;

    // Ao confirmar a ação real, pergunta se também vincula a nota fiscal.
    // OK = gera processo + vincula nota · Cancelar = gera somente o processo.
    let vincularNota = true;
    if (!dryRun) {
      vincularNota = confirm(
        'Vincular a nota no processo de pagamento?\n\n' +
        '• OK → gera o processo E vincula a nota fiscal\n' +
        '• Cancelar → gera SOMENTE o processo (sem a nota)\n\n' +
        '(Para abortar, feche este aviso e o modal sem clicar de novo.)'
      );
    }

    const btn = H.el('fin-uau-btn');
    if (btn && !dryRun) { btn.disabled = true; btn.textContent = '⏳ Processando...'; }
    this._uauFeedback('⏳ Processando…', 'var(--surface2)');

    const dataVencimento = H.el('fin-uau-vencimento')?.value || undefined;
    try {
      const r = await API.uauVincularNf(id, { dryRun, dataVencimento, vincularNota });
      if (dryRun) {
        this._uauFeedback(
          `<b>Pré-visualização</b> ${r.processoExiste ? '(processo já existe)' : '(vai gerar processo)'}:` +
          `<pre style="white-space:pre-wrap;font-size:10px;max-height:220px;overflow:auto;margin:6px 0 0">${JSON.stringify(r.payloads, null, 2)}</pre>`,
          'rgba(59,130,246,.10)');
      } else {
        const msg = r.notaVinculada
          ? `✅ NFS-e vinculada — processo <b>${r.numeroProcesso}</b>${r.processoGerado ? ' (gerado agora)' : ''}.`
          : `✅ Processo <b>${r.numeroProcesso}</b> gerado${r.processoGerado ? ' agora' : ''}. Nota <b>não</b> vinculada.`;
        this._uauFeedback(msg, 'rgba(34,197,94,.12)');
        UI.toast(r.notaVinculada ? 'NF vinculada ao pagamento no UAU!' : 'Processo gerado no UAU!', 'success');
        setTimeout(() => { UI.closeModal('modal-fin-status'); this.load(); }, 1600);
      }
    } catch (e) {
      this._uauFeedback('❌ ' + (e.message || 'Erro ao processar'), 'rgba(239,68,68,.12)');
    } finally {
      if (btn && !dryRun) { btn.disabled = false; btn.textContent = '🔗 Aprovar e Integrar'; }
    }
  },

  // ── Marcar a NF como Paga (propaga p/ medição + notifica aprovadores) ──
  async marcarPago() {
    const id = this._nfAtual;
    if (!id) return;
    if (!confirm('Confirmar que esta NF foi PAGA?\nIsso marca a medição como Paga e notifica os aprovadores.')) return;
    const btn = H.el('fin-pago-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Registrando...'; }
    try {
      await API.finUpdateStatus(id, { status_fin: 'Pago' });
      UI.toast('NF marcada como Paga!', 'success');
      UI.closeModal('modal-fin-status');
      await this.load();
    } catch (e) {
      this._uauFeedback('❌ ' + (e.message || 'Erro ao marcar como pago'), 'rgba(239,68,68,.12)');
      if (btn) { btn.disabled = false; btn.textContent = '💲 Marcar como Pago'; }
    }
  },

  // ── Modal de divergências/validações ──────────────────────────
  verDivergencias(id) {
    const vals = this._validacoesPorId[id] || [];
    const esc  = v => (v || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const iconNivel = { erro: '❌', aviso: '⚠️', ok: '✅' };
    const bgNivel   = {
      erro:  'rgba(239,68,68,.08)',
      aviso: 'rgba(234,179,8,.08)',
      ok:    'rgba(34,197,94,.08)',
    };
    const corNivel  = {
      erro:  'var(--red)',
      aviso: 'var(--yellow)',
      ok:    'var(--green)',
    };
    const labelNivel = { erro: 'ERRO', aviso: 'AVISO', ok: 'OK' };

    H.el('fin-div-lista').innerHTML = vals.length
      ? vals.map(v => `
          <div style="display:flex;gap:10px;padding:12px 14px;border-radius:var(--r);background:${bgNivel[v.nivel]||'var(--surface2)'};border-left:3px solid ${corNivel[v.nivel]||'var(--border)'}">
            <div style="flex-shrink:0;font-size:15px;margin-top:1px">${iconNivel[v.nivel]||'•'}</div>
            <div style="flex:1">
              <div style="font-size:10px;font-weight:700;letter-spacing:.5px;color:${corNivel[v.nivel]||'var(--text3)'};margin-bottom:4px">${labelNivel[v.nivel]||v.nivel}${v.campo ? ` — ${esc(v.campo)}` : ''}</div>
              <div style="font-size:12px;color:var(--text1);line-height:1.5">${esc(v.msg)}</div>
            </div>
          </div>`).join('')
      : '<div style="padding:24px;text-align:center;color:var(--text3)">Nenhuma divergência registrada.</div>';

    UI.openModal('modal-fin-divergencias');
  },

  // ── Limpar filtros ─────────────────────────────────────────────
  _limparFiltros() {
    ['fin-f-empresa','fin-f-obra','fin-f-fornecedor','fin-f-status'].forEach(id => {
      const el = H.el(id); if (el) el.value = '';
    });
    const periodo = H.el('fin-f-periodo'); if (periodo) periodo.value = '';
    this.load();
  },

};
