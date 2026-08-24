-- =============================================================================
--  The name on the receipt
-- -----------------------------------------------------------------------------
--  `shop.name` was seeded as 'OG' back when nothing read it. Now the browser
--  hydrates its own CONFIG from this table -- which is right, because a manager
--  changing the shop's name in Settings must change it everywhere, not just on
--  whichever screens happen to have a hardcoded copy.
--
--  The consequence was immediate and visible: the printed receipt's header,
--  which was decided as "OG SPORTS large with Sneakers & Streetwear under it",
--  came out reading "OG". The frontend was not wrong to trust the server. The
--  server was holding the wrong string.
--
--  Guarded so it only corrects the seeded placeholder. If somebody has already
--  set a real name here, that is a deliberate choice and a migration has no
--  business overwriting it.
-- =============================================================================

UPDATE config
   SET value = 'OG Sports', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE key = 'shop.name' AND value = 'OG';

--  The city the till prefills when a new customer is added at the counter.
--  Most people who walk in are from Aleppo; the field stays editable.
INSERT INTO config (key, value, updated_at)
VALUES ('shop.city', 'Aleppo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (key) DO NOTHING;

--  NOTE: `shop.address` is still the placeholder 'Aleppo, Syria'. The street
--  and district have been asked for and not yet supplied. It is deliberately
--  left as-is rather than guessed -- a receipt carrying an invented address is
--  worse than one carrying an obviously incomplete one.
