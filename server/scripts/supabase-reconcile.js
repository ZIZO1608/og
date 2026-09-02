/* ==========================================================================
   OG SYSTEM — make Supabase match the shop, exactly
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:reconcile -- --dry-run
         cd server && npm run supabase:reconcile

   WHY THIS EXISTS
   ---------------
   supabase-sync.js is a cursor over change_log: it pushes what the SERVER
   recorded itself doing. That is efficient and it is correct for everything
   the server does — but it is blind to anything that changed the database
   another way.

   Two such things have already happened here:

     - the demo-catalogue teardown (since deleted) removed rows with direct
       SQL and never called logChange(), so nineteen products vanished
       locally and stayed in the mirror forever.
     - supabase-restore.js writes rows in, also outside the log.

   The result is a mirror that drifts and a sync that reports "nothing new"
   while being visibly wrong. No cursor can repair that, because the evidence
   it would need was never written down.

   So this one does not trust the log at all. It reads both sides and makes
   them agree: upsert every local row, delete every mirrored row whose key is
   no longer here.

   DIRECTION IS FIXED. Local SQLite is the truth and Supabase is made to
   match it — never the other way round. Bringing data BACK is a different
   job with different rules, and it has its own script (supabase-restore.js).
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import { lagColumn } from '../lib/mirror-lag.js';

const HERE = dirname(fileURLToPath(import.meta.url));

load();

const DRY = process.argv.includes('--dry-run');

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m',
      DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
const head = (m) => console.log(`\n${BOLD}${m}${OFF}`);
const tick = (m) => console.log(`  ${GREEN}✓${OFF} ${m}`);
const warn = (m) => console.log(`  ${YELLOW}!${OFF} ${m}`);
const bad  = (m) => console.log(`  ${RED}✗${OFF} ${m}`);
const dim  = (m) => console.log(`    ${DIM}${m}${OFF}`);

/* Children before parents when deleting, parents before children when
   upserting — the mirror has real foreign keys, so the order is not a
   preference. `key` is what identifies a row on both sides. */
const TABLES = [
  { name: 'products',   key: 'id' },
  { name: 'variants',   key: 'sku' },
  { name: 'stock',      key: ['sku', 'wh_id'] },
  /* The only repair path for a shelf whose log entry was consumed by a run
     that did not land it — the cursor is legitimately past it, so no rewind
     will ever look there again. rooms first: a section names the room it
     hangs in. Until 008 is run in the dashboard the table is not there, and
     the read below says so by name and moves on. */
  { name: 'rooms',      key: 'id' },
  { name: 'sections',   key: 'id' },
  { name: 'shelves',    key: 'id' },
  { name: 'customers',  key: 'id' },
  { name: 'sales',      key: 'id' },
  { name: 'sale_items', key: 'id' },
  { name: 'deliveries', key: 'id' },

  /* EVERYTHING ELSE THE SYNC PUSHES, in the foreign-key order the restore
     reads them. This list used to stop at deliveries while the check sent
     people here for stock_counts, stock_movements, print_log and the partner
     tables as well — "it pushes what is missing" was true for ten tables and
     a promise for the rest. Left out on purpose: config, role_permissions,
     label_templates, clubs, notification_reads and users, which the ordinary
     sync rewrites whole on every run and so cannot drift. */
  { name: 'fx_rates',                 key: 'id' },
  { name: 'stock_movements',          key: 'id' },
  { name: 'print_log',                key: 'id' },
  { name: 'label_print_log',          key: 'id' },
  { name: 'suppliers',                key: 'id' },
  { name: 'employees',                key: 'id' },
  { name: 'print_jobs',               key: 'id' },
  { name: 'print_job_lines',          key: 'id' },
  { name: 'print_job_stages',         key: 'id' },
  { name: 'partner_invoices',         key: 'id' },
  { name: 'partner_invoice_refs',     key: ['invoice_id', 'job_id'] },
  { name: 'partner_invoice_payments', key: 'id' },
  { name: 'job_messages',             key: 'id' },
  { name: 'purchase_orders',          key: 'id' },
  { name: 'purchase_order_lines',     key: 'id' },
  { name: 'wa_messages',              key: 'id' },
  { name: 'shifts',                   key: 'id' },
  { name: 'expenses',                 key: 'id' },
  { name: 'debt_payments',            key: 'id' },
  { name: 'stock_counts',             key: 'id' },
  { name: 'stock_count_lines',        key: 'id' }
];

const PAGE = 1000;

/* Ordered by the key. Paging by offset over an unordered read is only stable
   by luck — Postgres is free to hand the pages back in a different order
   while rows are being written, and a row that moves across a page boundary
   is read twice or not at all. */
