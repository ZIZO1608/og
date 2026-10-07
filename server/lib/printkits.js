/* ==========================================================================
   OG SYSTEM — jersey print kits and their fonts              [printkits.js]
   --------------------------------------------------------------------------
   Migration 071, cloud file 041. The website sells a name and a number on
   the back of an adult jersey; a KIT says how that shirt looks — the font,
   the colours, the outline, the shadow, and where the name and the number
   sit on a 400 × 440 drawing of a jersey's back. A kit may belong to a club,
   a season and a kind of shirt, or to nobody (a style any shirt can take).

   THE RULES THE OWNER LOCKED (7 Oct 2026), and where each one is enforced:

     * a name and a number ALWAYS together, adult jerseys, back only —
       checkLine() below, for every website order line that carries a print;
       a product must be `printable` to take one;
     * the name: A–Z, space, dot, apostrophe, hyphen; upper case; at most
       print.max_letters — NAME_RE and checkLine();
     * the number: a whole number 0–99 — checkLine();
     * 5 USD a jersey — print.unit_price + print.unit_currency, read by
       Partner.webPrices() (the one copy every print door reads);
     * ready in print.turnaround_min–max days — rules(), the deadline of the
       job raised when the order is accepted (lib/weborders.js).

   Both tables are MIRROR SHAPE, like clubs: small, pushed whole by a content
   hash, no change_log. A font's bytes live in the public `print-fonts`
   bucket (lib/storage.js): the original .ttf/.otf as sent, and a WOFF2 made
   from it here with no package (lib/woff2.js).
   ========================================================================== */

import { get, tx, nowIso } from './db.js';
import * as Storage from './storage.js';
import * as W2 from './woff2.js';

const fail = (message, code, status = 400, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });

