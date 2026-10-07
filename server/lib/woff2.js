/* ==========================================================================
   OG SYSTEM — TrueType / OpenType into WOFF2, with no package     [woff2.js]
   --------------------------------------------------------------------------
   The print kits (migration 071) carry a font the website draws a shirt's
   name in, and a browser wants that font as WOFF2. The packages that make
   one (wawoff2, ttf2woff2) are npm installs — WebAssembly or a native build
   — and the server has none on purpose. WOFF2 does not need them:

     * the container is a 48-byte header, a table directory, and every table
       concatenated and Brotli-compressed as ONE stream — and Node has had
       Brotli built in (node:zlib) since 11;
     * the spec's glyf/loca TRANSFORM (the part the packages exist for) is
       optional. Version 3 of those two tables is the null transform, every
       other table's null transform is version 0, and a decoder must accept
       both (W3C WOFF2 §5.1, §5.3). What it costs is size: a null-transformed
       font is ~10–25% bigger than a transformed one, which for four shirt
       faces is a few kilobytes.

   A font collection (.ttc) is refused: a kit names ONE face. Reading a font
   checks only what the container needs (the table directory is inside the
   file and every table lies inside it); whether the glyphs are any good is
   the browser's business, and the kit screen previews it before anybody
   saves a kit with it.
   ========================================================================== */

import { brotliCompressSync, constants as Z } from 'node:zlib';

/* The 63 tags WOFF2 knows by number (§5.2, in that order). Anything else is
   written as 63 followed by the four bytes of its tag. */
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf',
  'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX',
  'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR',
  'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx',
  'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf',
  'Glat', 'Gloc', 'Feat', 'Sill'];

const fail = (message, code = 'bad_font') => Object.assign(new Error(message), { code, status: 400 });

/* What kind of file this is, from its first four bytes — never its name. */
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  const v = buf.readUInt32BE(0);
  if (v === 0x00010000 || v === 0x74727565 /* 'true' */) return 'ttf';
  if (v === 0x4F54544F /* 'OTTO' */) return 'otf';
  if (v === 0x74746366 /* 'ttcf' */) return 'ttc';
  if (v === 0x774F4632 /* 'wOF2' */) return 'woff2';
  if (v === 0x774F4646 /* 'wOFF' */) return 'woff';
  return null;
}

/* The sfnt's tables, each as its own slice, in the file's directory order. */
export function readSfnt(buf) {
  const kind = sniff(buf);
  if (kind === 'ttc') throw fail('That is a font collection (.ttc) — send one face as .ttf or .otf.', 'font_collection');
  if (kind !== 'ttf' && kind !== 'otf') throw fail('That is not a TrueType or OpenType font (.ttf or .otf).');
  const n = buf.readUInt16BE(4);
  if (!n || n > 200 || buf.length < 12 + n * 16) throw fail('The font\'s table list is damaged.');
  const tables = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const tag = buf.toString('latin1', at, at + 4);
    const off = buf.readUInt32BE(at + 8);
    const len = buf.readUInt32BE(at + 12);
    if (off + len > buf.length) throw fail(`The font's ${tag.trim()} table runs past the end of the file.`);
    if (seen.has(tag)) throw fail(`The font names its ${tag.trim()} table twice.`);
    seen.add(tag);
    tables.push({ tag, data: buf.subarray(off, off + len) });
  }
  if (!seen.has('head') || !seen.has('cmap')) throw fail('The font has no head or cmap table — it cannot be drawn.');
  if (seen.has('glyf') !== seen.has('loca')) throw fail('The font has glyf without loca (or the other way round).');
  return { flavor: buf.readUInt32BE(0) === 0x74727565 ? 0x00010000 : buf.readUInt32BE(0), tables };
}

/* UIntBase128 (§4.1): big-endian, seven bits a byte, the top bit set on every
   byte but the last, no leading zero byte. */
