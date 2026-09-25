#!/usr/bin/env node
/* ==========================================================================
   What people see through an outage.         node tools/always-on/offline-ui.mjs

   The rig of offline.mjs (a MAIN server, a LINE this script can cut, the shop
   LAPTOP following it) with headless Chrome on both sides:

   THE LAPTOP'S PAGE — the strip across the top through all four moods
   (following · offline with the count · sending · back, with the way home),
   in English at 1100 and Arabic at 390; a write the till cannot do offline
   refused in the screen's language; a sale the main server refused listed for
   a person, pressed open and put away, read back from the laptop's outbox.

   THE DOMAIN'S PAGE — it remembers where the shop laptop answers; when MAIN
   goes silent it waits out the patience rule and then covers itself with
   "Continue on the shop laptop", pointing at the laptop's own address; "Keep
   waiting" puts the cover away; MAIN answering again takes it down.

   Every press is a real pointer event on the middle of what is painted.
   Photographs into _handover/always-on/.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer, connect } from 'node:net';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'server');
const OUT = join(ROOT, '_handover', 'always-on');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + String(detail).slice(0, 400) : '')); }
};
const freePort = () => new Promise((ok) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function until(fn, ms, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(step); }
  return !!(await fn());
}

const TMP = mkdtempSync(join(tmpdir(), 'og-offline-ui-'));
const ENV = join(TMP, 'empty.env');
writeFileSync(ENV, '');
const KEY = 'offline-ui-key-' + Date.now();
const MAIN_DATA = join(TMP, 'main');
const LAP_DATA = join(TMP, 'laptop');

const seed = spawn(process.execPath, ['--input-type=module', '-e', `
  import * as DB from './lib/db.js';
  import * as Auth from './lib/auth.js';
  import * as Cat from './lib/catalogue.js';
  import { dbFile } from './lib/env.js';
  const d = DB.open(dbFile());
  await Auth.createUser({ username: 'owner1', name: 'Test Owner', role: 'owner', password: 'correct-horse-9' });
  await Auth.createUser({ username: 'cash1', name: 'Lubna Test', role: 'cashier', password: 'correct-horse-8' });
  const uid = d.prepare("SELECT id FROM users WHERE username = 'owner1'").get().id;
  Cat.createWithVariants({ name: 'Test Shoe', type: 'sneakers', currency: 'USD', costPrice: 7700, sellingPrice: 34600,   /* 067: prices are dollars (cents) */
    sizes: [{ size: '42', qty: 20 }], whId: 'store', userId: uid });
  DB.close();
`], { cwd: SERVER, env: { ...process.env, OG_ENV_FILE: ENV, OG_DATA_DIR: MAIN_DATA }, stdio: 'inherit' });
await new Promise((ok) => seed.on('exit', ok));
const SKU = (() => { const d = new DatabaseSync(join(MAIN_DATA, 'og.db'), { readOnly: true }); try { return d.prepare('SELECT sku FROM variants LIMIT 1').get().sku; } finally { d.close(); } })();

const MAIN = await freePort();
const LINE = await freePort();
const LAP = await freePort();
let cut = false;
const live = new Set();
const relay = netServer((a) => {
  if (cut) return a.destroy();
  const b = connect(MAIN, '127.0.0.1');
  live.add(a); live.add(b);
  a.pipe(b); b.pipe(a);
  const end = () => { a.destroy(); b.destroy(); live.delete(a); live.delete(b); };
  a.on('error', end); b.on('error', end); a.on('close', end); b.on('close', end);
});
await new Promise((ok) => relay.listen(LINE, '127.0.0.1', ok));
const cutLine = () => { cut = true; for (const s of live) s.destroy(); live.clear(); };
const mendLine = () => { cut = false; };

const procs = {};
const common = { OG_ENV_FILE: ENV, OG_HTTPS: '0', OG_SYNC_MINUTES: '0', OG_PUSH: '0', OG_PULL_AT_BOOT: '0',
  OG_TELEGRAM_TOKEN_OG: '', OG_TELEGRAM_TOKEN_YALLA: '' };
function start(name, port, extra) {
  procs[name] = spawn(process.execPath, ['index.js'], { cwd: SERVER, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ...common, OG_PORT: String(port), ...extra } });
}
const startMain = () => start('main', MAIN, { OG_DATA_DIR: MAIN_DATA, OG_COPY_KEY: KEY });
startMain();
start('laptop', LAP, {
  OG_DATA_DIR: LAP_DATA, OG_ROLE: 'standby', OG_UPSTREAM: `http://127.0.0.1:${LINE}`, OG_COPY_KEY: KEY,
  OG_STANDBY_ID: 'test-laptop', OG_STANDBY_EVERY_MS: '2000', OG_STANDBY_PROBE_MS: '400',
  OG_STANDBY_DOWN_MS: '1500', OG_STANDBY_UP_MS: '2500', OG_STANDBY_HOME: 'https://shop.example.test'
});

