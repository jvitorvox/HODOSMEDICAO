// ══════════════════════════════════════
// APP CONTROLLER
// ══════════════════════════════════════
const App = {
  async login() {
    const login = H.el('l-user').value.trim();
    const senha = H.el('l-pass').value.trim();
    if(!login || !senha) { UI.toast('Preencha usuário e senha','error'); return; }
    try {
      const r = await API.login(login, senha);
      const initials = (r.user.nome || r.user.login).split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
      State.user = { login: r.user.login, name: r.user.nome || r.user.login, role: r.user.perfil, grupos: r.user.grupos || [], initials };
      H.el('login-screen').style.display = 'none';
      H.el('app').style.display = 'flex';
      H.el('user-name').textContent = State.user.name;
      H.el('user-avatar').textContent = initials;
      H.el('user-role-badge').textContent = State.user.role;
      H.el('user-role-badge').className = `rbadge r${State.user.role}`;
      // Carrega e aplica permissões antes de navegar
      await this._loadPerms(State.user.grupos, State.user.role);
      this._applyNavPerms();
      await this.navigate('dashboard');
    } catch(e) {
      UI.toast(e.message || 'Erro no login', 'error');
    }
  },

  /** Resolve as permissões efetivas do usuário a partir do mapa de grupos */
  async _loadPerms(grupos, perfil) {
    if (perfil === 'ADM') { Perm.grantAll(); return; }
    try {
      const cfg = await API.config('permissoes');
      Perm.resolve(grupos, cfg?.valor || {});
    } catch { Perm.resolve(grupos, {}); }
  },

  /** Esconde/exibe itens de navegação e submenu de configurações conforme permissões */
  _applyNavPerms() {
    const navMap = {
      dashboard:      'dashboard',
      medicoes:       'verMedicoes',
      acompanhamento: 'acompanhamento',
      cadastros:      'cadastros',
      cronograma:     'cronograma',
      alcadas:        'alcadas',
      financeiro:     'financeiro',
      configuracoes:  'configuracoes',
    };
    document.querySelectorAll('.ni[data-page]').forEach(n => {
      const key = navMap[n.dataset.page];
      if (key) n.style.display = Perm.has(key) ? '' : 'none';
    });
    // Submenu de configurações: todos exigem permissão 'configuracoes'
    document.querySelectorAll('.cfg-menu-item[data-cfg]').forEach(i => {
      i.style.display = Perm.has('configuracoes') ? '' : 'none';
    });
    // Botões de cronograma (controle por permissão)
    const btnImport = H.el('cron-btn-import');
    if (btnImport) btnImport.style.display = Perm.has('cronogramaEditar') ? '' : 'none';
    const btnReplace = H.el('cron-btn-replace');
    if (btnReplace && !Perm.has('cronogramaEditar')) btnReplace.style.display = 'none';
    const btnDelete = H.el('cron-btn-delete');
    if (btnDelete && !Perm.has('cronogramaEditar')) btnDelete.style.display = 'none';
  },

  async navigate(page) {
    // Guarda: bloqueia acesso a páginas sem permissão
    const permMap = {
      medicoes: 'verMedicoes', acompanhamento: 'acompanhamento',
      cadastros: 'cadastros',  cronograma: 'cronograma',
      alcadas: 'alcadas',      configuracoes: 'configuracoes',
      financeiro: 'financeiro',
    };
    if (permMap[page] && !Perm.has(permMap[page])) {
      UI.toast('Sem permissão para acessar esta página', 'error');
      page = 'dashboard';
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.ni').forEach(n => n.classList.toggle('active', n.dataset.page === page));
    H.el(`page-${page}`).classList.add('active');
    H.el('content').scrollTop = 0; // reseta scroll ao trocar de página
    State.currentPage = page;
    this.closeNav();
    const loader = { dashboard: Pages.dashboard.bind(Pages), medicoes: Pages.medicoes.bind(Pages), acompanhamento: Pages.acompanhamento.bind(Pages), cadastros: Pages.cadastros.bind(Pages), cronograma: Cronograma.init.bind(Cronograma), alcadas: Pages.alcadas.bind(Pages), financeiro: Pages.financeiro.bind(Pages), configuracoes: Pages.configuracoes.bind(Pages) };
    if(loader[page]) await loader[page]();
  },
  logout() {
    API.logout();
    State.user = null;
    State.userPerms = {};
    H.el('app').style.display = 'none';
    H.el('login-screen').style.display = 'flex';
    H.el('l-user').value = '';
    H.el('l-pass').value = '';
    this._closeUserMenu();
  },

  toggleUserMenu() {
    const menu = H.el('user-menu');
    const isOpening = !menu.classList.contains('open');
    menu.classList.toggle('open');
    // Oculta "Trocar Senha" se o modo for LDAP
    if (isOpening) {
      const btnSenha = H.el('user-menu-senha');
      if (btnSenha) btnSenha.style.display = State.authMode === 'ldap' ? 'none' : '';
    }
  },

  _closeUserMenu() {
    H.el('user-menu')?.classList.remove('open');
  },

  openTrocarSenha() {
    this._closeUserMenu();
    // Bloqueia se for LDAP (sem senha_hash local)
    if (State.authMode === 'ldap') {
      UI.toast('Sua conta usa autenticação via AD. Altere a senha pelo Active Directory.', 'error');
      return;
    }
    H.el('ts-senha-atual').value = '';
    H.el('ts-nova-senha').value  = '';
    H.el('ts-conf-senha').value  = '';
    UI.openModal('modal-trocar-senha');
  },

  async _confirmarTrocarSenha() {
    const atual  = H.el('ts-senha-atual').value;
    const nova   = H.el('ts-nova-senha').value;
    const conf   = H.el('ts-conf-senha').value;
    if (!atual)        { UI.toast('Informe a senha atual', 'error'); return; }
    if (nova.length < 6) { UI.toast('A nova senha deve ter ao menos 6 caracteres', 'error'); return; }
    if (nova !== conf) { UI.toast('As senhas não coincidem', 'error'); return; }
    try {
      await API.trocarSenha(atual, nova);
      UI.toast('Senha alterada com sucesso!', 'success');
      UI.closeModal('modal-trocar-senha');
    } catch(e) { UI.toast('Erro: ' + e.message, 'error'); }
  },

  toggleNav() {
    const nav = H.el('t-nav');
    const overlay = H.el('nav-overlay');
    const isOpen = nav.classList.toggle('open');
    overlay.classList.toggle('open', isOpen);
  },
  closeNav() {
    H.el('t-nav')?.classList.remove('open');
    H.el('nav-overlay')?.classList.remove('open');
  },
};

// ══════════════════════════════════════
// EVENT LISTENERS
// ══════════════════════════════════════
document.querySelectorAll('.ni').forEach(n => {
  n.addEventListener('click', () => App.navigate(n.dataset.page));
});

document.querySelectorAll('.cfg-menu-item').forEach(i => {
  i.addEventListener('click', () => Pages.configuracoes(i.dataset.cfg));
});

document.querySelectorAll('#cad-tabs .tab').forEach(t => {
  t.addEventListener('click', () => Pages.cadastros(t.dataset.cad));
});

document.querySelectorAll('.mo').forEach(o => {
  o.addEventListener('click', e => { if(e.target === o) o.classList.remove('open'); });
});

document.addEventListener('keydown', e => {
  if(e.key==='Escape') document.querySelectorAll('.mo.open').forEach(m=>m.classList.remove('open'));
});

// Global function wrappers — movidos para o inline script no fim do index.html
// para garantir que todos os módulos já carregaram antes de expô-los como window.X

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
console.log('Construtivo AI v3.0 — conectando à API real');

// Detecta modo de autenticação e exibe no login
(async () => {
  try {
    const r = await fetch('/api/auth/mode');
    if(r.ok) {
      const m = await r.json();
      State.authMode = m.mode || 'local';
      const el = H.el('l-auth-mode');
      if(el) {
        if(m.mode === 'ldap') {
          el.innerHTML = `🏢 Autenticação via Active Directory <span style="color:var(--green);font-weight:600">(AD ativo)</span>`;
          const ph = H.el('l-user');
          if(ph) ph.placeholder = 'usuario.ad';
        } else {
          el.innerHTML = '🔒 Autenticação local';
        }
      }
    }
  } catch(_) { /* sem conexão, ignora */ }
})();

// Fecha dropdown do usuário ao clicar fora
document.addEventListener('click', e => {
  const chip = document.querySelector('.user-chip');
  const menu = H.el('user-menu');
  if (menu && chip && !chip.contains(e.target)) {
    menu.classList.remove('open');
  }
});
