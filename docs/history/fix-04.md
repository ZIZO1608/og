# Fix 04 — two small fixes before the merge

Branch **`fix-04`**, off `night-shift-03`. Started **22:42**, finished **23:35**, Fri 18 Sep 2026.
Nothing pushed, nothing merged. **No migration, no schema change, no data change, and no server
permission weakened.** Everything ran against the sandbox (`server/data-sandbox`, port 8190); the
real `server/.env` and `server/data/og.db` were never opened.

One of the two was built. The other was stopped, on purpose, at the stop condition the brief
wrote — and the whole of §2 is why.

---

## 1. What must be done by hand before this runs on the shop laptop

**NOTHING.**

`sw.js` `CACHE` is bumped to `og-system-v270`, which is the ordinary deploy step and not a hand
step. No new JS file, so the precache list is unchanged.

---

## 2. Fix 1 — "Bring it back": **STOPPED**, and exactly why

### 2.1 What the existing path does to cash and stock

Asked for first, because the answer is what settled it.

- **`out → failed`** (`PATCH /api/deliveries/:id`, `delivery.write`) writes `fail_reason` and
  `closed_at` **and nothing else**. `Cash.apply` is never called, `order_payments` is untouched,
  `collected` is untouched, and no stock moves: the goods left with the sale and only a return
  puts them back. What it *does* do outside the row is fire the office's `dl_failed` Telegram
  alert and add a permanent "could not be delivered" event to the customer's tracking page
  (`push_seen`), neither of which can be taken back.
- **`Orders.takeBack`** (a return, `delivery.desk`) is the only other route that moves an `out`
  parcel. It restocks the pieces through `Stock.apply` (type `returned`), pays a refund or grants
  store credit through `Cash.apply`, and **still closes the delivery as `failed`, never back to
  `waiting`** (`const closed = dl.status === 'out' ? 'failed' : dl.status;`). That is a money and
  stock decision about a customer's order, not a fix for a staff account somebody switched off.

### 2.2 The blocker

**There is no existing path from `out` to `waiting`.** `NEXT` in `server/lib/deliveries.js`:

```
waiting: ['out', 'failed']      out: ['delivered', 'failed']
delivered: []                   failed: []
```

so "couldn't deliver" is a **dead end by design**, and a carrier change is refused on anything past
`waiting`. Every way back was tried against the running server, as the owner, and every one was
refused **409 `bad_status`**:

| tried | answer |
|---|---|
| INV-2121 `out → waiting` | `a delivery that is "out" can only become delivered or failed` |
| INV-2121 → a real safeer | `it has already left — it cannot be given to someone else now` |
| INV-2101 `failed → waiting` | `this delivery is already failed — that cannot be undone here` |
| INV-2101 → a real safeer | `it has already left — it cannot be given to someone else now` |
| INV-2101 `failed → out` | `this delivery is already failed — that cannot be undone here` |
| INV-2102 `delivered → waiting` | `this delivery is already delivered — that cannot be undone here` |

