const Medicoes = {
  async openNew() {
    State.editingId = null;
    Medicoes._pendingFiles = [];
    H.el('mm-title').textContent = '📋 NOVA MEDIÇÃO';
    H.el('mm-body').innerHTML = await this._buildForm(null);
    this._bindFormEvents();
    UI.openModal('modal-medicao');
  },

  async edit(id) {
    State.editingId = id;
    Medicoes._pendingFiles = [];
    const m = await API.medicao(id);
    H.el('mm-title').textContent = `✏ EDITAR MEDIÇÃO · ${m.codigo}`;
    H.el('mm-body').innerHTML = await this._buildForm(m);
    this._bindFormEvents();
    UI.openModal('modal-medicao');
  },

  async _buildForm(m) {
    const [empresas, obras] = await Promise.all([ API.empresas(), API.obras() ]);
    const obrasFilt = m ? obras.filter(o=>o.empresa_id===m.empresa_id) : obras;
    const tipoAtual = m?.tipo || 'Normal';

    // Para nova medição: sem contrato pré-selecionado.
    // Para edição: carrega contratos disponíveis + o próprio contrato para pré-seleção.
    let contsFilt = [];
    let fornsEdit = []; // fornecedores disponíveis para edição
    if (m?.obra_id) {
      // Busca contratos disponíveis para a obra — deriva fornecedores únicos deles
      const contsDisp = await API.contratos({ disponivel: 1, tipo: tipoAtual, obra_id: m.obra_id });
      const fornsMap = new Map();
      contsDisp.forEach(c => { if (!fornsMap.has(c.fornecedor_id)) fornsMap.set(c.fornecedor_id, c.fornecedor_nome); });
      fornsEdit = [...fornsMap.entries()].map(([id, nome]) => ({ id, nome }));

      if (m.fornecedor_id) {
        contsFilt = contsDisp.filter(c => c.fornecedor_id === m.fornecedor_id);
        // Garante contrato atual na lista mesmo que esteja 100% (edição)
        if (m.contrato_id && !contsFilt.find(c => c.id === m.contrato_id)) {
          const allConts = await API.contratos({ obra_id: m.obra_id });
          const current  = allConts.find(c => c.id === m.contrato_id);
          if (current) contsFilt.unshift(current);
        }
      }
    }
    return `
    <!-- Seletor de Tipo de Medição -->
    <div class="fsec" style="padding-bottom:0">
      <div class="fsec-title">TIPO DE MEDIÇÃO</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;margin-bottom:4px">
        ${[
          { val:'Normal',       ico:'📋', label:'Normal',         desc:'Mede execução física e gera pagamento (padrão)' },
          { val:'Adiantamento', ico:'💰', label:'Adiantamento',   desc:'Pagamento antecipado — sem avanço físico na obra' },
          { val:'Avanco_Fisico',ico:'📐', label:'Avanço Físico',  desc:'Registra execução física — sem valor financeiro (fecha descompasso)' },
        ].map(t => `
          <label style="display:flex;align-items:flex-start;gap:8px;padding:10px 14px;border-radius:8px;cursor:pointer;border:2px solid ${tipoAtual===t.val?'var(--accent)':'var(--border)'};background:${tipoAtual===t.val?'var(--accent3)':'var(--surface)'};transition:all .15s;flex:1;min-width:180px">
            <input type="radio" name="mf-tipo" value="${t.val}" ${tipoAtual===t.val?'checked':''}
              onchange="Medicoes._onTipoChange()" style="margin-top:2px;accent-color:var(--accent)">
            <div>
              <div style="font-weight:600;font-size:13px">${t.ico} ${t.label}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">${t.desc}</div>
            </div>
          </label>`).join('')}
      </div>
    </div>
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
            ${m?.obra_id && fornsEdit.length
              ? '<option value="">Selecione o fornecedor...</option>' +
                fornsEdit.map(f => `<option value="${f.id}" ${m?.fornecedor_id===f.id?'selected':''}>${f.nome}</option>`).join('')
              : '<option value="">Selecione a obra primeiro...</option>'}
          </select></div>
        <div class="fg"><label class="fl">Contrato *</label>
          <select class="fi fsel" id="mf-contrato" onchange="Medicoes._onContratoChange()">
            ${contsFilt.length
              ? '<option value="">Selecione o contrato...</option>' + contsFilt.map(c => {
                  let info;
                  if (tipoAtual === 'Avanco_Fisico') {
                    info = 'avanço físico pendente';
                  } else {
                    const totalFin = parseFloat(c.total_financeiro) || 0;
                    const valorTot = parseFloat(c.valor_total) || 0;
                    const pctFin   = valorTot > 0 ? Math.min(100, (totalFin / valorTot) * 100) : 0;
                    info = `${(100 - pctFin).toFixed(0)}% saldo financeiro`;
                  }
                  return `<option value="${c.id}" ${m?.contrato_id===c.id?'selected':''}>${c.numero} · ${c.objeto} (${info})</option>`;
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

    <!-- Seção de itens: todos os tipos usam itens do contrato -->
    <div class="fsec" id="mf-sec-itens">
      <div class="fsec-title" style="display:flex;justify-content:space-between;align-items:center">
        <span id="mf-itens-titulo">${
          tipoAtual==='Avanco_Fisico' ? '📐 CONFIRMAR EXECUÇÃO FÍSICA (SALDO DE ADIANTAMENTOS)' :
          tipoAtual==='Adiantamento'  ? '💰 ITENS DO ADIANTAMENTO' :
          'ITENS DE MEDIÇÃO'
        }</span>
        <button class="btn btn-o btn-xs" id="mf-btn-avulso"
          onclick="Medicoes._addItem('un')"
          style="${tipoAtual==='Avanco_Fisico'?'display:none':''}"
          title="Adiciona item não vinculado ao contrato">+ Item Avulso</button>
      </div>
      <div id="mf-tipo-banner" style="margin-bottom:10px;font-size:12px;${tipoAtual==='Normal'?'display:none':''}">
        ${tipoAtual==='Adiantamento'?`<div class="ibox warn">
          💰 Selecione os itens e quantidades a adiantar. O valor financeiro será pago agora.
          <strong>O progresso físico só avança quando confirmado por uma Medição de Avanço Físico.</strong>
        </div>`:
        tipoAtual==='Avanco_Fisico'?`<div class="ibox info">
          📐 Estes itens foram <strong>adiantados financeiramente</strong> e aguardam confirmação de execução física.
          Ajuste as quantidades se necessário. Valor financeiro = R$ 0,00.
        </div>`:''}
      </div>
      <div class="ibox info" id="mf-acum-banner" style="margin-bottom:10px;font-size:11px;${m?.itens?.length?'':'display:none'}"></div>
      <div id="mf-itens">${(m?.itens||[]).map((it,i)=>Medicoes._itemRowHTML(it,i)).join('')||`<div class="items-empty" id="mf-itens-empty">Selecione o contrato para carregar os itens.</div>`}</div>
      <div class="item-totais" id="mf-totais" style="${!(m?.itens||[]).length?'display:none':''}">
        <div><div class="item-total-lbl">${tipoAtual==='Avanco_Fisico'?'Qtd Física Confirmada':'Valor desta Medição'}</div><div class="item-total-val" id="mf-total-med">${tipoAtual==='Avanco_Fisico'?'—':'R$ '+H.fmt(m?.valor_medicao||0)}</div></div>
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
      <!-- Inputs ocultos para cada modo de captura -->
      <input type="file" id="mf-file-foto"  accept="image/*" capture="environment"
             style="display:none" onchange="Medicoes._onFileSelect(this)">
      <input type="file" id="mf-file-video" accept="video/*" capture="environment"
             style="display:none" onchange="Medicoes._onFileSelect(this)">
      <input type="file" id="mf-file-docs"  multiple accept="image/*,.pdf,.mp4,.mov,.avi,.webm,.doc,.docx,.xls,.xlsx"
             style="display:none" onchange="Medicoes._onFileSelect(this)">
      <!-- Três botões de captura -->
      <div class="upz-btns">
        <div class="upz-btn" onclick="document.getElementById('mf-file-foto').click()">
          <span class="upz-btn-ico">📷</span>
          <span class="upz-btn-lbl">Tirar Foto</span>
          <span class="upz-btn-sub">Abre a câmera</span>
        </div>
        <div class="upz-btn" onclick="document.getElementById('mf-file-video').click()">
          <span class="upz-btn-ico">🎬</span>
          <span class="upz-btn-lbl">Gravar Vídeo</span>
          <span class="upz-btn-sub">Câmera de vídeo</span>
        </div>
        <div class="upz-btn" onclick="document.getElementById('mf-file-docs').click()">
          <span class="upz-btn-ico">📎</span>
          <span class="upz-btn-lbl">Selecionar Arquivo</span>
          <span class="upz-btn-sub">Galeria / dispositivo</span>
        </div>
      </div>
      <!-- Zona de drag-drop para desktop -->
      <div class="upz-drop" id="mf-dropzone"
           ondragover="event.preventDefault();this.classList.add('drag-over')"
           ondragleave="this.classList.remove('drag-over')"
           ondrop="event.preventDefault();this.classList.remove('drag-over');Medicoes._onFileDrop(event.dataTransfer.files)">
        🗂 Ou arraste arquivos aqui
      </div>
      <div class="flist" id="mf-files">
        ${(m?.evidencias||[]).map(f=>`
          <div class="fitem" data-evid="${f.id}">
            <span style="font-size:14px">${f.tipo==='img'?'🖼':f.tipo==='pdf'?'📄':f.tipo==='video'?'🎬':'📄'}</span>
            <span class="fitem-name">${H.esc(f.nome)}</span>
            <span class="fitem-sz">${H.esc(f.tamanho||'')}</span>
            <span class="fitem-rm" onclick="Medicoes._removeExistingEvidencia(this,${f.id})">×</span>
          </div>`).join('')}
      </div>
      <div id="mf-upload-progress" style="display:none;margin-top:8px;font-size:12px;color:var(--text3)"></div>
    </div>`;
  },

  // Arquivos pendentes de upload (selecionados mas ainda não enviados)
  _pendingFiles: [],

  _onFileSelect(input) {
    Medicoes._addPendingFiles(Array.from(input.files));
    input.value = ''; // reset para permitir re-seleção do mesmo arquivo
  },

  _onFileDrop(fileList) {
    Medicoes._addPendingFiles(Array.from(fileList));
  },

  _addPendingFiles(files) {
    const list = H.el('mf-files');
    if (!list) return;
    for (const f of files) {
      Medicoes._pendingFiles.push(f);
      const ext  = f.name.split('.').pop().toLowerCase();
      const ico  = ['jpg','jpeg','png','gif','webp','heic'].includes(ext) ? '🖼'
                 : ['pdf'].includes(ext) ? '📄'
                 : ['mp4','mov','avi','mkv','webm'].includes(ext) ? '🎬' : '📄';
      const sz   = f.size < 1048576
        ? `${(f.size/1024).toFixed(0)} KB`
        : `${(f.size/1048576).toFixed(1)} MB`;
      const idx  = Medicoes._pendingFiles.length - 1;
      const div  = document.createElement('div');
      div.className = 'fitem pending-file';
      div.dataset.pidx = idx;
      div.innerHTML = `<span style="font-size:14px">${ico}</span>
        <span class="fitem-name">${H.esc(f.name)}</span>
        <span class="fitem-sz">${sz}</span>
        <span style="font-size:10px;color:var(--accent);margin:0 4px">pendente</span>
        <span class="fitem-rm" onclick="Medicoes._removePendingFile(this,${idx})">×</span>`;
      list.appendChild(div);
    }
  },

  _removePendingFile(el, idx) {
    Medicoes._pendingFiles[idx] = null; // marca como removido (sem reindexar)
    el.closest('.fitem')?.remove();
  },

  async _removeExistingEvidencia(el, evId) {
    const medicaoId = State.editingId;
    if (!medicaoId) { el.closest('.fitem')?.remove(); return; }
    try {
      await API.deleteEvidencia(medicaoId, evId);
      el.closest('.fitem')?.remove();
      UI.toast('Evidência removida', 'info');
    } catch(e) { UI.toast('Erro ao remover: ' + e.message, 'error'); }
  },

  // Envia os arquivos pendentes para uma medição já criada
  async _uploadPendingFiles(medicaoId) {
    const files = (Medicoes._pendingFiles || []).filter(Boolean);
    if (!files.length) return;
    const prog = H.el('mf-upload-progress');
    if (prog) { prog.style.display = ''; prog.textContent = `⬆ Enviando ${files.length} arquivo(s)...`; }
    try {
      await API.uploadEvidencias(medicaoId, files, (e) => {
        if (prog && e.total) {
          const pct = Math.round(e.loaded / e.total * 100);
          prog.textContent = `⬆ Enviando... ${pct}%`;
        }
      });
      Medicoes._pendingFiles = [];
      if (prog) { prog.textContent = `✓ ${files.length} arquivo(s) enviado(s)`; }
    } catch(e) {
      console.error('[uploadPendingFiles]', e);
      if (prog) { prog.style.color = 'var(--red)'; prog.textContent = `Erro no upload: ${e.message}`; }
    }
  },

  async _onTipoChange() {
    const tipo = document.querySelector('input[name="mf-tipo"]:checked')?.value || 'Normal';

    // Atualiza visual dos radio cards
    document.querySelectorAll('input[name="mf-tipo"]').forEach(r => {
      const card = r.closest('label');
      if (!card) return;
      card.style.borderColor = r.checked ? 'var(--accent)' : 'var(--border)';
      card.style.background  = r.checked ? 'var(--accent3)' : 'var(--surface)';
    });

    // Atualiza título da seção de itens
    const titulo = H.el('mf-itens-titulo');
    if (titulo) {
      titulo.textContent =
        tipo === 'Avanco_Fisico' ? '📐 CONFIRMAR EXECUÇÃO FÍSICA (SALDO DE ADIANTAMENTOS)' :
        tipo === 'Adiantamento'  ? '💰 ITENS DO ADIANTAMENTO' :
        'ITENS DE MEDIÇÃO';
    }

    // Mostra/oculta botão de item avulso (não faz sentido em Avanço Físico)
    const btnAvulso = H.el('mf-btn-avulso');
    if (btnAvulso) btnAvulso.style.display = tipo === 'Avanco_Fisico' ? 'none' : '';

    // Atualiza banner informativo
    const tipoBanner = H.el('mf-tipo-banner');
    if (tipoBanner) {
      if (tipo === 'Normal') {
        tipoBanner.style.display = 'none';
        tipoBanner.innerHTML = '';
      } else if (tipo === 'Adiantamento') {
        tipoBanner.style.display = '';
        tipoBanner.innerHTML = `<div class="ibox warn">
          💰 Selecione os itens e quantidades a adiantar. O valor financeiro será pago agora.
          <strong>O progresso físico só avança quando confirmado por uma Medição de Avanço Físico.</strong>
        </div>`;
      } else if (tipo === 'Avanco_Fisico') {
        tipoBanner.style.display = '';
        tipoBanner.innerHTML = `<div class="ibox info">
          📐 Estes itens foram <strong>adiantados financeiramente</strong> e aguardam confirmação de execução física.
          Ajuste as quantidades se necessário. Valor financeiro = R$ 0,00.
        </div>`;
      }
    }

    // Recarrega fornecedores (e contratos) filtrando pelo novo tipo
    // (Normal/Adiantamento → saldo financeiro; Avanço Físico → avanço pendente de confirmação)
    const obraId = parseInt(H.el('mf-obra')?.value) || null;
    if (obraId) {
      await this._reloadFornecedores();
    } else {
      H.el('mf-fornecedor').innerHTML = '<option value="">Selecione a obra primeiro...</option>';
      H.el('mf-contrato').innerHTML   = '<option value="">Selecione a obra primeiro...</option>';
      const container = H.el('mf-itens');
      if (container) container.innerHTML = `<div class="items-empty" id="mf-itens-empty">Selecione o contrato para carregar os itens.</div>`;
    }
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
    H.el('mf-obra').innerHTML      = '<option value="">Selecione a obra...</option>' + obras.map(o=>`<option value="${o.id}">${o.nome}</option>`).join('');
    H.el('mf-fornecedor').innerHTML = '<option value="">Selecione a obra primeiro...</option>';
    H.el('mf-contrato').innerHTML   = '<option value="">Selecione a obra primeiro...</option>';
    H.el('mf-itens').innerHTML = `<div class="items-empty">Selecione o contrato para carregar os itens de medição.</div>`;
    if(H.el('mf-totais')) H.el('mf-totais').style.display = 'none';
  },

  async _onObraChange() {
    await this._reloadFornecedores();
  },

  async _onFornecedorChange() {
    await this._reloadContratos();
  },

  // Recarrega fornecedores com base nos contratos disponíveis da obra + tipo selecionados
  async _reloadFornecedores() {
    const obraId = parseInt(H.el('mf-obra')?.value) || null;
    const tipo   = document.querySelector('input[name="mf-tipo"]:checked')?.value || 'Normal';

    // Reseta fornecedor, contrato e itens
    H.el('mf-fornecedor').innerHTML = '<option value="">Selecione...</option>';
    H.el('mf-contrato').innerHTML   = '<option value="">Selecione o fornecedor...</option>';
    H.el('mf-itens').innerHTML = `<div class="items-empty">Selecione o contrato para carregar os itens de medição.</div>`;
    if(H.el('mf-totais')) H.el('mf-totais').style.display = 'none';

    if (!obraId) return;

    // Busca contratos com saldo disponível nesta obra
    const conts = await API.contratos({ disponivel: 1, tipo, obra_id: obraId });

    // Extrai fornecedores únicos dos contratos retornados
    const fornsMap = new Map();
    conts.forEach(c => { if (!fornsMap.has(c.fornecedor_id)) fornsMap.set(c.fornecedor_id, c.fornecedor_nome); });

    if (!fornsMap.size) {
      const msg = tipo === 'Avanco_Fisico'
        ? 'Nenhum contrato com avanço físico pendente nesta obra'
        : 'Nenhum fornecedor com saldo disponível nesta obra';
      H.el('mf-fornecedor').innerHTML = `<option value="">${msg}</option>`;
      H.el('mf-contrato').innerHTML   = `<option value="">—</option>`;
      return;
    }

    H.el('mf-fornecedor').innerHTML = '<option value="">Selecione o fornecedor...</option>' +
      [...fornsMap.entries()].map(([id, nome]) => `<option value="${id}">${nome}</option>`).join('');
  },

  async _reloadContratos() {
    const obraId = parseInt(H.el('mf-obra')?.value)       || null;
    const fornId = parseInt(H.el('mf-fornecedor')?.value) || null;
    const tipo   = document.querySelector('input[name="mf-tipo"]:checked')?.value || 'Normal';

    // Limpa itens ao trocar contrato
    H.el('mf-contrato').innerHTML = '<option value="">Selecione o contrato...</option>';
    H.el('mf-itens').innerHTML = `<div class="items-empty">Selecione o contrato para carregar os itens de medição.</div>`;
    if(H.el('mf-totais')) H.el('mf-totais').style.display = 'none';
    if(!obraId && !fornId) return;

    const filters = { disponivel: 1, tipo };
    if(obraId)  filters.obra_id       = obraId;
    if(fornId)  filters.fornecedor_id = fornId;
    const conts = await API.contratos(filters);
    if(!conts.length) {
      const msg = tipo === 'Avanco_Fisico'
        ? 'Nenhum contrato com avanço físico pendente'
        : 'Nenhum contrato com saldo financeiro disponível';
      H.el('mf-contrato').innerHTML = `<option value="">${msg}</option>`;
      return;
    }
    H.el('mf-contrato').innerHTML = '<option value="">Selecione o contrato...</option>' +
      conts.map(c => {
        let info;
        if (tipo === 'Avanco_Fisico') {
          info = 'avanço físico pendente';
        } else {
          const totalFin = parseFloat(c.total_financeiro) || 0;
          const valorTot = parseFloat(c.valor_total) || 0;
          const pctFin   = valorTot > 0 ? Math.min(100, (totalFin / valorTot) * 100) : 0;
          info = `${(100 - pctFin).toFixed(0)}% saldo financeiro`;
        }
        return `<option value="${c.id}">${c.numero} · ${c.objeto} (${info})</option>`;
      }).join('');
  },

  async _onContratoChange() {
    const contId = parseInt(H.el('mf-contrato')?.value);
    if(!contId) {
      State.cache.acumulados = null;
      H.el('mf-itens').innerHTML = `<div class="items-empty" id="mf-itens-empty">Selecione o contrato para carregar os itens.</div>`;
      if(H.el('mf-totais')) H.el('mf-totais').style.display = 'none';
      return;
    }

    const tipo = document.querySelector('input[name="mf-tipo"]:checked')?.value || 'Normal';

    if (tipo === 'Avanco_Fisico') {
      await this._loadAdiantamentosPendentes(contId);
    } else {
      await this._loadItensDoContrato(contId);
    }
  },

  // ── Carrega itens normais do contrato (Normal / Adiantamento) ────
  async _loadItensDoContrato(contId) {
    try {
      const acum = await API.acumulados(contId);
      State.cache.acumulados = acum;

      const banner    = H.el('mf-acum-banner');
      const container = H.el('mf-itens');
      const totaisEl  = H.el('mf-totais');
      const tipo      = document.querySelector('input[name="mf-tipo"]:checked')?.value || 'Normal';

      if(!acum.itens || acum.itens.length === 0) {
        container.innerHTML = `<div class="items-empty" id="mf-itens-empty" style="color:var(--warning)">
          ⚠ Este contrato não possui itens orçamentários cadastrados.<br>
          <small>Edite o contrato e adicione os itens antes de criar a medição.</small>
        </div>`;
        if(banner) { banner.innerHTML = `<span style="color:var(--warning)">⚠</span> Contrato sem planilha orçamentária.`; banner.style.display=''; }
        if(totaisEl) totaisEl.style.display='none';
        return;
      }

      if(banner) {
        const itensComSaldo  = acum.itens.filter(i => i.qtd_saldo > 0.0001);
        const pctFisico      = acum.pct_executado.toFixed(1);
        const adtPendente    = acum.itens.reduce((s,i) => s + (i.qtd_saldo_adt_pendente||0), 0);
        const saldoGlobal    = parseFloat(acum.saldo_financeiro_global ?? acum.valor_total) || 0;
        const totalFin       = parseFloat(acum.total_financeiro) || 0;
        const valorTotal     = parseFloat(acum.valor_total) || 0;
        const fmtR = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});

        let msg = `<span style="color:var(--blue)">ℹ</span> ${pctFisico}% físico executado · ${itensComSaldo.length}/${acum.itens.length} itens com saldo de quantidade`;
        if (adtPendente > 0) msg += ` · <span style="color:#d97706">⚠ ${adtPendente.toFixed(2)} un. adiantadas aguardando confirmação física</span>`;

        // Alerta de saldo financeiro global (inclui adiantamentos avulsos)
        if (valorTotal > 0) {
          if (saldoGlobal <= 0) {
            msg = `<span style="color:var(--danger)">🚫</span> <strong>Saldo financeiro esgotado.</strong> ` +
                  `Total comprometido: ${fmtR(totalFin)} / ${fmtR(valorTotal)}. Não é possível criar novas medições financeiras neste contrato.`;
            banner.style.cssText = 'display:block;background:rgba(220,38,38,.08);border:1px solid #fca5a5;border-radius:6px;padding:8px 12px;margin-bottom:8px';
          } else {
            msg += ` · 💰 Saldo financeiro disponível: <strong style="color:var(--green)">${fmtR(saldoGlobal)}</strong> de ${fmtR(valorTotal)}`;
            banner.style.cssText = '';
          }
        }
        banner.innerHTML = msg;
        banner.style.display = '';
      }

      container.innerHTML = '';
      acum.itens.forEach((ci, i) => {
        const itemData = {
          contrato_item_id: ci.id,
          descricao:        ci.descricao,
          unidade:          ci.unidade,
          qtd_contrato:     ci.qtd_total,
          qtd_anterior:     ci.qtd_acumulada,   // financeiro acumulado (Normal+Adt)
          qtd_mes:          '',
          qtd_acumulada:    ci.qtd_acumulada,
          valor_unitario:   tipo === 'Adiantamento' ? ci.valor_unitario : ci.valor_unitario,
          valor_item:       0,
          qtd_saldo:        ci.qtd_saldo,        // saldo financeiro (qtd_total - Normal - Adt)
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

  // ── Carrega itens de adiantamentos pendentes (Avanço Físico) ─────
  async _loadAdiantamentosPendentes(contId) {
    const container = H.el('mf-itens');
    const totaisEl  = H.el('mf-totais');
    const banner    = H.el('mf-acum-banner');

    try {
      const pendentes = await API.adiantamentosPendentes(contId);

      if (!pendentes.length) {
        container.innerHTML = `<div class="items-empty" id="mf-itens-empty" style="color:var(--text2)">
          <div style="font-size:22px;margin-bottom:8px">📋</div>
          <strong>Nenhum adiantamento pendente de confirmação física</strong><br>
          <div style="margin-top:8px;font-size:12px;color:var(--text3);max-width:480px;text-align:left">
            O Avanço Físico só exibe itens quando existe uma <strong>Medição de Adiantamento já lançada</strong> (status ≥ Aguardando N1) com saldo de execução física pendente.<br><br>
            <strong>Passos:</strong><br>
            1️⃣ Crie uma Medição de <strong>Adiantamento</strong> e clique em <em>🚀 Lançar</em><br>
            2️⃣ Volte e crie uma Medição de <strong>Avanço Físico</strong> — os itens aparecerão automaticamente<br><br>
            <em>Medições em Rascunho não geram saldo para o Avanço Físico.</em>
          </div>
        </div>`;
        if(banner) { banner.style.display='none'; }
        if(totaisEl) totaisEl.style.display='none';
        return;
      }

      if(banner) {
        const totalPendente = pendentes.reduce((s,p) => s + p.qtd_pendente * p.valor_unitario, 0);
        banner.innerHTML = `<span style="color:#d97706">💰</span> ${pendentes.length} ite${pendentes.length>1?'ns':'m'} com adiantamento pendente · R$ ${H.fmt(totalPendente)} a confirmar fisicamente`;
        banner.style.display = '';
      }

      container.innerHTML = '';
      pendentes.forEach((p, i) => {
        // Exibe como item travado: qtd_contrato = adiantada, qtd_anterior = já confirmada, qtd_mes = pendente
        const itemData = {
          contrato_item_id: p.contrato_item_id,
          descricao:        p.descricao,
          unidade:          p.unidade,
          qtd_contrato:     p.qtd_adiantada,   // "contratado" para AvFis = total adiantado
          qtd_anterior:     p.qtd_confirmada,   // já confirmado fisicamente
          qtd_mes:          p.qtd_pendente,     // pré-preenchido com o saldo pendente
          qtd_acumulada:    p.qtd_confirmada + p.qtd_pendente,
          valor_unitario:   0,                  // Avanço Físico não tem valor financeiro
          valor_item:       0,
          qtd_saldo:        p.qtd_pendente,
        };
        container.insertAdjacentHTML('beforeend', this._itemRowHTML(itemData, i));
      });
      if(totaisEl) totaisEl.style.display = '';
      this._recalcTotals();
    } catch(e) {
      UI.toast('Erro ao carregar adiantamentos pendentes: ' + e.message, 'error');
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
    const tipo         = document.querySelector('input[name="mf-tipo"]:checked')?.value || 'Normal';
    if(!empresa_id||!obra_id||!fornecedor_id||!contrato_id||!periodo) { UI.toast('Preencha os campos obrigatórios de identificação','error'); return null; }

    // ── Todos os tipos usam itens ──
    const rows = document.querySelectorAll('#mf-itens .item-row');
    if(!rows.length) { UI.toast('Adicione pelo menos um item de medição','error'); return null; }

    const itens = Array.from(rows).map((row,i) => {
      const qtdMes  = parseFloat(row.querySelector('.item-qtd-mes')?.value)||0;
      const qtdAnt  = parseFloat(row.querySelector('.item-qtd-ant')?.value)||0;
      const vun     = tipo === 'Avanco_Fisico' ? 0 : (parseFloat(row.querySelector('.item-vun')?.value)||0);
      const citemId = parseInt(row.dataset.citemId) || null;
      const unEl    = row.querySelector('.item-un');
      const un      = unEl ? (unEl.value || unEl.options?.[unEl.selectedIndex]?.value || '%') : '%';
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
    // Valida saldo no frontend antes de enviar
    // Normal/Adiantamento: qtd_anterior = acumulado financeiro (Normal+Adt), qtd_contrato = qtd_total
    // Avanco_Fisico: qtd_anterior = já confirmado, qtd_contrato = total adiantado
    for(const it of itens) {
      if(!it.contrato_item_id || it.qtd_mes <= 0) continue;
      const saldo = parseFloat(it.qtd_contrato) - parseFloat(it.qtd_anterior);
      if(it.qtd_mes > saldo + 0.0001) {
        const label = tipo === 'Avanco_Fisico' ? 'saldo de adiantamento pendente' : 'saldo disponível';
        UI.toast(`Item "${it.descricao}": ${it.qtd_mes} excede o ${label} de ${parseFloat(saldo.toFixed(4))} ${it.unidade}`, 'error');
        return null;
      }
    }

    // ── Validação financeira global (saldo real do contrato) ─────────
    // Bloqueia no frontend se o valor total desta medição ultrapassa o
    // saldo_financeiro_global retornado pelo backend (inclui adiantamentos avulsos).
    if(['Normal','Adiantamento'].includes(tipo)) {
      const acum = State.cache.acumulados;
      const saldoGlobal = parseFloat(acum?.saldo_financeiro_global ?? acum?.valor_total ?? 0);
      const valorEsta   = itens.reduce((s, it) => s + (it.valor_item || 0), 0);
      if(acum?.valor_total > 0 && valorEsta > saldoGlobal + 0.01) {
        const fmtR = v => 'R$ ' + parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
        UI.toast(`Valor desta medição (${fmtR(valorEsta)}) excede o saldo financeiro disponível no contrato (${fmtR(saldoGlobal)}).`, 'error');
        return null;
      }
    }

    // Valor financeiro: 0 para Avanço Físico (já pago no Adiantamento)
    const valor_medicao   = tipo === 'Avanco_Fisico' ? 0 : itens.reduce((s,it)=>s+it.qtd_mes*it.valor_unitario,0);
    const valor_acumulado = tipo === 'Avanco_Fisico' ? 0 : itens.reduce((s,it)=>s+it.qtd_acumulada*it.valor_unitario,0);

    // % físico: Adiantamento não avança o físico (pct=0)
    let pct_anterior = 0, pct_mes = 0, pct_total = 0;
    if (tipo !== 'Adiantamento') {
      const pctItens = itens.filter(it=>it.unidade==='%');
      pct_mes      = pctItens.reduce((s,it)=>s+it.qtd_mes,0);
      pct_anterior = pctItens.length ? pctItens.reduce((s,it)=>s+it.qtd_anterior,0) : 0;
      pct_total    = Math.min(pct_anterior + pct_mes, 100);
    }

    return { empresa_id, obra_id, fornecedor_id, contrato_id, periodo, codigo, descricao,
             tipo, valor_medicao, valor_acumulado, pct_anterior, pct_mes, pct_total, itens };
  },

  async saveDraft() {
    let data;
    try { data = this._collectForm(); } catch(e) {
      console.error('[saveDraft] Erro em _collectForm:', e);
      UI.toast('Erro no formulário: ' + e.message, 'error'); return;
    }
    if(!data) return; // toast já mostrado por _collectForm
    data.status = 'Rascunho';
    const btn = H.el('mm-btn-draft');
    if(btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
    try {
      let medicaoId = State.editingId;
      if(medicaoId) await API.updateMedicao(medicaoId, data);
      else { const r = await API.createMedicao(data); medicaoId = r?.id; }
      // Upload de arquivos pendentes (não bloqueia o modal)
      if (medicaoId) Medicoes._uploadPendingFiles(medicaoId).catch(()=>{});
      UI.closeModal('modal-medicao');
      UI.toast(`Medição ${data.codigo} salva como rascunho`, 'info');
      await Pages.medicoes();
    } catch(e) {
      console.error('[saveDraft] Erro na API:', e);
      UI.toast('Erro ao salvar: ' + e.message, 'error');
    } finally {
      if(btn) { btn.disabled = false; btn.textContent = '💾 Salvar Rascunho'; }
    }
  },

  async launch() {
    let data;
    try { data = this._collectForm(); } catch(e) {
      console.error('[launch] Erro em _collectForm:', e);
      UI.toast('Erro no formulário: ' + e.message, 'error'); return;
    }
    if(!data) return; // toast já mostrado por _collectForm
    data.status = 'Aguardando N1';
    const btn = H.el('mm-btn-launch');
    if(btn) { btn.disabled = true; btn.textContent = '⏳ Lançando...'; }
    try {
      let medicaoId = State.editingId;
      if(medicaoId) await API.updateMedicao(medicaoId, data);
      else { const r = await API.createMedicao(data); medicaoId = r?.id; }
      // Upload de arquivos pendentes (não bloqueia o lançamento)
      if (medicaoId) Medicoes._uploadPendingFiles(medicaoId).catch(()=>{});
      UI.closeModal('modal-medicao');
      UI.toast(`✓ Medição ${data.codigo} lançada — enviada para aprovação N1`, 'success');
      await Pages.medicoes();
    } catch(e) {
      console.error('[launch] Erro na API:', e);
      UI.toast('Erro ao lançar: ' + e.message, 'error');
    } finally {
      if(btn) { btn.disabled = false; btn.textContent = '🚀 Lançar'; }
    }
  },

  // ── Renderiza aba de evidências no detalhe/aprovação ─────────
  _buildEvidenciasTab(evids, medicaoId, status) {
    const fmtIco = (tipo) => tipo==='img'?'🖼':tipo==='pdf'?'📄':tipo==='video'?'🎬':'📄';
    const canUpload = ['Rascunho','Reprovado','Aguardando N1','Aguardando N2','Aguardando N3'].includes(status);

    const gallery = evids.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          ${evids.map(f => {
            const url  = f.url_view || f.url_storage || null;
            const isImg = f.tipo === 'img';
            const thumb = isImg && url
              ? `<div style="width:100%;height:120px;background:var(--surface3);border-radius:var(--r);overflow:hidden;margin-bottom:6px">
                   <img src="${H.esc(url)}" alt="${H.esc(f.nome)}"
                        style="width:100%;height:100%;object-fit:cover;cursor:pointer"
                        onclick="window.open('${H.esc(url)}','_blank')"
                        onerror="this.parentElement.innerHTML='<div style=\\'text-align:center;padding:30px;font-size:32px\\'>🖼</div>'">
                 </div>`
              : `<div style="width:100%;height:80px;display:flex;align-items:center;justify-content:center;
                             background:var(--surface3);border-radius:var(--r);margin-bottom:6px;font-size:36px">${fmtIco(f.tipo)}</div>`;
            return `
              <div style="width:160px;background:var(--surface2);border:1px solid var(--border);
                          border-radius:var(--r2);padding:10px;display:flex;flex-direction:column">
                ${thumb}
                <div style="font-size:10px;color:var(--text);font-weight:600;
                            white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                     title="${H.esc(f.nome)}">${H.esc(f.nome)}</div>
                <div style="font-size:9px;color:var(--text3);margin-top:2px">${H.esc(f.tamanho||'')} · ${H.esc(f.enviado_por||'—')}</div>
                <div style="display:flex;gap:4px;margin-top:6px">
                  ${url ? `<a href="${H.esc(url)}" target="_blank" rel="noopener"
                              style="flex:1;text-align:center;font-size:10px;padding:3px 0;
                                     background:var(--surface3);border-radius:var(--r);
                                     color:var(--text2);text-decoration:none">↗ Abrir</a>` : ''}
                  ${canUpload ? `<button style="flex:0;font-size:10px;padding:3px 8px;background:var(--red);
                                                color:#fff;border:none;border-radius:var(--r);cursor:pointer"
                                          onclick="Medicoes._deleteEvidenciaDetalhe(${f.id},${medicaoId},this)">🗑</button>` : ''}
                </div>
              </div>`;
          }).join('')}
         </div>`
      : `<div style="text-align:center;padding:30px;color:var(--text3)">
           <div style="font-size:40px;margin-bottom:8px">📁</div>
           <div>Nenhuma evidência anexada ainda</div>
         </div>`;

    const uploadBtn = canUpload ? `
      <div style="margin-top:12px">
        <!-- Inputs ocultos para cada modo de captura -->
        <input type="file" id="det-ev-foto"  accept="image/*" capture="environment"
               style="display:none" onchange="Medicoes._uploadDetalhes(${medicaoId},this)">
        <input type="file" id="det-ev-video" accept="video/*" capture="environment"
               style="display:none" onchange="Medicoes._uploadDetalhes(${medicaoId},this)">
        <input type="file" id="det-ev-docs"  multiple accept="image/*,.pdf,.mp4,.mov,.avi,.webm,.doc,.docx"
               style="display:none" onchange="Medicoes._uploadDetalhes(${medicaoId},this)">
        <!-- Três botões de captura -->
        <div class="upz-btns">
          <div class="upz-btn" onclick="document.getElementById('det-ev-foto').click()">
            <span class="upz-btn-ico">📷</span>
            <span class="upz-btn-lbl">Tirar Foto</span>
            <span class="upz-btn-sub">Abre a câmera</span>
          </div>
          <div class="upz-btn" onclick="document.getElementById('det-ev-video').click()">
            <span class="upz-btn-ico">🎬</span>
            <span class="upz-btn-lbl">Gravar Vídeo</span>
            <span class="upz-btn-sub">Câmera de vídeo</span>
          </div>
          <div class="upz-btn" onclick="document.getElementById('det-ev-docs').click()">
            <span class="upz-btn-ico">📎</span>
            <span class="upz-btn-lbl">Selecionar Arquivo</span>
            <span class="upz-btn-sub">Galeria / dispositivo</span>
          </div>
        </div>
        <div id="det-ev-progress" style="font-size:11px;color:var(--text3);margin-top:4px;display:none"></div>
      </div>` : `<div style="font-size:11px;color:var(--text3);margin-top:8px">
        Upload desabilitado — medição já aprovada ou concluída</div>`;

    return gallery + uploadBtn;
  },

  async _uploadDetalhes(medicaoId, input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const prog = H.el('det-ev-progress');
    // Desabilita todos os botões de captura durante o upload
    document.querySelectorAll('.upz-btn').forEach(b => b.style.pointerEvents = 'none');
    if (prog) { prog.style.display = ''; prog.style.color = 'var(--text3)'; prog.textContent = `⬆ Enviando ${files.length} arquivo(s)...`; }

    try {
      const inserted = await API.uploadEvidencias(medicaoId, files, (e) => {
        if (prog && e.total) {
          const pct = Math.round(e.loaded / e.total * 100);
          prog.textContent = `⬆ Enviando... ${pct}%`;
        }
      });
      if (prog) { prog.style.color = 'var(--green)'; prog.textContent = `✓ ${inserted.length} arquivo(s) enviado(s)`; }
      UI.toast(`✓ ${inserted.length} evidência(s) enviada(s)`, 'success');
      // Recarrega o detalhe para mostrar os novos arquivos
      setTimeout(() => Medicoes.openDetalhe(medicaoId), 800);
    } catch(e) {
      if (prog) { prog.style.color = 'var(--red)'; prog.textContent = `Erro: ${e.message}`; }
      UI.toast('Erro no upload: ' + e.message, 'error');
    } finally {
      document.querySelectorAll('.upz-btn').forEach(b => b.style.pointerEvents = '');
      input.value = '';
    }
  },

  async _deleteEvidenciaDetalhe(evId, medicaoId, el) {
    if (!confirm('Remover esta evidência?')) return;
    try {
      await API.deleteEvidencia(medicaoId, evId);
      UI.toast('Evidência removida', 'info');
      el.closest('div[style*="width:160px"]')?.remove();
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

  async reabrir(id) {
    if(!confirm('Reabrir esta medição reprovada? Ela voltará para Rascunho e poderá ser editada e reenviada.')) return;
    try {
      await API.reabrir(id);
      UI.toast('Medição reaberta — status voltou para Rascunho.', 'success');
      if(State.currentPage==='medicoes') await Pages.medicoes();
      if(State.currentPage==='acompanhamento') await Pages.acompanhamento();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  integrarUAU(id) {
    const existente = document.getElementById('modal-uau-params');
    if (existente) existente.remove();

    // ── Modal de confirmação simples ─────────────────────────────
    const modal = document.createElement('div');
    modal.id = 'modal-uau-params';
    modal.style.cssText = `position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(2px)`;
    modal.innerHTML = `
      <div style="background:var(--surface);border-radius:12px;padding:28px 28px 22px;width:380px;max-width:92vw;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="font-size:15px;font-weight:700;color:var(--text1);margin-bottom:6px">🔗 Integrar ao UAU</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:20px;line-height:1.5">
          Empresa, contrato, fornecedor e itens são resolvidos automaticamente do cadastro.<br>
          Confirma o envio para o ERP UAU?
        </div>
        <div id="uau-params-erro" style="display:none;margin-bottom:12px;padding:10px 12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;font-size:12px;color:#991b1b;line-height:1.5"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="uau-params-cancel" class="btn btn-o" style="font-size:12px">Cancelar</button>
          <button id="uau-params-debug" class="btn btn-o" style="font-size:12px">🔍 Ver payload</button>
          <button id="uau-params-ok" class="btn btn-a" style="background:#16a34a;font-size:12px">🔗 Integrar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const erroEl    = modal.querySelector('#uau-params-erro');
    const btnOk     = modal.querySelector('#uau-params-ok');
    const btnCancel = modal.querySelector('#uau-params-cancel');

    const _fechar = () => modal.remove();
    btnCancel.onclick = _fechar;
    modal.addEventListener('click', e => { if (e.target === modal) _fechar(); });
    btnOk.focus();

    const btnDebug = modal.querySelector('#uau-params-debug');
    btnDebug.onclick = async () => {
      btnDebug.disabled = true;
      btnDebug.textContent = '⏳ Carregando...';
      erroEl.style.display = 'none';
      try {
        const payload = await API.uauPayload(id);
        _fechar();
        Medicoes._mostrarPayloadUAU(payload);
      } catch(e) {
        erroEl.innerHTML = `✗ ${(e.message || 'Erro').replace(/\n/g, '<br>')}`;
        erroEl.style.display = 'block';
      } finally {
        btnDebug.disabled = false;
        btnDebug.textContent = '🔍 Ver payload';
      }
    };

    btnOk.onclick = async () => {
      btnOk.disabled = true;
      btnOk.textContent = '⏳ Integrando...';
      erroEl.style.display = 'none';

      try {
        const r = await API.integrarUAU(id, {});

        if (r.jaIntegrada) {
          _fechar();
          // Oferece re-integração para corrigir (ex: medição ficou R$0,00)
          const reintegrar = confirm(
            `Esta medição já foi enviada ao UAU (Nº ${r.uauMedicaoId}).\n\n` +
            `Deseja forçar uma nova integração? Isso criará uma nova medição no UAU.`
          );
          if (reintegrar) {
            btnOk.disabled = true;
            btnOk.textContent = '⏳ Reintegrando...';
            erroEl.style.display = 'none';
            const r2 = await API.integrarUAU(id, { forcar: true });
            _fechar();
            Medicoes._mostrarResumoUAU(r2);
            await this.openDetalhe(id);
            if (State.currentPage === 'medicoes')       await Pages.medicoes();
            if (State.currentPage === 'acompanhamento') await Pages.acompanhamento();
          }
          return;
        }

        _fechar();
        // Abre popup de resumo pós-integração
        Medicoes._mostrarResumoUAU(r);

        await this.openDetalhe(id);
        if (State.currentPage === 'medicoes')       await Pages.medicoes();
        if (State.currentPage === 'acompanhamento') await Pages.acompanhamento();
      } catch(e) {
        erroEl.innerHTML = `✗ ${(e.message || 'Erro desconhecido').replace(/\n/g, '<br>')}`;
        erroEl.style.display = 'block';
        btnOk.disabled = false;
        btnOk.textContent = '🔗 Integrar';
      }
    };

    btnOk.addEventListener('keydown', e => { if (e.key === 'Enter') btnOk.click(); });
  },

  _mostrarResumoUAU(r) {
    const existente = document.getElementById('modal-uau-resumo');
    if (existente) existente.remove();

    const c = r.confirmacao || {};
    const _fmt = v => v != null ? String(v) : '—';
    const _fmtData = v => {
      if (!v) return '—';
      try { return new Date(v).toLocaleDateString('pt-BR'); } catch { return v; }
    };
    const _fmtMoeda = v => {
      const n = parseFloat(v);
      if (isNaN(n)) return '—';
      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };
    const _fmtCNPJ = v => {
      if (!v) return '—';
      const d = String(v).replace(/\D/g, '');
      return d.length === 14
        ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
        : v;
    };

    const _row = (label, value) => `
      <div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:11px;color:var(--text3);font-weight:600;min-width:140px;flex-shrink:0">${label}</div>
        <div style="font-size:12px;color:var(--text1);word-break:break-word">${value}</div>
      </div>`;

    const itensSemUauHtml = r.itensSemUau && r.itensSemUau.length > 0
      ? `<div style="margin-top:14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;font-size:11px;color:#92400e">
           ⚠ ${r.itensSemUau.length} item(ns) sem código UAU cadastrado — não enviado(s) ao ERP:<br>
           <span style="opacity:.8">${r.itensSemUau.map(n => `• ${n}`).join('<br>')}</span>
         </div>` : '';

    const aprovacaoHtml = r.aprovada
      ? `<div style="margin:0 0 14px;padding:10px 12px;background:#dcfce7;border:1px solid #86efac;border-radius:7px;font-size:11px;color:#166534">✅ Medição <b>aprovada</b> no UAU (status "1 - Aprovada") — pronta para gerar o processo de pagamento.</div>`
      : `<div style="margin:0 0 14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:7px;font-size:11px;color:#92400e">⚠ Medição criada como "2 - Medida", mas <b>não foi aprovada automaticamente</b>${r.aprovacaoMensagem ? `:<br><span style="opacity:.85">${r.aprovacaoMensagem}</span>` : '.'}<br>Verifique a permissão de aprovação (programa OBMEDCONT) do usuário de integração UAU.</div>`;

    const modal = document.createElement('div');
    modal.id = 'modal-uau-resumo';
    modal.style.cssText = `position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(2px)`;
    modal.innerHTML = `
      <div style="background:var(--surface);border-radius:12px;padding:0;width:480px;max-width:94vw;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden">

        <div style="padding:20px 24px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">✅</div>
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--text1)">Integração concluída com sucesso</div>
              <div style="font-size:11px;color:var(--text3);margin-top:1px">Medição criada no ERP UAU — Nº ${_fmt(c.numeroMedicao || r.uauMedicaoId)}</div>
            </div>
          </div>
        </div>

        <div style="padding:16px 24px;overflow-y:auto;flex:1">

          ${aprovacaoHtml}
          <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Dados registrados no UAU</div>
          ${_row('Nº Medição UAU', `<strong style="font-size:14px;color:#16a34a">${_fmt(c.numeroMedicao || r.uauMedicaoId)}</strong>`)}
          ${_row('Status', _fmt(c.status))}
          ${_row('Data de cadastro', _fmtData(c.dataCadastro))}
          ${_row('Usuário UAU', _fmt(c.usrCadastro))}
          ${_row('Período de referência', _fmtData(c.dataBase))}

          <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;margin:14px 0 8px">Empresa e contrato</div>
          ${_row('Empresa', _fmt(c.empresa))}
          ${_row('Contrato Nº', _fmt(c.contrato))}
          ${_row('Descrição contrato', _fmt(c.descrContrato))}

          <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;margin:14px 0 8px">Fornecedor</div>
          ${_row('Fornecedor', _fmt(c.fornecedor))}
          ${_row('CNPJ', _fmtCNPJ(c.cnpjFornecedor))}

          <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;margin:14px 0 8px">Itens e valores</div>
          ${_row('Itens enviados', r.itensMapeados != null ? `${r.itensMapeados} item(ns)` : '—')}
          ${_row('Subtotal UAU', _fmtMoeda(c.subTotal))}
          ${_row('Total UAU', _fmtMoeda(c.total))}
          ${_row('Observação', _fmt(c.observacao))}

          ${itensSemUauHtml}
        </div>

        <div style="padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;flex-shrink:0">
          <button id="uau-resumo-fechar" class="btn btn-a" style="font-size:12px">Fechar</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.querySelector('#uau-resumo-fechar').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#uau-resumo-fechar').focus();
  },

  // ── Status atual da medição no UAU ────────────────────────────
  async _statusUAU(id) {
    const token = localStorage.getItem('construtivo_token') || '';
    const btn = document.querySelector(`[onclick*="_statusUAU(${id})"]`);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Consultando…'; }
    try {
      const r = await fetch(`/api/uau/status-medicao?medicaoId=${id}`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      const data = await r.json();
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Status UAU'; }
      if (!data.ok) { UI.toast('Erro UAU: ' + data.error, 'error'); return; }
      const s = data.status;
      const fmtV = v => v != null ? parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
      const fmtD = v => { if (!v) return '—'; try { return new Date(v).toLocaleDateString('pt-BR'); } catch { return v; } };
      const statusColor = [,'#16a34a','#0284c7','#7c3aed'][s.statusCodigo] || '#6b7280';
      const aprsHtml = (s.aprovacoes||[]).map(a =>
        `<tr><td style="padding:4px 8px;color:var(--text3)">${a.nivel||'—'}</td><td style="padding:4px 8px">${a.usuario||'—'}</td><td style="padding:4px 8px">${fmtD(a.data)}</td><td style="padding:4px 8px">${a.status||'—'}</td></tr>`
      ).join('');

      const modal = document.createElement('div');
      modal.id = 'modal-status-uau';
      modal.style.cssText = 'position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(2px)';
      const _close = () => modal.remove();
      modal.innerHTML = `<div class="md" style="max-width:520px;width:95%">
        <div class="mh"><div class="mh-title">🔄 STATUS NO ERP UAU</div><button class="mc-btn" id="uau-status-x">✕</button></div>
        <div class="mb" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg2);border-radius:var(--r);border:1px solid var(--border)">
            <span style="width:12px;height:12px;border-radius:50%;background:${statusColor};flex-shrink:0"></span>
            <div>
              <div style="font-weight:700;font-size:14px">${s.statusDescr || '—'}</div>
              <div style="font-size:11px;color:var(--text3)">Medição UAU Nº ${s.numeroMedicao ?? '—'}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
            <div><span style="color:var(--text3)">Subtotal</span><div style="font-weight:600">R$ ${fmtV(s.subTotal)}</div></div>
            <div><span style="color:var(--text3)">Total líquido</span><div style="font-weight:600;color:var(--blue)">R$ ${fmtV(s.total)}</div></div>
            <div><span style="color:var(--text3)">Acréscimos</span><div>R$ ${fmtV(s.acrescimos)}</div></div>
            <div><span style="color:var(--text3)">Descontos</span><div>R$ ${fmtV(s.descontos)}</div></div>
            <div><span style="color:var(--text3)">Data base</span><div>${fmtD(s.dataBase)}</div></div>
            <div><span style="color:var(--text3)">Cadastrada em</span><div>${fmtD(s.dataCadastro)}</div></div>
            ${s.dataAprovacao ? `<div><span style="color:var(--text3)">Aprovada em</span><div style="color:#16a34a;font-weight:600">${fmtD(s.dataAprovacao)}</div></div><div><span style="color:var(--text3)">Aprovada por</span><div>${s.quemAprovou||'—'}</div></div>` : ''}
            ${s.fornecedor ? `<div style="grid-column:1/-1"><span style="color:var(--text3)">Fornecedor</span><div>${s.fornecedor} · ${s.cnpjFornecedor||'—'}</div></div>` : ''}
          </div>
          ${aprsHtml ? `<div style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--text3);margin-top:4px">APROVAÇÕES</div>
          <table style="width:100%;font-size:12px;border-collapse:collapse">
            <thead><tr style="color:var(--text3)"><th style="padding:4px 8px;text-align:left">Nível</th><th style="padding:4px 8px;text-align:left">Usuário</th><th style="padding:4px 8px;text-align:left">Data</th><th style="padding:4px 8px;text-align:left">Status</th></tr></thead>
            <tbody>${aprsHtml}</tbody>
          </table>` : ''}
        </div>
        <div class="mf"><button class="btn btn-o" id="uau-status-fechar">Fechar</button></div>
      </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#uau-status-x').onclick = _close;
      modal.querySelector('#uau-status-fechar').onclick = _close;
      modal.addEventListener('click', e => { if (e.target === modal) _close(); });
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Status UAU'; }
      UI.toast('Erro ao consultar UAU: ' + e.message, 'error');
    }
  },

  // ── Debug: exibe os payloads que seriam enviados ao UAU ──────────
  _mostrarPayloadUAU(data) {
    const existente = document.getElementById('modal-uau-payload');
    if (existente) existente.remove();

    const json = JSON.stringify(data.payloads || data, null, 2);
    const endpoints = data.endpoints || {};

    const modal = document.createElement('div');
    modal.id = 'modal-uau-payload';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)';
    modal.innerHTML = `
      <div style="background:var(--surface);border-radius:12px;width:min(820px,96vw);max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid var(--border)">
          <div style="font-size:14px;font-weight:700;color:var(--text1)">🔍 Payloads UAU (dry-run — nenhuma chamada foi feita)</div>
          <button id="uau-payload-x" style="background:none;border:none;font-size:18px;color:var(--text3);cursor:pointer;padding:2px 6px">✕</button>
        </div>
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text3);display:flex;flex-wrap:wrap;gap:10px">
          ${Object.entries(endpoints).map(([k,v]) => `<div><span style="font-weight:600;color:var(--text2)">${k}:</span> <code style="font-size:10px;background:var(--bg2);padding:2px 5px;border-radius:4px">${v}</code></div>`).join('')}
        </div>
        <div style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;font-size:11px;color:var(--text3)">
          ${data.itensSemUau && data.itensSemUau.length ? `<span style="color:#b45309">⚠ ${data.itensSemUau.length} item(s) sem UAU: ${data.itensSemUau.join(', ')}</span>` : `<span style="color:#16a34a">✓ ${data.itensMapeados} item(s) mapeados para o UAU</span>`}
        </div>
        <div style="flex:1;overflow:auto;padding:16px 20px">
          <pre id="uau-payload-json" style="font-size:11px;line-height:1.6;color:var(--text1);background:var(--bg2);padding:14px 16px;border-radius:8px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0">${json.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
        </div>
        <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end">
          <button id="uau-payload-copy" class="btn btn-o" style="font-size:12px">📋 Copiar JSON</button>
          <button id="uau-payload-fechar" class="btn btn-o" style="font-size:12px">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const _fechar = () => modal.remove();
    modal.querySelector('#uau-payload-x').onclick      = _fechar;
    modal.querySelector('#uau-payload-fechar').onclick = _fechar;
    modal.addEventListener('click', e => { if (e.target === modal) _fechar(); });

    modal.querySelector('#uau-payload-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(json);
        modal.querySelector('#uau-payload-copy').textContent = '✓ Copiado!';
        setTimeout(() => { modal.querySelector('#uau-payload-copy').textContent = '📋 Copiar JSON'; }, 2000);
      } catch { UI.toast('Não foi possível copiar', 'error'); }
    };
  },

  // ── Gerar processo de pagamento no UAU ─────────────────────────
  _gerarProcessoUAU(id, valorMedicao, periodo) {
    const fmtV = v => parseFloat(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    // Calcula data de vencimento sugerida: 30 dias a partir de hoje
    const hoje = new Date();
    const sugestao = new Date(hoje.setDate(hoje.getDate() + 30)).toISOString().slice(0,10);

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(2px)';
    modal.id = 'modal-gerar-processo-uau';
    modal.innerHTML = `<div class="md" style="max-width:440px;width:95%">
      <div class="mh"><div class="mh-title">💳 GERAR PROCESSO DE PAGAMENTO UAU</div><button class="mc-btn" onclick="this.closest('.mo').remove()">✕</button></div>
      <div class="mb" style="display:flex;flex-direction:column;gap:14px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:12px 14px;font-size:12px">
          <div style="color:var(--text3);margin-bottom:4px">Valor da medição</div>
          <div style="font-size:20px;font-weight:700;color:var(--blue)">R$ ${fmtV(valorMedicao)}</div>
          <div style="color:var(--text3);font-size:11px;margin-top:2px">Período: ${periodo||'—'}</div>
        </div>
        <div><label class="fl">Data de Vencimento <span style="color:var(--red)">*</span></label>
          <input class="fi" id="proc-vencimento" type="date" value="${sugestao}"></div>
        <div><label class="fl">Observação (opcional)</label>
          <input class="fi" id="proc-obs" placeholder="Ex: Medição de serviços de fundação"></div>
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 12px;font-size:11px;color:#92400e">
          ⚠️ Esta ação gera um processo de pagamento no UAU com <strong>1 parcela</strong> no valor total da medição. Verifique com o financeiro antes de prosseguir.
        </div>
      </div>
      <div class="mf">
        <button class="btn btn-o" onclick="this.closest('.mo').remove()">Cancelar</button>
        <button class="btn btn-a" id="btn-confirmar-processo" style="background:#7c3aed" onclick="Medicoes._confirmarProcessoUAU(${id})">💳 Confirmar e Gerar</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  },

  async _confirmarProcessoUAU(id) {
    const dataVencimento = H.el('proc-vencimento')?.value;
    const observacao     = H.el('proc-obs')?.value?.trim() || '';
    if (!dataVencimento) { UI.toast('Informe a data de vencimento.', 'error'); return; }

    const btn = H.el('btn-confirmar-processo');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando…'; }
    const token = localStorage.getItem('construtivo_token') || '';
    try {
      const r = await fetch('/api/uau/gerar-processo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ medicaoId: id, dataVencimento, observacao }),
      });
      const data = await r.json();
      document.getElementById('modal-gerar-processo-uau')?.remove();
      if (!data.ok) { UI.toast('Erro UAU: ' + data.error, 'error'); return; }
      const fmtV = v => v != null ? parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
      const fmtD = v => { try { return new Date(v).toLocaleDateString('pt-BR'); } catch { return v; } };
      UI.toast(`✅ Processo UAU Nº ${data.numeroProcesso ?? '—'} gerado — ${data.fornecedor||''} · R$ ${fmtV(data.total)} · venc. ${fmtD(dataVencimento)}`, 'success');
      // Reabre o detalhe para atualizar botões
      await Medicoes.openDetalhe(id);
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = '💳 Confirmar e Gerar'; }
      UI.toast('Erro ao gerar processo: ' + e.message, 'error');
    }
  },

  async marcarAssinado(id) {
    if(!confirm('Marcar esta medição como Assinada manualmente?\n\nUse esta opção apenas se o documento foi assinado fora do sistema ou quando o D4Sign está desabilitado.')) return;
    try {
      await API.marcarAssinado(id);
      UI.toast('Medição marcada como Assinada.', 'success');
      if(State.currentPage==='medicoes') await Pages.medicoes();
      if(State.currentPage==='acompanhamento') await Pages.acompanhamento();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async openDetalhe(id) {
    State.currentMedicaoId = id;
    try {
      const [m, assinCfg] = await Promise.all([
        API.medicao(id),
        API.config('assinatura').catch(() => null),
      ]);
      const assinaturaAtiva = !!(assinCfg?.valor?.ativo);
      const aprs = m.aprovacoes || [];
      const evids = m.evidencias || [];
      H.el('det-title').innerHTML = `<span class="cc" style="font-size:14px">${m.codigo}</span> ${H.tipoBadge(m.tipo)} ${H.statusBadge(m.status)}`;
      const stepState = (lv) => {
        const a = aprs.find(a => a.nivel === lv);
        if (a?.acao === 'reprovado') return 'rej';
        if (a?.acao === 'aprovado')  return 'done';
        if (a?.acao === 'pulado')    return 'skip';
        if (m.status === `Aguardando ${lv}`) return 'curr';
        return '';
      };
      H.el('det-body').innerHTML = `
        ${m.tipo === 'Adiantamento' ? `
        <div class="ibox warn" style="margin-bottom:16px;display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:22px">💰</span>
          <div>
            <div style="font-weight:700;margin-bottom:4px">Medição de Adiantamento Financeiro</div>
            <div style="font-size:12px;color:var(--text2)">
              Esta medição registra um pagamento antecipado de <strong>R$ ${H.fmt(m.valor_medicao)}</strong> ao fornecedor.
              Ela <strong>não avança o progresso físico</strong> da obra nem do cronograma.
              O descompasso financeiro-físico ficará registrado no contrato até ser compensado por uma <em>Medição de Avanço Físico</em>.
            </div>
          </div>
        </div>` : ''}
        ${m.tipo === 'Avanco_Fisico' ? `
        <div class="ibox info" style="margin-bottom:16px;display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:22px">📐</span>
          <div>
            <div style="font-weight:700;margin-bottom:4px">Medição de Avanço Físico</div>
            <div style="font-size:12px;color:var(--text2)">
              Esta medição registra a execução física da obra: <strong>${m.pct_mes||0}% neste período</strong>, acumulado <strong>${m.pct_total||0}%</strong>.
              Valor financeiro: R$ 0,00 (já adiantado anteriormente). Atualiza o cronograma e fecha o descompasso do contrato.
            </div>
          </div>
        </div>` : ''}
        <div style="margin-bottom:20px">
          <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text3);margin-bottom:12px">FLUXO DE APROVAÇÃO</div>
          <div class="aflow" style="max-width:480px">
            ${['N1','N2','N3'].map(lv => {
              const a  = aprs.find(a => a.nivel === lv);
              const sc = stepState(lv);
              const isPulado = a?.acao === 'pulado';
              const dot  = a?.acao === 'aprovado' ? '✓'
                         : a?.acao === 'reprovado' ? '✗'
                         : isPulado ? '—'
                         : lv;
              const nome = isPulado ? 'Não requerido'
                         : (a?.usuario || 'Aguardando');
              const data = (a && !isPulado) ? H.fmtDateShort(a.data_hora) : '—';
              return `<div class="afstep ${sc}">
                <div class="afdot">${dot}</div>
                <div class="af-lbl">${lv}</div>
                <div class="af-name">${nome}</div>
                <div class="af-date">${data}</div>
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
              ${m.uau_medicao_id != null ? `<div style="grid-column:1/-1"><div class="ii-lbl">Integração ERP UAU</div><div class="ii-val" style="display:flex;align-items:center;gap:6px"><span style="display:inline-flex;align-items:center;gap:5px;background:#dcfce7;color:#166534;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600">✓ Integrado · Medição UAU Nº ${m.uau_medicao_id}</span><span style="font-size:10px;color:var(--text3)">${m.uau_integrado_em ? H.fmtDate(m.uau_integrado_em) : ''}</span></div></div>` : (m.status === 'Aprovado' ? `<div style="grid-column:1/-1"><div class="ii-lbl">Integração ERP UAU</div><div class="ii-val"><span style="display:inline-flex;align-items:center;gap:5px;background:#fef9c3;color:#854d0e;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600">⏳ Pendente de integração</span></div></div>` : '')}
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
            ${Medicoes._buildEvidenciasTab(evids, id, m.status)}
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
      const canEnviarAssin   = ['Aprovado','Em Assinatura'].includes(m.status) && Perm.has('enviarAssinatura') && assinaturaAtiva;
      const canMarcarAssinado= m.status === 'Em Assinatura' && !assinaturaAtiva && Perm.has('enviarAssinatura');
      const canReabrir       = m.status === 'Reprovado' && Perm.has('criarMedicao');
      // Botão de integração UAU: visível para aprovadores/ADM quando status=Aprovado e ainda não integrado
      const canIntegrarUAU   = m.status === 'Aprovado' && m.uau_medicao_id == null && (Perm.has('aprovarN3') || State.user?.role === 'ADM');
      const canStatusUAU     = m.uau_medicao_id != null;
      H.el('det-footer').innerHTML = `
        ${canIntegrarUAU ? `<div id="uau-integrar-feedback" style="display:none;width:100%;margin-bottom:8px;padding:10px 14px;border-radius:6px;font-size:12px;line-height:1.5;border:1px solid transparent"></div>` : ''}
        <button class="btn btn-o" onclick="UI.closeModal('modal-detalhe')">Fechar</button>
        ${canReabrir       ? `<button class="btn btn-a" style="background:var(--orange,#f59e0b)" onclick="UI.closeModal('modal-detalhe');Medicoes.reabrir(${id})">↩ Reabrir</button>` : ''}
        ${canMarcarAssinado? `<button class="btn btn-a" style="background:var(--teal)" onclick="UI.closeModal('modal-detalhe');Medicoes.marcarAssinado(${id})">✍ Marcar como Assinado</button>` : ''}
        ${canEnviarAssin   ? `<button class="btn btn-a" style="background:var(--teal)" onclick="UI.closeModal('modal-detalhe');Medicoes.openEnviarAssinatura(${id})">✍ Enviar para Assinatura</button>` : ''}
        ${canStatusUAU     ? `<button class="btn btn-o" onclick="Medicoes._statusUAU(${id})">🔄 Status UAU</button>` : ''}
        ${canIntegrarUAU   ? `<button class="btn btn-a" id="btn-integrar-uau-${id}" style="background:#16a34a" onclick="Medicoes.integrarUAU(${id})">🔗 Integrar ao UAU</button>` : ''}
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

      // Pré-preenche dados do fornecedor (incluindo CPF e data de nascimento do cadastro)
      H.el('assin-codigo').textContent   = m.codigo;
      H.el('assin-email-forn').value     = m.fornecedor_email || '';
      H.el('assin-tel-forn').value       = m.fornecedor_tel || '';
      H.el('assin-email-rem').value      = '';
      // CPF e data de nascimento — pré-preenchidos do cadastro do fornecedor
      const cpfFornEl  = H.el('assin-cpf-forn');
      const nascFornEl = H.el('assin-nasc-forn');
      const cpfRemEl   = H.el('assin-cpf-rem');
      const nascRemEl  = H.el('assin-nasc-rem');
      if (cpfFornEl)  cpfFornEl.value  = m.fornecedor_cpf || '';
      if (nascFornEl) nascFornEl.value = m.fornecedor_data_nasc
        ? m.fornecedor_data_nasc.slice(0,10) : '';
      if (cpfRemEl)  cpfRemEl.value  = '';
      if (nascRemEl) nascRemEl.value = '';

      // Reseta canais para padrão (e-mail ativo, whatsapp inativo)
      const chkEmail = H.el('assin-canal-email');
      const chkWpp   = H.el('assin-canal-whatsapp');
      if (chkEmail) chkEmail.checked = true;
      if (chkWpp)   chkWpp.checked   = false;
      this._onCanalChange();

      // Verifica configuração do provedor de assinatura e exibe status
      const platEl = H.el('assin-status-plat');
      if (platEl) {
        try {
          const cfg = await API.config('assinatura');
          const c   = cfg?.valor || {};
          const prov = c.provedor || 'ClickSign';

          // Detecta se o provedor está devidamente credenciado
          const temCredencial = prov === 'ClickSign'  ? !!c.accessToken
                              : prov === 'D4Sign'     ? !!c.d4Token
                              : prov === 'DocuSign'   ? !!c.apiKey
                              : prov === 'Autentique' ? !!c.apiKey
                              : !!c.apiKey;

          if (temCredencial && c.ativo) {
            const extra = prov === 'ClickSign' ? ` (${c.ambiente === 'producao' ? 'Produção' : 'Sandbox'})` : '';
            platEl.innerHTML = `<div class="ibox success" style="padding:8px 12px;display:flex;align-items:center;gap:8px">
              <span style="font-size:18px">✅</span>
              <div><div style="font-size:12px;font-weight:600;color:var(--green)">${prov} configurado${extra}</div>
              <div style="font-size:11px;color:var(--text3)">O documento será gerado em PDF e enviado automaticamente via ${prov}.</div></div>
            </div>`;
          } else if (temCredencial && !c.ativo) {
            platEl.innerHTML = `<div class="ibox warn" style="padding:8px 12px">
              <div style="font-size:12px;font-weight:600">⚠️ ${prov} configurado mas inativo</div>
              <div style="font-size:11px;color:var(--text3)">Ative a integração em Configurações → Assinatura Eletrônica para envio automático.</div>
            </div>`;
          } else {
            platEl.innerHTML = `<div class="ibox warn" style="padding:8px 12px">
              <div style="font-size:12px;font-weight:600">⚠️ ${prov} não configurado</div>
              <div style="font-size:11px;color:var(--text3)">Configure em Configurações → Assinatura Eletrônica. O envio registrará o documento mas não disparará o link de assinatura.</div>
            </div>`;
          }

          // ── Adapta o formulário conforme o provedor ─────────────────────
          const isD4 = prov === 'D4Sign';
          // CPF e nascimento são campos exclusivos do ClickSign
          const cpfForn = document.getElementById('assin-wrap-cpf-forn');
          const cpfRem  = document.getElementById('assin-wrap-cpf-rem');
          const hintCpf = document.getElementById('assin-hint-cpf-forn');
          if (cpfForn) cpfForn.style.display = isD4 ? 'none' : '';
          if (cpfRem)  cpfRem.style.display  = isD4 ? 'none' : '';
          if (hintCpf) hintCpf.style.display = isD4 ? 'none' : '';

          // Canal de entrega (WhatsApp) — apenas ClickSign
          // Para D4Sign, o envio de email é automático; telefone = SMS auth opcional
          const wrapCanal = document.getElementById('assin-wrap-canal');
          if (wrapCanal) wrapCanal.style.display = isD4 ? 'none' : '';

          // Para D4Sign: mostrar checkbox WhatsApp (oculto por padrão; campo de tel aparece ao marcar)
          const wrapWppD4 = document.getElementById('assin-wrap-wpp-d4');
          const chkWppD4  = document.getElementById('assin-canal-wpp-d4');
          const wrapTel   = document.getElementById('assin-wrap-tel');
          if (isD4) {
            if (wrapWppD4) wrapWppD4.style.display = '';
            if (chkWppD4)  chkWppD4.checked = false;
            if (wrapTel)   wrapTel.style.display = 'none'; // só aparece se checkbox marcado
          } else {
            if (wrapWppD4) wrapWppD4.style.display = 'none';
          }

          // Hint do segundo signatário
          const hintRem = document.getElementById('assin-hint-rem');
          if (hintRem) hintRem.textContent = isD4
            ? 'Se informado, será adicionado como Aprovador do documento na D4Sign.'
            : 'Caso informado, você receberá uma cópia da notificação.';

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

  _onWppD4Change() {
    const checked = document.getElementById('assin-canal-wpp-d4')?.checked;
    const wrapTel = document.getElementById('assin-wrap-tel');
    if (wrapTel) wrapTel.style.display = checked ? '' : 'none';
    if (!checked && document.getElementById('assin-tel-forn'))
      document.getElementById('assin-tel-forn').value = '';
  },

  _onCanalChange() {
    const email = H.el('assin-canal-email')?.checked;
    const wpp   = H.el('assin-canal-whatsapp')?.checked;
    // E-mail nunca é ocultado — provedor de assinatura exige como identificador do signatário
    // Para ClickSign: mostra WhatsApp quando checkbox marcado
    // Para D4Sign: campo de telefone já está sempre visível (SMS auth)
    const wTel = H.el('assin-wrap-tel');
    const canalVisivelParaClickSign = H.el('assin-wrap-canal');
    if (canalVisivelParaClickSign && canalVisivelParaClickSign.style.display !== 'none') {
      // Modo ClickSign — mostrar tel apenas se WhatsApp marcado
      if (wTel) wTel.style.display = wpp ? '' : 'none';
    }
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
    // ClickSign usa checkboxes de canal; D4Sign o painel de canal fica oculto
    const wrapCanal        = document.getElementById('assin-wrap-canal');
    const isD4SignForm     = wrapCanal && wrapCanal.style.display === 'none';
    const canalEmail       = H.el('assin-canal-email')?.checked ?? true;
    const canalWhatsapp    = H.el('assin-canal-whatsapp')?.checked ?? false;
    const wppD4Marcado     = H.el('assin-canal-wpp-d4')?.checked ?? false;

    const email_fornecedor    = H.el('assin-email-forn')?.value.trim() || '';
    // Telefone: ClickSign = campo do WhatsApp canal; D4Sign = checkbox WhatsApp separado
    const tel_fornecedor      = isD4SignForm
      ? (wppD4Marcado ? H.el('assin-tel-forn')?.value.trim() || '' : '')
      : (canalWhatsapp ? H.el('assin-tel-forn')?.value.trim() || '' : '');
    const email_remetente     = H.el('assin-email-rem')?.value.trim();
    const cpf_fornecedor      = H.el('assin-cpf-forn')?.value.trim() || '';
    const data_nasc_fornecedor= H.el('assin-nasc-forn')?.value || '';
    const cpf_remetente       = H.el('assin-cpf-rem')?.value.trim() || '';
    const data_nasc_remetente = H.el('assin-nasc-rem')?.value || '';

    // Validação
    if (!isD4SignForm && !canalEmail && !canalWhatsapp) { UI.toast('Selecione ao menos um canal de envio','error'); return; }
    if (!email_fornecedor) { UI.toast('Informe o e-mail do fornecedor (obrigatório para envio de assinatura)','error'); return; }
    if (!isD4SignForm && canalWhatsapp && !tel_fornecedor) { UI.toast('Informe o telefone / WhatsApp do fornecedor','error'); return; }
    if (isD4SignForm && wppD4Marcado && !tel_fornecedor)   { UI.toast('Informe o WhatsApp do fornecedor','error'); return; }

    const btn = H.el('assin-btn-enviar');
    btn.disabled = true;
    btn.textContent = '⏳ Enviando...';

    try {
      const canais = isD4SignForm ? ['email'] : [];
      if (!isD4SignForm && canalEmail)    canais.push('email');
      if (!isD4SignForm && canalWhatsapp) canais.push('whatsapp');

      const r = await API.enviarAssinatura(id, {
        email_fornecedor,
        tel_fornecedor,
        email_remetente,
        canais,
        cpf_fornecedor:       cpf_fornecedor       || undefined,
        data_nasc_fornecedor: data_nasc_fornecedor || undefined,
        cpf_remetente:        cpf_remetente        || undefined,
        data_nasc_remetente:  data_nasc_remetente  || undefined,
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
