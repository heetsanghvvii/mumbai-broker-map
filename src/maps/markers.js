// Marker DOM shared by the Google and OpenStreetMap maps. Styled in style.css.

export function brokerMarkerEl(n) {
  const el = document.createElement('div');
  el.className = 'mk-broker';
  el.textContent = String(n);
  return el;
}

export function pinMarkerEl(name, kind = 'building') {
  const el = document.createElement('div');
  el.className = `mk-pin mk-pin-${kind}`;
  const label = document.createElement('span');
  label.className = 'mk-pin-label';
  label.textContent = name;
  const dot = document.createElement('span');
  dot.className = 'mk-pin-dot';
  el.append(label, dot);
  return el;
}

// Commute fit colours; the map circles and the list dots use the same three.
export const FIT_COLORS = { green: '#2f9e62', yellow: '#d99a00', red: '#d14b4b' };
export const LOCALITY_RADIUS_M = 900;
