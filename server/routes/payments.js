const express = require('express');
const { db } = require('../db');
const { invoices, sales_orders, patients, invoice_payments } = require('../db/schema');
const { eq, and, ne } = require('drizzle-orm');
const { validate, payIntentSchema, usdcConfirmSchema } = require('../middleware/validate');
const stripeService = require('../services/stripe');
const usdcService = require('../services/usdc');
const { applyCredit } = require('../services/autopay');
const { sendPaymentConfirmation, sendRefillPaymentAdminNotification } = require('../services/mailer');
const { refill_requests } = require('../db/schema');

const router = express.Router();

// Remaining balance after credit + prior partial payments
function remainingDue(invoice) {
  const total = parseFloat(invoice.total);
  const credit = parseFloat(invoice.credit_applied || 0);
  const paid = parseFloat(invoice.amount_paid || 0);
  return Math.max(0, Math.round((total - credit - paid) * 100) / 100);
}

// Mark an invoice fully paid + sync the order (guarding shipped orders)
async function markInvoicePaid(invoiceId, { pay_method, amount_paid_delta = 0 }) {
  let updated, order;
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    const newPaid = (parseFloat(inv.amount_paid || 0) + amount_paid_delta).toFixed(2);
    [updated] = await tx.update(invoices)
      .set({ pay_status: 'paid', pay_method, amount_paid: newPaid, paid_at: inv.paid_at || new Date() })
      .where(eq(invoices.id, invoiceId))
      .returning();
    [order] = await tx.select().from(sales_orders).where(eq(sales_orders.id, updated.order_id));
    if (order && !['shipped', 'delivered'].includes(order.status)) {
      await tx.update(sales_orders)
        .set({ status: 'paid', updated_at: new Date() })
        .where(eq(sales_orders.id, updated.order_id));
    }
  });
  return { invoice: updated, order };
}

// Invoice subtotals are always grossed up 3.9% at creation (CC price baked in).
// CC pays full price, ACH/USDC get a discount that strips out the markup.
const CC_FEE_RATE = 0.039;

