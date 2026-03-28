require('dotenv').config();
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { pool } = require('./db');

// ─── Auth rate limiters ───────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again in 15 minutes.' },
});

const PgSession = connectPgSimple(session);

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Warn if critical secrets are missing in production ──────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('WARNING: SESSION_SECRET is not set — using insecure default. Set it in production!');
}

// Trust Nginx reverse proxy so secure cookies work behind HTTPS
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ─── Stripe webhook needs raw body BEFORE json parser ────────────────────────
app.use('/api/webhooks/stripe', require('./routes/stripe-webhook'));

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.BASE_URL
    : ['http://localhost:5173', 'http://localhost:3001'],
  credentials: true,
}));

// ─── Session (PostgreSQL-backed so sessions survive restarts) ─────────────────
app.use(session({
  store: new PgSession({ pool, tableName: 'sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
  },
}));

// ─── Static files ─────────────────────────────────────────────────────────────
// Serve uploaded invoices and labels
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Required env var check ───────────────────────────────────────────────────
['BASE_URL', 'COMPANY_NAME', 'COMPANY_EMAIL'].forEach(key => {
  if (!process.env[key]) {
    console.warn(`⚠  WARNING: ${key} is not set. Emails, SMS, and PDFs will have incomplete links/branding.`);
  }
});

// ─── Load DB settings into process.env before routes start ───────────────────
const { loadSettings } = require('./services/config');
loadSettings(); // non-blocking; falls back to .env values on DB error

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth/login', authLimiter);
app.use('/api/customer/login', authLimiter);
app.use('/api/customer/forgot-password', authLimiter);
app.use('/api/customer/reset-password', authLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/customer', require('./routes/patient-auth'));
app.use('/api/customer', require('./routes/patient-portal'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api', require('./routes/invoices'));          // mounts /api/orders/:id/invoice and /api/invoices/:id
app.use('/api/pay', require('./routes/payments'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/reorder', require('./routes/reminders'));
app.use('/api/import', require('./routes/import'));
app.use('/refill', require('./routes/refill'));

// ─── Health checks ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health/email', async (req, res) => {
  const { transporter } = require('./services/mailer');
  try {
    await transporter.verify();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ─── Serve React SPA ─────────────────────────────────────────────────────────
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
}

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred'
    : err.message;
  res.status(500).json({ error: 'SERVER_ERROR', message });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`OrderFlow server running on port ${PORT}`);
});

// ─── Cron jobs ────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  require('./jobs/reminders.cron').start();
  require('./jobs/tracking.cron').start();
}

module.exports = app;
