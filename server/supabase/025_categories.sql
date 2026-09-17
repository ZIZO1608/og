-- =============================================================================
--  025 — product categories in English and Arabic  (local 057)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 024. Until it is run the sync
--  skips `categories` by name and names this file every run; the boot pull
--  refuses with `drift`. Pushed whole on every run, so no reconcile is needed.
--  RLS on, no policies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  sizes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
