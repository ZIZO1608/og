/* 077 — the size guide (night shift 28 Oct 2026). The shared size order
   (js/sizeorder.js), the figure rule ("52,5" is 52.5, Arabic digits, one
   decimal, 0 < cm ≤ 300), a clothes product refused without a complete guide
   and nothing written, shoes allowed without one, a guide following a chart
   and taking its new numbers, and a new size adding its row. On a throwaway
   database: no server, no network, no real file touched. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const file = join(tmpdir(), `og-sizeguide-${process.pid}-${Date.now()}.db`);
let DB, Cat, SG;

before(async () => {
  DB = await import('../lib/db.js');
  Cat = await import('../lib/catalogue.js');
  SG = await import('../lib/sizeguide.js');
  DB.open(file);
  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 100 });
});
after(() => {
  try { DB.close(); } catch { /* already */ }
  for (const s of ['', '-wal', '-shm']) { try { rmSync(file + s); } catch { /* gone */ } }
});

const tee = (name, sizes, sizeGuide) => Cat.createWithVariants({
  name, type: 'tshirts', currency: 'USD', sellingPrice: 1500, sizeGuide,
  colours: [{ nameEn: 'Black', nameAr: 'أسود', sizes: sizes.map((s) => ({ size: s, qty: 1 })) }]
});
const rows = (sizes, f) => sizes.map((s, i) => ({ size: s, values: { chest: f(i) } }));

test('sizes sort as a person reads them, not as text', () => {
  const O = globalThis.SizeOrder;
  assert.deepEqual(O.sizes(['L', 'M', 'S', 'XL', 'XXL']), ['S', 'M', 'L', 'XL', 'XXL']);
  assert.deepEqual(O.sizes(['XXL', '3XL', 'XS', 'M']), ['XS', 'M', 'XXL', '3XL']);
  assert.deepEqual(O.sizes(['9', '42', '40.5', '10']), ['9', '10', '40.5', '42']);
  assert.deepEqual(O.sizes(['L', 'S', 'Free'], ['S', 'L']), ['S', 'L', 'Free']);
});

test('a figure: comma decimal, Arabic digits, the range and one decimal', () => {
  assert.equal(SG.parseFigure('52,5'), 52.5);
  assert.equal(SG.parseFigure('٥٢٫٥'), 52.5);
  assert.ok(Number.isNaN(SG.parseFigure('-5')));
  assert.throws(() => SG.createChart({ nameEn: 'x', type: 'tshirts', measures: ['chest'], rows: [{ size: 'S', values: { chest: '301' } }] }), { code: 'sg_out_of_range' });
  assert.throws(() => SG.createChart({ nameEn: 'x', type: 'tshirts', measures: ['chest'], rows: [{ size: 'S', values: { chest: '52.55' } }] }), { code: 'sg_one_decimal' });
});

test('a new T-shirt without a complete guide is refused, and nothing is written', () => {
  const n = () => DB.get().prepare('SELECT COUNT(*) n FROM products').get().n;
  const before = n();
  assert.throws(() => tee('No guide', ['S', 'M']), { code: 'sg_required' });
  assert.throws(() => tee('Half guide', ['S', 'M'], { measures: ['chest'], rows: rows(['S'], () => 50) }), { code: 'sg_incomplete' });
  assert.equal(n(), before);
  const r = tee('Good', ['M', 'S'], { measures: ['chest'], rows: rows(['S', 'M'], (i) => 50 + i) });
  assert.deepEqual(r.sizeGuide.rows.map((x) => x.size), ['S', 'M']);
});

test('shoes need no guide', () => {
  const r = Cat.createWithVariants({ name: 'Shoe', type: 'sneakers', currency: 'USD', sellingPrice: 5000, sizes: [{ size: '42', qty: 1 }] });
  assert.ok(r.productId);
  assert.equal(r.sizeGuide, null);
});

test('a guide following a chart takes its new numbers; a new size adds its row', () => {
  const c = SG.createChart({ nameEn: 'Tee', type: 'tshirts', measures: ['chest'], rows: rows(['S', 'M', 'L', 'XL', 'XXL'], (i) => 50 + i) });
  const r = tee('Follower', ['S', 'M'], { chartId: c.id, follows: true });
  assert.equal(SG.guideOf(r.productId).rows[0].values.chest, 50);
  const u = SG.updateChart(c.id, { rows: rows(['S', 'M', 'L', 'XL', 'XXL'], (i) => 60 + i) });
  assert.equal(u.refreshed, 1);
  assert.equal(SG.guideOf(r.productId).rows[0].values.chest, 60);
  Cat.addVariant({ productId: r.productId, size: 'L', qty: 1 });
  assert.deepEqual(SG.guideOf(r.productId).rows.map((x) => x.size), ['S', 'M', 'L']);
  assert.equal(SG.guideOf(r.productId).rows[2].values.chest, 62);
  const logged = DB.get().prepare("SELECT COUNT(*) n FROM change_log WHERE tbl = 'product_size_guides' AND row_id = ?").get(String(r.productId)).n;
  assert.ok(logged >= 3, 'every write is logged for the mirror');
});
