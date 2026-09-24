#!/usr/bin/env node
/* ==========================================================================
   The panel brings the shop back by itself, and never waits on a prompt
   before opening it.                        node tools/always-on/panel.mjs

   A real panel (panel/panel.js) on a free port, with its own log folder, run
   against a STAND-IN server folder (OG_PANEL_SERVER_DIR): a fake index.js
   that speaks the panel's pipe and falls over on cue, and fake check scripts
   that write down when they ran and never raise a Windows prompt. Nothing
   real is started, touched or prompted; the real panel's logs are not used.

     1. the fix that may prompt (trusting the certificate) runs AFTER the shop
        said ready — never before it
     2. a shop that falls over comes back by itself
     3. Stop is a stop: no coming back after it
     4. Stop while it waits to come back keeps it closed
     5. a shop that falls over every time is given up on after 5 tries, and
        says so
     6. a person pressing Open after that starts it again
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { request } from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

/* ---- the stand-in server folder ------------------------------------------ */
const TMP = mkdtempSync(join(tmpdir(), 'og-always-'));
const FAKE = join(TMP, 'server');
const DATA = join(TMP, 'data');
const LOGS = join(TMP, 'logs');
const EVENTS = join(TMP, 'events.log');
const CTL = join(TMP, 'mode.txt');
for (const d of [join(FAKE, 'scripts'), join(DATA, 'certs'), LOGS]) mkdirSync(d, { recursive: true });
writeFileSync(join(DATA, 'certs', 'og-cert.pem'), 'not a real certificate');
writeFileSync(join(TMP, 'empty.env'), '');
writeFileSync(join(FAKE, 'package.json'), '{"type":"module"}');

const note = `import { appendFileSync } from 'node:fs';
const note = (s) => appendFileSync(process.env.FAKE_EVENTS, s + ' ' + Date.now() + '\\n');`;

writeFileSync(join(FAKE, 'index.js'), `${note}
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
note('start');
const mode = existsSync(process.env.FAKE_CTL) ? readFileSync(process.env.FAKE_CTL, 'utf8').trim() : 'stay';
process.on('message', (m) => { if (m && m.type === 'stop') { note('stopped'); process.exit(0); } });
setTimeout(() => {
  process.send({ type: 'ready', http: 'http://localhost:1', https: null, lan: [], secure: false, shop: 'Stand-in', accounts: 1, notices: [] });
  note('ready');
  if (mode === 'crash-once') { writeFileSync(process.env.FAKE_CTL, 'stay'); setTimeout(() => { note('crash'); process.exit(7); }, 400); }
  if (mode === 'crash-always') setTimeout(() => { note('crash'); process.exit(7); }, 300);
}, 200);
setInterval(() => {}, 1000);
`);
writeFileSync(join(FAKE, 'scripts', 'preflight.js'), `process.exit(0);`);
writeFileSync(join(FAKE, 'scripts', 'trust-cert.js'), `${note}
if (process.argv.includes('--check')) { note('trust-check'); process.exit(4); }
note('trust-fix'); process.exit(0);`);
writeFileSync(join(FAKE, 'scripts', 'hardware.js'), `${note}
if (process.argv.includes('--json')) { console.log('OG_HW_JSON {"receipt":"ok","label":"ok","scanner":"ok"}'); process.exit(0); }
note('hw-check'); process.exit(0);`);
writeFileSync(join(FAKE, 'scripts', 'always-on.js'),
  `console.log('OG_ALWAYS_JSON {"startup":{"state":"ok"},"power":{"sleep":"ok","hibernate":"ok","lid":"ok"},"signIn":{"state":"ok","plainPassword":false},"code":0}');`);

const events = () => (existsSync(EVENTS) ? readFileSync(EVENTS, 'utf8').trim().split('\n').filter(Boolean) : [])
  .map((l) => { const [what, at] = l.split(' '); return { what, at: Number(at) }; });
const count = (what) => events().filter((e) => e.what === what).length;
const panelLog = () => { try { return readFileSync(join(LOGS, 'panel.log'), 'utf8'); } catch { return ''; } };
async function until(fn, ms, step = 50) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(step); }
  return !!fn();
}

/* ---- the panel ------------------------------------------------------------ */
const PORT = await freePort();
const SHOP = await freePort();
const KEY = 'always-on-test-key';
const panel = spawn(process.execPath, [join(ROOT, 'panel', 'panel.js')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  env: {
    ...process.env,
    OG_PANEL_PORT: String(PORT), OG_PANEL_KEY: KEY, OG_PANEL_LOG_DIR: LOGS,
    OG_PANEL_SERVER_DIR: FAKE, OG_PANEL_REVIVE_DELAYS: '1',
    OG_ENV_FILE: join(TMP, 'empty.env'), OG_DATA_DIR: DATA, OG_PORT: String(SHOP),
    OG_TELEGRAM_TOKEN_OG: '', OG_TELEGRAM_TOKEN_YALLA: '', OG_PUSH: '0',
    FAKE_EVENTS: EVENTS, FAKE_CTL: CTL
  }
});
let panelOut = '';
panel.stdout.on('data', (b) => { panelOut += b; });
panel.stderr.on('data', (b) => { panelOut += b; });

