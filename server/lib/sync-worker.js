/* ==========================================================================
   OG SYSTEM — the Supabase sync, on a timer
   --------------------------------------------------------------------------
   scripts/supabase-sync.js already knows how to push the shop to Supabase.
   What was missing is anything that RUNS it: the mirror only ever moved when
   somebody remembered to type `npm run supabase:sync`, which on a shop
   counter means it stops moving on the first busy day.

   This starts that script on a timer for as long as the server is up, so the
   person who opens the till in the morning does not have to know the mirror
   exists.

   TWO RULES, both about the till never suffering for the mirror:

   1. It runs as a CHILD PROCESS, not inline. The sync talks to the internet
      and walks every table; if it throws, hangs or runs out of memory, that
      happens in a process whose death cannot take a sale with it. The shop
      keeps selling on SQLite exactly as it does with no Supabase at all.

   2. It never overlaps itself. A slow run on a bad connection must not have
      a second copy started on top of it — that is how you get two writers
      racing over the same cursor rows in sync_state.

   Off by default in one case only: no Supabase configured. Then this file
   does nothing at all and says so once, which is the same thing the rest of
   the server does when server/.env is absent.

   Env:  OG_SYNC_MINUTES   how often, in minutes. Default 10. `0` turns it
                           off and leaves the manual script available.
   ========================================================================== */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { maybe } from './env.js';
import * as SB from './supabase.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', 'scripts', 'supabase-sync.js');

/* Long enough that a shop with a poor connection is not permanently syncing,
   short enough that the mirror is never far behind what the till has taken. */
const DEFAULT_MINUTES = 10;

/* The first run waits a moment rather than firing at boot. Starting the shop
   is the busiest second the machine has — the database is opening, migrations
   may be running and the first browser is asking for the whole app. The
   mirror can wait twenty seconds for its turn. */
const FIRST_RUN_MS = 20 * 1000;

let timer = null;
let running = false;
let runs = 0;

function minutes() {
  const raw = maybe('OG_SYNC_MINUTES');
  if (raw === null || raw === undefined || String(raw).trim() === '') return DEFAULT_MINUTES;
  const n = Number(raw);
  /* A typo must not silently mean "never sync again". Fall back and say so. */
  if (!Number.isFinite(n) || n < 0) {
    console.log(`    OG_SYNC_MINUTES is not a number (${raw}) — using ${DEFAULT_MINUTES}.`);
    return DEFAULT_MINUTES;
  }
  return n;
}

/* WHAT THE LAST RUNS SAID. The sync script's report used to be thrown away
   (stdio 'ignore'), so the server log said "exit 1, run supabase:check" ten
   minutes apart for a day while the actual sentence — a foreign key on
   deliveries, a column the mirror had not got — was printed to nowhere. The
   tail of that report is kept here, the one line that names the failure is
   pulled out of it, and both are given to the log line, to the Sync button's
   answer, and to the bell (lib/alerts.js). Nothing is stored: like the bell,
   this is a fact about now. */
const TAIL = 4000;
const last = { okAt: null, failedAt: null, failures: 0, code: null, why: null };

/* The report is written to be read top to bottom by a person. The line worth
   keeping is the error's own sentence if the run died, else the last '!'
   warning, else whatever it printed last. ANSI colour stripped: this goes
   into a toast. */
function reason(tail) {
  const lines = tail.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)
    .map((l) => l.trim()).filter(Boolean);
  const died = lines.find((l) => /^(\w*Error|Supabase \d{3} on)/.test(l));
  const warned = lines.slice().reverse().find((l) => l.startsWith('!'));
  return (died || warned || lines[lines.length - 1] || 'no output').slice(0, 300);
}

/* One launcher for both callers. The report is piped rather than ignored —
   only its tail is kept, and only the extracted line ever reaches the
   server's own log, so the address the till is on is still not buried under
   a ten-minute report. */
function launch(onExit) {
  running = true;
  const started = Date.now();
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: resolve(HERE, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let tail = '';
  const keep = (chunk) => { tail = (tail + chunk).slice(-TAIL); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  child.on('exit', (code) => {
    running = false;
    runs++;
    const seconds = Math.round((Date.now() - started) / 1000);
    if (code === 0) {
      last.okAt = new Date().toISOString();
      last.failures = 0; last.code = 0; last.why = null;
    } else {
      last.failedAt = new Date().toISOString();
      last.failures++; last.code = code; last.why = reason(tail);
    }
    onExit(code, seconds);
  });

  child.on('error', (err) => {
    running = false;
    last.failedAt = new Date().toISOString();
    last.failures++; last.code = null; last.why = 'could not start the sync script — ' + err.message;
    onExit(null, 0, err);
  });
}

function runOnce() {
  if (running) {
    /* Not an error worth shouting about: it means the last run is still
       going, and skipping is exactly the right response. */
    return;
  }

  launch((code, secs, err) => {
    if (err) {
      console.log(`  [sync] could not start the sync script — ${err.message}`);
    } else if (code === 0) {
      console.log(`  [sync] Supabase mirror updated (${secs}s)`);
    } else {
      /* Said plainly, WITH the reason, and then dropped. A failed mirror is
         not a failed shop, and the next run is minutes away — so this must
         never look like something the person at the counter has to act on
         right now. But it has to say what went wrong: "exit 1" on its own is
         what let a foreign key fail unread for a day. */
      console.log(`  [sync] Supabase update failed (exit ${code}): ${last.why}`);
      console.log(`         The shop is unaffected — retrying in ${minutes()} min. ` +
                  `Run "npm run supabase:check" for the full picture.`);
    }
  });
}

export function start() {
  if (timer) return;

  if (!SB.isConfigured()) {
    console.log('  Supabase: not configured — running on local SQLite only.');
    return;
  }

  const every = minutes();
  if (every === 0) {
    console.log('  Supabase: configured, automatic sync off (OG_SYNC_MINUTES=0).');
    return;
  }

  console.log(`  Supabase: mirroring every ${every} min → ${SB.projectUrl()}`);

  setTimeout(runOnce, FIRST_RUN_MS).unref();
  timer = setInterval(runOnce, every * 60 * 1000);
  /* unref so a shutdown is never held open waiting for the next tick. */
  timer.unref();
}

/* The same run, but awaitable and with a verdict — for the Sync button in
   the topbar, which has somebody standing there waiting for an answer. The
   timer path deliberately stays fire-and-forget: nobody is watching it, and
   a promise nobody awaits is just a way to lose an error. */
export function runNow() {
  return new Promise((done) => {
    if (!SB.isConfigured()) {
      return done({ ok: false, reason: 'not_configured',
        message: 'Supabase is not set up on this server.' });
    }
    if (running) {
      /* Not a failure. Somebody pressed twice, or the timer beat them to it. */
      return done({ ok: false, reason: 'busy', message: 'A sync is already running.' });
    }

    launch((code, seconds, err) => {
      if (err) return done({ ok: false, reason: 'spawn', message: last.why });
      /* The message is the sync's own last line, because the person who
         pressed the button is the one who can act on it. */
      done(code === 0
        ? { ok: true, seconds }
        : { ok: false, reason: 'failed', seconds, message: last.why });
    });
  });
}

export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function status() {
  return {
    configured: SB.isConfigured(), everyMinutes: minutes(), running, runs,
    lastOkAt: last.okAt, lastFailedAt: last.failedAt,
    failures: last.failures, lastError: last.why
  };
}
