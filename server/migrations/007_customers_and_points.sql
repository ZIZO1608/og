-- =============================================================================
--  Customers become real, and loyalty points stop being free
-- -----------------------------------------------------------------------------
--  Until now the browser owned the customer list. The server had the table but
--  no way to read or write it, so `customers` held zero rows while the till
--  happily showed forty people. Sales.record looked up the customer id the till
--  sent, found nothing, and wrote the sale with no customer and no points --
--  silently. The cashier saw a normal receipt. The loyalty simply evaporated.
--
--  Three things this adds.
--
--  1. sales.points_used
--     Points redeemed at the till were folded into `discount` and never taken
--     off anyone's balance, so the same 500 points could be spent on every
--     visit forever. The deduction now happens server-side, inside the sale's
--     own transaction, and the amount is written onto the row -- because a
--     receipt reprinted in a year has to be able to say what was redeemed, and
--     recomputing it from a balance that has moved since is guesswork.
--
--  2. city / source / archived on customers
--     The app already displays all three (the customer list filters on city,
--     the card shows online vs in-store). They were browser-only fields with
--     nowhere to land.
--
--  3. A `demo` flag on products and customers
--     `npm run demo-catalogue` fills a scratch database with a shop's worth of
--     goods so the system can be shown working. Those rows must be removable
--     EXACTLY -- taking a real product out with them would be unforgivable, and
--     matching on name would eventually do precisely that. A flag makes the
--     removal a WHERE clause instead of a guess, and makes "is this database
--     still full of demo data?" one query the server can ask on startup.
-- =============================================================================

--  Zero rather than NULL: every existing sale redeemed nothing, and that is a
--  fact about them, not missing information.
ALTER TABLE sales ADD COLUMN points_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customers ADD COLUMN city     TEXT;
ALTER TABLE customers ADD COLUMN source   TEXT;
ALTER TABLE customers ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

--  Deliberately DEFAULT 0 on both: anything created by a person through the app
--  is real unless the seed script says otherwise. Failing closed here means a
--  bug in the seeder can leave demo rows behind, which is visible and fixable;
--  the other way round it would delete the shop's catalogue.
ALTER TABLE customers ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products  ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
