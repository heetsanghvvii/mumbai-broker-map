import './style.css';
import { API_KEY, COMMUTE_MODES, MIN_RESULTS, RADII_M, TRY_QUERIES } from './config.js';
import { distanceKm, formatDistance, pickRadius, prefersReducedMotion } from './geo.js';
import { brokersInArea, brokersNear, directoryReady, listAreas, takeBudget } from './data.js';
import { createPhotonSearch } from './maps/photon.js';
import { FIT_COLORS } from './maps/markers.js';
import { buyUnlock, buyWithUpi, checkPendingUpi, fetchCommute, officeKeyOf, savedUnlock } from './pay.js';

const $ = (id) => document.getElementById(id);
const input = $('search-input');
const list = $('suggestions');
const searchBox = $('search');
const clearBtn = $('clear');
const sheet = $('sheet');
const sheetBody = $('sheet-body');
const summaryEl = $('summary');
const resultsEl = $('results');
const introEl = $('intro');

const desktop = matchMedia('(min-width: 900px)');

let map = null; // Google or OpenStreetMap, same interface
let tab = 'building';
let current = null; // the broker list on screen
let suggestions = [];
let activeIndex = -1;
let suggestSeq = 0;

// ---------- boot ----------

async function boot() {
  renderPopular();
  renderModes();
  loadAreas();
  checkPendingUpi().catch(() => {}); // UPI payments approved since the last visit unlock now
  map = await createMap();
  const q = new URLSearchParams(location.search).get('q');
  const area = new URLSearchParams(location.search).get('area');
  if (q) runQuery(q);
  else if (area) showArea(area);
}

/** Google when there's a key and today's map budget allows it; OpenStreetMap otherwise. */
async function createMap() {
  if (API_KEY && (await takeBudget('map_load'))) {
    try {
      const { createGoogleMap } = await import('./maps/google.js');
      return await createGoogleMap($('map'));
    } catch (err) {
      console.error(err);
    }
  }
  $('osm-note').hidden = false;
  const { createOsmMap } = await import('./maps/osm.js');
  return createOsmMap($('map'));
}

document.addEventListener('maps-auth-failure', () => {
  showError('The map key was rejected. If you run this site, check the key in Google Cloud.');
});

function showError(text) {
  summaryEl.hidden = false;
  summaryEl.className = 'summary is-error';
  summaryEl.textContent = text;
}

function renderPopular() {
  const row = $('popular');
  for (const [label, q] of TRY_QUERIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.addEventListener('click', () => runQuery(q));
    row.append(b);
  }
}

async function loadAreas() {
  if (!directoryReady()) return;
  try {
    const areas = await listAreas();
    const sel = $('area-select');
    for (const a of areas) sel.add(new Option(`${a.area} (${a.brokers})`, a.area));
    $('area-pick').hidden = !areas.length;
    sel.addEventListener('change', () => sel.value && showArea(sel.value));
  } catch (err) {
    console.warn('Areas unavailable:', err.message);
  }
}

async function runQuery(q) {
  setTab('building');
  input.value = q;
  syncClear();
  if (await fetchSuggestions(q)) choose(0);
}

// ---------- tabs ----------

$('tab-building').addEventListener('click', () => setTab('building'));
$('tab-commute').addEventListener('click', () => setTab('commute'));

function setTab(next) {
  if (tab === next) return;
  tab = next;
  $('tab-building').setAttribute('aria-selected', String(tab === 'building'));
  $('tab-commute').setAttribute('aria-selected', String(tab === 'commute'));
  $('view-building').hidden = tab !== 'building';
  $('view-commute').hidden = tab !== 'commute';
  input.placeholder = tab === 'building' ? 'Search a building or society' : 'Where is your office?';
  input.setAttribute('aria-label', tab === 'building' ? 'Search a building in Mumbai' : 'Search your office location');
  input.value = tab === 'commute' && commute.office ? commute.office.name : '';
  syncClear();
  closeList();
  suggestions = [];
  setMapLock(false);
  map?.clear();
  if (tab === 'commute') checkCommuteReady();
  if (tab === 'commute' && commute.result) drawCommute();
  if (tab === 'building' && current) redrawBrokers();
  sheetBody.scrollTop = 0;
}

// ---------- map padding: keep pins clear of the panel / sheet ----------

