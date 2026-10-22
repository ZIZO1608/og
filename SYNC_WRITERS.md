# Who can write to the Supabase mirror — 8 Oct 2026

Read-only investigation, after `npm run supabase:reconcile` on the VPS removed rows from the
mirror (13 sales, 16 sale lines, 4 print jobs, 1 product, 63 stock movements, 13 money moves…)
that the shop's own database does not have. Nothing was changed while writing this.

**Evidence used:**
- your `select * from sync_state`;
- the same table, read again from the VPS;
- the VPS's own database (read-only): `config`, `change_log`, `schema_migrations`, `print_jobs`,
  `sales`;
- this laptop's standby copy and its offline outbox;
- `server/backups/mirror-before-takeover-2026-09-13T14-05-32-779Z.json`, the snapshot of the
  mirror taken just before this laptop took it over from Ahmad;
- `server/lib/lineage.js`;
- the Supabase host named in every `.env*` file on this machine (host names only; no key was
  printed).

---

## 1. What "lineage" means, and who owns the mirror

**Lineage is the identity of a DATABASE, not of a machine.** The first database to sync makes a
random id (`7aa291b1-90ef-467f-b048-8935ed2fb250`). It keeps that id in its own `config` table
(`sync.lineage`) and writes it into the mirror's `sync_state` row `lineage`. The text after the id
(`DESKTOP-TG3H1NS`) is only a note: the hostname of the machine that made the claim, on 13 Sep.

Before **every** push (the live worker, `supabase:sync`, the reconcile, `users:mirror`), the code
compares the id in the local `config` with the id in the mirror and refuses when they differ
(`server/lib/lineage.js`). It compares the id and nothing else. It never looks at the hostname.

**The VPS pushes under that lineage, and it is the rightful owner.**
- On 25 Sep the VPS was started from a byte copy of this laptop's database, so its `config` holds
  the same id. Read today from the VPS: `sync.lineage = 7aa291b1-…`.
- Since the ids match, the VPS never has to claim the mirror again. That is why the row still says
  `DESKTOP-TG3H1NS` and 13 Sep.
- The `shop` row ("alive: nothing waiting", 8 Oct 18:59) is the VPS's two-minute heartbeat.

**DESKTOP-TG3H1NS (this laptop) does not push any more.**
- It is a standby (`OG_ROLE=standby`). A standby runs no workers and refuses writes.
- Its Supabase keys are parked as `#vps# …` lines in `server/.env`.
- Its database is a fresh copy of the VPS's, so it carries the same id. The guard alone would let
  it push; what stops it is that it has no key and no worker.

**The "reset: pulled onto Ahmad_Sabagh" rows (7 Sep)** are bookmarks that Ahmad's laptop reset
when it pulled the shop onto itself during the old baton system. They belong to tables that have
had no rows since (`expenses`, `debt_payments`, `loyalty_redemptions`, `wants`), so no push has
rewritten them. They are stale notes and harmless.

## 2. Could a second copy (Ahmad's laptop) push into this Supabase?

**What blocks it:** the lineage guard. Ahmad's database has its own lineage (from his 7 Sep pull),
which differs from `7aa291b1-…`. With the current code, every push from his machine is refused
("This computer isn't the shop") and no takeover switch exists any more. The lineage row is
unchanged since 13 Sep, so nobody has claimed the mirror since then.

**What does NOT block it — four real gaps:**

1. **Any copy of the shop's own database passes the guard.** A byte copy, a `VACUUM INTO` copy,
   or a restored backup carries the same `sync.lineage`. Run with the live Supabase keys, it
   pushes as if it were the shop: sales, print jobs, products, and also deletes. The guard cannot
   tell two databases with one id apart; `lineage.js` says so itself. It only stops a *different*
   database.
2. **Older code has no guard, or a weaker one.** Code from before 3 Sep 2026 has no lineage check
   at all. Code from before audit 06 had `OG_SYNC_TAKEOVER`, "Claim the mirror", and a boot pull
   that claimed the mirror automatically. An old checkout on another laptop, with the keys in its
   `.env`, can write.
