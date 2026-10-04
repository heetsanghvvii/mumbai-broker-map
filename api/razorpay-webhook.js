// POST /api/razorpay-webhook — Razorpay tells us an order was paid. Records it so /api/pay/verify
// and any later reconciliation see the payment even if the buyer's browser closed mid-checkout.
import { db, env, fail, hmacHex, json, safeEqualHex } from './_lib/server.js';

export async function POST(request) {
  const secret = env('RAZORPAY_WEBHOOK_SECRET');
  if (!secret) return fail(503, 'not_configured', 'Webhook secret is not set.');

  const raw = await request.text();
  const signature = request.headers.get('x-razorpay-signature') || '';
  if (!safeEqualHex(hmacHex(secret, raw), signature)) return fail(400, 'bad_signature', 'Signature mismatch.');

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return fail(400, 'bad_request', 'Body is not JSON.');
  }

  const payment = event?.payload?.payment?.entity;
  const order = event?.payload?.order?.entity;
  const orderId = order?.id || payment?.order_id;
  if ((event.event === 'order.paid' || event.event === 'payment.captured') && orderId) {
    try {
      await db('payment_paid', { order_id: orderId, payment_id: payment?.id || null });
    } catch (err) {
      console.error('webhook store failed', err);
      return fail(500, 'store_failed', 'Try again.'); // Razorpay retries on non-2xx
    }
  }
  return json({ ok: true });
}
