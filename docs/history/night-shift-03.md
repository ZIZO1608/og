<!-- Two files, merged 20 Sep 2026 while tidying the repository for deployment.
     Part one was night_shift_03_audit.md, part two was night_shift_03_log.md.
     Neither half was edited; only this header and the rule between them are new. -->

# Night shift 03 — "big buttons", 18 Sep 2026

Two parts, in the order they were written: **part one** is the "before" audit the night started from,
**part two** is the morning report.

---

## Part one — the "before" audit the night started from

# Night shift 03 — the "before" audit

Walked on the sandbox (`server/data-sandbox`, port 8190) on 18 Sep 2026, as every role, at
1100 × 760 and 390 × 760. The screens night shift 02 did **not** audit: Money, Settings, Staff,
the Products list, the four dashboards, and Safeers as `quick-fix` left it.

Key: **S** screens/surfaces · **C** clicks · **T** fields typed · **X** choices · **Y** confirms.

> **The single most important fact in this audit, because half the rest follows from it:**
> on this shop the **manager has no `config.write`** — `PINNED` was narrowed to owner and
> developer (`server/lib/auth.js:134-136`), so the manager **cannot open Settings at all**.
> Every "change it in Settings" sentence in the app points at a door most people cannot open.

---

## 1. Money

| Job | Role | S | C | T | X | Y | Where you get lost |
|---|---|---|---|---|---|---|---|
| Add an expense | owner | 1+modal | 2 | 1 | 3 selects | 1 | Category, currency and "paid from" are three dropdowns for two or three choices each. "Paid from" **silently becomes a method picker with a different id** when no cash place exists. |
| Pay a supplier | owner | 1+modal | 3 | 0–2 | 2 | 1 | You start from a form, not from the person. The tab is 4th. |
| Pay wages | owner | 1+modal | 3 | 0–2 | 2 | 1 | Bonus and deduction hide under a button captioned "More". |
| Move money | owner | 1+modal | 2 | 1 | 3 | 1 | From/To are dropdowns; the fee box has no explanation until you read the hint. |
| Exchange | owner | 1+modal | 2 | 2 | 3 | 1 | Good: it shows the implied rate live and flags a rate that is half or double. |
| Close the day | cashier→owner | 1 | 2+2 | 2–3 | 0 | 2 | **The cashier lands here as her only tab and the tab bar is not drawn at all** — she sees one card and no sign there is a screen around it. She is shown a count with no difference (correct, by design), but nothing says the owner will check it. |
| Where is the money | owner | 1 | 0 | 0 | 0 | 0 | Already the default and already good. |
| Who owes whom | owner | 1 | 2 | 0 | 0 | 0 | Two different questions ("they owe us" / "we owe them") live on two tabs with unrelated names — **Debt book** and **Suppliers**. |

**What is wrong, in one line each.**

1. **Every dialog is a different shape.** Some lead with a category, some with a currency, some
   with the amount. The amount — the only thing a person came to type — is 2nd, 3rd or 4th.
2. **Dropdowns for two choices.** Currency is a `<select>` with SYP and USD in it, everywhere.
3. **No result sentence.** Nothing says what the balance will be after the money moves.
4. **Refusals arrive after the press**, as a toast, not under the field that caused them.
5. **"Cash book" and "Debt book"** are not words anybody in this shop uses.
6. **The cashier sees a screen called Money with one tab on it.**

---

## 2. Settings

| Job | Role | S | C | T | X | Y | Where you get lost |
|---|---|---|---|---|---|---|---|
| Change the shop's name | owner | 1 | 3 | 1 | 0 | 0 | Typing is not enough — you must find **Save changes** in the page head. |
| Set the exchange rate | owner | 1 | 3 | 1 | 0 | 0 | Same page-level Save. Everything around it saves itself. |
| Fill the shipping prices | owner | 1 | 2+n | 4n | 3n | 0 | **The whole Deliveries section is absent on the first paint** and appears a beat later. |
| Add a category | owner | 1 | 3 | 3 | 1 | 0 | Per-row Save, unlike its neighbours. |
| Anything at all | manager | — | — | — | — | — | **No Settings entry exists for them.** |

