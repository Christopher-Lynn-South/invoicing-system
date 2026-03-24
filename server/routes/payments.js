const express = require('express');
const { db } = require('../db');
const { invoices, sales_orders, patients } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { validate, payIntentSchema, usdcConfirmSchema } = require('../middleware/validate');
const stripeService = require('../services/stripe');
const usdcService = require('../services/usdc');
const { sendPaymentConfirmation } = require('../services/mailer');

const router = express.Router();

const CC_FEE_RATE = 0.039;

// POST /api/pay/:invoiceId/intent
router.post('/:invoiceId/intent', validate(payIntentSchema), async (req, res) => {
  try {
    const { method } = req.validated;
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.invoiceId));
    if (!invoice) return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });
    if (invoice.pay_status === 'paid') return res.status(400).json({ error: 'ALREADY_PAID' });

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));

    let processingFee = 0;
    let total = parseFloat(invoice.subtotal);

    if (method === 'stripe_cc') {
      processingFee = Math.round(total * CC_FEE_RATE * 100) / 100;
      total = Math.round((total + processingFee) * 100) / 100;
    }

    // Update invoice with locked fee and total
    await db.update(invoices)
      .set({
        pay_method: method,
        processing_fee: processingFee.toFixed(2),
        total: total.toFixed(2),
      })
      .where(eq(invoices.id, invoice.id));

    if (method === 'usdc') {
      return res.json({
        method: 'usdc',
        wallet: process.env.MERCHANT_USDC_WALLET,
        amount_usdc: total.toFixed(2),
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

    const paymentIntent = await stripeService.stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: 'usd',
      customer: stripeCustomer.id,
      payment_method_types: paymentTypes,
      metadata: {
        order_id: order.id,
        invoice_number: invoice.invoice_number,
      },
    });

    await db.update(invoices)
      .set({ stripe_payment_intent_id: paymentIntent.id })
      .where(eq(invoices.id, invoice.id));

    return res.json({
      method,
      client_secret: paymentIntent.client_secret,
      processing_fee: processingFee.toFixed(2),
      total: total.toFixed(2),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/pay/:invoiceId/usdc-confirm
router.post('/:invoiceId/usdc-confirm', validate(usdcConfirmSchema), async (req, res) => {
  try {
    const { tx_hash } = req.validated;
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.invoiceId));
    if (!invoice) return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });
    if (invoice.pay_status === 'paid') return res.status(400).json({ error: 'ALREADY_PAID' });

    const total = parseFloat(invoice.total);
    const result = await usdcService.verifyUSDCTransaction(tx_hash, total);

    if (!result.verified) {
      return res.status(400).json({
        error: 'INVALID_TX',
        message: 'Transaction could not be verified on Polygon or Ethereum. Check recipient address, contract, and amount.',
      });
    }

    const [updated] = await db.update(invoices)
      .set({
        pay_status: 'paid',
        pay_method: `usdc_${result.network}`,
        usdc_tx_hash: tx_hash,
        paid_at: new Date(),
      })
      .where(eq(invoices.id, invoice.id))
      .returning();

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));

    await db.update(sales_orders)
      .set({ status: 'paid', updated_at: new Date() })
      .where(eq(sales_orders.id, invoice.order_id));

    try {
      await sendPaymentConfirmation(patient, order, updated, 'usdc');
    } catch (mailErr) {
      console.error('Payment email failed:', mailErr.message);
    }

    return res.json({ ok: true, invoice: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

module.exports = router;
