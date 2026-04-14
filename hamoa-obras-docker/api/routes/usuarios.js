/**
 * CONSTRUTIVO OBRAS — Rota: /api/usuarios
 * CRUD de usuários do sistema (cadastro local + associação de grupos AD).
 */
'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const router  = express.Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const audit   = require('../middleware/audit');

const PERFIS_VALIDOS = ['N1', 'N2', 'N3', 'ADM'];

// Middleware: restringe a usuários com perfil ADM
function authADM(req, res, next) {
  if (req.user?.perfil !== 'ADM')
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  next();
}

// ── GET /api/usuarios — lista todos os usuários ──────────────────
router.get('/', auth, authADM, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, login, nome, email, grupos_ad, perfil, ativo,
              ultimo_acesso, criado_em,
              (senha_hash IS NOT NULL) AS tem_senha_local
         FROM usuarios
        ORDER BY ativo DESC, nome`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/usuarios/:id — busca um usuário ─────────────────────
router.get('/:id', auth, authADM, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, login, nome, email, grupos_ad, perfil, ativo,
              ultimo_acesso, criado_em,
              (senha_hash IS NOT NULL) AS tem_senha_local
         FROM usuarios WHERE id=$1`, [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/usuarios — cria usuário ────────────────────────────
router.post('/', auth, authADM, async (req, res) => {
  try {
    const { login, nome, email, senha, perfil, grupos_ad = [], ativo = true } = req.body;
    if (!login?.trim()) return res.status(400).json({ error: 'Login é obrigatório' });
    if (perfil && !PERFIS_VALIDOS.includes(perfil))
      return res.status(400).json({ error: `Perfil inválido. Use: ${PERFIS_VALIDOS.join(', ')}` });

    const senhaHash = senha ? await bcrypt.hash(senha, 12) : null;
    const gruposArr = Array.isArray(grupos_ad) ? grupos_ad.filter(Boolean) : [];

    const r = await db.query(
      `INSERT INTO usuarios (login, nome, email, senha_hash, perfil, grupos_ad, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [login.trim(), nome?.trim() || null, email?.trim() || null,
       senhaHash, perfil || 'N1', gruposArr, ativo]
    );
    await audit(req, 'criar', 'usuario', r.rows[0].id,
      `Usuário "${login.trim()}" criado — perfil: ${perfil || 'N1'}`,
      { grupos_ad: gruposArr });
    res.status(201).json({ id: r.rows[0].id, ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Login já cadastrado' });
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/usuarios/:id — atualiza usuário ─────────────────────
router.put('/:id', auth, authADM, async (req, res) => {
  try {
    const { nome, email, perfil, grupos_ad, ativo } = req.body;
    if (perfil && !PERFIS_VALIDOS.includes(perfil))
      return res.status(400).json({ error: `Perfil inválido. Use: ${PERFIS_VALIDOS.join(', ')}` });

    const gruposArr = Array.isArray(grupos_ad) ? grupos_ad.filter(Boolean) : undefined;

    const sets = [];
    const vals = [];
    const push = (col, val) => { sets.push(`${col}=$${sets.length + 1}`); vals.push(val); };

    if (nome      !== undefined) push('nome',      nome?.trim() || null);
    if (email     !== undefined) push('email',     email?.trim() || null);
    if (perfil    !== undefined) push('perfil',    perfil);
    if (gruposArr !== undefined) push('grupos_ad', gruposArr);
    if (ativo     !== undefined) push('ativo',     ativo);

    if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    vals.push(req.params.id);
    const prev = await db.query('SELECT login, nome FROM usuarios WHERE id=$1', [req.params.id]);
    await db.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
    const u = prev.rows[0];
    const statusStr = ativo === false ? ' — DESATIVADO' : ativo === true ? ' — REATIVADO' : '';
    await audit(req, 'editar', 'usuario', parseInt(req.params.id),
      `Usuário "${u?.login || req.params.id}" atualizado${statusStr}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/usuarios/:id/senha — redefine senha ─────────────────
router.put('/:id/senha', auth, authADM, async (req, res) => {
  try {
    const { senha } = req.body;
    if (!senha || senha.length < 6)
      return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
    const hash = await bcrypt.hash(senha, 12);
    const prev = await db.query('SELECT login FROM usuarios WHERE id=$1', [req.params.id]);
    await db.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2', [hash, req.params.id]);
    await audit(req, 'reset_senha', 'usuario', parseInt(req.params.id),
      `Senha do usuário "${prev.rows[0]?.login || req.params.id}" redefinida pelo administrador`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/usuarios/:id — desativa usuário (soft delete) ────
router.delete('/:id', auth, authADM, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id)
      return res.status(400).json({ error: 'Você não pode desativar seu próprio usuário' });
    const prev = await db.query('SELECT login FROM usuarios WHERE id=$1', [req.params.id]);
    await db.query('UPDATE usuarios SET ativo=false WHERE id=$1', [req.params.id]);
    await audit(req, 'excluir', 'usuario', parseInt(req.params.id),
      `Usuário "${prev.rows[0]?.login || req.params.id}" desativado`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