**And the manager cannot open the MONEY screen either.** `NAV_PERM.money` is any-of
`money.read · money.count · staff.read · profit.read`, and on this shop the manager holds **none
of the four** (verified in the sandbox: all 0, and `user_permissions` is empty). No sidebar entry,
no More-sheet row, and a deep link or the payroll bell bounces them with no message. Their only
money-adjacent power left is `debt.collect`. That is stored state, not a code default — the same
class of drift as `warehouse / cost.read`.

**Six sections** — The shop · Printing · Warehouse · Deliveries · People · System — and
**nine different save behaviours**: a page-level "Save changes" for three cards, six cards with
their own Save button, a per-row Save in Categories, and everything else saving on change. A
person cannot tell which kind they are looking at without pressing something.

**Advanced and dangerous, all in "System" and visible to anyone who can open Settings:** the
Supabase mirror (prints raw SQL, has a boot pull that can restore over local data), the reminders
(`rem-run` really sends to phones), and the Telegram links.

---

## 3. Staff

| Job | Role | S | C | T | X | Y | Where you get lost |
|---|---|---|---|---|---|---|---|
| Add a person | owner | 1 fold | 2 | 2 | 1 | 0 | **Two different hiring screens with different fields**: Settings → Access asks name/username/**role**; the Safeers screen asks name/**phone**/username with the role implied. |
| Change somebody's job | owner | — | — | — | — | — | **IMPOSSIBLE ANYWHERE IN THE UI.** The role is set once, at Add. A cashier promoted to manager needs a new account. |
| Reset a password | owner | 1 | 3 | 0 | 0 | 0 | Shown once. Access has **Copy**; the Safeers screen has only **Done** — a password to be retyped off a phone screen. |
| Switch somebody off | owner | 1 | 2–3 | 0 | 0 | 0–1 | Access asks **nothing**. Safeers (since quick-fix) asks and names the open work. Two screens, two behaviours. |

---

## 4. Products list

| Job | Role | S | C | T | X | Y | Where you get lost |
|---|---|---|---|---|---|---|---|
| Find one product | anyone | 1 | 0 | 1 | 0 | 0 | The search box is one of **five controls in a row**; it matches name and brand only — not a barcode, not a size. |
| Filter to low stock | manager | 1 | 0 | 0 | 1 | 0 | Four dropdowns always on screen. Nothing shows a filter is on except the dropdown itself. |
| Change a price | manager | 3 | 4 | 1 | 0 | 0 | Through the full edit modal; there is no "change the price". |
| Add a size / a colour | warehouse | 3 | 5 | 2 | 2 | 0 | Behind "Add more" in the drawer footer, then a segmented control. |
| Archive one product | manager | 1 | 3 | 0 | 0 | **0** | **Only in the bulk bar, beside Delete, with no confirmation** — and the row then vanishes, because the filter defaults to "active". |

The bulk bar's six buttons are always there once anything is ticked; the tick column is always
drawn for `product.write`.

---

## 5. The dashboards

| Role | What lands | Cards | Verbs on the screen |
|---|---|---|---|
| Cashier | `viewShiftHome` | 5 stats, a CTA row, her last sales, low-on-shelf | **2** (Open the till, Count the drawer) |
| Warehouse | `viewBackHome` | 4 stats, 2 CTAs, wants, a 10-row "to move out" table | **2**, and the main one is **mislabelled**: "Book something in" opens the **Add-product** form, not the Goods-arrived flow |
| Manager | `viewDashboard` | 14 blocks | 0 verbs; no orders or deliveries block at all |
| Safeer | `viewRunsHome` | hero + parcels grouped by sheet + errands | 3 per parcel |

None of the four opens on a job. A cashier's home never mentions a parcel; the manager's
dashboard has no orders block, so "where is my order?" has no door from either.

---

## 6. Safeers (after `quick-fix`)

| Job | Role | S | C | T | X | Y | Where you get lost |
|---|---|---|---|---|---|---|---|
| Give somebody a parcel | manager | 1+modal | 3 | 0 | 2 | 1 | Two head buttons that are the same idea ("Give a parcel", "New errand"). |
| See one safeer's tasks | manager | 1 | 1 | 0 | 0 | 0 | **Looks like it does nothing**: it filters a table far below the card that was pressed, and the scroll is restored. |
| Add a safeer | owner | 1 | 2 | 3 | 0 | 0 | An **always-open form** sitting between the people and the tasks. |

