/* ==========================================================================
   OG SYSTEM — Supabase write test
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:test-write

   supabase-check.js only reads (deliberately — a check script that writes to
   prove it can write leaves rubbish in a database somebody is about to start
   trusting). This one does the opposite on purpose: it writes, reads back
   what it wrote, and confirms the round trip actually happened.

   Touches exactly one row: sync_state WHERE id = 'shop'. That row already
   exists (seeded by 001_mirror_schema.sql) and is designed to carry a
   timestamp/note for exactly this kind of "is the shop actually reaching
   us" signal — not a table that stands in for real catalogue/sales data.
   ========================================================================== */

import { load } from '../lib/env.js';
import * as SB from '../lib/supabase.js';

load();

const tick = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const cross = (s) => `  \x1b[31m✗\x1b[0m ${s}`;
const head = (s) => `\n\x1b[1m${s}\x1b[0m`;

if (!SB.isConfigured()) {
  console.log(cross('Supabase is not configured — SUPABASE_URL / key missing from server/.env'));
  console.log('      Run  npm run supabase:check  first.\n');
  process.exit(1);
}

console.log(head('1. Writing a test row to sync_state'));

const stamp = new Date().toISOString();
const note = `write test from ${process.env.COMPUTERNAME || process.env.HOSTNAME || 'this machine'} at ${stamp}`;

let written;
try {
  written = await SB.update('sync_state', { id: 'shop' }, {
    last_push_at: stamp,
    note
  });
} catch (err) {
  console.log(cross(err.message));
  console.log(head('Result'));
  console.log(cross('Could not write. Check the schema is pushed (npm run supabase:check) and the service key has not been rotated.\n'));
  process.exit(1);
}

if (!written.length) {
  console.log(cross("Update ran but matched no row — sync_state's 'shop' row is missing."));
  console.log('      Re-run the schema push (server/supabase/001_mirror_schema.sql) — it re-seeds that row.\n');
  process.exit(1);
}

console.log(tick(`Wrote last_push_at = ${stamp}`));

console.log(head('2. Reading it back'));

const rows = await SB.select('sync_state', { eq: { id: 'shop' } });
const row = rows[0];

if (!row) {
  console.log(cross('Wrote successfully but the follow-up read found nothing — investigate manually.'));
  process.exit(1);
}

const roundTripOk = row.last_push_at && row.last_push_at.slice(0, 19) === stamp.slice(0, 19);
console.log(roundTripOk
  ? tick(`Read back last_push_at = ${row.last_push_at}`)
  : cross(`Read back last_push_at = ${row.last_push_at} — does not match what was written`));
console.log(tick(`note = "${row.note}"`));

console.log(head('Result'));
if (roundTripOk) {
  console.log('  \x1b[32mConfirmed: this server can write to Supabase and read it back.\x1b[0m');
  console.log('  Check the Supabase dashboard — Table Editor → sync_state — the row now carries this timestamp.\n');
} else {
  console.log(cross('Write happened but the readback did not match — worth a second look.\n'));
  process.exit(1);
}
