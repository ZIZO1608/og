/* ==========================================================================
   OG SYSTEM — the size guide, in centimetres (migration 077, night shift
   28 Oct 2026)
   --------------------------------------------------------------------------
   Reusable charts (size_charts) and one guide per product
   (product_size_guides). A product's guide either FOLLOWS a chart — its
   numbers kept in step with the chart's — or is its own copy. Either way the
   guide row stores its rows RESOLVED: the product's own sizes, in the size
   order (js/sizeorder.js), each with its numbers. Saving a chart rewrites
   every guide that follows it, adding a size to a product adds its row, and
   the cloud copy (supabase/044_size_guides.sql) can hand the website a
   guide without knowing about charts or how sizes sort.

   The rules here, enforced on the server whatever the form did:
     * measures come from MEASURES only, in its order;
     * a centimetre figure is > 0 and ≤ 300, with at most one decimal; EU, US
       and UK are plain shoe sizes, > 0 and ≤ 60. "52,5" is 52.5 (a comma is
       a decimal point here, as in Desk.toMinor), Arabic-Indic digits fold;
     * a NEW product of a clothes type (config sizeguide.clothes_types) needs
       a complete guide — at least one measurement, every ticked one filled in
       for every size. Existing products are not blocked.
   ========================================================================== */

import { get, nowIso, tx, logChange } from './db.js';
import * as Categories from './categories.js';
import '../../js/sizeorder.js';

/* KEEP IN STEP with web.size_measure() in supabase/044_size_guides.sql and
   with MEASURES in js/sizeguide.js — the ids, the order and both names. */
export const MEASURES = [
  { id: 'chest',    unit: 'cm', en: 'Chest width', ar: 'عرض الصدر' },
  { id: 'length',   unit: 'cm', en: 'Length',      ar: 'الطول' },
  { id: 'shoulder', unit: 'cm', en: 'Shoulder',    ar: 'عرض الكتف' },
  { id: 'sleeve',   unit: 'cm', en: 'Sleeve',      ar: 'طول الكم' },
  { id: 'waist',    unit: 'cm', en: 'Waist',       ar: 'الخصر' },
  { id: 'hip',      unit: 'cm', en: 'Hip',         ar: 'الورك' },
  { id: 'inseam',   unit: 'cm', en: 'Inseam',      ar: 'الطول الداخلي' },
  { id: 'foot',     unit: 'cm', en: 'Foot length', ar: 'طول القدم' },
  { id: 'eu',       unit: '',   en: 'EU',          ar: 'EU' },
  { id: 'us',       unit: '',   en: 'US',          ar: 'US' },
  { id: 'uk',       unit: '',   en: 'UK',          ar: 'UK' }
];
const IDS = MEASURES.map((m) => m.id);
const BY_ID = Object.fromEntries(MEASURES.map((m) => [m.id, m]));
export const FITS = ['small', 'true', 'large'];
export const NOTE_MAX = 200;
export const DEFAULT_CLOTHES = ['tshirts', 'jerseys', 'shirts', 'jackets', 'jeans', 'tracks'];

function fail(message, code, status = 400, extra) {
  return Object.assign(new Error(message), { code, status }, extra || {});
}

/* ------------------------------------------------------------ the numbers */

/* "52,5" → 52.5, "٥٢٫٥" → 52.5, 52.5 → 52.5. Anything else is NaN.
   One decimal at most, no sign, no thousands group (nothing measured here
   is a thousand of anything). */
