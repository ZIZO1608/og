/* ============================================================================
   SHELVES                                                        [shelves.js]
   ----------------------------------------------------------------------------
   Where things physically are, and what each shelf is FOR.

   The shop has one warehouse and its shelves carry no codes at all — they
   exist in people's heads. This is what the manager lays the room out with,
   and then walks it labelling the racks from what he printed.

   TWO FACTS, KEPT APART (see 023_shelves.sql):

     assignment — `shelves.product_id` + a size range. What a person decided
                  the shelf is for. Stable enough to print.
     contents   — `stock.shelf_id`. What is sitting there right now, derived
                  on every read and never stored as a number.

   THE POINT OF THE WHOLE FEATURE is `assignStock` below: it refuses a pair
   put down in the wrong place at the moment somebody puts it down, and names
   where it actually belongs. Catching it at a stock count in June tells you
   only that something went wrong at some point since March.

   Nothing here opens a transaction inside another one. `DB.tx()` refuses to
   nest, deliberately, and every write path in this file either owns its
   transaction or takes the handle from the caller's.
   ========================================================================== */

import * as DB from './db.js';
import { PRODUCT_LABEL_PRESET } from './labels.js';

const fail = (msg, code, extra) => Object.assign(new Error(msg), { code }, extra || {});

/* A shelf code is ONE letter and then digits, and nothing else. Latin and
   Western, never أ٣ — the scanner gun emits these with no special handling and
   everybody in the shop reads them.

   One letter rather than one or two on purpose. The row routines below extend
   a room through A..Z and stop; allowing an 'AA1' in by hand would make a room
   the "add a row" button could no longer grow, because there is no letter
   after AA in a 26-entry alphabet. A code the editor cannot maintain is worse
   than a code it refuses. */
const CODE_RE = /^([A-Z])([0-9]{1,3})$/;

/* 26 rows is a very large room and 'AA' on a 60x40 label is a row of dots.
   Refusing is better than silently generating something unreadable. */
const ROW_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const MAX_COLS = 99;

/* How a shelf is named to a person and, in phase 2, encoded in its barcode.
   Codes are unique per SECTION, so room M and room B can both own an A3 and
   only the pair identifies a shelf. Defined once, here, so the screen, the
   error message and the barcode cannot drift apart. */
export const fullCode = (sectionKey, code) => `${sectionKey}-${code}`;

/* ------------------------------------------------------------------- sizes
   `variants.size` is TEXT and the shop uses two unrelated families of it:

     footwear and jeans   '39' '40' '41' … '28' '30' '32'
     everything worn      'S' 'M' 'L' 'XL' 'XXL'

   Neither string comparison nor a numeric cast is correct for both. As text,
   '9' sorts after '42'. Cast to a number, SQLite turns every one of 'S' 'M'
   'L' 'XL' 'XXL' into 0 — so a range of S..XL becomes 0..0 and silently
   matches every clothing size there is, in either direction. A range that
   quietly matches the wrong shoes is worse than having no ranges at all.

   So sizes are ranked in JS, per family, and a range only ever compares
   within one family. That is safe because a range lives on a shelf that is
   assigned to ONE product, and a product's sizes are all of one family.

   A size that ranks in neither family — 'One Size', 'Free', whatever the shop
   invents next — returns null and simply cannot take part in a range. It can
   still live on a shelf assigned to the whole model. */
const APPAREL = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL'];
const APPAREL_ALIAS = { '2XS': 'XXS', '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL' };

/* `canon` is the one spelling a rank is ever stored as. Sizes arrive typed by
   a person, so '2XL', 'xl' and 'XXL' are the same shelf rule and '40.0', ' 40 '
   and '40' are the same size — but stored as typed they compare as different
   strings, which made a no-op edit look like a real reassignment and demand
   `force`, and put whatever was typed on a printed label. */
export function sizeKey(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return { family: 'number', rank: n, canon: String(n) };
  }
  const alias = APPAREL_ALIAS[s] || s;
  const i = APPAREL.indexOf(alias);
  return i >= 0 ? { family: 'letter', rank: i, canon: alias } : null;
}

/* No range at all means the whole model lives here, so everything fits. */
export function inRange(size, from, to) {
  if (from == null || to == null) return true;
  const s = sizeKey(size), a = sizeKey(from), b = sizeKey(to);
  if (!s || !a || !b) return false;
  if (s.family !== a.family || s.family !== b.family) return false;
  /* min/max rather than trusting the stored order. The order IS validated on
     the way in; this costs nothing and means a row edited by hand in the
     database cannot invert the meaning of a printed label. */
  return s.rank >= Math.min(a.rank, b.rank) && s.rank <= Math.max(a.rank, b.rank);
}

export function rangeLabel(from, to) {
  if (from == null || to == null) return null;
  return from === to ? String(from) : `${from}–${to}`;
}

/* Both ends, same family, in order. Thrown as bad_range so the screen can say
   which of the three it was. */
function checkRange(from, to) {
  if (from == null && to == null) return { from: null, to: null };
  if (from == null || to == null) {
    throw fail('a size range needs both ends, or neither', 'bad_range');
  }
  const a = sizeKey(from), b = sizeKey(to);
  if (!a) throw fail(`"${from}" is not a size this can put in order`, 'bad_range');
  if (!b) throw fail(`"${to}" is not a size this can put in order`, 'bad_range');
  if (a.family !== b.family) {
    throw fail(`"${from}" and "${to}" are not the same kind of size`, 'bad_range');
  }
  if (a.rank > b.rank) throw fail(`${from} comes after ${to}`, 'bad_range');
  /* Stored canonically, not as typed, so that storage and comparison agree by
     construction rather than by luck. */
  return { from: a.canon, to: b.canon };
}

/* A range has to be the same kind of size as the product it is a range of.

   39–41 on a shelf of T-shirts is not a narrow rule, it is a rule that can
   never match — and it fails as `wrong_size` on every attempt, which reads as
   a broken feature rather than a mistake somebody made in Settings. Refused
   here, where the message can say what it is.

   NOT checked against what is in stock today. A shelf set aside for 46s the
   shop has not ordered yet is somebody planning ahead, and refusing that would
   be the system arguing with the manager about his own warehouse. */
function checkFamily(d, productId, from) {
  const want = sizeKey(from).family;
  const rows = d.prepare('SELECT DISTINCT size FROM variants WHERE product_id = ?').all(productId);
  const have = new Set(rows.map((r) => sizeKey(r.size)).filter(Boolean).map((k) => k.family));
  if (!have.size || have.has(want)) return;

  const p = d.prepare('SELECT name FROM products WHERE id = ?').get(productId);
  throw fail(
    `${p ? p.name : 'that product'} is sized ${[...have].join(' and ')}, ` +
    `so "${from}" is not a size it comes in`,
    'bad_range'
  );
}

/* The warehouse number that goes inside a shelf barcode.

   Kept in `config` rather than as a column on `warehouses`, because that table
   is pushed to Supabase by syncReference() — before the core loop, with no
   fallbackDrop and no try/catch. A column the mirror has not got there would
   take the entire sync down before a single sale was pushed. See
   024_label_subjects.sql.

   Unreadable or missing gives an empty map, and every caller then treats the
   warehouse as unnumbered and refuses to print rather than guessing. */
function warehouseCodes(d) {
  const row = d.prepare("SELECT value FROM config WHERE key = 'label.warehouse_codes'").get();
  if (!row) return {};
  try { return JSON.parse(row.value) || {}; } catch { return {}; }
}

/* ----------------------------------------------------------------- reading */

/* Every room in a warehouse with its shelves, each shelf carrying what it is
   FOR and — derived here, never stored — what is on it now. Same reasoning as
   lib/alerts.js: a stored count is a fact about a moment that has passed, and
   a shelf that says 12 when it holds 3 sends somebody to the wrong rack. */
export function list({ whId = null } = {}) {
  const d = DB.get();

  const sections = whId
    ? d.prepare('SELECT * FROM sections WHERE wh_id = ? ORDER BY sort_index, key').all(whId)
    : d.prepare('SELECT * FROM sections ORDER BY wh_id, sort_index, key').all();
  if (!sections.length) return [];

  const ids = sections.map((s) => s.id);
  const holes = ids.map(() => '?').join(',');

  const shelves = d.prepare(
    `SELECT sh.*, p.name AS product_name, p.type AS product_type, p.hidden AS product_hidden
       FROM shelves sh
       LEFT JOIN products p ON p.id = sh.product_id
      WHERE sh.section_id IN (${holes})
      ORDER BY sh.row_label, sh.col_index`
  ).all(...ids);

  /* ARCHIVED PRODUCTS ARE NOT STOCK. A discontinued line keeps whatever it
     had — the row has to stay so old invoices still resolve — and for a long
     time nothing filtered it, so 293 pieces the shop had stopped selling sat
     in the warehouse totals and on a count sheet. A shelf figure is the same
     question, so it gets the same answer. */
  const held = new Map();
  for (const r of d.prepare(
    `SELECT s.shelf_id AS shelf_id,
            COALESCE(SUM(s.qty), 0) AS qty,
            COUNT(DISTINCT CASE WHEN s.qty > 0 THEN s.sku END) AS variants
       FROM stock s
       JOIN variants v ON v.sku = s.sku
       JOIN products p ON p.id = v.product_id
      WHERE s.shelf_id IS NOT NULL AND p.hidden = 0
      GROUP BY s.shelf_id`
  ).all()) held.set(r.shelf_id, r);

  /* What is physically sitting on each shelf, row by row, for the map's flat
     panel. Derived on the same read as the totals above and filtered the same
     way, so a panel's rows always sum to the tile's number — a panel showing
     three products under a tile that says 0 is the kind of disagreement that
     makes people stop trusting the screen. qty > 0 only: a stock row that
     still points here after selling out is a remembered location, not
     contents. */
  const onShelf = new Map();
  for (const r of d.prepare(
    `SELECT s.shelf_id, s.sku, s.qty, v.size, v.product_id,
            p.name AS product_name
       FROM stock s
       JOIN variants v ON v.sku = s.sku
       JOIN products p ON p.id = v.product_id
      WHERE s.shelf_id IS NOT NULL AND s.qty > 0 AND p.hidden = 0
      ORDER BY p.name, v.size`
  ).all()) {
    if (!onShelf.has(r.shelf_id)) onShelf.set(r.shelf_id, []);
    onShelf.get(r.shelf_id).push({
      sku: r.sku, size: r.size, qty: r.qty,
      product_id: r.product_id, product_name: r.product_name
    });
  }

  const whCodes = warehouseCodes(d);

  return sections.map((sec) => {
    const mine = shelves.filter((sh) => sh.section_id === sec.id).map((sh) => {
      const h = held.get(sh.id);
      return {
        ...sh,
        full_code: fullCode(sec.key, sh.code),
        /* An unassigned shelf has no range, whatever the columns say. A
           hard-deleted product nulls product_id and leaves size_from/size_to
           behind (ON DELETE SET NULL), and drawing "39–41" on a shelf that
           accepts anything is a rule the map would be inventing. */
        range: sh.product_id == null ? null : rangeLabel(sh.size_from, sh.size_to),
        qty: h ? h.qty : 0,
        variants: h ? h.variants : 0,
        contents: onShelf.get(sh.id) || []
      };
    });
    const cols = [...new Set(mine.map((s) => s.col_index))].sort((a, b) => a - b);
    const size = rackSize(sec, cols.length ? cols[cols.length - 1] : 1);
    return {
      ...sec,
      /* The number that rides inside every shelf barcode, so the browser can
         build 'SH01MA3' without a second round trip and without inventing its
         own numbering. NULL for a warehouse added after 024 ran and never
         given one — the label printer refuses rather than emitting 'SHnullMA3'. */
      wh_code: whCodes[sec.wh_id] ?? null,
      /* How big this rack is, defaults applied, and where it stands in
         centimetres — so the map never owns a number the server does not. */
      size,
      wall_cm: wallCmOf(sec, size),
      shelves: mine,
      /* So the grid draws without anybody parsing a code. A missing shelf is
         simply a row that does not exist — a door where B4 would be — and
         these are the letters and numbers that actually do. */
      rows: [...new Set(mine.map((s) => s.row_label))].sort(),
      cols
    };
  });
}

