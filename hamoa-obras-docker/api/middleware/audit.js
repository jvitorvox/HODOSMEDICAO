'use strict';
/**
 * audit.js — helper de auditoria
 *
 * Uso:
 *   const audit = require('../middleware/audit');
 *   await audit(req, 'criar', 'empresa', novaEmpresa.id, `Empresa "${novaEmpresa.razao_social}" criada`);
 *
 * Fire-and-forget seguro: erros de log nunca propagam para o response.
 */

const db = require('../db');

/**
 * Registra uma ação no log de auditoria.
 *
 * @param {object}  req        - Express request (para extrair usuário e IP)
 * @param {string}  acao       - Verbo da ação: 'criar' | 'editar' | 'excluir' | 'importar' |
 *                               'aprovar' | 'reprovar' | 'enviar_assinatura' | 'login' |
 *                               'trocar_senha' | 'reset_senha' | 'salvar_config' | 'vincular'
 * @param {string}  entidade   - Nome da entidade: 'empresa' | 'obra' | 'fornecedor' | 'contrato' |
 *                               'medicao' | 'cronograma' | 'usuario' | 'configuracao' | 'alcada'
 * @param {number|null} entidadeId  - PK do registro afetado
 * @param {string|null} descricao  - Resumo legível (ex: 'Medição MED-2501-042 aprovada N1')
 * @param {object|null} detalhes   - Objeto JSON com dados extras (ex: campos alterados)
 */
async function audit(req, acao, entidade, entidadeId = null, descricao = null, detalhes = null) {
  try {
    const u = req.user || {};
    // Extrai IP real considerando proxies (Nginx seta X-Forwarded-For)
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;

    await db.query(
      `INSERT INTO audit_logs
         (usuario_id, usuario_login, usuario_nome, acao, entidade, entidade_id, descricao, detalhes, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        u.id    || null,
        u.login || '',
        u.nome  || '',
        acao,
        entidade,
        entidadeId || null,
        descricao  || null,
        detalhes ? JSON.stringify(detalhes) : null,
        ip,
      ]
    );
  } catch (err) {
    // Log nunca deve derrubar o fluxo principal
    console.error('[audit] Falha ao registrar log:', err.message);
  }
}

module.exports = audit;
