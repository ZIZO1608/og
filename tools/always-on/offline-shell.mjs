#!/usr/bin/env node
/* ==========================================================================
   The app opens with the server gone.      node tools/always-on/offline-shell.mjs
   The page is served by the service worker when the server cannot be
   reached, so every file index.html loads has to be in the worker's cache
   — one missing script and the app never starts: a blank page, not the
   "Could not load the shop" card with its way to the shop's own computer.
   On 29 Sep 2026 a whole run of them came back "504 Offline" (app-state.js,
   desk.js, deliveries.js…) and the page stayed blank for as long as anybody
   watched.

   A throwaway server and a fresh headless Chrome: the FIRST visit, then the
   worker's cache compared file by file with SHELL in sw.js, then the server
   killed and the page opened again — it must reach the fail card, say it
   keeps asking, and open the shop by itself when the server is back.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer } from 'node:net';
import { request } from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'server');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + String(detail).slice(0, 600) : '')); }
};
const freePort = () => new Promise((ok) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function until(fn, ms, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(step); }
  return !!(await fn());
}

const SHELL = (() => {
  const src = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const block = src.slice(src.indexOf('var SHELL = ['), src.indexOf('];', src.indexOf('var SHELL = [')));
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
})();

const TMP = mkdtempSync(join(tmpdir(), 'og-offline-shell-'));
const ENV = join(TMP, 'empty.env');
writeFileSync(ENV, '');
const DATA = join(TMP, 'main');
const seed = spawn(process.execPath, ['--input-type=module', '-e', `
  import * as DB from './lib/db.js';
  import * as Auth from './lib/auth.js';
  import { dbFile } from './lib/env.js';
  DB.open(dbFile());
  await Auth.createUser({ username: 'owner1', name: 'Test Owner', role: 'owner', password: 'correct-horse-9' });
  DB.close();
`], { cwd: SERVER, env: { ...process.env, OG_ENV_FILE: ENV, OG_DATA_DIR: DATA }, stdio: 'inherit' });
await new Promise((ok) => seed.on('exit', ok));

const PORT = await freePort();
const procs = {};
const startMain = () => {
  procs.main = spawn(process.execPath, ['index.js'], { cwd: SERVER, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, OG_ENV_FILE: ENV, OG_DATA_DIR: DATA, OG_HTTPS: '0', OG_SYNC_MINUTES: '0', OG_PUSH: '0',
      OG_PULL_AT_BOOT: '0', OG_TELEGRAM_TOKEN_OG: '', OG_TELEGRAM_TOKEN_YALLA: '', OG_PORT: String(PORT) } });
};
const health = () => new Promise((ok) => {
  const r = request({ host: '127.0.0.1', port: PORT, path: '/api/health' }, (res) => { res.resume(); ok(res.statusCode); });
  r.on('error', () => ok(0));
  r.end();
});
startMain();

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
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const w = msg.id && waiting.get(msg.id);
  if (w) { waiting.delete(msg.id); msg.error ? w.bad(new Error(msg.error.message)) : w.ok(msg.result); }
};
const send = (method, params = {}) => new Promise((ok, bad) => { const i = ++id; waiting.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const waitFor = (expr, ms = 10000) => until(async () => { try { return !!(await evaluate(expr)); } catch { return false; } }, ms);

const URL0 = `http://127.0.0.1:${PORT}`;
try {
  await send('Page.enable');
  await send('Runtime.enable');
  check('the server is up', await until(async () => (await health()) === 200, 20000));

  /* The first visit on a device: the worker installs while the page loads. */
  await send('Page.navigate', { url: URL0 + '/' });
  check('the worker is active after the first visit',
    await waitFor("navigator.serviceWorker.ready.then(function (r) { return !!r.active; })", 30000));
  await waitFor("!!navigator.serviceWorker.controller", 15000);

  const cached = async () => JSON.parse(await evaluate(`
    caches.keys().then(function (ks) {
      var og = ks.filter(function (k) { return k.indexOf('og-system-') === 0; });
      return Promise.all(og.map(function (k) { return caches.open(k).then(function (c) { return c.keys(); }); }))
        .then(function (lists) {
          var paths = [];
          lists.forEach(function (l) { l.forEach(function (r) { paths.push(new URL(r.url).pathname.replace(/^\\//, '')); }); });
          return JSON.stringify({ names: og, paths: paths });
        });
    })`));
  /* The install caches in the background; give it the time a phone would. */
  let c = null, missing = SHELL;
  await until(async () => {
    c = await cached();
    missing = SHELL.filter((f) => f !== './' && c.paths.indexOf(f.replace(/^\.\//, '')) < 0);
    return !missing.length;
  }, 30000, 1000);
  check('one cache, named by sw.js', c.names.length === 1, JSON.stringify(c.names));
  check(`every file index.html loads is in the worker's cache (${SHELL.length})`, !missing.length, missing.join(', '));

  /* A cache with holes in it (what a 29 Sep run found). Two files the page
     never loads on an ordinary start (three.js and Chart.js are fetched only
     when the shelf map or the one chart is opened), so nothing but the
     top-up can bring them back: one visit with the server up, nobody signed
     in, and they are in the cache again. */
  const HOLES = ['js/vendor/three.min.js', 'js/vendor/chart.umd.min.js'];
  await evaluate('caches.open(' + JSON.stringify(c.names[0]) + ').then(function (cc) { return Promise.all(' + JSON.stringify(HOLES) +
    '.map(function (u) { return cc.delete(u, { ignoreSearch: true }); })); }).then(function () { return true; })');
  const holed = await cached();
  check('two files taken out of the cache', HOLES.every((h) => holed.paths.indexOf(h) < 0), holed.paths.filter((p) => /vendor/.test(p)).join(','));
  await send('Page.navigate', { url: URL0 + '/?r=1' });
  check('…one ordinary visit with the server up puts them back (the top-up)',
    await until(async () => { const x = await cached(); return HOLES.every((h) => x.paths.indexOf(h) > -1); }, 20000, 1000));

  /* The server goes away. */
  procs.main.kill();
  await until(async () => (await health()) === 0, 10000);
  await send('Page.navigate', { url: URL0 + '/?r=2#dashboard' });
  await waitFor("location.search.indexOf('r=2') > -1 && document.readyState === 'complete'", 20000);
  const failed = await evaluate(`JSON.stringify(performance.getEntriesByType('resource')
    .filter(function (e) { return e.responseStatus >= 400; }).map(function (e) { return e.name.split('/').pop() + ':' + e.responseStatus; }))`);
  /* A font subset the browser fetched before the worker was in charge is not
     in the cache; the text falls back to the next face and nothing breaks.
     Every other file must be there. */
  const broken = JSON.parse(failed).filter((x) => !/\.woff2?:/.test(x));
  check('with the server gone, no file of the app fails to load (fonts aside)', !broken.length, failed);
  check('the app itself starts (not a blank page)', await waitFor("typeof boot === 'function' && typeof Shop === 'object'", 5000));
  check('it reaches the fail card', await waitFor("!!document.querySelector('.boot-fail-card')", 30000),
    await evaluate("document.body.innerText.slice(0, 200)"));
  check('…which says it keeps asking by itself', await waitFor("/Checking again by itself/.test(document.body.innerText)", 5000),
    await evaluate("document.body.innerText.slice(0, 400)"));
  check('…with one lime button', (await evaluate("document.querySelectorAll('.boot-fail-card .btn-primary').length")) === 1);

  startMain();
  check('the shop opens by itself when the server is back',
    await waitFor("!document.querySelector('.boot-fail') && !!document.querySelector('.gate, #view')", 45000),
    await evaluate("document.body.innerText.slice(0, 200)"));

  /* The same card in Arabic, on a phone, with a shop computer to offer (a
     remembered list as the domain's page keeps it: the Wi-Fi address and
     localhost). A phone is offered the Wi-Fi address only. */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await evaluate("localStorage.setItem('og.lang', 'ar'); localStorage.setItem('og.standby.where', JSON.stringify(['https://10.10.99.9:8443', 'https://localhost:8443'])); true");
  procs.main.kill();
  await until(async () => (await health()) === 0, 10000);
  await send('Page.navigate', { url: URL0 + '/?r=3#dashboard' });
  await waitFor("location.search.indexOf('r=3') > -1 && document.readyState === 'complete'", 20000);
  check('[ar 390] the fail card, with the offer', await waitFor("!!document.querySelector('.boot-fail-card .sb-fail-offer .sb-cta')", 30000),
    await evaluate("document.body.innerText.slice(0, 300)"));
  const ar = await evaluate(`JSON.stringify((function () {
    var c = document.querySelector('.boot-fail-card'), cta = c.querySelector('.sb-cta');
    return { text: c.innerText, href: cta.getAttribute('href'), h: cta.getBoundingClientRect().height,
      dir: getComputedStyle(document.querySelector('.boot-fail')).direction,
      wide: document.documentElement.scrollWidth > window.innerWidth + 1,
      coarse: matchMedia('(pointer: coarse)').matches };
  })())`);
  const A = JSON.parse(ar);
  check('[ar 390] in Arabic, right to left', A.dir === 'rtl' && /كمبيوتر المحل/.test(A.text) && /عم نرجع نجرّب لحالنا/.test(A.text), A.text);
  check('[ar 390] no raw key on the card', !/(cv|fail)_[a-z_]+/.test(A.text), A.text);
  check('[ar 390] a phone is offered the Wi-Fi address, not localhost', A.href === 'https://10.10.99.9:8443' || !A.coarse, A.href + ' coarse=' + A.coarse);
  check('[ar 390] its button is a thumb high', A.h >= 44, String(A.h));
  check('[ar 390] nothing scrolls sideways', !A.wide);
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(ROOT, '_handover', 'always-on', 'cannot-load-ar-390.png'), Buffer.from(shot.data, 'base64'));
  } catch { /* the photograph is a courtesy */ }
} finally {
  try { ws.close(); } catch { /* gone */ }
  for (const p of Object.values(procs)) { try { p.kill(); } catch { /* gone */ } }
  await sleep(800);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* held */ }
}
console.log(`\noffline-shell: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
