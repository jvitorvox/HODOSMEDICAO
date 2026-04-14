-- ══════════════════════════════════════════════════════════════
-- CONSTRUTIVO OBRAS — Schema do Banco de Dados (PostgreSQL)
-- ══════════════════════════════════════════════════════════════

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- busca textual

-- ── Empresas ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
    id           SERIAL PRIMARY KEY,
    razao_social VARCHAR(200) NOT NULL,
    nome_fantasia VARCHAR(200),
    cnpj         VARCHAR(20) NOT NULL UNIQUE,
    ativo        BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Obras ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS obras (
    id           SERIAL PRIMARY KEY,
    empresa_id   INTEGER NOT NULL REFERENCES empresas(id),
    codigo       VARCHAR(20) NOT NULL UNIQUE,
    nome         VARCHAR(200) NOT NULL,
    localizacao  VARCHAR(200),
    gestor       VARCHAR(150),
    status       VARCHAR(50) NOT NULL DEFAULT 'Em andamento'
                 CHECK (status IN ('Em andamento','Concluído','Paralisado')),
    criado_em    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Fornecedores ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fornecedores (
    id                  SERIAL PRIMARY KEY,
    razao_social        VARCHAR(200) NOT NULL,
    nome_fantasia       VARCHAR(200),
    cnpj                VARCHAR(20) NOT NULL UNIQUE,
    tel                 VARCHAR(30),
    email               VARCHAR(150),
    email_nf            VARCHAR(150),
    email_assin         VARCHAR(150),
    endereco            VARCHAR(500),
    representante       VARCHAR(200),
    cargo_representante VARCHAR(100),
    ativo               BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Contratos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contratos (
    id              SERIAL PRIMARY KEY,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    obra_id         INTEGER NOT NULL REFERENCES obras(id),
    fornecedor_id   INTEGER NOT NULL REFERENCES fornecedores(id),
    numero          VARCHAR(30) NOT NULL UNIQUE,
    objeto          TEXT NOT NULL,
    valor_total     NUMERIC(15,2) NOT NULL DEFAULT 0,
    pct_executado   NUMERIC(5,2) NOT NULL DEFAULT 0,
    inicio          DATE,
    termino         DATE,
    status          VARCHAR(30) NOT NULL DEFAULT 'Vigente'
                    CHECK (status IN ('Vigente','Encerrado','Suspenso')),
    obs             TEXT,
    criado_em       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Medições ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicoes (
    id              SERIAL PRIMARY KEY,
    codigo          VARCHAR(30) NOT NULL UNIQUE,
    empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
    obra_id         INTEGER NOT NULL REFERENCES obras(id),
    fornecedor_id   INTEGER NOT NULL REFERENCES fornecedores(id),
    contrato_id     INTEGER NOT NULL REFERENCES contratos(id),
    periodo         VARCHAR(7) NOT NULL,   -- formato: YYYY-MM
    pct_anterior    NUMERIC(5,2) NOT NULL DEFAULT 0,
    pct_mes         NUMERIC(5,2) NOT NULL DEFAULT 0,
    pct_total       NUMERIC(5,2) NOT NULL DEFAULT 0,
    valor_medicao   NUMERIC(15,2) NOT NULL DEFAULT 0,
    valor_acumulado NUMERIC(15,2) NOT NULL DEFAULT 0,
    descricao       TEXT,
    status          VARCHAR(30) NOT NULL DEFAULT 'Rascunho'
                    CHECK (status IN ('Rascunho','Aguardando N1','Aguardando N2','Aguardando N3','Aprovado','Em Assinatura','Concluído','Reprovado')),
    criado_por      VARCHAR(150),
    criado_em       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Itens de Contrato ─────────────────────────────────────────
-- Planilha orçamentária do contrato: lista de serviços/itens
-- com quantidades previstas e preços unitários.
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

-- ── Itens de Medição ──────────────────────────────────────────
-- Cada medição pode ter N itens com unidades distintas:
-- % (percentual), m², m, kg, l, un, vb, t, h, etc.
-- contrato_item_id vincula ao item do contrato para rastrear saldo.
CREATE TABLE IF NOT EXISTS medicao_itens (
    id                SERIAL PRIMARY KEY,
    medicao_id        INTEGER NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
    contrato_item_id  INTEGER REFERENCES contrato_itens(id) ON DELETE SET NULL,
    ordem             SMALLINT NOT NULL DEFAULT 0,
    descricao         VARCHAR(500) NOT NULL,
    unidade           VARCHAR(20) NOT NULL DEFAULT '%',
    qtd_contrato      NUMERIC(15,4) NOT NULL DEFAULT 0,
    qtd_anterior      NUMERIC(15,4) NOT NULL DEFAULT 0,
    qtd_mes           NUMERIC(15,4) NOT NULL DEFAULT 0,
    qtd_acumulada     NUMERIC(15,4) NOT NULL DEFAULT 0,
    valor_unitario    NUMERIC(15,4) NOT NULL DEFAULT 0,
    valor_item        NUMERIC(15,2) NOT NULL DEFAULT 0,
    criado_em         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_medicao_itens_medicao        ON medicao_itens(medicao_id);
CREATE INDEX IF NOT EXISTS idx_medicao_itens_contrato_item  ON medicao_itens(contrato_item_id);

-- ── Evidências de Medições ────────────────────────────────────
CREATE TABLE IF NOT EXISTS evidencias (
    id          SERIAL PRIMARY KEY,
    medicao_id  INTEGER NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
    nome        VARCHAR(300) NOT NULL,
    tipo        VARCHAR(20),    -- img | pdf | video | doc
    tamanho     VARCHAR(20),
    caminho     VARCHAR(500),   -- path no servidor / bucket S3
    criado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Aprovações ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aprovacoes (
    id          SERIAL PRIMARY KEY,
    medicao_id  INTEGER NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
    nivel       VARCHAR(10) NOT NULL,   -- N1 | N2 | N3 | Sistema
    acao        VARCHAR(20) NOT NULL,   -- aprovado | reprovado | lançado
    usuario     VARCHAR(150) NOT NULL,
    comentario  TEXT,
    data_hora   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Alçadas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alcadas (
    id                SERIAL PRIMARY KEY,
    empresa_id        INTEGER NOT NULL REFERENCES empresas(id),
    obra_id           INTEGER REFERENCES obras(id),   -- NULL = todas as obras
    nome              VARCHAR(200) NOT NULL,
    n1_titulo         VARCHAR(100),
    n1_grupos         TEXT[],     -- array de grupos do AD
    n1_prazo          INTEGER NOT NULL DEFAULT 3,
    n2_titulo         VARCHAR(100),
    n2_grupos         TEXT[],
    n2_prazo          INTEGER NOT NULL DEFAULT 2,
    n3_titulo         VARCHAR(100),
    n3_grupos         TEXT[],
    n3_prazo          INTEGER NOT NULL DEFAULT 5,
    escalonamento     BOOLEAN DEFAULT FALSE,
    escalonamento_dias INTEGER DEFAULT 2,
    email_copia       VARCHAR(200),
    ativo             BOOLEAN DEFAULT TRUE,
    criado_em         TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Configurações do Sistema ──────────────────────────────────
CREATE TABLE IF NOT EXISTS configuracoes (
    chave     VARCHAR(50) PRIMARY KEY,
    valor     JSONB NOT NULL,
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Usuários / Sessões (se não usar LDAP) ─────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL PRIMARY KEY,
    login         VARCHAR(100) NOT NULL UNIQUE,
    nome          VARCHAR(200),
    email         VARCHAR(200),
    senha_hash    VARCHAR(300),    -- bcrypt
    grupos_ad     TEXT[],
    perfil        VARCHAR(20) DEFAULT 'N1'
                  CHECK (perfil IN ('N1','N2','N3','ADM')),
    ativo         BOOLEAN DEFAULT TRUE,
    ultimo_acesso TIMESTAMP WITH TIME ZONE,
    criado_em     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Índices para performance ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_medicoes_empresa    ON medicoes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_medicoes_obra       ON medicoes(obra_id);
CREATE INDEX IF NOT EXISTS idx_medicoes_status     ON medicoes(status);
CREATE INDEX IF NOT EXISTS idx_medicoes_periodo    ON medicoes(periodo);
CREATE INDEX IF NOT EXISTS idx_aprovacoes_medicao  ON aprovacoes(medicao_id);
CREATE INDEX IF NOT EXISTS idx_alcadas_empresa     ON alcadas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_alcadas_obra        ON alcadas(obra_id);
CREATE INDEX IF NOT EXISTS idx_obras_empresa       ON obras(empresa_id);
CREATE INDEX IF NOT EXISTS idx_contratos_obra      ON contratos(obra_id);

-- ── Trigger: atualiza atualizado_em automaticamente ───────────
CREATE OR REPLACE FUNCTION update_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['empresas','obras','fornecedores','contratos','medicoes','alcadas']
    LOOP
        EXECUTE format('
            DROP TRIGGER IF EXISTS trg_%I_updated ON %I;
            CREATE TRIGGER trg_%I_updated
            BEFORE UPDATE ON %I
            FOR EACH ROW EXECUTE FUNCTION update_atualizado_em();
        ', t, t, t, t);
    END LOOP;
END$$;
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
    uid_externo     INTEGER,                           -- UniqueID original do MS Project
    custo_planejado NUMERIC(15,2)                      -- Custo planejado importado do MS Project (campo Cost)
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

-- ── Auditoria ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    usuario_id    INTEGER,                          -- NULL se ação anônima (ex: login falhou)
    usuario_login VARCHAR(100) NOT NULL DEFAULT '', -- login do usuário
    usuario_nome  VARCHAR(200) NOT NULL DEFAULT '', -- nome legível
    acao          VARCHAR(80)  NOT NULL,            -- ex: 'criar', 'editar', 'excluir', 'importar', 'aprovar'
    entidade      VARCHAR(60)  NOT NULL,            -- ex: 'medicao', 'contrato', 'cronograma', 'empresa'
    entidade_id   INTEGER,                          -- PK do registro afetado (quando aplicável)
    descricao     TEXT,                             -- resumo legível da operação
    detalhes      JSONB,                            -- payload extra (campos alterados, etc.)
    ip            VARCHAR(50),                      -- IP do cliente
    criado_em     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_criado_em  ON audit_logs(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entidade   ON audit_logs(entidade);
CREATE INDEX IF NOT EXISTS idx_audit_usuario_id ON audit_logs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_acao       ON audit_logs(acao);
