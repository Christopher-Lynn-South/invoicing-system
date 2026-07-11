const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { reminder_rules, reminder_logs, patients, products, sales_orders, shipments, refill_requests } = require('../db/schema');
const { eq, and, desc, sql } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');
const { validate, reminderSchema } = require('../middleware/validate');
const { sendReminderEmail, sendRefillRequestEmail, sendRefillRequestSMS } = require('../services/mailer');

const router = express.Router();

// Calculate days supply from dosage fields
function calcDaysSupply(rule) {
  const { dosage_mg, dosage_freq, doses_per_freq, last_fill_qty_mg } = rule;
  if (!dosage_mg || !dosage_freq || !last_fill_qty_mg) return null;
  const timesPerFreq = parseFloat(doses_per_freq || 1);
  const dailyMg = parseFloat(dosage_mg) * timesPerFreq * (dosage_freq === 'weekly' ? 1 / 7 : 1);
  if (dailyMg <= 0) return null;
  return Math.floor(parseFloat(last_fill_qty_mg) / dailyMg);
}

async function enrichRule(rule) {
  const today = new Date().toISOString().split('T')[0];
  let next_due = null;
  let days_supply = null;

  // Prefer dosage-based calculation if fill date + dosage info are available
  if (rule.last_fill_date && rule.dosage_mg && rule.last_fill_qty_mg) {
    days_supply = calcDaysSupply(rule);
    if (days_supply !== null) {
      const fillDate = new Date(rule.last_fill_date);
      fillDate.setDate(fillDate.getDate() + days_supply - 7); // 7-day early warning
      next_due = fillDate.toISOString().split('T')[0];
    }
  } else if (rule.last_order_id) {
    // Fall back to order-based interval
    const [order] = await db.select().from(sales_orders).where(eq(sales_orders.id, rule.last_order_id));
    if (order) {
      const d = new Date(order.created_at);
      d.setDate(d.getDate() + rule.interval_days);
      next_due = d.toISOString().split('T')[0];
    }
  }

  const overdue = next_due && next_due < today;
  const due_soon = next_due && !overdue && next_due <= new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

  return { ...rule, next_due, overdue, due_soon, days_supply };
}

