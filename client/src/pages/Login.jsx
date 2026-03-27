import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';

export default function Login() {
  const navigate = useNavigate();
  const setUser = useOrderStore(s => s.setUser);
  const setPatientUser = useOrderStore(s => s.setPatientUser);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError('');

    // Try admin first, then customer — credentials decide access
    try {
      const res = await api.post('/auth/login', { email, password });
      setUser(res.data);
      navigate('/');
      return;
    } catch (adminErr) {
      if (adminErr.response?.status !== 401) {
        setError('Something went wrong. Please try again.');
        setLoading(false);
        return;
      }
    }

    try {
      const res = await api.post('/customer/login', { email, password });
      setPatientUser(res.data);
      navigate('/customer/portal');
    } catch {
      setError('Invalid email or password.');
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
          <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 24, color: 'var(--text-primary)' }}>OrderFlow</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Corp 001 Inc.</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: '100%' }} placeholder="your@email.com" autoComplete="email" />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ width: '100%' }} autoComplete="current-password" />
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
          <button type="submit" disabled={loading} style={{
            width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '12px', fontWeight: 600, fontSize: 15,
            opacity: loading ? 0.7 : 1, cursor: 'pointer',
          }}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          <Link to="/customer/forgot-password" style={{ color: 'var(--accent)' }}>Forgot or set password?</Link>
        </p>
      </div>
    </div>
  );
}
