-- =============================================================================
--  012 — the line to Yalla Wear: job source, payment handshake, reviews
-- -----------------------------------------------------------------------------
--  RUN THIS BY HAND in the Supabase SQL editor, like 002–011 before it.
--  Matches server/migrations/035_partner_link.sql column for column, EXCEPT
--  partner_events, which is deliberately absent — see the bottom of this file.
--
--  Until it is run, supabase-sync.js pushes print_jobs without `source` and
--  partner_invoice_payments without the three confirmation columns, saying
--  so by name on every run (lib/mirror-lag.js). AFTERWARDS run
--    npm run supabase:reconcile
--  because the sync's cursor has already moved past every row it pushed one
--  column short, and no rewind will ever look there again. Until the
--  reconcile runs, a restore from this mirror hands back a shop where every
--  payment is unconfirmed and every job says "manual".
--
--    print_jobs.source              'till' | 'manual' | 'web' — where the
--                                   job was raised.
--
--    partner_invoice_payments       a payment is now a handshake: one side
--      .recorded_by_side            records it ('og' | 'yalla'), the OTHER
--      .confirmed_at / .confirmed_by  confirms it. Only confirmed money counts
--                                   against the invoice. Rows that predate
--                                   this are stamped confirmed at their own
--                                   time by the local migration.
--
--    job_reviews                    one per finished job: the shop's rating
--                                   out of five and what it said. Cursor
--                                   shape, replayed from change_log.
--
--  NOT HERE: partner_events. That table is the Telegram OUTBOX — delivery
--  state, not shop data. A restored shop that re-sent three months of "order
--  accepted" messages to two phones would be a bug, not a recovery, so the
--  queue lives on the shop machine only and is never mirrored.
--
--  Row level security on, no policies, like every table since 001: the
--  service key works and nothing else does.
-- =============================================================================

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE partner_invoice_payments ADD COLUMN IF NOT EXISTS recorded_by_side TEXT NOT NULL DEFAULT 'og';
ALTER TABLE partner_invoice_payments ADD COLUMN IF NOT EXISTS confirmed_at     TEXT;
ALTER TABLE partner_invoice_payments ADD COLUMN IF NOT EXISTS confirmed_by     BIGINT;

CREATE TABLE IF NOT EXISTS job_reviews (
  job_id     TEXT PRIMARY KEY,
  rating     INTEGER NOT NULL,
  feedback   TEXT,
  user_id    BIGINT,
  at         TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE job_reviews ENABLE ROW LEVEL SECURITY;
