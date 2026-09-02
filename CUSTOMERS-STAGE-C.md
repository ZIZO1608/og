# CUSTOMERS-STAGE-C.md — the screen

Stage C: the two safety fixes, the list, the per-customer rhythm, the profile page and the edit
form, **plus the five follow-ups from §10** (a second report section at the end).

**121 checks pass** — 29 server-side, 92 browser-side — plus three Arabic RTL screenshots and two
phone-width renders at a true 390px viewport. Stage D has not been started.

**Preconditions (§0).** Both held at the start: `git status` was clean at `4d80048` (Stage B), and
the server on :8090 had been restarted at 02:23 local, after Stage B's last server edit at 01:34,
so it was running Stage B's code.

**Two things happened during the stage that you should know about.**

1. **Stage C was committed and pushed while I was still verifying it.** At 02:53 local, `push.bat`
   committed all sixteen files as `821f473 "Update"` and pushed to `origin/main` — so CI has built
   and published it. I did not run it, and this document's rule is "never run `push.bat`, commit, or
   deploy". Everything in that commit is the code that subsequently passed all 85 checks, so nothing
   wrong shipped; but it shipped before it had been proved, and the Arabic screenshots came after.
2. **The server on :8090 is now stopped** (it was running at the start of the stage). Whatever
   restarts it will pick up the Stage C server code. Until something does, there is no shop server
   running at all.

**Owner decisions from §0** — all five implemented, all five proved:

| Question | Answer | Where |
|---|---|---|
| Archived holder | Warn, and say they are archived | Stage B; still true, now on the 200 path (§C0a) |
| `visits` | Server's non-voided sale count | Stage B; unchanged |
| `loyalty.mode` | `points` | Read by `pointsMode()`; tier and Gold chip hide in the other modes |
| `customer.at_risk_days` in Settings | Yes | Stage B fold; still the fallback for anyone without a rhythm |
| Customer #81's phone | Do not modify | Never read, never written |

**Method.** Unchanged from Stage B: a throwaway copy of the shop database via `node:sqlite`'s online
`backup()` from a read-only connection, `createApp()` on port 8099 with `OG_SYNC_MINUTES=0` and
`OG_DB=<copy>`, real HTTP with real `HttpOnly` cookies, and headless Chrome 152 loading the repo's
**real** `js/` and `css/` over that same server. The live database was verified untouched
afterwards: customers 2, sales 13, users 5, deliveries 4, and **zero** rows matching `Stage C%`,
`stagec%` or `INV-8%`. The one write to it is migration **029** (F2/F3 below), applied through the
server's own `DB.open()` — schema_migrations went 28 → 29, and the data is untouched. Personal
data is redacted; every test identity is synthetic.

---

## C0a. `phone_taken` is a 200 with a warning

`create()` no longer throws. It returns `{ customer, warning }`, and the route sends both.

```json
{
 "ok": true,
 "customer": { "id": 89, "name": "Stage C Dup", "phone": "0955 800 111", … },
 "warning": {
  "code": "phone_taken",
  "message": "That number already belongs to Stage C Regular (#83). Stage C Dup was saved anyway.",
  "existing": { "id": 83, "name": "Stage C Regular", "archived": false }
 }
}
```
```
PASS C0a. status is 200, NOT 409 — the row was created  → 200
PASS C0a. ok:true with the created customer
PASS C0a. warning names the existing holder  → {"id":83,"name":"Stage C Regular","archived":false}
PASS C0a. a clean create carries warning:null  → null
PASS C0a. exactly one row was created (a 409 retry would have made two)
```

**No customer path returns 409 any more.** The `phone_taken` branch in the POST handler is gone
entirely, and `grep -rn "phone_taken" server/` now finds it in exactly two places: the lines in
`create()` and `update()` that build the warning. (`server/index.js` still contains plenty of 409s — stock
conflicts, shelf conflicts, partner stage rules, points — but every one of those is a genuine "the
request did not happen", which is what the status means. None of them are on a path that has already
written a row.)

`Shop.write()`'s fourth `fail` argument is **removed**. I checked every call site first with a
paren-matching scan that ignores strings and comments: fifteen calls, and `cu-save` was the only one
passing four.

