/* ==========================================================================
   OG SYSTEM — product categories                              [categories.js]
   --------------------------------------------------------------------------
   Migration 057. A category is a row with an English and an Arabic name and
   the sizes it comes in; `products.type` holds its id. Never deleted, only
   switched off — products and old reports still name it.

   Both names are required, and neither may repeat another category's name
   in its language: two "Shirts" in the filter is a filter nobody can use.
   Names are compared folded (case, Arabic letter variants, diacritics).
   ========================================================================== */

import { get, nowIso, tx } from './db.js';
import { foldName } from './text.js';

function fail(message, code, status = 400) {
  const e = new Error(message); e.code = code; e.status = status; return e;
}

function shape(r) {
  let sizes = [];
  try { sizes = JSON.parse(r.sizes || '[]'); } catch { sizes = []; }
  return { id: r.id, nameEn: r.name_en, nameAr: r.name_ar, sizes,
           active: !!r.active, sort: r.sort, updatedAt: r.updated_at };
}

export function list() {
  try {
    return get().prepare('SELECT * FROM categories ORDER BY sort, name_en').all().map(shape);
  } catch { return []; }   /* a database from before 057 */
}

export function byId(id) {
  const r = get().prepare('SELECT * FROM categories WHERE id = ?').get(String(id ?? ''));
  return r ? shape(r) : null;
}

/* The one check every product write goes through. A new product, or one
   moved to another category, must name an ACTIVE category; keeping the one a
   product already has is always allowed. */
export function assertUsable(id, { current = null } = {}) {
  const c = byId(id);
  if (!c) throw fail(`no category called "${id}"`, 'bad_category');
  if (!c.active && id !== current) throw fail(`the category "${c.nameEn}" is switched off`, 'category_off');
  return c;
}

function cleanSizes(v) {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : String(v ?? '').split(/[,،\n]/);
  const out = [];
  for (const s of arr) {
    const x = String(s).trim();
    if (!x) continue;
    if (x.length > 12) throw fail(`the size "${x}" is too long`, 'bad_size');
    if (!out.includes(x)) out.push(x);
  }
  if (out.length > 40) throw fail('at most 40 sizes', 'bad_size');
  return out;
}

function cleanName(v, lang) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) {
    throw fail(`the ${lang === 'ar' ? 'Arabic' : 'English'} name is required`,
               lang === 'ar' ? 'name_ar_required' : 'name_en_required');
  }
  if (s.length > 40) throw fail('a name is at most 40 characters', 'name_too_long');
  /* A category's name is drawn on the till's chips, in every category list and
     on the product badge. The screens escape it (audit 06 found seven that did
     not); this is the second lock — markup has no business in a category's name. */
  if (/[<>]/.test(s)) throw fail('a name cannot contain < or >', 'bad_name');
  return s;
}

function assertUnique(d, nameEn, nameAr, exceptId) {
  const rows = d.prepare('SELECT id, name_en, name_ar FROM categories').all();
  const en = foldName(nameEn), ar = foldName(nameAr);
  for (const r of rows) {
    if (r.id === exceptId) continue;
    if (foldName(r.name_en) === en) throw fail(`"${nameEn}" is already a category`, 'category_dup_en', 409);
    if (foldName(r.name_ar) === ar) throw fail(`"${nameAr}" is already a category`, 'category_dup_ar', 409);
  }
}

/* A slug from the English name: "Track Pants" → "trackpants". A clash gets a
   number, never an error — the person typed a name, not an id. */
function slugFor(d, nameEn) {
  const base = String(nameEn).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 30) || 'cat';
  let id = base, n = 2;
  while (d.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)) id = base + n++;
  return id;
}

export function create({ nameEn, nameAr, sizes = [] } = {}) {
  const en = cleanName(nameEn, 'en'), ar = cleanName(nameAr, 'ar');
  const sz = cleanSizes(sizes) || [];
  return tx((d) => {
    assertUnique(d, en, ar, null);
    const id = slugFor(d, en);
    const at = nowIso();
    const sort = (d.prepare('SELECT MAX(sort) AS m FROM categories WHERE sort < 900').get().m || 0) + 10;
    d.prepare(`INSERT INTO categories (id, name_en, name_ar, sizes, active, sort, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).run(id, en, ar, JSON.stringify(sz), sort, at, at);
    return byId(id);
  });
}

export function update(id, { nameEn, nameAr, sizes, active } = {}) {
  return tx((d) => {
    const cur = d.prepare('SELECT * FROM categories WHERE id = ?').get(String(id ?? ''));
    if (!cur) throw fail('no such category', 'not_found', 404);
    const en = nameEn === undefined ? cur.name_en : cleanName(nameEn, 'en');
    const ar = nameAr === undefined ? cur.name_ar : cleanName(nameAr, 'ar');
    const sz = cleanSizes(sizes);
    assertUnique(d, en, ar, cur.id);
    d.prepare(`UPDATE categories SET name_en = ?, name_ar = ?, sizes = ?, active = ?, updated_at = ?
                WHERE id = ?`)
     .run(en, ar, sz === undefined ? cur.sizes : JSON.stringify(sz),
          active === undefined ? cur.active : (active ? 1 : 0), nowIso(), cur.id);
    return byId(cur.id);
  });
}
