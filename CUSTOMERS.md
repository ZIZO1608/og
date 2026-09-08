# CUSTOMERS.md — the customers rebuild, 31 Aug – 3 Sep 2026

One file in place of twelve. The rebuild of the Customers screen and everything under it —
migrations `028` to `034`, six server modules, the profile, loyalty, debt, merge, the loyalty card
— was done in stages, each with its own report. Those reports (two reconnaissance dumps, seven
stage reports, a polish pass, and the dashboard report) were three hundred and eighty kilobytes of
verbatim code excerpts with line numbers that stopped being true on the next commit, `PASS` lines
from harnesses that were later deleted, and stage-by-stage narrative about the prompts that drove
them. **This file keeps what still matters**: the decisions the owner made, what was built and where
it lives, how it was proved, and what is still open. **How it all works now is in `CLAUDE.md`**
under "Customers" — that is the operational reference; this is the record of how it got there.

The twelve it replaces, all in git history: `CUSTOMERS-RECON.md`, `CUSTOMERS-RECON-2.md`,
`CUSTOMERS-STAGE-A.md` … `-G.md`, `CUSTOMERS-STAGE-F2.md`, `CUSTOMERS-POLISH.md`, `DASHBOARD.md`
(whose content is entirely in `CLAUDE.md` "The dashboard" and "The bell").

---

## The decisions the owner made

Each was asked as a question the code could not settle, answered, and built. **They are settled**;
reopening one means a conversation, not a refactor.

| Question | Decision | Where it lives |
|---|---|---|
| Two people share a phone number | Not a duplicate. The second is **saved anyway** and the till is **warned**, naming the holder — and saying so if the holder is archived. The create returns 200 with a `warning`, never a 409: a 409 on a row already written made every retry a second row. | `phoneHolder`, `create`, `update` in `server/lib/customers.js` |
| What is a "visit" | The server's count of **non-voided invoices**. A voided sale erases the visit from the shop's memory of that person entirely; `last_purchase_at` skips voided sales too, so they are consistent. | `visits` in the customer query |
| `loyalty.mode` | **`points`** today. Stamps are built and switched off; redeeming is refused with `stamps_off`, the count is still readable because it is arithmetic over sales. | `server/lib/loyalty.js`, Settings → Loyalty |
| The at-risk window in Settings | Yes, a manager can change it — `customer.at_risk_days`, and later the rhythm multiplier and floor beside it. | `CONFIG_WRITABLE` admits `customer.*`; migrations `028`, `029` |
| `customers.note` visibility | Stays visible to anyone with `customer.read` — every cashier. The edit form says so on its face. No private note field, no `note.read` permission. | profile + edit form, `js/app-customers-scan.js` |
| `sales.customer_name` on old invoices | **Frozen.** A receipt is a record of that moment. Renaming somebody does not rewrite their invoices, and attaching a customer to an old walk-in sale leaves it printed as "Walk-in". | `Sales.attachCustomer`; `invoiceHtml`/`receiptHtml` read `sale.customerName` |
| The credit limit's currency | **USD, stored in cents.** A limit written in lira decays as the currency moves. Compared by converting each open debt at its own frozen `fx_rate` — the same arithmetic as `spent_usd_equiv`. Displayed in dollars with today's lira beneath, labelled approximate. | `033`, `Sales.record`, the edit form |
| `logChange`'s fifth parameter | It was named `origin` (device id, for echo-skipping) and every caller passed a human note. `034` adds `change_log.note`; the fifth parameter now means what callers always meant, `origin` moves to a sixth and stays unused. | `server/lib/db.js` |
| Customer #81's phone | The one real customer's number matched a test number by coincidence. Not modified, not read; left for the owner. | — |

---

## What was built, in order

**A — foundations** (`028_customers_foundation.sql`, `server/lib/text.js`). The money bug first:
`total_spent` was `SUM(total)` across currencies, adding US cents to lira. It became the pair
`spent_syp` / `spent_usd` plus `spent_usd_equiv` — sort-only, each sale converted at its own frozen
rate. `debt_*` reuses `Money.openDebts()` rather than a second SQL copy. `sizes` (top two per family,
in SQL) and `visits` ride on the row. `historyFor` goes through the existing `scrubCost` — the first
time the nested-`items` case was load-bearing. `normPhone` / `foldName` (Arabic diacritics, tatweel,
alef/ta-marbuta/ya forms; local `0933…` ↔ `+963 933…`) with a browser twin in `js/data.js` and a
nineteen-row parity table. `daysSince(null)` became `null` instead of the epoch — thirteen callers
were treating a customer who had never bought as twenty thousand days overdue. `DB.customer()` moved
onto an index (0.2 ms for 5,000 lookups, was 136 ms).