function http(port, method, path, { body, cookie } = {}) {
  return new Promise((ok) => {
    const h = {};
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    if (method !== 'GET') h.Origin = `http://127.0.0.1:${port}`;
    const r = request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* */ } ok({ status: res.statusCode, headers: res.headers, json: j }); });
    });
    r.on('error', (e) => ok({ status: 0, error: e.message }));
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}
async function signIn(port, user, pw) {
  const r = await http(port, 'POST', '/api/auth/login', { body: { username: user, password: pw } });
  const c = [].concat(r.headers['set-cookie'] || []).find((x) => x.startsWith('og_session='));
  return c ? c.split(';')[0] : null;
}
const lap = async () => ((await http(LAP, 'GET', '/api/health')).json || {}).standby || {};

/* ---- headless Chrome ------------------------------------------------------- */
const profile = join(TMP, 'chrome');
procs.chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let dport = null;
for (let i = 0; i < 100 && !dport; i++) {
  await sleep(100);
  const f = join(profile, 'DevToolsActivePort');
  if (existsSync(f)) dport = Number(readFileSync(f, 'utf8').split('\n')[0]);
}
const target = await (await fetch(`http://127.0.0.1:${dport}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let id = 0;
const waiting = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
  const w = msg.id && waiting.get(msg.id);
  if (w) { waiting.delete(msg.id); msg.error ? w.bad(new Error(msg.error.message)) : w.ok(msg.result); }
};
const send = (method, params = {}) => new Promise((ok, bad) => { const i = ++id; waiting.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
async function waitFor(expr, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(150); }
  return false;
}
async function press(sel) {
  const at = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { err: 'missing' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return (hit === el || el.contains(hit)) ? { x, y, h: r.height } : { err: 'covered by ' + (hit ? hit.outerHTML.slice(0, 90) : 'nothing') };
  })()`);
  if (at.err) throw new Error(sel + ': ' + at.err);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  }
  return at;
}
const shot = async (file) => writeFileSync(join(OUT, file), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const strip = () => evaluate(`(() => { const s = document.getElementById('standbyStrip'); if (!s) return null;
  const r = s.getBoundingClientRect(); return { cls: s.className, text: s.innerText, h: r.height,
  go: (s.querySelector('.sb-go') || {}).href || null, need: !!s.querySelector('.sb-need') }; })()`);
const pageLogin = (u, pw) => evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: '${u}', password: '${pw}' }) }).then(r => r.status)`);
const pageSale = () => evaluate(`fetch('/api/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ lines: [{ sku: '${SKU}', qty: 1 }], whId: 'store', payment: 'cash', opId: '${randomUUID()}' }) }).then(r => r.status)`);

try {
  await until(async () => (await http(MAIN, 'GET', '/api/health')).status === 200, 20000);
  check('the laptop has its first copy', await until(async () => !!(await lap()).copyAt, 20000));
  await send('Page.enable');
  await send('Runtime.enable');

  /* ================= the laptop's page ================= */
  const LAPURL = `http://127.0.0.1:${LAP}`;
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: LAPURL + '/' });
  await waitFor("document.readyState === 'complete'");
  await evaluate("localStorage.setItem('og.lang', 'en'); true");
  check('the cashier signs in on the laptop', (await pageLogin('cash1', 'correct-horse-8')) === 200);
  await send('Page.navigate', { url: LAPURL + '/?r=1#dashboard' });
  await waitFor("!document.getElementById('bootSplash') && !!document.getElementById('standbyStrip')", 20000);
  let s = await strip();
  check('[following] the strip says read-only copy, as of a time', s && /is-following/.test(s.cls) && /Standby copy, read only/.test(s.text), JSON.stringify(s));
  check('[following] …with the way back to the domain', s && s.go === 'https://shop.example.test/', JSON.stringify(s));

  cutLine();
  check('[offline] the page notices the outage by itself',
    await waitFor("(document.getElementById('standbyStrip') || {}).className === 'standby-strip is-offline'", 40000), JSON.stringify(await strip()));
  check('[offline] a till sale goes through on the laptop', (await pageSale()) === 200);
  check('[offline] …and a second', (await pageSale()) === 200);
  check('[offline] the strip counts what is waiting',
    await waitFor("/2 changes waiting for the internet/.test((document.getElementById('standbyStrip') || {}).innerText || '')", 8000), JSON.stringify(await strip()));
  const refusal = await evaluate(`API.put('/api/config', { updates: { 'shop.name': 'x' } }).then(() => 'went', (e) => API.friendly(e))`);
  check('[offline] anything else is refused in words', /needs the internet/.test(refusal), refusal);
  await shot('offline-strip-en-1100.png');

  /* Arabic, on a phone. */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("localStorage.setItem('og.lang', 'ar'); true");
  await send('Page.navigate', { url: LAPURL + '/?r=2#dashboard' });
  await waitFor("!document.getElementById('bootSplash') && !!document.getElementById('standbyStrip')", 20000);
  s = await strip();
  check('[offline ar] the strip in Arabic, with the count', s && /أوفلاين/.test(s.text) && /2/.test(s.text), JSON.stringify(s));
  check('[offline ar] a thumb-high strip on a phone (44px)', s && Math.round(s.h) === 44, JSON.stringify(s));
  check('[offline ar] nothing scrolls sideways', await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
  const ar = await evaluate(`API.put('/api/config', { updates: { 'shop.name': 'x' } }).then(() => 'went', (e) => API.friendly(e))`);
  check('[offline ar] the refusal in Arabic', /إنترنت/.test(ar), ar);
  check('[offline ar] no raw key on the strip', !/sb_|\{n\}/.test(s.text));
  await shot('offline-strip-ar-390.png');

  /* The owner switches the cashier off on MAIN meanwhile: one more sale by her will be refused there. */
  const ownerMain = await signIn(MAIN, 'owner1', 'correct-horse-9');
  const cashId = (() => { const d = new DatabaseSync(join(MAIN_DATA, 'og.db'), { readOnly: true }); try { return d.prepare("SELECT id FROM users WHERE username='cash1'").get().id; } finally { d.close(); } })();
  check('[offline] a third sale', (await pageSale()) === 200);
  await http(MAIN, 'POST', `/api/users/${cashId}/active`, { cookie: ownerMain, body: { active: false } });

  mendLine();
  check('[sending→back] the strip goes green: all sent, with the way home',
    await waitFor("/is-back/.test((document.getElementById('standbyStrip') || {}).className)", 30000), JSON.stringify(await strip()));
  s = await strip();
  check('[back ar] "all sent" in Arabic, and the link home', /انبعت كل شي/.test(s.text) && s.go === 'https://shop.example.test/', JSON.stringify(s));
  await shot('offline-back-ar-390.png');

  /* The owner, on the laptop, deals with what MAIN refused. */
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
  await evaluate("localStorage.setItem('og.lang', 'en'); true");
  check('the owner signs in on the laptop', (await pageLogin('owner1', 'correct-horse-9')) === 200);
  await send('Page.navigate', { url: LAPURL + '/?r=3#dashboard' });
  await waitFor("!document.getElementById('bootSplash') && !!document.getElementById('standbyStrip')", 20000);
  check('the strip offers "3 need a person" to somebody who may void',
    await waitFor("!!document.querySelector('#standbyStrip .sb-need')", 8000) && /3 need a person/.test((await strip()).text), JSON.stringify(await strip()));
  await press('#standbyStrip .sb-need');
  check('pressing it opens the list, one row per refused sale',
    await waitFor("document.querySelectorAll('.ob-row').length === 3", 6000), await evaluate("(document.querySelector('.modal') || {}).innerText || ''"));
  const row = await evaluate("document.querySelector('.ob-row').innerText");
  check('…naming the sale, who made it, and the main server\'s reason', /INV-\d+/.test(row) && /Lubna Test/.test(row) && /Refused/.test(row), row);
  await shot('offline-list-en-1100.png');
  await press('.ob-row [data-act="sb-dismiss"]');
  check('"Put away" takes one off the list', await waitFor("document.querySelectorAll('.ob-row').length === 2", 6000));
  const obDb = new DatabaseSync(join(LAP_DATA, 'outbox.db'), { readOnly: true });
  const states = obDb.prepare("SELECT state, COUNT(*) AS n FROM entries GROUP BY state").all();
  obDb.close();
  check('…and the laptop\'s outbox says so', JSON.stringify(states).includes('"dismissed","n":1') && JSON.stringify(states).includes('"refused","n":2'), JSON.stringify(states));

  /* ================= the domain's page ================= */
  const MAINURL = `http://127.0.0.1:${MAIN}`;
  await send('Page.navigate', { url: MAINURL + '/' });
  await waitFor("document.readyState === 'complete'");
  await evaluate("localStorage.setItem('og.lang', 'en'); true");
  check('the owner signs in on the main server', (await pageLogin('owner1', 'correct-horse-9')) === 200);
  await send('Page.navigate', { url: MAINURL + '/?r=4#dashboard' });
  await waitFor("!document.getElementById('bootSplash')", 20000);
  check('the domain\'s page remembers where the shop laptop answers',
    await waitFor(`(localStorage.getItem('og.standby.where') || '').includes(':${LAP}')`, 8000), await evaluate("localStorage.getItem('og.standby.where')"));
  check('no strip on the main server', await evaluate("!document.getElementById('standbyStrip')"));

  procs.main.kill();
  check('[silent] no cover before the patience window', await evaluate("!document.getElementById('sbCover')"));
  check('[silent] after twenty seconds of nothing, the cover',
    await waitFor("!!document.getElementById('sbCover')", 45000));
  const cov = await evaluate(`(() => { const c = document.getElementById('sbCover'); return { text: c.innerText, href: c.querySelector('.sb-cta').getAttribute('href') }; })()`);
  check('[silent] it says the main server is not answering, and how long', /not answering/.test(cov.text) && /No answer for \d+ seconds/.test(cov.text), cov.text);
  check('[silent] its button goes to the shop laptop\'s own address', new RegExp(':' + LAP + '/?$').test(cov.href), cov.href);
  await shot('cover-en-1100.png');
  await press('#sbCover [data-act="sb-wait"]');
  check('"Keep waiting" puts it away', await waitFor("!document.getElementById('sbCover')", 4000));

  startMain();
  await until(async () => (await http(MAIN, 'GET', '/api/health')).status === 200, 20000);
  check('MAIN is back', true);

  /* Arabic, on a phone: the cover again. */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("localStorage.setItem('og.lang', 'ar'); true");
  await send('Page.navigate', { url: MAINURL + '/?r=5#dashboard' });
  await waitFor("!document.getElementById('bootSplash')", 20000);
  await sleep(1500);
  procs.main.kill();
  check('[silent ar] the cover in Arabic', await waitFor("/السيرفر الرئيسي ما عم يرد/.test((document.getElementById('sbCover') || {}).innerText || '')", 45000));
  const btnH = await evaluate("document.querySelector('#sbCover .sb-cta').getBoundingClientRect().height");
  check('[silent ar] its button is a thumb high', btnH >= 44, String(btnH));
  check('[silent ar] nothing scrolls sideways', await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
  await shot('cover-ar-390.png');
  startMain();
  check('[back] MAIN answering again takes the cover down by itself',
    await waitFor("!document.getElementById('sbCover')", 40000));
  check('no script error on either page', errors.length === 0, errors.join(' | ').slice(0, 400));
} finally {
  try { ws.close(); } catch { /* gone */ }
  for (const p of Object.values(procs)) { try { p.kill(); } catch { /* gone */ } }
  relay.close();
  await sleep(800);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* held */ }
}
console.log(`\noffline-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
