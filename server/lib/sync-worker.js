/* ==========================================================================
   OG SYSTEM — the Supabase mirror, live                      [sync-worker.js]
   --------------------------------------------------------------------------
   Keeps the mirror a few seconds behind the till, for as long as the server
   is up, so the person who opens the shop in the morning does not have to
   know the mirror exists.

   It used to spawn scripts/supabase-sync.js every ten minutes. That run
   made some sixty HTTPS round-trips and re-pushed 250 settings rows whether
   anything had changed or not, so ten minutes was as often as it could
   afford — and ten minutes of sales is what a dead disk lost. The work now
   lives in lib/mirror.js, which can ask SQLite locally what has moved and
   push only that, so it can afford to run the moment something is written.

   THREE TRIGGERS, ONE LANE.

     1. The commit hook. db.js calls us at the end of every transaction
        that logged a change; two seconds later (debounced, so a stock
        count of forty lines is one push, not forty) the fast lane runs.
     2. A ten-second tick. The backstop for writes that skip the hook —
        a setting saved outside a transaction, a table nothing logs — and
        it costs nothing: the check is a few local queries, and when
        nothing moved there is no request at all.
     3. A FULL run every hour (OG_SYNC_MINUTES, default 60): the settings
        tables rewritten whole, every cursor walked, every guard exercised.
        The safety net that heals what the fast lane could not see.

   THE TILL NEVER SUFFERS FOR THE MIRROR. Nothing that serves a request ever
   awaits this. Every push is inside a try/catch; every request has a
   thirty-second deadline (lib/supabase.js); the walk yields to the event
   loop between tables. A failure is remembered, said once in the log with
   its reason, shown in Settings and in the bell — and retried with a
   growing pause (10 s, 20, 40 … five minutes) so a shop with no internet
   is not asking DNS every ten seconds all afternoon.

   IT NEVER OVERLAPS ITSELF. One push at a time; a trigger that arrives
   mid-push marks `pending` and runs once more when it ends. Two writers
   over the same cursor rows is exactly the race the lineage guard exists
   to refuse between machines, and it is not allowed inside one either.

   Off in one case only: no Supabase configured (or OG_SYNC_MINUTES=0, which
   means "by hand only", as it always has). Then this file does nothing at
   all and says so once.
   ========================================================================== */

import { maybe } from './env.js';
import * as DB from './db.js';
import * as SB from './supabase.js';
import * as Live from './live.js';
import * as Lineage from './lineage.js';
import * as Mirror from './mirror.js';

const DEFAULT_FULL_MINUTES = 60;
const FIRST_RUN_MS = 20 * 1000;      /* boot is the busiest second the machine has */
const DEBOUNCE_MS = 2 * 1000;
const TICK_MS = 10 * 1000;
const RECHECK_LINEAGE_MS = 10 * 60 * 1000;
const BACKOFF_MIN_MS = 10 * 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

const state = {
  mode: 'off',            /* off | starting | live | offline | refused */
  busy: false,
  pending: false,
  runs: 0,
  lastPushAt: null,       /* last time rows actually moved */
  lastOkAt: null,         /* last push that ended without error, moved or not */
  lastFailedAt: null,
  failures: 0,
  lastError: null,
  backoffMs: BACKOFF_MIN_MS,
  pauseMs: 0,
  nextRetryAt: null,
  lastFullAt: null,
  lastFullOk: null,
  refusedBy: null
};

let debounce = null;
let tick = null;
let fullTimer = null;
let lineageTimer = null;
let unhook = null;

function fullMinutes() {
  const raw = maybe('OG_SYNC_MINUTES');
  if (raw === null || raw === undefined || String(raw).trim() === '') return DEFAULT_FULL_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.log(`    OG_SYNC_MINUTES is not a number (${raw}) — using ${DEFAULT_FULL_MINUTES}.`);
    return DEFAULT_FULL_MINUTES;
  }
  return n;
}

/* The one line worth keeping out of a failed run: the error's own sentence. */
function reason(err) {
  return String((err && err.message) || err || 'unknown error').replace(/\s+/g, ' ').slice(0, 300);
}

const isOffline = (msg) => /^Cannot reach Supabase/.test(String(msg));

/* Take the current pause, and double the next one. The countdown the status
   shows and the timer that actually fires read the same number. */
function pause() {
  state.pauseMs = state.backoffMs;
  state.nextRetryAt = new Date(Date.now() + state.pauseMs).toISOString();
  state.backoffMs = Math.min(state.backoffMs * 2, BACKOFF_MAX_MS);
}

