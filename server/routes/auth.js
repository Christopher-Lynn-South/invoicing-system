const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../db');
const { admin_users } = require('../db/schema');
const { eq, ne } = require('drizzle-orm');
const { validate, loginSchema } = require('../middleware/validate');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.validated;

    const [user] = await db
      .select()
      .from(admin_users)
      .where(eq(admin_users.email, email))
      .limit(1);

    if (!user) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }

    req.session.adminId    = user.id;
    req.session.adminEmail = user.email;
    req.session.adminName  = user.name;
    req.session.adminRole  = user.role;

    return res.json({ ok: true, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.adminId) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    id: req.session.adminId,
    email: req.session.adminEmail,
    name: req.session.adminName,
    role: req.session.adminRole,
  });
});

// ─── POST /api/auth/change-password  (any logged-in staff) ───────────────────
router.post('/change-password', requireLogin, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'current_password and new_password required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters.' });
  }

  try {
    const [user] = await db.select().from(admin_users).where(eq(admin_users.id, req.session.adminId)).limit(1);
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Current password incorrect.' });

    const hash = await bcrypt.hash(new_password, 12);
    await db.update(admin_users).set({ password_hash: hash }).where(eq(admin_users.id, user.id));
    return res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Staff management — admin only ───────────────────────────────────────────

// GET /api/auth/users
router.get('/users', requireRole('admin'), async (req, res) => {
  try {
    const users = await db
      .select({ id: admin_users.id, email: admin_users.email, name: admin_users.name, role: admin_users.role, created_at: admin_users.created_at })
      .from(admin_users)
      .orderBy(admin_users.created_at);
    return res.json(users);
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/auth/users
router.post('/users', requireRole('admin'), async (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'email, name, and password are required.' });
  }
  if (!['admin', 'worker'].includes(role)) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'role must be admin or worker.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters.' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const [created] = await db
      .insert(admin_users)
      .values({ email, name, password_hash: hash, role })
      .returning({ id: admin_users.id, email: admin_users.email, name: admin_users.name, role: admin_users.role });
    return res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'CONFLICT', message: 'Email already in use.' });
    }
    console.error('Create user error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// DELETE /api/auth/users/:id
router.delete('/users/:id', requireRole('admin'), async (req, res) => {
  if (req.params.id === req.session.adminId) {
    return res.status(400).json({ error: 'INVALID', message: 'Cannot delete your own account.' });
  }
  try {
    const result = await db.delete(admin_users).where(eq(admin_users.id, req.params.id)).returning({ id: admin_users.id });
    if (!result.length) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PATCH /api/auth/users/:id/reset-password  (admin resets another user's password)
router.patch('/users/:id/reset-password', requireRole('admin'), async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'new_password must be at least 8 characters.' });
  }
  try {
    const hash = await bcrypt.hash(new_password, 12);
    const result = await db.update(admin_users).set({ password_hash: hash }).where(eq(admin_users.id, req.params.id)).returning({ id: admin_users.id });
    if (!result.length) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
