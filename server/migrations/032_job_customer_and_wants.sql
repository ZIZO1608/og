-- =============================================================================
--  Two links the shop has been guessing at: who a print job is for, and who
--  asked for a size that was not on the shelf
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. print_jobs.customer_id
-- -----------------------------------------------------------------------------
--  A print job has carried `customer TEXT NOT NULL` and `phone TEXT` since 015
--  and nothing else -- a name typed at the till, matched to a person by eye.
--  In Aleppo that is not a small problem: the same customer is written in
--  Arabic on Tuesday and in Latin on Thursday, two brothers share a surname and
--  a phone, and "محمد" narrows nothing. Matching by name across two scripts
--  will confidently attach the wrong person's order.
--
--  Nullable, because most existing rows genuinely cannot be resolved and a
--  guess is worse than a blank. The free-text `customer` column STAYS: it is
--  what was written on the job at the time, the same reasoning as
--  sales.customer_name, and a job raised for somebody who is not in the
--  customer list at all still has to say who it is for.
-- -----------------------------------------------------------------------------

ALTER TABLE print_jobs ADD COLUMN customer_id INTEGER REFERENCES customers(id);

CREATE INDEX print_jobs_customer ON print_jobs (customer_id);

--  BACKFILL ONLY WHERE A SALE PROVES IT.
--
--  sale_id has been on print_jobs since 015 and is set when the till raised
--  the job, so `job -> sale -> sale.customer_id` is a fact rather than an
--  inference. Everything else is left NULL for a person to link by hand.
--
--  Deliberately NOT matched on name or phone. A phone match would be tempting
--  and is exactly the wrong instinct here: a household shares a landline, and
--  the shop has already decided (028) that a shared number is not a duplicate.
UPDATE print_jobs
   SET customer_id = (SELECT s.customer_id FROM sales s WHERE s.id = print_jobs.sale_id)
 WHERE sale_id IS NOT NULL
   AND customer_id IS NULL
   AND (SELECT s.customer_id FROM sales s WHERE s.id = print_jobs.sale_id) IS NOT NULL;


-- -----------------------------------------------------------------------------
--  2. The wants list
-- -----------------------------------------------------------------------------
--  A wants list only works if somebody fills it in, and a feature that needs a
--  new habit dies in a shop. So nothing here is typed: when a size is looked up
--  while it is OUT OF STOCK and a customer is attached, that IS the record. The
--  habit already exists -- scanning a box, searching a size for somebody
--  standing there -- and this keeps the result.
--
--  When the size lands, the list of who wanted it is already written.
--
--  variant_sku is nullable so a want can be recorded against a product and a
--  size the shop has never carried (a request for a 46 in a line that stops at
--  44). product_id + size is the pair that always exists.
CREATE TABLE wants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_id  INTEGER REFERENCES products(id),
  variant_sku TEXT    REFERENCES variants(sku),
  size        TEXT,

  --  'scan'   -- a box was scanned and the size was out
  --  'search' -- somebody looked the size up at the till and it was out
  --  'ask'    -- recorded by hand (no screen does this yet; the column exists
  --              so that adding one later is not a migration)
  source      TEXT    NOT NULL DEFAULT 'scan'
              CHECK (source IN ('scan', 'search', 'ask')),

  --  Who was serving. Not who wanted it -- that is customer_id.
  user_id     INTEGER REFERENCES users(id),
  at          TEXT    NOT NULL,

  --  Set when the want is answered, so a shop can see what it has and has not
  --  come back on. Never deleted: "we told them" is a fact worth keeping.
  closed_at   TEXT,
  closed_note TEXT
);

CREATE INDEX wants_customer ON wants (customer_id, at);
CREATE INDEX wants_variant  ON wants (variant_sku) WHERE variant_sku IS NOT NULL;
CREATE INDEX wants_open     ON wants (product_id, size) WHERE closed_at IS NULL;
