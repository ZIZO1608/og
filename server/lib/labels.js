/* ==========================================================================
   OG SYSTEM — thermal product labels (Xprinter XP-235B, TSPL)
   --------------------------------------------------------------------------
   A separate system from the browser "Label Studio" in js/app.js
   (LABEL_SIZES / openLabelSheet / labelHTML), which prints through the OS
   print dialog. This module generates TSPL — the printer's own command
   language — on the SERVER, because the server is the one thing that can be
   trusted to say what a label actually contains: a variant's real name,
   size, and code, never whatever a browser happened to send.

   The one exception is Arabic text. TSPL's native TEXT command cannot shape
   Arabic, and Node has no font-shaping engine (no canvas, and the
   zero-dependency rule rules out installing one) — so when a text field is
   Arabic, the BROWSER pre-renders just that field's text to a 1-bit bitmap
   (see js/labels.js) and this module splices it into the TSPL it is
   otherwise building entirely on its own. Detected per field, not per
   label — keyed by the field's slot `kind` in `arabicBitmaps`.

   This is not printer.js/printing.js (the 80mm THERMAL RECEIPT's TCP
   sender) — a different printer, a different protocol, a different queue —
   though label-transport-tcp.js mirrors printer.js's shape on purpose for
   the config.label.transport = 'tcp' case.

   ---- templates (server/migrations/011_label_templates.sql) --------------
   Labels used to be laid out from 4 hardcoded presets. They are now rows in
   `label_templates`: a physical size plus an ordered list of "slots" — named
   regions (logo/header/name/variant/barcode/price/date), each a bounding box
   in DOTS with kind-specific options. `resolveSlot` fits real content INSIDE
   a slot's box exactly the way the old hardcoded code positioned things
   (e.g. a barcode centers itself inside its box) — the box is available
   space, not a literal fixed placement, which is what lets one engine serve
   the 4 legacy presets (seeded to reproduce their exact old dot positions)
   and a user-authored template identically. The wire field name `preset` in
   POST /api/labels/print|preview|calibrate is UNCHANGED — it means "template
   key" now, so the agent and the existing browser chips need no changes.
   ========================================================================== */

import { get, nowIso, tx } from './db.js';
import * as Cat from './catalogue.js';
import * as LabelTcp from './label-transport-tcp.js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const DOTS_PER_MM = 8;              // 203dpi
const JOB_CHUNK_LABELS = 20;        // labels per queued job — see enqueue()
const POLL_MS = 500;
const LONGPOLL_WAIT_MS = 25000;     // stays under js/api.js's 15s AbortController by never being called from the browser at all — see GET /api/labels/next in index.js

/* Ultimate fallback ONLY — used if label_templates is somehow unreadable
   (e.g. mid-migration). Normal operation always reads the table. Kept in
   the old flat-preset shape purely as a last resort, not as a second
   source of truth. */
const FALLBACK_TEMPLATE = {
  key: '30x30', name: '30 x 30mm', widthMm: 30, heightMm: 30, gapMm: 2,
  slots: [
    { kind: 'logo', on: true, xDots: 100, yDots: 4, wDots: 40, hDots: 40 },
    { kind: 'name', on: true, xDots: 20, yDots: 48, wDots: 200, hDots: 44, lines: 2 },
    { kind: 'variant', on: true, xDots: 20, yDots: 96, wDots: 200, hDots: 24 },
    { kind: 'barcode', on: true, xDots: 20, yDots: 126, wDots: 200, hDots: 96, barcodeType: 'auto', showHri: true }
  ]
};

/* Fixed-cell bitmap-font geometry for TSPL's built-in fonts. STARTING
   VALUES — confirm against the XP-235B's actual TSPL manual on first print;
   clone firmwares vary. Needed because Node has no font-metrics engine, so
   line-wrapping/alignment is done here via fixed-width char math rather
   than real text measurement. */
const TSPL_FONTS = {
  '1': { charW: 8,  charH: 12 },
  '2': { charW: 12, charH: 20 },
  '3': { charW: 16, charH: 24 },
  '4': { charW: 24, charH: 32 }
};
const FONT_SIZE_TO_TSPL = { S: '1', M: '2', L: '3' };

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export function isArabic(s) { return ARABIC_RE.test(String(s || '')); }

/* The two 60x40 labels the BROWSER prints, named here because more than one
   place has to agree on the string: js/labels60.js sends it when recording a
   print, and server/lib/shelves.js counts against it to work out how many
   stuck-on labels a shelf reassignment has just invalidated.

   They are deliberately NOT rows in `label_templates`. That table describes
   TSPL slot geometry in printer dots for the server-side renderer; these two
   are laid out in CSS at real millimetres and never reach that code path.
   Adding a row would put a template in the picker that the TSPL renderer
   cannot draw. */
