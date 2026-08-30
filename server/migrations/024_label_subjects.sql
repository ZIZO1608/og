-- =============================================================================
--  A label is not always about a shoe
-- -----------------------------------------------------------------------------
--  Phase 2 prints a SHELF label — a room name, a grid code, a barcode of
--  'SH01MA3'. It has no sku, and `label_print_log.sku` was TEXT NOT NULL
--  REFERENCES variants(sku), so there was literally nowhere to write it down.
--
--  The three alternatives were worse. A second table splits "what was printed"
--  in two and forces a UNION into every future history screen. Not logging at
--  all contradicts 010's own reason for the queued row — "so who printed what,
--  how many, for which station is durable the instant the request is accepted"
--  — and leaves no way to answer "was this shelf's label ever printed", which
--  is the question phase 1's reassign warning is built on. A sentinel sku is
--  impossible while the foreign key stands, and inventing a fake variant to
--  satisfy an audit log is exactly the "generated data looks like the truth"
--  failure this codebase is organised against.
--
--  So the subject becomes polymorphic, the same shape stock_movements already
--  uses for ref_type/ref_id: a kind, an id, and NO foreign key. SQLite cannot
--  ALTER away a NOT NULL or a REFERENCES, so this is a table rebuild — the
--  first in this repo. Everything else here has been ADD COLUMN.
--
--  DELIBERATELY NOT DONE HERE: no column is added to `warehouses` or to
--  `label_templates`. Both are pushed to Supabase by syncReference() and
--  mirrorTable(), which run BEFORE the core loop with no fallbackDrop and no
--  try/catch — a column the mirror has not got would take the ENTIRE sync down
--  before a single sale was pushed. `label_print_log` is inside the guarded
--  "Print history" block, which warns and carries on, so it is safe to change.
--  The warehouse numbering the barcode needs lives in `config` instead, which
--  is row-shaped and needs no schema change anywhere.
-- =============================================================================

-- ------------------------------------------------- label_print_log, rebuilt
CREATE TABLE label_print_log_new (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id  TEXT NOT NULL,
  job_id    INTEGER REFERENCES label_print_jobs(id),

  --  Nullable now, and no longer a foreign key.
  --
  --  Nullable because a shelf label has no sku. Un-keyed because the FK was
  --  quietly a liability: purge-demo.js deletes variants without touching this
  --  table, and with foreign_keys = ON that delete fails — or would have, the
  --  first time anyone purged a variant whose label had ever been printed.
  --  An append-only audit log should not be able to block a delete; it is a
  --  record of something that happened, not a claim that the row still exists.
  sku       TEXT,

  --  What the label was ABOUT. 'variant' for every row that existed before
  --  this migration, which is why it carries that default.
  subject_type TEXT NOT NULL DEFAULT 'variant'
               CHECK (subject_type IN ('variant','shelf')),
  --  TEXT, not INTEGER, because a variant is keyed by sku and a shelf by a
  --  number — the same reason stock_movements.ref_id is TEXT.
  subject_id   TEXT,

  qty       INTEGER NOT NULL,
  preset    TEXT NOT NULL,
  station   TEXT NOT NULL,
  user_id   INTEGER REFERENCES users(id),

  --  'printed' is new, and it is not a synonym for 'done'.
  --
  --  'done' means the print agent came back and said it wrote the bytes. The
  --  browser print path cannot ever say that: window.print() hands the page to
  --  the operating system's dialog and returns, and nothing afterwards knows
  --  whether paper moved, whether the driver scaled it, or whether the user
  --  pressed Cancel. 'printed' records exactly that much and no more.
  --
  --  It has to be added HERE rather than later because SQLite has no ALTER
  --  TABLE ADD CONSTRAINT: a new status value costs a second full rebuild.
  status    TEXT NOT NULL CHECK (status IN
              ('queued','done','printed','failed','cancelled')),
  error     TEXT,
  at        TEXT NOT NULL
);

--  `id` is copied EXPLICITLY. It is the cursor the Supabase append-only sync
--  bookmarks against ("the highest id already pushed"), so letting AUTOINCREMENT
--  hand out new ones would either re-push the whole history or, worse, strand
--  the cursor above rows that no longer carry the ids it remembers.
INSERT INTO label_print_log_new
  (id, batch_id, job_id, sku, subject_type, subject_id, qty, preset, station,
   user_id, status, error, at)
SELECT
   id, batch_id, job_id, sku, 'variant', sku, qty, preset, station,
   user_id, status, error, at
FROM label_print_log;

DROP TABLE label_print_log;
ALTER TABLE label_print_log_new RENAME TO label_print_log;

CREATE INDEX label_print_log_sku     ON label_print_log (sku, at DESC);
CREATE INDEX label_print_log_batch   ON label_print_log (batch_id, at DESC);
CREATE INDEX label_print_log_subject ON label_print_log (subject_type, subject_id, at DESC);


-- ------------------------------------------- the number inside every barcode
--  A shelf barcode is 'SH' + a two-digit warehouse + the room letter + the
--  shelf code: SH01MA3. The warehouse rides in it so that opening a second
--  warehouse later does not mean reprinting every label already stuck to a
--  rack — which is the whole reason it is there and also the reason this
--  number must NEVER change once a label has been printed.
--
--  It is NOT `warehouses.sort`. Nothing writes sort today, so it is stable by
--  accident rather than by contract: it has no unique index, it defaults to 0
--  so a third warehouse would silently collide, and a column called `sort` is
--  an open invitation to build a "reorder the warehouses" control — which
--  would invalidate every barcode in the building without anybody noticing.
--
--  It is not a new column on `warehouses` either. See the header: that table
--  is mirrored unguarded, and the cost of getting it wrong is a day of sales
--  not reaching Supabase. `config` is row-shaped, already mirrored whole, and
--  is the idiom this schema uses for exactly this kind of setting.
--
--  Numbered by sort then id rather than by rowid: rowid is not stable across
--  the VACUUM that `npm run backup` runs, which 010_labels.sql already learned
--  the hard way. The correlated count guarantees 1..N with no duplicates even
--  if two warehouses ever share a sort value.
INSERT INTO config (key, value, updated_at)
SELECT 'label.warehouse_codes',
       '{' || COALESCE(GROUP_CONCAT('"' || w.id || '":' ||
         (SELECT COUNT(*) FROM warehouses w2
           WHERE w2.sort < w.sort OR (w2.sort = w.sort AND w2.id <= w.id))
       ), '') || '}',
       '1970-01-01T00:00:00.000Z'
  FROM warehouses w
--  `WHERE true` is not filler. SQLite cannot parse an upsert clause after an
--  INSERT ... SELECT without one: with no WHERE it tries to read `ON` as a join
--  against the SELECT's FROM and fails with `near "DO": syntax error`.
 WHERE true
ON CONFLICT (key) DO NOTHING;
