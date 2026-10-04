// The broker directory and the daily Google budget, both in Supabase.
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';

const ready = () => !!(SUPABASE_URL && SUPABASE_KEY);
const headers = () => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` });

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
    signal: AbortSignal.timeout(init.timeout || 6000),
  });
  if (!res.ok) throw new Error(`Directory answered ${res.status}`);
  return res.json();
}

/**
 * Ask for one unit of today's Google budget ('map_load', 'search' or 'nearby').
 * Anything but a clear yes (cap reached, Supabase slow or down) means "use the free fallback",
 * so the site can never run up a Google bill past the cap.
 */
export async function takeBudget(kind) {
  if (!ready()) return true; // no Supabase configured: rely on Google Cloud quotas instead
  try {
    return (await rest('rpc/broker_map_take', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
      timeout: 2500,
    })) === true;
  } catch {
    return false;
  }
}

const FIELDS = 'place_id,area,name,address,phone,whatsapp,rating,reviews,website,lat,lng';

const toBroker = (r) => ({
  id: r.place_id,
  name: r.name || 'Unnamed agency',
  address: r.address || '',
  area: r.area,
  phone: r.phone,
  whatsapp: r.whatsapp,
  rating: r.rating == null ? null : Number(r.rating),
  reviews: r.reviews || 0,
  website: r.website,
  lat: r.lat,
  lng: r.lng,
  mapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(r.place_id)}`,
  source: 'directory',
});

/** Directory brokers inside the square around `center` that contains a circle of `radiusM`. */
export async function brokersNear(center, radiusM) {
  if (!ready()) return [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const q =
    `brokers?select=${FIELDS}` +
    `&lat=gte.${(center.lat - dLat).toFixed(6)}&lat=lte.${(center.lat + dLat).toFixed(6)}` +
    `&lng=gte.${(center.lng - dLng).toFixed(6)}&lng=lte.${(center.lng + dLng).toFixed(6)}&limit=500`;
  return (await rest(q)).map(toBroker);
}

/** Every directory broker in one area, most-reviewed first. */
export async function brokersInArea(area) {
  if (!ready()) return [];
  const q = `brokers?select=${FIELDS}&area=eq.${encodeURIComponent(area)}&lat=not.is.null&order=reviews.desc&limit=500`;
  return (await rest(q)).map(toBroker);
}

/** Areas with broker counts, A to Z. */
export async function listAreas() {
  if (!ready()) return [];
  return rest('broker_areas?select=area,brokers,lat,lng&order=area.asc');
}

export const directoryReady = ready;
