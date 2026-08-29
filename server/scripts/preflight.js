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
     5. Is the PORT free? A second copy of the server cannot bind, and Node
        answers that with a twelve-line EADDRINUSE stack trace that says
        nothing about which window to close.

   It reports rather than gates: everything above exits 0 even when wrong,
   because the shop must still open and take cash while somebody sorts the
   mirror out. The port is the one exception — the server cannot start at
   all, so that exits 2 and the batch file stops with something readable.
   ========================================================================== */

import { createServer } from 'node:net';
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

function countOf(table, where) {
  try { return db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where ? ' WHERE ' + where : ''}`).get().n; }
  catch { return null; }
}

if (db) {
  /* Only an active account can sign in. Counting the rows would claim four
     people can get in when three are retired staff kept for their sales. */
  const users = countOf('users', 'active = 1');

  if (users === null) {
    warn('The database has no tables yet — the server will create them on this run.');
    hint('Run this again afterwards to check the accounts.');
  } else if (users === 0) {
    warn('There are NO accounts, so every sign-in will say "Wrong username or password".');
    hint('Make one:  npm run createuser');
  } else {
    ok(`${users} account${users === 1 ? '' : 's'} can sign in.`);

    /* The old test accounts were retired, but three of them own real sales
       and so still exist as disabled rows. An ACTIVE one means somebody
       turned it back on, and its old password is in this repository's
       history — worth a line every start, not a note nobody reopens. */
    try {
      const demo = db.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE active = 1 AND username IN ('hussam','lubna','maher','talal','yalla')"
      ).get().n;
      if (demo > 0) {
        warn(`${demo} retired TEST account${demo === 1 ? ' is' : 's are'} active again.`);
        hint('Give it a new password, or set active = 0 in Settings.');
      }
    } catch { /* older database without those columns — not worth failing over */ }
  }

  /* What the till can actually put in a basket. Hidden rows are still in
     the table — sold-out demo goods, discontinued lines — but reporting
     them as stock to sell is how you open with an empty-looking shop. */
  const products = countOf('products', 'hidden = 0');
  const hidden = countOf('products', 'hidden = 1');
  if (products === 0) {
    warn('The catalogue is empty, so the till will have nothing to sell.');
    hint('Add products in Warehouse, or pull them down:  npm run supabase:restore');
  } else if (products > 0) {
    ok(`${products} product${products === 1 ? '' : 's'} the till can sell` +
       (hidden ? `, ${hidden} hidden.` : '.'));
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

/* ---- 5: can the server even bind? --------------------------------------- */

const PORT = Number(process.env.OG_PORT || 8090);

/* 'done', not 'resolve' — resolve is already the path helper imported at the
   top of this file, and shadowing it inside here reads like a bug. */
const busy = await new Promise((done) => {
  const probe = createServer();
  probe.once('error', (e) => done(e.code === 'EADDRINUSE'));
  probe.once('listening', () => probe.close(() => done(false)));
  probe.listen(PORT);
});

if (busy) {
  console.log('');
  warn(`Port ${PORT} is already in use — the server cannot start.`);
  hint('Almost always a copy of this server still running in another window.');
  hint('Close that window, or find and stop it:');
  hint(`  netstat -ano | findstr :${PORT}`);
  hint('  taskkill /PID <the number in the last column> /F');
  console.log('');
  /* 2, not 0: this one really is fatal, and the batch file reads it. */
  process.exit(2);
}

console.log('');
process.exit(0);
