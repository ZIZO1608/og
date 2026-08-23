-- =============================================================================
--  Reference data the schema cannot function without
-- -----------------------------------------------------------------------------
--  Currencies and warehouses are foreign-key targets: a product cannot be
--  inserted before its currency row exists. They live in a migration rather
--  than a seed script so a fresh database is immediately usable and every
--  deployment starts from the same known state.
--
--  Business data -- products, customers, staff -- is NOT here. That is entered
--  through the app.
-- =============================================================================

-- ---------------------------------------------------------------- currencies
--  minor_exp is the number of decimal places the currency actually uses, which
--  is how code converts a stored integer back to a human number.
--    USD 1250 with minor_exp 2 -> $12.50
--    SYP 1250 with minor_exp 0 -> 1,250 SYP
--  The lira has a subunit on paper; nobody has priced anything in it for many
--  years, so treating it as 0 matches how the shop actually works.
INSERT INTO currencies (code, symbol, symbol_ar, minor_exp) VALUES
  ('SYP', 'SYP', 'ل.س', 0),
  ('USD', '$',   '$',   2);

-- ---------------------------------------------------------------- warehouses
--  Matches the two places js/data.js already models. 'floor' is where the till
--  sells from; 'store' is where deliveries land.
INSERT INTO warehouses (id, name, name_ar, kind, sort) VALUES
  ('floor', 'Shop floor',   'المحل',     'shop',    1),
  ('store', 'Back storage', 'المستودع',  'storage', 2);

-- -------------------------------------------------------------------- config
--  Settings that were constants in js/data.js. Held as text and parsed by the
--  reader, because SQLite has no useful type for "one of several shapes" and a
--  config table that pretends otherwise ends up with three unused columns.
--
--  The exchange rate is NOT here -- it belongs in fx_rates, which keeps its
--  history, because a sale has to stay reportable at the rate that applied on
--  the day it happened.
INSERT INTO config (key, value, updated_at) VALUES
  ('shop.name',            'OG',                       '1970-01-01T00:00:00.000Z'),
  ('shop.tagline',         'Sneakers & Streetwear',    '1970-01-01T00:00:00.000Z'),
  ('shop.address',         'Aleppo, Syria',            '1970-01-01T00:00:00.000Z'),
  ('shop.base_currency',   'SYP',                      '1970-01-01T00:00:00.000Z'),
  ('shop.default_wh',      'floor',                    '1970-01-01T00:00:00.000Z'),
  ('shop.intake_wh',       'store',                    '1970-01-01T00:00:00.000Z'),
  ('stock.critical',       '3',                        '1970-01-01T00:00:00.000Z'),
  ('stock.low',            '10',                       '1970-01-01T00:00:00.000Z'),
  ('loyalty.points_per_1000', '1',                     '1970-01-01T00:00:00.000Z'),
  ('loyalty.point_value',  '50',                       '1970-01-01T00:00:00.000Z'),
  ('loyalty.tier_silver',  '6000',                     '1970-01-01T00:00:00.000Z'),
  ('loyalty.tier_gold',    '12000',                    '1970-01-01T00:00:00.000Z');

-- -------------------------------------------------------------- opening rate
--  A starting USD/SYP rate so the system is arithmetically usable on first
--  run. It is a placeholder and will be wrong -- the rate moves constantly.
--  Managers change it in Settings, and every change appends a row here rather
--  than overwriting this one.
INSERT INTO fx_rates (base, quote, rate, set_at, set_by) VALUES
  ('USD', 'SYP', 13000.0, '1970-01-01T00:00:00.000Z', NULL);
