-- =============================================================================
--  Paper stamp cards, and the one thing about them that gets stored
-- -----------------------------------------------------------------------------
--  The shop runs points and physical stamp cards at the same time. Customers
--  hold the cards in their wallets; the shop stamps them by hand. Two systems
--  that disagree means the customer trusts the paper, the staff trust the
--  screen, and somebody loses an argument at the counter.
--
--  SO THE STAMP COUNT IS NOT STORED. It is the number of qualifying items
--  bought since that customer's last redemption -- derived, every time, from
--  sale_items and this table. The same reasoning as stock (an append-only
--  movement log with the total derived) and as open debts (total minus
--  payments, never a stored balance):
--
--    * voiding a sale correctly takes its stamps back, with no second write
--      to remember and no repair job when somebody forgets;
--    * there is no counter to drift, so there is nothing to reconcile;
--    * a customer who asks "how many have I got" gets an answer computed from
--      what they actually bought, not from a number somebody typed.
--
--  What IS stored is the redemption: the moment a card was cashed in, who did
--  it, what was given, and -- the load-bearing column -- how many stamps the
--  rule demanded AT THAT MOMENT.
--
--  required_then exists for the same reason sales.fx_rate does. Change the
--  rule from 10 to 8 next year and every card redeemed under the old rule must
--  keep meaning what it meant; without it, last year's redemptions silently
--  re-earn themselves the moment the config changes, and the count the shop
--  shows a customer stops being the count they were promised.
--
--  NO stamps column on customers. No 'card full' flag. A full card is a state
--  the shop reads, not a fact it writes -- see server/lib/loyalty.js.
-- =============================================================================

CREATE TABLE loyalty_redemptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  at            TEXT    NOT NULL,
  user_id       INTEGER REFERENCES users(id),

  -- How many stamps this redemption consumed. Normally `required_then`, but
  -- stored separately because a manager may honour a short card, and because
  -- the arithmetic that follows must use what was actually taken.
  stamps_used   INTEGER NOT NULL CHECK (stamps_used > 0),

  -- The rule in force when it happened. Frozen, never recomputed.
  required_then INTEGER NOT NULL CHECK (required_then > 0),

  -- What the customer was actually given. Free text on purpose: this is the
  -- owner's judgement -- a free pair, 20% off, early access to a drop -- and
  -- an enum would be a list of the things he thought of in one afternoon.
  note          TEXT,

  created_at    TEXT    NOT NULL
);

CREATE INDEX loyalty_redemptions_customer
  ON loyalty_redemptions (customer_id, at);


-- -----------------------------------------------------------------------------
--  Two config rows
-- -----------------------------------------------------------------------------
--  loyalty.redeem_block was the literal 500 in three places in js/pos.js, while
--  the point VALUE and the earn RATE beside it were already config. A number
--  that decides how much a customer can take off a sale does not belong in a
--  source file.
--
--  loyalty.void_reverses_points settles a question the code had answered by
--  accident: voiding a sale left its earned points spendable while the sale
--  itself vanished from the customer's spend. Default 1 -- claw them back --
--  because points that outlive the purchase that earned them are points the
--  shop pays out twice. It is a config key rather than a hard rule because it
--  is a policy the owner may reasonably disagree with.
-- -----------------------------------------------------------------------------

INSERT INTO config (key, value, updated_at) VALUES
  ('loyalty.redeem_block',           '500', '1970-01-01T00:00:00.000Z'),
  ('loyalty.void_reverses_points',   '1',   '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;