export const SHELF_LABEL_PRESET = 'shelf-60x40';
export const PRODUCT_LABEL_PRESET = 'product-60x40';

/* ------------------------------------------------------------- templates */

function normalizeTemplateRow(row) {
  let slots;
  try { slots = JSON.parse(row.slots); } catch { slots = []; }
  return {
    id: row.id, key: row.key, name: row.name, nameAr: row.name_ar,
    widthMm: row.width_mm, heightMm: row.height_mm, gapMm: row.gap_mm,
    slots
  };
}

export function templates() {
  const rows = get().prepare('SELECT * FROM label_templates WHERE archived = 0 ORDER BY id').all();
  if (!rows.length) return [FALLBACK_TEMPLATE];
  return rows.map(normalizeTemplateRow);
}

export function template(key) {
  const row = get().prepare('SELECT * FROM label_templates WHERE key = ? AND archived = 0').get(key);
  if (!row) {
    if (key === FALLBACK_TEMPLATE.key) return FALLBACK_TEMPLATE;
    throw Object.assign(new Error(`unknown label template: ${key}`), { code: 'invalid' });
  }
  return normalizeTemplateRow(row);
}

function cfgStr(key, fallback) {
  const row = get().prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function cfgNum(key, fallback) {
  const n = Number(cfgStr(key, fallback));
  return Number.isFinite(n) ? n : fallback;
}

/* The per-template default, unless a manager has set a live override — gap
   varies by label-stock supplier, worth exposing separately from a
   template's own geometry. */
function effectiveGapMm(tpl) {
  const row = get().prepare("SELECT value FROM config WHERE key = 'label.gap_mm'").get();
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : tpl.gapMm;
}

/* --------------------------------------------------------------- resolve */

/* Server-authoritative variant data — name, size, barcode, label_code — the
   whole reason this module exists server-side rather than trusting
   whatever a browser POSTs. */
export function resolveVariant(sku) {
  const v = Cat.bySku(sku);
  if (!v) throw Object.assign(new Error(`no such variant: ${sku}`), { code: 'invalid' });
  return v;
}

/* --------------------------------------------------------------- symbology
   'auto' (the common case): EAN-13 if the variant carries a genuinely valid
   one (Cat.ean13Check, reused not reimplemented) AND it fits the slot's own
   width — computeBarcodeWidth is the single source of truth for "fits",
   so there is no separate width-class policy to keep in sync with it.
   'ean13'/'code128' on the slot force the symbology; a forced EAN-13 that
   truly cannot fit still throws barcode_too_wide rather than silently
   printing something else, since that was an explicit choice. */
export function barcodeFor(variant, slot) {
  const barcode = variant.barcode || '';
  const validEan = /^\d{13}$/.test(barcode) && Cat.ean13Check(barcode.slice(0, 12)) === Number(barcode[12]);
  const forced = slot.barcodeType === 'ean13' || slot.barcodeType === 'code128';
  const tryEan = slot.barcodeType === 'ean13' || (!forced && validEan);

  if (tryEan) {
    if (!validEan) {
      return { symbology: 'code128', content: variant.label_code, fallbackReason: 'no valid EAN-13 on this variant' };
    }
    try {
      computeBarcodeWidth('ean13', barcode, slot); // throws barcode_too_wide if it doesn't fit — caught below unless forced
      return { symbology: 'ean13', content: barcode, fallbackReason: null };
    } catch (e) {
      if (slot.barcodeType === 'ean13') throw e;
      return { symbology: 'code128', content: variant.label_code, fallbackReason: "EAN-13 does not fit this label's width" };
    }
  }
  return { symbology: 'code128', content: variant.label_code, fallbackReason: null };
}

/* -------------------------------------------------- width / quiet-zone budget
   Code128 subset-C module count for a PURE-DIGIT string — label_code is
   always digits by construction, so this never needs the mixed-mode
   analysis js/codes.js's code128Values does for arbitrary text. Every
   symbol is 11 modules except STOP (13): START + digit-pairs (+ one
   leftover-digit switch-to-B if odd length) + CHECK + STOP.

   `slot.wDots` is already the USABLE width — a template's slot boxes are
   authored (or seeded) inset from the label edge, so no separate quiet-zone
   subtraction happens here; the box IS the quiet-zone-safe area. */
export function code128SymbolCount(digits) {
  const s = String(digits);
  const pairs = Math.floor(s.length / 2);
  const odd = s.length % 2 === 1;
  return 1 /* START C */ + pairs + (odd ? 2 : 0) /* switch to B + 1 digit */ + 1 /* CHECK */ + 1 /* STOP */;
}
function code128ModuleCount(digits) {
  const symbols = code128SymbolCount(digits);
  return (symbols - 1) * 11 + 13;
}
const EAN13_MODULES = 11 + 95 + 7;   // asymmetric quiet + 95 data + guard — matches fitBarcode() in js/app.js's old Label Studio

/* Narrowest bar width (in dots) that still clears the printer's 2-dot floor
   and fits the barcode inside the slot's own box. Throws a NAMED error
   rather than silently overflowing the label. */
export function computeBarcodeWidth(symbology, content, slot) {
  const modules = symbology === 'ean13' ? EAN13_MODULES : code128ModuleCount(content);
  const usableDots = slot.wDots;
  const narrowDots = Math.floor(usableDots / modules);
  if (narrowDots < 2) {
    throw Object.assign(
      new Error(`${symbology === 'ean13' ? 'EAN-13' : 'Code128'} "${content}" does not fit a ` +
        `${Math.round(usableDots / DOTS_PER_MM)}mm-wide slot even at the minimum bar width — widen the slot or choose a larger template.`),
      { code: 'barcode_too_wide' }
    );
  }
  return { narrowDots, modules, widthDots: narrowDots * modules };
}

/* ------------------------------------------------------------- text fitting
   Fixed-width wrap/truncate — Latin only, an Arabic field never reaches
   this (routed to the browser-bitmap path instead by resolveSlot). Wraps to
   at most `maxLines`, then ellipsizes the last line — truncation is
   explicitly fine here, unlike the receipt: the barcode is the identity. */
export function wrapName(name, { font = '2', maxLines, widthDots }) {
  const cell = TSPL_FONTS[font].charW;
  const maxChars = Math.max(1, Math.floor(widthDots / cell));
  const words = String(name).trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);

  const consumedWords = lines.join(' ').split(/\s+/).length;
  const totalWords = words.length;
  if (lines.length === maxLines && consumedWords < totalWords) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > maxChars - 1 ? last.slice(0, maxChars - 1) + '\u2026' : last + '\u2026';
  }
  return lines.slice(0, maxLines);
}

