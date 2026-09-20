# Quick fix — one hour

**Start 15:46 · code stopped 16:15 · report 16:15–16:25 (Fri 18 Sep 2026, GTBDT).**
Branch `quick-fix` off `night-shift-02`. Four commits. Nothing pushed, nothing merged.

---

## 1. By hand before this runs on the shop laptop

**ONE BOX TO UNTICK, and it is not a migration.**

> **Settings → Roles → Warehouse → untick "See what things cost"** (`cost.read`).

Task 3d asked me to take `cost.read` off the warehouse role's **default in code**. There was
nothing to take off: `server/migrations/003_role_permissions.sql:114` already seeds
`('warehouse','cost.read',0)`. The **1 is stored state** — `role_permissions` on this database
says `warehouse/cost.read = 1` (and `manager/cost.read = 0`, which the seed has as 1), so that
table has been edited since it was seeded. As instructed, **no migration and no data change**:
untick the box in Staff and the row updates itself.

Everything else: nothing. No migration, no `server/supabase/` file, no config key. `sw.js`
`CACHE` is bumped to `og-system-v263`.

---

## 2. The deliveries board overlap

**Cause, in one sentence:** `.dlb-mi` was already the **method icon** in a card head
(`js/deliveries.js:572`; `css/og-skin.css:756`, 32px, `flex:none`, `display:grid`) and night
shift 02's `f343458` gave the **same class name** to the menu items in the row's new "…" as
`display:block; width:100%` under `body:not([data-portal="yalla"])` — (0,2,0) beating (0,1,0) —
so the scooter icon became a full-width block, took the whole head row, and pushed the invoice
number, the money and the Paid pill out through the right edge onto the next lane. **The empty
lime band on an "On the road" card was that icon, stretched.**

This is the `.pos` collision from CLAUDE.md's own Gotchas, committed by me, against the rule
written there: *grep for a class name before defining one.* I did not.

**Fix:** my menu item is `.dlb-mitem`; the method icon keeps the name it had first. Seven
buttons, one `closest()`, three CSS rules. No markup moved and no layout was re-designed —
the head row was always correct markup being wrecked by one inherited rule.

**Proof the check catches it** (`_nightshift/ns02/qf-board.mjs`, 20 checks): it measures every
descendant of every card against its own card's box, Lanes **and** List, 1100 and 390, EN and AR.
Run against the code before the fix it goes red and names the offenders and how far out they are:

```
FAIL en/1100/list: nothing draws outside its card
  ["INV-2123 :: BDI [353,25]", "INV-2123 :: dlb-money is-paid [363,65]", …]
```

— the invoice 25px past the right edge, the money pill 65px. On this code all 20 pass, and it
also asserts the method icon is still a 32px square, so "make everything block" cannot be the
fix next time.

**Task 1.4 (destination shown once) — NOT DONE**, deliberately. `Aleppo · TR` is the city and
country from the delivery row; `Syria, Aleppo` is the free-typed address, which repeats the city.
De-duplicating text somebody typed is a guess, and the two invoices below suggest the real problem
is the data, not the card. Listed as a question instead.

---

## 3. Safeers — every error, symptom → cause → fix

**First, what I could not reproduce.** Opened as **owner** and as **manager**, EN at 1100, and
pressed Refresh, Give a parcel, New errand, Their tasks, New password, Switch off, Add (empty and
valid) and all three filters including setting and clearing "Since": **zero console errors and
zero failed requests on both accounts**, before and after. Add with nothing filled refuses
politely ("A name and a username, please."). There is no JavaScript fault on this data.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | "The task list looks empty or cut off" — the owner sees **4 rows of 24** | `S.filter.status` starts at `'open'`, which is the right default, and **nothing on screen said the list was filtered** | It says *"Showing N tasks — the list is filtered"* with one press to drop all three filters; the empty state now says to try Show everything rather than implying there is no work |
| 2 | Picking a date in **"Since" changed half the list** and left the other half alone | The filter rode on the errands' query string (server-side) and was **read nowhere for the parcels**, which come from the board's request and are narrowed in `tasks()` | Parcels obey it, on the same instant the rest of the screen sorts by (closed → out → assigned → sale). A task with **no date at all is kept** — dropping it would hide real work behind a filter about time |
| 3 | **"Switch off" fired on the press**, no question asked | It went straight to `POST /api/safeers/:id/active` | It asks first, and **names how many open tasks they are still carrying**. It ends their sessions and takes the shop off their phone mid-round. Switching back **on** is harmless and does not ask |
| 4 | The card menu **opened and vanished within half a second** | I first held "open" as a class on the node. This page `repaint()`s whenever a load lands or a live event arrives, and `render()` rebuilds the cards | The open menu is held in **module state** (`S.menu`) and re-drawn |
| 5 | The menu was **painted under the next card** and swallowed the press | The next card is a later sibling; the menu's `z-index: 30` was inside an unpositioned ancestor | The card whose menu is open gets `is-menu` and comes to the front. **Caught by hit-testing, not by looking** |

