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
```

**Node 22.5+ required** (`node:sqlite` is used, which arrived in 22.5). There is **no `npm install`** —
the server has zero dependencies by design, and the frontend has no build step at all.

Publishing: **double-click `push.bat`** (add → commit → pull --rebase → push). CI then builds `dist/`
and deploys to GitHub Pages.

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

- **Vanilla HTML/CSS/JS. No framework, no bundler, no npm, no build step** for the frontend. The only
  third-party file is `js/vendor/chart.umd.min.js`, committed directly.
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

## Supabase — a one-way mirror

SQLite is the system of record. Supabase is a copy kept for the day this machine dies, and nothing
reads from it in normal operation. `npm run supabase:sync` pushes; `npm run supabase:restore` pulls
the whole shop back onto a clean machine.

**`npm run supabase:check` is the one command that answers "is the mirror trustworthy".** It
compares every mirrored table row for row, checks each sync bookmark against its own table, and
reports whether accounts could actually be recovered. It exits non-zero when the mirror is not a
faithful copy, so it can gate a deploy. `--quick` stops after the connection test.

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
- `npm run supabase:reconcile` is the repair tool for the cursor tables when something wrote rows
  outside `change_log`. The mirror and append-only tables are self-correcting and do not need it.
  It is also the **only** thing that recovers a row whose log entry was consumed by a run that did
  not land it — the cursor is legitimately past it, so no rewind will ever look there again. Its
  comparison reports both directions; a table short of rows *in Supabase* is the case that matters,
  and it read as "in step" until that was fixed.
- **`sales.shift_id` is the one column that can break a sync.** `sales` is pushed OUTSIDE the guarded
  block, so on a Supabase without `005` the whole batch is rejected and a day of sales stops mirroring
  over an optional table. `TABLES.sales.fallbackDrop` retries without the column and names the file to
  run — the same shape as the `pw_enc` fallback in `syncUsers`. Verified against the live mirror.
- **Four schema files are run by hand in the Supabase dashboard: `002_user_credentials.sql`,
  `003_partner.sql`, `004_purchasing_and_alerts.sql` and `005_money_and_counts.sql`** (`001` too, on
  a new project). All four are applied on the live mirror. `002` adds `users.pw_enc` and is easy to
  forget because the sync only needs it once `OG_VAULT_KEY` is set.
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

## Known open work

- The **supplier and payroll editors do not exist**. `Shop.saveSupplier` / `saveEmployee` and their
  routes are live and tested; there is simply no screen. Same for adding one size to an existing
  product (`Shop.addVariant`) and cancelling a purchase order (`Shop.cancelPO`). These are listed by
  name in the wiring test so they stay visible rather than becoming permanent.
- A **draft partner invoice** still lives only in the browser — `partner_invoices.issued` is
  `NOT NULL`, so there is nowhere to put one. Issuing it reaches the server; saving a draft does not.
- Delivery **cash reconciliation** is designed and the schema carries it (`to_collect`, `collected`,
  `Deliveries.driverDay()`), but the end-of-day settle-up screen is not built.
- Bulk catalogue entry; the Yalla Wear remote portal against real data; an offline write queue.
- **Old vs redenominated Syrian lira has never been settled.** The seed assumes old lira — 1 USD = 13,000,
  salaries in millions. If the shop is on new lira, the entire dataset is wrong by three orders of magnitude.
- `flutter_app/` fails to build on an Android NDK/`sdkmanager` crash.
- The demo catalogue rows are hidden, not deleted — all five had been sold, so removing them would
  have broken the invoices referencing them. `products.demo` and `customers.demo` still exist for that
  reason, but nothing sets them any more.

## The bell

`server/lib/alerts.js`. Computed on every request from the shop's current state — never stored,
because an alert is a fact about now and a stored alert is a fact about a state that has moved on.

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
