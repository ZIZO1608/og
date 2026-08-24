-- =============================================================================
--  A permanent address for every invoice
-- -----------------------------------------------------------------------------
--  The receipt carries a QR. For it to be worth printing, it has to open the
--  invoice on a customer's phone -- next week, and in two years, on a device
--  that has never seen this shop's network and will never log in.
--
--  WHY NOT JUST USE THE INVOICE NUMBER. Because INV-2101 is followed by
--  INV-2102. One customer who scans their own receipt and edits the last digit
--  can walk the entire sales history of the shop: what everyone bought, what
--  they paid, and -- since a sale carries its customer -- who they are and
--  what their phone number is. An invoice number is an index, not a secret,
--  and it must never be the only thing standing between the public and the
--  customer table.
--
--  So: 16 random bytes, 128 bits, hex. Not guessable, not enumerable, and
--  short enough that the QR stays a coarse grid -- which matters, because a
--  dense QR printed by a thermal head at 203dpi stops scanning.
--
--  The token lives in the database, not in the paper. That is what makes the
--  link retroactive: on the day the shop gets a public server, every receipt
--  already printed starts resolving, with nothing reprinted.
-- =============================================================================

ALTER TABLE sales ADD COLUMN public_token TEXT;

--  Backfill what already exists. randomblob(16) is SQLite's own CSPRNG; new
--  sales get theirs from node:crypto in lib/sales.js. Both are 128 bits, and
--  neither is derived from the invoice number -- a token you can compute from
--  the id is the id wearing a hat.
UPDATE sales
   SET public_token = lower(hex(randomblob(16)))
 WHERE public_token IS NULL;

--  UNIQUE and not just indexed: a collision would silently serve one
--  customer's invoice at another's address. Partial, so the column can stay
--  nullable for any row that somehow arrives without one rather than failing
--  the insert outright.
CREATE UNIQUE INDEX sales_public_token
    ON sales (public_token) WHERE public_token IS NOT NULL;
