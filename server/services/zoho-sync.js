// Zoho → OrderFlow full sync. Uses Zoho's own record IDs for exact linking:
//   contact_id → patients.zoho_id
//   item_id → products.zoho_id
//   salesorder_id → sales_orders.zoho_id (line items from SO detail)
//   invoice.salesorder_id / reference_number → invoice→order link
//   package.salesorder_id → shipments
//
// Runs as a background job; poll getJob() for progress.
const { db } = require('../db');
const {
  patients, products, sales_orders, order_items, invoices, shipments,
  patient_shipping_addresses,
} = require('../db/schema');
const { eq, and, isNull, sql } = require('drizzle-orm');
const zoho = require('./zoho');

let job = null; // single concurrent job

function getJob() { return job; }

function normEmail(e) { return (e || '').trim().toLowerCase() || null; }

function mapOrderStatus(zStatus) {
  const s = (zStatus || '').toLowerCase();
  if (s === 'void') return 'cancelled';
  if (s === 'closed' || s === 'fulfilled') return 'paid';
  if (s === 'invoiced' || s === 'partially_invoiced') return 'pending_payment';
  return 'draft'; // draft | open | confirmed
}

function mapInvoiceStatus(zStatus) {
  const s = (zStatus || '').toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'void') return 'voided';
  return 'pending'; // sent | overdue | partially_paid | draft
}

function zohoAddrToJson(a) {
  if (!a || (!a.address && !a.city)) return null;
  return {
    street: a.address || '',
    street2: a.street2 || undefined,
    city: a.city || '',
    state: a.state || '',
    zip: a.zip || '',
    country: (a.country || 'US').length > 2 ? 'US' : (a.country || 'US').toUpperCase(),
  };
}

