import React, { useEffect, useState } from 'react';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';
import { fmtDate } from '../lib/utils';
import Modal from '../components/Modal';

export default function Reminders() {
  const reminders = useOrderStore(s => s.reminders);
  const fetchReminders = useOrderStore(s => s.fetchReminders);
  const fetchPatients = useOrderStore(s => s.fetchPatients);
  const fetchProducts = useOrderStore(s => s.fetchProducts);
  const patients = useOrderStore(s => s.patients);
  const products = useOrderStore(s => s.products);
  const addToast = useOrderStore(s => s.addToast);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ patient_id: '', product_id: '', interval_days: 30 });

  useEffect(() => {
    fetchReminders();
    fetchPatients();
    fetchProducts();
  }, []);

  async function createReminder(e) {
    e.preventDefault();
    try {
      await api.post('/reminders', { ...form, interval_days: parseInt(form.interval_days) });
      addToast('Reminder rule created', 'success');
      fetchReminders();
      setShowNew(false);
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed', 'error');
    }
  }

  async function sendNow(id) {
    try {
      await api.post(`/reminders/${id}/send`);
      addToast('Reminder email sent', 'success');
      fetchReminders();
    } catch (err) {
      addToast('Failed to send reminder', 'error');
    }
  }

  const overdue = reminders.filter(r => r.overdue);
  const dueSoon = reminders.filter(r => !r.overdue && r.due_soon);
  const normal = reminders.filter(r => !r.overdue && !r.due_soon);

  function ReminderRow({ rule }) {
    return (
      <tr style={{ borderTop: '1px solid var(--border)', background: rule.overdue ? '#ef444408' : rule.due_soon ? '#f59e0b08' : 'transparent' }}>
        <td style={{ padding: '12px 16px' }}>{rule.patient_name}</td>
        <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{rule.product_name}</td>
        <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>Every {rule.interval_days} days</td>
        <td style={{ padding: '12px 16px' }}>
          {rule.next_due ? (
            <span style={{ color: rule.overdue ? 'var(--danger)' : rule.due_soon ? 'var(--warning)' : 'var(--text-secondary)', fontSize: 13 }}>
              {rule.overdue && '⚠ '}{fmtDate(rule.next_due)}
            </span>
          ) : '—'}
        </td>
        <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
          {rule.last_reminded_at ? fmtDate(rule.last_reminded_at) : 'Never'}
        </td>
        <td style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href={`/reorder/${rule.id}`} target="_blank" rel="noreferrer" style={{
              fontSize: 12, background: 'var(--accent)', color: '#fff',
              borderRadius: 6, padding: '4px 10px',
            }}>+ Order</a>
            <button onClick={() => sendNow(rule.id)} style={{
              fontSize: 12, background: 'none', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 10px',
            }}>Email Now</button>
          </div>
        </td>
      </tr>
    );
  }

  const tableHead = (
    <thead>
      <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 12 }}>
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Patient</th>
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Product</th>
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Interval</th>
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Next Due</th>
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Last Sent</th>
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Actions</th>
      </tr>
    </thead>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28 }}>Refill Reminders</h1>
        <button onClick={() => setShowNew(true)} style={{
          background: 'var(--accent)', color: '#fff', border: 'none',
          borderRadius: 8, padding: '10px 20px', fontWeight: 600, fontSize: 14,
        }}>+ New Rule</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Overdue', value: overdue.length, color: 'var(--danger)' },
          { label: 'Due Soon', value: dueSoon.length, color: 'var(--warning)' },
          { label: 'On Track', value: normal.length, color: 'var(--success)' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '16px 24px', flex: 1,
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: 'var(--brand-mono)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {[
        { label: '⚠ Overdue', rows: overdue, border: 'var(--danger)' },
        { label: '⏰ Due Soon (3 days)', rows: dueSoon, border: 'var(--warning)' },
        { label: 'Active Rules', rows: normal, border: 'var(--border)' },
      ].map(section => section.rows.length > 0 && (
        <div key={section.label} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {section.label}
          </h2>
          <div style={{ background: 'var(--bg-surface)', border: `1px solid ${section.border}44`, borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              {tableHead}
              <tbody>
                {section.rows.map(r => <ReminderRow key={r.id} rule={r} />)}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New Reminder Rule">
        <form onSubmit={createReminder}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Patient</label>
            <select value={form.patient_id} onChange={e => setForm({ ...form, patient_id: e.target.value })} required style={{ width: '100%' }}>
              <option value="">Select patient…</option>
              {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Product</label>
            <select value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} required style={{ width: '100%' }}>
              <option value="">Select product…</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Refill Interval (days)</label>
            <input type="number" min="1" value={form.interval_days}
              onChange={e => setForm({ ...form, interval_days: e.target.value })} required style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowNew(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600 }}>Create Rule</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
