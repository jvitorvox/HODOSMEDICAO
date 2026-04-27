-- ================================================================
-- Script: apagar-medicoes.sql
-- Apaga as medições MED-2604-242 e MED-2604-717 e todos os
-- registros dependentes (itens, aprovações, evidências, NFs, tokens).
-- ================================================================

BEGIN;

-- Identifica os IDs pelo código
DO $$
DECLARE
  codigos TEXT[] := ARRAY['MED-2604-242', 'MED-2604-717'];
  ids     INT[];
BEGIN
  SELECT ARRAY_AGG(id) INTO ids
    FROM medicoes
   WHERE codigo = ANY(codigos);

  IF ids IS NULL OR array_length(ids, 1) = 0 THEN
    RAISE EXCEPTION 'Nenhuma medição encontrada com os códigos informados.';
  END IF;

  RAISE NOTICE 'Medições encontradas: IDs = %', ids;

  -- 1. lbm_progresso: zera referência (nullable)
  UPDATE lbm_progresso SET medicao_id = NULL WHERE medicao_id = ANY(ids);
  RAISE NOTICE 'lbm_progresso: referências limpas.';

  -- 2. Itens de medição
  DELETE FROM medicao_itens WHERE medicao_id = ANY(ids);
  RAISE NOTICE 'medicao_itens: % linhas removidas.', (SELECT COUNT(*) FROM medicao_itens WHERE medicao_id = ANY(ids));

  -- 3. Aprovações
  DELETE FROM aprovacoes WHERE medicao_id = ANY(ids);

  -- 4. Evidências
  DELETE FROM evidencias WHERE medicao_id = ANY(ids);

  -- 5. NFs do portal (ON DELETE CASCADE, mas forçamos para segurança)
  DELETE FROM portal_nfs WHERE medicao_id = ANY(ids);

  -- 6. Tokens WhatsApp (ON DELETE CASCADE, mas forçamos para segurança)
  DELETE FROM whatsapp_tokens WHERE medicao_id = ANY(ids);

  -- 7. Audit logs relacionados
  DELETE FROM audit_logs WHERE entidade = 'medicao' AND entidade_id = ANY(ids);

  -- 8. Medições (principal)
  DELETE FROM medicoes WHERE id = ANY(ids);
  RAISE NOTICE 'Medições removidas com sucesso.';
END;
$$;

COMMIT;
