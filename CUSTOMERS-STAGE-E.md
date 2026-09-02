# CUSTOMERS-STAGE-E.md — the connections

Stage E: a customer reachable from everywhere, attaching one to a sale after the fact, print jobs
that know who they are for, and a wants list nobody has to remember to keep.

**52 checks pass** — 29 server-side, 23 browser-side. `CACHE` is **`og-system-v90`**.
Migration **032** is applied to the live database. Stage F has not been started.

**Preconditions.** The tree carried Stages C-follow-up and D uncommitted (my own, both reported).
`:8090` was down throughout, so nothing was served from this work. Live database after 032:
32 migrations, customers 2, sales 13, wants 0, and `print_jobs.customer_id` present.

Verified the usual way — throwaway `backup()` copy, `createApp()` on 8099, `OG_SYNC_MINUTES=0`,
real HTTP, headless Chrome against the repo's real `js/`.

---

## E1. Links inward

**An invoice's customer name** was dead text; it opens the profile now. And when a sale has **no**
customer, the same slot offers to attach one — which is where E2 is actually used.

```
PASS E1: the customer name on an invoice opens their profile
PASS E1: …while the invoice still PRINTS the name it was rung up under
PASS E1: an anonymous invoice offers to attach a customer instead
```

**A product's size shows how many customers wear it**, and opens the list filtered to exactly them.
This is the payoff for the size aggregate built in Stage A: a shipment landing stops being "twelve
pairs arrived" and becomes "six people to message". Counted off the hydrated rows, which already
carry `sizes` — no request, and no second definition of what "wears a 43" means.

```
PASS E1: a size shows how many customers wear it  → "2 wear this"
PASS E1: …and opens the list filtered to exactly them  → 43
PASS E1: every row on that filtered list wears the size  → 2 rows
```

**A delivery shows who, and whether a parcel to them has come back before** — derived from
`deliveries.status` on the board the shop is already looking at, never a stored flag. "This customer
has failed deliveries" is a judgement about a person, and a stored one outlives its reason: a wrong
address fixed in March would still be marking somebody in December. Counted live, it corrects itself
the moment a delivery succeeds. The server now sends `customerId` alongside the frozen
`customerName` so the board can link; a driver gets no link, because the customers screen is not his.

**The bell opens the person.** An alert's key is already its address — `stamps:83` — so the
dashboard reads that rather than needing a second field, and falls back to the old view-level
navigation for every other kind.

## E2. Attaching a customer to a sale after the fact

The first `UPDATE sales` in this codebase beyond the void flag. Four things happen in **one
transaction**, and one of them is nothing at all:

1. the sale gains the customer;
2. the points it would have earned are earned now, **at the rate stored on the sale** — not today's,
   because re-pricing a past sale against a rate that has moved pays out a different number than the
   receipt showed;
3. `points_earned` is written onto the row, so the invoice, the timeline and the balance agree — and
   so Stage D's void path has something to claw back;
4. **stamps need no code at all.** They are counted from non-voided sales with a `customer_id`, so
   the UPDATE earns them. Proved, rather than assumed:

```
PASS E2. the two items became two STAMPS with no stamp code in the attach path  → 2
```

**`customer_name` is not rewritten**, per your decision:

```
PASS E2. …and the INVOICE NAME IS UNCHANGED — a receipt is a record of that moment  → "Walk-in"
PASS E2. the sale now belongs to the customer  → 88
PASS E2. points_earned is written onto the row, so the invoice and the balance agree  → 990
PASS E2. the points followed, in the same transaction  → 0 → 990
```

> **This forced a pre-existing bug into the open, and I fixed it.** `invoiceHtml` and `receiptHtml`
> both printed `DB.customer(sale.customerId).name` — the customer's name *today* — so the frozen
> column was stored and never read. Renaming somebody rewrote every invoice they had ever had, and
> attaching a customer to an old walk-in sale would have rewritten it as theirs. Both documents now
> print `sale.customerName`. Phone and city still come from the live record, because they are not
> frozen anywhere and there is no other source.

