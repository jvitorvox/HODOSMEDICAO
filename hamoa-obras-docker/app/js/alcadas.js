const Alcadas = {
  async edit(id) {
    State.editingId = id;
    const a = State.cache.alcadas.find(x=>x.id===id) || (await API.alcadas()).find(x=>x.id===id);
    H.el('alc-title').textContent = `✏ EDITAR ALÇADA · ${a.nome}`;
    H.el('alc-body').innerHTML = await this._buildForm(a);
    UI.openModal('modal-alcada');
  },
  async newAlcada() {
    State.editingId = null;
    H.el('alc-title').textContent = '⚡ NOVA CONFIGURAÇÃO DE ALÇADA';
    H.el('alc-body').innerHTML = await this._buildForm(null);
    UI.openModal('modal-alcada');
  },
  async _buildForm(a) {
    const [emps, obras] = await Promise.all([ API.empresas(), API.obras() ]);
    const obrasFilt = a ? obras.filter(o=>o.empresa_id===a.empresa_id) : obras;
    const tagInputHtml = (id, groups) => `
      <div class="tag-input-wrap" id="${id}-wrap" onclick="document.getElementById('${id}-input').focus()">
        ${(groups||[]).map(g=>`<span class="adtag">${g}<span class="adtag-rm" onclick="Alcadas.removeTag(this,'${id}')">×</span></span>`).join('')}
        <input class="tag-input" id="${id}-input" placeholder="Grupo do AD..." onkeydown="Alcadas.addTag(event,'${id}')">
      </div>
      <div class="hint">Pressione Enter para adicionar grupo</div>`;
    return `
    <div class="fgrid">
      <div class="fg cs2"><label class="fl">Nome da Configuração *</label><input class="fi" id="alc-nome" value="${a?.nome||''}" placeholder="Ex: Padrão HAMOA Ltda"></div>
      <div class="fg"><label class="fl">Empresa *</label>
        <select class="fi fsel" id="alc-empresa" onchange="Alcadas._loadObras()">
          <option value="">Selecione...</option>${emps.map(e=>`<option value="${e.id}" ${a?.empresa_id===e.id?'selected':''}>${e.nome_fantasia||e.razao_social}</option>`).join('')}
        </select></div>
      <div class="fg"><label class="fl">Obra (deixe vazio para todas)</label>
        <select class="fi fsel" id="alc-obra">
          <option value="">Todas as obras da empresa</option>${obrasFilt.map(o=>`<option value="${o.id}" ${a?.obra_id===o.id?'selected':''}>${o.nome}</option>`).join('')}
        </select></div>
    </div>
    <div class="divider"></div>
    ${[['N1','acN1','n1',a?.n1_titulo||'Gestor de Obra',a?.n1_grupos,a?.n1_prazo||3],['N2','acN2','n2',a?.n2_titulo||'Planejamento',a?.n2_grupos,a?.n2_prazo||2],['N3','acN3','n3',a?.n3_titulo||'Diretor de Obras',a?.n3_grupos,a?.n3_prazo||5]].map(([lv,cls,pfx,titulo,grupos,prazo])=>`
    <div class="accard">
      <div class="accard-header">
        <div class="aclvl ${cls}">${lv}</div>
        <div><div class="ac-title">${lv} · Configuração</div></div>
      </div>
      <div class="fgrid">
        <div class="fg"><label class="fl">Título do Cargo</label><input class="fi" id="alc-${pfx}-titulo" value="${titulo}" placeholder="Ex: Gestor de Obra"></div>
        <div class="fg"><label class="fl">Prazo de Resposta (dias úteis)</label><input class="fi" type="number" id="alc-${pfx}-prazo" min="1" max="30" value="${prazo}"></div>
        <div class="fg cs2"><label class="fl">Grupos do Active Directory</label>${tagInputHtml(`alc-${pfx}-grupos`, grupos)}</div>
      </div>
    </div>`).join('')}
    <div class="divider"></div>
    <div class="fgrid">
      <div class="fg"><label class="fl" style="margin-bottom:10px">Escalonamento por prazo</label>
        <label class="sw" id="alc-esc-sw" onclick="this.querySelector('.sw-tr').classList.toggle('on');document.getElementById('alc-esc-dias').disabled=!this.querySelector('.sw-tr.on')">
          <div class="sw-tr ${a?.escalonamento?'on':''}" ><div class="sw-th"></div></div> Ativar escalonamento automático
        </label></div>
      <div class="fg"><label class="fl">Notificar superior após N dias sem resposta</label>
        <input class="fi" type="number" id="alc-esc-dias" value="${a?.escalonamento_dias||2}" min="1" ${a?.escalonamento?'':'disabled'}></div>
      <div class="fg cs2"><label class="fl">E-mail cópia (escalonamento)</label>
        <input class="fi" id="alc-email-copia" value="${a?.email_copia||''}" placeholder="email@empresa.com.br"></div>
    </div>`;
  },
  async _loadObras() {
    const empId = parseInt(H.el('alc-empresa').value);
    const obras = await API.obras(empId);
    H.el('alc-obra').innerHTML = '<option value="">Todas as obras da empresa</option>' + obras.map(o=>`<option value="${o.id}">${o.nome}</option>`).join('');
  },
  addTag(e, id) {
    if(e.key !== 'Enter') return; e.preventDefault();
    const input = H.el(id+'-input'); const val = input.value.trim();
    if(!val) return;
    const wrap = H.el(id+'-wrap');
    const span = document.createElement('span');
    span.className = 'adtag';
    span.innerHTML = `${val}<span class="adtag-rm" onclick="Alcadas.removeTag(this,'${id}')">×</span>`;
    wrap.insertBefore(span, input); input.value = '';
  },
  removeTag(el, id) { el.closest('.adtag').remove(); },
  _getTags(id) { return [...(H.el(id+'-wrap')?.querySelectorAll('.adtag')||[])].map(s=>s.childNodes[0].textContent.trim()).filter(Boolean); },
  async save() {
    const nome = H.el('alc-nome')?.value.trim();
    const empresa_id = parseInt(H.el('alc-empresa')?.value);
    if(!nome||!empresa_id){UI.toast('Nome e Empresa são obrigatórios','error');return;}
    const data = {
      nome, empresa_id, obra_id: parseInt(H.el('alc-obra')?.value)||null,
      n1_titulo:H.el('alc-n1-titulo')?.value, n1_grupos:this._getTags('alc-n1-grupos'), n1_prazo:parseInt(H.el('alc-n1-prazo')?.value)||3,
      n2_titulo:H.el('alc-n2-titulo')?.value, n2_grupos:this._getTags('alc-n2-grupos'), n2_prazo:parseInt(H.el('alc-n2-prazo')?.value)||2,
      n3_titulo:H.el('alc-n3-titulo')?.value, n3_grupos:this._getTags('alc-n3-grupos'), n3_prazo:parseInt(H.el('alc-n3-prazo')?.value)||5,
      escalonamento:!!H.el('alc-esc-sw')?.querySelector('.sw-tr.on'),
      escalonamento_dias:parseInt(H.el('alc-esc-dias')?.value)||2,
      email_copia:H.el('alc-email-copia')?.value||'',
      ativo: true,
    };
    try {
      if(State.editingId) await API.updateAlcada(State.editingId, data);
      else await API.createAlcada(data);
      UI.closeModal('modal-alcada'); UI.toast('Configuração de alçada salva com sucesso','success'); await Pages.alcadas();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },
  async delete(id) {
    if(!confirm('Excluir configuração de alçada?')) return;
    try { await API.deleteAlcada(id); UI.toast('Configuração excluída'); await Pages.alcadas(); } catch(e){UI.toast('Erro: '+e.message,'error');}
  },
};

// ══════════════════════════════════════
// CONFIGURAÇÕES
// ══════════════════════════════════════
const Configs = {
  async ldap() {
    const cfg = await API.config('ldap').catch(()=>null);
    const c = cfg ? cfg.valor : {};
    H.el('cfg-content').innerHTML = `
    <div style="margin-bottom:18px">
      <div style="font-family:var(--font-d);font-size:22px;letter-spacing:2px;color:var(--text)">AUTENTICAÇÃO LDAP / ACTIVE DIRECTORY</div>
      <div style="font-size:11px;color:var(--text3);margin-top:5px">Configure a conexão com o servidor LDAP/AD para autenticação dos usuários do sistema</div>
    </div>
    <div class="ibox info" style="margin-bottom:18px">
      <div class="ibox-title">🔒 Servidor: ${c.servidor||'Não configurado'} · Status: ${c.ativo?'<span style="color:var(--green)">Ativo ✓</span>':'<span style="color:var(--red)">Desativado</span>'}</div>
    </div>
    <div class="fsec"><div class="fsec-title">CONEXÃO COM SERVIDOR</div>
    <div class="fgrid">
      <div class="fg"><label class="fl">Servidor LDAP/AD *</label><input class="fi" id="cfg-ldap-srv" value="${c.servidor||''}" placeholder="dc01.empresa.local"></div>
      <div class="fg"><label class="fl">Domínio *</label><input class="fi" id="cfg-ldap-dom" value="${c.dominio||''}" placeholder="EMPRESA"></div>
      <div class="fg"><label class="fl">Porta LDAP</label><input class="fi" id="cfg-ldap-porta" value="${c.porta||'389'}"></div>
      <div class="fg"><label class="fl">Porta LDAPS (SSL)</label><input class="fi" id="cfg-ldap-portassl" value="${c.portaSSL||'636'}"></div>
      <div class="fg cs2"><label class="fl">Base DN *</label><input class="fi" id="cfg-ldap-basedn" value="${c.baseDN||''}" placeholder="DC=empresa,DC=local"></div>
    </div></div>
    <div class="fsec"><div class="fsec-title">CONTA DE SERVIÇO</div>
    <div class="fgrid">
      <div class="fg"><label class="fl">Usuário de Serviço *</label><input class="fi" id="cfg-ldap-svcuser" value="${c.usuarioServico||''}" placeholder="svc-hamoa@empresa.local"></div>
      <div class="fg"><label class="fl">Senha do Serviço</label><input class="fi" type="password" id="cfg-ldap-svcpass" value="" placeholder="••••••••"></div>
    </div></div>
    <div class="fsec"><div class="fsec-title">MAPEAMENTO DE ATRIBUTOS</div>
    <div class="fgrid fgrid3">
      <div class="fg"><label class="fl">Atributo Login</label><input class="fi" id="cfg-ldap-atr-login" value="${c.atributoLogin||'sAMAccountName'}"></div>
      <div class="fg"><label class="fl">Atributo Nome</label><input class="fi" id="cfg-ldap-atr-nome" value="${c.atributoNome||'displayName'}"></div>
      <div class="fg"><label class="fl">Atributo E-mail</label><input class="fi" id="cfg-ldap-atr-email" value="${c.atributoEmail||'mail'}"></div>
      <div class="fg"><label class="fl">Atributo Grupos</label><input class="fi" id="cfg-ldap-atr-grupos" value="${c.atributoGrupos||'memberOf'}"></div>
    </div></div>
    <div class="fsec"><div class="fsec-title">SEGURANÇA</div>
    <div style="display:flex;gap:20px;margin-bottom:14px">
      <label class="sw" id="sw-ssl" onclick="this.querySelector('.sw-tr').classList.toggle('on')"><div class="sw-tr ${c.ssl?'on':''}"><div class="sw-th"></div></div> Usar SSL/LDAPS</label>
      <label class="sw" id="sw-tls" onclick="this.querySelector('.sw-tr').classList.toggle('on')"><div class="sw-tr ${c.starttls?'on':''}"><div class="sw-th"></div></div> Usar StartTLS</label>
      <label class="sw" id="sw-ldap-ativo" onclick="this.querySelector('.sw-tr').classList.toggle('on')"><div class="sw-tr ${c.ativo?'on':''}"><div class="sw-th"></div></div> Integração ativa</label>
    </div></div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-o" onclick="Configs._testLDAP()">🔍 Testar Conexão</button>
      <button class="btn btn-a" onclick="Configs._saveLDAP()">💾 Salvar Configuração LDAP</button>
    </div>`;
  },
  async _saveLDAP() {
    const data = { servidor:H.el('cfg-ldap-srv').value.trim(), dominio:H.el('cfg-ldap-dom').value.trim(), porta:H.el('cfg-ldap-porta').value, portaSSL:H.el('cfg-ldap-portassl').value, baseDN:H.el('cfg-ldap-basedn').value.trim(), usuarioServico:H.el('cfg-ldap-svcuser').value.trim(), senhaServico:H.el('cfg-ldap-svcpass').value, atributoLogin:H.el('cfg-ldap-atr-login').value||'sAMAccountName', atributoNome:H.el('cfg-ldap-atr-nome').value||'displayName', atributoEmail:H.el('cfg-ldap-atr-email').value||'mail', atributoGrupos:H.el('cfg-ldap-atr-grupos').value||'memberOf', ssl:!!H.el('sw-ssl')?.querySelector('.sw-tr.on'), starttls:!!H.el('sw-tls')?.querySelector('.sw-tr.on'), ativo:!!H.el('sw-ldap-ativo')?.querySelector('.sw-tr.on') };
    try { await API.saveConfig('ldap', data); UI.toast('Configuração LDAP salva com sucesso','success'); } catch(e){UI.toast('Erro: '+e.message,'error');}
  },
  async _testLDAP() {
    const srv = H.el('cfg-ldap-srv')?.value.trim();
    if(!srv) { UI.toast('Informe o servidor LDAP antes de testar','error'); return; }
    const btn = document.querySelector('[onclick="Configs._testLDAP()"]');
    if(btn) { btn.disabled = true; btn.textContent = '⏳ Testando...'; }
    const cfg = {
      servidor:        srv,
      porta:           H.el('cfg-ldap-porta')?.value || '389',
      portaSSL:        H.el('cfg-ldap-portassl')?.value || '636',
      ssl:             !!H.el('sw-ssl')?.querySelector('.sw-tr.on'),
      usuarioServico:  H.el('cfg-ldap-svcuser')?.value.trim() || '',
      senhaServico:    H.el('cfg-ldap-svcpass')?.value || '',
    };
    try {
      const r = await API.testLdap(cfg);
      UI.toast('✓ ' + r.message, 'success');
    } catch(e) {
      UI.toast('✗ Falha: ' + e.message, 'error');
    } finally {
      if(btn) { btn.disabled = false; btn.textContent = '🔍 Testar Conexão'; }
    }
  },

  async assinatura() {
    const cfg = await API.config('assinatura').catch(()=>null);
    const c = cfg ? cfg.valor : {};
    const prov = c.provedor || 'ClickSign';
    const isClickSign = prov === 'ClickSign';
    const isD4Sign    = prov === 'D4Sign';

    H.el('cfg-content').innerHTML = `
    <div style="margin-bottom:18px">
      <div style="font-family:var(--font-d);font-size:22px;letter-spacing:2px;color:var(--text)">ASSINATURA ELETRÔNICA</div>
      <div style="font-size:12px;color:var(--text3);margin-top:4px">Integração com plataforma de assinatura para envio automático de documentos aos fornecedores após aprovação.</div>
    </div>

    <div class="ibox ${c.ativo?'success':'warn'}" style="margin-bottom:18px">
      <div class="ibox-title">${c.ativo?`✅ Integração ativa — ${prov}`:'⚠️ Integração desativada — configure e salve para ativar'}</div>
      ${c.ativo&&isClickSign?`<div class="ibox-text" style="font-size:11px">Ambiente: <b>${c.ambiente==='producao'?'Produção ✓':'Sandbox (testes)'}</b></div>`:''}
    </div>

    <div class="fsec">
      <div class="fsec-title">PROVEDOR DE ASSINATURA</div>
      <div class="fgrid">
        <div class="fg cs2">
          <label class="fl">Plataforma *</label>
          <select class="fi fsel" id="cfg-assin-prov" onchange="Configs._onProvChange()">
            ${['ClickSign','D4Sign','DocuSign','Autentique','Assine Online'].map(p=>`<option${prov===p?' selected':''}>${p}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <!-- ── ClickSign ─────────────────────────────────────────── -->
    <div id="cfg-assin-clicksign" style="display:${isClickSign?'block':'none'}">
      <div class="ibox" style="margin-bottom:14px;border-color:var(--accent2)">
        <div class="ibox-title" style="font-size:11px;color:var(--accent)">📋 Como obter seu Access Token</div>
        <div class="ibox-text" style="font-size:11px">
          1. Acesse <b>app.clicksign.com</b> → Configurações → Integrações → API<br>
          2. Copie o <b>Access Token</b> da sua conta<br>
          3. ⚠️ Token gerado em <b>app.clicksign.com</b> → use ambiente <b>Produção</b><br>
          &nbsp;&nbsp;&nbsp;&nbsp;Token gerado em <b>sandbox.clicksign.com</b> → use ambiente <b>Sandbox</b>
        </div>
      </div>
      <div class="fsec"><div class="fsec-title">CREDENCIAIS CLICKSIGN</div>
      <div class="fgrid">
        <div class="fg cs2">
          <label class="fl">Access Token *</label>
          <input class="fi" id="cfg-assin-token" value="${H.esc(c.accessToken||'')}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="font-family:var(--font-m)">
          <div class="hint">Token de autenticação — não compartilhe com ninguém</div>
        </div>
        <div class="fg cs2">
          <label class="fl">Ambiente</label>
          <div style="display:flex;gap:20px;margin-top:8px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
              <input type="radio" name="cfg-assin-amb" value="sandbox" ${c.ambiente==='sandbox'?'checked':''} style="accent-color:var(--accent)"> Sandbox (testes — sandbox.clicksign.com)
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
              <input type="radio" name="cfg-assin-amb" value="producao" ${(c.ambiente||'producao')==='producao'?'checked':''} style="accent-color:var(--green)"> Produção (app.clicksign.com)
            </label>
          </div>
          <div class="hint" style="color:var(--yellow)">⚠️ O token deve corresponder ao ambiente — token de produção não funciona no sandbox e vice-versa.</div>
        </div>
        <div class="fg cs2">
          <label class="fl">Pasta dos documentos no ClickSign</label>
          <input class="fi" id="cfg-assin-pasta" value="${H.esc(c.pasta||'/HAMOA/')}" placeholder="/HAMOA/">
          <div class="hint">Pasta onde os documentos serão organizados na sua conta ClickSign</div>
        </div>
      </div></div>
      <div style="display:flex;gap:10px;margin-top:4px;margin-bottom:16px">
        <button class="btn btn-o" id="btn-test-clicksign" onclick="Configs._testClickSign()">🔍 Testar Conexão</button>
        <div id="cfg-assin-test-result" style="font-size:12px;padding:6px 10px;border-radius:var(--r);display:none"></div>
      </div>
    </div>

    <!-- ── D4Sign ─────────────────────────────────────────────── -->
    <div id="cfg-assin-d4sign" style="display:${isD4Sign?'block':'none'}">
      <div class="fsec"><div class="fsec-title">CREDENCIAIS D4SIGN</div>
      <div class="fgrid">
        <div class="fg cs2"><label class="fl">Token (UUID do cofre) *</label><input class="fi" id="cfg-assin-d4token" value="${H.esc(c.d4Token||'')}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="font-family:var(--font-m)"></div>
        <div class="fg"><label class="fl">API Key *</label><input class="fi" id="cfg-assin-d4apikey" value="${H.esc(c.d4ApiKey||'')}" placeholder="API Key"></div>
        <div class="fg"><label class="fl">Crypt Key</label><input class="fi" type="password" id="cfg-assin-d4cryptkey" placeholder="••••••••"></div>
      </div></div>
    </div>

    <!-- ── Outros provedores ──────────────────────────────────── -->
    <div id="cfg-assin-outros" style="display:${!isClickSign&&!isD4Sign?'block':'none'}">
      <div class="fsec"><div class="fsec-title">CREDENCIAIS</div>
      <div class="fgrid">
        <div class="fg"><label class="fl">API Key</label><input class="fi" id="cfg-assin-apikey" value="${H.esc(c.apiKey||'')}" placeholder="Chave de API"></div>
        <div class="fg"><label class="fl">API Secret</label><input class="fi" type="password" id="cfg-assin-secret" placeholder="••••••••"></div>
        <div class="fg cs2"><label class="fl">Webhook URL</label><input class="fi" id="cfg-assin-webhook" value="${H.esc(c.webhookUrl||'')}" placeholder="https://..."></div>
      </div></div>
    </div>

    <!-- ── Ativação ───────────────────────────────────────────── -->
    <div class="fsec">
      <div class="fsec-title">ATIVAÇÃO</div>
      <label class="sw" id="sw-assin-ativo" onclick="this.querySelector('.sw-tr').classList.toggle('on')">
        <div class="sw-tr ${c.ativo?'on':''}"><div class="sw-th"></div></div>
        Ativar envio automático ao fornecedor após aprovação N3
      </label>
    </div>

    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-a" onclick="Configs._saveAssinatura()">💾 Salvar Configuração</button>
    </div>`;
  },

  _onProvChange() {
    const prov = H.el('cfg-assin-prov')?.value;
    H.el('cfg-assin-clicksign').style.display = prov === 'ClickSign' ? 'block' : 'none';
    H.el('cfg-assin-d4sign').style.display    = prov === 'D4Sign'    ? 'block' : 'none';
    H.el('cfg-assin-outros').style.display    = !['ClickSign','D4Sign'].includes(prov) ? 'block' : 'none';
  },

  async _testClickSign() {
    const token   = H.el('cfg-assin-token')?.value.trim();
    const amb     = document.querySelector('input[name="cfg-assin-amb"]:checked')?.value || 'sandbox';
    const btn     = H.el('btn-test-clicksign');
    const result  = H.el('cfg-assin-test-result');
    if (!token) { UI.toast('Informe o Access Token antes de testar','error'); return; }
    btn.disabled = true; btn.textContent = '⏳ Testando...';
    result.style.display = 'none';
    try {
      const r = await API.testClickSign({ accessToken: token, ambiente: amb });
      result.style.display = 'block';
      result.style.background = 'rgba(34,197,94,.1)';
      result.style.color = 'var(--green)';
      result.textContent = r.message;
    } catch(e) {
      result.style.display = 'block';
      result.style.background = 'rgba(239,68,68,.1)';
      result.style.color = 'var(--red)';
      const is403 = e.message.includes('403');
      result.innerHTML = '✗ ' + e.message +
        (is403 ? '<br><span style="font-size:10px;opacity:.8">Erro 403 geralmente indica que o token pertence a outro ambiente. Verifique se o ambiente selecionado (Produção/Sandbox) corresponde ao onde o token foi gerado.</span>' : '');
    } finally {
      btn.disabled = false; btn.textContent = '🔍 Testar Conexão';
    }
  },

  async _saveAssinatura() {
    const prov = H.el('cfg-assin-prov')?.value || 'ClickSign';
    let data = { provedor: prov, ativo: !!H.el('sw-assin-ativo')?.querySelector('.sw-tr.on') };

    if (prov === 'ClickSign') {
      const token = H.el('cfg-assin-token')?.value.trim();
      if (!token) { UI.toast('Informe o Access Token do ClickSign','error'); return; }
      data.accessToken = token;
      data.ambiente    = document.querySelector('input[name="cfg-assin-amb"]:checked')?.value || 'sandbox';
      data.pasta       = H.el('cfg-assin-pasta')?.value.trim() || '/HAMOA/';
    } else if (prov === 'D4Sign') {
      data.d4Token   = H.el('cfg-assin-d4token')?.value.trim();
      data.d4ApiKey  = H.el('cfg-assin-d4apikey')?.value.trim();
      data.d4CryptKey= H.el('cfg-assin-d4cryptkey')?.value.trim();
    } else {
      data.apiKey    = H.el('cfg-assin-apikey')?.value.trim();
      data.apiSecret = H.el('cfg-assin-secret')?.value.trim();
      data.webhookUrl= H.el('cfg-assin-webhook')?.value.trim();
    }

    try {
      await API.saveConfig('assinatura', data);
      UI.toast('Configuração de assinatura salva com sucesso','success');
      await Configs.assinatura(); // recarrega para mostrar status atualizado
    } catch(e) { UI.toast('Erro: '+e.message,'error'); }
  },

  async permissoes() {
    const cfg = await API.config('permissoes').catch(()=>null);
    const perms = cfg ? cfg.valor : {};
    const grupos = Object.keys(perms);

    // Telas e permissões agrupadas por módulo
    const secoes = [
      {
        label: '📊 Dashboard & Acompanhamento',
        itens: [
          ['dashboard',       'Dashboard'],
          ['acompanhamento',  'Acompanhamento'],
        ],
      },
      {
        label: '📋 Medições',
        itens: [
          ['verMedicoes',  'Ver Medições'],
          ['criarMedicao', 'Criar Medição'],
          ['aprovarN1',    'Aprovar N1'],
          ['aprovarN2',    'Aprovar N2'],
          ['aprovarN3',    'Aprovar N3'],
          ['enviarAssinatura', 'Enviar para Assinatura'],
        ],
      },
      {
        label: '📅 Cronograma',
        itens: [
          ['cronograma',          'Ver Cronograma'],
          ['cronogramaEditar',    'Importar / Editar Cronograma'],
          ['cronogramaVinculos',  'Gerenciar Vínculos Contrato × WBS'],
          ['cronogramaIA',        'Usar Construv IA (chat)'],
        ],
      },
      {
        label: '🗂 Cadastros & Administração',
        itens: [
          ['cadastros',      'Cadastros (Obras, Contratos, Fornecedores)'],
          ['alcadas',        'Alçadas'],
          ['configuracoes',  'Configurações'],
        ],
      },
    ];

    // Linha de separação de seção
    const sepRow = (lbl) =>
      `<tr style="background:var(--surface2)">
         <td colspan="${grupos.length + 1}" style="font-size:10px;font-weight:700;color:var(--accent);
                      padding:6px 10px;letter-spacing:.5px;border-top:2px solid var(--border)">${lbl}</td>
       </tr>`;

    const tbodyRows = secoes.map(sec =>
      sepRow(sec.label) +
      sec.itens.map(([key, lbl]) =>
        `<tr>
           <td style="padding-left:16px">${lbl}</td>
           ${grupos.map(g =>
             `<td style="text-align:center">
                <input type="checkbox" id="perm-${g}-${key}"
                  ${perms[g]?.[key] ? 'checked' : ''}
                  style="accent-color:var(--green);cursor:pointer;width:14px;height:14px">
              </td>`
           ).join('')}
         </tr>`
      ).join('')
    ).join('');

    H.el('cfg-content').innerHTML = `
    <div style="margin-bottom:18px">
      <div style="font-family:var(--font-d);font-size:22px;letter-spacing:2px;color:var(--text)">PERMISSÕES POR GRUPO DO AD</div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">Defina o que cada grupo do Active Directory pode acessar e executar no sistema.</div>
    </div>
    <div style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <input class="si" id="cfg-perm-novogrupo" placeholder="Nome do grupo AD (ex: GRP_OBRAS_ADMIN)" style="max-width:320px">
      <button class="btn btn-o btn-sm" onclick="Configs._addGrupo()">+ Adicionar Grupo</button>
      <button class="btn btn-a btn-sm" onclick="Configs._savePerms()">💾 Salvar Permissões</button>
    </div>
    ${grupos.length === 0
      ? `<div class="ibox" style="color:var(--text3)">Nenhum grupo configurado. Adicione o nome do grupo do AD acima para começar.</div>`
      : `<div style="overflow-x:auto"><table class="pt2" style="min-width:500px">
           <thead>
             <tr style="background:var(--surface2)">
               <th style="min-width:260px">Permissão</th>
               ${grupos.map(g => `<th style="font-family:var(--font-m);font-size:9px;text-align:center;min-width:90px">${g}</th>`).join('')}
             </tr>
           </thead>
           <tbody>${tbodyRows}</tbody>
         </table></div>`
    }`;
  },
  async _addGrupo() {
    const nome = H.el('cfg-perm-novogrupo')?.value.trim();
    if(!nome){UI.toast('Informe o nome do grupo','error');return;}
    const cfg = await API.config('permissoes').catch(()=>null);
    const perms = cfg ? cfg.valor : {};
    if(perms[nome]){UI.toast('Grupo já existe','error');return;}
    perms[nome] = {
      // Dashboard & Acompanhamento
      dashboard: false, acompanhamento: false,
      // Medições
      verMedicoes: false, criarMedicao: false,
      aprovarN1: false, aprovarN2: false, aprovarN3: false,
      enviarAssinatura: false,
      // Cronograma
      cronograma: false, cronogramaEditar: false,
      cronogramaVinculos: false, cronogramaIA: false,
      // Administração
      cadastros: false, alcadas: false, configuracoes: false,
    };
    try { await API.saveConfig('permissoes', perms); UI.toast(`Grupo ${nome} adicionado`,'success'); await this.permissoes(); } catch(e){UI.toast('Erro: '+e.message,'error');}
  },
  async _savePerms() {
    const cfg = await API.config('permissoes').catch(()=>null);
    const perms = cfg ? cfg.valor : {};
    const telas = [
      'dashboard', 'acompanhamento',
      'verMedicoes', 'criarMedicao', 'aprovarN1', 'aprovarN2', 'aprovarN3', 'enviarAssinatura',
      'cronograma', 'cronogramaEditar', 'cronogramaVinculos', 'cronogramaIA',
      'cadastros', 'alcadas', 'configuracoes',
    ];
    Object.keys(perms).forEach(g => { telas.forEach(t => { const el = document.getElementById(`perm-${g}-${t}`); if(el) perms[g][t] = el.checked; }); });
    try { await API.saveConfig('permissoes', perms); UI.toast('Permissões salvas com sucesso','success'); } catch(e){UI.toast('Erro: '+e.message,'error');}
  },

  async notificacoes() {
    const cfg = await API.config('notificacoes').catch(()=>null);
    const c = cfg ? cfg.valor : {};
    H.el('cfg-content').innerHTML = `
    <div style="margin-bottom:18px"><div style="font-family:var(--font-d);font-size:22px;letter-spacing:2px;color:var(--text)">NOTIFICAÇÕES & E-MAIL</div></div>
    <div class="fsec"><div class="fsec-title">SERVIDOR SMTP</div>
    <div class="fgrid">
      <div class="fg"><label class="fl">Servidor SMTP *</label><input class="fi" id="cfg-smtp-host" value="${c.smtpHost||''}" placeholder="smtp.empresa.com.br"></div>
      <div class="fg"><label class="fl">Porta</label><input class="fi" id="cfg-smtp-porta" value="${c.smtpPorta||587}"></div>
      <div class="fg"><label class="fl">Usuário SMTP</label><input class="fi" id="cfg-smtp-user" value="${c.smtpUser||''}"></div>
      <div class="fg"><label class="fl">Senha SMTP</label><input class="fi" type="password" id="cfg-smtp-pass" placeholder="••••••••"></div>
      <div class="fg cs2"><label class="fl">Remetente (From)</label><input class="fi" id="cfg-smtp-remetente" value="${c.remetente||''}"></div>
    </div></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-a" onclick="Configs._saveNotif()">💾 Salvar</button>
    </div>`;
  },
  async _saveNotif() {
    const data = { smtpHost:H.el('cfg-smtp-host').value, smtpPorta:parseInt(H.el('cfg-smtp-porta').value)||587, smtpUser:H.el('cfg-smtp-user').value, smtpPass:H.el('cfg-smtp-pass').value, remetente:H.el('cfg-smtp-remetente').value, tls:true };
    try { await API.saveConfig('notificacoes', data); UI.toast('Configurações de notificação salvas','success'); } catch(e){UI.toast('Erro: '+e.message,'error');}
  },

  async geral() {
    const cfg = await API.config('geral').catch(()=>null);
    const c = cfg ? cfg.valor : {};
    H.el('cfg-content').innerHTML = `
    <div style="margin-bottom:18px"><div style="font-family:var(--font-d);font-size:22px;letter-spacing:2px;color:var(--text)">PARÂMETROS GERAIS</div></div>
    <div class="fsec"><div class="fsec-title">IDENTIFICAÇÃO</div>
    <div class="fgrid">
      <div class="fg"><label class="fl">Nome da Empresa/Sistema</label><input class="fi" id="cfg-g-nome" value="${c.nomeEmpresa||'JMD Hamoa Urbanismo'}"></div>
      <div class="fg"><label class="fl">Máscara do Código de Medição</label><input class="fi" id="cfg-g-mascara" value="${c.codigoMedicaoMascara||'MED-{AAMM}-{SEQ}'}"></div>
    </div></div>
    <div class="fsec"><div class="fsec-title">REGRAS DE NEGÓCIO</div>
    <div class="fgrid">
      <div class="fg"><label class="fl">Dia de corte do período</label><input class="fi" type="number" id="cfg-g-corte" value="${c.periodoCorte||5}" min="1" max="28"></div>
      <div class="fg"><label class="fl">Dias de aviso antes do vencimento</label><input class="fi" type="number" id="cfg-g-aviso" value="${c.diasAvisoVencimento||3}" min="1"></div>
    </div></div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-a" onclick="Configs._saveGeral()">💾 Salvar Parâmetros</button>
    </div>`;
  },
  async _saveGeral() {
    const data = { nomeEmpresa:H.el('cfg-g-nome').value, codigoMedicaoMascara:H.el('cfg-g-mascara').value, periodoCorte:parseInt(H.el('cfg-g-corte').value)||5, diasAvisoVencimento:parseInt(H.el('cfg-g-aviso').value)||3 };
    try { await API.saveConfig('geral', data); UI.toast('Parâmetros gerais salvos','success'); } catch(e){UI.toast('Erro: '+e.message,'error');}
  },

  async backup() {
    H.el('cfg-content').innerHTML = `
    <div style="margin-bottom:18px"><div style="font-family:var(--font-d);font-size:22px;letter-spacing:2px;color:var(--text)">BACKUP & DADOS</div></div>
    <div class="ibox info" style="margin-bottom:18px">
      <div class="ibox-title">ℹ️ Banco de dados PostgreSQL</div>
      <div class="ibox-text">Os dados estão armazenados no PostgreSQL. Use as ferramentas de backup do PostgreSQL (pg_dump) para exportação completa. O Adminer está disponível em :8080 (perfil tools).</div>
    </div>
    <div class="fsec"><div class="fsec-title">EXPORTAR DADOS</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-o" onclick="Configs._exportMedicoes()">📊 Exportar Medições (JSON)</button>
    </div></div>`;
  },
  async _exportMedicoes() {
    try {
      const meds = await API.medicoes();
      const blob = new Blob([JSON.stringify(meds,null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href=url; a.download=`hamoa-medicoes-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      UI.toast('Exportado com sucesso','success');
    } catch(e){UI.toast('Erro: '+e.message,'error');}
  },

  async ia() {
    const cfg = await API.config('ia').catch(()=>null);
    const c = cfg ? cfg.valor : {};
    const temChave = !!c.gemini_api_key;
    H.el('cfg-content').innerHTML = `
    <div style="margin-bottom:18px">
      <div style="font-family:var(--font-d);font-size:22px;letter-spacing:2px;color:var(--text)">INTELIGÊNCIA ARTIFICIAL</div>
      <div style="font-size:11px;color:var(--text3);margin-top:5px">Configure a integração com IA para interpretação automática de contratos em PDF/DOCX</div>
    </div>
    <div class="ibox info" style="margin-bottom:18px">
      <div class="ibox-title">🤖 Google Gemini Flash · ${temChave ? '<span style="color:var(--green)">Chave configurada ✓</span>' : '<span style="color:var(--yellow)">Chave não configurada</span>'}</div>
      <div class="ibox-text">O <b>Google Gemini 2.5 Flash</b> é o modelo de IA atual recomendado pelo Google — gratuito, multimodal e capaz de ler documentos PDF diretamente. Ele interpreta o conteúdo do contrato e extrai automaticamente os itens da planilha orçamentária (descrição, unidade, quantidade, valor). Não há custo para volumes normais de uso.</div>
    </div>
    <div class="fsec"><div class="fsec-title">CHAVE DA API GEMINI</div>
    <div class="fgrid">
      <div class="fg cs2">
        <label class="fl">API Key *</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="fi" type="password" id="cfg-ia-key" value="${c.gemini_api_key||''}" placeholder="AIza..." style="flex:1;font-family:monospace">
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cfg-ia-key').type=document.getElementById('cfg-ia-key').type==='password'?'text':'password'">👁</button>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:5px">
          Obtenha gratuitamente em: <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--accent)">https://aistudio.google.com/app/apikey</a>
        </div>
      </div>
    </div></div>
    <div class="fsec"><div class="fsec-title">FORMATOS SUPORTADOS</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
      <span style="background:rgba(99,102,241,.12);color:var(--accent);padding:4px 12px;border-radius:12px;font-size:11px;font-weight:600">📄 PDF</span>
      <span style="background:rgba(99,102,241,.12);color:var(--accent);padding:4px 12px;border-radius:12px;font-size:11px;font-weight:600">📝 DOCX</span>
    </div>
    <p style="font-size:11px;color:var(--text3);margin-top:10px">Tamanho máximo: 20 MB · Limite gratuito: 15 requisições/minuto (mais do que suficiente para uso normal)</p>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="btn btn-p" onclick="Configs._saveIa()">💾 Salvar Configuração</button>
      <button class="btn btn-o" onclick="Configs._testIa()">🧪 Testar Conexão</button>
    </div>`;
  },

  async _saveIa() {
    const key = H.el('cfg-ia-key').value.trim();
    await API.saveConfig('ia', { gemini_api_key: key });
    UI.toast('Configuração IA salva com sucesso', 'success');
  },

  async _testIa() {
    const key = H.el('cfg-ia-key').value.trim();
    if (!key) return UI.toast('Informe a chave antes de testar', 'error');
    UI.toast('Testando conexão com Gemini...', 'info');
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Responda apenas: OK' }] }] }),
      });
      const d = await r.json();
      if (d?.candidates?.[0]?.content?.parts?.[0]?.text) {
        UI.toast('✅ Conexão com Gemini funcionando!', 'success');
      } else {
        UI.toast('⚠️ Resposta inesperada: ' + JSON.stringify(d).slice(0,120), 'error');
      }
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  // ══════════════════════════════════════════════════════════════════
  // USUÁRIOS
  // ══════════════════════════════════════════════════════════════════
  _usuariosData: [],   // cache da lista
  _usuarioEditId: null,
  _resetSenhaUsrId: null,

  async usuarios() {
    const panel = H.el('cfg-content');
    if (!panel) return;
    panel.innerHTML = '<div style="padding:24px;color:var(--muted)">⏳ Carregando usuários...</div>';

    let lista = [];
    try { lista = await API.usuarios(); } catch(e) {
      panel.innerHTML = `<div class="ibox" style="border-color:var(--red);color:var(--red)">Erro ao carregar usuários: ${H.esc(e.message)}</div>`;
      return;
    }
    this._usuariosData = lista;

    // Busca grupos disponíveis a partir das permissões configuradas
    let gruposDisponiveis = [];
    try {
      const cfg = await API.config('permissoes').catch(()=>null);
      if (cfg?.valor) gruposDisponiveis = Object.keys(cfg.valor);
    } catch {}

    const PERFIL_BADGE = { ADM: 'badge-red', N3: 'badge-yellow', N2: 'badge-teal', N1: 'badge-blue' };
    const perfilBadge = (p) => `<span class="badge ${PERFIL_BADGE[p]||'badge-blue'}" style="font-size:10px">${p||'N1'}</span>`;

    const rows = lista.map(u => `
      <tr>
        <td style="font-weight:600">${H.esc(u.nome || u.login)}</td>
        <td style="font-family:var(--font-m);font-size:12px;color:var(--muted)">${H.esc(u.login)}</td>
        <td style="font-size:12px">${H.esc(u.email||'—')}</td>
        <td style="text-align:center">${perfilBadge(u.perfil)}</td>
        <td style="font-size:11px;max-width:200px">
          ${(u.grupos_ad||[]).map(g=>`<span class="adtag" style="font-size:10px;padding:2px 7px">${H.esc(g)}</span>`).join(' ')||'<span style="color:var(--muted)">—</span>'}
        </td>
        <td style="text-align:center">
          <span class="badge ${u.ativo?'badge-green':'badge-red'}" style="font-size:10px">${u.ativo?'Ativo':'Inativo'}</span>
        </td>
        <td style="text-align:center;font-size:11px;color:var(--muted)">${u.tem_senha_local?'🔒 Local':'🔑 AD'}</td>
        <td style="white-space:nowrap;text-align:right">
          <button class="btn btn-sm btn-o" style="font-size:11px;padding:3px 8px;margin-right:4px" onclick="Configs._openModalUsuario(${u.id})">✏</button>
          <button class="btn btn-sm" style="font-size:11px;padding:3px 8px;margin-right:4px;background:var(--yellow);color:#000" onclick="Configs._resetSenhaUsuario(${u.id},'${H.esc(u.nome||u.login)}')">🔑</button>
          <button class="btn btn-sm" style="font-size:11px;padding:3px 8px;background:var(--red)" onclick="Configs._deleteUsuario(${u.id},'${H.esc(u.nome||u.login)}',${u.ativo})">${u.ativo?'🚫':'✅'}</button>
        </td>
      </tr>`).join('');

    panel.innerHTML = `
      <div class="fsec" style="margin-bottom:16px">
        <div class="fsec-title">USUÁRIOS DO SISTEMA</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:12px;color:var(--muted)">${lista.length} usuário(s) cadastrado(s)</div>
          <button class="btn btn-a btn-sm" onclick="Configs._openModalUsuario(null)">+ Novo Usuário</button>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table class="tbl" style="font-size:13px">
          <thead>
            <tr>
              <th>Nome</th><th>Login</th><th>E-mail</th>
              <th style="text-align:center">Perfil</th>
              <th>Grupos AD</th>
              <th style="text-align:center">Status</th>
              <th style="text-align:center">Acesso</th>
              <th style="text-align:right">Ações</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">Nenhum usuário cadastrado</td></tr>'}</tbody>
        </table>
      </div>`;

    // Guarda grupos para o modal
    this._gruposDisponiveis = gruposDisponiveis;
  },

  async _openModalUsuario(id) {
    this._usuarioEditId = id;
    const u = id ? (this._usuariosData.find(x=>x.id===id) || await API.usuario(id).catch(()=>null)) : null;
    const grupos = this._gruposDisponiveis || [];

    H.el('usr-modal-title').textContent = id ? `✏ EDITAR USUÁRIO · ${u?.nome||u?.login||''}` : '👤 NOVO USUÁRIO';

    const perfis = ['N1','N2','N3','ADM'];
    const gruposHtml = grupos.length
      ? grupos.map(g => {
          const sel = (u?.grupos_ad||[]).includes(g);
          return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;padding:4px 0">
            <input type="checkbox" class="usr-grupo-chk" value="${H.esc(g)}" ${sel?'checked':''} style="accent-color:var(--accent)">
            ${H.esc(g)}
          </label>`;
        }).join('')
      : '<div style="color:var(--muted);font-size:12px">Nenhum grupo AD configurado. Configure em Permissões por Grupo AD.</div>';

    H.el('usr-modal-body').innerHTML = `
      <div class="fgrid">
        <div class="fg cs2">
          <label class="fl">Login *</label>
          <input class="fi" id="usr-login" value="${H.esc(u?.login||'')}" placeholder="nome.sobrenome" ${id?'disabled style="opacity:.6"':''}>
          <div class="hint">Nome de usuário único no sistema</div>
        </div>
        <div class="fg cs2">
          <label class="fl">Nome Completo</label>
          <input class="fi" id="usr-nome" value="${H.esc(u?.nome||'')}" placeholder="Ex: João Silva">
        </div>
        <div class="fg cs2">
          <label class="fl">E-mail</label>
          <input class="fi" type="email" id="usr-email" value="${H.esc(u?.email||'')}" placeholder="email@empresa.com.br">
        </div>
        <div class="fg">
          <label class="fl">Perfil *</label>
          <select class="fi fsel" id="usr-perfil">
            ${perfis.map(p=>`<option value="${p}" ${(u?.perfil||'N1')===p?'selected':''}>${p}</option>`).join('')}
          </select>
          <div class="hint">N1=Operador, N2=Gestor, N3=Diretor, ADM=Administrador</div>
        </div>
        <div class="fg">
          <label class="fl">Status</label>
          <label class="sw" id="usr-ativo-sw" onclick="this.querySelector('.sw-tr').classList.toggle('on')">
            <div class="sw-tr ${u===null||u?.ativo?'on':''}"><div class="sw-th"></div></div>
            Usuário ativo
          </label>
        </div>
      </div>
      ${!id ? `
      <div class="divider"></div>
      <div class="fgrid">
        <div class="fg cs2">
          <label class="fl">Senha (opcional)</label>
          <input class="fi" type="password" id="usr-senha" placeholder="Deixe vazio se usa apenas AD" autocomplete="new-password">
          <div class="hint">Preencha apenas para usuários com autenticação local (não AD)</div>
        </div>
      </div>` : ''}
      <div class="divider"></div>
      <div class="fsec">
        <div class="fsec-title">GRUPOS DO ACTIVE DIRECTORY</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px 16px;margin-top:8px;max-height:200px;overflow-y:auto;padding:4px">
          ${gruposHtml}
        </div>
      </div>`;

    UI.openModal('modal-usuario');
  },

  async _saveUsuario() {
    const id = this._usuarioEditId;
    const login  = H.el('usr-login')?.value.trim();
    const nome   = H.el('usr-nome')?.value.trim();
    const email  = H.el('usr-email')?.value.trim();
    const perfil = H.el('usr-perfil')?.value;
    const ativo  = !!H.el('usr-ativo-sw')?.querySelector('.sw-tr.on');
    const grupos_ad = [...(document.querySelectorAll('.usr-grupo-chk:checked')||[])].map(el=>el.value);
    const senha  = H.el('usr-senha')?.value || undefined;

    if (!id && !login) { UI.toast('Login é obrigatório','error'); return; }

    const payload = { nome: nome||undefined, email: email||undefined, perfil, grupos_ad, ativo };
    if (!id) { payload.login = login; if (senha) payload.senha = senha; }

    try {
      if (id) {
        await API.updateUsuario(id, payload);
      } else {
        await API.createUsuario(payload);
      }
      UI.toast(`Usuário ${id?'atualizado':'criado'} com sucesso`, 'success');
      UI.closeModal('modal-usuario');
      await Configs.usuarios();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  _resetSenhaUsuario(id, nome) {
    this._resetSenhaUsrId = id;
    H.el('usr-reset-nome').textContent = `Usuário: ${nome}`;
    H.el('usr-nova-senha').value = '';
    H.el('usr-conf-senha').value = '';
    UI.openModal('modal-reset-senha');
  },

  async _confirmarResetSenha() {
    const id = this._resetSenhaUsrId;
    if (!id) return;
    const senha = H.el('usr-nova-senha')?.value;
    const conf  = H.el('usr-conf-senha')?.value;
    if (!senha || senha.length < 6) { UI.toast('Senha deve ter ao menos 6 caracteres','error'); return; }
    if (senha !== conf) { UI.toast('As senhas não coincidem','error'); return; }
    try {
      await API.resetSenhaUsuario(id, senha);
      UI.toast('Senha redefinida com sucesso','success');
      UI.closeModal('modal-reset-senha');
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  async _deleteUsuario(id, nome, ativo) {
    const acao = ativo ? 'desativar' : 'reativar';
    if (!confirm(`Deseja ${acao} o usuário "${nome}"?`)) return;
    try {
      if (ativo) {
        await API.deleteUsuario(id);
      } else {
        await API.updateUsuario(id, { ativo: true });
      }
      UI.toast(`Usuário ${ativo?'desativado':'reativado'} com sucesso`, 'success');
      await Configs.usuarios();
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  // ══════════════════════════════════════════════════════════════
  // LOGS DE AUDITORIA
  // ══════════════════════════════════════════════════════════════
  _auditParams: { entidade: '', acao: '', usuario_login: '', data_inicio: '', data_fim: '', offset: 0 },

  async audit() {
    const c = H.el('cfg-content');
    c.innerHTML = `
      <div class="cfg-section-title">📋 Logs de Auditoria</div>
      <p style="color:var(--text3);font-size:12px;margin-bottom:12px">
        Registro de todas as operações realizadas no sistema. Os logs são imutáveis e gravados automaticamente.
      </p>

      <!-- Filtros -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;color:var(--text3)">Módulo</label>
          <select id="audit-f-entidade" class="fi" style="width:150px;height:32px;font-size:12px"
                  onchange="Configs._auditFilter()">
            <option value="">Todos</option>
            <option value="medicao">Medições</option>
            <option value="contrato">Contratos</option>
            <option value="cronograma">Cronograma</option>
            <option value="empresa">Empresas</option>
            <option value="obra">Obras</option>
            <option value="fornecedor">Fornecedores</option>
            <option value="usuario">Usuários</option>
            <option value="configuracao">Configurações</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;color:var(--text3)">Ação</label>
          <select id="audit-f-acao" class="fi" style="width:150px;height:32px;font-size:12px"
                  onchange="Configs._auditFilter()">
            <option value="">Todas</option>
            <option value="criar">Criar</option>
            <option value="editar">Editar</option>
            <option value="excluir">Excluir</option>
            <option value="importar">Importar</option>
            <option value="aprovar">Aprovar</option>
            <option value="reprovar">Reprovar</option>
            <option value="enviar_assinatura">Enviar Assinatura</option>
            <option value="vincular">Vincular</option>
            <option value="login">Login</option>
            <option value="trocar_senha">Trocar Senha</option>
            <option value="reset_senha">Reset Senha</option>
            <option value="salvar_config">Salvar Config.</option>
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;color:var(--text3)">Usuário</label>
          <input id="audit-f-usuario" class="fi" placeholder="login..." style="width:130px;height:32px;font-size:12px"
                 oninput="Configs._auditFilterDebounced()">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;color:var(--text3)">De</label>
          <input id="audit-f-de" type="date" class="fi" style="width:130px;height:32px;font-size:12px"
                 onchange="Configs._auditFilter()">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;color:var(--text3)">Até</label>
          <input id="audit-f-ate" type="date" class="fi" style="width:130px;height:32px;font-size:12px"
                 onchange="Configs._auditFilter()">
        </div>
        <button class="btn btn-o" style="height:32px;font-size:11px" onclick="Configs._auditClear()">✕ Limpar</button>
      </div>

      <!-- Tabela -->
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px" id="audit-table">
          <thead>
            <tr style="background:var(--surface2)">
              <th style="padding:7px 10px;text-align:left;white-space:nowrap;border-bottom:1px solid var(--border)">Data / Hora</th>
              <th style="padding:7px 10px;text-align:left;border-bottom:1px solid var(--border)">Usuário</th>
              <th style="padding:7px 10px;text-align:left;border-bottom:1px solid var(--border)">Ação</th>
              <th style="padding:7px 10px;text-align:left;border-bottom:1px solid var(--border)">Módulo</th>
              <th style="padding:7px 10px;text-align:left;border-bottom:1px solid var(--border);min-width:300px">Descrição</th>
              <th style="padding:7px 10px;text-align:left;border-bottom:1px solid var(--border)">IP</th>
            </tr>
          </thead>
          <tbody id="audit-tbody">
            <tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text3)">Carregando...</td></tr>
          </tbody>
        </table>
      </div>
      <!-- Paginação -->
      <div id="audit-pag" style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:12px"></div>`;

    // Define debounce para o campo usuário
    Configs._auditDebounceTimer = null;
    Configs._auditFilterDebounced = () => {
      clearTimeout(Configs._auditDebounceTimer);
      Configs._auditDebounceTimer = setTimeout(() => Configs._auditFilter(), 400);
    };

    Configs._auditParams = { entidade: '', acao: '', usuario_login: '', data_inicio: '', data_fim: '', offset: 0 };
    await Configs._auditLoad();
  },

  _auditFilter() {
    Configs._auditParams.entidade      = H.el('audit-f-entidade')?.value || '';
    Configs._auditParams.acao          = H.el('audit-f-acao')?.value     || '';
    Configs._auditParams.usuario_login = H.el('audit-f-usuario')?.value  || '';
    Configs._auditParams.data_inicio   = H.el('audit-f-de')?.value       || '';
    Configs._auditParams.data_fim      = H.el('audit-f-ate')?.value      || '';
    Configs._auditParams.offset        = 0;
    Configs._auditLoad();
  },

  _auditClear() {
    ['audit-f-entidade','audit-f-acao','audit-f-usuario','audit-f-de','audit-f-ate']
      .forEach(id => { const el = H.el(id); if (el) el.value = ''; });
    Configs._auditParams = { entidade: '', acao: '', usuario_login: '', data_inicio: '', data_fim: '', offset: 0 };
    Configs._auditLoad();
  },

  async _auditLoad() {
    const tbody = H.el('audit-tbody');
    const pag   = H.el('audit-pag');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text3)">Carregando...</td></tr>`;

    const { entidade, acao, usuario_login, data_inicio, data_fim, offset } = Configs._auditParams;
    const limit = 100;

    const qs = new URLSearchParams({ limit, offset });
    if (entidade)      qs.set('entidade',      entidade);
    if (acao)          qs.set('acao',           acao);
    if (usuario_login) qs.set('usuario_login',  usuario_login);
    if (data_inicio)   qs.set('data_inicio',    data_inicio);
    if (data_fim)      qs.set('data_fim',       data_fim);

    try {
      const data = await API._req('GET', `/api/audit?${qs}`);

      const _acaoBadge = (a) => {
        const map = {
          criar: ['#10b981','Criar'], editar: ['#6366f1','Editar'], excluir: ['#ef4444','Excluir'],
          importar: ['#f59e0b','Importar'], aprovar: ['#10b981','Aprovar'], reprovar: ['#ef4444','Reprovar'],
          enviar_assinatura: ['#06b6d4','Assinatura'], vincular: ['#8b5cf6','Vincular'],
          login: ['#64748b','Login'], trocar_senha: ['#f59e0b','Trocar Senha'],
          reset_senha: ['#f59e0b','Reset Senha'], salvar_config: ['#6366f1','Config.'],
        };
        const [cor, label] = map[a] || ['#94a3b8', a];
        return `<span style="background:${cor}22;color:${cor};border:1px solid ${cor}44;
                             border-radius:8px;padding:1px 8px;font-size:10px;font-weight:700;white-space:nowrap">${label}</span>`;
      };

      const _entidadeIcon = (e) => {
        const m = { medicao:'📄', contrato:'📁', cronograma:'📅', empresa:'🏢', obra:'🏗',
                    fornecedor:'🤝', usuario:'👤', configuracao:'⚙️', alcada:'🔑' };
        return (m[e] || '📌') + ' ' + (e || '—');
      };

      if (!data.rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text3)">Nenhum registro encontrado.</td></tr>`;
        if (pag) pag.innerHTML = '';
        return;
      }

      tbody.innerHTML = data.rows.map(r => `
        <tr style="border-bottom:1px solid var(--border)" class="wbs-row-leaf">
          <td style="padding:7px 10px;white-space:nowrap;font-size:11px;color:var(--text3)">${H.esc(r.criado_em_fmt || '')}</td>
          <td style="padding:7px 10px">
            <div style="font-weight:600;font-size:11px">${H.esc(r.usuario_login || '—')}</div>
            <div style="font-size:10px;color:var(--text3)">${H.esc(r.usuario_nome || '')}</div>
          </td>
          <td style="padding:7px 10px">${_acaoBadge(r.acao)}</td>
          <td style="padding:7px 10px;font-size:11px;color:var(--text2)">${_entidadeIcon(r.entidade)}</td>
          <td style="padding:7px 10px;font-size:11px;color:var(--text2);max-width:380px">${H.esc(r.descricao || '—')}</td>
          <td style="padding:7px 10px;font-size:10px;color:var(--text3);white-space:nowrap">${H.esc(r.ip || '—')}</td>
        </tr>`).join('');

      // Paginação
      if (pag) {
        const total = data.total;
        const pagAtual = Math.floor(offset / limit) + 1;
        const totalPags = Math.ceil(total / limit);
        const prevOff = Math.max(0, offset - limit);
        const nextOff = offset + limit;
        pag.innerHTML = `
          <span style="color:var(--text3)">${total} registro${total!==1?'s':''}</span>
          ${pagAtual > 1
            ? `<button class="btn btn-o btn-xs" onclick="Configs._auditParams.offset=${prevOff};Configs._auditLoad()">← Anterior</button>`
            : ''}
          <span>Pág. ${pagAtual} de ${totalPags || 1}</span>
          ${nextOff < total
            ? `<button class="btn btn-o btn-xs" onclick="Configs._auditParams.offset=${nextOff};Configs._auditLoad()">Próxima →</button>`
            : ''}`;
      }
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;color:var(--red)">${H.esc(e.message)}</td></tr>`;
    }
  },

  // ════════════════════════════════════════════════════════════════
  // ARMAZENAMENTO DE EVIDÊNCIAS (S3 / Google Drive / Local)
  // ════════════════════════════════════════════════════════════════
  async storage() {
    const panel = H.el('cfg-content');
    panel.innerHTML = '<div style="color:var(--text3);padding:20px">Carregando...</div>';
    let cfg = {};
    try { cfg = (await API.configStorage())?.valor || {}; } catch {}

    const provider = cfg.provider || 'local';
    const s3       = cfg.s3 || {};
    const gdrive   = cfg.gdrive || {};

    panel.innerHTML = `
      <div style="max-width:680px">
        <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">☁ Armazenamento de Evidências</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:20px">
          Configure onde as fotos e arquivos enviados nas medições serão armazenados.
          Ao salvar, novos uploads usarão o provider selecionado. Arquivos existentes não são migrados.
        </div>

        <div class="fsec">
          <div class="fsec-title">PROVIDER DE ARMAZENAMENTO</div>
          <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            ${[['local','🖥 Servidor Local','Arquivos salvos no próprio servidor (pasta /uploads). Não recomendado para produção.'],
               ['s3','☁ AWS S3','Amazon Simple Storage Service. Ideal para produção com alta disponibilidade.'],
               ['gdrive','📂 Google Drive','Pasta compartilhada no Google Drive via Service Account.']
              ].map(([v,label,desc]) => `
              <label style="flex:1;min-width:160px;cursor:pointer">
                <input type="radio" name="st-provider" value="${v}" ${provider===v?'checked':''} onchange="Configs._storageOnProviderChange()">
                <div class="accard" style="margin-top:4px;padding:10px 14px;cursor:pointer;border:2px solid ${provider===v?'var(--accent)':'var(--border)'}">
                  <div style="font-size:13px;font-weight:700;margin-bottom:2px">${label}</div>
                  <div style="font-size:10px;color:var(--text3);line-height:1.4">${desc}</div>
                </div>
              </label>`).join('')}
          </div>
        </div>

        <!-- AWS S3 -->
        <div id="st-s3-block" style="${provider!=='s3'?'display:none':''}">
          <div class="fsec">
            <div class="fsec-title">CONFIGURAÇÃO AWS S3</div>
            <div class="fgrid">
              <div class="fg"><label class="fl">Bucket *</label>
                <input class="fi" id="st-s3-bucket" value="${H.esc(s3.bucket||'')}" placeholder="meu-bucket-evidencias"></div>
              <div class="fg"><label class="fl">Região *</label>
                <input class="fi" id="st-s3-region" value="${H.esc(s3.region||'sa-east-1')}" placeholder="sa-east-1"></div>
              <div class="fg cs2"><label class="fl">Access Key ID *</label>
                <input class="fi" id="st-s3-keyid" value="${H.esc(s3.accessKeyId||'')}" placeholder="AKIAIOSFODNN7EXAMPLE"></div>
              <div class="fg cs2"><label class="fl">Secret Access Key *</label>
                <input class="fi" id="st-s3-secret" type="password" value="${H.esc(s3.secretAccessKey||'')}" placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"></div>
              <div class="fg cs2"><label class="fl">Prefixo de pasta (opcional)</label>
                <input class="fi" id="st-s3-prefix" value="${H.esc(s3.prefixo||'evidencias/')}" placeholder="evidencias/"></div>
              <div class="fg cs2"><label class="fl">URL base pública (opcional — para buckets com acesso público)</label>
                <input class="fi" id="st-s3-urlbase" value="${H.esc(s3.url_base||'')}" placeholder="https://meu-bucket.s3.sa-east-1.amazonaws.com"></div>
              <div class="fg cs2">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
                  <input type="checkbox" id="st-s3-acl" ${s3.acl_publico?'checked':''}>
                  <span>Bucket público (ACL public-read) — se desmarcado, URLs assinadas são geradas automaticamente (válidas 1h)</span>
                </label>
              </div>
            </div>
            <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
              <button class="btn btn-o" id="btn-test-s3" onclick="Configs._testS3()">🔍 Testar Conexão S3</button>
              <span id="st-s3-test-result" style="font-size:12px"></span>
            </div>
          </div>
        </div>

        <!-- Google Drive -->
        <div id="st-gdrive-block" style="${provider!=='gdrive'?'display:none':''}">
          <div class="fsec">
            <div class="fsec-title">CONFIGURAÇÃO GOOGLE DRIVE</div>
            <div class="ibox info" style="margin-bottom:14px;font-size:12px">
              <strong>Como configurar:</strong> No Google Cloud Console, crie uma Service Account,
              gere uma chave JSON e compartilhe a pasta de destino do Drive com o e-mail da Service Account.
            </div>
            <div class="fgrid">
              <div class="fg cs2"><label class="fl">ID da Pasta de Destino *</label>
                <input class="fi" id="st-gd-folder" value="${H.esc(gdrive.folderId||'')}" placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz">
                <div class="hint">O ID está na URL da pasta: drive.google.com/drive/folders/<strong>ID_AQUI</strong></div>
              </div>
              <div class="fg cs2">
                <label class="fl">Service Account Key (arquivo JSON completo) *</label>
                <textarea class="fi" id="st-gd-key" rows="9"
                  placeholder='Cole aqui o conteúdo COMPLETO do arquivo .json baixado do Google Cloud Console.&#10;&#10;Deve começar com: {"type": "service_account", "project_id": "...", ...}&#10;&#10;NÃO cole uma API Key (AIzaSy...) nem apenas o e-mail — cole o arquivo JSON inteiro.'
                >${H.esc(typeof gdrive.serviceAccountKey==='string'?gdrive.serviceAccountKey:JSON.stringify(gdrive.serviceAccountKey||'',null,2))}</textarea>
                <div class="hint" style="color:var(--text3)">
                  📌 <strong>Como obter:</strong> Google Cloud Console → IAM e administrador → Contas de serviço → selecione a conta → Chaves → Adicionar chave → JSON → Baixar.
                  Cole o arquivo .json completo aqui. A conta precisa ter acesso à pasta informada acima.
                </div>
              </div>
            </div>
            <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
              <button class="btn btn-o" id="btn-test-gdrive" onclick="Configs._testGDrive()">🔍 Testar Conexão Drive</button>
              <span id="st-gd-test-result" style="font-size:12px"></span>
            </div>
          </div>
        </div>

        <!-- Local -->
        <div id="st-local-block" style="${provider!=='local'?'display:none':''}">
          <div class="ibox warn" style="margin-bottom:14px;font-size:12px">
            <strong>⚠ Armazenamento local:</strong> os arquivos são salvos na pasta <code>/app/uploads</code> do container.
            Em caso de reinicialização do container sem volume persistente os arquivos serão perdidos.
            Recomendado apenas para desenvolvimento ou testes.
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:20px">
          <button class="btn btn-a" onclick="Configs._saveStorage()">💾 Salvar Configuração</button>
        </div>
      </div>`;
  },

  _storageOnProviderChange() {
    const p = document.querySelector('input[name="st-provider"]:checked')?.value || 'local';
    ['s3','gdrive','local'].forEach(v => {
      const b = H.el(`st-${v==='s3'?'s3':v==='gdrive'?'gdrive':'local'}-block`);
      if (b) b.style.display = v === p ? '' : 'none';
    });
    // Atualiza bordas dos cards de provider
    document.querySelectorAll('input[name="st-provider"]').forEach(r => {
      const card = r.nextElementSibling;
      if (card) card.style.border = `2px solid ${r.checked ? 'var(--accent)' : 'var(--border)'}`;
    });
  },

  async _testS3() {
    const btn = H.el('btn-test-s3');
    const res = H.el('st-s3-test-result');
    btn.disabled = true; btn.textContent = '⏳ Testando...';
    res.style.color = 'var(--text3)'; res.textContent = '';
    try {
      const r = await API.testS3({ s3: {
        bucket: H.el('st-s3-bucket')?.value?.trim(),
        region: H.el('st-s3-region')?.value?.trim() || 'sa-east-1',
        accessKeyId: H.el('st-s3-keyid')?.value?.trim(),
        secretAccessKey: H.el('st-s3-secret')?.value?.trim(),
      }});
      res.style.color = 'var(--green)'; res.textContent = r.message || '✓ OK';
    } catch(e) {
      res.style.color = 'var(--red)'; res.textContent = e.message;
    } finally { btn.disabled = false; btn.textContent = '🔍 Testar Conexão S3'; }
  },

  async _testGDrive() {
    const btn = H.el('btn-test-gdrive');
    const res = H.el('st-gd-test-result');
    btn.disabled = true; btn.textContent = '⏳ Testando...';
    res.style.color = 'var(--text3)'; res.textContent = '';
    try {
      const rawKey = H.el('st-gd-key')?.value?.trim();

      // Valida JSON no frontend antes de enviar
      let key;
      try {
        key = JSON.parse(rawKey);
      } catch {
        res.style.color = 'var(--red)';
        res.textContent = 'JSON inválido — cole o arquivo .json completo da Service Account (não uma API Key).';
        return;
      }
      if (key.type !== 'service_account') {
        res.style.color = 'var(--red)';
        res.textContent = `JSON inválido: "type" esperado "service_account", encontrado "${key.type || '(vazio)'}".`;
        return;
      }

      const r = await API.testGDrive({ gdrive: {
        folderId: H.el('st-gd-folder')?.value?.trim(),
        serviceAccountKey: key,  // envia já parseado — evita double-parse no backend
      }});
      res.style.color = 'var(--green)'; res.textContent = r.message || '✓ Conexão OK';
    } catch(e) {
      res.style.color = 'var(--red)'; res.textContent = e.message;
    } finally { btn.disabled = false; btn.textContent = '🔍 Testar Conexão Drive'; }
  },

  async _saveStorage() {
    const provider = document.querySelector('input[name="st-provider"]:checked')?.value || 'local';
    const payload  = { provider };

    if (provider === 's3') {
      payload.s3 = {
        bucket:          H.el('st-s3-bucket')?.value?.trim(),
        region:          H.el('st-s3-region')?.value?.trim() || 'sa-east-1',
        accessKeyId:     H.el('st-s3-keyid')?.value?.trim(),
        secretAccessKey: H.el('st-s3-secret')?.value?.trim(),
        prefixo:         H.el('st-s3-prefix')?.value?.trim() || 'evidencias/',
        url_base:        H.el('st-s3-urlbase')?.value?.trim() || null,
        acl_publico:     H.el('st-s3-acl')?.checked || false,
      };
      if (!payload.s3.bucket || !payload.s3.accessKeyId || !payload.s3.secretAccessKey)
        return UI.toast('Preencha Bucket, Access Key ID e Secret Access Key', 'error');
    } else if (provider === 'gdrive') {
      const rawKey  = H.el('st-gd-key')?.value?.trim();
      const folderId = H.el('st-gd-folder')?.value?.trim();
      if (!folderId) return UI.toast('Informe o ID da pasta do Google Drive', 'error');
      if (!rawKey)   return UI.toast('Cole o JSON da Service Account', 'error');

      let key;
      try { key = JSON.parse(rawKey); } catch {
        return UI.toast('JSON da Service Account inválido — cole o conteúdo completo do arquivo .json', 'error');
      }
      if (key.type !== 'service_account')
        return UI.toast(`JSON inválido: "type" deve ser "service_account" (encontrado: "${key.type||'?'}")`, 'error');
      if (!key.client_email || !key.private_key)
        return UI.toast('JSON incompleto — faltam client_email e/ou private_key', 'error');

      payload.gdrive = { folderId, serviceAccountKey: key };
    }

    try {
      await API.saveStorage(payload);
      UI.toast('✓ Configuração de armazenamento salva', 'success');
    } catch(e) {
      UI.toast('Erro ao salvar: ' + e.message, 'error');
    }
  },
};
