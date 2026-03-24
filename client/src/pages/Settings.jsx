import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import useOrderStore from '../store/useOrderStore';

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

function StaffManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const currentUser = useOrderStore(s => s.user);

  // New user form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('worker');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Reset password state
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  useEffect(() => {
    api.get('/auth/users')
      .then(r => setUsers(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setFormError(''); setFormSuccess('');
    try {
      const res = await api.post('/auth/users', { name, email, password, role });
      setUsers(u => [...u, res.data]);
      setName(''); setEmail(''); setPassword(''); setRole('worker');
      setFormSuccess(`${res.data.name} added.`);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to create user.');
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Remove this staff user?')) return;
    try {
      await api.delete(`/auth/users/${id}`);
      setUsers(u => u.filter(x => x.id !== id));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete user.');
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    setResetMsg('');
    try {
      await api.patch(`/auth/users/${resetTarget.id}/reset-password`, { new_password: resetPw });
      setResetMsg('Password reset.');
      setResetPw('');
    } catch (err) {
      setResetMsg(err.response?.data?.message || 'Failed.');
    }
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading staff…</div>;

  return (
    <div>
      {/* Staff list */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 600 }}>Staff Accounts</div>
        {users.map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--border)', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{u.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.email}</div>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
              color: u.role === 'admin' ? 'var(--accent)' : 'var(--text-muted)',
              background: u.role === 'admin' ? 'var(--accent)22' : 'var(--bg-elevated)',
              padding: '2px 8px', borderRadius: 20,
            }}>{u.role}</span>
            {u.id !== currentUser?.id && (
              <>
                <button onClick={() => { setResetTarget(u); setResetMsg(''); setResetPw(''); }}
                  style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                  Reset pw
                </button>
                <button onClick={() => handleDelete(u.id)}
                  style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: '1px solid var(--danger)44', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                  Remove
                </button>
              </>
            )}
            {u.id === currentUser?.id && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>you</span>}
          </div>
        ))}
      </div>

      {/* Reset password inline form */}
      {resetTarget && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 24, maxWidth: 400 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Reset password for {resetTarget.name}</div>
          <form onSubmit={handleResetPassword} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="password" placeholder="New password (min 8)" value={resetPw} onChange={e => setResetPw(e.target.value)}
              required minLength={8} style={{ flex: 1 }} />
            <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontWeight: 600, cursor: 'pointer' }}>
              Set
            </button>
            <button type="button" onClick={() => setResetTarget(null)}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', color: 'var(--text-muted)' }}>
              Cancel
            </button>
          </form>
          {resetMsg && <div style={{ fontSize: 13, marginTop: 8, color: resetMsg === 'Password reset.' ? 'var(--success)' : 'var(--danger)' }}>{resetMsg}</div>}
        </div>
      )}

      {/* Add staff form */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 14 }}>Add Staff User</div>
        <form onSubmit={handleCreate}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Full name</label>
              <input value={name} onChange={e => setName(e.target.value)} required style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Password (min 8)</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)} style={{ width: '100%' }}>
                <option value="worker">Worker</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          {formError && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{formError}</div>}
          {formSuccess && <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 8 }}>{formSuccess}</div>}
          <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>
            Add User
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Settings() {
  const user = useOrderStore(s => s.user);
  const [emailStatus, setEmailStatus] = useState({ checking: true });

  // Change own password
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpMsg, setCpMsg] = useState('');
  const [cpError, setCpError] = useState('');

  useEffect(() => {
    api.get('/health/email')
      .then(r => setEmailStatus({ checking: false, ok: r.data.ok, error: r.data.error }))
      .catch(err => setEmailStatus({ checking: false, ok: false, error: err.response?.data?.error }));
  }, []);

  async function handleChangePassword(e) {
    e.preventDefault();
    setCpMsg(''); setCpError('');
    try {
      await api.post('/auth/change-password', { current_password: cpCurrent, new_password: cpNew });
      setCpMsg('Password updated.');
      setCpCurrent(''); setCpNew('');
    } catch (err) {
      setCpError(err.response?.data?.message || 'Failed to update password.');
    }
  }

  const stripeOk = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginBottom: 24 }}>Settings</h1>

      {/* Integration status */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0 24px', marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, padding: '16px 0', borderBottom: '1px solid var(--border)' }}>Integration Status</h2>
        <StatusRow label="📧 Email (SMTP)" checking={emailStatus.checking} ok={emailStatus.ok} error={emailStatus.error} />
        <StatusRow label="💳 Stripe Payments" checking={false} ok={stripeOk} error="VITE_STRIPE_PUBLISHABLE_KEY not set" />
        <StatusRow label="📦 FedEx Shipping" checking={false} ok={!!import.meta.env.VITE_FEDEX_CONFIGURED} error="Configure FEDEX_CLIENT_ID in .env" />
        <div style={{ padding: '12px 0' }} />
      </div>

      {/* Change own password */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Change Your Password</h2>
        <form onSubmit={handleChangePassword} style={{ maxWidth: 360 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>Current password</label>
            <input type="password" value={cpCurrent} onChange={e => setCpCurrent(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>New password (min 8)</label>
            <input type="password" value={cpNew} onChange={e => setCpNew(e.target.value)} required minLength={8} style={{ width: '100%' }} />
          </div>
          {cpMsg && <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 8 }}>{cpMsg}</div>}
          {cpError && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>{cpError}</div>}
          <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>
            Update Password
          </button>
        </form>
      </div>

      {/* Staff management — admin only */}
      {user?.role === 'admin' && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Staff Management</h2>
          <StaffManager />
        </div>
      )}

      {/* Config notes */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Configuration</h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <p>All configuration is managed via the <code style={{ fontFamily: 'var(--brand-mono)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>.env</code> file on the server.</p>
          <p style={{ marginTop: 8 }}>To update Stripe, FedEx, email, or other settings, update the environment variables and restart the OrderFlow service.</p>
          <p style={{ marginTop: 8 }}>Server: <code style={{ fontFamily: 'var(--brand-mono)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>docker compose restart app</code></p>
        </div>
      </div>
    </div>
  );
}
