-- =============================================================================
--  Role permissions, editable by a manager
-- -----------------------------------------------------------------------------
--  Until now what each role could do was a constant in server/lib/auth.js, so
--  changing it meant changing code. The Settings screen had tick boxes for it,
--  but they edited an array in the browser that the server never read -- a
--  control panel that controlled nothing.
--
--  This table is now the truth. It is seeded with exactly the rules that were
--  hard-coded, so behaviour on the day of this migration is unchanged.
--
--  TWO THINGS ARE NOT NEGOTIABLE AND ARE ENFORCED IN CODE, NOT HERE:
--
--    1. `manager` always keeps config.write and staff.write. A manager who
--       removes their own access to Settings leaves nobody able to put it
--       back without opening this file by hand.
--
--    2. `partner` (Yalla Wear) can never be granted customer.read, cost.read,
--       profit.read, money.* or staff.*. They are a different company. One
--       mis-clicked tick box should not be able to hand a supplier your
--       customer list and your margins.
--
--  A CHECK constraint cannot express either rule usefully -- the first depends
--  on who is asking, the second on a prefix match -- so both live in
--  lib/auth.js where the error message can explain itself.
-- =============================================================================

CREATE TABLE role_permissions (
  role       TEXT NOT NULL CHECK (role IN
               ('manager','cashier','warehouse','delivery','partner')),
  perm       TEXT NOT NULL,
  allowed    INTEGER NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  PRIMARY KEY (role, perm)
);

CREATE INDEX role_permissions_role ON role_permissions (role);

-- ---------------------------------------------------------------------- seed
--  Every role gets a row for every permission, present or absent. Storing the
--  zeroes as well as the ones matters: it is the difference between "this role
--  is denied that" and "nobody has said yet", and a Settings grid needs to
--  draw an unticked box rather than a gap.

-- manager -- everything
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('manager','sell',1,'1970-01-01T00:00:00.000Z'),
  ('manager','refund',1,'1970-01-01T00:00:00.000Z'),
  ('manager','void',1,'1970-01-01T00:00:00.000Z'),
  ('manager','stock.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','stock.move',1,'1970-01-01T00:00:00.000Z'),
  ('manager','stock.count',1,'1970-01-01T00:00:00.000Z'),
  ('manager','product.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','product.write',1,'1970-01-01T00:00:00.000Z'),
  ('manager','customer.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','customer.write',1,'1970-01-01T00:00:00.000Z'),
  ('manager','cost.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','profit.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','money.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','money.write',1,'1970-01-01T00:00:00.000Z'),
  ('manager','staff.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','staff.write',1,'1970-01-01T00:00:00.000Z'),
  ('manager','print.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','print.write',1,'1970-01-01T00:00:00.000Z'),
  ('manager','partner.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','partner.write',1,'1970-01-01T00:00:00.000Z'),
  ('manager','config.write',1,'1970-01-01T00:00:00.000Z'),
  ('manager','report.read',1,'1970-01-01T00:00:00.000Z'),
  ('manager','partner.jobs',0,'1970-01-01T00:00:00.000Z'),
  ('manager','partner.respond',0,'1970-01-01T00:00:00.000Z'),
  ('manager','partner.invoice',0,'1970-01-01T00:00:00.000Z');

