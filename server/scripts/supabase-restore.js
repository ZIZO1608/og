/* ==========================================================================
   OG SYSTEM — restore the shop FROM Supabase
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:restore

   The other direction. supabase-sync.js pushes SQLite to Supabase and never
   reads back, which is right for a mirror — but it means a shop machine that
   loses its database has its data sitting in Supabase with no way home. This
   is the way home.

   SQLite REMAINS the real system. This does not make Supabase the source of
   truth; it copies the mirror back into the database the till actually runs
   on, once, so the shop can carry on working offline exactly as before.

   ACCOUNTS
   --------
   Only with the vault. The mirror never holds a plain password hash, so a
   user row on its own would restore an account nobody could sign in to. What
   it can hold is a SEALED box (lib/credvault.js) that only this machine's
   OG_VAULT_KEY opens — and when one is present, the account comes back able
   to log in with the password it always had.

   Without OG_VAULT_KEY, users are skipped entirely rather than half-restored,
   and `npm run createuser` remains the way back in.

   REFUSES TO CLOBBER
   ------------------
   A table that already has rows locally is skipped unless --force. The
   dangerous case is not an empty database — it is a shop that has been
   selling all morning, whose local rows are NEWER than the mirror, being
   quietly overwritten by last night's copy. --force is how you say you mean
   it; `npm run backup` first is how you make that reversible.
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import * as Vault from '../lib/credvault.js';

const HERE = dirname(fileURLToPath(import.meta.url));

load();

const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry-run');

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m',
      DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
const head = (m) => console.log(`\n${BOLD}${m}${OFF}`);
const tick = (m) => console.log(`  ${GREEN}✓${OFF} ${m}`);
const warn = (m) => console.log(`  ${YELLOW}!${OFF} ${m}`);
const bad  = (m) => console.log(`  ${RED}✗${OFF} ${m}`);
const dim  = (m) => console.log(`    ${DIM}${m}${OFF}`);

/* Parent before child, every time: variants reference products, stock
   references variants, sales reference customers, and sale_items and
   deliveries reference sales. Restoring out of order trips the foreign keys
   the database is opened with (foreign_keys = ON).

   The first five carry no references at all and come first so the rest have
   somewhere to point: a rate needs its currencies, and a movement needs the
   variant and the warehouse it moved between. The last two come last for
   the same reason.

   currencies and warehouses are seeded by the migrations, so on any real
   database they are already populated and get skipped — they are listed for
   the case that matters, restoring onto a machine where they are not. */
const ORDER = [
  /* nothing points out of these */
  'currencies', 'warehouses', 'config', 'role_permissions', 'label_templates',
  'clubs', 'suppliers', 'employees',

  /* the catalogue and what was sold from it.

     sections and shelves sit between variants and stock and not anywhere
     else: a shelf names a product, and a stock row names a shelf. This
     database is opened with foreign_keys = ON, so getting it wrong does not
     drift quietly — it kills the restore partway through, the way
     sales.cashier_id did when accounts came last. */
  'products', 'variants', 'rooms', 'sections', 'shelves', 'stock',
  'customers', 'sales', 'sale_items', 'deliveries',

  /* a rate needs its currencies; a movement needs its variant and warehouse */
  'fx_rates', 'stock_movements',

  /* a job may name the sale that raised it; a line names a club; an invoice
     names jobs; a message hangs off one or the other */
  'print_jobs', 'print_job_lines', 'print_job_stages',
  'partner_invoices', 'partner_invoice_refs', 'partner_invoice_payments',
  'job_messages',

  /* an order names a supplier and a warehouse; its lines name variants */
  'purchase_orders', 'purchase_order_lines',

  'wa_messages', 'notification_reads',

  /* the drawer: a shift before the sales that stamp it, the payments after
     the sales they are against */
  'shifts', 'expenses', 'debt_payments',
  'stock_counts', 'stock_count_lines',

  /* what was printed, which the mirror has always had room for */
  'print_log', 'label_print_log'
];

/* These are not data somebody entered — the migrations seed them with
   defaults on every fresh database, so they are never empty and the
   'already has rows' guard would skip them forever. That guard exists to
   stop a restore trampling a shop's real stock; a default permission matrix
   is the opposite, a placeholder waiting to be replaced. Skipping them is
   how a manager rebuilds on a new machine and quietly gets the factory
   permissions back instead of the ones he set. */
const SEEDED = new Set([
  'currencies', 'warehouses', 'config', 'role_permissions', 'label_templates', 'fx_rates',
  /* the migration plants the nine clubs the shop prints, so this is never
     empty either and would be skipped forever without saying so */
  'clubs'
]);

const PAGE = 1000;   /* Supabase caps a REST read at 1000 rows per request. */

async function fetchAll(table, order) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await SB.select(table, { limit: PAGE, offset, order: order || undefined });
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/* Postgres hands back real booleans and, for a timestamp, a string. SQLite
   stores neither — booleans become 1/0 and everything else is already the
   text or number the local schema expects. Anything the local table does not
   have a column for is dropped rather than guessed at, so a mirror that has
   run ahead of this machine's migrations cannot break the insert. */
