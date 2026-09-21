// The snapshot's door and routes. A real http server over snapshotRoutes, a
// stub mirror and road, and a clock that is a number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { hashPassword, hotp, base32Decode, base32Encode, totpStep, makeAuth, parseUsers } from '../src/snapshot-auth.js';
import { snapshotRoutes, visitorIp } from '../src/snapshot.js';

test('TOTP matches RFC 6238\'s own vector (SHA1, T=59 → 287082)', () => {
  const key = Buffer.from('12345678901234567890');
  assert.equal(hotp(key, Math.floor(59 / 30)), '287082');
  assert.equal(hotp(key, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpStep(base32Encode(key), '287082', 59 * 1000), 1);
});

test('base32 round-trips', () => {
  const b = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 9]);
  assert.deepEqual(base32Decode(base32Encode(b)), b);
});

const SECRET = base32Encode(Buffer.from('ns04-snapshot-secret'));
const T0 = Date.parse('2026-09-21T12:00:00Z');
const codeAt = (ms) => hotp(base32Decode(SECRET), Math.floor(ms / 30000));

async function door(clock) {
  const users = parseUsers(JSON.stringify([{ user: 'abode', scrypt: await hashPassword('the-right-password'), totpSecret: SECRET }]));
  return makeAuth({ users, now: () => clock.t });
}

test('right password with a wrong code is refused', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  const bad = String((Number(codeAt(T0)) + 1) % 1e6).padStart(6, '0');
  assert.equal((await a.login({ user: 'abode', password: 'the-right-password', code: bad, ip: '1.1.1.1' })).ok, false);
});

test('a wrong password with the right code is refused', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  assert.equal((await a.login({ user: 'abode', password: 'nope', code: codeAt(T0), ip: '1.1.1.1' })).ok, false);
});

test('a code from outside ±1 step is refused; the neighbouring step is accepted', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  assert.equal((await a.login({ user: 'abode', password: 'the-right-password', code: codeAt(T0 - 90000), ip: '1.1.1.2' })).ok, false);
  assert.equal((await a.login({ user: 'abode', password: 'the-right-password', code: codeAt(T0 + 30000), ip: '1.1.1.2' })).ok, true);
});

test('the same code cannot be used twice', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  assert.equal((await a.login({ user: 'abode', password: 'the-right-password', code: codeAt(T0), ip: '1.1.1.3' })).ok, true);
  assert.equal((await a.login({ user: 'abode', password: 'the-right-password', code: codeAt(T0), ip: '1.1.1.3' })).ok, false);
});

test('the throttle trips at five per username, even from new addresses, and lifts after 15 min', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  for (let i = 0; i < 5; i++) await a.login({ user: 'abode', password: 'x', code: '000000', ip: '10.0.0.' + i });
  const r = await a.login({ user: 'abode', password: 'the-right-password', code: codeAt(T0), ip: '10.0.0.99' });
  assert.equal(r.reason, 'throttled');
  clock.t += 15 * 60 * 1000 + 1;
  assert.equal((await a.login({ user: 'abode', password: 'the-right-password', code: codeAt(clock.t), ip: '10.0.0.99' })).ok, true);
});

test('the throttle trips at five per address, across usernames', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  for (let i = 0; i < 5; i++) await a.login({ user: 'guess' + i, password: 'x', code: '000000', ip: '9.9.9.9' });
  assert.equal((await a.login({ user: 'abode', password: 'the-right-password', code: codeAt(T0), ip: '9.9.9.9' })).reason, 'throttled');
});

test('an unknown username does the same scrypt work (timing says nothing)', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  const t1 = performance.now(); await a.login({ user: 'abode', password: 'x', code: '1', ip: '8.8.8.1' }); const known = performance.now() - t1;
  const t2 = performance.now(); await a.login({ user: 'nobody', password: 'x', code: '1', ip: '8.8.8.2' }); const unknown = performance.now() - t2;
  assert.ok(unknown > known * 0.5 && unknown < known * 2, `known ${known.toFixed(0)} ms, unknown ${unknown.toFixed(0)} ms`);
});

test('a session lasts 12 hours and no longer', async () => {
  const clock = { t: T0 };
  const a = await door(clock);
  const r = await a.login({ user: 'abode', password: 'the-right-password', code: codeAt(T0), ip: '1.2.3.4' });
  assert.equal(a.session(r.token), 'abode');
  clock.t += 12 * 3600 * 1000 - 1000; assert.equal(a.session(r.token), 'abode');
  clock.t += 2000; assert.equal(a.session(r.token), null);
});

test('the proxy\'s X-OG-Client-IP is believed only from its network', () => {
  const r = (peer, h) => ({ socket: { remoteAddress: peer }, headers: h ? { 'x-og-client-ip': h } : {} });
  assert.equal(visitorIp(r('::ffff:10.0.1.5', '203.0.113.9'), '10.0.0.0/8'), '203.0.113.9');
  assert.equal(visitorIp(r('203.0.113.50', '1.1.1.1'), '10.0.0.0/8'), '203.0.113.50');
});