function mapPadding() {
  const top = document.querySelector('.top').getBoundingClientRect().bottom + 16;
  if (desktop.matches) {
    const r = sheet.getBoundingClientRect();
    return { top: 24, left: r.right + 24, right: 24, bottom: 24 };
  }
  // Use where the sheet is heading, not where it is mid-slide.
  const visible = sheet.offsetHeight - sheetOffsets()[sheetState];
  return { top, left: 20, right: 20, bottom: visible + 16 };
}

// ---------- place search: Google within budget, OpenStreetMap otherwise ----------

let google = null; // the Google search, once loaded
let sessionUsesGoogle = null; // decided once per search session, so one session = one budget unit
const photon = createPhotonSearch();

async function searcher() {
  if (map?.kind !== 'google') return photon;
  if (sessionUsesGoogle === null) sessionUsesGoogle = await takeBudget('search');
  if (!sessionUsesGoogle) return photon;
  if (!google) {
    const { createGoogleSearch } = await import('./maps/google.js');
    google = await createGoogleSearch();
  }
  return google;
}

let debounce;
input.addEventListener('input', () => {
  syncClear();
  clearTimeout(debounce);
  const q = input.value.trim();
  if (q.length < 2) return closeList();
  debounce = setTimeout(() => fetchSuggestions(q), 220);
});

input.addEventListener('keydown', (e) => {
  if (list.hidden || !suggestions.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggestions.length;
    activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    paintActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(Math.max(activeIndex, 0));
  } else if (e.key === 'Escape') {
    closeList();
  }
});

input.addEventListener('focus', () => {
  if (suggestions.length && input.value.trim().length >= 2) openList();
});
document.addEventListener('pointerdown', (e) => !searchBox.contains(e.target) && closeList());

clearBtn.addEventListener('click', () => {
  input.value = '';
  syncClear();
  closeList();
  input.focus();
});

function syncClear() {
  clearBtn.hidden = !input.value;
}

/** Resolves true when fresh suggestions arrived and at least one matched. */
async function fetchSuggestions(q) {
  if (!map) return false;
  const seq = ++suggestSeq;
  try {
    const s = await searcher();
    const res = await s.suggest(q);
    if (seq !== suggestSeq) return false;
    suggestions = res.map((r) => ({ ...r, _by: s }));
    activeIndex = -1;
    renderList(q);
    return res.length > 0;
  } catch (err) {
    console.error(err);
    if (seq === suggestSeq) showError('Suggestions didn’t load. Check your connection and type again.');
    return false;
  }
}

function renderList(q) {
  list.replaceChildren();
  if (!suggestions.length) {
    const li = document.createElement('li');
    li.className = 'sugg-empty';
    li.textContent = `Nothing in Mumbai matches “${q}”. Try the full name or add the area.`;
    list.append(li);
  }
  suggestions.forEach((s, i) => {
    const li = document.createElement('li');
    li.id = `sugg-${i}`;
    li.setAttribute('role', 'option');
    li.className = 'sugg';
    const main = document.createElement('span');
    main.className = 'sugg-main';
    main.textContent = s.main;
    const sec = document.createElement('span');
    sec.className = 'sugg-sec';
    sec.textContent = s.secondary;
    li.append(main, sec);
    li.addEventListener('pointerdown', (e) => e.preventDefault());
    li.addEventListener('click', () => choose(i));
    list.append(li);
  });
  openList();
}

function paintActive() {
  [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === activeIndex)));
  if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `sugg-${activeIndex}`);
  else input.removeAttribute('aria-activedescendant');
}

