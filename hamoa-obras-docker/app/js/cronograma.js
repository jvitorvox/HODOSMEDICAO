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
  let _obras          = [];          // cache de obras (para detectar metodologia)
  let _collapsed      = new Set();   // IDs das atividades resumo recolhidas
  let _searchTerm     = '';
  let _childMap       = {};          // id → [childId, ...]
  let _editingAtId    = null;        // ID da atividade em edição
  let _vinculosData   = [];          // cache dos contratos para painel de vínculos

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
    // O CSS define #cron-wbs-wrap { display:flex } via #page-cronograma.active
    // Ocultamos com display:none e mostramos o empty state (flex via CSS também)
    const wbsEl   = H.el('cron-wbs-wrap');
    const emptyEl = H.el('cron-empty-state');
    if (wbsEl)   wbsEl.style.display   = 'none';
    if (emptyEl) emptyEl.style.display = '';   // volta ao valor definido no CSS (flex)
  }

  function _showWBS() {
    const wbsEl   = H.el('cron-wbs-wrap');
    const emptyEl = H.el('cron-empty-state');
    if (wbsEl)   wbsEl.style.display   = '';   // volta ao valor CSS (flex)
    if (emptyEl) emptyEl.style.display = 'none';
  }

  // ── Carrega e renderiza a árvore WBS ───────────────────────
  let _financeiroData = null;

  async function _loadAtividades(cronId) {
    const tbody   = H.el('cron-wbs-tbody');
    const titleEl = H.el('cron-wbs-title');
    const countEl = H.el('cron-wbs-count');
    if (!tbody) return;

    _showWBS();
    tbody.innerHTML = '<tr><td colspan="9" style="color:var(--text3);padding:20px;text-align:center">Carregando atividades...</td></tr>';

    try {
      // Busca atividades e dados financeiros em paralelo
      const [atividadesData, finData] = await Promise.all([
        API.cronogramaAtividades(cronId),
        API.cronogramaFinanceiro(cronId).catch(() => null),
      ]);
      _atividades     = atividadesData;
      _financeiroData = finData;

      const cron  = _cronogramas.find(c => c.id === cronId);
      if (titleEl) titleEl.textContent = cron ? `${cron.nome} (v${cron.versao})` : 'Cronograma';

      _childMap = _buildChildMap(_atividades);

      if (!_atividades.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="color:var(--text3);padding:20px;text-align:center">Nenhuma atividade encontrada neste cronograma.</td></tr>';
        if (countEl) countEl.textContent = '';
        _renderProgressSummary([]);
        return;
      }

      _renderProgressSummary(_atividades);
      _renderVinculosPanel();
      _renderWBS();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" style="color:var(--red);padding:20px">${H.esc(e.message)}</td></tr>`;
    }
  }

  // ── Painel de progresso geral (acima da tabela WBS) ─────────
  function _renderProgressSummary(atividades) {
    // Encontra ou cria o container do painel
    let panel = H.el('cron-progress-summary');
    if (!panel) {
      const wrap = H.el('cron-wbs-wrap');
      if (!wrap) return;
      panel = document.createElement('div');
      panel.id = 'cron-progress-summary';
      wrap.insertBefore(panel, wrap.firstChild);
    }

    if (!atividades.length) { panel.style.display = 'none'; return; }

    // Pega itens raiz (nivel=0 ou parent_id nulo)
    // Exclui do painel os cards de WBS 2, 3 e 4 (Check List, Entrega Definitiva, Inauguração)
    const _wbsExcluidos = ['2', '3', '4'];
    const roots = atividades.filter(a => !a.parent_id && !_wbsExcluidos.includes((a.wbs || '').trim()));
    if (!roots.length) { panel.style.display = 'none'; return; }

    // Se há apenas 1 raiz, mostra como barra principal
    // Se há múltiplas raízes, mostra mini-cards lado a lado
    const fmtPct = v => {
      const n = parseFloat(v) || 0;
      return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    };

    const cards = roots.map(r => {
      const pct    = parseFloat(r.pct_realizado_calc) || 0;
      const col    = _barColor(pct);
      const fonte  = r.eh_rollup ? 'consolidado das atividades' : (r.pct_medicoes != null ? 'por medições' : 'manual');

      // Conta folhas com medição neste galho
      const allDesc = _getAllDescendants(r.id);
      const totalLeafs = allDesc.filter(a => !a.eh_resumo).length;
      const withMed   = allDesc.filter(a => !a.eh_resumo && a.pct_medicoes != null).length;
      const medInfo   = totalLeafs > 0
        ? `<span style="font-size:10px;color:var(--text3)">${withMed} de ${totalLeafs} tarefas com medição</span>`
        : '';

      return `
        <div style="flex:1;min-width:220px;background:var(--surface2);border:1px solid var(--border);
                    border-radius:var(--r2);padding:14px 16px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:var(--text);flex:1;min-width:0;
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                  title="${H.esc(r.nome)}">
              ${r.wbs ? `<span style="color:var(--text3);font-size:10px;margin-right:4px">${H.esc(r.wbs)}</span>` : ''}
              ${H.esc(r.nome)}
            </span>
          </div>

          <div style="display:flex;align-items:center;gap:10px">
            <div style="flex:1;height:10px;background:var(--border);border-radius:5px;overflow:hidden">
              <div style="height:100%;width:${Math.min(100, pct)}%;background:${col};
                          border-radius:5px;transition:width .4s ease"></div>
            </div>
            <span style="font-size:22px;font-weight:800;color:${col};min-width:60px;text-align:right;
                         font-variant-numeric:tabular-nums">${fmtPct(pct)}</span>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px">
            ${medInfo}
            <span style="font-size:10px;color:var(--text3);font-style:italic">${fonte}</span>
          </div>
        </div>`;
    }).join('');

    // ── Card Financeiro ───────────────────────────────────────
    const fmtMoeda = v => {
      const n = parseFloat(v) || 0;
      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    let cardFinanceiro = '';
    if (_financeiroData && (parseFloat(_financeiroData.val_contratado) > 0 || parseFloat(_financeiroData.val_medido) > 0)) {
      const valCont  = parseFloat(_financeiroData.val_contratado) || 0;
      const valMed   = parseFloat(_financeiroData.val_medido)     || 0;
      const pctFin   = parseFloat(_financeiroData.pct_financeiro) || 0;
      const qtdCont  = parseInt(_financeiroData.qtd_contratos)    || 0;
      const valSaldo = valCont - valMed;
      const colFin   = pctFin >= 90 ? 'var(--red)' : pctFin >= 70 ? 'var(--yellow)' : 'var(--teal)';

      cardFinanceiro = `
        <div style="flex:1;min-width:220px;background:var(--surface2);border:1px solid var(--border);
                    border-radius:var(--r2);padding:14px 16px;display:flex;flex-direction:column;gap:8px;
                    border-left:3px solid var(--teal)">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:var(--text);flex:1">
              💰 Gasto Financeiro da Obra
            </span>
          </div>

          <div style="display:flex;align-items:center;gap:10px">
            <div style="flex:1;height:10px;background:var(--border);border-radius:5px;overflow:hidden">
              <div style="height:100%;width:${Math.min(100, pctFin)}%;background:${colFin};
                          border-radius:5px;transition:width .4s ease"></div>
            </div>
            <span style="font-size:22px;font-weight:800;color:${colFin};min-width:60px;text-align:right;
                         font-variant-numeric:tabular-nums">${pctFin.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%</span>
          </div>

          <div style="display:flex;flex-direction:column;gap:3px">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:10px;color:var(--text3)">Medido</span>
              <span style="font-size:13px;font-weight:800;color:${colFin}">${fmtMoeda(valMed)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:10px;color:var(--text3)">Contratado</span>
              <span style="font-size:11px;font-weight:600;color:var(--text2)">${fmtMoeda(valCont)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:10px;color:var(--text3)">Saldo disponível</span>
              <span style="font-size:11px;font-weight:600;color:${valSaldo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoeda(valSaldo)}</span>
            </div>
          </div>

          <div style="font-size:10px;color:var(--text3);font-style:italic">
            ${qtdCont} contrato${qtdCont !== 1 ? 's' : ''} vinculado${qtdCont !== 1 ? 's' : ''} · soma das medições aprovadas
          </div>
        </div>`;
    }

    // ── Card Orçado vs Realizado ─────────────────────────────────
    let cardOrcado = '';
    if (_financeiroData && parseFloat(_financeiroData.val_orcado) > 0) {
      const valOrc  = parseFloat(_financeiroData.val_orcado) || 0;
      const valReal = parseFloat(_financeiroData.val_medido)  || 0;
      const pctOrc  = valOrc > 0 ? Math.min(100, (valReal / valOrc) * 100) : 0;
      const colOrc  = pctOrc >= 90 ? 'var(--red)' : pctOrc >= 70 ? 'var(--yellow)' : 'var(--teal)';
      const valSaldo = valOrc - valReal;

      cardOrcado = `
        <div style="flex:1;min-width:220px;background:var(--surface2);border:1px solid var(--border);
                    border-radius:var(--r2);padding:14px 16px;display:flex;flex-direction:column;gap:8px;
                    border-left:3px solid var(--purple,#8b5cf6)">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:700;color:var(--text);flex:1">
              📋 Orçado vs Realizado
            </span>
          </div>

          <div style="display:flex;align-items:center;gap:10px">
            <div style="flex:1;height:10px;background:var(--border);border-radius:5px;overflow:hidden">
              <div style="height:100%;width:${pctOrc.toFixed(1)}%;background:${colOrc};
                          border-radius:5px;transition:width .4s ease"></div>
            </div>
            <span style="font-size:22px;font-weight:800;color:${colOrc};min-width:60px;text-align:right;
                         font-variant-numeric:tabular-nums">${pctOrc.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%</span>
          </div>

          <div style="display:flex;flex-direction:column;gap:3px">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:10px;color:var(--text3)">Realizado</span>
              <span style="font-size:13px;font-weight:800;color:${colOrc}">${fmtMoeda(valReal)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:10px;color:var(--text3)">Orçado</span>
              <span style="font-size:11px;font-weight:600;color:var(--text2)">${fmtMoeda(valOrc)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:10px;color:var(--text3)">Saldo orçamentário</span>
              <span style="font-size:11px;font-weight:600;color:${valSaldo >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoeda(valSaldo)}</span>
            </div>
          </div>

          <div style="font-size:10px;color:var(--text3);font-style:italic">
            Orçado = custo planejado (MS Project) · Realizado = medições aprovadas
          </div>
        </div>`;
    }

    // Título do painel
    const totalLeafsGlobal = atividades.filter(a => !a.eh_resumo).length;
    const withMedGlobal    = atividades.filter(a => !a.eh_resumo && a.pct_medicoes != null).length;

    panel.style.display = '';
    panel.innerHTML = `
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:12px;font-weight:700;color:var(--text)">📊 Progresso Geral da Obra</span>
          <span style="font-size:10px;color:var(--text3);background:var(--surface2);
                       border:1px solid var(--border);border-radius:10px;padding:1px 8px">
            ${withMedGlobal} de ${totalLeafsGlobal} tarefas com medição
          </span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${cards}${cardFinanceiro}${cardOrcado}</div>
      </div>`;
  }

  // ── Retorna todos os descendentes de um nó ──────────────────
  function _getAllDescendants(parentId) {
    const result = [];
    const kids = _childMap[parentId] || [];
    for (const cid of kids) {
      const a = _atividades.find(x => x.id === cid);
      if (a) {
        result.push(a);
        result.push(..._getAllDescendants(cid));
      }
    }
    return result;
  }

  // ── Painel de vínculos: contratos da obra × atividades WBS ──
  async function _renderVinculosPanel() {
    let panel = H.el('cron-vinculos-panel');
    if (!panel) {
      const wrap = H.el('cron-wbs-wrap');
      if (!wrap) return;
      panel = document.createElement('div');
      panel.id = 'cron-vinculos-panel';
      // Insere ABAIXO do painel de progresso mas ACIMA da tabela WBS
      const progressPanel = H.el('cron-progress-summary');
      if (progressPanel && progressPanel.nextSibling) {
        wrap.insertBefore(panel, progressPanel.nextSibling);
      } else {
        wrap.insertBefore(panel, wrap.firstChild);
      }
    }

    if (!_currentCronId) { panel.style.display = 'none'; return; }

    try {
      _vinculosData = await API.cronogramaContratosVinculos(_currentCronId);
    } catch (e) {
      panel.style.display = 'none';
      return;
    }

    if (!_vinculosData.length) { panel.style.display = 'none'; return; }

    const semVinculo  = _vinculosData.filter(c => !c.atividade_id);
    const comVinculo  = _vinculosData.filter(c =>  c.atividade_id);

    // Opções de atividades folha para o dropdown de vínculo
    const leafOpts = _atividades
      .filter(a => !a.eh_resumo)
      .map(a => `<option value="${a.id}">${a.wbs ? a.wbs + ' · ' : ''}${H.esc(a.nome)}</option>`)
      .join('');

    const fmtVal = v => (parseFloat(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});

    const rowSem = semVinculo.map(c => `
      <tr data-cid="${c.id}">
        <td style="font-size:11px;font-weight:600">${H.esc(c.numero)}</td>
        <td style="font-size:11px;color:var(--text2)">${H.esc(c.fornecedor_nome||'')}</td>
        <td style="font-size:11px;text-align:right;color:var(--text2)">${fmtVal(c.valor_total)}</td>
        <td style="min-width:260px">
          <select class="vinc-at-sel" data-cid="${c.id}"
                  style="width:100%;font-size:11px;padding:3px 6px;border-radius:var(--r);
                         border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="">— selecione a atividade WBS —</option>
            ${leafOpts}
          </select>
        </td>
        <td>
          ${Perm.has('cronogramaVinculos') ? `<button class="btn btn-xs" onclick="Cronograma.salvarVinculo(${c.id})"
                  style="font-size:10px;white-space:nowrap">🔗 Vincular</button>` : ''}
        </td>
      </tr>`).join('');

    const rowCom = comVinculo.map(c => `
      <tr data-cid="${c.id}">
        <td style="font-size:11px;font-weight:600">${H.esc(c.numero)}</td>
        <td style="font-size:11px;color:var(--text2)">${H.esc(c.fornecedor_nome||'')}</td>
        <td style="font-size:11px;text-align:right;color:var(--text2)">${fmtVal(c.valor_total)}</td>
        <td colspan="2" style="font-size:11px">
          <span style="color:var(--green)">✅</span>
          <span style="color:var(--accent);font-size:10px;font-weight:600;margin:0 4px">
            ${H.esc(c.atividade_wbs||'')}
          </span>
          <span style="color:var(--text2)">${H.esc(c.atividade_nome||'')}</span>
          <button onclick="Cronograma.removerVinculo(${c.id},${c.atividade_id})"
                  style="margin-left:8px;background:none;border:none;cursor:pointer;
                         font-size:10px;color:var(--text3)" title="Remover vínculo">✕</button>
        </td>
      </tr>`).join('');

    panel.style.display = '';
    panel.innerHTML = `
      <div style="margin-bottom:14px;border:1px solid var(--border);border-radius:var(--r2);overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:10px 14px;background:var(--surface2);border-bottom:1px solid var(--border);
                    cursor:pointer" onclick="Cronograma.toggleVinculos()">
          <span style="font-size:12px;font-weight:700;color:var(--text)">
            🔗 Vínculos Contrato × WBS
          </span>
          <span style="display:flex;align-items:center;gap:8px">
            ${semVinculo.length > 0
              ? `<span style="background:rgba(239,68,68,.12);color:var(--red);font-size:10px;
                             font-weight:700;padding:2px 8px;border-radius:10px">
                   ⚠️ ${semVinculo.length} sem vínculo
                 </span>`
              : `<span style="background:rgba(34,197,94,.12);color:var(--green);font-size:10px;
                             font-weight:700;padding:2px 8px;border-radius:10px">
                   ✅ Todos vinculados
                 </span>`}
            <span id="cron-vinculos-arrow" style="font-size:11px;color:var(--text3)">▼</span>
          </span>
        </div>
        <div id="cron-vinculos-body" style="display:${semVinculo.length > 0 ? 'block' : 'none'}">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:var(--surface2)">
                <th style="padding:6px 10px;font-size:10px;color:var(--text3);text-align:left;
                           font-weight:600;border-bottom:1px solid var(--border)">Contrato</th>
                <th style="padding:6px 10px;font-size:10px;color:var(--text3);text-align:left;
                           font-weight:600;border-bottom:1px solid var(--border)">Fornecedor</th>
                <th style="padding:6px 10px;font-size:10px;color:var(--text3);text-align:right;
                           font-weight:600;border-bottom:1px solid var(--border)">Valor</th>
                <th style="padding:6px 10px;font-size:10px;color:var(--text3);
                           font-weight:600;border-bottom:1px solid var(--border)">Atividade WBS</th>
                <th style="border-bottom:1px solid var(--border)"></th>
              </tr>
            </thead>
            <tbody>
              ${semVinculo.length > 0 ? `
                <tr><td colspan="5" style="padding:4px 10px;font-size:10px;font-weight:700;
                    color:var(--red);background:rgba(239,68,68,.05)">
                  Sem vínculo — o progresso NÃO cascateia para o cronograma</td></tr>
                ${rowSem}` : ''}
              ${comVinculo.length > 0 ? `
                <tr><td colspan="5" style="padding:4px 10px;font-size:10px;font-weight:700;
                    color:var(--green);background:rgba(34,197,94,.05)">
                  Vinculados — progresso cascateia ✅</td></tr>
                ${rowCom}` : ''}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function toggleVinculos() {
    const body  = H.el('cron-vinculos-body');
    const arrow = H.el('cron-vinculos-arrow');
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display  = isOpen ? 'none' : 'block';
    if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
  }

  async function salvarVinculo(contratoId) {
    const sel = document.querySelector(`.vinc-at-sel[data-cid="${contratoId}"]`);
    const atId = parseInt(sel?.value);
    if (!atId) { UI.toast('Selecione uma atividade WBS', 'error'); return; }
    try {
      await API.saveContratoAtividades(contratoId, [atId]);
      UI.toast('Vínculo salvo! Recarregando progresso…', 'success');
      await _loadAtividades(_currentCronId);  // recarrega tudo com novos vínculos
    } catch (e) { UI.toast('Erro: ' + e.message, 'error'); }
  }

  async function removerVinculo(contratoId, atividadeId) {
    if (!confirm('Remover vínculo deste contrato com a atividade WBS?')) return;
    try {
      await API.saveContratoAtividades(contratoId, []);
      UI.toast('Vínculo removido', 'success');
      await _loadAtividades(_currentCronId);
    } catch (e) { UI.toast('Erro: ' + e.message, 'error'); }
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
      tbody.innerHTML = `<tr><td colspan="9" style="color:var(--text3);padding:20px;text-align:center">${term ? '🔍 Nenhuma atividade encontrada.' : 'Nenhuma atividade.'}</td></tr>`;
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
    const pctPlan  = parseFloat(a.pct_planejado)       || 0;
    const pctMed   = a.pct_medicoes != null ? parseFloat(a.pct_medicoes) : null;
    const pctMan   = parseFloat(a.pct_realizado)       || 0;
    const pctEfet  = parseFloat(a.pct_realizado_calc)  || 0;  // medições → manual → 0
    const qtdCont  = parseInt(a.qtd_contratos)         || 0;
    const qtdMed   = parseInt(a.qtd_com_medicoes)      || 0;
    const isResume = a.eh_resumo;
    const rowClass = isResume ? 'wbs-row-summary' : 'wbs-row-leaf';
    const isCol    = !searchMode && _collapsed.has(a.id);
    const hasKids  = ((_childMap[a.id] || []).length > 0);

    // ── Toggle expand/collapse ────────────────────────────────
    let toggleEl;
    if (isResume && hasKids && !searchMode) {
      toggleEl = `<span class="wbs-toggle" onclick="event.stopPropagation();Cronograma.toggleCollapse(${a.id})"
                        title="${isCol ? 'Expandir' : 'Recolher'}">${isCol ? '▶' : '▼'}</span>`;
    } else if (isResume) {
      toggleEl = `<span style="color:var(--text3);font-size:10px;flex-shrink:0;min-width:14px;display:inline-block;text-align:center">■</span>`;
    } else {
      toggleEl = `<span style="color:transparent;font-size:10px;flex-shrink:0;min-width:14px;display:inline-block">·</span>`;
    }

    // ── Chips dos contratos vinculados ────────────────────────
    const contratos = Array.isArray(a.contratos_vinculados) && a.contratos_vinculados.length
      ? `<div style="margin-top:3px;display:flex;flex-wrap:wrap;gap:3px">
           ${a.contratos_vinculados.map(c =>
             `<span style="background:rgba(99,102,241,.12);color:var(--accent);border-radius:6px;padding:1px 7px;font-size:9px;font-weight:600">${H.esc(c.numero)}</span>`
           ).join('')}
         </div>`
      : '';

    // ── Coluna "Por Medições" / Roll-up ──────────────────────────
    const ehRollup   = !!a.eh_rollup;
    const pctRollup  = a.pct_rollup != null ? parseFloat(a.pct_rollup) : null;
    const rollupFil  = parseInt(a.rollup_filhos) || 0;
    const rollupMed  = parseInt(a.rollup_com_med) || 0;

    let colMedicoes;
    if (isResume && ehRollup) {
      // ── Linha resumo com progresso roll-up dos filhos ────────
      const pctVal = pctEfet;
      const barCol = _barColor(pctVal);
      const desvR  = pctVal - pctPlan;
      const desvTag = pctPlan > 0
        ? `<div style="font-size:9px;margin-top:2px;color:${desvR >= 0 ? 'var(--green)' : 'var(--red)'}">
             ${desvR >= 0 ? '▲' : '▼'} ${Math.abs(desvR).toFixed(1)}% vs. plan.
           </div>`
        : '';
      colMedicoes = `
        <div style="display:flex;align-items:center;gap:7px">
          <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden;
                      border:1px dashed rgba(99,102,241,.35)">
            <div style="height:100%;width:${Math.min(100, pctVal)}%;background:${barCol};
                        border-radius:4px;opacity:.85;
                        background:repeating-linear-gradient(45deg,${barCol},${barCol} 4px,transparent 4px,transparent 8px)"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:${barCol};min-width:38px;text-align:right">${_fmt(pctVal)}</span>
        </div>
        ${desvTag}
        <div style="font-size:9px;color:var(--accent);margin-top:2px;opacity:.8">
          ↳ consolidado de ${rollupFil} subfase${rollupFil !== 1 ? 's' : ''}
          ${rollupMed > 0 ? `· ${rollupMed} com medição` : '· sem medição'}
        </div>`;
    } else if (qtdCont === 0 && !isResume) {
      // folha sem contrato — exibe 0%
      colMedicoes = `
        <div style="display:flex;align-items:center;gap:7px">
          <div class="wbs-bar-bg" style="flex:1;opacity:.3">
            <div class="wbs-bar-fill" style="width:0%;background:var(--text3)"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:var(--text3);min-width:38px;text-align:right">0,0%</span>
        </div>`;
    } else if (qtdCont === 0 && isResume) {
      // resumo sem contrato e sem roll-up — exibe 0%
      colMedicoes = `
        <div style="display:flex;align-items:center;gap:7px">
          <div class="wbs-bar-bg" style="flex:1;opacity:.3">
            <div class="wbs-bar-fill" style="width:0%;background:var(--text3)"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:var(--text3);min-width:38px;text-align:right">0,0%</span>
        </div>`;
    } else {
      // ── Folha ou resumo com contratos diretos ────────────────
      const pctVal  = pctMed !== null ? pctMed : 0;
      const barCol  = _barColor(pctVal);
      const semMed  = qtdMed === 0;
      const label   = semMed
        ? `<span style="font-size:9px;color:var(--text3)">sem medição</span>`
        : `<span style="font-size:11px;font-weight:700;color:${barCol};min-width:38px;text-align:right">${_fmt(pctVal)}</span>`;
      const desvMed = pctVal - pctPlan;
      const desvTag = !semMed && pctPlan > 0
        ? `<div style="font-size:9px;margin-top:1px;color:${desvMed >= 0 ? 'var(--green)' : 'var(--red)'}">
             ${desvMed > 0 ? '▲' : '▼'} ${Math.abs(desvMed).toFixed(1)}% vs. plan.
           </div>`
        : '';
      const nMed = qtdMed > 0
        ? `<div style="font-size:9px;color:var(--text3);margin-top:1px">${qtdMed} medição${qtdMed !== 1 ? 'ões' : ''} · ${qtdCont} contrato${qtdCont !== 1 ? 's' : ''}</div>`
        : `<div style="font-size:9px;color:var(--text3);margin-top:1px">${qtdCont} contrato${qtdCont !== 1 ? 's' : ''} · aguarda medição</div>`;
      colMedicoes = `
        <div style="display:flex;align-items:center;gap:7px">
          <div class="wbs-bar-bg" style="flex:1;${semMed ? 'opacity:.4' : ''}">
            <div class="wbs-bar-fill" style="width:${Math.min(100, pctVal)}%;background:${barCol}"></div>
          </div>
          ${label}
        </div>
        ${desvTag}
        ${nMed}`;
    }

    // ── Coluna "Manual" ───────────────────────────────────────
    // Valor de pct_realizado digitado manualmente; usado como fallback
    // quando não há contratos vinculados.
    const manColor = qtdCont > 0 ? 'var(--text3)' : _barColor(pctMan);
    const manStyle = qtdCont > 0
      ? 'color:var(--text3);font-size:11px;text-decoration:line-through;opacity:.6'
      : `color:${manColor};font-size:11px;font-weight:700`;
    const manHint  = qtdCont > 0
      ? `<div style="font-size:9px;color:var(--text3);margin-top:1px">substituído por medições</div>`
      : (pctMan > 0 ? '' : `<div style="font-size:9px;color:var(--text3);margin-top:1px">não definido</div>`);

    // ── Coluna "Possui Contrato?" ─────────────────────────────
    const colContrato = qtdCont > 0
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;
                      background:rgba(16,185,129,.12);color:var(--green);border:1px solid rgba(16,185,129,.3)">SIM</span>`
      : `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;
                      background:var(--surface2);color:var(--text3);border:1px solid var(--border)">NÃO</span>`;

    // Estilo da linha: raiz (nivel=0) recebe destaque máximo
    const isRoot    = (a.nivel === 0 || a.nivel == null);
    const rowBg     = isRoot && isResume
      ? 'background:rgba(99,102,241,.07);border-bottom:2px solid rgba(99,102,241,.2)'
      : (isResume ? 'background:var(--surface2)' : '');
    const nomeStyle = isRoot && isResume
      ? 'font-weight:800;font-size:13px;color:var(--text)'
      : (isResume ? 'font-weight:700;font-size:12px;color:var(--text)' : '');

    return `<tr class="${rowClass}" data-id="${a.id}" title="${H.esc(a.nome)}"
                style="${rowBg}">
      <td style="padding-left:${indent + 6}px;min-width:0">
        <div style="display:flex;align-items:flex-start;gap:5px">
          ${toggleEl}
          <div style="min-width:0;flex:1">
            <div class="wbs-nome" style="${nomeStyle}">${H.esc(a.nome)}</div>
            ${contratos}
          </div>
        </div>
      </td>
      <td class="tc" style="font-size:10px;color:var(--text3)">${H.esc(a.wbs || '—')}</td>
      <td class="tc">${_fmtDate(a.data_inicio)}</td>
      <td class="tc">${_fmtDate(a.data_termino)}</td>
      <td class="tc">${a.duracao != null ? a.duracao + 'd' : '—'}</td>
      <td class="tc">${_fmt(pctPlan)}</td>

      <!-- Coluna: Custo Planejado -->
      <td style="text-align:right;font-size:11px;white-space:nowrap;padding-right:10px;vertical-align:middle">
        ${a.custo_planejado != null && parseFloat(a.custo_planejado) > 0
          ? `<span style="font-weight:${isResume ? '700' : '400'};color:${isResume ? 'var(--text)' : 'var(--text2)'}">
               ${parseFloat(a.custo_planejado).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
             </span>`
          : `<span style="color:var(--text3)">—</span>`}
      </td>

      <!-- Coluna: Por Medições / Roll-up -->
      <td style="min-width:190px">${colMedicoes}</td>

      <!-- Coluna: Manual (pct_realizado) -->
      <td style="min-width:110px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="${manStyle}">${pctMan > 0 ? _fmt(pctMan) : '—'}</span>
          ${Perm.has('cronogramaEditar') ? `<button class="btn btn-xs btn-o" onclick="Cronograma.openEditAtividade(${a.id})"
                  title="Editar atividade" style="padding:2px 6px;font-size:10px">✏</button>` : ''}
        </div>
        ${manHint}
      </td>

      <!-- Coluna: Possui Contrato? -->
      <td class="tc" style="vertical-align:middle">${colContrato}</td>
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

  // ── Log visual de importação ────────────────────────────────
  function _logStep(status, icon, msg, style = '') {
    const line = document.createElement('div');
    line.style.cssText = `display:flex;align-items:flex-start;gap:7px;font-size:12px;margin-top:5px;${style}`;
    line.innerHTML = `<span style="flex-shrink:0;margin-top:1px">${icon}</span><span>${H.esc(msg)}</span>`;
    status.appendChild(line);
    status.scrollTop = status.scrollHeight;
  }

  function _logClear(status) {
    status.innerHTML = '';
    status.style.cssText = 'display:block;max-height:280px;overflow-y:auto;padding:10px 14px;' +
      'border:1px solid var(--border);border-radius:var(--r);background:var(--bg2);font-family:monospace';
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

    const nomeReal    = nome || file.name;
    const fileSizeMB  = (file.size / (1024 * 1024)).toFixed(1);
    const CHUNK_MB    = 45;
    const isChunked   = file.size > CHUNK_MB * 1024 * 1024;
    const totalChunks = isChunked ? Math.ceil(file.size / (CHUNK_MB * 1024 * 1024)) : 1;

    _logClear(status);
    _logStep(status, '📂', `Arquivo: ${file.name} (${fileSizeMB} MB)`);
    if (isChunked) {
      _logStep(status, '✂️', `Arquivo grande — será enviado em ${totalChunks} partes de ${CHUNK_MB} MB para bypassar o limite do proxy`, 'color:var(--text2)');
    }
    _logStep(status, '⚙️', replaceId ? 'Substituindo cronograma existente…' : 'Iniciando importação…', 'color:var(--text2)');

    // Linha de progresso de chunks (atualizada dinamicamente)
    let chunkLogEl = null;
    if (isChunked) {
      chunkLogEl = document.createElement('div');
      chunkLogEl.style.cssText = 'display:flex;align-items:flex-start;gap:7px;font-size:12px;margin-top:5px;color:var(--text2)';
      chunkLogEl.innerHTML = `<span style="flex-shrink:0;margin-top:1px">📤</span><span>Enviando parte 1 de ${totalChunks}…</span>`;
      status.appendChild(chunkLogEl);
    }

    // Timers para simular progresso nas etapas de análise (após upload)
    const timers = [];
    if (!isChunked) {
      timers.push(setTimeout(() => _logStep(status, '📤', 'Enviando arquivo para o servidor…', 'color:var(--text2)'), 800));
      timers.push(setTimeout(() => _logStep(status, '🔍', `Analisando estrutura ${ext.toUpperCase()} e WBS…`, 'color:var(--text2)'), 2500));
      timers.push(setTimeout(() => _logStep(status, '🌲', 'Montando hierarquia de atividades…', 'color:var(--text2)'), 5000));
    }

    const onChunkProgress = (sent, total) => {
      if (chunkLogEl) {
        const pct = Math.round((sent / total) * 100);
        const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
        chunkLogEl.innerHTML = `<span style="flex-shrink:0;margin-top:1px">📤</span><span>Enviando parte ${sent} de ${total} — ${pct}% [${bar}]</span>`;
        if (sent === total) {
          chunkLogEl.innerHTML = `<span style="flex-shrink:0;margin-top:1px">📤</span><span>Todas as partes enviadas! Processando no servidor…</span>`;
          _logStep(status, '🔍', `Analisando estrutura ${ext.toUpperCase()} e WBS…`, 'color:var(--text2)');
          _logStep(status, '🌲', 'Montando hierarquia de atividades…', 'color:var(--text2)');
        }
      }
    };

    try {
      const r = await API.importarCronograma(obraId, nomeReal, file, replaceId, onChunkProgress);
      timers.forEach(clearTimeout);

      _logStep(status, '💾', `Salvo no banco de dados — versão v${r.versao}`);
      _logStep(status, '');  // linha em branco

      // Estatísticas
      const statLine = [
        `${r.atividades} atividades totais`,
        r.resumos   != null ? `${r.resumos} resumos` : null,
        r.folhas    != null ? `${r.folhas} folhas` : null,
        r.comCusto  != null && r.comCusto > 0 ? `${r.comCusto} com custo` : null,
        r.dataInicio  ? `início ${r.dataInicio.slice(0,10)}` : null,
        r.dataTermino ? `término ${r.dataTermino.slice(0,10)}` : null,
      ].filter(Boolean).join(' · ');
      _logStep(status, '📊', statLine, 'color:var(--text2)');

      // Avisos (atividades órfãs, sem data, etc.)
      if (r.avisos?.length) {
        _logStep(status, '');
        for (const av of r.avisos) {
          const icon = av.nivel === 'aviso' ? '⚠️' : 'ℹ️';
          const color = av.nivel === 'aviso' ? 'color:#f59e0b' : 'color:var(--text2)';
          _logStep(status, icon, av.msg, color);
        }
      }

      _logStep(status, '');
      const actionDone = replaceId ? '✅ Cronograma substituído com sucesso' : '✅ Cronograma importado com sucesso';
      _logStep(status, '✅', actionDone, 'font-weight:700;color:var(--green)');

      UI.toast(`${r.atividades} atividades importadas`, 'success');

      setTimeout(async () => {
        UI.closeModal('modal-cron-import');
        _currentObraId = obraId;
        const obraSelEl = H.el('cron-obra');
        if (obraSelEl) obraSelEl.value = String(obraId);
        _collapsed.clear();
        await _loadCronogramas(obraId);
        await selectCronograma(r.id);
      }, r.avisos?.length ? 2500 : 1200);

    } catch (e) {
      timers.forEach(clearTimeout);

      const errMsg = e.message || 'Erro desconhecido';

      // e.dica vem da API quando o erro é categorizado; fallback por texto
      let dica = e.dica || null;
      if (!dica) {
        if (/200 MB|file size/i.test(errMsg))
          dica = 'Reduza o arquivo exportando apenas parte do cronograma no MS Project.';
        else if (/\.mpp|mpxj|Java/i.test(errMsg))
          dica = 'Alternativa: Arquivo → Salvar Como → XML do Project (*.xml) no MS Project.';
        else if (/413|too large/i.test(errMsg))
          dica = 'O arquivo excedeu o limite do servidor (200 MB) ou do proxy Cloudflare (100 MB).';
        else if (/timeout|ETIMEDOUT|504/i.test(errMsg))
          dica = 'O servidor demorou muito para processar. Tente um arquivo menor ou em horário de menor uso.';
        else if (/Failed to fetch|NetworkError/i.test(errMsg))
          dica = 'Verifique sua conexão com a rede e tente novamente.';
      }

      _logStep(status, '');
      _logStep(status, '❌', 'Importação falhou', 'font-weight:700;color:var(--red)');
      _logStep(status, '▸', errMsg, 'color:var(--red)');
      if (dica) {
        _logStep(status, '');
        _logStep(status, '💡', `Dica: ${dica}`, 'color:#f59e0b;font-style:italic');
      }
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
    _obras = await API.obras().catch(() => []);
    const opHtml = '<option value="">Selecione a obra…</option>' +
      _obras.map(o => `<option value="${o.id}">${H.esc(o.nome)}</option>`).join('');

    const obraEl = H.el('cron-obra');
    if (obraEl) obraEl.innerHTML = opHtml;

    const impSel = H.el('cron-imp-obra');
    if (impSel) impSel.innerHTML = '<option value="">Selecione a obra...</option>' +
      _obras.map(o => `<option value="${o.id}">${H.esc(o.nome)}</option>`).join('');

    // Reset select de cronogramas
    const sel = H.el('cron-sel');
    if (sel) { sel.innerHTML = '<option value="">— selecione a obra primeiro —</option>'; sel.disabled = false; }

    // Inicializa painel de chat apenas se o usuário tiver permissão
    if (Perm.has('cronogramaIA') && !document.getElementById('cron-chat-panel')) _initChat();
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

    // Detecta se esta obra usa LBM
    const obra = _obras.find(o => o.id === obraId);
    const isLBM = obra?.metodologia === 'lbm';

    // Controles Gantt (select de cronograma + botões)
    const ganttControls = ['cron-sel', 'cron-btn-import'];
    ganttControls.forEach(id => {
      const el = H.el(id);
      if (el) el.style.display = isLBM ? 'none' : '';
    });

    const sel = H.el('cron-sel');
    if (!obraId) {
      if (sel) { sel.innerHTML = '<option value="">— selecione a obra primeiro —</option>'; sel.disabled = false; }
      if (typeof LBM !== 'undefined') LBM.destroy();
      return;
    }

    if (isLBM) {
      // Destrói estado Gantt e inicializa LBM
      if (typeof LBM !== 'undefined') await LBM.init(obraId);
    } else {
      // Destrói LBM (se estava ativo) e carrega cronogramas Gantt
      if (typeof LBM !== 'undefined') LBM.destroy();
      await _loadCronogramas(obraId);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CHAT IA — Painel conversacional sobre o cronograma
  // ══════════════════════════════════════════════════════════════
  let _chatHistory  = [];   // [{role:'user'|'model', text:'...'}]
  let _chatOpen     = false;
  let _chatLoading  = false;

  function _initChat() {
    // Botão flutuante
    const btn = document.createElement('button');
    btn.id        = 'cron-chat-fab';
    btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg><span>Perguntar à IA</span>`;
    btn.onclick = toggleChat;
    btn.style.cssText = `
      position:fixed; bottom:28px; right:28px; z-index:1200;
      display:flex; align-items:center; gap:8px;
      background:linear-gradient(135deg,#6366f1,#8b5cf6);
      color:#fff; border:none; border-radius:28px;
      padding:12px 20px; font-size:14px; font-weight:600;
      cursor:pointer; box-shadow:0 4px 20px rgba(99,102,241,.45);
      transition:all .2s; white-space:nowrap;`;
    btn.onmouseenter = () => btn.style.transform = 'scale(1.05)';
    btn.onmouseleave = () => btn.style.transform = '';
    document.body.appendChild(btn);

    // Painel lateral de chat
    const panel = document.createElement('div');
    panel.id = 'cron-chat-panel';
    panel.style.cssText = `
      position:fixed; top:0; right:-440px; width:420px; height:100vh; z-index:1100;
      background:#fff; box-shadow:-4px 0 30px rgba(0,0,0,.12);
      display:flex; flex-direction:column;
      transition:right .3s cubic-bezier(.4,0,.2,1);
      font-family:inherit;`;
    panel.innerHTML = `
      <div id="cron-chat-header" style="
        padding:16px 20px; border-bottom:1px solid #e5e7eb;
        background:linear-gradient(135deg,#6366f1,#8b5cf6);
        color:#fff; display:flex; align-items:center; justify-content:space-between; flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:10px">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <div>
            <div style="font-weight:700;font-size:15px">Construv IA</div>
            <div style="font-size:11px;opacity:.85">Assistente do Cronograma</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button onclick="Cronograma.clearChat()" title="Limpar conversa" style="
            background:rgba(255,255,255,.2); border:none; color:#fff; border-radius:8px;
            padding:5px 10px; font-size:11px; cursor:pointer; font-weight:600;">↺ Limpar</button>
          <button onclick="Cronograma.toggleChat()" style="
            background:rgba(255,255,255,.2); border:none; color:#fff; border-radius:8px;
            width:30px; height:30px; cursor:pointer; font-size:18px; line-height:1;">✕</button>
        </div>
      </div>

      <div id="cron-chat-messages" style="
        flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:12px;
        background:#f8f9ff;">
        <div id="cron-chat-welcome" style="
          background:#fff; border-radius:14px; padding:16px; border:1px solid #e5e7eb;
          color:#374151; font-size:13.5px; line-height:1.6;">
          <div style="font-size:22px;margin-bottom:8px">👋</div>
          <strong>Olá! Sou o assistente de cronograma Construv IA.</strong><br>
          Posso responder perguntas sobre:<br>
          <ul style="margin:8px 0 0 16px;padding:0">
            <li>Progresso de atividades e fases</li>
            <li>Status dos contratos e fornecedores</li>
            <li>Desvios de planejado × realizado</li>
            <li>Prazos e durações</li>
          </ul>
          <div style="margin-top:10px;font-size:12px;color:#6b7280">
            Experimente: <em>"Qual o progresso da infraestrutura geral?"</em>
          </div>
        </div>
      </div>

      <div id="cron-chat-suggestions" style="
        padding:8px 16px; display:flex; gap:6px; flex-wrap:wrap; flex-shrink:0;
        border-top:1px solid #e5e7eb; background:#fff;">
        ${['Qual o progresso geral?','Quais contratos estão ativos?','Há atividades atrasadas?','Quem são os fornecedores?'].map(s =>
          `<button onclick="Cronograma.chatSuggest('${s.replace(/'/g,"\\'")}') " style="
            background:#f3f4f6; border:1px solid #e5e7eb; border-radius:20px;
            padding:4px 10px; font-size:11px; color:#374151; cursor:pointer;
            transition:background .15s; white-space:nowrap;"
            onmouseenter="this.style.background='#e5e7eb'"
            onmouseleave="this.style.background='#f3f4f6'"
          >${s}</button>`
        ).join('')}
      </div>

      <div style="padding:12px 16px; border-top:1px solid #e5e7eb; background:#fff; flex-shrink:0;">
        <div style="display:flex;gap:8px;align-items:flex-end">
          <textarea id="cron-chat-input" rows="2" placeholder="Faça uma pergunta sobre o cronograma..." style="
            flex:1; border:1.5px solid #d1d5db; border-radius:12px; padding:10px 12px;
            font-size:13.5px; font-family:inherit; resize:none; outline:none; line-height:1.4;
            transition:border-color .2s;"
            onfocus="this.style.borderColor='#6366f1'"
            onblur="this.style.borderColor='#d1d5db'"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();Cronograma.sendChat()}"
          ></textarea>
          <button id="cron-chat-send" onclick="Cronograma.sendChat()" style="
            background:linear-gradient(135deg,#6366f1,#8b5cf6); border:none; color:#fff;
            border-radius:12px; width:42px; height:42px; cursor:pointer; font-size:18px;
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 2px 8px rgba(99,102,241,.3); flex-shrink:0;
            transition:opacity .2s;">➤</button>
        </div>
        <div style="font-size:11px;color:#9ca3af;margin-top:6px;text-align:center">
          Enter para enviar · Shift+Enter para nova linha
        </div>
      </div>`;
    document.body.appendChild(panel);
  }

  function toggleChat() {
    _chatOpen = !_chatOpen;
    const panel = document.getElementById('cron-chat-panel');
    const fab   = document.getElementById('cron-chat-fab');
    if (panel) panel.style.right = _chatOpen ? '0' : '-440px';
    if (fab)   fab.style.right   = _chatOpen ? '448px' : '28px';
    if (_chatOpen) {
      setTimeout(() => {
        const inp = document.getElementById('cron-chat-input');
        if (inp) inp.focus();
      }, 320);
    }
  }

  function clearChat() {
    _chatHistory = [];
    const msgs = document.getElementById('cron-chat-messages');
    if (!msgs) return;
    msgs.innerHTML = `<div id="cron-chat-welcome" style="
      background:#fff; border-radius:14px; padding:16px; border:1px solid #e5e7eb;
      color:#374151; font-size:13.5px; line-height:1.6;">
      <div style="font-size:22px;margin-bottom:8px">👋</div>
      <strong>Conversa reiniciada.</strong> Como posso ajudar?
    </div>`;
  }

  function chatSuggest(text) {
    const inp = document.getElementById('cron-chat-input');
    if (inp) { inp.value = text; inp.focus(); }
  }

  function _appendMessage(role, text) {
    const msgs = document.getElementById('cron-chat-messages');
    if (!msgs) return;
    // Remove welcome se ainda existir
    const welcome = document.getElementById('cron-chat-welcome');
    if (welcome) welcome.remove();

    const isUser = role === 'user';
    const div = document.createElement('div');
    div.style.cssText = `display:flex; flex-direction:column; align-items:${isUser ? 'flex-end' : 'flex-start'}`;

    // Converte markdown simples para HTML
    const html = text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:#f3f4f6;padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
      .replace(/\n/g, '<br>');

    div.innerHTML = `
      <div style="
        max-width:88%; padding:10px 14px; border-radius:${isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};
        background:${isUser ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : '#fff'};
        color:${isUser ? '#fff' : '#1f2937'};
        font-size:13.5px; line-height:1.6;
        border:${isUser ? 'none' : '1px solid #e5e7eb'};
        box-shadow:0 1px 4px rgba(0,0,0,.07);">
        ${html}
      </div>
      <div style="font-size:10px;color:#9ca3af;margin:3px 4px">
        ${isUser ? 'Você' : '🤖 Construv IA'} · agora
      </div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function _appendTyping() {
    const msgs = document.getElementById('cron-chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.id = 'cron-chat-typing';
    div.style.cssText = 'display:flex;align-items:flex-start';
    div.innerHTML = `<div style="
      background:#fff; border:1px solid #e5e7eb; border-radius:14px 14px 14px 4px;
      padding:12px 16px; box-shadow:0 1px 4px rgba(0,0,0,.07);">
      <span style="display:inline-flex;gap:4px">
        <span style="width:7px;height:7px;background:#6366f1;border-radius:50%;animation:bounce .8s infinite .0s"></span>
        <span style="width:7px;height:7px;background:#6366f1;border-radius:50%;animation:bounce .8s infinite .15s"></span>
        <span style="width:7px;height:7px;background:#6366f1;border-radius:50%;animation:bounce .8s infinite .3s"></span>
      </span>
    </div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;

    // Injeta animação se ainda não existir
    if (!document.getElementById('cron-chat-style')) {
      const s = document.createElement('style');
      s.id = 'cron-chat-style';
      s.textContent = `@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`;
      document.head.appendChild(s);
    }
  }

  async function sendChat() {
    if (_chatLoading) return;
    if (!_currentCronId) { alert('Selecione um cronograma primeiro.'); return; }
    const inp = document.getElementById('cron-chat-input');
    const msg = inp?.value?.trim();
    if (!msg) return;

    inp.value = '';
    _chatLoading = true;
    const sendBtn = document.getElementById('cron-chat-send');
    if (sendBtn) sendBtn.style.opacity = '.4';

    _appendMessage('user', msg);
    _appendTyping();

    try {
      const result = await API.cronogramaChat(_currentCronId, msg, _chatHistory);
      const reply  = result?.reply || '(sem resposta)';
      document.getElementById('cron-chat-typing')?.remove();
      _appendMessage('model', reply);
      _chatHistory.push({ role: 'user',  text: msg });
      _chatHistory.push({ role: 'model', text: reply });
      // Limita histórico a 20 turnos para não exceder tokens
      if (_chatHistory.length > 40) _chatHistory = _chatHistory.slice(-40);
    } catch (err) {
      document.getElementById('cron-chat-typing')?.remove();
      _appendMessage('model', `❌ Erro: ${err.message}`);
    } finally {
      _chatLoading = false;
      if (sendBtn) sendBtn.style.opacity = '1';
      inp?.focus();
    }
  }

  return {
    init, onObraChange, onCronogramaChange, selectCronograma,
    openImport, openReplace, openReplaceSelected, submitImport,
    deleteCronograma, deleteSelected,
    toggleCollapse, expandAll, collapseAll,
    onSearch, clearSearch,
    exportXml,
    openEditAtividade, submitEditAtividade,
    editPct,
    toggleVinculos, salvarVinculo, removerVinculo,
    // Chat IA
    toggleChat, clearChat, chatSuggest, sendChat,
  };
})();
