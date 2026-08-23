/* ==========================================================================
   Catalogue — money, barcodes, and entering products
   ========================================================================== */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import * as DB from '../lib/db.js';
import * as Cat from '../lib/catalogue.js';
import * as Stock from '../lib/stock.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Load the browser's js/codes.js and hand back its `Codes` object.

   It is a plain IIFE assigned to a global, with no imports and no build step —
   which is exactly what makes this possible. Running the real file rather than
   copying its logic here is the point: a copy would drift silently, and the
   whole reason for the test is to catch that. */
function loadFrontendCodes() {
  const src = readFileSync(resolve(HERE, '..', '..', 'js', 'codes.js'), 'utf8');
  const sandbox = { window: {}, document: undefined, console };
  runInNewContext(src + '\n;__out = Codes;', sandbox, { timeout: 5000 });
  return sandbox.__out;
}

before(() => { DB.open(':memory:'); });
after(() => { DB.close(); });

let n = 0;
const uniqName = (p) => `${p} ${++n}`;

/* ------------------------------------------------------------------- money
   Amounts are integers in minor units. This is the layer where a mistake
   silently costs the shop money, so it gets the most attention. */

describe('money is integers, never floats', () => {
  test('USD parses to cents', () => {
    assert.equal(Cat.toMinor('12.50', 'USD'), 1250);
    assert.equal(Cat.toMinor('0.05', 'USD'), 5);
    assert.equal(Cat.toMinor('100', 'USD'), 10000);
  });

  test('SYP parses to whole lira', () => {
    assert.equal(Cat.toMinor('45000', 'SYP'), 45000);
    assert.equal(Cat.toMinor('0', 'SYP'), 0);
  });

  test('more decimals than the currency has is refused, not rounded away', () => {
    /* Silently dropping a digit is how a price becomes wrong by a factor of
       ten and nobody notices until stocktake. */
    assert.throws(() => Cat.toMinor('12.505', 'USD'), /2 decimal place/);
    assert.throws(() => Cat.toMinor('45000.5', 'SYP'), /0 decimal place/);
  });

  test('rubbish is refused', () => {
    for (const bad of ['', 'abc', '1.2.3', '$5', '.']) {
      assert.throws(() => Cat.toMinor(bad, 'USD'), /not a number|decimal/,
        `"${bad}" should be refused`);
    }
  });

  test('formatting round-trips', () => {
    for (const [v, c] of [['12.50', 'USD'], ['0.05', 'USD'], ['45000', 'SYP']]) {
      assert.equal(Cat.fromMinor(Cat.toMinor(v, c), c), v);
    }
  });

  test('the classic float bug does not apply here', () => {
    /* 0.1 + 0.2 === 0.30000000000000004 in floating point. In minor units it
       is 10 + 20 === 30, exactly, which is the whole reason for the choice. */
    assert.equal(Cat.toMinor('0.10', 'USD') + Cat.toMinor('0.20', 'USD'), 30);
    assert.equal(Cat.fromMinor(30, 'USD'), '0.30');
  });

  test('an unknown currency throws rather than defaulting', () => {
    assert.throws(() => Cat.toMinor('1', 'EUR'), /unknown currency/);
  });
});

describe('exchange rates', () => {
  test('a new rate is recorded without destroying the old one', () => {
    const before = Cat.currentRate('USD', 'SYP');
    Cat.setRate({ base: 'USD', quote: 'SYP', rate: 15000 });
    assert.equal(Cat.currentRate('USD', 'SYP'), 15000);

    /* The old rate is still on record, which is what lets an old sale be
       reported at the rate it was actually made at. */
    assert.equal(Cat.rateAt('USD', 'SYP', '1970-01-02T00:00:00.000Z'), before);
  });

  test('a zero or negative rate is refused', () => {
    assert.throws(() => Cat.setRate({ base: 'USD', quote: 'SYP', rate: 0 }), /greater than zero/);
    assert.throws(() => Cat.setRate({ base: 'USD', quote: 'SYP', rate: -5 }), /greater than zero/);
  });

  test('converting USD to SYP and back', () => {
    const rate = 13000;
    /* $12.50 at 13,000 = 162,500 SYP */
    assert.equal(Cat.convert(1250, 'USD', 'SYP', rate), 162500);
    assert.equal(Cat.convert(162500, 'SYP', 'USD', rate), 1250);
  });

  test('converting to the same currency changes nothing', () => {
    assert.equal(Cat.convert(1250, 'USD', 'USD', 13000), 1250);
  });
});

/* ---------------------------------------------------------------- barcodes */