/* ------------------------------------------------------------- the lane */

function tell() {
  /* The payload carries no shop data — mode, counts and timestamps only —
     and the manager's Settings fold repaints from it without a poll. */
  Live.notify('og', { mirror: status() });
}

async function run(kind) {
  if (state.busy) { state.pending = true; return null; }
  if (state.mode === 'off' || state.mode === 'refused' || state.mode === 'starting') return null;
  state.busy = true;
  const started = Date.now();
  const log = Mirror.tailLog();
  let out = null;
  try {
    out = kind === 'full'
      ? await Mirror.fullRun({ log })
      : await Mirror.pushChanged({ log });
    /* A tick that found nothing is not a run anybody needs counted. */
    if (kind === 'full' || out.pushed) state.runs++;
    state.lastOkAt = new Date().toISOString();
    state.failures = 0;
    state.lastError = null;
    state.backoffMs = BACKOFF_MIN_MS;
    state.nextRetryAt = null;
    state.mode = 'live';
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (kind === 'full') {
      state.lastFullAt = state.lastOkAt;
      state.lastPushAt = state.lastOkAt;
      state.lastFullOk = out.ok;
      console.log(`  [mirror] full run ${out.ok ? 'completed' : 'finished with a table skipped'} (${secs}s)`);
      if (!out.ok) console.log('           ' + lastWarning(log.text()));
    } else if (out.pushed) {
      state.lastPushAt = state.lastOkAt;
      console.log(`  [mirror] pushed ${out.tables.join(', ')} (${secs}s)`);
    }
    tell();
  } catch (err) {
    state.lastFailedAt = new Date().toISOString();
    state.failures++;
    state.lastError = reason(err);
    state.mode = isOffline(state.lastError) ? 'offline' : 'live';
    pause();
    const wait = Math.round(state.pauseMs / 1000);
    /* Said plainly, WITH the reason, and then dropped: a failed mirror is
       not a failed shop. But it has to say what went wrong — "exit 1" on
       its own is what let a foreign key fail unread for a day. */
    console.log(`  [mirror] ${kind === 'full' ? 'full run' : 'push'} failed: ${state.lastError}`);
    console.log(`           The shop is unaffected — retrying in ${wait} s. ` +
                'Run "npm run supabase:check" for the full picture.');
    tell();
  } finally {
    state.busy = false;
    if (state.pending) { state.pending = false; schedule(0); }
  }
  return out;
}

function lastWarning(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice().reverse().find((l) => l.startsWith('!')) || lines[lines.length - 1] || '';
}

/* One debounce timer. A trigger while a retry pause is running waits for
   the pause rather than cutting it short — the pause is the point. */
function schedule(ms = DEBOUNCE_MS) {
  if (state.mode === 'off' || state.mode === 'refused' || state.mode === 'starting') return;
  let delay = ms;
  if (state.nextRetryAt) {
    const until = new Date(state.nextRetryAt).getTime() - Date.now();
    if (until > delay) delay = until;
  }
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { debounce = null; run('fast'); }, delay);
  debounce.unref();
}

/* Is this mirror ours? Refused is a mode, not an error: nothing is pushed,
   the reason is on the Settings fold, and it is asked again every ten
   minutes in case the other machine has stopped or somebody ran
   claim-mirror.bat. */
async function checkLineage() {
  try {
    const lin = await Lineage.guard({ takeover: false });
    if (!lin.ok) {
      state.mode = 'refused';
      state.refusedBy = lin.other ? `${lin.other.host} (${String(lin.other.id).slice(0, 8)}…)` : null;
      state.lastError = lin.other
        ? `the mirror belongs to ${state.refusedBy} — run claim-mirror.bat if THIS machine is the shop`
        : 'nobody has claimed this mirror yet — run claim-mirror.bat if THIS machine is the shop';
      console.log(`  [mirror] refused: ${state.lastError}`);
      tell();
      return false;
    }
    state.refusedBy = null;
    if (lin.claimed) console.log('  [mirror] claimed the mirror for this database');
    return true;
  } catch (err) {
    /* Could not even ask. Offline, and the ordinary backoff handles it. */
    state.mode = 'offline';
    state.lastError = reason(err);
    state.lastFailedAt = new Date().toISOString();
    state.failures++;
    pause();
    console.log(`  [mirror] cannot reach Supabase yet: ${state.lastError} — retrying in ${Math.round(state.pauseMs / 1000)} s`);
    tell();
    return false;
  }
}

