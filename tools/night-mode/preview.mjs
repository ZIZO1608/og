#!/usr/bin/env node
/* ==========================================================================
   Night mode, photographed.                  node tools/night-mode/preview.mjs
   --------------------------------------------------------------------------
   world.mjs builds a night on this machine; requests are left in every state
   (one accepted, one turned down, two still waiting); then headless Chrome,
   driven over the DevTools protocol with Node's own WebSocket (nothing is
   installed), takes each screen at 390 px in Arabic and in English:

     night:  sign-in · home (owner, with today's numbers) · home (staff) ·
             stock search · a customer · the request form · my requests
     laptop: "Waiting for the shop"

   Out: _handover/night-preview/ (or OG_PREVIEW_OUT). Chrome: CHROME, or the
   usual install. PGlite: OG_PGLITE, as for the other scripts.
   ========================================================================== */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { buildWorld, LIN, REPO } from './world.mjs';

const OUT = process.env.OG_PREVIEW_OUT || join(REPO, '_handover', 'night-preview');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- a small DevTools client ---------------------------------------------- */
async function chrome() {
  const profile = join(tmpdir(), 'og-night-chrome-' + process.pid);
  rmSync(profile, { recursive: true, force: true });
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) port = Number(readFileSync(f, 'utf8').split('\n')[0]);
  }
  if (!port) throw new Error('Chrome did not open its debugging port');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.bad(new Error(msg.error.message)) : w.ok(msg.result); }
  };
  const send = (method, params = {}) => new Promise((ok, bad) => { const i = ++id; waiting.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Network.enable');
  return {
    send,
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; },
    async close() { try { ws.close(); } catch { /* gone */ } proc.kill(); await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch { /* held */ } }
  };
}

async function go(c, url, ready) {
  await c.send('Page.navigate', { url });
  for (let i = 0; i < 150; i++) {
    await sleep(100);
    if (await c.eval(`document.readyState === 'complete' && !!(${ready || 'true'})`)) return true;
  }
  return false;
}

/* The whole page at 390 wide: the viewport is made as tall as the content,
   so the fixed banner and tab bar sit where they do on a phone. */
async function shot(c, file, { height = null } = {}) {
  let h = height;
  if (!h) h = await c.eval('Math.max(844, document.documentElement.scrollHeight, document.body.scrollHeight)');
  h = Math.min(h, 4000);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: h, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  const r = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 390, height: h, scale: 1 } });
  writeFileSync(join(OUT, file), Buffer.from(r.data, 'base64'));
  console.log('  saved ' + file + ' (390×' + h + ')');
}

const cookie = (c, name, value, path, port) => c.send('Network.setCookie', {
  name, value, domain: 'localhost', path, httpOnly: true, secure: true, sameSite: 'Strict', url: `http://localhost:${port}${path}`
});

