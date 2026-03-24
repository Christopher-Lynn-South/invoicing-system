require('dotenv').config();
const Stripe = require('stripe');
const { db } = require('../db');
const { patients } = require('../db/schema');
const { eq } = require('drizzle-orm');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

/**
 * Build the MINIMUM Stripe customer payload.
 * ONLY name, billing address, zip, and phone.
 * Do NOT add email, DOB, prescription data, or patient UUID.
 * Policy: Section 18 of OrderFlow spec.
 */
function buildStripePatientPayload(patient) {
  const addr = patient.billing_address || {};
  const payload = {
    name: patient.name,
    address: {
      line1: addr.street || undefined,
      city: addr.city || undefined,
      state: addr.state || undefined,
      postal_code: addr.zip || undefined,
      country: addr.country || 'US',
    },
  };
  if (patient.phone) payload.phone = patient.phone;
  return payload;
}

async function getOrCreateStripeCustomer(patient) {
  if (patient.stripe_customer_id) {
    return stripe.customers.update(
      patient.stripe_customer_id,
      buildStripePatientPayload(patient)
    );
  }
  const sc = await stripe.customers.create(buildStripePatientPayload(patient));
  await db.update(patients)
    .set({ stripe_customer_id: sc.id })
    .where(eq(patients.id, patient.id));
  return sc;
}

module.exports = { stripe, buildStripePatientPayload, getOrCreateStripeCustomer };
