/* ==========================================================================
   OG SYSTEM — restore the shop FROM Supabase, as a library       [restore.js]
   --------------------------------------------------------------------------
   The other direction. lib/mirror.js pushes SQLite to Supabase and never
   reads back, which is right for a mirror — but it means a shop machine that
   loses its database has its data sitting in Supabase with no way home. This
   is the way home, and since the baton (below) it is also how the shop moves
   from one laptop to another.

   Two callers, one implementation:

     scripts/supabase-restore.js   the CLI — restore in place (--force,
                                   --dry-run), or the whole wipe-and-pull
                                   (--wipe), printed for a person
     index.js, at boot             pullAtBoot(): the wipe-and-pull, guarded,
                                   before the server listens

   SQLite REMAINS the real system while the server is up. What changed is
   WHICH machine's SQLite: the shop runs on one laptop at a time, and which
   laptop that is changes between sessions. So:

   THE BATON. Booting means "I am the writer now". The pull takes a verified
   copy, moves the old database aside, opens a fresh one, writes the whole
   mirror into it in ONE transaction, mints a NEW lineage id and claims the
   mirror with it (lib/lineage.js), and resets the bookmarks to match the
   empty local log. From then on the live mirror pushes as it always has. The
   laptop that had the baton, if it is still up, fails its next lineage check
   and stops pushing (lib/sync-worker.js); whatever it writes after that stays
   on it, and when IT next boots, the `unpushed_local` guard below refuses to
   wipe those rows and says how many.

   A fresh id, on purpose. The restored `config` carries the OTHER laptop's
   `sync.lineage`, because config is mirrored whole. Inheriting it would make
   two databases indistinguishable to the one guard that exists to tell them
   apart — the two-writer incident of 2026-08-30, with extra steps.

   NEVER LOSES DATA. NEVER OPENS AN EMPTY SHOP. Every guard returns to the
   local copy with a reason; nothing here calls process.exit. The refusals
   are the design, not the error path: the one thing this must never do is
   quietly replace a database that holds something the mirror has not.

   ACCOUNTS. Only with the vault (lib/credvault.js): a user row on its own is
   an account nobody can sign in to. A box that opens gives the account back
   with the password it always had. A user WITHOUT a box — synced before the
   vault, or sealed under another key — is kept DISABLED with random password
   bytes, the shape of the retired test accounts, so every sale that names
   them still resolves and a manager can re-enable and reset them. The wipe
   itself is refused when no active manager's box opens: a shop nobody can
   reach Settings in cannot be repaired from inside.
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { maybe } from './env.js';
import * as DB from './db.js';
import * as SB from './supabase.js';
import * as Vault from './credvault.js';
import * as Auth from './auth.js';
import * as Lineage from './lineage.js';
import * as Mirror from './mirror.js';
import * as Backup from './backup.js';
import * as Drift from './drift.js';
import { fullMinutes } from './sync-worker.js';

/* Parent before child, every time: variants reference products, stock
   references variants, sales reference customers, and sale_items and
   deliveries reference sales. Restoring out of order trips the foreign keys
   the database is opened with (foreign_keys = ON).

   The first five carry no references at all and come first so the rest have
   somewhere to point: a rate needs its currencies, and a movement needs the
   variant and the warehouse it moved between. The last two come last for
   the same reason. */
