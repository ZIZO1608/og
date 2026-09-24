#!/usr/bin/env node
/* ==========================================================================
   What somebody sees on the standby copy.   node tools/always-on/standby-ui.mjs

   A real main server and a real standby following it (as standby.mjs), and
   headless Chrome on the STANDBY: the strip across the top in both
   languages, the time isolated from the Arabic around it, the top bar still
   reachable under it, and a Save pressed on the copy refused in words the
   person can read — with nothing written on either server. Photographs into
   _handover/always-on/.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'server');
const OUT = join(ROOT, '_handover', 'always-on');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const freePort = () => new Promise((ok) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

const TMP = mkdtempSync(join(tmpdir(), 'og-standby-ui-'));
writeFileSync(join(TMP, 'empty.env'), '');
const KEY = 'standby-ui-key-' + Date.now();
const MAIN_DATA = join(TMP, 'main');
const STBY_DATA = join(TMP, 'standby');
const base = { ...process.env, OG_ENV_FILE: join(TMP, 'empty.env') };

const seed = spawn(process.execPath, ['--input-type=module', '-e', `
  import * as DB from './lib/db.js';
  import * as Auth from './lib/auth.js';
  import { dbFile } from './lib/env.js';
  DB.open(dbFile());
  await Auth.createUser({ username: 'owner1', name: 'Test Owner', role: 'owner', password: 'correct-horse-9' });
  DB.close();
`], { cwd: SERVER, env: { ...base, OG_DATA_DIR: MAIN_DATA }, stdio: 'inherit' });
await new Promise((ok) => seed.on('exit', ok));

const MAIN = await freePort();
const STBY = await freePort();
const procs = {};
const common = { OG_HTTPS: '0', OG_SYNC_MINUTES: '0', OG_PUSH: '0', OG_PULL_AT_BOOT: '0', OG_TELEGRAM_TOKEN_OG: '', OG_TELEGRAM_TOKEN_YALLA: '' };
procs.main = spawn(process.execPath, ['index.js'], { cwd: SERVER, stdio: 'ignore', windowsHide: true,
  env: { ...base, ...common, OG_PORT: String(MAIN), OG_DATA_DIR: MAIN_DATA, OG_COPY_KEY: KEY } });
procs.standby = spawn(process.execPath, ['index.js'], { cwd: SERVER, stdio: 'ignore', windowsHide: true,
  env: { ...base, ...common, OG_PORT: String(STBY), OG_DATA_DIR: STBY_DATA, OG_ROLE: 'standby',
    OG_UPSTREAM: `http://127.0.0.1:${MAIN}`, OG_COPY_KEY: KEY, OG_STANDBY_EVERY_MS: '2000' } });
const SB = `http://127.0.0.1:${STBY}`;
let copied = false;
for (let i = 0; i < 300 && !copied; i++) {
  try { const h = await (await fetch(SB + '/api/health')).json(); copied = !!(h.standby && h.standby.copyAt); } catch { /* not yet */ }
  if (!copied) await sleep(100);
}
check('the standby has its first copy', copied);

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
  while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(100); }
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
    return (hit === el || el.contains(hit)) ? { x, y } : { err: 'covered by ' + (hit ? hit.outerHTML.slice(0, 80) : 'nothing') };
  })()`);
  if (at.err) throw new Error(sel + ': ' + at.err);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  }
}
const phoneOf = (dir) => {
  const d = new DatabaseSync(join(dir, 'og.db'), { readOnly: true });
  const v = d.prepare("SELECT value FROM config WHERE key = 'shop.phone'").get()?.value ?? null;
  d.close();
  return v;
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: SB + '/' });
  await waitFor("document.readyState === 'complete'");
  check('the login gate already carries the strip', await waitFor("!!document.getElementById('standbyStrip')", 8000));
  const signed = await evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner1', password: 'correct-horse-9' }) }).then(r => r.status)`);
  check('signing in to the standby works', signed === 200, String(signed));

  const mainPhone = phoneOf(MAIN_DATA);
  let n = 0;
  for (const [lang, w, h] of [['en', 1100, 760], ['ar', 390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await evaluate(`localStorage.setItem('og.lang', '${lang}'); localStorage.setItem('og.settings.open', JSON.stringify(['receipt'])); true`);
    await send('Page.navigate', { url: `${SB}/?r=${++n}#settings` });
    await waitFor("!document.getElementById('bootSplash') && !!document.querySelector('[data-fold=\"receipt\"]')", 20000);
    await waitFor("!!document.getElementById('standbyStrip')", 8000);
    const strip = await evaluate(`(() => {
      const s = document.getElementById('standbyStrip'); const r = s.getBoundingClientRect();
      const b = s.querySelector('bdi');
      return { text: s.innerText, time: b ? b.textContent : null, dir: b ? b.getAttribute('dir') : null, top: r.top, bottom: r.bottom, h: r.height };
    })()`);
    check(`[${lang}] the strip says read-only, in the screen's language`,
      lang === 'en' ? /Standby copy, read only/.test(strip.text) : /نسخة احتياطية/.test(strip.text), strip.text);
    check(`[${lang}] …with the copy's time as its own left-to-right run`, /^\d\d:\d\d$/.test(strip.time || '') && strip.dir === 'ltr', JSON.stringify(strip));
    check(`[${lang}] no raw key or {at} placeholder on the strip`, !/sb_strip|\{at\}/.test(strip.text));
    const bar = await evaluate(`(() => {
      const t = document.querySelector('.topbar'); if (!t) return { err: 'no topbar' };
      const r = t.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { top: r.top, covered: !(hit === t || t.contains(hit)) };
    })()`);
    check(`[${lang}] the top bar sits below the strip and is not covered by it`, bar.top >= strip.bottom - 1 && !bar.covered, JSON.stringify({ bar, strip }));
    check(`[${lang}] nothing scrolls sideways`, await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    writeFileSync(join(OUT, `standby-strip-${lang}-${w}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

    /* A save on the copy: refused, and the person is told why. */
    if (await evaluate("document.querySelector('[data-fold=\"receipt\"]').getAttribute('data-open') !== '1'")) await press('[data-fold="receipt"] .fold-btn');
    await waitFor("document.querySelector('[data-fold=\"receipt\"]').getAttribute('data-open') === '1'");
    await evaluate(`(() => { const i = document.getElementById('rcPhone'); i.value = '0999 000 111'; return true; })()`);
    await evaluate(`(() => { const t = document.getElementById('toasts'); if (t) t.innerHTML = ''; return true; })()`);
    await press('[data-fold="receipt"] [data-act="rc-save-config"]');
    const said = await waitFor(`(() => { const t = document.getElementById('toasts'); return !!t && ${lang === 'en'
      ? "/standby copy/i.test(t.innerText)" : "/نسخة احتياطية للقراءة بس/.test(t.innerText)"}; })()`, 6000);
    check(`[${lang}] a Save on the copy is refused in words the person can read`, said,
      await evaluate("(document.getElementById('toasts') || {}).innerText || ''"));
    check(`[${lang}] …and nothing was written, on the copy or the main server`,
      phoneOf(STBY_DATA) !== '0999 000 111' && phoneOf(MAIN_DATA) === mainPhone);
  }
  check('no script error on the page', errors.length === 0, errors.join(' | ').slice(0, 300));
} finally {
  try { ws.close(); } catch { /* gone */ }
  for (const p of Object.values(procs)) { try { p.kill(); } catch { /* gone */ } }
  await sleep(800);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* held */ }
}
console.log(`\nstandby-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
