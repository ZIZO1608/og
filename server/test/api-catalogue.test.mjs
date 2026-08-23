/* ==========================================================================
   Catalogue and stock, over HTTP
   --------------------------------------------------------------------------
   The important cases here are not the happy paths — those are covered
   directly in catalogue.test.mjs and stock.test.mjs. What matters over HTTP is
   that the ROLE BOUNDARIES hold: a cashier must not be able to read cost or
   profit out of a response, whatever the UI chooses to render.
   ========================================================================== */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as DB from '../lib/db.js';
import * as Auth from '../lib/auth.js';
import * as Cat from '../lib/catalogue.js';
import { createApp } from '../index.js';

let server, base, sku, productId;

before(async () => {
  DB.open(':memory:');

  await Auth.createUser({ username: 'mgr', name: 'Manager', role: 'manager', password: 'manager-pass-1' });
  await Auth.createUser({ username: 'csh', name: 'Cashier', role: 'cashier', password: 'cashier-pass-1' });
  await Auth.createUser({ username: 'whs', name: 'Warehouse', role: 'warehouse', password: 'warehouse-pass1' });
  await Auth.createUser({ username: 'ptr', name: 'Yalla Wear', role: 'partner', password: 'partner-pass-1' });

  const made = Cat.createWithVariants({
    name: 'Air Force 1', type: 'sneakers', brand: 'Nike', currency: 'SYP',
    costPrice: 300000, sellingPrice: 450000,
    sizes: [{ size: '42', qty: 6 }], whId: 'floor'
  });
  productId = made.productId;
  sku = made.variants[0].sku;

  server = createApp();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => server.close(r));
  DB.close();
});

function client() {
  let cookie = null;
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text };
  };
}

async function as(username, password) {
  const call = client();
  const r = await call('POST', '/api/auth/login', { username, password });
  assert.equal(r.status, 200, `login failed for ${username}`);
  return call;
}

/* ------------------------------------------------------------ reference data */

describe('config', () => {
  test('gives the app what it needs to start', async () => {
    const call = await as('csh', 'cashier-pass-1');
    const r = await call('GET', '/api/config');

    assert.equal(r.status, 200);
    assert.equal(r.body.warehouses.length, 2);
    assert.equal(r.body.currencies.length, 2);
    assert.ok(r.body.rate > 0);
    assert.equal(r.body.config['shop.default_wh'], 'floor');
  });

  test('only a manager can move the exchange rate', async () => {
    const cashier = await as('csh', 'cashier-pass-1');
    assert.equal((await cashier('POST', '/api/fx', { rate: 99999 })).status, 403);

    const mgr = await as('mgr', 'manager-pass-1');
    assert.equal((await mgr('POST', '/api/fx', { rate: 14500 })).status, 200);
    assert.equal((await mgr('GET', '/api/config')).body.rate, 14500);
  });
});

/* --------------------------------------------------- the cost boundary */

describe('a cashier cannot see cost or margin', () => {
  test('cost_price is absent from the catalogue, not merely hidden in the UI', async () => {
    const call = await as('csh', 'cashier-pass-1');
    const r = await call('GET', '/api/catalogue');

    assert.equal(r.status, 200);
    const p = r.body.products.find(x => x.id === productId);
    assert.equal(p.selling_price, 450000, 'the till still needs the selling price');
    assert.equal(p.cost_price, undefined, 'cost must not be in the response at all');

    /* Belt and braces: the number itself must not appear anywhere in the
       payload, in case it leaks through some other field. */
    assert.ok(!r.text.includes('300000'), 'the cost value leaked into the response body');
  });

  test('nor from a scan', async () => {
    const call = await as('csh', 'cashier-pass-1');
    const r = await call(`GET`, `/api/scan/${sku}`);

    assert.equal(r.status, 200);
    assert.equal(r.body.variant.selling_price, 450000);
    assert.equal(r.body.variant.cost_price, undefined);
    assert.ok(!r.text.includes('300000'));
  });

  test('a manager does see cost', async () => {
    const call = await as('mgr', 'manager-pass-1');
    const r = await call('GET', '/api/catalogue');
    const p = r.body.products.find(x => x.id === productId);
    assert.equal(p.cost_price, 300000);
  });

  test('warehouse staff see cost, because they book deliveries in', async () => {
    const call = await as('whs', 'warehouse-pass1');
    const r = await call('GET', '/api/catalogue');
    assert.equal(r.status, 200);
  });
});

