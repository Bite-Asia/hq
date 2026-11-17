// Bite HQ on the web: the admin's editor for Bite's hand-picked lists.
//
// What it can do is decided by the database, not by this page. Every
// change goes through a function that first asks "is this person an
// admin?" (set_editor_pick, set_editor_pick_order, publish_editor_picks,
// and the hq-places search). Someone who finds this address and has no
// admin account can sign in to nothing.
//
// Add ?demo to the address to try the page with made-up places. Demo
// mode never talks to the database.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/+esm';
import { SUPABASE_URL, SUPABASE_KEY, LISTS, NEWLY_OPENED_DAYS, TOP25_SHOWN } from './config.js';
import { classify, cuisineLabel } from './tags-cuisines.js';
import { areaFromAddress, areaLabel } from './tags-areas.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const DAY = 86400000;

// ───────────────────────── small helpers ─────────────────────────

const $ = (id) => document.getElementById(id);

// Builds an element. Text always goes in as text, never as HTML, so a
// place called "<script>" is just a strange name.
function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of [].concat(kids)) if (kid) node.append(kid);
  return node;
}

let toastTimer = null;
function toast(message, bad = false) {
  const t = $('toast');
  t.textContent = message;
  t.className = bad ? 'toast bad' : 'toast';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, bad ? 6000 : 2600);
}

function show(id) {
  for (const view of ['loading', 'signin', 'denied', 'app']) $(view).hidden = view !== id;
}

// What went wrong, in words a person can act on.
function explain(error) {
  const m = String(error?.message ?? error ?? '');
  if (/set_editor_pick_order/.test(m) && /not find|does not exist|schema cache/i.test(m)) {
    return 'Ranking needs migration 065. Run it in Supabase, then try again.';
  }
  if (/not allowed/i.test(m)) return 'This account is not allowed to do that.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection. Check the internet and try again.';
  if (/Invalid login credentials/i.test(m)) return 'That email and password do not match.';
  if (/redirect|requested path is invalid/i.test(m)) return 'Google sign-in is not allowed to come back to this address yet. It needs adding in Supabase.';
  return m || 'Something went wrong.';
}

const placeMeta = (r) =>
  [cuisineLabel(r.cuisine, r.subcuisine), areaLabel(r.area)].filter(Boolean).join(' · ') || r.address || '';

// ───────────────────────── the data, live ─────────────────────────

function liveApi() {
  const db = createClient(SUPABASE_URL, SUPABASE_KEY);
  const must = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  // A name typed into the box, made safe to use inside a "contains" search.
  const like = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const PLACE = 'id, place_id, name, cuisine, subcuisine, area, address';
  return {
    async user() {
      return (await db.auth.getSession()).data.session?.user ?? null;
    },
    async signIn(email, password) {
      must(await db.auth.signInWithPassword({ email, password }));
    },
    // Off to Google and back to this page, the same route the app takes.
    // The address must be on Supabase's list of allowed return addresses
    // (Authentication > URL Configuration > Redirect URLs).
    async signInWithGoogle() {
      must(await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }));
    },
    async signOut() {
      await db.auth.signOut();
    },
    async isAdmin() {
      return must(await db.rpc('is_admin')) === true;
    },
    async status() {
      return must(await db.rpc('editor_picks_status')) ?? {};
    },
    async picks() {
      return must(
        await db
          .from('editor_picks')
          .select(`list, restaurant_id, position, live, pending, published_at, created_at, restaurant:restaurants(${PLACE})`)
          .order('position', { ascending: true })
          .order('created_at', { ascending: true }),
      );
    },
    async searchBite(q) {
      return must(await db.from('restaurants').select(PLACE).ilike('name', like(q)).order('name').limit(8));
    },
    // Every place in Singapore, through the hq-places function, which
    // holds the Google key and checks the caller is an admin.
    async searchGoogle(q) {
      const { data, error } = await db.functions.invoke('hq-places', { body: { q } });
      if (error) {
        let reason = '';
        try {
          reason = (await error.context?.json())?.reason ?? '';
        } catch {
          // No readable answer: the general message below will do.
        }
        return { ok: false, reason: reason || 'failed' };
      }
      return data ?? { ok: false, reason: 'failed' };
    },
    // A place Google found, saved into Bite the way the app saves one.
    async saveGooglePlace(p) {
      const tags = classify(p.kind);
      return must(
        await db.rpc('get_or_create_restaurant', {
          p_place_id: p.place_id,
          p_name: p.name,
          p_address: p.address,
          p_lat: p.lat,
          p_lng: p.lng,
          p_maps_url: p.maps_url,
          p_cuisine: tags.cuisine,
          p_photo_ref: p.photo_ref,
          p_area: areaFromAddress(p.address),
          p_subcuisine: tags.subcuisine,
          p_venue_type: tags.venue_type,
          p_price_level: p.price_level ?? null,
        }),
      );
    },
    async setPick(list, restaurantId, on) {
      must(await db.rpc('set_editor_pick', { p_list: list, p_restaurant: restaurantId, p_on: on }));
    },
    async setOrder(list, ids) {
      must(await db.rpc('set_editor_pick_order', { p_list: list, p_ids: ids }));
    },
    async publish() {
      return must(await db.rpc('publish_editor_picks'));
    },
  };
}

