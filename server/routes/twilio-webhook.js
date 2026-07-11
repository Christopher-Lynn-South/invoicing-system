// Inbound SMS webhook — lets patients reply YES to a refill reminder to place
// their reorder, or SKIP to skip an upcoming autopay refill.
//
// Configure in Twilio Console: Messaging → A2P webhook →
//   POST {BASE_URL}/api/webhooks/twilio-sms
const express = require('express');
const twilio = require('twilio');
const { db } = require('../db');
const { patients, reminder_rules, products, refill_requests } = require('../db/schema');
const { eq, and, sql, desc, isNull } = require('drizzle-orm');
const { createSimpleOrder } = require('../services/order-helpers');
const { createInvoiceForOrder, hasActivePrescription } = require('../services/invoicing');
const { sendAdminAlert } = require('../services/mailer');

const router = express.Router();

function twiml(message) {
  const safe = String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

// Twilio posts application/x-www-form-urlencoded
router.post('/', express.urlencoded({ extended: false }), async (req, res) => {
  res.type('text/xml');

  try {
    // Verify the request actually came from Twilio (skip when no auth token, e.g. dev)
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken && process.env.NODE_ENV === 'production') {
      const signature = req.headers['x-twilio-signature'];
      const url = `${process.env.BASE_URL}/api/webhooks/twilio-sms`;
      const valid = twilio.validateRequest(authToken, signature || '', url, req.body || {});
      if (!valid) {
        console.warn('[SMS-in] Invalid Twilio signature — rejecting');
        return res.status(403).send(twiml('Unable to verify request.'));
      }
    }

    const from = req.body.From || '';
    const body = (req.body.Body || '').trim().toUpperCase();
    const last10 = from.replace(/\D/g, '').slice(-10);
    if (!last10) return res.send(twiml('Sorry, we could not identify your number.'));

    // Match patient by last-10 digits of phone
    const result = await db.execute(sql`
      SELECT * FROM patients
      WHERE phone IS NOT NULL
        AND deleted_at IS NULL
        AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 10) = ${last10}
      LIMIT 1
    `);
    const rows = result.rows || result;
    const patient = rows[0];
    if (!patient) {
      return res.send(twiml('We could not find an account for this number. Please contact us for help.'));
    }

    const isYes  = /^(YES|Y|SI|SÍ|CONFIRM|OK|REORDER)$/.test(body);
    const isSkip = /^(SKIP|NO|LATER|PAUSE)$/.test(body);

    if (!isYes && !isSkip) {
      return res.send(twiml(`Reply YES to confirm your refill, or SKIP to skip this cycle. For anything else, contact us and we'll help.`));
    }

    // Most recent active rule reminded in the last 14 days
    const cutoff = new Date(Date.now() - 14 * 86400000);
    const [rule] = await db.select().from(reminder_rules)
      .where(and(
        eq(reminder_rules.patient_id, patient.id),
        eq(reminder_rules.active, true),
      ))
      .orderBy(desc(reminder_rules.last_reminded_at))
      .limit(1);

    if (!rule || !rule.last_reminded_at || new Date(rule.last_reminded_at) < cutoff) {
      return res.send(twiml('We don\'t have a recent refill reminder for you. Contact us and we\'ll sort it out.'));
    }

    const [product] = await db.select().from(products).where(eq(products.id, rule.product_id));
    if (!product) return res.send(twiml('Something went wrong finding your product. Please contact us.'));

    if (isSkip) {
      // Push the next reminder out one week and clear any autopay notice
      const snooze = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      await db.update(reminder_rules)
        .set({ snooze_until: snooze, autopay_notice_sent_at: null })
        .where(eq(reminder_rules.id, rule.id));
      return res.send(twiml(`No problem — we've paused your ${product.name} refill for a week. Reply YES anytime to reorder.`));
    }

    // YES — don't double-order if they already confirmed this cycle
    const [recentPending] = await db.select().from(refill_requests)
      .where(and(
        eq(refill_requests.rule_id, rule.id),
        eq(refill_requests.status, 'confirmed'),
      ))
      .orderBy(desc(refill_requests.responded_at))
      .limit(1);
    if (recentPending?.responded_at &&
        new Date(recentPending.responded_at) > new Date(Date.now() - 7 * 86400000)) {
      return res.send(twiml(`Your ${product.name} refill is already in progress. Check your email for the invoice, or contact us with questions.`));
    }

    const order = await createSimpleOrder({
      patient_id: patient.id,
      product,
      notes: `Refill confirmed via SMS reply. Ship to patient's default address.\nPlease review and ship after payment.`,
    });

    await db.update(reminder_rules)
      .set({ last_order_id: order.id, last_reminded_at: new Date(), snooze_until: null })
      .where(eq(reminder_rules.id, rule.id));

    // Auto-invoice when the Rx gate passes
    let invoiced = false;
    try {
      const rxOk = !patient.requires_prescription || await hasActivePrescription(patient.id);
      if (rxOk) {
        await createInvoiceForOrder(order, { notify: true });
        invoiced = true;
      }
    } catch (e) { console.error('[SMS-in] auto-invoice failed:', e.message); }

    try {
      await sendAdminAlert(
        `SMS refill confirmed — ${patient.name}`,
        `<p><strong>${patient.name}</strong> replied YES to their ${product.name} reminder.</p>
         <p>Order ${order.order_number} created${invoiced ? ' and invoice sent' : ' — needs manual invoice'}.</p>
         <p><a href="${process.env.BASE_URL}/orders/${order.id}">Open order</a></p>`
      );
    } catch { /* non-fatal */ }

    return res.send(twiml(invoiced
      ? `You're all set! Your ${product.name} refill is confirmed — invoice sent to ${patient.email || 'your email'}. Order ${order.order_number}.`
      : `You're all set! Your ${product.name} refill is confirmed. We'll send your invoice shortly. Order ${order.order_number}.`
    ));
  } catch (err) {
    console.error('[SMS-in] Webhook error:', err);
    return res.send(twiml('Sorry, something went wrong. Please contact us and we\'ll help you directly.'));
  }
});

module.exports = router;
