/**
 * Construtivo AI — API Backend v3.0
 * Entry point: configura middleware, monta routers e inicia o servidor.
 */
require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const morgan      = require('morgan');
const redis       = require('redis');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Redis (conexão opcional — não bloqueia inicialização) ────────
const redisUrl = process.env.REDIS_PASS
  ? `redis://:${process.env.REDIS_PASS}@${process.env.REDIS_HOST || 'construtivo-redis'}:6379`
  : `redis://${process.env.REDIS_HOST || 'construtivo-redis'}:6379`;
const redisClient = redis.createClient({ url: redisUrl });
redisClient.connect().catch(err => console.warn('[Redis] Não conectado:', err.message));

// ── Middleware global ────────────────────────────────────────────
app.set('trust proxy', 1); // necessário atrás do Nginx
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Muitas tentativas. Aguarde.' } }));
app.use('/api/',     rateLimit({ windowMs: 60*1000,    max: 300 }));

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'construtivo-obras-api', version: '3.0.0', ts: new Date() });
});

// ── Rotas ────────────────────────────────────────────────────────
// IMPORTANTE: /contratos/interpretar e /fornecedores/interpretar devem ser
// montadas ANTES das rotas com parâmetro /:id para evitar conflito de rota.
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/empresas',    require('./routes/empresas'));
app.use('/api/obras',       require('./routes/obras'));
app.use('/api/fornecedores',require('./routes/fornecedores'));
app.use('/api/contratos',   require('./routes/contratos'));
app.use('/api/medicoes',    require('./routes/medicoes'));
app.use('/api/alcadas',     require('./routes/alcadas'));
app.use('/api/config',       require('./routes/config'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/cronogramas',  require('./routes/cronogramas'));
app.use('/api/usuarios',     require('./routes/usuarios'));
app.use('/api/audit',        require('./routes/audit'));
app.use('/api/lbm',          require('./routes/lbm'));
app.use('/api/portal',       require('./routes/portal'));
// WhatsApp desativado (depende de serviço pago — reativar quando necessário)
// app.use('/api/whatsapp',     require('./routes/whatsapp'));
app.use('/api/d4sign',       require('./routes/d4sign'));

// ── Tratamento global de erros ───────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERRO]', err);
  res.status(500).json({ error: err.message || 'Erro interno do servidor' });
});

