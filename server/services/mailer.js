require('dotenv').config();
const nodemailer = require('nodemailer');
const { db } = require('../db');
const { patient_contacts } = require('../db/schema');
const { eq, and } = require('drizzle-orm');
const { onKeyChange } = require('./config');

// ─── Lazy transporter — recreated whenever SMTP settings change ───────────────
let _transporter = null;

function buildTransporter() {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'mail.001.com.mx',
    port: parseInt(process.env.MAIL_PORT || '587', 10),
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.MAIL_USER || 'orders@001.com.mx',
      pass: process.env.MAIL_PASS || '',
    },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production',
      minVersion: 'TLSv1.2',
    },
  });
}

function getTransporter() {
  if (!_transporter) {
    _transporter = buildTransporter();
  }
  return _transporter;
}

function invalidateTransporter() {
  _transporter = null;
}

// Invalidate whenever any SMTP setting changes
['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS'].forEach(k => onKeyChange(k, invalidateTransporter));

// Expose transporter getter for health check endpoint
const transporter = { verify: (...args) => getTransporter().verify(...args) };

// Verify on startup (non-fatal)
setTimeout(() => {
  getTransporter().verify((err) => {
    if (err) console.error('SMTP connection failed:', err.message);
    else console.log('Mailer OK');
  });
}, 0);

async function getRecipients(patientId, patientEmail) {
  const contacts = await db.select().from(patient_contacts)
    .where(and(
      eq(patient_contacts.patient_id, patientId),
      eq(patient_contacts.receives_notifications, true)
    ));
  const cc = contacts
    .filter(c => c.email)
    .map(c => `"${c.first_name} ${c.last_name}" <${c.email}>`);
  return { to: patientEmail, cc };
}

const getFrom = () => process.env.MAIL_FROM || '"OrderFlow" <orders@001.com.mx>';
const getBaseUrl = () => process.env.BASE_URL || 'https://orders.001.com.mx';

