#!/usr/bin/env node
/* ==========================================================================
   The laptop's half of night mode.            node tools/night-mode/laptop.mjs
   --------------------------------------------------------------------------
   A SCRATCH database (a temp folder, built by the migrations — never a real
   one), the server's own libraries in-process, and a fake cloud that
   answers requests_take / requests_mark the way 035 does. Then the same
   scratch data served by this worktree's own server over HTTP.

   Proves: collecting stores each request once and reports "received"; Accept
   makes a real order through Orders.create (a sale, its delivery row with
   the marker, the stock moved) and the decision goes back; a second Accept,
   a re-take after the shop moved laptops, and a retried desk Save never make
   a second order; Reject is reported; an unknown size or too little stock
   writes nothing; the customer is the hinted one only while the phone
   matches; a new customer needs customer.write; the bell row; the routes
   refuse an account without delivery.desk. Everything is read back from
   SQLite, never off a response alone.

   No Supabase, no Telegram (no tokens at all), no network. The env is set BEFORE
   any server module is imported, so nothing reads a real server/.env.
   ========================================================================== */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { request, createServer } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..', '..', 'server');
const SCR = join(tmpdir(), 'og-night-laptop-' + process.pid);
/* A port nothing is listening on right now: other sessions run their own
   sandboxes on this machine, and a fixed number collided with one. */
const PORT = Number(process.env.OG_NIGHT_TEST_PORT) || await new Promise((ok) => {
  const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
});
const LIN = 'lin-laptop-test-0001';
const PW = 'night-laptop-test-pass';

