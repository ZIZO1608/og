/* ==========================================================================
   OG SYSTEM — the main server and its standby                   [standby.js]
   --------------------------------------------------------------------------
   Online first (24 Sep 2026): ONE server is the shop — the main one — and a
   second keeps a fresh, READ-ONLY copy of it, ready for the day the main one
   cannot be reached. Today the laptop is the main server and the VPS can be
   its standby; after the switch the VPS is the main one and the laptop its
   standby. Same code, one setting:

     OG_ROLE=primary      (the default) the shop. It also HANDS OUT copies,
                          when OG_COPY_KEY is set: GET /api/copy/db.
     OG_ROLE=standby      a copy. OG_UPSTREAM names the main server, and every
                          OG_STANDBY_MINUTES (5) it fetches a fresh copy, checks
                          it, and swaps it in. It refuses every write, and runs
                          none of the workers — the Telegram bots, reminders,
                          the cloud mirror and the backups belong to the one
                          main server, or everything happens twice.

   THERE IS STILL ONLY ONE WRITER. Nothing flows from the standby back to the
   main server; this is a copy, not a sync. (Working through an internet cut
   and sending that work back afterwards is the next step of the plan, built
   on this one.)

   THE COPY is the whole database — accounts, sealed passwords, customers —
   so its door is shut three ways: a bearer key compared in constant time
   (503 while no key is set, 401 for a wrong one), a 404 for anything the
   public proxy carried (a visitor, not the other server), and nginx refusing
   the path outright (deploy/shop-proxy). It is `VACUUM INTO`, a consistent
   snapshot taken while the shop keeps selling.

   THE STANDBY'S OWN SIGN-INS survive each swap. A person signing in to the
   standby writes a session there, which the next copy would throw away; so
   sessions made HERE since the last copy are carried into the next one — and
   only those. A session that came WITH a copy is never carried: if the main
   server has since signed that person out, or switched the account off, the
   next copy does not have it and neither does the standby.
   ========================================================================== */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  createReadStream, createWriteStream, existsSync, readFileSync, renameSync, rmSync,
  statSync, unlinkSync, writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as DB from './db.js';
import { dbFile, dataDir } from './env.js';
import * as Backup from './backup.js';
import * as Auth from './auth.js';
import * as Outbox from './outbox.js';
import * as Loans from './loans.js';

export const role = () => (String(process.env.OG_ROLE || '').toLowerCase() === 'standby' ? 'standby' : 'primary');
export const isStandby = () => role() === 'standby';
const everyMs = () => Number(process.env.OG_STANDBY_EVERY_MS) ||
  Math.max(1, Number(process.env.OG_STANDBY_MINUTES) || 5) * 60000;

/* ---------------------------------------------------------- handing out */

/* 'ok' | 'not_configured' | 'bad_key' */
export function copyKeyCheck(req) {
  const want = process.env.OG_COPY_KEY || '';
  if (!want) return 'not_configured';
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(want);
  return got && a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'bad_key';
}

/* A consistent snapshot of the live database, streamed and then deleted. */
export function sendCopy(res) {
  const tmp = join(dataDir(), `copy-out-${process.pid}-${randomBytes(4).toString('hex')}.db`);
  const at = DB.nowIso();
  Backup.snapshot(dbFile(), tmp);
  const size = statSync(tmp).size;
  res.writeHead(200, {
    'Content-Type': 'application/vnd.sqlite3',
    'Content-Length': size,
    'Cache-Control': 'no-store',
    'X-OG-Copy-At': at
  });
  const done = () => { try { unlinkSync(tmp); } catch { /* already gone */ } };
  const s = createReadStream(tmp);
  s.on('close', done);
  s.on('error', () => { done(); res.destroy(); });
  s.pipe(res);
}

/* ------------------------------------------------------------- the standby */

const STATE_FILE = () => join(dataDir(), 'standby.json');

/* ---- which laptop this is, and where it answers ----------------------------
   The main server lends invoice numbers to a NAME (lib/loans.js), and the
   domain's page offers this laptop's own addresses when the main server stops
   answering. OG_STANDBY_ID, or the machine's name. */
export function holder() {
  const raw = String(process.env.OG_STANDBY_ID || hostname() || '')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return raw || 'shop-laptop';
}
let localUrls = () => [];
/* Where people go back to once the line is back: the domain. */
export const home = () => process.env.OG_STANDBY_HOME || process.env.OG_UPSTREAM || null;

