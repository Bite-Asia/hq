// Bite HQ, the operations pages: Pulse, People, Health and Inbox.
//
// These pages only read and decide. What they may see is settled by the
// database (hq_pulse, hq_people, hq_inbox, admin_errors: admins only)
// and by the hq-signals function, which holds the Sentry and PostHog
// keys so this public page never does.
//
// People shows counts and dates per member. Never which places, never
// what anyone wrote.

const DAY = 86400000;

// What the app calls a screen, in words.
const SCREENS = {
  '/': 'Opening Screen',
  '/feed': 'Home',
  '/recs': 'Explore',
  '/profile': 'Profile',
  '/restaurant/:id': 'A Place',
  '/post/:id': 'A Post',
  '/user/:id': 'Someone’s Profile',
  '/playlist/:id': 'A Guide',
  '/settings': 'Settings',
  '/notifications': 'Notifications',
  '/add': 'Log a Visit',
  '/guides': 'Guides',
  '/people': 'Find People',
  '/feedback': 'Feature Requests',
  '/import': 'Import',
  '/curated/top25': 'Top 25',
  '/curated/newly_opened': 'Newly Opened',
  '/curated/sweet': 'Sweet Tooth',
  '/curated/brews': 'Coffee & Matcha',
};
const screenName = (path) =>
  SCREENS[path] ??
  String(path ?? '')
    .replace(/\/:id/g, '')
    .split('/')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).replace(/[-_]/g, ' '))
    .join(', ') ??
  path;

// What the app calls an action, in words.
const ACTIONS = {
  rank: 'Logged a visit',
  wishlist_save: 'Saved a place',
  import_list: 'Imported a list',
  import_ratings: 'Imported ratings',
  playlist_create: 'Made a guide',
  poll_create: 'Started a poll',
  message_send: 'Sent a message',
  feature_request: 'Asked for a feature',
  feature_vote: 'Voted on a request',
  signup: 'Signed up',
  onboarding_complete: 'Finished setup',
  onboarding_profile: 'Set up their profile',
  onboarding_edit: 'Changed their setup answers',
};
const actionName = (name) => ACTIONS[name] ?? String(name ?? '').replace(/_/g, ' ');

const FUNNEL = {
  signed: 'Signed Up',
  setup: 'Finished Setup',
  followed: 'Followed Someone',
  placed: 'Saved or Logged a Place',
  visited: 'Logged a Visit',
  regular: 'Logged 3 or More Visits',
};

const GO = { health: 'Open Health', inbox: 'Open Inbox', people: 'See Who', lists: 'Open Lists' };

const KINDS = { crash: 'Crash', rejection: 'Failed quietly', render: 'Screen broke', request: 'Server said no', manual: 'Reported by hand' };

// The same names the app shows when someone reports (bite/lib/safety.ts).
const REASONS = {
  spam: 'Spam', harassment: 'Harassment or bullying', hate: 'Hate', sexual: 'Nudity or sexual content',
  violence: 'Violence or threats', false_info: 'False or misleading', other: 'Something else',
};
const TARGETS = { post: 'A post', comment: 'A comment', guide: 'A guide', guide_comment: 'A comment on a guide', poll: 'A poll', user: 'An account' };

function ago(iso) {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  if (ms < 60000) return 'Just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / 3600000)}h ago`;
  if (ms < 14 * DAY) return `${Math.floor(ms / DAY)}d ago`;
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}
const dayMonth = (iso) => (iso ? new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '');
const dayTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const num = (n) => Number(n ?? 0).toLocaleString('en-SG');
// Sizes are set this way, not with a style attribute: the page's rules
// (its Content-Security-Policy) refuse inline styles.
const sized = (node, prop, value) => {
  node.style[prop] = value;
  return node;
};

