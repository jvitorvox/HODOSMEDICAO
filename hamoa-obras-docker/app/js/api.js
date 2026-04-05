'use strict';

// ══════════════════════════════════════

// ══════════════════════════════════════
// API MODULE (substitui IndexedDB)
// ══════════════════════════════════════
const API = (() => {
  function _getToken() { return sessionStorage.getItem('hamoa_token'); }
  function _setToken(t) { if(t) sessionStorage.setItem('hamoa_token', t); else sessionStorage.removeItem('hamoa_token'); }

  // Upload multipart — usa sessionStorage igual ao req() normal
  // extraFields: objeto opcional com campos adicionais a incluir no FormData
  function _uploadIA(endpoint, file, extraFields) {
    const fd = new FormData();
    fd.append('arquivo', file);
    if (extraFields && typeof extraFields === 'object') {
      Object.entries(extraFields).forEach(([k, v]) => { if (v != null) fd.append(k, v); });
    }
    const token = _getToken();
    return fetch(endpoint, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    });
  }

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    const t = _getToken();
    if(t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  async function req(method, path, body) {
    const opts = { method, headers: headers() };
    if(body !== undefined) opts.body = JSON.stringify(body);
    let r;
    try { r = await fetch(path, opts); } catch(e) { throw new Error('Sem conexão com o servidor'); }
    if(r.status === 401) { const ed = await r.json().catch(()=>({})); _setToken(null); H.el('app').style.display='none'; H.el('login-screen').style.display='flex'; throw new Error(ed.error || 'Sessão expirada'); }
    if(r.status === 204) return null;
    const data = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(data.error || r.statusText);
    return data;
  }

  return {
    login: async (login, senha) => { const r = await req('POST', '/api/auth/login', { login, senha }); _setToken(r.token); return r; },
    logout: () => _setToken(null),
    isLoggedIn: () => !!_getToken(),
    trocarSenha: (senha_atual, nova_senha) => req('PUT', '/api/auth/senha', { senha_atual, nova_senha }),
    _req: req, // exposto para uso interno de módulos (ex: Configs.audit)

    empresas:       () => req('GET', '/api/empresas'),
    createEmpresa:  (d) => req('POST', '/api/empresas', d),
    updateEmpresa:  (id, d) => req('PUT', `/api/empresas/${id}`, d),
    deleteEmpresa:  (id) => req('DELETE', `/api/empresas/${id}`),

    obras:      (empresa_id) => req('GET', '/api/obras' + (empresa_id ? `?empresa_id=${empresa_id}` : '')),
    createObra: (d) => req('POST', '/api/obras', d),
    updateObra: (id, d) => req('PUT', `/api/obras/${id}`, d),
    deleteObra: (id) => req('DELETE', `/api/obras/${id}`),

    fornecedores:       () => req('GET', '/api/fornecedores'),
    createFornecedor:   (d) => req('POST', '/api/fornecedores', d),
    updateFornecedor:   (id, d) => req('PUT', `/api/fornecedores/${id}`, d),
    deleteFornecedor:   (id) => req('DELETE', `/api/fornecedores/${id}`),

    contratos: (filters) => {
      if(!filters) return req('GET', '/api/contratos');
      if(typeof filters === 'number' || typeof filters === 'string') return req('GET', `/api/contratos?obra_id=${filters}`); // compatibilidade legada
      const qs = Object.entries(filters).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
      return req('GET', '/api/contratos' + (qs ? `?${qs}` : ''));
    },
    createContrato:  (d) => req('POST', '/api/contratos', d),
    updateContrato:  (id, d) => req('PUT', `/api/contratos/${id}`, d),
    deleteContrato:  (id) => req('DELETE', `/api/contratos/${id}`),
    contratoItens:   (id) => req('GET', `/api/contratos/${id}/itens`),
    acumulados:              (contrato_id) => req('GET', `/api/contratos/${contrato_id}/acumulados`),
    adiantamentosPendentes:  (contrato_id) => req('GET', `/api/medicoes/adiantamentos-pendentes?contrato_id=${contrato_id}`),

    medicoes: (filters) => {
      const params = filters ? Object.entries(filters).filter(([,v])=>v).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&') : '';
      return req('GET', '/api/medicoes' + (params ? '?' + params : ''));
    },
    medicao:        (id) => req('GET', `/api/medicoes/${id}`),
    createMedicao:  (d) => req('POST', '/api/medicoes', d),
    updateMedicao:  (id, d) => req('PUT', `/api/medicoes/${id}`, d),
    aprovar:          (id, comentario) => req('POST', `/api/medicoes/${id}/aprovar`, { comentario }),
    reprovar:         (id, motivo) => req('POST', `/api/medicoes/${id}/reprovar`, { motivo }),
    enviarAssinatura: (id, dados) => req('POST', `/api/medicoes/${id}/enviar-assinatura`, dados),
    descompasso: (filters) => {
      const params = filters ? Object.entries(filters).filter(([,v])=>v).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&') : '';
      return req('GET', '/api/medicoes/descompasso' + (params ? '?' + params : ''));
    },

    alcadas:       () => req('GET', '/api/alcadas'),
    createAlcada:  (d) => req('POST', '/api/alcadas', d),
    updateAlcada:  (id, d) => req('PUT', `/api/alcadas/${id}`, d),
    deleteAlcada:  (id) => req('DELETE', `/api/alcadas/${id}`),

    config:     (chave) => req('GET', `/api/config/${chave}`),
    saveConfig: (chave, valor) => req('PUT', `/api/config/${chave}`, valor),
    testLdap:      (cfg) => req('POST', '/api/config/ldap/test', cfg),
    testClickSign: (cfg) => req('POST', '/api/config/clicksign/test', cfg),

    // Upload de arquivo (multipart/form-data) — não usa req() genérico
    interpretarContrato:   (file, obraId) => _uploadIA('/api/contratos/interpretar', file, obraId ? { obra_id: obraId } : undefined),
    interpretarFornecedor: (file) => _uploadIA('/api/fornecedores/interpretar', file),

    dashboard: () => req('GET', '/api/dashboard'),

    // ── Cronogramas ──────────────────────────────────────────────
    cronogramas:        (obraId) => req('GET', '/api/cronogramas' + (obraId ? `?obra_id=${obraId}` : '')),
    cronograma:         (id) => req('GET', `/api/cronogramas/${id}`),
    cronogramaAtividades: (id) => req('GET', `/api/cronogramas/${id}/atividades`),
    cronogramaFinanceiro: (id) => req('GET', `/api/cronogramas/${id}/financeiro`),
    updateCronograma:   (id, d) => req('PUT', `/api/cronogramas/${id}`, d),
    deleteCronograma:   (id) => req('DELETE', `/api/cronogramas/${id}`),
    updateAtividadePct: (id, pct) => req('PUT', `/api/cronogramas/atividades/${id}/pct`, { pct_realizado: pct }),
    updateAtividade:    (id, d)   => req('PUT', `/api/cronogramas/atividades/${id}`, d),
    exportCronogramaXml: (id, nome) => {
      const token = _getToken();
      return fetch(`/api/cronogramas/${id}/export-xml`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = (nome || 'cronograma').replace(/[^a-zA-Z0-9_\-.]/g, '_') + '.xml';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
      });
    },
    importarCronograma: (obraId, nome, file, replaceId) => {
      const fd = new FormData();
      fd.append('arquivo', file);
      fd.append('obra_id', obraId);
      fd.append('nome', nome);
      if (replaceId) fd.append('replace_id', replaceId);
      const token = _getToken();
      return fetch('/api/cronogramas/importar', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      }).then(async r => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        return d;
      });
    },

    // ── Atividades vinculadas ao contrato ────────────────────────
    contratoAtividades:            (id) => req('GET', `/api/contratos/${id}/atividades`),
    contratoAtividadesDisponiveis: (id) => req('GET', `/api/contratos/${id}/cronograma-atividades-disponiveis`),
    saveContratoAtividades:        (id, ids) => req('POST', `/api/contratos/${id}/atividades`, { atividade_ids: ids }),
    cronogramaContratosVinculos:   (id) => req('GET', `/api/cronogramas/${id}/contratos-vinculos`),
    cronogramaChat: (id, message, history) => req('POST', `/api/cronogramas/${id}/chat`, { message, history }),

    // ── Usuários ─────────────────────────────────────────────────
    usuarios:             ()       => req('GET',    '/api/usuarios'),
    usuario:              (id)     => req('GET',    `/api/usuarios/${id}`),
    createUsuario:        (d)      => req('POST',   '/api/usuarios', d),
    updateUsuario:        (id, d)  => req('PUT',    `/api/usuarios/${id}`, d),
    deleteUsuario:        (id)     => req('DELETE', `/api/usuarios/${id}`),
    resetSenhaUsuario:    (id, senha) => req('PUT', `/api/usuarios/${id}/senha`, { senha }),

    // ── Evidências de Medição ─────────────────────────────────────
    evidencias:       (medicaoId)       => req('GET',    `/api/medicoes/${medicaoId}/evidencias`),
    deleteEvidencia:  (medicaoId, evId) => req('DELETE', `/api/medicoes/${medicaoId}/evidencias/${evId}`),

    // Upload de evidências — FormData com múltiplos arquivos
    uploadEvidencias(medicaoId, files, onProgress) {
      return new Promise((resolve, reject) => {
        const fd  = new FormData();
        for (const f of files) fd.append('files', f);
        const token = _getToken();
        const xhr   = new XMLHttpRequest();
        xhr.open('POST', `/api/medicoes/${medicaoId}/evidencias`);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        if (onProgress) xhr.upload.onprogress = onProgress;
        xhr.onload = () => {
          try {
            const d = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(d);
            else reject(new Error(d.error || `HTTP ${xhr.status}`));
          } catch { reject(new Error('Resposta inválida do servidor')); }
        };
        xhr.onerror = () => reject(new Error('Erro de rede ao enviar arquivo'));
        xhr.send(fd);
      });
    },

    // ── Configuração de Armazenamento ─────────────────────────────
    configStorage:    ()    => req('GET',  '/api/config/storage'),
    saveStorage:      (d)   => req('PUT',  '/api/config/storage', d),
    testS3:           (d)   => req('POST', '/api/config/storage/test-s3',     d),
    testGDrive:       (d)   => req('POST', '/api/config/storage/test-gdrive', d),
  };
})();
