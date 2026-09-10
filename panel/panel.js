/* ==========================================================================
   OG SYSTEM — control panel
   --------------------------------------------------------------------------
   The one window. It replaces start-og-system.bat, push.bat, claim-mirror.bat
   and make-deploy.bat, and it does the thing none of them could: it STAYS,
   holding the server as a child process, so there is something to press Stop
   on and somewhere for the shop's state to be shown.

   Shape: this process supervises, `OG System.exe` opens a window onto it, and
   the window is ordinary HTML in panel/ui — the same dark skin and the same
   Montserrat as the shop, because a launcher that looks like a different
   product reads as a different product.

   It has zero dependencies, like everything else here, and it is bound to
   127.0.0.1: a control panel that can start and stop the till must not be
   reachable from the shop wifi. Every request also carries a key minted at
   boot, because "localhost only" is not by itself a defence — any page in any
   browser on this machine can post to a local port. The key is handed to the
   window in its URL and never leaves the machine.
   ========================================================================== */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer as createProbe } from 'node:net';
import { JOBS } from './jobs.js';
import { load as loadServerEnv } from '../server/lib/env.js';

/* The shop's own server/.env, read the way the server reads it, so the
   panel's idea of which port to check is never a second guess at it. */
loadServerEnv();
const SHOP_PORT = Number(process.env.OG_PORT || 8090);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SERVER = join(ROOT, 'server');
const UI = join(HERE, 'ui');

const PORT = Number(process.env.OG_PANEL_PORT || 8099);
const KEY = process.env.OG_PANEL_KEY || randomBytes(16).toString('hex');

/* Windows resolves `git` and `powershell` through PATHEXT, which spawn() does
   not do unless it goes via a shell. Rather than turn the shell on everywhere
   — and take a quoting problem on every argument a person typed — the
   executables are named exactly once, here. */
const EXE = process.platform === 'win32'
  ? { node: process.execPath, git: 'git.exe', powershell: 'powershell.exe' }
  : { node: process.execPath, git: 'git', powershell: 'pwsh' };

/* ------------------------------------------------------------------ state */

const state = {
  /* 'stopped' | 'starting' | 'running' | 'stopping' — what the button says. */
  server: 'stopped',
  ready: null,     // the server's own ready line: addresses, accounts, shop name
  mirror: null,    // sync-worker status, straight off the pipe
  job: null,       // { name, label, started } while a one-shot is running
  swCache: null,   // the service worker's cache name, as it stands on disk
  stale: false,    // server/ has been edited since the running shop started
  steps: [],       // opening the shop, one row per real thing that happens
  who: null        // who has the shop open, asked for before Stop
};

let child = null;  // the shop
let job = null;    // the running one-shot, if any
let startedAt = 0; // when the shop was launched, for the staleness check below

/* The terminal. A ring, because a full mirror check prints a few thousand
   lines and a panel left open all day must not grow without end. */
const LINES = [];
const MAX_LINES = 3000;
let seq = 0;

/* The server colours its own output for a console - a red STOP, a green tick,
   a dim hint. None of that survives the trip through JSON into a <pre>, where
   it arrives as the escape codes themselves: "134 permission names" printed
   as ESC[2m134 permission names ESC[0m. Stripped here rather than in the
   server, which is right to go on colouring a terminal it may well be running
   in. The characters that carry the meaning - the tick, the dot, the arrow -
   are text, and come through untouched. */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/* Everything the terminal shows also goes to a file, truncated each time the
   panel starts, so the answer to "why did it not open this morning" exists
   after the window has been closed. Same folder the launcher keeps its own
   log and the window's browser profile in. */
const LOG_DIR = join(process.env.LOCALAPPDATA || tmpdir(), 'OGSystem');
let logFile = null;
try {
  mkdirSync(LOG_DIR, { recursive: true });
  logFile = createWriteStream(join(LOG_DIR, 'panel.log'), { flags: 'w' });
  logFile.on('error', () => { logFile = null; });
} catch { logFile = null; }

function stamp() { return new Date().toTimeString().slice(0, 8); }

function say(text, stream = 'out') {
  for (const raw of String(text).replace(ANSI, '').split(/\r?\n/)) {
    const line = { n: ++seq, at: Date.now(), stream, text: raw };
    LINES.push(line);
    if (LINES.length > MAX_LINES) LINES.shift();
    if (logFile) logFile.write(stamp() + '  ' + (stream === 'out' ? '  ' : stream === 'err' ? '! ' : '> ') + raw + '\n');
    push('line', line);
  }
}

/* -------------------------------------------------------------------- SSE */

const watchers = new Set();