**The card and the table disagree and neither says why.** "Open tasks" on the card counts every
open parcel and errand with no date or method scope; the table below is **today-only** for parcels
and **driver-method only**. A three-day-old waiting parcel is counted on the card and missing from
the list.

**Three different "nothings" on one card**: the money block is *absent* without `money.read`, the
earned line is a *sentence* with no rate, and cash-on-him is a bare *em dash*.

---

## 7. Navigation today, per role, in order

With a guess at how often the job needs it — **(m)** many times a day, **(d)** daily,
**(w)** weekly, **(r)** rarely. This is what the job home is built from.

| Role | Entries, in the order they are drawn |
|---|---|
| **owner / developer** (15) | Home (d) · Cashier (r) · Products (d) · Warehouse (w) · Shelf map (r) · Money **(m)** · Delivery office (d) · Deliveries **(m)** · Safeers (d) · Reviews (w) · Customers (w) · Print labels (r) · Print Jobs (w) · Reports (d) · Settings (r) |
| **manager** (14, no Settings) | Home (d) · Cashier (d) · Products (d) · Warehouse (d) · Shelf map (r) · Money (r — one tab) · Delivery office **(m)** · Deliveries **(m)** · Safeers (d) · Reviews (w) · Customers (w) · Print labels (r) · Print Jobs (w) · Reports (w) |
| **cashier** (8) | Home (d) · Cashier **(m)** · Products (d) · Warehouse (d — to answer "have you got a 42") · Shelf map (r) · Money (d — the night count) · Customers (d) · Print Jobs (r) |
| **warehouse** (6) | Home (d) · Products (d) · Warehouse **(m)** · Shelf map (w) · Print labels (d) · Print Jobs (r) |
| **delivery / safeer** (2) | Home **(m)** · Products (r) — and **his More sheet is an empty grid**: every item is filtered out, leaving language, currency and sign out |

---

## The ten worst offenders

1. **No screen in the system opens on a verb.** Every role lands on figures.
2. **A manager cannot open Settings**, and a dozen sentences in the app tell them to.
3. **Nobody's job can be changed** after their account is made — anywhere.
4. **Two hiring screens**, different fields, different gates, one with Copy and one without.
5. **Every money dialog is a different shape**, and the amount is never first.
6. **"Cash book" and "Debt book"** — internal words on a screen a shopkeeper reads.
7. **The warehouse's main home button goes to the wrong screen** ("Book something in" → Add
   product, not Goods arrived) and is gated on `product.write`, so a pure stock keeper has **no
   receive button on his home at all**.
8. **Archive: no confirmation, no button of its own, and the row disappears.**
9. **The Safeers card and its task table disagree** about what a safeer is carrying.
10. **The four rail dots on a board card are unlabelled**, dot 2 means "some money arrived" and can
    contradict the green **Paid** pill on the same card.

### Two things found that are bugs, not friction

- **The lime pointer glow paints OVER the cards, not behind them.** `.mo-glow`
  (`css/tokens.css:236`) is `position:fixed; z-index:1` on the body while `.dlb-card` is
  `position:relative; z-index:auto` — so a 260px lime haze follows the mouse across the lanes on
  top of the content. One rule, every screen.
- **The country can disagree with the city five different ways** on the order desk, none of them
  guarded: changing the country never touches the city; nothing validates the pair in the browser
  or on the server; "use the last address" copies the two with independent fallbacks; picking a
  customer fills the city and never the country; and **a one-country shop has no control at all**,
  so a draft carrying `TR` can never be corrected from that screen.

---

## Part two — the morning report

# Night shift 03 — "big buttons"

Branch **`night-shift-03`**, off `quick-fix`. Seven commits, nothing pushed and nothing merged.
The audit that starts it is `night_shift_03_audit.md`; where the run got to, hour by hour, is
`PROGRESS.md`.

---

## 1. What must be done by hand before this runs on the shop laptop

**Two things. Nothing else.**

1. **Untick Settings → People and access → Roles → Warehouse → "See what things cost".**
   `role_permissions` on the live database says `warehouse / cost.read = 1` while
   `003_role_permissions.sql` seeds it `0`. It is stored state, not a code default, so it is not
   migrated. Until it is unticked the warehouse account can see unit costs — and, as of tonight,
   also sees "Worth reordering", which is a screen full of them.

