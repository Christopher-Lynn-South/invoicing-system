const twilio = require('twilio');

const getBaseUrl = () => process.env.BASE_URL || '';
const getCompanyName = () => process.env.COMPANY_NAME || 'OrderFlow';

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

function getFrom() {
  return process.env.TWILIO_FROM_NUMBER || null;
}

/**
 * Normalize a phone number to E.164 format.
 * Accepts +XXXXXXXXXXX, 10-digit US (adds +1), or 12-digit starting with 1 (adds +).
 * Returns null if the number can't be safely normalized.
 */
function toE164(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[\s\-().+]/g, '');
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;          // US 10-digit
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;           // US with country code
  if (/^52\d{10}$/.test(digits)) return `+${digits}`;          // MX with country code
  if (phone.trim().startsWith('+')) return `+${digits}`;        // already has +
  return null;
}

async function sendSMS(to, body) {
  const client = getClient();
  const from = getFrom();
  if (!client || !from) {
    console.warn('SMS skipped: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER not set');
    return false;
  }
  const normalized = toE164(to);
  if (!normalized) {
    console.warn(`SMS skipped: cannot normalize phone number "${to}" to E.164`);
    return false;
  }
  await client.messages.create({ to: normalized, from, body });
  return true;
}

async function sendInvoiceSMS(patient, invoice) {
  if (!patient.phone) return false;
  const payUrl = invoice.pay_token
    ? `${getBaseUrl()}/pay/t/${invoice.pay_token}`
    : `${getBaseUrl()}/pay/${invoice.id}`;
  const body = `${getCompanyName()}: Invoice ${invoice.invoice_number} for $${parseFloat(invoice.total).toFixed(2)} USD is ready. Pay here: ${payUrl}`;
  try {
    return await sendSMS(patient.phone, body);
  } catch (err) {
    console.error('Invoice SMS failed:', err.message);
    return false;
  }
}

async function sendShippingSMS(patient, order, shipment) {
  if (!patient.phone) return false;
  const trackUrl = `https://www.fedex.com/fedextrack/?tracknumbers=${shipment.fedex_tracking_number}`;
  const body = `${getCompanyName()}: Order ${order.order_number} has shipped via FedEx. Tracking: ${shipment.fedex_tracking_number} — ${trackUrl}`;
  try {
    return await sendSMS(patient.phone, body);
  } catch (err) {
    console.error('Shipping SMS failed:', err.message);
    return false;
  }
}

async function sendCustomSMS(patient, order, message) {
  if (!patient.phone) return false;
  const companyName = getCompanyName();
  const fullMessage = `[${companyName}] Order ${order.order_number}: ${message}`;
  try {
    return await sendSMS(patient.phone, fullMessage.substring(0, 1600));
  } catch (err) {
    console.error('Custom SMS failed:', err.message);
    return false;
  }
}

// Refill reminder — patient can reply YES to confirm, or use the link
async function sendReminderSMS(patient, product, rule) {
  if (!patient.phone) return false;
  const url = `${getBaseUrl()}/reorder/${rule.id}`;
  const body = `${getCompanyName()}: Time to refill ${product.name}. Reply YES to reorder, or tap: ${url}`;
  try {
    return await sendSMS(patient.phone, body);
  } catch (err) {
    console.error('Reminder SMS failed:', err.message);
    return false;
  }
}

// Autopay heads-up — sent 3 days before the automatic charge
async function sendAutopayNoticeSMS(patient, product, chargeDateStr) {
  if (!patient.phone) return false;
  const body = `${getCompanyName()}: Your ${product.name} refill will be charged automatically on ${chargeDateStr} and shipped to you. Reply SKIP to skip this refill, or manage it at ${getBaseUrl()}/customer/portal`;
  try {
    return await sendSMS(patient.phone, body);
  } catch (err) {
    console.error('Autopay notice SMS failed:', err.message);
    return false;
  }
}

// Abandoned checkout nudge
async function sendNudgeSMS(patient, invoice) {
  if (!patient.phone) return false;
  const payUrl = invoice.pay_token
    ? `${getBaseUrl()}/pay/t/${invoice.pay_token}`
    : `${getBaseUrl()}/pay/${invoice.id}`;
  const body = `${getCompanyName()}: Your invoice ${invoice.invoice_number} ($${parseFloat(invoice.total).toFixed(2)}) is still waiting. Complete payment: ${payUrl}`;
  try {
    return await sendSMS(patient.phone, body);
  } catch (err) {
    console.error('Nudge SMS failed:', err.message);
    return false;
  }
}

module.exports = {
  sendSMS, toE164,
  sendInvoiceSMS, sendShippingSMS, sendCustomSMS,
  sendReminderSMS, sendAutopayNoticeSMS, sendNudgeSMS,
};
