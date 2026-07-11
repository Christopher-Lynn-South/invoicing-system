const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { invoices, sales_orders, order_items, products, patients, shipments } = require('../db/schema');
const { eq, sql, isNull, and } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');
const { generateInvoicePDF } = require('../services/pdf');
const { sendInvoiceEmail } = require('../services/mailer');
const { sendInvoiceSMS } = require('../services/sms');
const path = require('path');
const fs = require('fs');

// ─── Pay-link token helpers ────────────────────────────────────────────────────

function generatePayToken() {
  return crypto.randomBytes(32).toString('hex'); // 64-char hex, URL-safe
}

function payTokenExpiresAt(days = 3) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Numeric-sort the trailing suffix so 1000 comes AFTER 999.
// Callers should retry on unique-violation from concurrent inserts.
async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const result = await db.execute(sql`
    SELECT invoice_number FROM invoices
    WHERE invoice_number LIKE ${prefix + '%'}
    ORDER BY (regexp_replace(invoice_number, '.*-', '')::bigint) DESC
    LIMIT 1
  `);
  const rows = result.rows || result;
  if (!rows.length) return `${prefix}001`;
  const last = rows[0].invoice_number;
  const num = parseInt(last.split('-').pop(), 10) + 1;
  return `${prefix}${String(num).padStart(3, '0')}`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/orders/:id/invoice  (generate invoice for an order)
router.post('/orders/:orderId/invoice', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.orderId));
    if (!order) return res.status(404).json({ error: 'ORDER_NOT_FOUND' });
    if (!['draft', 'pending_payment'].includes(order.status)) {
      return res.status(400).json({ error: 'INVALID_STATUS', message: 'Order must be draft or pending_payment.' });
    }

    // Check for existing non-deleted invoice
    const [existing] = await db.select().from(invoices)
      .where(and(eq(invoices.order_id, order.id), isNull(invoices.deleted_at)));
    if (existing) return res.json(existing);

    const items = await db.select({
      item: order_items,
      product_name: products.name,
      product_sku: products.sku,
    })
      .from(order_items)
      .leftJoin(products, eq(order_items.product_id, products.id))
      .where(eq(order_items.order_id, order.id));

    const baseSubtotal = items.reduce((sum, r) => sum + parseFloat(r.item.line_total), 0);
    // Always gross up by 3.9% — this is the CC price baked into line items
    const subtotal = Math.round(baseSubtotal * 1.039 * 100) / 100;
    const shipping_charge = order.shipping_quote?.net_charge ? parseFloat(order.shipping_quote.net_charge) : 0;
    const due_date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Atomic invoice-create + order-status-update — a failed status update
    // used to leave the order stuck in 'draft' with an invoice that could
    // not be paid. Retry the transaction on invoice_number collision.
    let invoice;
    for (let attempt = 0; attempt < 5; attempt++) {
      const invoice_number = await generateInvoiceNumber();
      try {
        await db.transaction(async (tx) => {
          [invoice] = await tx.insert(invoices).values({
            invoice_number,
            order_id: order.id,
            subtotal: subtotal.toFixed(2),
            shipping_charge: shipping_charge.toFixed(2),
            processing_fee: '0.00',
            total: (subtotal + shipping_charge).toFixed(2),
            pay_status: 'pending',
            due_date,
            pay_token: generatePayToken(),
            pay_token_expires_at: payTokenExpiresAt(3),
          }).returning();

          await tx.update(sales_orders)
            .set({ status: 'pending_payment', updated_at: new Date() })
            .where(eq(sales_orders.id, order.id));
        });
        break;
      } catch (err) {
        if (err.code !== '23505' || attempt === 4) throw err;
        await new Promise(r => setTimeout(r, 10 + Math.random() * 40));
      }
    }

    // Generate PDF
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const invoicesDir = path.join(__dirname, '../../uploads/invoices');
    fs.mkdirSync(invoicesDir, { recursive: true });
    const pdfPath = path.join(invoicesDir, `${invoice.id}.pdf`);
    await generateInvoicePDF({
      invoice: { ...invoice, shipping_service: order.shipping_quote?.service_type || null },
      order,
      patient,
      items: items.map(r => ({ ...r.item, product_name: r.product_name })),
    }, pdfPath);

    const pdf_url = `/uploads/invoices/${invoice.id}.pdf`;
    const [updated] = await db.update(invoices)
      .set({ pdf_url, sent_at: new Date() })
      .where(eq(invoices.id, invoice.id))
      .returning();

    // Send email
    try {
      await sendInvoiceEmail(patient, order, updated);
    } catch (mailErr) {
      console.error('Invoice email failed:', mailErr.message);
    }

    return res.status(201).json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/invoices  (list all invoices — admin)
