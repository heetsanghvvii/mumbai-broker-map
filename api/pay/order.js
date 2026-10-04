// POST /api/pay/order — start a ₹99 Razorpay order to unlock Commute Search for one office.
import { PRICE_PAISE, db, fail, json, officeKey, razorpay, readJson } from '../_lib/server.js';

export async function POST(request) {
  const rp = razorpay();
  if (!rp) return fail(503, 'payments_not_configured', 'Payments are being set up. Please check back soon.');

  let input;
  try {
    input = await readJson(request);
  } catch {
    return fail(400, 'bad_request', 'Send the office location as JSON.');
  }
  const lat = Number(input?.office?.lat);
  const lng = Number(input?.office?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail(400, 'bad_office', 'Pick an office first.');

  const cell = officeKey(lat, lng);
  try {
    const order = await rp.call('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: PRICE_PAISE(),
        currency: 'INR',
        receipt: `commute-${Date.now()}`,
        notes: { office_key: cell, product: 'Commute map, 7 days' },
      }),
    });
    await db('payment_create', { order_id: order.id, office_key: cell, amount: order.amount });
    return json({ orderId: order.id, keyId: rp.id, amount: order.amount, currency: order.currency, officeKey: cell });
  } catch (err) {
    console.error('order failed', err);
    return fail(502, 'order_failed', 'The payment could not be started. Please try again.');
  }
}
