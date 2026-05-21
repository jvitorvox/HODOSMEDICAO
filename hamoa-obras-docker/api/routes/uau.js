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

    console.log('[uau/pedido-compra] Payload enviado:', JSON.stringify(payload, null, 2));

    const pcUrl = `${base}/PedidoCompra/GravarPedidoDeCompraDoTipoMaterial`;
    const pcR   = await fetch(pcUrl, {
      method:  'POST',
      headers: _headers(cfg, userToken),
      body:    JSON.stringify(payload),
    });

    let pcData;
    try { pcData = await pcR.json(); } catch { pcData = null; }

    console.log('[uau/pedido-compra] Resposta UAU:', pcR.status, JSON.stringify(pcData));

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
    await client.query('BEGIN');
    await client.query(
      `UPDATE req_materiais SET status='aprovado', uau_pedido_numero=$2, atualizado_em=NOW() WHERE id=$1`,
      [pedidoId, numeroPedido != null ? String(numeroPedido) : null]
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

module.exports = router;
