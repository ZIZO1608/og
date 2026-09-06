/* ==========================================================================
   Back up the database — and prove the backup is readable
   --------------------------------------------------------------------------
   The work lives in lib/backup.js, which the boot pull (lib/restore.js)
   uses too; this file prints. VACUUM INTO, not a file copy — a consistent
   snapshot of a database that is actively being used — and every backup is
   then REOPENED and checked. An untested backup is not a backup, it is a
   file, and the day you find out is the day you needed it.

   Usage:
     npm run backup
     node scripts/backup.js --keep 30 --out /var/backups/og

   Restore:
     stop the server, replace data/og.db with the chosen backup file, and
     delete any leftover og.db-wal / og.db-shm beside it. Start the server.
   ========================================================================== */

import { existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';

import * as Backup from '../lib/backup.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

const OUT_DIR = resolve(flag('out', Backup.BACKUP_DIR));
const KEEP = Number(flag('keep', 30));

function main() {
  if (!existsSync(DB_FILE)) {
    console.error(`\n  No database at ${DB_FILE}\n`);
    exit(1);
  }

  const target = join(OUT_DIR, `og-${Backup.stamp()}.db`);

  console.log('');
  console.log('  OG SYSTEM — backup');
  console.log(`    from : ${DB_FILE}`);
  console.log(`    to   : ${target}`);

  Backup.snapshot(DB_FILE, target);

  const check = Backup.verify(target);
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

  const removed = Backup.prune(OUT_DIR, KEEP);
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

main();