/* ---- the patience rule (online first, phase 3) ----------------------------
   A line that flickers must not throw the shop from one address to the other
   ten times an hour: DOWN is twenty seconds with no answer at all, BACK is a
   minute of steady answers. Asked every five seconds. */
const PROBE_MS = () => Number(process.env.OG_STANDBY_PROBE_MS) || 5000;
const DOWN_MS = () => Number(process.env.OG_STANDBY_DOWN_MS) || 20000;
const UP_MS = () => Number(process.env.OG_STANDBY_UP_MS) || 60000;

const state = {
  upstream: null,
  copyAt: null,      // when the MAIN server took the copy now being served
  tookAt: null,      // when this standby swapped it in
  lastTry: null,
  lastError: null,   // a code, or null
  reachable: null,   // did the last fetch reach the main server
  swaps: 0,
  busy: false,
  /* following — a read-only copy, the main server answering
     offline   — the main server silent: the till's writes are taken here
     sending   — it is back: the outbox is going up, oldest first
     closing   — all sent: the fresh copy is being fetched and swapped in */
  mode: 'following',
  downSince: null,
  upSince: null,
  offlineSince: null,
  backAt: null,      // when the last outage ended with everything sent
  sentLast: 0
};
/* Sessions and sign-in attempts that came WITH the current copy. Anything
   not in here was made on this standby, and is what gets carried across. In
   memory on purpose: after a restart nothing is known to be local, so
   nothing is carried and the few people signed in here sign in again —
   the safe way round. */
let copyTokens = null;
let copyAttemptMax = null;
let timer = null;

function loadState() {
  try { Object.assign(state, JSON.parse(readFileSync(STATE_FILE(), 'utf8'))); } catch { /* first start */ }
  state.busy = false;
}
function saveState() {
  try {
    writeFileSync(STATE_FILE(), JSON.stringify({ copyAt: state.copyAt, tookAt: state.tookAt, swaps: state.swaps }));
  } catch { /* the copy works without it; only the "as of" time is lost on a restart */ }
}

export function status() {
  if (!isStandby()) return { role: role() };
  const c = Outbox.counts();
  let numbersLeft = null;
  try { numbersLeft = Loans.unused(DB.get(), holder()); } catch { numbersLeft = null; }
  return {
    role: role(),
    upstream: process.env.OG_UPSTREAM || null,
    copyAt: state.copyAt,
    tookAt: state.tookAt,
    reachable: state.reachable,
    lastError: state.lastError,
    mode: state.mode,
    offlineSince: state.offlineSince,
    backAt: state.backAt,
    sentLast: state.sentLast,
    waiting: c.waiting,
    waitingSales: c.sales,
    attention: c.attention,
    numbersLeft,
    home: home()
  };
}

export const mode = () => state.mode;
/* The till's writes are taken here only while the main server is silent —
   and while what was taken is still going up, so a sale rung up in the
   minute the line came back is not refused at the counter. */
export const takesWrites = () => isStandby() && (state.mode === 'offline' || state.mode === 'sending');

/* One request to the main server. The main server's own certificate is the
   only one trusted when OG_UPSTREAM_CA names it (a self-signed laptop); a
   public one (Let's Encrypt) needs nothing. */
function upstreamOpts(url, method, headers, timeout) {
  const https = url.protocol === 'https:';
  const opts = {
    method,
    headers: {
      Authorization: 'Bearer ' + (process.env.OG_COPY_KEY || ''),
      'X-OG-Standby-Id': holder(),
      'X-OG-Standby-Urls': localUrls().join(','),
      ...headers
    },
    timeout
  };
  if (https && process.env.OG_UPSTREAM_CA) {
    opts.ca = readFileSync(process.env.OG_UPSTREAM_CA);
    /* The certificate is checked against this NAME (the till's is `og-till`),
       not against the address it was reached at. */
    if (process.env.OG_UPSTREAM_NAME) opts.servername = process.env.OG_UPSTREAM_NAME;
  }
  if (https && process.env.OG_UPSTREAM_NAME) {
    const want = process.env.OG_UPSTREAM_NAME;
    opts.checkServerIdentity = (_host, cert) => {
      const names = String(cert.subjectaltname || '').split(',').map((s) => s.trim().replace(/^DNS:/, ''));
      return names.includes(want) ? undefined : new Error('certificate does not name ' + want);
    };
  }
  return { https, opts };
}