```
PASS C0a: Shop.write no longer carries the fourth `fail` argument
PASS C0a: the customer is on screen with no manual reload  → 91
PASS C0a: the warning still names the holder  → Saved — but Stage C Regular already has this number
PASS C0a: …and still offers Open
```

**`DB.attachCustomer()` was deleted too.** Stage B added it for exactly one caller — the 409 path,
which had to put a row on screen before the reload. On the 200 path `Shop.write` reloads *before*
`done` runs, so the customer is already hydrated and the helper had no callers left. `mapCustomer()`
stays; it is still what `hydrate()` uses.

## C0b. The driver no longer receives the shop's debt book

Scoped in the SQL by **role**, the same rule and the same reasoning as `scope()` in
`server/lib/deliveries.js`. A driver gets customers on a run he is actually carrying
(`status IN ('waiting','out')`), through `deliveries → sales → customer_id`, and a narrower SELECT
that never computes spend or debt at all — not stripped afterwards, never selected.

The whole payload a driver receives:

```json
{ "ok": true, "customers": [ {
  "id": 87, "name": "Stage C Dropoff", "phone": "+963 955 800 555", "city": "Aleppo",
  "source": "in-store", "address": null, "archived": 0,
  "created_at": "…", "updated_at": "…"
} ] }
```

Side by side:

```
driver keys : address archived city created_at id name phone source updated_at
cashier keys: address archived city created_at debt_syp debt_usd demo id last_purchase_at
              loyalty_points median_gap_days name note open_debts phone sizes source
              spent_syp spent_usd spent_usd_equiv updated_at visits
```
```
PASS C0b. driver sees ONLY the customer on his run  → [87]
PASS C0b. …while the manager sees the whole shop  → 10
PASS C0b. driver payload carries NO debt or spend field at all
PASS C0b. …a cashier still gets them (she has to take payments)
PASS C0b. driver asking for a history gets 404, not 403  → 404
PASS C0b. …even for the customer on his own run  → 404
PASS C0b: the driver hydrates ONE customer — the one on his run  → 1
PASS C0b: no money reaches the driver — and absent reads as null, not a confident 0
PASS C0b: …but he still gets who and how to reach them  → +963 955 800 555
```

**I closed the history route to drivers as well**, which the prompt did not ask for. It is the same
leak by another door: `GET /api/customers/:id/history` needs only `customer.read`, and it returns
what somebody bought, when, for how much, with the frozen rate — the shop's sales data, on a phone,
out on a run. 404 rather than 403, so it cannot be used to probe which customers exist.

Archived customers **are** included in a driver's list: somebody archived after the parcel was
assigned still has to receive it.

## C0c. The four detail objects reach the browser

`sendError`'s fifth argument is HTTP headers and has to stay that way — the 405 handler sends a real
`Allow` header through it. So the four routes moved to a new `sendErrorDetail()` in
`server/lib/http.js`, which spreads the detail into the **body**, where `js/api.js` already reads it:
`throw ApiError(code, msg, res.status, data)` sets `e.detail` to the whole parsed body, so
`err.detail.maxPct` now resolves.

```json
{
 "ok": false,
 "code": "discount_too_big",
 "error": "Discounts above 10% need a manager. The most you can take off this sale is 990 (you asked for 2475).",
 "maxPct": 10,
 "ceiling": 990
}
```
```
PASS C0c. discount_too_big  → "403 discount_too_big"
PASS C0c. maxPct is in the BODY, where js/api.js reads it as err.detail.maxPct  → {"maxPct":10,"ceiling":990}
```

`insufficient_stock` was passing a literal `{}` — the shape was right, the destination was not — and
now carries `available` and `sku`.

## C1. The list

Card order, which is the reading order: **name** (through `nm()`) → **tier**, only when
`loyalty.mode` includes points → **size chips** → **last in** → **the two spend figures** → a **debt
chip only when there is one**. Verified from the rendered DOM:

```
card reading order: Stage C Regular → SIZES → Last in → Total spent
```

**Three states, drawn as three different things.** `.cust-card.quiet` is amber
(`--warning-border` / `--warning-soft`), because being late is a nudge; the old `.risk` was
destructive red on a flat 90 days, which shouted at somebody who simply buys twice a year.
`.cust-card.fresh` is a neutral dashed border — never-bought is a sale that has not closed yet, and
colouring it as a warning blames a person for being new. An ordinary customer gets no class at all.

