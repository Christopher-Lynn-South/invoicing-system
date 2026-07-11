import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import useOrderStore from '../store/useOrderStore';
import { fmtCurrency, fmtDate, fmtDatetime } from '../lib/utils';

const PAY_STATUS_OPTIONS = ['pending', 'paid', 'failed', 'waived', 'voided', 'cancelled'];

const TERMINAL_STATUSES = ['voided', 'cancelled'];

const STATUS_COLOR_MAP = {
  paid: 'var(--success)',
  pending: 'var(--warning)',
  failed: 'var(--danger)',
  waived: 'var(--text-muted)',
  voided: 'var(--text-muted)',
  cancelled: 'var(--danger)',
};

const PAY_STATUS_COLOR = {
  paid: 'var(--success)',
  pending: 'var(--warning)',
  failed: 'var(--danger)',
  waived: 'var(--text-muted)',
};

const SHIP_STATUS_LABEL = {
  label_created: 'Label Created',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  exception: 'Exception — Review',
};

function StatusBadge({ status, color }) {
  const c = color || STATUS_COLOR_MAP?.[status] || PAY_STATUS_COLOR[status] || 'var(--text-muted)';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
      color: c, background: c + '22', padding: '3px 10px', borderRadius: 20,
    }}>{status}</span>
  );
}

