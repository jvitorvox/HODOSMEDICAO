-- Migration: coluna data_entrega em req_materiais
-- Data: 2026-05-29
-- Contexto: salva a data de entrega informada no modal de aprovação UAU
-- para exibição no portal do fornecedor.

BEGIN;

ALTER TABLE req_materiais
  ADD COLUMN IF NOT EXISTS data_entrega DATE;

COMMENT ON COLUMN req_materiais.data_entrega IS
  'Data de entrega prevista — preenchida na aprovação do pedido e enviada ao UAU.';

COMMIT;
