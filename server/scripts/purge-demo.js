/* ============================================================================
   PURGE THE DEMO DATA                                        [purge-demo.js]
   ----------------------------------------------------------------------------
   Run:  node scripts/purge-demo.js                 (dry run — shows, changes nothing)
         node scripts/purge-demo.js --test-sales    (dry run, including test sales)
         node scripts/purge-demo.js --test-sales --yes

   The demo catalogue was hidden rather than deleted, because it had been sold
   and deleting it would have broken the invoices naming it. That was right at
   the time and is not any more: every one of those invoices was rung up by the
   test accounts. Nothing real was being protected, and meanwhile the hidden
   rows carried hundreds of pieces of stock that the warehouse totals and the
   dashboard were counting as real.

   TWO RULES, DELIBERATELY SEPARATE
   --------------------------------
   `demo = 1` is a flag the seeding script set. It is exact, it is safe, and it
   is the default.

   "a sale rung up by an account that no longer works here" is a JUDGEMENT. It
   is almost certainly a test sale, but almost is not a flag — so it sits
   behind --test-sales and never fires on its own.

   EVERY DELETE IS LOGGED
   ----------------------
   This is the thing the old demo-catalogue teardown got wrong. It deleted with
   direct SQL and called logChange() for none of it, so nineteen products
   vanished from this machine and stayed in Supabase forever. The reconcile
   script exists because of that bug. Every delete here writes a change_log
   entry, so the mirror follows on the next sync.
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';

import { load } from '../lib/env.js';
import * as DB from '../lib/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

load();
DB.open(DB_FILE);

const COMMIT = argv.includes('--yes');
const TEST_SALES = argv.includes('--test-sales');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const tick = (s) => `  \x1b[32m✓\x1b[0m ${s}`;
const warn = (s) => `  \x1b[33m!\x1b[0m ${s}`;
const bad = (s) => `  \x1b[31m✗\x1b[0m ${s}`;

const d = DB.get();
const one = (sql, ...p) => d.prepare(sql).get(...p);
const many = (sql, ...p) => d.prepare(sql).all(...p);

/* ------------------------------------------------------------ what goes */

const demoProducts = many('SELECT id, name FROM products WHERE demo = 1');
const demoCustomers = many('SELECT id, name FROM customers WHERE demo = 1');

const demoVariants = demoProducts.length
  ? many(`SELECT v.sku FROM variants v JOIN products p ON p.id = v.product_id
           WHERE p.demo = 1`)
  : [];

/* Sales that reference a demo product — these have to go whatever happens,
   because their line items point at rows that are about to disappear. */
const salesOnDemo = many(
  `SELECT DISTINCT i.sale_id AS id FROM sale_items i
     JOIN products p ON p.id = i.product_id WHERE p.demo = 1`
).map((r) => r.id);

/* And, only when asked: sales rung up by somebody who no longer works here.
   A retired account cannot ring a sale, so one that did was a test. */
const salesByGone = TEST_SALES
  ? many(
      `SELECT s.id FROM sales s
         LEFT JOIN users u ON u.id = s.cashier_id
        WHERE u.id IS NULL OR u.active = 0`
    ).map((r) => r.id)
  : [];

const saleIds = [...new Set([...salesOnDemo, ...salesByGone])];

const stockRows = demoVariants.length
  ? one(`SELECT COUNT(*) AS n, COALESCE(SUM(qty), 0) AS pieces FROM stock
          WHERE sku IN (${demoVariants.map(() => '?').join(',')})`,
        ...demoVariants.map((v) => v.sku))
  : { n: 0, pieces: 0 };

/* Movements are append-only and mirrored on a max-id cursor: deleting one here
   would strand it in Supabase with the cursor already past it, and nothing
   would ever notice. So they are never deleted — if a demo variant has any,
   that is a reason to stop and say so rather than to quietly desync. */
const demoMovements = demoVariants.length
  ? one(`SELECT COUNT(*) AS n FROM stock_movements
          WHERE sku IN (${demoVariants.map(() => '?').join(',')})`,
        ...demoVariants.map((v) => v.sku)).n
  : 0;

