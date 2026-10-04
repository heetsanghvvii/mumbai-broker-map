// Free place search from OpenStreetMap (Photon), used when Google isn't available or today's budget is spent.
import { MUMBAI_BOUNDS as B } from '../config.js';

const BBOX = `${B.west},${B.south},${B.east},${B.north}`;

export function createPhotonSearch() {
  return {
    async suggest(input) {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(input)}&limit=6&lang=en&bbox=${BBOX}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`Photon answered ${res.status}`);
      const { features = [] } = await res.json();
      return features.map((f) => {
        const p = f.properties || {};
        const main = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.district || 'Unnamed place';
        const secondary = [p.locality || p.district, p.city || p.county].filter((x) => x && x !== main).join(', ');
        const [lng, lat] = f.geometry.coordinates;
        return { main, secondary, _pos: { lat, lng } };
      });
    },
    async resolve(s) {
      return { name: s.main, lat: s._pos.lat, lng: s._pos.lng };
    },
  };
}
