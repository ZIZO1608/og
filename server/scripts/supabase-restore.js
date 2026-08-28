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

   WHAT IT WILL NOT DO
   -------------------
   Users. The mirror holds username/name/role/phone/active and deliberately
   never held a password hash — see the header of supabase-sync.js. Restoring
   those rows would create accounts nobody can sign in to, and would overwrite
   the local rows that DO have passwords. Staff are recreated with
   `npm run createuser`, which is the only path that sets a password at all.

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
   the database is opened with (foreign_keys = ON). */
const ORDER = ['products', 'variants', 'stock', 'customers', 'sales', 'sale_items', 'deliveries'];

const PAGE = 1000;   /* Supabase caps a REST read at 1000 rows per request. */

async function fetchAll(table) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await SB.select(table, { limit: PAGE, offset });
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/* Postgres hands back real booleans and, for a timestamp, a string. SQLite
   stores neither — booleans become 1/0 and everything else is already the
   text or number the local schema expects. Anything the local table does not
   have a column for is dropped rather than guessed at, so a mirror that has
   run ahead of this machine's migrations cannot break the insert. */
function adapt(row, cols) {
  const out = {};
  for (const c of cols) {
    if (!(c in row)) continue;
    const v = row[c];
    out[c] = typeof v === 'boolean' ? (v ? 1 : 0)
           : (v !== null && typeof v === 'object') ? JSON.stringify(v)
           : v;
  }
  return out;
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
  try { remote = await fetchAll(table); }
  catch (e) { warn(`${table} — could not read from Supabase (${e.message}), skipping`); continue; }

  const here = localCount(d, table);
  const blocked = here > 0 && !FORCE;

  console.log(`  ${table.padEnd(11)} Supabase ${String(remote.length).padStart(5)}   ` +
              `local ${String(here).padStart(5)}   ` +
              (blocked ? `${YELLOW}skipped — already has rows${OFF}` : ''));

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

head('Restoring');

let total = 0;
for (const { table, cols, rows } of plan) {
  /* One transaction per table: a table either lands completely or not at all,
     so a connection that drops halfway cannot leave variants pointing at
     products that never arrived. */
  const written = DB.tx(() => {
    let n = 0;
    for (const row of rows) {
      const r = adapt(row, cols);
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
}

head('Done');
console.log(`  ${total} row(s) restored into the local database.`);
dim('Staff accounts were NOT restored — the mirror never held passwords.');
dim('Check who can sign in with:  npm run preflight');
console.log('');
