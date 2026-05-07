/**
 * CONSTRUTIVO — Coloridão & Controle de Obra
 *
 * Aba 1 — Heatmap: cobertura de contratos por grupo/obra
 *   🔵 Azul    — todas as tarefas têm contrato
 *   🟢 Verde   — sem contrato, dentro do gatilho de compra
 *   🟡 Amarelo — prazo de gatilho vencido, atividade ainda não iniciou
 *   🔴 Vermelho — atividade já deveria ter iniciado sem contrato
 *   ⚫ Cinza   — sem contrato e sem gatilho definido
 *
 * Aba 2 — Lista de Compras: fila priorizada para suprimentos
 */

const Coloridao = {
  _data:              null,
  _pendencias:        null,
  _obras:             [],              // obras acessíveis ao usuário (cache)
  _cronogramas:       [],              // cronogramas da obra selecionada (cache)
  _nivel:             0,
  _maxNivel:          0,
  _aba:               'heatmap',
  _somenteCriticos:   false,
  _somenteSemContrato:false,
  _listaFiltroStatus: '',
  _listaFiltroResp:   '',
  _listaSort:         'urgencia',

  // ── Paleta ──────────────────────────────────────────────────
  _css: {
    azul:       { bg: 'rgba(37,99,235,.18)',  border: 'rgba(37,99,235,.5)',  text:'#2563eb',        icon: '🔵', label: 'Contratado'  },
    verde:      { bg: 'rgba(34,197,94,.18)',  border: 'rgba(34,197,94,.5)', text:'var(--green)',    icon: '🟢', label: 'No prazo'    },
    amarelo:    { bg: 'rgba(234,179,8,.18)',  border: 'rgba(234,179,8,.6)', text:'#ca8a04',         icon: '🟡', label: 'Atenção'     },
    vermelho:   { bg: 'rgba(239,68,68,.18)',  border: 'rgba(239,68,68,.5)', text:'var(--red)',      icon: '🔴', label: 'Crítico'     },
    cinza:      { bg: 'var(--bg2)',           border: 'var(--border)',       text:'var(--text3)',    icon: '⚫', label: 'Sem gatilho' },
    sem_tarefas:{ bg: 'var(--bg)',            border: 'var(--border)',       text:'var(--border)',   icon: '—',  label: 'Sem tarefas' },
  },

  // ── Helpers: valores dos selects compartilhados ─────────────
  _empId()  { return H.el('col-f-empresa')?.value || ''; },
  _obraId() { return H.el('col-f-obra')?.value    || ''; },
  _cronId() { return H.el('col-f-cron')?.value    || ''; },

  // ── Init ────────────────────────────────────────────────────
  async init() {
    await Promise.all([this._populaEmpresas(), this._populaObras()]);
    this._setAba('heatmap');
    await this.load();
  },

  async _populaEmpresas() {
    try {
      const emps = await API.empresas();
      const sel = H.el('col-f-empresa');
      if (!sel) return;
      sel.innerHTML = '<option value="">Todas as empresas</option>' +
        emps.map(e => `<option value="${e.id}">${H.esc(e.nome_fantasia || e.razao_social)}</option>`).join('');
    } catch (_) {}
  },

  async _populaObras(empresaId) {
    try {
      this._obras = (await API.obras(empresaId || undefined)) || [];
    } catch (_) { this._obras = []; }
    this._renderObraSelect();
  },

  _renderObraSelect() {
    const empId = this._empId();
    const sel   = H.el('col-f-obra');
    if (!sel) return;
    const lista = empId ? this._obras.filter(o => String(o.empresa_id) === empId) : this._obras;
    sel.innerHTML = '<option value="">Todas as obras</option>' +
      lista.map(o => `<option value="${o.id}">${H.esc(o.nome)}</option>`).join('');
    // Limpa cronograma ao trocar obras
    this._renderCronSelect([]);
  },

  async _populaCronogramas(obraId) {
    const sel = H.el('col-f-cron');
    if (!sel) return;
    if (!obraId) { this._renderCronSelect([]); return; }
    try {
      const crons = (await API.cronogramas(obraId)) || [];
      this._cronogramas = crons;
      this._renderCronSelect(crons);
    } catch (_) { this._renderCronSelect([]); }
  },

  _renderCronSelect(crons) {
    const sel = H.el('col-f-cron');
    if (!sel) return;
    this._cronogramas = crons;
    if (!crons.length) {
      sel.innerHTML = '<option value="">Versão mais recente</option>';
      sel.disabled  = true;
    } else {
      sel.disabled  = false;
      sel.innerHTML = '<option value="">Versão mais recente</option>' +
        crons.map(c => `<option value="${c.id}">${H.esc(c.nome || `v${c.versao}`)}</option>`).join('');
    }
  },

  // ── Handlers de mudança de filtro compartilhado ─────────────
  async onEmpresaChange() {
    // Reseta obra e cronograma
    H.el('col-f-obra') && (H.el('col-f-obra').value = '');
    H.el('col-f-cron') && (H.el('col-f-cron').value = '');
    await this._populaObras(this._empId());
    this._invalidar();
    this._recarregarAbaAtual();
  },

  async onObraChange() {
    H.el('col-f-cron') && (H.el('col-f-cron').value = '');
    await this._populaCronogramas(this._obraId());
    this._invalidar();
    this._recarregarAbaAtual();
  },

  onCronChange() {
    this._invalidar();
    this._recarregarAbaAtual();
  },

  // Invalida caches de ambas as abas
  _invalidar() {
    this._data      = null;
    this._pendencias = null;
  },

  // Recarrega a aba visível no momento
  _recarregarAbaAtual() {
    if (this._aba === 'lista') this.loadLista();
    else this.load();
  },

  // ↻ Atualizar: força reload na aba atual
  refresh() {
    this._invalidar();
    this._recarregarAbaAtual();
  },

  // ── Troca de aba ────────────────────────────────────────────
  _setAba(aba) {
    this._aba = aba;
    ['heatmap','lista'].forEach(a => {
      const btn = H.el(`col-tab-${a}`);
      const pnl = H.el(`col-panel-${a}`);
      if (btn) {
        btn.style.cssText = a === aba
          ? 'padding:7px 20px;border-radius:6px;border:1px solid var(--accent);background:rgba(var(--accent-rgb),.12);color:var(--accent);cursor:pointer;font-size:12px;font-weight:700'
          : 'padding:7px 20px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);cursor:pointer;font-size:12px;font-weight:600';
      }
      if (pnl) pnl.style.display = a === aba ? '' : 'none';
    });
  },

  switchAba(aba) {
    this._setAba(aba);
    if (aba === 'lista'   && !this._pendencias) this.loadLista();
    if (aba === 'heatmap' && !this._data)       this.load();
  },

  // ── Granularidade (heatmap) ─────────────────────────────────
  setNivel(n) {
    this._nivel = parseInt(n);
    this.load();
  },

  _updateNivelBtns(maxNivel) {
    const container = H.el('col-gran-btns');
    if (!container) return;
    if (this._nivel > maxNivel) this._nivel = 0;
    const labels = ['Macro', 'Nível 2', 'Nível 3', 'Nível 4', 'Nível 5', 'Nível 6'];
    let html = '';
    for (let i = 0; i <= Math.min(maxNivel, 5); i++) {
      const active = i === this._nivel ? ' col-gran-active' : '';
      html += `<button id="col-gran-${i}" onclick="Coloridao.setNivel(${i})" class="col-gran-btn${active}">${labels[i] || 'Nível '+(i+1)}</button>`;
    }
    container.innerHTML = html;
  },

  // ── Carrega heatmap ─────────────────────────────────────────
  async load() {
    this._somenteCriticos    = H.el('col-f-criticos')?.checked  || false;
    this._somenteSemContrato = H.el('col-f-sem-contrato')?.checked || false;

    H.el('col-loading')?.style && (H.el('col-loading').style.display = 'flex');
    H.el('col-content')  && (H.el('col-content').style.display = 'none');
    try {
      const params = { nivel: this._nivel };
      if (this._empId())  params.empresa_id    = this._empId();
      if (this._obraId()) params.obra_id        = this._obraId();
      if (this._cronId()) params.cronograma_id  = this._cronId();
      this._data = await API.coloridao(params);
      if (this._data?.maxNivel != null) {
        this._maxNivel = this._data.maxNivel;
        this._updateNivelBtns(this._maxNivel);
      }
      this._render(this._data);
    } catch (e) {
      UI.toast('Erro ao carregar Coloridão: ' + e.message, 'error');
    } finally {
      H.el('col-loading')?.style && (H.el('col-loading').style.display = 'none');
      H.el('col-content')  && (H.el('col-content').style.display = '');
    }
  },

  // ── Carrega lista de compras ─────────────────────────────────
  async loadLista() {
    const wrap = H.el('col-lista-body');
    if (wrap) wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Carregando lista de compras…</div>`;
    try {
      // Usa os filtros compartilhados (empresa/obra/cronograma)
      const params = {};
      if (this._empId())  params.empresa_id   = this._empId();
      if (this._obraId()) params.obra_id       = this._obraId();
      if (this._cronId()) params.cronograma_id = this._cronId();
      const resp = await API.coloridaoPendencias(params);
      this._pendencias = Array.isArray(resp) ? resp : [];
      this._populaFiltrosLista();
      this._renderLista();
    } catch (e) {
      UI.toast('Erro ao carregar pendências: ' + e.message, 'error');
      if (wrap) wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--red)">${H.esc(e.message)}</div>`;
    }
  },

  _populaFiltrosLista() {
    if (!this._pendencias) return;
    // Popula responsáveis únicos a partir dos dados retornados
    const resps = [...new Set(this._pendencias.map(p => p.responsavel).filter(Boolean))].sort();
    const selR = H.el('col-lista-f-resp');
    if (selR) {
      selR.innerHTML = '<option value="">Todos os responsáveis</option>' +
        resps.map(r => `<option value="${H.esc(r)}">${H.esc(r)}</option>`).join('');
    }
  },

  _renderLista() {
    const wrap = H.el('col-lista-body');
    if (!wrap || !this._pendencias) return;

    // Aplica filtros
    let rows = this._pendencias.filter(p => {
      if (this._listaFiltroStatus && p.status !== this._listaFiltroStatus) return false;
      if (this._listaFiltroResp   && p.responsavel !== this._listaFiltroResp)      return false;
      return true;
    });

    // Aplica ordenação
    if (this._listaSort === 'data_inicio') {
      rows = [...rows].sort((a,b) => (a.data_inicio||'').localeCompare(b.data_inicio||''));
    } else if (this._listaSort === 'data_limite') {
      rows = [...rows].sort((a,b) => {
        if (!a.data_limite && !b.data_limite) return 0;
        if (!a.data_limite) return 1;
        if (!b.data_limite) return -1;
        return a.data_limite.localeCompare(b.data_limite);
      });
    } else if (this._listaSort === 'custo') {
      rows = [...rows].sort((a,b) => {
        const ca = parseFloat((a.custo_servico||'0').replace(/[^\d.,-]/g,'').replace(',','.')) || 0;
        const cb = parseFloat((b.custo_servico||'0').replace(/[^\d.,-]/g,'').replace(',','.')) || 0;
        return cb - ca; // maior custo primeiro
      });
    }
    // 'urgencia' já vem ordenado da API

    const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString('pt-BR') : '—';

    // Badge de urgência
    const urgBadge = (p) => {
      const d = p.dias_ate_gatilho;
      if (p.status === 'vermelho') {
        const atraso = p.data_inicio
          ? Math.floor((new Date() - new Date(p.data_inicio + 'T00:00')) / 86400000)
          : null;
        return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
                             background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.4)">
                  🔴 Atrasado${atraso != null ? ` ${atraso}d` : ''}
                </span>`;
      }
      if (p.status === 'amarelo') {
        const cor   = d != null && d < 7 ? 'var(--red)' : '#ca8a04';
        const bgCor = d != null && d < 7 ? 'rgba(239,68,68,.1)' : 'rgba(234,179,8,.15)';
        const bord  = d != null && d < 7 ? 'rgba(239,68,68,.4)' : 'rgba(234,179,8,.5)';
        return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
                             background:${bgCor};color:${cor};border:1px solid ${bord}">
                  🟡 ${d != null ? `${d}d restantes` : 'Atenção'}
                </span>`;
      }
      if (p.status === 'verde') {
        return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
                             background:rgba(34,197,94,.12);color:var(--green);border:1px solid rgba(34,197,94,.4)">
                  🟢 ${d != null ? `${d}d restantes` : 'No prazo'}
                </span>`;
      }
      return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;
                           background:var(--bg2);color:var(--text3);border:1px solid var(--border)">
                ⚫ Sem gatilho
              </span>`;
    };

    // KPIs da lista filtrada
    const kpi = { vermelho:0, amarelo:0, verde:0, cinza:0 };
    rows.forEach(p => { if (kpi[p.status] != null) kpi[p.status]++; });

    const total = this._pendencias.length;
    const filtrados = rows.length;

    let html = `
      <!-- KPIs da lista -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
        <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid var(--red);cursor:pointer"
             onclick="Coloridao.filtrarLista('status','vermelho')">
          <div class="col-kpi-val" style="color:var(--red)">${kpi.vermelho}</div>
          <div class="col-kpi-lbl">🔴 Críticos</div>
        </div>
        <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid #eab308;cursor:pointer"
             onclick="Coloridao.filtrarLista('status','amarelo')">
          <div class="col-kpi-val" style="color:#ca8a04">${kpi.amarelo}</div>
          <div class="col-kpi-lbl">🟡 Atenção</div>
        </div>
        <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid var(--green);cursor:pointer"
             onclick="Coloridao.filtrarLista('status','verde')">
          <div class="col-kpi-val" style="color:var(--green)">${kpi.verde}</div>
          <div class="col-kpi-lbl">🟢 No prazo</div>
        </div>
        <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid var(--border);cursor:pointer"
             onclick="Coloridao.filtrarLista('status','cinza')">
          <div class="col-kpi-val" style="color:var(--text3)">${kpi.cinza}</div>
          <div class="col-kpi-lbl">⚫ Sem gatilho</div>
        </div>
        <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid var(--accent)">
          <div class="col-kpi-val" style="color:var(--accent)">${total}</div>
          <div class="col-kpi-lbl">Total pendências</div>
        </div>
      </div>`;

    if (!rows.length) {
      html += `<div style="padding:40px;text-align:center;color:var(--text3)">
        ${filtrados === 0 && total > 0 ? '🎯 Nenhum item com os filtros aplicados.' : '🎉 Nenhuma pendência de contratação!'}
      </div>`;
      wrap.innerHTML = html;
      return;
    }

    html += `<div style="font-size:11px;color:var(--text3);margin-bottom:8px">
      ${filtrados < total ? `Exibindo ${filtrados} de ${total} itens` : `${total} itens`}
      ${this._listaFiltroStatus || this._listaFiltroResp
        ? ` · <button onclick="Coloridao.limparFiltrosLista()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;padding:0">✕ Limpar filtros</button>`
        : ''}
    </div>`;

    html += `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="border-bottom:2px solid var(--border);background:var(--surface3)">
          <th style="padding:8px 10px;text-align:left;font-size:9px;color:var(--text3);letter-spacing:1px;white-space:nowrap">ATIVIDADE / GRUPO</th>
          <th style="padding:8px 10px;text-align:left;font-size:9px;color:var(--text3);letter-spacing:1px;white-space:nowrap">OBRA</th>
          <th style="padding:8px 10px;text-align:center;font-size:9px;color:var(--text3);letter-spacing:1px;white-space:nowrap;cursor:pointer"
              onclick="Coloridao.sortLista('data_inicio')" title="Ordenar por início">
            INÍCIO ${this._listaSort==='data_inicio'?'↑':''}
          </th>
          <th style="padding:8px 10px;text-align:center;font-size:9px;color:var(--text3);letter-spacing:1px;white-space:nowrap;cursor:pointer"
              onclick="Coloridao.sortLista('data_limite')" title="Ordenar por prazo limite">
            CONTRATAR ATÉ ${this._listaSort==='data_limite'?'↑':''}
          </th>
          <th style="padding:8px 10px;text-align:center;font-size:9px;color:var(--text3);letter-spacing:1px;white-space:nowrap;cursor:pointer"
              onclick="Coloridao.sortLista('urgencia')" title="Ordenar por urgência">
            URGÊNCIA ${this._listaSort==='urgencia'?'↑':''}
          </th>
          <th style="padding:8px 10px;text-align:left;font-size:9px;color:var(--text3);letter-spacing:1px;white-space:nowrap">RESPONSÁVEL</th>
          <th style="padding:8px 10px;text-align:right;font-size:9px;color:var(--text3);letter-spacing:1px;white-space:nowrap;cursor:pointer"
              onclick="Coloridao.sortLista('custo')" title="Ordenar por custo estimado">
            CUSTO ESTIMADO ${this._listaSort==='custo'?'↓':''}
          </th>
        </tr>
      </thead>
      <tbody>`;

    for (const p of rows) {
      const rowBg = p.status === 'vermelho' ? 'background:rgba(239,68,68,.04)' :
                    p.status === 'amarelo'  ? 'background:rgba(234,179,8,.04)'  : '';
      html += `<tr style="border-bottom:1px solid var(--border);${rowBg}">
        <td style="padding:8px 10px;max-width:280px">
          <div style="font-weight:600;font-size:12px;color:var(--text)">${H.esc(p.nome)}</div>
          ${p.grupo_pai ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">↳ ${H.esc(p.grupo_pai)}</div>` : ''}
          ${p.wbs ? `<div style="font-size:9px;color:var(--text3);margin-top:1px">WBS: ${H.esc(p.wbs)}</div>` : ''}
        </td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text2);white-space:nowrap">${H.esc(p.obra_nome || '—')}</td>
        <td style="padding:8px 10px;text-align:center;font-size:11px;color:var(--text2);white-space:nowrap">${fmtDate(p.data_inicio)}</td>
        <td style="padding:8px 10px;text-align:center;white-space:nowrap">
          ${p.data_limite
            ? `<span style="font-size:11px;font-weight:600;color:${p.status==='vermelho'?'var(--red)':p.status==='amarelo'?'#ca8a04':'var(--text2)'}">${fmtDate(p.data_limite)}</span>`
            : `<span style="color:var(--text3);font-size:11px">—</span>`}
        </td>
        <td style="padding:8px 10px;text-align:center">${urgBadge(p)}</td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text2)">
          ${p.responsavel ? H.esc(p.responsavel) : '<span style="color:var(--text3)">—</span>'}
          ${p.encarregado ? `<div style="font-size:10px;color:var(--text3)">Enc: ${H.esc(p.encarregado)}</div>` : ''}
        </td>
        <td style="padding:8px 10px;text-align:right;font-size:11px;white-space:nowrap">
          ${p.custo_servico
            ? `<span style="font-weight:600;color:var(--text)">${H.esc(p.custo_servico)}</span>`
            : `<span style="color:var(--text3)">—</span>`}
        </td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
    wrap.innerHTML = html;
  },

  // ── Filtros / Sort da lista ──────────────────────────────────
  filtrarLista(campo, valor) {
    if (campo === 'status') {
      this._listaFiltroStatus = this._listaFiltroStatus === valor ? '' : valor;
    } else if (campo === 'resp') {
      this._listaFiltroResp = valor;
    }
    this._renderLista();
  },

  onFiltroLista() {
    this._listaFiltroResp   = H.el('col-lista-f-resp')?.value   || '';
    this._listaFiltroStatus = H.el('col-lista-f-status')?.value || '';
    this._renderLista();
  },

  limparFiltrosLista() {
    this._listaFiltroStatus = '';
    this._listaFiltroResp   = '';
    ['col-lista-f-status','col-lista-f-resp'].forEach(id => { const el = H.el(id); if (el) el.value = ''; });
    this._renderLista();
  },

  sortLista(campo) {
    this._listaSort = campo;
    this._renderLista();
  },

  // ── Exportar CSV ─────────────────────────────────────────────
  exportarCSV() {
    if (!this._pendencias?.length) { UI.toast('Nenhum dado para exportar', 'error'); return; }

    let rows = this._pendencias.filter(p => {
      if (this._listaFiltroStatus && p.status !== this._listaFiltroStatus) return false;
      if (this._listaFiltroObra   && String(p.obra_id) !== this._listaFiltroObra) return false;
      if (this._listaFiltroResp   && p.responsavel !== this._listaFiltroResp) return false;
      return true;
    });

    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString('pt-BR') : '';

    const header = ['Status','Atividade','WBS','Grupo Pai','Obra','Início','Término','Contratar Até','Dias Restantes','Responsável','Encarregado JMD','Custo Estimado'];
    const linhas = rows.map(p => [
      p.status, p.nome, p.wbs, p.grupo_pai, p.obra_nome,
      fmtDate(p.data_inicio), fmtDate(p.data_termino), fmtDate(p.data_limite),
      p.dias_ate_gatilho != null ? p.dias_ate_gatilho : '',
      p.responsavel, p.encarregado, p.custo_servico,
    ].map(esc).join(';'));

    const csv  = '﻿' + [header.map(esc).join(';'), ...linhas].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `lista_compras_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    UI.toast('CSV exportado com sucesso!', 'success');
  },

  // ══════════════════════════════════════════════════════════════
  // HEATMAP
  // ══════════════════════════════════════════════════════════════

  _render(data) {
    this._renderKpis(data.kpis, data);
    this._renderHeatmap(data);
  },

  _renderKpis(kpis, data) {
    const pct = n => kpis.total ? Math.round(n / kpis.total * 100) : 0;
    const totalTarefas = (kpis.verde_tarefas||0) + (kpis.amarelo_tarefas||0) + (kpis.vermelho_tarefas||0);
    const pctT = n => totalTarefas ? Math.round(n / totalTarefas * 100) : 0;
    H.el('col-kpis').innerHTML = `
      <div class="col-kpi" style="border-left:4px solid #2563eb">
        <div class="col-kpi-val" style="color:#2563eb">${kpis.azul||0}</div>
        <div class="col-kpi-lbl">🔵 Contratado</div>
        <div class="col-kpi-pct">${pct(kpis.azul||0)}% dos grupos</div>
      </div>
      <div class="col-kpi" style="border-left:4px solid var(--green)">
        <div class="col-kpi-val" style="color:var(--green)">${kpis.verde_tarefas||0}</div>
        <div class="col-kpi-lbl">🟢 No prazo</div>
        <div class="col-kpi-pct">${pctT(kpis.verde_tarefas||0)}% das atividades · ${kpis.verde||0} grupos 100% ok</div>
      </div>
      <div class="col-kpi" style="border-left:4px solid #eab308">
        <div class="col-kpi-val" style="color:#ca8a04">${kpis.amarelo_tarefas||0}</div>
        <div class="col-kpi-lbl">🟡 Atenção</div>
        <div class="col-kpi-pct">${pctT(kpis.amarelo_tarefas||0)}% das atividades · ${kpis.amarelo||0} grupos</div>
      </div>
      <div class="col-kpi" style="border-left:4px solid var(--red)">
        <div class="col-kpi-val" style="color:var(--red)">${kpis.vermelho_tarefas||0}</div>
        <div class="col-kpi-lbl">🔴 Crítico</div>
        <div class="col-kpi-pct">${pctT(kpis.vermelho_tarefas||0)}% das atividades · ${kpis.vermelho||0} grupos</div>
      </div>
      <div class="col-kpi" style="border-left:4px solid var(--border)">
        <div class="col-kpi-val" style="color:var(--text3)">${kpis.cinza||0}</div>
        <div class="col-kpi-lbl">⚫ Sem gatilho</div>
        <div class="col-kpi-pct">${data?.obras?.length||0} obras · ${data?.grupos?.length||0} grupos</div>
      </div>`;
  },

  _renderHeatmap(data) {
    const { obras, grupos, matriz } = data;
    const container = H.el('col-heatmap');
    if (!container) return;

    if (!obras.length || !grupos.length) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Nenhum cronograma encontrado com os filtros aplicados.</div>`;
      return;
    }

    let gruposFiltrados = grupos;
    let obrasFiltradas  = obras;

    if (this._somenteCriticos)
      gruposFiltrados = grupos.filter(g => obras.some(o => matriz[o.id]?.[g]?.status === 'vermelho'));
    if (this._somenteSemContrato)
      gruposFiltrados = gruposFiltrados.filter(g => obras.some(o => ['vermelho','amarelo','cinza'].includes(matriz[o.id]?.[g]?.status)));

    if (!gruposFiltrados.length) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Nenhum grupo crítico encontrado — todos contratados! 🎉</div>`;
      return;
    }

    const rank   = { vermelho:5, amarelo:4, cinza:3, verde:2, azul:1, sem_tarefas:0 };
    const corBar = { vermelho:'var(--red)', amarelo:'#eab308', cinza:'var(--text3)', verde:'var(--green)', azul:'#2563eb', sem_tarefas:'var(--border)' };
    const empresas = [...new Map(obrasFiltradas.map(o=>[o.empresa_id,{id:o.empresa_id,nome:o.empresa_nome}])).values()];

    let html = `<div class="col-heatmap-wrap">
      <div class="col-legend">
        <strong style="font-size:10px;color:var(--text2);letter-spacing:.5px;align-self:center">LEGENDA:</strong>
        <span style="background:rgba(37,99,235,.18);border:1px solid rgba(37,99,235,.5)">🔵 Contratado</span>
        <span style="background:rgba(34,197,94,.18);border:1px solid rgba(34,197,94,.5)">🟢 No prazo — dentro do gatilho</span>
        <span style="background:rgba(234,179,8,.18);border:1px solid rgba(234,179,8,.6)">🟡 Atenção — gatilho vencido</span>
        <span style="background:rgba(239,68,68,.18);border:1px solid rgba(239,68,68,.5)">🔴 Crítico — atividade já iniciou</span>
        <span style="background:var(--bg2);border:1px solid var(--border)">⚫ Sem gatilho definido</span>
      </div>
      <div class="col-table-scroll"><table class="col-table">
        <thead>
          <tr><th class="col-th-grupo" rowspan="2">Agrupamento / Fase</th>`;

    for (const emp of empresas) {
      const n = obrasFiltradas.filter(o=>o.empresa_id===emp.id).length;
      html += `<th colspan="${n}" style="background:var(--bg2);font-size:10px;text-align:center;letter-spacing:.5px;color:var(--text3);border-bottom:1px solid var(--border);padding:4px 2px">${H.esc(emp.nome.toUpperCase())}</th>`;
    }
    html += `</tr><tr>`;
    for (const obra of obrasFiltradas)
      html += `<th class="col-th-obra" title="${H.esc(obra.nome)}">${H.esc(obra.nome)}</th>`;
    html += `</tr></thead><tbody>`;

    for (const grupo of gruposFiltrados) {
      const statusLinha = obrasFiltradas.reduce((pior, o) => {
        const st = matriz[o.id]?.[grupo]?.status || 'sem_tarefas';
        return (rank[st]||0) > (rank[pior]||0) ? st : pior;
      }, 'sem_tarefas');

      html += `<tr><td class="col-td-grupo">
        <span class="col-grupo-bar" style="background:${corBar[statusLinha]||'var(--border)'}"></span>${H.esc(grupo)}
      </td>`;

      for (const obra of obrasFiltradas) {
        const cel = matriz[obra.id]?.[grupo];
        if (!cel) { html += `<td class="col-cell" style="background:var(--bg);color:var(--border)">·</td>`; continue; }
        const s   = this._css[cel.status] || this._css.sem_tarefas;
        const tip = cel.status === 'sem_tarefas'
          ? 'Sem tarefas neste grupo'
          : `${cel.com_contrato}/${cel.total} contratadas · ${cel.vermelho} críticas · ${cel.amarelo} atenção · ${cel.verde} no prazo`;
        const verdeExtra = cel.verde > 0 && cel.status !== 'verde' && cel.status !== 'azul' && cel.status !== 'sem_tarefas'
          ? `<span class="col-cell-verde" title="${cel.verde} atividade(s) no prazo neste grupo">🟢${cel.verde}</span>` : '';
        html += `<td class="col-cell" style="background:${s.bg};border-color:${s.border};position:relative"
                    title="${H.esc(obra.nome)} — ${H.esc(grupo)}\n${tip}"
                    onclick="Coloridao._showDetail('${obra.id}','${grupo.replace(/'/g,"\\'")}')">
                  ${s.icon}
                  ${cel.status !== 'sem_tarefas' ? `<span class="col-cell-sub">${cel.com_contrato}/${cel.total}</span>` : ''}
                  ${verdeExtra}
                </td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table></div></div>`;
    container.innerHTML = html;
  },

  // ── Detalhe do heatmap ───────────────────────────────────────
  async _showDetail(obraId, grupoNome) {
    const obra = this._data?.obras?.find(o => String(o.id) === String(obraId));
    if (!obra) return;
    const cel = this._data?.matriz?.[obraId]?.[grupoNome];
    if (!cel) return;

    try {
      const crons = await API.cronogramas(parseInt(obraId));
      if (!crons?.length) { UI.toast('Nenhum cronograma para esta obra', 'error'); return; }

      const cronId = obra.cronograma_id || crons[0].id;
      const ativs  = await API.cronogramaAtividades(cronId);

      const grupoNode = ativs.find(a => a.nome === grupoNome && a.eh_resumo && !a.parent_id)
                     || ativs.find(a => a.nome === grupoNome && a.eh_resumo);
      if (!grupoNode) { UI.toast('Grupo não encontrado no cronograma', 'error'); return; }

      // Inclui folhas normais + resumos com gatilho_dias configurado (ex: marcos de início)
      const descendentes = this._getDescendentes(ativs, grupoNode.id).filter(a => !a.eh_resumo || a.gatilho_dias != null);
      const hoje = new Date(); hoje.setHours(0,0,0,0);
      const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString('pt-BR') : '—';

      const rows = descendentes.map(a => {
        const temContrato = (a.contratos_vinculados?.length || 0) > 0;
        const dataInicio  = a.data_inicio ? new Date(a.data_inicio + 'T00:00') : null;
        const gatilhoDias = a.gatilho_dias;

        let status;
        if (temContrato) status = 'azul';
        else if (dataInicio && hoje > dataInicio) status = 'vermelho';
        else if (dataInicio && gatilhoDias != null) {
          const gd = new Date(dataInicio); gd.setDate(gd.getDate() - gatilhoDias);
          status = hoje > gd ? 'amarelo' : 'verde';
        } else status = 'cinza';

        const s = this._css[status];

        // Badge de urgência destacado
        let urgencia = '';
        if (!temContrato) {
          if (status === 'vermelho') {
            const atraso = dataInicio ? Math.floor((hoje - dataInicio) / 86400000) : null;
            urgencia = `<div style="margin-top:4px">
              <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;
                           background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.4)">
                ⚠ Atrasado${atraso ? ` ${atraso} dias` : ''}
              </span>
            </div>`;
          } else if (status === 'amarelo' && gatilhoDias != null && dataInicio) {
            const gd = new Date(dataInicio); gd.setDate(gd.getDate() - gatilhoDias);
            const dias = Math.floor((gd - hoje) / 86400000);
            const urgCor  = dias < 7 ? 'var(--red)' : '#ca8a04';
            const urgBg   = dias < 7 ? 'rgba(239,68,68,.1)' : 'rgba(234,179,8,.12)';
            const urgBord = dias < 7 ? 'rgba(239,68,68,.4)' : 'rgba(234,179,8,.5)';
            urgencia = `<div style="margin-top:4px">
              <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;
                           background:${urgBg};color:${urgCor};border:1px solid ${urgBord}">
                ⏱ Contratar em ${dias <= 0 ? 'HOJE' : dias + ' dias'} · até ${fmtDate(gd.toISOString().slice(0,10))}
              </span>
            </div>`;
          } else if (status === 'verde' && gatilhoDias != null && dataInicio) {
            const gd = new Date(dataInicio); gd.setDate(gd.getDate() - gatilhoDias);
            const dias = Math.floor((gd - hoje) / 86400000);
            urgencia = `<div style="margin-top:4px">
              <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;
                           background:rgba(34,197,94,.1);color:var(--green);border:1px solid rgba(34,197,94,.3)">
                🟢 ${dias} dias restantes · contratar até ${fmtDate(gd.toISOString().slice(0,10))}
              </span>
            </div>`;
          }
        }

        const extras = a.campos_extras || {};
        const responsavel = extras['Responsável'] || extras['Responsavel'] || null;
        const custo       = extras['Custo do serviço'] || null;

        return `<tr style="border-bottom:1px solid var(--border)${status==='vermelho'?';background:rgba(239,68,68,.04)':status==='amarelo'?';background:rgba(234,179,8,.04)':''}">
          <td style="padding:7px 10px;max-width:220px">
            <div style="font-size:12px;font-weight:${status!=='azul'&&!temContrato?'600':'400'};word-break:break-word">${H.esc(a.nome)}</div>
            ${responsavel ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">👤 ${H.esc(responsavel)}</div>` : ''}
            ${urgencia}
          </td>
          <td style="padding:7px 10px;font-size:11px;color:var(--text2);text-align:center;white-space:nowrap">${fmtDate(a.data_inicio)}</td>
          <td style="padding:7px 10px;font-size:11px;color:var(--text2);text-align:center;white-space:nowrap">${fmtDate(a.data_termino)}</td>
          <td style="padding:7px 10px;font-size:11px;color:var(--text2);text-align:center">${gatilhoDias != null ? gatilhoDias + 'd' : '—'}</td>
          <td style="padding:7px 10px;text-align:center">
            <span style="background:${s.bg};color:${s.text};border:1px solid ${s.border};border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">${s.icon} ${s.label}</span>
          </td>
          <td style="padding:7px 10px;font-size:11px;color:var(--text2)">
            ${temContrato
              ? (a.contratos_vinculados?.map(c=>`<div>${H.esc(c.numero)} — ${H.esc(c.fornecedor||'')}</div>`).join(''))
              : (custo ? `<span style="color:var(--text3);font-size:10px">Est.: ${H.esc(custo)}</span>` : '<span style="color:var(--text3)">—</span>')}
          </td>
        </tr>`;
      }).join('');

      H.el('col-det-title').textContent = `${grupoNome} · ${obra.nome}`;
      H.el('col-det-body').innerHTML = `
        <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap">
          <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid #2563eb"><div class="col-kpi-val" style="color:#2563eb">${cel.com_contrato}</div><div class="col-kpi-lbl">🔵 Contratados</div></div>
          <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid var(--green)"><div class="col-kpi-val" style="color:var(--green)">${cel.verde||0}</div><div class="col-kpi-lbl">🟢 No prazo</div></div>
          <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid #eab308"><div class="col-kpi-val" style="color:#ca8a04">${cel.amarelo}</div><div class="col-kpi-lbl">🟡 Atenção</div></div>
          <div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid var(--red)"><div class="col-kpi-val" style="color:var(--red)">${cel.vermelho}</div><div class="col-kpi-lbl">🔴 Crítico</div></div>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="border-bottom:2px solid var(--border);background:var(--surface3)">
                <th style="padding:7px 10px;text-align:left;font-size:9px;color:var(--text3);letter-spacing:.5px">ATIVIDADE</th>
                <th style="padding:7px 10px;text-align:center;font-size:9px;color:var(--text3);letter-spacing:.5px">INÍCIO</th>
                <th style="padding:7px 10px;text-align:center;font-size:9px;color:var(--text3);letter-spacing:.5px">TÉRMINO</th>
                <th style="padding:7px 10px;text-align:center;font-size:9px;color:var(--text3);letter-spacing:.5px">GATILHO</th>
                <th style="padding:7px 10px;text-align:center;font-size:9px;color:var(--text3);letter-spacing:.5px">STATUS</th>
                <th style="padding:7px 10px;text-align:left;font-size:9px;color:var(--text3);letter-spacing:.5px">CONTRATO / CUSTO EST.</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text3)">Nenhuma atividade encontrada.</td></tr>'}</tbody>
          </table>
        </div>`;
      UI.openModal('modal-coloridao-det');
    } catch (e) {
      UI.toast('Erro ao carregar detalhe: ' + e.message, 'error');
    }
  },

  _getDescendentes(ativs, parentId) {
    const filhos = ativs.filter(a => a.parent_id === parentId);
    return filhos.flatMap(f => [f, ...this._getDescendentes(ativs, f.id)]);
  },
};
