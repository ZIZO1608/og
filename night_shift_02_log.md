# Night shift 02 — "fewer steps"

Branch **`night-shift-02`**, six commits, nothing pushed and nothing merged.

> **A note on where the branch came from.** The brief said to branch from main. `main` is
> **13 commits behind `night-shift-01`**, and everything `CLAUDE.md` describes as built —
> colours, categories, the safeers, the control panel — is in those 13. Branching from main
> would have meant working against a tree that does not match its own documentation, so this
> branches from `night-shift-01` (the checked-out HEAD). If that is wrong, say so and it is one
> rebase.

---

## 1. Anything to be done by hand before this runs on the shop laptop

**NOTHING.**

No migration, no `server/supabase/` file, no `mirror-lag.js` entry, no config key. Every flow
built tonight uses routes and columns that already existed — the short-delivery receive is
`POST /api/purchase-orders/:id/receive` with the `received:[{sku,qty}]` body the server has
accepted since it was written, and the unordered delivery is `POST /api/stock/receive`. Both
are still `stock.move`. `npm run supabase:drift` is untouched by this branch.

The only deploy-shaped thing is the ordinary one: `sw.js` `CACHE` is bumped to
**`og-system-v262`**, and `js/receive.js` is added to its precache list.

---

## 2. Before → after

Counts are for the happy path, walked on the sandbox as the role named. **S** screens ·
**C** clicks · **T** fields typed · **X** choices · **Y** confirmations. The "before" column is
the audit, committed before any code changed (`night_shift_02_audit.md`).

| Job | Role | Before (S·C·T·X·Y) | After (S·C·T·X·Y) | Clicks saved |
|---|---|---|---|---|
| 1. New shoe, 1 colour, 6 sizes, print labels | warehouse | 2·4–7·9·2–8·0–2 | 2·3·8·1·0–1 | **1–4** |
| 2. New shoe, 2 colours | warehouse | 2·4–5·3+sizes·2–4·0–1 | 2·4·3+sizes·2–4·0–1 | 0–1 |
| 3. Add one more size | warehouse | 3·5·2·2·0 | 3·5·2·2·0 | 0 |
| 4. Add a new colour | warehouse | 3·4·2+sizes·2·0 | 3·4·2+sizes·2·0 | 0 |
| 5. Change a selling price | manager | 3·4·1·0·0 | 3·4·1·0·0 | 0 *(but the price is the 2nd field now, not the 8th)* |
| 6. Add / change a photo | manager | 2·4·0·0·0 | 2·4·0·0·0 | 0 |
| 7. On/off the website; archive | manager | 1·1 / 1·3 | 1·1 / 1·3 | 0 *(but the two no longer share a word)* |
| 8. Reprint labels | warehouse | 2–4·3–6·0–1·≤8·0–1 | 2–4·3–6·0–1·≤8·0–1 | 0 |
| **9. Receive a purchase order** | warehouse | 3·3–4·0·1·**0** | **2·3·0·0·1** | **0–1**, and a review step exists |
| **9b. …a short delivery, 8 of 10** | warehouse | **IMPOSSIBLE** | 2·3·**1**·0·1 | — |
| **10. Goods arrived, not ordered** | warehouse | 2–3·2–6·0–7·1–5·0–1 | **1·4·2·1·1** | **0–2**, and it is findable |
| 11. Move 5 pairs back → floor | warehouse | 2·3+5 scans·0·0·1 | 2·**2**+5 scans·0·0·1 | **1** per trip, **+1 per repeat trip** |
| **12. Where is it, in what size, where** | anyone | 1·2–3·**0**·1–2·0 + scrolling | 1·2·**1 typed**·1·0, no scrolling | scrolling → one box |
| 13. Stock count of one place | warehouse | 3·4+·20·2·1 | 3·4+·20·2·1 | 0 |
| 14. Purchase order for low stock | warehouse | 2–3·4·1+·1–2·1 | 2–3·**5**·1+·1–2·1 | **−1** (it moved under More) |
| 15. Take a phone order | manager | 1·7·2·0·1 | 1·7·2·0·1 | 0 |
| 16. Hand parcels to a driver | manager | 1·5·0·1·1 | 1·5·0·1·1 | 0 |
| 17a. Mark a parcel delivered | manager | 1·2·0–1·0–1·1 | 1·2·0–1·0–1·1 | 0 |
| 17b. Mark one **failed** | manager | 1·3·0–1·1·1 | 1·**4**·0–1·1·1 | **−1, on purpose** |
| 17c. Cash back from a driver | manager | 1·2·0·0·0 | 1·2·0·0·0 | 0 |
| **18. Record an expense** | owner | 1·3·1·3·1 | 1·**2**·1·3·1 | **1** |
| 19. Pay a supplier | owner | 1·3·0–2·2·1 | 1·3·0–2·2·1 | 0 |
| 20. Pay a salary / advance | owner | 1·3·0–2·2·1 | 1·3·0–2·2·1 | 0 |
| 21. Close the day | cashier+owner | 1·2+2·2–3·0·2 | 1·2+2·2–3·0·2 | 0 |
| 22. How much money, and where | owner | 1·0·0·0·0 | 1·0·0·0·0 | 0 |
| 23. How did we do this month | owner | 1·1·0·0·0 | 1·1·0·0·0 | 0 |

