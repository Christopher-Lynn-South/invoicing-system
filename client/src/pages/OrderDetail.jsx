import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import useOrderStore from '../store/useOrderStore';
import { fmtCurrency, fmtDate, fmtDatetime, relativeTime } from '../lib/utils';
import Modal from '../components/Modal';

function PipelineStep({ label, active, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', border: '2px solid',
        borderColor: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)',
        background: done ? 'var(--success)' : active ? 'var(--accent-light)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: done ? '#fff' : active ? 'var(--accent)' : 'var(--text-muted)',
        flexShrink: 0,
      }}>
        {done ? '✓' : '•'}
      </div>
      <span style={{ fontSize: 13, color: active || done ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const addToast = useOrderStore(s => s.addToast);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shipModal, setShipModal] = useState(false);
  const [shipForm, setShipForm] = useState({ service: 'FEDEX_GROUND', box_type: 'FEDEX_LARGE_BOX', weight_lbs: '' });
  const [shipping, setShipping] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [resendingInvoice, setResendingInvoice] = useState(false);
  const [resendingShipping, setResendingShipping] = useState(false);

  async function load() {
    try {
      const res = await api.get(`/orders/${id}`);
      setOrder(res.data);
    } catch { addToast('Failed to load order', 'error'); }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function generateInvoice() {
    setGeneratingInvoice(true);
    try {
      await api.post(`/orders/${id}/invoice`);
      addToast('Invoice generated and emailed', 'success');
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to generate invoice', 'error');
    }
    setGeneratingInvoice(false);
  }

  async function handleShip(e) {
    e.preventDefault();
    setShipping(true);
    try {
      await api.post(`/orders/${id}/ship`, {
        service: shipForm.service,
        box_type: shipForm.box_type,
        weight_lbs: parseFloat(shipForm.weight_lbs),
      });
      addToast('Shipping label created!', 'success');
      setShipModal(false);
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Shipping failed', 'error');
    }
    setShipping(false);
  }

  async function resendInvoice() {
    setResendingInvoice(true);
    try {
      const { data } = await api.post(`/orders/${id}/resend-invoice`);
      const parts = ['Invoice resent'];
      if (data.sent.email) parts.push('email ✓');
      if (data.sent.sms) parts.push('SMS ✓');
      addToast(parts.join(' · '), 'success');
    } catch (err) {
      addToast(err.response?.data?.message || 'Resend failed', 'error');
    }
    setResendingInvoice(false);
  }

  async function resendShipping() {
    setResendingShipping(true);
    try {
      const { data } = await api.post(`/orders/${id}/resend-shipping`);
      const parts = ['Shipping notification resent'];
      if (data.sent.email) parts.push('email ✓');
      if (data.sent.sms) parts.push('SMS ✓');
      addToast(parts.join(' · '), 'success');
    } catch (err) {
      addToast(err.response?.data?.message || 'Resend failed', 'error');
    }
    setResendingShipping(false);
  }

  async function refreshTracking() {
    try {
      await api.post(`/orders/${id}/tracking/refresh`);
      addToast('Tracking refreshed', 'info');
      load();
    } catch (err) {
      addToast('Failed to refresh tracking', 'error');
    }
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</div>;
  if (!order) return <div style={{ padding: 40 }}>Order not found.</div>;

  const STEPS = ['draft', 'pending_payment', 'paid', 'shipped'];
  const stepIdx = STEPS.indexOf(order.status);
  const isPaid = order.status === 'paid' || order.status === 'shipped';
  const hasInvoice = !!order.invoice;
  const hasShipment = !!order.shipment;

  const subtotal = order.items.reduce((sum, i) => sum + parseFloat(i.line_total), 0);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Link to="/orders" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Orders</Link>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginTop: 8 }}>
          {order.order_number}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{order.patient?.name} · {fmtDate(order.created_at)}</p>
      </div>

      {/* Pipeline */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '16px 24px', marginBottom: 24,
        display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {STEPS.map((step, i) => (
          <React.Fragment key={step}>
            <PipelineStep label={step.replace(/_/g, ' ')} active={stepIdx === i} done={stepIdx > i} />
            {i < STEPS.length - 1 && <span style={{ color: 'var(--border)', fontSize: 18 }}>→</span>}
          </React.Fragment>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: Line Items + Invoice */}
        <div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Line Items</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  <th style={{ textAlign: 'left', paddingBottom: 8 }}>Product</th>
                  <th style={{ textAlign: 'right', paddingBottom: 8 }}>Qty</th>
                  <th style={{ textAlign: 'right', paddingBottom: 8 }}>Price</th>
                  <th style={{ textAlign: 'right', paddingBottom: 8 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map(item => (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 0' }}>{item.product_name}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>{item.quantity}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtCurrency(item.unit_price)}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(item.line_total)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <td colSpan={3} style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>Subtotal</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontWeight: 600 }}>{fmtCurrency(subtotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Invoice panel */}
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Invoice</h2>
            {!hasInvoice ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>No invoice generated yet.</p>
                {order.status === 'draft' && (
                  <button onClick={generateInvoice} disabled={generatingInvoice} style={{
                    background: 'var(--accent)', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '8px 20px', fontWeight: 600, fontSize: 13,
                  }}>
                    {generatingInvoice ? 'Generating…' : 'Generate Invoice'}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Invoice #</span>
                  <span style={{ fontFamily: 'var(--brand-mono)' }}>{order.invoice.invoice_number}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Subtotal</span>
                  <span>{fmtCurrency(order.invoice.subtotal)}</span>
                </div>
                {parseFloat(order.invoice.processing_fee) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>CC Fee (3.9%)</span>
                    <span style={{ color: 'var(--warning)' }}>{fmtCurrency(order.invoice.processing_fee)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontWeight: 700 }}>
                  <span>Total</span>
                  <span style={{ fontFamily: 'var(--brand-mono)', color: 'var(--success)' }}>{fmtCurrency(order.invoice.total)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status</span>
                  <span className={`badge badge-${order.invoice.pay_status}`}>{order.invoice.pay_status}</span>
                </div>
                {order.invoice.pay_method && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Method</span>
                    <span>{order.invoice.pay_method.replace('_', ' ').toUpperCase()}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={`/api/invoices/${order.invoice.id}/pdf`} target="_blank" rel="noreferrer" style={{
                    fontSize: 12, color: 'var(--accent)', border: '1px solid var(--accent)',
                    borderRadius: 6, padding: '4px 12px',
                  }}>Download PDF</a>
                  {order.invoice.pay_status === 'pending' && (
                    <a href={`/pay/${order.invoice.id}`} target="_blank" rel="noreferrer" style={{
                      fontSize: 12, background: 'var(--accent)', color: '#fff',
                      borderRadius: 6, padding: '4px 12px',
                    }}>Payment Portal →</a>
                  )}
                  <button onClick={resendInvoice} disabled={resendingInvoice} style={{
                    fontSize: 12, background: 'none', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                    opacity: resendingInvoice ? 0.6 : 1,
                  }}>
                    {resendingInvoice ? 'Sending…' : '↩ Resend Invoice'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Shipping */}
        <div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>FedEx Shipping</h2>
            {!isPaid ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
                <p style={{ fontSize: 13 }}>Shipping is locked until invoice is paid.</p>
              </div>
            ) : !hasShipment ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Invoice paid. Ready to ship.</p>
                <button onClick={() => setShipModal(true)} style={{
                  background: 'var(--success)', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '8px 20px', fontWeight: 600, fontSize: 13,
                }}>Create FedEx Label</button>
              </div>
            ) : (
              <div style={{ fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Tracking #</span>
                  <span style={{ fontFamily: 'var(--brand-mono)' }}>
                    <a href={`https://www.fedex.com/fedextrack/?tracknumbers=${order.shipment.fedex_tracking_number}`} target="_blank" rel="noreferrer">
                      {order.shipment.fedex_tracking_number}
                    </a>
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Service</span>
                  <span>{order.shipment.service_type}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status</span>
                  <span>{order.shipment.latest_status}</span>
                </div>
                {order.shipment.exception_flag && (
                  <div style={{ background: '#ef444422', border: '1px solid #ef444444', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--danger)' }}>
                    ⚠ Shipment exception detected
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={`/api/orders/${id}/label`} target="_blank" rel="noreferrer" style={{
                    fontSize: 12, color: 'var(--accent)', border: '1px solid var(--accent)',
                    borderRadius: 6, padding: '4px 12px',
                  }}>Download Label PDF</a>
                  <button onClick={resendShipping} disabled={resendingShipping} style={{
                    fontSize: 12, background: 'none', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                    opacity: resendingShipping ? 0.6 : 1,
                  }}>
                    {resendingShipping ? 'Sending…' : '↩ Resend Shipping'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tracking Timeline */}
          {hasShipment && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>Shipment Timeline</h2>
                <button onClick={refreshTracking} style={{
                  background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  borderRadius: 6, padding: '4px 12px', fontSize: 12,
                }}>↻ Refresh</button>
              </div>
              {order.shipment.last_polled_at && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Last checked: {relativeTime(order.shipment.last_polled_at)}
                </p>
              )}
              {order.shipment.events?.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No events yet.</p>
              ) : (
                <div style={{ position: 'relative' }}>
                  {order.shipment.events?.map((ev, i) => {
                    const isException = ['DE', 'SE', 'DY', 'CA', 'RS'].includes(ev.event_code);
                    const isDelivered = ev.event_code === 'DL';
                    return (
                      <div key={ev.id} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                          background: isException ? 'var(--danger)' : isDelivered ? 'var(--success)' : 'var(--accent)',
                        }} />
                        <div>
                          <div style={{
                            fontSize: 13, fontWeight: 500,
                            color: isException ? 'var(--danger)' : isDelivered ? 'var(--success)' : 'var(--text-primary)',
                          }}>
                            {isException && '⚠ '}{isDelivered && '✓ '}{ev.event_description}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            {fmtDatetime(ev.event_timestamp)}
                            {ev.location_city && ` · ${[ev.location_city, ev.location_state, ev.location_country].filter(Boolean).join(', ')}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ship Modal */}
      <Modal open={shipModal} onClose={() => setShipModal(false)} title="Create FedEx Label">
        <form onSubmit={handleShip}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Service Type</label>
            <select value={shipForm.service} onChange={e => setShipForm({ ...shipForm, service: e.target.value })} style={{ width: '100%' }}>
              <option value="FEDEX_GROUND">FedEx Ground</option>
              <option value="FEDEX_EXPRESS_SAVER">FedEx Express Saver</option>
              <option value="PRIORITY_OVERNIGHT">Priority Overnight</option>
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Box Type</label>
            <select value={shipForm.box_type} onChange={e => setShipForm({ ...shipForm, box_type: e.target.value })} style={{ width: '100%' }}>
              <option value="FEDEX_ENVELOPE">FedEx Envelope</option>
              <option value="FEDEX_PAK">FedEx Pak</option>
              <option value="FEDEX_TUBE">FedEx Tube</option>
              <option value="FEDEX_SMALL_BOX">FedEx Small Box</option>
              <option value="FEDEX_MEDIUM_BOX">FedEx Medium Box</option>
              <option value="FEDEX_LARGE_BOX">FedEx Large Box</option>
              <option value="FEDEX_EXTRA_LARGE_BOX">FedEx Extra Large Box</option>
              <option value="FEDEX_10KG_BOX">FedEx 10kg Box</option>
              <option value="FEDEX_25KG_BOX">FedEx 25kg Box</option>
            </select>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Weight (lbs)</label>
            <input type="number" step="0.01" min="0.1" required value={shipForm.weight_lbs}
              onChange={e => setShipForm({ ...shipForm, weight_lbs: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShipModal(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" disabled={shipping} style={{ background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600 }}>
              {shipping ? 'Creating…' : 'Create Label'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