export function initOps({ el, $, api, toast, explain, plural, setTab }) {
  // undefined = not asked yet, null = the database does not have it yet
  let pulse;
  let people;
  let inbox;
  let bugs;
  let signals;
  let check; // the daily bug check: its switch, its last run, its proposals
  let filter = 'all';
  let openPerson = null;
  let openBug = null;
  let busy = false;

  const needs = (what) =>
    el('section', { class: 'card' }, [
      el('h2', { text: what }),
      el('p', { class: 'quiet', text: 'This page needs migration 072. Run it in Supabase and reload.' }),
    ]);
  const loading = () => el('p', { class: 'quiet', text: 'Loading…' });

  // One change, then everything is read back, so the page shows what is
  // really saved.
  async function act(work, done) {
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

  // ───────────────────────── shared pieces ─────────────────────────

  // A label, a bar as long as its number is big, and the number.
  function meter(label, n, max, dark) {
    const pct = max > 0 ? Math.max(n > 0 ? 3 : 0, Math.round((n / max) * 100)) : 0;
    return el('div', { class: 'meter' }, [
      el('span', { class: 'meter-label', text: label }),
      el('div', { class: 'meter-track' }, [sized(el('div', { class: dark ? 'meter-fill dark' : 'meter-fill' }), 'width', `${pct}%`)]),
      el('b', { text: num(n) }),
    ]);
  }

  const source = (name, cls) => el('span', { class: `source ${cls}`, text: `From ${name}` });

  // What is missing, by name, as the server sees it.
  function notConnected(name, wanted) {
    const seen = signals?.secrets;
    const missing = seen ? wanted.filter((n) => !seen.has?.[n]) : wanted;
    const near = seen?.near ?? [];
    return [
      el('p', { class: 'quiet', text: `${name} is not connected yet.` }),
      el('p', {
        class: 'quiet small',
        text: seen && !missing.length
          ? 'The secrets are there, but one is not in the shape it should be. POSTHOG_PROJECT must be the project number, digits only.'
          : seen
          ? `The server cannot see ${missing.join(' or ')}. Add ${missing.length === 1 ? 'it' : 'them'} in Supabase, under Edge Functions, Secrets, spelt exactly like that.`
          : `It needs a key only you can create. Add ${wanted.join(' and ')} in Supabase, under Edge Functions, Secrets.`,
      }),
      near.length ? el('p', { class: 'error small', text: `It can see ${near.join(', ')}, which is not a name it looks for. Rename it.` }) : null,
    ];
  }

  // The newest update anyone's phone has reported, and who is on it.
  function updates() {
    const rows = (people ?? []).filter((p) => p.running?.at);
    const reported = rows.filter((p) => p.running.update_at);
    const latest = reported.reduce((best, p) => (!best || p.running.update_at > best ? p.running.update_at : best), null);
    return {
      latest,
      opened: rows.length,
      on: reported.filter((p) => p.running.update_at === latest).length,
      // Opened Bite after the update came out, and still not on it: their
      // next open picks it up.
      behind: rows.filter((p) => latest && p.running.update_at !== latest && openedSince(p, latest)),
      // Have not opened Bite since it came out, so they could not have it.
      away: rows.filter((p) => latest && p.running.update_at !== latest && !openedSince(p, latest)),
      silent: rows.length - reported.length,
    };
  }
  // Did this phone last open Bite after the update was published?
  function openedSince(p, latest) {
    return Boolean(p.running?.at) && new Date(p.running.at).getTime() >= new Date(latest).getTime();
  }
  function updateState(p, latest) {
    if (!p.running?.at) return { text: 'Never Opened', cls: 'pill grey' };
    if (latest && p.running.update_at === latest) return { text: 'Latest', cls: 'pill good' };
    if (latest && !openedSince(p, latest)) return { text: 'Not Opened Since', cls: 'pill grey' };
    if (!p.running.update_at) return { text: p.running.version ? 'Build Only' : 'Not Reported', cls: 'pill grey' };
    return { text: 'Behind', cls: 'pill warn' };
  }

  function sentryCard(full) {
    const s = signals?.sentry;
    const head = [source('Sentry', 'sentry'), el('h2', { text: 'Crashes' })];
    if (signals === undefined) return el('section', { class: 'card' }, [...head, loading()]);
    if (!s || !s.connected) return el('section', { class: 'card' }, [...head, ...notConnected('Sentry', ['SENTRY_TOKEN'])]);
    if (s.error) return el('section', { class: 'card' }, [...head, el('p', { class: 'error', text: s.error })]);
    const issues = s.issues ?? [];
    const shown = full ? issues : issues.slice(0, 3);
    return el('section', { class: 'card' }, [
      ...head,
      el('p', { class: 'quiet small', text: 'Crashes and errors on real phones, last 14 days.' }),
      el('p', { class: 'big', text: s.crash_free == null ? 'No data' : `${(s.crash_free * 100).toFixed(s.crash_free === 1 ? 0 : 1)}%` }),
      el('p', {
        class: 'quiet small',
        text: s.crash_free == null
          ? 'Sentry has no sessions to measure yet.'
          : `of ${plural(Number(s.sessions ?? 0), 'session')} ended without a crash, last 7 days`,
      }),
      el('div', { class: 'rule' }),
      ...(shown.length
        ? shown.map((i) =>
            el('div', { class: 'line' }, [
              el('b', { text: i.title }),
              el('span', {
                class: 'quiet small',
                text: [i.id, `${num(i.count)} ${Number(i.count) === 1 ? 'time' : 'times'}`, plural(Number(i.users ?? 0), 'person', 'people'), `last ${ago(i.last_seen)}`].filter(Boolean).join(' · '),
              }),
              full ? el('a', { href: i.url, target: '_blank', rel: 'noopener noreferrer', class: 'small', text: 'Open in Sentry' }) : null,
            ]),
          )
        : [el('p', { class: 'empty', text: 'Nothing unresolved.' })]),
      !full && issues.length > shown.length
        ? el('button', { class: 'link small', type: 'button', text: `See all ${issues.length} in Health`, on: { click: () => setTab('health') } })
        : null,
      full && s.url ? el('p', { class: 'small foot' }, [el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open Sentry' })]) : null,
    ]);
  }

  function posthogCard() {
    const p = signals?.posthog;
    const head = [source('PostHog', 'posthog'), el('h2', { text: 'Sessions and Phones' })];
    if (signals === undefined) return el('section', { class: 'card' }, [...head, loading()]);
    if (!p || !p.connected) return el('section', { class: 'card' }, [...head, ...notConnected('PostHog', ['POSTHOG_KEY', 'POSTHOG_PROJECT'])]);
    if (p.error) return el('section', { class: 'card' }, [...head, el('p', { class: 'error', text: p.error })]);
    const secs = p.avg_seconds;
    const length = secs == null ? 'No data' : secs >= 60 ? `${Math.floor(secs / 60)} min ${secs % 60} s` : `${secs} s`;
    const kv = (k, v) => el('div', { class: 'kv' }, [el('span', { text: k }), el('b', { text: v })]);
    return el('section', { class: 'card' }, [
      ...head,
      el('p', { class: 'quiet small', text: 'The last 7 days. Counts test builds and phones that opened Bite without signing in, so it runs higher than your member count.' }),
      el('div', { class: 'kvs' }, [
        kv('Sessions', num(p.sessions)),
        ...(p.signed_in == null
          ? [kv('People and Phones', num(p.people))]
          : [kv('Signed-In People', num(p.signed_in)), kv('Phones Not Signed In', num(Math.max(0, p.people - p.signed_in)))]),
        kv('Typical Session', length),
        ...(p.devices ?? []).slice(0, 3).map((d) => kv(d.name, plural(d.n, 'person', 'people'))),
        ...(p.systems ?? []).slice(0, 2).map((d) => kv(d.name, plural(d.n, 'person', 'people'))),
      ]),
      p.part_error ? el('p', { class: 'error small', text: p.part_error }) : null,
      p.url ? el('p', { class: 'small foot' }, [el('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open PostHog' })]) : null,
    ]);
  }

  // ───────────────────────── Pulse ─────────────────────────

  function renderTiles() {
    const box = $('totals');
    if (!pulse) return false;
    const one = (n, label, sub, hot) =>
      el('div', { class: hot ? 'total hot' : 'total' }, [
        el('b', { text: num(n) }),
        el('span', { text: label }),
        sub ? el('em', { text: sub }) : null,
      ]);
    const week = (n) => (n ? `+${num(n)} this week` : 'none this week');
    box.replaceChildren(
      one(pulse.members, 'Members', week(pulse.members_week)),
      one(pulse.active_week, 'Active This Week', `of ${plural(Number(pulse.members ?? 0), 'member')}`),
      one(pulse.visits, 'Visits Logged', week(pulse.visits_week)),
      one(pulse.saves, 'Places Saved', week(pulse.saves_week)),
      one(pulse.open_bugs, 'Open Bugs', pulse.open_bugs ? `newest ${ago(pulse.newest_bug)}` : 'all clear', pulse.open_bugs > 0),
    );
    box.hidden = false;
    return true;
  }

  function renderPulse() {
    const view = $('view-pulse');
    if (pulse === undefined) return view.replaceChildren(loading());
    if (pulse === null) return view.replaceChildren(needs('Pulse'));

    const todo = pulse.todo ?? [];
    const todoCard = el('section', { class: 'card' }, [
      el('h2', { text: 'Do This Next' }),
      el('p', { class: 'quiet small', text: 'Worked out from the numbers every time you open this page. Most urgent first.' }),
      todo.length
        ? el('div', { class: 'todo' }, todo.map((t, i) =>
            el('div', { class: 'todo-item' }, [
              el('div', { class: t.level === 'hot' ? 'todo-n hot' : 'todo-n', text: String(i + 1) }),
              el('div', {}, [el('b', { text: t.title }), el('p', { text: t.detail })]),
              t.go && GO[t.go]
                ? el('button', { class: 'plain small-btn', type: 'button', text: GO[t.go], on: { click: () => setTab(t.go) } })
                : el('span'),
            ]),
          ))
        : el('p', { class: 'empty', text: 'Nothing needs you today.' }),
    ]);

    const days = pulse.days ?? [];
    const top = Math.max(1, ...days.map((d) => d.n));
    const funnel = pulse.funnel ?? [];
    const signed = funnel[0]?.n ?? 0;
    const chartCard = el('section', { class: 'card' }, [
      el('h2', { text: 'Active Each Day' }),
      el('p', { class: 'quiet small', text: 'People who opened Bite, last 14 days.' }),
      el('div', { class: 'days', role: 'img', 'aria-label': days.map((d) => `${dayMonth(d.d)}: ${d.n}`).join(', ') },
        days.map((d) =>
          el('div', { class: d.n ? 'day' : 'day none', title: `${dayMonth(d.d)}: ${plural(d.n, 'person', 'people')}` }, [
            el('s', { text: d.n ? String(d.n) : '' }),
            d.n ? sized(el('div'), 'height', `${Math.round((d.n / top) * 84)}%`) : el('div'),
            el('em', { text: String(new Date(`${d.d}T00:00:00`).getDate()) }),
          ]),
        )),
      el('div', { class: 'rule' }),
      el('h2', { text: 'From Sign-Up to Regular' }),
      el('p', { class: 'quiet small', text: 'Where people drop off.' }),
      el('div', { class: 'meters' }, funnel.map((f, i) => meter(FUNNEL[f.key] ?? f.key, f.n, signed, i < funnel.length - 1))),
    ]);

    const screens = pulse.screens ?? [];
    const most = Math.max(1, ...screens.map((s) => s.n));
    const screensCard = el('section', { class: 'card' }, [
      el('h2', { text: 'Where People Spend Time' }),
      el('p', { class: 'quiet small', text: 'Screens opened this week.' }),
      screens.length
        ? el('div', { class: 'meters' }, screens.slice(0, 8).map((s) => meter(screenName(s.path), s.n, most)))
        : el('p', { class: 'empty', text: 'Nobody has opened Bite this week.' }),
    ]);

    view.replaceChildren(
      el('div', { class: 'ops-two' }, [todoCard, chartCard]),
      el('div', { class: 'ops-three' }, [screensCard, sentryCard(false), posthogCard()]),
    );
  }

  // ───────────────────────── People ─────────────────────────

  function stateOf(p) {
    if (Date.now() - new Date(p.joined).getTime() < 3 * DAY) return { key: 'new', text: 'New', cls: 'pill lime' };
    if (!p.last_seen || Date.now() - new Date(p.last_seen).getTime() > 7 * DAY) return { key: 'quiet', text: 'Gone Quiet', cls: 'pill warn' };
    return { key: 'active', text: 'Active', cls: 'pill good' };
  }

  function renderPeople() {
    const view = $('view-people');
    if (people === undefined) return view.replaceChildren(loading());
    if (people === null) return view.replaceChildren(needs('People'));

    const latest = updates().latest;
    const rows = people.map((p) => ({ ...p, state: stateOf(p), idle: Number(p.visits) + Number(p.saves) === 0 }));
    const count = (k) => (k === 'all' ? rows.length : k === 'idle' ? rows.filter((r) => r.idle).length : rows.filter((r) => r.state.key === k).length);
    const chips = [['all', 'Everyone'], ['active', 'Active'], ['new', 'New'], ['quiet', 'Gone Quiet'], ['idle', 'Nothing Logged']];
    const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'idle' ? r.idle : r.state.key === filter));

    const head = ['Member', 'Status', 'Joined', 'Last Seen', 'Days Active', 'Visits', 'Saves', 'Guides', 'Followers', 'Update'];
    const body = [];
    for (const p of shown) {
      const up = updateState(p, latest);
      const open = openPerson === p.id;
      body.push(
        el('tr', {
          class: open ? 'person open' : 'person',
          tabindex: '0',
          on: {
            click: () => { openPerson = open ? null : p.id; renderPeople(); },
            keydown: (evt) => { if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); openPerson = open ? null : p.id; renderPeople(); } },
          },
        }, [
          el('td', {}, [
            el('b', { text: p.display_name || p.username || 'No name' }),
            el('span', { class: 'quiet small who', text: [p.username ? `@${p.username}` : null, p.is_admin ? 'Team' : null, p.is_private ? 'Private' : null].filter(Boolean).join(' · ') }),
          ]),
          el('td', {}, [el('span', { class: p.state.cls, text: p.state.text })]),
          el('td', { text: dayMonth(p.joined) }),
          el('td', { text: ago(p.last_seen) }),
          el('td', { text: `${p.days_14} of 14` }),
          el('td', { class: 'n', text: num(p.visits) }),
          el('td', { class: 'n', text: num(p.saves) }),
          el('td', { class: 'n', text: num(p.guides) }),
          el('td', { class: 'n', text: num(p.followers) }),
          el('td', {}, [el('span', { class: up.cls, text: up.text })]),
        ]),
      );
      if (open) {
        const r = p.running ?? {};
        const phone = [r.device, r.os].filter(Boolean).join(', ');
        body.push(
          el('tr', { class: 'person-more' }, [
            el('td', { colspan: String(head.length) }, [
              el('div', { class: 'more' }, [
                el('div', {}, [
                  el('h3', { text: 'Last Things They Did' }),
                  ...((p.recent ?? []).length
                    ? p.recent.map((a) => el('p', { class: 'small' }, [el('b', { text: actionName(a.name) }), document.createTextNode(` · ${ago(a.at)}`)]))
                    : [el('p', { class: 'quiet small', text: 'Nothing beyond opening the app.' })]),
                ]),
                el('div', {}, [
                  el('h3', { text: 'Their Phone' }),
                  el('p', { class: 'small', text: phone || 'Not reported yet. It shows after they open Bite on the next update.' }),
                  el('p', { class: 'small', text: r.update_at ? `Update from ${dayTime(r.update_at)}` : r.version ? `Version ${r.version}${r.build ? ` (${r.build})` : ''}, no update loaded` : '' }),
                  el('p', { class: 'quiet small', text: `Follows ${plural(Number(p.following ?? 0), 'person', 'people')}. ${p.setup ? 'Finished setup.' : 'Has not finished setup.'}` }),
                ]),
              ]),
            ]),
          ]),
        );
      }
    }

    view.replaceChildren(
      el('section', { class: 'card' }, [
        el('h2', { text: 'People' }),
        el('p', { class: 'quiet small', text: 'Every member, by when they were last seen. Counts only: never which places, never what they wrote. Click a row for more.' }),
        el('div', { class: 'chips filter' }, chips.map(([k, label]) =>
          el('button', {
            class: filter === k ? 'chip on' : 'chip', type: 'button', text: `${label} ${count(k)}`,
            on: { click: () => { filter = k; openPerson = null; renderPeople(); } },
          }))),
        shown.length
          ? el('div', { class: 'table-wrap' }, [
              el('table', { class: 'people' }, [
                el('thead', {}, [el('tr', {}, head.map((h, i) => el('th', { class: i >= 5 && i <= 8 ? 'n' : null, text: h })))]),
                el('tbody', {}, body),
              ]),
            ])
          : el('p', { class: 'empty', text: 'Nobody here.' }),
      ]),
    );
  }

  // ───────────────────────── Health ─────────────────────────

  function bugRow(i) {
    const s = i.sample ?? {};
    const open = openBug === i.fingerprint;
    const meta = [
      KINDS[i.kind] ?? i.kind,
      `${num(i.count)} ${Number(i.count) === 1 ? 'time' : 'times'}`,
      plural(Number(i.users ?? 0), 'person', 'people'),
      `last ${ago(i.last_seen)}`,
      s.screen ? `on ${screenName(s.screen)}` : null,
    ].filter(Boolean).join(' · ');
    const button = (text, status, cls = 'plain small-btn') =>
      el('button', {
        class: cls, type: 'button', text,
        on: { click: () => act(() => api.resolveBug(i.fingerprint, status), status === 'fixed' ? 'Marked fixed' : status === 'ignored' ? 'Ignored' : 'Reopened') },
      });
    return el('div', { class: `bug ${i.status}` }, [
      el('div', { class: 'bug-top' }, [
        el('div', {}, [
          el('b', { text: i.title }),
          el('span', { class: 'quiet small', text: meta }),
        ]),
        el('div', { class: 'bug-acts' }, [
          el('span', { class: i.status === 'open' ? 'pill warn' : i.status === 'fixed' ? 'pill good' : 'pill grey', text: i.status === 'open' ? (i.reopened_at ? 'Back Again' : 'Open') : i.status === 'fixed' ? 'Fixed' : 'Ignored' }),
          ...(i.status === 'open' ? [button('Mark Fixed', 'fixed', 'primary small-btn'), button('Ignore', 'ignored')] : [button('Reopen', 'open')]),
          el('button', { class: 'link small', type: 'button', text: open ? 'Hide' : 'Details', on: { click: () => { openBug = open ? null : i.fingerprint; renderHealth(); } } }),
        ]),
      ]),
      open
        ? el('div', { class: 'bug-more' }, [
            el('p', { class: 'small', text: [s.device, s.platform && s.os_version ? `${s.platform} ${s.os_version}` : null, s.app_version ? `version ${s.app_version}` : null, s.created_at ? dayTime(s.created_at) : null].filter(Boolean).join(' · ') }),
            el('p', { class: 'small', text: s.message ?? '' }),
            s.stack ? el('pre', { text: s.stack }) : null,
            i.note ? el('p', { class: 'quiet small', text: `Note: ${i.note}` }) : null,
          ])
        : null,
    ]);
  }

  // The daily bug check. Claude reads the bugs each morning in the Claude
  // app, and writes what it found here. This page can switch it on and
  // off and say yes or no to a fix. It cannot build or publish anything:
  // a yes is acted on at the check's next run, and publishing takes
  // Arnold's word in Claude.
  const REPORT_STATE = {
    waiting: ['Waiting for You', 'pill warn'],
    approved: ['Approved', 'pill lime'],
    declined: ['Not Now', 'pill grey'],
    built: ['Built, Not Published', 'pill lime'],
    published: ['Published', 'pill good'],
    closed: ['Closed', 'pill grey'],
  };
  const FIX_KIND = { app: 'An app update', database: 'A database change you run', yours: 'Something only you can do', none: 'Nothing to change' };
  const CHECK_MODES = [['daily', 'Every Day'], ['weekdays', 'Weekdays'], ['off', 'Off']];

  function reportRow(r) {
    const [stateText, stateCls] = REPORT_STATE[r.status] ?? [r.status, 'pill grey'];
    const live = ['waiting', 'approved', 'built'].includes(r.status);
    const decide = (text, decision, cls, done) =>
      el('button', { class: cls, type: 'button', text, on: { click: () => act(() => api.bugDecide(r.id, decision), done) } });
    const part = (label, text, lead) =>
      text
        ? el('div', { class: 'part' }, [
            el('h3', { text: label }),
            lead ? el('p', { class: 'small lead', text: lead }) : null,
            el('p', { text }),
          ])
        : null;
    return el('div', { class: live ? 'bug report' : 'bug report done' }, [
      el('div', { class: 'bug-top' }, [
        el('div', {}, [
          el('b', { text: r.title }),
          el('span', {
            class: 'quiet small',
            text: [r.source === 'sentry' ? 'From Sentry' : 'From Bite\u2019s log', `found ${ago(r.created_at)}`, r.hit].filter(Boolean).join(' · '),
          }),
        ]),
        el('div', { class: 'bug-acts' }, [
          el('span', { class: stateCls, text: stateText }),
          ...(r.status === 'waiting'
            ? [decide('Approve', 'approved', 'primary small-btn', 'Approved. It is built at the next check.'), decide('Not Now', 'declined', 'plain small-btn', 'Left alone')]
            : r.status === 'approved' || r.status === 'declined'
              ? [decide('Undo', 'waiting', 'plain small-btn', 'Back to waiting')]
              : []),
        ]),
      ]),
      live
        ? el('div', { class: 'report-body' }, [
            part('Cause', r.cause),
            part('Fix', r.fix, FIX_KIND[r.fix_kind]),
            part('Risk', r.risk),
            part('What Happened', r.result),
          ])
        : r.result
          ? el('p', { class: 'quiet small', text: r.result })
          : null,
    ]);
  }

  function checkCard() {
    if (check === undefined) return el('section', { class: 'card' }, [el('h2', { text: 'Bug Check' }), loading()]);
    if (check === null) {
      return el('section', { class: 'card' }, [
        el('h2', { text: 'Bug Check' }),
        el('p', { class: 'quiet', text: 'This needs migration 073. Run it in Supabase and reload.' }),
      ]);
    }
    const reports = check.reports ?? [];
    const how = check.mode === 'off'
      ? 'Switched off. Nothing is reading the bugs for you.'
      : `Claude reads the bugs ${check.mode === 'weekdays' ? 'each weekday' : 'every'} morning, finds the cause and puts the fix here for you to approve.`;
    return el('section', { class: 'card' }, [
      el('div', { class: 'check-top' }, [
        el('div', {}, [
          el('h2', { text: 'Bug Check' }),
          el('p', { class: 'quiet small', text: how }),
          el('p', { class: 'quiet small', text: check.last_run ? `Last ran ${dayTime(check.last_run)}. ${check.last_note ?? ''}` : 'It has not reported here yet.' }),
        ]),
        el('div', { class: 'seg' }, CHECK_MODES.map(([k, label]) =>
          el('button', {
            class: check.mode === k ? 'on' : null, type: 'button', text: label,
            on: { click: () => { if (check.mode !== k) act(() => api.bugCheckSet(k), k === 'off' ? 'Bug Check is off' : `Bug Check runs ${k === 'weekdays' ? 'on weekdays' : 'every day'}`); } },
          }))),
      ]),
      reports.length
        ? el('div', { class: 'bugs' }, reports.map(reportRow))
        : el('p', { class: 'empty', text: 'No proposals yet. When a bug turns up, its cause and fix appear here.' }),
      el('p', { class: 'quiet small foot', text: 'Approve a fix and it is built the next time the check runs. A built fix reaches phones only when you say go in Claude. The time of day is set in the Claude app, under Scheduled.' }),
    ]);
  }

  function renderHealth() {
    const view = $('view-health');
    if (bugs === undefined) return view.replaceChildren(loading());

    const issues = bugs?.issues ?? [];
    const bugsCard = el('section', { class: 'card' }, [
      el('h2', { text: 'Bugs' }),
      el('p', {
        class: 'quiet small',
        text: bugs === null
          ? 'The bug log could not be read.'
          : `From Bite's own log. ${plural(Number(bugs.open ?? 0), 'open issue')}, ${plural(Number(bugs.reports_7d ?? 0), 'report')} from ${plural(Number(bugs.users_7d ?? 0), 'person', 'people')} this week. Mark one fixed and it reopens by itself if it comes back in a newer version.`,
      }),
      issues.length ? el('div', { class: 'bugs' }, issues.map(bugRow)) : el('p', { class: 'empty', text: 'Nothing has broken.' }),
    ]);

    const u = updates();
    const updateCard = el('section', { class: 'card' }, [
      el('h2', { text: 'Who Has the Latest Update' }),
      people == null
        ? el('p', { class: 'quiet small', text: people === null ? 'This needs migration 072.' : 'Loading…' })
        : !u.latest
          ? el('p', { class: 'quiet small', text: 'No phone has reported an update yet. They start reporting once the app update that adds this is published and opened.' })
          : el('div', {}, [
              el('p', { class: 'big', text: `${u.on} of ${u.on + u.behind.length}` }),
              el('p', { class: 'quiet small', text: `people who have opened Bite since it came out are on the update from ${dayTime(u.latest)}, the newest any phone has reported.` }),
              el('div', { class: 'rule' }),
              ...(u.behind.length
                ? u.behind.map((p) =>
                    el('div', { class: 'line' }, [
                      el('b', { text: p.display_name || p.username || 'No name' }),
                      el('span', { class: 'quiet small', text: `Opened ${ago(p.running.at)}, still on ${p.running.update_at ? `the update from ${dayTime(p.running.update_at)}` : 'the plain build'}. Their next open picks it up.` }),
                    ]))
                : [el('p', { class: 'empty', text: 'Everyone who has opened Bite since is on it.' })]),
              u.away.length ? el('div', { class: 'rule' }) : null,
              u.away.length ? el('h3', { class: 'sub', text: 'Not Opened Bite Since' }) : null,
              ...u.away.map((p) =>
                el('div', { class: 'line' }, [
                  el('b', { text: p.display_name || p.username || 'No name' }),
                  el('span', { class: 'quiet small', text: `Last opened ${ago(p.running.at)}. They get it when they come back.` }),
                ])),
              el('p', { class: 'quiet small foot', text: 'A phone picks up an update the second time it opens Bite after you publish.' }),
            ]),
    ]);

    view.replaceChildren(checkCard(), bugsCard, el('div', { class: 'ops-two even' }, [sentryCard(true), updateCard]));
  }

  // ───────────────────────── Inbox ─────────────────────────

  function renderInbox() {
    const view = $('view-inbox');
    if (inbox === undefined) return view.replaceChildren(loading());
    if (inbox === null) return view.replaceChildren(needs('Inbox'));

    const reports = inbox.reports ?? [];
    const decide = (r, action, sure, done) =>
      el('button', {
        class: action === 'dismiss' ? 'plain small-btn' : 'danger small-btn', type: 'button',
        text: action === 'remove' ? 'Remove It' : action === 'ban' ? 'Delete Account' : 'Dismiss',
        on: { click: () => { if (!sure || window.confirm(sure)) act(() => api.resolveReport(r.id, action), done); } },
      });
    const reportsCard = el('section', { class: 'card' }, [
      el('h2', { text: 'Reports' }),
      el('p', { class: 'quiet small', text: 'Things members have flagged. Newest first.' }),
      reports.length
        ? el('div', { class: 'bugs' }, reports.map((r) =>
            el('div', { class: 'bug open' }, [
              el('div', { class: 'bug-top' }, [
                el('div', {}, [
                  el('b', { text: `${TARGETS[r.target_type] ?? 'Something'} by ${r.target_name || (r.target_username ? `@${r.target_username}` : 'a deleted account')}` }),
                  el('span', { class: 'quiet small', text: [REASONS[r.reason] ?? r.reason, `reported by ${r.reporter || 'someone'}`, ago(r.created_at), Number(r.against_user) > 1 ? `${r.against_user} reports against this account` : null].filter(Boolean).join(' · ') }),
                  r.preview ? el('p', { class: 'quote', text: r.preview }) : null,
                  r.details ? el('p', { class: 'small', text: `They said: ${r.details}` }) : null,
                ]),
                el('div', { class: 'bug-acts' }, [
                  r.target_type !== 'user' ? decide(r, 'remove', 'Remove this for everyone? It cannot be brought back.', 'Removed') : null,
                  decide(r, 'dismiss', null, 'Dismissed'),
                  decide(r, 'ban', 'Delete this whole account, with everything it posted? This cannot be undone.', 'Account deleted'),
                ]),
              ]),
            ])))
        : el('p', { class: 'empty', text: 'Nothing has been reported.' }),
    ]);

    const requests = inbox.requests ?? [];
    const STATUS = [['open', 'Open'], ['planned', 'Planned'], ['shipped', 'Shipped']];
    const requestsCard = el('section', { class: 'card' }, [
      el('h2', { text: 'Feature Requests' }),
      el('p', { class: 'quiet small', text: 'What members asked for in the app, most wanted first. They see the status you set.' }),
      requests.length
        ? el('div', { class: 'bugs' }, requests.map((q) =>
            el('div', { class: 'bug' }, [
              el('div', { class: 'bug-top' }, [
                el('div', { class: 'votes' }, [el('b', { text: num(q.votes) }), el('span', { text: Number(q.votes) === 1 ? 'vote' : 'votes' })]),
                el('div', { class: 'grow' }, [
                  el('b', { text: q.title }),
                  el('span', { class: 'quiet small', text: `${q.display_name || (q.username ? `@${q.username}` : 'Someone')} · ${ago(q.created_at)}` }),
                ]),
                el('div', { class: 'seg' }, STATUS.map(([k, label]) =>
                  el('button', {
                    class: q.status === k ? 'on' : null, type: 'button', text: label,
                    on: { click: () => { if (q.status !== k) act(() => api.requestStatus(q.id, k), `Marked ${label.toLowerCase()}`); } },
                  }))),
              ]),
            ])))
        : el('p', { class: 'empty', text: 'Nobody has asked for anything yet.' }),
    ]);

    view.replaceChildren(reportsCard, requestsCard);
  }

  // ───────────────────────── loading ─────────────────────────

  function renderAll() {
    renderPulse();
    renderPeople();
    renderHealth();
    renderInbox();
  }

  async function refresh() {
    [pulse, people, inbox, bugs, check] = await Promise.all([api.pulse(), api.people(), api.inbox(), api.bugs(), api.bugCheck()]);
    renderTiles();
    renderAll();
    // Sentry and PostHog answer more slowly: fill them in when they do.
    api.signals((people ?? []).map((p) => p.id)).then((s) => {
      signals = s?.ok ? s : { sentry: { connected: false }, posthog: { connected: false } };
      renderPulse();
      renderHealth();
    });
  }

  return { refresh, renderAll, renderTiles, has: () => Boolean(pulse) };
}
