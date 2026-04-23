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

  _statusBadge(s) {
    const c = this._statusColor(s);
    const b = this._statusBg(s);
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.3px;color:${c};background:${b}">
      <span style="width:5px;height:5px;border-radius:50%;background:${c};flex-shrink:0"></span>${s || '—'}
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
        <div class="sc-lbl">Integrado ERP</div>
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

    // Guarda validações no cache local para o modal de detalhe
    this._validacoesPorId = {};
    nfs.forEach(n => {
      if (n.validacoes) this._validacoesPorId[n.id] = n.validacoes;
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

  // ── Modal de atualização de status ────────────────────────────
  abrirModal(id) {
    this._nfAtual = id;
    H.el('fin-modal-nf-numero').textContent = '…';
    H.el('fin-modal-forn').textContent = '…';
    H.el('fin-modal-obs').value = '';

    // Lê dados da linha correspondente (workaround sem re-fetch)
    const btn = H.el('fin-table').querySelector(`button[onclick="Financeiro.abrirModal(${id})"]`);
    if (btn) {
      const tr = btn.closest('tr');
      const cells = tr?.querySelectorAll('td');
      if (cells) {
        // Coluna 1 = NF/Arquivo: primeiro div é o número
        H.el('fin-modal-nf-numero').textContent = cells[1]?.querySelector('div')?.textContent?.trim() || String(id);
        // Coluna 2 = Fornecedor: primeiro div é o nome
        H.el('fin-modal-forn').textContent = cells[2]?.querySelector('div')?.textContent?.trim() || '';
        // Status: texto do badge (outer span contém o texto do status)
        const statusAtual = cells[0]?.querySelector('span[style*="border-radius:20px"]')?.textContent?.trim();
        const sel = H.el('fin-modal-status');
        if (sel && statusAtual) {
          Array.from(sel.options).forEach(o => { o.selected = o.value === statusAtual; });
        }
      }
    }
    UI.openModal('modal-fin-status');
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

  async salvarStatus() {
    const id        = this._nfAtual;
    const status    = H.el('fin-modal-status').value;
    const obs       = H.el('fin-modal-obs').value.trim();
    if (!id || !status) return;

    try {
      await API.finUpdateStatus(id, { status_fin: status, processado_obs: obs || null });
      UI.toast('Status atualizado!', 'success');
      UI.closeModal('modal-fin-status');
      await this.load(); // recarrega tabela + stats
    } catch(e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  },
};
