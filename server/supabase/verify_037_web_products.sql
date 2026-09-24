-- =============================================================================
--  Did 037_web_products.sql install properly?  Paste into the Supabase SQL
--  editor and run it. Read-only: it changes nothing. Every row should say ✅.
--  Row 6 says ⚠️ until the website key is set (see verify_030); row 7 says ⚠️
--  while the mirror has no exchange rate yet.
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'the three helpers exist (web.rate_now, web.product_prices, web.product_row)',
         (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'web' and p.proname in ('rate_now', 'product_prices', 'product_row'))
  union all
  select 2, 'nobody outside can call the helpers',
         not has_function_privilege('anon', 'web.rate_now()', 'execute')
     and not has_function_privilege('anon', 'web.product_row(bigint, jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'web.product_row(bigint, jsonb)', 'execute')
  union all
  select 3, 'the website (anon) can call web_products and web_product',
         has_function_privilege('anon', 'public.web_products(text)', 'execute')
     and has_function_privilege('anon', 'public.web_product(text, bigint)', 'execute')
  union all
  select 4, 'the shop''s laptop (service_role) can read them back',
         has_function_privilege('service_role', 'public.web_products(text)', 'execute')
  union all
  select 5, 'a wrong key is refused',
         public.web_products('not-the-key-not-the-key-not-the-key') ->> 'code' = 'bad_key'
  union all
  select 6, 'the website key is set',
         exists (select 1 from web.settings where key = 'key_sha256')
  union all
  select 7, 'the mirror has a dollar rate for the lira prices',
         web.rate_now() is not null
  union all
  select 8, 'a $35.00 product at 135 is 4,725 lira',
         (web.product_prices('USD', 3500, 135) -> 'SYP' ->> 'amount')::bigint = 4725
  union all
  select 9, 'the tables it reads are there (036 run first)',
         to_regclass('public.product_photos') is not null
     and to_regclass('public.product_colours') is not null
     and to_regclass('public.categories') is not null
)
select n,
       case when ok then '✅' when n in (6, 7) then '⚠️' else '❌' end as result,
       what
  from checks
 order by n;
