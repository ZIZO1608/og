/* ==========================================================================
   OG SYSTEM — Supabase connection check
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:check

   Answers one question — "is this wired up correctly?" — and says which part
   is wrong when it is not. Every failure below prints the thing to go and do,
   because "connection failed" on its own has never helped anybody.

   Reads credentials from server/.env. It never prints a key in full.
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, maybe, mask, envFilePath, envFileExists } from '../lib/env.js';
import * as SB from '../lib/supabase.js';

load();

const HERE = dirname(fileURLToPath(import.meta.url));

/* --quick answers only "is it wired up" and skips the row-by-row comparison.
   The full run is the default deliberately: the short answer is the one that
   was reassuring people while real sales sat unmirrored. */
const QUICK = process.argv.includes('--quick');

const BOLD = '\x1b[1m', DIM = '\x1b[2m', OFF = '\x1b[0m';
const tick = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const cross = (s) => `  \x1b[31m✗\x1b[0m ${s}`;
const warn = (s) => `  \x1b[33m!\x1b[0m ${s}`;
const head = (s) => `\n\x1b[1m${s}\x1b[0m`;

let failed = false;
const fail = (msg, fix) => {
  failed = true;
  console.log(cross(msg));
  if (fix) console.log(`      ${fix}`);
};

console.log(head('1. Where settings are coming from'));

/* Deliberately not a failure. A real deployment sets these as environment
   variables in Docker, systemd or a hosting dashboard and ships no .env at
   all — reporting that as "not connected" would be a lie, and one that sends
   somebody hunting for a file they were right not to create. */
const hasFile = envFileExists();
if (hasFile) {
  console.log(tick(`Reading ${envFilePath()}`));
} else {
  console.log(warn(`No .env at ${envFilePath()}`));
  console.log('      That is fine if the variables are set in the real environment.');
  console.log('      Otherwise:  cd server && cp .env.example .env');
}

console.log(head('2. Credentials'));

const url = maybe('SUPABASE_URL');
const anon = maybe('SUPABASE_ANON_KEY');
const secret = maybe('SUPABASE_SERVICE_ROLE_KEY') || maybe('SUPABASE_SECRET_KEY');

if (!url) {
  fail('SUPABASE_URL is not set',
       'Fix: Dashboard → Project Settings → API → Project URL');
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url.replace(/\/+$/, ''))) {
  console.log(warn(`SUPABASE_URL is ${url}`));
  console.log('      That does not look like https://<ref>.supabase.co — carrying on anyway.');
} else {
  console.log(tick(`SUPABASE_URL   ${url}`));
}

if (!anon) {
  console.log(warn('SUPABASE_ANON_KEY is not set (not needed yet — the browser never calls Supabase)'));
} else {
  console.log(tick(`anon key       ${mask(anon)}`));
}

if (!secret) {
  fail('SUPABASE_SERVICE_ROLE_KEY is not set',
       'Fix: Dashboard → Project Settings → API Keys → the secret / service_role key');
} else {
  console.log(tick(`service key    ${mask(secret)}`));

  /* The two keys are easy to mix up — they sit next to each other on the same
     page and look alike. Pasting the public one here fails later with a
     confusing permission error instead of an obvious wrong-key error. */
  if (anon && secret === anon) {
    fail('The service key and the anon key are identical',
         'Fix: these are two different keys. Copy the one marked secret / service_role.');
  }
}

if (failed) {
  console.log(head('Result'));
  console.log(cross('Not connected yet — fix the above and run this again.\n'));
  process.exit(1);
}

console.log(head('3. Reaching the project'));

const res = await SB.ping();

if (!res.ok) {
  if (res.reason === 'bad_key') {
    fail(res.message,
         'Fix: the URL is reachable but the key was rejected. Re-copy the secret key.');
  } else if (res.reason === 'unreachable') {
    fail(res.message,
         'Fix: check the project URL, that the project is not paused, and this machine is online.');
  } else {
    fail(res.message, 'Fix: check the project is running in the Supabase dashboard.');
  }
  console.log(head('Result'));
  console.log(cross('Not connected.\n'));
  process.exit(1);
}

console.log(tick(`Project answered at ${res.url}`));
console.log(tick('The secret key was accepted'));

console.log(head('4. Schema'));

/* The check is deliberately read-only. A script that writes to prove it can
   write is a script that leaves rubbish in a database somebody is about to
   start trusting. */
let found = 0;
const WANT = ['products', 'variants', 'sales', 'customers', 'stock'];
const missing = [];

for (const t of WANT) {
  try {
    const n = await SB.count(t);
    console.log(tick(`${t.padEnd(12)} ${n === null ? 'present' : `${n} rows`}`));
    found++;
  } catch (err) {
    if (/relation|does not exist|PGRST205|404/i.test(err.message)) missing.push(t);
    else console.log(warn(`${t.padEnd(12)} ${err.message}`));
  }
}

if (missing.length) {
  console.log(warn(`Not created yet: ${missing.join(', ')}`));
  console.log('      This is expected on a brand-new project — the schema has not been');
  console.log('      pushed. That is the next step, not an error.');
}

/* ==========================================================================
   Everything above answers "is it wired up". That is NOT the same question as
   "is the shop actually in the mirror", and answering only the first is how a
   real gap hid for weeks: this script printed "Connected. 5 of 5 core tables
   present" every time while five invoices and every delivery were missing.
   Both counts were true. Neither was the thing anyone wanted to know.

   So the rest compares the two databases row for row, and reports the
   difference rather than the connection. Read-only throughout.
   ========================================================================== */

if (QUICK || found === 0) {
  console.log(head('Result'));
  console.log(`  \x1b[32mConnected.\x1b[0m  ${found} of ${WANT.length} core tables present.`);
  console.log(found === 0
    ? '  Next: push the schema, then run this again.\n'
    : `  ${DIM}Wiring only — run without --quick to compare the shop against the mirror.${OFF}\n`);
  process.exit(0);
}

