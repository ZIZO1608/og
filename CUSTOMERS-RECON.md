# CUSTOMERS-RECON.md

Reconnaissance for the Customers screen. **Read-only pass — nothing in the repo or the database was
modified.** Every claim below carries a `file:line-range` citation; anything I could not verify is
marked `UNVERIFIED` or `NOT FOUND`.

Personal data is redacted as instructed: `[name]` / `+963XXXXXXXXX`.

---

# Part 1 — Orientation

## 1. Branch and recent commits

```
$ git branch --show-current
main

$ git log --oneline -10
9a47f04 Update
9db2ad9 Update
60ca329 Update
e8e8a21 Update
9ad376d Merge the receipt-ink work with the settings accordion
2263d02 Update
d5a9e4e Update
6382c6e Update
03e8dfa Update
9e1a250 Update

$ git status --porcelain
(clean)
```

## 2. File listing with line counts

### `js/` — 28,141 lines total

```
     6  js/vendor/three.min.js        (minified, 1 line-ish)
    20  js/vendor/chart.umd.min.js
    53  js/app-state.js
   155  js/escpos.js
   165  js/api.js
   182  js/whatsapp.js
   193  js/wedge.js
   206  js/notify.js
   213  js/app-print-labels.js
   227  js/app-changes.js
   235  js/palette.js
   250  js/selectbox.js
   279  js/app-products.js
   282  js/app-boot.js
   282  js/charts.js
   314  js/app-util.js
   315  js/auth.js
   326  js/app-documents.js
   342  js/shop.js
   346  js/deliveries.js
   363  js/app-routing.js
   395  js/export.js
   421  js/labels60.js
   431  js/scan.js
   441  js/motion.js
   442  js/app-i18n-extra.js
   472  js/stock.js
   498  js/labels.js
   500  js/app-export.js
   513  js/app-shell.js
   538  js/app-jobs-reports.js
   543  js/bulk.js
   560  js/money.js
   567  js/app-dashboard.js
   610  js/app-customers-scan.js     <-- the existing customers screen
   725  js/ylinvoice.js
   748  js/app-settings.js
   793  js/codes.js
  1004  js/receipt.js
  1088  js/app-i18n.js
  1094  js/app-warehouse.js
  1248  js/app-actions.js
  1338  js/yalla.js
  1585  js/shelfroom.js
  1765  js/pos.js
  2419  js/shelfmap.js
  2649  js/data.js
```

**There is no `js/app.js`.** `ls js/app.js` → `No such file or directory`. It was split into the
seventeen `app-*.js` files listed above. This matters a great deal because `CLAUDE.md` refers to
`js/app.js` throughout (see §40).

### `css/` — 4,553 lines total

```
   154  css/dialogs-customers-jobs.css     <-- .cust-grid / .cust-card / .cc-* live here
   246  css/motion-cards.css
   318  css/shell.css
   319  css/yalla-invoice-tracker-labels.css
   372  css/tokens.css
   428  css/inputs-dashboard-pos.css
   562  css/bulk-gate-responsive.css       <-- all the phone breakpoints
   673  css/print-hardware-receipt-newlabels.css
   688  css/warehouse-settings.css
   793  css/yalla-scan.css
```

### `server/` — 1,723 lines in `index.js`

### `server/lib/` — 7,320 lines total

```
    49  server/lib/label-transport-tcp.js
   109  server/lib/env.js
   112  server/lib/printer.js
   140  server/lib/credvault.js
   140  server/lib/db.js
   146  server/lib/printing.js
   155  server/lib/counts.js
   164  server/lib/customers.js            <-- EXISTS, full contents in §15
   172  server/lib/alerts.js
   174  server/lib/sync-worker.js
   196  server/lib/purchasing.js
   226  server/lib/supabase.js
   248  server/lib/http.js
   277  server/lib/stock.js
   300  server/lib/money.js
   320  server/lib/deliveries.js
   378  server/lib/receipt.js
   440  server/lib/catalogue.js
   458  server/lib/sales.js
   504  server/lib/auth.js
   534  server/lib/partner.js
   841  server/lib/labels.js
  1237  server/lib/shelves.js
```

### `server/migrations/` — 2,237 lines total, 26 files

```
   280  001_init.sql                      <-- CREATE TABLE customers
    59  002_reference_data.sql
   184  003_role_permissions.sql          <-- customer.read / customer.write seed
   119  004_deliveries.sql                <-- ALTER TABLE customers ADD COLUMN address
    91  005_redenomination.sql
    40  006_invoice_tokens.sql
    47  007_customers_and_points.sql      <-- city, source, archived, demo + sales.points_used
    32  008_shop_identity.sql
    70  009_receipts.sql                  <-- sales.points_earned
   131  010_labels.sql
    99  011_label_templates.sql
    21  012_label_preset_60x40.sql
    35  013_label_preset_more_templates.sql
    19  014_sale_txn_ref.sql
   231  015_partner.sql                   <-- clubs, print_jobs (customer is TEXT, not an FK)
    67  016_purchasing_and_alerts.sql
   167  017_money_and_counts.sql          <-- debt_payments
    31  018_receipt_usb.sql
    26  019_receipt_contact.sql
    36  020_receipt_qr_urls.sql
    30  021_receipt_confirm_print.sql
    40  022_exchange_48h.sql
   150  023_shelves.sql
   132  024_label_subjects.sql
    47  025_receipt_ink.sql
    53  026_rooms.sql
```

### `server/scripts/` — 3,315 lines

```
    81  supabase-test-write.js
   114  net-check.js
   158  backup.js
   186  createuser.js
   203  preflight.js
   226  supabase-reconcile.js
   275  purge-demo.js
   356  supabase-restore.js
   381  supabase-check.js
   590  hardware.js
   745  supabase-sync.js
```

## 3. `sw.js` — `CACHE` value and complete precache list

The current value, verbatim:

```js:sw.js:18
var CACHE = 'og-system-v82';
```

The complete `SHELL` array, verbatim:

```js:sw.js:20-83
var SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/shell.css',
  'css/motion-cards.css',
  'css/inputs-dashboard-pos.css',
  'css/dialogs-customers-jobs.css',
  'css/warehouse-settings.css',
  'css/yalla-scan.css',
  'css/yalla-invoice-tracker-labels.css',
  'css/bulk-gate-responsive.css',
  'css/print-hardware-receipt-newlabels.css',
  'assets/fonts/fonts.css',
  /* Cairo carries the Arabic on a 60x40 thermal label; Montserrat has no
     Arabic glyphs at all. Precached because the shop is regularly offline. */
  'assets/fonts/Cairo-700.ttf',
  'assets/logo.svg',
  'assets/instagram-mark.svg',
  'assets/telegram-mark.svg',
  'assets/cursor.svg',
  'assets/cursor-pointer.svg',
  'assets/yalla-wear.svg',
  'assets/yalla-mark.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'js/vendor/chart.umd.min.js',
  'js/vendor/three.min.js',
  'js/api.js',
  'js/auth.js',
  'js/codes.js',
  'js/export.js',
  'js/data.js',
  'js/receipt.js',
  'js/escpos.js',
  'js/labels.js',
  'js/labels60.js',
  'js/shelfroom.js',
  'js/shelfmap.js',
  'js/shop.js',
  'js/charts.js',
  'js/pos.js',
  'js/bulk.js',
  'js/motion.js',
  'js/scan.js',
  'js/wedge.js',
  'js/stock.js',
  'js/money.js',
  'js/selectbox.js',
  'js/palette.js',
  'js/whatsapp.js',
  'js/notify.js',
  'js/ylinvoice.js',
  'js/yalla.js',
  'js/deliveries.js',
  'js/app-state.js',
  'js/app-i18n.js',
  'js/app-util.js',
  'js/app-export.js',
  'js/app-shell.js',
  'js/app-dashboard.js',
  'js/app-products.js',
  'js/app-print-labels.js',
  'js/app-warehouse.js',
  'js/app-customers-scan.js',
  'js/app-jobs-reports.js',
  'js/app-settings.js',
  'js/app-documents.js',
  'js/app-routing.js',
  'js/app-i18n-extra.js',
  'js/app-actions.js',
  'js/app-changes.js',
  'js/app-boot.js'
];
```

Note `js/motion.js` is in the shell list but placed out of its `index.html` order — harmless, the
list is a set. **`js/app-customers-scan.js` is already precached**, so splitting the customers screen
into a new file (e.g. `js/app-customers.js`) means adding it here *and* bumping `CACHE` to `v83`.

## 4. Complete `<script>` block from `index.html`, in order

```html:index.html:50-114
<!-- Chart.js vendored locally — the app now has zero network dependencies. -->
<script src="js/vendor/chart.umd.min.js"></script>
<!-- codes.js first: data.js uses it to stamp valid EAN-13 check digits.
     yalla.js before app.js, same pattern as pos.js. -->
<!-- api.js before auth.js: the login screen talks to the server through it. -->
<script src="js/api.js"></script>
<script src="js/auth.js"></script>
<script src="js/codes.js"></script>
<!-- motion.js is presentation only — if it failed to load the app would look
     flatter and behave identically. It has no dependencies of its own and
     sits above charts.js, which asks it whether animation is allowed. -->
<script src="js/motion.js"></script>
<script src="js/export.js"></script>
<script src="js/data.js"></script>
<!-- The 80mm thermal receipt: receipt.js draws it on canvas (needs Codes for
     the barcode/QR and CONFIG for shop/receipt settings, both above), escpos.js
     packs that canvas into printer bytes. Both must load before pos.js, which
     calls Receipt.autoPrint() the moment a sale completes. -->
<script src="js/receipt.js"></script>
<script src="js/escpos.js"></script>
<!-- Thermal product labels (XP-235B / TSPL) — a separate printer, a separate
     queue, from the receipt above. Needs Codes+CONFIG (data.js) and
     ESCPOS.packBitmap (escpos.js, for rasterizing an Arabic name), so it
     loads right after both. -->
<script src="js/labels.js"></script>
<script src="js/labels60.js"></script>
<!-- shelfroom.js before shelfmap.js: the map asks the room to draw. Three.js itself is
     NOT a script tag here — shelfroom.js fetches it the first time the map opens. -->
<script src="js/shelfroom.js"></script>
<script src="js/shelfmap.js"></script>
<!-- shop.js turns server payloads into the shapes data.js defines, so it must
     come after it. Nothing it does runs at load time: app.js calls Shop.load()
     once, after sign-in, before the first paint. -->
<script src="js/shop.js"></script>
<script src="js/charts.js"></script>
<script src="js/pos.js"></script>
<script src="js/bulk.js"></script>
<!-- notify.js is shared by BOTH portals; ylinvoice.js before yalla.js, because
     the partner portal delegates its Invoices view to it. -->
<script src="js/scan.js"></script><script src="js/wedge.js"></script><script src="js/stock.js"></script><script src="js/money.js"></script>
<script src="js/selectbox.js"></script><script src="js/palette.js"></script><script src="js/whatsapp.js"></script><script src="js/notify.js"></script>
<script src="js/ylinvoice.js"></script>
<script src="js/yalla.js"></script>
<!-- deliveries.js reads roleOf(), t() and toast() from app.js, but only ever
     inside a function app.js calls — so it may load before it, and must,
     because VIEWS in app.js names Deliveries at definition time. -->
<script src="js/deliveries.js"></script>
<script src="js/app-state.js"></script>
<script src="js/app-i18n.js"></script>
<script src="js/app-util.js"></script>
<script src="js/app-export.js"></script>
<script src="js/app-shell.js"></script>
<script src="js/app-dashboard.js"></script>
<script src="js/app-products.js"></script>
<script src="js/app-print-labels.js"></script>
<script src="js/app-warehouse.js"></script>
<script src="js/app-customers-scan.js"></script>
<script src="js/app-jobs-reports.js"></script>
<script src="js/app-settings.js"></script>
<script src="js/app-documents.js"></script>
<script src="js/app-routing.js"></script>
<script src="js/app-i18n-extra.js"></script>
<script src="js/app-actions.js"></script>
<script src="js/app-changes.js"></script>
<script src="js/app-boot.js"></script>
```

**Load-order facts that constrain a Customers rewrite:**

- `js/app-customers-scan.js` sits between `app-warehouse.js` and `app-jobs-reports.js`.
- `app-actions.js` loads *after* every screen file and references their functions **by value** inside
  one object literal, so any function the new screen exposes to `ACTIONS` must be defined in a file
  loaded before `app-actions.js`. The file says so itself:

```js:js/app-actions.js:6-16
   This is one giant object literal referencing dozens of functions by
   value (nav: go, whatsapp: openWhatsapp, ...) — every file that defines
   one of those functions (app-shell/app-dashboard/app-products/
   app-warehouse/app-customers-scan/app-jobs-reports/
   app-settings/app-documents/app-routing) MUST already be
   loaded before this file runs, since cross-<script> execution does not
   hoist. Kept as a single intact object literal per the split plan —
   breaking it into ACTIONS['key'] = fn assignments would be a real code
   shape change, not just a file move.
```

- `app-routing.js` (which holds `VIEWS`) loads *after* `app-customers-scan.js`, so `viewCustomers`
  already exists by the time `VIEWS` is built.
- **`openNewCustomer` currently lives in `js/app-warehouse.js`, not in the customers file**
  ([app-warehouse.js:211-244](js/app-warehouse.js#L211-L244)). It is called from both
  `app-actions.js` and `pos.js`. Moving it is safe only if the new file still loads before
  `app-actions.js`.

## 5. Migrations — highest on disk, and what the database records

**Highest file on disk: `026_rooms.sql`.**

The database exists at `server/data/og.db` (880,640 bytes, plus a 2.4 MB `-wal` and a 32 KB `-shm`).
All 26 migrations are recorded. `schema_migrations` is `(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
— there is no `id` column.

```
001_init.sql                        2026-08-23T23:12:54.179Z
002_reference_data.sql              2026-08-23T23:12:54.182Z
003_role_permissions.sql            2026-08-24T00:12:53.930Z
004_deliveries.sql                  2026-08-24T05:52:18.250Z
005_redenomination.sql              2026-08-24T16:53:46.955Z
006_invoice_tokens.sql              2026-08-24T16:57:46.879Z
007_customers_and_points.sql        2026-08-24T17:52:21.402Z
008_shop_identity.sql               2026-08-24T20:03:43.034Z
009_receipts.sql                    2026-08-25T12:15:26.139Z
010_labels.sql                      2026-08-25T14:25:10.601Z
011_label_templates.sql             2026-08-26T17:48:34.383Z
012_label_preset_60x40.sql          2026-08-27T19:51:56.788Z
013_label_preset_more_templates.sql 2026-08-27T20:56:47.359Z
014_sale_txn_ref.sql                2026-08-28T20:23:07.810Z
015_partner.sql                     2026-08-29T14:55:59.210Z
016_purchasing_and_alerts.sql       2026-08-29T14:55:59.219Z
017_money_and_counts.sql            2026-08-29T14:55:59.222Z
018_receipt_usb.sql                 2026-08-29T15:15:59.708Z
019_receipt_contact.sql             2026-08-29T19:07:00.282Z
020_receipt_qr_urls.sql             2026-08-29T19:17:50.042Z
021_receipt_confirm_print.sql       2026-08-29T19:46:06.324Z
022_exchange_48h.sql                2026-08-29T19:56:06.626Z
023_shelves.sql                     2026-08-29T20:48:36.705Z
024_label_subjects.sql              2026-08-30T13:00:12.494Z
025_receipt_ink.sql                 2026-08-30T16:22:03.234Z
026_rooms.sql                       2026-08-30T18:47:36.175Z
```

**A new customers migration would be `027_*.sql`.**

---

# Part 2 — The customers schema as it actually is

## 6. Every migration that creates or alters anything customer-related

Only **three** files touch the `customers` table. A grep for `customer_id` across all migrations
returns only two hits, both in `001_init.sql` (§10).

### `server/migrations/001_init.sql` — the table and its two indexes

```sql:server/migrations/001_init.sql:184-194
CREATE TABLE customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  phone          TEXT,
  note           TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX customers_phone ON customers (phone);
CREATE INDEX customers_name  ON customers (name);
```

**Neither index is `UNIQUE`.** There is no duplicate-phone constraint at the database level.

### `server/migrations/004_deliveries.sql` — the address

```sql:server/migrations/004_deliveries.sql:21-27
-- --------------------------------------------------------------- an address
--  On the customer, and nullable, because most customers never have anything
--  delivered. It is only ever the DEFAULT offered at the till: the real address
--  lives on the delivery row, since the same person has a parcel sent to their
--  shop one week and their flat the next, and overwriting the customer record
--  each time would quietly lose both.
ALTER TABLE customers ADD COLUMN address TEXT;
```

### `server/migrations/007_customers_and_points.sql` — city, source, archived, demo

Full file header, because it documents the design intent for the whole feature:

```sql:server/migrations/007_customers_and_points.sql:1-47
-- =============================================================================
--  Customers become real, and loyalty points stop being free
-- -----------------------------------------------------------------------------
--  Until now the browser owned the customer list. The server had the table but
--  no way to read or write it, so `customers` held zero rows while the till
--  happily showed forty people. Sales.record looked up the customer id the till
--  sent, found nothing, and wrote the sale with no customer and no points --
--  silently. The cashier saw a normal receipt. The loyalty simply evaporated.
--
--  Three things this adds.
--
--  1. sales.points_used
--     Points redeemed at the till were folded into `discount` and never taken
--     off anyone's balance, so the same 500 points could be spent on every
--     visit forever. The deduction now happens server-side, inside the sale's
--     own transaction, and the amount is written onto the row -- because a
--     receipt reprinted in a year has to be able to say what was redeemed, and
--     recomputing it from a balance that has moved since is guesswork.
--
--  2. city / source / archived on customers
--     The app already displays all three (the customer list filters on city,
--     the card shows online vs in-store). They were browser-only fields with
--     nowhere to land.
--
--  3. A `demo` flag on products and customers
--     `npm run demo-catalogue` fills a scratch database with a shop's worth of
--     goods so the system can be shown working. Those rows must be removable
--     EXACTLY -- taking a real product out with them would be unforgivable, and
--     matching on name would eventually do precisely that. A flag makes the
--     removal a WHERE clause instead of a guess, and makes "is this database
--     still full of demo data?" one query the server can ask on startup.
-- =============================================================================

--  Zero rather than NULL: every existing sale redeemed nothing, and that is a
--  fact about them, not missing information.
ALTER TABLE sales ADD COLUMN points_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customers ADD COLUMN city     TEXT;
ALTER TABLE customers ADD COLUMN source   TEXT;
ALTER TABLE customers ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

--  Deliberately DEFAULT 0 on both: anything created by a person through the app
--  is real unless the seed script says otherwise. Failing closed here means a
--  bug in the seeder can leave demo rows behind, which is visible and fixable;
--  the other way round it would delete the shop's catalogue.
ALTER TABLE customers ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products  ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
```

Note: `npm run demo-catalogue` referenced in that comment **no longer exists** in
`server/package.json` — only `purge-demo.js` survives in `server/scripts/`.

## 7. `PRAGMA table_info(customers)` and `PRAGMA index_list(customers)`

Run against the live `server/data/og.db`, opened `readOnly: true` via `node:sqlite`.

```
cid  name             type     notnull  dflt_value  pk
---  ---------------  -------  -------  ----------  --
  0  id               INTEGER        0  NULL         1
  1  name             TEXT           1  NULL         0
  2  phone            TEXT           0  NULL         0
  3  note             TEXT           0  NULL         0
  4  loyalty_points   INTEGER        1  0            0
  5  created_at       TEXT           1  NULL         0
  6  updated_at       TEXT           1  NULL         0
  7  address          TEXT           0  NULL         0
  8  city             TEXT           0  NULL         0
  9  source           TEXT           0  NULL         0
 10  archived         INTEGER        1  0            0
 11  demo             INTEGER        1  0            0
```

```
PRAGMA index_list(customers)
seq  name             unique  origin  partial
---  ---------------  ------  ------  -------
  0  customers_name        0     c          0
  1  customers_phone       0     c          0
```

Both are plain `CREATE INDEX` (`origin = 'c'`), **neither is unique**, and there is no index on
`archived`, `city` or `demo`.

## 8. Row counts

```sql
SELECT COUNT(*) FROM customers;          -->  1
SELECT demo, COUNT(*) FROM customers
  GROUP BY demo;                         -->  demo=0, n=1
```

Surrounding tables, for scale:

```
sales           8
sale_items      8
debt_payments   0
deliveries      4
clubs           9
wa_messages     0
print_jobs      0
```

**This is effectively an empty shop.** One customer, eight sales, and — critically — see §9 and §12:
**every one of those eight sales has `customer_id = NULL`.** The single customer has never bought
anything. `debt_payments` is empty and there are no `credit` sales, so nothing in the debt path has
ever executed against real data on this machine.

`change_log` shows history that the current table no longer reflects:

```
customers  insert   81
customers  update    9
customers  delete   40
```

Eighty-one customers were created over the life of this database, forty were deleted (the demo purge),
and one survives. IDs are therefore sparse — the surviving row is `id = 81`.

## 9. Sample rows, redacted — what real values actually look like

There is exactly **one** row, so this is the whole table:

```json
{
  "id": 81,
  "name": "[name]",                        // two Latin words, "Firstname Lastname"
  "phone": "+963 933 111 222",             // redacted shape: "+963 9XX XXX XXX"
  "note": null,
  "loyalty_points": 0,
  "created_at": "2026-08-24T18:39:18.933Z",
  "updated_at": "2026-08-24T18:39:18.933Z",
  "address": null,
  "city": "Aleppo",
  "source": "in-store",
  "archived": 0,
  "demo": 0
}
```

**What this tells you about search design — and what it cannot tell you.**

- **Phone format observed: `+963 933 111 222`** — E.164 country code, a leading `+`, and
  **space-separated groups**. It is stored exactly as typed; nothing normalises it (§20).
- The `deliveries` table carries two more phone numbers in the same shape (`+963 9XX XXX XXX`), and
  two rows where `phone` is `NULL`.
- The new-customer form's placeholder actively teaches this format:
  `placeholder="+963 9__ ___ ___"` ([app-warehouse.js:229](js/app-warehouse.js#L229)).
- **The name is Latin script.** `city` is the Latin string `"Aleppo"`, seeded from
  `config['shop.city'] = 'Aleppo'` and pre-filled into the form
  ([app-warehouse.js:231](js/app-warehouse.js#L231)).

**Honest limits of this sample — please read this before designing search on it:**

1. **One row is not a distribution.** I cannot tell you from data whether the shop will type Arabic
   names, Latin names, or both. What I *can* tell you is that **nothing in the code prevents Arabic**
   — `name` is plain `TEXT`, the form is a plain text input with no pattern, and the POS search
   explicitly branches on Arabic letters (`/[a-z؀-ۿ]/`, [pos.js:1472](js/pos.js#L1472)), which is
   direct evidence that somebody expected Arabic names to be typed.
2. **`09...` local format is expected but unattested here.** `js/whatsapp.js` contains an explicit
   conversion for it — so somebody anticipated it — but no row in this database uses it:

```js:js/whatsapp.js:18-26
  /* wa.me wants digits only — no +, no spaces, no dashes. A Syrian number
     stored as "+963 933 447 210" has to become "963933447210" or the link
     opens WhatsApp on a blank chat, which looks like the feature is broken. */
  function digits(phone) {
    var d = String(phone || '').replace(/[^\d]/g, '');
    /* Local 09xx xxx xxx -> drop the leading 0, prepend the country code. */
    if (d.indexOf('0') === 0 && d.length === 10) d = '963' + d.slice(1);
    return d;
  }
```

   So **two formats are live in the codebase's assumptions (`+963 9XX XXX XXX` and `09XX XXX XXX`)
   and only the first appears in data.** Search must handle both, and the safest reading is that the
   shop will produce *inconsistent* input, because nothing anywhere enforces either (§19, §20).

3. Because the sample is one row, treat "phone is always `+963`-prefixed" as an **assumption, not a
   finding**. §41 turns this into a question for the owner.

## 10. Every other table that references `customers`

A repo-wide grep for `customer_id`:

```
js/data.js:2311                     customerId: s.customer_id,
server/lib/customers.js:15,35,40,41,42,61
server/lib/deliveries.js:143,175,179,186
server/lib/printing.js:51,68,71
server/lib/sales.js:305
server/migrations/001_init.sql:201  customer_id   INTEGER REFERENCES customers(id),
server/migrations/001_init.sql:222  CREATE INDEX sales_customer ON sales (customer_id);
server/scripts/supabase-sync.js:594 (a comment about FK ordering)
server/supabase/001_mirror_schema.sql:216,238
```

**There is exactly ONE foreign key to `customers` in the whole schema.**

| Table | Column | FK | `ON DELETE` behaviour |
|---|---|---|---|
| `sales` | `customer_id` | `INTEGER REFERENCES customers(id)` | **None declared** — defaults to `NO ACTION`. With `foreign_keys = ON`, a `DELETE FROM customers` where a sale references the row is **refused**. |

Tables that hold customer-shaped data but are **not** foreign-keyed to `customers`:

| Table | Column | Relationship |
|---|---|---|
| `sales` | `customer_name TEXT` | denormalised snapshot, deliberately (`001_init.sql:202-203`) |
| `deliveries` | `address`, `phone` | copied at assignment, deliberately not joined (`004_deliveries.sql:42-44`) |
| `print_jobs` | `customer TEXT NOT NULL`, `phone TEXT` | **a free-text name, not an FK** (`015_partner.sql:76-77`) |
| `wa_messages` | `phone TEXT NOT NULL` | matched by phone string only |
| `debt_payments` | — | reaches a customer only via `sale_id → sales.customer_id` |

The FK ordering is documented on the sync side:

```js:server/scripts/supabase-sync.js:594
   before sales (sales.customer_id); sales before deliveries
```

## 11. Verbatim schema for the nine named tables

All read from `sqlite_master` on the live database.

### `sales`

```sql
CREATE TABLE sales (
  id            TEXT PRIMARY KEY,       -- 'INV-2101'
  at            TEXT NOT NULL,
  customer_id   INTEGER REFERENCES customers(id),
  customer_name TEXT,                   -- denormalised: a receipt is a record
                                        -- of that moment, not a live join
  cashier_id    INTEGER REFERENCES users(id),
  wh_id         TEXT NOT NULL REFERENCES warehouses(id),
  payment       TEXT NOT NULL,
  -- Totals are settled into ONE currency at the till so a receipt has a single
  -- number on it, even when the basket mixes USD and lira goods.
  currency      TEXT NOT NULL REFERENCES currencies(code),
  subtotal      INTEGER NOT NULL,
  discount      INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL,
  -- The rate used, frozen. Without this, re-running last month's profit after
  -- the rate moves gives a different answer, and nobody can tell which is real.
  fx_rate       REAL NOT NULL,
  fx_base       TEXT NOT NULL,
  voided        INTEGER NOT NULL DEFAULT 0,
  void_reason   TEXT,
  created_at    TEXT NOT NULL
, public_token TEXT, points_used INTEGER NOT NULL DEFAULT 0, points_earned INTEGER NOT NULL DEFAULT 0, txn_ref TEXT, shift_id TEXT)
```

(The trailing run of columns is how SQLite renders `ALTER TABLE ... ADD COLUMN` from migrations
006, 007, 009 and 014.)

### `sale_items`

```sql
CREATE TABLE sale_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  sku            TEXT NOT NULL,
  product_id     INTEGER,
  name           TEXT NOT NULL,         -- as it read on the day
  size           TEXT,
  qty            INTEGER NOT NULL,
  -- Both the price as charged and what it cost, in the SALE's currency, so
  -- margin is arithmetic on one currency rather than a re-conversion later.
  unit_price     INTEGER NOT NULL,
  unit_cost      INTEGER NOT NULL,
  src_currency   TEXT NOT NULL REFERENCES currencies(code),
  src_unit_price INTEGER NOT NULL       -- price as listed on the product
)
```

### `debt_payments`

```sql
CREATE TABLE debt_payments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  --  A real FK here, unlike sales.shift_id: a payment against a sale that
  --  does not exist is not a payment. Sales are restored before this table
  --  in every path, so the ordering holds.
  sale_id   TEXT    NOT NULL REFERENCES sales(id),
  at        TEXT    NOT NULL,
  amount    INTEGER NOT NULL CHECK (amount > 0),
  currency  TEXT    NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  method    TEXT    NOT NULL DEFAULT 'cash',
  shift_id  TEXT,
  note      TEXT,
  user_id   INTEGER REFERENCES users(id)
)
```

**Note: `debt_payments` has no `customer_id`.** A payment attaches to a *sale*, never to a person.

### `deliveries`

```sql
CREATE TABLE deliveries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     TEXT NOT NULL REFERENCES sales(id),
  driver_id   INTEGER REFERENCES users(id),

  -- waiting   : assigned to nobody yet, or assigned but still in the shop
  -- out       : the driver has it and has left
  -- delivered : handed over
  -- failed    : came back undelivered, with a reason
  status      TEXT NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting','out','delivered','failed')),

  -- Copied, not joined. A delivery note is a record of what he was told that
  -- morning; editing the customer later must not rewrite where he was sent.
  address     TEXT NOT NULL,
  phone       TEXT,
  note        TEXT,

  -- What he must come back with. Zero for an order already paid in the shop.
  to_collect  INTEGER NOT NULL DEFAULT 0,
  collected   INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL REFERENCES currencies(code),

  assigned_at TEXT NOT NULL,
  assigned_by INTEGER REFERENCES users(id),
  out_at      TEXT,
  closed_at   TEXT,
  fail_reason TEXT,

  -- A sale goes out once. Two delivery rows for one invoice means two drivers
  -- turning up at the same door, or the same money counted twice at the close.
  UNIQUE (sale_id)
)
```

### `applied_ops`

```sql
CREATE TABLE applied_ops (
  op_id      TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  kind       TEXT NOT NULL,
  result     TEXT                       -- JSON, replayed verbatim on retry
)
```

### `change_log`

```sql
CREATE TABLE change_log (
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,
  tbl       TEXT NOT NULL,
  row_id    TEXT NOT NULL,
  op        TEXT NOT NULL CHECK (op IN ('insert','update','delete')),
  user_id   INTEGER REFERENCES users(id),
  -- Which device produced it, so a client can skip echoes of its own writes
  -- instead of applying them twice.
  origin    TEXT
)
```

### `notification_reads`

```sql
CREATE TABLE notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT    NOT NULL,
  read_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, key)
)
```

### `clubs`

```sql
CREATE TABLE clubs (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_ar    TEXT,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL
)
```

### `wa_messages`

```sql
CREATE TABLE wa_messages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT    NOT NULL,
  phone    TEXT    NOT NULL,
  body     TEXT    NOT NULL,
  kind     TEXT,
  ref_type TEXT,
  ref_id   TEXT,
  user_id  INTEGER REFERENCES users(id)
)
```

None of the nine is `NOT FOUND`.

## 12. `sales`: money columns, frozen rate, payment values, and how debt is represented

### Which columns hold the money and the frozen rate

| Column | Meaning |
|---|---|
| `currency TEXT NOT NULL REFERENCES currencies(code)` | the single currency the basket was settled into |
| `subtotal INTEGER NOT NULL` | integer minor units, in `currency` |
| `discount INTEGER NOT NULL DEFAULT 0` | integer minor units, in `currency` |
| `total INTEGER NOT NULL` | integer minor units, in `currency` |
| **`fx_rate REAL NOT NULL`** | **the frozen exchange rate** |
| **`fx_base TEXT NOT NULL`** | which currency the rate is *against* (observed: `'USD'`) |
| `points_used INTEGER NOT NULL DEFAULT 0` | points redeemed on this sale |
| `points_earned INTEGER NOT NULL DEFAULT 0` | points this sale paid out |

Live values confirm the pairing: every row is `currency='SYP'`, `fx_rate=130`, `fx_base='USD'`.
`fx_rate` is a `REAL` — the one non-integer money-adjacent column, deliberately.

### Possible values of `payment` — from the code that writes it, not the column type

The column is bare `TEXT` with **no `CHECK` constraint**. The authoritative list is in the browser:

```js:js/data.js:343-360
/* `credit` is الدين — sold now, paid later. It is a payment METHOD because
   that is how it is recorded at the till, but it is the only one that creates
   a receivable instead of money. */
