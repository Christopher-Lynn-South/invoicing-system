import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';

const STATUS_COLOR = {
  paid: 'var(--success)',
  pending: 'var(--warning)',
  failed: 'var(--danger)',
};

function fmt(val) {
  return `$${Number(val).toFixed(2)}`;
}

function Badge({ label, color }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1,
      color, background: color + '22', padding: '2px 8px', borderRadius: 20,
    }}>{label}</span>
  );
}

// Calculate next due date from dosage fields (7-day early warning)
function calcNextDue(rule) {
  if (!rule.last_fill_date || !rule.dosage_mg || !rule.last_fill_qty_mg) return null;
  const perDay = parseFloat(rule.dosage_mg) * parseFloat(rule.doses_per_freq || 1)
    * (rule.dosage_freq === 'weekly' ? 1 / 7 : 1);
  if (perDay <= 0) return null;
  const daysSupply = Math.floor(parseFloat(rule.last_fill_qty_mg) / perDay);
  const d = new Date(rule.last_fill_date);
  d.setDate(d.getDate() + daysSupply - 7);
  return d.toISOString().split('T')[0];
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const TABS = [
  { key: 'invoices',      label: 'Invoices' },
  { key: 'shipments',     label: 'Shipments' },
  { key: 'prescriptions', label: 'Prescriptions' },
  { key: 'refills',       label: 'Refills' },
  { key: 'account',       label: 'Account' },
];

export default function PatientPortal() {
  const navigate = useNavigate();
  const patientUser = useOrderStore(s => s.patientUser);
  const setPatientUser = useOrderStore(s => s.setPatientUser);

  const [invoices, setInvoices] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('invoices');

  // Prescriptions
  const [rxList, setRxList] = useState(null);
  const [rxLoading, setRxLoading] = useState(false);

  // Refills
  const [refills, setRefills] = useState(null);
  const [refillsLoading, setRefillsLoading] = useState(false);
  // Per-rule request state: { [ruleId]: 'idle' | 'loading' | 'sent' | 'error' }
  const [requestState, setRequestState] = useState({});
  // Per-rule pause state: optimistic active value
  const [pauseLoading, setPauseLoading] = useState({});

  // Change password
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpMsg, setCpMsg] = useState('');
  const [cpError, setCpError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/customer/invoices'),
      api.get('/customer/shipments'),
    ]).then(([inv, ship]) => {
      setInvoices(inv.data);
      setShipments(ship.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Lazy-load prescriptions when tab first opened
  useEffect(() => {
    if (tab === 'prescriptions' && rxList === null && !rxLoading) {
      setRxLoading(true);
      api.get('/customer/prescriptions')
        .then(r => setRxList(r.data))
        .catch(() => setRxList([]))
        .finally(() => setRxLoading(false));
    }
  }, [tab, rxList, rxLoading]);

  // Lazy-load refills when tab first opened
  useEffect(() => {
    if (tab === 'refills' && refills === null && !refillsLoading) {
      setRefillsLoading(true);
      api.get('/customer/refills')
        .then(r => setRefills(r.data))
        .catch(() => setRefills([]))
        .finally(() => setRefillsLoading(false));
    }
  }, [tab, refills, refillsLoading]);

  async function handleLogout() {
    await api.post('/customer/logout');
    setPatientUser(null);
    navigate('/login');
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

  async function handleRequestRefill(ruleId) {
    setRequestState(s => ({ ...s, [ruleId]: 'loading' }));
    try {
      await api.post(`/customer/refills/${ruleId}/request`);
      setRequestState(s => ({ ...s, [ruleId]: 'sent' }));
    } catch {
      setRequestState(s => ({ ...s, [ruleId]: 'error' }));
    }
  }

  async function handleTogglePause(rule) {
    setPauseLoading(s => ({ ...s, [rule.id]: true }));
    try {
      const { data } = await api.patch(`/customer/refills/${rule.id}/pause`);
      setRefills(prev => prev.map(r => r.id === rule.id ? { ...r, active: data.active } : r));
    } catch {
      // silently revert — the UI will remain unchanged since we didn't optimistically update
    } finally {
      setPauseLoading(s => ({ ...s, [rule.id]: false }));
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)',
              background: tab === t.key ? 'var(--accent)' : 'var(--bg-surface)',
              color: tab === t.key ? '#fff' : 'var(--text-secondary)',
              fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── Invoices ── */}
        {tab === 'invoices' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Your Invoices</h2>
              <button onClick={load} style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}>
                Refresh
              </button>
            </div>
            {invoices.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No invoices yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {invoices.map(inv => (
                  <Link key={inv.id} to={`/customer/portal/invoice/${inv.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      cursor: 'pointer',
                    }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{inv.invoice_number}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Order: {inv.order_number}</div>
                        {inv.due_date && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Due: {inv.due_date}</div>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Badge label={inv.pay_status} color={STATUS_COLOR[inv.pay_status] || 'var(--text-muted)'} />
                        <span style={{ fontWeight: 600 }}>{fmt(inv.total)}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>View →</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Shipments ── */}
        {tab === 'shipments' && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Your Shipments</h2>
            {shipments.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No shipments yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {shipments.map(s => (
                  <div key={s.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>Order: {s.order_number}</span>
                      <Badge label={s.status} color={STATUS_COLOR[s.status] || 'var(--text-muted)'} />
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

        {/* ── Prescriptions ── */}
        {tab === 'prescriptions' && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Your Prescriptions</h2>
            {rxLoading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>
            ) : !rxList || rxList.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No prescriptions on file.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {rxList.map(rx => {
                  const today = new Date().toISOString().split('T')[0];
                  const expired = rx.expiry_date && rx.expiry_date < today;
                  return (
                    <div key={rx.id} style={{ background: 'var(--bg-surface)', border: `1px solid ${expired ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 10, padding: '18px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                            Dr. {rx.prescribing_doctor}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            <span>Issued: {fmtDate(rx.issue_date)}</span>
                            {rx.expiry_date && (
                              <span style={{ color: expired ? 'var(--danger)' : 'var(--text-muted)' }}>
                                {expired ? 'Expired: ' : 'Expires: '}{fmtDate(rx.expiry_date)}
                              </span>
                            )}
                          </div>
                          {rx.notes && (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{rx.notes}</div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                          {expired && <Badge label="Expired" color="var(--danger)" />}
                          <a
                            href={`/api/customer/prescriptions/${rx.id}/file`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none', border: '1px solid var(--accent)', borderRadius: 6, padding: '5px 12px', whiteSpace: 'nowrap' }}
                          >
                            View
                          </a>
                          <a
                            href={`/api/customer/prescriptions/${rx.id}/file?download=1`}
                            style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', whiteSpace: 'nowrap' }}
                          >
                            Download
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Refills ── */}
        {tab === 'refills' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Your Refill Schedule</h2>
              <button
                onClick={() => { setRefills(null); setRefillsLoading(false); }}
                style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer' }}
              >
                Refresh
              </button>
            </div>
            {refillsLoading ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</div>
            ) : !refills || refills.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No refill schedule set up yet. Contact us to get started.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {refills.map(rule => {
                  const nextDue = calcNextDue(rule);
                  const today = new Date().toISOString().split('T')[0];
                  const overdue = nextDue && nextDue < today;
                  const dueSoon = nextDue && !overdue && nextDue <= new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
                  const reqStatus = requestState[rule.id] || 'idle';
                  const latestReq = rule.latest_request;
                  const hasPendingRequest = latestReq && latestReq.status === 'pending';
                  return (
                    <div key={rule.id} style={{
                      background: 'var(--bg-surface)',
                      border: `1px solid ${overdue ? 'var(--danger)' : dueSoon ? 'var(--warning)' : 'var(--border)'}`,
                      borderRadius: 10, padding: '18px 20px',
                      opacity: rule.active ? 1 : 0.6,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <span style={{ fontWeight: 600, fontSize: 15 }}>{rule.product_name || 'Unknown product'}</span>
                            {!rule.active && <Badge label="Paused" color="var(--text-muted)" />}
                            {rule.active && overdue && <Badge label="Overdue" color="var(--danger)" />}
                            {rule.active && dueSoon && <Badge label="Due Soon" color="var(--warning)" />}
                          </div>

                          <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {rule.dosage_mg && (
                              <span>
                                Dosage: {rule.dosage_mg} mg {rule.dosage_freq}
                                {rule.doses_per_freq && parseFloat(rule.doses_per_freq) !== 1
                                  ? ` × ${rule.doses_per_freq}`
                                  : ''}
                              </span>
                            )}
                            {nextDue && (
                              <span style={{ color: overdue ? 'var(--danger)' : dueSoon ? 'var(--warning)' : 'inherit' }}>
                                {overdue ? 'Was due: ' : 'Next refill: '}{fmtDate(nextDue)}
                              </span>
                            )}
                            {rule.last_fill_date && (
                              <span>Last filled: {fmtDate(rule.last_fill_date)}</span>
                            )}
                          </div>

                          {/* Latest request status */}
                          {latestReq && (
                            <div style={{ marginTop: 8, fontSize: 12 }}>
                              {latestReq.status === 'pending' && (
                                <span style={{ color: 'var(--warning)' }}>
                                  Refill request sent {fmtDate(latestReq.created_at)} — awaiting confirmation
                                </span>
                              )}
                              {latestReq.status === 'confirmed' && (
                                <span style={{ color: 'var(--success)' }}>
                                  Last refill confirmed {fmtDate(latestReq.responded_at || latestReq.created_at)}
                                </span>
                              )}
                              {latestReq.status === 'declined' && (
                                <span style={{ color: 'var(--danger)' }}>
                                  Last refill declined {fmtDate(latestReq.responded_at || latestReq.created_at)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                          {/* Request refill button */}
                          {rule.active && (
                            reqStatus === 'sent' ? (
                              <span style={{ fontSize: 13, color: 'var(--success)' }}>Request sent ✓</span>
                            ) : reqStatus === 'error' ? (
                              <span style={{ fontSize: 13, color: 'var(--danger)' }}>Failed — try again</span>
                            ) : (
                              <button
                                onClick={() => handleRequestRefill(rule.id)}
                                disabled={reqStatus === 'loading' || hasPendingRequest}
                                title={hasPendingRequest ? 'A refill request is already pending' : ''}
                                style={{
                                  background: 'var(--accent)', color: '#fff', border: 'none',
                                  borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13,
                                  cursor: (reqStatus === 'loading' || hasPendingRequest) ? 'not-allowed' : 'pointer',
                                  opacity: (reqStatus === 'loading' || hasPendingRequest) ? 0.6 : 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {reqStatus === 'loading' ? 'Sending…' : hasPendingRequest ? 'Request Pending' : 'Request Refill'}
                              </button>
                            )
                          )}

                          {/* Pause / Resume toggle */}
                          <button
                            onClick={() => handleTogglePause(rule)}
                            disabled={!!pauseLoading[rule.id]}
                            style={{
                              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                              padding: '6px 14px', fontSize: 12, fontWeight: 600,
                              color: rule.active ? 'var(--text-muted)' : 'var(--accent)',
                              cursor: pauseLoading[rule.id] ? 'not-allowed' : 'pointer',
                              opacity: pauseLoading[rule.id] ? 0.5 : 1,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {pauseLoading[rule.id] ? '…' : rule.active ? 'Pause Reminders' : 'Resume Reminders'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Account ── */}
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
