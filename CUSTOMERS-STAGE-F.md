# CUSTOMERS-STAGE-F.md — money, and a stop

**I am stopping partway through Stage F, deliberately, and this says exactly where.**

The three pre-stage items are **done and verified** (24 checks). Stage F's **entire server half** is
done and verified (43 checks) — the debt panel's data, the payment path with all three guards,
`debt.collect`, the credit limit and no-credit flag, the merge, and both §10 extras. **None of the
browser half is built.** No screen calls any of it yet.

**67 checks pass.** Live database at migration **033**, data untouched (customers 2, sales 13,
debt_payments 0, merged 0). `CACHE` is **`og-system-v91`**.

---

## Why I am stopping here

You said to stop early and say so if it turned out bigger than it reads, and that a rushed half is
worse than a stated stop. Stage F reads as three features; it is three features **plus** two screens
that do not exist (the debt panel with take-payment, and the merge picker), a credit-limit editor
inside the customer form, a wants screen, and a job-link control. The server work is the part where
a mistake costs cash, so I did that first, verified it hardest, and stopped at the boundary rather
than starting five screens and finishing three.

Everything below is real, tested and reachable over HTTP. Nothing below is reachable by a person
clicking. That is the honest state, and it is a clean line to resume from.

---

# The three items

## 1. `loyalty_redemptions` and `wants` are in the mirror

**Shapes picked deliberately, and they are different.**

- **`loyalty_redemptions` is append-only** — written once, never edited — so it pushes with the
  highest-id cursor (`syncAppendOnly`), which is cheaper and self-healing after a rebuild.
- **`wants` is cursor-shaped**, replaying `change_log`, because a want is **edited when it is
  answered** (`closed_at`, `closed_note`). A highest-id cursor would push the row once, on the day it
  was created, and never notice the answer — so the mirror would go on saying somebody is still
  waiting for a pair they collected in March.

**Both write paths do call `logChange` — checked, not assumed:**

```
PASS 1. EVERY write path in wants.js calls logChange  → "2 writes / 2 logs"
PASS 1. …and so does the one in loyalty.js
```

`wants.js` has exactly two writes (`record` → insert, `close` → update) and exactly two `logChange`
calls; `loyalty.js` has one of each. The counts are asserted against the source so a third write
added later without one fails the check.

**A missing table names itself and the run carries on**, one guard per table — the shape the layout
block was rewritten into after a single shared guard silently skipped two tables:

```
PASS 1. one guard per table, so a missing one does not skip the other
PASS 1. …and a missing table exits non-zero rather than reporting a clean sync
```

`server/supabase/010_loyalty_and_wants.sql` is the hand-run file, and it also carries
`print_jobs.customer_id` from migration 032. **Both tables are in `supabase-restore.js`'s `ORDER`**
— a mirror you cannot restore from is decoration — placed after customers, products and variants,
and after accounts, which restore first because `user_id` needs them.

`supabase-check.js` needed no change: it enumerates every local table and excludes an explicit
`LOCAL_ONLY` set, so it covers these already and will go red until 010 is run.

> **Not verified against a real Supabase project, deliberately.** The 2026-08-30 incident was
> exactly this — a test database pointed at the live project pushed itself and deleted the shop's
> rows. Everything above is verified against the source and the local schema; the first real run
> needs 010 in the dashboard first.

## 2. Every permission name, checked at boot

`server/lib/permcheck.js` scans the source — not the running code — because a runtime assertion
inside `can()` only fires on a path somebody already exercises, which is the path that already
works. A wrong permission name **fails silently**: `Auth.can` returns false for everybody, the code
reads like a guard, and nothing complains.

Wired into `server/index.js` at boot, where it **stops the shop starting** — unlike preflight and
the hardware check, which deliberately never do. Those report a shop that can still sell shoes; this
reports a guard that is not guarding, and the direction it usually fails is open. Also in
`npm run preflight`:

```
  OK    111 permission names all exist (3 passed as a variable, not checkable here)
```

**The sweep found nothing else.** 112 literal call sites across `server/`, zero unknown — because
`sale.void` was the one and Stage E had already fixed it. The three uncheckable ones are
`requirePerm`/`can` called with a variable; they are **counted and reported** rather than quietly
ignored, so the number this cannot vouch for is visible.

**A check that cannot go red is not a check**, so I reintroduced the bug and confirmed:

```
CAUGHT:
2 permission name(s) that do not exist:
  index.js:684  'sale.void'
```

(That run also showed two patterns matching one call, which is why offences are now deduped on
file:line:name — reporting one mistake twice makes four look like eight.)

## 3. The full-card bell, capped

Five named rows, then one summary. Keyed on the **total** (`stamps:more:12`), so reading it once
does not hide it when a thirteenth card fills.

