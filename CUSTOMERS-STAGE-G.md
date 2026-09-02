# CUSTOMERS-STAGE-G.md — the cap family, the wants fold, and the loyalty card

Two items, then Stage G. **50 checks pass** — 24 for the two items, 26 for Stage G. Live database at
migration **034**, untouched (customers 2, sales 13, wants 0, no test rows). `CACHE` is
**`og-system-v93`**. I18N equal at **1,413 keys**.

**Stage G is not finished, and this says exactly where it stops.** The code, the scan branch and the
till behaviour are built and proved. **The printed card layout is not**, because the ruler test
cannot be done from here — see the first section below, which is the answer to "report the
millimetres".

---

# The ruler test — read this first

**I cannot measure a printed sticker.** What I can do is make the disagreement precise, put the
question on a printable sheet, and stop before the layout. All three are done.

## What the code actually disagrees about

Four places, and no two of them agree:

| Where | Says |
|---|---|
| `config.label.default_preset` | **`30x30`** |
| `js/app-state.js` `OG.lb` | `size: '30x30', cw: 30, ch: 30` |
| `js/labels60.js` | built entirely around **60 × 40** — `var W_MM = 60, H_MM = 40;`, "a 60 x 40 label is exactly 480 x 320 dots" |
| `label_templates` row 8 | literally named **"60 x 40mm (unconfirmed roll size)"** |

The database is flagging its own uncertainty in a row name. `label.presets` carries eight presets
from 30×20 up to 60×40, and nothing records which roll is on the machine.

**The app currently believes one sticker is 30 × 30 mm.** That is what `labelDim()` returns and what
the calibration sheet now prints.

## What I changed so somebody can settle it in ten seconds

The shop already had a ruler test (`Settings → hardware → Print a ruler`), and it answered only
*"is the printer scaling?"* — two 10 mm rules. It did not answer *"what roll is loaded?"*, which is
the question the card needs.

It now also prints **four corner marks at the exact edges of the sticker the app believes in**:

```
   ruler sheet says: 10 mm · 10 mm tall · 30 × 30 mm — what the app believes one sticker is
   corner box is 30mm x 30mm
```

> The four corner marks sit at the edges of the sticker the app expects. If they land on the corners
> of the real sticker, the size above is right. If they fall inside it or run off it, that size is
> what needs changing — measure the sticker and tell us the millimetres.

No arithmetic, no measuring in the common case: either the marks line up or they do not.

```
PASS RULER: the sheet has corner marks now
PASS RULER: four of them
PASS RULER: …and still both 10mm rules
```

**What I need back:** print that sheet on the roll that is actually loaded, and tell me either
"the marks line up" or the two numbers off a ruler. **The card layout is held until then** — a
60 × 40 layout on a 30 × 30 roll is clipped, and a 30 × 30 layout on a 60 × 40 roll wastes half the
roll and looks like a mistake. That is not a thing to guess at and print two hundred of.

---

# Item 1 — the undercount family, closed

## The rule, applied

`server/lib/capped.js` — every capped reader returns `{ rows, shown, total, capped }`, and the
truncation travels with the data. `capped` is **`total > shown`**, never `shown === limit`: a table
holding exactly 200 rows is not truncated, and claiming it was sends somebody looking for rows that
are not there.

```
PASS sales: 200 rows, as the limit says  → 200
PASS sales: the TRUE total rides along  → 243
PASS sales: and it says it was capped
PASS a list that fits does NOT claim to be capped — `total > shown`, not `shown === limit`
PASS history: the timeline knows it is a window of 230  → 230
PASS wants: a FILTERED total counts the same set the reader read, not the table
```

That last one matters: a filtered list's total must repeat the reader's own `WHERE`, or
"3 of 4,120" is a count of a different set.

## Where a person now sees it

```
PASS the reports screen says when it capped
PASS the wants tab says when it capped
PASS the deliveries board says when it capped
PASS the customer timeline says when it capped
PASS the dashboard invoice badge says when it capped
PASS the sales export sheet says when it capped
PASS the message panel says when it capped
```

Two shapes, because a badge has no room for a sentence:

