-- =============================================================================
--  Mirror schema for labels that are not about a shoe.
--  Run this in the Supabase SQL editor, like 002 through 006.
-- -----------------------------------------------------------------------------
--  Matches server/migrations/024_label_subjects.sql column for column.
--
--  This one is LOW RISK to forget, unlike 006: label_print_log is pushed inside
--  the guarded "Print history" block in supabase-sync.js, which warns and
--  carries on. A day of sales still mirrors without it. The print audit trail
--  simply stops until it is run.
-- =============================================================================

-- ---------------------------------------------------- label_print_log subjects
--  A shelf label has no sku, so the column has to let go of NOT NULL, and the
--  subject becomes a kind plus an id — the shape stock_movements already uses
--  for ref_type/ref_id, with no foreign key on either side.
ALTER TABLE label_print_log ALTER COLUMN sku DROP NOT NULL;

ALTER TABLE label_print_log
  ADD COLUMN IF NOT EXISTS subject_type TEXT NOT NULL DEFAULT 'variant';
ALTER TABLE label_print_log
  ADD COLUMN IF NOT EXISTS subject_id   TEXT;

--  'printed' means the page reached the operating system's print dialog and
--  nothing afterwards can say whether paper moved. It is not 'done', which is
--  the print agent confirming it wrote the bytes. Postgres has no "add a value
--  to a CHECK", so the constraint is dropped and rebuilt.
ALTER TABLE label_print_log DROP CONSTRAINT IF EXISTS label_print_log_status_check;
ALTER TABLE label_print_log ADD CONSTRAINT label_print_log_status_check
  CHECK (status IN ('queued','done','printed','failed','cancelled'));

ALTER TABLE label_print_log DROP CONSTRAINT IF EXISTS label_print_log_subject_type_check;
ALTER TABLE label_print_log ADD CONSTRAINT label_print_log_subject_type_check
  CHECK (subject_type IN ('variant','shelf'));

CREATE INDEX IF NOT EXISTS idx_label_log_subject
  ON label_print_log (subject_type, subject_id, at DESC);


-- ============================================================================
--  A CORRECTION TO 006_shelves.sql
-- ----------------------------------------------------------------------------
--  006 as first written carried `UNIQUE (section_id, code)` on shelves and
--  `UNIQUE (wh_id, key)` on sections, mirroring SQLite. Both have since been
--  removed from that file, and these two statements remove them from any
--  project where the earlier version was already run. Doing nothing is safe
--  if 006 was run after the correction — that is what IF EXISTS is for.
--
--  Why they had to go: the sync pushes all UPSERTS before any DELETES. Delete
--  shelf A3 and put a new rack in the same slot, and the new row arrives while
--  the old one still holds A3. PostgREST merges on the PRIMARY KEY only, so a
--  clash on a second unique index raises 23505 rather than merging — and
--  "duplicate key ... already exists" matches none of the patterns the layout
--  block catches. The whole run dies there, every time, and the cursor never
--  advances. `npm run supabase:reconcile` cannot clear it either, because it
--  also upserts before it deletes.
--
--  SQLite still enforces both constraints, where it matters.
ALTER TABLE shelves  DROP CONSTRAINT IF EXISTS shelves_section_id_code_key;
ALTER TABLE sections DROP CONSTRAINT IF EXISTS sections_wh_id_key_key;
