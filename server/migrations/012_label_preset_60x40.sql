-- =============================================================================
--  Add the 60x40mm label size to the preset list a live client actually sees.
-- -----------------------------------------------------------------------------
--  011_label_templates.sql already seeded a '60x40' row in label_templates —
--  the table the server renders/prints FROM — but the browser's station/
--  preset chips in a real (non-demo) session are still driven from this
--  older config.label.presets JSON snapshot (010_labels.sql), which predates
--  that refactor and was never updated to match. Until this migration, a
--  cashier or warehouse account logged into the real server could not select
--  60x40 even though the server could already print it — only the offline
--  demo preview's separate hardcoded list needed a matching client-side fix
--  (js/labels.js's demoPresets(), js/data.js's CONFIG.LABEL_PRESETS default).
--
--  An UPDATE, not another INSERT — 010_labels.sql already created this row,
--  and its ON CONFLICT (key) DO NOTHING would silently no-op a second insert.
-- =============================================================================

UPDATE config
SET value = '[{"key":"30x30","widthMm":30,"heightMm":30,"gapMm":2,"logo":"small-top","nameLines":2,"barcodeHeightMm":12,"allowEan":false},{"key":"30x20","widthMm":30,"heightMm":20,"gapMm":2,"logo":"omit","nameLines":1,"barcodeHeightMm":9,"allowEan":false},{"key":"40x30","widthMm":40,"heightMm":30,"gapMm":2,"logo":"small-top-left","nameLines":2,"barcodeHeightMm":13,"allowEan":true},{"key":"50x30","widthMm":50,"heightMm":30,"gapMm":2,"logo":"left-of-text","nameLines":2,"barcodeHeightMm":13,"allowEan":true},{"key":"60x40","widthMm":60,"heightMm":40,"gapMm":2,"logo":"small-top-left","nameLines":2,"barcodeHeightMm":14,"allowEan":true}]',
    updated_at = '1970-01-01T00:00:00.000Z'
WHERE key = 'label.presets';
