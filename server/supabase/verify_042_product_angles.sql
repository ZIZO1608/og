-- =============================================================================
--  Did 042_product_angles.sql install properly?  Paste into the Supabase SQL
--  editor and run it. Read-only: it changes nothing. Every row should say ✅.
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'the product_angles table exists',
         to_regclass('public.product_angles') is not null
  union all
  select 2, 'it has every column the shop pushes',
         (select count(*) = 10 from information_schema.columns
           where table_schema = 'public' and table_name = 'product_angles'
             and column_name in ('id', 'product_id', 'colour_id', 'angle', 'url', 'thumb_url',
                                 'width', 'height', 'created_at', 'updated_at'))
  union all
  select 3, 'row level security is on',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.product_angles')), false)
  union all
  select 4, 'the shop''s key (service_role) can read and write it',
         has_table_privilege('service_role', 'public.product_angles', 'select')
     and has_table_privilege('service_role', 'public.product_angles', 'insert')
     and has_table_privilege('service_role', 'public.product_angles', 'update')
     and has_table_privilege('service_role', 'public.product_angles', 'delete')
  union all
  select 5, 'nobody outside (anon, authenticated) can read it',
         not has_table_privilege('anon', 'public.product_angles', 'select')
     and not has_table_privilege('authenticated', 'public.product_angles', 'select')
  union all
  -- Any unique index but the primary key. (Matching '%angle%' in the index's
  -- text was wrong: the table's own name holds the word, so product_angles_pkey
  -- matched and the check went red on a correct install.)
  select 6, 'no unique index on the angle (rows land one upsert at a time)',
         not exists (select 1 from pg_index i
                      where i.indrelid = to_regclass('public.product_angles')
                        and i.indisunique and not i.indisprimary)
)
select n, case when ok then '✅' else '❌' end as result, what from checks order by n;
