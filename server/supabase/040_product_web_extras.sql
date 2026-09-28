-- =============================================================================
--  040 — A PRODUCT'S DESCRIPTION AND "GOES WELL WITH" (local 070, contract v1.5)
-- -----------------------------------------------------------------------------
--  Paste the whole file into the Supabase SQL editor and run it once, AFTER
--  037_web_products.sql. Safe to run again. Then run
--  verify_040_product_web_extras.sql, and `npm run supabase:reconcile` from
--  server/ to fill the three columns in for products pushed before this.
--
--  WHY
--    The owner now types a product's description (English and Arabic) and its
--    "goes well with" list in OG System instead of on the website (local
--    migration 070). The website reads products from here (web_products, 037),
--    so the answer here must carry them too:
--      description   {en, ar} — plain text, \n a line break; either may be
--                    null, and the whole field is null when both are.
--      pairsWith     [57, 61, 12] — other products' ids in the owner's order,
--                    at most 12; only ids of products that exist. The website
--                    skips any that is not published or not in stock.
--
--  WHAT IT CHANGES
--    * public.products gains description_en, description_ar, pairs_with (text,
--      the list as the laptop stores it: '[57,61,12]'). Until this is run the
--      laptop pushes products without them (lib/mirror-lag.js) and says so —
--      and ONLY them: on_web and image_url still go up.
--    * web.pairs_of(text) and web.product_row: THE SAME TEXT AS IN 037 (037
--      was updated with it, so running 037 again after this changes nothing).
--      web_products and web_product are unchanged; their `version` moves once.
--
--  KEEP IN STEP: webRow() / pairsOf() in server/lib/catalogue.js are the other
--  copy. _nightshift/usd-prices/parity.mjs compares the two answers, and
--  _nightshift/web-extras/parity.mjs checks 037 and 040 hold the same text.
-- =============================================================================

alter table public.products add column if not exists description_en text;
alter table public.products add column if not exists description_ar text;
alter table public.products add column if not exists pairs_with     text;

comment on column public.products.description_en is 'The product''s description in English, plain text (local 070). Null = none.';
comment on column public.products.description_ar is 'The product''s description in Arabic, plain text (local 070). Null = none.';
comment on column public.products.pairs_with     is '"Goes well with": a JSON list of product ids in the owner''s order, at most 12 (local 070). Null = none.';

