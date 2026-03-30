import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';
import Modal from '../components/Modal';
import AddressAutocomplete from '../components/AddressAutocomplete';

export default function Patients() {
  const patients = useOrderStore(s => s.patients);
  const fetchPatients = useOrderStore(s => s.fetchPatients);
  const addToast = useOrderStore(s => s.addToast);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', date_of_birth: '', billing_address: { street: '', city: '', state: '', zip: '', country: 'US' } });

  // Selection + delete state
  const [selected, setSelected] = useState(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { fetchPatients(); }, []);

  async function createPatient(e) {
    e.preventDefault();
    try {
      await api.post('/patients', form);
      addToast('Patient created', 'success');
      fetchPatients();
      setShowNew(false);
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed', 'error');
    }
  }

  function setAddr(field, value) {
    setForm(f => ({ ...f, billing_address: { ...f.billing_address, [field]: value } }));
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? patients.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.phone?.toLowerCase().includes(q)
      )
    : patients;

  const allChecked = filtered.length > 0 && filtered.every(p => selected.has(p.id));
  const someChecked = filtered.some(p => selected.has(p.id));

  function toggleAll() {
    if (allChecked) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(p => n.delete(p.id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(p => n.add(p.id)); return n; });
    }
  }

  function toggleOne(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      const ids = [...selected];
      if (ids.length === 1) {
        await api.delete(`/patients/${ids[0]}`);
      } else {
        await api.post('/patients/bulk-delete', { ids });
      }
      addToast(`${ids.length} patient${ids.length !== 1 ? 's' : ''} deleted`, 'success');
      setSelected(new Set());
      setShowDeleteConfirm(false);
      fetchPatients();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to delete', 'error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28 }}>Patients</h1>
        <button onClick={() => setShowNew(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 600, fontSize: 14 }}>+ New Patient</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Search by name, email, or phone…"
          value={search}
          onChange={e => { setSearch(e.target.value); setSelected(new Set()); }}
          style={{ flex: 1, maxWidth: 400, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
        />
        {selected.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {selected.size} selected
            </span>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{ background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
            >
              Delete {selected.size === 1 ? 'Patient' : `${selected.size} Patients`}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12 }}>
              <th style={{ padding: '12px 16px', width: 40 }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Email</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Phone</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Wallet</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Rx Required</th>
              <th style={{ padding: '12px 16px', width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                {q ? 'No patients match your search' : 'No patients yet'}
              </td></tr>
            ) : filtered.map(p => {
              const isChecked = selected.has(p.id);
              return (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)', background: isChecked ? 'var(--accent-light, #ede9fe)' : undefined }}>
                  <td style={{ padding: '12px 16px' }}>
                    <input type="checkbox" checked={isChecked} onChange={() => toggleOne(p.id)} style={{ cursor: 'pointer' }} />
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <Link to={`/patients/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</Link>
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{p.email || '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>{p.phone || '—'}</td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--brand-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                    {p.usdc_wallet ? `${p.usdc_wallet.slice(0, 8)}…` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {p.requires_prescription
                      ? <span className="badge badge-pending">Yes</span>
                      : <span className="badge badge-draft">No</span>}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      onClick={() => { setSelected(new Set([p.id])); setShowDeleteConfirm(true); }}
                      style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: '1px solid var(--danger)44', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => { if (!deleting) { setShowDeleteConfirm(false); setSelected(new Set()); } }}
        title="Delete Patients"
      >
        <div style={{ marginBottom: 20, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Are you sure you want to delete <strong>{selected.size} patient{selected.size !== 1 ? 's' : ''}</strong>?
          <br />
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Their orders, prescriptions, and history will remain in the system but the patient record will be hidden.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={() => { setShowDeleteConfirm(false); setSelected(new Set()); }}
            disabled={deleting}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={confirmDelete}
            disabled={deleting}
            style={{ background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}
          >
            {deleting ? 'Deleting…' : `Delete ${selected.size === 1 ? 'Patient' : `${selected.size} Patients`}`}
          </button>
        </div>
      </Modal>

      {/* New patient modal */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="New Patient">
        <form onSubmit={createPatient}>
          {[
            { label: 'Full Name *', key: 'name', type: 'text', required: true },
            { label: 'Email', key: 'email', type: 'email' },
            { label: 'Phone', key: 'phone', type: 'tel' },
            { label: 'Date of Birth', key: 'date_of_birth', type: 'date' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{f.label}</label>
              <input type={f.type} required={f.required} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} style={{ width: '100%' }} />
            </div>
          ))}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>Billing Address</label>
            <AddressAutocomplete
              value={form.billing_address.street}
              onChange={v => setAddr('street', v)}
              onSelect={a => setForm(f => ({ ...f, billing_address: { ...f.billing_address, street: a.street, city: a.city, state: a.state, zip: a.zip, country: a.country } }))}
              placeholder="Street address"
              style={{ marginBottom: 6 }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 6 }}>
              <input placeholder="City" value={form.billing_address.city} onChange={e => setAddr('city', e.target.value)} />
              <input placeholder="State" value={form.billing_address.state} onChange={e => setAddr('state', e.target.value)} />
              <input placeholder="ZIP" value={form.billing_address.zip} onChange={e => setAddr('zip', e.target.value)} />
            </div>
            <input placeholder="Country" value={form.billing_address.country} onChange={e => setAddr('country', e.target.value)} style={{ width: '100%', marginTop: 6 }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.requires_prescription} onChange={e => setForm({ ...form, requires_prescription: e.target.checked })} />
              Requires prescription before ordering
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowNew(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600 }}>Create Patient</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