async function remoteAll(table, key) {
  const order = Array.isArray(key) ? key.join(',') : key;
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await SB.select(table, { order, limit: PAGE, offset });
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const keyOf = (row, key) =>
  Array.isArray(key) ? key.map((k) => String(row[k])).join('\u0000') : String(row[key]);

/* SQLite hands back 0/1 where Postgres wants true/false. Every column the
   mirror DDL declares BOOLEAN, so the row lands as the sync would send it.
   (PostgREST does accept a bare 0/1 for a boolean — it casts through text —
   which is why the old three-entry list never actually failed; but a mirror
   read back by a report should hold the type it declares.) */
const BOOLS = {
  products: ['hidden', 'demo'], customers: ['archived', 'demo'], sales: ['voided'],
  users: ['active'], suppliers: ['archived'], employees: ['archived'],
  job_messages: ['read_og', 'read_yl']
};
function forPg(table, row) {
  const out = { ...row };
  for (const c of BOOLS[table] || []) if (c in out) out[c] = !!out[c];
  return out;
}

console.log('');
console.log(`${BOLD}  OG SYSTEM — reconcile Supabase with the shop${OFF}`);
if (DRY) dim('dry run — nothing will be written or deleted');

if (!SB.isConfigured()) { bad('Supabase is not configured.'); process.exit(1); }
const reach = await SB.ping();
if (!reach.ok) { bad(`Cannot reach Supabase — ${reach.message}`); process.exit(1); }
tick(`Connected to ${SB.projectUrl()}`);

DB.open(process.env.OG_DB || resolve(HERE, '..', 'data', 'og.db'));

const plan = [];

head('Comparing');
for (const { name, key } of TABLES) {
  let local;
  try { local = DB.get().prepare(`SELECT * FROM ${name}`).all(); }
  catch { warn(`${name} — no such table locally, skipping`); continue; }

  let remote;
  try { remote = await remoteAll(name); }
  catch (e) { warn(`${name} — could not read from Supabase (${e.message}), skipping`); continue; }

  const localKeys = new Set(local.map((r) => keyOf(r, key)));
  const remoteKeys = new Set(remote.map((r) => keyOf(r, key)));
  const orphans = remote.filter((r) => !localKeys.has(keyOf(r, key)));

  /* BOTH directions, or the report lies in the one that matters most. This
     line used to be derived from orphans alone, so a table missing rows in
     Supabase — the actual disaster, a sale that never mirrored — printed
     "in step" while five invoices were absent. Reassurance of that kind is
     what let the gap sit unnoticed. */
  const missing = local.filter((r) => !remoteKeys.has(keyOf(r, key))).length;
  const notes = [];
  if (missing) notes.push(`${YELLOW}${missing} missing there${OFF}`);
  if (orphans.length) notes.push(`${YELLOW}${orphans.length} to delete${OFF}`);

  console.log(`  ${name.padEnd(11)} local ${String(local.length).padStart(5)}   ` +
              `Supabase ${String(remote.length).padStart(5)}   ` +
              (notes.length ? notes.join(', ') : 'in step'));

  plan.push({ name, key, local, orphans, missing });
}

const totalOrphans = plan.reduce((a, p) => a + p.orphans.length, 0);
if (totalOrphans) {
  head('Rows in Supabase that no longer exist here');
  for (const p of plan) {
    if (!p.orphans.length) continue;
    const ids = p.orphans.map((r) => keyOf(r, p.key).replace(/\u0000/g, ':'));
    dim(`${p.name}: ${ids.slice(0, 25).join(', ')}${ids.length > 25 ? ` … +${ids.length - 25}` : ''}`);
  }
}

const totalMissing = plan.reduce((a, p) => a + p.missing, 0);
if (totalMissing) {
  head('Rows here that never reached Supabase');
  for (const p of plan) {
    if (p.missing) dim(`${p.name}: ${p.missing} row(s)`);
  }
}

if (DRY) {
  head('Dry run — nothing written');
  dim(`${plan.reduce((a, p) => a + p.local.length, 0)} row(s) would be pushed ` +
      `(${totalMissing} of them not in Supabase at all).`);
  dim(`${totalOrphans} row(s) would be deleted from Supabase.`);
  process.exit(0);
}

/* Upsert parents first. */
head('Pushing the shop up');
/* A column this machine has and the mirror has not.

   The ordinary sync carries the same fallback and prints the file to run; this
   script had nothing, so a mirror one schema file behind made the REPAIR tool
   the thing that needed repairing — it threw on the first table carrying the
   new column and stopped before touching any of the others. Same shape as
   syncTable's retry: try it properly, and on a rejection naming the column,
   push without it and say what to run.

   The list itself now lives in lib/mirror-lag.js and is shared with the sync.
   It was kept by hand here and drifted twice — once short of `sections`, which
   threw on the fourth table and never reached the sales somebody had been sent
   here to repair, and again short of `sales` itself. */

async function push(name, rows) {
  try {
    await SB.insert(name, rows, { upsert: true });
    return;
  } catch (e) {
    const lag = lagColumn(name, e);
    if (!lag) throw e;
    warn(`Supabase has no ${name}.${lag.col} column yet — pushing without it.`);
    dim(`Run ${lag.file} in the SQL editor.`);
    await SB.insert(name, rows.map((r) => {
      const copy = { ...r };
      for (const c of lag.cols) delete copy[c];
      return copy;
    }), { upsert: true });
  }
}

for (const { name, local } of plan) {
  if (!local.length) { dim(`${name}: nothing to push`); continue; }
  await push(name, local.map((r) => forPg(name, r)));
  tick(`${name} — ${local.length} row(s) upserted`);
}

/* Delete children first, so a parent never goes while a row still points at
   it. Same list, walked backwards. */
if (totalOrphans) {
  head('Removing what the shop no longer has');
  for (const { name, key, orphans } of [...plan].reverse()) {
    if (!orphans.length) continue;
    let gone = 0;
    for (const row of orphans) {
      const match = Array.isArray(key)
        ? Object.fromEntries(key.map((k) => [k, row[k]]))
        : { [key]: row[key] };
      try { await SB.remove(name, match); gone++; }
      catch (e) { bad(`${name} ${keyOf(row, key)} — ${e.message}`); }
    }
    tick(`${name} — ${gone} row(s) deleted`);
  }
}

head('Done');
console.log('  Supabase now matches the shop.');
dim('Routine changes still ride the normal sync — this is only for repairing drift.');
console.log('');
