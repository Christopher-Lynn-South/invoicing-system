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

const getFrom = () => process.env.MAIL_FROM || '';
const getBaseUrl = () => process.env.BASE_URL || '';
const getCompanyName = () => process.env.COMPANY_NAME || 'OrderFlow';
const getCompanyEmail = () => process.env.COMPANY_EMAIL || process.env.MAIL_USER || '';

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
  const payUrl = invoice.pay_token
    ? `${getBaseUrl()}/pay/t/${invoice.pay_token}`
    : `${getBaseUrl()}/pay/${invoice.id}`;
  await getTransporter().sendMail({
    from: getFrom(),
    to,
    cc: cc.length ? cc : undefined,
    subject: `Invoice ${invoice.invoice_number} from ${getCompanyName()} — $${parseFloat(invoice.total).toFixed(2)} due`,
    html: htmlWrap(`
      <h2>Invoice Ready</h2>
      <p>Dear ${patient.name},</p>
      <p>Your invoice <strong>${invoice.invoice_number}</strong> for order <strong>${order.order_number}</strong> is ready.</p>
      <p><strong>Amount Due: $${parseFloat(invoice.total).toFixed(2)} USD</strong></p>
      <p>Due Date: ${invoice.due_date}</p>
      <a href="${payUrl}" class="btn">Pay Now</a>
      <div class="footer">${getCompanyName()} · ${getCompanyEmail()}</div>
    `),
  });
}