router.get('/invoices', requireLogin, async (req, res) => {
  try {
    const showDeleted = req.query.deleted === 'true';
    const limit  = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 5000));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const rows = await db.select({
      invoice: invoices,
      order_number: sales_orders.order_number,
      patient_name: patients.name,
    })
      .from(invoices)
      .leftJoin(sales_orders, eq(invoices.order_id, sales_orders.id))
      .leftJoin(patients, eq(sales_orders.patient_id, patients.id))
      .where(showDeleted ? undefined : isNull(invoices.deleted_at))
      .orderBy(invoices.created_at)
      .limit(limit)
      .offset(offset);
    return res.json(rows.map(r => ({
      ...r.invoice,
      order_number: r.order_number,
      patient_name: r.patient_name,
    })));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/invoices/by-token/:token  (PUBLIC — validates expiring pay-link token)
router.get('/invoices/by-token/:token', async (req, res) => {
  try {
    const [invoice] = await db.select().from(invoices)
      .where(eq(invoices.pay_token, req.params.token));

    if (!invoice) return res.status(404).json({ error: 'NOT_FOUND', message: 'Payment link not found.' });

    if (!invoice.pay_token_expires_at || new Date() > new Date(invoice.pay_token_expires_at)) {
      return res.status(410).json({ error: 'LINK_EXPIRED', message: 'This payment link has expired. Please contact us to receive a new one.' });
    }

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const items = await db.select({
      item: order_items,
      product_name: products.name,
      product_sku: products.sku,
    })
      .from(order_items)
      .leftJoin(products, eq(order_items.product_id, products.id))
      .where(eq(order_items.order_id, order.id));

    const publicPatient = {
      name: patient.name,
      email: patient.email,
      billing_address: patient.billing_address,
    };

    return res.json({
      ...invoice,
      order,
      patient: publicPatient,
      items: items.map(r => ({ ...r.item, product_name: r.product_name, product_sku: r.product_sku })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/invoices/:id/detail  (admin — full detail with shipment)
router.get('/invoices/:id/detail', requireLogin, async (req, res) => {
  try {
    const [invoice] = await db.select().from(invoices)
      .where(and(eq(invoices.id, req.params.id), isNull(invoices.deleted_at)));
    if (!invoice) return res.status(404).json({ error: 'NOT_FOUND' });

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const items = await db.select({
      item: order_items,
      product_name: products.name,
      product_sku: products.sku,
    })
      .from(order_items)
      .leftJoin(products, eq(order_items.product_id, products.id))
      .where(eq(order_items.order_id, order.id));

    const [shipment] = await db.select().from(shipments).where(eq(shipments.order_id, order.id)).limit(1);

    return res.json({
      ...invoice,
      order,
      patient,
      items: items.map(r => ({ ...r.item, product_name: r.product_name, product_sku: r.product_sku })),
      shipment: shipment || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// Access guard: allow if admin session, customer session matches order.patient_id,
// query token matches invoice pay_token AND unexpired, OR invoice's pay_token
// itself is still within its 3-day validity window (legacy /pay/:invoiceId links).
function invoiceAccessAllowed(req, invoice, order) {
  if (req.session?.adminId) return true;
  if (req.session?.customerId && order && order.patient_id === req.session.customerId) return true;
  const tokenQ = req.query?.token;
  if (tokenQ && invoice.pay_token && tokenQ === invoice.pay_token) {
    if (invoice.pay_token_expires_at && new Date() <= new Date(invoice.pay_token_expires_at)) return true;
  }
  // Legacy: allow anonymous access while the invoice's pay_token is still valid
  if (invoice.pay_token && invoice.pay_token_expires_at &&
      new Date() <= new Date(invoice.pay_token_expires_at)) return true;
  return false;
}

// GET /api/invoices/:id  (auth-gated; also allows valid pay-link window)
router.get('/invoices/:id', async (req, res) => {
  try {
    const [invoice] = await db.select().from(invoices)
      .where(and(eq(invoices.id, req.params.id), isNull(invoices.deleted_at)));
    if (!invoice) return res.status(404).json({ error: 'NOT_FOUND' });

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    if (!invoiceAccessAllowed(req, invoice, order)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const items = await db.select({
      item: order_items,
      product_name: products.name,
      product_sku: products.sku,
    })
      .from(order_items)
      .leftJoin(products, eq(order_items.product_id, products.id))
      .where(eq(order_items.order_id, order.id));

    // Omit sensitive patient data unless authenticated
    const publicPatient = {
      name: patient.name,
      email: patient.email,
      billing_address: patient.billing_address,
    };

    return res.json({
      ...invoice,
      order,
      patient: publicPatient,
      items: items.map(r => ({ ...r.item, product_name: r.product_name, product_sku: r.product_sku })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PATCH /api/invoices/:id  — admin update pay_status (and sync order status)
router.patch('/invoices/:id', requireLogin, async (req, res) => {
  try {
    const { pay_status } = req.body;
    const VALID_STATUSES = ['pending', 'paid', 'failed', 'waived', 'voided', 'cancelled'];

    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!invoice) return res.status(404).json({ error: 'NOT_FOUND' });

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));

    const updates = {};
    if (pay_status !== undefined) {
      if (!VALID_STATUSES.includes(pay_status)) {
        return res.status(400).json({ error: 'INVALID_STATUS', message: `pay_status must be one of: ${VALID_STATUSES.join(', ')}` });
      }

      // Reject changes that would revert an already-shipped/delivered order
      const orderIsShipped = order && ['shipped', 'delivered'].includes(order.status);
      const wouldDowngrade = invoice.pay_status === 'paid' && pay_status !== 'paid';
      if (orderIsShipped && wouldDowngrade) {
        return res.status(400).json({
          error: 'ORDER_SHIPPED',
          message: 'Cannot change pay_status on an invoice whose order has already shipped. Issue a refund via Stripe / bank instead.',
        });
      }

      updates.pay_status = pay_status;
      // Only set paid_at when transitioning to paid. Never null it — keep audit trail.
      if (pay_status === 'paid' && !invoice.paid_at) {
        updates.paid_at = new Date();
      }
    }

    const [updated] = await db.update(invoices)
      .set(updates)
      .where(eq(invoices.id, invoice.id))
      .returning();

    // Sync sales order status when payment status changes — but NEVER downgrade
    // an order that's already shipped/delivered.
    if (pay_status !== undefined && order && !['shipped', 'delivered'].includes(order.status)) {
      let orderStatus;
      if (pay_status === 'paid') orderStatus = 'paid';
      else if (pay_status === 'voided' || pay_status === 'cancelled') orderStatus = 'cancelled';
      else orderStatus = 'pending_payment';
      await db.update(sales_orders)
        .set({ status: orderStatus, updated_at: new Date() })
        .where(eq(sales_orders.id, invoice.order_id));
    }

    return res.json(updated);
  } catch (err) {
    console.error('Invoice PATCH error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// DELETE /api/invoices/:id  — soft delete
router.delete('/invoices/:id', requireLogin, async (req, res) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!invoice) return res.status(404).json({ error: 'NOT_FOUND' });
    if (invoice.pay_status === 'paid') {
      return res.status(400).json({ error: 'CANNOT_DELETE_PAID', message: 'Paid invoices cannot be deleted. Void or cancel instead.' });
    }
    await db.update(invoices)
      .set({ deleted_at: new Date() })
      .where(eq(invoices.id, invoice.id));
    return res.json({ ok: true });
  } catch (err) {
    console.error('Invoice DELETE error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/invoices/:id/resend  — admin resend invoice email + SMS
router.post('/invoices/:id/resend', requireLogin, async (req, res) => {
  try {
    const [order_for_invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!order_for_invoice) return res.status(404).json({ error: 'NOT_FOUND' });

    // Regenerate token — gives patient a fresh 3-day window from now
    const [invoice] = await db.update(invoices)
      .set({ pay_token: generatePayToken(), pay_token_expires_at: payTokenExpiresAt(3) })
      .where(eq(invoices.id, req.params.id))
      .returning();

    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));

    const sent = { email: false, sms: false };

    try {
      await sendInvoiceEmail(patient, order, invoice);
      sent.email = true;
    } catch (err) {
      console.error('Resend invoice email failed:', err.message);
    }

    try {
      sent.sms = await sendInvoiceSMS(patient, invoice);
    } catch (err) {
      console.error('Resend invoice SMS failed:', err.message);
    }

    return res.json({ ok: true, sent });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/invoices/:id/pdf
router.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!invoice) return res.status(404).json({ error: 'NOT_FOUND' });

    const [orderForAccess] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
    if (!invoiceAccessAllowed(req, invoice, orderForAccess)) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }

    const invoicesDir = path.join(__dirname, '../../uploads/invoices');
    const pdfPath = path.join(invoicesDir, `${invoice.id}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      // Regenerate if file is missing (e.g. volume was wiped or invoice predates PDF gen)
      const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, invoice.order_id));
      const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
      const items = await db.select({
        item: order_items,
        product_name: products.name,
        product_sku: products.sku,
      })
        .from(order_items)
        .leftJoin(products, eq(order_items.product_id, products.id))
        .where(eq(order_items.order_id, order.id));

      fs.mkdirSync(invoicesDir, { recursive: true });
      await generateInvoicePDF({
        invoice,
        order,
        patient,
        items: items.map(r => ({ ...r.item, product_name: r.product_name })),
      }, pdfPath);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoice_number}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
