/* ==========================================================================
   Fill a scratch database with a shop's worth of goods
   --------------------------------------------------------------------------
   Until the browser started reading the catalogue from the server, the two
   never had to agree: the till drew 24 products out of js/data.js while the
   `products` table held one row somebody made while testing. Charging a basket
   died on `unknown item`, and the one SKU that existed on both sides sold at
   the wrong price under the wrong name.

   Now the till shows what the server has. Which means an empty server is an
   empty shop — correct, and useless for showing anyone how the system works.
   This puts a real catalogue behind it: 24 products, every size, opening stock
   booked through the same movement log a delivery uses, and forty customers.

   THESE ARE NOT THE SHOP'S REAL GOODS. The prices are invented. Every row it
   writes carries `demo = 1`, so removing them is a WHERE clause rather than a
   guess at which Nike Air Force 1 was the fake one:

       npm run demo-catalogue -- --remove

   What it deliberately does NOT do is fabricate sales. Seeded stock is a
   starting position and can simply be wrong; seeded invoices are invented
   money in a real set of books, and every profit figure downstream would
   inherit it. In live mode the dashboard starts thin and true. The full story
   is what demo mode is for.

   Usage:
     npm run demo-catalogue              create them
     npm run demo-catalogue -- --remove  take them out again
     npm run demo-catalogue -- --force   create alongside real products
   ========================================================================== */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';

import * as DB from '../lib/db.js';
import * as Cat from '../lib/catalogue.js';
import * as Stock from '../lib/stock.js';
import * as Customers from '../lib/customers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_FILE = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');

const has = (f) => argv.includes(`--${f}`);

/* --------------------------------------------------------------- the goods */

const SIZE_SETS = {
  sneakers: ['39', '40', '41', '42', '43', '44', '45'],
  crocs:    ['39', '40', '41', '42', '43', '44', '45'],
  boots:    ['40', '41', '42', '43', '44', '45'],
  tshirts:  ['S', 'M', 'L', 'XL', 'XXL'],
  jerseys:  ['S', 'M', 'L', 'XL', 'XXL'],
  shirts:   ['S', 'M', 'L', 'XL', 'XXL'],
  jackets:  ['S', 'M', 'L', 'XL', 'XXL'],
  jeans:    ['28', '30', '32', '34', '36', '38']
};

/* name, type, brand, made in, colour block, colourway, cost, price, shelf zone

   Prices are in NEW Syrian pounds, whole units — SYP has minor_exp 0, so the
   integer here is the integer in the database. A shoe at 12,500 is a shoe at
   12,500. (These were 100x larger before migration 005.) */
