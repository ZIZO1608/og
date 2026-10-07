-- =============================================================================
--  071 — jersey print kits, and website print orders to Yalla Wear (7 Oct 2026)
-- -----------------------------------------------------------------------------
--  The website now sells a name and a number printed on the back of an adult
--  jersey. The rules the owner locked:
--
--    * adult jerseys only, the BACK only, and a name and a number ALWAYS
--      together — never one without the other;
--    * the name: A–Z, space, dot, apostrophe, hyphen, upper case, at most
--      print.max_letters (12); the number a whole number 0–99;
--    * 5 USD a jersey to the customer (print.unit_price + print.unit_currency);
--      what Yalla Wear charges stays print.partner_unit_cost;
--    * ready in 5–7 days (print.turnaround_min / _max).
--
--  HOW A SHIRT LOOKS is a KIT: the font, the colours, the outline, the
--  shadow, and where the name and the number sit, in the units of a
--  400 × 440 jersey-back drawing (the kit screen's preview and the website's
--  are the same drawing). A kit may belong to a club (clubs.code) and a
--  season and a kind of shirt — "Real Madrid 26/27 home" — or to nobody, as a
--  style the website offers to anyone ("OG Block"). A club row can itself be
--  an edition ('rmal', 'syrg'); then season and kit_type stay empty.
--
--  BOTH TABLES ARE MIRROR SHAPE, like clubs: small, pushed whole, a row
--  deleted here is deleted there, no change_log. Cloud file 041.
--
--  print_fonts.weight is not in the brief and is needed: two of the four
--  seed faces (Teko, Cairo) exist in github.com/google/fonts ONLY as variable
--  fonts, and "bold" is then a weight to draw at, not a file. The file is
--  the whole variable font; the weight says what to ask it for.
--
--  The seed fonts start with file_url NULL: a migration cannot upload. The
--  running server fetches each one from source_url, makes the WOFF2, puts
--  both in the print-fonts bucket and fills the addresses in
--  (PrintKits.seedFonts, lib/printkits.js) — or the Fonts screen's Upload
--  now does it by hand.
-- =============================================================================

CREATE TABLE IF NOT EXISTS print_fonts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  file_url      TEXT,                       -- the WOFF2 the website and the preview draw with
  source_url    TEXT,                       -- the original .ttf/.otf (the bucket copy once uploaded)
  license_note  TEXT,
  weight        INTEGER NOT NULL DEFAULT 400 CHECK (weight BETWEEN 1 AND 1000),
  archived      INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS print_fonts_name ON print_fonts (lower(name));

