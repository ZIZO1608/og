# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Retail operations for a real sneaker and streetwear shop in **Aleppo, Syria** — till, stock across two
warehouses, customers, money, barcode scanning, label printing, and a separate portal for **Yalla Wear**,
the print partner (a different company, working remotely).

Two audiences shape every decision: shop staff who are not computer people, and a client who is shown
this in meetings. The owner keeps his records on paper today.

## Commands

```bash
# The real thing — serves the app AND the API from one origin on :8090
cd server && npm start          # or double-click start-og-system.bat

# serve.ps1 and double-clicking index.html no longer show an app — there is
# nothing to draw without the server. Both now say so rather than inventing a shop.

cd server
npm run createuser               # interactive; also accepts piped stdin
npm run backup                   # VACUUM INTO + integrity_check + FK check
npm run preflight                # accounts, catalogue, Supabase, port
npm run supabase:check           # is the mirror a faithful copy of the DATA
npm run supabase:drift           # can the next write even land — the SHAPE
npm run hardware                 # printers and scanner: what is missing, and why
npm run hardware:install         # installs what it can (asks for administrator)
npm run cert:trust               # Windows trusts the self-signed certificate (asks for administrator once)
```

### The till's hardware

`server/scripts/hardware.js`, run by `start-og-system.bat` after the port check — so a
double-click while the shop is already open does nothing. It exits **4** when something is
missing that it can install (the launcher then installs and asks again), **1** when a person
is needed, **0** otherwise. **It never stops the shop opening**: a till that cannot print can
still sell shoes, same rule as `preflight.js`.

**The driver the printers need is not the one on the box.** Both are sent bytes they already
understand — ESC/POS for the receipt, TSPL for the label — so what they need is a shared queue
on the Windows built-in **`Generic / Text Only`** driver. The manufacturer's driver is worse
than none: it accepts the job and reformats the command bytes into pages of gibberish, which
looks like a working printer. Which queue is checked comes from `receipt.printer_share` and
`agent/agent-config.json`; a printer on `transport = tcp` has no driver at all and is only
probed on :9100.

**The scanner has no driver, deliberately** — it enumerates as a keyboard (see `js/wedge.js`),
so there is nothing to install and the check says so rather than inventing a step. It reports
what can actually be wrong: a device Windows left sitting on an error.

It **will not guess between two USB ports.** One candidate, identified by the vendor driver
name already on that port, is a fact; choosing between two is how labels come out of the
receipt printer all morning. Two candidates means it stops and prints the list.

**Node 22.5+ required** (`node:sqlite` is used, which arrived in 22.5). There is **no `npm install`** —
the server has zero dependencies by design, and the frontend has no build step at all.

Publishing: **double-click `push.bat`** (add → commit → pull --rebase → push). CI then builds `dist/`
and deploys to GitHub Pages.

### HTTPS, and why the till needs it

`cd server && npm run cert` once per machine, then restart. The server listens on
**https://localhost:8443** (`OG_HTTPS_PORT`) and the plain HTTP port keeps working: it serves
the API unchanged and **redirects only browser page requests** to the secure address. Machines —
the print agent, the website's bearer-key calls, any local script — carry on over http, because
a redirect to a self-signed origin fails certificate validation in Node with an error about
nothing they did.

**This is not cosmetic.** On `http://10.10.99.9:8090` a browser silently refuses three things
the app needs, with no error a shopkeeper would recognise: `Notification` (the phone never
buzzes for a new order), `getUserMedia` (the camera barcode scanner cannot open the camera) and
`serviceWorker` (no offline shell, cannot be installed). `http://localhost` is exempt, which is
exactly why this went unnoticed on the machine doing the testing.

- The certificate is **self-signed** (`server/lib/tls.js` says why): each device shows one
  "not a known authority" warning, somebody presses continue, and from then on the origin is
  secure. A certificate the world trusts needs a public domain, which means exposing a till full
  of real money to the internet.
- **On the till itself that warning is gone**: `npm run cert:trust` (`scripts/trust-cert.js`)
  puts the certificate in Windows' machine-wide trusted list through `certutil`, asking for
  administrator once, and `start-og-system.bat` runs its free `--check` every morning and only
  prompts when it is not there. Before this the launcher opened `https://localhost:8443` straight
  onto a full-page red "not private" every day, and it was reported as "there is an error".
  Phones still get the one warning: the certificate is deliberately not an authority (`CA:FALSE`),
  because an authority that anyone with `server/data/certs/` could copy would sign for any site.
  `cert:untrust` takes it out again after a re-run of `npm run cert`.
- **The launcher opens the browser itself** (`scripts/open-when-ready.js`, started with
  `start /b` just before `node index.js`, which blocks the window): it polls `/api/health` and
  opens whichever address the health line says is actually serving. The "already open" branch
  uses the same script rather than guessing https from a file on disk.
- `SECURE` sets itself when HTTPS is actually serving, so session cookies get the `Secure` flag
  without anyone remembering `OG_SECURE`. Browsers still accept Secure cookies on
  `http://localhost`, so the till on this machine is unaffected.
- **`server/lib/net.js` is the one list of this machine's addresses** — the startup print,
  `/api/health` (which the login screen reads) and the certificate's SANs all come from it. A
  certificate that does not name the address somebody types is a page that will not open at all,
  so the server compares the two at startup and says `npm run cert` by name when the IP has
  moved. It also warns 30 days before expiry.
- `server/data/certs/` is gitignored: it holds a private key, and it is one command to rebuild.

### Accounts

There are no test accounts. The five that used to exist (`hussam`, `lubna`, `maher`, `talal`,
`yalla`, all on a password published in the repo) were retired, and the scripts that created them
deleted. `maher` and `yalla` referenced nothing and were removed outright; `hussam`, `lubna` and
`talal` had rung up real sales and deliveries, so their rows survive **disabled, with their password
hashes replaced by random bytes** — deleting them would have taken the invoices that name them.

**Their old password is still in git history.** The server and `npm run preflight` both warn if one
of those usernames is ever `active = 1` again. Make new accounts with `npm run createuser`.

## Hard constraints

These are constraints, not preferences. Breaking one means rewriting a lot.

- **Vanilla HTML/CSS/JS. No framework, no bundler, no npm, no build step** for the frontend. Two
  third-party files, both committed directly to `js/vendor/`: `chart.umd.min.js`, and
  `three.min.js` (r147 — the last release with a UMD build and a `THREE` global; r150+ is ESM-only,
  which is a build-step-shaped problem). Three.js is **lazily injected by `js/shelfroom.js` the
  first time somebody opens the shelf map**, never a `<script>` in `index.html`: it is 600KB, and
  the till must not parse it every morning for a screen a cashier never opens.
- **It needs the server.** This used to say the opposite — that double-clicking `index.html` had to
  keep working offline, because that was the fastest way to show the app to a client. That constraint
  was dropped deliberately: it was paid for with a generated shop, and generated data on a till looks
  exactly like the truth. There is now no way to run the app without `cd server && npm start`.
- **Dark mode only. Montserrat. English and Arabic with real RTL** — the layouts are built for both, not
  a mirrored stylesheet.
- **No placeholder content.** No lorem ipsum, no "coming soon", no stock photos. Product images are CSS
  colour blocks. If a screen exists, it works.
- Avoid `:has()` and very recent CSS — this runs on the shop's actual hardware.

> `README.md` is out of date on several points. There is a real server; the Pages deployment at
> `https://zizo1608.github.io/og/` is a static host with no backend and so now shows only the
> "server is not answering" screen. Trust this file over the README.

## Architecture

Two halves that must both keep working:

```
index.html + css/ + js/     static frontend — runs with or without a server
server/                     zero-dependency Node + node:sqlite, serves the API *and* the static files
```

### One run mode: a real server, or nothing

`cd server && npm start`. That is the only way the app runs.

There used to be three. Opened from a `file://` double-click or served from GitHub Pages, the app ran
on a seeded generator — 24 products, 40 customers, 120 invoices — with a permanent DEMO banner over it.
Both are gone, along with `Auth.demoMode()`, the banner, and the ~500 lines that generated the shop.

**Nothing is invented to fill a screen.** Every collection in `js/data.js` starts empty and is filled
by `DB.hydrate()` from the server. When the server cannot be reached, `Shop.fail()` draws the reason
and how to fix it — an empty app would be read as "the shop has no stock" rather than "this machine
cannot reach the server", and those call for very different next actions.