```
PASS C1: a quiet customer gets .quiet (amber), not .risk (red)
PASS C1: never-bought gets .fresh, neutral — not a warning
PASS C1: an ordinary customer gets no state class at all
PASS C1: the size chip is on the card
PASS C1: names isolated with nm()
```

**Four empty states**, all `.card > .cart-empty` with a bold line and a sub-line — the nearest thing
this codebase has to a convention (recon §B6), and the Customers screen previously had *none*: a
search matching nobody drew an empty grid and a `0 / N` badge. Written as invitations:

```
nobody wears that size: "Nobody on file wears 99" / "Sizes come from what people have actually
   bought, so a new size shows up after its first sale."  + [Show everyone]
nothing matches this search: "No one by that name or number" / "Arabic and Latin spellings both
   match, and a phone matches in any format. If they are genuinely new, add them."  + [+ New customer]
nobody owes anything: "Nobody owes you anything" / "Credit sales appear here until they are paid off."
nothing archived: "Nothing archived" / "Archived customers keep all their invoices — they are only
   hidden from the list."
```

There are three more for the cases that exist but the prompt did not list — no customers at all, no
gold customers, and the quiet filter when everybody is on schedule — because a screen that has an
empty state for four of its seven filters and a blank grid for the other three is worse than one
that has none.

**Chips and tabs**: `.chip-row` / `.chip` throughout, `.seg` nowhere. Two new filters — **Owes
money** and a **size chip** that only appears while a size filter is set (the `.chip-x` shape the
Yalla date filter uses), the latter being what Stage E's "who wears this size" link will set.

**The 60-cap and its `customerRowsShown()` / `js/bulk.js` pairing are untouched**, still verified
together in Stage B's suite.

## C2. Per-customer return rhythm

**Decision: computed on the server, in the customer query, beside `sizes`.** The alternative —
compute it in the profile only — would have left the *list* judging everybody by one shop-wide
number, and the list is where C1's three states are drawn. A "quiet" badge that meant "past 180
days" while the profile said "past their own 45" would be two answers to one question on two screens.

It is not computed in the browser, for the reason the prompt gives: `DB.sales` is the shop's last 200
sales, so the same customer would get a different rhythm on a machine that had been open longer.

`rhythmByCustomer()` walks non-voided sales ordered by customer and date, takes consecutive gaps in
days, and returns the **median** — not the mean, because one order placed two years before the rest
drags a mean far enough to make a regular look occasional. Two sales in one visit are one visit
(gaps under half a day are dropped). Below three purchases it returns nothing and the row carries
`median_gap_days: null` — never `0`, which would read as "comes in every day".

`DB.quietAfter(c)` is `median × 1.5`, floored at 21 days, falling back to `CONFIG.AT_RISK_DAYS`.
The 1.5 is because a regular is not late the day after their usual gap; the floor is so somebody who
pops in twice a week does not turn amber by Thursday.

**Worked example — a customer with six purchases**, 70 / 100 / 130 / 160 / 190 / 220 days ago:

```
sales_at:         2026-01-25  2026-02-24  2026-03-26  2026-04-25  2026-05-25  2026-06-24
gaps (days):      30, 30, 30, 30, 30      → sorted, median = 30
median_gap_days:  30
quiet after:      max(21, round(30 × 1.5)) = 45
days since:       70   → 70 ≥ 45  → QUIET
```
```
PASS C2. Regular: median gap 30 days  → 30
PASS C2. Rare: median gap 180 days  → 180
PASS C2. Twice (two purchases, one gap): null — not a rhythm  → null
PASS C2. Never bought: null
PASS C2: Regular quiet after 45 d (median 30 × 1.5)  → 45
PASS C2: Rare quiet after 270 d (median 180 × 1.5)  → 270
PASS C2: no rhythm falls back to CONFIG.AT_RISK_DAYS  → 180
PASS C2: Regular (70 d away, rhythm 30) IS quiet
PASS C2: Rare (200 d away, rhythm 180) is NOT quiet
PASS C2: never bought is "new", not quiet
```

