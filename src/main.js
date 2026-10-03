import './style.css';
import { API_KEY, CLAIM_FORM_URL, MIN_RESULTS, RADII_M, TRY_QUERIES } from './config.js';
import { distanceKm, formatKm, pickRadius, whatsappNumber } from './geo.js';

const $ = (id) => document.getElementById(id);
const input = $('search-input');
const list = $('suggestions');
const combobox = input.closest('.search');
const statusEl = $('status');
const resultsEl = $('results');
const emptyEl = $('empty');
const mapNote = $('map-note');

$('claim-link').href = CLAIM_FORM_URL;

let provider = null;
let suggestions = [];
let activeIndex = -1;
let searchSeq = 0;
let current = { brokers: [] };

// ---------- boot ----------

async function boot() {
  try {
    if (API_KEY) {
      const { createGoogleProvider } = await import('./maps/google.js');
      provider = await createGoogleProvider($('map'));
    } else {
      const { createPreviewProvider } = await import('./maps/preview.js');
      provider = await createPreviewProvider($('map'));
      showNote('Preview mode: sample buildings and made-up brokers.');
      document.body.classList.add('is-preview');
    }
  } catch (err) {
    console.error(err);
    showNote(err.message || 'The map could not load.');
  }
  renderTryChips();
  const q = new URLSearchParams(location.search).get('q');
  if (q) runQuery(q);
}

document.addEventListener('maps-auth-failure', () => {
  showNote('Google rejected the API key. Check that it is valid and allowed on this website.');
  setStatus('Search is unavailable right now.', 'error');
});

function showNote(text) {
  mapNote.textContent = text;
  mapNote.hidden = false;
}

function renderTryChips() {
  const row = $('try-row');
  for (const q of TRY_QUERIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = q;
    b.addEventListener('click', () => runQuery(q));
    row.append(b);
  }
}

// Fill the box and pick the top suggestion: used by chips and ?q= links.
async function runQuery(q) {
  input.value = q;
  await fetchSuggestions(q);
  if (suggestions[0]) choose(0);
}

// ---------- autocomplete ----------

let debounce;
input.addEventListener('input', () => {
  clearTimeout(debounce);
  const q = input.value.trim();
  if (q.length < 2) return closeList();
  debounce = setTimeout(() => fetchSuggestions(q), 220);
});

input.addEventListener('keydown', (e) => {
  if (list.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggestions.length;
    activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    paintActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(activeIndex >= 0 ? activeIndex : 0);
  } else if (e.key === 'Escape') {
    closeList();
  }
});

input.addEventListener('focus', () => suggestions.length && input.value.trim().length >= 2 && openList());
document.addEventListener('click', (e) => !combobox.contains(e.target) && closeList());

async function fetchSuggestions(q) {
  if (!provider) return;
  const seq = ++searchSeq;
  try {
    const res = await provider.suggest(q);
    if (seq !== searchSeq) return;
    suggestions = res;
    activeIndex = -1;
    renderList(q);
  } catch (err) {
    console.error(err);
    if (seq === searchSeq) setStatus('Suggestions failed to load. Try again in a moment.', 'error');
  }
}

function renderList(q) {
  list.replaceChildren();
  if (!suggestions.length) {
    const li = document.createElement('li');
    li.className = 'sugg-empty';
    li.textContent = `No Mumbai places match “${q}”.`;
    list.append(li);
  }
  suggestions.forEach((s, i) => {
    const li = document.createElement('li');
    li.id = `sugg-${i}`;
    li.role = 'option';
    li.className = 'sugg';
    const main = document.createElement('span');
    main.className = 'sugg-main';
    main.textContent = s.main;
    const sec = document.createElement('span');
    sec.className = 'sugg-sec';
    sec.textContent = s.secondary;
    li.append(main, sec);
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('click', () => choose(i));
    list.append(li);
  });
  openList();
}

function paintActive() {
  [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === activeIndex)));
  input.setAttribute('aria-activedescendant', activeIndex >= 0 ? `sugg-${activeIndex}` : '');
}

function openList() {
  list.hidden = false;
  combobox.setAttribute('aria-expanded', 'true');
}
function closeList() {
  list.hidden = true;
  combobox.setAttribute('aria-expanded', 'false');
}

// ---------- search ----------

