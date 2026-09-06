/* ==========================================================================
   OG SYSTEM — restore the shop FROM Supabase
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:restore              in place
         cd server && npm run supabase:restore -- --wipe    the boot pull, by hand

   The work lives in lib/restore.js — the same code the server runs at boot
   (index.js → Restore.pullAtBoot). This file only decides what to print and
   what to exit with.

   IN PLACE (no flags, --force, --dry-run): copies the mirror into the
   database this machine already has. A table that already holds rows is
   skipped unless --force — the dangerous case is a shop that has been
   selling all morning, whose local rows are NEWER than the mirror, being
   quietly overwritten by last night's copy. `npm run backup` first is how
   you make --force reversible.

   --wipe: the whole baton sequence with every guard — verified copy, old
   database moved into backups/, fresh one restored in one transaction, the
   mirror claimed with a new id. Refuses if the server is running: the
   rename would fail, and a wipe the server was not told about is a server
   serving a database out from under itself. --force waives exactly the
   `unpushed_local` refusal (the rows stay in the moved-aside file) and the
   declared missing-column windows; --takeover / OG_SYNC_TAKEOVER=1 waives
   `busy_elsewhere`, as everywhere else.

   Exit:  0  restored / pulled / nothing to do / dry run
          1  refused or failed — the reason is printed
          2  the mirror is being worked on by another machine right now
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import * as Lineage from '../lib/lineage.js';
import * as Mirror from '../lib/mirror.js';
import * as Restore from '../lib/restore.js';

const HERE = dirname(fileURLToPath(import.meta.url));
load();

const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry-run');
const WIPE = process.argv.includes('--wipe');
const DB_FILE = process.env.OG_DB || resolve(HERE, '..', 'data', 'og.db');
const PORT = Number(process.env.OG_PORT || 8090);

const log = Mirror.consoleLog();
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const dim = (m) => console.log(`    \x1b[2m${m}\x1b[0m`);

console.log('');
console.log(`\x1b[1m  OG SYSTEM — ${WIPE ? 'wipe and pull from Supabase' : 'restore from Supabase'}\x1b[0m`);

if (!SB.isConfigured()) {
  bad('Supabase is not configured — nothing to restore from.');
  dim('Fill SUPABASE_URL and the secret key in server/.env, then: npm run supabase:check');
  process.exit(1);
}

/* Is this server answering on its port? Same probe preflight.js uses. */
async function serverIsUp() {
  try {
    const ctl = new AbortController();
    const bail = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: ctl.signal });
    clearTimeout(bail);
    if (!res.ok) return false;
    const body = await res.json();
    return !!(body && body.ok === true);
  } catch { return false; }
}

if (WIPE) {
  if (await serverIsUp()) {
    bad('The shop server is running — close its window first, then run this again.');
    process.exit(1);
  }
  DB.open(DB_FILE);
  const r = await Restore.pull({
    dbFile: DB_FILE, log, takeover: Lineage.takeoverRequested(), force: FORCE, dryRun: DRY
  });

  log.head(r.did ? 'Done' : r.reason === 'dry_run' ? 'Dry run — nothing written' : 'Not done');
  console.log('  ' + r.message);
  if (r.detail && r.detail.byTable) {
    for (const [t, n] of Object.entries(r.detail.byTable)) dim(`${t}: ${n}`);
  }
  if (r.did) {
    dim(`previous database: ${r.backup}`);
    dim('Start the shop, then:  npm run supabase:check');
  }
  console.log('');
  const fine = r.did || ['dry_run', 'own_lineage', 'mirror_empty'].includes(r.reason);
  process.exit(fine ? 0 : r.reason === 'busy_elsewhere' ? 2 : 1);
}

/* ---------------------------------------------------------------- in place */
const r = await Restore.restoreInPlace({ dbFile: DB_FILE, force: FORCE, dryRun: DRY, log });

if (r.reason === 'unreachable') { bad(`Cannot reach Supabase — ${r.message}`); process.exit(1); }
if (r.reason === 'nothing') {
  log.head('Nothing to do');
  if (!FORCE) dim('Tables that already hold rows were left alone. Re-run with --force to overwrite them.');
  dim('Take a backup first if you do:  npm run backup');
  process.exit(0);
}
if (r.reason === 'dry_run') {
  log.head('Dry run — nothing written');
  for (const p of r.plan) dim(`${p.table}: would write ${p.rows} row(s)`);
  process.exit(0);
}

log.head('Done');
console.log(`  ${r.rows} row(s) restored into the local database.`);
dim('Check who can sign in with:  npm run preflight');
console.log('');
