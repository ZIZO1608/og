# DASHBOARD.md — server-computed figures, one to-do list, four homes

Done on **2026-09-02**. Nothing committed, nothing deployed, live database untouched (every check
ran against a throwaway copy and a fresh empty database).

`CACHE` **`og-system-v94 → v95`**. I18N equal at **1,484 keys**. Two harnesses, both green:

| harness | what | result |
|---|---|---|
| `dash-check.mjs` | real HTTP against `createApp()` on a seeded copy — 5 accounts, 270 sales | **61 / 61** |
| `dash-browser.mjs` | headless Chrome in `Asia/Damascus`, the real login form, four homes, both languages, phone width, plus an empty shop | **57 / 57** |

`npm run preflight` still counts every permission literal (118, up from 114).

---

## What was wrong

Every number on the dashboard was summed in the browser from the last **200 invoices**, and
nothing on the screen said so. The seeded copy has 282 sales; the old browser reduce over the
window gave **261,629** for thirty days where the truth is **282,629**. The harness asserts the two
differ — the test goes red on the old behaviour.

Beyond that: the "Needs attention" card was a client-derived list that disagreed with the bell; a
third stale list fed the export; the cashier's home matched her sales by **first name**; the
warehouse's "arrived today" summed a 400-row window and counted a transfer to the floor as an
arrival; "Latest sales" and all three charts had no empty state; and every alert was composed in
English on the server, so an Arabic user's to-do list was English inside RTL.

## What was built

### `GET /api/dashboard?from=&to=&tz=` — `server/lib/dashboard.js`

Every figure in SQL over every sale. Three rules:

- **The day belongs to the browser.** The server is UTC; Aleppo is UTC+3. The till sends two
  ISO instants from a *fresh* local midnight and its zone; the server re-normalises both through
  `toISOString()` and aggregates half-open `at >= ? AND at < ?`. Verified in Chrome pinned to
  Damascus: `from` arrives as `T21:00:00.000Z` of the previous UTC day, and a sale seeded at
  22:30Z yesterday-UTC is counted in "today".
- **Money is a pair, `{ syp, usd }`, never converted, never added.** Every sum is
  `GROUP BY currency`. The hero shows the base currency; dollars taken as dollars are a second
  line; the one converted figure is labelled *approximate at today's rate*. A 100.00 USD card sale
  lands as `usd: 10000` and moves `syp` by nothing, in takings, by-payment, monthly and the
  cashier's own block.
- **A block the account may not see is absent**, like `GET /api/partner`. Drawer, debts and
  suppliers need `money.read`; margin needs `profit.read` and leaves as a percentage only; `me`
  and `latest` need `sell`; `staff` needs `staff.read`. A cashier's response contains none of
  `unit_cost`, `cost_price`, `margin`, `profit`, `drawer`, `debts`, `suppliers`, `staff`. A manager
  stripped of `profit.read` gets no `margin` and still gets the drawer.

Validation: garbage, `to <= from`, a 367-day span, a missing bound and `tz=9999` all return
`400 bad_range`; an account with none of the four unlocking permissions gets 403.

### One to-do list — `server/lib/alerts.js`

`Alerts.list(user, { limit })` returns `{ rows, shown, total, capped }`. The bell asks for 8, the
dashboard for 50, from the same function. The harness asserts the bell equals the dashboard's
first eight **key for key**, and that the sentence drawn for a key is identical in both places.

**Rows are `{ kind, args }`, not text.** The words are written in the browser by `DB.alertText`
from I18N — `al_<kind>`, `_1` for a singular, `al_more_<kind>` for a summary row — so the same
row reads correctly in Arabic. Verified: the Arabic to-do and bell contain no English sentences
and no raw key names.

**Summary rows.** Each kind with a `LIMIT` pushes one `<kind>:more:<total>` row when more exist,
so the badge counts what is there. Five out-of-stock sizes on the copy → three named rows plus
`stock_out:more:5` carrying `{ n: 2, total: 5 }`.