2. **Fill the shipping price list** (Settings → Deliveries → Shipping prices). It ships EMPTY, so
   every order stalls on "Say what the shipping is". The screen is laid out to be filled in one
   sitting now — a row per city, a price, a currency toggle, a ✕ — and the order desk links
   straight to it. **Nothing here invents a price**, so the list stays empty until the shop types
   its own numbers.

**No migration. No `server/supabase/` file. No `mirror-lag.js` entry. No data change.** The one
deploy-shaped thing is the usual one: `sw.js` `CACHE` is at **`og-system-v269`** and `js/staff.js`
is in its precache list.

---

## 2. The job home, per role — and why each button is there

Every role opens on 4–6 big job buttons. The list is `JOBS` + `ORDER` in `js/home.js`; every
entry is filtered by `navAllowed(view)` **and** the permission the job actually needs, so a button
is only ever drawn to somebody who can do it. The order is per role; what is drawn is per account.

| Role | Buttons, in order | Why |
|---|---|---|
| **owner** · **developer** | Money · Deliveries · Products · Reports · The people · Take an order | He reads the money first and the road second. The full dashboard is still under them, untouched, under a hairline. |
| **manager** | Take an order · Deliveries · Goods arrived · Products · Sell · Move stock | The order desk and the board are what he does all day. Money is not here because on this shop **he holds none of the four permissions that open it** (see §9, question 1). |
| **cashier** | Sell · Where is it? · Customers · **Count the drawer** · Products | Selling, then "have you got it in a 42", then the night count. |
| **warehouse** | Goods arrived · Move stock · Where is it? · Add product · Count · Print labels | The four verbs from night shift 02, plus the two that start and finish a product. |
| **safeer** | *(his runs — no grid)* | His whole job is the parcels in his hand. A grid of buttons over them would be one more press between him and the road. His home opens on **Cash on me** and one big card per parcel. |

**"Count the drawer", not "Close the day".** A `JOBS` key may be a function of the account now:
somebody holding `money.count` and not `money.move` counts, and the owner confirms. The button
used to promise a job she cannot do.

The phone menu is **Home + two or three + More**; More is built from `NAV` itself minus whatever
is already a tab, grouped under four plain headings. The driver's More holds no grid at all now —
a group with nothing in it draws no heading — but it is still where he signs out.

---

## 3. Before → after, against the audit

Counts are for the happy path. **S** screens · **C** clicks · **T** typed · **X** choices ·
**Y** confirmations.

| Job | Role | Before | After | Change |
|---|---|---|---|---|
| Open the app and start a job | anyone | lands on figures | **4–6 buttons** | every role opens on a verb |
| Add an expense | owner | 1+modal·2·1·**3 selects**·1 | 1+modal·2·1·**chips**·1 | amount first, category as chips |
| Pay a supplier | owner | 1+modal·3·0–2·2·1 | 1+modal·3·**0**·2·1 | pre-filled with what is owed, and it says what it leaves |
| Pay wages | owner | 1+modal·3·0–2·2·1 | 1+modal·3·0–1·**chips**·1 | four entries as chips; a bonus hides "paid from" |
| Move money | owner | 1+modal·2·1·3·1 | 1+modal·2·1·**2**·1 | currency is two toggles; the fee is behind More |
| Who owes whom | owner | 2 tabs, unrelated names | **1 tab, two halves** | "They owe us" over "We owe them" |
| Find one product | anyone | name + brand only | **size · SKU · barcode · label code · a scan** | and a scan mangled by an Arabic layout finds it |
| Filter the products | manager | 4 dropdowns always on | **1 Filter button + chips** | a filter that is on says so, and one press takes it off |
| Change a price | manager | 3·4·1·0·0 through the full editor | **2·3·1·0·0**, one field | in the product's own currency, saying which |
| Add a size / a colour | warehouse | 3·5·2·2·0 behind "Add more" | **2·3·2·1·0** | two buttons on the drawer, ending in "Print N labels" |
| Archive one product | manager | bulk bar, **no confirmation** | **1 button, 1 question** | and "Sell it again" in the toast |
| Change the shop's name | owner | 1·3·1 + find **Save changes** | **1·2·1**, saves itself | "Saved" beside the box |
| Set the exchange rate | owner | same page-level Save | saves itself | and `parseInt("13,000")` no longer reads 13 |
| Fill the shipping prices | owner | 1·2+n·4n·3n·0 | 1·2+n·**2n**·n·0 | a row a city, a ✕ per row, a link from the desk |
| Add a person | owner | **two different screens** | **one dialog** | five job choices with a line each, password once with Copy |
| Change what somebody can do | owner | Settings → Access, a fold | **on their card** | the same switches, opened on that person |
| Switch somebody off | owner | Access asked **nothing** | names the open work | parcels, errands, an open drawer, cash on them |
| Give a safeer a task | manager | **two head buttons** | **1 lime button** | a sheet with two big choices |
| See one safeer's tasks | manager | looked like it did nothing | a chip appears | the filter is said out loud |
| Add a safeer | owner | an **always-open form** | a quiet button | a dialog, with Copy on the password |
| A driver marking a parcel | safeer | Delivered **beside** Failed | Delivered alone | "Couldn't deliver" under the "…" |
| Know what a driver is carrying | safeer | not on his home | **Cash on me**, first | a pair, never added |