function push(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of watchers) {
    try { res.write(frame); } catch { watchers.delete(res); }
  }
}

/* The state as it is RIGHT NOW. `stale` is derived from the disk, so it is
   recomputed here rather than stored - and both the hello frame and every
   push go through this one function, because they must agree. They did not,
   briefly: hello sent whatever `stale` was at the last push, so a window
   opened after an edit said the server was current when it was not.
   Recomputed rather than watched: it is a handful of stat() calls over about
   eighty files, and a watcher that misses an editor's write-to-temp-then-
   rename would be worse than no watcher at all. */
function snapshot() {
  state.stale = serverIsStale();
  return state;
}

function pushState() { push('state', snapshot()); }

/* ------------------------------------------------------------- the steps */

/* What opening the shop actually CONSISTS of, in the order this file does it.
   The window draws these where the terminal used to be, so the person opening
   up can watch the shop open and see which part went wrong, instead of a wall
   of output with the answer somewhere in the middle of it.

   Every one is a real signal — an exit code, a spawn, a message off the pipe.
   Nothing here is a timer pretending to be progress; that is the rule
   js/splash.js states for the shop's own boot and the only reason that screen
   can be believed.

   A step carries a CODE and its values, never a sentence. The words are
   written in the window from its own dictionary, so the same step reads
   correctly in Arabic — server/lib/alerts.js's rule, for alerts.js's reason. */
const STEPS = ['port', 'checks', 'padlock', 'printers', 'server', 'cloud', 'open'];

/* The three the .bat ran once a morning. morning() is guarded so they do not
   run again on a Restart — and a tick for a check that did not run is exactly
   the kind of lie this screen exists to stop telling. On a restart they are
   drawn as SKIPPED, carrying the time they were really done. */
const MORNING_STEPS = new Set(['checks', 'padlock', 'printers']);
let checkedThisSession = false;
let checkedAt = 0;

function resetSteps() {
  state.steps = STEPS.map((id) => {
    const skipped = checkedThisSession && MORNING_STEPS.has(id);
    return {
      id,
      state: skipped ? 'skip' : 'wait',
      detail: skipped ? { code: 'checked_at', at: checkedAt } : null,
      at: Date.now()
    };
  });
  push('steps', state.steps);
}

/* One step moves. Kept in `state` as well as pushed, because a window can
   arrive — or come back from a dropped connection — halfway through a boot,
   and the hello frame has to redraw what has already happened rather than
   start a second sequence underneath the first. */
function step(id, st, detail) {
  const row = state.steps.find((s) => s.id === id);
  if (!row) return;
  row.state = st;
  row.detail = detail || null;
  row.at = Date.now();
  push('step', row);
}

/* The mirror answers whenever it feels like it — SyncWorker.start() reports
   'starting' and the first real run lands seconds later — so the cloud step
   is resolved by the frame rather than waited for. `configured: false` is a
   finished answer, not a missing one: this shop has no Supabase, and saying
   so is better than a row that spins for ever. */
function stepFromMirror(m) {
  if (!m) return;
  if (!m.configured) return step('cloud', 'skip', { code: 'cloud_none' });
  if (m.mode === 'off') return step('cloud', 'skip', { code: 'cloud_manual' });
  if (m.mode === 'starting') return step('cloud', 'run');
  if (m.mode === 'refused') {
    return step('cloud', 'warn', {
      code: 'cloud_refused',
      by: m.refusedBy || null,
      why: (m.pull && m.pull.message) || null
    });
  }
  if (m.mode === 'offline') return step('cloud', 'warn', { code: 'cloud_offline', why: m.lastError || null });
  step('cloud', 'ok', {
    code: 'cloud_live',
    behind: m.behind == null ? null : m.behind,
    at: m.lastOkAt || null,
    pulled: m.pull && m.pull.did ? (m.pull.tables ? m.pull.tables.length : true) : 0
  });
}

/* -------------------------------------------------------------- the shop */

/* ------------------------------------------------------------ the morning */

/* One script, printed into the terminal, answered with its exit code. For the
   checks the .bat ran before the shop opened - never for anything that
   should go through runJob's lock. */
function runQuiet(argv, cwd = SERVER) {
  return new Promise((done) => {
    let p;
    try {
      p = spawn(EXE.node, argv, {
        cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0' }
      });
    } catch (e) { say('  ' + e.message, 'err'); return done(1); }
    p.stdout.on('data', (b) => say(b.toString('utf8').replace(/\n$/, '')));
    p.stderr.on('data', (b) => say(b.toString('utf8').replace(/\n$/, ''), 'err'));
    p.on('error', (e) => { say('  ' + e.message, 'err'); done(1); });
    p.on('exit', (code) => done(code == null ? 1 : code));
  });
}