**The verification found a second bug while proving the first.** This bell has always ended in
`out.slice(0, 8)`. Pushing five names and a summary into a list that was already six long meant the
**summary was the row that got cut** — leaving four names and no hint that eight more people were
waiting. A silent undercount, arriving by a different door from the one the cap was closing. The
stamps block now reserves its slot inside that budget:

```
[ { "key": "stamps:83",       "text": "Bell Cap 0 has a full card — 10 of 10" },
  { "key": "stamps:84",       "text": "Bell Cap 1 has a full card — 10 of 10" },
  { "key": "stamps:85",       "text": "Bell Cap 2 has a full card — 10 of 10" },
  { "key": "stamps:more:12",  "text": "9 more customers have a full card — 12 in total" } ]

PASS 3. at most FIVE are named  → 3
PASS 3. …plus one summary row  → 1
PASS 3. keyed on the COUNT, so a thirteenth card makes it unread again
PASS 3. …and the rest of the bell is still there underneath  → "8 rows total"
```

**The cap would have broken the Customers filter**, so it does not: the chip would have shown five
people when twelve had full cards. `GET /api/notifications` now returns the **uncapped id list**
beside the capped alerts — alerts capped for reading, ids complete for filtering, both from the same
`Loyalty.fullCards()` call. A driver gets neither.

---

# Stage F — the server half

## F1. Debt, and taking a payment

`Money.debtsForCustomer` returns open debts **oldest first** — the order they get chased in — each
with what it was worth **then** and what it is worth **now**:

```
[ { "id": "INV-F100", "balance": 500000, "currency": "SYP", "fxRate": 100,
    "thenUsd": 500000, "nowUsd": 384615 } ]

PASS F1. 500,000 lira at the frozen rate of 100 was $5,000 then
PASS F1. …and is a different number today — which is why the rate is frozen
         → {"then":500000,"now":384615}
```

The shop freezes a rate onto every sale, so it can answer this, and refusing to would be a quiet
lie. Both USD figures are only ever shown **beside** the real amount in the currency actually owed.

**`debt.collect` exists now**, because the button does. A cashier holds it and still does not hold
`money.read`:

```
PASS F1. a cashier holds debt.collect
PASS F1. …and still NOT money.read  → false
PASS F1. the money screen stays shut to her  → 403
PASS F1. the warehouse cannot take a payment  → 403
PASS F1. and the partner can NEVER be granted it — it does not start with money.
```

That last one is the trap you named: `FORBIDDEN` bans the partner with
`p.startsWith('money.')`, which sails straight past `debt.collect`. It is listed **by name**.

**All three guards, exercised — including the two that only matter when something goes wrong:**

```
PASS F1. a cashier can take a payment — 500,000 − 200,000 = 300,000  → 300000
PASS F1. GUARD: the same opId replays — a dropped-wifi retry does NOT take it twice
         → "200000 → 200000"
PASS F1. …exactly one payment row exists
PASS F1. GUARD: paying more than is owed is refused, with the real balance
         → "only 300000 is still owed on that sale"
PASS F1. …and a settled debt takes no more money  → "already_settled"
PASS F1. GUARD: a part-paid sale refuses to be voided — the cash is already in the box
         → "has_payments"
PASS F1. a debt with NO payments can still be voided
```

None of the three is new — they were already in `Money.payDebt`. The work was routing the new
permission through them rather than reimplementing, and proving they hold from the outside.

## F2. Credit limit and the no-credit flag

Both columns nullable, and **null means "no opinion"** — deliberately not `DEFAULT 0`, because 0
means *no credit at all*, which is a completely different instruction.

```
PASS F2. REFUSED — a debt owed by nobody is not a debt  → "credit_needs_customer"
PASS F2. the no-credit FLAG refuses — the owner has already decided  → "no_credit"
PASS F2. the LIMIT warns and lets it through  → 200
PASS F2. …with the real numbers
   → {"code":"over_credit_limit","name":"…","limit":1000,"owedBefore":0,"owedAfter":9900,"over":8900}
PASS F2. a CASH sale to a no-credit customer is fine — the flag is about credit
```

The split is the shop's own shape: a regular going over on a Thursday is the call the person at the
counter is there to make, and a till that refuses it teaches them to stop attaching a customer to
the sale — which loses the shop far more than the overage. A flag is not a judgement; it is the
owner having already made one. Selling on credit to nobody is not a policy question.

The warning **rides back on the sale** rather than being thrown, so the receipt still prints and the
cashier is still told.

## F3. Merge

The user picks the survivor. Everything else follows, in one transaction.

