/* ==========================================================================
   OG SYSTEM — a colour's photographs                         (migration 066)
   --------------------------------------------------------------------------
   Every colour of every product carries its own photographs: FIRST somebody
   wearing it (`model`), SECOND the product on its own (`product`), and then
   as many more as the shop likes, up to a cap (`extra`). The owner's rule:
   a colour reaches the website only once it has both of the first two.
   Nothing here stops a sale — the till, the labels and the counts do not
   care whether anybody has photographed a shoe.

   A photo is two files in the public bucket (lib/storage.js): the large one
   for a product page and a small one for a till. This module never touches
   the bucket. The route uploads first and hands the addresses in; what this
   returns as `previous` is what the route may then delete.

   THE TWO OLD COLUMNS ARE DERIVED HERE AND NOWHERE ELSE. products.image_url
   and product_colours.image_url are what every screen in the shop draws, so
   `cover()` rewrites them inside the same transaction as every change —
   the small file of the product photo, else the model photo, else the first
   extra. A column somebody could also write by hand would be a second copy
   of the same fact, and the second copy is always the one that drifts.

   Every write is logChange'd: product_photos is cursor shape in the mirror,
   and a row that skips the log never leaves this machine.
   ========================================================================== */

import { get, tx, logChange, nowIso } from './db.js';

export const KINDS = ['model', 'product', 'extra'];
/* The two a colour needs before the website may show it, in the order the
   website shows them. */
export const REQUIRED = ['model', 'product'];
/* Extras per colour. A product page past a dozen pictures is scrolling, not
   selling, and every one of them is a file somebody has to take down again. */
export const MAX_EXTRA = 8;

function fail(message, code, status = 400) {
  const e = new Error(message); e.code = code; e.status = status; return e;
}

function has() {
  try { get().prepare('SELECT 1 FROM product_photos LIMIT 1').all(); return true; }
  catch { return false; }   /* before 066 */
}

function shape(r) {
  return {
    id: r.id, productId: r.product_id, colourId: r.colour_id, kind: r.kind,
    url: r.url, thumbUrl: r.thumb_url || r.url,
    width: r.width ?? null, height: r.height ?? null, sort: r.sort
  };
}

/* Model, then product, then the extras in their order. Every reader goes
   through this, so "first image is the model" is true in one place. */
export function ordered(list) {
  const rank = (k) => (k === 'model' ? 0 : k === 'product' ? 1 : 2);
  return list.slice().sort((a, b) => rank(a.kind) - rank(b.kind) || a.sort - b.sort || a.id - b.id);
}

/* Every photo, grouped by product, for the catalogue bundle. */
export function byProduct() {
  if (!has()) return {};
  const rows = get().prepare('SELECT * FROM product_photos ORDER BY product_id, colour_id, sort, id').all();
  const by = {};
  for (const r of rows) (by[r.product_id] ??= []).push(shape(r));
  for (const k of Object.keys(by)) by[k] = ordered(by[k]);
  return by;
}

export function ofProduct(productId) {
  if (!has()) return [];
  return ordered(get().prepare('SELECT * FROM product_photos WHERE product_id = ?').all(productId).map(shape));
}

export function byId(id) {
  if (!has()) return null;
  const r = get().prepare('SELECT * FROM product_photos WHERE id = ?').get(id);
  return r ? shape(r) : null;
}

/* Is this colour allowed on the website — does it hold both required photos. */
export function isReady(list, colourId) {
  const mine = list.filter((p) => p.colourId === colourId);
  return REQUIRED.every((k) => mine.some((p) => p.kind === k));
}

/* The colours of a product, each with what it is missing. Used by the
   website's filter and by anything that has to say why a colour is not there. */
export function readiness(productId, colourIds) {
  const list = ofProduct(productId);
  return colourIds.map((cid) => {
    const mine = list.filter((p) => p.colourId === cid);
    const missing = REQUIRED.filter((k) => !mine.some((p) => p.kind === k));
    return { colourId: cid, ready: !missing.length, missing, count: mine.length };
  });
}

/* ------------------------------------------------------------- the checks */

/* Asked BEFORE the route uploads anything, so a refusal does not leave two
   orphan files in a public bucket. The same checks run again inside the
   transaction that writes the row — the answer can change in between. */
export function assertCanAdd({ productId, colourId, kind }) {
  if (!has()) throw fail('This database has not got the photos table yet — restart the shop.', 'not_ready', 503);
  checkAdd(get(), { productId, colourId, kind });
}

