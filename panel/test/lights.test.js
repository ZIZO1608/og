// cd panel && npm test
//
// THE FIVE STATUS LIGHTS, WITH FAKES.
//
// Every rule in panel/lib/lights.js is a pure function of what a probe found,
// and every probe takes its fetch / spawn / https.request as an argument, so
// each case below is the real rule on a made-up answer: no shop, no VPS, no
// internet needed. The last test holds the file to the promise in its header —
// it only ever READS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/lights.js';
import { board, NOW, MIN, iso } from './fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ ping */

test('a ping reply is a TTL, not an exit code', () => {
  const win = 'Pinging 10.8.0.1 with 32 bytes of data:\r\nReply from 10.8.0.1: bytes=32 time=41ms TTL=64\r\n\r\nPing statistics ...';
  assert.deepEqual(L.parsePing(win), { ok: true, ms: 41 });
  assert.deepEqual(L.parsePing('Reply from 10.8.0.1: bytes=32 time<1ms TTL=128'), { ok: true, ms: 1 });
  assert.deepEqual(L.parsePing('64 bytes from 10.8.0.1: icmp_seq=1 ttl=64 time=38.6 ms'), { ok: true, ms: 39 });
  assert.deepEqual(L.parsePing('Antwort von 10.8.0.1: Bytes=32 Zeit=40ms TTL=64'), { ok: true, ms: 40 });
  /* Windows exits 0 for this one — a router answering, not the VPS. */
  assert.deepEqual(L.parsePing('Reply from 10.8.0.2: Destination host unreachable.'), { ok: false, ms: null });
  assert.deepEqual(L.parsePing('Request timed out.'), { ok: false, ms: null });
  assert.deepEqual(L.parsePing(''), { ok: false, ms: null });
});

test('ping only ever pings an address — a word never reaches the command line', async () => {
  let ran = 0;
  const run = async () => { ran++; return { code: 0, out: 'Reply from x: TTL=64 time=1ms' }; };
  assert.deepEqual(await L.ping('10.8.0.1 & calc', { run }), { ok: false, ms: null });
  assert.deepEqual(await L.ping('', { run }), { ok: false, ms: null });
  assert.equal(ran, 0);
  assert.equal((await L.ping('10.8.0.1', { run })).ok, true);
  assert.equal(ran, 1);
});

/* ---------------------------------------------------------------- health */

const reply = (status, body) => async () => ({ status, json: async () => { if (body === undefined) throw new Error('not json'); return body; } });
const failWith = (err) => async () => { throw err; };

test('the health probe believes the shop’s own word, not merely an answer', async () => {
  assert.deepEqual(await L.httpHealth('x', { fetchFn: reply(200, { ok: true }), now: () => NOW }),
    { status: 200, ok: true, code: null, lan: null, role: null, standby: null, ms: 0, error: null });
  const unreachable = await L.httpHealth('x', { fetchFn: reply(503, { ok: false, code: 'shop_unreachable' }) });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.status, 503);
  assert.equal(unreachable.code, 'shop_unreachable', 'the VPS proxy’s answer for a till it cannot reach');
  const page = await L.httpHealth('x', { fetchFn: reply(200) });
  assert.equal(page.ok, false, 'a 200 that is not the health line (a captive portal, an HTML page) is not the shop');
});

test('a failed request says why, in one word', async () => {
  const dns = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const cert = Object.assign(new TypeError('fetch failed'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } });
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.equal((await L.httpHealth('x', { fetchFn: failWith(dns) })).error, 'dns');
  assert.equal((await L.httpHealth('x', { fetchFn: failWith(refused) })).error, 'refused');
  assert.equal((await L.httpHealth('x', { fetchFn: failWith(cert) })).error, 'tls');
  assert.equal((await L.httpHealth('x', { fetchFn: failWith(timeout) })).error, 'timeout');
  assert.equal((await L.httpHealth('x', { fetchFn: failWith(new Error('?')) })).error, 'net');
});

/* A stand-in for https.request, answering like the till on 8443. */
function fakeRequest({ status = 200, body = '{"ok":true}', error = null } = {}) {
  const seen = [];
  const request = (opts, onRes) => {
    seen.push(opts);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => setImmediate(() => {
      if (error) return req.emit('error', error);
      const res = new EventEmitter();
      res.statusCode = status;
      res.setEncoding = () => {};
      onRes(res);
      res.emit('data', body);
      res.emit('end');
    });
    return req;
  };
  return { request, seen };
}

