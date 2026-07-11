import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';
import { fmtDate } from '../lib/utils';
import Modal from '../components/Modal';

const TABS = [
  { label: 'All', status: '' },
  { label: 'Drafts', status: 'draft' },
  { label: 'Awaiting Payment', status: 'pending_payment' },
  { label: 'Paid', status: 'paid' },
  { label: 'Shipped', status: 'shipped' },
];

function NewOrderModal({ open, onClose, onCreated }) {
  const patients = useOrderStore(s => s.patients);
  const products = useOrderStore(s => s.products);
  const addToast = useOrderStore(s => s.addToast);
  const [patientId, setPatientId] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [patientLabel, setPatientLabel] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ product_id: '', quantity: 1 }]);
  const [loading, setLoading] = useState(false);

  const suggestions = patientSearch.length >= 3
    ? patients.filter(p => p.name.toLowerCase().includes(patientSearch.toLowerCase()))
    : [];

  function addItem() { setItems([...items, { product_id: '', quantity: 1 }]); }
  function removeItem(i) { setItems(items.filter((_, idx) => idx !== i)); }
  function updateItem(i, field, val) {
    setItems(items.map((it, idx) => idx === i ? { ...it, [field]: val } : it));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/orders', {
        patient_id: patientId,
        items: items.map(it => ({ product_id: it.product_id, quantity: parseInt(it.quantity) })),
        notes,
      });
      addToast(`Order ${res.data.order_number} created`, 'success');
      onCreated(res.data);
      onClose();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to create order', 'error');
      setLoading(false);
    }
  }

  function handleClose() {
    setPatientId(''); setPatientSearch(''); setPatientLabel('');
    setNotes(''); setItems([{ product_id: '', quantity: 1 }]);
    setLoading(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Sales Order">
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16, position: 'relative' }}>
          <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Patient *</label>
          {/* Hidden required field so form validation catches an unselected patient */}
          <input type="hidden" value={patientId} required />
          <input
            type="text"
            placeholder="Type 3+ letters to search by name…"
            value={patientSearch}
            autoComplete="off"
            style={{ width: '100%', borderColor: patientId ? 'var(--success)' : undefined }}
            onChange={e => {
              setPatientSearch(e.target.value);
              setPatientId('');
              setPatientLabel('');
              setShowSuggestions(true);
            }}
            onFocus={() => { if (patientSearch.length >= 3) setShowSuggestions(true); }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          />
          {patientId && (
            <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>
              ✓ {patientLabel}
            </div>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: 'absolute', zIndex: 100, left: 0, right: 0,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              maxHeight: 220, overflowY: 'auto', marginTop: 2,
            }}>
              {suggestions.map(p => (
                <div
                  key={p.id}
                  onMouseDown={() => {
                    setPatientId(p.id);
                    setPatientSearch(p.name);
                    setPatientLabel(`${p.name} — ${p.email}`);
                    setShowSuggestions(false);
                  }}
                  style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{p.email}</span>
                </div>
              ))}
            </div>
          )}
          {patientSearch.length > 0 && patientSearch.length < 3 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Type {3 - patientSearch.length} more letter{3 - patientSearch.length !== 1 ? 's' : ''}…</div>
          )}
          {patientSearch.length >= 3 && suggestions.length === 0 && !patientId && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>No patients found matching "{patientSearch}"</div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Line Items *</label>
            <button type="button" onClick={addItem} style={{ fontSize: 12, background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 4, padding: '2px 8px' }}>+ Add</button>
          </div>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select value={item.product_id} onChange={e => updateItem(i, 'product_id', e.target.value)} required style={{ flex: 1 }}>
                <option value="">Product…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} — ${p.unit_price}</option>)}
              </select>
              <input type="number" min="1" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} style={{ width: 70 }} />
              {items.length > 1 && <button type="button" onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 18 }}>×</button>}
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={handleClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
          <button type="submit" disabled={loading} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600 }}>
            {loading ? 'Creating…' : 'Create Order'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Orders() {
  const fetchOrders = useOrderStore(s => s.fetchOrders);
  const fetchPatients = useOrderStore(s => s.fetchPatients);
  const fetchProducts = useOrderStore(s => s.fetchProducts);
  const orders = useOrderStore(s => s.orders);
  const addToast = useOrderStore(s => s.addToast);
  const loading = useOrderStore(s => s.ordersLoading);
  const [activeTab, setActiveTab] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchPatients();
    fetchProducts();
    fetchOrders(activeTab ? { status: activeTab } : {});
  }, [activeTab]);

  const filtered = activeTab ? orders.filter(o => o.status === activeTab) : orders;

  async function handleDelete(id) {
    setDeleting(true);
    try {
      await api.delete(`/orders/${id}`);
      addToast('Order deleted', 'success');
      setDeleteId(null);
      fetchOrders(activeTab ? { status: activeTab } : {});
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to delete order', 'error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28 }}>Sales Orders</h1>
        <button onClick={() => setShowNew(true)} style={{
          background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
          padding: '10px 20px', fontWeight: 600, fontSize: 14,
        }}>+ New Order</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(tab => (
          <button key={tab.status} onClick={() => setActiveTab(tab.status)} style={{
            background: 'none', border: 'none', padding: '8px 16px', fontSize: 14, cursor: 'pointer',
            color: activeTab === tab.status ? 'var(--accent)' : 'var(--text-secondary)',
            borderBottom: activeTab === tab.status ? '2px solid var(--accent)' : '2px solid transparent',
            fontWeight: activeTab === tab.status ? 600 : 400,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12 }}>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Order #</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Patient</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Date</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No orders found</td></tr>
            ) : filtered.map(order => (
              <tr key={order.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <Link to={`/orders/${order.id}`} style={{ fontFamily: 'var(--brand-mono)', fontSize: 13, color: 'var(--accent)' }}>
                    {order.order_number}
                  </Link>
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{order.patient_name}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span className={`badge badge-${order.status.replace(/_/g, '-')}`}>{order.status.replace(/_/g, ' ')}</span>
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>{fmtDate(order.created_at)}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {(order.status === 'draft' || order.status === 'cancelled') && (
                    deleteId === order.id ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Delete?</span>
                        <button
                          onClick={() => handleDelete(order.id)}
                          disabled={deleting}
                          style={{ fontSize: 12, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 10px', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDeleteId(null)}
                          disabled={deleting}
                          style={{ fontSize: 12, background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', color: 'var(--text-secondary)' }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setDeleteId(order.id)}
                        title="Delete order"
                        style={{ fontSize: 13, background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewOrderModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => fetchOrders(activeTab ? { status: activeTab } : {})} />
    </div>
  );
}
