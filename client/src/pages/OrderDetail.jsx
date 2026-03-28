import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import useOrderStore from '../store/useOrderStore';
import { fmtCurrency, fmtDate, fmtDatetime, relativeTime } from '../lib/utils';
import Modal from '../components/Modal';
import AddressAutocomplete from '../components/AddressAutocomplete';

// ─── FedEx compatibility tables ───────────────────────────────────────────────
// Ground = YOUR_PACKAGING only. Express accepts FedEx-supplied boxes too.
const SERVICE_VALID_PACKAGES = {
  FEDEX_GROUND:           ['YOUR_PACKAGING'],
  FEDEX_HOME_DELIVERY:    ['YOUR_PACKAGING'],
  FEDEX_EXPRESS_SAVER:    ['YOUR_PACKAGING','FEDEX_ENVELOPE','FEDEX_PAK','FEDEX_TUBE','FEDEX_SMALL_BOX','FEDEX_MEDIUM_BOX','FEDEX_LARGE_BOX','FEDEX_EXTRA_LARGE_BOX'],
  FEDEX_2_DAY:            ['YOUR_PACKAGING','FEDEX_ENVELOPE','FEDEX_PAK','FEDEX_SMALL_BOX','FEDEX_MEDIUM_BOX','FEDEX_LARGE_BOX','FEDEX_EXTRA_LARGE_BOX'],
  FEDEX_2_DAY_AM:         ['YOUR_PACKAGING','FEDEX_ENVELOPE','FEDEX_PAK','FEDEX_SMALL_BOX','FEDEX_MEDIUM_BOX','FEDEX_LARGE_BOX','FEDEX_EXTRA_LARGE_BOX'],
  STANDARD_OVERNIGHT:     ['YOUR_PACKAGING','FEDEX_ENVELOPE','FEDEX_PAK','FEDEX_SMALL_BOX','FEDEX_MEDIUM_BOX','FEDEX_LARGE_BOX','FEDEX_EXTRA_LARGE_BOX'],
  PRIORITY_OVERNIGHT:     ['YOUR_PACKAGING','FEDEX_ENVELOPE','FEDEX_PAK','FEDEX_TUBE','FEDEX_SMALL_BOX','FEDEX_MEDIUM_BOX','FEDEX_LARGE_BOX','FEDEX_EXTRA_LARGE_BOX'],
  FIRST_OVERNIGHT:        ['YOUR_PACKAGING','FEDEX_ENVELOPE','FEDEX_PAK','FEDEX_SMALL_BOX','FEDEX_MEDIUM_BOX','FEDEX_LARGE_BOX','FEDEX_EXTRA_LARGE_BOX'],
  INTERNATIONAL_ECONOMY:  ['YOUR_PACKAGING','FEDEX_ENVELOPE','FEDEX_PAK','FEDEX_10KG_BOX','FEDEX_25KG_BOX'],
  INTERNATIONAL_PRIORITY: ['YOUR_PACKAGING','FEDEX_ENVELOPE','FEDEX_PAK','FEDEX_10KG_BOX','FEDEX_25KG_BOX'],
};
const PACKAGE_LABELS = {
  YOUR_PACKAGING:       'Your Own Box',
  FEDEX_ENVELOPE:       'FedEx Envelope (≤0.5 lb)',
  FEDEX_PAK:            'FedEx Pak (≤10 lb)',
  FEDEX_TUBE:           'FedEx Tube (≤20 lb)',
  FEDEX_SMALL_BOX:      'FedEx Small Box (≤20 lb)',
  FEDEX_MEDIUM_BOX:     'FedEx Medium Box (≤20 lb)',
  FEDEX_LARGE_BOX:      'FedEx Large Box (≤20 lb)',
  FEDEX_EXTRA_LARGE_BOX:'FedEx Extra Large Box (≤20 lb)',
  FEDEX_10KG_BOX:       'FedEx 10kg Box (Intl ≤22 lb)',
  FEDEX_25KG_BOX:       'FedEx 25kg Box (Intl ≤55 lb)',
};
const SERVICE_LABELS = {
  FEDEX_GROUND:'FedEx Ground', FEDEX_HOME_DELIVERY:'FedEx Home Delivery',
  FEDEX_EXPRESS_SAVER:'Express Saver (3-day)', FEDEX_2_DAY:'FedEx 2Day',
  FEDEX_2_DAY_AM:'FedEx 2Day AM', STANDARD_OVERNIGHT:'Standard Overnight',
  PRIORITY_OVERNIGHT:'Priority Overnight', FIRST_OVERNIGHT:'First Overnight',
  INTERNATIONAL_ECONOMY:'International Economy', INTERNATIONAL_PRIORITY:'International Priority',
};
const BOX_WEIGHT_MAX = {
  FEDEX_ENVELOPE: 0.5,
  FEDEX_PAK: 10,
  FEDEX_TUBE: 20,
  FEDEX_SMALL_BOX: 20,
  FEDEX_MEDIUM_BOX: 20,
  FEDEX_LARGE_BOX: 20,
  FEDEX_EXTRA_LARGE_BOX: 20,
  FEDEX_10KG_BOX: 22,
  FEDEX_25KG_BOX: 55,
};

