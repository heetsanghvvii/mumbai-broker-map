// Marker DOM shared by the Google and preview maps. Styled in style.css.

export function brokerMarkerEl(n, verified = false) {
  const el = document.createElement('div');
  el.className = verified ? 'mk-broker is-verified' : 'mk-broker';
  el.textContent = String(n);
  return el;
}

export function pinMarkerEl(name) {
  const el = document.createElement('div');
  el.className = 'mk-pin';
  const label = document.createElement('span');
  label.className = 'mk-pin-label';
  label.textContent = name;
  const dot = document.createElement('span');
  dot.className = 'mk-pin-dot';
  el.append(label, dot);
  return el;
}