/* A small JSON request (the probe, the replay). */
function upstreamJson(method, path, body, timeout) {
  return new Promise((resolve) => {
    let url, u;
    try { url = new URL(path, process.env.OG_UPSTREAM); } catch { return resolve({ ok: false, code: 'no_upstream' }); }
    const text = body === undefined ? null : JSON.stringify(body);
    try {
      u = upstreamOpts(url, method, text ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) } : {}, timeout);
    } catch { return resolve({ ok: false, code: 'no_ca' }); }
    const req = (u.https ? httpsRequest : httpRequest)(url, u.opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json = null; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, reached: true });
      });
      res.on('error', () => resolve({ ok: false, code: 'cut_off', reached: true }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ ok: false, code: e.message === 'timeout' ? 'timeout' : 'unreachable' }));
    if (text) req.write(text);
    req.end();
  });
}

/* GET the copy into `target`. */
function fetchCopy(target) {
  return new Promise((resolve) => {
    let url, u;
    try { url = new URL('/api/copy/db', process.env.OG_UPSTREAM); } catch { return resolve({ ok: false, code: 'no_upstream' }); }
    try { u = upstreamOpts(url, 'GET', {}, 60000); } catch { return resolve({ ok: false, code: 'no_ca' }); }
    const { https, opts } = u;
    const req = (https ? httpsRequest : httpRequest)(url, opts, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ ok: false, code: 'upstream_' + res.statusCode, reached: true });
      }
      const want = Number(res.headers['content-length'] || 0);
      const out = createWriteStream(target);
      let got = 0;
      res.on('data', (c) => { got += c.length; });
      res.pipe(out);
      out.on('finish', () => {
        if (want && got !== want) return resolve({ ok: false, code: 'short_copy', reached: true });
        resolve({ ok: true, copyAt: res.headers['x-og-copy-at'] || null, reached: true });
      });
      out.on('error', () => resolve({ ok: false, code: 'write_failed', reached: true }));
      res.on('error', () => resolve({ ok: false, code: 'cut_off', reached: true }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ ok: false, code: e.message === 'timeout' ? 'timeout' : 'unreachable', why: e.code || e.message }));
    req.end();
  });
}

function columns(d, schema, table) {
  return d.prepare(`PRAGMA ${schema}.table_info("${table}")`).all().map((c) => c.name);
}

/* Sessions and attempts made on THIS standby since the last copy, into the
   new file, before it replaces the old one. */
function carryLocal(next, cur) {
  if (!copyTokens || !existsSync(cur)) return { sessions: 0, attempts: 0 };
  const n = new DatabaseSync(next);
  try {
    n.exec(`ATTACH DATABASE '${cur.replace(/'/g, "''")}' AS o`);
    let sessions = 0, attempts = 0;
    const sc = columns(n, 'main', 'sessions').filter((c) => columns(n, 'o', 'sessions').includes(c));
    if (sc.length) {
      const list = sc.map((c) => `"${c}"`).join(', ');
      const local = n.prepare(`SELECT ${list} FROM o.sessions WHERE user_id IN (SELECT id FROM main.users WHERE active = 1)`).all()
        .filter((s) => !copyTokens.has(s.token));
      const ins = n.prepare(`INSERT OR IGNORE INTO main.sessions (${list}) VALUES (${sc.map(() => '?').join(', ')})`);
      for (const s of local) { ins.run(...sc.map((c) => s[c])); sessions++; }
    }
    if (copyAttemptMax !== null) {
      const ac = columns(n, 'main', 'login_attempts').filter((c) => c !== 'id' && columns(n, 'o', 'login_attempts').includes(c));
      if (ac.length) {
        const list = ac.map((c) => `"${c}"`).join(', ');
        attempts = Number(n.prepare(`INSERT INTO main.login_attempts (${list}) SELECT ${list} FROM o.login_attempts WHERE id > ?`)
          .run(copyAttemptMax).changes);
      }
    }
    n.exec('DETACH DATABASE o');
    return { sessions, attempts };
  } finally { n.close(); }
}

/* What came WITH a copy, read from the fresh file BEFORE this standby's own
   sign-ins are carried into it — read afterwards, the carried ones would be
   taken for the copy's at the next swap and dropped (the first version did
   exactly that; tools/always-on/standby.mjs caught it). */
function readCopy(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    return {
      tokens: new Set(d.prepare('SELECT token FROM sessions').all().map((r) => r.token)),
      attemptMax: Number(d.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM login_attempts').get().m)
    };
  } finally { d.close(); }
}

