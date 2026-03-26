const express = require('express');
const { db } = require('../db');
const { invoices, sales_orders, patients } = require('../db/schema');
const { eq } = require('drizzle-orm');
const stripeService = require('../services/stripe');
const { sendPaymentConfirmation, sendRefillPaymentAdminNotification } = require('../services/mailer');
const { refill_requests } = require('../db/schema');

const router = express.Router();

// POST /api/webhooks/stripe
// Must receive raw body — mounted BEFORE express.json() in index.js
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeService.stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    try {
      // Primary lookup by stored intent ID; fallback to invoice_number in metadata
      let [invoice] = await db.select().from(invoices)
        .where(eq(invoices.stripe_payment_intent_id, pi.id));

      if (!invoice && pi.metadata?.invoice_number) {
        console.log(`Webhook: intent ID not found, trying metadata invoice_number=${pi.metadata.invoice_number}`);
        [invoice] = await db.select().from(invoices)
          .where(eq(invoices.invoice_number, pi.metadata.invoice_number));
        // Back-fill the intent ID so future webhooks hit on the first lookup
        if (invoice) {
          await db.update(invoices)
            .set({ stripe_payment_intent_id: pi.id })
            .where(eq(invoices.id, invoice.id));
        }
      }

      if (!invoice) {
        console.warn(`Webhook payment_intent.succeeded: no invoice found for pi=${pi.id}`);
      }

      if (invoice && invoice.pay_status !== 'paid') {
        const [updated] = await db.update(invoices)
          .set({ pay_status: 'paid', paid_at: new Date() })
          .where(eq(invoices.id, invoice.id))
          .returning();

        const [order] = await db.select().from(sales_orders)
          .where(eq(sales_orders.id, invoice.order_id));
        const [customer] = await db.select().from(patients)
          .where(eq(patients.id, order.patient_id));

        await db.update(sales_orders)
          .set({ status: 'paid', updated_at: new Date() })
          .where(eq(sales_orders.id, invoice.order_id));

        const method = invoice.pay_method === 'ach' ? 'ach' : 'stripe_cc';
        try {
          await sendPaymentConfirmation(customer, order, updated, method);
        } catch (mailErr) {
          console.error('Payment confirmation email failed:', mailErr.message);
        }
        // If this order came from a refill request, notify admin to ship
        try {
          const [refillReq] = await db.select().from(refill_requests)
            .where(eq(refill_requests.order_id, order.id));
          if (refillReq) {
            await sendRefillPaymentAdminNotification(customer, order, updated);
          }
        } catch (refillErr) {
          console.error('Refill admin notification failed (non-fatal):', refillErr.message);
        }
      }
    } catch (dbErr) {
      console.error('Webhook DB error:', dbErr);
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    try {
      await db.update(invoices)
        .set({ pay_status: 'failed' })
        .where(eq(invoices.stripe_payment_intent_id, pi.id));
    } catch (dbErr) {
      console.error('Webhook DB error:', dbErr);
    }
  }

  res.json({ received: true });
});

module.exports = router;
