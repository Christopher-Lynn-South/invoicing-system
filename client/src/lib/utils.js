export const CC_FEE_RATE = 0.039;

export function calcFee(subtotal, method) {
  if (method === 'stripe_cc') {
    return Math.round(parseFloat(subtotal) * CC_FEE_RATE * 100) / 100;
  }
  return 0;
}

export function fmtCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDatetime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function statusBadge(status) {
  const map = {
    draft: 'badge-draft',
    pending_payment: 'badge-pending',
    paid: 'badge-paid',
    shipped: 'badge-shipped',
    cancelled: 'badge-cancelled',
    delivered: 'badge-delivered',
    pending: 'badge-pending',
    failed: 'badge-cancelled',
  };
  return map[status] || 'badge-draft';
}

export function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}
