-- Migration: Campos de planejamento UAU nos contratos e itens
-- Data: 2026-05-28
-- Contexto:
--   Para integrar medições ao módulo de Planejamento do UAU via AcompanharServicoPL,
--   precisamos armazenar os códigos de produto e contrato do planejamento (nível contrato)
--   e o código do item/WBS do planejamento (nível item).
--
--   Chain completo para AcompanharServicoPL:
--     empresa          ← empresas.uau_empresa
--     obra             ← obras.uau_obra
--     produto          ← contratos.uau_produto_pl  (NOVO)
--     contrato         ← contratos.uau_contrato_pl (NOVO)
--     item             ← atividades_cronograma.wbs  OU contrato_itens.uau_item_planejamento (NOVO)
--     servico          ← contrato_itens.uau_codigo_acompanhamento
--     contratoVinculado← contratos.uau_contrato

BEGIN;

ALTER TABLE contratos
  ADD COLUMN IF NOT EXISTS uau_produto_pl  INTEGER,
  ADD COLUMN IF NOT EXISTS uau_contrato_pl INTEGER;

COMMENT ON COLUMN contratos.uau_produto_pl  IS 'Código do produto no módulo de Planejamento UAU';
COMMENT ON COLUMN contratos.uau_contrato_pl IS 'Número do contrato no módulo de Planejamento UAU (pode diferir do contrato financeiro)';

ALTER TABLE contrato_itens
  ADD COLUMN IF NOT EXISTS uau_item_planejamento TEXT;

COMMENT ON COLUMN contrato_itens.uau_item_planejamento IS 'Código do item/WBS no planejamento UAU — igual ao WBS da atividade do cronograma vinculada. Usado como parâmetro "item" em AcompanharServicoPL.';

COMMIT;
