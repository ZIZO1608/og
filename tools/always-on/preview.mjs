#!/usr/bin/env node
/* ==========================================================================
   What the owner sees, photographed.        node tools/always-on/preview.mjs

   A test panel on the stand-in server (as tools/always-on/panel.mjs), made
   to fall over once with a LONG pause before it comes back, so the "coming
   back" screen stays up long enough to photograph; the stand-in always-on
   check says this laptop does not start the shop with Windows, so the new
   Connections row is amber. The panel window in headless Chrome at 1100 × 760
   and 375 × 760, in English and Arabic. Out: _handover/always-on/.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, '_handover', 'always-on');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

const TMP = mkdtempSync(join(tmpdir(), 'og-always-shot-'));
const FAKE = join(TMP, 'server');
for (const d of [join(FAKE, 'scripts'), join(TMP, 'data'), join(TMP, 'logs')]) mkdirSync(d, { recursive: true });
writeFileSync(join(TMP, 'empty.env'), '');
writeFileSync(join(FAKE, 'package.json'), '{"type":"module"}');
writeFileSync(join(FAKE, 'index.js'), `
process.on('message', (m) => { if (m && m.type === 'stop') process.exit(0); });
setTimeout(() => {
  process.send({ type: 'ready', http: 'http://localhost:8090', https: 'https://localhost:8443', lan: ['https://10.10.99.9:8443'], secure: true, shop: 'OG Sports', accounts: 13, notices: [] });
  if (!process.env.FAKE_STAY) setTimeout(() => process.exit(7), 400);
}, 200);
setInterval(() => {}, 1000);`);
writeFileSync(join(FAKE, 'scripts', 'preflight.js'), 'process.exit(0);');
writeFileSync(join(FAKE, 'scripts', 'trust-cert.js'), 'process.exit(0);');
writeFileSync(join(FAKE, 'scripts', 'hardware.js'),
  `if (process.argv.includes('--json')) console.log('OG_HW_JSON {"receipt":"ok","label":"ok","scanner":"ok"}'); process.exit(0);`);
writeFileSync(join(FAKE, 'scripts', 'always-on.js'),
  `console.log('OG_ALWAYS_JSON {"startup":{"state":"missing"},"power":{"sleep":"ok","hibernate":"ok","lid":"none"},"signIn":{"state":"off","plainPassword":false},"code":4}');`);

const PORT = await freePort();
const KEY = 'always-on-preview-key';
const panel = spawn(process.execPath, [join(ROOT, 'panel', 'panel.js')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: {
    ...process.env, OG_PANEL_PORT: String(PORT), OG_PANEL_KEY: KEY, OG_PANEL_LOG_DIR: join(TMP, 'logs'),
    OG_PANEL_SERVER_DIR: FAKE, OG_PANEL_REVIVE_DELAYS: '60', OG_ENV_FILE: join(TMP, 'empty.env'),
    OG_DATA_DIR: join(TMP, 'data'), OG_PORT: String(await freePort()),
    OG_TELEGRAM_TOKEN_OG: '', OG_TELEGRAM_TOKEN_YALLA: '', OG_PUSH: '0'
  }
});

/* ---- headless Chrome over the DevTools protocol (Node's own WebSocket) ---- */
const profile = join(TMP, 'chrome');
const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
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
ws.onmessage = (m) => { const msg = JSON.parse(m.data); const w = msg.id && waiting.get(msg.id); if (w) { waiting.delete(msg.id); msg.error ? w.bad(new Error(msg.error.message)) : w.ok(msg.result); } };
const send = (method, params = {}) => new Promise((ok, bad) => { const i = ++id; waiting.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

try {
  await send('Page.enable');
  /* Wait for the fall: the window then says it is coming back. */
  await sleep(4000);
  const url = `http://127.0.0.1:${PORT}/?k=${KEY}`;
  for (const lang of ['en', 'ar']) {
    for (const [w, h, tag] of [[1100, 760, 'desk'], [375, 760, 'narrow']]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      await send('Page.navigate', { url });
      for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate("document.readyState === 'complete' && !!document.getElementById('hTitle') && document.getElementById('hTitle').textContent.length > 0")) break; }
      await evaluate(`localStorage.setItem('og.panel.lang', '${lang}'); true`);
      await send('Page.reload');
      await sleep(1500);
      const title = await evaluate("document.getElementById('hTitle').textContent");
      const full = await evaluate('Math.max(' + h + ', document.documentElement.scrollHeight)');
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: Math.min(full, 2400), deviceScaleFactor: 1, mobile: w < 500 });
      await sleep(500);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const file = `panel-reviving-${tag}-${lang}.png`;
      writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'));
      console.log(`  saved ${file}  — "${title}"`);
    }
  }
} finally {
  try { ws.close(); } catch { /* gone */ }
  proc.kill();
  panel.kill();
  await sleep(600);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* held */ }
}
