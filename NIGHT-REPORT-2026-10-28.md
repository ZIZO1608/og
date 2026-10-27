# Night shift — 28 Oct 2026

Branch `night/2026-10-28`, one commit per stage. Nothing pushed, nothing merged, nothing run
against Supabase or the live shop. Every check ran against a scratch copy of the sandbox
database (`server/data-night/og.db`, made with `VACUUM INTO`, gitignored) on port 8210 with
`OG_SYNC_MINUTES=0 OG_PULL_AT_BOOT=0 OG_PUSH=0 OG_TELEGRAM=off`, no Supabase keys and bogus
bot tokens. The server's own startup line was read before the first write:
`database : D:\DESKTOP\OG System\server\data-night\og.db`.

<!-- SUMMARY -->

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