**Two of those numbers went the wrong way, and both are deliberate.**

- **Marking a parcel failed is one click longer.** It used to sit the same size and the same
  colour as Delivered, side by side, on a phone card. It is behind the row's "…" now. Failure is
  not a step forward and it is the one a tired hand must not reach by accident.
- **Raising a purchase order is one click longer**, because "Worth reordering" moved under
  "More". Receiving, moving, finding and counting happen many times a day; raising an order
  happens when somebody sits down to do the buying. See question 1.

**Where the real saving is, and it is not in the click column.** The counts above barely move for
half these jobs, because most of them were already only three or four presses — what was wrong
was that nobody could find the third press. The measurable changes are:

- **Choices**, on the Add-product form: **2–8 → 1**. A one-colour product no longer asks for a
  colour name in two languages, a photo and a swatch off a twelve-square palette.
- **Screens to hunt through**: the warehouse's landing tab is a job instead of an audit log, and
  its six tabs are four buttons plus a fold. The Money screen is six tabs instead of nine.
- **Things that were impossible**: a short delivery could not be recorded at all.
- **Things that were silently wrong**: two fields on the Add-product form were never saved.

---

## 3. What changed, per phase

Screenshots are in the untracked `docs/img/night-02/`, `before-*` and `after-*`.

### Phase 1 — the drawings are gone (commit `04f269f`)

| Was | Is |
|---|---|
| Dashboard: a 6-month line, a category doughnut, a best-sellers bar | **"What is selling"** — best sellers, category with the share as a number, and one sentence comparing this month with last |
| Reports: one canvas reused by six tabs | **One chart**: Sales over time, base currency, **owner and developer only**, with a note saying the line is one currency |
| Product drawer: a 12-bar sparkline | "17 pairs sold in six months", and how the last two months compare |
| Driver's home: an SVG progress ring | the figure that was inside it, twice the size |
| Driver's home: a per-sheet % bar | nothing — "4 of 11" was already written beside it |
| Reports ×5 and Money ×1: share bars | the percentage, printed |
| Reviews: a 5-bar histogram | five rows, still tapping to filter |
| Stock count: a progress bar | **kept** — a progress indicator, not a picture of data |
| Yalla Wear portal: two charts | **untouched** — out of scope, and they still draw |

`Chart.js` (200 KB) no longer loads at boot. `js/charts.js` injects it on the first draw, the way
`js/shelfroom.js` injects three.js. Callers did not change. It stays in the precache.

Two fixed on the way: the dashboard drew a card saying "no staff" to every account without
`staff.read` (the zero-instead-of-absent mistake), and home screens no longer count their numbers
up from zero.

`after-abode-en-1100-dashboard.png` · `after-abode-en-1100-selling.png` ·
`after-abode-ar-390-selling.png` · `after-abode-en-1100-reports.png` ·
`after-wael-en-1100-reports.png` · `after-cashier-ar-390-home.png` ·
`after-safeer1-ar-390-home.png` · `after-wael-en-1100-product-drawer.png`