The failure this prevents was specific and real: generated data looks exactly like the truth, so a
till that falls back to it takes money into memory nobody keeps. A banner is a thing you stop seeing
by the second day.

`_shot.html` loads **neither `api.js` nor `auth.js`**, so `Auth` is `undefined` there, and the
`typeof Auth === 'undefined'` guards all over the frontend exist for it. **It no longer renders
anything useful** — it drew the seeded shop, and there is no seeded shop. The file and its guards are
kept because deleting them is a separate decision; the Arabic proposal PDF cannot be built until it is
given a data source.

### Frontend conventions

- **Each module is an IIFE exposing one global**: `DB`, `POS`, `Codes`, `YALLA`, `Wedge`, `Auth`, `API`,
  `Deliveries`, … **Load order in `index.html` matters.**
- **Events are delegated, never bound per element.** One listener per namespace dispatching on a
  `data-*` attribute: `data-act`, `data-pos`, `data-yl`, `data-nt`, `data-mo`, `data-sc`, `data-st`,
  `data-bk`, `data-wa`, `data-change`. Adding a button means adding `data-act="thing"` and a case in
  `ACTIONS` — not an `addEventListener`.
- **Every new string goes in BOTH `I18N.en` and `I18N.ar`** in `js/app.js`. A missing Arabic key falls
  back to English mid-sentence inside an RTL layout and reads as a bug.
- `js/api.js` is **the only file allowed to talk to the server**. Everything else goes through `DB.*`.
- Every screen reads from the server. `js/data.js` holds the shape and the lookups; the data arrives
  through `DB.hydrate()`.

### Settings is an accordion, and a new card is a fold

Eleven unrelated jobs on one page — the receipt printer's paper width above the loyalty tiers above
who is signed in. `viewSettings()` stacks them as folds under five headings; `setFoldStart(id, title,
meta)` / `setFoldEnd()` in `js/app-settings.js` are the wrapper, `setSection(label)` the heading. Add a
card by writing one that returns `setFoldStart(…) + … + setFoldEnd()` and calling it from
`viewSettings()`.

- **`meta` is the point.** It is the line the head carries while the body is shut — the shop name, the
  rate, how many people are online. Without one the folded page is eleven bare nouns and every answer
  costs a click. Wrap anything with digits in `<span dir="ltr">`, or Arabic drags the leading number to
  the far end (`1 USD = 130 SYP` becomes `USD = 130 SYP 1`).
- **A shut section is hidden, not skipped.** Every body is in the DOM either way, so `afterSettings()`
  still binds the scanner probe, fills the shelf list and loads the roles grid behind a head nobody has
  opened. Rendering only what is open would mean re-running that hook on every toggle.
- **Toggling never calls `render()`.** Half these cards hold typed-but-unsaved values — the receipt
  footer, the printer's host, the shop name — and a repaint takes them back to what the server last
  said, mid-sentence. `ACTIONS['set-fold']` moves one attribute.
- Which folds are open lives in `localStorage` under `og.settings.open`, per MACHINE like the sidebar
  rail: the till wants the printer open and the office wants the roles grid, on the same account. Only
  open ones are stored, so a card added later starts shut.

### The seeded generator — call order is load-bearing

`js/data.js` builds the whole dataset from an LCG so every launch tells an identical story:

```js
seed = (seed * 1664525 + 1013904223) % 4294967296
```

Inserting one extra `rand()` call shifts every value drawn after it and silently rewrites unrelated
parts of the dataset. **If you need new randomness, add a separate generator with its own seed** — the
warehouse code already does this.

## Permissions — the model to understand before touching any screen

Deny by default. 28 permissions × 5 roles live in the **`role_permissions` table**, editable by a
manager in Settings. `server/lib/auth.js` holds `ALL_PERMISSIONS` (the labels and grouping) and caches
the table in memory; **every write path calls `invalidatePermissions()`** — a stale cache here is a
security bug.

**Two layers, and only one is a boundary:**

- Browser: `Auth.can()` / the `allow()` helper decide what to **draw**. A courtesy.
- Server: `requirePerm()` decides what is **allowed**. The real guard.

If you add a screen showing cost, profit or customer data, guard it in both — and treat the server one
as the actual protection.

### Helpers in `js/app.js` you should reuse rather than re-derive

```js
roleOf()            // 'manager' | 'cashier' | … | null in _shot.html
allow(perm)         // Auth.can(), or true in _shot.html where Auth does not exist
seesCost()          // allow('cost.read')
seesProfit()        // allow('profit.read')
isPartnerAccount()  // Yalla Wear — locked into their portal
navAllowed(id)      // per-screen gate, via the NAV_PERM map
ifNav(view, html)   // wrap in-page shortcut buttons ("View all →")
```

`allow()` returns **true** only when `Auth` is undefined, which now means `_shot.html` alone. In the
app it is `Auth.can()`, so a signed-out browser draws nothing — there is no longer a mode where
everything is permitted because nothing is real.

### Two rules enforced in code, not in the table

In `server/lib/auth.js`:

- **`PINNED`** — `manager` always keeps `config.write` and `staff.write`. A manager who removes their own
  access to Settings leaves nobody able to put it back without opening the database by hand.
- **`FORBIDDEN`** — `partner` (Yalla Wear) can never be granted `customer.*`, `cost.read`, `profit.read`,
  `money.*`, `staff.*`, `delivery.*` or `discount.unlimited`. They are a different company. One
  mis-clicked box must not hand a supplier your customer list and your margins.

Both are refused server-side and shown disabled with a reason — **a disabled tick box is a suggestion**,
anyone can send the request by hand.

### Home screen is chosen by role

`VIEWS.dashboard` in `js/app.js` is a chooser, not one screen with four moods:

| Role | Home | Built from |
|---|---|---|
| cashier | `viewShiftHome()` — her shift, never the shop's money | `stat`, `card`, `tbl` markup |
| warehouse | `viewBackHome()` — what arrived, what needs moving | same |
| delivery | `viewRunsHome()` → `Deliveries.view()` | live server data |
| manager / `_shot.html` | `viewDashboard()` — the full dashboard | charts |

The partner never reaches it: `boot()` and `render()` both force `OG.print.partner = true` for that role.
**There is no door between the two sides in either direction.** The `partner-view` toggle, the sidebar
entry, the Print-screen buttons, the More-sheet row and the portal's "Back to OG System" were all
removed on request: which side an account sees is decided by its role at login and nothing in the
browser flips it. A scanned partner-invoice QR opens OG's own copy of the bill (`openPartnerInvoice`)
for a shop account and the portal's for Yalla Wear, rather than switching portals.

**`boot()` must apply the same `navAllowed` guard as `go()`.** A bookmarked `#settings` arrives through
`boot()`, not `go()` — that gap was a real bug.

## Server

`server/index.js` routes; `server/lib/` does the work. Migrations are numbered `.sql`, each run in one
transaction and recorded once in `schema_migrations`.

Conventions that are non-negotiable and easy to break:

- **Money is integer minor units + a currency code.** Never floats. USD `minor_exp` 2 (cents), SYP 0
  (whole lira). The shop genuinely prices some goods in dollars and some in lira.
- **The exchange rate is frozen into each sale row.** Without it, re-running last month's profit after
  the rate moves gives a different answer every time and nobody can say which is true.
- **Stock is derived from an append-only movement log**, with the running total written in the same
  transaction under `CHECK (qty >= 0)`.
- **Prices always come from the product table, never from the client.** A till that can name its own
  price can sell a 450,000 pair for 1,000 and leave an ordinary-looking receipt.
- **Idempotency via `applied_ops` + a client-generated `opId`.** A till that loses wifi mid-request does
  not know whether the sale landed; the same `opId` returns the original invoice instead of selling twice.
- SQLite in WAL mode, `foreign_keys = ON`, `busy_timeout = 5000`, `BEGIN IMMEDIATE`. `DB.tx()` refuses to
  nest.
- Passwords: scrypt (N=32768, r=8, keylen=64). Sessions: `HttpOnly` `SameSite=Lax` cookies, 14-day
  sliding expiry. Login is throttled per username and hashes even for unknown users, so timing does not
  leak which accounts exist.

### `scrubCost`

`server/index.js` strips cost keys for anyone without `cost.read`, from the row **and from nested
`variants` / `items` arrays**. The nested case was a live leak — every cashier's own invoice response
carried `unit_cost` for every line. `COST_KEYS` is an explicit list; a new cost column must be added to it.

