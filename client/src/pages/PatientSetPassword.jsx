import React, { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';

export default function PatientSetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!token) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, width: 380, textAlign: 'center' }}>
          <p style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 20 }}>Invalid or missing reset link.</p>
          <Link to="/customer/forgot-password" style={{ color: 'var(--accent)', fontSize: 13 }}>Request a new link →</Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      await api.post('/customer/reset-password', { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'This link is invalid or has expired.');
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
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
          <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 22, color: 'var(--text-primary)' }}>
            Create Password
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Choose a password for your patient portal account.
          </p>
        </div>

        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
              Password set! Redirecting to login…
            </p>
            <Link to="/login" style={{ color: 'var(--accent)', fontSize: 13 }}>Go to login →</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="At least 8 characters"
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Confirm password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                placeholder="Repeat password"
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
              {loading ? 'Saving…' : 'Set Password'}
            </button>
            <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
              <Link to="/customer/forgot-password" style={{ color: 'var(--accent)' }}>Need a new link?</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
