// Bite HQ on the web: the admin's editor for Bite's hand-picked lists.
//
// What it can do is decided by the database, not by this page. Every
// change goes through a function that first asks "is this person an
// admin?" (set_editor_pick, set_editor_pick_order, publish_editor_picks,
// hq_place_stats, hq_totals, and the hq-places search). Someone who
// finds this address and has no admin account can sign in to nothing.
//
// Add ?demo to the address to try the page with made-up places. Demo
// mode never talks to the database.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/+esm';
import { SUPABASE_URL, SUPABASE_KEY, LISTS, NEWLY_OPENED_DAYS, TOP25_SHOWN } from './config.js';
import { classify, cuisineLabel } from './tags-cuisines.js';
import { areaFromAddress, areaLabel } from './tags-areas.js';
import { initOps } from './ops.js';

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
  // The close-up panel sits above everything, so while it is open the
  // message is written inside it instead.
  const note = $('panel').open ? document.getElementById('panel-note') : null;
  if (note) {
    note.textContent = message;
    note.className = bad ? 'error' : 'quiet small';
    note.hidden = false;
    return;
  }
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

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-SG')} ${n === 1 ? one : many}`;

const placeMeta = (r) =>
  [cuisineLabel(r.cuisine, r.subcuisine), areaLabel(r.area)].filter(Boolean).join(' · ') || r.address || '';

// What Google says about a place, in one line: "Barbecue Restaurant · 4.5 on Google (2,629)".
function googleLine(p) {
  const rating = typeof p.rating === 'number'
    ? `${p.rating.toFixed(1)} on Google${p.rating_count ? ` (${p.rating_count.toLocaleString('en-SG')})` : ''}`
    : null;
  const price = p.price_level ? '$'.repeat(p.price_level) : null;
  return [p.kind, rating, price].filter(Boolean).join(' · ');
}

// Closed places must be impossible to miss.
const CLOSED = { CLOSED_PERMANENTLY: 'Closed for good', CLOSED_TEMPORARILY: 'Closed for now' };

// A link that opens Google Maps in a new tab.
function mapsLink(url, text = 'Open in Google Maps') {
  if (!url || !/^https:\/\//.test(url)) return null;
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text });
}

// Bite's own numbers for a place, in one line.
function statsLine(s) {
  if (!s) return '';
  return [
    s.visits ? plural(s.visits, 'visit') : null,
    s.avg_score != null ? `${Number(s.avg_score).toFixed(1)} average` : null,
    s.saves ? plural(s.saves, 'save') : null,
    s.guides ? `in ${plural(s.guides, 'guide')}` : null,
  ].filter(Boolean).join(' · ');
}

// ───────────────────────── the data, live ─────────────────────────

function liveApi() {
  const db = createClient(SUPABASE_URL, SUPABASE_KEY);
  const must = ({ data, error }) => {
    if (error) throw error;
    return data;
  };
  // A name typed into the box, made safe to use inside a "contains" search.
  const like = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const PLACE = 'id, place_id, name, cuisine, subcuisine, area, address, maps_url';
  // Asks the hq-places function, which holds the Google key and checks
  // the caller is an admin.
  const google = async (body) => {
    const { data, error } = await db.functions.invoke('hq-places', { body });
    if (error) {
      let reason = '';
      try {
        reason = (await error.context?.json())?.reason ?? '';
      } catch {
        // No readable answer: the general message will do.
      }
      return { ok: false, reason: reason || 'failed' };
    }
    return data ?? { ok: false, reason: 'failed' };
  };
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
    // The first name of whoever is signed in, for the greeting.
    async myName() {
      const user = (await db.auth.getSession()).data.session?.user;
      if (!user) return '';
      const { data } = await db.from('profiles').select('display_name, username').eq('id', user.id).maybeSingle();
      return (data?.display_name || data?.username || '').trim().split(/\s+/)[0] ?? '';
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
    // Bite's own numbers. null when migration 066 has not been run yet.
    async stats() {
      const { data, error } = await db.rpc('hq_place_stats');
      return error ? null : data ?? [];
    },
    async totals() {
      const { data, error } = await db.rpc('hq_totals');
      return error ? null : data ?? {};
    },
    // History, closed places and guides (migration 067). The three that
    // read answer null when that migration has not been run yet.
    async log() {
      const { data, error } = await db.rpc('hq_log_recent', { p_limit: 150 });
      return error ? null : data ?? [];
    },
    async statuses() {
      const { data, error } = await db.rpc('hq_place_status_get');
      return error ? null : data ?? [];
    },
    async saveStatuses(items) {
      must(await db.rpc('hq_place_status_set', { p_items: items }));
    },
    async guides() {
      const { data, error } = await db.rpc('hq_guides');
      return error ? null : data ?? [];
    },
    async saveGuide(g) {
      return must(
        await db.rpc('hq_guide_save', {
          p_id: g.id,
          p_title: g.title,
          p_tagline: g.tagline,
          p_description: g.description,
          p_visibility: g.visibility,
          p_items: g.items.map((i) => ({ restaurant_id: i.restaurant_id, note: i.note ?? '' })),
        }),
      );
    },
    async deleteGuide(id) {
      return must(await db.rpc('hq_guide_delete', { p_id: id }));
    },
    async searchBite(q) {
      return must(await db.from('restaurants').select(PLACE).ilike('name', like(q)).order('name').limit(8));
    },
    searchGoogle: (q) => google({ action: 'search', q }),
    placeDetails: (placeId) => google({ action: 'place', place_id: placeId }),
    checkStatuses: (placeIds) => google({ action: 'status', place_ids: placeIds }),
    thumbs: (placeIds) => google({ action: 'thumbs', place_ids: placeIds }),
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
    // The operations pages (migration 072). The four that read answer
    // null when the database does not have them yet.
    async pulse() {
      const { data, error } = await db.rpc('hq_pulse');
      return error ? null : data ?? null;
    },
    async people() {
      const { data, error } = await db.rpc('hq_people');
      return error ? null : data ?? [];
    },
    async inbox() {
      const { data, error } = await db.rpc('hq_inbox');
      return error ? null : data ?? null;
    },
    async bugs() {
      const { data, error } = await db.rpc('admin_errors');
      return error ? null : data ?? null;
    },
    // Sentry and PostHog, through the function that holds their keys.
    async signals() {
      const { data, error } = await db.functions.invoke('hq-signals', { body: {} });
      return error ? null : data ?? null;
    },
    async resolveBug(fingerprint, status) {
      must(await db.rpc('admin_resolve_error', { p_fingerprint: fingerprint, p_status: status }));
    },
    async resolveReport(id, action) {
      must(await db.rpc('admin_resolve_report', { p_report: id, p_action: action }));
    },
    async requestStatus(id, status) {
      must(await db.rpc('hq_request_status', { p_id: id, p_status: status }));
    },
  };
}

// ───────────────────────── the data, made up ─────────────────────────
// Behaves like the real thing (drafts, publish, ranking, photos, numbers)
// with invented places, so the page can be tried and tested without
// touching Bite.

