-- =============================================================================
--  Did 045_reservations.sql install properly?  Paste into the Supabase SQL
--  editor and run it. Read-only: it changes nothing. Every row should say ✅.
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'the reservations table exists with every column the shop pushes',
         (select count(*) = 10 from information_schema.columns
           where table_schema = 'public' and table_name = 'reservations'
             and column_name in ('sale_id', 'customer_id', 'hold_until', 'deposit_min', 'deposit_pct',
                                 'min_by', 'extended', 'created_at', 'created_by', 'updated_at'))
  union all
  select 2, 'row level security is on',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.reservations')), false)
  union all
  select 3, 'the shop''s key (service_role) can read and write it',
         has_table_privilege('service_role', 'public.reservations', 'select,insert,update,delete')
  union all
  select 4, 'nobody outside (anon, authenticated) can read it',
         not has_table_privilege('anon', 'public.reservations', 'select')
     and not has_table_privilege('authenticated', 'public.reservations', 'select')
)
select n, what, case when ok then '✅' else '❌' end as result from checks order by n;
