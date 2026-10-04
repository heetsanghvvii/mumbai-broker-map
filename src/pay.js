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

// ---------- UPI: pay to the owner's UPI ID, owner approves on /admin.html ----------

const PENDING = 'mbm-upi-pending';

function pendingList() {
  try {
    return JSON.parse(localStorage.getItem(PENDING) || '[]');
  } catch {
    return [];
  }
}
function savePending(list) {
  try {
    localStorage.setItem(PENDING, JSON.stringify(list.slice(-10)));
  } catch {
    /* storage blocked: polling still works while the page is open */
  }
}

async function upiStatus(orderId) {
  return post('/api/pay/upi', { action: 'status', orderId });
}

/** Checks payments waiting for approval on this device; stores any unlocks that came through. */
export async function checkPendingUpi() {
  const list = pendingList();
  const still = [];
  const unlocked = [];
  for (const p of list) {
    try {
      const s = await upiStatus(p.orderId);
      if (s.status === 'paid') {
        remember(s.officeKey, s.token, s.exp);
        unlocked.push(s.officeKey);
      } else if (s.status === 'claimed' || s.status === 'created') still.push(p);
    } catch {
      still.push(p);
    }
  }
  savePending(still);
  return unlocked;
}

/**
 * Shows the UPI payment sheet. Resolves {token, exp, officeKey} if approval arrives while it's open,
 * or null when the buyer closes it (the claim stays saved and is picked up on a later visit).
 */
export async function buyWithUpi(office) {
  const order = await post('/api/pay/upi', { action: 'start', office: { lat: office.lat, lng: office.lng } });
  const { toDataURL } = await import('qrcode');
  const qr = await toDataURL(order.link, { margin: 1, width: 440, color: { dark: '#0e1a24', light: '#ffffff' } });

  const dlg = document.createElement('dialog');
  dlg.className = 'upi';
  dlg.innerHTML = `
    <form method="dialog" class="upi-close"><button aria-label="Close">×</button></form>
    <h2 class="upi-title">Unlock the full commute map</h2>
    <p class="upi-amount"></p>
    <div class="upi-pay">
      <img class="upi-qr" alt="UPI QR code" width="220" height="220" />
      <div class="upi-steps">
        <p><b>1.</b> Scan with any UPI app, or <a class="upi-link">open your UPI app</a>.</p>
        <p class="upi-id-row">UPI ID <code class="upi-id"></code> <button type="button" class="btn btn-quiet upi-copy">Copy</button></p>
        <p><b>2.</b> Add <code class="upi-ref"></code> in the payment note.</p>
      </div>
    </div>
    <form class="upi-claim">
      <label for="upi-utr"><b>3.</b> Enter the 12-digit UPI transaction ID (UTR) from your UPI app</label>
      <input id="upi-utr" inputmode="numeric" autocomplete="off" maxlength="14" placeholder="e.g. 412345678901" required />
      <button type="submit" class="btn btn-primary btn-wide">I've paid</button>
      <p class="upi-msg" role="status"></p>
    </form>
    <p class="fine">Unlocks this office's full map for 7 days on this device. We check each payment by hand, usually within a few hours.</p>`;
  dlg.querySelector('.upi-amount').textContent = `₹${order.amount} one-time, to ${order.payee}`;
  dlg.querySelector('.upi-qr').src = qr;
  dlg.querySelector('.upi-link').href = order.link;
  dlg.querySelector('.upi-id').textContent = order.upiId;
  dlg.querySelector('.upi-ref').textContent = order.ref;
  dlg.querySelector('.upi-copy').addEventListener('click', (e) => {
    navigator.clipboard?.writeText(order.upiId).then(() => (e.target.textContent = 'Copied'), () => {});
  });
  document.body.append(dlg);
  dlg.showModal();

  return new Promise((resolve) => {
    let timer = null;
    const msg = dlg.querySelector('.upi-msg');
    const finish = (v) => {
      clearInterval(timer);
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener('close', () => finish(null), { once: true });

    dlg.querySelector('.upi-claim').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      msg.className = 'upi-msg';
      try {
        await post('/api/pay/upi', { action: 'claim', orderId: order.orderId, utr: dlg.querySelector('#upi-utr').value });
        savePending([...pendingList().filter((p) => p.orderId !== order.orderId), { orderId: order.orderId }]);
        e.target.querySelector('input').disabled = true;
        btn.textContent = 'Waiting for approval…';
        msg.textContent = 'Got it. You can close this; the map unlocks by itself next time you open the site on this device.';
        timer = setInterval(async () => {
          try {
            const s = await upiStatus(order.orderId);
            if (s.status === 'paid') {
              remember(s.officeKey, s.token, s.exp);
              savePending(pendingList().filter((p) => p.orderId !== order.orderId));
              finish({ token: s.token, exp: s.exp, officeKey: s.officeKey });
            } else if (s.status === 'rejected') {
              msg.className = 'upi-msg is-error';
              msg.textContent = 'We couldn’t find this payment. Check the transaction ID and send it again.';
              e.target.querySelector('input').disabled = false;
              btn.disabled = false;
              btn.textContent = "I've paid";
              clearInterval(timer);
            }
          } catch {
            /* keep waiting */
          }
        }, 15000);
      } catch (err) {
        btn.disabled = false;
        msg.className = 'upi-msg is-error';
        msg.textContent = err.message;
      }
    });
  });
}