async function runSync() {
  if (job?.status === 'running') throw new Error('A sync is already running');
  job = {
    started_at: new Date().toISOString(),
    finished_at: null,
    status: 'running',
    phase: 'starting',
    progress: '',
    counts: {
      patients: { created: 0, updated: 0 },
      products: { created: 0, updated: 0 },
      orders: { created: 0, updated: 0, skipped: 0 },
      invoices: { created: 0, updated: 0, unlinked: 0 },
      shipments: { created: 0, updated: 0, unlinked: 0 },
    },
    errors: [],
  };

  // Fire and forget — caller polls
  (async () => {
    try {
      const contactMap = {}; // zoho contact_id → patient uuid
      const itemMap = {};    // zoho item_id → product uuid
      const orderMap = {};   // zoho salesorder_id → order uuid
      const orderNumMap = {}; // zoho salesorder_number → order uuid

      // ── 1. Contacts → patients (+ full multi-address book) ────────────────
      job.phase = 'contacts';
      const contacts = await zoho.fetchContacts(n => { job.progress = `${n} contacts fetched`; });
      let cDone = 0;
      for (const c of contacts) {
        try {
          cDone++;
          job.progress = `processing contact ${cDone}/${contacts.length}`;
          const email = normEmail(c.email);

          // Detail carries billing/shipping + any additional addresses
          let detail = null;
          try {
            detail = await zoho.fetchContactDetail(c.contact_id);
            await new Promise(r => setTimeout(r, 150));
          } catch { /* fall back to list fields */ }
          const billing = detail ? zohoAddrToJson(detail.billing_address) : null;
          const shipping = detail ? zohoAddrToJson(detail.shipping_address) : null;

          let [existing] = await db.select().from(patients).where(eq(patients.zoho_id, String(c.contact_id)));
          if (!existing && email) {
            [existing] = await db.select().from(patients).where(eq(patients.email, email));
          }

          let patientId;
          if (existing) {
            const updates = { zoho_id: String(c.contact_id), updated_at: new Date() };
            if (!existing.phone && (c.phone || c.mobile)) updates.phone = c.phone || c.mobile;
            if (!existing.email && email) updates.email = email;
            if (!existing.billing_address && billing) updates.billing_address = billing;
            if (!existing.shipping_address && shipping) updates.shipping_address = shipping;
            await db.update(patients).set(updates).where(eq(patients.id, existing.id));
            patientId = existing.id;
            job.counts.patients.updated++;
          } else {
            const [created] = await db.insert(patients).values({
              name: c.contact_name || c.company_name || 'Unknown',
              email,
              phone: c.phone || c.mobile || null,
              billing_address: billing,
              shipping_address: shipping,
              zoho_id: String(c.contact_id),
            }).returning();
            patientId = created.id;
            job.counts.patients.created++;
          }
          contactMap[c.contact_id] = patientId;

          // Multi-address book: primary shipping + every additional address.
          // Dedupe against what's already saved by street+zip.
          const candidates = [];
          if (shipping) candidates.push({ ...shipping, label: 'Primary', is_default: true });
          for (const extra of (detail?.addresses || [])) {
            const a = zohoAddrToJson(extra);
            if (a) candidates.push({ ...a, label: extra.attention || 'Alternate', is_default: false });
          }
          if (candidates.length) {
            const saved = await db.select().from(patient_shipping_addresses)
              .where(eq(patient_shipping_addresses.patient_id, patientId));
            const seen = new Set(saved.map(a => `${(a.street || '').toLowerCase().trim()}|${(a.zip || '').trim()}`));
            const hasDefault = saved.some(a => a.is_default);
            for (const cand of candidates) {
              if (!cand.street || !cand.zip) continue;
              const key = `${cand.street.toLowerCase().trim()}|${cand.zip.trim()}`;
              if (seen.has(key)) continue;
              seen.add(key);
              await db.insert(patient_shipping_addresses).values({
                patient_id: patientId,
                label: (cand.label || 'Imported').slice(0, 50),
                street: cand.street,
                street2: cand.street2 || null,
                city: cand.city || '',
                state: (cand.state || '').slice(0, 2).toUpperCase() || 'XX',
                zip: cand.zip,
                country: 'US',
                is_default: cand.is_default && !hasDefault,
              });
            }
          }
        } catch (err) {
          job.errors.push(`Contact ${c.contact_name}: ${err.message}`);
        }
      }

      // ── 2. Items → products ───────────────────────────────────────────────
      job.phase = 'products';
      const items = await zoho.fetchItems(n => { job.progress = `${n} items fetched`; });
      for (const it of items) {
        try {
          const sku = (it.sku || it.name.replace(/\s+/g, '-').toUpperCase()).slice(0, 60);
          let [existing] = await db.select().from(products).where(eq(products.zoho_id, String(it.item_id)));
          if (!existing) [existing] = await db.select().from(products).where(eq(products.sku, sku));

          if (existing) {
            await db.update(products).set({
              zoho_id: String(it.item_id),
              unit_price: parseFloat(it.rate || 0).toFixed(2),
            }).where(eq(products.id, existing.id));
            itemMap[it.item_id] = existing.id;
            job.counts.products.updated++;
          } else {
            const [created] = await db.insert(products).values({
              sku,
              name: it.name,
              unit_price: parseFloat(it.rate || 0).toFixed(2),
              unit: it.unit || 'pc',
              active: (it.status || 'active') === 'active',
              zoho_id: String(it.item_id),
            }).returning();
            itemMap[it.item_id] = created.id;
            job.counts.products.created++;
          }
        } catch (err) {
          job.errors.push(`Item ${it.name}: ${err.message}`);
        }
      }

      // ── 3. Sales orders (+ line items from detail) ────────────────────────
      job.phase = 'orders';
      const sos = await zoho.fetchSalesOrders(n => { job.progress = `${n} sales orders listed`; });
      let processed = 0;
      for (const so of sos) {
        try {
          processed++;
          job.progress = `processing order ${processed}/${sos.length}`;

          const patientId = contactMap[so.customer_id];
          if (!patientId) { job.counts.orders.skipped++; job.errors.push(`SO ${so.salesorder_number}: customer not found`); continue; }

          const detail = await zoho.fetchSalesOrderDetail(so.salesorder_id);
          await new Promise(r => setTimeout(r, 200)); // rate-limit friendliness

          const status = mapOrderStatus(so.status);
          const recipient = zohoAddrToJson(detail.shipping_address);
          const createdAt = so.date ? new Date(so.date) : new Date();

          let [existing] = await db.select().from(sales_orders).where(eq(sales_orders.zoho_id, String(so.salesorder_id)));
          if (!existing) {
            [existing] = await db.select().from(sales_orders).where(eq(sales_orders.order_number, so.salesorder_number));
          }

          let orderId;
          if (existing) {
            // Never downgrade shipped/delivered local orders
            const updates = { zoho_id: String(so.salesorder_id), updated_at: new Date() };
            if (!['shipped', 'delivered'].includes(existing.status)) updates.status = status;
            if (recipient && !existing.recipient_address) updates.recipient_address = recipient;
            await db.update(sales_orders).set(updates).where(eq(sales_orders.id, existing.id));
            orderId = existing.id;
            job.counts.orders.updated++;
          } else {
            const [created] = await db.insert(sales_orders).values({
              order_number: so.salesorder_number,
              patient_id: patientId,
              status,
              recipient_address: recipient,
              zoho_id: String(so.salesorder_id),
              created_at: createdAt,
              updated_at: createdAt,
            }).returning();
            orderId = created.id;
            job.counts.orders.created++;
          }
          orderMap[so.salesorder_id] = orderId;
          orderNumMap[so.salesorder_number] = orderId;

          // Replace line items with Zoho's (exact linkage via item_id)
          const lineItems = (detail.line_items || [])
            .filter(li => itemMap[li.item_id])
            .map(li => ({
              order_id: orderId,
              product_id: itemMap[li.item_id],
              quantity: Math.max(1, Math.round(parseFloat(li.quantity || 1))),
              unit_price: parseFloat(li.rate || 0).toFixed(2),
              line_total: parseFloat(li.item_total || (li.rate * li.quantity) || 0).toFixed(2),
            }));
          if (lineItems.length) {
            await db.transaction(async (tx) => {
              await tx.delete(order_items).where(eq(order_items.order_id, orderId));
              await tx.insert(order_items).values(lineItems);
            });
          }
        } catch (err) {
          job.counts.orders.skipped++;
          job.errors.push(`SO ${so.salesorder_number}: ${err.message}`);
        }
      }

      // ── 4. Invoices ───────────────────────────────────────────────────────
      job.phase = 'invoices';
      const invs = await zoho.fetchInvoices(n => { job.progress = `${n} invoices fetched`; });
      for (const inv of invs) {
        try {
          // Link: salesorder_id (if the list provides it) → reference_number
          let orderId = orderMap[inv.salesorder_id] ||
            orderNumMap[inv.reference_number] || null;

          // No linked SO: create a shell order so the invoice history is kept
          // (Zoho allows standalone invoices; our schema requires an order).
          if (!orderId) {
            const patientId = contactMap[inv.customer_id];
            if (!patientId) { job.counts.invoices.unlinked++; continue; }
            const shellNumber = `ZINV-${inv.invoice_number}`;
            const [existingShell] = await db.select().from(sales_orders)
              .where(eq(sales_orders.order_number, shellNumber));
            if (existingShell) {
              orderId = existingShell.id;
            } else {
              const [shell] = await db.insert(sales_orders).values({
                order_number: shellNumber,
                patient_id: patientId,
                status: mapInvoiceStatus(inv.status) === 'paid' ? 'paid' : 'pending_payment',
                notes: `Imported from Zoho invoice ${inv.invoice_number} (no linked sales order).`,
                created_at: inv.date ? new Date(inv.date) : new Date(),
                updated_at: inv.date ? new Date(inv.date) : new Date(),
              }).returning();
              orderId = shell.id;
            }
            orderNumMap[shellNumber] = orderId;
          }

          const pay_status = mapInvoiceStatus(inv.status);
          const total = parseFloat(inv.total || 0);
          const paidAt = pay_status === 'paid'
            ? new Date(inv.last_payment_date || inv.date || Date.now())
            : null;

          let [existing] = await db.select().from(invoices).where(eq(invoices.zoho_id, String(inv.invoice_id)));
          if (!existing) {
            [existing] = await db.select().from(invoices).where(eq(invoices.invoice_number, inv.invoice_number));
          }

          if (existing) {
            await db.update(invoices).set({
              zoho_id: String(inv.invoice_id),
              pay_status,
              total: total.toFixed(2),
              paid_at: existing.paid_at || paidAt,
            }).where(eq(invoices.id, existing.id));
            job.counts.invoices.updated++;
          } else {
            // order_id is unique on invoices — skip if that order already has one
            const [taken] = await db.select({ id: invoices.id }).from(invoices)
              .where(eq(invoices.order_id, orderId)).limit(1);
            if (taken) { job.counts.invoices.unlinked++; continue; }
            await db.insert(invoices).values({
              invoice_number: inv.invoice_number,
              order_id: orderId,
              subtotal: parseFloat(inv.sub_total ?? inv.total ?? 0).toFixed(2),
              shipping_charge: parseFloat(inv.shipping_charge || 0).toFixed(2),
              processing_fee: '0.00',
              total: total.toFixed(2),
              pay_status,
              paid_at: paidAt,
              due_date: inv.due_date || null,
              zoho_id: String(inv.invoice_id),
              created_at: inv.date ? new Date(inv.date) : new Date(),
            });
            job.counts.invoices.created++;
          }
        } catch (err) {
          job.errors.push(`Invoice ${inv.invoice_number}: ${err.message}`);
        }
      }

      // ── 5. Packages → shipments ───────────────────────────────────────────
      job.phase = 'shipments';
      const pkgs = await zoho.fetchPackages(n => { job.progress = `${n} packages fetched`; });
      for (const pkg of pkgs) {
        try {
          const orderId = orderMap[pkg.salesorder_id] || orderNumMap[pkg.salesorder_number] || null;
          if (!orderId) { job.counts.shipments.unlinked++; continue; }

          const delivered = (pkg.status || '').toLowerCase() === 'delivered';
          const shipped = delivered || !!pkg.shipment_order?.tracking_number || (pkg.status || '').toLowerCase() === 'shipped';
          const tracking = pkg.shipment_order?.tracking_number || pkg.tracking_number || null;
          const shipDate = pkg.shipment_order?.date || pkg.date || null;

          const [existing] = await db.select().from(shipments).where(eq(shipments.order_id, orderId)).limit(1);
          if (existing) {
            await db.update(shipments).set({
              fedex_tracking_number: existing.fedex_tracking_number || tracking,
              status: delivered ? 'delivered' : existing.status,
              delivered_at: existing.delivered_at || (delivered ? (shipDate || new Date().toISOString().split('T')[0]) : null),
            }).where(eq(shipments.id, existing.id));
            job.counts.shipments.updated++;
          } else {
            await db.insert(shipments).values({
              order_id: orderId,
              fedex_tracking_number: tracking,
              service_type: 'FEDEX_GROUND',
              ship_date: shipDate,
              status: delivered ? 'delivered' : shipped ? 'in_transit' : 'label_created',
              latest_status: delivered ? 'Delivered' : shipped ? 'In Transit' : 'Label Created',
              delivered_at: delivered ? (shipDate || null) : null,
              raw_import_id: String(pkg.package_id || ''),
              polling_active: false,
            });
            job.counts.shipments.created++;
          }
        } catch (err) {
          job.errors.push(`Package ${pkg.package_number}: ${err.message}`);
        }
      }

      job.status = 'done';
      job.phase = 'complete';
      job.progress = '';
      job.finished_at = new Date().toISOString();
    } catch (err) {
      console.error('[ZohoSync] Fatal:', err);
      job.status = 'error';
      job.errors.push(`FATAL: ${err.message}`);
      job.finished_at = new Date().toISOString();
    }
  })();

  return job;
}

module.exports = { runSync, getJob };