var PAYMENT_METHODS = ['cash', 'sham', 'fuad', 'haram', 'card', 'cod', 'credit'];
var PAYMENT_LABELS = {
  cash: 'Cash', sham: 'Sham Cash', fuad: 'Fuad', haram: 'Haram', card: 'Card',
  cod: 'Cash on delivery', credit: 'On credit'
};

/* These print on the customer's receipt, so they cannot stay English-only:
   an Arabic receipt reading "طريقة الدفع … Cash" is the one word on the page
   that says nobody finished the job. The transfer services keep their own
   names — Sham Cash and Al-Haram are brands, and that is what the sign in
   their window says. */
var PAYMENT_LABELS_AR = {
  cash: 'نقداً', sham: 'شام كاش', fuad: 'فؤاد', haram: 'الهرم', card: 'بطاقة',
  cod: 'الدفع عند الاستلام', credit: 'على الحساب'
};
```

Which of those put paper in the till:

```js:js/data.js:362-366
/* WHICH METHODS PUT PAPER IN THE DRAWER.
   This single list is the reason a shift close is worth anything. Sham Cash,
   Fuad and card all settle into an account, not the box under the counter —
   counting them would make the drawer look right while it was short. */
var DRAWER_METHODS = ['cash', 'cod'];
```

**The server does not validate the string.** It only defaults it:

```js:server/lib/sales.js:309-312
    ).run(saleId, at, cust ? cust.id : null, cust ? cust.name : null,
          userId ?? null, whId, payment || 'cash',
          settle, subtotal, disc, total, rate, base, at, token, wantPoints,
          earnedForRow, ref, openShift ? openShift.id : null);
```

Observed in data: `cash` (5 rows) and `cod` (3 rows). **No `credit` sale exists on this machine.**

### How an unpaid or partially-paid sale is represented

**There is no `paid`, `outstanding` or `due` column anywhere.** Debt is entirely derived, and it is
derived from **two** facts: `payment = 'credit'`, and the sum of `debt_payments` against that sale.

Server side, verbatim:

```js:server/lib/money.js:200-231
/* ---------------------------------------------------------------- debts */

/* Every credit sale still carrying a balance — regardless of how far back it
   goes. The screens read the debt book out of the recent-sales list, which is
   capped; a debt that ages past the cap would silently stop being owed. */
export function openDebts() {
  const d = DB.get();
  return d.prepare(
    `SELECT s.*, COALESCE((SELECT SUM(amount) FROM debt_payments p
                            WHERE p.sale_id = s.id), 0) AS paid
       FROM sales s
      WHERE s.payment = 'credit' AND s.voided = 0
      ORDER BY s.created_at DESC`
  ).all().map((s) => ({ ...s, balance: s.total - s.paid })).filter((s) => s.balance > 0);
}

export function debtPayments({ saleId = null, limit = 200 } = {}) {
  const d = DB.get();
  return saleId
    ? d.prepare('SELECT * FROM debt_payments WHERE sale_id = ? ORDER BY at').all(saleId)
    : d.prepare('SELECT * FROM debt_payments ORDER BY at DESC LIMIT ?').all(limit);
}

export function balanceOf(d, saleId) {
  const s = d.prepare('SELECT total, voided FROM sales WHERE id = ?').get(saleId);
  if (!s) throw fail('no such sale', 'not_found');
  if (s.voided) throw fail('that sale was voided', 'voided');
  const paid = d.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS n FROM debt_payments WHERE sale_id = ?'
  ).get(saleId).n;
  return Math.max(0, s.total - paid);
}
```

Browser side, the same arithmetic:

```js:js/data.js:1678-1711
  /* ---- the debt book, الدين ----------------------------------------------
     Derived from credit sales rather than stored separately, so a debt can
     never disagree with the sale that created it. */

  debtPaid: function (saleId) {
    return debtPayments.reduce(function (a, p) {
      return p.saleId === saleId ? a + p.amount : a;
    }, 0);
  },

  debtBalance: function (sale) {
    return Math.max(0, sale.total - DB.debtPaid(sale.id));
  },

  debts: function () {
    return sales
      .filter(function (s) { return s.payment === 'credit' && DB.debtBalance(s) > 0; })
      .map(function (s) {
        return {
          sale: s,
          customer: s.customerId ? DB.customer(s.customerId) : null,
          name: s.customerName,
          total: s.total,
          paid: DB.debtPaid(s.id),
          balance: DB.debtBalance(s),
          age: DB.daysSince(s.date)
        };
      })
      .sort(function (a, b) { return b.age - a.age; });
  },

  debtTotal: function () {
    return DB.debts().reduce(function (a, d) { return a + d.balance; }, 0);
  },
```

**Three consequences for the Customers screen, and they are the important ones:**

1. **Debt is per-SALE, not per-CUSTOMER.** To show "what this person owes" you must aggregate
   `openDebts()` by `customer_id` yourself. Nothing does that today.
2. **A `cod` sale is not a debt.** Only `payment = 'credit'` is. `cod` money is owed by the *driver*,
   tracked in `deliveries.to_collect` / `collected` (§34).
3. **The debt data arrives on a different permission from the customer data.** `openDebts()` is only
   reachable through `GET /api/money`, which is `requirePerm('money.read')`
   ([server/index.js:810-812](server/index.js#L810-L812)) — and per §27 **the cashier does not have
   `money.read`.** A cashier opening a Customers screen that shows balances will get nothing, because
   `Shop.load()` never even requests the money bundle for her. This is the single biggest
   architectural constraint on the new screen.

## 13. Does `customers` carry a stored balance column?

**No. There is no balance column, and no stored total of any kind.** `loyalty_points` is the only
running figure stored on the row, and it is moved only inside `Sales.record`'s transaction or by the
deliberate manual adjustment (§15).

Everything else is **computed**, in one query, in `server/lib/customers.js`:

```js:server/lib/customers.js:21-42
/* Everything the app needs to draw the customer list, in one query.

   totalSpent / lastPurchase / visits are DERIVED, not stored. A stored total
   is a second source of truth for money that has to be kept in step with the
   sales table by hand, and the first time a sale is voided it stops agreeing.
   Voided sales are excluded here for exactly that reason. */
const SELECT = `
  SELECT c.id, c.name, c.phone, c.city, c.source, c.address, c.note,
         c.loyalty_points, c.archived, c.demo, c.created_at, c.updated_at,
         COALESCE(agg.spent,  0) AS total_spent,
         COALESCE(agg.visits, 0) AS visits,
         agg.last_at             AS last_purchase_at
    FROM customers c
    LEFT JOIN (
      SELECT customer_id,
             SUM(total)  AS spent,
             COUNT(*)    AS visits,
             MAX(at)     AS last_at
        FROM sales
       WHERE voided = 0 AND customer_id IS NOT NULL
       GROUP BY customer_id
    ) agg ON agg.customer_id = c.id`;
```

**This query has a live currency bug — flagged in full in §38.1.** `SUM(total)` adds integer minor
units across rows without regard to `sales.currency`. Today every sale is `SYP`, so it is correct by
accident; a single USD sale makes `total_spent` a meaningless mixture of cents and lira.

---


---

# Part 3 — The server

## 14. Every route in `server/index.js` whose path contains `customer`

There are **five**, all in one block. Full handler bodies verbatim, including the section comment:

```js:server/index.js:583-635
/* --- customers --------------------------------------------------------------
   `customer.*` is in FORBIDDEN for the partner role in lib/auth.js, so Yalla
   Wear cannot be granted these however the tick boxes are set. They are a
   different company; the shop's customer list is not theirs to hold. */

router.add('GET /api/customers', requirePerm('customer.read', (ctx) => {
  sendOk(ctx.res, {
    customers: Customers.list({
      includeArchived: Auth.can(ctx.user, 'customer.write')
    })
  });
}));

router.add('GET /api/customers/:id/history', requirePerm('customer.read', (ctx) => {
  const c = Customers.byId(Number(ctx.params.id));
  if (!c) return sendError(ctx.res, 404, 'not_found', 'No such customer.');
  sendOk(ctx.res, { sales: Customers.historyFor(c.id).map(s => scrubCost(s, ctx.user)) });
}));

router.add('POST /api/customers', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { customer: Customers.create(b, ctx.user.id) });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

router.add('PATCH /api/customers/:id', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, { customer: Customers.update(Number(ctx.params.id), b, ctx.user.id) });
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));

/* A deliberate correction to a balance, by hand. Selling and redeeming move
   points through the sale, never through here — that is why this needs
   `customer.write` and says who did it in the change log. */
router.add('POST /api/customers/:id/points', requirePerm('customer.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, Customers.adjustPoints(Number(ctx.params.id), b.delta, {
      reason: b.reason, userId: ctx.user.id
    }));
  } catch (e) {
    if (e.code === 'not_enough_points') {
      return sendError(ctx.res, 409, 'not_enough_points', e.message);
    }
    sendError(ctx.res, 400, 'invalid', e.message);
  }
}));
```

Summary table:

| Method | Path | `requirePerm` | Notes |
|---|---|---|---|
| GET | `/api/customers` | `customer.read` | archived rows included **only if the caller also has `customer.write`** |
| GET | `/api/customers/:id/history` | `customer.read` | **no frontend caller exists** (§39) |
| POST | `/api/customers` | `customer.write` | all failures collapse to `400 invalid` |
| PATCH | `/api/customers/:id` | `customer.write` | archive/restore happens through here |
| POST | `/api/customers/:id/points` | `customer.write` | `409 not_enough_points` is the one typed error |

**There is no `DELETE /api/customers/:id`.** That is deliberate (§15).

The import is at the top:

```js:server/index.js:32
import * as Customers from './lib/customers.js';
```

## 15. `server/lib/customers.js` — full file

It exists, at 164 lines. Verbatim, in full:

```js:server/lib/customers.js:1-164
/* ==========================================================================
   OG SYSTEM — customers
   --------------------------------------------------------------------------
   The people the shop knows by name. Small table, but it is the one that
   decides whether the loyalty scheme is a real promise or a number on a
   screen, so two rules are load-bearing:

   POINTS ARE NEVER WRITTEN FROM HERE ON A SALE. `Sales.record` earns and
   redeems them inside the same transaction as the invoice, because a balance
   that can move independently of the sales that moved it cannot be audited.
   `adjustPoints` below exists for the manager's deliberate correction — a
   goodwill gesture, a mistake being put right — and it says so in the trail.

   CUSTOMERS ARE ARCHIVED, NEVER DELETED. Every past sale carries a
   customer_id. Deleting the row leaves invoices pointing at nobody, and the
   shop loses the ability to answer "who bought this" about its own history.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';

/* Everything the app needs to draw the customer list, in one query.

   totalSpent / lastPurchase / visits are DERIVED, not stored. A stored total
   is a second source of truth for money that has to be kept in step with the
   sales table by hand, and the first time a sale is voided it stops agreeing.
   Voided sales are excluded here for exactly that reason. */
const SELECT = `
  SELECT c.id, c.name, c.phone, c.city, c.source, c.address, c.note,
         c.loyalty_points, c.archived, c.demo, c.created_at, c.updated_at,
         COALESCE(agg.spent,  0) AS total_spent,
         COALESCE(agg.visits, 0) AS visits,
         agg.last_at             AS last_purchase_at
    FROM customers c
    LEFT JOIN (
      SELECT customer_id,
             SUM(total)  AS spent,
             COUNT(*)    AS visits,
             MAX(at)     AS last_at
        FROM sales
       WHERE voided = 0 AND customer_id IS NOT NULL
       GROUP BY customer_id
    ) agg ON agg.customer_id = c.id`;

export function list({ includeArchived = false } = {}) {
  return get().prepare(
    `${SELECT} ${includeArchived ? '' : 'WHERE c.archived = 0'} ORDER BY c.name`
  ).all();
}

export function byId(id) {
  return get().prepare(`${SELECT} WHERE c.id = ?`).get(id) ?? null;
}

/* The invoice ids, newest first. Loaded per customer rather than joined into
   the list above — forty customers with a hundred sales each is a lot of rows
   to build a screen that shows one of them. */
export function historyFor(id, limit = 50) {
  return get().prepare(
    `SELECT id, at, total, currency, payment, voided
       FROM sales
      WHERE customer_id = ?
      ORDER BY at DESC, id DESC
      LIMIT ?`
  ).all(id, limit);
}

/* ------------------------------------------------------------------ writing */

const FIELDS = ['name', 'phone', 'city', 'source', 'address', 'note'];

function clean(fields) {
  const out = {};
  for (const k of FIELDS) {
    if (fields[k] === undefined) continue;
    const v = fields[k];
    out[k] = (v === null || v === '') ? null : String(v).trim();
  }
  return out;
}

export function create(fields, userId, { demo = false } = {}) {
  const f = clean(fields);
  if (!f.name) throw new Error('a customer needs a name');

  return tx((d) => {
    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO customers
         (name, phone, city, source, address, note, loyalty_points,
          archived, demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
    ).run(f.name, f.phone ?? null, f.city ?? null, f.source ?? 'in-store',
          f.address ?? null, f.note ?? null, demo ? 1 : 0, at, at);

    const id = Number(info.lastInsertRowid);
    logChange('customers', id, 'insert', userId, null);
    return byId(id);
  });
}

export function update(id, fields, userId) {
  const f = clean(fields);

  /* `archived` is not in FIELDS because it is a flag, not text, and letting it
     through the same path would make an empty string archive somebody. */
  if (fields.archived !== undefined) f.archived = fields.archived ? 1 : 0;

  const keys = Object.keys(f);
  if (!keys.length) throw new Error('nothing to update');
  if (f.name === null) throw new Error('a customer needs a name');

  return tx((d) => {
    const args = keys.map(k => f[k]);
    args.push(nowIso(), id);

    const info = d.prepare(
      `UPDATE customers SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ?
        WHERE id = ?`
    ).run(...args);

    if (info.changes === 0) throw new Error('no such customer');
    logChange('customers', id, 'update', userId, null);
    return byId(id);
  });
}

export function archive(id, userId) {
  return update(id, { archived: 1 }, userId);
}

/* A manager moving someone's balance by hand.

   Separate from the sale path on purpose. The reason is written into the
   movement so that a balance which does not match the customer's purchases can
   still be explained a year later — "+250, goodwill, by Hussam" is an answer;
   a number that changed on its own is not.

   Refuses to take a balance negative rather than clamping, because a clamp
   quietly turns "take 500 off" into "take 300 off" and nobody is told. */
export function adjustPoints(id, delta, { reason, userId }) {
  const n = Math.round(Number(delta) || 0);
  if (!n) throw new Error('the adjustment is zero');

  return tx((d) => {
    const row = d.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(id);
    if (!row) throw new Error('no such customer');

    const after = row.loyalty_points + n;
    if (after < 0) {
      const e = new Error(
        `That would leave ${after} points. They have ${row.loyalty_points}.`);
      e.code = 'not_enough_points';
      throw e;
    }

    d.prepare('UPDATE customers SET loyalty_points = ?, updated_at = ? WHERE id = ?')
     .run(after, nowIso(), id);

    logChange('customers', id, 'update', userId,
              `points ${n > 0 ? '+' : ''}${n}${reason ? ': ' + reason : ''}`);

    return { id, before: row.loyalty_points, after, delta: n };
  });
}
```

**`export function archive(id, userId)` has zero callers** anywhere in `server/` — a grep for
`Customers.archive` returns nothing. Archiving happens by `PATCH` with `{ archived: 1 }` instead
(§39).

Two other writers touch `customers` outside this module, and both matter:

- **`server/lib/sales.js`** moves `loyalty_points` inside the sale transaction (quoted in §38).
- **`server/lib/deliveries.js`** writes `customers.address` on assignment (§34).

## 16. `server/lib/money.js` — the debt-payment path, verbatim

The module header states the three guards up front:

```js:server/lib/money.js:1-31
/* ============================================================================
   THE DRAWER                                                     [money.js]
   ----------------------------------------------------------------------------
   Shifts, expenses, and customers paying down what they owe.

   All three used to live in the browser. A shift opened, expenses were
   recorded against it, somebody settled a debt across the counter — and a
   refresh threw the lot away. The debt repayment is the one that mattered:
   real cash from a real person, written down nowhere.

   They are one module because they are one arithmetic. A shift's expected
   figure is the drawer's takings, PLUS what was collected against old debts
   during it, MINUS the cash paid out of it. Split across three files and that
   sum has to live in whichever one imports the other two.

   THREE GUARDS, ALL INSIDE THE TRANSACTION
   ----------------------------------------
   Money in is the one direction that cannot be corrected by doing it again,
   so paying a debt carries all three:

     1. Idempotent on the caller's opId, through the same applied_ops table a
        sale uses. A manager taps Save, the wifi stalls, they tap again — and
        a customer's debt must not clear twice on one payment.

     2. The balance is recomputed here, not trusted from the browser. Two
        devices settling the same debt both pass a check made on screen.

     3. A voided sale takes no payments, and a sale with payments cannot be
        voided. Otherwise half a settled debt vanishes from every report while
        the cash is still in the box.
   ========================================================================== */