function PipelineStep({ label, active, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', border: '2px solid',
        borderColor: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)',
        background: done ? 'var(--success)' : active ? 'var(--accent-light)' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: done ? '#fff' : active ? 'var(--accent)' : 'var(--text-muted)',
        flexShrink: 0,
      }}>
        {done ? '✓' : '•'}
      </div>
      <span style={{ fontSize: 13, color: active || done ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const addToast = useOrderStore(s => s.addToast);
  const patients = useOrderStore(s => s.patients);
  const fetchPatients = useOrderStore(s => s.fetchPatients);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shipModal, setShipModal] = useState(false);
  const [shipForm, setShipForm] = useState({ service: 'FEDEX_GROUND', box_type: 'YOUR_PACKAGING', weight_lbs: '', length_in: '', width_in: '', height_in: '', recipient_name: '', recipient_street: '', recipient_city: '', recipient_state: '', recipient_zip: '', recipient_country: 'US' });
  const [shipping, setShipping] = useState(false);
  // Rate quote state
  const [rqForm, setRqForm] = useState({ package_type: 'YOUR_PACKAGING', weight_lbs: '', length_in: '', width_in: '', height_in: '' });
  const [rqRates, setRqRates] = useState([]);
  const [rqLoading, setRqLoading] = useState(false);
  const [rqSelected, setRqSelected] = useState(null);
  const [rqSaving, setRqSaving] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [resendingInvoice, setResendingInvoice] = useState(false);
  const [resendingShipping, setResendingShipping] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [addProductId, setAddProductId] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [savingItems, setSavingItems] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [emailTemplate, setEmailTemplate] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailChannel, setEmailChannel] = useState('email');
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showEditOrder, setShowEditOrder] = useState(false);
  const [editOrderForm, setEditOrderForm] = useState({ patient_id: '', notes: '' });
  const [savingEditOrder, setSavingEditOrder] = useState(false);

  async function load() {
    try {
      const res = await api.get(`/orders/${id}`);
      setOrder(res.data);
    } catch { addToast('Failed to load order', 'error'); }
    setLoading(false);
  }

  async function loadEmailTemplates() {
    try {
      const { data } = await api.get(`/orders/${id}/email-templates`);
      setEmailTemplates(data);
    } catch { /* non-fatal */ }
  }

  useEffect(() => { load(); loadEmailTemplates(); fetchPatients(); }, [id]);

  async function saveEditOrder(e) {
    e.preventDefault();
    setSavingEditOrder(true);
    try {
      const body = {};
      if (editOrderForm.patient_id) body.patient_id = editOrderForm.patient_id;
      if (editOrderForm.notes !== order.notes) body.notes = editOrderForm.notes;
      if (!Object.keys(body).length) { setShowEditOrder(false); return; }
      const { data } = await api.patch(`/orders/${id}`, body);
      setOrder(prev => ({ ...prev, ...data }));
      addToast('Order updated', 'success');
      setShowEditOrder(false);
      load(); // reload full detail (refresh patient name etc.)
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to update order', 'error');
    } finally {
      setSavingEditOrder(false);
    }
  }

  async function generateInvoice() {
    setGeneratingInvoice(true);
    try {
      await api.post(`/orders/${id}/invoice`);
      addToast('Invoice generated and emailed', 'success');
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to generate invoice', 'error');
    }
    setGeneratingInvoice(false);
  }

  async function handleShip(e) {
    e.preventDefault();
    setShipping(true);
    try {
      await api.post(`/orders/${id}/ship`, {
        service: shipForm.service,
        box_type: shipForm.box_type,
        weight_lbs: parseFloat(shipForm.weight_lbs),
        length_in: shipForm.box_type === 'YOUR_PACKAGING' && shipForm.length_in ? parseFloat(shipForm.length_in) : undefined,
        width_in:  shipForm.box_type === 'YOUR_PACKAGING' && shipForm.width_in  ? parseFloat(shipForm.width_in)  : undefined,
        height_in: shipForm.box_type === 'YOUR_PACKAGING' && shipForm.height_in ? parseFloat(shipForm.height_in) : undefined,
        recipient_name: shipForm.recipient_name || undefined,
        recipient_street: shipForm.recipient_street || undefined,
        recipient_city: shipForm.recipient_city || undefined,
        recipient_state: shipForm.recipient_state || undefined,
        recipient_zip: shipForm.recipient_zip || undefined,
        recipient_country: shipForm.recipient_country || undefined,
      });
      addToast('Shipping label created!', 'success');
      setShipModal(false);
      load();
    } catch (err) {
      const fedexErrors = err.response?.data?.details?.errors;
      const msg = fedexErrors?.length
        ? fedexErrors.map(e => e.message || e.code).join(' · ')
        : err.response?.data?.message || 'Shipping failed';
      addToast(msg, 'error');
    }
    setShipping(false);
  }

  async function resendInvoice() {
    setResendingInvoice(true);
    try {
      const { data } = await api.post(`/orders/${id}/resend-invoice`);
      const parts = ['Invoice resent'];
      if (data.sent.email) parts.push('email ✓');
      if (data.sent.sms) parts.push('SMS ✓');
      addToast(parts.join(' · '), 'success');
    } catch (err) {
      addToast(err.response?.data?.message || 'Resend failed', 'error');
    }
    setResendingInvoice(false);
  }

  async function resendShipping() {
    setResendingShipping(true);
    try {
      const { data } = await api.post(`/orders/${id}/resend-shipping`);
      const parts = ['Shipping notification resent'];
      if (data.sent.email) parts.push('email ✓');
      if (data.sent.sms) parts.push('SMS ✓');
      addToast(parts.join(' · '), 'success');
    } catch (err) {
      addToast(err.response?.data?.message || 'Resend failed', 'error');
    }
    setResendingShipping(false);
  }

  async function enterEditMode() {
    if (!allProducts.length) {
      try {
        const { data } = await api.get('/products');
        setAllProducts(data.filter(p => p.active !== false));
      } catch {
        addToast('Failed to load products', 'error');
        return;
      }
    }
    setEditItems(order.items.map(i => ({ product_id: i.product_id, quantity: i.quantity, product_name: i.product_name, unit_price: i.unit_price })));
    setAddProductId('');
    setAddQty(1);
    setEditMode(true);
  }

  function editQty(idx, val) {
    const qty = Math.max(1, parseInt(val) || 1);
    setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: qty } : it));
  }

  function removeEditItem(idx) {
    setEditItems(prev => prev.filter((_, i) => i !== idx));
  }

  function addEditItem() {
    if (!addProductId) return;
    const product = allProducts.find(p => p.id === addProductId);
    if (!product) return;
    const existing = editItems.findIndex(i => i.product_id === addProductId);
    if (existing >= 0) {
      setEditItems(prev => prev.map((it, i) => i === existing ? { ...it, quantity: it.quantity + addQty } : it));
    } else {
      setEditItems(prev => [...prev, { product_id: product.id, quantity: addQty, product_name: product.name, unit_price: product.unit_price }]);
    }
    setAddProductId('');
    setAddQty(1);
  }

  async function saveItems() {
    if (!editItems.length) { addToast('Order must have at least one item', 'error'); return; }
    setSavingItems(true);
    try {
      await api.patch(`/orders/${id}/items`, { items: editItems.map(i => ({ product_id: i.product_id, quantity: i.quantity })) });
      addToast('Order updated', 'success');
      setEditMode(false);
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to save', 'error');
    }
    setSavingItems(false);
  }

  async function getShippingRates(e) {
    e.preventDefault();
    setRqLoading(true); setRqRates([]); setRqSelected(null);
    try {
      const { data } = await api.post(`/orders/${id}/rate-quote`, {
        package_type: rqForm.package_type,
        weight_lbs:   parseFloat(rqForm.weight_lbs),
        length_in:    rqForm.length_in || undefined,
        width_in:     rqForm.width_in  || undefined,
        height_in:    rqForm.height_in || undefined,
      });
      if (!data.rates?.length) addToast('No rates returned from FedEx. Check package/weight/address.', 'warning');
      setRqRates(data.rates || []);
    } catch (err) {
      const fedexMsg = err.response?.data?.details?.errors?.[0]?.message || err.response?.data?.message || 'Rate quote failed';
      addToast(fedexMsg, 'error');
    }
    setRqLoading(false);
  }

  async function saveShippingQuote() {
    if (!rqSelected) return;
    setRqSaving(true);
    try {
      await api.patch(`/orders/${id}/shipping-quote`, {
        service_type:  rqSelected.serviceType,
        package_type:  rqForm.package_type,
        weight_lbs:    parseFloat(rqForm.weight_lbs),
        length_in:     rqForm.length_in || undefined,
        width_in:      rqForm.width_in  || undefined,
        height_in:     rqForm.height_in || undefined,
        net_charge:    rqSelected.netCharge,
        currency:      rqSelected.currency,
        transit_days:  rqSelected.transitDays,
        delivery_date: rqSelected.deliveryDate,
      });
      addToast('Shipping added to order', 'success');
      setRqRates([]); setRqSelected(null);
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to save', 'error');
    }
    setRqSaving(false);
  }

  function parseNotes(text) {
    if (!text) return [];
    return text.split('\n').filter(Boolean).map(line => {
      const m = line.match(/^\[(.+?)\]: (.+)$/);
      return m ? { label: m[1], text: m[2] } : { label: null, text: line };
    });
  }

  async function saveNote(e) {
    e.preventDefault();
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const { data } = await api.post(`/orders/${id}/notes`, { note: newNote });
      setOrder(o => ({ ...o, notes: data.notes }));
      setNewNote('');
      addToast('Note saved', 'success');
    } catch {
      addToast('Failed to save note', 'error');
    }
    setSavingNote(false);
  }

  async function sendMessage(e) {
    e.preventDefault();
    setSendingEmail(true);
    try {
      const { data } = await api.post(`/orders/${id}/send-email`, {
        subject: emailSubject,
        body: emailBody,
        channels: emailChannel,
      });
      const parts = [];
      if (data.sent?.email) parts.push('email ✓');
      if (data.sent?.sms) parts.push('SMS ✓');
      addToast(parts.length ? `Sent: ${parts.join(' · ')}` : 'Message sent', 'success');
      setEmailSubject('');
      setEmailBody('');
      setEmailTemplate('');
      load();
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to send', 'error');
    }
    setSendingEmail(false);
  }

  async function refreshTracking() {
    try {
      await api.post(`/orders/${id}/tracking/refresh`);
      addToast('Tracking refreshed', 'info');
      load();
    } catch (err) {
      addToast('Failed to refresh tracking', 'error');
    }
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</div>;
  if (!order) return <div style={{ padding: 40 }}>Order not found.</div>;

  const STEPS = ['draft', 'pending_payment', 'paid', 'shipped'];
  const stepIdx = STEPS.indexOf(order.status);
  const isPaid = order.status === 'paid' || order.status === 'shipped';
  const hasInvoice = !!order.invoice;
  const hasShipment = !!order.shipment;

  const isEditable = ['draft', 'pending_payment'].includes(order.status) &&
    (!order.invoice || order.invoice.pay_status === 'pending');

  const subtotal     = order.items.reduce((sum, i) => sum + parseFloat(i.line_total), 0);
  const editSubtotal = editItems.reduce((sum, i) => sum + parseFloat(i.unit_price) * i.quantity, 0);
  const shippingQuote = order.shipping_quote || null;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Link to="/orders" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Orders</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
          <h1 style={{ fontFamily: 'var(--brand-serif)', fontSize: 28, flex: 1 }}>
            {order.order_number}
          </h1>
          {order.status === 'draft' && (
            <button
              onClick={() => { setEditOrderForm({ patient_id: order.patient?.id || '', notes: order.notes || '' }); setShowEditOrder(true); }}
              style={{ fontSize: 13, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', flexShrink: 0 }}
            >
              Edit Order
            </button>
          )}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{order.patient?.name} · {fmtDate(order.created_at)}</p>
      </div>

      {/* Pipeline */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '16px 24px', marginBottom: 24,
        display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {STEPS.map((step, i) => (
          <React.Fragment key={step}>
            <PipelineStep label={step.replace(/_/g, ' ')} active={stepIdx === i} done={stepIdx > i} />
            {i < STEPS.length - 1 && <span style={{ color: 'var(--border)', fontSize: 18 }}>→</span>}
          </React.Fragment>
        ))}
      </div>

      {/* ── Shipping Quote — full width ─────────────────────────────────── */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Shipping Quote</h2>
          {shippingQuote && (
            <div style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>
              {SERVICE_LABELS[shippingQuote.service_type] || shippingQuote.service_type} · {fmtCurrency(shippingQuote.net_charge)} {shippingQuote.currency}
              {shippingQuote.transit_days && <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>· {shippingQuote.transit_days} days</span>}
            </div>
          )}
        </div>

        <form onSubmit={getShippingRates} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, alignItems: 'end', marginBottom: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Package Type</label>
            <select value={rqForm.package_type} onChange={e => setRqForm(f => ({ ...f, package_type: e.target.value }))} style={{ width: '100%' }}>
              {Object.entries(PACKAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Weight (lbs)</label>
            <input type="number" step="0.1" min="0.1" required value={rqForm.weight_lbs}
              onChange={e => setRqForm(f => ({ ...f, weight_lbs: e.target.value }))} style={{ width: '100%' }} />
          </div>
          {rqForm.package_type === 'YOUR_PACKAGING' ? (
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Dimensions L×W×H (in)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                <input type="number" min="1" placeholder="L" required value={rqForm.length_in} onChange={e => setRqForm(f => ({ ...f, length_in: e.target.value }))} />
                <input type="number" min="1" placeholder="W" required value={rqForm.width_in}  onChange={e => setRqForm(f => ({ ...f, width_in:  e.target.value }))} />
                <input type="number" min="1" placeholder="H" required value={rqForm.height_in} onChange={e => setRqForm(f => ({ ...f, height_in: e.target.value }))} />
              </div>
            </div>
          ) : <div />}
          <button type="submit" disabled={rqLoading} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
            {rqLoading ? 'Getting Rates…' : 'Get Rates'}
          </button>
        </form>

        {rqRates.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Select a service — click to choose, then Save to Order</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 12 }}>
              {rqRates.map(r => {
                const selected = rqSelected?.serviceType === r.serviceType;
                return (
                  <div key={r.serviceType} onClick={() => setRqSelected(r)} style={{
                    border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    background: selected ? 'var(--accent)11' : 'var(--bg-elevated)',
                    borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: selected ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {SERVICE_LABELS[r.serviceType] || r.serviceType}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0', fontFamily: 'var(--brand-mono)', color: 'var(--success)' }}>
                      {fmtCurrency(r.netCharge)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {r.transitDays ? `${r.transitDays} day${r.transitDays !== '1' ? 's' : ''}` : ''}
                      {r.deliveryDate ? ` · by ${r.deliveryDate}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={saveShippingQuote} disabled={!rqSelected || rqSaving} style={{
                background: rqSelected ? 'var(--success)' : 'var(--bg-elevated)', color: rqSelected ? '#fff' : 'var(--text-muted)',
                border: 'none', borderRadius: 8, padding: '8px 22px', fontWeight: 600, fontSize: 13,
              }}>
                {rqSaving ? 'Saving…' : rqSelected ? `Add ${fmtCurrency(rqSelected.netCharge)} shipping to order` : 'Select a rate above'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: Line Items + Invoice */}
        <div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Line Items</h2>
              {isEditable && !editMode && (
                <button onClick={enterEditMode} style={{
                  background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                }}>✏ Edit Items</button>
              )}
            </div>

            {!editMode ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    <th style={{ textAlign: 'left', paddingBottom: 8 }}>Product</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8 }}>Qty</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8 }}>Price</th>
                    <th style={{ textAlign: 'right', paddingBottom: 8 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map(item => (
                    <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0' }}>{item.product_name}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>{item.quantity}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtCurrency(item.unit_price)}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(item.line_total)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={3} style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>Subtotal</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontWeight: 600 }}>{fmtCurrency(subtotal)}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      <th style={{ textAlign: 'left', paddingBottom: 8 }}>Product</th>
                      <th style={{ textAlign: 'right', paddingBottom: 8, width: 72 }}>Qty</th>
                      <th style={{ textAlign: 'right', paddingBottom: 8 }}>Price</th>
                      <th style={{ textAlign: 'right', paddingBottom: 8 }}>Total</th>
                      <th style={{ paddingBottom: 8, width: 28 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editItems.map((item, idx) => (
                      <tr key={item.product_id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 0' }}>{item.product_name}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right' }}>
                          <input
                            type="number" min="1" value={item.quantity}
                            onChange={e => editQty(idx, e.target.value)}
                            style={{ width: 56, textAlign: 'right', padding: '2px 6px', fontSize: 13 }}
                          />
                        </td>
                        <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtCurrency(item.unit_price)}</td>
                        <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>
                          {fmtCurrency(parseFloat(item.unit_price) * item.quantity)}
                        </td>
                        <td style={{ padding: '6px 0', textAlign: 'center' }}>
                          <button onClick={() => removeEditItem(idx)} title="Remove" style={{
                            background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
                          }}>×</button>
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td colSpan={3} style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text-muted)' }}>Subtotal</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontWeight: 600 }}>{fmtCurrency(editSubtotal)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>

                {/* Add product row */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                  <select
                    value={addProductId}
                    onChange={e => setAddProductId(e.target.value)}
                    style={{ flex: 1, fontSize: 13 }}
                  >
                    <option value="">— Add product —</option>
                    {allProducts.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({fmtCurrency(p.unit_price)})</option>
                    ))}
                  </select>
                  <input
                    type="number" min="1" value={addQty} onChange={e => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: 56, textAlign: 'right', fontSize: 13, padding: '4px 6px' }}
                  />
                  <button onClick={addEditItem} disabled={!addProductId} style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
                    padding: '4px 12px', fontSize: 13, cursor: addProductId ? 'pointer' : 'default', color: 'var(--text-secondary)',
                  }}>+ Add</button>
                </div>

                {/* Save / Cancel */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button onClick={() => setEditMode(false)} style={{
                    background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                    borderRadius: 8, padding: '6px 18px', fontSize: 13, cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={saveItems} disabled={savingItems || !editItems.length} style={{
                    background: 'var(--accent)', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '6px 20px', fontSize: 13, fontWeight: 600,
                    opacity: !editItems.length ? 0.5 : 1,
                  }}>
                    {savingItems ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Invoice panel */}
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Invoice</h2>
            {!hasInvoice ? (
              <div>
                {/* Pre-invoice totals preview */}
                {(() => {
                  const invoiceSubtotal = Math.round(subtotal * 1.039 * 100) / 100;
                  const shipCost = shippingQuote?.net_charge ? parseFloat(shippingQuote.net_charge) : 0;
                  const expectedTotal = invoiceSubtotal + shipCost;
                  return (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Items subtotal</span>
                        <span style={{ fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(invoiceSubtotal)}</span>
                      </div>
                      {shipCost > 0 ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                            ✓ Shipping ({SERVICE_LABELS[shippingQuote.service_type] || shippingQuote.service_type})
                          </span>
                          <span style={{ color: 'var(--success)', fontWeight: 600, fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(shipCost)}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 8, padding: '6px 10px', background: 'var(--warning)11', borderRadius: 6 }}>
                          ⚠ No shipping quote saved — get a FedEx quote above before generating the invoice.
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, paddingTop: 10, borderTop: '1px solid var(--border)', marginTop: 4 }}>
                        <span>Expected Total</span>
                        <span style={{ fontFamily: 'var(--brand-mono)', color: 'var(--success)' }}>{fmtCurrency(expectedTotal)}</span>
                      </div>
                    </div>
                  );
                })()}
                {order.status === 'draft' && (
                  <button onClick={generateInvoice} disabled={generatingInvoice} style={{
                    background: 'var(--accent)', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '8px 20px', fontWeight: 600, fontSize: 13, width: '100%',
                  }}>
                    {generatingInvoice ? 'Generating…' : 'Generate & Send Invoice'}
                  </button>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Invoice #</span>
                  <span style={{ fontFamily: 'var(--brand-mono)' }}>{order.invoice.invoice_number}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Subtotal</span>
                  <span>{fmtCurrency(order.invoice.subtotal)}</span>
                </div>
                {parseFloat(order.invoice.shipping_charge) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>
                      Shipping{shippingQuote?.service_type ? ` (${SERVICE_LABELS[shippingQuote.service_type] || shippingQuote.service_type})` : ''}
                    </span>
                    <span>{fmtCurrency(order.invoice.shipping_charge)}</span>
                  </div>
                )}
                {parseFloat(order.invoice.processing_fee) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>CC Fee (3.9%)</span>
                    <span style={{ color: 'var(--warning)' }}>{fmtCurrency(order.invoice.processing_fee)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontWeight: 700 }}>
                  <span>Total</span>
                  <span style={{ fontFamily: 'var(--brand-mono)', color: 'var(--success)' }}>{fmtCurrency(order.invoice.total)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status</span>
                  <span className={`badge badge-${order.invoice.pay_status}`}>{order.invoice.pay_status}</span>
                </div>
                {order.invoice.pay_method && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Method</span>
                    <span>{order.invoice.pay_method.replace('_', ' ').toUpperCase()}</span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={`/api/invoices/${order.invoice.id}/pdf`} target="_blank" rel="noreferrer" style={{
                    fontSize: 12, color: 'var(--accent)', border: '1px solid var(--accent)',
                    borderRadius: 6, padding: '4px 12px',
                  }}>Download PDF</a>
                  {order.invoice.pay_status === 'pending' && (
                    <a href={`/pay/${order.invoice.id}`} target="_blank" rel="noreferrer" style={{
                      fontSize: 12, background: 'var(--accent)', color: '#fff',
                      borderRadius: 6, padding: '4px 12px',
                    }}>Payment Portal →</a>
                  )}
                  <button onClick={resendInvoice} disabled={resendingInvoice} style={{
                    fontSize: 12, background: 'none', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                    opacity: resendingInvoice ? 0.6 : 1,
                  }}>
                    {resendingInvoice ? 'Sending…' : '↩ Resend Invoice'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Shipping */}
        <div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>FedEx Shipping</h2>
            {!isPaid ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
                <p style={{ fontSize: 13 }}>Shipping is locked until invoice is paid.</p>
              </div>
            ) : !hasShipment ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Invoice paid. Ready to ship.</p>
                <button onClick={() => {
                  const a = order.patient?.shipping_address || order.patient?.billing_address || {};
                  const q = order.shipping_quote;
                  setShipForm(f => ({
                    ...f,
                    service:           q?.service_type  || 'FEDEX_GROUND',
                    box_type:          q?.package_type  || 'YOUR_PACKAGING',
                    weight_lbs:        q?.weight_lbs    || '',
                    length_in:         q?.length_in     || '',
                    width_in:          q?.width_in      || '',
                    height_in:         q?.height_in     || '',
                    recipient_name:    order.patient?.name || '',
                    recipient_street:  a.street  || '',
                    recipient_city:    a.city    || '',
                    recipient_state:   a.state   || '',
                    recipient_zip:     a.zip     || '',
                    recipient_country: a.country || 'US',
                  }));
                  setShipModal(true);
                }} style={{
                  background: 'var(--success)', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '8px 20px', fontWeight: 600, fontSize: 13,
                }}>Create FedEx Label</button>
              </div>
            ) : (
              <div style={{ fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Tracking #</span>
                  <span style={{ fontFamily: 'var(--brand-mono)' }}>
                    <a href={`https://www.fedex.com/fedextrack/?tracknumbers=${order.shipment.fedex_tracking_number}`} target="_blank" rel="noreferrer">
                      {order.shipment.fedex_tracking_number}
                    </a>
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Service</span>
                  <span>{order.shipment.service_type}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Status</span>
                  <span>{order.shipment.latest_status}</span>
                </div>
                {order.shipment.exception_flag && (
                  <div style={{ background: '#ef444422', border: '1px solid #ef444444', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: 'var(--danger)' }}>
                    ⚠ Shipment exception detected
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <a href={`/api/orders/${id}/label`} target="_blank" rel="noreferrer" style={{
                    fontSize: 12, color: 'var(--accent)', border: '1px solid var(--accent)',
                    borderRadius: 6, padding: '4px 12px',
                  }}>Download Label PDF</a>
                  <button onClick={resendShipping} disabled={resendingShipping} style={{
                    fontSize: 12, background: 'none', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)', borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                    opacity: resendingShipping ? 0.6 : 1,
                  }}>
                    {resendingShipping ? 'Sending…' : '↩ Resend Shipping'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tracking Timeline */}
          {hasShipment && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>Shipment Timeline</h2>
                <button onClick={refreshTracking} style={{
                  background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  borderRadius: 6, padding: '4px 12px', fontSize: 12,
                }}>↻ Refresh</button>
              </div>
              {order.shipment.last_polled_at && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Last checked: {relativeTime(order.shipment.last_polled_at)}
                </p>
              )}
              {order.shipment.events?.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No events yet.</p>
              ) : (
                <div style={{ position: 'relative' }}>
                  {order.shipment.events?.map((ev, i) => {
                    const isException = ['DE', 'SE', 'DY', 'CA', 'RS'].includes(ev.event_code);
                    const isDelivered = ev.event_code === 'DL';
                    return (
                      <div key={ev.id} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                          background: isException ? 'var(--danger)' : isDelivered ? 'var(--success)' : 'var(--accent)',
                        }} />
                        <div>
                          <div style={{
                            fontSize: 13, fontWeight: 500,
                            color: isException ? 'var(--danger)' : isDelivered ? 'var(--success)' : 'var(--text-primary)',
                          }}>
                            {isException && '⚠ '}{isDelivered && '✓ '}{ev.event_description}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            {fmtDatetime(ev.event_timestamp)}
                            {ev.location_city && ` · ${[ev.location_city, ev.location_state, ev.location_country].filter(Boolean).join(', ')}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Notes + Email — full width below the main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
        {/* Order Notes */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Order Notes</h2>
          <div style={{ marginBottom: 16, maxHeight: 220, overflowY: 'auto' }}>
            {parseNotes(order.notes).length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No notes yet.</p>
            ) : parseNotes(order.notes).map((n, i) => (
              <div key={i} style={{
                borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                paddingTop: i > 0 ? 10 : 0, marginBottom: 10,
              }}>
                {n.label && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, fontFamily: 'var(--brand-mono)' }}>
                    {n.label}
                  </div>
                )}
                <div style={{ fontSize: 13 }}>{n.text}</div>
              </div>
            ))}
          </div>
          <form onSubmit={saveNote}>
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Add a staff note…"
              rows={3}
              style={{ width: '100%', marginBottom: 8, resize: 'vertical', fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={savingNote || !newNote.trim()} style={{
                background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
                padding: '6px 18px', fontSize: 13, fontWeight: 600,
                opacity: !newNote.trim() ? 0.5 : 1, cursor: newNote.trim() ? 'pointer' : 'default',
              }}>
                {savingNote ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          </form>
        </div>

        {/* Message Client */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Message Client</h2>
          {!order.patient?.email && !order.patient?.phone ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No email or phone on file for this patient.</p>
          ) : (
            <form onSubmit={sendMessage}>
              {/* Template picker */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Template</label>
                <select
                  value={emailTemplate}
                  onChange={e => {
                    const tid = e.target.value;
                    setEmailTemplate(tid);
                    const t = emailTemplates.find(x => x.id === tid);
                    if (t) { setEmailSubject(t.subject); setEmailBody(t.body); }
                    else { setEmailSubject(''); setEmailBody(''); }
                  }}
                  style={{ width: '100%' }}
                >
                  <option value="">— Custom message —</option>
                  {emailTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* Channel selector */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Send via</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['email', '✉ Email'], ['sms', '💬 SMS'], ['both', '✉ + 💬 Both']].map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setEmailChannel(val)} style={{
                      padding: '5px 12px', fontSize: 12, borderRadius: 6, border: '1px solid',
                      borderColor: emailChannel === val ? 'var(--accent)' : 'var(--border)',
                      background: emailChannel === val ? 'var(--accent)22' : 'none',
                      color: emailChannel === val ? 'var(--accent)' : 'var(--text-secondary)',
                      cursor: 'pointer', fontWeight: emailChannel === val ? 600 : 400,
                    }}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Recipient info */}
              <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                {(emailChannel === 'email' || emailChannel === 'both') && (
                  <div>
                    Email: {order.patient?.email
                      ? <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--brand-mono)' }}>{order.patient.email}</span>
                      : <span style={{ color: 'var(--danger)' }}>no email on file</span>}
                  </div>
                )}
                {(emailChannel === 'sms' || emailChannel === 'both') && (
                  <div>
                    SMS: {order.patient?.phone
                      ? <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--brand-mono)' }}>{order.patient.phone}</span>
                      : <span style={{ color: 'var(--danger)' }}>no phone on file — SMS will be skipped</span>}
                  </div>
                )}
              </div>

              {/* Subject — only needed for email */}
              {(emailChannel === 'email' || emailChannel === 'both') && (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Subject</label>
                  <input
                    value={emailSubject}
                    onChange={e => setEmailSubject(e.target.value)}
                    placeholder="Subject line"
                    required={emailChannel !== 'sms'}
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              {/* Body */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Message
                  {(emailChannel === 'sms' || emailChannel === 'both') && (
                    <span style={{ marginLeft: 8, fontWeight: 400 }}>
                      · SMS will be prefixed with company name + order #
                    </span>
                  )}
                </label>
                <textarea
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  placeholder="Write your message here…"
                  rows={8}
                  required
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" disabled={sendingEmail} style={{
                  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 22px', fontSize: 13, fontWeight: 600,
                }}>
                  {sendingEmail ? 'Sending…' : `→ Send ${emailChannel === 'email' ? 'Email' : emailChannel === 'sms' ? 'SMS' : 'Email + SMS'}`}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Ship Modal */}
      <Modal open={shipModal} onClose={() => setShipModal(false)} title="Create FedEx Label">
        <form onSubmit={handleShip}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Service Type</label>
            <select value={shipForm.service} onChange={e => {
              const svc = e.target.value;
              const validPkgs = SERVICE_VALID_PACKAGES[svc] || ['YOUR_PACKAGING'];
              const box = validPkgs.includes(shipForm.box_type) ? shipForm.box_type : validPkgs[0];
              setShipForm(f => ({ ...f, service: svc, box_type: box }));
            }} style={{ width: '100%' }}>
              <optgroup label="Ground">
                <option value="FEDEX_GROUND">FedEx Ground</option>
                <option value="FEDEX_HOME_DELIVERY">FedEx Home Delivery</option>
              </optgroup>
              <optgroup label="Express">
                <option value="FEDEX_EXPRESS_SAVER">FedEx Express Saver (3-day)</option>
                <option value="FEDEX_2_DAY">FedEx 2Day</option>
                <option value="FEDEX_2_DAY_AM">FedEx 2Day AM</option>
                <option value="STANDARD_OVERNIGHT">Standard Overnight</option>
                <option value="PRIORITY_OVERNIGHT">Priority Overnight</option>
                <option value="FIRST_OVERNIGHT">First Overnight</option>
              </optgroup>
              <optgroup label="International">
                <option value="INTERNATIONAL_ECONOMY">International Economy</option>
                <option value="INTERNATIONAL_PRIORITY">International Priority</option>
              </optgroup>
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Box / Package Type</label>
            <select value={shipForm.box_type} onChange={e => setShipForm(f => ({ ...f, box_type: e.target.value }))} style={{ width: '100%' }}>
              {(SERVICE_VALID_PACKAGES[shipForm.service] || ['YOUR_PACKAGING']).map(pkg => (
                <option key={pkg} value={pkg}>{PACKAGE_LABELS[pkg] || pkg}</option>
              ))}
            </select>
          </div>
          {shipForm.box_type === 'YOUR_PACKAGING' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Package Dimensions (inches) <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>— optional but recommended</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <input type="number" min="1" step="0.1" placeholder="Length"
                    value={shipForm.length_in} onChange={e => setShipForm(f => ({ ...f, length_in: e.target.value }))}
                    style={{ width: '100%' }} />
                </div>
                <div>
                  <input type="number" min="1" step="0.1" placeholder="Width"
                    value={shipForm.width_in} onChange={e => setShipForm(f => ({ ...f, width_in: e.target.value }))}
                    style={{ width: '100%' }} />
                </div>
                <div>
                  <input type="number" min="1" step="0.1" placeholder="Height"
                    value={shipForm.height_in} onChange={e => setShipForm(f => ({ ...f, height_in: e.target.value }))}
                    style={{ width: '100%' }} />
                </div>
              </div>
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Weight (lbs)
              {BOX_WEIGHT_MAX[shipForm.box_type] && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>
                  max {BOX_WEIGHT_MAX[shipForm.box_type]} lbs for this box
                </span>
              )}
            </label>
            <input type="number" step="0.01" min="0.1" max={BOX_WEIGHT_MAX[shipForm.box_type] || undefined} required
              value={shipForm.weight_lbs} onChange={e => setShipForm({ ...shipForm, weight_lbs: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div style={{ marginBottom: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 600 }}>Ship To (editable)</label>
            <div style={{ marginBottom: 8 }}>
              <input placeholder="Recipient name" value={shipForm.recipient_name}
                onChange={e => setShipForm({ ...shipForm, recipient_name: e.target.value })} style={{ width: '100%' }} />
            </div>
            <AddressAutocomplete
              value={shipForm.recipient_street}
              onChange={v => setShipForm(f => ({ ...f, recipient_street: v }))}
              onSelect={a => setShipForm(f => ({ ...f, recipient_street: a.street, recipient_city: a.city, recipient_state: a.state, recipient_zip: a.zip, recipient_country: a.country }))}
              placeholder="Street address"
              style={{ marginBottom: 8 }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 6, marginBottom: 8 }}>
              <input placeholder="City" value={shipForm.recipient_city} onChange={e => setShipForm({ ...shipForm, recipient_city: e.target.value })} />
              <input placeholder="State" value={shipForm.recipient_state} onChange={e => setShipForm({ ...shipForm, recipient_state: e.target.value })} />
              <input placeholder="ZIP" value={shipForm.recipient_zip} onChange={e => setShipForm({ ...shipForm, recipient_zip: e.target.value })} />
            </div>
            <input placeholder="Country (e.g. US)" value={shipForm.recipient_country}
              onChange={e => setShipForm({ ...shipForm, recipient_country: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" onClick={() => setShipModal(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" disabled={shipping} style={{ background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600 }}>
              {shipping ? 'Creating…' : 'Create Label'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Order Modal */}
      <Modal open={showEditOrder} onClose={() => setShowEditOrder(false)} title="Edit Order">
        <form onSubmit={saveEditOrder}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Patient</label>
            <select
              value={editOrderForm.patient_id}
              onChange={e => setEditOrderForm(f => ({ ...f, patient_id: e.target.value }))}
              style={{ width: '100%' }}
            >
              <option value="">Keep current ({order?.patient?.name})</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>{p.name} — {p.email}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Notes</label>
            <textarea
              value={editOrderForm.notes}
              onChange={e => setEditOrderForm(f => ({ ...f, notes: e.target.value }))}
              rows={4}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setShowEditOrder(false)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 20px' }}>Cancel</button>
            <button type="submit" disabled={savingEditOrder} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 24px', fontWeight: 600 }}>
              {savingEditOrder ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
