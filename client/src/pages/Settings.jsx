import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import useOrderStore from '../store/useOrderStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function Field({ label, name, value, onChange, type = 'text', hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
        {label}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        style={{ width: '100%' }}
        autoComplete="off"
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function SaveBar({ saving, saved, error, onSave }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
      <button onClick={onSave} disabled={saving} style={{
        background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6,
        padding: '8px 20px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1,
      }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Saved</span>}
      {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
    </div>
  );
}

// ─── Config section component ─────────────────────────────────────────────────

function ConfigSection({ title, icon, fields, values, onChange, onSave, saving, saved, error, children }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
      >
        <span style={{ fontWeight: 600, fontSize: 15 }}>{icon} {title}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{open ? '▲ collapse' : '▼ expand'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 20px 20px' }}>
          {fields.map(f => (
            <Field
              key={f.name}
              label={f.label}
              name={f.name}
              value={values[f.name] ?? ''}
              onChange={onChange}
              type={f.type || 'text'}
              hint={f.hint}
            />
          ))}
          {children}
          <SaveBar saving={saving} saved={saved} error={error} onSave={onSave} />
        </div>
      )}
    </div>
  );
}

// ─── Staff manager (admin only) ───────────────────────────────────────────────

function StaffManager() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const currentUser = useOrderStore(s => s.user);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('worker');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  useEffect(() => {
    api.get('/auth/users')
      .then(r => setUsers(r.data))
      .catch(() => setLoadError('Failed to load staff users. Please refresh the page.'))
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
  if (loadError) return <div style={{ color: 'var(--danger)', fontSize: 14, padding: '12px 0' }}>{loadError}</div>;

  return (
    <div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
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

      {resetTarget && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 16, maxWidth: 420 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Reset password for {resetTarget.name}</div>
          <form onSubmit={handleResetPassword} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="password" placeholder="New password (min 8)" value={resetPw} onChange={e => setResetPw(e.target.value)} required minLength={8} style={{ flex: 1 }} />
            <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontWeight: 600, cursor: 'pointer' }}>Set</button>
            <button type="button" onClick={() => setResetTarget(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
          </form>
          {resetMsg && <div style={{ fontSize: 13, marginTop: 8, color: resetMsg === 'Password reset.' ? 'var(--success)' : 'var(--danger)' }}>{resetMsg}</div>}
        </div>
      )}

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

// ─── Main Settings page ───────────────────────────────────────────────────────

const SECTIONS = [
  {
    key: 'stripe',
    title: 'Stripe Payments',
    icon: '💳',
    fields: [
      { name: 'STRIPE_PUBLISHABLE_KEY', label: 'Publishable Key (pk_…)', hint: 'Used by the browser — not a secret' },
      { name: 'STRIPE_SECRET_KEY', label: 'Secret Key (sk_…)', type: 'password' },
      { name: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook Secret (whsec_…)', type: 'password', hint: 'From Stripe Dashboard → Webhooks → your endpoint' },
    ],
  },
  {
    key: 'email',
    title: 'Email / SMTP',
    icon: '📧',
    fields: [
      { name: 'MAIL_HOST', label: 'SMTP Host' },
      { name: 'MAIL_PORT', label: 'SMTP Port', hint: '587 for STARTTLS, 465 for SSL' },
      { name: 'MAIL_USER', label: 'SMTP Username' },
      { name: 'MAIL_PASS', label: 'SMTP Password', type: 'password' },
      { name: 'MAIL_FROM', label: 'From Address', hint: 'e.g. "OrderFlow" <orders@001.com.mx>' },
      { name: 'ADMIN_EMAIL', label: 'Admin Alert Email', hint: 'Receives system alerts and exception notifications' },
    ],
  },
  {
    key: 'fedex',
    title: 'FedEx API',
    icon: '📦',
    fields: [
      { name: 'FEDEX_CLIENT_ID', label: 'Client ID' },
      { name: 'FEDEX_CLIENT_SECRET', label: 'Client Secret', type: 'password' },
      { name: 'FEDEX_ACCOUNT_NUMBER', label: 'Account Number' },
      { name: 'FEDEX_SANDBOX', label: 'Use Sandbox', hint: 'true = test mode, false = live shipments' },
    ],
  },
  {
    key: 'fedex_shipper',
    title: 'FedEx Ship From Address',
    icon: '🏭',
    fields: [
      { name: 'FEDEX_SHIPPER_NAME', label: 'Company / Sender Name', hint: 'Name printed on labels as the shipper' },
      { name: 'FEDEX_SHIPPER_PHONE', label: 'Phone Number', hint: 'Required by FedEx for the shipper contact' },
      { name: 'FEDEX_SHIPPER_STREET', label: 'Street Address' },
      { name: 'FEDEX_SHIPPER_STREET2', label: 'Street Line 2', hint: 'Suite, unit, etc. (optional)' },
      { name: 'FEDEX_SHIPPER_CITY', label: 'City' },
      { name: 'FEDEX_SHIPPER_STATE', label: 'State / Province Code', hint: 'e.g. CA, TX, BC' },
      { name: 'FEDEX_SHIPPER_ZIP', label: 'ZIP / Postal Code' },
      { name: 'FEDEX_SHIPPER_COUNTRY', label: 'Country Code', hint: 'e.g. US, MX, CA' },
    ],
  },
  {
    key: 'business',
    title: 'Business Info',
    icon: '🏢',
    fields: [
      { name: 'COMPANY_NAME', label: 'Company / Legal Name', hint: 'Appears on invoice PDFs, emails, and SMS messages' },
      { name: 'COMPANY_DBA', label: 'DBA (Doing Business As)', hint: 'Optional — shown as "d/b/a …" under the legal name on invoices' },
      { name: 'COMPANY_ADDRESS_1', label: 'Address Line 1', hint: 'Street address' },
      { name: 'COMPANY_ADDRESS_2', label: 'Address Line 2', hint: 'Suite, unit, PO Box, etc. (optional)' },
      { name: 'COMPANY_CITY', label: 'City' },
      { name: 'COMPANY_STATE', label: 'State / Province' },
      { name: 'COMPANY_ZIP', label: 'ZIP / Postal Code' },
      { name: 'COMPANY_COUNTRY', label: 'Country', hint: 'Optional — e.g. USA, Mexico' },
      { name: 'COMPANY_PHONE', label: 'Phone Number', hint: 'Main business phone shown on invoices' },
      { name: 'COMPANY_FAX', label: 'Fax Number', hint: 'Optional' },
      { name: 'COMPANY_EMAIL', label: 'Billing / Support Email', hint: 'Contact email shown on invoice PDFs and email footers' },
    ],
  },
  {
    key: 'app',
    title: 'App',
    icon: '⚙️',
    fields: [
      { name: 'BASE_URL', label: 'Base URL', hint: 'e.g. https://orders.your-domain.com — used in email/SMS payment links and PDFs. No trailing slash.' },
    ],
  },
];

export default function Settings() {
  const user = useOrderStore(s => s.user);
  const [config, setConfig] = useState({});
  const [configLoaded, setConfigLoaded] = useState(false);

  // Per-section save state
  const [sectionState, setSectionState] = useState({});

  // Change own password
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpMsg, setCpMsg] = useState('');
  const [cpError, setCpError] = useState('');

  // Email test
  const [testEmail, setTestEmail] = useState('');
  const [testMsg, setTestMsg] = useState('');

  // FedEx diagnostics
  const [fedexTesting, setFedexTesting] = useState(false);
  const [fedexSteps, setFedexSteps] = useState([]);

  useEffect(() => {
    api.get('/settings/config')
      .then(r => { setConfig(r.data); setConfigLoaded(true); })
      .catch(() => setConfigLoaded(true));
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setConfig(c => ({ ...c, [name]: value }));
  }

  async function handleSaveSection(section) {
    const keys = section.fields.map(f => f.name);
    const payload = {};
    keys.forEach(k => { payload[k] = config[k] ?? ''; });

    setSectionState(s => ({ ...s, [section.key]: { saving: true, saved: false, error: null } }));
    try {
      await api.patch('/settings/config', payload);
      setSectionState(s => ({ ...s, [section.key]: { saving: false, saved: true, error: null } }));
      setTimeout(() => setSectionState(s => ({ ...s, [section.key]: { ...s[section.key], saved: false } })), 3000);
    } catch (err) {
      setSectionState(s => ({ ...s, [section.key]: { saving: false, saved: false, error: err.response?.data?.message || 'Save failed.' } }));
    }
  }

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

  async function handleTestEmail(e) {
    e.preventDefault();
    setTestMsg('');
    try {
      await api.post('/settings/test-email', { to: testEmail });
      setTestMsg('✓ Test email sent — check your inbox.');
    } catch (err) {
      setTestMsg('✗ ' + (err.response?.data?.error || 'Failed to send.'));
    }
  }

  async function handleTestFedex() {
    setFedexTesting(true);
    setFedexSteps([]);
    try {
      const { data } = await api.post('/settings/test-fedex');
      setFedexSteps(data.steps || []);
    } catch (err) {
      setFedexSteps([{ name: 'Request', ok: false, detail: err.response?.data?.error || err.message }]);
    }
    setFedexTesting(false);
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, marginBottom: 24 }}>Settings</h1>

      {/* ── Integration config sections ─────────────────────────────────────── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Integrations</h2>
      {configLoaded && SECTIONS.map(section => {
        const ss = sectionState[section.key] || {};
        const isEmail = section.key === 'email';
        const isFedex = section.key === 'fedex';
        return (
          <ConfigSection
            key={section.key}
            title={section.title}
            icon={section.icon}
            fields={section.fields}
            values={config}
            onChange={handleChange}
            onSave={() => handleSaveSection(section)}
            saving={ss.saving}
            saved={ss.saved}
            error={ss.error}
          >
            {isEmail && (
              <form onSubmit={handleTestEmail} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 12px' }}>
                <input
                  type="email"
                  placeholder="Send test email to…"
                  value={testEmail}
                  onChange={e => setTestEmail(e.target.value)}
                  required
                  style={{ flex: 1 }}
                />
                <button type="submit" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)' }}>
                  Send test
                </button>
                {testMsg && <span style={{ fontSize: 13, color: testMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{testMsg}</span>}
              </form>
            )}
            {isFedex && (
              <div style={{ margin: '8px 0 12px' }}>
                <button
                  type="button"
                  onClick={handleTestFedex}
                  disabled={fedexTesting}
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)', opacity: fedexTesting ? 0.6 : 1 }}
                >
                  {fedexTesting ? 'Running diagnostics…' : '🔍 Test FedEx Connection'}
                </button>
                {fedexSteps.length > 0 && (
                  <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    {fedexSteps.map((step, i) => (
                      <div key={i} style={{
                        padding: '10px 14px',
                        borderBottom: i < fedexSteps.length - 1 ? '1px solid var(--border)' : 'none',
                        background: step.ok ? 'var(--bg-surface)' : '#ef444411',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{step.ok ? '✅' : '❌'}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: step.ok ? 'var(--text-primary)' : 'var(--danger)' }}>
                              {step.name}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, wordBreak: 'break-word' }}>
                              {step.detail}
                            </div>
                            {step.raw && (
                              <details style={{ marginTop: 6 }}>
                                <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Raw FedEx response</summary>
                                <pre style={{
                                  marginTop: 6, padding: 10, background: 'var(--bg-elevated)',
                                  borderRadius: 6, fontSize: 11, overflowX: 'auto',
                                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                  color: 'var(--danger)',
                                }}>
                                  {JSON.stringify(step.raw, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {fedexSteps.every(s => s.ok) && (
                      <div style={{ padding: '10px 14px', background: '#22c55e11', fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
                        ✓ All checks passed — FedEx is configured correctly.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </ConfigSection>
        );
      })}

      {/* ── Change own password ─────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 12px' }}>Your Account</h2>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 24, maxWidth: 420 }}>
        <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 14 }}>Change Password</div>
        <form onSubmit={handleChangePassword}>
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

      {/* ── Staff management (admin only) ───────────────────────────────────── */}
      {user?.role === 'admin' && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Staff Management</h2>
          <StaffManager />
        </>
      )}

      {/* ── Server info ─────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginTop: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Server</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.8 }}>
          <p>Settings saved here are stored in the database and take effect immediately — no restart needed.</p>
          <p style={{ marginTop: 6 }}>
            <code style={{ fontFamily: 'var(--brand-mono)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>POSTGRES_PASSWORD</code> and{' '}
            <code style={{ fontFamily: 'var(--brand-mono)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>SESSION_SECRET</code>{' '}
            must be set in the <code style={{ fontFamily: 'var(--brand-mono)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>.env</code> file on the server.
          </p>
          <p style={{ marginTop: 6 }}>Restart: <code style={{ fontFamily: 'var(--brand-mono)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>docker compose restart app</code></p>
        </div>
      </div>
    </div>
  );
}
