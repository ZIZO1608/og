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

function runOnce() {
  if (running) {
    /* Not an error worth shouting about: it means the last run is still
       going, and skipping is exactly the right response. */
    return;
  }
  running = true;
  const started = Date.now();

  /* stdio ignored on purpose. The sync script prints a readable report meant
     for someone who ran it by hand; interleaving that into the server's log
     every ten minutes would bury the lines that matter — the address the
     till is on, and the warnings about test accounts. */
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: resolve(HERE, '..'),
    stdio: 'ignore',
    windowsHide: true
  });

  child.on('exit', (code) => {
    running = false;
    runs++;
    const secs = Math.round((Date.now() - started) / 1000);
    if (code === 0) {
      console.log(`  [sync] Supabase mirror updated (${secs}s)`);
    } else {
      /* Said plainly and then dropped. A failed mirror is not a failed shop,
         and the next run is minutes away — so this must never look like
         something the person at the counter has to act on right now. */
      console.log(`  [sync] Supabase update failed (exit ${code}) — the shop is unaffected, ` +
                  `retrying in ${minutes()} min. Run "npm run supabase:check" to see why.`);
    }
  });

  child.on('error', (err) => {
    running = false;
    console.log(`  [sync] could not start the sync script — ${err.message}`);
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

    running = true;
    const started = Date.now();
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: resolve(HERE, '..'), stdio: 'ignore', windowsHide: true
    });

    child.on('exit', (code) => {
      running = false;
      runs++;
      const seconds = Math.round((Date.now() - started) / 1000);
      done(code === 0
        ? { ok: true, seconds }
        : { ok: false, reason: 'failed', seconds,
            message: 'The sync script exited with code ' + code + '.' });
    });

    child.on('error', (err) => {
      running = false;
      done({ ok: false, reason: 'spawn', message: err.message });
    });
  });
}

export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function status() {
  return { configured: SB.isConfigured(), everyMinutes: minutes(), running, runs };
}
