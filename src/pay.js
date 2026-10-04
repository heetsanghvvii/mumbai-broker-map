// Paid unlock for Commute Search: Razorpay Checkout in the browser, proof and token from the server.
// The browser only keeps the server-signed token; the server re-checks it on every request.

const KEY = (officeKey) => `mbm-unlock:${officeKey}`;

export const officeKeyOf = (lat, lng) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

export function savedUnlock(officeKey) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(officeKey)) || 'null');
    if (v && v.exp > Date.now()) return v;
    localStorage.removeItem(KEY(officeKey));
  } catch {
    /* storage blocked: the visitor just sees the free preview */
  }
  return null;
}

function remember(officeKey, token, exp) {
  try {
    localStorage.setItem(KEY(officeKey), JSON.stringify({ token, exp }));
  } catch {
    /* storage blocked: the unlock lasts for this page only */
  }
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong. Please try again.');
    err.code = data.error;
    throw err;
  }
  return data;
}

let checkoutScript;
function loadCheckout() {
  checkoutScript ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => {
      checkoutScript = null;
      reject(new Error('The payment window could not load. Check your connection.'));
    };
    document.head.appendChild(s);
  });
  return checkoutScript;
}

/**
 * Runs the whole purchase. Resolves the unlock ({token, exp}) once the server has verified the payment;
 * resolves null if the buyer closes the payment window.
 */
export async function buyUnlock(office) {
  const order = await post('/api/pay/order', { office: { lat: office.lat, lng: office.lng } });
  const Razorpay = await loadCheckout();
  const paid = await new Promise((resolve, reject) => {
    const rz = new Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: 'Mumbai Broker Map',
      description: 'Full commute map for 7 days',
      notes: { office: office.name || '' },
      theme: { color: '#2f9e62' },
      handler: resolve,
      modal: { ondismiss: () => resolve(null) },
    });
    rz.on('payment.failed', (r) => reject(new Error(r?.error?.description || 'The payment failed. You have not been charged.')));
    rz.open();
  });
  if (!paid) return null;
  const v = await post('/api/pay/verify', {
    orderId: paid.razorpay_order_id,
    paymentId: paid.razorpay_payment_id,
    signature: paid.razorpay_signature,
  });
  remember(v.officeKey, v.token, v.exp);
  return v;
}

export async function fetchCommute(body) {
  return post('/api/commute', body);
}
