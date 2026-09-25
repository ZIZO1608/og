# Night shift 2026-09-25 — appendix

The detail behind `NIGHT-SHIFT-REPORT.md`. Read that first; this is for looking things up.

- A. The frontend map (`js/`, screens, tabs, who can open what)
- B. The server map (`server/lib`, every route and its gate, scripts, panel jobs)
- C. Every connection the system makes to the outside
- D. Check outputs (counts, commands, where the logs are)

Everything below was read off the code at `c302c23` (main, 25 Sep 2026) by two read-only
agents and spot-checked by hand. Line numbers are that commit's.

---

## A. Frontend

### A.1 What `index.html` loads

- **14 stylesheets**, in order: `assets/fonts/fonts.css`, then `css/tokens.css`, `shell.css`,
  `motion-cards.css`, `inputs-dashboard-pos.css`, `dialogs-customers-jobs.css`,
  `warehouse-settings.css`, `yalla-scan.css`, `yalla-invoice-tracker-labels.css`,
  `bulk-gate-responsive.css`, `splash.css`, `print-hardware-receipt-newlabels.css`,
  `yalla-theme.css`, and **`og-skin.css` last** (on purpose).
- **70 scripts**, every file in `js/` except `js/vendor/`. Nothing in `js/` is unused, and nothing
  is injected lazily except the two vendor files:
  - `js/vendor/chart.umd.min.js`, injected by `js/charts.js` on the first chart;
  - `js/vendor/three.min.js`, injected by `js/shelfroom.js` on the first 3D room.
- **`sw.js`**: `CACHE = 'og-system-v309'` at c302c23. The precache list holds every page file
  above, both vendor files, the fonts and the icons. **No entry is missing a file, and no file the
  page loads is missing from the list.**

### A.2 The modules (one global each)

| File | Global | What it owns |
|---|---|---|
| access.js | `AccessUI` | Settings → per-person access |
| api.js | `API` | the only HTTP client (plus one health ping in `reach.js`) |
| auth.js | `Auth` | sign-in, session, `Auth.can` |
| bulk.js | `Bulk` | tick boxes and the bulk bar |
| cashbook.js | `Cashbook` | Money: where the money is, close the day, money history |
| catset.js | `CatSet` | categories (Settings) |
| charts.js | `Charts` | Chart.js wrapper, lazy |
| codes.js | `Codes` | EAN-13, Code 128, QR |
| colourform.js / colourpick.js | `ColourForm` / `ColourPick` | colours on a product; the colour chooser after a scan |
| data.js | `CONFIG`, `DB` (+ helpers) | the data model and lookups |
| datepick.js | `DatePick` | the date picker |
| deliveries.js | `Deliveries` | the deliveries board and the driver's phone |
| desk.js | `Desk` | the order desk, Payment methods page, delivery settings |
| escpos.js | `ESCPOS` | receipt bytes |
| export.js | `Export` | Excel/PDF engine |
| home.js | `Home` | the job-button home |
| labels.js / labels60.js | `Labels` / `Labels60` | product labels / shelf labels |
| layers.js | `Layers` | everything that floats: close on route change, Escape, Back |
| money.js | `Money` | the Money screen |
| motion.js | `Motion` | animation |
| notify.js | `Notify` | the message bell (both portals) |
| palette.js | `Palette` | Ctrl+K |
| payables.js | `Payables` | suppliers and salaries |
| photos.js | `Photos` | a colour's photos |
| pos.js | `POS` | the till |
| pulse.js | `Pulse` | the live channel |
| reach.js / writequeue.js | `Reach` / `WriteQueue` | is the till answering; the Wi-Fi-drop queue |
| receipt.js | `Receipt` | the 80 mm receipt |
| receive.js | `Receive` | Goods arrived |
| requests.js | `Requests` | night-mode requests ("Waiting for the shop") |
| reviews.js | `Reviews` | delivery reviews |
| road.js | `Road` | handover sheet, driver cash |
| safeers.js | `Safeers` | the delivery team |
| scan.js / wedge.js | `Scan` / `Wedge` | camera scanner / keyboard-wedge scanner |
| selectbox.js | `SelectBox` | custom select |
| shelfmap.js / shelfroom.js | `ShelfMap` / `ShelfRoom` | shelf map; the 3D room |
| shop.js | `Shop` | loads the shop from the server |
| splash.js | `Splash` | loading screen |
| staff.js | `Staff` | the people card |
| standby.js | `Standby` | the standby strip and outbox |
| statement.js | `Statement` | the month's statement |
| stock.js | `Stock` | stock count |
| update.js | `Update` | one page, one build (service-worker updates) |
| weborders.js | `WebOrders` | website orders |
| whatsapp.js | `WA` | every WhatsApp message (bilingual) |
| yalla.js / ylinvoice.js | `YALLA` / `YLINV` | Yalla Wear's portal; partner invoices |
| app-*.js (17 files) | top-level functions | the old `app.js`, split: state, i18n, util, export, shell, dashboard, products, print-labels, warehouse, customers-scan, jobs-reports, settings, documents, routing, i18n-extra, actions, changes, boot |