function base128(n) {
  const out = [];
  let v = n >>> 0;
  do { out.unshift(v & 0x7F); v = Math.floor(v / 128); } while (v > 0);
  for (let i = 0; i < out.length - 1; i++) out[i] |= 0x80;
  return out;
}

const pad4 = (n) => (n + 3) & ~3;

/* sfnt bytes in, WOFF2 bytes out. */
export function encode(sfnt) {
  const { flavor, tables } = readSfnt(sfnt);
  /* Tag order, then loca moved to sit straight after glyf: the directory is
     what a decoder rebuilds the sfnt from, and the reference decoder expects
     loca immediately after glyf. */
  const order = tables.slice().sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const li = order.findIndex((t) => t.tag === 'loca');
  if (li >= 0) {
    const [loca] = order.splice(li, 1);
    order.splice(order.findIndex((t) => t.tag === 'glyf') + 1, 0, loca);
  }

  const dir = [];
  for (const t of order) {
    const k = KNOWN.indexOf(t.tag);
    /* glyf and loca: transform version 3 = null (bits 6–7 set). Every other
       table: version 0 = null. No transformLength follows a null transform. */
    const version = t.tag === 'glyf' || t.tag === 'loca' ? 3 : 0;
    dir.push(((version << 6) | (k < 0 ? 63 : k)) & 0xFF);
    if (k < 0) for (let i = 0; i < 4; i++) dir.push(t.tag.charCodeAt(i));
    dir.push(...base128(t.data.length));
  }

  const stream = Buffer.concat(order.map((t) => t.data));
  const packed = brotliCompressSync(stream, {
    params: { [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_FONT, [Z.BROTLI_PARAM_QUALITY]: 11,
              [Z.BROTLI_PARAM_SIZE_HINT]: stream.length }
  });

  const total = 48 + dir.length + packed.length;
  const out = Buffer.alloc(pad4(total));
  out.write('wOF2', 0, 'latin1');
  out.writeUInt32BE(flavor >>> 0, 4);
  out.writeUInt32BE(out.length, 8);
  out.writeUInt16BE(order.length, 12);
  out.writeUInt16BE(0, 14);
  /* What the rebuilt sfnt will measure: its header, its directory, and every
     table padded to four bytes. */
  out.writeUInt32BE(12 + 16 * order.length + order.reduce((a, t) => a + pad4(t.data.length), 0), 16);
  out.writeUInt32BE(packed.length, 20);
  out.writeUInt16BE(1, 24);           // the font's own version — any value
  out.writeUInt16BE(0, 26);
  /* metaOffset, metaLength, metaOrigLength, privOffset, privLength: none. */
  Buffer.from(dir).copy(out, 48);
  packed.copy(out, 48 + dir.length);
  return out;
}

/* The family name the font calls itself (name table, ID 16 then 1), for a
   label to start from. Null when it cannot be read — the person types one. */
export function familyName(sfnt) {
  try {
    const { tables } = readSfnt(sfnt);
    const t = tables.find((x) => x.tag === 'name');
    if (!t) return null;
    const b = t.data;
    const count = b.readUInt16BE(2);
    const strings = b.readUInt16BE(4);
    const found = {};
    for (let i = 0; i < count; i++) {
      const at = 6 + i * 12;
      const platform = b.readUInt16BE(at);
      const id = b.readUInt16BE(at + 6);
      const len = b.readUInt16BE(at + 8);
      const off = b.readUInt16BE(at + 10);
      if (id !== 1 && id !== 16) continue;
      const raw = b.subarray(strings + off, strings + off + len);
      let s = '';
      if (platform === 3 || platform === 0) {
        for (let j = 0; j + 1 < raw.length; j += 2) s += String.fromCharCode(raw.readUInt16BE(j));
      } else if (platform === 1) s = raw.toString('latin1');
      if (s && !found[id]) found[id] = s.trim();
    }
    return found[16] || found[1] || null;
  } catch { return null; }
}
