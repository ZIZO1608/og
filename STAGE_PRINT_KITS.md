# STAGE — Jersey print kits + website print orders to Yalla Wear

Built 7 Oct 2026 on branch `feature/print-kits` (worktree `D:\DESKTOP\og-print-kits`), off `main`
at 1b2f386. **Not committed and not merged.** A commit on `main` publishes to the live shop by
itself, so nothing reaches `main` until this is approved — and **cloud file 041 must be run
before then** (see "By hand").

Local migration **071**, cloud file **041**. The next local migration is now `072`, the next cloud
file `042`.

---

## 1. What was built, item by item

| # | Asked for | Built |
|---|---|---|
| 1 | Config | `print.unit_price = '500'` + **new** `print.unit_currency = 'USD'` ($5.00, see §4 note), `print.max_letters = 12`, `print.turnaround_min = 5`, `print.turnaround_max = 7`. All four editable in Settings → Money and prices → Website print price (now in dollars, with the lira under it), checked by `configRefusal`. |
| 2 | Tables | `print_fonts`, `print_kits` (local 071, cloud 041). Mirror shape like `clubs`: pushed whole by content hash, deletes follow, own guard naming 041. Added to `WHOLE_KEYS`/`syncSettings` (mirror.js), restore `ORDER` + `SEEDED`, drift `PUSHED`, supabase-check `WHOLE`. **Not** on the reconcile list — whole-shape tables are rewritten every sync, which is the reconcile script's own rule (`clubs` is not on it either). 041 has RLS on, no policy, and the 038 GRANT/REVOKE block. |
| 3 | Columns | `products.printable`, `products.print_kit_id`; `print_jobs.web_ref` (unique where not null); `print_job_lines.print_kit_snapshot` (text locally, **jsonb** in the cloud — `snapshotForPg` in mirror-lag.js converts on the way up, restore's `adapt()` on the way back). Each has a `mirror-lag.js` entry **in its own group**, so a mirror without 041 drops only the new column, not the older ones beside it. Plus `deliveries.print_override` for item 10. Products and print jobs are already logged through `logChange` (Cat.update, Partner.create); deliveries' override too. |
| 4 | Seed | Fonts 1–4: OG Block = Anton, OG Classic = Graduate, OG Modern = Teko 700, Syria = Cairo 700. Kits 1–6 as specified (OG Block default + featured; Classic, Modern featured; Syria/Syria Green white, Syria White black, Cairo). A printable product with no kit uses the default kit. |
| 5 | Storage | Public bucket **`print-fonts`** (allowed types font/woff2, font/ttf, font/otf, 4 MB), service key on the server only. `.ttf`/`.otf` only, judged by the file's first bytes; the original and the WOFF2 both uploaded, both URLs saved. The seed fonts are fetched from github.com/google/fonts 20 s after the main server starts (and by the Fonts tab's **Upload now**). |
| 6 | Screens | New page **Print kits** (`#printkits`, sidebar + phone More → Stock): **Kits** tab (cards with the shirt drawn, ⋯ menu: edit, make default, offer on website, put away) and **Fonts** tab (each font shown as "NAME 10" in itself, upload, rename/weight, new file, put away). The kit form has every field and a live jersey-back preview (name on the arc + number). Product form gains a **Print** section: printable switch; club + season + kind → the existing kit attaches with its preview, otherwise **Create kit** opens the kit form pre-filled and attaches what it saves. |
| 7 | Catalogue | `webRow()` and the cloud `web_products`/`web_product` carry `print` (null when not printable); `GET /api/ext/print-styles` and cloud `public.web_print_styles(key)`. |
| 8 | Order intake | `lib/weborders.js` checks each printed line (`PrintKits.checkLine`); unknown `kitId` → the product's kit, else the default; a bad line is named on the card and **Accept is refused** (409 `bad_print`) until somebody calls or rejects with the new reason `bad_print`. |
| 9 | Auto job | On accept (`POST /api/orders` with `webRef`), ONE job through `Partner.create({autoSend:true})`, idempotent per `web_ref`. |
| 10 | Delivery guard | A sale with a print job not `done` cannot leave the counter (send out, deliver/collect a pickup, or a hand-over sheet). Board, table and order dialog say "Waiting for print · P-xxxx · stage". The owner/developer can "Send without the print…" with a reason (`POST /api/deliveries/:id/print-override`). |
| 11 | Tracking | `public.web_print_tracking(key, ref)`: key check + `auth.uid()` must own the cloud order. Returns only `order_state`, `stage`, `deadline`, `stages[{stage, at}]`. |
| 12 | Permission | `print_kits.manage`, seeded for every role that holds `product.write` on this database (owner, developer, manager, warehouse here), and copied to anyone granted `product.write` by name. |

