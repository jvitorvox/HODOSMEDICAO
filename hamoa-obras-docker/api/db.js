/**
 * HAMOA OBRAS — Conexão com PostgreSQL
 * Pool compartilhado em toda a aplicação.
 */
const { Pool } = require('pg');

const db = new Pool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'hamoa_obras',
  user:     process.env.DB_USER || 'hamoa',
  password: process.env.DB_PASS || 'hamoa@2025',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

db.on('error', (err) => console.error('[DB] Pool error:', err));

module.exports = db;