/* ---- the world, with requests in every state ------------------------------- */
const w = await buildWorld();
const { laptop, night } = w;
const { SKU, C } = laptop;
const shots = [];
let c = null;
try {
  const sara = await night.signIn('sara');
  const send = async (s, lines, customerId, fields) => {
    for (const [sku, qty] of lines) await night.go('POST', '/night/request/add', { cookie: s.cookie, body: { t: s.t, sku, qty } });
    if (customerId) await night.go('POST', '/night/request/customer', { cookie: s.cookie, body: { t: s.t, id: customerId } });
    const r = await night.go('POST', '/night/request', { cookie: s.cookie, body: { t: s.t, ...fields } });
    return decodeURIComponent((/sent=([^&]+)/.exec(r.headers.location || '') || [])[1] || '');
  };
  const r1 = await send(sara, [[SKU.samba42, 1], [SKU.afBlack42, 1]], C.nour.id,
    { name: 'Nour Haddad', phone: '0933 123 456', method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery', note: 'Call after 6 — she is at work' });
  const r2 = await send(sara, [[SKU.samba43, 2]], C.rami.id, { name: 'Rami Khoury', phone: '+963 944 555 666', method: 'delivery', city: 'Aleppo', address: 'Al-Furqan, 3rd floor' });
  const r3 = await send(sara, [[SKU.gazelle42, 1]], null, { name: 'Omar Aziz', phone: '0955 111 222', method: 'pickup', note: 'Comes after 5' });
  const r4 = await send(sara, [[SKU.afWhite42, 1], [SKU.samba41, 1]], C.lina.id, { name: 'Lina Saleh', phone: '0911 222 333', method: 'delivery', city: 'Aleppo', address: 'Al-Aziziyah, by the church' });
  await laptop.L.Inbox.collect({ lineage: LIN });
  const owner = laptop.L.Auth.findByUsername('abode');
  laptop.L.Requests.accept(r1, { method: 'driver' }, owner);
  laptop.L.Requests.reject(r2, { code: 'out_of_stock', note: 'Only one 43 left, and it is sold.' }, owner);
  await laptop.L.Inbox.collect({ lineage: LIN });
  console.log('requests:', r1, 'accepted ·', r2, 'turned down ·', r3, r4, 'waiting');

  /* A request being written, on its own session, for the form's picture. */
  const writer = await night.signIn('sara');
  await night.go('POST', '/night/request/add', { cookie: writer.cookie, body: { t: writer.t, sku: SKU.samba42, qty: 1 } });
  await night.go('POST', '/night/request/add', { cookie: writer.cookie, body: { t: writer.t, sku: SKU.afWhite42, qty: 2 } });
  await night.go('POST', '/night/request/customer', { cookie: writer.cookie, body: { t: writer.t, id: C.rami.id } });
  await night.go('POST', '/night/request/save', { cookie: writer.cookie, body: { t: writer.t, name: 'Rami Khoury', phone: '+963 944 555 666', method: 'delivery', city: 'Aleppo', address: 'Al-Furqan, 3rd floor', note: '' } });
  const boss = await night.signIn('abode');

  await laptop.start();
  const lk = (await laptop.login('abode')).split('; ').map((p) => p.split('='));

  c = await chrome();
  const N = `http://localhost:${night.port}`;
  for (const lang of ['ar', 'en']) {
    await c.send('Network.clearBrowserCookies');
    await go(c, `${N}/night?lang=${lang}`, "document.querySelector('form')");
    await shot(c, `night-signin-${lang}.png`, { height: 844 });

    await cookie(c, 'og_night', boss.cookie.split('=')[1], '/night', night.port);
    await go(c, `${N}/night?lang=${lang}`, "document.querySelector('.tiles')");
    await shot(c, `night-home-owner-${lang}.png`);

    await c.send('Network.clearBrowserCookies');
    await cookie(c, 'og_night', sara.cookie.split('=')[1], '/night', night.port);
    await go(c, `${N}/night?lang=${lang}`, "document.querySelector('.tiles')");
    await shot(c, `night-home-staff-${lang}.png`);
    await go(c, `${N}/night/stock?q=samba`, "document.querySelector('.prod')");
    await shot(c, `night-stock-${lang}.png`);
    await go(c, `${N}/night/customers/${C.nour.id}`, "document.querySelector('.dl')");
    await shot(c, `night-customer-${lang}.png`);
    await go(c, `${N}/night/requests`, "document.querySelector('.req')");
    await shot(c, `night-requests-${lang}.png`);

    await c.send('Network.clearBrowserCookies');
    await cookie(c, 'og_night', writer.cookie.split('=')[1], '/night', night.port);
    await go(c, `${N}/night/request?lang=${lang}`, "document.querySelector('.line')");
    await shot(c, `night-request-form-${lang}.png`);

    /* The laptop: signed in as the owner, the screen in this language. */
    await c.send('Network.clearBrowserCookies');
    for (const [name, value] of lk) {
      await c.send('Network.setCookie', { name, value, domain: 'localhost', path: '/', httpOnly: true, url: `http://localhost:${laptop.port}/` });
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    /* The language is set once the app has FINISHED booting: boot's own
       applyLang() writes og.lang from the language it started in, and a key
       set while it was still booting was written straight back (the first
       run photographed the English laptop in Arabic). */
    await go(c, `http://localhost:${laptop.port}/?b=${lang}`, "!document.getElementById('bootSplash') && document.querySelector('.topbar')");
    await c.eval(`localStorage.setItem('og.lang', '${lang}'); true`);
    await go(c, `http://localhost:${laptop.port}/?v=${lang}#requests`,
      "!document.getElementById('bootSplash') && document.querySelector('.rq-card')");
    const shown = await c.eval(`document.documentElement.getAttribute('lang') || (document.body.classList.contains('rtl') ? 'ar' : 'en')`);
    if (shown !== lang) throw new Error(`the laptop drew ${shown}, not ${lang}`);
    await sleep(800);
    await shot(c, `laptop-waiting-${lang}.png`, { height: 1500 });
    /* …and the Accept dialog over it. */
    await c.eval(`document.querySelector('.rq-card [data-act="rq-accept"]').click(); true`);
    await sleep(600);
    await shot(c, `laptop-accept-${lang}.png`, { height: 844 });
    await c.eval(`closeModal(); true`);
    shots.push(lang);
  }
} catch (e) {
  console.error('preview failed:', e && e.stack || e);
  process.exitCode = 1;
} finally {
  if (c) await c.close();
  await w.close();
}
console.log(shots.length === 2 ? '\npreview: both languages saved in ' + OUT : '\npreview: incomplete');
