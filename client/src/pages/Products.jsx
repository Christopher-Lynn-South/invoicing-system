import React, { useEffect, useState } from 'react';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';
import { fmtCurrency } from '../lib/utils';
import Modal from '../components/Modal';

const EMPTY = { sku: '', name: '', unit_price: '', unit: 'pc', active: true };

export default function Products() {
  const products = useOrderStore(s => s.products);
  const fetchProducts = useOrderStore(s => s.fetchProducts);
  const addToast = useOrderStore(s => s.addToast);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null); // product object being edited
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchProducts(); }, []);

  function openNew() { setForm(EMPTY); setShowNew(true); }

  function openEdit(p) {
    setEditing(p);
    setForm({ sku: p.sku, name: p.name, unit_price: String(p.unit_price), unit: p.unit, active: p.active });
  }

  function closeModal() { setShowNew(false); setEditing(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    const body = { ...form, unit_price: parseFloat(form.unit_price) };
    try {
      if (editing) {
        await api.put(`/products/${editing.id}`, body);
        addToast('Product updated', 'success');
      } else {
        await api.post('/products', body);
        addToast('Product created', 'success');
      }
      fetchProducts();
      closeModal();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed', 'error');
    }
    setSaving(false);
  }

  const FIELDS = [
    { label: 'SKU *', key: 'sku', type: 'text', required: true },
    { label: 'Name *', key: 'name', type: 'text', required: true },
    { label: 'Unit Price (USD) *', key: 'unit_price', type: 'number', step: '0.01', min: '0', required: true },
    { label: 'Unit', key: 'unit', type: 'text', placeholder: 'pc, bar, kit…' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28 }}>Products</h1>
        <button onClick={openNew} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontWeight: 600, fontSize: 14 }}>+ New Product</button>
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12 }}>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>SKU</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Unit Price</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Unit</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '12px 16px' }} />
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No products yet</td></tr>
            ) : products.map(p => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px', fontFamily: 'var(--brand-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{p.sku}</td>
                <td style={{ padding: '12px 16px', fontWeight: 600 }}>{p.name}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(p.unit_price)}</td>
                <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>{p.unit}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span className={`badge ${p.active ? 'badge-paid' : 'badge-cancelled'}`}>{p.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                  <button onClick={() => openEdit(p)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showNew || !!editing} onClose={closeModal} title={editing ? `Edit — ${editing.name}` : 'New Product'}>
        <form onSubmit={handleSubmit}>
          {FIELDS.map(f => (
            <div key={f.key} style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{f.label}</label>
              <input type={f.type} step={f.step} min={f.min} required={f.required} placeholder={f.placeholder}
                value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} style={{ width: '100%' }} />
            </div>
          ))}
          {editing && (
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="active-toggle" checked={form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })} />
              <label htmlFor="active-toggle" style={{ fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>Active (visible when adding to orders)</label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={closeModal} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