3. **The guard lives in the app, not in Supabase.** The database accepts any request carrying the
   service-role key. The key is the real permission; the lineage check is good manners in our own
   code. Anything holding the key can write: an old script, `curl`, another tool.
4. **Storage uploads (photos, fonts) are not lineage-checked at all.** Anything with the key can
   upload or delete files in the buckets.

**Where the live key still exists on this machine** (only whether a file carries an uncommented
key line):

| File | Points at | Risk |
|---|---|---|
| `server/.env` (live) | the real project, **parked** (`#vps#`) | none while parked |
| `server/.env.before-standby-2026-09-25T07-14-07-591` | **the real project**, `OG_SYNC_MINUTES=60` | **live keys in a backup file.** Harmless unless something is started with `OG_ENV_FILE` pointing at it, but it is a copy of the key sitting in the open |
| `_handover/old-worktrees/og-web-orders/.env.sandbox` | `127.0.0.1` (a test stand-in) | none |
| `og-print-kits/server/.env.pk` | `127.0.0.1` (a test stand-in) | none |

Ahmad's laptop most likely still has the same live key in its `.env`: CLAUDE.md records that his
install ran "the same `.env`".

## 3. What most likely wrote the 13 sales and 4 print jobs, and what happened on 3 Oct at 18:07

### The 4 print jobs: two are known for certain

- The VPS has print jobs **P-1030 to P-1034**.
- The 13 Sep snapshot lists **P-1035 and P-1036** (made on 8 Sep, from the till) as "leftovers":
  rows only Ahmad's database had.
- So they were **Ahmad's**, from his baton days (7–13 Sep). The 13 Sep takeover saved them to the
  JSON file but left them in the mirror. Today's reconcile removed them.
- The same snapshot lists Ahmad-only **products 54–57**, 13 variants and job messages 23–27, so
  the product removed today was very likely one of those.
- The other two print jobs cannot be identified now. They were deleted, and their ids are not in
  the part of the reconcile output that was kept.

### The 13 sales: written after 13 Sep by a copy of THIS shop's database (most likely)

- On 13 Sep the mirror's sales were INV-2101 to INV-2120. **Every one of those ids exists in the
  shop**: Ahmad's sales reused the same numbers and were overwritten, not left over.
- The shop's database (VPS and laptop, identical) has INV-2101 to INV-2132, the last on 16 Sep.
- A reconcile deletes only rows whose id the shop does not have. So the 13 sales had **ids the
  shop never issued**, and they reached the mirror **after 13 Sep**.
- Since 13 Sep the mirror's owner has been `7aa291b1-…`, and the guard only lets that id push. So
  whatever wrote them was **a copy of the shop's own database, run with the live keys**. That is
  gap 1 above: the guard cannot see it.