-- "Goes well with" read back (v1.5): whole positive numbers, each once, first
-- kept, only products that exist, in order. Anything unreadable is an empty
-- list — a bad value must never cost the website the product itself.
-- KEEP IN STEP with pairsOf() in server/lib/catalogue.js. Same text in 040.
create or replace function web.pairs_of(p_raw text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_list jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_e    jsonb;
  v_n    numeric;
begin
  if p_raw is null or p_raw = '' then return v_out; end if;
  begin
    v_list := p_raw::jsonb;
  exception when others then
    return v_out;
  end;
  if jsonb_typeof(v_list) <> 'array' then return v_out; end if;
  for v_e in select e.value from jsonb_array_elements(v_list) with ordinality as e(value, o) order by e.o loop
    if jsonb_typeof(v_e) <> 'number' then continue; end if;
    v_n := (v_e #>> '{}')::numeric;
    if v_n <> trunc(v_n) or v_n <= 0 or v_n > 9007199254740991 then continue; end if;
    if v_out @> jsonb_build_array(v_n::bigint) then continue; end if;
    if not exists (select 1 from public.products p where p.id = v_n::bigint) then continue; end if;
    v_out := v_out || jsonb_build_array(v_n::bigint);
  end loop;
  return v_out;
end;
$$;

-- One published product as the website sees it, or null when no colour of it
-- has both photos. KEEP IN STEP with webRow() in server/lib/catalogue.js.
-- THE SAME TEXT IS IN 037 AND 040 (v1.5 added description and pairsWith), so
-- running either file again leaves the same function. The two v1.5 columns
-- are read through to_jsonb(row): before 040 has added them they are simply
-- absent, and the fields read null / [] rather than the call failing.
create or replace function web.product_row(p_id bigint, p_rate jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p       public.products%rowtype;
  v_colours jsonb;
  v_sizes   jsonb;
  v_first   jsonb;
  v_cat     jsonb;
  v_exp     integer;
  v_more    jsonb;
begin
  select * into v_p from public.products p
   where p.id = p_id and not p.hidden and p.on_web and not p.demo;
  if not found then return null; end if;
  v_more := to_jsonb(v_p);

  -- Each ready colour, its photos in the website's order, and its sizes.
  with ready as (
    select c.id, c.name_en, c.name_ar, c.hex, c.sort
      from public.product_colours c
     where c.product_id = v_p.id
       and exists (select 1 from public.product_photos x where x.colour_id = c.id and x.product_id = v_p.id and x.kind = 'model')
       and exists (select 1 from public.product_photos x where x.colour_id = c.id and x.product_id = v_p.id and x.kind = 'product')
  ),
  sizes as (
    select v.sku, v.size, v.colour_id,
           coalesce((select sum(s.qty) from public.stock s where s.sku = v.sku), 0) > 0 as in_stock
      from public.variants v
     where v.product_id = v_p.id and v.colour_id in (select id from ready)
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
                'id', r.id, 'en', r.name_en, 'ar', r.name_ar, 'hex', r.hex,
                'imageUrl', (select x.url from public.product_photos x
                              where x.colour_id = r.id and x.product_id = v_p.id
                              order by case x.kind when 'model' then 0 when 'product' then 1 else 2 end, x.sort, x.id
                              limit 1),
                'photos', (select jsonb_agg(jsonb_build_object(
                                     'kind', x.kind, 'url', x.url,
                                     'thumbUrl', coalesce(nullif(x.thumb_url, ''), x.url),
                                     'width', x.width, 'height', x.height)
                                   order by case x.kind when 'model' then 0 when 'product' then 1 else 2 end, x.sort, x.id)
                             from public.product_photos x
                            where x.colour_id = r.id and x.product_id = v_p.id),
                'sizes', coalesce((select jsonb_agg(jsonb_build_object('size', z.size, 'sku', z.sku, 'inStock', z.in_stock)
                                                    order by z.size collate "C", z.sku collate "C")
                                     from sizes z where z.colour_id = r.id), '[]'::jsonb))
              order by r.sort, r.id) from ready r), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('size', z.size, 'sku', z.sku, 'colourId', z.colour_id, 'inStock', z.in_stock)
                               order by z.size collate "C", z.sku collate "C") from sizes z), '[]'::jsonb)
    into v_colours, v_sizes;

  if jsonb_array_length(v_colours) = 0 then return null; end if;
  v_first := v_colours -> 0 -> 'photos';

  select jsonb_build_object('id', c.id, 'en', c.name_en, 'ar', c.name_ar) into v_cat
    from public.categories c where c.id = v_p.type;
  if v_cat is null then
    v_cat := jsonb_build_object('id', v_p.type, 'en', v_p.type, 'ar', v_p.type);
  end if;

  select cu.minor_exp into v_exp from public.currencies cu where cu.code = v_p.currency;

  return jsonb_build_object(
    'id', v_p.id,
    'name', v_p.name,
    'brand', v_p.brand,
    'type', v_p.type,
    'category', v_cat,
    'colorway', v_p.colorway,
    'madeIn', v_p.made_in,
    'image', jsonb_build_object('bg', v_p.image_bg, 'initials', v_p.image_initials,
                                'url', v_first -> 0 ->> 'url', 'thumbUrl', v_first -> 0 ->> 'thumbUrl'),
    'photos', v_first,
    'price', v_p.selling_price,
    'currency', v_p.currency,
    'minorExp', v_exp,
    'prices', web.product_prices(v_p.currency, v_p.selling_price, (p_rate ->> 'rate')::double precision),
    'rate', p_rate,
    'sizes', v_sizes,
    'colours', v_colours,
    'inStock', exists (select 1 from jsonb_array_elements(v_sizes) z where (z ->> 'inStock')::boolean),
    -- v1.5: null when there is no description in either language.
    'description', case when coalesce(v_more ->> 'description_en', '') <> ''
                          or coalesce(v_more ->> 'description_ar', '') <> ''
                        then jsonb_build_object('en', nullif(v_more ->> 'description_en', ''),
                                                'ar', nullif(v_more ->> 'description_ar', ''))
                        end,
    'pairsWith', web.pairs_of(v_more ->> 'pairs_with'),
    'updatedAt', to_char(v_p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  Who may call what: the helpers are nobody's, as in 037.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['web.pairs_of(text)', 'web.product_row(bigint, jsonb)'] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated, service_role', v_fn);
  end loop;
end $$;
