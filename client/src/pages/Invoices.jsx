import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';
import { fmtCurrency, fmtDate } from '../lib/utils';

const TERMINAL = ['voided', 'cancelled'];

export default function Invoices() {
  const invoices = useOrderStore(s => s.invoices);
  const fetchInvoices = useOrderStore(s => s.fetchInvoices);
  const addToast = useOrderStore(s => s.addToast);
  const [resending, setResending] = useState({});
  const [confirm, setConfirm] = useState(null); // { invoiceId, action, label, message }
  const [acting, setActing] = useState(false);

  async function resend(invoiceId) {
    setResending(r => ({ ...r, [invoiceId]: true }));
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/resend`);
      const parts = ['Invoice resent'];
      if (data.sent.email) parts.push('email ✓');
      if (data.sent.sms) parts.push('SMS ✓');
      addToast(parts.join(' · '), 'success');
    } catch (err) {
      addToast(err.response?.data?.message || 'Resend failed', 'error');
    }
    setResending(r => ({ ...r, [invoiceId]: false }));
  }

  async function runAction() {
    if (!confirm) return;
    setActing(true);
    try {
      if (confirm.action === 'delete') {
        await api.delete(`/invoices/${confirm.invoiceId}`);
        addToast('Invoice deleted', 'success');
      } else {
        const status = confirm.action === 'void' ? 'voided' : 'cancelled';
        await api.patch(`/invoices/${confirm.invoiceId}`, { pay_status: status });
        addToast(`Invoice marked as ${status}`, 'success');
      }
      fetchInvoices();
    } catch (err) {
      addToast(err.response?.data?.message || 'Action failed', 'error');
    }
    setActing(false);
    setConfirm(null);
  }

  useEffect(() => { fetchInvoices(); }, []);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginBottom: 24 }}>Invoices</h1>

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
                onClick={runAction}
                disabled={acting}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: confirm.action === 'delete' ? 'var(--danger)' : 'var(--warning)', color: '#fff', cursor: 'pointer', fontWeight: 600, opacity: acting ? 0.6 : 1 }}
              >
                {acting ? 'Processing…' : confirm.label}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12 }}>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Invoice #</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Order #</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Patient</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Subtotal</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Fee</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Total</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Method</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Issued</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Due</th>
              <th style={{ padding: '12px 16px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No invoices yet</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <Link to={`/invoices/${inv.id}`}
                    style={{ fontFamily: 'var(--brand-mono)', fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                    {inv.invoice_number}
                  </Link>
                </td>
                <td style={{ padding: '12px 16px', fontFamily: 'var(--brand-mono)', fontSize: 12 }}>
                  {inv.order_number}
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{inv.patient_name}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontSize: 13 }}>{fmtCurrency(inv.subtotal)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontSize: 13, color: 'var(--warning)' }}>
                  {parseFloat(inv.processing_fee) > 0 ? fmtCurrency(inv.processing_fee) : '—'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontSize: 13, fontWeight: 700 }}>{fmtCurrency(inv.total)}</td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {inv.pay_method ? inv.pay_method.replace(/_/g, ' ').toUpperCase() : '—'}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span className={`badge badge-${inv.pay_status}`}>{inv.pay_status}</span>
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{inv.issued_date ? fmtDate(inv.issued_date) : '—'}</td>
                <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{fmtDate(inv.due_date)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {inv.pay_status === 'pending' && (
                      <>
                        <button
                          onClick={() => resend(inv.id)}
                          disabled={resending[inv.id]}
                          title="Resend invoice via email + SMS"
                          style={{
                            fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                            border: '1px solid var(--accent)', color: 'var(--accent)', background: 'none',
                            opacity: resending[inv.id] ? 0.5 : 1,
                          }}
                        >
                          {resending[inv.id] ? 'Sending…' : '↩ Resend'}
                        </button>
                        <a
                          href={`/pay/${inv.id}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'var(--accent)', color: '#fff', textDecoration: 'none' }}
                        >
                          Pay →
                        </a>
                      </>
                    )}
                    {!TERMINAL.includes(inv.pay_status) && inv.pay_status !== 'paid' && (
                      <>
                        <button
                          onClick={() => setConfirm({ invoiceId: inv.id, action: 'void', label: 'Void Invoice', message: `Void ${inv.invoice_number}? The order will be cancelled.` })}
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--text-muted)', color: 'var(--text-muted)', background: 'none' }}
                        >
                          Void
                        </button>
                        <button
                          onClick={() => setConfirm({ invoiceId: inv.id, action: 'cancel', label: 'Cancel Invoice', message: `Cancel ${inv.invoice_number}? The order will also be cancelled.` })}
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--warning)', color: 'var(--warning)', background: 'none' }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => setConfirm({ invoiceId: inv.id, action: 'delete', label: 'Delete Invoice', message: `Delete ${inv.invoice_number}? It will be hidden from this list.` })}
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--danger)', color: 'var(--danger)', background: 'none' }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