- Invoice numbers continue from the copy, so its own sales got ids the real shop never reached.
- **Likely candidates:** the development servers started from copies of the live `og.db` during
  16–25 Sep (the old worktrees, which had their own copies of `server/.env` and `server/data`).
  CLAUDE.md records at least one of them touching the real database ("a Full refresh mid-edit
  applied migration 066 to the real og.db"). Any test sale rung up on such a copy went to the
  mirror and never into the database that became the VPS.

### 3 Oct 2026, 18:07 — the VPS replaying old deletes after its cursors were moved by someone else

What the records show:
- The VPS's own change log has **no deletes at all on 3 Oct**. On that evening it logged only one
  rate change (18:06:50).
- Its only large deletes are from **30 Aug at 15:00**, the demo purge: 40 customers, 24 products,
  142 variants, 284 stock rows, 26 sales.
- The 3 Oct notes in `sync_state` say "80 deleted" (customers), "48" (products), "284" (variants)
  and "408" (stock). That is the same set of August deletes, sent again; the doubled counts read
  like each delete being counted in both of the sync's passes.
- The VPS restarted twice that evening. One start was at about 18:06:35: the rate feed asks 15 s
  after boot, and the rate row is stamped 18:06:50. The second was at 18:08:36, when migrations
  068–070 were applied, i.e. the deploy of the coupons/website v1.5 work.
- The pushes stamped 18:07:06–18:07:58 fall between the two: the first full run after a boot.

What that means:
- A full run replays every delete it has ever made only when a table's bookmark in `sync_state`
  is **ahead of that table's own highest change-log number** on the pushing machine. The code then
  assumes the log was rebuilt, rewinds to 0 and replays.
- The VPS's bookmarks could only have been ahead of its own log if **another database had pushed
  and moved those bookmarks** after the VPS's previous run. That would be a copy with the same
  lineage whose change log had gone further.
- So 18:07 on 3 Oct is most likely the VPS's own reaction to that second writer: it re-sent its
  August deletes.
- Re-sending a delete for a row that is already gone does no harm. It did not delete any real
  data, but it is a footprint of the second writer.

**How to make this certain rather than "most likely":** in the Supabase dashboard, open **Logs →
API** (PostgREST) and filter by `2026-09-13 … 2026-10-08`. Look for `POST/PATCH` to `/rest/v1/sales`
and to `/rest/v1/sync_state`. Each request shows the caller's IP address:
- the VPS is `152.239.114.129`;
- this laptop's addresses appear in CLAUDE.md;
- anything else is the second writer.

The project's daily backup (if the plan has backups) still holds the 13 sales as they were.

## 4. The safest fix: only the live shop can ever write

In order of how much each closes. **The first one alone closes every gap**, and nothing on this
list has been done.

1. **Give the VPS a key nobody else has, and retire the old one.**
   - In Supabase → Project Settings → API keys, create a **new secret key**.
   - Put it **only** in the VPS's `og-shop.env`. `npm run vps -- env` writes that file; the key can
     be added to `extra.env` there.
   - Then **revoke the old service-role / secret key**.
   - Every other copy is then shut out at the database's own door, whatever its code, its lineage
     or its age: Ahmad's laptop, `server/.env.before-standby-…`, old worktrees, old checkouts, any
     script.
   - This is the only fix that does not depend on our own code being honest. Do it on a quiet
     moment, and check that `supabase:check` and the website's checkout still answer afterwards.
     The website uses the **publishable** key and its own website key, not this one.
2. **Make the guard know the machine, not only the database (a code change).**
   - The server writes a random `writer id` into a file in its data folder the first time it pushes
     (e.g. `data/mirror-writer.id`), and records it in `sync_state` beside the lineage.
   - Every push compares it as well as the lineage id.
   - A `VACUUM INTO` copy, a restored backup or a byte copy of `og.db` does not carry that file, so
     it is refused even though its lineage matches. That closes gap 1.
   - A deliberate move of the shop (the cut-over, a disaster restore) re-records it on purpose, the
     same way a restore mints a new lineage today.
3. **Turn sync off everywhere else, and remove the stray key.**
   - Delete `server/.env.before-standby-2026-09-25T07-14-07-591`, or move it into `_secrets/`.
     It is the only file on this laptop with the live key not parked.
   - Ask Ahmad to remove `SUPABASE_*` from his `.env`, or set `OG_SYNC_MINUTES=0` and
     `OG_PULL_AT_BOOT=0`.
   - Keep every test rig on `OG_ENV_FILE` with a fake or empty Supabase. Both test env files on
     this machine already are.
4. **Watch for it.**
   - Run `npm run supabase:check` on the VPS on a schedule (weekly, or after every deploy). It goes
     red on a row the shop does not have.
   - Make the reconcile **show what it is about to delete and stop**, unless run with `--apply`. It
     deleted straight away today, and its list was the only record of which rows they were.

**Recommendation:** do 1 now (it costs ten minutes and closes the door for good), then 3, then 2
and 4 when there is time.