function checkAdd(d, { productId, colourId, kind }) {
  if (!KINDS.includes(kind)) throw fail('A photo is the model, the product, or an extra.', 'bad_kind');
  const p = d.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!p) throw fail('No such product.', 'not_found', 404);
  const c = d.prepare('SELECT id FROM product_colours WHERE id = ? AND product_id = ?').get(colourId, productId);
  if (!c) throw fail('That colour is not one of this product’s.', 'bad_colour');
  if (kind === 'extra') {
    const n = d.prepare(`SELECT COUNT(*) AS n FROM product_photos WHERE colour_id = ? AND kind = 'extra'`).get(colourId).n;
    if (n >= MAX_EXTRA) throw fail(`A colour holds at most ${MAX_EXTRA} extra photos.`, 'too_many', 409);
  }
}

/* ------------------------------------------------------------- the writes */

/* A new photo. Into `model` or `product` it REPLACES whatever held that slot
   (the row keeps its id, so the mirror sees an update rather than a delete
   and an insert); an extra goes on the end. Returns the photo and the old
   files, for the route to take down. */
export function add({ productId, colourId, kind, url, thumbUrl, width, height, userId }) {
  if (!url) throw fail('A photo needs its address.', 'bad_image');
  const w = Number.isInteger(width) && width > 0 && width < 20000 ? width : null;
  const h = Number.isInteger(height) && height > 0 && height < 20000 ? height : null;
  return tx((d) => {
    checkAdd(d, { productId, colourId, kind });
    const now = nowIso();
    let id, previous = [];
    const held = kind === 'extra' ? null
      : d.prepare('SELECT * FROM product_photos WHERE colour_id = ? AND kind = ?').get(colourId, kind);
    if (held) {
      previous = [held.url, held.thumb_url].filter(Boolean);
      d.prepare('UPDATE product_photos SET url = ?, thumb_url = ?, width = ?, height = ?, updated_at = ? WHERE id = ?')
       .run(url, thumbUrl || url, w, h, now, held.id);
      id = held.id;
      logChange('product_photos', id, 'update', userId, `${kind} photo replaced`);
    } else {
      const sort = kind === 'extra'
        ? (d.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM product_photos WHERE colour_id = ? AND kind = 'extra'`).get(colourId).s)
        : 0;
      id = Number(d.prepare(
        `INSERT INTO product_photos (product_id, colour_id, kind, url, thumb_url, width, height, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(productId, colourId, kind, url, thumbUrl || url, w, h, sort, now, now).lastInsertRowid);
      logChange('product_photos', id, 'insert', userId, `${kind} photo`);
    }
    cover(d, productId, userId);
    return { photo: shape(d.prepare('SELECT * FROM product_photos WHERE id = ?').get(id)), previous };
  });
}

/* Moves a photo into another slot. Into `model` or `product`: whatever held
   that slot takes this photo's old place — which is how "these two are the
   wrong way round" is one press. Into `extra`: it goes on the end, and the
   slot it left is empty (the colour is then not ready, and says so). */
export function setKind(id, kind, userId) {
  if (!KINDS.includes(kind)) throw fail('A photo is the model, the product, or an extra.', 'bad_kind');
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM product_photos WHERE id = ?').get(id);
    if (!cur) throw fail('No such photo.', 'not_found', 404);
    if (cur.kind === kind) return shape(cur);
    const now = nowIso();
    const nextExtra = () => d.prepare(
      `SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM product_photos WHERE colour_id = ? AND kind = 'extra'`
    ).get(cur.colour_id).s;
    const held = kind === 'extra' ? null
      : d.prepare('SELECT * FROM product_photos WHERE colour_id = ? AND kind = ?').get(cur.colour_id, kind);
    if (!held && kind === 'extra') {
      const n = d.prepare(`SELECT COUNT(*) AS n FROM product_photos WHERE colour_id = ? AND kind = 'extra'`).get(cur.colour_id).n;
      if (n >= MAX_EXTRA) throw fail(`A colour holds at most ${MAX_EXTRA} extra photos.`, 'too_many', 409);
    }
    if (held) {
      /* The partial unique index would refuse two in one slot for the moment
         between the two UPDATEs, so the one being displaced steps out first. */
      d.prepare(`UPDATE product_photos SET kind = 'extra', sort = -1, updated_at = ? WHERE id = ?`).run(now, held.id);
    }
    d.prepare('UPDATE product_photos SET kind = ?, sort = ?, updated_at = ? WHERE id = ?')
     .run(kind, kind === 'extra' ? nextExtra() : 0, now, cur.id);
    if (held) {
      d.prepare('UPDATE product_photos SET kind = ?, sort = ?, updated_at = ? WHERE id = ?')
       .run(cur.kind, cur.kind === 'extra' ? cur.sort : 0, now, held.id);
      logChange('product_photos', held.id, 'update', userId, `moved to ${cur.kind}`);
    }
    logChange('product_photos', cur.id, 'update', userId, `moved to ${kind}`);
    cover(d, cur.product_id, userId);
    return shape(d.prepare('SELECT * FROM product_photos WHERE id = ?').get(cur.id));
  });
}

