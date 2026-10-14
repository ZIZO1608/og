/* ==========================================================================
   OG SYSTEM — a colour's 3D angles                            (migration 073)
   --------------------------------------------------------------------------
   The photographs a 3D model is built from: the same product from the
   `front`, the `back`, the `left` and the `right`. Front and back are
   REQUIRED before a model can be asked for; left and right are optional and
   make a better one. These are not the website's gallery (lib/photos.js) —
   nothing here changes what the website shows, what the till draws, or when
   a colour is ready for the website.

   Like a gallery photo, an angle is two files in the public bucket (the
   route uploads them first and hands the addresses in) and one row here.
   A new photo into a taken angle replaces it; what comes back as `previous`
   is what the route may then delete.

   Every write is logChange'd: product_angles is cursor shape in the mirror.
   ========================================================================== */

import { get, tx, logChange, nowIso } from './db.js';

/* In the order a 3D service takes them, and the order the dialog draws. */
export const ANGLES = ['front', 'back', 'left', 'right'];
/* What a colour needs before its model can be made. */
export const REQUIRED = ['front', 'back'];

function fail(message, code, status = 400) {
  const e = new Error(message); e.code = code; e.status = status; return e;
}

function has() {
  try { get().prepare('SELECT 1 FROM product_angles LIMIT 1').all(); return true; }
  catch { return false; }   /* before 073 */
}

function shape(r) {
  return {
    id: r.id, productId: r.product_id, colourId: r.colour_id, angle: r.angle,
    url: r.url, thumbUrl: r.thumb_url || r.url,
    width: r.width ?? null, height: r.height ?? null
  };
}

const rank = (a) => ANGLES.indexOf(a);
function ordered(list) {
  return list.slice().sort((a, b) => a.colourId - b.colourId || rank(a.angle) - rank(b.angle));
}

/* Every angle, grouped by product, for the catalogue bundle. */
export function byProduct() {
  if (!has()) return {};
  const by = {};
  for (const r of get().prepare('SELECT * FROM product_angles').all()) (by[r.product_id] ??= []).push(shape(r));
  for (const k of Object.keys(by)) by[k] = ordered(by[k]);
  return by;
}

export function ofProduct(productId) {
  if (!has()) return [];
  return ordered(get().prepare('SELECT * FROM product_angles WHERE product_id = ?').all(productId).map(shape));
}

/* Can a 3D model be asked for this colour — and if not, which angles it
   still needs. */
export function readiness(productId, colourId) {
  const mine = ofProduct(productId).filter((a) => a.colourId === colourId);
  const missing = REQUIRED.filter((k) => !mine.some((a) => a.angle === k));
  return { colourId, ready: !missing.length, missing, count: mine.length };
}

/* ------------------------------------------------------------- the checks */

/* Asked BEFORE the route uploads anything, so a refusal leaves no orphan
   files in a public bucket. The same checks run again inside the write. */
export function assertCanAdd({ productId, colourId, angle }) {
  if (!has()) throw fail('This database has not got the 3D angles table yet — restart the shop.', 'not_ready', 503);
  check(get(), { productId, colourId, angle });
}

function check(d, { productId, colourId, angle }) {
  if (!ANGLES.includes(angle)) throw fail('An angle is the front, the back, the left or the right.', 'bad_kind');
  const p = d.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!p) throw fail('No such product.', 'not_found', 404);
  const c = d.prepare('SELECT id FROM product_colours WHERE id = ? AND product_id = ?').get(colourId, productId);
  if (!c) throw fail('That colour is not one of this product’s.', 'bad_colour');
}

/* ------------------------------------------------------------- the writes */

/* A photo into an angle. A taken angle is REPLACED in place (the row keeps
   its id, so the mirror sees an update). Returns the angle and the old
   files, for the route to take down. */
export function add({ productId, colourId, angle, url, thumbUrl, width, height, userId }) {
  if (!url) throw fail('A photo needs its address.', 'bad_image');
  const w = Number.isInteger(width) && width > 0 && width < 20000 ? width : null;
  const h = Number.isInteger(height) && height > 0 && height < 20000 ? height : null;
  return tx((d) => {
    check(d, { productId, colourId, angle });
    const now = nowIso();
    const held = d.prepare('SELECT * FROM product_angles WHERE colour_id = ? AND angle = ?').get(colourId, angle);
    let id, previous = [];
    if (held) {
      previous = [held.url, held.thumb_url].filter(Boolean);
      d.prepare('UPDATE product_angles SET url = ?, thumb_url = ?, width = ?, height = ?, updated_at = ? WHERE id = ?')
       .run(url, thumbUrl || url, w, h, now, held.id);
      id = held.id;
      logChange('product_angles', id, 'update', userId, `${angle} angle replaced`);
    } else {
      id = Number(d.prepare(
        `INSERT INTO product_angles (product_id, colour_id, angle, url, thumb_url, width, height, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(productId, colourId, angle, url, thumbUrl || url, w, h, now, now).lastInsertRowid);
      logChange('product_angles', id, 'insert', userId, `${angle} angle`);
    }
    return { angle: shape(d.prepare('SELECT * FROM product_angles WHERE id = ?').get(id)), previous };
  });
}

export function remove(id, userId) {
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM product_angles WHERE id = ?').get(id);
    if (!cur) throw fail('No such photo.', 'not_found', 404);
    d.prepare('DELETE FROM product_angles WHERE id = ?').run(id);
    logChange('product_angles', id, 'delete', userId, `${cur.angle} angle removed`);
    return { id, productId: cur.product_id, previous: [cur.url, cur.thumb_url].filter(Boolean) };
  });
}

/* Inside a caller's transaction (Cat.remove, the demo purge): every angle of
   these products, deleted and logged — a cascade writes no log line. Returns
   the files, for the caller to take down after the commit. */
export function removeForProducts(d, productIds, userId) {
  if (!productIds.length || !has()) return [];
  const marks = productIds.map(() => '?').join(',');
  const rows = d.prepare(`SELECT * FROM product_angles WHERE product_id IN (${marks})`).all(...productIds);
  d.prepare(`DELETE FROM product_angles WHERE product_id IN (${marks})`).run(...productIds);
  for (const r of rows) logChange('product_angles', r.id, 'delete', userId, 'product deleted');
  return rows.flatMap((r) => [r.url, r.thumb_url]).filter(Boolean);
}
