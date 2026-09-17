-- =============================================================================
--  059 — owner and developer, and access per person
-- -----------------------------------------------------------------------------
--  Night shift 01, E6. The owner's decisions:
--    - two new roles, OWNER and DEVELOPER, each with every permission and the
--      full dashboard. `access.write` (open or close a permission for one
--      person) and the old pinned pair config.write + staff.write are pinned
--      to them; the MANAGER is no longer pinned.
--    - the manager's default set loses money, cost, profit, staff, settings
--      and access. That default is NOT applied here: this migration runs on
--      the shop laptop the moment the new code starts, before any owner
--      account exists, and taking Settings away from every manager then would
--      leave nobody who can open it. `npm run users:rebuild` applies it, after
--      it has created the owner and signed in as him.
--    - the warehouse adds and edits products and prices, cost included; no
--      money, customers, staff or settings.
--
--  PER-PERSON ACCESS: user_permissions holds a grant (allowed = 1) or a deny
--  (allowed = 0) on top of the role. Effective = role + grants − denies, with
--  FORBIDDEN and PINNED enforced in lib/auth.js whatever a row says. Pushed
--  whole to the mirror (WHOLE_KEYS), deletes follow.
--
--  users.pw_box: the password itself, sealed with OG_VAULT_KEY
--  (lib/credvault.js), for the developer panel's Accounts screen and nothing
--  else. Written wherever a password is set; NEVER sent over HTTP; carried
--  to the mirror only inside the already-sealed pw_enc box.
--  users.last_login_at: shown on that same screen.
--
--  THE ROLE CHECK lives inline on users and role_permissions, so both tables
--  are rebuilt — with foreign keys off around this migration (lib/
--  migration-checks.js), because ~35 tables point at users.
--
--  Mirror twin: server/supabase/027_access.sql.
-- =============================================================================

CREATE TABLE users_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN
                  ('owner','developer','manager','cashier','warehouse','delivery','partner')),
  pw_hash       BLOB NOT NULL,
  pw_salt       BLOB NOT NULL,
  pw_hint       TEXT,
  phone         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  pw_box        TEXT,
  last_login_at TEXT
);
INSERT INTO users_new (id, username, name, role, pw_hash, pw_salt, pw_hint, phone,
                       active, must_change, created_at, updated_at)
SELECT id, username, name, role, pw_hash, pw_salt, pw_hint, phone,
       active, must_change, created_at, updated_at
  FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- The last successful sign-in, from the attempts already recorded.
UPDATE users SET last_login_at = (
  SELECT MAX(a.at) FROM login_attempts a WHERE a.ok = 1 AND lower(a.username) = lower(users.username));

CREATE TABLE role_permissions_new (
  role       TEXT NOT NULL CHECK (role IN
               ('owner','developer','manager','cashier','warehouse','delivery','partner')),
  perm       TEXT NOT NULL,
  allowed    INTEGER NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
  updated_at TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  PRIMARY KEY (role, perm)
);
INSERT INTO role_permissions_new SELECT role, perm, allowed, updated_at, updated_by FROM role_permissions;
DROP TABLE role_permissions;
ALTER TABLE role_permissions_new RENAME TO role_permissions;
CREATE INDEX role_permissions_role ON role_permissions (role);

-- owner and developer: every permission there is, and access.write.
INSERT INTO role_permissions (role, perm, allowed, updated_at)
SELECT r.role, p.perm, 1, '1970-01-01T00:00:00.000Z'
  FROM (SELECT 'owner' AS role UNION ALL SELECT 'developer') r
  CROSS JOIN (SELECT DISTINCT perm FROM role_permissions
              UNION SELECT 'access.write') p
 WHERE NOT (p.perm LIKE 'partner.%' AND p.perm <> 'partner.read' AND p.perm <> 'partner.write');

-- access.write exists for every other role, off.
INSERT OR IGNORE INTO role_permissions (role, perm, allowed, updated_at)
SELECT role, 'access.write', 0, '1970-01-01T00:00:00.000Z'
  FROM (SELECT DISTINCT role FROM role_permissions WHERE role NOT IN ('owner','developer'));

-- The warehouse adds and edits products and prices, cost included; no money,
-- customers, staff or settings.
UPDATE role_permissions SET allowed = 1, updated_at = '1970-01-01T00:00:00.000Z'
 WHERE role = 'warehouse'
   AND perm IN ('stock.read','stock.move','stock.count','label.print','product.read','product.write','cost.read');
UPDATE role_permissions SET allowed = 0, updated_at = '1970-01-01T00:00:00.000Z'
 WHERE role = 'warehouse'
   AND (perm LIKE 'money.%' OR perm LIKE 'customer.%' OR perm LIKE 'staff.%'
        OR perm IN ('config.write','profit.read','debt.collect','access.write'));

-- The Telegram role presets (042): the owner and the developer hear what the
-- manager's preset says, until somebody changes theirs.
INSERT OR IGNORE INTO config (key, value, updated_at)
SELECT 'reminders.preset.' || r.role, c.value, '1970-01-01T00:00:00.000Z'
  FROM (SELECT 'owner' AS role UNION ALL SELECT 'developer') r
  JOIN config c ON c.key = 'reminders.preset.manager';

CREATE TABLE user_permissions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm       TEXT    NOT NULL,
  --  1 = granted to this person on top of the role; 0 = taken away from them.
  allowed    INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  updated_at TEXT    NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  PRIMARY KEY (user_id, perm)
);
