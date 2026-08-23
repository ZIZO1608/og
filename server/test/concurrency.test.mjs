/* ==========================================================================
   Two tills, one pair left — for real this time
   --------------------------------------------------------------------------
   stock.test.mjs proves the CHECK constraint refuses an oversell when the
   calls happen one after another. That is not the same claim. The claim that
   matters is that it holds when several devices hit the SAME DATABASE FILE at
   the SAME MOMENT, through separate connections, with no coordination between
   them.

   That cannot be tested inside one process: node:sqlite is synchronous, so
   two calls in one process are serialised by JavaScript itself and the race
   never happens. So this spawns real child processes against a real file and
   lets them fight.

   What is actually under test is four things working together:
     WAL             so readers and writers do not simply block each other
     BEGIN IMMEDIATE so the write lock is taken up front, not upgraded midway
     busy_timeout    so a loser waits its turn instead of failing instantly
     CHECK (qty>=0)  so the last one through is refused rather than going negative
   ========================================================================== */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as DB from '../lib/db.js';
import * as Stock from '../lib/stock.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = resolve(HERE, '..', 'lib');

let dir, dbFile, workerFile;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'og-race-'));
  dbFile = join(dir, 'race.db');

  /* One child = one till. Opens its own connection and tries to sell. Prints a
     single word so the parent can count outcomes without parsing noise. */
  workerFile = join(dir, 'till.mjs');

  /* file:// URLs, not bare paths. The worker is written into a temp directory,
     so it imports the library by absolute path — and on Windows an absolute
     path starts "C:/", which ESM reads as a URL scheme named "c" and rejects. */
  const dbUrl = JSON.stringify(pathToFileURL(join(LIB, 'db.js')).href);
  const stockUrl = JSON.stringify(pathToFileURL(join(LIB, 'stock.js')).href);

  writeFileSync(workerFile, `
import * as DB from ${dbUrl};
import * as Stock from ${stockUrl};

const [dbFile, sku, qty, saleId] = process.argv.slice(2);
DB.open(dbFile);

/* Line the children up on a wall-clock instant so they collide rather than
   arriving in a queue as each one finishes booting. */
const startAt = Number(process.env.START_AT);
while (Date.now() < startAt) { /* spin */ }

try {
  DB.tx(d => Stock.sellLines(d, {
    lines: [{ sku, qty: Number(qty) }], whId: 'floor', saleId
  }));
  console.log('SOLD');
} catch (e) {
  console.log(e.code === 'insufficient_stock' ? 'REFUSED' : 'ERROR:' + e.message);
} finally {
  DB.close();
}
`);
});

after(() => {
  try { DB.close(); } catch { /* may already be closed */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
});

/* Set up a product with a known quantity in the shared file, then close our
   own handle so the children are genuinely the only writers. */
function seed(qty) {
  DB.open(dbFile);
  const at = DB.nowIso();
  const d = DB.get();
  const sku = 'RACE-' + Math.random().toString(36).slice(2, 8);

  d.prepare(`INSERT INTO products (name, type, currency, created_at, updated_at)
             VALUES ('Race Test', 'sneakers', 'SYP', ?, ?)`).run(at, at);
  const pid = d.prepare('SELECT last_insert_rowid() AS id').get().id;
  d.prepare(`INSERT INTO variants (sku, product_id, size, created_at, updated_at)
             VALUES (?, ?, '42', ?, ?)`).run(sku, pid, at, at);

  Stock.receive({ sku, whId: 'floor', qty, note: 'opening' });
  DB.close();
  return sku;
}

/* Launch `n` tills at once, each trying to buy `qty`. */
function race(sku, n, qty) {
  const startAt = Date.now() + 700;   // enough for every child to boot and spin
  const kids = [];

  for (let i = 0; i < n; i++) {
    kids.push(new Promise((res) => {
      try {
        const out = execFileSync(process.execPath,
          [workerFile, dbFile, sku, String(qty), `INV-${i}`],
          { env: { ...process.env, START_AT: String(startAt) }, encoding: 'utf8' });
        res(out.trim());
      } catch (e) {
        res('CRASH:' + (e.stderr || e.message || '').toString().slice(0, 200));
      }
    }));
  }
  return Promise.all(kids);
}

function finalQty(sku) {
  DB.open(dbFile);
  const q = Stock.qtyAt(sku, 'floor');
  const a = Stock.audit();
  DB.close();
  return { q, audit: a };
}

/* ------------------------------------------------------------------ tests */

describe('concurrent selling, separate processes, one database file', () => {
  test('five tills, one pair left — exactly one wins', async () => {
    const sku = seed(1);
    const results = await race(sku, 5, 1);

    const sold = results.filter(r => r === 'SOLD').length;
    const refused = results.filter(r => r === 'REFUSED').length;
    const broken = results.filter(r => r.startsWith('ERROR') || r.startsWith('CRASH'));

    assert.deepEqual(broken, [], 'no till should crash; losing is expected, erroring is not');
    assert.equal(sold, 1, `exactly one sale should succeed, got ${sold} (${results.join(',')})`);
    assert.equal(refused, 4);

    const { q, audit } = finalQty(sku);
    assert.equal(q, 0, 'stock must never go negative');
    assert.deepEqual(audit.drift, [], 'the log and the running total must still agree');
  });

  test('eight tills, three pairs left — exactly three win', async () => {
    const sku = seed(3);
    const results = await race(sku, 8, 1);

    const sold = results.filter(r => r === 'SOLD').length;
    const broken = results.filter(r => r.startsWith('ERROR') || r.startsWith('CRASH'));

    assert.deepEqual(broken, []);
    assert.equal(sold, 3, `three should sell, got ${sold} (${results.join(',')})`);

    const { q, audit } = finalQty(sku);
    assert.equal(q, 0);
    assert.deepEqual(audit.drift, []);
  });

  test('six tills each wanting two, seven in stock — three win, one short', async () => {
    /* The awkward case: the stock does not divide evenly. Three sales of two
       take six; the fourth cannot have its two and must be refused outright
       rather than partially served. */
    const sku = seed(7);
    const results = await race(sku, 6, 2);

    const sold = results.filter(r => r === 'SOLD').length;
    assert.equal(sold, 3, `got ${sold} (${results.join(',')})`);

    const { q, audit } = finalQty(sku);
    assert.equal(q, 1, 'the odd one is left on the shelf, not sold as a partial');
    assert.deepEqual(audit.drift, []);
  });

  test('plenty in stock — every till succeeds and none block out', async () => {
    /* The other failure mode: a lock held too long turns a busy shop into
       timeouts. With room for everyone, everyone should get through. */
    const sku = seed(50);
    const results = await race(sku, 8, 1);

    assert.equal(results.filter(r => r === 'SOLD').length, 8, results.join(','));

    const { q, audit } = finalQty(sku);
    assert.equal(q, 42);
    assert.deepEqual(audit.drift, []);
  });
});
