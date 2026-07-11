// Shared invoice-creation logic — used by the admin route, the refill
// auto-invoice flow, and the autopay cron.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { invoices, sales_orders, order_items, products, patients } = require('../db/schema');
const { eq, sql, isNull, and } = require('drizzle-orm');
const { generateInvoicePDF } = require('./pdf');
const { sendInvoiceEmail } = require('./mailer');
const { sendInvoiceSMS } = require('./sms');

function generatePayToken() {
  return crypto.randomBytes(32).toString('hex');
}

function payTokenExpiresAt(days = 3) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const result = await db.execute(sql`
    SELECT invoice_number FROM invoices
    WHERE invoice_number LIKE ${prefix + '%'}
    ORDER BY (regexp_replace(invoice_number, '.*-', '')::bigint) DESC
    LIMIT 1
  `);
  const rows = result.rows || result;
  if (!rows.length) return `${prefix}001`;
  const last = rows[0].invoice_number;
  const num = parseInt(last.split('-').pop(), 10) + 1;
  return `${prefix}${String(num).padStart(3, '0')}`;
}

/**
 * Create an invoice for an order (idempotent — returns the existing
 * non-deleted invoice if one exists). Grosses subtotal up 3.9% (CC price),
 * includes shipping quote, generates the PDF, and optionally notifies the
 * patient by email + SMS.
 *
 * Returns { invoice, created } — created=false when an invoice already existed.
 */
async function createInvoiceForOrder(order, { notify = true } = {}) {
  const [existing] = await db.select().from(invoices)
    .where(and(eq(invoices.order_id, order.id), isNull(invoices.deleted_at)));
  if (existing) return { invoice: existing, created: false };

  const items = await db.select({
    item: order_items,
    product_name: products.name,
    product_sku: products.sku,
  })
    .from(order_items)
    .leftJoin(products, eq(order_items.product_id, products.id))
    .where(eq(order_items.order_id, order.id));

  const baseSubtotal = items.reduce((sum, r) => sum + parseFloat(r.item.line_total), 0);
  const subtotal = Math.round(baseSubtotal * 1.039 * 100) / 100;
  const shipping_charge = order.shipping_quote?.net_charge ? parseFloat(order.shipping_quote.net_charge) : 0;
  const due_date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  let invoice;
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoice_number = await generateInvoiceNumber();
    try {
      await db.transaction(async (tx) => {
        [invoice] = await tx.insert(invoices).values({
          invoice_number,
          order_id: order.id,
          subtotal: subtotal.toFixed(2),
          shipping_charge: shipping_charge.toFixed(2),
          processing_fee: '0.00',
          total: (subtotal + shipping_charge).toFixed(2),
          pay_status: 'pending',
          due_date,
          pay_token: generatePayToken(),
          pay_token_expires_at: payTokenExpiresAt(3),
        }).returning();

        await tx.update(sales_orders)
          .set({ status: 'pending_payment', updated_at: new Date() })
          .where(eq(sales_orders.id, order.id));
      });
      break;
    } catch (err) {
      if (err.code !== '23505' || attempt === 4) throw err;
      await new Promise(r => setTimeout(r, 10 + Math.random() * 40));
    }
  }

  // Generate PDF (non-fatal on failure — the invoice row is authoritative)
  const [patient] = await db.select().from(patients).where(eq(patients.id, order.patient_id));
  let updated = invoice;
  try {
    const invoicesDir = path.join(__dirname, '../../uploads/invoices');
    fs.mkdirSync(invoicesDir, { recursive: true });
    const pdfPath = path.join(invoicesDir, `${invoice.id}.pdf`);
    await generateInvoicePDF({
      invoice: { ...invoice, shipping_service: order.shipping_quote?.service_type || null },
      order,
      patient,
      items: items.map(r => ({ ...r.item, product_name: r.product_name })),
    }, pdfPath);

    [updated] = await db.update(invoices)
      .set({ pdf_url: `/uploads/invoices/${invoice.id}.pdf`, sent_at: new Date() })
      .where(eq(invoices.id, invoice.id))
      .returning();
  } catch (pdfErr) {
    console.error('Invoice PDF generation failed:', pdfErr.message);
  }

  if (notify) {
    try { await sendInvoiceEmail(patient, order, updated); }
    catch (e) { console.error('Invoice email failed:', e.message); }
    try { await sendInvoiceSMS(patient, updated); }
    catch (e) { console.error('Invoice SMS failed:', e.message); }
  }

  return { invoice: updated, created: true };
}

// Does the patient have an active, unexpired prescription?
async function hasActivePrescription(patient_id) {
  const { prescriptions } = require('../db/schema');
  const today = new Date().toISOString().split('T')[0];
  const rows = await db.select().from(prescriptions)
    .where(eq(prescriptions.patient_id, patient_id));
  return rows.some(r => r.status === 'active' && (r.expiry_date === null || r.expiry_date >= today));
}

module.exports = { createInvoiceForOrder, hasActivePrescription, generateInvoiceNumber };
