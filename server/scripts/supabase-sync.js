/* ==========================================================================
   OG SYSTEM — Supabase sync worker
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:sync

   Pushes the local SQLite data to the Supabase mirror. SQLite stays the
   real system — this only ever READS from it and WRITES to Supabase, never
   the other way around. Safe to run repeatedly (cron, a scheduled task, or
   by hand): every table sync is a cursor over change_log, so a run that
   dies halfway just picks up where it left off next time.

   SCOPE: products, variants, stock, customers, sales (+ their line items),
   deliveries, and users — a SAFE PROJECTION ONLY (id, username, name, role,
   phone, active, created_at, updated_at). pw_hash/pw_salt/pw_hint/
   must_change are never even SELECTed off the local table, let alone sent —
   the query that reads users names its columns explicitly rather than
   SELECT *, so there is no code path where a password hash passes through
   this script's memory at all. The Supabase users table has no columns for
   them either (see server/supabase/001_mirror_schema.sql's own comment:
   "Password hashes and salts deliberately stay on the shop machine and are
   never mirrored"). This changes nothing about login: authentication is
   checked against local SQLite only, on this server, regardless of what's
   mirrored.

   ONE CURSOR PER TABLE, not one global cursor. sync_state gets a row per
   table synced (id = 'sync:<table>'), independent of the pre-seeded 'shop'
   row (which stays a general "did the shop reach us" heartbeat, also
   touched at the end of every run here). Per-table cursors mean adding a
   new table later starts that table's history from seq 0 — it is not held
   back by, or interleaved with, tables already being synced. */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from 'node:process';