export const KIT_TYPES = ['home', 'away', 'third', 'retro', 'gk', 'special'];
/* The shirt's back, as the preview and the website draw it. */
export const VIEWBOX = { w: 400, h: 440 };
/* Letters, space, dot, apostrophe, hyphen — after upper-casing. */
export const NAME_RE = /^[A-Z .'\-]+$/;

/* ----------------------------------------------------------- the settings */

function cfg(d, key) {
  const r = d.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return r == null || r.value == null ? '' : String(r.value).trim();
}
function whole(v, fallback, lo, hi) {
  const n = Number(v);
  return /^\d{1,4}$/.test(String(v)) && n >= lo && n <= hi ? n : fallback;
}

/* The three numbers the print rules are written in. Read every time — a
   change in Settings applies to the next order, no restart. */
export function rules(d = get()) {
  const min = whole(cfg(d, 'print.turnaround_min'), 5, 1, 90);
  const max = Math.max(min, whole(cfg(d, 'print.turnaround_max'), 7, 1, 90));
  return { maxLetters: whole(cfg(d, 'print.max_letters'), 12, 1, 30), turnaround: { min, max } };
}

/* ------------------------------------------------------------------ fonts */

function fontOut(r) {
  return {
    id: r.id, name: r.name, fileUrl: r.file_url || null, sourceUrl: r.source_url || null,
    licenseNote: r.license_note || null, weight: r.weight, archived: !!r.archived,
    uploaded: !!r.file_url,
    kits: r.kits ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

export function fonts({ archived = true } = {}) {
  return get().prepare(
    `SELECT f.*, (SELECT COUNT(*) FROM print_kits k WHERE k.font_id = f.id AND k.archived = 0) AS kits
       FROM print_fonts f ${archived ? '' : 'WHERE f.archived = 0'}
      ORDER BY f.archived, lower(f.name)`
  ).all().map(fontOut);
}

function fontRow(d, id) {
  const r = d.prepare('SELECT * FROM print_fonts WHERE id = ?').get(Number(id));
  if (!r) throw fail('no such font', 'not_found', 404);
  return r;
}

function cleanName(v, what = 'name') {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!t) throw fail(`a ${what} is required`, 'name_required');
  if ([...t].length > 40) throw fail(`a ${what} can be at most 40 characters`, 'name_too_long');
  return t;
}

function assertFreeName(d, name, exceptId = null) {
  const r = d.prepare('SELECT id FROM print_fonts WHERE lower(name) = lower(?) AND id <> ?').get(name, exceptId ?? -1);
  if (r) throw fail('another font already has that name', 'font_name_taken', 409);
}

/* A font file from the browser: the original goes up as it came, beside the
   WOFF2 made from it, and only then is the row written — a refused upload
   leaves nothing behind but what was already there. */
export async function addFont({ name, data, filename = '', weight = 400, licenseNote = null }) {
  const bytes = decodeFont(data);
  const kind = W2.sniff(bytes);
  if (kind !== 'ttf' && kind !== 'otf') {
    throw fail(kind === 'ttc' ? 'That is a font collection (.ttc) — send one face as .ttf or .otf.'
      : kind ? 'Send the original .ttf or .otf file — a web font cannot be used as the original.'
        : 'That is not a font this takes (.ttf or .otf).', kind === 'ttc' ? 'font_collection' : 'bad_font');
  }
  const woff2 = W2.encode(bytes);
  const label = cleanName(name || W2.familyName(bytes) || String(filename).replace(/\.[^.]*$/, ''));
  const w = whole(weight, 400, 1, 1000);
  assertFreeName(get(), label);
  const up = await upload(bytes, kind, woff2, label);
  try {
    return tx((d) => {
      assertFreeName(d, label);
      const at = nowIso();
      const id = d.prepare(
        `INSERT INTO print_fonts (name, file_url, source_url, license_note, weight, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`
      ).run(label, up.fileUrl, up.sourceUrl, licenseNote ? String(licenseNote).slice(0, 300) : null, w, at, at).lastInsertRowid;
      return fontOut(fontRow(d, id));
    });
  } catch (e) {
    dropFiles([up.fileUrl, up.sourceUrl]);
    throw e;
  }
}

/* A new original for a font that already exists (the same name, new bytes),
   or the first upload of a seed. The old files are taken down after. */
export async function replaceFontFile(id, { data }) {
  const was = fontRow(get(), id);
  const bytes = decodeFont(data);
  const kind = W2.sniff(bytes);
  if (kind !== 'ttf' && kind !== 'otf') throw fail('That is not a font this takes (.ttf or .otf).', 'bad_font');
  const up = await upload(bytes, kind, W2.encode(bytes), was.name);
  return setFiles(was, up);
}

function setFiles(was, up) {
  const out = tx((d) => {
    d.prepare('UPDATE print_fonts SET file_url = ?, source_url = ?, updated_at = ? WHERE id = ?')
      .run(up.fileUrl, up.sourceUrl, nowIso(), was.id);
    return fontOut(fontRow(d, was.id));
  });
  dropFiles([was.file_url, was.source_url].filter((u) => u && u !== up.fileUrl && u !== up.sourceUrl));
  return out;
}

async function upload(bytes, kind, woff2, label) {
  const stamp = Date.now().toString(36);
  const sourceUrl = await Storage.putObject(Storage.pathForFont(stamp, kind, label), bytes,
                                            kind === 'otf' ? 'font/otf' : 'font/ttf', Storage.FONT_BUCKET);
  try {
    const fileUrl = await Storage.putObject(Storage.pathForFont(stamp, 'woff2', label), woff2, 'font/woff2', Storage.FONT_BUCKET);
    return { fileUrl, sourceUrl };
  } catch (e) {
    dropFiles([sourceUrl]);
    throw e;
  }
}

function dropFiles(urls) {
  for (const u of urls) {
    const p = Storage.pathOfUrl(u, Storage.FONT_BUCKET);
    if (p) Storage.removeObject(p, Storage.FONT_BUCKET).catch(() => {});
  }
}

/* base64 (a data URL or bare) into bytes. The type a browser writes in front
   of a font is anybody's guess (font/ttf, application/x-font-ttf, octet-
   stream), so it is ignored: the first bytes decide (W2.sniff). */
function decodeFont(data) {
  const m = /^(?:data:[^;,]*;base64,)?([A-Za-z0-9+/=\s]+)$/.exec(String(data || ''));
  if (!m) throw fail('No font file came with the request.', 'bad_font');
  const bytes = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  if (bytes.length < 64) throw fail('That file is too small to be a font.', 'bad_font');
  if (bytes.length > 4 * 1024 * 1024) throw fail('That font file is too large (4 MB at most).', 'too_large', 413);
  return bytes;
}

export function updateFont(id, { name, archived, weight, licenseNote }) {
  return tx((d) => {
    const r = fontRow(d, id);
    const sets = [];
    const args = [];
    if (name !== undefined) {
      const n = cleanName(name);
      assertFreeName(d, n, r.id);
      sets.push('name = ?'); args.push(n);
    }
    if (weight !== undefined) { sets.push('weight = ?'); args.push(whole(weight, r.weight, 1, 1000)); }
    if (licenseNote !== undefined) { sets.push('license_note = ?'); args.push(licenseNote ? String(licenseNote).slice(0, 300) : null); }
    if (archived !== undefined) {
      const off = !!archived;
      /* A font a kit still uses cannot be put away: the kit would be drawn
         in a face that is no longer offered, and the website would get it. */
      if (off) {
        const used = d.prepare('SELECT label FROM print_kits WHERE font_id = ? AND archived = 0 ORDER BY label').all(r.id);
        if (used.length) {
          throw fail(`kits still use it: ${used.map((k) => k.label).join(', ')}`, 'font_in_use', 409,
                     { kits: used.map((k) => k.label) });
        }
      }
      sets.push('archived = ?'); args.push(off ? 1 : 0);
    }
    if (!sets.length) throw fail('nothing to change', 'bad_request');
    d.prepare(`UPDATE print_fonts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, nowIso(), r.id);
    return fontOut(fontRow(d, r.id));
  });
}

/* ------------------------------------------------------- the seed fonts
   The migration plants four fonts with an address on github.com/google/fonts
   and no file of our own. This fetches each, makes the WOFF2, puts both in
   the bucket, and writes the addresses — on the main server's start, and from
   the Fonts screen's Upload now. One at a time; a failure is reported per
   font and leaves that row as it was, for the next try. */
let seeding = null;
export function seedFonts({ force = false } = {}) {
  if (seeding) return seeding;
  seeding = (async () => {
    const out = [];
    const rows = get().prepare(
      `SELECT * FROM print_fonts WHERE archived = 0 AND source_url LIKE 'https://%'
          AND (file_url IS NULL OR ? = 1) ORDER BY id`
    ).all(force ? 1 : 0).filter((r) => !Storage.pathOfUrl(r.source_url, Storage.FONT_BUCKET));
    for (const r of rows) {
      try {
        const res = await fetch(r.source_url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`${res.status} from ${new URL(r.source_url).host}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        const kind = W2.sniff(bytes);
        if (kind !== 'ttf' && kind !== 'otf') throw new Error('the file there is not a .ttf or .otf');
        const up = await upload(bytes, kind, W2.encode(bytes), r.name);
        setFiles(r, up);
        out.push({ id: r.id, name: r.name, ok: true });
      } catch (e) {
        out.push({ id: r.id, name: r.name, ok: false, error: String((e && e.message) || e).slice(0, 200) });
      }
    }
    return out;
  })().finally(() => { seeding = null; });
  return seeding;
}

/* ------------------------------------------------------------------- kits */

const KIT_COLS = `k.*, f.name AS font_name, f.file_url AS font_url, f.weight AS font_weight,
                  f.archived AS font_archived, c.name AS club_name, c.name_ar AS club_name_ar`;
const KIT_FROM = `FROM print_kits k JOIN print_fonts f ON f.id = k.font_id
                  LEFT JOIN clubs c ON c.code = k.club_code`;

function kitOut(r) {
  return {
    id: r.id, label: r.label, clubCode: r.club_code || null,
    club: r.club_code ? { code: r.club_code, en: r.club_name || r.club_code, ar: r.club_name_ar || r.club_name || r.club_code } : null,
    season: r.season || null, kitType: r.kit_type || null,
    fontId: r.font_id, font: { name: r.font_name, url: r.font_url || null, weight: r.font_weight },
    textColor: r.text_color, outlineColor: r.outline_color || null, outlineWidth: r.outline_width,
    shadowColor: r.shadow_color || null, shadowDx: r.shadow_dx, shadowDy: r.shadow_dy,
    nameSize: r.name_size, nameY: r.name_y, nameArc: r.name_arc,
    numberSize: r.number_size, numberY: r.number_y,
    isDefault: !!r.is_default, featured: !!r.featured, archived: !!r.archived,
    products: r.products ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at
  };
}

export function kits({ archived = true } = {}) {
  return get().prepare(
    `SELECT ${KIT_COLS},
            (SELECT COUNT(*) FROM products p WHERE p.print_kit_id = k.id) AS products
       ${KIT_FROM} ${archived ? '' : 'WHERE k.archived = 0'}
      ORDER BY k.archived, k.is_default DESC, k.featured DESC, lower(k.label)`
  ).all().map(kitOut);
}

function kitRow(d, id) {
  return d.prepare(`SELECT ${KIT_COLS} ${KIT_FROM} WHERE k.id = ?`).get(Number(id)) || null;
}

export function kit(id, d = get()) {
  const r = kitRow(d, id);
  return r ? kitOut(r) : null;
}

export function defaultKit(d = get()) {
  const r = d.prepare(`SELECT ${KIT_COLS} ${KIT_FROM} WHERE k.is_default = 1 AND k.archived = 0`).get();
  return r ? kitOut(r) : null;
}

/* The kit a printable product is printed in: its own while it is live, the
   default otherwise. Null when the product is not printable, or there is no
   kit at all to print it in. */
export function kitForProduct(p, d = get()) {
  if (!p || !p.printable) return null;
  if (p.print_kit_id) {
    const own = kitRow(d, p.print_kit_id);
    if (own && !own.archived) return kitOut(own);
  }
  return defaultKit(d);
}

/* The kit a website order line names, or the default when it names one the
   shop does not have (or has put away) — the brief's rule: an unknown kitId
   is printed in the default kit rather than refused. */
export function kitForLine(kitId, p, d = get()) {
  if (kitId != null && /^\d{1,9}$/.test(String(kitId))) {
    const r = kitRow(d, Number(kitId));
    if (r && !r.archived) return { kit: kitOut(r), substituted: false };
  }
  const k = kitForProduct({ ...p, printable: 1 }, d) || defaultKit(d);
  return { kit: k, substituted: kitId != null };
}

/* The kit for a club, season and kind of shirt — what the product form looks
   for before it offers to make one. */
export function find({ clubCode = null, season = null, kitType = null }, d = get()) {
  if (!clubCode) return null;
  const r = d.prepare(
    `SELECT ${KIT_COLS} ${KIT_FROM}
      WHERE k.club_code = ? AND IFNULL(k.season, '') = ? AND IFNULL(k.kit_type, '') = ? AND k.archived = 0`
  ).get(clubCode, season || '', kitType || '');
  return r ? kitOut(r) : null;
}

const HEX = /^#[0-9a-f]{6}$/;
function colour(v, what, nullable) {
  if (v === null || v === undefined || v === '') {
    if (nullable) return null;
    throw fail(`${what} is required`, 'bad_colour');
  }
  let s = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
  if (!HEX.test(s)) throw fail(`${what} must be a colour like #ffffff`, 'bad_colour');
  return s;
}
function int(v, what, lo, hi) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw fail(`${what} must be a whole number from ${lo} to ${hi}`, 'bad_number', 400, { field: what });
  return n;
}

