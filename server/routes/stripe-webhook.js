const express = require('express');
const { db } = require('../db');
const { invoices, sales_orders, patients } = require('../db/schema');
const { eq } = require('drizzle-orm');
const stripeService = require('../services/stripe');
const { sendPaymentConfirmation } = require('../services/mailer');

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
      const [invoice] = await db.select().from(invoices)
        .where(eq(invoices.stripe_payment_intent_id, pi.id));

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