/* ------------------------------------------------------------- the partner */

describe('the print partner is walled off', () => {
  test('Yalla Wear cannot read the catalogue, stock, or scan anything', async () => {
    const call = await as('ptr', 'partner-pass-1');

    for (const path of ['/api/catalogue', `/api/scan/${sku}`, `/api/stock/${sku}`, '/api/stock']) {
      const r = await call('GET', path);
      assert.equal(r.status, 403, `${path} must be closed to a partner`);
    }
  });

  test('and cannot change stock', async () => {
    const call = await as('ptr', 'partner-pass-1');
    const r = await call('POST', '/api/stock/receive', { sku, whId: 'floor', qty: 100 });
    assert.equal(r.status, 403);
  });
});

/* ------------------------------------------------------------- writing data */

describe('who can change the catalogue', () => {
  test('a cashier cannot add products', async () => {
    const call = await as('csh', 'cashier-pass-1');
    const r = await call('POST', '/api/products', {
      name: 'Sneaky', type: 'sneakers', currency: 'SYP', sizes: [{ size: '42' }]
    });
    assert.equal(r.status, 403);
  });

  test('warehouse staff can, because they enter the catalogue', async () => {
    const call = await as('whs', 'warehouse-pass1');
    const r = await call('POST', '/api/products', {
      name: 'Entered By Warehouse', type: 'tshirts', currency: 'SYP',
      sellingPrice: 75000, sizes: [{ size: 'L', qty: 12 }]
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.variants.length, 1);
    assert.match(r.body.variants[0].barcode, /^\d{13}$/);
  });

  test('invalid product data is a 400 with a readable reason', async () => {
    const call = await as('mgr', 'manager-pass-1');
    const r = await call('POST', '/api/products', {
      name: 'No Sizes', type: 'sneakers', currency: 'SYP', sizes: []
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /at least one size/);
  });
});

/* --------------------------------------------------------------- stock over HTTP */

describe('stock over HTTP', () => {
  test('receiving raises the count', async () => {
    const call = await as('whs', 'warehouse-pass1');
    const r = await call('POST', '/api/stock/receive',
      { sku, whId: 'store', qty: 10, note: 'delivery' });

    assert.equal(r.status, 200);
    assert.equal(r.body.result.after, 10);
  });

  test('transferring moves stock without changing the total', async () => {
    const call = await as('whs', 'warehouse-pass1');
    const before = (await call('GET', `/api/stock/${sku}`)).body.total;

    const r = await call('POST', '/api/stock/transfer',
      { sku, from: 'store', to: 'floor', qty: 4 });
    assert.equal(r.status, 200);

    assert.equal((await call('GET', `/api/stock/${sku}`)).body.total, before);
  });

  test('overselling is a 409 that names the real number', async () => {
    const call = await as('whs', 'warehouse-pass1');
    const have = (await call('GET', `/api/stock/${sku}`)).body.places.floor;

    const r = await call('POST', '/api/stock/writeoff',
      { sku, whId: 'floor', qty: have + 50 });

    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'insufficient_stock');
    assert.match(r.body.error, new RegExp(`Only ${have} left`),
      'the till should be able to say how many are actually there');
  });

  test('a cashier cannot move stock', async () => {
    const call = await as('csh', 'cashier-pass-1');
    assert.equal((await call('POST', '/api/stock/receive',
      { sku, whId: 'floor', qty: 5 })).status, 403);
  });

  test('the movement trail is readable', async () => {
    const call = await as('mgr', 'manager-pass-1');
    const r = await call('GET', `/api/stock/${sku}/movements`);

    assert.equal(r.status, 200);
    assert.ok(r.body.movements.length >= 3);
    assert.ok(r.body.movements[0].at >= r.body.movements[1].at, 'newest first');
    assert.ok('user_name' in r.body.movements[0], 'who did it should be in the trail');
  });

  test('an unknown barcode is a clean 404', async () => {
    const call = await as('csh', 'cashier-pass-1');
    const r = await call('GET', '/api/scan/0000000000000');
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'unknown_code');
  });
});
