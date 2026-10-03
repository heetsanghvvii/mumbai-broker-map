import { API_KEY, MAP_ID, MUMBAI_BOUNDS, MUMBAI_CENTER } from '../config.js';
import { brokerMarkerEl, pinMarkerEl } from './markers.js';
import { growRadius, offsetCenter } from '../geo.js';

// Google's ToS: nothing returned by Places is stored or cached beyond place IDs.
// Everything below lives in memory for the current page only.

function loadScript() {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.__mbmInit = () => resolve();
    window.gm_authFailure = () => {
      document.dispatchEvent(new CustomEvent('maps-auth-failure'));
    };
    const s = document.createElement('script');
    const params = new URLSearchParams({
      key: API_KEY,
      v: 'weekly',
      loading: 'async',
      callback: '__mbmInit',
      region: 'IN',
      language: 'en',
    });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps could not load. Check your connection.'));
    document.head.appendChild(s);
  });
}

export async function createGoogleProvider(el) {
  await loadScript();
  const g = window.google.maps;
  const [{ Map, Circle }, { AdvancedMarkerElement }, places, core] = await Promise.all([
    g.importLibrary('maps'),
    g.importLibrary('marker'),
    g.importLibrary('places'),
    g.importLibrary('core'),
  ]);
  const { AutocompleteSuggestion, AutocompleteSessionToken, Place, SearchNearbyRankPreference } = places;

  const map = new Map(el, {
    center: MUMBAI_CENTER,
    zoom: 11,
    mapId: MAP_ID,
    colorScheme: core.ColorScheme?.FOLLOW_SYSTEM,
    disableDefaultUI: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
  });

  let token = new AutocompleteSessionToken();
  let pin = null;
  let circle = null;
  let markers = [];

  return {
    kind: 'google',

    async suggest(input) {
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: token,
        locationRestriction: MUMBAI_BOUNDS,
        includedRegionCodes: ['in'],
        language: 'en-IN',
        region: 'in',
      });
      return suggestions
        .filter((s) => s.placePrediction)
        .slice(0, 6)
        .map((s) => {
          const p = s.placePrediction;
          return {
            id: p.placeId,
            main: p.mainText?.toString() || p.text.toString(),
            secondary: p.secondaryText?.toString() || '',
            _pred: p,
          };
        });
    },

    async resolve(suggestion) {
      const place = suggestion._pred.toPlace();
      // Minimal fields: closes the autocomplete session at the lowest tier.
      await place.fetchFields({ fields: ['location', 'displayName'] });
      token = new AutocompleteSessionToken();
      return {
        name: place.displayName || suggestion.main,
        lat: place.location.lat(),
        lng: place.location.lng(),
      };
    },

    async nearby(center, radiusM) {
      // Pro-tier fields only. Phone and rating are Enterprise-tier, so they load per card on demand.
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
      }));
    },

    async details(id) {
      const p = new Place({ id });
      await p.fetchFields({
        fields: ['nationalPhoneNumber', 'internationalPhoneNumber', 'rating', 'userRatingCount'],
      });
      return {
        phone: p.nationalPhoneNumber || null,
        intlPhone: p.internationalPhoneNumber || null,
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? 0,
      };
    },

    showSearch(center, name, radiusM, pad) {
      if (pin) pin.map = null;
      pin = new AdvancedMarkerElement({ map, position: center, content: pinMarkerEl(name), title: name, zIndex: 1000 });
      if (!circle) {
        circle = new Circle({
          map,
          clickable: false,
          strokeColor: '#efa516',
          strokeOpacity: 0.95,
          strokeWeight: 2,
          fillColor: '#efa516',
          fillOpacity: 0.08,
        });
      }
      circle.setCenter(center);
      circle.setRadius(radiusM);
      map.fitBounds(circle.getBounds(), pad);
      growRadius((r) => circle.setRadius(r), radiusM);
    },

    refit(pad) {
      if (circle) map.fitBounds(circle.getBounds(), pad);
    },

    showBrokers(list, onSelect) {
      markers.forEach((m) => (m.map = null));
      markers = list.map((b, i) => {
        const content = brokerMarkerEl(i + 1);
        const m = new AdvancedMarkerElement({ map, position: { lat: b.lat, lng: b.lng }, content, title: b.name, gmpClickable: true });
        m.addListener('click', () => onSelect(b.id, 'map'));
        m._id = b.id;
        return m;
      });
    },

    highlight(id, pan, pad) {
      for (const m of markers) {
        const on = m._id === id;
        m.content.classList.toggle('is-active', on);
        m.zIndex = on ? 999 : null;
        if (on && pan) {
          const p = m.position;
          const pos = { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng };
          map.panTo(offsetCenter(pos, map.getZoom(), pad));
        }
      }
    },
  };
}