async function choose(i) {
  const s = suggestions[i];
  if (!s) return;
  closeList();
  input.value = s.main;
  input.blur();
  emptyEl.hidden = true;
  resultsEl.replaceChildren(...skeletons(4));
  setStatus(`Finding brokers near ${s.main}…`);

  try {
    const place = await provider.resolve(s);
    const center = { lat: place.lat, lng: place.lng };
    provider.showSearch(center, place.name, RADII_M[0]);

    const raw = await provider.nearby(center, RADII_M[RADII_M.length - 1]);
    const withDist = raw
      .map((b) => ({ ...b, distanceKm: distanceKm(center, b) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const { radiusM, items } = pickRadius(withDist, RADII_M, MIN_RESULTS);

    current = { place, center, radiusM, brokers: items };
    provider.showSearch(center, place.name, radiusM);
    provider.showBrokers(items, select);
    renderResults();

    const url = new URL(location.href);
    url.searchParams.set('q', place.name);
    history.replaceState(null, '', url);
  } catch (err) {
    console.error(err);
    resultsEl.replaceChildren();
    setStatus('Something went wrong while searching. Try again.', 'error');
  }
}

function setStatus(html, tone = '') {
  statusEl.className = `status ${tone}`;
  statusEl.innerHTML = html;
}

function renderResults() {
  const { brokers, radiusM, place } = current;
  const km = radiusM / 1000;
  const widened = radiusM > RADII_M[0];
  const name = escapeHtml(place.name);
  if (!brokers.length) {
    setStatus(`No real estate agencies on Google Maps within ${km} km of <b>${name}</b>.`);
    resultsEl.replaceChildren();
    return;
  }
  setStatus(
    `<span class="status-count">${brokers.length}</span> broker${brokers.length === 1 ? '' : 's'} within ` +
      `<span class="radius-pill">${km} km</span> of <b>${name}</b>` +
      (widened ? `<span class="status-sub">Fewer than ${MIN_RESULTS} within 1 km, so we widened the circle.</span>` : ''),
  );
  resultsEl.replaceChildren(...brokers.map(card));
}

function skeletons(n) {
  return Array.from({ length: n }, () => {
    const li = document.createElement('li');
    li.className = 'card skeleton';
    li.innerHTML = '<span></span><span></span><span></span>';
    return li;
  });
}

// ---------- broker cards ----------

function card(b, i) {
  const li = document.createElement('li');
  li.className = 'card';
  li.dataset.id = b.id;
  li.tabIndex = 0;
  li.innerHTML = `
    <div class="card-head">
      <span class="card-num" aria-hidden="true">${i + 1}</span>
      <div class="card-title">
        <h2 class="card-name"></h2>
        <p class="card-addr"></p>
      </div>
      <span class="card-dist">${formatKm(b.distanceKm)}</span>
    </div>
    <div class="card-meta" hidden></div>
    <div class="card-actions">
      <button type="button" class="btn btn-soft js-details">Show phone &amp; rating</button>
      <a class="btn btn-link" target="_blank" rel="noopener">Open in Google Maps ↗</a>
    </div>`;
  li.querySelector('.card-name').textContent = b.name;
  li.querySelector('.card-addr').textContent = b.address;
  li.querySelector('.btn-link').href = b.mapsUrl;
  li.querySelector('.js-details').addEventListener('click', (e) => {
    e.stopPropagation();
    loadDetails(b, li);
  });
  li.addEventListener('click', (e) => {
    if (e.target.closest('a,button')) return;
    select(b.id, 'list');
  });
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === li) select(b.id, 'list');
  });
  return li;
}

function select(id, from) {
  for (const el of resultsEl.children) el.classList.toggle('is-active', el.dataset.id === id);
  provider.highlight(id, from === 'list');
  if (from === 'map') {
    resultsEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: smooth(), block: 'nearest' });
  }
}

const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

async function loadDetails(b, li) {
  const btn = li.querySelector('.js-details');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const d = await provider.details(b.id);
    const meta = li.querySelector('.card-meta');
    const bits = [];
    if (d.rating != null) {
      bits.push(
        `<span class="rating"><span class="star" aria-hidden="true">★</span> ${d.rating.toFixed(1)}` +
          `<span class="muted"> (${d.ratingCount})</span></span>`,
      );
    } else {
      bits.push('<span class="muted">No Google rating yet</span>');
    }
    if (d.phone) {
      bits.push(`<span class="phone">${escapeHtml(d.phone)}</span>`);
    } else {
      bits.push('<span class="muted">No phone listed</span>');
    }
    meta.innerHTML = bits.join('');
    meta.hidden = false;

    const actions = li.querySelector('.card-actions');
    btn.remove();
    if (d.phone) {
      const wa = whatsappNumber(d.intlPhone);
      if (wa || d.sample) {
        const a = document.createElement('a');
        a.className = 'btn btn-wa';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'WhatsApp';
        const text = `Hi, I found you on Mumbai Broker Map. I'm looking for a home near ${current.place.name}.`;
        a.href = d.sample ? '#' : `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
        if (d.sample) a.addEventListener('click', (e) => e.preventDefault());
        actions.prepend(a);
      }
      const call = document.createElement('a');
      call.className = 'btn btn-soft';
      call.textContent = 'Call';
      call.href = d.sample ? '#' : `tel:${(d.intlPhone || d.phone).replace(/[^\d+]/g, '')}`;
      if (d.sample) call.addEventListener('click', (e) => e.preventDefault());
      actions.querySelector('.btn-wa') ? actions.querySelector('.btn-wa').after(call) : actions.prepend(call);
    }
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'Couldn’t load. Try again';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

boot();