// ───────────────────────── the data, made up ─────────────────────────
// Behaves like the real thing (drafts, publish, ranking) with invented
// places, so the page can be tried and tested without touching Bite.

function demoApi() {
  const place = (n, name, cuisine, area) => ({
    id: `demo-${n}`, place_id: `g-${n}`, name, cuisine, subcuisine: null, area, address: `${n} Demo Street, Singapore`,
  });
  const places = [
    place(1, 'Charcoal & Smoke', 'Western', 'Chinatown'), place(2, 'Uncle Tan Chicken Rice', 'Local', 'Katong'),
    place(3, 'Nonna’s Table', 'Italian', 'Tiong Bahru'), place(4, 'Seoul Night Grill', 'Korean', 'Tanjong Pagar'),
    place(5, 'Laksa Republic', 'Local', 'Bugis'), place(6, 'Omakase Ito', 'Japanese', 'Orchard'),
    place(7, 'The Daily Loaf', null, 'Tiong Bahru'), place(8, 'Slow Drip Coffee', null, 'Joo Chiat'),
    place(9, 'Matcha Hours', null, 'Bugis'), place(10, 'Sugar Theory', null, 'Holland Village'),
    place(11, 'Brand New Bistro', 'French', 'Robertson Quay'), place(12, 'Wok Hei Brothers', 'Chinese', 'Geylang'),
  ];
  // Places only Google knows: no Bite id until one is added to a list.
  const far = [
    { place_id: 'g-21', name: 'Far East Noodle House', address: '21 Demo Street, Singapore 088421', kind: 'Noodle Shop' },
    { place_id: 'g-22', name: 'Harbour Grill', address: '22 Demo Street, Singapore 098585', kind: 'Steak House' },
    { place_id: 'g-23', name: 'Kopi & Kaya', address: '23 Demo Street, Singapore 427447', kind: 'Cafe' },
  ];
  const byId = (id) => places.find((p) => p.id === id);
  const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
  let picks = [
    ['top25', 1, true, null, 40], ['top25', 2, true, null, 40], ['top25', 3, true, null, 40],
    ['top25', 4, true, 'remove', 40], ['top25', 5, false, 'add', 0], ['top25', 6, true, null, 40],
    ['newly_opened', 11, true, null, 24], ['sweet', 10, true, null, 40], ['sweet', 7, false, 'add', 0],
    ['brews', 8, true, null, 40], ['brews', 9, true, null, 40],
  ].map(([list, n, live, pending, days], i) => ({
    list, restaurant_id: `demo-${n}`, position: i + 1, live, pending,
    published_at: live ? ago(days) : null, created_at: ago(days), restaurant: byId(`demo-${n}`),
  }));
  const of = (list) => picks.filter((p) => p.list === list).sort((a, b) => a.position - b.position);
  const pause = () => new Promise((done) => setTimeout(done, 120));
  return {
    async user() {
      return { email: 'demo@bite' };
    },
    async signIn() {},
    async signInWithGoogle() {},
    async signOut() {},
    async isAdmin() {
      return true;
    },
    async status() {
      const next = new Date();
      next.setMonth(next.getMonth() + 1, 1);
      next.setHours(9, 0, 0, 0);
      return {
        next_publish: next.toISOString(),
        pending_add: picks.filter((p) => p.pending === 'add').length,
        pending_remove: picks.filter((p) => p.pending === 'remove').length,
      };
    },
    async picks() {
      await pause();
      // In rank order, as the real query returns them.
      return picks.map((p) => ({ ...p })).sort((a, b) => a.position - b.position);
    },
    async searchBite(q) {
      await pause();
      return places.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
    },
    async searchGoogle(q) {
      await pause();
      const hits = [...far, ...places].filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
      // As the real search answers: Google's own fields, never a Bite id.
      return {
        ok: true,
        places: (hits.length ? hits : far).map((p) => ({
          place_id: p.place_id, name: p.name, address: p.address, kind: p.kind ?? null,
          lat: 1.3, lng: 103.8, maps_url: '', photo_ref: null, price_level: null,
        })),
      };
    },
    async saveGooglePlace(p) {
      const tags = classify(p.kind);
      const have = places.find((x) => x.place_id === p.place_id);
      if (have) return have.id;
      const made = { id: `demo-${p.place_id}`, place_id: p.place_id, name: p.name, cuisine: tags.cuisine, subcuisine: tags.subcuisine, area: areaFromAddress(p.address), address: p.address };
      if (!byId(made.id)) places.push(made);
      return made.id;
    },
    async setPick(list, id, on) {
      await pause();
      const row = picks.find((p) => p.list === list && p.restaurant_id === id);
      if (on) {
        if (!row) picks.push({ list, restaurant_id: id, position: Math.max(0, ...of(list).map((p) => p.position)) + 1, live: false, pending: 'add', published_at: null, created_at: new Date().toISOString(), restaurant: byId(id) });
        else if (row.pending === 'remove') row.pending = null;
      } else if (row?.live) row.pending = 'remove';
      else if (row) picks = picks.filter((p) => p !== row);
    },
    async setOrder(list, ids) {
      await pause();
      const rows = of(list);
      const named = ids.map((id) => rows.find((r) => r.restaurant_id === id)).filter(Boolean);
      [...named, ...rows.filter((r) => !named.includes(r))].forEach((r, i) => {
        r.position = i + 1;
      });
    },
    async publish() {
      await pause();
      const n = picks.filter((p) => p.pending).length;
      picks = picks.filter((p) => p.pending !== 'remove');
      for (const p of picks) if (p.pending === 'add') Object.assign(p, { live: true, pending: null, published_at: new Date().toISOString() });
      return n;
    },
  };
}