async function sendPaymentConfirmation(patient, order, invoice) {
  const { to, cc } = await getRecipients(patient.id, patient.email);
  if (!to) return;
  const { getTemplate, renderTemplate } = require('./email-templates');
  const template = getTemplate('payment_thank_you');
  const { subject, body } = renderTemplate(template, { order, patient, invoice, shipment: null });
  const htmlBody = body.split('\n').map(line => line.trim() ? `<p>${escapeHtml(line)}</p>` : '').join('');
  await getTransporter().sendMail({
    from: getFrom(),
    to,
    cc: cc.length ? cc : undefined,
    subject,
    html: htmlWrap(`${htmlBody}<div class="footer">${escapeHtml(getCompanyName())} · ${escapeHtml(getCompanyEmail())}</div>`),
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
      <div class="footer">${getCompanyName()} · ${getCompanyEmail()}</div>
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
      <div class="footer">${getCompanyName()} · ${getCompanyEmail()}</div>
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
      <div class="footer">${getCompanyName()} · ${getCompanyEmail()}</div>
    `),
  });
}

function fmtAddr(a) {
  if (!a) return 'No address on file';
  return [a.street, a.street2, [a.city, a.state, a.zip].filter(Boolean).join(', '), a.country]
    .filter(Boolean).join('<br>');
}

async function sendRefillRequestEmail(patient, product, request) {
  if (!patient.email) return;
  const baseUrl = getBaseUrl();
  const confirmUrl = `${baseUrl}/refill/confirm/${request.token}`;
  const declineUrl = `${baseUrl}/refill/decline/${request.token}`;
  const shipDate = request.proposed_ship_date
    ? new Date(request.proposed_ship_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : 'as soon as possible';
  await getTransporter().sendMail({
    from: getFrom(),
    to: patient.email,
    subject: `Refill ready for ${product.name} — confirm your shipment`,
    html: htmlWrap(`
      <h2>Time to Refill Your Prescription</h2>
      <p>Dear ${escapeHtml(patient.name)},</p>
      <p>Your <strong>${escapeHtml(product.name)}</strong> refill is ready to ship.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:6px 0;color:#6b7280;width:140px">Ship date:</td><td><strong>${escapeHtml(shipDate)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Service:</td><td><strong>FedEx Priority Overnight</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Ship to:</td><td>${fmtAddr(request.ship_address)}</td></tr>
      </table>
      <p>Is this address correct and would you like us to proceed?</p>
      <div style="margin:24px 0;display:flex;gap:12px">
        <a href="${confirmUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:bold;font-size:16px;margin-right:12px">
          ✓ Yes, Ship My Refill
        </a>
        <a href="${declineUrl}" style="display:inline-block;background:#e5e7eb;color:#374151;text-decoration:none;padding:14px 24px;border-radius:6px;font-weight:bold;font-size:16px">
          ✗ No Thanks
        </a>
      </div>
      <p style="font-size:12px;color:#9ca3af">This link expires in 7 days. If the address above is wrong, please contact us before confirming.</p>
      <div class="footer">${escapeHtml(getCompanyName())} · ${escapeHtml(getCompanyEmail())}</div>
    `),
  });
}

async function sendRefillRequestSMS(patient, product, request) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !auth || !from || !patient.phone) return;

  const twilio = require('twilio')(sid, auth);
  const confirmUrl = `${getBaseUrl()}/refill/confirm/${request.token}`;
  const addrLine = request.ship_address
    ? `${request.ship_address.street || ''}, ${request.ship_address.city || ''} ${request.ship_address.state || ''}`.trim().replace(/^,\s*/, '')
    : 'address on file';
  const shipDate = request.proposed_ship_date
    ? new Date(request.proposed_ship_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'ASAP';

  await twilio.messages.create({
    from,
    to: patient.phone,
    body: `Hi ${patient.name}, your ${product.name} refill is ready. Ship ${shipDate} via FedEx Overnight to ${addrLine}. To confirm: ${confirmUrl}`,
  });
}

async function sendRefillConfirmedAdminNotification(patient, product, order, invoice, shipAddress) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  const baseUrl = getBaseUrl();
  const orderUrl = `${baseUrl}/orders/${order.id}`;
  await getTransporter().sendMail({
    from: getFrom(),
    to: adminEmail,
    subject: `🟢 Refill confirmed — ${patient.name} paid, ready to ship`,
    html: htmlWrap(`
      <h2>Refill Confirmed — Action Required</h2>
      <p><strong>${escapeHtml(patient.name)}</strong> has confirmed their refill and an invoice has been sent for payment.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:6px 0;color:#6b7280;width:140px">Patient:</td><td><strong>${escapeHtml(patient.name)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Product:</td><td>${escapeHtml(product.name)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Order #:</td><td>${escapeHtml(order.order_number)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Invoice:</td><td>${escapeHtml(invoice.invoice_number)} — $${parseFloat(invoice.total).toFixed(2)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;vertical-align:top">Ship to:</td><td>${fmtAddr(shipAddress)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Service:</td><td>FedEx Priority Overnight</td></tr>
      </table>
      <p><strong>Next steps:</strong> Once payment clears, create the FedEx label and ship.</p>
      <a href="${orderUrl}" class="btn">View Order</a>
      <div class="footer">OrderFlow · Automated Refill System</div>
    `),
  });
}

async function sendRefillPaymentAdminNotification(patient, order, invoice) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;
  const baseUrl = getBaseUrl();
  const orderUrl = `${baseUrl}/orders/${order.id}`;
  await getTransporter().sendMail({
    from: getFrom(),
    to: adminEmail,
    subject: `💰 Payment received — ${patient.name} refill ready to ship`,
    html: htmlWrap(`
      <h2>Payment Received — Ship Now</h2>
      <p><strong>${escapeHtml(patient.name)}</strong> has paid invoice <strong>${escapeHtml(invoice.invoice_number)}</strong>.</p>
      <p>Amount: <strong>$${parseFloat(invoice.total).toFixed(2)} USD</strong></p>
      <p>Please create the FedEx Priority Overnight label and ship this order.</p>
      <a href="${orderUrl}" class="btn">View Order &amp; Create Label</a>
      <div class="footer">OrderFlow · Automated Refill System</div>
    `),
  });
}

// Generic sendMail helper used by patient-auth and settings test
async function sendMail(options) {
  await getTransporter().sendMail({ from: getFrom(), ...options });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Staff-composed email to a patient — plain-text body rendered as HTML paragraphs
// Templates already include their own greeting; do not add one here.
async function sendCustomEmail(patient, order, { subject, body }) {
  const { to, cc } = await getRecipients(patient.id, patient.email);
  if (!to) return;
  const htmlBody = body
    .split('\n')
    .map(line => line.trim() ? `<p>${escapeHtml(line)}</p>` : '')
    .join('');
  await getTransporter().sendMail({
    from: getFrom(),
    to,
    cc: cc.length ? cc : undefined,
    subject,
    html: htmlWrap(`${htmlBody}<div class="footer">${escapeHtml(getCompanyName())} · ${escapeHtml(getCompanyEmail())}</div>`),
  });
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
  sendCustomEmail,
  sendRefillRequestEmail,
  sendRefillRequestSMS,
  sendRefillConfirmedAdminNotification,
  sendRefillPaymentAdminNotification,
};
