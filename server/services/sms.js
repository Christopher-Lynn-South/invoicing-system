const twilio = require('twilio');

const getBaseUrl = () => process.env.BASE_URL || 'https://orders.001.com.mx';

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
  const payUrl = `${getBaseUrl()}/pay/${invoice.id}`;
  const body = `Corp 001: Invoice ${invoice.invoice_number} for $${parseFloat(invoice.total).toFixed(2)} USD is ready. Pay here: ${payUrl}`;
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
  const body = `Corp 001: Order ${order.order_number} has shipped via FedEx. Tracking: ${shipment.fedex_tracking_number} — ${trackUrl}`;
  try {
    return await sendSMS(patient.phone, body);
  } catch (err) {
    console.error('Shipping SMS failed:', err.message);
    return false;
  }
}

module.exports = { sendInvoiceSMS, sendShippingSMS };
