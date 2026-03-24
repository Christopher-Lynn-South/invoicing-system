// Patient-facing portal routes — require patient session, return only the
// logged-in patient's own data.
const express = require('express');
const { db } = require('../db');
const { patients, sales_orders, order_items, invoices, shipments, products } = require('../db/schema');
const { eq, desc } = require('drizzle-orm');
const { requirePatientLogin } = require('../middleware/auth');

const router = express.Router();

// All routes require patient login
router.use(requirePatientLogin);

// ─── GET /api/patient/profile ─────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
    const [patient] = await db
      .select({
        id: patients.id,
        name: patients.name,
        email: patients.email,
        phone: patients.phone,
        billing_address: patients.billing_address,
        date_of_birth: patients.date_of_birth,
      })
      .from(patients)
      .where(eq(patients.id, req.session.customerId))
      .limit(1);
    return res.json(patient);
  } catch (err) {
    console.error('Patient profile error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET /api/patient/orders ──────────────────────────────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const orders = await db
      .select()
      .from(sales_orders)
      .where(eq(sales_orders.patient_id, req.session.customerId))
      .orderBy(desc(sales_orders.created_at));
    return res.json(orders);
  } catch (err) {
    console.error('Patient orders error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET /api/patient/invoices ────────────────────────────────────────────────
router.get('/invoices', async (req, res) => {
  try {
    const rows = await db
      .select({
        id: invoices.id,
        invoice_number: invoices.invoice_number,
        subtotal: invoices.subtotal,
        processing_fee: invoices.processing_fee,
        total: invoices.total,
        pay_method: invoices.pay_method,
        pay_status: invoices.pay_status,
        due_date: invoices.due_date,
        paid_at: invoices.paid_at,
        created_at: invoices.created_at,
        order_number: sales_orders.order_number,
        order_status: sales_orders.status,
      })
      .from(invoices)
      .innerJoin(sales_orders, eq(invoices.order_id, sales_orders.id))
      .where(eq(sales_orders.patient_id, req.session.customerId))
      .orderBy(desc(invoices.created_at));
    return res.json(rows);
  } catch (err) {
    console.error('Patient invoices error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET /api/patient/invoices/:id ───────────────────────────────────────────
router.get('/invoices/:id', async (req, res) => {
  try {
    const [row] = await db
      .select({
        id: invoices.id,
        invoice_number: invoices.invoice_number,
        subtotal: invoices.subtotal,
        processing_fee: invoices.processing_fee,
        total: invoices.total,
        pay_method: invoices.pay_method,
        pay_status: invoices.pay_status,
        due_date: invoices.due_date,
        paid_at: invoices.paid_at,
        pdf_url: invoices.pdf_url,
        created_at: invoices.created_at,
        order_number: sales_orders.order_number,
        order_status: sales_orders.status,
        order_id: sales_orders.id,
      })
      .from(invoices)
      .innerJoin(sales_orders, eq(invoices.order_id, sales_orders.id))
      .where(eq(invoices.id, req.params.id))
      .limit(1);

    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });

    // Ownership check
    const [order] = await db.select({ patient_id: sales_orders.patient_id })
      .from(sales_orders).where(eq(sales_orders.id, row.order_id)).limit(1);
    if (!order || order.patient_id !== req.session.customerId) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    // Line items
    const items = await db
      .select({
        id: order_items.id,
        quantity: order_items.quantity,
        unit_price: order_items.unit_price,
        line_total: order_items.line_total,
        product_name: products.name,
        product_sku: products.sku,
      })
      .from(order_items)
      .innerJoin(products, eq(order_items.product_id, products.id))
      .where(eq(order_items.order_id, row.order_id));

    // Shipment for this order (if any)
    const [shipment] = await db
      .select({
        id: shipments.id,
        fedex_tracking_number: shipments.fedex_tracking_number,
        status: shipments.status,
        ship_date: shipments.ship_date,
        estimated_delivery: shipments.estimated_delivery,
        latest_status: shipments.latest_status,
      })
      .from(shipments)
      .where(eq(shipments.order_id, row.order_id))
      .limit(1);

    return res.json({ ...row, items, shipment: shipment || null });
  } catch (err) {
    console.error('Patient invoice detail error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── PATCH /api/customer/invoices/:id/note  (customer adds note to order) ────
router.patch('/invoices/:id/note', async (req, res) => {
  try {
    const { note } = req.body;
    if (typeof note !== 'string') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'note must be a string.' });
    }

    // Find invoice and verify ownership
    const [row] = await db
      .select({ order_id: invoices.order_id })
      .from(invoices)
      .innerJoin(sales_orders, eq(invoices.order_id, sales_orders.id))
      .where(eq(invoices.id, req.params.id))
      .limit(1);

    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });

    const [order] = await db.select({ id: sales_orders.id, patient_id: sales_orders.patient_id, notes: sales_orders.notes })
      .from(sales_orders).where(eq(sales_orders.id, row.order_id)).limit(1);

    if (!order || order.patient_id !== req.session.customerId) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }

    // Append timestamped note rather than overwrite
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const appended = order.notes
      ? `${order.notes}\n[Customer ${timestamp}]: ${note.trim()}`
      : `[Customer ${timestamp}]: ${note.trim()}`;

    await db.update(sales_orders)
      .set({ notes: appended, updated_at: new Date() })
      .where(eq(sales_orders.id, order.id));

    return res.json({ ok: true });
  } catch (err) {
    console.error('Customer note error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET /api/patient/shipments ───────────────────────────────────────────────
router.get('/shipments', async (req, res) => {
  try {
    const rows = await db
      .select({
        id: shipments.id,
        fedex_tracking_number: shipments.fedex_tracking_number,
        status: shipments.status,
        ship_date: shipments.ship_date,
        estimated_delivery: shipments.estimated_delivery,
        latest_status: shipments.latest_status,
        order_number: sales_orders.order_number,
      })
      .from(shipments)
      .innerJoin(sales_orders, eq(shipments.order_id, sales_orders.id))
      .where(eq(sales_orders.patient_id, req.session.customerId))
      .orderBy(desc(shipments.created_at));
    return res.json(rows);
  } catch (err) {
    console.error('Patient shipments error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