/* An extra one place earlier (-1) or later (+1) among the extras. */
export function move(id, dir, userId) {
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM product_photos WHERE id = ?').get(id);
    if (!cur) throw fail('No such photo.', 'not_found', 404);
    if (cur.kind !== 'extra') throw fail('Only the extra photos have an order.', 'bad_kind');
    const extras = d.prepare(
      `SELECT * FROM product_photos WHERE colour_id = ? AND kind = 'extra' ORDER BY sort, id`
    ).all(cur.colour_id);
    const i = extras.findIndex((x) => x.id === cur.id);
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= extras.length) return shape(cur);
    const tmp = extras[i]; extras[i] = extras[j]; extras[j] = tmp;
    const now = nowIso();
    extras.forEach((x, k) => {
      if (x.sort === k + 1) return;
      d.prepare('UPDATE product_photos SET sort = ?, updated_at = ? WHERE id = ?').run(k + 1, now, x.id);
      logChange('product_photos', x.id, 'update', userId, 'reordered');
    });
    cover(d, cur.product_id, userId);
    return shape(d.prepare('SELECT * FROM product_photos WHERE id = ?').get(cur.id));
  });
}

export function remove(id, userId) {
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM product_photos WHERE id = ?').get(id);
    if (!cur) throw fail('No such photo.', 'not_found', 404);
    d.prepare('DELETE FROM product_photos WHERE id = ?').run(id);
    logChange('product_photos', id, 'delete', userId, `${cur.kind} photo removed`);
    cover(d, cur.product_id, userId);
    return { id, productId: cur.product_id, previous: [cur.url, cur.thumb_url].filter(Boolean) };
  });
}

/* Inside a caller's transaction (Cat.remove, the demo purge): every photo of
   these products, deleted and logged — a cascade writes no log line, and a
   row that disappears here without one lives in the mirror for ever. Returns
   the files, for the caller to take down after the commit. */
export function removeForProducts(d, productIds, userId) {
  if (!productIds.length || !has()) return [];
  const marks = productIds.map(() => '?').join(',');
  const rows = d.prepare(`SELECT * FROM product_photos WHERE product_id IN (${marks})`).all(...productIds);
  d.prepare(`DELETE FROM product_photos WHERE product_id IN (${marks})`).run(...productIds);
  for (const r of rows) logChange('product_photos', r.id, 'delete', userId, 'product deleted');
  return rows.flatMap((r) => [r.url, r.thumb_url]).filter(Boolean);
}

/* ------------------------------------------------------ the derived cover */

/* products.image_url and each product_colours.image_url, from the photos.
   The SMALL file: those columns are drawn on a till, in a 36 px thumbnail and
   in the shelf map's box atlas, and a 1600 px photo in every one of them is
   megabytes over the shop's wifi for nothing. The product photo first — at a
   till, the shoe is what identifies the shoe. Only a value that actually
   changed is written and logged. */
function cover(d, productId, userId) {
  const photos = ordered(d.prepare('SELECT * FROM product_photos WHERE product_id = ?').all(productId).map(shape));
  const pick = (list) => {
    const p = list.find((x) => x.kind === 'product') || list.find((x) => x.kind === 'model') || list[0];
    return p ? p.thumbUrl : null;
  };
  const colours = d.prepare('SELECT id, image_url FROM product_colours WHERE product_id = ? ORDER BY sort, id').all(productId);
  const now = nowIso();
  let first = null;
  for (const c of colours) {
    const want = pick(photos.filter((p) => p.colourId === c.id));
    if (first === null && want) first = want;
    if ((c.image_url || null) !== want) {
      d.prepare('UPDATE product_colours SET image_url = ?, updated_at = ? WHERE id = ?').run(want, now, c.id);
      logChange('product_colours', c.id, 'update', userId, 'cover photo');
    }
  }
  const p = d.prepare('SELECT image_url FROM products WHERE id = ?').get(productId);
  if (p && (p.image_url || null) !== first) {
    d.prepare('UPDATE products SET image_url = ?, updated_at = ? WHERE id = ?').run(first, now, productId);
    logChange('products', productId, 'update', userId, first ? 'picture' : 'picture removed');
  }
}
