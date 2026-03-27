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

    req.session.customerId    = patient.id;
    req.session.customerEmail = patient.email;
    req.session.customerName  = patient.name;

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
  if (!req.session.customerId) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({
    authenticated: true,
    id: req.session.customerId,
    email: req.session.customerEmail,
    name: req.session.customerName,
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
    const [patient] = await db.select().from(patients).where(eq(patients.id, req.session.customerId)).limit(1);
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

// ─── POST /api/patient/forgot-password  (send reset/set-password link) ────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email is required.' });

  try {
    const [patient] = await db.select().from(patients).where(eq(patients.email, email.trim().toLowerCase())).limit(1);

    // Always return success — don't reveal whether email exists
    if (!patient) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    await db.update(patients)
      .set({ reset_token: token, reset_token_expires_at: expires })
      .where(eq(patients.id, patient.id));

    const link = `${process.env.BASE_URL}/customer/set-password?token=${token}`;
    const isNew = !patient.password_hash;

    // Email is non-fatal — token is saved regardless
    try {
      await sendMail({
        to: patient.email,
        subject: isNew ? 'Set your portal password' : 'Reset your portal password',
        html: `
          <p>Hello ${patient.name},</p>
          <p>${isNew
            ? 'Click the button below to set your password and activate your patient portal account.'
            : 'Click the button below to reset your portal password. This link expires in 2 hours.'
          }</p>
          <p style="margin:24px 0">
            <a href="${link}" style="background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
              ${isNew ? 'Set Password' : 'Reset Password'}
            </a>
          </p>
          <p style="font-size:12px;color:#6b7280">If you didn't request this, you can safely ignore this email.</p>
        `,
      });
    } catch (mailErr) {
      console.error('Forgot password email failed:', mailErr.message);
      console.error('Reset link (fallback):', link);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── POST /api/patient/reset-password  (set new password via token) ───────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'token and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters.' });

  try {
    const [patient] = await db.select().from(patients).where(eq(patients.reset_token, token)).limit(1);

    if (!patient || !patient.reset_token_expires_at || new Date() > new Date(patient.reset_token_expires_at)) {
      return res.status(400).json({ error: 'INVALID_TOKEN', message: 'This link is invalid or has expired. Please request a new one.' });
    }

    const hash = await bcrypt.hash(password, 12);
    await db.update(patients)
      .set({ password_hash: hash, portal_enabled: true, reset_token: null, reset_token_expires_at: null })
      .where(eq(patients.id, patient.id));

    return res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
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
    const portalUrl = `${process.env.BASE_URL}/customer/login`;
    await sendMail({
      to: patient.email,
      subject: 'Your OrderFlow Customer Portal Access',
      html: `
        <p>Hello ${patient.name},</p>
        <p>Your customer portal access has been set up. You can log in to view your orders, invoices, and make payments.</p>
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
