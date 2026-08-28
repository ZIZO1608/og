/* ==========================================================================
   OG SYSTEM — Supabase connection check
   --------------------------------------------------------------------------
   Run:  cd server && npm run supabase:check

   Answers one question — "is this wired up correctly?" — and says which part
   is wrong when it is not. Every failure below prints the thing to go and do,
   because "connection failed" on its own has never helped anybody.

   Reads credentials from server/.env. It never prints a key in full.
   ========================================================================== */

import { load, maybe, mask, envFilePath, envFileExists } from '../lib/env.js';
import * as SB from '../lib/supabase.js';

load();

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

console.log(head('Result'));
console.log(`  \x1b[32mConnected.\x1b[0m  ${found} of ${WANT.length} core tables present.`);
console.log(found === 0
  ? '  Next: push the schema, then run this again.\n'
  : '\n');