const PRODUCTS = [
  ["Nike Air Force 1 '07",      'sneakers', 'Nike',        'Vietnam',   '#5B5B66', 'Triple White',   7800,  12500, 'A'],
  ['Nike Air Max 90',           'sneakers', 'Nike',        'Vietnam',   '#3E5C8A', 'Infrared',       8600,  13900, 'A'],
  ['Nike Dunk Low Panda',       'sneakers', 'Nike',        'China',     '#4A4A52', 'Black / White',  9100,  14900, 'A'],
  ['Adidas Samba OG',           'sneakers', 'Adidas',      'Indonesia', '#6B5B45', 'Core Black',     7200,  11800, 'A'],
  ['Adidas Campus 00s',         'sneakers', 'Adidas',      'Indonesia', '#6455A0', 'Dark Green',     6900,  11200, 'A'],
  ['New Balance 550',           'sneakers', 'New Balance', 'Vietnam',   '#7E8B99', 'White / Green',  8300,  13400, 'B'],
  ['Converse Chuck 70 Hi',      'sneakers', 'Converse',    'Vietnam',   '#8E3B3B', 'Egret',          5400,   8900, 'B'],
  ['Timberland 6" Premium',     'boots',    'Timberland',  'Dominican', '#B5822F', 'Wheat Nubuck',  13200,  20500, 'C'],
  ['Dr. Martens 1460',          'boots',    'Dr. Martens', 'Thailand',  '#7A2B28', 'Cherry Red',    11800,  18500, 'C'],
  ['CAT Colorado Boot',         'boots',    'Caterpillar', 'Vietnam',   '#8A6E3A', 'Honey Reset',    9400,  14800, 'C'],
  ['OG Heavyweight Tee',        'tshirts',  'OG',          'Syria',     '#4A4A52', 'Washed Black',   1050,   2250, 'D'],
  ['OG Box Logo Tee',           'tshirts',  'OG',          'Syria',     '#A8946E', 'Sand',           1120,   2450, 'D'],
  ['Stussy Basic Tee',          'tshirts',  'Stussy',      'Turkey',    '#3A5478', 'Navy',           1480,   2950, 'D'],
  ['Carhartt WIP Pocket Tee',   'tshirts',  'Carhartt',    'Turkey',    '#8A7658', 'Hamilton Brown', 1600,   3200, 'D'],
  ['Nike Sportswear Club Tee',  'tshirts',  'Nike',        'Egypt',     '#A33636', 'University Red',  950,   1980, 'D'],
  ["Levi's 501 Original",       'jeans',    "Levi's",      'Egypt',     '#4A6A8F', 'Mid Stone',      3400,   6200, 'E'],
  ["Levi's 511 Slim",           'jeans',    "Levi's",      'Egypt',     '#35496B', 'Rinse Dark',     3250,   5950, 'E'],
  ['OG Baggy Denim',            'jeans',    'OG',          'Syria',     '#6E8299', 'Light Wash',     2350,   4450, 'E'],
  ['Real Madrid Home 24/25',    'jerseys',  'Adidas',      'Thailand',  '#9CA3AF', 'White / Gold',   2150,   4200, 'F'],
  ['Barcelona Away 24/25',      'jerseys',  'Nike',        'Thailand',  '#C9A227', 'Yellow',         2050,   4050, 'F'],
  ['Al-Ittihad Home 24/25',     'jerseys',  'Nike',        'Thailand',  '#2F5744', 'Black / Yellow', 1680,   3450, 'F'],
  ['Crocs Classic Clog',        'crocs',    'Crocs',       'China',     '#3E7A9E', 'Bijou Blue',     2450,   4300, 'G'],
  ['OG Oxford Shirt',           'shirts',   'OG',          'Syria',     '#7E92A3', 'Powder Blue',    1860,   3490, 'H'],
  ['OG Denim Jacket',           'jackets',  'OG',          'Syria',     '#5A748C', 'Stone Wash',     4180,   7850, 'B']
];

/* Products with healthy total stock and nothing in the sizes people actually
   ask for. The shop's real problem, and the one insight in the pitch that the
   owner recognises immediately — so it has to survive into the seeded data
   rather than only existing in the browser's generator. Keyed by position in
   the list above, because the database assigns the real ids. */
const SIZE_GAP = {
  0:  ['42', '43'],      // Air Force 1 — the two everyone wants
  10: ['M', 'L'],        // OG Heavyweight Tee
  15: ['32', '34']       // Levi's 501
};

const CITIES = ['Damascus', 'Aleppo', 'Homs', 'Latakia', 'Hama', 'Tartus', 'Deir ez-Zor'];

const CUSTOMERS = [
  'Ahmad Al-Khatib', 'Layla Haddad', 'Omar Sayegh', 'Rana Mansour',
  'Bashar Nassar', 'Nour Al-Ali', 'Karim Deeb', 'Hala Zaher',
  'Yousef Kanaan', 'Maya Shaheen', 'Tarek Jaber', 'Salma Rifai',
  'Fadi Barakat', 'Dina Halabi', 'Samer Aswad', 'Lina Tarabishi',
  'Hassan Murad', 'Reem Qassab', 'Ziad Sabbagh', 'Joud Attar',
  'Malek Hamwi', 'Sara Kurdi', 'Anas Shami', 'Yara Malki',
  'Rami Daoud', 'Tala Ibrahim', 'Wael Khoury', 'Nada Sultan',
  'Bilal Ammar', 'Rita Azzam', 'Majd Rustom', 'Aya Fares',
  'Ibrahim Saleh', 'Ghina Aboud', 'Nabil Homsi', 'Rasha Debs',
  'Kinan Trad', 'Farah Zeitoun', 'Adel Baroudi', 'Lama Sharif'
];

/* Its own generator, with its own seed. Reproducible so two runs of this
   script produce the same shop, and separate from anything in js/data.js so it
   cannot shift that sequence — the frontend's LCG is positional and inserting
   a draw anywhere silently rewrites everything after it. */
let seed = 20260824;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

function openingQty(gapped, hasGap) {
  if (gapped) return 0;
  if (hasGap) return ri(9, 22);          // deliberately healthy around the gap
  const roll = rnd();
  if (roll < 0.10) return 0;
  if (roll < 0.24) return ri(1, 3);
  if (roll < 0.42) return ri(4, 9);
  return ri(10, 34);
}