const saleItems = saleIds.length
  ? one(`SELECT COUNT(*) AS n FROM sale_items
          WHERE sale_id IN (${saleIds.map(() => '?').join(',')})`, ...saleIds).n
  : 0;
const deliveries = saleIds.length
  ? one(`SELECT COUNT(*) AS n FROM deliveries
          WHERE sale_id IN (${saleIds.map(() => '?').join(',')})`, ...saleIds).n
  : 0;
const debtPayments = saleIds.length
  ? one(`SELECT COUNT(*) AS n FROM debt_payments
          WHERE sale_id IN (${saleIds.map(() => '?').join(',')})`, ...saleIds).n
  : 0;

/* ---------------------------------------------------------------- report */

console.log('');
console.log(bold('  Purge the demo data'));
console.log(dim(`    ${DB_FILE}`));
console.log(dim(`    ${COMMIT ? 'FOR REAL — this deletes rows' : 'dry run — nothing will be changed'}`));
console.log('');

console.log(bold('Flagged demo (demo = 1)'));
console.log(`  products          ${String(demoProducts.length).padStart(5)}`);
demoProducts.forEach((p) => console.log(dim(`      ${p.name}`)));
console.log(`  their variants    ${String(demoVariants.length).padStart(5)}`);
console.log(`  their stock rows  ${String(stockRows.n).padStart(5)}   ${stockRows.pieces} pieces`);
console.log(`  customers         ${String(demoCustomers.length).padStart(5)}`);
demoCustomers.forEach((c) => console.log(dim(`      ${c.name}`)));

console.log('');
console.log(bold('Sales'));
console.log(`  referencing a demo product   ${String(salesOnDemo.length).padStart(5)}`);
if (TEST_SALES) {
  console.log(`  rung by a retired account    ${String(salesByGone.length).padStart(5)}`);
} else {
  console.log(dim('  rung by a retired account       — not counted; pass --test-sales'));
}
console.log(`  ${bold('to delete')}                    ${String(saleIds.length).padStart(5)}`);
console.log(`  their line items             ${String(saleItems).padStart(5)}`);
if (deliveries) console.log(`  their deliveries             ${String(deliveries).padStart(5)}`);
if (debtPayments) console.log(`  their debt payments          ${String(debtPayments).padStart(5)}`);

/* ---- what SURVIVES, said out loud. The point of this run is what is left. */
const keepProducts = many('SELECT id, name FROM products WHERE demo = 0');
const keepPieces = one(
  `SELECT COALESCE(SUM(s.qty), 0) AS n FROM stock s
     JOIN variants v ON v.sku = s.sku
     JOIN products p ON p.id = v.product_id
    WHERE p.demo = 0`
).n;
const keepMoves = one('SELECT COUNT(*) AS n FROM stock_movements').n - demoMovements;
const keepCustomers = one('SELECT COUNT(*) AS n FROM customers WHERE demo = 0').n;

console.log('');
console.log(bold('What is kept'));
console.log(`  products          ${String(keepProducts.length).padStart(5)}`);
keepProducts.forEach((p) => console.log(dim(`      ${p.name}`)));
console.log(`  pieces of stock   ${String(keepPieces).padStart(5)}`);
console.log(`  stock movements   ${String(keepMoves).padStart(5)}`);
console.log(`  customers         ${String(keepCustomers).padStart(5)}`);

if (demoMovements) {
  console.log('');
  console.log(bad(`${demoMovements} stock movement(s) belong to a demo variant.`));
  console.log(dim('    Movements are mirrored on a highest-id cursor, so deleting one here'));
  console.log(dim('    would leave it in Supabase with the cursor already past it and'));
  console.log(dim('    nothing would ever notice. Refusing rather than desyncing quietly.'));
  process.exit(2);
}

if (!demoProducts.length && !demoCustomers.length && !saleIds.length) {
  console.log('');
  console.log(tick('Nothing to purge — this shop is already clean.'));
  process.exit(0);
}

if (!COMMIT) {
  console.log('');
  console.log(bold('Dry run — nothing was changed'));
  console.log(dim('    Take a backup, then run again with --yes:'));
  console.log(dim('      npm run backup'));
  console.log(dim(`      node scripts/purge-demo.js${TEST_SALES ? ' --test-sales' : ''} --yes`));
  process.exit(0);
}

