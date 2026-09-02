# CUSTOMERS-STAGE-F2.md — the two decisions, and Stage F's browser half

Picks up where `CUSTOMERS-STAGE-F.md` stopped. The two decisions are implemented, and **all six
browser items plus the two carried ones are built**.

**66 checks pass** — 44 server-side, 22 browser-side — plus an Arabic RTL render of the new panels.
Live database at migration **034**, data untouched (customers 2, sales 13, debt_payments 0, wants 0).
`CACHE` is **`og-system-v92`**. `I18N.en` / `I18N.ar` equal at **1,404 keys**, every `t()` key in
`js/` resolves.

---

## Decision 1 — the credit limit is in USD

Stored as **USD minor units (cents)**, because a limit written in lira decays as the currency moves:
a ceiling set last year quietly stops being one without anybody changing it.

**Compared by converting each open debt at its own frozen `fx_rate`** and summing in USD — the
identical arithmetic to `spent_usd_equiv`, which is what that figure was built for. The old version
summed `sales.total` across currencies, which is the mistake Stage A took out of `total_spent`.

```
PASS F2. …with the real numbers
   → {"code":"over_credit_limit","name":"…","limit":1000,"owedBefore":0,"owedAfter":9900,"over":8900}
```

**Displayed in dollars with today's lira beneath, labelled approximate.** The debt panel's
then/now column reads `$38.08 then · $38.08 now`, under a note that says in as many words:

> The dollar figures are approximate — the "then" column uses the rate frozen on each sale, the
> "now" column today's. Neither is what is owed; the amount owed is the figure in the left column.

**`PATCH /api/customers/:id` accepts both now.** They are kept out of `FIELDS` deliberately:
`clean()` turns an empty string into null, which is right for an address and catastrophic for a
flag, where `''` would silently clear somebody's no-credit mark.

**Blank is not zero, and the whole chain preserves that** — blank means no limit set, 0 means no
credit at all, and the nullable column exists to tell them apart:

```
PASS F2: $25 on screen is 2500 cents in the database  → 2500
PASS F2: …and comes back as 25 dollars  → 25
PASS F2: BLANK clears it to null — no limit, which is not the same as 0
PASS F2: …and 0 is kept as 0
```

## Decision 2 — `logChange`'s fifth parameter

Migration **034** adds `change_log.note`. `logChange(tbl, rowId, op, userId, note, origin)` — the
fifth parameter now means what every caller was already passing, and `origin` moves to a sixth where
it stays unused until something actually sets it.

**No caller changed.** All nine were already passing notes; the signature moved to meet them:

| File | What it writes |
|---|---|
| `customers.js` (×3, in `merge`) | `merged from customer 84` / `merged in…` / `merged into…` |
| `customers.js` `adjustPoints` | `points +250: goodwill` — the oldest, and the one whose own comment says the reason must survive |
| `sales.js` `attachCustomer` (×2) | `attached to customer 12`, `+990 points from INV-… (attached)` |
| `sales.js` `voidSale` | `void INV-…: points 1000 → 750` |
| `wants.js` `close` | `closed` |
| `partner.js` `setJobCustomer` | `customer linked by hand` |

```
PASS D2. change_log has its own note column now (034)
PASS D2. nothing writes into origin any more — it means what it says again  → 0
PASS F3. logChange PER ROW — one entry per repointed sale  → "1 entries for 1 sales"
```

Nothing read `origin`, so nothing was broken — which is exactly why it was worth doing now. The day
echo-skipping is implemented, every one of those notes would have become a bogus device id and the
rows carrying them silently skipped.

---

## The six browser items

### 1. The debt panel, and taking a payment

One row per invoice, oldest first, with then/now and a Take payment button — drawn for anyone with
`debt.collect`, which a cashier has and which does not open the money screen:

```
   debt panel: Invoice Date Still owed Then/now
               INV-2114  2 Sep 2026  9,900 SYP  $76.15 then · $76.15 now  [Take a payment]

PASS F1: one row per invoice
PASS F1: then AND now on every row
PASS F1: a cashier gets the Take payment button
PASS F1: …and the money screen is still 403 for her  → 403
PASS F1: no amount, no request
PASS F1: the payment went in
   paying 4,950 of 9,900 → toast: "4,950 · 4,950 still owed"
```

**The `opId` is generated before the send**, not inside it — asserted against the shipped source,
because generating it inside `Shop.write`'s send function would make every retry a new payment,
which is the exact failure `applied_ops` exists to prevent:

```
PASS F1: the opId is made BEFORE the send, so a retry carries the same one
```

### 2. Credit limit and no-credit in the edit form

Two controls, in dollars, with the placeholder saying `no limit` so blank and 0 do not look
identical. Covered by the four assertions quoted under Decision 1.

### 3. The over-limit warning at the till

`sale.warning` came back on the sale and nothing read it, so the limit was enforced and invisible.
The till now says so — nine seconds, `warn` not `err`, because **nothing went wrong**: the sale
happened, and colouring it as a failure teaches cashiers to stop attaching a customer to the sale,
which loses the shop far more than the overage.

### 4. The merge picker

