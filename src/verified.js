import { SUPABASE_KEY, SUPABASE_URL } from './config.js';

/**
 * Brokers who claimed their profile, keyed by Google place ID.
 * Only place IDs and the broker's own details live in Supabase; names, addresses and
 * ratings always come live from Google. Resolves an empty Map when Supabase isn't set up
 * or doesn't answer, so search never waits on it or breaks because of it.
 */
export async function verifiedBrokers(placeIds) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !placeIds.length) return new Map();
  const ids = placeIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
  const url =
    `${SUPABASE_URL}/rest/v1/brokers?select=place_id,rera_number,broker_whatsapp` +
    `&verified=is.true&place_id=in.(${encodeURIComponent(ids)})`;
  try {
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`Supabase answered ${res.status}`);
    const rows = await res.json();
    return new Map(rows.map((r) => [r.place_id, { rera: r.rera_number || '', whatsapp: r.broker_whatsapp || '' }]));
  } catch (err) {
    console.warn('Verified brokers unavailable:', err.message);
    return new Map();
  }
}