### Phase 3 — goods arrive, and the warehouse has verbs (commit `072c5fb`)

The warehouse opened on **Stock movements**. It opens on the four things somebody walks into that
room to do, as buttons: **Goods arrived · Move stock · Where is it? · Count**, with **Add product**
beside them and the movement log, the purchase orders and the wants list under a **More** fold
that remembers itself per machine. No tab id changed, so every deep link still lands.

**`js/receive.js` is new.** There was no receiving screen at all — a purchase order had a button
that fired on the press, booked the whole order, moved the supplier balance and opened a label
preview nobody asked for. It is pick-and-count, deliberately not scan-first, because arriving
boxes carry no barcode: this is the one moment in the building when nothing can be scanned, and
printing the OG labels is therefore its last step and its main button.

Three more from the audit: move-by-scan remembers its direction per machine; the movement log
names both ends of a move instead of saying "Carried to the floor" whichever way it went; and
"Where is it?" has a search box, which it never had.

`after-wh-jobs-en-1100.png` · `after-wh-jobs-ar-390.png` · `after-rc-count-en-1100.png` ·
`after-rc-count-ar-390.png` · `after-rc-done-en-1100.png` · `after-rc-labels-en-1100.png` ·
`after-rc-free-en-1100.png` · `after-wh-cashier-en-1100.png`

### Phase 2 — adding a product (commit `c1d197b`)

Four fields on the first screen — name, category, selling price, quantity per size — and
everything else behind **More details**.

**Three defects, not friction:** brand and "made in" were inputs nothing ever read; the prices
were pre-filled with 1050 and 2250 and kept between products; a blank selling price saved as 0
while the edit modal refused the same blank.

**Two more found while walking it:** a one-colour product was asking for colour names, a photo
and a palette swatch for something drawn nowhere; and a single unnamed colour was refused by the
*server* pointing at a box the form had called optional.

Also: the label button is the primary one, the duplicate guard's buttons are the right way round
and its row button no longer claims to add stock, and **"Visible" stopped meaning two opposite
things**.

`after-add-form-en-1100.png` · `after-add-form-ar-390.png` · `after-add-solo-en-1100.png` ·
`after-add-two-colours-en-1100.png` · `after-product-drawer-en-1100.png` ·
`after-edit-modal-en-1100.png` · `after-edit-modal-ar-390.png`

### Phase 4 — money, and one next step per parcel (commit `f343458`)

Money: **nine tabs → six and a "Records" fold**, and the four jobs (add an expense, pay a
supplier, pay wages, close the day) are buttons on "Where the money is".

The board: a row could carry **nine buttons**. One lime button for the parcel's next step, and a
"…" for everything else — Failed above all, which was the same size and colour as Delivered.

`after-money-en-1100.png` · `after-board-en-1100.png` · `after-board-menu-en-1100.png`

---

## 4. The rename table

| Where | Old (EN) | New (EN) | New (AR) | Why |
|---|---|---|---|---|
| Warehouse tab | Stock by place | **Where is it?** | وين الغرض؟ | the question, not the filing |
| Warehouse | *(nothing)* | **Goods arrived** | وصلت بضاعة | the job had no name and no screen |
| Warehouse | *(header button)* | **Move stock** | نقل بضاعة | promoted from a header button to a job |
| Warehouse | *(nothing)* | More | غير شي | the fold over the rarer panels |
| Add form | *(nothing)* | More details | تفاصيل أكتر | the fold over brand / made in / shelf |
| Add form | Save product to warehouse *(primary)* | **Save & print labels** *(primary)* | احفظ واطبع الملصقات | the boxes cannot be scanned unlabelled |
| Add form | Save & print labels *(plain)* | **Save without labels** | احفظ بدون ملصقات | says what it does not do |
| Add form | *(cost placeholder)* | leave blank if unknown | اتركه فاضي إذا ما بتعرف | a blank cost is not zero |
| Product drawer | Visible *(printed the archive flag)* | **On the website** + **Still selling it** *(two rows)* | على الموقع · لسا عم ينباع | one word, two opposite claims |
| Edit modal | Visible | On the website | على الموقع | the same collision |
| Duplicate guard | Add stock to this one | **Open this one instead** | افتح هذا بدالو | it adds no stock |
| Save toast | View all | **Open it** | افتحه | it opens the one product just made |
| Money | *(nothing)* | Records | السجلات | the fold over the cash book, debt book and shift |
| Money → Now | *(nothing)* | Add an expense · Pay a supplier · Pay wages | سجّل مصروف · ادفع لمورّد · ادفع رواتب | the jobs, from the balances screen |
| Board row | *(nine buttons)* | **More for this parcel** | خيارات تانية للطرد | the "…" |
| Movement log | Carried to the floor *(always)* | Carried from {from} to {to} | نُقل من {from} إلى {to} | it said one direction for both |
| Add-form refusals | *(hard-coded, no key)* | `err_name_needed` · `err_qty_needed` · `err_price_needed` | — | they could not be translated or renamed |