## 2. The `print` object (on every product; `null` when it takes no print)

Identical from `GET /api/ext/products` (laptop) and `web_products` / `web_product` (cloud):

```json
"print": {
  "kitId": 1,
  "label": "OG Block",
  "font": { "name": "OG Block", "url": "https://…/print-fonts/fonts/…-og-block.woff2", "weight": 400 },
  "textColor": "#ffffff",
  "outlineColor": null,
  "outlineWidth": 0,
  "shadowColor": null,
  "shadowDx": 0,
  "shadowDy": 0,
  "nameSize": 34,
  "nameY": 165,
  "nameArc": 30,
  "numberSize": 160,
  "numberY": 345,
  "price": { "USD": { "amount": 500, "minorExp": 2 }, "SYP": { "amount": 690, "minorExp": 0 } },
  "maxLetters": 12,
  "turnaround": { "min": 5, "max": 7 }
}
```

- **`font.weight` is an addition to the brief.** Teko and Cairo exist in google/fonts only as
  *variable* fonts, so "bold" is a weight to draw at, not a separate file. The website should
  declare the face with `font-weight: 1 1000` and draw at `font.weight`. `url` is `null` until
  the font has been uploaded.
- `price` has the same shape as `prices`; `null` when no print price is set. No cost anywhere.
- Geometry, in a 400 × 440 jersey-back viewBox (what the admin preview draws): the name on a
  quadratic curve `M70 nameY Q200 (nameY − 2·nameArc) 330 nameY`, centred
  (`text-anchor: middle`, `startOffset: 50%`); the number centred at x 200, baseline `numberY`;
  the outline is a stroke of `2 × outlineWidth` painted under the fill; the shadow is the same
  text in `shadowColor` moved by `(shadowDx, shadowDy)`.

`web_print_styles(key)` / `GET /api/ext/print-styles` → `{ ok, styles: [ <same shape, no price> ], version }`
— featured, non-archived kits, the default first.

`web_checkout`'s `print` block keeps `unitPrice` **in the base currency** (now 5 × rate lira)
and gains `unit` (`{amount: 500, currency: "USD"}`), `prices`, `maxLetters`, `turnaround`.

## 3. The order line the website sends

```json
"items": [
  { "sku": "OG-061-L", "qty": 1, "print": { "name": "MESSI", "number": 10, "kitId": 12 } }
]
```

- The name is trimmed, spaces collapsed, upper-cased, a typographic apostrophe read as `'`;
  then `A–Z`, space, `.`, `'`, `-` only, at least one letter, at most `print.max_letters`.
- `number`: a whole number 0–99 (a JSON number, or a string of one or two digits).
- Name and number are both required. The product must be `printable`.
- `kitId` unknown, missing or put away → the product's own kit, else the default kit (said on the
  card as "the default kit").
- Problem codes (card + 409 `bad_print` detail): `print_bad`, `print_unknown_product`,
  `print_not_printable`, `print_name_and_number`, `print_bad_name`, `print_name_too_long`,
  `print_bad_number`, `print_no_kit`. The rejection reason shown to the customer is the new
  `bad_print` (the website needs words for it).
- **The older shape still works**: `prints[]` (design + lines/qty) is still collected and sent to
  Yalla Wear the moment the order is collected, as before. The two shapes can sit in one order.
- The cloud's `web_order_submit` was **not** changed: it passes `items[].print` through untouched
  (payload ≤ 16 KB); all checking is on the laptop, as the brief asked.

