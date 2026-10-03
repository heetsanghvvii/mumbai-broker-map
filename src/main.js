import './style.css';
import { API_KEY, CLAIM_FORM_URL, MIN_RESULTS, RADII_M, TRY_QUERIES } from './config.js';
import { distanceKm, formatDistance, pickRadius, prefersReducedMotion, whatsappNumber } from './geo.js';

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

$('claim-link').href = CLAIM_FORM_URL;

const desktop = matchMedia('(min-width: 900px)');

let provider = null;
let suggestions = [];
let activeIndex = -1;
let suggestSeq = 0;
let current = null;

// ---------- boot ----------

async function boot() {
  renderPopular();
  try {
    if (API_KEY) {
      const { createGoogleProvider } = await import('./maps/google.js');
      provider = await createGoogleProvider($('map'));
    } else {
      const { createPreviewProvider } = await import('./maps/preview.js');
      provider = await createPreviewProvider($('map'));
      $('preview-note').hidden = false;
    }
  } catch (err) {
    console.error(err);
    showError(err.message || 'The map could not load. Refresh to try again.');
    return;
  }
  const q = new URLSearchParams(location.search).get('q');
  if (q) runQuery(q);
}

document.addEventListener('maps-auth-failure', () => {
  showError('The map key was rejected, so search is off for now. If you run this site, check the key in Google Cloud.');
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

async function runQuery(q) {
  input.value = q;
  syncClear();
  if (await fetchSuggestions(q)) choose(0);
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

// ---------- autocomplete ----------

let debounce;
input.addEventListener('input', () => {
  syncClear();
  clearTimeout(debounce);
  const q = input.value.trim();
  if (q.length < 2) return closeList();
  debounce = setTimeout(() => fetchSuggestions(q), 200);
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
  if (!provider) return false;
  const seq = ++suggestSeq;
  try {
    const res = await provider.suggest(q);
    if (seq !== suggestSeq) return false;
    suggestions = res;
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
    li.textContent = `Nothing in Mumbai matches “${q}”. Try the society or project name.`;
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

// ---------- search ----------

let searchSeq = 0;

async function choose(i) {
  const s = suggestions[i];
  if (!s) return;
  const seq = ++searchSeq;
  closeList();
  input.value = s.main;
  syncClear();
  input.blur();
  introEl.hidden = true;
  summaryEl.hidden = false;
  summaryEl.className = 'summary';
  summaryEl.innerHTML = `<p class="summary-line">Looking around <b></b>…</p>`;
  summaryEl.querySelector('b').textContent = s.main;
  resultsEl.replaceChildren(...skeletons(4));
  snapSheet('half');

  try {
    const place = await provider.resolve(s);
    const center = { lat: place.lat, lng: place.lng };
    const raw = await provider.nearby(center, RADII_M[RADII_M.length - 1]);
    if (seq !== searchSeq) return; // a newer search started while this one was loading
    const sorted = raw
      .map((b) => ({ ...b, distanceKm: distanceKm(center, b) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const { radiusM, items } = pickRadius(sorted, RADII_M, MIN_RESULTS);

    // Nearby Search returns at most 20, so a full page means there may be more just as close.
    current = { place, radiusM, brokers: items, capped: raw.length >= 20 && items.length === raw.length, openId: null };
    provider.showSearch(center, place.name, radiusM, mapPadding());
    provider.showBrokers(items, (id) => select(id, 'map'));
    renderResults();
    sheetBody.scrollTop = 0;

    const url = new URL(location.href);
    url.searchParams.set('q', place.name);
    history.replaceState(null, '', url);
  } catch (err) {
    console.error(err);
    if (seq !== searchSeq) return;
    resultsEl.replaceChildren();
    showError('The search didn’t go through. Pick the building again to retry.');
  }
}

function renderResults() {
  const { brokers, radiusM, place, capped } = current;
  const km = radiusM / 1000;
  summaryEl.className = 'summary';
  summaryEl.innerHTML = '';
  const line = document.createElement('p');
  line.className = 'summary-line';
  const name = document.createElement('b');
  name.textContent = place.name;

  if (!brokers.length) {
    line.append(`No real estate agencies on Google Maps within ${km} km of `, name, '.');
    summaryEl.append(line);
    resultsEl.replaceChildren();
    return;
  }

  const count = document.createElement('span');
  count.className = 'summary-count';
  count.textContent = brokers.length;
  const ring = document.createElement('span');
  ring.className = 'radius';
  ring.textContent = `${km} km`;
  if (capped) line.append(count, ' nearest brokers, all within ', ring, ' of ', name);
  else line.append(count, ` ${brokers.length === 1 ? 'broker' : 'brokers'} within `, ring, ' of ', name);
  summaryEl.append(line);
  if (radiusM > RADII_M[0]) {
    const sub = document.createElement('p');
    sub.className = 'summary-sub';
    sub.textContent = `Fewer than ${MIN_RESULTS} within 1 km, so the circle grew to ${km} km.`;
    summaryEl.append(sub);
  }
  resultsEl.replaceChildren(...brokers.map(row));
}

function skeletons(n) {
  return Array.from({ length: n }, () => {
    const li = document.createElement('li');
    li.className = 'row is-skeleton';
    li.innerHTML = '<span class="sk sk-num"></span><span class="sk-lines"><span class="sk"></span><span class="sk"></span></span>';
    return li;
  });
}

// ---------- broker rows ----------

function row(b, i) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.id = b.id;
  li.innerHTML = `
    <button type="button" class="row-main" aria-expanded="false">
      <span class="row-num" aria-hidden="true">${i + 1}</span>
      <span class="row-text">
        <span class="row-name"></span>
        <span class="row-addr"></span>
      </span>
      <span class="row-dist">${formatDistance(b.distanceKm)}</span>
    </button>
    <div class="row-more" hidden>
      <div class="row-meta"></div>
      <div class="row-actions">
        <button type="button" class="btn btn-primary js-details">Show phone and rating</button>
        <a class="btn btn-quiet" target="_blank" rel="noopener">Open in Google Maps</a>
      </div>
    </div>`;
  li.querySelector('.row-name').textContent = b.name;
  li.querySelector('.row-addr').textContent = b.address;
  li.querySelector('.btn-quiet').href = b.mapsUrl;
  li.querySelector('.row-main').addEventListener('click', () =>
    select(current.openId === b.id ? null : b.id, 'list'),
  );
  li.querySelector('.js-details').addEventListener('click', () => loadDetails(b, li, current.place.name));
  return li;
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
  if (!(id && target && snapSheet(target))) provider.highlight(id, !!id, mapPadding());
  if (id && from === 'map') {
    resultsEl
      .querySelector(`[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }
}

async function loadDetails(b, li, placeName) {
  const btn = li.querySelector('.js-details');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const d = await provider.details(b.id);
    const meta = li.querySelector('.row-meta');
    meta.replaceChildren();

    const rating = document.createElement('span');
    if (d.rating != null) {
      rating.className = 'meta-rating';
      rating.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 1.8 2.5 5.3 5.8.7-4.3 4 1.1 5.7L10 14.7l-5.1 2.8L6 11.8l-4.3-4 5.8-.7z"/></svg>`;
      rating.append(`${d.rating.toFixed(1)}`);
      const c = document.createElement('span');
      c.className = 'meta-muted';
      c.textContent = ` from ${d.ratingCount} Google ${d.ratingCount === 1 ? 'review' : 'reviews'}`;
      rating.append(c);
    } else {
      rating.className = 'meta-muted';
      rating.textContent = 'No Google reviews yet';
    }
    const phone = document.createElement('span');
    phone.className = d.phone ? 'meta-phone' : 'meta-muted';
    phone.textContent = d.phone || 'No phone number listed';
    meta.append(rating, phone);

    const actions = li.querySelector('.row-actions');
    btn.remove();
    if (d.phone) {
      const wa = whatsappNumber(d.intlPhone);
      const call = linkBtn('Call', 'btn btn-secondary', d.sample ? null : `tel:${(d.intlPhone || d.phone).replace(/[^\d+]/g, '')}`);
      actions.prepend(call);
      if (wa || d.sample) {
        const text = `Hi, I found you on Mumbai Broker Map. I'm looking for a home near ${placeName}.`;
        const waBtn = linkBtn('WhatsApp', 'btn btn-wa', d.sample ? null : `https://wa.me/${wa}?text=${encodeURIComponent(text)}`);
        waBtn.insertAdjacentHTML(
          'afterbegin',
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a9.5 9.5 0 0 0-8.2 14.3L2.5 21.5l4.8-1.3A9.5 9.5 0 1 0 12 2.5zm5.3 13.3c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 .9c.3.1.5.2.5.3.1.1.1.7-.1 1.4z"/></svg>',
        );
        actions.prepend(waBtn);
      }
    }
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'Didn’t load. Try again';
  }
}

function linkBtn(label, cls, href) {
  const a = document.createElement('a');
  a.className = cls;
  a.textContent = label;
  if (href) {
    a.href = href;
    if (href.startsWith('http')) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
  } else {
    a.href = '#';
    a.title = 'Sample broker, no real number';
    a.addEventListener('click', (e) => e.preventDefault());
  }
  return a;
}

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
    if (current?.openId) provider.highlight(current.openId, true, mapPadding());
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
