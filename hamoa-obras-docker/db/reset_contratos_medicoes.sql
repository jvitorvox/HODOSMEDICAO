-- ══════════════════════════════════════════════════════════════════
-- CONSTRUTIVO OBRAS — Reset de Contratos e Medições
-- Limpa APENAS: medições e contratos (mantém obras, fornecedores, empresas)
-- Preserva: usuarios, configuracoes, alcadas, obras, fornecedores, empresas
--
-- PowerShell (copie o arquivo e execute):
--   docker cp db/reset_contratos_medicoes.sql construtivo-obras-db:/tmp/
--   docker exec construtivo-obras-db psql -U construtivo -d construtivo_obras -f /tmp/reset_contratos_medicoes.sql
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Dependentes de medições ────────────────────────────────────
TRUNCATE TABLE evidencias          RESTART IDENTITY CASCADE;
TRUNCATE TABLE aprovacoes          RESTART IDENTITY CASCADE;
TRUNCATE TABLE medicao_itens       RESTART IDENTITY CASCADE;
TRUNCATE TABLE medicoes            RESTART IDENTITY CASCADE;

-- ── 2. Cronograma e vínculos ──────────────────────────────────────
TRUNCATE TABLE contratos_atividades  RESTART IDENTITY CASCADE;
TRUNCATE TABLE atividades_cronograma RESTART IDENTITY CASCADE;
TRUNCATE TABLE cronogramas           RESTART IDENTITY CASCADE;

-- ── 3. Contratos e itens ─────────────────────────────────────────
TRUNCATE TABLE contrato_itens      RESTART IDENTITY CASCADE;
TRUNCATE TABLE contratos           RESTART IDENTITY CASCADE;

-- ── Mantém: obras, fornecedores, empresas, usuarios, alcadas ─────

COMMIT;

-- Confirma
SELECT 'contratos'  AS tabela, COUNT(*) AS registros FROM contratos
UNION ALL
SELECT 'contrato_itens',       COUNT(*) FROM contrato_itens
UNION ALL
SELECT 'medicoes',             COUNT(*) FROM medicoes
UNION ALL
SELECT 'medicao_itens',        COUNT(*) FROM medicao_itens
UNION ALL
SELECT 'aprovacoes',           COUNT(*) FROM aprovacoes
UNION ALL
SELECT '--- preservados ---',  0
UNION ALL
SELECT 'obras',                COUNT(*) FROM obras
UNION ALL
SELECT 'fornecedores',         COUNT(*) FROM fornecedores
UNION ALL
SELECT 'empresas',             COUNT(*) FROM empresas
ORDER BY tabela;
