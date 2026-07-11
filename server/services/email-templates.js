// ─────────────────────────────────────────────────────────────────────────────
// Email Template Registry
// ─────────────────────────────────────────────────────────────────────────────
// Each template receives a context object: { order, patient, invoice, shipment }
// subject and body are functions that return plain text (the mailer converts to HTML).
//
// autoSend: when set, the mailer calls this template automatically on that event.
//   Supported events: 'payment_received'
//
// HOW TO ADD A NEW TEMPLATE:
//   1. Copy one of the existing entries below.
//   2. Give it a unique `id` and human-readable `name`.
//   3. Write the `subject` and `body` functions — use any context fields you need.
//   4. Add it to the array. It will appear automatically in the frontend email composer.
// ─────────────────────────────────────────────────────────────────────────────

const templates = [

  // ─── Transactional (auto-sent) ────────────────────────────────────────────

  {
    id: 'payment_thank_you',
    name: 'Payment Thank You (auto-sent)',
    autoSend: 'payment_received',
    subject: ({ order }) =>
      `Thank you for your payment — Order ${order.order_number}`,
    body: ({ patient, order, invoice }) => {
      const methodLabel = {
        stripe_cc: 'Credit Card',
        ach: 'ACH Bank Transfer',
        usdc: 'USDC (Polygon)',
        usdc_polygon: 'USDC (Polygon)',
        usdc_ethereum: 'USDC (Ethereum)',
      }[invoice?.pay_method] || (invoice?.pay_method || '');

      return [
        `Dear ${patient.name},`,
        '',
        `Thank you for your payment! We have received your payment of $${parseFloat(invoice?.total || 0).toFixed(2)} USD for order ${order.order_number}.`,
        '',
        invoice?.invoice_number ? `Invoice #: ${invoice.invoice_number}` : '',
        methodLabel ? `Payment method: ${methodLabel}` : '',
        invoice?.paid_at
          ? `Payment date: ${new Date(invoice.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
          : '',
        '',
        'Your order is now being prepared and we will notify you as soon as it ships.',
        '',
        'Thank you for choosing us — we truly appreciate your business!',
      ].filter(l => l !== null).join('\n');
    },
  },

  // ─── Staff-composed templates ──────────────────────────────────────────────

  {
    id: 'transaction_summary',
    name: 'Transaction Summary',
    subject: ({ order }) =>
      `Transaction summary — Order ${order.order_number}`,
    body: ({ patient, order, invoice }) => [
      `Dear ${patient.name},`,
      '',
      `Here is your transaction summary for order ${order.order_number}:`,
      '',
      invoice?.invoice_number ? `Invoice #:        ${invoice.invoice_number}` : '',
      invoice?.total        ? `Order total:      $${parseFloat(invoice.total).toFixed(2)} USD` : '',
      invoice?.pay_method   ? `Payment method:   ${invoice.pay_method.replace(/_/g, ' ').toUpperCase()}` : '',
      invoice?.paid_at
        ? `Payment date:     ${new Date(invoice.paid_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
        : '',
      '',
      'Please keep this for your records. Do not hesitate to contact us with any questions.',
    ].filter(l => l !== null).join('\n'),
  },

  {
    id: 'shipping_notice',
    name: 'Shipping Notice + Instructions',
    subject: ({ order }) =>
      `Your order ${order.order_number} has shipped`,
    body: ({ patient, order, shipment }) => [
      `Dear ${patient.name},`,
      '',
      `Great news — your order ${order.order_number} has been shipped via FedEx.`,
      '',
      shipment?.fedex_tracking_number ? `Tracking number:     ${shipment.fedex_tracking_number}` : '',
      shipment?.service_type          ? `Service:             ${shipment.service_type}` : '',
      shipment?.estimated_delivery    ? `Estimated delivery:  ${shipment.estimated_delivery}` : '',
      '',
      'Shipping instructions:',
      '(Edit this section with any special handling instructions, e.g. refrigerate upon arrival, signature required, etc.)',
      '',
      shipment?.fedex_tracking_number
        ? `Track your package: https://www.fedex.com/fedextrack/?tracknumbers=${shipment.fedex_tracking_number}`
        : '',
      '',
      'If you have any questions about your shipment please reply to this email.',
    ].filter(l => l !== null).join('\n'),
  },

  {
    id: 'order_confirmation',
    name: 'Order Confirmation',
    subject: ({ order }) =>
      `Order received — ${order.order_number}`,
    body: ({ patient, order }) => [
      `Dear ${patient.name},`,
      '',
      `We have received your order ${order.order_number} and it is currently being reviewed.`,
      '',
      'You will receive a separate email with your invoice and payment instructions shortly.',
      '',
      'If you have any questions in the meantime, please do not hesitate to reach out.',
    ].filter(l => l !== null).join('\n'),
  },

  {
    id: 'reorder_reminder',
    name: 'Reorder Reminder',
    subject: ({ patient }) =>
      `Time to reorder — a note from our team`,
    body: ({ patient }) => [
      `Dear ${patient.name},`,
      '',
      `We wanted to reach out and let you know that based on your history it may be time to reorder.`,
      '',
      'Please log in to your patient portal or reply to this email and we will be happy to assist you.',
      '',
      'Thank you for being a valued patient!',
    ].filter(l => l !== null).join('\n'),
  },

  {
    id: 'delivery_followup',
    name: 'Post-Delivery Follow-up',
    subject: ({ order }) =>
      `Following up on your recent order ${order.order_number}`,
    body: ({ patient, order }) => [
      `Dear ${patient.name},`,
      '',
      `We hope your recent order ${order.order_number} has arrived safely.`,
      '',
      'We would love to hear how everything went. If you have any questions, concerns, or feedback please do not hesitate to reply.',
      '',
      'Thank you for your continued trust in us!',
    ].filter(l => l !== null).join('\n'),
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ADD NEW TEMPLATES BELOW THIS LINE
  // Copy the block format above — give each template a unique id and name.
  // ─────────────────────────────────────────────────────────────────────────

];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTemplate(id) {
  return templates.find(t => t.id === id) || null;
}

/** Render a template with live order context. Returns { subject, body }. */
function renderTemplate(template, context) {
  return {
    subject: typeof template.subject === 'function' ? template.subject(context) : template.subject,
    body: typeof template.body === 'function' ? template.body(context) : template.body,
  };
}

/** Return all templates rendered for a given order context (for the frontend picker). */
function renderAllForOrder(context) {
  return templates.map(t => ({
    id: t.id,
    name: t.name,
    autoSend: t.autoSend || null,
    ...renderTemplate(t, context),
  }));
}

module.exports = { templates, getTemplate, renderTemplate, renderAllForOrder };