// ── Proteção contra crash por promise rejections não tratadas ────
// Em Node 20 o padrão é encerrar o processo; aqui apenas logamos
// o erro e mantemos o servidor no ar.
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection] Promise rejeitada sem handler:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// ── Auto-migrations: garante colunas adicionadas sem precisar rodar SQL manual ──
async function runMigrations() {
  const db = require('./db');
  const migrations = [
    // v3.1 — tipo de medição (Normal / Adiantamento / Avanco_Fisico)
    `ALTER TABLE medicoes ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'Normal'
     CHECK (tipo IN ('Normal','Adiantamento','Avanco_Fisico'))`,
    `CREATE INDEX IF NOT EXISTS idx_medicoes_tipo ON medicoes(tipo)`,
    // v3.2 — custo planejado importado do MS Project (campo Cost do XML)
    `ALTER TABLE atividades_cronograma ADD COLUMN IF NOT EXISTS custo_planejado NUMERIC(15,2)`,
    // v3.3 — tabela de auditoria
    `CREATE TABLE IF NOT EXISTS audit_logs (
       id            BIGSERIAL PRIMARY KEY,
       usuario_id    INTEGER,
       usuario_login VARCHAR(100) NOT NULL DEFAULT '',
       usuario_nome  VARCHAR(200) NOT NULL DEFAULT '',
       acao          VARCHAR(80)  NOT NULL,
       entidade      VARCHAR(60)  NOT NULL,
       entidade_id   INTEGER,
       descricao     TEXT,
       detalhes      JSONB,
       ip            VARCHAR(50),
       criado_em     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_criado_em  ON audit_logs(criado_em DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_entidade   ON audit_logs(entidade)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_usuario_id ON audit_logs(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_acao       ON audit_logs(acao)`,
    // v3.4 — colunas de storage nas evidências (provider, url_storage, enviado_por)
    `ALTER TABLE evidencias ADD COLUMN IF NOT EXISTS provider      VARCHAR(20)   DEFAULT 'local'`,
    `ALTER TABLE evidencias ADD COLUMN IF NOT EXISTS url_storage   VARCHAR(1000)`,
    `ALTER TABLE evidencias ADD COLUMN IF NOT EXISTS enviado_por   VARCHAR(100)`,
    // v3.5 — limpa url_storage de evidências S3 salvas com URL pública inválida
    // (bucket privado gravou URL direta em vez de null → agora signed URL é gerada on-demand)
    `UPDATE evidencias SET url_storage = NULL
     WHERE provider = 's3'
       AND url_storage LIKE '%amazonaws.com%'
       AND url_storage NOT LIKE '%X-Amz-Signature%'`,
    // v3.6 — CPF e data de nascimento do representante legal do fornecedor
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cpf_representante      VARCHAR(20)`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS data_nasc_representante DATE`,
    // v3.7 — LBM (Location Based Management)
    // Metodologia por obra: 'gantt' (padrão) ou 'lbm'
    `ALTER TABLE obras ADD COLUMN IF NOT EXISTS metodologia VARCHAR(10) DEFAULT 'gantt'`,
    // Locais físicos da obra (hierárquicos: bloco → pavimento → unidade)
    `CREATE TABLE IF NOT EXISTS lbm_locais (
       id         SERIAL PRIMARY KEY,
       obra_id    INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
       parent_id  INTEGER REFERENCES lbm_locais(id) ON DELETE CASCADE,
       nome       VARCHAR(200) NOT NULL,
       tipo       VARCHAR(50)  DEFAULT 'local',
       ordem      INTEGER      NOT NULL DEFAULT 0,
       criado_em  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lbm_locais_obra ON lbm_locais(obra_id)`,
    // Serviços LBM: cada serviço tem um fornecedor/contrato e um ritmo de avanço
    `CREATE TABLE IF NOT EXISTS lbm_servicos (
       id               SERIAL PRIMARY KEY,
       obra_id          INTEGER NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
       nome             VARCHAR(200) NOT NULL,
       unidade          VARCHAR(30)  DEFAULT 'un',
       cor              VARCHAR(7)   DEFAULT '#3B82F6',
       fornecedor_id    INTEGER REFERENCES fornecedores(id),
       contrato_id      INTEGER REFERENCES contratos(id),
       ritmo_previsto   NUMERIC(8,2),
       ritmo_unidade    VARCHAR(50)  DEFAULT 'local/dia',
       duracao_por_local INTEGER     DEFAULT 1,
       ordem            INTEGER      NOT NULL DEFAULT 0,
       criado_em        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lbm_servicos_obra ON lbm_servicos(obra_id)`,
    // Progresso real por combinação Local × Serviço
    `CREATE TABLE IF NOT EXISTS lbm_progresso (
       id                SERIAL PRIMARY KEY,
       servico_id        INTEGER NOT NULL REFERENCES lbm_servicos(id)  ON DELETE CASCADE,
       local_id          INTEGER NOT NULL REFERENCES lbm_locais(id)    ON DELETE CASCADE,
       status            VARCHAR(20) NOT NULL DEFAULT 'nao_iniciado',
       data_inicio_plan  DATE,
       data_fim_plan     DATE,
       data_inicio_real  DATE,
       data_fim_real     DATE,
       medicao_id        INTEGER REFERENCES medicoes(id),
       observacao        TEXT,
       atualizado_em     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
       UNIQUE(servico_id, local_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lbm_progresso_servico ON lbm_progresso(servico_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lbm_progresso_local   ON lbm_progresso(local_id)`,
    // v3.7.1 — garante UNIQUE constraint em lbm_progresso para bancos já existentes
    `ALTER TABLE lbm_progresso ADD CONSTRAINT IF NOT EXISTS lbm_progresso_servico_local_uq UNIQUE(servico_id, local_id)`,
    // v3.7.2 — múltiplos contratos por serviço LBM
    `CREATE TABLE IF NOT EXISTS lbm_servico_contratos (
       id          SERIAL PRIMARY KEY,
       servico_id  INTEGER NOT NULL REFERENCES lbm_servicos(id) ON DELETE CASCADE,
       contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
       UNIQUE(servico_id, contrato_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_lbm_sc_servico  ON lbm_servico_contratos(servico_id)`,
    `CREATE INDEX IF NOT EXISTS idx_lbm_sc_contrato ON lbm_servico_contratos(contrato_id)`,
    // Migra contrato_id existente em lbm_servicos → lbm_servico_contratos
    `INSERT INTO lbm_servico_contratos(servico_id, contrato_id)
     SELECT id, contrato_id FROM lbm_servicos WHERE contrato_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    // v3.8 — integração ERP
    `ALTER TABLE medicoes ADD COLUMN IF NOT EXISTS integrada_erp      BOOLEAN   NOT NULL DEFAULT FALSE`,
    `ALTER TABLE medicoes ADD COLUMN IF NOT EXISTS integrada_erp_em   TIMESTAMP WITH TIME ZONE`,
    `ALTER TABLE medicoes ADD COLUMN IF NOT EXISTS integrada_erp_user VARCHAR(150)`,
    `ALTER TABLE medicoes ADD COLUMN IF NOT EXISTS integrada_erp_resp JSONB`,
    `CREATE INDEX IF NOT EXISTS idx_medicoes_integrada_erp ON medicoes(integrada_erp)`,
    // v3.9 — Portal do Fornecedor: tokens mágicos de acesso por e-mail
    `CREATE TABLE IF NOT EXISTS portal_tokens (
       id           SERIAL PRIMARY KEY,
       token        VARCHAR(128) NOT NULL UNIQUE,
       fornecedor_id INTEGER NOT NULL REFERENCES fornecedores(id) ON DELETE CASCADE,
       email        VARCHAR(200) NOT NULL,
       expira_em    TIMESTAMP WITH TIME ZONE NOT NULL,
       usado_em     TIMESTAMP WITH TIME ZONE,
       ip_usado     VARCHAR(50),
       criado_em    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_portal_tokens_token       ON portal_tokens(token)`,
    `CREATE INDEX IF NOT EXISTS idx_portal_tokens_fornecedor  ON portal_tokens(fornecedor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_portal_tokens_expira      ON portal_tokens(expira_em)`,
    // v3.9.1 — NFs enviadas pelo fornecedor pelo portal
    `CREATE TABLE IF NOT EXISTS portal_nfs (
       id            SERIAL PRIMARY KEY,
       medicao_id    INTEGER NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
       fornecedor_id INTEGER NOT NULL REFERENCES fornecedores(id),
       nome_arquivo  VARCHAR(500) NOT NULL,
       caminho       VARCHAR(1000),
       provider      VARCHAR(20) DEFAULT 'local',
       url_storage   VARCHAR(1000),
       numero_nf     VARCHAR(50),
       valor_nf      NUMERIC(15,2),
       chave_nfe     VARCHAR(60),
       obs           TEXT,
       enviado_em    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_portal_nfs_medicao ON portal_nfs(medicao_id)`,
    // v3.9.2 — WhatsApp: tokens de aprovação por link rápido
    `CREATE TABLE IF NOT EXISTS whatsapp_tokens (
       id          SERIAL PRIMARY KEY,
       token       VARCHAR(128) NOT NULL UNIQUE,
       medicao_id  INTEGER NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
       nivel       VARCHAR(5)   NOT NULL,
       usuario_id  INTEGER REFERENCES usuarios(id),
       telefone    VARCHAR(30),
       acao        VARCHAR(20),
       comentario  TEXT,
       expira_em   TIMESTAMP WITH TIME ZONE NOT NULL,
       usado_em    TIMESTAMP WITH TIME ZONE,
       criado_em   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_wa_tokens_token    ON whatsapp_tokens(token)`,
    `CREATE INDEX IF NOT EXISTS idx_wa_tokens_medicao  ON whatsapp_tokens(medicao_id)`,
    // v3.9.3 — telefone nos usuários internos (para WhatsApp)
    `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone VARCHAR(30)`,
    // v3.13 — obras permitidas por usuário (array de obra_id; vazio = acesso total)
    `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS obras_permitidas integer[] NOT NULL DEFAULT '{}'`,
    `CREATE INDEX IF NOT EXISTS idx_usuarios_obras_permitidas ON usuarios USING GIN(obras_permitidas)`,
    // v3.9.4 — UUID do documento D4Sign para rastreamento via webhook
    `ALTER TABLE medicoes ADD COLUMN IF NOT EXISTS d4sign_doc_uuid VARCHAR(100)`,
    `CREATE INDEX IF NOT EXISTS idx_medicoes_d4sign_doc ON medicoes(d4sign_doc_uuid)`,
    // v3.10 — Portal NFs: controle financeiro / fila backoffice
    `ALTER TABLE portal_nfs ADD COLUMN IF NOT EXISTS dados_nfse    JSONB`,
    `ALTER TABLE portal_nfs ADD COLUMN IF NOT EXISTS status_fin    VARCHAR(30) NOT NULL DEFAULT 'Pendente'`,
    `ALTER TABLE portal_nfs ADD COLUMN IF NOT EXISTS processado_em  TIMESTAMP WITH TIME ZONE`,
    `ALTER TABLE portal_nfs ADD COLUMN IF NOT EXISTS processado_por VARCHAR(150)`,
    `ALTER TABLE portal_nfs ADD COLUMN IF NOT EXISTS processado_obs TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_portal_nfs_status_fin ON portal_nfs(status_fin)`,
    // v3.11 — validações cruzadas salvas no upload da NF pelo fornecedor
    `ALTER TABLE portal_nfs ADD COLUMN IF NOT EXISTS validacoes JSONB`,
    // v3.12 — amplia CHECK constraint de medicoes.status para incluir 'Assinado' e 'Pago'
    `ALTER TABLE medicoes DROP CONSTRAINT IF EXISTS medicoes_status_check`,
    `ALTER TABLE medicoes ADD CONSTRAINT medicoes_status_check
       CHECK (status IN ('Rascunho','Aguardando N1','Aguardando N2','Aguardando N3',
                         'Aprovado','Em Assinatura','Assinado','Concluído','Reprovado','Pago'))`,
  ];
  for (const sql of migrations) {
    try {
      await db.query(sql);
    } catch (e) {
      console.warn('[Migration] Aviso:', e.message);
    }
  }
  console.log('[Migration] Colunas verificadas/aplicadas com sucesso.');
}

// ── Inicialização ────────────────────────────────────────────────
runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`Construtivo AI API v3.0 rodando na porta ${PORT}`);
  });
}).catch(err => {
  console.error('[Migration] Erro crítico:', err);
  app.listen(PORT, () => {
    console.log(`Construtivo AI API v3.0 rodando na porta ${PORT} (sem migrations)`);
  });
});

module.exports = app;
