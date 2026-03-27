import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

export default function PatientForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await api.post('/customer/forgot-password', { email });
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    }
    setLoading(false);
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 40, width: 380,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔑</div>
          <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 22, color: 'var(--text-primary)' }}>
            Set / Reset Password
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Enter the email address on your account and we'll send you a link.
          </p>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
              If that email is on file, a link has been sent. Check your inbox — it expires in 2 hours.
            </p>
            <Link to="/customer/login" style={{ color: 'var(--accent)', fontSize: 13 }}>
              ← Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                style={{ width: '100%' }}
              />
            </div>
            {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '12px', fontWeight: 600, fontSize: 15,
                opacity: loading ? 0.7 : 1, cursor: 'pointer',
              }}
            >
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
            <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
              <Link to="/customer/login" style={{ color: 'var(--accent)' }}>← Back to login</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
