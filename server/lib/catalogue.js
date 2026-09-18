/* ==========================================================================
   OG SYSTEM — products, sizes, barcodes
   --------------------------------------------------------------------------
   The catalogue is entered once, by hand, from paper. That fact shapes this
   module more than anything else: `createWithVariants` takes a product and all
   its sizes in one call, because somebody standing at a counter typing in four
   hundred pairs should press save once per shoe, not once per size.

   Barcodes are generated here rather than in the browser. Two people entering
   stock on two phones would otherwise pick the same "next" number, and the
   collision surfaces days later at the till when the wrong shoe scans.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import * as Categories from './categories.js';
import * as Stock from './stock.js';
import { foldName } from './text.js';

/* Currency codes come from the database, so adding one is a migration rather
   than an edit here. */
export function currencies() {
  return get().prepare('SELECT * FROM currencies ORDER BY code').all();
}

/* ------------------------------------------------------------------- money
   Amounts are integers in minor units. `minor_exp` says how many decimal
   places the currency uses: USD 2 (cents), SYP 0 (whole lira). */
export function minorExp(code) {
  const r = get().prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(code);
  if (!r) throw new Error(`unknown currency: ${code}`);
  return r.minor_exp;
}

export function fromMinor(minor, code) {
  const exp = minorExp(code);
  if (exp === 0) return String(minor);
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(exp + 1, '0');
  const out = `${s.slice(0, -exp)}.${s.slice(-exp)}`;
  return neg ? '-' + out : out;
}

/* ---------------------------------------------------------------- exchange
   The rate that applied at a given moment, for reporting an old sale at the
   rate it was actually made at. */
export function rateAt(base, quote, at) {
  const r = get().prepare(
    `SELECT rate FROM fx_rates
      WHERE base = ? AND quote = ? AND set_at <= ?
      ORDER BY set_at DESC LIMIT 1`
  ).get(base, quote, at ?? nowIso());
  if (!r) throw new Error(`no ${base}/${quote} rate on record at ${at}`);
  return r.rate;
}

export function currentRate(base = 'USD', quote = 'SYP') {
  return rateAt(base, quote, nowIso());
}

export function setRate({ base, quote, rate, userId }) {
  if (!(rate > 0)) throw new Error('rate must be greater than zero');
  return tx((d) => {
    const at = nowIso();
    const info = d.prepare(
      'INSERT INTO fx_rates (base, quote, rate, set_at, set_by) VALUES (?, ?, ?, ?, ?)'
    ).run(base, quote, rate, at, userId ?? null);
    logChange('fx_rates', info.lastInsertRowid, 'insert', userId, null);
    return { base, quote, rate, at };
  });
}

/* ---------------------------------------------------------------- barcodes
   EAN-13: 12 digits plus a mod-10 check digit. Mirrors Codes.ean13Check in
   js/codes.js — the browser must be able to validate what the server issued,
   and the 858 frontend tests already cover that implementation. */
export function ean13Check(body12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/* Issue a barcode nobody else holds.

   621 is the real GS1 prefix for Syria. Using it on codes that are not
   registered with GS1 is fine inside one shop and would NOT be fine on goods
   sold through anyone else's till — worth knowing before these ever leave the
   building.

   The uniqueness check and the insert must happen in the same transaction as
   the variant, or two phones can be handed the same number. */
export function nextBarcode(d, productId) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const serial = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    const body = '621' + String(productId % 1000).padStart(3, '0') + serial;
    const code = body + ean13Check(body);

    const clash = d.prepare('SELECT 1 FROM variants WHERE barcode = ?').get(code);
    if (!clash) return code;
  }
  throw new Error('could not find a free barcode after 50 tries');
}

/* label_code: numeric-only, <=8 digits, for the thermal label printer's
   Code128 subset C — two digits per symbol, half the width of alphanumeric,
   which matters on a 30mm label. sku stays alphanumeric and unchanged; this
   is a separate identifier, generated once, stable forever — a label
   printed with it must still scan correctly next year.

   A plain counter, not a random-retry scheme like nextBarcode: there's no
   format to collide on here, so the uniqueness is structural. Must run
   inside the same transaction as the variant insert, same reasoning as
   nextBarcode — two variants created at once must not be handed the same
   value. */
