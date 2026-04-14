'use strict';

// ══════════════════════════════════════════════════════════════
// LBM — Location Based Management
// Aba Locais · Serviços · Mapa de Progresso · Linha de Balanço
// ══════════════════════════════════════════════════════════════
const LBM = (() => {
  let _obraId     = null;
  let _locais     = [];    // árvore hierárquica
  let _locaisFlat = [];    // lista plana (com path)
  let _servicos   = [];
  let _progresso  = {};    // mapa "servico_id_local_id" → cell
  let _fornecedores = [];
  let _contratos    = [];
  let _activeTab  = 'locais';

  // ── Status helpers ──────────────────────────────────────────
  const STATUS_LABEL = {
    nao_iniciado: 'Não iniciado',
    em_andamento: 'Em andamento',
    concluido:    'Concluído',
    atrasado:     'Atrasado',
    bloqueado:    'Bloqueado',
  };
  const STATUS_COLOR = {
    nao_iniciado: '#64748b',
    em_andamento: '#3b82f6',
    concluido:    '#22c55e',
    atrasado:     '#ef4444',
    bloqueado:    '#f59e0b',
  };
  function _statusBadge(s) {
    const lbl = STATUS_LABEL[s] || s;
    const col = STATUS_COLOR[s] || '#64748b';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${col}22;color:${col};border:1px solid ${col}44">${lbl}</span>`;
  }
  function _fmtDate(v) {
    if (!v) return '—';
    const [y, m, d] = String(v).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  function _isoToInput(v) {
    if (!v) return '';
    return String(v).slice(0, 10);
  }

  // ══════════════════════════════════════════════════════════════
  // RENDERIZAÇÃO DO CONTAINER LBM
  // ══════════════════════════════════════════════════════════════
  function _renderContainer(obraId) {
    const wrap = H.el('cron-lbm-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="lbm-tabs">
        <button class="lbm-tab lbm-tab-active" onclick="LBM.switchTab('locais')" id="lbm-tab-locais">🏢 Locais</button>
        <button class="lbm-tab" onclick="LBM.switchTab('servicos')" id="lbm-tab-servicos">🔧 Serviços</button>
        <button class="lbm-tab" onclick="LBM.switchTab('progresso')" id="lbm-tab-progresso">📊 Mapa de Progresso</button>
        <button class="lbm-tab" onclick="LBM.switchTab('balanco')" id="lbm-tab-balanco">📈 Linha de Balanço</button>
        <div style="flex:1"></div>
        <button class="btn btn-sm" style="background:rgba(139,92,246,.12);color:#8b5cf6;border:1px solid rgba(139,92,246,.3)" onclick="LBM.openImportIA()">✨ Importar via IA</button>
        <button class="btn btn-sm btn-a" onclick="LBM.openCalcPlano()" id="lbm-btn-calc" style="display:none">⚙️ Calcular Plano</button>
      </div>
      <div id="lbm-panel-locais" class="lbm-panel"></div>
      <div id="lbm-panel-servicos" class="lbm-panel" style="display:none"></div>
      <div id="lbm-panel-progresso" class="lbm-panel" style="display:none"></div>
      <div id="lbm-panel-balanco" class="lbm-panel" style="display:none"></div>

      <!-- Modal Locais -->
      <div id="lbm-modal-local" class="modal-overlay" style="display:none" onclick="if(event.target===this)LBM.closeLocalModal()">
        <div class="modal-box" style="max-width:440px">
          <div class="modal-header">
            <span id="lbm-modal-local-title">Novo Local</span>
            <button class="modal-close" onclick="LBM.closeLocalModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Nome *</label>
              <input id="lbm-local-nome" class="form-input" type="text" placeholder="Ex: Pavimento 1, Bloco A…">
            </div>
            <div class="form-group">
              <label class="form-label">Tipo</label>
              <select id="lbm-local-tipo" class="fsel" style="width:100%">
                <option value="bloco">Bloco</option>
                <option value="pavimento">Pavimento</option>
                <option value="apartamento">Apartamento</option>
                <option value="sala">Sala</option>
                <option value="area">Área</option>
                <option value="local" selected>Local</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Pai (opcional)</label>
              <select id="lbm-local-pai" class="fsel" style="width:100%">
                <option value="">— Nível raiz —</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-o" onclick="LBM.closeLocalModal()">Cancelar</button>
            <button class="btn btn-a" onclick="LBM.saveLocal()">Salvar</button>
          </div>
        </div>
      </div>

      <!-- Modal Serviços -->
      <div id="lbm-modal-servico" class="modal-overlay" style="display:none" onclick="if(event.target===this)LBM.closeServicoModal()">
        <div class="modal-box" style="max-width:500px">
          <div class="modal-header">
            <span id="lbm-modal-servico-title">Novo Serviço</span>
            <button class="modal-close" onclick="LBM.closeServicoModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Nome *</label>
              <input id="lbm-serv-nome" class="form-input" type="text" placeholder="Ex: Alvenaria, Reboco, Instalação Elétrica…">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group">
                <label class="form-label">Unidade</label>
                <input id="lbm-serv-unidade" class="form-input" type="text" placeholder="m², un, m…" value="un">
              </div>
              <div class="form-group">
                <label class="form-label">Cor</label>
                <input id="lbm-serv-cor" type="color" value="#3B82F6" style="width:100%;height:36px;border:1px solid var(--border);border-radius:var(--r);cursor:pointer;padding:2px">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group">
                <label class="form-label">Ritmo previsto</label>
                <input id="lbm-serv-ritmo" class="form-input" type="number" step="0.1" placeholder="Ex: 1.5">
              </div>
              <div class="form-group">
                <label class="form-label">Unid. de Ritmo</label>
                <input id="lbm-serv-ritmo-un" class="form-input" type="text" placeholder="local/dia" value="local/dia">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Duração por local (dias)</label>
              <input id="lbm-serv-duracao" class="form-input" type="number" min="1" value="1">
            </div>
            <div class="form-group">
              <label class="form-label">Fornecedor (opcional)</label>
              <select id="lbm-serv-fornecedor" class="fsel" style="width:100%" onchange="LBM.onFornecedorChange()">
                <option value="">— sem fornecedor —</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Contratos vinculados (opcional)</label>
              <div id="lbm-serv-contratos-wrap" style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;min-height:38px;background:var(--surface);max-height:160px;overflow-y:auto">
                <span style="font-size:11px;color:var(--text3)">Selecione um fornecedor primeiro</span>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-o" onclick="LBM.closeServicoModal()">Cancelar</button>
            <button class="btn btn-a" onclick="LBM.saveServico()">Salvar</button>
          </div>
        </div>
      </div>

      <!-- Modal Calcular Plano -->
      <div id="lbm-modal-plano" class="modal-overlay" style="display:none" onclick="if(event.target===this)LBM.closePlanoModal()">
        <div class="modal-box" style="max-width:420px">
          <div class="modal-header">
            <span>⚙️ Calcular Plano LBM</span>
            <button class="modal-close" onclick="LBM.closePlanoModal()">✕</button>
          </div>
          <div class="modal-body">
            <p style="font-size:13px;color:var(--text2);margin:0 0 16px">Gera automaticamente as datas planejadas de início e fim para cada célula Local × Serviço, com base na duração por local e data de início.</p>
            <div class="form-group">
              <label class="form-label">Data de início da obra *</label>
              <input id="lbm-plano-inicio" class="form-input" type="date">
            </div>
            <div class="form-group">
              <label class="form-label">Intervalo entre locais (dias)</label>
              <input id="lbm-plano-intervalo" class="form-input" type="number" min="0" value="0" placeholder="0 = sem folga">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-o" onclick="LBM.closePlanoModal()">Cancelar</button>
            <button class="btn btn-a" onclick="LBM.submitCalcPlano()">Calcular</button>
          </div>
        </div>
      </div>

      <!-- Modal Célula de Progresso -->
      <div id="lbm-modal-cell" class="modal-overlay" style="display:none" onclick="if(event.target===this)LBM.closeCellModal()">
        <div class="modal-box" style="max-width:440px">
          <div class="modal-header">
            <span id="lbm-modal-cell-title">Progresso</span>
            <button class="modal-close" onclick="LBM.closeCellModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Status</label>
              <select id="lbm-cell-status" class="fsel" style="width:100%">
                <option value="nao_iniciado">Não iniciado</option>
                <option value="em_andamento">Em andamento</option>
                <option value="concluido">Concluído</option>
                <option value="atrasado">Atrasado</option>
                <option value="bloqueado">Bloqueado</option>
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group">
                <label class="form-label">Início planejado</label>
                <input id="lbm-cell-ini-plan" class="form-input" type="date">
              </div>
              <div class="form-group">
                <label class="form-label">Fim planejado</label>
                <input id="lbm-cell-fim-plan" class="form-input" type="date">
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group">
                <label class="form-label">Início real</label>
                <input id="lbm-cell-ini-real" class="form-input" type="date">
              </div>
              <div class="form-group">
                <label class="form-label">Fim real</label>
                <input id="lbm-cell-fim-real" class="form-input" type="date">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Observação</label>
              <textarea id="lbm-cell-obs" class="form-input" rows="2" style="resize:vertical"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-o" onclick="LBM.closeCellModal()">Cancelar</button>
            <button class="btn btn-a" onclick="LBM.saveCell()">Salvar</button>
          </div>
        </div>
      </div>

      <!-- Modal Diagnóstico / Sincronização de Medições -->
      <div id="lbm-modal-diag" class="modal-overlay" style="display:none" onclick="if(event.target===this)LBM.closeDiagnostico()">
        <div class="modal-box" style="max-width:620px;max-height:90vh;display:flex;flex-direction:column">
          <div class="modal-header">
            <span>🔄 Sincronização com Medições</span>
            <button class="modal-close" onclick="LBM.closeDiagnostico()">✕</button>
          </div>
          <div class="modal-body" style="flex:1;overflow:auto" id="lbm-diag-body">
            <div style="text-align:center;padding:32px;color:var(--text3)">Carregando diagnóstico…</div>
          </div>
          <div class="modal-footer" id="lbm-diag-footer">
            <button class="btn btn-o" onclick="LBM.closeDiagnostico()">Fechar</button>
          </div>
        </div>
      </div>

      <!-- Modal Importação via IA -->
      <div id="lbm-modal-ia" class="modal-overlay" style="display:none" onclick="if(event.target===this)LBM.closeImportIA()">
        <div class="modal-box" style="max-width:640px;max-height:90vh;display:flex;flex-direction:column">
          <div class="modal-header">
            <span>✨ Importar LBM via Inteligência Artificial</span>
            <button class="modal-close" onclick="LBM.closeImportIA()">✕</button>
          </div>
          <div class="modal-body" style="flex:1;overflow:auto" id="lbm-ia-body">
            <!-- Conteúdo dinâmico: upload → loading → preview → confirmar -->
          </div>
          <div class="modal-footer" id="lbm-ia-footer">
            <button class="btn btn-o" onclick="LBM.closeImportIA()">Cancelar</button>
          </div>
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════
  // ABAS
  // ══════════════════════════════════════════════════════════════
  async function switchTab(tab) {
    _activeTab = tab;
    ['locais','servicos','progresso','balanco'].forEach(t => {
      const btn = H.el(`lbm-tab-${t}`);
      const panel = H.el(`lbm-panel-${t}`);
      if (btn) btn.className = 'lbm-tab' + (t === tab ? ' lbm-tab-active' : '');
      if (panel) panel.style.display = t === tab ? '' : 'none';
    });
    const btnCalc = H.el('lbm-btn-calc');
    if (btnCalc) btnCalc.style.display = (tab === 'progresso' || tab === 'balanco') ? '' : 'none';

    if (tab === 'locais')    _renderLocais();
    if (tab === 'servicos')  _renderServicos();
    if (tab === 'progresso') { await _loadProgresso(); _renderProgresso(); }
    if (tab === 'balanco')   { await _loadProgresso(); _renderBalanco(); }
  }

  // ══════════════════════════════════════════════════════════════
  // TAB LOCAIS
  // ══════════════════════════════════════════════════════════════
  function _renderLocais() {
    const panel = H.el('lbm-panel-locais');
    if (!panel) return;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Locais da Obra</span>
        <span style="font-size:11px;color:var(--text3)">(hierárquicos)</span>
        <div style="flex:1"></div>
        <button class="btn btn-sm btn-a" onclick="LBM.openLocalModal()">+ Novo Local</button>
      </div>
      <div id="lbm-locais-tree" style="padding:12px 16px;overflow:auto;flex:1"></div>
    `;
    _renderLocaisTree();
  }

  function _renderLocaisTree() {
    const container = H.el('lbm-locais-tree');
    if (!container) return;
    if (!_locais.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">
        <div style="font-size:40px;margin-bottom:12px">🏢</div>
        <div style="font-weight:600;margin-bottom:6px">Nenhum local cadastrado</div>
        <div style="font-size:12px">Clique em <b>+ Novo Local</b> para começar a estruturar os locais da obra.</div>
      </div>`;
      return;
    }
    container.innerHTML = '<div class="lbm-tree">' + _renderTreeNodes(_locais, 0) + '</div>';
  }

  function _renderTreeNodes(nodes, depth) {
    if (!nodes || !nodes.length) return '';
    return nodes.map(n => {
      const hasChildren = n.children && n.children.length;
      const indent = depth * 20;
      const tipoIcon = { bloco:'🏗', pavimento:'⬛', apartamento:'🚪', sala:'🪑', area:'🌳', local:'📍' }[n.tipo] || '📍';
      return `
        <div class="lbm-tree-node" style="padding-left:${indent}px">
          <div class="lbm-tree-row" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:var(--r);cursor:default;transition:background .12s" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
            <span style="font-size:14px;flex-shrink:0">${tipoIcon}</span>
            <span style="font-size:13px;font-weight:500;color:var(--text);flex:1">${H.esc(n.nome)}</span>
            <span style="font-size:10px;color:var(--text3);background:var(--surface3);border:1px solid var(--border);border-radius:10px;padding:1px 7px;margin-right:4px">${n.tipo}</span>
            ${hasChildren ? `<span style="font-size:10px;color:var(--text3)">${n.children.length} sub-loc.</span>` : ''}
            <button class="btn btn-xs btn-o" onclick="LBM.openLocalModal(${n.id})" style="padding:2px 8px;font-size:10px">✏️</button>
            <button class="btn btn-xs btn-r" onclick="LBM.deleteLocal(${n.id},'${H.esc(n.nome)}')" style="padding:2px 8px;font-size:10px">✕</button>
          </div>
          ${hasChildren ? _renderTreeNodes(n.children, depth + 1) : ''}
        </div>
      `;
    }).join('');
  }

  // Modal de local
  let _editLocalId = null;
  function openLocalModal(id) {
    _editLocalId = id || null;
    const title = H.el('lbm-modal-local-title');
    if (title) title.textContent = id ? 'Editar Local' : 'Novo Local';

    // Preenche select de pais (todos exceto o próprio)
    const paiSel = H.el('lbm-local-pai');
    if (paiSel) {
      paiSel.innerHTML = '<option value="">— Nível raiz —</option>' +
        _locaisFlat.filter(l => l.id !== id).map(l =>
          `<option value="${l.id}">${H.esc(l.path_nome || l.nome)}</option>`
        ).join('');
    }

    if (id) {
      // Busca o local na lista flat para preencher os campos
      const local = _locaisFlat.find(l => l.id === id);
      if (local) {
        H.el('lbm-local-nome').value = local.nome || '';
        H.el('lbm-local-tipo').value = local.tipo || 'local';
        if (paiSel) paiSel.value = local.parent_id ? String(local.parent_id) : '';
      }
    } else {
      H.el('lbm-local-nome').value = '';
      H.el('lbm-local-tipo').value = 'local';
      if (paiSel) paiSel.value = '';
    }

    const modal = H.el('lbm-modal-local');
    if (modal) modal.style.display = 'flex';
    setTimeout(() => H.el('lbm-local-nome')?.focus(), 80);
  }

  function closeLocalModal() {
    const modal = H.el('lbm-modal-local');
    if (modal) modal.style.display = 'none';
    _editLocalId = null;
  }

  async function saveLocal() {
    const nome     = H.el('lbm-local-nome')?.value.trim();
    const tipo     = H.el('lbm-local-tipo')?.value || 'local';
    const parentId = parseInt(H.el('lbm-local-pai')?.value) || null;

    if (!nome) { UI.toast('Informe o nome do local', 'error'); return; }

    const data = { nome, tipo, parent_id: parentId };
    try {
      if (_editLocalId) {
        await API.lbmUpdateLocal(_obraId, _editLocalId, data);
        UI.toast('Local atualizado', 'success');
      } else {
        await API.lbmCreateLocal(_obraId, data);
        UI.toast('Local criado', 'success');
      }
      closeLocalModal();
      await _loadLocais();
      _renderLocaisTree();
    } catch (e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  }

  async function deleteLocal(id, nome) {
    if (!confirm(`Excluir local "${nome}"? Sub-locais também serão excluídos.`)) return;
    try {
      await API.lbmDeleteLocal(_obraId, id);
      UI.toast('Local excluído', 'success');
      await _loadLocais();
      _renderLocaisTree();
    } catch (e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // TAB SERVIÇOS
  // ══════════════════════════════════════════════════════════════
  function _renderServicos() {
    const panel = H.el('lbm-panel-servicos');
    if (!panel) return;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Serviços</span>
        <div style="flex:1"></div>
        <button class="btn btn-sm" style="background:rgba(20,184,166,.1);color:var(--teal);border:1px solid rgba(20,184,166,.3)" onclick="LBM.openDiagnostico()">🔄 Sincronizar Medições</button>
        <button class="btn btn-sm btn-a" onclick="LBM.openServicoModal()">+ Novo Serviço</button>
      </div>
      <div id="lbm-servicos-list" style="padding:12px 16px;overflow:auto;flex:1"></div>
    `;
    _renderServicosList();
  }

  function _renderServicosList() {
    const container = H.el('lbm-servicos-list');
    if (!container) return;
    if (!_servicos.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">
        <div style="font-size:40px;margin-bottom:12px">🔧</div>
        <div style="font-weight:600;margin-bottom:6px">Nenhum serviço cadastrado</div>
        <div style="font-size:12px">Clique em <b>+ Novo Serviço</b> para definir os serviços da obra.</div>
      </div>`;
      return;
    }
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px">
        ${_servicos.map(s => {
          const forn = s.fornecedor_nome ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">🏢 ${H.esc(s.fornecedor_nome)}</div>` : '';
          const cont = (s.contratos||[]).length
            ? (s.contratos).map(c => `<div style="font-size:11px;color:var(--text3)">📄 Contrato ${H.esc(c.numero)}</div>`).join('')
            : '';
          const ritmo = s.ritmo_previsto ? `<div style="font-size:11px;color:var(--text3)">⚡ ${s.ritmo_previsto} ${H.esc(s.ritmo_unidade || 'local/dia')}</div>` : '';
          const dur = `<div style="font-size:11px;color:var(--text3)">⏱ ${s.duracao_por_local || 1} dia(s) por local</div>`;
          return `
            <div style="border:1px solid var(--border);border-radius:var(--r);padding:12px 14px;background:var(--surface);position:relative;border-left:4px solid ${H.esc(s.cor || '#3b82f6')}">
              <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
                <span style="width:12px;height:12px;border-radius:50%;background:${H.esc(s.cor || '#3b82f6')};flex-shrink:0;margin-top:2px"></span>
                <div style="flex:1;font-weight:600;font-size:13px;color:var(--text)">${H.esc(s.nome)}</div>
                <span style="font-size:10px;color:var(--text3);background:var(--surface3);border:1px solid var(--border);border-radius:10px;padding:1px 7px">${H.esc(s.unidade || 'un')}</span>
              </div>
              ${forn}${cont}${ritmo}${dur}
              <div style="display:flex;gap:6px;margin-top:10px">
                <button class="btn btn-xs btn-o" onclick="LBM.openServicoModal(${s.id})" style="font-size:10px">✏️ Editar</button>
                <button class="btn btn-xs btn-r" onclick="LBM.deleteServico(${s.id},'${H.esc(s.nome)}')" style="font-size:10px">✕ Excluir</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Modal de serviço
  let _editServicoId = null;
  let _editContratoIds = []; // ids de contratos selecionados no modal

  function openServicoModal(id) {
    _editServicoId  = id || null;
    _editContratoIds = [];
    const title = H.el('lbm-modal-servico-title');
    if (title) title.textContent = id ? 'Editar Serviço' : 'Novo Serviço';

    // Preenche fornecedores
    const fornSel = H.el('lbm-serv-fornecedor');
    if (fornSel) {
      fornSel.innerHTML = '<option value="">— sem fornecedor —</option>' +
        _fornecedores.map(f => `<option value="${f.id}">${H.esc(f.nome_fantasia || f.razao_social)}</option>`).join('');
    }

    if (id) {
      const s = _servicos.find(x => x.id === id);
      if (s) {
        H.el('lbm-serv-nome').value     = s.nome || '';
        H.el('lbm-serv-unidade').value  = s.unidade || 'un';
        H.el('lbm-serv-cor').value      = s.cor || '#3B82F6';
        H.el('lbm-serv-ritmo').value    = s.ritmo_previsto || '';
        H.el('lbm-serv-ritmo-un').value = s.ritmo_unidade || 'local/dia';
        H.el('lbm-serv-duracao').value  = s.duracao_por_local || 1;
        if (fornSel) fornSel.value = s.fornecedor_id ? String(s.fornecedor_id) : '';
        _editContratoIds = (s.contratos || []).map(c => c.id);
        _loadContratosForFornecedor(s.fornecedor_id, _editContratoIds);
      }
    } else {
      H.el('lbm-serv-nome').value     = '';
      H.el('lbm-serv-unidade').value  = 'un';
      H.el('lbm-serv-cor').value      = '#3B82F6';
      H.el('lbm-serv-ritmo').value    = '';
      H.el('lbm-serv-ritmo-un').value = 'local/dia';
      H.el('lbm-serv-duracao').value  = 1;
      if (fornSel) fornSel.value = '';
      _loadContratosForFornecedor(null, []);
    }

    const modal = H.el('lbm-modal-servico');
    if (modal) modal.style.display = 'flex';
    setTimeout(() => H.el('lbm-serv-nome')?.focus(), 80);
  }

  function closeServicoModal() {
    const modal = H.el('lbm-modal-servico');
    if (modal) modal.style.display = 'none';
    _editServicoId = null;
    _editContratoIds = [];
  }

  async function onFornecedorChange() {
    const fornId = parseInt(H.el('lbm-serv-fornecedor')?.value) || null;
    _editContratoIds = [];
    await _loadContratosForFornecedor(fornId, []);
  }

  async function _loadContratosForFornecedor(fornId, selectedIds = []) {
    const wrap = H.el('lbm-serv-contratos-wrap');
    if (!wrap) return;

    if (!fornId || !_obraId) {
      wrap.innerHTML = '<span style="font-size:11px;color:var(--text3)">Selecione um fornecedor primeiro</span>';
      return;
    }

    try {
      const contratos = await API.contratos({ obra_id: _obraId, fornecedor_id: fornId });
      if (!contratos.length) {
        wrap.innerHTML = '<span style="font-size:11px;color:var(--text3)">Nenhum contrato para este fornecedor</span>';
        return;
      }
      wrap.innerHTML = contratos.map(c => {
        const checked = selectedIds.includes(c.id) ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;padding:4px 0">
          <input type="checkbox" value="${c.id}" ${checked}
            onchange="LBM._toggleContrato(${c.id}, this.checked)"
            style="width:14px;height:14px;cursor:pointer">
          <span>${H.esc(c.numero)}${c.descricao ? ' — ' + H.esc(c.descricao) : ''}</span>
        </label>`;
      }).join('');
    } catch (e) {
      wrap.innerHTML = '<span style="font-size:11px;color:var(--red)">Erro ao carregar contratos</span>';
    }
  }

  function _toggleContrato(contratoId, checked) {
    if (checked && !_editContratoIds.includes(contratoId)) {
      _editContratoIds.push(contratoId);
    } else if (!checked) {
      _editContratoIds = _editContratoIds.filter(id => id !== contratoId);
    }
  }

  async function saveServico() {
    const nome      = H.el('lbm-serv-nome')?.value.trim();
    const unidade   = H.el('lbm-serv-unidade')?.value.trim() || 'un';
    const cor       = H.el('lbm-serv-cor')?.value || '#3B82F6';
    const ritmo     = parseFloat(H.el('lbm-serv-ritmo')?.value) || null;
    const ritmo_un  = H.el('lbm-serv-ritmo-un')?.value.trim() || 'local/dia';
    const duracao   = parseInt(H.el('lbm-serv-duracao')?.value) || 1;
    const fornId    = parseInt(H.el('lbm-serv-fornecedor')?.value) || null;

    if (!nome) { UI.toast('Informe o nome do serviço', 'error'); return; }

    const data = {
      nome, unidade, cor,
      ritmo_previsto: ritmo,
      ritmo_unidade: ritmo_un,
      duracao_por_local: duracao,
      fornecedor_id: fornId,
      contrato_ids: _editContratoIds,
    };

    try {
      if (_editServicoId) {
        await API.lbmUpdateServico(_obraId, _editServicoId, data);
        UI.toast('Serviço atualizado', 'success');
      } else {
        await API.lbmCreateServico(_obraId, data);
        UI.toast('Serviço criado', 'success');
      }
      closeServicoModal();
      await _loadServicos();
      _renderServicosList();
    } catch (e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  }

  async function deleteServico(id, nome) {
    if (!confirm(`Excluir serviço "${nome}"? Dados de progresso também serão excluídos.`)) return;
    try {
      await API.lbmDeleteServico(_obraId, id);
      UI.toast('Serviço excluído', 'success');
      await _loadServicos();
      _renderServicosList();
    } catch (e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // TAB MAPA DE PROGRESSO
  // ══════════════════════════════════════════════════════════════
  function _renderProgresso() {
    const panel = H.el('lbm-panel-progresso');
    if (!panel) return;

    if (!_locaisFlat.length || !_servicos.length) {
      panel.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">
        <div style="font-size:40px;margin-bottom:12px">📊</div>
        <div style="font-weight:600;margin-bottom:6px">Cadastre locais e serviços primeiro</div>
        <div style="font-size:12px">O mapa de progresso requer pelo menos um local e um serviço cadastrado.</div>
      </div>`;
      return;
    }

    // Legenda de status
    const legenda = Object.entries(STATUS_LABEL).map(([k,v]) =>
      `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text2)">
        <span style="width:10px;height:10px;border-radius:3px;background:${STATUS_COLOR[k]}"></span>${v}
      </span>`
    ).join('');

    panel.innerHTML = `
      <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Mapa de Progresso</span>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${legenda}</div>
        <div style="flex:1"></div>
        <span style="font-size:10px;color:var(--text3)">Clique numa célula para editar</span>
      </div>
      <div style="overflow:auto;flex:1;padding:12px 16px">
        <div id="lbm-progresso-grid"></div>
      </div>
    `;
    _renderProgressoGrid();
  }

  function _renderProgressoGrid() {
    const container = H.el('lbm-progresso-grid');
    if (!container) return;

    // Header: locais (linhas) × serviços (colunas)
    const colW = 130;
    const rowLabelW = 200;

    let html = `<table style="border-collapse:collapse;font-size:11px;white-space:nowrap">`;

    // Cabeçalho — serviços como colunas
    html += `<thead><tr>
      <th style="min-width:${rowLabelW}px;max-width:${rowLabelW}px;padding:6px 10px;border:1px solid var(--border);background:var(--surface2);text-align:left;position:sticky;left:0;z-index:2">Local</th>
      ${_servicos.map(s => `
        <th style="width:${colW}px;min-width:${colW}px;padding:6px 8px;border:1px solid var(--border);background:var(--surface2);text-align:center;vertical-align:top">
          <div style="display:flex;align-items:center;justify-content:center;gap:4px">
            <span style="width:8px;height:8px;border-radius:50%;background:${H.esc(s.cor || '#3b82f6')};flex-shrink:0"></span>
            <span style="font-weight:600;color:var(--text)">${H.esc(s.nome)}</span>
          </div>
          ${s.fornecedor_nome ? `<div style="font-size:9px;color:var(--text3);margin-top:2px">${H.esc(s.fornecedor_nome)}</div>` : ''}
        </th>
      `).join('')}
    </tr></thead>`;

    // Linhas — locais
    html += '<tbody>';
    const indent = (l) => '&nbsp;'.repeat((l.nivel || 0) * 3);
    for (const local of _locaisFlat) {
      html += `<tr>
        <td style="min-width:${rowLabelW}px;max-width:${rowLabelW}px;padding:5px 10px;border:1px solid var(--border);background:var(--surface);position:sticky;left:0;z-index:1;font-weight:${local.nivel === 0 ? '600' : '400'};color:var(--text);overflow:hidden;text-overflow:ellipsis" title="${H.esc(local.path_nome || local.nome)}">
          ${indent(local)}${H.esc(local.nome)}
        </td>
        ${_servicos.map(s => {
          const key = `${s.id}_${local.id}`;
          const cell = _progresso[key];
          const status = cell?.status || 'nao_iniciado';
          const bg = STATUS_COLOR[status] || '#64748b';
          const iniPlan = cell?.data_inicio_plan ? _fmtDate(cell.data_inicio_plan) : '';
          const fimPlan = cell?.data_fim_plan ? _fmtDate(cell.data_fim_plan) : '';
          const datas = iniPlan ? `<div style="font-size:9px;opacity:.8;margin-top:2px">${iniPlan} → ${fimPlan}</div>` : '';
          // Indicador de origem: medição automática vs. edição manual
          const medBadge = cell?.medicao_id
            ? `<div style="font-size:8px;color:${bg};opacity:.8;margin-top:2px">📋 medição</div>`
            : '';
          return `
            <td style="width:${colW}px;min-width:${colW}px;padding:0;border:1px solid var(--border);cursor:pointer;transition:filter .1s" onclick="LBM.openCellModal(${s.id},${local.id})" title="${cell?.medicao_id ? 'Atualizado automaticamente por medição aprovada' : 'Clique para editar'}">
              <div style="background:${bg}22;border-left:3px solid ${bg};padding:5px 8px;min-height:36px;transition:background .12s" onmouseover="this.style.background='${bg}44'" onmouseout="this.style.background='${bg}22'">
                <div style="font-size:10px;font-weight:600;color:${bg}">${STATUS_LABEL[status] || status}</div>
                ${datas}${medBadge}
              </div>
            </td>
          `;
        }).join('')}
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // Modal de célula
  let _cellServicoId = null;
  let _cellLocalId   = null;

  function openCellModal(servicoId, localId) {
    _cellServicoId = servicoId;
    _cellLocalId   = localId;

    const serv  = _servicos.find(s => s.id === servicoId);
    const local = _locaisFlat.find(l => l.id === localId);
    const title = H.el('lbm-modal-cell-title');
    if (title) title.textContent = `${serv?.nome || 'Serviço'} · ${local?.nome || 'Local'}`;

    const key  = `${servicoId}_${localId}`;
    const cell = _progresso[key] || {};

    H.el('lbm-cell-status').value    = cell.status || 'nao_iniciado';
    H.el('lbm-cell-ini-plan').value  = _isoToInput(cell.data_inicio_plan);
    H.el('lbm-cell-fim-plan').value  = _isoToInput(cell.data_fim_plan);
    H.el('lbm-cell-ini-real').value  = _isoToInput(cell.data_inicio_real);
    H.el('lbm-cell-fim-real').value  = _isoToInput(cell.data_fim_real);
    H.el('lbm-cell-obs').value       = cell.observacao || '';

    const modal = H.el('lbm-modal-cell');
    if (modal) modal.style.display = 'flex';
  }

  function closeCellModal() {
    const modal = H.el('lbm-modal-cell');
    if (modal) modal.style.display = 'none';
    _cellServicoId = null;
    _cellLocalId   = null;
  }

  async function saveCell() {
    if (!_cellServicoId || !_cellLocalId) return;
    const data = {
      servico_id:       _cellServicoId,
      local_id:         _cellLocalId,
      status:           H.el('lbm-cell-status').value,
      data_inicio_plan: H.el('lbm-cell-ini-plan').value || null,
      data_fim_plan:    H.el('lbm-cell-fim-plan').value || null,
      data_inicio_real: H.el('lbm-cell-ini-real').value || null,
      data_fim_real:    H.el('lbm-cell-fim-real').value || null,
      observacao:       H.el('lbm-cell-obs').value.trim() || null,
    };
    try {
      await API.lbmBatchProgresso(_obraId, [data]);
      // Atualiza cache local
      const key = `${_cellServicoId}_${_cellLocalId}`;
      _progresso[key] = { ..._progresso[key], ...data };
      closeCellModal();
      _renderProgressoGrid();
      UI.toast('Progresso atualizado', 'success');
    } catch (e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // TAB LINHA DE BALANÇO
  // ══════════════════════════════════════════════════════════════
  function _renderBalanco() {
    const panel = H.el('lbm-panel-balanco');
    if (!panel) return;

    if (!_locaisFlat.length || !_servicos.length) {
      panel.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">
        <div style="font-size:40px;margin-bottom:12px">📈</div>
        <div style="font-weight:600;margin-bottom:6px">Sem dados suficientes</div>
        <div style="font-size:12px">Cadastre locais e serviços e calcule o plano para visualizar a Linha de Balanço.</div>
      </div>`;
      return;
    }

    panel.innerHTML = `
      <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Linha de Balanço</span>
        <span style="font-size:11px;color:var(--text3)">X = Tempo · Y = Localização · Diagonais = Ritmo de cada serviço</span>
        <div style="flex:1"></div>
      </div>
      <div style="padding:16px;overflow:auto;flex:1" id="lbm-balanco-container"></div>
    `;
    _drawBalanco();
  }

  function _drawBalanco() {
    const container = H.el('lbm-balanco-container');
    if (!container) return;

    // Coleta todas as datas para definir o eixo X
    const allDates = [];
    for (const cell of Object.values(_progresso)) {
      if (cell.data_inicio_plan) allDates.push(new Date(cell.data_inicio_plan));
      if (cell.data_fim_plan)    allDates.push(new Date(cell.data_fim_plan));
      if (cell.data_inicio_real) allDates.push(new Date(cell.data_inicio_real));
      if (cell.data_fim_real)    allDates.push(new Date(cell.data_fim_real));
    }

    if (!allDates.length) {
      container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text3)">
        <div style="font-size:32px;margin-bottom:12px">📅</div>
        <div style="font-weight:600;margin-bottom:6px">Sem datas planejadas</div>
        <div style="font-size:12px">Clique em <b>⚙️ Calcular Plano</b> para gerar as datas automaticamente.</div>
      </div>`;
      return;
    }

    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
    const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / 86400000)) + 10;

    // Dimensões SVG
    const padL = 160, padR = 40, padT = 40, padB = 60;
    const svgW = Math.max(800, totalDays * 14 + padL + padR);
    const nLocais = _locaisFlat.length;
    const svgH = Math.max(400, nLocais * 36 + padT + padB);
    const chartW = svgW - padL - padR;
    const chartH = svgH - padT - padB;

    const dateToX = (d) => {
      const days = (new Date(d) - minDate) / 86400000;
      return padL + (days / totalDays) * chartW;
    };
    const localToY = (idx) => padT + (idx + 0.5) * (chartH / nLocais);

    let svg = `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg" style="font-family:system-ui,sans-serif">`;

    // Fundo
    svg += `<rect width="${svgW}" height="${svgH}" fill="var(--bg,#0f172a)" rx="8"/>`;

    // Grade — linhas horizontais por local
    for (let i = 0; i < nLocais; i++) {
      const y = padT + i * (chartH / nLocais);
      const y2 = y + (chartH / nLocais);
      const bg = i % 2 === 0 ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.01)';
      svg += `<rect x="${padL}" y="${y}" width="${chartW}" height="${chartH/nLocais}" fill="${bg}"/>`;
      svg += `<line x1="${padL}" y1="${y2}" x2="${svgW-padR}" y2="${y2}" stroke="rgba(255,255,255,.08)" stroke-width="1"/>`;
    }

    // Grade — linhas verticais por semana
    let cur = new Date(minDate);
    while (cur <= maxDate) {
      const x = dateToX(cur);
      svg += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${svgH-padB}" stroke="rgba(255,255,255,.08)" stroke-width="1"/>`;
      // Label de data
      const label = `${String(cur.getDate()).padStart(2,'0')}/${String(cur.getMonth()+1).padStart(2,'0')}`;
      svg += `<text x="${x.toFixed(1)}" y="${svgH-padB+14}" text-anchor="middle" font-size="8" fill="rgba(255,255,255,.4)">${label}</text>`;
      cur = new Date(cur.getTime() + 7 * 86400000); // +7 dias
    }

    // Eixo Y — labels dos locais
    _locaisFlat.forEach((local, idx) => {
      const y = localToY(idx);
      const label = local.nome.length > 18 ? local.nome.slice(0, 17) + '…' : local.nome;
      svg += `<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="10" fill="rgba(255,255,255,.7)">${label}</text>`;
    });

    // Linhas de balanço — uma por serviço
    for (const serv of _servicos) {
      const cor = serv.cor || '#3b82f6';
      // Coleta pontos planejados (início por local)
      const ptsPlan = [];
      const ptsReal = [];
      for (let idx = 0; idx < _locaisFlat.length; idx++) {
        const local = _locaisFlat[idx];
        const key = `${serv.id}_${local.id}`;
        const cell = _progresso[key];
        if (!cell) continue;
        const y = localToY(idx);
        if (cell.data_inicio_plan && cell.data_fim_plan) {
          ptsPlan.push({ x1: dateToX(cell.data_inicio_plan), x2: dateToX(cell.data_fim_plan), y });
        }
        if (cell.data_inicio_real && cell.data_fim_real) {
          ptsReal.push({ x1: dateToX(cell.data_inicio_real), x2: dateToX(cell.data_fim_real), y });
        }
      }

      // Linha planejada — linha contínua ligando início dos locais (diagonal)
      if (ptsPlan.length > 1) {
        const polyPts = ptsPlan.map(p => `${p.x1.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        svg += `<polyline points="${polyPts}" fill="none" stroke="${cor}" stroke-width="2" stroke-dasharray="6,3" opacity=".8"/>`;
      }
      // Barras planejadas por local
      for (const pt of ptsPlan) {
        svg += `<line x1="${pt.x1.toFixed(1)}" y1="${pt.y.toFixed(1)}" x2="${pt.x2.toFixed(1)}" y2="${pt.y.toFixed(1)}" stroke="${cor}" stroke-width="4" stroke-linecap="round" opacity=".7"/>`;
      }

      // Linha real — sólida
      if (ptsReal.length > 1) {
        const polyPts = ptsReal.map(p => `${p.x1.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        svg += `<polyline points="${polyPts}" fill="none" stroke="${cor}" stroke-width="2" opacity="1"/>`;
      }
      // Barras reais por local
      for (const pt of ptsReal) {
        svg += `<line x1="${pt.x1.toFixed(1)}" y1="${pt.y.toFixed(1)}" x2="${pt.x2.toFixed(1)}" y2="${pt.y.toFixed(1)}" stroke="${cor}" stroke-width="6" stroke-linecap="round" opacity=".95"/>`;
      }
    }

    // Linha "hoje"
    const today = new Date();
    if (today >= minDate && today <= maxDate) {
      const xToday = dateToX(today);
      svg += `<line x1="${xToday.toFixed(1)}" y1="${padT}" x2="${xToday.toFixed(1)}" y2="${svgH-padB}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3"/>`;
      svg += `<text x="${xToday.toFixed(1)}" y="${padT-6}" text-anchor="middle" font-size="9" fill="#f59e0b" font-weight="bold">HOJE</text>`;
    }

    // Legenda dos serviços
    let legX = padL;
    svg += `<text x="${padL}" y="${svgH-8}" font-size="9" fill="rgba(255,255,255,.4)">Legenda:</text>`;
    legX += 55;
    for (const s of _servicos) {
      const label = s.nome.length > 14 ? s.nome.slice(0, 13) + '…' : s.nome;
      svg += `<circle cx="${legX+6}" cy="${svgH-10}" r="4" fill="${s.cor || '#3b82f6'}"/>`;
      svg += `<text x="${legX+14}" y="${svgH-6}" font-size="9" fill="rgba(255,255,255,.7)">${label}</text>`;
      legX += label.length * 6 + 30;
    }
    // Traçado plano vs real
    svg += `<line x1="${legX}" y1="${svgH-10}" x2="${legX+20}" y2="${svgH-10}" stroke="rgba(255,255,255,.5)" stroke-width="2" stroke-dasharray="5,3"/>`;
    svg += `<text x="${legX+24}" y="${svgH-6}" font-size="9" fill="rgba(255,255,255,.5)">Plano</text>`;
    svg += `<line x1="${legX+60}" y1="${svgH-10}" x2="${legX+80}" y2="${svgH-10}" stroke="rgba(255,255,255,.8)" stroke-width="3"/>`;
    svg += `<text x="${legX+84}" y="${svgH-6}" font-size="9" fill="rgba(255,255,255,.7)">Real</text>`;

    svg += '</svg>';
    container.innerHTML = svg;
  }

  // ══════════════════════════════════════════════════════════════
  // MODAL CALCULAR PLANO
  // ══════════════════════════════════════════════════════════════
  function openCalcPlano() {
    // Preenche data com hoje como default
    const inp = H.el('lbm-plano-inicio');
    if (inp && !inp.value) inp.value = new Date().toISOString().slice(0, 10);
    const modal = H.el('lbm-modal-plano');
    if (modal) modal.style.display = 'flex';
  }

  function closePlanoModal() {
    const modal = H.el('lbm-modal-plano');
    if (modal) modal.style.display = 'none';
  }

  async function submitCalcPlano() {
    const dataInicio = H.el('lbm-plano-inicio')?.value;
    const intervalo  = parseInt(H.el('lbm-plano-intervalo')?.value) || 0;
    if (!dataInicio) { UI.toast('Informe a data de início', 'error'); return; }
    try {
      await API.lbmCalcularPlano(_obraId, { data_inicio: dataInicio, intervalo_entre_locais: intervalo });
      UI.toast('Plano calculado com sucesso!', 'success');
      closePlanoModal();
      await _loadProgresso();
      if (_activeTab === 'progresso') _renderProgressoGrid();
      if (_activeTab === 'balanco')   _drawBalanco();
    } catch (e) {
      UI.toast('Erro: ' + e.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CARREGAMENTO DE DADOS
  // ══════════════════════════════════════════════════════════════
  async function _loadLocais() {
    try {
      const [tree, flat] = await Promise.all([
        API.lbmLocais(_obraId),
        API.lbmLocaisFlat(_obraId),
      ]);
      _locais     = tree;
      _locaisFlat = flat;
    } catch (e) {
      _locais = _locaisFlat = [];
    }
  }

  async function _loadServicos() {
    try {
      _servicos = await API.lbmServicos(_obraId);
    } catch (e) {
      _servicos = [];
    }
  }

  async function _loadProgresso() {
    try {
      const data = await API.lbmProgresso(_obraId);
      _locaisFlat = data.locais    || _locaisFlat;
      _servicos   = data.servicos  || _servicos;
      _progresso  = data.progresso || {};
      const keys = Object.keys(_progresso);
      console.log('[LBM] _loadProgresso ok — obraId:', _obraId,
        '| locais:', _locaisFlat.length,
        '| servicos:', _servicos.length,
        '| progresso keys:', keys.length,
        '| sample keys:', keys.slice(0, 5));
    } catch (e) {
      console.error('[LBM] _loadProgresso ERRO:', e.message);
      _progresso = {};
    }
  }

  async function _loadFornecedores() {
    try { _fornecedores = await API.fornecedores(); } catch { _fornecedores = []; }
  }

  // ══════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ══════════════════════════════════════════════════════════════
  async function init(obraId) {
    _obraId    = obraId;
    _activeTab = 'locais';

    // Garante container
    let wrap = H.el('cron-lbm-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'cron-lbm-wrap';
      wrap.className = 'lbm-wrap';
      const cronPage = H.el('page-cronograma');
      if (cronPage) cronPage.appendChild(wrap);
    }
    wrap.style.display = '';

    // Esconde elementos do Gantt
    const ganttEls = ['cron-sel', 'cron-info-pill', 'cron-btn-replace', 'cron-btn-delete', 'cron-btn-import', 'cron-empty-state', 'cron-wbs-wrap'];
    ganttEls.forEach(id => { const el = H.el(id); if (el) el.style.display = 'none'; });
    // Esconde label "Cronograma" no topo
    const cronCtrlSep = document.querySelector('#page-cronograma .cron-ctrl-sep');
    const cronCtrlLabel = document.querySelector('#page-cronograma .cron-ctrl-label:last-of-type');

    _renderContainer(obraId);

    // Carrega dados em paralelo
    await Promise.all([
      _loadLocais(),
      _loadServicos(),
      _loadFornecedores(),
    ]);
    await _loadProgresso();

    switchTab('locais');
  }

  function destroy() {
    const wrap = H.el('cron-lbm-wrap');
    if (wrap) wrap.style.display = 'none';
    // Restaura elementos do Gantt
    const ganttEls = ['cron-sel', 'cron-btn-import'];
    ganttEls.forEach(id => { const el = H.el(id); if (el) el.style.display = ''; });
    const emptyEl = H.el('cron-empty-state');
    if (emptyEl) emptyEl.style.display = '';
    _obraId = null;
  }

  // ══════════════════════════════════════════════════════════════
  // DIAGNÓSTICO E SINCRONIZAÇÃO COM MEDIÇÕES
  // ══════════════════════════════════════════════════════════════
  async function openDiagnostico() {
    const modal = H.el('lbm-modal-diag');
    if (modal) modal.style.display = 'flex';
    const body = H.el('lbm-diag-body');
    if (body) body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text3)">Consultando medições aprovadas…</div>';

    try {
      const data = await API.lbmDiagnostico(_obraId);
      _renderDiagnostico(data);
    } catch (e) {
      if (body) body.innerHTML = `<div style="padding:16px;color:var(--red)">Erro: ${H.esc(e.message)}</div>`;
    }
  }

  function closeDiagnostico() {
    const modal = H.el('lbm-modal-diag');
    if (modal) modal.style.display = 'none';
  }

  function _renderDiagnostico(data) {
    const body   = H.el('lbm-diag-body');
    const footer = H.el('lbm-diag-footer');
    if (!body) return;

    if (!data.servicos?.length) {
      body.innerHTML = `
        <div style="text-align:center;padding:32px;color:var(--text3)">
          <div style="font-size:32px;margin-bottom:12px">⚠️</div>
          <div style="font-weight:600;margin-bottom:8px">Nenhum serviço com contrato vinculado</div>
          <div style="font-size:12px">Edite um serviço na aba Serviços e vincule um <b>Contrato</b>.</div>
        </div>`;
      if (footer) footer.innerHTML = `<button class="btn btn-o" onclick="LBM.closeDiagnostico()">Fechar</button>`;
      return;
    }

    const rows = data.servicos.map(s => {
      const statusCor = s.pct_acumulado > 0 ? '#22c55e' : '#ef4444';
      const medRows = s.medicoes_aprovadas?.length
        ? s.medicoes_aprovadas.map(m =>
            `<tr style="font-size:10px">
              <td style="padding:2px 6px;color:var(--text3)">${H.esc(m.codigo)}</td>
              <td style="padding:2px 6px;color:var(--text3)">${H.esc(m.tipo || 'Normal')}</td>
              <td style="padding:2px 6px;color:var(--text3)">${H.esc(m.status)}</td>
              <td style="padding:2px 6px;font-weight:600;color:var(--text)">${m.pct_total ?? '—'}%</td>
            </tr>`
          ).join('')
        : `<tr><td colspan="4" style="padding:4px 6px;color:var(--text3);font-size:10px">Nenhuma medição aprovada</td></tr>`;

      return `
        <div style="border:1px solid var(--border);border-radius:var(--r);margin-bottom:12px;overflow:hidden">
          <div style="padding:10px 14px;background:var(--surface2);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:13px;color:var(--text);flex:1">${H.esc(s.servico_nome)}</span>
            ${(s.contratos||[]).map(c =>
              `<span style="font-size:10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--text2)">📄 ${H.esc(c.contrato_numero || c.numero)}</span>`
            ).join('')}
          </div>
          <div style="padding:10px 14px">
            <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">
              <div style="text-align:center">
                <div style="font-size:22px;font-weight:700;color:${statusCor}">${parseFloat(s.pct_acumulado).toFixed(2)}%</div>
                <div style="font-size:9px;color:var(--text3)">% acumulado</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:22px;font-weight:700;color:var(--text)">${s.total_locais}</div>
                <div style="font-size:9px;color:var(--text3)">locais</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:22px;font-weight:700;color:#22c55e">${s.locais_concluidos}</div>
                <div style="font-size:9px;color:var(--text3)">concluídos</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:22px;font-weight:700;color:var(--text)">${s.total_locais - s.locais_concluidos - (s.pct_acumulado > 0 && s.pct_acumulado < 100 ? 1 : 0)}</div>
                <div style="font-size:9px;color:var(--text3)">não iniciados</div>
              </div>
            </div>
            ${s.pct_acumulado === 0 ? `<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:6px;padding:8px 12px;font-size:11px;color:#ef4444;margin-bottom:8px">
              ⚠️ % acumulado = 0. Verifique se a medição é do tipo <b>Normal</b> (não Adiantamento) e se está <b>Aprovada</b>.
            </div>` : ''}
            ${(s.pct_por_contrato||[]).length > 1 ? `
              <div style="margin-bottom:8px;font-size:10px;color:var(--text3)">
                <b>% por contrato (média = ${parseFloat(s.pct_acumulado).toFixed(2)}%):</b>
                ${s.pct_por_contrato.map(c =>
                  `<span style="margin-left:6px;background:var(--surface2);padding:1px 5px;border-radius:3px">${H.esc(String(c.contrato_id))}: ${parseFloat(c.pct_acumulado).toFixed(1)}%</span>`
                ).join('')}
              </div>` : ''}
            <div style="font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Medições aprovadas:</div>
            <table style="width:100%;border-collapse:collapse">
              <thead><tr style="font-size:9px;color:var(--text3)">
                <th style="text-align:left;padding:2px 6px">Código</th>
                <th style="text-align:left;padding:2px 6px">Tipo</th>
                <th style="text-align:left;padding:2px 6px">Status</th>
                <th style="text-align:left;padding:2px 6px">% Total</th>
              </tr></thead>
              <tbody>${medRows}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    body.innerHTML = `
      <p style="font-size:12px;color:var(--text2);margin:0 0 16px">
        O sistema vai distribuir o progresso pelos locais na ordem cadastrada, de acordo com o % acumulado das medições aprovadas de cada contrato.
      </p>
      ${rows}
    `;

    if (footer) footer.innerHTML = `
      <button class="btn btn-o" onclick="LBM.closeDiagnostico()">Cancelar</button>
      <button class="btn btn-a" onclick="LBM._executarSync()">✅ Aplicar sincronização agora</button>
    `;
  }

  async function _executarSync() {
    const footer = H.el('lbm-diag-footer');
    if (footer) footer.innerHTML = '<span style="font-size:12px;color:var(--text3)">Sincronizando…</span>';
    try {
      const r = await API.lbmSincronizar(_obraId);
      closeDiagnostico();
      UI.toast(`✅ ${r.celulas} células atualizadas (${r.servicos} serviços)`, 'success');
      // Sempre navega para o Mapa de Progresso após sync para mostrar o resultado
      await switchTab('progresso');
    } catch (e) {
      UI.toast('Erro na sincronização: ' + e.message, 'error');
      if (footer) footer.innerHTML = `
        <button class="btn btn-o" onclick="LBM.closeDiagnostico()">Fechar</button>
        <button class="btn btn-a" onclick="LBM._executarSync()">Tentar novamente</button>
      `;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // IMPORTAÇÃO VIA IA
  // ══════════════════════════════════════════════════════════════
  let _iaPreview = null; // dados extraídos pelo Gemini (aguardando confirmação)

  function openImportIA() {
    _iaPreview = null;
    const modal = H.el('lbm-modal-ia');
    if (modal) modal.style.display = 'flex';
    _renderIAUpload();
  }

  function closeImportIA() {
    const modal = H.el('lbm-modal-ia');
    if (modal) modal.style.display = 'none';
    _iaPreview = null;
  }

  function _renderIAUpload() {
    const body   = H.el('lbm-ia-body');
    const footer = H.el('lbm-ia-footer');
    if (!body) return;

    body.innerHTML = `
      <div style="margin-bottom:16px">
        <p style="font-size:13px;color:var(--text2);margin:0 0 12px">
          Envie qualquer arquivo de cronograma ou planejamento da obra — o Gemini vai interpretar automaticamente e criar a estrutura LBM para você.
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:11px;color:var(--text3)">
          <span style="background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:3px 9px">📊 Excel (.xlsx/.xls)</span>
          <span style="background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:3px 9px">📋 CSV</span>
          <span style="background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:3px 9px">📄 PDF</span>
          <span style="background:var(--surface3);border:1px solid var(--border);border-radius:6px;padding:3px 9px">📝 Word (.docx)</span>
        </div>
        <div id="lbm-ia-dropzone" class="upz-drop" style="padding:24px;cursor:pointer;position:relative"
             ondragover="event.preventDefault();this.classList.add('drag-over')"
             ondragleave="this.classList.remove('drag-over')"
             ondrop="event.preventDefault();this.classList.remove('drag-over');LBM._onIADrop(event)">
          <div class="upz-ico">✨</div>
          <div class="upz-txt">Arraste o arquivo aqui ou <b>clique para selecionar</b></div>
          <div class="upz-sub">Máximo 20 MB · Excel, CSV, PDF, Word</div>
          <input type="file" id="lbm-ia-file"
                 accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt"
                 style="position:absolute;inset:0;opacity:0;cursor:pointer"
                 onchange="LBM._onIAFileSelected(this.files[0])">
        </div>
      </div>
      <div style="background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.2);border-radius:var(--r);padding:10px 14px;font-size:11px;color:#a78bfa;line-height:1.6">
        💡 <b>Dica:</b> A IA entende qualquer formato — cronograma de obra, tabela de pavimentos, planilha de serviços, linha do tempo, etc. Quanto mais detalhado o arquivo, melhor o resultado.
      </div>
    `;
    if (footer) footer.innerHTML = `<button class="btn btn-o" onclick="LBM.closeImportIA()">Cancelar</button>`;
  }

  function _onIADrop(event) {
    const file = event.dataTransfer?.files?.[0];
    if (file) _onIAFileSelected(file);
  }

  async function _onIAFileSelected(file) {
    if (!file) return;
    _renderIALoading(file.name);
    try {
      const data = await API.lbmImportarIA(_obraId, file);
      _iaPreview = data;
      _renderIAPreview(data);
    } catch (e) {
      _renderIAError(e.message);
    }
  }

  function _renderIALoading(nome) {
    const body   = H.el('lbm-ia-body');
    const footer = H.el('lbm-ia-footer');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center;padding:48px 20px">
        <div style="font-size:48px;margin-bottom:16px;animation:pulse 1.2s infinite">✨</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px">Analisando <em>${H.esc(nome)}</em>…</div>
        <div style="font-size:12px;color:var(--text3)">O Gemini está lendo o arquivo e extraindo a estrutura LBM. Isso pode levar alguns segundos.</div>
        <div style="margin-top:20px;display:flex;justify-content:center;gap:6px">
          <span style="width:8px;height:8px;background:#8b5cf6;border-radius:50%;animation:bounce .8s infinite .0s"></span>
          <span style="width:8px;height:8px;background:#8b5cf6;border-radius:50%;animation:bounce .8s infinite .15s"></span>
          <span style="width:8px;height:8px;background:#8b5cf6;border-radius:50%;animation:bounce .8s infinite .3s"></span>
        </div>
      </div>
    `;
    if (footer) footer.innerHTML = `<button class="btn btn-o" onclick="LBM.closeImportIA()">Cancelar</button>`;
  }

  function _renderIAError(msg) {
    const body   = H.el('lbm-ia-body');
    const footer = H.el('lbm-ia-footer');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center;padding:32px 20px">
        <div style="font-size:40px;margin-bottom:12px">⚠️</div>
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">Erro ao processar arquivo</div>
        <div style="font-size:12px;color:var(--text3);background:var(--surface3);border-radius:var(--r);padding:10px 14px;text-align:left;margin-top:12px">${H.esc(msg)}</div>
      </div>
    `;
    if (footer) footer.innerHTML = `
      <button class="btn btn-o" onclick="LBM.closeImportIA()">Fechar</button>
      <button class="btn btn-a" onclick="LBM._renderIAUpload()">Tentar novamente</button>
    `;
  }

  function _renderIAPreview(data) {
    const body   = H.el('lbm-ia-body');
    const footer = H.el('lbm-ia-footer');
    if (!body) return;

    const nLocais    = data.locais?.length || 0;
    const nServicos  = data.servicos?.length || 0;
    const nProgresso = data.progresso?.length || 0;

    // Monta preview de locais
    const locaisHtml = data.locais?.slice(0, 12).map(l => {
      const indent = l.parent_nome ? '&nbsp;&nbsp;&nbsp;↳ ' : '';
      return `<div style="font-size:11px;padding:2px 0;color:var(--text2)">${indent}<b>${H.esc(l.nome)}</b> <span style="color:var(--text3)">(${l.tipo || 'local'})</span></div>`;
    }).join('') || '';
    const maisLocais = nLocais > 12 ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">…e mais ${nLocais - 12} locais</div>` : '';

    // Monta preview de serviços
    const servicosHtml = data.servicos?.slice(0, 8).map(s =>
      `<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0;color:var(--text2)">
        <span style="width:10px;height:10px;border-radius:50%;background:${H.esc(s.cor||'#3b82f6')};flex-shrink:0"></span>
        <b>${H.esc(s.nome)}</b>
        <span style="color:var(--text3)">${H.esc(s.unidade||'un')} · ${s.duracao_por_local||1}d/local</span>
      </div>`
    ).join('') || '';
    const maisServicos = nServicos > 8 ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">…e mais ${nServicos - 8} serviços</div>` : '';

    body.innerHTML = `
      ${data.resumo ? `<div style="background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.25);border-radius:var(--r);padding:10px 14px;font-size:12px;color:#c4b5fd;margin-bottom:16px">
        <b>IA:</b> ${H.esc(data.resumo)}
      </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="border:1px solid var(--border);border-radius:var(--r);padding:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🏢 Locais encontrados (${nLocais})</div>
          ${locaisHtml || '<div style="font-size:11px;color:var(--text3)">Nenhum local identificado</div>'}
          ${maisLocais}
        </div>
        <div style="border:1px solid var(--border);border-radius:var(--r);padding:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🔧 Serviços encontrados (${nServicos})</div>
          ${servicosHtml || '<div style="font-size:11px;color:var(--text3)">Nenhum serviço identificado</div>'}
          ${maisServicos}
        </div>
      </div>

      <div style="border:1px solid rgba(245,158,11,.3);border-radius:var(--r);padding:10px 14px;margin-bottom:16px;background:rgba(245,158,11,.07)">
        <div style="font-size:11px;color:#d97706;line-height:1.6">
          📅 <b>Datas e progresso:</b> após confirmar a importação, use o botão <b>⚙️ Calcular Plano</b> para gerar automaticamente as datas planejadas de cada local × serviço com base no ritmo e duração definidos.
        </div>
      </div>

      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">Como importar:</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px">
            <input type="radio" name="lbm-ia-modo" value="mesclar" checked style="margin-top:2px">
            <div><b>Mesclar</b> — adiciona novos locais e serviços sem apagar os existentes</div>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px">
            <input type="radio" name="lbm-ia-modo" value="substituir" style="margin-top:2px">
            <div><b>Substituir</b> — <span style="color:#ef4444">apaga todos os locais, serviços e progresso</span> desta obra antes de importar</div>
          </label>
        </div>
      </div>
    `;

    if (footer) footer.innerHTML = `
      <button class="btn btn-o" onclick="LBM._renderIAUpload()">← Enviar outro arquivo</button>
      <button class="btn btn-o" onclick="LBM.closeImportIA()">Cancelar</button>
      <button class="btn btn-a" onclick="LBM._confirmarImportIA()" ${!nLocais && !nServicos ? 'disabled' : ''}>
        ✅ Confirmar importação
      </button>
    `;
  }

  async function _confirmarImportIA() {
    if (!_iaPreview) return;
    const modoEl = document.querySelector('input[name="lbm-ia-modo"]:checked');
    const modo   = modoEl?.value || 'mesclar';

    const footer = H.el('lbm-ia-footer');
    if (footer) footer.innerHTML = '<span style="font-size:12px;color:var(--text3)">Salvando…</span>';

    try {
      const r = await API.lbmImportarIAConfirmar(_obraId, {
        locais:    _iaPreview.locais    || [],
        servicos:  _iaPreview.servicos  || [],
        progresso: _iaPreview.progresso || [],
        modo,
      });
      closeImportIA();
      UI.toast(`✅ Importado: ${r.locais} locais, ${r.servicos} serviços, ${r.celulas} células`, 'success');
      // Recarrega tudo
      await Promise.all([_loadLocais(), _loadServicos(), _loadFornecedores()]);
      await _loadProgresso();
      switchTab(_activeTab);
    } catch (e) {
      UI.toast('Erro ao confirmar importação: ' + e.message, 'error');
      if (footer) footer.innerHTML = `
        <button class="btn btn-o" onclick="LBM.closeImportIA()">Cancelar</button>
        <button class="btn btn-a" onclick="LBM._confirmarImportIA()">Tentar novamente</button>
      `;
    }
  }

  return {
    init, destroy, switchTab,
    // Locais
    openLocalModal, closeLocalModal, saveLocal, deleteLocal,
    // Serviços
    openServicoModal, closeServicoModal, saveServico, deleteServico, onFornecedorChange, _toggleContrato,
    // Progresso
    openCellModal, closeCellModal, saveCell,
    // Plano
    openCalcPlano, closePlanoModal, submitCalcPlano,
    // Diagnóstico / Sync
    openDiagnostico, closeDiagnostico, _executarSync,
    // IA Import
    openImportIA, closeImportIA,
    _renderIAUpload, _onIADrop, _onIAFileSelected, _confirmarImportIA,
  };
})();
