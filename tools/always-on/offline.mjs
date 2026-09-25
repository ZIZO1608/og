#!/usr/bin/env node
/* ==========================================================================
   Selling while the internet is down, for real.  node tools/always-on/offline.mjs

   Three processes on this machine, each on its own throwaway data folder and
   an empty env file (no Supabase, no Telegram, no push):

     MAIN      the main server (the VPS, after the switch), handing out copies
     a LINE    a TCP relay between the two, which this script can CUT — the
               shop losing its internet while the main server stays up and
               goes on selling online
     LAPTOP    the standby, following MAIN through the line

   What is proved, read back out of both databases, never off a screen:
   numbers are lent inside the copy and MAIN steps over them; the laptop
   refuses the till while it follows and takes it once the line has been
   silent; offline sales print lent numbers; a customer added offline is
   pointed at MAIN's id on the way up; the pair sold both offline and online
   stands at 0 with an `oversold` movement and a bell row; every sale lands
   with its real time and its cashier; nothing is applied twice; a refused
   entry is kept for a person; a laptop that stops mid-outage starts offline
   and sends later; and no copy is taken over work that was not sent.
   ========================================================================== */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as netServer, connect } from 'node:net';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(ROOT, 'server');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + String(detail).slice(0, 400) : '')); }
};
const freePort = () => new Promise((ok) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function until(fn, ms, step = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(step); }
  return !!(await fn());
}

const TMP = mkdtempSync(join(tmpdir(), 'og-offline-'));
const ENV = join(TMP, 'empty.env');
writeFileSync(ENV, '');
const KEY = 'offline-test-key-' + Date.now();
const MAIN_DATA = join(TMP, 'main');
const LAP_DATA = join(TMP, 'laptop');

/* ---- the shop: an owner, a cashier, one shoe in two sizes -------------------- */
const seed = spawn(process.execPath, ['--input-type=module', '-e', `
  import * as DB from './lib/db.js';
  import * as Auth from './lib/auth.js';
  import * as Cat from './lib/catalogue.js';
  import { dbFile } from './lib/env.js';
  const d = DB.open(dbFile());
  await Auth.createUser({ username: 'owner1', name: 'Test Owner', role: 'owner', password: 'correct-horse-9' });
  await Auth.createUser({ username: 'cash1', name: 'Lubna Test', role: 'cashier', password: 'correct-horse-8' });
  const uid = d.prepare("SELECT id FROM users WHERE username = 'owner1'").get().id;
  Cat.createWithVariants({ name: 'Test Shoe', type: 'sneakers', currency: 'USD', costPrice: 7700, sellingPrice: 34600,   /* 067: prices are dollars (cents) */
    sizes: [{ size: '42', qty: 20 }, { size: '43', qty: 1 }], whId: 'store', userId: uid });
  DB.close();
`], { cwd: SERVER, env: { ...process.env, OG_ENV_FILE: ENV, OG_DATA_DIR: MAIN_DATA }, stdio: 'inherit' });
await new Promise((ok) => seed.on('exit', ok));
const skuOf = (() => {
  const d = new DatabaseSync(join(MAIN_DATA, 'og.db'), { readOnly: true });
  const r = Object.fromEntries(d.prepare('SELECT size, sku FROM variants').all().map((x) => [x.size, x.sku]));
  d.close();
  return r;
})();

const MAIN = await freePort();
const LINE = await freePort();
const LAP = await freePort();

/* ---- the line: a relay we can cut ------------------------------------------- */
let cut = false;
const live = new Set();
const relay = netServer((a) => {
  if (cut) return a.destroy();
  const b = connect(MAIN, '127.0.0.1');
  live.add(a); live.add(b);
  a.pipe(b); b.pipe(a);
  const end = () => { a.destroy(); b.destroy(); live.delete(a); live.delete(b); };
  a.on('error', end); b.on('error', end); a.on('close', end); b.on('close', end);
});
await new Promise((ok) => relay.listen(LINE, '127.0.0.1', ok));
const cutLine = () => { cut = true; for (const s of live) s.destroy(); live.clear(); };
const mendLine = () => { cut = false; };

