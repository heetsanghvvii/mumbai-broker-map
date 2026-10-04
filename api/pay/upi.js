// POST /api/pay/upi — pay by UPI to the owner's UPI ID, checked by hand.
//   { action: 'start', office }      → order + UPI details to show as a QR code
//   { action: 'claim', orderId, utr } → buyer reports the 12-digit UPI transaction ID
//   { action: 'status', orderId }     → 'created' | 'claimed' | 'paid' | 'rejected'; a signed unlock token once paid
// The owner approves claims on /admin.html after checking the payment in their UPI app.
import { randomBytes, randomUUID } from 'node:crypto';
import { PRICE_PAISE, UNLOCK_DAYS, db, env, fail, json, officeKey, readJson, signUnlock, visitorId } from '../_lib/server.js';

const CLAIMS_PER_DAY = 10;

export async function POST(request) {
  const upiId = env('UPI_ID');
  if (!upiId) return fail(503, 'payments_not_configured', 'Payments open soon. The top 3 areas stay free.');

  let input;
  try {
    input = await readJson(request);
  } catch {
    return fail(400, 'bad_request', 'Send the details as JSON.');
  }

  try {
    if (input.action === 'start') {
      const lat = Number(input?.office?.lat);
      const lng = Number(input?.office?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(400, 'bad_office', 'Pick an office first.');
      const orderId = `upi_${randomUUID()}`;
      const ref = `MBM${randomBytes(3).toString('hex').toUpperCase()}`;
      const amount = PRICE_PAISE();
      await db('payment_create', { order_id: orderId, office_key: officeKey(lat, lng), amount, method: 'upi', ref });
      const payee = env('UPI_NAME', 'Mumbai Broker Map');
      const rupees = (amount / 100).toFixed(2);
      const link = `upi://pay?${new URLSearchParams({ pa: upiId, pn: payee, am: rupees, cu: 'INR', tn: ref })}`;
      return json({ orderId, ref, upiId, payee, amount: amount / 100, link });
    }

    const orderId = String(input?.orderId || '');
    if (!/^upi_[0-9a-f-]{36}$/.test(orderId)) return fail(400, 'bad_order', 'This payment was not found.');

    if (input.action === 'claim') {
      const utr = String(input?.utr || '').replace(/\s/g, '');
      if (!/^\d{12}$/.test(utr)) return fail(400, 'bad_utr', 'The UPI transaction ID is the 12-digit number in your UPI app’s payment details.');
      const hits = await db('rate_hit', { who: `claim:${visitorId(request)}` });
      if (hits > CLAIMS_PER_DAY) return fail(429, 'too_many', 'Too many attempts today. Please try again tomorrow.');
      const r = await db('upi_claim', { order_id: orderId, utr });
      if (r === 'utr_used') return fail(409, 'utr_used', 'That transaction ID has already been used for another unlock.');
      if (r === 'not_found') return fail(404, 'bad_order', 'This payment was not found, or it has already been approved.');
      return json({ status: 'claimed' });
    }

    if (input.action === 'status') {
      const p = await db('payment_get', { order_id: orderId });
      if (!p) return fail(404, 'bad_order', 'This payment was not found.');
      if (p.status !== 'paid') return json({ status: p.status, officeKey: p.office_key });
      const exp = new Date(p.paid_at).getTime() + UNLOCK_DAYS * 86_400_000;
      if (exp <= Date.now()) return json({ status: 'expired', officeKey: p.office_key });
      return json({ status: 'paid', officeKey: p.office_key, exp, token: signUnlock({ k: p.office_key, exp, o: orderId }) });
    }

    return fail(400, 'bad_request', 'Unknown action.');
  } catch (err) {
    console.error('upi failed', err);
    return fail(502, 'upstream', 'Something went wrong. Please try again in a minute.');
  }
}
