-- =============================================================================
--  027 — owner and developer, and access per person  (local 059)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, after 026, BEFORE npm run users:mirror.
--  Until it is run the mirror refuses every owner or developer account (the
--  role check), which takes the users push down with it; user_permissions is
--  skipped by name; the boot pull refuses with `drift`.
--
--  The role checks are 001's inline CHECKs, so they are dropped and written
--  again. user_permissions: pushed whole, deletes follow. RLS on, no policies.
-- =============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN
  ('owner','developer','manager','cashier','warehouse','delivery','partner'));

ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_role_check CHECK (role IN
  ('owner','developer','manager','cashier','warehouse','delivery','partner'));

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm       TEXT NOT NULL,
  allowed    BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by BIGINT,
  PRIMARY KEY (user_id, perm)
);
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