/* Stock that has arrived and not been put away. NULL shelf_id is permanent
   and valid, so this is a working list rather than an error: "these came in,
   somebody still has to carry them to a rack". */
export function unshelved(whId) {
  return DB.get().prepare(
    `SELECT COALESCE(SUM(s.qty), 0) AS pieces, COUNT(*) AS skus
       FROM stock s
       JOIN variants v ON v.sku = s.sku
       JOIN products p ON p.id = v.product_id
      WHERE s.wh_id = ? AND s.shelf_id IS NULL AND s.qty > 0 AND p.hidden = 0`
  ).get(whId);
}

/* ------------------------------------------------------------- occupancy
   What is physically on a shelf, for the guards that refuse to delete one.

   This deliberately counts ARCHIVED products too, unlike the reporting figures
   above. Those answer "how much stock does the shop have", where a
   discontinued line is not an answer. This answers "is there a box on this
   rack", where twenty archived pairs are very much a box on the rack — and
   deleting the shelf would throw away the only record of where they are. */
function occupancy(d, shelfId) {
  return d.prepare(
    `SELECT COALESCE(SUM(qty), 0) AS pieces,
            COUNT(*) AS rows_,
            COUNT(DISTINCT CASE WHEN qty > 0 THEN sku END) AS variants
       FROM stock WHERE shelf_id = ?`
  ).get(shelfId);
}

/* How many labels have been printed for what is currently on this shelf, and
   whether a label carries a shelf code at all.

   `carriesShelfCode` is computed, not assumed: it goes true on its own the
   day a template gains a `shelf` slot (phase 2), and until then the honest
   answer is that reassigning a shelf makes no printed PRODUCT label wrong.
   The shelf's OWN label is a different matter and is always invalidated by a
   code change. */
