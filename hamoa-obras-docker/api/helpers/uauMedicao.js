/**
 * uauMedicao.js — Integração UAU ERP: ManterMedicao
 *
 * Auto-resolve do banco:
 *   - fornecedores.uau_codigo_fornecedor  (via medicoes.fornecedor_id)
 *   - contrato_itens.uau_item             (via medicao_itens.contrato_item_id)
 *   - contrato_itens.uau_codigo_acompanhamento
 *
 * params aceitos (todos opcionais / override):
 *   codigoFornecedor  — sobrepõe fornecedores.uau_codigo_fornecedor
 *   numeroMedicao     — 0 = criar nova (padrão); >0 = atualizar existente no UAU
 */

const db = require('../db');

async function _getUauCfg() {
  const r = await db.query(`SELECT valor FROM configuracoes WHERE chave = 'uau'`);
  if (!r.rows[0]) throw new Error('Configuração UAU não encontrada');
  return r.rows[0].valor;
}

function _baseUrl(cfg) {
  const url    = (cfg.api_url || '').replace(/\/+$/, '');
  const versao = (cfg.api_versao || '1').replace(/\/+$/, '');
  return `${url}/api/v${versao}`;
}

function _headers(cfg, userToken) {
  const h = {
    'Content-Type':                'application/json',
    'X-INTEGRATION-Authorization': cfg.api_key || '',
  };
  if (userToken) h['Authorization'] = userToken;
  return h;
}

async function _autenticar(cfg) {
  const base    = _baseUrl(cfg);
  const authUrl = `${base}/Autenticador/AutenticarUsuario`;
  const authR   = await fetch(authUrl, {
    method:  'POST',
    headers: _headers(cfg),
    body:    JSON.stringify({ Login: cfg.login, Senha: cfg.senha }),
  });

  const authRaw = await authR.text().catch(() => '');
  let authParsed;
  try { authParsed = JSON.parse(authRaw); } catch { authParsed = null; }

  if (!authR.ok) {
    const detail = (typeof authParsed === 'object' && authParsed)
      ? (authParsed?.Message || authParsed?.message || `HTTP ${authR.status}`)
      : authRaw.slice(0, 200);
    throw new Error(`Falha na autenticação UAU: ${detail}`);
  }

  return authR.headers.get('Authorization') ||
    (authParsed?.token || authParsed?.Token || authParsed?.access_token || authParsed?.AccessToken || '') ||
    (typeof authParsed === 'string' && authParsed.length > 20 ? authParsed : '') ||
    '';
}

