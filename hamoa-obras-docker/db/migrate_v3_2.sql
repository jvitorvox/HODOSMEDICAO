-- ══════════════════════════════════════════════════════════════
-- CONSTRUTIVO OBRAS — Migração v3.2
-- Adiciona campos de dados cadastrais estendidos no fornecedores:
--   endereco, representante, cargo_representante
--
-- Execute UMA VEZ no banco de dados existente:
--   docker exec construtivo-obras-db psql -U construtivo -d construtivo_obras -f /docker-entrypoint-initdb.d/migrate_v3_2.sql
-- ══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE fornecedores
    ADD COLUMN IF NOT EXISTS endereco            VARCHAR(500),
    ADD COLUMN IF NOT EXISTS representante       VARCHAR(200),
    ADD COLUMN IF NOT EXISTS cargo_representante VARCHAR(100);

COMMIT;

-- ── Verificação ───────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fornecedores' AND column_name = 'representante'
    ) THEN
        RAISE NOTICE '✓ Migração v3.2 aplicada com sucesso.';
    ELSE
        RAISE EXCEPTION '✗ Falha ao adicionar colunas em fornecedores.';
    END IF;
END$$;
