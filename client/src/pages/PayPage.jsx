import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import PatientPayPortal from '../components/PatientPayPortal';
import { fmtDate } from '../lib/utils';

export default function PayPage() {
  const { invoiceId } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get(`/api/invoices/${invoiceId}`)
      .then(res => { setInvoice(res.data); setLoading(false); })
      .catch(() => { setError('Invoice not found.'); setLoading(false); });
  }, [invoiceId]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px' }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🌊</div>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 24, color: 'var(--text-primary)' }}>OrderFlow Payment Portal</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Corp 001 Inc. — Secure Payment</p>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Loading invoice…</div>}
      {error && <div style={{ color: 'var(--danger)', padding: 24 }}>{error}</div>}
      {invoice && (
        <>
          {invoice.pay_status === 'paid' ? (
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 40, textAlign: 'center', maxWidth: 400,
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <h2 style={{ color: 'var(--success)', marginBottom: 8 }}>Invoice Already Paid</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                This invoice was paid on {fmtDate(invoice.paid_at)}.
              </p>
            </div>
          ) : (
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '28px 32px', width: '100%', maxWidth: 600,
            }}>
              <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
                  Invoice {invoice.invoice_number}
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {invoice.patient?.name} · Due: {fmtDate(invoice.due_date)}
                </p>
              </div>
              <PatientPayPortal invoice={invoice} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