rmSync(SCR, { recursive: true, force: true });
mkdirSync(join(SCR, 'data'), { recursive: true });
const ENV = join(SCR, '.env');
const ENVS = {
  OG_PORT: String(PORT), OG_HTTPS: '0', OG_SECURE: '0', OG_ORIGINS: '', OG_SYNC_MINUTES: '0', OG_PULL_AT_BOOT: '0',
  OG_PUSH: '0'
};
writeFileSync(ENV, Object.entries(ENVS).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
Object.assign(process.env, ENVS, { OG_ENV_FILE: ENV, OG_DATA_DIR: join(SCR, 'data'), SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
/* No bot at all: OG_ENV_FILE keeps any real server/.env out, and a bogus
   token would still be sent to Telegram by the bot's first getMe. */
delete process.env.OG_TELEGRAM_TOKEN_OG;
delete process.env.OG_TELEGRAM_TOKEN_YALLA;

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
  return !!ok;
};

const src = (p) => import(pathToFileURL(join(SERVER, p)).href);
const DB = await src('lib/db.js');
DB.open(join(SCR, 'data', 'og.db'));
const Auth = await src('lib/auth.js');
const Cat = await src('lib/catalogue.js');
const Customers = await src('lib/customers.js');
const Requests = await src('lib/requests.js');
const d = DB.get();

/* ---- the scratch shop -------------------------------------------------- */
d.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('sync.lineage', ?, ?)").run(LIN, new Date().toISOString());
await Auth.createUser({ username: 'nightowner', name: 'Night Owner', role: 'owner', password: PW });
await Auth.createUser({ username: 'nocust', name: 'No Customers', role: 'owner', password: PW });
await Auth.createUser({ username: 'backroom', name: 'Back Room', role: 'warehouse', password: PW });
const owner = Auth.findByUsername('nightowner');
const nocust = Auth.findByUsername('nocust');
const backroom = Auth.findByUsername('backroom');
d.prepare("INSERT INTO user_permissions (user_id, perm, allowed, updated_at) VALUES (?, 'customer.write', 0, ?)").run(nocust.id, new Date().toISOString());
Auth.invalidatePermissions();
check('the scratch accounts: the owner may take remote orders and add customers', Auth.can(owner, 'delivery.desk') && Auth.can(owner, 'customer.write'));
check('…one may take remote orders but NOT add customers', Auth.can(nocust, 'delivery.desk') && !Auth.can(nocust, 'customer.write'));
check('…the back room may do neither (no delivery.desk)', !Auth.can(backroom, 'delivery.desk'));

const type = d.prepare('SELECT id FROM categories WHERE active = 1 ORDER BY id LIMIT 1').get().id;
/* Dollars since 067 (a lira price is refused); the lira a sale comes to is
   worked out below from this scratch database's own rate. */
Cat.createWithVariants({ name: 'Samba OG', type, brand: 'Adidas', currency: 'USD', costPrice: 2937, sellingPrice: 4500,
  sizes: [{ size: '42', qty: 5 }, { size: '43', qty: 1 }], whId: 'store', userId: owner.id });
Cat.createWithVariants({ name: 'Air Force 1', type, brand: 'Nike', currency: 'USD', costPrice: 3350, sellingPrice: 5200,
  colours: [{ nameEn: 'White', nameAr: 'أبيض', sizes: [{ size: '42', qty: 2 }] }, { nameEn: 'Black', nameAr: 'أسود', sizes: [{ size: '42', qty: 1 }] }],
  whId: 'store', userId: owner.id });
const sku = (name, size, colour) => d.prepare(
  `SELECT v.sku FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN product_colours c ON c.id = v.colour_id
    WHERE p.name = ? AND v.size = ? AND (? IS NULL OR c.name_en = ?)`).get(name, size, colour || null, colour || null).sku;
/* What the till charges for one Samba: $45.00 at the rate of the moment, in
   whole lira (convert() in lib/sales.js). */
const SAMBA_LIRA = Math.round(45 * Cat.currentRate('USD', 'SYP'));
const SAMBA42 = sku('Samba OG', '42'), SAMBA43 = sku('Samba OG', '43'), AF_BLACK = sku('Air Force 1', '42', 'Black');
const nour = Customers.create({ name: 'Nour Haddad', phone: '+963 933 123 456', city: 'Aleppo' }, owner.id).customer;
const other = Customers.create({ name: 'Someone Else', phone: '0944 000 111' }, owner.id).customer;

/* ---- a fake cloud: 035's take and mark, in memory ------------------------ */
const cloud = new Map();
const calls = [];
let n = 0;
function ask(payload, byUser = 'sara') {
  const ref = 'N-' + String(++n).padStart(4, '0');
  cloud.set(ref, { ref, source: 'night', revision: 1, state: 'waiting', payload, byUser, createdAt: new Date().toISOString(), takenBy: null, takenRevision: null, saleId: null, code: null });
  return ref;
}
async function rpc(fn, args) {
  calls.push({ fn, args: JSON.parse(JSON.stringify(args)) });
  if (args.p_lineage !== LIN) return { ok: false, code: 'not_owner' };
  if (fn === 'requests_take') {
    const items = [...cloud.values()]
      .filter((r) => (r.state === 'waiting' || r.state === 'received') && (r.takenBy !== args.p_lineage || r.takenRevision !== r.revision))
      .slice(0, args.p_limit)
      .map((r) => ({ ref: r.ref, source: r.source, revision: r.revision, state: r.state, payload: r.payload, byUser: r.byUser, createdAt: r.createdAt }));
    return { ok: true, items };
  }
  if (fn === 'requests_mark') {
    const out = [];
    for (const e of args.p_items) {
      const r = cloud.get(e.ref);
      if (!r) { out.push({ ref: e.ref, state: null }); continue; }
      const open = r.state === 'waiting' || r.state === 'received';
      if (e.state === 'received' && open) { r.state = 'received'; r.takenBy = args.p_lineage; r.takenRevision = e.revision; }
      if (e.state === 'accepted' && open && e.saleId) { r.state = 'accepted'; r.saleId = e.saleId; }
      if (e.state === 'rejected' && open) { r.state = 'rejected'; r.code = e.code; }
      out.push({ ref: r.ref, state: r.state, saleId: r.saleId, code: r.code });
    }
    return { ok: true, marked: out.length, items: out };
  }
  return { ok: false, code: 'unknown_fn' };
}
const collect = () => Requests.collect({ lineage: LIN, rpc });
const req = (p) => ({ v: 1, customer: { name: 'Nour Haddad', phone: '0933 123 456', id: nour.id },
  items: [{ sku: SAMBA42, qty: 1, name: 'Samba OG', size: '42' }],
  delivery: { method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery' }, note: 'Call after 6', ...p });
const row = (ref) => d.prepare('SELECT * FROM shop_requests WHERE ref = ?').get(ref);
const count = (sql, ...a) => d.prepare(sql).get(...a).n;
const salesN = () => count('SELECT count(*) AS n FROM sales');
const movesN = () => count('SELECT count(*) AS n FROM stock_movements');
const qtyOf = (s) => count("SELECT coalesce(sum(qty), 0) AS n FROM stock WHERE sku = ?", s);
const tryIt = (fn) => { try { return { ok: true, v: fn() }; } catch (e) { return { ok: false, e }; } };

try {
  /* ---- collecting -------------------------------------------------------- */
  const r1 = ask(req({}));
  const r2 = ask(req({ delivery: { method: 'pickup' }, customer: { name: 'Nour', phone: '0933123456', id: other.id } }));
  const r3 = ask(req({ items: [{ sku: 'OG-NOPE-99', qty: 1 }] }));
  const c1 = await collect();
  check('collect stores what the cloud holds', c1.taken === 3 && c1.stored === 3, JSON.stringify(c1));
  check('…each waiting here', ['waiting', 'waiting', 'waiting'].join() === [r1, r2, r3].map((r) => row(r).state).join());
  check('…and tells the cloud "received", which it confirms', [r1, r2, r3].every((r) => cloud.get(r).state === 'received' && row(r).reported_at), c1.reported);
  const c2 = await collect();
  check('a second pass takes nothing again and stores nothing twice', c2.taken === 0 && c2.stored === 0 && count('SELECT count(*) AS n FROM shop_requests') === 3, JSON.stringify(c2));
  check('the payload is kept as collected', JSON.parse(row(r1).payload).note === 'Call after 6' && row(r1).by_user === 'sara');

  /* ---- the list the screen draws ----------------------------------------- */
  const L = Requests.list();
  const lr1 = L.waiting.find((x) => x.ref === r1);
  check('the list: three waiting, oldest first', L.count === 3 && L.waiting[0].ref === r1);
  check('…a line carries this laptop\'s stock, price and name', lr1.lines[0].known && lr1.lines[0].name === 'Samba OG' && lr1.lines[0].price === 4500 && lr1.lines[0].currency === 'USD' && lr1.lines[0].stock.total === 5, JSON.stringify(lr1.lines[0]));
  check('…the hinted customer is matched by the hint while the phone matches', lr1.customer.match && lr1.customer.match.id === nour.id && lr1.customer.matchBy === 'hint');
  const lr2 = L.waiting.find((x) => x.ref === r2);
  check('…a hint whose phone does NOT match is ignored; the phone holder is found instead', lr2.customer.match && lr2.customer.match.id === nour.id && lr2.customer.matchBy === 'phone', JSON.stringify(lr2.customer));
  const lr3 = L.waiting.find((x) => x.ref === r3);
  check('…a size this laptop does not sell is marked unknown', lr3.lines[0].known === false);
  check('…no cost anywhere in the list', !JSON.stringify(L).includes('2937') && !JSON.stringify(L).toLowerCase().includes('cost'));

  /* ---- Accept ------------------------------------------------------------ */
  const s0 = salesN(), m0 = movesN(), q0 = qtyOf(SAMBA42);
  const a1 = Requests.accept(r1, { method: 'driver' }, owner);
  const sale1 = a1.saleId;
  check('Accept makes an order through Orders.create', a1.out && /^INV-/.test(sale1) && salesN() === s0 + 1, sale1);
  const srow = d.prepare('SELECT * FROM sales WHERE id = ?').get(sale1);
  check('…a sale with payment order, priced from the product table', srow.payment === 'order' && srow.total === SAMBA_LIRA && srow.customer_id === nour.id, JSON.stringify(srow));
  const drow = d.prepare('SELECT * FROM deliveries WHERE sale_id = ?').get(sale1);
  check('…its delivery: our driver, pay on receipt, the marker at the front of the note', drow.method === 'driver' && drow.plan === 'receipt' && drow.note.startsWith(`[req ${r1}] `) && drow.to_collect === SAMBA_LIRA, JSON.stringify(drow));
  check('…the stock left the shelf through the movement log', movesN() === m0 + 1 && qtyOf(SAMBA42) === q0 - 1);
  check('…the request is accepted with that invoice, not yet reported', row(r1).state === 'accepted' && row(r1).sale_id === sale1 && !row(r1).reported_at);
  await collect();
  check('the next pass tells the cloud, which then holds accepted with the invoice', cloud.get(r1).state === 'accepted' && cloud.get(r1).saleId === sale1 && row(r1).reported_at);

  const again = tryIt(() => Requests.accept(r1, { method: 'driver' }, owner));
  check('Accept again is refused (409 decided) and makes nothing', !again.ok && again.e.code === 'decided' && again.e.status === 409 && again.e.saleId === sale1 && salesN() === s0 + 1);

  /* The shop moved laptops: this copy is gone, the cloud still holds the
     request (a decision that never reached it). Collected again, it must
     arrive already an order — the marker on the mirrored delivery says so. */
  cloud.get(r1).state = 'received'; cloud.get(r1).takenBy = 'another-laptop'; cloud.get(r1).saleId = null;
  d.prepare('DELETE FROM shop_requests WHERE ref = ?').run(r1);
  const c3 = await collect();
  check('a request re-taken after a move arrives accepted with the SAME order', row(r1) && row(r1).state === 'accepted' && row(r1).sale_id === sale1 && salesN() === s0 + 1, JSON.stringify(c3));
  check('…and the cloud hears accepted with that invoice', cloud.get(r1).state === 'accepted' && cloud.get(r1).saleId === sale1);
  d.prepare("UPDATE shop_requests SET state = 'waiting', sale_id = NULL WHERE ref = ?").run(r1);
  const viaMarker = Requests.accept(r1, { method: 'driver' }, owner);
  check('…and even Accept pressed on it finds the order by its marker, making nothing', viaMarker.out === null && viaMarker.saleId === sale1 && salesN() === s0 + 1);

  /* The same move, for a request with NO note of its own: the delivery note
     is then the bare marker. The first marker carried a trailing space the
     trimmed note did not, the guard could not see the order, and the re-taken
     request became a second one (both reviews — every request above had a
     note). */
  const AF_WHITE = sku('Air Force 1', '42', 'White');
  const rNone = ask(req({ note: null, items: [{ sku: AF_WHITE, qty: 1 }] }));
  await collect();
  const aNone = Requests.accept(rNone, { method: 'driver' }, owner);
  check('a request with no note: its delivery note is the bare marker', d.prepare('SELECT note FROM deliveries WHERE sale_id = ?').get(aNone.saleId).note === `[req ${rNone}]`);
  await collect();
  cloud.get(rNone).state = 'received'; cloud.get(rNone).takenBy = 'another-laptop'; cloud.get(rNone).saleId = null;
  d.prepare('DELETE FROM shop_requests WHERE ref = ?').run(rNone);
  const sNone = salesN();
  await collect();
  check('…re-taken after a move it still arrives accepted with the SAME order, and no second sale',
    row(rNone) && row(rNone).state === 'accepted' && row(rNone).sale_id === aNone.saleId && salesN() === sNone, JSON.stringify(row(rNone)));

  /* A person decides while "received" is still on the wire: that answer is
     about the old row and must not mark the decision as told (correctness
     review — the decision was buried for good). */
  const rRace = ask(req({ items: [{ sku: AF_WHITE, qty: 1 }] }));
  let raced = null;
  const racing = async (fn, args) => {
    const out = await rpc(fn, args);
    if (fn === 'requests_mark' && !raced && args.p_items.some((x) => x.ref === rRace && x.state === 'received')) {
      raced = Requests.accept(rRace, { method: 'driver' }, owner);
    }
    return out;
  };
  await Requests.collect({ lineage: LIN, rpc: racing });
  check('a decision made while "received" was on the wire stays unreported', raced && row(rRace).state === 'accepted' && !row(rRace).reported_at, JSON.stringify(row(rRace)));
  await collect();
  check('…and the next pass tells the cloud, which then holds it', cloud.get(rRace).state === 'accepted' && cloud.get(rRace).saleId === raced.saleId && row(rRace).reported_at);

  /* Something in the cloud this code cannot read. */
  const rBad = ask(req({}));
  cloud.get(rBad).payload = { v: 2, what: 'a shape from next year' };
  await collect();
  check('an unreadable request is turned down as unreadable, not left to block the queue',
    cloud.get(rBad).state === 'rejected' && cloud.get(rBad).code === 'unreadable' && !row(rBad));

  /* A pickup has no address: our driver would have nowhere to go. */
  const rPick = ask(req({ delivery: { method: 'pickup' } }));
  await collect();
  const noAddr = tryIt(() => Requests.accept(rPick, { method: 'driver' }, owner));
  check('our driver for a request with no address: 400 needs_address, still waiting',
    !noAddr.ok && noAddr.e.code === 'needs_address' && row(rPick).state === 'waiting');
  Requests.reject(rPick, { code: 'other', note: 'test tidy-up' }, owner);
  await collect();

  /* ---- pickup, and the customer rules -------------------------------------- */
  const a2 = Requests.accept(r2, {}, owner);
  const d2 = d.prepare('SELECT * FROM deliveries WHERE sale_id = ?').get(a2.saleId);
  const s2 = d.prepare('SELECT * FROM sales WHERE id = ?').get(a2.saleId);
  check('a pickup request is a pickup order with no address', d2.method === 'pickup' && d2.address === '' && d2.plan === 'receipt');
  check('…for the phone holder, not the customer the mismatched hint named', s2.customer_id === nour.id && s2.customer_id !== other.id);

  const r4 = ask(req({ customer: { name: 'Lina Saleh', phone: '0911 222 333' } }));
  await collect();
  const cN = count('SELECT count(*) AS n FROM customers');
  const refuse = tryIt(() => Requests.accept(r4, { method: 'driver' }, nocust));
  check('a new customer without customer.write: 403 needs_customer_write, nothing written',
    !refuse.ok && refuse.e.code === 'needs_customer_write' && refuse.e.status === 403 && count('SELECT count(*) AS n FROM customers') === cN && row(r4).state === 'waiting');
  const a4 = Requests.accept(r4, { method: 'driver', fee: 15000 }, owner);
  const lina = d.prepare("SELECT * FROM customers WHERE name = 'Lina Saleh'").get();
  check('…with it, the customer is made (source night) and the order is theirs', lina && lina.source === 'night' && d.prepare('SELECT customer_id FROM sales WHERE id = ?').get(a4.saleId).customer_id === lina.id);
  const d4 = d.prepare('SELECT * FROM deliveries WHERE sale_id = ?').get(a4.saleId);
  check('…a typed fee is kept, on the invoice (manual)', d4.fee === 15000 && d4.fee_source === 'manual', JSON.stringify({ fee: d4.fee, src: d4.fee_source }));

  /* ---- refusals that must write nothing ------------------------------------ */
  let s5 = salesN(), m5 = movesN();
  const unk = tryIt(() => Requests.accept(r3, { method: 'driver' }, owner));
  check('an unknown size: 409 unknown_sku naming it, nothing written', !unk.ok && unk.e.code === 'unknown_sku' && unk.e.skus.includes('OG-NOPE-99') && salesN() === s5 && movesN() === m5);
  const r6 = ask(req({ items: [{ sku: SAMBA43, qty: 3 }] }));
  await collect();
  s5 = salesN(); m5 = movesN();
  const short = tryIt(() => Requests.accept(r6, { method: 'driver' }, owner));
  check('too little stock: insufficient_stock from Orders.create, nothing written, still waiting',
    !short.ok && short.e.code === 'insufficient_stock' && salesN() === s5 && movesN() === m5 && row(r6).state === 'waiting', short.e && short.e.code);
  const office = tryIt(() => Requests.accept(r6, { method: 'courier' }, owner));
  check('a courier cannot be accepted in one press (paid before sending): 400 bad_method', !office.ok && office.e.code === 'bad_method');

  /* ---- Reject ---------------------------------------------------------------- */
  const rj = Requests.reject(r6, { code: 'out_of_stock', note: 'only one 43 left' }, owner);
  check('Reject records the reason and who', rj.state === 'rejected' && row(r6).code === 'out_of_stock' && row(r6).reason === 'only one 43 left' && row(r6).decided_by === owner.id);
  const rj2 = tryIt(() => Requests.reject(r6, { code: 'other' }, owner));
  check('…a second decision is refused', !rj2.ok && rj2.e.code === 'decided');
  const rj3 = tryIt(() => Requests.accept(r6, {}, owner));
  check('…and a rejected request can never become an order', !rj3.ok && rj3.e.code === 'decided');
  const bad = tryIt(() => Requests.reject(r3, { code: 'because' }, owner));
  check('a reason outside the six is refused', !bad.ok && bad.e.code === 'bad_code');
  await collect();
  check('the cloud hears rejected with the code', cloud.get(r6).state === 'rejected' && cloud.get(r6).code === 'out_of_stock');

  /* ---- the bell ---------------------------------------------------------------- */
  const Alerts = await src('lib/alerts.js');
  const bell = Alerts.list(owner).rows.find((x) => x.kind === 'requests_waiting');
  const newest = d.prepare("SELECT ref FROM shop_requests WHERE state = 'waiting' ORDER BY asked_at DESC, ref DESC LIMIT 1").get().ref;
  check('the bell has one row for what is waiting, keyed on the newest', bell && bell.key === 'requests:' + newest && bell.view === 'requests' && bell.args.n === count("SELECT count(*) AS n FROM shop_requests WHERE state = 'waiting'"), JSON.stringify(bell));
  check('…and none for an account that cannot take remote orders', !Alerts.list(backroom).rows.some((x) => x.kind === 'requests_waiting'));

  /* ---- a not-owner lineage collects nothing --------------------------------- */
  const no = await Requests.collect({ lineage: 'somebody-else', rpc });
  check('a laptop that does not own the mirror collects nothing', no.skipped === 'not_owner');
  process.env.OG_NIGHT_REQUESTS = '0';
  check('OG_NIGHT_REQUESTS=0 switches collecting off', (await collect()).skipped === 'off');
  delete process.env.OG_NIGHT_REQUESTS;

  /* ---- three more for the routes, then close this process's handle ---------- */
  var h1 = ask(req({ delivery: { method: 'pickup' } }), 'karim');
  var h2 = ask(req({}), 'karim');
  var h3 = ask(req({ items: [{ sku: AF_BLACK, qty: 1, name: 'Air Force 1', size: '42', colour: 'Black', colourAr: 'أسود' }] }), 'karim');
  await collect();
} catch (e) {
  check('no exception in the in-process part', false, e && e.stack);
}
DB.close();

/* ---- over HTTP, with this worktree's own server ------------------------------ */
function call(method, path, { body, cookie } = {}) {
  return new Promise((ok, bad) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Origin: `http://127.0.0.1:${PORT}` };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    if (cookie) headers.Cookie = cookie;
    const r = request({ host: '127.0.0.1', port: PORT, method, path, headers }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch { /* html */ } ok({ status: res.statusCode, headers: res.headers, json: j }); });
    });
    r.on('error', bad); if (data) r.write(data); r.end();
  });
}
const child = spawn(process.execPath, ['index.js'], { cwd: SERVER, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { out += c; });
try {
  let up = false;
  for (let i = 0; i < 150 && !up; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { up = (await call('GET', '/api/health')).status === 200; } catch { /* not yet */ }
    if (child.exitCode !== null) break;
  }
  check('the worktree\'s server starts on the scratch data', up, out.slice(-800));
  const login = async (username) => {
    const r = await call('POST', '/api/auth/login', { body: { username, password: PW } });
    return [].concat(r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  };
  const ck = await login('nightowner');
  const bk = await login('backroom');
  const list = await call('GET', '/api/requests', { cookie: ck });
  check('GET /api/requests lists what is waiting', list.status === 200 && list.json.waiting.some((x) => x.ref === h1) && list.json.count >= 3, list.status);
  const colourLine = list.json.waiting.find((x) => x.ref === h3).lines[0];
  check('…a two-colour product\'s line names its colour, from THIS catalogue', colourLine.colour === 'Black' && colourLine.colourAr === 'أسود', JSON.stringify(colourLine));
  check('GET /api/requests is 403 without delivery.desk', (await call('GET', '/api/requests', { cookie: bk })).status === 403);
  check('POST accept is 403 without delivery.desk', (await call('POST', `/api/requests/${h1}/accept`, { cookie: bk, body: {} })).status === 403);
  const acc = await call('POST', `/api/requests/${h1}/accept`, { cookie: ck, body: {} });
  check('POST accept answers the order and the request', acc.status === 200 && /^INV-/.test(acc.json.sale.id) && acc.json.request.state === 'accepted' && acc.json.order, JSON.stringify(acc.json).slice(0, 300));
  check('…with no cost in the answer', !JSON.stringify(acc.json).includes('unit_cost') && !JSON.stringify(acc.json).includes('cost_price'));
  const acc2 = await call('POST', `/api/requests/${h1}/accept`, { cookie: ck, body: {} });
  check('POST accept again: 409 decided with the invoice', acc2.status === 409 && acc2.json.code === 'decided' && acc2.json.saleId === acc.json.sale.id);
  const rj = await call('POST', `/api/requests/${h2}/reject`, { cookie: ck, body: { code: 'no_answer', note: 'rang twice' } });
  check('POST reject answers the rejected request', rj.status === 200 && rj.json.request.state === 'rejected' && rj.json.request.code === 'no_answer');
  check('POST reject with no reason: 400 bad_code', (await call('POST', `/api/requests/${h3}/reject`, { cookie: ck, body: {} })).json.code === 'bad_code');
  check('an unknown ref: 404', (await call('POST', '/api/requests/N-9999/accept', { cookie: ck, body: {} })).status === 404);

  /* Open in the order desk: prepare, then the desk's own Save with requestRef. */
  const prep = await call('POST', `/api/requests/${h3}/prepare`, { cookie: ck, body: {} });
  check('POST prepare answers the desk\'s draft', prep.status === 200 && prep.json.draft.ref === h3 && prep.json.draft.customerId && prep.json.draft.lines[0].sku === AF_BLACK, JSON.stringify(prep.json).slice(0, 300));
  const dr = prep.json.draft;
  const orderBody = { lines: dr.lines, customerId: dr.customerId, method: 'driver', dest: dr.dest, plan: 'receipt', payments: [],
                      note: dr.note, channel: 'other', opId: 'ord-test-night-0001', requestRef: h3 };
  const o1 = await call('POST', '/api/orders', { cookie: ck, body: orderBody });
  check('the desk\'s Save with requestRef makes the order', o1.status === 200 && /^INV-/.test(o1.json.sale.id), JSON.stringify(o1.json).slice(0, 300));
  const o2 = await call('POST', '/api/orders', { cookie: ck, body: orderBody });
  check('…a retried Save (same opId) gets the SAME order back', o2.status === 200 && o2.json.replayed === true && o2.json.sale.id === o1.json.sale.id);
  const o3 = await call('POST', '/api/orders', { cookie: ck, body: { ...orderBody, opId: 'ord-test-night-0002' } });
  check('…a NEW Save for the same request is refused 409 decided', o3.status === 409 && o3.json.code === 'decided');
  const notif = await call('GET', '/api/notifications', { cookie: ck });
  /* r3 (the size this laptop does not sell) was never decided: one is still waiting. */
  const bellRow = notif.json.notifications.find((x) => x.kind === 'requests_waiting');
  check('the bell route carries one requests row for the one still waiting', notif.status === 200 && bellRow && bellRow.args.n === 1 && bellRow.key === 'requests:N-0003', JSON.stringify(bellRow));

  /* ---- read back from SQLite ------------------------------------------------- */
  const ro = new DatabaseSync(join(SCR, 'data', 'og.db'), { readOnly: true });
  const g = (ref) => ro.prepare('SELECT * FROM shop_requests WHERE ref = ?').get(ref);
  check('SQLite: the routed accept is accepted with its invoice', g(h1).state === 'accepted' && g(h1).sale_id === acc.json.sale.id);
  check('SQLite: the routed reject is rejected with its reason', g(h2).state === 'rejected' && g(h2).code === 'no_answer' && g(h2).reason === 'rang twice');
  check('SQLite: the desk path marked its request accepted with the desk\'s invoice', g(h3).state === 'accepted' && g(h3).sale_id === o1.json.sale.id);
  const dh3 = ro.prepare('SELECT note FROM deliveries WHERE sale_id = ?').get(o1.json.sale.id);
  check('SQLite: the desk\'s order carries the marker too', dh3.note.startsWith(`[req ${h3}] `));
  check('SQLite: exactly one order per accepted request', ['h1', 'h3'].every((k) => {
    const ref = k === 'h1' ? h1 : h3;
    const m = `[req ${ref}] `;
    return ro.prepare('SELECT count(*) AS n FROM deliveries WHERE substr(note, 1, ?) = ?').get(m.length, m).n === 1;
  }));
  ro.close();
} catch (e) {
  check('no exception in the HTTP part', false, e && e.stack);
} finally {
  child.kill();
  await new Promise((r) => (child.exitCode !== null ? r() : child.on('exit', r)));
  try { rmSync(SCR, { recursive: true, force: true }); } catch { /* Windows may hold a file a moment */ }
}

console.log(`\nnight-mode laptop: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
