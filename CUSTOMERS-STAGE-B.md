# CUSTOMERS-STAGE-B.md — the list screen and the drawer

Stage B of the Customers rebuild. B1–B7 are done. The loyalty fold was not started, and none of
the four `sendError` header-bug routes were touched.

**Preconditions (§0).**

- **Stage A is committed — but not by me, and not with a clear message.** By the time I ran
  `git add`/`git commit` the tree was already clean: Stage A had been committed as
  **`1a86c1f "Update"`** (author Zaven Jooharian, 2026-09-01 20:06:09 +03), carrying all 18 files
  — the 14 modified, `server/lib/text.js`, `server/migrations/028_customers_foundation.sql`, and
  **both** `.md` reports. That is `push.bat`'s own message. It is already on `origin/main`, so
  giving it the clear message you asked for would mean rewriting pushed history, which I did not
  do on my own judgement. Say the word and I will either amend and force-push, or add an empty
  follow-up commit that describes `1a86c1f` properly.
- **The server on :8090 had been restarted** (pid 19920, started 20:06:19 local) *after* Stage A's
  files were written (19:47–19:48), so it was running Stage A's `customers.js`. **It has not been
  restarted since Stage B's server edits**, so right now it is executing the old
  `server/lib/customers.js` and `server/index.js` again — see §9.

**Owner decisions, as given, and where each landed.**

| Question | Answer | Where |
|---|---|---|
| Archived holder | Still warn, and say they are archived | §1 — `phoneHolder` includes archived rows, `cu_phone_taken_archived` |
| `visits` | Server's non-voided sale count, not `history.length` | §3 — card, drawer and export all read `c.visits` |
| `loyalty.mode` | `points` | §6 — read only; `loyalty.*` stays **closed** in `CONFIG_WRITABLE` |
| `customer.at_risk_days` in Settings | Yes, a manager can change it | §6 — new fold, saved through `PUT /api/config` |
| Customer #81's phone | Do not modify; leave existing data untouched | Nothing read or wrote it; live DB verified untouched (§8) |

**How things were verified.** Every check ran against a throwaway *copy* of the shop database,
taken with `node:sqlite`'s online `backup()` from a read-only connection, served by `createApp()`
on port 8099 with `OG_SYNC_MINUTES=0` and `OG_DB=<copy>` — nothing a test did could reach the
shop's data or the Supabase mirror. The browser half ran in headless Chrome 152 against the repo's
**real** `js/` files (junctioned into a scratch static root, `OG_STATIC=<scratch>`), over that same
server, with real `fetch` and the real `HttpOnly` session cookie — no stubs, no iframe.

**90 checks, all passing:** 21 server-side, 65 browser-side, 4 in a separate real-clock pass.
Logs: `scratchpad/stageB-server.log`, `scratchpad/stageB-browser.log`.

Nothing is committed for Stage B. No `push.bat`, no deploy, no `npm install`. Personal data is
redacted below; every test identity is synthetic (`Stage B …`, `+963 955 700 xxx`), and the rig
first proves no real customer holds one of those numbers.

---

## 1. `cu-save` handles `phone_taken` — the live bug, fixed first

`create()` writes the row, commits, then throws; the route answers **409** with `existing` and
`customer` in the body. `Shop.write()`'s error path toasted and stopped, so the customer just
created stayed off screen until the next full page load.

Three changes:

- **`js/shop.js`** — `write(send, mirror, done, fail)` gained a fourth argument. `fail` returns
  `true` when it has handled the error; anything else falls through to the old toast-and-stop. One
  caller uses it. The default behaviour of every other write is unchanged.
- **`js/data.js`** — new `DB.attachCustomer(row)`, which maps a server row into the live array and
  both indexes. The mapping itself moved into a shared `mapCustomer()` so `hydrate()` and this
  cannot drift apart on the shape.
- **`js/app-actions.js`** — `cu-save`'s `phone_taken` branch: attach the created row from
  `err.detail.customer`, `render()`, raise a **9-second warning** naming the holder from
  `err.detail.existing`, hang an **Open** button on the toast pointing at that holder, hand the
  new customer to the `onCreated` callback (so the POS flow still attaches them to the basket),
  then `Shop.reload()` to true the derived figures up with the server's own read.

The archived case, per your decision. `phoneHolder` in `server/lib/customers.js` no longer skips
archived rows; it orders `archived, id` so a **live holder wins** when both exist, and returns
`archived: true/false`. The message and the toast both say so:

```
That number already belongs to Stage B Archived (#83, archived). Stage B Dup Arch was saved anyway.
```
```
PASS 5. existing is the archived holder, archived:true  → {"id":83,"name":"Stage B Archived","archived":true}
PASS 5. the message says archived
```

The local guard in `cu-save` that fires *before* the request also stopped swallowing this case: it
now skips archived rows (so the server's warning is reached) and compares phones with
`DB.normPhone` instead of its own `replace(/\D/g,'')`, which disagreed with the server about
`0933…` vs `+963 933…`.

**`PATCH /api/customers/:id` was left alone.** Stage B adds no edit form, so there is still no way
to change a phone number in the UI, and per the prompt I did not add the check there. When an edit
form arrives, that route needs the same `phoneHolder` call with `exceptId` set — the function
already takes the argument.

### Proof 1 — a duplicate add, end to end, in the browser

```
PASS DB.attachCustomer maps the 409 body row and indexes it
PASS the created row is in DB.customers without any manual reload  → 89
PASS the warning names the existing holder  → Saved — but Stage B One already has this number
PASS the warning offers to OPEN the existing customer  → data-act="open-customer" data-id="82"
PASS the new card is in the grid
PASS archived holder: the warning names them AND says archived
     → Saved — but Stage B Archived Two (an archived customer) already has this number
```

And both rows exist in the database afterwards, checked server-side:

```
PASS 4. 409 phone_taken
PASS 4. existing names the live holder, archived:false  → {"id":82,"name":"Stage B One","archived":false}
PASS 4. the created row rides in the body  → 87
PASS 4. BOTH rows exist in the database afterwards
     → [{"id":82,"name":"Stage B One","archived":0},{"id":87,"name":"Stage B Dup Srv","archived":0}]
```

---

## 2. `totalSpent` is gone

The `TRANSITIONAL` bridge in `js/data.js` is deleted. `grep -rn "totalSpent" --include=*.js
--include=*.html .` now returns **nothing** — including `_shot.html` and the demo mirror in
`cu-save`, which used to seed the field.

Call sites converted (the prompt's line numbers had drifted; these are the ones that existed):

| Was | Now |
|---|---|
| `app-customers-scan.js:29` sort on `totalSpent` | five sorts, spend ordering on `spentUsdEquiv` |
| `app-customers-scan.js:71` card figure | `moneyPair(c.spentSyp, c.spentUsd, true)` |
| `app-customers-scan.js:121` drawer stat | same pair |
| `app-customers-scan.js:189-190` WhatsApp note (both languages) | `moneyPairText(...)` |
| `app-export.js:127` sheet sort | `spentUsdEquiv` |
| `app-export.js:138,141` one money column + total | **two** columns, SYP and USD, with their own totals |
| `app-export.js:430,431` statement totals + KPI | totals now sum the invoices actually on the sheet; KPI is the pair |
| `pos.js:1154` `cust.totalSpent += sale.total` | `cust.spentSyp += sale.total; cust.visits += 1` |

New helpers in `js/app-util.js`: `moneySypRaw`, `moneyUsdRaw`, `moneyPairText`, `moneyPair`. USD is
in **cents** (`minor_exp` 2) so `$45` is `4500`; `moneyUsdRaw` prints whole dollars when it can and
two decimals when it must. The pair is wrapped in `<bdi dir="ltr">` for the same reason `tel()` is.

**`spent_usd_equiv` is never drawn.** It orders the spend sort and the export sheet, and that is
all. The export's two columns are raw numbers so Excel can sum each currency on its own.

### Proof 3 — the two spend figures, hand-checked

Customer *Stage B One* was given four non-voided sales on the copy: 1,560,000 SYP (after a 50,000
discount, rate **130**), $45.00 (USD, rate 1), 200,000 SYP on credit and unpaid (rate 130), and
100,000 SYP at an **old frozen rate of 100**. That last row is the one that matters — today's rate
is 130.

```
## 2. Customers.byId — the row the route sends
 "spent_syp": 1860000,
 "spent_usd": 4500,
 "spent_usd_equiv": 1458346,
 "visits": 4,
 "debt_syp": 200000, "debt_usd": 0, "open_debts": 1,
 "sizes": [ {"fam":"Footwear","size":"42","qty":3},
            {"fam":"Footwear","size":"43","qty":2},
            {"fam":"Tops","size":"32","qty":1} ]

PASS 2. spent_syp = 1,560,000 + 200,000 + 100,000  → 1860000
PASS 2. spent_usd = 4500 cents ($45)  → 4500
PASS 2. spent_usd_equiv at each sale's FROZEN rate = 1458346  → 1458346
PASS 2. …and NOT what today's rate (130) would give: 1435269  → 1458346
PASS 2. visits = 4 non-voided invoices  → 4
   (the old total_spent would have added those to 1864500 — dollars counted as lira)
```

1,458,346 ≠ 1,435,269: the 23,077-cent gap is the 100,000-lira sale being converted at **its own**
rate of 100 rather than today's 130. The old single figure said **1,864,500**, which counted 4,500
US cents as 4,500 lira.

The same figures, through hydrate, in the browser:

```
PASS spentSyp = 1,860,000 (three lira sales)  → 1860000
PASS spentUsd = 4500 cents  → 4500
PASS spentUsdEquiv matches per-sale frozen rates (1458346)  → 1458346
PASS visits 4 · one open debt of 200,000 SYP  → 4/1/200000
```

---

## 3. The list screen

`viewCustomers` now draws, per card: the **two spend figures side by side**, loyalty points, the
server's **`visits`**, `relDate(last_purchase_at)`, the **top-two-per-family sizes** the server
already sent, an **Owes** badge when `open_debts > 0`, and the at-risk badge with its WhatsApp
button. `sizes` is read, never re-derived.

**Sorting** — a select beside the search box, five orders: recent (default), name, spend, visits,
debt. Spend orders on `spentUsdEquiv`; debt orders on a lira-equivalent computed locally *for
ordering only*, never drawn.

**The search box uses `foldName` and `normPhone`.** Two distinct paths: names through `foldName`
(a name is never routed through `normPhone`, which returns `''` for letters), digits through
`normPhone` with a zero-stripped variant so a locally-typed `0933…` matches a stored `+963 933…`.
The folded forms are cached on the row and rebuilt with it on every hydrate, so a keystroke over
5,000 customers is a substring scan rather than 10,000 fresh regex passes.

**The grid caps at 60 cards** (`CUST_RENDER_CAP`), with a note underneath saying how many matched
and to narrow the search. The count badge stays honest about the whole filtered list.

**A hazard the cap introduced, and closed.** `Bulk.visibleIds('customers')` called `customerRows()`
— whose comment promises "select-all must respect filters, not silently grab the whole table".
Once the grid was capped those stopped being the same list, and since **Archive is a bulk action**,
one tick box would have put 5,000 invisible customers one click from being archived. `js/bulk.js`
now calls a new `customerRowsShown()`, the same slice the grid draws:

```
PASS Bulk select-all reaches exactly the 60 cards on screen, not all 5000
     → 60 selectable / 60 drawn / 5000 matched
PASS customerRows itself stays whole, for counts and exports  → 5000
```

**Keystrokes no longer call `render()`.** `cust-q` and `cust-sort` call `repaintCustomers()`, which
rewrites only `#cuGrid` and `#cuCount`. The input being typed into is never rebuilt, so the
`focusBack` trick is not needed at all here.

### Proof 5 — the search box

```
PASS foldName strips harakat  → محمد
PASS search محمد finds the Arabic name
PASS search مُحَمَّد (vowelled) finds the plain name
PASS second word of the name matches
PASS phone 0955 700 111 finds +963 955 700 111
PASS phone +963… form matches
PASS bare 963-digit form matches
PASS zero-less local digits match
PASS compact 0-form matches
PASS a wrong number finds nobody
PASS Latin names fold case
```

### Proof 6 — 5,000 customers, real clock

`--virtual-time-budget` makes `performance.now()` virtual too — every measured section read
`0.0 ms` — so the timing pass runs as a **separate Chrome invocation without that flag**
(`?timing=1`):

```
REAL-CLOCK TIMING, 5,000 customers — hydrate+index 6.7 ms · full viewCustomers build 12.0 ms
· first keystroke (folds all 5,000 names) 8.2 ms · later keystroke (cached folds) 3.2 ms
· re-sort by spend 3.6 ms · risk filter 4.6 ms
PASS grid capped at 60  → 61
PASS render and keystroke stay interactive at 5,000 rows
```

12 ms to build the whole screen and 3.2 ms per keystroke, drawing six more fields per card than
before. Not O(n²): the cap bounds the card-building, and the per-row folds are computed once and
cached.

---

## 4. The drawer

`openCustomerDrawer` now **fetches** `GET /api/customers/:id/history?limit=200` through a new
`Shop.customerHistory(id, limit)` in `js/shop.js` — the first caller in `js/` (`js/api.js` remains
the only file that touches the network). The drawer opens immediately and the table fills when the
response lands; `#cuHist[data-cid]` guards a late response against a drawer that has moved on.

Each row shows the invoice, the date, **line items with size, qty and unit price**, the total in
**the sale's own currency**, the discount when there is one, and points earned/used. Lira sales
carry **their own frozen `fx_rate`** (`$1 = 130`) underneath the total — the number that makes last
month's figure auditable after the rate has moved. Voided sales are dimmed and labelled. Rows are
clickable only when the invoice is among the hydrated sales, because the history reaches further
back than the 200 the app holds and a click that silently did nothing would read as broken.

Also added: a second stat row (visits · debt · customer-since), and the sizes card now reads the
server's aggregate over **every** non-voided sale — the old card inferred them from whatever 200
sales the browser happened to hold, so it went blank for anyone not recent.

**No cost, for anyone.** The server strips `unit_cost` for accounts without `cost.read`; the drawer
does not draw it even for a manager, and computes no margin to fill the gap.

### Proof 2 — the history as two users

Server-side, over real HTTP (five line items across the four sales):

```
PASS 6. manager response: unit_cost ×5 (five line items)  → 5
PASS 6. cashier response: unit_cost ×0  → 0
PASS 6. fx_rate / discount / points ride on each sale
     → {"fx_rate":130,"discount":50000,"points_earned":1560}
```

And in what actually reaches the DOM:

```
PASS proof 2: ZERO cost in the manager's drawer DOM (cost is not this screen's job)
PASS USD invoice total drawn as $45, not lira
PASS each lira sale carries ITS OWN frozen rate (130 and 100 both on screen)
PASS points earned +1,560 from the sale row
PASS points used −100 shown
PASS the discounted sale shows its discount line
PASS line items carry qty and unit price
PASS hydrated invoices are clickable rows
PASS proof 2: cashier RESPONSE carries zero unit_cost
PASS proof 2: cashier drawer DOM — zero cost, totals still drawn
```

### Proof 7 — `fmtDate(null)` no longer prints 1970

`fmtDate` and `fmtDateTime` in `js/app-util.js` now return `—` for null, undefined, `''` and
anything that does not parse. `new Date(null)` is the epoch, not an invalid date, which is why a
customer who had never bought had **1 Jan 1970** printed under "Last purchase" as though it were a
fact.

```
PASS fmtDate(null) === "—"  → —
PASS fmtDateTime(null) === "—"  → —
PASS fmtDate(garbage) === "—"
PASS proof 7: no "1970" anywhere on the list
PASS proof 7: no 1970 in the drawer
PASS proof 7: never-bought drawer has no 1970
PASS never-bought last purchase reads "—"
```

---

## 5. `CONFIG.AT_RISK_DAYS` replaces the literal `90`s

The prompt said six. **There were eight**, in four files, and one of them was a piece of Arabic and
English prose. All are gone, replaced by `DB.atRiskDays()` — a new accessor that reads
`CONFIG.AT_RISK_DAYS` and **falls back to 90** when the key is missing or unusable.

| File | Was | Now |
|---|---|---|
| `js/data.js:1539` | `days \|\| 90` inside `inactiveCustomers` | `days \|\| DB.atRiskDays()` |
| `js/app-customers-scan.js:15` | risk filter `>= 90` | `DB.atRiskDays()` |
| `js/app-customers-scan.js:158` | `DB.inactiveCustomers(90)` head badge | `DB.inactiveCustomers()` |
| `js/app-customers-scan.js:88` | card badge `>= 90` | `>= DB.atRiskDays()` |
| `js/app-customers-scan.js:197` | drawer badge `>= 90` | `>= DB.atRiskDays()` |
| `js/app-export.js:134,150` | `DB.inactiveCustomers(90)` ×2 | `DB.inactiveCustomers()` |
| `js/app-export.js:301` | active-customers KPI `< 90` | `< DB.atRiskDays()` |
| `js/app-dashboard.js:73` | `DB.inactiveCustomers(90)` | `DB.inactiveCustomers()` |
| `js/app-dashboard.js:77-78` | **the words** "90 days" / "٩٠ يوماً" | the live number, both languages |

That last one is why reading the code was not enough: the alert would have counted at 180 and gone
on *saying* 90.

Two remaining literal `90`s in `js/` are prose in comments explaining the old behaviour
(`app-export.js:297`, `data.js:924`). Left as history.

### Proof 4 — at 90 vs at 180, by changing the config value

Not read from the code: written through `PUT /api/config`, re-loaded with `Shop.load()`, re-rendered.
The test customer *Stage B Stale* last bought 120 days ago.

```
PASS config 90 reached CONFIG  → 90
PASS config 180 reached CONFIG  → 180
PASS the 120-day customer is at risk at 90 and NOT at 180  → 1 → 0
PASS fewer at risk at 180 — count 1→0, risk filter rows 1→0
```

---

## 6. `CONFIG_WRITABLE`, and the Settings fold

`server/index.js:304` now admits `^customer\.` alongside `receipt.*`, the two `shop.*` keys and the
`label.*` list. **`loyalty.*` stays closed**, deliberately: the loyalty fold still writes to
`CONFIG` in memory only (`js/app-changes.js`, `set-pts` / `set-ptval`), and opening the keys before
that fold saves properly would let half a change persist. That pre-existing bug is unchanged —
neither fixed nor made worse.

Per your decision, the at-risk window is exposed. New `customersCard()` fold in
`js/app-settings.js` (in **Shop**, under Loyalty), with the fold head carrying the live number as
its `meta`. `set-atrisk` in `js/app-changes.js` writes `CONFIG` immediately and **saves to the
server**, debounced 600 ms so "180" typed as `1`, `18`, `180` is one write, not three. It is the
only Settings number on that page that reaches the database.

```
PASS 7. manager PUT customer.at_risk_days → 200  → 200
PASS 7. value persisted in config
PASS 7. loyalty.* still refused (400) — the fold does not save yet  → "400 loyalty.mode cannot be changed here."
PASS 7. cashier PUT → 403 (config.write)  → 403
PASS cashier cannot write the at-risk window (403)  → forbidden
```

---

## 7. `nm()`

Applied to every customer name and city on the screen: the card's name and city, the drawer head's
name and city, and every product name inside the drawer's line items (a shoe name can be Latin
inside an Arabic layout too). Seven call sites across the customers screen, plus the two Stage A
ones in `money.js` and `deliveries.js`.

```
PASS nm()/bdi isolation on the card
```

---

## 8. What was left alone

- **The four `sendError` header-bug routes** — `insufficient_stock`, `discount_too_big`,
  `not_enough_points`, `points_exceed_total`. Untouched, as instructed. Still real, still
  user-facing.
- **`DB.normaliseName`** — still does not call `foldName`.
- **Loyalty earning, redemption, stamps** — the config keys are read into `CONFIG`; no behaviour
  was built, and `loyalty.mode` being `points` changes nothing on screen yet.
- **`js/pos.js` `lastBuy()`**, **`js/receipt.js:836` `fromLocal`**, the third-currency note.
- **Customer #81's phone** — never read, never written.
- **The live database.** Verified read-only afterwards: customers **1**, sales **13**, users **5**,
  migrations **28**, `customer.at_risk_days` still `180` from Stage A, and **zero** rows matching
  `Stage B%`, `stageb%` or `INV-90%`. (Sales went 10 → 13 since the Stage A report: `INV-2111`,
  `2112`, `2113`, 2,250 SYP each, rung up at 21:28–21:30 local on 2026-09-01 through the shop's own
  server. Not mine — every test write went to the copy.)

---

## 9. `sw.js`, and one thing you must do before this is live

`sw.js:17` is now **`og-system-v86`** (Stage A left it at v85). **No new browser file was added**,
so the precache list is unchanged — `customerRowsShown`, `moneyPair`, `attachCustomer` and the rest
all live in files already on it.

**The server on :8090 is running the old code.** It was restarted at 20:06 local, before Stage B
edited `server/lib/customers.js` (the archived-holder rule) and `server/index.js`
(`CONFIG_WRITABLE`). Until it is restarted:

- the archived-holder warning will not say "archived", and an archived person will not be found at
  all — the old `phoneHolder` skipped them;
- `PUT /api/config` will **refuse** `customer.at_risk_days` with `400 … cannot be changed here`,
  so the new Settings fold will toast an error every time it saves.

The browser half is fine to ship on its own; the server half is not. Restart before showing this to
anyone.

---

## 10. What this prompt got wrong, what the code made me do differently, and what it does not settle

**Citations that had drifted.** Verified before relying on them, as instructed:

| Prompt said | Actually |
|---|---|
| bridge at `js/data.js:2424` | `:2427` (comment from `:2423`) |
| `app-customers-scan.js:24, 66, 183-184` | `:29, 71, 121, 189-190` — **five** sites, not three; the drawer one was missing from the list |
| `app-export.js:127, 138, 141, 425-426` | `:127, 138, 141, 430-431` |
| `js/pos.js:1148` | `:1154` |
| risk filter `app-customers-scan.js:16` | `:18-21` |
| card badge `:53-54` | `:59` |
| drawer badge `:101, 110, 165` | one literal at `:107`; `:116` and `:171` are *uses* of the flag |
| active KPI `app-export.js:290` | `:294` |
| "six" literal `90`s | **eight**, including one in translated prose |
| `server/index.js:604` scrubCost | `:609` |
| `server/index.js:300` `CONFIG_WRITABLE` | `:300` — correct |
| `sw.js` at v85 → v86 | correct |

**Things I was told to do that turned out to be a bad idea, or needed changing:**

1. **"Sorting should offer … last purchase, debt" — and B3 also said the card should show debt.**
   Both are right, but a **cashier never receives `/api/money`**, so before Stage A she had no way
   to see a debt at all. The figure she now sees comes from the server's `debtsByCustomer`, which
   reuses `Money.openDebts()`. That is deliberate and I think correct — a cashier taking a payment
   needs to know the person owes — but it is a **widening of what a cashier can see**, decided by
   Stage A and made visible by Stage B. If that is wrong, the fix is one `requirePerm` on the
   fields, not a change to this screen.

2. **The render cap was not in the prompt, and it created the `Bulk` hazard in §3.** Capping the
   grid is necessary at 5,000 rows, but "the list shows 60" and "select-all takes 5,000" is a worse
   bug than a slow page, because Archive is one click from there. If you would rather have no cap,
   remove `customerRowsShown()` **and** the `bulk.js` call together — they are a pair.

3. **"Repaint only the grid on keystroke"** meant `cust-q` stopped calling `render()`. That is
   right for this screen, but it means the head badge (`N at risk`) and the export buttons are no
   longer rebuilt while typing. They do not depend on the query, so nothing is stale — but if a
   future field up there does depend on it, `repaintCustomers` is where to add it.

4. **`--virtual-time-budget` made the timing proof meaningless** — every measurement read `0.0 ms`,
   and it would have been easy to paste that into this report as though it were a result. The
   timing pass is a second Chrome run without the flag. Worth remembering for any future proof
   that measures rather than asserts.

5. **The prompt's proof 1 asks to observe the moment between the 409 and the reload.** Under
   virtual time that window can close between two polls, so the end-to-end browser test asserts the
   row is on screen and the warning is right, and a **separate deterministic unit check** proves
   `DB.attachCustomer` maps and indexes the 409 body row. Both are in the log; neither alone is the
   whole claim.

**What the code does not settle:**

- **`visits` counts non-voided invoices, per your answer — so a customer who bought once and had it
  voided has `visits: 0` but is not "never bought"**: `last_purchase_at` also skips voided sales,
  so they show `—` and never go at-risk. That is consistent, and it means a voided sale erases the
  visit from the shop's memory of that person entirely. Probably right. Not obviously right.
- **Debt sorting converts at today's rate.** Spend has `spent_usd_equiv` frozen per sale; debt has
  no equivalent, so `debtOrder()` uses `CONFIG.EXCHANGE_RATE`. For *ordering* that is fine and it is
  never displayed — but if the shop ever holds meaningful dollar debt, the order will shift when the
  rate moves. A `debt_usd_equiv` on the server would fix it properly.
- **`customer.at_risk_days` has no upper bound in the UI beyond 3650** and no guidance about what a
  sensible value is. 180 came from you; nothing in the data suggests it.
- **The Settings fold saves; the loyalty fold beside it does not.** Two adjacent cards in the same
  section now behave differently, and nothing on screen says which is which. That reads as a bug
  even though it is the honest state of things.
- **`sizes` shows the top two per family, but the card shows all of them joined.** For a customer
  who buys three families that is six chips on one line. It has not been seen against real data —
  the shop has one customer.
- **Nothing was tested against a real Arabic RTL layout.** `nm()` and the `<bdi>` wrappers are
  correct by construction and the parity table passes, but no screenshot was taken with
  `OG.lang = 'ar'` and `dir="rtl"` on the document.
