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
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as DB from './db.js';
import { dbFile, dataDir } from './env.js';
import * as Backup from './backup.js';
import * as Auth from './auth.js';

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

const state = {
  upstream: null,
  copyAt: null,      // when the MAIN server took the copy now being served
  tookAt: null,      // when this standby swapped it in
  lastTry: null,
  lastError: null,   // a code, or null
  reachable: null,   // did the last fetch reach the main server
  swaps: 0,
  busy: false
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
  return {
    role: role(),
    upstream: isStandby() ? (process.env.OG_UPSTREAM || null) : undefined,
    copyAt: isStandby() ? state.copyAt : undefined,
    tookAt: isStandby() ? state.tookAt : undefined,
    reachable: isStandby() ? state.reachable : undefined,
    lastError: isStandby() ? state.lastError : undefined
  };
}

/* GET the copy into `target`. The main server's own certificate is the only
   one trusted when OG_UPSTREAM_CA names it (a self-signed laptop); a public
   one (Let's Encrypt) needs nothing. */
function fetchCopy(target) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL('/api/copy/db', process.env.OG_UPSTREAM); } catch { return resolve({ ok: false, code: 'no_upstream' }); }
    const https = url.protocol === 'https:';
    const opts = {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + (process.env.OG_COPY_KEY || '') },
      timeout: 60000
    };
    if (https && process.env.OG_UPSTREAM_CA) {
      try { opts.ca = readFileSync(process.env.OG_UPSTREAM_CA); } catch { return resolve({ ok: false, code: 'no_ca' }); }
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

/* The standby's own loop. The first copy is fetched straight away; a standby
   with no copy at all serves an empty shop, which says "no copy yet" rather
   than pretending. */
export function start(log = console.log) {
  if (!isStandby()) return;
  loadState();
  /* After a restart nothing is known to be local — see copyTokens. */
  copyTokens = null;
  copyAttemptMax = null;
  const tick = async () => {
    const r = await refresh();
    if (r.ok) log(`  [standby] copy of ${process.env.OG_UPSTREAM} as of ${r.copyAt}` +
      (r.carried && (r.carried.sessions || r.carried.attempts) ? ` (kept ${r.carried.sessions} sign-in(s) made here)` : ''));
    else if (r.code !== 'busy') log(`  [standby] no fresh copy: ${r.code}${r.why ? ' — ' + r.why : ''}; still serving the one from ${state.copyAt || 'nowhere yet'}`);
  };
  tick();
  timer = setInterval(tick, everyMs());
  timer.unref();
}

export function stop() { if (timer) clearInterval(timer); timer = null; }

/* The one sentence a refused write carries, in English; the app shows its
   own words for the code (err_standby_read_only). */
export function readOnlyMessage() {
  return 'This is the standby copy' + (state.copyAt ? ' (as of ' + state.copyAt + ')' : '') +
    ' — it is read-only. Changes are made on the main server.';
}
