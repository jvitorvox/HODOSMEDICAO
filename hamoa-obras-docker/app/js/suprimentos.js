'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// SUPRIMENTOS — Módulo RDC (Requisição de Compra)
// ══════════════════════════════════════════════════════════════════════════════
const Suprimentos = (() => {

  // ── Estado interno ────────────────────────────────────────────────────────
  let _rdcEmEdicao = null;      // id da RDC em edição (null = nova)
  let _rdcDetAberta = null;     // id da RDC aberta no modal de detalhe
  let _rdcStatusId = null;      // id usado no modal de status
  let _rdcVincularId = null;    // id usado no modal de vincular contrato
  let _obras = [];              // cache de obras
  let _usuarios = [];           // cache de usuários
  let _contratos = [];          // cache de contratos (para vincular)
  let _itemCounter = 0;         // contador de linhas de itens no form
  let _anexosPendentes = [];    // arquivos escolhidos antes de salvar RDC nova
  // Metadados opcionais do Coloridão
  let _rdcAtividadeId = null;
  let _rdcGrupoPai    = null;
  let _rdcWbs         = null;

  // ── Helpers de formatação ─────────────────────────────────────────────────
  const fmtR$ = v => {
    if (v == null || v === '') return '—';
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtDate = d => {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    return new Date(s + 'T12:00:00').toLocaleDateString('pt-BR');
  };

  const STATUS_LABEL = {
    rascunho:              '📝 Rascunho',
    aguardando_aprovacao:  '⏳ Aguard. Aprovação',
    aprovada:              '✅ Aprovada',
    em_processo:           '🔄 Em Processo',
    contratada:            '🤝 Contratada',
    cancelada:             '✕ Cancelada',
  };

  const STATUS_COLOR = {
    rascunho:             'var(--text3)',
    aguardando_aprovacao: 'var(--yellow)',
    aprovada:             'var(--teal)',
    em_processo:          'var(--blue)',
    contratada:           'var(--green)',
    cancelada:            'var(--red)',
  };

  const STATUS_BG = {
    rascunho:             'rgba(150,150,150,.12)',
    aguardando_aprovacao: 'rgba(251,191,36,.15)',
    aprovada:             'rgba(20,184,166,.12)',
    em_processo:          'rgba(59,130,246,.12)',
    contratada:           'rgba(34,197,94,.12)',
    cancelada:            'rgba(239,68,68,.12)',
  };

  function _statusBadge(s) {
    const lbl = STATUS_LABEL[s] || s;
    const col = STATUS_COLOR[s] || 'var(--text2)';
    const bg  = STATUS_BG[s]  || 'var(--surface2)';
    return `<span style="font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;background:${bg};color:${col};white-space:nowrap">${lbl}</span>`;
  }

  // ── Carregar página ───────────────────────────────────────────────────────
  async function load() {
    _renderKpis();
    _renderTabela();

    // Carrega obras para o filtro (uma vez só)
    if (_obras.length === 0) {
      try {
        const res = await API.obras();
        _obras = Array.isArray(res) ? res : (res.obras || []);
        const sel = H.el('sup-f-obra');
        if (sel) {
          _obras.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.id;
            opt.textContent = o.nome;
            sel.appendChild(opt);
          });
        }
      } catch(e) { /* ignora */ }
    }
  }

  async function _renderKpis() {
    const el = H.el('sup-kpis');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:10px 0">Carregando KPIs…</div>';
    try {
      const s = await API.rdcStats();
      const cards = [
        { lbl: 'Total de RDCs',        val: s.total || 0,             cor: 'var(--text)',   ic: '📋' },
        { lbl: 'Aguard. Aprovação',     val: s.aguardando_aprovacao || 0, cor: 'var(--yellow)', ic: '⏳' },
        { lbl: 'Em Processo',           val: s.em_processo || 0,       cor: 'var(--blue)',   ic: '🔄' },
        { lbl: 'Contratadas',           val: s.contratada || 0,        cor: 'var(--green)',  ic: '🤝' },
        { lbl: 'Vencidas',              val: s.vencidas || 0,          cor: 'var(--red)',    ic: '⚠️' },
        { lbl: 'Vencem em 7 dias',      val: s.vencendo_7d || 0,       cor: 'var(--orange)', ic: '⏰' },
      ];
      el.innerHTML = cards.map(c => `
        <div class="stat-card" style="cursor:default">
          <div class="sc-icon" style="font-size:20px">${c.ic}</div>
          <div class="sc-body">
            <div class="sc-val" style="color:${c.cor}">${c.val}</div>
            <div class="sc-lbl">${c.lbl}</div>
          </div>
        </div>
      `).join('');

      // Badge no nav
      const pendentes = (s.aguardando_aprovacao || 0) + (s.vencidas || 0);
      const nb = H.el('nb-suprimentos');
      if (nb) {
        nb.style.display = pendentes > 0 ? '' : 'none';
        nb.textContent   = pendentes;
      }
    } catch(e) {
      el.innerHTML = `<div style="color:var(--red);font-size:12px">Erro ao carregar KPIs: ${e.message}</div>`;
    }
  }

  async function _renderTabela() {
    const el = H.el('sup-tabela');
    if (!el) return;
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)"><div class="spin" style="display:inline-block"></div> Carregando…</div>';

    const status = H.el('sup-f-status')?.value || '';
    const obraId = H.el('sup-f-obra')?.value   || '';
    const resp   = H.el('sup-f-resp')?.value   || '';
    const busca  = H.el('sup-f-busca')?.value  || '';

    try {
      const params = {};
      if (status) params.status = status;
      if (obraId) params.obra_id = obraId;
      if (resp)   params.responsavel = resp;
      if (busca)  params.q = busca;

      const res  = await API.rdcs(params);
      const list = Array.isArray(res) ? res : (res.rdcs || []);

      if (list.length === 0) {
        el.innerHTML = `
          <div style="padding:60px;text-align:center;color:var(--text3)">
            <div style="font-size:42px;margin-bottom:12px;opacity:.3">🛒</div>
            <div style="font-size:14px;font-weight:600">Nenhuma RDC encontrada</div>
            <div style="font-size:12px;margin-top:6px">Ajuste os filtros ou crie uma nova Requisição de Compra.</div>
          </div>`;
        return;
      }

      // Preenche select de responsáveis no filtro
      _populaFiltroResp(list);

      el.innerHTML = `
        <table>
          <thead><tr>
            <th style="width:130px">Código</th>
            <th>Título</th>
            <th style="width:160px">Obra</th>
            <th style="width:110px;text-align:center">Status</th>
            <th style="width:140px">Responsável</th>
            <th style="width:100px;text-align:center">Prazo</th>
            <th style="width:120px;text-align:right">Valor Estimado</th>
            <th style="width:80px;text-align:center">Ações</th>
          </tr></thead>
          <tbody>
            ${list.map(r => _rowRdc(r)).join('')}
          </tbody>
        </table>`;
    } catch(e) {
      el.innerHTML = `<div style="padding:20px;color:var(--red)">Erro ao carregar RDCs: ${e.message}</div>`;
    }
  }

  function _rowRdc(r) {
    const diasRestantes = r.data_prazo ? _diasRestantes(r.data_prazo) : null;
    let prazoBadge = '—';
    if (diasRestantes !== null) {
      if (diasRestantes < 0)
        prazoBadge = `<span style="color:var(--red);font-weight:700">${Math.abs(diasRestantes)}d atraso</span>`;
      else if (diasRestantes <= 7)
        prazoBadge = `<span style="color:var(--yellow);font-weight:700">${diasRestantes}d restantes</span>`;
      else
        prazoBadge = `<span style="color:var(--text2)">${fmtDate(r.data_prazo)}</span>`;
    }

    return `
      <tr style="cursor:pointer" onclick="Suprimentos.abrirDetalhe(${r.id})">
        <td style="font-family:var(--font-m);font-size:11px;color:var(--accent)">${r.codigo || '—'}</td>
        <td style="font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${H.esc(r.titulo)}">${H.esc(r.titulo)}</td>
        <td style="font-size:11px;color:var(--text2)">${H.esc(r.obra_nome || '—')}</td>
        <td style="text-align:center">${_statusBadge(r.status)}</td>
        <td style="font-size:12px;color:var(--text2)">${H.esc(r.responsavel_nome || r.responsavel || '—')}</td>
        <td style="text-align:center;font-size:11px">${prazoBadge}</td>
        <td style="text-align:right;font-family:var(--font-m);font-size:12px">${fmtR$(r.valor_estimado)}</td>
        <td style="text-align:center" onclick="event.stopPropagation()">
          <button class="btn btn-xs btn-o" onclick="Suprimentos.editarRdc(${r.id})" title="Editar">✏</button>
        </td>
      </tr>`;
  }

  function _diasRestantes(dataStr) {
    const s = String(dataStr).slice(0, 10);
    const d = new Date(s + 'T12:00:00');
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    return Math.round((d - hoje) / 86400000);
  }

  function _populaFiltroResp(list) {
    const sel = H.el('sup-f-resp');
    if (!sel) return;
    const atual = sel.value;
    const respSet = new Set();
    list.forEach(r => { if (r.responsavel) respSet.add(r.responsavel); });
    // Mantém apenas a opção vazia e as encontradas
    sel.innerHTML = '<option value="">Todos responsáveis</option>';
    [...respSet].sort().forEach(login => {
      const opt = document.createElement('option');
      opt.value = login;
      // Tenta achar nome completo
      const found = list.find(r => r.responsavel === login);
      opt.textContent = found?.responsavel_nome || login;
      sel.appendChild(opt);
    });
    sel.value = atual;
  }

  function limparFiltros() {
    ['sup-f-status','sup-f-obra','sup-f-resp'].forEach(id => {
      const el = H.el(id);
      if (el) el.value = '';
    });
    const b = H.el('sup-f-busca');
    if (b) b.value = '';
    load();
  }

  // ── Modal: Nova RDC ───────────────────────────────────────────────────────
  async function novaRdc(prefill = {}) {
    _rdcEmEdicao    = null;
    _itemCounter    = 0;
    _anexosPendentes = [];
    _rdcAtividadeId = prefill.atividade_id || null;
    _rdcGrupoPai    = prefill.grupo_pai    || null;
    _rdcWbs         = prefill.wbs          || null;

    H.el('rdc-form-title').textContent = '🛒 NOVA REQUISIÇÃO DE COMPRA';
    H.el('rdc-titulo').value    = prefill.titulo || '';
    H.el('rdc-prazo').value     = prefill.data_prazo ? String(prefill.data_prazo).slice(0, 10) : '';
    H.el('rdc-valor').value     = '';
    H.el('rdc-obs').value       = prefill.observacoes || '';
    H.el('rdc-itens-wrap').innerHTML = '';
    H.el('rdc-total-display').textContent = 'R$ 0,00';
    _renderFormAnexos();

    await _populaFormSelects(prefill.obra_id);
    UI.openModal('modal-rdc-form');
  }

  async function editarRdc(id) {
    try {
      const r = await API.rdc(id);
      _rdcEmEdicao    = id;
      _itemCounter    = 0;
      _anexosPendentes = [];
      _rdcAtividadeId = r.atividade_id || null;
      _rdcGrupoPai    = r.grupo_pai    || null;
      _rdcWbs         = r.wbs          || null;

      H.el('rdc-form-title').textContent = `✏ EDITAR RDC — ${r.codigo}`;
      H.el('rdc-titulo').value    = r.titulo || '';
      H.el('rdc-prazo').value     = r.data_prazo ? String(r.data_prazo).slice(0, 10) : '';
      H.el('rdc-valor').value     = r.valor_estimado || '';
      H.el('rdc-obs').value       = r.observacoes || '';
      H.el('rdc-itens-wrap').innerHTML = '';

      await _populaFormSelects(r.obra_id, r.responsavel);

      (r.itens || []).forEach(it => _addItemRow(it));
      _recalcTotal();
      _renderFormAnexos(r.anexos || []);

      UI.openModal('modal-rdc-form');
    } catch(e) {
      UI.toast('Erro ao carregar RDC: ' + e.message, 'error');
    }
  }

  async function _populaFormSelects(obraId, responsavelLogin) {
    // Obras
    if (_obras.length === 0) {
      const res = await API.obras();
      _obras = Array.isArray(res) ? res : (res.obras || []);
    }
    const selObra = H.el('rdc-obra');
    selObra.innerHTML = '<option value="">— Selecione a obra —</option>';
    _obras.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.nome;
      if (o.id == obraId) opt.selected = true;
      selObra.appendChild(opt);
    });

    // Responsáveis (usuários)
    if (_usuarios.length === 0) {
      try {
        const res = await API.usuarios();
        _usuarios = Array.isArray(res) ? res : (res.usuarios || []);
      } catch(e) { _usuarios = []; }
    }
    const selResp = H.el('rdc-responsavel');
    selResp.innerHTML = '<option value="">— Selecione —</option>';
    _usuarios.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.login;
      opt.textContent = u.nome || u.login;
      if (u.login === responsavelLogin) opt.selected = true;
      selResp.appendChild(opt);
    });
  }

  function _addItemRow(dados = {}) {
    const idx = _itemCounter++;
    const wrap = H.el('rdc-itens-wrap');
    const row = document.createElement('div');
    row.id = `rdc-item-row-${idx}`;
    row.className = 'citem-row';
    row.style.cssText = 'display:grid;grid-template-columns:2fr 80px 100px 120px 120px 28px;gap:6px;align-items:center;margin-bottom:4px';
    row.innerHTML = `
      <input class="fi" style="font-size:11px;height:30px" placeholder="Descrição do material/serviço"
             id="rdc-it-desc-${idx}" value="${H.esc(dados.descricao||'')}">
      <input class="fi" style="font-size:11px;height:30px;text-align:center" placeholder="UN"
             id="rdc-it-un-${idx}" value="${H.esc(dados.unidade||'UN')}">
      <input class="fi" style="font-size:11px;height:30px;text-align:right;font-family:var(--font-m)" placeholder="0"
             id="rdc-it-qtd-${idx}" type="number" min="0" step="any" value="${dados.quantidade||''}"
             oninput="Suprimentos._onItemChange(${idx})">
      <input class="fi" style="font-size:11px;height:30px;text-align:right;font-family:var(--font-m)" placeholder="0,00"
             id="rdc-it-unit-${idx}" type="number" min="0" step="0.01" value="${dados.custo_unitario||''}"
             oninput="Suprimentos._onItemChange(${idx})">
      <input class="fi" readonly style="font-size:11px;height:30px;text-align:right;font-family:var(--font-m);background:var(--surface3);color:var(--text2)"
             id="rdc-it-total-${idx}" value="${dados.custo_total ? Number(dados.custo_total).toFixed(2) : ''}">
      <button class="btn btn-xs btn-r" onclick="Suprimentos._removeItemRow(${idx})" style="height:30px;padding:0 8px">✕</button>`;
    wrap.appendChild(row);
    _onItemChange(idx);
  }

  function _onItemChange(idx) {
    const qtd  = parseFloat(H.el(`rdc-it-qtd-${idx}`)?.value) || 0;
    const unit = parseFloat(H.el(`rdc-it-unit-${idx}`)?.value) || 0;
    const tot  = qtd * unit;
    const elT  = H.el(`rdc-it-total-${idx}`);
    if (elT) elT.value = tot > 0 ? tot.toFixed(2) : '';
    _recalcTotal();
  }

  function _removeItemRow(idx) {
    H.el(`rdc-item-row-${idx}`)?.remove();
    _recalcTotal();
  }

  function _recalcTotal() {
    let total = 0;
    document.querySelectorAll('[id^="rdc-it-total-"]').forEach(el => {
      total += parseFloat(el.value) || 0;
    });
    const disp = H.el('rdc-total-display');
    if (disp) disp.textContent = 'R$ ' + total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Atualiza também o campo valor se estava em branco
    const valEl = H.el('rdc-valor');
    if (valEl && !valEl.dataset.manuallySet && total > 0) {
      valEl.value = total.toFixed(2);
    }
  }

  // ── Dropzone de anexos no formulário ──────────────────────────────────────
  // anexosSalvos: array de anexos já persistidos (para edição de RDC existente)
  function _renderFormAnexos(anexosSalvos = []) {
    const wrap = H.el('rdc-form-anexos-wrap');
    if (!wrap) return;

    const TIPO_IC = { img: '🖼', pdf: '📄', doc: '📊', other: '📎' };

    const renderPendentes = () => {
      const ul = wrap.querySelector('#rdc-anexos-pendentes');
      if (!ul) return;
      ul.innerHTML = _anexosPendentes.length === 0
        ? '<div style="font-size:11px;color:var(--text3);font-style:italic">Nenhum arquivo selecionado</div>'
        : _anexosPendentes.map((f, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:16px">📎</span>
              <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${H.esc(f.name)}</span>
              <span style="font-size:10px;color:var(--text3)">${(f.size/1024).toFixed(0)} KB</span>
              <button onclick="Suprimentos._removerAnexoPendente(${i})"
                      style="background:none;border:none;cursor:pointer;color:var(--red);font-size:13px;padding:0 4px"
                      title="Remover">✕</button>
            </div>`).join('');
    };

    const salvosList = anexosSalvos.length === 0 ? '' : `
      <div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.8px;color:var(--text3);margin-bottom:6px">JÁ ANEXADOS</div>
        ${anexosSalvos.map(a => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:16px">${TIPO_IC[a.tipo] || '📎'}</span>
            <a href="${H.esc(a.url_view || '#')}" target="_blank" rel="noopener"
               style="flex:1;font-size:11px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
               title="${H.esc(a.nome)}">${H.esc(a.nome)}</a>
            <span style="font-size:10px;color:var(--text3)">${H.esc(a.tamanho || '')}</span>
          </div>`).join('')}
      </div>`;

    wrap.innerHTML = `
      ${salvosList}
      <div style="font-size:10px;font-weight:700;letter-spacing:.8px;color:var(--text3);margin-bottom:6px">ADICIONAR NOVOS ARQUIVOS</div>
      <div id="rdc-form-dropzone"
           ondragover="event.preventDefault();this.classList.add('drag')"
           ondragleave="this.classList.remove('drag')"
           ondrop="Suprimentos._onDrop(event)"
           style="border:2px dashed var(--border);border-radius:var(--r);padding:16px;text-align:center;cursor:pointer;transition:border-color .15s;background:var(--bg2)"
           onclick="document.getElementById('rdc-file-input').click()">
        <div style="font-size:24px;margin-bottom:4px">📎</div>
        <div style="font-size:12px;color:var(--text2)">Arraste arquivos aqui ou <span style="color:var(--accent);font-weight:600">clique para selecionar</span></div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">PDF, imagens, Word, Excel — máx. 50 MB por arquivo</div>
        <input type="file" id="rdc-file-input" multiple style="display:none"
               onchange="Suprimentos._onFileSelect(this)">
      </div>
      <div id="rdc-anexos-pendentes" style="margin-top:8px"></div>`;

    renderPendentes();
    // guarda função para re-renderizar lista de pendentes
    wrap._refreshPendentes = renderPendentes;
  }

  function _onFileSelect(input) {
    for (const f of input.files) _anexosPendentes.push(f);
    input.value = ''; // permite selecionar o mesmo arquivo novamente
    const wrap = H.el('rdc-form-anexos-wrap');
    if (wrap?._refreshPendentes) wrap._refreshPendentes();
  }

  function _onDrop(event) {
    event.preventDefault();
    const dz = H.el('rdc-form-dropzone');
    if (dz) dz.classList.remove('drag');
    for (const f of event.dataTransfer.files) _anexosPendentes.push(f);
    const wrap = H.el('rdc-form-anexos-wrap');
    if (wrap?._refreshPendentes) wrap._refreshPendentes();
  }

  function _removerAnexoPendente(idx) {
    _anexosPendentes.splice(idx, 1);
    const wrap = H.el('rdc-form-anexos-wrap');
    if (wrap?._refreshPendentes) wrap._refreshPendentes();
  }

  async function saveRdc(statusInicial) {
    const titulo      = H.el('rdc-titulo').value.trim();
    const obra_id     = parseInt(H.el('rdc-obra').value) || null;
    const responsavel = H.el('rdc-responsavel').value || null;
    const data_prazo  = H.el('rdc-prazo').value || null;
    const valor_estimado = parseFloat(H.el('rdc-valor').value) || null;
    const observacoes = H.el('rdc-obs').value.trim() || null;

    if (!titulo)   { UI.toast('Informe o título da RDC.', 'error'); return; }
    if (!obra_id)  { UI.toast('Selecione a obra.', 'error'); return; }

    // Coleta itens
    const itens = [];
    document.querySelectorAll('[id^="rdc-it-desc-"]').forEach(el => {
      const idx  = el.id.replace('rdc-it-desc-', '');
      const desc = el.value.trim();
      if (!desc) return;
      itens.push({
        descricao:      desc,
        unidade:        H.el(`rdc-it-un-${idx}`)?.value || 'UN',
        quantidade:     parseFloat(H.el(`rdc-it-qtd-${idx}`)?.value) || null,
        custo_unitario: parseFloat(H.el(`rdc-it-unit-${idx}`)?.value) || null,
        custo_total:    parseFloat(H.el(`rdc-it-total-${idx}`)?.value) || null,
      });
    });

    const payload = {
      titulo, obra_id, responsavel, data_prazo, valor_estimado, observacoes, itens,
      atividade_id: _rdcAtividadeId || null,
      grupo_pai:    _rdcGrupoPai    || null,
      wbs:          _rdcWbs         || null,
    };

    // Descobre nome do responsável
    if (responsavel) {
      const u = _usuarios.find(u => u.login === responsavel);
      if (u) payload.responsavel_nome = u.nome || u.login;
    }

    try {
      let targetId;
      if (_rdcEmEdicao) {
        await API.updateRdc(_rdcEmEdicao, payload);
        if (statusInicial === 'aguardando_aprovacao') {
          await API.rdcStatus(_rdcEmEdicao, 'aguardando_aprovacao', 'Enviada para aprovação.');
        }
        targetId = _rdcEmEdicao;
        UI.toast('RDC atualizada com sucesso.', 'success');
      } else {
        const criada = await API.createRdc(payload);
        if (statusInicial === 'aguardando_aprovacao' && criada?.id) {
          await API.rdcStatus(criada.id, 'aguardando_aprovacao', 'Enviada para aprovação.');
        }
        targetId = criada?.id;
        UI.toast('RDC criada com sucesso.', 'success');
      }

      // Upload dos anexos pendentes (se houver)
      if (targetId && _anexosPendentes.length > 0) {
        const pendentes = [..._anexosPendentes];
        _anexosPendentes = [];
        try {
          await API.rdcUploadAnexos(targetId, pendentes);
        } catch(e) {
          UI.toast(`RDC salva, mas erro ao enviar anexos: ${e.message}`, 'error');
        }
      }

      UI.closeModal('modal-rdc-form');
      load();
    } catch(e) {
      UI.toast('Erro ao salvar RDC: ' + e.message, 'error');
    }
  }

  // ── Modal: Detalhe da RDC ─────────────────────────────────────────────────
  async function abrirDetalhe(id) {
    _rdcDetAberta = id;
    H.el('rdc-det-title').textContent = 'Carregando…';
    H.el('rdc-det-body').innerHTML = '<div style="padding:40px;text-align:center"><div class="spin" style="display:inline-block"></div></div>';
    H.el('rdc-det-footer').innerHTML = '';
    UI.openModal('modal-rdc-det');

    try {
      const r = await API.rdc(id);
      _renderDetalhe(r);
    } catch(e) {
      H.el('rdc-det-body').innerHTML = `<div style="color:var(--red);padding:20px">Erro ao carregar RDC: ${e.message}</div>`;
    }
  }

  function _renderDetalhe(r) {
    H.el('rdc-det-title').innerHTML = `
      <span style="font-family:var(--font-m);color:var(--accent)">${r.codigo || '—'}</span>
      &nbsp;${_statusBadge(r.status)}`;

    // ── Cabeçalho ──
    const body = H.el('rdc-det-body');
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:18px">
        ${_infoCard('🏗 Obra',          H.esc(r.obra_nome || '—'))}
        ${_infoCard('👤 Responsável',   H.esc(r.responsavel_nome || r.responsavel || '—'))}
        ${_infoCard('📅 Prazo',         r.data_prazo ? _prazoBadge(r.data_prazo) : '—')}
        ${_infoCard('💰 Valor Estimado',fmtR$(r.valor_estimado))}
        ${_infoCard('🗓 Criado por',    H.esc(r.criado_por || '—'))}
        ${_infoCard('📆 Data Criação',  fmtDate(r.created_at))}
      </div>
      ${r.titulo ? `<div style="font-weight:600;font-size:14px;margin-bottom:8px">${H.esc(r.titulo)}</div>` : ''}
      ${r.observacoes ? `<div style="font-size:12px;color:var(--text2);background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px;margin-bottom:16px">${H.esc(r.observacoes)}</div>` : ''}

      <!-- Itens -->
      <div style="margin-bottom:20px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--text3);margin-bottom:8px">ITENS DE MATERIAL</div>
        ${_renderItens(r.itens || [])}
      </div>

      <!-- Anexos -->
      <div style="margin-bottom:20px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--text3);margin-bottom:8px">ANEXOS</div>
        ${_renderAnexos(r.anexos || [], r.id)}
      </div>

      <!-- Comentário -->
      <div style="margin-bottom:20px">
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--text3);margin-bottom:8px">ADICIONAR COMENTÁRIO</div>
        <div style="display:flex;gap:8px">
          <textarea class="fi" id="rdc-coment-input" rows="2" placeholder="Escreva um comentário ou atualização..."
                    style="flex:1;font-size:12px;resize:vertical"></textarea>
          <button class="btn btn-o btn-sm" style="align-self:flex-end;white-space:nowrap"
                  onclick="Suprimentos.enviarComentario(${r.id})">💬 Comentar</button>
        </div>
      </div>

      <!-- Histórico -->
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:var(--text3);margin-bottom:8px">HISTÓRICO</div>
        ${_renderHistorico(r.historico || [])}
      </div>`;

    // ── Footer com ações ──
    const footer = H.el('rdc-det-footer');
    const btns = [];

    if (!['contratada','cancelada'].includes(r.status)) {
      btns.push(`<button class="btn btn-o btn-sm" onclick="Suprimentos.abrirStatus(${r.id}, '${r.status}')">⚡ Mudar Status</button>`);
    }
    if (['aprovada','em_processo'].includes(r.status)) {
      btns.push(`<button class="btn btn-sm" style="background:rgba(34,197,94,.12);color:var(--green);border:1px solid rgba(34,197,94,.3)"
                         onclick="Suprimentos.abrirVincular(${r.id}, ${r.obra_id})">🔗 Vincular Contrato</button>`);
    }
    if (!['contratada','cancelada'].includes(r.status)) {
      btns.push(`<button class="btn btn-o btn-sm" onclick="UI.closeModal('modal-rdc-det');Suprimentos.editarRdc(${r.id})">✏ Editar</button>`);
    }

    footer.innerHTML = `
      <button class="btn btn-o" onclick="UI.closeModal('modal-rdc-det')">Fechar</button>
      <div style="flex:1"></div>
      ${btns.join('')}`;
  }

  function _infoCard(lbl, val) {
    return `
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:10px 12px">
        <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--text3);margin-bottom:4px">${lbl}</div>
        <div style="font-size:13px;font-weight:500;color:var(--text)">${val}</div>
      </div>`;
  }

  function _prazoBadge(dataStr) {
    const d = _diasRestantes(dataStr);
    const s = fmtDate(dataStr);
    if (d < 0)  return `<span style="color:var(--red);font-weight:700">${s} (${Math.abs(d)}d atraso)</span>`;
    if (d <= 7) return `<span style="color:var(--yellow);font-weight:700">${s} (${d}d)</span>`;
    return `<span>${s}</span>`;
  }

  function _renderItens(itens) {
    if (!itens.length) return '<div style="font-size:12px;color:var(--text3);font-style:italic">Nenhum item cadastrado.</div>';
    return `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:var(--surface3)">
            <th style="padding:6px 10px;text-align:left;font-size:10px;letter-spacing:.5px;color:var(--text3)">DESCRIÇÃO</th>
            <th style="padding:6px 10px;text-align:center;font-size:10px;letter-spacing:.5px;color:var(--text3);width:60px">UN</th>
            <th style="padding:6px 10px;text-align:right;font-size:10px;letter-spacing:.5px;color:var(--text3);width:90px">QTD</th>
            <th style="padding:6px 10px;text-align:right;font-size:10px;letter-spacing:.5px;color:var(--text3);width:110px">VL. UNIT.</th>
            <th style="padding:6px 10px;text-align:right;font-size:10px;letter-spacing:.5px;color:var(--text3);width:110px">VL. TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${itens.map(it => `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 10px">${H.esc(it.descricao)}</td>
              <td style="padding:8px 10px;text-align:center;color:var(--text2)">${H.esc(it.unidade||'UN')}</td>
              <td style="padding:8px 10px;text-align:right;font-family:var(--font-m)">${it.quantidade ? Number(it.quantidade).toLocaleString('pt-BR') : '—'}</td>
              <td style="padding:8px 10px;text-align:right;font-family:var(--font-m)">${it.custo_unitario ? fmtR$(it.custo_unitario) : '—'}</td>
              <td style="padding:8px 10px;text-align:right;font-family:var(--font-m);font-weight:600">${it.custo_total ? fmtR$(it.custo_total) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function _renderAnexos(anexos, rdcId) {
    const TIPO_IC = { img: '🖼', pdf: '📄', doc: '📊', other: '📎' };

    const listaHtml = anexos.length === 0
      ? '<div style="font-size:12px;color:var(--text3);font-style:italic;margin-bottom:10px">Nenhum anexo.</div>'
      : `<div style="margin-bottom:12px">
          ${anexos.map(a => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:18px">${TIPO_IC[a.tipo] || '📎'}</span>
              <a href="${H.esc(a.url_view || '#')}" target="_blank" rel="noopener"
                 style="flex:1;font-size:12px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                 title="${H.esc(a.nome)}">${H.esc(a.nome)}</a>
              <span style="font-size:10px;color:var(--text3);white-space:nowrap">${H.esc(a.tamanho || '')}</span>
              <span style="font-size:10px;color:var(--text3);white-space:nowrap">${H.esc(a.enviado_por || '')}</span>
              <button onclick="Suprimentos._deletarAnexoDet(${rdcId},${a.id})"
                      style="background:none;border:none;cursor:pointer;color:var(--red);font-size:13px;padding:0 4px;flex-shrink:0"
                      title="Remover">✕</button>
            </div>`).join('')}
        </div>`;

    return `
      ${listaHtml}
      <div style="font-size:10px;font-weight:700;letter-spacing:.8px;color:var(--text3);margin-bottom:6px">ENVIAR NOVO ARQUIVO</div>
      <div id="rdc-det-dropzone"
           ondragover="event.preventDefault();this.classList.add('drag')"
           ondragleave="this.classList.remove('drag')"
           ondrop="Suprimentos._onDropDet(event,${rdcId})"
           style="border:2px dashed var(--border);border-radius:var(--r);padding:12px;text-align:center;cursor:pointer;transition:border-color .15s;background:var(--bg2)"
           onclick="document.getElementById('rdc-det-file-input').click()">
        <div style="font-size:20px;margin-bottom:2px">📎</div>
        <div style="font-size:11px;color:var(--text2)">Arraste ou <span style="color:var(--accent);font-weight:600">clique</span> para enviar</div>
        <input type="file" id="rdc-det-file-input" multiple style="display:none"
               onchange="Suprimentos._onFileSelectDet(this,${rdcId})">
      </div>
      <div id="rdc-det-upload-status" style="margin-top:6px;font-size:11px;color:var(--text3)"></div>`;
  }

  function _renderHistorico(hist) {
    if (!hist.length) return '<div style="font-size:12px;color:var(--text3);font-style:italic">Sem registros no histórico.</div>';
    return hist.map(h => {
      const tipo = h.tipo || 'comentario';
      const ic = tipo === 'status_change' ? '🔄' : tipo === 'atribuicao' ? '👤' : '💬';
      let conteudo = '';
      if (tipo === 'status_change' && h.status_anterior && h.status_novo) {
        conteudo = `${_statusBadge(h.status_anterior)} → ${_statusBadge(h.status_novo)}`;
        if (h.comentario) conteudo += `<div style="margin-top:4px;font-size:12px;color:var(--text2)">${H.esc(h.comentario)}</div>`;
      } else {
        conteudo = `<div style="font-size:12px;color:var(--text)">${H.esc(h.comentario || '')}</div>`;
      }
      return `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:18px;margin-top:2px">${ic}</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:11px;font-weight:600;color:var(--text)">${H.esc(h.usuario || '—')}</span>
              <span style="font-size:10px;color:var(--text3)">${fmtDate(h.created_at)}</span>
            </div>
            ${conteudo}
          </div>
        </div>`;
    }).join('');
  }

  // ── Anexos no modal de detalhe ────────────────────────────────────────────
  async function _uploadAnexosDet(rdcId, files) {
    if (!files || files.length === 0) return;
    const statusEl = H.el('rdc-det-upload-status');
    if (statusEl) statusEl.textContent = `Enviando ${files.length} arquivo(s)…`;
    try {
      await API.rdcUploadAnexos(rdcId, files);
      if (statusEl) statusEl.textContent = '';
      // Recarrega detalhe para refletir novos anexos
      const r = await API.rdc(rdcId);
      _renderDetalhe(r);
    } catch(e) {
      if (statusEl) statusEl.textContent = `Erro ao enviar: ${e.message}`;
      UI.toast('Erro ao enviar anexo: ' + e.message, 'error');
    }
  }

  function _onFileSelectDet(input, rdcId) {
    const files = [...input.files];
    input.value = '';
    _uploadAnexosDet(rdcId, files);
  }

  function _onDropDet(event, rdcId) {
    event.preventDefault();
    const dz = H.el('rdc-det-dropzone');
    if (dz) dz.classList.remove('drag');
    const files = [...event.dataTransfer.files];
    _uploadAnexosDet(rdcId, files);
  }

  async function _deletarAnexoDet(rdcId, anexoId) {
    if (!confirm('Remover este anexo?')) return;
    try {
      await API.rdcDeleteAnexo(rdcId, anexoId);
      UI.toast('Anexo removido.', 'success');
      const r = await API.rdc(rdcId);
      _renderDetalhe(r);
    } catch(e) {
      UI.toast('Erro ao remover anexo: ' + e.message, 'error');
    }
  }

  async function enviarComentario(rdcId) {
    const el = H.el('rdc-coment-input');
    const comentario = el?.value?.trim();
    if (!comentario) { UI.toast('Escreva um comentário antes de enviar.', 'error'); return; }
    try {
      await API.rdcComentario(rdcId, comentario);
      el.value = '';
      UI.toast('Comentário registrado.', 'success');
      // Recarrega detalhe
      const r = await API.rdc(rdcId);
      _renderDetalhe(r);
    } catch(e) {
      UI.toast('Erro ao comentar: ' + e.message, 'error');
    }
  }

  // ── Modal: Mudar Status ───────────────────────────────────────────────────
  function abrirStatus(rdcId, statusAtual) {
    _rdcStatusId = rdcId;
    H.el('rdc-status-title').textContent = 'Mudar Status da RDC';
    H.el('rdc-status-comentario').value = '';

    const sel = H.el('rdc-novo-status');
    // Remove status atual e anteriores (fluxo progressivo)
    const fluxo = ['rascunho','aguardando_aprovacao','aprovada','em_processo','contratada'];
    const idxAtual = fluxo.indexOf(statusAtual);
    [...sel.options].forEach(opt => {
      opt.disabled = opt.value === statusAtual;
    });
    sel.value = fluxo[idxAtual + 1] || 'contratada';

    UI.openModal('modal-rdc-status');
  }

  async function confirmarStatus() {
    const status    = H.el('rdc-novo-status').value;
    const comentario = H.el('rdc-status-comentario').value.trim() || null;
    try {
      await API.rdcStatus(_rdcStatusId, status, comentario);
      UI.toast('Status atualizado com sucesso.', 'success');
      UI.closeModal('modal-rdc-status');
      // Recarrega detalhe se estiver aberto
      if (_rdcDetAberta === _rdcStatusId) {
        const r = await API.rdc(_rdcStatusId);
        _renderDetalhe(r);
      }
      load();
    } catch(e) {
      UI.toast('Erro ao atualizar status: ' + e.message, 'error');
    }
  }

  // ── Modal: Vincular Contrato ──────────────────────────────────────────────
  async function abrirVincular(rdcId, obraId) {
    _rdcVincularId = rdcId;
    const sel = H.el('rdc-vincular-contrato');
    sel.innerHTML = '<option value="">Carregando…</option>';
    UI.openModal('modal-rdc-vincular');

    try {
      const res = await API.contratos({ obra_id: obraId, status: 'Vigente' });
      const list = Array.isArray(res) ? res : (res.contratos || []);
      sel.innerHTML = '<option value="">— Selecione o contrato —</option>';
      list.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.numero} — ${c.fornecedor_nome || c.fornecedor} (${c.objeto?.slice(0,50) || ''})`;
        sel.appendChild(opt);
      });
      if (!list.length) sel.innerHTML = '<option value="">Nenhum contrato vigente para esta obra</option>';
    } catch(e) {
      sel.innerHTML = `<option value="">Erro: ${e.message}</option>`;
    }
  }

  async function confirmarVincular() {
    const contrato_id = parseInt(H.el('rdc-vincular-contrato').value);
    if (!contrato_id) { UI.toast('Selecione um contrato.', 'error'); return; }
    try {
      await API.rdcVincular(_rdcVincularId, contrato_id);
      UI.toast('Contrato vinculado! RDC marcada como Contratada.', 'success');
      UI.closeModal('modal-rdc-vincular');
      if (_rdcDetAberta === _rdcVincularId) {
        const r = await API.rdc(_rdcVincularId);
        _renderDetalhe(r);
      }
      load();
    } catch(e) {
      UI.toast('Erro ao vincular: ' + e.message, 'error');
    }
  }

  // ── Integração com Coloridão ──────────────────────────────────────────────
  // Chamado pelo botão "🛒 Nova RDC" na Lista de Compras
  function novaRdcDeAtividade(atividade) {
    novaRdc({
      titulo:        `Contratação — ${atividade.grupo_pai || atividade.nome}`,
      obra_id:       atividade.obra_id,
      atividade_id:  atividade.id || null,
      grupo_pai:     atividade.grupo_pai || null,
      wbs:           atividade.wbs || null,
      data_prazo:    atividade.data_limite || atividade.data_inicio || null,
      observacoes:   `RDC gerada automaticamente a partir da atividade "${atividade.nome}" (WBS: ${atividade.wbs || '—'})`,
    });
  }

  // ── Exposição pública ─────────────────────────────────────────────────────
  return {
    load,
    novaRdc,
    editarRdc,
    saveRdc,
    abrirDetalhe,
    enviarComentario,
    abrirStatus,
    confirmarStatus,
    abrirVincular,
    confirmarVincular,
    limparFiltros,
    novaRdcDeAtividade,
    // Internos expostos para inline handlers
    _addItemRow,
    _onItemChange,
    _removeItemRow,
    _recalcTotal,
    // Anexos — formulário
    _onFileSelect,
    _onDrop,
    _removerAnexoPendente,
    // Anexos — detalhe
    _onFileSelectDet,
    _onDropDet,
    _deletarAnexoDet,
  };

})();