export function parseFigure(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let t = String(v ?? '').trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/[٫,]/g, '.')
    .replace(/\s+/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

/* A figure for one measurement, checked, or a refusal naming it. */
function figure(measure, size, raw) {
  const n = parseFigure(raw);
  const m = BY_ID[measure];
  const max = m.unit === 'cm' ? 300 : 60;
  const name = `${m.en} for ${size}`;
  if (!Number.isFinite(n)) throw fail(`${name} is not a number.`, 'sg_bad_number', 400, { size, measure });
  if (n <= 0 || n > max) throw fail(`${name} must be more than 0 and at most ${max}.`, 'sg_out_of_range', 400, { size, measure, max });
  if (Math.round(n * 10) !== n * 10) throw fail(`${name}: one decimal at most.`, 'sg_one_decimal', 400, { size, measure });
  return n;
}

function cleanMeasures(list) {
  if (!Array.isArray(list)) return [];
  const want = new Set(list.map(String));
  for (const id of want) if (!BY_ID[id]) throw fail(`"${id}" is not a measurement.`, 'sg_bad_measure');
  return IDS.filter((id) => want.has(id));
}

function cleanNote(v) {
  const t = String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  if ([...t].length > NOTE_MAX) throw fail(`A note is at most ${NOTE_MAX} characters.`, 'sg_note_too_long');
  return t;
}

function cleanFit(v) {
  if (v === null || v === undefined || v === '') return null;
  if (!FITS.includes(v)) throw fail('Fit is runs small, true to size or runs large.', 'sg_bad_fit');
  return v;
}

/* Input rows ([{size, values}] or {size: values}) → a map size → values. */
function rowMap(rows) {
  const out = new Map();
  if (Array.isArray(rows)) {
    for (const r of rows) if (r && r.size != null) out.set(String(r.size), r.values || r.v || {});
  } else if (rows && typeof rows === 'object') {
    for (const [k, v] of Object.entries(rows)) out.set(String(k), v || {});
  }
  return out;
}

/* The rows for `sizes` (already in order) from `map`, every value checked.
   A blank cell is left out (an incomplete guide), never stored as 0. */
function buildRows(sizes, measures, map) {
  return sizes.map((size) => {
    const src = map.get(String(size)) || {};
    const values = {};
    for (const m of measures) {
      const raw = src[m];
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;
      values[m] = figure(m, size, raw);
    }
    return { size: String(size), values };
  });
}

export function isComplete(g) {
  if (!g || !g.measures || !g.measures.length || !g.rows || !g.rows.length) return false;
  return g.rows.every((r) => g.measures.every((m) => typeof r.values?.[m] === 'number'));
}

/* What is missing, for the refusal: [{size, measure}] (at most 12). */
function missingCells(g) {
  const out = [];
  for (const r of g.rows) for (const m of g.measures) {
    if (typeof r.values?.[m] !== 'number') out.push({ size: r.size, measure: m });
  }
  return out.slice(0, 12);
}

/* ------------------------------------------------------------- the config */

export function clothesTypes(d = get()) {
  try {
    const r = d.prepare("SELECT value FROM config WHERE key = 'sizeguide.clothes_types'").get();
    const v = r ? JSON.parse(r.value) : DEFAULT_CLOTHES;
    return Array.isArray(v) ? v.map(String) : DEFAULT_CLOTHES;
  } catch { return DEFAULT_CLOTHES; }
}
export function isClothes(type, d = get()) { return clothesTypes(d).includes(String(type)); }

function typeSizes(type) {
  try { return (Categories.byId(type)?.sizes) || []; } catch { return []; }
}
function sortSizes(list, type) {
  return globalThis.SizeOrder.sizes([...new Set(list.map(String))], typeSizes(type));
}

/* --------------------------------------------------------------- charts */

function chartShape(r) {
  if (!r) return null;
  return {
    id: r.id, nameEn: r.name_en, nameAr: r.name_ar, type: r.type || null,
    measures: JSON.parse(r.measures || '[]'), rows: JSON.parse(r.rows || '[]'),
    fit: r.fit || null, noteEn: r.note_en || '', noteAr: r.note_ar || '',
    active: !!r.active, updatedAt: r.updated_at,
    products: r.products ?? undefined
  };
}

export function listCharts() {
  return get().prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM product_size_guides g WHERE g.chart_id = c.id AND g.follows = 1) AS products
       FROM size_charts c ORDER BY c.active DESC, c.name_en COLLATE NOCASE`
  ).all().map(chartShape);
}

export function chartById(id, d = get()) {
  return chartShape(d.prepare('SELECT * FROM size_charts WHERE id = ?').get(Number(id)));
}

function cleanChart(b, current) {
  const nameEn = String(b.nameEn ?? current?.nameEn ?? '').trim().replace(/\s+/g, ' ');
  const nameAr = String(b.nameAr ?? current?.nameAr ?? '').trim().replace(/\s+/g, ' ') || nameEn;
  if (!nameEn && !nameAr) throw fail('A chart needs a name.', 'sg_chart_name');
  if (nameEn.length > 60 || nameAr.length > 60) throw fail('A chart name is at most 60 characters.', 'sg_chart_name');
  const type = b.type !== undefined ? (b.type ? String(b.type) : null) : (current?.type ?? null);
  const measures = b.measures !== undefined ? cleanMeasures(b.measures) : (current?.measures ?? []);
  if (!measures.length) throw fail('Tick at least one measurement.', 'sg_no_measures');
  const map = rowMap(b.rows !== undefined ? b.rows : current?.rows);
  /* The chart's sizes: its category's, plus any size it already has rows for. */
  const sizes = sortSizes([...typeSizes(type), ...map.keys()], type);
  if (!sizes.length) throw fail('A chart needs sizes — choose a category that has some.', 'sg_no_sizes');
  const rows = buildRows(sizes, measures, map);
  return {
    nameEn: nameEn || nameAr, nameAr, type, measures, rows,
    fit: b.fit !== undefined ? cleanFit(b.fit) : (current?.fit ?? null),
    noteEn: b.noteEn !== undefined ? cleanNote(b.noteEn) : (current?.noteEn || null),
    noteAr: b.noteAr !== undefined ? cleanNote(b.noteAr) : (current?.noteAr || null),
    active: b.active !== undefined ? !!b.active : (current ? current.active : true)
  };
}

export function createChart(b = {}, userId = null) {
  const c = cleanChart(b, null);
  return tx((d) => {
    const at = nowIso();
    const info = d.prepare(
      `INSERT INTO size_charts (name_en, name_ar, type, measures, rows, fit, note_en, note_ar, active, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(c.nameEn, c.nameAr, c.type, JSON.stringify(c.measures), JSON.stringify(c.rows), c.fit,
          c.noteEn, c.noteAr, c.active ? 1 : 0, at, userId, at);
    const id = Number(info.lastInsertRowid);
    logChange('size_charts', id, 'insert', userId, null);
    return chartById(id, d);
  });
}

