-- ============================================================
-- Script: set_gatilho_zero.sql
-- Preenche gatilho_dias = 0 em todas as atividades onde
-- o campo está NULL (não configurado no MS Project).
--
-- Efeito no Coloridão:
--   • gatilho_dias = 0 → atividade entra no monitoramento
--     com gatilho imediato (já dispara no dia de início).
--   • atividades que antes ficavam em "Sem gatilho" (⚫)
--     passarão a ser avaliadas como verde/amarelo/vermelho.
--
-- Execute com:
--   docker compose exec construtivo-db psql -U postgres -d construtivo -f /docker-entrypoint-initdb.d/set_gatilho_zero.sql
-- Ou diretamente no psql:
--   \i /caminho/para/set_gatilho_zero.sql
-- ============================================================

BEGIN;

-- Diagnóstico antes
SELECT
  COUNT(*)                                          AS total_atividades,
  COUNT(*) FILTER (WHERE gatilho_dias IS NULL)      AS sem_gatilho_null,
  COUNT(*) FILTER (WHERE gatilho_dias IS NOT NULL)  AS com_gatilho_definido,
  COUNT(*) FILTER (WHERE gatilho_dias = 0)          AS gatilho_zero
FROM atividades_cronograma;

-- Atualização
UPDATE atividades_cronograma
SET    gatilho_dias = 0
WHERE  gatilho_dias IS NULL;

-- Quantas linhas foram afetadas
-- (o psql mostrará "UPDATE N" logo abaixo)

-- Diagnóstico depois
SELECT
  COUNT(*)                                          AS total_atividades,
  COUNT(*) FILTER (WHERE gatilho_dias IS NULL)      AS ainda_null,
  COUNT(*) FILTER (WHERE gatilho_dias = 0)          AS gatilho_zero,
  COUNT(*) FILTER (WHERE gatilho_dias > 0)          AS gatilho_positivo
FROM atividades_cronograma;

COMMIT;
