-- =============================================================================
--  Thermal product labels (Xprinter XP-235B, TSPL)
-- -----------------------------------------------------------------------------
--  A separate system from the existing browser "Label Studio" in js/app.js
--  (LABEL_SIZES / openLabelSheet / labelHTML), which prints through the OS
--  print dialog to whatever's configured in Windows. This one generates TSPL
--  text commands on the SERVER and queues them for a small agent process
--  running on whichever laptop has the USB printer plugged in — the browser
--  cannot write to a USB device, and the printer is not on the network.
--
--  variants.sku stays exactly as it is (TEXT PK, alphanumeric, 'OG-001-42') --
--  it is not encodable efficiently in Code128 subset C, which halves the
--  barcode width by packing two digits per symbol but only for digits.
--  label_code is a NEW, separate, numeric-only, <=8-digit identifier,
--  generated once per variant and never changed once a label has been
--  printed with it.
-- =============================================================================

-- ---------------------------------------------------------- variants.label_code
ALTER TABLE variants ADD COLUMN label_code TEXT;

-- Backfill every existing variant deterministically, in rowid order, starting
-- at 100000 (six digits). A correlated COUNT(*) rather than a window function,
-- so this doesn't depend on a newer SQLite than node:sqlite ships.
UPDATE variants
   SET label_code = printf('%d', 99999 + (
         SELECT COUNT(*) FROM variants v2 WHERE v2.rowid <= variants.rowid
       ))
 WHERE label_code IS NULL;

CREATE UNIQUE INDEX variants_label_code ON variants (label_code);

-- Persisted counter for future variants. A dedicated single-row table rather
-- than reusing `config` -- config is user-editable settings; this is a hot,
-- transactional sequence, a different kind of thing. Also not SQLite rowid:
-- variants' PK is TEXT, so rowid isn't guaranteed stable across a VACUUM.
-- Seeded to continue directly after the backfill so the next-issued code
-- never collides with a backfilled one.
CREATE TABLE label_code_seq (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  next_value INTEGER NOT NULL
);
INSERT INTO label_code_seq (id, next_value)
SELECT 1, COALESCE(MAX(CAST(label_code AS INTEGER)), 99999) + 1 FROM variants;

-- ------------------------------------------------------------- the print queue
-- Mutable operational state -- what agent/print-agent.js polls, claims from,
-- and reports back to. Not an audit log (see label_print_log below).
--
-- lines: JSON [{sku, qty}] -- the variant/qty breakdown THIS job's TSPL
-- covers, a subset of the original request (a batch of 400 is split into
-- many jobs -- see JOB_CHUNK_LABELS in server/lib/labels.js). Needed so a
-- resolving job can write one label_print_log row per line.
--
-- claim_token: issued fresh by GET /api/labels/next when a job moves
-- pending -> claimed. /done and /failed must present the same token, so a
-- late completion from a zombie agent -- after its lease expired and the job
-- was reclaimed under a new token -- is a safe no-op instead of silently
-- completing someone else's later claim of the same job.
CREATE TABLE label_print_jobs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id          TEXT NOT NULL,
  station           TEXT NOT NULL,
  preset            TEXT NOT NULL,
  lines             TEXT NOT NULL,        -- JSON [{sku, qty}]
  label_count       INTEGER NOT NULL,
  tspl_b64          TEXT NOT NULL,        -- base64 of the full TSPL byte sequence for this job
  status            TEXT NOT NULL CHECK (status IN ('pending','claimed','done','failed','cancelled')) DEFAULT 'pending',
  claim_token       TEXT,
  claimed_at        TEXT,
  lease_expires_at  TEXT,
  error             TEXT,
  created_at        TEXT NOT NULL,
  created_by        INTEGER REFERENCES users(id),
  done_at           TEXT
);
CREATE INDEX label_print_jobs_station_status ON label_print_jobs (station, status, id);
CREATE INDEX label_print_jobs_batch ON label_print_jobs (batch_id);

-- --------------------------------------------------------------- the audit log
-- Append-only, same spirit as stock_movements / change_log elsewhere in this
-- schema -- never UPDATEd. Two rows per line in the common case: one written
-- 'queued' at POST /api/labels/print time (so "who printed what, how many,
-- for which station" is durable the instant the request is accepted, before
-- any agent ever sees it), and one written when the job that carried that
-- line resolves ('done' / 'failed' / 'cancelled').
CREATE TABLE label_print_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id  TEXT NOT NULL,
  job_id    INTEGER REFERENCES label_print_jobs(id),
  sku       TEXT NOT NULL REFERENCES variants(sku),
  qty       INTEGER NOT NULL,
  preset    TEXT NOT NULL,
  station   TEXT NOT NULL,
  user_id   INTEGER REFERENCES users(id),
  status    TEXT NOT NULL CHECK (status IN ('queued','done','failed','cancelled')),
  error     TEXT,
  at        TEXT NOT NULL
);
CREATE INDEX label_print_log_sku   ON label_print_log (sku, at DESC);
CREATE INDEX label_print_log_batch ON label_print_log (batch_id, at DESC);

-- --------------------------------------------------------------- config.label.*
-- Mirrors the config.receipt.* idiom in 009_receipts.sql exactly.
INSERT INTO config (key, value, updated_at) VALUES
  ('label.default_preset', '30x30',   '1970-01-01T00:00:00.000Z'),
  ('label.transport',      'agent',   '1970-01-01T00:00:00.000Z'),
  ('label.printer_host',   '',        '1970-01-01T00:00:00.000Z'),
  ('label.printer_port',   '9100',    '1970-01-01T00:00:00.000Z'),
  ('label.stations',       'warehouse-laptop,till-1', '1970-01-01T00:00:00.000Z'),
  ('label.density',        '8',       '1970-01-01T00:00:00.000Z'),
  ('label.speed',          '4',       '1970-01-01T00:00:00.000Z'),
  ('label.gap_mm',         '2',       '1970-01-01T00:00:00.000Z'),
  ('label.logo_asset',     'assets/logo.svg', '1970-01-01T00:00:00.000Z'),
  ('label.code_source',    'ean_then_sku', '1970-01-01T00:00:00.000Z'),
  ('label.max_batch',      '500',     '1970-01-01T00:00:00.000Z'),
  ('label.lease_minutes',  '10',      '1970-01-01T00:00:00.000Z'),
  ('label.calibrate_cmd',  'AUTODETECT', '1970-01-01T00:00:00.000Z'),
  ('label.presets', '[{"key":"30x30","widthMm":30,"heightMm":30,"gapMm":2,"logo":"small-top","nameLines":2,"barcodeHeightMm":12,"allowEan":false},{"key":"30x20","widthMm":30,"heightMm":20,"gapMm":2,"logo":"omit","nameLines":1,"barcodeHeightMm":9,"allowEan":false},{"key":"40x30","widthMm":40,"heightMm":30,"gapMm":2,"logo":"small-top-left","nameLines":2,"barcodeHeightMm":13,"allowEan":true},{"key":"50x30","widthMm":50,"heightMm":30,"gapMm":2,"logo":"left-of-text","nameLines":2,"barcodeHeightMm":13,"allowEan":true}]', '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------- label.print
-- "Manager + warehouse only" per spec. Seeded per role exactly like
-- sale.reprint's precedent in 009_receipts.sql.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('manager',   'label.print', 1, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'label.print', 0, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'label.print', 1, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'label.print', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'label.print', 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT (role, perm) DO NOTHING;
