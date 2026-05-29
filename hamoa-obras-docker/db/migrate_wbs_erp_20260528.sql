-- Migration: coluna wbs_erp em atividades_cronograma
-- Data: 2026-05-28
-- Contexto:
--   O campo personalizado "wbs erp" do MS Project (Texto23/FieldID 188744009)
--   armazena o código WBS do módulo de Planejamento UAU (ex: "01.04.11.01").
--   É o parâmetro `item` necessário para AcompanharServicoPL na integração de medições.
--   Antes era salvo apenas no JSONB campos_extras; agora tem coluna própria.

BEGIN;

ALTER TABLE atividades_cronograma
  ADD COLUMN IF NOT EXISTS wbs_erp TEXT;

COMMENT ON COLUMN atividades_cronograma.wbs_erp IS
  'WBS do módulo de Planejamento UAU — lido do campo personalizado "wbs erp" (Texto23) do MS Project. '
  'Usado como parâmetro `item` em AcompanharServicoPL.';

-- Popula a partir do campos_extras já importados (retroativo)
UPDATE atividades_cronograma
   SET wbs_erp = campos_extras->>'wbs erp'
 WHERE campos_extras ? 'wbs erp'
   AND (campos_extras->>'wbs erp') <> '';

COMMIT;
