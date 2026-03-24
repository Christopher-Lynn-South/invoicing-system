import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { QRCodeSVG } from 'qrcode.react';
import { fmtCurrency, calcFee } from '../lib/utils';

const CC_FEE_RATE = 0.039;
let stripePromise = null;

function getStripe() {
  if (!stripePromise) {
    const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    if (key) stripePromise = loadStripe(key);
  }
  return stripePromise;
}

const METHOD_CARDS = [
  {
    id: 'stripe_cc',
    label: 'Credit Card',
    icon: '💳',
    desc: '+3.9% processing fee',
  },
  {
    id: 'ach',
    label: 'ACH Bank Transfer',
    icon: '🏦',
    desc: 'No fee — 2-3 business days',
  },
  {
    id: 'usdc',
    label: 'USDC (Polygon or Ethereum)',
    icon: '🔷',
    desc: 'No fee — instant',
  },
];

function CardPayForm({ invoiceId, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handlePay() {
    if (!stripe || !elements) return;
    setLoading(true); setError('');
    try {
      const { data } = await axios.post(`/api/pay/${invoiceId}/intent`, { method: 'stripe_cc' });
      const result = await stripe.confirmCardPayment(data.client_secret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      if (result.error) {
        setError(result.error.message);
        setLoading(false);
      } else {
        onSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Payment failed');
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{
        border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px',
        background: 'var(--bg-elevated)', marginBottom: 12,
      }}>
        <CardElement options={{
          style: {
            base: { color: '#e8eaf6', fontFamily: 'DM Sans, sans-serif', fontSize: '16px', '::placeholder': { color: '#5a6285' } },
          },
        }} />
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button onClick={handlePay} disabled={loading || !stripe} style={{
        width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
        borderRadius: 8, padding: '12px', fontWeight: 700, fontSize: 15,
        opacity: loading ? 0.7 : 1,
      }}>
        {loading ? 'Processing…' : 'Pay Now'}
      </button>
    </div>
  );
}

function ACHPayForm({ invoiceId, patient, onSuccess }) {
  const stripe = useStripe();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handlePay() {
    if (!stripe) return;
    setLoading(true); setError('');
    try {
      const { data } = await axios.post(`/api/pay/${invoiceId}/intent`, { method: 'ach' });

      // Step 1: open Stripe Financial Connections to collect bank account
      const collectResult = await stripe.collectBankAccountForPayment({
        clientSecret: data.client_secret,
        params: {
          payment_method_type: 'us_bank_account',
          payment_method_data: {
            billing_details: {
              name: patient?.name || '',
              email: patient?.email || '',
            },
          },
        },
      });

      if (collectResult.error) {
        setError(collectResult.error.message);
        setLoading(false);
        return;
      }

      // User closed the modal without connecting
      if (collectResult.paymentIntent.status === 'requires_payment_method') {
        setError('No bank account was connected. Please try again.');
        setLoading(false);
        return;
      }

      // Step 2: confirm (shows mandate acceptance screen)
      const confirmResult = await stripe.confirmUsBankAccountPayment(data.client_secret);
      if (confirmResult.error) {
        setError(confirmResult.error.message);
        setLoading(false);
      } else {
        // ACH settles async — status will be processing, webhook marks it paid
        onSuccess();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'ACH setup failed');
      setLoading(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        ACH payments settle in 2-3 business days. You'll receive a confirmation email.
      </p>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button onClick={handlePay} disabled={loading || !stripe} style={{
        width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
        borderRadius: 8, padding: '12px', fontWeight: 700, fontSize: 15,
        opacity: loading ? 0.7 : 1,
      }}>
        {loading ? 'Setting up…' : 'Set Up Bank Account'}
      </button>
    </div>
  );
}

function USDCPayForm({ invoiceId, totalUSDC, onSuccess }) {
  const [txHash, setTxHash] = useState('');
  const [walletInfo, setWalletInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.post(`/api/pay/${invoiceId}/intent`, { method: 'usdc' })
      .then(r => setWalletInfo(r.data))
      .catch(console.error);
  }, [invoiceId]);

  async function handleConfirm() {
    if (!txHash.trim()) return;
    setLoading(true); setError('');
    try {
      await axios.post(`/api/pay/${invoiceId}/usdc-confirm`, { tx_hash: txHash.trim() });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Verification failed');
      setLoading(false);
    }
  }

  if (!walletInfo) return <div style={{ color: 'var(--text-muted)', padding: '16px 0' }}>Loading wallet info…</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ background: '#fff', padding: 8, borderRadius: 8, flexShrink: 0 }}>
          <QRCodeSVG value={walletInfo.wallet} size={120} />
        </div>
        <div style={{ fontSize: 13 }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>Send exactly:</p>
          <p style={{ fontFamily: 'var(--brand-mono)', fontSize: 18, fontWeight: 700, color: 'var(--success)', marginBottom: 10 }}>
            {totalUSDC} USDC
          </p>
          <p style={{ color: 'var(--text-muted)', marginBottom: 4 }}>To wallet:</p>
          <p style={{ fontFamily: 'var(--brand-mono)', fontSize: 11, wordBreak: 'break-all', color: 'var(--text-primary)' }}>
            {walletInfo.wallet}
          </p>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(walletInfo.networks || []).map(n => (
              <span key={n.name} style={{
                fontSize: 11,
                color: n.name === 'polygon' ? 'var(--success)' : 'var(--text-muted)',
                fontWeight: n.name === 'polygon' ? 600 : 400,
              }}>
                {n.name === 'polygon' ? '★ ' : '◦ '}{n.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Transaction Hash (paste after sending)
        </label>
        <input
          value={txHash} onChange={e => setTxHash(e.target.value)}
          placeholder="0x…"
          style={{ width: '100%', fontFamily: 'var(--brand-mono)', fontSize: 12 }}
        />
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button onClick={handleConfirm} disabled={loading || !txHash.trim()} style={{
        width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
        borderRadius: 8, padding: '12px', fontWeight: 700, fontSize: 15,
        opacity: (loading || !txHash.trim()) ? 0.5 : 1,
      }}>
        {loading ? 'Verifying on-chain…' : 'Confirm USDC Payment'}
      </button>
    </div>
  );
}

export default function PatientPayPortal({ invoice }) {
  const [method, setMethod] = useState('stripe_cc');
  const [paid, setPaid] = useState(false);
  const stripe = getStripe();

  const subtotal = parseFloat(invoice.subtotal);
  const fee = method === 'stripe_cc' ? Math.round(subtotal * CC_FEE_RATE * 100) / 100 : 0;
  const total = subtotal + fee;
  const ccTotal = subtotal + Math.round(subtotal * CC_FEE_RATE * 100) / 100;
  const savings = ccTotal - subtotal;

  function onSuccess() {
    setPaid(true);
  }

  if (paid) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <h2 style={{ color: 'var(--success)', marginBottom: 12, fontSize: 24 }}>Payment Received!</h2>
        <p style={{ color: 'var(--text-primary)', fontSize: 15, marginBottom: 8 }}>
          Thank you — your payment has been successfully processed.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          You will receive a confirmation email shortly.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Invoice Summary */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Invoice {invoice.invoice_number}</h3>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {invoice.items?.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 0' }}>{item.product_name}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', color: 'var(--text-muted)' }}>×{item.quantity}</td>
                <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(item.line_total)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} style={{ padding: '8px 0', color: 'var(--text-muted)' }}>Subtotal</td>
              <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)' }}>{fmtCurrency(subtotal)}</td>
            </tr>
            {fee > 0 && (
              <tr>
                <td colSpan={2} style={{ padding: '4px 0', color: 'var(--warning)', fontSize: 12 }}>CC Fee (3.9%)</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', color: 'var(--warning)', fontSize: 12 }}>+{fmtCurrency(fee)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={2} style={{ padding: '8px 0', fontWeight: 700 }}>Total Due</td>
              <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'var(--brand-mono)', fontWeight: 700, fontSize: 18, color: 'var(--success)' }}>{fmtCurrency(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Method selector */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>Select payment method:</p>
        {METHOD_CARDS.map(m => (
          <div
            key={m.id}
            onClick={() => setMethod(m.id)}
            style={{
              border: `2px solid ${method === m.id ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 10, padding: '14px 16px', marginBottom: 8, cursor: 'pointer',
              background: method === m.id ? 'var(--accent-light)' : 'var(--bg-elevated)',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            <span style={{ fontSize: 22 }}>{m.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{m.label}</div>
              <div style={{ fontSize: 12, color: m.id === 'stripe_cc' ? 'var(--warning)' : 'var(--success)' }}>{m.desc}</div>
            </div>
            {m.id !== 'stripe_cc' && (
              <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                Save {fmtCurrency(savings)}
              </span>
            )}
            <div style={{
              width: 18, height: 18, borderRadius: '50%', border: '2px solid',
              borderColor: method === m.id ? 'var(--accent)' : 'var(--border)',
              background: method === m.id ? 'var(--accent)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {method === m.id && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
            </div>
          </div>
        ))}
      </div>

      {/* Payment form */}
      {stripe ? (
        <Elements stripe={stripe}>
          {method === 'stripe_cc' && <CardPayForm invoiceId={invoice.id} onSuccess={onSuccess} />}
          {method === 'ach' && <ACHPayForm invoiceId={invoice.id} patient={invoice.patient} onSuccess={onSuccess} />}
        </Elements>
      ) : null}
      {method === 'usdc' && <USDCPayForm invoiceId={invoice.id} totalUSDC={total.toFixed(2)} onSuccess={onSuccess} />}
    </div>
  );
}
