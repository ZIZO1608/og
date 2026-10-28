# Night shift — 28 Oct 2026

Branch `night/2026-10-28`, one commit per stage. Nothing pushed, nothing merged, nothing run
against Supabase or the live shop. Every check ran against a scratch copy of the sandbox
database (`server/data-night/og.db`, made with `VACUUM INTO`, gitignored) on port 8210 with
`OG_SYNC_MINUTES=0 OG_PULL_AT_BOOT=0 OG_PUSH=0 OG_TELEGRAM=off`, no Supabase keys and bogus
bot tokens. The server's own startup line was read before the first write:
`database : D:\DESKTOP\OG System\server\data-night\og.db`.

## How to test it on shop.ogsports1.com (about 15 minutes)

Use test products and a test customer, or reverse/void what you make afterwards.

**1. Print labels** (Warehouse → Print labels)
- Open a T-shirt or jersey (▸): the sizes read **S, M, L, XL, XXL**, not L, M, S.
- On the laptop nothing is cut off on the right; on a phone each product is one short card.
- Press **Print all sizes**: the button spins at once. Press it again quickly: "Still getting the labels ready". Then **Print now**: it spins and finishes with a message.

**2. Size guide**
- Settings → The shop → **Size charts** → **New chart**: name "Nike tee", sizes from T-Shirts, tick Chest width and Length. Fill the boxes (type 52,5 → it becomes 52.5; Enter goes to the next box; you can paste a column from Excel). Save.
- Warehouse → **Add product**, type T-Shirts, give S/M/L quantities. Save **without** a guide → it is refused, saying the guide is needed. Choose the chart "Nike tee" (Follow the chart) → Save works.
- Open the product: the **Size guide** card shows the table. Press **Send size guide** → a picture (on a phone the share sheet; on the laptop it downloads and WhatsApp opens).
- At the till, tap the product → in the size picker press **📏 Size guide** → the table opens on top; close it, and the basket is still there.
- Products → filters → Size guide → **No size guide**: the clothes still to fill in.

