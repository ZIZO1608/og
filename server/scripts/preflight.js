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
import * as PermCheck from '../lib/permcheck.js';

const HERE = dirname(fileURLToPath(import.meta.url));

load();

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';
const ok    = (m) => console.log(`  ${GREEN}OK${OFF}    ${m}`);
const warn  = (m) => console.log(`  ${YELLOW}NOTE${OFF}  ${m}`);
const hint  = (m) => console.log(`        ${DIM}${m}${OFF}`);
/* The one condition in this file that is NOT survivable. Everything else here
   reports a shop that can still sell shoes; a guard that does not guard is a
   different kind of fact, and index.js refuses to start on it. */
const RED = '[31m';
const bad   = (m) => console.log(`  ${RED}STOP${OFF}  ${m}`);

console.log('');
console.log(`${BOLD}  Checking the shop before it opens${OFF}`);
console.log('');

/* ---- 0: the permission names ---------------------------------------------
   First, because it is the one check here that does not depend on the
   database, the network or a printer — it is a property of the source. And
   because a wrong permission name is the one fault in this file that is
   INVISIBLE at runtime: Auth.can returns false for everybody, the guard reads
   like a guard, and nothing complains. server/index.js refuses to start on it;
   this says so before the launcher gets that far. */
try {
  const { checked, dynamic } = PermCheck.assertPermissionNames();
  ok(`${checked} permission names all exist` +
     (dynamic ? ` (${dynamic} passed as a variable, not checkable here)` : ''));
} catch (e) {
  bad('A permission name does not exist — the guard using it guards nothing.');
  for (const o of (e.offences || [])) hint(`${o.file}:${o.line}  '${o.name}'`);
  hint('Fix the name, or add it to ALL_PERMISSIONS in server/lib/auth.js.');
  hint('The server will REFUSE to start until this is fixed.');
}

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

/* A busy port has two completely different meanings and this used to print
   only the alarming one.

   Nearly every time, the thing holding the port is THIS SERVER, already
   running and already serving the shop — so the shop is OPEN, and the only
   thing wrong is that somebody double-clicked the launcher twice. Printing
   "the server cannot start / Not starting" at that moment describes a
   healthy shop as a broken one, and somebody who has been told the system
   is down twice stops believing the screen the third time — the same reason
   the deploy workflow goes green when Pages is deliberately off.

   The other meaning is real: something ELSE has the port, and the server
   genuinely cannot start.

   Asking /api/health is what separates them. Our server answers it with
   {ok:true}; a stray process on the same port does not. */
async function ourServerIsAnswering() {
  try {
    const ctl = new AbortController();
    const bail = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: ctl.signal });
    clearTimeout(bail);
    if (!res.ok) return false;
    const body = await res.json();
    return body && body.ok === true;
  } catch {
    /* Unreachable, timed out, or not JSON — whatever is on that port, it is
       not this server answering normally. Treat it as the fatal case. */
    return false;
  }
}

if (busy) {
  console.log('');
  if (await ourServerIsAnswering()) {
    ok('The shop is already open — the server is running in another window.');
    hint(`Open it at:  http://localhost:${PORT}`);
    hint('Nothing is wrong, and nothing needs restarting.');
    hint('To restart it anyway, close that other window first.');
    console.log('');
    /* 3, not 2: the batch file opens the browser on this instead of
       announcing a failure. Higher than 2 because `if errorlevel N` in
       batch means "N or more", so this must be tested first. */
    process.exit(3);
  }
  warn(`Port ${PORT} is in use by something else — the server cannot start.`);
  hint('Not this server: whatever holds the port did not answer /api/health.');
  hint('Find and stop it:');
  hint(`  netstat -ano | findstr :${PORT}`);
  hint('  taskkill /PID <the number in the last column> /F');
  console.log('');
  /* 2, not 0: this one really is fatal, and the batch file reads it. */
  process.exit(2);
}

console.log('');
process.exit(0);
