import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import PatientPayPortal from '../components/PatientPayPortal';
import { fmtDate } from '../lib/utils';

export default function PayPage() {
  const { invoiceId, token } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const url = token
      ? `/api/invoices/by-token/${token}`
      : `/api/invoices/${invoiceId}`;

    axios.get(url)
      .then(res => { setInvoice(res.data); setLoading(false); })
      .catch(err => {
        if (err.response?.status === 410) {
          setExpired(true);
        } else {
          setError('Invoice not found or the link is invalid.');
        }
        setLoading(false);
      });
  }, [invoiceId, token]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px' }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🌊</div>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 24, color: 'var(--text-primary)' }}>OrderFlow Payment Portal</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Corp 001 Inc. — Secure Payment</p>
      </div>

      {loading && <div style={{ color: 'var(--text-muted)' }}>Loading invoice…</div>}

      {expired && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 40, textAlign: 'center', maxWidth: 420,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
          <h2 style={{ color: 'var(--warning)', marginBottom: 12 }}>Payment Link Expired</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
            This link is only valid for 3 days after it is sent.
            Please contact us and we will send you a new link right away.
          </p>
          <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-muted)' }}>
            <strong>Corp 001 Inc.</strong><br />
            orders@001.com.mx
          </p>
        </div>
      )}

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
