/* ==========================================================================
   OG SYSTEM — is any column here unknown to the mirror?             [drift.js]
   --------------------------------------------------------------------------
   The body of scripts/mirror-drift.js, as a library, because the boot pull
   (lib/restore.js) has to ask the same question before it wipes anything —
   in the OTHER direction. READ-ONLY on both sides. Writes nothing, anywhere.

   THE BUG THIS CATCHES
   --------------------
   The local schema migrates itself on boot. The mirror's is applied BY HAND,
   by somebody pasting server/supabase/0NN_*.sql into the dashboard. So every
   local migration that adds a column to a mirrored table opens a window where
   this machine has a column Supabase has never heard of — and PostgREST does
   not skip that column, it rejects the whole batch:

       400  Could not find the 'credit_limit' column of 'customers'

   lib/mirror-lag.js is the declared list of those windows, and the sync and
   the reconcile both retry against it. But the list is written by hand too,
   so it can be short — and a window nobody declared is exactly the one that
   bites, because it fails silently on a machine nobody is watching.

   So this does not ask "is the list right". It reads the columns Supabase
   actually exposes, compares them against the columns this database actually
   has, and reports any difference lib/mirror-lag.js has not declared.

   FOR A PULL the same gap is data loss rather than a rejected push: a column
   the mirror has not got comes back NULL — credit rules reset, the rack
   layout gone — so the pull refuses on ANY of these, declared or not. And the
   reverse matters there too: a column the MIRROR has and this database has
   not means this laptop's code is behind, and the restore would drop the
   value on the way in. That is `ahead`, and the fix is `git pull`.
   ========================================================================== */

import * as DB from './db.js';
import * as SB from './supabase.js';
import { MIRROR_LAG } from './mirror-lag.js';

/* Every table whose ROWS are pushed with SELECT * — the ones where an extra
   local column becomes a rejected batch. Tables the sync builds a column list
   for by hand (users, most obviously, which names its columns precisely so no
   password hash can pass through) cannot drift this way and are left out. */
export const PUSHED = [
  'products', 'variants', 'stock', 'customers', 'sales', 'sale_items',
  'deliveries', 'rooms', 'sections', 'shelves',
  'fx_rates', 'stock_movements', 'print_log', 'label_print_log',
  'suppliers', 'employees',
  'print_jobs', 'print_job_lines', 'print_job_stages', 'job_reviews',
  'partner_invoices', 'partner_invoice_refs', 'partner_invoice_payments',
  'job_messages', 'purchase_orders', 'purchase_order_lines',
  'wa_messages', 'shifts', 'expenses', 'debt_payments', 'order_payments',
  'handovers', 'handover_lines', 'order_returns', 'order_return_lines', 'customer_credit',
  'stock_counts', 'stock_count_lines',
  'loyalty_redemptions', 'wants',
  'config', 'role_permissions', 'label_templates', 'clubs', 'notification_reads'
];

/* Columns the mirror has that this database has not, and that are meant to be
   that way: the sealed credential box exists only there. */
const AHEAD_OK = { users: ['pw_enc'] };

/* And the reverse: columns this database has that the mirror must NEVER get.
   The sync names users' columns by hand precisely so these cannot pass
   through (lib/mirror.js syncUsers), so their absence there is the design,
   not drift. The old script left users out altogether; the pull needs the
   rest of the table checked, so the exception is spelled out instead. */
const LOCAL_ONLY = { users: ['pw_hash', 'pw_salt', 'pw_hint', 'must_change'] };

function localCols(table) {
  try { return DB.get().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); }
  catch { return null; }
}

/* { checked, notLocal, missingTables, undeclared, declared, ahead, entries }

   undeclared  [{table, cols}]                  local columns the mirror lacks, NOT in mirror-lag.js
   declared    [{table, cols, file, retriedBy}] local columns the mirror lacks, declared
   ahead       [{table, cols}]                  mirror columns this database lacks (only with ahead:true)
   entries     one per MIRROR_LAG entry: { table, state: 'stale'|'table_missing'|'satisfied'|'covering', ... } */
export async function check({ tables = PUSHED, ahead = false } = {}) {
  const schema = await SB.columns();
  const out = { checked: 0, notLocal: [], missingTables: [], undeclared: [], declared: [], ahead: [], entries: [] };

  for (const t of tables) {
    const here = localCols(t);
    if (!here || !here.length) { out.notLocal.push(t); continue; }

    const there = schema.get(t) || null;
    if (there === null) { out.missingTables.push(t); continue; }

    out.checked++;
    const keep = LOCAL_ONLY[t] || [];
    const extra = here.filter((c) => !there.includes(c) && !keep.includes(c));
    const lag = MIRROR_LAG[t];
    const declared = extra.filter((c) => lag && lag.cols.includes(c));
    const loose = extra.filter((c) => !declared.includes(c));
    if (declared.length) out.declared.push({ table: t, cols: declared, file: lag.file, retriedBy: lag.retriedBy || [] });
    if (loose.length) out.undeclared.push({ table: t, cols: loose });

    if (ahead) {
      const fine = AHEAD_OK[t] || [];
      const more = there.filter((c) => !here.includes(c) && !fine.includes(c));
      if (more.length) out.ahead.push({ table: t, cols: more });
    }
  }

  /* An entry whose columns THIS mirror already has is not a dead entry: a
     fresh Supabase project starts with none of these files run, and the
     fallback is what carries the first sync. Only an entry naming a table or
     a column that no longer exists LOCALLY is actually stale — and stale is
     red, because the retry matches on the column name appearing in
     PostgREST's message, so an entry naming a column nothing sends any more
     can never fire, and the next real rejection on that table goes uncaught. */
  for (const [t, lag] of Object.entries(MIRROR_LAG)) {
    const here = localCols(t), there = schema.get(t) || null;
    if (!here) { out.entries.push({ table: t, state: 'stale', reason: 'there is no such table here' }); continue; }
    const unknown = lag.cols.filter((c) => !here.includes(c));
    if (unknown.length) {
      out.entries.push({ table: t, state: 'stale', reason: `names ${unknown.join(', ')}, which this database has not got`, cols: unknown });
      continue;
    }
    if (there === null) { out.entries.push({ table: t, state: 'table_missing' }); continue; }
    out.entries.push({ table: t, state: lag.cols.every((c) => there.includes(c)) ? 'satisfied' : 'covering', cols: lag.cols });
  }

  return out;
}
