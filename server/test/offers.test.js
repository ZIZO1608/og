/* 076 — offers. The shared rule (js/offermath.js) on its own, then real sales
   on a throwaway database: the line priced at the offer, list_price and
   offer_id written, a flash sale running out mid-basket, buy 2 get 1, the
   coupon left off a no-coupon offer, an offer that has not started, a void
   giving the pieces back, the website's `offer`, and a return refunding the
   free piece first. No server, no network, no real file touched. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const file = join(tmpdir(), `og-offers-${process.pid}-${Date.now()}.db`);
let DB, Cat, Sales, Offers, Orders, Coupons;
const M = () => globalThis.OfferMath;

before(async () => {
  DB = await import('../lib/db.js');
  Cat = await import('../lib/catalogue.js');
  Sales = await import('../lib/sales.js');
  Offers = await import('../lib/offers.js');
  Orders = await import('../lib/orders.js');
  Coupons = await import('../lib/coupons.js');
  DB.open(file);
  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 100 });
});

after(() => {
  try { Offers.stop(); } catch { /* not started */ }
  try { DB.close(); } catch { /* already */ }
  for (const s of ['', '-wal', '-shm']) { try { rmSync(file + s); } catch { /* gone */ } }
});

const past = '2026-01-01T00:00:00.000Z';
const future = '2099-01-01T00:00:00.000Z';

function shoe(name, cents, brand = 'Nike', type = 'sneakers') {
  const r = Cat.createWithVariants({
    name, type, brand, currency: 'USD', costPrice: Math.round(cents / 2), sellingPrice: cents,
    sizes: [{ size: '42', qty: 50 }], whId: 'store'
  });
  const id = r.productId;
  const sku = DB.get().prepare('SELECT sku FROM variants WHERE product_id = ?').get(id).sku;
  return { id, sku };
}

function sell(lines, extra = {}) {
  return Sales.record({ lines, whId: 'store', payment: 'cash', currency: 'USD', userId: null, ...extra });
}

const items = (saleId) => DB.get().prepare(
  'SELECT sku, qty, unit_price, list_price, offer_id FROM sale_items WHERE sale_id = ? ORDER BY id').all(saleId).map((r) => ({ ...r }));

/* ------------------------------------------------------------- the rule */

test('the shared rule: unit prices, cover, status', () => {
  const m = M();
  assert.equal(m.unitPrice({ kind: 'pct', pct: 25 }, 1999, 'USD'), 1499);
  assert.equal(m.unitPrice({ kind: 'off', amount: 500 }, 1999, 'USD'), 1499);
  assert.equal(m.unitPrice({ kind: 'off', amount: 5000 }, 1999, 'USD'), 0);
  assert.equal(m.unitPrice({ kind: 'price', amount: 3900 }, 5500, 'USD'), 3900);
  assert.equal(m.unitPrice({ kind: 'price', amount: 9900 }, 5500, 'USD'), 5500, 'never above its own price');
  assert.equal(m.unitPrice({ kind: 'off', amount: 500 }, 1999, 'SYP'), null, 'dollars off only a dollar price');
  const o = { id: 1, kind: 'pct', pct: 10, scope: 'all', targets: [{ kind: 'brand', ref: 'adidas', exclude: true }],
    active: true, startsAt: past, endsAt: future };
  assert.ok(m.covers(o, { id: 5, type: 'x', brand: 'Nike' }));
  assert.ok(!m.covers(o, { id: 5, type: 'x', brand: 'Adidas' }), 'excluded by brand, any case');
  assert.equal(m.status(o, Date.parse('2025-06-01'), {}), 'scheduled');
  assert.equal(m.status(o, Date.parse('2099-06-01'), {}), 'ended');
  assert.equal(m.status({ ...o, maxUnits: 3 }, Date.now(), { 1: 3 }), 'soldout');
  assert.equal(m.status({ ...o, active: false }, Date.now(), {}), 'off');
});