function labelExposure(d, shelfId) {
  /* Never 'queued'. A line printed through the agent writes TWO rows — one
     'queued' the instant the request is accepted, one 'done' when the agent
     reports back — so counting both reports twice as many labels as were ever
     stuck to a box. 'printed' is the browser path's own terminal state, where
     no agent exists to confirm anything; it is a first row, not a second. */
  const printed = d.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(l.qty), 0) AS labels
       FROM label_print_log l
      WHERE l.status IN ('done','printed')
        AND l.sku IN (SELECT sku FROM stock WHERE shelf_id = ?)`
  ).get(shelfId);

  /* THE STALE COUNT IS COUNTED, NOT INFERRED.

     Only some printed labels carry a shelf code, so "how many labels exist"
     is the wrong number. The 60x40 product label introduced in phase 2 prints
     the shelf the pair belongs on; every older TSPL preset does not. Both are
     in this one table and they are told apart by `preset`, so the honest
     answer is a second count restricted to that preset rather than a guess
     multiplied over the whole history.

     A TSPL template could also grow a `shelf` slot later, which would make its
     labels stale too — so the templates are checked as well, parsed rather
     than matched with LIKE (a template editor writing `{"kind": "shelf"}` with
     a space would slip past a LIKE and report every stale label as fine, which
     is the wrong direction for a warning to fail in). */
  const withSlot = d.prepare('SELECT id, key, slots FROM label_templates WHERE archived = 0')
    .all().filter((t) => {
      try { return JSON.parse(t.slots).some((s) => s && s.kind === 'shelf' && s.on !== false); }
      catch { return false; }
    }).map((t) => t.key);

  const carriers = [PRODUCT_LABEL_PRESET, ...withSlot];
  const holes = carriers.map(() => '?').join(',');
  const stale = d.prepare(
    `SELECT COALESCE(SUM(l.qty), 0) AS labels
       FROM label_print_log l
      WHERE l.status IN ('done','printed')
        AND l.preset IN (${holes})
        AND l.sku IN (SELECT sku FROM stock WHERE shelf_id = ?)`
  ).get(...carriers, shelfId);

  return {
    printed: printed.labels,
    batches: printed.n,
    carriesShelfCode: true,
    /* How many stuck-on labels this change makes wrong. */
    stale: stale.labels
  };
}

/* ---------------------------------------------------------------- sections */

/* A section is a RACK: one unit of shelving with a letter, levels (the row
   letters, A at the top) and bays (the columns). It may hang on one wall of a
   room (026) or be nowhere yet, and since 036 it has a SIZE. */

/* ---------------------------------------------------------------- geometry
   THE ONE SET OF NUMBERS. Every dimension the map draws a rack with comes
   from here, in centimetres, and is sent to the browser with the layout
   (`geometry` in GET /api/sections). It used to be a block of constants in
   js/shelfroom.js, which meant the server was testing two racks for overlap
   in BAYS without knowing how wide a bay was — and could never say whether a
   rack fitted on a measured wall at all.

     bay      one column of shelves, upright to upright (the pitch)
     level    one row letter, board to board
     depth    how far the rack stands out from its wall
     upright  the post between two bays, inside the bay pitch
     base     the plinth the bottom level sits on
     top      the top board
     board    a shelf board

   A rack's width is cols × bay. Nothing else about it is a sum. */
export const GEOMETRY = Object.freeze({
  bay_cm: 114, level_cm: 46, depth_cm: 95,
  upright_cm: 14, base_cm: 8, top_cm: 5, board_cm: 4
});

/* A room is at most a hundred metres a side — a typed 80000 is a slipped
   finger, not a hangar, and the map would draw it as a dot on a plain. */
export const MAX_ROOM_CM = 10000;

/* The narrowest a bay can be MADE. When a room is shrunk under a rack the
   rack's bays are scaled down to fit — never removed, because a bay may hold
   stock and printed labels (removeShelves refuses exactly that) — and below
   this the rack is not shelving any more, it is a bookcase. Then the resize
   is refused instead, naming the rack. */
export const BAY_MIN = 60;

export const RACK_LIMITS = Object.freeze({
  bay: [BAY_MIN, 300], level: [10, 200], depth: [20, 200]
});

/* A RACK THAT STANDS ON THE FLOOR (051) turns in quarter turns and nothing
   else. Arbitrary angles would make every overlap test rotated rectangle
   against rotated rectangle; quarter turns keep every footprint axis-aligned,
   so the arithmetic below extends instead of being replaced. Nobody parks a
   shelving unit at 37°. */
export const ROTATIONS = Object.freeze([0, 90, 180, 270]);
const PLACEMENTS = new Set(['wall', 'free']);

/* THE AISLE. A rack 20 cm from another is geometrically legal and physically
   useless: nobody can walk between them or open a box. A free-standing rack
   may leave no less than this to anything — a wall or another rack — so a
   layout that cannot be walked is refused before anybody carries steel
   upstairs. Read on every call rather than frozen at import, so OG_AISLE_MIN
   can set it for a harness; 0 turns the rule off, and nothing else does. */
export const AISLE_MIN = 70;
export function aisleMin() {
  const v = process.env.OG_AISLE_MIN;
  if (v == null || v === '') return AISLE_MIN;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : AISLE_MIN;
}

const WALLS = new Set(['n', 'e', 's', 'w']);
const WALL_NAME = { n: 'back', s: 'front', e: 'right', w: 'left' };

/* HOW TALL A RACK STANDS, in centimetres: the plinth, its levels, the top
   rails. The same sum the room draws (heightOf in js/shelfroom.js). */
function rackHeight(levels, levelCm) {
  return GEOMETRY.base_cm + levels * levelCm + GEOMETRY.top_cm;
}
function levelsOf(d, id) {
  return d.prepare('SELECT COUNT(DISTINCT row_label) AS n FROM shelves WHERE section_id = ?').get(id).n;
}

/* A LEVEL MAKES A RACK TALLER, so it is checked against the room's ceiling
   the way a bay is checked against its wall — refused, saying how tall it
   would be and how high the room is. A room with no height typed in has no
   ceiling to hit, the same admitted gap an unmeasured floor is. */
function checkHeight(room, sec, levels, levelCm) {
  if (!room || room.height_cm == null || !levels) return;
  const h = rackHeight(levels, levelCm);
  if (h <= room.height_cm) return;
  const most = Math.max(0, Math.floor((room.height_cm - GEOMETRY.base_cm - GEOMETRY.top_cm) / levelCm));
  throw fail(`rack ${sec.key} would stand ${h} cm tall with ${levels} levels and ${room.name} is ${room.height_cm} cm high`,
             'rack_too_tall', { rack: sec.key, levels, height_cm: h, room_height_cm: room.height_cm, max_levels: most });
}

/* THE ROOM'S RACK: the bay, the level and the depth the racks already
   standing in it share — each the commonest, the smaller on a tie — or null
   for a room with none yet. A rack with no size of its own counts as the
   standard it is drawn at. The bay is what Stage C asked for; the level and
   the depth go with it, because a new rack 95 cm deep with 46 cm levels
   beside racks of 45 and 34 is the same wrong in another direction. */
function roomSizeCm(d, roomId, exceptId = -1) {
  const rows = d.prepare('SELECT bay_cm, level_cm, depth_cm FROM sections WHERE room_id = ? AND id <> ?')
                .all(roomId, exceptId);
  if (!rows.length) return null;
  const commonest = (col, std) => {
    const seen = new Map();
    for (const r of rows) {
      const v = r[col] ?? std;
      seen.set(v, (seen.get(v) || 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  };
  return { bay: commonest('bay_cm', GEOMETRY.bay_cm), level: commonest('level_cm', GEOMETRY.level_cm),
           depth: commonest('depth_cm', GEOMETRY.depth_cm) };
}

/* A grid typed in: how many levels and how many bays. */
function checkGrid(rows, cols) {
  const r = Number(rows), c = Number(cols);
  if (!Number.isInteger(r) || r < 1) throw fail('rows must be a whole number', 'bad_request');
  if (!Number.isInteger(c) || c < 1) throw fail('columns must be a whole number', 'bad_request');
  if (r > ROW_LETTERS.length) throw fail(`${ROW_LETTERS.length} rows is the most this can label A–Z`, 'too_many_rows');
  if (c > MAX_COLS) throw fail(`${MAX_COLS} bays is the most`, 'too_many_cols');
  return { rows: r, cols: c };
}

/* How many levels or bays one press adds or takes: a handle dragged three
   bays out is three bays in ONE transaction, never three requests that can
   half land. */
function howMany(v) {
  const n = v == null ? 1 : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_COLS) throw fail('how many is a whole number, at least 1', 'bad_request');
  return n;
}

/* How wide a rack is, in bays: its highest column. A rack with no shelves yet
   is one bay wide, so it still claims a place on the wall. */
function colsOf(d, id) {
  return Math.max(1,
    d.prepare('SELECT COALESCE(MAX(col_index), 1) AS m FROM shelves WHERE section_id = ?').get(id).m);
}

/* A rack's size with the defaults applied. NULL in a column means the shop's
   standard rack, not a measured zero (036). */
export function rackSize(sec, cols) {
  const bay = sec.bay_cm ?? GEOMETRY.bay_cm;
  const c = Math.max(1, Number(cols) || 1);
  return {
    bay,
    level: sec.level_cm ?? GEOMETRY.level_cm,
    depth: sec.depth_cm ?? GEOMETRY.depth_cm,
    cols: c,
    width: c * bay
  };
}

/* Where along its wall a rack stands, in centimetres. `wall_cm` is the truth
   since 036; a row restored from a mirror that predates 013 can still carry
   only the bay count, and that is converted with the rack's own bay rather
   than left as a hole in the wall. */
function wallCmOf(sec, size) {
  if (sec.wall_cm != null) return sec.wall_cm;
  if (sec.wall_pos != null) return sec.wall_pos * size.bay;
  return null;
}

function wallLen(wall, room) {
  return wall === 'n' || wall === 's' ? room.width_cm : room.depth_cm;
}

/* The rectangle of floor a rack covers, in centimetres from the room's
   north-west corner, x east and z south. THIS IS THE CM TWIN OF placeOnWall()
   AND footprint() IN js/shelfroom.js — same cases, same order. Change one and
   you must change the other; they have drifted before and it was expensive.

   On a wall, `at` is measured from the wall's left end AS YOU FACE THE WALL,
   which is the west end of the back wall, the east end of the front wall, the
   north end of the right wall and the south end of the left.

   FREE-STANDING (051), `wall` is 'free' and `at` is { x, y, rot }: the rack's
   centre, x from the room's LEFT edge and y from its FRONT edge (the door's
   wall), and a quarter turn. At 0° and 180° the rack lies across the room, at
   90° and 270° it runs front to back. Still one axis-aligned rectangle, which
   is the whole reason rotation is quarter turns.

   One rectangle per rack is what lets a single test answer every way two
   racks can collide: side by side on one wall, nose to nose across a room
   too shallow for both, in a corner, and a rack in the middle of the floor
   against any of them. */
export function footprint(wall, at, size, room) {
  const W = room.width_cm, D = room.depth_cm, w = size.width, dp = size.depth;
  switch (wall) {
    case 'n': return { x0: at, x1: at + w, z0: 0, z1: dp };
    case 's': return { x0: W - at - w, x1: W - at, z0: D - dp, z1: D };
    case 'e': return { x0: W - dp, x1: W, z0: at, z1: at + w };
    case 'free': {
      const along = at.rot === 90 || at.rot === 270;
      const hx = (along ? dp : w) / 2, hz = (along ? w : dp) / 2, cz = D - at.y;
      return { x0: at.x - hx, x1: at.x + hx, z0: cz - hz, z1: cz + hz };
    }
    default:  return { x0: 0, x1: dp, z0: D - at - w, z1: D - at };
  }
}

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/* The clear floor between two footprints, in whole centimetres: straight
   across when they face each other, corner to corner when they sit on a
   diagonal, 0 when they touch or overlap. */
export function gapBetween(a, b) {
  const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
  const dz = Math.max(0, b.z0 - a.z1, a.z0 - b.z1);
  return Math.round(Math.hypot(dx, dz));
}

/* Where a rack stands, in the shape footprint() takes — { wall, at } — or
   null while it stands nowhere. */
function placeOf(sec, size) {
  if (sec.placement === 'free') {
    if (sec.x_cm == null || sec.y_cm == null || sec.rot_deg == null) return null;
    return { wall: 'free', at: { x: sec.x_cm, y: sec.y_cm, rot: sec.rot_deg } };
  }
  const at = sec.wall == null ? null : wallCmOf(sec, size);
  return at == null ? null : { wall: sec.wall, at };
}

/* Every other rack standing in this room — on a wall or on the floor — with
   its size and where it is. Before 051 this was only the racks with a wall;
   a free rack can collide with anything, so every rack is every rack's
   neighbour now. */
function placedRacks(d, roomId, exceptId) {
  return d.prepare('SELECT * FROM sections WHERE room_id = ? AND id <> ? ORDER BY key')
    .all(roomId, exceptId ?? -1)
    .map((s) => {
      const cols = colsOf(d, s.id);
      const size = rackSize(s, cols);
      const place = placeOf(s, size);
      return { sec: s, cols, size, place, at: place ? place.at : null };
    })
    .filter((r) => r.place != null);
}

/* A rack in a refusal: its name — what is painted on the plate somebody is
   looking at — and its letter. "Overlaps الرف الأيسر (rack A)" is a sentence
   a person can act on; "invalid position" is not. */
const rackWords = (sec) => `${sec.name} (rack ${sec.key})`;

/* THE AISLE RULE for one free-standing footprint: the narrowest gap it leaves
   to a wall or to any rack, and what that gap is to. */
function tightest(mine, others, room) {
  const W = room.width_cm, D = room.depth_cm;
  let best = null;
  const see = (gap, what) => { if (!best || gap < best.gap) best = { gap: Math.round(gap), ...what }; };
  see(mine.x0, { to: 'wall', wall: 'w' });
  see(W - mine.x1, { to: 'wall', wall: 'e' });
  see(mine.z0, { to: 'wall', wall: 'n' });
  see(D - mine.z1, { to: 'wall', wall: 's' });
  for (const o of others) {
    see(gapBetween(mine, footprint(o.place.wall, o.place.at, o.size, room)),
        { to: 'rack', rack: o.sec.key, name: o.sec.name });
  }
  return best;
}

function aisleFail(sec, t, need) {
  const what = t.to === 'wall' ? `the ${WALL_NAME[t.wall]} wall` : rackWords({ name: t.name, key: t.rack });
  return fail(`only ${t.gap} cm from rack ${sec.key} to ${what} — needs ${need} cm`,
              'aisle_narrow', { ...t, need, of: sec.key });
}

/* Does a rack of this size fit at this place, in this room, beside what is
   already there? Refused by name, because the one somebody walks to is the
   one that is not drawn. `place` is { wall, at }, exactly as footprint()
   takes it.

   A measured room checks the rack against its walls and against every other
   rack's floor rectangle — wall or free-standing, every rack against every
   rack. An unmeasured room has no corners and no depth to speak of, so it
   can only check the racks on the same wall, in centimetres along it; and a
   rack cannot stand free in it at all, because there is nothing to measure
   the aisles round it against. */
function checkFit(d, room, sec, place, size, selfId) {
  const measured = room.width_cm != null && room.depth_cm != null;
  const others = placedRacks(d, room.id, selfId);
  const aisle = aisleMin();

  if (place.wall === 'free') {
    if (!measured) {
      throw fail(`rack ${sec.key} can stand free only in a measured room — give ${room.name} a width and a depth first`,
                 'free_unmeasured', { rack: sec.key });
    }
    const mine = footprint('free', place.at, size, room);
    /* A wall rack cannot leave the room by definition; a free one can be
       dragged straight through a wall. */
    const through = mine.x0 < 0 ? 'w' : mine.x1 > room.width_cm ? 'e'
                  : mine.z0 < 0 ? 'n' : mine.z1 > room.depth_cm ? 's' : null;
    if (through) {
      throw fail(`rack ${sec.key} would stand through the ${WALL_NAME[through]} wall`,
                 'outside_room', { rack: sec.key, wall: through });
    }
    for (const o of others) {
      if (overlaps(mine, footprint(o.place.wall, o.place.at, o.size, room))) {
        throw fail(`rack ${sec.key} overlaps ${rackWords(o.sec)}`, 'rack_overlap',
                   { rack: o.sec.key, name: o.sec.name, of: sec.key });
      }
    }
    if (aisle > 0) {
      const t = tightest(mine, others, room);
      if (t && t.gap < aisle) throw aisleFail(sec, t, aisle);
    }
    return;
  }

  const at = place.at, wall = place.wall;
  if (measured) {
    const len = wallLen(wall, room);
    if (at + size.width > len) {
      throw fail(`rack ${sec.key} is ${size.width} cm wide and the ${WALL_NAME[wall]} wall has ` +
                 `${Math.max(0, len - at)} cm left from there`,
                 'wall_short', { rack: sec.key, wall, need: size.width, have: Math.max(0, len - at) });
    }
    const mine = footprint(wall, at, size, room);
    for (const o of others) {
      const theirs = footprint(o.place.wall, o.place.at, o.size, room);
      if (o.place.wall === 'free') {
        if (overlaps(mine, theirs)) {
          throw fail(`rack ${sec.key} would stand in ${rackWords(o.sec)}`, 'rack_overlap',
                     { rack: o.sec.key, name: o.sec.name, of: sec.key });
        }
        /* The aisle is a gap between two things, whichever of them moved. */
        const gap = gapBetween(mine, theirs);
        if (aisle > 0 && gap < aisle) {
          throw aisleFail(sec, { gap, to: 'rack', rack: o.sec.key, name: o.sec.name }, aisle);
        }
        continue;
      }
      if (!overlaps(mine, theirs)) continue;
      const corner = o.sec.wall !== wall;
      throw fail(corner
        ? `rack ${o.sec.key} on the ${WALL_NAME[o.sec.wall]} wall stands in that corner`
        : `rack ${o.sec.key} is already on that wall at ${o.at}–${o.at + o.size.width} cm`,
        'wall_overlap', { rack: o.sec.key, wall: o.sec.wall, from: o.at, to: o.at + o.size.width, corner });
    }
    return;
  }

  for (const o of others) {
    if (o.place.wall !== wall) continue;
    if (at < o.at + o.size.width && o.at < at + size.width) {
      throw fail(`rack ${o.sec.key} is already on that wall at ${o.at}–${o.at + o.size.width} cm`,
                 'wall_overlap', { rack: o.sec.key, wall: o.sec.wall, from: o.at, to: o.at + o.size.width, corner: false });
    }
  }
}

/* Where a rack stands (051): nowhere; on a wall of a room — the room, the
   wall and a position along it; or FREE on the floor of a room — the room,
   x, y and a quarter turn. Checked out loud, because the columns are
   independently nullable, and a row that is half one kind and half the other
   is the bug that costs a day later: a free-standing rack with a wall set is
   refused, and so is a wall rack with a place on the floor.

   `placement` left out means 'wall' — every rack before 051, and every caller
   that has never heard of the floor. A 'wall' rack with no wall is a rack in
   its room that is not placed yet, which is a real state and stays legal. On
   a wall the position is `wallCm` (centimetres, the truth) or the older
   `wallPos` (bays, converted with this rack's own bay width); `wall_pos` is
   returned alongside, derived, so the mirror column and an older restore keep
   meaning what they meant. EVERY placement column comes back, so the caller
   writes all of them and a rack that changes kind keeps nothing of the old. */
function checkPlacement(d, sec, { roomId, placement, wall, wallPos, wallCm, xCm, yCm, rotDeg }, selfId, size) {
  const rid = roomId == null ? null : Number(roomId);
  const kind = placement == null || placement === '' ? 'wall' : String(placement);
  const w = wall == null || wall === '' ? null : String(wall);
  const hasPos = wallCm != null || wallPos != null;
  const hasFloor = xCm != null || yCm != null || rotDeg != null;
  const nowhere = { room_id: null, placement: 'wall', wall: null, wall_pos: null, wall_cm: null,
                    x_cm: null, y_cm: null, rot_deg: null };

  if (!PLACEMENTS.has(kind)) throw fail("placement is 'wall' or 'free'", 'bad_placement');
  if (kind === 'free' && (w != null || hasPos)) {
    throw fail('a free-standing rack has no wall — leave the wall and its position out', 'bad_placement');
  }
  if (kind === 'wall' && hasFloor) {
    throw fail("a rack on a wall has no place on the floor — say placement 'free' to stand it there", 'bad_placement');
  }

  if (rid == null) {
    if (kind === 'free') throw fail('a free-standing rack needs a room to stand in', 'bad_placement');
    if (w != null || hasPos) throw fail('a wall needs a room', 'bad_wall');
    return nowhere;
  }
  const room = d.prepare('SELECT * FROM rooms WHERE id = ?').get(rid);
  if (!room) throw fail('no such room', 'not_found');
  if (room.wh_id !== sec.wh_id) {
    throw fail(`that room is at ${room.wh_id} and rack ${sec.key} is at ${sec.wh_id}`, 'wrong_warehouse');
  }

  if (kind === 'free') {
    if (xCm == null || yCm == null || rotDeg == null) {
      throw fail('a free-standing rack needs where it stands — x and y in centimetres — and which way it turns',
                 'bad_placement');
    }
    const x = Number(xCm), y = Number(yCm), rot = Number(rotDeg);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw fail("a place on the floor is centimetres from the room's left and front walls", 'bad_placement');
    }
    if (!ROTATIONS.includes(rot)) throw fail('a rack turns in quarter turns: 0, 90, 180 or 270', 'bad_rotation');
    const at = { x: Math.round(x), y: Math.round(y), rot };
    checkFit(d, room, sec, { wall: 'free', at }, size, selfId);
    return { ...nowhere, room_id: rid, placement: 'free', x_cm: at.x, y_cm: at.y, rot_deg: rot };
  }

  if ((w == null) !== !hasPos) throw fail('a wall needs a position along it, and a position needs a wall', 'bad_wall');
  if (w == null) return { ...nowhere, room_id: rid };
  if (!WALLS.has(w)) throw fail("a wall is 'n', 'e', 's' or 'w'", 'bad_wall');

  let cm;
  if (wallCm != null) {
    const n = Number(wallCm);
    if (!Number.isFinite(n) || n < 0) {
      throw fail("position is a number of centimetres from the wall's left end", 'bad_wall');
    }
    /* The browser snaps to 5 cm and sends metres × 100; 342.00000000004 is 342. */
    cm = Math.round(n);
  } else {
    const pos = Number(wallPos);
    if (!Number.isInteger(pos) || pos < 0) throw fail('position is a whole number of bays from the left', 'bad_wall');
    cm = pos * size.bay;
  }

  checkFit(d, room, sec, { wall: w, at: cm }, size, selfId);
  return { ...nowhere, room_id: rid, wall: w, wall_cm: cm, wall_pos: Math.round(cm / size.bay) };
}

/* EVERY CLEARANCE ROUND EVERY FREE-STANDING RACK in a room, in centimetres —
   the numbers the aisle rule is about, for a person reading a report and for
   a seed that has to pass its own rule. Empty for an unmeasured room, which
   cannot hold one. */
export function clearances(roomId) {
  const d = DB.get();
  const room = d.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room || room.width_cm == null || room.depth_cm == null) return [];
  const racks = placedRacks(d, roomId, null);
  const need = aisleMin();
  return racks.filter((r) => r.place.wall === 'free').map((r) => {
    const m = footprint('free', r.place.at, r.size, room);
    const walls = { left: Math.round(m.x0), right: Math.round(room.width_cm - m.x1),
                    back: Math.round(m.z0), front: Math.round(room.depth_cm - m.z1) };
    const near = racks.filter((o) => o !== r).map((o) => ({
      key: o.sec.key, name: o.sec.name,
      gap: gapBetween(m, footprint(o.place.wall, o.place.at, o.size, room))
    })).sort((a, b) => a.gap - b.gap);
    const min = Math.min(...Object.values(walls), ...near.map((n) => n.gap));
    return { key: r.sec.key, name: r.sec.name, bays: r.cols, bay_cm: r.size.bay,
             length_cm: r.size.width, depth_cm: r.size.depth, at: r.place.at,
             walls, racks: near, min_cm: min, aisle_min_cm: need, ok: need === 0 || min >= need };
  });
}

/* A rack's measurements, typed. Undefined keeps what is there, null or blank
   means the standard rack, anything else is a whole number of centimetres
   inside RACK_LIMITS — a 5 cm bay or a 9 m one is a slipped finger. */
function checkRackSize({ bayCm, levelCm, depthCm }, prev) {
  const num = (v, was, lim, what) => {
    if (v === undefined) return was;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n)) throw fail(`${what} is a whole number of centimetres`, 'bad_request');
    if (n < lim[0] || n > lim[1]) throw fail(`${what} is between ${lim[0]} and ${lim[1]} cm`, 'bad_request');
    return n;
  };
  return {
    bay_cm:   num(bayCm,   prev.bay_cm,   RACK_LIMITS.bay,   'a bay'),
    level_cm: num(levelCm, prev.level_cm, RACK_LIMITS.level, 'a level'),
    depth_cm: num(depthCm, prev.depth_cm, RACK_LIMITS.depth, 'the depth')
  };
}

export function createSection({ whId, key, name, sortIndex = null, gridOrigin = 'left',
                                roomId = null, wall = null, wallPos = null, wallCm = null,
                                placement = null, xCm = null, yCm = null, rotDeg = null,
                                bayCm, levelCm, depthCm, rows = null, cols = null, userId = null }) {
  if (typeof whId !== 'string' || !whId.trim()) throw fail('which warehouse?', 'bad_request');
  const k = String(key ?? '').trim().toUpperCase();
  if (!/^[A-Z]$/.test(k)) {
    throw fail('a rack letter is one Latin letter — it goes on every barcode', 'bad_key');
  }
  const nm = String(name ?? '').trim();
  if (!nm) throw fail('a rack needs a name', 'bad_request');
  if (gridOrigin !== 'left' && gridOrigin !== 'right') {
    throw fail("grid origin is 'left' or 'right'", 'bad_request');
  }

  return DB.tx((d) => {
    if (!d.prepare('SELECT id FROM warehouses WHERE id = ?').get(whId)) {
      throw fail(`no such warehouse: ${whId}`, 'not_found');
    }
    /* The letters can run out, and now that racks are counted per warehouse
       across every room it is plausible. Named before the duplicate check,
       so the message is about the real problem. */
    const used = d.prepare('SELECT COUNT(*) AS n FROM sections WHERE wh_id = ?').get(whId).n;
    if (used >= 26) {
      throw fail(`every letter A–Z is already a rack at ${whId}. A rack letter rides inside ` +
                 `every printed barcode, so there is no twenty-seventh one.`, 'no_letters_left');
    }
    if (d.prepare('SELECT id FROM sections WHERE wh_id = ? AND key = ?').get(whId, k)) {
      throw fail(`${whId} already has a rack ${k}`, 'duplicate_key');
    }

    const at = DB.nowIso();
    /* Left out, a new rack goes at the end of the walk rather than at the
       front — the manager adds them in the order he thinks of them. */
    const sort = sortIndex == null
      ? (d.prepare('SELECT COALESCE(MAX(sort_index), 0) AS m FROM sections WHERE wh_id = ?').get(whId).m + 1)
      : Number(sortIndex);
    if (!Number.isFinite(sort)) throw fail('order must be a number', 'bad_request');

    /* A RACK TAKES ITS ROOM'S BAY. Stage B's seed stood the middle rack on the
       server's standard 114 cm beside wall racks of 92, and a rack a different
       size from its neighbours is wrong for as long as it stands. A rack made
       in a room, with no width of its own, gets the width the racks already
       there share; a room with none yet has nothing to agree with, and a width
       typed in is still taken as typed. */
    const blank = (v) => v === undefined || v === null || v === '';
    let bay = bayCm, level = levelCm, depth = depthCm;
    if (roomId != null && roomId !== '' && (blank(bay) || blank(level) || blank(depth))) {
      const shared = roomSizeCm(d, Number(roomId));
      if (shared) {
        if (blank(bay)) bay = shared.bay;
        if (blank(level)) level = shared.level;
        if (blank(depth)) depth = shared.depth;
      }
    }
    const dims = checkRackSize({ bayCm: bay, levelCm: level, depthCm: depth },
                               { bay_cm: null, level_cm: null, depth_cm: null });
    /* A rack placed from inside the room arrives WITH its grid, in this one
       transaction: checked at the width and height it will actually stand at
       — the fit, the aisle, the ceiling — and a refusal leaves no one-bay stub
       behind to be tidied up. */
    const grid = rows == null && cols == null ? null : checkGrid(rows, cols);
    const size = rackSize(dims, grid ? grid.cols : 1);
    const place = checkPlacement(d, { wh_id: whId, key: k, name: nm },
                                 { roomId, placement, wall, wallPos, wallCm, xCm, yCm, rotDeg }, -1, size);
    if (grid && place.room_id != null) {
      checkHeight(d.prepare('SELECT * FROM rooms WHERE id = ?').get(place.room_id), { key: k }, grid.rows, size.level);
    }

    const info = d.prepare(
      `INSERT INTO sections (wh_id, key, name, sort_index, grid_origin, room_id, wall, wall_pos, wall_cm,
                             placement, x_cm, y_cm, rot_deg,
                             bay_cm, level_cm, depth_cm, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(whId, k, nm, sort, gridOrigin, place.room_id, place.wall, place.wall_pos, place.wall_cm,
          place.placement, place.x_cm, place.y_cm, place.rot_deg,
          dims.bay_cm, dims.level_cm, dims.depth_cm, at, at);

    const id = Number(info.lastInsertRowid);
    DB.logChange('sections', id, 'insert', userId, null);
    if (grid) {
      const ins = d.prepare(`INSERT INTO shelves (section_id, code, row_label, col_index, created_at, updated_at)
                             VALUES (?,?,?,?,?,?)`);
      for (let i = 0; i < grid.rows; i++) {
        for (let j = 1; j <= grid.cols; j++) {
          const sh = ins.run(id, ROW_LETTERS[i] + j, ROW_LETTERS[i], j, at, at);
          DB.logChange('shelves', Number(sh.lastInsertRowid), 'insert', userId, null);
        }
      }
    }
    return d.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  });
}

