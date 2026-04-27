/**
 * CONSTRUTIVO OBRAS — Helper WhatsApp (Evolution API)
 *
 * Envia notificações de aprovação de medições via WhatsApp.
 * O aprovador responde com:
 *   APROVAR [codigo]             → aprova a medição
 *   REPROVAR [codigo] [motivo]   → reprova com motivo obrigatório
 *
 * Configuração (salva em configuracoes WHERE chave='whatsapp'):
 *   {
 *     ativo:       true,
 *     instancia:   "construtivo",      // nome da instância na Evolution API
 *     api_url:     "http://construtivo-whatsapp:8080",
 *     api_key:     "construtivo-wa-key-2025"
 *   }
 */
'use strict';

const http  = require('http');
const https = require('https');
const db    = require('../db');

// ── Carrega configuração do banco ─────────────────────────────────
async function _loadCfg() {
  const r = await db.query("SELECT valor FROM configuracoes WHERE chave='whatsapp'");
  return r.rows[0]?.valor || {};
}

// ── Wrapper HTTP para a Evolution API ────────────────────────────
function _evReq(cfg, method, path, body) {
  return new Promise((resolve, reject) => {
    const baseUrl = cfg.api_url || 'http://construtivo-whatsapp:8080';
    const apiKey  = cfg.api_key || process.env.WA_API_KEY || '';
    const parsed  = new URL(baseUrl + path);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers:  {
        'Content-Type':  'application/json',
        'apikey':        apiKey,
        'Accept':        'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed2;
        try { parsed2 = JSON.parse(raw); } catch { parsed2 = { raw }; }
        if (res.statusCode >= 400) {
          return reject(new Error(`Evolution API ${res.statusCode}: ${parsed2?.message || raw.slice(0, 200)}`));
        }
        resolve(parsed2);
      });
    });
    req.on('error', e => reject(new Error('Erro de rede WhatsApp: ' + e.message)));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Formata número para o padrão Evolution API ───────────────────
// Aceita: (48)99999-9999 / 48999999999 / 5548999999999
function _fmtTel(tel) {
  const digits = String(tel || '').replace(/\D/g, '');
  if (!digits) return null;
  // Garante código de país 55
  return digits.startsWith('55') ? digits : `55${digits}`;
}

// ── Envia mensagem de texto simples ──────────────────────────────
async function sendText(cfg, telefone, mensagem) {
  const tel = _fmtTel(telefone);
  if (!tel) throw new Error('Telefone inválido para WhatsApp');
  const inst = cfg.instancia || 'construtivo';
  return _evReq(cfg, 'POST', `/message/sendText/${inst}`, {
    number: tel,
    text:   mensagem,
  });
}

// ── Mensagem de notificação de aprovação pendente ────────────────
function _textoAprovacao(med, nivel, usuario) {
  const fmt = v => parseFloat(v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [y, m] = (med.periodo || '-').split('-');
  const meses = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const periodo = m ? `${meses[parseInt(m)]}/${y}` : med.periodo || '—';

  return `🏗️ *CONSTRUTIVO AI*
━━━━━━━━━━━━━━━━━━━━
📋 *Medição para aprovação — ${nivel}*

*Código:* ${med.codigo}
*Obra:* ${med.obra_nome || '—'}
*Fornecedor:* ${med.fornecedor_nome || '—'}
*Período:* ${periodo}
*Valor:* R$ ${fmt(med.valor_medicao)}

${med.descricao ? `📝 _${med.descricao.slice(0, 120)}_\n\n` : ''}━━━━━━━━━━━━━━━━━━━━
Para *aprovar*, responda:
✅ APROVAR ${med.codigo}

Para *reprovar*, responda:
❌ REPROVAR ${med.codigo} [motivo]

⏱️ Esta mensagem expira em 48 horas.`;
}

/**
 * Notifica o aprovador do nível atual via WhatsApp.
 * Busca os usuários do grupo configurado na alçada para aquele nível
 * e envia mensagem para todos que tiverem telefone cadastrado.
 *
 * @param {object} med - dados da medição (id, codigo, status, obra_id, empresa_id, etc.)
 * @returns {Promise<{enviados: number, erros: string[]}>}
 */
async function notificarAprovadores(med) {
  // WhatsApp desativado temporariamente — reativar removendo este return
  return { enviados: 0, erros: ['WhatsApp desativado.'] };
  // eslint-disable-next-line no-unreachable
  const cfg = await _loadCfg();
  if (!cfg.ativo) return { enviados: 0, erros: ['WhatsApp não configurado ou inativo.'] };

  // Determina nível atual
  const lvMap  = { 'Aguardando N1': 'N1', 'Aguardando N2': 'N2', 'Aguardando N3': 'N3' };
  const nivel  = lvMap[med.status];
  if (!nivel) return { enviados: 0, erros: [`Status "${med.status}" não tem nível de aprovação.`] };
  const nKey   = nivel.toLowerCase(); // 'n1', 'n2', 'n3'

  // Busca alçada da obra/empresa
  const alcR = await db.query(
    `SELECT * FROM alcadas
      WHERE empresa_id = $1
        AND (obra_id = $2 OR obra_id IS NULL)
        AND ativo = true
      ORDER BY obra_id NULLS LAST
      LIMIT 1`,
    [med.empresa_id, med.obra_id]
  );
  if (!alcR.rows[0]) return { enviados: 0, erros: ['Nenhuma alçada configurada para esta obra/empresa.'] };
  const alc    = alcR.rows[0];
  const grupos = alc[`${nKey}_grupos`] || [];

  // Busca usuários dos grupos com telefone cadastrado
  const usersR = await db.query(
    `SELECT id, nome, telefone, grupos_ad
       FROM usuarios
      WHERE ativo = true
        AND telefone IS NOT NULL
        AND grupos_ad && $1::text[]`,
    [grupos]
  );

  const enviados = [];
  const erros    = [];

  for (const u of usersR.rows) {
    try {
      await sendText(cfg, u.telefone, _textoAprovacao(med, nivel, u.nome));
      console.log(`[WhatsApp] Notificação enviada para ${u.nome} (${u.telefone}) — medição ${med.codigo}`);
      enviados.push(u.nome);
    } catch (e) {
      console.error(`[WhatsApp] Erro ao notificar ${u.nome}:`, e.message);
      erros.push(`${u.nome}: ${e.message}`);
    }
  }

  if (!usersR.rows.length) erros.push('Nenhum aprovador com telefone cadastrado encontrado nos grupos da alçada.');
  return { enviados: enviados.length, erros };
}

/**
 * Verifica se a Evolution API está acessível e a instância conectada.
 */
async function testConnection(cfg) {
  const inst   = cfg.instancia || 'construtivo';
  const status = await _evReq(cfg, 'GET', `/instance/connectionState/${inst}`, null);
  return status;
}

module.exports = { sendText, notificarAprovadores, testConnection, _fmtTel };
