// Night mode's routes (night.js) over real HTTP, with a stub mirror that
// records every call and a clock that is a number. What they must never do:
// show a staff account the money, send a request without the session's own
// form token, send one at all while requests are switched off, or draw a page
// the CSP hash does not cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { hashPassword, hotp, base32Decode, base32Encode, makeAuth, parseUsers } from '../src/snapshot-auth.js';
import { nightRoutes, ROLES } from '../src/night.js';

const SECRET = base32Encode(Buffer.from('night-routes-test-secret'));
const T0 = Date.parse('2026-09-23T20:30:00Z');           /* 23:30 in Aleppo */
const BEAT = '2026-09-23T20:15:00Z';                      /* 23:15 in Aleppo */
const codeAt = (ms) => hotp(base32Decode(SECRET), Math.floor(ms / 30000));

const FIG_ROWS = {
  sales: [{ id: 'INV-1', at: '2026-09-23T08:00:00Z', currency: 'SYP', total: '45000', payment: 'cash' }],
  returns: [], balances: [{ place: 'drawer', currency: 'SYP', amount: '45000', last: '2026-09-23T08:00:00Z' }],
  checks: [], config: [{ key: 'shop.name', value: 'OG Test' }], users: [{ id: 7, name: 'Abode' }],
  currencies: [{ code: 'SYP', minor_exp: 0 }, { code: 'USD', minor_exp: 2 }], suppliers: [],
  road: [{ status: 'waiting', n: '2' }], driverCash: [], stock: [], lastSales: [], lastItems: []
};

const LIST = [
  { ref: 'N-0003', source: 'night', state: 'rejected', code: 'out_of_stock', note: 'none left', byUser: 'karim', at: '2026-09-23T19:00:00Z', payload: { customer: { name: 'Rami', phone: '0944' }, items: [{ sku: 'OG-050-42', qty: 1, name: 'Samba OG', size: '42' }], delivery: { method: 'pickup' } } },
  { ref: 'N-0002', source: 'night', state: 'accepted', saleId: 'INV-2105', byUser: 'sara', at: '2026-09-23T18:00:00Z', payload: { customer: { name: 'Nour', phone: '0933' }, items: [{ sku: 'OG-050-42', qty: 2, name: 'Samba OG', size: '42' }], delivery: { method: 'delivery', city: 'Aleppo', address: 'New Aleppo' } } },
  { ref: 'N-0001', source: 'night', state: 'waiting', byUser: 'sara', at: '2026-09-23T17:00:00Z', payload: { customer: { name: 'Lina', phone: '0911' }, items: [{ sku: 'OG-051-42', qty: 1, name: 'Air Force 1', size: '42', colour: 'White', colourAr: 'أبيض' }], delivery: { method: 'pickup' } } }
];

function stubMirror() {
  const calls = [];
  const m = {
    calls, next: null, fail: false,
    async query(sql, params) {
      calls.push({ fn: 'query', sql, params });
      if (sql.includes('FROM public.currencies')) return [{ code: 'SYP', minor_exp: 0 }, { code: 'USD', minor_exp: 2 }];
      if (sql.includes('FROM public.warehouses')) return [{ id: 'floor', name: 'Shop floor', name_ar: 'الصالة' }, { id: 'store', name: 'Back storage', name_ar: 'المستودع' }];
      if (/^SELECT p\.id FROM public\.products/.test(sql.trim())) return [{ id: '50' }];
      if (sql.includes('WHERE p.id = ANY')) return [
        { id: '50', name: 'Samba OG', brand: 'Adidas', colorway: null, currency: 'SYP', selling_price: '450000', sku: 'OG-050-42', size: '42', colours: '1', wh_id: 'floor', qty: 2 },
        { id: '50', name: 'Samba OG', brand: 'Adidas', colorway: null, currency: 'SYP', selling_price: '450000', sku: 'OG-050-42', size: '42', colours: '1', wh_id: 'store', qty: 3 },
        { id: '50', name: 'Samba OG', brand: 'Adidas', colorway: null, currency: 'SYP', selling_price: '450000', sku: 'OG-050-43', size: '43', colours: '1', wh_id: 'store', qty: 0 }];
      if (sql.includes('WHERE v.sku = ANY')) return (params[0] || []).map((sku) => ({ sku, size: sku.slice(-2), id: '50', name: 'Samba OG', currency: 'SYP', selling_price: '450000', qty: '5' }));
      if (sql.includes('WHERE id = $1 AND NOT archived')) return Number(params[0]) === 81 ? [{ id: '81', name: 'Nour Haddad', phone: '0933 123 456', city: 'Aleppo', address: 'New Aleppo', note: null }] : [];
      if (sql.includes('FROM public.customers c')) return [{ id: '81', name: 'Nour Haddad', phone: '0933 123 456', city: 'Aleppo' }];
      if (sql.includes('WHERE s.customer_id = $1')) return [];
      if (sql.includes("WHERE s.payment = 'order'")) return [{ id: 'INV-2105', at: '2026-09-23T18:30:00Z', currency: 'SYP', total: '900000', voided: false, customer: 'Nour Haddad', status: 'out', method: 'driver', city: 'Aleppo' }];
      if (sql.includes('FROM public.sale_items')) return [{ sale_id: 'INV-2105', name: 'Samba OG', size: '42', qty: 2 }];
      throw new Error('stub mirror: unexpected SQL ' + sql.slice(0, 80));
    },
    async rows() { calls.push({ fn: 'rows' }); return FIG_ROWS; },
    async requestsList(user, limit) { calls.push({ fn: 'list', user, limit }); return { ok: true, items: LIST.filter((r) => user === null || r.byUser === user) }; },
    async submit(user, op, req) {
      calls.push({ fn: 'submit', user, op, req });
      if (m.fail) throw new Error('connection refused');
      return m.next || { ok: true, ref: 'N-0007', state: 'waiting', at: '2026-09-23T20:31:00Z' };
    }
  };
  return m;
}

