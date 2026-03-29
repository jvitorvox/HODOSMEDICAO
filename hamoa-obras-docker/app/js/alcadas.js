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
    const telas = [['dashboard','Dashboard'],['verMedicoes','Ver Medições'],['criarMedicao','Criar Medição'],['aprovarN1','Aprovar N1'],['aprovarN2','Aprovar N2'],['aprovarN3','Aprovar N3'],['acompanhamento','Acompanhamento'],['cadastros','Cadastros'],['alcadas','Alçadas'],['configuracoes','Configurações']];
    H.el('cfg-content').innerHTML = `
    <div style="margin-bottom:18px"><div style="font-family:var(--font-d);font-size:22px;letter-spacing:2px;color:var(--text)">PERMISSÕES POR GRUPO DO AD</div></div>
    <div style="margin-bottom:16px;display:flex;gap:10px;align-items:center">
      <input class="si" id="cfg-perm-novogrupo" placeholder="Nome do grupo AD" style="max-width:300px">
      <button class="btn btn-o btn-sm" onclick="Configs._addGrupo()">+ Adicionar Grupo</button>
      <button class="btn btn-a btn-sm" onclick="Configs._savePerms()">💾 Salvar Permissões</button>
    </div>
    <div style="overflow-x:auto"><table class="pt2">
      <thead><tr><th>Tela</th>${grupos.map(g=>`<th style="font-family:var(--font-m);font-size:9px">${g}</th>`).join('')}</tr></thead>
      <tbody>${telas.map(([key,lbl]) => `<tr><td>${lbl}</td>${grupos.map(g=>`<td><input type="checkbox" id="perm-${g}-${key}" ${perms[g]?.[key]?'checked':''} style="accent-color:var(--green);cursor:pointer;width:14px;height:14px"></td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  },
  async _addGrupo() {
    const nome = H.el('cfg-perm-novogrupo')?.value.trim();
    if(!nome){UI.toast('Informe o nome do grupo','error');return;}
    const cfg = await API.config('permissoes').catch(()=>null);
    const perms = cfg ? cfg.valor : {};
    if(perms[nome]){UI.toast('Grupo já existe','error');return;}
    perms[nome] = { dashboard:false,verMedicoes:false,criarMedicao:false,aprovarN1:false,aprovarN2:false,aprovarN3:false,acompanhamento:false,cadastros:false,alcadas:false,configuracoes:false };
    try { await API.saveConfig('permissoes', perms); UI.toast(`Grupo ${nome} adicionado`,'success'); await this.permissoes(); } catch(e){UI.toast('Erro: '+e.message,'error');}
  },
  async _savePerms() {
    const cfg = await API.config('permissoes').catch(()=>null);
    const perms = cfg ? cfg.valor : {};
    const telas = ['dashboard','verMedicoes','criarMedicao','aprovarN1','aprovarN2','aprovarN3','acompanhamento','cadastros','alcadas','configuracoes'];
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
};