/* Single-line fit for header/variant/price/date: truncate with an ellipsis
   rather than let TSPL draw text past the slot (which, unlike a browser,
   TSPL will happily do — it has no clipping of its own). Returns whether it
   had to shorten anything, so the caller can surface a non-fatal warning
   (the spec's "warn rather than silently clip" rule) instead of throwing —
   unlike a barcode not fitting, a slightly-truncated price is not a print
   that should be blocked. */
function fitOneLine(text, font, widthDots) {
  const cell = TSPL_FONTS[font].charW;
  const maxChars = Math.max(1, Math.floor(widthDots / cell));
  const s = String(text);
  if (s.length <= maxChars) return { text: s, overflow: false };
  return { text: s.slice(0, Math.max(1, maxChars - 1)) + '\u2026', overflow: true };
}

/* Left/center/right within a box, in dots, using the same fixed-cell char
   math as everything else here (TSPL has no native text alignment). */
function alignX(text, font, align, box) {
  const textWidthDots = String(text).length * TSPL_FONTS[font].charW;
  if (align === 'center') return box.xDots + Math.max(0, Math.round((box.wDots - textWidthDots) / 2));
  if (align === 'right') return box.xDots + Math.max(0, box.wDots - textWidthDots);
  return box.xDots;
}

function thousandsSep(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* -------------------------------------------------------------- one slot
   Every kind returns a "field": the thing buildLabelBytes/the browser
   preview actually draw. `type` is 'text' | 'barcode' | 'bitmap' | 'image'.
   A text field whose content is Arabic becomes 'bitmap' instead — the
   browser must supply arabicBitmaps[slot.kind] for it (see js/labels.js). */
function resolveSlot(slot, variant, shopCfg, opts = {}) {
  const font = FONT_SIZE_TO_TSPL[slot.fontSize] || '2';

  if (slot.kind === 'logo') {
    return { kind: 'logo', type: 'image', xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots };
  }

  if (slot.kind === 'barcode') {
    /* A request-level override wins over the template's own 'auto', so an
       admin's Auto/EAN-13/internal-code choice applies to every barcode
       slot in the job without editing templates. 'auto' (or no override)
       leaves the slot exactly as authored. */
    const effectiveType = (opts.barcodeType && opts.barcodeType !== 'auto') ? opts.barcodeType : slot.barcodeType;
    const effectiveSlot = effectiveType === slot.barcodeType ? slot : { ...slot, barcodeType: effectiveType };
    const bc = barcodeFor(variant, effectiveSlot);
    const bcWidth = computeBarcodeWidth(bc.symbology, bc.content, slot);
    const xDots = slot.xDots + Math.max(0, Math.round((slot.wDots - bcWidth.widthDots) / 2));
    return {
      kind: 'barcode', type: 'barcode', xDots, yDots: slot.yDots, wDots: bcWidth.widthDots, hDots: slot.hDots,
      narrowDots: bcWidth.narrowDots, symbology: bc.symbology, content: bc.content,
      showHri: slot.showHri !== false, fallbackReason: bc.fallbackReason
    };
  }

  if (slot.kind === 'name') {
    const arabic = isArabic(variant.name);
    const maxLines = slot.lines || 2;
    const lineHeight = TSPL_FONTS['2'].charH + 2;
    if (arabic) {
      return { kind: 'name', type: 'bitmap', arabic: true, xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots };
    }
    const lines = wrapName(variant.name, { font: '2', maxLines, widthDots: slot.wDots });
    return {
      kind: 'name', type: 'text', xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots,
      font: '2', lineHeight, text: lines.join('\n'), overflow: false
    };
  }

  if (slot.kind === 'variant') {
    const arabic = isArabic(variant.size);
    if (arabic) return { kind: 'variant', type: 'bitmap', arabic: true, xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots };
    const fit = fitOneLine(variant.size, '3', slot.wDots);
    return { kind: 'variant', type: 'text', xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots, font: '3', text: fit.text, overflow: fit.overflow };
  }

  if (slot.kind === 'header') {
    const raw = shopCfg.name || '';
    const arabic = isArabic(raw);
    if (arabic) return { kind: 'header', type: 'bitmap', arabic: true, xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots };
    const fit = fitOneLine(raw, font, slot.wDots);
    const xDots = alignX(fit.text, font, slot.align, slot);
    return { kind: 'header', type: 'text', xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots, font, text: fit.text, overflow: fit.overflow };
  }

  if (slot.kind === 'price') {
    const amount = Cat.fromMinor(variant.selling_price ?? 0, variant.currency);
    const [whole, frac] = amount.split('.');
    const wholeFmt = slot.thousands ? thousandsSep(whole.replace('-', '')) : whole.replace('-', '');
    const sign = whole.startsWith('-') ? '-' : '';
    const body = sign + wholeFmt + (frac ? '.' + frac : '');
    const text = `${slot.currencyPrefix || ''}${body}${slot.currencySuffix ? ' ' + slot.currencySuffix : ''}`.trim();
    const fit = fitOneLine(text, font, slot.wDots);
    const xDots = alignX(fit.text, font, slot.align, slot);
    return { kind: 'price', type: 'text', xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots, font, text: fit.text, overflow: fit.overflow };
  }

  if (slot.kind === 'date') {
    const text = nowIso().slice(0, 10);
    const fit = fitOneLine(text, '1', slot.wDots);
    return { kind: 'date', type: 'text', xDots: slot.xDots, yDots: slot.yDots, wDots: slot.wDots, hDots: slot.hDots, font: '1', text: fit.text, overflow: fit.overflow };
  }

  throw Object.assign(new Error(`unknown slot kind: ${slot.kind}`), { code: 'invalid' });
}

/* -------------------------------------------------------------- layout
   THE data both the TSPL builder AND the browser preview consume — see
   POST /api/labels/preview in index.js and js/labels.js — so the preview
   can never drift from what actually prints. Pure function except for the
   Cat.fromMinor/config reads resolveSlot makes, which are themselves pure
   reads with no side effects. `tpl` is a normalized template row (see
   normalizeTemplateRow) — `template(key)`'s return shape. */
export function computeLayout(variant, tpl, opts = {}) {
  const widthDots = tpl.widthMm * DOTS_PER_MM;
  const heightDots = tpl.heightMm * DOTS_PER_MM;
  const shopCfg = { name: cfgStr('shop.name', '') };

  const fields = (tpl.slots || [])
    .filter((s) => s.on !== false)
    .map((slot) => resolveSlot(slot, variant, shopCfg, opts));

  return { widthDots, heightDots, fields };
}

/* 'auto' or absent leaves every template slot exactly as authored; 'ean13'/
   'code128' force that symbology across the whole job. Anything else is a
   client mistake, not a state worth silently coercing. */
export function isValidBarcodeType(bt) {
  return bt == null || ['auto', 'ean13', 'code128'].includes(bt);
}

/* ------------------------------------------------------------- calibrate
   After a roll change the printer needs to re-learn the gap between
   labels — this sends the printer's own gap-sensing command rather than
   making someone hold the feed button. Queued through the exact same job
   table as a real print, just with an empty `lines` (nothing to log per
   variant) and its own tiny TSPL block. */
export function calibrate({ station, userId, opId }) {
  if (opId) {
    const seen = get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };
  }
  if (!station) throw Object.assign(new Error('a station is required'), { code: 'invalid' });

  const cmd = cfgStr('label.calibrate_cmd', 'AUTODETECT');
  const tpl = template(cfgStr('label.default_preset', '30x30'));
  const bytes = Buffer.from(
    `SIZE ${tpl.widthMm} mm,${tpl.heightMm} mm\r\nGAP ${effectiveGapMm(tpl)} mm,0 mm\r\n${cmd}\r\n`,
    'ascii'
  );

  const at = nowIso();
  const jobId = tx((d) => {
    const info = d.prepare(
      `INSERT INTO label_print_jobs
         (batch_id, station, preset, lines, label_count, tspl_b64, status, created_at, created_by)
       VALUES (?, ?, ?, '[]', 0, ?, 'pending', ?, ?)`
    ).run(randomBytes(8).toString('hex'), station, tpl.key, bytes.toString('base64'), at, userId ?? null);
    return Number(info.lastInsertRowid);
  });

  const result = { jobId };
  if (opId) {
    get().prepare(
      `INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, 'label', ?)`
    ).run(opId, at, userId ?? null, JSON.stringify(result));
  }
  return result;
}

