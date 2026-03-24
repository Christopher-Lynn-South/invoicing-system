const PDFDocument = require('pdfkit');
const fs = require('fs');

const BRAND_COLOR = '#1a56db';
const GRAY = '#6b7280';
const DARK = '#111827';

async function generateInvoicePDF({ invoice, order, patient, items }, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // ─── Header ────────────────────────────────────────────────────────────────
    doc.fontSize(22).fillColor(BRAND_COLOR).font('Helvetica-Bold').text('Corp 001 Inc.', 50, 50);
    doc.fontSize(10).fillColor(GRAY).font('Helvetica').text('orders@001.com.mx  ·  orders.001.com.mx', 50, 76);

    doc.fontSize(28).fillColor(DARK).font('Helvetica-Bold').text('INVOICE', 400, 50, { align: 'right' });
    doc.fontSize(11).fillColor(GRAY).font('Helvetica');
    doc.text(`Invoice #: ${invoice.invoice_number}`, 400, 86, { align: 'right' });
    doc.text(`Order #: ${order.order_number}`, 400, 100, { align: 'right' });
    doc.text(`Date: ${new Date(invoice.created_at).toLocaleDateString('en-US')}`, 400, 114, { align: 'right' });
    doc.text(`Due: ${invoice.due_date}`, 400, 128, { align: 'right' });

    // ─── Divider ───────────────────────────────────────────────────────────────
    doc.moveTo(50, 150).lineTo(565, 150).strokeColor(BRAND_COLOR).lineWidth(2).stroke();

    // ─── Bill To ───────────────────────────────────────────────────────────────
    doc.fontSize(9).fillColor(GRAY).font('Helvetica-Bold').text('BILL TO', 50, 165);
    doc.fontSize(11).fillColor(DARK).font('Helvetica-Bold').text(patient.name, 50, 180);
    doc.font('Helvetica').fontSize(10).fillColor(GRAY);
    if (patient.billing_address) {
      const a = patient.billing_address;
      if (a.street) doc.text(a.street, 50, 195);
      const cityLine = [a.city, a.state, a.zip].filter(Boolean).join(', ');
      if (cityLine) doc.text(cityLine, 50, 210);
      if (a.country) doc.text(a.country, 50, 225);
    }
    if (patient.email) doc.text(patient.email, 50, 240);

    // ─── Items Table ───────────────────────────────────────────────────────────
    const tableTop = 275;
    doc.fontSize(9).fillColor('#fff').font('Helvetica-Bold');
    doc.rect(50, tableTop, 515, 20).fill(BRAND_COLOR);
    doc.text('DESCRIPTION', 55, tableTop + 5);
    doc.text('QTY', 330, tableTop + 5, { width: 60, align: 'right' });
    doc.text('UNIT PRICE', 395, tableTop + 5, { width: 80, align: 'right' });
    doc.text('TOTAL', 478, tableTop + 5, { width: 82, align: 'right' });

    let y = tableTop + 28;
    doc.font('Helvetica').fontSize(10).fillColor(DARK);
    let rowIdx = 0;
    for (const item of items) {
      if (rowIdx % 2 === 0) {
        doc.rect(50, y - 5, 515, 20).fill('#f9fafb');
      }
      doc.fillColor(DARK).text(item.product_name || 'Product', 55, y);
      doc.text(String(item.quantity), 330, y, { width: 60, align: 'right' });
      doc.text(`$${parseFloat(item.unit_price).toFixed(2)}`, 395, y, { width: 80, align: 'right' });
      doc.text(`$${parseFloat(item.line_total).toFixed(2)}`, 478, y, { width: 82, align: 'right' });
      y += 22;
      rowIdx++;
    }

    // ─── Totals ────────────────────────────────────────────────────────────────
    y += 10;
    doc.moveTo(350, y).lineTo(565, y).strokeColor('#e5e7eb').lineWidth(1).stroke();
    y += 12;

    const subtotal = parseFloat(invoice.subtotal);
    const fee = parseFloat(invoice.processing_fee || 0);
    const total = parseFloat(invoice.total);

    doc.fontSize(10).fillColor(GRAY).font('Helvetica');
    doc.text('Subtotal:', 350, y, { width: 130, align: 'right' });
    doc.fillColor(DARK).text(`$${subtotal.toFixed(2)}`, 480, y, { width: 80, align: 'right' });
    y += 18;

    if (fee > 0) {
      doc.fillColor(GRAY).font('Helvetica').text('CC Processing Fee (3.9%):', 350, y, { width: 130, align: 'right' });
      doc.fillColor(DARK).text(`$${fee.toFixed(2)}`, 480, y, { width: 80, align: 'right' });
      y += 18;
    }

    doc.moveTo(350, y).lineTo(565, y).strokeColor(BRAND_COLOR).lineWidth(1.5).stroke();
    y += 8;

    doc.fontSize(13).fillColor(BRAND_COLOR).font('Helvetica-Bold');
    doc.text('TOTAL DUE:', 350, y, { width: 130, align: 'right' });
    doc.text(`$${total.toFixed(2)} USD`, 480, y, { width: 80, align: 'right' });

    // ─── Payment instructions ──────────────────────────────────────────────────
    y += 50;
    doc.fontSize(9).fillColor(GRAY).font('Helvetica');
    doc.text('Payment Methods: Credit Card, ACH Bank Transfer, or USDC on Polygon', 50, y);
    doc.text(`Pay online: ${process.env.BASE_URL || 'https://orders.001.com.mx'}/pay/${invoice.id}`, 50, y + 14);

    // ─── Footer ────────────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor(GRAY).text(
      'Thank you for your business. For questions contact orders@001.com.mx',
      50, 710, { align: 'center', width: 515 }
    );

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { generateInvoicePDF };
