#!/usr/bin/env node
/* ==========================================================================
   Night mode against a REAL Postgres.          node tools/night-mode/bridge.mjs
   --------------------------------------------------------------------------
   og-bridge's own night routes (vps/og-bridge/src/night.js) and its own
   mirror.js, over real HTTP, reading PGlite (OG_PGLITE, see lib.mjs) that
   holds the mirror's schema 001 → 035 — every statement run AS og_vps with
   the read-only default 030 gives it. The stub-mirror unit tests prove the
   routes; this proves the SQL: the searches, the joins, the array
   parameters, and that the one READ WRITE transaction is the submit's.
   ========================================================================== */
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mirrorDb, seedMirror, seedOrders, ogVpsPool, check, done, REPO } from './lib.mjs';

const src = (f) => import(pathToFileURL(join(REPO, 'vps', 'og-bridge', 'src', f)).href);
const { makeMirror } = await src('mirror.js');
const { nightRoutes, ROLES } = await src('night.js');
const { makeAuth, parseUsers, hashPassword, hotp, base32Decode, base32Encode } = await src('snapshot-auth.js');

const db = await mirrorDb();
await seedMirror(db);
await seedOrders(db);
const pool = ogVpsPool(db);
const mirror = makeMirror({ pool });

const SECRET = base32Encode(Buffer.from('night-bridge-test-secret'));
const clock = { t: Date.now() };
const hash = await hashPassword('bridge-test-password');
const users = parseUsers(JSON.stringify([
  { user: 'sara', role: 'staff', scrypt: hash, totpSecret: SECRET },
  { user: 'abode', role: 'owner', scrypt: hash, totpSecret: SECRET }
]), { roles: ROLES });
const auth = makeAuth({ users, now: () => clock.t, cookieName: 'og_night', path: '/night' });
const status = await mirror.tillStatus();
check('erp.till_status answers as og_vps', status.ok && status.lineageId === 'lin-night-0001', JSON.stringify(status));
const road = { state: { mode: 'mirror', beatAt: new Date(status.beatAt).toISOString() } };
const routes = nightRoutes({ config: { shopTz: 'Asia/Damascus', proxyNets: '', nightSubmit: 'on', nightMaxPerHour: 20 },
                             mirror, road, auth, now: () => clock.t, log: () => {} });
const srv = createServer((req, res) => routes.handle(req, res, new URL(req.url, 'http://x')));
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const port = srv.address().port;

function go(method, path, { body, cookie } = {}) {
  return new Promise((ok, bad) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (cookie) headers.Cookie = cookie;
    if (method === 'POST') headers.Origin = `http://127.0.0.1:${port}`;
    const r = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t }));
    });
    r.on('error', bad); if (body !== undefined) r.write(body); r.end();
  });
}
const form = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
let step = 0;
async function signIn(user) {
  clock.t = Date.now() + (step++) * 30000;
  const code = hotp(base32Decode(SECRET), Math.floor(clock.t / 30000));
  const r = await go('POST', '/night/login', { body: form({ user, password: 'bridge-test-password', code }) });
  const cookie = [].concat(r.headers['set-cookie'] || []).find((c) => c.startsWith('og_night=')).split(';')[0];
  const home = await go('GET', '/night', { cookie });
  return { cookie, t: (/name="t" value="([0-9a-f]+)"/.exec(home.text) || [])[1], home };
}
const q = (s) => encodeURIComponent(s);
const hasRow = (text, s) => text.includes(s);