/* Every field a kit has, read from what the screen sent and checked. `was`
   is the stored row when editing, so a field not sent keeps its value. */
function cleanKit(d, b, was = null) {
  const pick = (k, col) => (b[k] !== undefined ? b[k] : was ? was[col] : undefined);
  const out = {};
  out.label = cleanName(pick('label', 'label'), 'label');
  let club = pick('clubCode', 'club_code');
  club = club ? String(club).trim() : null;
  if (club) {
    const c = d.prepare('SELECT code FROM clubs WHERE lower(code) = lower(?)').get(club);
    if (!c) throw fail('no such club', 'bad_club');
    club = c.code;
  }
  out.club_code = club;
  let season = pick('season', 'season');
  season = season ? String(season).trim() : null;
  if (season && !/^(\d{2}|\d{4})\/\d{2}$/.test(season)) throw fail('a season is written like 26/27 or 2008/09', 'bad_season');
  out.season = season;
  let type = pick('kitType', 'kit_type');
  type = type ? String(type).trim().toLowerCase() : null;
  if (type && !KIT_TYPES.includes(type)) throw fail('no such kind of shirt', 'bad_kit_type');
  out.kit_type = type;
  if (!club && (season || type)) throw fail('a season or kind of shirt needs a club', 'season_needs_club');

  const fontId = Number(pick('fontId', 'font_id'));
  const f = d.prepare('SELECT id, archived FROM print_fonts WHERE id = ?').get(fontId);
  if (!f) throw fail('choose a font', 'bad_font_id');
  if (f.archived && (!was || was.font_id !== fontId)) throw fail('that font is put away', 'font_archived');
  out.font_id = fontId;

  out.text_color = colour(pick('textColor', 'text_color'), 'the text colour', false);
  out.outline_color = colour(pick('outlineColor', 'outline_color'), 'the outline colour', true);
  out.outline_width = int(pick('outlineWidth', 'outline_width') ?? 0, 'outline width', 0, 20);
  out.shadow_color = colour(pick('shadowColor', 'shadow_color'), 'the shadow colour', true);
  out.shadow_dx = int(pick('shadowDx', 'shadow_dx') ?? 0, 'shadow across', -20, 20);
  out.shadow_dy = int(pick('shadowDy', 'shadow_dy') ?? 0, 'shadow down', -20, 20);
  out.name_size = int(pick('nameSize', 'name_size') ?? 34, 'name size', 10, 120);
  out.name_y = int(pick('nameY', 'name_y') ?? 165, 'name height', 0, 440);
  out.name_arc = int(pick('nameArc', 'name_arc') ?? 30, 'name curve', -80, 80);
  out.number_size = int(pick('numberSize', 'number_size') ?? 160, 'number size', 40, 300);
  out.number_y = int(pick('numberY', 'number_y') ?? 345, 'number height', 0, 440);
  out.featured = pick('featured', 'featured') ? 1 : 0;
  out.archived = pick('archived', 'archived') ? 1 : 0;
  out.is_default = pick('isDefault', 'is_default') ? 1 : 0;
  if (out.outline_width > 0 && !out.outline_color) throw fail('an outline needs a colour', 'bad_colour');
  if (out.is_default && out.archived) throw fail('the default kit cannot be put away — make another one the default first', 'default_archived', 409);
  return out;
}