/* ---- the routes, over HTTP ------------------------------------------------ */

const ROWS = {
  sales: [{ id: 'INV-1', at: '2026-09-21T08:00:00Z', currency: 'SYP', total: 45000, payment: 'cash' }],
  returns: [], balances: [{ place: 'drawer', currency: 'SYP', amount: 45000, last: '2026-09-21T08:00:00Z' }],
  checks: [], config: [{ key: 'shop.name', value: 'OG Test' }], users: [{ id: 7, name: 'Abode' }],
  currencies: [{ code: 'SYP', minor_exp: 0 }, { code: 'USD', minor_exp: 2 }], suppliers: [], road: [], driverCash: [],
  stock: [], lastSales: [{ id: 'INV-1', at: '2026-09-21T08:00:00Z', currency: 'SYP', total: 45000, voided: 0, payment: 'cash', cashier_id: 7 }],
  lastItems: [{ sale_id: 'INV-1', name: 'Samba', size: '42', qty: 1 }]
};

async function serve(mode) {
  const clock = { t: Date.now() };
  const auth = await door(clock);
  const road = { state: { mode, beatAt: '2026-09-21T11:32:00Z', ageMs: 47 * 60000 } };
  const routes = snapshotRoutes({ config: { shopTz: 'Asia/Damascus', proxyNets: '10.0.0.0/8', snapshotUsers: '[]' },
    mirror: { rows: async () => ROWS }, road, auth, now: () => clock.t });
  const srv = createServer((req, res) => routes.handle(req, res, new URL(req.url, 'http://x')));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const go = (method, path, { body, cookie } = {}) => new Promise((ok, bad) => {
    const r = request({ host: '127.0.0.1', port: srv.address().port, method, path,
      headers: { ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(cookie ? { Cookie: cookie } : {}) } },
    (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t })); });
    r.on('error', bad); if (body) r.write(body); r.end();
  });
  return { go, close: () => new Promise((ok) => srv.close(ok)), clock };
}

test('data.json without a session is 401; the page without one is the sign-in, no figures', async () => {
  const s = await serve('mirror');
  try {
    assert.equal((await s.go('GET', '/snapshot/data.json')).status, 401);
    const p = await s.go('GET', '/snapshot');
    assert.equal(p.status, 200);
    assert.match(p.text, /name="code"/);
    assert.doesNotMatch(p.text, /45,000/);
  } finally { await s.close(); }
});

test('signing in sets HttpOnly; Secure; SameSite=Strict; Path=/snapshot for 12 h, and the page shows the figures', async () => {
  const s = await serve('mirror');
  try {
    const body = `user=abode&password=the-right-password&code=${codeAt(s.clock.t)}&lang=en`;
    const r = await s.go('POST', '/snapshot/login', { body });
    assert.equal(r.status, 303);
    const c = String(r.headers['set-cookie']);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/snapshot', 'Max-Age=43200']) assert.ok(c.includes(flag), flag + ' in ' + c);
    const cookie = c.split(';')[0];
    const page = await s.go('GET', '/snapshot?lang=en', { cookie });
    assert.match(page.text, /Last synced/);
    assert.match(page.text, /45,000 SYP/);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    assert.doesNotMatch(page.text, /<script/i);
    const data = JSON.parse((await s.go('GET', '/snapshot/data.json', { cookie })).text);
    assert.equal(data.mode, 'mirror');
    assert.deepEqual(data.figures.today.takings, { SYP: 45000 });
    const ar = await s.go('GET', '/snapshot?lang=ar', { cookie });
    assert.match(ar.text, /dir="rtl"/);
    assert.match(ar.text, /آخر مزامنة/);
  } finally { await s.close(); }
});

test('a wrong code at the door answers 401 and sets no cookie', async () => {
  const s = await serve('mirror');
  try {
    const r = await s.go('POST', '/snapshot/login', { body: 'user=abode&password=the-right-password&code=000000' });
    assert.equal(r.status, 401);
    assert.equal(r.headers['set-cookie'], undefined);
  } finally { await s.close(); }
});

test('while the mode is live the page says so and links to /, with no figures', async () => {
  const s = await serve('live');
  try {
    const r = await s.go('POST', '/snapshot/login', { body: `user=abode&password=the-right-password&code=${codeAt(s.clock.t)}` });
    const cookie = String(r.headers['set-cookie']).split(';')[0];
    const p = await s.go('GET', '/snapshot?lang=en', { cookie });
    assert.match(p.text, /The shop is online/);
    assert.match(p.text, /href="\/"/);
    assert.doesNotMatch(p.text, /45,000/);
    const d = JSON.parse((await s.go('GET', '/snapshot/data.json', { cookie })).text);
    assert.equal(d.figures, undefined);
  } finally { await s.close(); }
});
