-- =============================================================================
--  Did 030_web_orders.sql install properly?  Paste into the Supabase SQL editor
--  and run it. Read-only: it changes nothing. Every row should say ✅; the last
--  one says ⚠️ until the key line from `npm run web:key` has been run.
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'schema web exists',
         exists (select 1 from pg_namespace where nspname = 'web')
  union all
  select 2, 'web.orders and web.settings exist, row security on',
         coalesce((select bool_and(c.relrowsecurity) and count(*) = 2
                     from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'web' and c.relname in ('orders', 'settings')), false)
  union all
  select 3, 'the six functions exist',
         (select count(*) = 6 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('web_order_submit', 'web_order_proof', 'web_order_status',
                               'web_checkout', 'web_orders_take', 'web_orders_mark'))
  union all
  select 4, 'the website (anon) can call its four',
         has_function_privilege('anon', 'public.web_order_submit(text, jsonb, text)', 'execute')
     and has_function_privilege('anon', 'public.web_order_proof(text, text, text, text)', 'execute')
     and has_function_privilege('anon', 'public.web_order_status(text, text)', 'execute')
     and has_function_privilege('anon', 'public.web_checkout(text)', 'execute')
  union all
  select 5, 'the website (anon) CANNOT call the laptop''s two',
         not has_function_privilege('anon', 'public.web_orders_take(text, integer)', 'execute')
     and not has_function_privilege('anon', 'public.web_orders_mark(text, jsonb)', 'execute')
  union all
  select 6, 'the website (anon) cannot read the orders table',
         not has_schema_privilege('anon', 'web', 'usage')
     and not has_table_privilege('anon', 'web.orders', 'select')
  union all
  select 7, 'the shop''s key (service_role) can call the laptop''s two',
         has_function_privilege('service_role', 'public.web_orders_take(text, integer)', 'execute')
     and has_function_privilege('service_role', 'public.web_orders_mark(text, jsonb)', 'execute')
  union all
  select 8, 'a wrong key is refused',
         (public.web_checkout('this-is-not-the-key-this-is-not-the-key') ->> 'code') = 'bad_key'
  union all
  select 9, 'the website key is set (run the line from npm run web:key)',
         exists (select 1 from web.settings where key = 'key_sha256')
)
select n,
       case when ok then '✅' when n = 9 then '⚠️' else '❌' end as result,
       what
  from checks
 order by n;
