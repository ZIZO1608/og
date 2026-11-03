/* What the full pipeline check of 2 Nov 2026 found on the server side: a return
   taking its points back (whole, in parts, and spent ones coming home), a void
   refused on top of a return, a driver's handover list, and a stock count picked
   up rather than opened again. No server, no network, no real file touched. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const file = join(tmpdir(), `og-pipeline-${process.pid}-${Date.now()}.db`);
let DB, Cat, Sales, Orders, Counts;
let n = 0;

before(async () => {
  DB = await import('../lib/db.js');
  Cat = await import('../lib/catalogue.js');
  Sales = await import('../lib/sales.js');
  Orders = await import('../lib/orders.js');
  Counts = await import('../lib/counts.js');
  DB.open(file);
  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 100 });
  const d = DB.get();
  d.prepare("UPDATE config SET value = '10' WHERE key = 'loyalty.points_per_1000'").run();
  const at = DB.nowIso();
  d.prepare(
    `INSERT INTO users (username, name, role, pw_hash, pw_salt, active, created_at, updated_at)
     VALUES ('m1', 'Manager', 'manager', x'00', x'00', 1, ?, ?),
            ('d1', 'Driver One', 'delivery', x'00', x'00', 1, ?, ?),
            ('d2', 'Driver Two', 'delivery', x'00', x'00', 1, ?, ?)`
  ).run(at, at, at, at, at, at);
});

after(() => {
  try { DB.close(); } catch { /* already */ }
  for (const s of ['', '-wal', '-shm']) { try { rmSync(file + s); } catch { /* gone */ } }
});

const user = () => DB.get().prepare("SELECT * FROM users WHERE username = 'm1'").get();
const driver = (u) => DB.get().prepare('SELECT id FROM users WHERE username = ?').get(u).id;

function shoe() {
  n += 1;
  const r = Cat.createWithVariants({
    name: `Check ${n}`, type: 'sneakers', currency: 'USD', costPrice: 5000, sellingPrice: 10000,
    sizes: [{ size: '42', qty: 50 }, { size: '43', qty: 50 }], whId: 'store'
  });
  const skus = DB.get().prepare('SELECT sku FROM variants WHERE product_id = ? ORDER BY size').all(r.productId);
  return skus.map((s) => s.sku);
}