import { load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import * as Vault from '../lib/credvault.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Before DB_FILE, not after. OG_DB is normally set in server/.env, and reading
   it first meant the timed sync silently opened server/data/og.db while the
   server itself used the file the .env named — a mirror faithfully tracking a
   database nobody was selling from. The same path the server, the restore and
   the reconcile all resolve. */
load();

const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

if (!SB.isConfigured()) {
  console.error('Supabase is not configured — run npm run supabase:check first.');
  process.exit(1);
}

DB.open(DB_FILE);

const tick = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const warn = (s) => `  \x1b[33m!\x1b[0m ${s}`;
const head = (s) => `\n\x1b[1m${s}\x1b[0m`;

/* -------------------------------------------------------------- reference
   Small, static, not logged to change_log. Upserted unconditionally on
   every run — a handful of rows, cheap even when nothing changed. Must run
   before products/stock: both have foreign keys into these. */
async function syncReference() {
  console.log(head('Reference data'));

  const currencies = DB.get().prepare('SELECT * FROM currencies').all();
  if (currencies.length) {
    await SB.insert('currencies', currencies, { upsert: true });
    console.log(tick(`currencies   ${currencies.length} rows`));
  }

  const warehouses = DB.get().prepare('SELECT * FROM warehouses').all();
  if (warehouses.length) {
    await SB.insert('warehouses', warehouses, { upsert: true });
    console.log(tick(`warehouses   ${warehouses.length} rows`));
  }
}

/* ------------------------------------------------------------- settings
   The shop's own settings, the permission matrix and the label layouts.
   Nothing logs a change for any of them, and together they are a few
   hundred rows that move maybe once a month — so they are mirrored whole
   on every run.

   Mirrored, not merely upserted. A setting somebody deleted or a
   permission they revoked has to disappear from the mirror as well, or
   restoring from it hands the shop back a grant it had deliberately taken
   away. Reading the table back to find those is fine at this size; none of
   these is ever more than a few hundred rows. */
async function mirrorTable(table, keyCols, mapRow) {
  const local = DB.get().prepare(`SELECT * FROM ${table}`).all();
  const rows = mapRow ? local.map(mapRow) : local;

  if (rows.length) await SB.insert(table, rows, { upsert: true });

  const keyOf = (r) => keyCols.map((c) => r[c]).join('\u0000');
  const here = new Set(local.map(keyOf));
  const remote = await SB.select(table, { select: keyCols.join(',') });

  let dropped = 0;
  for (const r of remote) {
    if (here.has(keyOf(r))) continue;
    const match = {};
    for (const c of keyCols) match[c] = r[c];
    await SB.remove(table, match);
    dropped++;
  }

  console.log(tick(`${table.padEnd(17)}${String(rows.length).padStart(4)} rows` +
                   (dropped ? `, ${dropped} removed` : '')));
}

/* slots is a JSON string in SQLite and JSONB in Postgres. Sent as a string
   it lands as a quoted scalar rather than an object, and every reader of
   the mirror then has to know to parse it twice. One unreadable template
   must not take the whole sync down with it. */
function parseSlots(raw, id) {
  try { return JSON.parse(raw); }
  catch { console.log(warn(`label template ${id}: unreadable slots — mirrored as empty`)); return []; }
}

async function syncSettings() {
  console.log(head('Settings'));
  await mirrorTable('config', ['key']);
  await mirrorTable('role_permissions', ['role', 'perm'],
                    (r) => ({ ...r, allowed: !!r.allowed }));
  await mirrorTable('label_templates', ['id'],
                    (r) => ({ ...r, archived: !!r.archived, slots: parseSlots(r.slots, r.id) }));
}

/* --------------------------------------------------------- append-only
   The movement log and the rate history are only ever inserted into, never
   updated and never deleted. For a table like that the cheapest correct
   cursor is the highest id already pushed — no change_log entry needed,
   and the backlog that predates this code syncs itself on the first run
   instead of staying invisible forever.

   Same trap as the seq cursor, for the same reason: a rebuilt database
   restarts ids at 1 while the cursor stays in the hundreds, and every run
   afterwards finds nothing to do while real rows pile up. A cursor ahead
   of the highest id that exists can only mean that, so rewind and replay —
   every push is an upsert on the row's own id. */
async function syncAppendOnly(table, mapRow) {
  const cursorId = `sync:${table}:maxid`;
  const existing = (await SB.select('sync_state', { eq: { id: cursorId } }))[0];
  let lastId = existing ? existing.last_seq : 0;
  if (!existing) {
    await SB.insert('sync_state', { id: cursorId, last_seq: 0, note: `highest ${table}.id pushed` });
  }

  const highest = DB.get().prepare(`SELECT MAX(id) AS m FROM ${table}`).get().m;
  if (highest !== null && lastId > highest) {
    console.log(warn(`${table}: cursor at ${lastId} but the table only reaches ${highest} — ` +
                     'it was rebuilt underneath us. Rewinding and replaying.'));
    lastId = 0;
  }

  const rows = DB.get().prepare(
    `SELECT * FROM ${table} WHERE id > ? ORDER BY id ASC`
  ).all(lastId);

  if (!rows.length) { console.log(tick(`${table.padEnd(17)}nothing new`)); return; }

  /* In batches. A shop that has not synced for a month can have thousands
     of movements, and one request carrying all of them is how you discover
     the request size limit. */
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await SB.insert(table, mapRow ? slice.map(mapRow) : slice, { upsert: true });
  }

  const top = rows[rows.length - 1].id;
  await SB.update('sync_state', { id: cursorId }, {
    last_seq: top,
    last_push_at: new Date().toISOString(),
    rows_pushed: (existing ? existing.rows_pushed : 0) + rows.length,
    note: `highest ${table}.id pushed`
  });
  console.log(tick(`${table.padEnd(17)}${String(rows.length).padStart(4)} new row(s), through id ${top}`));
}

/* ------------------------------------------------------------------ users
   Not logged to change_log at all (no logChange() call anywhere in
   server/lib/auth.js), so there is no cursor to replay — this is a plain
   full upsert every run, same as reference data. A staff list is a handful
   of rows; re-pushing all of them each time costs nothing.

   The column list is named explicitly and does not include pw_hash,
   pw_salt, pw_hint or must_change — see the file header. This is the only
   place in the whole script that matters for keeping that promise: get
   this SELECT wrong and the safety described above stops being true.

   When OG_VAULT_KEY is set, a SEALED box is attached as well — ciphertext
   built on this machine by lib/credvault.js, which Supabase cannot read.
   That is not a hash leaving the building; it is the only way a dead shop
   machine can ever get its accounts back. */
