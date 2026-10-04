// Shared helpers for the Vercel functions. Files under api/_lib are not deployed as endpoints.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const env = (name, fallback = '') => (process.env[name] ?? fallback).trim();

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

export const fail = (status, code, message) => json({ error: code, message }, status);

export async function readJson(request, maxBytes = 8_000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('Request too large');
  return JSON.parse(text || '{}');
}

// ---------- Supabase: one secret-checked function holds all server-side state ----------
export async function db(action, args) {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL');
  const key = env('SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_PUBLISHABLE_KEY');
  const secret = env('COMMUTE_DB_SECRET');
  if (!url || !key || !secret) throw new Error('Supabase is not configured on the server');
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/broker_map_server`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, action, args }),
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Database answered ${res.status}`);
  return res.json();
}

// ---------- Office identity: ~1 km grid cell, so nearby offices share cache and unlocks ----------
export const officeKey = (lat, lng) => `${lat.toFixed(2)},${lng.toFixed(2)}`;

export function visitorId(request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(`${ip}|${env('COMMUTE_DB_SECRET')}`).digest('hex').slice(0, 32);
}

// ---------- Unlock tokens: signed by the server, never a client-side "paid" flag ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signUnlock(payload) {
  const secret = env('UNLOCK_SECRET');
  if (!secret) throw new Error('UNLOCK_SECRET is not set');
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** The token's payload when it is genuine, unexpired and for this office; otherwise null. */
export function readUnlock(token, key) {
  const secret = env('UNLOCK_SECRET');
  if (!secret || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig || '', 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.k === key && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export function hmacHex(secret, data) {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

// ---------- Razorpay ----------
export function razorpay() {
  const id = env('RAZORPAY_KEY_ID');
  const secret = env('RAZORPAY_KEY_SECRET');
  if (!id || !secret) return null;
  const auth = 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
  const call = async (path, init = {}) => {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Razorpay answered ${res.status}: ${body?.error?.description || ''}`);
    return body;
  };
  return { id, secret, call };
}

export const PRICE_PAISE = () => Number(env('COMMUTE_PRICE_PAISE', '14900')) || 14900;
export const UNLOCK_DAYS = 7;
