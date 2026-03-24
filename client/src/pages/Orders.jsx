import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';
import { fmtDate, statusBadge } from '../lib/utils';
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
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ product_id: '', quantity: 1 }]);
  const [loading, setLoading] = useState(false);

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

  return (
    <Modal open={open} onClose={onClose} title="New Sales Order">
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Patient *</label>
          <select value={patientId} onChange={e => setPatientId(e.target.value)} required style={{ width: '100%' }}>
            <option value="">Select patient…</option>
            {patients.map(p => <option key={p.id} value={p.id}>{p.name} — {p.email}</option>)}
          </select>
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
          <button type="button" onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
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
  const loading = useOrderStore(s => s.ordersLoading);
  const [activeTab, setActiveTab] = useState('');
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    fetchPatients();
    fetchProducts();
    fetchOrders(activeTab ? { status: activeTab } : {});
  }, [activeTab]);

  const filtered = activeTab ? orders.filter(o => o.status === activeTab) : orders;

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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No orders found</td></tr>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewOrderModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => fetchOrders()} />
    </div>
  );
}