let HASH;
async function serve(configExtra = {}, mode = 'mirror') {
  HASH = HASH || await hashPassword('the-night-password');
  const clock = { t: T0 };
  const users = parseUsers(JSON.stringify([
    { user: 'sara', role: 'staff', scrypt: HASH, totpSecret: SECRET },
    { user: 'abode', role: 'owner', scrypt: HASH, totpSecret: SECRET },
    { user: 'wael', role: 'manager', scrypt: HASH, totpSecret: SECRET }
  ]), { roles: ROLES });
  const auth = makeAuth({ users, now: () => clock.t, cookieName: 'og_night', path: '/night' });
  const mirror = stubMirror();
  const road = { state: { mode, beatAt: BEAT, ageMs: 15 * 60000 } };
  const routes = nightRoutes({ config: { shopTz: 'Asia/Damascus', proxyNets: '10.0.0.0/8', nightSubmit: 'on', nightMaxPerHour: 20, ...configExtra },
                               mirror, road, auth, now: () => clock.t });
  const srv = createServer((req, res) => routes.handle(req, res, new URL(req.url, 'http://x')));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = srv.address().port;
  const go = (method, path, { body, cookie, origin } = {}) => new Promise((ok, bad) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (cookie) headers.Cookie = cookie;
    if (method === 'POST') headers.Origin = origin || `http://127.0.0.1:${port}`;
    const r = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t }));
    });
    r.on('error', bad); if (body !== undefined) r.write(body); r.end();
  });
  let codeStep = 0;
  async function signIn(user) {
    /* A fresh 30 s step for every sign-in: a code is spent once. */
    clock.t = T0 + (codeStep++) * 30000;
    const r = await go('POST', '/night/login', { body: `user=${user}&password=the-night-password&code=${codeAt(clock.t)}` });
    assert.equal(r.status, 303, 'sign-in for ' + user + ': ' + r.status);
    const cookie = [].concat(r.headers['set-cookie']).find((c) => c.startsWith('og_night=')).split(';')[0];
    const home = await go('GET', '/night', { cookie });
    const t = /name="t" value="([0-9a-f]+)"/.exec(home.text);
    return { cookie, t: t && t[1], home };
  }
  return { go, signIn, mirror, clock, close: () => new Promise((ok) => srv.close(ok)) };
}

/* The page's own stylesheet must be exactly what the CSP's hash covers. */
function cspOk(res) {
  const csp = res.headers['content-security-policy'] || '';
  const style = /<style>([\s\S]*?)<\/style>/.exec(res.text);
  if (!style) return 'no <style>';
  const want = "'sha256-" + createHash('sha256').update(style[1], 'utf8').digest('base64') + "'";
  if (!csp.includes(want)) return 'hash not in CSP';
  if ((res.text.match(/<style/g) || []).length !== 1) return 'more than one <style>';
  if (/unsafe-inline|unsafe-eval/.test(csp)) return 'unsafe in CSP';
  if (!/default-src 'none'/.test(csp)) return 'no default-src none';
  if (/<script/i.test(res.text)) return '<script> on the page';
  if (/\sstyle\s*=/i.test(res.text)) return 'a style= attribute';
  if (res.headers['cache-control'] !== 'no-store') return 'not no-store';
  if (res.headers['x-frame-options'] !== 'DENY') return 'frames allowed';
  return null;
}
const form = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