async function syncUsers() {
  const sealing = Vault.isEnabled();
  console.log(head(sealing ? 'users (safe fields + sealed credentials)' : 'users (safe fields only)'));

  const users = DB.get().prepare(
    'SELECT id, username, name, role, phone, active, created_at, updated_at FROM users'
  ).all();

  if (!users.length) { console.log('  none'); return; }

  const rows = users.map((u) => ({ ...u, active: !!u.active }));

  /* The sealed box is fetched in a SECOND query, per user, and never joined
     into the SELECT above. That keeps the promise in this file's header
     literally true — the query that builds the mirror rows still cannot
     return a hash — and it means a vault failure cannot quietly turn into a
     plain hash being sent instead. */
  if (sealing) {
    const cred = DB.get().prepare(
      'SELECT pw_hash, pw_salt, pw_hint, must_change FROM users WHERE id = ?'
    );
    for (const r of rows) {
      const c = cred.get(r.id);
      /* A user with no password set yet is a real state (createuser writes
         the row and the hash together, but a future path might not), and it
         must not abort the whole staff sync. */
      r.pw_enc = (c && c.pw_hash && c.pw_salt) ? Vault.sealUser(c) : null;
    }
  }

  /* The pw_enc column arrives with server/supabase/002_user_credentials.sql,
     run by hand in the dashboard. If the vault is switched on before that
     migration lands, Postgres rejects the whole batch — which would take the
     ENTIRE staff sync down over an optional extra. Fall back to the columns
     that have always worked and say exactly what to run. */
  let sealedLanded = sealing;
  try {
    await SB.insert('users', rows, { upsert: true });
  } catch (e) {
    if (sealing && /pw_enc/.test(String(e.message))) {
      console.log('  [33m![0m Supabase has no pw_enc column yet — syncing without the sealed boxes.');
      console.log('    [2mRun server/supabase/002_user_credentials.sql in the Supabase SQL editor.[0m');
      await SB.insert('users', rows.map(({ pw_enc, ...rest }) => rest), { upsert: true });
      sealedLanded = false;
    } else { throw e; }
  }
  console.log(tick(`upserted ${users.length} row(s) — username/name/role/phone/active` +
    (sealedLanded ? ', plus a sealed credential box each' : ' only')));
  if (!sealing) {
    console.log(`    \x1b[2mOG_VAULT_KEY is not set, so accounts cannot be restored from this mirror.\x1b[0m`);
  }
}

/* ---------------------------------------------------------- table configs
   parseKey turns a change_log.row_id back into the columns needed to fetch
   the row locally and to match it on Supabase for delete. mapRow adapts
   SQLite's types to Postgres's (INTEGER 0/1 -> boolean; nothing else
   differs between the two schemas for these tables).

   Deliberately excludes `users` — no staff/login data leaves this machine
   through this script. Nothing here needs it either: driver_id/cashier_id/
   assigned_by are plain columns with no foreign key into users on the
   Supabase side (confirmed against server/supabase/001_mirror_schema.sql
   before adding these), so skipping users breaks nothing downstream. Real
   login is checked against local SQLite only, on this server — Supabase is
   never part of authentication, with or without this table synced. */
