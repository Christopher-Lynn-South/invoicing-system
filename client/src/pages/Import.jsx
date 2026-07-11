import React, { useState, useEffect, useRef } from 'react';
import api from '../lib/api';

// ─── Zoho API sync panel ───────────────────────────────────────────────────────
function ZohoApiSync() {
  const [status, setStatus] = useState(null); // { configured, job }
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const refresh = () => api.get('/import/zoho-api/status')
    .then(r => setStatus(r.data))
    .catch(() => {});

  useEffect(() => {
    refresh();
    return () => clearInterval(pollRef.current);
  }, []);

  // Poll while a job runs
  useEffect(() => {
    if (status?.job?.status === 'running' && !pollRef.current) {
      pollRef.current = setInterval(refresh, 2500);
    }
    if (status?.job?.status !== 'running' && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [status?.job?.status]);

  async function start() {
    setStarting(true); setError('');
    try {
      await api.post('/import/zoho-api/start');
      refresh();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to start sync');
    }
    setStarting(false);
  }

  const job = status?.job;
  const running = job?.status === 'running';

  return (
    <div style={{ background: 'var(--bg-surface)', border: '2px solid var(--accent)', borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 24 }}>⚡</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Sync directly from Zoho (recommended)</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Pulls every customer (with all their shipping addresses), product, sales order, invoice, and shipment
            via the Zoho API — records link exactly by Zoho's own IDs, no CSV matching. Safe to re-run: it updates
            existing records instead of duplicating.
          </div>
        </div>
        {status && !running && (
          <button onClick={start} disabled={starting || !status.configured}
            title={!status.configured ? 'Set the ZOHO_* variables in .env first' : ''}
            style={{
              background: status.configured ? 'var(--accent)' : 'var(--bg-elevated)',
              color: status.configured ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: 14,
              cursor: status.configured ? 'pointer' : 'default',
            }}>
            {starting ? 'Starting…' : 'Start Full Sync'}
          </button>
        )}
      </div>

      {status && !status.configured && (
        <div style={{ fontSize: 13, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <strong>One-time setup:</strong> create a "Self Client" at <code>api-console.zoho.com</code>, generate a code with scopes
          <code style={{ margin: '0 4px' }}>ZohoBooks.fullaccess.READ,ZohoInventory.FullAccess.READ</code>,
          exchange it for a refresh token, then add <code>ZOHO_CLIENT_ID</code>, <code>ZOHO_CLIENT_SECRET</code>,{' '}
          <code>ZOHO_REFRESH_TOKEN</code>, <code>ZOHO_ORG_ID</code> to your .env and restart. Full steps are in .env.example.
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>{error}</div>}

      {job && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            {running ? (
              <>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1.2s infinite' }} />
                <strong>Syncing — {job.phase}</strong>
                <span style={{ color: 'var(--text-muted)' }}>{job.progress}</span>
              </>
            ) : job.status === 'done' ? (
              <strong style={{ color: 'var(--success)' }}>✓ Sync complete</strong>
            ) : (
              <strong style={{ color: 'var(--danger)' }}>✗ Sync failed</strong>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: 'var(--text-secondary)' }}>
            {Object.entries(job.counts || {}).map(([k, v]) => (
              <span key={k}>
                <strong style={{ textTransform: 'capitalize' }}>{k}:</strong>{' '}
                {Object.entries(v).map(([kk, vv]) => `${vv} ${kk}`).join(', ')}
              </span>
            ))}
          </div>
          {job.errors?.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--warning)' }}>{job.errors.length} warning{job.errors.length !== 1 ? 's' : ''}</summary>
              <ul style={{ margin: '6px 0 0 18px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.8 }}>
                {job.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
    </div>
  );
}

// ─── Danger zone: wipe data ────────────────────────────────────────────────────
function DangerZone() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [scope, setScope] = useState('orders');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function purge() {
    setBusy(true); setError(''); setResult(null);
    try {
      const { data } = await api.post('/import/purge', { confirm: confirmText, scope });
      setResult(data);
      setConfirmText('');
    } catch (err) {
      setError(err.response?.data?.message || 'Purge failed');
    }
    setBusy(false);
  }

  return (
    <div style={{ border: '1px solid var(--danger)', borderRadius: 12, padding: '16px 24px', marginTop: 32, background: 'var(--bg-surface)' }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontWeight: 700, fontSize: 14, cursor: 'pointer', padding: 0 }}>
        {open ? '▾' : '▸'} Danger zone — wipe imported data
      </button>
      {open && (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
            Use this to start over before a clean re-import. <strong>This permanently deletes data</strong> — it cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" checked={scope === 'orders'} onChange={() => setScope('orders')} />
              Orders, invoices, shipments &amp; reminders only <span style={{ color: 'var(--text-muted)' }}>(keeps patients + products)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Everything</span> <span style={{ color: 'var(--text-muted)' }}>(also patients, products, addresses)</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input placeholder='Type: DELETE ALL DATA' value={confirmText} onChange={e => setConfirmText(e.target.value)} style={{ width: 240 }} />
            <button onClick={purge} disabled={busy || confirmText !== 'DELETE ALL DATA'}
              style={{
                background: confirmText === 'DELETE ALL DATA' ? 'var(--danger)' : 'var(--bg-elevated)',
                color: confirmText === 'DELETE ALL DATA' ? '#fff' : 'var(--text-muted)',
                border: 'none', borderRadius: 8, padding: '9px 20px', fontWeight: 700, fontSize: 13,
                cursor: confirmText === 'DELETE ALL DATA' ? 'pointer' : 'default',
              }}>
              {busy ? 'Deleting…' : 'Permanently Delete'}
            </button>
          </div>
          {error && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
          {result && (
            <div style={{ color: 'var(--success)', marginTop: 8 }}>
              ✓ Deleted: {Object.entries(result.deleted).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${t}`).join(', ') || 'nothing (already empty)'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const FILES = [
  {
    key: 'accounts',
    label: 'Customers / Accounts',
    icon: '👤',
    desc: 'Zoho CRM → Contacts/Accounts export, or Zoho Books → Customers CSV',
    cols: 'Account Name, Email, Phone, Billing Street, Billing City, Billing State, Billing Code, Billing Country, Shipping Street…',
    entity: 'patients',
  },
  {
    key: 'items',
    label: 'Products / Items',
    icon: '📦',
    desc: 'Zoho Inventory or Books → Items export',
    cols: 'Item Name, SKU, Sales Price, Unit',
    entity: 'products',
  },
  {
    key: 'sales_orders',
    label: 'Sales Orders',
    icon: '📋',
    desc: 'Zoho Books or Inventory → Sales Orders export (one row per line item)',
    cols: 'Sales Order#, Customer Name, Date, Status, Item Name, Quantity, Item Price, Line Total',
    entity: 'sales_orders',
  },
  {
    key: 'invoices',
    label: 'Invoices',
    icon: '🧾',
    desc: 'Zoho Books → Invoices export',
    cols: 'Invoice#, Sales Order#, Status, Sub Total, Total, Balance Due, Payment Mode, Payment Date, Due Date',
    entity: 'invoices',
  },
  {
    key: 'packages',
    label: 'Shipments / Packages',
    icon: '🚚',
    desc: 'Zoho Inventory → Packages / Shipments export',
    cols: 'Package#, Sales Order#, Tracking Number, Carrier, Ship Date, Delivery Date, Weight',
    entity: 'shipments',
  },
];

function CountBadge({ n, color }) {
  if (!n) return null;
  return (
    <span style={{ background: color + '22', color, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 9999 }}>
      {n}
    </span>
  );
}

function DiagnosticsPanel({ diagnostics }) {
  const [open, setOpen] = useState(false);
  if (!diagnostics || Object.keys(diagnostics).length === 0) return null;
  return (
    <details open={open} onToggle={e => setOpen(e.target.open)}
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-muted)' }}>🔍 CSV diagnostics — column headers detected per file</summary>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(diagnostics).map(([key, info]) => (
          <div key={key}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{key}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{info.rows} rows</span>
            {info.rows === 0 ? (
              <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠ no rows parsed — check file format</span>
            ) : (
              <div style={{ marginTop: 4, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                {info.columns.map(c => <code key={c} style={{ background: 'var(--bg-surface)', padding: '1px 5px', borderRadius: 3, marginRight: 6 }}>{c}</code>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function EntityResult({ label, icon, data }) {
  const [showSamples, setShowSamples] = useState(false);
  if (!data) return null;
  const total = data.inserted + data.skipped + data.failed;
  if (total === 0) return null;
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        <CountBadge n={data.inserted} color="var(--success)" />
        {data.skipped > 0 && <CountBadge n={`${data.skipped} skipped`} color="var(--text-muted)" />}
        {data.failed > 0 && <CountBadge n={`${data.failed} failed`} color="var(--danger)" />}
      </div>
      {data.samples?.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowSamples(s => !s)} style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            {showSamples ? '▲ hide' : '▼ show'} sample rows
          </button>
          {showSamples && (
            <div style={{ marginTop: 8, overflowX: 'auto' }}>
              <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    {Object.keys(data.samples[0]).map(k => (
                      <th key={k} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.samples.map((s, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      {Object.values(s).map((v, j) => (
                        <td key={j} style={{ padding: '4px 8px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Import() {
  const [files, setFiles] = useState({});
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('upload'); // 'upload' | 'preview' | 'done'
  const [report, setReport] = useState(null);

  function onFile(key, e) {
    const file = e.target.files?.[0];
    if (file) setFiles(f => ({ ...f, [key]: file }));
    else { const next = { ...files }; delete next[key]; setFiles(next); }
  }

  async function run(mode) {
    setLoading(true);
    const fd = new FormData();
    for (const [key, file] of Object.entries(files)) fd.append(key, file);
    try {
      const { data } = await api.post(`/import/zoho?mode=${mode}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setReport(data.report);
      setStep(mode === 'execute' ? 'done' : 'preview');
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Import failed');
    }
    setLoading(false);
  }

  const fileCount = Object.keys(files).length;
  const hasFiles = fileCount > 0;

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginBottom: 6 }}>Zoho Import</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Sync directly from the Zoho API (best), or upload CSV exports below as a fallback.
        </p>
      </div>

      <ZohoApiSync />

      {/* ── How to export ───────────────────────────────────────────────────── */}
      <details style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>📖 How to export from Zoho</summary>
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.9 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>Recommended import order:</div>
          <div><strong>1. Customers (accounts.csv):</strong> Zoho CRM → Contacts → Export all, or Zoho Books → Customers → Export</div>
          <div><strong>2. Products (items.csv):</strong> Zoho Books / Inventory → Items → Export</div>
          <div><strong>3. Sales Orders (sales_orders.csv):</strong> Zoho Books → Sales Orders → Export (detail view with line items)</div>
          <div><strong>4. Shipments (packages.csv):</strong> Zoho Inventory → Packages or Shipments → Export</div>
          <div><strong>5. Invoices (invoices.csv):</strong> Zoho Books → Invoices → Export</div>
          <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            You can upload multiple files at once or one at a time. Sales orders must be imported before shipments and invoices.
            Always export as CSV. Column names do not need to match exactly — the importer recognises common Zoho field names automatically.
          </div>
        </div>
      </details>

      {/* ── File upload cards ────────────────────────────────────────────────── */}
      {step === 'upload' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
            {FILES.map(f => {
              const chosen = files[f.key];
              return (
                <label key={f.key} style={{
                  display: 'block', background: 'var(--bg-surface)', border: `2px dashed ${chosen ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 10, padding: 16, cursor: 'pointer', transition: 'border-color 0.15s',
                }}>
                  <input type="file" accept=".csv" onChange={e => onFile(f.key, e)} style={{ display: 'none' }} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{f.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{f.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{f.desc}</div>
                      {chosen ? (
                        <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                          ✓ {chosen.name}
                          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({(chosen.size / 1024).toFixed(1)} KB)</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click to choose CSV file</div>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={() => run('preview')}
              disabled={!hasFiles || loading}
              style={{
                background: hasFiles ? 'var(--accent)' : 'var(--bg-elevated)',
                color: hasFiles ? '#fff' : 'var(--text-muted)',
                border: 'none', borderRadius: 8, padding: '10px 28px', fontWeight: 600, fontSize: 14,
                cursor: hasFiles ? 'pointer' : 'default', opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Analysing…' : `Preview Import (${fileCount} file${fileCount !== 1 ? 's' : ''})`}
            </button>
            {!hasFiles && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Upload at least one CSV file to continue.</span>}
          </div>
        </>
      )}

      {/* ── Preview results ──────────────────────────────────────────────────── */}
      {step === 'preview' && report && (
        <div>
          <div style={{ background: '#f59e0b11', border: '1px solid #f59e0b44', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13 }}>
            <strong>Preview only — nothing has been imported yet.</strong> Review the counts below then click <strong>Execute Import</strong> to proceed.
          </div>

          <DiagnosticsPanel diagnostics={report.diagnostics} />

          {FILES.map(f => (
            <EntityResult key={f.key} label={f.label} icon={f.icon} data={report[f.entity]} />
          ))}

          {report.anomalies?.length > 0 && (
            <div style={{ background: '#ef444411', border: '1px solid #ef444433', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--danger)', marginBottom: 8 }}>
                ⚠ {report.anomalies.length} warning{report.anomalies.length !== 1 ? 's' : ''} — review before importing
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 12, color: 'var(--danger)', lineHeight: 2 }}>
                {report.anomalies.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20 }}>
            <button onClick={() => run('execute')} disabled={loading} style={{
              background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 28px', fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: loading ? 0.7 : 1,
            }}>
              {loading ? 'Importing…' : '✓ Execute Import'}
            </button>
            <button onClick={() => { setStep('upload'); setReport(null); }} disabled={loading} style={{
              background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)',
              borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer',
            }}>
              ← Change Files
            </button>
          </div>
        </div>
      )}

      {/* ── Done ────────────────────────────────────────────────────────────── */}
      {step === 'done' && report && (
        <div>
          <div style={{ background: 'var(--success)11', border: '1px solid var(--success)44', borderRadius: 8, padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>✅</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--success)' }}>Import complete</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                Your Zoho data has been imported. Check the counts below for a full summary.
              </div>
            </div>
          </div>

          <DiagnosticsPanel diagnostics={report.diagnostics} />

          {FILES.map(f => (
            <EntityResult key={f.key} label={f.label} icon={f.icon} data={report[f.entity]} />
          ))}

          {report.anomalies?.length > 0 && (
            <div style={{ background: '#f59e0b11', border: '1px solid #f59e0b44', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#f59e0b', marginBottom: 8 }}>
                {report.anomalies.length} item{report.anomalies.length !== 1 ? 's' : ''} need manual review
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 12, color: '#f59e0b', lineHeight: 2 }}>
                {report.anomalies.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <button onClick={() => { setStep('upload'); setReport(null); setFiles({}); }} style={{
            marginTop: 16, background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px 24px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}>
            Import More Files
          </button>
        </div>
      )}

      <DangerZone />
    </div>
  );
}