Every new string is in both `NS02_EN` and `NS02_AR` at the end of `js/app-i18n-extra.js`, and the
two blocks are checked key-for-key (**76 each**).

---

## 5. What was removed from view, and where it lives now

Nothing was deleted. Nothing lost a permission.

| Taken off the screen | Where it is now |
|---|---|
| The dashboard's 6-month line | Reports → Sales (the one surviving chart, and the per-bucket table) |
| The dashboard's category doughnut | "What is selling", as rows with the share as a number; the full split is Reports → Inventory / Profit |
| The dashboard's best-sellers bars | "What is selling", top five |
| The dashboard's "who sold" card | Reports → Employees, with the payroll beside it |
| Reports' five other charts | the tables that were always under them |
| The product sparkline | two sentences in the same card |
| The driver's ring and sheet bar | the figures that were already beside them |
| Warehouse: Stock movements, Worth reordering, Asked for | the warehouse's **More** fold |
| Add form: brand, made in, colourway, place, shelf | the form's **More details** fold *(and brand and made in are now actually saved)* |
| Edit modal: brand, made in, colourway, currency, shelf | the modal's **More details** fold |
| Money: cash book, debt book, shift | the Money screen's **Records** fold |
| Board rows: Failed, Take a payment, It came back, WhatsApp, Open | the row's **"…"** |

---

## 6. What I did NOT do, and why

- **Phase 5 (navigation and words) is only half done.** The rename table above landed; the
  per-role navigation trim did not. `NAV_PERM` already hides what a role may not open, so the
  remaining question is whether a manager wants eleven entries or six — which is a decision about
  the shop, not a defect. Nothing was started and abandoned; the branch has no half-built nav.
- **The order desk was left alone.** The audit found it is the best-built screen in the shop — a
  five-step wizard with real defaults and refusals that cannot disagree with its own Next button.
  The brief's suggestions for it (phone number first, the fee answered earlier) are changes to a
  thing that works, and the fee stall has a cause that is not the screen's fault: **the shipping
  price list ships empty**, so on a fresh shop every order stalls on "Say what the shipping is".
  That is a data problem with a one-time fix. See question 2.
- **Close the day was not made a 3-step flow.** It is currently one screen per hand — the cashier
  counts, the owner confirms — and each already fits without scrolling. Turning one short form
  into three steps would add presses to a flow that has four. I would rather be told I am wrong
  than add ceremony to the thing that ends everyone's day.
- **The expense dialog's category chips** were not built (it is still a select, defaulted). Low
  value beside the click it just lost.
- **The archive toggle** still lives only in the bulk bar, with no confirmation. Fixing it means
  deciding whether archive belongs in the product drawer, which is the owner's call — the audit
  entry stands.
- **`variants.shelf` still lies.** The drawer, the count sheet and the scan sheet print a column
  that shelf assignment never writes (the real one is `stock.shelf_id`). Fixing it is a server
  change to a column three screens read, and this was a UX night. It is in the audit.
- **The 3D shelf map was left alone**, as instructed. See question 5.

---

## 7. Questions for the morning

