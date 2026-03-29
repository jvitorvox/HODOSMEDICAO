/**
 * HAMOA OBRAS — API Backend v3.0
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
const redisClient = redis.createClient({
  url: `redis://:${process.env.REDIS_PASS||'hamoa-redis@2025'}@${process.env.REDIS_HOST||'hamoa-redis'}:6379`,
});
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
  res.json({ status: 'ok', service: 'hamoa-obras-api', version: '3.0.0', ts: new Date() });
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
    console.log(`HAMOA OBRAS API v3.0 rodando na porta ${PORT}`);
  });
}).catch(err => {
  console.error('[Migration] Erro crítico:', err);
  app.listen(PORT, () => {
    console.log(`HAMOA OBRAS API v3.0 rodando na porta ${PORT} (sem migrations)`);
  });
});

module.exports = app;
