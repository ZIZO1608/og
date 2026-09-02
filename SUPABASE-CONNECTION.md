# SUPABASE-CONNECTION.md — the mirror, checked end to end

Done on **2026-09-02** against `wsuqoippcxcwoszcgagc`. Nothing was committed, nothing was deployed,
and no row was deleted from the mirror.

**Short version: the data is fully mirrored. The schema is four files behind, and only somebody with
the dashboard login can close that.** One paste — `server/supabase/CATCH-UP.sql` — plus one command
afterwards.

---

## 1. First, whose database is this

The 2026-08-30 incident was a *test* database pointed at the *live* project: it pushed its own users
in beside the shop's, wrote its own shorter `change_log` seqs into every cursor, and its purge
deleted the shop's real rows. So before pushing anything, I checked which database this machine
holds.

```
34 migrations · 2 customers · 13 sales · 4 products · 5 users
change_log max seq 1726 · 0 test rows
```

The real shop. Safe to sync.

## 2. What the check says now

`npm run supabase:check` — **exit 1**, and correctly so.

| | |
|---|---|
| Connection, both keys | ✓ accepted |
| Tables matching row for row | **✓ 33** |
| Sync bookmarks | **✓ 26 healthy**, none ahead of its own table |
| Sealed passwords | ✓ all 7 mirrored accounts carry one |
| Missing columns | ✗ 4 tables |
| Missing tables | ✗ 3 |
| Accounts | ! 5 here, 7 there |

**Every red line is schema or the old incident. Not one is data this machine failed to push.**

`npm run supabase:sync` completed cleanly, naming what it could not do and pushing everything else —
which is the designed behaviour, not a workaround. `role_permissions` went up at 155 rows, so the
`debt.collect` permission added during Stage F is now mirrored.

---

## 3. What I found while checking, and fixed

### 3.1 The shop was one customer edit away from a day going unmirrored

Local migration `033` added `credit_limit`, `no_credit` and `merged_into` to `customers`. The
matching Supabase file was never written — my omission, from Stage F.

`customers` is fetched with `SELECT *` and pushed in the **unguarded** core loop. I measured what
that actually does, read-only, by PATCHing a filter that matches no row so PostgREST resolves the
column names without writing anything:

```
the row as the sync sends it            -> 400  Could not find the 'credit_limit' column of 'customers'
the same row without the three columns  -> 204
```

PostgREST rejects the **whole batch**, not the column. Unguarded means that rejection does not skip
customers — it takes **sales and deliveries down with it**. The mirror looked healthy only because
nobody had edited a customer since `033` landed.

Written `server/supabase/011_credit_and_merge.sql`, and added the fallback so the shop keeps
mirroring until it is run.

### 3.2 The fallback list was kept twice and had drifted again

`supabase-sync.js` and `supabase-reconcile.js` each held their own copy. The reconcile's comment
already records this failing once — short of `sections`, so the **repair** tool threw on the fourth
table and never reached the sales the check had sent somebody there to fix.

It was short again: no `sales` entry at all.

Both now import **`server/lib/mirror-lag.js`**, one list. Each entry carries `retriedBy`, because the
two tools deliberately disagree — `print_log` is append-only, so the sync must *not* drop `kind`:
landing those rows would advance the bookmark past them and nothing would ever fill it in. Late is
recoverable; silently wrong forever is not.

### 3.3 `010` never turned on row-level security

Every schema file since `001` enables RLS on the tables it creates — `001`'s own header states the
invariant. `010_loyalty_and_wants.sql` was the one that did not, and its two tables are the shop's
customer list joined to their behaviour: who asked for which pair, and what each person has claimed.
That is the category `FORBIDDEN` in `server/lib/auth.js` refuses even to the print partner.

An oversight, not a decision. Fixed.

### 3.4 A new check, because this was answered by a day of missing sales rather than by a command

`npm run supabase:drift`. Read-only on both sides, writes nothing.

`supabase:check` asks *is the mirror a faithful copy of the data*. This asks *can the next write even
land* — a question about the shape. It reads the columns PostgREST actually exposes (from the OpenAPI
document, not from a row, because an empty table returns no columns and would look identical to a
broken one), compares them against this database's, and **goes red on any difference
`mirror-lag.js` has not declared.** The hand-kept list can no longer quietly fall behind the schema.

Both new branches were proved by breaking the list on purpose:

```
removed 'credit_limit' from the entry
  ✗ customers — credit_limit is NOT in lib/mirror-lag.js
  ✗ 1 table(s) are being rejected with nothing to catch them.

added a column that never existed
  ✗ sales — names column_that_never_existed, which this database has not got. Stale.
```

A stale entry is red rather than a warning: the retry matches on the column name appearing in
PostgREST's message, so an entry naming a column nothing sends any more can never fire, and the next
real rejection on that table goes uncaught.

---

## 4. What I could not do, and why

**Run the four SQL files.** I probed whether this project can execute DDL over the API before
handing you a list of manual steps. It exposes 40 tables and exactly one RPC (`rls_auto_enable`);
`exec_sql`, `execute_sql`, `sql`, `query` and `run_sql` all 404. **DDL genuinely requires the
dashboard SQL editor.** The probe never printed a key.

---

## 5. What is left — one paste and one command

Open the Supabase dashboard → SQL editor, paste **`server/supabase/CATCH-UP.sql`**, run once.

It is `008` + `009` + `010` + `011` concatenated — 19 statements, every one `CREATE TABLE IF NOT
EXISTS` / `ADD COLUMN IF NOT EXISTS`, nothing destructive, safe to run twice.

| File | What it adds | Cost of not running it |
|---|---|---|
| `008_rooms.sql` | `rooms`; `sections.room_id/wall/wall_pos` | the shelf map's layout is not mirrored at all |
| `009_gift_receipt.sql` | `print_log.kind` | print history retries every run — late, not lost |
| `010_loyalty_and_wants.sql` | `loyalty_redemptions`, `wants`, `print_jobs.customer_id` | **a redemption is recoverable from nothing** |
| `011_credit_and_merge.sql` | the three `customers` columns | a restore resets every credit rule to "no limit" |

Then, and this is **not optional**:

```bash
cd server
npm run supabase:reconcile   # refills the columns the sync pushed as dropped
npm run supabase:drift       # should go green
npm run supabase:check       # confirms the data too
```

The reconcile is required because the sync pushed `sections` and `customers` with those columns
*dropped*, and its cursor is already past those rows. The columns will exist after the paste and stay
**NULL** until the reconcile refills them. No rewind will ever look there again.

---

## 6. The one thing I did not touch, because it is your call

Two accounts exist in the mirror and not here, left by the 2026-08-30 incident:

```
Ahmad (active)
httptest-cash (active)
```

**A restore would recreate them, as working logins on the shop's till.** Both carry a sealed password
box, so whoever holds `OG_VAULT_KEY` could sign in as them.

Deleting rows from the shared mirror is outward-facing and not reversible — their sealed boxes go
with them — so I have not. Say the word and I will. The alternative the check offers, creating them
here, only makes sense if either name means something to you; `httptest-cash` reads like a test
fixture, `Ahmad` does not.
