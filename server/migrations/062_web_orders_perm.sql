-- =============================================================================
--  062 — who may see and answer the website's orders
-- -----------------------------------------------------------------------------
--  The Website orders page (js/weborders.js, 061) was gated on delivery.desk,
--  which the cashier does not hold — and the owner asked (24 Sep 2026) for the
--  page to be the cashier's, the owner's and the developers' as well as the
--  manager's. So it has a permission of its own: see the orders, call the
--  customer, look at the receipt photo, reject one.
--
--  ACCEPTING is still the order desk's Save and still needs delivery.desk,
--  which this does not grant: a role that should also turn a website order
--  into a real one gets that switch in Settings → Access, deliberately, from
--  a person — the same rule 059 set for the manager's defaults.
--
--  A NEW permission, so its defaults are seeded here (053 and 054 did the
--  same), and a mirror written before it keeps this code's default on a pull
--  (unknownPerms in lib/restore.js). The partner can never be given it:
--  FORBIDDEN refuses everything starting with 'delivery.'.
-- =============================================================================

INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('owner',     'delivery.web', 1, '1970-01-01T00:00:00.000Z'),
  ('developer', 'delivery.web', 1, '1970-01-01T00:00:00.000Z'),
  ('manager',   'delivery.web', 1, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'delivery.web', 1, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'delivery.web', 0, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'delivery.web', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'delivery.web', 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT DO NOTHING;
