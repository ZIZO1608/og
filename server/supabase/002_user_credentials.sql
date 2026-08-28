-- ===========================================================================
--  OG SYSTEM — sealed credentials on the users mirror
--  ---------------------------------------------------------------------------
--  Run this ONCE in the Supabase dashboard:
--      SQL Editor -> New query -> paste -> Run
--
--  WHAT THIS COLUMN IS
--  -------------------
--  001_mirror_schema.sql says password hashes and salts are never mirrored,
--  and that stays true: this column never receives one. It receives a sealed
--  box — AES-256-GCM ciphertext produced on the shop machine by
--  server/lib/credvault.js, using a passphrase (OG_VAULT_KEY) that is not in
--  this database, not in the repository, and not in server/.env's Supabase
--  credentials.
--
--  Postgres cannot read it. Neither can anyone holding the service_role key,
--  a database dump, or a stolen backup. Without the passphrase it is bytes.
--
--  WHY IT EXISTS
--  -------------
--  Because the mirror could restore a dead shop's products, sales and
--  customers, and then nobody could sign in to look at them. Accounts were
--  the one thing a disaster took permanently.
--
--  WHAT IS INSIDE A BOX
--  --------------------
--  The scrypt hash and salt, the password hint, and the must-change flag —
--  for ONE user. Still never a password: what is sealed was already one-way.
-- ===========================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_enc TEXT;

COMMENT ON COLUMN users.pw_enc IS
  'Sealed credential box: AES-256-GCM ciphertext of {pw_hash, pw_salt, pw_hint, must_change}, encrypted on the shop machine with OG_VAULT_KEY. Postgres cannot read it and neither can the service_role key. Null when the vault is switched off.';

-- The table comment from 001 said hashes are "never mirrored". Still true —
-- a sealed box is not a hash — but say precisely what is here now.
COMMENT ON TABLE users IS
  'Staff, for attribution. Plain password hashes and salts still never leave the shop machine; pw_enc holds a sealed box that only the shop machine''s OG_VAULT_KEY can open.';

-- Row Level Security is already enabled on this table with no policies (see
-- the tail of 001_mirror_schema.sql), so nothing below anon or service_role
-- can read the column. Restated here only because a column added later is
-- exactly the kind that gets forgotten in a policy review.
