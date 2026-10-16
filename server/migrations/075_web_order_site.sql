-- =============================================================================
--  075 — the website hears an order was accepted or rejected (16 Oct 2026)
-- -----------------------------------------------------------------------------
--  Until now the cloud learned the decision (web_orders_mark → web.orders),
--  and the website found out only when it next asked web_order_status. The
--  owner asked that the customer's order on the website turn "confirmed" and
--  the customer be NOTIFIED the moment the shop presses Accept.
--
--  So once the cloud holds the decision, the shop calls the website
--  (lib/weborder-site.js, POST <web.site_url>/api/og/order-changed, contract
--  v1.8 §7a) and these columns are its ledger:
--
--    site_state    what the website was told ('accepted' | 'rejected'), NULL
--                  until it took the news
--    site_at       when it took it
--    site_tries    how many calls failed since the last decision
--    site_next_at  the earliest the next try may go (back-off)
--    site_error    why the last call did not land (a code), NULL once it did
--
--  LOCAL-ONLY, like web_orders itself (supabase-check.js LOCAL_ONLY): this is
--  delivery state between the shop and one website, and nothing restored
--  from the mirror should re-announce three months of decisions.
-- =============================================================================

ALTER TABLE web_orders ADD COLUMN site_state   TEXT;
ALTER TABLE web_orders ADD COLUMN site_at      TEXT;
ALTER TABLE web_orders ADD COLUMN site_tries   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_orders ADD COLUMN site_next_at TEXT;
ALTER TABLE web_orders ADD COLUMN site_error   TEXT;
