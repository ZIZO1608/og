/* ==========================================================================
   OG SYSTEM — database
   --------------------------------------------------------------------------
   SQLite, via Node's built-in `node:sqlite`. No npm package, no native
   compilation, nothing to go wrong on a fresh server: copy the folder, run
   node. That is deliberate — the frontend has no dependencies either, and a
   shop server that cannot be rebuilt from scratch in five minutes is a
   liability when it breaks on a Friday.

   SQLite rather than Postgres because at this volume — a few hundred sales a
   month — it is genuinely the better tool. Backup is copying one file. There
   is no daemon to keep running. The schema avoids SQLite-only syntax so
   Postgres is a migration rather than a rewrite if a second branch happens.
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '..', 'migrations');

let db = null;

/* Open (creating if needed) and bring the schema up to date.
   `file` may be ':memory:', which is what the tests use. */
export function open(file) {
  if (db) return db;

  if (file !== ':memory:') {
    const dir = dirname(resolve(file));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  db = new DatabaseSync(file);

  /* WAL lets readers carry on while a write is in flight. With four devices
     polling for changes while the till commits a sale, the default rollback
     journal would have them queueing behind each other. */
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  /* Off by default in SQLite, which surprises people. Without it the
     REFERENCES clauses in the schema are decoration. */
  db.exec('PRAGMA foreign_keys = ON');

  /* Wait rather than fail instantly if another connection holds the write
     lock. Five seconds is far longer than any statement here takes. */
  db.exec('PRAGMA busy_timeout = 5000');

  migrate(db);
  return db;
}

export function get() {
  if (!db) throw new Error('db.open() has not been called');
  return db;
}

export function close() {
  if (db) { db.close(); db = null; }
}

/* For the scripts that only ever READ — the mirror check, a diagnostic.
   open() applies every pending migration on the way in, which on a machine
   with an unfinished .sql sitting in server/migrations turns "is the mirror
   in step" into a schema change on the live database that nobody asked for.
   That happened. A read-only handle cannot migrate, and journal_mode is left
   alone because the mode lives in the file, not the connection. */
export function openReadOnly(file) {
  if (db) return db;
  db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/* ---------------------------------------------------------------- migrations
   Numbered .sql files applied in order, each recorded so it runs once. Kept
   deliberately dumb: no down-migrations, no checksums. A shop database that
   needs a rollback is restored from last night's backup, which is a operation
   people can actually reason about at 9pm. */
function migrate(d) {
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
            name       TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
          )`);

  const done = new Set(
    d.prepare('SELECT name FROM schema_migrations').all().map(r => r.name)
  );

  const files = readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');

    /* Each migration is one transaction: a half-applied schema change is far
       worse than a failed startup, because the next run would try to apply the
       rest on top of a shape it does not expect. */
    d.exec('BEGIN');
    try {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
       .run(f, nowIso());
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw new Error(`migration ${f} failed: ${err.message}`);
    }
  }
}

/* ------------------------------------------------------------------ helpers */

/* One clock, one format, UTC. Devices in a shop drift, and comparing an ISO
   string to a locale-formatted one silently sorts wrong rather than throwing. */
export function nowIso() {
  return new Date().toISOString();
}

/* Run `fn` inside a transaction, rolling back on any throw.
   SQLite has no nested transactions, so this refuses to nest rather than
   quietly turning an inner rollback into a no-op. */
let inTx = false;
export function tx(fn) {
  const d = get();
  if (inTx) throw new Error('tx() cannot be nested');
  inTx = true;
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch { /* already unwound */ }
    throw err;
  } finally {
    inTx = false;
  }
}

/* Record a change for the sync feed. Must be called inside the same
   transaction as the write it describes, or a client can observe the change
   log pointing at a row that is not committed yet. */
/* The fifth parameter is a NOTE, not an origin.

   It used to be `origin` — "which device produced this, so a client can skip
   echoes of its own writes" — and not one caller ever passed a device. They
   all passed human notes: "points +250: goodwill", "merged from customer 84",
   "attached to customer 12". Nothing read origin, so nothing broke; the day
   echo-skipping is implemented those notes become bogus device ids and every
   row carrying one is silently skipped. Migration 034 gave the note its own
   column and moved origin to a sixth parameter, where it stays unused until
   something actually sets it. */
export function logChange(tbl, rowId, op, userId, note = null, origin = null) {
  get().prepare(
    `INSERT INTO change_log (at, tbl, row_id, op, user_id, note, origin)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(nowIso(), tbl, String(rowId), op, userId ?? null, note ?? null, origin ?? null);
}
