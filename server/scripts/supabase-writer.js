#!/usr/bin/env node
/* ==========================================================================
   OG SYSTEM — which MACHINE writes to the cloud copy      [supabase-writer.js]
   --------------------------------------------------------------------------
   npm run supabase:writer                       say who the writer is (reads only)
   npm run supabase:writer -- --claim            record THIS machine as the writer
   npm run supabase:writer -- --claim --replace  take it over from another machine

   See lib/lineage.js, THE WRITER. Run --claim ONCE, on the shop's own server
   (the VPS: docker exec -w /app/server og-shop node scripts/supabase-writer.js
   --claim). It refuses unless this database owns the mirror, and refuses to
   take over from another recorded writer without --replace — that is a
   person deciding the shop has moved. It writes one file into the data
   folder (mirror-writer.id) and one sync_state row (`writer`); nothing else.

   Exit: 0 ok · 1 could not reach Supabase / not configured · 2 refused.
   ========================================================================== */

import { hostname } from 'node:os';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import * as Lineage from '../lib/lineage.js';
import { load, dbFile } from '../lib/env.js';

load();

const argv = process.argv.slice(2);
const CLAIM = argv.includes('--claim');
const REPLACE = argv.includes('--replace');

function when(s) { return s ? String(s).slice(0, 16).replace('T', ' ') + ' UTC' : '?'; }

if (!SB.isConfigured()) {
  console.log('Supabase is not configured in server/.env — there is no cloud copy to write to.');
  process.exit(1);
}

/* Read-only open for the status; the claim writes nothing to og.db either. */
DB.openReadOnly(dbFile());
let code = 0;
try {
  const lin = await Lineage.guard({ readOnly: true, skipWriter: true });
  const writer = await Lineage.remoteWriter();
  const mine = Lineage.localWriter();
  console.log('');
  console.log(`  this machine      : ${hostname()}`);
  console.log(`  writer file       : ${Lineage.writerFile()} ${mine ? `(${mine.slice(0, 8)}…)` : '(none)'}`);
  console.log(`  database lineage  : ${lin.ok && !lin.unclaimed ? 'owns the cloud copy ✓' : lin.other ? `NOT the owner (owner: ${lin.other.host})` : 'the cloud copy has no owner yet'}`);
  console.log(`  recorded writer   : ${writer ? `${writer.host} (${writer.id.slice(0, 8)}…) since ${when(writer.since)}${writer.id === mine ? '  ← this machine' : ''}` : 'none yet — any copy of the shop database with the keys could push'}`);
  console.log('');

  if (CLAIM) {
    const r = await Lineage.claimWriter({ replace: REPLACE });
    if (r.ok && r.already) console.log('  This machine is already the writer. Nothing changed.');
    else if (r.ok) console.log(`  Recorded: ${r.writer.host} (${r.writer.id.slice(0, 8)}…) is the writer${r.replaced ? ', taken over from the previous one' : ''}.`);
    else if (r.code === 'not_owner') {
      console.log("  Refused: this database does not own the cloud copy, so this machine cannot be its writer.");
      code = 2;
    } else if (r.code === 'writer_elsewhere') {
      console.log(`  Refused: ${r.writer.host} (${r.writer.id.slice(0, 8)}…) is already the writer.`);
      console.log('  Only if the shop has really moved to THIS machine:  npm run supabase:writer -- --claim --replace');
      code = 2;
    }
    console.log('');
  } else if (!writer) {
    console.log('  To record the writer, on the shop\'s server only:  npm run supabase:writer -- --claim');
    console.log('');
  }
} catch (e) {
  console.log(`  Could not ask the cloud copy — ${e.message}`);
  code = 1;
}
DB.close();
process.exit(code);