const api = DEMO ? demoApi() : liveApi();

// ───────────────────────── what is on screen ─────────────────────────

let picks = []; // every row of every list, drafts included
let status = {}; // the countdown and what is waiting
let found = { q: '', bite: [], google: null }; // the search panel
let busy = false; // one change at a time

const rowsOf = (list) => picks.filter((p) => p.list === list && p.restaurant);
const pickOf = (list, id) => picks.find((p) => p.list === list && p.restaurant_id === id);
// On the list as far as an editor is concerned: there, and not on its way out.
const isOn = (list, id) => {
  const p = pickOf(list, id);
  return Boolean(p) && p.pending !== 'remove';
};

async function refresh() {
  [picks, status] = await Promise.all([api.picks(), api.status()]);
  renderLists();
  renderStatus();
  renderResults();
}

// Runs one change, then reads everything back from the database, so the
// page always shows what is really saved.
async function change(work, done) {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  try {
    await work();
    await refresh();
    if (done) toast(done);
  } catch (e) {
    toast(explain(e), true);
    await refresh().catch(() => {});
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}

function renderStatus() {
  const waiting = (status.pending_add ?? 0) + (status.pending_remove ?? 0);
  const next = status.next_publish ? new Date(status.next_publish) : null;
  const when = next && !Number.isNaN(next.getTime())
    ? next.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
    : null;
  $('status').textContent = waiting
    ? `${waiting} change${waiting === 1 ? '' : 's'} waiting${when ? `, going live ${when}` : ''}`
    : `Nothing waiting${when ? `. Next publish ${when}` : ''}`;
  $('publish').disabled = waiting === 0;
}

function renderLists() {
  const grid = $('lists');
  grid.replaceChildren(
    ...LISTS.map((list) => {
      const rows = rowsOf(list.key);
      const live = rows.filter((r) => r.live && r.pending !== 'remove').length;
      const adding = rows.filter((r) => r.pending === 'add').length;
      const removing = rows.filter((r) => r.pending === 'remove').length;
      const count = [`${live} live`, adding ? `${adding} to add` : null, removing ? `${removing} to remove` : null]
        .filter(Boolean)
        .join(' · ');

      let rank = 0;
      const items = [];
      for (const r of rows) {
        const leaving = r.pending === 'remove';
        if (!leaving) rank += 1;
        const beyond = list.key === 'top25' && !leaving && rank > TOP25_SHOWN;
        if (list.key === 'top25' && !leaving && rank === TOP25_SHOWN + 1) {
          items.push(el('li', { class: 'cut', text: `The app shows the first ${TOP25_SHOWN}. These are waiting below the line.` }));
        }
        let note = placeMeta(r.restaurant);
        if (list.key === 'newly_opened' && r.live && r.published_at) {
          const left = NEWLY_OPENED_DAYS - Math.floor((Date.now() - new Date(r.published_at).getTime()) / DAY);
          note = `${left > 0 ? `${left} day${left === 1 ? '' : 's'} left` : 'No longer shown'}${note ? ` · ${note}` : ''}`;
        }
        items.push(
          el('li', { class: `row${leaving ? ' removing' : ''}${beyond ? ' beyond' : ''}`, data: { id: r.restaurant_id } }, [
            el('span', { class: 'rank', text: leaving ? '' : String(rank) }),
            el('div', {}, [
              el('div', { class: 'row-name', text: r.restaurant.name, title: r.restaurant.name }),
              note ? el('div', { class: 'row-meta', text: note }) : null,
            ]),
            el('div', { class: 'row-side' }, [
              r.pending === 'add' ? el('span', { class: 'badge add', text: 'Draft' }) : null,
              leaving ? el('span', { class: 'badge remove', text: 'Removing' }) : null,
              el('button', {
                class: 'icon',
                type: 'button',
                text: leaving ? 'Undo' : 'Remove',
                'aria-label': `${leaving ? 'Keep' : 'Remove'} ${r.restaurant.name}`,
                on: {
                  click: () =>
                    change(
                      () => api.setPick(list.key, r.restaurant_id, leaving),
                      leaving ? 'Kept on the list' : r.live ? 'Will be removed at the next publish' : 'Draft removed',
                    ),
                },
              }),
            ]),
          ]),
        );
      }

      const ol = el('ol', { class: 'rows', data: { list: list.key } }, items);
      Sortable.create(ol, {
        animation: 160,
        draggable: '.row',
        filter: 'button',
        preventOnFilter: false,
        onEnd: (evt) => {
          if (evt.oldIndex === evt.newIndex) return;
          const ids = [...ol.querySelectorAll('.row')].map((n) => n.dataset.id);
          change(() => api.setOrder(list.key, ids), 'Order saved');
        },
      });

      return el('section', { class: 'card list' }, [
        el('div', { class: 'list-head' }, [el('h3', { text: list.label }), el('p', { class: 'list-count', text: count })]),
        rows.length ? ol : el('p', { class: 'empty', text: 'Nothing here yet. Search on the left and add a place.' }),
      ]);
    }),
  );
}

// One search result, with a button for each list.
function resultCard(place, source) {
  const id = place.id ?? null;
  const meta = id ? placeMeta(place) : [place.kind, place.address].filter(Boolean).join(' · ');
  return el('div', { class: 'result' }, [
    el('div', {}, [
      el('span', { class: 'result-name', text: place.name }),
      source ? el('span', { class: 'result-source', text: source }) : null,
    ]),
    meta ? el('div', { class: 'result-meta', text: meta }) : null,
    el(
      'div',
      { class: 'chips' },
      LISTS.map((list) => {
        const on = id ? isOn(list.key, id) : false;
        return el('button', {
          class: `chip${on ? ' on' : ''}`,
          type: 'button',
          disabled: on,
          text: on ? `On ${list.label}` : `Add to ${list.label}`,
          on: {
            click: () =>
              change(async () => {
                // A place Google found is saved into Bite first.
                const rid = id ?? (await api.saveGooglePlace(place));
                if (!id) {
                  place.id = rid;
                  const tags = classify(place.kind);
                  Object.assign(place, { cuisine: tags.cuisine, subcuisine: tags.subcuisine, area: areaFromAddress(place.address) });
                }
                await api.setPick(list.key, rid, true);
              }, `Added to ${list.label} as a draft`),
          },
        });
      }),
    ),
  ]);
}

const GOOGLE_SAYS = {
  not_configured: 'Searching all of Singapore is not switched on yet. It needs the Google key added in Supabase.',
  not_admin: 'This account is not an admin.',
  not_signed_in: 'You have been signed out. Reload the page and sign in again.',
  bad_query: 'Type at least two letters.',
  google_failed: 'Google did not answer. Try again in a moment.',
  failed: 'The search did not go through. Try again in a moment.',
};

function renderResults() {
  const box = $('results');
  const kids = [];
  if (found.bite.length) {
    kids.push(el('p', { class: 'group-title', text: 'Already on Bite' }));
    kids.push(...found.bite.map((p) => resultCard(p, null)));
  }
  if (found.google) {
    if (!found.google.ok) {
      kids.push(el('p', { class: 'error', text: GOOGLE_SAYS[found.google.reason] ?? GOOGLE_SAYS.failed }));
    } else {
      // A place Bite already has is shown once, as Bite's.
      const known = new Set(found.bite.map((p) => p.place_id));
      const fresh = found.google.places.filter((p) => !known.has(p.place_id));
      kids.push(el('p', { class: 'group-title', text: 'From all of Singapore' }));
      if (fresh.length) kids.push(...fresh.map((p) => resultCard(p, p.id ? null : 'New to Bite')));
      else kids.push(el('p', { class: 'empty', text: 'Nothing else found. Try the full name, or add the street.' }));
    }
  } else if (found.q.length >= 2 && !found.bite.length) {
    kids.push(el('p', { class: 'empty', text: 'Not on Bite yet. Press Enter to search all of Singapore.' }));
  }
  box.replaceChildren(...kids);
}

// ───────────────────────── wiring ─────────────────────────

let typing = null;
let searchRun = 0;

async function searchBite() {
  const q = $('search').value.trim();
  const run = ++searchRun;
  found = { q, bite: [], google: null };
  if (q.length >= 2) {
    try {
      const hits = await api.searchBite(q);
      if (run !== searchRun) return; // a newer search has started
      found.bite = hits;
    } catch (e) {
      toast(explain(e), true);
    }
  }
  renderResults();
}

async function searchEverywhere() {
  const q = $('search').value.trim();
  if (q.length < 2) {
    found.google = { ok: false, reason: 'bad_query' };
    renderResults();
    return;
  }
  clearTimeout(typing);
  const button = $('search-all');
  button.disabled = true;
  button.textContent = 'Searching…';
  try {
    await searchBite();
    const run = searchRun;
    const res = await api.searchGoogle(q);
    if (run !== searchRun) return;
    if (res.ok) {
      // Places Google found that Bite already has: use Bite's row.
      const ids = res.places.map((p) => p.place_id);
      const have = new Map(picks.filter((p) => p.restaurant?.place_id && ids.includes(p.restaurant.place_id)).map((p) => [p.restaurant.place_id, p.restaurant]));
      res.places = res.places.map((p) => (have.has(p.place_id) ? { ...p, ...have.get(p.place_id) } : p));
    }
    found.google = res;
    renderResults();
  } finally {
    button.disabled = false;
    button.textContent = 'Search all of Singapore';
  }
}

async function enter() {
  const user = await api.user();
  if (!user) {
    show('signin');
    return;
  }
  let admin = false;
  try {
    admin = await api.isAdmin();
  } catch (e) {
    $('signin-error').textContent = explain(e);
    $('signin-error').hidden = false;
    show('signin');
    return;
  }
  if (!admin) {
    show('denied');
    return;
  }
  $('demo-flag').hidden = !DEMO;
  show('app');
  try {
    await refresh();
  } catch (e) {
    toast(explain(e), true);
  }
}

$('signin-form').addEventListener('submit', async (evt) => {
  evt.preventDefault();
  const button = $('signin-button');
  $('signin-error').hidden = true;
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    await api.signIn($('email').value.trim(), $('password').value);
    $('password').value = '';
    await enter();
  } catch (e) {
    $('signin-error').textContent = explain(e);
    $('signin-error').hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});

$('google').addEventListener('click', async () => {
  const button = $('google');
  $('signin-error').hidden = true;
  button.disabled = true;
  button.textContent = 'Opening Google…';
  try {
    await api.signInWithGoogle();
    // The page is leaving for Google now; nothing more to do here.
  } catch (e) {
    $('signin-error').textContent = explain(e);
    $('signin-error').hidden = false;
    button.disabled = false;
    button.textContent = 'Continue with Google';
  }
});

for (const id of ['signout', 'denied-signout']) {
  $(id).addEventListener('click', async () => {
    await api.signOut();
    if (DEMO) location.search = '';
    else show('signin');
  });
}

$('search').addEventListener('input', () => {
  clearTimeout(typing);
  typing = setTimeout(searchBite, 220);
});

$('search-form').addEventListener('submit', (evt) => {
  evt.preventDefault();
  searchEverywhere();
});

$('publish').addEventListener('click', () => {
  const waiting = (status.pending_add ?? 0) + (status.pending_remove ?? 0);
  if (!waiting) return;
  const sure = window.confirm(
    `Publish ${waiting} change${waiting === 1 ? '' : 's'} now?\n\n` +
      'They go live for everyone, and every account gets one notification from @bite. ' +
      'The monthly clock restarts. This cannot be undone.',
  );
  if (!sure) return;
  change(async () => {
    const n = await api.publish();
    toast(`${n} change${n === 1 ? '' : 's'} published`);
  });
});

// Back from Google with a refusal: it arrives in the address. Say it
// plainly, then tidy the address so a reload does not repeat it.
{
  const back = new URLSearchParams(location.hash.replace(/^#/, '') || location.search);
  const why = back.get('error_description') || back.get('error');
  if (why) {
    $('signin-error').textContent = `Google sign-in did not finish: ${why.replace(/\+/g, ' ')}`;
    $('signin-error').hidden = false;
    history.replaceState(null, '', location.pathname);
  }
}

enter().catch((e) => {
  $('signin-error').textContent = explain(e);
  $('signin-error').hidden = false;
  show('signin');
});