/* What start-og-system.bat did every morning between the port check and
   `node index.js`, kept to the letter - including the rule that none of it
   may stop the shop opening. A till that cannot print can still sell shoes;
   a launcher that refuses to open the till over a printer that is merely
   switched off has taken the day's takings hostage over a piece of paper.

   Once per panel session, not on every Restart: these take a few seconds and
   two of them can raise a Windows permission prompt, which is right at eight
   in the morning and wrong on the ninth restart of an afternoon's editing.

   Every one of the three reports its own exit code as a step, and NOT ONE OF
   THEM MAY FAIL THE BOOT. That was the .bat's loudest rule and it is kept to
   the letter here: a warn is drawn amber and the shop opens anyway. */
async function morning() {
  if (checkedThisSession) return;
  checkedThisSession = true;

  say('  Readiness...', 'note');
  step('checks', 'run');
  /* preflight speaks in its own codes: 0 fine, 3 the shop is already open
     (impossible here — the port was free a moment ago), 2 the port is held by
     something that is not the shop. */
  const pf = await runQuiet(['scripts/preflight.js']);
  step('checks', pf === 0 || pf === 3 ? 'ok' : 'warn',
    pf === 0 || pf === 3 ? null : { code: 'preflight_exit', exit: pf });

  /* The certificate, and whether Windows trusts it. --check is free and
     silent; only a 4 - made, not yet trusted - leads to the prompt, once. */
  if (existsSync(join(SERVER, 'data', 'certs', 'og-cert.pem'))) {
    step('padlock', 'run');
    if (await runQuiet(['scripts/trust-cert.js', '--check']) === 4) {
      say('');
      const trusted = await runQuiet(['scripts/trust-cert.js']);
      step('padlock', trusted === 0 ? 'ok' : 'warn',
        { code: trusted === 0 ? 'padlock_now' : 'padlock_untrusted' });
    } else {
      step('padlock', 'ok', { code: 'padlock_trusted' });
    }
  } else {
    /* Not a failure. It means every device other than this one gets no
       notifications, no camera scanner and cannot install the app — worth
       saying, never worth stopping for. */
    step('padlock', 'warn', { code: 'padlock_none' });
  }

  /* The printers and the scanner. 4 means something is missing that can be
     installed from here: do it, then ASK AGAIN rather than assuming it
     worked. 1 means a person is needed - it is said, and the shop opens
     anyway. */
  say('');
  step('printers', 'run');
  let hw = await runQuiet(['scripts/hardware.js']);
  const installed = hw === 4;
  if (hw === 4) {
    say('');
    say('  Setting up the printers. This may ask for permission.', 'note');
    await runQuiet(['scripts/hardware.js', '--install']);
    say('');
    say('  Checking again...', 'note');
    hw = await runQuiet(['scripts/hardware.js']);
  }
  if (hw === 1) {
    say('');
    say('  The shop still opens and still takes money - it is the PRINTING that', 'err');
    say('  will not work until the above is sorted out.', 'err');
  }
  step('printers', hw === 0 ? 'ok' : 'warn',
    hw === 0 ? (installed ? { code: 'printers_installed' } : null)
             : { code: hw === 1 ? 'printers_person' : 'printers_exit', exit: hw });

  checkedAt = Date.now();
  say('');
}

/* Is anything on the shop's port, and if so is it the shop.

   preflight.js has done exactly this since the .bat existed, and for a reason
   worth keeping: without it Node throws EADDRINUSE with a stack trace that
   names net.js and node:internal, and never the window somebody has to close.
   That trace went straight into this terminal the first time the panel was
   driven, which is how it got written. */
function whatHoldsThePort() {
  return new Promise((done) => {
    const probe = createProbe();
    probe.once('error', (e) => done(e.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => done(false)));
    probe.listen(SHOP_PORT);
  });
}

async function askTheShop() {
  const ctl = AbortController ? new AbortController() : null;
  const t = ctl && setTimeout(() => ctl.abort(), 1500);
  try {
    /* The plain port, even when HTTPS is up: the server passes /api/ straight
       through rather than redirecting it, and Node's fetch would refuse the
       self-signed certificate on the secure one. */
    const r = await fetch('http://127.0.0.1:' + SHOP_PORT + '/api/health', { signal: ctl && ctl.signal });
    const b = await r.json();
    return b && b.ok === true ? b : null;
  } catch { return null; } finally { if (t) clearTimeout(t); }
}

