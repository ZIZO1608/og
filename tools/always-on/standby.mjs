#!/usr/bin/env node
/* ==========================================================================
   The main server and its standby, for real.   node tools/always-on/standby.mjs

   Two actual OG servers (server/index.js) on this machine, each on its own
   free port and its own throwaway data folder, with an empty env file (no
   Supabase, no Telegram, no push): one the MAIN server handing out copies,
   one a STANDBY following it every 2 seconds. Checked over HTTP and in the
   files themselves. Nothing real is read or written.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer } from 'node:net';
import { createServer as httpServer, request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'server');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const freePort = () => new Promise((ok) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function until(fn, ms, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(step); }
  return !!(await fn());
}

const TMP = mkdtempSync(join(tmpdir(), 'og-standby-'));
const ENV = join(TMP, 'empty.env');
writeFileSync(ENV, '');
const KEY = 'standby-test-copy-key-' + Date.now();
const MAIN_DATA = join(TMP, 'main');
const STBY_DATA = join(TMP, 'standby');

/* ---- an owner on the main server's database, the way createuser makes one */
const seed = spawn(process.execPath, ['--input-type=module', '-e', `
  import * as DB from './lib/db.js';
  import * as Auth from './lib/auth.js';
  import { dbFile } from './lib/env.js';
  DB.open(dbFile());
  await Auth.createUser({ username: 'owner1', name: 'Test Owner', role: 'owner', password: 'correct-horse-9' });
  DB.close();
`], { cwd: SERVER, env: { ...process.env, OG_ENV_FILE: ENV, OG_DATA_DIR: MAIN_DATA }, stdio: 'inherit' });
await new Promise((ok) => seed.on('exit', ok));

const MAIN = await freePort();
const STBY = await freePort();
const procs = {};
const out = { main: '', standby: '' };
function startServer(name, port, extra) {
  const p = spawn(process.execPath, ['index.js'], {
    cwd: SERVER, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: {
      ...process.env, OG_ENV_FILE: ENV, OG_PORT: String(port), OG_HTTPS: '0', OG_SYNC_MINUTES: '0',
      OG_PUSH: '0', OG_TELEGRAM_TOKEN_OG: '', OG_TELEGRAM_TOKEN_YALLA: '', FORCE_COLOR: '0', ...extra
    }
  });
  p.stdout.on('data', (b) => { out[name] += b; });
  p.stderr.on('data', (b) => { out[name] += b; });
  procs[name] = p;
  return p;
}
const startMain = () => startServer('main', MAIN, { OG_DATA_DIR: MAIN_DATA, OG_COPY_KEY: KEY, OG_PROXY_ADDR: '127.0.0.1' });

/* ---- HTTP ------------------------------------------------------------------ */
function http(port, method, path, { body, cookie, headers = {}, raw = false } = {}) {
  return new Promise((ok) => {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    if (method !== 'GET') h.Origin = `http://127.0.0.1:${port}`;
    const r = request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        if (!raw) { try { json = JSON.parse(buf.toString('utf8')); } catch { json = null; } }
        ok({ status: res.statusCode, headers: res.headers, json, buf });
      });
    });
    r.on('error', (e) => ok({ status: 0, error: e.message }));
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}
async function signIn(port) {
  const r = await http(port, 'POST', '/api/auth/login', { body: { username: 'owner1', password: 'correct-horse-9' } });
  const c = [].concat(r.headers['set-cookie'] || []).find((x) => x.startsWith('og_session='));
  return { status: r.status, cookie: c ? c.split(';')[0] : null };
}
const health = async (port) => (await http(port, 'GET', '/api/health')).json;

