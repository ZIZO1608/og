-- =============================================================================
--  Label templates — slot-based, replacing the hardcoded presets in
--  server/lib/labels.js's old DEFAULT_PRESETS/logoBox()/computeLayout().
-- -----------------------------------------------------------------------------
--  A template is a physical size plus an ordered list of "slots" — named
--  regions (logo, header, name, variant, barcode, price, date), each with a
--  bounding box in DOTS (203dpi, 8 dots/mm) and kind-specific options. The
--  renderer fits content WITHIN a slot's box exactly like the old code did
--  (e.g. a barcode centers itself inside its box, a name wraps inside its
--  box) — the box is available space, not a literal fixed placement, which
--  is what lets one engine serve both a hand-tuned legacy preset and a
--  user-edited template.
--
--  The 4 seed rows below (30x30/30x20/40x30/50x30) reproduce the exact boxes
--  the old computeLayout()/logoBox() computed for those presets — traced
--  through by hand from the pre-refactor arithmetic (DOTS_PER_MM=8,
--  QUIET_ZONE_MM=2.5 -> marginDots=20, TSPL_FONTS['2']=12x20,
--  TSPL_FONTS['3']=16x24) so a variant printed against '30x30' before this
--  migration and after it lands on the same dots. This is the compatibility
--  seed and the thing to check first if anything looks shifted.
-- =============================================================================

CREATE TABLE label_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  name_ar     TEXT,
  width_mm    REAL NOT NULL,
  height_mm   REAL NOT NULL,
  gap_mm      REAL NOT NULL DEFAULT 2,
  slots       TEXT NOT NULL,     -- JSON array of slot objects, see header comment
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX label_templates_key ON label_templates (key);

INSERT INTO label_templates (key, name, name_ar, width_mm, height_mm, gap_mm, slots, archived, created_at, updated_at) VALUES

('30x30', '30 x 30mm (default)', '٣٠ × ٣٠ ملم', 30, 30, 2,
 '[{"kind":"logo","on":true,"xDots":100,"yDots":4,"wDots":40,"hDots":40},' ||
  '{"kind":"name","on":true,"xDots":20,"yDots":48,"wDots":200,"hDots":44,"lines":2},' ||
  '{"kind":"variant","on":true,"xDots":20,"yDots":96,"wDots":200,"hDots":24},' ||
  '{"kind":"barcode","on":true,"xDots":20,"yDots":126,"wDots":200,"hDots":96,"barcodeType":"auto","showHri":true}]',
 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),

('30x20', '30 x 20mm (tightest)', '٣٠ × ٢٠ ملم', 30, 20, 2,
 '[{"kind":"name","on":true,"xDots":20,"yDots":6,"wDots":200,"hDots":22,"lines":1},' ||
  '{"kind":"variant","on":true,"xDots":20,"yDots":32,"wDots":200,"hDots":24},' ||
  '{"kind":"barcode","on":true,"xDots":20,"yDots":62,"wDots":200,"hDots":72,"barcodeType":"auto","showHri":true}]',
 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),

('40x30', '40 x 30mm', '٤٠ × ٣٠ ملم', 40, 30, 2,
 '[{"kind":"logo","on":true,"xDots":4,"yDots":4,"wDots":40,"hDots":40},' ||
  '{"kind":"name","on":true,"xDots":20,"yDots":48,"wDots":280,"hDots":44,"lines":2},' ||
  '{"kind":"variant","on":true,"xDots":20,"yDots":96,"wDots":280,"hDots":24},' ||
  '{"kind":"barcode","on":true,"xDots":20,"yDots":126,"wDots":280,"hDots":104,"barcodeType":"auto","showHri":true}]',
 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),

('50x30', '50 x 30mm', '٥٠ × ٣٠ ملم', 50, 30, 2,
 '[{"kind":"logo","on":true,"xDots":4,"yDots":4,"wDots":40,"hDots":40},' ||
  '{"kind":"name","on":true,"xDots":50,"yDots":6,"wDots":330,"hDots":44,"lines":2},' ||
  '{"kind":"variant","on":true,"xDots":50,"yDots":54,"wDots":330,"hDots":24},' ||
  '{"kind":"barcode","on":true,"xDots":20,"yDots":110,"wDots":360,"hDots":104,"barcodeType":"auto","showHri":true}]',
 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),

-- ---- new, spec-named templates (not wired to any existing job/queue data) ----

('retail-price-tag', 'Retail price tag', 'بطاقة سعر', 40, 30, 2,
 '[{"kind":"header","on":true,"xDots":20,"yDots":6,"wDots":280,"hDots":16,"fontSize":"S","align":"center"},' ||
  '{"kind":"name","on":true,"xDots":20,"yDots":26,"wDots":280,"hDots":44,"lines":2},' ||
  '{"kind":"barcode","on":true,"xDots":20,"yDots":100,"wDots":280,"hDots":90,"barcodeType":"auto","showHri":true},' ||
  '{"kind":"price","on":true,"xDots":20,"yDots":196,"wDots":280,"hDots":32,"fontSize":"L","align":"center","currencyPrefix":"","currencySuffix":"","thousands":true}]',
 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),

('barcode-only', 'Barcode only', 'باركود فقط', 30, 20, 2,
 '[{"kind":"barcode","on":true,"xDots":20,"yDots":32,"wDots":200,"hDots":96,"barcodeType":"auto","showHri":true}]',
 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),

('name-price', 'Name + price', 'الاسم والسعر', 30, 30, 2,
 '[{"kind":"name","on":true,"xDots":20,"yDots":30,"wDots":200,"hDots":66,"lines":3},' ||
  '{"kind":"price","on":true,"xDots":20,"yDots":180,"wDots":200,"hDots":32,"fontSize":"L","align":"center","currencyPrefix":"","currencySuffix":"","thousands":true}]',
 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),

-- 60x40mm: the size named in a pasted external spec, NOT confirmed against
-- the shop's actual roll (measured twice this session as 30x30mm). Kept
-- selectable rather than silently dropped or silently made the default —
-- see server/lib/labels.js's DEFAULT_PRESETS comment and CLAUDE.md's
-- "flag, don't guess" note on physical stock. label.default_preset stays
-- '30x30'.
('60x40', '60 x 40mm (unconfirmed roll size)', '٦٠ × ٤٠ ملم (غير مؤكد)', 60, 40, 2,
 '[{"kind":"logo","on":true,"xDots":6,"yDots":6,"wDots":56,"hDots":56},' ||
  '{"kind":"name","on":true,"xDots":28,"yDots":8,"wDots":420,"hDots":62,"lines":2},' ||
  '{"kind":"variant","on":true,"xDots":28,"yDots":74,"wDots":420,"hDots":28},' ||
  '{"kind":"barcode","on":true,"xDots":28,"yDots":170,"wDots":420,"hDots":110,"barcodeType":"auto","showHri":true},' ||
  '{"kind":"price","on":true,"xDots":28,"yDots":286,"wDots":420,"hDots":26,"fontSize":"M","align":"left","currencyPrefix":"","currencySuffix":"","thousands":true},' ||
  '{"kind":"date","on":false,"xDots":340,"yDots":296,"wDots":110,"hDots":16}]',
 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');