test('the shared rule: buy 2 get 1 takes the cheapest piece off', () => {
  const o = { id: 9, kind: 'bxgy', buyQty: 2, getQty: 1, pct: 100, scope: 'all', targets: [],
    active: true, startsAt: past, endsAt: future };
  const r = M().priceBasket([
    { productId: 1, list: 3000, currency: 'USD', qty: 2 },
    { productId: 2, list: 1000, currency: 'USD', qty: 1 }
  ], [o], Date.now(), {});
  assert.equal(r[0].total, 6000);
  assert.equal(r[1].total, 0);
  assert.deepEqual(r[1].segs, [{ qty: 1, price: 0, list: 1000, offerId: 9 }]);
});

/* -------------------------------------------------------------- the sale */

test('a sale under a % offer: the line is priced at the offer, not discounted', () => {
  const a = shoe('Air One', 10000);
  const off = Offers.create({ nameEn: 'Black Friday', nameAr: 'الجمعة السوداء', kind: 'pct', pct: 25,
    scope: 'pick', targets: [{ kind: 'product', ref: a.id }], startsAt: past, endsAt: future }, null);
  const s = sell([{ sku: a.sku, qty: 2 }]);
  assert.equal(s.discount, 0, 'an offer is not the discount column');
  assert.equal(s.total, 15000);
  assert.equal(s.offerSaved, 5000);
  assert.deepEqual(items(s.id), [{ sku: a.sku, qty: 2, unit_price: 7500, list_price: 10000, offer_id: off.id }]);
  Offers.update(off.id, { active: false }, null);
});

test('an offer that has not started charges the normal price', () => {
  const a = shoe('Later', 4000);
  Offers.create({ nameEn: 'Soon', nameAr: 'قريباً', kind: 'off', amount: 1000, scope: 'pick',
    targets: [{ kind: 'product', ref: a.id }], startsAt: future }, null);
  const s = sell([{ sku: a.sku, qty: 1 }]);
  assert.equal(s.total, 4000);
  assert.equal(items(s.id)[0].offer_id, null);
});

test('a flash sale runs out mid-basket, and a void gives the pieces back', () => {
  const a = shoe('Flash', 5000);
  const o = Offers.create({ nameEn: 'Flash', nameAr: 'فلاش', kind: 'price', amount: 3000, scope: 'pick',
    targets: [{ kind: 'product', ref: a.id }], startsAt: past, endsAt: future, maxUnits: 3 }, null);
  const s1 = sell([{ sku: a.sku, qty: 2 }]);
  assert.equal(s1.total, 6000);
  const s2 = sell([{ sku: a.sku, qty: 3 }]);
  assert.equal(s2.total, 3000 + 2 * 5000, 'one left at the offer, two at the price');
  assert.equal(items(s2.id).length, 2, 'the line split');
  assert.equal(Offers.list().find((x) => x.id === o.id).status, 'soldout');
  Sales.voidSale(s1.id, { reason: 'test', userId: null });
  assert.equal(Offers.list().find((x) => x.id === o.id).left, 2);
  Offers.update(o.id, { active: false }, null);
});

test('buy 2 get 1 on a sale, and a return refunds the free piece first', () => {
  const a = shoe('Trio', 2000, 'Puma');
  const o = Offers.create({ nameEn: '2+1', nameAr: '٢+١', kind: 'bxgy', buyQty: 2, getQty: 1, pct: 100,
    scope: 'pick', targets: [{ kind: 'brand', ref: 'puma' }], startsAt: past, endsAt: future }, null);
  const s = sell([{ sku: a.sku, qty: 3 }]);
  assert.equal(s.total, 4000);
  const r = Orders.returnable(s.id);
  assert.equal(r.length, 1, 'one row per size');
  assert.equal(r[0].qty, 3);
  assert.equal(r[0].unit_price, 0, 'the next piece back is the free one');
  assert.equal(Orders.refundFor(r[0].tiers, 0, 2), 2000);
  Offers.update(o.id, { active: false }, null);
});

