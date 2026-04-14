-- ══════════════════════════════════════════════════════════════
-- CONSTRUTIVO OBRAS — Migração: Módulo de Cronograma de Obra
-- Execute manualmente no banco após o deploy:
--   docker exec -i construtivo-obras-db psql -U construtivo -d construtivo_obras < db/migrate_cronograma.sql
-- ══════════════════════════════════════════════════════════════

-- ── Cronogramas (cabeçalho de cada importação) ────────────────
CREATE TABLE IF NOT EXISTS cronogramas (
    id            SERIAL PRIMARY KEY,
    obra_id       INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
    nome          VARCHAR(255) NOT NULL,
    versao        INTEGER NOT NULL DEFAULT 1,
    arquivo_nome  VARCHAR(300),
    data_inicio   DATE,
    data_termino  DATE,
    importado_em  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    importado_por VARCHAR(150),
    ativo         BOOLEAN NOT NULL DEFAULT TRUE
);

-- ── Atividades do cronograma (WBS) ────────────────────────────
-- Suporta hierarquia ilimitada via parent_id (adjacency list)
CREATE TABLE IF NOT EXISTS atividades_cronograma (
    id              SERIAL PRIMARY KEY,
    cronograma_id   INTEGER NOT NULL REFERENCES cronogramas(id) ON DELETE CASCADE,
    parent_id       INTEGER REFERENCES atividades_cronograma(id) ON DELETE SET NULL,
    wbs             VARCHAR(50),
    nome            VARCHAR(500) NOT NULL,
    data_inicio     DATE,
    data_termino    DATE,
    duracao         INTEGER,           -- duração em dias
    nivel           INTEGER NOT NULL DEFAULT 0,
    pct_planejado   NUMERIC(5,2) NOT NULL DEFAULT 0,
    pct_realizado   NUMERIC(5,2) NOT NULL DEFAULT 0,   -- atualizado via contratos vinculados
    eh_resumo       BOOLEAN NOT NULL DEFAULT FALSE,    -- TRUE = nó pai/grupo no WBS
    ordem           INTEGER NOT NULL DEFAULT 0,        -- ordem original do MPP
    uid_externo     INTEGER                            -- UniqueID original do MS Project
);

-- ── Vínculo Contrato ↔ Atividade(s) ──────────────────────────
CREATE TABLE IF NOT EXISTS contratos_atividades (
    id            SERIAL PRIMARY KEY,
    contrato_id   INTEGER NOT NULL REFERENCES contratos(id)              ON DELETE CASCADE,
    atividade_id  INTEGER NOT NULL REFERENCES atividades_cronograma(id)  ON DELETE CASCADE,
    UNIQUE (contrato_id, atividade_id)
);

-- ── Índices de performance ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cronogramas_obra       ON cronogramas(obra_id);
CREATE INDEX IF NOT EXISTS idx_atividades_cronograma  ON atividades_cronograma(cronograma_id);
CREATE INDEX IF NOT EXISTS idx_atividades_parent      ON atividades_cronograma(parent_id);
CREATE INDEX IF NOT EXISTS idx_contratos_atividades_c ON contratos_atividades(contrato_id);
CREATE INDEX IF NOT EXISTS idx_contratos_atividades_a ON contratos_atividades(atividade_id);
