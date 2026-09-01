-- =============================================================================
--  Customers, stage one: the settings, and nothing else
-- -----------------------------------------------------------------------------
--  Five config rows. No table, no column, no index. Each of those was
--  considered and turned down, and the reasons are kept here so the next
--  person does not add one "to be safe":
--
--    * No UNIQUE index on customers.phone. Two people genuinely share a number
--      -- a household, a shop landline, a father whose phone his son gives at
--      the counter. The server WARNS on a duplicate (server/lib/customers.js,
--      code phone_taken) and writes the row anyway.
--    * No phone_norm column. The normalised form is arithmetic on the stored
--      string (server/lib/text.js), and a second copy of a phone is a second
--      thing to keep in step with the first.
--    * No credit limit, no blocked flag, no customer card code, no stamp or
--      redemption table, no Telegram chat id, no new permission. Each arrives
--      with the screen that reads it, not before. A column nothing writes is a
--      column that is wrong on the day something finally reads it.
--
--  customer.at_risk_days
--      "Has not been in for a while" was the literal 90 in six places in the
--      browser. This is a sneaker shop: people buy two or three times a year,
--      so ninety days flagged most of the regulars. 180 is the owner's answer,
--      and it lives here so the next change is a Settings edit, not a deploy.
--
--  loyalty.mode
--      The shop runs paper stamp cards alongside the points the till already
--      earns, and wants to choose which the screens talk about: 'points',
--      'stamps', 'both' or 'off'. Groundwork only -- nothing earns or redeems
--      a stamp anywhere yet. The three rules below are what a stamp WOULD
--      mean, so the day the screen arrives the shop's own answer is already
--      in the table rather than in somebody's head.
--
--  loyalty.stamps.required   buy this many, earn a reward.
--  loyalty.stamps.per        what earns one stamp: 'item', 'visit' or 'amount'.
--                            The shop's answer is one stamp per item, so three
--                            pairs in one visit is three stamps.
--  loyalty.stamps.min_minor  the smallest sale that earns a stamp, in minor
--                            units of the sale's own currency. 0 means any
--                            purchase counts, which is the shop's answer today.
--
--  INSERT ... ON CONFLICT DO NOTHING, the same shape 004 and 009 use, so a
--  value a manager has since set in Settings is never stomped by a redeploy.
--  config is a MIRROR-shaped table in the Supabase sync -- pushed whole on
--  every run, and a row deleted here is deleted there -- so the mirror needs
--  nothing extra for these to travel.
-- =============================================================================

INSERT INTO config (key, value, updated_at) VALUES
  ('customer.at_risk_days',    '180',    '1970-01-01T00:00:00.000Z'),
  ('loyalty.mode',             'points', '1970-01-01T00:00:00.000Z'),
  ('loyalty.stamps.required',  '10',     '1970-01-01T00:00:00.000Z'),
  ('loyalty.stamps.per',       'item',   '1970-01-01T00:00:00.000Z'),
  ('loyalty.stamps.min_minor', '0',      '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;