- `cappedNote(cap, what)` — "Showing the most recent 200 of 243 invoices — every figure on this
  screen is of those 200, not of the whole shop."
- `cappedCount(cap)` — `200+` rather than `200`.

## The sweep — 116 caps, classified

I swept every `LIMIT ?`, `limit = N`, `slice(0, …)` and `Math.min(N` across `js/` and `server/`.
116 hits. Classified by the rule you gave: **is the result counted, summed or badged somewhere
else?**

**Fixed — a number was derived from the truncated set (7):**

| Cap | What was wrong |
|---|---|
| `/api/sales?limit=200` → `DB.sales` | dashboard revenue, `monthlySales`, `salesByType`, shift takings and the reports charts all sum this. The biggest one. |
| `/api/movements?limit=400` | the reports inventory tab reads it |
| `/api/customers/:id/history` | the timeline badges its event count, and `sizeDrift` compares "recent" against "older" as facts about a whole history |
| `/api/wants` | the wants tab badges the length |
| `/api/deliveries` | `whoCell` counts a customer's failed deliveries across the array |
| `js/app-export.js` sales sheet | **totals the rows at the bottom** — a sheet somebody hands a bank |
| `js/notify.js` inbox | the badge counts **all** unread; the panel listed 14. With 20 unread it said 20 and showed 14, and the other six were unreachable. |

**Already correct, and worth naming (2):**

- **`js/stock.js` count sheet** — already printed "showing 120 of N" before this sweep, the only
  place in the codebase that did. Its header count is over *every* live variant, so the number is
  right and the list is the window — the safe direction. I only folded its two literal `120`s into
  one constant so they cannot drift apart.
- **`js/bulk.js` movements select-all** — `slice(0, 90)` in `Bulk.visibleIds` matches `slice(0, 90)`
  in the moves tab **exactly**, which is the Stage C pairing done right. It is the one place that
  had already learned this lesson.

**Decided fine, and why (the rest):**

- **Clamps, not caps.** `Math.min(99, qty)`, `Math.min(200, cw)`, `Math.min(1, progress)` — input
  validation and animation easing. Nothing is being listed.
- **String truncation.** `slice(0, 40)` on a scanned code for a toast, `slice(0, 140)` on an error
  message, `slice(0, 12)` on a token hash. Text, not rows.
- **Display-only lists with no derived number** — `DB.expenses.slice(0, 40)`, the dashboard's
  `slice(0, 5)` recent sales, `gapped.slice(0, 3)`, the pickers' `slice(0, 6)`, the palette's
  `slice(0, 60)`, Yalla's column previews. Each renders rows and totals nothing. A list headed
  "recent" is not claiming to be everything.
- **`alerts.js` `MAX_ROWS = 8`** — fixed in Stage F, and the stamp block now reserves a slot inside
  it for its own summary.
- **`CUST_RENDER_CAP = 60`** — fixed in Stage C, paired with `customerRowsShown()`.

# Item 2 — duplicate wants fold on merge

Folded inside the merge transaction. Keeps the **earliest ask** (that is when they actually wanted
it, and it is what puts them at the front of the queue when the box lands) and **the answer if
either row had one** (so nobody rings them twice about a pair they have already collected).

```
PASS F: the two asks for a 44 folded into ONE  → 1
PASS F: …the EARLIEST ask survived
PASS F: …with its own date, which is what puts them at the front of the queue
PASS F: …and the ANSWER carried across, so nobody rings them twice  → "rang her"
PASS F: the merge reports what it folded  → 1
PASS F: the folded row's DELETE is logged  → 1
PASS F: wants for other sizes are untouched  → 3
```

The DELETE is logged because an unlogged one leaves the row in the Supabase mirror forever — the
exact failure the demo purge caused before it called `logChange`.

`Wants.record`'s same-day dedupe is unchanged and deliberately narrow: asking again in March after
nothing arrived in January is a real second ask. A merge is the one moment the shop learns the two
askers were one person, so it is the moment to fold.

---

# Stage G — what is built

## G1. The code, and that it collides with nothing

