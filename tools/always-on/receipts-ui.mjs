#!/usr/bin/env node
/* ==========================================================================
   Settings → Receipt printer → "Through the shop laptop", pressed for real.
                                         node tools/always-on/receipts-ui.mjs

   A real server on a throwaway data folder, headless Chrome over the DevTools
   protocol, and every press a real pointer event on the middle of what is
   PAINTED (a point that belongs to something else is refused). What was
   saved is read back out of SQLite, never off the screen. English at 1100
   and Arabic at 390; photographs into _handover/always-on/.
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

const TMP = mkdtempSync(join(tmpdir(), 'og-receipts-ui-'));
writeFileSync(join(TMP, 'empty.env'), '');
const DATA = join(TMP, 'data');
const env = { ...process.env, OG_ENV_FILE: join(TMP, 'empty.env'), OG_DATA_DIR: DATA };

const seed = spawn(process.execPath, ['--input-type=module', '-e', `
  import * as DB from './lib/db.js';
  import * as Auth from './lib/auth.js';
  import { dbFile } from './lib/env.js';
  DB.open(dbFile());
  await Auth.createUser({ username: 'owner1', name: 'Test Owner', role: 'owner', password: 'correct-horse-9' });
  DB.close();
`], { cwd: SERVER, env, stdio: 'inherit' });
await new Promise((ok) => seed.on('exit', ok));

const PORT = await freePort();
const procs = {};
procs.server = spawn(process.execPath, ['index.js'], {
  cwd: SERVER, stdio: 'ignore', windowsHide: true,
  env: { ...env, OG_PORT: String(PORT), OG_HTTPS: '0', OG_SYNC_MINUTES: '0', OG_PUSH: '0', OG_PULL_AT_BOOT: '0' }
});
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 200; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break; } catch { /* not yet */ } await sleep(100); }

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
const consoleErrors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
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
/* The middle of what is painted, and only if that point is the element's. */
async function press(sel) {
  const at = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { err: 'missing' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return (hit === el || el.contains(hit)) ? { x, y, h: r.height } : { err: 'covered by ' + (hit ? hit.outerHTML.slice(0, 80) : 'nothing') };
  })()`);
  if (at.err) throw new Error(sel + ': ' + at.err);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
  }
  return at;
}
const cfg = () => {
  const d = new DatabaseSync(join(DATA, 'og.db'), { readOnly: true });
  const rows = Object.fromEntries(d.prepare("SELECT key, value FROM config WHERE key LIKE 'receipt.%'").all().map((r) => [r.key, r.value]));
  d.close();
  return rows;
};

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + '/' });
  await waitFor("document.readyState === 'complete'");
  const signed = await evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner1', password: 'correct-horse-9' }) }).then(r => r.status)`);
  check('signed in as the owner', signed === 200, String(signed));

  let n = 0;
  for (const [lang, w, h, station] of [['en', 1100, 800, 'counter-1'], ['ar', 390, 844, 'shop']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await evaluate(`localStorage.setItem('og.lang', '${lang}'); localStorage.setItem('og.settings.open', JSON.stringify(['receipt'])); true`);
    await send('Page.navigate', { url: `${BASE}/?r=${++n}#settings` });
    const ready = await waitFor("!document.getElementById('bootSplash') && !!document.querySelector('[data-fold=\"receipt\"]')", 20000);
    check(`[${lang}] Settings opens with the receipt card`, ready);
    if (await evaluate("document.querySelector('[data-fold=\"receipt\"]').getAttribute('data-open') !== '1'")) await press('[data-fold="receipt"] .fold-btn');
    await waitFor("document.querySelector('[data-fold=\"receipt\"]').getAttribute('data-open') === '1'");

    const chip = '#rcTransport [data-k="agent"]';
    const label = await evaluate(`document.querySelector('${chip}') && document.querySelector('${chip}').textContent`);
    check(`[${lang}] the third choice is there, in the screen's language`,
      lang === 'en' ? /shop laptop/i.test(label || '') : /[\u0600-\u06FF]/.test(label || ''), label);
    const tall = await press(chip);
    if (w < 500) check(`[${lang}] the chip is a thumb's height (≥ 44px) on a phone`, tall.h >= 44, String(tall.h));
    check(`[${lang}] pressing it shows the station box and the note`,
      await waitFor("!!document.getElementById('rcStation') && !document.getElementById('rcHost') && !document.getElementById('rcShare')"));
    check(`[${lang}] no raw i18n key in the card`, !(await evaluate(
      "/\\brc3_[a-z_]+|rc_agent_away/.test(document.querySelector('[data-fold=\"receipt\"]').innerText)")));
    const wide = await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');
    check(`[${lang}] nothing scrolls sideways`, wide);

    await evaluate(`(() => { const i = document.getElementById('rcStation'); i.value = ${JSON.stringify(station)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await send('Page.captureScreenshot', { format: 'png' });
    await evaluate(`document.getElementById('rcStation').scrollIntoView({ block: 'center' }); true`);
    await sleep(300);
    writeFileSync(join(OUT, `settings-receipt-agent-${lang}-${w}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await press('[data-fold="receipt"] [data-act="rc-save-config"]');
    const saved = await (async () => { for (let i = 0; i < 60; i++) { const c = cfg(); if (c['receipt.station'] === station && c['receipt.transport'] === 'agent') return c; await sleep(100); } return cfg(); })();
    check(`[${lang}] Save writes transport = agent and station "${station}" to the database`,
      saved['receipt.transport'] === 'agent' && saved['receipt.station'] === station, JSON.stringify(saved['receipt.transport']) + ' ' + saved['receipt.station']);

    /* Back to the network printer — and the station is kept for next time. */
    await press('#rcTransport [data-k="tcp"]');
    check(`[${lang}] the network choice brings its own boxes back`, await waitFor("!!document.getElementById('rcHost') && !document.getElementById('rcStation')"));
    await press('[data-fold="receipt"] [data-act="rc-save-config"]');
    const back = await (async () => { for (let i = 0; i < 60; i++) { const c = cfg(); if (c['receipt.transport'] === 'tcp') return c; await sleep(100); } return cfg(); })();
    check(`[${lang}] …and saving it keeps the station, as the other transports' settings are kept`,
      back['receipt.transport'] === 'tcp' && back['receipt.station'] === station);
  }
  check('no script error on the page', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
} finally {
  try { ws.close(); } catch { /* gone */ }
  for (const p of Object.values(procs)) { try { p.kill(); } catch { /* gone */ } }
  await sleep(800);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* held */ }
}
console.log(`\nreceipts-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
