-- =============================================================================
--  048 — who asked to be told when an order moves
-- -----------------------------------------------------------------------------
--  Web Push, for the customer's tracking page (/i/<token>) and for the office's
--  own browsers. See server/lib/webpush.js and server/lib/tracking.js.
--
--  NOT MIRRORED, deliberately, for the reason partner_events is not: this is
--  delivery state about browsers, not a fact about the shop. A subscription is
--  bound to the key pair below; a laptop restored from the cloud has an empty
--  push_keys, mints its own, and every row copied across would be dead on
--  arrival. No server/supabase file, no mirror-lag.js entry — lib/drift.js
--  checks only the tables in its PUSHED list, so supabase:drift stays green.
--
--  push_keys — the VAPID key pair, one row. The private half is a JWK and never
--    leaves this table: not `config` (GET /api/config hands config to every
--    login), not server/.env (a key copied by hand is a key that goes missing
--    on the next laptop, silently killing every subscription made with it).
--
--  push_subscriptions — one row per browser, audience and order. The same
--    phone can follow two orders from one service-worker registration, so the
--    endpoint alone is not unique. No foreign keys, the call 041 and 042 made
--    for the outbox: a purged sale or a deleted account must not be refused
--    because a browser once asked about it.
--
--  push_seen — which of an order's public events have already been announced.
--    The event list is derived (lib/receipt.js events()), so "already said" has
--    to live somewhere: a restart, or two routes touching one order in the same
--    second, must not say "delivered" twice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS push_keys (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  public_key  TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint   TEXT    NOT NULL,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  audience   TEXT    NOT NULL CHECK (audience IN ('track', 'staff')),
  sale_id    TEXT,
  user_id    INTEGER,
  lang       TEXT    NOT NULL DEFAULT 'ar',
  created_at TEXT    NOT NULL,
  last_ok_at TEXT,
  fails      INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_push_sub
  ON push_subscriptions (endpoint, audience, COALESCE(sale_id, ''));
CREATE INDEX IF NOT EXISTS idx_push_sub_sale ON push_subscriptions (sale_id);

CREATE TABLE IF NOT EXISTS push_seen (
  sale_id TEXT PRIMARY KEY,
  keys    TEXT NOT NULL,
  at      TEXT NOT NULL
);