### Deliveries

`server/lib/deliveries.js`. Status moves one way: `waiting → out → delivered | failed`.

- **A driver is scoped to his own runs in the SQL query**, by role, not by what the request asks for.
- **Someone else's delivery returns 404, not 403** — a driver must not learn that a delivery to that
  address exists by telling the two apart.
- `to_collect` is **read from the sale** (`payment === 'cod' ? total : 0`), never from the request, and
  frozen at assignment.
- Assignment happens **after** the sale is committed, never in the same call. The money is already in the
  drawer; a failed delivery write must not unwind a real sale.

### Discounts

Capped at `config.sale.max_discount_pct` (10). Enforced in `Sales.record` and mirrored in `js/pos.js` so
the cashier is not made to look wrong in front of a customer. `discount.unlimited` lifts it. The server
returns **403 `discount_too_big`** with the real ceiling in the message.

## Gotchas that will bite you

- **The service worker is cache-first with `ignoreSearch: true`.** After changing anything under `css/`,
  `js/` or `index.html`, **bump `CACHE` in `sw.js`** (`og-system-v15` → `v16`) *and* add any new JS file
  to its precache list. Skip this and nobody who has already opened the app ever receives the change —
  no query-string cache-buster will help.
- **The server sends `X-Frame-Options: DENY`**, so a test harness cannot load the app in an iframe. Drive
  it top-level with a persistent Chrome profile instead (log in on one launch, inspect on the next; the
  session cookie is `HttpOnly` and cannot be forged).
- **Headless Chrome `--virtual-time-budget` makes `setTimeout` fire instantly**, so "wait 1.4s for the app
  to boot" waits for nothing. Poll a real readiness condition. Also give the runner a mouse when testing
  pointer-dependent code: `--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2`.
- **Files starting with `_` are stripped from the published site** by `make-deploy.ps1` and by CI, and the
  server refuses to serve them. `.nojekyll` stops GitHub deleting them itself.
- **Do not delete `_shot.html`.** It is not a test — it is the screenshot rig `make-proposal.ps1` drives
  to build the Arabic client PDF.
- **PowerShell here is 5.1**: no `&&`/`||`, no heredocs, no ternary; it prepends a UTF-8 BOM when piping
  (which once made a password not match its own confirmation). The Bash tool is available for POSIX.
- `dist/`, `flutter_app/`, `docs/img/`, `docs/fonts/`, `docs/*.pdf` are **deliberately untracked**.
  Committing `dist/` is what previously let the live site drift several versions behind.

## Tests

**There are none — they were removed on request.** 986 checks (858 browser, 128 server) used to gate
deployment. Nothing inspects a push now, so a change that breaks the till reaches the live site as fast
as one that fixes it. Verify your own changes in a browser before pushing.

They are recoverable:

```bash
git checkout d76950a -- server/test _selftest.html _mobile.html \
    _yalla.html _connect.html _stagea.html _codes.html _codetest.html
```

## Deploy

`.github/workflows/deploy.yml` — one job, builds `dist/` and publishes to Pages on push to `main` or a
manual run. It checks whether Pages is enabled and **skips cleanly rather than failing** when it is off
(CI reporting a deliberate choice as a failure trains people to ignore red builds).

Requires **Settings → Pages → Source → "GitHub Actions"**. Until that is set the workflow goes green and
publishes nothing.

## Supabase — a one-way mirror

SQLite is the system of record. Supabase is a copy kept for the day this machine dies, and nothing
reads from it in normal operation. `npm run supabase:sync` pushes; `npm run supabase:restore` pulls
the whole shop back onto a clean machine.

**`npm run supabase:check` is the one command that answers "is the mirror trustworthy".** It
compares every mirrored table **by primary key** (eight here and eight there is not a match — five
pushed by the shop and three left by a test database add up to eight as well, and that is the shape
the live gap took), names rows sitting at or below their table's bookmark (the sync will never look
at those again; only reconcile will), checks each bookmark against its own table, and reports whether
accounts could actually be recovered — including a mirrored account this shop does not have. It
exits non-zero when the mirror is not a faithful copy, so it can gate a deploy. `--quick` stops
after the connection test. It opens the database through `DB.openReadOnly()`: `DB.open()` applies
pending migrations, and a check that changes the schema it is checking is not read-only.

### The mirror is live, not on a ten-minute timer

**`server/lib/mirror.js` is the one implementation**; `scripts/supabase-sync.js` is a thin CLI
over it (one full run, printed, exit 0/1/2 as before) and `server/lib/sync-worker.js` runs it
**in-process** inside the server. Three triggers, one lane:

1. **The commit hook.** `DB.tx()` fires `DB.onCommit(fn)` listeners after COMMIT with the tables
   `logChange` touched; the worker debounces two seconds and calls `Mirror.pushChanged()`.
2. **A ten-second tick**, the backstop for writes outside a transaction and for the eight tables
   nothing logs (`config`, `role_permissions`, `label_templates`, `clubs`, `notification_reads`,
   `users`, `currencies`, `warehouses`) — those are detected by a content hash.
3. **A full run every hour** (`OG_SYNC_MINUTES`, default 60, `0` = by hand only): settings
   rewritten whole, every cursor walked, every guard exercised. The reconcile relies on this.

`pushChanged()` asks SQLite locally which tables moved past their bookmark and walks only those,
in the same FK order as the full run, so an idle shop makes **no request at all**. Bookmarks are
read from `sync_state` once at boot (`loadCursors`) and held in memory — this process is the only
writer, which is what the lineage guard guarantees. A foreign-key refusal naming a missing parent
(`Key (sale_id)=(INV-2102) is not present in table "sales"`) **heals itself**: the parent is
fetched locally, pushed with its children, and the batch retried once. Every request has a 30 s
deadline (`supabase.js`), a failure backs off 10 s → 5 min, and one push runs at a time.

`GET /api/sync/status` and the **Mirror fold in Settings** (`MirrorUI` in `js/app-settings.js`)
show mode, rows waiting, last push and the reason it is stuck; the same object rides the live
channel (`Live.notify('og', { mirror })`) so the fold repaints without polling, and the Sync
button carries an amber/red dot. The bell fires on **time** (rows waiting and no success for
15 min, or a refused mirror), not on "three failures" — at this cadence three failures is thirty
seconds. Before all this, a foreign key killed every run for a day and the only record was a line
printed to nowhere.

It did not always do this. It used to check the connection and five table names, and printed
"Connected. 5 of 5 core tables present" while five invoices and every delivery were missing —
both statements true, neither the thing anyone wanted to know. **A check that cannot go red is
not a check**; if you extend it, verify the new branch fails on a database you have broken
on purpose.

Three shapes, because three kinds of table behave differently:

| Shape | Tables | How |
|---|---|---|
| **Cursor** | `products` `variants` `stock` `customers` `sales` (+`sale_items`) `deliveries` `print_jobs` (+lines, +stages) `partner_invoices` (+refs, +payments) `job_messages` `suppliers` `employees` `purchase_orders` (+lines) `shifts` `stock_counts` (+lines) | Replays `change_log` from a cursor held in Supabase `sync_state` |
| **Mirror** | `config` `role_permissions` `label_templates` `clubs` `notification_reads` | Pushed whole every run, **and rows deleted here are deleted there** |
| **Append-only** | `fx_rates` `stock_movements` `wa_messages` `expenses` `debt_payments` `print_log` `label_print_log` | Pushed above the highest `id` already sent |

Plus `currencies`, `warehouses` and `users` as plain full upserts.

Things that will bite you:

- **A cursor can outlive the log it points into.** Rebuild the database and `seq` restarts at 1 while
  the cursor sits in the hundreds — every run then reports "nothing new" forever. Both the cursor and
  the append-only paths detect this (a cursor ahead of the highest id that exists) and rewind. Do not
  remove that check. **The comparison must be against that table's own `MAX(seq)`, not the log's.**
  Every table has its own cursor and so can strand on its own; measured against the global maximum a
  busy table permanently masks a quiet one. That was live: `sync:deliveries` sat at 142 while
  deliveries' highest entry was 22, and because `sales` had reached 1001 the rewind never fired and
  the shop's four deliveries reported "nothing new" on every run, for good.
