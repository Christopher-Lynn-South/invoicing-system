import React, { useEffect, useState } from 'react';
import api from '../lib/api';

function StatusRow({ label, checking, ok, error }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, fontSize: 14 }}>{label}</div>
      {checking ? (
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Checking…</span>
      ) : ok ? (
        <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Connected</span>
      ) : (
        <span style={{ color: 'var(--danger)', fontSize: 13 }}>✗ {error || 'Not configured'}</span>
      )}
    </div>
  );
}

export default function Settings() {
  const [emailStatus, setEmailStatus] = useState({ checking: true });

  useEffect(() => {
    api.get('/health/email')
      .then(r => setEmailStatus({ checking: false, ok: r.data.ok, error: r.data.error }))
      .catch(err => setEmailStatus({ checking: false, ok: false, error: err.response?.data?.error }));
  }, []);

  const stripeOk = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginBottom: 24 }}>Settings</h1>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0 24px', marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, padding: '16px 0', borderBottom: '1px solid var(--border)' }}>Integration Status</h2>
        <StatusRow label="📧 Email (SMTP)" checking={emailStatus.checking} ok={emailStatus.ok} error={emailStatus.error} />
        <StatusRow label="💳 Stripe Payments" checking={false} ok={stripeOk} error="VITE_STRIPE_PUBLISHABLE_KEY not set" />
        <StatusRow label="📦 FedEx Shipping" checking={false} ok={!!import.meta.env.VITE_FEDEX_CONFIGURED} error="Configure FEDEX_CLIENT_ID in .env" />
        <div style={{ padding: '12px 0' }} />
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Configuration</h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <p>All configuration is managed via the <code style={{ fontFamily: 'var(--brand-mono)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>.env</code> file on the server.</p>
          <p style={{ marginTop: 8 }}>To update Stripe, FedEx, email, or other settings, update the environment variables and restart the OrderFlow service.</p>
          <p style={{ marginTop: 8 }}>Server: <code style={{ fontFamily: 'var(--brand-mono)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>pm2 restart orderflow</code></p>
        </div>
      </div>
    </div>
  );
}