/* ------------------------------------------------------------------- main */

async function main() {
  /* A real server sets this. Invented prices must never reach one — a shop
     selling from a seeded price list is worse than a shop with no system. */
  if (env.OG_SECURE === '1' && !has('remove')) {
    console.error('');
    console.error('  REFUSING: OG_SECURE=1 means this is a real server.');
    console.error('  These are invented products at invented prices.');
    console.error('  Enter the real catalogue through the app instead.');
    console.error('');
    exit(1);
  }

  DB.open(DB_FILE);
  const d = DB.get();

  if (has('remove')) return remove(d);

  /* ---- guard against a live database ------------------------------------ */
  const real = d.prepare('SELECT COUNT(*) AS n FROM products WHERE demo = 0 AND hidden = 0').get().n;
  if (real && !has('force')) {
    console.error('');
    console.error(`  REFUSING: this database already has ${real} real product(s).`);
    console.error('');
    console.error('  It looks like a catalogue somebody entered, not a scratch one.');
    console.error('  Mixing invented prices into it is how a demo figure ends up on');
    console.error('  a customer receipt.');
    console.error('');
    console.error('  If you are sure:  npm run demo-catalogue -- --force');
    console.error('');
    DB.close();
    exit(1);
  }

  const already = d.prepare('SELECT COUNT(*) AS n FROM products WHERE demo = 1').get().n;
  if (already) {
    console.error('');
    console.error(`  There are already ${already} demo product(s) here.`);
    console.error('  Take them out first:  npm run demo-catalogue -- --remove');
    console.error('');
    DB.close();
    exit(1);
  }

  /* ---- the goods --------------------------------------------------------- */
  console.log('');
  console.log('  Filling the catalogue…');
  console.log('');

  let skus = 0, pieces = 0;

  PRODUCTS.forEach((p, i) => {
    const [name, type, brand, madeIn, bg, colorway, cost, price, zone] = p;
    const gap = SIZE_GAP[i] || [];

    const sizes = SIZE_SETS[type].map((size) => {
      const qty = openingQty(gap.includes(size), gap.length > 0);
      return { size, qty, shelf: `${zone}-${String(ri(1, 18)).padStart(2, '0')}` };
    });

    /* One call per shoe, all its sizes together, in one transaction —
       createWithVariants exists for exactly this shape of work. Barcodes are
       issued by the server, so they are unique against whatever is already
       there rather than against this script's idea of the world. Opening
       stock goes to the back, because that is where a delivery arrives. */
    const made = Cat.createWithVariants({
      name, type, brand, madeIn, colorway,
      imageBg: bg,
      currency: 'SYP',
      costPrice: cost, sellingPrice: price,
      shelfZone: zone,
      sizes, whId: 'store',
      userId: null, demo: true
    });

    /* Then carry roughly two thirds of it out to the wall.

       Not booked straight to `floor` in the call above, for two reasons. It is
       what actually happens — goods arrive at the back door and somebody walks
       them out — so the movement log reads like the shop rather than like a
       fixture. And it leaves stock in both places, which is the whole point of
       having two: a size with nothing on the wall and eight pairs in the back
       is the case the warehouse screen exists to catch. */
    made.variants.forEach((v, idx) => {
      const total = sizes[idx].qty;
      const toFloor = Math.floor(total * 0.65);
      if (toFloor > 0) {
        Stock.transfer({
          sku: v.sku, from: 'store', to: 'floor', qty: toFloor,
          note: 'put out on the floor', userId: null
        });
      }
    });

    skus += sizes.length;
    pieces += sizes.reduce((a, s) => a + s.qty, 0);
    console.log(`    ${name.padEnd(28)} ${String(sizes.length).padStart(2)} sizes`);
  });

  /* ---- the people -------------------------------------------------------- */
  CUSTOMERS.forEach((name) => {
    Customers.create({
      name,
      phone: `+963 9${String(ri(30, 99)).padStart(2, '0')} ` +
             `${String(ri(0, 999)).padStart(3, '0')} ` +
             `${String(ri(0, 999)).padStart(3, '0')}`,
      city: CITIES[ri(0, CITIES.length - 1)],
      source: rnd() < 0.42 ? 'online' : 'in-store'
    }, null, { demo: true });
  });

  /* ---- the leftover test row --------------------------------------------- */
  /* Hidden, not deleted: five sales point at it, and deleting a product that
     invoices reference is how a shop loses the ability to answer questions
     about its own history. */
  const test = d.prepare(
    "SELECT id, name FROM products WHERE demo = 0 AND name = 'Test Shoe'"
  ).get();
  if (test) {
    d.prepare('UPDATE products SET hidden = 1, updated_at = ? WHERE id = ?')
     .run(new Date().toISOString(), test.id);
    console.log('');
    console.log(`    hid "${test.name}" (id ${test.id}) — its sales still reference it`);
  }

  const line = '  ' + '─'.repeat(74);
  console.log('');
  console.log(line);
  console.log(`   DEMO CATALOGUE   ${PRODUCTS.length} products · ${skus} sizes · ` +
              `${pieces} pieces · ${CUSTOMERS.length} customers`);
  console.log(line);
  console.log('');
  console.log('   It all arrived at the back door; about two thirds has been carried');
  console.log('   out to the wall, so both places hold stock and the till can sell.');
  console.log('');
  console.log('   These are invented goods at invented prices.');
  console.log('   TAKE THEM OUT BEFORE THE SHOP USES THIS FOR REAL:');
  console.log('     npm run demo-catalogue -- --remove');
  console.log('');

  DB.close();
}