1. **Purchase orders moved under "More" in the warehouse, so raising one is one click longer.**
   Right, or should "Worth reordering" be a fifth job button?
2. **The shipping price list is empty on the live shop**, so every order stalls on "Say what the
   shipping is" until somebody presses Free or types a number. Shall I seed it from the owner's
   real prices, or leave the stall as the prompt?
3. **The owner's one chart is drawn for the `developer` role too.** Deliberate — a developer
   checking what the owner sees in a meeting needs to see it — but say if it should be the owner
   alone.
4. **On a phone, the fixed tab bar paints over whatever is scrolled to the bottom edge**, so a tap
   at that element's centre reaches the bar. Nothing is permanently unreachable (measured: the
   view's 86px bottom padding clears the 58px bar at the end of the content) and this is app-wide
   and older than tonight. Worth a proper fix, or leave it?
5. **Should the 3D shelf map be simplified?** Left untouched as instructed; asking because it is
   the one screen a new employee has no idea what to do with.
6. **Is "Standard / أساسي" the right invisible name** for a one-colour product's colour? It is
   what migration 058 used, and it is drawn nowhere, but it will appear if that product ever gets
   a second colour.
7. **The warehouse account holds `cost.read` on this shop** (night shift 01 gave it), so it sees
   cost prices on the Add form and can raise purchase orders. Intended?

---

## 8. Commits on `night-shift-02`

| | |
|---|---|
| `e894fee` | ns02: phase 0 — the audit, walked as every role |
| `04f269f` | ns02: phase 1 — the drawings are gone, and Chart.js with them |
| `072c5fb` | ns02: phase 3 — goods arrive, and the warehouse has verbs on it |
| `c1d197b` | ns02: phase 2 — adding a product, with the fields that were never saved |
| `f343458` | ns02: phase 4 — the money screen, and one next step per parcel |
| *(this one)* | ns02: the morning report, and CLAUDE.md |

---

## 9. How it was verified

Nine suites over CDP against the sandbox (`server/data-sandbox`, port 8190), **171 checks, all
green**, plus `cd server && npm test` (6). Every money and stock figure is read back out of the
database through the API rather than off the screen that wrote it.

| Suite | Checks | What it proves |
|---|---|---|
| `p1-charts` | 29 | no canvas on any home screen or on five of six Reports tabs; the one chart present for the owner, absent for the manager; Chart.js never fetched by a cashier, manager, driver or dashboard |
| `p1-exports` | 16 | both exports still build bytes; the owner's chart still rasterises into the PDF; the dashboard's PDF carries no empty box; the Yalla Wear portal still draws both its charts through the lazy loader |
| `p2-products` | 27 | brand, made in, colourway and both prices saved as typed; a blank price refused and nothing created; the guard's polarity; the drawer's two rows |
| `p2-solo` | 10 | one colour shows no colour UI; a second brings all of it back |
| `p2-edit` | 11 | the price is on the first screen; the fold does not eat a typed value; the edit reaches the database |
| `p3-receive` | 19 | a 10-and-4 order received as **8 and 4** leaves it open with exactly 2 owed, the right `received_qty` per line, two `received` movements, stock up by 8 and 4 |
| `p3-more` | 20 | the unordered delivery; the remembered place; the cashier offered no button **and refused 403 by hand on both routes** |
| `p3-find` | 9 | the find box narrows by name and by barcode and keeps the caret; the move direction survives a reopen |
| `p4-money` | 18 | six tabs and three folded; the expense dialog in one press; one lime button per row; the menu **hit-tested** as really on top, and closing on an outside press |

Each phase was walked in **English and Arabic**, at **1100 × 760** and **390 × 760**, as every role
that can do the job and as one that must not. Every run asserts no sideways scroll at 390, no raw
i18n key on screen, and no console errors.

**Two harness facts worth keeping.** The Chrome profile is shared between runs, so anything
remembered per machine (`og.wh.moveway`, `og.wh.addmore`) has to be cleared at the top of a suite
or the run asserts what the last run chose. And `cdp.click` scrolls `block:'nearest'`, which on a
phone can leave a target under the floating tab bar — centre it first, the way a person scrolls
until they can see the thing.
