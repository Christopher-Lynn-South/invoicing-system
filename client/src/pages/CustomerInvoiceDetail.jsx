import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { fmtCurrency, fmtDate, fmtDatetime } from '../lib/utils';

const PAY_STATUS_COLOR = {
  paid: 'var(--success)',
  pending: 'var(--warning)',
  failed: 'var(--danger)',
};

const SHIP_STATUS_LABEL = {
  label_created: 'Label Created',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  exception: 'Exception',
};

function Badge({ label, color }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
      color, background: color + '22', padding: '3px 10px', borderRadius: 20,
    }}>{label}</span>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, marginBottom: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>{title}</h3>
      {children}
    </div>
  );
}

export default function CustomerInvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [noteSending, setNoteSending] = useState(false);
  const [noteMsg, setNoteMsg] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await api.get(`/customer/invoices/${id}`);
      setInvoice(res.data);
    } catch (err) {
      if (err.response?.status === 401) { window.location.href = '/login'; return; }
      if (err.response?.status === 403) setError('You do not have access to this invoice.');
      else if (err.response?.status === 404) setError('Invoice not found.');
      else setError('Could not load this invoice. Please try again.');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function sendNote(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setNoteSending(true); setNoteMsg('');
    try {
      await api.patch(`/customer/invoices/${id}/note`, { note });
      setNoteMsg('Message sent. Our team will follow up with you.');
      setNote('');
    } catch {
      setNoteMsg('Failed to send message. Please try again.');
    }
    setNoteSending(false);
  }

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
      <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--brand-mono)' }}>Loading…</div>
    </div>
  );

  if (error) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 16 }}>{error}</div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={load} style={{
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>Retry</button>
          <Link to="/customer/portal" style={{
            display: 'inline-block', textDecoration: 'none', color: 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '8px 20px', fontSize: 13,
          }}>← Back to portal</Link>
        </div>
      </div>
    </div>
  );

  const payColor = PAY_STATUS_COLOR[invoice.pay_status] || 'var(--text-muted)';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => navigate('/customer/portal')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 }}>←</button>
        <div>
          <span style={{ fontFamily: 'var(--brand-serif)', fontSize: 18 }}>Invoice {invoice.invoice_number}</span>
          <span style={{ marginLeft: 12 }}>
            <Badge label={invoice.pay_status} color={payColor} />
          </span>
        </div>
        {invoice.pay_status !== 'paid' && (
          <Link to={`/pay/${invoice.id}`} style={{
            marginLeft: 'auto', background: 'var(--accent)', color: '#fff',
            padding: '8px 20px', borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: 'none',
          }}>
            Pay Now
          </Link>
        )}
      </div>

      <div style={{ maxWidth: 700, margin: '32px auto', padding: '0 24px' }}>

        {/* Invoice summary */}
        <Section title="Invoice Summary">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
            <span style={{ color: 'var(--text-muted)' }}>Order</span>
            <span>{invoice.order_number}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
            <span style={{ color: 'var(--text-muted)' }}>Invoice date</span>
            <span>{fmtDate(invoice.created_at)}</span>
          </div>
          {invoice.due_date && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Due date</span>
              <span>{fmtDate(invoice.due_date)}</span>
            </div>
          )}
          {invoice.paid_at && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Paid on</span>
              <span style={{ color: 'var(--success)' }}>{fmtDatetime(invoice.paid_at)}</span>
            </div>
          )}
          {invoice.pay_method && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Payment method</span>
              <span style={{ textTransform: 'capitalize' }}>{invoice.pay_method.replace('_', ' ')}</span>
            </div>
          )}
          {invoice.pdf_url && (
            <div style={{ marginTop: 12 }}>
              <a href={invoice.pdf_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>
                Download PDF →
              </a>
            </div>
          )}
        </Section>

        {/* Line items */}
        {invoice.items?.length > 0 && (
          <Section title="Items">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--text-muted)', fontWeight: 500 }}>Item</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--text-muted)', fontWeight: 500 }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--text-muted)', fontWeight: 500 }}>Unit</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--text-muted)', fontWeight: 500 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 0' }}>{item.product_name}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>×{item.quantity}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(item.unit_price)}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(item.line_total)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ padding: '10px 0', color: 'var(--text-muted)' }}>Subtotal</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(invoice.subtotal)}</td>
                </tr>
                {parseFloat(invoice.processing_fee) < 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: '4px 0', color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>Discount (ACH/USDC)</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>−{fmtCurrency(Math.abs(invoice.processing_fee))}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={3} style={{ padding: '10px 0', fontWeight: 700, fontSize: 15 }}>Total</td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontWeight: 700, fontSize: 18, color: 'var(--success)' }}>{fmtCurrency(invoice.total)}</td>
                </tr>
              </tbody>
            </table>
          </Section>
        )}

        {/* Shipment */}
        {invoice.shipment ? (
          <Section title="Shipment">
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Status</span>
              <Badge
                label={SHIP_STATUS_LABEL[invoice.shipment.status] || invoice.shipment.status}
                color={invoice.shipment.status === 'delivered' ? 'var(--success)' : invoice.shipment.status === 'exception' ? 'var(--danger)' : 'var(--accent)'}
              />
            </div>
            {invoice.shipment.fedex_tracking_number && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Tracking</span>
                <span style={{ fontFamily: 'var(--brand-mono)', fontSize: 12 }}>{invoice.shipment.fedex_tracking_number}</span>
              </div>
            )}
            {invoice.shipment.ship_date && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Shipped</span>
                <span>{fmtDate(invoice.shipment.ship_date)}</span>
              </div>
            )}
            {invoice.shipment.estimated_delivery && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)' }}>Est. delivery</span>
                <span>{fmtDate(invoice.shipment.estimated_delivery)}</span>
              </div>
            )}
            {invoice.shipment.latest_status && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 13 }}>
                {invoice.shipment.latest_status}
              </div>
            )}
          </Section>
        ) : invoice.order_status !== 'paid' && (
          <Section title="Shipment">
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No shipment created yet.</p>
          </Section>
        )}

        {/* Message to team */}
        <Section title="Message Our Team">
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            Have a question or need to make a change to this order? Send us a message and we'll follow up.
          </p>
          <form onSubmit={sendNote}>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Please update my shipping address to…"
              rows={3}
              required
              style={{
                width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 12, fontSize: 13, color: 'var(--text-primary)',
                resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            {noteMsg && (
              <p style={{ fontSize: 13, color: noteMsg.startsWith('Failed') ? 'var(--danger)' : 'var(--success)', marginTop: 8 }}>
                {noteMsg}
              </p>
            )}
            <button type="submit" disabled={noteSending || !note.trim()} style={{
              marginTop: 12, background: 'var(--accent)', color: '#fff', border: 'none',
              borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: 14,
              cursor: 'pointer', opacity: (noteSending || !note.trim()) ? 0.6 : 1,
            }}>
              {noteSending ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        </Section>

      </div>
    </div>
  );
}
