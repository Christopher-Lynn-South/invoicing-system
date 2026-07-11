/**
 * App settings service.
 * Settings are stored in the app_settings table and merged into process.env
 * at startup. They can be updated at runtime via updateSetting() which
 * writes to DB, updates process.env, and invalidates any cached service
 * instances that depend on that key.
 */
const { db } = require('../db');
const { app_settings } = require('../db/schema');
const { eq } = require('drizzle-orm');

// Keys managed via the GUI settings panel (never store DB_URL or SESSION_SECRET here)
const MANAGED_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_USER',
  'MAIL_PASS',
  'MAIL_FROM',
  'ADMIN_EMAIL',
  'FEDEX_CLIENT_ID',
  'FEDEX_CLIENT_SECRET',
  'FEDEX_ACCOUNT_NUMBER',
  'FEDEX_SANDBOX',
  'FEDEX_SHIPPER_NAME',
  'FEDEX_SHIPPER_STREET',
  'FEDEX_SHIPPER_STREET2',
  'FEDEX_SHIPPER_CITY',
  'FEDEX_SHIPPER_STATE',
  'FEDEX_SHIPPER_ZIP',
  'FEDEX_SHIPPER_COUNTRY',
  'FEDEX_SHIPPER_PHONE',
  'BASE_URL',
  'COMPANY_NAME',
  'COMPANY_EMAIL',
  'COMPANY_DBA',
  'COMPANY_PHONE',
  'COMPANY_FAX',
  'COMPANY_ADDRESS_1',
  'COMPANY_ADDRESS_2',
  'COMPANY_CITY',
  'COMPANY_STATE',
  'COMPANY_ZIP',
  'COMPANY_COUNTRY',
];

// Keys whose display values are masked in API responses
const SECRET_KEYS = new Set([
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'MAIL_PASS',
  'FEDEX_CLIENT_SECRET',
]);

// Registry of callbacks to call when a key changes (for service re-init)
const invalidationHandlers = {};

function onKeyChange(key, handler) {
  invalidationHandlers[key] = handler;
}

/** Load all managed settings from DB into process.env. Call once on startup. */
async function loadSettings() {
  try {
    const rows = await db.select().from(app_settings);
    for (const row of rows) {
      if (row.value !== null && row.value !== undefined) {
        process.env[row.key] = row.value;
      }
    }
    console.log(`Config: loaded ${rows.length} settings from DB`);
  } catch (err) {
    console.error('Config: failed to load settings from DB (using .env fallback):', err.message);
  }
}

/** Get a setting value (process.env already has DB values merged in). */
function getSetting(key) {
  return process.env[key];
}

/** Persist a setting to DB, update process.env, and run invalidation callbacks. */
async function updateSetting(key, value) {
  if (!MANAGED_KEYS.includes(key)) {
    throw new Error(`Key "${key}" is not a managed setting.`);
  }

  await db.insert(app_settings)
    .values({ key, value, updated_at: new Date() })
    .onConflictDoUpdate({
      target: app_settings.key,
      set: { value, updated_at: new Date() },
    });

  process.env[key] = value;

  if (invalidationHandlers[key]) {
    invalidationHandlers[key](value);
  }
}

/** Return current values of all managed keys, masking secrets. */
async function getAllSettings() {
  const result = {};
  for (const key of MANAGED_KEYS) {
    const val = process.env[key] || '';
    result[key] = SECRET_KEYS.has(key) && val ? '••••••••' : val;
  }
  return result;
}

/** Return raw (unmasked) values — only used server-side for service init. */
function getRawSettings() {
  const result = {};
  for (const key of MANAGED_KEYS) {
    result[key] = process.env[key] || '';
  }
  return result;
}

module.exports = { loadSettings, getSetting, updateSetting, getAllSettings, onKeyChange, MANAGED_KEYS, SECRET_KEYS };