Opens on the **likely duplicates of this person** — anybody whose folded name or normalised phone
matches theirs — which is the whole reason a merge exists. The confirm names what will move:

```
   Merge Stage F Merge Me into Stage F Ana?
   Their 0 purchases move across, with the points those earned.
   Points add up: 1,000 + 0 = 1,000.
   Stage F Merge Me is archived, not deleted.
   There is no undo button for this.

PASS F3: the picker finds it
PASS F3: …and never offers the survivor to itself
PASS F3: the confirm says it cannot be undone
PASS F3: the survivor kept everything
```

### 5. The wants screen

A **warehouse tab**, not a nav entry — it is the tab a manager opens when a shipment lands, and the
warehouse is where shipments land. Grouped by what was asked for, because that is the unit a box
arrives in: one carton of 44s answers every row under one heading. **A row turns green once the size
is back in stock**, which is the answer the screen exists to give.

```
PASS X2: the wants tab draws
PASS X2: …and is not stuck loading
```

Fetched, not hydrated: it changes while somebody is standing at the back door with a box, and a copy
taken at sign-in would be the wrong one by the time it was read.

### 6. The job-link control

On the print job drawer: the linked customer as a chip that opens their profile, or a **+ Link a
customer** button when migration 032 left it unlinked. Its note says why nothing was guessed.

```
PASS X1: the job drawer offers a link control
PASS X1: …and both halves of it are wired
```

### One thing I did not plan to do

Three pickers now ask "which customer does this text mean" — attach a sale, merge, link a job — and
I had written the fold/normalise matching out **three times** before noticing. It is one
`custSearch()` now, and the suite asserts there is exactly one copy:

```
PASS the "which customer" rule is defined ONCE, not once per picker  → 1 copies
```

Also removed: a **duplicate `payDebt` key** in the `Shop` object literal. Two keys with the same
name silently keeps the last — a coin toss written as code. A sweep found no others (51 keys, no
duplicates).

## Arabic

The new panels render correctly RTL: the debt table (الفاتورة / التاريخ / الباقي / وقتها / هلق),
the قبض دفعة button, the approximate-dollars note, and the credit badges (`علیه ل.س 4,950`,
`السقف $0`). The timeline picked up the print job and showed a voided sale with its ملغاة badge.

---

## The two bugs, and whether there are more of either

You asked whether these are one-offs. **They are not, and they have different shapes.**

**A count that undercounts silently** — `out.slice(0, 8)` would have cut the bell's summary row,
leaving four names and no hint that eight more people were waiting.

This is the third of its kind in these stages. The first was Stage A's `total_spent` adding lira to
dollars; the second was Stage C's 60-card render cap versus `Bulk.visibleIds`, where select-all
would have reached 5,000 invisible customers. The pattern is always the same: **a limit applied at
one layer while another layer keeps counting the whole set.** I went looking for more and found one
live and one latent:

- **`GET /api/sales?limit=200`** feeds `DB.sales`, and several screens count over that array as
  though it were the shop. Stage A already caught the worst case — the debt book — by folding
  `money.creditSales` in unbounded. The *reports* screen still counts over the 200.
- **`Wants.open`'s `limit = 200`** and `historyFor`'s `limit = 200` both silently truncate, and
  neither tells the caller it did. If the shop ever has more than 200 open wants, the wants tab will
  quietly show 200 and the badge will say 200.

The general fix is the one Stage C used on the card grid: **when you cap, say that you capped.**
Neither of those does.

**Reading state after the write that changed it** — the merge logged "merged from…" against rows
that had always belonged to the survivor, because it re-read the ids after the UPDATE.

This one I think is rarer here, because most writes in this codebase return the row they wrote
rather than re-reading a set. I checked the paths that could have it:

- `Sales.attachCustomer` reads the sale **before** the UPDATE. Correct.
- `Loyalty.redeem` computes `left = have - use` from the pre-write count. Correct.
- `Stock.apply` writes the running total in the same statement. Correct.
- `Customers.update` / `create` re-read via `byId(id)` **after** the write — which is deliberate and
  right: they want the new state to return it.

So one real instance, and the distinction that matters is **why** you are re-reading: to return the
new state (fine) or to identify what you just changed (wrong — the set has moved). The merge was the
only one doing the second.

---

## §10 — what is still not settled

- **The credit limit is compared in USD but `credit_limit` has no currency column.** It is USD by
  convention, documented in 033 and in the code, and nothing enforces it. A second currency would
  need a column, not a comment.
- **`sale.warning` is only read by the POS.** A credit sale made through any other path — there are
  none today — would enforce the limit and say nothing.
- **The wants tab has no filter.** At forty rows it is a list; at four hundred it needs "only what
  has landed", which is the row that is already highlighted green.
- **Merging does not merge wants that are duplicates of each other.** Both records' wants repoint,
  so the survivor can end up asking for the same size twice. `Wants.record` dedupes on the same day
  only.
- **Nothing tests the merge under a second till.** It is one transaction, so it is safe, but the
  confirm is built from browser state that could be stale by the time it is accepted — it would
  report "3 purchases move" and move four.
