/**
 * Rotas de integração com o ERP UAU (Senior / Globaltec)
 *
 * GET  /api/uau/test        → testa conexão com a API UAU (proxy — evita CORS)
 * POST /api/uau/autenticar  → autentica usuário no UAU e retorna token
 */

const express = require('express');
const router  = express.Router();
const auth = require('../middleware/auth');
console.log('[uau] Módulo carregado — v2 (trata retorno 0 como sucesso)');

// ── Helper: lê configuração UAU do banco ─────────────────────────
const db = require('../db');

async function _getUauCfg() {
  const r = await db.query(`SELECT valor FROM configuracoes WHERE chave = 'uau'`);
  if (!r.rows[0]) throw new Error('Configuração UAU não encontrada');
  return r.rows[0].valor;
}

// ── Helper: monta URL base normalizada ──────────────────────────
function _baseUrl(cfg) {
  // Remove trailing slash da url e garante /api/v{versao}
  const url    = (cfg.api_url || '').replace(/\/+$/, '');
  const versao = (cfg.api_versao || '1').replace(/\/+$/, '');
  return `${url}/api/v${versao}`;
}

// ── Helper: headers padrão UAU ───────────────────────────────────
function _headers(cfg, userToken) {
  const h = {
    'Content-Type':            'application/json',
    'X-INTEGRATION-Authorization': cfg.api_key || '',
  };
  if (userToken) h['Authorization'] = userToken;
  return h;
}