/* Postgres hands a TIMESTAMPTZ back as 2026-08-30T15:56:28.389+00:00; this
   database wrote it as 2026-08-30T15:56:28.389Z, and it compares and sorts
   those as strings (WHERE at >= ?, ORDER BY at). '+' sorts before 'Z', so a
   restored row and a row rung up a moment later in the same second would
   order wrong, and a mixed table is a table nobody can reason about. Put it
   back exactly as it was written. Only the unambiguous shape is touched. */
const PG_TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?[+-]\d\d:\d\d$/;
function adapt(row, cols) {
  const out = {};
  for (const c of cols) {
    if (!(c in row)) continue;
    const v = row[c];
    out[c] = typeof v === 'boolean' ? (v ? 1 : 0)
           : (v !== null && typeof v === 'object') ? JSON.stringify(v)
           : (typeof v === 'string' && PG_TS.test(v)) ? new Date(v).toISOString()
           : v;
  }
  return out;
}

/* The key, so a page boundary is a fixed place rather than wherever Postgres
   felt like cutting an unordered read — a row that moves across one is read
   twice or not at all. */
function pkOf(d, table) {
  return d.prepare(`SELECT name FROM pragma_table_info('${table}') WHERE pk > 0 ORDER BY pk`)
          .all().map((r) => r.name).join(',');
}

function columnsOf(d, table) {
  return d.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name);
}

