-- =============================================================================
--  074 — coupons on the street: scans and batches (16 Oct 2026)
-- -----------------------------------------------------------------------------
--  The owner asked for every coupon code to have a QR code. Scanning it opens
--  a branded "you found a coupon" page (GET /c/<code>, lib/coupon-page.js):
--  shop on the website with the code already in the cart, copy it, save a
--  branded picture of it, send it to OG on WhatsApp, or show it at the till.
--  Stickers with these codes are left around the city on purpose: whoever
--  finds one gets the discount.
--
--  So a code can now be one of a BATCH — many single-use codes made in one
--  go ("Street hunt · Citadel"), one per sticker — and the shop wants to see
--  which stickers have been FOUND (scanned) and which USED (a sale).
--
--  BOTH TABLES ARE LOCAL-ONLY, on purpose, and so need no cloud file:
--    - a scan is a count of page views, not a fact about money; the main
--      server is where the page is answered, and a restore that loses it
--      loses a curiosity, not a sale;
--    - a batch is how the codes are GROUPED on the coupons page. The codes
--      themselves are ordinary coupons (max_uses 1) and go to the mirror as
--      they always have, so the website's checkout knows every one of them.
--  supabase-check.js lists both in LOCAL_ONLY.
--
--  No foreign keys: a coupon is never deleted (068), and these are a side
--  record about it, like push_seen is about a sale.
-- =============================================================================

CREATE TABLE coupon_scans (
  coupon_id  INTEGER PRIMARY KEY,
  scans      INTEGER NOT NULL DEFAULT 0 CHECK (scans >= 0),
  first_at   TEXT,
  last_at    TEXT
);

CREATE TABLE coupon_batches (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  created_by  INTEGER
);

--  Which batch a code belongs to, and its sticker number in it (1..n), so a
--  printed sticker and its row on the page can be matched by eye.
CREATE TABLE coupon_batch_codes (
  coupon_id  INTEGER PRIMARY KEY,
  batch_id   INTEGER NOT NULL,
  n          INTEGER NOT NULL
);
CREATE INDEX coupon_batch_codes_batch ON coupon_batch_codes(batch_id, n);
