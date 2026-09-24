-- =============================================================================
--  Did 036_product_photos.sql install properly?  Paste into the Supabase SQL
--  editor and run it. Read-only: it changes nothing. Every row should say ✅.
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'the product_photos table exists',
         to_regclass('public.product_photos') is not null
  union all
  select 2, 'it has every column the shop pushes',
         (select count(*) = 11 from information_schema.columns
           where table_schema = 'public' and table_name = 'product_photos'
             and column_name in ('id', 'product_id', 'colour_id', 'kind', 'url', 'thumb_url',
                                 'width', 'height', 'sort', 'created_at', 'updated_at'))
  union all
  select 3, 'row level security is on',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.product_photos')), false)
  union all
  select 4, 'the shop''s key (service_role) can read and write it',
         has_table_privilege('service_role', 'public.product_photos', 'select')
     and has_table_privilege('service_role', 'public.product_photos', 'insert')
     and has_table_privilege('service_role', 'public.product_photos', 'update')
     and has_table_privilege('service_role', 'public.product_photos', 'delete')
  union all
  select 5, 'nobody outside (anon, authenticated) can read it',
         not has_table_privilege('anon', 'public.product_photos', 'select')
     and not has_table_privilege('authenticated', 'public.product_photos', 'select')
  union all
  select 6, 'no unique index on the slot (a swap must be able to land one row at a time)',
         not exists (select 1 from pg_indexes
                      where schemaname = 'public' and tablename = 'product_photos'
                        and indexdef ilike '%unique%' and indexdef ilike '%kind%')
)
select n, case when ok then '✅' else '❌' end as result, what from checks order by n;