const DB = await import('../lib/db.js');
const Vault = await import('../lib/credvault.js');
DB.open(maybe('OG_DB') || resolve(HERE, '..', 'data', 'og.db'));
const db = DB.get();

/* Deliberately never mirrored — live session tokens, a local print queue and a
   counter have no business in a copy kept for the day this machine dies. */
const LOCAL_ONLY = new Set(['sessions', 'login_attempts', 'applied_ops',
                            'label_print_jobs', 'label_code_seq',
                            'schema_migrations', 'change_log']);

const tables = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
).all().map((r) => r.name);

console.log(head('5. Is the shop actually in the mirror?'));

const behind = [];      /* rows here that are not there — the dangerous case */
const ahead = [];       /* rows there that are not here */
const absent = [];      /* table missing remotely */
let matched = 0;

for (const t of tables) {
  if (LOCAL_ONLY.has(t)) continue;
  const here = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;

  let there;
  try { there = await SB.count(t); }
  catch { absent.push(t); continue; }

  if (there === here) { matched++; continue; }
  (here > there ? behind : ahead).push({ t, here, there });
}

console.log(tick(`${matched} table(s) match exactly`));

if (absent.length) {
  console.log(cross(`${absent.length} table(s) do not exist in Supabase: ${absent.join(', ')}`));
  console.log('      Fix: run the matching file in server/supabase/ in the SQL editor.');
  failed = true;
}

/* A shop AHEAD of its mirror is the one that matters. It means a sale, a
   delivery or a stock move is on this machine only, and a dead drive loses it.
   Never soften this into a warning. */
for (const { t, here, there } of behind) {
  console.log(cross(`${t.padEnd(18)} ${here} here, ${there} in Supabase — ${here - there} NOT mirrored`));
  failed = true;
}
for (const { t, here, there } of ahead) {
  console.log(warn(`${t.padEnd(18)} ${here} here, ${there} in Supabase — ${there - here} extra there`));
}

if (behind.length) {
  console.log(`\n      Fix: ${BOLD}npm run supabase:reconcile${OFF} — it pushes what is missing.`);
  console.log(`      ${DIM}The ordinary sync cannot: its cursor is already past those rows.${OFF}`);
}
if (ahead.length && !behind.length) {
  console.log(`\n      ${DIM}Extra rows there are usually rows deleted here. Check them, then${OFF}`);
  console.log(`      ${DIM}npm run supabase:reconcile removes the ones the shop no longer has.${OFF}`);
}

console.log(head('6. Sync bookmarks'));

/* A cursor ahead of its OWN table's last log entry can never move again — the
   next run asks for changes after a number nothing will ever reach, finds
   none, and reports "nothing new" for good. Compared against the whole log's
   maximum this is invisible, because a busy table hides a quiet one. */
let cursors = [];
try { cursors = await SB.select('sync_state', {}); }
catch { console.log(warn('sync_state is missing — the sync has never run against this project.')); }

let stuck = 0, live = 0;
for (const c of cursors) {
  const m = String(c.id).match(/^sync:([a-z_]+)(:maxid)?$/);
  if (!m) continue;
  const [, tbl, byId] = m;
  let top;
  try {
    top = byId
      ? db.prepare(`SELECT MAX(id) AS m FROM "${tbl}"`).get().m
      : db.prepare('SELECT MAX(seq) AS m FROM change_log WHERE tbl = ?').get(tbl).m;
  } catch { continue; }
  live++;
  if (top !== null && c.last_seq > top) {
    stuck++;
    console.log(cross(`${c.id.padEnd(30)} at ${c.last_seq}, but ${tbl} only reaches ${top}`));
    failed = true;
  }
}

if (stuck) {
  console.log('      These are stranded: every run will say "nothing new" forever.');
  console.log(`      Fix: they rewind automatically on the next ${BOLD}npm run supabase:sync${OFF}.`);
} else if (live) {
  console.log(tick(`${live} bookmark(s) healthy — none ahead of its own table`));
}

console.log(head('7. Account recovery'));

if (!Vault.isEnabled()) {
  console.log(warn('OG_VAULT_KEY is not set — passwords are NOT mirrored.'));
  console.log('      A restore would rebuild this shop with no way to sign in.');
  console.log('      Fix: set OG_VAULT_KEY in server/.env, then run npm run supabase:sync.');
} else {
  let sealed = 0, total = 0;
  try {
    const remote = await SB.select('users', { select: 'id,pw_enc' });
    total = remote.length;
    sealed = remote.filter((r) => r.pw_enc).length;
    if (sealed < total) {
      console.log(warn(`${sealed} of ${total} mirrored accounts carry a sealed password.`));
      console.log('      Run npm run supabase:sync to seal the rest.');
    } else {
      console.log(tick(`all ${total} mirrored account(s) carry a sealed password`));
    }
  } catch {
    console.log(warn('users.pw_enc is missing — run server/supabase/002_user_credentials.sql.'));
  }
  console.log(`      ${DIM}Keep a copy of OG_VAULT_KEY somewhere that is not this machine.${OFF}`);
  console.log(`      ${DIM}Without it the sealed boxes never open again.${OFF}`);
}

console.log(head('Result'));
if (failed) {
  console.log(cross('The mirror is NOT a faithful copy of the shop. Fix the red lines above.\n'));
  process.exit(1);
}
console.log(`  \x1b[32mConnected, and the mirror matches the shop.\x1b[0m`);
console.log(`  ${DIM}${matched} table(s) compared${ahead.length ? `, ${ahead.length} with extra rows there` : ''}.${OFF}\n`);