**Who may, and how long after.** The cashier can fix a sale in her own **open shift**; anything older
is the manager's. Resolved from the shift the sale was posted into rather than from a clock, because
"same shift" is the unit the shop works in and a sale at 23:55 is not yesterday's problem at 00:05.

```
PASS E2. the cashier may attach a sale from her own open shift  → 200
PASS E2. an earlier shift is out of the cashier's reach  → "too_late"
PASS E2. …and is the manager's to do (void lifts the limit)  → 200
PASS E2. a sale that already has a customer is refused, not moved  → "already_attached"
PASS E2. the same opId replays — a retry cannot earn the points twice
```

> **A real bug the verification caught:** I first gated the manager's override on `sale.void`. The
> permission in `role_permissions` is called **`void`**, so `Auth.can(user, 'sale.void')` was always
> false and the manager had no way past the shift rule at all — a silent dead end that reads as
> working code.

Moving a sale from one customer to another is **refused**, not supported: that is two corrections,
and it would have to take points off somebody who may already have spent them.

In the browser, the picker reuses the list's own two search paths rather than inventing a third
opinion about matching:

```
PASS E2: a name finds them
PASS E2: …and so does a locally-typed phone number
   attach toast: Stage E Alice · +990 points
```

## E3. Print jobs get a real `customer_id`

Nullable column, indexed, plus the backfill.

**Backfilled only where a `sale_id` proves it** — `job → sale → sale.customer_id` is a fact.
Deliberately **not** matched on name or phone: in Aleppo the same person is written in Arabic on
Tuesday and in Latin on Thursday, two brothers share a surname, and a phone match is exactly the
wrong instinct when the shop has already decided (028) that a shared number is not a duplicate.

On the **live** data the backfill linked **0 of 1** jobs, because that job has no `sale_id`. On the
test copy the same rule behaves as designed:

```
PASS E3. a job raised with a customerId keeps the link
PASS E3. a job raised without one stays UNLINKED rather than guessing from the name
PASS E3. the profile sees only what a customer_id proves  → 1
```

The till sends it, because the till is the one place that knows — the customer is already on the
basket. Everywhere else a job is raised, it stays null for a person to link by hand, and the profile
**shows nothing rather than something possibly wrong**.

### The partner leak — it was a one-line omission, and it was live

`GET /api/partner` stripped `price` and nothing else, so **every print job carried the shop's
customer name and phone number to another company, on every poll**. `FORBIDDEN` in `lib/auth.js`
already says a partner can never hold `customer.*`; this route was handing over the same data through
a different door.

What Yalla Wear receives now, in full:

```
cost created_at created_by currency deadline design history id kind lines
order_note order_promised_at order_responded_at order_sent_at order_state
priority qty sale_id stage tbc updated_at
```

```
PASS E3. the partner receives NO customer name, phone or id on any job
PASS E3. …and still no price
PASS E3. …while the shop still sees who each job is for
PASS E3: what they need to print is all still there
```

## E4. The wants list, captured without a habit

Nobody types anything. When a size is looked up **while it is out of stock** and a customer is
attached to the basket, that is the record — the habit already exists, and this keeps the result.

The capture point is `addVariant`'s genuinely-out branch in `js/pos.js`, which serves both the scan
path and the click-through-search path, and only fires when the size is out **everywhere**: a pair in
the back is not a want, it is a walk to the stockroom. It is fire-and-forget, so a note can never
slow down or interrupt a sale.

The **server** decides what is worth keeping, so the till does not have to remember: it re-checks the
stock and drops a repeat on the same day.

```
PASS E4. recorded by the act of looking — nothing was typed
PASS E4. the same box scanned again the same day is one want, not two  → "already_today"
PASS E4. a size that is ON THE SHELF is not a want  → "in_stock"
PASS E4. when it lands, the list of who wanted it is already there  → ["Stage E Alice"]
PASS E4. answering it is recorded, never deleted
PASS E4. …and it leaves the waiting list
PASS E4. …but stays on the customer, because "we told them" is worth keeping
```

