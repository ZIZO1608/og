-- =============================================================================
--  070 — a product's description and "goes well with" (29 Sep 2026)
-- -----------------------------------------------------------------------------
--  Both were typed on the website until now, while every other fact about a
--  product is typed here. The website asked for them to move (contract v1.5,
--  docs/website/PROMPT-FOR-AHMAD.md §3):
--
--    description_en, description_ar   plain text, line breaks kept, NULL when
--                                     there is none in that language. One per
--                                     PRODUCT, not per colour.
--    pairs_with                       "goes well with": a JSON list of other
--                                     products' ids in the owner's order, at
--                                     most 12 ('[57,61,12]'), NULL for none.
--
--  Written only through PATCH /api/products/:id, which cleans them first
--  (cleanDescription / cleanPairs in lib/catalogue.js). No row is touched
--  here: every product starts with neither, which the website reads as "show
--  no description, and no Frequently bought together".
--
--  products is pushed in the mirror's unguarded core loop, so the three
--  columns are in lib/mirror-lag.js until cloud file 040 is run — nothing is
--  refused meanwhile, and `npm run supabase:reconcile` fills them in after.
-- =============================================================================

ALTER TABLE products ADD COLUMN description_en TEXT;
ALTER TABLE products ADD COLUMN description_ar TEXT;
ALTER TABLE products ADD COLUMN pairs_with TEXT;
