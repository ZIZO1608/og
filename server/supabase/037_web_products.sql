-- =============================================================================
--  037 — THE WEBSITE READS THE PRODUCTS FROM THE CLOUD, PRICED IN BOTH CURRENCIES
-- -----------------------------------------------------------------------------
--  Paste the whole file into the Supabase SQL editor and run it once, AFTER
--  030_web_orders.sql and 036_product_photos.sql. Safe to run again: every
--  statement replaces what is there. No table is created or changed, so
--  mirror-lag.js, drift, reconcile and restore do not change. Then run
--  verify_037_web_products.sql.
--
--  WHY
--    The website read its products from the shop laptop (GET /api/ext/products),
--    so with the laptop shut the shop had no shop window. Everything that answer
--    is made of is already in this mirror — products, their colours, photos and
--    sizes, the stock, the categories, the exchange rate — and the laptop's fast
--    lane pushes a change within seconds. So the website asks HERE.
--
--    Every product is priced in dollars (local migration 067, the owner's rule),
--    and the lira is the dollar price at the newest rate, rounded to the whole
--    lira — what the till charges. The answer carries both, ready to show
--    (`prices.SYP` large, `prices.USD` small); the website never works the lira
--    out itself. The rate follows a live feed on the laptop and reaches this
--    mirror within seconds, and so the lira here follows it too: nothing in this
--    file stores a lira price.
--
--  THE SAME ANSWER AS THE LAPTOP, FIELD FOR FIELD
--    server/lib/catalogue.js webList / webById / webRow / webPrices is the other
--    copy of this rule, and the two must not disagree:
--      * published = not hidden, on the website, not demo;
--      * a colour is shown only with BOTH its model photo and its product photo
--        (066/036), and a product with no such colour is not shown at all;
--      * photos in the order model, product, then the extras by sort;
--      * a size is in stock when the stock across every place is above zero —
--        never how many;
--      * no cost, no quantity, no barcode, no shelf.
--    _nightshift/usd-prices/parity.mjs runs both on the same rows and compares
--    them. KEEP IN STEP: a change to one is a change to the other.
--
--  FUNCTIONS (all with the website key, like web_checkout)
--    public.web_products(p_key)          every published product, the rate, a
--                                        version (md5 of the answer, which moves
--                                        exactly when something shown moved —
--                                        a price, the rate, a photo, a size
--                                        selling out) and generatedAt.
--    public.web_product(p_key, p_id)     one, or {ok:false, code:'not_found'}
--                                        for a product that is absent, archived,
--                                        off the website, demo or waiting for
--                                        photos — which of those is the shop's
--                                        business.
--  Codes: bad_key, not_found.
-- =============================================================================

-- The newest USD→SYP rate: {rate, at}, or null when there is none.
create or replace function web.rate_now()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('rate', r.rate,
                            'at', to_char(r.set_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    from public.fx_rates r
   where r.base = 'USD' and r.quote = 'SYP' and r.rate > 0
   order by r.set_at desc, r.id desc
   limit 1;
$$;

-- The price in both currencies. Double precision and floor(x + 0.5), because
-- that is exactly what the laptop does (JavaScript's Math.round over
-- price / 100 * rate) — numeric arithmetic would round a half-lira the other
-- way now and then, and the website would disagree with the till by a lira.
-- KEEP IN STEP with webPrices() in server/lib/catalogue.js.
create or replace function web.product_prices(p_currency text, p_price bigint, p_rate double precision)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'USD', jsonb_build_object('amount',
             case when p_currency = 'USD' then p_price
                  when p_rate is null then null
                  else floor(p_price::double precision / p_rate * 100 + 0.5)::bigint end,
             'minorExp', 2),
    'SYP', jsonb_build_object('amount',
             case when p_currency = 'SYP' then p_price
                  when p_rate is null then null
                  else floor(p_price::double precision / 100 * p_rate + 0.5)::bigint end,
             'minorExp', 0));
$$;

-- One published product as the website sees it, or null when no colour of it
-- has both photos. KEEP IN STEP with webRow() in server/lib/catalogue.js.
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
begin
  select * into v_p from public.products p
   where p.id = p_id and not p.hidden and p.on_web and not p.demo;
  if not found then return null; end if;

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
    'updatedAt', to_char(v_p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_products — every published product. Codes: bad_key.
-- -----------------------------------------------------------------------------
create or replace function public.web_products(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate   jsonb;
  v_list   jsonb;
  v_answer jsonb;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;
  v_rate := web.rate_now();

  select coalesce(jsonb_agg(r.row order by r.name collate "C", r.id), '[]'::jsonb) into v_list
    from (select p.id, p.name, web.product_row(p.id, v_rate) as row
            from public.products p
           where not p.hidden and p.on_web and not p.demo) r
   where r.row is not null;

  v_answer := jsonb_build_object('ok', true, 'products', v_list,
                                 'count', jsonb_array_length(v_list), 'rate', v_rate);
  -- `version` is the answer's own fingerprint, taken before generatedAt is
  -- added, as web_checkout's is: it moves when anything shown moves.
  return v_answer || jsonb_build_object(
    'version', md5(v_answer::text),
    'generatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_product — one. Codes: bad_key, not_found.
-- -----------------------------------------------------------------------------
create or replace function public.web_product(p_key text, p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;
  v_row := web.product_row(p_id, web.rate_now());
  if v_row is null then return web.no('not_found'); end if;
  return jsonb_build_object('ok', true, 'product', v_row);
end;
$$;

-- -----------------------------------------------------------------------------
--  Who may call what. The helpers are nobody's; the two doors are the
--  website's (anon, with the website key) and the laptop's (service_role, with
--  the same key), so the shop can read back exactly what the website reads.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'web.rate_now()', 'web.product_prices(text, bigint, double precision)',
    'web.product_row(bigint, jsonb)',
    'public.web_products(text)', 'public.web_product(text, bigint)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated, service_role', v_fn);
  end loop;
end $$;

grant execute on function public.web_products(text)        to anon, service_role;
grant execute on function public.web_product(text, bigint) to anon, service_role;

comment on function public.web_products(text) is
  'The published catalogue for the website (037): priced in dollars with the lira at the newest rate, only colours with both photos, in stock or not per size, and a version. Website key required. Laptop twin: server/lib/catalogue.js webList.';
comment on function public.web_product(text, bigint) is
  'One published product for the website (037), or not_found. Website key required. Laptop twin: server/lib/catalogue.js webById.';
