# Night shift 02 — the "before" audit

Walked on the sandbox (`server/data-sandbox`, port 8190) on 18 Sep 2026, as each role in turn,
at 1100 × 760 with a mouse and at 390 × 760 with a thumb. Counts are for the **happy path** — the
job done right, first time, by somebody who already knows where everything is. A new employee
does worse, and the last column is why.

Key: **S** screens/surfaces · **C** clicks or taps · **T** fields typed · **X** choices
(a dropdown, a chip, a tick box, a tab) · **Y** confirmations.

A note on the counts: "screens" counts distinct surfaces a person has to understand — a tab
panel, a modal, a drawer, an OS dialog. "Choices" counts every control that offers options,
whether or not the person changes it, because a control that is there is a decision that has to
be made or knowingly skipped.

---

## 1. Products

| Job | Role | S | C | T | X | Y | Where you get lost |
|---|---|---|---|---|---|---|---|
| 1. New shoe, 1 colour, 6 sizes with stock, print labels | warehouse / manager | 2 (+2) | 4–7 | 9 | 2–8 | 0–2 | Warehouse opens on **Stock movements**, a wall of audit rows; "Add product" is the 4th of 6 tabs. Cost and price arrive **pre-filled with 1050 / 2250** and are not cleared between products. "Save product" and "Save & print labels" sit side by side, same size — nothing says the first prints nothing. |
| 2. New shoe, 2 colours | warehouse | 2 | 4–5 | 3 + sizes×2 | 2–4 | 0–1 | Adding a 2nd colour **retroactively requires a name on the 1st**; the refusal says "Every colour needs a name" while the chip still reads "Colour 1". A colour with names but no quantities blocks the whole save instead of being ignored. |
| 3. Add one more size to an existing product | warehouse | 3 | 5 | 2 | 2 | 0 | Buried in the drawer footer behind "Add a colour or a size", then a segmented control — the modal opens on **New colour**, so adding a size is always one extra choice. Size is free text (no check against the category's run). Qty 0 is accepted and silently creates a size with no stock row. No label and no shelf offered afterwards. |
| 4. Add a new colour to an existing product | warehouse | 3 | 4 | 2 + sizes | 2 | 0 | Same door. **No colour photo control here** (only on the Add form), and there is no way anywhere in the app to rename or recolour an existing colour. |
| 5. Change a selling price | manager | 3 | 4 | 1 | 0 | 0 | Products → row → drawer → **Edit product** → a 9-field modal for one number. Touching the Currency dropdown **blanks both price boxes**, and a blank price then fails to save. |
| 6. Add / change a product photo | manager | 2 (+OS) | 4 | 0 | 0 | 0 | Two different doors (the thumbnail itself, and an "Add a picture" link). Remove deletes the photo with **no confirmation**. |
| 7. On/off the website; archive | manager | 1 | 1 / 3 | 0 | 0–1 | 0 | **"Visible" means two opposite things.** The column and the edit checkbox are `on_web`; the drawer's "Visible" row prints `hidden` (archive). An archived product reads "On website: No". Archive has **no button of its own** — only inside the bulk bar after ticking a row, beside Delete, with no confirmation. The row then vanishes because the filter defaults to "active". |
| 8. Reprint labels for one product | warehouse | 2–4 | 3–6 | 0–1 | up to 8 | 0–1 | **Four different doors** into the same preview. Two buttons with the identical caption "Print barcode labels" in one drawer — one prints a size, the other opens a picker. The preview then asks up to 4 more chip choices. |

### Confirmed defects found while walking

1. **"Brand" and "Made in" on the Add-product form are dead fields.** `js/app-warehouse.js:630`
   and `:633` draw two `<input>`s with **no `id` and no `data-change`**; `wh-save`
   (`js/app-actions.js:1568-1587`) never reads them and the POST body carries neither. Anything
   typed there is discarded, silently. Brand *is* editable later in the edit modal, which makes
   the loss harder to notice.
2. **Prices are pre-filled with fake numbers.** `value="1050"` / `value="2250"` are literal
   markup (`js/app-warehouse.js:640,642`), not defaults from anywhere, and survive a save. A
   hurried save books a real shoe at 2,250.
3. **A blank selling price saves as 0** (`Number(...) || 0`, `js/app-actions.js:1555`) while the
   edit modal refuses a blank price — two rules for one number.
4. **Three toasts have no i18n key** and are hard-coded bilingual strings:
   `js/app-changes.js:122-123` (website toggle) and `js/app-actions.js:1535-1536` (the two
   Add-form refusals).
5. **The duplicate guard's buttons are the wrong way round**: the primary, eye-catching button
   abandons the save, and it is captioned "Add stock to this one" although it adds no stock — it
   opens the drawer.

---

## 2. Too many drawings

Every chart and data-drawing in the shop app, found by reading `js/charts.js` and every caller.

| # | What | Where | Who sees it | Verdict |
|---|---|---|---|---|
| 1 | `dashLine` — 6-month takings, line | Dashboard band 3 | manager, owner | remove |
| 2 | `dashDonut` — sales by category, doughnut | Dashboard band 3 | manager, owner | remove |
| 3 | `dashBars` — best sellers, horizontal bars | Dashboard band 3 | manager, owner | remove |
| 4 | `repChart` — **one canvas reused by all six Reports tabs** (line / bars / doughnut) | Reports | `report.read` | keep ONE, owner only |
| 5 | Product sales sparkline — 12 CSS bars | Product drawer | anyone with Products | remove → a sentence |
| 6 | Delivery progress **ring** (SVG) | Driver home | delivery | remove → "4 of 9 done" |
| 7 | Handover sheet % bar | Driver home | delivery | remove (the text beside it already says it) |
| 8 | Reports share-of-total bars (`repBar`) ×5 | Reports tabs | `report.read` | remove → the % number |
| 9 | Expenses-by-category bars | Money screen | `money.read` | remove → figures |
| 10 | Reviews star histogram, 5 clickable bars | Reviews | `delivery.desk` | keep the filter, drop the drawing |
| 11 | Stock-count progress bar | Warehouse count | `stock.count` | **keep** — a progress indicator, not a data drawing |
| 12 | `ylChart`, `ylProdChart` | Yalla Wear portal | partner | **out of scope** — untouched |

`Chart.js` is 200 KB (`js/vendor/chart.umd.min.js`), loaded by a `<script>` tag at
`index.html:59` on **every** page load, for every role — including the till, which has never had
a chart on it. `Charts.compact()` is also the app's number formatter (`js/app-util.js:137,161,176`),
so the module itself has to stay.

---

## 3. Stock

The warehouse screen is **six tabs and no verbs**. Walked as `member1` at 1100 px, the tab bar
wraps onto two rows and the landing tab is `Stock movements` — an audit log.

| Job | Role | S | C | T | X | Y | Where you get lost |
|---|---|---|---|---|---|---|---|
| 9. Receive a purchase order | warehouse | 3 | 3–4 | **0** | 1 | **0** | **There is no receive dialog at all.** One press books the whole order into Back storage and moves the supplier balance, with no review, no undo, and nothing on screen saying where it landed. Then a **label preview modal opens by itself**, which reads as an error. |
| 9b. …a short delivery, 8 of 10 | warehouse | — | — | — | — | — | **Not possible.** The column, the library and the route all support `received:[{sku,qty}]`; no screen ever sends it. Both workarounds corrupt the record — a write-off tagged `damaged`, or an order that stays "sent" for ever. |
| 10. Goods arrived that were NOT ordered | warehouse | 2–3 | 2–6 | 0–7 | 1–5 | 0–1 | **There is no "goods arrived" screen.** Three unrelated back doors: the Add-product form (new line), the drawer's "Add a colour or a size" (new colour/size), and **Scan → "Put into stock"** — which is the only way to add to a size that already exists, requires the barcode in hand, and is **not signposted from the Warehouse screen at all.** Boxes arriving carry no barcode yet. |
| 11. Move 5 pairs back → floor | warehouse | 2 | 3 + 5 scans | 0 | 0 | 1 | Genuinely good once found — but the button is third in a row of three in the header, and **From/To are reset on every open**, so ten trips floor→store means re-swapping the direction ten times. The log always records the reason as **"Carried to the floor"** whichever way the stock went. |
| 12. Where is it, and how many of each size in each place | anyone | 1–3 | 2–3 | 0 | 1–2 | 0 | **Four partial answers, no complete one.** "Stock by place" is the only per-size × per-place split and **has no search box** — you scroll the whole catalogue. The drawer shows totals only. The **"Shelf" column lies**: `variants.shelf` is written at insert and never by shelf assignment, so live it is blank. The shelf map cannot be asked where a product is, only what is on a bay. |
| 13. Stock count of one place | warehouse | 3 | 4 + a scan each | 20 | 2 | 1 | The screen says **"Walk the shelf, scan, compare"** but `scope` is hard-wired to `'all'` — the only choice is a whole warehouse. **Scanning calls `render()`**, so the page jumps on every beep. The table draws 120 rows while progress counts every size. Blank ≠ 0 is said only in a note under the Post dialog. |
| 14. Purchase order for things running low | warehouse / manager | 2–3 | 4 | 1+ | 1–2 | 1 | The tab is called **"Worth reordering"** — nobody looking for "Purchase orders" finds it. **One purchase order per product**: ten low lines means ten separate orders to the same supplier, and nothing says so until after the first toast. There is no draft — Place the order raises *and* sends it in one gesture. |

**A claim I checked and had to correct.** Reading the seed migration suggests the warehouse role
lacks `cost.read` and would therefore be refused on the last click of a purchase order
(`POST /api/purchase-orders` needs `cost.read` **and** `stock.move`). **On this shop that is not
true** — night shift 01's `users:rebuild` gives the warehouse cost, and both the live server's
`/api/auth/me` and `role_permissions` confirm `cost.read = 1`. The trap is real in the code and
would bite a shop still on the seeded matrix; it does not bite this one.

**Who sees what on this screen:** owner/manager 6 tabs · **warehouse 5** (no "Asked for" — that
needs `customer.read`) · delivery 2 · **cashier 1, and therefore no tab bar at all**, because the
bar is suppressed below two tabs. That last one reads as a half-loaded page.

---

## 4. Orders, deliveries and money

The three best-built screens in the shop. The delivery office is already a five-step wizard with
real defaults, the board is already lanes and tiles, and the Money screen already refuses the
things that must be refused. What is wrong here is **volume**: the Money screen is **nine tabs**,
and the order desk asks for things it could answer itself.

| Job | Role | S | C | T | X | Y | Where you get lost |
|---|---|---|---|---|---|---|---|
| 15. Take a phone order, save and print | manager | 1 (6 panels) | 7 | 2 req / 9 available | 0 req / 8 available | 1 | On a fresh shop **every order stalls on "Say what the shipping is"** with a greyed Next and nothing visibly wrong — the price list ships empty. Step 3 ("how it travels") **never refuses anything**, so a courier order saves with no courier on it. `+ New` sits 2 cm from the scan box. |
| 16. Hand parcels to a driver | manager | 1 + 1 modal | 5 | 0 (with a gun) | 1 | 1 | The Handover tab is visible to anyone on the board but is `delivery.desk` only — a manager with `delivery.write` gets a blank **"No access"** card that names nobody who can. **"Cancel the sheet" has no confirmation** and sits next to Print and Hand over. |
| 17. Delivered / failed / cash back | manager | 1 + modal | 2 / 3 / 2 | 0–1 | 0–1 | 1 / 1 / **0** | A row can carry **nine buttons**. **Hand in takes the whole pile** with no confirmation and no amount, though the server supports narrowing it. "Open" means two different things in Lanes and in List. |
| 18. Record an expense | owner | 1 + modal | 3 | 1 req | 3 (all defaulted) | 1 | Money opens on a 9-tab bar; Expenses is the 5th. **"Paid from" silently becomes a *method* picker** with a different id when no cash place exists. `salaries` is still an expense category, and a salary entered there *and* on the payroll is counted twice — nothing says so. |
| 19. Pay a supplier | owner | 1 + modal | 3 | 0–2 | 2 (defaulted) | 1 | Good: the amount is prefilled with what is owed. The tab is 7th of 9. |
| 20. Pay a salary / an advance | owner | 1 + modal | 3 | 0–2 | 2 | 1 | Bonus and deduction hide under a button captioned **"More"**. The tab is 8th of 9. |
| 21. Close the day | cashier, then owner | 1 | 2 + 2 | 2–3 / 0–3 | 0 | 1 + 1 | **Two different "closes" on one screen** — the legacy Shift tab's "Close the shift" and the real day close. The cashier's half shows her count and no difference (correct) but **never says the owner will check it**, so it reads as a half-loaded page. **"Throw the count away" has no confirmation.** |
| 22. How much money have we, and where | owner | 1 | 0 | 0 | 0 | 0 | Already good — it is the default tab and needs no explanation. But the four actions **vanish without `money.move`** with no word why. |
| 23. How did we do this month | owner | 1 | 1 | 0 | 0 | 0 | 9th of 9 tabs. The cash-flow half **disappears silently** for `profit.read` without `money.read` — the page just ends. |

**Roles matter here and are easy to get wrong:** on this shop the **manager has no `money.read`**
(it is not in the manager's default set), so jobs 18–23 are the **owner's** alone. The cashier
holds `money.count` and lands on **Close the day** as her only tab.

---

## The ten worst offenders

1. **The Warehouse screen opens on an audit log.** Six tabs wrapping onto two rows, and the
   first thing a warehouse hand sees at eight in the morning is `Stock movements` — a table of
   what already happened. None of the four things he actually came to do has a button.
2. **There is no "goods arrived" flow at all.** Receiving is either a per-row *Receive stock*
   button buried on the third tab, or the Add-product form. A pile of unlabelled boxes has no
   screen.
3. **Brand and "Made in" on the Add-product form are dead inputs** — typed into, never saved.
4. **The Add-product form pre-fills a cost of 1050 and a price of 2250**, keeps them between
   products, and saves a blank price as 0.
5. **"Visible" means two opposite things** in one screen — the website flag, and the archive flag.
6. **Archive has no button.** It exists only inside the bulk bar, next to Delete, with no
   confirmation, and the row then vanishes behind a filter that defaults to "active".
7. **Nine tabs on the Money screen**, with two of them ("Close the shift", "Close the day")
   looking like the same job.
8. **Three charts on a dashboard nobody can act on**, and 200 KB of Chart.js parsed on every
   till boot for a screen a cashier never opens.
9. **Four different doors into the label preview**, two of them with the identical caption
   "Print barcode labels" in one drawer.
10. **The destructive actions are the quiet ones and the harmless ones ask.** "Cancel the sheet",
    "Throw the count away", "Hand in the whole pile", "Remove the photo" and "Archive" ask
    nothing; the duplicate guard makes its *primary* button the one that abandons your work.