export function nextLabelCode(d) {
  const row = d.prepare('SELECT next_value FROM label_code_seq WHERE id = 1').get();
  if (!row) throw new Error('label_code_seq is missing its row — did migration 010 run?');

  /* The counter lives in its own table, so anything that writes variant rows
     WITHOUT coming through here leaves it behind the data — a restore from
     the Supabase mirror, an import, a hand-repair. The next product created
     afterwards is then handed a code that already exists, and the insert dies
     on "UNIQUE constraint failed: variants.label_code" while pointing at the
     new product rather than at the counter that is actually wrong.

     So the counter is a floor, not the whole answer: whichever is higher, it
     or the largest code actually in use, wins. Existing labels keep the codes
     they were printed with; only the next one moves. */
  const used = d.prepare(
    'SELECT MAX(CAST(label_code AS INTEGER)) AS m FROM variants WHERE label_code IS NOT NULL'
  ).get().m;

  const next = (used !== null && used >= row.next_value) ? used + 1 : row.next_value;

  if (next > 99999999) {
    throw new Error('label_code counter exhausted (8-digit cap reached)');
  }
  d.prepare('UPDATE label_code_seq SET next_value = ? WHERE id = 1').run(next + 1);
  return String(next);
}

/* ---------------------------------------------------------------- products */

export function list({ includeHidden = false } = {}) {
  /* last_sold_at rides along because the dashboard's dead-stock alert needs
     it for every product at once. Computing it in the browser would mean
     shipping the entire sales history to answer one question about each
     shoe. Voided sales are excluded — a sale that was reversed is not
     evidence that anybody wanted the thing. */
  const rows = get().prepare(
    `SELECT p.*,
            (SELECT MAX(s.at)
               FROM sale_items i JOIN sales s ON s.id = i.sale_id
              WHERE i.product_id = p.id AND s.voided = 0) AS last_sold_at
       FROM products p
      ${includeHidden ? '' : 'WHERE p.hidden = 0'}
      ORDER BY p.name`
  ).all();

  /* THE SHELF COLUMN ON `variants` LIES, so it is answered from where the
     stock actually IS (ns03). `variants.shelf` is written once, at insert,
     and the real assignment is `stock.shelf_id` — which never touches it —
     so on a live shop the column is blank or stale while the product drawer,
     the count sheet and the scan sheet all print it as the answer to "where
     is this size". `shelf_at` is the place it is really on, most held
     first; the old column is still sent, untouched, so nothing that reads it
     breaks. No schema change and no row is written. */
  const variants = get().prepare(
    `SELECT v.*, COALESCE(
              (SELECT SUM(qty) FROM stock s WHERE s.sku = v.sku), 0) AS total,
            (SELECT se.key || '-' || sh.code
               FROM stock s2
               JOIN shelves sh ON sh.id = s2.shelf_id
               JOIN sections se ON se.id = sh.section_id
              WHERE s2.sku = v.sku AND s2.shelf_id IS NOT NULL AND s2.qty > 0
              ORDER BY s2.qty DESC LIMIT 1) AS shelf_at
       FROM variants v ORDER BY v.product_id, v.size`
  ).all();

  const colours = coloursOf(null);

  const stock = get().prepare('SELECT sku, wh_id, qty FROM stock').all();
  const byWh = {};
  for (const s of stock) (byWh[s.sku] ??= {})[s.wh_id] = s.qty;

  const bySize = {};
  for (const v of variants) {
    (bySize[v.product_id] ??= []).push({ ...v, wh: byWh[v.sku] ?? {} });
  }

  return rows.map(p => ({ ...p, colours: colours[p.id] ?? [], variants: bySize[p.id] ?? [] }));
}

/* ---- colours (058) -------------------------------------------------------
   Every product has at least one. The first one's SKUs are the old
   OG-050-42; a later colour's are OG-050-C2-42. The printed codes — barcode
   and label code — are SHARED by every colour of one product and size: the
   box says "Puma Suede 42", and the colour is chosen at the till. */
