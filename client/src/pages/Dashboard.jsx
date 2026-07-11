import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { fmtCurrency, fmtDate, relativeTime } from '../lib/utils';

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '20px 24px', flex: 1, minWidth: 160,
    }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--text-primary)', fontFamily: 'var(--brand-mono)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [exceptions, setExceptions] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);

  useEffect(() => {
    // Single aggregate stats call — no more downloading full order/invoice
    // tables just to count rows.
    api.get('/dashboard/stats').then(res => {
      const { revenue, pending, shipped, overdue, total_orders, recent_orders } = res.data;
      setStats({ revenue, pending, shipped, overdue, total_orders });
      setRecentOrders(recent_orders || []);
    }).catch(console.error);

    api.get('/reminders/shipments/exceptions')
      .then(r => setExceptions(r.data || []))
      .catch(err => console.error('Failed to load shipment exceptions:', err));
  }, []);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginBottom: 6 }}>Dashboard</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Corp 001 Inc. — OrderFlow Overview</p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <StatCard label="Total Revenue" value={fmtCurrency(stats?.revenue)} color="var(--success)" />
        <StatCard label="Pending Invoices" value={stats?.pending ?? '—'} color="var(--warning)" />
        <StatCard label="Shipped Orders" value={stats?.shipped ?? '—'} color="var(--accent)" />
        <StatCard label="Overdue Reminders" value={stats?.overdue ?? '—'} color="var(--danger)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Recent Orders */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Recent Orders</h2>
            <Link to="/orders" style={{ fontSize: 13, color: 'var(--accent)' }}>View all →</Link>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '6px 0' }}>Order</th>
                <th style={{ padding: '6px 0' }}>Patient</th>
                <th style={{ padding: '6px 0' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(order => (
                <tr key={order.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 0' }}>
                    <Link to={`/orders/${order.id}`} style={{ fontFamily: 'var(--brand-mono)', fontSize: 12 }}>
                      {order.order_number}
                    </Link>
                  </td>
                  <td style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>{order.patient_name}</td>
                  <td style={{ padding: '8px 0' }}>
                    <span className={`badge badge-${order.status.replace('_', '-')}`}>{order.status.replace('_', ' ')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Active Shipments / Exceptions */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
            Shipment Exceptions {exceptions.length > 0 && <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠ {exceptions.length}</span>}
          </h2>
          {exceptions.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>No active exceptions</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 0' }}>Tracking</th>
                  <th style={{ padding: '6px 0' }}>Status</th>
                  <th style={{ padding: '6px 0' }}>Last Update</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map(s => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)', background: '#ef444411' }}>
                    <td style={{ padding: '8px 0', fontFamily: 'var(--brand-mono)', fontSize: 12 }}>
                      <Link to={`/orders/${s.order_id}`}>{s.fedex_tracking_number}</Link>
                    </td>
                    <td style={{ padding: '8px 0', color: 'var(--danger)' }}>⚠ {s.latest_status || 'Exception'}</td>
                    <td style={{ padding: '8px 0', color: 'var(--text-muted)' }}>{relativeTime(s.last_polled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