test('no session: the sign-in page, in Arabic, with the banner and its data time', async () => {
  const s = await serve();
  try {
    const p = await s.go('GET', '/night');
    assert.equal(p.status, 200);
    assert.match(p.text, /<html lang="ar" dir="rtl">/);
    assert.match(p.text, /وضع الليل · البيانات من الساعة/);
    assert.match(p.text, /23:15/);
    assert.match(p.text, /name="code"/);
    assert.equal(cspOk(p), null);
    assert.equal(s.mirror.calls.length, 0, 'the sign-in page reads nothing');
    for (const path of ['/night/stock', '/night/requests', '/night/customers/81']) {
      const r = await s.go('GET', path);
      assert.equal(r.status, 303, path);
      assert.equal(r.headers.location, '/night');
    }
  } finally { await s.close(); }
});

test('a staff account never sees the money, and the money is never even read for it', async () => {
  const s = await serve();
  try {
    const { home } = await s.signIn('sara');
    assert.equal(home.status, 200);
    assert.doesNotMatch(home.text, /45,000/);
    assert.doesNotMatch(home.text, /class="hero"/);
    assert.equal(s.mirror.calls.filter((c) => c.fn === 'rows').length, 0);
    assert.deepEqual(s.mirror.calls.filter((c) => c.fn === 'list').map((c) => c.user), ['sara']);
    assert.equal(cspOk(home), null);
  } finally { await s.close(); }
});

test('the owner and the manager see today\'s takings', async () => {
  const s = await serve();
  try {
    for (const who of ['abode', 'wael']) {
      const { home } = await s.signIn(who);
      assert.match(home.text, /45,000 SYP/, who);
    }
    assert.ok(s.mirror.calls.some((c) => c.fn === 'rows'));
  } finally { await s.close(); }
});

test('the sign-in cookie: og_night, HttpOnly, Secure, SameSite=Strict, Path=/night', async () => {
  const s = await serve();
  try {
    const r = await s.go('POST', '/night/login', { body: `user=sara&password=the-night-password&code=${codeAt(T0)}` });
    const c = [].concat(r.headers['set-cookie']).find((x) => x.startsWith('og_night='));
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/night', 'Max-Age=43200']) assert.ok(c.includes(part), part);
    const bad = await s.go('POST', '/night/login', { body: 'user=sara&password=wrong&code=000000' });
    assert.equal(bad.status, 401);
    assert.equal([].concat(bad.headers['set-cookie'] || []).some((x) => x.startsWith('og_night=')), false);
  } finally { await s.close(); }
});

test('staff list their own requests only; the owner may list everybody\'s', async () => {
  const s = await serve();
  try {
    const sara = await s.signIn('sara');
    const mine = await s.go('GET', '/night/requests?all=1', { cookie: sara.cookie });
    assert.doesNotMatch(mine.text, /N-0003/);
    assert.match(mine.text, /N-0002/);
    assert.match(mine.text, /INV-2105/);
    assert.equal(s.mirror.calls.filter((c) => c.fn === 'list').pop().user, 'sara');
    const abode = await s.signIn('abode');
    const all = await s.go('GET', '/night/requests?all=1&lang=en', { cookie: abode.cookie });
    assert.equal(s.mirror.calls.filter((c) => c.fn === 'list').pop().user, null);
    assert.match(all.text, /N-0003/);
    assert.match(all.text, /Out of stock/);
    assert.match(all.text, /none left/);
    assert.match(all.text, /Waiting for the shop/);
    assert.equal(cspOk(all), null);
  } finally { await s.close(); }
});

test('a POST without its session\'s token, or from another site, is refused and sends nothing', async () => {
  const s = await serve();
  try {
    const { cookie, t } = await s.signIn('sara');
    assert.ok(t);
    await s.go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 1 }) });
    const body = form({ name: 'Nour Haddad', phone: '0933123456', method: 'pickup' });
    assert.equal((await s.go('POST', '/night/request', { cookie, body })).status, 403);
    assert.equal((await s.go('POST', '/night/request', { cookie, body: body + '&t=' + 'a'.repeat(48) })).status, 403);
    assert.equal((await s.go('POST', '/night/request', { cookie, body: body + '&t=' + t, origin: 'https://evil.example' })).status, 403);
    const other = await s.signIn('abode');
    assert.equal((await s.go('POST', '/night/request', { cookie, body: body + '&t=' + other.t })).status, 403);
    assert.equal(s.mirror.calls.filter((c) => c.fn === 'submit').length, 0);
  } finally { await s.close(); }
});