> THE POINT: under one flat 180-day rule, Rare (200 d) would be at risk and Regular (70 d) would
> not. Both answers were wrong.

The dashboard bell and the customers export moved onto `DB.quietCustomers()` as well — **they had
to**, because the bell row navigates to the At-risk chip, and a count that disagrees with the list it
opens is worse than no count. Its wording changed with it: it used to say "N customers haven't
purchased in 90 days", which after Stage B printed the config number and after Stage C would have
been true of nobody in particular.

## C3. The profile page

**A second routing layer**, `#customers/<id>`. `parseHash()` splits on the first slash only;
`hashFor()` builds the address back; `applyRouteParam()` is the single place a route parameter is
kept (`OG.viewParam`, plus `OG.custId` for this screen). `go(view, pending, param)` takes a third
argument; `boot()` and the `hashchange` handler both parse instead of stripping `#`.

**Every hash without a slash behaves exactly as before** — asserted against the real shipped file,
not a copy:

```
PASS every slash-less hash parses to { view, param:null } as before  → all 12 ok
PASS an empty hash is empty, not a view
PASS parseHash("#customers/81")  → {"view":"customers","param":"81"}
PASS a percent-encoded param is decoded  → م
PASS only the FIRST slash splits  → a/b
PASS hashFor round-trips  → #customers/81 / #customers
```

The four decisions, each with the reasoning in a comment at the code:

- **Back goes to the list**, not to the previous screen. `cu-list` calls `go('customers', null,
  null)`. Somebody arriving from the bell, a scan or a pasted link wants the customers screen, not
  the dashboard they happened to be on. Browser Back still walks the history it actually has, and
  the two are allowed to differ — but the `hashchange` handler now compares the **parameter as well
  as the view**, so browser Back out of a profile actually leaves it. Comparing only the view id
  (which is what the old handler did) would have made Back do nothing at all.
- **A refresh on `#customers/81` lands on that profile.** `boot()` parses the hash rather than
  reading the whole string as a view id, which would have looked up `customers/81` in `VIEWS`,
  missed, and dropped somebody on the dashboard.
- **An unknown id** draws a "No such customer" panel with a way back — not a blank page.
- **A forbidden id is indistinguishable from an unknown one**, deliberately: `byId` returns null for
  a customer outside a driver's run, and the page says the same thing either way. Saying "not
  allowed" would confirm the person exists to somebody who may not know that. `navAllowed` still
  bounces anyone without `customer.read` off the screen entirely, and a bounce clears the parameter
  so a redirected screen never keeps somebody's record open.

```
PASS C3: the hash is the address  → #customers/83
PASS C3: OG.custId parsed
PASS C3: a refresh on #customers/<id> lands on that profile
PASS C3: Back from a profile lands on the list  → #customers
PASS C3: an unknown id draws "no such customer", not a blank page
PASS C3: …and still offers the way back
PASS C3: #open/customer/<id> routes to the profile
```

`#open/customer/<id>` now opens the page. **It still navigates away, which is wrong at the till** —
a scanned loyalty card mid-sale should drop the customer into the basket, not take the cashier off
the screen. That is Stage G's and is marked as such in the code.

**The drawer stays**, unchanged in purpose, with an **Open the full record** button added. It is
still what `open-customer` does everywhere except the customers list itself, where a card now opens
the page — nobody is mid-sale on that screen, so the drawer's reason to exist does not apply there.

**The timeline is the page.** One chronological stream, newest first, built so a new row *kind* is
one mapper: every source maps into `{ at, kind, title, sub, tone, act, id, lead }` and
`timelineHTML` draws them. Today: purchases, points earned, points spent, deliveries. Stages D, E
and G add stamps, messages and print jobs by adding a mapper, not a column.

Rows come from `GET /api/customers/:id/history` — which now also carries the customer's deliveries,
so the whole timeline is one request. Deliveries are `null` (not `[]`) for an account without
`delivery.read`: an empty array would claim there are none, which is a different statement from
"not yours to see". Nothing is built from `DB.sales`.

```
PASS C3: the timeline has a row per purchase  → 12
PASS C3. history carries the customer deliveries for the timeline  → 1
PASS C3. …and null (not []) for an account without delivery.read  → null
```

