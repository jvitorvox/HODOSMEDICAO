-- ================================================================
-- CONSTRUTIVO OBRAS — Migração Consolidada
-- Período: 20/05/2026 a 21/05/2026
--
-- Inclui (em ordem de dependência):
--   1.  RDC — Requisição de Compra                      (20/05)
--   2.  RDC Anexos                                       (20/05)
--   3.  Requisição de Material — Canteiro               (20/05)
--   4.  Requisição de Material v2 — Itens, WBS, Anexos  (20/05)
--   5.  Integração UAU — obras, contratos, medicoes     (20/05)
--   6.  Pedido de Compra via Portal do Fornecedor       (20/05)
--   7.  Cadastro de Insumos                             (20/05)
--   8.  UAU: código da empresa em empresas              (21/05)
--   9.  UAU: CAP no cadastro de insumos                 (21/05)
--   10. UAU: vínculos de planejamento por contrato      (21/05)
--   11. UAU: número do pedido em req_materiais          (21/05)
--
-- Como aplicar:
--   cat db/migrate_20_21_maio_2026.sql | docker compose exec -T construtivo-db psql -U construtivo -d construtivo_obras
--
-- Todos os comandos usam IF NOT EXISTS / IF NOT EXISTS para serem
-- idempotentes — seguro reaplicar em ambiente que já tenha parte das mudanças.
-- ================================================================


-- ================================================================
-- 1. RDC — Requisição de Compra (Módulo Suprimentos)
-- ================================================================