export function coloursOf(productId) {
  let rows;
  try {
    rows = productId == null
      ? get().prepare('SELECT * FROM product_colours ORDER BY product_id, sort, id').all()
      : get().prepare('SELECT * FROM product_colours WHERE product_id = ? ORDER BY sort, id').all(productId);
  } catch { return productId == null ? {} : []; }   /* before 058 */
  const shape = (c) => ({ id: c.id, productId: c.product_id, nameEn: c.name_en, nameAr: c.name_ar,
                          hex: c.hex, imageUrl: c.image_url, sort: c.sort });
  if (productId != null) return rows.map(shape);
  const by = {};
  for (const c of rows) (by[c.product_id] ??= []).push(shape(c));
  return by;
}

function fail(message, code, status = 400) {
  const e = new Error(message); e.code = code; e.status = status; return e;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/* A colour as typed: both names (either may stand in for the other), an
   optional swatch. Returns the cleaned pair. */
function cleanColour(c, i) {
  let en = String(c?.nameEn ?? '').trim().replace(/\s+/g, ' ');
  let ar = String(c?.nameAr ?? '').trim().replace(/\s+/g, ' ');
  if (!en && !ar) throw fail(`colour ${i + 1} needs a name`, 'colour_name_required');
  if (!en) en = ar;
  if (!ar) ar = en;
  if (en.length > 40 || ar.length > 40) throw fail('a colour name is at most 40 characters', 'name_too_long');
  const hex = c?.hex ? String(c.hex).trim() : null;
  if (hex && !HEX.test(hex)) throw fail(`"${hex}" is not a colour`, 'bad_hex');
  return { nameEn: en, nameAr: ar, hex: hex ? hex.toUpperCase() : null };
}

function assertColourUnique(list) {
  const seen = new Set();
  for (const c of list) {
    for (const k of [foldName(c.nameEn), 'ar:' + foldName(c.nameAr)]) {
      if (seen.has(k)) throw fail(`the colour "${c.nameEn}" is listed twice`, 'colour_dup', 409);
      seen.add(k);
    }
  }
}

function skuFor(productId, colourNo, size) {
  const p = String(productId).padStart(3, '0');
  return colourNo <= 1 ? `OG-${p}-${size}` : `OG-${p}-C${colourNo}-${size}`;
}

/* The printed codes a size already has on another colour, or new ones. */
function codesFor(d, productId, size) {
  const have = d.prepare(
    `SELECT barcode, label_code FROM variants
      WHERE product_id = ? AND size = ? ORDER BY created_at, sku LIMIT 1`
  ).get(productId, size);
  if (have) return { barcode: have.barcode, labelCode: have.label_code };
  return { barcode: nextBarcode(d, productId), labelCode: nextLabelCode(d) };
}

/* One colour × size, with its opening stock booked as a movement. Runs inside
   the caller's transaction. */
function insertVariant(d, { productId, colour, colourNo, size, qty, whId, userId, at, shelf = null }) {
  const sku = skuFor(productId, colourNo, size);
  if (d.prepare('SELECT 1 FROM variants WHERE sku = ?').get(sku) ||
      d.prepare('SELECT 1 FROM variants WHERE product_id = ? AND colour_id = ? AND size = ?').get(productId, colour.id, size)) {
    throw fail(`${colour.nameEn} ${size} already exists for this product`, 'size_exists', 409);
  }
  const codes = codesFor(d, productId, size);
  d.prepare(
    `INSERT INTO variants (sku, product_id, colour_id, size, color, barcode, label_code, shelf,
                           created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sku, productId, colour.id, size, colour.nameEn, codes.barcode, codes.labelCode, shelf, at, at);
  logChange('variants', sku, 'insert', userId, null);
  const n = Number(qty ?? 0);
  if (!Number.isInteger(n) || n < 0) throw fail(`${size}: the quantity must be a whole number, not below zero`, 'bad_qty');
  if (n > 0) {
    Stock.apply(d, { sku, whId, delta: n, type: 'received', note: 'opening stock',
                     userId: userId ?? null, refType: 'opening' });
  }
  return { sku, size, barcode: codes.barcode, labelCode: codes.labelCode, colourId: colour.id, qty: n };
}

function insertColour(d, productId, c, sort, userId, at) {
  const info = d.prepare(
    `INSERT INTO product_colours (product_id, name_en, name_ar, hex, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(productId, c.nameEn, c.nameAr, c.hex, sort, at, at);
  const id = Number(info.lastInsertRowid);
  logChange('product_colours', id, 'insert', userId, null);
  return { id, ...c };
}

/* A new colour on a product that exists, with the sizes it comes in. */
export function addColour({ productId, nameEn, nameAr, hex, sizes = [], whId = 'store', userId }) {
  const c = cleanColour({ nameEn, nameAr, hex }, 0);
  return tx((d) => {
    if (!d.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw fail('no such product', 'not_found', 404);
    const existing = coloursOf(productId);
    assertColourUnique([...existing, c]);
    const at = nowIso();
    const colour = insertColour(d, productId, c, existing.length, userId, at);
    const colourNo = existing.length + 1;
    const made = [];
    const seen = new Set();
    for (const s of sizes) {
      const size = String(s.size ?? '').trim();
      if (!size) throw fail('every size needs a label', 'bad_size');
      if (seen.has(size)) throw fail(`size "${size}" is listed twice`, 'size_dup');
      seen.add(size);
      made.push(insertVariant(d, { productId, colour, colourNo, size, qty: s.qty, whId, userId, at }));
    }
    d.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(at, productId);
    logChange('products', productId, 'update', userId, null);
    return { colour, variants: made };
  });
}

export function updateColour(id, { nameEn, nameAr, hex }, userId) {
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM product_colours WHERE id = ?').get(id);
    if (!cur) throw fail('no such colour', 'not_found', 404);
    const c = cleanColour({ nameEn: nameEn ?? cur.name_en, nameAr: nameAr ?? cur.name_ar,
                            hex: hex === undefined ? cur.hex : hex }, 0);
    const others = coloursOf(cur.product_id).filter((x) => x.id !== cur.id);
    assertColourUnique([...others, c]);
    d.prepare('UPDATE product_colours SET name_en = ?, name_ar = ?, hex = ?, updated_at = ? WHERE id = ?')
     .run(c.nameEn, c.nameAr, c.hex, nowIso(), id);
    logChange('product_colours', id, 'update', userId, null);
    return coloursOf(cur.product_id).find((x) => x.id === id);
  });
}

export function setColourImage(id, url, userId) {
  return tx((d) => {
    const row = d.prepare('SELECT image_url FROM product_colours WHERE id = ?').get(id);
    if (!row) throw fail('no such colour', 'not_found', 404);
    d.prepare('UPDATE product_colours SET image_url = ?, updated_at = ? WHERE id = ?').run(url || null, nowIso(), id);
    logChange('product_colours', id, 'update', userId, null);
    return { id, previous: row.image_url || null, imageUrl: url || null };
  });
}

export function colourById(id) {
  const c = get().prepare('SELECT * FROM product_colours WHERE id = ?').get(id);
  return c ? { id: c.id, productId: c.product_id, nameEn: c.name_en, nameAr: c.name_ar, hex: c.hex, imageUrl: c.image_url } : null;
}

/* --------------------------------------------------- what the website sees

   `products.on_web` (migration 039) has been stored, mirrored and editable
   since the storefront switch was split off `hidden`, and nothing read it.
   This is what reads it.

   THE RULE IS BOTH COLUMNS: `hidden = 0 AND on_web = 1`. Archived means the
   shop has stopped selling the line, and an archived product is off the site
   whatever its own flag says — otherwise turning a line off in the shop would
   leave it advertised. `demo = 0` as well: those are invented goods at
   invented prices, hidden rather than deleted because sales reference them,
   and a public page is the last place they should surface.

   WHAT IS DELIBERATELY NOT HERE
   -----------------------------
   - cost_price, and anything derived from it. This answer is rendered on a
     public page; margin is nobody's business but the shop's. The columns are
     named explicitly rather than SELECT *, so a cost column added later
     cannot arrive here by itself.
   - stock QUANTITIES. A size is in stock or it is not — that is all a size
     button needs to know. "Only 2 left" is a decision about pressuring
     customers, and it hands a competitor the shop's turnover if it is ever
     wanted, it can be added deliberately.
   - shelf_zone, barcode, label_code, hidden, on_web. Internal, and of no use
     to a page.

   There is no `since` parameter on purpose. An incremental feed cannot say
   "this product LEFT the site" — the row simply stops being returned — so a
   site built on deltas would advertise withdrawn goods forever. A few hundred
   products is a small answer; fetch the whole list and replace. */
function webRow(p, sizes) {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand ?? null,
    type: p.type,
    /* 057 — both names, so a site in either language needs no second list */
    category: catNames(p.type),
    colorway: p.colorway ?? null,
    madeIn: p.made_in ?? null,
    /* The shop has no photographs — the app draws a colour block with the
       product's initials, and that is the whole of its artwork. Sent as-is so
       a site can draw the same placeholder rather than invent a different one. */
    image: { bg: p.image_bg ?? null, initials: p.image_initials ?? null, url: p.image_url ?? null },
    /* Minor units of `currency`, with the exponent, because SYP is whole lira
       and USD is cents and a page that divides by 100 for both is wrong half
       the time. Never converted here: the shop prices some goods in dollars,
       and today's rate is not what it was priced at. */
    price: p.selling_price,
    currency: p.currency,
    minorExp: minorExp(p.currency),
    sizes: sizes.map((v) => ({ size: v.size, sku: v.sku, colourId: v.colour_id ?? null, inStock: v.total > 0 })),
    /* 058 — each colour, its picture, and which of its sizes are in stock. */
    colours: coloursOf(p.id).map((c) => ({
      id: c.id, en: c.nameEn, ar: c.nameAr, hex: c.hex, imageUrl: c.imageUrl,
      sizes: sizes.filter((v) => v.colour_id === c.id).map((v) => ({ size: v.size, sku: v.sku, inStock: v.total > 0 }))
    })),
    inStock: sizes.some((v) => v.total > 0),
    updatedAt: p.updated_at
  };
}

function catNames(id) {
  const c = Categories.byId(id);
  return c ? { id: c.id, en: c.nameEn, ar: c.nameAr } : { id, en: id, ar: id };
}

const WEB_COLS =
  `p.id, p.name, p.brand, p.type, p.colorway, p.made_in, p.image_bg,
   p.image_initials, p.image_url, p.currency, p.selling_price, p.updated_at`;

function webSizes(productIds) {
  if (!productIds.length) return {};
  const marks = productIds.map(() => '?').join(',');
  const rows = get().prepare(
    `SELECT v.sku, v.product_id, v.size, v.colour_id,
            COALESCE((SELECT SUM(qty) FROM stock s WHERE s.sku = v.sku), 0) AS total
       FROM variants v
      WHERE v.product_id IN (${marks})
      ORDER BY v.product_id, v.size`
  ).all(...productIds);
  const by = {};
  for (const v of rows) (by[v.product_id] ??= []).push(v);
  return by;
}

export function webList() {
  const rows = get().prepare(
    `SELECT ${WEB_COLS} FROM products p
      WHERE p.hidden = 0 AND p.on_web = 1 AND p.demo = 0
      ORDER BY p.name`
  ).all();
  const sizes = webSizes(rows.map((p) => p.id));
  return rows.map((p) => webRow(p, sizes[p.id] ?? []));
}

/* Null for a product that is archived, off the site, demo or simply absent —
   the site is told "no such product" for all four, because which one it is is
   the shop's business. */
export function webById(id) {
  const p = get().prepare(
    `SELECT ${WEB_COLS} FROM products p
      WHERE p.id = ? AND p.hidden = 0 AND p.on_web = 1 AND p.demo = 0`
  ).get(id);
  if (!p) return null;
  return webRow(p, webSizes([p.id])[p.id] ?? []);
}

export function byId(id) {
  const p = get().prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return null;
  const variants = get().prepare(
    'SELECT * FROM variants WHERE product_id = ? ORDER BY colour_id, size'
  ).all(id);
  return { ...p, colours: coloursOf(id), variants };
}

export function bySku(sku) {
  return get().prepare(
    `SELECT v.*, p.name, p.type, p.brand, p.currency, p.cost_price, p.selling_price,
            c.name_en AS colour_en, c.name_ar AS colour_ar, c.hex AS colour_hex,
            (SELECT COUNT(*) FROM product_colours x WHERE x.product_id = p.id) AS colour_count
       FROM variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN product_colours c ON c.id = v.colour_id
      WHERE v.sku = ?`
  ).get(sku) ?? null;
}

/* Delete a product for good — and refuse the moment that would cost history.

   Archiving is the right gesture for a line the shop has stopped selling, and
   it stays the default (see the header of js/bulk.js). But a product typed in
   by mistake, or a test row, has nothing behind it and archiving leaves it in
   the way forever. So: delete what is genuinely empty, refuse the rest by
   name, and never make a person guess which they have.

   WHAT WOULD BE LOST, and why each is a refusal rather than a cascade:

   - `sale_items` freezes the name, the size and both prices on the line, and
     carries NO foreign key to products — so an old invoice survives this
     perfectly. What does not survive is the shop's ability to answer "what
     did we sell" by product, so a product that has ever been sold is refused.
   - `stock_movements`, `po_lines`, `stock_count_lines`, `label_print_log` and
     `wants` all REFERENCE variants(sku) with no cascade, so SQLite would
     refuse the delete itself — with a foreign-key error that names a
     constraint rather than a reason. Asked first, so the answer is a sentence.
   - `stock` and `variants` DO cascade, which is right: they are the product,
     not a record about it.

   Every row removed is logged. A delete that skips logChange is a row that
   disappears here and lives in the mirror for ever — the demo purge did
   exactly that once, with nineteen products. */
export function remove(id, userId) {
  const d = get();
  const p = d.prepare('SELECT id, name FROM products WHERE id = ?').get(id);
  if (!p) { const e = new Error(`No product with id ${id}.`); e.code = 'not_found'; throw e; }

  const skus = d.prepare('SELECT sku FROM variants WHERE product_id = ?').all(id).map((v) => v.sku);
  const inList = skus.length ? skus.map(() => '?').join(',') : "''";

  /* Asked in the order a person would care about them. */
  const holds = [
    ['sold', 'SELECT COUNT(*) AS n FROM sale_items WHERE product_id = ?', [id]],
    ['movements', `SELECT COUNT(*) AS n FROM stock_movements WHERE sku IN (${inList})`, skus],
    ['orders', `SELECT COUNT(*) AS n FROM purchase_order_lines WHERE sku IN (${inList})`, skus],
    ['counts', `SELECT COUNT(*) AS n FROM stock_count_lines WHERE sku IN (${inList})`, skus],
    ['labels', `SELECT COUNT(*) AS n FROM label_print_log WHERE sku IN (${inList})`, skus],
    ['wants', `SELECT COUNT(*) AS n FROM wants WHERE variant_sku IN (${inList})`, skus]
  ];
  for (const [why, sql, args] of holds) {
    let n = 0;
    try { n = d.prepare(sql).get(...args).n; } catch { n = 0; }   /* a table this database has not got yet */
    if (n > 0) {
      const e = new Error(`${p.name} cannot be deleted — it has ${n} ${why} on record. Archive it instead.`);
      e.code = 'has_history';
      e.detail = { why, n, name: p.name };
      throw e;
    }
  }

  return tx((db) => {
    /* Children first and logged one by one, because the mirror replays
       change_log and a cascade writes no log line of its own. */
    for (const sku of skus) {
      db.prepare('DELETE FROM stock WHERE sku = ?').run(sku);
      logChange('stock', sku, 'delete', userId, 'product deleted');
      logChange('variants', sku, 'delete', userId, 'product deleted');
    }
    db.prepare('DELETE FROM variants WHERE product_id = ?').run(id);
    for (const c of coloursOf(id)) logChange('product_colours', c.id, 'delete', userId, 'product deleted');
    try { db.prepare('DELETE FROM product_colours WHERE product_id = ?').run(id); } catch { /* before 058 */ }
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    logChange('products', id, 'delete', userId, 'deleted by hand');
    return { id, name: p.name, variants: skus.length };
  });
}

/* The picture's address, set by the upload route only - never through
   `update()`'s EDITABLE list, because a client that could write any URL into
   an <img> on every till is not a feature. NULL clears it. */
export function setImage(id, url, userId) {
  const d = get();
  const row = d.prepare('SELECT id, image_url FROM products WHERE id = ?').get(id);
  if (!row) { const e = new Error(`No product with id ${id}.`); e.code = 'not_found'; throw e; }
  tx(() => {
    d.prepare('UPDATE products SET image_url = ?, updated_at = ? WHERE id = ?').run(url, nowIso(), id);
    logChange('products', id, 'update', userId, url ? 'picture' : 'picture removed');
  });
  return { id, previous: row.image_url || null, imageUrl: url || null };
}

/* Attach a scanned code to an existing variant — either a fresh barcode (the
   box actually carries one and it was never recorded) or a corrected
   label_code. Never touches sku. Refuses a code already claimed by a
   DIFFERENT variant so two products can't end up sharing an identity. */
export function attachCode(sku, { barcode, labelCode }, userId) {
  return tx((d) => {
    const v = d.prepare('SELECT sku, product_id, size FROM variants WHERE sku = ?').get(sku);
    if (!v) throw new Error('no such variant');

    /* A code is shared by every colour of this product and size (058), and by
       nothing else. So the clash test skips the siblings, and the new code is
       written to all of them — one box, one sticker, whichever colour. */
    const notSibling = 'AND NOT (product_id = ? AND size = ?)';
    if (barcode) {
      const clash = d.prepare(`SELECT sku FROM variants WHERE barcode = ? ${notSibling}`).get(barcode, v.product_id, v.size);
      if (clash) throw new Error(`that barcode already belongs to ${clash.sku}`);
    }
    if (labelCode) {
      if (!/^\d{1,8}$/.test(labelCode)) throw new Error('label_code must be numeric, 8 digits or fewer');
      const clash = d.prepare(`SELECT sku FROM variants WHERE label_code = ? ${notSibling}`).get(labelCode, v.product_id, v.size);
      if (clash) throw new Error(`that code already belongs to ${clash.sku}`);
    }
    if (!barcode && !labelCode) throw new Error('nothing to attach');

    const at = nowIso();
    const siblings = d.prepare('SELECT sku FROM variants WHERE product_id = ? AND size = ?').all(v.product_id, v.size);
    for (const s of siblings) {
      if (barcode) d.prepare('UPDATE variants SET barcode = ?, updated_at = ? WHERE sku = ?').run(barcode, at, s.sku);
      if (labelCode) d.prepare('UPDATE variants SET label_code = ?, updated_at = ? WHERE sku = ?').run(labelCode, at, s.sku);
      logChange('variants', s.sku, 'update', userId, null);
    }
    return bySku(sku);
  });
}

/* ------------------------------------------------------------------ create
   One product and all of its sizes, in one transaction. This is the call the
   bulk-entry screen makes for each shoe.

   `sizes` is [{ size, qty, barcode? }]. A missing barcode is generated. `qty`
   is optional; when given, opening stock is booked into `whId` through a real
   movement so even day-one stock has a trail behind it. */
export function createWithVariants({
  name, type, brand, madeIn, colorway, imageBg, imageInitials,
  currency, costPrice, sellingPrice, shelfZone,
  sizes = [], colours = null, whId = 'store', userId,
  /* Nothing sets this any more — the script that planted demo rows is gone.
     The column stays because rows it marked are still in the database,
     hidden rather than deleted so the invoices naming them still read.
     Defaults to false so anything a person creates through the app is real,
     and a bug here leaves rows behind rather than marking the shop's
     catalogue for deletion. */
  demo = false
}) {
  if (!name || !String(name).trim()) throw new Error('name is required');
  if (!type) throw new Error('type is required');
  Categories.assertUsable(type);            // 057: a real, switched-on category
  if (!currency) throw new Error('currency is required');
  minorExp(currency);                       // throws if the currency is unknown

  /* 058: a list of colours, each with its own sizes. A caller that sends
     only `sizes` (an older browser, a script) gets one colour — the
     colourway if there is one — exactly as before. */
  const list = Array.isArray(colours) && colours.length
    ? colours
    : [{ nameEn: colorway || 'Standard', nameAr: colorway || 'أساسي', sizes }];
  const clean = list.map((c, i) => ({ ...cleanColour(c, i), sizes: Array.isArray(c.sizes) ? c.sizes : [] }));
  assertColourUnique(clean);

  let total = 0;
  for (const c of clean) {
    if (!c.sizes.length) throw fail(`the colour "${c.nameEn}" has no sizes`, 'colour_no_sizes');
    const seen = new Set();
    for (const s of c.sizes) {
      const key = String(s.size ?? '').trim();
      if (!key) throw new Error('every size needs a label');
      if (seen.has(key)) throw new Error(`size "${key}" is listed twice`);
      seen.add(key);
      const q = Number(s.qty ?? 0);
      if (!Number.isInteger(q) || q < 0) throw fail(`${c.nameEn} ${key}: the quantity must be a whole number, not below zero`, 'bad_qty');
      total += 1;
    }
  }
  if (!total) throw new Error('a product needs at least one size');

  return tx((d) => {
    const at = nowIso();

    const info = d.prepare(
      `INSERT INTO products
         (name, type, brand, made_in, colorway, image_bg, image_initials,
          currency, cost_price, selling_price, shelf_zone, hidden, demo,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(
      String(name).trim(), type, brand ?? null, madeIn ?? null, colorway ?? null,
      imageBg ?? null, imageInitials ?? initialsFor(name),
      currency, costPrice ?? 0, sellingPrice ?? 0, shelfZone ?? null,
      demo ? 1 : 0, at, at
    );

    const productId = Number(info.lastInsertRowid);
    logChange('products', productId, 'insert', userId, null);

    /* The product, its colours, every colour × size and one opening
       "received" movement per size with stock — one transaction. Opening
       stock is a movement (Stock.apply), never a typed-over number. */
    const made = [];
    const out = [];
    clean.forEach((c, i) => {
      const colour = insertColour(d, productId, c, i, userId, at);
      out.push(colour);
      for (const s of c.sizes) {
        made.push(insertVariant(d, {
          productId, colour, colourNo: i + 1, size: String(s.size).trim(), qty: s.qty,
          whId, userId, at, shelf: s.shelf ?? null
        }));
      }
    });

    return { productId, colours: out, variants: made };
  });
}

/* Two letters for the CSS colour block the app draws instead of a photo. */
function initialsFor(name) {
  const words = String(name).trim().split(/\s+/);
  const a = words[0]?.[0] ?? '?';
  const b = words[1]?.[0] ?? words[0]?.[1] ?? '';
  return (a + b).toUpperCase();
}

/* ------------------------------------------------------------------ update */

const EDITABLE = new Set([
  'name', 'type', 'brand', 'made_in', 'colorway', 'image_bg', 'image_initials',
  'currency', 'cost_price', 'selling_price', 'shelf_zone', 'hidden',
  /* Whether the marketing website shows it. Deliberately NOT the same key as
     `hidden`, which means archived — see migration 039. */
  'on_web'
]);

export function update(id, fields, userId) {
  const sets = [];
  const args = [];

  for (const [k, v] of Object.entries(fields)) {
    if (!EDITABLE.has(k)) continue;      // ignore unknown keys rather than fail
    if (k === 'type') {
      const cur = get().prepare('SELECT type FROM products WHERE id = ?').get(id);
      Categories.assertUsable(v, { current: cur ? cur.type : null });
    }
    if (k === 'currency') minorExp(v);   // validate before writing
    sets.push(`${k} = ?`);
    args.push(v);
  }

  if (!sets.length) throw new Error('nothing to update');

  return tx((d) => {
    args.push(nowIso(), id);
    const info = d.prepare(
      `UPDATE products SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`
    ).run(...args);

    if (info.changes === 0) throw new Error('no such product');
    logChange('products', id, 'update', userId, null);
    return byId(id);
  });
}

/* Add a size to a product that already exists. */
export function addVariant({ productId, size, colourId = null, qty = 0, whId = 'store', shelf, userId }) {
  return tx((d) => {
    const p = d.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!p) throw fail('no such product', 'not_found', 404);

    const label = String(size ?? '').trim();
    if (!label) throw fail('size is required', 'bad_size');

    const list = coloursOf(productId);
    const colour = colourId ? list.find((c) => c.id === Number(colourId)) : list[0];
    if (!colour) throw fail('no such colour on this product', 'bad_colour');
    const colourNo = list.indexOf(colour) + 1;

    const at = nowIso();
    const made = insertVariant(d, { productId, colour, colourNo, size: label, qty, whId, userId, at, shelf: shelf ?? null });
    d.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(at, productId);
    logChange('products', productId, 'update', userId, null);
    return made;
  });
}
