import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';

const STATUS_COLOR = {
  paid: 'var(--success)',
  pending: 'var(--warning)',
  failed: 'var(--danger)',
};

function fmt(cents) {
  return `$${Number(cents).toFixed(2)}`;
}

function Badge({ status }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1,
      color: STATUS_COLOR[status] || 'var(--text-muted)',
      background: (STATUS_COLOR[status] || 'var(--text-muted)') + '22',
      padding: '2px 8px', borderRadius: 20,
    }}>{status}</span>
  );
}

export default function PatientPortal() {
  const navigate = useNavigate();
  const patientUser = useOrderStore(s => s.patientUser);
  const setPatientUser = useOrderStore(s => s.setPatientUser);

  const [invoices, setInvoices] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('invoices');

  // Change password state
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpMsg, setCpMsg] = useState('');
  const [cpError, setCpError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/customer/invoices'),
      api.get('/customer/shipments'),
    ]).then(([inv, ship]) => {
      setInvoices(inv.data);
      setShipments(ship.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await api.post('/customer/logout');
    setPatientUser(null);
    navigate('/customer/login');
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setCpMsg(''); setCpError('');
    try {
      await api.post('/customer/change-password', { current_password: cpCurrent, new_password: cpNew });
      setCpMsg('Password updated successfully.');
      setCpCurrent(''); setCpNew('');
    } catch (err) {
      setCpError(err.response?.data?.message || 'Failed to update password.');
    }
  }

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
      <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--brand-mono)' }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontFamily: 'var(--brand-serif)', fontSize: 20 }}>🌊 Customer Portal</span>
          <span style={{ marginLeft: 16, color: 'var(--text-muted)', fontSize: 13 }}>Welcome, {patientUser?.name}</span>
        </div>
        <button onClick={handleLogout} style={{ fontSize: 13, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
          Sign out
        </button>
      </div>

      <div style={{ maxWidth: 900, margin: '32px auto', padding: '0 24px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['invoices', 'shipments', 'account'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)',
              background: tab === t ? 'var(--accent)' : 'var(--bg-surface)',
              color: tab === t ? '#fff' : 'var(--text-secondary)',
              fontWeight: 600, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        {/* Invoices tab */}
        {tab === 'invoices' && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Your Invoices</h2>
            {invoices.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No invoices yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {invoices.map(inv => (
                  <div key={inv.id} style={{
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{inv.invoice_number}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Order: {inv.order_number}</div>
                      {inv.due_date && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Due: {inv.due_date}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <Badge status={inv.pay_status} />
                      <span style={{ fontWeight: 600 }}>{fmt(inv.total)}</span>
                      {inv.pay_status !== 'paid' && (
                        <Link to={`/pay/${inv.id}`} style={{
                          background: 'var(--accent)', color: '#fff', padding: '6px 14px',
                          borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none',
                        }}>Pay</Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Shipments tab */}
        {tab === 'shipments' && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Your Shipments</h2>
            {shipments.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No shipments yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {shipments.map(s => (
                  <div key={s.id} style={{
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '16px 20px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>Order: {s.order_number}</span>
                      <Badge status={s.status} />
                    </div>
                    {s.fedex_tracking_number && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        Tracking: <span style={{ fontFamily: 'var(--brand-mono)' }}>{s.fedex_tracking_number}</span>
                      </div>
                    )}
                    {s.latest_status && <div style={{ fontSize: 13, marginTop: 4 }}>{s.latest_status}</div>}
                    {s.estimated_delivery && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Est. delivery: {s.estimated_delivery}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Account tab */}
        {tab === 'account' && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Change Password</h2>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, maxWidth: 400 }}>
              <form onSubmit={handleChangePassword}>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Current password</label>
                  <input type="password" value={cpCurrent} onChange={e => setCpCurrent(e.target.value)} required style={{ width: '100%' }} />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>New password (min 8 chars)</label>
                  <input type="password" value={cpNew} onChange={e => setCpNew(e.target.value)} required minLength={8} style={{ width: '100%' }} />
                </div>
                {cpMsg && <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 12 }}>{cpMsg}</div>}
                {cpError && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{cpError}</div>}
                <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 600, cursor: 'pointer' }}>
                  Update Password
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
