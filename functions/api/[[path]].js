// Cloudflare Pages: every /api/* request lands here and goes to the same handlers Vercel uses (api/*.js).
import * as admin from '../../api/admin.js';
import * as commute from '../../api/commute.js';
import * as order from '../../api/pay/order.js';
import * as verify from '../../api/pay/verify.js';
import * as upi from '../../api/pay/upi.js';
import * as webhook from '../../api/razorpay-webhook.js';

const ROUTES = {
  admin,
  commute,
  'pay/order': order,
  'pay/verify': verify,
  'pay/upi': upi,
  'razorpay-webhook': webhook,
};

export async function onRequest({ request, params, env }) {
  const path = [].concat(params.path || []).join('/');
  const mod = ROUTES[path];
  if (!mod) return new Response('Not found', { status: 404 });
  const handler = mod[request.method];
  if (!handler) return new Response(null, { status: 405, headers: { Allow: Object.keys(mod).join(', ') } });
  // The handlers read settings from process.env (as on Vercel); Pages passes them as `env`.
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') process.env[k] = v;
  return handler(request);
}
