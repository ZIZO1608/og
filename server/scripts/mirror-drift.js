/* ==========================================================================
   OG SYSTEM — is any column here unknown to the mirror, and is it declared?
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:drift

   READ-ONLY on both sides. Writes nothing, anywhere. The comparison lives in
   lib/drift.js — the boot pull asks it the same question before it wipes
   anything — and this file prints the answer.

   It is deliberately NOT the same job as supabase:check. That answers "is the
   mirror a faithful copy of the DATA". This answers "can the next write even
   land", which is a question about the SHAPE, and is the one that was
   answered by a day of missing sales rather than by a command.

   Exit 1 on: a stale entry in lib/mirror-lag.js, an undeclared missing
   column, a missing table, or a declared window still open. Exit 0 when the
   mirror can accept every row this machine would send it.
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';
import * as Drift from '../lib/drift.js';

const HERE = dirname(fileURLToPath(import.meta.url));
load();

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m',
      DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
const head = (m) => console.log(`\n${BOLD}${m}${OFF}`);
const tick = (m) => console.log(`  ${GREEN}✓${OFF} ${m}`);
const warn = (m) => console.log(`  ${YELLOW}!${OFF} ${m}`);
const bad  = (m) => console.log(`  ${RED}✗${OFF} ${m}`);
const dim  = (m) => console.log(`    ${DIM}${m}${OFF}`);

console.log('');
console.log(`${BOLD}  OG SYSTEM — mirror schema drift${OFF}`);

if (!SB.isConfigured()) { bad('Supabase is not configured.'); process.exit(1); }
const reach = await SB.ping();
if (!reach.ok) { bad(`Cannot reach Supabase — ${reach.message}`); process.exit(1); }
tick(`Connected to ${SB.projectUrl()}`);

/* openReadOnly, not open: DB.open() applies pending migrations, and a check
   that changes the schema it is checking is not a check. Same rule the
   Supabase check already follows and for the same reason. */
DB.openReadOnly(process.env.OG_DB || resolve(HERE, '..', 'data', 'og.db'));

const r = await Drift.check({ ahead: true });

head('Columns this machine has that the mirror has not');
for (const t of r.notLocal) dim(`${t} — not a table here, skipped`);
for (const t of r.missingTables) bad(`${t} — no such table in Supabase`);
for (const x of r.declared) {
  /* Which tools retry is not decoration. print_log is append-only and the
     sync deliberately does NOT drop `kind` — advancing the bookmark past
     rows written without it would mean nothing ever looks there again. So
     saying "the sync will push without it" here would be a plain untruth
     about the one table where being late is the correct behaviour. */
  const it = x.cols.length > 1 ? 'them' : 'it';
  warn(`${x.table} — ${x.cols.join(', ')} (declared)`);
  dim(x.retriedBy.includes('sync')
    ? `The sync pushes these rows without ${it} and names the file every run.`
    : `The sync does NOT drop ${it} here — these rows are simply not mirrored ` +
      'yet, and land in full once the file is run. Only the reconcile retries.');
  dim(`Run ${x.file} in the SQL editor to close it properly.`);
}
for (const x of r.undeclared) {
  /* The failure mode this whole script exists for. */
  bad(`${x.table} — ${x.cols.join(', ')} is NOT in lib/mirror-lag.js`);
  dim('Every write to this table is being rejected, and nothing retries.');
  dim('Add it to MIRROR_LAG and write the matching server/supabase/ file.');
}
if (!r.undeclared.length && !r.declared.length && !r.missingTables.length) {
  tick(`all ${r.checked} pushed tables match, column for column`);
}

if (r.ahead.length) {
  head('Columns the mirror has that this machine has not');
  for (const x of r.ahead) dim(`${x.table} — ${x.cols.join(', ')}`);
  dim('Harmless for the sync. The boot pull refuses on it: this program is behind the mirror — git pull.');
}

/* An entry whose columns THIS mirror already has is not a dead entry: a
   fresh Supabase project starts with none of these files run, and the
   fallback is what carries the first sync. Only an entry naming a table or a
   column that no longer exists LOCALLY is actually stale. */
head('Entries in mirror-lag.js, against this mirror');
let stale = 0;
for (const e of r.entries) {
  if (e.state === 'stale') { bad(`${e.table} — ${e.reason}. Stale.`); stale++; }
  else if (e.state === 'table_missing') dim(`${e.table} — the table itself is missing in Supabase; entry stands`);
  else if (e.state === 'satisfied') tick(`${e.table} — this mirror already has ${e.cols.join(', ')}; keep the entry for a fresh project`);
  else dim(`${e.table} — still covering a real gap`);
}
if (!stale) tick('no entry is stale — every one names columns this database really has');

head('Result');
if (stale) {
  /* Red, not a warning. A stale entry means the retry is silently dead: it
     matches on the column name appearing in PostgREST's message, so an entry
     naming a column nothing sends any more can never fire, and the next real
     rejection on that table goes uncaught. */
  bad(`${stale} entr${stale === 1 ? 'y' : 'ies'} in lib/mirror-lag.js ${stale === 1 ? 'does' : 'do'} not match this schema any more.`);
  process.exit(1);
}
if (r.undeclared.length) {
  bad(`${r.undeclared.length} table(s) are being rejected with nothing to catch them.`);
  process.exit(1);
}
if (r.missingTables.length) {
  bad(`${r.missingTables.length} table(s) do not exist in Supabase at all.`);
  dim('Run the matching file in server/supabase/ — supabase:check names which.');
  process.exit(1);
}
if (r.declared.length) {
  warn(`${r.declared.length} table(s) are mirroring one or more columns short.`);
  dim('The shop keeps working; a RESTORE from this mirror would not put those back.');
  process.exit(1);
}
tick('The mirror can accept every row this machine would send it.');
