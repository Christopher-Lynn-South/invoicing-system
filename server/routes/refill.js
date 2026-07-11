const express = require('express');
const { z } = require('zod');
const { db } = require('../db');
const {
  refill_requests, reminder_rules, patients, products,
  sales_orders, order_items,
} = require('../db/schema');
const { eq, sql } = require('drizzle-orm');
const {
  sendRefillConfirmedAdminNotification,
} = require('../services/mailer');

// Server-side address validation. FedEx rejects malformed states/zips so we
// need to catch bad input before we store it.
const refillAddrSchema = z.object({
  street:  z.string().trim().min(3, 'Street is required.').max(200),
  street2: z.string().trim().max(200).optional(),
  city:    z.string().trim().min(1, 'City is required.').max(100),
  state:   z.string().trim().length(2, 'Use the 2-letter state code (e.g. CA).').transform(v => v.toUpperCase()),
  zip:     z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'ZIP must be 5 digits or 5+4.'),
  country: z.string().trim().max(3).default('US').transform(v => (v || 'US').toUpperCase()),
});

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

// HTML-escape values interpolated into raw HTML pages (prevents stored XSS
// from patient names / product names / etc. that come from Zoho imports).
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only accept URL-safe token characters. Prevents attribute-break attacks
// via a crafted token in URLs that get echoed into HTML.
function safeToken(t) {
  return typeof t === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(t) ? t : '';
}

