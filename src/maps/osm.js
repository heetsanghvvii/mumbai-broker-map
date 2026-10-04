// Free map from OpenStreetMap (Leaflet). Used when there is no Google key or today's Google budget is spent.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MUMBAI_CENTER } from '../config.js';
import { FIT_COLORS, LOCALITY_RADIUS_M, brokerMarkerEl, pinMarkerEl } from './markers.js';
import { growRadius, offsetCenter, prefersReducedMotion } from '../geo.js';

export function createOsmMap(el) {
  const map = L.map(el, { zoomControl: false, attributionControl: true, zoomSnap: 0.25 }).setView(
    [MUMBAI_CENTER.lat, MUMBAI_CENTER.lng],
    11,
  );
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'osm-tiles',
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const layer = L.layerGroup().addTo(map); // everything we draw; cleared between views
  let markers = [];
  const icon = (node) => L.divIcon({ html: node, className: 'mk-leaflet', iconSize: null, iconAnchor: [0, 0] });
  const fly = (bounds, pad) =>
    map.flyToBounds(bounds, {
      paddingTopLeft: [pad.left, pad.top],
      paddingBottomRight: [pad.right, pad.bottom],
      maxZoom: 16,
      duration: prefersReducedMotion() ? 0 : 0.8,
    });

  return {
    kind: 'osm',

    clear() {
      layer.clearLayers();
      markers = [];
    },

    showSearch(center, name, radiusM, pad) {
      this.clear();
      L.marker([center.lat, center.lng], { icon: icon(pinMarkerEl(name)), zIndexOffset: 1000 }).addTo(layer);
      const circle = L.circle([center.lat, center.lng], {
        radius: radiusM,
        color: FIT_COLORS.green,
        weight: 2,
        fillColor: FIT_COLORS.green,
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(layer);
      fly(circle.getBounds(), pad);
      growRadius((r) => circle.setRadius(r), radiusM);
    },

    showBrokers(list, onSelect, { fit = false, pad } = {}) {
      markers.forEach((m) => m.remove());
      markers = list.map((b, i) => {
        const node = brokerMarkerEl(i + 1);
        const m = L.marker([b.lat, b.lng], { icon: icon(node), title: b.name }).addTo(layer);
        m.on('click', () => onSelect(b.id));
        m._id = b.id;
        m._node = node;
        return m;
      });
      if (fit && list.length) fly(L.latLngBounds(list.map((b) => [b.lat, b.lng])), pad);
    },

    highlight(id, pan, pad) {
      for (const m of markers) {
        const on = m._id === id;
        m._node.classList.toggle('is-active', on);
        m.setZIndexOffset(on ? 900 : 0);
        if (on && pan) {
          const ll = m.getLatLng();
          const c = offsetCenter({ lat: ll.lat, lng: ll.lng }, map.getZoom(), pad);
          map.panTo([c.lat, c.lng], { animate: !prefersReducedMotion(), duration: 0.5 });
        }
      }
    },

    showCommute(office, localities, onPick, pad) {
      this.clear();
      const pts = [[office.lat, office.lng]];
      for (const l of localities) {
        const c = L.circle([l.lat, l.lng], {
          radius: LOCALITY_RADIUS_M,
          color: FIT_COLORS[l.fit],
          weight: 2,
          fillColor: FIT_COLORS[l.fit],
          fillOpacity: 0.28,
        }).addTo(layer);
        c.bindTooltip(`${l.name}: ${l.best.score} min`, { direction: 'top' });
        c.on('click', () => onPick(l));
        pts.push([l.lat, l.lng]);
      }
      L.marker([office.lat, office.lng], { icon: icon(pinMarkerEl(office.name || 'Office', 'office')), zIndexOffset: 1000 }).addTo(layer);
      fly(L.latLngBounds(pts).pad(0.05), pad);
    },
  };
}
