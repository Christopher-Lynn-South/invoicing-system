const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../db');
const { admin_users } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { validate, loginSchema } = require('../middleware/validate');

const router = express.Router();

// POST /api/auth/login
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

    req.session.adminId = user.id;
    req.session.adminEmail = user.email;
    req.session.adminName = user.name;

    return res.json({ ok: true, name: user.name, email: user.email });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session.adminId) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    id: req.session.adminId,
    email: req.session.adminEmail,
    name: req.session.adminName,
  });
});

module.exports = router;