**The job raised on accept:** kit job, `source 'web'`, `web_ref`, `sale_id`, customer + phone +
`customer_id` from the sale's customer, `qty` = sum, `price = qty × webPrices().price` (5 USD at
the rate of the moment, in the job's base currency — the till's own rule for a dollar price),
`cost` by the existing web rule (`unit_cost = print.partner_unit_cost` per line, job cost null),
`deadline` = shop's today + `turnaround_max`, sent to Yalla Wear at once (`autoSend`). One line
per printed item: `club_code` from the kit (null for a style, or a club the shop no longer
prints), `print_name`, `number`, `size`, `qty`, `item` (product name), `print_kit_snapshot`.
A second Save replays the order and finds the job; a failed raise is retried by the next Save
and shown on the card meanwhile.

## 4. Decisions worth checking

- **`print.unit_currency` is a new key.** "The existing format" of `print.unit_price` was whole
  units of the base currency (lira). 5 USD written that way would be a lira price that goes stale
  as the rate moves, which is the 067 problem. So the number is minor units of
  `print.unit_currency`; a missing currency means the base currency, so an old lira price keeps
  its meaning. Every existing reader (`Partner.webPrices().price`, `web_checkout.unitPrice`) still
  gets base-currency lira.
- **The kit's uniqueness ignores put-away kits** (one *live* kit per club/season/kind), and two
  NULLs count as equal (a plain UNIQUE would let two "Syria" kits with no season through). The
  cloud has no unique index on kits on purpose: a whole-table push that swaps two kits would be
  refused half way.
- **Only one default, and it cannot be un-ticked or put away** — another kit is made the default
  instead, or every printable product would have nothing to print in.
- **A font a live kit uses cannot be put away** (`font_in_use`, naming the kits).
- **WOFF2 without npm.** The server has no dependencies by design, so `wawoff2`/`ttf2woff2` were
  not added. `server/lib/woff2.js` writes WOFF2 with Node's built-in Brotli and the spec's null
  transform for glyf/loca (allowed by W3C WOFF2 §5.1). Files are ~10–25% bigger than a fully
  transformed WOFF2 (Anton 171 KB → 65 KB; Cairo variable 600 KB → 182 KB). Byte-exact round trip
  checked, and Chrome (whose OTS sanitiser is strict) loads them.
- **The CSP's `font-src` gained `https:`** — the same reason `img-src` has it: the faces live in
  the public bucket.
- **Tracking ownership.** `web.orders` had no customer identity. 041 adds `auth_uid` and a
  `BEFORE INSERT` trigger that stamps `auth.uid()`, so `web_order_submit` did not have to be
  rewritten. It only works if **the website calls `web_order_submit` with the signed-in
  customer's session** (supabase-js with the user's JWT); an order placed without signing in
  can't be tracked through this door (`not_found`), and orders placed before 041 have no owner.
  `search_path = public` as the brief said (the rest of the repo uses `''`).
