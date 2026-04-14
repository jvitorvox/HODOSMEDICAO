-- ══════════════════════════════════════════════════════════════
-- CONSTRUTIVO OBRAS — Migração v3.1
-- Adiciona planilha orçamentária de contratos (contrato_itens)
-- e rastreamento de itens de medição por item do contrato.
--
-- Execute UMA VEZ no banco de dados existente:
--   docker exec construtivo-obras-db psql -U construtivo -d construtivo_obras -f /docker-entrypoint-initdb.d/migrate_v3_1.sql
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Tabela de itens do contrato ────────────────────────────
CREATE TABLE IF NOT EXISTS contrato_itens (
    id              SERIAL PRIMARY KEY,
    contrato_id     INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    ordem           SMALLINT NOT NULL DEFAULT 0,
    descricao       VARCHAR(500) NOT NULL,
    unidade         VARCHAR(20)  NOT NULL DEFAULT 'un',
    qtd_total       NUMERIC(15,4) NOT NULL DEFAULT 0,
    valor_unitario  NUMERIC(15,4) NOT NULL DEFAULT 0,
    valor_total     NUMERIC(15,2) NOT NULL DEFAULT 0,
    criado_em       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contrato_itens_contrato ON contrato_itens(contrato_id);

-- ── 2. FK de medicao_itens → contrato_itens ──────────────────
ALTER TABLE medicao_itens
    ADD COLUMN IF NOT EXISTS contrato_item_id INTEGER
        REFERENCES contrato_itens(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_medicao_itens_contrato_item
    ON medicao_itens(contrato_item_id);

COMMIT;

-- ── Verificação ───────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'contrato_itens'
    ) THEN
        RAISE NOTICE '✓ Migração v3.1 aplicada com sucesso.';
    ELSE
        RAISE EXCEPTION '✗ Falha ao criar tabela contrato_itens.';
    END IF;
END$$;
