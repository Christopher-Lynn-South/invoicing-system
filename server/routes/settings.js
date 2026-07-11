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

// ─── POST /api/settings/test-fedex — step-by-step FedEx diagnostics ──────────
// Runs each step independently so you can see exactly where it breaks.
router.post('/test-fedex', async (req, res) => {
  const fedex = require('../services/fedex');
  const steps = [];

  // ── Step 1: Check required env vars are set ──────────────────────────────────
  const missing = ['FEDEX_CLIENT_ID', 'FEDEX_CLIENT_SECRET', 'FEDEX_ACCOUNT_NUMBER']
    .filter(k => !process.env[k]);
  if (missing.length) {
    steps.push({ name: 'Config', ok: false, detail: `Missing required settings: ${missing.join(', ')}` });
    return res.json({ steps });
  }
  steps.push({ name: 'Config', ok: true, detail: `Account: ${process.env.FEDEX_ACCOUNT_NUMBER} · Sandbox: ${process.env.FEDEX_SANDBOX === 'true' ? 'yes' : 'no'}` });

  // ── Step 2: Check shipper address is configured ──────────────────────────────
  const shipperFields = { name: 'FEDEX_SHIPPER_NAME', city: 'FEDEX_SHIPPER_CITY', state: 'FEDEX_SHIPPER_STATE', zip: 'FEDEX_SHIPPER_ZIP', country: 'FEDEX_SHIPPER_COUNTRY' };
  const missingShipper = Object.entries(shipperFields).filter(([, k]) => !process.env[k]).map(([label]) => label);
  if (missingShipper.length) {
    steps.push({ name: 'Shipper Address', ok: false, detail: `Missing fields: ${missingShipper.join(', ')}. Set these in Settings → FedEx Ship From Address.` });
  } else {
    steps.push({
      name: 'Shipper Address',
      ok: true,
      detail: `${process.env.FEDEX_SHIPPER_NAME} · ${process.env.FEDEX_SHIPPER_STREET || '(no street)'}, ${process.env.FEDEX_SHIPPER_CITY}, ${process.env.FEDEX_SHIPPER_STATE} ${process.env.FEDEX_SHIPPER_ZIP}, ${process.env.FEDEX_SHIPPER_COUNTRY}`,
    });
  }

  // ── Step 3: OAuth token ──────────────────────────────────────────────────────
  let token;
  try {
    token = await fedex.getAccessToken();
    steps.push({ name: 'OAuth Token', ok: true, detail: 'Token obtained successfully.' });
  } catch (err) {
    const detail = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    steps.push({ name: 'OAuth Token', ok: false, detail, raw: err.response?.data });
    return res.json({ steps });
  }

  // ── Step 4: Rate quote to a known-good test destination ─────────────────────
  // Use a real US zip (10001 = Manhattan) to get at least one rate back.
  // If shipper address is incomplete, FedEx will still complain here.
  const testRecipient = {
    street: '350 Fifth Ave',
    city: 'New York',
    state: 'NY',
    zip: '10001',
    country: 'US',
  };
  try {
    const rates = await fedex.getRates({
      package_type: 'YOUR_PACKAGING',
      weight_lbs: 1,
      length_in: 10,
      width_in: 8,
      height_in: 4,
      recipient: testRecipient,
    });
    if (rates.length) {
      const cheapest = rates[0];
      steps.push({
        name: 'Rate Quote',
        ok: true,
        detail: `Got ${rates.length} rate(s). Cheapest: ${cheapest.serviceType} @ $${cheapest.netCharge} ${cheapest.currency}. All services: ${rates.map(r => r.serviceType).join(', ')}`,
      });
    } else {
      steps.push({ name: 'Rate Quote', ok: false, detail: 'FedEx returned 0 rates. Check shipper address and account permissions.' });
    }
  } catch (err) {
    const fedexErrors = err.response?.data?.errors || err.response?.data?.output?.alerts || [];
    const detail = fedexErrors.length
      ? fedexErrors.map(e => `[${e.code}] ${e.message}`).join(' | ')
      : err.response
        ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message;
    steps.push({ name: 'Rate Quote', ok: false, detail, raw: err.response?.data });
    return res.json({ steps });
  }

  return res.json({ steps });
});

module.exports = router;