- **The delivery hold** blocks any print job on the sale that isn't `done` — including a till
  sale with a print job and a delivery, and a job Yalla Wear *declined* (that one needs the
  owner's override or the job moved on). The override is owner/developer by role, written on the
  delivery (`print_override`, mirrored) and in the change log.

## 5. Files

New: `server/migrations/071_print_kits.sql`, `server/lib/printkits.js`, `server/lib/woff2.js`,
`server/supabase/041_print_kits.sql`, `server/supabase/verify_041_print_kits.sql`, `js/printkits.js`.

Changed — server: `index.js` (kit/font routes, ext styles route, accept → job, override route,
error codes, seed at start), `lib/auth.js`, `catalogue.js`, `config-writable.js`, `deliveries.js`,
`orders.js`, `partner.js`, `weborders.js`, `storage.js`, `http.js` (CSP), `mirror.js`,
`mirror-lag.js`, `restore.js`, `drift.js`, `scripts/supabase-check.js`,
`scripts/supabase-reconcile.js`. Cloud: `031_web_payments.sql` (web_checkout, same text as in
041), `037_web_products.sql` and `040_product_web_extras.sql` (web.product_row, same text as in
041 — it calls `web.print_of` only when it exists), `status.sql`.

Changed — browser: `index.html`, `sw.js` (precache + `og-system-v316`), `css/og-skin.css`,
`js/app-shell.js` (nav, gate, More), `app-routing.js`, `app-boot.js`, `app-products.js`
(Print section), `app-actions.js`, `app-settings.js`, `app-changes.js`, `data.js`,
`deliveries.js`, `desk.js`, `road.js`, `weborders.js`, `app-i18n-extra.js` (every string in
English and Syrian Arabic).

## 6. By hand, in this order

1. **Supabase SQL editor:** run `server/supabase/041_print_kits.sql` (after 037 and 040 — they
   are already on the live project), then `verify_041_print_kits.sql` — rows 1–8 ✅, row 9 ⚠️ until
   the first sync after it.
2. **Run `030_erp_access.sql` again** so `og_vps` can read the two new tables.
3. Approve and merge → the shop runs 071 on its next start (the VPS on `npm run vps -- deploy`,
   which auto-publish does on commit).
4. `npm run supabase:reconcile` on the VPS (fills the new columns for rows pushed before 041 ran;
   until 041 exists the sync pushes without them and names the file).
5. The seed fonts upload themselves ~20 s after the VPS server starts; if the Fonts tab still
   says "not uploaded", press **Upload now**.
6. Tell Ahmad: the `print` object, `web_print_styles`, the order line, the `bad_print` reason,
   `web_print_tracking` (and that `web_order_submit` must be called with the signed-in user's
   session for tracking to work).

## 7. Verified

- `npm test` 62/62 (the config-keys test reads the new settings writers).
- `_nightshift/print-kits/api.mjs` **68/68** on a scratch copy of the sandbox (port 8199, a fake
  Storage server): permissions, kit refusals, default/archive rules, a real Anton upload (stored
  `wOF2`, served as font/woff2), config checks, the catalogue `print` object and price, styles,
  every bad-print code, accept refused then rejected with `bad_print`, the job's every field read
  from SQLite, a replayed Save making no second job, the board's hold, manager refused / owner
  overriding, a print finished then delivered, a hand-over sheet refusing the parcel.
- `_nightshift/print-kits/sql.mjs` **41/41** in PGlite running the real 001…041: laptop =
  cloud field for field, a cloud without 041 still answering, tracking (owner / someone else /
  signed out / no print / wrong key / anon refused), the snapshot landing as a jsonb object,
  re-running 031/037/040/041, verify_041 all ✅. It caught a real bug first: `web_checkout`
  failed on a project without 041 (plpgsql resolves a function named in a `case` even on the
  branch that never runs) — fixed with dynamic calls.
- `_nightshift/print-kits/ui.mjs` **37/37** in Chrome: the page, the fonts actually loaded, the
  kit form's live preview, a kit saved and read back, the duplicate refused in words, a font
  uploaded through the real file chooser, the product form's Create kit and attach, the price
  saved in dollars, the board's hold, the website-order card, Arabic at 390 (no raw key, no
  sideways scroll, the form a bottom sheet). `woff2-chrome.mjs`: Anton and the variable Cairo
  load in Chrome.
- Re-run green against the worktree: `web-extras/parity` 35, `usd-prices/parity` 40,
  `audit06/web-pay-sql` 53, `audit06/web-orders-sql` 72, `fix05/p0-namespaces` 6,
  `fix06/idle` 2 (the new page makes 0 requests while idle).
- `ns03/sweep` (every screen, every role, six widths, both languages): **1281 passed, 1 failed**.
  The one is the Settings → Mirror fold in Arabic at 390, whose "automatic sync off
  (OG_SYNC_MINUTES=0)" line runs past its card. It only shows on a server that has a Supabase
  URL with sync off — the scratch server here (it needed the URL for the fake font bucket) — and
  nothing in this stage touches that fold.

## 8. Not done

- **The contract** (`docs/website/PROMPT-FOR-AHMAD.md`) and a short brief for Ahmad are not
  written yet; §2–3 above are the content.
- **CLAUDE.md** has no section for this stage yet.
- **The print price is not charged in the sale.** As with the till and the old `prints[]`, the
  print job carries the price (`print_jobs.price`), but the order the desk writes contains only
  the shirts; the customer's $5 a jersey is not in the order's total or "still owed". Deciding
  how it is charged (a line on the sale, or collected with the order) is the owner's call.