try {
  startMain();
  check('the main server starts', await until(async () => (await http(MAIN, 'GET', '/api/health')).status === 200, 20000), out.main.slice(-400));

  /* ---- the copy door ---- */
  const bearer = { Authorization: 'Bearer ' + KEY };
  check('no key: 401', (await http(MAIN, 'GET', '/api/copy/db', { raw: true })).status === 401);
  check('a wrong key: 401', (await http(MAIN, 'GET', '/api/copy/db', { raw: true, headers: { Authorization: 'Bearer nope' } })).status === 401);
  const visitor = await http(MAIN, 'GET', '/api/copy/db', { raw: true, headers: { ...bearer, 'X-OG-Client-IP': '203.0.113.7' } });
  check('the right key from a visitor the public proxy carried: 404, as if there were nothing', visitor.status === 404);
  const copy = await http(MAIN, 'GET', '/api/copy/db', { raw: true, headers: bearer });
  check('the right key over the private road: 200, a SQLite file, whole',
    copy.status === 200 && copy.buf.subarray(0, 15).toString() === 'SQLite format 3' && copy.buf.length === Number(copy.headers['content-length']),
    copy.status + ' ' + copy.buf.length);
  check('…stamped with when it was taken', !!copy.headers['x-og-copy-at']);
  const f = join(TMP, 'got.db');
  writeFileSync(f, copy.buf);
  const g = new DatabaseSync(f, { readOnly: true });
  check('…which opens, passes integrity_check, and holds the owner', g.prepare('PRAGMA integrity_check').get().integrity_check === 'ok' &&
    g.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'owner1'").get().n === 1);
  g.close();

  /* ---- the standby ---- */
  startServer('standby', STBY, { OG_ROLE: 'standby', OG_UPSTREAM: `http://127.0.0.1:${MAIN}`, OG_COPY_KEY: KEY,
    OG_STANDBY_EVERY_MS: '2000', OG_DATA_DIR: STBY_DATA });
  check('the standby starts', await until(async () => (await http(STBY, 'GET', '/api/health')).status === 200, 20000), out.standby.slice(-400));
  check('it says what it is: role standby, with the time of its copy',
    await until(async () => { const h = await health(STBY); return h && h.role === 'standby' && h.standby && h.standby.copyAt; }, 10000),
    JSON.stringify(await health(STBY)));
  check('the main server says it is the main one', (await health(MAIN)).role === 'primary');
  check('the standby printed its notice, and started none of the workers',
    /STANDBY: a read-only copy/.test(out.standby) && !/\[mirror\]|\[sync\]|Telegram:|Web Push:/.test(out.standby), out.standby.slice(0, 600));
  check('it hands out no copy of its own (404)', (await http(STBY, 'GET', '/api/copy/db', { raw: true, headers: bearer })).status === 404);

  const s1 = await signIn(STBY);
  check('signing in to the standby works', s1.status === 200 && !!s1.cookie, String(s1.status));
  check('…and it reads the shop', (await http(STBY, 'GET', '/api/auth/me', { cookie: s1.cookie })).status === 200);

  const custBefore = (await http(STBY, 'GET', '/api/customers', { cookie: s1.cookie })).json;
  const w = await http(STBY, 'POST', '/api/customers', { cookie: s1.cookie, body: { name: 'Written on the standby', phone: '0933000111' } });
  check('a write to the standby is refused: 503 standby_read_only', w.status === 503 && w.json && w.json.code === 'standby_read_only', JSON.stringify(w.json));
  const custAfter = (await http(STBY, 'GET', '/api/customers', { cookie: s1.cookie })).json;
  check('…and nothing was written', JSON.stringify(custAfter.customers || custAfter.rows || custAfter) === JSON.stringify(custBefore.customers || custBefore.rows || custBefore));
  check('a customer\'s review sent to the standby is refused too',
    (await http(STBY, 'POST', '/i/' + 'a'.repeat(32) + '/review', { body: { stars: 5 } })).status === 503);

  /* ---- it follows the main server ---- */
  const m1 = await signIn(MAIN);
  const made = await http(MAIN, 'POST', '/api/customers', { cookie: m1.cookie, body: { name: 'Nour Followed', phone: '0933123456' } });
  check('a customer is added on the main server', made.status === 200, JSON.stringify(made.json).slice(0, 200));
  const copyAt1 = (await health(STBY)).standby.copyAt;
  check('…and appears on the standby within a couple of copies',
    await until(async () => JSON.stringify((await http(STBY, 'GET', '/api/customers', { cookie: s1.cookie })).json || '').includes('Nour Followed'), 10000));
  check('the standby\'s copy time moved on', (await health(STBY)).standby.copyAt !== copyAt1);
  check('the sign-in made ON the standby survived the swaps', (await http(STBY, 'GET', '/api/auth/me', { cookie: s1.cookie })).status === 200);

  /* ---- a sign-in the main server revokes does not live on in the standby ---- */
  check('a main-server session arrives with the copy (same token works on the standby)',
    await until(async () => (await http(STBY, 'GET', '/api/auth/me', { cookie: m1.cookie })).status === 200, 8000));
  await http(MAIN, 'POST', '/api/auth/logout', { cookie: m1.cookie, body: {} });
  check('signed out on the main server, it is gone from the standby after the next copy',
    await until(async () => (await http(STBY, 'GET', '/api/auth/me', { cookie: m1.cookie })).status === 401, 10000));
  check('…while the standby\'s own sign-in is still good', (await http(STBY, 'GET', '/api/auth/me', { cookie: s1.cookie })).status === 200);

  /* ---- the main server goes away ---- */
  procs.main.kill();
  await until(async () => (await http(MAIN, 'GET', '/api/health')).status === 0, 5000);
  check('with the main server gone, the standby still answers and still reads',
    (await http(STBY, 'GET', '/api/customers', { cookie: s1.cookie })).status === 200);
  check('…and says it has lost the main server', await until(async () => (await health(STBY)).standby.reachable === false, 8000));
  const lostAt = (await health(STBY)).standby.copyAt;
  startMain();
  check('the main server comes back, and the standby picks up again',
    await until(async () => { const h = await health(STBY); return h.standby.reachable === true && h.standby.copyAt !== lostAt; }, 20000));

  /* ---- a broken copy is never swapped in ---- */
  const junk = httpServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3' }); res.end('this is not a database'); });
  const JUNK = await freePort();
  await new Promise((ok) => junk.listen(JUNK, '127.0.0.1', ok));
  const J2 = await freePort();
  startServer('junk', J2, { OG_ROLE: 'standby', OG_UPSTREAM: `http://127.0.0.1:${JUNK}`, OG_COPY_KEY: KEY,
    OG_STANDBY_EVERY_MS: '1500', OG_DATA_DIR: join(TMP, 'junk') });
  out.junk = '';
  procs.junk.stdout.on('data', (b) => { out.junk += b; });
  check('a standby fed garbage refuses it and says why', await until(() => /no fresh copy: bad_copy/.test(out.junk), 15000), out.junk.slice(-300));
  check('…and serves no pretend copy (copyAt stays empty)', !(await health(J2)).standby.copyAt);
  procs.junk.kill();
  junk.close();

  /* ---- over HTTPS, trusting ONE certificate, checked by NAME -------------
     The real road: the laptop's self-signed certificate (npm run cert, which
     names og-till), pinned on the standby with OG_UPSTREAM_CA and checked
     against OG_UPSTREAM_NAME — never against the address it was reached at. */
  const mkcert = (dir) => new Promise((ok) => spawn(process.execPath, ['scripts/make-cert.js'], {
    cwd: SERVER, stdio: 'ignore', windowsHide: true, env: { ...process.env, OG_ENV_FILE: ENV, OG_DATA_DIR: dir }
  }).on('exit', ok));
  const H_DATA = join(TMP, 'https-main');
  const OTHER = join(TMP, 'other-cert');
  const made1 = await mkcert(H_DATA);
  const made2 = await mkcert(OTHER);
  check('two self-signed certificates made (npm run cert)', made1 === 0 && made2 === 0, made1 + ' ' + made2);
  const HP = await freePort();
  startServer('hmain', await freePort(), { OG_DATA_DIR: H_DATA, OG_COPY_KEY: KEY, OG_HTTPS: '', OG_HTTPS_PORT: String(HP) });
  const https = async (extra, name) => {
    const port = await freePort();
    startServer(name, port, { OG_ROLE: 'standby', OG_UPSTREAM: `https://127.0.0.1:${HP}`, OG_COPY_KEY: KEY,
      OG_STANDBY_EVERY_MS: '1500', OG_DATA_DIR: join(TMP, name), ...extra });
    await until(async () => (await http(port, 'GET', '/api/health')).status === 200, 20000);
    return port;
  };
  const CA = join(H_DATA, 'certs', 'og-cert.pem');
  const good = await https({ OG_UPSTREAM_CA: CA, OG_UPSTREAM_NAME: 'og-till' }, 'pinned');
  check('the main server\'s own certificate, checked as og-till: the copy arrives',
    await until(async () => !!(await health(good)).standby.copyAt, 15000), out.pinned.slice(-300));
  const wrongCa = await https({ OG_UPSTREAM_CA: join(OTHER, 'certs', 'og-cert.pem'), OG_UPSTREAM_NAME: 'og-till' }, 'wrongca');
  const noCa = await https({}, 'noca');
  const wrongName = await https({ OG_UPSTREAM_CA: CA, OG_UPSTREAM_NAME: 'not-the-till' }, 'wrongname');
  await sleep(5000);
  check('a DIFFERENT certificate (someone else on the road): no copy', !(await health(wrongCa)).standby.copyAt, out.wrongca.slice(-200));
  check('no certificate pinned: a self-signed one is not trusted, no copy', !(await health(noCa)).standby.copyAt);
  check('the right certificate under the wrong name: no copy', !(await health(wrongName)).standby.copyAt);

  /* ---- a copy that is ONLY a copy (OG_STANDBY_OFFLINE=0) --------------------
     The VPS following the laptop before the switch: it must never take the
     till when the laptop goes quiet, borrow invoice numbers, or tell the
     laptop's page that ITS addresses are "the shop laptop". */
  const PC = await freePort();
  startServer('purecopy', PC, { OG_ROLE: 'standby', OG_UPSTREAM: `http://127.0.0.1:${MAIN}`, OG_COPY_KEY: KEY,
    OG_STANDBY_ID: 'pure-copy', OG_STANDBY_OFFLINE: '0', OG_STANDBY_EVERY_MS: '1500',
    OG_STANDBY_PROBE_MS: '300', OG_STANDBY_DOWN_MS: '800', OG_DATA_DIR: join(TMP, 'purecopy') });
  check('a pure copy takes its copy', await until(async () => {
    const h = (await http(PC, 'GET', '/api/health')).json; return !!(h && h.standby && h.standby.copyAt); }, 20000), (out.purecopy || '').slice(-300));
  const mainDb = new DatabaseSync(join(MAIN_DATA, 'og.db'), { readOnly: true });
  const lent = mainDb.prepare('SELECT holder FROM id_loans').all().map((r) => r.holder);
  const seenAt = mainDb.prepare('SELECT holder FROM standby_seen').all().map((r) => r.holder);
  mainDb.close();
  check('…borrows no invoice numbers (the standby that sells offline does)', !lent.includes('pure-copy') && lent.length > 0, JSON.stringify(lent));
  check('…and announces no addresses to the main server', !seenAt.includes('pure-copy'), JSON.stringify(seenAt));
  procs.main.kill();
  await sleep(3000);
  const ph = (await http(PC, 'GET', '/api/health')).json.standby;
  check('with its main server gone, a pure copy stays a read-only copy', ph.mode === 'following' && ph.reachable === false, JSON.stringify(ph));
} finally {
  for (const p of Object.values(procs)) { try { p.kill(); } catch { /* gone */ } }
  await sleep(800);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a file still held on Windows */ }
}
console.log(`\nstandby: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
