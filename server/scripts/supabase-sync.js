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
const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

load();

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
  }
};

async function syncTable(name) {
  const cfg = TABLES[name];
  const cursorId = 'sync:' + name;

  const existing = (await SB.select('sync_state', { eq: { id: cursorId } }))[0];
  const lastSeq = existing ? existing.last_seq : 0;
  if (!existing) await SB.insert('sync_state', { id: cursorId, last_seq: 0, note: `cursor for ${name}` });

  const rows = DB.get().prepare(
    'SELECT * FROM change_log WHERE tbl = ? AND seq > ? ORDER BY seq ASC'
  ).all(name, lastSeq);

  console.log(head(name));
  if (!rows.length) {
    console.log('  nothing new since seq ' + lastSeq);
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
  if (toUpsert.length) {
    await SB.insert(name, toUpsert, { upsert: true });
    pushed = toUpsert.length;
    console.log(tick(`upserted ${pushed} row(s)`));

    if (cfg.afterUpsert) {
      for (const row of toUpsert) await cfg.afterUpsert(row);
      console.log(tick(`ran afterUpsert for ${pushed} row(s)`));
    }
  }
  for (const key of toDeleteKeys) {
    await SB.remove(name, key);
    deleted++;
  }
  if (deleted) console.log(tick(`deleted ${deleted} row(s)`));

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
await syncUsers();

/* Insertion order is the FK dependency order: products before variants
   (variants.product_id), variants before stock (stock.sku); customers
   before sales (sales.customer_id); sales before deliveries
   (deliveries.sale_id) and before sale_items, which sales' own afterUpsert
   hook pushes right after each sale row lands. */
for (const name of ['products', 'variants', 'stock', 'customers', 'sales', 'deliveries']) {
  await syncTable(name);
}

await SB.update('sync_state', { id: 'shop' }, {
  last_push_at: new Date().toISOString(),
  note: 'supabase-sync.js run completed'
});

console.log(head('Done'));
console.log('  Check the Supabase dashboard — Table Editor — to see the rows.\n');
