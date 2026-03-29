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
      State.user = { login: r.user.login, name: r.user.nome || r.user.login, role: r.user.perfil, initials };
      H.el('login-screen').style.display = 'none';
      H.el('app').style.display = 'flex';
      H.el('user-name').textContent = State.user.name;
      H.el('user-avatar').textContent = initials;
      H.el('user-role-badge').textContent = State.user.role;
      H.el('user-role-badge').className = `rbadge r${State.user.role}`;
      await this.navigate('dashboard');
    } catch(e) {
      UI.toast(e.message || 'Erro no login', 'error');
    }
  },
  async navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.ni').forEach(n => n.classList.toggle('active', n.dataset.page === page));
    H.el(`page-${page}`).classList.add('active');
    State.currentPage = page;
    this.closeNav();
    const loader = { dashboard: Pages.dashboard.bind(Pages), medicoes: Pages.medicoes.bind(Pages), acompanhamento: Pages.acompanhamento.bind(Pages), cadastros: Pages.cadastros.bind(Pages), cronograma: Cronograma.init.bind(Cronograma), alcadas: Pages.alcadas.bind(Pages), configuracoes: Pages.configuracoes.bind(Pages) };
    if(loader[page]) await loader[page]();
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

// Global function wrappers for onclick attributes
window.Medicoes   = Medicoes;
window.Cadastros  = Cadastros;
window.Alcadas    = Alcadas;
window.Configs    = Configs;
window.Pages      = Pages;
window.App        = App;
window.UI         = UI;
window.H          = H;
window.Cronograma = Cronograma;

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
console.log('JMD HAMOA OBRAS v3.0 — conectando à API real');

// Detecta modo de autenticação e exibe no login
(async () => {
  try {
    const r = await fetch('/api/auth/mode');
    if(r.ok) {
      const m = await r.json();
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
