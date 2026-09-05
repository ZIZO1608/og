-- =============================================================================
--  One product label, whichever door it is printed from.
-- -----------------------------------------------------------------------------
--  Until now the shop had THREE ways to print a product label, and they did
--  not agree on what the barcode carried:
--
--    the Print-labels screen, the Products row button and every bulk
--    selection  ->  a `label_templates` row rendered on the server, Code 128
--                   of the numeric label_code (or the EAN-13 where it fits);
--    the Products drawer's footer, the scan result and the Warehouse form
--               ->  a browser "Label Studio" with its own layouts, Code 128 of
--                   the SKU text — twice as wide, and for a product not yet
--                   saved, an EAN-13 the browser had INVENTED and the server
--                   would never issue;
--    the 60x40 "product label" in js/labels60.js
--               ->  a third layout, browser-printed, label_code again, and the
--                   only one that said which shelf the pair belongs on.
--
--  Same shoe, three stickers, two of which scanned to it and one of which
--  never could. All three doors now open the same template preview, and the
--  template engine gained a `shelf` slot so the one thing the 60x40 label had
--  that the others did not survives the merge. shelves.js already counts
--  labels printed from a template with an `on` shelf slot as ones a
--  reassignment makes stale — it anticipated exactly this.
--
--  The 60x40 row is re-laid out here for the roll it is named after: 480 x
--  320 dots with a 3 mm safe margin (24 dots) all round, the size big enough
--  to pick by, the shelf beside it, the barcode across the full width. Price
--  and date stay OFF — a price on a barcode sticker turns every price change
--  into a reprint of the shelf; the "Retail price tag" template is for the
--  sticker that is meant to carry one. Nothing about the other seven rows
--  moves. label_templates is a mirror-shape table, so this row reaches
--  Supabase whole on the next sync with no mirror file to run.
-- =============================================================================

UPDATE label_templates
   SET name       = '60 x 40mm (shelf return)',
       name_ar    = '٦٠ × ٤٠ ملم (مع الرف)',
       slots      =
         '[{"kind":"logo","on":true,"xDots":24,"yDots":24,"wDots":48,"hDots":48},' ||
          '{"kind":"name","on":true,"xDots":84,"yDots":24,"wDots":372,"hDots":48,"lines":2},' ||
          '{"kind":"variant","on":true,"xDots":24,"yDots":82,"wDots":200,"hDots":32},' ||
          '{"kind":"shelf","on":true,"xDots":232,"yDots":86,"wDots":224,"hDots":28,"fontSize":"L","align":"right"},' ||
          '{"kind":"barcode","on":true,"xDots":24,"yDots":124,"wDots":432,"hDots":120,"barcodeType":"auto","showHri":true},' ||
          '{"kind":"price","on":false,"xDots":24,"yDots":256,"wDots":432,"hDots":32,"fontSize":"M","align":"left","currencyPrefix":"","currencySuffix":"","thousands":true},' ||
          '{"kind":"date","on":false,"xDots":340,"yDots":296,"wDots":110,"hDots":16}]',
       updated_at = '2026-09-05T00:00:00.000Z'
 WHERE key = '60x40';
