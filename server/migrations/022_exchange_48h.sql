-- =============================================================================
--  The exchange window is 48 hours, not 7 days
-- -----------------------------------------------------------------------------
--  A shop decision, not a code one: the owner sets how long a customer has to
--  bring something back. It moved from seven days to forty-eight hours, and it
--  has to move everywhere at once -- the printed slip, the public page a QR
--  opens, and the config the Settings screen edits -- or the shop is quoting
--  two different policies to the same customer on the same sale.
--
--  UPDATE, NOT INSERT OR IGNORE. 009_receipts.sql already seeded these two
--  keys, so an INSERT would be ignored and change nothing. But an unconditional
--  UPDATE would stomp a manager who has since written their own wording, so
--  each one only moves if it is STILL EXACTLY the 009 seed text. Anything a
--  person has edited is left alone -- their sentence is a deliberate act, and
--  this migration cannot tell whether it already says 48 hours in their own
--  words.
--
--  A shop that HAS customised the text and also wants the new window changes it
--  in Settings, which is the same place they changed it the first time.
-- =============================================================================

UPDATE config
   SET value = 'يمكن استبدال القطعة خلال 48 ساعة من تاريخ الفاتورة بشرط إبراز هذه الفاتورة وعدم استخدام المنتج.',
       updated_at = '1970-01-01T00:00:00.000Z'
 WHERE key = 'receipt.policy_ar'
   AND value = 'يمكن استبدال القطعة خلال 7 أيام من تاريخ الفاتورة بشرط إبراز هذه الفاتورة وعدم استخدام المنتج.';

UPDATE config
   SET value = 'Exchange within 48 hours of purchase with this receipt. Item must be unworn.',
       updated_at = '1970-01-01T00:00:00.000Z'
 WHERE key = 'receipt.policy_en'
   AND value = 'Exchange within 7 days of purchase with this receipt. Item must be unworn.';

--  The window itself, in hours, as a number the code can do arithmetic with --
--  the two strings above are what a customer READS, this is what the public
--  receipt page COMPUTES the deadline from. Keeping the number separate from
--  the sentence is what lets that page say "expires Sunday 5:45 PM" instead of
--  making somebody add 48 hours to a timestamp in their head.
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('receipt.exchange_hours', '48', '1970-01-01T00:00:00.000Z');
