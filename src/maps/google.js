import { API_KEY, MAP_ID, MUMBAI_BOUNDS, MUMBAI_CENTER } from '../config.js';
import { FIT_COLORS, LOCALITY_RADIUS_M, brokerMarkerEl, pinMarkerEl } from './markers.js';
import { growRadius, offsetCenter } from '../geo.js';

// Google's ToS: nothing returned by Places is stored or cached by the browser code below;
// results live in memory for the current page only.

function loadScript() {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.__mbmInit = () => resolve();
    window.gm_authFailure = () => document.dispatchEvent(new CustomEvent('maps-auth-failure'));
    const s = document.createElement('script');
    const params = new URLSearchParams({ key: API_KEY, v: 'weekly', loading: 'async', callback: '__mbmInit', region: 'IN', language: 'en' });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps could not load. Check your connection.'));
    document.head.appendChild(s);
  });
}

async function libs() {
  await loadScript();
  const g = window.google.maps;
  const [maps, marker, places, core] = await Promise.all([
    g.importLibrary('maps'),
    g.importLibrary('marker'),
    g.importLibrary('places'),
    g.importLibrary('core'),
  ]);
  return { maps, marker, places, core };
}

export async function createGoogleMap(el) {
  const { maps, marker, core } = await libs();
  const { Map, Circle } = maps;
  const { AdvancedMarkerElement } = marker;

  const map = new Map(el, {
    center: MUMBAI_CENTER,
    zoom: 11,
    mapId: MAP_ID,
    colorScheme: core.ColorScheme?.FOLLOW_SYSTEM,
    disableDefaultUI: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
  });

  let drawn = []; // markers and circles of the current view
  let markers = [];
  const add = (x) => (drawn.push(x), x);
  const boundsOf = (pts) => {
    const b = new core.LatLngBounds();
    pts.forEach((p) => b.extend(p));
    return b;
  };

  return {
    kind: 'google',

    clear() {
      for (const x of drawn) {
        if (x.setMap) x.setMap(null);
        else x.map = null;
      }
      drawn = [];
      markers = [];
    },

    showSearch(center, name, radiusM, pad) {
      this.clear();
      add(new AdvancedMarkerElement({ map, position: center, content: pinMarkerEl(name), title: name, zIndex: 1000 }));
      const circle = add(new Circle({
        map, center, radius: radiusM, clickable: false,
        strokeColor: FIT_COLORS.green, strokeOpacity: 0.95, strokeWeight: 2, fillColor: FIT_COLORS.green, fillOpacity: 0.08,
      }));
      map.fitBounds(circle.getBounds(), pad);
      growRadius((r) => circle.setRadius(r), radiusM);
    },

    showBrokers(list, onSelect, { fit = false, pad } = {}) {
      for (const { m } of markers) m.map = null;
      markers = list.map((b, i) => {
        const position = { lat: b.lat, lng: b.lng };
        const m = add(new AdvancedMarkerElement({ map, position, content: brokerMarkerEl(i + 1), title: b.name, gmpClickable: true }));
        m.addEventListener('gmp-click', () => onSelect(b.id));
        return { m, id: b.id, position };
      });
      if (fit && list.length) map.fitBounds(boundsOf(list.map((b) => ({ lat: b.lat, lng: b.lng }))), pad);
    },

    highlight(id, pan, pad) {
      for (const { m, id: mid, position } of markers) {
        const on = mid === id;
        m.content.classList.toggle('is-active', on);
        m.zIndex = on ? 999 : null;
        if (on && pan) map.panTo(offsetCenter(position, map.getZoom(), pad));
      }
    },

    showCommute(office, localities, onPick, pad) {
      this.clear();
      const pts = [{ lat: office.lat, lng: office.lng }];
      for (const l of localities) {
        const c = add(new Circle({
          map, center: { lat: l.lat, lng: l.lng }, radius: LOCALITY_RADIUS_M, clickable: true,
          strokeColor: FIT_COLORS[l.fit], strokeWeight: 2, fillColor: FIT_COLORS[l.fit], fillOpacity: 0.28,
        }));
        c.addListener('click', () => onPick(l));
        pts.push({ lat: l.lat, lng: l.lng });
      }
      add(new AdvancedMarkerElement({
        map, position: pts[0], content: pinMarkerEl(office.name || 'Office', 'office'), title: 'Office', zIndex: 1000,
      }));
      map.fitBounds(boundsOf(pts), pad);
    },
  };
}

/** Google place search (autocomplete), restricted to Mumbai, Thane and Navi Mumbai. */
export async function createGoogleSearch() {
  const { places } = await libs();
  const { AutocompleteSuggestion, AutocompleteSessionToken } = places;
  let token = new AutocompleteSessionToken();
  return {
    async suggest(input) {
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input, sessionToken: token, locationRestriction: MUMBAI_BOUNDS, includedRegionCodes: ['in'], language: 'en-IN', region: 'in',
      });
      return suggestions
        .filter((s) => s.placePrediction)
        .slice(0, 6)
        .map((s) => {
          const p = s.placePrediction;
          return { main: p.mainText?.toString() || p.text.toString(), secondary: p.secondaryText?.toString() || '', _pred: p };
        });
    },
    async resolve(s) {
      const place = s._pred.toPlace();
      // Minimal fields: closes the autocomplete session at the lowest tier.
      await place.fetchFields({ fields: ['location', 'displayName'] });
      token = new AutocompleteSessionToken();
      return { name: place.displayName || s.main, lat: place.location.lat(), lng: place.location.lng() };
    },
  };
}

/** Google Nearby Search for agencies, only used when the directory has too few around a building. */
export async function googleNearby(center, radiusM) {
  const { places } = await libs();
  const { Place, SearchNearbyRankPreference } = places;
  const { places: found } = await Place.searchNearby({
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'googleMapsURI'],
    locationRestriction: { center, radius: radiusM },
    includedTypes: ['real_estate_agency'],
    maxResultCount: 20,
    rankPreference: SearchNearbyRankPreference.DISTANCE,
    language: 'en',
    region: 'in',
  });
  return (found || []).map((p) => ({
    id: p.id,
    name: p.displayName || 'Unnamed agency',
    address: p.formattedAddress || '',
    lat: p.location.lat(),
    lng: p.location.lng(),
    mapsUrl: p.googleMapsURI || `https://www.google.com/maps/place/?q=place_id:${p.id}`,
    rating: null,
    reviews: 0,
    source: 'google',
  }));
}
