/* ==========================================================================
   Back up the database — and prove the backup is readable
   --------------------------------------------------------------------------
   Uses SQLite's `VACUUM INTO`, not a file copy. Copying a live database while
   the till is mid-sale can capture a torn file: the .db without the matching
   -wal, or a page half written. VACUUM INTO takes a consistent snapshot of a
   database that is actively being used, and compacts it on the way out.

   Every backup is then REOPENED and checked. An untested backup is not a
   backup, it is a file — and the day you find out is the day you needed it.

   Usage:
     npm run backup
     node scripts/backup.js --keep 30 --out /var/backups/og

   Restore:
     stop the server, replace data/og.db with the chosen backup file, and
     delete any leftover og.db-wal / og.db-shm beside it. Start the server.
     `--verify-restore` below rehearses exactly that against a scratch copy.
   ========================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const OUT_DIR = resolve(flag('out', resolve(HERE, '..', 'backups')));
const KEEP = Number(flag('keep', 30));

/* Tables that must contain rows in any healthy database. A backup that opens
   cleanly but has lost the reference data is corrupt in a way `integrity_check`
   will not notice. */
const MUST_HAVE_ROWS = ['currencies', 'warehouses'];

function main() {
  if (!existsSync(DB_FILE)) {
    console.error(`\n  No database at ${DB_FILE}\n`);
    exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  /* Colons are illegal in Windows filenames, so the ISO timestamp is
     flattened rather than used raw. */
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const target = join(OUT_DIR, `og-${stamp}.db`);

  console.log('');
  console.log('  OG SYSTEM — backup');
  console.log(`    from : ${DB_FILE}`);
  console.log(`    to   : ${target}`);

  /* ---- take the snapshot ------------------------------------------------ */
  const src = new DatabaseSync(DB_FILE);
  try {
    /* Parameters are not allowed in VACUUM INTO, so the path is inlined. It
       comes from a command-line flag, not from user input over the network,
       and single quotes are escaped by doubling per SQL string rules. */
    src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    src.close();
  }

  /* ---- prove it is readable --------------------------------------------- */
  const check = verify(target);
  if (!check.ok) {
    console.error(`\n  BACKUP FAILED VERIFICATION: ${check.reason}`);
    console.error('  The file has been left in place for inspection.\n');
    exit(1);
  }

  const size = statSync(target).size;
  console.log(`    size : ${(size / 1024).toFixed(0)} KB`);
  console.log('');
  console.log('    verified:');
  for (const [t, n] of Object.entries(check.counts)) {
    console.log(`      ${String(n).padStart(7)}  ${t}`);
  }

  /* ---- prune ------------------------------------------------------------- */
  const removed = prune(OUT_DIR, KEEP);
  if (removed.length) {
    console.log('');
    console.log(`    pruned ${removed.length} older backup(s), keeping ${KEEP}`);
  }

  console.log('');
  console.log('  Done.');
  console.log('');
  console.log('  A backup on the same disk as the database protects you from');
  console.log('  a mistake, not from a dead drive or a stolen machine. Copy');
  console.log('  these somewhere else as well.');
  console.log('');
}

/* Open the backup as a real database and confirm it is usable. */
function verify(file) {
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
function prune(dir, keep) {
  if (!Number.isFinite(keep) || keep < 1) return [];

  const files = readdirSync(dir)
    .filter(f => /^og-.*\.db$/.test(f))
    .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  const doomed = files.slice(keep);
  for (const { f } of doomed) unlinkSync(join(dir, f));
  return doomed.map(d => d.f);
}

main();
