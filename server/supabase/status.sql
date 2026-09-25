-- =============================================================================
--  WHICH OF THESE FILES HAS THIS PROJECT ACTUALLY RECEIVED?        (25 Sep 2026)
-- -----------------------------------------------------------------------------
--  Paste into Supabase → SQL Editor and run. READ-ONLY: it only looks.
--  One row per file that can be checked by what it leaves behind, with
--  `installed` true or false. The files are run by hand, nothing records that
--  they were, and the laptop cannot see functions or roles — so this is the
--  one place that answers "has 035 gone up yet?" without guessing.
--
--  The order to run anything still false is in README.md in this folder.
--  001–007 are run one by one; 008–029 and 036 go up together as CATCH-UP.sql.
--  The two tables below stand in for all of 001–029.
-- =============================================================================
SELECT f.file, f.installed, f.what
  FROM (VALUES
    ('001–007, then CATCH-UP.sql (008–029)',
       to_regclass('public.errands') IS NOT NULL AND to_regclass('public.user_permissions') IS NOT NULL,
       'the mirror''s tables, up to the safeers (028)'),
    -- CASE, not AND: Postgres does not promise to test the left side first,
    -- and has_table_privilege() on a missing table or role is an error.
    ('029_second_lock.sql',
       CASE WHEN to_regclass('public.products') IS NULL THEN false
            ELSE NOT has_table_privilege('anon', 'public.products', 'SELECT')
             AND NOT has_table_privilege('authenticated', 'public.products', 'SELECT') END,
       'the public key can read no mirror table'),
    ('030_web_orders.sql',
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'web_orders_take'),
       'the website leaves orders in the cloud'),
    ('031_web_payments.sql',
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'web' AND p.proname = 'transfer_methods'),
       'the owner chooses how the website is paid'),
    ('036_product_photos.sql',
       to_regclass('public.product_photos') IS NOT NULL,
       'a colour''s photographs (local 066)'),
    ('037_web_products.sql',
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'web_products'),
       'the website reads products, priced in both currencies'),
    ('030_erp_access.sql',
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'og_vps'),
       'og_vps, the VPS''s read-only login'),
    ('031_till_status.sql',
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'erp' AND p.proname = 'till_status'),
       'erp.till_status(): whose mirror, and when it last heard'),
    ('033_og_vps_off_web.sql',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'og_vps') THEN false
            ELSE NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                              WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname LIKE 'web\_%'
                                AND has_table_privilege('og_vps', c.oid, 'SELECT')) END,
       'og_vps reads none of the website''s own tables'),
    ('035_night_requests.sql',
       to_regclass('inbox.requests') IS NOT NULL,
       'night mode: requests wait in the cloud for the shop')
  ) AS f(file, installed, what);