```
PASS F3. every sale repointed  → "3+1 → 4"
PASS F3. …and none left behind
PASS F3. print jobs repointed  → 1
PASS F3. points ADD — 700 + 300, not the larger of the two  → 1000
PASS F3. the loser is ARCHIVED with a pointer, never deleted  → {"archived":1,"merged_into":83}
PASS F3. the invoice still says the name it was rung up under
PASS F3. a phone only the loser had is kept, not lost
PASS F3. the STRICTER credit rule wins — a merge cannot clear a flag
PASS F3. …and the LOWER limit wins (1,000 vs 50,000)
PASS F3. stamps followed on their own, because they are derived  → 3
PASS F3. logChange PER ROW — one entry per repointed sale  → "1 entries for 1 sales"
PASS F3. a cashier cannot merge — it is the manager's  → 403
PASS F3. merging the same record twice is refused  → "already_merged"
```

**Stamps need no handling at all**, exactly as the prompt said — they are derived from sales, so
they follow the repointed sales on their own. Deliveries and debt payments likewise: both reach a
person through a sale, which has just moved.

> **A real bug the test caught.** The merge first read the repointed ids *after* the UPDATE, from
> the survivor — so it logged "merged from customer X" against rows that had always been the
> survivor's, and reported the survivor's whole history as what it had moved. Harmless to the data,
> corrosive to the audit trail. The ids are captured before the update now.

## The two §10 extras

```
PASS X1. an old job starts unlinked, as 032 left it
PASS X1. …and a person can link it by hand — the screen 032 was waiting for
PASS X1. …and unlink it again, because somebody will link the wrong person
PASS X2. the wants screen has a list to draw — one request, no per-customer walk
```

`PATCH /api/print-jobs/:id/customer` and `GET /api/wants` both exist and work. **Neither has a
screen.**

---

## What is NOT built — the resume list

Server done, browser not started. In the order I would do them:

1. **The debt panel on the customer profile** — the then/now table and a Take payment button.
   `GET /api/customers/:id/history` already returns `debts` with payments and both USD figures.
2. **Credit limit and no-credit in the edit form** — two fields; `PATCH /api/customers/:id` does
   **not** accept them yet (`FIELDS` in `customers.js` is text-only, and `archived` is special-cased).
   That is a small server change too.
3. **The over-limit warning at the till** — `sale.warning` comes back on the sale and nothing reads
   it, so today the limit is enforced and invisible.
4. **The merge picker** — manager only, and it needs a confirm that names what will move.
5. **The wants screen** — "what is everybody waiting for", the view a manager opens when a shipment
   lands.
6. **The job-link control** on the print board.

Also outstanding: I18N keys for all of the above, and a cache bump when they land.

---

## §10 — what this prompt got wrong, and what the code does not settle

**A latent trap worth fixing before something consumes it.** `logChange(tbl, rowId, op, userId,
origin)` — the fifth parameter is **`origin`**, documented in `001_init.sql` as "which device
produced it, so a client can skip echoes of its own writes". Every caller that passes anything
passes a **human-readable note** instead: the pre-existing `adjustPoints` writes
`"points +250: goodwill"`, and Stages D, E and F added more. Nothing reads `origin` today —
`supabase-sync.js` never mentions it — so nothing is broken. But the day somebody implements the
echo-skipping the column was created for, these become bogus origins and rows get skipped. It wants
either a separate `note` column or a renamed parameter, and it is not a thing to leave for the
person who implements echo-skipping to discover.

**Three of my own test assumptions were wrong**, and each cost a run:

- 500,000 lira at 100 lira/USD is **$5,000**, not $50. My assertion was the bug.
- I asserted a credit warning on a customer whose debt I had **voided two checks earlier**.
- `change_log`'s column is `tbl`, not `table_name`, and it has **no `note` column** — which is how I
  found the `origin` misuse above.

**What the code does not settle:**

- **`PATCH /api/customers/:id` cannot set `credit_limit` or `no_credit`.** The columns exist and the
  sale path enforces them; there is no way to set them except by hand in SQL. Item 2 on the resume
  list is a server change as much as a screen.
- **A merge cannot be undone.** `merged_into` records where the loser went, which makes an unmerge
  *possible* to write, but nothing writes it — and points that were added cannot be un-added
  correctly once they have been spent.
- **The credit limit is one number in one currency.** A shop that sells in both has a limit that
  means different things depending on which currency the debt is in; `owed` sums `sales.total`
  across currencies, which is exactly the mistake Stage A removed from `total_spent`. **It is wrong
  in the same way, and I have left it wrong rather than guess** — it wants either a per-currency
  limit or a conversion at each sale's frozen rate, and that is the owner's call.
- **`debt.collect` is not in the Supabase `role_permissions` mirror until the next sync**, which is
  fine, but a restore onto a fresh machine before that sync happens gives a cashier who cannot take
  payments.