export function updateChart(id, b = {}, userId = null) {
  return tx((d) => {
    const cur = chartById(id, d);
    if (!cur) throw fail('No such chart.', 'not_found', 404);
    const c = cleanChart(b, cur);
    d.prepare(
      `UPDATE size_charts SET name_en = ?, name_ar = ?, type = ?, measures = ?, rows = ?, fit = ?,
              note_en = ?, note_ar = ?, active = ?, updated_at = ? WHERE id = ?`
    ).run(c.nameEn, c.nameAr, c.type, JSON.stringify(c.measures), JSON.stringify(c.rows), c.fit,
          c.noteEn, c.noteAr, c.active ? 1 : 0, nowIso(), cur.id);
    logChange('size_charts', cur.id, 'update', userId, null);
    /* Every guide that follows this chart takes the new numbers now. */
    const followers = d.prepare('SELECT product_id FROM product_size_guides WHERE chart_id = ? AND follows = 1').all(cur.id);
    for (const f of followers) refreshProduct(d, f.product_id, userId, 'chart changed');
    return { ...chartById(cur.id, d), refreshed: followers.length };
  });
}

/* A copy, switched on, named "… (copy)". */
export function duplicateChart(id, userId = null) {
  const cur = chartById(id);
  if (!cur) throw fail('No such chart.', 'not_found', 404);
  return createChart({ ...cur, nameEn: (cur.nameEn + ' (copy)').slice(0, 60), nameAr: (cur.nameAr + ' (نسخة)').slice(0, 60), active: true }, userId);
}