No top-level name is defined in two files (604 checked). `money()` (app-util.js) beside `Money`
(money.js) is legal and only confusing.

### A.3 Screens, and who can open each

Roles: **O** owner · **D** developer · **M** manager · **C** cashier · **W** warehouse ·
**Dl** delivery. The partner (Yalla Wear) never reaches any of these — its role is forced into its
own portal. "M after rebuild" is the manager as `npm run users:rebuild` leaves it (no money, no
cost, no settings, no access), which is what the live shop has.

| Screen | Gate | Opens for | Tabs / parts |
|---|---|---|---|
| Home (`dashboard`) | none | everyone | 4–6 job tiles by role; O and D also get the full dashboard under them; the driver gets his runs |
| Till (`pos`) | sell | O D M C | — |
| Products | product.read | O D M C W Dl | filters, select mode |
| Warehouse | stock.read | O D M C W | arrived · move · stock (Where is it?) · count · add; under More: po, moves, wants |
| Shelf map | stock.read | O D M C W | map / 3D room |
| Money | money.read / money.count / staff.read / profit.read | O D (M before rebuild) C (close only) | now · close · expenses · suppliers · salaries · statement; Records: book · debt · shift |
| Payment methods | config.write | O D | — |
| Order desk | delivery.desk | O D M | 5 steps: bag · customer · travels by · address · pay |
| Waiting for the shop (`requests`) | delivery.desk | O D M | — |
| Deliveries | delivery.read | O D M (Dl: as his home) | parcels · handover · cash back; lanes / list |
| Safeers | safeer.read | O D M | filter panel |
| Website orders | delivery.web | O D M C | new · accepted · rejected |
| Reviews | delivery.desk | O D M | stars / show filters |
| Customers (+ `#customers/<id>`) | customer.read | O D M C | profile |
| Labels | label.print | O D M W | — |
| Print (Yalla Wear jobs) | print.read | O D M C W | board · invoices |
| Reports | report.read | O D M | sales · profit · inventory · payments · employees · suppliers (each gated) |
| Settings | config.write | O D | the shop · money and prices · deliveries · people and access · developer (mirror, Telegram, reminders) |

**Yalla Wear's portal** (`yalla.js`): Today · Job queue · Invoices · Earnings · Reviews.

Phone tab bar (`ROLE_TABS`): cashier Home/Till/Customers · warehouse Home/Warehouse/Products ·
manager Home/Desk/Deliveries · owner & developer Home/Money/Deliveries · driver Home/Products.

### A.4 Delegated click namespaces

`data-act` (app-boot.js → `ACTIONS`, 291 handlers, every value used in markup resolves) and
`data-change` (→ `CHANGES`) are the two big ones. Each module has its own: `data-bk` bulk ·
`data-sc` scan · `data-ac` access · `data-cat` categories · `data-cb`/`data-cbc` cashbook ·
`data-py`/`data-pyc` payables · `data-mn` money · `data-pl` statement · `data-pos` till ·
`data-yl` portal · `data-yi` partner invoices · `data-cf` colour form · `data-cp` palette **and**
colour picker · `data-st` staff **and** stock count · `data-sf` safeers · `data-sm` shelf map ·
`data-ph` photos · `data-nt` bell · `data-dp` date picker · `data-wa` WhatsApp.
`_nightshift/fix05/p0-namespaces` (6 checks) passes: no button is wired to a namespace nobody
listens for.

---

## B. Server

### B.1 `server/lib/` — 69 modules, none unused

