-- =============================================================================
--  021 — the cash book  (local 053: where every lira and dollar is)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor. Until it is run the sync skips
--  money_moves BY NAME behind its own guard — "Supabase is missing money_moves"
--  on every run — and everything else still mirrors. Nothing is lost: the
--  table is pushed above its highest id, and that bookmark does not move until
--  the rows land.
--
--  Afterwards: npm run supabase:drift should read green. No reconcile is
--  needed for this file on its own — no existing table gained a column.
--
--  Append-only: a correction is a new row, never an UPDATE. The local schema
--  carries the CHECK on a zero amount. No foreign key to users, for the
--  reason print_log has none: a move must never be why an account cannot be
--  removed from the mirror.
--
--  RLS on, no policies: the service key works and nothing else does, which is
--  the whole security model of the mirror. This table is the shop's money —
--  what the owner takes home included — so it is not optional here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS money_moves (
  id         BIGINT PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL,
  place      TEXT NOT NULL,
  currency   TEXT NOT NULL REFERENCES currencies(code),
  amount     BIGINT NOT NULL,
  kind       TEXT NOT NULL,
  fx_rate    DOUBLE PRECISION NOT NULL,
  pair_id    BIGINT,
  ref_type   TEXT,
  ref_id     TEXT,
  note       TEXT,
  user_id    BIGINT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_money_moves_place ON money_moves (place, currency, at);
CREATE INDEX IF NOT EXISTS idx_money_moves_ref   ON money_moves (ref_type, ref_id);

ALTER TABLE money_moves ENABLE ROW LEVEL SECURITY;
