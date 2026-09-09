-- =============================================================================
--  042 — a reminder can be addressed to a PERSON
-- -----------------------------------------------------------------------------
--  Until now every reminder was aimed at an AUDIENCE — 'og' or 'yalla' — and
--  nothing narrowed below that. So "the shift is still open" went to the owner
--  rather than to the cashier who left it open, and a phone was configured by
--  a manager ticking seventeen boxes rather than by the fact that its owner is
--  the warehouse.
--
--  ONE NULLABLE COLUMN, and NULL keeps meaning exactly what every row in the
--  table means today: this is for the whole side. Nothing already queued
--  changes meaning, and no backfill is needed.
--
--  NO FOREIGN KEY, deliberately. `foreign_keys = ON`, and a three-month-old
--  delivery record must not be the reason a user row cannot be deleted. 041
--  made the same call for ref_type and said why: this is a routing label, not
--  a relationship. `partner_events` is also the one table that is NEVER
--  mirrored to Supabase, so there is no server/supabase/ file to paste, no
--  mirror-lag.js entry, and `npm run supabase:drift` stays green.
--
--  WHAT THIS COLUMN DOES NOT GIVE YOU: a per-recipient delivery record. A row
--  is marked sent when ONE target lands (telegram.js), so once a message is
--  addressed the first question anybody asks — "did Lubna actually get it?" —
--  is one the outbox still cannot answer. That is a known limit, written down
--  here rather than implied away by a screen.
-- =============================================================================

ALTER TABLE partner_events ADD COLUMN to_user INTEGER;

-- No index. drain() reads a batch of twenty and filters in JS against the chat
-- list it has already loaded; an index on a column that is NULL for most rows
-- and is never a WHERE clause would be cost with no reader.

-- -----------------------------------------------------------------------------
--  WHAT A ROLE HEARS
-- -----------------------------------------------------------------------------
--  A phone linked by the person who owns it starts on `preset: 'role'`, and
--  these are what that resolves to. They are config keys rather than constants
--  so a manager can retune one without a deploy, and so they ride the mirror
--  and survive the laptop baton like every other setting.
--
--  NAMED reminders.preset.<role> AND NOT reminders.yl_<anything>: the partner's
--  own write route allows ^reminders\.yl_[a-z_]+$, so a key that happened to
--  start that way would be editable by Yalla Wear.
--
--  The money kinds appear only in the manager's. Somebody links a phone to
--  hear about stock and must not be handed the day's takings because a preset
--  was generous; turning that on stays a deliberate act on a screen that names
--  the chat it is doing it to.
-- -----------------------------------------------------------------------------

INSERT INTO config (key, value, updated_at) VALUES
  -- null means "everything", the same convention a chat's own rules use.
  ('reminders.preset.manager',  'null', '1970-01-01T00:00:00.000Z'),

  ('reminders.preset.cashier',
   '["rem_shift_open","rem_cash_variance","rem_wants_back"]',
   '1970-01-01T00:00:00.000Z'),

  ('reminders.preset.warehouse',
   '["rem_stock_out","rem_stock_critical","rem_po_late","rem_wants_back"]',
   '1970-01-01T00:00:00.000Z'),

  -- Nothing yet: the two delivery rules arrive in 043. An empty list is a real
  -- and deliberate answer — it is not the same as null, which would be
  -- everything, and a driver's phone must not start by hearing the shop.
  ('reminders.preset.delivery', '[]', '1970-01-01T00:00:00.000Z'),

  ('reminders.preset.partner',
   '["rem_yl_order_waiting","rem_yl_due","rem_yl_blocked","rem_yl_digest","rem_yl_pay_wait","order_new","order_accepted","order_declined","stage","names_ready","message","invoice_new","payment_recorded","payment_confirmed","review"]',
   '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;