**Read marks use the uncapped list.** Pruning against the bell's eight would un-read row twelve
on the dashboard the next time anyone read anything. Asserted: a row beyond the bell stays read
after another read.

**New kind `wants_back`:** a size somebody asked for is back in stock, grouped by SKU, counting
distinct customers, gated `stock.read` **or** `customer.read` (never a driver). It opens the
warehouse's wants tab, because it is the back room that knows a box landed — and the warehouse
account does not hold `customer.read`. A want on a hidden product or a size still at zero does
not alert.

### The four homes — `js/app-dashboard.js`

**Manager:** hero → invoices / average basket / margin / discounted sales (with "n above the cap")
→ drawer / customers owe / owed to suppliers / how they paid → to-do (badge = server total, capped
note when even fifty is not all of it) → new / quiet / full cards / wanted sizes back → three charts
→ latest sales + sales by staff. Every list has an empty state; a chart with nothing to draw is a
sentence, not an empty axis. `DB.dash === null` draws one "unavailable" card, never zeros.

**Cashier:** her sales and invoices **by `cashier_id`** (two Lubnas on the copy; each sees only
her own), whether a shift is open and since when — never the expected amount — her last sales,
full stamp cards, what is running out on the shelf.

**Warehouse:** arrived today from the server (`type = 'received'` only), a new *Back in stock —
tell the floor* card fed by the same `wants_back` rows, and the rest unchanged. No money on it.

**Driver:** a third stat, what is in his pocket and not yet in the drawer.

**Scope chips** send exactly one request, to `/api/dashboard`, and dim the old numbers while it is
in flight. No `/api/sales` round trip.

### Fixed on the way

- **`Money.summary` mixed currencies** — a $100 cash sale on a lira shift was added to `expected`
  as 100. Now filtered to the shift's currency. Asserted: float 20,000 + one 3,000 SYP cash sale +
  one 50.00 USD cash sale → `expected: 23,000`. Nothing already frozen changed: every till sale to
  date settled in SYP.
- **`moneyPair` drew `$100` as `100$` in Arabic.** One isolate around "2K ل.س + $100" let the bidi
  algorithm pull the dollars into the Arabic run. Each half is now its own `<bdi>`. This helper is
  shared with the customers screens, which get the fix too.
- The supplier-due and PO-late alerts now filter in SQL (`due_date <= horizon`, `sent_at <= cutoff`)
  before the `LIMIT`, where the old shape took the three soonest and then dropped the far-off
  ones — three suppliers due next year hid one due tomorrow.

## Files

Server: `server/lib/dashboard.js` (new), `server/lib/alerts.js` (rewritten), `server/lib/wants.js`
(`backInStock`, `backInStockTotals`), `server/lib/sales.js` (`inRange`), `server/lib/money.js`
(currency filter), `server/index.js` (route; `/api/notifications` returns `.rows`).

Browser: `js/app-dashboard.js` (rewritten), `js/data.js` (`DB.dash`, `alertText`,
`markNotifReadKey`), `js/shop.js` (`dashboard` request, `reloadDashboard`), `js/app-actions.js`
(`alert-fix`, `dash-cust`, `dash-scope`, bell), `js/app-export.js`, `js/deliveries.js`,
`js/app-util.js` (`moneyPair`), `js/app-i18n-extra.js` (78 new keys, 4 dead ones removed, both
tables), `css/inputs-dashboard-pos.css`, `sw.js`.

No migration. `sales_at`, `movements_at` and the partial `wants_variant` index cover every query.

## Not in scope, noted

- `Deliveries.driverDay` keys the day on UTC `assigned_at`, which contradicts "the browser owns
  the day". A run assigned at 01:00 Aleppo sits on yesterday.
- `todo.total` counts rows, summary rows included — "40 SKUs out" is honest but still one line.
- The dashboard refetches on every `Shop.write()`. Fifteen indexed queries plus one `GROUP BY`
  over all sales for the six-month chart; fine at this size, and if it ever shows, drop `monthly`
  from the write-triggered reload.