function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { return renameSync(from, to); } catch (e) {
      if (i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
}

/* One fetch-check-swap. Never throws; the standby goes on serving the copy it
   has whenever anything here fails. */
export async function refresh() {
  if (state.busy) return { ok: false, code: 'busy' };
  /* A COPY NEVER OVERWRITES WORK THAT HAS NOT BEEN SENT. Sales taken here
     while the line was down live in og.db until the main server has them. */
  if (Outbox.holdsCopy()) return { ok: false, code: 'holds' };
  state.busy = true;
  state.lastTry = DB.nowIso();
  const cur = dbFile();
  const next = cur + '.next';
  const prev = cur + '.prev';
  try {
    try { rmSync(next, { force: true }); } catch { /* none */ }
    const got = await fetchCopy(next);
    state.reachable = !!got.reached;
    if (!got.ok) { state.lastError = got.code; return got; }

    const v = Backup.verify(next);
    if (!v.ok) { state.lastError = 'bad_copy'; rmSync(next, { force: true }); return { ok: false, code: 'bad_copy', why: v.reason }; }

    /* Asked again at the last moment: a sale can have been rung up here
       while the copy was downloading. Everything from here to the swap is
       synchronous, so nothing can slip in after this. */
    if (Outbox.holdsCopy()) { rmSync(next, { force: true }); return { ok: false, code: 'holds' }; }

    const fresh = readCopy(next);
    const carried = carryLocal(next, cur);

    /* The swap itself is synchronous: no request can land between the close
       and the open, because nothing else runs on this thread meanwhile. */
    DB.close();
    try {
      rmSync(prev, { force: true });
      for (const s of ['-wal', '-shm']) rmSync(cur + s, { force: true });
      if (existsSync(cur)) renameRetry(cur, prev);
      renameRetry(next, cur);
      DB.open(cur);
    } catch (e) {
      /* Put the last good copy back rather than serve nothing. */
      try { DB.close(); } catch { /* not open */ }
      try { if (existsSync(prev)) { rmSync(cur, { force: true }); renameRetry(prev, cur); } } catch { /* stuck */ }
      DB.open(cur);
      state.lastError = 'swap_failed';
      return { ok: false, code: 'swap_failed', why: e.message };
    }
    Auth.invalidatePermissions();
    copyTokens = fresh.tokens;
    copyAttemptMax = fresh.attemptMax;
    state.copyAt = got.copyAt || DB.nowIso();
    state.tookAt = DB.nowIso();
    state.lastError = null;
    state.swaps++;
    saveState();
    return { ok: true, copyAt: state.copyAt, carried };
  } catch (e) {
    state.lastError = 'failed';
    return { ok: false, code: 'failed', why: e.message };
  } finally {
    state.busy = false;
  }
}

/* ---- asking whether the main server is there ------------------------------ */
async function probe() {
  const r = await upstreamJson('GET', '/api/health', undefined, 5000);
  return !!(r.ok && r.json && r.json.ok);
}

let sending = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref());

/* THE LINE IS BACK: send what was done here, oldest first, through the main
   server's own routes; then — and only once nothing is left to send — take a
   fresh copy and go back to following. A refused entry is kept for a person
   and does not stop the rest. */
async function sendLoop(log) {
  if (sending) return;
  sending = true;
  state.sentLast = 0;
  try {
    while (state.mode === 'sending' || state.mode === 'closing') {
      const batch = Outbox.batch(20);
      if (!batch.length) {
        if (Outbox.holdsCopy()) { await sleep(1000); continue; }   // a write still being taken
        state.mode = 'closing';
        const r = await refresh();
        if (r.ok) {
          Outbox.afterSwap();
          state.mode = 'following';
          state.backAt = DB.nowIso();
          state.offlineSince = null;
          log(`  [standby] back to following — ${state.sentLast} change(s) sent, fresh copy as of ${r.copyAt}`);
          break;
        }
        state.mode = 'sending';
        if (r.code !== 'holds') await sleep(PROBE_MS());
        continue;
      }
      const res = await upstreamJson('POST', '/api/copy/replay', { holder: holder(), entries: batch }, 60000);
      if (!res.ok || !res.json || !Array.isArray(res.json.results)) {
        log(`  [standby] could not send: ${res.code || ('HTTP ' + res.status)} — will try again`);
        await sleep(PROBE_MS());
        continue;
      }
      let stop = false;
      for (const r of res.json.results) {
        if (stop) break;
        if (r.status >= 200 && r.status < 300) { Outbox.markSent(r.uuid, r.body); state.sentLast++; }
        else if (r.status >= 500) stop = true;                     // the main server's trouble — try again
        else Outbox.markRefused(r.uuid, r.body && r.body.code, r.body && r.body.error);
      }
      if (stop) await sleep(PROBE_MS());
    }
  } finally {
    sending = false;
  }
}

