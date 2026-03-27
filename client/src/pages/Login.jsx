import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';

export default function Login() {
  const navigate = useNavigate();
  const setUser = useOrderStore(s => s.setUser);
  const setPatientUser = useOrderStore(s => s.setPatientUser);

  const [tab, setTab] = useState('admin'); // 'admin' | 'customer'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function switchTab(t) {
    setTab(t);
    setEmail('');
    setPassword('');
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      if (tab === 'admin') {
        const res = await api.post('/auth/login', { email, password });
        setUser(res.data);
        navigate('/');
      } else {
        const res = await api.post('/customer/login', { email, password });
        setPatientUser(res.data);
        navigate('/customer/portal');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid credentials');
      setLoading(false);
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-base)',
    }}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 40, width: 400,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🌊</div>
          <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 24, color: 'var(--text-primary)' }}>OrderFlow</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Corp 001 Inc.</p>
        </div>

        {/* Tab switcher */}
        <div style={{
          display: 'flex', background: 'var(--bg-elevated)', borderRadius: 8,
          padding: 4, marginBottom: 28, gap: 4,
        }}>
          {[{ key: 'admin', label: 'Admin' }, { key: 'customer', label: 'Customer' }].map(t => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 6, border: 'none',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: tab === t.key ? 'var(--bg-surface)' : 'transparent',
                color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{ width: '100%' }}
              placeholder={tab === 'admin' ? 'admin@example.com' : 'your@email.com'}
              autoComplete="email"
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Password</label>
              {tab === 'customer' && (
                <Link to="/customer/forgot-password" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                  Forgot / Set password?
                </Link>
              )}
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ width: '100%' }}
              autoComplete="current-password"
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
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