**Check** (`_nightshift/ns02/qf-safeers.mjs`, 22, owner and manager): the page loads with no
failed request and no console error, still none after pressing everything; the filtered note and
its clear; "Since" narrowing the parcels; the account actions behind the dots and not loose on the
card; the menu **hit-tested as really on top**; Switch off asking first.

---

## 4. Quick wins

| | | |
|---|---|---|
| **a** | Arabic words | **done** — "وين الغرض؟" → **"وين موجود؟"**; every More fold and menu is **"المزيد"** (the warehouse's, the add form's, the money screen's "Records") |
| **b** | Safeers card "…" | **done** — New password and Switch off behind it, hit-tested, with the confirmation above |
| **c** | Phone tab bar | **done, but not the part the brief expected.** The bottom padding was **already right**: `.view` ends at `calc(var(--tabbar-h) + 28px)` and `--tabbar-h` already carries `env(safe-area-inset-bottom)`. What was missing is **`scroll-padding-bottom`** — without it the browser's own scrolling (`scrollIntoView`, focusing a field, an anchor jump) parks the target flush with the bottom edge, *under* a bar that floats over it. That is precisely the app-wide behaviour night shift 02 measured and left as its question 4. Added on `.view`, `.drawer-body` and `.modal-body` under 720px |
| **d** | Warehouse cost prices | **nothing to change in code** — see §1. The code default is already 0; the DB row is stored state, so no migration |
| **e** | Money inputs | **done** — the two that were missing it (`mnFloat`, `mnCounted`). The rest already had it: the cash book draws every amount through one `amountBox()` helper that has carried `inputmode="decimal"` since it was written, which is why there was almost nothing to do |

---

## 5. Questions

1. **The "JO"/"TR" invoices.** `INV-2121` and `INV-2122` are `Aleppo · JO`, `INV-2123` is
   `Aleppo · TR` — city Aleppo with a country of Jordan/Turkey, and an address of "Syria,
   Aleppo". Is the country wrong on those three rows, or is the city?
2. **Three parcels show "Former staff" as the safeer** — `INV-2121` (out), `INV-2105` and
   `INV-2103` (waiting). They were assigned to an account that has since been removed and
   re-pointed to the hidden Former-staff record. **`INV-2121` is out on the road with nobody
   real attached to it.** Should the board let them be re-assigned, or is that history?
3. Should the destination on a card be de-duplicated (question 1 is the same data), or should the
   office stop asking for a city that the address already contains?
4. Switching a safeer **on** does not ask. Right?
5. The Safeers task list defaults to "Open". Keep that default now that it says so, or open on
   everything?

---

## 6. Commits

| | |
|---|---|
| `d04d11c` | quick-fix 1: the board cards overlapped because I reused a class name |
| `84e7276` | quick-fix 2+3ab: Safeers — the filtered list said so, and the card has a "…" |
| *(next)* | quick-fix 3c+3e: scroll-padding under the phone bar, and two money inputs |
| *(next)* | quick-fix: the log, and the gotcha in CLAUDE.md |

## 7. Verified

`cd server && npm test` (6) · `qf-board` (20) · `qf-safeers` (22) · `p4-money` (18, the
night-shift-02 suite covering the board's menu and the Money screen) · `qf-walk` (26 —
deliveries, safeers, money and warehouse in EN 1100 and AR 390: no sideways scroll, nothing
outside a card, no raw i18n key, no console errors) — **92 checks, all green**.

One harness flake worth knowing: the suites share one Chrome profile, and a run that signs in as a
second account straight after the first can meet a moment where the old session is gone and the
new one is not yet set — a burst of 401s on `/api/safeers`. It passed cleanly on a re-run and is
not a fault in the shop. `p4-money` also needed its selector updated for the `.dlb-mitem` rename,
which is the rename doing its job.
