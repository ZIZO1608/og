-- =============================================================================
--  032 — the eight accounts the mirror has and the shop does not   (day shift 06)
-- -----------------------------------------------------------------------------
--  `npm run supabase:check` names them: ids 1-7 and 10. The shop removed them
--  locally (users:rebuild, night shift 01, which re-points every reference to
--  "Former staff") and the mirror kept them, because the ordinary sync only
--  ever UPSERTS users. THREE OF THEM ARE STILL ACTIVE THERE, and a restore
--  brings a mirrored account back with its sealed password — so a laptop
--  rebuilt from this mirror would get three extra manager logins.
--
--  THE REPAIR IS NOT THIS FILE. It is, from the shop laptop that owns the
--  mirror:
--
--      cd server && npm run users:mirror              (dry run, changes nothing)
--      cd server && npm run users:mirror -- --apply   (does it)
--
--  which re-points every row in the mirror that names one of these ids
--  (sales.cashier_id, deliveries, stock movements, append-only tables too) to
--  the local "Former staff" record, #21, and only then deletes them. A bare
--  DELETE below would be refused by a foreign key, or — where there is none —
--  leave history pointing at nobody. The dry run on 22 Sep 2026 said:
--      8 to remove: hussam → #21, lubna → #21, maher → #21, talal → #21,
--                   yalla → #21, mirrortest → #21, owner → #21, zaren → #21
--
--  Nothing here is required by the columns check: `pw_box` and `last_login_at`
--  are local-only BY DESIGN and are not added to the mirror (see the note in
--  server/scripts/supabase-check.js). No column file exists for them on purpose.
-- =============================================================================

-- 1. Look (safe, read-only). Paste this alone first.
SELECT id, username, name, role, active, created_at, updated_at
FROM users
WHERE id IN (1, 2, 3, 4, 5, 6, 7, 10)
ORDER BY id;

-- 2. Switch the three live ones OFF without deleting anything (safe, reversible).
--    Worth doing even before users:mirror runs: a restore would then bring
--    them back disabled. Ahmad decides.
-- UPDATE users SET active = false WHERE id IN (6, 7, 10);

-- 3. The raw delete. DO NOT USE unless users:mirror cannot be run; it does NOT
--    re-point history first and will fail (or orphan rows) where anything
--    still names these ids. Kept commented out: Ahmad decides.
-- DELETE FROM users WHERE id IN (1, 2, 3, 4, 5, 6, 7, 10);