/* ---------------------------------------------------------- logo bitmap
   A small monochrome mark never changes between prints, so it is rasterized
   ONCE, offline (see server/scripts/build-label-logo.mjs), and loaded here
   as a static asset rather than needing a font/canvas engine at request
   time. Stored in ESC/POS polarity (1=black) like everything else that
   passes through invertToTsplPolarity, so there is exactly one place bit
   polarity is ever flipped. */
let logoAsset = null;
function loadLogoAsset() {
  if (logoAsset !== undefined && logoAsset !== null) return logoAsset;
  try {
    const raw = readFileSync(join(HERE, '..', 'assets', 'label-logo.json'), 'utf8');
    logoAsset = JSON.parse(raw); // { bytesPerRow, height, dataB64 } at 40x40 dots, ESC/POS polarity
  } catch {
    logoAsset = null; // not generated yet — labels print without a logo rather than failing
  }
  return logoAsset;
}

/* ---------------------------------------------------------- TSPL assembly */
function ascii(s) { return Buffer.from(s, 'ascii'); }

/* The ONE place ESC/POS polarity (1=black) becomes TSPL polarity (0=black).
   Applied to the static logo asset and to every browser-supplied Arabic
   bitmap, and nowhere else. */
export function invertToTsplPolarity(buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ 0xFF;
  return out;
}

