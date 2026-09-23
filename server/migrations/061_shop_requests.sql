-- =============================================================================
--  061 — "Waiting for the shop": the requests this laptop collected (night mode)
-- -----------------------------------------------------------------------------
--  While the laptop is off or out of reach, staff at shop.ogsports1.com/night
--  (og-bridge) can leave a REQUEST: a customer, some sizes, delivery or
--  pickup. It waits in Supabase (server/supabase/035_night_requests.sql,
--  inbox.requests). lib/requests.js collects it here with the inbox, every
--  minute the mirror is live, and a PERSON decides: accept — it becomes a
--  normal order through Orders.create, the function POST /api/orders calls —
--  or reject with a reason. Nothing is applied by itself.
--
--  LOCAL-ONLY. Never mirrored and never logChange'd: the cloud row is the
--  shared state (what night mode shows), this is the laptop's working copy.
--  A laptop that takes the baton starts with it empty and collects again —
--  an undecided request follows the lineage (035's requests_take), and one
--  already made into an order is recognised by the "[req N-0042]" marker at
--  the front of its delivery note, which IS mirrored (lib/requests.js).
--  server/scripts/supabase-check.js lists it with the other local tables.
--
--  No foreign keys, like partner_events (041): a request must never be the
--  reason a sale or a user row cannot change.
-- =============================================================================

CREATE TABLE shop_requests (
  ref          TEXT    PRIMARY KEY,            -- the cloud's ref: N-0042
  source       TEXT    NOT NULL CHECK (source IN ('night', 'web')),
  revision     INTEGER NOT NULL DEFAULT 1,
  payload      TEXT    NOT NULL,               -- JSON exactly as collected (035's v1 shape)
  by_user      TEXT,                           -- the night account that asked
  asked_at     TEXT    NOT NULL,               -- when it was asked (the cloud's created_at)
  received_at  TEXT    NOT NULL,               -- when this laptop stored it
  state        TEXT    NOT NULL DEFAULT 'waiting'
               CHECK (state IN ('waiting', 'accepted', 'rejected')),
  code         TEXT,                           -- a rejection's reason code
  reason       TEXT,                           -- a rejection's words (<= 200)
  sale_id      TEXT,                           -- the order it became
  decided_by   INTEGER,
  decided_at   TEXT,
  reported_at  TEXT                            -- when the cloud confirmed this row's latest state
);

CREATE INDEX shop_requests_state ON shop_requests (state, asked_at);
