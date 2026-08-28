-- ============================================================================
-- Transaction reference on a sale
-- ----------------------------------------------------------------------------
-- Sham Cash, Fuad, Haram and card terminals all hand the cashier a reference
-- for the transfer. Until now that number lived on a phone screen for as long
-- as the cashier remembered it, and a customer coming back about a payment
-- three weeks later left nobody anything to look up.
--
-- Nullable on purpose: cash, COD and on-credit sales have no such number, and
-- the field is optional even for the methods that do — a till must not refuse
-- to sell because a reference was not typed.
-- ============================================================================

ALTER TABLE sales ADD COLUMN txn_ref TEXT;

-- Finding a sale FROM the reference is the whole point ("the customer says
-- they paid, here is their number"), so it needs to be searchable. Partial,
-- because most sales are cash and would otherwise pad the index with nulls.
CREATE INDEX sales_txn_ref ON sales (txn_ref) WHERE txn_ref IS NOT NULL;
