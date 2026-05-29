const Cadastros = {
  newEmpresa() {
    State.editingId=null;
    ['emp-razao','emp-fantasia','emp-cnpj','emp-uau'].forEach(id=>{const e=H.el(id);if(e)e.value='';});
    H.el('emp-ativo').value='1';
    H.el('emp-title').textContent='🏢 NOVA EMPRESA';
    UI.openModal('modal-empresa');
  },
  async editEmpresa(id) {
    State.editingId=id;
    const e = State.cache.empresas.find(x=>x.id===id) || (await API.empresas()).find(x=>x.id===id);
    H.el('emp-razao').value    = e.razao_social||'';
    H.el('emp-fantasia').value = e.nome_fantasia||'';
    H.el('emp-cnpj').value     = e.cnpj||'';
    H.el('emp-ativo').value    = e.ativo?'1':'0';
    const uauEl = H.el('emp-uau'); if(uauEl) uauEl.value = e.uau_empresa||'';
    H.el('emp-title').textContent='✏ EDITAR EMPRESA';
    UI.openModal('modal-empresa');
  },
  async saveEmpresa() {
    const razao_social=H.el('emp-razao').value.trim();
    const cnpj=H.el('emp-cnpj').value.trim();
    if(!razao_social||!cnpj){UI.toast('Razão Social e CNPJ são obrigatórios','error');return;}
    const uauVal = H.el('emp-uau')?.value?.trim();
    // Integração UAU ativa → código da empresa é obrigatório
    if (State.uauAtivo && !uauVal) {
      UI.toast('Integração UAU está ativa — preencha o Código da Empresa UAU antes de salvar.', 'error');
      H.el('emp-uau')?.focus();
      return;
    }
    const data = {
      razao_social,
      nome_fantasia: H.el('emp-fantasia').value.trim(),
      cnpj,
      ativo:         parseInt(H.el('emp-ativo').value)===1,
      uau_empresa:   uauVal ? parseInt(uauVal) : null,
    };
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
    ['obra-codigo','obra-nome','obra-local','obra-gestor','obra-uau-obra','obra-uau-obra-fiscal'].forEach(id=>H.el(id).value='');
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
    // UAU ERP
    const uauObra = H.el('obra-uau-obra'); if(uauObra) uauObra.value = o.uau_obra||'';
    const uauFisc = H.el('obra-uau-obra-fiscal'); if(uauFisc) uauFisc.value = o.uau_obra_fiscal||'';
    H.el('obra-title').textContent='✏ EDITAR OBRA'; UI.openModal('modal-obra');
  },
  async saveObra() {
    const empresa_id=parseInt(H.el('obra-empresa').value); const codigo=H.el('obra-codigo').value.trim();
    const nome=H.el('obra-nome').value.trim();
    if(!empresa_id||!codigo||!nome){UI.toast('Empresa, código e nome são obrigatórios','error');return;}
    const uauObra      = H.el('obra-uau-obra')?.value.trim()        || null;
    const uauObraFisc  = H.el('obra-uau-obra-fiscal')?.value.trim() || null;
    // Integração UAU ativa → ambos os códigos de obra são obrigatórios
    if (State.uauAtivo) {
      if (!uauObra) {
        UI.toast('Integração UAU está ativa — preencha o Código da Obra UAU antes de salvar.', 'error');
        H.el('obra-uau-obra')?.focus();
        return;
      }
      if (!uauObraFisc) {
        UI.toast('Integração UAU está ativa — preencha o Código da Obra Fiscal UAU antes de salvar.', 'error');
        H.el('obra-uau-obra-fiscal')?.focus();
        return;
      }
    }
    const metodologia = document.querySelector('input[name="obra-metodologia"]:checked')?.value || 'gantt';
    const data={empresa_id,codigo,nome,localizacao:H.el('obra-local').value.trim(),gestor:H.el('obra-gestor').value.trim(),status:H.el('obra-status').value,metodologia,
      uau_obra:        uauObra,
      uau_obra_fiscal: uauObraFisc,
    };
    try {
      if(State.editingId) await API.updateObra(State.editingId, data);
      else await API.createObra(data);
      UI.closeModal('modal-obra'); UI.toast('Obra salva','success'); await Pages._cadObras();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },
  async deleteObra(id){if(!confirm('Excluir obra?'))return;try{await API.deleteObra(id);UI.toast('Obra excluída');await Pages._cadObras();}catch(e){UI.toast('Erro: '+e.message,'error');}},

  async newFornecedor() {
    State.editingId=null;
    ['forn-razao','forn-fantasia','forn-cnpj','forn-tel','forn-email','forn-emailnf',
     'forn-endereco','forn-cep','forn-inscr-mun','forn-inscr-est','forn-cnae',
     'forn-representante','forn-cargo','forn-cpf-rep','forn-uau'].forEach(id=>{ const el=H.el(id); if(el) el.value=''; });
    const simplesEl=H.el('forn-simples'); if(simplesEl) simplesEl.checked=false;
    H.el('forn-ativo').value='1';
    H.el('forn-title').textContent='🤝 NOVO FORNECEDOR';
    // Limpa painel IA e UAU
    const s=H.el('forn-ia-status'); if(s){s.style.display='none'; s.innerHTML='';}
    const fFile=H.el('forn-ia-file'); if(fFile) fFile.value='';
    const uauS=H.el('forn-uau-status'); if(uauS) uauS.innerHTML='';
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
    H.el('forn-endereco').value=f.endereco||'';
    const cepEl=H.el('forn-cep'); if(cepEl) cepEl.value=f.cep||'';
    const inscrMunEl=H.el('forn-inscr-mun'); if(inscrMunEl) inscrMunEl.value=f.inscricao_municipal||'';
    const inscrEstEl=H.el('forn-inscr-est'); if(inscrEstEl) inscrEstEl.value=f.inscricao_estadual||'';
    const cnaeEl=H.el('forn-cnae'); if(cnaeEl) cnaeEl.value=f.cnae||'';
    const simplesEl=H.el('forn-simples'); if(simplesEl) simplesEl.checked=!!f.optante_simples;
    H.el('forn-representante').value=f.representante||'';
    H.el('forn-cargo').value=f.cargo_representante||'';
    H.el('forn-ativo').value=f.ativo?'1':'0';
    const cpfRepEl=H.el('forn-cpf-rep'); if(cpfRepEl) cpfRepEl.value=f.cpf_representante||'';
    const uauEl=H.el('forn-uau'); if(uauEl) uauEl.value=f.uau_codigo_fornecedor!=null?f.uau_codigo_fornecedor:'';
    H.el('forn-title').textContent='✏ EDITAR FORNECEDOR';
    const s=H.el('forn-ia-status'); if(s){s.style.display='none'; s.innerHTML='';}
    const uauS=H.el('forn-uau-status'); if(uauS) uauS.innerHTML='';
    UI.openModal('modal-fornecedor');
  },
  async saveFornecedor() {
    console.log('[saveFornecedor] iniciando');
    const razao_social=H.el('forn-razao').value.trim();
    const cnpj=H.el('forn-cnpj').value.trim();
    console.log('[saveFornecedor] razao_social=', razao_social, 'cnpj=', cnpj);
    if(!razao_social||!cnpj){UI.toast('Razão Social e CNPJ são obrigatórios','error');return;}
    const emailVal   = H.el('forn-email')?.value.trim();
    const uauFornVal = H.el('forn-uau')?.value.trim();
    console.log('[saveFornecedor] email=', emailVal, 'uauAtivo=', State.uauAtivo, 'uauCod=', uauFornVal);
    // E-mail é obrigatório para as notificações de aprovação funcionarem
    if (!emailVal) {
      UI.toast('E-mail é obrigatório — necessário para envio de notificações de aprovação.', 'error');
      H.el('forn-email')?.focus();
      return;
    }
    // Integração UAU ativa → código do fornecedor é obrigatório para ManterMedicao
    if (State.uauAtivo && !uauFornVal) {
      UI.toast('Integração UAU está ativa — preencha o Código do Fornecedor UAU antes de salvar.', 'error');
      H.el('forn-uau')?.focus();
      return;
    }
    const data={
      razao_social,
      nome_fantasia:       H.el('forn-fantasia').value.trim(),
      cnpj,
      tel:                 H.el('forn-tel').value.trim(),
      email:               H.el('forn-email').value.trim(),
      email_nf:               H.el('forn-emailnf').value.trim(),
      endereco:               H.el('forn-endereco').value.trim(),
      cep:                    H.el('forn-cep')?.value.trim()       || '',
      inscricao_municipal:    H.el('forn-inscr-mun')?.value.trim() || '',
      inscricao_estadual:     H.el('forn-inscr-est')?.value.trim() || '',
      cnae:                   H.el('forn-cnae')?.value.trim()      || '',
      optante_simples:        H.el('forn-simples')?.checked        || false,
      representante:          H.el('forn-representante').value.trim(),
      cargo_representante:    H.el('forn-cargo').value.trim(),
      cpf_representante:      H.el('forn-cpf-rep')?.value.trim()   || '',
      ativo:                  parseInt(H.el('forn-ativo').value)===1,
      uau_codigo_fornecedor:  H.el('forn-uau')?.value ? parseInt(H.el('forn-uau').value)||null : null,
    };
    try {
      console.log('[saveFornecedor] chamando API, editingId=', State.editingId, 'data=', data);
      if(State.editingId) await API.updateFornecedor(State.editingId, data);
      else await API.createFornecedor(data);
      console.log('[saveFornecedor] sucesso');
      UI.closeModal('modal-fornecedor'); UI.toast('Fornecedor salvo','success'); await Pages._cadFornecedores();
    } catch(e) { console.error('[saveFornecedor] erro:', e); UI.toast('Erro: ' + e.message, 'error'); }
  },
  async deleteFornecedor(id){if(!confirm('Excluir fornecedor?'))return;try{await API.deleteFornecedor(id);UI.toast('Fornecedor excluído');await Pages._cadFornecedores();}catch(e){UI.toast('Erro: '+e.message,'error');}},

  // ── UAU: Busca dados do fornecedor pelo CNPJ ───────────────────
  async _buscarFornecedorUAU() {
    const cnpjRaw = H.el('forn-cnpj')?.value || '';
    const cnpj    = cnpjRaw.replace(/\D/g, '');
    const statusEl = H.el('forn-uau-status');
    const btn      = H.el('btn-buscar-pessoa-uau');

    if (cnpj.length < 11) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">Digite o CNPJ antes de buscar.</span>';
      H.el('forn-cnpj')?.focus();
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando…'; }
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text3)">Consultando ERP UAU…</span>';

    try {
      const token = localStorage.getItem('construtivo_token') || '';
      const r = await fetch(`/api/uau/pessoa?cnpj=${cnpj}`, {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      const d = await r.json();

      if (!d.ok) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">✗ ${H.esc(d.error || 'Não encontrado no UAU.')}</span>`;
        return;
      }

      const p = d.pessoa;
      const filled = [];
      const fill = (id, val, label) => {
        const el = H.el(id);
        if (el && val != null && val !== '') { el.value = val; filled.push(label); }
      };

      fill('forn-razao',       p.razaoSocial,        'Razão Social');
      fill('forn-fantasia',    p.nomeFantasia,        'Nome Fantasia');
      fill('forn-tel',         p.telefone,            'Telefone');
      fill('forn-endereco',    p.endereco,            'Endereço');
      fill('forn-email',       p.email,               'E-mail');
      fill('forn-uau',         p.codigoPessoa,        'Cód. UAU');
      fill('forn-inscr-mun',   p.inscricaoMunicipal,  'Insc. Municipal');
      fill('forn-inscr-est',   p.inscricaoEstadual,   'Insc. Estadual');
      fill('forn-cnae',        p.cnae,                'CNAE');
      if (p.optanteSimples != null) {
        const el = H.el('forn-simples');
        if (el) { el.checked = !!p.optanteSimples; if (p.optanteSimples !== null) filled.push('Simples'); }
      }
      if (p.representante) fill('forn-representante', p.representante, 'Representante');

      if (statusEl) {
        if (filled.length) {
          statusEl.innerHTML = `<span style="color:var(--green)">✓ Preenchido: ${filled.join(', ')}.</span>`
            + (p.representante ? '' : ' <span style="color:var(--text3)">Verifique Representante, Cargo e CPF manualmente.</span>');
        } else {
          statusEl.innerHTML = '<span style="color:var(--text3)">UAU encontrou o fornecedor mas sem dados adicionais.</span>';
        }
      }
      if (filled.length) UI.toast(`🔗 UAU → ${filled.length} campo(s) preenchido(s)`, 'success');

    } catch (err) {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">Erro: ${H.esc(err.message)}</span>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Buscar no UAU'; }
    }
  },

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
      fill('forn-endereco',     d.endereco);
      fill('forn-cep',          d.cep);
      fill('forn-representante',d.representante);
      fill('forn-cargo',        d.cargo_representante);

      // Monta resumo visual do que foi encontrado
      const encontrados = Object.entries({
        'Razão Social': d.razao_social, 'Nome Fantasia': d.nome_fantasia,
        'CNPJ': d.cnpj, 'Telefone': d.tel, 'E-mail': d.email,
        'E-mail NF': d.email_nf, 'Endereço': d.endereco, 'CEP': d.cep,
        'Representante': d.representante,
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
    ['cont-numero','cont-objeto','cont-inicio','cont-termino','cont-obs','cont-uau-empresa','cont-uau-contrato','cont-uau-produto-pl','cont-uau-contrato-pl'].forEach(id=>{const e=H.el(id);if(e)e.value='';});
    H.el('cont-status').value='Vigente';
    H.el('cont-itens').innerHTML='';
    H.el('cont-valor-total-display').textContent='R$ 0,00';
    if(H.el('cont-valor')) H.el('cont-valor').value='';
    // Resetar chip empresa UAU e sugestões
    this._updateEmpresaUAUChip();
    if(H.el('cont-uau-fetch-status')) H.el('cont-uau-fetch-status').textContent='';
    if(H.el('cont-uau-sugestoes'))   H.el('cont-uau-sugestoes').innerHTML='';
    // Resetar seção de IA
    const iaStatus  = H.el('cont-ia-status');
    const iaPreview = H.el('cont-ia-preview');
    const iaFile    = H.el('cont-ia-file');
    if(iaStatus)  { iaStatus.style.display='none';  iaStatus.innerHTML=''; }
    if(iaPreview) { iaPreview.style.display='none'; iaPreview.innerHTML=''; }
    if(iaFile)    { iaFile.value=''; }
    // Resetar seção de atividades do cronograma
    this._clearAtividades();
    // Limpa vínculos UAU
    this._uauVinculos = [];
    this._uauVinculosRender();
    H.el('cont-uau-vinculos-form').style.display = 'none';
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
    // UAU ERP — chip auto da empresa + campos de contrato e planejamento
    this._updateEmpresaUAUChip();
    const uauCon = H.el('cont-uau-contrato'); if(uauCon) uauCon.value = c.uau_contrato||'';
    const uauPrd = H.el('cont-uau-produto-pl'); if(uauPrd) uauPrd.value = c.uau_produto_pl||'';
    const uauCpl = H.el('cont-uau-contrato-pl'); if(uauCpl) uauCpl.value = c.uau_contrato_pl||'';
    if(H.el('cont-uau-fetch-status')) H.el('cont-uau-fetch-status').textContent='';
    if(H.el('cont-uau-sugestoes'))   H.el('cont-uau-sugestoes').innerHTML='';
    H.el('cont-uau-vinculos-form').style.display = 'none';
    await this._uauVinculosCarregar(id);
    // Renderiza itens existentes
    H.el('cont-itens').innerHTML = itens.map((it,i) => this._contratoItemRowHTML(it,i)).join('');
    this._recalcContratoTotal();
    // Carrega atividades disponíveis do cronograma (e marca as já vinculadas)
    await this._loadAtividadesDisponiveis(id);
    H.el('cont-title').textContent='✏ EDITAR CONTRATO'; UI.openModal('modal-contrato');
  },

  // ── Atualiza chip "Empresa UAU" e habilita/desabilita botão de busca ──
  _updateEmpresaUAUChip() {
    const empId   = parseInt(H.el('cont-empresa')?.value);
    const valEl   = H.el('cont-uau-empresa-val');
    const badgeEl = H.el('cont-uau-empresa-badge');
    const hiddenEl= H.el('cont-uau-empresa');
    if (!valEl) return;
    const emp = (State.cache.empresas || []).find(e => e.id === empId);
    const uauEmpresa = emp?.uau_empresa ?? null;
    if (uauEmpresa) {
      // Empresa tem código UAU — chip verde
      valEl.textContent = uauEmpresa;
      valEl.style.color = ''; valEl.style.fontStyle = '';
      if (badgeEl) badgeEl.style.display = 'inline';
      if (hiddenEl) hiddenEl.value = uauEmpresa;
    } else if (empId) {
      // Empresa selecionada mas sem código UAU cadastrado
      valEl.textContent = 'sem código UAU';
      valEl.style.color = 'var(--red)'; valEl.style.fontStyle = 'italic';
      if (badgeEl) badgeEl.style.display = 'none';
      if (hiddenEl) hiddenEl.value = '';
    } else {
      // Nenhuma empresa selecionada
      valEl.textContent = '—';
      valEl.style.color = 'var(--text3)'; valEl.style.fontStyle = 'italic';
      if (badgeEl) badgeEl.style.display = 'none';
      if (hiddenEl) hiddenEl.value = '';
    }
    // Atualiza estado do botão (depende das 3 seleções)
    this._updateBtnBuscar();
  },

  // ── Habilita botão somente quando empresa(UAU) + obra + fornecedor estão selecionados ──
  _updateBtnBuscar() {
    const btn = H.el('btn-buscar-contrato-uau');
    if (!btn) return;
    const uauEmpresa = H.el('cont-uau-empresa')?.value || '';
    const obraId     = H.el('cont-obra')?.value        || '';
    const fornId     = H.el('cont-fornecedor')?.value  || '';
    if (uauEmpresa && obraId && fornId) {
      btn.disabled = false;
      btn.title = 'Clique para buscar e importar dados do ERP UAU (cabeçalho + itens)';
    } else {
      btn.disabled = true;
      const missing = [];
      if (!uauEmpresa) missing.push('Empresa com código UAU');
      if (!obraId)     missing.push('Obra');
      if (!fornId)     missing.push('Fornecedor');
      btn.title = `Selecione primeiro: ${missing.join(', ')}`;
    }
  },

  // ── Wrapper: empresa mudou → carrega obras + atualiza chip UAU ──
  async _onContratoEmpresaChange() {
    await this.loadObrasByEmpresa('cont-empresa', 'cont-obra');
    this._updateEmpresaUAUChip();
    // Limpa sugestões antigas pois empresa mudou
    const sugEl = H.el('cont-uau-sugestoes');
    if (sugEl) sugEl.innerHTML = '';
  },

  // ── Fornecedor mudou → atualiza botão + busca contratos UAU automaticamente ──
  async _onContratoFornecedorChange() {
    this._updateBtnBuscar();
    const sugEl    = H.el('cont-uau-sugestoes');
    const statusEl = H.el('cont-uau-fetch-status');
    if (sugEl)    sugEl.innerHTML = '';
    if (statusEl) statusEl.innerHTML = '';

    const fornEl = H.el('cont-fornecedor');
    const fornId = parseInt(fornEl?.value);
    if (!fornId) return;

    // Precisa de empresa com código UAU
    const uauEmpresa = parseInt(H.el('cont-uau-empresa')?.value) || null;
    if (!uauEmpresa) return;

    // Precisa de obra com código UAU (armazenado no data-uau-obra da option)
    const obraEl   = H.el('cont-obra');
    const obraOpt  = obraEl?.options[obraEl?.selectedIndex];
    const uauObra  = obraOpt?.dataset?.uauObra || '';
    if (!uauObra) return;

    // Precisa de fornecedor com código UAU
    if (!State.cache.fornecedores?.length) {
      try { State.cache.fornecedores = await API.fornecedores(); } catch {}
    }
    const forn = (State.cache.fornecedores || []).find(f => f.id === fornId);
    const uauFornecedor = forn?.uau_codigo_fornecedor ?? null;
    if (!uauFornecedor) return; // Fornecedor sem código UAU — skip silencioso

    // Exibe loading
    if (sugEl) sugEl.innerHTML = '<span style="font-size:11px;color:var(--text3)">🔍 Buscando contratos UAU...</span>';

    try {
      const token = localStorage.getItem('construtivo_token') || '';
      const r = await fetch(`/api/uau/contratos-fornecedor?fornecedor=${uauFornecedor}`, {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      const d = await r.json();

      if (!d.ok) {
        if (sugEl) sugEl.innerHTML = `<span style="font-size:11px;color:var(--red)">Erro UAU: ${H.esc(d.error||'falha')}</span>`;
        return;
      }

      // Filtra por empresa + obra
      const filtrados = (d.contratos || []).filter(c =>
        String(c.empresa) === String(uauEmpresa) &&
        (c.obra||'').toUpperCase() === uauObra.toUpperCase()
      );

      if (sugEl) sugEl.innerHTML = '';

      if (filtrados.length === 0) {
        if (d.contratos?.length > 0) {
          if (sugEl) sugEl.innerHTML = '<span style="font-size:11px;color:var(--text3);font-style:italic">Fornecedor tem contratos UAU, mas nenhum para essa empresa/obra.</span>';
        }
        return;
      }

      if (filtrados.length === 1) {
        const c = filtrados[0];
        H.el('cont-uau-contrato').value = c.codigo;
        if (sugEl) sugEl.innerHTML = `<span style="font-size:11px;color:var(--green)">✓ Contrato UAU #${c.codigo} encontrado automaticamente. Clique em "Buscar e importar" para carregar os dados.</span>`;
      } else {
        // Múltiplos contratos — exibe mini-lista
        if (sugEl) {
          sugEl.innerHTML = `<div style="font-size:11px;color:var(--text2);margin-bottom:4px">${filtrados.length} contratos UAU encontrados para esse fornecedor/obra. Selecione:</div>`
            + filtrados.map(c => `
              <button class="btn btn-o btn-xs" onclick="Cadastros._selecionarSugestaoUAU(${c.codigo})"
                style="display:block;width:100%;text-align:left;margin-bottom:3px;padding:5px 8px;font-size:11px">
                <strong>#${c.codigo}</strong>
                ${c.objeto ? ` — ${H.esc(c.objeto.slice(0,60))}${c.objeto.length>60?'…':''}` : ''}
                ${c.situacaoLabel ? `<span style="color:var(--text3)"> (${H.esc(c.situacaoLabel)})</span>` : ''}
                ${c.dataInicio ? `<span style="color:var(--text3)"> · ${c.dataInicio}</span>` : ''}
              </button>`).join('');
        }
      }
    } catch (err) {
      if (sugEl) sugEl.innerHTML = `<span style="font-size:11px;color:var(--red)">Erro ao buscar: ${H.esc(err.message)}</span>`;
    }
  },

  // ── Seleciona um contrato UAU da mini-lista de sugestões ─────────
  _selecionarSugestaoUAU(codigo) {
    H.el('cont-uau-contrato').value = codigo;
    const sugEl = H.el('cont-uau-sugestoes');
    if (sugEl) sugEl.innerHTML = `<span style="font-size:11px;color:var(--green)">✓ Contrato #${codigo} selecionado. Clique em "Buscar e importar" para carregar os dados.</span>`;
  },

  async loadObrasByEmpresa(empElId, obraElId, selectedId) {
    const empId=parseInt(H.el(empElId)?.value);
    const obras = await API.obras(empId);
    // data-uau-obra é usado por _onContratoFornecedorChange para filtrar contratos UAU
    H.el(obraElId).innerHTML='<option value="">Selecione a obra...</option>'+obras.map(o=>`<option value="${o.id}" data-uau-obra="${o.uau_obra||''}" ${o.id===selectedId?'selected':''}>${o.nome}</option>`).join('');
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
      <input class="fi citem-uau-item" type="number" min="1" step="1" style="width:72px;text-align:right;color:var(--text3)" placeholder="—" title="Item UAU" value="${it?.uau_item||''}">
      <input class="fi citem-uau-acomp" type="text" style="width:88px;text-align:right;color:var(--text3);font-family:var(--font-m)" placeholder="—" title="Acomp. UAU" value="${it?.uau_codigo_acompanhamento||''}">
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
      uau_item:                  parseInt(row.querySelector('.citem-uau-item')?.value)  || null,
      uau_codigo_acompanhamento: row.querySelector('.citem-uau-acomp')?.value?.trim()   || null,
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

  // ── Importar itens do UAU → preenche UAU Item + UAU Acomp. automaticamente ──
  async _importarItensUAU() {
    const empresa  = parseInt(H.el('cont-uau-empresa')?.value);
    const contrato = parseInt(H.el('cont-uau-contrato')?.value);

    if (!empresa || !contrato) {
      UI.toast('Preencha os campos "Empresa UAU" e "Contrato UAU" antes de importar.', 'error');
      return;
    }

    const btn = H.el('btn-importar-uau-itens');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando…'; }

    try {
      const token = localStorage.getItem('construtivo_token') || '';
      const r = await fetch(`/api/uau/itens-contrato?empresa=${empresa}&contrato=${contrato}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await r.json();

      if (!data.ok) {
        UI.toast('Erro UAU: ' + (data.error || 'Falha ao buscar itens'), 'error');
        return;
      }

      const uauItens = data.itens;
      if (!uauItens.length) {
        UI.toast('Nenhum item encontrado no contrato UAU ' + contrato, 'error');
        return;
      }

      // Ordena por item e importa (planilha já foi limpa antes de chamar)
      uauItens.sort((a, b) => (a.item ?? 0) - (b.item ?? 0));

      // Importa todos os itens do UAU como novas linhas
      const unidadesValidas = new Set(this._UNIDADES_CONT);
      const fmtSaldo = v => parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      let semSaldo = 0;

      uauItens.forEach((uau, idx) => {
        // Normaliza unidade: usa o valor do UAU se for compatível, senão cai em 'un'
        const unidadeUAU = (uau.unidade || '').toLowerCase().trim();
        const unidade = unidadesValidas.has(unidadeUAU) ? unidadeUAU : 'un';

        const it = {
          descricao:               uau.descricao   || `Item ${uau.item}`,
          unidade:                 unidade,
          qtd_total:               uau.qtd          != null ? parseFloat(uau.qtd)   : 0,
          valor_unitario:          uau.preco         != null ? parseFloat(uau.preco) : 0,
          valor_total:             0,
          uau_item:                uau.item,
          uau_codigo_acompanhamento: uau.codigoAcompanhamento != null ? String(uau.codigoAcompanhamento) : '',
        };
        it.valor_total = it.qtd_total * it.valor_unitario;

        const container = H.el('cont-itens');
        container.insertAdjacentHTML('beforeend', this._contratoItemRowHTML(it, idx));

        // Aplica saldo como tooltip/cor no campo UAU Item
        if (uau.saldo != null) {
          const rowEl  = container.querySelectorAll('.citem-row')[idx];
          const itemEl = rowEl?.querySelector('.citem-uau-item');
          if (itemEl) {
            itemEl.title = `Saldo UAU: ${fmtSaldo(uau.saldo)}`;
            itemEl.style.borderColor = parseFloat(uau.saldo) <= 0 ? 'var(--red)' : 'var(--green)';
          }
        } else { semSaldo++; }
      });

      Cadastros._recalcContratoTotal();

      const fmtMoeda = v => parseFloat(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
      const total = uauItens.reduce((s,u) => s + (parseFloat(u.preco||0) * parseFloat(u.qtd||0)), 0);
      let msg = `✅ ${uauItens.length} item(s) importado(s) do UAU — Total: ${fmtMoeda(total)}`;
      if (semSaldo > 0) msg += ` (${semSaldo} sem saldo UAU disponível)`;
      msg += '. Revise e salve o contrato.';
      UI.toast(msg, 'success');

    } catch (e) {
      UI.toast('Erro ao conectar ao UAU: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔗 Importar UAU'; }
    }
  },

  // ── Buscar e importar tudo do UAU (cabeçalho + itens) em paralelo ──
  async _buscarEImportarUAU() {
    const empresa  = parseInt(H.el('cont-uau-empresa')?.value);
    const contrato = parseInt(H.el('cont-uau-contrato')?.value);

    if (!empresa) {
      UI.toast('Selecione uma Empresa com código UAU cadastrado antes de buscar.', 'error');
      H.el('cont-empresa')?.focus();
      return;
    }
    if (!contrato) {
      UI.toast('Preencha o campo "N° Contrato UAU" antes de buscar.', 'error');
      H.el('cont-uau-contrato')?.focus();
      return;
    }

    const btn      = H.el('btn-buscar-contrato-uau');
    const statusEl = H.el('cont-uau-fetch-status');
    if (btn)      { btn.disabled = true; btn.textContent = '⏳ Buscando…'; }
    if (statusEl) statusEl.textContent = '';

    // ── Limpa todos os campos antes de reimportar ────────────────
    ['cont-numero','cont-objeto','cont-inicio','cont-termino','cont-obs'].forEach(id => {
      const el = H.el(id); if (el) el.value = '';
    });
    H.el('cont-status').value = 'Vigente';
    H.el('cont-itens').innerHTML = '';
    H.el('cont-valor-total-display').textContent = 'R$ 0,00';
    if (H.el('cont-valor')) H.el('cont-valor').value = '';
    if (H.el('cont-uau-sugestoes')) H.el('cont-uau-sugestoes').innerHTML = '';

    try {
      const token = localStorage.getItem('construtivo_token') || '';
      const headers = { 'Authorization': 'Bearer ' + token };

      // Busca cabeçalho e itens em paralelo
      const [rHead, rItens] = await Promise.all([
        fetch(`/api/uau/contrato?empresa=${empresa}&contrato=${contrato}`, { headers }),
        fetch(`/api/uau/itens-contrato?empresa=${empresa}&contrato=${contrato}`, { headers }),
      ]);
      const [dHead, dItens] = await Promise.all([ rHead.json(), rItens.json() ]);

      const msgs = [];

      // ── 1. Preenche cabeçalho ───────────────────────────────────
      if (!dHead.ok) {
        UI.toast('Erro UAU (cabeçalho): ' + (dHead.error || 'Falha ao buscar contrato'), 'error');
        return;
      }
      const c = dHead.contrato;

      if (c.objeto)     { H.el('cont-objeto').value  = c.objeto;     msgs.push('Objeto'); }
      if (c.dataInicio) { H.el('cont-inicio').value  = c.dataInicio; msgs.push('Início'); }
      if (c.dataFim)    { H.el('cont-termino').value = c.dataFim;    msgs.push('Término'); }
      if (c.observacao && !H.el('cont-obs').value.trim()) {
        H.el('cont-obs').value = c.observacao;
        msgs.push('Observação');
      }

      // Fornecedor: match por código UAU
      let fornMsg = '';
      if (c.codigoFornecedor != null) {
        if (!State.cache.fornecedores || !State.cache.fornecedores.length) {
          try { State.cache.fornecedores = await API.fornecedores(); } catch {}
        }
        const fornMatch = (State.cache.fornecedores || []).find(f =>
          f.uau_codigo_fornecedor != null &&
          String(f.uau_codigo_fornecedor) === String(c.codigoFornecedor)
        );
        if (fornMatch) {
          const sel = H.el('cont-fornecedor');
          if (sel) sel.value = String(fornMatch.id);
          fornMsg = `✅ Fornecedor: ${H.esc(fornMatch.nome_fantasia || fornMatch.razao_social)}`;
          msgs.push('Fornecedor');
        } else {
          fornMsg = `⚠ Fornecedor UAU "${c.nomeFornecedor || c.codigoFornecedor}" não encontrado no cadastro local`;
        }
      }

      // ── 2. Preenche itens da planilha ───────────────────────────
      let itensMsg = '';
      if (!dItens.ok) {
        itensMsg = `⚠ Itens não importados: ${dItens.error || 'falha ao buscar itens'}`;
      } else {
        const uauItens = (dItens.itens || []).sort((a,b) => (a.item??0)-(b.item??0));
        if (uauItens.length === 0) {
          itensMsg = '⚠ Nenhum item encontrado no contrato UAU';
        } else {
          H.el('cont-itens').innerHTML = '';
          const unidadesValidas = new Set(this._UNIDADES_CONT);
          uauItens.forEach((uau, idx) => {
            const unidadeUAU = (uau.unidade || '').toLowerCase().trim();
            const it = {
              descricao:               uau.descricao || `Item ${uau.item}`,
              unidade:                 unidadesValidas.has(unidadeUAU) ? unidadeUAU : 'un',
              qtd_total:               uau.qtd   != null ? parseFloat(uau.qtd)   : 0,
              valor_unitario:          uau.preco != null ? parseFloat(uau.preco) : 0,
              valor_total:             0,
              uau_item:                uau.item,
              uau_codigo_acompanhamento: uau.codigoAcompanhamento != null ? String(uau.codigoAcompanhamento) : '',
            };
            it.valor_total = it.qtd_total * it.valor_unitario;
            const container = H.el('cont-itens');
            container.insertAdjacentHTML('beforeend', this._contratoItemRowHTML(it, idx));
            if (uau.saldo != null) {
              const rowEl  = container.querySelectorAll('.citem-row')[idx];
              const itemEl = rowEl?.querySelector('.citem-uau-item');
              if (itemEl) {
                const fmt = v => parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
                itemEl.title = `Saldo UAU: ${fmt(uau.saldo)}`;
                itemEl.style.borderColor = parseFloat(uau.saldo) <= 0 ? 'var(--red)' : 'var(--green)';
              }
            }
          });
          this._recalcContratoTotal();
          const total = uauItens.reduce((s,u) => s + (parseFloat(u.preco||0) * parseFloat(u.qtd||0)), 0);
          const fmtM  = v => parseFloat(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
          itensMsg = `📋 ${uauItens.length} item(s) importado(s) — Total: ${fmtM(total)}`;
          msgs.push(`${uauItens.length} itens`);
        }
      }

      // ── 3. Feedback ─────────────────────────────────────────────
      if (msgs.length > 0) {
        UI.toast(`🔗 UAU → preenchido: ${msgs.join(', ')}.`, 'success');
      }
      const statusParts = [];
      if (msgs.length > 0) statusParts.push(`<span style="color:var(--green)">✓ ${msgs.join(', ')} preenchido(s)</span>`);
      if (fornMsg)  statusParts.push(fornMsg);
      if (itensMsg) statusParts.push(itensMsg);
      if (statusEl) statusEl.innerHTML = statusParts.join('<br>');

    } catch (e) {
      UI.toast('Erro ao conectar ao UAU: ' + e.message, 'error');
      if (statusEl) statusEl.textContent = '✗ Erro de conexão';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔗 Buscar e importar tudo'; }
    }
  },

  // ── Buscar dados do contrato no UAU → auto-popular campos do modal ──
  async _buscarContratoUAU() {
    const empresa  = parseInt(H.el('cont-uau-empresa')?.value);
    const contrato = parseInt(H.el('cont-uau-contrato')?.value);

    if (!empresa || !contrato) {
      UI.toast('Preencha "Empresa UAU" e "Contrato UAU" antes de buscar.', 'error');
      return;
    }

    const btn        = H.el('btn-buscar-contrato-uau');
    const statusEl   = H.el('cont-uau-fetch-status');
    if (btn)      { btn.disabled = true; btn.textContent = '⏳ Buscando…'; }
    if (statusEl) statusEl.textContent = '';

    try {
      const token = localStorage.getItem('construtivo_token') || '';
      const r = await fetch(`/api/uau/contrato?empresa=${empresa}&contrato=${contrato}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const data = await r.json();

      if (!data.ok) {
        UI.toast('Erro UAU: ' + (data.error || 'Falha ao buscar contrato'), 'error');
        if (statusEl) statusEl.textContent = '✗ ' + (data.error || 'Falha');
        return;
      }

      const c    = data.contrato;
      const msgs = [];

      // Objeto do contrato
      if (c.objeto) {
        H.el('cont-objeto').value = c.objeto;
        msgs.push('Objeto');
      }

      // Datas
      if (c.dataInicio) {
        H.el('cont-inicio').value = c.dataInicio;
        msgs.push('Início');
      }
      if (c.dataFim) {
        H.el('cont-termino').value = c.dataFim;
        msgs.push('Término');
      }

      // Fornecedor — tenta match pelo Código UAU do fornecedor
      let fornMsg = '';
      if (c.codigoFornecedor != null) {
        // Garante que o cache de fornecedores está populado
        if (!State.cache.fornecedores || !State.cache.fornecedores.length) {
          try { State.cache.fornecedores = await API.fornecedores(); } catch {}
        }
        const fornMatch = (State.cache.fornecedores || []).find(f =>
          f.uau_codigo_fornecedor != null &&
          String(f.uau_codigo_fornecedor) === String(c.codigoFornecedor)
        );
        if (fornMatch) {
          const sel = H.el('cont-fornecedor');
          if (sel) sel.value = String(fornMatch.id);
          fornMsg = `✅ Fornecedor: ${H.esc(fornMatch.nome_fantasia || fornMatch.razao_social)}`;
          msgs.push('Fornecedor');
        } else {
          fornMsg = `⚠ Fornecedor UAU "${c.nomeFornecedor || c.codigoFornecedor}" não encontrado no cadastro local`;
        }
      }

      // Observação — só preenche se o campo estiver vazio
      if (c.observacao && !H.el('cont-obs').value.trim()) {
        H.el('cont-obs').value = c.observacao;
        msgs.push('Observação');
      }

      // Feedback
      const preenchidos = msgs.length;
      if (preenchidos > 0) {
        UI.toast(`🔗 UAU → preenchido: ${msgs.join(', ')}.${fornMsg ? ' ' + fornMsg : ''}`, 'success');
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--green)">✓ ${msgs.join(', ')} preenchido(s)</span>${fornMsg ? '<br>' + fornMsg : ''}`;
      } else {
        UI.toast('UAU retornou o contrato mas sem dados novos para preencher.', 'info');
        if (statusEl) statusEl.textContent = '— Nenhum campo novo para preencher';
      }

    } catch (e) {
      UI.toast('Erro ao conectar ao UAU: ' + e.message, 'error');
      if (statusEl) statusEl.textContent = '✗ Erro de conexão';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔗 Buscar dados do UAU'; }
    }
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
    // Atualiza botão e re-dispara busca UAU se fornecedor já estiver selecionado
    this._updateBtnBuscar();
    if (parseInt(H.el('cont-fornecedor')?.value)) this._onContratoFornecedorChange();
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

    const valor_total     = parseFloat(H.el('cont-valor').value)||0;
    const uauEmpresaVal   = parseInt(H.el('cont-uau-empresa')?.value)     || null;
    const uauContratoVal  = parseInt(H.el('cont-uau-contrato')?.value)    || null;
    const uauProdutoPl    = parseInt(H.el('cont-uau-produto-pl')?.value)  || null;
    const uauContratoPl   = parseInt(H.el('cont-uau-contrato-pl')?.value) || null;
    // Integração UAU ativa → avisa se campos UAU do contrato estiverem vazios (não bloqueia)
    if (State.uauAtivo && (!uauEmpresaVal || !uauContratoVal)) {
      const faltando = [
        !uauEmpresaVal  ? 'Empresa UAU'  : null,
        !uauContratoVal ? 'Contrato UAU' : null,
      ].filter(Boolean).join(' e ');
      UI.toast(`⚠ Atenção: ${faltando} não preenchido(s). A integração UAU falhará ao integrar medições deste contrato.`, 'warning');
    }
    const data={empresa_id,obra_id,fornecedor_id,numero,objeto,valor_total,
      inicio:H.el('cont-inicio').value||null,termino:H.el('cont-termino').value||null,
      status:H.el('cont-status').value,obs:H.el('cont-obs').value,itens,
      uau_empresa:       uauEmpresaVal,
      uau_contrato:      uauContratoVal,
      uau_produto_pl:    uauProdutoPl,
      uau_contrato_pl:   uauContratoPl,
    };
    try {
      let savedId;
      if(State.editingId) { await API.updateContrato(State.editingId, data); savedId=State.editingId; }
      else { const r=await API.createContrato(data); savedId=r.id; }
      // Salva vínculos com atividades do cronograma (se seletor estiver visível)
      const atIds = this._collectAtividadesIds();
      if (H.el('cont-cron-wrap')?.style.display !== 'none') {
        await API.saveContratoAtividades(savedId, atIds).catch(()=>{});
      }
      // Salva vínculos UAU em memória (somente novos, para contrato recém-criado)
      const token = localStorage.getItem('construtivo_token');
      const novosVinculos = this._uauVinculos.filter(v => v._novo);
      for (const v of novosVinculos) {
        await fetch(`/api/contratos/${savedId}/uau-vinculos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ servico_pl: v.servico_pl, codigo_insumo_pl: v.codigo_insumo_pl, codigo_insumo_servico_pl: v.codigo_insumo_servico_pl || null, descricao: v.descricao || null }),
        }).catch(() => {});
      }
      UI.closeModal('modal-contrato'); UI.toast('Contrato salvo com sucesso','success'); await Pages._cadContratos();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },
  async deleteContrato(id){if(!confirm('Excluir contrato?'))return;try{await API.deleteContrato(id);UI.toast('Contrato excluído');await Pages._cadContratos();}catch(e){UI.toast('Erro: '+e.message,'error');}},

  // ── Vínculos UAU ao Planejamento (SI) ──────────────────────────
  _uauVinculos: [], // cache local dos vínculos do contrato aberto

  _uauVinculosRender() {
    const lista = H.el('cont-uau-vinculos-lista');
    const vazio = H.el('cont-uau-vinculos-vazio');
    if (!lista) return;
    const rows = this._uauVinculos.filter(v => !v._deleted);
    if (rows.length === 0) {
      vazio.style.display = 'block';
      // remove linhas antigas
      lista.querySelectorAll('.uav-row').forEach(el => el.remove());
      return;
    }
    vazio.style.display = 'none';
    lista.querySelectorAll('.uav-row').forEach(el => el.remove());
    rows.forEach(v => {
      const div = document.createElement('div');
      div.className = 'uav-row';
      div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr 2fr auto;gap:8px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px';
      div.innerHTML = `
        <span><span style="color:var(--text3);font-size:10px;display:block">Serviço PL</span><strong>${v.servico_pl}</strong></span>
        <span><span style="color:var(--text3);font-size:10px;display:block">Cód. Insumo Material PL</span><strong>${v.codigo_insumo_pl}</strong></span>
        <span><span style="color:var(--text3);font-size:10px;display:block">Cód. Insumo Serviço PL</span><strong>${v.codigo_insumo_servico_pl || '<em style="color:var(--text3);font-weight:400">—</em>'}</strong></span>
        <span style="color:var(--text2)">${v.descricao || '<em style="color:var(--text3)">—</em>'}</span>
        <button class="btn btn-o btn-xs" style="color:var(--red);border-color:var(--red)" onclick="Cadastros._uauVinculoRemover(${v.id || '"new_'+v._idx+'"'})">✕</button>`;
      lista.appendChild(div);
    });
  },

  async _uauVinculosCarregar(contratoId) {
    this._uauVinculos = [];
    if (!contratoId) { this._uauVinculosRender(); return; }
    try {
      const token = localStorage.getItem('construtivo_token');
      const r = await fetch(`/api/contratos/${contratoId}/uau-vinculos`, { headers: { Authorization: `Bearer ${token}` } });
      this._uauVinculos = r.ok ? await r.json() : [];
    } catch { this._uauVinculos = []; }
    this._uauVinculosRender();
  },

  _uauVinculoNovo() {
    H.el('cont-uau-vinculos-form').style.display = 'block';
    H.el('uav-servico').value = '';
    H.el('uav-insumo').value = '';
    H.el('uav-insumo-servico').value = '';
    H.el('uav-descricao').value = '';
    H.el('uav-servico').focus();
  },

  _uauVinculoCancelar() {
    H.el('cont-uau-vinculos-form').style.display = 'none';
  },

  async _uauVinculoSalvar() {
    const servico       = H.el('uav-servico').value.trim();
    const insumo        = H.el('uav-insumo').value.trim();
    const insumoServico = H.el('uav-insumo-servico').value.trim();
    const desc          = H.el('uav-descricao').value.trim();
    if (!servico || !insumo) { UI.toast('Preencha Serviço PL e Cód. Insumo Material PL', 'error'); return; }

    if (State.editingId) {
      // Contrato já existe — salva diretamente na API
      try {
        const token = localStorage.getItem('construtivo_token');
        const r = await fetch(`/api/contratos/${State.editingId}/uau-vinculos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ servico_pl: servico, codigo_insumo_pl: insumo, codigo_insumo_servico_pl: insumoServico || null, descricao: desc || null }),
        });
        if (!r.ok) throw new Error((await r.json()).error || 'Erro');
        const novo = await r.json();
        this._uauVinculos.push(novo);
        UI.toast('Vínculo adicionado', 'success');
      } catch(e) { UI.toast('Erro: ' + e.message, 'error'); return; }
    } else {
      // Novo contrato — guarda apenas em memória (salva depois do contrato)
      const _idx = Date.now();
      this._uauVinculos.push({ _idx, servico_pl: servico, codigo_insumo_pl: insumo, codigo_insumo_servico_pl: insumoServico || null, descricao: desc, _novo: true });
    }
    H.el('cont-uau-vinculos-form').style.display = 'none';
    this._uauVinculosRender();
  },

  async _uauVinculoRemover(idOrKey) {
    if (!confirm('Remover este vínculo?')) return;
    if (typeof idOrKey === 'number') {
      // Vínculo persistido — deleta na API
      try {
        const token = localStorage.getItem('construtivo_token');
        await fetch(`/api/contratos/${State.editingId}/uau-vinculos/${idOrKey}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        });
        this._uauVinculos = this._uauVinculos.filter(v => v.id !== idOrKey);
        UI.toast('Vínculo removido');
      } catch(e) { UI.toast('Erro: ' + e.message, 'error'); return; }
    } else {
      // Vínculo novo ainda não persistido
      const idx = parseInt(String(idOrKey).replace('new_',''));
      this._uauVinculos = this._uauVinculos.filter(v => v._idx !== idx);
    }
    this._uauVinculosRender();
  },

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
        { key: 'email_nf',            label: 'email_nf',            req: false, ex: 'nf@furasolo.com.br' },
        { key: 'endereco',            label: 'endereco',            req: false, ex: 'Rua das Pedras, 100, Sorriso, MT' },
        { key: 'cep',                 label: 'cep',                 req: false, ex: '78890-000' },
        { key: 'inscricao_municipal', label: 'inscricao_municipal', req: false, ex: '123456' },
        { key: 'inscricao_estadual',  label: 'inscricao_estadual',  req: false, ex: '123.456.789.001' },
        { key: 'cnae',                label: 'cnae',                req: false, ex: '4120400' },
        { key: 'optante_simples',     label: 'optante_simples',     req: false, ex: 'true' },
        { key: 'representante',       label: 'representante',       req: false, ex: 'João da Silva' },
        { key: 'cargo_representante', label: 'cargo_representante', req: false, ex: 'Administrador' },
        { key: 'cpf_representante',   label: 'cpf_representante',   req: false, ex: '000.000.000-00' },
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
  // ── Insumos ──────────────────────────────────────────────────────
  _insumosCache: [],

  newInsumo() {
    State.editingId = null;
    ['ins-codigo', 'ins-nome', 'ins-unidade', 'ins-cap'].forEach(id => { const el = H.el(id); if (el) el.value = ''; });
    H.el('ins-modal-title').textContent = '📦 NOVO INSUMO';
    UI.openModal('modal-insumo');
    H.el('ins-codigo')?.focus();
  },

  async editInsumo(id) {
    State.editingId = id;
    let ins = this._insumosCache.find(x => x.id === id);
    if (!ins) { const list = await API.insumos(); ins = list.find(x => x.id === id); }
    if (!ins) { UI.toast('Insumo não encontrado', 'error'); return; }
    H.el('ins-codigo').value  = ins.codigo  || '';
    H.el('ins-nome').value    = ins.nome     || '';
    H.el('ins-unidade').value = ins.unidade  || '';
    const capEl = H.el('ins-cap'); if (capEl) capEl.value = ins.cap || '';
    H.el('ins-modal-title').textContent = '✏ EDITAR INSUMO';
    UI.openModal('modal-insumo');
  },

  async saveInsumo() {
    const codigo  = H.el('ins-codigo')?.value.trim();
    const nome    = H.el('ins-nome')?.value.trim();
    const unidade = H.el('ins-unidade')?.value.trim() || '';
    const cap     = H.el('ins-cap')?.value.trim()     || null;
    if (!codigo || !nome) { UI.toast('Código e Nome são obrigatórios', 'error'); return; }
    // Portal de pedido de compra UAU ativo → CAP é obrigatório
    if (State.portalPedidoAtivo && !cap) {
      UI.toast('O Portal de Pedido de Compra está ativo — preencha o CAP (Conta de Apropriação) do insumo antes de salvar.', 'error');
      H.el('ins-cap')?.focus();
      return;
    }
    try {
      if (State.editingId) await API.updateInsumo(State.editingId, { codigo, nome, unidade, cap });
      else                 await API.createInsumo({ codigo, nome, unidade, cap });
      UI.closeModal('modal-insumo');
      UI.toast('Insumo salvo com sucesso', 'success');
      await Pages._cadInsumos();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async deleteInsumo(id) {
    if (!confirm('Excluir este insumo?')) return;
    try {
      await API.deleteInsumo(id);
      UI.toast('Insumo excluído');
      await Pages._cadInsumos();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  // ── Importação CSV de Insumos ────────────────────────────────────
  _insumosImportRows: [],

  openImportarInsumos() {
    this._insumosImportRows = [];
    const prev = H.el('ins-import-preview');
    if (prev) prev.innerHTML = '';
    const inp = H.el('ins-import-file');
    if (inp) inp.value = '';
    const btn = H.el('ins-import-btn');
    if (btn) btn.disabled = true;
    UI.openModal('modal-importar-insumos');
  },

  // Tabela CP850 → Unicode para os bytes 0x80–0xFF
  // (IBM PC / MS-DOS; usado pelo Excel "Salvar como CSV MS-DOS")
  _CP850: [
    0x00C7,0x00FC,0x00E9,0x00E2,0x00E4,0x00E0,0x00E5,0x00E7, // 80-87
    0x00EA,0x00EB,0x00E8,0x00EF,0x00EE,0x00EC,0x00C4,0x00C5, // 88-8F
    0x00C9,0x00E6,0x00C6,0x00F4,0x00F6,0x00F2,0x00FB,0x00F9, // 90-97
    0x00FF,0x00D6,0x00DC,0x00F8,0x00A3,0x00D8,0x00D7,0x0192, // 98-9F
    0x00E1,0x00ED,0x00F3,0x00FA,0x00F1,0x00D1,0x00AA,0x00BA, // A0-A7
    0x00BF,0x00AE,0x00AC,0x00BD,0x00BC,0x00A1,0x00AB,0x00BB, // A8-AF
    0x2591,0x2592,0x2593,0x2502,0x2524,0x00C1,0x00C2,0x00C0, // B0-B7
    0x00A9,0x2563,0x2551,0x2557,0x255D,0x00A2,0x00A5,0x2510, // B8-BF
    0x2514,0x2534,0x252C,0x251C,0x2500,0x253C,0x00E3,0x00C3, // C0-C7
    0x255A,0x2554,0x2569,0x2566,0x2560,0x2550,0x256C,0x00A4, // C8-CF
    0x00F0,0x00D0,0x00CA,0x00CB,0x00C8,0x0131,0x00CD,0x00CE, // D0-D7
    0x00CF,0x2518,0x250C,0x2588,0x2584,0x00A6,0x00CC,0x2580, // D8-DF
    0x00D3,0x00DF,0x00D4,0x00D2,0x00F5,0x00D5,0x00B5,0x00FE, // E0-E7
    0x00DE,0x00DA,0x00DB,0x00D9,0x00FD,0x00DD,0x00AF,0x00B4, // E8-EF
    0x00AD,0x00B1,0x2017,0x00BE,0x00B6,0x00A7,0x00F7,0x00B8, // F0-F7
    0x00B0,0x00A8,0x00B7,0x00B9,0x00B3,0x00B2,0x25A0,0x00A0, // F8-FF
  ],

  // Decodifica bytes usando a tabela CP850
  _decodeCp850(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      s += b < 0x80 ? String.fromCharCode(b) : String.fromCharCode(this._CP850[b - 0x80]);
    }
    return s;
  },

  // Detecta CP850 (Excel "CSV MS-DOS") vs Windows-1252 (Excel "CSV Windows").
  // Regra simples e confiável para arquivos de cadastro de materiais PT-BR:
  //   - Bytes 0x80–0x9F em CP850 = letras acentuadas (Ç ü é â ä à ç ê É ô ö û ù Ö Ü…)
  //   - Bytes 0x80–0x9F em Windows-1252 = símbolos tipográficos (€ ‚ ƒ „ … † ‡ ˆ)
  // Um arquivo de materiais NUNCA tem € ‚ ƒ no meio de nomes → qualquer byte 0x80–0x9F = CP850.
  // Além disso, letras acentuadas maiúsculas comuns em PT-BR têm bytes diferentes:
  //   CP850:     Á=0xB5  Â=0xB6  À=0xB7  Ã=0xC7  Ç=0x80
  //   Win-1252:  Á=0xC1  Â=0xC2  À=0xC0  Ã=0xC3  Ç=0xC7
  _isCp850(bytes) {
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      // Presença de qualquer byte 0x80–0x9F: em Win-1252 seriam símbolos tipográficos
      // raríssimos em nomes de materiais → trata como CP850
      if (b >= 0x80 && b <= 0x9F) return true;
      // Bytes exclusivos de letras acentuadas em CP850 (diferentes do Win-1252)
      // 0xB5=Á  0xB6=Â  0xB7=À  0xC7=Ã  0xA0=á  0xA1=í  0xA2=ó  0xA3=ú
      if (b === 0xB5 || b === 0xB6 || b === 0xB7) return true; // Á Â À
      if (b === 0xA0 || b === 0xA1 || b === 0xA2 || b === 0xA3) return true; // á í ó ú
    }
    return false;
  },

  _onInsumosFileChange(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const bytes = new Uint8Array(e.target.result);

      let text;

      // 1. UTF-8 BOM (EF BB BF)
      if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        text = new TextDecoder('utf-8').decode(bytes);

      // 2. UTF-16 LE BOM (FF FE) — Excel às vezes salva assim
      } else if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
        text = new TextDecoder('utf-16le').decode(bytes);

      // 3. Tenta UTF-8 válido (sem BOM)
      } else {
        let utf8Text = null;
        try {
          utf8Text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          utf8Text = null;
        }

        if (utf8Text !== null) {
          // UTF-8 decodificou sem erros → usa diretamente
          text = utf8Text;
        } else {
          // 4. Heurística CP850 vs Windows-1252
          if (this._isCp850(bytes)) {
            text = this._decodeCp850(bytes);
          } else {
            // 5. Fallback: Windows-1252 (Excel PT-BR padrão)
            try {
              text = new TextDecoder('windows-1252').decode(bytes);
            } catch {
              text = new TextDecoder('utf-8').decode(bytes);
            }
          }
        }
      }

      this._parseInsumosCSV(text);
    };
    reader.readAsArrayBuffer(file);
  },

  _parseInsumosCSV(text) {
    // Remove BOM UTF-8 se presente
    text = text.replace(/^﻿/, '');

    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) { UI.toast('Arquivo vazio', 'error'); return; }

    // Detecta separador: ponto-e-vírgula tem prioridade (Excel BR), depois vírgula, depois tab
    const firstLine = lines[0];
    const sep = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';

    // Normaliza string de cabeçalho: minúsculas, sem aspas, sem acentos comuns
    const _norm = s => s.trim()
      .toLowerCase()
      .replace(/["""'']/g, '')
      .replace(/[áàãâä]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòõôö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/[ç]/g, 'c')
      .trim();

    const header = firstLine.split(sep).map(_norm);

    let colCodigo = header.findIndex(h => h.includes('codigo') || h === 'cod' || h === 'code' || h === 'id');
    let colNome   = header.findIndex(h => h.includes('descri') || h.includes('nome') || h === 'name' || h === 'material');
    let colUnid   = header.findIndex(h => h.includes('unid') || h.includes('unit') || h === 'un' || h === 'um');
    let colCap    = header.findIndex(h => h === 'cap' || h.includes('conta') || h.includes('apropri') || h.includes('cap_'));

    // Fallback por posição: se o arquivo tem exatamente 2 ou 3 colunas,
    // assume Código | Descrição | Unid (independente do cabeçalho)
    if ((colCodigo < 0 || colNome < 0) && header.length >= 2) {
      colCodigo = 0;
      colNome   = 1;
      colUnid   = header.length >= 3 ? 2 : -1;
      colCap    = header.length >= 4 ? 3 : -1;
    }

    // Função para splittar linha respeitando campos entre aspas
    const splitLinha = (linha) => {
      const result = [];
      let cur = '', inQ = false;
      for (let i = 0; i < linha.length; i++) {
        const ch = linha[i];
        if ((ch === '"' || ch === '“' || ch === '”') ) { inQ = !inQ; }
        else if (ch === sep && !inQ) { result.push(cur.trim()); cur = ''; }
        else { cur += ch; }
      }
      result.push(cur.trim());
      return result;
    };

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitLinha(lines[i]);
      const codigo  = (cols[colCodigo] || '').replace(/^[""]|[""]$/g, '').trim();
      const nome    = (cols[colNome]   || '').replace(/^[""]|[""]$/g, '').trim();
      const unidade = colUnid >= 0 ? (cols[colUnid] || '').replace(/^[""]|[""]$/g, '').trim() : '';
      const cap     = colCap  >= 0 ? (cols[colCap]  || '').replace(/^[""]|[""]$/g, '').trim() : '';
      if (!codigo && !nome) continue;
      rows.push({ linha: i + 1, codigo, nome, unidade, cap, ok: !!(codigo && nome) });
    }

    this._insumosImportRows = rows.filter(r => r.ok);
    const validos   = rows.filter(r => r.ok).length;
    const invalidos = rows.filter(r => !r.ok).length;

    const prev = H.el('ins-import-preview');
    if (prev) {
      prev.innerHTML = `
        <div style="margin-bottom:10px;font-size:12px;color:var(--text2)">
          <strong>${validos}</strong> registro${validos !== 1 ? 's' : ''} válido${validos !== 1 ? 's' : ''}
          ${invalidos > 0 ? `· <span style="color:var(--red)">${invalidos} sem código/nome</span>` : ''}
        </div>
        <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r)">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:var(--surface2)">
              <th style="padding:6px 10px;text-align:left">Código</th>
              <th style="padding:6px 10px;text-align:left">Nome/Descrição</th>
              <th style="padding:6px 10px;text-align:left">Unidade</th>
              <th style="padding:6px 10px;text-align:left;color:var(--azul-dk)">CAP</th>
            </tr></thead>
            <tbody>${rows.slice(0, 100).map(r => `
              <tr style="border-top:1px solid var(--border);${!r.ok ? 'opacity:.4' : ''}">
                <td style="padding:5px 10px;font-family:var(--font-m)">${H.esc(r.codigo || '—')}</td>
                <td style="padding:5px 10px">${H.esc(r.nome || '—')}</td>
                <td style="padding:5px 10px;color:var(--text3)">${H.esc(r.unidade || '—')}</td>
                <td style="padding:5px 10px;color:var(--azul-dk);font-family:var(--font-m)">${H.esc(r.cap || '—')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${rows.length > 100 ? `<div style="font-size:11px;color:var(--text3);margin-top:6px">… e mais ${rows.length - 100} registro(s)</div>` : ''}`;
    }

    const btn = H.el('ins-import-btn');
    if (btn) btn.disabled = this._insumosImportRows.length === 0;
  },

  async confirmarImportarInsumos() {
    const btn = H.el('ins-import-btn');
    if (!this._insumosImportRows.length) { UI.toast('Nenhum registro para importar', 'error'); return; }
    const orig = btn?.textContent || '⬆ Importar';
    if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
    try {
      const payload = this._insumosImportRows.map(r => ({ codigo: r.codigo, nome: r.nome, unidade: r.unidade, cap: r.cap || null }));
      const res = await API.bulkInsumos(payload);
      const msg = `${res.importados} importado${res.importados !== 1 ? 's' : ''}` +
        (res.erros > 0 ? `, ${res.erros} erro${res.erros !== 1 ? 's' : ''}` : '');
      UI.toast(msg, res.erros > 0 ? 'warn' : 'success');
      UI.closeModal('modal-importar-insumos');
      this._insumosImportRows = [];
      await Pages._cadInsumos();
    } catch(e) {
      UI.toast('Erro na importação: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  },
};

// ══════════════════════════════════════
// ALÇADAS
// ══════════════════════════════════════