// ============================================================================
// integrarMedicaoUAU(medicaoId, params)
// ============================================================================
async function integrarMedicaoUAU(medicaoId, params = {}) {
  const tag    = `[uau/ManterMedicao] medicao=${medicaoId}`;
  const dryRun = params.dryRun === true;
  try {

    // 1. Idempotência (skip em dry-run)
    if (!dryRun) {
      const idempR = await db.query(
        `SELECT uau_medicao_id FROM medicoes WHERE id = $1`, [medicaoId]
      );
      if (!idempR.rows[0]) return { ok: false, error: 'Medição não encontrada' };
      if (idempR.rows[0].uau_medicao_id != null) {
        console.log(`${tag} Já integrada (uau_medicao_id=${idempR.rows[0].uau_medicao_id}) — pulando`);
        return { ok: true, uauMedicaoId: idempR.rows[0].uau_medicao_id, jaIntegrada: true };
      }
    }

    // 2. Configuração UAU
    const cfg = await _getUauCfg();
    if (!dryRun) {
      if (!cfg.ativo) {
        return { ok: false, error: 'Integração UAU não está ativa. Ative em Configurações → Integração ERP.' };
      }
      if (!cfg.api_url || !cfg.login || !cfg.senha) {
        return { ok: false, error: 'Configuração UAU incompleta (URL/login/senha). Verifique em Configurações → Integração ERP.' };
      }
    }

    // 3. Busca medição + contrato + empresa + fornecedor em um único query
    const medR = await db.query(`
      SELECT
        m.id, m.codigo, m.periodo, m.valor_medicao, m.contrato_id,
        c.uau_empresa    AS contrato_uau_empresa,
        c.uau_contrato   AS contrato_uau_contrato,
        c.numero         AS contrato_numero,
        o.nome           AS obra_nome,
        o.uau_obra       AS obra_uau_codigo,
        emp.uau_empresa  AS empresa_uau_codigo,
        f.uau_codigo_fornecedor AS fornecedor_uau_codigo,
        f.razao_social          AS fornecedor_nome
      FROM medicoes     m
      JOIN contratos    c   ON c.id   = m.contrato_id
      JOIN obras        o   ON o.id   = c.obra_id
      JOIN empresas     emp ON emp.id = c.empresa_id
      LEFT JOIN fornecedores f ON f.id = m.fornecedor_id
      WHERE m.id = $1
    `, [medicaoId]);

    if (!medR.rows[0]) return { ok: false, error: 'Medição não encontrada' };
    const med = medR.rows[0];

    // 4. Empresa e contrato
    const codigoEmpresa  = med.empresa_uau_codigo || med.contrato_uau_empresa || cfg.empresa_codigo;
    const codigoContrato = med.contrato_uau_contrato;

    if (!codigoContrato) {
      return { ok: false, error: `Contrato "${med.contrato_numero}" não possui código UAU. Configure em Cadastros → Contratos.` };
    }
    if (!codigoEmpresa) {
      return { ok: false, error: 'Código da empresa UAU não configurado. Configure em Configurações → Integração ERP ou no cadastro do contrato.' };
    }

    const empresaInt  = parseInt(codigoEmpresa, 10);
    const contratoInt = parseInt(codigoContrato, 10);
    if (isNaN(empresaInt))  return { ok: false, error: `Código de empresa UAU inválido: "${codigoEmpresa}".` };
    if (isNaN(contratoInt)) return { ok: false, error: `Código de contrato UAU inválido: "${codigoContrato}".` };

    console.log(`${tag} Empresa=${empresaInt} Contrato=${contratoInt}`);

    // 5. Fornecedor: params.codigoFornecedor > banco
    const fornecedorRaw = params.codigoFornecedor ?? med.fornecedor_uau_codigo;
    if (fornecedorRaw == null) {
      const nome = med.fornecedor_nome ? ` "${med.fornecedor_nome}"` : '';
      return {
        ok: false,
        error: `Fornecedor${nome} não possui código UAU cadastrado. Informe no modal ou cadastre em Fornecedores → campo "Cód. Fornecedor UAU".`,
      };
    }
    const fornecedorInt = parseInt(fornecedorRaw, 10);
    if (isNaN(fornecedorInt)) return { ok: false, error: `Código do fornecedor UAU inválido: "${fornecedorRaw}".` };

    console.log(`${tag} Fornecedor=${fornecedorInt} (fonte: ${params.codigoFornecedor != null ? 'params' : 'banco'})`);

    // 6. Itens: lê todos os itens da medição com seus códigos UAU no contrato
    // Tenta join direto por contrato_item_id; se o id não existir mais (delete+insert anterior)
    // faz fallback por descrição dentro do mesmo contrato para reparar referências quebradas.
    const itensR = await db.query(`
      SELECT
        mi.id        AS mi_id,
        mi.ordem,
        mi.descricao,
        mi.qtd_mes,
        mi.valor_unitario,
        mi.contrato_item_id,
        COALESCE(ci.uau_item,       ci2.uau_item)                     AS uau_item,
        COALESCE(ci.uau_codigo_acompanhamento,
                 ci2.uau_codigo_acompanhamento)                       AS uau_codigo_acompanhamento,
        CASE WHEN ci.id IS NULL AND ci2.id IS NOT NULL
             THEN ci2.id ELSE NULL END                                AS novo_contrato_item_id
      FROM medicao_itens mi
      LEFT JOIN contrato_itens ci
             ON ci.id = mi.contrato_item_id
      -- fallback: join por descrição quando o id original não existe mais
      LEFT JOIN contrato_itens ci2
             ON ci.id IS NULL
            AND ci2.contrato_id = $2
            AND LOWER(TRIM(ci2.descricao)) = LOWER(TRIM(mi.descricao))
      WHERE mi.medicao_id = $1
      ORDER BY mi.ordem
    `, [medicaoId, med.contrato_id]);

    // Repara referências quebradas — atualiza contrato_item_id nos mi que usaram o fallback
    const paraReparar = itensR.rows.filter(r => r.novo_contrato_item_id != null);
    if (paraReparar.length > 0) {
      console.log(`${tag} Reparando ${paraReparar.length} medicao_itens com contrato_item_id obsoleto`);
      for (const r of paraReparar) {
        await db.query(
          `UPDATE medicao_itens SET contrato_item_id = $1 WHERE id = $2`,
          [r.novo_contrato_item_id, r.mi_id]
        );
      }
    }

    const itensMapeados = itensR.rows.filter(it => it.uau_item != null);
    const itensSemUau   = itensR.rows.filter(it => it.uau_item == null);

    if (itensSemUau.length > 0) {
      const nomes = itensSemUau.map(it => `"${it.descricao || `item ${it.ordem}`}"`).join(', ');
      console.warn(`${tag} Itens sem uau_item (ignorados): ${nomes}`);
    }

    // Valida apenas que uau_item existe — uau_codigo_acompanhamento pode ser
    // alfanumérico (ex: "C0140"), é usado como string no acompanhamento e
    // depois resolvido para cod_acomp (int) via ConsultarAcompanhamento.
    const itensSemItem = itensMapeados.filter(it =>
      it.uau_item == null || isNaN(parseInt(it.uau_item, 10))
    );
    if (itensSemItem.length > 0) {
      const nomes = itensSemItem
        .map(it => `• "${it.descricao || `item ${it.ordem}`}"`)
        .join('\n');
      return {
        ok: false,
        error: `${itensSemItem.length} item(s) sem código de item UAU.\nAbra o contrato, clique em "🔗 Importar UAU" e salve antes de integrar:\n${nomes}`,
      };
    }

    // 7. Período → DataBase + data_inicio / data_fim para acompanhamento
    const [anoStr, mesStr] = (med.periodo || '').split('-');
    const dataBase = (anoStr && mesStr)
      ? `${anoStr}-${mesStr.padStart(2, '0')}-01T00:00:00.000Z`
      : new Date().toISOString();

    const mesPad    = (mesStr || '').padStart(2, '0');
    const ultimoDia = (anoStr && mesStr)
      ? new Date(parseInt(anoStr, 10), parseInt(mesStr, 10), 0).getDate()
      : new Date().getDate();
    const dataInicio = (anoStr && mesStr) ? `${anoStr}-${mesPad}-01` : '';
    const dataFim    = (anoStr && mesStr) ? `${anoStr}-${mesPad}-${String(ultimoDia).padStart(2, '0')}` : '';

    // 8. NumeroMedicao: 0 = criar nova; >0 = atualizar existente
    const numeroMedicao = parseInt(params.numeroMedicao, 10) || 0;

    // 9. Payload ManterMedicao — Itens será adicionado após buscar cod_acomp
    const payload = {
      Empresa:          empresaInt,
      NumeroContrato:   contratoInt,
      NumeroMedicao:    numeroMedicao,
      CodigoFornecedor: fornecedorInt,
      Observacao:       `Medicao ${med.codigo} via Construtivo`,
      UltimaMedicao:    0,
      DataBase:         dataBase,
      UsrCadastro:      cfg.login || '',
    };

    // ── DRY-RUN: devolve os payloads sem chamar a API UAU ───────────────────
    if (dryRun) {
      const base = _baseUrl(cfg);
      const acompServicos = itensMapeados
        .filter(it => { const q = parseFloat(it.qtd_mes); return !isNaN(q) && q > 0; })
        .map(it => ({
          item_contrato:     parseInt(it.uau_item, 10),
          servico:           String(it.uau_codigo_acompanhamento),
          quantidade:        parseFloat(it.qtd_mes),
          porcentagem_acomp: 100,
          cod_estrutura:     '',
          sequencia:         '',
          data_inicio:       dataInicio,
          data_fim:          dataFim,
          mes_pl:            dataInicio,
        }));

      // Apenas itens com qtd_mes > 0 entram no ManterMedicao
      const itensMedidosDry = itensMapeados.filter(it => {
        const q = parseFloat(it.qtd_mes);
        return !isNaN(q) && q > 0;
      });

      // Itens para ManterMedicao só têm Item + CodigoAcompanhamento
      // (UAU ignora Preco/Quantidade — valores vêm do acompanhamento vinculado)
      const itensPreview = itensMedidosDry.map(it => ({
        Item:                parseInt(it.uau_item, 10),
        CodigoAcompanhamento: '← Cod_aec resolvido em runtime pelo ConsultarAcompanhamento',
      }));

      // ConsultarAcompanhamento: apenas serviços únicos dos itens com qtd > 0
      const servicosUnicosDry = [
        ...new Set(
          itensMedidosDry
            .map(it => String(it.uau_codigo_acompanhamento))
            .filter(s => s && s !== 'null' && s !== 'undefined')
        ),
      ].map(s => ({ Empresa: empresaInt, Contrato: contratoInt, Servico: s }));

      return {
        ok: true,
        dryRun: true,
        endpoints: {
          autenticar:    `POST ${base}/Autenticador/AutenticarUsuario`,
          acompanhamento:`POST ${base}/AcompanhamentosServicos/AcompanharServicoContratoEmLote`,
          consultarAcomp:`POST ${base}/AcompanhamentosServicos/ConsultarAcompanhamentoContratoServicoPorContratoEServico`,
          manterMedicao: `POST ${base}/Medicao/ManterMedicao`,
          aprovarMedicao:`POST ${base}/Medicao/AprovarMedicaoContrato`,
        },
        payloads: {
          autenticar: { Login: cfg.login, Senha: '***' },
          acompanhamento: {
            empresa:          empresaInt,
            obra:             String(med.obra_uau_codigo || '⚠ não configurado'),
            contrato_servico: contratoInt,
            usuario_logado:   cfg.login || '',
            servicos:         acompServicos,
          },
          consultarAcompanhamento: servicosUnicosDry,
          manterMedicao: {
            ...payload,
            NumeroMedicao: 0,
            Itens: itensPreview,
            _nota: 'CodigoAcompanhamento é resolvido em runtime; sem ele o SubTotal fica R$0,00',
          },
        },
        itensMedidos:   itensMedidosDry.length,
        itensMapeados:  itensMapeados.length,
        itensSemUau:    itensSemUau.map(it => it.descricao || `item ${it.ordem}`),
      };
    }
    // ── FIM DRY-RUN ─────────────────────────────────────────────────────────

    console.log(`${tag} Autenticando no UAU...`);
    const userToken = await _autenticar(cfg);

    const base = _baseUrl(cfg);

    // Helper: parseia cod_acomp de um campo UAU
    // Filtra type-strings retornadas pelo bug do UAU: "System.Int32, mscorlib..."
    const _parseCodAcomp = v => {
      if (v == null) return NaN;
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.startsWith('System.')) return NaN;
      return parseInt(v, 10);
    };

    // Helper: extrai { serviço → cod_acomp } de um array de Acompanhamento UAU
    // Filtra apenas acompanhamentos ELEGÍVEIS:
    //   - não vinculados a outra medição (CodMed_aec = 0/null)
    //   - DtInicio_aec dentro do mês/ano da medição (se anoStr/mesStr informados)
    // Entre os elegíveis pega o de maior Cod_aec (mais recente/novo).
    const _extrairCodAcompDoArray = (arr, tag_, anoFiltro, mesFiltro) => {
      const result = {};
      const eligibles = (Array.isArray(arr) ? arr : [arr]).filter(rec => {
        if (!rec || typeof rec !== 'object') return false;
        // CodMed_aec = 0 ou null → ainda não vinculado a nenhuma medição
        const codMed = _parseCodAcomp(rec.CodMed_aec ?? rec.codMed_aec);
        if (!(isNaN(codMed) || codMed === 0)) return false;
        // Filtra pelo período da medição para não pegar acompanhamentos de outros meses
        if (anoFiltro && mesFiltro) {
          const dtInicio = rec.DtInicio_aec ?? rec.dtInicio_aec ?? null;
          if (dtInicio) {
            const d = new Date(dtInicio);
            if (d.getFullYear() !== parseInt(anoFiltro, 10) ||
                d.getMonth() + 1 !== parseInt(mesFiltro, 10)) {
              return false;
            }
          }
        }
        return true;
      });
      for (const rec of eligibles) {
        const servico = String(rec.Serv_aec ?? rec.serv_aec ?? '').trim();
        const id      = _parseCodAcomp(rec.Cod_aec ?? rec.cod_aec ?? rec.cod_acomp ?? rec.CodGeral_aec);
        if (servico && !isNaN(id) && id > 0) {
          // Mantém o maior Cod_aec entre os elegíveis para este serviço
          if (!result[servico] || id > result[servico]) {
            result[servico] = id;
          }
        }
      }
      return result;
    };

    // 6.5 AcompanharServicoContratoEmLote — registra o progresso físico (quantidades).
    //     Quando bem-sucedido a resposta pode já conter Cod_aec dos acompanhamentos criados.
    const codAcompByServico = {};
    const obraUau = med.obra_uau_codigo;
    if (!obraUau) {
      console.warn(`${tag} obras.uau_obra não preenchido — acompanhamento será ignorado e medição pode ficar R$0,00`);
    } else {
      const servicosAcomp = itensMapeados
        .filter(it => {
          const q = parseFloat(it.qtd_mes);
          return !isNaN(q) && q > 0;
        })
        .map(it => ({
          item_contrato: parseInt(it.uau_item, 10),
          servico:       String(it.uau_codigo_acompanhamento),
          quantidade:    parseFloat(it.qtd_mes),
          porcentagem_acomp: 100,
          cod_estrutura: '',
          sequencia:     '',
          data_inicio:   dataInicio,
          data_fim:      dataFim,
          mes_pl:        dataInicio,   // obrigatório internamente pelo UAU (mesPl no construtor VB.NET)
        }));

      if (servicosAcomp.length === 0) {
        console.warn(`${tag} Nenhum item com qtd_mes > 0 — acompanhamento não será enviado`);
      } else {
        const acompPayload = {
          empresa:          empresaInt,
          obra:             String(obraUau),
          contrato_servico: contratoInt,
          usuario_logado:   cfg.login || '',
          servicos:         servicosAcomp,
        };

        const acompUrl = `${base}/AcompanhamentosServicos/AcompanharServicoContratoEmLote`;
        console.log(`${tag} POST ${acompUrl} (${servicosAcomp.length} serviço(s))`);
        console.log(`${tag} Acomp payload:`, JSON.stringify(acompPayload, null, 2));

        const acompR = await fetch(acompUrl, {
          method:  'POST',
          headers: _headers(cfg, userToken),
          body:    JSON.stringify(acompPayload),
        });

        const acompRaw = await acompR.text().catch(() => '');
        let acompData;
        try { acompData = JSON.parse(acompRaw); } catch { acompData = acompRaw || null; }
        console.log(`${tag} Acomp resposta HTTP ${acompR.status} | raw:`, acompRaw);

        if (acompR.ok && acompData) {
          // Tenta extrair cod_acomp dos Acompanhamentos recém-criados na resposta
          // Passa anoStr/mesStr para filtrar apenas acompanhamentos do período correto
          const fromAcomp = _extrairCodAcompDoArray(
            Array.isArray(acompData) ? acompData : [acompData], tag, anoStr, mesStr
          );
          Object.assign(codAcompByServico, fromAcomp);
          console.log(`${tag} Acompanhamento registrado — cod_acomp da resposta:`, codAcompByServico);
        } else {
          const acompErroMsg =
            (acompData && typeof acompData === 'object'
              ? (acompData.Descricao ?? acompData.Message ?? acompData.message ?? acompData.Mensagem ?? null)
              : null) || acompRaw.slice(0, 300);
          console.warn(`${tag} AcompanharServico falhou (HTTP ${acompR.status}): ${acompErroMsg}`);
          // Não bloqueia — prossegue para ConsultarAcompanhamento (acomp pode já existir)
        }
      }
    }

    // 6.6 Para serviços ainda sem cod_acomp, consulta o UAU para encontrar o
    //     acompanhamento ELEGÍVEL existente (não vinculado a outra medição).
    // Apenas itens com quantidade medida no mês > 0 entram no ManterMedicao e no ConsultarAcompanhamento
    const itensMedidos = itensMapeados.filter(it => {
      const q = parseFloat(it.qtd_mes);
      return !isNaN(q) && q > 0;
    });

    const servicosCodigos = [
      ...new Set(
        itensMedidos
          .map(it => it.uau_codigo_acompanhamento)
          .filter(s => s != null && String(s).trim() !== '')
      ),
    ];
    const servicosSemCod = servicosCodigos.filter(s => codAcompByServico[s] == null);

    if (servicosSemCod.length > 0) {
      const consultUrl = `${_baseUrl(cfg)}/AcompanhamentosServicos/ConsultarAcompanhamentoContratoServicoPorContratoEServico`;
      for (const servico of servicosSemCod) {
        try {
          const consultR = await fetch(consultUrl, {
            method:  'POST',
            headers: _headers(cfg, userToken),
            body:    JSON.stringify({ Empresa: empresaInt, Contrato: contratoInt, Servico: String(servico) }),
          });
          const consultRaw = await consultR.text().catch(() => '');
          let consultData;
          try { consultData = JSON.parse(consultRaw); } catch { consultData = null; }
          console.log(`${tag} ConsultarAcomp servico="${servico}" HTTP ${consultR.status} | raw:`, consultRaw);

          if (consultData != null) {
            const arr = Array.isArray(consultData) ? consultData : [consultData];
            // Filtra elegíveis (CodMed_aec = 0/null) E do mesmo período da medição
            const fromConsult = _extrairCodAcompDoArray(arr, tag, anoStr, mesStr);
            if (fromConsult[servico] != null) {
              codAcompByServico[servico] = fromConsult[servico];
              console.log(`${tag} cod_acomp (ConsultarAcomp) para servico="${servico}": ${codAcompByServico[servico]}`);
            } else {
              // Nenhum elegível — loga todos os CodMed_aec para diagnóstico
              const resumo = arr.map(r => `cod=${_parseCodAcomp(r?.Cod_aec)} CodMed=${_parseCodAcomp(r?.CodMed_aec)}`).join(' | ');
              console.warn(`${tag} Nenhum acomp elegível para servico="${servico}". Registros: ${resumo}`);
            }
          }
        } catch (e) {
          console.warn(`${tag} Erro ao consultar cod_acomp para servico="${servico}": ${e.message}`);
        }
      }
    }

    // 9.1 Constrói lista de itens com CodigoAcompanhamento.
    //     Apenas itens com qtd_mes > 0 (itensMedidos) entram no ManterMedicao.
    //     IMPORTANTE: o UAU calcula o SubTotal a partir da quantidade registrada
    //     no acompanhamento vinculado — os campos Preco/Quantidade do
    //     ItemMedicaoRequest NÃO existem no swagger do UAU e são ignorados.
    //     Sem CodigoAcompanhamento válido o item fica com SubTotal = 0.
    const itens = itensMedidos.map(it => {
      const item = { Item: parseInt(it.uau_item, 10) };
      const codAcomp = codAcompByServico[it.uau_codigo_acompanhamento];
      if (codAcomp != null && !isNaN(codAcomp)) {
        item.CodigoAcompanhamento = codAcomp;
      }
      return item;
    });

    const itensSemAcomp = itens.filter(it => it.CodigoAcompanhamento == null);
    console.log(`${tag} Itens com qtd>0: ${itensMedidos.length}/${itensMapeados.length} | sem UAU: ${itensSemUau.length}`);
    console.log(`${tag} cod_acomp resolvidos: ${Object.keys(codAcompByServico).length}/${servicosCodigos.length} serviço(s)`);

    // Bloqueia integração se algum item não tem acompanhamento elegível.
    // Sem CodigoAcompanhamento o UAU criaria a medição com SubTotal = R$0,00.
    if (itensSemAcomp.length > 0) {
      const servicosFaltando = itensSemAcomp.map(it => {
        const row = itensMedidos.find(r => parseInt(r.uau_item, 10) === it.Item);
        return `• Item ${it.Item} — serviço ${row?.uau_codigo_acompanhamento || '?'} (${row?.descricao || ''})`;
      }).join('\n');
      return {
        ok: false,
        error:
          `${itensSemAcomp.length} item(s) sem acompanhamento elegível no UAU.\n` +
          `O UAU calcula o valor da medição a partir do acompanhamento vinculado — sem ele o SubTotal fica R$0,00.\n\n` +
          `Itens afetados:\n${servicosFaltando}\n\n` +
          `Solução: no módulo de Controle de Medição do UAU, verifique se há acompanhamentos confirmados e não vinculados a outras medições para esses serviços. ` +
          `Se todos foram consumidos por testes anteriores, exclua as medições de teste no UAU para liberar os acompanhamentos.`,
      };
    }

    const numeroMedicaoFinal = parseInt(params.numeroMedicao, 10) || 0;
    payload.NumeroMedicao = numeroMedicaoFinal;
    payload.Itens         = itens;

    const medUrl = `${base}/Medicao/ManterMedicao`;
    console.log(`${tag} POST ${medUrl}`);
    console.log(`${tag} Payload:`, JSON.stringify(payload, null, 2));

    const medR2 = await fetch(medUrl, {
      method:  'POST',
      headers: _headers(cfg, userToken),
      body:    JSON.stringify(payload),
    });

    const medRawText = await medR2.text().catch(() => '');
    let medData;
    try { medData = JSON.parse(medRawText); } catch { medData = medRawText || null; }
    console.log(`${tag} Resposta HTTP ${medR2.status} | raw: ${medRawText.slice(0, 500)}`);

    // 10. Parseia retorno UAU
    const _str = v => {
      if (v == null) return '';
      if (typeof v === 'string') return v;
      return JSON.stringify(v);
    };

    let uauMedicaoId = null;
    let uauErro      = null;

    if (typeof medData === 'number' && medData > 0) {
      uauMedicaoId = medData;
    } else if (Array.isArray(medData)) {
      // Prioridade 1: algum elemento do array é objeto de sucesso com NumeroMedicao > 0
      for (const el of medData) {
        if (el && typeof el === 'object' && !Array.isArray(el)) {
          const num = parseInt(el.NumeroMedicao, 10);
          if (!isNaN(num) && num > 0) { uauMedicaoId = num; break; }
        }
      }

      if (uauMedicaoId == null) {
        // Prioridade 2: objeto com campo de erro explícito
        for (const el of medData) {
          if (el && typeof el === 'object' && !Array.isArray(el)) {
            const msg = el.Mensagem ?? el.Message ?? el.message ?? el.mensagem ??
                        el.Descricao ?? el.Error   ?? el.error   ?? null;
            if (msg != null) { uauErro = _str(msg); break; }
          }
        }
      }

      if (uauMedicaoId == null && uauErro == null) {
        // Prioridade 3: formato clássico [id, errCod, errMsg]
        const rawId  = medData[0];
        const errCod = _str(medData[1]).trim();
        const errMsg = _str(medData[2]).trim() || _str(medData[3]).trim();
        const temErro = errCod !== '' && errCod !== '0';
        if (temErro) {
          uauErro = errMsg || `Código de erro UAU: ${errCod}`;
        } else {
          uauMedicaoId = rawId != null && rawId !== '' ? parseInt(rawId, 10) || rawId : null;
        }
      }
    } else if (medData && typeof medData === 'object') {
      if (medData.NumeroMedicao != null && parseInt(medData.NumeroMedicao, 10) > 0) {
        uauMedicaoId = parseInt(medData.NumeroMedicao, 10);
      } else {
        const errVal = medData.Message ?? medData.message ?? medData.Mensagem ?? medData.mensagem ??
                       medData.Error  ?? medData.error   ?? medData.Erro      ?? null;
        if (!medR2.ok || errVal != null) {
          uauErro = errVal != null ? _str(errVal) : `HTTP ${medR2.status} — ${medRawText.slice(0, 300)}`;
        } else {
          uauMedicaoId =
            medData.codigoMedicao ?? medData.codigo_medicao ?? medData.CodigoMedicao ??
            medData.id            ?? medData.Id             ??
            medData.numeroMedicao ?? null;
        }
      }
    } else if (typeof medData === 'string') {
      const trimmed = medData.trim();
      if (trimmed.length > 0 && !isNaN(trimmed)) {
        uauMedicaoId = parseInt(trimmed, 10);
      } else if (!medR2.ok && trimmed.length > 0) {
        uauErro = trimmed.slice(0, 300);
      }
    }

    // UAU respondeu 2xx mas sem NumeroMedicao no corpo — usa o params.numeroMedicao como fallback
    if (medR2.ok && uauMedicaoId == null && uauErro == null && numeroMedicaoFinal > 0) {
      uauMedicaoId = numeroMedicaoFinal;
      console.log(`${tag} UAU OK sem ID no body — usando NumeroMedicao=${uauMedicaoId} (params)`);
    }

    if (!medR2.ok && uauMedicaoId == null && !uauErro) {
      uauErro = `HTTP ${medR2.status} — ${medRawText.slice(0, 300) || 'sem corpo na resposta'}`;
    }

    if (uauErro) {
      console.error(`${tag} UAU retornou erro: ${uauErro}`);
      return { ok: false, error: `UAU: ${uauErro}` };
    }

    if (uauMedicaoId == null) {
      console.warn(`${tag} UAU respondeu 2xx mas sem ID de medição. Raw: ${medRawText.slice(0, 200)}`);
    }

    // 11. Salva resultado
    await db.query(
      `UPDATE medicoes SET uau_medicao_id = $1, uau_integrado_em = NOW() WHERE id = $2`,
      [uauMedicaoId ?? null, medicaoId]
    );

    console.log(`${tag} Concluído — uau_medicao_id=${uauMedicaoId}`);

    // 11.5 Aprova a medição no UAU — o ManterMedicao cria como "2 - Medida";
    // aqui levamos para "1 - Aprovada". Best-effort: se falhar (ex.: usuário sem
    // permissão OBMEDCONT), a medição segue criada e apenas registramos o aviso.
    let aprovada = false, aprovacaoMensagem = '';
    if (uauMedicaoId != null && params.aprovar !== false) {
      try {
        const apR = await fetch(`${base}/Medicao/AprovarMedicaoContrato`, {
          method: 'POST', headers: _headers(cfg, userToken),
          body: JSON.stringify({ empresa: empresaInt, contrato: contratoInt, medicao: parseInt(uauMedicaoId, 10) }),
        });
        const apRaw = await apR.text().catch(() => '');
        let apData; try { apData = JSON.parse(apRaw); } catch { apData = apRaw || null; }
        const sucessoFlag = (apData && typeof apData === 'object') ? (apData.sucesso ?? apData.Sucesso) : undefined;
        aprovada = apR.ok && sucessoFlag !== false;
        aprovacaoMensagem = (apData && typeof apData === 'object'
          ? (apData.mensagem || apData.Mensagem || apData.Descricao || apData.Message)
          : (typeof apData === 'string' ? apData : '')) || '';
        console.log(`${tag} AprovarMedicao HTTP ${apR.status} aprovada=${aprovada} | ${apRaw.slice(0, 200)}`);
      } catch (e) {
        aprovacaoMensagem = e.message;
        console.warn(`${tag} AprovarMedicao exceção: ${e.message}`);
      }
    }

    // Monta resumo legível para exibição no frontend
    const confirmacao = medData && typeof medData === 'object' && !Array.isArray(medData)
      ? medData
      : (Array.isArray(medData) && medData[0] && typeof medData[0] === 'object' ? medData[0] : null);

    return {
      ok: true,
      uauMedicaoId,
      aprovada,
      aprovacaoMensagem,
      confirmacao: confirmacao ? {
        numeroMedicao:   confirmacao.NumeroMedicao,
        status:          confirmacao.DescrStatus,
        empresa:         confirmacao.DescrEmpresa,
        contrato:        confirmacao.NumeroContrato,
        descrContrato:   confirmacao.DescrContrato,
        fornecedor:      confirmacao.DescrFornecedor,
        cnpjFornecedor:  confirmacao.CNPJFornecedor,
        observacao:      confirmacao.Observacao,
        dataCadastro:    confirmacao.DataCadastro,
        usrCadastro:     confirmacao.UsrCadastro,
        dataBase:        confirmacao.DataBase,
        subTotal:        confirmacao.SubTotal,
        total:           confirmacao.Total,
        itensUau:        confirmacao.Itens || [],
      } : null,
      itensMapeados: itensMapeados.length,
      itensSemUau:   itensSemUau.map(it => it.descricao || `item ${it.ordem}`),
    };

  } catch (err) {
    console.error(`${tag} Erro inesperado:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { integrarMedicaoUAU };
