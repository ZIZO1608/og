/* ==========================================================================
   OG SYSTEM — the Supabase mirror, as a library                  [mirror.js]
   --------------------------------------------------------------------------
   Pushes the local SQLite data to the Supabase mirror. SQLite stays the real
   system — this only ever READS from it and WRITES to Supabase, never the
   other way around.

   This used to be the body of scripts/supabase-sync.js, a top-level-await
   script that could only run as its own process, once every ten minutes,
   and that made some sixty HTTPS round-trips and re-pushed 250 settings
   rows on a run where nothing had changed. It is a library now, used by two
   callers that must never disagree:

     scripts/supabase-sync.js   the CLI — one FULL run, printed for a person
     lib/sync-worker.js         in the server — the FAST LANE a couple of
                                seconds after every commit, plus a full run
                                every hour as the self-healing safety net

   TWO ENTRY POINTS, ONE IMPLEMENTATION. fullRun() walks every table in the
   order it always has. pushChanged() first asks SQLite — locally, in
   microseconds — which tables have moved since their bookmark, and walks
   only those, through the very same functions and in the very same order.
   When nothing moved it returns without a single request. Both take a
   `log` so the CLI can print and the worker can keep a quiet tail.

   THE CURSORS LIVE IN MEMORY between runs. Every table's bookmark is a row
   in Supabase `sync_state`; the script used to fetch it over HTTP twice per
   table per run. With the lineage claimed (lib/lineage.js) THIS process is
   the only writer of those rows, so they are read once (loadCursors) and
   then held here, written through to Supabase on every advance. A second
   writer is exactly what the lineage guard refuses, so the cache cannot go
   stale under us.

   Nothing in here calls process.exit. A failure is a thrown Error or a flag
   in the result; what to do about it is the caller's decision.

   Users: a SAFE PROJECTION ONLY (id, username, name, role, phone, active,
   created_at, updated_at) plus a sealed credential box when OG_VAULT_KEY is
   set (lib/credvault.js). pw_hash/pw_salt/pw_hint/must_change are never
   SELECTed into the row that is sent — the query names its columns
   explicitly — and the Supabase users table has no columns for them either.
   Authentication is checked against local SQLite only; Supabase is never
   part of it.
   ========================================================================== */

import { createHash } from 'node:crypto';
import { hostname } from 'node:os';

import * as DB from './db.js';
import * as SB from './supabase.js';
import * as Vault from './credvault.js';
import { lagColumn } from './mirror-lag.js';

/* ------------------------------------------------------------------ logging
   { tick, warn, head, line } — the CLI prints them in colour; the worker
   keeps the last few thousand characters so the one line that names a
   failure can be pulled out of it (sync-worker.js reason()). */
