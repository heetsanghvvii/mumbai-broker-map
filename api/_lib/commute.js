// Commute Search: which localities fit a commute to an office, using Google Routes traffic estimates.
import localities from '../../data/localities.json' with { type: 'json' };
import { db, env } from './server.js';

export const MODES = ['DRIVE', 'TWO_WHEELER', 'TRANSIT'];
export const MAX_LOCALITIES = 25;

// Google bills each mode on a different SKU; caps are elements per day (IST) per SKU.
// Defaults keep the free preview inside Google's monthly free usage (Pro 5,000, Enterprise 1,000,
// Essentials 10,000) and give paid unlocks a separate, larger allowance.
const SKU = { DRIVE: 'pro', TWO_WHEELER: 'ent', TRANSIT: 'ess' };
const CAPS = {
  free: { pro: 160, ent: 30, ess: 330 },
  paid: { pro: 600, ent: 300, ess: 1000 },
};
const capFor = (tier, mode) =>
  Number(env(`COMMUTE_CAP_${tier.toUpperCase()}_${SKU[mode].toUpperCase()}`)) || CAPS[tier][SKU[mode]];

const toRad = (d) => (d * Math.PI) / 180;
export function km(a, b) {
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Nearest localities that could plausibly fit: straight line ≤ 1 km per 2 minutes of (max + 15). */
export function candidates(office, maxMin) {
  const reach = (maxMin + 15) / 2;
  return localities
    .map((l) => ({ ...l, km: Math.round(km(office, l) * 10) / 10 }))
    .filter((l) => l.km <= reach)
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_LOCALITIES);
}

/** Next Monday–Friday (never today) at HH:MM in India time, as an RFC 3339 UTC timestamp. */
export function nextWeekdayAt(hhmm, now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(d.getTime() + (h * 60 + m) * 60_000 - 5.5 * 3600_000).toISOString();
}

const point = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

async function matrix(mode, origins, destinations, departureTime) {
  const body = {
    origins: origins.map(point),
    destinations: destinations.map(point),
    travelMode: mode,
    departureTime,
    languageCode: 'en-IN',
    regionCode: 'IN',
  };
  if (mode !== 'TRANSIT') body.routingPreference = 'TRAFFIC_AWARE';
  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env('GOOGLE_ROUTES_KEY'),
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) {
    throw new Error(`Routes ${mode} answered ${res.status}: ${data?.error?.message || data?.[0]?.error?.message || ''}`);
  }
  return data;
}

const minutes = (el) =>
  el && el.condition === 'ROUTE_EXISTS' && el.duration ? Math.round(parseInt(el.duration, 10) / 60) : null;

/** Morning (locality → office) and evening (office → locality) minutes for one mode. */
async function timesForMode(mode, office, list, arrive, leave) {
  // Leave home 45 minutes before the office start time.
  const [h, m] = arrive.split(':').map(Number);
  const depart = `${String(Math.floor((h * 60 + m - 45) / 60)).padStart(2, '0')}:${String((h * 60 + m - 45) % 60).padStart(2, '0')}`;
  const [am, pm] = await Promise.all([
    matrix(mode, list, [office], nextWeekdayAt(depart)),
    matrix(mode, [office], list, nextWeekdayAt(leave)),
  ]);
  const morning = Array(list.length).fill(null);
  const evening = Array(list.length).fill(null);
  for (const el of am) morning[el.originIndex ?? 0] = minutes(el);
  for (const el of pm) evening[el.destinationIndex ?? 0] = minutes(el);
  return { morning, evening };
}

/**
 * Times per locality for each requested mode. Each mode is cached on its own (by office cell,
 * mode, timings and locality set) so a later search that adds a mode only pays for that mode.
 */
export async function commuteTimes({ office, cell, list, modes, arrive, leave, tier }) {
  const ttl = Number(env('COMMUTE_CACHE_HOURS', '24')) || 24;
  const setKey = list.map((l) => l.name).join('|');
  const out = {};
  const skipped = [];
  let elements = 0;
  let cachedModes = 0;

  await Promise.all(
    modes.map(async (mode) => {
      const key = `${cell}|${mode}|${arrive}|${leave}|${setKey}`;
      const hit = await db('cache_get', { key, ttl_hours: ttl });
      if (hit) {
        out[mode] = hit;
        cachedModes++;
        return;
      }
      const n = list.length * 2;
      const fits = await db('budget', { kind: `routes_${SKU[mode]}_${tier}`, n, cap: capFor(tier, mode) });
      if (!fits) {
        skipped.push(mode);
        return;
      }
      out[mode] = await timesForMode(mode, office, list, arrive, leave);
      elements += n;
      await db('cache_put', { key, result: out[mode], elements: n });
    }),
  );
  console.log(JSON.stringify({ event: 'commute', cell, tier, modes, elements, cachedModes, skipped }));
  return { times: out, skipped, elements };
}

/** One row per locality: per-mode times, the best mode, and the score (worse of morning/evening). */
export function rank(list, times, maxMin) {
  return list
    .map((l, i) => {
      const byMode = {};
      let best = null;
      // Fixed mode order, so ties always resolve the same way whichever call finished first.
      for (const mode of MODES.filter((m) => times[m])) {
        const t = times[mode];
        const am = t.morning[i];
        const pm = t.evening[i];
        if (am == null || pm == null) continue;
        byMode[mode] = { morning: am, evening: pm };
        const worse = Math.max(am, pm);
        if (!best || worse < best.score) best = { mode, morning: am, evening: pm, score: worse };
      }
      if (!best) return null;
      const fit = best.score <= maxMin ? 'green' : best.score <= maxMin + 15 ? 'yellow' : 'red';
      return { name: l.name, region: l.region, lat: l.lat, lng: l.lng, km: l.km, best, byMode, fit };
    })
    .filter(Boolean)
    .sort((a, b) => a.best.score - b.best.score);
}
