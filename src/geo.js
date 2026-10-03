const R = 6371; // km

export function distanceKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatKm(km) {
  return km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`;
}

/**
 * One Nearby Search returns up to 20 agencies within the widest radius,
 * ranked by distance. Pick the smallest radius that still holds MIN_RESULTS.
 * Same outcome as retrying at 1/2/3 km, at a third of the API cost.
 */
export function pickRadius(items, radiiM, min) {
  for (const r of radiiM) {
    const inside = items.filter((i) => i.distanceKm * 1000 <= r);
    if (inside.length >= min) return { radiusM: r, items: inside };
  }
  const last = radiiM[radiiM.length - 1];
  return { radiusM: last, items: items.filter((i) => i.distanceKm * 1000 <= last) };
}

/** Indian mobile numbers (10 digits starting 6–9) can take WhatsApp; landlines can't. */
export function whatsappNumber(intlPhone) {
  if (!intlPhone) return null;
  let digits = intlPhone.replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  if (digits.length === 11 && digits.startsWith('0')) digits = '91' + digits.slice(1);
  if (digits.length !== 12 || !digits.startsWith('91')) return null;
  return /^[6-9]/.test(digits.slice(2)) ? digits : null;
}