export const ORDER = [
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

  /* The two the mirror exists FOR, in the sense that nothing else can rebuild
     them. A stamp count comes back on its own — it is derived from the sales
     above — but the redemption that consumed those stamps cannot, and without
     it a customer is holding a card the shop has already honoured. A want is
     the only record that somebody asked for a size and left without one.

     After customers (both name one), after products and variants (a want names
     both), and after accounts, which are restored before this list runs
     because sales.cashier_id needs them — user_id here needs the same. */
  'loyalty_redemptions', 'wants',

  /* a job may name the sale that raised it; a line names a club; an invoice
     names jobs; a message hangs off one or the other */
  'print_jobs', 'print_job_lines', 'print_job_stages', 'job_reviews',
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
export const SEEDED = new Set([
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
   run ahead of this machine's migrations cannot break the insert. (The pull
   refuses that case outright — Drift `ahead` — because dropped is lost.)

   Postgres hands a TIMESTAMPTZ back as 2026-08-30T15:56:28.389+00:00; this
   database wrote it as 2026-08-30T15:56:28.389Z, and it compares and sorts
   those as strings (WHERE at >= ?, ORDER BY at). '+' sorts before 'Z', so a
   restored row and a row rung up a moment later in the same second would
   order wrong, and a mixed table is a table nobody can reason about. Put it
   back exactly as it was written. Only the unambiguous shape is touched. */
const PG_TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?[+-]\d\d:\d\d$/;
export function adapt(row, cols) {
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

/* ------------------------------------------------- pointing at nothing
   THE MIRROR IS ALLOWED TO HOLD A PARENT THIS DATABASE NO LONGER HAS, and on
   one table that is by design: server/supabase/006_shelves.sql declares no
   foreign key on shelves.product_id, precisely so that a product deleted here
   — which nulls the shelf's product_id inside SQLite, writing no change_log
   entry and therefore never reaching the mirror — cannot block the products
   delete from being pushed.

   The consequence lands here. This database DOES enforce that key
   (023_shelves.sql, plus PRAGMA foreign_keys = ON), so inserting the mirrored
   row verbatim throws "FOREIGN KEY constraint failed" partway through the
   restore. An assignment to a product that no longer exists is not
   information worth dying for: the shelf comes back unassigned, which is true.

   The same shape on the label history, and this one is guaranteed rather
   than occasional: label_print_log.job_id points at label_print_jobs, the
   live print queue that is deliberately never mirrored — so on a clean
   machine EVERY logged job is a job the database has not got. Which batch a
   label came from is not worth that; the line keeps its sku, qty, station
   and time. */
function clean(table, r, d, counters) {
  if (table === 'shelves' && r.product_id != null) {
    if (d.prepare('SELECT 1 FROM products WHERE id = ?').get(r.product_id)) return r;
    counters.orphaned++;
    return { ...r, product_id: null, size_from: null, size_to: null };
  }
  if (table === 'label_print_log' && r.job_id != null) {
    if (d.prepare('SELECT 1 FROM label_print_jobs WHERE id = ?').get(r.job_id)) return r;
    counters.unqueued++;
    return { ...r, job_id: null };
  }
  return r;
}

/* ------------------------------------------------------------- reading
   Every table into memory BEFORE anything is written. A shop's mirror is a
   few MB; holding it is cheap, and it means a connection that drops on the
   thirtieth table leaves the local database exactly as it was. */
export async function fetchShop({ log, strict = true, d = DB.get() } = {}) {
  const tables = [];
  let rows = 0;
  for (const table of ORDER) {
    const cols = columnsOf(d, table);
    if (!cols.length) { if (log) log.warn(`${table} — no such table locally, skipping`); continue; }
    let remote;
    try { remote = await fetchAll(table, pkOf(d, table)); }
    catch (e) {
      if (strict) throw new Error(`${table}: ${e.message}`);
      if (log) log.warn(`${table} — could not read from Supabase (${e.message}), skipping`);
      continue;
    }
    tables.push({ table, cols, rows: remote });
    rows += remote.length;
  }
  let users = [];
  try { users = await fetchAll('users', 'id'); }
  catch (e) {
    if (strict) throw new Error(`users: ${e.message}`);
    if (log) log.warn(`could not read users from Supabase (${e.message})`);
  }
  return { tables, users, rows };
}

/* ------------------------------------------------------------ accounts
   { ready: [{row, cred}], disabled: [row], failed, activeManager, error }
   `ready` can sign in; `disabled` come back as rows without a working
   password, so the invoices that name them still resolve. */
export function unsealAccounts(users) {
  const ready = [], disabled = [];
  let failed = 0, activeManager = false, error = null;
  for (const u of users) {
    if (u.pw_enc) {
      try {
        const cred = Vault.unsealUser(u.pw_enc);
        ready.push({ row: u, cred });
        if ((u.active === true || u.active === 1) && u.role === 'manager') activeManager = true;
        continue;
      } catch (e) {
        failed++;
        if (!error) error = e.message;
      }
    }
    disabled.push(u);
  }
  return { ready, disabled, failed, activeManager, error };
}

/* ------------------------------------------------------------- writing
   Users first — sales.cashier_id points at one — then ORDER. `force` lifts
   the "already has rows" guard; `oneTx` wraps the whole thing in a single
   transaction (the wipe path: a fresh database either becomes the shop or
   stays empty), otherwise one transaction per table as the CLI always did. */
export function applyShop(d, snapshot, accounts, { force = false, log = null, oneTx = false } = {}) {
  const counters = { orphaned: 0, unqueued: 0 };
  const perTable = [];
  const stmts = new Map();
  const stmt = (sql) => { let s = stmts.get(sql); if (!s) { s = d.prepare(sql); stmts.set(sql, s); } return s; };
  const put = (table, r) => {
    const keys = Object.keys(r);
    if (!keys.length) return false;
    stmt(`INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map((k) => r[k]));
    return true;
  };

  const writeUsers = () => {
    const cols = columnsOf(d, 'users');
    const exists = (u) => d.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(u.username);
    let added = 0, kept = 0, off = 0;
    for (const { row: u, cred } of accounts.ready) {
      /* An account that already exists locally is never touched without
         --force. The local row is the one with a password that currently
         works; the box is a copy of some earlier moment, and quietly winding
         a password back is the one outcome nobody would forgive. */
      if (exists(u) && !force) { kept++; continue; }
      const row = adapt(u, cols);
      delete row.pw_enc;
      put('users', { ...row, ...cred });
      added++;
    }
    for (const u of accounts.disabled) {
      if (exists(u) && !force) { kept++; continue; }
      const row = adapt({ ...u, active: false }, cols);
      delete row.pw_enc;
      put('users', { ...row, pw_hash: randomBytes(64), pw_salt: randomBytes(16), pw_hint: null, must_change: 0 });
      off++;
    }
    return { added, kept, disabled: off };
  };

  const writeTable = ({ table, cols, rows }) => {
    const here = localCount(d, table);
    const seeded = SEEDED.has(table);
    if (here > 0 && !force && !seeded) { perTable.push({ table, rows: 0, skipped: 'already has rows' }); return; }
    if (!rows.length) { perTable.push({ table, rows: 0 }); return; }
    let n = 0;
    for (const row of rows) if (put(table, clean(table, adapt(row, cols), d, counters))) n++;
    perTable.push({ table, rows: n });
    if (log) log.tick(`${table} — ${n} row(s)`);
  };

  /* Counters that live in their own table do not move when rows are written
     straight in like this, and a counter left behind the data hands the next
     product a code that already exists. */
  const fixLabelSeq = () => {
    if (!snapshot.tables.some((p) => p.table === 'variants' && p.rows.length)) return null;
    const used = d.prepare(
      'SELECT MAX(CAST(label_code AS INTEGER)) AS m FROM variants WHERE label_code IS NOT NULL'
    ).get().m;
    if (used === null) return null;
    const seq = d.prepare('SELECT next_value FROM label_code_seq WHERE id = 1').get();
    if (!seq || seq.next_value > used) return null;
    d.prepare('UPDATE label_code_seq SET next_value = ? WHERE id = 1').run(used + 1);
    return used + 1;
  };

  /* On a fresh database the seeded tables are REPLACED, not merged: the rows
     the migration planted are placeholders for exactly these, and a default
     the shop had deleted — a config key, a permission row — must not survive
     beside the real ones. Cleared children-first (fx_rates points at
     currencies), and only where the mirror actually has rows to put back, so
     a mirror short of one reference table cannot leave the shop without it.
     In place (the CLI) the seeded rows may already be referenced by real
     data, so there they are merged as before. */
  const clearSeeded = () => {
    const has = new Set(snapshot.tables.filter((t) => t.rows.length).map((t) => t.table));
    for (const t of [...ORDER].reverse()) {
      if (SEEDED.has(t) && has.has(t)) d.prepare(`DELETE FROM ${t}`).run();
    }
  };

  const each = oneTx ? (fn) => fn() : (fn) => DB.tx(fn);
  const body = () => {
    if (oneTx) {
      /* Foreign keys are checked at COMMIT rather than per statement, so the
         order inside the transaction is not load-bearing: the whole shop
         either lands consistent or not at all. The seed's own rows are what
         made this necessary — a fresh database is not empty. */
      d.exec('PRAGMA defer_foreign_keys = ON');
      clearSeeded();
    }
    const users = writeUsers();
    for (const t of snapshot.tables) each(() => writeTable(t));
    return { users, labelSeq: fixLabelSeq() };
  };
  const { users, labelSeq } = oneTx ? DB.tx(body) : body();

  /* role_permissions just changed under the cache. */
  Auth.invalidatePermissions();

  const rows = perTable.reduce((n, p) => n + p.rows, 0);
  if (log) {
    if (counters.orphaned) log.warn(`${counters.orphaned} shelf/shelves named a product this database does not have — restored unassigned.`);
    if (counters.unqueued) log.line(`    ${counters.unqueued} label print(s) named a queue job this database does not have — restored without the job link.`);
    if (labelSeq) log.tick(`label code counter moved to ${labelSeq} (past the restored codes)`);
  }
  return { rows, perTable, users, labelSeq, ...counters };
}

/* ------------------------------------------------------- restore in place
   The CLI's original job: copy the mirror into the database this machine
   already has, skipping any table that already holds rows unless forced. */
export async function restoreInPlace({ dbFile, force = false, dryRun = false, log = Mirror.consoleLog() } = {}) {
  if (!SB.isConfigured()) return { ok: false, reason: 'not_configured' };
  const reach = await SB.ping();
  if (!reach.ok) return { ok: false, reason: 'unreachable', message: reach.message };
  log.tick(`Connected to ${SB.projectUrl()}`);

  const d = DB.open(dbFile);

  log.head('What is there');
  const snapshot = await fetchShop({ log, strict: false, d });
  const plan = [];
  for (const t of snapshot.tables) {
    const here = localCount(d, t.table);
    const seeded = SEEDED.has(t.table);
    const blocked = here > 0 && !force && !seeded;
    log.line(`  ${t.table.padEnd(17)} Supabase ${String(t.rows.length).padStart(5)}   local ${String(here).padStart(5)}   ` +
             (blocked ? 'skipped — already has rows' : (seeded && here > 0) ? 'replacing the defaults' : ''));
    if (!blocked && t.rows.length) plan.push(t);
  }
  if (!plan.length) return { ok: true, reason: 'nothing', force };
  if (dryRun) return { ok: true, reason: 'dry_run', plan: plan.map((p) => ({ table: p.table, rows: p.rows.length })) };

  log.head('Accounts');
  let accounts = { ready: [], disabled: [], failed: 0, activeManager: false, error: null };
  if (!Vault.isEnabled()) {
    log.warn('OG_VAULT_KEY is not set — accounts skipped.');
    log.line('    Without it a restored user could not sign in. Set it in server/.env,');
    log.line('    then re-run. New staff meanwhile:  npm run createuser');
  } else if (!snapshot.users.length) {
    log.warn('no users in the mirror');
  } else if (!snapshot.users.some((u) => u.pw_enc)) {
    log.warn(`${snapshot.users.length} user(s) in the mirror, none with a sealed box.`);
    log.line('    They were synced before the vault was switched on. Run npm run supabase:sync');
    log.line('    on a machine that still has the accounts, then restore again.');
  } else {
    /* In place, a user with no box is left out rather than written disabled:
       this machine may well have the working account already. */
    accounts = unsealAccounts(snapshot.users);
    accounts.disabled = [];
    if (accounts.failed) log.warn(accounts.error);
  }

  log.head('Restoring');
  const applied = applyShop(d, { ...snapshot, tables: plan }, accounts, { force, log, oneTx: false });
  if (applied.users.added) log.tick(`${applied.users.added} account(s) restored — they can sign in with their existing password.`);
  if (applied.users.kept) log.line(`    ${applied.users.kept} left alone because they already exist here (--force overwrites).`);
  if (accounts.failed) log.line(`    ${accounts.failed} box(es) could not be opened with this OG_VAULT_KEY.`);
  return { ok: true, reason: 'restored', ...applied };
}

/* -------------------------------------------------------- the boot pull */

/* OG_PULL_AT_BOOT=0 (or --no-pull) turns it off. Otherwise on whenever the
   mirror is configured — the switch a development copy sets, alongside
   OG_SYNC_MINUTES=0, which refuses on its own (guard `sync_off`). */
export function enabled() {
  if (process.argv.includes('--no-pull')) return false;
  const raw = maybe('OG_PULL_AT_BOOT');
  return raw === null || !/^(0|false|no|off)$/i.test(String(raw).trim());
}

export const STALE_MS = Lineage.STALE_MS;

/* The wipe-and-pull. Every step before the move is READ-ONLY on both sides.
   Returns a PullResult and never throws for a reason it can name:

     { did, at, reason, message, detail, from, host, seconds,
       rows, tables, accounts:{restored,disabled}, backup, warning }

   `reason` is one of: not_configured sync_off vault_off unreachable
   own_lineage mirror_empty busy_elsewhere unpushed_local drift fetch_failed
   accounts_unreadable dry_run backup_failed restore_failed — or `pulled`. */
export async function pull({ dbFile, log = Mirror.consoleLog(), takeover = false, force = false, dryRun = false } = {}) {
  const started = Date.now();
  const at = new Date().toISOString();
  const host = hostname();
  let from = null;
  const answer = (did, reason, message, detail = null, extra = {}) => ({
    did, at, reason, message, detail, from, host,
    seconds: Math.round((Date.now() - started) / 100) / 10, ...extra
  });
  const refuse = (reason, message, detail, extra) => answer(false, reason, message, detail, extra);

  if (!SB.isConfigured()) return refuse('not_configured', 'Supabase is not set up on this server.');
  if (fullMinutes() === 0) {
    return refuse('sync_off', 'Automatic sync is off (OG_SYNC_MINUTES=0) — a copy that never pushes must never wipe itself. Nothing was touched.');
  }
  if (!Vault.isEnabled()) {
    return refuse('vault_off', 'OG_VAULT_KEY is not set, so no account could come back and nobody could sign in. Nothing was wiped.');
  }

  const reach = await SB.ping();
  if (!reach.ok) return refuse('unreachable', `Cannot reach Supabase — ${reach.message}. Started on the local copy.`, { why: reach.reason });
  log.tick(`Connected to ${SB.projectUrl()}`);

  /* Whose mirror is it, and is anybody on it right now? */
  const mine = Lineage.localId({ create: false });
  const other = await Lineage.remote();
  const beat = await Lineage.heartbeat();
  if (other) from = { host: other.host, id: other.id, since: other.since };

  if (other && mine && other.id === mine) {
    return answer(false, 'own_lineage', 'The mirror is this machine\'s own copy — nothing to pull.');
  }
  if (!other && !beat.at) {
    return answer(false, 'mirror_empty', 'The mirror has never been synced — nothing to pull. This machine will claim it.');
  }
  const seen = [beat.at, other && other.since].filter(Boolean).map((s) => new Date(s).getTime());
  const ageMs = seen.length ? Date.now() - Math.max(...seen) : Infinity;
  if (ageMs < Lineage.STALE_MS && !takeover) {
    const who = other ? other.host : 'another machine';
    return refuse('busy_elsewhere',
      `${who} is working on the shop right now (seen ${Math.round(ageMs / 1000)} s ago). Nothing was wiped.`,
      { host: who, seconds: Math.round(ageMs / 1000) });
  }

  /* Anything here the cloud has not got? Measured against what THIS machine
     pushed (sync_local), never against the other laptop's bookmarks. */
  let unpushed = { total: 0, byTable: {}, outbox: 0 };
  try { unpushed = Mirror.unpushed(); } catch { /* a database from before 038 — treated as nothing pending */ }
  if ((unpushed.total > 0 || unpushed.outbox > 0) && !force) {
    const who = other ? other.host : 'nobody yet';
    const what = [unpushed.total ? `${unpushed.total} change(s)` : null,
                  unpushed.outbox ? `${unpushed.outbox} unsent message(s)` : null].filter(Boolean).join(' and ');
    return refuse('unpushed_local',
      `${what} on this machine never reached the cloud, and the cloud now belongs to ${who}. Nothing was wiped — ` +
      'Claim the mirror in the panel to keep them, or npm run supabase:restore -- --wipe --force to discard them.',
      { n: unpushed.total, outbox: unpushed.outbox, byTable: unpushed.byTable, host: who });
  }

  /* Can the mirror's shape carry this database, column for column? */
  const drift = await Drift.check({ tables: [...ORDER, 'users'], ahead: true });
  const declared = force ? [] : drift.declared;
  const ahead = force ? [] : drift.ahead;
  if (drift.missingTables.length || drift.undeclared.length || declared.length || ahead.length) {
    const files = [...new Set(drift.declared.map((x) => x.file))];
    const parts = [];
    if (drift.missingTables.length) parts.push(`the mirror has no ${drift.missingTables.join(', ')} table`);
    for (const x of [...drift.undeclared, ...declared]) parts.push(`${x.table} is missing ${x.cols.join(', ')}`);
    for (const x of ahead) parts.push(`the mirror's ${x.table} has ${x.cols.join(', ')} which this machine has not — this laptop's code is behind`);
    const fix = ahead.length && !drift.missingTables.length && !drift.undeclared.length && !declared.length
      ? 'Update this machine (git pull) and start again.'
      : `Run ${files.length ? files.join(' and ') : 'server/supabase/CATCH-UP.sql'} in the Supabase SQL editor, then npm run supabase:reconcile on the machine that has the data.`;
    return refuse('drift', `A pull would lose data: ${parts.join('; ')}. ${fix} Nothing was wiped.`,
      { missingTables: drift.missingTables, undeclared: drift.undeclared, declared, ahead, files });
  }
  if (force && (drift.declared.length || drift.ahead.length)) {
    log.warn('--force: pulling although the mirror is short of ' +
             [...drift.declared, ...drift.ahead].map((x) => `${x.table}.${x.cols.join('/')}`).join(', '));
  }

  /* Everything into memory before a single row is written. */
  log.head('Reading the mirror');
  let snapshot;
  try { snapshot = await fetchShop({ log, strict: true }); }
  catch (e) { return refuse('fetch_failed', `Could not read the mirror — ${e.message}. Nothing was touched.`); }
  log.tick(`${snapshot.rows} row(s) across ${snapshot.tables.length} table(s), ${snapshot.users.length} account(s)`);

  const accounts = unsealAccounts(snapshot.users);
  if (!accounts.ready.length || !accounts.activeManager) {
    const why = accounts.failed
      ? `${accounts.error} — no account would come back.`
      : 'No active manager in the mirror has a sealed credential box, so nobody could sign in to repair the shop.';
    return refuse('accounts_unreadable', `${why} Nothing was wiped.`,
      { failed: accounts.failed, sealed: accounts.ready.length, boxless: accounts.disabled.length });
  }

  if (dryRun) {
    return answer(false, 'dry_run',
      `Would pull ${snapshot.rows} row(s) and ${accounts.ready.length} account(s)` +
      (accounts.disabled.length ? ` (+${accounts.disabled.length} without a box, kept disabled)` : '') +
      (other ? ` from ${other.host}` : '') + '. Nothing written.',
      { rows: snapshot.rows, accounts: accounts.ready.length, disabled: accounts.disabled.length });
  }

  /* ---- the point of no return, in three reversible steps ---------------- */
  const target = join(Backup.BACKUP_DIR, `og-${Backup.stamp()}-before-pull.db`);
  log.head('Moving the local database aside');
  const moved = await Backup.moveAside(dbFile, target);
  if (!moved.ok) return refuse('backup_failed', `Could not move the database aside — ${moved.reason}. Nothing was wiped.`);
  log.tick(`previous database is at ${target}`);

  let applied;
  try {
    const d = DB.open(dbFile);   /* fresh file: every migration runs, seeds land */
    log.head('Restoring');
    applied = applyShop(d, snapshot, accounts, { force: true, log, oneTx: true });
  } catch (e) {
    log.warn(`restore failed — ${e.message}. Putting the previous database back.`);
    try {
      await Backup.moveBack(target, dbFile);
    } catch (e2) {
      try { DB.open(dbFile); } catch { /* index.js fails loudly on the next DB.get() */ }
      return refuse('restore_failed',
        `Restore failed (${e.message}) AND the previous database could not be put back (${e2.message}). It is at ${target}.`,
        { error: e.message }, { backup: target });
    }
    return refuse('restore_failed', `Restore failed — ${e.message}. The previous database was put back.`,
      { error: e.message }, { backup: target });
  }
  log.tick(`${applied.rows} row(s) restored; ${applied.users.added} account(s) can sign in` +
           (applied.users.disabled ? `, ${applied.users.disabled} kept disabled` : ''));

  /* ---- the baton: a NEW id, claimed; bookmarks that match an empty log --- */
  const warnings = [];
  try {
    Lineage.forget();
    const id = Lineage.localId();
    await Lineage.claim(id);
    log.tick(`mirror claimed for ${host} (${id.slice(0, 8)}…)` + (other ? `, taken over from ${other.host}` : ''));
  } catch (e) {
    warnings.push('claim_failed');
    log.warn(`could not claim the mirror — ${e.message}. Use Claim the mirror in the panel.`);
  }
  try {
    await Mirror.loadCursors();
    await Mirror.resetCursorsAfterPull({ log });
  } catch (e) {
    warnings.push('cursors_not_reset');
    log.warn(`could not reset the bookmarks — ${e.message}. The first change rewinds them.`);
  }

  try { Backup.prune(Backup.BACKUP_DIR, 30); } catch { /* housekeeping */ }

  return answer(true, 'pulled',
    `Pulled ${applied.rows} rows from the cloud` + (other ? ` (taken over from ${other.host})` : '') +
    (warnings.length ? ` — ${warnings.join(', ')}` : ''),
    null, {
      rows: applied.rows, tables: applied.perTable,
      accounts: { restored: applied.users.added, disabled: applied.users.disabled },
      backup: target, warning: warnings[0] || null, warnings
    });
}

/* What index.js calls before it listens. Whatever happens in here, the
   server must have a database to serve afterwards. */
export async function pullAtBoot({ dbFile, log = Mirror.consoleLog() } = {}) {
  const at = new Date().toISOString();
  const host = hostname();
  if (!enabled()) return { did: false, at, host, reason: 'disabled', message: 'Boot pull is off (OG_PULL_AT_BOOT=0).' };
  if (!SB.isConfigured()) return { did: false, at, host, reason: 'not_configured', message: 'Supabase is not set up on this server.' };

  log.head('The cloud copy');
  try {
    const r = await pull({ dbFile, log, takeover: Lineage.takeoverRequested(), force: false });
    log.line((r.did ? '  ✓ ' : '  · ') + r.message);
    return r;
  } catch (e) {
    try { DB.get(); } catch { try { DB.open(dbFile); } catch { /* index.js fails loudly on the next DB.get() */ } }
    log.warn(`boot pull failed unexpectedly — ${e.message}. Started on the local copy.`);
    return { did: false, at, host, reason: 'restore_failed', message: `Unexpected failure — ${e.message}. Started on the local copy.` };
  }
}