const act = (action, args = {}) => new Promise((ok) => {
  const body = JSON.stringify({ action, args });
  const r = request({ host: '127.0.0.1', port: PORT, path: '/act', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OG-Key': KEY, 'Content-Length': Buffer.byteLength(body) } },
  (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => ok(t)); });
  r.on('error', () => ok(null)); r.end(body);
});
/* The panel's whole state, as the window's first frame carries it. */
const state = () => new Promise((ok) => {
  const r = request({ host: '127.0.0.1', port: PORT, path: '/events?k=' + KEY }, (res) => {
    let t = '';
    res.on('data', (c) => {
      t += c;
      const m = /event: hello\ndata: (.*)\n\n/.exec(t);
      if (m) { res.destroy(); ok(JSON.parse(m[1]).state); }
    });
  });
  r.on('error', () => ok(null)); r.end();
});

try {
  writeFileSync(CTL, 'crash-once');
  check('the test panel starts', await until(() => /OG_PANEL_READY/.test(panelOut), 10000), panelOut.slice(0, 300));

  /* 1 — the prompt comes after the shop is open */
  check('the shop opens, and falls over once as told', await until(() => count('crash') >= 1, 15000), JSON.stringify(events()));
  const ev = events();
  const ready1 = ev.find((e) => e.what === 'ready');
  const fix = ev.find((e) => e.what === 'trust-fix');
  const check1 = ev.find((e) => e.what === 'trust-check');
  check('the free certificate check ran before the shop started', check1 && check1.at < ev.find((e) => e.what === 'start').at);
  check('the fix that may ask Windows for permission ran AFTER the shop said ready',
    ready1 && fix && fix.at > ready1.at, JSON.stringify({ ready: ready1, fix }));

  /* 2 — it comes back */
  check('it comes back by itself (a second start after the fall)', await until(() => count('start') >= 2 && count('ready') >= 2, 6000), JSON.stringify(events()));
  const crash = events().find((e) => e.what === 'crash');
  const start2 = events().filter((e) => e.what === 'start')[1];
  check('…after the first pause (1 s here), not at once and not late', start2 && start2.at - crash.at >= 900 && start2.at - crash.at < 4000, start2 && (start2.at - crash.at) + ' ms');
  check('the log says it fell over and is coming back', /stopped by itself/.test(panelLog()) && /Opening it again in 1 s/.test(panelLog()));
  /* (the Connections card asks trust-cert --check again, legitimately; the
     printer check's plain run is morning()'s alone) */
  check('the morning checks were not run a second time on the come-back', count('hw-check') === 1, count('hw-check') + ' printer checks');
  let s = await state();
  check('the panel says running, and no come-back is pending', s && s.server === 'running' && !s.revive, JSON.stringify(s && { server: s.server, revive: s.revive }));

  /* 3 — Stop is a stop */
  const starts3 = count('start');
  await act('stop');
  check('Stop closes it', await until(() => count('stopped') >= 1, 5000));
  await sleep(2500);
  check('…and it does not come back after a Stop', count('start') === starts3, count('start') + ' starts');

  /* 4 — Stop while it waits to come back */
  writeFileSync(CTL, 'crash-once');
  await act('start');
  check('opened again by hand, and falls over once more', await until(() => count('crash') >= 2, 8000));
  const starts4 = count('start');
  s = await state();
  check('while it waits, the panel says so (revive pending, with its time)', s && s.revive && s.revive.at > Date.now() - 2000 && s.revive.n === 1, JSON.stringify(s && s.revive));
  await act('stop');
  await sleep(2500);
  check('Stop during the wait keeps it closed', count('start') === starts4, count('start') + ' starts');
  check('the log says it was left closed on purpose', /Left closed, as asked/.test(panelLog()));

  /* 5 — falling over every time is given up on */
  writeFileSync(CTL, 'crash-always');
  const starts5 = count('start');
  await act('start');
  check('it falls over every time and is tried again', await until(() => /left closed/.test(panelLog()) && /times in 15 minutes/.test(panelLog()), 30000), panelLog().slice(-400));
  const tries = count('start') - starts5;
  check('one start by hand + 5 comebacks = 6, then it stops trying', tries === 6, tries + ' starts');
  await sleep(2500);
  check('…and really stops (no seventh)', count('start') - starts5 === 6);
  s = await state();
  const srv = s && s.steps.find((x) => x.id === 'server');
  check('the panel says it gave up, and why', s && s.revive && s.revive.gaveUp && srv && srv.state === 'fail' && srv.detail.code === 'server_gave_up',
    JSON.stringify(s && { revive: s.revive, srv }));

  /* 6 — a person presses Open */
  writeFileSync(CTL, 'stay');
  const starts6 = count('start');
  await act('start');
  check('Open after giving up starts it again', await until(() => count('start') > starts6 && count('ready') > starts6, 8000));
  s = await state();
  check('…running, and the slate is clean', s && s.server === 'running' && !s.revive);
} finally {
  await act('stop');
  await until(() => events().filter((e) => e.what === 'stopped').length >= 2, 5000);
  panel.kill();
  await sleep(500);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* a file still held on Windows */ }
}
console.log(`\nalways-on panel: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