function assertFreeSlot(d, k, exceptId) {
  if (!k.club_code || k.archived) return;
  const r = d.prepare(
    `SELECT id, label FROM print_kits
      WHERE club_code = ? AND IFNULL(season, '') = ? AND IFNULL(kit_type, '') = ? AND archived = 0 AND id <> ?`
  ).get(k.club_code, k.season || '', k.kit_type || '', exceptId ?? -1);
  if (r) throw fail(`“${r.label}” is already that club's kit for this season and kind`, 'kit_exists', 409, { kitId: r.id });
}

export function createKit(body) {
  return tx((d) => {
    const k = cleanKit(d, body || {});
    assertFreeSlot(d, k, null);
    if (k.is_default) d.prepare('UPDATE print_kits SET is_default = 0, updated_at = ? WHERE is_default = 1').run(nowIso());
    const at = nowIso();
    const cols = Object.keys(k);
    const id = d.prepare(
      `INSERT INTO print_kits (${cols.join(', ')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`
    ).run(...cols.map((c) => k[c]), at, at).lastInsertRowid;
    return kitOut(kitRow(d, id));
  });
}

export function updateKit(id, body) {
  return tx((d) => {
    const was = d.prepare('SELECT * FROM print_kits WHERE id = ?').get(Number(id));
    if (!was) throw fail('no such kit', 'not_found', 404);
    const k = cleanKit(d, body || {}, was);
    /* The one default is moved, never removed: taking the tick off the
       default would leave every printable product with no kit. */
    if (was.is_default && !k.is_default) throw fail('make another kit the default instead', 'default_needed', 409);
    assertFreeSlot(d, k, was.id);
    if (k.is_default && !was.is_default) d.prepare('UPDATE print_kits SET is_default = 0, updated_at = ? WHERE is_default = 1').run(nowIso());
    const cols = Object.keys(k);
    d.prepare(`UPDATE print_kits SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...cols.map((c) => k[c]), nowIso(), was.id);
    return kitOut(kitRow(d, was.id));
  });
}

/* --------------------------------------------- what the website is given
   The `print` object on a product (contract v1.6), and the styles list.
   `price` is the catalogue's own two-currency shape (lib/catalogue.js
   webPrices), handed in so the arithmetic stays in one place. Never a cost.
   KEEP IN STEP with web.print_of() in supabase/041_print_kits.sql. */
export function printObject(k, { price, d = get() } = {}) {
  if (!k) return null;
  const r = rules(d);
  const o = {
    kitId: k.id,
    label: k.label,
    font: { name: k.font.name, url: k.font.url, weight: k.font.weight },
    textColor: k.textColor,
    outlineColor: k.outlineColor,
    outlineWidth: k.outlineWidth,
    shadowColor: k.shadowColor,
    shadowDx: k.shadowDx,
    shadowDy: k.shadowDy,
    nameSize: k.nameSize,
    nameY: k.nameY,
    nameArc: k.nameArc,
    numberSize: k.numberSize,
    numberY: k.numberY
  };
  if (price !== undefined) o.price = price;
  o.maxLetters = r.maxLetters;
  o.turnaround = r.turnaround;
  return o;
}

/* The featured styles the website lets a customer choose between — the
   same shape without a price. */
export function styles(d = get()) {
  return get().prepare(
    `SELECT ${KIT_COLS} ${KIT_FROM} WHERE k.featured = 1 AND k.archived = 0
      ORDER BY k.is_default DESC, lower(k.label), k.id`
  ).all().map((r) => printObject(kitOut(r), { d }));
}

/* The kit frozen onto a print job's line: what the customer saw is what the
   printer prints, even if the kit is changed tomorrow. */
export function snapshot(k) {
  if (!k) return null;
  const o = printObject(k);
  delete o.maxLetters;
  delete o.turnaround;
  return JSON.stringify({ ...o, clubCode: k.clubCode, season: k.season, kitType: k.kitType });
}

/* --------------------------------------------------- one order line's print
   The website sends { name, number, kitId } on a printed line. Answers the
   cleaned print and the kit, or { problem } — a code the screen words and a
   rejection can carry. The product is checked as the SHOP has it. */
export function checkLine(print, product, d = get()) {
  if (!print || typeof print !== 'object') return { problem: 'print_bad' };
  if (!product) return { problem: 'print_unknown_product' };
  if (!product.printable) return { problem: 'print_not_printable' };
  const r = rules(d);
  const raw = typeof print.name === 'string' ? print.name : '';
  const name = raw.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toUpperCase();
  const num = print.number;
  const hasNum = num !== null && num !== undefined && String(num).trim() !== '';
  /* A name and a number, always together. */
  if (!name || !hasNum) return { problem: 'print_name_and_number' };
  if (!NAME_RE.test(name) || !/[A-Z]/.test(name)) return { problem: 'print_bad_name' };
  if ([...name].length > r.maxLetters) return { problem: 'print_name_too_long', maxLetters: r.maxLetters };
  const n = typeof num === 'number' ? num : /^\d{1,2}$/.test(String(num).trim()) ? Number(String(num).trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > 99) return { problem: 'print_bad_number' };
  const { kit, substituted } = kitForLine(print.kitId, product, d);
  if (!kit) return { problem: 'print_no_kit' };
  return { name, number: n, kit, substituted };
}

/* ------------------------------------------------------- the shop's day
   A deadline is a day, in the shop's own calendar (shop.tz_minutes), the way
   the reminders count days. */
export function deadlineFrom(days, d = get(), now = new Date()) {
  const tz = Number(cfg(d, 'shop.tz_minutes'));
  const local = new Date(now.getTime() + (Number.isFinite(tz) ? tz : 180) * 60000);
  local.setUTCDate(local.getUTCDate() + days);
  return local.toISOString().slice(0, 10);
}