So making the parcel land in `waiting` means **adding `failed → waiting` to that table** — a new
server rule, against the invariant the module states in its own header ("Status moves one way …
Delivered and failed are the end"), and one that reaches further than the board: `closed_at`, the
`today` window the lanes are built on, the `dl_failed` alert already sent to the office, and the
"could not be delivered" line already on the customer's tracking page. That is the brief's stop
condition — *would require weakening a rule* — so it was **not built**. It is question 1 below.

### 2.3 What was done instead

Nothing was changed on the board: night shift 03 already made it honest, and its own comment in
`js/deliveries.js` says why ("Drawing Reassign there would be a button that always fails").
A parcel on the road whose safeer was switched off shows the amber
**"Driver switched off — it already left, so close it when you know what happened"**, its lime
button is **Delivered**, and "Couldn't deliver" is under the dots.

What was added is the proof, as a rerunnable suite: `_nightshift/fix04/bring-back.mjs`. It pins
the six refusals against the real server, reads the transition table and the return's closing line
out of the source, counts the delivery rows, `money_moves`, `stock_movements` and `order_payments`
**before and after** so that nothing was written while proving it — **no cash row exists for
Former staff, and none was made** — checks that a warehouse account is refused 403 by hand on the
same route, and hit-tests the card in English at 1100 and Arabic at 390.

---

## 3. Fix 2 — the till's bottom on a phone

Layout only. **The sale, its steps, its buttons and its logic did not move.** One block in
`css/og-skin.css` headed `FIX 04`, all of it inside `@media (max-width: 720px)`.

It was reported as "the till's bottom ~58px sit under the tab bar". Measured at 390 it was two
faults, and both were worse than that.

### 3.1 The Complete-sale button was not under the bar — it was not there

**Cause.** At ≤720 the cart is a fixed sheet — `.pos-right`, `bottom: var(--tabbar-h)`,
`max-height: 76vh`, `overflow: hidden` — holding a flex column of head + lines + foot. The base
rule says `.cart-foot { flex: none; max-height: 64vh }`; the ≤1080 block lifts the cap off it
(`height: auto; max-height: none`), which is right for 721–1080 where the cart is stacked and
follows the page down. Inside a 578px sheet the foot therefore kept its **851px** of customer box,
discount, points, totals, eleven payment methods and Pay, and the sheet's own `overflow: hidden`
cut the bottom **426px** off. Pay measured at y 1156–1202 on a 760px screen: clipped away, on the
one screen where it is the whole point.

**Fix.** `flex: 0 1 auto; min-height: 0` so the foot can never be taller than the room the sheet
has; its own `overflow-y: auto` then scrolls it; `overscroll-behavior: contain` keeps a flick
inside the cart. And **Pay is `position: sticky; bottom: 0`** in a band of the foot's own colour,
so it sits on the glass at the sheet's bottom edge — which is the top of the tab bar — instead of
being something to scroll for.

### 3.2 The cart sheet was not fixed to the screen

**Cause.** `position: fixed` resolves against the viewport only while no ancestor carries a
transform. `#view` carries one: `.fade-in` (every repaint) and `.mo-view` (a view change) both
**end** in `transform: none` and both fill **`both`**, so the finished animation goes on applying
that last keyframe and `#view` keeps `transform: matrix(1, 0, 0, 1, 0, 0)` for as long as the
screen is up. An identity transform is still a transform, and it makes `#view` the containing
block for everything fixed inside it. Measured: scrolling to the end of the shoes took the cart
sheet from y 640 to **y −2210** — the summary bar, the total and the whole pay sheet gone off the
top of the screen.

**Fix.** `animation-fill-mode: backwards` on the till's own view. The from-state is still applied
before the animation starts, it still runs, and when it finishes the element goes back to its own
style — which for both of these *is* the last keyframe. Same movement, nothing left behind.

This is the stacking-context trap in `css/shell.css` one step on (the same filling animation, the
other consequence), and the same one the order desk met in its sticky foot. It is scoped to the
phone till because that is the one screen with something fixed **inside** the view; see question 3.

### 3.3 Two smaller ones in the same block

- **The product grid cleared the collapsed cart and not the bar under it.** `.pos-grid-wrap` had
  `padding-bottom: calc(62px + 24px)` — the 62px sheet handle, with nothing for the 58px bar it
  floats above — so the last row of shoes rested 34px inside the handle. It is
  `calc(62px + var(--tabbar-h) + 24px)` now, and `--tabbar-h` already carries
  `env(safe-area-inset-bottom)`.
- **The till opts out of `.view`'s padding by design** (`.view.pos-view { padding: 0 }`, because
  the panes own their own), so the `scroll-padding-bottom` every other screen got in the quick fix
  had to be restated for it — and larger, because on this screen "the bar" is two things: the tab
  bar and the collapsed sheet floating over it.
- **The lines window's floor was shorter than one cart line.** `.cart-lines` is `flex: 1`, which is
  `flex-basis: 0`, so once the foot shrinks it is the min-height that decides how much basket is on
  screen. 90px against a cart line of 125–140px showed half a shoe with the top of the only line
  scrolled up behind the head. One whole line, 150px.

### 3.4 The desktop

