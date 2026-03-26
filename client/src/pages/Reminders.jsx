import React, { useEffect, useState } from 'react';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';
import { fmtDate } from '../lib/utils';
import Modal from '../components/Modal';

const EMPTY_FORM = {
  patient_id: '', product_id: '',
  dosage_mg: '', dosage_freq: 'daily', doses_per_freq: '1',
  last_fill_qty_mg: '', last_fill_date: new Date().toISOString().split('T')[0],
};

function calcPreviewDays(form) {
  const mg = parseFloat(form.dosage_mg);
  const times = parseFloat(form.doses_per_freq || 1);
  const qty = parseFloat(form.last_fill_qty_mg);
  if (!mg || !qty) return null;
  const dailyMg = mg * times * (form.dosage_freq === 'weekly' ? 1 / 7 : 1);
  return dailyMg > 0 ? Math.floor(qty / dailyMg) : null;
}

export default function Reminders() {
  const reminders = useOrderStore(s => s.reminders);
  const fetchReminders = useOrderStore(s => s.fetchReminders);
  const fetchPatients = useOrderStore(s => s.fetchPatients);
  const fetchProducts = useOrderStore(s => s.fetchProducts);
  const patients = useOrderStore(s => s.patients);
  const products = useOrderStore(s => s.products);
  const addToast = useOrderStore(s => s.addToast);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchReminders();
    fetchPatients();
    fetchProducts();
  }, []);

  const previewDays = calcPreviewDays(form);
  const previewRunOut = form.last_fill_date && previewDays
    ? (() => { const d = new Date(form.last_fill_date); d.setDate(d.getDate() + previewDays); return d.toISOString().split('T')[0]; })()
    : null;
  const previewReminder = form.last_fill_date && previewDays
    ? (() => { const d = new Date(form.last_fill_date); d.setDate(d.getDate() + previewDays - 7); return d.toISOString().split('T')[0]; })()
    : null;

  function f(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  async function createReminder(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/reminders', {
        patient_id: form.patient_id,
        product_id: form.product_id,
        dosage_mg: parseFloat(form.dosage_mg),
        dosage_freq: form.dosage_freq,
        doses_per_freq: parseFloat(form.doses_per_freq || 1),
        last_fill_qty_mg: parseFloat(form.last_fill_qty_mg),
        last_fill_date: form.last_fill_date,
      });
      addToast('Reminder created', 'success');
      fetchReminders();
      setShowNew(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed', 'error');
    }
    setSaving(false);
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

  const overdue  = reminders.filter(r => r.overdue);
  const dueSoon  = reminders.filter(r => !r.overdue && r.due_soon);
  const normal   = reminders.filter(r => !r.overdue && !r.due_soon);

  function ReminderRow({ rule }) {
    const ds = rule.days_supply;
    return (
      <tr style={{ borderTop: '1px solid var(--border)', background: rule.overdue ? '#ef444408' : rule.due_soon ? '#f59e0b08' : 'transparent' }}>
        <td style={{ padding: '12px 16px' }}>{rule.patient_name}</td>
        <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{rule.product_name}</td>
        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
          {rule.dosage_mg ? (
            <span>{rule.dosage_mg} mg × {rule.doses_per_freq || 1}/{rule.dosage_freq === 'weekly' ? 'wk' : 'day'}</span>
          ) : (
            <span>Every {rule.interval_days} days</span>
          )}
        </td>
        <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
          {ds ? `${ds} days` : '—'}
        </td>
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
              borderRadius: 6, padding: '4px 10px', textDecoration: 'none',
            }}>+ Order</a>
            <button onClick={() => sendNow(rule.id)} style={{
              fontSize: 12, background: 'none', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
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
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Dosage</th>
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Days Supply</th>
        <th style={{ padding: '10px 16px', textAlign: 'left' }}>Refill Due</th>
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
        }}>+ New Reminder</button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Overdue', value: overdue.length, color: 'var(--danger)' },
          { label: 'Due Soon', value: dueSoon.length, color: 'var(--warning)' },
          { label: 'On Track', value: normal.length, color: 'var(--success)' },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 24px', flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: 'var(--brand-mono)' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {[
        { label: '⚠ Overdue', rows: overdue, border: 'var(--danger)' },
        { label: '⏰ Due Soon (3 days)', rows: dueSoon, border: 'var(--warning)' },
        { label: 'Active Reminders', rows: normal, border: 'var(--border)' },
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

      <Modal open={showNew} onClose={() => { setShowNew(false); setForm(EMPTY_FORM); }} title="New Refill Reminder">
        <form onSubmit={createReminder}>
          {/* Patient + Product */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Patient *</label>
              <select value={form.patient_id} onChange={e => f('patient_id', e.target.value)} required style={{ width: '100%' }}>
                <option value="">Select…</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Product *</label>
              <select value={form.product_id} onChange={e => f('product_id', e.target.value)} required style={{ width: '100%' }}>
                <option value="">Select…</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {/* Dosage */}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Dosage</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>mg per dose *</label>
              <input type="number" min="0.01" step="0.01" value={form.dosage_mg} onChange={e => f('dosage_mg', e.target.value)} required placeholder="e.g. 10" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Times per</label>
              <input type="number" min="0.5" step="0.5" value={form.doses_per_freq} onChange={e => f('doses_per_freq', e.target.value)} placeholder="1" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Frequency</label>
              <select value={form.dosage_freq} onChange={e => f('dosage_freq', e.target.value)} style={{ width: '100%' }}>
                <option value="daily">Day</option>
                <option value="weekly">Week</option>
              </select>
            </div>
          </div>

          {/* Last fill */}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last Fill</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Total mg purchased *</label>
              <input type="number" min="1" step="0.01" value={form.last_fill_qty_mg} onChange={e => f('last_fill_qty_mg', e.target.value)} required placeholder="e.g. 300" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Fill date *</label>
              <input type="date" value={form.last_fill_date} onChange={e => f('last_fill_date', e.target.value)} required style={{ width: '100%' }} />
            </div>
          </div>

          {/* Live preview */}
          {previewDays && (
            <div style={{ background: 'var(--accent)11', border: '1px solid var(--accent)33', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Calculated schedule</div>
              <div style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <div>Days supply: <strong>{previewDays} days</strong></div>
                <div>Runs out: <strong>{fmtDate(previewRunOut)}</strong></div>
                <div style={{ color: 'var(--warning)' }}>Reminder will send: <strong>{fmtDate(previewReminder)}</strong> (7 days before)</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={() => { setShowNew(false); setForm(EMPTY_FORM); }} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" disabled={saving} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Create Reminder'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
