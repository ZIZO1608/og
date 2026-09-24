-- =============================================================================
--  Did 031_web_payments.sql install properly?  Paste into the Supabase SQL
--  editor and run it. Read-only: it changes nothing. Every row should say ✅.
--  Row 7 says ⚠️ until the website key is set (see verify_030).
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'the two helpers exist (web.transfer_methods, web.cod_on)',
         (select count(*) = 2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'web' and p.proname in ('transfer_methods', 'cod_on'))
  union all
  select 2, 'nobody outside can call the helpers',
         not has_function_privilege('anon', 'web.transfer_methods()', 'execute')
     and not has_function_privilege('authenticated', 'web.transfer_methods()', 'execute')
     and not has_function_privilege('anon', 'web.cod_on()', 'execute')
  union all
  select 3, 'the website (anon) can still call web_checkout and web_order_submit',
         has_function_privilege('anon', 'public.web_checkout(text)', 'execute')
     and has_function_privilege('anon', 'public.web_order_submit(text, jsonb, text)', 'execute')
  union all
  select 4, 'the shop''s laptop (service_role) can read web_checkout back',
         has_function_privilege('service_role', 'public.web_checkout(text)', 'execute')
  union all
  select 5, 'web_checkout is the 031 version (it mentions version and cod)',
         (select pg_get_functiondef(p.oid) like '%''version''%' and pg_get_functiondef(p.oid) like '%web.cod_on()%'
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'web_checkout')
  union all
  select 6, 'web_order_submit is the 031 version (it knows method_gone and cod_off)',
         (select pg_get_functiondef(p.oid) like '%method_gone%' and pg_get_functiondef(p.oid) like '%cod_off%'
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'web_order_submit')
  union all
  select 7, 'the website key is set',
         exists (select 1 from web.settings where key = 'key_sha256')
)
select n,
       case when ok then '✅' when n = 7 then '⚠️' else '❌' end as result,
       what
  from checks
 order by n;

-- What the website is offered right now (no key needed here — this is the
-- SQL editor, which is the owner):
select jsonb_pretty(jsonb_build_object('transfer', web.transfer_methods(), 'cod', web.cod_on())) as the_website_offers;
