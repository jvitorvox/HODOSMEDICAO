-- ── Migração: tipo de medição (Adiantamento / Avanço Físico) ─────────────────
-- Executar: docker exec -i hamoa-obras-db psql -U hamoa -d hamoa_obras < db/migrate_medicao_tipo.sql

ALTER TABLE medicoes
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'Normal'
  CHECK (tipo IN ('Normal', 'Adiantamento', 'Avanco_Fisico'));

CREATE INDEX IF NOT EXISTS idx_medicoes_tipo ON medicoes(tipo);

-- Garante que Avanço Físico não gera valor financeiro na constraint
-- (regra de negócio aplicada no backend, não no banco)

COMMENT ON COLUMN medicoes.tipo IS
  'Normal = medição padrão (físico + financeiro); '
  'Adiantamento = pagamento antecipado sem avanço físico; '
  'Avanco_Fisico = registro de execução física sem pagamento (fecha descompasso)';