function bitmapCmd(x, y, bmp) {
  const raw = invertToTsplPolarity(Buffer.from(bmp.dataB64, 'base64'));
  return Buffer.concat([ascii(`BITMAP ${x},${y},${bmp.bytesPerRow},${bmp.height},0,`), raw, ascii('\r\n')]);
}
function escText(s) { return String(s).replace(/["\\]/g, '\\$&'); }

/* One full TSPL command block for ONE label. `fields` comes from
   computeLayout(). arabicBitmaps: { [kind]: {bytesPerRow,height,dataB64} }
   — only present for fields resolveSlot marked type:'bitmap'. SIZE/GAP/CLS
   resent every label, per the printer's own unreliable memory across power
   cycles; DIRECTION 1 controls which edge feeds first (verify on first
   physical print — wrong here means every label upside down). */
export function buildLabelBytes(layout, tpl, arabicBitmaps = {}) {
  const chunks = [];
  chunks.push(ascii(
    `SIZE ${tpl.widthMm} mm,${tpl.heightMm} mm\r\n` +
    `GAP ${effectiveGapMm(tpl)} mm,0 mm\r\n` +
    `DIRECTION 1\r\n` +
    `DENSITY ${cfgNum('label.density', 8)}\r\n` +
    `SPEED ${cfgNum('label.speed', 4)}\r\n` +
    `CLS\r\n`
  ));

  for (const f of layout.fields) {
    if (f.type === 'image') {
      if (f.kind === 'logo') {
        const asset = loadLogoAsset();
        if (asset) chunks.push(bitmapCmd(f.xDots, f.yDots, asset));
      }
      continue;
    }

    if (f.type === 'bitmap') {
      const bmp = arabicBitmaps[f.kind];
      if (!bmp) {
        throw Object.assign(new Error(`Arabic "${f.kind}" field needs a browser-rendered bitmap but none was supplied`), { code: 'missing_bitmap' });
      }
      chunks.push(bitmapCmd(f.xDots, f.yDots, bmp));
      continue;
    }

    if (f.type === 'text') {
      const lineHeight = f.lineHeight || (TSPL_FONTS[f.font].charH + 2);
      String(f.text).split('\n').forEach((line, i) => {
        chunks.push(ascii(`TEXT ${f.xDots},${f.yDots + i * lineHeight},"${f.font}",0,1,1,"${escText(line)}"\r\n`));
      });
      continue;
    }

    if (f.type === 'barcode') {
      /* 1 = print the human-readable code below the bars when showHri is
         on. Scanners fail sometimes, eyes don't. */
      chunks.push(ascii(
        `BARCODE ${f.xDots},${f.yDots},"${f.symbology === 'ean13' ? 'EAN13' : '128'}",` +
        `${f.hDots},${f.showHri ? 1 : 0},0,${f.narrowDots},${f.narrowDots},"${f.content}"\r\n`
      ));
    }
  }

  chunks.push(ascii('PRINT 1,1\r\n'));
  return Buffer.concat(chunks);
}

/* ============================================================ orchestration */

/* Idempotency for the ENQUEUE call — the whole POST /api/labels/print
   request — via applied_ops, exactly like Sales.record/Printing.send.
   Distinct from the per-job claim_token lease below, which guards a
   different failure: an already-physically-printed job being handed out
   again, not a double-tapped print button. */
export function enqueue({ lines, presetKey, station, userId, opId, arabicBitmaps = {}, barcodeType }) {
  if (opId) {
    const seen = get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };
  }
  if (!station) throw Object.assign(new Error('a station is required'), { code: 'invalid' });
  if (!isValidBarcodeType(barcodeType)) {
    throw Object.assign(new Error(`invalid barcodeType: ${barcodeType}`), { code: 'invalid' });
  }

  const tpl = template(presetKey);
  const maxBatch = cfgNum('label.max_batch', 500);
  const totalQty = lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
  if (totalQty <= 0) throw Object.assign(new Error('nothing to print'), { code: 'invalid' });
  if (totalQty > maxBatch) {
    throw Object.assign(new Error(`${totalQty} labels exceeds the ${maxBatch}-label batch limit.`), { code: 'batch_too_large' });
  }

  const flat = [];
  for (const l of lines) {
    const sku = String(l.variantId || l.sku);
    const qty = Math.max(0, Math.floor(Number(l.qty) || 0));
    for (let i = 0; i < qty; i++) flat.push(sku);
  }

  const batchId = randomBytes(8).toString('hex');
  const at = nowIso();

  const jobIds = tx((d) => {
    const made = [];
    for (let off = 0; off < flat.length; off += JOB_CHUNK_LABELS) {
      const chunkSkus = flat.slice(off, off + JOB_CHUNK_LABELS);
      const counts = {};
      for (const sku of chunkSkus) counts[sku] = (counts[sku] || 0) + 1;
      const chunkLines = Object.entries(counts).map(([sku, qty]) => ({ sku, qty }));

      const bytesChunks = [];
      for (const sku of chunkSkus) {
        const variant = resolveVariant(sku);
        const layout = computeLayout(variant, tpl, { barcodeType });
        bytesChunks.push(buildLabelBytes(layout, tpl, arabicBitmaps[sku]));
      }
      const tsplB64 = Buffer.concat(bytesChunks).toString('base64');

      const info = d.prepare(
        `INSERT INTO label_print_jobs
           (batch_id, station, preset, lines, label_count, tspl_b64, status, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(batchId, station, tpl.key, JSON.stringify(chunkLines), chunkSkus.length, tsplB64, at, userId ?? null);
      made.push(Number(info.lastInsertRowid));

      for (const { sku, qty } of chunkLines) {
        d.prepare(
          `INSERT INTO label_print_log (batch_id, job_id, sku, qty, preset, station, user_id, status, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
        ).run(batchId, info.lastInsertRowid, sku, qty, tpl.key, station, userId ?? null, at);
      }
    }
    return made;
  });

  const result = { batchId, jobIds, labelCount: flat.length };
  if (opId) {
    get().prepare(
      `INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?, ?, ?, 'label', ?)`
    ).run(opId, at, userId ?? null, JSON.stringify(result));
  }
  return result;
}

/* Restores a past batch as a fresh print — re-derives {lines, presetKey,
   station} from the original job rows and calls enqueue() directly, so a
   reprint is provably the same code path as a first print, not a parallel
   one. Idempotent via its own opId, distinct from the original batch's. */
/* ------------------------------------------------ labels the BROWSER printed
   The 60x40 shelf and product labels do not come through here. They are laid
   out in HTML at real millimetre sizes and handed to the operating system's
   own print dialog, because that is the only path on which Arabic survives —
   a TSPL `TEXT` command is written as ASCII, so the alternative is rasterising
   every Arabic run to a bitmap in the browser and splicing it in, keyed by a
   sku that a shelf does not have.

   What they still owe this table is the record. `who printed what, how many,
   for which station` is the reason 010 writes a row before an agent has even
   seen the job, and a shelf label nobody can prove was printed is exactly the
   thing phase 1's reassign warning has to count.

   status 'printed', never 'done': window.print() hands the page to the OS and
   returns. Nothing afterwards knows whether paper moved, whether the driver
   scaled it, or whether the dialog was cancelled. 'done' is the print agent
   confirming it wrote bytes, and this path can never earn that. */
export function record({ preset, station, items = [], userId = null }) {
  if (!Array.isArray(items) || !items.length) {
    throw Object.assign(new Error('nothing to record'), { code: 'invalid' });
  }

  const batchId = randomBytes(8).toString('hex');
  const at = nowIso();

  /* No logChange: label_print_log is an APPEND-ONLY mirror table, bookmarked
     by the highest id already pushed rather than replayed from change_log. */
  return tx((d) => {
    const ins = d.prepare(
      `INSERT INTO label_print_log
         (batch_id, sku, subject_type, subject_id, qty, preset, station, user_id, status, at)
       VALUES (?,?,?,?,?,?,?,?,'printed',?)`
    );

    let labels = 0;
    for (const it of items) {
      const kind = it.subjectType === 'shelf' ? 'shelf' : 'variant';
      const qty = Math.max(1, Number(it.qty) || 1);
      /* A variant row keeps its sku in the sku column as well as in
         subject_id, so `WHERE sku = ?` — which every existing reader uses —
         goes on meaning what it meant. A shelf has no sku and leaves it NULL. */
      const sku = kind === 'variant' ? String(it.subjectId) : null;
      ins.run(batchId, sku, kind, String(it.subjectId), qty,
              String(preset || ''), String(station || 'browser'), userId, at);
      labels += qty;
    }

    return { batchId, labels, items: items.length };
  });
}

export function reprint(batchId, userId, opId) {
  if (opId) {
    const seen = get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };
  }
  const jobs = get().prepare(
    `SELECT station, preset, lines FROM label_print_jobs WHERE batch_id = ? ORDER BY id`
  ).all(batchId);
  if (!jobs.length) throw Object.assign(new Error(`no such batch: ${batchId}`), { code: 'invalid' });

  const counts = {};
  for (const job of jobs) {
    for (const { sku, qty } of JSON.parse(job.lines)) counts[sku] = (counts[sku] || 0) + qty;
  }
  const lines = Object.entries(counts).map(([sku, qty]) => ({ sku, qty }));
  return enqueue({ lines, presetKey: jobs[0].preset, station: jobs[0].station, userId, opId });
}

/* Read side of label_print_log — never had one before; History (js/app.js's
   `labels` view) is the first consumer. */
export function printLog({ sku, batchId, station, limit = 200 } = {}) {
  const clauses = [];
  const params = [];
  if (sku) { clauses.push('sku = ?'); params.push(sku); }
  if (batchId) { clauses.push('batch_id = ?'); params.push(batchId); }
  if (station) { clauses.push('station = ?'); params.push(station); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);
  return get().prepare(
    `SELECT l.*, u.username AS user_name
       FROM label_print_log l LEFT JOIN users u ON u.id = l.user_id
       ${where}
      ORDER BY l.at DESC LIMIT ?`
  ).all(...params);
}

/* ---------------------------------------------- claim / lease / complete
   pending --[next()]--> claimed --[complete('done'|'failed')]--> done|failed
                            |
                            +-- lease expires while still 'claimed' -->
                                requeued to 'pending', eligible for
                                re-claim under a NEW claim_token.

   Accepted tradeoff: if an agent dies after physically printing but before
   reporting /done, its lease eventually expires and the job can be handed
   out again — a second sticker prints. The alternative (a local
   at-most-once ledger on the agent) adds persistent state to a component
   designed to be trivial and disposable, to avoid a cost (one wasted
   label) far smaller than what the lease actually protects: a job whose
   agent died mid-print permanently blocking every job queued behind it at
   that station. claim_token is what keeps a late, stale completion SAFE
   even when this happens — it can only match a `status = 'claimed'` row
   still holding that exact token, so it can never complete a job that has
   since been reclaimed under a new one. */
function leaseMinutes() { return cfgNum('label.lease_minutes', 10); }

function claimOne(station) {
  const now = nowIso();
  return tx((d) => {
    d.prepare(
      `UPDATE label_print_jobs SET status = 'pending', claim_token = NULL, claimed_at = NULL, lease_expires_at = NULL
        WHERE status = 'claimed' AND lease_expires_at < ?`
    ).run(now);

    const row = d.prepare(
      `SELECT id FROM label_print_jobs WHERE station = ? AND status = 'pending' ORDER BY id LIMIT 1`
    ).get(station);
    if (!row) return null;

    const token = randomBytes(12).toString('hex');
    const leaseUntil = new Date(Date.now() + leaseMinutes() * 60000).toISOString();
    d.prepare(
      `UPDATE label_print_jobs SET status = 'claimed', claim_token = ?, claimed_at = ?, lease_expires_at = ?
        WHERE id = ? AND status = 'pending'`
    ).run(token, now, leaseUntil, row.id);

    return d.prepare('SELECT * FROM label_print_jobs WHERE id = ?').get(row.id);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* Bounded-wait long-poll body. NEVER called through js/api.js — its
   request() aborts every call at a hard 15s (js/api.js:31) — only
   agent/print-agent.js, over raw node:http with no such timeout, calls
   this route. */
export async function next({ station, waitMs = LONGPOLL_WAIT_MS }) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const job = claimOne(station);
    if (job) {
      return {
        id: job.id, claimToken: job.claim_token, station: job.station,
        preset: job.preset, labelCount: job.label_count, tsplB64: job.tspl_b64
      };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await sleep(Math.min(POLL_MS, remaining));
  }
}

/* Called by POST /api/labels/:id/done and /:id/failed. The WHERE clause is
   what makes a stale/duplicate/wrong-token completion a silent no-op
   instead of corrupting a later claim's state. */
export function complete(jobId, claimToken, outcome, error) {
  const at = nowIso();
  return tx((d) => {
    const info = d.prepare(
      `UPDATE label_print_jobs SET status = ?, error = ?, done_at = ?
        WHERE id = ? AND claim_token = ? AND status = 'claimed'`
    ).run(outcome, error ?? null, at, jobId, claimToken);

    if (info.changes === 0) return { ok: false, stale: true };

    const job = d.prepare('SELECT * FROM label_print_jobs WHERE id = ?').get(jobId);
    for (const { sku, qty } of JSON.parse(job.lines)) {
      d.prepare(
        `INSERT INTO label_print_log (batch_id, job_id, sku, qty, preset, station, user_id, status, error, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(job.batch_id, job.id, sku, qty, job.preset, job.station, job.created_by, outcome, error ?? null, at);
    }
    return { ok: true };
  });
}

/* Only a still-pending job can be cancelled — one already claimed might
   already be mid-print, and cancelling it out from under an agent that is
   about to report back would just create another stale-completion case. */
export function cancel(jobId, userId) {
  const at = nowIso();
  return tx((d) => {
    const info = d.prepare(
      `UPDATE label_print_jobs SET status = 'cancelled', done_at = ? WHERE id = ? AND status = 'pending'`
    ).run(at, jobId);
    if (info.changes === 0) return { ok: false, reason: 'not_cancellable' };

    const job = d.prepare('SELECT * FROM label_print_jobs WHERE id = ?').get(jobId);
    for (const { sku, qty } of JSON.parse(job.lines)) {
      d.prepare(
        `INSERT INTO label_print_log (batch_id, job_id, sku, qty, preset, station, user_id, status, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'cancelled', ?)`
      ).run(job.batch_id, job.id, sku, qty, job.preset, job.station, userId ?? null, at);
    }
    return { ok: true };
  });
}

/* -------------------------------------------------------------- tcp transport
   Only used when config.label.transport = 'tcp' — a USB→LAN adapter is on
   the printer, so the server sends TSPL directly instead of leaving the job
   for an agent to poll for. Claims each job by its own id (not "oldest
   pending for the station", which claimOne() does for the agent path) so
   this can't race a station that also happens to have an agent running.
   Called from the route handler, after enqueue() has already committed the
   jobs — network I/O never happens inside a DB transaction. */
function claimSpecific(jobId) {
  const now = nowIso();
  return tx((d) => {
    const token = randomBytes(12).toString('hex');
    const leaseUntil = new Date(Date.now() + leaseMinutes() * 60000).toISOString();
    const info = d.prepare(
      `UPDATE label_print_jobs SET status = 'claimed', claim_token = ?, claimed_at = ?, lease_expires_at = ?
        WHERE id = ? AND status = 'pending'`
    ).run(token, now, leaseUntil, jobId);
    if (info.changes === 0) return null;
    return { job: d.prepare('SELECT * FROM label_print_jobs WHERE id = ?').get(jobId), token };
  });
}

export async function dispatchTcp(jobIds, { host, port }) {
  for (const jobId of jobIds) {
    const claimed = claimSpecific(jobId);
    if (!claimed) continue;
    try {
      await LabelTcp.send(Buffer.from(claimed.job.tspl_b64, 'base64'), { host, port });
      complete(jobId, claimed.token, 'done', null);
    } catch (e) {
      complete(jobId, claimed.token, 'failed', e.message);
    }
  }
}

export function queue({ station, limit = 100 } = {}) {
  return get().prepare(
    `SELECT id, batch_id, station, preset, label_count, status, error, created_at, done_at
       FROM label_print_jobs
      ${station ? 'WHERE station = ?' : ''}
      ORDER BY id DESC LIMIT ?`
  ).all(...(station ? [station, limit] : [limit]));
}
