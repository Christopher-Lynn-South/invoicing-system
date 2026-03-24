const express = require('express');
const { db } = require('../db');
const { invoices, sales_orders, order_items, products, patients } = require('../db/schema');
const { eq, sql } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');
const { generateInvoicePDF } = require('../services/pdf');
const { sendInvoiceEmail } = require('../services/mailer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const result = await db.execute(
    sql`SELECT invoice_number FROM invoices WHERE invoice_number LIKE ${prefix + '%'} ORDER BY invoice_number DESC LIMIT 1`
  );
  const rows = result.rows || result;
  if (!rows.length) return `${prefix}001`;
  const last = rows[0].invoice_number;
  const num = parseInt(last.split('-')[2], 10) + 1;
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

    // Check for existing invoice
    const [existing] = await db.select().from(invoices).where(eq(invoices.order_id, order.id));
    if (existing) return res.json(existing);

    const items = await db.select({
      item: order_items,
      product_name: products.name,
      product_sku: products.sku,
    })
      .from(order_items)
      .leftJoin(products, eq(order_items.product_id, products.id))
      .where(eq(order_items.order_id, order.id));

    const subtotal = items.reduce((sum, r) => sum + parseFloat(r.item.line_total), 0);
    const invoice_number = await generateInvoiceNumber();
    const due_date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [invoice] = await db.insert(invoices).values({
      invoice_number,
      order_id: order.id,
      subtotal: subtotal.toFixed(2),
      processing_fee: '0.00',
      total: subtotal.toFixed(2),
      pay_status: 'pending',
      due_date,
    }).returning();

    // Update order status
    await db.update(sales_orders)
      .set({ status: 'pending_payment', updated_at: new Date() })
      .where(eq(sales_orders.id, order.id));

    // Generate PDF
    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const invoicesDir = path.join(__dirname, '../../uploads/invoices');
    fs.mkdirSync(invoicesDir, { recursive: true });
    const pdfPath = path.join(invoicesDir, `${invoice.id}.pdf`);
    await generateInvoicePDF({
      invoice,
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
    const rows = await db.select({
      invoice: invoices,
      order_number: sales_orders.order_number,
      patient_name: patients.name,
    })
      .from(invoices)
      .leftJoin(sales_orders, eq(invoices.order_id, sales_orders.id))
      .leftJoin(patients, eq(sales_orders.patient_id, patients.id))
      .orderBy(invoices.created_at);
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

// GET /api/invoices/:id  (PUBLIC — no auth required)
router.get('/invoices/:id', async (req, res) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
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

    // Omit sensitive patient data for public endpoint
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

// GET /api/invoices/:id/pdf
router.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, req.params.id));
    if (!invoice) return res.status(404).json({ error: 'NOT_FOUND' });

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