/* ---------------------------------------------------- a product's guide */

function productSizes(d, productId, type) {
  const list = d.prepare('SELECT DISTINCT size FROM variants WHERE product_id = ?').all(productId).map((r) => r.size);
  return sortSizes(list, type);
}

function guideShape(r) {
  if (!r) return null;
  return {
    productId: r.product_id, chartId: r.chart_id ?? null, follows: !!r.follows,
    measures: JSON.parse(r.measures || '[]'), rows: JSON.parse(r.rows || '[]'),
    fit: r.fit || null, noteEn: r.note_en || '', noteAr: r.note_ar || '', updatedAt: r.updated_at
  };
}

export function guideOf(productId, d = get()) {
  return guideShape(d.prepare('SELECT * FROM product_size_guides WHERE product_id = ?').get(Number(productId)));
}

/* Every product's guide, for the catalogue bundle: productId → guide. */
export function byProduct() {
  const out = {};
  try {
    for (const r of get().prepare('SELECT * FROM product_size_guides').all()) out[r.product_id] = guideShape(r);
  } catch { /* before 077 */ }
  return out;
}

/* Input → the row to store, for a product with these sizes. Pure: checks
   everything, writes nothing. `input` null/false/{none:true} = no guide. */
export function resolveInput(d, input, { sizes, type }) {
  if (!input || input.none) return null;
  const chartId = input.chartId ? Number(input.chartId) : null;
  const chart = chartId ? chartById(chartId, d) : null;
  if (chartId && !chart) throw fail('That size chart does not exist.', 'sg_bad_chart');
  const follows = !!input.follows && !!chart;
  if (input.follows && !chart) throw fail('Choose the chart to follow.', 'sg_bad_chart');
  let measures, map, fit, noteEn, noteAr;
  if (follows) {
    measures = chart.measures; map = rowMap(chart.rows);
    fit = chart.fit; noteEn = chart.noteEn || null; noteAr = chart.noteAr || null;
  } else {
    measures = cleanMeasures(input.measures);
    map = rowMap(input.rows);
    fit = cleanFit(input.fit); noteEn = cleanNote(input.noteEn); noteAr = cleanNote(input.noteAr);
  }
  const rows = buildRows(sizes, measures, map);
  return { chartId: chart ? chart.id : null, follows, measures, rows, fit, noteEn, noteAr, type };
}

/* For a product that is being created: refuse a clothes product without a
   complete guide. Called BEFORE the transaction, so nothing is written. */
export function checkNew(d, input, { sizes, type }) {
  const g = resolveInput(d, input, { sizes: sortSizes(sizes, type), type });
  if (isClothes(type, d)) {
    if (!g) throw fail('This is clothing: fill in the size guide before saving.', 'sg_required', 400);
    if (!g.measures.length) throw fail('Tick at least one measurement in the size guide.', 'sg_no_measures');
    if (!isComplete(g)) {
      throw fail('The size guide has empty boxes: every size needs every ticked measurement.', 'sg_incomplete', 400,
                 { missing: missingCells(g) });
    }
  }
  return g;
}

