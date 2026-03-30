import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import useOrderStore from '../store/useOrderStore';
import { fmtDate } from '../lib/utils';
import Modal from '../components/Modal';
import AddressAutocomplete from '../components/AddressAutocomplete';

const EMPTY_ADDR = { street: '', street2: '', city: '', state: '', zip: '', country: 'US' };

function ShipAddrFields({ form, setForm }) {
  const f = (field, val) => setForm(p => ({ ...p, [field]: val }));
  const inp = { width: '100%' };
  const lbl = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 3 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div><label style={lbl}>Label *</label><input placeholder="Home, Office…" value={form.label} onChange={e => f('label', e.target.value)} style={inp} /></div>
        <div><label style={lbl}>Street *</label><input placeholder="123 Main St" value={form.street} onChange={e => f('street', e.target.value)} style={inp} /></div>
      </div>
      <div><label style={lbl}>Street 2</label><input placeholder="Apt, Suite…" value={form.street2} onChange={e => f('street2', e.target.value)} style={inp} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 100px', gap: 8 }}>
        <div><label style={lbl}>City *</label><input placeholder="City" value={form.city} onChange={e => f('city', e.target.value)} style={inp} /></div>
        <div><label style={lbl}>State *</label><input placeholder="TX" maxLength={2} value={form.state} onChange={e => f('state', e.target.value.toUpperCase())} style={inp} /></div>
        <div><label style={lbl}>ZIP *</label><input placeholder="78701" value={form.zip} onChange={e => f('zip', e.target.value)} style={inp} /></div>
      </div>
    </div>
  );
}

function AddrDisplay({ label, addr, onEdit }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
        <button onClick={onEdit} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)44', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>
          {addr ? 'Edit' : '+ Add'}
        </button>
      </div>
      {addr ? (
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          {addr.street && <div>{addr.street}</div>}
          {addr.street2 && <div>{addr.street2}</div>}
          <div>{[addr.city, addr.state, addr.zip].filter(Boolean).join(', ')}</div>
          {addr.country && <div>{addr.country}</div>}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Not set</div>
      )}
    </div>
  );
}

const REL_COLORS = {
  parent: '#3b82f6', guardian: '#8b5cf6', emergency: '#ef4444',
  caregiver: '#10b981', authorized_rep: '#f59e0b', spouse: '#14b8a6', other: '#6b7280',
};

