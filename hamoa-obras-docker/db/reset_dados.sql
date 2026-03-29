-- ══════════════════════════════════════════════════════════════════
-- HAMOA OBRAS — Reset de Dados para Testes
-- Limpa: medições, contratos, obras, fornecedores, empresas, cronogramas
-- Preserva: usuarios, configuracoes, alcadas
--
-- PowerShell:
--   docker exec hamoa-obras-db psql -U hamoa -d hamoa_obras -f /reset_dados.sql
-- (copie este arquivo para o container antes com docker cp)
--
-- Ou execute comando a comando no terminal abaixo.
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

-- ── 4. Obras, fornecedores, empresas ─────────────────────────────
TRUNCATE TABLE obras               RESTART IDENTITY CASCADE;
TRUNCATE TABLE fornecedores        RESTART IDENTITY CASCADE;
TRUNCATE TABLE empresas            RESTART IDENTITY CASCADE;

-- ── Mantém intocado: usuarios, configuracoes, alcadas ─────────────

COMMIT;

-- Confirma
SELECT 'empresas'            AS tabela, COUNT(*) AS registros FROM empresas
UNION ALL
SELECT 'obras',               COUNT(*) FROM obras
UNION ALL
SELECT 'fornecedores',        COUNT(*) FROM fornecedores
UNION ALL
SELECT 'contratos',           COUNT(*) FROM contratos
UNION ALL
SELECT 'medicoes',            COUNT(*) FROM medicoes
UNION ALL
SELECT 'cronogramas',         COUNT(*) FROM cronogramas
UNION ALL
SELECT '--- preservados ---', 0
UNION ALL
SELECT 'usuarios',            COUNT(*) FROM usuarios
UNION ALL
SELECT 'alcadas',             COUNT(*) FROM alcadas
UNION ALL
SELECT 'configuracoes',       COUNT(*) FROM configuracoes
ORDER BY tabela;
