import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';

export default function PatientLogin() {
  const navigate = useNavigate();
  const setPatientUser = useOrderStore(s => s.setPatientUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await api.post('/customer/login', { email, password });
      setPatientUser(res.data);
      navigate('/customer/portal');
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid credentials or portal access not enabled.');
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
        borderRadius: 12, padding: 40, width: 380,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🌊</div>
          <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 24, color: 'var(--text-primary)' }}>Customer Portal</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Corp 001 Inc. — View your orders & invoices</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: '100%' }} placeholder="your@email.com" />
          </div>
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Password</label>
              <Link to="/customer/forgot-password" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                Forgot / Set password?
              </Link>
            </div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ width: '100%' }} />
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{
            width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '12px', fontWeight: 600, fontSize: 15,
            opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          Staff? <Link to="/login" style={{ color: 'var(--accent)' }}>Admin login →</Link>
        </p>
      </div>
    </div>
  );
}