**B — the list and the drawer.** `totalSpent` deleted everywhere; two spend figures on the card,
five sort orders, search through `foldName` and `normPhone` with folded forms cached on the row.
**The grid caps at 60 cards** (`CUST_RENDER_CAP`) — and that cap created a hazard the same day:
`Bulk.visibleIds` selected from the whole filtered list, so one tick box put 5,000 invisible
customers a click from Archive. `customerRowsShown()` is what both the grid and `js/bulk.js` read,
and they are a pair. The drawer fetches `GET /api/customers/:id/history` (the first `js/` caller;
`js/api.js` is still the only file on the network) and shows every lira sale with **its own frozen
rate** underneath. `fmtDate(null)` stopped printing `1 Jan 1970`. Eight literal `90`s — one of them
Arabic prose — became `DB.atRiskDays()`.

**C — the screen.** Card states drawn as three different things: `.quiet` is amber (a nudge),
`.fresh` is a neutral dashed border (never-bought is a sale that has not closed yet, not a warning),
ordinary gets nothing. Seven empty states, one per filter. **The return rhythm** is per customer,
computed on the server beside `sizes`: the **median** gap between purchases (not the mean — one order
two years before the rest drags a mean), `null` below three purchases, quiet after `median × 1.5`
floored at 21 days, falling back to `customer.at_risk_days`. Under one flat 180-day rule a regular
at 70 days was fine and a rare buyer at 200 days was at risk; both answers were wrong. The profile
page is a second routing layer, `#customers/<id>` (`parseHash` / `hashFor` / `applyRouteParam`),
with a timeline where every source is one mapper into `{ at, kind, title, sub, tone, act, id, lead }`.
An unknown id and a forbidden id draw the same "no such customer" panel, deliberately. The edit form
(five fields) warns on a phone change through `phoneHolder`'s `exceptId`. A driver's customer list is
scoped **in SQL by role** to the run he is carrying, with a narrower SELECT that never computes spend
or debt; his history request gets 404, not 403. `sendErrorDetail()` was added because `sendError`'s
fifth argument is HTTP headers and four routes were sending `maxPct`, `ceiling`, `available` there —
the browser never saw them.

*C follow-ups:* `POS.saleOpen()` (a basket with a line) guards `#open/customer/<id>` so a link
mid-sale opens the drawer over the till instead of navigating; `029` makes the multiplier
(`customer.quiet_multiplier_tenths`, tenths not a decimal because "1,5" is a real thing somebody
types) and floor (`customer.quiet_floor_days`) config; index `sales_customer_at (customer_id, at)`;
a driver's absent money hydrates to `null`, not a confident `0` (`amountOrNull`, `nfOrDash`);
phone-width render at a true 390 px found the bulk tick box sitting on the tier badge.

**D — loyalty** (`030`, `031`, `server/lib/loyalty.js`). `030` drops `sales_customer`, a strict
subset of the composite; `sales_at` cannot be dropped the same way because `at` is not its leading
column, and the migration says so. The Customers screen leaves a driver's navigation by a
`navAllowed` rule, not a permission change. **Stamps are derived, never stored**: `SUM(qty)` over
non-voided sales minus `SUM(stamps_used)` from `loyalty_redemptions`. The first version — "items
since the last redemption" — could not express carry-over and gave two answers to one question;
subtracting what was used depends on no timestamps. A full card is a **state with a button**, not an
automatic reward: the person at the counter records what was actually handed over, in free text, and
the rule (`required_then`) is frozen onto the redemption row like `sales.fx_rate`. The bell alert is
keyed `stamps:<id>`; the Customers filter reads those keys rather than counting again. Voiding a sale
now reverses its points inside the void's transaction, **clamped at zero** rather than refused — the
goods are back on the shelf either way — and it is a config key (`loyalty.void_reverses_points`)
because a shop could reasonably disagree. The 500-point redeem block became `loyalty.redeem_block`.
The loyalty fold in Settings finally saves, through one debounced writer keyed per config key, and
only then was `loyalty.*` opened in `CONFIG_WRITABLE`.

