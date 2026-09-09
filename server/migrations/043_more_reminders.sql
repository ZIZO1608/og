-- =============================================================================
--  043 — eight more reminders: the shelves, the runs, the regulars, the morning
-- -----------------------------------------------------------------------------
--  No schema. Eight rule switches, their thresholds, and two role presets
--  widened to reach the new kinds.
--
--  TWO OF THEM SHIP OFF, and that is a decision rather than caution.
--  `size_run_broken` and `dead_stock` are JUDGEMENTS, not facts: they need a
--  threshold that will be wrong for this shop until somebody has read the
--  preview against real data. A reminder that is wrong twice is a reminder
--  nobody reads a third time, so they wait for POST /api/reminders/preview.
--
--  `on()` in reminders.js treats a MISSING key as ON, so a rule shipped
--  without its row here would be live on the day it landed. Every one of the
--  eight is named below for exactly that reason.
--
--  THE PRESETS ARE UPDATED, NOT INSERTED. 042 seeded them a moment ago and
--  nobody has had a chance to customise one; from here on they are the
--  manager's, and a later migration must not overwrite a choice. Written as
--  UPDATE ... WHERE value = '<what 042 wrote>' so a preset somebody has
--  already edited is left exactly as they left it.
-- =============================================================================

INSERT INTO config (key, value, updated_at) VALUES
  -- ---- the shelves ---------------------------------------------------------
  -- Empty on the floor with pieces in the back. The one with a sale attached
  -- to it: somebody walks twenty metres and the sale is not lost.
  ('reminders.floor_empty',      '1',  '1970-01-01T00:00:00.000Z'),
  -- Below the point where what is left lasts the lead time.
  ('reminders.reorder_due',      '1',  '1970-01-01T00:00:00.000Z'),
  -- The sizes that actually sell here are gone; the odd ends remain.
  ('reminders.size_run_broken',  '0',  '1970-01-01T00:00:00.000Z'),
  -- Pieces that have not moved at all, and the money standing in them.
  ('reminders.dead_stock',       '0',  '1970-01-01T00:00:00.000Z'),

  -- ---- the runs ------------------------------------------------------------
  ('reminders.run_out_long',     '1',  '1970-01-01T00:00:00.000Z'),
  -- Addressed to the driver: cash collected and never settled.
  ('reminders.driver_cash',      '1',  '1970-01-01T00:00:00.000Z'),

  -- ---- the regulars --------------------------------------------------------
  ('reminders.customer_quiet',   '1',  '1970-01-01T00:00:00.000Z'),

  -- ---- the morning ---------------------------------------------------------
  -- Yalla Wear have had a digest since the day the scheduler was written and
  -- the owner has had none. Carries money, so it is a MONEY_KIND: on the
  -- manager's preset, off on any newly linked chat.
  ('reminders.og_digest',        '1',  '1970-01-01T00:00:00.000Z'),
  ('reminders.og_digest_hour',   '9',  '1970-01-01T00:00:00.000Z'),

  -- ---- thresholds ----------------------------------------------------------
  -- NOT named delivery_stuck_*: reminders.delivery_stuck_hours already belongs
  -- to the PRINT rule job_stuck, and one name for two rules means editing an
  -- hour here silently retunes a job on the other side of the shop.
  ('reminders.run_hours',        '4',  '1970-01-01T00:00:00.000Z'),
  ('reminders.dead_days',        '90', '1970-01-01T00:00:00.000Z'),
  ('reminders.cover_weeks',      '2',  '1970-01-01T00:00:00.000Z'),
  ('reminders.quiet_repeat_days','7',  '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

-- The warehouse hears the four new questions about the shelves.
UPDATE config
   SET value = '["rem_stock_out","rem_stock_critical","rem_po_late","rem_wants_back","rem_floor_empty","rem_reorder_due","rem_size_run_broken","rem_dead_stock"]',
       updated_at = '1970-01-01T00:00:00.000Z'
 WHERE key = 'reminders.preset.warehouse'
   AND value = '["rem_stock_out","rem_stock_critical","rem_po_late","rem_wants_back"]';

-- A driver's phone had nothing to hear until now, which is why 042 gave it an
-- empty list rather than everything.
UPDATE config
   SET value = '["rem_run_out_long","rem_driver_cash"]',
       updated_at = '1970-01-01T00:00:00.000Z'
 WHERE key = 'reminders.preset.delivery'
   AND value = '[]';