test('the draft: add, change, remove, pick a customer, and the request goes once', async () => {
  const s = await serve();
  try {
    const { cookie, t } = await s.signIn('sara');
    const add = await s.go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 2, q: 'samba' }) });
    assert.equal(add.status, 303);
    assert.equal(add.headers.location, '/night/stock?added=1&q=samba');
    await s.go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 1 }) });
    await s.go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-43', qty: 1 }) });
    let page = await s.go('GET', '/night/request', { cookie });
    assert.match(page.text, /<option selected>3<\/option>/, 'the same size added twice is one line of 3');
    await s.go('POST', '/night/request/line', { cookie, body: form({ t, sku: 'OG-050-43', do: 'remove' }) });
    await s.go('POST', '/night/request/line', { cookie, body: form({ t, sku: 'OG-050-42', do: 'set', qty: 2 }) });
    await s.go('POST', '/night/request/customer', { cookie, body: form({ t, id: 81 }) });
    page = await s.go('GET', '/night/request', { cookie });
    assert.match(page.text, /value="Nour Haddad"/);
    assert.match(page.text, /value="New Aleppo"|>New Aleppo</);
    assert.doesNotMatch(page.text, /OG-050-43/);
    assert.equal(cspOk(page), null);

    const sent = await s.go('POST', '/night/request', { cookie, body: form({ t, name: 'Nour Haddad', phone: '٠٩٣٣ ١٢٣ ٤٥٦', method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery', note: '' }) });
    assert.equal(sent.status, 303);
    assert.equal(sent.headers.location, '/night/requests?sent=N-0007');
    const sub = s.mirror.calls.filter((c) => c.fn === 'submit');
    assert.equal(sub.length, 1);
    assert.equal(sub[0].user, 'sara');
    assert.match(sub[0].op, /^[A-Za-z0-9_-]{16,64}$/);
    assert.deepEqual(sub[0].req, { v: 1, customer: { name: 'Nour Haddad', phone: '0933 123 456', id: 81 },
      items: [{ sku: 'OG-050-42', qty: 2 }], delivery: { method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery' }, note: null });
    const after = await s.go('GET', '/night/request', { cookie });
    assert.doesNotMatch(after.text, /value="Nour Haddad"/, 'the draft starts again after a request goes');
  } finally { await s.close(); }
});

test('the cloud not answering keeps the draft AND its op, so sending again is the same request', async () => {
  const s = await serve();
  try {
    const { cookie, t } = await s.signIn('sara');
    await s.go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 1 }) });
    const body = form({ t, name: 'Nour', phone: '0933123456', method: 'pickup' });
    s.mirror.fail = true;
    const down = await s.go('POST', '/night/request', { cookie, body });
    assert.equal(down.status, 503);
    assert.match(down.text, /ما انبعت شي/);
    s.mirror.fail = false;
    assert.equal((await s.go('POST', '/night/request', { cookie, body })).status, 303);
    const ops = s.mirror.calls.filter((c) => c.fn === 'submit').map((c) => c.op);
    assert.equal(ops.length, 2);
    assert.equal(ops[0], ops[1]);
  } finally { await s.close(); }
});

test('a refusal from the SQL is shown under its field; op_taken gets a new op', async () => {
  const s = await serve();
  try {
    const { cookie, t } = await s.signIn('sara');
    await s.go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 1 }) });
    const body = form({ t, name: 'Nour', phone: '0933123456', method: 'pickup' });
    s.mirror.next = { ok: false, code: 'too_many_phone', field: 'customer.phone' };
    const r = await s.go('POST', '/night/request?lang=en', { cookie, body: body + '&lang=en' });
    assert.equal(r.status, 422);
    assert.match(r.text, /already has 5 requests/);
    s.mirror.next = { ok: false, code: 'unknown_sku', sku: 'OG-050-42' };
    const u = await s.go('POST', '/night/request', { cookie, body: body + '&lang=en' });
    assert.match(u.text, /no longer for sale: <bdi dir="ltr" class="fig">OG-050-42<\/bdi>/);
    s.mirror.next = { ok: false, code: 'op_taken' };
    await s.go('POST', '/night/request', { cookie, body });
    s.mirror.next = null;
    await s.go('POST', '/night/request', { cookie, body });
    const ops = s.mirror.calls.filter((c) => c.fn === 'submit').map((c) => c.op);
    assert.equal(ops[2], ops[1]);
    assert.notEqual(ops[3], ops[2]);
  } finally { await s.close(); }
});

