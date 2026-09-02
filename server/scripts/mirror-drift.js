/* ==========================================================================
   OG SYSTEM — is any column here unknown to the mirror, and is it declared?
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:drift

   READ-ONLY on both sides. Writes nothing, anywhere.

   THE BUG THIS CATCHES
   --------------------
   The local schema migrates itself on boot. The mirror's is applied BY HAND,
   by somebody pasting server/supabase/0NN_*.sql into the dashboard. So every
   local migration that adds a column to a mirrored table opens a window where
   this machine has a column Supabase has never heard of — and PostgREST does
   not skip that column, it rejects the whole batch:

       400  Could not find the 'credit_limit' column of 'customers'

   For a table pushed in the unguarded core loop that does not stop customers,
   it stops customers AND sales AND deliveries. A day of real selling goes
   unmirrored over a column nobody has created yet.

   lib/mirror-lag.js is the declared list of those windows, and the sync and
   the reconcile both retry against it. But the list is written by hand too,
   so it can be short — and a window nobody declared is exactly the one that
   bites, because it fails silently on a machine nobody is watching.

   So this does not ask "is the list right". It reads the columns Supabase
   actually exposes, compares them against the columns this database actually
   has, and goes red on any difference that lib/mirror-lag.js has not
   declared. The list can no longer quietly fall behind the schema.

   It is deliberately NOT the same job as supabase:check. That answers "is the
   mirror a faithful copy of the DATA". This answers "can the next write even
   land", which is a question about the SHAPE, and is the one that was
   answered by a day of missing sales rather than by a command.
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import { MIRROR_LAG } from '../lib/mirror-lag.js';

const HERE = dirname(fileURLToPath(import.meta.url));
load();

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m',
      DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
const head = (m) => console.log(`\n${BOLD}${m}${OFF}`);
const tick = (m) => console.log(`  ${GREEN}✓${OFF} ${m}`);
const warn = (m) => console.log(`  ${YELLOW}!${OFF} ${m}`);
const bad  = (m) => console.log(`  ${RED}✗${OFF} ${m}`);
const dim  = (m) => console.log(`    ${DIM}${m}${OFF}`);

/* Every table whose ROWS are pushed with SELECT * — the ones where an extra
   local column becomes a rejected batch. Tables the sync builds a column list
   for by hand (users, most obviously, which names its columns precisely so no
   password hash can pass through) cannot drift this way and are left out. */
const PUSHED = [
  'products', 'variants', 'stock', 'customers', 'sales', 'sale_items',
  'deliveries', 'rooms', 'sections', 'shelves',
  'fx_rates', 'stock_movements', 'print_log', 'label_print_log',
  'suppliers', 'employees',
  'print_jobs', 'print_job_lines', 'print_job_stages', 'job_reviews',
  'partner_invoices', 'partner_invoice_refs', 'partner_invoice_payments',
  'job_messages', 'purchase_orders', 'purchase_order_lines',
  'wa_messages', 'shifts', 'expenses', 'debt_payments',
  'stock_counts', 'stock_count_lines',
  'loyalty_redemptions', 'wants',
  'config', 'role_permissions', 'label_templates', 'clubs', 'notification_reads'
];

console.log('');
console.log(`${BOLD}  OG SYSTEM — mirror schema drift${OFF}`);

if (!SB.isConfigured()) { bad('Supabase is not configured.'); process.exit(1); }
const reach = await SB.ping();
if (!reach.ok) { bad(`Cannot reach Supabase — ${reach.message}`); process.exit(1); }
tick(`Connected to ${SB.projectUrl()}`);

/* openReadOnly, not open: DB.open() applies pending migrations, and a check
   that changes the schema it is checking is not a check. Same rule the
   Supabase check already follows and for the same reason. */
DB.openReadOnly(process.env.OG_DB || resolve(HERE, '..', 'data', 'og.db'));

/* Every column PostgREST will accept, per table — the thing that actually
   decides whether a push lands. Read through lib/supabase.js so the key stays
   inside the one module that is allowed to hold it. */
const schema = await SB.columns();
const remoteCols = (table) => schema.get(table) || null;

function localCols(table) {
  try { return DB.get().prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); }
  catch { return null; }
}

let undeclared = 0, missingTables = 0, checked = 0, covered = 0;

