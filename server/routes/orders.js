const express = require('express');
const { db } = require('../db');
const {
  sales_orders, order_items, products, patients, invoices,
  shipments, shipment_events, prescriptions,
} = require('../db/schema');
const { eq, desc, and, inArray, sql } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');
const { validate, orderSchema, shipSchema, updateItemsSchema } = require('../middleware/validate');
const { generateInvoicePDF } = require('../services/pdf');
const fedexService = require('../services/fedex');
const { SERVICE_VALID_PACKAGES } = fedexService;
const crypto = require('crypto');
const { sendShippingNotification, sendInvoiceEmail, sendCustomEmail } = require('../services/mailer');
const { sendInvoiceSMS, sendShippingSMS, sendCustomSMS } = require('../services/sms');
const { renderAllForOrder } = require('../services/email-templates');

function generatePayToken() { return crypto.randomBytes(32).toString('hex'); }
function payTokenExpiresAt(days = 3) { const d = new Date(); d.setDate(d.getDate() + days); return d; }
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
    const { service, box_type, weight_lbs, length_in, width_in, height_in,
      recipient_name, recipient_street, recipient_city, recipient_state,
      recipient_zip, recipient_country } = req.validated;

    const addr = patient.billing_address || {};
    const labelResult = await fedexService.createShipment({
      service_type: service,
      box_type,
      weight_lbs,
      length_in: length_in || undefined,
      width_in:  width_in  || undefined,
      height_in: height_in || undefined,
      recipient: {
        name:    recipient_name    || patient.name,
        phone:   patient.phone     || undefined,
        street:  recipient_street  || addr.street  || '',
        city:    recipient_city    || addr.city    || '',
        state:   recipient_state   || addr.state   || '',
        zip:     recipient_zip     || addr.zip     || '',
        country: recipient_country || addr.country || 'US',
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
      dimensions_json: { box_type, length_in: length_in || null, width_in: width_in || null, height_in: height_in || null },
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
    if (err.response) {
      // FedEx returned an error — log the full body so we can see the exact reason
      console.error('FedEx API error status:', err.response.status);
      console.error('FedEx API error body:', JSON.stringify(err.response.data, null, 2));
      return res.status(502).json({
        error: 'FEDEX_ERROR',
        status: err.response.status,
        details: err.response.data,
      });
    }
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

// POST /api/orders/:id/rate-quote — get FedEx rate quotes for package+weight+address
router.post('/:id/rate-quote', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const { package_type, weight_lbs, length_in, width_in, height_in,
      recipient_street, recipient_city, recipient_state, recipient_zip, recipient_country } = req.body;

    if (!package_type || !weight_lbs) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'package_type and weight_lbs are required.' });
    }
    if (package_type === 'YOUR_PACKAGING' && (!length_in || !width_in || !height_in)) {
      return res.status(400).json({ error: 'DIMENSIONS_REQUIRED', message: 'L×W×H dimensions are required for YOUR_PACKAGING.' });
    }

    const addr = patient.billing_address || {};
    const recipient = {
      street:  recipient_street  || addr.street  || '',
      city:    recipient_city    || addr.city    || '',
      state:   recipient_state   || addr.state   || '',
      zip:     recipient_zip     || addr.zip     || '',
      country: recipient_country || addr.country || 'US',
    };

    if (!recipient.zip) {
      return res.status(400).json({
        error: 'ADDRESS_INCOMPLETE',
        message: 'Patient is missing a zip/postal code. Please update the patient address before requesting rates.',
      });
    }
    if (!recipient.country) {
      return res.status(400).json({
        error: 'ADDRESS_INCOMPLETE',
        message: 'Patient is missing a country. Please update the patient address before requesting rates.',
      });
    }

    const rates = await fedexService.getRates({ package_type, weight_lbs, length_in, width_in, height_in, recipient });
    return res.json({ rates, valid_packages: SERVICE_VALID_PACKAGES });
  } catch (err) {
    if (err.response) {
      console.error('FedEx rate error:', JSON.stringify(err.response.data, null, 2));
      return res.status(502).json({ error: 'FEDEX_ERROR', details: err.response.data });
    }
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// PATCH /api/orders/:id/shipping-quote — save a selected rate quote to the order
// Also recalculates the invoice total if an unpaid invoice exists.
router.patch('/:id/shipping-quote', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const { service_type, package_type, weight_lbs, length_in, width_in, height_in,
      net_charge, currency, transit_days, delivery_date } = req.body;

    if (!service_type || !package_type || !weight_lbs || net_charge == null) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }

    const shipping_quote = {
      service_type, package_type,
      weight_lbs: parseFloat(weight_lbs),
      length_in: length_in ? parseInt(length_in) : null,
      width_in:  width_in  ? parseInt(width_in)  : null,
      height_in: height_in ? parseInt(height_in) : null,
      net_charge: parseFloat(net_charge).toFixed(2),
      currency: currency || 'USD',
      transit_days: transit_days || null,
      delivery_date: delivery_date || null,
      quoted_at: new Date().toISOString(),
    };

    const [updatedOrder] = await db.update(sales_orders)
      .set({ shipping_quote, updated_at: new Date() })
      .where(eq(sales_orders.id, order.id))
      .returning();

    // Recalculate unpaid invoice if one exists
    const [invoice] = await db.select().from(invoices).where(eq(invoices.order_id, order.id));
    if (invoice && invoice.pay_status !== 'paid') {
      const shipping = parseFloat(net_charge);
      const subtotal = parseFloat(invoice.subtotal);
      const fee = parseFloat(invoice.processing_fee || 0);
      const newTotal = (subtotal + shipping + fee).toFixed(2);

      const [updatedInvoice] = await db.update(invoices)
        .set({ shipping_charge: shipping.toFixed(2), total: newTotal, updated_at: new Date() })
        .where(eq(invoices.id, invoice.id))
        .returning();

      // Regenerate PDF
      try {
        const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
        const items = await db.select({ item: order_items, product_name: products.name })
          .from(order_items).leftJoin(products, eq(order_items.product_id, products.id))
          .where(eq(order_items.order_id, order.id));
        const invoicesDir = path.join(__dirname, '../../uploads/invoices');
        await generateInvoicePDF({
          invoice: updatedInvoice, order: updatedOrder, patient,
          items: items.map(r => ({ ...r.item, product_name: r.product_name })),
        }, path.join(invoicesDir, `${invoice.id}.pdf`));
      } catch (pdfErr) { console.error('PDF regen failed:', pdfErr.message); }
    }

    return res.json({ ok: true, order: updatedOrder });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// PATCH /api/orders/:id/items — replace line items (draft/pending_payment + unpaid only)
router.patch('/:id/items', requireLogin, validate(updateItemsSchema), async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    if (!['draft', 'pending_payment'].includes(order.status)) {
      return res.status(400).json({ error: 'CANNOT_EDIT', message: 'Only draft or pending_payment orders can be edited.' });
    }

    const [invoice] = await db.select().from(invoices).where(eq(invoices.order_id, order.id));
    if (invoice && invoice.pay_status === 'paid') {
      return res.status(400).json({ error: 'INVOICE_PAID', message: 'Cannot edit items on a paid order.' });
    }

    const { items } = req.validated;
    const productIds = items.map(i => i.product_id);
    const productRows = await db.select().from(products).where(inArray(products.id, productIds));
    const productMap = Object.fromEntries(productRows.map(p => [p.id, p]));

    for (const item of items) {
      if (!productMap[item.product_id]) {
        return res.status(404).json({ error: 'PRODUCT_NOT_FOUND', product_id: item.product_id });
      }
    }

    // Replace all line items
    await db.delete(order_items).where(eq(order_items.order_id, order.id));

    const itemRows = items.map(item => {
      const product = productMap[item.product_id];
      const unit_price = parseFloat(product.unit_price);
      const line_total = (unit_price * item.quantity).toFixed(2);
      return { order_id: order.id, product_id: item.product_id, quantity: item.quantity, unit_price: unit_price.toFixed(2), line_total };
    });

    const insertedItems = await db.insert(order_items).values(itemRows).returning();

    // Recalculate invoice and regenerate PDF if invoice exists
    if (invoice) {
      const subtotal = insertedItems.reduce((sum, i) => sum + parseFloat(i.line_total), 0);
      const fee = parseFloat(invoice.processing_fee || 0);
      const total = (subtotal + fee).toFixed(2);

      const [updatedInvoice] = await db.update(invoices)
        .set({ subtotal: subtotal.toFixed(2), total, updated_at: new Date() })
        .where(eq(invoices.id, invoice.id))
        .returning();

      try {
        const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
        const invoicesDir = path.join(__dirname, '../../uploads/invoices');
        const pdfPath = path.join(invoicesDir, `${invoice.id}.pdf`);
        await generateInvoicePDF({
          invoice: updatedInvoice,
          order,
          patient,
          items: insertedItems.map(i => ({ ...i, product_name: productMap[i.product_id].name })),
        }, pdfPath);
      } catch (pdfErr) {
        console.error('PDF regeneration failed:', pdfErr.message);
      }
    }

    const newItems = await db.select({
      item: order_items,
      product_name: products.name,
      product_sku: products.sku,
    })
      .from(order_items)
      .leftJoin(products, eq(order_items.product_id, products.id))
      .where(eq(order_items.order_id, order.id));

    return res.json({ items: newItems.map(r => ({ ...r.item, product_name: r.product_name, product_sku: r.product_sku })) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/orders/:id/email-templates — rendered templates for this order
router.get('/:id/email-templates', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
    const [invoice] = await db.select().from(invoices).where(eq(invoices.order_id, order.id));
    const [shipment] = await db.select().from(shipments).where(eq(shipments.order_id, order.id));

    return res.json(renderAllForOrder({ order, patient, invoice: invoice || null, shipment: shipment || null }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/orders/:id/notes  — append a staff note to the order
router.post('/:id/notes', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const note = (req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: 'NOTE_REQUIRED' });

    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const entry = `[Staff ${timestamp}]: ${note}`;
    const newNotes = order.notes ? `${order.notes}\n${entry}` : entry;

    const [updated] = await db.update(sales_orders)
      .set({ notes: newNotes, updated_at: new Date() })
      .where(eq(sales_orders.id, req.params.id))
      .returning();

    return res.json({ ok: true, notes: updated.notes });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/orders/:id/send-email  — send email and/or SMS to the patient
// channels: 'email' | 'sms' | 'both'  (default: 'email')
router.post('/:id/send-email', requireLogin, async (req, res) => {
  try {
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, req.params.id));
    if (!order) return res.status(404).json({ error: 'NOT_FOUND' });

    const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));

    const subject = (req.body.subject || '').trim();
    const body = (req.body.body || '').trim();
    const channels = ['email', 'sms', 'both'].includes(req.body.channels) ? req.body.channels : 'email';

    if (!body) return res.status(400).json({ error: 'BODY_REQUIRED' });
    if ((channels === 'email' || channels === 'both') && !subject) {
      return res.status(400).json({ error: 'SUBJECT_REQUIRED' });
    }

    const sent = { email: false, sms: false };

    if (channels === 'email' || channels === 'both') {
      if (!patient?.email) return res.status(400).json({ error: 'NO_EMAIL', message: 'Patient has no email address on file.' });
      await sendCustomEmail(patient, order, { subject, body });
      sent.email = true;
    }

    if (channels === 'sms' || channels === 'both') {
      sent.sms = await sendCustomSMS(patient, order, body);
    }

    // Auto-log a note
    const channelDesc = [sent.email && 'email', sent.sms && 'SMS'].filter(Boolean).join('+') || channels;
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
    const entry = `[Staff ${timestamp}]: Message sent via ${channelDesc}${subject ? ` — "${subject}"` : ''}`;
    const newNotes = order.notes ? `${order.notes}\n${entry}` : entry;
    await db.update(sales_orders)
      .set({ notes: newNotes, updated_at: new Date() })
      .where(eq(sales_orders.id, req.params.id));

    return res.json({ ok: true, sent });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

module.exports = router;
