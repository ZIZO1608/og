-- =============================================================================
--  Taking money in, and deciding who may be trusted with credit
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. debt.collect
-- -----------------------------------------------------------------------------
--  Added NOW rather than earlier, because the button finally exists. A
--  permission with nothing behind it is a tick box that teaches people the
--  grid is decoration.
--
--  A CASHIER NEEDS THIS AND MUST NOT NEED money.read. When a customer settles
--  up in cash the money lands in her drawer, during her shift — and if she
--  cannot record it, her count comes up over at closing with no explanation,
--  which is the single worst thing a till can do to somebody's evening. So
--  the act of TAKING a payment is its own permission, separate from the right
--  to look at the shop's money screen.
--
--  It does not start with `money.`, which matters: FORBIDDEN in
--  server/lib/auth.js tests the partner's ban with p.startsWith('money.'), and
--  a permission named `money.collect` would have been banned for free while
--  this one has to be listed by name. It is listed. Yalla Wear is a different
--  company and must never be able to take the shop's money.
--
--  Everyone else off. A driver collecting cash on delivery is a real thing,
--  but it goes through the delivery's own `collected` column, not through a
--  debt payment against an invoice.
-- -----------------------------------------------------------------------------

INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('manager',   'debt.collect', 1, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'debt.collect', 1, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'debt.collect', 0, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'debt.collect', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'debt.collect', 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT (role, perm) DO NOTHING;


-- -----------------------------------------------------------------------------
--  2. A credit limit, and a flag for the people who get none
-- -----------------------------------------------------------------------------
--  Neither existed. Today any cashier can sell any amount on credit to
--  anybody, and — worse — a WALK-IN can be sold on credit, which books a debt
--  against nobody at all. There is no name to chase, no phone to ring, and the
--  money simply never arrives.
--
--  Both nullable, and null means "no opinion":
--
--    credit_limit  IN USD MINOR UNITS (cents). NULL = no limit set. Not 0,
--                  which means "no credit at all" and is a completely
--                  different instruction — which is why the column is
--                  nullable rather than DEFAULT 0.
--    no_credit     the flag. 0/1.
--
--  USD, NOT LIRA, and that is the whole decision. A limit written in lira
--  decays as the currency moves: 500,000 was a month's wages once and is a
--  pair of shoes now, so a ceiling set last year quietly stops being a
--  ceiling without anybody changing it. A limit in dollars means the same
--  thing next year as it does today.
--
--  What is owed is compared against it by converting each open debt AT ITS
--  OWN FROZEN fx_rate and summing in USD — the identical arithmetic to
--  customers.spent_usd_equiv, which is exactly what that figure was built
--  for. Summing sales.total across currencies would be the same mistake
--  Stage A removed from total_spent: a $45 sale and a 45-lira sale are not
--  90 of anything.
--
--  THE LIMIT WARNS, THE FLAG REFUSES. That split is deliberate and it is the
--  shop's own shape: a regular going 20,000 over his limit on a Thursday is a
--  judgement the person at the counter is allowed to make, and a system that
--  refuses it teaches them to stop attaching customers to sales at all. A
--  no-credit flag is not a judgement — it is the owner having already decided.
--
--  Selling on credit with NO customer attached is refused outright, and that
--  one is not a policy question: a debt owed by nobody is not a debt.
-- -----------------------------------------------------------------------------

ALTER TABLE customers ADD COLUMN credit_limit INTEGER;
ALTER TABLE customers ADD COLUMN no_credit    INTEGER NOT NULL DEFAULT 0;


-- -----------------------------------------------------------------------------
--  3. Where a merged customer went
-- -----------------------------------------------------------------------------
--  Mixed-script names guarantee duplicates within a month, so the shop needs a
--  merge — and a merge must not delete. Deleting takes the audit trail with it
--  and leaves every invoice that named the losing row pointing at nothing.
--
--  So the loser is ARCHIVED with a pointer to the survivor. Anything still
--  holding the old id can follow it, and "these two were the same person" stays
--  a recorded fact rather than an inference from an empty row.
-- -----------------------------------------------------------------------------

ALTER TABLE customers ADD COLUMN merged_into INTEGER REFERENCES customers(id);

CREATE INDEX customers_merged_into ON customers (merged_into) WHERE merged_into IS NOT NULL;
