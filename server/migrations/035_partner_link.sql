-- =============================================================================
--  The line to Yalla Wear: where a job came from, who confirmed a payment,
--  what the shop thought of the finished shirts, and the Telegram outbox.
-- -----------------------------------------------------------------------------
--  print_jobs.source — the till, a person on the Print screen, or (later) the
--  website. Nothing decides on it yet; it is here so the e-commerce intake has
--  a column to write when it exists, and so the partner can see which orders
--  were rung up at the counter.
--
--  partner_invoice_payments — a payment is now a HANDSHAKE. One side records
--  that money moved; the OTHER side confirms it arrived. Until both have said
--  so it shows as "waiting", and only confirmed money counts against the
--  invoice. Payments that predate this were never disputed, so they are
--  stamped confirmed at the moment they were recorded — leaving them pending
--  would make every old invoice read unpaid overnight.
--
--  job_reviews — one row per finished job: a rating out of five and what the
--  shop said about the work. Written by OG only once the job is done; shown
--  to Yalla Wear because it is about their work. Mirrored (cursor shape).
--
--  partner_events — THE OUTBOX. Every state change the other company needs
--  to hear about is written here in the same transaction as the change, and
--  lib/telegram.js drains it. This is DELIVERY STATE, not shop data: it is
--  deliberately NOT mirrored to Supabase, because a restored shop re-sending
--  three months of "order accepted" messages would be a bug, not a recovery.
--  `channel` exists so a second transport (WhatsApp, one day) can queue beside
--  Telegram without touching the producers.
-- =============================================================================

ALTER TABLE print_jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('till', 'manual', 'web'));
UPDATE print_jobs SET source = 'till' WHERE sale_id IS NOT NULL;

ALTER TABLE partner_invoice_payments ADD COLUMN recorded_by_side TEXT NOT NULL DEFAULT 'og'
  CHECK (recorded_by_side IN ('og', 'yalla'));
ALTER TABLE partner_invoice_payments ADD COLUMN confirmed_at TEXT;
ALTER TABLE partner_invoice_payments ADD COLUMN confirmed_by INTEGER REFERENCES users(id);
UPDATE partner_invoice_payments SET confirmed_at = at WHERE confirmed_at IS NULL;

CREATE TABLE IF NOT EXISTS job_reviews (
  job_id     TEXT PRIMARY KEY REFERENCES print_jobs(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback   TEXT,
  user_id    INTEGER REFERENCES users(id),
  at         TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partner_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  ref_type    TEXT NOT NULL CHECK (ref_type IN ('job', 'invoice')),
  ref_id      TEXT NOT NULL,
  audience    TEXT NOT NULL CHECK (audience IN ('og', 'yalla')),
  args_json   TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'telegram',
  sent_at     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS partner_events_queue ON partner_events (channel, sent_at, next_try_at);