function htmlWrap(body) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;color:#111827;background:#f9fafb;margin:0;padding:0}
  .card{max-width:600px;margin:40px auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e5e7eb}
  h2{color:#1a56db;margin-top:0}
  .btn{display:inline-block;background:#1a56db;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;margin-top:16px}
  .footer{margin-top:32px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px}
</style></head>
<body><div class="card">${body}</div></body>
</html>`;
}

async function sendInvoiceEmail(patient, order, invoice) {
  const { to, cc } = await getRecipients(patient.id, patient.email);
  if (!to) return;
  const payUrl = `${getBaseUrl()}/pay/${invoice.id}`;
  await getTransporter().sendMail({
    from: getFrom(),
    to,
    cc: cc.length ? cc : undefined,
    subject: `Invoice ${invoice.invoice_number} from Corp 001 — $${parseFloat(invoice.total).toFixed(2)} due`,
    html: htmlWrap(`
      <h2>Invoice Ready</h2>
      <p>Dear ${patient.name},</p>
      <p>Your invoice <strong>${invoice.invoice_number}</strong> for order <strong>${order.order_number}</strong> is ready.</p>
      <p><strong>Amount Due: $${parseFloat(invoice.total).toFixed(2)} USD</strong></p>
      <p>Due Date: ${invoice.due_date}</p>
      <a href="${payUrl}" class="btn">Pay Now</a>
      <div class="footer">Corp 001 Inc. · orders@001.com.mx</div>
    `),
  });
}

async function sendPaymentConfirmation(patient, order, invoice, method) {
  const { to, cc } = await getRecipients(patient.id, patient.email);
  if (!to) return;
  const methodLabel = { stripe_cc: 'Credit Card', ach: 'ACH Bank Transfer', usdc: 'USDC (Polygon)' }[method] || method;
  const subjects = {
    stripe_cc: `Payment received — Order ${order.order_number} confirmed`,
    ach: `ACH payment confirmed — Order ${order.order_number}`,
    usdc: `USDC payment confirmed — Order ${order.order_number}`,
  };
  await getTransporter().sendMail({
    from: getFrom(),
    to,
    cc: cc.length ? cc : undefined,
    subject: subjects[method] || `Payment confirmed — Order ${order.order_number}`,
    html: htmlWrap(`
      <h2>Payment Confirmed</h2>
      <p>Dear ${patient.name},</p>
      <p>We have received your payment of <strong>$${parseFloat(invoice.total).toFixed(2)} USD</strong> for order <strong>${order.order_number}</strong>.</p>
      <p>Payment method: ${methodLabel}</p>
      <p>Your order is now being prepared for shipment.</p>
      <div class="footer">Corp 001 Inc. · orders@001.com.mx</div>
    `),
  });
}

async function sendShippingNotification(patient, order, shipment) {
  const { to, cc } = await getRecipients(patient.id, patient.email);
  if (!to) return;
  const trackUrl = `https://www.fedex.com/fedextrack/?tracknumbers=${shipment.fedex_tracking_number}`;
  await getTransporter().sendMail({
    from: getFrom(),
    to,
    cc: cc.length ? cc : undefined,
    subject: `Your order ${order.order_number} has shipped — Track: ${shipment.fedex_tracking_number}`,
    html: htmlWrap(`
      <h2>Your Order Has Shipped!</h2>
      <p>Dear ${patient.name},</p>
      <p>Order <strong>${order.order_number}</strong> has been shipped via FedEx.</p>
      <p><strong>Tracking Number: ${shipment.fedex_tracking_number}</strong></p>
      ${shipment.estimated_delivery ? `<p>Estimated Delivery: ${shipment.estimated_delivery}</p>` : ''}
      <a href="${trackUrl}" class="btn">Track Package</a>
      <div class="footer">Corp 001 Inc. · orders@001.com.mx</div>
    `),
  });
}

async function sendTrackingUpdate(patient, order, shipment, eventCode, eventDescription) {
  const { to, cc } = await getRecipients(patient.id, patient.email);
  if (!to) return;
  const trackUrl = `https://www.fedex.com/fedextrack/?tracknumbers=${shipment.fedex_tracking_number}`;

  const subjects = {
    OD: `Delivery today — Order ${order.order_number} is out for delivery`,
    DL: `Delivered! — Order ${order.order_number} has been delivered`,
    DE: `Delivery exception on Order ${order.order_number} — we are following up`,
    SE: `Shipment exception — Order ${order.order_number}`,
    CA: `Shipment cancelled — contact us about Order ${order.order_number}`,
    RS: `URGENT: Order ${order.order_number} is returning to sender`,
  };

  const subject = subjects[eventCode] || `Shipping update for Order ${order.order_number}`;

  await getTransporter().sendMail({
    from: getFrom(),
    to,
    cc: cc.length ? cc : undefined,
    subject,
    html: htmlWrap(`
      <h2>Shipping Update</h2>
      <p>Dear ${patient.name},</p>
      <p>Update for order <strong>${order.order_number}</strong>:</p>
      <p><strong>${eventDescription}</strong></p>
      <p>Tracking: ${shipment.fedex_tracking_number}</p>
      <a href="${trackUrl}" class="btn">Track Package</a>
      <div class="footer">Corp 001 Inc. · orders@001.com.mx</div>
    `),
  });
}

async function sendAdminAlert(subject, body) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  await getTransporter().sendMail({
    from: getFrom(),
    to: adminEmail,
    subject,
    html: htmlWrap(`<h2>${subject}</h2>${body}<div class="footer">OrderFlow System Alert</div>`),
  });
}

async function sendReminderEmail(patient, product, rule) {
  if (!patient.email) return;
  const reorderUrl = `${getBaseUrl()}/reorder/${rule.id}`;
  const lastOrderDate = rule.last_reminded_at
    ? new Date(rule.last_reminded_at).toLocaleDateString('en-US')
    : 'N/A';
  await getTransporter().sendMail({
    from: getFrom(),
    to: patient.email,
    subject: `Time to restock — ${product.name} for ${patient.name}`,
    html: htmlWrap(`
      <h2>Time to Restock</h2>
      <p>Dear ${patient.name},</p>
      <p>It's time to reorder <strong>${product.name}</strong>.</p>
      <p>Refill interval: every ${rule.interval_days} days</p>
      <p>Last reminded: ${lastOrderDate}</p>
      <a href="${reorderUrl}" class="btn">Place Reorder</a>
      <p style="margin-top:16px;font-size:12px;color:#9ca3af">
        <a href="${getBaseUrl()}/reminders">Manage reminder settings</a>
      </p>
      <div class="footer">Corp 001 Inc. · orders@001.com.mx</div>
    `),
  });
}

// Generic sendMail helper used by patient-auth and settings test
async function sendMail(options) {
  await getTransporter().sendMail({ from: getFrom(), ...options });
}

module.exports = {
  transporter,
  sendMail,
  invalidateTransporter,
  sendInvoiceEmail,
  sendPaymentConfirmation,
  sendShippingNotification,
  sendTrackingUpdate,
  sendAdminAlert,
  sendReminderEmail,
};
