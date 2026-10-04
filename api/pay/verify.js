// POST /api/pay/verify — after Razorpay Checkout succeeds, prove the payment on the server
// and hand back a signed 7-day unlock token for that office.
import { UNLOCK_DAYS, db, fail, hmacHex, json, razorpay, readJson, safeEqualHex, signUnlock } from '../_lib/server.js';

export async function POST(request) {
  const rp = razorpay();
  if (!rp) return fail(503, 'payments_not_configured', 'Payments are being set up. Please check back soon.');

  let input;
  try {
    input = await readJson(request);
  } catch {
    return fail(400, 'bad_request', 'Send the payment details as JSON.');
  }
  const orderId = String(input?.orderId || '');
  const paymentId = String(input?.paymentId || '');
  const signature = String(input?.signature || '');
  if (!orderId || !paymentId || !signature) return fail(400, 'bad_request', 'Payment details are missing.');

  // 1. Razorpay's signature proves this payment belongs to this order.
  if (!safeEqualHex(hmacHex(rp.secret, `${orderId}|${paymentId}`), signature)) {
    return fail(400, 'bad_signature', 'This payment could not be verified.');
  }

  try {
    // 2. The order must be ours, and Razorpay must say it's paid (the webhook may not have arrived yet).
    const record = await db('payment_get', { order_id: orderId });
    if (!record) return fail(404, 'unknown_order', 'This payment is not for Mumbai Broker Map.');
    if (record.status !== 'paid') {
      const order = await rp.call(`/orders/${encodeURIComponent(orderId)}`);
      if (order.status !== 'paid') return fail(402, 'not_paid', 'The payment has not completed yet. Please wait a moment and try again.');
      await db('payment_paid', { order_id: orderId, payment_id: paymentId });
    }

    const exp = Date.now() + UNLOCK_DAYS * 86_400_000;
    const token = signUnlock({ k: record.office_key, exp, o: orderId });
    return json({ token, exp, officeKey: record.office_key });
  } catch (err) {
    console.error('verify failed', err);
    return fail(502, 'verify_failed', 'The payment could not be confirmed right now. Your money is safe; please try again.');
  }
}
