/**
 * CONSTRUTIVO OBRAS — Middleware de autenticação JWT
 */
const jwt = require('jsonwebtoken');

// Falha imediata no boot se a variável de ambiente não estiver definida
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: variável de ambiente JWT_SECRET não definida. O servidor não pode iniciar sem ela.');
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = auth;