async function boot() {
  const ok = await checkLineage();
  if (!ok) {
    if (state.mode === 'refused') return;   /* the lineage timer asks again */
    setTimeout(boot, state.pauseMs || BACKOFF_MIN_MS).unref();
    return;
  }
  try {
    await Mirror.loadCursors();
  } catch (err) {
    state.mode = 'offline';
    state.lastError = reason(err);
    state.lastFailedAt = new Date().toISOString();
    state.failures++;
    pause();
    console.log(`  [mirror] could not read the bookmarks: ${state.lastError} — retrying in ${Math.round(state.pauseMs / 1000)} s`);
    tell();
    setTimeout(boot, state.pauseMs).unref();
    return;
  }
  state.mode = 'live';
  arm();
  /* The first thing after boot is a FULL run: it heals whatever the last
     server left behind and seeds the settings hashes the fast lane compares
     against. */
  await run('full');
}

function arm() {
  if (unhook) return;
  unhook = DB.onCommit(() => schedule(DEBOUNCE_MS));
  tick = setInterval(() => schedule(0), TICK_MS);
  tick.unref();
  const every = fullMinutes();
  fullTimer = setInterval(() => run('full'), every * 60 * 1000);
  fullTimer.unref();
}

export function start() {
  if (state.mode !== 'off' || lineageTimer) return;

  if (!SB.isConfigured()) {
    console.log('  Supabase: not configured — running on local SQLite only.');
    return;
  }
  if (fullMinutes() === 0) {
    console.log('  Supabase: configured, automatic sync off (OG_SYNC_MINUTES=0).');
    return;
  }

  console.log(`  Supabase: live mirror → ${SB.projectUrl()}` +
              ` (every change within seconds; full run every ${fullMinutes()} min)`);
  state.mode = 'starting';
  setTimeout(boot, FIRST_RUN_MS).unref();

  lineageTimer = setInterval(async () => {
    if (state.mode !== 'refused') return;
    state.mode = 'starting';
    await boot();
  }, RECHECK_LINEAGE_MS);
  lineageTimer.unref();
}

/* The Sync button in the topbar: somebody is standing there waiting for an
   answer, so this awaits the push and returns the verdict. The fast lane,
   not a full run — "get it up NOW" is what the button means, and a full
   run is what npm run supabase:sync is for. */
export async function runNow() {
  if (!SB.isConfigured()) {
    return { ok: false, reason: 'not_configured', message: 'Supabase is not set up on this server.' };
  }
  if (state.mode === 'off') {
    return { ok: false, reason: 'off', message: 'Automatic sync is off (OG_SYNC_MINUTES=0). Run npm run supabase:sync.' };
  }
  if (state.mode === 'refused') {
    return { ok: false, reason: 'refused', message: state.lastError };
  }
  if (state.mode === 'starting') {
    return { ok: false, reason: 'busy', message: 'The mirror is still starting up.' };
  }
  if (state.busy) {
    return { ok: false, reason: 'busy', message: 'A sync is already running.' };
  }
  /* A pressed button overrides the retry pause: the person has decided. */
  state.nextRetryAt = null;
  if (debounce) { clearTimeout(debounce); debounce = null; }
  const started = Date.now();
  const out = await run('fast');
  const seconds = Math.round((Date.now() - started) / 1000);
  if (state.lastError && !out) return { ok: false, reason: 'failed', seconds, message: state.lastError };
  return { ok: true, seconds, behind: Mirror.behind() || 0, pushed: out ? out.pushed : false };
}

export function stop() {
  if (debounce) { clearTimeout(debounce); debounce = null; }
  if (tick) { clearInterval(tick); tick = null; }
  if (fullTimer) { clearInterval(fullTimer); fullTimer = null; }
  if (lineageTimer) { clearInterval(lineageTimer); lineageTimer = null; }
  if (unhook) { unhook(); unhook = null; }
  state.mode = 'off';
}

export function status() {
  return {
    configured: SB.isConfigured(),
    mode: state.mode,
    running: state.busy,
    runs: state.runs,
    behind: state.mode === 'live' || state.mode === 'offline' ? Mirror.behind() : null,
    lastPushAt: state.lastPushAt,
    lastOkAt: state.lastOkAt,
    lastFailedAt: state.lastFailedAt,
    nextRetryAt: state.nextRetryAt,
    failures: state.failures,
    lastError: state.lastError,
    refusedBy: state.refusedBy,
    fullEveryMinutes: fullMinutes(),
    lastFullAt: state.lastFullAt,
    lastFullOk: state.lastFullOk,
    /* kept for anything that still reads the old name */
    everyMinutes: fullMinutes()
  };
}