head('Columns this machine has that the mirror has not');
for (const t of PUSHED) {
  const here = localCols(t);
  if (!here || !here.length) { dim(`${t} — not a table here, skipped`); continue; }

  const there = remoteCols(t);
  if (there === null) {
    bad(`${t} — no such table in Supabase`);
    missingTables++;
    continue;
  }

  checked++;
  const extra = here.filter((c) => !there.includes(c));
  if (!extra.length) continue;

  const lag = MIRROR_LAG[t];
  const declared = extra.filter((c) => lag && lag.cols.includes(c));
  const loose = extra.filter((c) => !declared.includes(c));

  if (declared.length) {
    /* Which tools retry is not decoration. print_log is append-only and the
       sync deliberately does NOT drop `kind` — advancing the bookmark past
       rows written without it would mean nothing ever looks there again. So
       saying "the sync will push without it" here would be a plain untruth
       about the one table where being late is the correct behaviour. */
    const by = lag.retriedBy || [];
    const it = declared.length > 1 ? 'them' : 'it';
    warn(`${t} — ${declared.join(', ')} (declared)`);
    dim(by.includes('sync')
      ? `The sync pushes these rows without ${it} and names the file every run.`
      : `The sync does NOT drop ${it} here — these rows are simply not mirrored ` +
        'yet, and land in full once the file is run. Only the reconcile retries.');
    dim(`Run ${lag.file} in the SQL editor to close it properly.`);
    covered++;
  }
  if (loose.length) {
    /* The failure mode this whole script exists for. */
    bad(`${t} — ${loose.join(', ')} is NOT in lib/mirror-lag.js`);
    dim('Every write to this table is being rejected, and nothing retries.');
    dim('Add it to MIRROR_LAG and write the matching server/supabase/ file.');
    undeclared++;
  }
}
if (!undeclared && !covered && !missingTables) tick(`all ${checked} pushed tables match, column for column`);

/* An entry whose columns THIS mirror already has is not a dead entry, and the
   distinction matters: a fresh Supabase project — which is the whole point of
   the restore path — starts with none of these files run, and the fallback is
   what carries the first sync. So these are reported as satisfied here, and
   explicitly not as something to delete. Only an entry naming a table or a
   column that no longer exists LOCALLY is actually stale. */
head('Entries in mirror-lag.js, against this mirror');
let stale = 0;
for (const [t, lag] of Object.entries(MIRROR_LAG)) {
  const here = localCols(t), there = remoteCols(t);
  if (!here) { bad(`${t} — declared, but there is no such table here. Stale.`); stale++; continue; }

  const unknown = lag.cols.filter((c) => !here.includes(c));
  if (unknown.length) {
    bad(`${t} — names ${unknown.join(', ')}, which this database has not got. Stale.`);
    stale++;
    continue;
  }
  if (there === null) { dim(`${t} — the table itself is missing in Supabase; entry stands`); continue; }

  if (lag.cols.every((c) => there.includes(c))) {
    tick(`${t} — this mirror already has ${lag.cols.join(', ')}; keep the entry for a fresh project`);
  } else {
    dim(`${t} — still covering a real gap`);
  }
}
if (!stale) tick('no entry is stale — every one names columns this database really has');

head('Result');
if (stale) {
  /* Red, not a warning. A stale entry means the retry is silently dead: it
     matches on the column name appearing in PostgREST's message, so an entry
     naming a column nothing sends any more can never fire, and the next real
     rejection on that table goes uncaught. */
  bad(`${stale} entr${stale === 1 ? 'y' : 'ies'} in lib/mirror-lag.js ${stale === 1 ? 'does' : 'do'} not match this schema any more.`);
  process.exit(1);
}
if (undeclared) {
  bad(`${undeclared} table(s) are being rejected with nothing to catch them.`);
  process.exit(1);
}
if (missingTables) {
  bad(`${missingTables} table(s) do not exist in Supabase at all.`);
  dim('Run the matching file in server/supabase/ — supabase:check names which.');
  process.exit(1);
}
if (covered) {
  warn(`${covered} table(s) are mirroring one or more columns short.`);
  dim('The shop keeps working; a RESTORE from this mirror would not put those back.');
  process.exit(1);
}
tick('The mirror can accept every row this machine would send it.');
