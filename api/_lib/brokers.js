// Broker locations from the public directory, used to count brokers around each locality.
import { env } from './server.js';
import { km } from './commute.js';

let cache = { at: 0, points: [] };

async function points() {
  if (Date.now() - cache.at < 3600_000 && cache.points.length) return cache.points;
  const url = (env('SUPABASE_URL') || env('VITE_SUPABASE_URL')).replace(/\/$/, '');
  const key = env('SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) return [];
  const all = [];
  // PostgREST returns at most 1,000 rows per request; page through.
  for (let from = 0; from < 20_000; from += 1000) {
    const res = await fetch(`${url}/rest/v1/brokers?select=lat,lng&lat=not.is.null`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) break;
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  cache = { at: Date.now(), points: all };
  return all;
}

/** Number of brokers within `radiusKm` of each locality centre. Zero counts if the directory is unreachable. */
export async function brokerCounts(list, radiusKm = 1.5) {
  const pts = await points().catch(() => []);
  return list.map((l) => pts.reduce((n, p) => n + (km(l, p) <= radiusKm ? 1 : 0), 0));
}
