-- =============================================================================
--  Did 041_print_kits.sql install properly?  Paste into the Supabase SQL
--  editor and run it. Read-only: it changes nothing. Every row should say ✅.
--  Row 9 says ⚠️ until the shop has pushed its kits (the next sync after 041).
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'print_fonts and print_kits exist, with row level security on',
         coalesce((select bool_and(c.relrowsecurity) and count(*) = 2 from pg_class c
                    where c.oid in (to_regclass('public.print_fonts'), to_regclass('public.print_kits'))), false)
  union all
  select 2, 'the shop''s key may write them; the website''s may not read them',
         has_table_privilege('service_role', 'public.print_kits', 'insert')
     and has_table_privilege('service_role', 'public.print_fonts', 'insert')
     and not has_table_privilege('anon', 'public.print_kits', 'select')
     and not has_table_privilege('authenticated', 'public.print_fonts', 'select')
  union all
  select 3, 'the new columns: products, print_jobs, print_job_lines, deliveries, web.orders',
         (select count(*) = 6 from information_schema.columns
           where (table_schema, table_name, column_name) in (
             ('public', 'products', 'printable'), ('public', 'products', 'print_kit_id'),
             ('public', 'print_jobs', 'web_ref'), ('public', 'print_job_lines', 'print_kit_snapshot'),
             ('public', 'deliveries', 'print_override'), ('web', 'orders', 'auth_uid')))
  union all
  select 4, 'print_kit_snapshot is jsonb',
         (select data_type = 'jsonb' from information_schema.columns
           where table_schema = 'public' and table_name = 'print_job_lines' and column_name = 'print_kit_snapshot')
  union all
  select 5, 'web.orders stamps the signed-in customer on insert',
         exists (select 1 from pg_trigger where tgname = 'orders_stamp_auth_uid' and not tgisinternal)
  union all
  select 6, 'the helpers exist and nobody outside can call them',
         to_regprocedure('web.print_of(jsonb, jsonb)') is not null
     and to_regprocedure('web.kit_object(bigint, jsonb, boolean)') is not null
     and not has_function_privilege('anon', 'web.print_of(jsonb, jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'web.kit_object(bigint, jsonb, boolean)', 'execute')
  union all
  select 7, 'the website (anon) can call web_print_styles; a signed-in customer web_print_tracking',
         has_function_privilege('anon', 'public.web_print_styles(text)', 'execute')
     and has_function_privilege('authenticated', 'public.web_print_tracking(text, text)', 'execute')
     and not has_function_privilege('anon', 'public.web_print_tracking(text, text)', 'execute')
  union all
  select 8, 'web.product_row carries print (041 ran after 037 and 040)',
         position('web.print_of' in pg_get_functiondef('web.product_row(bigint, jsonb)'::regprocedure)) > 0
     and position('''unit''' in pg_get_functiondef('public.web_checkout(text)'::regprocedure)) > 0
  union all
  select 9, 'the shop''s kits have arrived, with one default',
         (select count(*) > 0 and count(*) filter (where is_default and not archived) = 1 from public.print_kits)
)
select n, case when ok then '✅' when n = 9 then '⚠️' else '❌' end as result, what
  from checks order by n;
