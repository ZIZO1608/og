-- =============================================================================
--  Gift receipts
-- -----------------------------------------------------------------------------
--  A slip that goes in the bag with a present. One job: the person who
--  receives the gift can bring it back and exchange it, WITHOUT ever learning
--  what was paid. It proves where the item came from, what it is and when it
--  was bought, and nothing about money.
--
--  The slip itself is drawn entirely in the browser -- js/receipt.js's draw()
--  gained 'gift' as a third copy type beside 'customer' and 'shop', and the
--  money sections are simply not drawn. What lives here is the three things a
--  manager has to be able to change without a deploy, plus one column.
--
--  THE EXCHANGE WINDOW IS THE WHOLE REASON THIS FEATURE NEEDED A DECISION.
--  receipt.exchange_hours is 48 (see 022_exchange_48h.sql), which is right for
--  somebody who buys shoes and tries them at home. It is useless for a gift:
--  bought Thursday, given Saturday, opened Sunday, and the window shut on
--  Saturday morning. So gifts get their own window -- 168 hours, seven days --
--  and the shop's ordinary 48 hours is untouched.
--
--  The number is separate from the sentence for the same reason 022 split
--  them: js/receipt.js prints an actual DATE on the slip ("exchange before
--  07/09/2026") rather than "within 7 days". The recipient does not know when
--  it was bought and should not have to do the arithmetic standing at a
--  counter.
--
--  THE POLICY TEXT IS ITS OWN, not the ordinary receipt's, because two things
--  differ and both matter. The window is longer, and it has to spell out that
--  an exchange is an exchange: no cash back, and the difference is payable on
--  something dearer. An ordinary receipt never needs to say that, because the
--  customer is holding the price. On a gift slip there is no price to reason
--  from, so the rule has to be written down.
--
--  All three fall under CONFIG_WRITABLE's existing ^receipt\. prefix in
--  server/index.js, and configBlock() in server/lib/printing.js forwards every
--  receipt.* key generically -- no route change. config is a Mirror-shape
--  table in the Supabase sync (pushed whole every run), so the rows travel
--  with no sync change.
-- =============================================================================

INSERT INTO config (key, value, updated_at) VALUES
  ('receipt.gift_exchange_hours', '168', '1970-01-01T00:00:00.000Z'),
  ('receipt.gift_policy_ar',
   'يمكن استبدال القطعة خلال 7 أيام من تاريخ الشراء بإبراز هذه القسيمة، بشرط ألا تكون مستعملة. الاستبدال فقط — لا يوجد استرداد نقدي، وإذا كانت القطعة الجديدة أغلى يُدفع الفرق.',
   '1970-01-01T00:00:00.000Z'),
  ('receipt.gift_policy_en',
   'Exchange within 7 days of purchase with this slip, item unworn. Exchange only — no cash refund; if the new item costs more, the difference is payable.',
   '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
--  Which kind of paper a print attempt was: 'sale' or 'gift'.
--
--  Without it a gift slip is indistinguishable from an ordinary reprint in the
--  log, and a gift slip is precisely the one worth being able to trace: it
--  carries no prices, so it is the piece of paper somebody could use to walk
--  an exchange through the counter. Nullable with no DEFAULT because rows
--  written before this migration genuinely predate the distinction -- guessing
--  'sale' for them would be inventing a fact. New rows are defaulted in
--  server/lib/printing.js's logAttempt(), where a caller that says nothing
--  means an ordinary receipt.
--
--  print_log is an Append-only table in the Supabase sync (pushed above the
--  highest id already sent), so the new column rides along on the next run
--  with no sync change. The mirror needs the column added by hand in the
--  dashboard, same as the other schema files:
--      ALTER TABLE print_log ADD COLUMN IF NOT EXISTS kind TEXT;
-- -----------------------------------------------------------------------------

ALTER TABLE print_log ADD COLUMN kind TEXT;
