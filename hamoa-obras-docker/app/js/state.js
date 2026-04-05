// ══════════════════════════════════════
// APP STATE
// ══════════════════════════════════════
const State = {
  user: null,
  userPerms: {},   // permissões efetivas resolvidas após login
  authMode: 'local', // 'local' | 'ldap' — detectado no init
  currentPage: 'dashboard',
  editingId: null,
  currentMedicaoId: null,
  currentActionMedicaoId: null,
  cache: { empresas:[], obras:[], fornecedores:[], contratos:[], alcadas:[] },
};

// ── Verificador de permissões ─────────────────────────────────────────
const Perm = {
  /** Chaves válidas de permissão */
  _keys: ['dashboard','verMedicoes','criarMedicao','aprovarN1','aprovarN2','aprovarN3',
          'acompanhamento','cadastros','alcadas','configuracoes','enviarAssinatura',
          'cronograma','cronogramaEditar','cronogramaVinculos','cronogramaIA'],

  /** Retorna true se o usuário logado possui a permissão */
  has(key) {
    if (!State.user) return false;
    if (State.user.role === 'ADM') return true;
    return !!State.userPerms[key];
  },

  /** Resolve as permissões efetivas a partir dos grupos do usuário e do mapa de permissões */
  resolve(grupos, permsMap) {
    const resolved = {};
    this._keys.forEach(k => {
      resolved[k] = grupos.some(g => permsMap[g]?.[k] === true);
    });
    State.userPerms = resolved;
  },

  /** ADM: todas as permissões ativas */
  grantAll() {
    const all = {};
    this._keys.forEach(k => all[k] = true);
    State.userPerms = all;
  },
};

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
const H = {
  esc(s) { if(s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },
  fmt(v) { return v != null ? Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'; },
  fmtDate(iso) { if(!iso) return '—'; const d=new Date(iso); return d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); },
  fmtDateShort(iso) { if(!iso) return '—'; return new Date(iso).toLocaleDateString('pt-BR'); },
  periodoLabel(p) { if(!p) return '—'; const [y,m]=p.split('-'); const meses=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']; return (meses[parseInt(m)-1]||m)+'/'+y; },
  statusBadge(s) {
    const map = { 'Rascunho':'b-draft', 'Aguardando N1':'b-n1', 'Aguardando N2':'b-n2', 'Aguardando N3':'b-n3', 'Aprovado':'b-aprovado', 'Em Assinatura':'b-assinatura', 'Concluído':'b-concluido', 'Reprovado':'b-reprovado' };
    return `<span class="badge ${map[s]||'b-draft'}">${s||'Rascunho'}</span>`;
  },
  // Badge para status de cadastros (obras, contratos) — sem relação com alçadas
  statusBadgeCad(s) {
    const map = {
      // Obras
      'Em andamento': 'b-ativo',
      'Concluído':    'b-concluido',
      'Paralisado':   'b-suspenso',
      // Contratos
      'Vigente':      'b-ativo',
      'Encerrado':    'b-concluido',
      'Suspenso':     'b-suspenso',
    };
    return `<span class="badge ${map[s]||'b-draft'}">${s||'—'}</span>`;
  },
  tipoBadge(tipo) {
    if (!tipo || tipo === 'Normal') return '';
    if (tipo === 'Adiantamento')   return `<span class="med-tipo-badge med-tipo-adt">💰 ADT</span>`;
    if (tipo === 'Avanco_Fisico')  return `<span class="med-tipo-badge med-tipo-avfis">📐 AV.FÍS</span>`;
    return '';
  },
  progressBar(pct, cls='') { return `<div class="pw"><div class="pb"><div class="pf ${cls}" style="width:${Math.min(pct,100)}%"></div></div><span class="pp">${pct}%</span></div>`; },
  nextLevel(status) {
    if(status==='Aguardando N1') return 'N1';
    if(status==='Aguardando N2') return 'N2';
    if(status==='Aguardando N3') return 'N3';
    return null;
  },
  canApprove(status, medicao) {
    const u = State.user;
    if(!u) return false;
    const level = this.nextLevel(status);
    if(!level) return false;  // status não é aprovável (já aprovado, rascunho, etc.)
    if(u.role === 'ADM') return true;
    // Primeira barreira: permissão do grupo AD (Perm) deve autorizar o nível
    const permKey = `aprovar${level}`; // 'aprovarN1' | 'aprovarN2' | 'aprovarN3'
    if(!Perm.has(permKey)) return false;
    // Segunda barreira: alçada configurada para a obra/empresa (grupos da alçada)
    if(medicao && State.cache.alcadas && State.cache.alcadas.length) {
      const alc = State.cache.alcadas.find(a => a.ativo && a.empresa_id === medicao.empresa_id && a.obra_id === medicao.obra_id)
               || State.cache.alcadas.find(a => a.ativo && a.empresa_id === medicao.empresa_id && !a.obra_id);
      if(alc) {
        const pfx = level.toLowerCase(); // 'n1', 'n2', 'n3'
        const grupos = alc[`${pfx}_grupos`] || [];
        const userGrupos = u.grupos || [];
        if(grupos.length > 0) {
          // Usuário precisa estar em pelo menos um dos grupos configurados na alçada
          return userGrupos.some(g => grupos.includes(g));
        }
        // Alçada existe mas sem grupos configurados: já passou pelo Perm, libera
        return true;
      }
    }
    // Sem alçada configurada: já passou pelo Perm, libera
    return true;
  },
  genCodigo() {
    const d = new Date();
    const aamm = String(d.getFullYear()).slice(2) + String(d.getMonth()+1).padStart(2,'0');
    const seq = String(Math.floor(Math.random()*900)+100);
    return `MED-${aamm}-${seq}`;
  },
  el(id) { return document.getElementById(id); },
  optionsHtml(arr, valKey, lblKey, selected) {
    return arr.map(a => `<option value="${a[valKey]}" ${a[valKey]==selected?'selected':''}>${a[lblKey]}</option>`).join('');
  },
};

// ══════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════
const UI = {
  openModal(id) { H.el(id).classList.add('open'); },
  closeModal(id) { H.el(id).classList.remove('open'); },
  toast(msg, type='default') {
    const wrap = H.el('toast');
    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    const icons = { success:'✓', error:'✗', info:'ℹ', default:'•' };
    el.innerHTML = `<span style="font-size:14px">${icons[type]||'•'}</span><span>${msg}</span>`;
    wrap.appendChild(el);
    setTimeout(() => { el.style.animation='toastOut .3s ease forwards'; setTimeout(()=>el.remove(),300); }, 3500);
  },
  loading(containerId, msg='Carregando...') { H.el(containerId).innerHTML = `<div class="loading">${msg}</div>`; },
  switchTab(tabsId, activeTab, key) {
    document.querySelectorAll(`#${tabsId} .tab`).forEach(t => t.classList.toggle('active', t.dataset[key] === activeTab));
  },
};
