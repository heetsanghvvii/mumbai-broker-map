// POST /api/admin — the owner's payment desk. { password, action: 'list' | 'approve' | 'reject', orderId? }
import { timingSafeEqual } from 'node:crypto';
import { db, env, fail, json, readJson, visitorId } from './_lib/server.js';

// Counts every request (good or bad), so a long random password can't be guessed; the owner never gets near it.
const ATTEMPTS_PER_DAY = 200;

function passwordOk(given) {
  const want = Buffer.from(env('ADMIN_PASSWORD'));
  const got = Buffer.from(String(given || ''));
  return want.length >= 12 && got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(request) {
  if (!env('ADMIN_PASSWORD')) return fail(503, 'not_configured', 'Set ADMIN_PASSWORD on the server first.');
  let input;
  try {
    input = await readJson(request);
  } catch {
    return fail(400, 'bad_request', 'Send JSON.');
  }
  try {
    const hits = await db('rate_hit', { who: `admin:${visitorId(request)}` });
    if (hits > ATTEMPTS_PER_DAY) return fail(429, 'too_many', 'Too many attempts today.');
    if (!passwordOk(input.password)) return fail(401, 'bad_password', 'Wrong password.');

    if (input.action === 'list') {
      const rows = await db('payments_recent', {});
      return json({ payments: rows });
    }
    const orderId = String(input.orderId || '');
    if (input.action === 'approve') {
      const office = await db('payment_paid', { order_id: orderId });
      return office ? json({ ok: true }) : fail(404, 'not_found', 'Payment not found.');
    }
    if (input.action === 'reject') {
      const r = await db('payment_reject', { order_id: orderId });
      return r ? json({ ok: true }) : fail(404, 'not_found', 'Only payments waiting for a check can be rejected.');
    }
    return fail(400, 'bad_request', 'Unknown action.');
  } catch (err) {
    console.error('admin failed', err);
    return fail(502, 'upstream', 'Database not reachable. Try again.');
  }
}