- **Delivery after printing** is still not a route of its own (PRINT_FACTS §5): the job is
  linked to the sale, and the sale's ordinary delivery waits for it — nothing brings the shirt
  from Yalla Wear to the shop.
- The Add-product form has no Print section (the product editor does).
- The kit uniqueness counts archived kits as gone; a duplicate in data put in by hand is not
  repaired by the migration.
- Not tested on a phone's real Safari, and not against the live Supabase project.

---

# Stage 1b (8 Oct 2026) — the print charged on the sale, and the gaps

Same branch, `feature/print-kits`; still not merged. No new migration and no new cloud file: the
charge is a sale line, which the existing tables already hold. The by-hand order in §6 is
unchanged.

## 1. The print is charged on the sale

**There was no pattern for a line that is not stock, so one was added — a "service line".**
`Sales.SERVICES` in `server/lib/sales.js` lists the one there is:

| code | sku on the line | name on the line |
|---|---|---|
| `print` | `SVC-PRINT` | `Name & number print · طباعة اسم ورقم` |

- `Sales.record({ …, services: [{ code: 'print', qty }] })` (and `recordIn`, and
  `Orders.create({ services })`) adds the line **inside the sale's own transaction**, priced by
  the server: `print.unit_price` in `print.unit_currency`, through the same `convert()` a dollar
  shoe goes through at the sale's frozen rate ($5 at 138 = 690 lira). Its `unit_cost` is
  `print.partner_unit_cost` (460, in the shop's currency, converted to the sale's). No stock
  movement and no variant lookup: `sale_items.sku` has no foreign key, and `SVC-` is never minted
  for a product. The caller says only how many; quantity 1–500, else `bad_service`.
- **Discounts and coupons are about the goods.** The cashier's 10% ceiling and a coupon's cut are
  worked out on the goods, and the print is added after them. That is what the website is told to
  do too (v1.6: "a coupon takes off the items only").