test('a form that does not pass the rules never reaches the cloud', async () => {
  const s = await serve();
  try {
    const { cookie, t } = await s.signIn('sara');
    const r = await s.go('POST', '/night/request', { cookie, body: form({ t, name: 'N', phone: '12', method: 'delivery', city: '', address: '' }) });
    assert.equal(r.status, 422);
    for (const w of ['اكتب اسمه', 'اكتب رقم موبايل', 'أضف قياس واحد', 'اكتب المدينة', 'اكتب العنوان']) assert.ok(r.text.includes(w), w);
    assert.equal(s.mirror.calls.filter((c) => c.fn === 'submit').length, 0);
  } finally { await s.close(); }
});

test('OG_NIGHT_SUBMIT=off: look things up, send nothing', async () => {
  const s = await serve({ nightSubmit: 'off' });
  try {
    const { cookie, t } = await s.signIn('sara');
    await s.go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 1 }) });
    const page = await s.go('GET', '/night/request', { cookie });
    assert.match(page.text, /الطلبات مسكّرة الليلة/);
    assert.match(page.text, /type="submit" disabled>/);
    const r = await s.go('POST', '/night/request', { cookie, body: form({ t, name: 'Nour', phone: '0933123456', method: 'pickup' }) });
    assert.equal(r.status, 403);
    assert.equal(s.mirror.calls.filter((c) => c.fn === 'submit').length, 0);
    assert.equal((await s.go('GET', '/night/stock?q=samba', { cookie })).status, 200);
  } finally { await s.close(); }
});

test('the per-hour limit stops a flood before the SQL has to', async () => {
  const s = await serve({ nightMaxPerHour: 2 });
  try {
    const { cookie, t } = await s.signIn('sara');
    const codes = [];
    for (let i = 0; i < 3; i++) {
      await s.go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 1 }) });
      s.mirror.next = { ok: true, ref: 'N-00' + (10 + i), state: 'waiting' };
      codes.push((await s.go('POST', '/night/request', { cookie, body: form({ t, name: 'Nour', phone: '0933123456', method: 'pickup' }) })).status);
    }
    assert.deepEqual(codes, [303, 303, 429]);
    assert.equal(s.mirror.calls.filter((c) => c.fn === 'submit').length, 2);
  } finally { await s.close(); }
});

test('stock, customers and orders pages: read-only, hashed CSP, both languages', async () => {
  const s = await serve();
  try {
    const { cookie } = await s.signIn('sara');
    const st = await s.go('GET', '/night/stock?q=samba%2042', { cookie });
    assert.match(st.text, /Samba OG/);
    assert.match(st.text, /<span class="pl">الصالة <bdi dir="ltr" class="fig">2<\/bdi><\/span> <span class="pl">المستودع <bdi dir="ltr" class="fig">3<\/bdi><\/span>/);
    assert.match(st.text, /لحد الساعة/);
    const en = await s.go('GET', '/night/customers?q=0933&lang=en', { cookie });
    assert.match([].concat(en.headers['set-cookie']).join(';'), /og_night_lang=en/);
    assert.match(en.text, /<html lang="en" dir="ltr">/);
    assert.match(en.text, /Nour Haddad/);
    const cu = await s.go('GET', '/night/customers/81', { cookie: cookie + '; og_night_lang=en' });
    assert.match(cu.text, /href="tel:0933123456"/);
    const or = await s.go('GET', '/night/orders?status=out', { cookie });
    assert.match(or.text, /INV-2105/);
    assert.match(or.text, /بالطريق/);
    for (const p of [st, en, cu, or]) assert.equal(cspOk(p), null);
    assert.equal(s.mirror.calls.filter((c) => c.fn === 'submit').length, 0);
    const lost = await s.go('GET', '/night/nothing', { cookie });
    assert.equal(lost.status, 404);
  } finally { await s.close(); }
});

test('while the shop is live, home says so and links to the full system; night mode still works', async () => {
  const s = await serve({}, 'live');
  try {
    const { home } = await s.signIn('sara');
    assert.match(home.text, /المحل شغّال هلأ/);
    assert.match(home.text, /href="\/"/);
    assert.match(home.text, /href="\/night\/request"/);
  } finally { await s.close(); }
});

test('logging out needs the form token, then the session is gone', async () => {
  const s = await serve();
  try {
    const { cookie, t } = await s.signIn('sara');
    assert.equal((await s.go('POST', '/night/logout', { cookie, body: '' })).status, 403);
    const out = await s.go('POST', '/night/logout', { cookie, body: form({ t }) });
    assert.equal(out.status, 303);
    assert.equal((await s.go('GET', '/night/stock', { cookie })).status, 303);
  } finally { await s.close(); }
});
