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
- **Checking a place.** A search result shows a photo, what Google
  calls it, its Google rating, and whether it has closed. Click a name
  or a photo for the close-up: six photos, a link to Google Maps, and
  what people on Bite have done there.
- **What Bite is saying.** Most visited, top rated, most saved and
  rising places, from everyone on Bite. Totals only, never who.

## The three sections

- **Lists.** The four hand-picked lists, a Preview of each as the app
  shows it, a warning when a listed place has closed, and Bite’s numbers.
- **Guides.** Guides owned by the official Bite account: write, order,
  add a note to each place, keep private or make public, delete.
- **History.** Who changed what and when, on the website or in the app.

The closed-place check asks Google about every listed place once a
week, when the site is opened. It does not run on its own.

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

- Database: migrations 055, 056, 065, 066 and 067 in the `bite` repo.
  Every function the site calls checks the caller is an admin.
- Place search: the `hq-places` Edge Function in the `bite` repo. It
  holds the Google key as a server secret (`GOOGLE_PLACES_KEY`), so the
  key is never in this public repo.