- **A write that skips `logChange` never leaves this machine.** It is not a missing audit line, it is
  a row that exists here and nowhere else, and nothing reports it — the mirror looks healthy. Three
  paths had this and were fixed: the customer address written by `Deliveries.assign`, the automatic
  notices from `Partner.setStage` / `respondToOrder` (which is why the log now lives inside
  `insertMessage`, where a fourth caller cannot miss it), and the zero-delta path in
  `Stock.reconcile`. When adding a write to a cursor-shape table, log it in the same transaction.
- **Deleting locally must delete in the mirror**, or a restore hands back a permission somebody
  deliberately revoked. That is why the settings tables are mirrored rather than upserted.
- **The migrations seed `config`, `role_permissions`, `label_templates`, `currencies`, `warehouses`
  and `fx_rates` with defaults**, so those tables are never empty and the restore's "already has rows"
  guard would skip them forever — handing a rebuilt shop the factory permission matrix instead of the
  manager's. They are in `SEEDED` in `supabase-restore.js` and are replaced from the mirror.
- **Accounts restore before the tables**, because `sales.cashier_id` points at a user. They used to
  come last, and a restore onto a genuinely empty database died on that foreign key partway through.
- Passwords cross only as AES-256-GCM sealed boxes (`server/lib/credvault.js`). Without
  `OG_VAULT_KEY` the restore skips accounts rather than creating ones nobody can sign in to.
  **It is set in `server/.env`, and a copy must live somewhere that is not this machine** — it is the
  only thing that opens the sealed boxes, and `users` is not in the restore's `ORDER` list, so
  without it a rebuilt shop comes back with no way to sign in at all.
- `npm run supabase:reconcile` is the repair tool for **every cursor and append-only table** when
  something wrote rows outside `change_log`, or a bookmark was left above rows that never landed.
  The mirror-shape tables and `users` are rewritten whole on every sync and do not need it. It is
  the **only** thing that recovers a row whose log entry was consumed by a run that did not land
  it — the cursor is legitimately past it, so no rewind will ever look there again. Its comparison
  reports both directions; a table short of rows *in Supabase* is the case that matters, and it
  read as "in step" until that was fixed. It applies the same per-column fallbacks as the sync: the
  day it lacked one it threw on the fourth table and never reached the sales the check had sent
  somebody to repair.

### A column here that the mirror has not got

The local schema migrates itself on boot; the mirror's is applied **by hand** in the dashboard. So
every local migration touching a mirrored table opens a window where PostgREST rejects the row — and
it rejects the **whole batch**, not the column:

```
400  Could not find the 'credit_limit' column of 'customers'
```

- **`server/lib/mirror-lag.js` is the one list of those windows**, imported by both the sync and the
  reconcile. It was kept twice and drifted twice, both the same way — the reconcile's copy short of
  the sync's, so the *repair* tool threw partway down and never reached the rows somebody had been
  sent there to fix. **Adding a column to a mirrored table means adding it there and writing the
  matching `server/supabase/` file, in the same change.** Each entry carries `retriedBy`, because the
  tools deliberately disagree: `print_log` is append-only, so the sync does *not* drop `kind` —
  landing rows and advancing the bookmark past them means nothing ever fills it in. Late is
  recoverable; silently wrong forever is not.
- **`customers` and `sales` are the two that break a whole run**, because both are pushed OUTSIDE the
  guarded block: a rejection there stops customers, sales *and* deliveries, not just the one table.
  `sales.shift_id` has been covered since `005`. `customers` gained three columns in local migration
  `033` and the matching file was written late — measured against the live mirror on 2026-09-02, a
  customer row was rejected outright. The shop was one customer edit away from a day going unmirrored.
- **A fallback is a stopgap, never the answer.** The mirror is what a rebuilt shop is restored *from*,
  and `credit_limit`/`no_credit` decide whether somebody may owe the shop money — a restore missing
  them hands back a shop where every credit rule has quietly reset. That is why the retry names the
  file on every single run rather than settling in.
- **`npm run supabase:drift` is the command that answers "can the next write even land".** Read-only
  on both sides. It reads the columns PostgREST actually exposes, compares them against this
  database's, and **goes red on any difference `mirror-lag.js` has not declared** — so the list can no
  longer quietly fall behind the schema. It is a question about the *shape*, where `supabase:check`
  asks about the *data*; the shape question used to be answered by a day of missing sales instead of
  by a command. Both new branches were verified by breaking `mirror-lag.js` on purpose.

- **Twelve schema files are run by hand in the Supabase dashboard**, `002` through `013` (`001` too,
  on a new project). **`server/supabase/CATCH-UP.sql` is every outstanding one concatenated** — one
  paste instead of four visits; it is generated, every statement is `IF NOT EXISTS`, and re-running it
  is safe. `002`–`007` are applied on the live mirror. `008` (rooms, and which wall a rack hangs on)
  must be run before the shelf map's rooms mirror at all — until then the sync skips `rooms` by name
  and pushes `sections` without the three placement columns. `009` adds `print_log.kind` (local `027`);
  until it is run the print history block is rejected and retries every run, so nothing is lost, only
  late. `010` adds `loyalty_redemptions` and `wants` plus `print_jobs.customer_id` (local `031`/`032`).
  `011` adds the three `customers` columns (local `033`). `013` adds the four rack-size columns on
  `sections` (local `036`); until it is run the sync pushes racks without their size and names the
  file every run. `002` adds `users.pw_enc` and is easy to forget because the sync only needs it
  once `OG_VAULT_KEY` is set.
- **Running one of these files is only half the repair.** The sync pushed those rows with the missing
  columns *dropped* and its cursor is already past them, so the columns exist afterwards and stay
  NULL. **`npm run supabase:reconcile` is what refills them**, and it is not optional.
- **Every new mirrored table gets `ENABLE ROW LEVEL SECURITY`, with no policies** — `001`'s own
  header states it and every file since repeats it for its own tables. On with no policy means the
  service key still works and nothing else can, which is the entire security model of the mirror:
  there is no per-user authorisation here to get right because no user reaches it. `010` was written
  without it, which was an oversight rather than a decision, and its two tables are the shop's
  customer list joined to their behaviour — the one category `FORBIDDEN` in `server/lib/auth.js`
  refuses even to the print partner. Fixed; check for it when adding a table.
- **One Supabase project, one database.** A second database pointed at the same project is not a
  second copy, it is a second writer: its `users` land beside the first's (upserted, never
  deleted), its run writes its own `change_log` seqs into every `sync_state` cursor, and because
  invoice ids collide (INV-2106 is the next number on both tills) its purge of a demo invoice
  deletes the other machine's real one. That happened on 2026-08-30 and again on 2026-09-03 — the
  second database was not a throwaway test copy but **another live install with the same `.env`**
  (its sealed passwords do not open with this machine's `OG_VAULT_KEY`; its retired accounts are
  disabled the way the Accounts section above describes). Each side's run deleted the other's sales
  and left the other's bookmarks stranded, and the local run then died on the `deliveries → sales`
  foreign key before the history, partner and drawer blocks ran.
  **`server/lib/lineage.js` is the guard**: the first database to sync writes a random id into
  `sync_state` (`lineage`, with hostname and date) and keeps it in its own `config`; sync and
  reconcile compare first and **refuse with exit 2** when the mirror belongs to another database.
  `OG_SYNC_TAKEOVER=1` (or `--takeover`) claims it — a decision about which machine is the shop, made
  by a person, once, and followed by a reconcile. A dev or test copy sets `OG_SYNC_MINUTES=0` or gets
  its own project. `npm run supabase:check` names whose mirror it is and goes red on an account this
  database does not have.
  Until they are run, the sync says so by name and pushes everything else — taking a whole run down
  because one table is missing would stop a day's sales being mirrored over a table nobody has
  created yet.

## The partner half

`server/lib/partner.js` and `server/migrations/015_partner.sql`. Print jobs, the two-way line to
Yalla Wear, the invoices between the two companies, plus `suppliers` and `employees` — which had
never had tables either.

**Three rules live on the server, not in the browser.** `js/data.js` enforces the same ones so nobody
is made to look wrong in front of a customer, but that is a courtesy; this is a different company on
the other side of the boundary.

1. Stages move within `design → sent → printing → delivery → done`, and going back drops the stamps
   for everything at or beyond where it lands, so the history cannot claim a step happened after the
   one that undid it.