async function probeTick(log) {
  const ok = await probe();
  const now = Date.now();
  state.reachable = ok;
  if (ok) { state.downSince = null; if (state.upSince == null) state.upSince = now; }
  else { state.upSince = null; if (state.downSince == null) state.downSince = now; }

  if (state.mode === 'following' && !ok && now - state.downSince >= DOWN_MS()) {
    state.mode = 'offline';
    state.offlineSince = DB.nowIso();
    log('  [standby] the main server has not answered for ' + Math.round((now - state.downSince) / 1000) +
      ' s — taking the till\'s sales here and keeping a list to send');
  } else if (state.mode === 'offline' && ok && now - state.upSince >= UP_MS()) {
    state.mode = 'sending';
    log(`  [standby] the main server is back — sending ${Outbox.counts().waiting} change(s)`);
    sendLoop(log);
  } else if ((state.mode === 'sending' || state.mode === 'closing') && !ok) {
    state.mode = 'offline';
    log('  [standby] the line dropped again while sending — waiting for it');
  }
}

/* The standby's own loop. The first copy is fetched straight away; a standby
   with no copy at all serves an empty shop, which says "no copy yet" rather
   than pretending. */
export function start(log = console.log, opts = {}) {
  if (!isStandby()) return;
  if (typeof opts.localUrls === 'function') localUrls = opts.localUrls;
  loadState();
  /* After a restart nothing is known to be local — see copyTokens. */
  copyTokens = null;
  copyAttemptMax = null;

  /* A laptop that stopped with work not yet sent starts OFFLINE, so it
     neither takes a copy over that work nor turns the till away. */
  const found = Outbox.recover((opId) => {
    const r = DB.get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    try { return r ? JSON.parse(r.result) : null; } catch { return null; }
  });
  if (found.unsure) log(`  [standby] ${found.unsure} change(s) were being saved when the laptop stopped — listed for a person`);
  state.mode = Outbox.holdsCopy() ? 'offline' : 'following';
  if (state.mode === 'offline') {
    state.offlineSince = state.offlineSince || DB.nowIso();
    log(`  [standby] ${Outbox.counts().waiting} change(s) from the last outage are still to send`);
  }

  const tick = async () => {
    if (state.mode !== 'following') return;
    const r = await refresh();
    if (r.ok) log(`  [standby] copy of ${process.env.OG_UPSTREAM} as of ${r.copyAt}` +
      (r.carried && (r.carried.sessions || r.carried.attempts) ? ` (kept ${r.carried.sessions} sign-in(s) made here)` : ''));
    else if (r.code !== 'busy' && r.code !== 'holds') log(`  [standby] no fresh copy: ${r.code}${r.why ? ' — ' + r.why : ''}; still serving the one from ${state.copyAt || 'nowhere yet'}`);
  };
  tick();
  timer = setInterval(tick, everyMs());
  timer.unref();

  let probing = false;
  probeTimer = setInterval(async () => {
    if (probing) return;
    probing = true;
    try { await probeTick(log); } finally { probing = false; }
  }, PROBE_MS());
  probeTimer.unref();
}
let probeTimer = null;

export function stop() {
  if (timer) clearInterval(timer);
  if (probeTimer) clearInterval(probeTimer);
  timer = null; probeTimer = null;
  state.mode = 'stopped';
  Outbox.close();
}

/* The one sentence a refused write carries, in English; the app shows its
   own words for the code (err_standby_read_only / err_needs_internet). */
export function readOnlyMessage() {
  if (takesWrites()) {
    return 'This needs the internet. The till works offline; this does not yet — it opens again when the line is back.';
  }
  if (state.mode === 'closing') {
    return 'The internet is back and the shop is switching to the main server — try again in a moment, there.';
  }
  return 'This is the standby copy' + (state.copyAt ? ' (as of ' + state.copyAt + ')' : '') +
    ' — it is read-only. Changes are made on the main server.';
}
