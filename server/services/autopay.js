// Autopay: charge a patient's saved card off-session when their refill is due,
// creating the order + invoice automatically. Staff only need to ship.
const { db } = require('../db');
const {
  sales_orders, invoices, reminder_rules, patients, credit_ledger,
} = require('../db/schema');
const { eq, sql } = require('drizzle-orm');
const { stripe, getOrCreateStripeCustomer } = require('./stripe');
const { createInvoiceForOrder } = require('./invoicing');
const { createSimpleOrder } = require('./order-helpers');
const { sendAdminAlert, sendPaymentConfirmation, sendInvoiceEmail } = require('./mailer');

// Apply available store credit to an invoice. Returns the amount applied.
// Deducts patient balance + writes a ledger row inside the given transaction.
async function applyCredit(tx, patient, invoice) {
  const balance = parseFloat(patient.credit_balance || 0);
  const total = parseFloat(invoice.total);
  const alreadyApplied = parseFloat(invoice.credit_applied || 0);
  if (balance <= 0 || alreadyApplied > 0) return alreadyApplied;

  const applied = Math.min(balance, total);
  await tx.update(invoices)
    .set({ credit_applied: applied.toFixed(2) })
    .where(eq(invoices.id, invoice.id));
  await tx.update(patients)
    .set({ credit_balance: (balance - applied).toFixed(2) })
    .where(eq(patients.id, patient.id));
  await tx.insert(credit_ledger).values({
    patient_id: patient.id,
    amount: (-applied).toFixed(2),
    reason: `Applied to invoice ${invoice.invoice_number}`,
    invoice_id: invoice.id,
  });
  return applied;
}

/**
 * Charge one autopay rule. Creates order + invoice, applies credit, charges
 * the saved card off-session. Returns { ok, error?, order?, invoice? }.
 */
async function chargeAutopayRule(rule, patient, product) {
  try {
    if (!patient.stripe_default_pm) return { ok: false, error: 'NO_SAVED_CARD' };

    // 1. Create the order (transaction + retry handled by the shared helper)
    const order = await createSimpleOrder({
      patient_id: patient.id,
      product,
      notes: `Autopay refill (rule ${rule.id}). Card charged automatically — ready to ship.`,
    });

    // 2. Invoice (no notify — we'll email a receipt or a pay-link depending on outcome)
    const { invoice } = await createInvoiceForOrder(order, { notify: false });

    // 3. Apply store credit
    let creditApplied = 0;
    await db.transaction(async (tx) => {
      creditApplied = await applyCredit(tx, patient, invoice);
    });
    const amountDue = Math.max(0, parseFloat(invoice.total) - creditApplied);

    // 4. Charge (skip Stripe entirely if credit covered it)
    if (amountDue > 0.005) {
      const customer = await getOrCreateStripeCustomer(patient);
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(amountDue * 100),
        currency: 'usd',
        customer: customer.id,
        payment_method: patient.stripe_default_pm,
        off_session: true,
        confirm: true,
        metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, autopay: 'true' },
      });
      if (pi.status !== 'succeeded') {
        throw new Error(`PaymentIntent status ${pi.status}`);
      }
      await db.update(invoices)
        .set({ stripe_payment_intent_id: pi.id })
        .where(eq(invoices.id, invoice.id));
    }

    // 5. Mark paid
    let updatedInvoice;
    await db.transaction(async (tx) => {
      [updatedInvoice] = await tx.update(invoices)
        .set({
          pay_status: 'paid',
          pay_method: amountDue > 0.005 ? 'stripe_cc' : 'credit',
          amount_paid: amountDue.toFixed(2),
          paid_at: new Date(),
        })
        .where(eq(invoices.id, invoice.id))
        .returning();
      await tx.update(sales_orders)
        .set({ status: 'paid', updated_at: new Date() })
        .where(eq(sales_orders.id, order.id));
    });

    // 6. Point the rule at this order; reset cycle notice
    await db.update(reminder_rules)
      .set({ last_order_id: order.id, last_reminded_at: new Date(), autopay_notice_sent_at: null, escalated_at: null })
      .where(eq(reminder_rules.id, rule.id));

    // 7. Notify
    try { await sendPaymentConfirmation(patient, order, updatedInvoice, 'stripe_cc'); }
    catch (e) { console.error('[Autopay] receipt email failed:', e.message); }
    try {
      await sendAdminAlert(
        `Autopay charged — ship ${order.order_number}`,
        `<p><strong>${patient.name}</strong> was charged $${parseFloat(updatedInvoice.total).toFixed(2)} for their ${product.name} refill.</p>
         <p>The order is paid and ready to ship.</p>
         <p><a href="${process.env.BASE_URL}/orders/${order.id}">Open order</a></p>`
      );
    } catch (e) { console.error('[Autopay] admin alert failed:', e.message); }

    return { ok: true, order, invoice: updatedInvoice };
  } catch (err) {
    console.error(`[Autopay] Charge failed for rule ${rule.id}:`, err.message);

    // Card declined / expired: fall back to a manual pay link so the refill
    // isn't silently lost. Point the rule at the order to stop repeat charges.
    try {
      const [pendingInvoice] = await db.select().from(invoices)
        .where(eq(invoices.stripe_payment_intent_id, err?.payment_intent?.id || '__none__'));
      const [order] = await db.select().from(sales_orders)
        .where(eq(sales_orders.patient_id, patient.id))
        .orderBy(sql`created_at DESC`).limit(1);
      if (order && order.notes?.includes('Autopay refill')) {
        await db.update(reminder_rules)
          .set({ last_order_id: order.id, last_reminded_at: new Date() })
          .where(eq(reminder_rules.id, rule.id));
        const [inv] = await db.select().from(invoices).where(eq(invoices.order_id, order.id));
        if (inv) {
          try { await sendInvoiceEmail(patient, order, inv); } catch { /* logged below */ }
        }
      }
      await sendAdminAlert(
        `Autopay FAILED — ${patient.name}`,
        `<p>Automatic charge for <strong>${patient.name}</strong> (${product.name}) failed: ${err.message}</p>
         <p>The patient was emailed a manual pay link. You may want to follow up.</p>`
      );
      void pendingInvoice;
    } catch (e) { console.error('[Autopay] failure-path handling failed:', e.message); }

    return { ok: false, error: err.message };
  }
}

module.exports = { chargeAutopayRule, applyCredit };
