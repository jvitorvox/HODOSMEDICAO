-- ================================================================
-- Script: limpar-medicoes.sql
-- Apaga TODAS as medições e envios de NF (para reset de testes).
-- ================================================================

BEGIN;

-- Ordem: dependentes primeiro, principal por último

-- 1. Tokens WhatsApp vinculados a medições
DELETE FROM whatsapp_tokens;

-- 2. NFs enviadas pelo portal
DELETE FROM portal_nfs;

-- 3. Tokens do portal do fornecedor
DELETE FROM portal_tokens;

-- 4. Evidências das medições
DELETE FROM evidencias;

-- 5. Itens de medição
DELETE FROM medicao_itens;

-- 6. Aprovações
DELETE FROM aprovacoes;

-- 7. Progresso LBM (zera referência às medições)
UPDATE lbm_progresso SET medicao_id = NULL, status = 'nao_iniciado',
  data_inicio_real = NULL, data_fim_real = NULL;

-- 8. Logs de auditoria de medições
DELETE FROM audit_logs WHERE entidade = 'medicao';

-- 9. Medições (principal)
DELETE FROM medicoes;

COMMIT;

SELECT 'Limpeza concluída com sucesso.' AS resultado;
