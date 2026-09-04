/* ==========================================================================
   OG SYSTEM — Supabase sync, by hand
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:sync

   One FULL run of the mirror, printed for a person. The work itself lives
   in lib/mirror.js — the same code the running server uses a couple of
   seconds after every commit (lib/sync-worker.js). This file only decides
   what to print and what to exit with:

     0   everything that could be mirrored was
     1   the run finished but a table the mirror lacks was skipped
         (the warehouse layout or the loyalty tables — see the lines above)
     2   REFUSED: this mirror belongs to another database (lib/lineage.js)

   SQLite stays the real system — this only ever READS from it and WRITES
   to Supabase, never the other way around. Safe to run repeatedly: every
   table is a cursor over change_log, so a run that dies halfway just picks
   up where it left off next time.

   OG_SYNC_TAKEOVER=1 (or --takeover) claims the mirror for this database
   when it belongs to another — a decision made by a person, once, and
   followed by npm run supabase:reconcile. claim-mirror.bat in the repo
   root does exactly that sequence.
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from 'node:process';

import { load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import * as Lineage from '../lib/lineage.js';
import * as Mirror from '../lib/mirror.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Before DB_FILE, not after: OG_DB is normally set in server/.env, and the
   same path the server, the restore and the reconcile all resolve. */
load();

const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

if (!SB.isConfigured()) {
  console.error('Supabase is not configured — run npm run supabase:check first.');
  process.exit(1);
}

DB.open(DB_FILE);

const log = Mirror.consoleLog();

/* FIRST, before a single row moves: is this mirror ours? Exit 2 — distinct
   from a failed push — so whatever ran this can tell "refused" from "broke". */
{
  const lin = await Lineage.guard({ takeover: Lineage.takeoverRequested() });
  if (!lin.ok) {
    log.head('Whose mirror is this?');
    for (const line of Lineage.refusal(lin.other)) console.log(line);
    process.exit(2);
  }
  if (lin.claimed) log.tick(`mirror claimed for this database (${lin.mine.slice(0, 8)}…)`);
  if (lin.tookOver) {
    log.warn(`mirror taken over from ${lin.tookOver.host} — run npm run supabase:reconcile ` +
             'afterwards; its bookmarks and rows are not this database\'s.');
  }
}

await Mirror.loadCursors();
const r = await Mirror.fullRun({ log });

log.head('Done');
console.log('  Check the Supabase dashboard — Table Editor — to see the rows.\n');

/* Last, and only after every bookmark is written: everything that COULD be
   mirrored has been, and the failure is reported by the exit code rather
   than by taking the run down halfway through. */
if (r.layoutFailed) {
  log.warn('  The warehouse layout is NOT in the mirror. Exit 1.\n');
  process.exit(1);
}
if (r.loyaltyFailed) {
  log.warn('  The stamp cards and the wants list are NOT in the mirror. Exit 1.\n');
  process.exit(1);
}
