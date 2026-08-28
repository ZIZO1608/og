/* ==========================================================================
   OG SYSTEM — start-up readiness check
   --------------------------------------------------------------------------
   Run:  cd server && npm run preflight   (start-og-system.bat runs it for you)

   Four questions, asked before the server starts, because every one of them
   has already cost somebody an afternoon:

     1. Is there a database, and does it have the tables?
     2. Is there anyone who can SIGN IN?  An empty users table produces
        "Wrong username or password" for every password anyone tries — which
        reads as a broken login, not as an empty table. That is the exact
        trail this check exists to cut short.
     3. Is there anything to SELL?  A migrated but empty catalogue gives a
        till with no products and no explanation.
     4. Is Supabase wired up, and is the mirror going to run?

   NEVER blocks. It always exits 0, even when everything is wrong, because
   the shop must still be able to open and take cash while somebody sorts the
   mirror out. It reports; index.js decides nothing based on it.
   ========================================================================== */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { load, maybe, envFileExists, envFilePath } from '../lib/env.js';
import * as DB from '../lib/db.js';
import * as SB from '../lib/supabase.js';

const HERE = dirname(fileURLToPath(import.meta.url));

load();

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
const ok    = (m) => console.log(`  ${GREEN}OK${OFF}    ${m}`);
const warn  = (m) => console.log(`  ${YELLOW}NOTE${OFF}  ${m}`);
const hint  = (m) => console.log(`        ${DIM}${m}${OFF}`);

console.log('');
console.log(`${BOLD}  Checking the shop before it opens${OFF}`);
console.log('');

/* ---- 1 + 2 + 3: the local database, which is the real system ------------- */

/* Opens an EXISTING database and never migrates one. index.js owns creating
   and migrating, moments later — a check that quietly changed what it was
   checking would be worse than no check. Hence the existsSync guard rather
   than letting DB.open() bring a file into being. */
const DB_FILE = process.env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

let db = null;
try {
  if (!existsSync(DB_FILE)) throw new Error('no database file yet at ' + DB_FILE);
  db = DB.open(DB_FILE);
} catch (e) {
  warn(`The database could not be opened — ${e.message}`);
  hint('The server will try again itself and report the real error.');
}

function countOf(table) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
  catch { return null; }
}

if (db) {
  const users = countOf('users');

  if (users === null) {
    warn('The database has no tables yet — the server will create them on this run.');
    hint('Run this again afterwards to check the accounts.');
  } else if (users === 0) {
    warn('There are NO accounts, so every sign-in will say "Wrong username or password".');
    hint('Make a real account:   npm run createuser');
    hint('Or the five test ones: npm run demo-users     (password test-1234)');
  } else {
    ok(`${users} account${users === 1 ? '' : 's'} can sign in.`);

    /* Known-password accounts on a machine other people can reach is worth
       one line every single start, not a note in a file nobody reopens. */
    try {
      const demo = db.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE username IN ('hussam','lubna','maher','talal','yalla')"
      ).get().n;
      if (demo > 0) {
        warn(`${demo} of them are TEST accounts with a published password.`);
        hint('Before the shop goes live:  npm run demo-users -- --remove');
      }
    } catch { /* older database without those columns — not worth failing over */ }
  }

  const products = countOf('products');
  if (products === 0) {
    warn('The catalogue is empty, so the till will have nothing to sell.');
    hint('Load the demo catalogue:  npm run demo-catalogue');
  } else if (products > 0) {
    ok(`${products} products in the catalogue.`);
  }
}

/* ---- 4: the mirror ------------------------------------------------------- */

if (!envFileExists()) {
  warn('No server/.env, so Supabase is off. The shop runs on local SQLite.');
  hint(`Copy the template if you want the mirror: ${envFilePath()}.example`);
} else if (!SB.isConfigured()) {
  warn('server/.env exists but has no Supabase URL/key — the mirror is off.');
  hint('Fill SUPABASE_URL and the secret key, then: npm run supabase:check');
} else {
  const every = maybe('OG_SYNC_MINUTES');
  const mins = (every === null || String(every).trim() === '') ? 10 : Number(every);
  if (mins === 0) {
    ok(`Supabase configured — automatic mirroring is OFF (OG_SYNC_MINUTES=0).`);
    hint('Push by hand any time with:  npm run supabase:sync');
  } else {
    ok(`Supabase configured — the mirror runs every ${mins} min once the server is up.`);
  }
  hint('Check it properly with:  npm run supabase:check');
}

console.log('');

/* Always. See the header: this reports, it does not gate. */
process.exit(0);
