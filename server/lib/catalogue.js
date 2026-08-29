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

/* "12.50" USD -> 1250. "45000" SYP -> 45000.
   Parsed from a string rather than a float so 0.1 + 0.2 never enters the
   picture; the whole point of minor units is to keep money in integers. */
export function toMinor(amount, code) {
  const exp = minorExp(code);
  const s = String(amount).trim();

  if (!/^-?\d*\.?\d*$/.test(s) || s === '' || s === '.') {
    throw new Error(`"${amount}" is not a number`);
  }

  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');

  if (frac.length > exp) {
    throw new Error(
      `${code} has ${exp} decimal place(s); "${amount}" has ${frac.length}`
    );
  }

  const padded = frac.padEnd(exp, '0');
  const n = Number((whole || '0') + padded);
  if (!Number.isSafeInteger(n)) throw new Error(`${amount} is too large`);
  return neg ? -n : n;
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

/* Convert between currencies at a given rate. Rounds to the target's minor
   units — the caller must pass the rate explicitly rather than have one looked
   up, so a sale can be settled at the rate frozen onto it. */
export function convert(minor, from, to, rate) {
  if (from === to) return minor;

  const fromExp = minorExp(from);
  const toExp = minorExp(to);

  /* Work in major units for the multiply, then back to minor units of the
     target. Doing it any other way needs the exponent difference folded into
     the rate, which is where these conversions usually go wrong. */
  const major = minor / 10 ** fromExp;
  const converted = from === 'USD' ? major * rate : major / rate;
  return Math.round(converted * 10 ** toExp);
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

  const variants = get().prepare(
    `SELECT v.*, COALESCE(
              (SELECT SUM(qty) FROM stock s WHERE s.sku = v.sku), 0) AS total
       FROM variants v ORDER BY v.product_id, v.size`
  ).all();

  const stock = get().prepare('SELECT sku, wh_id, qty FROM stock').all();
  const byWh = {};
  for (const s of stock) (byWh[s.sku] ??= {})[s.wh_id] = s.qty;

  const bySize = {};
  for (const v of variants) {
    (bySize[v.product_id] ??= []).push({ ...v, wh: byWh[v.sku] ?? {} });
  }

  return rows.map(p => ({ ...p, variants: bySize[p.id] ?? [] }));
}

export function byId(id) {
  const p = get().prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return null;
  const variants = get().prepare(
    'SELECT * FROM variants WHERE product_id = ? ORDER BY size'
  ).all(id);
  return { ...p, variants };
}

export function bySku(sku) {
  return get().prepare(
    `SELECT v.*, p.name, p.type, p.brand, p.currency, p.cost_price, p.selling_price
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.sku = ?`
  ).get(sku) ?? null;
}

/* The lookup a scan performs. Barcode first because that is what a scanner
   sends; sku second so a human can type the code printed on the label. */
export function byBarcode(code) {
  const v = get().prepare(
    `SELECT v.*, p.name, p.type, p.brand, p.colorway, p.currency,
            p.cost_price, p.selling_price, p.image_bg, p.image_initials
       FROM variants v JOIN products p ON p.id = v.product_id
      WHERE v.barcode = ? OR v.sku = ? OR v.label_code = ?`
  ).get(code, code, code);
  return v ?? null;
}

/* Attach a scanned code to an existing variant — either a fresh barcode (the
   box actually carries one and it was never recorded) or a corrected
   label_code. Never touches sku. Refuses a code already claimed by a
   DIFFERENT variant so two products can't end up sharing an identity. */
export function attachCode(sku, { barcode, labelCode }, userId) {
  return tx((d) => {
    const v = d.prepare('SELECT sku FROM variants WHERE sku = ?').get(sku);
    if (!v) throw new Error('no such variant');

    if (barcode) {
      const clash = d.prepare('SELECT sku FROM variants WHERE barcode = ? AND sku != ?').get(barcode, sku);
      if (clash) throw new Error(`that barcode already belongs to ${clash.sku}`);
    }
    if (labelCode) {
      if (!/^\d{1,8}$/.test(labelCode)) throw new Error('label_code must be numeric, 8 digits or fewer');
      const clash = d.prepare('SELECT sku FROM variants WHERE label_code = ? AND sku != ?').get(labelCode, sku);
      if (clash) throw new Error(`that code already belongs to ${clash.sku}`);
    }
    if (!barcode && !labelCode) throw new Error('nothing to attach');

    const at = nowIso();
    if (barcode) d.prepare('UPDATE variants SET barcode = ?, updated_at = ? WHERE sku = ?').run(barcode, at, sku);
    if (labelCode) d.prepare('UPDATE variants SET label_code = ?, updated_at = ? WHERE sku = ?').run(labelCode, at, sku);
    logChange('variants', sku, 'update', userId, null);
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
  sizes = [], whId = 'store', userId,
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
  if (!currency) throw new Error('currency is required');
  minorExp(currency);                       // throws if the currency is unknown

  if (!Array.isArray(sizes) || sizes.length === 0) {
    throw new Error('a product needs at least one size');
  }

  const seen = new Set();
  for (const s of sizes) {
    const key = String(s.size).trim();
    if (!key) throw new Error('every size needs a label');
    if (seen.has(key)) throw new Error(`size "${key}" is listed twice`);
    seen.add(key);
  }

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

    const made = [];
    for (const s of sizes) {
      const size = String(s.size).trim();
      const sku = `OG-${String(productId).padStart(3, '0')}-${size}`;
      const barcode = s.barcode || nextBarcode(d, productId);
      const labelCode = nextLabelCode(d);

      d.prepare(
        `INSERT INTO variants (sku, product_id, size, color, barcode, label_code, shelf,
                               created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(sku, productId, size, colorway ?? null, barcode, labelCode, s.shelf ?? null, at, at);

      logChange('variants', sku, 'insert', userId, null);
      made.push({ sku, size, barcode });

      /* Opening stock goes in as a movement, not a starting number, so the
         trail is complete from the very first pair. Imported inline rather
         than at the top to keep the module cycle-free. */
      const qty = Number(s.qty ?? 0);
      if (qty > 0) {
        d.prepare('INSERT INTO stock (sku, wh_id, qty) VALUES (?, ?, 0) ON CONFLICT DO NOTHING')
         .run(sku, whId);
        d.prepare('UPDATE stock SET qty = qty + ? WHERE sku = ? AND wh_id = ?')
         .run(qty, sku, whId);
        d.prepare(
          `INSERT INTO stock_movements
             (at, sku, wh_id, type, delta, balance, note, user_id, ref_type)
           VALUES (?, ?, ?, 'received', ?, ?, 'opening stock', ?, 'opening')`
        ).run(at, sku, whId, qty, qty, userId ?? null);
        logChange('stock', `${sku}:${whId}`, 'update', userId, null);
      }
    }

    return { productId, variants: made };
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
  'currency', 'cost_price', 'selling_price', 'shelf_zone', 'hidden'
]);

export function update(id, fields, userId) {
  const sets = [];
  const args = [];

  for (const [k, v] of Object.entries(fields)) {
    if (!EDITABLE.has(k)) continue;      // ignore unknown keys rather than fail
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
export function addVariant({ productId, size, barcode, shelf, userId }) {
  return tx((d) => {
    const p = d.prepare('SELECT id, colorway FROM products WHERE id = ?').get(productId);
    if (!p) throw new Error('no such product');

    const label = String(size).trim();
    if (!label) throw new Error('size is required');

    const sku = `OG-${String(productId).padStart(3, '0')}-${label}`;
    if (d.prepare('SELECT 1 FROM variants WHERE sku = ?').get(sku)) {
      throw new Error(`size "${label}" already exists for this product`);
    }

    const at = nowIso();
    d.prepare(
      `INSERT INTO variants (sku, product_id, size, color, barcode, label_code, shelf,
                             created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sku, productId, label, p.colorway ?? null,
          barcode || nextBarcode(d, productId), nextLabelCode(d), shelf ?? null, at, at);

    logChange('variants', sku, 'insert', userId, null);
    return { sku, size: label };
  });
}

/* Products are hidden, never deleted. A deleted product breaks every past sale
   that referenced it, and "discontinued" is what is actually meant. */
export function hide(id, userId) {
  return update(id, { hidden: 1 }, userId);
}
