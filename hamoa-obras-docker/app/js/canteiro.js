/**
 * CONSTRUTIVO — Módulo Canteiro de Obras (redesenhado)
 *
 * Exibe os pedidos de compra enviados pelos fornecedores via Portal do Fornecedor.
 * Perfil alvo: Suprimentos, Gestor, Admin.
 *
 * Funcionalidades:
 *   - Lista de pedidos (origem=portal_fornecedor) com filtros por status, obra, empresa
 *   - Cards ricos: Empresa, Obra, Contrato, Fornecedor, WBS, itens e anexos
 *   - Controle de status: pendente → em_compra → entregue | cancelado
 *   - Modal de detalhe com itens e anexos para análise
 */

const Canteiro = {
  _pedidos:    [],
  _obras:      [],
  _empresas:   [],
  _loading:    false,
  _filtroStatus:    '',
  _filtroObraId:    '',
  _filtroEmpresaId: '',

  // ── Init ─────────────────────────────────────────────────────
  async init() {
    await Promise.all([this._carregarObras(), this._carregarEmpresas()]);
    this._renderFiltros();
    await this.load();
  },

  async _carregarObras() {
    try { this._obras = (await API.obras()) || []; } catch { this._obras = []; }
  },

  async _carregarEmpresas() {
    try {
      const r = await fetch('/api/empresas', { headers: { Authorization: `Bearer ${localStorage.getItem('construtivo_token')}` } });
      this._empresas = r.ok ? await r.json() : [];
    } catch { this._empresas = []; }
  },

  _renderFiltros() {
    const selObra = H.el('cant-f-obra');
    if (selObra) {
      selObra.innerHTML = '<option value="">Todas as obras</option>' +
        this._obras.map(o => `<option value="${o.id}">${H.esc(o.nome)}</option>`).join('');
    }
    const selEmpresa = H.el('cant-f-empresa');
    if (selEmpresa) {
      selEmpresa.innerHTML = '<option value="">Todas as empresas</option>' +
        this._empresas.map(e => `<option value="${e.id}">${H.esc(e.nome_fantasia || e.razao_social)}</option>`).join('');
    }
  },

  // ── Load ─────────────────────────────────────────────────────
  async load() {
    if (this._loading) return;
    this._loading = true;
    const el = H.el('cant-lista');
    if (el) el.innerHTML = '<div class="loading-inline"><div class="spinner"></div> Carregando pedidos...</div>';

    try {
      const params = new URLSearchParams({ origem: 'portal_fornecedor', limit: 200 });
      // 'integrado' é filtro local (aprovado + uau_pedido_numero) — não passa para a API
      if (this._filtroStatus && this._filtroStatus !== 'integrado') params.set('status', this._filtroStatus);
      if (this._filtroStatus === 'integrado') params.set('status', 'aprovado'); // busca aprovados e filtra localmente
      if (this._filtroObraId)    params.set('obra_id',    this._filtroObraId);
      if (this._filtroEmpresaId) params.set('empresa_id', this._filtroEmpresaId);

      const r = await fetch(`/api/canteiro/req-materiais?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('construtivo_token')}` },
      });
      this._pedidos = r.ok ? await r.json() : [];
      this._renderLista();
      this._renderStats();
    } catch (e) {
      if (el) el.innerHTML = `<div class="empty-state"><p>Erro ao carregar: ${H.esc(e.message)}</p></div>`;
    } finally {
      this._loading = false;
    }
  },

  // ── Stats chips ───────────────────────────────────────────────
  _renderStats() {
    const total       = this._pedidos.length;
    const pendente    = this._pedidos.filter(p => p.status === 'pendente').length;
    const aprovado    = this._pedidos.filter(p => p.status === 'aprovado' && !p.uau_pedido_numero).length;
    const integrado   = this._pedidos.filter(p => p.status === 'aprovado' &&  p.uau_pedido_numero).length;
    const reprovado   = this._pedidos.filter(p => p.status === 'reprovado').length;
    const em_compra   = this._pedidos.filter(p => p.status === 'em_compra').length;
    const entregue    = this._pedidos.filter(p => p.status === 'entregue').length;

    const el = H.el('cant-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="stat-chip ${!this._filtroStatus ? 'active' : ''}" onclick="Canteiro._setFiltroStatus('')">
        Todos <span>${total}</span>
      </div>
      <div class="stat-chip warn ${this._filtroStatus === 'pendente' ? 'active' : ''}" onclick="Canteiro._setFiltroStatus('pendente')">
        ⏳ Aguardando Gestor <span>${pendente}</span>
      </div>
      <div class="stat-chip info ${this._filtroStatus === 'aprovado' ? 'active' : ''}" onclick="Canteiro._setFiltroStatus('aprovado')">
        ✅ Aprovado <span>${aprovado}</span>
      </div>
      <div class="stat-chip success ${this._filtroStatus === 'integrado' ? 'active' : ''}" onclick="Canteiro._setFiltroStatus('integrado')">
        🔗 Integrado ERP <span>${integrado}</span>
      </div>
      <div class="stat-chip danger ${this._filtroStatus === 'reprovado' ? 'active' : ''}" onclick="Canteiro._setFiltroStatus('reprovado')">
        ✗ Reprovado <span>${reprovado}</span>
      </div>
      <div class="stat-chip info ${this._filtroStatus === 'em_compra' ? 'active' : ''}" onclick="Canteiro._setFiltroStatus('em_compra')">
        🛒 Pedido em Compra <span>${em_compra}</span>
      </div>
      <div class="stat-chip success ${this._filtroStatus === 'entregue' ? 'active' : ''}" onclick="Canteiro._setFiltroStatus('entregue')">
        📦 Entregue <span>${entregue}</span>
      </div>
    `;
  },

  _setFiltroStatus(s) {
    this._filtroStatus = s;
    const sel = H.el('cant-f-status');
    if (sel) sel.value = s;
    this.load();
  },

  // ── Render Lista ─────────────────────────────────────────────
  _renderLista() {
    const el = H.el('cant-lista');
    if (!el) return;

    if (!this._pedidos.length) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛒</div>
          <p>Nenhum pedido de compra encontrado.</p>
          <p class="empty-sub">Os pedidos enviados pelos fornecedores via portal aparecerão aqui.</p>
        </div>`;
      return;
    }

    // Filtro local para 'integrado' (aprovado + uau_pedido_numero)
    const lista = this._filtroStatus === 'integrado'
      ? this._pedidos.filter(p => p.status === 'aprovado' && p.uau_pedido_numero)
      : this._pedidos;
    el.innerHTML = lista.map(p => this._cardHTML(p)).join('');
  },

  _statusInfo(status, uauNumero) {
    if (status === 'aprovado' && uauNumero) {
      return { label: 'Aprovado e Integrado ERP', cls: 'badge-success', icon: '🔗' };
    }
    return {
      pendente:  { label: 'Aguardando Aprovação Gestor',  cls: 'badge-warn',    icon: '⏳' },
      aprovado:  { label: 'Aprovado pelo Gestor',         cls: 'badge-info',    icon: '✅' },
      reprovado: { label: 'Reprovado pelo Gestor',        cls: 'badge-danger',  icon: '✗'  },
      em_compra: { label: 'Pedido em Compra',             cls: 'badge-info',    icon: '🛒' },
      entregue:  { label: 'Entregue',                     cls: 'badge-success', icon: '📦' },
      cancelado: { label: 'Reprovado pelo Suprimentos',   cls: 'badge-danger',  icon: '✕'  },
    }[status] || { label: status, cls: 'badge-default', icon: '•' };
  },

  _cardHTML(p) {
    const st    = this._statusInfo(p.status, p.uau_pedido_numero);
    const itens = this._parseItens(p.itens);
    const total = parseInt(p.total_anexos || 0);
    const dt    = p.criado_em
      ? new Date(p.criado_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '—';

    return `
    <div class="cant-card" data-id="${p.id}">
      <div class="cant-card-head">
        <div class="cant-card-codigo">${H.esc(p.codigo || '#' + p.id)}</div>
        <div class="cant-card-meta">
          <div class="cant-card-empresa">${H.esc(p.empresa_nome || '—')}</div>
          <div class="cant-card-obra">🏗️ ${H.esc(p.obra_nome || '—')}</div>
        </div>
        <span class="badge ${st.cls}">${st.icon} ${st.label}</span>
        <div class="cant-card-data">${dt}</div>
      </div>

      <div class="cant-card-body">
        <div class="cant-card-col">
          ${p.fornecedor_nome ? `
            <div class="cant-info-row">
              <span class="cant-info-label">Fornecedor</span>
              <span class="cant-info-val">${H.esc(p.fornecedor_nome)}</span>
            </div>` : ''}
          ${p.contrato_numero ? `
            <div class="cant-info-row">
              <span class="cant-info-label">Contrato</span>
              <span class="cant-info-val">${H.esc(p.contrato_numero)}${p.contrato_descricao ? ' — ' + H.esc(p.contrato_descricao) : ''}</span>
            </div>` : ''}
          ${p.atividade_wbs ? `
            <div class="cant-info-row">
              <span class="cant-info-label">WBS</span>
              <span class="cant-info-val"><span class="tag-wbs">${H.esc(p.atividade_wbs)}</span>${p.atividade_nome ? ' — ' + H.esc(p.atividade_nome) : ''}</span>
            </div>` : ''}
          ${p.grupo_pai ? `
            <div class="cant-info-row">
              <span class="cant-info-label">Grupo</span>
              <span class="cant-info-val muted">↳ ${H.esc(p.grupo_pai)}</span>
            </div>` : ''}
        </div>

        <div class="cant-card-col">
          <div class="cant-itens-titulo">Materiais solicitados (${itens.length})</div>
          <div class="cant-itens-lista">
            ${itens.slice(0, 4).map(it => `
              <div class="cant-item-row">
                <span class="cant-item-desc">${it.codigo_insumo ? `<span style="font-weight:600;color:var(--azul);margin-right:4px">${H.esc(it.codigo_insumo)}</span>` : ''}${H.esc(it.descricao || it.nome || '—')}</span>
                <span class="cant-item-qtd">${it.quantidade != null ? it.quantidade : '—'} ${H.esc(it.unidade || '')}</span>
              </div>
            `).join('')}
            ${itens.length > 4 ? `<div class="cant-item-mais">+ ${itens.length - 4} item(s) adicionais</div>` : ''}
          </div>
        </div>
      </div>

      <div class="cant-card-footer">
        <div class="cant-anexo-info">
          ${total > 0 ? `<span class="anx-chip" style="cursor:pointer" onclick="event.stopPropagation();Canteiro.verDetalhe(${p.id})" title="Clique para ver os anexos">📎 ${total} anexo${total > 1 ? 's' : ''} ↗</span>` : '<span class="muted">Sem anexos</span>'}
          ${p.observacao ? `<span class="anx-chip" title="${H.esc(p.observacao)}">💬 Obs</span>` : ''}
          ${p.uau_pedido_numero ? `<span class="anx-chip" style="background:#e0f2fe;color:#0369a1;font-weight:700" title="Número do pedido no ERP UAU">🔗 UAU Nº ${H.esc(p.uau_pedido_numero)}</span>` : ''}
        </div>
        <div class="cant-actions">
          ${p.status === 'pendente' ? `
            <button class="btn-sm btn-success-sm" onclick="Canteiro.atualizarStatus(${p.id}, 'aprovado')">✓ Aprovar</button>
            <button class="btn-sm btn-danger-sm"  onclick="Canteiro.atualizarStatus(${p.id}, 'reprovado')">✗ Reprovar</button>
          ` : ''}
        </div>
      </div>
    </div>`;
  },

  _parseItens(itens) {
    if (!itens) return [];
    if (Array.isArray(itens)) return itens;
    try { return JSON.parse(itens); } catch { return []; }
  },

  // ── Detalhe modal ─────────────────────────────────────────────
  async verDetalhe(id) {
    const body = H.el('cant-modal-body');
    if (!body) return;

    UI.openModal('cant-modal');
    body.innerHTML = '<div class="loading-inline"><div class="spinner"></div></div>';

    try {
      const r = await fetch(`/api/canteiro/req-materiais/${id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('construtivo_token')}` },
      });
      const p       = await r.json();
      const itens     = this._parseItens(p.itens);
      const historico = p.historico || [];
      const anexos    = p.anexos    || [];
      const st        = this._statusInfo(p.status);

      body.innerHTML = `
        <div class="det-context">
          <div class="det-ctx-grid">
            <div class="det-ctx-item"><strong>Código</strong><span>${H.esc(p.codigo || '#' + p.id)}</span></div>
            <div class="det-ctx-item"><strong>Status</strong><span class="badge ${st.cls}">${st.icon} ${st.label}</span></div>
            <div class="det-ctx-item"><strong>Empresa</strong><span>${H.esc(p.empresa_nome || '—')}</span></div>
            <div class="det-ctx-item"><strong>Obra</strong><span>${H.esc(p.obra_nome || '—')}</span></div>
            <div class="det-ctx-item"><strong>Fornecedor</strong><span>${H.esc(p.fornecedor_nome || '—')}</span></div>
            <div class="det-ctx-item"><strong>Contrato</strong><span>${H.esc(p.contrato_numero ? p.contrato_numero + (p.contrato_descricao ? ' — ' + p.contrato_descricao : '') : '—')}</span></div>
            ${p.atividade_wbs ? `<div class="det-ctx-item det-wide"><strong>WBS</strong><span><span class="tag-wbs">${H.esc(p.atividade_wbs)}</span> ${H.esc(p.atividade_nome || '')}</span></div>` : ''}
            ${p.uau_pedido_numero ? `<div class="det-ctx-item"><strong>Pedido UAU (ERP)</strong><span style="font-weight:700;color:#0369a1">🔗 Nº ${H.esc(p.uau_pedido_numero)}</span></div>` : ''}
            ${p.observacao    ? `<div class="det-ctx-item det-wide"><strong>Observação</strong><span>${H.esc(p.observacao)}</span></div>` : ''}
          </div>
        </div>

        <div class="det-secao">
          <div class="det-secao-titulo">Materiais Solicitados</div>
          <table class="det-table">
            <thead><tr><th>#</th><th>Código</th><th>Descrição</th><th>Quantidade</th><th>Unidade</th></tr></thead>
            <tbody>
              ${itens.map((it, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td style="font-weight:600;white-space:nowrap">${H.esc(it.codigo_insumo || '—')}</td>
                  <td>${H.esc(it.descricao || it.nome || '—')}</td>
                  <td>${it.quantidade != null ? it.quantidade : '—'}</td>
                  <td>${H.esc(it.unidade || '—')}</td>
                </tr>
              `).join('')}
              ${!itens.length ? '<tr><td colspan="5" class="txt-center muted">Nenhum item</td></tr>' : ''}
            </tbody>
          </table>
        </div>

        ${anexos.length ? `
        <div class="det-secao">
          <div class="det-secao-titulo">Anexos para Análise (${anexos.length})</div>
          <div class="det-anexos">
            ${anexos.map(a => {
              const icon = a.tipo === 'img' ? '🖼️' : a.tipo === 'pdf' ? '📄' : '📎';
              return `<a class="det-anx-chip" href="${H.esc(a.url_view || '#')}" target="_blank" rel="noopener">
                ${icon} ${H.esc(a.nome)} ${a.tamanho ? `<em>${H.esc(a.tamanho)}</em>` : ''}
              </a>`;
            }).join('')}
          </div>
        </div>` : ''}

        ${historico.length ? `
        <div class="det-secao">
          <div class="det-secao-titulo">Histórico</div>
          <div class="det-historico">
            ${historico.map(h => `
              <div class="det-hist-row">
                <div class="det-hist-dot"></div>
                <div class="det-hist-info">
                  <strong>${H.esc(h.status_para || '—')}</strong>
                  ${h.observacao ? ` — ${H.esc(h.observacao)}` : ''}
                  <span>${H.esc(h.usuario || '—')} · ${new Date(h.criado_em).toLocaleString('pt-BR')}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <div class="det-acoes">
          ${p.status === 'pendente' ? `
            <button class="btn-success" onclick="Canteiro.atualizarStatus(${p.id},'aprovado');Canteiro.fecharModal()">✓ Aprovar Pedido</button>
            <button class="btn-danger"  onclick="Canteiro.atualizarStatus(${p.id},'reprovado');Canteiro.fecharModal()">✗ Reprovar Pedido</button>
          ` : ''}
        </div>
      `;
    } catch (e) {
      body.innerHTML = `<p style="color:var(--danger)">Erro: ${H.esc(e.message)}</p>`;
    }
  },

  fecharModal() {
    UI.closeModal('cant-modal');
  },

  // ── Atualizar status ─────────────────────────────────────────
  async atualizarStatus(id, novoStatus) {
    // Aprovação: abre modal UAU para preencher campos antes de confirmar
    if (novoStatus === 'aprovado') {
      await this._abrirModalUau(id);
      return;
    }

    const labels = {
      reprovado: 'Reprovado pelo Gestor',
      em_compra: 'Pedido em Compra',
      entregue:  'Entregue',
      cancelado: 'Reprovado pelo Suprimentos',
    };
    if (!confirm(`Confirma: alterar status para "${labels[novoStatus] || novoStatus}"?`)) return;

    try {
      const r = await fetch(`/api/canteiro/req-materiais/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${localStorage.getItem('construtivo_token')}`,
        },
        body: JSON.stringify({ status: novoStatus }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Erro');
      UI.toast(`Status atualizado: ${labels[novoStatus]}`, 'success');
      await this.load();
    } catch (e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  },

  // ── Modal de Aprovação + Integração UAU ──────────────────────
  _pedidoUauAtual: null,

  async _abrirModalUau(pedidoId) {
    // Busca detalhe completo do pedido
    const token = localStorage.getItem('construtivo_token');
    let p;
    try {
      const r = await fetch(`/api/canteiro/req-materiais/${pedidoId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      p = await r.json();
    } catch(e) {
      UI.toast('Erro ao carregar pedido: ' + e.message, 'error');
      return;
    }
    this._pedidoUauAtual = p;

    const itens    = Array.isArray(p.itens) ? p.itens : [];
    const vinculos = Array.isArray(p.uau_vinculos) ? p.uau_vinculos : [];
    const hoje     = new Date();
    // Data padrão: 30 dias à frente — input type=date usa YYYY-MM-DD
    const dtDef = (() => {
      const dt = new Date(hoje); dt.setDate(dt.getDate()+30);
      return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    })();
    const mesDef = `${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`;

    // Item PL: vem do wbs_erp da atividade no cronograma.
    // Se não preenchido, fica vazio — usuário importa o cronograma com o campo "wbs erp".
    const itemPlDef = p.atividade_wbs_erp || '';

    // Produto PL e Contrato PL do cadastro do contrato
    const produtoPl  = p.contrato_uau_produto_pl  || '';
    const contratoPl = p.contrato_uau_contrato_pl || '';

    // Opções do select de vínculo ao planejamento
    const vinculoOpts = vinculos.length > 0
      ? `<option value="">— selecione —</option>` +
        vinculos.map(v =>
          `<option value="${v.id}" data-srv="${v.servico_pl}" data-ins="${v.codigo_insumo_pl}">
            ${v.servico_pl} / ${v.codigo_insumo_pl}${v.descricao ? ' — '+v.descricao : ''}
          </option>`
        ).join('')
      : null; // null = sem vínculos cadastrados → usa texto livre

    // Monta linhas de itens
    let itensHtml = '';
    itens.forEach((it, i) => {
      const cod  = it.codigo_insumo || it.codigoInsumo || '';
      const nome = it.descricao || it.nome || '—';
      const und  = it.unidade || 'UN';
      const qtd  = it.quantidade || 1;

      // Bloco de vínculo ao planejamento — select ou texto livre
      const vinculoHtml = vinculoOpts
        ? `<!-- select de vínculo pré-cadastrado -->
          <div style="grid-column:1/-1">
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">
              Vínculo Planejamento (SI) *
              <span style="font-weight:400;color:var(--azul-dk)"> — do cadastro do contrato</span>
            </label>
            <select class="sel" id="uau-vinculo-${i}" style="font-size:12px;width:100%"
              onchange="Canteiro._onVinculoChange(${i}, this)">
              ${vinculoOpts}
            </select>
          </div>
          <input type="hidden" id="uau-srvpl-${i}" value="">
          <input type="hidden" id="uau-inspl-${i}" value="${cod}">`
        : `<!-- texto livre quando não há vínculos cadastrados -->
          <div>
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">Serviço PL *</label>
            <input class="fi" id="uau-srvpl-${i}" placeholder="Ex: SRV001" style="font-size:12px">
          </div>
          <div>
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">Cód. Insumo Material PL *</label>
            <input class="fi" id="uau-inspl-${i}" value="${cod}" placeholder="Código SI" style="font-size:12px">
          </div>`;

      itensHtml += `
      <div style="border:1px solid var(--borda);border-radius:8px;padding:14px;margin-bottom:12px;background:var(--bg)">
        <div style="font-weight:700;color:var(--azul-md);margin-bottom:10px;font-size:13px">
          ${cod ? '<span style="background:var(--azul-lt);color:var(--azul-dk);padding:2px 7px;border-radius:4px;margin-right:6px;font-size:11px">' + cod + '</span>' : ''}
          ${nome}
          <span style="color:var(--text3);font-weight:400;margin-left:8px">${qtd} ${und}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:4px">
              CAP *
              ${it.cap ? '<span style="font-size:10px;font-weight:400;color:var(--azul-dk)"> — preenchido do cadastro</span>' : '<span style="font-size:10px;font-weight:400;color:var(--red)"> — não cadastrado no insumo</span>'}
            </label>
            <input class="fi" id="uau-cap-${i}" value="${it.cap ? it.cap.split(/\s*[-–]\s*/)[0].trim() : ''}" placeholder="Ex: D497" style="font-size:13px${it.cap ? ';background:var(--azul-lt)' : ''}"
              title="Apenas o código CAP, sem descrição${it.cap ? ' (do cadastro: '+it.cap+')' : ''}">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:4px">Controle Estoque *</label>
            <select class="sel" id="uau-est-${i}" style="font-size:13px">
              <option value="0">Não controla</option>
              <option value="1">Controla estoque</option>
            </select>
          </div>
        </div>

        <div style="margin-top:12px;border-top:1px dashed var(--borda);padding-top:10px">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:8px;letter-spacing:1px">
            VÍNCULO AO PLANEJAMENTO (SI)
            ${vinculos.length === 0 ? '<span style="font-weight:400;font-size:10px;color:var(--red)"> — cadastre vínculos no contrato para pré-preencher</span>' : ''}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
              <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">
                Item PL *
                ${p.atividade_wbs_erp ? '<span style="font-size:9px;color:var(--accent)"> — WBS ERP do cronograma</span>'
                  : '<span style="font-size:9px;color:var(--red)"> — importe o cronograma com "wbs erp"</span>'}
              </label>
              <input class="fi" id="uau-itempl-${i}" value="${itemPlDef}" placeholder="Ex: 01.02.03.04" style="font-size:12px${itemPlDef ? ';background:var(--surface2)' : ''}"
                title="${p.atividade_wbs_erp ? 'WBS ERP: '+p.atividade_wbs_erp : ''}">
            </div>
            <div>
              <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">Qtd. Vínculo *</label>
              <input class="fi" id="uau-qtdpl-${i}" type="number" value="${qtd}" placeholder="${qtd}" style="font-size:12px">
            </div>
            ${vinculoHtml}
          </div>
        </div>
      </div>`;
    });

    // Resolve valores UAU que serão enviados (mesma prioridade do backend)
    const uauLogin        = await this._getUauLogin();
    const codigoEmpresa   = p.empresa_uau_empresa || p.contrato_uau_empresa || '—';
    const codigoObra      = p.obra_uau_obra       || '—';
    const codigoObraFisc  = p.obra_uau_obra_fiscal || '—';
    const codigoContrato  = p.contrato_uau_contrato || '—';

    const _tag = (val, ok) => val && val !== '—'
      ? `<span style="background:${ok?'var(--azul-lt)':'#fff3e0'};color:${ok?'var(--azul-dk)':'#e65100'};padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px">${val}</span>`
      : `<span style="background:#fff0f0;color:var(--red);padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px">⚠ não cadastrado</span>`;

    const html = `
    <div style="padding:20px 24px 0">
      <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px">✅ Aprovar & Enviar ao UAU</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:16px">
        Pedido <strong>${p.codigo || '#'+p.id}</strong> —
        ${p.fornecedor_nome || '—'} · ${p.obra_nome || '—'}
      </div>

      <div style="background:var(--azul-lt);border:1px solid var(--azul-md);border-radius:8px;padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--azul-dk);letter-spacing:1px;margin-bottom:10px">PARÂMETROS ENVIADOS AO UAU</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
          <div>
            <span style="color:var(--text3);display:block;margin-bottom:2px">Empresa</span>
            <span style="color:var(--text2)">${p.empresa_nome || '—'}</span>
            &nbsp;${_tag(codigoEmpresa, codigoEmpresa !== '—')}
          </div>
          <div>
            <span style="color:var(--text3);display:block;margin-bottom:2px">Fornecedor</span>
            <span style="color:var(--text2);font-weight:600">${p.fornecedor_nome || '—'}</span>
          </div>
          <div>
            <span style="color:var(--text3);display:block;margin-bottom:2px">Obra UAU</span>
            ${_tag(codigoObra, codigoObra !== '—')}
          </div>
          <div>
            <span style="color:var(--text3);display:block;margin-bottom:2px">Obra Fiscal UAU</span>
            ${_tag(codigoObraFisc, codigoObraFisc !== '—')}
          </div>
          <div>
            <span style="color:var(--text3);display:block;margin-bottom:2px">Contrato</span>
            <span style="color:var(--text2)">${p.contrato_numero ? 'Nº '+p.contrato_numero : '—'}</span>
            ${p.contrato_uau_contrato ? `&nbsp;<span style="color:var(--text3);font-size:11px">· UAU</span>&nbsp;${_tag(codigoContrato, true)}` : ''}
          </div>
          ${p.atividade_wbs ? `
          <div style="grid-column:1/-1">
            <span style="color:var(--text3);display:block;margin-bottom:2px">WBS / Atividade</span>
            <span style="color:var(--text2)">${p.atividade_wbs}${p.atividade_nome ? ' — '+p.atividade_nome : ''}</span>
          </div>` : ''}
        </div>
      </div>

      <!-- Campos globais aplicados a todos os itens -->
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:1px;margin-bottom:10px">CAMPOS GLOBAIS — aplicados a todos os itens</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px">
          <div>
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">Data de Entrega *</label>
            <input class="fi" id="uau-dt-global" type="date" value="${dtDef}" style="font-size:12px"
              title="Data de entrega aplicada a todos os itens">
          </div>
          <div>
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">Mês PL *</label>
            <input class="fi" id="uau-mespl-global" type="month" value="${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}" style="font-size:12px"
              title="Mês do planejamento aplicado a todos os itens">
          </div>
          <div>
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">
              Produto PL *
              ${produtoPl ? '<span style="font-size:9px;color:var(--accent)"> — do cadastro</span>' : ''}
            </label>
            <input class="fi" id="uau-prodpl-global" value="${produtoPl}" placeholder="Ex: 1" style="font-size:12px${produtoPl ? ';background:var(--surface2)' : ''}">
          </div>
          <div>
            <label style="font-size:10px;color:var(--text3);display:block;margin-bottom:3px">
              Contrato PL *
              ${contratoPl ? '<span style="font-size:9px;color:var(--accent)"> — do cadastro</span>' : ''}
            </label>
            <input class="fi" id="uau-contpl-global" value="${contratoPl}" placeholder="Ex: 1" style="font-size:12px${contratoPl ? ';background:var(--surface2)' : ''}">
          </div>
        </div>
      </div>

      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;letter-spacing:1px">ITENS DO PEDIDO</div>
      ${itensHtml || '<div style="color:var(--text3);font-size:13px">Nenhum item encontrado no pedido.</div>'}

      <div id="uau-modal-erro" style="display:none;margin-top:10px;padding:10px 14px;background:var(--red-lt,#fff0f0);border:1px solid var(--red);border-radius:6px;font-size:12px;color:var(--red)"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;padding:14px 24px;border-top:1px solid var(--borda);margin-top:16px;background:var(--surface)">
      <button class="btn btn-o" onclick="UI.closeModal('cant-uau-modal')">Cancelar</button>
      <button class="btn btn-a" id="btn-enviar-uau" onclick="Canteiro._enviarUau(${p.id})">🔗 Aprovar & Integrar UAU</button>
    </div>`;

    // Injeta o modal dinamicamente se ainda não existir
    let modal = document.getElementById('cant-uau-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id        = 'cant-uau-modal';
      modal.className = 'mo';
      modal.style.cssText = 'align-items:flex-start;padding-top:30px';
      modal.onclick = (e) => { if (e.target === modal) UI.closeModal('cant-uau-modal'); };
      const inner = document.createElement('div');
      inner.className = 'md';
      inner.style.cssText = 'max-width:720px;width:95vw;max-height:88vh;overflow-y:auto;padding:0';
      modal.appendChild(inner);
      document.body.appendChild(modal);
    }
    modal.querySelector('.md').innerHTML = html;
    UI.openModal('cant-uau-modal');
  },

  // Callback do select de vínculo: propaga servico_pl e codigo_insumo_pl para hidden inputs
  _onVinculoChange(i, sel) {
    const opt = sel.options[sel.selectedIndex];
    document.getElementById(`uau-srvpl-${i}`).value = opt?.dataset?.srv || '';
    document.getElementById(`uau-inspl-${i}`).value = opt?.dataset?.ins || '';
  },

  async _getUauLogin() {
    try {
      const r = await fetch('/api/config/uau', {
        headers: { Authorization: `Bearer ${localStorage.getItem('construtivo_token')}` },
      });
      const d = await r.json();
      return d?.valor?.login || '';
    } catch { return ''; }
  },

  async _aprovarSemUau(pedidoId) {
    UI.closeModal('cant-uau-modal');
    try {
      const r = await fetch(`/api/canteiro/req-materiais/${pedidoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('construtivo_token')}` },
        body: JSON.stringify({ status: 'aprovado' }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Erro');
      UI.toast('✅ Pedido aprovado (sem integração UAU)', 'success');
      await this.load();
    } catch(e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  },

  async _enviarUau(pedidoId) {
    const p     = this._pedidoUauAtual;
    const itens = Array.isArray(p?.itens) ? p.itens : [];
    const btn   = document.getElementById('btn-enviar-uau');
    const erro  = document.getElementById('uau-modal-erro');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }
    if (erro) erro.style.display = 'none';

    // Lê campos globais (aplicados a todos os itens)
    const _normMes = (raw) => {
      const m1 = raw.match(/^(\d{1,2})[\/\-](\d{4})$/);
      const m2 = raw.match(/^(\d{4})[\/\-](\d{1,2})$/);
      if (m1) return String(m1[1]).padStart(2,'0') + '/' + m1[2];
      if (m2) return String(m2[2]).padStart(2,'0') + '/' + m2[1];
      return raw;
    };
    const dtGlobal   = document.getElementById('uau-dt-global')?.value?.trim() || '';
    const dtGlobalParts = dtGlobal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dtGlobalFmt   = dtGlobalParts ? `${dtGlobalParts[2]}/${dtGlobalParts[3]}/${dtGlobalParts[1]}` : dtGlobal;
    const mesGlobal  = _normMes(document.getElementById('uau-mespl-global')?.value?.trim() || '');
    const prodGlobal = parseInt(document.getElementById('uau-prodpl-global')?.value) || 0;
    const contGlobal = parseInt(document.getElementById('uau-contpl-global')?.value) || 0;

    // Monta payload UAU
    const listaDadosItemPedido = itens.map((it, i) => {
      // CAP: extrai apenas o código, removendo descrição após " - " ou " – "
      const capRaw  = document.getElementById(`uau-cap-${i}`)?.value?.trim() || '';
      const cap     = capRaw.split(/\s*[-–]\s*/)[0].trim();
      const est     = parseInt(document.getElementById(`uau-est-${i}`)?.value) || 0;
      const itemPl  = document.getElementById(`uau-itempl-${i}`)?.value?.trim() || '';
      const srvPl   = document.getElementById(`uau-srvpl-${i}`)?.value?.trim()  || '';
      const insPl   = document.getElementById(`uau-inspl-${i}`)?.value?.trim()  || '';
      const qtdPl   = parseFloat(document.getElementById(`uau-qtdpl-${i}`)?.value) || it.quantidade || 1;

      // Vínculo ao planejamento é opcional — só inclui se os campos obrigatórios estiverem preenchidos
      const temVinculo = prodGlobal && contGlobal && itemPl && srvPl && mesGlobal && insPl;
      const listaVinculo = temVinculo ? [{
        produtoPl:         prodGlobal,
        contratoPl:        contGlobal,
        itemPl,
        servicoPl:         srvPl,
        mesPl:             mesGlobal,
        codigoInsumoPl:    insPl,
        quantidadeVinculo: qtdPl,
      }] : [];

      return {
        codigoInsumo:    it.codigo_insumo || '',
        CAP:             cap,
        unidade:         it.unidade || 'UN',
        controleEstoque: est,
        dataEntrega:     dtGlobalFmt,
        quantidade:      parseFloat(it.quantidade) || 1,
        observacao:      it.observacao || '',
        listaVinculo,
      };
    });

    try {
      const r = await fetch(`/api/uau/pedido-compra`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${localStorage.getItem('construtivo_token')}`,
        },
        body: JSON.stringify({ pedidoId, listaDadosItemPedido }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        const msg  = d.error || d.message || 'Erro desconhecido';
        const desc = d.detail || '';
        const descHtml = desc
          ? '<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(200,0,0,.2);white-space:pre-line;font-size:11px;color:#a00">' +
            desc.replace(/</g,'&lt;') + '</div>'
          : '';
        if (erro) {
          erro.style.display = 'block';
          erro.innerHTML = '<strong>✗ ' + msg.replace(/</g,'&lt;') + '</strong>' + descHtml;
        }
        if (btn) { btn.disabled = false; btn.textContent = '🔗 Aprovar & Integrar UAU'; }
        return;
      }
      // Sucesso
      UI.closeModal('cant-uau-modal');
      const _nrUau = d.numeroPedido ? ` — Nº ${d.numeroPedido}` : '';
      UI.toast(`✅ Pedido aprovado e integrado ao UAU com sucesso${_nrUau}`, 'success');
      await this.load();
    } catch(e) {
      if (erro) { erro.style.display = 'block'; erro.textContent = '✗ Erro: ' + e.message; }
      if (btn)  { btn.disabled = false; btn.textContent = '🔗 Aprovar & Integrar UAU'; }
    }
  },

  // ── Filtros ───────────────────────────────────────────────────
  onFiltroChange() {
    this._filtroStatus    = H.el('cant-f-status')?.value   || '';
    this._filtroObraId    = H.el('cant-f-obra')?.value     || '';
    this._filtroEmpresaId = H.el('cant-f-empresa')?.value  || '';
    this.load();
  },
};
