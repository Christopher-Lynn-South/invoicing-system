const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { db } = require('../db');
const { patients, products, sales_orders, order_items, invoices, shipments } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

// Store files in memory — CSVs are small
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Normalization helpers ────────────────────────────────────────────────────

const COUNTRY_MAP = {
  'united states': 'US', 'united states of america': 'US', 'usa': 'US', 'u.s.a.': 'US', 'u.s.a': 'US', 'u.s.': 'US', 'us': 'US',
  'mexico': 'MX', 'méxico': 'MX', 'mex': 'MX',
  'canada': 'CA', 'can': 'CA',
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB',
  'spain': 'ES', 'españa': 'ES',
  'germany': 'DE', 'deutschland': 'DE',
  'france': 'FR',
};

function normalizeCountry(raw) {
  if (!raw) return '';
  const lower = raw.trim().toLowerCase();
  return COUNTRY_MAP[lower] || raw.trim().toUpperCase().slice(0, 2);
}

function parseCSV(buffer) {
  if (!buffer) return [];
  try {
    return parse(buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } catch { return []; }
}

function normalizeEmail(v) { return (v || '').trim().toLowerCase() || null; }

function normalizeStatus(v) {
  const map = { confirmed: 'draft', invoiced: 'pending_payment', void: 'cancelled', closed: 'paid', draft: 'draft' };
  return map[(v || '').toLowerCase()] || 'draft';
}

function normalizePayStatus(v) {
  if (!v) return 'pending';
  const l = v.toLowerCase();
  if (l.includes('paid') || l === 'closed') return 'paid';
  if (l.includes('void') || l.includes('fail')) return 'failed';
  return 'pending';
}

function normalizePayMethod(v) {
  if (!v) return null;
  const l = v.toLowerCase();
  if (l.includes('card') || l.includes('credit') || l.includes('stripe')) return 'stripe_cc';
  if (l.includes('bank') || l.includes('ach') || l.includes('check') || l.includes('transfer') || l.includes('cash')) return 'ach';
  if (l.includes('crypto') || l.includes('usdc') || l.includes('polygon')) return 'usdc';
  return null;
}

function normalizeServiceType(v) {
  if (!v) return 'FEDEX_GROUND';
  const l = v.toLowerCase();
  if (l.includes('overnight') || l.includes('priority')) return 'PRIORITY_OVERNIGHT';
  if (l.includes('2day') || l.includes('2 day')) return 'FEDEX_2_DAY';
  if (l.includes('express')) return 'FEDEX_EXPRESS_SAVER';
  if (l.includes('home')) return 'FEDEX_HOME_DELIVERY';
  return 'FEDEX_GROUND';
}

function pick(row, ...keys) {
  for (const k of keys) {
    const v = (row[k] || '').trim();
    if (v) return v;
  }
  return '';
}

// ─── POST /api/import/zoho?mode=preview|execute ────────────────────────────────
const csvFields = upload.fields([
  { name: 'accounts', maxCount: 1 },
  { name: 'items', maxCount: 1 },
  { name: 'sales_orders', maxCount: 1 },
  { name: 'invoices', maxCount: 1 },
  { name: 'packages', maxCount: 1 },
]);

router.post('/zoho', csvFields, async (req, res) => {
  const mode = req.query.mode || 'preview';
  const execute = mode === 'execute';
  const files = req.files || {};

  const report = {
    mode,
    patients:     { inserted: 0, skipped: 0, failed: 0, samples: [] },
    products:     { inserted: 0, skipped: 0, failed: 0, samples: [] },
    sales_orders: { inserted: 0, skipped: 0, failed: 0, samples: [] },
    invoices:     { inserted: 0, skipped: 0, failed: 0, samples: [] },
    shipments:    { inserted: 0, skipped: 0, failed: 0, samples: [] },
    anomalies:    [],
  };

  function addAnomaly(msg) { report.anomalies.push(msg); }
  function sample(entity, obj) {
    if (report[entity].samples.length < 5) report[entity].samples.push(obj);
  }

  // ── 1. Patients / Accounts ──────────────────────────────────────────────────
  const accountRows = parseCSV(files.accounts?.[0]?.buffer);
  const patientMap = {}; // name → id (or placeholder in preview)

  for (const row of accountRows) {
    // Zoho exports "Contact Name" or "Display Name"; fall back to First + Last
    let name = pick(row, 'Contact Name', 'Display Name', 'Account Name', 'Customer Name', 'Full Name', 'Name');
    if (!name) {
      const first = pick(row, 'First Name');
      const last  = pick(row, 'Last Name');
      name = [first, last].filter(Boolean).join(' ').trim();
    }
    // Zoho exports email as "EmailID"
    const email = normalizeEmail(pick(row, 'EmailID', 'Email', 'Account Email', 'Contact Email'));
    if (!name) { addAnomaly(`Patient row missing name: ${JSON.stringify(row)}`); continue; }

    const billing_address = {
      street:  pick(row, 'Billing Address', 'Billing Street', 'Street'),
      city:    pick(row, 'Billing City', 'City'),
      state:   pick(row, 'Billing State', 'State'),
      zip:     pick(row, 'Billing Code', 'Billing Zip', 'Zip', 'Postal Code'),
      country: normalizeCountry(pick(row, 'Billing Country', 'Country')) || 'US',
    };
    const shipping_address_raw = pick(row, 'Shipping Address', 'Shipping Street');
    const shipping_address = shipping_address_raw ? {
      street:  shipping_address_raw,
      city:    pick(row, 'Shipping City'),
      state:   pick(row, 'Shipping State'),
      zip:     pick(row, 'Shipping Code', 'Shipping Zip'),
      country: normalizeCountry(pick(row, 'Shipping Country')) || billing_address.country,
    } : null;

    const phone = pick(row, 'Phone', 'MobilePhone', 'Mobile Phone', 'Mobile', 'Contact Phone', 'Billing Phone');

    sample('patients', { name, email, billing_address });

    if (execute) {
      try {
        const existing = email
          ? (await db.select().from(patients).where(eq(patients.email, email)))[0]
          : (await db.select({ id: patients.id, name: patients.name }).from(patients)
              .where(eq(patients.name, name)))[0];

        if (existing) {
          patientMap[name] = existing.id;
          report.patients.skipped++;
        } else {
          const [ins] = await db.insert(patients).values({
            name, email: email || null, phone: phone || null,
            billing_address, shipping_address,
          }).returning();
          patientMap[name] = ins.id;
          report.patients.inserted++;
        }
      } catch (err) {
        report.patients.failed++;
        addAnomaly(`Patient "${name}": ${err.message}`);
      }
    } else {
      patientMap[name] = `preview-${name}`;
      report.patients.inserted++;
    }
  }

  // ── 2. Products / Items ─────────────────────────────────────────────────────
  const itemRows = parseCSV(files.items?.[0]?.buffer);
  const productMap = {}; // name → id

  for (const row of itemRows) {
    const name  = pick(row, 'Item Name', 'Name', 'Product Name');
    const sku   = pick(row, 'SKU', 'Item Code', 'Product Code') || name.replace(/\s+/g, '-').toUpperCase().slice(0, 50);
    const unit_price = parseFloat(pick(row, 'Sales Price', 'Rate', 'Unit Price') || '0');
    const unit  = pick(row, 'Unit', 'UOM') || 'pc';
    if (!name) continue;

    sample('products', { name, sku, unit_price });

    if (execute) {
      try {
        const [existing] = await db.select().from(products).where(eq(products.sku, sku));
        if (existing) {
          productMap[name] = existing.id;
          report.products.skipped++;
        } else {
          const [ins] = await db.insert(products).values({ sku, name, unit_price: unit_price.toFixed(2), unit }).returning();
          productMap[name] = ins.id;
          report.products.inserted++;
        }
      } catch (err) {
        report.products.failed++;
        addAnomaly(`Product "${name}": ${err.message}`);
      }
    } else {
      productMap[name] = `preview-${name}`;
      report.products.inserted++;
    }
  }

  // ── 3. Sales Orders ─────────────────────────────────────────────────────────
  const soRows = parseCSV(files.sales_orders?.[0]?.buffer);
  const orderMap = {}; // order_number → id

  // Group by order number (one row per line item in Zoho exports)
  const orderGroups = {};
  for (const row of soRows) {
    const num = pick(row, 'Sales Order#', 'SO Number', 'Order Number', 'Sales Order No');
    if (!num) continue;
    if (!orderGroups[num]) orderGroups[num] = [];
    orderGroups[num].push(row);
  }

  for (const [order_number, rows] of Object.entries(orderGroups)) {
    const row = rows[0];
    const patientName = pick(row, 'Patient Name', 'Customer Name', 'Account Name', 'Contact Name');
    const status = normalizeStatus(pick(row, 'Status', 'Order Status'));
    const created_at = pick(row, 'Date', 'Order Date', 'Created Date');
    const notes = pick(row, 'Notes', 'Comments', 'Internal Notes');
    const patient_id = patientMap[patientName];

    if (!patient_id) {
      addAnomaly(`Order ${order_number}: patient not found "${patientName}"`);
      if (!execute) orderMap[order_number] = `preview-${order_number}`;
      continue;
    }

    const lineItems = rows.map(r => {
      const itemName   = pick(r, 'Item Name', 'Product Name', 'Line Item');
      const quantity   = parseInt(pick(r, 'Quantity', 'Qty') || '1', 10);
      const unit_price = parseFloat(pick(r, 'Item Price', 'Rate', 'Unit Price') || '0');
      const line_total = parseFloat(pick(r, 'Line Total', 'Amount', 'Item Total') || String(unit_price * quantity));
      const product_id = productMap[itemName];
      return { itemName, quantity, unit_price, line_total, product_id };
    }).filter(i => i.itemName && i.unit_price >= 0);

    sample('sales_orders', { order_number, patientName, status, items: lineItems.length });

    if (execute) {
      try {
        const [existing] = await db.select().from(sales_orders).where(eq(sales_orders.order_number, order_number));
        if (existing) {
          orderMap[order_number] = existing.id;
          report.sales_orders.skipped++;
        } else {
          const [ins] = await db.insert(sales_orders).values({
            order_number,
            patient_id: String(patient_id),
            status,
            notes: notes || null,
            created_at: created_at ? new Date(created_at) : new Date(),
            updated_at: new Date(),
          }).returning();
          orderMap[order_number] = ins.id;

          for (const item of lineItems) {
            if (!item.product_id || item.product_id.startsWith('preview')) continue;
            try {
              await db.insert(order_items).values({
                order_id: ins.id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price.toFixed(2),
                line_total: item.line_total.toFixed(2),
              });
            } catch { /* skip duplicate line items */ }
          }
          report.sales_orders.inserted++;
        }
      } catch (err) {
        report.sales_orders.failed++;
        addAnomaly(`Order ${order_number}: ${err.message}`);
      }
    } else {
      orderMap[order_number] = `preview-${order_number}`;
      report.sales_orders.inserted++;
    }
  }

  // ── 4. Invoices ─────────────────────────────────────────────────────────────
  const invRows = parseCSV(files.invoices?.[0]?.buffer);

  // Group by invoice number
  const invGroups = {};
  for (const row of invRows) {
    const num = pick(row, 'Invoice#', 'Invoice Number', 'Invoice No');
    if (!num) continue;
    if (!invGroups[num]) invGroups[num] = [];
    invGroups[num].push(row);
  }

  for (const [invoice_number, rows] of Object.entries(invGroups)) {
    const row = rows[0];
    const soNumber  = pick(row, 'Sales Order#', 'SO Number', 'Sales Order No');
    const pay_status = normalizePayStatus(pick(row, 'Status', 'Invoice Status', 'Payment Status'));
    const subtotal  = parseFloat(pick(row, 'Sub Total', 'Subtotal', 'Sub-Total') || '0');
    const shipping  = parseFloat(pick(row, 'Shipping Charge', 'Shipping', 'Freight') || '0');
    const total     = parseFloat(pick(row, 'Total', 'Invoice Total', 'Grand Total') || String(subtotal + shipping));
    const pay_method = normalizePayMethod(pick(row, 'Payment Mode', 'Payment Method', 'Payment Type'));
    const paid_date = pick(row, 'Payment Date', 'Paid Date', 'Date Paid');
    const due_date  = pick(row, 'Due Date', 'Payment Due Date');
    const balance   = parseFloat(pick(row, 'Balance Due', 'Balance', 'Amount Due') || '0');

    if (balance > 0.01 && pay_status === 'paid') {
      addAnomaly(`Invoice ${invoice_number}: balance $${balance.toFixed(2)} > 0 but status=paid — check manually`);
    }

    const order_id = orderMap[soNumber];
    if (!order_id && soNumber) {
      addAnomaly(`Invoice ${invoice_number}: order not found "${soNumber}"`);
    }

    sample('invoices', { invoice_number, soNumber, pay_status, total });

    if (execute && order_id && !String(order_id).startsWith('preview')) {
      try {
        const [existing] = await db.select().from(invoices).where(eq(invoices.invoice_number, invoice_number));
        if (existing) { report.invoices.skipped++; continue; }

        await db.insert(invoices).values({
          invoice_number,
          order_id: String(order_id),
          subtotal: subtotal.toFixed(2),
          shipping_charge: shipping.toFixed(2),
          processing_fee: '0.00',
          total: total.toFixed(2),
          pay_status,
          pay_method,
          paid_at: (pay_status === 'paid' && paid_date) ? new Date(paid_date) : null,
          due_date: due_date ? new Date(due_date).toISOString().split('T')[0] : null,
        });
        report.invoices.inserted++;
      } catch (err) {
        report.invoices.failed++;
        addAnomaly(`Invoice ${invoice_number}: ${err.message}`);
      }
    } else {
      report.invoices.inserted++;
    }
  }

  // ── 5. Shipments / Packages ─────────────────────────────────────────────────
  const pkgRows = parseCSV(files.packages?.[0]?.buffer);

  for (const row of pkgRows) {
    const raw_import_id = pick(row, 'Package#', 'Package Number', 'Shipment#', 'Shipment Number');
    const soNumber  = pick(row, 'Sales Order#', 'SO Number', 'Sales Order No');
    const tracking  = pick(row, 'Tracking Number', 'Tracking #', 'AWB Number');
    const carrier   = pick(row, 'Carrier', 'Shipping Carrier', 'Ship Via');
    const ship_date = pick(row, 'Ship Date', 'Shipped Date', 'Date Shipped');
    const delivered = pick(row, 'Delivery Date', 'Delivered Date');
    const weight    = parseFloat(pick(row, 'Weight', 'Gross Weight') || '0');
    const status    = delivered ? 'delivered' : tracking ? 'in_transit' : 'label_created';
    const service_type = normalizeServiceType(carrier);

    const order_id = orderMap[soNumber];
    if (!order_id && soNumber) {
      addAnomaly(`Package ${raw_import_id}: order not found "${soNumber}"`);
    }

    sample('shipments', { raw_import_id, soNumber, tracking, carrier, status });

    if (execute && order_id && !String(order_id).startsWith('preview')) {
      try {
        const [existing] = await db.select().from(shipments).where(eq(shipments.order_id, String(order_id)));
        if (existing) { report.shipments.skipped++; continue; }

        await db.insert(shipments).values({
          order_id: String(order_id),
          fedex_tracking_number: tracking || null,
          service_type,
          weight_lbs: weight > 0 ? weight.toFixed(2) : null,
          ship_date: ship_date ? new Date(ship_date).toISOString().split('T')[0] : null,
          estimated_delivery: delivered ? new Date(delivered).toISOString().split('T')[0] : null,
          status,
          latest_status: status === 'delivered' ? 'Delivered' : status === 'in_transit' ? 'In Transit' : 'Label Created',
          raw_import_id: raw_import_id || null,
          polling_active: false, // historical — don't poll
        });
        report.shipments.inserted++;
      } catch (err) {
        report.shipments.failed++;
        addAnomaly(`Shipment ${raw_import_id}: ${err.message}`);
      }
    } else {
      report.shipments.inserted++;
    }
  }

  return res.json({ ok: true, report });
});

module.exports = router;