CREATE TABLE IF NOT EXISTS print_kits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  label          TEXT    NOT NULL,
  club_code      TEXT    REFERENCES clubs(code),
  season         TEXT    CHECK (season IS NULL OR season GLOB '[0-9][0-9]/[0-9][0-9]'
                                               OR season GLOB '[0-9][0-9][0-9][0-9]/[0-9][0-9]'),
  kit_type       TEXT    CHECK (kit_type IS NULL OR kit_type IN ('home','away','third','retro','gk','special')),
  font_id        INTEGER NOT NULL REFERENCES print_fonts(id),
  text_color     TEXT    NOT NULL DEFAULT '#ffffff'
                 CHECK (text_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  outline_color  TEXT    CHECK (outline_color IS NULL OR outline_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  outline_width  INTEGER NOT NULL DEFAULT 0  CHECK (outline_width BETWEEN 0 AND 20),
  shadow_color   TEXT    CHECK (shadow_color IS NULL OR shadow_color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  shadow_dx      INTEGER NOT NULL DEFAULT 0  CHECK (shadow_dx BETWEEN -20 AND 20),
  shadow_dy      INTEGER NOT NULL DEFAULT 0  CHECK (shadow_dy BETWEEN -20 AND 20),
  name_size      INTEGER NOT NULL DEFAULT 34  CHECK (name_size BETWEEN 10 AND 120),
  name_y         INTEGER NOT NULL DEFAULT 165 CHECK (name_y BETWEEN 0 AND 440),
  name_arc       INTEGER NOT NULL DEFAULT 30  CHECK (name_arc BETWEEN -80 AND 80),
  number_size    INTEGER NOT NULL DEFAULT 160 CHECK (number_size BETWEEN 40 AND 300),
  number_y       INTEGER NOT NULL DEFAULT 345 CHECK (number_y BETWEEN 0 AND 440),
  is_default     INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  featured       INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  archived       INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  CHECK (is_default = 0 OR archived = 0)
);
--  One kit per club, season and kind of shirt. Written over the three with
--  NULL folded to '' — a plain UNIQUE treats every NULL as different, so two
--  "Syria" kits with no season would both have been allowed. An archived kit
--  steps aside, so a club's kit can be made again after the old one is put
--  away. A kit with no club (a style) is not limited.
CREATE UNIQUE INDEX IF NOT EXISTS print_kits_club
  ON print_kits (club_code, IFNULL(season, ''), IFNULL(kit_type, ''))
  WHERE club_code IS NOT NULL AND archived = 0;
--  ONE default. A printable product with no kit of its own is printed in it.
CREATE UNIQUE INDEX IF NOT EXISTS print_kits_default ON print_kits (is_default) WHERE is_default = 1;

--  The product side. printable says the website may sell a print on it;
--  print_kit_id is the kit it is printed in (NULL = the default kit).
ALTER TABLE products ADD COLUMN print_kit_id INTEGER REFERENCES print_kits(id);
ALTER TABLE products ADD COLUMN printable INTEGER NOT NULL DEFAULT 0 CHECK (printable IN (0,1));

--  A print job raised for a website order (its ref), one per order — the
--  unique index is what makes accepting the same order twice raise ONE job.
ALTER TABLE print_jobs ADD COLUMN web_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_web_ref ON print_jobs (web_ref) WHERE web_ref IS NOT NULL;

--  The kit as it was when the shirt was ordered (JSON): the printer prints
--  what the customer saw, even if the kit is edited the next day.
ALTER TABLE print_job_lines ADD COLUMN print_kit_snapshot TEXT;

--  An owner's "send it anyway" on a parcel whose print is not finished
--  (JSON {reason, by, byName, at}). See lib/deliveries.js printHold().
ALTER TABLE deliveries ADD COLUMN print_override TEXT;

-- ------------------------------------------------------------------ config
--  The website's print price, now in DOLLARS like every product (067): the
--  number is minor units of print.unit_currency, so '500' is $5.00. A shop
--  that had a lira price keeps meaning lira — unit_currency missing is the
--  base currency (Partner.webPrices).
INSERT INTO config (key, value, updated_at) VALUES
  ('print.unit_price',    '500', '2026-10-07T00:00:00.000Z'),
  ('print.unit_currency', 'USD', '2026-10-07T00:00:00.000Z')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('print.max_letters',    '12', '2026-10-07T00:00:00.000Z'),
  ('print.turnaround_min', '5',  '2026-10-07T00:00:00.000Z'),
  ('print.turnaround_max', '7',  '2026-10-07T00:00:00.000Z');

-- ------------------------------------------------------------- permission
--  print_kits.manage: the font library and the kits. Given to every role
--  that may edit products, as this shop's role_permissions say today (the
--  seed and this database differ), and to anybody granted product.write by
--  name. Owner and developer hold every permission in code anyway.
INSERT INTO role_permissions (role, perm, allowed, updated_at)
  SELECT role, 'print_kits.manage', CASE WHEN role = 'partner' THEN 0 ELSE allowed END, '1970-01-01T00:00:00.000Z'
    FROM role_permissions WHERE perm = 'product.write'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('owner',     'print_kits.manage', 1, '1970-01-01T00:00:00.000Z'),
  ('developer', 'print_kits.manage', 1, '1970-01-01T00:00:00.000Z')
ON CONFLICT DO NOTHING;
INSERT INTO user_permissions (user_id, perm, allowed, updated_at, updated_by)
  SELECT user_id, 'print_kits.manage', allowed, updated_at, updated_by
    FROM user_permissions WHERE perm = 'product.write'
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------- seeds
--  Four faces from github.com/google/fonts, all SIL Open Font License 1.1.
INSERT OR IGNORE INTO print_fonts (id, name, file_url, source_url, license_note, weight, created_at, updated_at) VALUES
  (1, 'OG Block',   NULL, 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf',
      'Anton — SIL Open Font License 1.1 (github.com/google/fonts/tree/main/ofl/anton)', 400,
      '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
  (2, 'OG Classic', NULL, 'https://raw.githubusercontent.com/google/fonts/main/ofl/graduate/Graduate-Regular.ttf',
      'Graduate — SIL Open Font License 1.1 (github.com/google/fonts/tree/main/ofl/graduate)', 400,
      '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
  (3, 'OG Modern',  NULL, 'https://raw.githubusercontent.com/google/fonts/main/ofl/teko/Teko%5Bwght%5D.ttf',
      'Teko (variable, drawn at 700) — SIL Open Font License 1.1 (github.com/google/fonts/tree/main/ofl/teko)', 700,
      '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
  (4, 'Syria',      NULL, 'https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt,wght%5D.ttf',
      'Cairo (variable, drawn at 700) — SIL Open Font License 1.1 (github.com/google/fonts/tree/main/ofl/cairo)', 700,
      '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');

--  Six kits. The three Syria colours are placeholders the owner edits.
--  Only seeded where the club exists (a shop whose clubs were changed by
--  hand gets the styles and skips the rest).
INSERT OR IGNORE INTO print_kits (id, label, club_code, font_id, text_color, is_default, featured, created_at, updated_at) VALUES
  (1, 'OG Block',   NULL, 1, '#ffffff', 1, 1, '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
  (2, 'OG Classic', NULL, 2, '#ffffff', 0, 1, '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'),
  (3, 'OG Modern',  NULL, 3, '#ffffff', 0, 1, '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
INSERT OR IGNORE INTO print_kits (id, label, club_code, font_id, text_color, created_at, updated_at)
  SELECT 4, 'Syria', 'syr', 4, '#ffffff', '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'
   WHERE EXISTS (SELECT 1 FROM clubs WHERE code = 'syr');
INSERT OR IGNORE INTO print_kits (id, label, club_code, font_id, text_color, created_at, updated_at)
  SELECT 5, 'Syria Green', 'syrg', 4, '#ffffff', '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'
   WHERE EXISTS (SELECT 1 FROM clubs WHERE code = 'syrg');
INSERT OR IGNORE INTO print_kits (id, label, club_code, font_id, text_color, created_at, updated_at)
  SELECT 6, 'Syria White', 'syrw', 4, '#000000', '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z'
   WHERE EXISTS (SELECT 1 FROM clubs WHERE code = 'syrw');
