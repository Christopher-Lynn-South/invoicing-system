import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { fmtCurrency } from '../lib/utils';

function Card({ title, children, style }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, ...style }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>{title}</h2>
      {children}
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api.get('/dashboard/analytics')
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load analytics.'));
  };
  useEffect(load, []);

  if (error) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
      <button onClick={load} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 600, cursor: 'pointer' }}>Retry</button>
    </div>
  );
  if (!data) return <div style={{ color: 'var(--text-muted)', padding: 32 }}>Loading analytics…</div>;

  const months = data.monthly_revenue || [];
  const maxRev = Math.max(1, ...months.map(m => parseFloat(m.revenue)));
  const topProducts = data.top_products || [];
  const maxProd = Math.max(1, ...topProducts.map(p => parseFloat(p.revenue)));
  const churn = data.churn_risk || [];
  const adh = data.adherence || {};
  const autopay = data.autopay || { enabled: 0, total: 0 };

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginBottom: 6 }}>Analytics</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Revenue, refill adherence, and churn risk</p>

      {/* Headline stats */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 24px', minWidth: 170 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>12-Month Revenue</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)', fontFamily: 'var(--brand-mono)' }}>
            {fmtCurrency(months.reduce((s, m) => s + parseFloat(m.revenue), 0))}
          </div>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 24px', minWidth: 170 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Refill Adherence (90d)</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: adh.rate === null ? 'var(--text-muted)' : adh.rate >= 75 ? 'var(--success)' : adh.rate >= 50 ? 'var(--warning)' : 'var(--danger)' }}>
            {adh.rate === null ? '—' : `${adh.rate}%`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{adh.confirmed} confirmed · {adh.missed} missed</div>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 24px', minWidth: 170 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Autopay Adoption</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>
            {autopay.total > 0 ? Math.round((autopay.enabled / autopay.total) * 100) : 0}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{autopay.enabled} of {autopay.total} active refills</div>
        </div>
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 24px', minWidth: 170 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Churn Risk</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: churn.length > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {churn.length}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>patients overdue 1.5× their interval</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        {/* Monthly revenue bars */}
        <Card title="Monthly Revenue (12 mo)">
          {months.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No paid invoices yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {months.map(m => (
                <div key={m.month} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                  <span style={{ width: 58, color: 'var(--text-muted)', fontFamily: 'var(--brand-mono)' }}>{m.month}</span>
                  <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: 4, height: 18, position: 'relative' }}>
                    <div style={{ width: `${(parseFloat(m.revenue) / maxRev) * 100}%`, background: 'var(--accent)', height: '100%', borderRadius: 4, minWidth: 2 }} />
                  </div>
                  <span style={{ width: 90, textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(m.revenue)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Top products */}
        <Card title="Top Products (12 mo, paid)">
          {topProducts.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No sales yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topProducts.map(p => (
                <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                  <span style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{p.name}</span>
                  <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: 4, height: 18 }}>
                    <div style={{ width: `${(parseFloat(p.revenue) / maxProd) * 100}%`, background: 'var(--success)', height: '100%', borderRadius: 4, minWidth: 2 }} />
                  </div>
                  <span style={{ width: 120, textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(p.revenue)} <span style={{ color: 'var(--text-muted)' }}>({p.units})</span></span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Churn risk table */}
      <Card title={`Churn Risk — ${churn.length} patient${churn.length !== 1 ? 's' : ''} overdue`}>
        {churn.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No patients at risk — everyone is refilling on time. 🎉</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'left' }}>
                <th style={{ padding: '8px 12px' }}>Patient</th>
                <th style={{ padding: '8px 12px' }}>Product</th>
                <th style={{ padding: '8px 12px' }}>Interval</th>
                <th style={{ padding: '8px 12px' }}>Days Since Last</th>
                <th style={{ padding: '8px 12px' }}>Escalated</th>
              </tr>
            </thead>
            <tbody>
              {churn.map(c => (
                <tr key={`${c.patient_id}-${c.product_name}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <Link to={`/patients/${c.patient_id}`} style={{ fontWeight: 600 }}>{c.patient_name}</Link>
                  </td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{c.product_name}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{c.interval_days}d</td>
                  <td style={{ padding: '8px 12px', color: 'var(--danger)', fontWeight: 700 }}>{c.days_since_last}d</td>
                  <td style={{ padding: '8px 12px' }}>
                    {c.escalated ? <span className="badge badge-cancelled">Flagged</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
