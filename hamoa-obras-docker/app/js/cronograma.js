'use strict';

// ══════════════════════════════════════════════════════════════
// CRONOGRAMA — Módulo de Cronograma de Obra
// Funcionalidades: Importação .mpp/.xml, WBS colapsável, busca,
// edição de atividades, exportação XML, substituição de arquivo.
// ══════════════════════════════════════════════════════════════
const Cronograma = (() => {
  let _currentObraId  = null;
  let _currentCronId  = null;
  let _atividades     = [];
  let _cronogramas    = [];
  let _collapsed      = new Set();   // IDs das atividades resumo recolhidas
  let _searchTerm     = '';
  let _childMap       = {};          // id → [childId, ...]
  let _editingAtId    = null;        // ID da atividade em edição

  // ── Helpers de formato ─────────────────────────────────────
  function _fmt(v) {
    if (v == null) return '—';
    return parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  function _fmtDate(v) {
    if (!v) return '—';
    const [y, m, d] = String(v).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  function _barColor(pct) {
    if (pct >= 100) return 'var(--green)';
    if (pct >= 60)  return 'var(--teal)';
    if (pct >= 30)  return 'var(--blue)';
    return 'var(--yellow)';
  }

  // ── Constrói mapa de filhos ──────────────────────────────────
  function _buildChildMap(atividades) {
    const m = {};
    for (const a of atividades) m[a.id] = [];
    for (const a of atividades) {
      if (a.parent_id && m[a.parent_id]) m[a.parent_id].push(a.id);
    }
    return m;
  }

  // ── Calcula IDs visíveis respeitando _collapsed ──────────────
  function _getVisibleIds(childMap) {
    const visible = new Set();
    function visit(id, ancestorCollapsed) {
      if (!ancestorCollapsed) visible.add(id);
      const isCol = ancestorCollapsed || _collapsed.has(id);
      for (const cid of (childMap[id] || [])) visit(cid, isCol);
    }
    for (const a of _atividades) {
      if (!a.parent_id) visit(a.id, false);
    }
    return visible;
  }

  // ── Carrega lista de obras no select ───────────────────────
  async function _loadObras() {
    try {
      const obras = await API.obras();
      const sel = H.el('cron-obra');
      if (!sel) return;
      sel.innerHTML = '<option value="">Selecione a obra...</option>' +
        obras.map(o => `<option value="${o.id}">${H.esc(o.nome)}</option>`).join('');
    } catch (e) {
      UI.toast('Erro ao carregar obras: ' + e.message, 'error');
    }
  }

  // ── Carrega cronogramas da obra selecionada ─────────────────
  async function _loadCronogramas(obraId) {
    const sel = H.el('cron-sel');
    if (!sel) return;

    sel.innerHTML = '<option value="">Carregando…</option>';
    sel.disabled = true;

    try {
      _cronogramas = await API.cronogramas(obraId);
      sel.disabled = false;

      if (!_cronogramas.length) {
        sel.innerHTML = '<option value="">— nenhum cronograma importado —</option>';
        _clearWBS();
        _updateActionButtons(null);
        return;
      }

      sel.innerHTML = '<option value="">Selecione um cronograma…</option>' +
        _cronogramas.map(c => {
          const imp = c.importado_em ? new Date(c.importado_em).toLocaleDateString('pt-BR') : '—';
          return `<option value="${c.id}">v${c.versao} — ${H.esc(c.nome)} (${c.total_tarefas} tarefas · ${imp})</option>`;
        }).join('');

      // Re-seleciona se havia um cronograma ativo
      if (_currentCronId && _cronogramas.find(c => c.id === _currentCronId)) {
        sel.value = String(_currentCronId);
        _updateActionButtons(_currentCronId);
      }
    } catch (e) {
      sel.innerHTML = `<option value="">Erro: ${H.esc(e.message)}</option>`;
      sel.disabled = false;
    }
  }

  // ── Atualiza botões Substituir/Excluir ──────────────────────
  function _updateActionButtons(cronId) {
    const btnReplace = H.el('cron-btn-replace');
    const btnDelete  = H.el('cron-btn-delete');
    const show = cronId ? 'inline-flex' : 'none';
    if (btnReplace) btnReplace.style.display = show;
    if (btnDelete)  btnDelete.style.display  = show;
  }

  // ── Atualiza info pill com metadados do cronograma ──────────
  function _updateInfoPill(cronId) {
    const pill = H.el('cron-info-pill');
    if (!pill) return;
    if (!cronId) { pill.style.display = 'none'; return; }
    const c = _cronogramas.find(x => x.id === cronId);
    if (!c) { pill.style.display = 'none'; return; }
    const parts = [];
    if (c.data_inicio)   parts.push(`${_fmtDate(c.data_inicio)} → ${_fmtDate(c.data_termino)}`);
    if (c.total_tarefas) parts.push(`${c.total_tarefas} tarefas`);
    pill.textContent = parts.join(' · ');
    pill.style.display = parts.length ? 'block' : 'none';
  }

  // ── Seleciona um cronograma e exibe a árvore WBS ────────────
  async function selectCronograma(id) {
    _currentCronId = id;
    _collapsed.clear();
    _searchTerm = '';
    const srchEl = H.el('cron-wbs-search');
    if (srchEl) srchEl.value = '';
    // Sincroniza select
    const sel = H.el('cron-sel');
    if (sel && id) sel.value = String(id);
    _updateActionButtons(id);
    _updateInfoPill(id);
    await _loadAtividades(id);
  }

  // ── Handler do select de cronograma ────────────────────────
  async function onCronogramaChange() {
    const id = parseInt(H.el('cron-sel')?.value) || null;
    if (!id) {
      _currentCronId = null;
      _clearWBS();
      _updateActionButtons(null);
      _updateInfoPill(null);
      return;
    }
    await selectCronograma(id);
  }

  // ── Ações rápidas nos botões do topo ───────────────────────
  function openReplaceSelected() {
    if (_currentCronId) openReplace(_currentCronId);
  }

  async function deleteSelected() {
    if (_currentCronId) await deleteCronograma(_currentCronId);
  }

  function _clearWBS() {
    const wbsEl   = H.el('cron-wbs-wrap');
    const emptyEl = H.el('cron-empty-state');
    if (wbsEl)   { wbsEl.style.display   = 'none'; }
    if (emptyEl) { emptyEl.style.display = 'flex'; }
  }

  function _showWBS() {
    const wbsEl   = H.el('cron-wbs-wrap');
    const emptyEl = H.el('cron-empty-state');
    if (wbsEl)   { wbsEl.style.display   = 'block'; }
    if (emptyEl) { emptyEl.style.display = 'none'; }
  }

  // ── Carrega e renderiza a árvore WBS ───────────────────────
  async function _loadAtividades(cronId) {
    const tbody   = H.el('cron-wbs-tbody');
    const titleEl = H.el('cron-wbs-title');
    const countEl = H.el('cron-wbs-count');
    if (!tbody) return;

    _showWBS();
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text3);padding:20px;text-align:center">Carregando atividades...</td></tr>';

    try {
      _atividades = await API.cronogramaAtividades(cronId);
      const cron  = _cronogramas.find(c => c.id === cronId);
      if (titleEl) titleEl.textContent = cron ? `${cron.nome} (v${cron.versao})` : 'Cronograma';

      _childMap = _buildChildMap(_atividades);

      if (!_atividades.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="color:var(--text3);padding:20px;text-align:center">Nenhuma atividade encontrada neste cronograma.</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
      }

      _renderWBS();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--red);padding:20px">${H.esc(e.message)}</td></tr>`;
    }
  }

  // ── Renderiza a tabela WBS (respeitando busca e collapse) ───
  function _renderWBS() {
    const tbody   = H.el('cron-wbs-tbody');
    const countEl = H.el('cron-wbs-count');
    if (!tbody) return;

    const term = _searchTerm.toLowerCase().trim();
    let rows;

    if (term) {
      // Busca: exibe todas as atividades que casam, ignorando collapse
      rows = _atividades.filter(a => a.nome.toLowerCase().includes(term));
    } else {
      // Árvore normal com collapse
      const visible = _getVisibleIds(_childMap);
      rows = _atividades.filter(a => visible.has(a.id));
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="color:var(--text3);padding:20px;text-align:center">${term ? '🔍 Nenhuma atividade encontrada.' : 'Nenhuma atividade.'}</td></tr>`;
      if (countEl) countEl.textContent = '';
      return;
    }

    tbody.innerHTML = rows.map(a => _atividadeRowHTML(a, !!term)).join('');

    const total  = _atividades.length;
    const leafs  = _atividades.filter(a => !a.eh_resumo).length;
    if (countEl) countEl.textContent = term
      ? `${rows.length} de ${total} atividades`
      : `${leafs} tarefa${leafs !== 1 ? 's' : ''} · ${total} atividades`;
  }

  function _atividadeRowHTML(a, searchMode) {
    const indent   = a.nivel * 16;
    const pctReal  = parseFloat(a.pct_realizado_calc) || 0;
    const pctPlan  = parseFloat(a.pct_planejado) || 0;
    const desvio   = pctReal - pctPlan;
    const color    = _barColor(pctReal);
    const isResume = a.eh_resumo;
    const rowClass = isResume ? 'wbs-row-summary' : 'wbs-row-leaf';
    const isCol    = !searchMode && _collapsed.has(a.id);
    const hasKids  = ((_childMap[a.id] || []).length > 0);

    // Toggle expand/collapse
    let toggleEl;
    if (isResume && hasKids && !searchMode) {
      toggleEl = `<span class="wbs-toggle" onclick="event.stopPropagation();Cronograma.toggleCollapse(${a.id})"
                        title="${isCol ? 'Expandir' : 'Recolher'}"
                        style="cursor:pointer;color:var(--text3);font-size:10px;flex-shrink:0;min-width:14px;display:inline-block;text-align:center;user-select:none"
                  >${isCol ? '▶' : '▼'}</span>`;
    } else if (isResume) {
      toggleEl = `<span style="color:var(--text3);font-size:10px;flex-shrink:0;min-width:14px;display:inline-block;text-align:center">■</span>`;
    } else {
      toggleEl = `<span style="color:var(--text3);font-size:10px;flex-shrink:0;min-width:14px;display:inline-block;text-align:center">·</span>`;
    }

    const contratos = Array.isArray(a.contratos_vinculados) && a.contratos_vinculados.length
      ? `<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:3px">
           ${a.contratos_vinculados.map(c =>
             `<span style="background:rgba(99,102,241,.12);color:var(--accent);border-radius:6px;padding:1px 7px;font-size:9px;font-weight:600">${H.esc(c.numero)}</span>`
           ).join('')}
         </div>`
      : '';

    return `<tr class="${rowClass}" data-id="${a.id}" title="${H.esc(a.nome)}">
      <td style="padding-left:${indent + 6}px;min-width:0">
        <div style="display:flex;align-items:flex-start;gap:5px">
          ${toggleEl}
          <div style="min-width:0;flex:1">
            <div class="wbs-nome" style="${isResume ? 'font-weight:600' : ''}">${H.esc(a.nome)}</div>
            ${contratos}
          </div>
        </div>
      </td>
      <td class="tc" style="font-size:10px;color:var(--text3)">${H.esc(a.wbs || '—')}</td>
      <td class="tc">${_fmtDate(a.data_inicio)}</td>
      <td class="tc">${_fmtDate(a.data_termino)}</td>
      <td class="tc">${a.duracao != null ? a.duracao + 'd' : '—'}</td>
      <td class="tc">${_fmt(pctPlan)}</td>
      <td style="min-width:150px">
        <div style="display:flex;align-items:center;gap:7px">
          <div class="wbs-bar-bg" style="flex:1">
            <div class="wbs-bar-fill" style="width:${Math.min(100, pctReal)}%;background:${color}"></div>
          </div>
          <span style="font-size:11px;font-weight:600;color:${color};min-width:36px;text-align:right">${_fmt(pctReal)}</span>
        </div>
        ${desvio !== 0 && pctPlan > 0
          ? `<div style="font-size:9px;margin-top:2px;color:${desvio >= 0 ? 'var(--green)' : 'var(--red)'}">
               ${desvio > 0 ? '▲' : '▼'} ${Math.abs(desvio).toFixed(1)}% vs. plan.
             </div>` : ''}
      </td>
      <td class="tc">
        <button class="btn btn-xs btn-o" onclick="Cronograma.openEditAtividade(${a.id})" title="Editar">✏</button>
      </td>
    </tr>`;
  }

  // ── Expand / Collapse ────────────────────────────────────────
  function toggleCollapse(id) {
    if (_collapsed.has(id)) _collapsed.delete(id);
    else _collapsed.add(id);
    _renderWBS();
  }

  function expandAll() {
    _collapsed.clear();
    _renderWBS();
  }

  function collapseAll() {
    _atividades.forEach(a => { if (a.eh_resumo) _collapsed.add(a.id); });
    _renderWBS();
  }

  // ── Busca ────────────────────────────────────────────────────
  function onSearch() {
    _searchTerm = H.el('cron-wbs-search')?.value || '';
    _renderWBS();
  }

  function clearSearch() {
    _searchTerm = '';
    const s = H.el('cron-wbs-search');
    if (s) s.value = '';
    _renderWBS();
  }

  // ── Exportar XML ─────────────────────────────────────────────
  async function exportXml() {
    if (!_currentCronId) return;
    const cron = _cronogramas.find(c => c.id === _currentCronId);
    try {
      UI.toast('Gerando XML…', 'info');
      await API.exportCronogramaXml(_currentCronId, cron?.nome || 'cronograma');
    } catch (e) {
      UI.toast('Erro ao exportar: ' + e.message, 'error');
    }
  }

  // ── Modal de importação (novo ou substituição) ───────────────
  function openImport() {
    _openImportModal(null);
  }

  function openReplace(cronId) {
    _openImportModal(cronId);
  }

  function _openImportModal(replaceId) {
    const obraId    = parseInt(H.el('cron-obra')?.value) || _currentObraId || null;
    const modalObra = H.el('cron-imp-obra');
    const repField  = H.el('cron-imp-replace-id');
    const repBanner = H.el('cron-imp-replace-banner');
    const repName   = H.el('cron-imp-replace-nome');
    const titleEl   = H.el('cron-imp-title');

    // Preenche obra
    if (modalObra && obraId) modalObra.value = String(obraId);

    // Configura substituição
    if (repField) repField.value = replaceId ? String(replaceId) : '';

    if (replaceId) {
      const cron = _cronogramas.find(c => c.id === replaceId);
      if (repBanner) repBanner.style.display = 'block';
      if (repName)   repName.textContent      = cron ? `"${cron.nome}" (v${cron.versao})` : `ID ${replaceId}`;
      if (titleEl)   titleEl.textContent      = '🔄 SUBSTITUIR CRONOGRAMA';
    } else {
      if (repBanner) repBanner.style.display = 'none';
      if (titleEl)   titleEl.textContent      = '📅 IMPORTAR CRONOGRAMA';
    }

    // Limpa campos anteriores
    const nome   = H.el('cron-imp-nome');   if (nome)   nome.value   = '';
    const file   = H.el('cron-imp-file');   if (file)   file.value   = '';
    const fname  = H.el('cron-imp-file-name'); if (fname) fname.textContent = '';
    const status = H.el('cron-imp-status');
    if (status) { status.innerHTML = ''; status.style.display = 'none'; }

    UI.openModal('modal-cron-import');
  }

  async function submitImport() {
    const obraId    = parseInt(H.el('cron-imp-obra')?.value);
    const nome      = H.el('cron-imp-nome')?.value.trim();
    const file      = H.el('cron-imp-file')?.files?.[0];
    const replaceId = parseInt(H.el('cron-imp-replace-id')?.value) || null;
    const status    = H.el('cron-imp-status');

    if (!obraId) { UI.toast('Selecione a obra', 'error'); return; }
    if (!file)   { UI.toast('Selecione um arquivo .mpp ou .xml', 'error'); return; }

    const ext = file.name.toLowerCase().split('.').pop();
    if (!['mpp', 'xml'].includes(ext)) {
      UI.toast('Formato inválido. Use .mpp ou .xml (exportação MS Project).', 'error');
      return;
    }

    const nomeReal = nome || file.name;

    status.style.display = 'block';
    const action = replaceId ? 'Substituindo' : 'Importando';
    status.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)">
      <span class="ia-spin">⚙️</span> ${action} <b>${H.esc(file.name)}</b>… analisando atividades e WBS</div>`;

    try {
      const r = await API.importarCronograma(obraId, nomeReal, file, replaceId);
      const actionDone = replaceId ? '✅ Cronograma substituído com sucesso' : '✅ Cronograma importado com sucesso';
      status.innerHTML = `<div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:var(--r);padding:10px 14px">
        <div style="font-weight:700;color:var(--green);font-size:12px">${actionDone}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">${r.atividades} atividades · v${r.versao}</div>
      </div>`;
      UI.toast(`${r.atividades} atividades importadas`, 'success');

      setTimeout(async () => {
        UI.closeModal('modal-cron-import');
        _currentObraId = obraId;
        // Sincroniza select de obra da página principal
        const obraSelEl = H.el('cron-obra');
        if (obraSelEl) obraSelEl.value = String(obraId);
        _collapsed.clear();
        await _loadCronogramas(obraId);
        await selectCronograma(r.id);
      }, 1200);
    } catch (e) {
      status.innerHTML = `<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:var(--r);padding:10px 14px">
        <div style="font-weight:700;color:var(--red);font-size:12px">❌ Erro na importação</div>
        <div style="font-size:11px;color:var(--text2);margin-top:4px">${H.esc(e.message)}</div>
      </div>`;
    }
  }

  // ── Exclusão de cronograma ─────────────────────────────────
  async function deleteCronograma(id) {
    if (!confirm('Excluir este cronograma e todas as suas atividades?')) return;
    try {
      await API.deleteCronograma(id);
      UI.toast('Cronograma excluído', 'success');
      if (_currentCronId === id) {
        _currentCronId = null;
        _clearWBS();
        _updateActionButtons(null);
        _updateInfoPill(null);
      }
      if (_currentObraId) await _loadCronogramas(_currentObraId);
    } catch (e) { UI.toast('Erro: ' + e.message, 'error'); }
  }

  // ── Edição de atividade (modal completo) ────────────────────
  function openEditAtividade(atId) {
    const at = _atividades.find(a => a.id === atId);
    if (!at) return;
    _editingAtId = atId;

    H.el('eat-nome')?.setAttribute('value',         at.nome || '');
    H.el('eat-wbs')?.setAttribute('value',          at.wbs || '');
    H.el('eat-inicio')?.setAttribute('value',       at.data_inicio ? at.data_inicio.slice(0, 10) : '');
    H.el('eat-termino')?.setAttribute('value',      at.data_termino ? at.data_termino.slice(0, 10) : '');
    H.el('eat-duracao')?.setAttribute('value',      at.duracao != null ? String(at.duracao) : '');
    H.el('eat-pct-plan')?.setAttribute('value',     parseFloat(at.pct_planejado || 0).toFixed(1));
    H.el('eat-pct-real')?.setAttribute('value',     parseFloat(at.pct_realizado || 0).toFixed(1));
    H.el('eat-resumo-badge').style.display = at.eh_resumo ? 'inline-block' : 'none';

    // Força o valor nos inputs via .value (não apenas atributo)
    const fields = {
      'eat-nome':     at.nome || '',
      'eat-wbs':      at.wbs || '',
      'eat-inicio':   at.data_inicio  ? at.data_inicio.slice(0, 10)  : '',
      'eat-termino':  at.data_termino ? at.data_termino.slice(0, 10) : '',
      'eat-duracao':  at.duracao != null ? String(at.duracao) : '',
      'eat-pct-plan': parseFloat(at.pct_planejado || 0).toFixed(1),
      'eat-pct-real': parseFloat(at.pct_realizado || 0).toFixed(1),
    };
    for (const [id, val] of Object.entries(fields)) {
      const el = H.el(id);
      if (el) el.value = val;
    }

    const err = H.el('eat-error');
    if (err) { err.style.display = 'none'; err.textContent = ''; }

    UI.openModal('modal-cron-edit-at');
  }

  async function submitEditAtividade() {
    if (!_editingAtId) return;
    const at = _atividades.find(a => a.id === _editingAtId);

    const nome      = H.el('eat-nome')?.value.trim();
    const wbs       = H.el('eat-wbs')?.value.trim();
    const di        = H.el('eat-inicio')?.value || null;
    const df        = H.el('eat-termino')?.value || null;
    const dur       = H.el('eat-duracao')?.value;
    const pctPlan   = H.el('eat-pct-plan')?.value;
    const pctReal   = H.el('eat-pct-real')?.value;
    const errEl     = H.el('eat-error');

    if (!nome) {
      if (errEl) { errEl.textContent = 'Nome é obrigatório.'; errEl.style.display = 'block'; }
      return;
    }

    const payload = {
      nome,
      wbs:           wbs   || null,
      data_inicio:   di    || null,
      data_termino:  df    || null,
      duracao:       dur   ? parseInt(dur)         : null,
      pct_planejado: pctPlan != null && pctPlan !== '' ? parseFloat(pctPlan) : null,
      pct_realizado: pctReal != null && pctReal !== '' ? parseFloat(pctReal) : null,
    };

    try {
      const updated = await API.updateAtividade(_editingAtId, payload);
      // Atualiza localmente
      const idx = _atividades.findIndex(a => a.id === _editingAtId);
      if (idx !== -1) {
        Object.assign(_atividades[idx], updated, {
          // pct_realizado_calc pode diferir do pct_realizado se há contratos vinculados
          pct_realizado_calc: updated.pct_realizado ?? _atividades[idx].pct_realizado_calc,
        });
      }
      UI.closeModal('modal-cron-edit-at');
      _renderWBS();
      UI.toast('Atividade atualizada', 'success');
    } catch (e) {
      if (errEl) { errEl.textContent = 'Erro: ' + e.message; errEl.style.display = 'block'; }
    }
  }

  // ── (Legado) Edição rápida de % via prompt ──────────────────
  function editPct(atId, pctAtual) {
    openEditAtividade(atId);
  }

  // ── Inicializa a página ─────────────────────────────────────
  async function init() {
    _currentCronId = null;
    _atividades    = [];
    _cronogramas   = [];
    _collapsed.clear();
    _searchTerm    = '';
    _clearWBS();
    _updateActionButtons(null);

    // Carrega obras e preenche ambos os selects (página + modal)
    const obras = await API.obras().catch(() => []);
    const opHtml = '<option value="">Selecione a obra…</option>' +
      obras.map(o => `<option value="${o.id}">${H.esc(o.nome)}</option>`).join('');

    const obraEl = H.el('cron-obra');
    if (obraEl) obraEl.innerHTML = opHtml;

    const impSel = H.el('cron-imp-obra');
    if (impSel) impSel.innerHTML = '<option value="">Selecione a obra...</option>' +
      obras.map(o => `<option value="${o.id}">${H.esc(o.nome)}</option>`).join('');

    // Reset select de cronogramas
    const sel = H.el('cron-sel');
    if (sel) { sel.innerHTML = '<option value="">— selecione a obra primeiro —</option>'; sel.disabled = false; }
  }

  // ── onChange da obra ────────────────────────────────────────
  async function onObraChange() {
    const obraId = parseInt(H.el('cron-obra')?.value) || null;
    _currentObraId = obraId;
    _currentCronId = null;
    _collapsed.clear();
    _clearWBS();
    _updateActionButtons(null);
    _updateInfoPill(null);

    const sel = H.el('cron-sel');
    if (!obraId) {
      if (sel) { sel.innerHTML = '<option value="">— selecione a obra primeiro —</option>'; sel.disabled = false; }
      return;
    }
    await _loadCronogramas(obraId);
  }

  return {
    init, onObraChange, onCronogramaChange, selectCronograma,
    openImport, openReplace, openReplaceSelected, submitImport,
    deleteCronograma, deleteSelected,
    toggleCollapse, expandAll, collapseAll,
    onSearch, clearSearch,
    exportXml,
    openEditAtividade, submitEditAtividade,
    editPct,  // mantido por compatibilidade
  };
})();
