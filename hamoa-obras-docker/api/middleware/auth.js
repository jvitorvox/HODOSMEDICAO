/**
 * CONSTRUTIVO OBRAS — Middleware de autenticação JWT
 */
const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = auth;
