import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import { fmtCurrency, fmtDate } from '../lib/utils';

export default function Invoices() {
  const invoices = useOrderStore(s => s.invoices);
  const fetchInvoices = useOrderStore(s => s.fetchInvoices);

  useEffect(() => { fetchInvoices(); }, []);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginBottom: 24 }}>Invoices</h1>
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
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Due</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No invoices yet</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"
                    style={{ fontFamily: 'var(--brand-mono)', fontSize: 12, color: 'var(--accent)' }}>
                    {inv.invoice_number}
                  </a>
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
                <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{fmtDate(inv.due_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
