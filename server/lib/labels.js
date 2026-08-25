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
   zero-dependency rule rules out installing one) — so when a name is
   Arabic, the BROWSER pre-renders just that text run to a 1-bit bitmap (see
   js/labels.js) and this module splices it into the TSPL it is otherwise
   building entirely on its own. Detected per string, not per label.

   This is not printer.js/printing.js (the 80mm THERMAL RECEIPT's TCP
   sender) — a different printer, a different protocol, a different queue —
   though label-transport-tcp.js mirrors printer.js's shape on purpose for
   the config.label.transport = 'tcp' case.
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
const QUIET_ZONE_MM = 2.5;
const JOB_CHUNK_LABELS = 20;        // labels per queued job — see enqueue()
const POLL_MS = 500;
const LONGPOLL_WAIT_MS = 25000;     // stays under js/api.js's 15s AbortController by never being called from the browser at all — see GET /api/labels/next in index.js

const DEFAULT_PRESETS = [
  { key: '30x30', widthMm: 30, heightMm: 30, gapMm: 2, logo: 'small-top',      nameLines: 2, barcodeHeightMm: 12, allowEan: false },
  { key: '30x20', widthMm: 30, heightMm: 20, gapMm: 2, logo: 'omit',           nameLines: 1, barcodeHeightMm: 9,  allowEan: false },
  { key: '40x30', widthMm: 40, heightMm: 30, gapMm: 2, logo: 'small-top-left', nameLines: 2, barcodeHeightMm: 13, allowEan: true  },
  { key: '50x30', widthMm: 50, heightMm: 30, gapMm: 2, logo: 'left-of-text',   nameLines: 2, barcodeHeightMm: 13, allowEan: true  }
];

/* Fixed-cell bitmap-font geometry for TSPL's built-in fonts. STARTING
   VALUES — confirm against the XP-235B's actual TSPL manual on first print;
   clone firmwares vary. Needed because Node has no font-metrics engine, so
   Latin line-wrapping is done here via fixed-width char math rather than
   real text measurement. */
const TSPL_FONTS = {
  '1': { charW: 8,  charH: 12 },
  '2': { charW: 12, charH: 20 },
  '3': { charW: 16, charH: 24 },
  '4': { charW: 24, charH: 32 }
};

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export function isArabic(s) { return ARABIC_RE.test(String(s || '')); }

/* ------------------------------------------------------------- presets */

export function presets() {
  const row = get().prepare("SELECT value FROM config WHERE key = 'label.presets'").get();
  if (!row) return DEFAULT_PRESETS;
  try { return JSON.parse(row.value); } catch { return DEFAULT_PRESETS; }
}

export function preset(key) {
  const p = presets().find(p => p.key === key);
  if (!p) throw Object.assign(new Error(`unknown label preset: ${key}`), { code: 'invalid' });
  return p;
}

