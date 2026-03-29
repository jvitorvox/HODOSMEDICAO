const Pages = {
  async dashboard() {
    try {
      const [dash, meds] = await Promise.all([ API.dashboard(), API.medicoes() ]);
      State.cache.medicoes = meds;
      const mesAtual = new Date().toISOString().slice(0,7);
      H.el('dash-subtitle').textContent = `Visão geral · ${H.periodoLabel(mesAtual)}`;
      H.el('dash-stats').innerHTML = `
        <div class="sc" style="--sc-color:var(--accent)"><div class="sc-lbl">Medições no Mês</div><div class="sc-val">${dash.doMes}</div><div class="sc-sub">Total do período</div></div>
        <div class="sc" style="--sc-color:var(--yellow)"><div class="sc-lbl">Aguardando Aprovação</div><div class="sc-val" style="color:var(--yellow)">${dash.aguardando}</div><div class="sc-sub">Em alçada N1, N2 ou N3</div></div>
        <div class="sc" style="--sc-color:var(--green)"><div class="sc-lbl">Aprovadas</div><div class="sc-val" style="color:var(--green)">${dash.aprovadas}</div><div class="sc-sub">Aguardando assinatura</div></div>
        <div class="sc" style="--sc-color:var(--teal)"><div class="sc-lbl">Em Assinatura</div><div class="sc-val" style="color:var(--teal)">${dash.assinatura}</div><div class="sc-sub">Aguardando fornecedor</div></div>
        <div class="sc" style="--sc-color:var(--blue)"><div class="sc-lbl">Valor Total Mês</div><div class="sc-val" style="font-size:20px;padding-top:4px">R$</div><div class="sc-sub" style="font-size:15px;color:var(--text)">${H.fmt(dash.valorMes)}</div></div>
        <div class="sc" style="--sc-color:var(--accent2);cursor:default">
          <div class="sc-lbl">Progresso da Carteira</div>
          <div class="sc-val" style="font-size:28px;color:var(--accent2)">${dash.pctCarteira}%</div>
          <div style="margin-top:8px">
            <div style="height:4px;background:var(--surface3);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${Math.min(dash.pctCarteira,100)}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:2px;transition:width .5s"></div>
            </div>
          </div>
          <div class="sc-sub" style="margin-top:6px">${dash.totalContratos} contratos vigentes · R$ ${H.fmt(dash.valorExecutadoCarteira)} / R$ ${H.fmt(dash.valorTotalCarteira)}</div>
        </div>
      `;
      const recent = meds.slice(0, 8);
      H.el('dash-table').innerHTML = `
        <div class="tb-bar"><span class="tb-bar-title">MEDIÇÕES RECENTES</span><div style="flex:1"></div><button class="btn btn-o btn-sm" onclick="App.navigate('medicoes')">Ver todas →</button></div>
        <table><thead><tr><th>Código</th><th>Obra</th><th>Fornecedor</th><th>Período</th><th>% no Contrato</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody>${recent.map(m => {
          const pct = parseFloat(m.pct_desta_medicao_no_contrato) || 0;
          const pctDisplay = pct > 0
            ? H.progressBar(pct, pct >= 100 ? 'g' : '')
            : '<span style="font-size:10px;color:var(--text3)">—</span>';
          return `<tr>
          <td><span class="cc">${m.codigo}</span></td>
          <td class="tp">${m.obra_nome||'—'}</td>
          <td>${m.fornecedor_nome||'—'}</td>
          <td>${H.periodoLabel(m.periodo)}</td>
          <td>${pctDisplay}</td>
          <td style="font-family:var(--font-m);font-size:11px">R$ ${H.fmt(m.valor_medicao)}</td>
          <td>${H.statusBadge(m.status)}</td>
          <td><button class="btn btn-ghost btn-xs" onclick="Medicoes.openDetalhe(${m.id})">Detalhar</button></td>
        </tr>`;}).join('')}</tbody></table>
      `;
      // Painel de progresso por contrato
      const contratos = dash.progressoContratos || [];
      H.el('dash-carteira').innerHTML = contratos.length === 0 ? '' : `
        <div class="tc" style="margin-top:16px">
          <div class="tb-bar"><span class="tb-bar-title">PROGRESSO DA CARTEIRA DE CONTRATOS</span><div style="flex:1"></div><button class="btn btn-o btn-sm" onclick="App.navigate('cadastros')">Ver contratos →</button></div>
          <div style="padding:4px 0">
            ${contratos.map(c => {
              const pct = parseFloat(c.pct_executado) || 0;
              const isFull = pct >= 100;
              return `<div class="dash-cart-row">
                <div class="dash-cart-info">
                  <div class="dash-cart-title" title="${H.esc(c.objeto)}">${H.esc(c.numero)} — ${H.esc(c.objeto)}</div>
                  <div class="dash-cart-sub">${H.esc(c.fornecedor_nome||'—')} · ${H.esc(c.obra_nome)} · R$ ${H.fmt(c.valor_executado)} de R$ ${H.fmt(c.valor_total)}</div>
                </div>
                <div class="dash-cart-bar-wrap">
                  <div class="dash-cart-bar">
                    <div class="dash-cart-bar-fill${isFull?' full':''}" style="width:${Math.min(pct,100)}%"></div>
                  </div>
                  <div class="dash-cart-pct" style="color:${isFull?'var(--green)':'var(--text)'}">${pct}%</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
      const nb = H.el('nb-medicoes');
      if(dash.aguardando > 0) { nb.textContent = dash.aguardando; nb.style.display = 'inline'; } else { nb.style.display = 'none'; }
    } catch(e) { UI.toast('Erro ao carregar dashboard: ' + e.message, 'error'); }
  },

  async medicoes() {
    try {
      const [meds, empresas, alcadas] = await Promise.all([ API.medicoes(), API.empresas(), API.alcadas() ]);
      State.cache.medicoes = meds;
      State.cache.empresas = empresas;
      State.cache.alcadas = alcadas;
      const fe = H.el('med-filter-empresa');
      fe.innerHTML = '<option value="">Todas as empresas</option>' + empresas.map(e=>`<option value="${e.id}">${e.nome_fantasia||e.razao_social}</option>`).join('');
      const periodos = [...new Set(meds.map(m=>m.periodo))].sort().reverse();
      H.el('med-filter-periodo').innerHTML = '<option value="">Todos os períodos</option>' + periodos.map(p=>`<option value="${p}">${H.periodoLabel(p)}</option>`).join('');
      this._renderMedicoes(meds);
    } catch(e) { UI.toast('Erro ao carregar medições: ' + e.message, 'error'); }
  },

  async filterMedicoes() {
    const q = H.el('med-search').value.toLowerCase();
    const emp = H.el('med-filter-empresa').value;
    const st = H.el('med-filter-status').value;
    const per = H.el('med-filter-periodo').value;
    try {
      const filters = {};
      if(emp) filters.empresa_id = emp;
      if(st) filters.status = st;
      if(per) filters.periodo = per;
      let meds = await API.medicoes(filters);
      if(q) {
        meds = meds.filter(m =>
          m.codigo?.toLowerCase().includes(q) ||
          m.obra_nome?.toLowerCase().includes(q) ||
          m.fornecedor_nome?.toLowerCase().includes(q) ||
          m.contrato_numero?.toLowerCase().includes(q)
        );
      }
      this._renderMedicoes(meds);
    } catch(e) { UI.toast('Erro ao filtrar: ' + e.message, 'error'); }
  },

  _renderMedicoes(meds) {
    const tbody = H.el('med-tbody');
    if(!meds.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="10">Nenhuma medição encontrada</td></tr>'; return; }
    const u = State.user;
    tbody.innerHTML = meds.map(m => {
      const canA = H.canApprove(m.status, m);
      const canEdit = (m.status === 'Rascunho' || m.status === 'Reprovado') && (u.role === 'ADM' || m.criado_por === u.name);
      const tipoBadge = H.tipoBadge(m.tipo);
      const trClass   = m.tipo === 'Adiantamento' ? 'med-card-adt' : m.tipo === 'Avanco_Fisico' ? 'med-card-avfis' : '';
      return `<tr class="${trClass}">
        <td><span class="cc">${m.codigo}</span></td>
        <td style="font-size:11px">${m.empresa_nome||'—'}</td>
        <td class="tp">${m.obra_nome||'—'}</td>
        <td>${m.fornecedor_nome||'—'}</td>
        <td><span class="cc" style="font-size:10px">${m.contrato_numero||'—'}</span></td>
        <td>${H.periodoLabel(m.periodo)}</td>
        <td style="min-width:110px">
          ${(() => {
            if (m.tipo === 'Avanco_Fisico') {
              const pct = parseFloat(m.pct_total) || 0;
              return `<div class="pw"><div class="pb"><div class="pf" style="width:${Math.min(pct,100)}%;background:#3b82f6"></div></div><span class="pp" style="font-size:10px;color:#2563eb">${pct}%</span></div><div style="font-size:9px;color:var(--text3)">físico</div>`;
            }
            const pct = parseFloat(m.pct_desta_medicao_no_contrato) || 0;
            if(pct > 0) return `<div class="pw"><div class="pb"><div class="pf" style="width:${Math.min(pct,100)}%"></div></div><span class="pp" style="font-size:10px">${pct}%</span></div><div style="font-size:9px;color:var(--text3)">do contrato</div>`;
            return '<span style="font-size:10px;color:var(--text3)">—</span>';
          })()}
        </td>
        <td style="font-family:var(--font-m);font-size:11px">${m.tipo==='Avanco_Fisico'?'<span style="color:var(--text3)">R$ 0,00</span>':`R$ ${H.fmt(m.valor_medicao)}`}</td>
        <td>${tipoBadge} ${H.statusBadge(m.status)}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn btn-ghost btn-xs" onclick="Medicoes.openDetalhe(${m.id})">👁</button>
            ${canEdit ? `<button class="btn btn-b btn-xs" onclick="Medicoes.edit(${m.id})">✏</button>` : ''}
            ${canA && m.tipo !== 'Avanco_Fisico' ? `<button class="btn btn-g btn-xs" onclick="Medicoes.openAprovar(${m.id})">✓</button><button class="btn btn-r btn-xs" onclick="Medicoes.openReprovar(${m.id})">✗</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  },

  async acompanhamento() {
    try {
      const meds = await API.medicoes();
      const filter = H.el('acon-filter').value;
      const filtered = filter ? meds.filter(m => m.status === filter) : meds.filter(m => m.status !== 'Concluído' && m.status !== 'Rascunho');
      const counts = {};
      ['Aguardando N1','Aguardando N2','Aguardando N3','Em Assinatura','Reprovado','Aprovado'].forEach(s => counts[s] = meds.filter(m=>m.status===s).length);
      H.el('acon-summary').innerHTML = [
        ['Aguardando N1', counts['Aguardando N1'], 'var(--green)'],
        ['Aguardando N2', counts['Aguardando N2'], 'var(--blue)'],
        ['Aguardando N3', counts['Aguardando N3'], 'var(--purple)'],
        ['Em Assinatura', counts['Em Assinatura'], 'var(--teal)'],
        ['Reprovado', counts['Reprovado'], 'var(--red)'],
        ['Aprovado', counts['Aprovado'], 'var(--accent)'],
      ].map(([lbl,cnt,color]) => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:12px;text-align:center;cursor:pointer" onclick="document.getElementById('acon-filter').value='${lbl}';Pages.acompanhamento()">
        <div style="font-family:var(--font-d);font-size:26px;color:${color}">${cnt}</div>
        <div style="font-size:9px;color:var(--text3);letter-spacing:1px;margin-top:4px">${lbl.toUpperCase()}</div>
      </div>`).join('');
      if(!filtered.length) { H.el('acon-list').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">Nenhuma medição encontrada</div>'; return; }
      H.el('acon-list').innerHTML = filtered.map(m => {
        const aprs = m.aprovacoes || [];
        const n1 = aprs.find(a=>a.nivel==='N1');
        const n2 = aprs.find(a=>a.nivel==='N2');
        const n3 = aprs.find(a=>a.nivel==='N3');
        const statusClass = m.status === 'Reprovado' ? 'urgent' : (['Aguardando N1','Aguardando N2','Aguardando N3'].includes(m.status) ? 'warn-border' : '');
        const stepClass = (lv) => {
          const a = aprs.find(a=>a.nivel===lv);
          if(a?.acao === 'reprovado') return 'rej';
          if(a?.acao === 'aprovado') return 'done';
          if(m.status === `Aguardando ${lv}`) return 'curr';
          return '';
        };
        const comQuem = this._comQuem(m);
        const criado = new Date(m.criado_em);
        const diasDecorridos = Math.floor((new Date() - criado) / 86400000);
        const prazoMax = 10;
        const diasRestantes = prazoMax - diasDecorridos;
        const prazoHtml = diasRestantes < 0
          ? `<span style="color:var(--red);font-size:11px">⚠ Vencido ${Math.abs(diasRestantes)}d</span>`
          : diasRestantes <= 2
            ? `<span style="color:var(--yellow);font-size:11px">⚠ ${diasRestantes}d restante${diasRestantes!==1?'s':''}</span>`
            : `<span style="color:var(--green);font-size:11px">${diasRestantes}d</span>`;
        const pctMed = parseFloat(m.pct_desta_medicao_no_contrato) || 0;
        const vMed   = parseFloat(m.valor_medicao) || 0;
        const pctHtml = pctMed > 0
          ? `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
               <div style="font-size:16px;font-family:var(--font-m);font-weight:700;color:var(--accent)">${pctMed}%</div>
               <div style="font-size:10px;color:var(--text3)">do contrato<br>R$ ${H.fmt(vMed)}</div>
             </div>`
          : `<div style="font-size:11px;font-family:var(--font-m);color:var(--accent)">R$ ${H.fmt(vMed)}</div>`;
        return `<div class="tkcard ${statusClass}" onclick="Medicoes.openDetalhe(${m.id})">
          <div>
            <span class="cc" style="font-size:9px">${m.codigo}</span>
            <div class="tp" style="font-size:12px;margin-top:5px">${m.obra_nome||'—'}</div>
            <div style="font-size:10px;color:var(--text3)">${m.fornecedor_nome||'—'} · ${m.contrato_numero||'—'}</div>
            ${pctHtml}
          </div>
          <div>${H.statusBadge(m.status)}</div>
          <div>
            <div class="aflow">
              ${['N1','N2','N3'].map(lv => `<div class="afstep ${stepClass(lv)}">
                <div class="afdot">${aprs.find(a=>a.nivel===lv&&a.acao==='aprovado')?'✓':aprs.find(a=>a.nivel===lv&&a.acao==='reprovado')?'✗':lv}</div>
                <div class="af-lbl">${lv}</div>
                <div class="af-date">${aprs.find(a=>a.nivel===lv)?H.fmtDateShort(aprs.find(a=>a.nivel===lv).data_hora):'—'}</div>
              </div>`).join('')}
            </div>
          </div>
          <div><div style="font-size:11px;color:var(--text);font-weight:500">${comQuem.nome}</div><div style="font-size:10px;color:var(--text3)">${comQuem.cargo}</div><div style="font-size:10px;color:var(--blue);margin-top:2px">${comQuem.email}</div></div>
          <div>${prazoHtml}<div style="font-size:10px;color:var(--text3)">desde ${H.fmtDateShort(m.criado_em)}</div></div>
        </div>`;
      }).join('');
    } catch(e) { UI.toast('Erro ao carregar acompanhamento: ' + e.message, 'error'); }
  },

  _comQuem(m) {
    const map = {
      'Aguardando N1': { nome:'Gestor de Obra', cargo:'Aprovação N1', email:'gestores@hamoa.com.br' },
      'Aguardando N2': { nome:'Planejamento', cargo:'Aprovação N2', email:'planejamento@hamoa.com.br' },
      'Aguardando N3': { nome:'Diretoria de Obras', cargo:'Aprovação N3', email:'diretoria@hamoa.com.br' },
      'Em Assinatura': { nome:'Assinatura Eletrônica', cargo:'Aguardando fornecedor', email:'' },
      'Aprovado':      { nome:'Financeiro/Contábil', cargo:'Emissão de NF', email:'financeiro@hamoa.com.br' },
      'Reprovado':     { nome:m.criado_por||'—', cargo:'Retornado ao lançador', email:'' },
      'Concluído':     { nome:'—', cargo:'Processo concluído', email:'' },
    };
    return map[m.status] || { nome:'—', cargo:'—', email:'' };
  },

  async cadastros(tab) {
    const active = tab || document.querySelector('#cad-tabs .tab.active')?.dataset.cad || 'empresas';
    document.querySelectorAll('#cad-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.cad === active));
    const loaders = { empresas: this._cadEmpresas, obras: this._cadObras, fornecedores: this._cadFornecedores, contratos: this._cadContratos };
    if(loaders[active]) await loaders[active]();
  },

  async _cadEmpresas() {
    try {
      const data = await API.empresas(); State.cache.empresas = data;
      H.el('cad-content').innerHTML = `
        <div class="tc">
          <div class="tb-bar"><span class="tb-bar-title">EMPRESAS</span><div style="flex:1"></div><button class="btn btn-a btn-sm" onclick="Cadastros.newEmpresa()">+ Empresa</button></div>
          <table><thead><tr><th>Razão Social</th><th>Nome Fantasia</th><th>CNPJ</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${data.length ? data.map(e => `<tr>
            <td class="tp">${e.razao_social}</td><td>${e.nome_fantasia||'—'}</td>
            <td style="font-family:var(--font-m);font-size:11px">${e.cnpj}</td>
            <td>${e.ativo ? '<span class="badge b-ativo">Ativo</span>' : '<span class="badge b-inativo">Inativo</span>'}</td>
            <td><div style="display:flex;gap:4px"><button class="btn btn-ghost btn-xs" onclick="Cadastros.editEmpresa(${e.id})">✏ Editar</button><button class="btn btn-r btn-xs" onclick="Cadastros.deleteEmpresa(${e.id})">🗑</button></div></td>
          </tr>`).join('') : '<tr class="empty-row"><td colspan="5">Nenhuma empresa cadastrada</td></tr>'}</tbody></table>
        </div>`;
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async _cadObras() {
    try {
      const [data, emps] = await Promise.all([ API.obras(), API.empresas() ]); State.cache.obras = data; State.cache.empresas = emps;
      H.el('cad-content').innerHTML = `
        <div class="tc">
          <div class="tb-bar"><span class="tb-bar-title">OBRAS</span><div style="flex:1"></div><button class="btn btn-a btn-sm" onclick="Cadastros.newObra()">+ Obra</button></div>
          <table><thead><tr><th>Código</th><th>Empresa</th><th>Nome da Obra</th><th>Localização</th><th>Gestor</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${data.length ? data.map(o => {
            const emp = emps.find(e=>e.id===o.empresa_id);
            return `<tr>
              <td><span class="cc">${o.codigo}</span></td>
              <td style="font-size:11px">${o.empresa_nome||emp?.nome_fantasia||'—'}</td>
              <td class="tp">${o.nome}</td><td>${o.localizacao||'—'}</td><td>${o.gestor||'—'}</td>
              <td>${H.statusBadgeCad(o.status)}</td>
              <td><div style="display:flex;gap:4px"><button class="btn btn-ghost btn-xs" onclick="Cadastros.editObra(${o.id})">✏ Editar</button><button class="btn btn-r btn-xs" onclick="Cadastros.deleteObra(${o.id})">🗑</button></div></td>
            </tr>`;
          }).join('') : '<tr class="empty-row"><td colspan="7">Nenhuma obra cadastrada</td></tr>'}</tbody></table>
        </div>`;
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async _cadFornecedores() {
    try {
      const data = await API.fornecedores(); State.cache.fornecedores = data;
      H.el('cad-content').innerHTML = `
        <div class="tc">
          <div class="tb-bar"><span class="tb-bar-title">FORNECEDORES</span><div style="flex:1"></div><button class="btn btn-a btn-sm" onclick="Cadastros.newFornecedor()">+ Fornecedor</button></div>
          <table><thead><tr><th>Razão Social</th><th>CNPJ</th><th>E-mail Contato</th><th>E-mail NF</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${data.length ? data.map(f => `<tr>
            <td class="tp">${f.razao_social}<br><span style="font-size:10px;color:var(--text3)">${f.nome_fantasia||''}</span></td>
            <td style="font-family:var(--font-m);font-size:11px">${f.cnpj}</td>
            <td style="font-size:11px">${f.email||'—'}</td>
            <td style="font-size:11px">${f.email_nf||'—'}</td>
            <td>${f.ativo ? '<span class="badge b-ativo">Ativo</span>' : '<span class="badge b-inativo">Inativo</span>'}</td>
            <td><div style="display:flex;gap:4px"><button class="btn btn-ghost btn-xs" onclick="Cadastros.editFornecedor(${f.id})">✏</button><button class="btn btn-r btn-xs" onclick="Cadastros.deleteFornecedor(${f.id})">🗑</button></div></td>
          </tr>`).join('') : '<tr class="empty-row"><td colspan="6">Nenhum fornecedor cadastrado</td></tr>'}</tbody></table>
        </div>`;
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async _cadContratos() {
    try {
      const [data, obras, forns] = await Promise.all([ API.contratos(), API.obras(), API.fornecedores() ]); State.cache.contratos = data;
      H.el('cad-content').innerHTML = `
        <div class="tc">
          <div class="tb-bar"><span class="tb-bar-title">CONTRATOS</span><div style="flex:1"></div><button class="btn btn-a btn-sm" onclick="Cadastros.newContrato()">+ Contrato</button></div>
          <table><thead><tr><th>Nº</th><th>Empresa/Obra</th><th>Fornecedor</th><th>Objeto</th><th>Valor Total</th><th>Financeiro / Físico</th><th>Descompasso</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${data.length ? data.map(c => {
            const pct      = parseFloat(c.pct_executado_real) || 0;
            const pctFis   = parseFloat(c.pct_fisico_executado) || 0;
            const vTot     = parseFloat(c.valor_total) || 0;
            const vFin     = parseFloat(c.total_financeiro_pago) || 0;
            const vAdt     = parseFloat(c.total_adiantado) || 0;
            const dsc      = parseFloat(c.descompasso) || 0;
            const temDsc   = vAdt > 0 && dsc > 100; // descompasso relevante (> R$100)
            return `<tr style="${temDsc?'background:rgba(245,158,11,.04)':''}">
              <td><span class="cc">${c.numero}</span></td>
              <td class="tp" style="font-size:11px">${c.obra_nome||'—'}<br><span style="color:var(--text3);font-size:10px">${c.empresa_nome||''}</span></td>
              <td style="font-size:11px">${c.fornecedor_nome||'—'}</td>
              <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.objeto}">${c.objeto}</td>
              <td style="font-family:var(--font-m);font-size:11px;white-space:nowrap">R$ ${H.fmt(vTot)}</td>
              <td style="min-width:140px">
                <div style="font-size:10px;color:var(--text3);margin-bottom:2px">
                  💰 R$ ${H.fmt(vFin)} <span style="color:var(--text3)">· ${pct}%</span>
                </div>
                <div class="pw" style="margin-bottom:2px">
                  <div class="pb" style="height:5px">
                    <div class="pf" style="width:${Math.min(pct,100)}%;height:100%"></div>
                  </div>
                </div>
                ${pctFis !== pct ? `<div style="font-size:10px;color:#2563eb">📐 ${pctFis}% físico</div>` : ''}
              </td>
              <td style="min-width:110px">
                ${temDsc
                  ? `<div style="display:flex;flex-direction:column;gap:3px">
                      <span style="font-size:10px;font-weight:700;color:#d97706">⚠️ R$ ${H.fmt(dsc)}</span>
                      <button class="btn btn-xs" style="font-size:9px;padding:2px 6px;background:rgba(245,158,11,.15);color:#d97706;border:1px solid rgba(245,158,11,.4)"
                        onclick="Medicoes.openNew();setTimeout(()=>{ const r=document.querySelector('input[name=mf-tipo][value=Avanco_Fisico]'); if(r){r.checked=true;Medicoes._onTipoChange();} },400)">
                        📐 Registrar Avanço Físico
                      </button>
                    </div>`
                  : `<span style="font-size:10px;color:var(--green)">✓ OK</span>`}
              </td>
              <td>${H.statusBadgeCad(c.status)}</td>
              <td><div style="display:flex;gap:4px"><button class="btn btn-ghost btn-xs" onclick="Cadastros.editContrato(${c.id})">✏</button><button class="btn btn-r btn-xs" onclick="Cadastros.deleteContrato(${c.id})">🗑</button></div></td>
            </tr>`;
          }).join('') : '<tr class="empty-row"><td colspan="9">Nenhum contrato cadastrado</td></tr>'}</tbody></table>
        </div>`;
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async alcadas() {
    try {
      const [data, emps, obras] = await Promise.all([ API.alcadas(), API.empresas(), API.obras() ]); State.cache.alcadas = data;
      if(!data.length) { H.el('alcadas-list').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">Nenhuma configuração de alçada cadastrada.<br><button class="btn btn-a btn-sm" style="margin-top:12px" onclick="Alcadas.newAlcada()">+ Criar configuração</button></div>'; return; }
      H.el('alcadas-list').innerHTML = data.map(a => {
        const emp = emps.find(e=>e.id===a.empresa_id);
        const obra = obras.find(o=>o.id===a.obra_id);
        return `<div class="accard">
          <div class="accard-header">
            <div>
              <div style="font-size:14px;font-weight:600;color:var(--text)">${a.nome}</div>
              <div style="font-size:10px;color:var(--text3);margin-top:2px">
                🏢 ${emp?.nome_fantasia||emp?.razao_social||'—'}
                ${obra ? `· 🏗 ${obra.nome}` : '· <em>Todas as obras</em>'}
              </div>
            </div>
            <div style="margin-left:auto;display:flex;gap:6px">
              ${a.ativo ? '<span class="badge b-ativo">Ativo</span>' : '<span class="badge b-inativo">Inativo</span>'}
              <button class="btn btn-o btn-xs" onclick="Alcadas.edit(${a.id})">✏ Editar</button>
              <button class="btn btn-r btn-xs" onclick="Alcadas.delete(${a.id})">🗑</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
            ${[['N1','acN1',a.n1_titulo,a.n1_grupos,a.n1_prazo],['N2','acN2',a.n2_titulo,a.n2_grupos,a.n2_prazo],['N3','acN3',a.n3_titulo,a.n3_grupos,a.n3_prazo]].map(([lv,cls,titulo,grupos,prazo]) => `
            <div style="background:var(--surface3);border-radius:var(--r);padding:12px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <div class="aclvl ${cls}" style="width:28px;height:28px;font-size:14px">${lv}</div>
                <div><div style="font-size:11px;font-weight:600;color:var(--text)">${titulo||lv}</div><div style="font-size:9px;color:var(--text3)">${prazo} dias úteis</div></div>
              </div>
              <div>${(grupos||[]).map(g=>`<span class="adtag" style="font-size:9px">${g}</span>`).join('')}</div>
            </div>`).join('')}
          </div>
          ${a.escalonamento ? `<div style="font-size:10px;color:var(--text3);margin-top:10px;display:flex;align-items:center;gap:6px"><span style="color:var(--yellow)">⚡</span> Escalonamento ativo: alerta em ${a.escalonamento_dias} dias sem resposta</div>` : ''}
        </div>`;
      }).join('');
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async configuracoes(section) {
    const active = section || document.querySelector('.cfg-menu-item.active')?.dataset.cfg || 'ldap';
    document.querySelectorAll('.cfg-menu-item').forEach(i => i.classList.toggle('active', i.dataset.cfg === active));
    const loaders = { ldap: Configs.ldap, assinatura: Configs.assinatura, permissoes: Configs.permissoes, notificacoes: Configs.notificacoes, geral: Configs.geral, ia: Configs.ia, backup: Configs.backup };
    if(loaders[active]) await loaders[active]();
  },
};

// ══════════════════════════════════════
// MEDIÇÕES
// ══════════════════════════════════════