try {
  /* ---- home ------------------------------------------------------------ */
  const owner = await signIn('abode');
  check('owner home answers 200 with today\'s takings from the mirror', owner.home.status === 200 && /class="hero"/.test(owner.home.text), owner.home.status);
  const staff = await signIn('sara');
  check('staff home has no takings', staff.home.status === 200 && !/class="hero"/.test(staff.home.text));

  /* ---- stock ----------------------------------------------------------- */
  const s1 = await go('GET', '/night/stock?q=' + q('samba'), { cookie: staff.cookie });
  check('stock: "samba" finds Samba OG', s1.status === 200 && hasRow(s1.text, 'Samba OG') && !hasRow(s1.text, 'Air Force 1'), s1.status);
  check('stock: the quantity per place is drawn (floor 2 · storage 3)',
    /الصالة <bdi dir="ltr" class="fig">2<\/bdi> · المستودع <bdi dir="ltr" class="fig">3<\/bdi>/.test(s1.text));
  const s2 = await go('GET', '/night/stock?q=' + q('nike 42'), { cookie: staff.cookie });
  check('stock: "nike 42" — every word must match — finds Air Force 1 only', hasRow(s2.text, 'Air Force 1') && !hasRow(s2.text, 'Samba OG'));
  check('stock: a two-colour product names its colours', hasRow(s2.text, 'أبيض') && hasRow(s2.text, 'أسود'));
  const s3 = await go('GET', '/night/stock?q=' + q('OG-051-C2'), { cookie: staff.cookie });
  check('stock: a SKU finds its product', hasRow(s3.text, 'Air Force 1'));
  const s4 = await go('GET', '/night/stock?q=' + q('old runner'), { cookie: staff.cookie });
  check('stock: an archived product is never listed', !hasRow(s4.text, 'Old runner'));
  const s5 = await go('GET', '/night/stock?q=' + q('50%_x'), { cookie: staff.cookie });
  check('stock: % and _ are searched for, not obeyed', s5.status === 200 && !hasRow(s5.text, 'Samba OG'));
  const s6 = await go('GET', '/night/stock', { cookie: staff.cookie });
  check('stock: no words lists the products changed most recently', hasRow(s6.text, 'Samba OG') && hasRow(s6.text, 'Air Force 1') && !hasRow(s6.text, 'Old runner'));

  /* ---- customers ------------------------------------------------------- */
  for (const [term, who] of [['nour', 'Nour Haddad'], ['0933123456', 'Nour Haddad'], ['+963 933 123', 'Nour Haddad'],
                             ['٠٩٤٤٥٥٥', 'Rami Khoury'], ['944 555 666', 'Rami Khoury']]) {
    const r = await go('GET', '/night/customers?q=' + q(term), { cookie: staff.cookie });
    check(`customers: "${term}" finds ${who}`, r.status === 200 && hasRow(r.text, who), r.status);
  }
  const c0 = await go('GET', '/night/customers?q=' + q('z'), { cookie: staff.cookie });
  check('customers: one letter lists nobody (a lookup, not a directory)', !hasRow(c0.text, 'Nour Haddad') && !hasRow(c0.text, 'Rami'));
  const c1 = await go('GET', '/night/customers/81', { cookie: staff.cookie });
  check('customer page: details, recent orders with their status and items',
    c1.status === 200 && hasRow(c1.text, 'INV-3003') && hasRow(c1.text, 'وصل') && hasRow(c1.text, 'Samba OG') && hasRow(c1.text, 'href="tel:0933123456"'), c1.status);
  const c2 = await go('GET', '/night/customers/999', { cookie: staff.cookie });
  check('customer page: an unknown id is 404', c2.status === 404);

  /* ---- orders ---------------------------------------------------------- */
  const o1 = await go('GET', '/night/orders', { cookie: staff.cookie });
  check('orders: every order, never a till sale', hasRow(o1.text, 'INV-3001') && hasRow(o1.text, 'INV-3004') && !hasRow(o1.text, 'INV-3005'));
  const o2 = await go('GET', '/night/orders?status=out', { cookie: staff.cookie });
  check('orders: status=out is the order on the road only', hasRow(o2.text, 'INV-3002') && !hasRow(o2.text, 'INV-3001'));
  const o3 = await go('GET', '/night/orders?status=waiting', { cookie: staff.cookie });
  check('orders: a cancelled order is not "waiting"', hasRow(o3.text, 'INV-3001') && !hasRow(o3.text, 'INV-3004'));
  const o4 = await go('GET', '/night/orders?status=cancelled', { cookie: staff.cookie });
  check('orders: status=cancelled is the voided one', hasRow(o4.text, 'INV-3004') && !hasRow(o4.text, 'INV-3001'));

  /* ---- a request, end to end ------------------------------------------- */
  const t = staff.t, cookie = staff.cookie;
  await go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 2 }) });
  await go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-051-C2-42', qty: 1 }) });
  await go('POST', '/night/request/customer', { cookie, body: form({ t, id: 81 }) });
  const draft = await go('GET', '/night/request', { cookie });
  check('the draft reads its lines from the mirror (names, colour)', hasRow(draft.text, 'Samba OG') && hasRow(draft.text, 'أسود'));
  check('the draft is prefilled from the chosen customer', hasRow(draft.text, 'value="Nour Haddad"') && hasRow(draft.text, 'New Aleppo'));
  const body = form({ t, name: 'Nour Haddad', phone: '0933 123 456', method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery', note: 'Call after 6' });
  const sent = await go('POST', '/night/request', { cookie, body });
  const ref = decodeURIComponent((/sent=([^&]+)/.exec(sent.headers.location || '') || [])[1] || '');
  check('sending it answers the requests list with its ref', sent.status === 303 && /^N-\d{4,}$/.test(ref), sent.status + ' ' + sent.headers.location);
  const row = (await db.query('SELECT * FROM inbox.requests WHERE ref = $1', [ref])).rows[0];
  check('…and the row in inbox.requests is the night user\'s, waiting', row && row.by_user === 'sara' && row.state === 'waiting' && row.source === 'night');
  check('…with the payload built from the mirror', row && row.payload.items.length === 2 && row.payload.items[1].colourAr === 'أسود' && row.payload.customer.id === 81);
  const list = await go('GET', '/night/requests', { cookie });
  check('my requests shows it waiting for the shop', hasRow(list.text, ref) && hasRow(list.text, 'بانتظار المحل'));

  /* the same form sent again, as a double tap on a slow line does */
  const n0 = (await db.query('SELECT count(*)::int AS n FROM inbox.requests')).rows[0].n;
  await go('POST', '/night/request/add', { cookie, body: form({ t, sku: 'OG-050-42', qty: 1 }) });
  const once = form({ t, name: 'Lina Saleh', phone: '0911 222 333', method: 'pickup' });
  const a = await go('POST', '/night/request', { cookie, body: once });
  const b = await go('POST', '/night/request', { cookie, body: once });
  const n1 = (await db.query('SELECT count(*)::int AS n FROM inbox.requests')).rows[0].n;
  check('a second press after the first went finds an empty draft and sends nothing new', a.status === 303 && b.status === 422 && n1 === n0 + 1, `${a.status} ${b.status} ${n0}→${n1}`);

  /* an owner lists everybody's */
  const all = await go('GET', '/night/requests?all=1', { cookie: owner.cookie });
  check('the owner lists everybody\'s', hasRow(all.text, ref) && hasRow(all.text, 'sara'));

  /* ---- the only READ WRITE is the submit's ----------------------------- */
  const rw = pool.log.map((s, i) => [s, i]).filter(([s]) => /BEGIN READ WRITE/i.test(s));
  check('BEGIN READ WRITE was used (for the submits)', rw.length === 2, 'count ' + rw.length);
  check('…and every one is followed at once by erp.request_submit',
    rw.every(([, i]) => /erp\.request_submit/.test(pool.log[i + 1] || '') && /^COMMIT$/.test(pool.log[i + 2] || '')));
  check('no read ever opened a transaction', pool.log.filter((s) => /^\s*BEGIN/i.test(s)).length === rw.length);
  check('og_vps never ran an INSERT, UPDATE or DELETE of its own', !pool.log.some((s) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s)));
} catch (e) {
  check('no exception', false, e && e.stack);
} finally {
  srv.close();
}
done('night-mode bridge');
