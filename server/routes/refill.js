const express = require('express');
const { db } = require('../db');
const {
  refill_requests, reminder_rules, patients, products,
  sales_orders, order_items,
} = require('../db/schema');
const { eq, sql } = require('drizzle-orm');
const {
  sendRefillConfirmedAdminNotification,
} = require('../services/mailer');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function htmlPage(title, body) {
  const company = process.env.COMPANY_NAME || 'OrderFlow';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#f3f4f6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;padding:40px 32px;max-width:480px;width:100%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.08)}
    .icon{font-size:56px;margin-bottom:16px}
    h1{font-size:22px;color:#111827;margin-bottom:10px}
    p{color:#6b7280;font-size:15px;line-height:1.6;margin-bottom:10px}
    .addr{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;text-align:left;font-size:14px;line-height:1.7;margin:16px 0}
    .footer{margin-top:24px;font-size:12px;color:#9ca3af}
  </style>
</head>
<body>
  <div class="card">${body}<div class="footer">${company}</div></div>
</body>
</html>`;
}

async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  const result = await db.execute(
    sql`SELECT order_number FROM sales_orders WHERE order_number LIKE ${prefix + '%'} ORDER BY order_number DESC LIMIT 1`
  );
  const rows = result.rows || result;
  return rows.length
    ? `${prefix}${String(parseInt(rows[0].order_number.split('-')[2], 10) + 1).padStart(3, '0')}`
    : `${prefix}001`;
}


// ── GET /refill/confirm/:token ─────────────────────────────────────────────────
router.get('/confirm/:token', async (req, res) => {
  try {
    const [request] = await db.select().from(refill_requests)
      .where(eq(refill_requests.token, req.params.token));

    if (!request) {
      return res.status(404).send(htmlPage('Link Not Found',
        `<div class="icon">🔍</div><h1>Link Not Found</h1><p>This refill link is invalid or has already been used.</p>`));
    }

    if (new Date() > new Date(request.token_expires_at)) {
      await db.update(refill_requests).set({ status: 'expired' }).where(eq(refill_requests.id, request.id));
      return res.status(410).send(htmlPage('Link Expired',
        `<div class="icon">⏰</div><h1>This Link Has Expired</h1><p>Please contact us to request a new refill.</p>`));
    }

    if (request.status === 'declined') {
      return res.send(htmlPage('Already Declined',
        `<div class="icon">✋</div><h1>You already declined this refill</h1><p>Contact us if you changed your mind.</p>`));
    }

    // Already confirmed — idempotent: just show success
    if (request.status === 'confirmed') {
      const [patient] = await db.select().from(patients).where(eq(patients.id, request.patient_id));
      const [product] = await db.select().from(products).where(eq(products.id, request.product_id));
      return res.send(htmlPage('Refill Confirmed', `
        <div class="icon">✅</div>
        <h1>Already Confirmed!</h1>
        <p>Your ${product.name} refill request was received. Our team is reviewing your order and will send an invoice shortly to ${patient.email}.</p>
      `));
    }

    // ── First confirmation — create draft sales order only ──────────────────
    const [patient] = await db.select().from(patients).where(eq(patients.id, request.patient_id));
    const [product] = await db.select().from(products).where(eq(products.id, request.product_id));
    const [rule] = await db.select().from(reminder_rules).where(eq(reminder_rules.id, request.rule_id));

    // Create sales order in draft — admin reviews before sending invoice
    const order_number = await generateOrderNumber();
    const [order] = await db.insert(sales_orders).values({
      order_number,
      patient_id: patient.id,
      status: 'draft',
      notes: `Refill confirmed by patient. Ship via FedEx Priority Overnight.\nRequested ship date: ${request.proposed_ship_date || 'TBD'}\nPlease review and send invoice.`,
      shipping_quote: {
        service_type: 'PRIORITY_OVERNIGHT',
        package_type: 'YOUR_PACKAGING',
        confirmed_address: request.ship_address,
        proposed_ship_date: request.proposed_ship_date,
      },
      updated_at: new Date(),
    }).returning();

    // Add line item
    const unit_price = parseFloat(product.unit_price);
    await db.insert(order_items).values({
      order_id: order.id,
      product_id: product.id,
      quantity: 1,
      unit_price: unit_price.toFixed(2),
      line_total: unit_price.toFixed(2),
    });

    // Update refill request
    await db.update(refill_requests)
      .set({ status: 'confirmed', order_id: order.id, responded_at: new Date() })
      .where(eq(refill_requests.id, request.id));

    // Update reminder rule's last order
    await db.update(reminder_rules)
      .set({ last_order_id: order.id, last_reminded_at: new Date() })
      .where(eq(reminder_rules.id, request.rule_id));

    // Notify admin to review and send invoice
    try {
      await sendRefillConfirmedAdminNotification(patient, product, order, request.ship_address);
    } catch (notifyErr) {
      console.error('Admin notification failed (non-fatal):', notifyErr.message);
    }

    const addr = request.ship_address;
    const addrHtml = addr
      ? `<div class="addr">${[addr.street, addr.street2, [addr.city, addr.state, addr.zip].filter(Boolean).join(', '), addr.country].filter(Boolean).join('<br>')}</div>`
      : '';

    return res.send(htmlPage('Refill Confirmed!', `
      <div class="icon">✅</div>
      <h1>Refill Confirmed!</h1>
      <p>Thank you, <strong>${patient.name}</strong>! We've received your ${product.name} refill request.</p>
      ${addrHtml}
      <p>Our team will review your order and send an invoice to <strong>${patient.email}</strong> shortly.</p>
      <p style="margin-top:8px;font-size:13px;color:#9ca3af">Order ${order.order_number}</p>
    `));

  } catch (err) {
    console.error('Refill confirm error:', err);
    return res.status(500).send(htmlPage('Error',
      `<div class="icon">⚠</div><h1>Something went wrong</h1><p>Please contact us to confirm your refill.</p>`));
  }
});

// ── GET /refill/decline/:token ─────────────────────────────────────────────────
router.get('/decline/:token', async (req, res) => {
  try {
    const [request] = await db.select().from(refill_requests)
      .where(eq(refill_requests.token, req.params.token));

    if (!request) {
      return res.status(404).send(htmlPage('Link Not Found',
        `<div class="icon">🔍</div><h1>Link Not Found</h1><p>This refill link is invalid.</p>`));
    }

    if (request.status !== 'pending') {
      return res.send(htmlPage('Already Responded',
        `<div class="icon">✋</div><h1>Already responded</h1><p>We have your response on file. Contact us if you need help.</p>`));
    }

    await db.update(refill_requests)
      .set({ status: 'declined', responded_at: new Date() })
      .where(eq(refill_requests.id, request.id));

    return res.send(htmlPage('No Problem!', `
      <div class="icon">👍</div>
      <h1>No Problem!</h1>
      <p>We've noted that you don't need a refill right now. We'll reach out again when it's time.</p>
      <p>Contact us anytime if you change your mind.</p>
    `));
  } catch (err) {
    console.error('Refill decline error:', err);
    return res.status(500).send(htmlPage('Error',
      `<div class="icon">⚠</div><h1>Something went wrong</h1><p>Please contact us directly.</p>`));
  }
});

module.exports = router;
