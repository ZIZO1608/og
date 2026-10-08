-- =============================================================================
--  072 — what Yalla Wear charges for one name + number print: 300 lira (8 Oct 2026)
-- -----------------------------------------------------------------------------
--  The owner confirmed it: Yalla Wear charges OG 300 SYP (the shop's lira) for
--  each name and number printed. It is print.partner_unit_cost, in the shop's
--  own currency, and it is now the ONE number for it in the whole system:
--
--    * the server's fallback in Partner.webPrices() was 460;
--    * the till carried its own 460 (PRINT_UNIT_COST in js/pos.js);
--    * the Print screen's new-job form and Yalla Wear's invoice builder read
--      CONFIG.KIT_PRINT_PRICE, 180 — "what OG pays Yalla Wear to print one
--      football kit — name, number, badges", the same fact a third time.
--
--  All three now read this key (the browser through CONFIG.PRINT_PARTNER_COST),
--  and a kit line sent with no cost of its own takes it on the server
--  (Partner.create). The customer's price, print.unit_price / unit_currency
--  ($5), is not touched.
--
--  EXISTING JOBS AND INVOICES ARE NOT REWRITTEN. A print job's lines and a
--  partner invoice carry the cost they were made with (print_job_lines.unit_cost,
--  the invoice's own lines); only jobs made from now on use 300.
-- =============================================================================

INSERT INTO config (key, value, updated_at) VALUES
  ('print.partner_unit_cost', '300', '2026-10-08T00:00:00.000Z')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