async function startServer() {
  if (child || state.server === 'starting') return;
  state.server = 'starting';
  resetSteps();
  state.who = null;
  pushState();

  step('port', 'run');
  if (await whatHoldsThePort()) {
    const health = await askTheShop();
    state.server = 'stopped';

    if (health) {
      /* Not a failure — a second press, or a shop started from a terminal.
         The addresses are filled in from its own health line so the URL
         buttons work on a server this panel did not start.

         `https` is THIS MACHINE's secure address and the window labels it so.
         It used to be filled with health.lan[0], which is a wifi address: the
         same url was then printed twice, once under "this computer" and once
         under "on the wifi", and the first was wrong. The health line says
         whether HTTPS is on; the port is ours to know. */
      const httpsPort = Number(process.env.OG_HTTPS_PORT || 8443);
      state.ready = {
        http: 'http://localhost:' + SHOP_PORT,
        https: health.https ? 'https://localhost:' + httpsPort : null,
        lan: health.lan || [],
        /* Straight off the health line rather than out of this process's own
           environment: the shop being adopted may have been started with a
           different .env than this panel can see, and printing OUR tunnel
           address over THEIR server is how somebody ends up typing an address
           that reaches a different shop. */
        public: health.public || null,
        secure: !!health.https,
        shop: health.shop,
        accounts: null,
        foreign: true
      };
      /* Adopted, not started. Every check this panel would have run belongs to
         whoever DID start it, so they are skipped rather than claimed. */
      step('port', 'ok', { code: 'port_adopted' });
      for (const id of ['checks', 'padlock', 'printers', 'cloud']) step(id, 'skip', { code: 'foreign' });
      step('server', 'skip', { code: 'foreign' });
      step('open', 'ok', { code: 'open_foreign', shop: health.shop || null });
      pushState();
      say('');
      say('  The shop is already open - started somewhere else, not from here.', 'note');
      say('  Nothing needs restarting. The addresses below still open it.', 'note');
      say('  Stop is greyed out because this panel is not what is holding it.', 'note');
      return;
    }

    step('port', 'fail', { code: 'port_held', port: SHOP_PORT });
    pushState();
    say('');
    say('  Port ' + SHOP_PORT + ' is held by something that is not the shop, so the', 'err');
    say('  server cannot start. Find it and close it:', 'err');
    say('    netstat -ano | findstr :' + SHOP_PORT, 'err');
    say('    taskkill /PID <the number at the end> /F', 'err');
    return;
  }
  step('port', 'ok', { code: 'port_free', port: SHOP_PORT });

  await morning();
  if (child) return;   /* somebody pressed Start twice during the checks */

  state.server = 'starting';
  state.ready = null;
  step('server', 'run');
  pushState();
  say('');
  say('  Starting the shop...', 'note');

  /* The two pipes are the terminal you are looking at. The fourth entry is
     the channel server/lib/panel-link.js talks over — and without that 'ipc'
     there is no graceful Stop on Windows at all. See that file for why. */
  child = spawn(EXE.node, ['index.js'], {
    cwd: SERVER,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '0' }
  });
  /* What this process could possibly have loaded. Hard refresh compares the
     files against it, because a server started before an edit is running the
     old code and no amount of reloading the BROWSER changes that. */
  startedAt = Date.now();

  child.stdout.on('data', (b) => say(b.toString('utf8').replace(/\n$/, '')));
  child.stderr.on('data', (b) => say(b.toString('utf8').replace(/\n$/, ''), 'err'));

  child.on('message', (m) => {
    if (!m || !m.type) return;
    if (m.type === 'ready') {
      state.ready = m;
      state.server = 'running';
      step('server', 'ok', { code: 'server_up' });
      step('open', 'ok', {
        code: 'open_here',
        shop: m.shop || null,
        accounts: m.accounts == null ? null : m.accounts,
        secure: !!m.secure
      });
      return pushState();
    }
    if (m.type === 'mirror') { state.mirror = m.mirror; stepFromMirror(m.mirror); return pushState(); }
    if (m.type === 'who') { state.who = m.who || null; return pushState(); }
    if (m.type === 'stopping') { state.server = 'stopping'; return pushState(); }
    if (m.type === 'log') say(m.line);
  });

  child.on('error', (e) => {
    say('  Could not start the server: ' + e.message, 'err');
    child = null;
    state.server = 'stopped';
    state.ready = null;
    step('server', 'fail', { code: 'server_spawn', why: e.message });
    pushState();
  });

  child.on('exit', (code, signal) => {
    const wasStopping = state.server === 'stopping';
    child = null;
    state.server = 'stopped';
    state.ready = null;
    /* The mirror card is a fact about a running worker. Left standing over a
       closed shop it goes on saying "Live, pushed 4m ago" for as long as the
       panel is open, which is a lie that gets truer-looking with age. */
    state.mirror = null;
    state.who = null;
    /* A shop that STOPS BY ITSELF is the one thing this screen must never
       show as a tick. Somebody asked for it — Stop, Restart, a job that
       closes the shop around itself — and it is finished; nobody asked, and
       it fell over, which is a failure and is drawn as one. */
    if (wasStopping) resetSteps();
    else {
      step('server', 'fail', { code: 'server_died', exit: code == null ? null : code, signal: signal || null });
      /* And "Open for business" stops being true the moment it stops being
         true. Left alone it went on carrying its tick UNDER the row that had
         just gone red — the boot's own record contradicting itself, with the
         reassuring half at the bottom where the eye finishes. */
      step('open', 'wait');
      step('cloud', 'wait');
    }
    pushState();
    say('');
    const how = code ? '  (exit ' + code + ')' : signal ? '  (' + signal + ')' : '';
    say('  The shop is closed.' + how, 'note');
  });
}