export default function PatientDetail() {
  const { id } = useParams();
  const addToast = useOrderStore(s => s.addToast);
  const [patient, setPatient] = useState(null);
  const [tab, setTab] = useState('overview');
  const [prescriptions, setPrescriptions] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [reminders, setReminders] = useState([]);
  const products = useOrderStore(s => s.products);
  const fetchProducts = useOrderStore(s => s.fetchProducts);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderForm, setReminderForm] = useState({ product_id: '', dosage_mg: '', dosage_freq: 'daily', doses_per_freq: '1', last_fill_qty_mg: '', last_fill_date: new Date().toISOString().split('T')[0] });
  const [savingReminder, setSavingReminder] = useState(false);
  const [contactModal, setContactModal] = useState(false);
  const [contactForm, setContactForm] = useState({ relationship: 'guardian', first_name: '', last_name: '', phone: '', email: '', is_primary: false, receives_notifications: false });

  // Address editing (single billing/shipping on patient record)
  const [addrModal, setAddrModal] = useState(null); // null | 'billing' | 'shipping'
  const [addrForm, setAddrForm] = useState(EMPTY_ADDR);
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);

  // Ship-to address book
  const [shipAddrs, setShipAddrs]           = useState([]);
  const [shipAddrEditId, setShipAddrEditId] = useState(null); // null | 'new' | uuid
  const [shipAddrForm, setShipAddrForm]     = useState({ label: '', street: '', street2: '', city: '', state: '', zip: '' });
  const [shipAddrSaving, setShipAddrSaving] = useState(false);
  const [shipAddrDelId, setShipAddrDelId]   = useState(null); // uuid being confirmed for delete

  async function loadShipAddrs(patientId) {
    try {
      const { data } = await api.get(`/patients/${patientId}/shipping-addresses`);
      setShipAddrs(data);
    } catch { /* non-fatal */ }
  }

  async function saveShipAddr(e) {
    e.preventDefault();
    setShipAddrSaving(true);
    try {
      if (shipAddrEditId === 'new') {
        const { data } = await api.post(`/patients/${id}/shipping-addresses`, { ...shipAddrForm, country: 'US' });
        setShipAddrs(prev => [...prev, data]);
      } else {
        const { data } = await api.patch(`/patients/${id}/shipping-addresses/${shipAddrEditId}`, shipAddrForm);
        setShipAddrs(prev => prev.map(a => a.id === shipAddrEditId ? data : a));
      }
      setShipAddrEditId(null);
      addToast('Address saved', 'success');
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to save address', 'error');
    }
    setShipAddrSaving(false);
  }

  async function deleteShipAddr(addrId) {
    try {
      await api.delete(`/patients/${id}/shipping-addresses/${addrId}`);
      setShipAddrs(prev => {
        const remaining = prev.filter(a => a.id !== addrId);
        const wasDefault = prev.find(a => a.id === addrId)?.is_default;
        if (wasDefault && remaining.length > 0) {
          const oldest = [...remaining].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
          return remaining.map(a => ({ ...a, is_default: a.id === oldest.id }));
        }
        return remaining;
      });
      setShipAddrDelId(null);
      addToast('Address deleted', 'success');
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to delete address', 'error');
    }
  }

  async function setDefaultShipAddr(addrId) {
    try {
      const { data } = await api.post(`/patients/${id}/shipping-addresses/${addrId}/set-default`);
      setShipAddrs(prev => prev.map(a => ({ ...a, is_default: a.id === addrId })));
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to set default', 'error');
    }
  }

  function openAddrModal(type) {
    const existing = type === 'billing' ? patient.billing_address : patient.shipping_address;
    setAddrForm({ ...EMPTY_ADDR, ...(existing || {}) });
    setSameAsBilling(false);
    setAddrModal(type);
  }

  async function saveAddr(e) {
    e.preventDefault();
    setSavingAddr(true);
    try {
      const value = sameAsBilling && addrModal === 'shipping'
        ? { ...patient.billing_address }
        : addrForm;
      await api.put(`/patients/${id}`, { [addrModal === 'billing' ? 'billing_address' : 'shipping_address']: value });
      addToast(`${addrModal === 'billing' ? 'Billing' : 'Shipping'} address saved`, 'success');
      setAddrModal(null);
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to save address', 'error');
    }
    setSavingAddr(false);
  }

  async function load() {
    const [pRes, rxRes, ctRes, remRes] = await Promise.all([
      api.get(`/patients/${id}`),
      api.get(`/patients/${id}/prescriptions`),
      api.get(`/patients/${id}/contacts`),
      api.get(`/reminders/patient/${id}`),
    ]);
    setPatient(pRes.data);
    setReminders(remRes.data);
    setPrescriptions(rxRes.data);
    setContacts(ctRes.data);
    loadShipAddrs(id);
  }

  useEffect(() => { load(); fetchProducts(); }, [id]);

  async function grantPortalAccess() {
    try {
      await api.post(`/customer/grant-access/${id}`);
      addToast('Portal access granted — credentials emailed to customer.', 'success');
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to grant access.', 'error');
    }
  }

  async function revokePortalAccess() {
    if (!window.confirm('Revoke this patient\'s portal access?')) return;
    try {
      await api.post(`/customer/revoke-access/${id}`);
      addToast('Portal access revoked.', 'success');
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to revoke access.', 'error');
    }
  }

  async function saveReminder(e) {
    e.preventDefault();
    setSavingReminder(true);
    try {
      await api.post('/reminders', {
        patient_id: id,
        product_id: reminderForm.product_id,
        dosage_mg: parseFloat(reminderForm.dosage_mg),
        dosage_freq: reminderForm.dosage_freq,
        doses_per_freq: parseFloat(reminderForm.doses_per_freq || 1),
        last_fill_qty_mg: parseFloat(reminderForm.last_fill_qty_mg),
        last_fill_date: reminderForm.last_fill_date,
      });
      addToast('Reminder created', 'success');
      setShowReminderModal(false);
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed', 'error');
    }
    setSavingReminder(false);
  }

  async function saveContact(e) {
    e.preventDefault();
    try {
      await api.post(`/patients/${id}/contacts`, contactForm);
      addToast('Contact added', 'success');
      setContactModal(false);
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed', 'error');
    }
  }

  if (!patient) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</div>;

  const primaryContact = contacts.find(c => c.is_primary);
  const today = new Date().toISOString().split('T')[0];
  const activeRx = prescriptions.find(r => r.status === 'active' && (!r.expiry_date || r.expiry_date >= today));
  const expiringSoon = prescriptions.find(r => r.status === 'active' && r.expiry_date && r.expiry_date >= today && new Date(r.expiry_date) <= new Date(Date.now() + 30 * 86400000));
  const isMinor = patient.date_of_birth && (new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() < 18);

  return (
    <div>
      <Link to="/patients" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Patients</Link>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginTop: 12, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28 }}>{patient.name}</h1>
          {primaryContact && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {primaryContact.relationship.charAt(0).toUpperCase() + primaryContact.relationship.slice(1)}: {primaryContact.first_name} {primaryContact.last_name}
            </p>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{patient.email}</p>
        </div>
        {/* Portal access controls */}
        {patient.email && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1,
              color: patient.portal_enabled ? 'var(--success)' : 'var(--text-muted)',
              background: patient.portal_enabled ? 'var(--success)22' : 'var(--bg-elevated)',
              padding: '2px 8px', borderRadius: 20,
            }}>
              Portal {patient.portal_enabled ? 'enabled' : 'disabled'}
            </span>
            {patient.portal_enabled ? (
              <button onClick={revokePortalAccess} style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: '1px solid var(--danger)44', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                Revoke access
              </button>
            ) : (
              <button onClick={grantPortalAccess} style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)44', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                Grant portal access
              </button>
            )}
          </div>
        )}
      </div>

      {/* Banners */}
      {isMinor && !primaryContact && (
        <div style={{ background: '#f59e0b22', border: '1px solid #f59e0b44', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 13, color: '#f59e0b' }}>
          ⚠ Minor patient — parent/guardian contact required.
        </div>
      )}
      {patient.requires_prescription && !activeRx && (
        <div style={{ background: '#ef444422', border: '1px solid #ef444444', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 13, color: 'var(--danger)' }}>
          🔴 No active prescription on file. Orders are blocked until a valid prescription is uploaded.
        </div>
      )}
      {expiringSoon && (
        <div style={{ background: '#f59e0b22', border: '1px solid #f59e0b44', borderRadius: 8, padding: '10px 16px', marginBottom: 12, fontSize: 13, color: '#f59e0b' }}>
          ⚠ Prescription expiring soon: {fmtDate(expiringSoon.expiry_date)} — please upload a renewal.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {['overview', 'prescriptions', 'contacts', 'orders', 'reminders'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none', padding: '8px 16px', fontSize: 14, cursor: 'pointer',
            color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
            borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            fontWeight: tab === t ? 600 : 400, textTransform: 'capitalize',
          }}>{t}</button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[
            ['Email', patient.email],
            ['Phone', patient.phone],
            ['Date of Birth', fmtDate(patient.date_of_birth)],
            ['USDC Wallet', patient.usdc_wallet],
            ['Stripe Customer', patient.stripe_customer_id],
          ].map(([label, value]) => (
            <div key={label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
              <div style={{ fontSize: 14, fontFamily: label.includes('Wallet') || label.includes('Stripe') ? 'var(--brand-mono)' : 'inherit', wordBreak: 'break-all' }}>
                {value || '—'}
              </div>
            </div>
          ))}
          <AddrDisplay label="Billing Address" addr={patient.billing_address} onEdit={() => openAddrModal('billing')} />
          <AddrDisplay label="Default Shipping (profile)" addr={patient.shipping_address} onEdit={() => openAddrModal('shipping')} />
        </div>

        {/* ── Ship-To Address Book ─────────────────────────────────────────── */}
        <div style={{ marginTop: 20, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Shipping Addresses</div>
            {shipAddrEditId === null && (
              <button onClick={() => { setShipAddrForm({ label: '', street: '', street2: '', city: '', state: '', zip: '' }); setShipAddrEditId('new'); }}
                style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)44', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>
                + Add Address
              </button>
            )}
          </div>

          {/* New address form */}
          {shipAddrEditId === 'new' && (
            <form onSubmit={saveShipAddr} style={{ marginBottom: 14, padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--accent)', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>New Shipping Address</div>
              <ShipAddrFields form={shipAddrForm} setForm={setShipAddrForm} />
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="submit" disabled={shipAddrSaving} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: shipAddrSaving ? 0.6 : 1 }}>
                  {shipAddrSaving ? 'Saving…' : 'Save Address'}
                </button>
                <button type="button" onClick={() => setShipAddrEditId(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {shipAddrs.length === 0 && shipAddrEditId !== 'new' ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No saved shipping addresses.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {shipAddrs.map(addr => (
                <div key={addr.id} style={{ border: `1px solid ${addr.is_default ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, padding: '12px 14px', background: addr.is_default ? 'var(--accent-light, #ede9fe)' : 'var(--bg-base)' }}>
                  {shipAddrEditId === addr.id ? (
                    <form onSubmit={saveShipAddr}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Edit Address</div>
                      <ShipAddrFields form={shipAddrForm} setForm={setShipAddrForm} />
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button type="submit" disabled={shipAddrSaving} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: shipAddrSaving ? 0.6 : 1 }}>
                          {shipAddrSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" onClick={() => setShipAddrEditId(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : shipAddrDelId === addr.id ? (
                    <div>
                      <div style={{ fontSize: 13, marginBottom: 10 }}>Delete <strong>{addr.label}</strong>? This cannot be undone.</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => deleteShipAddr(addr.id)} style={{ background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 7, padding: '6px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Yes, delete</button>
                        <button onClick={() => setShipAddrDelId(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 14px', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{addr.label}</span>
                          {addr.is_default && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-light, #ede9fe)', padding: '1px 7px', borderRadius: 9999 }}>Default</span>}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                          <div>{addr.street}{addr.street2 ? `, ${addr.street2}` : ''}</div>
                          <div>{addr.city}, {addr.state} {addr.zip}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end', flexShrink: 0 }}>
                        <button onClick={() => { setShipAddrForm({ label: addr.label, street: addr.street, street2: addr.street2 || '', city: addr.city, state: addr.state, zip: addr.zip }); setShipAddrEditId(addr.id); }}
                          style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                          Edit
                        </button>
                        {!addr.is_default && (
                          <button onClick={() => setDefaultShipAddr(addr.id)}
                            style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Set Default
                          </button>
                        )}
                        <button onClick={() => setShipAddrDelId(addr.id)}
                          style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: '1px solid var(--danger)44', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        </>
      )}

      {/* Prescriptions */}
      {tab === 'prescriptions' && (
        <div>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600 }}>
              Upload Prescription
            </button>
          </div>
          {prescriptions.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No prescriptions on file.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12 }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left' }}>Doctor</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left' }}>Issued</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left' }}>Expires</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left' }}>Status</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {prescriptions.map(rx => {
                  const isExpired = rx.expiry_date && rx.expiry_date < today;
                  const expiringSoonRx = rx.expiry_date && rx.expiry_date >= today && new Date(rx.expiry_date) <= new Date(Date.now() + 30 * 86400000);
                  return (
                    <tr key={rx.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px' }}>{rx.prescribing_doctor}</td>
                      <td style={{ padding: '10px 16px', color: 'var(--text-muted)' }}>{fmtDate(rx.issue_date)}</td>
                      <td style={{ padding: '10px 16px' }}>
                        {rx.expiry_date ? (
                          <span style={{ color: isExpired ? 'var(--danger)' : expiringSoonRx ? '#f59e0b' : 'var(--text-muted)' }}>
                            {fmtDate(rx.expiry_date)}
                          </span>
                        ) : <span style={{ color: 'var(--success)' }}>No expiry</span>}
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <span className={`badge ${isExpired ? 'badge-cancelled' : expiringSoonRx ? 'badge-pending' : rx.status === 'active' ? 'badge-paid' : 'badge-draft'}`}>
                          {isExpired ? 'Expired' : expiringSoonRx ? 'Expiring' : rx.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 16px' }}>
                        <a href={`/api/patients/${id}/prescriptions/${rx.id}/file`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>View</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Contacts */}
      {tab === 'contacts' && (
        <div>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setContactModal(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600 }}>Add Contact</button>
          </div>
          {contacts.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No contacts on file.</p>
          ) : contacts.map(c => (
            <div key={c.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{c.first_name} {c.last_name}</span>
                  {c.is_primary && <span style={{ color: '#f59e0b' }}>★</span>}
                  <span style={{ background: (REL_COLORS[c.relationship] || '#6b7280') + '33', color: REL_COLORS[c.relationship] || '#6b7280', fontSize: 11, padding: '1px 7px', borderRadius: 9999, fontWeight: 600 }}>
                    {c.relationship.replace('_', ' ')}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  {c.phone && <span style={{ marginRight: 12 }}>📞 {c.phone}</span>}
                  {c.email && <span>✉ {c.email}</span>}
                </div>
              </div>
              {c.receives_notifications && <span style={{ fontSize: 12, color: 'var(--success)', border: '1px solid var(--success)44', borderRadius: 6, padding: '2px 8px' }}>Gets Notifications</span>}
            </div>
          ))}
        </div>
      )}

      {/* Orders */}
      {tab === 'orders' && (
        <div>
          {patient.orders?.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No orders yet.</p>
          ) : patient.orders?.map(order => (
            <div key={order.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
              <Link to={`/orders/${order.id}`} style={{ fontFamily: 'var(--brand-mono)', fontSize: 13, color: 'var(--accent)', minWidth: 120 }}>{order.order_number}</Link>
              <span className={`badge badge-${order.status.replace(/_/g, '-')}`}>{order.status.replace(/_/g, ' ')}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{fmtDate(order.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reminders */}
      {tab === 'reminders' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button onClick={() => { setReminderForm({ product_id: '', dosage_mg: '', dosage_freq: 'daily', doses_per_freq: '1', last_fill_qty_mg: '', last_fill_date: new Date().toISOString().split('T')[0] }); setShowReminderModal(true); }}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              + Add Reminder
            </button>
          </div>
          {reminders.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No refill reminders set up yet.</p>
          ) : reminders.map(r => {
            const ds = r.days_supply;
            return (
              <div key={r.id} style={{ background: 'var(--bg-surface)', border: `1px solid ${r.overdue ? 'var(--danger)' : r.due_soon ? 'var(--warning)' : 'var(--border)'}44`, borderRadius: 8, padding: '14px 18px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.product_name}</div>
                    {r.dosage_mg && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {r.dosage_mg} mg × {r.doses_per_freq || 1}/{r.dosage_freq === 'weekly' ? 'week' : 'day'}
                        {ds && <span> &mdash; {ds} day supply</span>}
                      </div>
                    )}
                    {r.last_fill_date && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                        Last filled: {fmtDate(r.last_fill_date)} &nbsp;|&nbsp; {r.last_fill_qty_mg} mg
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 13 }}>
                    {r.next_due && (
                      <div style={{ color: r.overdue ? 'var(--danger)' : r.due_soon ? 'var(--warning)' : 'var(--text-secondary)', fontWeight: 600, marginBottom: 4 }}>
                        {r.overdue ? '⚠ Overdue' : r.due_soon ? '⏰ Due Soon'  : 'Refill by'}: {fmtDate(r.next_due)}
                      </div>
                    )}
                    <div style={{ color: 'var(--text-muted)' }}>
                      Last reminded: {r.last_reminded_at ? fmtDate(r.last_reminded_at) : 'Never'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Address Modal */}
      <Modal open={!!addrModal} onClose={() => setAddrModal(null)} title={addrModal === 'billing' ? 'Billing Address' : 'Shipping Address'}>
        <form onSubmit={saveAddr}>
          {addrModal === 'shipping' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 16, padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
              <input type="checkbox" checked={sameAsBilling} onChange={e => setSameAsBilling(e.target.checked)} />
              Use same address as billing
            </label>
          )}
          {(!sameAsBilling || addrModal === 'billing') && (
            <>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Street Address</label>
                <AddressAutocomplete
                  value={addrForm.street}
                  onChange={v => setAddrForm(f => ({ ...f, street: v }))}
                  onSelect={a => setAddrForm(f => ({ ...f, street: a.street, city: a.city, state: a.state, zip: a.zip, country: a.country || f.country }))}
                  placeholder="Street address"
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Street Line 2 <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(apt, suite, unit)</span></label>
                <input value={addrForm.street2 || ''} onChange={e => setAddrForm(f => ({ ...f, street2: e.target.value }))} placeholder="Optional" style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>City</label>
                  <input value={addrForm.city} onChange={e => setAddrForm(f => ({ ...f, city: e.target.value }))} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>State</label>
                  <input value={addrForm.state} onChange={e => setAddrForm(f => ({ ...f, state: e.target.value }))} placeholder="TX" style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>ZIP</label>
                  <input value={addrForm.zip} onChange={e => setAddrForm(f => ({ ...f, zip: e.target.value }))} style={{ width: '100%' }} />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Country</label>
                <input value={addrForm.country} onChange={e => setAddrForm(f => ({ ...f, country: e.target.value }))} placeholder="US" style={{ width: '100%' }} />
              </div>
            </>
          )}
          {sameAsBilling && addrModal === 'shipping' && patient.billing_address && (
            <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 13, marginBottom: 16, lineHeight: 1.7 }}>
              {patient.billing_address.street && <div>{patient.billing_address.street}</div>}
              {patient.billing_address.street2 && <div>{patient.billing_address.street2}</div>}
              <div>{[patient.billing_address.city, patient.billing_address.state, patient.billing_address.zip].filter(Boolean).join(', ')}</div>
              {patient.billing_address.country && <div>{patient.billing_address.country}</div>}
            </div>
          )}
          {sameAsBilling && addrModal === 'shipping' && !patient.billing_address && (
            <div style={{ padding: '10px 14px', background: '#ef444411', borderRadius: 8, fontSize: 13, color: 'var(--danger)', marginBottom: 16 }}>
              No billing address on file — please add one first.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setAddrModal(null)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" disabled={savingAddr || (sameAsBilling && !patient.billing_address)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600 }}>
              {savingAddr ? 'Saving…' : 'Save Address'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Contact Modal */}
      <Modal open={contactModal} onClose={() => setContactModal(false)} title="Add Contact">
        <form onSubmit={saveContact}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>First Name *</label>
              <input required value={contactForm.first_name} onChange={e => setContactForm({ ...contactForm, first_name: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Last Name *</label>
              <input required value={contactForm.last_name} onChange={e => setContactForm({ ...contactForm, last_name: e.target.value })} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Relationship</label>
            <select value={contactForm.relationship} onChange={e => setContactForm({ ...contactForm, relationship: e.target.value })} style={{ width: '100%' }}>
              {['parent', 'guardian', 'emergency', 'caregiver', 'authorized_rep', 'spouse', 'other'].map(r => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Phone</label>
              <input type="tel" value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Email</label>
              <input type="email" value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} style={{ width: '100%' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={contactForm.is_primary} onChange={e => setContactForm({ ...contactForm, is_primary: e.target.checked })} />
              Primary contact
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={contactForm.receives_notifications} onChange={e => setContactForm({ ...contactForm, receives_notifications: e.target.checked })} />
              Receives notifications
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setContactModal(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600 }}>Save Contact</button>
          </div>
        </form>
      </Modal>

      {/* Reminder Modal */}
      <Modal open={showReminderModal} onClose={() => setShowReminderModal(false)} title="Add Refill Reminder">
        <form onSubmit={saveReminder}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Product *</label>
            <select value={reminderForm.product_id} onChange={e => setReminderForm(f => ({ ...f, product_id: e.target.value }))} required style={{ width: '100%' }}>
              <option value="">Select product…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Dosage</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>mg per dose *</label>
              <input type="number" min="0.01" step="0.01" required placeholder="e.g. 10"
                value={reminderForm.dosage_mg} onChange={e => setReminderForm(f => ({ ...f, dosage_mg: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Times per</label>
              <input type="number" min="0.5" step="0.5" placeholder="1"
                value={reminderForm.doses_per_freq} onChange={e => setReminderForm(f => ({ ...f, doses_per_freq: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Frequency</label>
              <select value={reminderForm.dosage_freq} onChange={e => setReminderForm(f => ({ ...f, dosage_freq: e.target.value }))} style={{ width: '100%' }}>
                <option value="daily">Day</option>
                <option value="weekly">Week</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last Fill</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Total mg purchased *</label>
              <input type="number" min="1" step="0.01" required placeholder="e.g. 300"
                value={reminderForm.last_fill_qty_mg} onChange={e => setReminderForm(f => ({ ...f, last_fill_qty_mg: e.target.value }))} style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Fill date *</label>
              <input type="date" required value={reminderForm.last_fill_date}
                onChange={e => setReminderForm(f => ({ ...f, last_fill_date: e.target.value }))} style={{ width: '100%' }} />
            </div>
          </div>
          {reminderForm.dosage_mg && reminderForm.last_fill_qty_mg && (() => {
            const mg = parseFloat(reminderForm.dosage_mg);
            const times = parseFloat(reminderForm.doses_per_freq || 1);
            const qty = parseFloat(reminderForm.last_fill_qty_mg);
            const dailyMg = mg * times * (reminderForm.dosage_freq === 'weekly' ? 1/7 : 1);
            const ds = dailyMg > 0 ? Math.floor(qty / dailyMg) : null;
            if (!ds) return null;
            const runOut = new Date(reminderForm.last_fill_date); runOut.setDate(runOut.getDate() + ds);
            const remind = new Date(reminderForm.last_fill_date); remind.setDate(remind.getDate() + ds - 7);
            return (
              <div style={{ background: 'var(--accent)11', border: '1px solid var(--accent)33', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
                <div><strong>{ds} day supply</strong> — runs out {runOut.toLocaleDateString()}</div>
                <div style={{ color: 'var(--warning)', marginTop: 2 }}>Reminder will send: <strong>{remind.toLocaleDateString()}</strong> (7 days before)</div>
              </div>
            );
          })()}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowReminderModal(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" disabled={savingReminder} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600, opacity: savingReminder ? 0.7 : 1 }}>
              {savingReminder ? 'Saving…' : 'Create Reminder'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
