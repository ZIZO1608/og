-- verify_038_coupons.sql — run after 038_coupons.sql. Every row should say ok.
SELECT 'coupons table'        AS check, CASE WHEN to_regclass('public.coupons') IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS result
UNION ALL
SELECT 'coupon_uses table',          CASE WHEN to_regclass('public.coupon_uses') IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL
SELECT 'RLS on coupons',             CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.coupons'::regclass) THEN 'ok' ELSE 'OFF' END
UNION ALL
SELECT 'RLS on coupon_uses',         CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.coupon_uses'::regclass) THEN 'ok' ELSE 'OFF' END
UNION ALL
SELECT 'service_role writes coupons', CASE WHEN has_table_privilege('service_role', 'public.coupons', 'INSERT') THEN 'ok' ELSE 'NO GRANT' END
UNION ALL
SELECT 'service_role writes uses',   CASE WHEN has_table_privilege('service_role', 'public.coupon_uses', 'INSERT') THEN 'ok' ELSE 'NO GRANT' END
UNION ALL
SELECT 'anon cannot read coupons',   CASE WHEN NOT has_table_privilege('anon', 'public.coupons', 'SELECT') THEN 'ok' ELSE 'OPEN' END
UNION ALL
SELECT 'web_coupon exists',          CASE WHEN to_regprocedure('public.web_coupon(text, text, bigint, text)') IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL
SELECT 'anon may call web_coupon',   CASE WHEN has_function_privilege('anon', 'public.web_coupon(text, text, bigint, text)', 'EXECUTE') THEN 'ok' ELSE 'NO GRANT' END
UNION ALL
SELECT 'bad key refused',            CASE WHEN (public.web_coupon('nope', 'X')) ->> 'code' = 'bad_key' THEN 'ok' ELSE 'OPEN' END;