The ones people ask about most: `db.js` (open, migrate, `tx`, `logChange`) · `auth.js`
(accounts, sessions, permissions) · `http.js` (router, origin check, static files) · `sales.js` ·
`stock.js` · `cashbook.js` (where the money is) · `orders.js` (the delivery office) ·
`partner.js` (Yalla Wear) · `mirror.js` + `sync-worker.js` (the cloud copy) · `lineage.js` (who
owns the mirror) · `standby.js` + `outbox.js` + `loans.js` (the standby and its offline till) ·
`telegram.js` + `telegram-commands.js` + `reminders.js` + `office-alerts.js` (the bots) ·
`webpush.js` + `tracking.js` + `receipt.js` (the customer's `/i/` page) · `weborders.js` +
`webcheckout.js` (the website) · `fxfeed.js` (the dollar rate) · `photos.js` + `storage.js`
(pictures).

### B.2 How a request is checked (index.js `handle()`)

1. Any non-GET `/api/` must pass the origin check (`originAllowed`).
2. `/api/copy/` needs `OG_COPY_KEY`, and is 404 to anything the public proxy carried and on a
   standby.
3. A standby refuses writes except sign-in/out and the offline till's kinds.
4. `/api/vps/` needs `OG_VPS_API_KEY` (404 through the proxy).
5. `/api/ext/` needs `OG_WEB_API_KEY` (401 wrong, 503 none configured).
6. Everything else needs a session, except sign-in, the hint door and `/api/health`.
7. `/i/<token>` (the customer's page) is outside the router.

**215 routes.** Every one that writes is gated by `requirePerm`, a key, or is the caller's own
data (sign-out, password change with the current password, linking one's own Telegram, marking
one's own bell read). No hole was found.

### B.3 Scripts that say they only read — and two that do not

| Script | Says | Does |
|---|---|---|
| `supabase:check`, `supabase:drift` | read-only | read-only (`DB.openReadOnly`, only `select`/`count`/`columns`) ✔ |
| `test-print` | read-only DB | read-only ✔ |
| **`preflight` (panel: Readiness check)** | "changes nothing" | **`DB.open` applies pending migrations** — fixed tonight |
| **`hardware` (panel: Check printers)** | "checks, changes nothing" | **`DB.open` applies pending migrations** — fixed tonight |
| `purge-demo` (dry run), `supabase:reconcile --dry-run` | dry | `DB.open` migrates (left; both are developer tools) |

### B.4 Panel jobs (`panel/jobs.js`, 25)

Publish (`git add -A` → commit → `pull --rebase --autostash` → push) · Get the latest code ·
Build dist · Backup now · Readiness check · Check printers · Print a test / Check the printers
(no paper) · Set up printers · the three always-on jobs · Make certificate (`NEW CERT`) · Trust
certificate · Check the mirror · Check the shape · Full sync · Reconcile (`RECONCILE`) · Restore
the shop from the cloud (`RESTORE`) · Where the shop runs · Move the shop to the VPS (`VPS`) ·
Send the code to the VPS · VPS shop log · Bring the shop back to this laptop (`TAKE BACK`) · New
account.

### B.5 Migrations

- Local `server/migrations/`: `001`–`067`, no gaps, no duplicates. Next is `068`.
- Cloud `server/supabase/`: two `030`s and two `031`s (two families, explained in its README);
  **no `034`** (nothing mentions why); next is `038`. `CATCH-UP.sql` is **`008`–`029` + `036`**
  (the README said `001`–`029` — fixed tonight).
- Every column a local migration adds to a mirrored table is in a cloud file or declared in
  `mirror-lag.js`; `supabase:drift` confirms it against the live project (56 tables, green).

---

## C. Connections to the outside

| To | From | Switched off by | Runs on a timer |
|---|---|---|---|
| Supabase REST/RPC (the mirror, og-track's inbox, website orders, night requests, web checkout) | `lib/supabase.js`, `mirror.js`, `inbox.js`, `weborders.js`, `requests.js`, `webcheckout.js` | no `SUPABASE_URL`/key; `OG_SYNC_MINUTES=0`; a standby runs none | yes: 10 s tick, hourly full run, 2-min beat, 1-min inbox |
| Supabase Storage (`product-images`) | `lib/storage.js` | not configured → 503 | no |
| The dollar-rate feed | `lib/fxfeed.js` | no `OG_FX_KEY` | yes: 15 s, then every 10 min (main server only) |
| Telegram (two bots) | `lib/telegram.js` | no token | yes: drain 5 s, long-poll, reminders 1 min |
| Web Push | `lib/webpush.js` (vendor push hosts only) | `OG_PUSH=0` | no (on an order moving) |
| The main server (from a standby) | `lib/standby.js` | only when `OG_ROLE=standby` | yes: copy every 5 min, probe 5 s |
| Printers | `lib/printer.js`, `label-transport-tcp.js`, `agent/print-agent.js` | transport setting | the agent long-polls |
| GitHub | panel Publish / Get the latest code | — | no |
| The VPS over SSH | `scripts/vps.js` | — | no |
| og-bridge → the till, → the mirror | `vps/og-bridge/` | — | yes (on the VPS) |

---

## D. Check outputs

All logs are in `D:\DESKTOP\og-night-shift\logs\` (not in git). Tools in `…\tools\` and
`…\_nightshift\` (copies of the live harness, pointed at the scratch server).

(filled in as the night goes — see the report's traffic lights for the verdicts)
