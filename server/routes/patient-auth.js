const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { db } = require('../db');
const { patients } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { requirePatientLogin } = require('../middleware/auth');
const { requireLogin } = require('../middleware/auth');
const { sendMail } = require('../services/mailer');

const router = express.Router();

// ─── POST /api/patient/login ──────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'email and password are required.' });
  }

  try {
    const [patient] = await db
      .select()
      .from(patients)
      .where(eq(patients.email, email))
      .limit(1);

    if (!patient || !patient.portal_enabled || !patient.password_hash) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password, or portal access not enabled.' });
    }

    const valid = await bcrypt.compare(password, patient.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }

    req.session.patientId    = patient.id;
    req.session.patientEmail = patient.email;
    req.session.patientName  = patient.name;

    return res.json({ ok: true, name: patient.name, email: patient.email });
  } catch (err) {
    console.error('Patient login error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── POST /api/patient/logout ─────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ─── GET /api/patient/me ──────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.patientId) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    id: req.session.patientId,
    email: req.session.patientEmail,
    name: req.session.patientName,
  });
});

// ─── POST /api/patient/change-password  (patient changes own password) ────────
router.post('/change-password', requirePatientLogin, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'current_password and new_password required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters.' });
  }

  try {
    const [patient] = await db.select().from(patients).where(eq(patients.id, req.session.patientId)).limit(1);
    const valid = await bcrypt.compare(current_password, patient.password_hash);
    if (!valid) return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Current password incorrect.' });

    const hash = await bcrypt.hash(new_password, 12);
    await db.update(patients).set({ password_hash: hash }).where(eq(patients.id, patient.id));
    return res.json({ ok: true });
  } catch (err) {
    console.error('Patient change password error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── POST /api/patient/grant-access/:patientId  (admin grants portal access) ──
// Generates a temporary password, enables the portal, and emails the patient.
router.post('/grant-access/:patientId', requireLogin, async (req, res) => {
  try {
    const [patient] = await db.select().from(patients).where(eq(patients.id, req.params.patientId)).limit(1);
    if (!patient) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!patient.email) return res.status(422).json({ error: 'NO_EMAIL', message: 'Patient has no email address on file.' });

    // Generate a secure temporary password
    const tempPassword = crypto.randomBytes(6).toString('hex'); // 12-char hex
    const hash = await bcrypt.hash(tempPassword, 12);

    await db.update(patients)
      .set({ password_hash: hash, portal_enabled: true })
      .where(eq(patients.id, patient.id));

    // Send welcome email with credentials
    const portalUrl = `${process.env.BASE_URL}/patient/login`;
    await sendMail({
      to: patient.email,
      subject: 'Your OrderFlow Patient Portal Access',
      html: `
        <p>Hello ${patient.name},</p>
        <p>Your patient portal access has been set up. You can log in to view your orders, invoices, and make payments.</p>
        <p><strong>Portal:</strong> <a href="${portalUrl}">${portalUrl}</a><br>
        <strong>Email:</strong> ${patient.email}<br>
        <strong>Temporary password:</strong> <code>${tempPassword}</code></p>
        <p>Please log in and change your password immediately.</p>
        <p>— Corp 001 Inc.</p>
      `,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Grant access error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── POST /api/patient/revoke-access/:patientId  (admin revokes portal access) ─
router.post('/revoke-access/:patientId', requireLogin, async (req, res) => {
  try {
    const result = await db.update(patients)
      .set({ portal_enabled: false })
      .where(eq(patients.id, req.params.patientId))
      .returning({ id: patients.id });
    if (!result.length) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Revoke access error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