test('the secure port is asked on the loopback address, for the health line and nothing else', async () => {
  const f = fakeRequest();
  const r = await L.localHttps(8443, { request: f.request });
  assert.equal(r.ok, true);
  assert.equal(f.seen[0].host, '127.0.0.1');
  assert.equal(f.seen[0].port, 8443);
  assert.equal(f.seen[0].path, '/api/health');
  assert.equal(f.seen[0].method, 'GET');
  const down = await L.localHttps(8443, { request: fakeRequest({ error: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) }).request });
  assert.deepEqual([down.ok, down.error], [false, 'refused']);
});

test('the secure-port probe against a real closed port says refused, and does not hang', async () => {
  const r = await L.localHttps(1, { timeoutMs: 2000 });
  assert.equal(r.ok, false);
  assert.ok(['refused', 'timeout', 'net'].includes(r.error));
});

/* ----------------------------------------------------------- the server */

test('shop server: the probe is the truth, not the button', () => {
  const ok = { ok: true }, no = { ok: false };
  assert.deepEqual(L.serverLight({ server: 'running', http: ok, https: ok, httpsExpected: true, httpPort: 8090, httpsPort: 8443 }),
    { id: 'server', state: 'ok', code: 'srv_ok', args: { ports: [8090, 8443] } });
  assert.equal(L.serverLight({ server: 'running', http: ok, https: no, httpsExpected: true }).code, 'srv_no_https');
  assert.equal(L.serverLight({ server: 'running', http: ok, https: null, httpsExpected: false }).state, 'ok');
  assert.deepEqual(L.serverLight({ server: 'running', http: no, httpsExpected: true }).code, 'srv_silent');
  assert.deepEqual(L.serverLight({ server: 'stopped', http: no }).code, 'srv_closed');
  assert.equal(L.serverLight({ server: 'stopped', http: ok, https: ok, httpsExpected: true }).state, 'ok',
    'a shop started somewhere else still answers, and says so');
  assert.equal(L.serverLight({ server: 'starting', http: no }).state, 'off');
  assert.equal(L.serverLight({ server: 'stopping', http: ok }).state, 'off');
});

/* ------------------------------------------------------------- the Wi-Fi */

test('Wi-Fi: green only when the certificate names the address phones are given', () => {
  const lan = (o) => ({ address: '10.10.99.9', shop: true, covered: true, ...o });
  assert.deepEqual(L.wifiLight({ lan: lan(), secure: true, certExists: true }),
    { id: 'wifi', state: 'ok', code: 'wifi_ok', args: { address: '10.10.99.9' } });
  assert.equal(L.wifiLight({ lan: lan({ address: '192.168.1.11', shop: false }), secure: true, certExists: true }).code, 'wifi_other');
  const moved = L.wifiLight({ lan: lan({ address: '10.10.99.12', covered: false }), secure: true, certExists: true });
  assert.deepEqual([moved.state, moved.code, moved.args.address], ['warn', 'wifi_uncovered', '10.10.99.12']);
  assert.equal(L.wifiLight({ lan: lan({ covered: null }), secure: true, certExists: true }).code, 'wifi_unknown');
  assert.equal(L.wifiLight({ lan: lan(), secure: false, certExists: false }).code, 'wifi_no_cert');
  assert.equal(L.wifiLight({ lan: lan(), secure: false, certExists: true }).code, 'wifi_plain');
  assert.deepEqual(L.wifiLight({ lan: null, secure: true }).state, 'bad');
});

/* ------------------------------------------------------------ the tunnel */