const TABLES = {
  products: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM products WHERE id = ?').get(key.id),
    mapRow: (r) => ({ ...r, hidden: !!r.hidden })
  },
  variants: {
    parseKey: (rowId) => ({ sku: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM variants WHERE sku = ?').get(key.sku),
    mapRow: (r) => r
  },
  stock: {
    parseKey: (rowId) => { const [sku, wh_id] = rowId.split(':'); return { sku, wh_id }; },
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM stock WHERE sku = ? AND wh_id = ?').get(key.sku, key.wh_id),
    mapRow: (r) => r,
    /* until 006 has been run in the dashboard. stock is pushed in the
       unguarded CORE loop and fetched with SELECT *, so the moment 023 adds
       shelf_id locally PostgREST rejects the whole batch on a mirror that has
       not been updated — and the shop's stock stops being mirrored over a
       column nobody has created yet. Exactly the sales.shift_id situation. */
    fallbackDrop: ['shelf_id'],
    fallbackFile: 'server/supabase/006_shelves.sql'
  },

  /* ---- the warehouse layout --------------------------------------------
     Rooms and the shelves in them. Pushed inside their own guard below,
     AFTER the core loop: shelves.product_id names a product, and stock rows
     carrying a shelf_id go up before any shelf does — which is fine only
     because neither of those is a foreign key on the Supabase side. See
     server/supabase/006_shelves.sql for why. */
  rooms: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM rooms WHERE id = ?').get(key.id),
    mapRow: (r) => r
  },

  sections: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM sections WHERE id = ?').get(key.id),
    mapRow: (r) => r,
    /* until 008 has been run in the dashboard. Same shape as stock.shelf_id:
       try it properly, and on a rejection naming one of these, retry without
       them and say what to run. Without this a mirror that has not got 008
       would drop the whole layout block — and the catch below used to
       report that as a missing TABLE. */
    fallbackDrop: ['room_id', 'wall', 'wall_pos'],
    fallbackFile: 'server/supabase/008_rooms.sql'
  },

  shelves: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM shelves WHERE id = ?').get(key.id),
    mapRow: (r) => r
  },
  customers: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM customers WHERE id = ?').get(key.id),
    mapRow: (r) => r
  },
  /* sale_items has no change_log entries of its own (server/lib/sales.js
     logs only the parent 'sales' row) — so every time a sale is pushed,
     its full current line-item set is pushed alongside it: delete what's
     there for that sale_id, insert the current rows. Simplest correct
     option given items are only ever written once, at sale time, never
     edited afterward. A deleted sale cascades its items on the Postgres
     side (sale_items.sale_id ON DELETE CASCADE) — no manual cleanup
     needed for that path. */
  sales: {
    parseKey: (rowId) => ({ id: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM sales WHERE id = ?').get(key.id),
    mapRow: (r) => ({ ...r, voided: !!r.voided }),
    /* until 005 has been run in the dashboard */
    fallbackDrop: ['shift_id'],
    afterUpsert: async (localRow) => {
      const items = DB.get().prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(localRow.id);
      await SB.remove('sale_items', { sale_id: localRow.id }).catch(() => {});
      if (items.length) await SB.insert('sale_items', items, { upsert: true });
    }
  },
  deliveries: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM deliveries WHERE id = ?').get(key.id),
    mapRow: (r) => r
  },

  /* ---- the partner half ------------------------------------------------
     A job's lines and its stage history have no change_log entries of their
     own, the same arrangement sale_items has with sales: they are written
     once with the job and only ever change through it, so the job carries
     them. Replace rather than merge, because a line removed from a kit sheet
     has to disappear from the mirror too. */
  print_jobs: {
    parseKey: (rowId) => ({ id: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM print_jobs WHERE id = ?').get(key.id),
    mapRow: (r) => r,
    afterUpsert: async (localRow) => {
      for (const t of ['print_job_lines', 'print_job_stages']) {
        const rows = DB.get().prepare(`SELECT * FROM ${t} WHERE job_id = ?`).all(localRow.id);
        await SB.remove(t, { job_id: localRow.id }).catch(() => {});
        if (rows.length) await SB.insert(t, rows, { upsert: true });
      }
    }
  },

  partner_invoices: {
    parseKey: (rowId) => ({ id: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM partner_invoices WHERE id = ?').get(key.id),
    mapRow: (r) => r,
    afterUpsert: async (localRow) => {
      const refs = DB.get().prepare('SELECT * FROM partner_invoice_refs WHERE invoice_id = ?').all(localRow.id);
      await SB.remove('partner_invoice_refs', { invoice_id: localRow.id }).catch(() => {});
      if (refs.length) await SB.insert('partner_invoice_refs', refs, { upsert: true });

      const pays = DB.get().prepare('SELECT * FROM partner_invoice_payments WHERE invoice_id = ?').all(localRow.id);
      await SB.remove('partner_invoice_payments', { invoice_id: localRow.id }).catch(() => {});
      if (pays.length) await SB.insert('partner_invoice_payments', pays, { upsert: true });
    }
  },

  job_messages: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM job_messages WHERE id = ?').get(key.id),
    mapRow: (r) => ({ ...r, read_og: !!r.read_og, read_yl: !!r.read_yl })
  },

  suppliers: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM suppliers WHERE id = ?').get(key.id),
    mapRow: (r) => ({ ...r, archived: !!r.archived })
  },

  employees: {
    parseKey: (rowId) => ({ id: Number(rowId) }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM employees WHERE id = ?').get(key.id),
    mapRow: (r) => ({ ...r, archived: !!r.archived })
  },

  /* An order's lines are written with it and only ever change through it,
     so they ride along the same way a sale's items do. Replaced rather than
     merged: a line taken off an order has to disappear from the mirror. */
  shifts: {
    parseKey: (rowId) => ({ id: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM shifts WHERE id = ?').get(key.id),
    mapRow: (r) => r
  },

  stock_counts: {
    parseKey: (rowId) => ({ id: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM stock_counts WHERE id = ?').get(key.id),
    mapRow: (r) => r,
    afterUpsert: async (localRow) => {
      const rows = DB.get().prepare('SELECT * FROM stock_count_lines WHERE count_id = ?').all(localRow.id);
      await SB.remove('stock_count_lines', { count_id: localRow.id }).catch(() => {});
      if (rows.length) await SB.insert('stock_count_lines', rows, { upsert: true });
    }
  },

  purchase_orders: {
    parseKey: (rowId) => ({ id: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM purchase_orders WHERE id = ?').get(key.id),
    mapRow: (r) => r,
    afterUpsert: async (localRow) => {
      const rows = DB.get().prepare('SELECT * FROM purchase_order_lines WHERE po_id = ?').all(localRow.id);
      await SB.remove('purchase_order_lines', { po_id: localRow.id }).catch(() => {});
      if (rows.length) await SB.insert('purchase_order_lines', rows, { upsert: true });
    }
  }
};

/* TWO PHASES, AND THEY RUN IN OPPOSITE ORDERS.

   Inserts need parents first: a variant cannot land before its product, a
   sale before its customer. Deletes need exactly the reverse — Postgres
   refuses to remove a customer while a sale still points at them.

   Doing both in one pass over the tables in insert order therefore breaks the
   moment a run contains deletes, which is what happened the first time the
   demo purge was pushed: products, variants and stock went, and then removing
   the customers was rejected because their sales were still there, waiting
   two positions later in the same loop.

   So: every table upserts, in FK order; then every table deletes, in reverse.
   The cursor only advances after the delete phase, so a run that dies between
   the two picks both up again next time. Re-reading the same change_log rows
   in the second phase costs one query and is idempotent. */
async function syncTable(name, { phase = 'both' } = {}) {
  const cfg = TABLES[name];
  const cursorId = 'sync:' + name;

  const existing = (await SB.select('sync_state', { eq: { id: cursorId } }))[0];
  let lastSeq = existing ? existing.last_seq : 0;
  if (!existing) await SB.insert('sync_state', { id: cursorId, last_seq: 0, note: `cursor for ${name}` });

  /* THE CURSOR CAN OUTLIVE THE LOG IT POINTS INTO.
     ------------------------------------------------------------------------
     change_log is a local table with an AUTOINCREMENT seq; the cursor lives
     in Supabase. Anything that empties the log locally — a demo teardown, a
     rebuilt database, a restore — starts seq again from 1 while the cursor
     stays where it was, in the hundreds. Every run then asks for
     `seq > 948`, finds nothing, and reports "nothing new" while real work
     piles up underneath it. The sync is not broken and not lying; it is
     reading a bookmark for a book that was reprinted.

     A cursor ahead of the highest seq that exists is the signature of
     exactly that, and it cannot arise any other way — seq only grows while
     the log is intact. So rewind and replay. Replaying costs nothing: every
     push is an upsert keyed on the row's own id.

     THE MAXIMUM MUST BE THIS TABLE'S, NOT THE WHOLE LOG'S. Each table has its
     own cursor, so each can be stranded on its own. Comparing against the
     global MAX(seq) hides that completely: a busy table carries the global
     maximum far above a quiet table's last entry, the quiet table's cursor
     never looks ahead of it, and the rewind never fires. That is not
     hypothetical — sync:deliveries sat at 142 while deliveries' own highest
     entry was 22, and because sales had reached 1001 the shop's four
     deliveries were reported as "nothing new" on every run, for good. */
  const highest = DB.get().prepare(
    'SELECT MAX(seq) AS m FROM change_log WHERE tbl = ?'
  ).get(name).m;
  if (highest !== null && lastSeq > highest) {
    if (phase !== 'delete') console.log(head(name));
    console.log(warn(`cursor was at ${lastSeq} but the log only reaches ${highest} — ` +
                     'it was reset underneath us. Rewinding to 0 and replaying.'));
    lastSeq = 0;
    await SB.update('sync_state', { id: cursorId }, {
      last_seq: 0, note: 'rewound: change_log had been reset'
    });
  }

  const rows = DB.get().prepare(
    'SELECT * FROM change_log WHERE tbl = ? AND seq > ? ORDER BY seq ASC'
  ).all(name, lastSeq);

  console.log(head(name));
  if (!rows.length) {
    if (phase !== 'delete') console.log('  nothing new since seq ' + lastSeq);
    return;
  }

  /* Only the LATEST op per row matters — change_log doesn't store column
     values, only "this row changed," so replaying every intermediate
     version is meaningless when the current state is one query away. A row
     updated 20 times in this window is pushed once. */
  const latest = new Map();
  for (const r of rows) latest.set(r.row_id, r);

  const toUpsert = [];
  const toDeleteKeys = [];
  for (const entry of latest.values()) {
    const key = cfg.parseKey(entry.row_id);
    if (entry.op === 'delete') { toDeleteKeys.push(key); continue; }
    const localRow = cfg.fetchLocal(key);
    /* The log says insert/update but the row is gone locally — a delete
       that happened after this log entry and before this run. Treat it as
       a delete rather than pushing nothing and silently going stale. */
    if (!localRow) { toDeleteKeys.push(key); continue; }
    toUpsert.push(cfg.mapRow(localRow));
  }

  let pushed = 0, deleted = 0;
  if (phase !== 'delete' && toUpsert.length) {
    /* A column this machine has and the mirror does not.

       sales gained shift_id with migration 017, and sales is pushed OUTSIDE
       the guarded block below — so on any project where 005 has not been run
       by hand, PostgREST would reject the whole batch and a shop's entire
       day of sales would stop mirroring over an optional table.

       Same shape as the pw_enc fallback in syncUsers: try it properly, and
       on a rejection naming the column, retry without it and say what to
       run. Deliberately NOT solved by dropping the column in mapRow, which
       would kill the shift-to-sale link at the mirror boundary permanently
       rather than until somebody runs one SQL file. */
    const drop = cfg.fallbackDrop || [];
    try {
      await SB.insert(name, toUpsert, { upsert: true });
    } catch (e) {
      const hit = drop.find((c) => String(e.message).includes(c));
      if (!hit) throw e;
      console.log(warn(`Supabase has no ${name}.${hit} column yet — pushing without it.`));
      /* Named per table. Hardcoding 005 here was fine while sales was the only
         table with a fallback; the second one made it tell the operator to run
         a file that has nothing to do with the column that was rejected. */
      const file = cfg.fallbackFile || 'server/supabase/005_money_and_counts.sql';
      console.log(`    \x1b[2mRun ${file} in the SQL editor.\x1b[0m`);
      await SB.insert(name, toUpsert.map((r) => {
        const copy = { ...r };
        for (const c of drop) delete copy[c];
        return copy;
      }), { upsert: true });
    }
    pushed = toUpsert.length;
    console.log(tick(`upserted ${pushed} row(s)`));

    if (cfg.afterUpsert) {
      for (const row of toUpsert) await cfg.afterUpsert(row);
      console.log(tick(`ran afterUpsert for ${pushed} row(s)`));
    }
  }
  if (phase !== 'upsert') {
    for (const key of toDeleteKeys) {
      await SB.remove(name, key);
      deleted++;
    }
    if (deleted) console.log(tick(`deleted ${deleted} row(s)`));
  }

  /* Only after the deletes. Advancing in the upsert phase would lose them. */
  if (phase === 'upsert') return;

  const maxSeq = rows[rows.length - 1].seq;
  await SB.update('sync_state', { id: cursorId }, {
    last_seq: maxSeq,
    last_push_at: new Date().toISOString(),
    rows_pushed: (existing ? existing.rows_pushed : 0) + pushed,
    note: `${pushed} upserted, ${deleted} deleted, through seq ${maxSeq}`
  });
  console.log(tick(`cursor advanced ${lastSeq} → ${maxSeq}`));
}

await syncReference();
await syncSettings();
await syncUsers();

/* Insertion order is the FK dependency order: products before variants
   (variants.product_id), variants before stock (stock.sku); customers
   before sales (sales.customer_id); sales before deliveries
   (deliveries.sale_id) and before sale_items, which sales' own afterUpsert
   hook pushes right after each sale row lands. */
const CORE = ['products', 'variants', 'stock', 'customers', 'sales', 'deliveries'];
for (const name of CORE) await syncTable(name, { phase: 'upsert' });
for (const name of CORE.slice().reverse()) await syncTable(name, { phase: 'delete' });

/* ------------------------------------------------------- warehouse layout
   The rooms and shelves the map is drawn from. Their own guard, like the
   partner half below and for the same reason: these arrive with
   server/supabase/006_shelves.sql, which is run BY HAND in the dashboard, and
   taking a whole run down over a table nobody has created yet would stop a
   day's sales being mirrored.

   AFTER the core loop, not before it. `shelves.product_id` names a product, so
   products have to be up already; and stock rows carrying a shelf_id go up
   before any shelf does, which is safe only because 006 declares neither of
   those as a foreign key — see that file for why.

   Sections before shelves going in, the reverse coming out. A shelf cannot go
   while a section still owns it, and locally a shelf's removal nulls the
   stock rows pointing at it — that null is pushed in the core loop just above,
   so by the time the shelf is removed here nothing refers to it. */
console.log(head('Warehouse layout'));
/* Set when the layout could not be mirrored for a reason a person has to act
   on. The run still finishes — a day of sales must not stop over the shelf
   map — but it must not exit 0 and be taken for a clean sync by whatever ran
   it. Deploys gate on this exit code. */
let layoutFailed = false;
try {
  /* Rooms before the racks that hang in them going in; the reverse coming
     out. (No foreign key on the mirror makes this an ordering courtesy
     rather than a hard requirement — see 008 — but a restore reads them in
     this order and it costs nothing to push them the same way.) */
  const LAYOUT = ['rooms', 'sections', 'shelves'];
  for (const name of LAYOUT) await syncTable(name, { phase: 'upsert' });
  for (const name of LAYOUT.slice().reverse()) await syncTable(name, { phase: 'delete' });
} catch (e) {
  const msg = String(e.message);
  /* A MISSING COLUMN IS NOT A MISSING TABLE, and to this catch they were the
     same sentence. PostgREST says

       Could not find the 'parent_id' column of 'sections' in the schema cache

     and Postgres says `column "parent_id" ... does not exist` — both match
     /does not exist|schema cache/, which is what the one test here used to be.
     So a column nobody had added was reported as a missing TABLE, the whole
     block was skipped, and sections AND shelves silently stopped mirroring
     while the run went on to report success. The layout is small and changes
     rarely, which is exactly why nobody would have noticed.

     Column first: its message contains the table pattern's words, so the
     other order answers the wrong question. */
  if (/PGRST204|column .* does not exist|Could not find the '[a-z_]+' column/i.test(msg)) {
    const col = msg.match(/'([a-z_]+)' column|column "([a-z_]+)"/);
    console.log(warn('Supabase is missing a layout column' +
                     (col ? ': ' + (col[1] || col[2]) : '') +
                     ' — the layout was NOT mirrored.'));
    console.log('    \x1b[2mRun the newest server/supabase/*.sql in the SQL editor,\x1b[0m');
    console.log('    \x1b[2mthen npm run supabase:reconcile — the cursor has moved past these rows.\x1b[0m');
    layoutFailed = true;
  } else if (/Could not find the table|PGRST205|relation .* does not exist/i.test(msg)) {
    const named = msg.match(/public.([a-z_]+)/);
    console.log(warn('Supabase is missing a table' + (named ? ': ' + named[1] : '') + ' — skipped.'));
    console.log('    \x1b[2mRun server/supabase/006_shelves.sql in the SQL editor.\x1b[0m');
  } else throw e;
}

/* After the loop, not before: a movement points at a variant and a
   warehouse, and a rate at a currency. Both would be rejected if they
   arrived first. */
console.log(head('History'));
await syncAppendOnly('fx_rates');
await syncAppendOnly('stock_movements');

/* ---------------------------------------------------------------- partner
   These tables arrive with server/supabase/003_partner.sql, which is run by
   hand in the dashboard. If the shop's server updates before somebody runs
   it, every request here 404s — and taking the WHOLE sync down over that
   would mean a day's sales stop being mirrored because of a table nobody has
   created yet. So it says exactly what to run and carries on.

   Jobs before their invoices, because an invoice references a job. */
/* Two tables 001_mirror_schema.sql created a home for and nothing ever
   pushed. Its own comment says which half is worth keeping: the queue of
   pending label jobs is local and ephemeral, but WHAT WAS ACTUALLY PRINTED
   is history. The templates got mirrored; the history did not.

   Their own guard, because they arrived with 001 rather than an unrun
   migration — a failure here is real. But a print audit log is not worth
   stopping a day of sales for, so it warns and carries on. */
console.log(head('Print history'));
for (const t of ['print_log', 'label_print_log']) {
  try { await syncAppendOnly(t); }
  catch (e) { console.log(warn(`${t}: ${e.message.slice(0, 90)}`)); }
}

console.log(head('Partner'));
try {
  /* Reference data a kit line points at, and part of the same migration —
     so it lives inside this guard rather than with the settings that have
     always existed. Left in syncSettings it took the entire run down
     before the day's sales were pushed, which is the exact failure this
     block is here to prevent. */
  await mirrorTable('clubs', ['code'], (r) => ({ ...r, archived: !!r.archived }));
  const PARTNER = ['print_jobs', 'partner_invoices', 'job_messages', 'suppliers',
                   'employees', 'purchase_orders'];
  for (const name of PARTNER) await syncTable(name, { phase: 'upsert' });
  for (const name of PARTNER.slice().reverse()) await syncTable(name, { phase: 'delete' });
  await syncAppendOnly('wa_messages');

  /* The drawer. Shifts and count sheets change — a shift closes, a sheet
     posts — so they replay the log. An expense and a debt payment are
     written once and never edited, so the highest id already sent is a
     cheaper and self-healing cursor. */
  for (const name of ['shifts', 'stock_counts']) await syncTable(name, { phase: 'upsert' });
  for (const name of ['stock_counts', 'shifts']) await syncTable(name, { phase: 'delete' });
  await syncAppendOnly('expenses');
  await syncAppendOnly('debt_payments');

  /* Which alerts each person has already read. Small, unlogged, and worth
     keeping: restoring onto a new machine without it makes every alert in
     the shop bold again on the first morning. */
  await mirrorTable('notification_reads', ['user_id', 'key']);
} catch (e) {
  if (/does not exist|Could not find the table|PGRST205|schema cache/i.test(String(e.message))) {
    /* Name the one it stopped on. "Run 003" is unhelpful when 003 has been
       run and 004 has not. */
    const named = String(e.message).match(/public.([a-z_]+)/);
    console.log(warn("Supabase is missing a table" + (named ? ": " + named[1] : "") + " — skipped."));
    console.log("    [2mRun these in the Supabase SQL editor, in order:[0m");
    console.log("    [2m  server/supabase/003_partner.sql[0m");
    console.log("    [2m  server/supabase/004_purchasing_and_alerts.sql[0m");
    console.log("    [2m  server/supabase/005_money_and_counts.sql[0m");
  } else { throw e; }
}

await SB.update('sync_state', { id: 'shop' }, {
  last_push_at: new Date().toISOString(),
  note: 'supabase-sync.js run completed'
});

console.log(head('Done'));
console.log('  Check the Supabase dashboard — Table Editor — to see the rows.\n');

/* Last, and only after the bookmark above is written: everything that COULD
   be mirrored has been, and the failure is reported by the exit code rather
   than by taking the run down halfway through. */
if (layoutFailed) {
  console.log(warn('  The warehouse layout is NOT in the mirror. Exit 1.\n'));
  process.exit(1);
}