function writeRow(d, productId, g, userId, note) {
  const had = d.prepare('SELECT 1 FROM product_size_guides WHERE product_id = ?').get(productId);
  if (!g) {
    if (had) {
      d.prepare('DELETE FROM product_size_guides WHERE product_id = ?').run(productId);
      logChange('product_size_guides', productId, 'delete', userId, note || 'size guide removed');
    }
    return null;
  }
  d.prepare(
    `INSERT INTO product_size_guides (product_id, chart_id, follows, measures, rows, fit, note_en, note_ar, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET chart_id = excluded.chart_id, follows = excluded.follows,
       measures = excluded.measures, rows = excluded.rows, fit = excluded.fit, note_en = excluded.note_en,
       note_ar = excluded.note_ar, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(productId, g.chartId, g.follows ? 1 : 0, JSON.stringify(g.measures), JSON.stringify(g.rows),
        g.fit, g.noteEn ?? null, g.noteAr ?? null, nowIso(), userId ?? null);
  logChange('product_size_guides', productId, had ? 'update' : 'insert', userId, note || null);
  return guideOf(productId, d);
}

/* Inside the caller's transaction (createWithVariants): a guide already
   checked by checkNew(). */
export function writeNew(d, productId, g, userId) {
  return g ? writeRow(d, productId, g, userId, 'with the new product') : null;
}

/* The guide editor on an existing product. Not refused for being incomplete
   — existing products are not blocked — but a clothes product's guide that
   is saved must be complete, or the "No size guide" filter would lie. */
export function saveFor(productId, input, userId = null) {
  return tx((d) => {
    const p = d.prepare('SELECT id, type FROM products WHERE id = ?').get(Number(productId));
    if (!p) throw fail('No such product.', 'not_found', 404);
    const g = resolveInput(d, input, { sizes: productSizes(d, p.id, p.type), type: p.type });
    if (g && !g.measures.length) throw fail('Tick at least one measurement.', 'sg_no_measures');
    if (g && !isComplete(g)) {
      throw fail('The size guide has empty boxes: every size needs every ticked measurement.', 'sg_incomplete', 400,
                 { missing: missingCells(g) });
    }
    return writeRow(d, p.id, g, userId, null);
  });
}

/* The product's sizes moved (a size or a colour added): rewrite its rows.
   A guide that follows a chart takes the chart's numbers for the new size;
   an own guide gets an empty row for it. Inside the caller's transaction. */
export function refreshProduct(d, productId, userId = null, note = 'sizes changed') {
  const cur = guideOf(productId, d);
  if (!cur) return null;
  const p = d.prepare('SELECT id, type FROM products WHERE id = ?').get(productId);
  if (!p) return null;
  const sizes = productSizes(d, p.id, p.type);
  let g;
  if (cur.follows && cur.chartId) {
    const chart = chartById(cur.chartId, d);
    g = chart ? { chartId: chart.id, follows: true, measures: chart.measures, rows: buildRows(sizes, chart.measures, rowMap(chart.rows)),
                  fit: chart.fit, noteEn: chart.noteEn || null, noteAr: chart.noteAr || null }
              : { ...cur, follows: false, rows: buildRows(sizes, cur.measures, rowMap(cur.rows)), noteEn: cur.noteEn || null, noteAr: cur.noteAr || null };
  } else {
    g = { ...cur, rows: buildRows(sizes, cur.measures, rowMap(cur.rows)), noteEn: cur.noteEn || null, noteAr: cur.noteAr || null };
  }
  return writeRow(d, p.id, g, userId, note);
}

/* Cat.remove: the guide goes first, logged, so the mirror loses it too. */
export function removeForProduct(d, productId, userId) {
  try { writeRow(d, Number(productId), null, userId, 'product deleted'); } catch { /* before 077 */ }
}

/* ------------------------------------------------------------- website */

/* KEEP IN STEP with web.size_guide_of() in supabase/044_size_guides.sql:
   the cloud copy answers the website with the same shape from the same row. */
export function webShape(g) {
  if (!g || !g.measures.length || !isComplete(g)) return null;
  return {
    unit: 'cm',
    measures: g.measures.map((id) => ({ id, unit: BY_ID[id].unit, en: BY_ID[id].en, ar: BY_ID[id].ar })),
    rows: g.rows.map((r) => ({ size: r.size, values: Object.fromEntries(g.measures.map((m) => [m, r.values[m]])) })),
    fit: g.fit || null,
    note: (g.noteEn || g.noteAr) ? { en: g.noteEn || g.noteAr || null, ar: g.noteAr || g.noteEn || null } : null
  };
}
