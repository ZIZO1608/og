-- =============================================================================
--  061 — orders placed on the website, as this laptop collected them
-- -----------------------------------------------------------------------------
--  The website never talks to this laptop to place an order: it leaves the
--  order in Supabase (server/supabase/030_web_orders.sql, web.orders) and
--  server/lib/weborders.js collects it here every minute while the mirror is
--  live. One row per website order, keyed on the website's own order number.
--
--  THE ROW IS A QUEUE, NOT AN ORDER. Nothing here moves stock or money. A
--  person calls the customer and presses Accept, which opens the order desk
--  filled in; the desk's own Save writes the sale, the delivery and the
--  payments through Orders.create, and only then does this row say
--  'accepted' and name the sale. Reject says why, in a code the website
--  shows the customer.
--
--  NOT MIRRORED, for inbox_applied's reason: the cloud already holds every
--  website order in web.orders, and an order still waiting for a yes is
--  handed to whichever laptop owns the mirror next (web_orders_take gives it
--  back to a new lineage). An accepted one lives on as its sale, which IS
--  mirrored. LOCAL_ONLY in scripts/supabase-check.js; no server/supabase
--  file; lib/drift.js checks only its PUSHED list.
--
--  cloud_state is what the cloud has been told — 'received:<revision>',
--  'accepted' or 'rejected' — so a report lost to a dropped line is sent again
--  on the next pass rather than forgotten.
-- =============================================================================

CREATE TABLE IF NOT EXISTS web_orders (
  ref          TEXT    PRIMARY KEY,
  revision     INTEGER NOT NULL,
  state        TEXT    NOT NULL DEFAULT 'new'
                       CHECK (state IN ('new', 'accepted', 'rejected')),
  payload      TEXT    NOT NULL,
  placed_at    TEXT    NOT NULL,
  received_at  TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  proof_file   TEXT,
  proof_ref    TEXT,
  job_ids      TEXT    NOT NULL DEFAULT '[]',
  print_error  TEXT,
  sale_id      TEXT,
  reject_code  TEXT,
  reject_note  TEXT,
  decided_at   TEXT,
  decided_by   INTEGER,
  cloud_state  TEXT,
  cloud_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_web_orders_state ON web_orders (state, placed_at);
