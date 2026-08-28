/* ==========================================================================
   OG SYSTEM — Supabase sync worker
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:sync

   Pushes the local SQLite data to the Supabase mirror. SQLite stays the
   real system — this only ever READS from it and WRITES to Supabase, never
   the other way around. Safe to run repeatedly (cron, a scheduled task, or
   by hand): every table sync is a cursor over change_log, so a run that
   dies halfway just picks up where it left off next time.

   SCOPE OF THIS RUN: products, variants, stock — the "stock data" chain —
   plus the two small reference tables they depend on (currencies,
   warehouses), which aren't logged to change_log since they're rarely-
   changed setup data, not day-to-day writes. sales/customers/deliveries
   already have real activity in change_log (confirmed: 17/90/9 rows) but
   are NOT synced by this script yet — adding them is adding entries to the
   TABLES map below, not a redesign.

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

/* ---------------------------------------------------------- table configs
   parseKey turns a change_log.row_id back into the columns needed to fetch
   the row locally and to match it on Supabase for delete. mapRow adapts
   SQLite's types to Postgres's (currently only hidden: 0/1 -> boolean). */
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

/* Insertion order is the FK dependency order: products before variants
   (variants.product_id), variants before stock (stock.sku). */
for (const name of ['products', 'variants', 'stock']) {
  await syncTable(name);
}

await SB.update('sync_state', { id: 'shop' }, {
  last_push_at: new Date().toISOString(),
  note: 'supabase-sync.js run completed'
});

console.log(head('Done'));
console.log('  Check the Supabase dashboard — Table Editor — to see the rows.\n');