/* ----------------------------------------------------------------- do it */

const inList = (arr) => arr.map(() => '?').join(',');

const removed = DB.tx(() => {
  const out = {};

  /* Children before parents, all the way down. Every delete logs, so the
     mirror follows on the next sync rather than keeping rows this machine
     no longer has. */
  if (saleIds.length) {
    /* Deliveries first, and LOGGED. deliveries is a cursor table of its own
       in the mirror, so deleting one here without a log entry leaves it in
       Supabase pointing at a sale that is about to go — and the sale's own
       delete is then rejected by the foreign key. Found exactly that way. */
    const gone = many(
      `SELECT id FROM deliveries WHERE sale_id IN (${inList(saleIds)})`, ...saleIds
    ).map((r) => r.id);
    d.prepare(`DELETE FROM deliveries WHERE sale_id IN (${inList(saleIds)})`).run(...saleIds);
    for (const id of gone) DB.logChange('deliveries', id, 'delete', null, null);
    out.deliveries = gone.length;

    d.prepare(`DELETE FROM sale_items WHERE sale_id IN (${inList(saleIds)})`).run(...saleIds);
    d.prepare(`DELETE FROM debt_payments WHERE sale_id IN (${inList(saleIds)})`).run(...saleIds);
    d.prepare(`DELETE FROM sales WHERE id IN (${inList(saleIds)})`).run(...saleIds);
    /* sale_items cascade on the Postgres side, so the parent is enough for
       those. debt_payments cascade there too. */
    for (const id of saleIds) DB.logChange('sales', id, 'delete', null, null);
    out.sales = saleIds.length;
  }

  if (demoVariants.length) {
    const skus = demoVariants.map((v) => v.sku);
    d.prepare(`DELETE FROM stock WHERE sku IN (${inList(skus)})`).run(...skus);
    /* stock is keyed sku:wh_id in the mirror, so each place is its own row. */
    for (const sku of skus) {
      for (const w of many('SELECT id FROM warehouses')) {
        DB.logChange('stock', `${sku}:${w.id}`, 'delete', null, null);
      }
    }
    d.prepare(`DELETE FROM variants WHERE sku IN (${inList(skus)})`).run(...skus);
    for (const sku of skus) DB.logChange('variants', sku, 'delete', null, null);
    out.variants = skus.length;
  }

  if (demoProducts.length) {
    const ids = demoProducts.map((p) => p.id);
    d.prepare(`DELETE FROM products WHERE id IN (${inList(ids)})`).run(...ids);
    for (const id of ids) DB.logChange('products', id, 'delete', null, null);
    out.products = ids.length;
  }

  if (demoCustomers.length) {
    const ids = demoCustomers.map((c) => c.id);
    d.prepare(`DELETE FROM customers WHERE id IN (${inList(ids)})`).run(...ids);
    for (const id of ids) DB.logChange('customers', id, 'delete', null, null);
    out.customers = ids.length;
  }

  return out;
});

console.log('');
console.log(bold('Done'));
Object.keys(removed).forEach((k) => console.log(tick(`${removed[k]} ${k} removed`)));

const left = one(
  `SELECT (SELECT COUNT(*) FROM products)  AS p,
          (SELECT COUNT(*) FROM variants)  AS v,
          (SELECT COUNT(*) FROM sales)     AS s,
          (SELECT COUNT(*) FROM customers) AS c,
          (SELECT COALESCE(SUM(qty), 0) FROM stock) AS pieces,
          (SELECT COUNT(*) FROM stock_movements) AS m`
);
console.log('');
console.log(`  ${left.p} products · ${left.v} variants · ${left.pieces} pieces · ` +
            `${left.m} movements · ${left.s} sales · ${left.c} customers`);

const fk = many('PRAGMA foreign_key_check');
if (fk.length) console.log(bad(`${fk.length} foreign key violation(s) — investigate before syncing`));
else console.log(tick('No foreign key violations.'));

console.log('');
console.log(warn('Supabase still has these rows until you push the deletes:'));
console.log(dim('      npm run supabase:sync        carries them'));
console.log(dim('      npm run supabase:reconcile   should then report 0 and 0'));
console.log('');
