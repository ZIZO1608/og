-- =============================================================================
--  Expose the 3 already-built templates the client's preset picker never
--  showed: barcode-only, retail-price-tag, name-price.
-- -----------------------------------------------------------------------------
--  011_label_templates.sql seeded 8 rows in label_templates — the table the
--  server actually renders/prints from — but the client's preset chips in
--  pickerHTML() (js/labels.js) are still driven from this older
--  config.label.presets JSON snapshot (010_labels.sql, extended by
--  012_label_preset_60x40.sql), which only ever listed 5 of those 8. This
--  finishes syncing the two: every printable template is now choosable.
--
--  Dimensions/barcodeHeightMm below are read directly from each template's
--  actual slot definitions in 011_label_templates.sql, not invented:
--    - barcode-only: barcode slot hDots 96 -> 12mm; wDots 200, same as
--      30x20's barcode slot, which is allowEan:false -> kept consistent.
--    - retail-price-tag: barcode slot hDots 90 -> 11mm; wDots 280, same as
--      40x30's barcode slot, which is allowEan:true.
--    - name-price: has NO barcode slot at all (name + price only) — the new
--      hasBarcode:false marks this so the client hides the barcode-type
--      chooser entirely rather than rendering one that does nothing.
--      barcodeHeightMm/allowEan on this row are unread placeholders.
--
--  hasBarcode is a new field on every row; a preset missing it entirely
--  (e.g. one read from js/data.js's older default before this migration
--  lands) is treated as hasBarcode:true by the client, so this stays
--  backward-compatible.
--
--  An UPDATE, not another INSERT — 010_labels.sql already created this row,
--  and its ON CONFLICT (key) DO NOTHING would silently no-op a second insert.
-- =============================================================================

UPDATE config
SET value = '[{"key":"30x30","widthMm":30,"heightMm":30,"gapMm":2,"logo":"small-top","nameLines":2,"barcodeHeightMm":12,"allowEan":false,"hasBarcode":true},{"key":"30x20","widthMm":30,"heightMm":20,"gapMm":2,"logo":"omit","nameLines":1,"barcodeHeightMm":9,"allowEan":false,"hasBarcode":true},{"key":"40x30","widthMm":40,"heightMm":30,"gapMm":2,"logo":"small-top-left","nameLines":2,"barcodeHeightMm":13,"allowEan":true,"hasBarcode":true},{"key":"50x30","widthMm":50,"heightMm":30,"gapMm":2,"logo":"left-of-text","nameLines":2,"barcodeHeightMm":13,"allowEan":true,"hasBarcode":true},{"key":"60x40","widthMm":60,"heightMm":40,"gapMm":2,"logo":"small-top-left","nameLines":2,"barcodeHeightMm":14,"allowEan":true,"hasBarcode":true},{"key":"barcode-only","widthMm":30,"heightMm":20,"gapMm":2,"logo":"omit","nameLines":0,"barcodeHeightMm":12,"allowEan":false,"hasBarcode":true},{"key":"retail-price-tag","widthMm":40,"heightMm":30,"gapMm":2,"logo":"omit","nameLines":2,"barcodeHeightMm":11,"allowEan":true,"hasBarcode":true},{"key":"name-price","widthMm":30,"heightMm":30,"gapMm":2,"logo":"omit","nameLines":3,"barcodeHeightMm":0,"allowEan":false,"hasBarcode":false}]',
    updated_at = '1970-01-01T00:00:00.000Z'
WHERE key = 'label.presets';