function Card({ title, children, action }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 10 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const addToast = useOrderStore(s => s.addToast);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editStatus, setEditStatus] = useState(null); // null = not editing
  const [confirm, setConfirm] = useState(null); // { action: 'void'|'cancel'|'delete', label, message }

  async function load() {
    try {
      const res = await api.get(`/invoices/${id}/detail`);
      setData(res.data);
    } catch {
      addToast('Failed to load invoice', 'error');
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function runConfirmedAction() {
    if (!confirm) return;
    setSaving(true);
    try {
      if (confirm.action === 'delete') {
        await api.delete(`/invoices/${id}`);
        addToast('Invoice deleted', 'success');
        navigate('/invoices');
      } else {
        const status = confirm.action === 'void' ? 'voided' : 'cancelled';
        await api.patch(`/invoices/${id}`, { pay_status: status });
        addToast(`Invoice marked as ${status}`, 'success');
        load();
      }
    } catch (err) {
      addToast(err.response?.data?.message || 'Action failed', 'error');
    }
    setSaving(false);
    setConfirm(null);
  }

  async function saveStatus() {
    if (!editStatus || editStatus === data.pay_status) { setEditStatus(null); return; }
    setSaving(true);
    try {
      await api.patch(`/invoices/${id}`, { pay_status: editStatus });
      addToast(`Invoice updated to ${editStatus}`, 'success');
      setEditStatus(null);
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Update failed', 'error');
    }
    setSaving(false);
  }

  if (loading) return (
    <div style={{ padding: 32, color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>
  );
  if (!data) return (
    <div style={{ padding: 32, color: 'var(--danger)', fontSize: 14 }}>Invoice not found.</div>
  );

  const { invoice: _inv, order, patient, items, shipment } = (() => {
    // data is the flat invoice object merged with order/patient/items/shipment
    return { invoice: data, order: data.order, patient: data.patient, items: data.items || [], shipment: data.shipment };
  })();

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        <Link to="/invoices" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Invoices</Link>
        <span>›</span>
        <span style={{ fontFamily: 'var(--brand-mono)' }}>{data.invoice_number}</span>
      </div>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 26 }}>{data.invoice_number}</h1>
        <StatusBadge status={data.pay_status} color={STATUS_COLOR_MAP[data.pay_status]} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {data.pdf_url && (
            <a href={data.pdf_url} target="_blank" rel="noreferrer" style={{
              fontSize: 12, color: 'var(--accent)', border: '1px solid var(--accent)',
              padding: '5px 14px', borderRadius: 6, textDecoration: 'none', fontWeight: 600,
            }}>
              PDF ↗
            </a>
          )}
          {data.pay_status === 'pending' && (
            <button
              onClick={async () => {
                try {
                  await api.patch(`/invoices/${id}`, { installments_allowed: !data.installments_allowed });
                  addToast(data.installments_allowed ? 'Payment plan disabled' : 'Payment plan enabled — customer can now split into 2-3 payments', 'success');
                  load();
                } catch (err) {
                  addToast(err.response?.data?.message || 'Failed', 'error');
                }
              }}
              style={{
                fontSize: 12, padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
                border: `1px solid ${data.installments_allowed ? 'var(--success)' : 'var(--border)'}`,
                color: data.installments_allowed ? 'var(--success)' : 'var(--text-muted)', background: 'none',
              }}
            >
              {data.installments_allowed ? '✓ Payment Plan On' : 'Allow Payment Plan'}
            </button>
          )}
          {data.pay_status !== 'paid' && !TERMINAL_STATUSES.includes(data.pay_status) && (
            <>
              <button
                onClick={() => setConfirm({ action: 'void', label: 'Void Invoice', message: 'Mark this invoice as void? This cannot be undone. The order will be cancelled.' })}
                style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--text-muted)', color: 'var(--text-muted)', background: 'none', fontWeight: 600 }}
              >
                Void
              </button>
              <button
                onClick={() => setConfirm({ action: 'cancel', label: 'Cancel Invoice', message: 'Cancel this invoice? The order will also be cancelled.' })}
                style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--warning)', color: 'var(--warning)', background: 'none', fontWeight: 600 }}
              >
                Cancel
              </button>
            </>
          )}
          {data.pay_status !== 'paid' && (
            <button
              onClick={() => setConfirm({ action: 'delete', label: 'Delete Invoice', message: 'Permanently hide this invoice? It will no longer appear in the list. This cannot be undone.' })}
              style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--danger)', color: 'var(--danger)', background: 'none', fontWeight: 600 }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{confirm.label}</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>{confirm.message}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirm(null)} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={runConfirmedAction}
                disabled={saving}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: confirm.action === 'delete' ? 'var(--danger)' : 'var(--warning)', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Processing…' : confirm.label}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Left column */}
        <div>
          {/* Payment status editor */}
          <Card title="Payment Status" action={
            editStatus === null ? (
              <button onClick={() => setEditStatus(data.pay_status)} style={{
                fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--accent)', color: 'var(--accent)', background: 'none',
              }}>Edit</button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={saveStatus} disabled={saving} style={{
                  fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                  background: 'var(--accent)', color: '#fff', border: 'none', opacity: saving ? 0.6 : 1,
                }}>{saving ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setEditStatus(null)} style={{
                  fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'none',
                }}>Cancel</button>
              </div>
            )
          }>
            {editStatus !== null ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PAY_STATUS_OPTIONS.map(s => (
                  <button key={s} onClick={() => setEditStatus(s)} style={{
                    padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    border: `2px solid ${editStatus === s ? (PAY_STATUS_COLOR[s] || 'var(--accent)') : 'var(--border)'}`,
                    background: editStatus === s ? (PAY_STATUS_COLOR[s] || 'var(--accent)') + '22' : 'transparent',
                    color: editStatus === s ? (PAY_STATUS_COLOR[s] || 'var(--accent)') : 'var(--text-secondary)',
                  }}>{s}</button>
                ))}
              </div>
            ) : (
              <>
                <Row label="Status" value={<StatusBadge status={data.pay_status} />} />
                <Row label="Method" value={data.pay_method ? data.pay_method.replace(/_/g, ' ').toUpperCase() : '—'} />
                <Row label="Paid on" value={data.paid_at ? fmtDatetime(data.paid_at) : '—'} />
                <Row label="Due date" value={data.due_date ? fmtDate(data.due_date) : '—'} />
              </>
            )}
            {editStatus !== null && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
                Changing to <strong>paid</strong> will also update the order status to <em>paid</em>.
                Changing to <strong>pending / failed</strong> reverts the order to <em>pending_payment</em>.
              </p>
            )}
          </Card>

          {/* Patient */}
          <Card title="Patient" action={
            patient && (
              <Link to={`/patients/${order?.patient_id}`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                View patient →
              </Link>
            )
          }>
            <Row label="Name" value={patient?.name || '—'} />
            <Row label="Email" value={patient?.email || '—'} />
            {patient?.phone && <Row label="Phone" value={patient.phone} />}
          </Card>
        </div>

        {/* Right column */}
        <div>
          {/* Order */}
          <Card title="Sales Order" action={
            order && (
              <Link to={`/orders/${order.id}`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                Open order →
              </Link>
            )
          }>
            <Row label="Order #" value={<span style={{ fontFamily: 'var(--brand-mono)', fontSize: 12 }}>{order?.order_number}</span>} />
            <Row label="Order status" value={<StatusBadge status={order?.status} color={
              order?.status === 'paid' ? 'var(--success)' :
              order?.status === 'shipped' ? 'var(--accent)' :
              order?.status === 'delivered' ? 'var(--success)' :
              'var(--warning)'
            } />} />
            <Row label="Created" value={fmtDate(order?.created_at)} />
            {order?.notes && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Notes</div>
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', background: 'var(--bg-elevated)', padding: '10px 12px', borderRadius: 6 }}>
                  {order.notes}
                </div>
              </div>
            )}
          </Card>

          {/* Shipment */}
          <Card title="Shipment">
            {shipment ? (
              <>
                <Row label="Status" value={
                  <StatusBadge
                    status={SHIP_STATUS_LABEL[shipment.status] || shipment.status}
                    color={
                      shipment.status === 'delivered' ? 'var(--success)' :
                      shipment.status === 'exception' ? 'var(--danger)' : 'var(--accent)'
                    }
                  />
                } />
                {shipment.fedex_tracking_number && (
                  <Row label="Tracking" value={<span style={{ fontFamily: 'var(--brand-mono)', fontSize: 12 }}>{shipment.fedex_tracking_number}</span>} />
                )}
                {shipment.ship_date && <Row label="Shipped" value={fmtDate(shipment.ship_date)} />}
                {shipment.estimated_delivery && <Row label="Est. delivery" value={fmtDate(shipment.estimated_delivery)} />}
                {shipment.latest_status && (
                  <div style={{ marginTop: 8, fontSize: 13, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 6 }}>
                    {shipment.latest_status}
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No shipment yet.</p>
            )}
          </Card>
        </div>
      </div>

      {/* Line items */}
      <Card title="Line Items">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 12 }}>
              <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 500 }}>Item</th>
              <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 500 }}>SKU</th>
              <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 500 }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 500 }}>Unit Price</th>
              <th style={{ textAlign: 'right', padding: '8px 0', fontWeight: 500 }}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 0' }}>{item.product_name}</td>
                <td style={{ padding: '10px 0', fontFamily: 'var(--brand-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{item.product_sku}</td>
                <td style={{ padding: '10px 0', textAlign: 'right', color: 'var(--text-muted)' }}>×{item.quantity}</td>
                <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(item.unit_price)}</td>
                <td style={{ padding: '10px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(item.line_total)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} style={{ padding: '12px 0', textAlign: 'right', color: 'var(--text-muted)' }}>Subtotal</td>
              <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(data.subtotal)}</td>
            </tr>
            {parseFloat(data.processing_fee) < 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '4px 0', textAlign: 'right', color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>Discount (ACH/USDC)</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>−{fmtCurrency(Math.abs(data.processing_fee))}</td>
              </tr>
            )}
            <tr>
              <td colSpan={4} style={{ padding: '12px 0', textAlign: 'right', fontWeight: 700, fontSize: 16 }}>Total</td>
              <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontWeight: 700, fontSize: 18, color: 'var(--success)' }}>{fmtCurrency(data.total)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
