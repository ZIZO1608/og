#!/usr/bin/env node
/* ==========================================================================
   The proxy's night-mode change, checked.       node tools/night-mode/proxy.mjs
   --------------------------------------------------------------------------
   1. MINIMAL. Against merge/online-offline, only default.conf.template and
      README.md differ in deploy/shop-proxy/; and every line of the old
      default.conf.template is still there, in order, except the one line
      that draws the "shop's internet is down" page — so the change is
      additions, plus that page.
   2. nginx -t on the config as the container renders it (tools/
      nginx-harness.mjs), with the real Windows nginx build: OG_NGINX, or
      _tools/nginx/nginx.exe. A test certificate is made with openssl.
   3. A LIVE RUN: a stub bridge, a dead till, and real requests —
        /night and /night/stock        reach the bridge, with X-OG-Client-IP set
        /snapshot                      still reaches the bridge
        /                              the down page, with its Night mode button
        /api/health                    503 shop_unreachable (the app reads it)
        /api/vps/health                404 (never a public door)
        /night with the bridge stopped night mode's own "not available" page
      nginx is always stopped at the end.
   ========================================================================== */
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer, request } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BASE = process.env.OG_NIGHT_BASE || 'merge/online-offline';
const NGINX = process.env.OG_NGINX || join(REPO, '_tools', 'nginx', 'nginx.exe');
const RUN = join(tmpdir(), 'og-night-proxy-' + process.pid).replace(/\\/g, '/');
const LISTEN = Number(process.env.OG_NIGHT_PROXY_PORT || 8295);

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
  return !!ok;
};
const git = (...a) => spawnSync('git', a, { cwd: REPO, encoding: 'utf8' });
const lf = (s) => s.replace(/\r\n/g, '\n');

/* ---- 1. minimal ----------------------------------------------------------- */
const changed = git('diff', '--name-only', BASE, '--', 'deploy/shop-proxy').stdout.trim().split('\n').filter(Boolean).sort();
check('only default.conf.template and README.md differ in deploy/shop-proxy',
  JSON.stringify(changed) === JSON.stringify(['deploy/shop-proxy/README.md', 'deploy/shop-proxy/default.conf.template'])
  || JSON.stringify(changed) === JSON.stringify(['deploy/shop-proxy/default.conf.template']), changed.join(', '));
const oldConf = lf(git('show', BASE + ':deploy/shop-proxy/default.conf.template').stdout).split('\n');
const newConf = lf(readFileSync(join(REPO, 'deploy', 'shop-proxy', 'default.conf.template'), 'utf8')).split('\n');
const downLine = (l) => /^\s*return 503 '<!doctype html>/.test(l) && l.includes('The shop&#39;s internet is down');
let j = 0, missing = [];
for (const l of oldConf) {
  if (downLine(l)) continue;
  while (j < newConf.length && newConf[j] !== l) j++;
  if (j >= newConf.length) { missing.push(l); j = 0; }
  else j++;
}
check('every other line of the old config is still there, in order', missing.length === 0, missing.slice(0, 3).join(' | '));
const newDown = newConf.find(downLine);
const oldDown = oldConf.find(downLine);
check('the down page keeps everything it said, and gains the /night button',
  newDown && oldDown && newDown.includes('href="/night"') &&
  oldDown.replace(/<\/style>.*$/, '').split('<style>')[0] === newDown.replace(/<\/style>.*$/, '').split('<style>')[0] &&
  newDown.includes(oldDown.slice(oldDown.indexOf('</style>') + 8, -'</div>\';'.length)));
check('no raw single quote inside the page (it would end the nginx string)', newDown && !newDown.slice(newDown.indexOf("'") + 1, newDown.lastIndexOf("'")).includes("'"));

/* ---- 2 and 3 need nginx and openssl ------------------------------------------ */
if (!existsSync(NGINX)) {
  check('nginx is available (set OG_NGINX)', false, NGINX);
  finish();
}
rmSync(RUN, { recursive: true, force: true });
mkdirSync(RUN, { recursive: true });
const pem = join(RUN, 'till.pem');
const ssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
  '-keyout', join(RUN, 'till.key'), '-out', pem, '-days', '2', '-subj', '/CN=og-till', '-addext', 'subjectAltName=DNS:og-till'],
  { encoding: 'utf8' });
if (!check('a test certificate is made (openssl)', ssl.status === 0 && existsSync(pem), ssl.stderr)) finish();

const stub = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('bridge:' + req.url + ' ip=' + (req.headers['x-og-client-ip'] || '') + ' xff=' + (req.headers['x-forwarded-for'] || ''));
});
await new Promise((ok) => stub.listen(0, '127.0.0.1', ok));
const bridge = 'http://127.0.0.1:' + stub.address().port;
const harness = (cmd, extra = []) => spawnSync(process.execPath,
  [join(REPO, 'tools', 'nginx-harness.mjs'), cmd, '--nginx', NGINX, '--run', RUN + '/nginx', '--pem', pem,
   '--upstream', 'https://127.0.0.1:9', '--bridge', bridge, '--listen', String(LISTEN), ...extra], { encoding: 'utf8' });