function openList() {
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
function closeList() {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
}

let searchSeq = 0;

async function choose(i) {
  const s = suggestions[i];
  if (!s) return;
  closeList();
  input.value = s.main;
  syncClear();
  input.blur();
  let place;
  try {
    place = await s._by.resolve(s);
  } catch (err) {
    console.error(err);
    return showError('That place could not be found. Pick it again.');
  } finally {
    sessionUsesGoogle = null; // the next search is a new session
  }
  if (tab === 'commute') setOffice(place);
  else showBrokersAround(place);
}

// ---------- broker lists: around a building, in an area, or around a commute locality ----------

function startList(label) {
  introEl.hidden = true;
  summaryEl.hidden = false;
  summaryEl.className = 'summary';
  summaryEl.innerHTML = '<p class="summary-line">Looking around <b></b>…</p>';
  summaryEl.querySelector('b').textContent = label;
  resultsEl.replaceChildren(...skeletons(4));
  snapSheet('half');
}

async function showBrokersAround(place, { fromCommute = false } = {}) {
  const seq = ++searchSeq;
  setTab('building');
  $('back-commute').hidden = !fromCommute;
  startList(place.name);
  const center = { lat: place.lat, lng: place.lng };
  const maxR = RADII_M[RADII_M.length - 1];
  try {
    let found = await brokersNear(center, maxR).catch((err) => (console.warn(err.message), []));
    if (seq !== searchSeq) return;
    const within = (b) => distanceKm(center, b) * 1000 <= maxR;
    // Directory thin here: top up from Google Nearby Search if today's budget allows.
    if (found.filter(within).length < MIN_RESULTS && map.kind === 'google' && (await takeBudget('nearby'))) {
      const { googleNearby } = await import('./maps/google.js');
      const extra = await googleNearby(center, maxR).catch(() => []);
      const ids = new Set(found.map((b) => b.id));
      found = found.concat(extra.filter((b) => !ids.has(b.id)));
    }
    if (seq !== searchSeq) return;
    const sorted = found
      .map((b) => ({ ...b, distanceKm: distanceKm(center, b) }))
      .filter((b) => b.distanceKm * 1000 <= maxR)
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const { radiusM, items } = pickRadius(sorted, RADII_M, MIN_RESULTS);
    current = { kind: 'around', place, center, radiusM, brokers: items, openId: null };
    map.showSearch(center, place.name, radiusM, mapPadding());
    map.showBrokers(items, (id) => select(id, 'map'));
    renderSummary();
    resultsEl.replaceChildren(...items.map(row));
    sheetBody.scrollTop = 0;
    if (!fromCommute) setUrl({ q: place.name });
  } catch (err) {
    console.error(err);
    if (seq !== searchSeq) return;
    resultsEl.replaceChildren();
    showError('The search didn’t go through. Try again in a moment.');
  }
}

async function showArea(area) {
  const seq = ++searchSeq;
  setTab('building');
  $('back-commute').hidden = true;
  startList(area);
  try {
    const items = await brokersInArea(area);
    if (seq !== searchSeq) return;
    current = { kind: 'area', place: { name: area }, brokers: items, openId: null };
    redrawBrokers(true);
    renderSummary();
    resultsEl.replaceChildren(...items.map(row));
    sheetBody.scrollTop = 0;
    setUrl({ area });
  } catch (err) {
    console.error(err);
    if (seq !== searchSeq) return;
    resultsEl.replaceChildren();
    showError('Brokers for this area didn’t load. Try again in a moment.');
  }
}

function redrawBrokers(fit = false) {
  if (!current) return;
  if (current.kind === 'around') map.showSearch(current.center, current.place.name, current.radiusM, mapPadding());
  else map.clear();
  map.showBrokers(current.brokers, (id) => select(id, 'map'), { fit: fit || current.kind === 'area', pad: mapPadding() });
}

function setUrl(params) {
  const url = new URL(location.href);
  url.search = '';
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  history.replaceState(null, '', url);
}

function renderSummary() {
  const { brokers, radiusM, place, kind } = current;
  summaryEl.className = 'summary';
  summaryEl.innerHTML = '';
  const line = document.createElement('p');
  line.className = 'summary-line';
  const name = document.createElement('b');
  name.textContent = place.name;

  if (kind === 'area') {
    const count = Object.assign(document.createElement('span'), { className: 'summary-count', textContent: brokers.length });
    line.append(count, ` ${brokers.length === 1 ? 'broker' : 'brokers'} in `, name);
    summaryEl.append(line, Object.assign(document.createElement('p'), { className: 'summary-sub', textContent: 'Most-reviewed first.' }));
    return;
  }

  const km = radiusM / 1000;
  if (!brokers.length) {
    line.append(`No brokers found within ${km} km of `, name, '.');
    summaryEl.append(line);
    return;
  }
  const count = Object.assign(document.createElement('span'), { className: 'summary-count', textContent: brokers.length });
  const ring = Object.assign(document.createElement('span'), { className: 'radius', textContent: `${km} km` });
  line.append(count, ` ${brokers.length === 1 ? 'broker' : 'brokers'} within `, ring, ' of ', name);
  summaryEl.append(line);
  if (radiusM > RADII_M[0]) {
    summaryEl.append(Object.assign(document.createElement('p'), {
      className: 'summary-sub',
      textContent: `Fewer than ${MIN_RESULTS} within 1 km, so the circle grew to ${km} km.`,
    }));
  }
}

function skeletons(n) {
  return Array.from({ length: n }, () => {
    const li = document.createElement('li');
    li.className = 'row is-skeleton';
    li.innerHTML = '<span class="sk sk-num"></span><span class="sk-lines"><span class="sk"></span><span class="sk"></span></span>';
    return li;
  });
}

$('back-commute').addEventListener('click', () => setTab('commute'));

// ---------- broker rows ----------

const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 1.8 2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8L6 11.8l-4.3-4 5.8-.7z"/></svg>';
const WA_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5zm5.3 13.3c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 .9c.3.1.5.2.5.3.1.1.1.7-.1 1.4z"/></svg>';

function row(b, i) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.id = b.id;
  li.innerHTML = `
    <button type="button" class="row-main" aria-expanded="false">
      <span class="row-num" aria-hidden="true">${i + 1}</span>
      <span class="row-text">
        <span class="row-name"></span>
        <span class="row-rating"></span>
        <span class="row-addr"></span>
      </span>
      <span class="row-dist"></span>
    </button>
    <div class="row-more" hidden>
      <p class="row-phone" hidden></p>
      <div class="row-actions"></div>
    </div>`;
  li.querySelector('.row-name').textContent = b.name;
  li.querySelector('.row-addr').textContent = b.address;
  li.querySelector('.row-dist').textContent = b.distanceKm == null ? '' : formatDistance(b.distanceKm);

  const rating = li.querySelector('.row-rating');
  if (b.rating != null) {
    rating.innerHTML = STAR;
    rating.append(` ${b.rating.toFixed(1)}`, Object.assign(document.createElement('span'), {
      className: 'meta-muted',
      textContent: ` · ${b.reviews} ${b.reviews === 1 ? 'review' : 'reviews'}`,
    }));
  } else {
    rating.className = 'row-rating meta-muted';
    rating.textContent = b.source === 'google' ? 'Rating on Google Maps' : 'No reviews yet';
  }

  if (b.phone) {
    const p = li.querySelector('.row-phone');
    p.hidden = false;
    p.textContent = b.phone;
  }

  const actions = li.querySelector('.row-actions');
  const placeName = current?.place?.name || 'your area';
  if (b.whatsapp) {
    const text = `Hi, I found you on Mumbai Broker Map. I'm looking for a home near ${placeName}.`;
    const wa = linkBtn('WhatsApp', 'btn btn-wa', `https://wa.me/${b.whatsapp}?text=${encodeURIComponent(text)}`);
    wa.insertAdjacentHTML('afterbegin', WA_ICON);
    actions.append(wa);
  }
  if (b.phone) actions.append(linkBtn('Call', 'btn btn-secondary', `tel:${b.phone.replace(/[^\d+]/g, '')}`));
  actions.append(linkBtn(b.source === 'google' ? 'Details on Google Maps' : 'Google Maps', 'btn btn-quiet', b.mapsUrl));
  const rera = linkBtn('Check on MahaRERA', 'btn btn-quiet', 'https://maharera.maharashtra.gov.in');
  rera.title = 'Copies the broker’s name so you can paste it into MahaRERA’s agent search';
  rera.addEventListener('click', () => navigator.clipboard?.writeText(b.name).catch(() => {}));
  actions.append(rera);

  li.querySelector('.row-main').addEventListener('click', () => select(current.openId === b.id ? null : b.id, 'list'));
  return li;
}

