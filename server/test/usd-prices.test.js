/* 067 — every product is priced in dollars and the lira follows the rate.
   Against a throwaway database: the migration converts a lira product at the
   newest rate (and its check refuses a wrong divisor), a lira price is
   refused on the way in, and the website's feed carries both prices at the
   rate of the moment. No server, no network, no real file touched. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = join(tmpdir(), `og-usd-${process.pid}-${Date.now()}.db`);
const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '067_usd_prices.sql');

let DB, Cat, Photos, CHECKS;

before(async () => {
  DB = await import('../lib/db.js');
  Cat = await import('../lib/catalogue.js');
  Photos = await import('../lib/photos.js');
  ({ CHECKS } = await import('../lib/migration-checks.js'));
  DB.open(file);
});

after(() => {
  try { DB.close(); } catch { /* already */ }
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(file + suffix); } catch { /* gone */ } }
});

const d = () => DB.get();
const now = '2026-09-25T00:00:00.000Z';
function rawProduct(name, currency, price, cost) {
  return d().prepare(
    `INSERT INTO products (name, type, currency, cost_price, selling_price, created_at, updated_at)
     VALUES (?, 'sneakers', ?, ?, ?, ?, ?)`).run(name, currency, cost, price, now, now).lastInsertRowid;
}
/* The migration as the runner applies it: before, the SQL, after — in one
   transaction that an `after` throwing rolls back. */
function runMigration(sql) {
  const check = CHECKS['067_usd_prices.sql'];
  d().exec('BEGIN');
  try {
    const snap = check.before(d());
    d().exec(sql);
    check.after(d(), snap);
    d().exec('COMMIT');
  } catch (e) { d().exec('ROLLBACK'); throw e; }
}

test('067 converts every lira product to dollars at the newest rate, logged for the mirror', () => {
  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 130 });
  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 135 });
  const a = rawProduct('Lira shoe', 'SYP', 4725, 2700);
  const b = rawProduct('Odd shoe', 'SYP', 4700, 0);
  const c = rawProduct('Dollar shoe', 'USD', 2000, 900);
  const logBefore = d().prepare("SELECT COUNT(*) AS n FROM change_log WHERE note = 'priced in dollars (067)'").get().n;

  runMigration(readFileSync(MIG, 'utf8'));

  const one = (id) => ({ ...d().prepare('SELECT currency, selling_price, cost_price FROM products WHERE id = ?').get(id) });
  assert.deepEqual(one(a), { currency: 'USD', selling_price: 3500, cost_price: 2000 });
  assert.deepEqual(one(b), { currency: 'USD', selling_price: 3481, cost_price: 0 });
  assert.deepEqual(one(c), { currency: 'USD', selling_price: 2000, cost_price: 900 });
  const logged = d().prepare("SELECT COUNT(*) AS n FROM change_log WHERE note = 'priced in dollars (067)'").get().n;
  assert.equal(logged - logBefore, 2, 'one change_log row per converted product, none for the dollar one');
});

test("067's check refuses a wrong divisor and nothing is changed", () => {
  const id = rawProduct('Another lira shoe', 'SYP', 13500, 0);
  const broken = readFileSync(MIG, 'utf8').replace(/\* 100\.0 \//g, '* 10.0 /');
  assert.throws(() => runMigration(broken), /Another lira shoe/);
  const row = { ...d().prepare('SELECT currency, selling_price FROM products WHERE id = ?').get(id) };
  assert.deepEqual(row, { currency: 'SYP', selling_price: 13500 });
  runMigration(readFileSync(MIG, 'utf8'));
});

test('a lira price is refused on the way in', () => {
  assert.throws(
    () => Cat.createWithVariants({ name: 'New', type: 'sneakers', currency: 'SYP', sellingPrice: 5000, sizes: [{ size: '42' }] }),
    (e) => e.code === 'prices_in_dollars');
  const p = Cat.createWithVariants({ name: 'New dollar shoe', type: 'sneakers', currency: 'USD', sellingPrice: 3500, costPrice: 2000, sizes: [{ size: '42', qty: 2 }] });
  const id = p.productId;
  assert.throws(() => Cat.update(id, { currency: 'SYP', selling_price: 5000 }), (e) => e.code === 'prices_in_dollars');
  Cat.update(id, { selling_price: 4000 });
  assert.equal(d().prepare('SELECT selling_price FROM products WHERE id = ?').get(id).selling_price, 4000);
});

test('the website feed carries both prices at the rate of the moment', () => {
  const id = d().prepare("SELECT id FROM products WHERE name = 'New dollar shoe'").get().id;
  d().prepare('UPDATE products SET selling_price = 3500 WHERE id = ?').run(id);
  const colour = d().prepare('SELECT id FROM product_colours WHERE product_id = ?').get(id).id;
  for (const kind of ['model', 'product']) {
    Photos.add({ productId: id, colourId: colour, kind, url: `https://x.test/${kind}.jpg`, thumbUrl: `https://x.test/${kind}-s.jpg`, width: 10, height: 10 });
  }
  let w = Cat.webById(id);
  assert.deepEqual(w.prices, { USD: { amount: 3500, minorExp: 2 }, SYP: { amount: 4725, minorExp: 0 } });
  assert.equal(w.rate.rate, 135);
  assert.equal(w.price, 3500);
  assert.equal(w.currency, 'USD');

  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 140 });
  w = Cat.webList().find((x) => x.id === id);
  assert.equal(w.prices.SYP.amount, 4900, 'the lira follows the new rate without touching the product');
  assert.equal(Cat.webRate().rate, 140);
});
