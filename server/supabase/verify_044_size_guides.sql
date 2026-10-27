-- =============================================================================
--  Did 044_size_guides.sql install properly?  Paste into the Supabase SQL
--  editor and run it. Read-only: it changes nothing. Every row should say ✅.
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'the size_charts table exists with every column the shop pushes',
         (select count(*) = 13 from information_schema.columns
           where table_schema = 'public' and table_name = 'size_charts'
             and column_name in ('id', 'name_en', 'name_ar', 'type', 'measures', 'rows', 'fit', 'note_en',
                                 'note_ar', 'active', 'created_at', 'created_by', 'updated_at'))
  union all
  select 2, 'the product_size_guides table exists with every column the shop pushes',
         (select count(*) = 10 from information_schema.columns
           where table_schema = 'public' and table_name = 'product_size_guides'
             and column_name in ('product_id', 'chart_id', 'follows', 'measures', 'rows', 'fit', 'note_en',
                                 'note_ar', 'updated_at', 'updated_by'))
  union all
  select 3, 'row level security is on for both',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.size_charts')), false)
     and coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.product_size_guides')), false)
  union all
  select 4, 'the shop''s key (service_role) can read and write both',
         has_table_privilege('service_role', 'public.size_charts', 'select,insert,update,delete')
     and has_table_privilege('service_role', 'public.product_size_guides', 'select,insert,update,delete')
  union all
  select 5, 'nobody outside (anon, authenticated) can read either table',
         not has_table_privilege('anon', 'public.size_charts', 'select')
     and not has_table_privilege('authenticated', 'public.size_charts', 'select')
     and not has_table_privilege('anon', 'public.product_size_guides', 'select')
     and not has_table_privilege('authenticated', 'public.product_size_guides', 'select')
  union all
  select 6, 'web.size_guide_of exists',
         to_regprocedure('web.size_guide_of(bigint)') is not null
  union all
  select 7, 'the website (anon) may call web_size_guide',
         to_regprocedure('public.web_size_guide(text, bigint)') is not null
     and has_function_privilege('anon', 'public.web_size_guide(text, bigint)', 'execute')
  union all
  select 8, 'a wrong key is refused',
         (public.web_size_guide('not the key', 1) ->> 'code') = 'bad_key'
)
select n, what, case when ok then '✅' else '❌' end as result from checks order by n;
