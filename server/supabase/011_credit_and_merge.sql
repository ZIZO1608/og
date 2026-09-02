-- =============================================================================
--  011 — the credit rules, and where a merged customer went
-- -----------------------------------------------------------------------------
--  RUN THIS BY HAND in the Supabase SQL editor, like 002–010 before it.
--
--  These three columns arrived with local migration 033_credit_and_collection
--  and this file was missed at the time — `npm run supabase:check` caught it:
--
--      ✗ customers   missing in Supabase: credit_limit, no_credit, merged_into
--
--  `customers` is pushed in the CORE loop, which is NOT inside a guard, and it
--  is fetched with SELECT * — so on a mirror without these columns PostgREST
--  rejects the whole batch and the shop's customer list stops mirroring
--  entirely. Exactly the sales.shift_id and stock.shelf_id situation described
--  in 006. Until this is run, every customer write waits.
--
--  WHAT THEY MEAN, because a restore has to put them back meaning the same
--  thing:
--
--    credit_limit  IN USD MINOR UNITS (cents), nullable. NULL is "no limit
--                  set"; 0 is "no credit at all". Two different instructions,
--                  which is why the column is nullable rather than DEFAULT 0 —
--                  a restore that turned NULL into 0 would silently stop every
--                  customer's credit.
--
--                  USD and not lira on purpose: a limit written in lira decays
--                  as the currency moves, so a ceiling set last year quietly
--                  stops being one. What is owed is compared against it by
--                  converting each open debt at ITS OWN frozen fx_rate.
--
--    no_credit     0/1. The owner having already decided about this person.
--                  The limit warns; this refuses.
--
--    merged_into   the surviving customer's id, when this record was merged
--                  into another. The loser is ARCHIVED with this pointer and
--                  never deleted — deleting takes the audit trail with it and
--                  leaves every invoice that named the row pointing at nobody.
--
--  No foreign key on merged_into, matching the rest of this mirror (001's
--  header says why): a restore reads rows in dependency order, and a hard FK
--  here would reject a row that merely arrived before the customer it points
--  at rather than letting it land.
-- =============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS no_credit    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS merged_into  BIGINT;

CREATE INDEX IF NOT EXISTS customers_merged_into
  ON customers (merged_into) WHERE merged_into IS NOT NULL;