**Panels**: what they buy (server sizes, with **drift flagged** when the recent sizes differ from the
older ones — "They used to buy 42 and now buy 43 — either their size changed, or they are buying for
somebody else"), money, points, rhythm, and **note and address, displayed for the first time**.

> **Flagged, not silently widened:** `customers.note` has **no permission of its own**. It has been
> stored since the beginning and never drawn, so nobody had to think about it. From Stage C, anyone
> with `customer.read` — which includes every cashier — sees it on the profile and can edit it. The
> edit form says so on its face ("The note is visible to anyone who can see customers"), but if the
> shop wants a private note field that is a `note.read` permission and a separate column, and it is
> not built.

## C4. Edit

There was no way to change a customer's name, phone or address anywhere in the system. There is now:
name, phone, city, **address, note** — the same modal shape as `openNewCustomer`, deliberately five
fields rather than three because this one is not filled in with somebody waiting at the counter.

**A phone change gets the same duplicate warning as a create**, through the `exceptId` argument
`phoneHolder` has taken since Stage A and nobody had ever passed:

```json
{ "ok": true,
  "customer": { "id": 86, … },
  "warning": { "code": "phone_taken",
               "message": "That number already belongs to Stage C Rare (#84).",
               "existing": { "id": 84, "name": "Stage C Rare", "archived": false } } }
```
```
PASS C4. the edit saved AND warned, naming the holder  → {"id":84,"name":"Stage C Rare","archived":false}
PASS C4. an edit that does not touch the phone does not warn  → null
PASS C4. re-saving the SAME number does not warn about the customer themselves  → null
PASS C4: the edit form carries all five fields
PASS C4: moving a phone onto an existing number warns, naming the holder
PASS C4: …and offers to open them
   the note and address are now stored AND drawn: "prefers 44"
```

**Archive one customer** from the profile, behind a confirm that says what archiving does. It
existed only as a bulk action, so putting one person away meant ticking a box and using the
selection bar — the tool for forty, not for one. It returns to the list afterwards, because the page
you were reading is now about somebody the list no longer shows.

## Arabic, RTL

Three screenshots, in `scratchpad/`: `ar-list.png`, `ar-profile.png` (a never-bought customer, so
every empty state is visible) and `ar-profile-full.png` (a full timeline).

Nobody had looked at this screen in Arabic before. What they show:

- The grid flows right-to-left — first card top-**right** — chips run right-to-left, the count badge
  sits far left, and the page head is right-aligned.
- **Mixed script does not reorder.** "Stage C Regular" as a Latin name inside an RTL layout, and
  `+963 955 800 666` beside Arabic text, both read correctly. That is `nm()` and `tel()` doing the
  job they were added for.
- The quiet card is amber with **انقطع** and **إرسال واتساب**; never-bought cards are dashed with
  **ما اشترى بعد** and a spend of **—**.
- The timeline's rail is on the **right** (`border-inline-start` resolves correctly), sale rows and
  points rows alternate, and the dates are Arabic month names.
- The rhythm reads **كل 30 يوم** with **بيعتبر منقطع بعد 45 يوم** underneath.
- No English leaked in, and no `1970` anywhere.

One thing the screenshots caught that assertions had not: my **test harness** was rendering into
`#app`, which `css/shell.css` defines as the shell's sidebar grid, so the whole list drew inside a
272px sidebar column. The app itself was fine — the harness was wrong — but it is exactly the sort
of thing only a picture shows, and it is why the check that cannot be written as an assertion is
worth taking.

## Counts, cache

```
I18N.en 994 keys · I18N.ar 994 keys · equal true, no key missing on either side
CACHE = 'og-system-v87'
```

No new JS file, so the precache list is unchanged — everything added lives in files already on it.
One new CSS rule block went into `css/dialogs-customers-jobs.css`, which is already precached.

---

---

# Stage C follow-ups — the five items from §10

Done after the report above, before Stage D. Everything below is re-verified together:
**29 server checks + 92 browser checks, all passing**, plus phone-width renders at a true 390px
viewport. `CACHE` is now **`og-system-v88`**.

Two decisions you settled, recorded here because Stage E has to honour them:

- **`customers.note` stays visible to anyone with `customer.read`**, and the edit form saying so on
  its face is the handling. No private note field, no `note.read` permission.
- **`sales.customer_name` stays frozen on old invoices** — a receipt is a record of that moment.
  **Stage E's E2 must match**: when a customer is attached to a sale after the fact, the
  denormalised name on that sale is *not* rewritten.

## F1. The till guard — taken now, not in Stage G

`POS.saleOpen()` is new and is the whole test: `S.cart.length > 0`. A customer picked or a discount
typed into an empty basket is a keystroke somebody can repeat; a basket of scanned shoes is a queue
at the counter.

`handleDeepLink`'s `customer` case now checks `OG.view === 'pos' && POS.saleOpen()` and, when both
hold, opens the drawer over the sale exactly as it did before Stage C — **and puts the hash back to
`#pos`**, because only `go()` rewrites it and a pasted link would otherwise leave the address bar
reading `#open/customer/81` while the till is on screen.

```
PASS F1: POS.saleOpen() exists
PASS F1: an empty basket is not an open sale
PASS F1: away from the till, a customer link opens the PROFILE  → #customers/83
PASS F1: on the POS with an EMPTY basket it still navigates
PASS F1: a basket with a line IS an open sale
PASS F1: mid-sale the till does NOT navigate away  → pos
PASS F1: …and no customer page was opened underneath  → null
PASS F1: …the drawer opened over the sale instead
PASS F1: …showing the right person
PASS F1: …and the address bar still says #pos  → #pos
PASS F1: …with Open profile still available for anyone who does want to leave
```

Tested against the **real** `js/pos.js` loaded into the harness, with a real line pushed into
`POS.state.cart` — not a stubbed POS, so `saleOpen()` under test is the shipped function.

Stage G still has work here: a scanned loyalty card should *attach* the customer to the basket
rather than show a drawer. This guard is what that will hang on.

## F2. The multiplier and the floor are config

Migration **029** adds `customer.quiet_multiplier_tenths` (15) and `customer.quiet_floor_days` (21)
beside `customer.at_risk_days`. `CONFIG_WRITABLE` already opens `^customer\.`, so Settings reaches
them with no further change.

**Tenths, not a decimal.** `1.5` in a TEXT config column round-trips through `parseFloat` on every
read and through whoever types it — and "1,5" is a real thing somebody types, which `parseFloat`
silently reads as 1. The same reasoning money is in minor units.

`DB.quietMultiplier()` and `DB.quietFloorDays()` read them, with the old literals kept as the
fallback for a database that has never heard of the keys.

Proved by changing the value **on the server** and reloading, not by poking `CONFIG`:

```
PASS F2: both numbers hydrated from config  → 15 / 21
PASS F2: tenths → 1.5, floor 21  → 1.5 / 21
PASS F2: Regular still quiet after 45 d  → 45
PASS F2: a changed multiplier reaches the browser  → 30
PASS F2: at ×3.0 the 70-day regular is NO LONGER quiet (30 × 3 = 90)  → 90 / ok
PASS F2: with ×0.1 the FLOOR is what decides — 60, not 3  → 60
PASS F2: put back  → 45
PASS 029. a manager can change the multiplier through PUT /api/config  → 200
```

## F3. The index on `sales(customer_id, at)`

Also in migration 029. It is the index both halves of the customer query want — sizes and rhythm
both group by customer and order by date within one.

```
query plan (rhythm): SEARCH sales USING INDEX sales_customer_at (customer_id>?)
PASS 029. the index exists  → CREATE INDEX sales_customer_at ON sales (customer_id, at)
PASS 029. the rhythm query actually uses the index
```

No `USE TEMP B-TREE FOR ORDER BY` in that plan — the ordering inside each customer comes free,
which is the half that mattered.

**One thing I found and did not act on.** `001_init.sql:222` already creates
`sales_customer ON sales (customer_id)`. A composite index whose leading column is `customer_id`
serves every lookup that one served, so `sales_customer` is now **redundant** and costs a write on
every sale for nothing. Dropping it is one line — `DROP INDEX sales_customer;` — but it is an
object from migration 001 that other queries may be planned around, and removing it was not part of
this ask. Flagged, not taken.

## F4. A driver's absent money is `null`, not `0`

`mapCustomer` now runs every aggregate through `amountOrNull()`: absent stays absent, and a real
zero stays `0`. Zero and null are separately meaningful — 0 is a customer who genuinely owes
nothing, null is a question this account cannot ask.

**This is reachable in practice, not theory:** `NAV_PERM.customers` is `customer.read`, which a
driver holds, so he can open the Customers screen. Before this, every card would have shown him a
`Bronze` tier badge computed from `DB.tier(null)` and a confident `0` for visits.

New `nfOrDash()` in `js/app-util.js`, and `showPoints(c)` on the customers screen — a tier badge is
drawn only when the shop runs points **and** we were actually told the balance. Guarded everywhere
a driver can see: card, profile, drawer, palette. The two places that *mutate* these fields
(`js/pos.js`'s optimistic mirror, `js/bulk.js`'s +250 points) got `|| 0` so `null + 5000` can never
become a lifetime total, even though neither is reachable by a driver.

```
PASS F3: spend is NULL, not 0  → [null,null,null]
PASS F3: debt is NULL, not 0  → [null,null,null]
PASS F3: visits and points are NULL too  → [null,null]
PASS F3: nfOrDash keeps a real zero and dashes an absent one  → — / 0
PASS F3: the driver CAN open the customers screen (customer.read is in NAV_PERM)
PASS F3: no tier badge invented from a null balance
PASS F3: no debt chip
PASS F3: no confident zero in the card stats
PASS F3: the driver can open a profile for his own drop
PASS F3: …with no invented tier
   driver profile stats: Total spent—  |  Visits—  |  Last in——  |  Comes in—Needs three purchases to tell
```

## F5. Phone width

**First, a trap worth recording.** Headless Chrome on this machine refuses a window narrower than
about 500px: `--window-size=390` renders the page at **504** and only the *screenshot* is 390 wide.
The first phone render therefore looked like it had four overflowing elements, and it had none —
the picture was just cropped. Two more things had to be right before the measurement meant
anything: the harness needed the real `<meta name="viewport">` (without it, `mobile: true` falls
back to the legacy 980px layout viewport), and the emulation has to come from
`Emulation.setDeviceMetricsOverride` over the DevTools protocol, driven here with Node 22's
built-in `WebSocket` (`scratchpad/phone-shot.mjs`). Only then does `document.documentElement.clientWidth`
actually read 390 and the CSS media queries fire at phone width.

At a true 390px, with every element in `#view` measured against the viewport:

```
--- list at 390px ---        --- profile at 390px ---
viewport 390                 viewport 390
#view      client=390 scroll=390     #view      client=390 scroll=390
.page-head client=362 scroll=362     .page-head client=362 scroll=362
.filters   client=362 scroll=362     .grid      client=362 scroll=362
.chip-row  client=362 scroll=362     .card      client=360 scroll=360
.cust-grid client=362 scroll=362     .cu-tl     client=310 scroll=310
.cust-card client=360 scroll=360
body       client=390 scroll=390     body       client=390 scroll=390
overflow check: nothing in #view is wider than the viewport   (both screens)
```

**Two real defects, both fixed:**

1. **The bulk tick box sat on top of the tier badge.** `.bk-corner` is
   `position:absolute; inset-inline-end:10px`, and the badge is the last thing in `.cc-top` — so
   they occupied the same corner. Visible at every width and worst on a phone; also visible in the
   Arabic desktop screenshot from the report above, where the box overlapped `برونزي`. **Pre-existing
   — not introduced by Stage C** — but on the card I had just rebuilt. `.cc-top` now reserves 24px
   of inline-end padding.
2. **The profile's stat row stacked one per screenful.** `css/bulk-gate-responsive.css` forces
   `.view .grid[style*="minmax"]` to a single column on a phone, and my inline
   `repeat(auto-fit,minmax(150px,1fr))` matched that selector — so the five stats each took a full
   row and the timeline, which is the point of the page, started roughly 900px down. Replaced with
   the shared **`.grid stat-row`** class, which already steps 6 → 3 → 2 across the breakpoints.
   Two-up on a phone now, and the timeline is visible after one short scroll.

Nothing else needed changing: the card grid collapses to one column on its own, `.filters` wraps
the search, the sort select and the chips onto three rows, and neither screen scrolls sideways.

---

## What this prompt got wrong, what the code made me do differently, and what it does not settle

**Citations that had drifted.** Every one verified before use:

| Prompt / report said | Actually |
|---|---|
| `boot()` at `js/app-boot.js:234-246` | `:228-247` |
| `navAllowed()` at `js/app-shell.js:99-110` | `:99-110` — correct |
| `go()` at `js/app-routing.js:259-282` | `:259-282` — correct |
| the four `sendError` detail routes | `server/index.js:694, 702, 710, 714` — correct, and one of the four (`insufficient_stock`) was passing a literal `{}`, not a detail object |
| `handleDeepLink` customer case | `js/app-export.js:258-260` |
| "the drawer, no sizes" at `app-customers-scan.js:135` | moved to `:598` by Stage B |
| `CACHE` at v86 → v87 | correct |

**Things I was told to do that turned out differently, or that I did not do as written:**

1. ~~**Resolved in F1.**~~ **"`#open/customer/<id>` should redirect here"** — done, but it makes the till case *worse* in
   the meantime, not better. Before Stage C a scan mid-sale opened a drawer over the POS; now it
   navigates to a page and the basket screen is gone. The prompt defers the fix to Stage G, and I
   have followed that, but this is a live regression at the till between now and then. If Stage G is
   not next, the one-line guard (refuse to navigate when `OG.view === 'pos'` and a sale is open) is
   worth taking sooner.
2. **The prompt says the card should carry "tier when loyalty mode includes points".** Implementing
   that meant `loyalty.mode` now silently controls the **Gold filter chip** as well — a chip
   filtering on a tier nobody has would be a control that always returns nothing. That is a Stage D
   concern arriving early, and it is why `pointsMode()` exists in a Stage C file.
3. ~~**Resolved in F2/F3.**~~ **"Either add the median to the server's customer query, or compute it in the profile only."**
   Neither option is free: the query now walks every non-voided sale twice per `/api/customers` call
   (once for sizes, once for rhythm). At 13 sales this is nothing; at 50,000 it is two full scans on
   every page load by every account. It wants an index on `sales(customer_id, at)` before the shop
   has real volume, and that is a migration I did not write because inventing indexes for load that
   does not exist yet is its own mistake.
4. **The empty states.** The prompt named four; the screen has seven filter states. Building four
   and leaving three blank would have been worse than either extreme, so there are seven.
5. **`t('by')` was missing from both dictionaries** — a pre-existing bug in the scan sheet's movement
   table, not mine, which rendered as the bare English word "by" inside an Arabic RTL layout. Fixed
   while I was in the file, since the rule is that a missing Arabic key reads as a bug.

**What the code does not settle:**

- **`sales.customer_name` is not rewritten when a customer is renamed.** It is denormalised on
  purpose ("a receipt is a record of that moment"), so an old invoice keeps the old spelling while
  the profile shows the new one. That is defensible and probably right, but nothing in the UI
  explains it, and the first person to notice will file it as a bug. Stage E's E2 asks the same
  question about attaching a customer to a sale; the two answers should match.
- **The rhythm has no opinion about a customer who is speeding up.** Somebody who used to come every
  90 days and now comes every 20 has a median that lags months behind their behaviour. A median over
  the last *n* gaps rather than all of them would track it, at the cost of being noisier.
- ~~**Resolved in F4.**~~ **A driver's narrow customer row hydrates missing money fields to `0`, not to "absent".** Nothing
  on his screens draws them, so it is invisible today — but `Number(undefined) || 0` means a future
  screen that shows a debt would show a driver a confident, wrong zero rather than nothing. The
  honest shape would be `null`.
- **`customers.note` has no gate** — see the flag in §C3.
- ~~**Resolved in F2 — both are config keys now.**~~ **The 1.5 multiplier and the 21-day floor are mine, not the shop's.** They are the two numbers in
  this stage that came from nowhere; both are one-line changes and neither is in config. If the owner
  has a view, they should be config keys before Stage D adds more.
- ~~**Nothing was tested on a phone-width viewport.**~~ **Done** — see F5 above. It found two real
  defects, one of them pre-existing since before Stage C.