function demoApi() {
  // A flat colour block standing in for a photo.
  const swatch = (n) => {
    const hues = ['#B5D334', '#E08A63', '#EBC64E', '#8DB3A7', '#C9A27E', '#9CAE5B'];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="${hues[n % hues.length]}"/><circle cx="160" cy="120" r="54" fill="#fff" fill-opacity="0.35"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };
  const place = (n, name, cuisine, area) => ({
    id: `demo-${n}`, place_id: `g-${n}`, name, cuisine, subcuisine: null, area,
    address: `${n} Demo Street, Singapore`, maps_url: 'https://www.google.com/maps',
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
    { place_id: 'g-21', name: 'Far East Noodle House', address: '21 Demo Street, Singapore 088421', kind: 'Noodle Shop', rating: 4.4, rating_count: 812, status: 'OPERATIONAL', price_level: 1 },
    { place_id: 'g-22', name: 'Harbour Grill', address: '22 Demo Street, Singapore 098585', kind: 'Steak House', rating: 4.1, rating_count: 2310, status: 'CLOSED_PERMANENTLY', price_level: 3 },
    { place_id: 'g-23', name: 'Kopi & Kaya', address: '23 Demo Street, Singapore 427447', kind: 'Cafe', rating: 4.7, rating_count: 156, status: 'OPERATIONAL', price_level: 1 },
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
  const numbers = [
    [1, 31, 4.6, 44, 6, 5, 3], [2, 58, 4.2, 20, 9, 2, 1], [3, 12, 4.8, 37, 4, 4, 9], [5, 22, 3.9, 8, 2, 0, 0],
    [6, 9, 4.9, 61, 5, 1, 12], [8, 17, 4.4, 15, 3, 6, 2], [12, 26, 4.1, 5, 1, 7, 0], [10, 3, 4.5, 19, 2, 0, 4],
  ];
  const of = (list) => picks.filter((p) => p.list === list).sort((a, b) => a.position - b.position);
  const pause = () => new Promise((done) => setTimeout(done, 120));
  // One listed place has shut, so the warning has something to show.
  let statusRows = [{ restaurant_id: 'demo-6', status: 'CLOSED_PERMANENTLY', checked_at: ago(1) }];
  let logRows = [
    { at: ago(0.02), actor: 'arnold', action: 'added', list: 'top25', place_name: 'Laksa Republic', detail: {} },
    { at: ago(0.05), actor: 'arnold', action: 'removing', list: 'top25', place_name: 'Seoul Night Grill', detail: {} },
    { at: ago(1), actor: 'bite', action: 'reordered', list: 'top25', place_name: null, detail: { moved: 4 } },
    { at: ago(2), actor: 'bite', action: 'guide_saved', list: null, place_name: null, detail: { title: 'Supper after midnight', places: 3, visibility: 'public' } },
    { at: ago(16), actor: null, action: 'went_live', list: 'newly_opened', place_name: 'Brand New Bistro', detail: {} },
  ];
  const note = (action, more) => logRows.unshift({ at: new Date().toISOString(), actor: 'demo', place_name: null, list: null, detail: {}, action, ...more });
  let guideRows = [
    {
      id: 'guide-1', title: 'Supper after midnight', tagline: 'Open late, worth it', description: 'Where to go when everything else has shut.',
      visibility: 'public', created_at: ago(9), saves: 12,
      items: [[12, 'Wok hei at 1am. Order the hor fun.'], [2, 'The queue is shorter after midnight.'], [5, '']].map(([n, text]) => ({
        restaurant_id: `demo-${n}`, note: text, restaurant: byId(`demo-${n}`),
      })),
    },
  ];
  // The operations pages, with invented members.
  const person = (n, name, joined, seen, days, visits, saves, guides, followers, update, recent) => ({
    id: `member-${n}`, username: name.toLowerCase().replace(/[^a-z]/g, ''), display_name: name, is_admin: n === 1, is_private: n % 3 === 0,
    joined: ago(joined), setup: n !== 7, last_seen: seen == null ? null : ago(seen), days_14: days,
    visits, saves, guides, followers, following: followers + 2,
    recent: recent.map(([what, d]) => ({ name: what, at: ago(d) })),
    running: seen == null ? null : {
      update: update ? `update-${update}` : null, update_at: update ? ago(update) : null, build: '2', version: '1.0.0',
      device: ['iPhone 15 Pro', 'iPhone 13', 'iPhone 16', 'iPhone 14'][n % 4], os: `ios 18.${n % 4}`, at: ago(seen),
    },
  });
  const members = [
    person(1, 'Arnold', 100, 0.02, 12, 14, 22, 4, 9, 0.4, [['rank', 0.1], ['playlist_create', 2]]),
    person(2, 'Mei Ling', 20, 0.2, 9, 8, 15, 1, 5, 0.4, [['rank', 0.2], ['wishlist_save', 0.3], ['feature_vote', 1]]),
    person(3, 'Arjun', 12, 1, 6, 3, 9, 0, 3, 0.4, [['wishlist_save', 1], ['rank', 4]]),
    person(4, 'Sam', 2, 0.5, 2, 0, 4, 0, 1, 3, [['wishlist_save', 0.5], ['onboarding_complete', 2]]),
    person(5, 'Hannah', 1, 0.8, 1, 1, 0, 0, 0, 0.4, [['rank', 0.8], ['signup', 1]]),
    person(6, 'Wei Jie', 30, 9, 0, 2, 6, 1, 2, 12, [['rank', 9], ['import_list', 20]]),
    person(7, 'Priya', 8, 6, 1, 0, 0, 0, 0, 3, []),
    person(8, 'Daniel', 16, 12, 0, 0, 1, 0, 1, null, [['wishlist_save', 13]]),
    person(9, 'Nurul', 5, null, 0, 0, 0, 0, 0, null, []),
  ];
  let bugRows = [
    { fingerprint: 'bug-1', kind: 'request', title: '403 GET profiles: permission denied for table profiles', status: 'open', note: null, fixed_in: null, count: 6, count_7d: 6, users: 3, first_seen: ago(3), last_seen: ago(0.3), reopened_at: null,
      sample: { message: '403 GET profiles: permission denied for table profiles', stack: 'at fetchProfile (lib/profiles.ts:41)\nat FeedScreen (app/(tabs)/feed.tsx:212)', screen: '/feed', app_version: '1.0.0', platform: 'ios', os_version: '18.1', device: 'iPhone 15 Pro', created_at: ago(0.3) } },
    { fingerprint: 'bug-2', kind: 'render', title: 'Cannot read property ‘length’ of undefined', status: 'open', note: null, fixed_in: null, count: 2, count_7d: 2, users: 1, first_seen: ago(1), last_seen: ago(1), reopened_at: ago(1),
      sample: { message: 'Cannot read property ‘length’ of undefined', stack: 'at GuideRow (components/GuideRow.tsx:58)', screen: '/playlist/:id', app_version: '1.0.0', platform: 'ios', os_version: '17.6', device: 'iPhone 13', created_at: ago(1) } },
    { fingerprint: 'bug-3', kind: 'request', title: '409 POST entries: duplicate key value violates unique constraint', status: 'fixed', note: 'Double tap on Save', fixed_in: '1.0.0', count: 4, count_7d: 0, users: 2, first_seen: ago(30), last_seen: ago(21), reopened_at: null,
      sample: { message: '409 POST entries: duplicate key', stack: null, screen: '/add', app_version: '1.0.0', platform: 'ios', os_version: '18.0', device: 'iPhone 14', created_at: ago(21) } },
  ];
  let reportRows = [
    { id: 'report-1', target_type: 'comment', target_id: 'c1', target_user_id: 'member-8', reason: 'spam', details: null, status: 'open', created_at: ago(0.4), reporter: 'Mei Ling', target_name: 'Daniel', target_username: 'daniel', preview: 'Cheap followers, link in my profile!!', against_user: 2 },
    { id: 'report-2', target_type: 'post', target_id: 'p1', target_user_id: 'member-6', reason: 'false_info', details: 'This place closed last year.', status: 'open', created_at: ago(2), reporter: 'Arjun', target_name: 'Wei Jie', target_username: 'weijie', preview: 'Best prata in town, open till 3am.', against_user: 1 },
  ];
  let requestRows = [
    { id: 'ask-1', title: 'Let me share a guide to WhatsApp', status: 'open', created_at: ago(3), username: 'meiling', display_name: 'Mei Ling', votes: 7 },
    { id: 'ask-2', title: 'A map of everywhere I have saved', status: 'planned', created_at: ago(9), username: 'arjun', display_name: 'Arjun', votes: 5 },
    { id: 'ask-3', title: 'Halal filter on Explore', status: 'open', created_at: ago(1), username: 'nurul', display_name: 'Nurul', votes: 3 },
    { id: 'ask-4', title: 'Dark mode', status: 'shipped', created_at: ago(40), username: 'sam', display_name: 'Sam', votes: 2 },
  ];
  return {
    async pulse() {
      const open = bugRows.filter((b) => b.status === 'open');
      const today = new Date();
      const waiting = reportRows.length;
      const asks = requestRows.filter((r) => r.status === 'open').length;
      return {
        members: 214, members_week: 31, active_week: 96, visits: 178, visits_week: 42, visit_people: 61, saves: 409, saves_week: 55,
        open_bugs: open.length, newest_bug: open[0]?.last_seen ?? null,
        days: [8, 11, 9, 14, 17, 22, 19, 21, 26, 24, 31, 38, 35, 41].map((n, i) => {
          const d = new Date(today.getTime() - (13 - i) * DAY);
          return { d: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, n };
        }),
        funnel: [['signed', 214], ['setup', 188], ['followed', 140], ['placed', 122], ['visited', 61], ['regular', 23]].map(([key, n]) => ({ key, n })),
        screens: [['/feed', 2140], ['/recs', 1620], ['/profile', 980], ['/restaurant/:id', 760], ['/post/:id', 410], ['/add', 230], ['/curated/top25', 190], ['/notifications', 150]].map(([path, n]) => ({ path, n })),
        todo: [
          waiting ? { key: 'reports', level: 'hot', go: 'inbox', title: `${waiting} report${waiting === 1 ? ' is' : 's are'} waiting`, detail: 'Someone flagged something. Remove it or dismiss it.' } : null,
          open.length ? { key: 'bugs', level: 'hot', go: 'health', title: `${open.length} bug${open.length === 1 ? ' is' : 's are'} open`, detail: `Newest: "${open[0].title}", last seen today.` } : null,
          { key: 'save_not_log', level: 'do', go: 'people', title: 'People save, they do not log', detail: '409 saves against 178 visits. Logging is the habit that makes Bite stick.' },
          asks ? { key: 'requests', level: 'do', go: 'inbox', title: `${asks} feature request${asks === 1 ? ' is' : 's are'} waiting`, detail: 'Mark each one planned or shipped, so people see they were heard.' } : null,
          { key: 'quiet', level: 'do', go: 'people', title: '3 members have gone quiet', detail: 'They used Bite before and have not opened it in a week.' },
          { key: 'lists', level: 'do', go: 'lists', title: 'Bite’s lists are thin', detail: 'Top 25 has 5 of 25. Newly Opened has 1, Sweet Tooth has 2, Coffee & Matcha has 2.' },
        ].filter(Boolean),
      };
    },
    async people() {
      return members.map((m) => ({ ...m }));
    },
    async inbox() {
      return { reports: reportRows.map((r) => ({ ...r })), requests: requestRows.map((r) => ({ ...r })).sort((a, b) => (b.status === 'open') - (a.status === 'open') || b.votes - a.votes) };
    },
    async bugs() {
      return { open: bugRows.filter((b) => b.status === 'open').length, reports_7d: 8, users_7d: 3, issues: bugRows.map((b) => ({ ...b })).sort((a, b) => (b.status === 'open') - (a.status === 'open')) };
    },
    async signals() {
      await pause();
      return {
        ok: true,
        sentry: {
          connected: true, crash_free: 0.992, sessions: 1240, url: 'https://sentry.io',
          issues: [
            { id: 'BITE-7', title: 'Video picker ran out of memory', culprit: 'add', level: 'fatal', count: 5, users: 3, first_seen: ago(2), last_seen: ago(0.1), url: 'https://sentry.io' },
            { id: 'BITE-6', title: 'Unable to open URL: mailto', culprit: 'settings', level: 'error', count: 1, users: 1, first_seen: ago(3), last_seen: ago(3), url: 'https://sentry.io' },
          ],
        },
        posthog: {
          connected: true, sessions: 1240, people: 131, signed_in: 96, avg_seconds: 250, url: 'https://us.posthog.com',
          devices: [{ name: 'iPhone 15 Pro', n: 31 }, { name: 'iPhone 13', n: 22 }, { name: 'iPhone 16', n: 18 }],
          systems: [{ name: 'iOS 18.1', n: 61 }, { name: 'iOS 17.6', n: 20 }],
        },
      };
    },
    async resolveBug(fingerprint, status) {
      await pause();
      const b = bugRows.find((x) => x.fingerprint === fingerprint);
      if (b) Object.assign(b, { status, reopened_at: null });
    },
    async resolveReport(id) {
      await pause();
      reportRows = reportRows.filter((r) => r.id !== id);
    },
    async requestStatus(id, status) {
      await pause();
      const q = requestRows.find((x) => x.id === id);
      if (q) q.status = status;
    },
    async user() {
      return { email: 'demo@bite' };
    },
    async signIn() {},
    async signInWithGoogle() {},
    async signOut() {},
    async isAdmin() {
      return true;
    },
    async myName() {
      return 'Arnold';
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
    async stats() {
      return numbers.map(([n, visits, avg, saves, guides, vr, sr]) => ({
        ...byId(`demo-${n}`), visits, avg_score: avg, saves, guides, visits_recent: vr, saves_recent: sr, last_visit: ago(2),
      }));
    },
    async totals() {
      return { accounts: 214, accounts_week: 31, visits: 178, visits_week: 42, saves: 209, saves_week: 55, guides: 23, places: 412 };
    },
    async log() {
      return logRows.map((r) => ({ ...r }));
    },
    async statuses() {
      return statusRows.map((r) => ({ ...r }));
    },
    async saveStatuses(items) {
      for (const it of items) {
        statusRows = statusRows.filter((r) => r.restaurant_id !== it.id);
        statusRows.push({ restaurant_id: it.id, status: it.status, checked_at: new Date().toISOString() });
      }
    },
    async checkStatuses(placeIds) {
      await pause();
      return { ok: true, places: placeIds.map((id) => ({ place_id: id, status: id === 'g-6' ? 'CLOSED_PERMANENTLY' : 'OPERATIONAL' })) };
    },
    async thumbs(placeIds) {
      await pause();
      return { ok: true, places: placeIds.map((id, i) => ({ place_id: id, photo: swatch(i) })) };
    },
    async guides() {
      return guideRows.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) }));
    },
    async saveGuide(g) {
      await pause();
      const items = g.items.map((i) => ({ restaurant_id: i.restaurant_id, note: (i.note ?? '').trim(), restaurant: byId(i.restaurant_id) ?? i.restaurant }));
      if (g.visibility !== 'private' && !items.length) throw new Error('a guide people can see needs at least one place');
      const id = g.id ?? `guide-${Date.now()}`;
      const old = guideRows.find((x) => x.id === id);
      const row = { id, title: g.title.trim(), tagline: g.tagline, description: g.description, visibility: g.visibility, created_at: old?.created_at ?? new Date().toISOString(), saves: old?.saves ?? 0, items };
      guideRows = [row, ...guideRows.filter((x) => x.id !== id)];
      note(old ? 'guide_saved' : 'guide_created', { detail: { title: row.title, places: items.length, visibility: row.visibility } });
      return id;
    },
    async deleteGuide(id) {
      const old = guideRows.find((x) => x.id === id);
      guideRows = guideRows.filter((x) => x.id !== id);
      if (old) note('guide_deleted', { detail: { title: old.title } });
      return Boolean(old);
    },
    async searchBite(q) {
      await pause();
      return places.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
    },
    async searchGoogle(q) {
      await pause();
      const hits = far.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
      // As the real search answers: Google's own fields, never a Bite id.
      return {
        ok: true,
        places: (hits.length ? hits : far).map((p, i) => ({
          ...p, lat: 1.3, lng: 103.8, maps_url: 'https://www.google.com/maps', photo_ref: null, photo: swatch(i),
        })),
      };
    },
    async placeDetails(placeId) {
      await pause();
      const p = far.find((x) => x.place_id === placeId) ?? places.find((x) => x.place_id === placeId);
      if (!p) return { ok: false, reason: 'bad_place' };
      return {
        ok: true,
        place: {
          rating: 4.5, rating_count: 640, status: 'OPERATIONAL', kind: 'Restaurant', price_level: 2, ...p,
          maps_url: 'https://www.google.com/maps',
          photos: [0, 1, 2, 3, 4, 5].map((i) => ({ uri: swatch(i + 1), author: ['Mei Ling', 'Arjun', 'Sam'][i % 3] })),
        },
      };
    },
    async saveGooglePlace(p) {
      const have = places.find((x) => x.place_id === p.place_id);
      if (have) return have.id;
      const tags = classify(p.kind);
      const made = { id: `demo-${p.place_id}`, place_id: p.place_id, name: p.name, cuisine: tags.cuisine, subcuisine: tags.subcuisine, area: areaFromAddress(p.address), address: p.address, maps_url: p.maps_url };
      places.push(made);
      return made.id;
    },
    async setPick(list, id, on) {
      await pause();
      const row = picks.find((p) => p.list === list && p.restaurant_id === id);
      note(on ? (row ? 'kept' : 'added') : row?.live ? 'removing' : 'draft_removed', { list, place_name: byId(id)?.name ?? null });
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
      note('reordered', { list, detail: { moved: rows.length } });
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

// Pulse, People, Health and Inbox live in their own file.
const ops = initOps({ el, $, api, toast, explain, plural, setTab: (name) => setTab(name) });

// ───────────────────────── what is on screen ─────────────────────────

let picks = []; // every row of every list, drafts included
let status = {}; // the countdown and what is waiting
let stats = null; // Bite's numbers per place; null = not available yet
let statsById = new Map();
let totals = null;
let found = { q: '', bite: [], google: null }; // the search panel
let busy = false; // one change at a time
let panelPlace = null; // the place the close-up panel is showing
let lastDrag = 0; // when a drag last ended, so its click is not a tap
let tab = 'pulse'; // which page is showing: see TABS
let statuses = null; // what Google last said about listed places; null = not available yet
let statusById = new Map();
let checking = false; // a closed-place check is running
let checkFailed = ''; // why the last check did not finish
let guides = null; // Bite's guides; null = not available yet
let draft = null; // the guide open in the editor
let log = null; // the change history; null = not available yet
const thumbs = new Map(); // small photos by Google place id, for rows and previews
const THUMBS_KEY = 'bite-hq-thumbs';
const THUMBS_FOR = 6 * 3600 * 1000; // Google's picture links do not last; six hours is safe
try {
  if (!DEMO) {
    for (const [id, v] of Object.entries(JSON.parse(localStorage.getItem(THUMBS_KEY) ?? '{}'))) {
      if (v && Date.now() - v.t < THUMBS_FOR) thumbs.set(id, v.u);
    }
  }
} catch {
  // A full or blocked store only means the photos are fetched again.
}
const thumbTimes = new Map();
function keepThumbs() {
  if (DEMO) return;
  try {
    const out = {};
    for (const [id, u] of thumbs) out[id] = { u, t: thumbTimes.get(id) ?? Date.now() };
    localStorage.setItem(THUMBS_KEY, JSON.stringify(out));
  } catch {
    // Nothing lost: they are in memory for this visit.
  }
}
// Fetches small photos for places that do not have one yet. Answers true
// if any arrived, so the caller knows to draw again.
async function ensureThumbs(placeIds) {
  const need = [...new Set(placeIds.filter((id) => id && !thumbs.has(id)))];
  let got = false;
  for (let i = 0; i < need.length; i += 40) {
    const res = await api.thumbs(need.slice(i, i + 40)).catch(() => ({ ok: false }));
    if (!res.ok) break;
    for (const p of res.places) {
      thumbs.set(p.place_id, p.photo ?? '');
      thumbTimes.set(p.place_id, Date.now());
    }
    got = true;
  }
  if (got) keepThumbs();
  return got;
}
// A place's photo, or a block with its first letter until one arrives.
function thumbFor(place, cls) {
  const src = thumbs.get(place.place_id);
  if (!src) return el('div', { class: cls, text: (place.name ?? '?').trim().charAt(0).toUpperCase(), 'aria-hidden': 'true' });
  return el('img', {
    class: cls,
    src,
    alt: '',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    draggable: 'false',
    on: {
      // The link has gone stale: forget it, so the next visit asks again.
      error: (evt) => {
        thumbs.delete(place.place_id);
        keepThumbs();
        evt.target.replaceWith(el('div', { class: cls, text: (place.name ?? '?').trim().charAt(0).toUpperCase() }));
      },
    },
  });
}

const rowsOf = (list) => picks.filter((p) => p.list === list && p.restaurant);
const pickOf = (list, id) => picks.find((p) => p.list === list && p.restaurant_id === id);
// On the list as far as an editor is concerned: there, and not on its way out.
const isOn = (list, id) => {
  const p = pickOf(list, id);
  return Boolean(p) && p.pending !== 'remove';
};
const listsOf = (id) => LISTS.filter((l) => isOn(l.key, id)).map((l) => l.label);

async function refresh() {
  [picks, status, stats, totals, statuses, guides, log] = await Promise.all([
    api.picks(), api.status(), api.stats(), api.totals(), api.statuses(), api.guides(), api.log(),
  ]);
  statsById = new Map((stats ?? []).map((s) => [s.id, s]));
  statusById = new Map((statuses ?? []).map((s) => [s.restaurant_id, s]));
  renderTotals();
  renderLists();
  renderClosed();
  renderStatus();
  renderResults();
  renderInsights();
  renderGuidePicker();
  renderHistory();
  if ($('panel').open && panelPlace) renderPanel();
  if ($('preview').open) renderPreview();
  // The operations pages load beside the editor, and never hold it up.
  ops.refresh().catch(() => {});
  // Photos for the places on the lists, then draw the lists again.
  ensureThumbs(picks.map((p) => p.restaurant?.place_id)).then((got) => {
    if (got && !document.querySelector('.sortable-chosen')) renderLists();
  });
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

// Adds a place to a list. One Google found is saved into Bite first.
function addTo(place, list) {
  return change(async () => {
    let id = place.id ?? null;
    if (!id) {
      id = await api.saveGooglePlace(place);
      const tags = classify(place.kind);
      Object.assign(place, { id, cuisine: tags.cuisine, subcuisine: tags.subcuisine, area: areaFromAddress(place.address) });
    }
    await api.setPick(list.key, id, true);
  }, `Added to ${list.label} as a draft`);
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

function renderTotals() {
  const box = $('totals');
  // Pulse has the fuller set of numbers; these are the fallback until
  // the database has it (migration 072).
  if (ops.has()) {
    ops.renderTiles();
    return;
  }
  if (!totals || totals.accounts == null) {
    box.hidden = true;
    return;
  }
  const one = (n, label, week) =>
    el('div', { class: 'total' }, [
      el('b', { text: Number(n ?? 0).toLocaleString('en-SG') }),
      el('span', { text: label }),
      week != null ? el('em', { text: week ? `+${Number(week).toLocaleString('en-SG')} this week` : 'none this week' }) : null,
    ]);
  box.replaceChildren(
    one(totals.accounts, 'accounts', totals.accounts_week),
    one(totals.visits, 'visits logged', totals.visits_week),
    one(totals.saves, 'saves', totals.saves_week),
    one(totals.guides, 'guides'),
    one(totals.places, 'places on Bite'),
  );
  box.hidden = false;
}

// A place's name, which opens the close-up panel. Not a real <button>:
// some browsers will not start a drag from one, and a row must be
// draggable from anywhere on it. It still works from the keyboard.
function nameButton(place, cls) {
  const open = () => {
    // The click that ends a drag is not a tap.
    if (Date.now() - lastDrag < 300) return;
    openPanel(place);
  };
  return el('span', {
    class: cls,
    role: 'button',
    tabindex: '0',
    text: place.name,
    title: 'Photos and numbers',
    on: {
      click: open,
      keydown: (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') {
          evt.preventDefault();
          open();
        }
      },
    },
  });
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
        const numbers = statsLine(statsById.get(r.restaurant_id));
        const shut = CLOSED[statusById.get(r.restaurant_id)?.status];
        items.push(
          el('li', { class: `row${leaving ? ' removing' : ''}${beyond ? ' beyond' : ''}`, data: { id: r.restaurant_id } }, [
            el('span', { class: `rank${!leaving && rank <= 3 ? ' lead' : ''}`, text: leaving ? '' : String(rank) }),
            thumbFor(r.restaurant, 'row-thumb'),
            el('div', {}, [
              nameButton(r.restaurant, 'row-name'),
              note ? el('div', { class: 'row-meta', text: note }) : null,
              numbers ? el('div', { class: 'row-stats', text: numbers }) : null,
              el('div', { class: 'row-badges' }, [
                shut ? el('span', { class: 'badge shut', text: shut }) : null,
                r.pending === 'add' ? el('span', { class: 'badge add', text: 'Draft' }) : null,
                leaving ? el('span', { class: 'badge remove', text: 'Removing' }) : null,
              ]),
            ]),
            el('div', { class: 'row-side' }, [
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
        filter: '.icon',
        preventOnFilter: false,
        onEnd: (evt) => {
          lastDrag = Date.now();
          if (evt.oldIndex === evt.newIndex) return;
          const ids = [...ol.querySelectorAll('.row')].map((n) => n.dataset.id);
          change(() => api.setOrder(list.key, ids), 'Order saved');
        },
      });

      // The colours of this list's own page in the app.
      const page = PAGES[list.key];
      const head = el('div', { class: 'list-head' }, [
        el('div', {}, [el('h3', { text: list.label }), el('p', { class: 'list-count', text: count })]),
        el('button', { class: 'icon', type: 'button', text: 'Preview', title: 'See it as the app shows it', on: { click: () => openPreview(list) } }),
      ]);
      if (page) {
        head.style.background = page.plate;
        head.style.color = page.on;
      }
      return el('section', { class: 'card list' }, [
        head,
        el('div', { class: 'list-body' }, [
          rows.length ? ol : el('p', { class: 'empty', text: 'Nothing here yet. Search on the left and add a place.' }),
        ]),
      ]);
    }),
  );
}

// The buttons that put a place on a list, or in the guide being edited.
function listChips(place) {
  const id = place.id ?? null;
  if (tab === 'guides') {
    const inGuide = Boolean(draft && id && draft.items.some((i) => i.restaurant_id === id));
    return el('div', { class: 'chips' }, [
      el('button', {
        class: `chip${inGuide ? ' on' : ''}`,
        type: 'button',
        disabled: !draft || inGuide,
        text: !draft ? 'Open a guide first' : inGuide ? 'In this guide' : 'Add to this guide',
        on: { click: () => addToGuide(place) },
      }),
    ]);
  }
  return el(
    'div',
    { class: 'chips' },
    LISTS.map((list) => {
      const on = id ? isOn(list.key, id) : false;
      return el('button', {
        class: `chip${on ? ' on' : ''}`,
        type: 'button',
        disabled: on,
        text: on ? `On ${list.label}` : `Add to ${list.label}`,
        on: { click: () => addTo(place, list) },
      });
    }),
  );
}

// One search result: a photo, the facts, a way to check it, the lists.
function resultCard(place, source) {
  const onBite = Boolean(place.id);
  const meta = onBite ? placeMeta(place) : googleLine(place);
  const numbers = onBite ? statsLine(statsById.get(place.id)) : '';
  const closed = CLOSED[place.status];
  const photo = place.photo
    ? el('img', { class: 'thumb', src: place.photo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', on: { click: () => openPanel(place) } })
    : null;
  return el('div', { class: 'result' }, [
    el('div', { class: `result-top${photo ? '' : ' no-photo'}` }, [
      photo,
      el('div', {}, [
        el('div', {}, [
          el('span', { class: 'result-name', text: place.name }),
          source ? el('span', { class: 'result-source', text: source }) : null,
        ]),
        meta ? el('div', { class: 'result-meta', text: meta }) : null,
        !onBite && place.address ? el('div', { class: 'result-meta', text: place.address }) : null,
        numbers ? el('div', { class: 'row-stats', text: numbers }) : null,
        closed ? el('span', { class: 'warn', text: closed }) : null,
        el('div', { class: 'result-links' }, [
          el('button', { class: 'link', type: 'button', text: 'Photos and details', on: { click: () => openPanel(place) } }),
          mapsLink(place.maps_url, 'Google Maps'),
        ]),
      ]),
    ]),
    listChips(place),
  ]);
}

const GOOGLE_SAYS = {
  not_configured: 'Searching all of Singapore is not switched on yet. It needs the Google key added in Supabase.',
  not_admin: 'This account is not an admin.',
  not_signed_in: 'You have been signed out. Reload the page and sign in again.',
  bad_query: 'Type at least two letters.',
  bad_place: 'Google does not know that place any more.',
  google_failed: 'Google did not answer. Try again in a moment.',
  failed: 'That did not go through. Try again in a moment.',
};

function renderResults() {
  const box = $('results');
  const kids = [];
  if (found.bite.length) {
    kids.push(el('p', { class: 'group-title' }, [el('span', { text: 'Already on Bite' })]));
    kids.push(...found.bite.map((p) => resultCard(p, null)));
  }
  if (found.google) {
    if (!found.google.ok) {
      kids.push(el('p', { class: 'error', text: GOOGLE_SAYS[found.google.reason] ?? GOOGLE_SAYS.failed }));
    } else {
      // A place Bite already has is shown once, as Bite's.
      const known = new Set(found.bite.map((p) => p.place_id));
      const fresh = found.google.places.filter((p) => !known.has(p.place_id));
      kids.push(
        el('p', { class: 'group-title' }, [
          el('span', { text: 'From all of Singapore' }),
          el('span', { class: 'google', text: 'Google Maps', translate: 'no' }),
        ]),
      );
      if (fresh.length) kids.push(...fresh.map((p) => resultCard(p, p.id ? 'On Bite' : 'New to Bite')));
      else kids.push(el('p', { class: 'empty', text: 'Nothing else found. Try the full name, or add the street.' }));
    }
  } else if (found.q.length >= 2 && !found.bite.length) {
    kids.push(el('p', { class: 'empty', text: 'Not on Bite yet. Press Enter to search all of Singapore.' }));
  }
  box.replaceChildren(...kids);
}

// ───────────────────────── what Bite is saying ─────────────────────────

function renderInsights() {
  const box = $('insights');
  const note = $('insights-note');
  if (stats === null) {
    note.textContent = 'Bite’s numbers need migration 066. Run it in Supabase and reload.';
    box.replaceChildren();
    return;
  }
  note.textContent = 'Places people on Bite are visiting, scoring and saving. Totals only, never who.';
  const top = (rows) => rows.slice(0, 6);
  const boards = [
    {
      title: 'Most visited',
      empty: 'No visits logged yet.',
      rows: top(stats.filter((s) => s.visits > 0).sort((a, b) => b.visits - a.visits)),
      stat: (s) => plural(s.visits, 'visit'),
      size: (s) => s.visits,
    },
    {
      title: 'Top rated',
      empty: 'Needs a place with at least two visits.',
      rows: top(stats.filter((s) => s.visits >= 2 && s.avg_score != null).sort((a, b) => b.avg_score - a.avg_score || b.visits - a.visits)),
      stat: (s) => Number(s.avg_score).toFixed(1),
      sub: (s) => `from ${plural(s.visits, 'visit')}`,
      size: (s) => Number(s.avg_score),
    },
    {
      title: 'Most saved',
      empty: 'Nobody has saved a place yet.',
      rows: top(stats.filter((s) => s.saves > 0).sort((a, b) => b.saves - a.saves)),
      stat: (s) => plural(s.saves, 'save'),
      size: (s) => s.saves,
    },
    {
      title: 'Rising, last 14 days',
      empty: 'Nothing new in the last two weeks.',
      rows: top(
        stats
          .filter((s) => s.visits_recent + s.saves_recent > 0)
          .sort((a, b) => b.visits_recent + b.saves_recent - (a.visits_recent + a.saves_recent)),
      ),
      stat: (s) => `+${s.visits_recent + s.saves_recent}`,
      sub: (s) => [s.visits_recent ? plural(s.visits_recent, 'visit') : null, s.saves_recent ? plural(s.saves_recent, 'save') : null].filter(Boolean).join(', '),
      size: (s) => s.visits_recent + s.saves_recent,
    },
  ];
  box.replaceChildren(
    ...boards.map((b) => {
      // The longest bar belongs to the first line; the rest are measured against it.
      const size = b.size ?? ((s) => 0);
      const most = Math.max(1, ...b.rows.map(size));
      return el('section', { class: 'card list' }, [
        el('div', { class: 'list-head' }, [el('h3', { text: b.title })]),
        el(
          'div',
          { class: 'list-body' },
          b.rows.length
            ? b.rows.map((s) => {
                const on = listsOf(s.id);
                const sub = [b.sub ? b.sub(s) : null, on.length ? `on ${on.join(', ')}` : 'on no list'].filter(Boolean).join(' · ');
                const bar = el('div', { class: 'insight-bar' });
                bar.style.width = `${Math.max(6, Math.round((size(s) / most) * 100))}%`;
                return el('div', { class: 'insight-row' }, [
                  bar,
                  el('div', {}, [nameButton(s, 'row-name'), el('div', { class: 'insight-sub', text: sub })]),
                  el('span', { class: 'insight-stat', text: b.stat(s) }),
                ]);
              })
            : [el('p', { class: 'empty', text: b.empty })],
        ),
      ]);
    }),
  );
}

// ───────────────────────── one place, close up ─────────────────────────

let panelRun = 0;

async function openPanel(place) {
  panelPlace = { place, details: null, failed: null };
  renderPanel();
  if (!$('panel').open) $('panel').showModal();
  if (!place.place_id) return;
  const run = ++panelRun;
  const res = await api.placeDetails(place.place_id).catch(() => ({ ok: false, reason: 'failed' }));
  if (run !== panelRun || !panelPlace || panelPlace.place !== place) return; // another place was opened
  if (res.ok) panelPlace.details = res.place;
  else panelPlace.failed = GOOGLE_SAYS[res.reason] ?? GOOGLE_SAYS.failed;
  renderPanel();
}

function renderPanel() {
  const { place, details, failed } = panelPlace;
  // Google's facts where they have arrived; what the page already knew otherwise.
  const g = { ...place, ...(details ?? {}) };
  const s = place.id ? statsById.get(place.id) : null;
  const closed = CLOSED[g.status];

  const photos = details
    ? details.photos?.length
      ? details.photos.map((ph) => el('img', { src: ph.uri, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }))
      : [el('p', { class: 'empty', text: 'Google has no photos of this place.' })]
    : failed
      ? [el('p', { class: 'error', text: failed })]
      : [0, 1, 2].map(() => el('div', { class: 'ghost' }));
  const authors = [...new Set((details?.photos ?? []).map((ph) => ph.author).filter(Boolean))];

  const number = (value, label) => el('div', { class: 'number' }, [el('b', { text: value }), el('span', { text: label })]);
  const onLists = place.id ? LISTS.filter((l) => pickOf(l.key, place.id)) : [];

  $('panel-body').replaceChildren(
    el('div', { class: 'panel-in' }, [
      el('div', { class: 'panel-head' }, [
        el('div', {}, [
          el('h2', { id: 'panel-title', text: g.name }),
          el('p', { class: 'quiet', text: [googleLine(g) || placeMeta(g), place.id ? null : 'New to Bite'].filter(Boolean).join(' · ') }),
          closed ? el('span', { class: 'warn', text: closed }) : null,
        ]),
        el('button', { class: 'plain', type: 'button', text: 'Close', on: { click: () => $('panel').close() } }),
      ]),

      el('div', { class: 'photos' }, photos),
      details?.photos?.length
        ? el('div', { class: 'credit' }, [
            el('span', { text: authors.length ? `Photos: ${authors.join(', ')}` : '' }),
            el('span', { class: 'google', text: 'Google Maps', translate: 'no' }),
          ])
        : null,

      el('div', { class: 'facts' }, [
        g.address ? el('div', { text: g.address }) : null,
        place.id && placeMeta(place) ? el('div', { class: 'quiet', text: `On Bite as: ${placeMeta(place)}` }) : null,
        mapsLink(g.maps_url),
      ]),

      el('div', {}, [
        el('h3', { text: 'On Bite' }),
        place.id
          ? stats === null
            ? el('p', { class: 'quiet small', text: 'Bite’s numbers need migration 066.' })
            : el('div', { class: 'numbers' }, [
                number(String(s?.visits ?? 0), (s?.visits ?? 0) === 1 ? 'visit logged' : 'visits logged'),
                number(s?.avg_score != null ? Number(s.avg_score).toFixed(1) : 'None', 'average score'),
                number(String(s?.saves ?? 0), (s?.saves ?? 0) === 1 ? 'save' : 'saves'),
                number(String(s?.guides ?? 0), (s?.guides ?? 0) === 1 ? 'guide' : 'guides'),
                number(`+${(s?.visits_recent ?? 0) + (s?.saves_recent ?? 0)}`, 'last 14 days'),
              ])
          : el('p', { class: 'quiet small', text: 'Nobody on Bite has logged or saved this place yet. Adding it to a list brings it in.' }),
      ]),

      el('div', {}, [
        el('h3', { text: 'Lists' }),
        el(
          'div',
          { class: 'chips' },
          LISTS.map((list) => {
            const pick = place.id ? pickOf(list.key, place.id) : null;
            const leaving = pick?.pending === 'remove';
            const on = Boolean(pick) && !leaving;
            return el('button', {
              class: `chip${on ? ' on' : ''}`,
              type: 'button',
              text: on ? `Remove from ${list.label}` : leaving ? `Keep on ${list.label}` : `Add to ${list.label}`,
              on: {
                click: () =>
                  on
                    ? change(() => api.setPick(list.key, place.id, false), pick.live ? `Leaves ${list.label} at the next publish` : `Draft removed from ${list.label}`)
                    : addTo(place, list),
              },
            });
          }),
        ),
        onLists.length
          ? el('p', {
              class: 'quiet small',
              text: onLists
                .map((l) => {
                  const p = pickOf(l.key, place.id);
                  return `${l.label}: ${p.pending === 'add' ? 'draft' : p.pending === 'remove' ? 'leaving at the next publish' : 'live'}`;
                })
                .join(' · '),
            })
          : null,
        el('p', { id: 'panel-note', class: 'quiet small', hidden: true }),
      ]),
    ]),
  );
}

// ───────────────────────── a listed place has closed ─────────────────────────
// The page asks Google about every listed place once a week, when Bite
// HQ is opened, and files the answers (hq_place_status). A place Google
// says has shut is flagged on its row and gathered into a red box.

function listedPlaces() {
  const out = new Map(); // restaurant id -> { place, lists }
  for (const p of picks) {
    if (!p.restaurant || p.pending === 'remove') continue;
    const have = out.get(p.restaurant_id) ?? { place: p.restaurant, lists: [] };
    have.lists.push(LISTS.find((l) => l.key === p.list) ?? { key: p.list, label: p.list });
    out.set(p.restaurant_id, have);
  }
  return out;
}

function renderClosed() {
  const box = $('closed');
  const note = $('closed-note');
  if (statuses === null) {
    box.hidden = true;
    note.textContent = 'The check for closed places needs migration 067. Run it in Supabase and reload.';
    return;
  }
  const shut = [...listedPlaces()].filter(([id]) => CLOSED[statusById.get(id)?.status]);
  if (shut.length) {
    box.replaceChildren(
      el('h3', { text: `${shut.length === 1 ? 'A place' : `${shut.length} places`} on your lists ${shut.length === 1 ? 'has' : 'have'} closed, Google says` }),
      ...shut.map(([id, { place, lists }]) =>
        el('div', { class: 'closed-row' }, [
          el('div', {}, [
            nameButton(place, 'row-name'),
            el('span', { class: 'quiet', text: ` · ${CLOSED[statusById.get(id).status]} · on ${lists.map((l) => l.label).join(', ')}` }),
          ]),
          el('button', {
            class: 'plain',
            type: 'button',
            text: lists.length === 1 ? `Remove from ${lists[0].label}` : 'Remove from all lists',
            on: {
              click: () =>
                change(async () => {
                  for (const l of lists) await api.setPick(l.key, id, false);
                }, 'Marked to leave at the next publish'),
            },
          }),
        ]),
      ),
    );
    box.hidden = false;
  } else box.hidden = true;

  const times = [...listedPlaces().keys()].map((id) => statusById.get(id)?.checked_at).filter(Boolean).sort();
  const last = times.length ? new Date(times[times.length - 1]).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : null;
  note.replaceChildren(
    document.createTextNode(
      checking
        ? 'Asking Google which listed places are still open… '
        : checkFailed
          ? `The check for closed places did not finish: ${checkFailed} `
          : last
            ? `Listed places checked with Google on ${last}. Checked again every Monday by itself, with an email to you if one has closed. `
            : 'Listed places have not been checked with Google yet. ',
    ),
    checking ? '' : el('button', { class: 'link', type: 'button', text: 'Check now', on: { click: () => checkClosed(true) } }),
  );
}

async function checkClosed(force) {
  if (statuses === null || checking) return;
  const due = [...listedPlaces()]
    .filter(([, v]) => v.place.place_id)
    .filter(([id]) => {
      const at = statusById.get(id)?.checked_at;
      return force || !at || Date.now() - new Date(at).getTime() > 7 * DAY;
    })
    .map(([id, v]) => [id, v.place.place_id]);
  if (!due.length) {
    if (force) toast('Nothing on a list to check');
    return;
  }
  checking = true;
  checkFailed = '';
  renderClosed();
  try {
    for (let i = 0; i < due.length; i += 60) {
      const chunk = due.slice(i, i + 60);
      const res = await api.checkStatuses(chunk.map(([, placeId]) => placeId));
      if (!res.ok) {
        checkFailed = GOOGLE_SAYS[res.reason] ?? GOOGLE_SAYS.failed;
        break;
      }
      const said = new Map(res.places.map((p) => [p.place_id, p.status]));
      await api.saveStatuses(chunk.map(([id, placeId]) => ({ id, status: said.get(placeId) ?? 'UNKNOWN' })));
    }
    statuses = await api.statuses();
    statusById = new Map((statuses ?? []).map((s) => [s.restaurant_id, s]));
  } catch (e) {
    checkFailed = explain(e);
  } finally {
    checking = false;
    renderLists();
    renderClosed();
    if (force && !checkFailed) toast('Checked with Google');
  }
}

// ───────────────────────── preview: a list as the app shows it ─────────────────────────
// A close copy of the app's own page (bite/app/curated/[key].tsx): the
// same words, colours, order and cut-offs. Not the app itself.

const PAGES = {
  top25: { title: 'Top 25 on Bite', blurb: 'Chosen by Bite. The places worth your time right now.', plate: '#43301E', on: '#B5D334' },
  newly_opened: { title: 'Newly opened', blurb: 'Opened in the last month. Added by Bite as they appear.', plate: '#EDF4D4', on: '#55700B', empty: 'Bite is still out scouting the new openings. Check back soon.' },
  sweet: { title: 'Sweet Tooth', blurb: 'Desserts, bakes, and anything sweet. Picked by Bite.', plate: '#55700B', on: '#EDF4D4', empty: 'Bite is still picking the sweet spots. Check back soon.' },
  brews: { title: 'Coffee & Matcha', blurb: 'Worth it for the cup. Good coffee, good matcha, picked by Bite.', plate: '#EFEBE4', on: '#43301E', empty: 'Bite is still tasting its way round. Check back soon.' },
};

let previewOf = null; // { list, mode: 'after' | 'now' }

// The rows a person would see: after the next publish, or right now.
function previewRows(list, mode) {
  let rows = rowsOf(list.key).filter((r) => (mode === 'after' ? r.pending !== 'remove' : r.live));
  if (list.key === 'newly_opened') {
    rows = rows.filter((r) => !r.live || !r.published_at || Date.now() - new Date(r.published_at).getTime() < NEWLY_OPENED_DAYS * DAY);
  }
  return list.key === 'top25' ? rows.slice(0, TOP25_SHOWN) : rows;
}

async function openPreview(list) {
  previewOf = { list, mode: 'after' };
  renderPreview();
  if (!$('preview').open) $('preview').showModal();
  // Small photos for the places that do not have one yet this session.
  const need = [...new Set(rowsOf(list.key).map((r) => r.restaurant.place_id).filter((id) => id && !thumbs.has(id)))];
  for (let i = 0; i < need.length; i += 40) {
    const res = await api.thumbs(need.slice(i, i + 40)).catch(() => ({ ok: false }));
    if (!res.ok) break;
    for (const p of res.places) thumbs.set(p.place_id, p.photo ?? '');
    if (previewOf?.list === list) renderPreview();
  }
}

function renderPreview() {
  if (!previewOf) return;
  const { list, mode } = previewOf;
  const page = PAGES[list.key] ?? { title: list.label, blurb: '', plate: '#EFEBE4', on: '#43301E' };
  const rows = previewRows(list, mode);
  const changed = rowsOf(list.key).some((r) => r.pending);
  const plate = el('div', { class: 'plate' }, [
    el('div', { class: 'plate-micro', text: 'Made by Bite' }),
    el('div', { class: 'plate-title', text: page.title }),
    el('div', { class: 'plate-blurb', text: page.blurb }),
  ]);
  plate.style.background = page.plate;
  plate.style.color = page.on;
  const seg = (value, text) =>
    el('button', {
      class: mode === value ? 'on' : '',
      type: 'button',
      text,
      on: {
        click: () => {
          previewOf.mode = value;
          renderPreview();
        },
      },
    });
  $('preview-body').replaceChildren(
    el('div', { class: 'preview-bar' }, [
      el('div', { class: 'seg' }, [seg('after', 'After publish'), seg('now', 'Live now')]),
      el('button', { class: 'plain', type: 'button', text: 'Close', on: { click: () => $('preview').close() } }),
    ]),
    el('div', { class: 'phone' }, [
      plate,
      ...(rows.length
        ? rows.map((r, i) => {
            const src = thumbs.get(r.restaurant.place_id);
            const avg = statsById.get(r.restaurant_id)?.avg_score;
            return el('div', { class: `app-row${mode === 'after' && r.pending === 'add' ? ' draft' : ''}` }, [
              el('div', { class: 'app-rank', text: String(i + 1) }),
              src ? el('img', { class: 'app-thumb', src, alt: '', referrerpolicy: 'no-referrer' }) : el('div', { class: 'app-thumb' }),
              el('div', {}, [
                el('div', { class: 'app-name', text: r.restaurant.name }),
                placeMeta(r.restaurant) ? el('div', { class: 'app-meta', text: placeMeta(r.restaurant) }) : null,
              ]),
              avg != null ? el('span', { class: 'app-score', text: Number(avg).toFixed(1) }) : null,
            ]);
          })
        : [el('p', { class: 'empty preview-foot', text: page.empty ?? 'This list fills itself as people log visits and save places.' })]),
      el('p', {
        class: 'quiet small preview-foot',
        text:
          mode === 'after'
            ? changed
              ? 'How the list will look once you publish. A dashed outline marks a place that is not live yet.'
              : 'Nothing is waiting, so this is also what people see now.'
            : 'What people see in the app right now.',
      }),
    ]),
  );
}

// ───────────────────────── Bite's guides ─────────────────────────
// A Bite guide is an ordinary guide owned by the official @bite account.
// It is edited here as a whole and saved in one go: nothing changes in
// the app until Save.

const blankGuide = () => ({ id: null, title: '', tagline: '', description: '', visibility: 'private', items: [], dirty: false });

function renderGuidePicker() {
  const box = $('guide-picker');
  if (guides === null) {
    $('guides-note').textContent = 'Guides need migration 067. Run it in Supabase and reload.';
    box.replaceChildren();
    $('guide-editor').replaceChildren();
    return;
  }
  box.replaceChildren(
    ...guides.map((g) =>
      el('button', { class: `guide-chip${draft?.id === g.id ? ' on' : ''}`, type: 'button', on: { click: () => openGuide(g) } }, [
        el('span', { text: g.title }),
        el('small', { text: `${g.visibility === 'public' ? 'Public' : 'Private'} · ${plural(g.items.length, 'place')}` }),
      ]),
    ),
    el('button', { class: `guide-chip${draft && !draft.id ? ' on' : ''}`, type: 'button', text: 'New guide', on: { click: () => openGuide(null) } }),
  );
  if (!draft) $('guide-editor').replaceChildren(el('p', { class: 'empty', text: guides.length ? 'Pick a guide to edit it, or start a new one.' : 'No guides yet. Start the first one.' }));
}

function openGuide(g) {
  if (draft?.dirty && !window.confirm('This guide has changes you have not saved. Leave them behind?')) return;
  draft = g
    ? { id: g.id, title: g.title ?? '', tagline: g.tagline ?? '', description: g.description ?? '', visibility: g.visibility === 'public' ? 'public' : 'private', items: g.items.map((i) => ({ ...i, note: i.note ?? '' })), saves: g.saves ?? 0, dirty: false }
    : blankGuide();
  renderGuidePicker();
  renderGuideEditor();
  renderResults();
}

// Marks the guide as changed and brings the Save button to life.
function touch() {
  if (!draft) return;
  draft.dirty = true;
  const save = document.getElementById('guide-save');
  if (save) save.disabled = false;
  const state = document.getElementById('guide-state');
  if (state) state.textContent = 'Changes not saved yet';
}

function renderGuideEditor() {
  const box = $('guide-editor');
  if (!draft) return;
  // A text box that writes straight into the guide being edited.
  const field = (label, key, max, tagName = 'input', extra = {}) => {
    const count = el('span', { class: 'count', text: `${draft[key].length} / ${max}` });
    const input = el(tagName, {
      maxlength: String(max),
      ...extra,
      on: {
        input: (evt) => {
          draft[key] = evt.target.value;
          count.textContent = `${draft[key].length} / ${max}`;
          touch();
        },
      },
    });
    input.value = draft[key];
    return el('label', {}, [el('span', { class: 'label-row' }, [el('span', { text: label }), count]), input]);
  };
  const seg = (value, text) =>
    el('button', {
      class: draft.visibility === value ? 'on' : '',
      type: 'button',
      text,
      on: {
        click: () => {
          draft.visibility = value;
          touch();
          renderGuideEditor();
        },
      },
    });
  box.replaceChildren(
    el('div', { class: 'card editor' }, [
      field('Title', 'title', 60, 'input', { type: 'text', placeholder: 'Supper after midnight' }),
      field('One line under the title', 'tagline', 80, 'input', { type: 'text', placeholder: 'Open late, worth it' }),
      field('What the guide is about', 'description', 1000, 'textarea', { rows: '3', placeholder: 'Say who it is for and why these places.' }),
      el('div', {}, [
        el('div', { class: 'seg' }, [seg('private', 'Private draft'), seg('public', 'Public')]),
        el('p', {
          class: 'quiet small',
          text: draft.visibility === 'public'
            ? 'Public: everyone on Bite can see it in the app the moment you save.'
            : 'Private: only the Bite account can see it. Use this while you are still writing.',
        }),
      ]),
      el('div', {}, [
        el('h3', { text: 'Places, in order' }),
        el('ol', { id: 'guide-rows', class: 'guide-rows' }),
        el('p', { id: 'guide-rows-empty', class: 'empty' }),
      ]),
      el('div', { class: 'editor-foot' }, [
        el('button', { id: 'guide-save', class: 'primary', type: 'button', text: draft.id ? 'Save changes' : 'Save guide', disabled: !draft.dirty, on: { click: saveGuide } }),
        el('span', { id: 'guide-state', class: 'quiet small', text: draft.dirty ? 'Changes not saved yet' : draft.id ? `Saved${draft.saves ? ` · saved by ${plural(draft.saves, 'person', 'people')}` : ''}` : 'Not saved yet' }),
        el('span', { class: 'spacer' }),
        draft.id ? el('button', { class: 'danger', type: 'button', text: 'Delete guide', on: { click: deleteGuide } }) : null,
      ]),
    ]),
  );
  renderGuideRows();
}

function renderGuideRows() {
  const ol = document.getElementById('guide-rows');
  if (!ol || !draft) return;
  document.getElementById('guide-rows-empty').textContent = draft.items.length ? '' : 'No places yet. Search on the left and press "Add to this guide".';
  ol.replaceChildren(
    ...draft.items.map((item, i) => {
      const noteBox = el('textarea', {
        rows: '2',
        maxlength: '600',
        placeholder: 'Why it is here, what to order',
        'aria-label': `Note for ${item.restaurant.name}`,
        on: {
          input: (evt) => {
            item.note = evt.target.value;
            touch();
          },
        },
      });
      noteBox.value = item.note ?? '';
      return el('li', { class: 'guide-row', data: { id: item.restaurant_id } }, [
        el('span', { class: 'rank', text: String(i + 1) }),
        el('div', {}, [
          nameButton(item.restaurant, 'row-name'),
          placeMeta(item.restaurant) ? el('div', { class: 'row-meta', text: placeMeta(item.restaurant) }) : null,
          noteBox,
        ]),
        el('button', {
          class: 'icon',
          type: 'button',
          text: 'Remove',
          'aria-label': `Remove ${item.restaurant.name}`,
          on: {
            click: () => {
              draft.items = draft.items.filter((x) => x !== item);
              touch();
              renderGuideRows();
              renderResults();
            },
          },
        }),
      ]);
    }),
  );
  Sortable.create(ol, {
    animation: 160,
    draggable: '.guide-row',
    filter: 'textarea, .icon',
    preventOnFilter: false,
    onEnd: (evt) => {
      lastDrag = Date.now();
      if (evt.oldIndex === evt.newIndex) return;
      const order = [...ol.querySelectorAll('.guide-row')].map((n) => n.dataset.id);
      draft.items.sort((a, b) => order.indexOf(a.restaurant_id) - order.indexOf(b.restaurant_id));
      touch();
      renderGuideRows();
    },
  });
}

async function addToGuide(place) {
  if (!draft || busy) return;
  busy = true;
  try {
    // A place Google found is saved into Bite first, as it is for a list.
    if (!place.id) {
      const id = await api.saveGooglePlace(place);
      const tags = classify(place.kind);
      Object.assign(place, { id, cuisine: tags.cuisine, subcuisine: tags.subcuisine, area: areaFromAddress(place.address) });
    }
    if (!draft.items.some((i) => i.restaurant_id === place.id)) {
      draft.items.push({ restaurant_id: place.id, note: '', restaurant: place });
      touch();
    }
    renderGuideRows();
    renderResults();
  } catch (e) {
    toast(explain(e), true);
  } finally {
    busy = false;
  }
}

async function saveGuide() {
  if (!draft || busy) return;
  if (!draft.title.trim()) {
    toast('Give the guide a title first', true);
    return;
  }
  if (draft.visibility === 'public' && !draft.items.length) {
    toast('A public guide needs at least one place. Add one, or keep it private for now.', true);
    return;
  }
  busy = true;
  try {
    const id = await api.saveGuide(draft);
    draft.dirty = false;
    guides = await api.guides();
    log = await api.log();
    const saved = (guides ?? []).find((g) => g.id === id);
    if (saved) openGuide(saved);
    renderHistory();
    toast(saved?.visibility === 'public' ? 'Saved. It is live in the app.' : 'Saved as a private draft');
  } catch (e) {
    toast(explain(e), true);
  } finally {
    busy = false;
  }
}

async function deleteGuide() {
  if (!draft?.id || busy) return;
  if (!window.confirm(`Delete the guide "${draft.title}"?\n\nIt goes from the app for everyone, along with anyone's saves of it. This cannot be undone.`)) return;
  busy = true;
  try {
    await api.deleteGuide(draft.id);
    draft = null;
    guides = await api.guides();
    log = await api.log();
    renderGuidePicker();
    renderHistory();
    renderResults();
    toast('Guide deleted');
  } catch (e) {
    toast(explain(e), true);
  } finally {
    busy = false;
  }
}

// ───────────────────────── history ─────────────────────────

const listName = (key) => LISTS.find((l) => l.key === key)?.label ?? key ?? 'a list';

// One line of the history, as a sentence.
function logLine(r) {
  const place = r.place_name ?? 'A place';
  const d = r.detail ?? {};
  switch (r.action) {
    case 'added': return `added ${place} to ${listName(r.list)} as a draft`;
    case 'draft_removed': return `took the draft ${place} off ${listName(r.list)}`;
    case 'removing': return `marked ${place} to leave ${listName(r.list)}`;
    case 'kept': return `kept ${place} on ${listName(r.list)}`;
    case 'went_live': return `published ${place} on ${listName(r.list)}`;
    case 'went_off': return `published the removal of ${place} from ${listName(r.list)}`;
    case 'removed': return `removed ${place} from ${listName(r.list)}`;
    case 'reordered': return `re-ranked ${listName(r.list)}`;
    case 'guide_created': return `started the guide "${d.title ?? ''}"`;
    case 'guide_saved': return `saved the guide "${d.title ?? ''}" (${plural(Number(d.places ?? 0), 'place')}, ${d.visibility === 'public' ? 'public' : 'private'})`;
    case 'guide_deleted': return `deleted the guide "${d.title ?? ''}"`;
    default: return r.action;
  }
}

function renderHistory() {
  const box = $('history');
  if (log === null) {
    $('history-note').textContent = 'The history needs migration 067. Run it in Supabase and reload.';
    box.replaceChildren();
    return;
  }
  $('history-note').textContent = 'Every change to Bite\u2019s lists and guides, newest first. It starts from the day this was switched on.';
  if (!log.length) {
    box.replaceChildren(el('p', { class: 'empty', text: 'Nothing has changed yet.' }));
    return;
  }
  box.replaceChildren(
    ...log.map((r) =>
      el('div', { class: 'log-row' }, [
        el('span', {
          class: 'log-when',
          text: new Date(r.at).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }),
        }),
        el('span', {}, [
          el('span', { class: 'log-who', text: r.actor ? `@${r.actor}` : 'The monthly schedule' }),
          document.createTextNode(` ${logLine(r)}`),
        ]),
      ]),
    ),
  );
}

// ───────────────────────── sections ─────────────────────────

const TABS = ['pulse', 'people', 'lists', 'guides', 'health', 'inbox', 'history'];
let editorLine = ''; // today's line for the editing pages, set by greet()
// The two pages that add places get the search panel beside them.
const EDITING = ['lists', 'guides'];

// Shows the page that `tab` names, and hides what does not belong on it.
function applyTab() {
  for (const t of TABS) {
    $(`tab-${t}`).classList.toggle('on', t === tab);
    $(`view-${t}`).hidden = t !== tab;
  }
  const editing = EDITING.includes(tab);
  document.querySelector('.find').hidden = !editing;
  document.querySelector('.layout').classList.toggle('wide', !editing);
  // Publishing is about the lists: out of the way everywhere else.
  const lists = editing || tab === 'history';
  // The line under the greeting: the job on the editing pages, the state of things elsewhere.
  $('hello-sub').textContent = lists ? editorLine : 'Here is where Bite stands, and what to do about it.';
  $('status').hidden = !lists;
  $('publish').hidden = !lists;
  $('search-note').textContent =
    tab === 'guides'
      ? 'Type to find places already on Bite. Press Enter to search every place in Singapore, with photos. Results go into the guide you have open.'
      : 'Type to find places already on Bite. Press Enter to search every place in Singapore, with photos.';
}

function setTab(name) {
  if (name === tab || !TABS.includes(name)) return;
  if (tab === 'guides' && draft?.dirty && !window.confirm('This guide has changes you have not saved. Leave them behind?')) return;
  if (tab === 'guides' && draft?.dirty) draft = null;
  tab = name;
  applyTab();
  renderGuidePicker();
  if (tab === 'guides' && draft) renderGuideEditor();
  renderResults();
  window.scrollTo({ top: 0 });
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
      // A place Google found that Bite already has, on a list or in its
      // numbers: use Bite's row, keep Google's photo and facts.
      const have = new Map();
      for (const p of picks) if (p.restaurant?.place_id) have.set(p.restaurant.place_id, p.restaurant);
      for (const s of stats ?? []) if (s.place_id && !have.has(s.place_id)) have.set(s.place_id, s);
      res.places = res.places.map((p) => {
        const mine = have.get(p.place_id);
        return mine ? { ...p, id: mine.id, cuisine: mine.cuisine, subcuisine: mine.subcuisine, area: mine.area } : p;
      });
    }
    found.google = res;
    renderResults();
  } finally {
    button.disabled = false;
    button.textContent = 'Search all of Singapore';
  }
}

// A greeting by the clock, and a line to get going on.
async function greet() {
  const hour = new Date().getHours();
  const part = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const lines = [
    'Somebody has to decide what is good. Today it is you.',
    'Singapore is hungry. What deserves a spot?',
    'Fewer, better places. That is the whole job.',
    'What would you send a friend to this week?',
    'Rank it like your reputation depends on it.',
  ];
  $('hello').textContent = `${part}.`;
  editorLine = lines[new Date().getDate() % lines.length];
  applyTab();
  const name = await api.myName().catch(() => '');
  if (name) $('hello').textContent = `${part}, ${name}.`;
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
  applyTab();
  ops.renderAll();
  greet();
  try {
    await refresh();
  } catch (e) {
    toast(explain(e), true);
  }
  // Once a week, quietly: are the listed places still open?
  checkClosed(false);
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

for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => setTab(t));

// Leaving the page with an unsaved guide asks first.
window.addEventListener('beforeunload', (evt) => {
  if (draft?.dirty) evt.preventDefault();
});

// A click on the dimmed page behind the panel closes it.
$('panel').addEventListener('click', (evt) => {
  if (evt.target === $('panel')) $('panel').close();
});
$('preview').addEventListener('click', (evt) => {
  if (evt.target === $('preview')) $('preview').close();
});
$('preview').addEventListener('close', () => {
  previewOf = null;
});
$('panel').addEventListener('close', () => {
  panelPlace = null;
  panelRun += 1;
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