test('tunnel: a reply is green; no reply says whose end is down', () => {
  assert.deepEqual(L.tunnelLight({ peer: '10.8.0.1', configured: true, localAddr: '10.8.0.2', localUp: true, reply: { ok: true, ms: 41 } }),
    { id: 'tunnel', state: 'ok', code: 'tun_ok', args: { peer: '10.8.0.1', ms: 41 } });
  assert.equal(L.tunnelLight({ peer: '10.8.0.1', configured: true, localAddr: '10.8.0.2', localUp: false, reply: { ok: false } }).code,
    'tun_down_here', 'this laptop does not even hold its end');
  assert.equal(L.tunnelLight({ peer: '10.8.0.1', configured: true, localAddr: '10.8.0.2', localUp: true, reply: { ok: false } }).code,
    'tun_no_reply');
  assert.equal(L.tunnelLight({ peer: '10.8.0.1', configured: false, reply: { ok: false } }).state, 'off',
    'a laptop with no tunnel set up is not told its tunnel is broken');
  assert.equal(L.tunnelLight({ configured: false, reply: { ok: true, ms: 3 } }).state, 'ok');
  assert.equal(L.DEFAULT_PEER, '10.8.0.1');
});

test('hasAddress looks at every card', () => {
  const ifaces = { 'Wi-Fi': [{ address: '10.10.99.9' }], 'og-shop': [{ address: '10.8.0.2' }] };
  assert.equal(L.hasAddress(ifaces, '10.8.0.2'), true);
  assert.equal(L.hasAddress(ifaces, '10.8.0.9'), false);
  assert.equal(L.hasAddress(ifaces, ''), false);
});

/* ------------------------------------------------------------- the cloud */

const live = (o) => ({ configured: true, mode: 'live', behind: 0, lastOkAt: iso(NOW - 10000), lastPushAt: iso(NOW - 3 * MIN), denied: [], ...o });

test('cloud copy: the server’s own sync state, read the way the bell reads it', () => {
  assert.deepEqual(L.cloudLight(live(), { running: true, now: NOW }),
    { id: 'cloud', state: 'ok', code: 'cloud_ok', args: { at: iso(NOW - 3 * MIN) } });
  assert.equal(L.cloudLight(live({ lastPushAt: null }), { running: true, now: NOW }).code, 'cloud_quiet');
  assert.equal(L.cloudLight(live({ behind: 4 }), { running: true, now: NOW }).code, 'cloud_sending');
  const stuck = L.cloudLight(live({ behind: 4, lastOkAt: iso(NOW - 20 * MIN) }), { running: true, now: NOW });
  assert.deepEqual([stuck.state, stuck.code, stuck.args.n], ['warn', 'cloud_behind', 4]);
  assert.equal(L.cloudLight(live({ mode: 'offline', behind: 2, lastOkAt: iso(NOW - 5 * MIN) }), { running: true, now: NOW }).state, 'warn');
  const long = L.cloudLight(live({ mode: 'offline', behind: 2, lastOkAt: iso(NOW - 90 * MIN) }), { running: true, now: NOW });
  assert.deepEqual([long.state, long.code], ['bad', 'cloud_offline_long']);
  assert.equal(L.cloudLight(live({ mode: 'offline', lastOkAt: null }), { running: true, now: NOW }).state, 'bad');
  assert.equal(L.cloudLight(live({ mode: 'refused', refusedBy: 'LAPTOP-2' }), { running: true, now: NOW }).code, 'cloud_refused');
  assert.deepEqual(L.cloudLight(live({ denied: [{ table: 'user_permissions' }] }), { running: true, now: NOW }).args,
    { tables: ['user_permissions'] });
  assert.equal(L.cloudLight(live({ configured: false }), { running: true, now: NOW }).code, 'cloud_none');
  assert.equal(L.cloudLight(live({ mode: 'off' }), { running: true, now: NOW }).code, 'cloud_manual');
  assert.equal(L.cloudLight(live({ mode: 'starting' }), { running: true, now: NOW }).code, 'cloud_starting');
  assert.equal(L.cloudLight(null, { running: true, now: NOW }).code, 'cloud_silent');
  assert.equal(L.cloudLight(live(), { running: false, now: NOW }).code, 'cloud_closed');
  assert.equal(L.cloudLight(null, { running: false, foreign: true, now: NOW }).code, 'cloud_foreign');
});

/* ------------------------------------------------------- the public door */

