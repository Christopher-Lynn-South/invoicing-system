/**
 * Stripe PII Minimization Policy — Unit Test (Section 18.5)
 * Asserts that buildStripePatientPayload() does NOT include prohibited keys.
 */
const assert = require('node:assert');
const { describe, it } = require('node:test');

// We require the service directly — do not start the server
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
const { buildStripePatientPayload } = require('../services/stripe');

const PROHIBITED_KEYS = [
  'email',
  'date_of_birth',
  'patient_id',
  'prescription_id',
  'npi',
  'notes',
  'contacts',
];

function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const k of Object.keys(obj || {})) {
    keys.push(prefix ? `${prefix}.${k}` : k);
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      keys.push(...collectKeys(obj[k], prefix ? `${prefix}.${k}` : k));
    }
  }
  return keys;
}

describe('buildStripePatientPayload PII policy', () => {
  const samplePatient = {
    id: 'some-uuid',
    name: 'John Doe',
    email: 'john@example.com',
    date_of_birth: '1990-01-01',
    phone: '555-0100',
    billing_address: { street: '123 Main St', city: 'Tijuana', state: 'BC', zip: '22710', country: 'MX' },
    usdc_wallet: '0xabc',
    stripe_customer_id: 'cus_123',
    requires_prescription: false,
    active_prescription_id: null,
    npi: '1234567890',
    notes: 'Some private notes',
    contacts: [{ name: 'Jane', relation: 'parent' }],
  };

  it('should not include any prohibited PII keys in the Stripe payload', () => {
    const payload = buildStripePatientPayload(samplePatient);
    const allKeys = collectKeys(payload);

    for (const prohibited of PROHIBITED_KEYS) {
      // Check top-level and nested (but not partial matches like 'postal_code' for 'code')
      const found = allKeys.some(k => k === prohibited || k.endsWith(`.${prohibited}`));
      assert.strictEqual(
        found,
        false,
        `Prohibited key "${prohibited}" found in Stripe payload. Keys present: ${allKeys.join(', ')}`
      );
    }
  });

  it('should include permitted fields only: name, address, phone', () => {
    const payload = buildStripePatientPayload(samplePatient);
    const PERMITTED = ['name', 'phone', 'address'];
    const topKeys = Object.keys(payload);
    for (const key of topKeys) {
      assert.ok(
        PERMITTED.includes(key),
        `Unexpected top-level key "${key}" in Stripe payload`
      );
    }
  });

  it('should include correct address sub-fields', () => {
    const payload = buildStripePatientPayload(samplePatient);
    assert.ok(payload.address, 'address must exist');
    const PERMITTED_ADDR = ['line1', 'city', 'state', 'postal_code', 'country'];
    for (const key of Object.keys(payload.address || {})) {
      assert.ok(
        PERMITTED_ADDR.includes(key),
        `Unexpected address sub-key "${key}"`
      );
    }
  });

  it('should omit phone when blank', () => {
    const p = { ...samplePatient, phone: '' };
    const payload = buildStripePatientPayload(p);
    assert.strictEqual(payload.phone, undefined, 'phone should be undefined when blank');
  });
});
