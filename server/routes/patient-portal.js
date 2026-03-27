// Patient-facing portal routes — require patient session, return only the
// logged-in patient's own data.
const express = require('express');
const fs = require('fs');
const { db } = require('../db');
const { patients, sales_orders, order_items, invoices, shipments, products, prescriptions, reminder_rules, refill_requests } = require('../db/schema');
const { eq, desc, and } = require('drizzle-orm');
const { requirePatientLogin } = require('../middleware/auth');
const { sendPatientRefillRequestToAdmin } = require('../services/mailer');

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

// ─── GET /api/customer/prescriptions ──────────────────────────────────────────
router.get('/prescriptions', async (req, res) => {
  try {
    const rows = await db
      .select({
        id: prescriptions.id,
        prescribing_doctor: prescriptions.prescribing_doctor,
        doctor_phone: prescriptions.doctor_phone,
        issue_date: prescriptions.issue_date,
        expiry_date: prescriptions.expiry_date,
        file_name: prescriptions.file_name,
        file_mime: prescriptions.file_mime,
        notes: prescriptions.notes,
        status: prescriptions.status,
        created_at: prescriptions.created_at,
      })
      .from(prescriptions)
      .where(and(
        eq(prescriptions.patient_id, req.session.customerId),
        eq(prescriptions.status, 'active'),
      ))
      .orderBy(desc(prescriptions.created_at));
    return res.json(rows);
  } catch (err) {
    console.error('Customer prescriptions error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET /api/customer/prescriptions/:rxId/file ───────────────────────────────
router.get('/prescriptions/:rxId/file', async (req, res) => {
  try {
    const [rx] = await db.select().from(prescriptions)
      .where(eq(prescriptions.id, req.params.rxId)).limit(1);
    if (!rx || rx.patient_id !== req.session.customerId) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    if (!fs.existsSync(rx.file_path)) {
      return res.status(404).json({ error: 'FILE_NOT_FOUND' });
    }
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', rx.file_mime);
    res.setHeader('Content-Disposition', `${disposition}; filename="${rx.file_name}"`);
    fs.createReadStream(rx.file_path).pipe(res);
  } catch (err) {
    console.error('Customer prescription file error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── GET /api/customer/refills ────────────────────────────────────────────────
router.get('/refills', async (req, res) => {
  try {
    const rules = await db
      .select({
        id: reminder_rules.id,
        product_id: reminder_rules.product_id,
        interval_days: reminder_rules.interval_days,
        dosage_mg: reminder_rules.dosage_mg,
        dosage_freq: reminder_rules.dosage_freq,
        doses_per_freq: reminder_rules.doses_per_freq,
        last_fill_qty_mg: reminder_rules.last_fill_qty_mg,
        last_fill_date: reminder_rules.last_fill_date,
        last_reminded_at: reminder_rules.last_reminded_at,
        active: reminder_rules.active,
        created_at: reminder_rules.created_at,
        product_name: products.name,
        product_sku: products.sku,
      })
      .from(reminder_rules)
      .leftJoin(products, eq(reminder_rules.product_id, products.id))
      .where(eq(reminder_rules.patient_id, req.session.customerId));

    // Attach latest refill request per rule
    const enriched = await Promise.all(rules.map(async rule => {
      const [latest] = await db
        .select({
          id: refill_requests.id,
          status: refill_requests.status,
          proposed_ship_date: refill_requests.proposed_ship_date,
          created_at: refill_requests.created_at,
          responded_at: refill_requests.responded_at,
        })
        .from(refill_requests)
        .where(eq(refill_requests.rule_id, rule.id))
        .orderBy(desc(refill_requests.created_at))
        .limit(1);
      return { ...rule, latest_request: latest || null };
    }));

    return res.json(enriched);
  } catch (err) {
    console.error('Customer refills error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── POST /api/customer/refills/:ruleId/request ───────────────────────────────
router.post('/refills/:ruleId/request', async (req, res) => {
  try {
    const [rule] = await db.select().from(reminder_rules)
      .where(eq(reminder_rules.id, req.params.ruleId)).limit(1);
    if (!rule || rule.patient_id !== req.session.customerId) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    const [product] = await db.select().from(products)
      .where(eq(products.id, rule.product_id)).limit(1);
    const [patient] = await db
      .select({ name: patients.name, email: patients.email })
      .from(patients).where(eq(patients.id, req.session.customerId)).limit(1);

    try {
      await sendPatientRefillRequestToAdmin(patient, product, rule);
    } catch (mailErr) {
      console.error('Refill request admin notify failed (non-fatal):', mailErr.message);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Customer refill request error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── PATCH /api/customer/refills/:ruleId/pause ───────────────────────────────
router.patch('/refills/:ruleId/pause', async (req, res) => {
  try {
    const [rule] = await db.select().from(reminder_rules)
      .where(eq(reminder_rules.id, req.params.ruleId)).limit(1);
    if (!rule || rule.patient_id !== req.session.customerId) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    const [updated] = await db.update(reminder_rules)
      .set({ active: !rule.active })
      .where(eq(reminder_rules.id, rule.id))
      .returning();
    return res.json(updated);
  } catch (err) {
    console.error('Customer refill pause error:', err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

module.exports = router;