**E — the connections** (`032`). An invoice's customer name opens the profile, or offers to attach
one. A product size says how many customers wear it and opens the list filtered to them. A delivery
shows who, and whether a parcel to them has come back before — derived from the board, never stored,
because a stored "has failed deliveries" outlives its reason. **`Sales.attachCustomer`** is the first
`UPDATE sales` beyond the void flag: the sale gains the customer, earns its points **at the rate
stored on the sale**, writes `points_earned` onto the row, and stamps follow with no code at all. A
cashier may fix a sale in her own open shift; older is the manager's (`void` permission — the first
attempt gated on `sale.void`, a name that does not exist, and failed silently). Moving a sale from
one customer to another is refused. `print_jobs.customer_id` is backfilled **only where a `sale_id`
proves it** — never matched on name or phone. On the way, a live leak: `GET /api/partner` stripped
`price` and nothing else, so every print job carried the shop's customer name and phone to Yalla
Wear on every poll; the strip list is now the one `FORBIDDEN` implies. **The wants list is captured
without a habit**: a size looked up at the till while out of stock everywhere, with a customer on the
basket, is the record; the server drops a same-day repeat and a size that is on the shelf.

**F — money, server half then browser half** (`033`, `034`). `loyalty_redemptions` (append-only)
and `wants` (cursor-shaped, because a want is edited when answered) joined the mirror. `permcheck.js`
scans every `requirePerm`/`can` literal at boot and **stops the server** on a name that does not
exist, unlike preflight and the hardware check, because the direction that failure fails is open.
The full-card bell caps at five names plus a summary keyed on the total — and proving it found that
the bell's own `slice(0, 8)` would have cut the summary row. `Money.debtsForCustomer` returns open
debts oldest first with what each was worth **then** and **now**. `debt.collect` is a permission a
cashier holds without `money.read`, and it is listed **by name** in `FORBIDDEN` because the partner
ban was `startsWith('money.')`. A credit sale to nobody is refused (`credit_needs_customer`); the
`no_credit` flag refuses; the limit **warns and lets it through** (`over_credit_limit` rides back on
the sale) — a till that refuses a regular on a Thursday teaches cashiers to stop attaching customers.
**Merge**: the user picks the survivor; sales, jobs, points (added, not max), the stricter credit
rule and the lower limit move across in one transaction, the loser is archived with `merged_into`,
one `logChange` per repointed row — and the ids are captured *before* the UPDATE, because reading
them after logged the survivor's whole history as "merged from". Browser half: the debt panel with
Take payment (the `opId` is minted before the send, asserted against the source), credit fields in
the edit form (blank is `null`, not 0), the over-limit warning at the till (amber, nine seconds —
nothing went wrong), the merge picker over likely duplicates with a confirm that names what moves,
the wants tab in the warehouse (green when the size has landed), the job-link control, and
`custSearch()` — the "which customer does this text mean" rule, which had been written three times.

**G — the cap family, and the card.** `server/lib/capped.js`: every capped reader returns
`{ rows, shown, total, capped }` with `capped = total > shown` (never `shown === limit`), and
`cappedNote` / `cappedCount` say so on screen. A sweep of 116 caps across `js/` and `server/`: seven
were deriving a number from the truncated set — `DB.sales` feeding the dashboard, movements feeding
the reports, the history badge, the wants badge, failed-delivery counts, the sales export's own
totals row, and the inbox whose badge said 20 while the panel listed 14. Duplicate wants fold on
merge (earliest ask, any answer, the DELETE logged). **The loyalty card**: `CU-` + zero-padded id,
derived, nothing stored; resolved **first** in `resolveScan` so no looser parser can shadow it; at
the till with a sale open it **attaches and does not move**, with an empty basket it opens the
profile. **Printing the card is held** — see open items.

**Polish.** Nine defects found by rendering and looking: phone numbers wrapping mid-number (the
tier badge was stealing the row), `· In-store` with no city, lower-case initials, uneven card
heights, a 204-row timeline (now 40 with "show older"), a bare `?` lead, and the count badge reading
`4 / 3` in Arabic — unisolated, so RTL reordered it into a wrong number. `<bdi dir="ltr">`.