function cfgStr(key, fallback) {
  const row = get().prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function cfgNum(key, fallback) {
  const n = Number(cfgStr(key, fallback));
  return Number.isFinite(n) ? n : fallback;
}

/* The per-preset default, unless a manager has set a live override — gap
   varies by label-stock supplier, worth exposing separately from the
   preset's own geometry. */
function effectiveGapMm(presetObj) {
  const row = get().prepare("SELECT value FROM config WHERE key = 'label.gap_mm'").get();
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : presetObj.gapMm;
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

/* --------------------------------------------------------- symbology rules
   EAN-13 only when the preset allows it (>=40mm) AND the stored barcode is
   a genuinely valid EAN-13 — reusing Cat.ean13Check rather than
   reimplementing it. Otherwise Code128 of the numeric label_code, with a
   reason string the preview surfaces so the fallback is never a surprise. */
export function barcodeFor(variant, presetObj) {
  const barcode = variant.barcode || '';
  const validEan = /^\d{13}$/.test(barcode) && Cat.ean13Check(barcode.slice(0, 12)) === Number(barcode[12]);
  const eligible = presetObj.allowEan && validEan;

  if (eligible) {
    return { symbology: 'ean13', content: barcode, fallbackReason: null };
  }
  const fallbackReason = !presetObj.allowEan
    ? `${presetObj.widthMm}mm is narrower than the 40mm EAN-13 needs`
    : 'no valid EAN-13 on this variant';
  return { symbology: 'code128', content: variant.label_code, fallbackReason };
}

/* -------------------------------------------------- width / quiet-zone budget
   Code128 subset-C module count for a PURE-DIGIT string — label_code is
   always digits by construction, so this never needs the mixed-mode
   analysis js/codes.js's code128Values does for arbitrary text. Every
   symbol is 11 modules except STOP (13): START + digit-pairs (+ one
   leftover-digit switch-to-B if odd length) + CHECK + STOP. */
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
   and fits the barcode PLUS a 2.5mm quiet zone on both sides inside the
   preset. Throws a NAMED error rather than silently overflowing the label. */
export function computeBarcodeWidth(symbology, content, presetObj) {
  const modules = symbology === 'ean13' ? EAN13_MODULES : code128ModuleCount(content);
  const usableDots = (presetObj.widthMm - 2 * QUIET_ZONE_MM) * DOTS_PER_MM;
  const narrowDots = Math.floor(usableDots / modules);
  if (narrowDots < 2) {
    throw Object.assign(
      new Error(`${symbology === 'ean13' ? 'EAN-13' : 'Code128'} "${content}" does not fit on a ` +
        `${presetObj.widthMm}\u00d7${presetObj.heightMm}mm label even at the minimum bar width — choose a larger preset.`),
      { code: 'barcode_too_wide' }
    );
  }
  return { narrowDots, modules, widthDots: narrowDots * modules };
}

/* ------------------------------------------------------------- name wrap
   Fixed-width wrap/truncate for LATIN text only — an Arabic name never
   reaches this, it goes through the browser-bitmap path instead. Wraps to
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

/* ------------------------------------------------------ logo placement */
function logoBox(logoMode, widthDots) {
  if (logoMode === 'omit') return null;
  const size = 40; // dots — 5mm, a small monochrome mark, never the full label width
  if (logoMode === 'small-top') return { xDots: Math.round((widthDots - size) / 2), yDots: 4, wDots: size, hDots: size, inline: false };
  if (logoMode === 'small-top-left') return { xDots: 4, yDots: 4, wDots: size, hDots: size, inline: false };
  if (logoMode === 'left-of-text') return { xDots: 4, yDots: 4, wDots: size, hDots: size, inline: true };
  return null;
}

/* -------------------------------------------------------------- layout
   THE data both the TSPL builder AND the browser preview consume — see
   POST /api/labels/preview in index.js and js/labels.js — so the preview
   can never drift from what actually prints. Pure function, no I/O. */
export function computeLayout(variant, presetObj) {
  const widthDots = presetObj.widthMm * DOTS_PER_MM;
  const heightDots = presetObj.heightMm * DOTS_PER_MM;
  const marginDots = Math.round(QUIET_ZONE_MM * DOTS_PER_MM);

  const bc = barcodeFor(variant, presetObj);
  const bcWidth = computeBarcodeWidth(bc.symbology, bc.content, presetObj);
  const barcodeHeightDots = presetObj.barcodeHeightMm * DOTS_PER_MM;

  const logo = logoBox(presetObj.logo, widthDots);
  const textLeft = (logo && logo.inline) ? logo.xDots + logo.wDots + 6 : marginDots;
  const textWidth = widthDots - textLeft - marginDots;

  let y = (logo && !logo.inline) ? logo.yDots + logo.hDots + 4 : 6;

  const nameArabic = isArabic(variant.name);
  const nameLineHeight = TSPL_FONTS['2'].charH + 2;
  const name = {
    xDots: textLeft, yDots: y, font: '2', maxLines: presetObj.nameLines,
    widthDots: textWidth, heightDots: presetObj.nameLines * nameLineHeight, arabic: nameArabic,
    text: nameArabic ? variant.name : wrapName(variant.name, { font: '2', maxLines: presetObj.nameLines, widthDots: textWidth }).join('\n')
  };
  y += name.heightDots + 4;

  const variantLine = { xDots: textLeft, yDots: y, font: '3', text: String(variant.size) };
  y += TSPL_FONTS['3'].charH + 6;

  const barcodeY = Math.max(y, heightDots - barcodeHeightDots - 26 /* HRI text clearance below the bars */);
  const barcode = {
    xDots: Math.max(marginDots, Math.round((widthDots - bcWidth.widthDots) / 2)),
    yDots: barcodeY, wDots: bcWidth.widthDots, hDots: barcodeHeightDots,
    narrowDots: bcWidth.narrowDots, symbology: bc.symbology, content: bc.content,
    fallbackReason: bc.fallbackReason
  };

  return { widthDots, heightDots, logo, name, variant: variantLine, barcode, quietZoneDots: marginDots };
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
  const p = preset(cfgStr('label.default_preset', '30x30'));
  const bytes = Buffer.from(
    `SIZE ${p.widthMm} mm,${p.heightMm} mm\r\nGAP ${effectiveGapMm(p)} mm,0 mm\r\n${cmd}\r\n`,
    'ascii'
  );

  const at = nowIso();
  const jobId = tx((d) => {
    const info = d.prepare(
      `INSERT INTO label_print_jobs
         (batch_id, station, preset, lines, label_count, tspl_b64, status, created_at, created_by)
       VALUES (?, ?, ?, '[]', 0, ?, 'pending', ?, ?)`
    ).run(randomBytes(8).toString('hex'), station, p.key, bytes.toString('base64'), at, userId ?? null);
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

/* One full TSPL command block for ONE label. arabicBitmaps: { name?: {bytesPerRow,height,dataB64} }
   — only present when that field's text is Arabic. SIZE/GAP/CLS resent
   every label, per the printer's own unreliable memory across power
   cycles; DIRECTION 1 controls which edge feeds first (verify on first
   physical print — wrong here means every label upside down). */
export function buildLabelBytes(layout, presetObj, arabicBitmaps = {}) {
  const chunks = [];
  chunks.push(ascii(
    `SIZE ${presetObj.widthMm} mm,${presetObj.heightMm} mm\r\n` +
    `GAP ${effectiveGapMm(presetObj)} mm,0 mm\r\n` +
    `DIRECTION 1\r\n` +
    `DENSITY ${cfgNum('label.density', 8)}\r\n` +
    `SPEED ${cfgNum('label.speed', 4)}\r\n` +
    `CLS\r\n`
  ));

  if (layout.logo) {
    const asset = loadLogoAsset();
    if (asset) chunks.push(bitmapCmd(layout.logo.xDots, layout.logo.yDots, asset));
  }

  if (layout.name.arabic) {
    const bmp = arabicBitmaps.name;
    if (!bmp) {
      throw Object.assign(new Error('Arabic product name needs a browser-rendered bitmap but none was supplied'), { code: 'missing_bitmap' });
    }
    chunks.push(bitmapCmd(layout.name.xDots, layout.name.yDots, bmp));
  } else {
    layout.name.text.split('\n').forEach((line, i) => {
      chunks.push(ascii(`TEXT ${layout.name.xDots},${layout.name.yDots + i * (TSPL_FONTS['2'].charH + 2)},"2",0,1,1,"${escText(line)}"\r\n`));
    });
  }

  chunks.push(ascii(`TEXT ${layout.variant.xDots},${layout.variant.yDots},"3",0,2,2,"${escText(layout.variant.text)}"\r\n`));

  const bc = layout.barcode;
  /* 1 = print the human-readable code below the bars. Scanners fail
     sometimes, eyes don't. */
  chunks.push(ascii(
    `BARCODE ${bc.xDots},${bc.yDots},"${bc.symbology === 'ean13' ? 'EAN13' : '128'}",` +
    `${bc.hDots},1,0,${bc.narrowDots},${bc.narrowDots},"${bc.content}"\r\n`
  ));

  chunks.push(ascii('PRINT 1,1\r\n'));
  return Buffer.concat(chunks);
}

/* ============================================================ orchestration */

/* Idempotency for the ENQUEUE call — the whole POST /api/labels/print
   request — via applied_ops, exactly like Sales.record/Printing.send.
   Distinct from the per-job claim_token lease below, which guards a
   different failure: an already-physically-printed job being handed out
   again, not a double-tapped print button. */
export function enqueue({ lines, presetKey, station, userId, opId, arabicBitmaps = {} }) {
  if (opId) {
    const seen = get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };
  }
  if (!station) throw Object.assign(new Error('a station is required'), { code: 'invalid' });

  const presetObj = preset(presetKey);
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
        const layout = computeLayout(variant, presetObj);
        bytesChunks.push(buildLabelBytes(layout, presetObj, arabicBitmaps[sku]));
      }
      const tsplB64 = Buffer.concat(bytesChunks).toString('base64');

      const info = d.prepare(
        `INSERT INTO label_print_jobs
           (batch_id, station, preset, lines, label_count, tspl_b64, status, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(batchId, station, presetKey, JSON.stringify(chunkLines), chunkSkus.length, tsplB64, at, userId ?? null);
      made.push(Number(info.lastInsertRowid));

      for (const { sku, qty } of chunkLines) {
        d.prepare(
          `INSERT INTO label_print_log (batch_id, job_id, sku, qty, preset, station, user_id, status, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
        ).run(batchId, info.lastInsertRowid, sku, qty, presetKey, station, userId ?? null, at);
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