/* Graceful, then not. The message is the only stop Windows has that runs the
   server's own shutdown — closing both listeners and DB.close(). taskkill is
   the fallback for a process that has stopped listening to anything at all,
   and it leaves the WAL to replay on the next open rather than a clean close. */
function stopServer() {
  if (!child) return;
  const dying = child;
  state.server = 'stopping';
  pushState();
  say('  Stopping...', 'note');
  try { dying.send({ type: 'stop' }); } catch { /* already gone */ }

  setTimeout(() => {
    if (child !== dying || dying.exitCode !== null) return;
    say('  It did not stop on its own - closing it the hard way.', 'err');
    if (process.platform === 'win32') {
      spawn('taskkill.exe', ['/PID', String(dying.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { dying.kill('SIGKILL'); } catch { /* gone */ }
    }
  }, 8000).unref();
}

/* Has anything the SERVER runs changed since it was started? Node reads a
   module once, at import, so a server launched before an edit goes on running
   the old code until it is restarted - and Hard refresh, which only ever
   spoke to the browser, could not fix that. What it looked like from the shop
   floor: a new route answering "No such endpoint" to a button that plainly
   exists in the source.

   Only the trees the process actually imports or executes. `data/` and
   `backups/` change constantly and mean nothing here; `node_modules` does not
   exist, by design. */
const SERVER_TREES = ['lib', 'scripts', 'migrations'];

function newestServerFileMs() {
  let newest = 0;
  const look = (full) => {
    let st;
    try { st = statSync(full); } catch { return; }
    if (st.isDirectory()) {
      let kids = [];
      try { kids = readdirSync(full); } catch { return; }
      for (const k of kids) look(join(full, k));
      return;
    }
    if (/\.(js|mjs|json|sql)$/i.test(full) && st.mtimeMs > newest) newest = st.mtimeMs;
  };
  look(join(SERVER, 'index.js'));
  for (const d of SERVER_TREES) look(join(SERVER, d));
  return newest;
}

function serverIsStale() {
  return !!child && startedAt > 0 && newestServerFileMs() > startedAt;
}

/* ----------------------------------------------------------- hard refresh */

const SW = join(ROOT, 'sw.js');
const CACHE_RE = /(var CACHE = 'og-system-v)(\d+)(';)/;

function readCacheName() {
  try {
    const m = CACHE_RE.exec(readFileSync(SW, 'utf8'));
    return m ? 'og-system-v' + m[2] : null;
  } catch { return null; }
}

/* Two halves, and it is only a hard refresh with both.

   The FILE half bumps the service worker's cache name. CLAUDE.md has said to
   do that by hand on every change to js/, css/ or index.html since long
   before this panel existed, and forgetting it means nobody who has already
   opened the app ever receives the change. One integer in one file is better
   kept by a button than by a paragraph somebody has to remember.

   The TAB half tells the copies already open to throw their caches away and
   come back. sw.js is cache-first with ignoreSearch, so without it they go on
   answering out of the old store however hard anybody presses F5. It reaches
   the tabs holding /api/live, which is the manager's and the developer's: a
   till reloading itself under a cashier's hands is not a refresh, it is a
   lost sale. */
function hardRefresh() {
  try {
    const text = readFileSync(SW, 'utf8');
    const m = CACHE_RE.exec(text);
    if (!m) {
      say('  sw.js has no cache-name line to bump, so it was left alone.', 'err');
    } else {
      const next = Number(m[2]) + 1;
      writeFileSync(SW, text.replace(CACHE_RE, '$1' + next + '$3'), 'utf8');
      state.swCache = 'og-system-v' + next;
      say('  sw.js  og-system-v' + m[2] + '  ->  ' + state.swCache, 'note');
    }
  } catch (e) {
    say('  Could not bump sw.js: ' + e.message, 'err');
  }

  /* THE SERVER HALF. Editing server/ and pressing Hard refresh used to update
     the browser and leave the shop running the code it was started with - so
     a route added a minute ago answered "No such endpoint" to a button that
     plainly existed. Restarted only when something it runs actually changed,
     because a restart costs the boot pull and interrupts the till. */
  if (serverIsStale()) {
    say('  The server code changed since it started - restarting the shop too.', 'note');
    const dying = child;
    stopServer();
    const wait = setInterval(() => {
      if (child === dying) return;
      clearInterval(wait);
      startServer();
      /* The tabs are told once it is answering again, or they reload into a
         shop that is still pulling from the cloud and see the failure page. */
      const upAgain = setInterval(() => {
        if (state.server !== 'running') return;
        clearInterval(upAgain);
        tellTabs();
      }, 500);
      upAgain.unref();
    }, 300);
    wait.unref();
    pushState();
    return;
  }

  tellTabs();
  pushState();
}

function tellTabs() {
  if (child) {
    try { child.send({ type: 'reload' }); } catch { /* gone */ }
    say('  Told every open tab to drop its cache and come back.', 'note');
  } else {
    say('  The shop is not running, so there are no open tabs to tell.', 'note');
  }
}

/* --------------------------------------------------------------- the jobs */

/* A refusal has to reach somebody who is NOT reading the terminal. POST /act
   answers {"ok":true} before the action runs — deliberately, it is fire and
   forget — so until now the only trace of "that button did nothing, and here
   is why" was a red line in the log. Demoting the log means saying these out
   loud instead. */
function refuse(name, code, extra) {
  push('refused', { name, code, ...(extra || {}) });
}

function runJob(name, args = {}) {
  if (job) {
    say('  Something is already running - wait for it to finish.', 'err');
    return refuse(name, 'job_busy', { running: state.job ? state.job.label : null });
  }
  const spec = JOBS[name];
  if (!spec) { say('  No such job: ' + name, 'err'); return refuse(name, 'job_unknown'); }

  /* The reason this check is here and not in the UI: a disabled button is a
     suggestion. Two writers on one set of mirror bookmarks is the exact
     failure lineage.js exists to prevent, and it must not depend on which
     buttons happened to be greyed out when somebody pressed one. */
  if (spec.while === 'shut' && child && !spec.aroundShop) {
    say('');
    say('  "' + spec.label + '" needs the shop closed first. Press Stop, then try again.', 'err');
    return refuse(name, 'needs_shut', { label: spec.label });
  }

  const steps = spec.steps(args);
  const cwd = spec.cwd === 'server' ? SERVER : ROOT;
  state.job = { name, label: spec.label, started: Date.now() };
  pushState();
  say('');
  say('  -- ' + spec.label + ' ' + '-'.repeat(Math.max(2, 56 - spec.label.length)), 'note');

  let i = 0;
  /* Whether the shop was open when this began, so it is put back the way it
     was found - including after a refusal. A handover that fails leaves the
     local copy exactly as it was (lib/restore.js puts the file back), and a
     shop left closed over a refusal reads as a crash. */
  const reopen = !!(spec.aroundShop && child);

  const done = (code) => {
    job = null;
    state.job = null;
    /* A publish or a build changes what is on disk, so the panel's own idea
       of the service worker's cache name is stale the moment one lands. */
    state.swCache = readCacheName();
    pushState();
    say(code ? '  ' + spec.label + ' stopped.' : '  ' + spec.label + ' - done.', code ? 'err' : 'note');
    /* The two refusals a person can act on, said in the panel's own words
       under the script's - 2 is busy_elsewhere by contract, and 1 with
       "never reached the cloud" is unpushed_local. */
    if (spec.aroundShop && code === 2) {
      say('  The other laptop is still open. Quit OG System there, wait a minute, then try again.', 'err');
    }
    push('done', { name, code, label: spec.label });
    if (reopen || (spec.aroundShop && code === 0)) {
      say('  Opening the shop again...', 'note');
      startServer();
    }
  };

  const next = () => {
    if (i >= steps.length) return done(0);
    const [bin, argv] = steps[i++];
    const exe = EXE[bin] || bin;
    /* Which of how many. A publish is four git calls and Claim the mirror is
       three scripts; without this the window can only say "running" for two
       minutes, and the only place the truth existed was the terminal this
       screen was built to stop making people read. */
    push('job', { name, label: spec.label, step: i, of: steps.length, argv: bin + ' ' + argv.join(' ') });
    say('  > ' + bin + ' ' + argv.join(' '), 'note');

    const p = spawn(exe, argv, {
      cwd,
      stdio: [spec.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ...(spec.env || {}) }
    });
    job = p;

    if (spec.stdin) { try { p.stdin.end(spec.stdin(args)); } catch { /* closed */ } }
    p.stdout.on('data', (b) => say(b.toString('utf8').replace(/\n$/, '')));
    p.stderr.on('data', (b) => say(b.toString('utf8').replace(/\n$/, ''), 'err'));
    p.on('error', (e) => { say('  ' + e.message, 'err'); done(1); });
    p.on('exit', (code) => {
      job = null;
      /* Stop at the first failure. push.bat did this too, and for the same
         reason: pushing after a failed rebase is how a conflict turns into a
         force-push conversation. */
      if (code) { say('  exit ' + code, 'err'); return done(code); }
      next();
    });
  };

  if (!reopen) return next();

  /* Close the shop, and only then begin - waiting for the exit rather than
     a fixed pause, because a shutdown drains open connections first and the
     wipe refuses while anything still answers on the port. */
  say('  Closing the shop first...', 'note');
  const dying = child;
  stopServer();
  const wait = setInterval(() => {
    if (child === dying) return;
    clearInterval(wait);
    next();
  }, 300);
  wait.unref();
}

/* --------------------------------------------------------------- the door */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff'
};

function body(req) {
  return new Promise((ok) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
  });
}

/* What the buttons are, minus the code that runs them — the window draws
   itself from this, so a job added to jobs.js appears without the UI being
   edited as well. */
function catalogue() {
  const out = {};
  for (const [k, v] of Object.entries(JOBS)) {
    out[k] = {
      label: v.label, blurb: v.blurb, danger: v.danger || null,
      needs: v.needs || null, while: v.while,
      /* `group` is what lets the window draw the list from the table rather
         than from a hand-kept list of names beside it, which is what it did
         and which quietly dropped any job added afterwards.

         `aroundShop` was missing and the window was WRONG for it: restore and
         takeShop are while:'shut', so they were greyed out while the shop was
         open — but runJob closes it, runs them and opens it again. The mirror
         card only worked because it drew its own un-greyed copy of the
         button. Sent now, so the enablement rule can match the real one. */
      group: v.group || 'shop',
      aroundShop: !!v.aroundShop
    };
  }
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;

  /* Belt and braces. The listener is bound to the loopback address, so
     nothing off this machine can arrive at all; the key is what stops a page
     open in a browser ON this machine from posting Stop to the till. */
  const keyed = url.searchParams.get('k') === KEY || req.headers['x-og-key'] === KEY;

  if (path === '/' || path === '/index.html') {
    if (!keyed) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('no key'); }
    const html = readFileSync(join(UI, 'index.html'), 'utf8').split('__KEY__').join(KEY);
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  /* The panel's own assets, plus the shop's mark and fonts, so the window is
     the same product rather than a lookalike. */
  /* /shop/ is the shop's own js/, and it exists for exactly one file:
     js/codes.js, which already holds a complete ISO 18004 QR encoder. The
     address card draws the wifi url as a code somebody points a phone at, and
     writing a SECOND encoder next to a working one is how two things that
     must agree stop agreeing. It is self-contained — no DB, no I18N, not even
     document — so it loads here unchanged.

     Served by the PANEL, not by the shop, so the card still draws with the
     shop stopped. That is the same reason panel.css copies the design tokens
     rather than importing them. */
  if (path.startsWith('/ui/') || path.startsWith('/assets/') || path.startsWith('/shop/')) {
    const base = path.startsWith('/ui/') ? UI
      : path.startsWith('/assets/') ? join(ROOT, 'assets')
        : join(ROOT, 'js');
    const rel = path.replace(/^\/(ui|assets|shop)\//, '');
    const full = resolve(base, rel);
    if (!full.startsWith(base) || !existsSync(full) || !statSync(full).isFile()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    return res.end(readFileSync(full));
  }

  if (!keyed) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"ok":false}'); }

  if (path === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.write('retry: 2000\n\n');
    res.write('event: hello\ndata: ' + JSON.stringify({ state: snapshot(), lines: LINES, jobs: catalogue() }) + '\n\n');
    watchers.add(res);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 20000);
    beat.unref();
    req.on('close', () => { watchers.delete(res); clearInterval(beat); });
    return;
  }

  if (path === '/act' && req.method === 'POST') {
    const b = await body(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return act(b.action, b.args || {});
  }

  res.writeHead(404);
  res.end();
});

function act(action, args) {
  if (action === 'start') return startServer();
  if (action === 'stop') return stopServer();

  if (action === 'restart') {
    if (!child) return startServer();
    const dying = child;
    stopServer();
    /* Waiting for the exit rather than a fixed delay: the boot pull can hold
       the next start for a minute, and starting a second server while the
       first still holds the port is the one thing preflight cannot fix. */
    const wait = setInterval(() => {
      if (child === dying) return;
      clearInterval(wait);
      startServer();
    }, 300);
    wait.unref();
    return;
  }

  if (action === 'refresh') return hardRefresh();

  if (action === 'sync') {
    if (!child) {
      say('  The shop is not running, so there is nothing to sync from.', 'err');
      return refuse('sync', 'sync_no_shop');
    }
    if (state.mirror && state.mirror.mode === 'refused') {
      say('  This machine is not the shop, so it cannot push to the cloud copy.', 'err');
      say('  Take the shop here (pull the cloud copy down), or Claim the mirror if THIS', 'err');
      say('  machine holds the truth. Either way, close the shop on the other laptop first.', 'err');
      return refuse('sync', 'sync_refused');
    }
    try { child.send({ type: 'sync' }); } catch { /* gone */ }
    return say('  Asked the shop for a full sync.', 'note');
  }

  /* WHO IS USING THE SHOP. Asked before Stop, because closing the till under
     somebody's hands is a lost sale, and the panel has no way of knowing on
     its own — it holds a process, not a session.

     Fire and forget like everything else here: the answer comes back up the
     pipe as `who` and lands in state, so the dialog can open at once and fill
     the names in when they arrive rather than blocking on a round trip.

     It is worth being exact about what this proves. Live.presence() counts
     the accounts holding /api/live open, deduplicated per person. That is
     "Lubna has the shop open", which is true and useful. It is NOT "Lubna is
     halfway through a sale", and the wording must not claim to be. */
  if (action === 'who') {
    if (!child) { state.who = null; return pushState(); }
    try { child.send({ type: 'who' }); } catch { /* gone */ }
    return;
  }

  if (action === 'open') return openBrowser(args.url);
  if (action === 'clear') { LINES.length = 0; return push('clear', {}); }
  if (action === 'quit') return quit();
  if (action === 'job') return runJob(args.name, args);

  say('  Unknown action: ' + action, 'err');
}

/* Chrome by name when it is installed, the default browser otherwise. The
   shop's devices were set up on Chrome and that is what was asked for; a
   machine without it still gets a browser rather than nothing. */
const CHROME = process.platform === 'win32' ? [
  join(process.env['ProgramFiles'] || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
  join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
].filter((c) => { try { return existsSync(c); } catch { return false; } }) : [];

function openBrowser(url) {
  if (!url || !/^https?:\/\//.test(url)) return;
  if (process.platform === 'win32') {
    if (CHROME.length) {
      try {
        spawn(CHROME[0], [url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        return;
      } catch { /* fall through to whatever Windows prefers */ }
    }
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

/* Closing the panel closes the shop, politely first. That is the whole point
   of holding the server as a child: nothing is left running afterwards that
   nobody can see. */
let quitting = false;
function quit() {
  if (quitting) process.exit(0);
  quitting = true;
  if (!child) process.exit(0);
  child.on('exit', () => process.exit(0));
  stopServer();
  setTimeout(() => process.exit(0), 9000).unref();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, quit);

/* The launcher holds stdin open and CLOSES it to say "quit" — Windows has no
   signal to send a process that has no console of its own.

   Gated on the launcher saying so, not on stdin merely not being a terminal.
   That was the first shape of this and it was wrong: run under any shell that
   hands over a closed or redirected stdin — a background job, a pipe, a test
   harness — and end-of-file arrives at once, so the panel quit a moment after
   it started, with nothing on screen to say why. */
if (process.env.OG_PANEL_PARENT === '1') {
  process.stdin.resume();
  process.stdin.on('end', quit);
  process.stdin.on('error', quit);
}

state.swCache = readCacheName();
say('  Log: ' + join(LOG_DIR, 'panel.log'), 'note');

server.listen(PORT, '127.0.0.1', () => {
  /* The launcher reads this line to learn where to point the window, and it
     is the only thing this process writes to its own stdout. */
  process.stdout.write('OG_PANEL_READY http://127.0.0.1:' + PORT + '/?k=' + KEY + '\n');
  if (process.env.OG_PANEL_AUTOSTART !== '0') startServer();
});

server.on('error', (e) => {
  const why = e.code === 'EADDRINUSE' ? 'The control panel is already open.' : e.message;
  process.stdout.write('OG_PANEL_FAILED ' + why + '\n');
  process.exit(e.code === 'EADDRINUSE' ? 3 : 1);
});
