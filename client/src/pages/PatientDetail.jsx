import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import useOrderStore from '../store/useOrderStore';
import { fmtDate } from '../lib/utils';
import Modal from '../components/Modal';

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
  const [contactModal, setContactModal] = useState(false);
  const [contactForm, setContactForm] = useState({ relationship: 'guardian', first_name: '', last_name: '', phone: '', email: '', is_primary: false, receives_notifications: false });

  async function load() {
    const [pRes, rxRes, ctRes] = await Promise.all([
      api.get(`/patients/${id}`),
      api.get(`/patients/${id}/prescriptions`),
      api.get(`/patients/${id}/contacts`),
    ]);
    setPatient(pRes.data);
    setPrescriptions(rxRes.data);
    setContacts(ctRes.data);
  }

  useEffect(() => { load(); }, [id]);

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
        {['overview', 'prescriptions', 'contacts', 'orders'].map(t => (
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
          {patient.billing_address && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Billing Address</div>
              <div style={{ fontSize: 14 }}>
                {patient.billing_address.street && <div>{patient.billing_address.street}</div>}
                <div>{[patient.billing_address.city, patient.billing_address.state, patient.billing_address.zip].filter(Boolean).join(', ')}</div>
                {patient.billing_address.country && <div>{patient.billing_address.country}</div>}
              </div>
            </div>
          )}
        </div>
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
    </div>
  );
}