**Dashboard.** Built in the same run; documented in full in `CLAUDE.md` ("The dashboard", "The
bell", "The admin Reports screen").

---

## How it was proved

The same rig every stage, worth keeping because it is the one that does not touch the shop:

- A **throwaway copy** of `og.db` taken with `node:sqlite`'s online `backup()` from a read-only
  connection; `createApp()` on port 8099 with `OG_SYNC_MINUTES=0` and `OG_DB=<copy>`, so nothing a
  test did could reach the shop's data or the mirror. Every test identity synthetic, and the rig
  first proved no real customer held one of its numbers.
- **Headless Chrome against the repo's real `js/` and `css/`** over that server, with real `fetch`
  and the real `HttpOnly` cookie — no stubs, no iframe (the server sends `X-Frame-Options: DENY`).
- The live database verified read-only afterwards, every time: row counts, no `Stage X%` rows.

Three traps the rig fell into, recorded so nobody falls in again:

- **`--virtual-time-budget` makes `performance.now()` virtual** — every timing read `0.0 ms`. A
  timing proof is a second Chrome run without the flag.
- **Headless Chrome will not go narrower than ~500 px** via `--window-size`; only the screenshot is
  cropped. A real phone width needs `Emulation.setDeviceMetricsOverride` over the DevTools protocol
  *and* the page's real `<meta name="viewport">`, or the media queries never fire.
- **A harness that renders into `#app`** is rendering into the shell's sidebar grid. The screenshot
  showed it; the assertions did not.

Also true then and worth knowing: a check that cannot go red is not a check. `permcheck.js` was
proved by reintroducing `sale.void` and watching it refuse; the bell cap by pushing twelve cards.

---

## Still open

Each of these is a real gap named by the stage that found it. None is started unless `CLAUDE.md`
says otherwise.

**Held on a measurement.** The **printed loyalty card** is not built. Four places disagree about
the label roll — `config.label.default_preset` says `30x30`, `labels60.js` is built around 60 × 40,
and template row 8 is literally named "unconfirmed roll size". The ruler sheet (Settings → hardware)
now prints corner marks at the edges of the sticker the app believes in; somebody in the shop has to
say whether they line up. A 60 × 40 layout on a 30 × 30 roll is clipped; the other way wastes half
the roll. The card's content is settled (name through `nm()`, `CU-…` as Code 128, the mark) and
Arabic will go through the raster path that already exists.

**A lint for the cap family.** The same mistake was found five times — lira added to dollars,
select-all past the render cap, the bell's cut summary, seven readers in the sweep, the timeline.
`cappedNote` is per screen, not automatic: a screen added later that sums `DB.sales` is silently
wrong again. "Any file that reads `DB.sales` and calls `.reduce` must also call `cappedNote`" is the
same shape as `permcheck.js` and is not written. **The one to do first.**

**Merge.** Not undoable (`merged_into` makes it possible to write; nothing writes it, and spent
points cannot be un-added). Pairwise only — three spellings of one name is two merges. The confirm is
built from browser state that could be stale under a second till. Nothing surfaces "these two are
probably one person" without somebody already suspecting it — a nightly `foldName` + `normPhone`
collision pass shown as a bell alert would.

**Credit.** The limit is USD by convention with no currency column; a second currency needs a
column, not a comment. `sale.warning` is read only by the POS — there is no other credit path today.
A shop that thinks in lira converts in its head to set it.

**Wants.** The tab has no "only what has landed" chip — at forty rows you scan for green. The
duplicate fold runs only on merge. Capture is at the till only, deliberately: a want with nobody to
tell is noise.

**Loyalty.** `min_minor` is tested against the sale total, not the line, so a pair of socks on a
shoe earns two stamps. Switching `loyalty.mode` to `off` while people hold full cards hides the
alerts without a word (the redemptions survive). `stamps_used` may exceed the rule — deliberate, to
honour a short card, but it can consume a whole future card. Nothing prints a stamp count on the
receipt. `applied_ops` has no uniqueness per *kind* — every caller prefixes its `opId`, nothing
enforces it.

**Rhythm.** The median lags a customer who is speeding up; a median over the last *n* gaps would
track it at the cost of noise.

**Notes and contact.** `customers.note` is one overwritable string — the last editor silently erases
the previous one; dated append-only notes are one small table and the timeline already draws new
kinds. A per-customer "do not contact" flag is one column and two checks, but it is a promise the
shop has to keep, so it is the owner's decision. WhatsApp templates for "your size is in", "your
card is full", "you owe X" — three messages sent by hand today from screens that already know who.

**A customer's own page.** Read-only, at `/c/<token>` in the shape of the `/i/` receipt token —
points, stamp card, what they are waiting for. The token machinery exists.

**Small and known.** `whoCell` counts failed deliveries over whatever the board holds. A driver's
narrow row is honest but shallow in the safe direction. `Deliveries.driverDay` keys the day on UTC
`assigned_at`, contradicting "the browser owns the day". The dashboard refetches on every
`Shop.write()`.
