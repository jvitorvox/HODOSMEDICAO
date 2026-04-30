/**
 * CONSTRUTIVO OBRAS — Conexão com PostgreSQL
 * Pool compartilhado em toda a aplicação.
 */
const { Pool } = require('pg');

if (!process.env.DB_PASS) {
  throw new Error('FATAL: variável de ambiente DB_PASS não definida. O servidor não pode iniciar sem ela.');
}

const db = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'construtivo_obras',
  user:     process.env.DB_USER || 'construtivo',
  password: process.env.DB_PASS,
  max: 20,
  idleTimeoutMillis:        60000,   // fecha conexão ociosa após 60s (antes do firewall agir)
  connectionTimeoutMillis:  5000,    // timeout ao tentar nova conexão
  keepAlive:                true,    // envia TCP keepalive para evitar corte silencioso pelo NAT
  keepAliveInitialDelayMillis: 10000, // começa keepalive após 10s de ociosidade
});

db.on('error', (err) => console.error('[DB] Pool error:', err));

module.exports = db;
