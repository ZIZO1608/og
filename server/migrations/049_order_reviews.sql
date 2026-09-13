-- =============================================================================
--  049 — what a customer thought of their delivery
-- -----------------------------------------------------------------------------
--  One review per order, written by the customer on their own tracking page
--  (/i/<token>) once the order has arrived. See server/lib/reviews.js.
--
--  TWO SWITCHES, AND A REVIEW IS PUBLIC ONLY WHEN BOTH ARE ON. `allow_web` is
--  the customer's permission, ticked on their own form; `on_web` is the shop's
--  decision, made on the Reviews page. The owner chose both: a customer must
--  not find their words on the website without having said yes, and the shop
--  must not have every review it receives published for it. The website reads
--  `allow_web = 1 AND on_web = 1` through GET /api/ext/reviews and nothing else.
--
--  `show_name` is FROZEN at write time as first name + initial ("Nour Z."),
--  the name a website may print. Never the phone, never the address, never the
--  invoice number. Frozen for the reason sales.customer_name is: renaming a
--  customer next month must not rewrite a review somebody already published.
--
--  Changing the rating or the words takes the review OFF the website again:
--  the shop said yes to what it read, not to whatever it becomes.
--
--  MIRRORED, cursor shape, like job_reviews: a review is the shop's own record
--  and a laptop restored from the cloud must keep it. Mirror file
--  server/supabase/019_order_reviews.sql. Booleans are INTEGER 0/1 on both
--  sides, so the reconcile needs no BOOLS entry.
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_reviews (
  sale_id    TEXT    PRIMARY KEY REFERENCES sales(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags       TEXT,                                   -- JSON array of tag ids
  comment    TEXT,
  allow_web  INTEGER NOT NULL DEFAULT 0 CHECK (allow_web IN (0, 1)),
  on_web     INTEGER NOT NULL DEFAULT 0 CHECK (on_web IN (0, 1)),
  show_name  TEXT,
  city       TEXT,
  method     TEXT,
  lang       TEXT,
  at         TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  web_by     INTEGER REFERENCES users(id),
  web_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_reviews_at ON order_reviews (at);
