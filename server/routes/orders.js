const express = require('express');
const { db } = require('../db');
const {
  sales_orders, order_items, products, patients, invoices,
  shipments, shipment_events, prescriptions,
} = require('../db/schema');
const { eq, desc, and, inArray, sql } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');
const { validate, orderSchema, shipSchema } = require('../middleware/validate');
const fedexService = require('../services/fedex');
const crypto = require('crypto');
const { sendShippingNotification, sendInvoiceEmail } = require('../services/mailer');
const { sendInvoiceSMS, sendShippingSMS } = require('../services/sms');

function generatePayToken() { return crypto.randomBytes(32).toString('hex'); }
function payTokenExpiresAt(days = 3) { const d = new Date(); d.setDate(d.getDate() + days); return d; }
const { generateInvoicePDF } = require('../services/pdf');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  const result = await db.execute(
    sql`SELECT order_number FROM sales_orders WHERE order_number LIKE ${prefix + '%'} ORDER BY order_number DESC LIMIT 1`
  );
  const rows = result.rows || result;
  if (!rows.length) return `${prefix}001`;
  const last = rows[0].order_number;
  const num = parseInt(last.split('-')[2], 10) + 1;
  return `${prefix}${String(num).padStart(3, '0')}`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/orders
router.get('/', requireLogin, async (req, res) => {
  try {
    const { status, patient_id } = req.query;
    let query = db.select({
      order: sales_orders,
      patient_name: patients.name,
      patient_email: patients.email,
    })
      .from(sales_orders)
      .leftJoin(patients, eq(sales_orders.patient_id, patients.id));

    const conditions = [];
    if (status) conditions.push(eq(sales_orders.status, status));
    if (patient_id) conditions.push(eq(sales_orders.patient_id, patient_id));
    if (conditions.length) query = query.where(and(...conditions));

    const rows = await query.orderBy(desc(sales_orders.created_at));
    return res.json(rows.map(r => ({ ...r.order, patient_name: r.patient_name, patient_email: r.patient_email })));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/orders
router.post('/', requireLogin, validate(orderSchema), async (req, res) => {
  try {
    const { patient_id, items, notes } = req.validated;

    // Check patient exists
    const [patient] = await db.select().from(patients).where(eq(patients.id, patient_id));
    if (!patient) return res.status(404).json({ error: 'PATIENT_NOT_FOUND' });

    // Check prescription gate
    if (patient.requires_prescription) {
      const today = new Date().toISOString().split('T')[0];
      const rxRows = await db.select().from(prescriptions)
        .where(eq(prescriptions.patient_id, patient_id));
      const activeRx = rxRows.find(r =>
        r.status === 'active' && (r.expiry_date === null || r.expiry_date >= today)
      );
      if (!activeRx) {
        return res.status(422).json({
          error: 'PRESCRIPTION_REQUIRED',
          message: 'An active prescription is required before creating an order for this patient.',
        });
      }
    }

    // Load products to get prices
    const productIds = items.map(i => i.product_id);
    const productRows = await db.select().from(products)
      .where(inArray(products.id, productIds));
    const productMap = Object.fromEntries(productRows.map(p => [p.id, p]));

    for (const item of items) {
      if (!productMap[item.product_id]) {
        return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', product_id: item.product_id });
      }
    }

    const order_number = await generateOrderNumber();

    const [order] = await db.insert(sales_orders).values({
      order_number,
      patient_id,
      status: 'draft',
      notes,
    }).returning();

    const itemRows = items.map(item => {
      const product = productMap[item.product_id];
      const unit_price = parseFloat(product.unit_price);
      const line_total = (unit_price * item.quantity).toFixed(2);
      return {
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: unit_price.toFixed(2),
        line_total,
      };
    });

    const insertedItems = await db.insert(order_items).values(itemRows).returning();

    return res.status(201).json({ ...order, items: insertedItems });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/orders/:id
router.get('/:id', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const items = await db.select({
      item: order_items,
      product_name: products.name,
      product_sku: products.sku,
    })
      .from(order_items)
      .leftJoin(products, eq(order_items.product_id, products.id))
      .where(eq(order_items.order_id, order.id));

    const [invoice] = await db.select().from(invoices).where(eq(invoices.order_id, order.id));
    const [shipment] = await db.select().from(shipments).where(eq(shipments.order_id, order.id));

    let tracking_events = [];
    if (shipment) {
      tracking_events = await db.select().from(shipment_events)
        .where(eq(shipment_events.shipment_id, shipment.id))
        .orderBy(desc(shipment_events.event_timestamp));
    }

    return res.json({
      ...order,
      patient,
      items: items.map(r => ({ ...r.item, product_name: r.product_name, product_sku: r.product_sku })),
      invoice: invoice || null,
      shipment: shipment ? { ...shipment, events: tracking_events } : null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// DELETE /api/orders/:id (cancel draft only)
router.delete('/:id', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });
    if (order.status !== 'draft') {
      return res.status(400).json({ error: 'CANNOT_CANCEL', message: 'Only draft orders can be cancelled.' });
    }
    const [updated] = await db.update(sales_orders)
      .set({ status: 'cancelled', updated_at: new Date() })
      .where(eq(sales_orders.id, req.params.id))
      .returning();
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Shipping ─────────────────────────────────────────────────────────────────

// POST /api/orders/:id/ship
router.post('/:id/ship', requireLogin, validate(shipSchema), async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const [invoice] = await db.select().from(invoices).where(eq(invoices.order_id, order.id));
    if (!invoice || invoice.pay_status !== 'paid') {
      return res.status(403).json({
        error: 'INVOICE_NOT_PAID',
        message: 'Invoice must be paid before generating a shipping label.',
      });
    }

    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const { service, weight_lbs, dimensions, recipient_name, recipient_street,
      recipient_city, recipient_state, recipient_zip, recipient_country } = req.validated;

    const labelResult = await fedexService.createShipment({
      service_type: service,
      weight_lbs,
      dimensions,
      recipient: {
        name: recipient_name || patient.name,
        street: recipient_street || patient.billing_address?.street || '',
        city: recipient_city || patient.billing_address?.city || '',
        state: recipient_state || patient.billing_address?.state || '',
        zip: recipient_zip || patient.billing_address?.zip || '',
        country: recipient_country || patient.billing_address?.country || 'MX',
      },
    });

    // Save label PDF
    const labelsDir = path.join(__dirname, '../../uploads/labels');
    fs.mkdirSync(labelsDir, { recursive: true });
    const labelPath = path.join(labelsDir, `${order.id}.pdf`);
    if (labelResult.labelData) {
      fs.writeFileSync(labelPath, Buffer.from(labelResult.labelData, 'base64'));
    }

    const [shipment] = await db.insert(shipments).values({
      order_id: order.id,
      fedex_tracking_number: labelResult.trackingNumber,
      service_type: service,
      weight_lbs: weight_lbs.toString(),
      dimensions_json: dimensions,
      label_pdf_url: `/uploads/labels/${order.id}.pdf`,
      ship_date: new Date().toISOString().split('T')[0],
      estimated_delivery: labelResult.estimatedDelivery || null,
      status: 'label_created',
      latest_status: 'Label Created',
      polling_active: true,
    }).returning();

    await db.update(sales_orders)
      .set({ status: 'shipped', updated_at: new Date() })
      .where(eq(sales_orders.id, order.id));

    // Send shipping notification email
    try {
      await sendShippingNotification(patient, order, shipment);
    } catch (mailErr) {
      console.error('Shipping email failed:', mailErr.message);
    }

    return res.json(shipment);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/orders/:id/label
router.get('/:id/label', requireLogin, async (req, res) => {
  try {
    const labelPath = path.join(__dirname, '../../uploads/labels', `${req.params.id}.pdf`);
    if (!fs.existsSync(labelPath)) return res.status(404).json({ error: 'LABEL_NOT_FOUND' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="label-${req.params.id}.pdf"`);
    fs.createReadStream(labelPath).pipe(res);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/orders/:id/tracking
router.get('/:id/tracking', requireLogin, async (req, res) => {
  try {
    const [shipment] = await db.select().from(shipments).where(eq(shipments.order_id, req.params.id));
    if (!shipment) return res.status(404).json({ error: 'NO_SHIPMENT' });

    const events = await db.select().from(shipment_events)
      .where(eq(shipment_events.shipment_id, shipment.id))
      .orderBy(desc(shipment_events.event_timestamp));

    return res.json({ shipment, events });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/orders/:id/tracking/refresh
router.post('/:id/tracking/refresh', requireLogin, async (req, res) => {
  try {
    const [shipment] = await db.select().from(shipments).where(eq(shipments.order_id, req.params.id));
    if (!shipment) return res.status(404).json({ error: 'NO_SHIPMENT' });

    const trackingJob = require('../jobs/tracking.cron');
    await trackingJob.pollShipment(shipment);

    const events = await db.select().from(shipment_events)
      .where(eq(shipment_events.shipment_id, shipment.id))
      .orderBy(desc(shipment_events.event_timestamp));

    return res.json({ ok: true, events });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// POST /api/orders/:id/resend-invoice  — resend invoice email + SMS
router.post('/:id/resend-invoice', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const existing = await db.select().from(invoices).where(eq(invoices.order_id, order.id));
    if (!existing.length) return res.status(404).json({ error: 'NO_INVOICE', message: 'No invoice exists for this order.' });

    // Regenerate token — gives patient a fresh 3-day window from now
    const [invoice] = await db.update(invoices)
      .set({ pay_token: generatePayToken(), pay_token_expires_at: payTokenExpiresAt(3) })
      .where(eq(invoices.order_id, order.id))
      .returning();

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

// POST /api/orders/:id/resend-shipping  — resend shipping notification email + SMS
router.post('/:id/resend-shipping', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const [shipment] = await db.select().from(shipments).where(eq(shipments.order_id, order.id));
    if (!shipment) return res.status(404).json({ error: 'NO_SHIPMENT', message: 'No shipment exists for this order.' });

    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));

    const sent = { email: false, sms: false };

    try {
      await sendShippingNotification(patient, order, shipment);
      sent.email = true;
    } catch (err) {
      console.error('Resend shipping email failed:', err.message);
    }

    try {
      sent.sms = await sendShippingSMS(patient, order, shipment);
    } catch (err) {
      console.error('Resend shipping SMS failed:', err.message);
    }

    return res.json({ ok: true, sent });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

module.exports = router;