describe('barcodes', () => {
  test('the check digit agrees with real published EAN-13 codes', () => {
    /* Genuine barcodes whose check digits are a matter of public record,
       rather than numbers worked out here — a test that only agrees with my
       own arithmetic proves nothing about the standard. */
    assert.equal(Cat.ean13Check('590123412345'), 7);   // 5901234123457
    assert.equal(Cat.ean13Check('400638133393'), 1);   // 4006381333931
    assert.equal(Cat.ean13Check('622103301284'), 4);   // the app's DEMO_BARCODE
  });

  test('the server and the browser compute the SAME check digit', () => {
    /* The property that actually matters: a code the server issues has to
       validate at the till. Two copies of an algorithm drift, so rather than
       trusting that they match, load the real js/codes.js and compare across
       a wide spread of inputs. */
    const frontend = loadFrontendCodes();

    for (let i = 0; i < 400; i++) {
      const body = String(Math.floor(Math.random() * 1e12)).padStart(12, '0');
      assert.equal(
        Cat.ean13Check(body), frontend.ean13Check(body),
        `server and browser disagree on ${body}`
      );
    }

    /* Edge cases a random sweep is unlikely to hit. */
    for (const body of ['000000000000', '999999999999', '111111111111']) {
      assert.equal(Cat.ean13Check(body), frontend.ean13Check(body), body);
    }
  });

  test('issued barcodes are 13 digits and self-consistent', () => {
    const { variants } = Cat.createWithVariants({
      name: uniqName('Barcode Test'), type: 'sneakers', currency: 'SYP',
      sizes: [{ size: '41' }, { size: '42' }]
    });

    for (const v of variants) {
      assert.match(v.barcode, /^\d{13}$/);
      assert.equal(
        Cat.ean13Check(v.barcode.slice(0, 12)), Number(v.barcode[12]),
        'the check digit must validate or the scanner rejects it'
      );
    }
  });

  test('no two sizes ever share a barcode', () => {
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      const { variants } = Cat.createWithVariants({
        name: uniqName('Collide'), type: 'tshirts', currency: 'SYP',
        sizes: [{ size: 'S' }, { size: 'M' }, { size: 'L' }]
      });
      for (const v of variants) {
        assert.ok(!seen.has(v.barcode), `duplicate barcode ${v.barcode}`);
        seen.add(v.barcode);
      }
    }
    assert.equal(seen.size, 36);
  });
});

/* ------------------------------------------------------- entering products */

describe('entering a product', () => {
  test('a product and all its sizes go in with one call', () => {
    const { productId, variants } = Cat.createWithVariants({
      name: 'Air Force 1', type: 'sneakers', brand: 'Nike', currency: 'SYP',
      costPrice: 300000, sellingPrice: 450000,
      sizes: [{ size: '41', qty: 5 }, { size: '42', qty: 3 }, { size: '43' }]
    });

    assert.equal(variants.length, 3);

    const p = Cat.byId(productId);
    assert.equal(p.name, 'Air Force 1');
    assert.equal(p.selling_price, 450000);
    assert.equal(p.variants.length, 3);
  });

  test('opening stock arrives as a real movement, not a starting number', () => {
    const { variants } = Cat.createWithVariants({
      name: uniqName('Opening'), type: 'sneakers', currency: 'SYP',
      sizes: [{ size: '42', qty: 9 }], whId: 'store'
    });

    const sku = variants[0].sku;
    assert.equal(Stock.qtyAt(sku, 'store'), 9);

    const m = Stock.movementsFor(sku);
    assert.equal(m.length, 1);
    assert.equal(m[0].type, 'received');
    assert.equal(m[0].delta, 9);
    assert.equal(m[0].note, 'opening stock');
  });

  test('opening stock reconciles with the movement log', () => {
    Cat.createWithVariants({
      name: uniqName('Audit'), type: 'jeans', currency: 'USD',
      sizes: [{ size: '32', qty: 4 }, { size: '34', qty: 6 }]
    });
    assert.deepEqual(Stock.audit().drift, []);
  });

  test('a size with no quantity creates the size but no stock', () => {
    const { variants } = Cat.createWithVariants({
      name: uniqName('No Stock'), type: 'sneakers', currency: 'SYP',
      sizes: [{ size: '44' }]
    });
    assert.equal(Stock.qtyAt(variants[0].sku, 'store'), 0);
    assert.equal(Stock.movementsFor(variants[0].sku).length, 0);
  });

  test('bad input is refused before anything is written', () => {
    const count = () => DB.get().prepare('SELECT COUNT(*) AS n FROM products').get().n;
    const before = count();

    assert.throws(() => Cat.createWithVariants({
      name: '', type: 'sneakers', currency: 'SYP', sizes: [{ size: '42' }]
    }), /name is required/);

    assert.throws(() => Cat.createWithVariants({
      name: 'X', type: 'sneakers', currency: 'SYP', sizes: []
    }), /at least one size/);

    assert.throws(() => Cat.createWithVariants({
      name: 'X', type: 'sneakers', currency: 'XYZ', sizes: [{ size: '42' }]
    }), /unknown currency/);

    assert.throws(() => Cat.createWithVariants({
      name: 'X', type: 'sneakers', currency: 'SYP',
      sizes: [{ size: '42' }, { size: '42' }]
    }), /listed twice/);

    assert.equal(count(), before, 'a rejected product must leave nothing behind');
  });

  test('per-product currency really is per product', () => {
    /* The shop prices some goods in dollars and some in lira. */
    const usd = Cat.createWithVariants({
      name: uniqName('Imported'), type: 'sneakers', currency: 'USD',
      costPrice: Cat.toMinor('45.00', 'USD'),
      sellingPrice: Cat.toMinor('89.99', 'USD'),
      sizes: [{ size: '42' }]
    });
    const syp = Cat.createWithVariants({
      name: uniqName('Local'), type: 'tshirts', currency: 'SYP',
      sellingPrice: Cat.toMinor('75000', 'SYP'),
      sizes: [{ size: 'L' }]
    });

    assert.equal(Cat.byId(usd.productId).currency, 'USD');
    assert.equal(Cat.byId(usd.productId).selling_price, 8999);
    assert.equal(Cat.byId(syp.productId).currency, 'SYP');
    assert.equal(Cat.byId(syp.productId).selling_price, 75000);
  });
});