/* Rename, reorder, flip which end you walk in from, move it to a wall. The
   key is deliberately NOT editable: it is printed inside every shelf barcode
   on the rack, so changing it would invalidate every label at once. Make a
   new rack. Moving a rack to another wall invalidates nothing — the barcode
   says which rack, not where it stands. */
export function updateSection(id, { name, sortIndex, gridOrigin, roomId, wall, wallPos, wallCm,
                                    placement, xCm, yCm, rotDeg,
                                    bayCm, levelCm, depthCm }, userId = null) {
  return DB.tx((d) => {
    const sec = d.prepare('SELECT * FROM sections WHERE id = ?').get(id);
    if (!sec) throw fail('no such rack', 'not_found');

    const next = {
      name: name === undefined ? sec.name : String(name).trim(),
      sort_index: sortIndex === undefined ? sec.sort_index : Number(sortIndex),
      grid_origin: gridOrigin === undefined ? sec.grid_origin : gridOrigin
    };
    if (!next.name) throw fail('a rack needs a name', 'bad_request');
    /* NaN reaches the NOT NULL column as a null and fails there, with a message
       about a constraint rather than about what was typed. */
    if (!Number.isFinite(next.sort_index)) throw fail('order must be a number', 'bad_request');
    if (next.grid_origin !== 'left' && next.grid_origin !== 'right') {
      throw fail("grid origin is 'left' or 'right'", 'bad_request');
    }

    const dims = checkRackSize({ bayCm, levelCm, depthCm }, sec);
    const cols = colsOf(d, id);
    const size = rackSize(dims, cols);
    const resized = dims.bay_cm !== sec.bay_cm || dims.level_cm !== sec.level_cm ||
                    dims.depth_cm !== sec.depth_cm;

    /* Placement is patched as a unit: any of them given means all are being
       set, and an omitted one is "clear it", not "keep it" — a rack moved to
       a new room must not keep the wall position of the old one. */
    const moving = roomId !== undefined || wall !== undefined ||
                   wallPos !== undefined || wallCm !== undefined ||
                   placement !== undefined || xCm !== undefined || yCm !== undefined || rotDeg !== undefined;
    let place;
    if (moving) {
      place = checkPlacement(d, sec, { roomId, placement, wall, wallPos, wallCm, xCm, yCm, rotDeg }, id, size);
    } else {
      const free = sec.placement === 'free';
      const at = free ? null : wallCmOf(sec, size);
      place = {
        room_id: sec.room_id, placement: free ? 'free' : 'wall', wall: free ? null : sec.wall, wall_cm: at,
        /* Re-derived: a wider bay is fewer bays along the same wall. */
        wall_pos: at == null ? null : Math.round(at / size.bay),
        x_cm: free ? sec.x_cm : null, y_cm: free ? sec.y_cm : null, rot_deg: free ? sec.rot_deg : null
      };
      /* A rack made bigger where it stands has to still fit where it
         stands — on its wall or on the floor. Refused rather than slid
         along — the manager put it there, and a rack that moves on its own
         is one somebody walks to twice. */
      const where = placeOf(sec, size);
      if (resized && sec.room_id != null && where) {
        const room = d.prepare('SELECT * FROM rooms WHERE id = ?').get(sec.room_id);
        if (room) checkFit(d, room, sec, where, size, id);
      }
    }

    /* The ceiling, for a rack made taller where it stands or brought into a
       room with a height. A rename is never refused for a rack that was
       already too tall — the same rule the floor keeps. */
    if (place.room_id != null && (resized || (moving && place.room_id !== sec.room_id))) {
      checkHeight(d.prepare('SELECT * FROM rooms WHERE id = ?').get(place.room_id), sec, levelsOf(d, id), size.level);
    }

    d.prepare(`UPDATE sections SET name = ?, sort_index = ?, grid_origin = ?,
                                   room_id = ?, wall = ?, wall_pos = ?, wall_cm = ?,
                                   placement = ?, x_cm = ?, y_cm = ?, rot_deg = ?,
                                   bay_cm = ?, level_cm = ?, depth_cm = ?, updated_at = ?
                WHERE id = ?`)
      .run(next.name, next.sort_index, next.grid_origin,
           place.room_id, place.wall, place.wall_pos, place.wall_cm,
           place.placement, place.x_cm, place.y_cm, place.rot_deg,
           dims.bay_cm, dims.level_cm, dims.depth_cm, DB.nowIso(), id);
    DB.logChange('sections', id, 'update', userId, null);
    return d.prepare('SELECT * FROM sections WHERE id = ?').get(id);
  });
}