**`CU-` + the zero-padded customer id** — `CU-000083`. **Nothing is stored**: the code is derived
from the id, so a card cannot go stale, cannot be reissued wrongly, and a lost card's replacement
carries the same number.

The branch goes **first** in `resolveScan`, ahead of the product lookups. That ordering is the
safety: it collides with nothing today, and going first means it cannot be shadowed later by one of
the other parsers growing a looser rule.

Proved against all seven, in both directions:

```
PASS G1: it resolves to the customer  → "customer"
PASS G1: not all digits — so not a label code and not an EAN
PASS G1: 9 characters, over the wedge minimum of 4
PASS G1: not a barcode
PASS G1: not a SKU
PASS G1: not a label code
PASS G1: not an invoice
PASS G1: not a print job
PASS G1: not a shelf code
PASS G1: no SKU starts with it, so the cropped-label fallback cannot claim it  → 0
PASS G1: a real barcode still resolves to its variant
PASS G1: …and a real SKU still does too
PASS G1: a real invoice number still resolves to the invoice
PASS G1: a card for a customer who does not exist falls through, it does not invent one
```

That last one is deliberate: an unknown id reaches the unknown-code modal, because a printed card
for a deleted customer is a real thing to be told about.

## G2. What a scan does

**At the till with a sale open: attach, and do not move.** This is the behaviour the card exists
for — the card is handed across the counter mid-sale, and anything that takes the cashier off the
POS has missed the point.

```
PASS G2: a sale is open
PASS G2: the card ATTACHED the customer to the basket  → 83
PASS G2: …without navigating away  → "pos"
PASS G2: …and without touching the address bar  → ""
PASS G2: …and without a drawer over the cart either
PASS G2: scanning it again says they are already on the sale
PASS G2: away from the till, the same card opens the profile  → 83
PASS G2: at the till with an EMPTY basket it opens the profile instead
```

The empty-basket case goes to the profile on purpose: there is no sale to attach to, and doing
nothing silently would read as a card that does not work.

`POS.refresh` (the foot repaint) is exported for this rather than calling `render()`, which would
rebuild the cart and lose anything half-typed in the discount box.

This also completes the Stage C regression I flagged and Stage F's guard: `#open/customer/<id>`
mid-sale opens the drawer, and a **scanned card** now attaches instead — which is what that guard
was built to hang on.

## G3. Printing — HELD

Not built, and deliberately. The layout depends entirely on a number nobody has measured. What is
already true and does not need re-deciding when the millimetres arrive:

- **Arabic goes through the raster path.** `js/labels60.js` renders to a canvas and
  `ESCPOS.packBitmap` sends pixels; ESC/POS text mode has no bidi and no shaping. There will be **no
  second way to make Arabic pixels** — the card will reuse that path, not add one.
- The card's content is settled: name (`nm()`-safe), the `CU-…` code as Code 128, and the shop mark.
- Batch printing from the list will reuse the existing selection (`Bulk`), not a new one.

---

## §10 — what this prompt got wrong, and what is unsettled

- **"Do the ruler test first and report the millimetres."** I cannot; the prompt says as much in the
  same sentence ("only somebody in the shop can settle it"). What I have reported is the
  disagreement, the app's current belief (**30 × 30**), and a sheet that answers it without a
  calculation. If that reads as ducking the instruction, the alternative was inventing a number.
- **`labels60.js` is named for a size it may not be printing.** If the roll turns out to be 30 × 30,
  that module's name, its constants and its comment block are all wrong, and the fix is bigger than
  a rename — its layout arithmetic is built on 480 × 320 dots.
- **The corner marks assume the printer is not scaling.** If the 10 mm rules come off at 11, the
  marks are wrong by the same factor. The sheet prints both, so the reading order matters: check the
  rules first, then the corners.
- **`cappedNote` is per screen, not automatic.** A screen added later that sums `DB.sales` will be
  silently wrong again. The honest fix is a lint — "any file that reads `DB.sales` and calls
  `.reduce` must also call `cappedNote`" — which is the same shape as the permission-name sweep and
  is not written.
- **The wants fold is only on merge.** Two records that were never merged can still each hold an ask
  for the same size; nothing sweeps for that.
