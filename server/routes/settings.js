const express = require('express');
const { requireLogin } = require('../middleware/auth');
const { getAllSettings, updateSetting, MANAGED_KEYS, SECRET_KEYS } = require('../services/config');
const { invalidateTransporter } = require('../services/mailer');

const router = express.Router();

// All settings routes require staff login
router.use(requireLogin);

// ─── GET /api/settings/config — returns current values (secrets masked) ───────
router.get('/config', async (req, res) => {
  try {
    const settings = await getAllSettings();
    return res.json(settings);
  } catch (err) {
    console.error('Get settings error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── PATCH /api/settings/config — update one or more settings ─────────────────
router.patch('/config', async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Body must be a key/value object.' });
  }

  const unknown = Object.keys(updates).filter(k => !MANAGED_KEYS.includes(k));
  if (unknown.length) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: `Unknown settings keys: ${unknown.join(', ')}` });
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      // Skip masked placeholder values — means the user didn't change the secret
      if (SECRET_KEYS.has(key) && value === '••••••••') continue;
      if (value !== undefined && value !== null) {
        await updateSetting(key, String(value));
      }
    }
    const settings = await getAllSettings();
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── POST /api/settings/test-email — send a test email with current config ────
router.post('/test-email', async (req, res) => {
  const { sendMail } = require('../services/mailer');
  const to = req.body.to || process.env.ADMIN_EMAIL;
  if (!to) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Provide a "to" email address.' });
  try {
    await sendMail({ to, subject: 'OrderFlow — SMTP test', html: '<p>SMTP is configured correctly.</p>' });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err.message });
  }
});

module.exports = router;