- **Everything that reads the sale carries it**, because it is an ordinary `sale_items` row and
  part of `sales.subtotal`/`total`: what is still owed and `to_collect` (`Orders.money` reads the
  sale total), the cash book's sale move, the 80 mm receipt, the A4 invoice, the order dialog, the
  tracking page, the dashboard and Reports takings, the statement (the print's cost is now in the
  cost of goods, which is right — the shop pays Yalla Wear for it; paying Yalla Wear is still "below
  the line", so nothing is counted twice).
- **Readers that mean goods skip `SVC-`:** a void does not try to put a print back on a shelf; the
  stamp card does not count it as an item; a return does not offer it (`Orders.returnable`) — a
  refund for a print is the owner's call, by hand; the dashboard's best sellers and the pieces
  count leave it out.
- **Website order:** the route adds the line itself, counted from the order, never from the
  request (`WebOrders.printServices`): every printable item line that can be printed, plus the
  older `prints[]` (their lines' qty, or a plain qty). Nothing is added when no print price is
  set — the website said "price by phone", and the price is agreed on the call and put on the
  job, as before. The print job's price equals the line.
- **The order desk** previews the same line in a website order's total (`printLine` in
  `js/desk.js`, from the order's printed shirts and `print.unit_price`), so the running total, what
  is still owed, and a "paid in full" transfer agree with what the server writes.

**The till did NOT charge the print, and now does.** It drew "n × 950 = …" beside the basket and
posted only the shoes; the 950 was a constant in `js/pos.js`, unrelated to the website's price.
Now the till previews `print.unit_price` (at today's rate) as a "Name & number print" row in the
totals, sends `services: [{ code: 'print', qty }]`, and the server prices it — **so the till's
print price is now the shop's one print price ($5, 690 lira today), not 950.** The job's price is
taken from the line the server wrote. With no print price set, the till says so in the print box
and charges nothing; a hand-sent request for a print with no price is refused
(`print_price_unset`).

**Website total = sale total**, tested (`_nightshift/print-kits/sql.mjs`, "website total = sale
total"): the cloud's own figures — each item at `web_product`'s price, each printed shirt at
`web_checkout`'s print price — against the laptop's real `Orders.create` with the line the route
adds, for one order (two printed shirts + one plain item, pickup). Equal to the unit **in lira and
in dollars**.

## 2. The Add-product form

The same Print section as the product editor, between the prices and "More details": printable,
club + season + kind → the kit attaches, or Create kit (the form is the page, so it stays under
the kit form, and the new kit is attached when it saves). The section keeps its choice while the
form repaints, and is cleared for the next product. `Cat.createWithVariants` takes `printable` and
`printKitId` (checked like the editor's), so the product is made printable in the same request.

## 3. CLAUDE.md

A section "Jersey print kits, and the print charged on the sale" (tables, sync shape, the `print`
object, the order line, the charge, the delivery hold, the override, the tracking function, the
by-hand steps, the test rig), the migration numbers at the top (next local `072`, next cloud
`042`), and the stale "two print prices disagree" note in Known open work corrected.

## 4. The contract

`docs/website/PROMPT-FOR-AHMAD.md` is **v1.6**: a header note, a new **§3b "Printed names and
numbers"** (the rules, the `print` object, how to draw the shirt, `web_print_styles`, the order
line, how the total is made, what the shop checks, `web_print_tracking` and the signed-in-session
requirement for both it and `web_order_submit`), a pointer from §4's print paragraph, and
**`bad_print`** with its English and Arabic sentence in §7's rejection table.

## 5. Files

Server: `lib/sales.js` (services, the void), `lib/orders.js` (forwarding, `returnable`),
`lib/weborders.js` (`printServices`), `lib/catalogue.js` (`createWithVariants`), `lib/loyalty.js`,
`lib/dashboard.js`, `lib/reports.js`, `index.js` (both sale routes, error codes).
Browser: `js/pos.js`, `js/desk.js`, `js/printkits.js` (`formSection`), `js/app-warehouse.js`,
`js/app-actions.js`, `js/app-i18n-extra.js` (5 strings, both languages).
Docs: `CLAUDE.md`, `docs/website/PROMPT-FOR-AHMAD.md`, this file.

## 6. Test results (all on the scratch shop, port 8199)

| Suite | Result | What is new in it |
|---|---|---|
| `server` `npm test` | 62 / 62 | |
| `print-kits/api.mjs` | **83 / 83** | the sale's print line (qty, price, bilingual name, cost 460), total = goods + print, no stock movement, job price = line, the order owes it, a return does not offer it; a till sale with 3 prints, the cash book took the whole total, the cost not sent to the cashier, qty 0 refused, the void returns only the shoe, no price set → `print_price_unset` |
| `print-kits/sql.mjs` | **45 / 45** | website total = accepted sale total, SYP and USD |
| `print-kits/ui.mjs` | 37 / 37 | |
| `print-kits/ui-1b.mjs` (new) | **13 / 13** | the till: the print row, the grand total rising by n × 690, the sale and job in SQLite equal to the screen; the desk's running total = shirt + print; the Add-product section, its choice kept through a repaint, a product made printable in a kit |
| `web-extras/parity` | 35 / 35 | |
| `usd-prices/parity` | 40 / 40 | |
| `audit06/web-pay-sql` | 53 / 53 | |
| `audit06/web-orders-sql` | 72 / 72 | |
| `fix05/p0-namespaces` | 6 / 6 | |
| `fix06/idle` | 2 / 2 | the till, the desk and Print kits make 0 requests while idle |

Two harness notes: the scratch shop has no receipt printer, so the till's automatic receipt
answers 502 (filtered in `ui-1b`); and fonts the suites upload sit at the stand-in bucket's
plain-http address, which the CSP rightly refuses — a generic suite needs them turned into
`data:` URLs first, as before.

## 7. Still open

- **The owner should confirm the till's print price.** It is now $5 (690 lira today) instead of
  the till's old 950. If the till should charge differently from the website, that needs a second
  key.
- A refund for a print on a returned order is by hand (a return offers goods only).
- The Print screen's own "new job" form and the partner invoice still use `KIT_PRINT_PRICE` (180)
  as a per-kit figure — that is the job's side, not a customer charge, and was not changed.
- Not tested against the live Supabase project or on a real phone.