End to end from the till, with no manual entry anywhere:

```
PASS E4: the till refused the out-of-stock size, as it always did
PASS E4: …and the want was recorded by the act of looking — nothing typed  → 0 → 1
PASS E4: with NO customer attached nothing is recorded — there is nobody to tell  → 1
   want row: Asked for Test Shoe · 42
```

## The timeline gained three kinds

Wants, print jobs and (from Stage D) stamp redemptions are each one mapper in `timelineRows` — which
is what that shape was built for in Stage C. The history payload carries all of them in one request,
each gated separately: `jobs` is `null` without `print.read`, `deliveries` `null` without
`delivery.read`, `redemptions` empty when the shop does not run stamps.

```
PASS E. wants ride in the history payload
PASS E. so do the print jobs
PASS E. and the redemptions from Stage D
PASS E. a cashier holds print.read here, so she does see the jobs
PASS E. an account with no customer.read cannot reach the history at all  → 403
```

## I18N

`I18N.en` / `I18N.ar` equal at **1,363 keys**, and every `t()` key in `js/` resolves — the sweep
written in Stage D, re-run.

---

## §10 — what this prompt got wrong, and what the code does not settle

**Two of my own assumptions were wrong, and the verification is the only reason I know:**

1. **The void permission is `void`, not `sale.void`.** My manager override never fired. A permission
   name that does not exist fails *silently* — `Auth.can` returns false and the feature simply is not
   there. Worth a lint: every string passed to `requirePerm`/`Auth.can` should be checked against
   `ALL_PERMISSIONS` at boot.
2. **A cashier holds `print.read` in this shop.** I wrote a test asserting she does not see print
   jobs; she does, and correctly. The gate is real, but the account that proves it is the warehouse
   role.

**Where the prompt's design needed a decision it did not state:**

3. **"A delivery shows … whether they have failed deliveries before."** Derived from the board the
   browser holds, which is the last 100 deliveries — so a customer whose failure is older than that
   shows clean. Deriving it properly means a server-side count per customer, which is another
   aggregate on the deliveries route. The current version is honest but shallow, and it is shallow in
   the safe direction.
4. **`sale_id` still crosses to Yalla Wear.** It is the shop's own invoice reference, not a customer
   detail, so I left it — but it does tell another company which shop sale a job came from, and if
   that matters it is one more key in the same strip list.
5. **The wants capture is at the till only.** A size looked up on the **Products** screen, or scanned
   from the scan sheet, records nothing, because no customer is attached there. That is the right
   trade (a want with nobody to tell is noise) but it means the list only fills while somebody is
   mid-sale.

**What the code does not settle:**

- **Neither `wants` nor `loyalty_redemptions` is in the Supabase mirror.** Same standing gap as Stage
  D's: new tables need a hand-run schema file in the dashboard and a named entry in `supabase-sync.js`.
  A derived stamp count is recoverable; a redemption row and a want are not. **This is now two stages'
  worth of tables living only on this machine, and it is the first thing I would fix.**
- **`print_jobs.customer_id` has no UI to set it by hand.** The migration deliberately leaves old jobs
  unlinked for a person to link — and there is no screen for that person to use. The link only ever
  gets set by the till, going forward.
- **Attaching a customer does not re-run the discount cap.** It cannot make a sale invalid, but a
  sale rung up at a walk-in's 10% ceiling stays at that ceiling even if the attached customer would
  have had `discount.unlimited`. Almost certainly right; not stated anywhere.
- **The wants list has no screen of its own.** It is on the customer's timeline and reachable by
  `GET /api/wants?sku=`, but "what is everybody waiting for" — the view a manager would open when a
  shipment lands — does not exist yet.
- **`whoCell` counts failed deliveries across whatever the board holds**, including other drivers'
  runs, which is right for a manager and would be wrong if a driver ever saw it. He does not.