export function deleteSection(id, userId = null) {
  return DB.tx((d) => {
    const sec = d.prepare('SELECT * FROM sections WHERE id = ?').get(id);
    if (!sec) throw fail('no such rack', 'not_found');

    const n = d.prepare('SELECT COUNT(*) AS n FROM shelves WHERE section_id = ?').get(id).n;
    if (n) {
      throw fail(`${sec.key} still has ${n} shelf/shelves — remove them first`,
                 'section_not_empty', { shelves: n });
    }

    d.prepare('DELETE FROM sections WHERE id = ?').run(id);
    DB.logChange('sections', id, 'delete', userId, null);
    return { id, deleted: true };
  });
}

/* ------------------------------------------------------------------ rooms
   The thing with walls. A room has a name and, optionally, a tape measure's
   worth of numbers; it has no letter and appears in no barcode. */

export function rooms({ whId = null } = {}) {
  const d = DB.get();
  return whId
    ? d.prepare('SELECT * FROM rooms WHERE wh_id = ? ORDER BY sort_index, name').all(whId)
    : d.prepare('SELECT * FROM rooms ORDER BY wh_id, sort_index, name').all();
}

/* Both footprint numbers or neither. Height on its own is allowed — a
   manager with a tape measure does the floor first, and a measured floor
   under an unmeasured ceiling is a normal state of affairs. */
function checkDims({ widthCm, depthCm, heightCm }, prev) {
  const num = (v, was) => {
    if (v === undefined) return was;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw fail('a measurement is a whole number of centimetres', 'bad_request');
    if (n > MAX_ROOM_CM) throw fail(`a room is at most ${MAX_ROOM_CM / 100} m a side`, 'bad_request');
    return n;
  };
  const out = {
    width_cm: num(widthCm, prev.width_cm),
    depth_cm: num(depthCm, prev.depth_cm),
    height_cm: num(heightCm, prev.height_cm)
  };
  if ((out.width_cm == null) !== (out.depth_cm == null)) {
    throw fail('a room is measured as width AND depth, or not at all', 'bad_request');
  }
  return out;
}

