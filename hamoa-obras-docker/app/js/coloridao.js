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
  _obras:             [],
  _cronogramas:       [],
  _nivel:             0,
  _maxNivel:          0,
  _aba:               'heatmap',
  _somenteCriticos:   false,
  _somenteSemContrato:false,
  _listaFiltroStatus: '',
  _listaFiltroResp:   '',
  _listaSort:         'urgencia',
  // Heatmap extras
  _heatmapSort:       'status',   // 'status'|'empresa'|'nome'
  _obraFoco:          null,       // obra_id em foco (clique no cabeçalho)
  // Lista extras
  _secaoAberta:       { vermelho: true, amarelo: true, verde: false, cinza: false },

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

  // ── Ordenação de obras ───────────────────────────────────────
  sortObras(modo) {
    this._heatmapSort = modo;
    ['status','empresa','nome'].forEach(m => {
      const btn = H.el(`col-sort-${m}`);
      if (btn) btn.className = 'col-gran-btn' + (m === modo ? ' col-gran-active' : '');
    });
    if (this._data) this._renderHeatmap(this._data);
  },

  _sortedObras(obras, matriz, grupos) {
    const rank = { vermelho:5, amarelo:4, cinza:3, verde:2, azul:1, sem_tarefas:0 };
    const clone = [...obras];
    if (this._heatmapSort === 'nome')
      return clone.sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (this._heatmapSort === 'empresa')
      return clone.sort((a,b) => (a.empresa_nome||'').localeCompare(b.empresa_nome||'','pt-BR') || a.nome.localeCompare(b.nome,'pt-BR'));
    // status: pior primeiro
    const worst = o => Math.max(0, ...grupos.map(g => rank[matriz[o.id]?.[g]?.status] || 0));
    return clone.sort((a,b) => worst(b) - worst(a));
  },

  // ── Foco em obra (clique no cabeçalho) ──────────────────────
  toggleObraFoco(obraId) {
    this._obraFoco = this._obraFoco === String(obraId) ? null : String(obraId);
    if (this._data) this._renderHeatmap(this._data);
  },

  // ── Filtros visuais sem reload de API ───────────────────────
  _aplicarFiltrosVisuais() {
    if (this._data) this._renderHeatmap(this._data);
  },

  // ── Tooltip flutuante ───────────────────────────────────────
  _tip: null,
  _getTip() {
    if (!this._tip) {
      this._tip = document.createElement('div');
      this._tip.className = 'col-tooltip';
      document.body.appendChild(this._tip);
      document.addEventListener('scroll', () => { if (this._tip) this._tip.style.display = 'none'; }, true);
    }
    return this._tip;
  },
  _showTip(e, html) {
    const tip = this._getTip();
    tip.innerHTML = html;
    tip.style.display = 'block';
    this._moveTip(e);
  },
  _moveTip(e) {
    const tip = this._getTip();
    const x = e.clientX + 16, y = e.clientY + 16;
    const tw = tip.offsetWidth || 230, th = tip.offsetHeight || 120;
    tip.style.left = (x + tw > window.innerWidth  ? x - tw - 32 : x) + 'px';
    tip.style.top  = (y + th > window.innerHeight ? y - th - 32 : y) + 'px';
  },
  _hideTip() {
    if (this._tip) this._tip.style.display = 'none';
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

    const fmtDate = d => { const s = d ? String(d).slice(0,10) : null; return s ? new Date(s+'T12:00:00').toLocaleDateString('pt-BR') : '—'; };
    const hoje = new Date(); hoje.setHours(0,0,0,0);

    // ── Filtros ─────────────────────────────────────────────────
    let rows = this._pendencias.filter(p => {
      if (this._listaFiltroStatus && p.status !== this._listaFiltroStatus) return false;
      if (this._listaFiltroResp   && p.responsavel !== this._listaFiltroResp) return false;
      return true;
    });

    // ── Ordenação ────────────────────────────────────────────────
    const cmpDate = (a, b) => ((a||'') > (b||'') ? 1 : (a||'') < (b||'') ? -1 : 0);
    if (this._listaSort === 'data_inicio')
      rows = [...rows].sort((a,b) => cmpDate(String(a.data_inicio||'').slice(0,10), String(b.data_inicio||'').slice(0,10)));
    else if (this._listaSort === 'data_limite')
      rows = [...rows].sort((a,b) => cmpDate(String(a.data_limite||'').slice(0,10), String(b.data_limite||'').slice(0,10)));
    else if (this._listaSort === 'custo') {
      rows = [...rows].sort((a,b) => {
        const parse = v => parseFloat((v||'0').replace(/[^\d.,-]/g,'').replace(',','.')) || 0;
        return parse(b.custo_servico) - parse(a.custo_servico);
      });
    }

    // ── KPIs (sobre todos, antes do filtro de status) ─────────
    const kpiFull = { vermelho:0, amarelo:0, verde:0, cinza:0 };
    this._pendencias.forEach(p => { if (kpiFull[p.status] != null) kpiFull[p.status]++; });
    const total    = this._pendencias.length;
    const filtrados = rows.length;
    const ativoKpi = this._listaFiltroStatus;

    const kpiChip = (st, label, cor, bord) => {
      const n    = kpiFull[st] || 0;
      const ativ = ativoKpi === st;
      return `<div class="col-kpi" style="flex:1;min-width:90px;border-left:3px solid ${bord};cursor:pointer;
                   ${ativ?`outline:2px solid ${bord};outline-offset:1px`:''}"
                   onclick="Coloridao.filtrarLista('status','${st}')">
                <div class="col-kpi-val" style="color:${cor}">${n}</div>
                <div class="col-kpi-lbl">${label}</div>
                ${ativ?`<div style="font-size:9px;color:${cor};margin-top:2px">● filtrado</div>`:''}
              </div>`;
    };

    let html = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${kpiChip('vermelho','🔴 Críticos','var(--red)','var(--red)')}
      ${kpiChip('amarelo','🟡 Atenção','#ca8a04','#eab308')}
      ${kpiChip('verde','🟢 No prazo','var(--green)','var(--green)')}
      ${kpiChip('cinza','⚫ Sem gatilho','var(--text3)','var(--border)')}
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

    html += `<div style="font-size:11px;color:var(--text3);margin-bottom:12px">
      ${filtrados < total ? `Exibindo ${filtrados} de ${total} itens` : `${total} itens`}
      ${this._listaFiltroStatus || this._listaFiltroResp
        ? ` · <button onclick="Coloridao.limparFiltrosLista()" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;padding:0">✕ Limpar filtros</button>` : ''}
    </div>`;

    // ── Helpers ──────────────────────────────────────────────────
    const urgBadge = p => {
      const d = p.dias_ate_gatilho;
      if (p.status === 'vermelho') {
        const ds = p.data_inicio ? String(p.data_inicio).slice(0,10) : null;
        const atraso = ds ? Math.floor((hoje - new Date(ds+'T12:00:00')) / 86400000) : null;
        return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.4)">🔴 Atrasado${atraso!=null?` ${atraso}d`:''}</span>`;
      }
      if (p.status === 'amarelo') {
        const cor=d!=null&&d<7?'var(--red)':'#ca8a04', bg=d!=null&&d<7?'rgba(239,68,68,.1)':'rgba(234,179,8,.15)', brd=d!=null&&d<7?'rgba(239,68,68,.4)':'rgba(234,179,8,.5)';
        return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${bg};color:${cor};border:1px solid ${brd}">🟡 ${d!=null?`${d}d restantes`:'Atenção'}</span>`;
      }
      if (p.status === 'verde')
        return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:rgba(34,197,94,.12);color:var(--green);border:1px solid rgba(34,197,94,.4)">🟢 ${d!=null?`${d}d restantes`:'No prazo'}</span>`;
      return `<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;background:var(--bg2);color:var(--text3);border:1px solid var(--border)">⚫ Sem gatilho</span>`;
    };

    const progBar = p => {
      const ds = p.data_inicio ? String(p.data_inicio).slice(0,10) : null;
      const dl = p.data_limite ? String(p.data_limite).slice(0,10) : null;
      if (!ds || !dl) return '';
      const inicio = new Date(ds+'T12:00:00');
      const limite = new Date(dl+'T12:00:00');
      const total  = limite - inicio;
      if (total <= 0) return '';
      const pct = Math.max(0, Math.min(100, Math.round((hoje - inicio) / total * 100)));
      const cor = p.status==='vermelho'?'var(--red)':p.status==='amarelo'?'#eab308':'var(--green)';
      return `<div class="col-prog-wrap"><div class="col-prog-fill" style="width:${pct}%;background:${cor}"></div></div>`;
    };

    const thSort = (campo, label) => {
      const ativ = this._listaSort === campo;
      return `<th style="padding:8px 10px;text-align:center;font-size:9px;color:${ativ?'var(--accent)':'var(--text3)'};letter-spacing:1px;white-space:nowrap;cursor:pointer;user-select:none"
                  onclick="Coloridao.sortLista('${campo}')">${label} ${ativ?'↑':''}</th>`;
    };

    const tableHdr = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="border-bottom:2px solid var(--border);background:var(--surface3);position:sticky;top:0;z-index:1">
        <th style="padding:8px 10px;text-align:left;font-size:9px;color:var(--text3);letter-spacing:1px">ATIVIDADE / GRUPO</th>
        <th style="padding:8px 10px;text-align:left;font-size:9px;color:var(--text3);letter-spacing:1px;white-space:nowrap">OBRA</th>
        ${thSort('data_inicio','INÍCIO')}
        ${thSort('data_limite','CONTRATAR ATÉ')}
        <th style="padding:8px 10px;text-align:center;font-size:9px;color:var(--teal);letter-spacing:1px;white-space:nowrap" title="Gatilho Suprimentos — antecedência para contratação (dias)">🛒 GATILHO SUP.</th>
        <th style="padding:8px 10px;text-align:center;font-size:9px;color:var(--blue);letter-spacing:1px;white-space:nowrap" title="Gatilho Projetos — antecedência para projetos (dias)">📐 GATILHO PROJ.</th>
        ${thSort('urgencia','URGÊNCIA')}
        <th style="padding:8px 10px;text-align:left;font-size:9px;color:var(--text3);letter-spacing:1px">RESPONSÁVEL</th>
        ${thSort('custo','CUSTO EST.')}
        <th style="padding:8px 10px;text-align:center;font-size:9px;color:var(--text3);letter-spacing:1px">AÇÃO</th>
      </tr></thead><tbody>`;

    const renderRow = p => {
      const rowBg = p.status==='vermelho'?'background:rgba(239,68,68,.04)':p.status==='amarelo'?'background:rgba(234,179,8,.04)':'';
      const grupoRef = p.grupo_pai || p.nome;
      return `<tr style="border-bottom:1px solid var(--border);${rowBg}">
        <td style="padding:8px 10px;max-width:260px">
          <div style="font-weight:600;font-size:12px;color:var(--text)">${H.esc(p.nome)}</div>
          ${p.grupo_pai?`<div style="font-size:10px;color:var(--text3);margin-top:2px">↳ ${H.esc(p.grupo_pai)}</div>`:''}
          ${p.wbs?`<div style="font-size:9px;color:var(--text3);margin-top:1px">WBS: ${H.esc(p.wbs)}</div>`:''}
        </td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text2);white-space:nowrap">${H.esc(p.obra_nome||'—')}</td>
        <td style="padding:8px 10px;text-align:center;font-size:11px;color:var(--text2);white-space:nowrap">
          ${fmtDate(p.data_inicio)}
          ${progBar(p)}
        </td>
        <td style="padding:8px 10px;text-align:center;white-space:nowrap">
          ${p.data_limite?`<span style="font-size:11px;font-weight:600;color:${p.status==='vermelho'?'var(--red)':p.status==='amarelo'?'#ca8a04':'var(--text2)'}">${fmtDate(p.data_limite)}</span>`:'<span style="color:var(--text3);font-size:11px">—</span>'}
        </td>
        <td style="padding:8px 10px;text-align:center;white-space:nowrap">
          ${p.gatilho_suprimentos != null
            ? `<span style="font-size:12px;font-weight:700;color:var(--teal)">${p.gatilho_suprimentos}d</span>`
            : '<span style="color:var(--text3);font-size:11px">—</span>'}
        </td>
        <td style="padding:8px 10px;text-align:center;white-space:nowrap">
          ${p.gatilho_projetos != null
            ? `<span style="font-size:12px;font-weight:700;color:var(--blue)">${p.gatilho_projetos}d</span>`
            : '<span style="color:var(--text3);font-size:11px">—</span>'}
        </td>
        <td style="padding:8px 10px;text-align:center">${urgBadge(p)}</td>
        <td style="padding:8px 10px;font-size:11px;color:var(--text2)">
          ${p.responsavel?H.esc(p.responsavel):'<span style="color:var(--text3)">—</span>'}
          ${p.encarregado?`<div style="font-size:10px;color:var(--text3)">Enc: ${H.esc(p.encarregado)}</div>`:''}
        </td>
        <td style="padding:8px 10px;text-align:right;font-size:11px;white-space:nowrap">
          ${p.custo_servico?`<span style="font-weight:600;color:var(--text)">${H.esc(p.custo_servico)}</span>`:'<span style="color:var(--text3)">—</span>'}
        </td>
        <td style="padding:8px 10px;text-align:center">
          <div style="display:flex;flex-direction:column;gap:4px;align-items:center">
            <button onclick="Coloridao._showDetail('${p.obra_id}','${grupoRef.replace(/'/g,"\\'")}')"
                    style="padding:3px 8px;border-radius:5px;border:1px solid var(--accent);background:rgba(var(--accent-rgb),.08);color:var(--accent);cursor:pointer;font-size:10px;font-weight:600;white-space:nowrap"
                    title="Ver detalhes e contratos desta atividade">
              🔗 Detalhes
            </button>
            ${p.rdc_id ? `
            <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
              <span style="font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:10px;white-space:nowrap;${Coloridao._rdcBadgeStyle(p.rdc_status)}"
                    title="RDC ${H.esc(p.rdc_codigo||'')} — ${H.esc(p.rdc_status||'')}">
                🛒 ${H.esc(p.rdc_codigo||'RDC')}
              </span>
              <button onclick="Coloridao._abrirRdc(${p.rdc_id})"
                      style="padding:3px 8px;border-radius:5px;border:1px solid rgba(59,130,246,.4);background:rgba(59,130,246,.08);color:var(--blue);cursor:pointer;font-size:10px;font-weight:600;white-space:nowrap"
                      title="Abrir RDC ${H.esc(p.rdc_codigo||'')}">
                📋 Ver RDC
              </button>
            </div>` : `
            <button onclick="Coloridao._novaRdcAtiv(${p.id},${p.obra_id},'${String(p.nome||'').replace(/'/g,"\\'").replace(/\n/g,' ')}','${String(p.grupo_pai||'').replace(/'/g,"\\'").replace(/\n/g,' ')}','${p.wbs||''}','${p.data_limite||p.data_inicio||''}')"
                    style="padding:3px 8px;border-radius:5px;border:1px solid rgba(34,197,94,.4);background:rgba(34,197,94,.08);color:var(--green);cursor:pointer;font-size:10px;font-weight:600;white-space:nowrap"
                    title="Criar Requisição de Compra para esta atividade">
              🛒 Nova RDC
            </button>`}
          </div>
        </td>
      </tr>`;
    };

    // ── Agrupamento por urgência (quando sem filtro de status ativo) ──
    if (!this._listaFiltroStatus) {
      const grupos = [
        { key:'vermelho', label:'🔴 Já iniciou sem contrato', cor:'rgba(239,68,68,.12)', brd:'rgba(239,68,68,.3)', txt:'var(--red)' },
        { key:'amarelo',  label:'🟡 Gatilho vencido — contratar urgente', cor:'rgba(234,179,8,.10)', brd:'rgba(234,179,8,.4)',  txt:'#ca8a04' },
        { key:'verde',    label:'🟢 Dentro do prazo', cor:'rgba(34,197,94,.08)', brd:'rgba(34,197,94,.3)', txt:'var(--green)' },
        { key:'cinza',    label:'⚫ Sem gatilho definido', cor:'rgba(100,100,100,.06)', brd:'var(--border)', txt:'var(--text3)' },
      ];
      for (const g of grupos) {
        const sec = rows.filter(p => p.status === g.key);
        if (!sec.length) continue;
        const aberto = this._secaoAberta[g.key] !== false;
        html += `<div style="margin-bottom:8px">
          <div class="col-section-hdr" style="background:${g.cor};border:1px solid ${g.brd}"
               onclick="Coloridao.toggleSecao('${g.key}')">
            <span style="color:${g.txt}">${g.label} <span style="font-weight:400;font-size:11px;opacity:.8">(${sec.length})</span></span>
            <span class="col-section-chevron${aberto?' open':''}">▼</span>
          </div>
          <div id="col-sec-${g.key}" style="display:${aberto?'':'none'}">
            <div style="overflow-x:auto">${tableHdr}${sec.map(renderRow).join('')}</tbody></table></div>
          </div>
        </div>`;
      }
    } else {
      // Filtro ativo: lista plana sem agrupamento
      html += `<div style="overflow-x:auto">${tableHdr}${rows.map(renderRow).join('')}</tbody></table></div>`;
    }

    wrap.innerHTML = html;
  },

  // ── Toggle seção colapsável ──────────────────────────────────
  toggleSecao(key) {
    this._secaoAberta[key] = this._secaoAberta[key] === false ? true : false;
    const el = H.el(`col-sec-${key}`);
    const hdr = el?.previousElementSibling?.querySelector('.col-section-chevron');
    if (el) el.style.display = this._secaoAberta[key] === false ? 'none' : '';
    if (hdr) { if (this._secaoAberta[key] === false) hdr.classList.remove('open'); else hdr.classList.add('open'); }
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

  // ── Exportar Excel (XLSX) ────────────────────────────────────
  exportarXLSX() {
    if (!window.XLSX) { UI.toast('SheetJS não carregado — use o CSV', 'error'); return; }
    if (!this._pendencias?.length) { UI.toast('Nenhum dado para exportar', 'error'); return; }

    const fmtDate = d => { const s = d ? String(d).slice(0,10) : null; return s ? new Date(s+'T12:00:00').toLocaleDateString('pt-BR') : ''; };
    const statusLabel = { vermelho:'🔴 Crítico', amarelo:'🟡 Atenção', verde:'🟢 No prazo', cinza:'⚫ Sem gatilho' };
    const statusColors = { vermelho: 'FFFFE0E0', amarelo: 'FFFFF8E1', verde: 'FFE8F5E9', cinza: 'FFF5F5F5' };

    const data = this._pendencias.map(p => ({
      'Status':          statusLabel[p.status] || p.status,
      'Atividade':       p.nome,
      'WBS':             p.wbs || '',
      'Grupo Pai':       p.grupo_pai || '',
      'Obra':            p.obra_nome || '',
      'Início':          fmtDate(p.data_inicio),
      'Término':         fmtDate(p.data_termino),
      'Contratar Até':   fmtDate(p.data_limite),
      'Dias Restantes':  p.dias_ate_gatilho != null ? p.dias_ate_gatilho : '',
      'Responsável':     p.responsavel || '',
      'Encarregado':     p.encarregado || '',
      'Custo Estimado':  p.custo_servico || '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);

    // Larguras de coluna
    ws['!cols'] = [12,40,8,30,30,12,12,12,10,20,20,16].map(w => ({ wch: w }));

    // Estilo de cabeçalho (primeira linha)
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'FF1E3A5F' } }, font: { bold: true, color: { rgb: 'FFFFFFFF' } } };
    }

    // Colorir linhas por status
    for (let r = 1; r <= range.e.r; r++) {
      const stCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
      if (!stCell) continue;
      const stKey = Object.keys(statusLabel).find(k => statusLabel[k] === stCell.v) || 'cinza';
      const fgColor = { rgb: statusColors[stKey] || 'FFFFFFFF' };
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = { fill: { fgColor } };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lista de Compras');
    XLSX.writeFile(wb, `lista_compras_${new Date().toISOString().slice(0,10)}.xlsx`);
    UI.toast('Excel exportado com sucesso!', 'success');
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

  // Cores do badge de RDC por status
  _rdcBadgeStyle(status) {
    const map = {
      rascunho:             'background:rgba(150,150,150,.15);color:var(--text3);border:1px solid rgba(150,150,150,.3)',
      aguardando_aprovacao: 'background:rgba(251,191,36,.18);color:#b45309;border:1px solid rgba(251,191,36,.4)',
      aprovada:             'background:rgba(20,184,166,.15);color:var(--teal);border:1px solid rgba(20,184,166,.35)',
      em_processo:          'background:rgba(59,130,246,.15);color:var(--blue);border:1px solid rgba(59,130,246,.35)',
      contratada:           'background:rgba(34,197,94,.15);color:var(--green);border:1px solid rgba(34,197,94,.35)',
    };
    return map[status] || 'background:var(--surface2);color:var(--text2);border:1px solid var(--border)';
  },

  // Abre detalhe da RDC no módulo Suprimentos
  _abrirRdc(rdcId) {
    if (typeof Suprimentos === 'undefined') {
      UI.toast('Módulo de Suprimentos não disponível.', 'error');
      return;
    }
    // Navega para a aba Suprimentos e abre o detalhe
    App.navigate('suprimentos');
    setTimeout(() => Suprimentos.abrirDetalhe(rdcId), 200);
  },

  // Abre o formulário de nova RDC pré-preenchido com dados da atividade
  _novaRdcAtiv(atividadeId, obraId, nome, grupoPai, wbs, dataPrazo) {
    if (typeof Suprimentos === 'undefined') {
      UI.toast('Módulo de Suprimentos não disponível.', 'error');
      return;
    }
    Suprimentos.novaRdcDeAtividade({
      id:           atividadeId,
      obra_id:      obraId,
      nome:         nome,
      grupo_pai:    grupoPai,
      wbs:          wbs,
      data_limite:  dataPrazo,
      data_inicio:  dataPrazo,
    });
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

    const rank   = { vermelho:5, amarelo:4, cinza:3, verde:2, azul:1, sem_tarefas:0 };
    const corBar = { vermelho:'var(--red)', amarelo:'#eab308', cinza:'var(--text3)', verde:'var(--green)', azul:'#2563eb', sem_tarefas:'var(--border)' };
    const bgLinha = { vermelho:'rgba(239,68,68,.06)', amarelo:'rgba(234,179,8,.05)', cinza:'rgba(100,100,100,.04)', verde:'rgba(34,197,94,.04)', azul:'', sem_tarefas:'' };

    // ── Filtros visuais ────────────────────────────────────────
    const ocultarSemTarefas  = H.el('col-f-ocultar-sem-tarefas')?.checked  || false;
    const ocultarContratados = H.el('col-f-ocultar-contratados')?.checked  || false;

    let gruposFiltrados = grupos;
    let obrasFiltradas  = this._sortedObras(obras, matriz, grupos);

    // Foco em obra única
    if (this._obraFoco) obrasFiltradas = obrasFiltradas.filter(o => String(o.id) === this._obraFoco);
    if (!obrasFiltradas.length) obrasFiltradas = this._sortedObras(obras, matriz, grupos); // fallback

    if (this._somenteCriticos)
      gruposFiltrados = grupos.filter(g => obrasFiltradas.some(o => matriz[o.id]?.[g]?.status === 'vermelho'));
    if (this._somenteSemContrato)
      gruposFiltrados = gruposFiltrados.filter(g => obrasFiltradas.some(o => ['vermelho','amarelo','cinza'].includes(matriz[o.id]?.[g]?.status)));
    if (ocultarSemTarefas)
      gruposFiltrados = gruposFiltrados.filter(g => obrasFiltradas.some(o => (matriz[o.id]?.[g]?.status || 'sem_tarefas') !== 'sem_tarefas'));
    if (ocultarContratados)
      gruposFiltrados = gruposFiltrados.filter(g => obrasFiltradas.some(o => (matriz[o.id]?.[g]?.status || 'sem_tarefas') !== 'azul'));

    if (!gruposFiltrados.length) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Nenhum grupo encontrado com os filtros aplicados. 🎉</div>`;
      return;
    }

    // Reorganiza empresas na nova ordem de obras
    const empresas = [...new Map(obrasFiltradas.map(o=>[o.empresa_id,{id:o.empresa_id,nome:o.empresa_nome}])).values()];

    let html = `<div class="col-heatmap-wrap">
      <div class="col-legend">
        <strong style="font-size:10px;color:var(--text2);letter-spacing:.5px;align-self:center">LEGENDA:</strong>
        <span style="background:rgba(37,99,235,.18);border:1px solid rgba(37,99,235,.5)">🔵 Contratado</span>
        <span style="background:rgba(34,197,94,.18);border:1px solid rgba(34,197,94,.5)">🟢 No prazo</span>
        <span style="background:rgba(234,179,8,.18);border:1px solid rgba(234,179,8,.6)">🟡 Atenção</span>
        <span style="background:rgba(239,68,68,.18);border:1px solid rgba(239,68,68,.5)">🔴 Crítico</span>
        <span style="background:var(--bg2);border:1px solid var(--border)">⚫ Sem gatilho</span>
        ${this._obraFoco ? `<button onclick="Coloridao.toggleObraFoco(null)" style="margin-left:auto;background:none;border:1px solid var(--accent);color:var(--accent);border-radius:6px;padding:2px 10px;cursor:pointer;font-size:11px">✕ Ver todas as obras</button>` : ''}
      </div>
      <div class="col-table-scroll"><table class="col-table">
        <thead>
          <tr><th class="col-th-grupo" rowspan="2">Agrupamento / Fase</th>`;

    for (const emp of empresas) {
      const n = obrasFiltradas.filter(o=>o.empresa_id===emp.id).length;
      html += `<th colspan="${n}" style="background:var(--bg2);font-size:10px;text-align:center;letter-spacing:.5px;color:var(--text3);border-bottom:1px solid var(--border);padding:4px 2px">${H.esc(emp.nome.toUpperCase())}</th>`;
    }
    html += `</tr><tr>`;
    for (const obra of obrasFiltradas) {
      const isFoco = String(obra.id) === this._obraFoco;
      // Totais da obra para tooltip
      const totalCels = gruposFiltrados.filter(g => matriz[obra.id]?.[g]).length;
      const vermCels  = gruposFiltrados.filter(g => matriz[obra.id]?.[g]?.status === 'vermelho').length;
      const amlCels   = gruposFiltrados.filter(g => matriz[obra.id]?.[g]?.status === 'amarelo').length;
      const azulCels  = gruposFiltrados.filter(g => matriz[obra.id]?.[g]?.status === 'azul').length;
      const pctCont   = totalCels ? Math.round(azulCels/totalCels*100) : 0;
      const tipHtml   = `<div class="col-tooltip-title">${H.esc(obra.nome)}</div>
        <div class="col-tooltip-row"><span>🔵 Contratado</span><span>${azulCels} grupos</span></div>
        <div class="col-tooltip-row"><span>🔴 Crítico</span><span>${vermCels} grupos</span></div>
        <div class="col-tooltip-row"><span>🟡 Atenção</span><span>${amlCels} grupos</span></div>
        <div class="col-tooltip-bar"><div class="col-tooltip-bar-fill" style="width:${pctCont}%;background:#2563eb"></div></div>
        <div style="font-size:10px;color:var(--text3)">${pctCont}% contratado · clique para focar</div>`;
      html += `<th class="col-th-obra${isFoco?' col-obra-foco':''}"
                   onclick="Coloridao.toggleObraFoco(${obra.id})"
                   onmouseenter="Coloridao._showTip(event,this.dataset.tip)"
                   onmousemove="Coloridao._moveTip(event)"
                   onmouseleave="Coloridao._hideTip()"
                   data-tip="${H.esc(tipHtml)}"
                   title="${H.esc(obra.nome)}">${H.esc(obra.nome)}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const grupo of gruposFiltrados) {
      const statusLinha = obrasFiltradas.reduce((pior, o) => {
        const st = matriz[o.id]?.[grupo]?.status || 'sem_tarefas';
        return (rank[st]||0) > (rank[pior]||0) ? st : pior;
      }, 'sem_tarefas');

      // Linha com fundo sutil baseado no pior status
      const linhaStyle = bgLinha[statusLinha] ? `background:${bgLinha[statusLinha]}` : '';
      html += `<tr style="${linhaStyle}">
        <td class="col-td-grupo" style="${linhaStyle}">
          <span class="col-grupo-bar" style="background:${corBar[statusLinha]||'var(--border)'}"></span>${H.esc(grupo)}
        </td>`;

      for (const obra of obrasFiltradas) {
        const cel    = matriz[obra.id]?.[grupo];
        const isFoco = String(obra.id) === this._obraFoco;
        if (!cel) {
          html += `<td class="col-cell${isFoco?' col-cell-foco':''}" style="background:var(--bg);color:var(--border)">·</td>`;
          continue;
        }
        const s = this._css[cel.status] || this._css.sem_tarefas;
        const pctC = cel.total ? Math.round(cel.com_contrato/cel.total*100) : 0;
        const tipCel = cel.status === 'sem_tarefas' ? `<div>Sem tarefas neste grupo</div>`
          : `<div class="col-tooltip-title">${H.esc(obra.nome)}</div>
             <div style="font-size:11px;color:var(--text3);margin-bottom:4px">${H.esc(grupo)}</div>
             <div class="col-tooltip-row"><span>Total atividades</span><span>${cel.total}</span></div>
             <div class="col-tooltip-row"><span>🔵 Contratadas</span><span>${cel.com_contrato}</span></div>
             <div class="col-tooltip-row"><span>🔴 Críticas</span><span>${cel.vermelho}</span></div>
             <div class="col-tooltip-row"><span>🟡 Atenção</span><span>${cel.amarelo}</span></div>
             <div class="col-tooltip-row"><span>🟢 No prazo</span><span>${cel.verde}</span></div>
             <div class="col-tooltip-bar"><div class="col-tooltip-bar-fill" style="width:${pctC}%;background:#2563eb"></div></div>
             <div style="font-size:10px;color:var(--text3)">${pctC}% contratado</div>`;
        const verdeExtra = cel.verde > 0 && cel.status !== 'verde' && cel.status !== 'azul' && cel.status !== 'sem_tarefas'
          ? `<span class="col-cell-verde">🟢${cel.verde}</span>` : '';
        html += `<td class="col-cell${isFoco?' col-cell-foco':''}" style="background:${s.bg};border-color:${s.border};position:relative"
                    onmouseenter="Coloridao._showTip(event,this.dataset.tip)"
                    onmousemove="Coloridao._moveTip(event)"
                    onmouseleave="Coloridao._hideTip()"
                    data-tip="${H.esc(tipCel)}"
                    onclick="Coloridao._hideTip();Coloridao._showDetail('${obra.id}','${grupo.replace(/'/g,"\\'").replace(/`/g,"'")}')">
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

      // Inclui folhas normais + resumos com gatilho_dias > 0 explicitamente configurado
      // Exclui resumos com gatilho_dias = 0 (valor default/vazio — não é um marco real)
      // Esta condição espelha exatamente o filtro do SQL do heatmap (s.id != s.root_id + gatilho > 0)
      const descendentes = this._getDescendentes(ativs, grupoNode.id).filter(a => !a.eh_resumo || (a.gatilho_dias != null && a.gatilho_dias > 0));
      const hoje = new Date(); hoje.setHours(0,0,0,0);

      // Normaliza datas que podem vir como string ISO completa ("2024-03-04T03:00:00.000Z")
      // ou como string curta ("2024-03-04") — extrai sempre os 10 primeiros caracteres.
      const toDateStr = d => d ? String(d).slice(0, 10) : null;
      const fmtDate   = d => { const s = toDateStr(d); return s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR') : '—'; };

      const rows = descendentes.map(a => {
        const temContrato = (a.contratos_vinculados?.length || 0) > 0;
        const ds          = toDateStr(a.data_inicio);
        const dataInicio  = ds ? new Date(ds + 'T12:00:00') : null;
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
                ⏱ Contratar em ${dias <= 0 ? 'HOJE' : dias + ' dias'} · até ${fmtDate(toDateStr(gd))}
              </span>
            </div>`;
          } else if (status === 'verde' && gatilhoDias != null && dataInicio) {
            const gd = new Date(dataInicio); gd.setDate(gd.getDate() - gatilhoDias);
            const dias = Math.floor((gd - hoje) / 86400000);
            urgencia = `<div style="margin-top:4px">
              <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;
                           background:rgba(34,197,94,.1);color:var(--green);border:1px solid rgba(34,197,94,.3)">
                🟢 ${dias} dias restantes · contratar até ${fmtDate(toDateStr(gd))}
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
