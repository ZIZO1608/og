-- =============================================================================
--  Did 040_product_web_extras.sql install properly?  Paste into the Supabase SQL
--  editor and run it. Read-only: it changes nothing. Every row should say ✅.
--  Row 6 says ⚠️ while no product is published (nothing to look at yet).
-- =============================================================================
with checks(n, what, ok) as (
  select 1, 'products has description_en, description_ar and pairs_with',
         (select count(*) = 3 from information_schema.columns
           where table_schema = 'public' and table_name = 'products'
             and column_name in ('description_en', 'description_ar', 'pairs_with'))
  union all
  select 2, 'web.pairs_of exists, and nobody outside can call it',
         to_regprocedure('web.pairs_of(text)') is not null
     and not has_function_privilege('anon', 'web.pairs_of(text)', 'execute')
     and not has_function_privilege('authenticated', 'web.pairs_of(text)', 'execute')
  union all
  select 3, 'an unreadable list is an empty one, never an error',
         web.pairs_of(null) = '[]'::jsonb and web.pairs_of('') = '[]'::jsonb
     and web.pairs_of('not json') = '[]'::jsonb and web.pairs_of('{"a":1}') = '[]'::jsonb
  union all
  select 4, 'only whole positive ids of products that exist, each once',
         web.pairs_of('[-1, 0, 1.5, "7", true, null]') = '[]'::jsonb
     and web.pairs_of('[999999999999]') = '[]'::jsonb
  union all
  select 5, 'the website (anon) can still call web_products and web_product',
         has_function_privilege('anon', 'public.web_products(text)', 'execute')
     and has_function_privilege('anon', 'public.web_product(text, bigint)', 'execute')
  union all
  select 6, 'a published product carries description and pairsWith',
         (select (r ? 'description') and (r ? 'pairsWith')
            from (select web.product_row(p.id, web.rate_now()) as r
                    from public.products p
                   where not p.hidden and p.on_web and not p.demo) x
           where r is not null
           limit 1)
)
select n,
       case when ok then '✅' when n = 6 and ok is null then '⚠️' else '❌' end as result,
       what
  from checks
 order by n;
