const Medicoes = {
  async openNew() {
    State.editingId = null;
    H.el('mm-title').textContent = '📋 NOVA MEDIÇÃO';
    H.el('mm-body').innerHTML = await this._buildForm(null);
    this._bindFormEvents();
    UI.openModal('modal-medicao');
  },

  async edit(id) {
    State.editingId = id;
    const m = await API.medicao(id);
    H.el('mm-title').textContent = `✏ EDITAR MEDIÇÃO · ${m.codigo}`;
    H.el('mm-body').innerHTML = await this._buildForm(m);
    this._bindFormEvents();
    UI.openModal('modal-medicao');
  },

  async _buildForm(m) {
    const [empresas, obras, forns] = await Promise.all([ API.empresas(), API.obras(), API.fornecedores() ]);
    const obrasFilt = m ? obras.filter(o=>o.empresa_id===m.empresa_id) : obras;
    // Para nova medição: sem contrato pré-selecionado. Para edição: carrega disponíveis + o próprio contrato
    let contsFilt = [];
    if(m?.obra_id || m?.fornecedor_id) {
      const filters = { disponivel: 1 };
      if(m.obra_id)       filters.obra_id       = m.obra_id;
      if(m.fornecedor_id) filters.fornecedor_id = m.fornecedor_id;
      contsFilt = await API.contratos(filters);
      // Garante que o contrato atual esteja na lista (pode estar 100% mas ainda é a medição sendo editada)
      if(m.contrato_id && !contsFilt.find(c=>c.id===m.contrato_id)) {
        const allConts = await API.contratos({ obra_id: m.obra_id });
        const current = allConts.find(c=>c.id===m.contrato_id);
        if(current) contsFilt.unshift(current);
      }
    }
    return `
    <div class="fsec">
      <div class="fsec-title">IDENTIFICAÇÃO</div>
      <div class="fgrid">
        <div class="fg"><label class="fl">Empresa *</label>
          <select class="fi fsel" id="mf-empresa" onchange="Medicoes._onEmpresaChange()">
            <option value="">Selecione...</option>${empresas.map(e=>`<option value="${e.id}" ${m?.empresa_id===e.id?'selected':''}>${e.nome_fantasia||e.razao_social}</option>`).join('')}
          </select></div>
        <div class="fg"><label class="fl">Obra *</label>
          <select class="fi fsel" id="mf-obra" onchange="Medicoes._onObraChange()">
            <option value="">Selecione...</option>${obrasFilt.map(o=>`<option value="${o.id}" ${m?.obra_id===o.id?'selected':''}>${o.nome}</option>`).join('')}
          </select></div>
        <div class="fg"><label class="fl">Fornecedor *</label>
          <select class="fi fsel" id="mf-fornecedor" onchange="Medicoes._onFornecedorChange()">
            <option value="">Selecione...</option>${forns.map(f=>`<option value="${f.id}" ${m?.fornecedor_id===f.id?'selected':''}>${f.nome_fantasia||f.razao_social}</option>`).join('')}
          </select></div>
        <div class="fg"><label class="fl">Contrato *</label>
          <select class="fi fsel" id="mf-contrato" onchange="Medicoes._onContratoChange()">
            ${contsFilt.length
              ? '<option value="">Selecione o contrato...</option>' + contsFilt.map(c => {
                  const pct = parseFloat(c.pct_executado_real) || 0;
                  const saldo = (100 - pct).toFixed(0);
                  return `<option value="${c.id}" ${m?.contrato_id===c.id?'selected':''}>${c.numero} · ${c.objeto} (${saldo}% a medir)</option>`;
                }).join('')
              : '<option value="">Selecione obra e fornecedor primeiro...</option>'
            }
          </select></div>
        <div class="fg"><label class="fl">Período de Referência *</label>
          <input class="fi" type="month" id="mf-periodo" value="${m?.periodo||''}"></div>
        <div class="fg"><label class="fl">Código da Medição</label>
          <input class="fi" id="mf-codigo" value="${m?.codigo||H.genCodigo()}" readonly></div>
      </div>
    </div>
    <div class="fsec">
      <div class="fsec-title" style="display:flex;justify-content:space-between;align-items:center">
        ITENS DE MEDIÇÃO
        <button class="btn btn-o btn-xs" onclick="Medicoes._addItem('un')" title="Adiciona item não vinculado ao contrato">+ Item Avulso</button>
      </div>
      <div class="ibox info" id="mf-acum-banner" style="margin-bottom:10px;font-size:11px;${m?.itens?.length?'':'display:none'}"></div>
      <div id="mf-itens">${(m?.itens||[]).map((it,i)=>Medicoes._itemRowHTML(it,i)).join('')||`<div class="items-empty" id="mf-itens-empty">Nenhum item adicionado. Use os botões acima para adicionar itens de medição.</div>`}</div>
      <div class="item-totais" id="mf-totais" style="${!(m?.itens||[]).length?'display:none':''}">
        <div><div class="item-total-lbl">Valor desta Medição</div><div class="item-total-val" id="mf-total-med">R$ ${H.fmt(m?.valor_medicao||0)}</div></div>
        <div style="width:1px;height:30px;background:var(--border)"></div>
        <div><div class="item-total-lbl">Valor Acumulado</div><div class="item-total-acum" id="mf-total-acum">R$ ${H.fmt(m?.valor_acumulado||0)}</div></div>
      </div>
    </div>
    <div class="fsec">
      <div class="fsec-title">DESCRIÇÃO DOS SERVIÇOS EXECUTADOS</div>
      <div class="fg"><textarea class="fi" id="mf-descricao" rows="4" placeholder="Descreva detalhadamente os serviços executados no período...">${m?.descricao||''}</textarea></div>
    </div>
    <div class="fsec">
      <div class="fsec-title">EVIDÊNCIAS (imagens, PDFs, vídeos)</div>
      <div class="upz" onclick="UI.toast('Selecione arquivos para upload','info')">
        <div class="upz-ico">📎</div>
        <div class="upz-txt">Clique para selecionar ou arraste arquivos</div>
        <div class="upz-sub">JPG, PNG, PDF, DOCX, MP4 · Máx. 50MB por arquivo</div>
      </div>
      <div class="flist" id="mf-files">
        ${(m?.evidencias||[]).map(f=>`<div class="fitem"><span style="font-size:14px">${f.tipo==='img'?'🖼':f.tipo==='pdf'?'📄':'🎬'}</span><span class="fitem-name">${f.nome}</span><span class="fitem-sz">${f.tamanho}</span><span class="fitem-rm" onclick="this.closest('.fitem').remove()">×</span></div>`).join('')}
      </div>
    </div>`;
  },

  _bindFormEvents() {
    // Modo edição: já há contrato e itens carregados no HTML —
    // apenas atualiza o banner com o estado atual dos acumulados
    const contId = parseInt(H.el('mf-contrato')?.value);
    if(contId) {
      API.acumulados(contId).then(acum => {
        State.cache.acumulados = acum;
        const banner = H.el('mf-acum-banner');
        if(banner && acum.itens?.length) {
          const pctGeral = acum.pct_executado.toFixed(1);
          banner.innerHTML = `<span style="color:var(--blue)">ℹ</span> ${pctGeral}% executado neste contrato (acumulado aprovado).`;
          banner.style.display = '';
        }
      }).catch(()=>{});
    }
  },

  // ── Seletor de unidades disponíveis ──────────────────────────
  _UNIDADES: ['%','m²','m','ml','kg','g','t','l','un','vb','h','m³','cm','mm'],

  // ── Gera HTML de uma linha de item ───────────────────────────
  // locked=true  → item vem do contrato; campos travados exceto qtd_mes
  _itemRowHTML(it, idx) {
    const uns    = this._UNIDADES;
    const isP    = (it?.unidade||'%') === '%';
    const locked = !!(it?.contrato_item_id);
    const saldo  = parseFloat(it?.qtd_saldo ?? (parseFloat(it?.qtd_contrato||0) - parseFloat(it?.qtd_anterior||0)));
    const saldoCls = saldo <= 0 ? 'zero' : (saldo < (parseFloat(it?.qtd_contrato)||0)*0.1 ? 'warn' : 'ok');
    const saldoHtml = locked
      ? `<span class="item-saldo ${saldoCls}" title="Saldo disponível para medição">Saldo: ${parseFloat(saldo.toFixed(4))} ${it?.unidade||''}</span>`
      : '';
    return `<div class="item-row" data-idx="${idx}" data-citem-id="${it?.contrato_item_id||''}">
      <div class="item-hdr">
        <input class="fi item-desc" placeholder="Descrição do serviço / item *" style="flex:1"
          value="${(it?.descricao||'').replace(/"/g,'&quot;')}"
          ${locked?'readonly':''} ${!locked?'onblur="Medicoes._autoFillAcumulado(this)"':''}>
        <select class="fi fsel item-un" style="width:80px" ${locked?'disabled':''} onchange="Medicoes._onUnitChange(this)">
          ${uns.map(u=>`<option ${(it?.unidade||'%')===u?'selected':''}>${u}</option>`).join('')}
        </select>
        ${saldoHtml}
        <button class="btn btn-r btn-xs" onclick="this.closest('.item-row').remove();Medicoes._recalcTotals()" title="Remover item">✕</button>
      </div>
      <div class="item-grid6">
        <div class="fg"><label class="fl">Qtd Contratada</label>
          <input class="fi item-qtd-cont" type="number" min="0" step="any"
            value="${it?.qtd_contrato??0}" readonly oninput="Medicoes._recalcItem(this)"></div>
        <div class="fg"><label class="fl">Qtd Anterior (Acum.)</label>
          <input class="fi item-qtd-ant" type="number" min="0" step="any"
            value="${it?.qtd_anterior??0}" readonly></div>
        <div class="fg"><label class="fl" style="color:var(--accent)">Qtd Este Mês *</label>
          <input class="fi item-qtd-mes" type="number" min="0" step="any"
            value="${it?.qtd_mes??''}" oninput="Medicoes._recalcItem(this)"
            ${locked?`max="${Math.max(0,saldo)}"`:''} style="border-color:var(--accent2)"></div>
        <div class="fg"><label class="fl">Qtd Acumulada</label>
          <input class="fi item-qtd-acum" readonly value="${it?.qtd_acumulada??0}"></div>
        <div class="fg"><label class="fl">Valor Unit. (R$)</label>
          <input class="fi item-vun" type="number" min="0" step="any"
            value="${it?.valor_unitario??0}" ${locked?'readonly':''}
            oninput="Medicoes._recalcItem(this)"></div>
        <div class="fg"><label class="fl">Valor Item (R$)</label>
          <input class="fi item-vitem" readonly value="${H.fmt(it?.valor_item??0)}"></div>
      </div>
    </div>`;
  },

  // ── Adiciona item ad-hoc (não vinculado ao contrato) ─────────
  _addItem(unit) {
    const it = { unidade: unit||'%', qtd_contrato: 0, qtd_anterior: 0, qtd_mes: '',
                 valor_unitario: 0, qtd_acumulada: 0, valor_item: 0 };
    const container = H.el('mf-itens');
    const empty = H.el('mf-itens-empty');
    if(empty) empty.remove();
    const idx = container.querySelectorAll('.item-row').length;
    container.insertAdjacentHTML('beforeend', this._itemRowHTML(it, idx));
    if(H.el('mf-totais')) H.el('mf-totais').style.display='';
  },

  // ── Muda unidade de um item (só para itens ad-hoc) ───────────
  _onUnitChange(sel) {
    const row = sel.closest('.item-row');
    if(row.dataset.citemId) return; // travado
    const isP = sel.value === '%';
    const qcInput = row.querySelector('.item-qtd-cont');
    if(isP) { qcInput.value = 100; } else if(!parseFloat(qcInput.value)) { qcInput.value = 0; }
    this._recalcItem(sel);
  },

  // ── Recalcula linha ───────────────────────────────────────────
  _recalcItem(el) {
    const row = el.closest?.('.item-row');
    if(!row) return;
    const ant  = parseFloat(row.querySelector('.item-qtd-ant')?.value)||0;
    const mes  = parseFloat(row.querySelector('.item-qtd-mes')?.value)||0;
    const vun  = parseFloat(row.querySelector('.item-vun')?.value)||0;
    const acum = ant + mes;
    const acumEl  = row.querySelector('.item-qtd-acum');
    const vitemEl = row.querySelector('.item-vitem');
    if(acumEl)  acumEl.value  = acum % 1 === 0 ? acum : parseFloat(acum.toFixed(4));
    if(vitemEl) vitemEl.value = H.fmt(mes * vun);
    // Realça se exceder saldo
    const mesInput = row.querySelector('.item-qtd-mes');
    if(mesInput && row.dataset.citemId) {
      const maxSaldo = parseFloat(mesInput.getAttribute('max'));
      if(!isNaN(maxSaldo) && mes > maxSaldo + 0.0001) {
        mesInput.style.borderColor = '#ef4444';
      } else {
        mesInput.style.borderColor = 'var(--accent2)';
      }
    }
    this._recalcTotals();
  },

  // ── Recalcula totais globais ──────────────────────────────────
  _recalcTotals() {
    const rows = document.querySelectorAll('#mf-itens .item-row');
    let totalMed = 0, totalAcum = 0;
    rows.forEach(row => {
      const mes  = parseFloat(row.querySelector('.item-qtd-mes')?.value)||0;
      const acum = parseFloat(row.querySelector('.item-qtd-acum')?.value)||0;
      const vun  = parseFloat(row.querySelector('.item-vun')?.value)||0;
      totalMed  += mes * vun;
      totalAcum += acum * vun;
    });
    if(H.el('mf-total-med'))  H.el('mf-total-med').textContent  = 'R$ ' + H.fmt(totalMed);
    if(H.el('mf-total-acum')) H.el('mf-total-acum').textContent = 'R$ ' + H.fmt(totalAcum);
    if(H.el('mf-totais') && rows.length) H.el('mf-totais').style.display='';
  },

  // ── Auto-preenche Qtd Anterior ao sair do campo descrição ────
  // (apenas para itens ad-hoc, sem contrato_item_id)
  _autoFillAcumulado(descInput) {
    const row = descInput.closest('.item-row');
    if(!row || row.dataset.citemId) return; // item do contrato já está preenchido
    const desc = descInput.value.trim();
    const un   = row.querySelector('.item-un')?.value;
    if(!desc) return;
    const acum = State.cache.acumulados;
    if(!acum?.itens?.length) return;
    const prev = acum.itens.find(it => it.descricao === desc && it.unidade === un);
    if(prev) {
      const qantEl  = row.querySelector('.item-qtd-ant');
      const qcontEl = row.querySelector('.item-qtd-cont');
      if(qantEl && !parseFloat(qantEl.value)) {
        qantEl.value  = parseFloat(prev.qtd_acumulada)||0;
        if(qcontEl && !parseFloat(qcontEl.value)) qcontEl.value = parseFloat(prev.qtd_total)||0;
        this._recalcItem(qantEl);
      }
    }
  },

  // ── Contrato selecionado ──────────────────────────────────────
  _getSelectedContract() {
    const contId = parseInt(H.el('mf-contrato')?.value);
    if(!contId) return null;
    return (State.cache.contratos||[]).find(c=>c.id===contId) || null;
  },

  async _onEmpresaChange() {
    const empId = parseInt(H.el('mf-empresa').value);
    const obras = await API.obras(empId);
    H.el('mf-obra').innerHTML = '<option value="">Selecione a obra...</option>' + obras.map(o=>`<option value="${o.id}">${o.nome}</option>`).join('');
    H.el('mf-contrato').innerHTML = '<option value="">Selecione a obra primeiro...</option>';
  },

  async _onObraChange() {
    await this._reloadContratos();
  },

  async _onFornecedorChange() {
    await this._reloadContratos();
  },

  async _reloadContratos() {
    const obraId      = parseInt(H.el('mf-obra')?.value)       || null;
    const fornId      = parseInt(H.el('mf-fornecedor')?.value) || null;
    // Limpa itens ao trocar contrato
    H.el('mf-contrato').innerHTML = '<option value="">Selecione o contrato...</option>';
    H.el('mf-itens').innerHTML = `<div class="items-empty">Selecione o contrato para carregar os itens de medição.</div>`;
    if(H.el('mf-totais')) H.el('mf-totais').style.display = 'none';
    if(!obraId && !fornId) return;
    const filters = { disponivel: 1 };
    if(obraId)  filters.obra_id       = obraId;
    if(fornId)  filters.fornecedor_id = fornId;
    const conts = await API.contratos(filters);
    if(!conts.length) {
      H.el('mf-contrato').innerHTML = '<option value="">Nenhum contrato disponível</option>';
      return;
    }
    H.el('mf-contrato').innerHTML = '<option value="">Selecione o contrato...</option>' +
      conts.map(c => {
        const pct = parseFloat(c.pct_executado_real) || 0;
        const saldo = (100 - pct).toFixed(0);
        return `<option value="${c.id}">${c.numero} · ${c.objeto} (${saldo}% a medir)</option>`;
      }).join('');
  },

  async _onContratoChange() {
    const contId = parseInt(H.el('mf-contrato').value);
    if(!contId) {
      State.cache.acumulados = null;
      H.el('mf-itens').innerHTML = `<div class="items-empty" id="mf-itens-empty">Selecione o contrato para carregar os itens de medição.</div>`;
      if(H.el('mf-totais')) H.el('mf-totais').style.display = 'none';
      return;
    }

    try {
      // Busca acumulados — retorna itens do contrato + histórico somado
      const acum = await API.acumulados(contId);
      State.cache.acumulados = acum;

      const banner = H.el('mf-acum-banner');
      const container = H.el('mf-itens');
      const totaisEl  = H.el('mf-totais');

      if(!acum.itens || acum.itens.length === 0) {
        // Contrato sem itens cadastrados na planilha
        container.innerHTML = `<div class="items-empty" id="mf-itens-empty" style="color:var(--warning)">
          ⚠ Este contrato não possui itens orçamentários cadastrados.<br>
          <small>Edite o contrato e adicione os itens antes de criar a medição.</small>
        </div>`;
        if(banner) { banner.innerHTML = `<span style="color:var(--warning)">⚠</span> Contrato sem planilha orçamentária. Acesse Cadastros → Contratos para adicionar os itens.`; banner.style.display=''; }
        if(totaisEl) totaisEl.style.display='none';
        return;
      }

      // Popula banner com status do contrato
      if(banner) {
        const itensComSaldo = acum.itens.filter(i => i.qtd_saldo > 0.0001);
        const pctGeral = acum.pct_executado.toFixed(1);
        const nMsg = acum.itens.some(i => i.qtd_acumulada > 0)
          ? `${pctGeral}% executado · ${itensComSaldo.length} de ${acum.itens.length} itens com saldo disponível`
          : `Primeira medição — todos os saldos zerados.`;
        banner.innerHTML = `<span style="color:var(--blue)">ℹ</span> ${nMsg}`;
        banner.style.display = '';
      }

      // Limpa itens atuais e re-popula a partir do contrato
      container.innerHTML = '';
      acum.itens.forEach((ci, i) => {
        const itemData = {
          contrato_item_id: ci.id,
          descricao:        ci.descricao,
          unidade:          ci.unidade,
          qtd_contrato:     ci.qtd_total,
          qtd_anterior:     ci.qtd_acumulada,   // ← soma real do histórico
          qtd_mes:          '',
          qtd_acumulada:    ci.qtd_acumulada,
          valor_unitario:   ci.valor_unitario,
          valor_item:       0,
          qtd_saldo:        ci.qtd_saldo,
        };
        container.insertAdjacentHTML('beforeend', this._itemRowHTML(itemData, i));
      });
      if(totaisEl) totaisEl.style.display = '';
      this._recalcTotals();
    } catch(e) {
      State.cache.acumulados = null;
      UI.toast('Erro ao carregar itens do contrato: ' + e.message, 'error');
    }
  },

  _collectForm() {
    const empresa_id   = parseInt(H.el('mf-empresa')?.value);
    const obra_id      = parseInt(H.el('mf-obra')?.value);
    const fornecedor_id= parseInt(H.el('mf-fornecedor')?.value);
    const contrato_id  = parseInt(H.el('mf-contrato')?.value);
    const periodo      = H.el('mf-periodo')?.value;
    const codigo       = H.el('mf-codigo')?.value;
    const descricao    = H.el('mf-descricao')?.value || '';
    if(!empresa_id||!obra_id||!fornecedor_id||!contrato_id||!periodo) { UI.toast('Preencha os campos obrigatórios de identificação','error'); return null; }

    const rows = document.querySelectorAll('#mf-itens .item-row');
    if(!rows.length) { UI.toast('Adicione pelo menos um item de medição','error'); return null; }

    const itens = Array.from(rows).map((row,i) => {
      const qtdMes  = parseFloat(row.querySelector('.item-qtd-mes')?.value)||0;
      const qtdAnt  = parseFloat(row.querySelector('.item-qtd-ant')?.value)||0;
      const vun     = parseFloat(row.querySelector('.item-vun')?.value)||0;
      const citemId = parseInt(row.dataset.citemId) || null;
      // Unidade: para item travado pega do disabled select via value
      const unEl = row.querySelector('.item-un');
      const un = unEl ? (unEl.value || unEl.options?.[unEl.selectedIndex]?.value || '%') : '%';
      return {
        ordem:             i,
        contrato_item_id:  citemId,
        descricao:         row.querySelector('.item-desc')?.value.trim()||'',
        unidade:           un,
        qtd_contrato:      parseFloat(row.querySelector('.item-qtd-cont')?.value)||0,
        qtd_anterior:      qtdAnt,
        qtd_mes:           qtdMes,
        qtd_acumulada:     parseFloat((qtdAnt + qtdMes).toFixed(4)),
        valor_unitario:    vun,
        valor_item:        parseFloat((qtdMes * vun).toFixed(2)),
      };
    });
    if(itens.some(it=>!it.descricao)) { UI.toast('Todos os itens precisam ter descrição','error'); return null; }
    if(!itens.some(it=>it.qtd_mes>0)) { UI.toast('Informe a quantidade deste mês em pelo menos um item','error'); return null; }
    // Valida saldo disponível
    for(const it of itens) {
      if(!it.contrato_item_id || it.qtd_mes <= 0) continue;
      const saldo = parseFloat(it.qtd_contrato) - parseFloat(it.qtd_anterior);
      if(it.qtd_mes > saldo + 0.0001) {
        UI.toast(`Item "${it.descricao}": ${it.qtd_mes} excede o saldo disponível de ${parseFloat(saldo.toFixed(4))} ${it.unidade}`, 'error');
        return null;
      }
    }

    const valor_medicao   = itens.reduce((s,it)=>s+it.qtd_mes*it.valor_unitario,0);
    const valor_acumulado = itens.reduce((s,it)=>s+it.qtd_acumulada*it.valor_unitario,0);

    // Retrocompat: pct values from % items
    const pctItens = itens.filter(it=>it.unidade==='%');
    const pct_mes      = pctItens.reduce((s,it)=>s+it.qtd_mes,0);
    const pct_anterior = pctItens.length ? pctItens.reduce((s,it)=>s+it.qtd_anterior,0) : 0;
    const pct_total    = Math.min(pct_anterior + pct_mes, 100);

    return { empresa_id, obra_id, fornecedor_id, contrato_id, periodo, codigo, descricao,
             valor_medicao, valor_acumulado, pct_anterior, pct_mes, pct_total, itens };
  },

  async saveDraft() {
    const data = this._collectForm();
    if(!data) { UI.toast('Preencha os campos obrigatórios','error'); return; }
    data.status = 'Rascunho';
    try {
      if(State.editingId) await API.updateMedicao(State.editingId, data);
      else await API.createMedicao(data);
      UI.closeModal('modal-medicao');
      UI.toast(`Medição ${data.codigo} salva como rascunho`, 'info');
      await Pages.medicoes();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async launch() {
    const data = this._collectForm();
    if(!data) { UI.toast('Preencha todos os campos obrigatórios','error'); return; }
    data.status = 'Aguardando N1';
    try {
      if(State.editingId) await API.updateMedicao(State.editingId, data);
      else await API.createMedicao(data);
      UI.closeModal('modal-medicao');
      UI.toast(`✓ Medição ${data.codigo} lançada — enviada para aprovação N1`, 'success');
      await Pages.medicoes();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  openAprovar(id) {
    State.currentActionMedicaoId = id;
    API.medicao(id).then(m => {
      const level = H.nextLevel(m.status);
      H.el('apr-nivel-title').textContent = `Aprovação de ${level} · ${m.codigo}`;
      H.el('apr-desc').textContent = `Confirma a aprovação desta medição no nível ${level}? A medição avançará para o próximo estágio.`;
      H.el('apr-obs').value = '';
      UI.openModal('modal-aprovar');
    }).catch(e => UI.toast('Erro: ' + e.message, 'error'));
  },

  openReprovar(id) {
    State.currentActionMedicaoId = id;
    H.el('repr-motivo').value = '';
    UI.openModal('modal-reprovar');
  },

  async confirmarAprovacao() {
    const id = State.currentActionMedicaoId;
    if(!id) return;
    const obs = H.el('apr-obs').value;
    try {
      const r = await API.aprovar(id, obs);
      UI.closeModal('modal-aprovar');
      UI.toast(`✓ Medição aprovada — novo status: ${r.novoStatus}`, 'success');
      if(State.currentPage==='medicoes') await Pages.medicoes();
      if(State.currentPage==='acompanhamento') await Pages.acompanhamento();
      if(State.currentPage==='dashboard') await Pages.dashboard();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async confirmarReprovacao() {
    const id = State.currentActionMedicaoId;
    const motivo = H.el('repr-motivo').value.trim();
    if(!motivo) { UI.toast('Informe o motivo da reprovação','error'); return; }
    try {
      await API.reprovar(id, motivo);
      UI.closeModal('modal-reprovar');
      UI.toast('Medição reprovada. Lançador será notificado.', 'error');
      if(State.currentPage==='medicoes') await Pages.medicoes();
      if(State.currentPage==='acompanhamento') await Pages.acompanhamento();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async openDetalhe(id) {
    State.currentMedicaoId = id;
    try {
      const m = await API.medicao(id);
      const aprs = m.aprovacoes || [];
      const evids = m.evidencias || [];
      H.el('det-title').innerHTML = `<span class="cc" style="font-size:14px">${m.codigo}</span> ${H.statusBadge(m.status)}`;
      const stepState = (lv) => {
        const a = aprs.find(a=>a.nivel===lv);
        if(a?.acao==='reprovado') return 'rej';
        if(a?.acao==='aprovado') return 'done';
        if(m.status===`Aguardando ${lv}`) return 'curr';
        return '';
      };
      H.el('det-body').innerHTML = `
        <div style="margin-bottom:20px">
          <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:12px">FLUXO DE APROVAÇÃO</div>
          <div class="aflow" style="max-width:480px">
            ${['N1','N2','N3'].map(lv => {
              const a = aprs.find(a=>a.nivel===lv);
              const sc = stepState(lv);
              return `<div class="afstep ${sc}">
                <div class="afdot">${a?.acao==='aprovado'?'✓':a?.acao==='reprovado'?'✗':lv}</div>
                <div class="af-lbl">${lv}</div>
                <div class="af-name">${a?.usuario||'Aguardando'}</div>
                <div class="af-date">${a?H.fmtDateShort(a.data_hora):'—'}</div>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="tabs" id="det-tabs">
          <div class="tab active" data-dtab="info">Informações</div>
          <div class="tab" data-dtab="evidencias">Evidências (${evids.length})</div>
          <div class="tab" data-dtab="historico">Histórico</div>
          <div class="tab" data-dtab="nf">Nota Fiscal</div>
        </div>
        <div id="det-tab-content">
          <div id="dt-info">
            ${(() => {
              const vtot  = parseFloat(m.contrato_valor_total) || 0;
              const pAnt  = parseFloat(m.pct_anterior_contrato) || 0;
              const pAtual= parseFloat(m.pct_esta_medicao) || 0;
              const pAcum = parseFloat(m.pct_acumulado_contrato) || 0;
              const pSaldo= Math.max(0, parseFloat((100 - pAcum).toFixed(2)));
              const vAnt  = parseFloat(m.valor_exec_anterior) || 0;
              const vAtual= parseFloat(m.valor_medicao) || 0;
              const vSaldo= Math.max(0, vtot - vAnt - vAtual);
              if(!vtot) return '';
              return `
              <div class="stacked-bar-wrap">
                <div class="stacked-bar-title">📊 PROGRESSO FINANCEIRO DO CONTRATO</div>
                <div class="stacked-bar">
                  <div class="stacked-bar-seg anterior" style="width:${pAnt}%" title="Executado anteriormente: ${pAnt}%"></div>
                  <div class="stacked-bar-seg atual"    style="width:${pAtual}%" title="Esta medição: ${pAtual}%"></div>
                </div>
                <div class="stacked-bar-labels">
                  <div class="stacked-bar-lbl"><div class="stacked-bar-dot" style="background:#22c55e"></div>Executado anteriormente (${pAnt}%)</div>
                  <div class="stacked-bar-lbl"><div class="stacked-bar-dot" style="background:var(--accent)"></div>Esta medição (${pAtual}%)</div>
                  <div class="stacked-bar-lbl"><div class="stacked-bar-dot" style="background:var(--surface3);border:1px solid var(--border)"></div>Saldo disponível (${pSaldo}%)</div>
                </div>
                <div class="stacked-bar-pct-row">
                  <div class="spct-box">
                    <div class="spct-box-lbl">Executado Anterior</div>
                    <div class="spct-box-val" style="color:#16a34a">${pAnt}%</div>
                    <div class="spct-box-sub">R$ ${H.fmt(vAnt)}</div>
                  </div>
                  <div class="spct-box" style="border-color:var(--accent2)">
                    <div class="spct-box-lbl">Esta Medição</div>
                    <div class="spct-box-val" style="color:var(--accent)">${pAtual}%</div>
                    <div class="spct-box-sub">R$ ${H.fmt(vAtual)}</div>
                  </div>
                  <div class="spct-box">
                    <div class="spct-box-lbl">Saldo Contrato</div>
                    <div class="spct-box-val" style="color:var(--text2)">${pSaldo}%</div>
                    <div class="spct-box-sub">R$ ${H.fmt(vSaldo)}</div>
                  </div>
                </div>
              </div>`;
            })()}
            <div class="ig">
              <div><div class="ii-lbl">Empresa</div><div class="ii-val">${m.empresa_nome||'—'}</div></div>
              <div><div class="ii-lbl">Obra</div><div class="ii-val">${m.obra_nome||'—'}</div></div>
              <div><div class="ii-lbl">Período</div><div class="ii-val">${H.periodoLabel(m.periodo)}</div></div>
              <div><div class="ii-lbl">Fornecedor</div><div class="ii-val">${m.fornecedor_nome||'—'}</div></div>
              <div><div class="ii-lbl">Contrato</div><div class="ii-val"><span class="cc">${m.contrato_numero||'—'}</span></div></div>
              <div><div class="ii-lbl">Valor desta Medição</div><div class="ii-val" style="font-family:var(--font-m);color:var(--accent);font-size:15px">R$ ${H.fmt(m.valor_medicao)}</div></div>
              <div><div class="ii-lbl">Valor Acumulado</div><div class="ii-val" style="font-family:var(--font-m)">R$ ${H.fmt(m.valor_acumulado)}</div></div>
              <div><div class="ii-lbl">Lançado por</div><div class="ii-val">${m.criado_por} · ${H.fmtDateShort(m.criado_em)}</div></div>
            </div>
            ${(m.itens||[]).length ? `
            <div style="margin-top:16px">
              <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:8px">ITENS MEDIDOS</div>
              <div class="tc" style="overflow-x:auto">
                <table style="min-width:700px">
                  <thead><tr>
                    <th style="width:30px">#</th><th>Descrição</th><th>Un.</th>
                    <th>Qtd Contrat.</th><th>Qtd Anterior</th><th>Qtd Mês</th><th>Qtd Acum.</th>
                    <th>Vl Unit.</th><th>Valor Item</th>
                  </tr></thead>
                  <tbody>${(m.itens||[]).map((it,i)=>`<tr>
                    <td style="color:var(--text3);font-size:11px">${i+1}</td>
                    <td style="font-weight:500">${it.descricao}</td>
                    <td><span class="badge" style="background:var(--accent3);color:var(--accent)">${it.unidade}</span></td>
                    <td style="font-family:var(--font-m);font-size:11px">${parseFloat(it.qtd_contrato)}</td>
                    <td style="font-family:var(--font-m);font-size:11px">${parseFloat(it.qtd_anterior)}</td>
                    <td style="font-family:var(--font-m);font-size:11px;color:var(--accent);font-weight:600">${parseFloat(it.qtd_mes)}</td>
                    <td style="font-family:var(--font-m);font-size:11px">${parseFloat(it.qtd_acumulada)}</td>
                    <td style="font-family:var(--font-m);font-size:11px">R$ ${H.fmt(it.valor_unitario)}</td>
                    <td style="font-family:var(--font-m);font-size:11px;font-weight:600">R$ ${H.fmt(it.valor_item)}</td>
                  </tr>`).join('')}</tbody>
                  <tfoot><tr style="background:var(--surface2);font-weight:600">
                    <td colspan="8" style="text-align:right;font-size:10px;letter-spacing:1px;color:var(--text2)">TOTAL DESTA MEDIÇÃO</td>
                    <td style="font-family:var(--font-m);color:var(--accent)">R$ ${H.fmt(m.valor_medicao)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>` : ''}
            <div style="margin-top:14px"><div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:8px">DESCRIÇÃO / OBSERVAÇÕES</div>
            <div class="ibox"><div class="ibox-text" style="font-size:12px;line-height:1.6">${m.descricao||'Sem descrição'}</div></div></div>
          </div>
          <div id="dt-evidencias" style="display:none">
            ${evids.length ? evids.map(f=>`<div class="fitem"><span style="font-size:14px">${f.tipo==='img'?'🖼':f.tipo==='pdf'?'📄':'🎬'}</span><span class="fitem-name">${f.nome}</span><span class="fitem-sz">${f.tamanho}</span></div>`).join('') : '<div style="text-align:center;padding:30px;color:var(--text3)">Nenhuma evidência anexada</div>'}
            <button class="btn btn-o btn-sm" style="margin-top:10px" onclick="UI.toast('Upload disponível via /api/medicoes/${id}/evidencias','info')">+ Adicionar evidência</button>
          </div>
          <div id="dt-historico" style="display:none">
            <div class="tl">${[...aprs].reverse().map(a => {
              const icons = { aprovado:['g','✓'], reprovado:['r','✗'], lançado:['b','📋'], default:['','→'] };
              const [cls,ico] = icons[a.acao] || icons.default;
              return `<div class="tl-item"><div class="tl-dot ${cls}">${ico}</div><div class="tl-content"><div class="tl-act">${a.nivel} · ${a.acao.charAt(0).toUpperCase()+a.acao.slice(1)}</div><div class="tl-meta">${a.usuario} · ${H.fmtDate(a.data_hora)}</div>${a.comentario?`<div class="tl-comment">${a.comentario}</div>`:''}</div></div>`;
            }).join('')||'<div style="color:var(--text3);font-size:12px">Sem histórico registrado</div>'}</div>
          </div>
          <div id="dt-nf" style="display:none">
            <div class="ibox warn" style="margin-bottom:14px">
              <div class="ibox-title">⚠️ Instrução para Emissão da Nota Fiscal</div>
              <div class="ibox-text">O fornecedor deverá incluir obrigatoriamente o código <strong style="color:var(--accent);font-family:var(--font-m)">${m.codigo}</strong> no campo <strong>Observações / Dados Adicionais</strong> da Nota Fiscal.</div>
            </div>
            <div class="ibox">
              <div class="ii-lbl" style="margin-bottom:8px">STATUS DA NF</div>
              <div style="font-size:12px;color:var(--text3)">${m.status==='Concluído'?'✅ NF vinculada e processada':m.status==='Em Assinatura'?'⏳ Aguardando assinatura do fornecedor':'⏳ Medição ainda não aprovada completamente'}</div>
            </div>
          </div>
        </div>
      `;
      document.querySelectorAll('#det-tabs .tab').forEach(t => {
        t.addEventListener('click', function() {
          document.querySelectorAll('#det-tabs .tab').forEach(x=>x.classList.remove('active'));
          this.classList.add('active');
          ['info','evidencias','historico','nf'].forEach(tabId => {
            const el = H.el('dt-'+tabId);
            if(el) el.style.display = this.dataset.dtab===tabId?'block':'none';
          });
        });
      });
      const canA = H.canApprove(m.status, m);
      const canEnviarAssin = ['Aprovado','Em Assinatura'].includes(m.status);
      H.el('det-footer').innerHTML = `
        <button class="btn btn-o" onclick="UI.closeModal('modal-detalhe')">Fechar</button>
        ${canEnviarAssin ? `<button class="btn btn-a" style="background:var(--teal)" onclick="UI.closeModal('modal-detalhe');Medicoes.openEnviarAssinatura(${id})">✍ Enviar para Assinatura</button>` : ''}
        ${canA ? `<button class="btn btn-r" onclick="UI.closeModal('modal-detalhe');Medicoes.openReprovar(${id})">✗ Reprovar</button><button class="btn btn-g" onclick="UI.closeModal('modal-detalhe');Medicoes.openAprovar(${id})">✓ Aprovar</button>` : ''}
      `;
      UI.openModal('modal-detalhe');
    } catch(e) { UI.toast('Erro ao carregar detalhe: ' + e.message, 'error'); }
  },

  async openEnviarAssinatura(id) {
    try {
      const m = await API.medicao(id);
      if(!['Aprovado','Em Assinatura'].includes(m.status)) { UI.toast('Medição não está aprovada','error'); return; }
      State.currentActionMedicaoId = id;

      // Pré-preenche dados do fornecedor
      H.el('assin-codigo').textContent   = m.codigo;
      H.el('assin-email-forn').value     = m.fornecedor_email_assin || m.fornecedor_email || '';
      H.el('assin-tel-forn').value       = m.fornecedor_tel || '';
      H.el('assin-email-rem').value      = '';

      // Reseta canais para padrão (e-mail ativo, whatsapp inativo)
      const chkEmail = H.el('assin-canal-email');
      const chkWpp   = H.el('assin-canal-whatsapp');
      if (chkEmail) chkEmail.checked = true;
      if (chkWpp)   chkWpp.checked   = false;
      this._onCanalChange();

      // Verifica configuração do ClickSign e exibe status
      const platEl = H.el('assin-status-plat');
      if (platEl) {
        try {
          const cfg = await API.config('assinatura');
          const c   = cfg?.valor || {};
          if (c.provedor === 'ClickSign' && c.accessToken && c.ativo) {
            const env = c.ambiente === 'producao' ? 'Produção' : 'Sandbox';
            platEl.innerHTML = `<div class="ibox success" style="padding:8px 12px;display:flex;align-items:center;gap:8px">
              <span style="font-size:18px">✅</span>
              <div><div style="font-size:12px;font-weight:600;color:var(--green)">ClickSign configurado (${env})</div>
              <div style="font-size:11px;color:var(--text3)">O documento será gerado em PDF e enviado automaticamente via ClickSign.</div></div>
            </div>`;
          } else if (c.provedor === 'ClickSign' && c.accessToken && !c.ativo) {
            platEl.innerHTML = `<div class="ibox warn" style="padding:8px 12px">
              <div style="font-size:12px;font-weight:600">⚠️ ClickSign configurado mas inativo</div>
              <div style="font-size:11px;color:var(--text3)">Ative a integração em Configurações → Assinatura Eletrônica para envio automático.</div>
            </div>`;
          } else {
            platEl.innerHTML = `<div class="ibox warn" style="padding:8px 12px">
              <div style="font-size:12px;font-weight:600">⚠️ ClickSign não configurado</div>
              <div style="font-size:11px;color:var(--text3)">Configure em Configurações → Assinatura Eletrônica. O envio registrará o documento mas não disparará o link de assinatura.</div>
            </div>`;
          }
        } catch(_) {
          platEl.innerHTML = '';
        }
      }

      // Monta prévia do documento
      const fmt = (v) => parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      const meses = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      const [ano, mes] = (m.periodo||'').split('-');
      const periodoLabel = m.periodo ? `${meses[parseInt(mes)]}/${ano}` : '—';
      H.el('assin-preview').textContent =
`AUTORIZAÇÃO DE EMISSÃO DE NOTA FISCAL
${'='.repeat(56)}
Empresa    : ${m.empresa_nome||'—'}
Obra       : ${m.obra_nome||'—'}
Fornecedor : ${m.fornecedor_nome||'—'}
Contrato   : ${m.contrato_numero||'—'}
Código     : ${m.codigo}
Período    : ${periodoLabel}
${'—'.repeat(56)}
EVOLUÇÃO PERCENTUAL
% Anterior acumulado  : ${m.pct_anterior||0}%
% Medido neste período: ${m.pct_mes||0}%
% Acumulado total     : ${m.pct_total||0}%
${'—'.repeat(56)}
VALOR AUTORIZADO PARA EMISSÃO DA NOTA FISCAL
Valor desta medição : R$ ${fmt(m.valor_medicao)}
Valor acumulado     : R$ ${fmt(m.valor_acumulado)}
${'—'.repeat(56)}
SERVIÇOS / OBSERVAÇÕES
${m.descricao||'Conforme contrato vigente.'}
${'='.repeat(56)}
IMPORTANTE: A NF deverá ser emitida no valor de
R$ ${fmt(m.valor_medicao)} incluindo o código ${m.codigo}
no campo "Observações / Dados Adicionais" da NF.
${'='.repeat(56)}`;

      UI.openModal('modal-assinatura-envio');
    } catch(e) { UI.toast('Erro ao carregar medição: ' + e.message, 'error'); }
  },

  _onCanalChange() {
    const email = H.el('assin-canal-email')?.checked;
    const wpp   = H.el('assin-canal-whatsapp')?.checked;
    // E-mail nunca é ocultado — ClickSign exige como identificador do signatário
    const wWpp  = H.el('assin-wrap-whatsapp');
    if (wWpp) wWpp.style.display = wpp ? '' : 'none';
    // Atualiza label do botão
    const btn = H.el('assin-btn-enviar');
    if (btn) {
      if (email && wpp) btn.textContent = '✉💬 Enviar por E-mail e WhatsApp';
      else if (wpp)     btn.textContent = '💬 Enviar por WhatsApp';
      else              btn.textContent = '✉ Enviar por E-mail';
    }
  },

  async confirmarEnvioAssinatura() {
    const id               = State.currentActionMedicaoId;
    const canalEmail       = H.el('assin-canal-email')?.checked;
    const canalWhatsapp    = H.el('assin-canal-whatsapp')?.checked;
    // E-mail sempre lido — obrigatório pelo ClickSign como identificador do signatário
    const email_fornecedor = H.el('assin-email-forn')?.value.trim() || '';
    const tel_fornecedor   = canalWhatsapp ? H.el('assin-tel-forn')?.value.trim()  : '';
    const email_remetente  = H.el('assin-email-rem')?.value.trim();

    // Validação
    if (!canalEmail && !canalWhatsapp) { UI.toast('Selecione ao menos um canal de envio','error'); return; }
    if (!email_fornecedor) { UI.toast('Informe o e-mail do fornecedor (obrigatório para o ClickSign)','error'); return; }
    if (canalWhatsapp && !tel_fornecedor) { UI.toast('Informe o telefone / WhatsApp do fornecedor','error'); return; }

    const btn = H.el('assin-btn-enviar');
    btn.disabled = true;
    btn.textContent = '⏳ Enviando...';

    try {
      const canais = [];
      if (canalEmail)    canais.push('email');
      if (canalWhatsapp) canais.push('whatsapp');

      const r = await API.enviarAssinatura(id, {
        email_fornecedor,
        tel_fornecedor,
        email_remetente,
        canais,
      });

      UI.closeModal('modal-assinatura-envio');

      const destMsg = [
        email_fornecedor ? `✉ ${email_fornecedor}` : null,
        tel_fornecedor   ? `💬 ${tel_fornecedor}`  : null,
      ].filter(Boolean).join(' · ');

      UI.toast(`✓ Documento enviado — ${destMsg}`, 'success');

      if(State.currentPage==='medicoes')       await Pages.medicoes.bind(Pages)();
      if(State.currentPage==='acompanhamento') await Pages.acompanhamento.bind(Pages)();
      if(State.currentPage==='dashboard')      await Pages.dashboard.bind(Pages)();
    } catch(e) {
      UI.toast('Erro: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      this._onCanalChange(); // restaura label do botão
    }
  },
};

// ══════════════════════════════════════
// CADASTROS
// ══════════════════════════════════════
