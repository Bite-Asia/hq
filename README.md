# Bite HQ

The admin website for Bite, at https://bite-asia.github.io/hq/

It edits Bite's hand-picked lists: Top 25, Newly opened, Sweet Tooth,
Coffee & Matcha. Drag a place to rank it, search to add one, remove one,
and publish.

## Who can use it

Only an admin account of the Bite app. The page is public, but it holds
no secrets and cannot change anything by itself: every change goes
through a database function that first checks the signed-in account is
an admin. Signing in with any other account shows nothing.

Try it without an account: https://bite-asia.github.io/hq/?demo uses
made-up places and saves nothing.

## How it behaves

- **Ranking is live at once.** Drop a place in a new position and the
  app shows the new order straight away. No notification is sent.
- **Adding and removing are drafts.** They wait for Publish now, or for
  the 1st of the month at 9am Singapore, whichever comes first.
- **Publishing notifies everyone.** Each account gets one notification
  from @bite, and the monthly clock restarts.
- **Search** finds places already on Bite as you type. Press Enter to
  search every place in Singapore.

## Files

| File | What it is |
|---|---|
| `index.html`, `hq.css`, `hq.js` | The page. Written by hand. |
| `config.js` | The Supabase address, the public key and the list names. Generated. |
| `tags-cuisines.js`, `tags-areas.js` | The app's rules for cuisine, venue type and area. Generated. |

The three generated files come from the app's own source, so the website
and the app cannot drift apart. To rebuild them, in the `bite` folder:

    node scripts/gen-hq.js

then commit and push this folder.

The key in `config.js` is the public one that ships inside every copy of
the app. The generator refuses to write any other kind.

## The other half

- Database: migrations 055, 056 and 065 in the `bite` repo
  (`set_editor_pick`, `publish_editor_picks`, `set_editor_pick_order`).
- Place search: the `hq-places` Edge Function in the `bite` repo. It
  holds the Google key as a server secret (`GOOGLE_PLACES_KEY`), so the
  key is never in this public repo.