// ════════════════════════════════════════════════════════════════
// GET /api/uau/test
// Testa conexão real: autentica com login/senha configurados e verifica
// se retorna token. Só considera OK se a autenticação for bem-sucedida.
// ════════════════════════════════════════════════════════════════
router.get('/test', auth, async (req, res) => {
  try {
    const cfg  = await _getUauCfg();
    if (!cfg.api_url)  return res.status(400).json({ ok: false, message: 'URL da API UAU não configurada' });
    if (!cfg.api_key)  return res.status(400).json({ ok: false, message: 'Token de integração (X-INTEGRATION-Authorization) não configurado' });
    if (!cfg.login)    return res.status(400).json({ ok: false, message: 'Login UAU não configurado — preencha o campo Login UAU' });
    if (!cfg.senha)    return res.status(400).json({ ok: false, message: 'Senha UAU não configurada' });

    const base = _baseUrl(cfg);
    const url  = `${base}/Autenticador/AutenticarUsuario`;

    const r = await fetch(url, {
      method:  'POST',
      headers: _headers(cfg),
      body:    JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });

    let data = {};
    try { data = await r.json(); } catch { try { data = { raw: await r.text() }; } catch {} }

    if (r.ok || r.status === 200) {
      // Autenticação bem-sucedida — token pode vir no header ou no body
      const token = r.headers.get('Authorization') || data?.token || data?.Token || '(recebido)';
      return res.json({
        ok:      true,
        status:  r.status,
        message: `✓ Autenticação bem-sucedida — usuário ${cfg.login} autenticado no UAU`,
        token:   token ? token.slice(0, 40) + '…' : null,
        url,
      });
    }

    // Falha de autenticação — mostra mensagem do UAU
    const uauMsg = data?.Message || data?.message || data?.raw || JSON.stringify(data).slice(0, 200);
    return res.json({
      ok:      false,
      status:  r.status,
      message: `✗ Falha na autenticação (HTTP ${r.status})`,
      detail:  uauMsg,
      url,
    });

  } catch (err) {
    console.error('[uau/test]', err.message);
    return res.status(502).json({ ok: false, message: 'Não foi possível alcançar a API UAU: ' + err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/uau/autenticar
// Body: { login_ad?, senha, login_uau? }
// Autentica no UAU e devolve o token Authorization para uso posterior.
// ════════════════════════════════════════════════════════════════
router.post('/autenticar', auth, async (req, res) => {
  try {
    const cfg  = await _getUauCfg();
    if (!cfg.api_url) return res.status(400).json({ error: 'UAU não configurado' });

    const base = _baseUrl(cfg);
    const { login_ad, senha, login_uau, Login, Senha } = req.body;

    let url, body;
    if (login_ad) {
      // Autenticação AD corporativa
      url  = `${base}/Autenticador/AutenticarUsuarioCorporativo`;
      body = { login_ad, senha, login_uau };
    } else {
      // Autenticação padrão UAU
      url  = `${base}/Autenticador/AutenticarUsuario`;
      body = { Login: Login || login_uau, Senha: Senha || senha };
    }

    const r = await fetch(url, {
      method:  'POST',
      headers: _headers(cfg),
      body:    JSON.stringify(body),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: data?.Message || `UAU retornou HTTP ${r.status}`, detail: data });

    // O token UAU vem no header Authorization da resposta
    const token = r.headers.get('Authorization') || data?.token || data?.Token || null;
    return res.json({ ok: true, token, data });

  } catch (err) {
    console.error('[uau/autenticar]', err.message);
    return res.status(502).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/uau/pedido-compra
// Body: { pedidoId, listaDadosItemPedido }
// 1. Autentica no UAU com login/senha da config
// 2. Busca dados da obra/contrato do pedido
// 3. Chama GravarPedidoDeCompraDoTipoMaterial
// 4. Se OK: marca pedido como 'aprovado' no Construtivo
// ════════════════════════════════════════════════════════════════
router.post('/pedido-compra', auth, async (req, res) => {
  const client = await db.connect();
  try {
    const cfg = await _getUauCfg();
    if (!cfg.api_url || !cfg.ativo) {
      return res.status(400).json({ ok: false, error: 'Integração UAU não está ativa ou configurada' });
    }
    if (!cfg.login || !cfg.senha) {
      return res.status(400).json({ ok: false, error: 'Login/Senha UAU não configurados em Configurações → Integração ERP' });
    }

    const { pedidoId, listaDadosItemPedido } = req.body;
    if (!pedidoId) return res.status(400).json({ ok: false, error: 'pedidoId é obrigatório' });

    // ── 1. Busca dados do pedido + obra + contrato ───────────────
    const pedR = await client.query(`
      SELECT
        rm.*,
        o.uau_obra, o.uau_obra_fiscal, o.nome AS obra_nome,
        emp.uau_empresa AS empresa_uau_codigo,
        c.uau_empresa   AS contrato_uau_empresa, c.uau_contrato
      FROM req_materiais rm
      LEFT JOIN obras      o   ON o.id  = rm.obra_id
      LEFT JOIN empresas   emp ON emp.id = o.empresa_id
      LEFT JOIN contratos  c   ON c.id  = rm.contrato_id
      WHERE rm.id = $1
    `, [pedidoId]);

    if (!pedR.rows[0]) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    const ped = pedR.rows[0];

    // Prioridade: empresa.uau_empresa > contrato.uau_empresa > config global
    const codigoEmpresa   = ped.empresa_uau_codigo || ped.contrato_uau_empresa || cfg.empresa_codigo;
    const codigoObra      = ped.uau_obra;
    const codigoObraFiscal = ped.uau_obra_fiscal;

    if (!codigoObra)       return res.status(400).json({ ok: false, error: `Obra "${ped.obra_nome}" não possui código UAU cadastrado. Configure em Cadastros → Obras.` });
    if (!codigoObraFiscal) return res.status(400).json({ ok: false, error: `Obra "${ped.obra_nome}" não possui código de obra fiscal UAU. Configure em Cadastros → Obras.` });
    if (!codigoEmpresa)    return res.status(400).json({ ok: false, error: 'Código da empresa UAU não configurado. Configure em Configurações → Integração ERP ou no cadastro do contrato.' });

    // ── 2. Autentica no UAU ──────────────────────────────────────
    const base    = _baseUrl(cfg);
    const authUrl = `${base}/Autenticador/AutenticarUsuario`;
    const authR   = await fetch(authUrl, {
      method:  'POST',
      headers: _headers(cfg),
      body:    JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });

    // UAU retorna o token JWT como string JSON no body (ex: "eyJhbGci...")
    // Lê como texto e parseia — se o resultado for string, esse é o token
    const authRaw = await authR.text().catch(() => '');
    let authParsed;
    try { authParsed = JSON.parse(authRaw); } catch { authParsed = null; }

    if (!authR.ok) {
      const detail = (typeof authParsed === 'object' && authParsed)
        ? (authParsed?.Message || authParsed?.message || `HTTP ${authR.status}`)
        : authRaw.slice(0, 200);
      return res.status(401).json({ ok: false, error: 'Falha na autenticação UAU', detail });
    }

    // Prioridade: header Authorization → objeto com campo token → body é o token diretamente
    const userToken =
      authR.headers.get('Authorization') ||
      (typeof authParsed === 'object' && authParsed
        ? (authParsed.token || authParsed.Token || authParsed.access_token || authParsed.AccessToken || '')
        : '') ||
      (typeof authParsed === 'string' && authParsed.length > 20 ? authParsed : '') ||
      '';

    // ── 3. Envia pedido de compra ────────────────────────────────
    const payload = {
      dadosPedido: {
        codigoEmpresa:    parseInt(codigoEmpresa),
        codigoObra:       String(codigoObra),
        codigoObraFiscal: String(codigoObraFiscal),
        usuario:          cfg.login,
        observacao:       ped.observacao || `Pedido via Construtivo - ${ped.codigo || ped.id}`,
      },
      listaDadosItemPedido: listaDadosItemPedido || [],
    };


    const pcUrl = `${base}/PedidoCompra/GravarPedidoDeCompraDoTipoMaterial`;
    const pcR   = await fetch(pcUrl, {
      method:  'POST',
      headers: _headers(cfg, userToken),
      body:    JSON.stringify(payload),
    });

    let pcData;
    try { pcData = await pcR.json(); } catch { pcData = null; }


    // UAU retorna array: ["numeroPedido", "codigoErro", "mensagem"]
    //   pcData[0] = número do pedido (ex: "3412")
    //   pcData[1] = "0" significa SEM ERRO; qualquer outro valor não-vazio é erro
    //   pcData[2] = mensagem descritiva do erro (opcional)
    let numeroPedido, uauErro;
    if (typeof pcData === 'number') {
      numeroPedido = pcData;
      uauErro = null;
    } else if (Array.isArray(pcData)) {
      numeroPedido = pcData[0];
      const errCod = String(pcData[1] ?? '').trim();
      const errMsg = String(pcData[2] ?? '').trim();
      // "0" = sem erro; "" ou ausente = sem erro; qualquer outro código = erro
      const temErro = errCod !== '' && errCod !== '0';
      uauErro = temErro ? (errMsg || `Código de erro UAU: ${errCod}`) : null;
    } else {
      numeroPedido = pcData?.numeroPedido ?? null;
      uauErro = pcData?.Message || pcData?.message || pcData?.Mensagem || null;
    }

    // Considera sucesso se tem numeroPedido válido e sem erro UAU
    const foiCriado = numeroPedido !== null && numeroPedido !== undefined && numeroPedido !== '';
    if (uauErro || (!foiCriado && !pcR.ok)) {
      return res.status(pcR.ok ? 400 : pcR.status).json({
        ok:     false,
        error:  'UAU recusou o pedido de compra',
        detail: uauErro || JSON.stringify(pcData).slice(0, 400),
      });
    }

    // ── 4. Aprova cada item do pedido no UAU ─────────────────────
    // AprovarPedidoCompraMaterialApp — obrigatórios: codigo_empresa, codigo_obra,
    // insumo, item_ped (sequencial 1..n), num_pedido
    const aprovarUrl  = `${base}/PedidoCompra/AprovarPedidoCompraMaterialApp`;
    const numPedidoInt = parseInt(numeroPedido, 10);
    const aprovacoes  = [];

    for (let i = 0; i < (listaDadosItemPedido || []).length; i++) {
      const item = listaDadosItemPedido[i];
      const aprovBody = {
        codigo_empresa: parseInt(codigoEmpresa),
        codigo_obra:    String(codigoObra),
        insumo:         item.codigoInsumo,
        item_ped:       i + 1,          // sequencial 1-based
        num_pedido:     numPedidoInt,
      };

      try {
        const apR = await fetch(aprovarUrl, {
          method:  'POST',
          headers: _headers(cfg, userToken),
          body:    JSON.stringify(aprovBody),
        });
        let apData;
        try { apData = await apR.json(); } catch { apData = null; }
        console.log(`[uau/aprovar] item ${i + 1} (${item.codigoInsumo}) → HTTP ${apR.status}`, JSON.stringify(apData));
        aprovacoes.push({ item: i + 1, insumo: item.codigoInsumo, ok: apR.ok, data: apData });
      } catch (apErr) {
        console.error(`[uau/aprovar] item ${i + 1} erro:`, apErr.message);
        aprovacoes.push({ item: i + 1, insumo: item.codigoInsumo, ok: false, error: apErr.message });
      }
    }

    const todosAprovados = aprovacoes.every(a => a.ok);
    const obsAprovacao   = todosAprovados
      ? `Itens aprovados automaticamente no UAU`
      : `Aprovação parcial no UAU — ${aprovacoes.filter(a => !a.ok).length} item(s) não aprovado(s)`;

    // ── 5. Marca pedido como aprovado no Construtivo ─────────────
    // Extrai data_entrega do primeiro item do payload (global para todos os itens)
    const primeiroItem = (listaDadosItemPedido || [])[0];
    const dataEntregaRaw = primeiroItem?.dataEntrega || null; // formato MM/DD/YYYY
    let dataEntregaIso = null;
    if (dataEntregaRaw) {
      const m = dataEntregaRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) dataEntregaIso = `${m[3]}-${m[1]}-${m[2]}`; // → YYYY-MM-DD
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE req_materiais SET status='aprovado', uau_pedido_numero=$2, data_entrega=$3, atualizado_em=NOW() WHERE id=$1`,
      [pedidoId, numeroPedido != null ? String(numeroPedido) : null, dataEntregaIso]
    );
    const obsHistorico = numeroPedido
      ? `Aprovado e enviado ao UAU — Pedido Nº ${numeroPedido}. ${obsAprovacao}.`
      : `Aprovado e enviado ao UAU. ${obsAprovacao}.`;
    await client.query(
      `INSERT INTO req_materiais_historico (rm_id, status_de, status_para, usuario, observacao)
       VALUES ($1,'pendente','aprovado',$2,$3)`,
      [pedidoId, req.user?.login || 'sistema', obsHistorico]
    );
    await client.query('COMMIT');

    const msgOk = numeroPedido
      ? `Pedido de compra Nº ${numeroPedido} criado e aprovado no UAU com sucesso`
      : 'Pedido de compra enviado e aprovado no UAU com sucesso';
    console.log(`[uau/pedido-compra] Pedido ${pedidoId} → UAU Nº ${numeroPedido ?? '(sem número)'} — aprovações:`, aprovacoes.map(a => `${a.insumo}=${a.ok ? 'OK' : 'ERRO'}`).join(', '));
    return res.json({ ok: true, numeroPedido, aprovacoes, message: msgOk });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[uau/pedido-compra]', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/uau/itens-contrato?empresa=X&contrato=Y
// Consulta os itens de um contrato no UAU e retorna lista normalizada.
// itemPlanejamento (WBS) fica sempre null — a API UAU não expõe o vínculo
// entre código financeiro e item de planejamento. Usuário preenche manualmente.
// ════════════════════════════════════════════════════════════════
router.get('/itens-contrato', auth, async (req, res) => {
  try {
    const cfg = await _getUauCfg();
    if (!cfg.api_url || !cfg.ativo) {
      return res.status(400).json({ ok: false, error: 'Integração UAU não está ativa. Ative em Configurações → Integração ERP.' });
    }
    if (!cfg.login || !cfg.senha) {
      return res.status(400).json({ ok: false, error: 'Login/Senha UAU não configurados.' });
    }

    const empresa  = parseInt(req.query.empresa,  10);
    const contrato = parseInt(req.query.contrato, 10);

    if (isNaN(empresa) || isNaN(contrato)) {
      return res.status(400).json({ ok: false, error: 'Parâmetros empresa e contrato são obrigatórios e devem ser numéricos.' });
    }

    // Autentica
    const base    = _baseUrl(cfg);
    const authUrl = `${base}/Autenticador/AutenticarUsuario`;
    const authR   = await fetch(authUrl, {
      method: 'POST', headers: _headers(cfg),
      body: JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });
    const authRaw = await authR.text().catch(() => '');
    let authParsed; try { authParsed = JSON.parse(authRaw); } catch { authParsed = null; }
    if (!authR.ok) {
      const detail = (typeof authParsed === 'object' && authParsed)
        ? (authParsed?.Message || authParsed?.message || `HTTP ${authR.status}`) : authRaw.slice(0, 200);
      return res.status(401).json({ ok: false, error: `Falha na autenticação UAU: ${detail}` });
    }
    const userToken =
      authR.headers.get('Authorization') ||
      (authParsed?.token || authParsed?.Token || authParsed?.access_token || authParsed?.AccessToken || '') ||
      (typeof authParsed === 'string' && authParsed.length > 20 ? authParsed : '') || '';

    // Consulta itens do contrato financeiro
    const itensUrl = `${base}/ContratoMaterialServico/ConsultarItensContrato`;
    const itensR   = await fetch(itensUrl, {
      method:  'POST',
      headers: _headers(cfg, userToken),
      body:    JSON.stringify({ empresa, contrato }),
    });

    const itensRaw = await itensR.text().catch(() => '');
    let itensData; try { itensData = JSON.parse(itensRaw); } catch { itensData = null; }

    console.log(`[uau/itens-contrato] empresa=${empresa} contrato=${contrato} → HTTP ${itensR.status}`);

    if (!itensR.ok) {
      const errMsg = (itensData?.Message || itensData?.message || itensRaw.slice(0, 300));
      return res.status(itensR.status).json({ ok: false, error: `UAU: ${errMsg}` });
    }

    if (!Array.isArray(itensData)) {
      return res.status(502).json({ ok: false, error: `Resposta inesperada do UAU: ${itensRaw.slice(0, 200)}` });
    }

    // Normaliza campos
    const itens = itensData.map(it => ({
      item:                 it.Item_itens,
      codigoAcompanhamento: it.Serv_itens ? String(it.Serv_itens).trim() : null,
      descricao:            it.Descr_itens || '',
      unidade:              it.Unid_itens  || '',
      preco:                it.Preco_itens  ?? null,
      qtd:                  it.Qtde_itens   ?? null,
      saldo:                it.SaldoMedicao_Itens ?? null,
      itemPlanejamento:     null,
    })).filter(it => it.item != null);

    // Nota: itemPlanejamento (WBS) não é auto-populado.
    // A API UAU (ConsultarItensVinculoPlanejamentoServico) retorna sempre []
    // para contratos sem vínculo formal cadastrado no módulo de Planejamento.
    // O usuário preenche o campo "Item PL" manualmente na tabela de itens.

    console.log(`[uau/itens-contrato] ${itens.length} itens; ${itens.filter(i=>i.itemPlanejamento).length} com item PL`);
    return res.json({ ok: true, itens, total: itens.length });

  } catch (err) {
    console.error('[uau/itens-contrato]', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/uau/contrato?empresa=X&contrato=Y
// Consulta dados do cabeçalho do contrato no UAU via ConsultarContratoPorChave.
// Retorna fornecedor, objeto, datas e situação para auto-popular o modal.
// ════════════════════════════════════════════════════════════════
router.get('/contrato', auth, async (req, res) => {
  try {
    const cfg = await _getUauCfg();
    if (!cfg.api_url || !cfg.ativo) {
      return res.status(400).json({ ok: false, error: 'Integração UAU não está ativa. Ative em Configurações → Integração ERP.' });
    }
    if (!cfg.login || !cfg.senha) {
      return res.status(400).json({ ok: false, error: 'Login/Senha UAU não configurados.' });
    }

    const empresa  = parseInt(req.query.empresa,  10);
    const contrato = parseInt(req.query.contrato, 10);
    if (isNaN(empresa) || isNaN(contrato)) {
      return res.status(400).json({ ok: false, error: 'Parâmetros empresa e contrato são obrigatórios e devem ser numéricos.' });
    }

    // Autentica
    const base    = _baseUrl(cfg);
    const authR   = await fetch(`${base}/Autenticador/AutenticarUsuario`, {
      method: 'POST', headers: _headers(cfg),
      body: JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });
    const authRaw = await authR.text().catch(() => '');
    let authP; try { authP = JSON.parse(authRaw); } catch { authP = null; }
    if (!authR.ok) {
      const detail = (typeof authP === 'object' && authP)
        ? (authP?.Message || authP?.message || `HTTP ${authR.status}`) : authRaw.slice(0, 200);
      return res.status(401).json({ ok: false, error: `Falha na autenticação UAU: ${detail}` });
    }
    const userToken =
      authR.headers.get('Authorization') ||
      (authP?.token || authP?.Token || authP?.access_token || authP?.AccessToken || '') ||
      (typeof authP === 'string' && authP.length > 20 ? authP : '') || '';

    // Consulta dados do contrato
    const contR = await fetch(`${base}/ContratoMaterialServico/ConsultarContratoPorChave`, {
      method:  'POST',
      headers: _headers(cfg, userToken),
      body:    JSON.stringify({ empresa, contrato }),
    });

    const contRaw = await contR.text().catch(() => '');
    let contData; try { contData = JSON.parse(contRaw); } catch { contData = null; }

    console.log(`[uau/contrato] empresa=${empresa} contrato=${contrato} → HTTP ${contR.status}`);

    if (!contR.ok) {
      const errMsg = contData?.Message || contData?.message || contRaw.slice(0, 300);
      return res.status(contR.status).json({ ok: false, error: `UAU: ${errMsg}` });
    }

    if (!Array.isArray(contData) || contData.length === 0) {
      return res.status(404).json({ ok: false, error: `Contrato ${contrato} não encontrado no UAU para a empresa ${empresa}.` });
    }

    // Normaliza o primeiro registro retornado
    const c = contData[0];

    // Formata datas ISO → YYYY-MM-DD para campos date do HTML
    const fmtDate = (iso) => {
      if (!iso) return null;
      try { return new Date(iso).toISOString().slice(0, 10); } catch { return null; }
    };

    return res.json({
      ok: true,
      contrato: {
        codigoFornecedor: c.CodPes_cont   ?? null,
        nomeFornecedor:   c.DescrPes_cont || null,
        cnpjFornecedor:   c.cpf_pes       || null,
        objeto:           c.Objeto_cont   || null,
        dataInicio:       fmtDate(c.DtInicio_cont),
        dataFim:          fmtDate(c.DtFim_cont),
        dataCriacao:      fmtDate(c.DtCriacao_cont),
        observacao:       c.Obs_cont      || null,
        situacao:         c.Situacao_cont ?? null, // 0-Andamento 1-Paralisado 2-Cancelado 3-Concluído 4-Em encerramento
        statusCodigo:     c.Status_cont   ?? null, // 0-Não aprovado 1-Aprovado 2-Em aditivo
        tipo:             c.Tipo_Cont     || null,
        obra:             c.Obra_cont     || null,
      },
    });

  } catch (err) {
    console.error('[uau/contrato]', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/uau/pessoa?cnpj=X
// Busca dados de uma pessoa (fornecedor) pelo CNPJ via
// ConsultarDadosPessoaPorCpfCnpjEStatus.
// ════════════════════════════════════════════════════════════════
router.get('/pessoa', auth, async (req, res) => {
  try {
    const cfg = await _getUauCfg();
    if (!cfg.api_url || !cfg.ativo) {
      return res.status(400).json({ ok: false, error: 'Integração UAU não está ativa. Ative em Configurações → Integração ERP.' });
    }
    if (!cfg.login || !cfg.senha) {
      return res.status(400).json({ ok: false, error: 'Login/Senha UAU não configurados.' });
    }

    // Aceita CNPJ com ou sem formatação
    const cnpj = (req.query.cnpj || '').replace(/\D/g, '');
    if (!cnpj || cnpj.length < 11) {
      return res.status(400).json({ ok: false, error: 'Parâmetro "cnpj" inválido. Informe CPF (11 dígitos) ou CNPJ (14 dígitos).' });
    }

    // Autentica
    const base  = _baseUrl(cfg);
    const authR = await fetch(`${base}/Autenticador/AutenticarUsuario`, {
      method: 'POST', headers: _headers(cfg),
      body: JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });
    const authRaw = await authR.text().catch(() => '');
    let authP; try { authP = JSON.parse(authRaw); } catch { authP = null; }
    if (!authR.ok) {
      const detail = (typeof authP === 'object' && authP)
        ? (authP?.Message || authP?.message || `HTTP ${authR.status}`) : authRaw.slice(0, 200);
      return res.status(401).json({ ok: false, error: `Falha na autenticação UAU: ${detail}` });
    }
    const userToken =
      authR.headers.get('Authorization') ||
      (authP?.token || authP?.Token || authP?.access_token || authP?.AccessToken || '') ||
      (typeof authP === 'string' && authP.length > 20 ? authP : '') || '';

    // Consulta pessoa pelo CNPJ via ConsultarPessoasPorCondicao (WHERE cpf_pes)
    // Nota: ConsultarDadosPessoaPorCpfCnpjEStatus ignora o parâmetro cpf_cnpj
    // e sempre retorna o usuário autenticado — por isso usamos a busca por condição.
    const pesR = await fetch(`${base}/Pessoas/ConsultarPessoasPorCondicao`, {
      method:  'POST',
      headers: _headers(cfg, userToken),
      body:    JSON.stringify({ condicaoConsultarPessoa: `cpf_pes = '${cnpj}'` }),
    });

    const pesRaw = await pesR.text().catch(() => '');
    let pesData; try { pesData = JSON.parse(pesRaw); } catch { pesData = null; }

    console.log(`[uau/pessoa] cnpj=${cnpj} → HTTP ${pesR.status}`);

    if (!pesR.ok) {
      const errMsg = pesData?.Message || pesData?.message || pesRaw.slice(0, 200);
      return res.status(pesR.status).json({ ok: false, error: `UAU: ${errMsg}` });
    }

    // Resposta: { PessoasCondicao: [...] }
    const lista = pesData?.PessoasCondicao || (Array.isArray(pesData) ? pesData : []);
    if (!lista.length) {
      return res.status(404).json({ ok: false, error: `Pessoa/Fornecedor com CNPJ ${cnpj} não encontrado no UAU.` });
    }

    const p = lista[0];
    const codigoPessoa = p.CodigoPessoa ?? null;

    // Monta endereço a partir de ListaDadosPessoaEndereco
    const fmtEnd = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return null;
      const e = arr[0];
      const partes = [
        e.EnderecoPessoa,
        e.NumeroEnderecoPessoa,
        e.BairroPessoa,
        [e.CidadePessoa, e.UfPessoa].filter(Boolean).join('/'),
      ].map(s => (s || '').toString().trim()).filter(Boolean);
      return partes.join(', ') || null;
    };

    // Representante: ContatoPessoa em ListaDadosPessoaJuridica[0]
    const pj = Array.isArray(p.ListaDadosPessoaJuridica) ? p.ListaDadosPessoaJuridica[0] : null;
    const representante = pj?.ContatoPessoa || null;

    // Busca telefones via ConsultarTelefones (segunda chamada)
    let telefone = null;
    if (codigoPessoa) {
      try {
        const telR = await fetch(`${base}/Pessoas/ConsultarTelefones`, {
          method:  'POST',
          headers: _headers(cfg, userToken),
          body:    JSON.stringify({ Numero: codigoPessoa }),
        });
        const telRaw = await telR.text().catch(() => '');
        let telData; try { telData = JSON.parse(telRaw); } catch { telData = null; }
        if (telR.ok && Array.isArray(telData) && telData.length) {
          // Prefere o principal, depois Comercial (Tipo=1) ou Celular (Tipo=2)
          const pref = telData.find(t => t.Principal) || telData.find(t => t.Tipo === 1 || t.Tipo === 2) || telData[0];
          const ddd  = pref.DDD ? `(${pref.DDD}) ` : '';
          telefone   = `${ddd}${pref.Telefone || ''}`.trim() || null;
        }
      } catch (telErr) {
        console.warn('[uau/pessoa] Erro ao buscar telefones:', telErr.message);
      }
    }

    // Dados da PJ
    const pjData = Array.isArray(p.ListaDadosPessoaJuridica) ? p.ListaDadosPessoaJuridica[0] : null;

    return res.json({
      ok: true,
      pessoa: {
        codigoPessoa,
        razaoSocial:         p.NomePessoa    || null,
        nomeFantasia:        p.NomeFantasia  || null,
        email:               p.EmailPessoa   || null,
        telefone,
        endereco:            fmtEnd(p.ListaDadosPessoaEndereco),
        cep:                 p.ListaDadosPessoaEndereco?.[0]?.CepPessoa || null,
        inscricaoMunicipal:  p.InscricaoMunicipal || null,
        inscricaoEstadual:   p.InscricaoEstadual  || null,
        cnae:                p.CnaePessoa         || null,
        optanteSimples:      pjData?.OptanteSimples ?? null,
        representante:       pjData?.ContatoPessoa || null,
      },
    });

  } catch (err) {
    console.error('[uau/pessoa]', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/uau/contratos-fornecedor?fornecedor=X
// Retorna todos os contratos de um fornecedor.
// O frontend filtra por empresa+obra após receber a lista.
// ════════════════════════════════════════════════════════════════
router.get('/contratos-fornecedor', auth, async (req, res) => {
  try {
    const cfg = await _getUauCfg();
    if (!cfg.api_url || !cfg.ativo) {
      return res.status(400).json({ ok: false, error: 'Integração UAU não está ativa. Ative em Configurações → Integração ERP.' });
    }
    if (!cfg.login || !cfg.senha) {
      return res.status(400).json({ ok: false, error: 'Login/Senha UAU não configurados.' });
    }

    const fornecedor = parseInt(req.query.fornecedor, 10);
    if (isNaN(fornecedor)) {
      return res.status(400).json({ ok: false, error: 'Parâmetro "fornecedor" é obrigatório e deve ser numérico.' });
    }

    // Autentica
    const base  = _baseUrl(cfg);
    const authR = await fetch(`${base}/Autenticador/AutenticarUsuario`, {
      method: 'POST', headers: _headers(cfg),
      body: JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });
    const authRaw = await authR.text().catch(() => '');
    let authP; try { authP = JSON.parse(authRaw); } catch { authP = null; }
    if (!authR.ok) {
      const detail = (typeof authP === 'object' && authP)
        ? (authP?.Message || authP?.message || `HTTP ${authR.status}`) : authRaw.slice(0, 200);
      return res.status(401).json({ ok: false, error: `Falha na autenticação UAU: ${detail}` });
    }
    const userToken =
      authR.headers.get('Authorization') ||
      (authP?.token || authP?.Token || authP?.access_token || authP?.AccessToken || '') ||
      (typeof authP === 'string' && authP.length > 20 ? authP : '') || '';

    // Consulta contratos do fornecedor
    const contR = await fetch(`${base}/ContratoMaterialServico/ConsultarContratoPorFornecedor`, {
      method:  'POST',
      headers: _headers(cfg, userToken),
      body:    JSON.stringify({ fornecedor }),
    });

    const contRaw = await contR.text().catch(() => '');
    let contData; try { contData = JSON.parse(contRaw); } catch { contData = null; }

    console.log(`[uau/contratos-fornecedor] fornecedor=${fornecedor} → HTTP ${contR.status}, ${Array.isArray(contData) ? contData.length : 0} contratos`);

    if (!contR.ok) {
      const errMsg = contData?.Message || contData?.message || contRaw.slice(0, 300);
      return res.status(contR.status).json({ ok: false, error: `UAU: ${errMsg}` });
    }

    if (!Array.isArray(contData) || contData.length === 0) {
      return res.json({ ok: true, contratos: [] });
    }

    const SITUACAO_LABEL = ['Andamento', 'Paralisado', 'Cancelado', 'Concluído', 'Em encerramento'];
    const STATUS_LABEL   = ['Não aprovado', 'Aprovado', 'Em aditivo'];
    const fmtDate = (iso) => {
      if (!iso) return null;
      try { return new Date(iso).toISOString().slice(0, 10); } catch { return null; }
    };

    const contratos = contData.map(c => ({
      empresa:       c.Empresa_cont   ?? null,
      obra:          c.Obra_cont      ?? null,
      codigo:        c.Cod_cont       ?? null,
      objeto:        c.Objeto_cont    || null,
      situacao:      c.Situacao_cont  ?? null,
      situacaoLabel: SITUACAO_LABEL[c.Situacao_cont] || '',
      status:        c.Status_cont    ?? null,
      statusLabel:   STATUS_LABEL[c.Status_cont]    || '',
      estagio:       c.Estagio_Cont   || null,
      dataInicio:    fmtDate(c.DtInicio_cont),
      dataFim:       fmtDate(c.DtFim_cont),
    }));

    return res.json({ ok: true, contratos });

  } catch (err) {
    console.error('[uau/contratos-fornecedor]', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// GET /api/uau/status-medicao?medicaoId=X
// Consulta o status atual de uma medição no UAU via ConsultarMedicaoCompleta.
// Resolve empresa/contrato/uau_medicao_id automaticamente pelo banco.
// ════════════════════════════════════════════════════════════════
router.get('/status-medicao', auth, async (req, res) => {
  try {
    const medicaoId = parseInt(req.query.medicaoId, 10);
    if (!medicaoId) return res.status(400).json({ ok: false, error: 'medicaoId é obrigatório' });

    const cfg = await _getUauCfg();
    if (!cfg.api_url || !cfg.ativo) {
      return res.status(400).json({ ok: false, error: 'Integração UAU não está ativa.' });
    }

    // Resolve dados da medição
    const medR = await db.query(`
      SELECT m.uau_medicao_id, c.uau_contrato, c.uau_empresa AS contrato_uau_empresa,
             emp.uau_empresa AS empresa_uau_codigo, m.codigo
      FROM medicoes m
      JOIN contratos c   ON c.id   = m.contrato_id
      JOIN obras     o   ON o.id   = c.obra_id
      JOIN empresas  emp ON emp.id = c.empresa_id
      WHERE m.id = $1`, [medicaoId]);
    if (!medR.rows[0]) return res.status(404).json({ ok: false, error: 'Medição não encontrada' });
    const med = medR.rows[0];
    if (!med.uau_medicao_id) return res.status(400).json({ ok: false, error: 'Medição ainda não integrada ao UAU.' });

    const empresa  = parseInt(med.empresa_uau_codigo || med.contrato_uau_empresa, 10);
    const contrato = parseInt(med.uau_contrato, 10);
    const medicao  = parseInt(med.uau_medicao_id, 10);
    if (isNaN(empresa) || isNaN(contrato) || isNaN(medicao)) {
      return res.status(400).json({ ok: false, error: 'Dados UAU incompletos (empresa/contrato/medição).' });
    }

    const base = _baseUrl(cfg);
    // Autentica
    const authR = await fetch(`${base}/Autenticador/AutenticarUsuario`, {
      method: 'POST', headers: _headers(cfg),
      body: JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });
    const authRaw = await authR.text().catch(() => '');
    let authP; try { authP = JSON.parse(authRaw); } catch { authP = null; }
    if (!authR.ok) return res.status(401).json({ ok: false, error: 'Falha na autenticação UAU' });
    const userToken =
      authR.headers.get('Authorization') ||
      (authP?.token || authP?.Token || authP?.access_token || '') ||
      (typeof authP === 'string' && authP.length > 20 ? authP : '') || '';

    // Consulta medição completa
    const statR = await fetch(`${base}/Medicao/ConsultarMedicaoCompleta`, {
      method: 'POST', headers: _headers(cfg, userToken),
      body: JSON.stringify({ Empresa: empresa, Contrato: contrato, Medicao: medicao }),
    });
    const statRaw = await statR.text().catch(() => '');
    let statData; try { statData = JSON.parse(statRaw); } catch { statData = null; }

    if (!statR.ok || !Array.isArray(statData) || !statData[0]) {
      const err = (statData?.Message || statData?.message || statRaw.slice(0, 200));
      return res.status(statR.status || 502).json({ ok: false, error: `UAU: ${err}` });
    }

    const m = statData[0];
    return res.json({
      ok: true,
      status: {
        numeroMedicao:   m.NumeroMedicao,
        statusCodigo:    m.Status,         // 0=Aberta 1=Aprovada 2=Medida 3=Processada
        statusDescr:     m.DescrStatus,
        subTotal:        m.SubTotal,
        acrescimos:      m.Acrescimos,
        descontos:       m.Descontos,
        total:           m.Total,
        dataBase:        m.DataBase,
        dataCadastro:    m.DataCadastro,
        dataAprovacao:   m.DataAprovacao,
        quemAprovou:     m.QuemAprovou,
        fornecedor:      m.DescrFornecedor,
        cnpjFornecedor:  m.CNPJFornecedor,
        observacao:      m.Observacao,
        ultimaMedicao:   m.UltimaMedicao,
        aprovacoes:      (m.Aprovacoes || []).map(a => ({
          nivel: a.Nivel, usuario: a.Usuario, data: a.Data, status: a.Status
        })),
      },
    });
  } catch (err) {
    console.error('[uau/status-medicao]', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// POST /api/uau/gerar-processo
// Body: { medicaoId, dataVencimento, observacao? }
// Gera processo de pagamento no UAU para uma medição já integrada.
// ════════════════════════════════════════════════════════════════
router.post('/gerar-processo', auth, async (req, res) => {
  try {
    const { medicaoId, dataVencimento, observacao } = req.body;
    if (!medicaoId || !dataVencimento) {
      return res.status(400).json({ ok: false, error: 'medicaoId e dataVencimento são obrigatórios' });
    }

    const cfg = await _getUauCfg();
    if (!cfg.api_url || !cfg.ativo) {
      return res.status(400).json({ ok: false, error: 'Integração UAU não está ativa.' });
    }

    // Resolve dados
    const medR = await db.query(`
      SELECT m.uau_medicao_id, m.valor_medicao, m.periodo, m.codigo,
             c.uau_contrato, c.uau_empresa AS contrato_uau_empresa,
             emp.uau_empresa AS empresa_uau_codigo
      FROM medicoes m
      JOIN contratos c   ON c.id   = m.contrato_id
      JOIN empresas  emp ON emp.id = c.empresa_id
      WHERE m.id = $1`, [medicaoId]);
    if (!medR.rows[0]) return res.status(404).json({ ok: false, error: 'Medição não encontrada' });
    const med = medR.rows[0];
    if (!med.uau_medicao_id) return res.status(400).json({ ok: false, error: 'Medição ainda não integrada ao UAU.' });

    const empresa  = parseInt(med.empresa_uau_codigo || med.contrato_uau_empresa, 10);
    const contrato = parseInt(med.uau_contrato, 10);
    const medicao  = parseInt(med.uau_medicao_id, 10);
    if (isNaN(empresa) || isNaN(contrato) || isNaN(medicao)) {
      return res.status(400).json({ ok: false, error: 'Dados UAU incompletos.' });
    }

    const valor = parseFloat(med.valor_medicao) || 0;
    const [anoStr, mesStr] = (med.periodo || '').split('-');
    const mesPlan = (anoStr && mesStr)
      ? `${anoStr}-${mesStr.padStart(2,'0')}-01T00:00:00.000Z`
      : new Date().toISOString();

    const base = _baseUrl(cfg);
    // Autentica
    const authR = await fetch(`${base}/Autenticador/AutenticarUsuario`, {
      method: 'POST', headers: _headers(cfg),
      body: JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });
    const authRaw = await authR.text().catch(() => '');
    let authP; try { authP = JSON.parse(authRaw); } catch { authP = null; }
    if (!authR.ok) return res.status(401).json({ ok: false, error: 'Falha na autenticação UAU' });
    const userToken =
      authR.headers.get('Authorization') ||
      (authP?.token || authP?.Token || authP?.access_token || '') ||
      (typeof authP === 'string' && authP.length > 20 ? authP : '') || '';

    const payload = {
      Empresa:         empresa,
      Contrato:        contrato,
      Medicao:         medicao,
      MesPlanejamento: mesPlan,
      Parametro:       {},
      Parcelas: [{
        Datavencimento: new Date(dataVencimento).toISOString(),
        Valor:          valor,
      }],
    };
    if (observacao) payload.Parametro.HistoricoLancContabilApagar = observacao;

    console.log(`[uau/gerar-processo] medicao=${medicaoId} (UAU ${medicao}) empresa=${empresa} contrato=${contrato}`);

    const procR = await fetch(`${base}/ProcessoPagamento/GerarProcessoMedicao`, {
      method: 'POST', headers: _headers(cfg, userToken),
      body: JSON.stringify(payload),
    });
    const procRaw = await procR.text().catch(() => '');
    let procData; try { procData = JSON.parse(procRaw); } catch { procData = null; }
    console.log(`[uau/gerar-processo] HTTP ${procR.status} | raw: ${procRaw.slice(0,400)}`);

    if (!procR.ok) {
      const err = procData?.Message || procData?.message || procRaw.slice(0, 300);
      return res.status(procR.status).json({ ok: false, error: `UAU: ${err}` });
    }

    // Salva número do processo no banco
    const numeroProcesso = procData?.NumeroProcesso ?? null;
    if (numeroProcesso) {
      await db.query(
        `UPDATE medicoes SET uau_processo_pagamento = $1 WHERE id = $2`,
        [String(numeroProcesso), medicaoId]
      );
    }

    return res.json({
      ok:             true,
      numeroProcesso: numeroProcesso,
      empresa:        procData?.DescrEmpresa,
      fornecedor:     procData?.NomeFornecedor,
      total:          procData?.Parcelas?.[0]?.Valor ?? valor,
      vencimento:     dataVencimento,
    });
  } catch (err) {
    console.error('[uau/gerar-processo]', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// HELPER EXPORTADO: sincroniza um fornecedor do Construtivo → UAU
// Chamado por fornecedores.js após salvar no banco local.
// Não lança exceção — falhas UAU são apenas logadas.
//
// fornRow: { uau_codigo_fornecedor, email, nome_fantasia, tel, razao_social }
// ════════════════════════════════════════════════════════════════
async function syncFornecedorToUAU(fornRow) {
  const codPes = parseInt(fornRow.uau_codigo_fornecedor, 10);
  if (!codPes) return; // sem vínculo UAU, nada a fazer

  let cfg;
  try {
    cfg = await _getUauCfg();
  } catch {
    return; // UAU não configurado
  }
  if (!cfg?.api_url || !cfg?.ativo || !cfg?.login || !cfg?.senha) return;

  const base = _baseUrl(cfg);

  // ── 1. Autentica ─────────────────────────────────────────────
  let userToken = '';
  try {
    const authR   = await fetch(`${base}/Autenticador/AutenticarUsuario`, {
      method: 'POST', headers: _headers(cfg),
      body: JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
    });
    const authRaw = await authR.text().catch(() => '');
    let authP; try { authP = JSON.parse(authRaw); } catch { authP = null; }
    if (!authR.ok) {
      console.warn(`[uau/sync-forn] Falha na autenticação UAU — fornecedor ${codPes} não sincronizado`);
      return;
    }
    userToken =
      authR.headers.get('Authorization') ||
      (authP?.token || authP?.Token || authP?.access_token || '') ||
      (typeof authP === 'string' && authP.length > 20 ? authP : '') || '';
  } catch (e) {
    console.warn('[uau/sync-forn] Erro na autenticação:', e.message);
    return;
  }

  // ── 2. Busca dados atuais no UAU via CNPJ (ConsultarPessoasPorCondicao) ──
  // Usamos ConsultarPessoasPorCondicao pois ConsultarPessoaPorChave não é confiável
  const cnpjDigits = (fornRow.cnpj || '').replace(/\D/g, '');
  let pesAtual = null;
  try {
    const r   = await fetch(`${base}/Pessoas/ConsultarPessoasPorCondicao`, {
      method: 'POST', headers: _headers(cfg, userToken),
      body: JSON.stringify({ condicaoConsultarPessoa: `cpf_pes = '${cnpjDigits}'` }),
    });
    const raw = await r.text().catch(() => '');
    let d; try { d = JSON.parse(raw); } catch { d = null; }
    const lista = d?.PessoasCondicao || (Array.isArray(d) ? d : []);
    pesAtual = lista[0] || null;
  } catch (e) {
    console.warn('[uau/sync-forn] Erro ao consultar pessoa no UAU:', e.message);
    return;
  }

  if (!pesAtual?.CodigoPessoa) {
    console.warn(`[uau/sync-forn] CNPJ ${cnpjDigits} não encontrado no UAU — sync ignorado`);
    return;
  }

  // Usa o código retornado pelo UAU (mais confiável que o armazenado localmente)
  const codPesUau = pesAtual.CodigoPessoa;

  // ── 3. Monta payload GravarPessoa mesclando UAU + Construtivo ─
  // Campos obrigatórios vêm do UAU; só sobrescrevemos email e campos do Construtivo
  const payload = {
    nao_validar_campos_obrigatorios: false,
    info_pes: {
      cod_pes:                       codPesUau,
      nome_pes:                      pesAtual.NomePessoa     || fornRow.razao_social,
      tipo_pes:                      pesAtual.TipoPessoa     ?? 1,
      usrcad_pes:                    pesAtual.UsuarioCadastro || cfg.login,
      usralt_pes:                    cfg.login,
      status_pes:                    pesAtual.StatusPessoa   ?? 2,
      atinat_pes:                    pesAtual.AtivoInativo   ?? 0,
      cadastradoprefeituragyn_pes:   pesAtual.PessoaCadastradoPrefeituraGyn ?? false,
      habilitadoriscosacado_pes:     pesAtual.HabilitarRiscoSacado          ?? false,
      // Campos que o Construtivo mantém atualizados
      email_pes:      fornRow.email              || pesAtual.EmailPessoa   || '',
      nomefant_pes:   fornRow.nome_fantasia       || pesAtual.NomeFantasia  || '',
      cpf_pes:        (fornRow.cnpj || '').replace(/\D/g, '') || pesAtual.CpfPessoa || '',
      cnae_pes:       fornRow.cnae               || pesAtual.CnaePessoa    || '',
      inscrmunic_pes: fornRow.inscricao_municipal || pesAtual.InscricaoMunicipal || '',
      inscrest_pes:   fornRow.inscricao_estadual  || pesAtual.InscricaoEstadual  || '',
    },
    // Dados PJ: repassa optante simples se for PJ (tipo_pes = 1)
    ...((pesAtual.TipoPessoa ?? 1) === 1 ? {
      infopes_jur: {
        cod_pj:            codPesUau,
        optantesimples_pj: typeof fornRow.optante_simples === 'boolean'
          ? fornRow.optante_simples
          : (pesAtual.ListaDadosPessoaJuridica?.[0]?.OptanteSimples ?? false),
      },
    } : {}),
  };

  try {
    const r   = await fetch(`${base}/Pessoas/GravarPessoa`, {
      method: 'POST', headers: _headers(cfg, userToken),
      body: JSON.stringify(payload),
    });
    const raw = await r.text().catch(() => '');
    console.log(`[uau/sync-forn] GravarPessoa ${codPesUau} → HTTP ${r.status} | ${raw.slice(0, 200)}`);
  } catch (e) {
    console.warn('[uau/sync-forn] Erro ao chamar GravarPessoa:', e.message);
    return;
  }

  // ── 4. Sincroniza telefone via ManterTelefone (se houver) ─────
  const telRaw = (fornRow.tel || '').trim();
  if (telRaw) {
    const match = telRaw.match(/^\(?(\d{2})\)?\s*([\d\s\-]+)$/);
    const ddd   = match ? match[1] : '';
    const fone  = match ? match[2].replace(/\D/g, '') : telRaw.replace(/\D/g, '').slice(2);
    if (ddd && fone) {
      try {
        const r = await fetch(`${base}/Pessoas/ManterTelefone`, {
          method: 'POST', headers: _headers(cfg, userToken),
          body: JSON.stringify({
            Numero:    codPesUau,
            Telefones: [{ Telefone: fone, DDD: ddd, Tipo: 1, Principal: 1, Complemento: '' }],
          }),
        });
        const raw = await r.text().catch(() => '');
        console.log(`[uau/sync-forn] ManterTelefone ${codPesUau} → HTTP ${r.status} | ${raw.slice(0, 100)}`);
      } catch (e) {
        console.warn('[uau/sync-forn] Erro ao chamar ManterTelefone:', e.message);
      }
    }
  }
}

module.exports = router;
module.exports.syncFornecedorToUAU = syncFornecedorToUAU;
