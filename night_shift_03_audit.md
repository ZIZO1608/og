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
