const Cadastros = {
  newEmpresa() { State.editingId=null; ['emp-razao','emp-fantasia','emp-cnpj'].forEach(id=>{const e=H.el(id);if(e)e.value=''}); H.el('emp-ativo').value='1'; H.el('emp-title').textContent='🏢 NOVA EMPRESA'; UI.openModal('modal-empresa'); },
  async editEmpresa(id) {
    State.editingId=id;
    const e = State.cache.empresas.find(x=>x.id===id) || (await API.empresas()).find(x=>x.id===id);
    H.el('emp-razao').value=e.razao_social||''; H.el('emp-fantasia').value=e.nome_fantasia||'';
    H.el('emp-cnpj').value=e.cnpj||''; H.el('emp-ativo').value=e.ativo?'1':'0';
    H.el('emp-title').textContent='✏ EDITAR EMPRESA'; UI.openModal('modal-empresa');
  },
  async saveEmpresa() {
    const razao_social=H.el('emp-razao').value.trim(); const cnpj=H.el('emp-cnpj').value.trim();
    if(!razao_social||!cnpj){UI.toast('Razão Social e CNPJ são obrigatórios','error');return;}
    const data={razao_social, nome_fantasia:H.el('emp-fantasia').value.trim(), cnpj, ativo:parseInt(H.el('emp-ativo').value)===1};
    try {
      if(State.editingId) await API.updateEmpresa(State.editingId, data);
      else await API.createEmpresa(data);
      UI.closeModal('modal-empresa'); UI.toast('Empresa salva com sucesso','success'); await Pages._cadEmpresas();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },
  async deleteEmpresa(id) { if(!confirm('Excluir empresa?'))return; try { await API.deleteEmpresa(id); UI.toast('Empresa excluída'); await Pages._cadEmpresas(); } catch(e){UI.toast('Erro: '+e.message,'error');} },

  _onMetodologiaChange() {
    const val = document.querySelector('input[name="obra-metodologia"]:checked')?.value || 'gantt';
    const ganttCard = H.el('obra-met-gantt-card');
    const lbmCard   = H.el('obra-met-lbm-card');
    if (ganttCard) ganttCard.style.borderColor = val === 'gantt' ? 'var(--accent)' : 'var(--border)';
    if (ganttCard) ganttCard.style.background  = val === 'gantt' ? 'var(--accent3)' : 'var(--surface2)';
    if (lbmCard)   lbmCard.style.borderColor   = val === 'lbm'   ? 'var(--green)'  : 'var(--border)';
    if (lbmCard)   lbmCard.style.background    = val === 'lbm'   ? 'rgba(34,197,94,.08)' : 'var(--surface2)';
  },
  async newObra() {
    State.editingId=null;
    const emps=await API.empresas(); State.cache.empresas=emps;
    H.el('obra-empresa').innerHTML='<option value="">Selecione...</option>'+emps.map(e=>`<option value="${e.id}">${e.nome_fantasia||e.razao_social}</option>`).join('');
    ['obra-codigo','obra-nome','obra-local','obra-gestor'].forEach(id=>H.el(id).value='');
    // Reset metodologia para gantt
    const radGantt = document.querySelector('input[name="obra-metodologia"][value="gantt"]');
    if (radGantt) { radGantt.checked = true; this._onMetodologiaChange(); }
    H.el('obra-status').value='Em andamento'; H.el('obra-title').textContent='🏗 NOVA OBRA'; UI.openModal('modal-obra');
  },
  async editObra(id) {
    State.editingId=id;
    const [o, emps] = await Promise.all([ API.obras().then(list=>list.find(x=>x.id===id)), API.empresas() ]);
    State.cache.empresas=emps;
    H.el('obra-empresa').innerHTML='<option value="">Selecione...</option>'+emps.map(e=>`<option value="${e.id}" ${e.id===o.empresa_id?'selected':''}>${e.nome_fantasia||e.razao_social}</option>`).join('');
    H.el('obra-codigo').value=o.codigo||''; H.el('obra-nome').value=o.nome||'';
    H.el('obra-local').value=o.localizacao||''; H.el('obra-gestor').value=o.gestor||'';
    H.el('obra-status').value=o.status||'Em andamento';
    // Metodologia
    const met = o.metodologia || 'gantt';
    const radMet = document.querySelector(`input[name="obra-metodologia"][value="${met}"]`);
    if (radMet) { radMet.checked = true; this._onMetodologiaChange(); }
    H.el('obra-title').textContent='✏ EDITAR OBRA'; UI.openModal('modal-obra');
  },
  async saveObra() {
    const empresa_id=parseInt(H.el('obra-empresa').value); const codigo=H.el('obra-codigo').value.trim();
    const nome=H.el('obra-nome').value.trim();
    if(!empresa_id||!codigo||!nome){UI.toast('Empresa, código e nome são obrigatórios','error');return;}
    const metodologia = document.querySelector('input[name="obra-metodologia"]:checked')?.value || 'gantt';
    const data={empresa_id,codigo,nome,localizacao:H.el('obra-local').value.trim(),gestor:H.el('obra-gestor').value.trim(),status:H.el('obra-status').value,metodologia};
    try {
      if(State.editingId) await API.updateObra(State.editingId, data);
      else await API.createObra(data);
      UI.closeModal('modal-obra'); UI.toast('Obra salva','success'); await Pages._cadObras();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },
  async deleteObra(id){if(!confirm('Excluir obra?'))return;try{await API.deleteObra(id);UI.toast('Obra excluída');await Pages._cadObras();}catch(e){UI.toast('Erro: '+e.message,'error');}},

  async newFornecedor() {
    State.editingId=null;
    ['forn-razao','forn-fantasia','forn-cnpj','forn-tel','forn-email','forn-emailnf','forn-emailassin','forn-endereco','forn-representante','forn-cargo','forn-cpf-rep'].forEach(id=>{ const el=H.el(id); if(el) el.value=''; });
    H.el('forn-ativo').value='1';
    H.el('forn-title').textContent='🤝 NOVO FORNECEDOR';
    // Limpa painel IA
    const s=H.el('forn-ia-status'); if(s){s.style.display='none'; s.innerHTML='';}
    const fFile=H.el('forn-ia-file'); if(fFile) fFile.value='';
    UI.openModal('modal-fornecedor');
  },
  async editFornecedor(id) {
    State.editingId=id;
    const f = State.cache.fornecedores.find(x=>x.id===id) || (await API.fornecedores()).find(x=>x.id===id);
    H.el('forn-razao').value=f.razao_social||'';
    H.el('forn-fantasia').value=f.nome_fantasia||'';
    H.el('forn-cnpj').value=f.cnpj||'';
    H.el('forn-tel').value=f.tel||'';
    H.el('forn-email').value=f.email||'';
    H.el('forn-emailnf').value=f.email_nf||'';
    H.el('forn-emailassin').value=f.email_assin||'';
    H.el('forn-endereco').value=f.endereco||'';
    H.el('forn-representante').value=f.representante||'';
    H.el('forn-cargo').value=f.cargo_representante||'';
    H.el('forn-ativo').value=f.ativo?'1':'0';
    const cpfRepEl=H.el('forn-cpf-rep'); if(cpfRepEl) cpfRepEl.value=f.cpf_representante||'';
    H.el('forn-title').textContent='✏ EDITAR FORNECEDOR';
    const s=H.el('forn-ia-status'); if(s){s.style.display='none'; s.innerHTML='';}
    UI.openModal('modal-fornecedor');
  },
  async saveFornecedor() {
    const razao_social=H.el('forn-razao').value.trim();
    const cnpj=H.el('forn-cnpj').value.trim();
    if(!razao_social||!cnpj){UI.toast('Razão Social e CNPJ são obrigatórios','error');return;}
    const data={
      razao_social,
      nome_fantasia:       H.el('forn-fantasia').value.trim(),
      cnpj,
      tel:                 H.el('forn-tel').value.trim(),
      email:               H.el('forn-email').value.trim(),
      email_nf:            H.el('forn-emailnf').value.trim(),
      email_assin:         H.el('forn-emailassin').value.trim(),
      endereco:            H.el('forn-endereco').value.trim(),
      representante:          H.el('forn-representante').value.trim(),
      cargo_representante:    H.el('forn-cargo').value.trim(),
      cpf_representante:      H.el('forn-cpf-rep')?.value.trim()  || '',
      ativo:                  parseInt(H.el('forn-ativo').value)===1,
    };
    try {
      if(State.editingId) await API.updateFornecedor(State.editingId, data);
      else await API.createFornecedor(data);
      UI.closeModal('modal-fornecedor'); UI.toast('Fornecedor salvo','success'); await Pages._cadFornecedores();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },
  async deleteFornecedor(id){if(!confirm('Excluir fornecedor?'))return;try{await API.deleteFornecedor(id);UI.toast('Fornecedor excluído');await Pages._cadFornecedores();}catch(e){UI.toast('Erro: '+e.message,'error');}},

  // ── IA: Extração de dados do fornecedor ────────────────────────
  _fornIaOnDrop(ev) {
    ev.preventDefault();
    H.el('forn-ia-dropzone').classList.remove('drag');
    const file = ev.dataTransfer?.files?.[0];
    if (file) this._fornIaProcessFile(file);
  },
  _fornIaOnFileChange(input) {
    const file = input.files?.[0];
    if (file) this._fornIaProcessFile(file);
  },
  async _fornIaProcessFile(file) {
    if (!/\.(pdf|docx|doc)$/i.test(file.name)) return UI.toast('Formato não suportado. Use PDF ou DOCX.', 'error');
    const status = H.el('forn-ia-status');
    status.style.display = 'block';
    status.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)"><span class="ia-spin">⚙️</span> Analisando <b>${H.esc(file.name)}</b>… aguarde</div>`;
    try {
      const result = await API.interpretarFornecedor(file);
      const d = result.dados || {};

      // Preenche somente os campos com dados encontrados pela IA
      const fill = (id, val) => { const el = H.el(id); if (el && val) el.value = val; };
      fill('forn-razao',        d.razao_social);
      fill('forn-fantasia',     d.nome_fantasia);
      fill('forn-cnpj',         d.cnpj);
      fill('forn-tel',          d.tel);
      fill('forn-email',        d.email);
      fill('forn-emailnf',      d.email_nf  || d.email);
      fill('forn-emailassin',   d.email_assin || d.email);
      fill('forn-endereco',     d.endereco);
      fill('forn-representante',d.representante);
      fill('forn-cargo',        d.cargo_representante);

      // Monta resumo visual do que foi encontrado
      const encontrados = Object.entries({
        'Razão Social': d.razao_social, 'Nome Fantasia': d.nome_fantasia,
        'CNPJ': d.cnpj, 'Telefone': d.tel, 'E-mail': d.email,
        'E-mail NF': d.email_nf, 'E-mail Assinatura': d.email_assin,
        'Endereço': d.endereco, 'Representante': d.representante,
        'Cargo': d.cargo_representante,
      }).filter(([,v])=>v);

      if (encontrados.length === 0) {
        status.innerHTML = `<div class="ibox warn"><div class="ibox-title">⚠️ Nenhum dado encontrado</div><div class="ibox-text">O modelo não identificou dados cadastrais no documento. Verifique se o arquivo contém informações da empresa fornecedora e tente novamente.</div></div>`;
      } else {
        status.innerHTML = `
          <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:var(--r);padding:10px 14px">
            <div style="font-size:11px;font-weight:700;color:var(--green);margin-bottom:8px">✅ ${encontrados.length} campos preenchidos automaticamente</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${encontrados.map(([k,v])=>`<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:3px 10px;font-size:10px"><span style="color:var(--text3)">${H.esc(k)}:</span> <b style="color:var(--text)">${H.esc(String(v).slice(0,40))}</b></div>`).join('')}
            </div>
            <div style="font-size:10px;color:var(--text3);margin-top:8px">Revise os dados preenchidos antes de salvar. Campos em branco não foram localizados no documento.</div>
          </div>`;
        UI.toast(`${encontrados.length} campos preenchidos pela IA`, 'success');
      }
    } catch(e) {
      const isDica = e.message?.includes('não configurada') || e.message?.includes('Gemini');
      status.innerHTML = `<div class="ibox" style="border-color:var(--red)">
        <div class="ibox-title" style="color:var(--red)">❌ ${H.esc(e.message)}</div>
        ${isDica ? `<div class="ibox-text">Acesse <b>Configurações → 🤖 Inteligência Artificial</b> e informe sua chave Gemini gratuita.</div>` : ''}
      </div>`;
    } finally {
      const inp = H.el('forn-ia-file'); if (inp) inp.value = '';
    }
  },

  async newContrato() {
    State.editingId=null;
    const [emps, forns] = await Promise.all([ API.empresas(), API.fornecedores() ]); State.cache.empresas=emps; State.cache.fornecedores=forns;
    H.el('cont-empresa').innerHTML='<option value="">Selecione...</option>'+emps.map(e=>`<option value="${e.id}">${e.nome_fantasia||e.razao_social}</option>`).join('');
    H.el('cont-obra').innerHTML='<option value="">Selecione a empresa...</option>';
    H.el('cont-fornecedor').innerHTML='<option value="">Selecione...</option>'+forns.map(f=>`<option value="${f.id}">${f.nome_fantasia||f.razao_social}</option>`).join('');
    ['cont-numero','cont-objeto','cont-inicio','cont-termino','cont-obs'].forEach(id=>H.el(id).value='');
    H.el('cont-status').value='Vigente';
    H.el('cont-itens').innerHTML='';
    H.el('cont-valor-total-display').textContent='R$ 0,00';
    if(H.el('cont-valor')) H.el('cont-valor').value='';
    // Resetar seção de IA
    const iaStatus  = H.el('cont-ia-status');
    const iaPreview = H.el('cont-ia-preview');
    const iaFile    = H.el('cont-ia-file');
    if(iaStatus)  { iaStatus.style.display='none';  iaStatus.innerHTML=''; }
    if(iaPreview) { iaPreview.style.display='none'; iaPreview.innerHTML=''; }
    if(iaFile)    { iaFile.value=''; }
    // Resetar seção de atividades do cronograma
    this._clearAtividades();
    H.el('cont-title').textContent='📁 NOVO CONTRATO';
    UI.openModal('modal-contrato');
  },
  async editContrato(id) {
    State.editingId=id;
    const [conts, emps, forns, itens] = await Promise.all([ API.contratos(), API.empresas(), API.fornecedores(), API.contratoItens(id) ]);
    const c = conts.find(x=>x.id===id); State.cache.empresas=emps; State.cache.fornecedores=forns; State.cache.contratos=conts;
    H.el('cont-empresa').innerHTML='<option value="">Selecione...</option>'+emps.map(e=>`<option value="${e.id}" ${e.id===c.empresa_id?'selected':''}>${e.nome_fantasia||e.razao_social}</option>`).join('');
    await this.loadObrasByEmpresa('cont-empresa','cont-obra',c.obra_id);
    H.el('cont-fornecedor').innerHTML='<option value="">Selecione...</option>'+forns.map(f=>`<option value="${f.id}" ${f.id===c.fornecedor_id?'selected':''}>${f.nome_fantasia||f.razao_social}</option>`).join('');
    H.el('cont-numero').value=c.numero||''; H.el('cont-objeto').value=c.objeto||'';
    H.el('cont-inicio').value=c.inicio||''; H.el('cont-termino').value=c.termino||''; H.el('cont-obs').value=c.obs||'';
    H.el('cont-status').value=c.status||'Vigente';
    // Renderiza itens existentes
    H.el('cont-itens').innerHTML = itens.map((it,i) => this._contratoItemRowHTML(it,i)).join('');
    this._recalcContratoTotal();
    // Carrega atividades disponíveis do cronograma (e marca as já vinculadas)
    await this._loadAtividadesDisponiveis(id);
    H.el('cont-title').textContent='✏ EDITAR CONTRATO'; UI.openModal('modal-contrato');
  },
  async loadObrasByEmpresa(empElId, obraElId, selectedId) {
    const empId=parseInt(H.el(empElId)?.value);
    const obras = await API.obras(empId);
    H.el(obraElId).innerHTML='<option value="">Selecione a obra...</option>'+obras.map(o=>`<option value="${o.id}" ${o.id===selectedId?'selected':''}>${o.nome}</option>`).join('');
  },

  // ── Planilha orçamentária: item do contrato ─────────────────
  _UNIDADES_CONT: ['un','m²','m','m³','ml','kg','g','t','l','h','vb','%','cm','mm','pç','cj','gl'],
  _contratoItemRowHTML(it, idx) {
    const uns = this._UNIDADES_CONT;
    const qtd  = parseFloat(it?.qtd_total)||0;
    const vun  = parseFloat(it?.valor_unitario)||0;
    const vtot = parseFloat(it?.valor_total)||(qtd*vun);
    return `<div class="citem-row" data-idx="${idx}">
      <input class="fi citem-desc" style="flex:2;min-width:0" placeholder="Ex: Alvenaria de vedação em blocos *" value="${(it?.descricao||'').replace(/"/g,'&quot;')}" required>
      <select class="fi fsel citem-un" style="width:80px">
        ${uns.map(u=>`<option ${(it?.unidade||'un')===u?'selected':''}>${u}</option>`).join('')}
      </select>
      <input class="fi citem-qty" type="number" min="0" step="any" style="width:110px;text-align:right" placeholder="0" value="${qtd||''}" oninput="Cadastros._recalcContratoRow(this)">
      <input class="fi citem-vun" type="number" min="0" step="0.01" style="width:120px;text-align:right" placeholder="0,00" value="${vun||''}" oninput="Cadastros._recalcContratoRow(this)">
      <input class="fi citem-vtot" readonly style="width:120px;text-align:right" value="${H.fmt(vtot)}">
      <button class="btn btn-r btn-xs" style="width:28px;flex-shrink:0" onclick="this.closest('.citem-row').remove();Cadastros._recalcContratoTotal()" title="Remover">✕</button>
    </div>`;
  },
  _addContratoItem(it) {
    const container = H.el('cont-itens');
    const idx = container.querySelectorAll('.citem-row').length;
    container.insertAdjacentHTML('beforeend', this._contratoItemRowHTML(it || {}, idx));
    // Foca no campo de descrição somente para itens manuais (sem dados pré-preenchidos)
    if (!it?.descricao) container.querySelectorAll('.citem-desc')[idx]?.focus();
  },
  _recalcContratoRow(input) {
    const row  = input.closest('.citem-row');
    const qty  = parseFloat(row.querySelector('.citem-qty')?.value)  || 0;
    const vun  = parseFloat(row.querySelector('.citem-vun')?.value)  || 0;
    const vtotEl = row.querySelector('.citem-vtot');
    if(vtotEl) vtotEl.value = H.fmt(qty * vun);
    this._recalcContratoTotal();
  },
  _recalcContratoTotal() {
    const rows  = document.querySelectorAll('#cont-itens .citem-row');
    let total = 0;
    rows.forEach(row => {
      const qty = parseFloat(row.querySelector('.citem-qty')?.value)  || 0;
      const vun = parseFloat(row.querySelector('.citem-vun')?.value)  || 0;
      total += qty * vun;
    });
    if(H.el('cont-valor-total-display')) H.el('cont-valor-total-display').textContent = 'R$ ' + H.fmt(total);
    if(H.el('cont-valor')) H.el('cont-valor').value = total.toFixed(2);
  },
  _collectContratoItens() {
    const rows = document.querySelectorAll('#cont-itens .citem-row');
    return Array.from(rows).map((row,i) => ({
      ordem:          i,
      descricao:      row.querySelector('.citem-desc')?.value.trim() || '',
      unidade:        row.querySelector('.citem-un')?.value || 'un',
      qtd_total:      parseFloat(row.querySelector('.citem-qty')?.value)  || 0,
      valor_unitario: parseFloat(row.querySelector('.citem-vun')?.value)  || 0,
      valor_total:    parseFloat(row.querySelector('.citem-vtot')?.value?.replace(/\./g,'').replace(',','.')) || 0,
    }));
  },

  _highlightItensIncompletos() {
    document.querySelectorAll('#cont-itens .citem-row').forEach(row => {
      const qtyEl = row.querySelector('.citem-qty');
      const vunEl = row.querySelector('.citem-vun');
      const qty   = parseFloat(qtyEl?.value) || 0;
      const vun   = parseFloat(vunEl?.value) || 0;
      const markEl = (el, bad) => {
        if (!el) return;
        el.style.borderColor = bad ? 'var(--red)' : '';
        el.style.background  = bad ? 'rgba(239,68,68,.07)' : '';
        if (bad) el.addEventListener('input', () => {
          el.style.borderColor = '';
          el.style.background  = '';
        }, { once: true });
      };
      markEl(qtyEl, !(qty > 0));
      markEl(vunEl, !(vun > 0));
    });
  },

  // ── Atividades do Cronograma — seletor no formulário de contrato ──
  _clearAtividades() {
    const w = H.el('cont-cron-wrap');
    if (w) { w.style.display = 'none'; w.querySelector('.cont-cron-list')?.replaceChildren?.(); }
  },
  async _loadAtividadesObraChange() {
    // Chamado quando a obra muda no formulário de contrato (novo contrato)
    this._clearAtividades();
    const obraId = parseInt(H.el('cont-obra')?.value);
    if (!obraId) return;
    // Para novo contrato, busca cronogramas da obra e exibe seletor
    try {
      const cronogramas = await API.cronogramas(obraId);
      if (!cronogramas.length) return; // sem cronograma = sem seletor
      // Busca todas atividades dos cronogramas da obra (primeira versão ativa)
      const cron = cronogramas[0]; // versão mais recente (ORDER BY versao DESC)
      const atividades = await API.cronogramaAtividades(cron.id);
      this._renderAtividadesSelector(atividades, [], cron);
    } catch(e) { /* silencioso — cronograma é opcional */ }
  },
  async _loadAtividadesDisponiveis(contratoId) {
    // Chamado ao editar um contrato existente
    this._clearAtividades();
    try {
      const atividades = await API.contratoAtividadesDisponiveis(contratoId);
      if (!atividades.length) return;
      // Agrupa por cronograma
      const cronMap = {};
      for (const a of atividades) {
        if (!cronMap[a.cronograma_id]) cronMap[a.cronograma_id] = { nome: a.cronograma_nome, versao: a.versao, atividades: [] };
        cronMap[a.cronograma_id].atividades.push(a);
      }
      // Pega o cronograma mais recente (versão mais alta)
      const cronKey = Object.keys(cronMap).reduce((a,b) => cronMap[a].versao > cronMap[b].versao ? a : b);
      const cron = { id: parseInt(cronKey), ...cronMap[cronKey] };
      const vinculadas = atividades.filter(a => a.vinculado).map(a => a.id);
      this._renderAtividadesSelector(cron.atividades, vinculadas, cron);
    } catch(e) { /* silencioso */ }
  },
  _renderAtividadesSelector(atividades, vinculadas, cron) {
    const w = H.el('cont-cron-wrap');
    if (!w) return;
    const listEl = w.querySelector('.cont-cron-list');
    if (!listEl) return;

    const fmt = v => { if(!v) return ''; const [y,m,d]=String(v).slice(0,10).split('-'); return `${d}/${m}`; };

    listEl.innerHTML = atividades.map(a => {
      const checked = vinculadas.includes(a.id) ? 'checked' : '';
      const indent  = (a.nivel || 0) * 14;
      const style   = a.eh_resumo
        ? 'font-weight:600;color:var(--text)' : 'color:var(--text2)';
      const datas   = a.data_inicio ? ` <span style="color:var(--text3);font-size:9px">${fmt(a.data_inicio)}→${fmt(a.data_termino)}</span>` : '';
      return `<label class="cont-cron-item" style="padding-left:${indent+8}px">
        <input type="checkbox" class="cron-at-check" value="${a.id}" ${checked}>
        <span style="${style}">
          ${a.wbs ? `<b style="color:var(--text3);font-size:9px;margin-right:4px">${H.esc(a.wbs)}</b>` : ''}
          ${H.esc(a.nome)}${datas}
        </span>
      </label>`;
    }).join('');

    w.querySelector('.cont-cron-title').textContent = `🗓 ${cron.nome} (v${cron.versao})`;
    w.style.display = 'block';
  },
  _collectAtividadesIds() {
    return Array.from(document.querySelectorAll('.cron-at-check:checked')).map(el => parseInt(el.value));
  },

  async saveContrato() {
    const empresa_id=parseInt(H.el('cont-empresa').value); const obra_id=parseInt(H.el('cont-obra').value);
    const fornecedor_id=parseInt(H.el('cont-fornecedor').value); const numero=H.el('cont-numero').value.trim();
    const objeto=H.el('cont-objeto').value.trim();
    if(!empresa_id||!obra_id||!fornecedor_id||!numero||!objeto){UI.toast('Preencha todos os campos obrigatórios','error');return;}
    const itens = this._collectContratoItens();
    if(itens.length===0){UI.toast('Adicione pelo menos um item ao contrato','error');return;}
    if(itens.some(it=>!it.descricao)){UI.toast('Todos os itens precisam ter descrição','error');return;}

    // ── Validação: qtd e valor unitário obrigatórios ─────────────
    const itensIncompletos = itens.filter(it => !(it.qtd_total > 0) || !(it.valor_unitario > 0));
    if (itensIncompletos.length > 0) {
      this._highlightItensIncompletos();
      const n = itensIncompletos.length;
      UI.toast(`Preencha quantidade e valor unitário dos ${n} item${n>1?'s':''} destacado${n>1?'s':''}`, 'error');
      document.getElementById('cont-itens-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // ── Validação: ao menos uma atividade do cronograma vinculada ─
    const cronWrap = H.el('cont-cron-wrap');
    if (cronWrap && cronWrap.style.display !== 'none') {
      const atIds = this._collectAtividadesIds();
      if (atIds.length === 0) {
        cronWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Destaca o painel de seleção de atividades
        cronWrap.style.outline = '2px solid var(--red)';
        cronWrap.style.borderRadius = 'var(--r2)';
        setTimeout(() => { cronWrap.style.outline = ''; }, 3000);
        UI.toast('Associe pelo menos uma atividade do cronograma ao contrato', 'error');
        return;
      }
    }

    const valor_total = parseFloat(H.el('cont-valor').value)||0;
    const data={empresa_id,obra_id,fornecedor_id,numero,objeto,valor_total,
      inicio:H.el('cont-inicio').value||null,termino:H.el('cont-termino').value||null,
      status:H.el('cont-status').value,obs:H.el('cont-obs').value,itens};
    try {
      let savedId;
      if(State.editingId) { await API.updateContrato(State.editingId, data); savedId=State.editingId; }
      else { const r=await API.createContrato(data); savedId=r.id; }
      // Salva vínculos com atividades do cronograma (se seletor estiver visível)
      const atIds = this._collectAtividadesIds();
      if (H.el('cont-cron-wrap')?.style.display !== 'none') {
        await API.saveContratoAtividades(savedId, atIds).catch(()=>{});
      }
      UI.closeModal('modal-contrato'); UI.toast('Contrato salvo com sucesso','success'); await Pages._cadContratos();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },
  async deleteContrato(id){if(!confirm('Excluir contrato?'))return;try{await API.deleteContrato(id);UI.toast('Contrato excluído');await Pages._cadContratos();}catch(e){UI.toast('Erro: '+e.message,'error');}},

  // ── IA: Interpretação de contrato ──────────────────────────────
  _iaOnDrop(ev) {
    ev.preventDefault();
    document.getElementById('cont-ia-dropzone').classList.remove('drag');
    const file = ev.dataTransfer?.files?.[0];
    if (file) this._iaProcessFile(file);
  },
  _iaOnFileChange(input) {
    const file = input.files?.[0];
    if (file) this._iaProcessFile(file);
  },
  async _iaProcessFile(file) {
    if (!/\.(pdf|docx|doc)$/i.test(file.name)) return UI.toast('Formato não suportado. Use PDF ou DOCX.', 'error');

    const status  = document.getElementById('cont-ia-status');
    const preview = document.getElementById('cont-ia-preview');
    status.style.display  = 'block';
    preview.style.display = 'none';
    status.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)"><span class="ia-spin">⚙️</span> Analisando <b>${H.esc(file.name)}</b>… extraindo dados do contrato, fornecedor e planilha</div>`;

    try {
      const obraId = parseInt(H.el('cont-obra')?.value) || null;
      const result = await API.interpretarContrato(file, obraId);
      const itens       = result.itens       || [];
      const contrato    = result.contrato    || {};
      const fornecedor  = result.fornecedor  || {};
      const wbs_matches = result.wbs_matches || [];

      // ── 1. Preencher campos do contrato ──────────────────────────
      const fillFld = (id, val) => { const el = H.el(id); if (el && val) el.value = val; };
      fillFld('cont-numero',  contrato.numero);
      fillFld('cont-objeto',  contrato.objeto);
      fillFld('cont-inicio',  contrato.data_inicio);
      fillFld('cont-termino', contrato.data_termino);
      fillFld('cont-obs',     contrato.observacoes);

      const camposContrato = [contrato.numero, contrato.objeto, contrato.data_inicio, contrato.data_termino]
        .filter(Boolean).length;

      // ── 2. Auto-selecionar fornecedor cadastrado ─────────────────
      let fornMatch = null;
      let fornMsg   = '';
      if (fornecedor.cnpj || fornecedor.razao_social) {
        const forns = State.cache.fornecedores || [];
        // Normaliza CNPJ removendo pontuação para comparação
        const normCnpj = s => (s||'').replace(/\D/g,'');
        const normNome = s => (s||'').toLowerCase().trim();

        if (fornecedor.cnpj) {
          fornMatch = forns.find(f => normCnpj(f.cnpj) === normCnpj(fornecedor.cnpj));
        }
        if (!fornMatch && fornecedor.razao_social) {
          // Tenta match parcial pelo nome (primeiras 2 palavras)
          const palavras = normNome(fornecedor.razao_social).split(' ').slice(0,2).join(' ');
          fornMatch = forns.find(f => normNome(f.razao_social).includes(palavras) || normNome(f.nome_fantasia||'').includes(palavras));
        }

        if (fornMatch) {
          const sel = H.el('cont-fornecedor');
          if (sel) sel.value = String(fornMatch.id);
          fornMsg = `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--green)">✅ Fornecedor encontrado e selecionado: <b>${H.esc(fornMatch.nome_fantasia||fornMatch.razao_social)}</b></div>`;
        } else {
          // Fornecedor não cadastrado — mostra aviso com dados encontrados
          const cnpjLabel = fornecedor.cnpj ? ` · CNPJ: ${H.esc(fornecedor.cnpj)}` : '';
          fornMsg = `<div style="background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.3);border-radius:var(--r);padding:8px 12px;font-size:11px">
            <b style="color:var(--yellow)">⚠️ Fornecedor não cadastrado</b>${cnpjLabel}<br>
            <span style="color:var(--text2)">${H.esc(fornecedor.razao_social||'Razão social não identificada')}</span><br>
            <span style="color:var(--text3);font-size:10px">Cadastre este fornecedor primeiro e depois volte a criar o contrato.</span>
          </div>`;
        }
      }

      // ── 3. Aplicar itens automaticamente na planilha ─────────────
      if (itens.length > 0) {
        document.getElementById('cont-itens').innerHTML = '';
        itens.forEach(it => this._addContratoItem({
          descricao:      it.descricao,
          unidade:        it.unidade || 'un',
          qtd_total:      it.qtd_total || 0,
          valor_unitario: it.valor_unitario || 0,
        }));
        this._recalcContratoTotal();
        // Scroll suave até a planilha para o operador revisar
        setTimeout(() => document.getElementById('cont-itens-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
      }

      // ── 4. Auto-vincular atividades WBS identificadas ─────────────
      let wbsMsg = '';
      if (wbs_matches.length > 0) {
        // Marcar checkboxes das atividades encontradas no seletor de WBS
        const markedIds = [];
        wbs_matches.forEach(m => {
          const cb = document.querySelector(`.cron-at-check[value="${m.atividade_id}"]`);
          if (cb) { cb.checked = true; markedIds.push(m); }
        });
        if (markedIds.length > 0) {
          const wbsList = markedIds.map(m =>
            `<span style="font-family:var(--font-m);font-size:10px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);padding:1px 6px;color:var(--accent)">${H.esc(m.wbs)}</span> ${H.esc(m.nome)}`
          ).join('<br>');
          wbsMsg = `<div style="margin-top:8px;background:rgba(99,102,241,.07);border:1px solid rgba(99,102,241,.25);border-radius:var(--r);padding:8px 12px;font-size:11px">
            <b style="color:var(--accent)">🗓 ${markedIds.length} atividade${markedIds.length>1?'s':''} WBS vinculada${markedIds.length>1?'s':''} automaticamente</b><br>
            <div style="margin-top:4px;line-height:1.8">${wbsList}</div>
          </div>`;
          // Garante que o painel de cronograma está visível
          const w = H.el('cont-cron-wrap');
          if (w) w.style.display = 'block';
        } else if (obraId) {
          // WBS encontrados no documento mas sem cronograma carregado ainda
          const codesFound = wbs_matches.map(m => m.wbs).join(', ');
          wbsMsg = `<div style="margin-top:8px;font-size:10px;color:var(--text3)">🗓 Códigos WBS encontrados no documento: <b>${H.esc(codesFound)}</b> — selecione a obra primeiro para vincular automaticamente.</div>`;
        }
      }

      // ── 5. Painel de resumo final ─────────────────────────────────
      const badges = [];
      if (camposContrato > 0) badges.push(`<span style="background:rgba(99,102,241,.12);color:var(--accent);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600">📋 ${camposContrato} campo${camposContrato>1?'s':''} do contrato</span>`);
      if (fornMatch)           badges.push(`<span style="background:rgba(34,197,94,.12);color:var(--green);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600">🤝 Fornecedor selecionado</span>`);
      if (itens.length > 0)    badges.push(`<span style="background:rgba(20,184,166,.12);color:var(--teal);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600">📊 ${itens.length} itens na planilha</span>`);
      if (wbs_matches.length > 0) badges.push(`<span style="background:rgba(99,102,241,.12);color:var(--accent);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600">🗓 ${wbs_matches.length} WBS vinculado${wbs_matches.length>1?'s':''}</span>`);

      status.innerHTML = `
        <div style="background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.25);border-radius:var(--r);padding:10px 14px">
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:${(fornMsg||wbsMsg)?'8':'0'}px">
            <span style="font-size:12px;font-weight:700;color:var(--green)">✅ Preenchimento automático concluído</span>
            ${badges.join('')}
          </div>
          ${fornMsg}
          ${wbsMsg}
          ${itens.length > 0 ? `<div style="font-size:10px;color:var(--text3);margin-top:6px">Planilha orçamentária com ${itens.length} ${itens.length===1?'item':'itens'} inserida abaixo — revise os dados e salve quando estiver pronto.</div>` : ''}
        </div>
        ${(camposContrato === 0 && !fornMatch && itens.length === 0) ? `<div class="ibox warn" style="margin-top:8px"><div class="ibox-title">⚠️ Poucos dados identificados</div><div class="ibox-text">O documento pode não ser um contrato de obras ou estar em formato não reconhecível. Preencha os campos manualmente.</div></div>` : ''}`;

      preview.style.display = 'none';

    } catch(e) {
      const isDica = e.message?.includes('não configurada') || e.message?.includes('Gemini');
      status.innerHTML = `<div class="ibox" style="border-color:var(--red)">
        <div class="ibox-title" style="color:var(--red)">❌ ${H.esc(e.message)}</div>
        ${isDica ? `<div class="ibox-text">Acesse <b>Configurações → 🤖 Inteligência Artificial</b> e informe sua chave Gemini gratuita para usar este recurso.</div>` : ''}
      </div>`;
    } finally {
      const inp = document.getElementById('cont-ia-file');
      if (inp) inp.value = '';
    }
  },
  _iaAplicar(itens) {
    if (!itens?.length) return;
    document.getElementById('cont-itens').innerHTML = '';
    itens.forEach(it => {
      this._addContratoItem({
        descricao:      it.descricao,
        unidade:        it.unidade || 'un',
        qtd_total:      it.qtd_total || 0,
        valor_unitario: it.valor_unitario || 0,
      });
    });
    this._recalcContratoTotal();
    document.getElementById('cont-ia-preview').style.display = 'none';
    document.getElementById('cont-ia-status').innerHTML += `<div style="font-size:11px;color:var(--green);margin-top:6px">✅ ${itens.length} itens aplicados à planilha. Revise antes de salvar.</div>`;
    document.getElementById('cont-itens-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    UI.toast(`${itens.length} itens importados pela IA`, 'success');
  },

  // ══════════════════════════════════════
  // IMPORTAÇÃO EM MASSA (CSV)
  // ══════════════════════════════════════
  _bulkEntity: null, // 'empresas' | 'obras' | 'fornecedores'
  _bulkRows:   [],

  _bulkConfig: {
    empresas: {
      title: '📥 IMPORTAR EMPRESAS EM MASSA',
      endpoint: '/api/empresas/bulk',
      desc: 'Cada linha representa uma empresa. Campos obrigatórios: <strong>razao_social</strong> e <strong>cnpj</strong>.',
      cols: [
        { key: 'razao_social',  label: 'razao_social',  req: true,  ex: 'CONSTRUTORA EXEMPLO LTDA' },
        { key: 'nome_fantasia', label: 'nome_fantasia', req: false, ex: 'CONSTRUTORA EXEMPLO' },
        { key: 'cnpj',         label: 'cnpj',          req: true,  ex: '00.000.000/0001-00' },
      ],
    },
    obras: {
      title: '📥 IMPORTAR OBRAS EM MASSA',
      endpoint: '/api/obras/bulk',
      desc: 'Cada linha representa uma obra. Use o CNPJ da empresa já cadastrada. Campos obrigatórios: <strong>empresa_cnpj</strong>, <strong>codigo</strong> e <strong>nome</strong>.',
      cols: [
        { key: 'empresa_cnpj', label: 'empresa_cnpj', req: true,  ex: '00.000.000/0001-00' },
        { key: 'codigo',       label: 'codigo',       req: true,  ex: 'OBR-001' },
        { key: 'nome',         label: 'nome',         req: true,  ex: 'Edifício Residencial Alpha' },
        { key: 'localizacao',  label: 'localizacao',  req: false, ex: 'São Paulo, SP' },
        { key: 'gestor',       label: 'gestor',       req: false, ex: 'João Silva' },
        { key: 'status',       label: 'status',       req: false, ex: 'Em andamento' },
      ],
    },
    fornecedores: {
      title: '📥 IMPORTAR FORNECEDORES EM MASSA',
      endpoint: '/api/fornecedores/bulk',
      desc: 'Cada linha representa um fornecedor. Campos obrigatórios: <strong>razao_social</strong> e <strong>cnpj</strong>.',
      cols: [
        { key: 'razao_social',       label: 'razao_social',       req: true,  ex: 'FURA SOLO SERVIÇOS LTDA' },
        { key: 'nome_fantasia',      label: 'nome_fantasia',      req: false, ex: 'FURA SOLO' },
        { key: 'cnpj',               label: 'cnpj',               req: true,  ex: '00.000.000/0001-00' },
        { key: 'tel',                label: 'tel',                req: false, ex: '(65) 99999-0000' },
        { key: 'email',              label: 'email',              req: false, ex: 'contato@furasolo.com.br' },
        { key: 'email_nf',           label: 'email_nf',           req: false, ex: 'nf@furasolo.com.br' },
        { key: 'email_assin',        label: 'email_assin',        req: false, ex: 'assinatura@furasolo.com.br' },
        { key: 'endereco',           label: 'endereco',           req: false, ex: 'Rua das Pedras, 100, Sorriso, MT' },
        { key: 'representante',      label: 'representante',      req: false, ex: 'João da Silva' },
        { key: 'cargo_representante',label: 'cargo_representante',req: false, ex: 'Administrador' },
        { key: 'cpf_representante',  label: 'cpf_representante',  req: false, ex: '000.000.000-00' },
      ],
    },
  },

  openBulkImport(entity) {
    this._bulkEntity = entity;
    this._bulkRows   = [];
    const cfg = this._bulkConfig[entity];
    H.el('bulk-title').textContent = cfg.title;
    H.el('bulk-layout-desc').innerHTML = cfg.desc;
    H.el('bulk-filename').textContent = 'Nenhum arquivo selecionado';
    H.el('bulk-import-btn').disabled = true;
    H.el('bulk-preview-wrap').style.display = 'none';
    H.el('bulk-result-wrap').style.display = 'none';
    const fileEl = H.el('bulk-file'); if (fileEl) fileEl.value = '';

    // Monta tabela de layout
    const thead = H.el('bulk-layout-thead');
    const tbody = H.el('bulk-layout-tbody');
    thead.innerHTML = `<tr>
      <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border)">Coluna</th>
      <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border)">Obrig.?</th>
      <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border)">Exemplo</th>
    </tr>`;
    tbody.innerHTML = cfg.cols.map(c => `<tr>
      <td style="padding:4px 8px;font-family:var(--font-m,monospace);color:var(--accent)">${c.label}</td>
      <td style="padding:4px 8px;color:${c.req ? 'var(--green)' : 'var(--text3)'}; font-weight:${c.req ? '700' : '400'}">${c.req ? 'Sim' : 'Não'}</td>
      <td style="padding:4px 8px;color:var(--text2)">${c.ex}</td>
    </tr>`).join('');

    UI.openModal('modal-bulk-import');
  },

  bulkDownloadTemplate() {
    const cfg = this._bulkConfig[this._bulkEntity];
    if (!cfg) return;
    const header = cfg.cols.map(c => c.label).join(';');
    const example = cfg.cols.map(c => c.ex).join(';');
    const blob = new Blob(['\uFEFF' + header + '\n' + example + '\n'], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `modelo_${this._bulkEntity}.csv`; a.click();
    URL.revokeObjectURL(url);
  },

  bulkOnFileChange(input) {
    const file = input.files?.[0];
    if (!file) return;
    H.el('bulk-filename').textContent = file.name;
    H.el('bulk-result-wrap').style.display = 'none';
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l => l.trim());
        if (lines.length < 2) { UI.toast('Arquivo sem dados (mínimo 1 linha de cabeçalho + 1 de dados)', 'error'); return; }
        const cfg = this._bulkConfig[this._bulkEntity];
        const sep = lines[0].includes(';') ? ';' : ',';
        const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g,''));
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(sep).map(v => v.trim().replace(/^"|"$/g,''));
          const obj = {};
          headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
          // Mapeia apenas colunas conhecidas
          const mapped = {};
          cfg.cols.forEach(c => { mapped[c.key] = obj[c.key] || obj[c.label] || ''; });
          rows.push(mapped);
        }
        this._bulkRows = rows;
        // Preview
        const previewCols = cfg.cols.slice(0, 5); // até 5 colunas no preview
        const thead = H.el('bulk-preview-thead');
        const tbody = H.el('bulk-preview-tbody');
        thead.innerHTML = '<tr>' + previewCols.map(c => `<th style="padding:4px 8px;text-align:left;white-space:nowrap">${c.label}</th>`).join('') + (cfg.cols.length > 5 ? '<th style="padding:4px 8px;color:var(--text3)">…</th>' : '') + '</tr>';
        tbody.innerHTML = rows.slice(0, 10).map(r =>
          '<tr>' + previewCols.map(c => `<td style="padding:3px 8px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${H.esc(r[c.key] || '')}</td>`).join('') + (cfg.cols.length > 5 ? '<td></td>' : '') + '</tr>'
        ).join('');
        H.el('bulk-preview-count').textContent = `— ${rows.length} registro(s)` + (rows.length > 10 ? ' (mostrando 10)' : '');
        H.el('bulk-preview-wrap').style.display = '';
        H.el('bulk-import-btn').disabled = false;
      } catch(err) {
        UI.toast('Erro ao ler arquivo: ' + err.message, 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
  },

  async bulkImport() {
    if (!this._bulkRows.length) return;
    const cfg = this._bulkConfig[this._bulkEntity];
    const btn = H.el('bulk-import-btn');
    btn.disabled = true; btn.textContent = '⏳ Importando…';
    H.el('bulk-result-wrap').style.display = 'none';
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + State.token },
        body: JSON.stringify(this._bulkRows),
      });
      const data = await res.json();
      const wrap = H.el('bulk-result-wrap');
      const sumEl = H.el('bulk-result-summary');
      const errEl = H.el('bulk-result-errors');
      wrap.style.display = '';
      if (data.erros === 0) {
        wrap.style.background = 'rgba(34,197,94,.1)';
        sumEl.style.color = 'var(--green)';
        sumEl.textContent = `✅ ${data.importados} de ${data.total} registro(s) importados com sucesso!`;
        errEl.innerHTML = '';
      } else {
        wrap.style.background = data.importados > 0 ? 'rgba(245,158,11,.1)' : 'rgba(239,68,68,.1)';
        sumEl.style.color = data.importados > 0 ? 'var(--orange,#f59e0b)' : 'var(--red,#ef4444)';
        sumEl.textContent = `⚠️ ${data.importados} importados · ${data.erros} com erro`;
        errEl.innerHTML = data.resultados.filter(r => r.status === 'erro').map(r =>
          `<div style="padding:3px 0;color:var(--text2)">Linha ${r.linha}: <b>${H.esc(r.razao_social || r.codigo || '')}</b> — ${H.esc(r.motivo)}</div>`
        ).join('');
      }
      if (data.importados > 0) {
        UI.toast(`${data.importados} registro(s) importado(s)!`, 'success');
        // Recarrega lista correspondente
        if (this._bulkEntity === 'empresas')     await Pages._cadEmpresas();
        if (this._bulkEntity === 'obras')        await Pages._cadObras();
        if (this._bulkEntity === 'fornecedores') await Pages._cadFornecedores();
        this._bulkRows = [];
        H.el('bulk-import-btn').disabled = true;
      }
    } catch(e) {
      UI.toast('Erro na importação: ' + e.message, 'error');
    } finally {
      btn.textContent = '⬆ Importar';
      if (!this._bulkRows.length) btn.disabled = true;
    }
  },
};

// ══════════════════════════════════════
// ALÇADAS
// ══════════════════════════════════════