export function consoleLog() {
  return {
    tick: (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`),
    warn: (s) => console.log(`  \x1b[33m!\x1b[0m ${s}`),
    head: (s) => console.log(`\n\x1b[1m${s}\x1b[0m`),
    line: (s) => console.log(s)
  };
}

export function tailLog(keep = 4000) {
  let tail = '';
  const put = (s) => { tail = (tail + s + '\n').slice(-keep); };
  return {
    tick: (s) => put('✓ ' + s),
    warn: (s) => put('! ' + s),
    head: (s) => put(s),
    line: (s) => put(s),
    text: () => tail
  };
}

/* Let the event loop breathe between tables. node:sqlite is synchronous, so
   a replay of a busy table holds the loop while it reads; a request from
   the till waiting behind it gets its turn here rather than after the whole
   run. */
const breathe = () => new Promise((r) => setImmediate(r));

/* ------------------------------------------------------------- the cursors */
const cursors = new Map();   /* sync_state.id -> { last_seq, rows_pushed } */
let cursorsLoaded = false;

export async function loadCursors() {
  const rows = await SB.select('sync_state', { select: 'id,last_seq,rows_pushed', limit: 1000 });
  cursors.clear();
  for (const r of rows) cursors.set(r.id, { last_seq: Number(r.last_seq) || 0, rows_pushed: Number(r.rows_pushed) || 0 });
  cursorsLoaded = true;
  return cursors.size;
}

async function cursor(id, note) {
  if (!cursorsLoaded) await loadCursors();
  if (cursors.has(id)) return cursors.get(id);
  await SB.insert('sync_state', { id, last_seq: 0, note });
  const c = { last_seq: 0, rows_pushed: 0 };
  cursors.set(id, c);
  return c;
}

async function advance(id, patch) {
  await SB.update('sync_state', { id }, patch);
  const c = cursors.get(id) || { last_seq: 0, rows_pushed: 0 };
  if (patch.last_seq !== undefined) { c.last_seq = patch.last_seq; noteLocal(id, patch.last_seq); }
  if (patch.rows_pushed !== undefined) c.rows_pushed = patch.rows_pushed;
  cursors.set(id, c);
}

/* ------------------------------------------- what THIS machine has pushed
   sync_state says how far the mirror's bookmarks have moved; it does not say
   WHO moved them. Once the shop can move between laptops (lib/restore.js,
   the baton) that is the whole question: a bookmark the other laptop wrote
   is a position in the other laptop's change_log, and this machine's seq
   numbers mean nothing against it — measured that way, rows written here
   can read as "already pushed" when they never left. So every advance is
   also written locally (migration 038), and unpushed() counts against that
   and nothing else. A bare write: it is bookkeeping about the log, and must
   not itself land in the log. */
function noteLocal(id, lastSeq) {
  try {
    DB.get().prepare(
      `INSERT INTO sync_local (id, last_seq, at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seq = excluded.last_seq, at = excluded.at`
    ).run(id, lastSeq, new Date().toISOString());
  } catch { /* a database from before 038 — the migration lands on the next boot */ }
}

/* ------------------------------------------------- the unlogged tables
   Nothing writes a change_log row for these, so there is no bookmark to
   compare. A content hash is: SELECT the table in key order, hash the JSON,
   push only when it differs from what was last pushed. Two hundred and
   fifty rows hash in well under a millisecond, which is what makes asking
   every ten seconds free.

   users: the password columns go INTO the hash input — a changed password
   must re-seal the box — and never into the row that is sent. */
const WHOLE_KEYS = {
  currencies: ['code'], warehouses: ['id'], config: ['key'],
  role_permissions: ['role', 'perm'], label_templates: ['id'], clubs: ['code'],
  categories: ['id'],
  user_permissions: ['user_id', 'perm'],
  notification_reads: ['user_id', 'key'], users: ['id']
};
const hashes = new Map();

function hashOf(table) {
  const order = WHOLE_KEYS[table].join(', ');
  let rows;
  try { rows = DB.get().prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all(); }
  catch { return null; }
  return createHash('sha1').update(JSON.stringify(rows)).digest('hex');
}

function wholeChanged(table) {
  const h = hashOf(table);
  if (h === null) return false;
  return hashes.get(table) !== h;
}

function markPushed(table) {
  const h = hashOf(table);
  if (h !== null) hashes.set(table, h);
  noteLocal('whole:' + table, 0);
}

/* -------------------------------------------------------------- reference
   Small, static, not logged to change_log. Must run before products/stock:
   both have foreign keys into these. */
async function syncReference(log, want) {
  const doing = ['currencies', 'warehouses'].filter(want);
  if (!doing.length) return;
  log.head('Reference data');
  for (const t of doing) {
    await guard(log, t, async () => {
      const rows = DB.get().prepare(`SELECT * FROM ${t}`).all();
      if (rows.length) await SB.insert(t, rows, { upsert: true });
      markPushed(t);
      log.tick(`${t.padEnd(12)} ${rows.length} rows`);
    });
  }
}

/* ------------------------------------------------------------- settings
   Mirrored, not merely upserted. A setting somebody deleted or a permission
   they revoked has to disappear from the mirror as well, or restoring from
   it hands the shop back a grant it had deliberately taken away. Reading
   the table back to find those is fine at this size — and, on the fast
   lane, happens only when the hash says the table moved. */
async function mirrorTable(log, table, keyCols, mapRow) {
  const local = DB.get().prepare(`SELECT * FROM ${table}`).all();
  const rows = mapRow ? local.map(mapRow) : local;

  if (rows.length) await SB.insert(table, rows, { upsert: true });

  const keyOf = (r) => keyCols.map((c) => r[c]).join('\u0000');
  const here = new Set(local.map(keyOf));
  const remote = await SB.select(table, { select: keyCols.join(','), limit: 10000 });

  let dropped = 0;
  for (const r of remote) {
    if (here.has(keyOf(r))) continue;
    const match = {};
    for (const c of keyCols) match[c] = r[c];
    await SB.remove(table, match);
    dropped++;
  }
  markPushed(table);
  log.tick(`${table.padEnd(17)}${String(rows.length).padStart(4)} rows` +
           (dropped ? `, ${dropped} removed` : ''));
}

/* slots is a JSON string in SQLite and JSONB in Postgres. One unreadable
   template must not take the whole sync down with it. */
function parseSlots(log, raw, id) {
  try { return JSON.parse(raw); }
  catch { log.warn(`label template ${id}: unreadable slots — mirrored as empty`); return []; }
}

async function syncSettings(log, want) {
  const doing = ['config', 'role_permissions', 'label_templates', 'categories', 'user_permissions'].filter(want);
  if (!doing.length) return;
  log.head('Settings');
  if (want('config')) await guard(log, 'config', () => mirrorTable(log, 'config', ['key']));
  if (want('role_permissions')) {
    await guard(log, 'role_permissions', () =>
      mirrorTable(log, 'role_permissions', ['role', 'perm'], (r) => ({ ...r, allowed: !!r.allowed })));
  }
  if (want('label_templates')) {
    await guard(log, 'label_templates', () =>
      mirrorTable(log, 'label_templates', ['id'],
                  (r) => ({ ...r, archived: !!r.archived, slots: parseSlots(log, r.slots, r.id) })));
  }
  /* 059 — access per person, pushed whole, deletes follow. Its own guard. */
  if (want('user_permissions')) {
    try {
      await mirrorTable(log, 'user_permissions', ['user_id', 'perm'], (r) => ({ ...r, allowed: !!r.allowed }));
      denied.delete('user_permissions');
    } catch (e) {
      if (noteRefused(log, 'user_permissions', e)) return syncSettingsTail(log, want);
      if (!MISSING_TABLE.test(String(e.message))) throw e;
      log.warn('Supabase is missing user_permissions — skipped, everything else still went up.');
      log.line('    Run server/supabase/027_access.sql in the SQL editor.');
    }
  }
  await syncSettingsTail(log, want);
}

/* 057 — its own guard: a mirror without 025 still gets every other setting. */
async function syncSettingsTail(log, want) {
  if (want('categories')) {
    try {
      await mirrorTable(log, 'categories', ['id'], (r) => ({ ...r, active: !!r.active, sizes: parseSlots(log, r.sizes, r.id) }));
      denied.delete('categories');
    } catch (e) {
      if (noteRefused(log, 'categories', e)) return;
      if (!MISSING_TABLE.test(String(e.message))) throw e;
      log.warn('Supabase is missing categories — skipped, everything else still went up.');
      log.line('    Run server/supabase/025_categories.sql in the SQL editor.');
    }
  }
}

/* --------------------------------------------------------- append-only
   Only ever inserted into, never updated and never deleted, so the cheapest
   correct cursor is the highest id already pushed. Same rebuild trap as the
   seq cursor: a cursor ahead of the highest id that exists can only mean
   the table was rebuilt underneath us — rewind and replay. */
async function syncAppendOnly(log, table, mapRow) {
  const cursorId = `sync:${table}:maxid`;
  const c = await cursor(cursorId, `highest ${table}.id pushed`);
  let lastId = c.last_seq;

  const highest = DB.get().prepare(`SELECT MAX(id) AS m FROM ${table}`).get().m;
  if (highest !== null && lastId > highest) {
    log.warn(`${table}: cursor at ${lastId} but the table only reaches ${highest} — ` +
             'it was rebuilt underneath us. Rewinding and replaying.');
    lastId = 0;
  }

  const rows = DB.get().prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id ASC`).all(lastId);
  if (!rows.length) { log.tick(`${table.padEnd(17)}nothing new`); return 0; }

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await SB.insert(table, mapRow ? slice.map(mapRow) : slice, { upsert: true });
  }

  const top = rows[rows.length - 1].id;
  await advance(cursorId, {
    last_seq: top,
    last_push_at: new Date().toISOString(),
    rows_pushed: c.rows_pushed + rows.length,
    note: `highest ${table}.id pushed`
  });
  log.tick(`${table.padEnd(17)}${String(rows.length).padStart(4)} new row(s), through id ${top}`);
  return rows.length;
}

/* ------------------------------------------------------------------ users
   The column list is named explicitly and does not include pw_hash,
   pw_salt, pw_hint or must_change — see the file header. The sealed box is
   fetched in a SECOND query, per user, and never joined into the SELECT
   that builds the mirror row. */
async function syncUsers(log) {
  const sealing = Vault.isEnabled();
  log.head(sealing ? 'users (safe fields + sealed credentials)' : 'users (safe fields only)');

  const users = DB.get().prepare(
    'SELECT id, username, name, role, phone, active, created_at, updated_at FROM users'
  ).all();
  if (!users.length) { log.line('  none'); markPushed('users'); return; }

  const rows = users.map((u) => ({ ...u, active: !!u.active }));
  if (sealing) {
    const cred = DB.get().prepare(
      'SELECT pw_hash, pw_salt, pw_hint, must_change, pw_box FROM users WHERE id = ?'
    );
    for (const r of rows) {
      const c = cred.get(r.id);
      r.pw_enc = (c && c.pw_hash && c.pw_salt) ? Vault.sealUser(c) : null;
    }
  }

  /* pw_enc arrives with server/supabase/002_user_credentials.sql, run by
     hand. Until then, push without the boxes and say what to run. */
  let sealedLanded = sealing;
  try {
    await SB.insert('users', rows, { upsert: true });
  } catch (e) {
    if (sealing && /pw_enc/.test(String(e.message))) {
      log.warn('Supabase has no pw_enc column yet — syncing without the sealed boxes.');
      log.line('    Run server/supabase/002_user_credentials.sql in the Supabase SQL editor.');
      await SB.insert('users', rows.map(({ pw_enc, ...rest }) => rest), { upsert: true });
      sealedLanded = false;
    } else { throw e; }
  }
  markPushed('users');
  log.tick(`upserted ${users.length} row(s) — username/name/role/phone/active` +
    (sealedLanded ? ', plus a sealed credential box each' : ' only'));
  if (!sealing) log.line('    OG_VAULT_KEY is not set, so accounts cannot be restored from this mirror.');
}

/* ---------------------------------------------------------- table configs
   parseKey turns a change_log.row_id back into the columns needed to fetch
   the row locally and to match it on Supabase for delete. mapRow adapts
   SQLite's types to Postgres's (INTEGER 0/1 -> boolean).

   Child rows (a sale's items, a job's lines) have no change_log entries of
   their own: they are written with the parent and only ever change through
   it, so the parent's afterUpsert replaces them whole. */
async function insertChildren(log, table, rows) {
  try {
    await SB.insert(table, rows, { upsert: true });
  } catch (e) {
    const lag = lagColumn(table, e);
    if (!lag) throw e;
    log.warn(`Supabase has no ${table}.${lag.col} column yet — pushing without it.`);
    log.line(`    Run ${lag.file} in the SQL editor, then npm run supabase:reconcile.`);
    await SB.insert(table, rows.map((r) => {
      const copy = { ...r };
      for (const c of lag.cols) delete copy[c];
      return copy;
    }), { upsert: true });
  }
}

const byId = (table) => (key) => DB.get().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(key.id);
const numKey = (rowId) => ({ id: Number(rowId) });
const textKey = (rowId) => ({ id: rowId });

async function replaceChildren(log, table, col, parentId, rows) {
  await SB.remove(table, { [col]: parentId }).catch(() => {});
  if (rows.length) await insertChildren(log, table, rows);
}

export const TABLES = {
  products: { parseKey: numKey, fetchLocal: byId('products'),
              mapRow: (r) => ({ ...r, hidden: !!r.hidden, on_web: !!r.on_web }) },
  variants: {
    parseKey: (rowId) => ({ sku: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM variants WHERE sku = ?').get(key.sku),
    mapRow: (r) => r
  },
  /* 058 — a product's colours. Cursor shape (renamed, re-pictured), pushed
     behind a guard of its own after the core loop: variants.colour_id is not
     a foreign key in the mirror, so the order does not matter there, and a
     project without 026 still mirrors the shop. */
  product_colours: { parseKey: numKey, fetchLocal: byId('product_colours'), mapRow: (r) => r },
  stock: {
    parseKey: (rowId) => { const [sku, wh_id] = rowId.split(':'); return { sku, wh_id }; },
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM stock WHERE sku = ? AND wh_id = ?').get(key.sku, key.wh_id),
    mapRow: (r) => r
  },

  /* The warehouse layout — pushed AFTER the core loop: shelves.product_id
     names a product, and stock rows carrying a shelf_id go up before any
     shelf does, which is safe only because neither is a foreign key on the
     Supabase side (server/supabase/006_shelves.sql). */
  rooms:    { parseKey: numKey, fetchLocal: byId('rooms'),    mapRow: (r) => r },
  sections: { parseKey: numKey, fetchLocal: byId('sections'), mapRow: (r) => r },
  shelves:  { parseKey: numKey, fetchLocal: byId('shelves'),  mapRow: (r) => r },

  customers: { parseKey: numKey, fetchLocal: byId('customers'), mapRow: (r) => r },

  /* CURSOR shape, not append-only: a want is UPDATED when the shop comes
     back to the customer, and a highest-id cursor would never notice. */
  wants: { parseKey: numKey, fetchLocal: byId('wants'), mapRow: (r) => r },

  sales: {
    parseKey: textKey, fetchLocal: byId('sales'),
    mapRow: (r) => ({ ...r, voided: !!r.voided }),
    afterUpsert: async (log, localRow) => {
      const items = DB.get().prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(localRow.id);
      await replaceChildren(log, 'sale_items', 'sale_id', localRow.id, items);
    },
    /* The mirror's print_log, debt_payments and order_payments point at a
       sale WITHOUT a cascade, so a sale purged here is refused there unless
       the children go first. order_payments does have a delete path of its
       own, but it runs after the core loop — the sale's delete gets there
       before it. */
    beforeDelete: async (key) => {
      for (const t of ['print_log', 'debt_payments', 'order_payments',
                       'order_returns', 'handover_lines', 'customer_credit', 'order_reviews', 'errands']) {
        await SB.remove(t, { sale_id: key.id }).catch(() => {});
      }
    }
  },
  deliveries: { parseKey: numKey, fetchLocal: byId('deliveries'), mapRow: (r) => r },

  /* CURSOR shape, not append-only like debt_payments: a driver's cash is
     UPDATED when it is handed in, and a highest-id bookmark would never see
     that. Pushed behind a guard of its own after the core loop — see walk(). */
  order_payments: { parseKey: numKey, fetchLocal: byId('order_payments'), mapRow: (r) => r },
  /* 060 — the delivery team's errands. Cursor shape: an errand is updated as it moves. */
  errands: { parseKey: numKey, fetchLocal: byId('errands'), mapRow: (r) => r },

  /* 046 — the road. A handover is the sheet somebody signed for, its lines
     are the parcels on it, a return is what happened when one came back, and
     customer_credit is money the shop owes a person. All cursor-shape: every
     one of them is updated after it is written (a sheet is handed over, a
     credit is spent), which a highest-id bookmark would never see. */
  handovers: {
    parseKey: textKey, fetchLocal: byId('handovers'), mapRow: (r) => r,
    afterUpsert: async (log, localRow) => {
      const rows = DB.get().prepare('SELECT * FROM handover_lines WHERE handover_id = ?').all(localRow.id);
      await replaceChildren(log, 'handover_lines', 'handover_id', localRow.id, rows);
    }
  },
  order_returns: {
    parseKey: numKey, fetchLocal: byId('order_returns'), mapRow: (r) => r,
    afterUpsert: async (log, localRow) => {
      const rows = DB.get().prepare('SELECT * FROM order_return_lines WHERE return_id = ?').all(localRow.id);
      await replaceChildren(log, 'order_return_lines', 'return_id', localRow.id, rows);
    }
  },
  customer_credit: { parseKey: numKey, fetchLocal: byId('customer_credit'), mapRow: (r) => r },

  print_jobs: {
    parseKey: textKey, fetchLocal: byId('print_jobs'), mapRow: (r) => r,
    afterUpsert: async (log, localRow) => {
      for (const t of ['print_job_lines', 'print_job_stages']) {
        const rows = DB.get().prepare(`SELECT * FROM ${t} WHERE job_id = ?`).all(localRow.id);
        await replaceChildren(log, t, 'job_id', localRow.id, rows);
      }
    }
  },
  partner_invoices: {
    parseKey: textKey, fetchLocal: byId('partner_invoices'), mapRow: (r) => r,
    afterUpsert: async (log, localRow) => {
      const refs = DB.get().prepare('SELECT * FROM partner_invoice_refs WHERE invoice_id = ?').all(localRow.id);
      await replaceChildren(log, 'partner_invoice_refs', 'invoice_id', localRow.id, refs);
      const pays = DB.get().prepare('SELECT * FROM partner_invoice_payments WHERE invoice_id = ?').all(localRow.id);
      await replaceChildren(log, 'partner_invoice_payments', 'invoice_id', localRow.id, pays);
    }
  },
  /* 049. Keyed by the sale, one review per order, like job_reviews by job. */
  order_reviews: {
    parseKey: (rowId) => ({ sale_id: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM order_reviews WHERE sale_id = ?').get(key.sale_id),
    mapRow: (r) => r
  },
  job_reviews: {
    parseKey: (rowId) => ({ job_id: rowId }),
    fetchLocal: (key) => DB.get().prepare('SELECT * FROM job_reviews WHERE job_id = ?').get(key.job_id),
    mapRow: (r) => r
  },
  job_messages: {
    parseKey: numKey, fetchLocal: byId('job_messages'),
    mapRow: (r) => ({ ...r, read_og: !!r.read_og, read_yl: !!r.read_yl })
  },
  suppliers: { parseKey: numKey, fetchLocal: byId('suppliers'), mapRow: (r) => ({ ...r, archived: !!r.archived }) },
  employees: { parseKey: numKey, fetchLocal: byId('employees'), mapRow: (r) => ({ ...r, archived: !!r.archived }) },

  shifts: { parseKey: textKey, fetchLocal: byId('shifts'), mapRow: (r) => r },
  /* 054 — the night's count. CURSOR shape: a close is UPDATED when the owner
     confirms it, and its per-currency lines ride on it like sale_items. */
  day_closes: {
    parseKey: textKey, fetchLocal: byId('day_closes'), mapRow: (r) => r,
    afterUpsert: async (log, localRow) => {
      const rows = DB.get().prepare('SELECT * FROM day_close_lines WHERE close_id = ?').all(localRow.id);
      await replaceChildren(log, 'day_close_lines', 'close_id', localRow.id, rows);
    }
  },
  stock_counts: {
    parseKey: textKey, fetchLocal: byId('stock_counts'), mapRow: (r) => r,
    afterUpsert: async (log, localRow) => {
      const rows = DB.get().prepare('SELECT * FROM stock_count_lines WHERE count_id = ?').all(localRow.id);
      await replaceChildren(log, 'stock_count_lines', 'count_id', localRow.id, rows);
    }
  },
  purchase_orders: {
    parseKey: textKey, fetchLocal: byId('purchase_orders'), mapRow: (r) => r,
    afterUpsert: async (log, localRow) => {
      const rows = DB.get().prepare('SELECT * FROM purchase_order_lines WHERE po_id = ?').all(localRow.id);
      await replaceChildren(log, 'purchase_order_lines', 'po_id', localRow.id, rows);
    }
  }
};

/* Upsert a batch with the two repairs this mirror has needed in practice.

   1. A column this machine has and the mirror has not (lib/mirror-lag.js):
      retry without it and say which file to run.
   2. A PARENT ROW THE MIRROR HAS NOT GOT. Postgres answers

        insert or update on table "deliveries" violates foreign key constraint
        "deliveries_sale_id_fkey" · Key (sale_id)=(INV-2102) is not present
        in table "sales"

      which on 2026-09-04 killed the whole run: the sale's log entry had
      been consumed by a run that never landed it, so no cursor would ever
      look at it again, while the delivery pointing at it was retried
      forever. The parent is one local query away. Push it — with its own
      children — and retry the batch once. A parent that does not exist
      locally either is a real fault and is thrown. */
const FK_RE = /violates foreign key constraint .*?Key \((\w+)\)=\((.+?)\) is not present in table "(\w+)"/;

async function healParent(log, err) {
  const m = FK_RE.exec(String(err.message));
  if (!m) return false;
  const [, , value, parent] = m;
  const cfg = TABLES[parent];
  if (!cfg) return false;
  const row = cfg.fetchLocal(cfg.parseKey(value));
  if (!row) return false;
  log.warn(`${parent} ${value} was missing from the mirror — pushing it first, then retrying.`);
  await upsertRows(log, parent, [cfg.mapRow(row)], { heal: false });
  if (cfg.afterUpsert) await cfg.afterUpsert(log, row);
  return true;
}

async function upsertRows(log, name, rows, { heal = true } = {}) {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    try {
      await SB.insert(name, slice, { upsert: true });
    } catch (e) {
      const lag = lagColumn(name, e);
      if (lag) {
        log.warn(`Supabase has no ${name}.${lag.col} column yet — pushing without it.`);
        log.line(`    Run ${lag.file} in the SQL editor.`);
        await SB.insert(name, slice.map((r) => {
          const copy = { ...r };
          for (const c of lag.cols) delete copy[c];
          return copy;
        }), { upsert: true });
        continue;
      }
      if (heal && await healParent(log, e)) {
        await SB.insert(name, slice, { upsert: true });
        continue;
      }
      throw e;
    }
  }
}

/* TWO PHASES, AND THEY RUN IN OPPOSITE ORDERS. Inserts need parents first;
   deletes need exactly the reverse. So every table upserts in FK order,
   then every table deletes in reverse, and the cursor only advances after
   the delete phase — a run that dies between the two picks both up again. */
async function syncTable(log, name, { phase = 'both' } = {}) {
  const cfg = TABLES[name];
  const cursorId = 'sync:' + name;
  const c = await cursor(cursorId, `cursor for ${name}`);
  let lastSeq = c.last_seq;

  /* THE CURSOR CAN OUTLIVE THE LOG IT POINTS INTO. A rebuilt database
     restarts seq at 1 while the cursor sits in the hundreds; a cursor ahead
     of this table's OWN highest seq can only mean that. Rewind and replay —
     every push is an upsert. The maximum must be this table's, not the
     whole log's: sync:deliveries once sat at 142 while deliveries' highest
     entry was 22, and measured against sales' 1001 it never rewound. */
  const highest = DB.get().prepare('SELECT MAX(seq) AS m FROM change_log WHERE tbl = ?').get(name).m;
  if (highest !== null && lastSeq > highest) {
    if (phase !== 'delete') log.head(name);
    log.warn(`cursor was at ${lastSeq} but the log only reaches ${highest} — ` +
             'it was reset underneath us. Rewinding to 0 and replaying.');
    lastSeq = 0;
    await advance(cursorId, { last_seq: 0, note: 'rewound: change_log had been reset' });
  }

  const rows = DB.get().prepare(
    'SELECT seq, row_id, op FROM change_log WHERE tbl = ? AND seq > ? ORDER BY seq ASC'
  ).all(name, lastSeq);

  if (phase !== 'delete') log.head(name);
  if (!rows.length) {
    if (phase !== 'delete') log.line('  nothing new since seq ' + lastSeq);
    return 0;
  }

  /* Only the LATEST op per row matters: the log stores "this row changed",
     not values, and the current state is one query away. */
  const latest = new Map();
  for (const r of rows) latest.set(r.row_id, r);

  const toUpsert = [];
  const toDeleteKeys = [];
  for (const entry of latest.values()) {
    const key = cfg.parseKey(entry.row_id);
    if (entry.op === 'delete') { toDeleteKeys.push(key); continue; }
    const localRow = cfg.fetchLocal(key);
    /* Logged as a write but gone locally: a delete that happened after the
       log entry and before this run. */
    if (!localRow) { toDeleteKeys.push(key); continue; }
    toUpsert.push(localRow);
  }

  let pushed = 0, deleted = 0;
  if (phase !== 'delete' && toUpsert.length) {
    await upsertRows(log, name, toUpsert.map(cfg.mapRow));
    pushed = toUpsert.length;
    log.tick(`upserted ${pushed} row(s)`);
    if (cfg.afterUpsert) {
      for (const row of toUpsert) await cfg.afterUpsert(log, row);
      log.tick(`ran afterUpsert for ${pushed} row(s)`);
    }
  }
  if (phase !== 'upsert') {
    for (const key of toDeleteKeys) {
      if (cfg.beforeDelete) await cfg.beforeDelete(key);
      await SB.remove(name, key);
      deleted++;
    }
    if (deleted) log.tick(`deleted ${deleted} row(s)`);
  }

  if (phase === 'upsert') return pushed;

  const maxSeq = rows[rows.length - 1].seq;
  await advance(cursorId, {
    last_seq: maxSeq,
    last_push_at: new Date().toISOString(),
    rows_pushed: c.rows_pushed + pushed,
    note: `${pushed} upserted, ${deleted} deleted, through seq ${maxSeq}`
  });
  log.tick(`cursor advanced ${lastSeq} → ${maxSeq}`);
  return pushed + deleted;
}

/* --------------------------------------------------------------- groups
   Insertion order is the FK dependency order. Deletes run in reverse. */
const CORE    = ['products', 'variants', 'stock', 'customers', 'sales', 'deliveries'];
const LAYOUT  = ['rooms', 'sections', 'shelves'];
const PARTNER = ['print_jobs', 'job_reviews', 'partner_invoices', 'job_messages', 'suppliers',
                 'employees', 'purchase_orders'];
const DRAWER  = ['shifts', 'stock_counts'];
const APPEND  = ['fx_rates', 'stock_movements', 'print_log', 'label_print_log',
                 'loyalty_redemptions', 'wa_messages', 'expenses', 'debt_payments',
                 /* 053 — the cash book. Append-only by design: a correction is
                    a new row, so the highest-id bookmark sees every one. 055's
                    two ledgers are the same kind of table, for the same reason. */
                 'money_moves', 'supplier_ledger', 'salary_payments'];
const WHOLE   = Object.keys(WHOLE_KEYS);

/* Every table this library pushes, for the check and the status. */
/* handover_lines and order_return_lines are not here on purpose: each rides
   on its parent's afterUpsert, the way sale_items ride on their sale. */
export const CURSOR_TABLES = [...CORE, ...LAYOUT, 'wants', 'product_colours',
                              'order_payments', 'handovers', 'order_returns', 'customer_credit', 'order_reviews', 'errands',
                              ...PARTNER, ...DRAWER, 'day_closes'];

const MISSING_TABLE = /Could not find the table|PGRST205|relation .* does not exist|Supabase 404 on /i;
const MISSING_COLUMN = /PGRST204|column .* does not exist|Could not find the '[a-z_]+' column/i;

/* A TABLE SUPABASE REFUSES IS NOT A MISSING TABLE, AND IT IS NOT A REASON TO
   STOP. On 17 Sep 2026 the files 025–028 created their tables without
   granting the service role anything, and the first "permission denied for
   table user_permissions" took the WHOLE run down with it — sales included.
   Now the refused table is skipped by name and the rest goes up. Its bookmark
   (cursor, highest id, or content hash) only moves after a push that landed,
   so nothing is lost: the rows wait here and go up on the first run after the
   GRANT. It is loud on purpose — the sync status carries the list with the
   SQL to run (the panel's Connections card, the Mirror fold and the bell draw
   it), and the log says it on every run that meets it. */
const REFUSED = /permission denied for (?:table|relation|sequence|schema)|\b42501\b/i;
const denied = new Map();

export function refusals() { return [...denied.values()]; }

export function grantSql(table) {
  return `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO service_role;`;
}

function noteRefused(log, name, e) {
  const msg = String((e && e.message) || e);
  if (!REFUSED.test(msg)) return false;
  const m = msg.match(/permission denied for (?:table|relation) "?([a-z_0-9]+)"?/i);
  const table = m ? m[1] : name;
  const now = new Date().toISOString();
  const was = denied.get(table);
  denied.set(table, { table, sql: grantSql(table), since: was ? was.since : now, at: now });
  log.warn(`Supabase REFUSED ${table} (permission denied) — skipped; its rows wait on this machine and go up once it is fixed.`);
  log.line(`    Run in Supabase → SQL Editor: ${grantSql(table)}`);
  return true;
}

/* One table's step: a success clears its refusal, a refusal is noted and
   answered false, anything else is thrown as before. */
async function guard(log, name, fn) {
  try {
    await fn();
    denied.delete(name);
    return true;
  } catch (e) {
    if (noteRefused(log, name, e)) return false;
    throw e;
  }
}

/* Upsert forward, delete reversed, for the tables of a group that are wanted. */
async function twoPhase(log, names, want) {
  const doing = names.filter(want);
  const refused = new Set();
  for (const n of doing) {
    if (!await guard(log, n, () => syncTable(log, n, { phase: 'upsert' }))) refused.add(n);
    await breathe();
  }
  for (const n of doing.slice().reverse()) {
    if (refused.has(n)) continue;
    if (!await guard(log, n, () => syncTable(log, n, { phase: 'delete' }))) refused.add(n);
    await breathe();
  }
  return doing.filter((n) => !refused.has(n));
}

/* The one walk both entry points share. `only` is null for a full run, or
   the Set of table names that have moved. Group guards are unchanged from
   the script: a table the mirror has not got is skipped BY NAME with the
   file to run, and the day's sales still go up. */
async function walk(log, only) {
  const want = (n) => !only || only.has(n);
  const touched = [];
  const flags = { layoutFailed: false, loyaltyFailed: false, cashFailed: false };
  const finish = () => ({ touched, ...flags, refused: refusals() });

  await syncReference(log, want);
  await syncSettings(log, want);
  if (want('users')) await guard(log, 'users', () => syncUsers(log));
  await breathe();

  touched.push(...await twoPhase(log, CORE, want));

  /* The warehouse layout — ONE GUARD PER TABLE: sections and shelves come
     with 006, rooms with 008, and one catch around the block once skipped
     seventy shelves over a table that had nothing to do with them. */
  const layoutWanted = LAYOUT.filter(want);
  if (layoutWanted.length) {
    log.head('Warehouse layout');
    const skipped = new Set();
    const step = async (name, phase) => {
      if (skipped.has(name)) return;
      try {
        await syncTable(log, name, { phase });
        if (phase === 'delete') { touched.push(name); denied.delete(name); }
      } catch (e) {
        const msg = String(e.message);
        if (noteRefused(log, name, e)) { skipped.add(name); return; }
        /* A MISSING COLUMN IS NOT A MISSING TABLE; column first, because its
           message contains the table pattern's words too. */
        if (MISSING_COLUMN.test(msg)) {
          const col = msg.match(/'([a-z_]+)' column|column "([a-z_]+)"|column [a-z_]+\.([a-z_]+)/);
          log.warn(`Supabase is missing a layout column on ${name}` +
                   (col ? ': ' + (col[1] || col[2] || col[3]) : '') + ` — ${name} was NOT mirrored.`);
          log.line('    Run the newest server/supabase/*.sql in the SQL editor. The rows are');
          log.line('    retried on every run until then; nothing is lost, only late.');
          flags.layoutFailed = true;
          skipped.add(name);
        } else if (MISSING_TABLE.test(msg)) {
          log.warn(`Supabase is missing a table: ${name} — skipped.`);
          log.line(`    Run ${name === 'rooms' ? 'server/supabase/008_rooms.sql' : 'server/supabase/006_shelves.sql'} in the SQL editor.`);
          skipped.add(name);
        } else throw e;
      }
    };
    for (const n of layoutWanted) await step(n, 'upsert');
    for (const n of layoutWanted.slice().reverse()) await step(n, 'delete');
    await breathe();
  }

  /* After the loop: a movement points at a variant and a warehouse, a rate
     at a currency. */
  if (want('fx_rates') || want('stock_movements')) {
    log.head('History');
    for (const t of ['fx_rates', 'stock_movements'].filter(want)) {
      if (await guard(log, t, () => syncAppendOnly(log, t))) touched.push(t);
    }
    await breathe();
  }

  /* What was actually printed is history worth keeping; a print audit log
     is not worth stopping a day of sales for, so it warns and carries on.
     The maxid cursor does not move on a failure, so the rows wait. */
  if (want('print_log') || want('label_print_log')) {
    log.head('Print history');
    for (const t of ['print_log', 'label_print_log'].filter(want)) {
      try { await syncAppendOnly(log, t); touched.push(t); denied.delete(t); }
      catch (e) {
        if (noteRefused(log, t, e)) continue;
        log.warn(`${t}: ${String(e.message).slice(0, 90)}`);
        if (t === 'print_log' && /\bkind\b/.test(String(e.message))) {
          log.line('    Run server/supabase/009_gift_receipt.sql in the SQL editor — the rows');
          log.line('    are retried on every run until then.');
        }
      }
    }
  }

  /* 058 — colours, behind their own guard. */
  if (want('product_colours')) {
    log.head('Colours');
    try {
      await syncTable(log, 'product_colours', { phase: 'upsert' });
      await syncTable(log, 'product_colours', { phase: 'delete' });
      touched.push('product_colours');
      denied.delete('product_colours');
    } catch (e) {
      if (noteRefused(log, 'product_colours', e)) { /* skipped, named */ }
      else {
      if (!MISSING_TABLE.test(String(e.message))) throw e;
      log.warn('Supabase is missing product_colours — skipped, everything else still went up.');
      log.line('    Run server/supabase/026_colours.sql in the SQL editor.');
      }
    }
    await breathe();
  }

  /* The stamp cards and the wants list: the two tables recoverable from
     NOTHING else, each behind its own guard. */
  if (want('loyalty_redemptions') || want('wants')) {
    log.head('Loyalty and wants');
    const step = async (name, fn) => {
      try { await fn(); touched.push(name); denied.delete(name); }
      catch (e) {
        if (noteRefused(log, name, e)) return;
        if (/does not exist|Could not find the table|PGRST205|Supabase 404 on |schema cache/i.test(String(e.message))) {
          log.warn(`Supabase is missing ${name} — skipped, everything else still went up.`);
          log.line('    Run server/supabase/010_loyalty_and_wants.sql in the SQL editor.');
          flags.loyaltyFailed = true;
        } else throw e;
      }
    };
    if (want('loyalty_redemptions')) await step('loyalty_redemptions', () => syncAppendOnly(log, 'loyalty_redemptions'));
    if (want('wants')) await step('wants', async () => {
      await syncTable(log, 'wants', { phase: 'upsert' });
      await syncTable(log, 'wants', { phase: 'delete' });
    });
    await breathe();
  }

  /* The delivery office's payments — who paid how much towards an order, and
     which driver is still holding the cash. After the core loop, because a
     payment names its sale; and behind a guard of its own rather than inside
     the partner block below, which is one try — a project that has not had
     017 run would otherwise lose expenses, debt payments and the read marks
     along with it. */
  const ROAD = ['order_payments', 'handovers', 'order_returns', 'customer_credit', 'order_reviews', 'errands'];
  if (ROAD.some(want)) {
    log.head('Delivery office');
    /* ONE GUARD PER TABLE, not one around the block: a project that has had
       017 run but not 018 must still mirror its payments, and the layout
       guard above exists because that lesson cost seventy shelves once. */
    for (const name of ROAD.filter(want)) {
      try {
        await syncTable(log, name, { phase: 'upsert' });
        await syncTable(log, name, { phase: 'delete' });
        touched.push(name);
        denied.delete(name);
      } catch (e) {
        if (noteRefused(log, name, e)) continue;
        if (MISSING_TABLE.test(String(e.message))) {
          log.warn(`Supabase is missing ${name} — skipped, everything else still went up.`);
          log.line('    Run server/supabase/' +
            (name === 'order_payments' ? '017_delivery_office.sql'
              : name === 'order_reviews' ? '019_order_reviews.sql'
              : name === 'errands' ? '028_safeers.sql' : '018_the_road.sql') +
            ' in the SQL editor.');
        } else throw e;
      }
    }
    await breathe();
  }

  /* The partner half, the drawer and the read marks arrive with files run
     by hand (003, 004, 005, 012). One missing table names itself and the
     rest of the run still lands. */
  const partnerWanted = ['clubs', ...PARTNER, 'wa_messages', ...DRAWER, 'expenses', 'debt_payments',
                         'notification_reads'].some(want);
  if (partnerWanted) {
    log.head('Partner');
    try {
      if (want('clubs')) await guard(log, 'clubs', () => mirrorTable(log, 'clubs', ['code'], (r) => ({ ...r, archived: !!r.archived })));
      touched.push(...await twoPhase(log, PARTNER, want));
      if (want('wa_messages') && await guard(log, 'wa_messages', () => syncAppendOnly(log, 'wa_messages'))) touched.push('wa_messages');
      touched.push(...await twoPhase(log, DRAWER, want));
      for (const t of ['expenses', 'debt_payments'].filter(want)) {
        if (await guard(log, t, () => syncAppendOnly(log, t))) touched.push(t);
      }
      if (want('notification_reads')) await guard(log, 'notification_reads', () => mirrorTable(log, 'notification_reads', ['user_id', 'key']));
    } catch (e) {
      if (/does not exist|Could not find the table|PGRST205|schema cache/i.test(String(e.message))) {
        const named = String(e.message).match(/public.([a-z_]+)/);
        log.warn('Supabase is missing a table' + (named ? ': ' + named[1] : '') + ' — skipped.');
        log.line('    Run server/supabase/CATCH-UP.sql in the Supabase SQL editor.');
      } else { throw e; }
    }
  }

  /* The cash book (053), behind its own guard and after everything it could
     name — a move points at a currency and a user, nothing else. A project
     that has not had 021 run skips it BY NAME and the rest of the run lands;
     the bookmark does not move, so every row waits rather than being lost. */
  /* ONE GUARD PER TABLE, like the road's: a project that has had 021 run but
     not 022 must still mirror its cash book. */
  const missing = (e) => MISSING_TABLE.test(String(e.message)) || /schema cache/i.test(String(e.message));
  const BOOKS = ['money_moves', 'day_closes', 'supplier_ledger', 'salary_payments'];
  if (BOOKS.some(want)) log.head('Cash book');
  if (want('money_moves')) {
    try {
      await syncAppendOnly(log, 'money_moves');
      touched.push('money_moves');
      denied.delete('money_moves');
    } catch (e) {
      if (noteRefused(log, 'money_moves', e)) { flags.cashFailed = true; }
      else if (!missing(e)) throw e;
      else {
      log.warn('Supabase is missing money_moves — skipped, everything else still went up.');
      log.line('    Run server/supabase/021_cash_book.sql in the SQL editor.');
      flags.cashFailed = true;
      }
    }
  }
  if (want('day_closes')) {
    try {
      await syncTable(log, 'day_closes', { phase: 'upsert' });
      await syncTable(log, 'day_closes', { phase: 'delete' });
      touched.push('day_closes');
      denied.delete('day_closes');
    } catch (e) {
      if (noteRefused(log, 'day_closes', e)) { flags.cashFailed = true; }
      else if (!missing(e)) throw e;
      else {
      log.warn('Supabase is missing day_closes — skipped, everything else still went up.');
      log.line('    Run server/supabase/022_day_close.sql in the SQL editor.');
      flags.cashFailed = true;
      }
    }
  }
  /* 055 — what suppliers and staff were paid. After the partner block, which
     is where suppliers and employees go up: a ledger row names one. */
  for (const name of ['supplier_ledger', 'salary_payments'].filter(want)) {
    try {
      await syncAppendOnly(log, name);
      touched.push(name);
      denied.delete(name);
    } catch (e) {
      if (noteRefused(log, name, e)) { flags.cashFailed = true; continue; }
      if (!missing(e)) throw e;
      log.warn(`Supabase is missing ${name} — skipped, everything else still went up.`);
      log.line('    Run server/supabase/023_payables.sql in the SQL editor.');
      flags.cashFailed = true;
    }
  }

  return finish();
}

/* ------------------------------------------------------------ detection
   Which tables have moved since their bookmark — asked of SQLite only. */
function detect() {
  if (!cursorsLoaded) return null;
  const d = DB.get();
  const changed = new Set();
  let behind = 0;

  const maxes = new Map(d.prepare('SELECT tbl, MAX(seq) AS m FROM change_log GROUP BY tbl').all()
                          .map((r) => [r.tbl, r.m]));
  for (const t of CURSOR_TABLES) {
    const m = maxes.get(t);
    if (m === undefined) continue;
    const c = cursors.get('sync:' + t);
    const last = c ? c.last_seq : 0;
    /* Ahead of its own log: the rebuild case. Treat as changed so the
       replay's rewind runs. */
    if (m > last || last > m) {
      changed.add(t);
      behind += last > m ? m
        : d.prepare('SELECT COUNT(DISTINCT row_id) AS n FROM change_log WHERE tbl = ? AND seq > ?').get(t, last).n;
    }
  }
  for (const t of APPEND) {
    let m;
    try { m = d.prepare(`SELECT MAX(id) AS m FROM ${t}`).get().m; } catch { continue; }
    if (m === null) continue;
    const c = cursors.get(`sync:${t}:maxid`);
    const last = c ? c.last_seq : 0;
    if (m > last || last > m) {
      changed.add(t);
      behind += last > m ? m : d.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE id > ?`).get(last).n;
    }
  }
  for (const t of WHOLE) {
    if (wholeChanged(t)) { changed.add(t); behind += 1; }
  }
  return { changed, behind };
}

/* Rows on this machine that the mirror has not got, counted locally.
   null before the cursors have been read (nothing is known yet). */
export function behind() {
  const r = detect();
  return r ? r.behind : null;
}

/* Rows written on THIS machine after the last push THIS machine made —
   counted against sync_local, never against the mirror's bookmarks (see
   noteLocal). The question lib/restore.js asks before it wipes anything.
   A table with no local record counts everything: conservative on purpose,
   and adoptCursorsLocally() below fills the record in the first time a
   machine syncs under its own lineage.

   { total, byTable, outbox } — outbox is the Telegram queue, which is not
   mirrored at all and would simply vanish with the wipe. */
export function unpushed() {
  const d = DB.get();
  const local = new Map();
  try { for (const r of d.prepare('SELECT id, last_seq, at FROM sync_local').all()) local.set(r.id, r); }
  catch { /* pre-038: nothing recorded, everything counts */ }

  const byTable = {};
  let total = 0;
  const maxes = new Map(d.prepare('SELECT tbl, MAX(seq) AS m FROM change_log GROUP BY tbl').all()
                          .map((r) => [r.tbl, r.m]));
  for (const t of CURSOR_TABLES) {
    if (maxes.get(t) === undefined) continue;
    const l = local.get('sync:' + t);
    const n = d.prepare('SELECT COUNT(DISTINCT row_id) AS n FROM change_log WHERE tbl = ? AND seq > ?')
               .get(t, l ? l.last_seq : 0).n;
    if (n) { byTable[t] = n; total += n; }
  }
  for (const t of APPEND) {
    let m;
    try { m = d.prepare(`SELECT MAX(id) AS m FROM ${t}`).get().m; } catch { continue; }
    if (m === null) continue;
    const l = local.get(`sync:${t}:maxid`);
    const n = d.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE id > ?`).get(l ? l.last_seq : 0).n;
    if (n) { byTable[t] = n; total += n; }
  }
  /* The whole tables carry no log. Two of them carry a timestamp, which is
     enough; the rest are settings a person can re-enter, and the moved-aside
     file keeps them anyway. */
  for (const t of ['config', 'users']) {
    let m;
    try { m = d.prepare(`SELECT MAX(updated_at) AS m FROM ${t}`).get().m; } catch { continue; }
    const l = local.get('whole:' + t);
    if (m && (!l || m > l.at)) { byTable[t] = 1; total += 1; }
  }
  let outbox = 0;
  try { outbox = d.prepare('SELECT COUNT(*) AS n FROM partner_events WHERE sent_at IS NULL').get().n; }
  catch { /* no outbox table */ }
  return { total, byTable, outbox };
}

/* The mirror's bookmarks ARE this machine's when the lineage is ours — copy
   them into sync_local so unpushed() stops counting months of history the
   first time a long-running shop boots on this code. */
export async function adoptCursorsLocally() {
  if (!cursorsLoaded) await loadCursors();
  for (const [id, c] of cursors) if (id.startsWith('sync:')) noteLocal(id, c.last_seq);
}

/* After the boot pull. The local change_log is empty and the restore wrote
   outside it, so every seq bookmark points into a log that no longer exists
   — the exact "cursor outlives its log" trap the rewind in syncTable()
   catches, one table at a time, each with a warning that would be a lie
   after a deliberate pull. Say what is true instead: nothing has been
   logged (seq cursors → 0), and every append-only row up to the local
   maximum came FROM the mirror (maxid cursors → MAX(id)). One upsert, so a
   slow line costs one round trip rather than thirty. */
export async function resetCursorsAfterPull({ log = tailLog() } = {}) {
  if (!cursorsLoaded) await loadCursors();
  const d = DB.get();
  const now = new Date().toISOString();
  const host = hostname();
  const rows = [];
  for (const t of CURSOR_TABLES) {
    rows.push({ id: 'sync:' + t, last_seq: 0, last_push_at: now, note: `reset: pulled onto ${host}` });
  }
  for (const t of APPEND) {
    let m;
    try { m = d.prepare(`SELECT MAX(id) AS m FROM ${t}`).get().m; } catch { continue; }
    rows.push({ id: `sync:${t}:maxid`, last_seq: m || 0, last_push_at: now, note: `reset: pulled onto ${host}` });
  }
  rows.push({ id: 'shop', last_seq: 0, last_push_at: now, note: `pulled onto ${host}` });
  await SB.insert('sync_state', rows, { upsert: true });
  for (const r of rows) {
    if (r.id === 'shop') continue;
    const c = cursors.get(r.id) || { last_seq: 0, rows_pushed: 0 };
    c.last_seq = r.last_seq;
    cursors.set(r.id, c);
    noteLocal(r.id, r.last_seq);
  }
  /* The whole tables now equal the mirror, so "pushed as of now" is true. */
  for (const t of WHOLE) noteLocal('whole:' + t, 0);
  log.tick(`${rows.length - 1} bookmark(s) reset for ${host}`);
}

/* Everything, in order, the way the CLI has always done it. Settings and
   users are rewritten whole here — the reconcile relies on that. */
export async function fullRun({ log = consoleLog() } = {}) {
  if (!cursorsLoaded) await loadCursors();
  const r = await walk(log, null);
  await SB.update('sync_state', { id: 'shop' }, {
    last_push_at: new Date().toISOString(),
    note: 'full run completed'
  });
  return { ok: !r.layoutFailed && !r.loyaltyFailed && !r.cashFailed && !r.refused.length, ...r };
}

/* Only what moved. No request at all when nothing did. */
export async function pushChanged({ log = tailLog() } = {}) {
  if (!cursorsLoaded) await loadCursors();
  const det = detect();
  /* A refused table is asked again at most once a minute here (the full run
     always asks): every ten seconds would be a request and a log line each
     time for a table nobody has granted yet. */
  const now = Date.now();
  for (const t of [...det.changed]) {
    const d = denied.get(t);
    if (d && now - new Date(d.at).getTime() < 60 * 1000) det.changed.delete(t);
  }
  if (!det.changed.size) return { pushed: false, tables: [], behind: det.behind, ok: !denied.size, refused: refusals() };
  const r = await walk(log, det.changed);
  await SB.update('sync_state', { id: 'shop' }, {
    last_push_at: new Date().toISOString(),
    note: 'live push: ' + [...det.changed].join(', ').slice(0, 200)
  });
  const after = detect();
  /* only what actually went up is reported as pushed */
  const tables = [...det.changed].filter((t) => !denied.has(t));
  return { pushed: tables.length > 0, tables, behind: after ? after.behind : 0,
           ok: !r.layoutFailed && !r.loyaltyFailed && !r.cashFailed && !r.refused.length, ...r };
}