test('public address: green only when it reaches THIS till', () => {
  const url = 'https://shop.ogsports1.com';
  assert.deepEqual(L.publicLight({ url, res: { status: 200, ok: true, ms: 180 }, shopUp: true }),
    { id: 'public', state: 'ok', code: 'pub_ok', args: { host: 'shop.ogsports1.com', ms: 180 } });
  const noTill = { status: 503, ok: false, code: 'shop_unreachable' };
  assert.deepEqual([L.publicLight({ url, res: noTill, shopUp: true }).state, L.publicLight({ url, res: noTill, shopUp: true }).code],
    ['bad', 'pub_no_till'], 'the VPS answers but cannot reach an open shop: the tunnel');
  assert.deepEqual(L.publicLight({ url, res: noTill, shopUp: false }).code, 'pub_closed', 'with the shop shut that is simply true');
  assert.equal(L.publicLight({ url, res: { status: 502, ok: false }, shopUp: true }).code, 'pub_odd');
  assert.equal(L.publicLight({ url, res: { status: null, ok: false, error: 'dns' }, shopUp: true }).code, 'pub_dns');
  assert.deepEqual(L.publicLight({ url, res: { status: null, ok: false, error: 'timeout' }, shopUp: true }).args,
    { host: 'shop.ogsports1.com', why: 'timeout' });
  assert.equal(L.publicLight({ url, res: null }).state, 'off');
});

test('public address: an answer from ANOTHER till is not this till answering', async () => {
  const url = 'https://shop.ogsports1.com';
  const res = await L.httpHealth(url + '/api/health',
    { fetchFn: reply(200, { ok: true, lan: ['https://10.10.99.9:8443', 'https://172.20.10.2:8443'] }) });
  assert.deepEqual(res.lan, ['10.10.99.9', '172.20.10.2'], 'the answering machine’s own addresses');
  assert.equal(L.publicLight({ url, res, shopUp: true, ours: ['10.10.99.9', '10.8.0.2'] }).code, 'pub_ok', 'the shop laptop itself');
  const dev = L.publicLight({ url, res, shopUp: true, ours: ['192.168.1.40'] });
  assert.deepEqual([dev.state, dev.code], ['warn', 'pub_other'], 'a developer’s laptop reaching the real shop');
  assert.equal(L.publicLight({ url, res: { ...res, lan: [] }, shopUp: true, ours: ['192.168.1.40'] }).code, 'pub_ok',
    'a till with no Wi-Fi address to compare cannot be told apart, and is not accused');
});

/* --------------------------------------------- the VPS's standby (phase 4) */

test('standby: the health probe carries the role and the copy’s own state', async () => {
  const res = await L.httpHealth('http://127.0.0.1:8090/api/health',
    { fetchFn: reply(200, { ok: true, role: 'standby', standby: { copyAt: iso(NOW - 3 * MIN), mode: 'following', waiting: 0 } }) });
  assert.equal(res.role, 'standby');
  assert.equal(res.standby.mode, 'following');
});

test('standby: the domain answering from the VPS is the green, not "another computer"', () => {
  const url = 'https://shop.ogsports1.com';
  const vps = { status: 200, ok: true, role: 'primary', lan: ['http://10.0.1.14:8090'], ms: 210 };
  assert.deepEqual(L.publicLight({ url, res: vps, shopUp: true, ours: ['192.168.1.11', '10.8.0.2'], standby: true }),
    { id: 'public', state: 'ok', code: 'pub_vps', args: { host: 'shop.ogsports1.com', ms: 210 } });
  assert.equal(L.publicLight({ url, res: vps, shopUp: true, ours: ['192.168.1.11'] }).code, 'pub_other',
    'the same answer to a laptop that is still the main server is still somebody else');
  const laptop = { status: 200, ok: true, role: 'standby', lan: ['https://10.8.0.2:8443'] };
  assert.deepEqual([L.publicLight({ url, res: laptop, standby: true }).state, L.publicLight({ url, res: laptop, standby: true }).code],
    ['warn', 'pub_to_laptop'], 'the proxy still pointing down the tunnel: the Coolify step is not done');
  assert.equal(L.publicLight({ url, res: { status: 503, ok: false, code: 'shop_unreachable' }, shopUp: true, standby: true }).code,
    'pub_vps_down', 'the proxy is up and the VPS shop is not — whatever this laptop is doing');
  assert.equal(L.publicLight({ url, res: { status: null, ok: false, error: 'timeout' }, standby: true }).code, 'pub_silent');
});