-- cashier -- sells and handles customers. Deliberately no cost, no profit.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('cashier','sell',1,'1970-01-01T00:00:00.000Z'),
  ('cashier','refund',1,'1970-01-01T00:00:00.000Z'),
  ('cashier','void',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','stock.read',1,'1970-01-01T00:00:00.000Z'),
  ('cashier','stock.move',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','stock.count',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','product.read',1,'1970-01-01T00:00:00.000Z'),
  ('cashier','product.write',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','customer.read',1,'1970-01-01T00:00:00.000Z'),
  ('cashier','customer.write',1,'1970-01-01T00:00:00.000Z'),
  ('cashier','cost.read',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','profit.read',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','money.read',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','money.write',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','staff.read',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','staff.write',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','print.read',1,'1970-01-01T00:00:00.000Z'),
  ('cashier','print.write',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','partner.read',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','partner.write',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','config.write',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','report.read',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','partner.jobs',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','partner.respond',0,'1970-01-01T00:00:00.000Z'),
  ('cashier','partner.invoice',0,'1970-01-01T00:00:00.000Z');

-- warehouse -- moves stock and maintains the catalogue. Cannot sell.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('warehouse','sell',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','refund',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','void',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','stock.read',1,'1970-01-01T00:00:00.000Z'),
  ('warehouse','stock.move',1,'1970-01-01T00:00:00.000Z'),
  ('warehouse','stock.count',1,'1970-01-01T00:00:00.000Z'),
  ('warehouse','product.read',1,'1970-01-01T00:00:00.000Z'),
  ('warehouse','product.write',1,'1970-01-01T00:00:00.000Z'),
  ('warehouse','customer.read',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','customer.write',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','cost.read',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','profit.read',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','money.read',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','money.write',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','staff.read',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','staff.write',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','print.read',1,'1970-01-01T00:00:00.000Z'),
  ('warehouse','print.write',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','partner.read',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','partner.write',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','config.write',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','report.read',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','partner.jobs',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','partner.respond',0,'1970-01-01T00:00:00.000Z'),
  ('warehouse','partner.invoice',0,'1970-01-01T00:00:00.000Z');

-- delivery -- read-only: what to take out and to whom.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('delivery','sell',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','refund',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','void',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','stock.read',1,'1970-01-01T00:00:00.000Z'),
  ('delivery','stock.move',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','stock.count',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','product.read',1,'1970-01-01T00:00:00.000Z'),
  ('delivery','product.write',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','customer.read',1,'1970-01-01T00:00:00.000Z'),
  ('delivery','customer.write',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','cost.read',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','profit.read',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','money.read',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','money.write',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','staff.read',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','staff.write',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','print.read',1,'1970-01-01T00:00:00.000Z'),
  ('delivery','print.write',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','partner.read',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','partner.write',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','config.write',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','report.read',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','partner.jobs',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','partner.respond',0,'1970-01-01T00:00:00.000Z'),
  ('delivery','partner.invoice',0,'1970-01-01T00:00:00.000Z');

-- partner -- Yalla Wear. Their own jobs and nothing else, ever.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('partner','sell',0,'1970-01-01T00:00:00.000Z'),
  ('partner','refund',0,'1970-01-01T00:00:00.000Z'),
  ('partner','void',0,'1970-01-01T00:00:00.000Z'),
  ('partner','stock.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','stock.move',0,'1970-01-01T00:00:00.000Z'),
  ('partner','stock.count',0,'1970-01-01T00:00:00.000Z'),
  ('partner','product.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','product.write',0,'1970-01-01T00:00:00.000Z'),
  ('partner','customer.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','customer.write',0,'1970-01-01T00:00:00.000Z'),
  ('partner','cost.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','profit.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','money.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','money.write',0,'1970-01-01T00:00:00.000Z'),
  ('partner','staff.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','staff.write',0,'1970-01-01T00:00:00.000Z'),
  ('partner','print.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','print.write',0,'1970-01-01T00:00:00.000Z'),
  ('partner','partner.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','partner.write',0,'1970-01-01T00:00:00.000Z'),
  ('partner','config.write',0,'1970-01-01T00:00:00.000Z'),
  ('partner','report.read',0,'1970-01-01T00:00:00.000Z'),
  ('partner','partner.jobs',1,'1970-01-01T00:00:00.000Z'),
  ('partner','partner.respond',1,'1970-01-01T00:00:00.000Z'),
  ('partner','partner.invoice',1,'1970-01-01T00:00:00.000Z');