2. **Nothing passes `sent` while a shirt has no name on it.** A blank name is a real state — an order
   is taken before the squad is settled — and it is why a kit job carries `print_name NULL`.
3. **`sent` means the printer took the job.** The shop cannot assert that about another company, so
   the stage cannot reach it until `order_state = 'accepted'`. This is checked at or *past* `sent`,
   not only exactly on it — checking the one stage let a drag of two columns step straight over it.

Things worth knowing:

- **A kit job's `qty` and `cost` are derived from its lines and never stored**, so a line and its
  job total cannot disagree. Only bulk jobs carry their own `qty`.
- **`print_job_lines.unit_cost` is what the PRINTER charges**, while `print_jobs.price` is what the
  customer pays — opposite sides of the margin. It is named `unit_cost` so `scrubCost` strips it by
  name; called `price` it would have gone out to every cashier.
- **`employees` is not `users`.** A login is a way into the system; an employee is somebody on the
  payroll. The shop has staff who never sign in, and a login (the partner) who is not staff.
- **`GET /api/partner` is one route with three audiences.** The partner never receives `price`;
  anyone without `cost.read` never receives `cost` or `unit_cost`; `suppliers` needs
  `money.read` and `employees` needs `staff.read`. Each is left out of the response rather than
  hidden in the browser.
- **`requirePerm` accepts a list meaning any-of.** Yalla Wear holds none of the shop's permissions —
  they are not staff — so the routes both companies use are gated on `['print.read','partner.jobs']`.
- The frontend writes **optimistically**: the local model moves first so the board does not sit still
  for a round trip, then `pushPartner` sends it and reloads. A refusal means the local guess was
  wrong, and the reload puts the truth back with a toast saying which rule it was.

## The line to Yalla Wear: messages, the outbox and Telegram

Migration `035_partner_link.sql`, `server/lib/telegram.js`, `js/pulse.js`. What makes the two
companies feel connected rather than merely sharing a table.

- **In-app notifications ARE the message thread.** Every event the other side needs to hear about
  — order sent, accepted, declined, a stage moved, the last name filled in, an invoice, a payment
  recorded, a payment confirmed, a review — is a `job_messages` row written by the server inside
  the same transaction as the change (`insertMessage`). The speech-bubble bell (`js/notify.js`)
  reads them with per-side read flags. There is deliberately no second bell: the alert bell in
  `alerts.js` stays "computed, never stored".
- **`partner_events` is the Telegram OUTBOX and nothing else.** `emitEvent(d, …)` in `partner.js`
  writes it in the same transaction; `telegram.js` drains it every five seconds with the global
  `fetch`, backs off on failure (`next_try_at`, `attempts`, honours 429), and stops on a chat that
  refuses the bot. **It is never mirrored to Supabase** — it is delivery state, and a restored shop
  re-sending three months of "order accepted" to two phones would be a bug. `channel` exists so a
  WhatsApp transport can queue beside it one day.
- **The strip list for the partner lives in `emitEvent`**, keyed on the audience: `customer`,
  `phone`, `customer_id`, `price` never reach Yalla Wear's bot, the same list `GET /api/partner`
  applies. For the shop's own chat the event carries job id, design and quantity only — a staff
  group is wider than `customer.read`.
- **Two bots, two tokens, in `server/.env`** (`OG_TELEGRAM_TOKEN_OG`, `OG_TELEGRAM_TOKEN_YALLA`).
  Never in `config` — `GET /api/config` hands that table to every login including the partner.
  Chat ids do live in `config` (`telegram.<side>_chat_id`), written by the lib, not by `PUT
  /api/config`. Linking: `POST /api/telegram/link` hands out a six-letter code held **in memory
  for ten minutes**; the person sends it to the bot (or into a group the bot is in); the
  `getUpdates` long-poll matches it and stores the chat. The audience is always the account's
  role, never the body — a partner asking for the shop's code gets their own.
- **Messages are Arabic then English, plain text.** No Markdown: a job id or a name with an
  underscore would break the parse and the message would silently never arrive.
- **The browser is pushed, then it asks.** `GET /api/live` (`server/lib/live.js`) is a
  server-sent-events stream, one per open tab; every partner route ends in `bump()`, which
  kicks the Telegram outbox and writes a one-line `change` event to every open tab. The event
  carries **no data** — `js/pulse.js` then asks `GET /api/partner/pulse` (two counts and a
  stamp) and refetches the bundle through the ordinary gated routes, so the push is never a
  second door past `scrubCost` or the partner strip list. A 45 s poll stays as the backstop and
  the green dot beside the bubble says which one is on. It **never calls `render()` blind**:
  only on the Print screen or inside the partner portal, and only with no modal or drawer open.
  Every new line from the OTHER company gets a toast, a short WebAudio chime and, when the tab is
  hidden, a browser Notification. `DB.hydrate` is never given a partial payload — it would
  empty the catalogue — so the pulse uses `hydratePartner` and refills the alert arrays in place.
- **The partner portal has five screens**, not four: Today, Job queue, Invoices, Earnings and
  **Reviews** (`viewReviews` in `js/yalla.js`) — the shop's rating and words on every finished
  job, with the average, a tap-to-filter distribution, and the quote given the type size rather
  than the metadata. Opening it marks those lines read through `markRead`'s **`kind` filter**,
  so a delay note on the same job stays unread; the nav badge counts `DB.unreadReviews('yalla')`.
  The phone tab bar is the five screens and nothing else — there is no OG behind the portal to go
  back to (see "Home screen is chosen by role").
- **The partner's account lives behind the avatar in the topbar** (`acctButton` / `openAccount` in
  `js/yalla.js`): a bottom sheet on a phone, a modal on a desk, with the name, the role, the live line
  and two actions. **Change password** is the portal's own form over the same `POST /api/auth/password`
  — the rule shown in the meter is the server's (`passwordProblem`: eight characters, not only
  digits), a wrong current password is refused in the form, and success reloads to the login because
  every session died. **Sign out is two taps**, armed for four seconds: the button is under the thumb
  and a pocket tap that logs the printer out mid-shift is a phone call. Portal sheets sit at z 360,
  above the floating tab bar (z 340), or the Save and Sign out buttons are behind it.
- **What is new is decided before anything draws.** `Pulse.apply()` takes the unread list first
  and announces it last: the job drawer and the Reviews page both mark messages read as part of
  rendering, so a toast computed afterwards never fired for the line that had just arrived.
- **Presence rides on every live event.** `Live.presence()` counts open tabs per side; the topbar
  pill reads "Yalla Wear · online" and turns green. A join or a leave carries `who`, which the
  browser uses to repaint the pill *without* refetching the bundle.
- **Yalla Wear's unread lines are in the main bell too** (`partner_msg` in `alerts.js`, key
  `msg:<id>`, shop accounts with `print.read` only). Unread only, so opening the thread removes
  the row and the prune tidies its read mark; tapping one opens the job or invoice.
