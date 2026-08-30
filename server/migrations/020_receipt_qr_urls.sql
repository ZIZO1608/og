-- =============================================================================
--  The address the receipt QR actually points at
-- -----------------------------------------------------------------------------
--  006_invoice_tokens.sql gave every sale a permanent, unguessable public_token
--  and server/lib/receipt.js renders the page it opens (GET /i/:token). What was
--  missing is the middle of that sentence: the BASE the printed QR prepends to
--  the token. Until now js/receipt.js read CONFIG.PUBLIC_URL, a constant in
--  js/data.js pointing at the GitHub Pages host -- a static site with no /i/
--  route -- which the payload builder then correctly refused, so every receipt
--  fell back to printing readable text and the QR opened nothing, ever.
--
--  WHY CONFIG AND NOT A CONSTANT. The address the shop is reachable at is not a
--  property of the code, it is a property of where this machine is deployed:
--  a LAN IP today, a real domain the week the shop buys one. A manager must be
--  able to change it in Settings without a deploy, and the moment they do,
--  EVERY receipt ever printed starts resolving -- the token is in the database,
--  not in the paper. That is the whole design of 006 and this is what completes
--  it.
--
--  EMPTY IS THE HONEST DEFAULT. There is no address this repository can know.
--  Left empty, js/receipt.js prints "OG | INV-2101" instead -- readable, needs
--  no internet, cannot rot. A seeded guess would print a QR that opens an error
--  page on a customer's phone, which is worse than no QR at all.
--
--  receipt.site_url IS THE SECOND QR, DELIBERATELY EMPTY.
--  The layout in js/receipt.js draws one QR or two side by side. One is what
--  ships: the invoice. When the shop's website exists, a manager fills this
--  field in Settings and the second QR appears next to the first, labelled and
--  laid out, with no code change and nothing to re-test. Empty means the
--  receipt draws the single-QR layout -- not a QR pointing at a page that is
--  not built yet.
-- =============================================================================

INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('receipt.public_url', '', '1970-01-01T00:00:00.000Z'),
  ('receipt.site_url',   '', '1970-01-01T00:00:00.000Z');