```

The function that records a payment, complete:

```js:server/lib/money.js:233-285
export function payDebt({ saleId, amount, method = 'cash', note = null,
                          currency = null, opId = null, userId = null }) {
  if (!(amount > 0)) throw fail('a payment has to be more than nothing', 'bad_request');

  return DB.tx(() => {
    const d = DB.get();
    const base = checkCurrency(d, currency);

    /* The same applied_ops table a sale uses. A till that loses wifi mid
       request does not know whether the payment landed; replaying the same
       opId returns what was recorded rather than taking the money twice. */
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return JSON.parse(seen.result);
    }

    /* Recomputed inside the transaction. Checked on screen it is only a
       courtesy — two devices settling the same debt both pass that check. */
    const balance = balanceOf(d, saleId);
    if (balance <= 0) throw fail('that debt is already settled', 'already_settled');
    if (amount > balance) {
      throw fail(`only ${balance} is still owed on that sale`, 'overpaid');
    }

    const open = currentShift(d);
    const info = d.prepare(
      `INSERT INTO debt_payments (sale_id, at, amount, currency, method, shift_id, note, user_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(saleId, nowIso(), Math.round(amount), base, method,
          open ? open.id : null, note, userId);

    const out = {
      id: Number(info.lastInsertRowid),
      saleId, amount: Math.round(amount), method,
      balance: balance - Math.round(amount)
    };
    if (opId) {
      d.prepare('INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?,?,?,?,?)')
        .run(opId, nowIso(), userId, 'debt_payment', JSON.stringify(out));
    }

    DB.logChange('debt_payments', out.id, 'insert', userId, null);
    return out;
  });
}

/* Called by Sales.void before it voids. A credit sale the customer has
   already part-paid cannot simply be undone: the cash is in the box, and
   voiding would erase the debt it was paid against while leaving the money
   unexplained. */
export function paymentsAgainst(d, saleId) {
  return d.prepare('SELECT COUNT(*) AS n FROM debt_payments WHERE sale_id = ?').get(saleId).n;
}
```

The balance recomputation it calls (also quoted in §12):

```js:server/lib/money.js:223-231
export function balanceOf(d, saleId) {
  const s = d.prepare('SELECT total, voided FROM sales WHERE id = ?').get(saleId);
  if (!s) throw fail('no such sale', 'not_found');
  if (s.voided) throw fail('that sale was voided', 'voided');
  const paid = d.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS n FROM debt_payments WHERE sale_id = ?'
  ).get(saleId).n;
  return Math.max(0, s.total - paid);
}
```

The bundle the browser receives:

```js:server/lib/money.js:287-300
/* ------------------------------------------------------------ the bundle */

export function all() {
  const d = DB.get();
  const open = currentShift(d);
  return {
    shifts: shifts({ limit: 60 }),
    currentShift: open ? shift(open.id) : null,
    expenses: expenses({ limit: 200 }),
    debtPayments: debtPayments({ limit: 200 }),
    creditSales: openDebts(),
    categories: categories(d)
  };
}
```

The routes, and the status-code mapping:

```js:server/index.js:810-820
router.add('GET /api/money', requirePerm('money.read', (ctx) => {
  sendOk(ctx.res, Money.all());
}));

function moneyFail(res, e) {
  const status = e.code === 'not_found' ? 404
               : ['already_open', 'already_closed', 'already_settled',
                  'overpaid', 'voided', 'bad_status'].includes(e.code) ? 409
               : 400;
  sendError(res, status, e.code || 'invalid', e.message);
}
```

```js:server/index.js:866-880
/* Money in, and the one direction that cannot be corrected by doing it
   again — so it carries an opId, exactly like a sale. */
router.add('POST /api/debt-payments', requirePerm('money.write', async (ctx) => {
  const b = await readJson(ctx.req);
  try {
    sendOk(ctx.res, {
      payment: Money.payDebt({
        saleId: b.saleId, amount: Number(b.amount), method: b.method,
        note: b.note || null, currency: b.currency || null,
        opId: typeof b.opId === 'string' ? b.opId : null,
        userId: ctx.user.id
      })
    });
  } catch (e) { moneyFail(ctx.res, e); }
}));
```

**Note `Money.all()` output is NOT passed through `scrubCost`.** `openDebts()` does `SELECT s.*`,
which returns full sale header rows — but sale *headers* carry no key in `COST_KEYS` (§17), so
nothing leaks today. It would leak the moment a cost column is added to `sales`.

## 17. `scrubCost` and `COST_KEYS`, verbatim

```js:server/index.js:1421-1460
/* Remove cost and margin for anyone without `cost.read`.

   The permission table already says a cashier cannot see cost. That promise is
   only real if the numbers never leave the server — hiding a column in the UI
   is not a boundary when the browser can read the response. */
/* Every key that says what something cost us or what we made on it.

   Listed by name rather than matched on a pattern, because a pattern that
   catches `cost_price` also catches `costume` one day and silently deletes a
   product field. The trade is that a NEW cost column has to be added here —
   which is why the list is short, obvious, and sits next to the function that
   uses it rather than three files away. */
const COST_KEYS = [
  'cost_price', 'costPrice',
  'unit_cost', 'unitCost',
  /* A print job's cost is what the OTHER company charges to make it. It is
     the shop's margin on every shirt, and a cashier who can schedule a job
     has no business seeing it. */
  'cost',
  'profit', 'margin'
];

function stripCost(row) {
  const out = { ...row };
  for (const k of COST_KEYS) delete out[k];
  return out;
}

function scrubCost(row, user) {
  if (Auth.can(user, 'cost.read')) return row;

  const out = stripCost(row);

  /* A sale carries its cost in the lines, not the header, so scrubbing only
     the top level would hand a cashier every unit_cost in the basket. */
  if (Array.isArray(out.variants)) out.variants = out.variants.map(stripCost);
  if (Array.isArray(out.items))    out.items    = out.items.map(stripCost);

  return out;
}
```

**Does anything customer-shaped pass through it?**

One call site, and it is currently a **no-op**:

```js:server/index.js:599
  sendOk(ctx.res, { sales: Customers.historyFor(c.id).map(s => scrubCost(s, ctx.user)) });
```

`historyFor` selects `id, at, total, currency, payment, voided` — **not one of those is in
`COST_KEYS`**, and there is no nested `items` or `variants` array, so `scrubCost` strips nothing.
It is defensive scaffolding, correctly placed, doing nothing yet. If the new screen extends
`historyFor` to include line items (which it plausibly will, to show "what they bought"), **that
`scrubCost` call becomes load-bearing** and the nested-`items` branch starts doing real work.

**`GET /api/customers` itself is not scrubbed** — correctly, since no customer column is a cost.

The other 13 `scrubCost` call sites, for reference:

```
server/index.js:355   catalogue products
server/index.js:362   scan hit (variant)
server/index.js:599   customer history      <-- the only customer one
server/index.js:668   POST /api/sales response
server/index.js:704   GET /api/sales list
server/index.js:711   GET /api/sales/:id items
server/index.js:712   GET /api/sales/:id header
server/index.js:741   receipt payload
server/index.js:957   purchase order header
server/index.js:958   purchase order lines
server/index.js:1040  print job header
server/index.js:1041  print job lines
```

## 18. Where customer data is filtered by permission on the way out

Three distinct mechanisms.

### (a) `server/lib/auth.js` — the permission definitions

```js:server/lib/auth.js:43-51
/* --------------------------------------------------------------- permissions
   One table, read top to bottom, rather than `if (role === 'manager')` sprayed
   through the routes. Anything not listed is denied: a new endpoint is locked
   until someone deliberately opens it, which is the right default.

   The rule that matters commercially: a cashier must not see cost or profit.
   They handle customers and they handle cash, and margin is not theirs to
   know. `partner` is Yalla Wear — remote, outside the company, and must never
   reach a customer name, a phone number, or what OG charged for the job. */
```

```js:server/lib/auth.js:70-71
  { perm: 'customer.read',   group: 'customers', label: 'See customers' },
  { perm: 'customer.write',  group: 'customers', label: 'Add and edit customers' },
```

```js:server/lib/auth.js:107-126
/* Yalla Wear is a different company. These can never be granted to them, no
   matter what the grid says. One mis-clicked box should not be able to hand a
   supplier your customer list and your margins.

   `delivery.*` is on the list for the same reason as `customer.*`, and it is
   easy to miss why: a delivery row carries a customer's name, phone number and
   home address. It is the most personal data in the system. */
const FORBIDDEN = {
  partner: (p) =>
    p === 'customer.read' || p === 'customer.write' ||
    p === 'cost.read' || p === 'profit.read' ||
    p.startsWith('money.') || p.startsWith('staff.') ||
    p.startsWith('delivery.') || p === 'discount.unlimited' ||
    /* A receipt payload carries the customer's name and phone number, so
       this follows customer.* rather than sitting on its own. */
    p === 'sale.reprint' ||
    /* Label printing drives hardware sitting in the shop, keyed to a
       station name a partner has no business addressing. */
    p === 'label.print'
};
```

The belt-and-braces enforcement in the cache builder:

```js:server/lib/auth.js:157-169
  /* Belt and braces. If a row somehow says a partner may read customers —
     hand-edited database, a migration written in a hurry — it is dropped here
     rather than honoured. The boundary should not depend on the data being
     right. */
  for (const role of Object.keys(permCache)) {
    for (const p of [...permCache[role]]) {
      if (isForbidden(role, p)) permCache[role].delete(p);
    }
    for (const p of (PINNED[role] || [])) permCache[role].add(p);
  }

  return permCache;
}
```

### (b) The archived-rows gate on the list route

```js:server/index.js:588-594
router.add('GET /api/customers', requirePerm('customer.read', (ctx) => {
  sendOk(ctx.res, {
    customers: Customers.list({
      includeArchived: Auth.can(ctx.user, 'customer.write')
    })
  });
}));
```

**This is a second, finer permission check on the same route** — `customer.read` gets you the list,
`customer.write` additionally gets you archived people. The consequence is documented in `pos.js`,
which has to filter them out again in the browser:

```js:js/pos.js:1451-1456
  function custMatches(q) {
    q = String(q || '').trim().toLowerCase();
    /* Archived people are off the books; the till must not offer them. The
       server sends them to anyone with customer.write — which a cashier has,
       because she adds customers here — so filtering has to happen here. */
    var list = DB.customers.filter(function (c) { return !c.archived; });
```

### (c) The browser never asks for what it may not have

```js:js/shop.js:38-55
  /* Ask only for what this account is allowed to have.

     Not an optimisation — or not only. Requesting a list the role cannot read
     gets a correct 403, and the browser logs every one of them as a failed
     request. Four of those on every single load is console noise that hides
     the errors somebody actually needs to see. The warehouse man has no
     business with the customer list; the honest thing is not to ask.

     `soft` stays underneath as the backstop. Auth.can() is the browser's
     opinion and the server's answer is the real one, so a disagreement must
     end in an empty list rather than a dead app. */
  function may(perm) {
    return typeof Auth === 'undefined' || Auth.can(perm);
  }

  function want(perm, path, empty) {
    return may(perm) ? soft(API.get(path), empty) : Promise.resolve(empty);
  }
```

```js:js/shop.js:67
    customers: function () { return want('customer.read', '/api/customers', { customers: [] }); },
```

**And the sharpest one — the global search box, which reaches customer phone numbers from every
screen in the app:**

```js:js/app-shell.js:469-486
  /* One search box that reaches three tables, so it needs all three
     permissions asked separately. This is the easiest place in the app to
     leak a customer's phone number to someone who cannot open the Customers
     screen — the box is on every page and it does not look like a screen. */
  var prods = !allow('product.read') ? [] : DB.products.filter(function (p) {
    return p.name.toLowerCase().indexOf(q) > -1 || p.brand.toLowerCase().indexOf(q) > -1;
  }).slice(0, 5);

  var custs = !allow('customer.read') ? [] : DB.customers.filter(function (c) {
    return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1;
  }).slice(0, 4);

  /* `sell` and not `report.read`: a cashier has to be able to pull up the
     invoice she wrote ten minutes ago to take a refund against it. Gating
     this on Reports would break the refund she is allowed to give. */
  var invs = !(allow('sell') || allow('report.read')) ? [] : DB.sales.filter(function (s) {
    return s.id.toLowerCase().indexOf(q) > -1;
  }).slice(0, 3);
```

Finally, the partner route leaves customer-shaped fields out of the response rather than hiding them
in the browser:

```js:server/index.js:1015
router.add('GET /api/partner', requirePerm(['print.read', 'partner.jobs'], (ctx) => {
```

## 19. Validation on customer writes — what is actually checked

**This is the section to read carefully, because the honest answer is "almost nothing."**

The entire server-side validation for a customer write is these two functions:

```js:server/lib/customers.js:69-83
const FIELDS = ['name', 'phone', 'city', 'source', 'address', 'note'];

function clean(fields) {
  const out = {};
  for (const k of FIELDS) {
    if (fields[k] === undefined) continue;
    const v = fields[k];
    out[k] = (v === null || v === '') ? null : String(v).trim();
  }
  return out;
}

export function create(fields, userId, { demo = false } = {}) {
  const f = clean(fields);
  if (!f.name) throw new Error('a customer needs a name');
```

plus, on update:

```js:server/lib/customers.js:101-110
export function update(id, fields, userId) {
  const f = clean(fields);

  /* `archived` is not in FIELDS because it is a flag, not text, and letting it
     through the same path would make an empty string archive somebody. */
  if (fields.archived !== undefined) f.archived = fields.archived ? 1 : 0;

  const keys = Object.keys(f);
  if (!keys.length) throw new Error('nothing to update');
  if (f.name === null) throw new Error('a customer needs a name');
```

Checked, exhaustively:

| Check | Present? | Where |
|---|---|---|
| Field allow-list (unknown keys dropped) | **Yes** | `FIELDS` + `clean()` |
| Whitespace trimmed | **Yes** | `String(v).trim()` |
| Empty string coerced to `NULL` | **Yes** | `clean()` |
| Name required, non-empty | **Yes** | `create` and `update` |
| `archived` kept off the text path | **Yes** | `update`, with the reason in a comment |
| **Phone format** | **NO** | — |
| **Duplicate phone** | **NO** (server) | see below |
| **Duplicate name** | **NO** (server) | see below |
| **Any length limit, on any field** | **NO** | — |
| **Arabic / script validation** | **NO** | nothing anywhere |
| **`source` restricted to a known set** | **NO** | defaults to `'in-store'`, otherwise free text |
| **`city` restricted to a known set** | **NO** | free text, despite `CITIES` existing in `js/data.js:335` |

**The duplicate check exists only in the browser, and it is not a boundary:**

```js:js/app-actions.js:765-777
    /* Same name AND same phone is a duplicate; same name alone is two people
       called Ahmad, which in Aleppo is most of them. */
    var dupe = DB.customers.filter(function (c) {
      return c.name.toLowerCase() === name.toLowerCase() &&
             (!phone || c.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    })[0];
    if (dupe) {
      closeModal();
      toast(t('cu_new'), t('cu_exists') + ' · ' + esc(dupe.name), 'warn', 5000);
      if (OG.cuOnCreated) OG.cuOnCreated(dupe);
      OG.cuOnCreated = null;
      return;
    }
```

Two problems with relying on it:

1. It runs against `DB.customers` — **the hydrated in-memory list**, a snapshot from page load. Two
   tills adding the same walk-in at the same time both pass.
2. `POST /api/customers` performs no equivalent check, and the DB indexes are not unique (§7). The
   server will happily create the duplicate.

Also note the **client-side name check produces an English/Arabic string inline rather than an I18N
key** — the only place in the customer path that does:

```js:js/app-actions.js:760-763
    if (!name) {
      toast(t('cu_new'), OG.lang === 'ar' ? 'اكتب الاسم' : 'Enter a name', 'err');
      return;
    }
```

**Error shape on failure.** Every `Customers` throw is an untyped `Error`, and both write routes
collapse them to one code:

```js:server/index.js:606-608
  } catch (e) {
    sendError(ctx.res, 400, 'invalid', e.message);
  }
```

So a new screen cannot branch on *why* a write failed — only `adjustPoints` returns a typed code
(`409 not_enough_points`). Compare the discount path, which returns `403 discount_too_big` with the
real ceiling in the message. **If the new screen wants "that phone is already on file" as a
distinguishable outcome, that is a server change, not a UI one.**

## 20. Phone-number normalisation anywhere in the codebase

Greps run: `963`, `replace(/\D`, `replace(/[^\d]`, `replace(/[^0-9]`, `e164`, `normalizePhone`,
`normalisePhone`.

**`e164`, `normalizePhone`, `normalisePhone`: NOT FOUND.**

**There is no shared phone normaliser.** There are five independent, inconsistent digit-strippers,
plus two weaker space-strippers. Every hit, verbatim:

**1. `js/whatsapp.js` — the only one that understands Syrian dialling.** This is the closest thing to
a canonical normaliser in the repo:

```js:js/whatsapp.js:18-34
  /* wa.me wants digits only — no +, no spaces, no dashes. A Syrian number
     stored as "+963 933 447 210" has to become "963933447210" or the link
     opens WhatsApp on a blank chat, which looks like the feature is broken. */
  function digits(phone) {
    var d = String(phone || '').replace(/[^\d]/g, '');
    /* Local 09xx xxx xxx -> drop the leading 0, prepend the country code. */
    if (d.indexOf('0') === 0 && d.length === 10) d = '963' + d.slice(1);
    return d;
  }

  function link(phone, text) {
    var d = digits(phone);
    if (!d) return null;
    /* encodeURIComponent, not escape: the templates are Arabic and contain
       newlines. Getting this wrong truncates the message at the first space. */
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text || '');
  }
```

**2. `js/bulk.js` — a second WhatsApp link builder that does NOT do the `09` → `963` conversion:**

```js:js/bulk.js:249
    return 'https://wa.me/' + String(phone).replace(/\D/g, '') + '?text=' + encodeURIComponent(text);
```

A locally-formatted `09...` number therefore works from the customer drawer and silently fails from
bulk actions.

**3. `js/app-actions.js` — the duplicate check strips non-digits on both sides:**

```js:js/app-actions.js:769
             (!phone || c.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
```

This compares `+963 933 111 222` (`963933111222`) against `0933 111 222` (`0933111222`) as
**different people**.

**4. `js/pos.js` — the till's phone search, digits-only on the stored side:**

```js:js/pos.js:1464-1480
    /* Two digits is enough to narrow once the list is already on screen; the
       old three-digit floor existed only because nothing showed before it.

       Only a query with no letters in it is read as a phone number. Without
       that test "Bulk Tester 59" also drags in everyone whose number happens
       to contain 59, and the cashier is handed a list of strangers under the
       name she typed. Arabic letters count as letters. */
    var digits = q.replace(/\D/g, '');
    var byPhone = digits.length >= 2 && !/[a-z؀-ۿ]/.test(q);
    return list.filter(function (c) {
      if (byPhone) {
        return String(c.phone || '').replace(/\D/g, '').indexOf(digits) > -1;
      }
      return String(c.name || '').toLowerCase().indexOf(q) > -1 ||
             String(c.city || '').toLowerCase().indexOf(q) > -1;
    });
  }
```

**5. `js/app-warehouse.js` — deciding whether typed text is a phone or a name:**

```js:js/app-warehouse.js:215-219
  var name = '', phone = '';
  /* Whatever was typed into the search that found nobody. Digits are a phone
     number, anything else is a name — she has already typed it once. */
  var seed = String(prefill || '').trim();
  if (/^[\d+\s()-]+$/.test(seed) && seed.replace(/\D/g, '').length >= 3) phone = seed;
  else name = seed;
```

**And two places that strip only spaces, not all punctuation** — these are the weakest, and one of
them is the existing Customers screen:

```js:js/app-customers-scan.js:21
      return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1 || c.city.toLowerCase().indexOf(q) > -1;
```

```js:js/app-shell.js:478
    return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1;
```

`replace(/\s/g,'')` leaves the `+` in place, so searching `963933` matches `+963 933 111 222`,
searching `+963933` also matches, and searching `0933` never will. **The existing Customers screen's
phone search is the worst of the seven.**

**Nothing on the server touches a phone number at all.** `clean()` trims the string and stores it.

One more relevant hit — the display wrapper, which is not normalisation but is mandatory for RTL:

```js:js/app-util.js:82-85
/* Phone numbers, addresses and SKUs are latin runs. In RTL the bidi algorithm
   reorders their space-separated groups ("+963 960 380 435" renders backwards),
   so isolate them with <bdi dir="ltr">. */
function tel(s) { return '<bdi dir="ltr">' + esc(s) + '</bdi>'; }
```

---

# Part 4 — The frontend as it stands

## 21. `js/data.js` — the customer collection, lookups, and the hydrate block

### The collection declaration

```js:js/data.js:333-341
/* --------------------------------------------------------------- 3. PEOPLE */

var CITIES = ['Damascus', 'Aleppo', 'Homs', 'Latakia', 'Hama', 'Tartus', 'Deir ez-Zor'];

var customers = [];

var suppliers = [];

var employees = [];
```

`CITIES` is declared but **nothing constrains `customer.city` to it** — the new-customer form uses a
free text input pre-filled from `CONFIG.SHOP_CITY` (§19).

### Exposure on `DB` and the lookups

```js:js/data.js:554-558
var DB = {
  config: CONFIG,
  products: products,
  variants: variants,
  customers: customers,
```

```js:js/data.js:614-617
  product: function (id) { return products.filter(function (p) { return p.id === id; })[0]; },
  customer: function (id) { return customers.filter(function (c) { return c.id === id; })[0]; },
  sale: function (id) { return sales.filter(function (s) { return s.id === id; })[0]; },
  variantsOf: function (pid) { return variants.filter(function (v) { return v.productId === pid; }); },
```

`DB.customer(id)` is a **linear scan with `filter`** — it walks the whole array and allocates a new
one, then takes `[0]`. Fine at one customer, a real cost in a loop at three thousand.

### The customer-derived helpers

```js:js/data.js:1394-1402
  inactiveCustomers: function (days) {
    return customers.filter(function (c) { return DB.daysSince(c.lastPurchaseDate) >= (days || 90); });
  },

  tier: function (points) {
    if (points >= CONFIG.TIER_GOLD) return 'gold';
    if (points >= CONFIG.TIER_SILVER) return 'silver';
    return 'bronze';
  },
```

```js:js/data.js:806
  daysSince: function (d) { return Math.round((TODAY - new Date(d).setHours(0, 0, 0, 0)) / 86400000); },
```

**`daysSince(null)` does not return `null` or `NaN` — it returns ~20,700.** `new Date(null)` is the
Unix epoch, not an invalid date. Every customer who has never bought anything is therefore
"56 years since last purchase", which is `>= 90`, which makes them **At risk**. This is live today:
the one real customer in the database has no sales and is flagged at risk. See §38.2.

The loyalty config those helpers read:

```js:js/data.js:47-55
  LOYALTY_POINTS_PER_1000: 100,  // 100 points per 1,000 new pounds spent
  LOYALTY_POINT_VALUE: 0.5,      // 1 point redeems for 0.5 (500 pts = 250)
  ...
  TIER_SILVER: 6000,
  TIER_GOLD: 12000,
```

Overwritten from the server's `config` table at hydrate:

```js:js/data.js:2114-2116
    CONFIG.LOYALTY_POINTS_PER_1000 = num('loyalty.points_per_1000', CONFIG.LOYALTY_POINTS_PER_1000);
    CONFIG.LOYALTY_POINT_VALUE     = num('loyalty.point_value', CONFIG.LOYALTY_POINT_VALUE);
    CONFIG.TIER_SILVER             = num('loyalty.tier_silver', CONFIG.TIER_SILVER);
```

Live values in `config`: `loyalty.points_per_1000 = 100`, `loyalty.point_value = 0.5`,
`loyalty.tier_silver = 6000`, `loyalty.tier_gold = 12000`.

### The customer section of `DB.hydrate()`

```js:js/data.js:2261-2285
    /* ---- customers -------------------------------------------------------
       totalSpent and lastPurchaseDate come from the server, where they are
       derived from the sales table rather than stored. A stored total is a
       second source of truth for money, and the first void makes it wrong. */
    customers.length = 0;
    (payload.customers || []).forEach(function (c) {
      customers.push({
        id: c.id,
        name: c.name,
        phone: c.phone || '',
        city: c.city || '',
        source: c.source || 'in-store',
        address: c.address || '',
        note: c.note || '',
        loyaltyPoints: Number(c.loyalty_points) || 0,
        totalSpent: Number(c.total_spent) || 0,
        lastPurchaseDate: c.last_purchase_at ? new Date(c.last_purchase_at) : null,
        archived: !!c.archived,
        demo: !!c.demo,
        history: []
      });
    });

    var custById = {};
    customers.forEach(function (c) { custById[c.id] = c; });
```

**Note what is dropped:** the server sends `visits`, `created_at` and `updated_at`
(`server/lib/customers.js:28-32`) and hydrate **discards all three**. `visits` is silently replaced
by `history.length`, which is a different number (§38.4). If the new screen wants "customer since
March" it must either re-add `created_at` here or call a route that returns it.

`history` is filled from the sales pass, not from the customer payload:

```js:js/data.js:2287-2306
    /* ---- sales ------------------------------------------------------------
       Hydrated even though the reported bug was about the catalogue, because
       leaving them seeded is not an option: every seeded invoice references
       product ids and SKUs that now mean something else entirely. The
       dashboard would show invented revenue itemised against real goods. */
    sales.length = 0;
    /* Every credit sale still carrying a balance, however old, folded in
       before the mapping so it gets exactly the same shape.

       The debt book is derived from this array, and this array is the last
       200 sales — so an unpaid debt older than that quietly stopped being
       owed, which is the worst thing this screen could do. The server sends
       them unbounded; deduped on id because a recent one is in both. */
    var srcSales = (payload.sales || []).slice();
    if (payload.money && payload.money.creditSales) {
      var have = {};
      srcSales.forEach(function (s) { have[s.id] = true; });
      payload.money.creditSales.forEach(function (s) { if (!have[s.id]) srcSales.push(s); });
    }
```

```js:js/data.js:2307-2345
    srcSales.forEach(function (s) {
      var sale = {
        id: s.id,
        date: new Date(s.at),
        customerId: s.customer_id,
        customerName: s.customer_name || t('walk_in'),
        items: (s.items || []).map(function (it) {
          return {
            sku: it.sku, productId: it.product_id, name: it.name,
            type: (DB.product(it.product_id) || {}).type || '',
            size: it.size, qty: it.qty,
            unitPrice: it.unit_price,
            /* Absent for anyone without cost.read — the server strips it from
               the nested items, not just the header. Left undefined rather
               than zeroed, so a profit figure computed from it comes out
               obviously broken instead of quietly flattering. */
            unitCost: it.unit_cost
          };
        }),
        subtotal: s.subtotal,
        discount: s.discount,
        pointsUsed: Number(s.points_used) || 0,
        couponCode: null,
        total: s.total,
        payment: s.payment,
        txnRef: s.txn_ref || null,
        warehouseId: s.wh_id,
        cashier: s.cashier_name || '',
        /* Which drawer it belongs to. This was hardcoded null, so the stamp
           the till puts on every sale died on arrival and the shift summary
           had nothing to count — one line, and the whole till reconciliation
           rested on it. */
        shiftId: s.shift_id || null,
        publicToken: s.public_token || null,
        fxRate: s.fx_rate || rate
      };
      sales.push(sale);
      if (custById[sale.customerId]) custById[sale.customerId].history.push(sale.id);
    });
```

**Two things the builder must know about `history`:**

1. It is populated **only from sales already in `DB.sales`**, which is `GET /api/sales?limit=200`
   plus any open credit sales folded in. A customer's 201st-most-recent purchase is not in
   `history` and the drawer will not show it. The server route that *does* answer this properly —
   `GET /api/customers/:id/history`, `LIMIT 50` — **is never called** (§39).
2. `sale.points_earned` is **not hydrated at all.** Only `points_used` is. This is why both the
   drawer's points timeline and the PDF statement recompute points arithmetically instead of
   reading the stored figure (§38.3).

## 22. Is there an existing customers screen?

**Yes — a substantial one, and it is more finished than "stub" but much less than "done".**

`VIEWS` names it:

```js:js/app-routing.js:16-42
var VIEWS = {
  /* "Home" is a different screen for different jobs. A chooser rather than a
     fifth branch inside viewDashboard, so each one stays a small readable
     function instead of one screen with four moods.

     roleOf() is null on file://, on the static demo and in _shot.html, so all
     three keep the full manager dashboard — the demo exists to show the whole
     system, and the Arabic proposal is screenshotted from it. */
  dashboard: function () {
    var r = roleOf();
    return r === 'cashier'   ? viewShiftHome()
         : r === 'warehouse' ? viewBackHome()
         : r === 'delivery'  ? viewRunsHome()
         : viewDashboard();
  },
  money: function () { return Money.view(); },
  pos: function () { return POS.render(); },
  products: viewProducts,
  warehouse: viewWarehouse,
  shelfmap:   ShelfMap.view,
  deliveries: function () { return Deliveries.view(); },
  customers: viewCustomers,
  labels: viewPrintLabels,
  print: viewPrint,
  reports: viewReports,
  settings: viewSettings
};
```

**There is no `js/app-customers.js`.** The screen lives in `js/app-customers-scan.js` (610 lines),
which is a shared file — its own header says so:

```js:js/app-customers-scan.js:1-9
/* ==========================================================================
   OG SYSTEM — application shell  ·  9/17: CUSTOMERS + duplicate guard +
   SCAN → PRODUCT + REORDER
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 3684-4282). Loads after
   app-warehouse.js.
   ========================================================================== */

/* ------------------------------------------------------------- 10. CUSTOMERS */
```

**The customers portion is lines 1–186.** Lines 188 onward are the product duplicate guard, the
scan→product flow and reorder — unrelated code that happens to share the file. Verbatim, the whole
customers section:

```js:js/app-customers-scan.js:11-81
/* The filtered customer list, shared by the view and by bulk select-all so
   "select all" can never grab more than the filter is showing. */
function customerRows() {
  var f = OG.cust;
  var list = DB.customers.filter(function (c) { return f.filter === 'archived' ? c.archived : !c.archived; });
  if (f.filter === 'risk') list = list.filter(function (c) { return DB.daysSince(c.lastPurchaseDate) >= 90; });
  if (f.filter === 'gold') list = list.filter(function (c) { return DB.tier(c.loyaltyPoints) === 'gold'; });
  if (f.q) {
    var q = f.q.toLowerCase();
    list = list.filter(function (c) {
      return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1 || c.city.toLowerCase().indexOf(q) > -1;
    });
  }
  return list.sort(function (a, b) { return b.totalSpent - a.totalSpent; });
}

function viewCustomers() {
  var list = customerRows();
  var risk = DB.inactiveCustomers(90).length;

  var h = '<div class="page-head"><div><h1>' + t('customers_title') + '</h1>' +
    '<div class="sub">' + t('customers_sub') + '</div></div>' +
    '<div class="head-actions">' +
      '<span class="badge critical">' + risk + ' ' + t('at_risk') + '</span>' +
      (allow('customer.write')
        ? '<button class="btn btn-primary btn-sm" data-act="cu-new">+ ' + t('cu_new') + '</button>'
        : '') +
      exportButtons() +
    '</div></div>';

  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(OG.cust.q) + '" data-change="cust-q">' +
    '<div class="chip-row">' +
      '<button class="chip ' + (OG.cust.filter === 'all' ? 'on' : '') + '" data-act="cust-filter" data-f="all">' + t('all_customers') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'risk' ? 'on' : '') + '" data-act="cust-filter" data-f="risk">' + t('risk_only') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'gold' ? 'on' : '') + '" data-act="cust-filter" data-f="gold">' + t('gold_only') + '</button>' +
      '<button class="chip ' + (OG.cust.filter === 'archived' ? 'on' : '') + '" data-act="cust-filter" data-f="archived">' + t('bk_archived_only') + '</button>' +
    '</div>' +
    '<span class="badge neutral">' + list.length + ' / ' + DB.customers.length + '</span></div>';

  h += '<div class="cust-grid">';
  list.forEach(function (c, ci) {
    var since = DB.daysSince(c.lastPurchaseDate);
    var atRisk = since >= 90;
    var tier = DB.tier(c.loyaltyPoints);
    h += '<div class="cust-card' + (atRisk ? ' risk' : '') + (Bulk.has('customers', c.id) ? ' bk-on' : '') +
         '" data-act="open-customer" data-id="' + c.id + '">' +
      '<span class="bk-corner">' + Bulk.box('customers', c.id, ci) + '</span>' +
      '<div class="cc-top"><span class="cc-av">' + esc(c.name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('')) + '</span>' +
        '<div style="flex:1;min-width:0"><b>' + esc(c.name) + '</b>' +
        '<small class="num">' + tel(c.phone) + '</small>' +
        '<small>' + esc(c.city) + ' · ' + t(c.source === 'online' ? 'online' : 'in_store') + '</small></div>' +
        '<span class="badge ' + tier + '">' + t(tier) + '</span>' +
      '</div>' +
      '<div class="cc-stats">' +
        '<div><span class="eyebrow">' + t('total_spent') + '</span><b>' + moneyShort(c.totalSpent) + '</b></div>' +
        '<div><span class="eyebrow">' + t('loyalty') + '</span><b>' + nf(c.loyaltyPoints) + '</b></div>' +
        '<div><span class="eyebrow">' + t('orders') + '</span><b>' + c.history.length + '</b></div>' +
        '<div><span class="eyebrow">' + t('last_purchase') + '</span><b style="font-size:11.5px;font-weight:700">' + relDate(c.lastPurchaseDate) + '</b></div>' +
      '</div>' +
      (atRisk
        ? '<div style="display:flex;gap:6px;align-items:center">' +
            '<span class="badge critical">' + t('at_risk') + '</span>' +
            '<button class="btn btn-sm btn-primary" style="margin-inline-start:auto" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>' +
          '</div>'
        : '') +
    '</div>';
  });
  h += '</div>';
  return h;
}
```

```js:js/app-customers-scan.js:83-186
function openCustomerDrawer(cid) {
  var c = DB.customer(cid);
  if (!c) return;
  var invoices = c.history.map(function (id) { return DB.sale(id); }).filter(Boolean)
    .sort(function (a, b) { return b.date - a.date; });

  /* Infer the sizes this customer actually buys, split by category family. */
  var sizeCount = {};
  invoices.forEach(function (s) {
    s.items.forEach(function (it) {
      var fam = (it.type === 'sneakers' || it.type === 'boots' || it.type === 'crocs') ? 'Footwear'
              : (it.type === 'jeans' ? 'Jeans' : 'Tops');
      sizeCount[fam] = sizeCount[fam] || {};
      sizeCount[fam][it.size] = (sizeCount[fam][it.size] || 0) + it.qty;
    });
  });

  var tier = DB.tier(c.loyaltyPoints);
  var since = DB.daysSince(c.lastPurchaseDate);

  var head =
    '<div style="display:flex;gap:12px;align-items:flex-start;flex:1">' +
      '<span class="cc-av" style="width:52px;height:52px;font-size:18px">' +
        esc(c.name.split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('')) + '</span>' +
      '<div><span class="eyebrow">' + esc(c.city) + ' · ' + t(c.source === 'online' ? 'online' : 'in_store') + '</span>' +
        '<h3 style="font-size:19px;margin:3px 0 5px">' + esc(c.name) + '</h3>' +
        '<span class="badge ' + tier + '">' + t(tier) + '</span> ' +
        (since >= 90 ? '<span class="badge critical">' + t('at_risk') + '</span>' : '') +
        ' <span class="badge neutral num">' + tel(c.phone) + '</span></div>' +
    '</div>';

  var body = '<div class="grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">' +
    '<div class="stat"><span class="eyebrow">' + t('total_spent') + '</span><div class="val">' + moneyShort(c.totalSpent) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('loyalty') + '</span><div class="val accent">' + nf(c.loyaltyPoints) + '</div>' +
      '<div class="foot">= ' + money(c.loyaltyPoints * CONFIG.LOYALTY_POINT_VALUE) + '</div></div>' +
    '<div class="stat"><span class="eyebrow">' + t('last_purchase') + '</span><div class="val" style="font-size:15px">' + relDate(c.lastPurchaseDate) + '</div>' +
      '<div class="foot">' + fmtDate(c.lastPurchaseDate) + '</div></div>' +
  '</div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('preferred_sizes') + '</h3>' +
    '<div class="card-actions muted small">' + (OG.lang === 'ar' ? 'مستنتجة من المشتريات' : 'inferred from purchases') + '</div></div><div class="card-body">';
  var fams = Object.keys(sizeCount);
  if (fams.length) {
    body += '<div style="display:flex;gap:18px;flex-wrap:wrap">';
    fams.forEach(function (f) {
      var best = Object.keys(sizeCount[f]).sort(function (a, b) { return sizeCount[f][b] - sizeCount[f][a]; })[0];
      body += '<div><span class="eyebrow">' + f + '</span>' +
        '<div class="strong-num" style="font-size:24px">' + best + '</div>' +
        '<small class="muted">' + sizeCount[f][best] + ' ' + t('units').toLowerCase() + '</small></div>';
    });
    body += '</div>';
  } else {
    body += '<span class="muted">' + t('none') + '</span>';
  }
  body += '</div></div>';

  body += '<div class="card mb"><div class="card-head"><h3>' + t('purchase_history') + '</h3>' +
    '<div class="card-actions"><span class="badge neutral">' + invoices.length + '</span></div></div>' +
    '<div class="table-wrap" style="max-height:250px;overflow-y:auto"><table class="tbl tbl-compact"><thead><tr>' +
      '<th>' + t('invoice') + '</th><th>' + t('date') + '</th><th>' + t('items') + '</th><th class="num">' + t('total') + '</th>' +
    '</tr></thead><tbody>';
  invoices.forEach(function (s) {
    body += '<tr class="clickable" data-act="open-invoice" data-id="' + s.id + '">' +
      '<td><b>' + s.id + '</b></td><td class="muted num">' + fmtDate(s.date) + '</td>' +
      '<td class="muted">' + s.items.map(function (i) { return esc(i.name) + ' (' + i.size + ')'; }).join(', ').slice(0, 46) + '</td>' +
      '<td class="num"><b>' + money(s.total) + '</b></td></tr>';
  });
  body += '</tbody></table></div></div>';

  body += '<div class="card"><div class="card-head"><h3>' + t('points_timeline') + '</h3></div><div class="card-body">' +
    '<ul class="timeline" style="margin:0;padding-inline-start:14px">';
  invoices.slice(0, 6).forEach(function (s) {
    body += '<li class="plus"><b>+' + nf(s.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000) + ' ' + t('points') + '</b>' +
      '<small>' + s.id + ' · ' + fmtDate(s.date) + ' · ' + money(s.total) + '</small></li>';
  });
  body += '</ul></div></div>';

  body += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="customer" data-kind="pdf" data-id="' + c.id + '">' + t('rec_statement') + '</button>' +
    '<button class="btn btn-ghost" data-act="export-rec" data-rec="customer" data-kind="excel" data-id="' + c.id + '">' + t('export_excel') + '</button>' +
  '</div>';

  if (since >= 90) {
    body += '<button class="btn btn-primary btn-block btn-lg mt" data-act="whatsapp" data-id="' + c.id + '">' + t('send_whatsapp') + '</button>';
  }

  openDrawer({ head: head, body: body });
}

/* Routed through the WA layer so the Send button opens a real conversation
   instead of raising a toast and discarding the message. */
function openWhatsapp(cid) {
  var c = DB.customer(cid);
  WA.compose({
    title: t('whatsapp_msg') + ' · ' + esc(c.name),
    to: c.phone,
    name: c.name,
    kind: 'winback',
    text: WA.templates.winback(c),
    note: OG.lang === 'ar'
      ? 'آخر شراء: ' + relDate(c.lastPurchaseDate) + ' · إجمالي الإنفاق ' + money(c.totalSpent)
      : 'Last purchase ' + relDate(c.lastPurchaseDate) + ' · lifetime ' + money(c.totalSpent)
  });
}
```

**What is real, and what is missing — exactly:**

| Feature | State |
|---|---|
| List as a card grid, sorted by lifetime spend | **Real** |
| Search on name / phone / city | **Real**, but see §20 and §29 for how weak it is |
| Filters: all / at-risk / gold / archived | **Real** |
| Bulk select + bulk archive + bulk points | **Real**, in `js/bulk.js` |
| Add a customer | **Real**, but the form lives in `js/app-warehouse.js` |
| Read-only detail drawer | **Real** |
| Purchase history in the drawer | **Real, but capped at the hydrated 200 sales** |
| Preferred-size inference | **Real** |
| WhatsApp win-back | **Real** |
| PDF/Excel statement | **Real** |
| **Edit an existing customer** | **MISSING** — no UI at all (§39) |
| **Archive/restore one customer** | **MISSING** — only bulk can do it |
| **Adjust points by hand, with a reason** | **MISSING** — only the ±250 bulk action |
| **Show what a customer owes** | **MISSING entirely** — no debt anywhere on this screen |
| **Address, note, source shown or editable** | **MISSING** — hydrated, never displayed |
| **Deliveries for this customer** | **MISSING** |
| **`visits` / `created_at`** | **MISSING** — dropped at hydrate |

## 23. How the POS picks a customer today

### Can a sale be rung up with no customer? **Yes.** Here is the proof, on both sides.

**Browser — the initial state is `null` and nothing forces it otherwise:**

```js:js/pos.js:12
    customerId: null,
```

```js:js/pos.js:1219-1228
    S.customerId = null;
```
(the reset after a completed sale; the surrounding comment at 1226-1228 is about the delivery flag)

**The payload sends `null` unchanged:**

```js:js/pos.js:934
      customerId: S.customerId || null,
```

**Server — `cust` stays `null` and every downstream use is guarded:**

```js:server/lib/sales.js:148-164
    let cust = null;
    if (customerId !== null && customerId !== undefined && customerId !== '') {
      cust = d.prepare(
        'SELECT id, name, loyalty_points, archived FROM customers WHERE id = ?'
      ).get(customerId);

      if (!cust) {
        const e = new Error(`No customer with id ${customerId}.`);
        e.code = 'unknown_customer';
        throw e;
      }
      if (cust.archived) {
        const e = new Error(`${cust.name} is archived. Restore them first.`);
        e.code = 'unknown_customer';
        throw e;
      }
    }
```

```js:server/lib/sales.js:309-312
    ).run(saleId, at, cust ? cust.id : null, cust ? cust.name : null,
          userId ?? null, whId, payment || 'cash',
          settle, subtotal, disc, total, rate, base, at, token, wantPoints,
          earnedForRow, ref, openShift ? openShift.id : null);
```

`customer_id` and `customer_name` are both `NOT NULL`-free in the schema (§11), and the live data
confirms it: **all 8 sales have `customer_id = NULL` and `customer_name = NULL`.** The browser
labels them at hydrate:

```js:js/data.js:2312
        customerName: s.customer_name || t('walk_in'),
```

`walk_in` → `"Walk-in customer"` / `"زبون عابر"`.

**The one thing you cannot do without a customer is redeem points:**

```js:server/lib/sales.js:216
      if (!cust) throw new Error('points can only be redeemed against a customer');
```

**And attaching a customer who does not exist now stops the sale** rather than silently dropping —
the comment above the lookup explains why:

```js:server/lib/sales.js:140-147
        Read here, before anything is priced, for two reasons. Points can pay
        for part of this sale, so the balance has to be known before the total
        is. And an id that matches nobody has to STOP the sale.

        It used to be looked up after the fact and quietly ignored when it
        missed: the cashier attached a customer, the sale recorded without one,
        the points were never earned, and nothing anywhere said so. A sale that
        refuses is a sale someone can fix. */
```

with the browser handling that specific code:

```js:js/pos.js:991-997
        /* The attached customer does not exist on the server. This used to be
           swallowed silently: the sale recorded with no customer, no points
           ... */
        if (err.code === 'unknown_customer') {
          S.customerId = null;
          ...
          toast(t('customer'), err.message, 'err', 7000);
        }
```

### The picker itself, verbatim

```js:js/pos.js:1426-1450
  /* ---- the customer list ---------------------------------------------------
     A browsable dropdown, not a search box that stays blank until you already
     know the phone number. Opening it shows every registered customer, most
     recent purchase first — the person at the counter is usually a regular,
     and the cashier should be able to point at a name rather than interview
     someone for their number. Typing narrows the same list; "+ New customer"
     is always the last row, so adding one is never a dead end. */

  var custSel = -1;             /* keyboard highlight; -1 = nothing chosen yet */

  /* How many rows are drawn at once. The list is rebuilt on every keystroke,
     and a shop three years in has thousands of customers — painting all of
     them is a till that stutters while somebody types. What is cut is always
     counted on screen, never dropped quietly. */
  var CUST_MAX = 40;

  /* Missing dates sort last rather than poisoning the comparator: an absent
     lastPurchaseDate is `null` on every customer the server has never seen a
     sale for, and `new Date(undefined)` is NaN, which makes the sort order
     arbitrary rather than merely wrong. */
  function lastBuy(c) {
    var d = c && c.lastPurchaseDate ? new Date(c.lastPurchaseDate).getTime() : 0;
    return d === d ? d : 0;                 // NaN check without isNaN's coercion
  }
```

```js:js/pos.js:1451-1480
  function custMatches(q) {
    q = String(q || '').trim().toLowerCase();
    /* Archived people are off the books; the till must not offer them. The
       server sends them to anyone with customer.write — which a cashier has,
       because she adds customers here — so filtering has to happen here. */
    var list = DB.customers.filter(function (c) { return !c.archived; });
    list.sort(function (a, b) {
      /* Newest buyer first. Ties break on newest id so somebody added a
         minute ago and not yet sold to sits at the top of the list rather
         than the very bottom of it. */
      return lastBuy(b) - lastBuy(a) || (b.id - a.id);
    });
    if (!q) return list;
    /* Two digits is enough to narrow once the list is already on screen; the
       old three-digit floor existed only because nothing showed before it.

       Only a query with no letters in it is read as a phone number. Without
       that test "Bulk Tester 59" also drags in everyone whose number happens
       to contain 59, and the cashier is handed a list of strangers under the
       name she typed. Arabic letters count as letters. */
    var digits = q.replace(/\D/g, '');
    var byPhone = digits.length >= 2 && !/[a-z؀-ۿ]/.test(q);
    return list.filter(function (c) {
      if (byPhone) {
        return String(c.phone || '').replace(/\D/g, '').indexOf(digits) > -1;
      }
      return String(c.name || '').toLowerCase().indexOf(q) > -1 ||
             String(c.city || '').toLowerCase().indexOf(q) > -1;
    });
  }
```

```js:js/pos.js:1493-1545
  function custDrop(q) {
    var box = document.getElementById('custDrop');
    if (!box) return;
    var hits = custMatches(q);
    var shown = hits.slice(0, CUST_MAX);
    if (custSel >= shown.length) custSel = shown.length - 1;

    var h = '<div class="cust-drop">';
    if (!hits.length) h += '<div class="cust-hint">' + t('no_results') + '</div>';

    shown.forEach(function (c, i) {
      /* Tested before formatting, not after: tel('') is still a non-empty
         <bdi> wrapper, so filtering the formatted strings would keep a blank
         phone and leave the row reading " · Aleppo". */
      var bits = [];
      if (c.phone) bits.push(tel(c.phone));
      if (c.city) bits.push(esc(c.city));
      var sub = bits.join(' · ');
      h += '<div class="cust-row' + (i === custSel ? ' on' : '') + '" ' +
          'data-pos="cust-pick" data-id="' + c.id + '">' +
        '<span class="cr-txt"><b>' + esc(c.name) + '</b>' +
          '<small class="num">' + sub + '</small></span>' +
        '<span class="badge ' + DB.tier(c.loyaltyPoints) + '">' + nf(c.loyaltyPoints) + '</span>' +
      '</div>';
    });

    /* Say what was cut. A list that silently stops at forty looks like a list
       that ends at forty, and she stops typing believing the person is gone. */
    if (hits.length > shown.length) {
      h += '<div class="cust-hint">' +
        t('cu_more').replace('{n}', nf(hits.length - shown.length)) + '</div>';
    }

    /* Whatever was typed rides into the new-customer form, so a name already
       spelled out at the counter is never typed twice. */
    if (typeof allow !== 'function' || allow('customer.write')) {
      var qq = String(q || '').trim();
      h += '<div class="cust-add" data-pos="cust-new" data-q="' + esc(qq) + '">+ ' +
        t('cu_new') + (qq ? ' · ' + esc(qq) : '') + '</div>';
    }

    box.innerHTML = h + '</div>';
    var on = box.querySelector('.cust-row.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }

  function pickCustomer(id) {
    S.customerId = +id;
    closeCustDrop();
    paintFoot();
    var c = DB.customer(S.customerId);
    if (c) toast(t('customer'), c.name + ' · ' + nf(c.loyaltyPoints) + ' ' + t('points'), 'ok', 2000);
  }
```

```js:js/pos.js:1547-1572
  /* The rows actually on screen. Arrow keys and Enter must agree with what
     the eye can see — indexing the uncapped list would let Enter attach a
     customer who was never drawn. */
  function custShown(q) { return custMatches(q).slice(0, CUST_MAX); }

  function moveCust(d) {
    var inp = document.getElementById('posCust');
    if (!inp) return;
    if (!custDropOpen()) { custDrop(inp.value); return; }
    var n = custShown(inp.value).length;
    if (!n) return;
    custSel = custSel < 0 ? (d > 0 ? 0 : n - 1) : (custSel + d + n) % n;
    custDrop(inp.value);
  }

  /* Enter takes the highlighted row, or the only remaining match — typing
     enough of a name to leave one person and pressing Enter is the fastest
     honest path, and it cannot pick the wrong one because there is no other. */
  function pickHighlightedCust() {
    var inp = document.getElementById('posCust');
    if (!inp) return false;
    var hits = custShown(inp.value);
    if (custSel >= 0 && hits[custSel]) { pickCustomer(hits[custSel].id); return true; }
    if (hits.length === 1) { pickCustomer(hits[0].id); return true; }
    return false;
  }
```

The POS's own dispatch namespace (`data-pos`, not `data-act`):

```js:js/pos.js:1311-1335
    'cust-clear': function () { S.customerId = null; S.pointsUsed = 0; paintFoot(); setTimeout(focusCust, 30); },
    ...
    'cust-pick': function (el) { pickCustomer(el.getAttribute('data-id')); },
    ...
      openNewCustomer(el.getAttribute('data-q') || '', function (c) {
        S.customerId = c.id;
```

**The POS picker is the most carefully built customer UI in the codebase and is the right model to
copy for the new screen's search** — it is the only one that distinguishes a phone query from a name
query, the only one that caps and *says it capped*, and the only one that filters archived rows.

## 24. The `ACTIONS` dispatch table — wiring plus three real cases

### The wiring (in `js/app-boot.js`, the last file loaded)

There is **one** click listener for the whole `data-act` namespace:

```js:js/app-boot.js:12-48
function bindGlobal() {
  document.addEventListener('click', function (e) {
    /* Bulk owns its own namespace — never let a checkbox also open a drawer. */
    if (e.target.closest && e.target.closest('[data-bk]')) return;

    var el = e.target.closest ? e.target.closest('[data-act]') : null;

    /* close the notification popover when clicking elsewhere */
    var pop = document.getElementById('notifPop');
    if (pop && !pop.contains(e.target) && (!el || el.getAttribute('data-act') !== 'bell')) pop.remove();

    /* same for the account menu. Clicks INSIDE it must survive, or the item
       being clicked is removed before its own handler runs. */
    var ap = document.getElementById('acctPop');
    if (ap && !ap.contains(e.target) && (!el || el.getAttribute('data-act') !== 'acct')) ap.remove();

    /* close the global search dropdown */
    var sr = document.getElementById('searchResults');
    if (sr && sr.innerHTML && !e.target.closest('.search')) sr.innerHTML = '';

    if (!el) return;
    var fn = ACTIONS[el.getAttribute('data-act')];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'globalSearch') { runSearch(el.value); return; }
    var k = el.getAttribute && el.getAttribute('data-change');
    if (k && CHANGES[k] && el.tagName !== 'SELECT' && el.type !== 'checkbox') CHANGES[k](el);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    var k = el.getAttribute && el.getAttribute('data-change');
    if (k && CHANGES[k] && (el.tagName === 'SELECT' || el.type === 'checkbox')) CHANGES[k](el);
  });
```

Note the handler signature is `fn(el, e)` and `e.preventDefault()` is called for you.
`data-bk` (bulk) short-circuits before `data-act` is even read.

The table itself and its loading constraint:

```js:js/app-actions.js:18-33
/* -------------------------------------------------------------- 19. ACTIONS */

/* Which piece of state holds a screen's open tab. Only two screens have
   tabs; naming them here means a shortcut can say WHERE it is going rather
   than only which screen — "+ Add product" on the Products page should land
   on the Add form, not on whichever warehouse tab was open last. */
var NAV_TAB_STATE = { warehouse: function () { return OG.wh; }, reports: function () { return OG.rep; } };

function navTo(view, tab) {
  /* Set before go(), because go() renders — doing it after would draw the
     old tab first and then snap. */
  if (tab && NAV_TAB_STATE[view]) NAV_TAB_STATE[view]().tab = tab;
  go(view);
}

var ACTIONS = {
```

### Three real cases, verbatim — the house style

**(a) The one-liner. Read an attribute, call a function.**

```js:js/app-actions.js:309-312
  'open-customer': function (el) { openCustomerDrawer(+el.getAttribute('data-id')); },
  whatsapp: function (el) { openWhatsapp(+el.getAttribute('data-id')); },
  'day-summary': function () { openDaySummary(); },
  'dash-scope': function (el) { OG.dashScope = el.getAttribute('data-k'); render(); },
```

**(b) A filter chip. Mutate `OG.*`, then `render()`.** This is the pattern the new screen's filters
must follow:

```js:js/app-actions.js:314-320
  'prod-sort': function (el) {
    var k = el.getAttribute('data-k');
    if (OG.prod.sort === k) OG.prod.dir *= -1; else { OG.prod.sort = k; OG.prod.dir = 1; }
    render();
  },
  'cust-filter': function (el) { OG.cust.filter = el.getAttribute('data-f'); render(); },
  reorder: function (el) { openReorder(+el.getAttribute('data-id')); },
```

**(c) A server write. `Shop.write(send, mirror, done)` — the full house pattern, including the
duplicate guard and the deliberate re-lookup after reload:**

```js:js/app-actions.js:751-813
  'cu-new': function (el) {
    openNewCustomer(el.getAttribute('data-q') || '', null);
  },

  'cu-save': function () {
    var name = ((document.getElementById('cuName') || {}).value || '').trim();
    var phone = ((document.getElementById('cuPhone') || {}).value || '').trim();
    var city = ((document.getElementById('cuCity') || {}).value || '').trim();

    if (!name) {
      toast(t('cu_new'), OG.lang === 'ar' ? 'اكتب الاسم' : 'Enter a name', 'err');
      return;
    }

    /* Same name AND same phone is a duplicate; same name alone is two people
       called Ahmad, which in Aleppo is most of them. */
    var dupe = DB.customers.filter(function (c) {
      return c.name.toLowerCase() === name.toLowerCase() &&
             (!phone || c.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''));
    })[0];
    if (dupe) {
      closeModal();
      toast(t('cu_new'), t('cu_exists') + ' · ' + esc(dupe.name), 'warn', 5000);
      if (OG.cuOnCreated) OG.cuOnCreated(dupe);
      OG.cuOnCreated = null;
      return;
    }

    var after = OG.cuOnCreated;
    OG.cuOnCreated = null;

    Shop.write(
      function () {
        return Shop.newCustomer({ name: name, phone: phone, city: city, source: 'in-store' });
      },
      function () {
        /* Demo mode only. Nothing is saved, so the id just has to be unique
           within this page's lifetime. */
        var c = {
          id: DB.customers.reduce(function (m, x) { return Math.max(m, x.id); }, 0) + 1,
          name: name, phone: phone, city: city, source: 'in-store', address: '', note: '',
          loyaltyPoints: 0, totalSpent: 0, lastPurchaseDate: null,
          archived: false, history: []
        };
        DB.customers.push(c);
        return { customer: c };
      },
      function (res) {
        closeModal();
        /* Re-found by id after the reload rather than kept from the response:
           in live mode the object in DB.customers is a fresh one, and handing
           the caller the stale copy is how a till ends up holding a customer
           the rest of the app cannot see. */
        var made = res && res.customer;
        var c = made ? (DB.customer(made.id) || made) : null;
        render();
        if (c) {
          toast(t('cu_new'), c.name + (c.phone ? ' · ' + c.phone : ''), 'ok', 3500);
          if (after) after(c);
        }
```

The `Shop.write` contract itself — send, then reload, then done; failures toast and stop:

```js:js/shop.js:224-238
      .then(function (res) { reply = res; return load(); })
      .then(function () {
        busy = false;
        if (typeof refreshAll === 'function') refreshAll();
        if (done) done(reply);
      })
      .catch(function (err) {
        busy = false;
        if (typeof toast === 'function') {
          toast(typeof t === 'function' ? t('warehouse_title') : 'Stock',
                API.friendly(err), 'err', 6000);
        }
        if (typeof console !== 'undefined') console.error('[shop] write failed', err);
      });
  }
```

**Note the second argument is a dead "demo mode" mirror.** `CLAUDE.md` says demo mode was removed
and `Auth.demoMode()` deleted; the `mirror` callback in `cu-save` is a leftover of it (§40).

### The `CHANGES` table (`data-change`), for the search box

```js:js/app-changes.js:9-21
var CHANGES = {
  /* Modal-scoped, so it updates the results div directly rather than
     going through the app-wide render() — the modal lives outside #app,
     a full render() would never touch it. */
  'attach-search': function (el) {
    var host = document.getElementById('attachSearchResults');
    if (!host) return;
    host.innerHTML = attachResultsHTML(el.value, host.getAttribute('data-code'));
  },
  'prod-q': function (el) { OG.prod.q = el.value; render(); focusBack('[data-change="prod-q"]', el.value.length); },
  'prod-type': function (el) { OG.prod.type = el.value; render(); },
  'prod-health': function (el) { OG.prod.health = el.value; render(); },
  'cust-q': function (el) { OG.cust.q = el.value; render(); focusBack('[data-change="cust-q"]', el.value.length); },
```

```js:js/app-changes.js:222-227
function focusBack(sel, caret) {
  var el = document.querySelector(sel);
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(caret, caret); } catch (e) {}
}
```

**Every keystroke re-renders the entire screen** and `focusBack` puts the caret back. That is the
established idiom; it is also why the list must stay cheap to build (the POS's `CUST_MAX = 40` cap
exists for exactly this reason).

The screen's state bucket:

```js:js/app-state.js:38
  cust: { q: '', filter: 'all' },
```

## 25. The markup helpers

**`stat`, `card` and `tbl` are NOT functions.** A grep for `function stat`, `function card`,
`function tbl` across `js/` returns nothing. They are **CSS class names**, written inline as HTML
strings. (`CLAUDE.md` calls them "`stat`, `card`, `tbl` markup", which is accurate but easy to
misread as an API.)

| Name | Kind | Definition | One real call site |
|---|---|---|---|
| `.card` / `.card-head` / `.card-body` / `.card-actions` | CSS | `css/motion-cards.css:120-135` | `js/app-customers-scan.js:139-141` |
| `.stat` / `.stat .val` / `.stat .foot` | CSS | `css/motion-cards.css:142-161` | `js/app-customers-scan.js:114-120` |
| `.tbl` / `.tbl-compact` / `.table-wrap` | CSS | `css/motion-cards.css` (`.card-head + .table-wrap`, :135) | `js/app-customers-scan.js:141-143` |
| `.page-head` / `.sub` / `.head-actions` | CSS | `css/motion-cards.css:74-77` | `js/app-customers-scan.js:31-39` |
| `.filters` / `.grow` / `.chip-row` / `.chip` / `.chip.on` | CSS | `css/inputs-dashboard-pos.css:92-106` | `js/app-customers-scan.js:41-49` |
| `.field` / `.lbl` / `.inp` | CSS | `css/inputs-dashboard-pos.css:10-26` | `js/app-warehouse.js:224-231` |
| `.timeline` / `.timeline li.plus` | CSS | `css/dialogs-customers-jobs.css:105-109` | `js/app-customers-scan.js:152-158` |
| `.cart-empty` | CSS (the reusable empty state, despite the name) | `css/inputs-dashboard-pos.css:306-307` | `js/money.js:234-235` |

The **real functions** are these four, all in `js/app-util.js`:

### `toast(title, msg, kind, ms, action)`

```js:js/app-util.js:239-255
/* `action` = { label, attrs } renders a button inside the toast — used by the
   bulk Undo. The toast container is pointer-events:none, so a toast carrying
   an action has to re-enable them on itself. */
function toast(title, msg, kind, ms, action) {
  var host = document.getElementById('toasts');
  var el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = '<div style="flex:1"><b>' + esc(title) + '</b>' +
                 (msg ? '<small>' + esc(msg) + '</small>' : '') + '</div>' +
                 (action ? '<button class="toast-act" ' + action.attrs + '>' + esc(action.label) + '</button>' : '');
  if (action) el.style.pointerEvents = 'auto';
  host.appendChild(el);
  setTimeout(function () {
    el.classList.add('out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
  }, ms || 3000);
}
```

`kind` is `'ok' | 'warn' | 'err'` or omitted.
**Call site:** `js/app-actions.js:808` — `toast(t('cu_new'), c.name + (c.phone ? ' · ' + c.phone : ''), 'ok', 3500);`

### `openModal({ title, body, foot, size, sheet, onOpen, onClose })`

```js:js/app-util.js:257-288
/* `sheet: true` makes it rise from the bottom edge instead of sitting in the
   middle — the phone idiom, and thumb-reachable. Everything else is identical,
   so no caller has to know which shape it will take. */
function openModal(o) {
  closeModal();
  var root = document.getElementById('modal-root');
  root.innerHTML =
    '<div class="modal-backdrop' + (o.sheet ? ' as-sheet' : '') + '" data-act="modal-backdrop">' +
      '<div class="modal ' + (o.size || '') + (o.sheet ? ' sheet' : '') + '">' +
        (o.title ? '<div class="modal-head"><h3>' + o.title + '</h3>' +
          '<button class="x" data-act="modal-close" aria-label="Close">&times;</button></div>' : '') +
        '<div class="modal-body">' + o.body + '</div>' +
        (o.foot ? '<div class="modal-foot">' + o.foot + '</div>' : '') +
      '</div>' +
    '</div>';
  if (o.onOpen) o.onOpen(root);
  /* Held on the module, not on the DOM, because closeModal() wipes innerHTML
     and there are four ways out of a modal — the ×, the backdrop, Escape, and
     another modal opening on top. A teardown that only runs on one of them is
     a teardown that does not run. */
  modalOnClose = o.onClose || null;
}

var modalOnClose = null;

function closeModal() {
  var fn = modalOnClose;
  modalOnClose = null;
  if (fn) { try { fn(); } catch (e) { console.warn('modal onClose', e); } }
  document.getElementById('modal-root').innerHTML = '';
}
function modalOpen() { return !!document.getElementById('modal-root').firstChild; }
```

**Call site — and this is the customer form you will be replacing or extending:**

```js:js/app-warehouse.js:201-244
/* ---- a person the shop has not met before ---------------------------------
   The customer list was read-only, which was survivable while it was forty
   seeded names and nothing was saved. It stopped being survivable the moment
   customers became real: the receipt prints a name and a points balance, and
   a list nobody can add to means the loyalty scheme only ever works for people
   who were already in the database.

   Deliberately three fields. This is filled in at a till with somebody waiting;
   a form asking for an address and a note is a form that gets skipped, and a
   skipped form is a walk-in sale with no customer on it. */
function openNewCustomer(prefill, onCreated) {
  if (!allow('customer.write')) { toast(t('customer'), t('no_access'), 'err'); return; }

  var name = '', phone = '';
  /* Whatever was typed into the search that found nobody. Digits are a phone
     number, anything else is a name — she has already typed it once. */
  var seed = String(prefill || '').trim();
  if (/^[\d+\s()-]+$/.test(seed) && seed.replace(/\D/g, '').length >= 3) phone = seed;
  else name = seed;

  openModal({
    title: t('cu_new'), size: 'narrow',
    body:
      '<label class="field"><span>' + t('name') + '</span>' +
        '<input class="inp" id="cuName" type="text" value="' + esc(name) + '" ' +
        'placeholder="' + esc(t('cu_name_ph')) + '"></label>' +
      '<label class="field mt"><span>' + t('phone') + '</span>' +
        '<input class="inp" id="cuPhone" type="tel" inputmode="tel" value="' + esc(phone) + '" ' +
        'placeholder="+963 9__ ___ ___"></label>' +
      '<label class="field mt"><span>' + t('city') + '</span>' +
        '<input class="inp" id="cuCity" type="text" value="' + esc(CONFIG.SHOP_CITY || 'Aleppo') + '"></label>' +
      '<div class="partner-note mt">' + t('cu_new_note') + '</div>',
    foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="cu-save">' + t('save') + '</button>'
  });

  /* Handed to the action rather than read back out of the DOM, because the
     modal is gone by the time the server answers. */
  OG.cuOnCreated = onCreated || null;
  setTimeout(function () {
    var el = document.getElementById(name ? 'cuPhone' : 'cuName');
    if (el) el.focus();
  }, 60);
}
```

Note: **the form deliberately omits `address` and `note`** even though both columns exist and
`clean()` accepts them. The comment says why. A Customers screen — unlike a till — is the right
place for the fuller form.

### `openDrawer({ head, body, onOpen })` / `closeDrawer()`

```js:js/app-util.js:290-304
function openDrawer(o) {
  closeDrawer();
  var root = document.getElementById('drawer-root');
  root.innerHTML =
    '<div class="drawer-backdrop" data-act="drawer-close"></div>' +
    '<aside class="drawer">' +
      '<div class="drawer-head">' + o.head +
        '<button class="x" data-act="drawer-close" style="margin-inline-start:auto;border:0;background:none;font-size:22px;line-height:1;color:var(--muted-foreground)">&times;</button>' +
      '</div>' +
      '<div class="drawer-body">' + o.body + '</div>' +
    '</aside>';
  if (o.onOpen) o.onOpen(root);
}

function closeDrawer() { document.getElementById('drawer-root').innerHTML = ''; }
```

**Call site:** `js/app-customers-scan.js:169` — `openDrawer({ head: head, body: body });`

There is **no `confirm()` helper**. Destructive actions use `openModal` with a footer button, or the
bulk bar's Undo toast.

### `exportButtons()`

```js:js/app-export.js:278-282
/* Same pair of buttons on every screen that has something worth exporting. */
function exportButtons() {
  return '<button class="btn btn-ghost" data-act="export" data-kind="excel">' + t('export_excel') + '</button>' +
         '<button class="btn btn-ghost" data-act="export" data-kind="pdf">' + t('export_pdf') + '</button>';
}
```

**Call site:** `js/app-customers-scan.js:38`.

### Formatting helpers used throughout

```js:js/app-util.js:10-66
function nf(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
...
function pct(n, digits) { return (Number(n) || 0).toFixed(digits === undefined ? 1 : digits) + '%'; }
...
function fmtDate(d) { ... }
function fmtDateTime(d) { ... }
/* "3 days ago" / "in 3 days" / "today" */
function relDate(d) {
  var n = DB.daysSince(d);
  if (n === 0) return t('today_word');
  if (n === 1) return t('yesterday');
  if (n > 0) return n + ' ' + t('days_ago');
  return t('in_days') + ' ' + Math.abs(n) + ' ' + t('days');
}

function dateWithRel(d) { return fmtDate(d) + ' <span class="muted">· ' + relDate(d) + '</span>'; }

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

**Every user-supplied string must go through `esc()`.** The existing screen does this consistently
except for the invoice id (`s.id`, server-generated) — worth keeping to.

## 26. `roleOf`, `allow`, `seesCost`, `seesProfit`, `isPartnerAccount`, `navAllowed`, `ifNav`, `NAV_PERM`

All in `js/app-shell.js`, verbatim, with the surrounding comments:

```js:js/app-shell.js:19-53
                    so everything is permitted and no screen is trimmed.
     no Auth     — _shot.html, which loads neither api.js nor auth.js and
                   drives the Arabic proposal screenshots. Same answer as demo.

   Getting this backwards is how the proposal PDF ends up full of empty
   screens, so both fallbacks say yes rather than no. That is safe precisely
   because neither case has any real data behind it. */

function roleOf() {
  if (typeof Auth === 'undefined') return null;
  var u = Auth.user();
  return u ? u.role : null;
}

function allow(perm) {
  if (typeof Auth === 'undefined') return true;
  return Auth.can(perm);
}

/* What things cost us, and what we make on them. Two separate permissions
   because they are two separate secrets: a manager may reasonably want a
   senior person to see margin without seeing supplier prices.

   These exist as named functions rather than `allow('cost.read')` sprinkled
   through the file because the failure mode is missing ONE call site, and a
   named thing is greppable. */
function seesCost()   { return allow('cost.read'); }
function seesProfit() { return allow('profit.read'); }

/* Yalla Wear does not get the shop. They get their portal and nothing else —
   no sidebar, no search, no dashboard, no way to type their way out. Checked
   against the role rather than a permission, because this is not a thing a
   manager should be able to switch on by ticking a box. */
function isPartnerAccount() { return roleOf() === 'partner'; }
```

### The complete `NAV_PERM` map

```js:js/app-shell.js:70-95
/* Which permission each screen needs.

   A screen missing from this map is open to anyone signed in — `dashboard` is
   the only one, deliberately, so no role can ever end up with an empty shell
   and nowhere to land.

   This hides menu items; it is not the security boundary. The server refuses
   the data regardless. What this fixes is a cashier staring at a Money screen
   that loads empty and looks broken, when the real answer is "not your job". */
var NAV_PERM = {
  pos:        'sell',
  products:   'product.read',
  warehouse:  'stock.read',
  /* The same gate the warehouse screen has: a cashier answering "have you
     got it in a 42" is exactly who the map is for. Putting stock away from
     it needs stock.move, and the layout editor config.write — both checked
     inside the module, and both again on the server. */
  shelfmap:   'stock.read',
  money:      'money.read',
  deliveries: 'delivery.read',
  customers:  'customer.read',
  labels:     'label.print',
  print:      'print.read',
  reports:    'report.read',
  settings:   'config.write'
};
```

```js:js/app-shell.js:97-123
/* In demo mode every screen shows — the demo is meant to display the whole
   system — and with no Auth at all (_shot.html) nothing is filtered either. */
function navAllowed(id) {
  /* The partner has no shop nav at all, including the dashboard that is
     otherwise open to everyone. Their whole app is the portal. */
  if (isPartnerAccount()) return false;

  /* A driver's home screen already IS his runs, so a second menu entry to the
     same list is just a way of making him wonder which one is the real one. */
  if (id === 'deliveries' && roleOf() === 'delivery') return false;

  var need = NAV_PERM[id];
  return !need || allow(need);
}

function allowedNav() {
  return NAV.filter(function (n) { return navAllowed(n.id); });
}

/* Wrap any in-page shortcut to another screen — a "View all" on a dashboard
   card, a "+ Add" that jumps to the warehouse. Hiding the sidebar entry is not
   enough on its own: these buttons live inside screens the role CAN see, and
   go() would quietly bounce them somewhere else. A button that visibly does
   the wrong thing is worse than one that is not there. */
function ifNav(view, html) {
  return navAllowed(view) ? html : '';
}
```

The nav entry itself:

```js:js/app-shell.js:63
  { id: 'customers',  key: 'nav_customers', group: 'ops',  icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a3 3 0 0 0-2-2.8' },
```

**`customers` is in the `ops` nav group**, alongside deliveries, labels, print, reports, settings.

## 27. `ALL_PERMISSIONS`, `PINNED`, `FORBIDDEN`, and the seeded defaults

```js:server/lib/auth.js:52-95
/* Every permission the system knows about, in the order the Settings grid
   shows them. Grouped so the screen reads as a sentence about a job rather
   than an alphabetical dump. The label is what a shop owner sees — nobody
   should have to work out what `stock.count` means. */
export const ALL_PERMISSIONS = [
  { perm: 'sell',            group: 'till',      label: 'Sell at the till' },
  { perm: 'refund',          group: 'till',      label: 'Give a refund' },
  { perm: 'void',            group: 'till',      label: 'Cancel a completed sale' },
  { perm: 'sale.reprint',    group: 'till',      label: 'Reprint a past receipt' },

  { perm: 'stock.read',      group: 'stock',     label: 'See stock levels' },
  { perm: 'stock.move',      group: 'stock',     label: 'Receive and move stock' },
  { perm: 'stock.count',     group: 'stock',     label: 'Do a stock count' },
  { perm: 'label.print',     group: 'stock',     label: 'Print product labels' },

  { perm: 'product.read',    group: 'products',  label: 'See products' },
  { perm: 'product.write',   group: 'products',  label: 'Add and edit products' },

  { perm: 'customer.read',   group: 'customers', label: 'See customers' },
  { perm: 'customer.write',  group: 'customers', label: 'Add and edit customers' },

  { perm: 'delivery.read',   group: 'delivery',  label: 'See deliveries' },
  { perm: 'delivery.write',  group: 'delivery',  label: 'Send out and mark delivered' },

  { perm: 'cost.read',       group: 'money',     label: 'See what things cost' },
  { perm: 'profit.read',     group: 'money',     label: 'See profit' },
  { perm: 'money.read',      group: 'money',     label: 'See the money screen' },
  { perm: 'money.write',     group: 'money',     label: 'Record expenses and debts' },
  { perm: 'discount.unlimited', group: 'money',  label: 'Discount past the limit' },

  { perm: 'print.read',      group: 'print',     label: 'See print jobs' },
  { perm: 'print.write',     group: 'print',     label: 'Create and change print jobs' },
  { perm: 'partner.read',    group: 'print',     label: 'See the partner portal' },
  { perm: 'partner.write',   group: 'print',     label: 'Act on partner orders' },

  { perm: 'staff.read',      group: 'admin',     label: 'See staff accounts' },
  { perm: 'staff.write',     group: 'admin',     label: 'Add and edit staff' },
  { perm: 'report.read',     group: 'admin',     label: 'See reports' },
  { perm: 'config.write',    group: 'admin',     label: 'Change settings' },

  { perm: 'partner.jobs',    group: 'partner',   label: 'Yalla Wear: own jobs' },
  { perm: 'partner.respond', group: 'partner',   label: 'Yalla Wear: accept or decline' },
  { perm: 'partner.invoice', group: 'partner',   label: 'Yalla Wear: own invoices' }
];
```

That is **31 permissions**, not 28 — `CLAUDE.md` says "28 permissions × 5 roles" (§40).

```js:server/lib/auth.js:99-135
/* --------------------------------------------------- the two hard rules
   Both are enforced here rather than in the Settings screen, because a
   disabled tick box is a suggestion — anyone can send the request by hand. */

/* A manager who removes their own access to Settings or Staff leaves nobody
   able to put it back without opening the database file. */
const PINNED = { manager: ['config.write', 'staff.write'] };

/* Yalla Wear is a different company. These can never be granted to them, no
   matter what the grid says. One mis-clicked box should not be able to hand a
   supplier your customer list and your margins.

   `delivery.*` is on the list for the same reason as `customer.*`, and it is
   easy to miss why: a delivery row carries a customer's name, phone number and
   home address. It is the most personal data in the system. */
const FORBIDDEN = {
  partner: (p) =>
    p === 'customer.read' || p === 'customer.write' ||
    p === 'cost.read' || p === 'profit.read' ||
    p.startsWith('money.') || p.startsWith('staff.') ||
    p.startsWith('delivery.') || p === 'discount.unlimited' ||
    /* A receipt payload carries the customer's name and phone number, so
       this follows customer.* rather than sitting on its own. */
    p === 'sale.reprint' ||
    /* Label printing drives hardware sitting in the shop, keyed to a
       station name a partner has no business addressing. */
    p === 'label.print'
};

export function isPinned(role, perm) {
  return (PINNED[role] || []).includes(perm);
}

export function isForbidden(role, perm) {
  const rule = FORBIDDEN[role];
  return typeof rule === 'function' && rule(perm);
}
```

### Seeded defaults for the customer permissions

```sql:server/migrations/003_role_permissions.sql:56-57
  ('manager','customer.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','customer.write',1,'1970-01-01T00:00:00.000Z'),
```

```sql:server/migrations/003_role_permissions.sql:74,84-85
-- cashier -- sells and handles customers. Deliberately no cost, no profit.
  ('cashier','customer.read',1,'1970-01-01T00:00:00.000Z'),
  ('cashier','customer.write',1,'1970-01-01T00:00:00.000Z'),
```

```sql:server/migrations/003_role_permissions.sql:112-113
  ('warehouse','customer.read',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','customer.write',0,'1970-01-01T00:00:00.000Z'),
```

```sql:server/migrations/003_role_permissions.sql:140-141
  ('delivery','customer.read',1,'1970-01-01T00:00:00.000Z'),
  ('delivery','customer.write',0,'1970-01-01T00:00:00.000Z'),
```

```sql:server/migrations/003_role_permissions.sql:168-169
  ('partner','customer.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','customer.write',0,'1970-01-01T00:00:00.000Z'),
```

### And what the LIVE `role_permissions` table says right now

Queried from `og.db`. This is the matrix the new screen actually runs against:

| perm | manager | cashier | warehouse | delivery | partner |
|---|:---:|:---:|:---:|:---:|:---:|
| `customer.read` | **1** | **1** | 0 | **1** | 0 |
| `customer.write` | **1** | **1** | 0 | 0 | 0 |
| `sell` | 1 | 1 | 0 | 0 | 0 |
| `void` | 1 | 0 | 0 | 0 | 0 |
| `cost.read` | 1 | 0 | 0 | 0 | 0 |
| `profit.read` | 1 | 0 | 0 | 0 | 0 |
| **`money.read`** | **1** | **0** | **0** | **0** | 0 |
| **`money.write`** | **1** | **0** | **0** | **0** | 0 |
| `delivery.read` | 1 | 0 | 0 | 1 | 0 |
| `delivery.write` | 1 | 1 | 0 | 1 | 0 |

**Three consequences that shape the screen:**

1. **The cashier can open Customers and can add/edit them, but has neither `money.read` nor
   `money.write`.** She cannot be shown a balance and cannot take a debt payment. Any debt UI must be
   behind `allow('money.read')` / `allow('money.write')` and must degrade to *nothing* rather than to
   a zero.
2. **The delivery driver has `customer.read`.** He gets the whole customer list — names, phones,
   cities, addresses, lifetime spend — on `Shop.load()`. He does not have `customer.write`, so he
   also does not get archived rows. Whether he should see lifetime spend at all is a question for
   the owner (§41).
3. **The warehouse role has neither**, so `navAllowed('customers')` is false for him and
   `Shop.load()` never requests the list.

## 28. Money formatting, and what happens to a historical sale

### Every helper that turns minor units into a displayed string

```js:js/app-util.js:10-28
function nf(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }

function money(syp) {
  if (OG.currency === 'USD') return '$' + nf((Number(syp) || 0) / CONFIG.EXCHANGE_RATE);
  return nf(syp) + ' ' + (OG.lang === 'ar' ? 'ل.س' : 'SYP');
}

/* Big stat cards: full separators, currency demoted so long numbers still fit. */
function moneyStat(syp) {
  if (OG.currency === 'USD') return '$' + nf((Number(syp) || 0) / CONFIG.EXCHANGE_RATE);
  return nf(syp) + '<span class="cur">' + (OG.lang === 'ar' ? 'ل.س' : 'SYP') + '</span>';
}

function moneyShort(syp) {
  var v = OG.currency === 'USD' ? (Number(syp) || 0) / CONFIG.EXCHANGE_RATE : (Number(syp) || 0);
  return (OG.currency === 'USD' ? '$' : '') + Charts.compact(v);
}

function pct(n, digits) { return (Number(n) || 0).toFixed(digits === undefined ? 1 : digits) + '%'; }
```

And for spreadsheet export:

```js:js/app-util.js:306-314
/* ------------------------------------------------------------ EXPORT SPECS
   Money leaves as a raw number in the active currency so Excel can sum it —
   the unit goes in the column heading instead of into every cell. */

function exCur() { return OG.currency === 'USD' ? 'USD' : 'SYP'; }
function exMoney(v) {
  return Math.round(OG.currency === 'USD' ? (Number(v) || 0) / CONFIG.EXCHANGE_RATE : (Number(v) || 0));
}
function exCol(label) { return label + ' (' + exCur() + ')'; }
```

`Charts.compact` for the short form:

```js:js/charts.js:16-17
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
```

**All four take a SYP-minor-unit number and a global toggle.** There is no per-value currency
parameter anywhere in the browser's formatting layer.

### Where the exchange rate comes from at display time

**`CONFIG.EXCHANGE_RATE` — the single live rate**, refreshed at hydrate from the server's `fx_rates`.
`OG.currency` is a UI toggle in the topbar (`'SYP' | 'USD'`).

### What happens when a historical sale is shown — **is the frozen rate used?**

**On screen: NO. On the receipt and the public invoice page: YES.**

Every `fxRate` reference in the frontend:

```
js/app-documents.js:250   var rate = sale.fxRate || CONFIG.EXCHANGE_RATE;   <-- the printed invoice
js/data.js:2341           fxRate: s.fx_rate || rate                          <-- hydrate
js/pos.js:1102            fxRate: server ? server.fxRate : CONFIG.EXCHANGE_RATE
js/receipt.js:528         '  ·  1$ = ' + western(R.fxRate) + ' SYP'
js/receipt.js:703         fxRate: payload.fx_rate, secondCurrency: second,
js/receipt.js:732-733     if (CONFIG.BASE_CURRENCY === 'SYP' && sale.fxRate) {
                            second = { code: 'USD', amount: sale.total / sale.fxRate };
js/receipt.js:743         total: sale.total, fxRate: sale.fxRate, secondCurrency: second,
```

And the server's public receipt does it properly:

```js:server/lib/receipt.js:161-166
  /* The dollar value AT THE RATE OF THAT DAY, not today's. The customer's
     receipt must say the same thing in a year as it did on the day, which is
     the whole reason the rate is frozen into the row. */
  const usd = sale.fx_rate
    ? (sale.total / Math.pow(10, cur === 'USD' ? 2 : 0) / sale.fx_rate).toFixed(2)
    : null;
```

**`money()`, `moneyStat()`, `moneyShort()` and `exMoney()` never consult `sale.fxRate`.** So with the
topbar toggled to USD, the existing customer drawer's purchase history converts every historical
total at *today's* rate. The frozen rate is hydrated onto `sale.fxRate` and sits there unused by
every on-screen figure. See §38.5.

### Where SYP and USD are shown together

Only in receipt/document code, never in an app screen:

```js:js/receipt.js:732-733
    if (CONFIG.BASE_CURRENCY === 'SYP' && sale.fxRate) {
      second = { code: 'USD', amount: sale.total / sale.fxRate };
```

```js:js/receipt.js:528
        '  ·  1$ = ' + western(R.fxRate) + ' SYP',
```

Settings shows the rate as a fold meta line; `CLAUDE.md` records the rule that matters there — wrap
anything with digits in `<span dir="ltr">` or Arabic drags the leading number to the far end.

## 29. Search — every existing search box, and Arabic normalisation

### Does anything normalise Arabic text for search?

**NO. Nothing, anywhere, in the browser or on the server.**

Greps run across `js/` and `server/`: `أ`, `إ`, `آ`, `ة`, `ى`, `ـ` (tatweel), `ً`
(diacritics), `normalizeAr`, `arNorm`, `tatweel`, `alef`, `taa`, `replace(/[أإآ]/`, `ة/g`, `ى/g`.
**Zero hits.** There is no `String.prototype.normalize()` call in the repo either.

So today:

- `أحمد` and `احمد` are **different customers** to every search box.
- `فاطمة` and `فاطمه` are **different customers**.
- `مصطفى` and `مصطفي` are **different customers**.
- A name typed with a shadda or fatha never matches the same name typed without.
- `ـــ` (tatweel/kashida), which people genuinely type, breaks every match.

The only Arabic-aware code in the whole search path is a *character-class* test — used to decide
whether a query is a phone number, not to normalise it:

```js:js/pos.js:1471-1472
    var digits = q.replace(/\D/g, '');
    var byPhone = digits.length >= 2 && !/[a-z؀-ۿ]/.test(q);
```

`؀-ۿ` is U+0600–U+06FF, the Arabic block. And one more, in the product duplicate guard, which
*preserves* Arabic rather than folding it:

```js:js/data.js:1944-1950
  normaliseName: function (s) {
    return String(s || '')
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
      .trim();
  },
```

**`DB.normaliseName` is the nearest existing precedent for a shared normaliser**, and it is
*products*-only (called by `nameTokens` / `nameSimilarity` / `similarProducts`). It lowercases,
drops apostrophes and collapses punctuation — it does **not** fold alef, taa marbuta, alef maqsura,
diacritics or tatweel. A customer-name normaliser would be new work, and there is a clean place to
put it beside this one.

### The three existing search boxes, and how each filters

**(1) Products** — `q` against name and brand, plain `toLowerCase().indexOf()`:

```js:js/app-products.js:92-98
  h += '<div class="filters">' +
    '<input class="inp grow" type="text" placeholder="' + t('search_ph') + '" value="' + esc(OG.prod.q) + '" data-change="prod-q">' +
    '<select class="inp" data-change="prod-type"><option value="">' + t('all_types') + '</option>';
```

**(2) The global topbar search** — reaches products, customers and invoices, each behind its own
permission (quoted in full in §18c). Customer matching:

```js:js/app-shell.js:477-479
  var custs = !allow('customer.read') ? [] : DB.customers.filter(function (c) {
    return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1;
  }).slice(0, 4);
```

Minimum query length is 2:

```js:js/app-shell.js:466-467
  q = (q || '').trim().toLowerCase();
  if (q.length < 2) { box.innerHTML = ''; return; }
```

**(3) The existing Customers screen** — name, phone (spaces only), city:

```js:js/app-customers-scan.js:18-23
  if (f.q) {
    var q = f.q.toLowerCase();
    list = list.filter(function (c) {
      return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1 || c.city.toLowerCase().indexOf(q) > -1;
    });
  }
```

**(4) The POS picker** — the best of the four, quoted in full in §23. It is the only one that:
distinguishes a phone query from a name query, strips *all* non-digits from the stored phone, caps
the list and says so, and excludes archived people.

**Summary of the state of search:** four independent implementations, four different behaviours, no
shared helper, and no Arabic folding in any of them. The `search_ph` placeholder string
(`"Search products, customers, invoices…"` / `"…"`) is reused verbatim on the Products screen, the
Customers screen and the global box, which is why all three look like the same feature and behave
like three.

## 30. I18N — existing customer-related keys, and whether the en/ar discipline holds

### Does any key exist in `en` but not in `ar`?

I evaluated `js/app-i18n.js` and `js/app-i18n-extra.js` together in a Node VM sandbox (both files
concatenated, `OG`/`CONFIG` stubbed) and diffed the two key sets:

```
en keys: 1232   ar keys: 1232

in en, MISSING in ar : 0   (none)
in ar, MISSING in en : 0   (none)

present in both but IDENTICAL string : 2   ->  pdf, or_by_og
```

**The discipline is holding, exactly. 1,232 keys on each side, zero drift in either direction.**
The two identical strings are `pdf` (a format name) and `or_by_og` (contains the brand), both
legitimately untranslated.

The merge mechanism, for reference:

```js:js/app-i18n-extra.js:439-442
Object.keys(EXTRA_EN).forEach(function (k) { I18N.en[k] = EXTRA_EN[k]; });
Object.keys(EXTRA_AR).forEach(function (k) { I18N.ar[k] = EXTRA_AR[k]; });
Object.keys(EXTRA_V3_EN).forEach(function (k) { I18N.en[k] = EXTRA_V3_EN[k]; });
Object.keys(EXTRA_V3_AR).forEach(function (k) { I18N.ar[k] = EXTRA_V3_AR[k]; });
```

and the lookup, which falls back to English then to the key itself:

```js:js/app-i18n.js:1086-1087
  var d = I18N[OG.lang] || I18N.en;
  return (d[key] !== undefined ? d[key] : (I18N.en[key] !== undefined ? I18N.en[key] : key));
```

### Existing keys for customers, debt, phone, address, points and tiers

Matched on `cust|^cu_|debt|credit|phone|address|city|loyal|point|tier|gold|silver|bronze|walk_in|whatsapp|spent|visit|purchase|risk|archiv|source|online|in_store|name$|note|owe`.
The directly relevant ones (113 matched in total; noise from the label/shelf/yalla namespaces trimmed):

| key | `I18N.en` | `I18N.ar` |
|---|---|---|
| `customers_title` | `Customers` | `الزبائن` |
| `customers_sub` | `Who buys, what they buy, when they stopped` | `من يشتري وماذا يشتري ومتى توقّف` |
| `nav_customers` | `Customers` | `الزبائن` |
| `pg_customers` | `Customers` | `الزبائن` |
| `customer` | `Customer` | `الزبون` |
| `customer_ph` | `Pick a customer, or type to search…` | `اختر زبوناً أو اكتب للبحث…` |
| `change_customer` | `Change` | `تغيير` |
| `cp_customer` | `customer` | `زبون` |
| `walk_in` | `Walk-in customer` | `زبون عابر` |
| `all_customers` | `All customers` | `كل الزبائن` |
| `cu_new` | `New customer` | `زبون جديد` |
| `cu_new_note` | `Three fields is all it takes. Points start at zero and build from the first sale.` | `ثلاث خانات وبس. النقاط تبدأ من صفر وتزيد من أول عملية بيع.` |
| `cu_name_ph` | `Full name` | `الاسم الكامل` |
| `cu_exists` | `Already in the list` | `موجود في القائمة` |
| `cu_more` | `{n} more — keep typing to narrow it down` | `و{n} غيرهم — تابع الكتابة لتضييق النتائج` |
| `name` | `Name` | `الاسم` |
| `phone` | `Phone` | `الهاتف` |
| `city` | `City` | `المدينة` |
| `source` | `Source` | `المصدر` |
| `notes` | `Notes` | `ملاحظات` |
| `online` | `Online` | `أونلاين` |
| `in_store` | `In-store` | `من المحل` |
| `total_spent` | `Total spent` | `إجمالي الإنفاق` |
| `last_purchase` | `Last purchase` | `آخر شراء` |
| `purchase_history` | `Purchase history` | `سجل المشتريات` |
| `at_risk` | `At risk` | `معرّض للفقدان` |
| `risk_only` | `At risk only` | `المعرّضون فقط` |
| `gold_only` | `Gold only` | `الذهبيون فقط` |
| `tier` | `Tier` | `الفئة` |
| `gold` / `silver` / `bronze` | `Gold` / `Silver` / `Bronze` | `ذهبي` / `فضي` / `برونزي` |
| `loyalty` | `Loyalty` | `الولاء` |
| `loyalty_rules` | `Loyalty rules` | `قواعد الولاء` |
| `points` | `points` | `نقطة` |
| `points_earned` | `Loyalty points earned` | `نقاط الولاء المكتسبة` |
| `points_timeline` | `Loyalty timeline` | `سجل نقاط الولاء` |
| `point_value` | `Value of 1 point` | `قيمة النقطة الواحدة` |
| `points_per` | `Points per 1,000 SYP spent` | `نقاط لكل ١٠٠٠ ل.س` |
| `use_points` | `Use` | `استخدم` |
| `preferred_sizes` | (used at `app-customers-scan.js:122`) | — |
| `st_customers` | `Active customers` | `الزبائن النشطون` |
| **`mn_debt`** | `Debt book` | `دفتر الدين` |
| **`mn_owed`** | `owed to you` | `لك عند الزبون` |
| **`mn_owed_total`** | `Owed to you` | `لك عند الزبائن` |
| **`mn_still_owed`** | `Still owed` | `المتبقي` |
| **`mn_debt_settled`** | `Debt settled` | `ديون محصّلة` |
| **`mn_no_debt`** | `Nobody owes you anything` | `لا أحد مدين لك` |
| **`mn_no_debt_sub`** | `Credit sales appear here until they are paid` | `مبيعات الدين تظهر هنا حتى تُسدَّد` |
| `dl_address` | `Address` | `العنوان` |
| `dl_address_ph` | `street, building, flat — enough to find the door` | `الشارع والبناء والطابق — ما يكفي للوصول للباب` |
| `dl_no_address` | `Type an address first` | `اكتب العنوان أولاً` |
| `dl_phone` | `Phone` | `الهاتف` |
| `dl_owed` | `To collect today` | `للتحصيل اليوم` |
| `dl_nothing_owed` | `Already paid` | `مدفوع مسبقاً` |
| `bk_archive` | `Archive` | `أرشفة` |
| `bk_archived` | `archived` | `مؤرشف` |
| `bk_archived_only` | `Archived` | `المؤرشف` |
| `bk_points` | `+250 points` | `+٢٥٠ نقطة` |
| `bk_delete_note` | `Archiving is usually what you want — it hides them but keeps the history. Delete cannot be undone once the Undo toast disappears.` | `الأرشفة غالباً هي المطلوب — تخفيها وتحتفظ بالسجل. الحذف لا يمكن التراجع عنه بعد اختفاء التنبيه.` |
| `whatsapp` | `WhatsApp number` | `رقم الواتساب` |
| `whatsapp_msg` | `WhatsApp message` | `رسالة واتساب` |
| `send_whatsapp` | `Send WhatsApp` | `إرسال واتساب` |
| `wa_bad_number` | `That phone number is not usable` | `رقم الهاتف غير صالح` |
| `wa_handoff` | `This opens WhatsApp with the message written. You press send there.` | `يفتح واتساب والرسالة مكتوبة. الإرسال يتم من هناك.` |
| `rc2_customer` | `Customer` | `الزبون` |
| `rc2_points_balance` | `Points balance` | `رصيد النقاط` |
| `rc2_points_earned` | `Points earned` | `نقاط مكتسبة` |
| `rc2_points_used` | `Points used` | `نقاط مستخدمة` |
| `partner_note` | `This is everything the printing partner can see. No costs, no customer phone numbers, no stock, no prices you charge.` | `هذا كل ما يراه شريك الطباعة. لا تكاليف، لا أرقام هواتف زبائن، لا مخزون، ولا أسعارك.` |

**Notes on tone, for matching new strings:**

- Arabic here is **Levantine-leaning colloquial where a person is being spoken to** (`ثلاث خانات وبس`
  — "three fields and that's it"), and **formal where it is a label** (`إجمالي الإنفاق`). Follow the
  neighbouring key, not a single rule.
- Arabic-Indic numerals appear in *strings* (`+٢٥٠ نقطة`, `١٠٠٠ ل.س`) but **never** through `nf()`,
  which is hard-coded `toLocaleString('en-US')`. Do not mix the two in one line.
- `mn_*` is the money namespace, `dl_*` deliveries, `bk_*` bulk, `cu_*` the customer form, `rc2_*`
  the receipt. **A new Customers screen should use `cu_*`** — it is the established prefix and is
  currently only five keys deep.
- The debt vocabulary already exists in full (`mn_debt`, `mn_owed`, `mn_still_owed`,
  `mn_no_debt`…), so a debt section on the customer screen needs **no new strings** if it reuses
  them.

## 31. CSS — the class vocabulary available for reuse

Extracted from all ten files in `css/`. Grouped by job, with a one-line purpose each.

### Page structure
| Class | Purpose | File |
|---|---|---|
| `.page-head` | screen title block; `flex`, wraps | `motion-cards.css:74` |
| `.page-head h1` / `.sub` | title / subtitle line | `motion-cards.css:75-76` |
| `.head-actions` | right-aligned button cluster in the head | `motion-cards.css:77` |
| `.grid` | generic grid container (inline `grid-template-columns`) | `motion-cards.css` |
| `.eyebrow` | small uppercase label above a value | `motion-cards.css:79` |
| `.spacer`, `.mt`, `.mt-lg`, `.mb` | spacing utilities | `bulk-gate-responsive.css:295` |

### Cards and stats
| Class | Purpose |
|---|---|
| `.card` | the standard surface panel |
| `.card-head` + `h3` | card title bar |
| `.card-actions` | right-aligned controls inside `.card-head` |
| `.card-body` | padded card content |
| `.stat` | one KPI cell |
| `.stat .val` | the big number; `.val.accent` / `.val.warn` for colour |
| `.stat .foot` | the small line under the number |
| `.stat-row` | a 6-across stat strip |
| `.delta` (`.up`/`.down`/`.flat`) | the ▲/▼ change tag, built by `deltaTag()` |

### Tables
| Class | Purpose |
|---|---|
| `.table-wrap` | the scroll container — **always wrap a table in this** |
| `.tbl` | the base table |
| `.tbl-compact` | tighter row height |
| `.tbl-cards` | added automatically on phones (§32) — do not hand-apply |
| `td.num` / `.num` | tabular-nums, end-aligned |
| `tr.clickable` | row hover + pointer |
| `.cell-prod` | the name+thumb cell that must not overflow |

### Forms and inputs
| Class | Purpose |
|---|---|
| `.field` | one labelled form row (`<label class="field"><span>…</span><input…>`) |
| `.lbl` | a standalone label above a control |
| `.inp` | the input/select/textarea skin; `.inp.num` for numeric, `.inp.grow` inside `.filters` |
| `.filters` | the filter bar: flex, wraps, 10px gap |
| `.chip-row` / `.chip` / `.chip.on` | the filter-chip group |
| `.seg` / `.seg-row` | segmented toggle |
| `.switch`, `.check` | toggle and checkbox |
| `.stepper` | −/+ quantity control |
| `.upload-box`, `.up-img`, `.up-x`, `.up-swap`, `.up-empty` | image upload |
| `.selectbox` family: `.sbx-panel`, `.sbx-opt`, `.sbx-tick`, `.sbx-txt`, `.sbx-empty` | the custom select (`js/selectbox.js`) |

### Buttons
| Class | Purpose |
|---|---|
| `.btn` | base |
| `.btn-primary` | brand fill — the one affirmative action |
| `.btn-ghost` | outline/secondary |
| `.btn-dark`, `.btn-sm`, `.btn-lg`, `.btn-block` | variants |
| `.icon-btn` | square icon-only |
| `.keycap` | the F2-style keyboard hint |

### Badges, tags, status
| Class | Purpose |
|---|---|
| `.badge` | base pill |
| `.badge.critical` | red — used for `at_risk` today |
| `.badge.neutral` | grey — counts |
| `.badge.gold` / `.silver` / `.bronze` | **the loyalty tiers already have badge colours** |
| `.dot`, `.dot-new`, `.tab-dot`, `.tb-dot` | small status dots |
| `.note-ok` / `.note-warn` / `.note-danger` | inline coloured note blocks |
| `.partner-note` | the muted explanatory paragraph under a form |
| `.muted`, `.small`, `.nowrap`, `.strong-num` | text utilities |

### Overlays
| Class | Purpose |
|---|---|
| `.modal-backdrop` / `.modal` / `.modal-head` / `.modal-body` / `.modal-foot` | `openModal()` |
| `.modal.narrow`, `.modal.sheet`, `.modal-backdrop.as-sheet` | size / phone-sheet variants |
| `.drawer-backdrop` / `.drawer` / `.drawer-head` / `.drawer-body` | `openDrawer()` |
| `.toasts` / `.toast` / `.toast-act` | `toast()` |
| `.cp`, `.cp-row`, `.cp-list`, `.cp-empty` | the command palette |

### Empty states
There is **no `.empty-state` class.** Three idioms exist:
- **`.cart-empty`** — the big centred one, with a `<b>` headline and body text. Despite the name it
  is the general-purpose empty state; the debt book uses it
  (`js/money.js:234-235`). **This is the one to reuse.**
- `<span class="muted">' + t('none') + '</span>` — the inline "nothing here" (`app-customers-scan.js:135`).
- Namespace-local ones: `.nt-empty`, `.yl-col-empty`, `.sbx-empty`, `.sm-empty`, `.up-empty`.

### Customer-specific classes that already exist
All in `css/dialogs-customers-jobs.css` — **this is the file a new Customers screen should extend**:

| Class | Purpose | Line |
|---|---|---|
| `.cust-grid` | `repeat(auto-fill, minmax(272px, 1fr))`, 12px gap | 85 |
| `.cust-card` | the card, with `:hover` lift | 86-91 |
| `.cust-card.risk` | red border + soft red ground | 92 |
| `.cc-top` | avatar + name + tier row | 93 |
| `.cc-av` | the round initials avatar | 94 |
| `.cc-top b` / `.cc-top small` | name / sub-lines (tabular-nums) | 99-100 |
| `.cc-stats` | the 2×2 stat block under the divider | 101-103 |
| `.timeline`, `.timeline li.plus` | the points timeline | 105-109 |

And the POS picker's, in `css/inputs-dashboard-pos.css`: `.cust-box`, `.cust-drop`, `.cust-row`,
`.cust-add`, `.cust-hint`, `.cust-caret`, `.cust-picked`, `.cr-txt`.

### Bulk-select
`.bk-bar`, `.bk-box`, `.bk-corner`, `.bk-count`, `.bk-col`, `.bk-inline`, `.bk-danger`, `.bk-x`, and
the `.bk-on` state on a selected card. The Customers screen already participates
(`js/app-customers-scan.js:56-58`).

## 32. Mobile / narrow layout convention

**Yes, there is a clear one, and it is automatic.**

### Breakpoints in use
```
560px   topbar sheds controls into the More sheet
720px   the main phone breakpoint: tab bar appears, sidebar goes, tables become cards
900px   two-column layouts collapse
1240px / 1400px  dashboard grid reflows
```

### Tables become cards — and the app does it for you

```js:js/app-routing.js:188-211
    thirty hand-written tables, the labels are copied from the header row here,
    once per render.

    The class is added at every width — the CSS that acts on it only exists
    inside the phone breakpoint, so desktop is untouched and there is no JS
    breakpoint to drift out of sync with the stylesheet. */
function labelWideTables(root) {
  if (!root) return;
  root.querySelectorAll('table.tbl').forEach(function (tbl) {
    var ths = tbl.querySelectorAll('thead th');
    /* Narrow tables read fine as tables; restacking them wastes vertical
       space and makes them harder to scan, not easier. */
    if (ths.length < 5) return;
    var heads = [].map.call(ths, function (th) { return th.textContent.trim(); });
    tbl.classList.add('tbl-cards');
    tbl.querySelectorAll('tbody tr').forEach(function (tr) {
      [].forEach.call(tr.children, function (td, i) {
        if (heads[i] && !td.getAttribute('data-l')) td.setAttribute('data-l', heads[i]);
      });
    });
  });
}
```

```css:css/bulk-gate-responsive.css:468-494
  /* ---- wide tables become cards --------------------------------------
     A nine-column table at 320px is unusable however it scrolls. Below this
     width the primary tables restack: each row becomes a block, and each
     cell carries its own label from the data-l attribute the renderer sets.
     The header row is hidden because every cell now labels itself. */
  .tbl-cards thead { display: none; }
  .tbl-cards, .tbl-cards tbody, .tbl-cards tr, .tbl-cards td { display: block; width: 100%; }
  .tbl-cards tr {
    background: var(--surface-1); border-radius: var(--radius);
    padding: 12px 14px; margin-bottom: 10px;
  }
  .tbl-cards tr + tr td { box-shadow: none; }
  .tbl-cards td {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 5px 0; text-align: start; border: 0;
  }
  .tbl-cards td::before {
    content: attr(data-l); flex: none;
    font-size: var(--fs-micro); font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: var(--dim);
  }
  /* The first cell is the identity of the row — it gets the full width and
     no label, because a product name does not need to be told it is one. */
  .tbl-cards td:first-child { padding-bottom: 9px; }
  .tbl-cards td:first-child::before { content: none; }
  .tbl-cards td.num { justify-content: space-between; }
  .tbl-cards .cell-prod { min-width: 0; }
```

**The rule for the builder: build a `<table class="tbl">` with a real `<thead>`, wrap it in
`.table-wrap`, and give it 5+ columns. The phone layout is then free.** Fewer than 5 columns and it
deliberately stays a table. Do **not** hand-write `.tbl-cards` or `data-l`.

**The existing Customers screen never benefits from this** — it is a `.cust-grid` of `<div>` cards,
not a table. `.cust-grid` is `auto-fill minmax(272px, 1fr)`, so it degrades to one column on a phone
by itself, which works but means the two layouts share nothing.

### Touch targets and tap flash
```css:css/bulk-gate-responsive.css:496-505
  /* --- touch targets ---------------------------------------------------
     A phone has no hover and a fingertip is about 9mm. Controls sized for a
     mouse at 32px are genuinely hard to hit. */
  .btn-sm { height: 38px; padding: 0 14px; }
  .stepper button, .cl-del, .up-x, .modal-head .x { min-width: 38px; min-height: 38px; }
  .chip { padding: 9px 14px; }
  /* The default blue tap flash fights the brand on every single tap. */
  * { -webkit-tap-highlight-color: rgb(198 255 0 / .14); }
  /* Hover-only affordances need a pressed state instead. */
  .yl-card:active, .pcard:active, .st-card:active, .kcard:active { background: var(--surface-2); }
```

**`.cust-card` is not in that `:active` list** — every other card type has a pressed state on a phone
and the customer card does not. A small, real gap worth closing.

### The tab bar and the page head
```css:css/bulk-gate-responsive.css:359-367
@media (max-width: 720px) {
  :root { --tabbar-h: calc(58px + env(safe-area-inset-bottom, 0px)); }

  .tabbar {
    display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
    position: fixed; inset-inline: 0; bottom: 0; z-index: 340;
    height: var(--tabbar-h); padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--sidebar); border-top: 1px solid var(--sidebar-border);
  }
```

```css:css/bulk-gate-responsive.css:518-519
  .page-head { gap: 10px; margin-bottom: 16px; }
  .page-head .head-actions { width: 100%; margin-inline-start: 0; }
```

The tab bar is always in the DOM and hidden by CSS above 720px — `index.html:38-40` says so
explicitly: *"Always in the DOM, hidden by CSS above 720px, so a window resize needs no re-render and
there is no JS breakpoint to drift."* **Follow that: no JS breakpoints.**

### RTL
Everything uses logical properties (`margin-inline-start`, `padding-inline-start`, `inset-inline`,
`text-align: start`). There are no `left`/`right` physical properties in the layout classes. The one
manual intervention needed is `tel()` / `<bdi dir="ltr">` around Latin runs — phone numbers,
addresses, SKUs, invoice ids — and `<span dir="ltr">` around any string that *starts* with a number.

---

# Part 5 — The links to work already in flight

## 33. Telegram / receipts

### Is there a Telegram bot in this repo? **NOT FOUND.**

Greps for `getUpdates`, `webhook`, `sendMessage`, `api.telegram.org`, `bot<digits>`, across `js/`,
`server/`, `agent/`, `*.sql`, `*.json`: **zero hits.** `server/.env.example` contains no
Telegram or bot key. There is no polling code, no bot token, no webhook route.

### Is there any table or column that could hold a Telegram `chat_id` per customer? **No.**

`customers` has 12 columns and none of them is a chat/messaging identifier (§7). The nearest thing in
the whole schema is `wa_messages.phone`, which is a phone string, not an account id.

### What DOES exist: Telegram as a printed URL, and an explicit note that the bot is future work

The config key:

```sql:server/migrations/019_receipt_contact.sql:23-26
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('receipt.instagram', 'https://www.instagram.com/og_sports_1',   '1970-01-01T00:00:00.000Z'),
  ('receipt.telegram',  'https://t.me/ogsports1',                  '1970-01-01T00:00:00.000Z'),
  ('receipt.maps_url',  'https://maps.app.goo.gl/i5VcMRV8sg4c7E639','1970-01-01T00:00:00.000Z');
```

**And the migration header names the bot as a thing that does not exist yet:**

```sql:server/migrations/019_receipt_contact.sql:1-13
-- =============================================================================
--  A contact block on the receipt: Instagram, Telegram, the shop's map link
-- -----------------------------------------------------------------------------
--  The customer is standing in the shop, so the printed street address
--  (shop.address, read by js/receipt.js's drawHeader()) stops being useful the
--  moment they walk out holding this paper -- what's actually useful after
--  that is how to find the shop again and how to reach it online. Values are
--  full URLs (not bare @handles) so the same field doubles as the QR payload
--  placeholder used until the Telegram bot exists (see the follow-up migration
--  that wires the real t.me/<bot>?start=<token> link) and as printed text --
--  js/receipt.js strips the https://(www.) prefix for the shorter printed
--  line, deriving one display form from one stored fact rather than keeping a
--  handle and a URL that could quietly drift apart.
```

**"the follow-up migration that wires the real `t.me/<bot>?start=<token>` link" has not been
written.** The highest migration is `026_rooms.sql`; nothing between 019 and 026 touches Telegram.

The live config value confirms it is still the plain channel URL:
`receipt.telegram = https://t.me/ogsports1`.

Where it is used — printed text only, on both the thermal slip and the public page:

```js:js/receipt.js:583-585
    if (!R.instagram && !R.telegram && !R.mapsUrl) return y;
    ...
    if (R.telegram) y = iconTextRow(ctx, y, tgImg, shortUrl(R.telegram), 18);
```

```js:server/lib/receipt.js:182
    link(rc.telegram, 'Telegram'),
```

Settings exposes it as a plain text field:

```js:js/app-settings.js:457-458
    '<label class="field"><span>' + t('rc3_telegram') + '</span>' +
      '<input class="inp num" dir="ltr" id="rcTelegram" value="' + esc(CONFIG.RECEIPT_TELEGRAM) + '"' + dis + '></label>' +
```

The asset `assets/telegram-mark.svg` exists and is precached (`sw.js:37`).

### What the receipt DOES carry about a customer

`server/lib/printing.js` builds the payload, and it joins the customer deliberately:

```js:server/lib/printing.js:50-72
  const sale = get().prepare(
    `SELECT s.id, s.at, s.customer_id, s.customer_name, s.wh_id, s.payment,
            s.currency, s.subtotal, s.discount, s.total, s.fx_rate, s.fx_base,
            s.voided, s.points_used, s.points_earned, s.txn_ref, s.public_token,
            u.name AS cashier_name
       FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.id = ?`
  ).get(saleId);
  if (!sale) return null;

  sale.items = get().prepare(
    `SELECT sku, name, size, qty, unit_price FROM sale_items
      WHERE sale_id = ? ORDER BY id`
  ).all(saleId);

  /* Walk-in: the whole customer block is omitted client-side, not sent as a
     row of nulls — a receipt with an empty "Customer:" line reads as a bug,
     not as "no customer". */
  sale.customer = sale.customer_id
    ? get().prepare(
        'SELECT name, phone, loyalty_points FROM customers WHERE id = ?'
      ).get(sale.customer_id)
    : null;
```

**This is the only place `customers` is joined onto a sale**, and it is `name, phone,
loyalty_points` only. It is also why `sale.reprint` is in the partner `FORBIDDEN` list (§18a) —
the payload carries a name and a phone number.

The public receipt page (`GET /i/:token`, no login) is deliberately narrow:

```js:server/lib/receipt.js:39
   `SELECT s.id, s.at, s.customer_name, s.currency,
```

```js:server/lib/receipt.js:328
  ${sale.customer_name ? `<div class="meta"><span>Customer</span><span>${esc(sale.customer_name)}</span></div>` : ''}
```

**Only `customer_name` reaches the public page — never the phone, never the points balance.** Worth
preserving if the customer screen ever links out to it.

### `wa_messages` — the messaging log that exists but is never written

```js:server/lib/partner.js:490-497
/* ---- what was sent out -------------------------------------------------- */

export function logWhatsApp({ phone, body, kind = null, refType = null, refId = null, userId = null }) {
  const d = DB.get();
  d.prepare(
    'INSERT INTO wa_messages (at, phone, body, kind, ref_type, ref_id, user_id) VALUES (?,?,?,?,?,?,?)'
  ).run(nowIso(), phone, body, kind, refType, refId, userId);
}
```

**`logWhatsApp` has ZERO callers.** A repo-wide grep returns only its own definition. There is no
route that calls it and no browser code that reaches it. The table has 0 rows and is read only here:

```js:server/lib/partner.js:85
    waMessages: d.prepare('SELECT * FROM wa_messages ORDER BY at DESC LIMIT 200').all()
```

Meanwhile the browser keeps its own in-memory log that is **never persisted**:

```js:js/whatsapp.js:36-46
  /* Every send is recorded, so the demo can show a history rather than a
     one-off action that leaves no trace. */
  function log(entry) {
    DB.waMessages.unshift({
      id: 'WA-' + pad(DB.waMessages.length + 1, 4),
      at: new Date(),
      to: entry.to, name: entry.name || '',
      kind: entry.kind || 'note',
      text: entry.text || ''
    });
  }
```

**So every win-back message the Customers screen sends today is forgotten on refresh** — the server
function to record it exists, the table exists, and nothing connects them. See §39.

## 34. Deliveries — where the address comes from

**It is typed per delivery, and only *seeded* from the customer.** `customers.address` exists but is
explicitly documented as a default, not the source of truth.

The migration says so:

```sql:server/migrations/004_deliveries.sql:21-27
-- --------------------------------------------------------------- an address
--  On the customer, and nullable, because most customers never have anything
--  delivered. It is only ever the DEFAULT offered at the till: the real address
--  lives on the delivery row, since the same person has a parcel sent to their
--  shop one week and their flat the next, and overwriting the customer record
--  each time would quietly lose both.
ALTER TABLE customers ADD COLUMN address TEXT;
```

and the delivery row repeats it:

```sql:server/migrations/004_deliveries.sql:42-44
  -- Copied, not joined. A delivery note is a record of what he was told that
  -- morning; editing the customer later must not rewrite where he was sent.
  address     TEXT NOT NULL,
```

### **Yes, `customers` has an address column** — `address TEXT`, nullable, added by migration 004
(§7). It is `NULL` on the one live customer.

### The write-back, verbatim — and it is write-once

```js:server/lib/deliveries.js:130-190
export function assign({ saleId, driverId, address, phone, note, byUserId, opId }) {
  if (!saleId) throw new Error('which sale is going out?');
  if (!address || !String(address).trim()) {
    throw new Error('a delivery needs an address — where is he taking it?');
  }

  if (opId) {
    const seen = get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };
  }

  return tx((d) => {
    const sale = d.prepare(
      'SELECT id, total, currency, payment, voided, customer_id FROM sales WHERE id = ?'
    ).get(saleId);

    if (!sale) throw new Error(`no such sale: ${saleId}`);
    if (sale.voided) throw new Error('that sale was voided — it is not going anywhere');

    const already = d.prepare('SELECT id FROM deliveries WHERE sale_id = ?').get(saleId);
    if (already) throw new Error(`${saleId} is already out for delivery`);

    if (driverId) {
      const drv = d.prepare('SELECT id, active FROM users WHERE id = ?').get(driverId);
      if (!drv) throw new Error('no such driver');
      if (!drv.active) throw new Error('that account is switched off');
    }

    /* Cash on delivery is the only payment type where money is still owed when
       the goods leave. Everything else was settled at the till. */
    const toCollect = sale.payment === 'cod' ? sale.total : 0;

    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO deliveries
         (sale_id, driver_id, status, address, phone, note,
          to_collect, collected, currency, assigned_at, assigned_by)
       VALUES (?, ?, 'waiting', ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(saleId, driverId ?? null, String(address).trim(),
          phone ?? null, note ?? null, toCollect, sale.currency, at, byUserId ?? null);

    const id = Number(info.lastInsertRowid);

    /* Remember it on the customer as the address to offer next time, but only
       when they have none — never overwrite one someone typed deliberately. */
    if (sale.customer_id) {
      const touched = d.prepare(
        `UPDATE customers SET address = ?, updated_at = ?
          WHERE id = ? AND (address IS NULL OR address = '')`
      ).run(String(address).trim(), at, sale.customer_id);

      /* customers is cursor-shape in the mirror, so a write nobody logs never
         leaves this machine. The WHERE is conditional — most of the time the
         customer already has an address and nothing changes — so log only when
         a row actually moved, rather than queueing a no-op push per delivery. */
      if (touched.changes > 0) {
        logChange('customers', String(sale.customer_id), 'update', byUserId, null);
      }
    }

    logChange('deliveries', String(id), 'insert', byUserId, null);
```

And the till pre-fills the delivery form from the customer:

```js:js/pos.js:543-546
      /* Pre-filled from the customer when we have one, because the commonest
         ... */
      var cust = S.customerId ? DB.customer(S.customerId) : null;
```

**Facts the customer screen needs:**

- `deliveries` has **no `customer_id`**. To list a person's deliveries you must join through
  `sales`: `deliveries.sale_id → sales.id → sales.customer_id`. No route does this today, and
  `GET /api/deliveries` is `requirePerm('delivery.read')` — which the **cashier does not have**.
- `customers.address` is written **once, ever**, by `Deliveries.assign`, and only when it was empty.
  A customer whose address changes keeps the old one forever — **there is no UI to edit it** (§39).
- `to_collect` is read from the sale, never the request: `sale.payment === 'cod' ? sale.total : 0`.
  **This is COD money owed by the driver, not customer debt** — do not merge the two on one screen.
- The four live deliveries carry addresses 18–48 characters long, two with a phone and two without.

## 35. `clubs` — what it is, who writes to it, and whether it touches customers

**`clubs` is the football-jersey catalogue for Yalla Wear's print jobs. It has nothing whatever to
do with customers.**

```sql:server/migrations/015_partner.sql:58-67
-- -------------------------------------------------------------------- clubs
--  The jersey catalogue a kit line points at. Both languages, because a kit
--  sheet is read on the shop floor in Arabic and by the printer in English.
CREATE TABLE IF NOT EXISTS clubs (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_ar    TEXT,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL
);
```

**Every reference in the repo:**

```
server/lib/partner.js:82      SELECT * FROM clubs WHERE archived = 0 ORDER BY name    (read)
server/scripts/supabase-sync.js:698    mirrorTable('clubs', ['code'], …)               (mirror-shape sync)
server/scripts/supabase-restore.js:74,118-120   in ORDER and in SEEDED
js/data.js:393                var CLUBS = {};
js/data.js:612                clubs: CLUBS,
js/data.js:2551-2556          hydrate: CLUBS[c.code] = [c.name, c.name_ar || c.name];
js/ylinvoice.js:197-207,603,692-693    the kit-line club picker on the partner invoice
```

**Who writes to it: nothing in the application.** There is no `POST /api/clubs`, no
`saveClub`, no admin screen. The nine rows are planted by migration 015 and
`supabase-restore.js` lists `clubs` under `SEEDED` for that reason:

```js:server/scripts/supabase-restore.js:118-120
  /* the migration plants the nine clubs the shop prints, so this is never
     ... */
  'clubs'
```

Live row count: **9**.

It is reached only through `GET /api/partner`, which is
`requirePerm(['print.read','partner.jobs'])` — not a customer permission.

**Conclusion: `clubs` is out of scope for the Customers screen.** No FK, no shared column, no shared
route, no shared permission.

## 36. Print jobs — do they reference a customer?

**Only by a free-text name. There is no foreign key.**

```sql:server/migrations/015_partner.sql:74-88
CREATE TABLE IF NOT EXISTS print_jobs (
  id         TEXT PRIMARY KEY,
  customer   TEXT    NOT NULL,
  phone      TEXT,
  design     TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'bulk'   CHECK (kind IN ('bulk','kit')),
  priority   TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  stage      TEXT    NOT NULL DEFAULT 'design'
             CHECK (stage IN ('design','sent','printing','delivery','done')),
  qty        INTEGER NOT NULL DEFAULT 0,   -- bulk only; a kit's comes from its lines
  currency   TEXT    NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  price      INTEGER NOT NULL DEFAULT 0,   -- what the customer pays
  cost       INTEGER,                      -- what Yalla Wear charges; null = not agreed
  deadline   TEXT,
  sale_id    TEXT    REFERENCES sales(id), -- set when the till raised it
```

- **`customer TEXT NOT NULL`** — a typed name. Not `customer_id`. Not indexed.
- **`phone TEXT`** — a second typed string, unrelated to `customers.phone`.
- **`sale_id TEXT REFERENCES sales(id)`** — *this* is the only real link, and it is optional
  ("set when the till raised it").

**So there are two possible ways to show a person's print jobs, and neither is free:**

1. **Via the sale**: `print_jobs.sale_id → sales.id → sales.customer_id`. Correct and typed, but only
   covers jobs the till raised, and `sale_id` is `NULL` for a job entered directly on the print board.
2. **By matching `print_jobs.customer` against `customers.name`**: covers more, but it is string
   matching on free text, with no normalisation (§29), across two scripts. It will produce wrong
   matches in Aleppo, where the duplicate-guard comment itself observes that most people are called
   Ahmad (`js/app-actions.js:765-766`).

`print_jobs` is currently **empty (0 rows)**, so neither path has ever been exercised against data.

**Permission note:** print jobs arrive via `GET /api/partner`, gated on
`['print.read','partner.jobs']`. A cashier with `customer.read` may have neither. And `price` is
withheld from the partner while `cost`/`unit_cost` are withheld from anyone without `cost.read` —
so a "their print jobs" panel on a customer screen has to be permission-gated twice.

## 37. Alerts — anything about customers or debt, and the `notification_reads` key format

### Customer or debt alerts: **NOT FOUND.**

`server/lib/alerts.js` produces exactly **six** kinds of alert. None concerns a customer, a credit
sale, or an overdue debt:

| Key format | Condition | Permission | Line |
|---|---|---|---|
| `stock:<sku>` | a live variant at zero stock (max 3) | `stock.read` OR `product.read` | 62 |
| `job:<id>` | print job past its deadline (max 3) | `print.read` | 74 |
| `supplier:<id>` | **supplier** debt due within 30 days (max 3) | `money.read` | 90 |
| `critical` | count of SKUs at 1..`stock.critical` | `stock.read` | 105 |
| `payroll` | soonest employee payment | `staff.read` | 122 |
| `po:<id>` | purchase order sent, not received, 14+ days (max 2) | `stock.read` | 139 |

**The one money alert is about what the shop OWES a supplier, not what a customer owes the shop:**

```js:server/lib/alerts.js:79-95
  /* What the shop owes. Money, so it is money.read — not something a cashier
     who can see the stock screen is thereby entitled to. */
  if (can('money.read')) {
    d.prepare(
      `SELECT id, name, outstanding, currency, due_date FROM suppliers
        WHERE archived = 0 AND outstanding > 0 AND due_date IS NOT NULL
        ORDER BY due_date ASC LIMIT 3`
    ).all().forEach((r) => {
      const left = daysUntil(r.due_date);
      if (left === null || left > 30) return;
      out.push({
        key: 'supplier:' + r.id, icon: '$', tone: left < 0 ? 'red' : 'amber', view: 'reports',
        text: `${r.name} — ${r.outstanding.toLocaleString('en-US')} ${r.currency}` +
              (left < 0 ? ` overdue by ${-left} days` : ` due in ${left} days`)
      });
    });
  }
```

**There is no `debt:<saleId>` or `customer:<id>` alert, and no "X has owed you Y for Z days".**
`DB.debtAgeing()` exists in the browser (`js/data.js:1714-1720`) and feeds the Money screen, but
nothing feeds the bell. That is a genuine gap, and adding one is a natural companion to this screen
(§39).

### The `notification_reads` key format

The alert's `key` field **is** the read-state key, verbatim — no transformation:

```js:server/lib/alerts.js:144-149
  const seen = new Set(
    d.prepare('SELECT key FROM notification_reads WHERE user_id = ?').all(user.id).map((r) => r.key)
  );
  return out.slice(0, 8).map((n) => Object.assign({ read: seen.has(n.key) }, n));
}
```

```js:server/lib/alerts.js:151-172
/* One alert, or every one currently showing when nothing is named. */
export function markRead(user, key) {
  return DB.tx(() => {
    const d = DB.get();
    const keys = key ? [key] : list(user).map((n) => n.key);
    const ins = d.prepare(
      'INSERT OR IGNORE INTO notification_reads (user_id, key, read_at) VALUES (?,?,?)'
    );
    let n = 0;
    for (const k of keys) n += ins.run(user.id, k, nowIso()).changes;

    /* Anything that is no longer alerting is dropped, so this cannot grow
       forever as stock comes and goes over the years. */
    const live = new Set(list(user).map((x) => x.key));
    const stale = d.prepare('SELECT key FROM notification_reads WHERE user_id = ?')
      .all(user.id).map((r) => r.key).filter((k) => !live.has(k));
    const del = d.prepare('DELETE FROM notification_reads WHERE user_id = ? AND key = ?');
    for (const k of stale) del.run(user.id, k);

    return { marked: n, pruned: stale.length };
  });
}
```

**The format is `<subject>:<id>` or a bare noun**, keyed on what the alert is *about* and never on
its words. `(user_id, key)` is the primary key, so read state is per-person, and stale keys are
pruned on every `markRead`. A customer-debt alert should therefore be keyed `debt:INV-2109` (the
sale) or `customer:81` — **never on the text**, which changes daily ("due in 3 days" → "due in 2").

The whole list is also **capped at 8** (`out.slice(0, 8)`) after being assembled in a deliberate
order — "Ordered by what it costs to ignore" (`alerts.js:40-41`). Adding a debt alert means deciding
where in that order it sits, not just appending.

---

# Part 6 — Your own read

## 38. Five things that will bite whoever builds this screen

### 38.1 `total_spent` adds money across currencies without noticing

The one query that produces every lifetime-spend figure in the app sums `sales.total` with no regard
for `sales.currency`:

```js:server/lib/customers.js:33-42
    FROM customers c
    LEFT JOIN (
      SELECT customer_id,
             SUM(total)  AS spent,
             COUNT(*)    AS visits,
             MAX(at)     AS last_at
        FROM sales
       WHERE voided = 0 AND customer_id IS NOT NULL
       GROUP BY customer_id
    ) agg ON agg.customer_id = c.id`;
```

`sales.currency` is `NOT NULL` and per-row (`001_init.sql:209`), and the whole system is built on
"integer minor units **plus a currency code**". SYP has `minor_exp` 0, USD has 2. So one USD sale of
$45 (`total = 4500`, `currency = 'USD'`) and one SYP sale of 4,500 lira (`total = 4500`,
`currency = 'SYP'`) contribute **the same 4500** to `spent`.

Today every one of the 8 sales is `currency = 'SYP'`, so the number is right **by accident**. The
moment the shop rings up a dollar-priced pair — and `CLAUDE.md` says it genuinely prices some goods
in dollars — `total_spent` becomes a meaningless mixture, and it flows straight into: the card grid,
the drawer's top stat, the sort order (`customerRows()` sorts on `b.totalSpent - a.totalSpent`), the
Excel export and the PDF statement. Nothing will look broken.

The fix has to decide *which* currency to normalise into and *at which rate* — and the honest answer
uses each sale's own frozen `fx_rate`, not today's. That is a server change in `customers.js`, and it
is the single most important thing to settle before building anything that displays a total.

### 38.2 `DB.daysSince(null)` returns ~20,700, so every customer who has never bought is "At risk"

```js:js/data.js:806
  daysSince: function (d) { return Math.round((TODAY - new Date(d).setHours(0, 0, 0, 0)) / 86400000); },
```

`new Date(null)` is the Unix epoch, **not** an invalid date. `lastPurchaseDate` is explicitly `null`
for anyone with no sales:

```js:js/data.js:2277
        lastPurchaseDate: c.last_purchase_at ? new Date(c.last_purchase_at) : null,
```

So `daysSince(null)` ≈ 20,700, which is `>= 90`, which means:

```js:js/app-customers-scan.js:53-54
    var since = DB.daysSince(c.lastPurchaseDate);
    var atRisk = since >= 90;
```

**every brand-new customer is drawn with a red border, an "At risk" badge and a "Send WhatsApp"
button inviting the cashier to win back someone who was added five minutes ago.** This is live right
now: the one real customer in the database has no sales and renders exactly that way. It also
inflates the count in the page head (`DB.inactiveCustomers(90).length`) and the dashboard
(`js/app-dashboard.js:67`), and `relDate()` prints "20700 days ago".

`js/pos.js:1446-1449` already solved this correctly for sorting and documents the reasoning
("Missing dates sort last rather than poisoning the comparator"). The Customers screen never got the
same treatment. **"Never bought" and "stopped buying" are different states and must render
differently.**

### 38.3 `points_earned` is stored on every sale and hydrated nowhere — two screens recompute it, both wrongly

The column exists (`009_receipts.sql:26`) and the server writes it inside the sale's transaction,
deliberately, so the row and the balance can never disagree:

```js:server/lib/sales.js:325-341
    /* ---- loyalty ----------------------------------------------------------
       Earned is `earnedForRow`, computed above so it could be written into
       the invoice itself; reused here rather than recomputed so the row and
       the customer's balance can never disagree about what this sale paid
       out. */
    const earned = earnedForRow;
    if (cust) {
      /* Spend and earn in one statement, in the same transaction as the
         invoice that caused both. Two updates could interleave with another
         till serving the same customer and lose one of them. */
      d.prepare(
        `UPDATE customers
            SET loyalty_points = loyalty_points - ? + ?, updated_at = ?
          WHERE id = ?`
      ).run(wantPoints, earned, at, cust.id);
```

But `DB.hydrate()` maps `points_used` and **not** `points_earned`:

```js:js/data.js:2328
        pointsUsed: Number(s.points_used) || 0,
```

So both places that show earned points re-derive them from the total:

```js:js/app-customers-scan.js:154-157
  invoices.slice(0, 6).forEach(function (s) {
    body += '<li class="plus"><b>+' + nf(s.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000) + ' ' + t('points') + '</b>' +
      '<small>' + s.id + ' · ' + fmtDate(s.date) + ' · ' + money(s.total) + '</small></li>';
  });
```

```js:js/app-export.js:420-425
    rows: invoices.map(function (s) {
      return [s.id, fmtDate(s.date), s.items.reduce(function (a, i) { return a + i.qty; }, 0),
              DB.payLabel(s.payment), exMoney(s.total),
              Math.round(s.total / 1000 * CONFIG.LOYALTY_POINTS_PER_1000)];
    }),
```

Both are wrong in three ways at once: they use **today's** `LOYALTY_POINTS_PER_1000` for a sale
earned under an older rate; they skip the `Math.pow(10, minorExp(settle))` division the server
applies (`sales.js:291-292`), so a USD sale is off by 100×; and they ignore rounding. The PDF one is
a **customer statement** — a document the shop hands to a person — so the number is wrong on paper.

The fix is one line in hydrate (`pointsEarned: Number(s.points_earned) || 0`) plus two call sites.
It is worth doing as part of this screen because the loyalty timeline is a headline feature of it.

### 38.4 The customer drawer's history is capped at the app-wide 200 sales — and the route that fixes it exists and is never called

`history` is not loaded per customer. It is assembled as a side effect of hydrating the global sales
array:

```js:js/data.js:2344
      if (custById[sale.customerId]) custById[sale.customerId].history.push(sale.id);
```

and that array is `GET /api/sales?limit=200` (`js/shop.js:68`) plus open credit sales folded in.
So the drawer's "Purchase history" card, its `invoices.length` badge, its preferred-size inference,
its points timeline **and** the PDF statement all silently truncate at the shop's most recent 200
sales overall — which in a busy month is a fortnight. A two-year customer will appear to have bought
three times.

The server already has the correct answer:

```js:server/lib/customers.js:54-65
/* The invoice ids, newest first. Loaded per customer rather than joined into
   the list above — forty customers with a hundred sales each is a lot of rows
   to build a screen that shows one of them. */
export function historyFor(id, limit = 50) {
  return get().prepare(
    `SELECT id, at, total, currency, payment, voided
       FROM sales
      WHERE customer_id = ?
      ORDER BY at DESC, id DESC
      LIMIT ?`
  ).all(id, limit);
}
```

exposed at `GET /api/customers/:id/history` (`server/index.js:596-600`) — and a grep across `js/`
for any caller returns **nothing**. The route was built for exactly this screen and has never been
wired up.

Related, same cause: the server sends `visits` (`customers.js:31`) and hydrate **discards it**
(§21), so the card's "Orders" figure is `c.history.length` — the truncated number — while an
accurate `visits` was in the payload and thrown away. Same for `created_at`, which is why nothing can
say "customer since".

### 38.5 The frozen exchange rate is hydrated onto every sale and used by nothing on screen

`fx_rate` is `NOT NULL` on `sales`, and the schema comment states its purpose:

```sql:server/migrations/001_init.sql:213-215
  -- The rate used, frozen. Without this, re-running last month's profit after
  -- the rate moves gives a different answer, and nobody can tell which is real.
  fx_rate       REAL NOT NULL,
```

Hydrate carries it (`js/data.js:2341`). The receipt and the public invoice page both honour it
(`server/lib/receipt.js:161-166`, `js/receipt.js:732-733`, `js/app-documents.js:250`).

**But the four functions every screen uses do not:**

```js:js/app-util.js:12-15
function money(syp) {
  if (OG.currency === 'USD') return '$' + nf((Number(syp) || 0) / CONFIG.EXCHANGE_RATE);
  return nf(syp) + ' ' + (OG.lang === 'ar' ? 'ل.س' : 'SYP');
}
```

`moneyStat`, `moneyShort` and `exMoney` are identical in this respect. So with the topbar toggled to
USD, the customer drawer's purchase history, its lifetime-spend stat and the Excel export convert
**every historical total at today's rate** — in a currency that has moved by orders of magnitude.
Two people comparing the same customer's statement a month apart get different numbers, which is
precisely the failure `fx_rate` was added to prevent.

This is not a bug the new screen introduces, but the customer screen is where it becomes most
visible, because it is the only screen that shows a *person's* money across a long time span.

### Two more worth knowing (shorter)

**(a) The global search returns archived customers; the POS picker does not.** `pos.js` filters and
explains why (`js/pos.js:1453-1456`). `app-shell.js:477-479` does not filter at all — so a customer
somebody deliberately archived still surfaces in the topbar search on every screen, and clicking
through opens their drawer. `customerRows()` handles it correctly for the list. Any new entry point
must filter too.

**(b) The cashier has `customer.write` but neither `money.read` nor `money.write` (§27).** So
`Shop.load()` never fetches `/api/money` for her, `DB.debtPayments` is empty, and `DB.debtBalance()`
would return the full sale total as "owed" — not zero, but **wrong**, because the payments array it
subtracts is simply absent. A debt panel must be gated on `allow('money.read')` and hidden entirely,
never rendered with an unfetched zero.

## 39. Already half-built, and NOT in `CLAUDE.md`'s "Known open work"

`CLAUDE.md`'s list names the supplier/payroll editors, `Shop.addVariant`, `Shop.cancelPO`, the draft
partner invoice, delivery cash reconciliation, bulk catalogue entry, the Yalla portal, an offline
write queue, the lira redenomination question, `flutter_app/`, and the hidden demo rows. **None of
the following is on it.**

| # | What | Evidence | State |
|---|---|---|---|
| 1 | **`GET /api/customers/:id/history`** | `server/index.js:596-600`, `server/lib/customers.js:57-65` | Route + query live and correct. **Zero callers in `js/`.** Built for this screen. |
| 2 | **`Customers.archive(id, userId)`** | `server/lib/customers.js:127-129` | Exported, zero callers anywhere in `server/`. Archiving goes through `PATCH`. |
| 3 | **`Shop.updateCustomer`** | `js/shop.js:337` | Called **only** from `js/bulk.js:321,325` (bulk archive/restore). There is no single-customer edit UI at all. |
| 4 | **`Shop.adjustPoints`** | `js/shop.js:338-340` | Called **only** from `js/bulk.js:311,314` (a fixed ±250). The `reason` argument the server logs into `change_log` is hard-coded to `t('bulk_title')`. No manager-facing "adjust with a reason" form exists, despite the server being built for exactly that (`customers.js:131-139`). |
| 5 | **`Partner.logWhatsApp`** | `server/lib/partner.js:492-497` | Exported, **zero callers**. No route reaches it. `wa_messages` has 0 rows while `js/whatsapp.js:38-46` logs every send to an in-memory array that dies on refresh. The persistence half was written and never connected. |
| 6 | **`customers.address` is write-once and has no editor** | `server/lib/deliveries.js:175-188` | Written only by `Deliveries.assign`, only when empty. `clean()` accepts `address` (`customers.js:69`) and hydrate carries it (`data.js:2273`), but **no screen displays or edits it**. |
| 7 | **`customers.note` and `customers.source` are accepted, hydrated, and never editable** | `customers.js:69`, `data.js:2272-2274` | `source` is displayed (as the in-store/online chip); `note` is displayed nowhere. Neither can be changed after creation. |
| 8 | **`visits` and `created_at` sent and dropped** | `server/lib/customers.js:28-31` vs `js/data.js:2266-2281` | The server computes an accurate visit count; hydrate throws it away and the UI uses the truncated `history.length` instead. |
| 9 | **`sales.points_earned` never hydrated** | §38.3 | Stored server-side since migration 009; two screens recompute it wrongly. |
| 10 | **No customer-debt alert** | `server/lib/alerts.js` (§37) | Six alert kinds, none about a customer or an unpaid credit sale, though `DB.debtAgeing()` exists in the browser and `openDebts()` on the server. |
| 11 | **The dead demo-mode `mirror` callback in `Shop.write`** | `js/shop.js:209`, used at `js/app-actions.js:786-797` | `Auth.demoMode` is genuinely gone (0 hits repo-wide), but every `Shop.write` call still passes a second "Demo mode only" callback that constructs a fake customer and pushes it into `DB.customers`. Dead code on a write path. |
| 12 | **`CITIES` is declared and unused as a constraint** | `js/data.js:335` | Seven cities listed; the form is a free-text input and the server does not validate. |
| 13 | **`.cust-card` has no `:active` state on phones** | `css/bulk-gate-responsive.css:505` | Every other card type (`.yl-card`, `.pcard`, `.st-card`, `.kcard`) has one. |

## 40. Contradictions between `CLAUDE.md` and the actual code

`CLAUDE.md` has drifted in several places. Most are cosmetic; the first is not.

### 40.1 **`js/app.js` does not exist.** (Significant.)

`CLAUDE.md` refers to it repeatedly and by name — *"`VIEWS.dashboard` in `js/app.js` is a chooser"*,
*"Helpers in `js/app.js` you should reuse"*, *"Every new string goes in BOTH `I18N.en` and `I18N.ar`
in `js/app.js`"*, *"`ACTIONS`"* — but:

```
$ ls js/app.js
ls: cannot access 'js/app.js': No such file or directory
```

It was split into seventeen `app-*.js` files (each header says *"Split from the original js/app.js
(lines N-M)"*). The real locations of everything `CLAUDE.md` attributes to `js/app.js`:

| `CLAUDE.md` says | Actually in |
|---|---|
| `VIEWS` / `AFTER` | `js/app-routing.js:16-60` |
| `roleOf`, `allow`, `seesCost`, `seesProfit`, `isPartnerAccount`, `navAllowed`, `ifNav`, `NAV`, `NAV_PERM` | `js/app-shell.js:28-123` |
| `I18N.en` / `I18N.ar` | `js/app-i18n.js:12` + merged from `js/app-i18n-extra.js:439-442` |
| `ACTIONS` | `js/app-actions.js:33` |
| `CHANGES` (`data-change`) | `js/app-changes.js:9` |
| `t()` | `js/app-i18n.js:1086` |
| `boot()` / `go()` / `bindGlobal()` | `js/app-boot.js` |
| `render()` | `js/app-routing.js:213` |
| `viewSettings()` / `setFoldStart` / `afterSettings` | `js/app-settings.js` |
| `viewDashboard` / `viewShiftHome` / `viewBackHome` | `js/app-dashboard.js` |
| `money()`, `esc()`, `tel()`, `toast()`, `openModal()`, `openDrawer()` | `js/app-util.js` |

### 40.2 "28 permissions × 5 roles" is wrong — it is **30 × 5 = 150**.

`ALL_PERMISSIONS` has 30 entries (`server/lib/auth.js:56-95`), and the live `role_permissions` table
holds exactly `150` rows / `30` distinct perms / `5` roles.

### 40.3 The seeded generator section is largely stale.

`CLAUDE.md` has a whole heading — *"The seeded generator — call order is load-bearing"* — asserting
that `js/data.js` *"builds the whole dataset from an LCG"* and that *"Inserting one extra `rand()`
call shifts every value drawn after it and silently rewrites unrelated parts of the dataset."*

The LCG still exists:

```js:js/data.js:177-182
/* Deterministic pseudo-random so the demo looks identical every time it opens. */
var _seed = 987654321;
function rnd() { _seed = (_seed * 1664525 + 1013904223) % 4294967296; return _seed / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function chance(p) { return rnd() < p; }
```

But **it no longer builds a dataset.** Call-site counts across all 2,649 lines of `js/data.js`:

- `pick(` — **0 call sites** (definition only)
- `chance(` — **0 call sites** (definition only)
- `ri(` — **2 call sites**, both inside `addVariant`:

```js:js/data.js:1521,1526
      var body = '621' + pad(id, 3) + pad(idx, 2) + pad(ri(0, 9999), 4);
        shelf: p.shelfZone + '-' + pad(ri(1, 24), 2),
```

The warning is therefore mostly obsolete — but **not entirely**, and the residue is sharper than the
original: `ri()` now generates a **barcode body** and a **shelf code** for a new variant, so the
shared `_seed` is live in a path that writes to the catalogue. That is worth a smaller, more precise
note than the one currently there.

(The separate `_whSeed` generator at `js/data.js:290-300` still exists and still has its own seed, as
`CLAUDE.md` says.)

### 40.4 `npm run demo-catalogue` is referenced by a migration but no longer exists.

```sql:server/migrations/007_customers_and_points.sql:26-27
--     `npm run demo-catalogue` fills a scratch database with a shop's worth of
--     goods so the system can be shown working.
```

`server/package.json` has `preflight`, `createuser`, `backup`, and the supabase scripts. There is no
`demo-catalogue`, and `server/scripts/` contains only `purge-demo.js`. (This is a migration comment,
not `CLAUDE.md` itself, but it misleads in the same way.)

### 40.5 Minor / not contradictions

- **`CACHE` example**: `CLAUDE.md` writes `og-system-v15 → v16`; the real value is `og-system-v82`.
  That reads as an illustration rather than a claim, but the gap is large enough to check.
- **"the `stat`, `card`, `tbl` markup"** — accurate, but easily misread as an API. They are CSS
  classes; there are no such functions (§25).
- **Everything about the customer/points design in `CLAUDE.md` that I checked is correct**: money as
  integer minor units + currency code, the frozen rate on the sale row, prices from the product
  table, `applied_ops` idempotency, `DB.tx()` refusing to nest, the `PINNED`/`FORBIDDEN` rules, the
  `scrubCost` nested-array fix, the deliveries 404-not-403 rule, `to_collect` read from the sale,
  the alert keying on subject rather than text, and `DB.liveVariants()` filtering archived products.
  Those all match the code exactly.

## 41. Questions only the shop owner can answer

Ordered by how much of the screen each one changes.

**Credit and debt**

1. **Does the shop actually sell on credit (الدين), and to whom?** `credit` is a payment method in
   the code and there is a whole debt book behind it, but **not one credit sale exists in the
   database.** Is this a real everyday practice, an occasional favour for regulars, or something
   built in anticipation?
2. **Should a customer's outstanding debt be visible to a cashier?** Right now she cannot see it —
   `money.read` is manager-only. If the answer is yes, that is a permission change with real
   consequences, not a UI decision.
3. **Is debt owed per invoice or per person?** The database records it per sale. If the owner thinks
   of it as "Ahmad owes me 200,000", the screen has to aggregate — and then a partial payment has to
   be allocated across invoices, which nothing currently does.
4. **Is a debt in lira, in dollars, or in "what it was worth on the day"?** With the lira moving,
   a debt taken in March and paid in September is not the same amount. The code freezes `fx_rate` on
   the sale but `debt_payments` has its own `currency` column and no rate.
5. **Should an old unpaid debt raise an alert?** There is no customer alert of any kind today (§37).

**Currency**

6. **Are any goods sold to walk-in customers priced in USD, or is USD only for costs and purchasing?**
   This decides whether §38.1 is an urgent bug or a latent one.
7. **Old or redenominated lira?** `CLAUDE.md` flags this as unsettled and the live seed says
   `fx_rate = 130` (new lira), while `CLAUDE.md`'s "Known open work" says the seed assumes
   `1 USD = 13,000` (old lira). The two disagree. Lifetime-spend figures are meaningless until this
   is settled.

**Who the customers are**

8. **Are walk-ins named, or do most sales genuinely have no customer?** All 8 sales in the database
   have `customer_id = NULL`. If that is normal, the Customers screen is about a small regulars list,
   not about everyone — a very different screen.
9. **Are names typed in Arabic, Latin, or both?** This decides whether Arabic search normalisation
   (§29) is essential or optional. The one real row is Latin; the code clearly anticipates Arabic.
10. **What phone format do staff actually type — `+963 9XX XXX XXX`, `09XX XXX XXX`, or whatever
    comes to hand?** Nothing normalises or validates (§19, §20), and the answer decides whether the
    fix is a display formatter or a stored canonical form.
11. **Can two customers share a phone number** (a household, a shop's landline)? Today nothing stops
    it and nothing warns. Should a duplicate phone be refused, warned about, or allowed?
12. **What should happen when the same person is entered twice?** There is no merge, and merging
    would have to move `loyalty_points` and repoint historical `sales.customer_id` — which is exactly
    the "archived, never deleted" rule under strain.

**Loyalty**

13. **Is the loyalty scheme actually running, or is it a proposal?** Every customer has 0 points and
    every sale earned 0. The tiers (Bronze / Silver 6,000 / Gold 12,000) and the point value (0.5)
    are seeded defaults, not the owner's numbers.
14. **Who may adjust points by hand, and does a reason have to be given?** The server was built for
    a deliberate, reasoned adjustment (`customers.js:131-139`) and the only UI is a bulk ±250 with a
    hard-coded reason (§39.4).
15. **Should points expire?** Nothing in the schema supports it and nothing suggests it was
    considered.

**Privacy and roles**

16. **Should the delivery driver see the whole customer list?** He has `customer.read` today, so on
    sign-in he receives every name, phone, city, address and lifetime-spend figure. He arguably needs
    only the people on his own runs — which is the rule already applied to deliveries themselves
    ("scoped to his own runs in the SQL query, by role").
17. **Should a cashier see a customer's lifetime spend?** She can today. It is not cost or profit, so
    `scrubCost` does not touch it, and no permission separates it.

**Scope of the screen**

18. **Should the screen show a customer's deliveries and print jobs?** Both are reachable but neither
    is free: deliveries need a join through `sales` plus `delivery.read`; print jobs are linked only
    by a free-text name or an optional `sale_id` (§36).
19. **Is "At risk after 90 days" the owner's number?** It is hard-coded in three places
    (`app-customers-scan.js:16,29,54`, `app-dashboard.js:67`, `app-export.js:131,144`) and is not in
    `config`, unlike the loyalty tiers and the discount cap.
20. **Should archiving a customer be reversible from this screen, and by whom?** Only bulk can
    archive today; only `customer.write` sees archived rows at all.

---

# Confidence

## Verified by running or reading directly

- **Everything quoted in a fenced block was read from the file in this session**, and every
  `path:line-range` header was taken from a numbered read of that file, not from memory.
- **Git state** (`git log --oneline -10`, `git branch --show-current`, `git status --porcelain`) — run.
- **All line counts** — `wc -l`, run.
- **The database** — `server/data/og.db` exists (880,640 B + a 2,472,032 B WAL). Opened
  **read-only** (`new DatabaseSync(path, { readOnly: true })`) via a throwaway script in the
  scratchpad. Only `SELECT` and `PRAGMA` were issued. Verified this way: the table list, `PRAGMA
  table_info(customers)`, `PRAGMA index_list(customers)`, `schema_migrations`, `sqlite_master` DDL
  for the nine tables in §11, row counts, the single customer row, all 8 sales rows, the 4 delivery
  rows, `config` values for loyalty/shop/sale/expense, the `role_permissions` matrix (150 rows), and
  the `change_log` summary.
- **The I18N en/ar diff (§30)** — actually executed, not eyeballed: both i18n files concatenated and
  evaluated in a `node:vm` context with `OG`/`CONFIG` stubbed, then the two key sets diffed. Result:
  1,232 keys each side, 0 missing either way, 2 deliberately identical strings.
- **The permission count (§40.2)** — parsed out of `ALL_PERMISSIONS` programmatically (30) and
  cross-checked against the live table (150 rows = 30 × 5).
- **"No callers" claims** — each is a repo-wide `grep` over `js/` and `server/` whose only hit is the
  definition line. This is true for `Customers.archive`, `Partner.logWhatsApp`, and any caller of
  `/api/customers/:id/history`. Likewise `Auth.demoMode` / `demoMode` return **0 hits**.
- **"No Arabic normalisation" and "no phone normaliser" (§20, §29)** — negative results from targeted
  greps for the alef/taa-marbuta/tatweel characters, `normalize`, `e164`, `normalizePhone`,
  `normalisePhone`. I list the greps I ran so the negative can be re-checked.
- **"No Telegram bot" (§33)** — greps for `getUpdates`, `webhook`, `sendMessage`,
  `api.telegram.org`, `bot<digits>` across `js/`, `server/`, `agent/`, `*.sql`, `*.json`: zero hits;
  `server/.env.example` has no bot key.
- **`js/app.js` does not exist** — `ls` returned `No such file or directory`, and the 45-file `js/`
  listing is reproduced in §2.
- **The seed-generator call counts (§40.3)** — `grep -c` for `pick(`, `chance(`, `ri(` in
  `js/data.js`, then each hit inspected to separate definitions from call sites.

## Inferred, not directly verified

- **§38.1 (currency-blind `SUM`)** — the *code* is quoted and unambiguous, but the *consequence* is
  reasoned, not observed: there is no USD sale in this database to demonstrate it with. I am
  confident about the arithmetic; the severity depends on Q6 in §41.
- **§38.2 (everyone at risk)** — I traced `daysSince(null)` through `new Date(null)` → epoch by
  reading, and the live data is consistent with it (one customer, no sales). **I did not run the app
  in a browser to watch the red badge render.**
- **§38.3 (points recomputation)** — the three defects (stale config rate, missing `minorExp`
  division, rounding) are read off the two expressions and compared with `server/lib/sales.js:286-293`.
  Not executed.
- **Phone-format claims (§9)** — one customer row plus three delivery phone strings is a very thin
  sample. That `+963 9XX XXX XXX` is *the* house format is an inference from the form placeholder and
  the `whatsapp.js` comment, not from a distribution. I have flagged this as a question rather than a
  finding.
- **§36 (print jobs ↔ customers)** — the schema is quoted and definitive, but `print_jobs` has 0 rows,
  so neither join path has been exercised against data.
- **The Arabic tone notes in §30** — a reading of the existing strings, not a native-speaker judgement.

## Could not check at all

- **Nothing was blocked by a missing file.** The database was present; every file referenced in the
  prompt exists except `js/app.js` and `js/app-customers.js`, whose absence is itself reported.
- **I did not start the server** (`cd server && npm start`) and did not exercise any route. All route
  behaviour above is read from source. In particular, the exact 400/409 bodies in §14 and §19 are
  read from `sendError` call sites, not observed on the wire.
- **I did not open the app in a browser.** No rendering, RTL, phone-breakpoint or `.tbl-cards`
  behaviour was visually confirmed; §31 and §32 are read from CSS and from `labelWideTables`.
- **The `-wal` file is 2.4 MB against an 880 KB main database**, so the database has uncheckpointed
  writes. My read-only connection reads through the WAL, so the figures above are current — but a
  checkpoint or a running server could change row counts after this report was written.
- **`server/.env`** was not opened beyond confirming `.env.example` has no Telegram key. `OG_VAULT_KEY`
  and the Supabase credentials were not inspected.
- **The Supabase mirror was not queried.** `server/supabase/001_mirror_schema.sql:216,238` shows
  `customers`/`sales` are mirrored, and `supabase-sync.js:594` documents the FK ordering, but I did
  not run `npm run supabase:check` and cannot say whether the mirror currently agrees with SQLite.
- **`dist/`** was excluded from all greps (it is deliberately untracked and stale).

## One caveat on the whole report

**This database is effectively empty for the purpose at hand**: one customer, zero of whose sales
exist; eight sales, none attached to a customer; no credit sales; no debt payments; no print jobs; no
WhatsApp messages. Every code path in Parts 2, 3 and 5 is therefore verified as *written*, and almost
none of it as *exercised*. Where I could distinguish "the code says" from "the data shows", I have.