function linkBtn(label, cls, href) {
  const a = document.createElement('a');
  a.className = cls;
  a.textContent = label;
  a.href = href;
  if (href.startsWith('http')) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  return a;
}

function select(id, from) {
  if (!current) return;
  current.openId = id;
  for (const el of resultsEl.children) {
    const on = el.dataset.id === id;
    el.classList.toggle('is-open', on);
    el.querySelector('.row-main')?.setAttribute('aria-expanded', String(on));
    const more = el.querySelector('.row-more');
    if (more) more.hidden = !on;
  }
  const target = from === 'map' ? sheetState === 'peek' && 'half' : sheetState === 'full' && 'half';
  // If the sheet moves, the pan waits for it to settle (see transitionend) so the padding is right.
  if (!(id && target && snapSheet(target))) map.highlight(id, !!id, mapPadding());
  if (id && from === 'map') {
    resultsEl
      .querySelector(`[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }
}

// ---------- commute search ----------

const commute = { office: null, result: null, unlock: null };
const timeLabel = (v) => {
  const [h, m] = v.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const MODE_LABEL = Object.fromEntries(COMMUTE_MODES);

function renderModes() {
  const row = $('mode-row');
  for (const [value, label] of COMMUTE_MODES) {
    const id = `mode-${value}`;
    const wrap = document.createElement('label');
    wrap.className = 'mode';
    wrap.htmlFor = id;
    wrap.innerHTML = `<input type="checkbox" id="${id}" value="${value}" checked /><span></span>`;
    wrap.querySelector('span').textContent = label;
    row.append(wrap);
  }
}

$('max-time').addEventListener('input', (e) => ($('max-time-out').textContent = `${e.target.value} min`));
for (const id of ['arrive', 'leave']) {
  $(id).addEventListener('change', () => {
    $('hours-out').textContent = `${timeLabel($('arrive').value || '09:30')} to ${timeLabel($('leave').value || '18:30')}`;
  });
}

let commuteStatus = null;
async function checkCommuteReady() {
  if (commuteStatus) return commuteStatus;
  try {
    commuteStatus = await (await fetch('/api/commute')).json();
  } catch {
    commuteStatus = { ready: false };
  }
  if (!commuteStatus.ready) {
    const note = Object.assign(document.createElement('p'), {
      className: 'note',
      textContent: 'Commute search opens soon. Building search and area browsing work now.',
    });
    $('commute-form').prepend(note);
  }
  return commuteStatus;
}

function setOffice(place) {
  commute.office = place;
  commute.result = null;
  commute.unlock = savedUnlock(officeKeyOf(place.lat, place.lng));
  const el = $('office-name');
  el.textContent = place.name;
  el.classList.remove('is-empty');
  $('commute-go').disabled = !commuteStatus?.ready;
  $('commute-results').hidden = true;
  setMapLock(false);
  map.clear();
  map.showSearch({ lat: place.lat, lng: place.lng }, place.name, 400, mapPadding());
}

$('commute-form').addEventListener('submit', (e) => {
  e.preventDefault();
  runCommute();
});

let commuteSeq = 0;

async function runCommute() {
  if (!commute.office) return;
  const modes = [...document.querySelectorAll('#mode-row input:checked')].map((i) => i.value);
  const out = $('commute-results');
  out.hidden = false;
  if (!modes.length) {
    out.innerHTML = '<p class="summary is-error">Choose at least one way to travel.</p>';
    return;
  }
  const seq = ++commuteSeq;
  const btn = $('commute-go');
  btn.disabled = true;
  btn.textContent = 'Working out travel times…';
  out.innerHTML = '<p class="summary-line">Checking morning and evening traffic for each area. This takes a few seconds.</p>';
  out.append(...skeletons(3));
  snapSheet('half');
  try {
    const res = await fetchCommute({
      office: { lat: commute.office.lat, lng: commute.office.lng },
      maxMin: Number($('max-time').value),
      modes,
      arrive: $('arrive').value || '09:30',
      leave: $('leave').value || '18:30',
      unlock: commute.unlock?.token,
    });
    if (seq !== commuteSeq) return;
    commute.result = res;
    renderCommute();
    drawCommute();
    sheetBody.scrollTo({ top: out.offsetTop - 12, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } catch (err) {
    if (seq !== commuteSeq) return;
    out.innerHTML = '';
    out.append(Object.assign(document.createElement('p'), { className: 'summary is-error', textContent: err.message }));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find areas';
  }
}

function drawCommute() {
  const r = commute.result;
  if (!r) return;
  map.showCommute(commute.office, r.localities, (l) => showLocality(l), mapPadding());
  setMapLock(!r.unlocked && r.total > r.localities.length);
}

const unlockLabel = () => (commuteStatus?.price ? `Unlock full commute map for ₹${commuteStatus.price}` : 'Unlock full commute map');

function setMapLock(on) {
  $('map-lock').querySelector('.js-unlock').textContent = unlockLabel();
  $('map-lock').hidden = !on;
  document.body.classList.toggle('map-locked', on);
}

function renderCommute() {
  const r = commute.result;
  const out = $('commute-results');
  out.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'summary';
  const title = document.createElement('p');
  title.className = 'summary-line';
  const fits = r.localities.filter((l) => l.fit === 'green').length;
  const officeName = Object.assign(document.createElement('b'), { textContent: commute.office.name });
  if (!r.localities.length) {
    title.append('No areas are within reach of ', officeName, ' for this commute. Try a longer travel time.');
    head.append(title);
    out.append(head);
    return;
  }
  title.append('Best areas to live in for an office at ', officeName);
  const sub = Object.assign(document.createElement('p'), { className: 'summary-sub' });
  sub.textContent = r.unlocked
    ? `${fits} of ${r.total} nearby areas fit within ${r.maxMin} min both ways.`
    : `Top 3 of ${r.total} areas checked. These are areas and the brokers in them, not house listings.`;
  head.append(title, sub);
  out.append(head);

  if (r.skipped?.length) {
    const names = r.skipped.map((m) => MODE_LABEL[m].toLowerCase()).join(' and ');
    out.append(Object.assign(document.createElement('p'), {
      className: 'note',
      textContent: r.unlocked
        ? `${names[0].toUpperCase() + names.slice(1)} times aren't available right now (daily limit). Other modes are shown.`
        : `${names[0].toUpperCase() + names.slice(1)} times are included in the full map.`,
    }));
  }

  const ol = document.createElement('ol');
  ol.className = 'results';
  r.localities.forEach((l, i) => ol.append(localityRow(l, i, r.unlocked)));
  out.append(ol);

  if (!r.unlocked && r.total > r.localities.length) {
    const lock = document.createElement('div');
    lock.className = 'locked';
    const ghost = document.createElement('ol');
    ghost.className = 'results ghost';
    ghost.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < Math.min(4, r.total - r.localities.length); i++) ghost.append(...skeletons(1));
    const cta = document.createElement('div');
    cta.className = 'locked-cta';
    cta.innerHTML = `<p class="locked-title"></p><p class="locked-text"></p><button type="button" class="btn btn-primary js-unlock"></button><p class="fine"></p>`;
    cta.querySelector('.locked-title').textContent = `${r.total - r.localities.length} more areas checked`;
    cta.querySelector('.locked-text').textContent = 'See all of them on a colour-coded map with morning and evening times for every way you travel, and the brokers in each area.';
    cta.querySelector('.js-unlock').textContent = unlockLabel();
    cta.querySelector('.fine').textContent = 'One-time payment. Valid for 7 days for this office on this device.';
    lock.append(ghost, cta);
    out.append(lock);
  }
}

