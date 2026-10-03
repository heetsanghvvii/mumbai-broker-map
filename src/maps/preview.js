// Preview mode: runs when no Google key is configured, so the design and flow can be
// checked without spending API quota. Everything here is invented sample data.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MUMBAI_CENTER } from '../config.js';
import { brokerMarkerEl, pinMarkerEl } from './markers.js';

const BUILDINGS = [
  { name: 'Hiranandani Gardens', area: 'Powai', lat: 19.1176, lng: 72.906 },
  { name: 'Lodha The Park', area: 'Worli', lat: 18.9986, lng: 72.8238 },
  { name: 'Oberoi Splendor', area: 'Jogeshwari East', lat: 19.134, lng: 72.868 },
  { name: 'Kalpataru Aura', area: 'Ghatkopar West', lat: 19.096, lng: 72.905 },
  { name: 'Rustomjee Elements', area: 'Andheri West', lat: 19.129, lng: 72.827 },
  { name: 'Imperial Towers', area: 'Tardeo', lat: 18.9727, lng: 72.8135 },
  { name: 'Raheja Vivarea', area: 'Mahalaxmi', lat: 18.983, lng: 72.822 },
  { name: 'Hiranandani Estate', area: 'Thane West', lat: 19.257, lng: 72.975 },
];

const NAMES = [
  'Sample Realty One', 'Sample Homes & Estates', 'Sample Property Point', 'Sample Housing Consultants',
  'Sample Estate Agency', 'Sample Realtors', 'Sample Property Hub', 'Sample Nest Realty',
  'Sample Key Estates', 'Sample Doorway Homes', 'Sample Society Brokers', 'Sample Tower Realty',
];

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function sampleBrokers(center) {
  const rnd = seeded(Math.round(center.lat * 1e4 + center.lng * 1e4));
  const count = 4 + Math.floor(rnd() * 9);
  return Array.from({ length: count }, (_, i) => {
    const km = 0.12 + rnd() * 2.6;
    const angle = rnd() * Math.PI * 2;
    const lat = center.lat + (km / 111) * Math.cos(angle);
    const lng = center.lng + (km / (111 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle);
    return {
      id: `sample-${i}`,
      name: NAMES[i % NAMES.length],
      address: 'Sample address, Mumbai',
      lat,
      lng,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(5)},${lng.toFixed(5)}`,
      _rating: rnd() > 0.3 ? Math.round((3.6 + rnd() * 1.4) * 10) / 10 : null,
      _count: Math.floor(rnd() * 120),
      _mobile: rnd() > 0.35,
    };
  });
}

export async function createPreviewProvider(el) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(
    [MUMBAI_CENTER.lat, MUMBAI_CENTER.lng],
    11,
  );
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'preview-tiles',
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  let pin = null;
  let circle = null;
  let markers = [];
  let lastBrokers = [];

  const icon = (node, anchor) =>
    L.divIcon({ html: node, className: 'mk-leaflet', iconSize: null, iconAnchor: anchor });

  return {
    kind: 'preview',

    async suggest(input) {
      const q = input.toLowerCase();
      return BUILDINGS.filter((b) => (b.name + ' ' + b.area).toLowerCase().includes(q)).map((b) => ({
        id: b.name,
        main: b.name,
        secondary: `${b.area}, Mumbai`,
        _b: b,
      }));
    },

    async resolve(s) {
      return { name: s._b.name, lat: s._b.lat, lng: s._b.lng };
    },

    async nearby(center) {
      await new Promise((r) => setTimeout(r, 350));
      lastBrokers = sampleBrokers(center);
      return lastBrokers;
    },

    async details(id) {
      await new Promise((r) => setTimeout(r, 300));
      const b = lastBrokers.find((x) => x.id === id);
      return {
        phone: b?._mobile ? '00000 00000' : null,
        intlPhone: null,
        rating: b?._rating ?? null,
        ratingCount: b?._count ?? 0,
        sample: true,
      };
    },

    showSearch(center, name, radiusM) {
      pin?.remove();
      circle?.remove();
      pin = L.marker([center.lat, center.lng], { icon: icon(pinMarkerEl(name), [0, 0]), zIndexOffset: 1000 }).addTo(map);
      circle = L.circle([center.lat, center.lng], {
        radius: radiusM,
        color: '#f0a20b',
        weight: 1.5,
        fillColor: '#f0a20b',
        fillOpacity: 0.07,
        interactive: false,
      }).addTo(map);
      map.fitBounds(circle.getBounds(), { padding: [24, 24] });
    },

    showBrokers(list, onSelect) {
      markers.forEach((m) => m.remove());
      markers = list.map((b, i) => {
        const node = brokerMarkerEl(i + 1);
        const m = L.marker([b.lat, b.lng], { icon: icon(node, [0, 0]), title: b.name }).addTo(map);
        m.on('click', () => onSelect(b.id, 'map'));
        m._id = b.id;
        m._node = node;
        return m;
      });
    },

    highlight(id, pan) {
      for (const m of markers) {
        const on = m._id === id;
        m._node.classList.toggle('is-active', on);
        m.setZIndexOffset(on ? 900 : 0);
        if (on && pan) map.panTo(m.getLatLng());
      }
    },
  };
}