Untouched, and proved rather than asserted. Every rule is inside `@media (max-width: 720px)`, the
computed values at 1100 are the base ones (`flex: 0 0 auto`, the 64vh cap, the 96px lines floor,
Pay `static`, the grid's 40px), and the 1100 picture of the cart column is **byte-identical** to a
golden taken with the fix stashed out of the working tree (`_nightshift/fix04/golden-desk.mjs`
says how to regenerate it). The cart column rather than the whole screen, because the product grid
beside it draws how many of each size are on the shelf, and any suite that rings up a sale would
then break a check that has nothing to do with layout.

---

## 4. Bugs found on the way

| | symptom → cause → fix |
|---|---|
| 1 | Pay unreachable on a phone → the cart foot kept `flex: none` and its full 851px inside a 578px sheet with `overflow: hidden` → the foot shrinks and scrolls; Pay is sticky. §3.1 |
| 2 | The cart sheet scrolls away with the products → a filling animation leaves an identity transform on `#view`, making it the containing block for `position: fixed` → `animation-fill-mode: backwards`. §3.2 |
| 3 | The last row of shoes rests inside the collapsed cart → the grid cleared the 62px handle and not the bar under it → `calc(62px + var(--tabbar-h) + 24px)`. §3.3 |
| 4 | Half a shoe in the basket window → `.cart-lines` floors at 90px, a cart line is 125–140px → 150px. §3.3 |
| 5 | `ns03/sweep` skipped the till → a written exception pointing at question 5 of the night-shift-03 log → the till is swept now, measuring the last product card, because `.view.pos-view` has no bottom padding of its own to measure against. |

---

## 5. The checks

Run one at a time — they share one Chrome profile and therefore one cookie jar.

```
cd server && npm test                          6
node _nightshift/ns03/sweep.mjs                437
node _nightshift/ns02/qf-board.mjs            20
node _nightshift/fix04/bring-back.mjs         33
node _nightshift/fix04/till.mjs               88
```

`fix04/till` is the one that matters for fix 2, and it asks only what the brief asked: Pay, the
total and the last cart line each hit-test **to themselves** with a cart of one and a cart of
twelve, as the cashier and as the owner, in English and in Arabic at 390; everything the cart draws
stays above the top of the tab bar; the sheet stays put while the products scroll and no ancestor
leaves a transform; the grid clears both; **a real sale is rung up by pressing the real button with
a real mouse and read back out of SQLite** — the invoice, its line, the shelf coming down by one
and the movement behind it; and the desktop is unchanged.

Twelve pieces is nine lines: the sandbox has nine sizes with stock at the till's warehouse, and
`POS.add` refuses past what is on the shelf, so the basket is filled with what is really there
rather than with a number that would prove nothing.

Pictures, in the untracked `docs/img/night-03/`:
`fix04-till-open-en-390.png` and `fix04-till-open-ar-390.png` (the sheet open, the foot scrolled to
its end, Pay on the glass above the bar) · `fix04-till-cashier-en-390.png` and its three siblings
(the collapsed handle with the last row of shoes clearing it) · `fix04-board-en-1100.png` and
`fix04-board-ar-390.png` (what the stuck parcel says today).

---

## 6. Questions

1. **A parcel on the road with a removed account on it can never be given to anybody.** Unsticking
   it means adding `failed → waiting` to `NEXT` in `server/lib/deliveries.js`. Do you want that
   rule — and if so, should a revived parcel keep its `closed_at` and the "could not be delivered"
   line already sent to the customer's tracking page and to the office's Telegram, or lose them?
2. **INV-2121 is on the road right now with nobody real holding it.** Until such a rule exists the
   only honest closes are Delivered and "Couldn't deliver". Which is true of that parcel?
3. **`.fade-in` fills `both` app-wide**, so every element that uses it leaves an identity transform
   behind — the same fault as §3.2, anywhere else something is `position: fixed` inside an animated
   box. Fix 04 changed it on the till only. Should it say `backwards` everywhere?
4. **The open cart sheet is capped at `76vh`** (578px of 760). With the foot shrinking, that leaves
   the basket a 150px window — one line and a peek. Should the sheet take the whole height above
   the tab bar instead?
5. **The phone till's foot is ~850px because the shop has eleven payment methods**, each a button.
   Should the phone show the drawer methods only, with the rest behind "more"? That is a change to
   the sale flow, so it was not made here.

---

## 7. Commits

Fix 1 shipped no code — that is the whole of it — so its commit is its record.

| | what is in it |
|---|---|
| `C1` | **fix-04 (1/2): the till's bottom on a phone** — `css/og-skin.css`, `sw.js` (`CACHE` → `og-system-v270`) |
| `C2` | **fix-04 (2/2): "Bring it back" is refused by the server, so it was not built** — `fix_04_log.md`, `CLAUDE.md`, `PROGRESS.md` |

The suites live in the gitignored `_nightshift/fix04/` and the pictures in the untracked
`docs/img/night-03/`, so neither is in either commit; `PROGRESS.md` names the commands.

Nothing pushed. Nothing merged.
