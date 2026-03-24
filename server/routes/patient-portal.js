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
      .where(eq(patients.id, req.session.patientId))
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
      .where(eq(sales_orders.patient_id, req.session.patientId))
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
      .where(eq(sales_orders.patient_id, req.session.patientId))
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
    if (!order || order.patient_id !== req.session.patientId) {
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

    return res.json({ ...row, items });
  } catch (err) {
    console.error('Patient invoice detail error:', err);
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
      .where(eq(sales_orders.patient_id, req.session.patientId))
      .orderBy(desc(shipments.created_at));
    return res.json(rows);
  } catch (err) {
    console.error('Patient shipments error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
