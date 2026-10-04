// POST /api/commute — which Mumbai localities fit a commute to an office.
// Free: the top 3 localities only. Unlocked (one payment, 7 days, this office): everything.
import { PRICE_PAISE, db, env, fail, json, officeKey, readJson, readUnlock, visitorId } from './_lib/server.js';
import { MODES, candidates, commuteTimes, rank } from './_lib/commute.js';
import { brokerCounts } from './_lib/brokers.js';

const FREE_PER_DAY = 5;
const FREE_TOP = 3;
// Mumbai, Thane and Navi Mumbai.
const BOUNDS = { south: 18.85, west: 72.75, north: 19.35, east: 73.15 };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** GET /api/commute — whether commute search and payments are switched on (no details). */
export async function GET() {
  return json({
    ready: !!env('GOOGLE_ROUTES_KEY'),
    // Razorpay when its keys are set; otherwise UPI to the owner's UPI ID, approved by hand.
    payments: env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET') ? 'razorpay' : env('UPI_ID') ? 'upi' : false,
    price: PRICE_PAISE() / 100,
  });
}

export async function POST(request) {
  if (!env('GOOGLE_ROUTES_KEY')) {
    return fail(503, 'not_configured', 'Commute search is being set up. Please check back soon.');
  }

  let input;
  try {
    input = await readJson(request);
  } catch {
    return fail(400, 'bad_request', 'Send the office, time and travel modes as JSON.');
  }
  const lat = Number(input?.office?.lat);
  const lng = Number(input?.office?.lng);
  const maxMin = Number(input?.maxMin);
  const modes = [...new Set(Array.isArray(input?.modes) ? input.modes : [])].filter((m) => MODES.includes(m));
  const arrive = TIME.test(input?.arrive) ? input.arrive : '09:30';
  const leave = TIME.test(input?.leave) ? input.leave : '18:30';

  if (!(lat >= BOUNDS.south && lat <= BOUNDS.north && lng >= BOUNDS.west && lng <= BOUNDS.east)) {
    return fail(400, 'outside_area', 'Pick an office in Mumbai, Thane or Navi Mumbai.');
  }
  if (!(maxMin >= 15 && maxMin <= 90 && maxMin % 5 === 0)) {
    return fail(400, 'bad_time', 'Travel time must be 15 to 90 minutes, in steps of 5.');
  }
  if (!modes.length) return fail(400, 'no_modes', 'Choose at least one way to travel.');
  if (arrive < '06:00' || arrive > '12:00' || leave < '15:00' || leave > '23:00') {
    return fail(400, 'bad_hours', 'Office start must be 6 AM to 12 PM, and end 3 PM to 11 PM.');
  }

  const office = { lat, lng };
  const cell = officeKey(lat, lng);
  const unlocked = !!readUnlock(input.unlock, cell);

  try {
    if (!unlocked) {
      const hits = await db('rate_hit', { who: visitorId(request) });
      if (hits > FREE_PER_DAY) {
        return fail(429, 'daily_limit', `Free commute searches are limited to ${FREE_PER_DAY} a day. Unlock this office or try again tomorrow.`);
      }
    }

    const list = candidates(office, maxMin);
    if (!list.length) return json({ officeKey: cell, unlocked, maxMin, localities: [], total: 0, skipped: [] });

    const { times, skipped } = await commuteTimes({
      office, cell, list, modes, arrive, leave, tier: unlocked ? 'paid' : 'free',
    });
    if (!Object.keys(times).length) {
      return fail(503, 'busy', "Commute search has hit today's limit. Please try again tomorrow.");
    }

    const ranked = rank(list, times, maxMin);
    const counts = await brokerCounts(ranked);
    ranked.forEach((r, i) => (r.brokers = counts[i]));

    if (unlocked) {
      return json({ officeKey: cell, unlocked, maxMin, localities: ranked, total: ranked.length, skipped });
    }
    // Free preview: names and times of the top 3 only. No positions or per-mode detail for the rest.
    const top = ranked.slice(0, FREE_TOP).map(({ name, region, lat, lng, best, fit, brokers }) => ({
      name, region, lat, lng, best, fit, brokers,
    }));
    return json({ officeKey: cell, unlocked, maxMin, localities: top, total: ranked.length, skipped });
  } catch (err) {
    console.error('commute failed', err);
    return fail(502, 'upstream', 'Travel times could not be calculated right now. Please try again in a minute.');
  }
}