/* ----------------------------------------------------------------- removal */

function remove(d) {
  /* Refuse rather than orphan. A demo product that has been sold is no longer
     only demo data — an invoice references it, and deleting it would leave
     that sale pointing at nothing. Hiding is the honest answer, and it is what
     the app does everywhere else. */
  const sold = d.prepare(
    `SELECT DISTINCT p.id, p.name
       FROM products p
       JOIN sale_items i ON i.product_id = p.id
      WHERE p.demo = 1`
  ).all();

  const bought = d.prepare(
    `SELECT DISTINCT c.id, c.name
       FROM customers c
       JOIN sales s ON s.customer_id = c.id
      WHERE c.demo = 1`
  ).all();

  let products = 0, customers = 0, hidden = 0, archived = 0;

  DB.tx((t) => {
    const keepP = new Set(sold.map(r => r.id));
    const keepC = new Set(bought.map(r => r.id));

    for (const r of t.prepare('SELECT id FROM products WHERE demo = 1').all()) {
      if (keepP.has(r.id)) {
        t.prepare('UPDATE products SET hidden = 1 WHERE id = ?').run(r.id);
        hidden++;
      } else {
        /* variants CASCADE from products; stock and stock_movements reference
           variants. Movements are cleared explicitly — they have no cascade,
           by design, because a movement log that can be deleted by a foreign
           key is not a log. */
        t.prepare(
          `DELETE FROM stock_movements
            WHERE sku IN (SELECT sku FROM variants WHERE product_id = ?)`
        ).run(r.id);
        t.prepare(
          `DELETE FROM stock
            WHERE sku IN (SELECT sku FROM variants WHERE product_id = ?)`
        ).run(r.id);
        t.prepare('DELETE FROM products WHERE id = ?').run(r.id);
        products++;
      }
    }

    for (const r of t.prepare('SELECT id FROM customers WHERE demo = 1').all()) {
      if (keepC.has(r.id)) {
        t.prepare('UPDATE customers SET archived = 1 WHERE id = ?').run(r.id);
        archived++;
      } else {
        t.prepare('DELETE FROM customers WHERE id = ?').run(r.id);
        customers++;
      }
    }
  });

  console.log('');
  console.log(`  Removed ${products} demo product(s) and ${customers} demo customer(s).`);
  if (hidden) {
    console.log(`  Kept ${hidden} that have been sold — hidden instead, so the`);
    console.log('  invoices that reference them still make sense:');
    for (const r of sold) console.log(`    ${r.name}`);
  }
  if (archived) {
    console.log(`  Kept ${archived} customer(s) with sales — archived instead.`);
  }

  const left = d.prepare('SELECT COUNT(*) AS n FROM products WHERE hidden = 0').get().n;
  console.log('');
  console.log(`  ${left} product(s) visible in the catalogue now.`);
  if (left === 0) {
    console.log('  The till has nothing to sell until the real stock is entered.');
  }
  console.log('');

  DB.close();
}

main().catch((err) => {
  console.error('\n  Failed:', err.message, '\n');
  exit(1);
});
