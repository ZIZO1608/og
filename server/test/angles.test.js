/* A colour's 3D angles (migration 073, lib/angles.js) against a throwaway
   database: front and back are what a model needs, a taken angle is
   replaced in place and hands back the old files, every write is logged for
   the mirror, the catalogue bundle carries them, the website's answer does
   not, and deleting a product takes its angles with it. No network, no
   bucket — the addresses are made up. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const file = join(tmpdir(), `og-angles-${process.pid}-${Date.now()}.db`);
process.env.OG_ENV_FILE = join(tmpdir(), `og-angles-none-${process.pid}.env`);

let DB, Cat, Photos, Angles;
const ids = {};

before(async () => {
  DB = await import('../lib/db.js');
  Cat = await import('../lib/catalogue.js');
  Photos = await import('../lib/photos.js');
  Angles = await import('../lib/angles.js');
  DB.open(file);
  Cat.setRate({ base: 'USD', quote: 'SYP', rate: 135 });
  const r = Cat.createWithVariants({ name: 'Jersey', type: 'sneakers', currency: 'USD', sellingPrice: 3000,
    colours: [{ nameEn: 'Red', nameAr: 'أحمر', sizes: [{ size: 'M', qty: 0 }] },
              { nameEn: 'Blue', nameAr: 'أزرق', sizes: [{ size: 'M', qty: 0 }] }] });
  ids.p = r.productId; ids.red = r.colours[0].id; ids.blue = r.colours[1].id;
  for (const kind of ['model', 'product']) {
    Photos.add({ productId: ids.p, colourId: ids.red, kind, url: `https://img.test/${kind}.jpg`, thumbUrl: `https://img.test/${kind}-s.jpg` });
  }
  const other = Cat.createWithVariants({ name: 'Cap', type: 'sneakers', currency: 'USD', sellingPrice: 1000,
    colours: [{ nameEn: 'Black', nameAr: 'أسود', sizes: [{ size: 'One', qty: 0 }] }] });
  ids.other = other.productId; ids.otherColour = other.colours[0].id;
});

after(() => {
  try { DB.close(); } catch { /* already */ }
  for (const suffix of ['', '-wal', '-shm']) { try { rmSync(file + suffix); } catch { /* gone */ } }
});

const put = (angle, colourId = ids.red, n = 1) => Angles.add({ productId: ids.p, colourId, angle,
  url: `https://img.test/a/${angle}-${n}.jpg`, thumbUrl: `https://img.test/a/${angle}-${n}-s.jpg`, width: 1200, height: 1200 });
const logged = (id, op) => DB.get().prepare(
  "SELECT COUNT(*) AS n FROM change_log WHERE tbl = 'product_angles' AND row_id = ? AND op = ?").get(String(id), op).n;

test('a colour needs its front and its back before a model can be made', () => {
  assert.deepEqual(Angles.readiness(ids.p, ids.red).missing, ['front', 'back']);
  put('front');
  assert.deepEqual(Angles.readiness(ids.p, ids.red).missing, ['back']);
  put('left');
  assert.equal(Angles.readiness(ids.p, ids.red).ready, false, 'left does not stand in for back');
  put('back');
  const r = Angles.readiness(ids.p, ids.red);
  assert.equal(r.ready, true);
  assert.equal(r.count, 3);
  assert.equal(Angles.readiness(ids.p, ids.blue).ready, false, 'each colour is its own');
});

test('a taken angle is replaced in place, and the old files come back to be taken down', () => {
  const before = Angles.ofProduct(ids.p).find((a) => a.colourId === ids.red && a.angle === 'front');
  const r = put('front', ids.red, 2);
  assert.equal(r.angle.id, before.id, 'same row, so the mirror sees an update');
  assert.equal(r.angle.url, 'https://img.test/a/front-2.jpg');
  assert.deepEqual(r.previous, ['https://img.test/a/front-1.jpg', 'https://img.test/a/front-1-s.jpg']);
  assert.equal(logged(before.id, 'insert'), 1);
  assert.equal(logged(before.id, 'update'), 1);
});

test('what is refused is refused before anything would be uploaded', () => {
  assert.throws(() => Angles.assertCanAdd({ productId: ids.p, colourId: ids.red, angle: 'top' }), { code: 'bad_kind' });
  assert.throws(() => Angles.assertCanAdd({ productId: ids.p, colourId: ids.otherColour, angle: 'front' }), { code: 'bad_colour' });
  assert.throws(() => Angles.assertCanAdd({ productId: 999999, colourId: ids.red, angle: 'front' }), { code: 'not_found' });
  assert.throws(() => Angles.add({ productId: ids.p, colourId: ids.red, angle: 'right', url: '' }), { code: 'bad_image' });
});

test('the catalogue bundle carries the angles, front first; the website does not', () => {
  const p = Cat.list().find((x) => x.id === ids.p);
  assert.deepEqual(p.angles.filter((a) => a.colourId === ids.red).map((a) => a.angle), ['front', 'back', 'left']);
  assert.equal(p.photos.length, 2, 'the gallery is untouched');
  const web = JSON.stringify(Cat.webById(ids.p) ?? {});
  assert.ok(!web.includes('/a/'), 'no angle file reaches the website');
});

test('the gallery is unaffected: angles are not photos and do not change the cover', () => {
  const cover = DB.get().prepare('SELECT image_url FROM products WHERE id = ?').get(ids.p).image_url;
  assert.equal(cover, 'https://img.test/product-s.jpg');
});

test('an angle removed is logged and hands back its files', () => {
  const left = Angles.ofProduct(ids.p).find((a) => a.angle === 'left');
  const r = Angles.remove(left.id, null);
  assert.deepEqual(r.previous, ['https://img.test/a/left-1.jpg', 'https://img.test/a/left-1-s.jpg']);
  assert.equal(logged(left.id, 'delete'), 1);
  assert.throws(() => Angles.remove(left.id, null), { code: 'not_found' });
});

test('deleting a product takes its angles with it, logged, and returns their files', () => {
  const mine = Angles.ofProduct(ids.p);
  assert.ok(mine.length > 0);
  const r = Cat.remove(ids.p, null);
  assert.equal(Angles.ofProduct(ids.p).length, 0);
  for (const a of mine) {
    assert.equal(logged(a.id, 'delete'), 1);
    assert.ok(r.files.includes(a.url) && r.files.includes(a.thumbUrl));
  }
});
