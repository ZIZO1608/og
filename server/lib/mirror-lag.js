/* Columns this machine has and the Supabase mirror might not.
   ---------------------------------------------------------------------------
   The mirror's schema is applied BY HAND — `server/supabase/0NN_*.sql` run in
   the dashboard — while the local schema applies itself on boot. So between a
   local migration landing and somebody running the matching file, this machine
   has columns the mirror has never heard of, and PostgREST rejects a row
   carrying one with

       400  Could not find the 'credit_limit' column of 'customers'

   ...rejecting the WHOLE batch, not the column. A day of sales stops mirroring
   over an optional table nobody has created yet, which is a much worse failure
   than pushing the rows one column short and saying so.

   Both the sync and the reconcile need this list, and keeping it twice has now
   failed twice, both times the same way: the copy in supabase-reconcile.js was
   one entry short of the sync's, so the REPAIR tool threw on a table partway
   down and never reached the rows the check had sent somebody there to fix.
   Its own comment says as much — and it was still missing `sales`. Hence one
   list, imported by both, rather than a third chance to write it out by hand.

   Adding a column to a mirrored table means adding it HERE and writing the
   matching server/supabase/ file, in the same change.

   -- A fallback is a stopgap, and for some of these that is all it can be ----

   Dropping a column keeps the shop mirroring, but the mirror is what a rebuilt
   shop is restored FROM. `credit_limit` and `no_credit` decide whether somebody
   may owe the shop money; a restore from a mirror missing them hands back a
   shop where every credit rule has silently reset to "no limit". So the retry
   names the file every single run rather than settling in quietly. */

/* `retriedBy` says which tools actually apply the fallback, because they do not
   agree and the difference is deliberate — see print_log below. Anything that
   reports on this list has to say which, or it tells somebody their rows are
   being retried when they are not. */
export const MIRROR_LAG = {
  /* 033 — the credit rules and where a merged customer went. Measured against
     the live mirror on 2026-09-02: rejected. `customers` is pushed in the
     UNGUARDED core loop, so this one took sales and deliveries with it. */
  customers:  { cols: ['credit_limit', 'no_credit', 'merged_into'],
                file: 'server/supabase/011_credit_and_merge.sql', retriedBy: ['sync', 'reconcile'] },

  /* 032 — attaching an old print job to the person who ordered it (010), and
     035 — where the job was raised, till or by hand (012). Two files because
     they arrived months apart; the retry names whichever column was refused. */
  print_jobs: { cols: ['customer_id', 'source'],
                file: 'server/supabase/010_loyalty_and_wants.sql then 012_partner_link.sql',
                retriedBy: ['sync', 'reconcile'] },

  /* 035 — the payment handshake. These rows ride on partner_invoices'
     afterUpsert rather than a cursor of their own, so the sync's child insert
     applies this fallback itself (insertChildren in supabase-sync.js). A row
     pushed without them reads as an unconfirmed payment on a restore — which
     is why the reconcile is not optional once 012 is run. */
  partner_invoice_payments: { cols: ['recorded_by_side', 'confirmed_at', 'confirmed_by'],
                file: 'server/supabase/012_partner_link.sql', retriedBy: ['sync', 'reconcile'] },

  /* 023 — which shelf a pair sits on. */
  stock:      { cols: ['shelf_id'],
                file: 'server/supabase/006_shelves.sql', retriedBy: ['sync', 'reconcile'] },

  /* 026 — which wall a rack hangs on, and in which room (008); 036 — how big
     the rack is and where on the wall it stands, in centimetres (013). A
     restore without the second set hands back standard-size racks at
     bay-count positions: walkable, but a layout somebody has to fix. */
  sections:   { cols: ['room_id', 'wall', 'wall_pos', 'bay_cm', 'level_cm', 'depth_cm', 'wall_cm'],
                file: 'server/supabase/008_rooms.sql then 013_rack_size.sql',
                retriedBy: ['sync', 'reconcile'] },

  /* 017 — the shift a sale was rung up on. `sales` is likewise pushed outside
     the guard, which is why it had a fallback from the start. */
  sales:      { cols: ['shift_id'],
                file: 'server/supabase/005_money_and_counts.sql', retriedBy: ['sync', 'reconcile'] },

  /* 027 — gift receipts. NOTE: the sync deliberately does NOT apply this one.
     print_log is append-only, bookmarked by the highest id already sent, so
     dropping the column would land the rows and advance the bookmark past
     them — and nothing would ever look there again to fill `kind` in. Being
     late is recoverable; being silently wrong forever is not. The reconcile
     does use it, because repairing a row without `kind` still beats leaving
     the row absent altogether. */
  print_log:  { cols: ['kind'],
                file: 'server/supabase/009_gift_receipt.sql', retriedBy: ['reconcile'] }
};

/* The one place that decides whether a rejection is a lagging column or a real
   error. `e.message` is PostgREST's, and it names the column it could not
   find; anything else must keep throwing, or a genuine failure gets retried
   into silence. */
export function lagColumn(name, err) {
  const lag = MIRROR_LAG[name];
  if (!lag) return null;
  const hit = lag.cols.find((c) => String(err && err.message).includes(c));
  return hit ? { col: hit, file: lag.file, cols: lag.cols } : null;
}