- **The website's door is `POST /api/ext/print-jobs` / `GET /api/ext/print-jobs/:id`**, no
  session: a bearer key from `OG_WEB_API_KEY` in `server/.env`, compared in constant time in
  the request pipeline, 503 when no key is configured. A `reference` (the site's order id) is an
  idempotency key through `applied_ops`. It creates with `source:'web', autoSend:true`, prices
  from `config` `print.unit_price` / `print.partner_unit_cost` (950 / 460 defaults, the till's
  numbers), and the answer never carries the printer's cost.
- **A payment is a handshake.** `partner_invoice_payments.recorded_by_side` says who recorded it;
  `confirmed_at` is set by the OTHER side (`confirmPayment` refuses `own_side` with a 409).
  `DB.invoicePaid` counts confirmed money only; `DB.invoicePending` is what is waiting;
  `DB.invoiceOpen` is what can still be recorded. `recordPayment` carries an `opId` through
  `applied_ops` like a debt payment — a retry must find the payment already there. Either side may
  record (`['money.write','partner.invoice']`); the side comes from the role.
- **A review is written once the job is `done`** (`reviewJob`, 409 `not_done` before that),
  editable, one row per job in `job_reviews` (cursor shape, mirrored), shown read-only to the
  partner because it is about their work, and posted into the thread as a `review` message.
- **`Partner.create` takes `source` and `autoSend`.** The till sends `source:'till', autoSend:true`
  and no longer fires a second request at a guessed id; the by-hand form on the Print screen
  (`openNewJob` in `js/app-jobs-reports.js`) does the same with `source:'manual'`. A blank name
  keeps it a draft and the returned job says so (`order_state`, `tbc`).
- **`Partner.stats(tz)`** is the production report — pieces per day and per month, on-time %,
  turnaround, average rating — computed in SQL in the caller's day like the dashboard, so it can
  never quietly become "the last 200". Payout sums are included only for the partner or `cost.read`.
- **The partner boot bug** this all sat behind: `js/shop.js` fetched `/api/catalogue` unwrapped
  (403 for a partner → `Shop.fail`) and asked for `/api/partner` on `print.read`, which the partner
  does not hold. Both are `soft`/`wantAny` now. A real Yalla Wear login boots into its portal.
- **`POST /api/partner-invoices` is gated `['partner.write','partner.invoice']`.** On
  `partner.write` alone the actual partner account could never issue an invoice.

Mirror side: `server/supabase/012_partner_link.sql` (also in `CATCH-UP.sql`), `mirror-lag.js` entries
for `print_jobs.source` and the three payment columns, and `insertChildren` in `supabase-sync.js` —
child rows pushed from a parent's `afterUpsert` used to miss the lagging-column fallback entirely.

## Known open work

- The **supplier and payroll editors do not exist**. `Shop.saveSupplier` / `saveEmployee` and their
  routes are live and tested; there is simply no screen. Same for adding one size to an existing
  product (`Shop.addVariant`) and cancelling a purchase order (`Shop.cancelPO`). These are listed by
  name in the wiring test so they stay visible rather than becoming permanent.
- **The website has an endpoint but no website.** `/api/ext/print-jobs` is live behind
  `OG_WEB_API_KEY`; nothing calls it yet.
- **WhatsApp push is not built.** The outbox has a `channel` column for it; the WhatsApp Cloud API
  needs a Meta business account and approval before a transport can be written.
- A **draft partner invoice** still lives only in the browser — `partner_invoices.issued` is
  `NOT NULL`, so there is nowhere to put one. Issuing it reaches the server; saving a draft does not.
- Delivery **cash reconciliation** is designed and the schema carries it (`to_collect`, `collected`,
  `Deliveries.driverDay()`), but the end-of-day settle-up screen is not built.
- Bulk catalogue entry; an offline write queue. (The Yalla Wear portal now runs against real data —
  what remains is exposing the server to them: Tailscale or a tunnel, and `OG_ORIGINS` listing the
  address they use.)
- **Old vs redenominated Syrian lira has never been settled.** The seed assumes old lira — 1 USD = 13,000,
  salaries in millions. If the shop is on new lira, the entire dataset is wrong by three orders of magnitude.
- `flutter_app/` fails to build on an Android NDK/`sdkmanager` crash.
- The demo catalogue rows are hidden, not deleted — all five had been sold, so removing them would
  have broken the invoices referencing them. `products.demo` and `customers.demo` still exist for that
  reason, but nothing sets them any more.

## The dashboard

`server/lib/dashboard.js`, `GET /api/dashboard?from=&to=&tz=`. **Every figure on the four home
screens is computed there, in SQL, over every sale.** It used to be summed in the browser from
`DB.sales` — the last 200 invoices — with nothing on screen saying so; the 201st sale of a month
made "30 days" quietly mean "the most recent two hundred". `DB.dash` is the snapshot, replaced
whole on every load (it is one window at one moment, not a collection anyone holds a reference to),
and `Shop.reloadDashboard()` refetches only it for a scope chip.

- **The day belongs to the browser.** The server is UTC and Aleppo is not. `scopeRange()` in
  `js/app-dashboard.js` builds the window from a *fresh* local midnight (never the boot-frozen
  `TODAY`) and sends two ISO instants plus the zone; the server re-normalises both through
  `toISOString()` before binding — `sales.at` is UTC text and a `+03:00` string compares wrongly —
  and aggregates half-open `at >= ? AND at < ?`.
- **Money is a pair, `{ syp, usd }`, never converted and never added.** Every sum is
  `GROUP BY currency`; the hero shows the base currency, dollars taken as dollars are a second
  line, and the only converted figure is labelled approximate at today's rate. Ordering never adds
  the two either (`byType` sorts by units).
- **A block the account may not see is absent, not null**, like `GET /api/partner`: `drawer`,
  `debts`, `suppliers` need `money.read`; `margin` needs `profit.read` and leaves as a percentage
  only; `me` (one's own sales, **by `cashier_id`**, never by name) and `latest` need `sell`;
  `staff` needs `staff.read`. The payload must **not** go through `scrubCost` whole — `COST_KEYS`
  deletes a key literally named `margin`. Only the two sale lists carry items, and only those are
  scrubbed. Every reader in the browser is null-safe and draws "unavailable", never a zero.
- **`Money.summary` is one currency** — the shift's. It used to add a $100 cash sale to a lira
  drawer as 100. Every till sale to date settled in the base currency, so nothing already frozen
  changed.
- `arrivals` counts `type = 'received'` only; the old browser figure counted any positive delta,
  so a transfer to the floor looked like a delivery.

## The admin Reports screen

`server/lib/reports.js`, `GET /api/reports?from=&to=&tz=`, gated `report.read`. The same job
`/api/dashboard` does for the home screens, and it was added for the same reason. Until it existed
the Reports screen was summed **in the browser** out of `DB.sales` and was wrong in two ways at once:

- **THE WINDOW.** `DB.sales` is the last two hundred invoices. "Six months of revenue" meant
  "whatever of the last two hundred fell in six months". The screen carried a `cappedNote` saying
  the LIST was capped; the totals under it went on claiming to be the shop.
- **THE CURRENCY.** It added `s.total` with no regard for `sales.currency` — the browser's sale
  object did not carry one — so a $100 pair went into the month as 100 lira. Every revenue, profit
  and margin figure on the screen was built on that sum.

`DB.rep` is the snapshot, replaced whole on every load like `DB.dash`; `Shop.reloadReports()`
refetches only it for a scope chip. **`DB.monthlySales`, `DB.salesByType`, `DB.profitByType` and
`DB.inventoryValue` are gone** — nothing on this screen is derived locally any more.

- **Six tabs, and a tab the account may not open is not drawn.** `repTabs()` is the browser half;
  each block is gated on its own permission server-side and is **absent** rather than nulled —
  `profit` needs `profit.read`, `payments`/`suppliers` need `money.read`, `employees` needs
  `staff.read`, and `inventory`'s cost half needs `cost.read` (`hasCost: false`, every cost key
  `null`). `repTab()` bounces a bookmarked or revoked tab back to Sales rather than onto a blank
  card.
- **Money is a pair and is drawn as a pair**, everywhere except the chart, which can only plot one
  series and so plots the base currency.
- **`repChartData(tab)` is the ONE description of the chart**, read by both the markup that decides
  whether to put a canvas on the page and the hook that draws into it. They used to be separate and
  disagreed: the Inventory canvas appeared whenever any type had PIECES, while the donut was fed
  CAPITAL — so a shop with no cost prices got a legend, an empty ring and nothing else.
- **The range is said out loud, and it is the range that was asked for.** The old card head printed
  a hardcoded "179 days ago — today" over six calendar months of table, a present-tense inventory
  total and a payroll with no dates in it at all. Stock, payroll and suppliers say `rp_as_of`
  instead.
- **`OG.repScope` is the Reports screen's own window**, deliberately not the dashboard's
  `dashScope`: while one chip drove both, every visit to Reports reset the dashboard.
  `scopeRange(scope, from, to)` grew `month`, `year` and `custom`; `ymdLocal()` reads a date box as
  LOCAL midnight, because `new Date('2026-03-01')` is UTC midnight and in Aleppo that is the small
  hours of the day before.
- **The series carries its empty buckets.** A day the shop took nothing is a fact; closing the gap
  draws a flat line over a hole. Day buckets up to 92 days, calendar months beyond, and the browser
  is told which in `grain` rather than guessing from the string's length.
- **Archived stock is not stock.** `p.hidden = 0` on every inventory query — the rule
  `DB.liveVariants()` enforces everywhere else and which `inventoryValue()` never did. What is left
  out is **named** (`archivedUnits`), because somebody who remembers a bigger number is owed the
  reason it moved.
- **Debt and supplier balances are NOT windowed by the chips.** A sale taken on credit in March is
  still owed in September, and filtering it by "30 days" would understate the shop's exposure by
  exactly the debts outstanding longest. The card says so.
- **Counted nouns are their own keys** (`rp_n_invoice`, `rp_n_supplier`, …). `t('invoices')` is
  الفواتير, "the invoices" — right at the top of a column, and "3 the-invoices" under a number.
  Every count on the screen went through the heading key. Dates use `dir="auto"`, never `dir="ltr"`:
  `fmtDate` puts an Arabic month name among the digits and forcing LTR reorders the phrase.

## The exports, and the logo in the spreadsheet

`js/export.js` writes both files by hand — a store-method ZIP plus the OOXML parts for XLSX, and
HTML through the browser's Save-as-PDF for the document. `js/app-export.js` holds one spec per
screen. **The column spec is what everything turns on**, and it decides both the Excel cell type and
how the printed page draws it:

| | |
|---|---|
| *(none)* | text |
| `num` / `int` | a number, thousands separated |
| `money: 'SYP'\|'USD'` | a number in that currency's own format — **never the same column** |
| `pct` | the percent as a person says it (53.3); divided by 100 on the way in, because Excel's % format multiplies by 100 on the way out |
| `date` | a real Excel serial, built from the LOCAL calendar date |

A cell may be `null`, which is **blank and deliberately not zero**: a supplier billed in dollars has
no lira balance, and somebody with no till login has not sold nothing.

- **The sheet carries the real mark.** There is no PNG in the repo — the mark is `assets/logo.svg` —
  so it is drawn into a canvas at export time and the bytes lifted out of the data URL, then written
  as `xl/media/logo.png` with the drawing, rels and content-type parts that go with it. Cached per
  mark. **Every failure path returns null** (no canvas, an image that will not load, a tainted
  context) and the band renders with the word alone: a missing picture must never cost somebody
  their spreadsheet. A one-column sheet has no B1 for the word to move into, so it goes without.
- **The worksheet's child elements are in a FIXED schema order** — `sheetPr`, `dimension`,
  `sheetViews`, `sheetFormatPr`, `cols`, `sheetData`, `autoFilter`, `mergeCells`, `printOptions`,
  `pageMargins`, `pageSetup`, `headerFooter`, `drawing`. Excel refuses a workbook that gets it wrong,
  with a repair dialog that names no element.
- The header row is frozen, filtered (**never over the totals row** — a filter that hides rows while
  the total stays put is how a spreadsheet lies), and repeated on every printed page via
  `_xlnm.Print_Titles`. Wide reports go landscape, fit-to-width with no page limit. Arabic gets
  `rightToLeft="1"` and a font that actually has Arabic glyphs — Montserrat has none.
- **The PDF chart is REDRAWN for paper**, not lifted off the screen. `Charts.printSnapshot(id)`
  rebuilds it from `Charts`' own record of what the chart was asked for: same type, same numbers,
  same formatter, ink-on-paper colours, animation off, 2x into a detached canvas. The old
  `toDataURL()` of the live canvas put a lime series and `#A1A1AA` axis labels on white A4 — an
  empty box with a yellow squiggle in it.
- `thead` repeats across pages and `tfoot` is forced to `table-row-group`, because a table footer
  otherwise repeats too and prints the grand total once per page. The KPI underline is a border,
  not the `box-shadow` it was — Chrome drops shadows from printed output entirely.
- **An empty report is still a report.** `ACTIONS.export` used to refuse whenever `spec.rows` was
  empty and say "Export failed · None" — two words that are both wrong. Only a spec that does not
  exist is refused now.

## The bell

`server/lib/alerts.js`. Computed on every request from the shop's current state — never stored,
because an alert is a fact about now and a stored alert is a fact about a state that has moved on.

**A row is a kind and its values, not a sentence.** `{ key, kind, args, icon, tone, view, read }`.
The words are written in the browser by `DB.alertText` from `I18N` (`al_<kind>`, with `_1` for a
singular and `al_more_<kind>` for a summary row), so the same row reads correctly in Arabic. The
server used to compose English, which was tolerable in a popover and wrong once the list became
the centre card of an Arabic-first dashboard. Nothing in `args` is formatted: money is minor units
with its currency beside it, days are integers.

**One list, two caps.** `Alerts.list(user, { limit })` returns `{ rows, shown, total, capped }`; the
bell asks for 8, the dashboard's to-do for 50, so the two cannot disagree. Each kind that names
rows has its own `LIMIT` and pushes one `<kind>:more:<total>` summary row when more exist, so the
badge counts what is there. `markRead` marks and prunes against the **uncapped** list — pruning
against the eight would un-read row twelve on the dashboard the next time anyone read anything.
`wants_back` (a size somebody asked for is back in stock, grouped by SKU, gated `stock.read` **or**
`customer.read`) opens the warehouse's wants tab, because it is the back room that knows a box
landed and the warehouse account does not hold `customer.read`.

Two things it gets right that earlier versions did not:

- **Per account.** Supplier debt needs `money.read`, payroll needs `staff.read`. Derived in the
  browser these were filtered only because the data had already been withheld, which was true by
  accident rather than by rule.
- **Read state keyed on what the alert is ABOUT** (`stock:OG-1-42`, `job:P-1043`, `supplier:3`,
  `critical`, `payroll`) and stored per user in `notification_reads`. The first version keyed on the
  alert's **text** and kept it in `localStorage`. Both were wrong: the text changes on its own —
  "due in 3 days" becomes "due in 2 days" — so a read alert came back unread every morning; and
  `localStorage` is per machine, so reading it on the till left it bold in the office.

## Purchase orders

`server/lib/purchasing.js`. The last screen in the warehouse writing to nothing — the browser held an
array, so an order raised on Sunday was gone on Monday.

- **Receiving books stock through the same movement log** as everything else, via `Stock.apply()`
  rather than `Stock.receive()`: the latter opens its own transaction and `DB.tx()` refuses to nest,
  deliberately, because SQLite has no nested transactions and a half-applied delivery is worse than a
  refused one.
- **A short delivery is normal.** `received_qty` is separate from `qty`; eight of ten leaves the order
  open and the two still owed. The supplier balance moves by what **arrived**, not by what was ordered.
- The unit cost is frozen onto the line at order time — with the lira moving, what a pair cost when it
  was ordered is not what it costs when it lands, and the invoice has to agree with the order.

## The shelf map's room, and moving things in it

Two views of one place — a 2D plan plus the rack seen straight on (the default), and the 3D room
one press away (`js/shelfroom.js`). With the layout editor open the room is also where the layout
is **changed**: drag a rack onto a wall, drag a rack in from the list beside it, pull a wall to say
how big the room really is.

- **The drop is the save.** Every drag ends in a `PATCH /api/sections/:id` or `/api/rooms/:id` and
  a reload. There is no Save button and no edit buffer, deliberately: a layout held in the browser
  is a layout that dies on a refresh, which is the trap the draft partner invoice is still in.
- **Placement is patched as a unit** — `roomId`, `wall`, `wallPos` in one body. `updateSection`
  reads an omitted one as *clear it*, so a rack that moved rooms must not keep the old room's wall
  position. Send all three or none.
- **The ghost only ever shows a place the rack can go.** It snaps to 5 cm, stops at the end of a
  measured wall, and slides to the nearest free place rather than overlapping — the candidates are
  the edges of everything already there, rounded AWAY from the neighbour (4.56 snapped to the
  nearest 5 cm is 4.55, which is inside the rack it was meant to sit beside). `wallAt()` in
  `shelfroom.js` is the exact inverse of `placeOnWall()` and the two are written next to each other
  for that reason — change one and you must change the other. The browser runs the server's overlap
  arithmetic locally so the answer arrives while the rack is still in the air; **the server still
  decides**, and a refusal reloads the truth back with a toast.
- **Green and red are not used by the drag.** On this screen they already mean a scan was accepted
  or refused. The ghost is white where it can land and hidden where it cannot, and the readout
  beside the hand carries the reason.
- **A rack in front of a wall wins the grab**, because moving a rack is much the commoner job; bare
  wall resizes the room. A press is not a drag until the hand has moved six pixels — the same
  threshold the click-to-select test already used — so a rack row is still a button.
- **The walls do not move while the hand does.** Changing a room's size rebuilds the whole scene, so
  a pull draws an outline of the room it would become and the real walls move once, on release.
  Width and depth are stored as a pair and so are saved as a pair — both are on the readout the
  whole time. **Height is not pulled**; it stays a number typed in Room settings.

### Centimetres, rack sizes, and what a shrink does (036)

- **Every number the room draws comes from the server.** `GEOMETRY` in `server/lib/shelves.js` is
  the standard rack in centimetres and rides with `GET /api/sections` as `geometry`; each rack may
  carry its own `bay_cm / level_cm / depth_cm` (NULL = the standard, never a measured zero) and the
  list sends them applied as `size`. `js/shelfroom.js` used to own these as constants, which meant
  the server was refusing overlaps in BAYS without knowing how wide a bay was.
- **A rack's place on its wall is `wall_cm`.** `wall_pos` stays and is DERIVED (`round(wall_cm /
  bay)`) so the mirror column and an older restore keep meaning what they meant; the API accepts
  `wallCm` (the browser sends only this) and the legacy `wallPos`. Existing rows were converted with
  114, the one number that was ever drawn, so nothing on screen moved.
- **Overlap is a floor rectangle, not a bay count.** `footprint()` in `shelves.js` is the
  centimetre twin of `placeOnWall()` in `shelfroom.js` — same four cases in the same order, and
  changing one means changing the other. One rectangle per rack is what catches a corner (a rack's
  depth eats the first centimetres of the wall beside it) and two racks nose to nose in a room too
  shallow for both. An unmeasured room has no corners and tests only the racks on the same wall.
- **Shrinking a room narrows the bays of any rack that no longer fits, never removes one.** A bay
  may hold stock and printed labels, and `removeShelves` refuses exactly that. `fitRoom` floors the
  bay at `BAY_MIN` (60 cm) and, below it, refuses the whole resize as `409 room_too_small` naming
  the rack and the smallest room that would do — nothing is written unless everything fits. Facing
  and corner conflicts are refused, not slid: moving a rack is the manager's decision. The wall
  pull previews the shrink on the hand before release; the PATCH answers with `shrunk` and the map
  says it in a toast; the room dialog keeps a refusal IN the dialog with a "use the minimum" button.
- **Resizing a rack where it stands is refused if it would then overlap, naming the neighbour**;
  adding a bay re-runs the same check one column wider. `MAX_ROOM_CM` is 100 m a side.
- **Fullscreen re-parents the canvas wrapper to `<body>` first, then asks the API.** Refused
  (an iPad, the headless harness) or absent, the same wrapper with `.sm-fs` is the whole feature
  — one code path. While it is out there `detach()`/`attach()` are no-ops, `#smRoom` is drawn as a
  placeholder, and the map writes DOM inside the wrapper in exactly one place (`paintOverlay`).
  `#toasts`, `#modal-root`, the peek and the drag readout come inside for the duration because the
  fullscreen top layer hides everything outside the element; Escape leaves both kinds the same way.