const procs = {};
const out = { main: '', laptop: '' };
const common = { OG_ENV_FILE: ENV, OG_HTTPS: '0', OG_SYNC_MINUTES: '0', OG_PUSH: '0', OG_PULL_AT_BOOT: '0',
  OG_TELEGRAM_TOKEN_OG: '', OG_TELEGRAM_TOKEN_YALLA: '', FORCE_COLOR: '0' };
function start(name, port, extra) {
  const p = spawn(process.execPath, ['index.js'], {
    cwd: SERVER, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, ...common, OG_PORT: String(port), ...extra }
  });
  p.stdout.on('data', (b) => { out[name] += b; });
  p.stderr.on('data', (b) => { out[name] += b; });
  procs[name] = p;
  return p;
}
const LAPTOP_ENV = {
  OG_DATA_DIR: LAP_DATA, OG_ROLE: 'standby', OG_UPSTREAM: `http://127.0.0.1:${LINE}`, OG_COPY_KEY: KEY,
  OG_STANDBY_ID: 'test-laptop', OG_STANDBY_EVERY_MS: '2000', OG_STANDBY_PROBE_MS: '400',
  OG_STANDBY_DOWN_MS: '1500', OG_STANDBY_UP_MS: '2500', OG_STANDBY_HOME: 'https://shop.example.test'
};
start('main', MAIN, { OG_DATA_DIR: MAIN_DATA, OG_COPY_KEY: KEY, OG_LEND_MIN: '5', OG_LEND_BLOCK: '10' });
start('laptop', LAP, LAPTOP_ENV);