**Two numbers went the wrong way, both on purpose** — carried over from night shift 02 and still
true: marking a parcel failed is one press longer (it is behind a "…"), and raising a purchase
order is one press longer (it is under the warehouse's More, and now also needs `cost.read`).

---

## 4. What changed, per phase

Screenshots are in the untracked `docs/img/night-03/`.

### Phase 1 — a job home for everyone (`64ccb94`), proved in Phase 1b (`712fdbb`)

`js/home.js` (new, global `Home`, `data-hm`), `ROLE_TABS` + `MORE_GROUPS` in `js/app-shell.js`.
The code landed in phase 1; the two suites that prove it were written in this run —
`ns03/p1-home` (53 checks) reads `role_permissions` out of SQLite and asserts every button drawn
is a job that account really holds, and `ns03/p1-tabbar` (65) does the same for the menu.

`after-abode-en-1100-home.png` · `after-cashier-ar-390-home.png` ·
`after-member1-ar-390-home.png` · `after-wael-en-390-more.png`

### Phase 2 — money (`572bbbe`)

One shape for every money dialog, in `js/cashbook.js` and reused by `js/money.js` and
`js/payables.js`: the amount first and big, the currency as two toggles, from/to/category as
chips, the date and the note behind one "More", a sentence saying what will be true afterwards,
and refusals under the field that causes them. **Every control keeps its id** — a chip row is
buttons over a hidden input carrying the id the handler already reads — so `move-go`,
`add-expense-go`, `sup-pay-go` and `pr-pay-go` are untouched.

"Cash book" is **Money history**; "Debt book" is **Who owes whom**, now in two halves.

`after-abode-en-1100-move.png` · `after-abode-en-1100-expense.png` ·
`after-abode-en-1100-supplier-pay.png` · `after-abode-en-1100-wages.png` ·
`after-abode-en-1100-whoowes.png` · `after-abode-ar-390-*.png`

### The parser (`51c6f70`)

`Desk.toMinor` (money) and the new `Desk.toCount` (a counted thing) are the only two parsers for
anything a person types, and both read the same digits through one `foldDigits`. See §7.

### Phase 3 — the products list (`77b42a9`)

One full-width search box that takes a scan, `DB.productMatch` as the one "which product does this
text mean" rule (shared with the warehouse's "Where is it?"), filters behind a button as removable
chips in `OG.prod`, selection as a mode, three quick edits on the drawer, and "Stop selling it"
with a question.

`after-wael-en-1100-products.png` · `after-wael-en-1100-products-filtered.png` ·
`after-wael-en-1100-product-menu.png` · `after-wael-en-1100-price.png` ·
`after-wael-en-1100-stop.png` · `after-wael-ar-390-products.png`

### Phase 4 — settings & staff (`712fdbb`)

Five plain sections, every fold carrying a line saying what it changes, every box saving itself,
Advanced behind the developer's door, the shipping price list made fillable, and the people as
cards with job lines generated from the stored permissions. `js/staff.js` is new.

`after-abode-en-1100-settings.png` · `after-abode-en-1100-shipping.png` ·
`after-abode-en-1100-people.png` · `after-abode-en-1100-add-person.png` ·
`after-abode-en-1100-password-once.png` · `after-abode-ar-390-settings.png`

### Phase 5 — deliveries, safeers, the driver (`66d1add`)

The country follows the city; the destination is said once and the four unlabelled dots are gone
from lane cards; a parcel whose driver was switched off says so in amber; the pointer glow is off
on work screens; the Safeers page has one lime button, no Refresh, three numbers a card and
filters as chips; the driver's phone opens on "Cash on me"; and `variants.shelf` is answered from
`stock.shelf_id`.

`after-abode-en-1100-board-orphan.png` · `after-abode-en-1100-give-task.png` ·
`after-abode-en-1100-safeers.png` · `after-abode-en-1100-add-safeer.png` ·
`after-safeer1-ar-390-runs.png` · `after-abode-en-1100-desk-country.png`

### Phase 6 — the sweep

`_nightshift/ns03/sweep.mjs`, rerunnable: `node _nightshift/ns03/sweep.mjs`, or one role,
`node _nightshift/ns03/sweep.mjs wael`. It reads the navigation from the app itself, so a screen
added next year is swept without anybody remembering to add it here.

---

## 5. The renames

| Was | Is (EN) | Is (AR) |
|---|---|---|
| Cash book | Money history | حركة المصاري |
| Debt book | Who owes whom | مين عليه لمين |
| *(new half)* | They owe us | عليهن إلنا |
| *(new half)* | We owe them | علينا إلهن |
| Close the day *(shown to a cashier)* | Count the drawer | عُدّ الصندوق |
| Give a parcel · New errand | Give a task | عطي مهمة |
| Add more *(a size or a colour)* | Add a size · Add a colour | ضيف قياس · ضيف لون |
| Archive *(in the bulk bar)* | Stop selling it | وقّف بيعه |
| *(no undo)* | Sell it again | رجّعه للبيع |
| Search products | Find a product — name, barcode, or scan it | دوّر على منتج |
| Settings → System | Advanced *(developer only)* | متقدّم |
| The shop · Printing · Warehouse · Deliveries · People · System | The shop · Money and prices · Deliveries · People and access · Advanced | المحل · المصاري والأسعار · التوصيل · الموظفون والصلاحيات · متقدّم |

Every "More" is **المزيد**.

---

## 6. What moved, and where it moved to

| What | From | To |
|---|---|---|
| Money history · Who owes whom · Shift | six Money tabs | the **Records** fold (ns02, unchanged) |
| Edit product *(all nine fields)* | the drawer's first button | the drawer's **"…"** |
| Stop selling it | the bulk bar, beside Delete | the drawer's **"…"**, with a question |
| Stock sheet · Export Excel | the drawer's footer | the drawer's **"…"** |
| The fee · the note · the date | beside the amount | one **More** per money dialog |
| Reset password · Switch off | Settings → Access, a fold | the person card's **"…"** |
| The Safeers filters | always on screen | behind **Filter**, as chips |
| "This month" · "Earned" | a second row on a safeer card | the card's detail line |
| "Couldn't deliver" | beside Delivered, same size | the run card's **"…"** |
| The mirror · reminders · Telegram | Settings → System, anyone | **Advanced**, developer only |
| Worth reordering | the warehouse's More, `stock.move` | the same place, `stock.move` **and** `cost.read` |

---

## 7. Bugs found and fixed

**The parser family — SEVEN of them, and every one read zero or a fraction of the truth.**
Measured in the browser before the change, each one shown red against the expression it replaced:

| Where | Was | Read as |
|---|---|---|
| The shift boxes (`js/money.js`) | `parseInt("120,000", 10)` | **120** |
| **The shipping price list** (`js/desk.js`) | `Number("120,000") \|\| 0` | **0 — the carriage saved as FREE** |
| Add-product quantities (`js/colourform.js`, ×2) | `Math.floor(Number("١٢"))` | NaN → 0, and the box rewritten to "0" |
| The stock count (`js/stock.js`) | `parseInt("١٢", 10)` | NaN → "not counted" |
| Goods arrived (`js/receive.js`) | `Number("1 000") \|\| 0` | **0** |
| **The product editor** (`js/app-products.js`) | `Number(String(v).replace(',', '.'))` | a 120,000-lira shoe saved at **120** |
| The exchange rate (`js/app-changes.js`) | `parseInt("13,000", 10)` | **13** |

`\d` in JavaScript is ASCII only, so an Arabic phone keypad's ١٢٠ was stripped to nothing in an
app whose shop reads Arabic first. Symptom → cause → fix, in one line: *a figure typed with a
separator or in Arabic digits was saved as a fraction of itself or as zero* → *seven different
parsers, none of which had been asked what people actually type* → *`Desk.toMinor` for money and
`Desk.toCount` for a counted thing, both folding Arabic-Indic and Persian digits once, dropping ٬
as a thousands group and letting ٫ settle the decimal outright.*

**The rest:**

- *A cashier was offered "Close the day", which she cannot do* → the job button read the role's
  name → a `JOBS` key may be a function of the account; it says "Count the drawer".
- *The person card's dots were the right size and the press landed on somebody else's avatar* →
  the card was a flex ROW and its actions hung off a 320px grid column, so the next card painted
  over them → the card is a grid. Found by hit-testing.
- *A 260px lime haze followed the mouse across the lane cards* → `.mo-glow` is `z-index: 1` on the
  body while `.dlb-card` is `z-index: auto` → one rule keyed on `body[data-view]`, off on the six
  work screens.
- *Every board card read "Aleppo · Aleppo, Seryan, near the bakery"* → the city was the heading
  AND still inside the typed address → `withoutCity()` takes it off either end, never the middle.
- *A parcel on the road showed a carrier nobody could call* → switching an account off re-points
  its waiting work to "Former staff", and one already out keeps that id for ever → `driverActive`
  rides the read, and the card says so in amber.
- *Eleven Aleppo addresses are filed under JO and TR, every one `method: driver`* → five
  unguarded ways for the country and the city to disagree, chief among them that the country
  lives in a draft in `localStorage` → `Desk.countryFor` is the one rule. The eleven rows are
  history and were not edited: INV-2118, 2119, 2120, 2121, 2122, 2123, 2124, 2125, 2126, 2128,
  2129.
- *The shelf column is blank on every row in this database* → `variants.shelf` is written once at
  insert and the real assignment is `stock.shelf_id`, which never touches it → the catalogue
  answers `shelf_at` from where the stock actually is.
- *Nine different save behaviours in Settings* → three cards behind a page-level Save, six with
  their own, one per row → every box saves itself, with "Saved" beside it.
- *A fold head ran 14px past the edge of its own card at 390 in Arabic* → the mirror’s
  “Supabase is not set up on this server.” is 217px of text in a 358px card that already holds a
  caret and a title, in a flex row → the meta wraps under the title on a phone and is clipped
  rather than pushed. Found by the sweep, measured twice so a mid-redraw rectangle could not
  raise it.
- *A supplier-pay hint that never fired* → `Cashbook`'s helpers wrote `data-cbc`, which is
  cashbook's namespace, while payables listens on `data-pyc` → `hookAttr` lets a hook name another
  module's namespace (`'py:pay-hint'`).

---

## 8. What was skipped, and why

1. **Reassigning a parcel that has already left.** `Deliveries.update` refuses a carrier change on
   anything past `waiting` with `bad_status`, because a parcel in one person's hands going to a
   second is exactly what the handover sheet exists to prevent. Relaxing it would weaken a server
   guard — a stop condition. The board offers Reassign while the parcel is still on the counter,
   and **Delivered / Couldn't deliver** once it is on the road, with a different sentence. See
   question 4.
2. **The till's last row sits under the phone tab bar.** `.pos` is `height: calc(100vh -
   topbar)` and fills the viewport, so on a 390 phone its bottom 58px are behind the bar. The
   till's own layout is out of scope for this night shift, so the sweep names it and skips it
   rather than silencing it. See question 5.
3. **The eleven JO/TR rows were not corrected.** The brief says not to edit existing rows, and a
   data change is a stop condition. They are listed above and in question 3.
4. **The manager still cannot open Money or Settings.** That is stored state on this database, not
   a code default, and changing it is the owner's decision — question 1.

---

### One harness fact worth keeping

**Two suites cannot run at once.** They share one Chrome profile, so they share one cookie jar:
the second suite’s sign-out kills the first’s session, and the first then collects 401s on
`/api/safeers`, `/api/errands` and `/api/deliveries` that have nothing to do with what it is
testing. Run them one after another. (The shared profile also carries the PREVIOUS suite’s
session for the moment before `login()` signs it out, which is where the 403s on those same
three endpoints come from — `sweep.mjs` starts its ledger once the first screen has settled.)

---

## 9. Questions

Each answerable in one line.

1. **The manager holds none of `money.read · money.count · staff.read · profit.read`, and no
   `config.write`.** So he cannot open Money or Settings at all, and a dozen sentences in the app
   say "change it in Settings". Is that deliberate, or should he be given `money.read` and
   `config.write`? *(It is one screen: Settings → People and access → Roles.)*
2. **Warehouse `cost.read` is 1 on the live database and 0 in the seed.** Untick it, or is the
   warehouse meant to see what things cost? Buying (Worth reordering) now needs it.
3. **Eleven deliveries are Aleppo addresses filed under JO or TR**, all carried by our own driver.
   Leave them as they are, or correct the country on those rows?
4. **Should a parcel already on the road be re-assignable** when its driver is switched off? The
   server refuses it today, on purpose. The alternative is a "hand it over to somebody else"
   route that writes a second handover line.
5. **The till's bottom 58px are under the phone tab bar.** Fix it (one CSS line on `.pos` at phone
   widths), or is the till only ever used on the counter machine?
6. **"Advanced" is developer-only now.** The owner therefore cannot reach the mirror, the
   reminders or the Telegram links from the app. Is that right, or should the owner keep the
   reminders and the Telegram card?
7. **Adding a person is `access.write`**, which is pinned to the owner and the developer. The
   manager holds `staff.write` on paper and can do nothing with it. Should `staff.write` be able
   to hire, or should it be taken off the manager?
8. **The cashier holds `delivery.write`** on this shop, so her job line reads "carries the
   parcels". Is that right?
9. **A shop with one country draws no country control.** Correct, or should "abroad" always offer
   one even when the owner's list has a single row?

---

## 10. How it was verified

`cd server && npm test` (6), and over CDP on the sandbox (8190), every one of these rerunnable
from `PROGRESS.md`:

| Suite | Checks | What it proves |
|---|---|---|
| `ns03/p1-home` | 53 | every job button is a job that account really holds, read from `role_permissions` |
| `ns03/p1-tabbar` | 65 | Home + 2–3 + More, nothing in More that is already a tab or refused |
| `ns03/p2-money` | 39 | every dialog’s shape, and every balance read back out of SQLite |
| `ns03/p2-money-phone` | 34 | the same at 390 in Arabic, every primary button hit-tested |
| `ns03/p2-digits` | 36 | every digit a person might type, through both parsers |
| `ns03/p2-cashier` | 22 | what she sees, and the 403s that make it true |
| `ns03/p3-products` | 50 | the search, an Arabic-layout scan, the price and the archive read back |
| `ns03/p3-products-phone` | 17 | the same at 390 in Arabic |
| `ns03/p4-settings-staff` | 43 | five sections, instant save, the shipping list, the people |
| `ns03/p5-safeers-board` | 56 | the country, the board, safeers, the driver, the shelf |
| `ns03/sweep` | 433 | every screen every role can open, EN 1100 and AR 390 |

The ns02 and quick-fix suites re-run green. Two were updated where a control moved:
`ns02/p2-edit` (the full editor is under the drawer’s “…” now) and `qf-safeers` (“Show
everything” is a chip).

**Every money move, every price, every new person, every reassignment and every Delivered was
read back out of SQLite** — never off the screen that wrote it.

---

## 11. Commits

| Commit | What |
|---|---|
| `64ccb94` | ns03: phase 0+1 — the audit, and a job home for everyone |
| `572bbbe` | ns03 phase 2: money — one shape for every dialog, and plain words |
| `51c6f70` | ns03: the parseInt bug had four siblings, and every one read ZERO |
| `77b42a9` | ns03 phase 3: the products list — one box that takes a scan, and three quick edits |
| `712fdbb` | ns03: phase 1b + phase 4 — settings & staff |
| `66d1add` | ns03: phase 5 — deliveries, safeers, the driver, and the shelf that lied |
| `6eec5b6` | ns03: final sweep, the report, and CLAUDE.md |