function htmlPage(title, body) {
  const company = esc(process.env.COMPANY_NAME || 'OrderFlow');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#f3f4f6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;padding:36px 32px;max-width:500px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.08)}
    .center{text-align:center}
    .icon{font-size:52px;margin-bottom:14px}
    h1{font-size:22px;color:#111827;margin-bottom:8px}
    h2{font-size:15px;font-weight:600;color:#374151;margin:20px 0 10px}
    p{color:#6b7280;font-size:14px;line-height:1.6;margin-bottom:8px}
    .addr-box{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.8;margin:12px 0 4px}
    label{display:block;font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}
    input{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;margin-bottom:12px;outline:none;transition:border .15s}
    input:focus{border-color:#2563eb}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .row3{display:grid;grid-template-columns:2fr 1fr 100px;gap:10px}
    .btn-confirm{width:100%;background:#16a34a;color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}
    .btn-confirm:hover{background:#15803d}
    .toggle{background:none;border:none;color:#2563eb;font-size:13px;cursor:pointer;padding:0;text-decoration:underline;margin-bottom:16px}
    .edit-section{display:none;margin-top:4px}
    .edit-section.open{display:block}
    .divider{border:none;border-top:1px solid #e5e7eb;margin:20px 0}
    .footer{margin-top:24px;font-size:12px;color:#9ca3af;text-align:center}
    .ship-date{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:14px;color:#1e40af;margin-bottom:16px}
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
  const result = await db.execute(sql`
    SELECT order_number FROM sales_orders
    WHERE order_number LIKE ${prefix + '%'}
    ORDER BY (regexp_replace(order_number, '.*-', '')::bigint) DESC
    LIMIT 1
  `);
  const rows = result.rows || result;
  return rows.length
    ? `${prefix}${String(parseInt(rows[0].order_number.split('-').pop(), 10) + 1).padStart(3, '0')}`
    : `${prefix}001`;
}


// ── Shared token validation helper ─────────────────────────────────────────────
async function loadPendingRequest(token, res) {
  const [request] = await db.select().from(refill_requests)
    .where(eq(refill_requests.token, token));

  if (!request) {
    res.status(404).send(htmlPage('Link Not Found',
      `<div class="center"><div class="icon">🔍</div><h1>Link Not Found</h1><p>This refill link is invalid or has already been used.</p></div>`));
    return null;
  }
  if (new Date() > new Date(request.token_expires_at)) {
    await db.update(refill_requests).set({ status: 'expired' }).where(eq(refill_requests.id, request.id));
    res.status(410).send(htmlPage('Link Expired',
      `<div class="center"><div class="icon">⏰</div><h1>This Link Has Expired</h1><p>Please contact us to request a new refill.</p></div>`));
    return null;
  }
  if (request.status === 'declined') {
    res.send(htmlPage('Already Declined',
      `<div class="center"><div class="icon">✋</div><h1>You already declined this refill</h1><p>Contact us if you changed your mind.</p></div>`));
    return null;
  }
  if (request.status === 'confirmed') {
    const [patient] = await db.select().from(patients).where(eq(patients.id, request.patient_id));
    const [product] = await db.select().from(products).where(eq(products.id, request.product_id));
    res.send(htmlPage('Refill Confirmed', `
      <div class="center">
        <div class="icon">✅</div>
        <h1>Already Confirmed!</h1>
        <p>Your ${esc(product.name)} refill request was received. Our team will send an invoice to ${esc(patient.email)} shortly.</p>
      </div>
    `));
    return null;
  }
  return request;
}

// ── GET /refill/confirm/:token — show address review form ──────────────────────
router.get('/confirm/:token', async (req, res) => {
  try {
    const token = safeToken(req.params.token);
    if (!token) return res.status(400).send(htmlPage('Invalid Link', `<div class="center"><div class="icon">⚠</div><h1>Invalid link</h1></div>`));

    const request = await loadPendingRequest(token, res);
    if (!request) return;

    const [patient] = await db.select().from(patients).where(eq(patients.id, request.patient_id));
    const [product] = await db.select().from(products).where(eq(products.id, request.product_id));

    const addr = request.ship_address || {};
    const shipDateLabel = request.proposed_ship_date
      ? `Proposed ship date: <strong>${esc(request.proposed_ship_date)}</strong>`
      : 'Ship date to be confirmed';

    return res.send(htmlPage('Confirm Your Refill', `
      <div class="center">
        <div class="icon">📦</div>
        <h1>Confirm Your Refill</h1>
        <p>Hi <strong>${esc(patient.name)}</strong>, please review your shipping address for your <strong>${esc(product.name)}</strong> refill, then confirm below.</p>
      </div>

      <div class="ship-date">🚚 ${shipDateLabel} · FedEx Priority Overnight</div>

      <form method="POST" action="/refill/confirm/${esc(token)}">
        <h2>Shipping Address</h2>

        <label>Street Address</label>
        <input type="text" name="street" value="${esc(addr.street)}" required placeholder="123 Main St" />

        <label>Apt / Suite / Unit <span style="font-weight:400;text-transform:none">(optional)</span></label>
        <input type="text" name="street2" value="${esc(addr.street2)}" placeholder="Apt 4B" />

        <div class="row3">
          <div>
            <label>City</label>
            <input type="text" name="city" value="${esc(addr.city)}" required placeholder="City" />
          </div>
          <div>
            <label>State</label>
            <input type="text" name="state" value="${esc(addr.state)}" required placeholder="CA" maxlength="2" />
          </div>
          <div>
            <label>ZIP</label>
            <input type="text" name="zip" value="${esc(addr.zip)}" required placeholder="90210" maxlength="10" />
          </div>
        </div>

        <label>Country</label>
        <input type="text" name="country" value="${esc(addr.country || 'US')}" required placeholder="US" maxlength="3" />

        <button type="submit" class="btn-confirm">✓ Confirm Refill &amp; Address</button>
      </form>
    `));

  } catch (err) {
    console.error('Refill confirm GET error:', err);
    return res.status(500).send(htmlPage('Error',
      `<div class="center"><div class="icon">⚠</div><h1>Something went wrong</h1><p>Please contact us to confirm your refill.</p></div>`));
  }
});

// ── POST /refill/confirm/:token — save address + create draft order ────────────
router.post('/confirm/:token', async (req, res) => {
  try {
    const token = safeToken(req.params.token);
    if (!token) return res.status(400).send(htmlPage('Invalid Link', `<div class="center"><div class="icon">⚠</div><h1>Invalid link</h1></div>`));

    const request = await loadPendingRequest(token, res);
    if (!request) return;

    const [patient] = await db.select().from(patients).where(eq(patients.id, request.patient_id));
    const [product] = await db.select().from(products).where(eq(products.id, request.product_id));

    // Server-side validate the form. On failure, re-render the confirm page
    // with the offending field messages so the customer can fix + retry.
    const parsed = refillAddrSchema.safeParse(req.body);
    if (!parsed.success) {
      const errs = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field && !errs[field]) errs[field] = issue.message;
      }
      const addr = {
        street:  req.body.street  || '',
        street2: req.body.street2 || '',
        city:    req.body.city    || '',
        state:   req.body.state   || '',
        zip:     req.body.zip     || '',
      };
      const errBar = (field) => errs[field]
        ? `<div style="font-size:12px;color:#dc2626;margin:-8px 0 8px">${esc(errs[field])}</div>`
        : '';
      return res.status(400).send(htmlPage('Please fix a few fields', `
        <div class="center">
          <div class="icon">✍️</div>
          <h1>Please fix a few fields</h1>
          <p>Hi ${esc(patient.name)}, your <strong>${esc(product.name)}</strong> refill address needs some corrections.</p>
        </div>
        <form method="POST" action="/refill/confirm/${esc(token)}">
          <h2>Shipping Address</h2>
          <label>Street Address</label>
          <input type="text" name="street" value="${esc(addr.street)}" required placeholder="123 Main St" />
          ${errBar('street')}
          <label>Apt / Suite / Unit <span style="font-weight:400;text-transform:none">(optional)</span></label>
          <input type="text" name="street2" value="${esc(addr.street2)}" placeholder="Apt 4B" />
          <div class="row3">
            <div><label>City</label>
              <input type="text" name="city" value="${esc(addr.city)}" required placeholder="City" />
              ${errBar('city')}
            </div>
            <div><label>State</label>
              <input type="text" name="state" value="${esc(addr.state)}" required placeholder="CA" maxlength="2" />
              ${errBar('state')}
            </div>
            <div><label>ZIP</label>
              <input type="text" name="zip" value="${esc(addr.zip)}" required placeholder="90210" maxlength="10" />
              ${errBar('zip')}
            </div>
          </div>
          <label>Country</label>
          <input type="text" name="country" value="US" required placeholder="US" maxlength="3" />
          <button type="submit" class="btn-confirm">✓ Confirm Refill &amp; Address</button>
        </form>
      `));
    }

    // Build confirmed address from validated data
    const ship_address = {
      street:  parsed.data.street,
      street2: parsed.data.street2 || undefined,
      city:    parsed.data.city,
      state:   parsed.data.state,
      zip:     parsed.data.zip,
      country: parsed.data.country,
    };

    // Save confirmed address back to request
    await db.update(refill_requests)
      .set({ ship_address })
      .where(eq(refill_requests.id, request.id));

    // Atomic order + line-item create with retry on order_number collision
    let order;
    const unit_price = parseFloat(product.unit_price);
    for (let attempt = 0; attempt < 5; attempt++) {
      const order_number = await generateOrderNumber();
      try {
        await db.transaction(async (tx) => {
          [order] = await tx.insert(sales_orders).values({
            order_number,
            patient_id: patient.id,
            status: 'draft',
            notes: `Refill confirmed by patient. Ship via FedEx Priority Overnight.\nRequested ship date: ${request.proposed_ship_date || 'TBD'}\nPlease review and send invoice.`,
            shipping_quote: {
              service_type: 'PRIORITY_OVERNIGHT',
              package_type: 'YOUR_PACKAGING',
              confirmed_address: ship_address,
              proposed_ship_date: request.proposed_ship_date,
            },
            updated_at: new Date(),
          }).returning();

          await tx.insert(order_items).values({
            order_id: order.id,
            product_id: product.id,
            quantity: 1,
            unit_price: unit_price.toFixed(2),
            line_total: unit_price.toFixed(2),
          });
        });
        break;
      } catch (err) {
        if (err.code !== '23505' || attempt === 4) throw err;
        await new Promise(r => setTimeout(r, 10 + Math.random() * 40));
      }
    }

    // Mark request confirmed
    await db.update(refill_requests)
      .set({ status: 'confirmed', order_id: order.id, responded_at: new Date() })
      .where(eq(refill_requests.id, request.id));

    // Update reminder rule
    await db.update(reminder_rules)
      .set({ last_order_id: order.id, last_reminded_at: new Date() })
      .where(eq(reminder_rules.id, request.rule_id));

    // Notify admin (non-fatal)
    try {
      await sendRefillConfirmedAdminNotification(patient, product, order, ship_address);
    } catch (notifyErr) {
      console.error('Admin notification failed (non-fatal):', notifyErr.message);
    }

    const addrLines = [
      ship_address.street,
      ship_address.street2,
      [ship_address.city, ship_address.state, ship_address.zip].filter(Boolean).join(', '),
      ship_address.country !== 'US' ? ship_address.country : null,
    ].filter(Boolean).map(esc).join('<br>');

    return res.send(htmlPage('Refill Confirmed!', `
      <div class="center">
        <div class="icon">✅</div>
        <h1>You're all set!</h1>
        <p>Thank you, <strong>${esc(patient.name)}</strong>! Your <strong>${esc(product.name)}</strong> refill has been confirmed.</p>
      </div>
      <hr class="divider">
      <h2>Shipping to</h2>
      <div class="addr-box">${addrLines}</div>
      <p style="margin-top:12px">Our team will review your order and send an invoice to <strong>${esc(patient.email)}</strong> shortly.</p>
      <p style="margin-top:8px;font-size:12px;color:#9ca3af">Order ${esc(order.order_number)}</p>
    `));

  } catch (err) {
    console.error('Refill confirm POST error:', err);
    return res.status(500).send(htmlPage('Error',
      `<div class="center"><div class="icon">⚠</div><h1>Something went wrong</h1><p>Please contact us to confirm your refill.</p></div>`));
  }
});

// ── GET /refill/decline/:token ─────────────────────────────────────────────────
router.get('/decline/:token', async (req, res) => {
  try {
    const token = safeToken(req.params.token);
    if (!token) return res.status(400).send(htmlPage('Invalid Link', `<div class="center"><div class="icon">⚠</div><h1>Invalid link</h1></div>`));

    const [request] = await db.select().from(refill_requests)
      .where(eq(refill_requests.token, token));

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