// ─── Access guard ─────────────────────────────────────────────────────────────
// Allow if: admin session, patient session matching order.patient_id, or the
// request supplies a matching, unexpired pay_token as a query param OR request
// body field. Legacy /pay/:invoiceId (no token) is allowed while the invoice's
// pay_token is still within its 3-day validity window (same rule as GET invoice).
async function ensurePayAccess(req, res, next) {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.invoiceId));
    if (!invoice) return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });

    // Admin session — always OK
    if (req.session?.adminId) { req.invoice = invoice; return next(); }

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));

    // Customer session — must own the order
    if (req.session?.customerId && order && order.patient_id === req.session.customerId) {
      req.invoice = invoice; req.order = order; return next();
    }

    // Token supplied — must match invoice pay_token AND be unexpired
    const tokenSupplied = req.query?.token || req.body?.pay_token;
    if (tokenSupplied && invoice.pay_token && tokenSupplied === invoice.pay_token) {
      if (invoice.pay_token_expires_at && new Date() <= new Date(invoice.pay_token_expires_at)) {
        req.invoice = invoice; req.order = order; return next();
      }
    }

    // Legacy: invoice's own pay_token still valid (no token supplied) — allow
    if (invoice.pay_token && invoice.pay_token_expires_at &&
        new Date() <= new Date(invoice.pay_token_expires_at)) {
      req.invoice = invoice; req.order = order; return next();
    }

    return res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied. Payment link may have expired.' });
  } catch (err) {
    console.error('ensurePayAccess error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
}

// POST /api/pay/:invoiceId/intent
// Body: { method: 'stripe_cc'|'ach'|'usdc', installments?: 2|3 }
router.post('/:invoiceId/intent', ensurePayAccess, validate(payIntentSchema), async (req, res) => {
  try {
    const { method } = req.validated;
    const installments = [2, 3].includes(parseInt(req.body.installments, 10))
      ? parseInt(req.body.installments, 10) : null;
    let invoice = req.invoice;
    if (invoice.pay_status === 'paid') return res.status(400).json({ error: 'ALREADY_PAID' });

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));

    const invoiceSubtotal = parseFloat(invoice.subtotal);
    const shipping = parseFloat(invoice.shipping_charge || 0);
    const base = invoiceSubtotal + shipping;

    let processingFee = 0; // positive = fee added, negative = discount applied
    let total = base;

    if (method === 'ach' || method === 'usdc') {
      // Strip out the CC markup: discount = subtotal × (0.039 / 1.039)
      const discount = Math.round(invoiceSubtotal * (CC_FEE_RATE / (1 + CC_FEE_RATE)) * 100) / 100;
      processingFee = -discount; // stored negative to indicate it's a discount
      total = Math.round((base - discount) * 100) / 100;
    }
    // stripe_cc: processingFee stays 0, total stays base (CC price already baked in)

    // Lock method/discount/total, then apply store credit (once) if available
    await db.update(invoices)
      .set({
        pay_method: method,
        processing_fee: processingFee.toFixed(2),
        total: total.toFixed(2),
      })
      .where(eq(invoices.id, invoice.id));

    let creditApplied = parseFloat(invoice.credit_applied || 0);
    if (creditApplied === 0 && parseFloat(patient.credit_balance || 0) > 0) {
      await db.transaction(async (tx) => {
        const [freshInvoice] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
        const [freshPatient] = await tx.select().from(patients).where(eq(patients.id, patient.id));
        creditApplied = await applyCredit(tx, freshPatient, freshInvoice);
      });
    }
    [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    const due = remainingDue(invoice);

    // Credit covered everything — mark paid, no charge needed
    if (due <= 0.005) {
      const { invoice: paidInvoice } = await markInvoicePaid(invoice.id, { pay_method: 'credit' });
      try { await sendPaymentConfirmation(patient, order, paidInvoice, 'credit'); } catch { /* non-fatal */ }
      return res.json({ method: 'credit', paid_in_full_with_credit: true, credit_applied: creditApplied.toFixed(2) });
    }

    if (method === 'usdc') {
      return res.json({
        method: 'usdc',
        wallet: process.env.MERCHANT_USDC_WALLET,
        amount_usdc: due.toFixed(2),
        credit_applied: creditApplied.toFixed(2),
        networks: [
          {
            name: 'polygon',
            label: 'Polygon (recommended)',
            contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
          },
          {
            name: 'ethereum',
            label: 'Ethereum Mainnet',
            contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          },
        ],
      });
    }

    // Stripe (CC or ACH)
    const stripeCustomer = await stripeService.getOrCreateStripeCustomer(patient);
    const paymentTypes = method === 'ach' ? ['us_bank_account'] : ['card'];

    // Installment: charge a fraction of the remaining balance
    let chargeAmount = due;
    let installmentPaymentId = null;
    if (installments && method === 'stripe_cc' && invoice.installments_allowed) {
      chargeAmount = Math.round((due / installments) * 100) / 100;
      // Last-cent safety: never leave less than a cent stranded
      if (due - chargeAmount < 0.01) chargeAmount = due;
      const [payRow] = await db.insert(invoice_payments).values({
        invoice_id: invoice.id,
        amount: chargeAmount.toFixed(2),
        method,
        status: 'pending',
      }).returning();
      installmentPaymentId = payRow.id;
    }

    const paymentIntent = await stripeService.stripe.paymentIntents.create({
      amount: Math.round(chargeAmount * 100),
      currency: 'usd',
      customer: stripeCustomer.id,
      payment_method_types: paymentTypes,
      // Save the card for one-click checkout + autopay next time
      ...(method === 'stripe_cc' ? { setup_future_usage: 'off_session' } : {}),
      metadata: {
        order_id: order.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        ...(installmentPaymentId ? { invoice_payment_id: installmentPaymentId } : {}),
      },
    });

    if (installmentPaymentId) {
      await db.update(invoice_payments)
        .set({ stripe_payment_intent_id: paymentIntent.id })
        .where(eq(invoice_payments.id, installmentPaymentId));
    } else {
      await db.update(invoices)
        .set({ stripe_payment_intent_id: paymentIntent.id })
        .where(eq(invoices.id, invoice.id));
    }

    return res.json({
      method,
      client_secret: paymentIntent.client_secret,
      processing_fee: processingFee.toFixed(2),
      total: due.toFixed(2),
      charge_amount: chargeAmount.toFixed(2),
      credit_applied: creditApplied.toFixed(2),
      installments: installments || null,
    });
  } catch (err) {
    console.error('Payment intent error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Saved payment methods ─────────────────────────────────────────────────────

// GET /api/pay/:invoiceId/saved-methods — cards on file for this patient
router.get('/:invoiceId/saved-methods', ensurePayAccess, async (req, res) => {
  try {
    const invoice = req.invoice;
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    if (!patient?.stripe_customer_id) return res.json({ methods: [] });

    const pms = await stripeService.stripe.paymentMethods.list({
      customer: patient.stripe_customer_id,
      type: 'card',
      limit: 5,
    });
    return res.json({
      methods: pms.data.map(pm => ({
        id: pm.id,
        brand: pm.card?.brand,
        last4: pm.card?.last4,
        exp_month: pm.card?.exp_month,
        exp_year: pm.card?.exp_year,
        is_default: pm.id === patient.stripe_default_pm,
      })),
    });
  } catch (err) {
    console.error('Saved methods error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/pay/:invoiceId/pay-with-saved — one-click charge a card on file
router.post('/:invoiceId/pay-with-saved', ensurePayAccess, async (req, res) => {
  try {
    let invoice = req.invoice;
    if (invoice.pay_status === 'paid') return res.status(400).json({ error: 'ALREADY_PAID' });
    const pmId = req.body.payment_method_id;
    if (!pmId || typeof pmId !== 'string' || !pmId.startsWith('pm_')) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'payment_method_id required.' });
    }

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    if (!patient?.stripe_customer_id) return res.status(400).json({ error: 'NO_CUSTOMER' });

    // Card price: total stays as-is (CC gross-up baked in). Apply credit first.
    await db.update(invoices)
      .set({ pay_method: 'stripe_cc', processing_fee: '0.00' })
      .where(eq(invoices.id, invoice.id));

    let creditApplied = parseFloat(invoice.credit_applied || 0);
    if (creditApplied === 0 && parseFloat(patient.credit_balance || 0) > 0) {
      await db.transaction(async (tx) => {
        const [freshInvoice] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
        const [freshPatient] = await tx.select().from(patients).where(eq(patients.id, patient.id));
        creditApplied = await applyCredit(tx, freshPatient, freshInvoice);
      });
    }
    [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    const due = remainingDue(invoice);

    if (due <= 0.005) {
      const { invoice: paidInvoice } = await markInvoicePaid(invoice.id, { pay_method: 'credit' });
      try { await sendPaymentConfirmation(patient, order, paidInvoice, 'credit'); } catch { /* non-fatal */ }
      return res.json({ ok: true, paid_in_full_with_credit: true });
    }

    // Verify the PM belongs to this customer before charging
    const pm = await stripeService.stripe.paymentMethods.retrieve(pmId);
    if (pm.customer !== patient.stripe_customer_id) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Payment method does not belong to this customer.' });
    }

    const pi = await stripeService.stripe.paymentIntents.create({
      amount: Math.round(due * 100),
      currency: 'usd',
      customer: patient.stripe_customer_id,
      payment_method: pmId,
      off_session: true,
      confirm: true,
      metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number },
    });

    if (pi.status !== 'succeeded') {
      return res.status(400).json({ error: 'CHARGE_FAILED', message: `Payment did not complete (${pi.status}). Try entering the card manually.` });
    }

    await db.update(invoices)
      .set({ stripe_payment_intent_id: pi.id })
      .where(eq(invoices.id, invoice.id));
    // Remember this card as the default for autopay
    await db.update(patients)
      .set({ stripe_default_pm: pmId })
      .where(eq(patients.id, patient.id));

    const { invoice: paidInvoice } = await markInvoicePaid(invoice.id, { pay_method: 'stripe_cc', amount_paid_delta: due });
    try { await sendPaymentConfirmation(patient, order, paidInvoice, 'stripe_cc'); } catch { /* non-fatal */ }
    try {
      const [refillReq] = await db.select().from(refill_requests).where(eq(refill_requests.order_id, order.id));
      if (refillReq) await sendRefillPaymentAdminNotification(patient, order, paidInvoice);
    } catch { /* non-fatal */ }

    return res.json({ ok: true, invoice: paidInvoice });
  } catch (err) {
    // Stripe card errors surface with a useful message
    const msg = err?.raw?.message || err.message || 'Charge failed';
    console.error('Pay-with-saved error:', msg);
    return res.status(400).json({ error: 'CHARGE_FAILED', message: msg });
  }
});

// POST /api/pay/:invoiceId/usdc-confirm
router.post('/:invoiceId/usdc-confirm', ensurePayAccess, validate(usdcConfirmSchema), async (req, res) => {
  try {
    const invoice = req.invoice;
    if (invoice.pay_status === 'paid') return res.status(400).json({ error: 'ALREADY_PAID' });

    // Basic tx_hash sanity: 0x-prefixed 64-char hex. Normalize to lowercase.
    const raw = req.validated.tx_hash;
    if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) {
      return res.status(400).json({ error: 'INVALID_TX', message: 'Malformed transaction hash.' });
    }
    const tx_hash = raw.toLowerCase();

    // Reject replay: this tx must not already be attached to any other invoice
    const [existingUse] = await db.select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.usdc_tx_hash, tx_hash), ne(invoices.id, invoice.id)))
      .limit(1);
    if (existingUse) {
      return res.status(400).json({ error: 'TX_ALREADY_USED', message: 'This transaction has already been applied to another invoice.' });
    }

    const total = remainingDue(invoice);
    const result = await usdcService.verifyUSDCTransaction(tx_hash, total);

    if (!result.verified) {
      return res.status(400).json({
        error: 'INVALID_TX',
        message: 'Transaction could not be verified. Check recipient address, contract, network, and amount.',
      });
    }

    // Ensure the on-chain transfer happened AFTER the invoice was created —
    // otherwise it's a replay of a historical transfer.
    if (result.blockTimestamp && invoice.created_at &&
        new Date(result.blockTimestamp) < new Date(invoice.created_at)) {
      return res.status(400).json({
        error: 'STALE_TX',
        message: 'Transaction was mined before the invoice was created.',
      });
    }

    let updated, order;
    try {
      await db.transaction(async (tx) => {
        [updated] = await tx.update(invoices)
          .set({
            pay_status: 'paid',
            pay_method: `usdc_${result.network}`,
            usdc_tx_hash: tx_hash,
            paid_at: new Date(),
          })
          .where(eq(invoices.id, invoice.id))
          .returning();

        [order] = await tx.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
        if (order && !['shipped', 'delivered'].includes(order.status)) {
          await tx.update(sales_orders)
            .set({ status: 'paid', updated_at: new Date() })
            .where(eq(sales_orders.id, invoice.order_id));
        }
      });
    } catch (err) {
      // Unique index race: another confirm claimed this tx_hash first
      if (err.code === '23505') {
        return res.status(400).json({ error: 'TX_ALREADY_USED', message: 'This transaction has already been applied to another invoice.' });
      }
      throw err;
    }

    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));

    try {
      await sendPaymentConfirmation(patient, order, updated, 'usdc');
    } catch (mailErr) {
      console.error('Payment email failed:', mailErr.message);
    }
    try {
      const [refillReq] = await db.select().from(refill_requests).where(eq(refill_requests.order_id, order.id));
      if (refillReq) await sendRefillPaymentAdminNotification(patient, order, updated);
    } catch (e) { console.error('Refill admin notify failed:', e.message); }

    return res.json({ ok: true, invoice: updated });
  } catch (err) {
    console.error('USDC confirm error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
