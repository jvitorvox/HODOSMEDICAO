-- ══════════════════════════════════════════════════════════════
-- HAMOA OBRAS — Schema do Banco de Dados (PostgreSQL)
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
    id            SERIAL PRIMARY KEY,
    razao_social  VARCHAR(200) NOT NULL,
    nome_fantasia VARCHAR(200),
    cnpj          VARCHAR(20) NOT NULL UNIQUE,
    tel           VARCHAR(30),
    email         VARCHAR(150),
    email_nf      VARCHAR(150),
    email_assin   VARCHAR(150),
    ativo         BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