function localityRow(l, i, unlocked) {
  const li = document.createElement('li');
  li.className = 'row loc-row';
  li.innerHTML = `
    <button type="button" class="row-main">
      <span class="row-num loc-dot" aria-hidden="true">${i + 1}</span>
      <span class="row-text">
        <span class="row-name"></span>
        <span class="loc-times"></span>
        <span class="loc-modes" hidden></span>
        <span class="row-addr"></span>
      </span>
      <span class="row-dist loc-score"></span>
    </button>`;
  li.querySelector('.loc-dot').style.background = FIT_COLORS[l.fit];
  li.querySelector('.row-name').textContent = l.name;
  li.querySelector('.loc-times').textContent = `Morning ${l.best.morning} min · Evening ${l.best.evening} min · ${MODE_LABEL[l.best.mode]}`;
  li.querySelector('.row-addr').textContent =
    `${l.region}${l.brokers != null ? ` · ${l.brokers} ${l.brokers === 1 ? 'broker' : 'brokers'} nearby` : ''}`;
  li.querySelector('.loc-score').textContent = `${l.best.score} min`;
  if (unlocked && l.byMode && Object.keys(l.byMode).length > 1) {
    const all = Object.entries(l.byMode)
      .map(([m, t]) => `${MODE_LABEL[m]} ${t.morning}/${t.evening}`)
      .join(' · ');
    const modes = li.querySelector('.loc-modes');
    modes.hidden = false;
    modes.textContent = `All modes, morning/evening: ${all} min`;
  }
  li.querySelector('.row-main').setAttribute('aria-label', `${l.name}: ${l.best.score} minutes. Show brokers.`);
  li.querySelector('.row-main').addEventListener('click', () => showLocality(l));
  return li;
}