function localCount(d, table) {
  try { return d.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
  catch { return null; }
}

/* -------------------------------------------------------------------- run */

console.log('');
console.log(`${BOLD}  OG SYSTEM — restore from Supabase${OFF}`);

if (!SB.isConfigured()) {
  bad('Supabase is not configured — nothing to restore from.');
  dim('Fill SUPABASE_URL and the secret key in server/.env, then: npm run supabase:check');
  process.exit(1);
}

const reach = await SB.ping();
if (!reach.ok) {
  bad(`Cannot reach Supabase — ${reach.message}`);
  process.exit(1);
}
tick(`Connected to ${SB.projectUrl()}`);

/* The same path the server and the sync script resolve, so all three always
   open the one database. migrate() is not called here — open() runs it. */
const DB_FILE = process.env.OG_DB || resolve(HERE, '..', 'data', 'og.db');
const d = DB.open(DB_FILE);

head('What is there');

const plan = [];
for (const table of ORDER) {
  const cols = columnsOf(d, table);
  if (!cols.length) { warn(`${table} — no such table locally, skipping`); continue; }

  let remote;
  try { remote = await fetchAll(table, pkOf(d, table)); }
  catch (e) { warn(`${table} — could not read from Supabase (${e.message}), skipping`); continue; }

  const here = localCount(d, table);
  const seeded = SEEDED.has(table);
  const blocked = here > 0 && !FORCE && !seeded;

  console.log(`  ${table.padEnd(17)} Supabase ${String(remote.length).padStart(5)}   ` +
              `local ${String(here).padStart(5)}   ` +
              (blocked ? `${YELLOW}skipped — already has rows${OFF}`
                       : (seeded && here > 0) ? `${DIM}replacing the defaults${OFF}` : ''));

  if (!blocked && remote.length) plan.push({ table, cols, rows: remote });
}

if (!plan.length) {
  head('Nothing to do');
  if (!FORCE) dim('Tables that already hold rows were left alone. Re-run with --force to overwrite them.');
  dim('Take a backup first if you do:  npm run backup');
  process.exit(0);
}

if (DRY) {
  head('Dry run — nothing written');
  plan.forEach((p) => dim(`${p.table}: would write ${p.rows.length} row(s)`));
  process.exit(0);
}

/* ---------------------------------------------------------------- accounts

   Before the tables, and separate from the loop that writes them. Before,
   because sales.cashier_id points at a user: restoring onto a genuinely
   empty machine — the case this whole script exists for — died on that
   foreign key partway through, leaving half a database behind. Separate,
   because a staff row carries something none of the others do and the
   rules for it differ at every step: sealed rather than plain, skipped
   rather than forced, and never allowed to overwrite a local account that
   already works. */
head('Accounts');

if (!Vault.isEnabled()) {
  warn('OG_VAULT_KEY is not set — accounts skipped.');
  dim('Without it a restored user could not sign in. Set it in server/.env,');
  dim('then re-run. New staff meanwhile:  npm run createuser');
} else {
  let remote = [];
  try { remote = await fetchAll('users', 'id'); }
  catch (e) { warn(`could not read users from Supabase (${e.message})`); }

  const sealed = remote.filter((u) => u.pw_enc);
  if (!remote.length) {
    warn('no users in the mirror');
  } else if (!sealed.length) {
    warn(`${remote.length} user(s) in the mirror, none with a sealed box.`);
    dim('They were synced before the vault was switched on. Run npm run supabase:sync');
    dim('on a machine that still has the accounts, then restore again.');
  } else {
    const cols = columnsOf(d, 'users');
    let added = 0, kept = 0, failed = 0;

    for (const u of sealed) {
      /* An account that already exists locally is never touched. The local
         row is the one with a password that currently works; the box is a
         copy of some earlier moment, and quietly winding a password back is
         the one outcome nobody would forgive. */
      const here = d.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(u.username);
      if (here && !FORCE) { kept++; continue; }

      let cred;
      try { cred = Vault.unsealUser(u.pw_enc); }
      catch (e) { failed++; if (failed === 1) bad(e.message); continue; }

      const row = adapt(u, cols);
      delete row.pw_enc;
      Object.assign(row, cred);

      const keys = Object.keys(row);
      d.prepare(`INSERT OR REPLACE INTO users (${keys.join(',')}) ` +
                `VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
      added++;
    }

    if (added) tick(`${added} account(s) restored — they can sign in with their existing password.`);
    if (kept) dim(`${kept} left alone because they already exist here (--force overwrites).`);
    if (failed) dim(`${failed} box(es) could not be opened with this OG_VAULT_KEY.`);
    if (!added && !failed && kept) tick('every mirrored account already exists here.');
  }
}

/* ------------------------------------------------- pointing at nothing
   THE MIRROR IS ALLOWED TO HOLD A PARENT THIS DATABASE NO LONGER HAS, and on
   one table that is by design: server/supabase/006_shelves.sql declares no
   foreign key on shelves.product_id, precisely so that a product deleted here
   — which nulls the shelf's product_id inside SQLite, writing no change_log
   entry and therefore never reaching the mirror — cannot block the products
   delete from being pushed.

   The consequence lands here. This database DOES enforce that key
   (023_shelves.sql, plus PRAGMA foreign_keys = ON), so inserting the mirrored
   row verbatim throws "FOREIGN KEY constraint failed", the top-level await
   rejects, and the restore stops after products, variants and sections have
   already committed — with stock, customers, sales and deliveries never
   restored and nothing in the message naming the table. Exactly the failure
   the sales.cashier_id ordering note at the top of this file describes.

   An assignment to a product that no longer exists is not information worth
   dying for: the shelf comes back unassigned, which is true. */
function clean(table, r, d) {
  if (table === 'shelves' && r.product_id != null) {
    if (d.prepare('SELECT 1 FROM products WHERE id = ?').get(r.product_id)) return r;
    orphaned++;
    return { ...r, product_id: null, size_from: null, size_to: null };
  }
  /* The same shape on the label history, and this one is guaranteed rather
     than occasional: label_print_log.job_id points at label_print_jobs, the
     live print queue that is deliberately never mirrored — so on the clean
     machine this script exists for, EVERY logged job is a job the database
     has not got, and the restore died on its last table with everything
     else already committed. Which batch a label came from is not worth
     that; the line keeps its sku, qty, station and time. */
  if (table === 'label_print_log' && r.job_id != null) {
    if (d.prepare('SELECT 1 FROM label_print_jobs WHERE id = ?').get(r.job_id)) return r;
    unqueued++;
    return { ...r, job_id: null };
  }
  return r;
}
let orphaned = 0;
let unqueued = 0;

head('Restoring');

let total = 0;
for (const { table, cols, rows } of plan) {
  /* One transaction per table: a table either lands completely or not at all,
     so a connection that drops halfway cannot leave variants pointing at
     products that never arrived. */
  const written = DB.tx(() => {
    let n = 0;
    for (const row of rows) {
      const r = clean(table, adapt(row, cols), d);
      const keys = Object.keys(r);
      if (!keys.length) continue;
      const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) ` +
                  `VALUES (${keys.map(() => '?').join(',')})`;
      d.prepare(sql).run(...keys.map((k) => r[k]));
      n++;
    }
    return n;
  });
  total += written;
  tick(`${table} — ${written} row(s)`);
  if (table === 'shelves' && orphaned) {
    warn(`${orphaned} shelf/shelves named a product this database does not have — ` +
         'restored unassigned.');
  }
  if (table === 'label_print_log' && unqueued) {
    dim(`${unqueued} label print(s) named a queue job this database does not have — ` +
        'restored without the job link.');
  }
}


/* Counters that live in their own table do not move when rows are written
   straight in like this, and a counter left behind the data hands the next
   product a code that already exists. nextLabelCode() also catches up on its
   own now, but leaving the database in a correct state beats relying on the
   next caller to notice. */
if (plan.some((p) => p.table === 'variants')) {
  const used = d.prepare(
    'SELECT MAX(CAST(label_code AS INTEGER)) AS m FROM variants WHERE label_code IS NOT NULL'
  ).get().m;
  if (used !== null) {
    const seq = d.prepare('SELECT next_value FROM label_code_seq WHERE id = 1').get();
    if (seq && seq.next_value <= used) {
      d.prepare('UPDATE label_code_seq SET next_value = ? WHERE id = 1').run(used + 1);
      tick('label code counter moved to ' + (used + 1) + ' (past the restored codes)');
    }
  }
}

head('Done');
console.log(`  ${total} row(s) restored into the local database.`);
dim('Check who can sign in with:  npm run preflight');
console.log('');