CREATE TABLE IF NOT EXISTS rdcs (
  id               SERIAL PRIMARY KEY,
  codigo           VARCHAR(20) UNIQUE,
  titulo           VARCHAR(500) NOT NULL,
  obra_id          INTEGER REFERENCES obras(id) ON DELETE CASCADE,
  atividade_id     INTEGER REFERENCES atividades_cronograma(id) ON DELETE SET NULL,
  cronograma_id    INTEGER REFERENCES cronogramas(id) ON DELETE SET NULL,
  grupo_pai        VARCHAR(500),
  wbs              VARCHAR(100),
  status           VARCHAR(50) NOT NULL DEFAULT 'rascunho',
  criado_por       VARCHAR(200),
  responsavel      VARCHAR(200),
  responsavel_nome VARCHAR(300),
  data_prazo       DATE,
  data_aprovacao   TIMESTAMP,
  data_contratacao TIMESTAMP,
  valor_estimado   NUMERIC(15,2),
  contrato_id      INTEGER REFERENCES contratos(id) ON DELETE SET NULL,
  observacoes      TEXT,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rdcs_obra      ON rdcs(obra_id);
CREATE INDEX IF NOT EXISTS idx_rdcs_status    ON rdcs(status);
CREATE INDEX IF NOT EXISTS idx_rdcs_atividade ON rdcs(atividade_id);
CREATE INDEX IF NOT EXISTS idx_rdcs_resp      ON rdcs(responsavel);

CREATE TABLE IF NOT EXISTS rdc_itens (
  id             SERIAL PRIMARY KEY,
  rdc_id         INTEGER NOT NULL REFERENCES rdcs(id) ON DELETE CASCADE,
  descricao      VARCHAR(500) NOT NULL,
  unidade        VARCHAR(50)  DEFAULT 'UN',
  quantidade     NUMERIC(15,3),
  custo_unitario NUMERIC(15,2),
  custo_total    NUMERIC(15,2),
  especificacao  TEXT,
  ordem          INTEGER DEFAULT 0,
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rdc_itens_rdc ON rdc_itens(rdc_id);

CREATE TABLE IF NOT EXISTS rdc_historico (
  id              SERIAL PRIMARY KEY,
  rdc_id          INTEGER NOT NULL REFERENCES rdcs(id) ON DELETE CASCADE,
  tipo            VARCHAR(50) DEFAULT 'comentario',
  status_anterior VARCHAR(50),
  status_novo     VARCHAR(50),
  comentario      TEXT,
  usuario         VARCHAR(200),
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rdc_hist_rdc ON rdc_historico(rdc_id);

CREATE SEQUENCE IF NOT EXISTS rdc_seq START 1;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rdcs_updated ON rdcs;
CREATE TRIGGER trg_rdcs_updated
  BEFORE UPDATE ON rdcs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION gen_rdc_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    NEW.codigo := 'RDC-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(nextval('rdc_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rdcs_codigo ON rdcs;
CREATE TRIGGER trg_rdcs_codigo
  BEFORE INSERT ON rdcs
  FOR EACH ROW EXECUTE FUNCTION gen_rdc_codigo();


-- ================================================================
-- 2. RDC Anexos
-- ================================================================

CREATE TABLE IF NOT EXISTS rdc_anexos (
  id          SERIAL PRIMARY KEY,
  rdc_id      INTEGER NOT NULL REFERENCES rdcs(id) ON DELETE CASCADE,
  nome        VARCHAR(300) NOT NULL,
  tipo        VARCHAR(20),
  tamanho     VARCHAR(20),
  caminho     VARCHAR(500),
  provider    VARCHAR(20) DEFAULT 'local',
  url_storage VARCHAR(1000),
  enviado_por VARCHAR(200),
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rdc_anexos_rdc ON rdc_anexos(rdc_id);


-- ================================================================
-- 3. Requisição de Material — Módulo Canteiro
-- ================================================================

CREATE TABLE IF NOT EXISTS req_materiais (
  id              SERIAL PRIMARY KEY,
  codigo          VARCHAR(20) UNIQUE,
  atividade_id    INTEGER REFERENCES atividades_cronograma(id) ON DELETE SET NULL,
  cronograma_id   INTEGER REFERENCES cronogramas(id)           ON DELETE SET NULL,
  obra_id         INTEGER REFERENCES obras(id)                 ON DELETE CASCADE,
  descricao       VARCHAR(500) NOT NULL,
  quantidade      NUMERIC(12,3),
  unidade         VARCHAR(50),
  observacao      TEXT,
  status          VARCHAR(50) NOT NULL DEFAULT 'pendente',
  criado_por      VARCHAR(200),
  criado_por_nome VARCHAR(300),
  atendido_por    VARCHAR(200),
  data_necessidade DATE,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS seq_req_materiais_codigo START 1;

CREATE OR REPLACE FUNCTION gerar_codigo_rm()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    NEW.codigo := 'RM-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
                  LPAD(NEXTVAL('seq_req_materiais_codigo')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gerar_codigo_rm ON req_materiais;
CREATE TRIGGER trg_gerar_codigo_rm
  BEFORE INSERT ON req_materiais
  FOR EACH ROW EXECUTE FUNCTION gerar_codigo_rm();

CREATE INDEX IF NOT EXISTS idx_req_mat_obra_id      ON req_materiais(obra_id);
CREATE INDEX IF NOT EXISTS idx_req_mat_atividade_id ON req_materiais(atividade_id);
CREATE INDEX IF NOT EXISTS idx_req_mat_status       ON req_materiais(status);
CREATE INDEX IF NOT EXISTS idx_req_mat_criado_por   ON req_materiais(criado_por);

CREATE TABLE IF NOT EXISTS req_materiais_historico (
  id          SERIAL PRIMARY KEY,
  rm_id       INTEGER NOT NULL REFERENCES req_materiais(id) ON DELETE CASCADE,
  status_de   VARCHAR(50),
  status_para VARCHAR(50) NOT NULL,
  observacao  TEXT,
  usuario     VARCHAR(200),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rm_hist_rm_id ON req_materiais_historico(rm_id);


-- ================================================================
-- 4. Requisição de Material v2 — Itens JSONB, WBS e Anexos
-- ================================================================

ALTER TABLE req_materiais
  ADD COLUMN IF NOT EXISTS itens JSONB       NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS wbs   VARCHAR(100);

CREATE TABLE IF NOT EXISTS req_materiais_anexos (
  id          SERIAL PRIMARY KEY,
  rm_id       INTEGER NOT NULL REFERENCES req_materiais(id) ON DELETE CASCADE,
  nome        VARCHAR(500) NOT NULL,
  tipo        VARCHAR(20)  NOT NULL DEFAULT 'other',
  tamanho     VARCHAR(30),
  caminho     VARCHAR(1000),
  provider    VARCHAR(50)  NOT NULL DEFAULT 'local',
  url_storage TEXT,
  enviado_por VARCHAR(200),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rm_anx_rm_id ON req_materiais_anexos(rm_id);


-- ================================================================
-- 5. Integração UAU (ERP Senior/Globaltec) — obras, contratos, medições
-- ================================================================

ALTER TABLE obras
  ADD COLUMN IF NOT EXISTS uau_obra        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS uau_obra_fiscal VARCHAR(30);

ALTER TABLE contratos
  ADD COLUMN IF NOT EXISTS uau_empresa  INTEGER,
  ADD COLUMN IF NOT EXISTS uau_contrato INTEGER;

ALTER TABLE contrato_itens
  ADD COLUMN IF NOT EXISTS uau_item                  INTEGER,
  ADD COLUMN IF NOT EXISTS uau_codigo_acompanhamento INTEGER;

ALTER TABLE medicoes
  ADD COLUMN IF NOT EXISTS uau_medicao_id   INTEGER,
  ADD COLUMN IF NOT EXISTS uau_processo_id  INTEGER,
  ADD COLUMN IF NOT EXISTS uau_integrado_em TIMESTAMPTZ;

INSERT INTO configuracoes (chave, valor) VALUES (
  'uau',
  '{
    "api_url":        "",
    "api_key":        "",
    "api_versao":     "1",
    "empresa_codigo": null,
    "ativo":          false
  }'::jsonb
) ON CONFLICT (chave) DO NOTHING;

COMMENT ON COLUMN obras.uau_obra                           IS 'Código da obra no ERP UAU';
COMMENT ON COLUMN obras.uau_obra_fiscal                    IS 'Código da obra fiscal no ERP UAU';
COMMENT ON COLUMN contratos.uau_empresa                    IS 'Código da empresa no ERP UAU';
COMMENT ON COLUMN contratos.uau_contrato                   IS 'Número do contrato no ERP UAU';
COMMENT ON COLUMN contrato_itens.uau_item                  IS 'Número do item no contrato UAU';
COMMENT ON COLUMN contrato_itens.uau_codigo_acompanhamento IS 'Código do acompanhamento/serviço no UAU';
COMMENT ON COLUMN medicoes.uau_medicao_id                  IS 'ID da medição gerada no ERP UAU';
COMMENT ON COLUMN medicoes.uau_processo_id                 IS 'ID do processo de pagamento no ERP UAU';


-- ================================================================
-- 6. Pedido de Compra via Portal do Fornecedor
-- ================================================================

ALTER TABLE req_materiais
  ADD COLUMN IF NOT EXISTS origem        VARCHAR(30) NOT NULL DEFAULT 'encarregado',
  ADD COLUMN IF NOT EXISTS fornecedor_id INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contrato_id   INTEGER REFERENCES contratos(id)    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_req_mat_origem     ON req_materiais(origem);
CREATE INDEX IF NOT EXISTS idx_req_mat_fornecedor ON req_materiais(fornecedor_id);
CREATE INDEX IF NOT EXISTS idx_req_mat_contrato   ON req_materiais(contrato_id);

INSERT INTO configuracoes (chave, valor)
VALUES ('portal_pedido_compra', '{"ativo": false}'::jsonb)
ON CONFLICT (chave) DO NOTHING;


-- ================================================================
-- 7. Cadastro de Insumos
-- ================================================================

CREATE TABLE IF NOT EXISTS insumos (
  id        SERIAL PRIMARY KEY,
  codigo    TEXT NOT NULL,
  nome      TEXT NOT NULL,
  unidade   TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  criado_por TEXT,
  CONSTRAINT insumos_codigo_unico UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_insumos_codigo ON insumos (codigo);
CREATE INDEX IF NOT EXISTS idx_insumos_nome   ON insumos (LOWER(nome));

COMMENT ON TABLE  insumos            IS 'Cadastro de insumos/materiais com código, nome e unidade';
COMMENT ON COLUMN insumos.codigo     IS 'Código único do insumo (ex: INS-001)';
COMMENT ON COLUMN insumos.nome       IS 'Descrição/nome do insumo';
COMMENT ON COLUMN insumos.unidade    IS 'Unidade de medida (ex: UN, KG, M²)';
COMMENT ON COLUMN insumos.criado_por IS 'Login do usuário que criou o registro';


-- ================================================================
-- 8. UAU: código da empresa na tabela empresas          (21/05)
-- ================================================================

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS uau_empresa INTEGER;

COMMENT ON COLUMN empresas.uau_empresa IS
  'Código da empresa no ERP UAU — usado em pedidos de compra e integrações';


-- ================================================================
-- 9. UAU: CAP (Conta de Apropriação) no cadastro de insumos  (21/05)
-- ================================================================

ALTER TABLE insumos
  ADD COLUMN IF NOT EXISTS cap VARCHAR(50);

COMMENT ON COLUMN insumos.cap IS
  'Código de Conta de Apropriação — usado na integração UAU (GravarPedidoDeCompraDoTipoMaterial)';


-- ================================================================
-- 10. UAU: vínculos de planejamento (SI) por contrato        (21/05)
-- ================================================================

CREATE TABLE IF NOT EXISTS contrato_uau_vinculos (
  id               SERIAL PRIMARY KEY,
  contrato_id      INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  servico_pl       VARCHAR(100) NOT NULL,
  codigo_insumo_pl VARCHAR(100) NOT NULL,
  descricao        VARCHAR(255),
  criado_em        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cont_uau_vinculos_contrato
  ON contrato_uau_vinculos(contrato_id);

COMMENT ON TABLE contrato_uau_vinculos IS
  'Combinações (servicoPl, codigoInsumoPl) para integração UAU por contrato';


-- ================================================================
-- 11. UAU: número do pedido de compra em req_materiais        (21/05)
-- ================================================================

ALTER TABLE req_materiais
  ADD COLUMN IF NOT EXISTS uau_pedido_numero VARCHAR(50);

COMMENT ON COLUMN req_materiais.uau_pedido_numero IS
  'Número do pedido de compra gerado no ERP UAU após integração';


-- ================================================================
-- FIM
-- ================================================================
SELECT 'Migração 20-21/05/2026 aplicada com sucesso.' AS resultado;
