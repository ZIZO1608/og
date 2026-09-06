/* ==========================================================================
   OG SYSTEM — backups, as a library                              [backup.js]
   --------------------------------------------------------------------------
   scripts/backup.js used to hold all of this and could only run as its own
   process. The boot pull (lib/restore.js) needs the same things from inside
   the server — a consistent snapshot, proof that it opens, the pruning — and
   one more the script never had: moving the live database aside so a fresh
   one can be built in its place, and putting it back when that goes wrong.

   VACUUM INTO, not a file copy. Copying a live database while the till is
   mid-sale can capture a torn file: the .db without the matching -wal, or a
   page half written. VACUUM INTO takes a consistent snapshot of a database
   that is actively being used, and compacts it on the way out.

   Every backup is then REOPENED and checked. An untested backup is not a
   backup, it is a file — and the day you find out is the day you needed it.
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as DB from './db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = resolve(HERE, '..', 'backups');

/* Tables that must contain rows in any healthy database. A backup that opens
   cleanly but has lost the reference data is corrupt in a way `integrity_check`
   will not notice. */
const MUST_HAVE_ROWS = ['currencies', 'warehouses'];

/* Colons are illegal in Windows filenames, so the ISO timestamp is flattened
   rather than used raw. */
export function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
}

/* A consistent snapshot of `dbFile` written to `target`. Opens its own
   connection, so it works whether or not lib/db.js has the file open. */
export function snapshot(dbFile, target) {
  mkdirSync(dirname(target), { recursive: true });
  const src = new DatabaseSync(dbFile);
  try {
    /* Parameters are not allowed in VACUUM INTO, so the path is inlined. It
       comes from this code or a command-line flag, never from user input over
       the network, and single quotes are escaped by doubling per SQL rules. */
    src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }
  return target;
}

/* Open the backup as a real database and confirm it is usable. */
export function verify(file) {
  let db;
  try {
    db = new DatabaseSync(file);
  } catch (e) {
    return { ok: false, reason: `cannot open: ${e.message}` };
  }

  try {
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const verdict = integrity && (integrity.integrity_check ?? Object.values(integrity)[0]);
    if (verdict !== 'ok') return { ok: false, reason: `integrity_check said "${verdict}"` };

    const fk = db.prepare('PRAGMA foreign_key_check').all();
    if (fk.length) return { ok: false, reason: `${fk.length} broken foreign key(s)` };

    const counts = {};
    const tables = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all().map(r => r.name);

    for (const t of tables) {
      counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    }

    for (const t of MUST_HAVE_ROWS) {
      if (!counts[t]) return { ok: false, reason: `${t} is empty` };
    }

    return { ok: true, counts };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    db.close();
  }
}

/* Keep the newest `keep` backups, delete the rest. */
export function prune(dir, keep) {
  if (!Number.isFinite(keep) || keep < 1) return [];
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter(f => /^og-.*\.db$/.test(f))
    .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  const doomed = files.slice(keep);
  for (const { f } of doomed) unlinkSync(join(dir, f));
  return doomed.map(d => d.f);
}

/* --------------------------------------------------------- moving aside
   For the boot pull. The live database is moved out of the way so a fresh
   one can be built where it stood; if that fails, it is moved back. */

/* The two files SQLite may leave beside a WAL-mode database. */
const SIDECARS = ['-wal', '-shm'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* rename with a retry. This repository lives under OneDrive, and behind an
   antivirus, and both hold a handle on a file for a moment after it was
   closed — the rename then lands on EPERM or EBUSY and works a second later.
   Five tries over a second and a bit is plenty; a rename still refused after
   that is refused for a reason. */
async function renameRetry(from, to) {
  let last = null;
  for (let i = 0; i < 5; i++) {
    try { renameSync(from, to); return; }
    catch (e) {
      last = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await sleep(250);
    }
  }
  throw last;
}

/* Move the live database to `target`. Returns { ok, reason } and never
   throws: on any failure whatever was renamed is put back and the database
   is reopened, so the caller is left exactly where it started.

   The order matters.
     1. checkpoint — folds the WAL into the main file, so what is moved is
        one self-contained file rather than a .db that is complete only when
        read together with the -wal beside it;
     2. close — SQLite deletes -wal and -shm on the last connection's close.
        Anything still there afterwards belongs to another handle and is
        moved WITH the file, under the same new name, so the pair stays
        consistent — a stale -wal left beside the NEW og.db is the one
        outcome worse than no backup;
     3. rename, then verify the moved copy the way a backup is verified. A
        file that moved but will not open is nothing to build on top of. */
export async function moveAside(dbFile, target) {
  const moved = [];
  try {
    try { DB.get().exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* not open, or not WAL */ }
    DB.close();
    mkdirSync(dirname(target), { recursive: true });

    await renameRetry(dbFile, target);
    moved.push([dbFile, target]);
    for (const s of SIDECARS) {
      if (!existsSync(dbFile + s)) continue;
      await renameRetry(dbFile + s, target + s);
      moved.push([dbFile + s, target + s]);
    }

    const check = verify(target);
    if (!check.ok) throw new Error(`the moved copy failed verification — ${check.reason}`);
    return { ok: true, target, counts: check.counts };
  } catch (e) {
    for (const [from, to] of moved.reverse()) {
      try { renameSync(to, from); } catch { /* best effort; the reopen below says if it mattered */ }
    }
    try { DB.open(dbFile); } catch { /* the caller's last-resort reopen handles it */ }
    return { ok: false, reason: e.message };
  }
}

/* The reverse: throw away whatever is at dbFile now and put the moved-aside
   copy back. Used when the restore that was meant to replace it failed. */
export async function moveBack(target, dbFile) {
  DB.close();
  for (const f of [dbFile, ...SIDECARS.map((s) => dbFile + s)]) {
    if (existsSync(f)) unlinkSync(f);
  }
  await renameRetry(target, dbFile);
  for (const s of SIDECARS) {
    if (existsSync(target + s)) await renameRetry(target + s, dbFile + s);
  }
  DB.open(dbFile);
}