**3. Deposit (عربون)**
- Till: add a product, attach a customer, press **Reserve with a deposit**. It shows the least deposit (50%). Type less → refused; type the least → **Take the deposit**. The slip prints with **HELD UNTIL**, the basket clears, and the product's stock goes down by what was held.
- Open the product: "Held for a reservation … for (name) until (date)".
- **Reservations** button at the till (or scan the slip's barcode) → the reservation: **Hold 7 more days**, then **Take … and hand over** → it is collected.
- Make another one, then as the owner open it → **Release as store credit** → the pieces are back in stock and the customer has the credit.
- Settings → Money and prices → **Deposit (عربون)**: change the % or the days.
- Website orders: on a new order's card, **Deposit needed** → set 30% → Save.

**4. Suppliers and Money**
- Money: five places on top; press **Suppliers**. Each supplier shows what we owe, big; **Pay** shows only where something is owed.
- Tap a supplier → its page (phone, WhatsApp, history, purchase orders).
- **Pay**: the amount box is **empty**; press **All** → it fills. Choose "With the owner" (holding nothing) → an amber line warns; press Pay → it asks once more with **Owner puts it in first**. Cancel if this is not a real payment.
- **+ New supplier** named like an existing one ("VACHE 2") → it warns before saving.
- **Expenses & wages → Expenses**: a dollar expense now shows in "Spent this month" (as + $…).
- **Books → Statement**: Sales and Takings no longer show the same numbers twice.
- **Where it is**, if the starting-balances banner is there: **Enter starting balances** goes one place at a time.

---

## For the owner, in plain words

**Done:**
- **Stage 1 (labels):** sizes are listed in order everywhere (S, M, L, XL, XXL). Print labels fits the laptop screen and looks tidy on a phone. Buttons that wait for the internet now show a spinner straight away, and Print now is twice as fast.
- **Stage 2 (size guide):** the full size guide in cm. It has reusable charts, works per product, is required for clothes, and shows in the drawer, at the till and as a WhatsApp picture. The website can read it through its own address.
- **Stage 3 (deposit):** at the till, "Reserve with a deposit" (at least 50%, a customer needed). The pieces are put aside and the slip prints with "held until". Scan the slip later: take the rest and hand over, hold longer, or (manager) release the deposit as store credit or refund it. The bell warns before and after the date. A website order's card has "Deposit needed", which the website can read.
- **Stage 4 (money and suppliers):**
  - Suppliers is one tap in Money. Each row says what we owe, big, with Pay only when something is owed, and opens the supplier's page (phone, WhatsApp, history, orders).
  - Pay starts empty, from a place that has the money. Anything that would take a place below zero says so and asks once more, offering "owner puts it in first".
  - Expenses count dollars too. Similar supplier names are warned about. "Paid as" now says what really happened. Sales and Takings are no longer shown twice.
  - Starting balances are one place at a time.

**Needs you:**
1. You ran `044` and `045`. Also run `030_erp_access.sql` again, if not done.
2. Run `046_supplier_phone.sql` in Supabase (supplier phone and notes).
3. Run `npm run supabase:reconcile` on the VPS.
4. Give Ahmad the two new website addresses: the size guide, and the deposit (both written in the report).

**Questions:** at the end of stages 1, 2, 3 and 4 (five in all).

---

## Stage 1 — Print labels: size order, layout, and the lag

### 1a. Sizes in alphabetical order — fixed, once, for the whole system

**Cause.** The catalogue query said `ORDER BY v.product_id, v.size` — a text sort, so
`L < M < S < XL < XXL`. Every screen draws `DB.variantsOf()`, which kept that order. Two
screens had private sorts of their own (the colour matrix in `js/colourform.js` and the shelf
map's editor in `js/shelfmap.js`) and they did not agree with each other.

**Fix.** One rule, in one file both sides load: **`js/sizeorder.js`** (global `SizeOrder`).
It is a plain script that sets a global, loaded by `index.html` and imported by the server for
its side effect — the same pattern as `js/offermath.js`. One copy instead of a browser function
and a server twin to keep in step. The order:

1. the type's own size set (Settings → Categories / `DB.sizeSets`), in the owner's order;
2. numbers by value (39, 40, 42.5 … and 28, 30, 32);
3. clothing letters, smallest first (XXS, XS, S, M, L, XL, XXL, 3XL …; `2XL` counts as `XXL`);
4. anything else alphabetically, with digits read as numbers.

Several colours: grouped by colour (in the order the colours were added), then sizes.

Where it is applied:

- **Server** `server/lib/catalogue.js`: `sortVariants()` on the catalogue bundle (every
  screen's data) and on `byId`. `server/lib/shelves.js`: what sits on each shelf.
- **Browser** `js/data.js` hydrate sorts each product's variants before storing them. Every
  `DB.variantsOf()` caller now gets the right order with no change of its own: Print labels,
  the label preview, Products table and drawer, the till's size picker, the warehouse,
  the delivery office picker, the stock count, the exports.
- The two private sorts (`colourform.js` matrix, `shelfmap.js` `sizesOf`) now call `SizeOrder`.

**Not changed: the website feed** (`GET /api/ext/products`). See question 1.

### 1b. The opened product overflowed at 1366 — fixed

The table had nine columns, three of them a code each (SKU, EAN-13, label code, all `nowrap`)
plus a 56 px box. It now has seven. The three codes sit in one cell: the label code bold on top
(what the sticker carries), the SKU and EAN-13 small under it. Measured at 1366 in English and
Arabic with a product open: table `scrollWidth 1016 = clientWidth 1016`, page width 1366,
Print all sizes and every print-qty box hit-test to themselves.

Opening a product now also **keeps the scroll position** (`render()` already held it for
Settings; Print labels joins it in `js/app-routing.js`). Before, opening a product far down the
list threw the page back to the top.

### 1c. The phone layout — rebuilt

The generic phone cards (`labelWideTables`) put every cell on a line of its own, including the
empty ones. The table now opts out (`lb-tbl`) and draws its own list below 720 px:

- a product is one card, **79 px tall**: tick, photo, name (brand · OG-102 under it),
  "9 sizes · 3 ticked", and the Print button (44 px);
- an opened product's sizes are short rows, **53 px tall**: tick · size and colour · stock ·
  label code · how many to print (44 px box). SKU, EAN-13 and status are not drawn on a phone.

### 1d. The lag

**Measured tonight on the scratch server, Chrome over CDP, `Network.emulateNetworkConditions`
with 1500 ms latency** (`_nightshift/n1028/s1-lag.mjs`, `s1-boot.mjs`):

| Step | Time | Server? |
|---|---|---|
| Open a product's sizes | 12–21 ms | no |
| Tick a size | 3–25 ms | no |
| Switch to shelf labels | 1 ms | no |
| Print all sizes → preview open | 1,621–1,644 ms | one round trip |
| Print now (queue) → toast | **1,560 ms** (was ~3,100 ms: two round trips) | one round trip |
| Print now (this computer) → toast | 2,568 ms (the print dialog, then the log row) | one round trip |

So the screen itself is fast; what the owner feels is the wait on the network, and nothing on
screen said anything was happening.

**What changed:**

- **`busyButton(el)`** (`js/app-util.js`): the money dialogs' spinner in the button, at its own
  width, disabled, `aria-busy`. Measured: the button goes busy **5–24 ms** after the press.
- **Print all sizes** and every other door into the label preview go busy at once (the button
  pressed is passed in, or the focused button is used). **A second press while the preview is
  still on the line says "Still getting the labels ready — one moment."** instead of nothing.
- **Print now goes busy at once** and can't be pressed twice.
- **Print now no longer asks the server for the preview a second time.** The preview on screen is
  the one that was approved for exactly those lines; asking again was a whole extra round trip
  (1–5 s on the public address) before the print was even sent. The request log now shows one
  call: `POST /api/labels/print`.
- **Not changed:** what gets printed, the layout, the template.
- `Shop.write`'s gate already says "Still saving the last change" when a second press is
  refused (fix of 25 Sep); nothing on Print labels goes through `Shop.write`.

### 1d (report only). Why the app takes ~15 s to open over shop.ogsports1.com

Measured at 1500 ms latency, a device that already has the app files:

```
+0.0 s   GET /api/health  (×2)
+1.5 s   GET /api/auth/me                         — waits for health
+3.0 s   17 requests at once: config, catalogue, customers, sales, movements, partner,
         purchase-orders, money, stock-counts, suppliers, employees, notifications,
         dashboard, reports, offers/live, labels/templates (…)
         → they land in THREE WAVES, +4.5 / +6.0 / +7.5 s: a browser opens only six
           connections per host over HTTP/1.1
+9.0 s   GET /api/sync/status                     — waits for all of the above
+10.5 s  GET /api/partner/pulse, then /api/live
```

About 10.7 s of API at 1.5 s a request; at the 1–5 s measured on the live site that is the
15 s the owner sees. The first visit of a device (or the harness, whose HTTP cache is off) also
fetches ~100 static files over the same line and reloads once when the service worker installs —
82 s in the harness; a real phone does this once per deploy.

**Also:** every save through `Shop.write` reloads **the whole shop** afterwards (the same 17
requests) before it says "done". Over the public address that is a save that takes 5–15 s.

**Suggestions (not built tonight):**

1. **One boot request** — `GET /api/boot` answering the 17 bundles in one body, each gated
   exactly as its own route is. One round trip instead of three waves.
2. **First screen first** — load what the home screen needs (config, catalogue, the
   notifications), draw, then fetch reports, dashboard, movements, purchase orders, stock counts
   and the partner bundle behind it.
3. **Reload only what a write touched** — `Shop.write` reloads everything; most writes touch one
   or two bundles.
4. **HTTP/2 on the proxy** (`deploy/shop-proxy`) — removes the six-connections limit; check
   whether nginx is already speaking it to browsers (`listen 443 ssl http2`).
5. Ask `/api/health` once, not twice, at boot.

### 1e (report only). The label shows EAN-13 — on purpose

`js/labels.js` has `FIXED = { preset: '60x40', barcodeType: 'ean13', station: 'till-1',
paper: 'roll' }`. That is the owner's decision of 27 Sep 2026 ("ONE LABEL, FIXED: 60 × 40 mm,
EAN-13"), and it overrules any template default, the machine's saved choice and anything a
caller asks for. The `6 210555 577573` on the live preview is that size's own `barcode` column.
CLAUDE.md's labels section says the older Code 128 bullets describe the preview *before* that
decision. Nothing was changed. A label code already printed on a box still scans: `resolveScan`
knows all three codes.

### Files

`js/sizeorder.js` (new, in `index.html` and `sw.js`'s precache) · `js/data.js` ·
`js/colourform.js` · `js/shelfmap.js` · `server/lib/catalogue.js` · `server/lib/shelves.js` ·
`js/app-print-labels.js` · `css/print-hardware-receipt-newlabels.css` · `js/app-routing.js` ·
`js/app-util.js` · `js/labels.js` · `js/app-actions.js` · `js/app-i18n.js` ·
`js/app-i18n-extra.js` · `sw.js` (v345) · `.gitignore`. **No migration, no Supabase file.**

### How it was verified

- `_nightshift/n1028/s1-ui.mjs` — **28 checks, all green**: the order out of `DB.variantsOf` for a
  two-colour tee made with sizes typed L, M, S, XL, XXL / XXL, S, L, M and jeans typed
  32, 28, 36, 30; the rows on Print labels; no sideways scroll; Print all and the print-qty box
  hit-tested; the phone card and row heights; at 1366 × 768 and 390 × 844, English and Arabic;
  no console error.
- `_nightshift/n1028/s1-lag.mjs` — the table above, with the queue and with this computer.
- `cd server && npm test` 116 green · `fix05/p0-namespaces` 6 · `offers/parity` 22 ·
  `web-extras/parity` 35 · `usd-prices/parity` 40.
- Screenshots in `night-shots/stage1/`: `labels-1366-en.png`, `labels-1366-ar.png`,
  `labels-390-en.png`, `labels-390-ar.png`, `drawer-*.png` (the product drawer, same four),
  `lag-preview.png`, `lag-printing.png` (the spinner in Print now).

### Not done

- The website's size order (question 1).
- The boot itself (suggestions above).

### Questions

1. **The website still lists sizes as text (L, M, S).** The website reads the cloud copy
   (`web.product_row` in `server/supabase/037/040/041/043`, the same function text in four
   files, each `ORDER BY z.size collate "C"`), and the laptop's `/api/ext/products` must answer
   the same as the cloud field for field (`usd-prices/parity` went red when only the laptop was
   changed — so that change was taken back). Fixing it is a cloud file that changes the order
   in `web.product_row` in all four copies plus `webRow()` here. Shall I write it next, or should
   Ahmad sort the sizes on the website (the category's size list rides on every product as
   `category`)?

---

## Stage 2 — The size guide, in centimetres

Built to the owner's decisions as written: reusable charts **and** per product; the admin ticks
the measurements; required for clothes, optional for shoes; a fit note and a short note; shown in
the drawer, at the till, on the website and as a WhatsApp picture.

### The shape of the data, and why

Migration **`077_size_guides.sql`**, two tables, both cursor shape (every write goes through
`change_log` in the same transaction):

- **`size_charts`** — a reusable chart: both names, the category its sizes come from, the ticked
  measurements, the rows, the fit, the two notes, `active`. Never deleted, only hidden.
- **`product_size_guides`** — one row per product (`product_id` is the key): `chart_id`,
  `follows` (1 = the chart's numbers, kept in step), the measurements, the rows, fit, notes.

**The rows are JSON on the row**, not a child table — the reason `pairs_with` (070) and an
offer's `targets` (076) are columns: a guide travels to the mirror as one row.

**A product's guide always stores its rows already resolved** — its own sizes, in the Stage 1
size order, with the numbers — even when it follows a chart. Saving a chart rewrites every guide
that follows it (same transaction, each logged); adding a size or a colour adds its row. That is
what lets the cloud answer the website with no knowledge of charts and no size sorting in SQL.
"Start from a chart, then my own numbers" copies the chart into the product and stops following.

The clothes types are config **`sizeguide.clothes_types`** (default tshirts, jerseys, shirts,
jackets, jeans, tracks), mirrored with config, edited in the Size charts fold.

### The rules, on the server (`server/lib/sizeguide.js`)

- Measurements: tops chest/length/shoulder/sleeve; bottoms waist/hip/length/inseam; shoes foot
  (cm)/EU/US/UK. "Length" is one measurement shared by tops and bottoms (question 2).
- A cm figure: > 0, ≤ 300, one decimal at most. EU/US/UK: > 0, ≤ 60. **"52,5" is 52.5**;
  Arabic-Indic digits are read. The browser uses the same rule (`SizeGuide.parse`).
- **A new product of a clothes type is refused** without a complete guide (`sg_required`,
  `sg_incomplete` naming up to 12 empty cells), checked before the transaction — nothing is
  written. **Existing products are not blocked.** A guide saved on an existing product must be
  complete, or the "No size guide" filter would be lying.
- Refusals name the size and the measurement; the browser marks that box red and focuses it.

### Where it is

- **Warehouse → Add product**: a "Size guide" card under the colours, badged *Required for
  clothes* / *Optional*. Its rows are the sizes given a quantity, in size order, and follow the
  quantities as they change. Pick a chart (follow it, or start from it), tick, fill. Save refuses
  on the cell, before the request.
- **Edit product**: the same editor in a fold ("Size guide · Done / Missing / Optional"). The
  drawer's card opens the editor with that fold open.
- **Settings → The shop → Size charts** (fold, meta "N charts"): each chart with Edit,
  Duplicate, Hide/Show; New chart; which types need a guide (chips that save themselves).
- **The grid**: Enter moves to the next box, Tab is the browser's, **a column pasted from Excel
  fills down** from the box it lands in (tabs fill across), "↑" copies the row above. 16 px
  text, 44 px tall boxes on a phone.
- **Product drawer**: the table, the fit and the note, **Send size guide**, Edit.
- **The till**: a "📏 Size guide" button in the size picker, only when there is a guide. It opens
  a sheet on its own layer (`#sgRoot` — never `openModal`), so the size picker stays open under
  it and the basket and any half-typed discount are untouched. Sizes in stock at the till's own
  place are marked. Escape and the back gesture shut the sheet only.
- **Products**: a "Size guide" filter — *No size guide* / *Has a size guide*.
- **WhatsApp**: a 1080-wide PNG drawn on a canvas (OG mark, product, the table with both
  languages in the header, fit and note in both languages, the shop's name and phone). On a phone
  it goes through the share sheet as a file; elsewhere it downloads and WhatsApp opens with the
  caption — Arabic, the rule, English (`WA.both`).

### The website — a door of its own (contract change)

The brief asked for `sizeGuide` on `GET /api/ext/products` and `/:id`. **It is on its own door
instead**: `GET /api/ext/products/:id/size-guide` on the laptop and
`public.web_size_guide(p_key, p_id)` in the cloud. Same reason as Stage 1's question 1: the
product answer must stay identical to the cloud's `web.product_row`, which is the same text in
four cloud files; a new function touches none of them. The shape, the same from both:

```json
{ "ok": true, "sizeGuide": {
    "unit": "cm",
    "measures": [{ "id": "chest", "unit": "cm", "en": "Chest width", "ar": "عرض الصدر" }],
    "rows": [{ "size": "S", "values": { "chest": 50.5, "length": 70 } }],
    "fit": "small | true | large | null",
    "note": { "en": "…", "ar": "…" } } }
```

`sizeGuide` is `null` when the product has none or it is incomplete; a product the website cannot
show (archived, off the site, waiting for photos) is `not_found` from both. Never any cost.

### Files

New: `server/migrations/077_size_guides.sql`, `server/lib/sizeguide.js`, `js/sizeguide.js` (in
`index.html` and `sw.js`), `server/supabase/044_size_guides.sql`, `verify_044_size_guides.sql`,
`server/test/sizeguide.test.js`. Changed: `server/lib/catalogue.js`, `server/index.js`,
`server/lib/config-writable.js`, `server/lib/mirror.js`, `server/lib/restore.js`,
`server/lib/drift.js`, `server/scripts/supabase-reconcile.js`, `server/supabase/README.md`,
`server/supabase/status.sql`, `js/data.js`, `js/colourform.js`, `js/app-warehouse.js`,
`js/app-products.js`, `js/app-actions.js`, `js/app-changes.js`, `js/pos.js`,
`js/app-settings.js`, `js/app-i18n-extra.js` (77 keys each language), `css/og-skin.css`,
`sw.js` (v346).

Routes: `GET /api/size-charts` (`product.read` or `product.write`); `POST /api/size-charts`,
`PATCH /api/size-charts/:id`, `POST /api/size-charts/:id/duplicate`,
`PUT /api/products/:id/size-guide` (`product.write`); `POST /api/products` takes `sizeGuide`;
`GET /api/ext/products/:id/size-guide` (the website key).

### Supabase — by hand, in this order

1. `server/supabase/044_size_guides.sql` (after 043), then `verify_044_size_guides.sql` — 8 ✅.
2. `server/supabase/030_erp_access.sql` again.
3. `npm run supabase:reconcile` on the VPS.

Until 044 is run the sync skips the two tables by name and says so; nothing else stops.
044 is standalone like 043 (tables plus website functions), so it is not in `CATCH-UP.sql`.

### How it was verified

- `cd server && npm test` — **121 green** (5 new in `test/sizeguide.test.js`).
- `_nightshift/n1028/s2-api.mjs` — **21 green** over HTTP, read back from SQLite: "50,5" stored
  as 50.5; the cashier refused; > 300, two decimals and an unknown measure refused naming the
  cell; a T-shirt with no guide refused **and nothing written**; an incomplete one refused naming
  the empty cells; an own guide stored in size order; a follower taking a chart's new numbers; a
  new size adding an empty row; every write in `change_log`; the website door; deleting a product
  deleting its guide.
- `_nightshift/n1028/s2-parity.mjs` — **15 green**: PGlite running cloud files 001…044; laptop =
  cloud for seven products (own, follower, jeans, shoes, none, no photos, incomplete); 044 twice;
  `verify_044` all ✅.
- `_nightshift/n1028/s2-ui.mjs` — **41 green**, three runs in a row, 1366 English and 390
  Arabic: a chart made in the UI with a pasted column and Enter walking the grid, read back from
  SQLite; a T-shirt refused before the request with the reason under the grid; saved following
  the chart; the drawer card; Send size guide (a PNG and the two-language caption); the editor
  switched to own numbers and saved; the till's sheet on top, Close hit-tested, Escape leaving
  the size picker open, the basket unchanged; the filter; no sideways scroll; no console error.
- Found on the way and fixed: `writeRow` could not bind an undefined user id; "New chart" was
  drawn while the list loaded and the card redrew under the press.
- Screenshots `night-shots/stage2/`: `chart-editor-*`, `settings-charts-*`, `add-refused-*`,
  `add-guide-*`, `drawer-*`, `edit-*`, `till-sheet-*` (1366-en and 390-ar each), and
  `whatsapp-en.png`, `whatsapp-ar.png` (the picture itself).

### Not done

- **The brief for Ahmad** (contract v1.10, `docs/website/UPDATE-SIZE-GUIDE.md`) — the shape is
  above; the file was not written.
- In the WhatsApp picture a long product name is cut at 34 characters.
- On a phone, four ticked measurements make the grid scroll sideways inside its own box (the page
  does not).

### Questions

2. **"Length" is one measurement for tops and bottoms.** A tracksuit sold as one product (top and
   trousers) would need two lengths. Is that a real case?
3. **Shoes are optional, but the Settings chips list every category** — the owner could mark a
   shoe type as required. Allow that, or keep shoes always optional?

---

## Stage 3 — Deposit (عربون)

**Decision: a till reservation is a pickup order paid by deposit** (`Orders.create`, method
`pickup`, plan `deposit`), plus one row in a new `reservations` table (`078_deposits.sql`): until
when it is held, the least the deposit could be, and who agreed a smaller one. Everything else is
the order's:

- the pieces leave stock with the sale, so they are held and can't be sold or counted as in stock;
- a cash deposit goes into the drawer as an order payment, with an opId;
- what is owed is derived;
- release goes through `Orders.takeBack` with outcome credit, so it becomes store credit and no
  cash moves (refund is the manager's choice).

The status (held / collected / released / expired) is derived, never stored. A reservation also
appears on the Deliveries board as a waiting pickup. `Orders.create` gained a `within(d, result)`
hook, so a deposit below the minimum rolls the whole order back.

**Permissions:**
- `sell` takes, collects and extends a reservation.
- `discount.unlimited` agrees a smaller deposit for one customer (owner and manager).
- `void` releases one; `void` + `money.move` releases it as a refund.

**Website:** `web_orders` gained deposit columns (local only). `POST /api/web-orders/:ref/deposit`
(`delivery.web`) sets a percentage or an amount. The website reads
`GET /api/ext/web-orders/:ref/deposit` and `GET /api/ext/deposit` through the VPS, behind the
website key. **Question 4:** the cloud copy doesn't carry it — should it?

**Bell** (`alerts.js`): `res_ends` (ends within a day), `res_expired` (past its date — open it:
extend, or release), `web_chase` (a website deposit paid, the rest not, past the chase days). The
words are in both languages, and pressing a row opens that reservation (or the website order).

**Settings:** `deposit.till_pct`, `deposit.online_pct`, `deposit.hold_days` and
`deposit.chase_days` are seeded and on `CONFIG_WRITABLE` (value-checked). `CONFIG.DEP_*` is
hydrated.

**Mirror:** `reservations` is synced behind its own guard, and added to restore ORDER, drift,
reconcile, `people.js` LOGGED and purge-demo. Cloud files: `045_reservations.sql` and its
verify (PGlite: all ✅, and 044 still ✅).

**Verified:** `_nightshift/n1028/s3-api.mjs` — 32 green over HTTP, read back from SQLite. It
covers:
- refusals with no customer, under 50%, and a cashier agreeing a smaller deposit;
- exactly 50% accepted, the stock held, one drawer payment;
- an opId replay;
- the catalogue's `held`;
- a short collect refused, then a full collect;
- extend;
- the expired row in the bell;
- release as credit (stock back, credit granted, no cash moved) and a refund;
- the website deposit, default and set.

**The screens (`js/reserve.js`, global `Reserve`, `data-rv`):**
- **The till**: two buttons under Complete sale — **Reserve with a deposit** and
  **Reservations · N**. The reserve dialog shows the customer (or says to attach one, with no
  button), the total, the least deposit (50%) as the hero figure, held until, the deposit box
  pre-filled with the minimum, the payment methods as chips, and — owner and manager only — an
  "agreed deposit for this customer". Under the minimum is refused in the dialog before the
  request. On success the basket clears and the slip prints.
- **The deposit slip** is the order slip (total, the deposit payment, STILL OWED, the barcode)
  with a new line **HELD UNTIL · محجوز لحد** and the date (`printing.js`, `receipt.js`).
- **A reservation's dialog**: customer and phone, held until (or "past its date"), total, paid,
  still to pay, the pieces; **Take X and hand over** (the rest, method chips; prints the
  receipt), **Hold N more days**, and for `void` **Release as store credit** / **Refund the
  deposit** — each asks once, naming the amount and the customer.
- **Scanning the slip** (its invoice number, digits matched so the Arabic keyboard layout still
  works) opens the reservation from any screen.
- **Product drawer**: "Held for a reservation" — size × qty, for whom, until when, with Open.
  The held pieces are already out of stock everywhere (the till, the website's `inStock`).
- **Settings → Money and prices → Deposit (عربون)**: the till %, the website %, held for (days),
  chase after (days); each saves itself.
- **Website orders**: each new order's card has **Deposit needed** — a number and `% / USD /
  SYP`, badged "The usual" or "Agreed", with Save.

Found and fixed on the way:
- My first strings used the `rv_` prefix, which the **Reviews page already owns** (`rv_title`,
  `rv_none` …), and the later block was overriding Reviews' words. They are `rs_` now; Reviews
  is back to its own words.
- On a phone, the till's cart sheet stayed above a dialog opened from it, covering the dialog's
  buttons. Now the reservation dialogs close the sheet first, and any dialog hides it
  (`body[data-overlay] .pos-right`). This also fixes the size guide's sheet.
- The size guide's badges used class names this app doesn't have; they now use
  `healthy` / `low`.

**Verified, the screens:** `_nightshift/n1028/s3-ui.mjs` — **35 green**, three runs in a row, at
1366 English and 390 Arabic. As the cashier: no customer said; under the minimum refused; a real
reservation read back from SQLite; the basket cleared and the slip sent; the list; open; extend
(SQLite); no Release button; collect (delivered and paid in full, SQLite). As the owner: a
scanned slip opens it; release as store credit (SQLite). Settings → Deposit saving itself
(config). The bell row's words. The website order's deposit box saving 30% (SQLite). No sideways
scroll, no console error. `s3-api` 32 green again; `npm test` 121; `fix05/p0-namespaces` 6;
`s2-ui` still green. Screenshots `night-shots/stage3/`: `reserve-*`, `list-*`, `open-*`,
`release-*`, `settings-*`, `weborder-*` (1366-en and 390-ar).

**Not done:** the Products list has no "held" badge per row (the drawer has it; `Reserve.heldCount`
is there for it); the warehouse's "Where is it?" doesn't name holds; the website's own screens
(Ahmad) need the two new addresses — `GET /api/ext/web-orders/:ref/deposit`
(`{ ref, state, deposit: { pct, amount, currency, source, setAt, order?: { total, paid,
remaining, currency } } }`) and `GET /api/ext/deposit` (`{ onlinePct, chaseDays }`).

---

## Stage 4 — Suppliers and the Money pages

No recent or uncommitted money work by Ahmad was found (`git status` was clean at the start;
the last money commits are 17 Oct, `7f64afe` and `25e4d2c`). Nothing was removed — every screen
is still reachable.

### The new structure (proposed, then built)

Money was four places, two of them with switches underneath; Suppliers was inside "Payments",
a word that also meant expenses and wages, and was reached a second way from "Who owes whom".

| Before | After |
|---|---|
| Where it is | Where it is |
| Close the day | Close the day |
| Payments → Expenses / Suppliers / Salaries | **Suppliers** (one tap, no switch) |
| | **Expenses & wages** → Expenses / Salaries |
| Books → Statement / Money history / Who owes whom / Shift | Books (unchanged) |

On a phone the bar wraps onto two lines instead of sliding sideways.

### The five bugs

1. **Expenses contradicting itself — fixed.** The month figure and "Where it goes" counted lira
   only (`DB.expensesBetween` filtered to the base currency), so a $100 expense was in the table
   under "Spent this month: 0" and "No expenses recorded yet". The month is a pair now (lira,
   then "+ $100"), each category shows each currency it was spent in, and the empty line appears
   only when there is truly nothing. `expensesBetween` / `expensesInMonth` take a currency;
   their other callers are unchanged (they still get the base).
2. **Pay one tap from a mistake — fixed, and the same check is on every dialog that pays out.**
   - The amount starts **empty**, with **All · $12,328.99** and **Half** as one-tap chips.
   - "From" defaults to the first place that **holds enough** of that currency, else the place
     holding the most, else the drawer — never an empty "with the owner" by position.
   - A live line under "from" says what the place holds, **in amber** when this payment would
     leave it below zero.
   - The **first press** of a payment that takes a place below zero writes nothing: an amber box
     names the place, what it holds and what it would hold, offers **Owner puts it in first**
     (which opens the owner dialog on "puts in", that place, currency and amount), and the
     button reads **Pay anyway**. The second press with the same place, currency and amount
     goes. **Warns, never refuses** — the book allows a negative on purpose.
   - The same check (`Cashbook.belowZero`) is on: pay a supplier, add an expense (when a place is
     chosen), wages (salary and advance), and move money (the amount plus the fee).
3. **Two suppliers with the same name — warned, nothing merged.** Creating or renaming a
   supplier to a name like one that exists (folded like customers' names; one starting with the
   other counts) shows them, with what each is owed, and asks once more ("Save anyway").
   **Duplicates found:** on this laptop's copy (11 Oct) and the sandbox: **"VACHE" (id 2, USD,
   owes the big balance) and "VACHE V" (id 1, SYP, owes nothing, contact "VACHE")**. Check the
   live list; merging is the owner's call (question 5).
4. **"Paid as" — reworded.** A goods-received row now says **"Goods received · on PO-0002 ·
   10,500 SYP = $73.43 (at 143)"**: the order, what it was priced in, what that came to in the
   supplier's currency, and the rate frozen on the row. A payment in the other currency says the
   same conversion. Nothing says "paid" unless something was paid.
5. **Sales = Takings — fixed.** Takings = sales + shipping charged − returns. In a month with
   neither, the Statement draws **Takings alone**; when they differ both rows are drawn and
   Takings says "sales + shipping charged − returns" under its name.

### Simpler

- **Supplier list**: one row per supplier — the name and phone, **what we owe, big**, the due
  badge, last paid, and **Pay only when something is owed** (a supplier owed nothing shows ›).
  The row opens the supplier's page; History and Edit are there.
- **The supplier's page** (drawer): what we owe, big, with the due badge; **why it is more than
  what was bought** ("Bought $11,428.99, plus an opening balance of $900 from before the
  system"); Pay and Edit; the phone with **WhatsApp** (a two-language greeting through `WA.both`)
  and **Call**; the notes; the purchase orders; the history. After paying from the page, it comes
  back with the new figure.
- **Supplier form**: a proper **phone** field (`type=tel`) and **notes**; the old free-text
  "Contact" stays as "Who to ask for". Migration **079** adds `suppliers.phone` and
  `suppliers.notes`, with a `mirror-lag.js` entry and cloud file **046** (appended to
  `CATCH-UP.sql`).
- **Starting balances, one place at a time**: "Place 2 of 5 — how much is here now", lira and
  dollars, **Next / Back / Skip**. Nothing is saved until the last step, and then all at once,
  so leaving half-way changes nothing. Still optional.
- Look: quiet cards, the owed figure the only loud one, amber (not lime) for warnings, 44px on a
  phone, no sideways scroll.

### Files

`js/money.js`, `js/payables.js`, `js/cashbook.js`, `js/statement.js`, `js/data.js`,
`js/app-i18n-extra.js`, `css/og-skin.css`, `server/lib/payables.js`, `server/lib/mirror-lag.js`,
`server/migrations/079_supplier_phone.sql`, `server/supabase/046_supplier_phone.sql`,
`server/supabase/CATCH-UP.sql`, `server/supabase/status.sql`, `server/supabase/README.md`,
`sw.js` (v348).

### Supabase — by hand

1. `server/supabase/046_supplier_phone.sql` (or `CATCH-UP.sql` again).
2. `npm run supabase:reconcile` on the VPS.

Until 046 is run, suppliers go up without the two columns and the sync names the file. Nothing
stops.

### How it was verified

- `_nightshift/n1028/s4-ui.mjs` — **40 green**, at 1366 English and 390 Arabic, read back from
  SQLite:
  - Money has five places;
  - starting balances step by step;
  - a supplier saved with phone, notes and a $900 opening;
  - a similar name warned and saved on the second press;
  - no Pay on a supplier owed nothing;
  - the page explaining the opening balance, with WhatsApp and Call;
  - Pay opening empty from a place that holds money;
  - All filling the balance;
  - paying from "with the owner": amber before any press, the warning with nothing written,
    then paid on the second press;
  - the page coming back;
  - a dollar expense in the month;
  - Statement without the doubled row;
  - no sideways scroll, no console error.
- The older Money suites, updated where this changed on purpose (five places; the amount starts
  empty; the below-zero second press), all green on the scratch copy: `fix05/p4-money` 49,
  `ns03/p2-money` 39, `ns02/p4-money` 22, `money-polish/press` 35.
- Screenshots `night-shots/stage4/`: `money-now-*`, `start-*`, `suppliers-*`, `supplier-dup-*`,
  `supplier-page-*`, `pay-below-zero-*`, `expenses-*`, `statement-*` (1366-en and 390-ar).

### Questions

5. **Merge "VACHE" and "VACHE V"?** Nothing was merged or deleted. The SYP one owes nothing; it
   could be switched off (archived) from its Edit, or merged by hand if any purchase orders name
   it.

---

## At the very end

- The server starts cleanly on the scratch copy (migrations 077, 078, 079 applied); `npm run
  preflight` passes; `cd server && npm test` 121 green; `fix05/p0-namespaces` 6.
- The every-screen sweep (`ns03/sweep`), every role, both languages, six widths: **1316 passed, 0 failed**.
- CLAUDE.md has a section for each new feature (end of the file).