export function createRoom({ whId, name, sortIndex = null, widthCm, depthCm, heightCm, userId = null }) {
  if (typeof whId !== 'string' || !whId.trim()) throw fail('which warehouse?', 'bad_request');
  const nm = String(name ?? '').trim();
  if (!nm) throw fail('a room needs a name', 'bad_request');
  const dims = checkDims({ widthCm, depthCm, heightCm }, { width_cm: null, depth_cm: null, height_cm: null });

  return DB.tx((d) => {
    if (!d.prepare('SELECT id FROM warehouses WHERE id = ?').get(whId)) {
      throw fail(`no such warehouse: ${whId}`, 'not_found');
    }
    const at = DB.nowIso();
    const sort = sortIndex == null
      ? (d.prepare('SELECT COALESCE(MAX(sort_index), 0) AS m FROM rooms WHERE wh_id = ?').get(whId).m + 1)
      : Number(sortIndex);
    if (!Number.isFinite(sort)) throw fail('order must be a number', 'bad_request');

    const info = d.prepare(
      `INSERT INTO rooms (wh_id, name, sort_index, width_cm, depth_cm, height_cm, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(whId, nm, sort, dims.width_cm, dims.depth_cm, dims.height_cm, at, at);
    const id = Number(info.lastInsertRowid);
    DB.logChange('rooms', id, 'insert', userId, null);
    return d.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  });
}

export function updateRoom(id, { name, sortIndex, widthCm, depthCm, heightCm }, userId = null) {
  return DB.tx((d) => {
    const room = d.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) throw fail('no such room', 'not_found');
    const nm = name === undefined ? room.name : String(name).trim();
    if (!nm) throw fail('a room needs a name', 'bad_request');
    const sort = sortIndex === undefined ? room.sort_index : Number(sortIndex);
    if (!Number.isFinite(sort)) throw fail('order must be a number', 'bad_request');
    const dims = checkDims({ widthCm, depthCm, heightCm }, room);

    /* A rack standing on the floor is measured from the walls; a room that
       stops being measured leaves it standing nowhere anybody could say. */
    if (dims.width_cm == null) {
      const free = d.prepare(`SELECT key FROM sections WHERE room_id = ? AND placement = 'free' ORDER BY key`)
                    .all(id).map((r) => r.key);
      if (free.length) {
        throw fail(`rack${free.length > 1 ? 's' : ''} ${free.join(', ')} stand${free.length > 1 ? '' : 's'} free in ` +
                   `${nm} — a room with a rack on its floor keeps its width and depth`,
                   'free_unmeasured', { racks: free });
      }
    }

    /* A LOWER CEILING over racks already standing is refused, naming them and
       how tall they are. Levels are never taken away to make a room fit, for
       the reason bays are not: a level may hold stock and printed labels. */
    if (dims.height_cm != null && dims.height_cm !== room.height_cm) {
      const tall = d.prepare('SELECT * FROM sections WHERE room_id = ? ORDER BY key').all(id)
        .map((s) => {
          const levels = levelsOf(d, s.id);
          return { key: s.key, levels, height_cm: rackHeight(levels, rackSize(s, 1).level) };
        })
        .filter((s) => s.levels > 0 && s.height_cm > dims.height_cm);
      if (tall.length) {
        const need = Math.max(...tall.map((s) => s.height_cm));
        throw fail(`rack${tall.length > 1 ? 's' : ''} ${tall.map((s) => s.key).join(', ')} ` +
                   `stand${tall.length > 1 ? '' : 's'} up to ${need} cm tall — ${nm} needs at least that height`,
                   'room_too_low', { racks: tall, min_height_cm: need });
      }
    }

    /* Only when the floor actually changes. A rename must not be refused for
       a rack that was already hanging off the end of the wall. */
    const floorMoved = dims.width_cm != null &&
                       (dims.width_cm !== room.width_cm || dims.depth_cm !== room.depth_cm);
    const shrunk = floorMoved ? fitRoom(d, room, dims, userId) : [];

    d.prepare(`UPDATE rooms SET name = ?, sort_index = ?, width_cm = ?, depth_cm = ?, height_cm = ?,
                                updated_at = ? WHERE id = ?`)
      .run(nm, sort, dims.width_cm, dims.depth_cm, dims.height_cm, DB.nowIso(), id);
    DB.logChange('rooms', id, 'update', userId, null);
    return { ...d.prepare('SELECT * FROM rooms WHERE id = ?').get(id), shrunk };
  });
}

/* Make the racks fit the room the room is about to become — or refuse.

   A rack that no longer fits along its wall has its BAYS SCALED DOWN, never
   removed: a bay may hold stock and carry printed labels, and removeShelves
   refuses exactly that. Floored at BAY_MIN; a rack that cannot fit even at
   the minimum stops the whole resize, naming itself and the smallest room
   that would do. Nothing is written unless everything fits, so a refusal
   leaves every rack exactly as it was — the caller's transaction sees to it.

   Two racks that would then stand through each other — nose to nose across
   a room now too shallow for both, or in a corner — are refused rather than
   moved. Moving a rack is the manager's decision; this only ever makes one
   narrower where it stands. */
function fitRoom(d, room, dims, userId) {
  const next = { ...room, ...dims };
  const racks = placedRacks(d, room.id, null);
  const shrunk = [], stuck = [];
  let minW = next.width_cm, minD = next.depth_cm;
  const wantW = (n) => { minW = Math.max(minW, n); };
  const wantD = (n) => { minD = Math.max(minD, n); };
  const want = (wall, n) => (wall === 'n' || wall === 's' ? wantW(n) : wantD(n));

  for (const r of racks) {
    if (r.place.wall === 'free') continue;   /* not on a wall: see the free racks below */
    const len = wallLen(r.sec.wall, next);
    if (r.at + r.size.width <= len) continue;
    const bayFit = Math.floor((len - r.at) / r.cols);
    if (bayFit >= BAY_MIN) {
      shrunk.push({ id: r.sec.id, key: r.sec.key, wall: r.sec.wall, from: r.size.bay, to: bayFit });
      r.size = rackSize({ ...r.sec, bay_cm: bayFit }, r.cols);
    } else {
      const need = r.at + r.cols * BAY_MIN;
      stuck.push({ key: r.sec.key, wall: r.sec.wall, need_cm: need });
      want(r.sec.wall, need);
    }
  }

  for (let i = 0; i < racks.length; i++) {
    for (let j = i + 1; j < racks.length; j++) {
      const a = racks[i], b = racks[j];
      if (a.place.wall === 'free' || b.place.wall === 'free') continue;
      if (!overlaps(footprint(a.sec.wall, a.at, a.size, next), footprint(b.sec.wall, b.at, b.size, next))) continue;
      const facing = (a.sec.wall === 'n' && b.sec.wall === 's') || (a.sec.wall === 's' && b.sec.wall === 'n') ||
                     (a.sec.wall === 'e' && b.sec.wall === 'w') || (a.sec.wall === 'w' && b.sec.wall === 'e');
      if (facing) {
        /* Two depths, and a person has to walk between them. */
        const need = a.size.depth + b.size.depth + 60;
        if (a.sec.wall === 'n' || a.sec.wall === 's') wantD(need); else wantW(need);
        stuck.push({ key: a.sec.key, wall: a.sec.wall, with: b.sec.key, need_cm: need });
      } else if (a.sec.wall === b.sec.wall) {
        /* Side by side and already crossing before this change; the wall
           just has to be as long as both. */
        const need = Math.max(a.at + a.size.width, b.at + b.size.width);
        want(a.sec.wall, need);
        stuck.push({ key: a.sec.key, wall: a.sec.wall, with: b.sec.key, need_cm: need });
      } else {
        /* A corner: the rack along the wall has to end before the other
           rack's depth begins, on whichever wall it is on. */
        const side = a.sec.wall === 'n' || a.sec.wall === 's' ? a : b;   /* on the width */
        const end  = side === a ? b : a;                                 /* on the depth */
        const sideEnd = side.at + side.size.width, endEnd = end.at + end.size.width;
        wantW(sideEnd + end.size.depth);
        wantD(endEnd + side.size.depth);
        stuck.push({ key: side.sec.key, wall: side.sec.wall, with: end.sec.key, need_cm: sideEnd + end.size.depth });
      }
    }
  }

  /* A FREE-STANDING RACK DOES NOT MOVE WHEN A WALL DOES. It is measured from
     the left and front walls, so shrinking the room from the right or the
     back brings those walls — and the racks on them — towards it. It must
     still stand inside, clear of every rack, and keep its aisle; if not, the
     resize is refused like any other, with the room that would do: past the
     rack's right and back sides by the aisle, and by the depth of any rack on
     the right or back wall too. */
  const aisle = aisleMin();
  for (const r of racks) {
    if (r.place.wall !== 'free') continue;
    const mine = footprint('free', r.place.at, r.size, next);
    const others = racks.filter((o) => o !== r);
    const inside = mine.x0 >= 0 && mine.x1 <= next.width_cm && mine.z0 >= 0 && mine.z1 <= next.depth_cm;
    const hit = others.find((o) => overlaps(mine, footprint(o.place.wall, o.place.at, o.size, next)));
    const t = tightest(mine, others, next);
    if (inside && !hit && !(aisle > 0 && t && t.gap < aisle)) continue;
    const deepest = (wall) => Math.max(0, ...others.filter((o) => o.place.wall === wall).map((o) => o.size.depth));
    wantW(Math.ceil(mine.x1 + aisle + deepest('e')));
    wantD(Math.ceil(r.place.at.y + (mine.z1 - mine.z0) / 2 + aisle + deepest('n')));
    stuck.push({ key: r.sec.key, wall: 'free', with: hit ? hit.sec.key : (t && t.rack) || null, need_cm: null });
  }

  if (stuck.length) {
    const names = [...new Set(stuck.map((s) => s.key))];
    throw fail(
      `rack${names.length > 1 ? 's' : ''} ${names.join(', ')} would not fit — ` +
      `this room needs at least ${minW} × ${minD} cm for what is in it`,
      'room_too_small', { racks: stuck, min_width_cm: minW, min_depth_cm: minD }
    );
  }

  const at = DB.nowIso();
  for (const s of shrunk) {
    const r = racks.find((x) => x.sec.id === s.id);
    d.prepare('UPDATE sections SET bay_cm = ?, wall_pos = ?, updated_at = ? WHERE id = ?')
      .run(s.to, Math.round(r.at / s.to), at, s.id);
    DB.logChange('sections', s.id, 'update', userId, null);
  }
  return shrunk.map((s) => ({ key: s.key, wall: s.wall, from: s.from, to: s.to }));
}

/* A room with racks in it refuses, naming them: "M still has 0 shelves" is
   not a sentence anybody can act on when the problem is that M and N are
   inside it. Move them out — or out of the room — first. */
export function deleteRoom(id, userId = null) {
  return DB.tx((d) => {
    const room = d.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
    if (!room) throw fail('no such room', 'not_found');
    const racks = d.prepare('SELECT key FROM sections WHERE room_id = ? ORDER BY key').all(id);
    if (racks.length) {
      throw fail(`${room.name} still holds rack${racks.length > 1 ? 's' : ''} ` +
                 `${racks.map((r) => r.key).join(', ')} — move them out first`,
                 'room_not_empty', { racks: racks.map((r) => r.key) });
    }
    d.prepare('DELETE FROM rooms WHERE id = ?').run(id);
    DB.logChange('rooms', id, 'delete', userId, null);
    return { id, deleted: true };
  });
}

/* ------------------------------------------------------------------- grid */

/* Seed a room with rows A..n and columns 1..m.

   IDEMPOTENT ON CODE, AND IT NEVER DELETES. An existing shelf is left exactly
   as it is — its assignment, its capacity, and any stock pointing at it. The
   shop is inventing this layout for the first time and will run it more than
   once; running it again with a bigger grid must add only what is new.

   One consequence worth knowing: a shelf deliberately deleted because there
   is a door where B4 would be comes BACK if this is re-run over that range.
   The response names every code it created, so it is visible rather than
   silent — but growth is better done with the row and column routes below. */
export function seedGrid(sectionId, { rows, cols, capacity = null }, userId = null) {
  const r = Number(rows), c = Number(cols);
  if (!Number.isInteger(r) || r < 1) throw fail('rows must be a whole number', 'bad_request');
  if (!Number.isInteger(c) || c < 1) throw fail('columns must be a whole number', 'bad_request');
  if (r > ROW_LETTERS.length) {
    throw fail(`${ROW_LETTERS.length} rows is the most this can label A–Z`, 'too_many_rows');
  }
  if (c > MAX_COLS) throw fail(`${MAX_COLS} bays is the most`, 'too_many_cols');
  const cap = capacity == null ? null : Number(capacity);
  if (cap != null && (!Number.isInteger(cap) || cap < 1)) {
    throw fail('capacity is a whole number of boxes, or nothing at all', 'bad_request');
  }

  return DB.tx((d) => {
    const sec = d.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
    if (!sec) throw fail('no such section', 'not_found');

    const have = new Set(
      d.prepare('SELECT code FROM shelves WHERE section_id = ?').all(sectionId).map((x) => x.code)
    );
    const at = DB.nowIso();
    const ins = d.prepare(
      `INSERT INTO shelves (section_id, code, row_label, col_index, capacity, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    );

    const created = [], existed = [];
    for (let i = 0; i < r; i++) {
      const letter = ROW_LETTERS[i];
      for (let j = 1; j <= c; j++) {
        const code = letter + j;
        if (have.has(code)) { existed.push(code); continue; }
        const info = ins.run(sectionId, code, letter, j, cap, at, at);
        DB.logChange('shelves', Number(info.lastInsertRowid), 'insert', userId, null);
        created.push(code);
      }
    }

    /* A placed rack the seed made wider still has to fit where it stands —
       the same check a bay added by hand gets (editCols). This was skipped
       before 051, which let a grid run a wall rack off the end of its wall;
       on the floor it would let one grow through its neighbour. Throwing here
       rolls the whole seed back. */
    if (created.length && sec.room_id != null) {
      const room = d.prepare('SELECT * FROM rooms WHERE id = ?').get(sec.room_id);
      const size = rackSize(sec, colsOf(d, sectionId));
      const where = placeOf(sec, size);
      if (room && where) checkFit(d, room, sec, where, size, sectionId);
      checkHeight(room, sec, levelsOf(d, sectionId), size.level);
    }

    return { section: sec.key, created, existed };
  });
}

/* Add a row at the end, or take one out.

   ADDING extends past the highest letter in use rather than filling the first
   gap: a gap is a door or a pillar, and a new rack goes at the end of the
   room. REMOVING never renumbers what is left — take B out and the rows stay
   A, C, D. Renumbering would silently invalidate every printed label in the
   room, which is the single most destructive thing this feature could do. */
export function editRows(sectionId, { action, row = null, cols = null, count = 1, last = null }, userId = null) {
  return DB.tx((d) => {
    const sec = d.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
    if (!sec) throw fail('no such section', 'not_found');

    if (action === 'add') {
      const used = d.prepare('SELECT DISTINCT row_label FROM shelves WHERE section_id = ?')
                    .all(sectionId).map((x) => x.row_label);
      const n = howMany(count);
      const top = used.length ? used.slice().sort().pop() : null;
      const nextIdx = top ? ROW_LETTERS.indexOf(top) + 1 : 0;
      if (nextIdx < 0 || nextIdx + n > ROW_LETTERS.length) {
        throw fail(`${sec.key} has reached level Z`, 'too_many_rows');
      }
      const letters = ROW_LETTERS.slice(nextIdx, nextIdx + n);
      if (sec.room_id != null) {
        checkHeight(d.prepare('SELECT * FROM rooms WHERE id = ?').get(sec.room_id), sec,
                    used.length + n, rackSize(sec, 1).level);
      }

      let columns = d.prepare('SELECT DISTINCT col_index FROM shelves WHERE section_id = ? ORDER BY col_index')
                     .all(sectionId).map((x) => x.col_index);
      if (!columns.length) {
        const c = Number(cols);
        if (!Number.isInteger(c) || c < 1) {
          throw fail(`${sec.key} has no bays yet — say how many, or lay out the grid first`,
                     'no_columns');
        }
        if (c > MAX_COLS) throw fail(`${MAX_COLS} bays is the most`, 'too_many_cols');
        columns = Array.from({ length: c }, (_, i) => i + 1);
      }

      const at = DB.nowIso();
      const ins = d.prepare(
        `INSERT INTO shelves (section_id, code, row_label, col_index, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`
      );
      const created = [];
      for (const letter of letters) {
        for (const j of columns) {
          const info = ins.run(sectionId, letter + j, letter, j, at, at);
          DB.logChange('shelves', Number(info.lastInsertRowid), 'insert', userId, null);
          created.push(letter + j);
        }
      }
      return { section: sec.key, row: letters[0], rows: letters, created };
    }

    if (action === 'remove') {
      /* One named level, or — from a handle in the room — the lowest `last`
         of them, which is where levels are added. Every one of them has to be
         empty or none goes. */
      let letters;
      if (last != null) {
        const n = howMany(last);
        const used = d.prepare('SELECT DISTINCT row_label FROM shelves WHERE section_id = ? ORDER BY row_label')
                      .all(sectionId).map((x) => x.row_label);
        if (n >= used.length) throw fail(`${sec.key} keeps at least one level — delete the rack instead`, 'bad_request');
        letters = used.slice(used.length - n);
      } else {
        const letter = String(row ?? '').trim().toUpperCase();
        if (!letter) throw fail('which row?', 'bad_request');
        letters = [letter];
      }
      const doomed = d.prepare(
        `SELECT * FROM shelves WHERE section_id = ? AND row_label IN (${letters.map(() => '?').join(',')})
          ORDER BY row_label, col_index`
      ).all(sectionId, ...letters);
      if (!doomed.length) throw fail(`${sec.key} has no level ${letters.join(', ')}`, 'not_found');
      return removeShelves(d, sec, doomed, userId, `level ${letters.join(', ')}`);
    }

    throw fail("action is 'add' or 'remove'", 'bad_request');
  });
}

export function editCols(sectionId, { action, col = null, count = 1, last = null }, userId = null) {
  return DB.tx((d) => {
    const sec = d.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
    if (!sec) throw fail('no such section', 'not_found');

    if (action === 'add') {
      const rows = d.prepare('SELECT DISTINCT row_label FROM shelves WHERE section_id = ? ORDER BY row_label')
                    .all(sectionId).map((x) => x.row_label);
      if (!rows.length) throw fail(`${sec.key} has no levels yet — lay out the grid first`, 'no_rows');

      const n = howMany(count);
      const next = d.prepare('SELECT COALESCE(MAX(col_index), 0) AS m FROM shelves WHERE section_id = ?')
                    .get(sectionId).m + 1;
      if (next + n - 1 > MAX_COLS) throw fail(`${MAX_COLS} bays is the most`, 'too_many_cols');

      /* A bay is a bay's width of wall, or of floor. A placed rack has to
         still fit with the new ones — the same check as placing it, that much
         wider; on the floor it grows both ways from its centre. */
      if (sec.room_id != null) {
        const room = d.prepare('SELECT * FROM rooms WHERE id = ?').get(sec.room_id);
        const size = rackSize(sec, next + n - 1);
        const where = placeOf(sec, size);
        if (room && where) checkFit(d, room, sec, where, size, sectionId);
      }

      const at = DB.nowIso();
      const ins = d.prepare(
        `INSERT INTO shelves (section_id, code, row_label, col_index, created_at, updated_at)
         VALUES (?,?,?,?,?,?)`
      );
      const created = [], added = [];
      for (let c = next; c < next + n; c++) {
        added.push(c);
        for (const letter of rows) {
          const info = ins.run(sectionId, letter + c, letter, c, at, at);
          DB.logChange('shelves', Number(info.lastInsertRowid), 'insert', userId, null);
          created.push(letter + c);
        }
      }
      return { section: sec.key, col: next, cols: added, created };
    }

    if (action === 'remove') {
      /* One named bay, or — from a handle in the room — the last `last` of
         them, the end a rack grows from. All empty, or none goes. */
      let js;
      if (last != null) {
        const n = howMany(last);
        const used = d.prepare('SELECT DISTINCT col_index FROM shelves WHERE section_id = ? ORDER BY col_index')
                      .all(sectionId).map((x) => x.col_index);
        if (n >= used.length) throw fail(`${sec.key} keeps at least one bay — delete the rack instead`, 'bad_request');
        js = used.slice(used.length - n);
      } else {
        const j = Number(col);
        if (!Number.isInteger(j) || j < 1) throw fail('which column?', 'bad_request');
        js = [j];
      }
      const doomed = d.prepare(
        `SELECT * FROM shelves WHERE section_id = ? AND col_index IN (${js.map(() => '?').join(',')})
          ORDER BY col_index, row_label`
      ).all(sectionId, ...js);
      if (!doomed.length) throw fail(`${sec.key} has no bay ${js.join(', ')}`, 'not_found');
      return removeShelves(d, sec, doomed, userId, `bay ${js.join(', ')}`);
    }

    throw fail("action is 'add' or 'remove'", 'bad_request');
  });
}

/* Remove a set of shelves, or none of them.

   A PARTIAL ROW REMOVAL IS WORSE THAN A REFUSED ONE: it leaves a room whose
   map no longer matches either the labels on the racks or what the manager
   thought he did. So every shelf is checked before any is touched, and the
   refusal names the ones in the way — "B3 and B7 still have shoes on them" is
   something a person can act on. */
function removeShelves(d, sec, shelves, userId, what) {
  const blocked = [];
  for (const sh of shelves) {
    const o = occupancy(d, sh.id);
    if (o.pieces > 0) {
      blocked.push({ code: sh.code, full_code: fullCode(sec.key, sh.code), pieces: o.pieces,
                     row: sh.row_label, col: sh.col_index });
    }
  }
  if (blocked.length) {
    /* REFUSED, NEVER TIDIED. Moving the pairs somewhere else so the bay can
       go is how pairs get lost; the owner chose refusal. So the answer says
       what is in the way per bay and per level, with the count, and the
       person goes and empties it. */
    const sum = (k) => {
      const m = new Map();
      for (const b of blocked) m.set(b[k], (m.get(b[k]) || 0) + b.pieces);
      return [...m.entries()].map(([key, pieces]) => ({ [k]: key, pieces }));
    };
    throw fail(
      `${what} cannot go: ${blocked.map((b) => `${b.full_code} has ${b.pieces}`).join(', ')}`,
      'shelf_occupied', { blocked, bays: sum('col'), levels: sum('row'), rack: sec.key }
    );
  }

  const removed = [];
  for (const sh of shelves) {
    /* Rows pointing here can only be empty ones by now — a remembered
       location for a size that has sold out. The shelf is going, so the
       location goes with it, and the stock row stays exactly where it is. */
    const orphans = d.prepare('SELECT sku, wh_id FROM stock WHERE shelf_id = ?').all(sh.id);
    for (const o of orphans) {
      d.prepare('UPDATE stock SET shelf_id = NULL WHERE sku = ? AND wh_id = ?').run(o.sku, o.wh_id);
      DB.logChange('stock', `${o.sku}:${o.wh_id}`, 'update', userId, null);
    }
    d.prepare('DELETE FROM shelves WHERE id = ?').run(sh.id);
    DB.logChange('shelves', sh.id, 'delete', userId, null);
    removed.push(fullCode(sec.key, sh.code));
  }

  return { section: sec.key, removed, cleared: removed.length };
}

/* ---------------------------------------------------------------- shelves */

/* One shelf at a given row and column — how a rack goes back where a door
   used to be, and the only way to fill a gap the grid seeder skips over. */
export function createShelf({ sectionId, rowLabel, colIndex, capacity = null, userId = null }) {
  const letter = String(rowLabel ?? '').trim().toUpperCase();
  const j = Number(colIndex);
  if (!/^[A-Z]$/.test(letter)) throw fail('a row is one Latin letter, A to Z', 'bad_code');
  if (!Number.isInteger(j) || j < 1 || j > MAX_COLS) {
    throw fail(`a column is a whole number from 1 to ${MAX_COLS}`, 'bad_code');
  }
  const cap = capacity == null ? null : Number(capacity);
  if (cap != null && (!Number.isInteger(cap) || cap < 1)) {
    throw fail('capacity is a whole number of boxes, or nothing at all', 'bad_request');
  }

  return DB.tx((d) => {
    const sec = d.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId);
    if (!sec) throw fail('no such section', 'not_found');

    const code = letter + j;
    if (d.prepare('SELECT id FROM shelves WHERE section_id = ? AND code = ?').get(sectionId, code)) {
      throw fail(`${sec.key} already has a ${code}`, 'duplicate_code');
    }

    const at = DB.nowIso();
    const info = d.prepare(
      `INSERT INTO shelves (section_id, code, row_label, col_index, capacity, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(sectionId, code, letter, j, cap, at, at);

    const id = Number(info.lastInsertRowid);
    DB.logChange('shelves', id, 'insert', userId, null);
    return shelfRow(d, id);
  });
}

/* Rename the code, set the capacity, set or clear the assignment.

   TWO CHANGES HERE INVALIDATE PAPER, and both stop and ask before doing
   anything unless `force` is set:

     - renaming the code: the shelf's own label now names a shelf that is not
       this one.
     - reassigning a shelf that still has stock on it: the shoes are there,
       and once a product label carries a shelf code (phase 2) every one of
       them is now pointing at the wrong rack.

   The warning carries real numbers — how many pairs, which product, how many
   labels — because "are you sure?" with nothing behind it is a button people
   learn to click through.

   STOCK ON THE SHELF IS NEVER MOVED AND NEVER UNASSIGNED by this. The shoes
   are physically there; the database saying otherwise would send somebody to
   an empty rack. */
export function updateShelf(id, patch = {}, { force = false, userId = null } = {}) {
  return DB.tx((d) => {
    const sh = d.prepare(
      `SELECT sh.*, se.key AS section_key, se.wh_id
         FROM shelves sh JOIN sections se ON se.id = sh.section_id
        WHERE sh.id = ?`
    ).get(id);
    if (!sh) throw fail('no such shelf', 'not_found');

    /* --- what is being asked for ---------------------------------------- */
    let code = sh.code, rowLabel = sh.row_label, colIndex = sh.col_index;
    if (patch.code !== undefined) {
      const m = CODE_RE.exec(String(patch.code).trim().toUpperCase());
      if (!m) throw fail('a shelf code is one letter then digits, like B7', 'bad_code');
      colIndex = Number(m[2]);
      if (colIndex < 1 || colIndex > MAX_COLS) {
        throw fail(`a column is a whole number from 1 to ${MAX_COLS}`, 'bad_code');
      }
      /* Rebuilt from the parts rather than taken as typed, so 'B07' and 'B7'
         cannot both exist as separate shelves in the same room. */
      code = m[1] + colIndex;
      rowLabel = m[1];
    }

    let capacity = sh.capacity;
    if (patch.capacity !== undefined) {
      capacity = patch.capacity == null ? null : Number(patch.capacity);
      if (capacity != null && (!Number.isInteger(capacity) || capacity < 1)) {
        throw fail('capacity is a whole number of boxes, or nothing at all', 'bad_request');
      }
    }

    let productId = sh.product_id;
    if (patch.productId !== undefined) {
      productId = patch.productId == null ? null : Number(patch.productId);
      if (productId != null && !d.prepare('SELECT id FROM products WHERE id = ?').get(productId)) {
        throw fail('no such product', 'not_found');
      }
    }

    /* A DIFFERENT PRODUCT DOES NOT INHERIT THE OLD ONE'S SIZE RANGE.
       Carrying it over looks harmless while both are shoes and is a trap the
       moment they are not: a shelf changed from a sneaker to a T-shirt while
       still saying "42 to 42" matches no size that exists, so every attempt to
       put a shirt on it is refused for a reason nobody can see. The range has
       to be re-stated in the same request, or it goes. */
    const productChanged = productId !== sh.product_id;
    const base = productChanged
      ? { from: null, to: null }
      : { from: sh.size_from, to: sh.size_to };

    let sizeFrom = base.from, sizeTo = base.to;
    if (patch.sizeFrom !== undefined || patch.sizeTo !== undefined) {
      const r = checkRange(
        patch.sizeFrom === undefined ? base.from : patch.sizeFrom,
        patch.sizeTo === undefined ? base.to : patch.sizeTo
      );
      sizeFrom = r.from; sizeTo = r.to;
    }

    /* Clearing the product clears its range with it — "39 to 41 of nothing"
       is not a rule, and left behind it would silently narrow whatever the
       shelf is assigned to next. */
    if (productId == null) { sizeFrom = null; sizeTo = null; }

    if (sizeFrom != null) checkFamily(d, productId, sizeFrom);

    const codeChanged = code !== sh.code;
    const assignChanged = productId !== sh.product_id ||
                          sizeFrom !== sh.size_from || sizeTo !== sh.size_to;

    if (codeChanged &&
        d.prepare('SELECT id FROM shelves WHERE section_id = ? AND code = ?').get(sh.section_id, code)) {
      throw fail(`${sh.section_key} already has a ${code}`, 'duplicate_code');
    }

    /* --- stop and show the numbers -------------------------------------- */
    const on = occupancy(d, id);
    const labels = labelExposure(d, id);
    const holds = on.pieces > 0
      ? d.prepare(
          `SELECT p.id, p.name, COALESCE(SUM(s.qty), 0) AS pieces
             FROM stock s
             JOIN variants v ON v.sku = s.sku
             JOIN products p ON p.id = v.product_id
            WHERE s.shelf_id = ? GROUP BY p.id ORDER BY pieces DESC`
        ).all(id)
      : [];

    const reasons = [];
    if (codeChanged) reasons.push('code');
    if (assignChanged && on.pieces > 0) reasons.push('occupied');

    if (reasons.length && !force) {
      const bits = [];
      if (reasons.includes('occupied')) {
        bits.push(`${fullCode(sh.section_key, sh.code)} still has ${on.pieces} pair(s) on it` +
                  (holds.length ? ` (${holds.map((h) => h.name).join(', ')})` : ''));
      }
      if (reasons.includes('code')) {
        bits.push(`renaming ${fullCode(sh.section_key, sh.code)} to ` +
                  `${fullCode(sh.section_key, code)} makes its printed label wrong`);
      }
      if (labels.stale) bits.push(`${labels.stale} printed label(s) become stale`);

      throw fail(bits.join('; ') + '. Send force to go ahead.', 'confirm_required', {
        reasons,
        shelf: { id, code: sh.code, full_code: fullCode(sh.section_key, sh.code) },
        onShelf: { pieces: on.pieces, variants: on.variants, products: holds },
        labels
      });
    }

    /* --- apply ----------------------------------------------------------- */
    d.prepare(
      `UPDATE shelves
          SET code = ?, row_label = ?, col_index = ?, product_id = ?,
              size_from = ?, size_to = ?, capacity = ?, updated_at = ?
        WHERE id = ?`
    ).run(code, rowLabel, colIndex, productId, sizeFrom, sizeTo, capacity, DB.nowIso(), id);
    DB.logChange('shelves', id, 'update', userId, null);

    return { shelf: shelfRow(d, id), reprint: reasons.length > 0, labels, onShelf: on };
  });
}

export function deleteShelf(id, userId = null) {
  return DB.tx((d) => {
    const sh = d.prepare(
      `SELECT sh.*, se.key AS section_key FROM shelves sh
         JOIN sections se ON se.id = sh.section_id WHERE sh.id = ?`
    ).get(id);
    if (!sh) throw fail('no such shelf', 'not_found');

    const sec = { key: sh.section_key };
    return removeShelves(d, sec, [sh], userId, fullCode(sh.section_key, sh.code));
  });
}

function shelfRow(d, id) {
  const r = d.prepare(
    `SELECT sh.*, se.key AS section_key, se.name AS section_name, se.wh_id,
            p.name AS product_name
       FROM shelves sh
       JOIN sections se ON se.id = sh.section_id
       LEFT JOIN products p ON p.id = sh.product_id
      WHERE sh.id = ?`
  ).get(id);
  if (!r) return null;
  return {
    ...r,
    full_code: fullCode(r.section_key, r.code),
    range: r.product_id == null ? null : rangeLabel(r.size_from, r.size_to)
  };
}

/* ------------------------------------------------------- putting stock away
   The guard this whole feature exists for.

   Every refusal has to say where the pair actually belongs. Somebody is
   standing in the warehouse holding a shoe; "invalid" tells them nothing and
   the box goes down wherever is nearest, which is the problem this was built
   to stop. */
export function assignStock({ sku, whId, shelfId, userId = null }) {
  /* Checked before anything is bound. node:sqlite refuses to bind `undefined`
     at all — "Provided value cannot be bound to SQLite parameter 1" — which
     would surface as a 400 whose message is about parameter binding rather
     than about the missing field. */
  if (typeof sku !== 'string' || !sku.trim()) throw fail('which size?', 'bad_request');
  if (typeof whId !== 'string' || !whId.trim()) throw fail('which warehouse?', 'bad_request');

  return DB.tx((d) => {
    const v = d.prepare(
      `SELECT v.sku, v.size, v.product_id, p.name AS product_name
         FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.sku = ?`
    ).get(sku);
    if (!v) throw fail(`no such size: ${sku}`, 'not_found');

    const row = d.prepare('SELECT sku, wh_id, qty, shelf_id FROM stock WHERE sku = ? AND wh_id = ?')
                 .get(sku, whId);
    if (!row) {
      throw fail(`${v.product_name} ${v.size} has never been at ${whId} — receive it first`,
                 'no_stock');
    }

    /* Taking a box off a shelf and not putting it anywhere yet is a real
       thing that happens, so clearing is allowed and means exactly that. */
    if (shelfId == null) {
      d.prepare('UPDATE stock SET shelf_id = NULL WHERE sku = ? AND wh_id = ?').run(sku, whId);
      DB.logChange('stock', `${sku}:${whId}`, 'update', userId, null);
      return { sku, whId, shelfId: null, cleared: true };
    }

    const shelf = d.prepare(
      `SELECT sh.*, se.wh_id AS wh_id, se.key AS section_key, se.name AS section_name
         FROM shelves sh JOIN sections se ON se.id = sh.section_id
        WHERE sh.id = ?`
    ).get(Number(shelfId));
    if (!shelf) throw fail('no such shelf', 'not_found');

    /* Worked out once, and only if something is about to be refused. */
    let _where = null;
    const where = () => (_where || (_where = belongsOn(d, v, row.wh_id)));

    /* 1. THE WAREHOUSES MUST MATCH.
       A stock row belongs to a warehouse; a shelf reaches its warehouse
       through its section. Nothing in the schema connects those two paths, so
       no foreign key will ever catch this — it has to be checked out loud.
       Today there is one warehouse and this cannot fire. The day the second
       one opens it is the first thing that will go wrong. */
    if (shelf.wh_id !== row.wh_id) {
      /* EVERY SHELF IN THIS MESSAGE IS NAMED WITH ITS WAREHOUSE. Shelf codes
         are unique per SECTION and section keys are unique per WAREHOUSE, so
         'M-A1' names one shelf in the shop floor and a different one in the
         back store. Without the warehouse this sentence read:

           "M-A1 is in floor, and this pair is held at store.
            This pair belongs on M-A1."

         — which tells somebody holding a shoe to put it back exactly where it
         was just refused. This is the one refusal where two warehouses are in
         play by definition, so it is the one that has to say which is which. */
      throw fail(
        `${fullCode(shelf.section_key, shelf.code)} is at ${shelf.wh_id}, ` +
        `and this pair is held at ${row.wh_id}. ${sentence(where(), true)}`,
        'wrong_warehouse',
        { belongsOn: where(), shelfWhId: shelf.wh_id, stockWhId: row.wh_id }
      );
    }

    const at = DB.nowIso();

    if (shelf.product_id == null) {
      /* 2. AN EMPTY SHELF TAKES WHATEVER IS PUT ON IT, and becomes that
         product's shelf. The size range is CLEARED, not inherited — the
         manager narrows it later if this turns out to be the 42s only.

         Clearing matters because an unassigned shelf CAN still be carrying a
         range: shelves.product_id is ON DELETE SET NULL, and a product deleted
         for good (purge-demo.js) nulls the product while leaving size_from and
         size_to behind. Adopting into that leftover produced a shelf that
         refused the very pair that had just been put on it —

           put a 39 on a shelf whose dead range says 44–45  -> accepted
           scan the same 39 onto the same shelf again       -> wrong_size

         — because adoption returns before the size check and never looks at
         the range it just inherited. */
      d.prepare('UPDATE shelves SET product_id = ?, size_from = NULL, size_to = NULL, updated_at = ? WHERE id = ?')
        .run(v.product_id, at, shelf.id);
      DB.logChange('shelves', shelf.id, 'update', userId, null);
    } else if (shelf.product_id !== v.product_id) {
      /* 3. WRONG SHELF. */
      const holds = d.prepare('SELECT name FROM products WHERE id = ?').get(shelf.product_id);
      throw fail(
        `${fullCode(shelf.section_key, shelf.code)} is ${holds ? holds.name : 'another model'}. ` +
        sentence(where()),
        'wrong_shelf', { belongsOn: where(), shelfHolds: holds ? holds.name : null }
      );
    } else if (!inRange(v.size, shelf.size_from, shelf.size_to)) {
      /* 4. RIGHT MODEL, WRONG SIZE. */
      throw fail(
        `${fullCode(shelf.section_key, shelf.code)} is ${v.product_name} ` +
        `${rangeLabel(shelf.size_from, shelf.size_to)} — this is a ${v.size}. ` +
        sentence(where()),
        'wrong_size', { belongsOn: where(), shelfRange: rangeLabel(shelf.size_from, shelf.size_to) }
      );
    }

    d.prepare('UPDATE stock SET shelf_id = ? WHERE sku = ? AND wh_id = ?')
      .run(shelf.id, sku, whId);
    DB.logChange('stock', `${sku}:${whId}`, 'update', userId, null);

    return {
      sku, whId, qty: row.qty,
      shelf: shelfRow(d, shelf.id),
      adopted: shelf.product_id == null
    };
  });
}

/* Which shelves in THIS warehouse this exact pair is for. Scoped to the
   warehouse the stock is held at, because that is the room the person asking
   is standing in — naming a shelf in the other building is not help. */
function belongsOn(d, variant, whId) {
  const all = d.prepare(
    `SELECT sh.id, sh.code, sh.size_from, sh.size_to,
            se.wh_id, se.key AS section_key, se.name AS section_name
       FROM shelves sh JOIN sections se ON se.id = sh.section_id
      WHERE sh.product_id = ? AND se.wh_id = ?
      ORDER BY se.sort_index, se.key, sh.row_label, sh.col_index`
  ).all(variant.product_id, whId).map((s) => ({
    ...s, full_code: fullCode(s.section_key, s.code), range: rangeLabel(s.size_from, s.size_to)
  }));

  const fits = all.filter((s) => inRange(variant.size, s.size_from, s.size_to));
  return { matching: fits, forProduct: all };
}

/* The half-sentence every refusal ends with.

   `qualify` adds the warehouse to every shelf named. It is off by default
   because inside one building the room letter is all anybody says, and on by
   default would make every message longer for a distinction that is not in
   play. It is switched on for exactly the refusal where two warehouses are
   involved and 'M-A1' would otherwise name two different shelves. */
function sentence(w, qualify = false) {
  const name = (s) => (qualify ? `${s.full_code} at ${s.wh_id}` : s.full_code);

  if (w.matching.length === 1) return `This pair belongs on ${name(w.matching[0])}.`;
  if (w.matching.length > 1) {
    return `This pair belongs on ${w.matching.map(name).join(' or ')}.`;
  }
  if (w.forProduct.length) {
    return `That model is on ${w.forProduct.map((s) => name(s) + (s.range ? ` (${s.range})` : '')).join(', ')}, ` +
           'and this size fits none of them.';
  }
  return 'That model has no shelf yet.';
}