test('a coupon is left off the pieces of an offer that does not take one', () => {
  const a = shoe('NoStack', 10000);
  const b = shoe('Plain', 10000, 'Other');
  Coupons.create({ code: 'TEN', kind: 'percent', percent: 10 }, null);
  const o = Offers.create({ nameEn: 'X', nameAr: 'س', kind: 'pct', pct: 20, scope: 'pick',
    targets: [{ kind: 'product', ref: a.id }], startsAt: past, endsAt: future, stackCoupons: false }, null);
  const s = sell([{ sku: a.sku, qty: 1 }, { sku: b.sku, qty: 1 }], { couponCode: 'TEN' });
  assert.equal(s.couponCut, 1000, 'ten per cent of the plain shoe only');
  assert.throws(() => sell([{ sku: a.sku, qty: 1 }], { couponCode: 'TEN' }), { code: 'coupon_offer_items' });
  Offers.update(o.id, { stackCoupons: true }, null);
  const s2 = sell([{ sku: a.sku, qty: 1 }], { couponCode: 'TEN' });
  assert.equal(s2.couponCut, 800, 'on top of the sale price once allowed');
  Offers.update(o.id, { active: false }, null);
});

test('a deal already sold at cannot change, and cannot be deleted', () => {
  const a = shoe('Locked', 3000);
  const o = Offers.create({ nameEn: 'L', nameAr: 'ل', kind: 'pct', pct: 10, scope: 'pick',
    targets: [{ kind: 'product', ref: a.id }], startsAt: past, endsAt: future }, null);
  sell([{ sku: a.sku, qty: 1 }]);
  assert.throws(() => Offers.update(o.id, { pct: 50 }, null), { code: 'offer_used' });
  assert.throws(() => Offers.remove(o.id, null), { code: 'offer_used' });
  Offers.update(o.id, { endsAt: '2098-01-01T00:00:00.000Z', nameEn: 'L2' }, null);
  Offers.update(o.id, { active: false }, null);
});

test('refusals name the box', () => {
  assert.throws(() => Offers.create({ nameEn: 'a', kind: 'pct', pct: 10, scope: 'all', startsAt: past }, null), { code: 'offer_name' });
  assert.throws(() => Offers.create({ nameEn: 'a', nameAr: 'ب', kind: 'pct', pct: 95, scope: 'all', startsAt: past }, null), { code: 'offer_bad_pct' });
  assert.throws(() => Offers.create({ nameEn: 'a', nameAr: 'ب', kind: 'pct', pct: 10, scope: 'pick', targets: [], startsAt: past }, null), { code: 'offer_no_targets' });
  assert.throws(() => Offers.create({ nameEn: 'a', nameAr: 'ب', kind: 'pct', pct: 10, scope: 'all', startsAt: future, endsAt: past }, null), { code: 'offer_end_before_start' });
  assert.throws(() => Offers.create({ nameEn: 'a', nameAr: 'ب', kind: 'pct', pct: 10, scope: 'pick',
    targets: [{ kind: 'product', ref: 999999 }], startsAt: past }, null), { code: 'offer_bad_product' });
});

test("the website's offer: price in both currencies, the badge, the end", () => {
  const a = shoe('Webby', 8000, 'Vans');
  const o = Offers.create({ nameEn: 'Vans week', nameAr: 'أسبوع فانز', kind: 'pct', pct: 50, scope: 'pick',
    targets: [{ kind: 'brand', ref: 'Vans' }], startsAt: past, endsAt: future, maxUnits: 10 }, null);
  const p = DB.get().prepare('SELECT * FROM products WHERE id = ?').get(a.id);
  const w = Offers.webOffer(p, Cat.webRate(), (x, fx) => ({
    USD: { amount: x.selling_price, minorExp: 2 }, SYP: { amount: Math.round(x.selling_price / 100 * fx.rate), minorExp: 0 }
  }), Offers.webState());
  assert.equal(w.id, o.id);
  assert.equal(w.off, 50);
  assert.equal(w.prices.USD.amount, 4000);
  assert.equal(w.prices.SYP.amount, 4000);
  assert.equal(w.left, 10);
  assert.equal(w.endsAt, future);
});