function customer(points = 0) {
  n += 1;
  const d = DB.get();
  const at = DB.nowIso();
  const id = Number(d.prepare(
    `INSERT INTO customers (name, phone, loyalty_points, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`Customer ${n}`, `0933000${String(n).padStart(3, '0')}`, points, at, at).lastInsertRowid);
  return id;
}

const pts = (id) => DB.get().prepare('SELECT loyalty_points AS p FROM customers WHERE id = ?').get(id).p;

function order(customerId, lines) {
  const out = Orders.create({
    lines, customerId, whId: 'store', currency: 'SYP',
    method: 'pickup', plan: 'receipt', dest: {}, userId: user().id, opId: `pc-${++n}`
  });
  return out.sale.id;
}

test('a whole order coming back takes its points back, once', () => {
  const [a] = shoe();
  const c = customer();
  const id = order(c, [{ sku: a, qty: 1 }]);
  const earned = pts(c);
  assert.ok(earned > 0, 'the order earned points');
  Orders.takeBack(id, { outcome: 'refund', lines: [{ sku: a, qty: 1 }] }, user());
  assert.equal(pts(c), 0);
  assert.equal(DB.get().prepare('SELECT points_earned AS p FROM sales WHERE id = ?').get(id).p, earned,
    'the sale still says what it earned');
});

test('returns in parts land on the same figure as one whole return', () => {
  const [a, b] = shoe();
  const c = customer();
  const id = order(c, [{ sku: a, qty: 2 }, { sku: b, qty: 1 }]);
  const earned = pts(c);
  Orders.takeBack(id, { outcome: 'refund', lines: [{ sku: a, qty: 1 }] }, user());
  const left = pts(c);
  assert.ok(left > 0 && left < earned, `part of them went: ${left} of ${earned}`);
  Orders.takeBack(id, { outcome: 'refund', lines: [{ sku: a, qty: 1 }] }, user());
  Orders.takeBack(id, { outcome: 'refund', lines: [{ sku: b, qty: 1 }] }, user());
  assert.equal(pts(c), 0);
});

test('points already spent elsewhere stop at zero and do not stop the return', () => {
  const [a] = shoe();
  const c = customer();
  const id = order(c, [{ sku: a, qty: 1 }]);
  DB.get().prepare('UPDATE customers SET loyalty_points = 1 WHERE id = ?').run(c);
  Orders.takeBack(id, { outcome: 'refund', lines: [{ sku: a, qty: 1 }] }, user());
  assert.equal(pts(c), 0);
});

test('the switch that keeps points on a void keeps them on a return too', () => {
  const [a] = shoe();
  const c = customer();
  const d = DB.get();
  d.prepare(
    "INSERT INTO config (key, value, updated_at) VALUES ('loyalty.void_reverses_points', '0', ?) ON CONFLICT (key) DO UPDATE SET value = '0'"
  ).run(DB.nowIso());
  const id = order(c, [{ sku: a, qty: 1 }]);
  const earned = pts(c);
  Orders.takeBack(id, { outcome: 'refund', lines: [{ sku: a, qty: 1 }] }, user());
  assert.equal(pts(c), earned);
  d.prepare("UPDATE config SET value = '1' WHERE key = 'loyalty.void_reverses_points'").run();
});

test('an order that came back cannot be voided as well', () => {
  const [a] = shoe();
  const c = customer();
  const id = order(c, [{ sku: a, qty: 1 }]);
  Orders.takeBack(id, { outcome: 'refund', lines: [{ sku: a, qty: 1 }] }, user());
  const before = DB.get().prepare('SELECT SUM(qty) AS q FROM stock WHERE sku = ?').get(a).q;
  assert.throws(() => Sales.voidSale(id, { reason: 'test', userId: user().id }),
    (e) => e.code === 'has_returns');
  assert.equal(DB.get().prepare('SELECT SUM(qty) AS q FROM stock WHERE sku = ?').get(a).q, before);
});

test('the handover list can be narrowed to one driver', () => {
  const u = user();
  const one = Orders.openHandover({ kind: 'driver', driverId: driver('d1'), userId: u.id, userName: u.name });
  const two = Orders.openHandover({ kind: 'driver', driverId: driver('d2'), userId: u.id, userName: u.name });
  assert.deepEqual(Orders.handoverList({ driverId: driver('d1') }).map((h) => h.id), [one.id]);
  assert.deepEqual(Orders.handoverList({ driverId: driver('d2') }).map((h) => h.id), [two.id]);
  assert.equal(Orders.handoverList({}).length, 2);
});

test('starting a count picks up a recent sheet and closes an old one', () => {
  const [a] = shoe();
  const u = user();
  const first = Counts.start({ whId: 'store', scope: 'all', userId: u.id });
  assert.ok(!first.resumed);
  Counts.setLines(first.id, [{ sku: a, counted: 7 }], u.id);

  const again = Counts.start({ whId: 'store', scope: 'all', userId: u.id });
  assert.equal(again.id, first.id);
  assert.equal(again.resumed, true);
  assert.equal(again.lines[0].counted, 7);

  const elsewhere = Counts.start({ whId: 'floor', scope: 'all', userId: u.id });
  assert.notEqual(elsewhere.id, first.id, 'another place is another sheet');

  DB.get().prepare('UPDATE stock_counts SET started_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 25 * 3600 * 1000).toISOString(), first.id);
  const fresh = Counts.start({ whId: 'store', scope: 'all', userId: u.id });
  assert.notEqual(fresh.id, first.id, 'figures from yesterday are not carried on with');
  assert.equal(Counts.get(first.id).status, 'cancelled');
});

/* --------------------------------------------------- a return at the till */
const place = (where, cur) => DB.get().prepare(
  'SELECT COALESCE(SUM(amount), 0) AS n FROM money_moves WHERE place = ? AND currency = ?').get(where, cur).n;
const onShelf = (sku) => DB.get().prepare('SELECT SUM(qty) AS q FROM stock WHERE sku = ?').get(sku).q;
const sell = (lines, extra = {}) => Sales.record({
  lines, whId: 'store', payment: 'cash', currency: 'SYP', userId: user().id, ...extra
});

test('a till return puts the pieces back and takes the money out of the drawer', () => {
  const [a] = shoe();
  const s = sell([{ sku: a, qty: 2 }]);
  const drawer = place('drawer', 'SYP');
  const stock = onShelf(a);
  const out = Orders.takeBackTill(s.id, { lines: [{ sku: a, qty: 1 }], opId: 'till-1-' + s.id }, user());
  assert.equal(out.refund, s.total / 2);
  assert.equal(place('drawer', 'SYP'), drawer - s.total / 2);
  assert.equal(onShelf(a), stock + 1);
  const again = Orders.takeBackTill(s.id, { lines: [{ sku: a, qty: 1 }], opId: 'till-1-' + s.id }, user());
  assert.equal(again.replayed, true);
  assert.equal(onShelf(a), stock + 1, 'a replay moves nothing');
  assert.equal(place('drawer', 'SYP'), drawer - s.total / 2);
});

test('a till return gives back what was paid, not the shelf price, and parts add up', () => {
  const [a, b] = shoe();
  const s = sell([{ sku: a, qty: 2 }, { sku: b, qty: 1 }], { discount: 100 });
  const paid = s.total;
  const one = Orders.takeBackTill(s.id, { lines: [{ sku: a, qty: 1 }] }, user());
  const two = Orders.takeBackTill(s.id, { lines: [{ sku: a, qty: 1 }] }, user());
  const three = Orders.takeBackTill(s.id, { lines: [{ sku: b, qty: 1 }] }, user());
  assert.equal(one.refund + two.refund + three.refund, paid);
  assert.throws(() => Orders.takeBackTill(s.id, { lines: [{ sku: b, qty: 1 }] }, user()),
    (e) => e.code === 'too_many');
});

test('a till return can stay with the customer as credit, and moves no cash', () => {
  const [a] = shoe();
  const c = customer();
  const s = sell([{ sku: a, qty: 1 }], { customerId: c });
  const drawer = place('drawer', 'SYP');
  Orders.takeBackTill(s.id, { outcome: 'credit', lines: [{ sku: a, qty: 1 }] }, user());
  assert.equal(place('drawer', 'SYP'), drawer);
  const row = DB.get().prepare("SELECT amount FROM customer_credit WHERE customer_id = ? AND kind = 'grant'").get(c);
  assert.equal(row.amount, s.total);
  assert.equal(pts(c), 0, 'its points went with it');
});

test('credit with nobody to hold it, a credit sale, a voided sale and an order are refused', () => {
  const [a] = shoe();
  const walkIn = sell([{ sku: a, qty: 1 }]);
  assert.throws(() => Orders.takeBackTill(walkIn.id, { outcome: 'credit', lines: [{ sku: a, qty: 1 }] }, user()),
    (e) => e.code === 'needs_customer');
  const c = customer();
  const owed = sell([{ sku: a, qty: 1 }], { payment: 'credit', customerId: c });
  assert.throws(() => Orders.takeBackTill(owed.id, { lines: [{ sku: a, qty: 1 }] }, user()),
    (e) => e.code === 'credit_sale');
  const gone = sell([{ sku: a, qty: 1 }]);
  Sales.voidSale(gone.id, { reason: 'test', userId: user().id });
  assert.throws(() => Orders.takeBackTill(gone.id, { lines: [{ sku: a, qty: 1 }] }, user()),
    (e) => e.code === 'voided');
  const parcel = order(customer(), [{ sku: a, qty: 1 }]);
  assert.throws(() => Orders.takeBackTill(parcel, { lines: [{ sku: a, qty: 1 }] }, user()),
    (e) => e.code === 'not_found');
});

test('a sale with a till return cannot be voided as well', () => {
  const [a] = shoe();
  const s = sell([{ sku: a, qty: 2 }]);
  Orders.takeBackTill(s.id, { lines: [{ sku: a, qty: 1 }] }, user());
  assert.throws(() => Sales.voidSale(s.id, { reason: 'test', userId: user().id }),
    (e) => e.code === 'has_returns');
});
