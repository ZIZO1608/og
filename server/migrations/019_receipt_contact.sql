-- =============================================================================
--  A contact block on the receipt: Instagram, Telegram, the shop's map link
-- -----------------------------------------------------------------------------
--  The customer is standing in the shop, so the printed street address
--  (shop.address, read by js/receipt.js's drawHeader()) stops being useful the
--  moment they walk out holding this paper -- what's actually useful after
--  that is how to find the shop again and how to reach it online. Values are
--  full URLs (not bare @handles) so the same field doubles as the QR payload
--  placeholder used until the Telegram bot exists (see the follow-up migration
--  that wires the real t.me/<bot>?start=<token> link) and as printed text --
--  js/receipt.js strips the https://(www.) prefix for the shorter printed
--  line, deriving one display form from one stored fact rather than keeping a
--  handle and a URL that could quietly drift apart.
--
--  INSERT OR IGNORE, not UPDATE: unlike 018_receipt_usb.sql (which updated
--  a row 010_labels.sql already owned), these are three keys nothing has
--  seeded before, so the normal 009_receipts.sql-style insert is correct
--  here -- and IGNORE rather than a plain INSERT means re-running this file
--  against a database that already has real shop-entered values (a manager
--  changed the handle in Settings) never stomps them back to the seed.
-- =============================================================================

INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('receipt.instagram', 'https://www.instagram.com/og_sports_1',   '1970-01-01T00:00:00.000Z'),
  ('receipt.telegram',  'https://t.me/ogsports1',                  '1970-01-01T00:00:00.000Z'),
  ('receipt.maps_url',  'https://maps.app.goo.gl/i5VcMRV8sg4c7E639','1970-01-01T00:00:00.000Z');