/* ------------------------------------------------------------------ lookup */

describe('scanning', () => {
  test('a barcode finds the size and its product', () => {
    const { variants } = Cat.createWithVariants({
      name: 'Scan Me', type: 'boots', brand: 'Timberland', currency: 'SYP',
      sellingPrice: 600000, sizes: [{ size: '43', qty: 2 }]
    });

    const hit = Cat.byBarcode(variants[0].barcode);
    assert.equal(hit.name, 'Scan Me');
    assert.equal(hit.size, '43');
    assert.equal(hit.selling_price, 600000);
  });

  test('the printed sku works too, for typing by hand', () => {
    const { variants } = Cat.createWithVariants({
      name: uniqName('Typed'), type: 'boots', currency: 'SYP', sizes: [{ size: '43' }]
    });
    assert.equal(Cat.byBarcode(variants[0].sku).sku, variants[0].sku);
  });

  test('an unknown code returns null rather than throwing', () => {
    assert.equal(Cat.byBarcode('0000000000000'), null);
  });
});

/* ------------------------------------------------------------------ edits */

describe('editing', () => {
  test('a price change sticks', () => {
    const { productId } = Cat.createWithVariants({
      name: uniqName('Repriced'), type: 'jackets', currency: 'SYP',
      sellingPrice: 100000, sizes: [{ size: 'M' }]
    });

    Cat.update(productId, { selling_price: 125000 });
    assert.equal(Cat.byId(productId).selling_price, 125000);
  });

  test('unknown fields are ignored, not written', () => {
    const { productId } = Cat.createWithVariants({
      name: uniqName('Safe'), type: 'jackets', currency: 'SYP', sizes: [{ size: 'M' }]
    });
    Cat.update(productId, { selling_price: 5, id: 9999, hacked: true });
    assert.equal(Cat.byId(productId).id, productId, 'the primary key must not be editable');
  });

  test('hiding removes a product from the list without deleting it', () => {
    const { productId } = Cat.createWithVariants({
      name: uniqName('Discontinued'), type: 'shirts', currency: 'SYP', sizes: [{ size: 'S' }]
    });

    Cat.hide(productId);
    assert.ok(!Cat.list().some(p => p.id === productId));
    assert.ok(Cat.list({ includeHidden: true }).some(p => p.id === productId));

    /* Deleting would break every past sale that referenced it. */
    assert.ok(Cat.byId(productId), 'the record itself must survive');
  });

  test('a new size can be added later', () => {
    const { productId } = Cat.createWithVariants({
      name: uniqName('Growing'), type: 'sneakers', currency: 'SYP', sizes: [{ size: '41' }]
    });

    const v = Cat.addVariant({ productId, size: '45' });
    assert.equal(v.size, '45');
    assert.equal(Cat.byId(productId).variants.length, 2);

    assert.throws(() => Cat.addVariant({ productId, size: '45' }), /already exists/);
  });
});

/* ------------------------------------------------------------------ listing */

describe('listing', () => {
  test('a product carries its sizes and per-place stock', () => {
    const { productId, variants } = Cat.createWithVariants({
      name: uniqName('Listed'), type: 'sneakers', currency: 'SYP',
      sizes: [{ size: '42', qty: 4 }], whId: 'store'
    });
    Stock.transfer({ sku: variants[0].sku, from: 'store', to: 'floor', qty: 1 });

    const p = Cat.list().find(x => x.id === productId);
    /* Same shape as variant.wh in the browser, so the client can use it
       directly rather than reshaping it. */
    assert.deepEqual(p.variants[0].wh, { store: 3, floor: 1 });
    assert.equal(p.variants[0].total, 4);
  });
});
