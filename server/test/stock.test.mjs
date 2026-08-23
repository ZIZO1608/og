/* ==========================================================================
   Stock — the movement log, and the oversell guard
   --------------------------------------------------------------------------
   The claim being tested: two tills cannot both sell the last pair, and the
   running total can never disagree with the movement log.
   ========================================================================== */

import { test, before, after, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as DB from '../lib/db.js';
import * as Stock from '../lib/stock.js';

before(() => { DB.open(':memory:'); });
after(() => { DB.close(); });

let n = 0;

/* A product with one size, and a known starting quantity on the shop floor. */
function makeVariant(floorQty = 10, storeQty = 0) {
  const at = DB.nowIso();
  const d = DB.get();
  const sku = `T-${++n}`;

  d.prepare(`INSERT INTO products (name, type, currency, created_at, updated_at)
             VALUES (?, 'sneakers', 'SYP', ?, ?)`).run(`Test ${n}`, at, at);
  const pid = d.prepare('SELECT last_insert_rowid() AS id').get().id;

  d.prepare(`INSERT INTO variants (sku, product_id, size, created_at, updated_at)
             VALUES (?, ?, '42', ?, ?)`).run(sku, pid, at, at);

  /* Seeded through the real path, so even the fixture has a movement behind
     it and the audit below is meaningful. */
  if (floorQty) Stock.receive({ sku, whId: 'floor', qty: floorQty, note: 'opening' });
  if (storeQty) Stock.receive({ sku, whId: 'store', qty: storeQty, note: 'opening' });

  return sku;
}

/* -------------------------------------------------------------- the basics */

describe('reading', () => {
  test('quantities land where they were put', () => {
    const sku = makeVariant(7, 3);
    assert.equal(Stock.qtyAt(sku, 'floor'), 7);
    assert.equal(Stock.qtyAt(sku, 'store'), 3);
    assert.equal(Stock.totalFor(sku), 10);
    assert.deepEqual(Stock.placesFor(sku), { floor: 7, store: 3 });
  });

  test('a size that has never existed anywhere reads as zero, not an error', () => {
    assert.equal(Stock.qtyAt('NEVER-EXISTED', 'floor'), 0);
    assert.deepEqual(Stock.placesFor('NEVER-EXISTED'), {});
  });
});

describe('receiving', () => {
  test('a delivery raises the count and leaves a movement', () => {
    const sku = makeVariant(5);
    const r = Stock.receive({ sku, whId: 'store', qty: 12, note: 'PO-3' });

    assert.equal(r.before, 0);
    assert.equal(r.after, 12);
    assert.equal(Stock.qtyAt(sku, 'store'), 12);

    const m = Stock.movementsFor(sku)[0];
    assert.equal(m.type, 'received');
    assert.equal(m.delta, 12);
    assert.equal(m.balance, 12, 'the movement records the balance AFTER it');
  });

  test('receiving nothing or a fraction is refused', () => {
    const sku = makeVariant(1);
    assert.throws(() => Stock.receive({ sku, whId: 'floor', qty: 0 }), /positive/);
    assert.throws(() => Stock.receive({ sku, whId: 'floor', qty: -3 }), /positive/);
    assert.throws(() => Stock.receive({ sku, whId: 'floor', qty: 1.5 }), /whole number/);
  });
});

/* ------------------------------------------------------------- overselling */

describe('the oversell guard', () => {
  test('selling more than exists is refused, and changes nothing', () => {
    const sku = makeVariant(3);
    const before = Stock.movementsFor(sku).length;

    assert.throws(
      () => DB.tx(d => Stock.sellLines(d, { lines: [{ sku, qty: 4 }], whId: 'floor' })),
      (e) => e.code === 'insufficient_stock' && e.available === 3 && e.wanted === 4
    );

    assert.equal(Stock.qtyAt(sku, 'floor'), 3, 'stock must be untouched');
    assert.equal(Stock.movementsFor(sku).length, before,
      'a refused sale must not leave a movement behind');
  });

  test('selling exactly what is left is allowed and lands on zero', () => {
    const sku = makeVariant(2);
    DB.tx(d => Stock.sellLines(d, { lines: [{ sku, qty: 2 }], whId: 'floor', saleId: 'INV-1' }));
    assert.equal(Stock.qtyAt(sku, 'floor'), 0);
  });

  test('TWO TILLS CANNOT BOTH SELL THE LAST PAIR', () => {
    /* The headline claim. One pair left; two sales attempted. */
    const sku = makeVariant(1);

    DB.tx(d => Stock.sellLines(d, { lines: [{ sku, qty: 1 }], whId: 'floor', saleId: 'INV-A' }));

    assert.throws(
      () => DB.tx(d => Stock.sellLines(d, { lines: [{ sku, qty: 1 }], whId: 'floor', saleId: 'INV-B' })),
      (e) => e.code === 'insufficient_stock'
    );

    assert.equal(Stock.qtyAt(sku, 'floor'), 0, 'never negative, whatever the tills believed');
  });

  test('the same size twice in one basket is counted together', () => {
    /* Two lines of 3 against a stock of 4 must fail. Checking each line on its
       own would pass both and take stock to -2. */
    const sku = makeVariant(4);

    assert.throws(
      () => DB.tx(d => Stock.sellLines(d, {
        lines: [{ sku, qty: 3 }, { sku, qty: 3 }], whId: 'floor', saleId: 'INV-C'
      })),
      (e) => e.code === 'insufficient_stock' && e.wanted === 6
    );

    assert.equal(Stock.qtyAt(sku, 'floor'), 4);
  });

  test('a basket is all or nothing', () => {
    const ok = makeVariant(10);
    const short = makeVariant(1);

    assert.throws(
      () => DB.tx(d => Stock.sellLines(d, {
        lines: [{ sku: ok, qty: 2 }, { sku: short, qty: 5 }],
        whId: 'floor', saleId: 'INV-D'
      })),
      (e) => e.code === 'insufficient_stock'
    );

    assert.equal(Stock.qtyAt(ok, 'floor'), 10,
      'the line that WOULD have succeeded must be rolled back too');
  });

  test('stock at the other place does not rescue a sale from the floor', () => {
    const sku = makeVariant(1, 50);   // 1 on the floor, 50 in the back
    assert.throws(
      () => DB.tx(d => Stock.sellLines(d, { lines: [{ sku, qty: 3 }], whId: 'floor' })),
      (e) => e.code === 'insufficient_stock' && e.available === 1
    );
    assert.equal(Stock.qtyAt(sku, 'store'), 50, 'the back room is untouched');
  });
});

/* --------------------------------------------------------------- transfers */

describe('transfers', () => {
  test('stock moves between places and the total is unchanged', () => {
    const sku = makeVariant(2, 20);
    Stock.transfer({ sku, from: 'store', to: 'floor', qty: 8 });

    assert.equal(Stock.qtyAt(sku, 'store'), 12);
    assert.equal(Stock.qtyAt(sku, 'floor'), 10);
    assert.equal(Stock.totalFor(sku), 22, 'a transfer creates nothing and destroys nothing');
  });

  test('a transfer of more than exists moves nothing at all', () => {
    const sku = makeVariant(5, 2);
    assert.throws(
      () => Stock.transfer({ sku, from: 'store', to: 'floor', qty: 9 }),
      (e) => e.code === 'insufficient_stock'
    );
    /* Both legs roll back — the danger is taking from source and failing to
       add to destination, which would delete stock. */
    assert.equal(Stock.qtyAt(sku, 'store'), 2);
    assert.equal(Stock.qtyAt(sku, 'floor'), 5);
  });

  test('transferring to the same place is refused', () => {
    const sku = makeVariant(5);
    assert.throws(() => Stock.transfer({ sku, from: 'floor', to: 'floor', qty: 1 }),
      /same place/);
  });
});

/* ------------------------------------------------------------------ counts */

describe('stock counts', () => {
  test('a shortfall is recorded as a correcting movement, not an overwrite', () => {
    const sku = makeVariant(10);
    const r = Stock.reconcile({ sku, whId: 'floor', counted: 7 });

    assert.equal(r.delta, -3);
    assert.equal(Stock.qtyAt(sku, 'floor'), 7);

    const m = Stock.movementsFor(sku)[0];
    assert.equal(m.type, 'count');
    assert.equal(m.delta, -3, 'the discrepancy stays visible in the trail');
  });

  test('finding more than expected also works', () => {
    const sku = makeVariant(4);
    assert.equal(Stock.reconcile({ sku, whId: 'floor', counted: 6 }).delta, 2);
    assert.equal(Stock.qtyAt(sku, 'floor'), 6);
  });

  test('a count that matches writes no movement', () => {
    const sku = makeVariant(5);
    const before = Stock.movementsFor(sku).length;
    const r = Stock.reconcile({ sku, whId: 'floor', counted: 5 });

    assert.equal(r.delta, 0);
    assert.equal(Stock.movementsFor(sku).length, before,
      'zero-delta rows are noise that hide the real discrepancies');
  });

  test('a negative count is refused', () => {
    const sku = makeVariant(5);
    assert.throws(() => Stock.reconcile({ sku, whId: 'floor', counted: -1 }), /positive/);
  });
});

/* ------------------------------------------------------------------- audit */

describe('the log and the running total agree', () => {
  test('after a long mixed sequence, nothing has drifted', () => {
    const sku = makeVariant(20, 5);

    Stock.receive({ sku, whId: 'floor', qty: 6 });
    DB.tx(d => Stock.sellLines(d, { lines: [{ sku, qty: 4 }], whId: 'floor', saleId: 'INV-X' }));
    Stock.transfer({ sku, from: 'store', to: 'floor', qty: 3 });
    Stock.writeOff({ sku, whId: 'floor', qty: 2, note: 'scuffed' });
    Stock.reconcile({ sku, whId: 'floor', counted: 22 });
    DB.tx(d => Stock.sellLines(d, { lines: [{ sku, qty: 5 }], whId: 'floor', saleId: 'INV-Y' }));

    /* 20 +6 -4 +3 -2 then counted to 22, then -5 => 17 */
    assert.equal(Stock.qtyAt(sku, 'floor'), 17);
    assert.equal(Stock.qtyAt(sku, 'store'), 2);

    const summed = Stock.movementsFor(sku, 500)
      .filter(m => m.wh_id === 'floor')
      .reduce((a, m) => a + m.delta, 0);
    assert.equal(summed, 17, 'the movement log alone must reproduce the running total');
  });

  test('the whole database audits clean', () => {
    const { checked, drift } = Stock.audit();
    assert.ok(checked > 0, 'the audit should have something to check');
    assert.deepEqual(drift, [],
      'a running total that disagrees with its log means something wrote around this module');
  });

  test('the audit actually notices drift when it is introduced', () => {
    /* Prove the check is not vacuous by writing to `stock` directly — the one
       thing the module exists to prevent. */
    const sku = makeVariant(5);
    DB.get().prepare('UPDATE stock SET qty = 99 WHERE sku = ? AND wh_id = ?')
            .run(sku, 'floor');

    const { drift } = Stock.audit();
    assert.ok(drift.some(r => r.sku === sku),
      'the audit must catch a hand-edited quantity, or it proves nothing');

    DB.get().prepare('UPDATE stock SET qty = 5 WHERE sku = ? AND wh_id = ?').run(sku, 'floor');
  });
});

/* ---------------------------------------------------------------- low stock */

describe('low stock', () => {
  test('lists what needs reordering, emptiest first', () => {
    const a = makeVariant(1);
    const b = makeVariant(9);
    makeVariant(80);

    const low = Stock.lowStock('floor', 10).map(r => r.sku);
    assert.ok(low.includes(a) && low.includes(b));
    assert.ok(low.indexOf(a) < low.indexOf(b), 'most urgent first');
  });

  test('hidden products are left out', () => {
    const sku = makeVariant(1);
    DB.get().prepare(
      'UPDATE products SET hidden = 1 WHERE id = (SELECT product_id FROM variants WHERE sku = ?)'
    ).run(sku);

    assert.ok(!Stock.lowStock('floor', 10).some(r => r.sku === sku),
      'a discontinued line should not appear on the reorder list');
  });
});
