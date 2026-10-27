-- =============================================================================
--  Did 043_offers.sql install properly?  Paste into the Supabase SQL editor
--  and run it. Read-only: it changes nothing. Every row should say ✅.
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'the offers table exists',
         to_regclass('public.offers') is not null
  union all
  select 2, 'it has every column the shop pushes',
         (select count(*) = 20 from information_schema.columns
           where table_schema = 'public' and table_name = 'offers'
             and column_name in ('id', 'name_en', 'name_ar', 'note', 'kind', 'pct', 'amount', 'buy_qty',
                                 'get_qty', 'scope', 'targets', 'starts_at', 'ends_at', 'max_units',
                                 'stack_coupons', 'active', 'cover_url', 'created_at', 'created_by', 'updated_at'))
  union all
  select 3, 'sale_items has list_price and offer_id',
         (select count(*) = 2 from information_schema.columns
           where table_schema = 'public' and table_name = 'sale_items'
             and column_name in ('list_price', 'offer_id'))
  union all
  select 4, 'row level security is on',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.offers')), false)
  union all
  select 5, 'the shop''s key (service_role) can read and write it',
         has_table_privilege('service_role', 'public.offers', 'select')
     and has_table_privilege('service_role', 'public.offers', 'insert')
     and has_table_privilege('service_role', 'public.offers', 'update')
     and has_table_privilege('service_role', 'public.offers', 'delete')
  union all
  select 6, 'nobody outside (anon, authenticated) can read the table',
         not has_table_privilege('anon', 'public.offers', 'select')
     and not has_table_privilege('authenticated', 'public.offers', 'select')
  union all
  select 7, 'web.offer_of exists (the website''s badge)',
         to_regprocedure('web.offer_of(jsonb, jsonb)') is not null
  union all
  select 8, 'the website (anon) may call web_offers',
         to_regprocedure('public.web_offers(text)') is not null
     and has_function_privilege('anon', 'public.web_offers(text)', 'execute')
  union all
  select 9, 'web.product_row carries the offer',
         position('web.offer_of' in pg_get_functiondef('web.product_row(bigint, jsonb)'::regprocedure)) > 0
)
select n, case when ok then '✅' else '❌' end as result, what from checks order by n;