// GET /api/reminders
router.get('/', requireLogin, async (req, res) => {
  try {
    const rows = await db.select({
      rule: reminder_rules,
      patient_name: patients.name,
      patient_email: patients.email,
      product_name: products.name,
    })
      .from(reminder_rules)
      .leftJoin(patients, eq(reminder_rules.patient_id, patients.id))
      .leftJoin(products, eq(reminder_rules.product_id, products.id))
      .orderBy(desc(reminder_rules.created_at));

    const enriched = await Promise.all(
      rows.map(async r => {
        const e = await enrichRule(r.rule);
        return { ...e, patient_name: r.patient_name, patient_email: r.patient_email, product_name: r.product_name };
      })
    );

    enriched.sort((a, b) => {
      if (a.overdue && !b.overdue) return -1;
      if (!a.overdue && b.overdue) return 1;
      if (a.due_soon && !b.due_soon) return -1;
      if (!a.due_soon && b.due_soon) return 1;
      return 0;
    });

    return res.json(enriched);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// GET /api/reminders/patient/:patientId
router.get('/patient/:patientId', requireLogin, async (req, res) => {
  try {
    const rows = await db.select({
      rule: reminder_rules,
      product_name: products.name,
      product_sku: products.sku,
    })
      .from(reminder_rules)
      .leftJoin(products, eq(reminder_rules.product_id, products.id))
      .where(eq(reminder_rules.patient_id, req.params.patientId));

    const enriched = await Promise.all(rows.map(async r => {
      const e = await enrichRule(r.rule);
      return { ...e, product_name: r.product_name, product_sku: r.product_sku };
    }));
    return res.json(enriched);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/reminders
router.post('/', requireLogin, validate(reminderSchema), async (req, res) => {
  try {
    const data = { ...req.validated };
    // Auto-calculate interval_days from dosage if not explicitly provided
    if (!data.interval_days) {
      const ds = calcDaysSupply(data);
      data.interval_days = ds || 30; // default 30 if can't calculate
    }
    const [row] = await db.insert(reminder_rules).values(data).returning();
    return res.status(201).json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// PUT /api/reminders/:id
router.put('/:id', requireLogin, validate(reminderSchema.partial()), async (req, res) => {
  try {
    const [row] = await db.update(reminder_rules).set(req.validated)
      .where(eq(reminder_rules.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    return res.json(row);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/reminders/:id/send  (manually trigger)
router.post('/:id/send', requireLogin, async (req, res) => {
  try {
    const [rule] = await db.select().from(reminder_rules).where(eq(reminder_rules.id, req.params.id));
    if (!rule) return res.status(404).json({ error: 'NOT_FOUND' });

    const [patient] = await db.select().from(patients).where(eq(patients.id, rule.patient_id));
    const [product] = await db.select().from(products).where(eq(products.id, rule.product_id));

    await sendReminderEmail(patient, product, rule);

    await db.insert(reminder_logs).values({
      rule_id: rule.id,
      channel: 'email',
    });

    await db.update(reminder_rules)
      .set({ last_reminded_at: new Date() })
      .where(eq(reminder_rules.id, rule.id));

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/reminders/:id/requests  — list refill requests for a rule
router.get('/:id/requests', requireLogin, async (req, res) => {
  try {
    const rows = await db.select().from(refill_requests)
      .where(eq(refill_requests.rule_id, req.params.id))
      .orderBy(desc(refill_requests.created_at));
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// POST /api/reminders/:id/send-refill-request
router.post('/:id/send-refill-request', requireLogin, async (req, res) => {
  try {
    const [rule] = await db.select().from(reminder_rules).where(eq(reminder_rules.id, req.params.id));
    if (!rule) return res.status(404).json({ error: 'NOT_FOUND' });

    const [patient] = await db.select().from(patients).where(eq(patients.id, rule.patient_id));
    const [product] = await db.select().from(products).where(eq(products.id, rule.product_id));

    // Pull address from last shipment, fall back to shipping_address, then billing_address
    let ship_address = null;
    if (rule.last_order_id) {
      const [lastShipment] = await db.select().from(shipments)
        .where(eq(shipments.order_id, rule.last_order_id));
      if (lastShipment) {
        // Try to get the order's shipping quote recipient address
        const [lastOrder] = await db.select().from(sales_orders)
          .where(eq(sales_orders.id, rule.last_order_id));
        if (lastOrder?.shipping_quote?.confirmed_address) {
          ship_address = lastOrder.shipping_quote.confirmed_address;
        }
      }
    }
    if (!ship_address) {
      ship_address = patient.shipping_address || patient.billing_address;
    }

    // Proposed ship date — default to next business day or what caller provides
    const proposed_ship_date = req.body.proposed_ship_date || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      // Skip weekends
      if (d.getDay() === 6) d.setDate(d.getDate() + 2);
      if (d.getDay() === 0) d.setDate(d.getDate() + 1);
      return d.toISOString().split('T')[0];
    })();

    const channel = req.body.channel || 'email'; // 'email' | 'sms' | 'both'
    const token = crypto.randomBytes(32).toString('hex');
    const token_expires_at = new Date(Date.now() + 7 * 86400000); // 7 days

    const [request] = await db.insert(refill_requests).values({
      rule_id: rule.id,
      patient_id: patient.id,
      product_id: product.id,
      token,
      token_expires_at,
      proposed_ship_date,
      ship_address,
      ship_service: 'PRIORITY_OVERNIGHT',
      channel,
    }).returning();

    // Send email
    if (channel === 'email' || channel === 'both') {
      await sendRefillRequestEmail(patient, product, request);
    }
    // Send SMS if configured
    if (channel === 'sms' || channel === 'both') {
      try {
        await sendRefillRequestSMS(patient, product, request);
      } catch (smsErr) {
        console.error('SMS send failed (non-fatal):', smsErr.message);
      }
    }

    await db.update(reminder_rules)
      .set({ last_reminded_at: new Date() })
      .where(eq(reminder_rules.id, rule.id));

    return res.json({ ok: true, request_id: request.id, proposed_ship_date, ship_address });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// GET /api/shipments/exceptions
router.get('/shipments/exceptions', requireLogin, async (req, res) => {
  try {
    const { shipments } = require('../db/schema');
    const { and: _and, eq: _eq } = require('drizzle-orm');
    const rows = await db.select().from(shipments)
      .where(and(eq(shipments.exception_flag, true), eq(shipments.polling_active, true)));
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ─── Reorder link — /reorder/:ruleId (PUBLIC, mounted at /reorder) ────────────
// Emailed to patients — must not require admin login. Two steps:
//   GET  → confirmation page ("Yes, place my reorder")
//   POST → creates a draft order and shows a success page
// The rule UUID acts as an unguessable token; staff still get notified so
// they'll review the draft before it ships.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reorderPage(title, body) {
  const company = esc(process.env.COMPANY_NAME || 'OrderFlow');
  return `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#f3f4f6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:12px;padding:36px 32px;max-width:500px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.08)}
    .center{text-align:center}
    .icon{font-size:52px;margin-bottom:14px}
    h1{font-size:22px;color:#111827;margin-bottom:8px}
    p{color:#6b7280;font-size:14px;line-height:1.6;margin-bottom:8px}
    .info{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:16px 0;font-size:14px;line-height:1.7}
    .btn{width:100%;background:#16a34a;color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;margin-top:10px;display:block;text-align:center;text-decoration:none}
    .btn:hover{background:#15803d}
    .footer{margin-top:24px;font-size:12px;color:#9ca3af;text-align:center}
  </style>
</head><body>
  <div class="card">${body}<div class="footer">${company}</div></div>
</body></html>`;
}

async function loadReorderRule(ruleId, res) {
  if (!ruleId || !UUID_RE.test(ruleId)) {
    res.status(400).send(reorderPage('Invalid Link',
      `<div class="center"><div class="icon">⚠</div><h1>Invalid link</h1><p>This reorder link is malformed.</p></div>`));
    return null;
  }
  const [rule] = await db.select().from(reminder_rules).where(eq(reminder_rules.id, ruleId));
  if (!rule) {
    res.status(404).send(reorderPage('Link Not Found',
      `<div class="center"><div class="icon">🔍</div><h1>Link Not Found</h1><p>This reorder link is invalid.</p></div>`));
    return null;
  }
  if (!rule.active) {
    res.send(reorderPage('Reminder Paused',
      `<div class="center"><div class="icon">⏸</div><h1>Reminder Paused</h1><p>These automatic refills have been paused. Contact us to resume.</p></div>`));
    return null;
  }
  return rule;
}

// GET /reorder/:ruleId — show confirmation page
router.get('/:ruleId', async (req, res) => {
  try {
    const rule = await loadReorderRule(req.params.ruleId, res);
    if (!rule) return;

    const [product] = await db.select().from(products).where(eq(products.id, rule.product_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, rule.patient_id));

    return res.send(reorderPage('Place Reorder', `
      <div class="center">
        <div class="icon">📦</div>
        <h1>Ready to Reorder?</h1>
        <p>Hi ${esc(patient.name)}, click below to place a reorder for <strong>${esc(product.name)}</strong>.</p>
      </div>
      <div class="info">
        <div><strong>Product:</strong> ${esc(product.name)}</div>
        <div><strong>Interval:</strong> every ${esc(rule.interval_days)} days</div>
      </div>
      <form method="POST" action="/reorder/${esc(rule.id)}">
        <button type="submit" class="btn">Yes, place my reorder</button>
      </form>
      <p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:12px">
        Our team will review the order and send you an invoice.
      </p>
    `));
  } catch (err) {
    console.error('Reorder GET error:', err);
    return res.status(500).send(reorderPage('Error',
      `<div class="center"><div class="icon">⚠</div><h1>Something went wrong</h1><p>Please contact us to place your reorder.</p></div>`));
  }
});

// POST /reorder/:ruleId — create the draft order
router.post('/:ruleId', async (req, res) => {
  try {
    const rule = await loadReorderRule(req.params.ruleId, res);
    if (!rule) return;

    const [product] = await db.select().from(products).where(eq(products.id, rule.product_id));
    const [patient] = await db.select().from(patients).where(eq(patients.id, rule.patient_id));
    const unit_price = parseFloat(product.unit_price);

    // Atomic order + line-item create with retry on order_number collision
    let order;
    for (let attempt = 0; attempt < 5; attempt++) {
      const year = new Date().getFullYear();
      const prefix = `SO-${year}-`;
      const result = await db.execute(sql`
        SELECT order_number FROM sales_orders
        WHERE order_number LIKE ${prefix + '%'}
        ORDER BY (regexp_replace(order_number, '.*-', '')::bigint) DESC
        LIMIT 1
      `);
      const rows = result.rows || result;
      const order_number = rows.length
        ? `${prefix}${String(parseInt(rows[0].order_number.split('-').pop(), 10) + 1).padStart(3, '0')}`
        : `${prefix}001`;
      try {
        await db.transaction(async (tx) => {
          [order] = await tx.insert(sales_orders).values({
            order_number,
            patient_id: rule.patient_id,
            status: 'draft',
            notes: `Patient-confirmed reorder from reminder ${rule.id}. Please review and send invoice.`,
          }).returning();
          await tx.insert(order_items).values({
            order_id: order.id,
            product_id: rule.product_id,
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

    await db.update(reminder_rules)
      .set({ last_order_id: order.id, last_reminded_at: new Date() })
      .where(eq(reminder_rules.id, rule.id));

    return res.send(reorderPage('Reorder Placed!', `
      <div class="center">
        <div class="icon">✅</div>
        <h1>You're all set!</h1>
        <p>Thank you, ${esc(patient.name)}! Your reorder for <strong>${esc(product.name)}</strong> has been received.</p>
        <p style="margin-top:12px">We'll send an invoice to ${esc(patient.email)} shortly.</p>
        <p style="margin-top:8px;font-size:12px;color:#9ca3af">Order ${esc(order.order_number)}</p>
      </div>
    `));
  } catch (err) {
    console.error('Reorder POST error:', err);
    return res.status(500).send(reorderPage('Error',
      `<div class="center"><div class="icon">⚠</div><h1>Something went wrong</h1><p>Please contact us to place your reorder.</p></div>`));
  }
});

module.exports = router;