function http(port, method, path, { body, cookie, headers = {} } = {}) {
  return new Promise((ok) => {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    if (method !== 'GET') h.Origin = `http://127.0.0.1:${port}`;
    const r = request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* not json */ } ok({ status: res.statusCode, headers: res.headers, json: j }); });
    });
    r.on('error', (e) => ok({ status: 0, error: e.message }));
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}
async function signIn(port, user, pw) {
  const r = await http(port, 'POST', '/api/auth/login', { body: { username: user, password: pw } });
  const c = [].concat(r.headers['set-cookie'] || []).find((x) => x.startsWith('og_session='));
  return c ? c.split(';')[0] : null;
}
const health = async (port, cookie) => (await http(port, 'GET', '/api/health', { cookie })).json || {};
const lapMode = async () => ((await health(LAP)).standby || {}).mode;
const q = (dir, sql, ...a) => { const d = new DatabaseSync(join(dir, 'og.db'), { readOnly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const q1 = (dir, sql, ...a) => q(dir, sql, ...a)[0];
const sale = (lines, extra = {}) => ({ lines, whId: 'store', payment: 'cash', opId: randomUUID(), ...extra });

try {
  check('the main server starts', await until(async () => (await http(MAIN, 'GET', '/api/health')).status === 200, 20000), out.main.slice(-300));
  check('the laptop takes its first copy through the line',
    await until(async () => { const s = (await health(LAP)).standby; return s && s.copyAt; }, 20000), out.laptop.slice(-400));

  /* ---- 1. the loan ---------------------------------------------------------- */
  const loan = q1(MAIN_DATA, "SELECT lo, hi, holder FROM id_loans WHERE prefix = 'INV'");
  check('MAIN lent the laptop a block of invoice numbers at the copy door', loan && loan.holder === 'test-laptop' && loan.hi - loan.lo === 9, JSON.stringify(loan));
  const lh = (await health(LAP)).standby;
  check('…and the laptop knows it from its own copy (10 numbers)', lh.numbersLeft === 10, JSON.stringify(lh));
  check('the laptop starts following, read-only', lh.mode === 'following');

  const ownerMain = await signIn(MAIN, 'owner1', 'correct-horse-9');
  const hm = await health(MAIN, ownerMain);
  check('MAIN tells a signed-in page where the shop laptop answers',
    Array.isArray(hm.standbys) && hm.standbys[0] && hm.standbys[0].name === 'test-laptop' && hm.standbys[0].urls.length > 0, JSON.stringify(hm.standbys));
  check('…and tells a stranger nothing', (await health(MAIN)).standbys === undefined);

  const onMain = await http(MAIN, 'POST', '/api/sales', { cookie: ownerMain, body: sale([{ sku: skuOf['42'], qty: 1 }]) });
  check('MAIN\'s own next invoice steps over the lent block', onMain.json && onMain.json.sale && onMain.json.sale.id === 'INV-' + (loan.hi + 1), JSON.stringify(onMain.json));

  const cashLap = await signIn(LAP, 'cash1', 'correct-horse-8');
  check('the cashier signs in on the laptop', !!cashLap);
  const early = await http(LAP, 'POST', '/api/sales', { cookie: cashLap, body: sale([{ sku: skuOf['42'], qty: 1 }]) });
  check('while MAIN answers, the laptop turns the till away (read-only)', early.status === 503 && early.json.code === 'standby_read_only', JSON.stringify(early.json));

  /* ---- 2. the line drops ---------------------------------------------------- */
  const copyBefore = (await health(LAP)).standby.copyAt;
  cutLine();
  check('the laptop goes offline after the patience window', await until(async () => (await lapMode()) === 'offline', 8000), out.laptop.slice(-400));

  const s1 = await http(LAP, 'POST', '/api/sales', { cookie: cashLap, body: sale([{ sku: skuOf['42'], qty: 1 }]) });
  check('an offline sale is taken on the first lent number', s1.status === 200 && s1.json.sale.id === 'INV-' + loan.lo, JSON.stringify(s1.json));
  await sleep(40);
  const s2 = await http(LAP, 'POST', '/api/sales', { cookie: cashLap, body: sale([{ sku: skuOf['43'], qty: 1 }]) });
  check('…the last 43 too, on the next one', s2.status === 200 && s2.json.sale.id === 'INV-' + (loan.lo + 1), JSON.stringify(s2.json));

  /* Meanwhile, online: the same last 43 sells on MAIN. */
  const online43 = await http(MAIN, 'POST', '/api/sales', { cookie: ownerMain, body: sale([{ sku: skuOf['43'], qty: 1 }]) });
  check('meanwhile MAIN sells the same last 43 online', online43.status === 200, JSON.stringify(online43.json));

  const newCust = await http(LAP, 'POST', '/api/customers', { cookie: cashLap, body: { name: 'Offline Customer', phone: '0933111222' } });
  check('a customer is added offline', newCust.status === 200 && newCust.json.customer && newCust.json.customer.id, JSON.stringify(newCust.json));
  const localId = newCust.json.customer.id;
  /* …and MAIN makes a customer of its own meanwhile, which takes that same id there. */
  const clash = await http(MAIN, 'POST', '/api/customers', { cookie: ownerMain, body: { name: 'Online Somebody', phone: '0944000111' } });
  check('MAIN gives a different customer the same id meanwhile', clash.json && clash.json.customer && clash.json.customer.id === localId, JSON.stringify(clash.json));
  const s3 = await http(LAP, 'POST', '/api/sales', { cookie: cashLap, body: sale([{ sku: skuOf['42'], qty: 1 }], { customerId: localId }) });
  check('an offline sale to that new customer', s3.status === 200 && s3.json.sale.customerId === localId, JSON.stringify(s3.json));
  const ed = await http(LAP, 'PATCH', `/api/customers/${localId}`, { cookie: cashLap, body: { note: 'likes the 42' } });
  check('…and the customer edited offline', ed.status === 200, JSON.stringify(ed.json));

  const other = await http(LAP, 'PUT', '/api/config', { cookie: cashLap, body: { updates: { 'shop.name': 'x' } } });
  check('anything not the till says it needs the internet', other.status === 503 && other.json.code === 'needs_internet', JSON.stringify(other.json));
  const refusedLocal = await http(LAP, 'POST', '/api/sales', { cookie: cashLap, body: sale([{ sku: skuOf['43'], qty: 1 }]) });
  check('the laptop still refuses what its own stock cannot cover', refusedLocal.status === 409 && refusedLocal.json.code === 'insufficient_stock', JSON.stringify(refusedLocal.json));

  const lh2 = (await health(LAP)).standby;
  check('the strip\'s numbers: 5 waiting, 3 of them sales', lh2.waiting === 5 && lh2.waitingSales === 3, JSON.stringify(lh2));
  check('the laptop kept its copy (nothing taken over unsent work)', lh2.copyAt === copyBefore);

  /* ---- 3. the line is back ---------------------------------------------------- */
  mendLine();
  check('the laptop sends, takes a fresh copy, and follows again',
    await until(async () => { const s = (await health(LAP)).standby; return s.mode === 'following' && s.waiting === 0 && s.copyAt !== copyBefore; }, 20000),
    JSON.stringify((await health(LAP)).standby) + '\n' + out.laptop.slice(-600));

  const ids = [s1, s2, s3].map((s) => s.json.sale.id);
  const landed = q(MAIN_DATA, `SELECT id, at, cashier_id, customer_id FROM sales WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids);
  check('every offline sale is on MAIN, under the number printed offline', landed.length === 3, JSON.stringify(landed));
  const cashId = q1(MAIN_DATA, "SELECT id FROM users WHERE username = 'cash1'").id;
  check('…with its cashier', landed.every((r) => r.cashier_id === cashId));
  check('…and the time it was really made, not the time the line came back',
    landed.every((r, i) => r.at === [s1, s2, s3][i].json.sale.at), JSON.stringify(landed.map((r) => r.at)) + ' vs ' + JSON.stringify([s1, s2, s3].map((s) => s.json.sale.at)));

  const mainCust = q1(MAIN_DATA, "SELECT id, note FROM customers WHERE name = 'Offline Customer'");
  check('the offline customer exists on MAIN, with a NEW id', mainCust && mainCust.id !== localId, JSON.stringify(mainCust));
  check('…their offline sale points at that id, not at "Online Somebody"', landed.find((r) => r.id === s3.json.sale.id).customer_id === mainCust.id);
  check('…and the offline edit landed on them', mainCust.note === 'likes the 42', JSON.stringify(mainCust));

  const b43 = q1(MAIN_DATA, "SELECT qty FROM stock WHERE sku = ? AND wh_id = 'store'", skuOf['43']);
  check('the pair sold twice: stock stops at 0, never below', b43.qty === 0, JSON.stringify(b43));
  const over = q(MAIN_DATA, "SELECT delta, ref_id, type FROM stock_movements WHERE ref_type = 'oversold'");
  check('…the difference is its own movement, marked oversold, naming the sale',
    over.length === 1 && over[0].delta === 1 && over[0].ref_id === s2.json.sale.id && over[0].type === 'count', JSON.stringify(over));
  const bell = (await http(MAIN, 'GET', '/api/notifications', { cookie: ownerMain })).json;
  check('…and the bell asks for that shelf to be counted',
    bell && bell.notifications.some((n) => n.kind === 'oversold' && n.args.id === s2.json.sale.id), JSON.stringify(bell && bell.notifications));

  const lapSales = q(LAP_DATA, `SELECT id FROM sales WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  check('the laptop\'s fresh copy carries them too (from MAIN, not from itself)', lapSales.length === 3);
  const next = await http(MAIN, 'POST', '/api/sales', { cookie: ownerMain, body: sale([{ sku: skuOf['42'], qty: 1 }]) });
  /* hi+1 and hi+2 were MAIN's two online sales (the 42, then the last 43). */
  check('MAIN\'s own numbering still steps over the block', next.json.sale.id === 'INV-' + (loan.hi + 3), JSON.stringify(next.json));
  check('the laptop still has its unused numbers (10 − 3)', (await health(LAP)).standby.numbersLeft === 7);
  const again = await http(LAP, 'POST', '/api/sales', { cookie: cashLap, body: sale([{ sku: skuOf['42'], qty: 1 }]) });
  check('following again, the laptop turns the till away again', again.status === 503);

  /* ---- 4. the replay door itself ---------------------------------------------- */
  const bearer = { Authorization: 'Bearer ' + KEY };
  const u = randomUUID();
  const entry = (extra) => ({ uuid: u, kind: 'sale', method: 'POST', path: '/api/sales', userId: cashId, at: new Date().toISOString(),
    body: sale([{ sku: skuOf['42'], qty: 1 }]), localRef: 'INV-' + (loan.lo + 3), ...extra });
  const r1 = await http(MAIN, 'POST', '/api/copy/replay', { headers: bearer, body: { holder: 'test-laptop', entries: [entry()] } });
  const r2 = await http(MAIN, 'POST', '/api/copy/replay', { headers: bearer, body: { holder: 'test-laptop', entries: [entry()] } });
  check('the same entry sent twice is applied once',
    r1.json.results[0].status === 200 && r2.json.results[0].replayed === true &&
    q(MAIN_DATA, 'SELECT id FROM sales WHERE id = ?', 'INV-' + (loan.lo + 3)).length === 1, JSON.stringify([r1.json, r2.json]));
  const bad = await http(MAIN, 'POST', '/api/copy/replay', { headers: bearer, body: { holder: 'test-laptop', entries: [entry({ uuid: randomUUID(), localRef: 'INV-99999', body: sale([{ sku: skuOf['42'], qty: 1 }]) })] } });
  check('a number MAIN never lent is refused', bad.json.results[0].status === 409 && bad.json.results[0].body.code === 'bad_lent_id', JSON.stringify(bad.json));
  const wrongLaptop = await http(MAIN, 'POST', '/api/copy/replay', { headers: bearer, body: { holder: 'other-laptop', entries: [entry({ uuid: randomUUID(), localRef: 'INV-' + (loan.lo + 4), body: sale([{ sku: skuOf['42'], qty: 1 }]) })] } });
  check('…and so is one lent to a different laptop', wrongLaptop.json.results[0].body.code === 'bad_lent_id', JSON.stringify(wrongLaptop.json));
  const notTill = await http(MAIN, 'POST', '/api/copy/replay', { headers: bearer, body: { holder: 'test-laptop', entries: [{ uuid: randomUUID(), method: 'PUT', path: '/api/config', userId: cashId, body: {} }] } });
  check('only the till\'s writes can be replayed', notTill.json.results[0].body.code === 'not_replayable', JSON.stringify(notTill.json));
  check('the replay door wants the key', (await http(MAIN, 'POST', '/api/copy/replay', { body: { holder: 'test-laptop', entries: [] } })).status === 401);
  const future = await http(MAIN, 'POST', '/api/copy/replay', { headers: bearer, body: { holder: 'test-laptop', entries: [entry({ uuid: randomUUID(), at: '2099-01-01T00:00:00.000Z', localRef: 'INV-' + (loan.lo + 5), body: sale([{ sku: skuOf['42'], qty: 1 }]) })] } });
  const fAt = q1(MAIN_DATA, 'SELECT at FROM sales WHERE id = ?', 'INV-' + (loan.lo + 5));
  check('a time in the future is brought back to now', future.json.results[0].status === 200 && fAt && Date.parse(fAt.at) <= Date.now() + 1000, JSON.stringify(fAt));
  check('the laptop cannot fetch a copy through a standby (no copy door on a copy)', (await http(LAP, 'GET', '/api/copy/db', { headers: bearer })).status === 404);

  /* ---- 5. a second outage: a refusal, and a laptop that stops mid-outage ------ */
  /* The door checks above used two of the laptop's numbers directly on MAIN,
     which only a test can do; let the laptop's copy catch up with them first,
     as it always has in life (only its own replay ever uses its numbers). */
  const beforeDoor = (await health(LAP)).standby.copyAt;
  check('the laptop takes a fresh copy while following',
    await until(async () => (await health(LAP)).standby.copyAt !== beforeDoor, 10000));
  cutLine();
  check('offline again', await until(async () => (await lapMode()) === 'offline', 8000));
  const s4 = await http(LAP, 'POST', '/api/sales', { cookie: cashLap, body: sale([{ sku: skuOf['42'], qty: 1 }]) });
  check('an offline sale on the next free lent number', s4.status === 200 && s4.json.sale.id === 'INV-' + (loan.lo + 6), JSON.stringify(s4.json));
  /* The owner switches the cashier off on MAIN meanwhile: her sale cannot land there. */
  const off = await http(MAIN, 'POST', `/api/users/${cashId}/active`, { cookie: ownerMain, body: { active: false } });
  check('meanwhile MAIN switches that cashier off', off.status === 200);
  const ownerLap = await signIn(LAP, 'owner1', 'correct-horse-9');
  const s5 = await http(LAP, 'POST', '/api/sales', { cookie: ownerLap, body: sale([{ sku: skuOf['42'], qty: 1 }]) });
  check('the owner sells offline too', s5.status === 200, JSON.stringify(s5.json));

  /* The laptop stops in the middle of the outage, and starts again. */
  procs.laptop.kill();
  await sleep(800);
  start('laptop', LAP, LAPTOP_ENV);
  check('a laptop restarted mid-outage starts OFFLINE, with its list intact',
    await until(async () => { const s = (await health(LAP)).standby; return s && s.mode === 'offline' && s.waiting === 2; }, 15000),
    JSON.stringify((await health(LAP)).standby) + out.laptop.slice(-300));
  mendLine();
  check('back: it sends, and follows again',
    await until(async () => { const s = (await health(LAP)).standby; return s.mode === 'following' && s.waiting === 0; }, 20000),
    JSON.stringify((await health(LAP)).standby));
  check('the owner\'s sale landed', q(MAIN_DATA, 'SELECT id FROM sales WHERE id = ?', s5.json.sale.id).length === 1);
  check('the switched-off cashier\'s sale did not', q(MAIN_DATA, 'SELECT id FROM sales WHERE id = ?', s4.json.sale.id).length === 0);
  const ownerLap2 = await signIn(LAP, 'owner1', 'correct-horse-9');
  check('the laptop counts it for a person', (await health(LAP)).standby.attention === 1);
  const list = await http(LAP, 'GET', '/api/standby/outbox', { cookie: ownerLap2 });
  const ent = list.json && list.json.entries && list.json.entries[0];
  check('…and lists it with the invoice, who, and MAIN\'s reason',
    ent && ent.ref === s4.json.sale.id && ent.who === 'Lubna Test' && ent.state === 'refused' && /access|account/i.test(ent.error || ''), JSON.stringify(list.json));
  const dis = await http(LAP, 'POST', '/api/standby/outbox/dismiss', { cookie: ownerLap2, body: { uuid: ent && ent.uuid } });
  check('a person puts it away once dealt with', dis.status === 200 && (await health(LAP)).standby.attention === 0, JSON.stringify(dis.json));
} finally {
  for (const p of Object.values(procs)) { try { p.kill(); } catch { /* gone */ } }
  relay.close();
  await sleep(800);
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* held */ }
}
console.log(`\noffline: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