test('standby: the fifth light is the copy, and offline is amber — the till is working here', () => {
  const h = (standby) => ({ ok: true, role: 'standby', standby });
  assert.deepEqual(L.copyLight(h({ copyAt: iso(NOW - 4 * MIN), mode: 'following' }), { running: true, now: NOW }),
    { id: 'cloud', state: 'ok', code: 'copy_ok', args: { at: iso(NOW - 4 * MIN) } });
  assert.equal(L.copyLight(h({ copyAt: iso(NOW - 20 * MIN), mode: 'following' }), { running: true, now: NOW }).state, 'warn');
  assert.equal(L.copyLight(h({ copyAt: iso(NOW - 2 * 60 * MIN), mode: 'following' }), { running: true, now: NOW }).state, 'bad');
  assert.deepEqual(L.copyLight(h({ copyAt: iso(NOW - 9 * MIN), mode: 'offline', waiting: 3 }), { running: true, now: NOW }),
    { id: 'cloud', state: 'warn', code: 'copy_offline', args: { n: 3 } });
  assert.equal(L.copyLight(h({ copyAt: iso(NOW - 9 * MIN), mode: 'sending', waiting: 2 }), { running: true, now: NOW }).code, 'copy_sending');
  assert.equal(L.copyLight(h({ copyAt: null, reachable: false }), { running: true, now: NOW }).state, 'bad');
  assert.equal(L.copyLight(h({ copyAt: null }), { running: true, now: NOW }).code, 'copy_none');
  assert.equal(L.copyLight(null, { running: false }).code, 'copy_closed');
  assert.equal(L.copyLight({ ok: true }, { running: true }).code, 'copy_silent');
});

/* ------------------------------------------------ the three pictures */

/* The boards the screenshots in _handover/panel-preview/ show are built by
   the real rules (test/fixtures.js), never typed in by hand. */
test('the three boards the screenshots show come out of the real rules', () => {
  assert.deepEqual(board('green').map((l) => l.state), ['ok', 'ok', 'ok', 'ok', 'ok']);
  assert.deepEqual(board('tunnel').map((l) => l.state), ['ok', 'ok', 'bad', 'ok', 'bad']);
  assert.deepEqual(board('cert').map((l) => l.state), ['ok', 'warn', 'ok', 'ok', 'ok']);
  assert.deepEqual(board('green').map((l) => l.id), L.LIGHT_IDS);
});

/* -------------------------------------------------------- read-only */

test('the lights only ever read — no start, no stop, no certificate, no write', () => {
  for (const f of ['lights.js', 'links.js']) {
    const src = readFileSync(join(HERE, '..', 'lib', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const bad of [/startServer|stopServer/, /type:\s*'stop'/, /make-cert|trust-cert|scripts\//, /writeFile|appendFile|unlink|rmSync|mkdir/,
      /method:\s*'(POST|PUT|PATCH|DELETE)'/i]) {
      assert.doesNotMatch(src, bad, `${f} must not ${bad}`);
    }
    const cp = src.match(/import[^;]*from\s*'node:child_process'/g) || [];
    assert.deepEqual(cp, f === 'lights.js' ? ["import { spawn } from 'node:child_process'"] : [],
      `${f}: the only process it may start is ping`);
  }
  const lights = readFileSync(join(HERE, '..', 'lib', 'lights.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((lights.match(/\bspawn\(/g) || []).length, 1, 'one spawn, and it is ping');
  assert.match(lights, /PING\.EXE/);
});

test('the panel’s wiring for the lights never opens or closes the shop', () => {
  const src = readFileSync(join(HERE, '..', 'panel.js'), 'utf8');
  const start = src.indexOf('the addresses and the lights');
  const end = src.indexOf('/* ------------------------------------------------------------- the steps */');
  assert.ok(start > 0 && end > start, 'the block is where the test expects it');
  const block = src.slice(start, end);
  assert.doesNotMatch(block, /startServer\(|stopServer\(|send\(\{\s*type:\s*'stop'|runJob\(/);
  /* and the two public actions it adds are the only new ones */
  assert.match(src, /PUBLIC_ACTIONS = new Set\(\[[^\]]*'lights', 'lanpick'\]\)/);
});
