/**
 * Zoho One → OrderFlow Data Migration Script
 * Usage:
 *   node server/scripts/zoho-import.js --mode=csv --dir=./import/zoho --dry-run
 *   node server/scripts/zoho-import.js --mode=csv --dir=./import/zoho --execute
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const args = require('minimist')(process.argv.slice(2));
const { db, pool } = require('../db');
const {
  patients, products, sales_orders, order_items, invoices, shipments,
} = require('../db/schema');
const { eq, sql } = require('drizzle-orm');

const DRY_RUN = args['dry-run'] === true || args['dry-run'] === '';
const EXECUTE = args['execute'] === true || args['execute'] === '';
const MODE = args['mode'] || process.env.ZOHO_IMPORT_MODE || 'csv';
const DIR = args['dir'] || './import/zoho';

if (!DRY_RUN && !EXECUTE) {
  console.error('Specify --dry-run or --execute');
  process.exit(1);
}

const REPORT_DIR = './import/reports';

function readCSV(filename) {
  const filepath = path.join(DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`[WARN] File not found: ${filepath}`);
    return [];
  }
  const content = fs.readFileSync(filepath, 'utf8');
  return parse(content, { columns: true, skip_empty_lines: true, trim: true });
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function normalizeStatus(zohoStatus) {
  const map = {
    'Confirmed': 'draft',
    'Invoiced': 'pending_payment',
    'Void': 'cancelled',
    'Closed': 'paid',
  };
  return map[zohoStatus] || 'draft';
}

function normalizeInvoiceStatus(status) {
  if (/paid/i.test(status)) return 'paid';
  if (/void/i.test(status)) return 'failed';
  return 'pending';
}

function normalizePayMethod(method) {
  if (!method) return null;
  const m = method.toLowerCase();
  if (m.includes('card') || m.includes('credit')) return 'stripe_cc';
  if (m.includes('bank') || m.includes('ach') || m.includes('transfer') ||
      m.includes('check') || m.includes('cash')) return 'ach';
  if (m.includes('crypto') || m.includes('usdc') || m.includes('polygon')) return 'usdc';
  return null;
}

function normalizeShipStatus(status) {
  if (/delivered/i.test(status)) return 'delivered';
  if (/shipped|transit/i.test(status)) return 'in_transit';
  return 'label_created';
}

function normalizeCarrier(carrier) {
  if (!carrier) return 'FEDEX_GROUND';
  if (/express/i.test(carrier)) return 'FEDEX_EXPRESS_SAVER';
  if (/priority|overnight/i.test(carrier)) return 'PRIORITY_OVERNIGHT';
  return 'FEDEX_GROUND';
}

async function main() {
  console.log(`[Zoho Import] Mode: ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}, Source: ${MODE}`);

  const report = {
    date: new Date().toISOString().split('T')[0],
    patients: { inserted: 0, skipped: 0, failed: 0 },
    products: { inserted: 0, skipped: 0, failed: 0 },
    sales_orders: { inserted: 0, skipped: 0, failed: 0 },
    invoices: { inserted: 0, skipped: 0, failed: 0 },
    shipments: { inserted: 0, skipped: 0, failed: 0 },
    anomalies: [],
  };

  // ─── 1. Patients ────────────────────────────────────────────────────────────
  console.log('\n[1/5] Importing patients...');
  const accountRows = readCSV('accounts.csv');
  const patientMap = {}; // name → id

  for (const row of accountRows) {
    const name = (row['Account Name'] || row['Name'] || '').trim();
    const email = normalizeEmail(row['Email'] || row['Account Email'] || '');
    if (!name) { report.anomalies.push(`Patient missing name: ${JSON.stringify(row)}`); continue; }

    const billing_address = {
      street: row['Billing Street'] || row['Billing Address'] || '',
      city: row['Billing City'] || '',
      state: row['Billing State'] || '',
      zip: row['Billing Code'] || row['Billing Zip'] || '',
      country: row['Billing Country'] || 'MX',
    };

    console.log(`  ${DRY_RUN ? '[DRY]' : ''} Patient: ${name} <${email}>`);

    if (!DRY_RUN) {
      try {
        const [existing] = email
          ? await db.select().from(patients).where(eq(patients.email, email))
          : [];

        if (existing) {
          patientMap[name] = existing.id;
          report.patients.skipped++;
        } else {
          const [inserted] = await db.insert(patients).values({
            name,
            email: email || null,
            billing_address,
          }).returning();
          patientMap[name] = inserted.id;
          report.patients.inserted++;
        }
      } catch (err) {
        report.patients.failed++;
        report.anomalies.push(`Patient insert failed: ${name} — ${err.message}`);
      }
    } else {
      report.patients.inserted++;
    }
  }

  // ─── 2. Products ─────────────────────────────────────────────────────────────
  console.log('\n[2/5] Importing products...');
  const itemRows = readCSV('items.csv');
  const productMap = {}; // name → id

  for (const row of itemRows) {
    const name = (row['Item Name'] || row['Name'] || '').trim();
    const sku = (row['SKU'] || row['Item Code'] || name.replace(/\s+/g, '-').toUpperCase()).trim();
    const unit_price = parseFloat(row['Sales Price'] || row['Rate'] || '0');
    const unit = row['Unit'] || 'pc';

    if (!name) continue;
    console.log(`  ${DRY_RUN ? '[DRY]' : ''} Product: ${name} (${sku}) $${unit_price}`);

    if (!DRY_RUN) {
      try {
        const [existing] = await db.select().from(products).where(eq(products.sku, sku));
        if (existing) {
          productMap[name] = existing.id;
          report.products.skipped++;
        } else {
          const [inserted] = await db.insert(products).values({
            sku, name, unit_price: unit_price.toFixed(2), unit,
          }).returning();
          productMap[name] = inserted.id;
          report.products.inserted++;
        }
      } catch (err) {
        report.products.failed++;
        report.anomalies.push(`Product insert failed: ${name} — ${err.message}`);
      }
    } else {
      report.products.inserted++;
    }
  }

  // ─── 3. Sales Orders ─────────────────────────────────────────────────────────
  console.log('\n[3/5] Importing sales orders...');
  const soRows = readCSV('sales_orders.csv');
  const orderMap = {}; // order_number → id

  for (const row of soRows) {
    const order_number = (row['Sales Order#'] || row['SO Number'] || '').trim();
    const patientName = (row['Patient Name'] || row['Customer Name'] || '').trim();
    const status = normalizeStatus(row['Status'] || '');
    const created_at = row['Date'] ? new Date(row['Date']) : new Date();

    if (!order_number || !patientName) {
      report.anomalies.push(`Order missing fields: ${JSON.stringify(row)}`);
      continue;
    }

    const patient_id = patientMap[patientName];
    if (!patient_id && !DRY_RUN) {
      report.anomalies.push(`Order ${order_number}: patient not found: "${patientName}"`);
    }

    const itemName = (row['Item Name'] || row['Product'] || '').trim();
    const quantity = parseInt(row['Quantity'] || '1', 10);
    const unit_price = parseFloat(row['Item Price'] || row['Rate'] || '0');
    const line_total = parseFloat(row['Line Total'] || row['Amount'] || (unit_price * quantity).toFixed(2));
    const product_id = productMap[itemName];

    console.log(`  ${DRY_RUN ? '[DRY]' : ''} Order: ${order_number} / ${patientName}`);

    if (!DRY_RUN && patient_id) {
      try {
        const [existing] = await db.select().from(sales_orders).where(eq(sales_orders.order_number, order_number));
        if (existing) {
          orderMap[order_number] = existing.id;
          report.sales_orders.skipped++;
        } else {
          const [inserted] = await db.insert(sales_orders).values({
            order_number, patient_id, status, created_at, updated_at: created_at,
          }).returning();
          orderMap[order_number] = inserted.id;

          if (product_id && itemName) {
            await db.insert(order_items).values({
              order_id: inserted.id,
              product_id,
              quantity,
              unit_price: unit_price.toFixed(2),
              line_total: line_total.toFixed(2),
            }).onConflictDoNothing();
          }
          report.sales_orders.inserted++;
        }
      } catch (err) {
        report.sales_orders.failed++;
        report.anomalies.push(`Order insert failed: ${order_number} — ${err.message}`);
      }
    } else {
      report.sales_orders.inserted++;
    }
  }

  // ─── 4. Invoices ─────────────────────────────────────────────────────────────
  console.log('\n[4/5] Importing invoices...');
  const invRows = readCSV('invoices.csv');

  for (const row of invRows) {
    const invoice_number = (row['Invoice#'] || row['Invoice Number'] || '').trim();
    const soNumber = (row['Sales Order#'] || row['SO Number'] || '').trim();
    const pay_status = normalizeInvoiceStatus(row['Status'] || '');
    const subtotal = parseFloat(row['Sub Total'] || row['Subtotal'] || '0');
    const total = parseFloat(row['Total'] || subtotal.toString());
    const paid_at = row['Payment Date'] ? new Date(row['Payment Date']) : null;
    const pay_method = normalizePayMethod(row['Payment Mode'] || row['Payment Method'] || '');

    if (!invoice_number) continue;

    const order_id = orderMap[soNumber];
    if (!order_id && !DRY_RUN && soNumber) {
      report.anomalies.push(`Invoice ${invoice_number}: order not found: "${soNumber}"`);
    }

    const balance = parseFloat(row['Balance Due'] || '0');
    if (balance > 0 && pay_status === 'paid') {
      report.anomalies.push(`Invoice ${invoice_number}: balance_due > 0 but status=paid — manual review needed`);
    }

    console.log(`  ${DRY_RUN ? '[DRY]' : ''} Invoice: ${invoice_number} / ${pay_status} / $${total}`);

    if (!DRY_RUN && order_id) {
      try {
        const [existing] = await db.select().from(invoices).where(eq(invoices.invoice_number, invoice_number));
        if (existing) { report.invoices.skipped++; continue; }

        await db.insert(invoices).values({
          invoice_number,
          order_id,
          subtotal: subtotal.toFixed(2),
          processing_fee: '0.00',
          total: total.toFixed(2),
          pay_status,
          pay_method,
          paid_at,
          due_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        });
        report.invoices.inserted++;
      } catch (err) {
        report.invoices.failed++;
        report.anomalies.push(`Invoice insert failed: ${invoice_number} — ${err.message}`);
      }
    } else {
      report.invoices.inserted++;
    }
  }

  // ─── 5. Shipments ─────────────────────────────────────────────────────────────
  console.log('\n[5/5] Importing shipments...');
  const pkgRows = readCSV('packages.csv');

  for (const row of pkgRows) {
    const raw_import_id = (row['Package#'] || '').trim();
    const soNumber = (row['Sales Order#'] || row['SO Number'] || '').trim();
    const tracking = (row['Tracking Number'] || '').trim();
    const carrier = row['Carrier'] || row['Shipping Carrier'] || '';
    const ship_date = row['Ship Date'] ? new Date(row['Ship Date']).toISOString().split('T')[0] : null;
    const status = normalizeShipStatus(row['Status'] || '');
    const service_type = normalizeCarrier(carrier);

    if (!soNumber) continue;
    const order_id = orderMap[soNumber];

    console.log(`  ${DRY_RUN ? '[DRY]' : ''} Shipment: ${raw_import_id} / ${tracking} / ${status}`);

    if (!DRY_RUN && order_id) {
      try {
        const [existing] = await db.select().from(shipments).where(eq(shipments.order_id, order_id));
        if (existing) { report.shipments.skipped++; continue; }

        await db.insert(shipments).values({
          order_id,
          fedex_tracking_number: tracking || null,
          service_type,
          ship_date,
          status,
          raw_import_id,
          polling_active: false, // historical shipments: no polling
          latest_status: status,
        });
        report.shipments.inserted++;
      } catch (err) {
        report.shipments.failed++;
        report.anomalies.push(`Shipment insert failed: ${raw_import_id} — ${err.message}`);
      }
    } else {
      report.shipments.inserted++;
    }
  }

  // ─── Report ──────────────────────────────────────────────────────────────────
  console.log('\n─── Import Summary ──────────────────────────────────');
  for (const [entity, counts] of Object.entries(report)) {
    if (typeof counts === 'object' && counts.inserted !== undefined) {
      console.log(`${entity}: inserted=${counts.inserted}, skipped=${counts.skipped}, failed=${counts.failed}`);
    }
  }
  if (report.anomalies.length) {
    console.log(`\nAnomalies (${report.anomalies.length}):`);
    report.anomalies.forEach(a => console.log('  ⚠', a));
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportFile = path.join(REPORT_DIR, `zoho-import-${report.date}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\nReport saved: ${reportFile}`);

  await pool.end();
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