- **Walk keys are taken at the document, gated on the hand having last touched the canvas or a
  pad**, with `preventDefault`, so W never lands in the scan box — and a press anywhere else gives
  the keys back. The wedge listens at the capture phase and buffers every key itself, so a scanner
  gun is never in this conversation. The walk loop runs only while a key or pad is held; the
  still-camera-schedules-no-frames rule holds and the harness asserts it after the walk.
- **Shadows are baked** (`shadowMap.autoUpdate = false`, `needsUpdate` at the end of `rebuild()`
  and `update()`): nothing moves but the camera. A machine whose first three frames average over
  40 ms drops itself to the low tier (no shadows, no AA, DPR 1), says so, and remembers it in
  `og_sm_quality`. The harness pins `high` because swiftshader would always drop.
- **World matrices are updated at the end of `rebuild()` and after every camera move**, not left
  to the next render: a press that arrives before the first frame after a rebuild used to raycast
  against walls still standing at the origin, and the harness — which presses that fast — found it.

### Measured means measured

A room with a tape on it is now drawn at the size the tape says, full stop. It used to be
`Math.max` of the tape *and* what the racks wanted, so one rack parked past the end of a wall
quietly stretched the room while the badge went on saying "to scale". A rack that does not fit is
drawn not fitting and **named underneath** (`#smFit`, fed by `ShelfRoom`'s `fit` hook) — a wall you
can see is too short is a wall somebody will fix.

Two more things that were silently wrong and are worth not reintroducing:

- **Names and clicks are occlusion-tested.** One world box per rack, tested against the line from
  the camera. Without it a product name from the far wall floated over the near rack, and a click
  went through a rack and selected a bay behind it — the hit boxes write no depth.
- **The room's name is in `sameSig`.** Left out, renaming a room left the old name painted on the
  back wall until something structural forced a rebuild.
- **No mark is better than a black square.** The logo plate starts hidden and appears only once the
  artwork is in hand; the loader is async and can fail outright.

Verified by `_smcheck.html` — `?gl=force` runs the room suite (needs
`--use-angle=swiftshader --enable-unsafe-swiftshader` headless), and **`?hold=1` stops before the
context-loss test** so the finished room can be looked at, which is the one check that cannot be
written as an assertion.

## Archived is not deleted, and not stock either

A product is never deleted — a discontinued line still has to resolve on every invoice that
named it — so archiving sets `products.hidden` and the row stays with whatever stock it had.
`/api/catalogue` even sends hidden rows to anyone with `product.write`, deliberately, so a
manager can bring one back.

Which means **everything answering "how much stock does the shop have" must skip them**, and
for a long time nothing did except the Products screen. The demo catalogue was carrying 293
pieces this way, and they were in the warehouse totals, the dashboard's stock value and the
count sheet — the screen was asking somebody to walk a shelf for a line the shop had stopped
selling.

`DB.liveVariants()` in `js/data.js` is the filter, and it is what `whTotals`,
`criticalVariants`, `floorOuts` and `reorderSuggestions` walk. `js/app-warehouse.js`,
`js/stock.js` and `js/app-dashboard.js` use it too. `js/app-products.js` deliberately does
not — its Archived filter is the one place they should appear.

`server/scripts/purge-demo.js` removes demo rows for good. Dry run by default; `--test-sales`
additionally takes sales rung up by accounts that no longer work here, which is a judgement
rather than a flag and so never fires on its own. **Every delete calls `logChange`** — the old
teardown did not, which is why nineteen products once vanished locally and stayed in the
mirror forever.

**Deletes sync in the opposite order to inserts.** A variant cannot land before its product;
a customer cannot be removed while a sale still points at them. `supabase-sync.js` therefore
runs each group twice — `phase: 'upsert'` in FK order, then `phase: 'delete'` in reverse —
and only advances the cursor after the second. Doing both in one pass is what rejected the
first demo purge halfway through.

## The drawer

`server/lib/money.js` and `server/lib/counts.js`, migration `017_money_and_counts.sql`. Shifts,
expenses, customer debt repayments, and the stock-count session — the last four things that lived
only in the browser and died on a refresh.

- **A shift is a cash box, not a login session.** Sessions expire overnight and tabs close; neither
  means the drawer was counted. It is also routinely a handover, which no session spans. One open
  shift at a time, enforced inside `DB.tx()` where `BEGIN IMMEDIATE` makes the check actually hold —
  **not** a `UNIQUE` index, because NULLs are distinct in SQLite and such an index would permit any
  number of open shifts.
- **`expected` is frozen at close**, unlike almost everything else here, which derives. The variance
  was signed off by a person, and voiding a sale a week later must not rewrite last Tuesday's cash
  difference. `counted` is stored because somebody physically counted it.
- **Paying a debt carries all three guards** — an `opId` through `applied_ops` so a retry cannot take
  the money twice, the balance recomputed inside the transaction rather than trusted from the browser,
  and `Sales.void` refusing a sale that has payments against it. Money in is the one direction that
  cannot be corrected by doing it again.
- **An expense never touches `suppliers.outstanding`.** Receiving a purchase order already books what
  the shop owes; moving it here too would pay the same supplier twice in the ledger, and the goods are
  already in cost price so it would come off profit twice as well. `supplier` is deliberately not in
  `expense.categories`, which lives in `config` so Settings can add one without a deploy.
- **Posting a count is one transaction** using `Stock.apply(d, …)`, not `Stock.count()` — the latter
  opens its own and `DB.tx` refuses to nest. The old way fired one request per line, so a retry
  re-applied every adjustment and a sale landing mid-way corrected against a figure that had moved.
- `stock_count_lines.system_qty` is the one derived value this schema stores: the point of a count is
  the variance *at that moment*, and by June the live figure has moved.