const t = harness('test');
check('nginx -t accepts the rendered config', t.status === 0 && /test is successful/.test(t.stdout + t.stderr), (t.stdout + t.stderr).slice(-600));

function get(path, headers = {}) {
  return new Promise((ok) => {
    const r = request({ host: '127.0.0.1', port: LISTEN, path, headers }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b }));
    });
    r.on('error', (e) => ok({ status: 0, body: String(e) }));
    r.end();
  });
}

const s = harness('start');
try {
  check('nginx starts', s.status === 0, (s.stdout + s.stderr).slice(-400));
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { await new Promise((r) => setTimeout(r, 100)); up = (await get('/__proxy_health')).status === 200; }
  check('the proxy answers its own pulse', up);

  /* 127.0.0.1 stands where Traefik stands in production (a trusted proxy),
     so its X-Forwarded-For is read — rightmost untrusted entry wins, and
     whatever a visitor typed to the left of it (1.2.3.4) is never chosen. */
  const n1 = await get('/night', { 'X-Forwarded-For': '1.2.3.4, 6.6.6.6' });
  check('/night reaches the bridge', n1.status === 200 && n1.body.startsWith('bridge:/night'), n1.status + ' ' + n1.body);
  check('…X-OG-Client-IP is the visitor Traefik saw, never the forged entry to its left',
    /ip=6\.6\.6\.6 /.test(n1.body) && !n1.body.includes('1.2.3.4'), n1.body);
  check('…and X-Forwarded-For itself is not passed on', /xff=$/.test(n1.body), n1.body);
  const s1 = await get('/snapshot', { 'X-Forwarded-For': '1.2.3.4, 6.6.6.6' });
  check('…exactly as /snapshot is handled', s1.body.replace('/snapshot', '/night') === n1.body, s1.body);
  const n2 = await get('/night/stock?q=samba');
  check('/night/stock?q= reaches the bridge with its query', n2.status === 200 && n2.body.startsWith('bridge:/night/stock?q=samba'), n2.body);
  const sn = await get('/snapshot');
  check('/snapshot still reaches the bridge', sn.status === 200 && sn.body.startsWith('bridge:/snapshot'));
  /* The sign-in POST has the till's sign-in zone on top of og-bridge's own
     throttle: 10 a minute per visitor, 5 at once — the seventh in a burst
     is 429 at the door and never reaches the bridge. */
  const lg = await get('/night/login', { 'X-Forwarded-For': '9.9.9.1' });
  check('/night/login reaches the bridge, with the visitor\'s address', lg.status === 200 && lg.body.startsWith('bridge:/night/login') && /ip=9\.9\.9\.1 /.test(lg.body), lg.body);
  const burst = [];
  for (let i = 0; i < 8; i++) burst.push((await get('/night/login', { 'X-Forwarded-For': '9.9.9.2' })).status);
  check('…eight sign-ins at once from one visitor: the first six through, then 429', burst.slice(0, 6).every((c) => c === 200) && burst.slice(6).every((c) => c === 429), burst.join(','));
  check('…another visitor is not held up by it', (await get('/night/login', { 'X-Forwarded-For': '9.9.9.3' })).status === 200);
  const pages = [];
  for (let i = 0; i < 8; i++) pages.push((await get('/night/stock', { 'X-Forwarded-For': '9.9.9.2' })).status);
  check('…and the rest of night mode is not in the sign-in zone', pages.every((c) => c === 200), pages.join(','));
  const nx = await get('/nightly');
  check('/nightly is NOT night mode (it goes to the till, here dead → the down page)', nx.status === 503 && !nx.body.startsWith('bridge:'));
  const home = await get('/');
  check('/ with the till dead: 503 and the down page', home.status === 503 && /internet is down/.test(home.body));
  check('…which carries the Night mode button to /night', /<a class="n" href="\/night">/.test(home.body) && /Night mode/.test(home.body));
  check('…and is not cached', /no-store/.test(home.headers['cache-control'] || ''));
  const api = await get('/api/health');
  check('/api/health: 503 shop_unreachable, as the app expects', api.status === 503 && /"shop_unreachable"/.test(api.body));
  check('/api/vps/health: 404, never a public door', (await get('/api/vps/health')).status === 404);

  await new Promise((ok) => stub.close(ok));
  const down = await get('/night');
  check('/night with og-bridge down: 503 and night mode\'s own page', down.status === 503 && /Night mode is not available/.test(down.body) && /no-store/.test(down.headers['cache-control'] || ''), down.status + ' ' + down.body.slice(0, 120));
} finally {
  const st = harness('stop');
  check('nginx stopped', st.status === 0, st.stdout + st.stderr);
  try { stub.close(); } catch { /* closed */ }
}
finish();

function finish() {
  try { rmSync(RUN, { recursive: true, force: true }); } catch { /* nginx may hold a log a moment */ }
  console.log(`\nnight-mode proxy: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