function showLocality(l) {
  showBrokersAround({ name: l.name, lat: l.lat, lng: l.lng }, { fromCommute: true });
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.js-unlock');
  if (!btn || !commute.office) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Opening payment…';
  try {
    const status = await checkCommuteReady();
    if (!status.payments) throw Object.assign(new Error('Payments open soon.'), { code: 'payments_not_configured' });
    const v = status.payments === 'upi' ? await buyWithUpi(commute.office) : await buyUnlock(commute.office);
    if (v) {
      commute.unlock = v;
      setTab('commute');
      await runCommute();
    }
  } catch (err) {
    const msg = err.code === 'payments_not_configured' ? 'Payments open soon. The top 3 areas stay free.' : err.message;
    btn.insertAdjacentElement('afterend', Object.assign(document.createElement('p'), { className: 'summary is-error', textContent: msg }));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// ---------- bottom sheet (phones) ----------

let sheetState = 'peek';

function sheetOffsets() {
  const h = sheet.offsetHeight;
  const peekVisible = Math.min(h, Math.max(250, innerHeight * 0.36));
  return {
    full: 0,
    half: Math.max(0, h - innerHeight * 0.56),
    peek: Math.max(0, h - peekVisible),
  };
}

/** Returns true when the sheet will animate to a new position. */
function snapSheet(state, animate = true) {
  if (desktop.matches) return false;
  const from = sheet.style.getPropertyValue('--sheet-y');
  const to = `${sheetOffsets()[state]}px`;
  sheetState = state;
  const moving = animate && from !== to && !prefersReducedMotion();
  sheet.classList.toggle('is-animating', moving);
  sheet.style.setProperty('--sheet-y', to);
  return moving;
}

(function setupSheet() {
  const grab = $('sheet-grab');
  let startY = 0;
  let startOffset = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let dragging = false;
  let moved = false;

  const begin = (e) => {
    if (desktop.matches) return;
    dragging = true;
    moved = false;
    startY = lastY = e.clientY;
    lastT = performance.now();
    startOffset = sheetOffsets()[sheetState];
    sheet.classList.remove('is-animating');
    grab.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    const now = performance.now();
    velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
    const o = sheetOffsets();
    const y = Math.min(o.peek + 40, Math.max(-20, startOffset + dy));
    sheet.style.setProperty('--sheet-y', `${y}px`);
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    if (!moved) {
      snapSheet(sheetState === 'peek' ? 'half' : sheetState === 'half' ? 'full' : 'half');
      return;
    }
    const o = sheetOffsets();
    const y = parseFloat(sheet.style.getPropertyValue('--sheet-y')) || 0;
    const projected = y + velocity * 180;
    const nearest = Object.entries(o).sort((a, b) => Math.abs(a[1] - projected) - Math.abs(b[1] - projected))[0][0];
    snapSheet(nearest);
  };
  grab.addEventListener('pointerdown', begin);
  grab.addEventListener('pointermove', move);
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
  grab.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') snapSheet(sheetState === 'peek' ? 'half' : 'full');
    if (e.key === 'ArrowDown') snapSheet(sheetState === 'full' ? 'half' : 'peek');
  });

  // Pulling down on the list when it's already at the top collapses the sheet.
  let touchStartY = null;
  sheetBody.addEventListener('touchstart', (e) => (touchStartY = sheetBody.scrollTop <= 0 ? e.touches[0].clientY : null), { passive: true });
  sheetBody.addEventListener('touchmove', (e) => {
    if (touchStartY == null) return;
    if (e.touches[0].clientY - touchStartY > 60 && sheetState !== 'peek') {
      snapSheet(sheetState === 'full' ? 'half' : 'peek');
      touchStartY = null;
    }
  }, { passive: true });

  sheet.addEventListener('transitionend', (e) => {
    if (e.target !== sheet || e.propertyName !== 'transform') return;
    sheet.classList.remove('is-animating');
    if (tab === 'building' && current?.openId) map?.highlight(current.openId, true, mapPadding());
  });

  addEventListener('resize', () => snapSheet(sheetState, false));
  desktop.addEventListener('change', () => {
    sheet.style.removeProperty('--sheet-y');
    snapSheet(sheetState, false);
  });
  grab.tabIndex = 0;
  grab.setAttribute('role', 'button');
  grab.setAttribute('aria-label', 'Resize results panel');
  snapSheet('peek', false);
})();

boot();
