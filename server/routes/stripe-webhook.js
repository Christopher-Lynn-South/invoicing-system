const express = require('express');
const { db } = require('../db');
const { invoices, sales_orders, patients, invoice_payments } = require('../db/schema');
const { eq } = require('drizzle-orm');
const stripeService = require('../services/stripe');
const { sendPaymentConfirmation, sendRefillPaymentAdminNotification } = require('../services/mailer');
const { refill_requests } = require('../db/schema');

const router = express.Router();

// Save the charged card as the patient's default for one-click + autopay
async function rememberDefaultCard(pi, orderPatientId) {
  try {
    if (!pi.payment_method || !orderPatientId) return;
    const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method.id;
    if (!pmId?.startsWith('pm_')) return;
    await db.update(patients)
      .set({ stripe_default_pm: pmId })
      .where(eq(patients.id, orderPatientId));
  } catch (e) {
    console.error('Webhook rememberDefaultCard failed:', e.message);
  }
}

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
      // ── Installment payment path ─────────────────────────────────────────────
      if (pi.metadata?.invoice_payment_id) {
        const [payRow] = await db.select().from(invoice_payments)
          .where(eq(invoice_payments.id, pi.metadata.invoice_payment_id));
        if (payRow && payRow.status !== 'paid') {
          let coveringInvoice, coveringOrder;
          await db.transaction(async (tx) => {
            await tx.update(invoice_payments)
              .set({ status: 'paid', paid_at: new Date() })
              .where(eq(invoice_payments.id, payRow.id));

            const [inv] = await tx.select().from(invoices).where(eq(invoices.id, payRow.invoice_id));
            const newPaid = Math.round((parseFloat(inv.amount_paid || 0) + parseFloat(payRow.amount)) * 100) / 100;
            const covered = newPaid + parseFloat(inv.credit_applied || 0) >= parseFloat(inv.total) - 0.005;

            [coveringInvoice] = await tx.update(invoices)
              .set({
                amount_paid: newPaid.toFixed(2),
                ...(covered ? { pay_status: 'paid', paid_at: inv.paid_at || new Date() } : {}),
              })
              .where(eq(invoices.id, inv.id))
              .returning();

            if (covered) {
              [coveringOrder] = await tx.select().from(sales_orders).where(eq(sales_orders.id, inv.order_id));
              if (coveringOrder && !['shipped', 'delivered'].includes(coveringOrder.status)) {
                await tx.update(sales_orders)
                  .set({ status: 'paid', updated_at: new Date() })
                  .where(eq(sales_orders.id, inv.order_id));
              }
            }
          });

          if (coveringInvoice?.pay_status === 'paid' && coveringOrder) {
            const [customer] = await db.select().from(patients).where(eq(patients.id, coveringOrder.patient_id));
            await rememberDefaultCard(pi, coveringOrder.patient_id);
            try { await sendPaymentConfirmation(customer, coveringOrder, coveringInvoice, 'stripe_cc'); }
            catch (e) { console.error('Installment confirmation email failed:', e.message); }
          }
        }
        return res.json({ received: true });
      }

      // ── Full payment path ────────────────────────────────────────────────────
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
        let updated, order, customer;
        await db.transaction(async (tx) => {
          const chargedUSD = pi.amount_received ? pi.amount_received / 100 : parseFloat(invoice.total);
          const newPaid = Math.round((parseFloat(invoice.amount_paid || 0) + chargedUSD) * 100) / 100;
          [updated] = await tx.update(invoices)
            .set({ pay_status: 'paid', paid_at: new Date(), amount_paid: newPaid.toFixed(2) })
            .where(eq(invoices.id, invoice.id))
            .returning();

          [order] = await tx.select().from(sales_orders)
            .where(eq(sales_orders.id, invoice.order_id));

          // Don't downgrade an already-shipped order — but a webhook should
          // never fire on a shipped order anyway. Still, keep the guard.
          if (order && !['shipped', 'delivered'].includes(order.status)) {
            await tx.update(sales_orders)
              .set({ status: 'paid', updated_at: new Date() })
              .where(eq(sales_orders.id, invoice.order_id));
          }
        });

        [customer] = await db.select().from(patients)
          .where(eq(patients.id, order.patient_id));

        // Remember the card for one-click checkout + autopay
        if (invoice.pay_method === 'stripe_cc' || !invoice.pay_method) {
          await rememberDefaultCard(pi, order.patient_id);
        }

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
