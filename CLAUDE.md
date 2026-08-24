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

# Frontend only, no server: demo data, saves nothing
.\serve.ps1                      # :8080, adds the service worker
# or just double-click index.html (file://)

cd server
npm run createuser               # interactive; also accepts piped stdin
npm run demo-users               # add the five test accounts
npm run demo-users -- --remove   # REQUIRED before go-live
npm run backup                   # VACUUM INTO + integrity_check + FK check
```

**Node 22.5+ required** (`node:sqlite` is used, which arrived in 22.5). There is **no `npm install`** —
the server has zero dependencies by design, and the frontend has no build step at all.

Publishing: **double-click `push.bat`** (add → commit → pull --rebase → push). CI then builds `dist/`
and deploys to GitHub Pages.

### Test accounts

`hussam` (manager) · `lubna` (cashier) · `maher` (warehouse) · `talal` (delivery) · `yalla` (partner).
Password for all: `test-1234`. The password is published in `server/scripts/demo-users.js`, and the
server prints a warning naming the active test accounts **on every startup** while they exist.

## Hard constraints

These are constraints, not preferences. Breaking one means rewriting a lot.

- **Vanilla HTML/CSS/JS. No framework, no bundler, no npm, no build step** for the frontend. The only
  third-party file is `js/vendor/chart.umd.min.js`, committed directly.
- **It must still work by double-clicking `index.html`, fully offline.** Anything that only works over
  `http://` breaks the fastest way to show the app to a client.
- **Dark mode only. Montserrat. English and Arabic with real RTL** — the layouts are built for both, not
  a mirrored stylesheet.
- **No placeholder content.** No lorem ipsum, no "coming soon", no stock photos. Product images are CSS
  colour blocks. If a screen exists, it works.
- Avoid `:has()` and very recent CSS — this runs on the shop's actual hardware.

> `README.md` still states "no backend, no database, no login, no fetch" and says the public demo is
> dead. **Both are now out of date** — there is a real server, and the demo at
> `https://zizo1608.github.io/og/` is live. Trust this file over the README on those two points.

## Architecture

Two halves that must both keep working:

```
index.html + css/ + js/     static frontend — runs with or without a server
server/                     zero-dependency Node + node:sqlite, serves the API *and* the static files
```

### Three run modes, and every feature must answer for all three

| Mode | How | `Auth.demoMode()` | Notes |
|---|---|---|---|
| `file://` | double-click `index.html` | `true` | No server can exist. No login, no banner. |
| static host | GitHub Pages, `serve.ps1` | `true` | Login would be unusable, so a **permanent DEMO banner** is shown |
| real | `cd server && npm start` | `false` | Accounts, permissions, persistence |

`js/auth.js` decides by calling `API.ping()` — **not by protocol alone**. That distinction was a real
bug: a static host is not `file://` but has no backend either, and the app showed a login nobody could
complete.

The DEMO banner is the safety on falling back automatically. The dangerous case is not GitHub Pages —
it is the shop's own server being down while a cashier keeps ringing sales into data that evaporates.

`_shot.html` loads **neither `api.js` nor `auth.js`**, so `Auth` is `undefined` there. Every call site
that touches permissions must guard for that or the Arabic proposal build breaks.

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
- Most screens still read seeded demo data from `js/data.js`. Only **sales** and **deliveries** are
  server-backed so far; wiring the rest is outstanding work.

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
roleOf()            // 'manager' | 'cashier' | … | null in demo mode and in _shot.html
allow(perm)         // true in demo/_shot (the demo must show the whole system)
seesCost()          // allow('cost.read')
seesProfit()        // allow('profit.read')
isPartnerAccount()  // Yalla Wear — locked into their portal
navAllowed(id)      // per-screen gate, via the NAV_PERM map
ifNav(view, html)   // wrap in-page shortcut buttons ("View all →")
```

`allow()` returning **true** in demo mode is deliberate: the demo and the Arabic proposal exist to show
the whole system, and neither has real data behind it.

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
| manager / demo / `_shot.html` | `viewDashboard()` — the full dashboard | charts |

The partner never reaches it: `boot()` and `render()` both force `OG.print.partner = true` for that role,
and the `partner-view` toggle refuses for them.

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

## Known open work

- Most screens still read `js/data.js` demo data; warehouse, stock and customers are not yet server-backed.
- Delivery **cash reconciliation** is designed and the schema carries it (`to_collect`, `collected`,
  `Deliveries.driverDay()`), but the end-of-day settle-up screen is not built.
- Bulk catalogue entry; the Yalla Wear remote portal against real data; an offline write queue.
- **Old vs redenominated Syrian lira has never been settled.** The seed assumes old lira — 1 USD = 13,000,
  salaries in millions. If the shop is on new lira, the entire dataset is wrong by three orders of magnitude.
- `flutter_app/` fails to build on an Android NDK/`sdkmanager` crash.
- Remove the test accounts before go-live: `npm run demo-users -- --remove`.
