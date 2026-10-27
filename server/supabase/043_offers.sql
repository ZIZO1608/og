-- =============================================================================
--  043 — offers: sales on one product, a few, a category, a brand or the
--  whole shop  (local 076)
-- -----------------------------------------------------------------------------
--  Run this in the Supabase SQL editor, once, AFTER 037, 040 and 041. Then
--  check it with verify_043_offers.sql, and run 030_erp_access.sql again so
--  og_vps can read the new table.
--
--  Until it is run:
--    - `offers` is skipped by name behind its own guard and everything else
--      still goes up (lib/mirror.js, "Offers"); the till and the order desk
--      price offers from the shop's own database and do not need this;
--    - sale_items go up without list_price / offer_id (mirror-lag.js) — run
--      `npm run supabase:reconcile` afterwards to fill them in;
--    - the website shows no offer: web_products' `offer` reads null.
--
--  THE RULE IS IN THREE PLACES. js/offermath.js (the till, the desk and the
--  server, one file), and web.offer_of() here — the website's badge: the best
--  live per-piece offer on a product, or a buy-X-get-Y it is in. KEEP IN STEP.
--  The basket (buy 2 get 1, a flash sale running out mid-cart) is not priced
--  here: the website's cart follows the contract (§3c), and the order is
--  priced again by the shop when it is accepted.
--
--  web.product_row: THE SAME TEXT AS IN 037, 040 AND 041, which all call
--  web.offer_of by name only once this file has made it.
--
--  One table, cursor shape. RLS on, no policies: only the shop's service key
--  writes it; the website reads it only through the two functions below.
-- =============================================================================

CREATE TABLE IF NOT EXISTS offers (
  id             BIGINT PRIMARY KEY,
  name_en        TEXT    NOT NULL,
  name_ar        TEXT    NOT NULL,
  note           TEXT,
  kind           TEXT    NOT NULL CHECK (kind IN ('pct', 'off', 'price', 'bxgy')),
  pct            INTEGER,
  amount         BIGINT,
  buy_qty        INTEGER,
  get_qty        INTEGER,
  scope          TEXT    NOT NULL DEFAULT 'pick',
  targets        TEXT    NOT NULL DEFAULT '[]',
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ,
  max_units      INTEGER,
  stack_coupons  BOOLEAN NOT NULL DEFAULT FALSE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  cover_url      TEXT,
  created_at     TIMESTAMPTZ NOT NULL,
  created_by     BIGINT,
  updated_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_when ON offers (active, starts_at, ends_at);
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS list_price BIGINT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS offer_id   BIGINT;
CREATE INDEX IF NOT EXISTS sale_items_offer ON sale_items (offer_id) WHERE offer_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.offers') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.offers TO service_role';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.offers FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.offers FROM authenticated';
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
--  The rule (KEEP IN STEP with js/offermath.js)
-- -----------------------------------------------------------------------------

-- Pieces sold under an offer on sales that still stand.
create or replace function web.offer_sold(p_offer bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(i.qty), 0)::bigint
    from public.sale_items i join public.sales s on s.id = i.sale_id
   where i.offer_id = p_offer and not s.voided;
$$;

-- Does one target name this product? (offermath.js hit)
create or replace function web.offer_hit(p_t jsonb, p_id bigint, p_type text, p_brand text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_t ->> 'kind'
    when 'product'  then (p_t ->> 'ref') = p_id::text
    when 'category' then (p_t ->> 'ref') = p_type
    when 'brand'    then coalesce(p_brand, '') <> ''
                         and lower(btrim(p_t ->> 'ref')) = lower(btrim(p_brand))
    else false end;
$$;

-- Is this product on the offer? Excluded beats included; `all` is every
-- product not excluded. (offermath.js covers)
create or replace function web.offer_covers(p_scope text, p_targets text, p_id bigint, p_type text, p_brand text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb;
begin
  begin
    v := coalesce(p_targets, '[]')::jsonb;
  exception when others then
    v := '[]'::jsonb;
  end;
  if jsonb_typeof(v) <> 'array' then v := '[]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(v) t
              where coalesce((t ->> 'exclude')::boolean, false)
                and web.offer_hit(t, p_id, p_type, p_brand)) then
    return false;
  end if;
  if p_scope = 'all' then return true; end if;
  return exists (select 1 from jsonb_array_elements(v) t
                  where not coalesce((t ->> 'exclude')::boolean, false)
                    and web.offer_hit(t, p_id, p_type, p_brand));
end;
$$;

-- The website's `offer` on a product: the cheapest live per-piece offer
-- (the older one on a tie), else the first live buy-X-get-Y it is in, else
-- null. p_product is to_jsonb(products row). (lib/offers.js webOffer)
create or replace function web.offer_of(p_product jsonb, p_rate jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id     bigint := (p_product ->> 'id')::bigint;
  v_type   text   := p_product ->> 'type';
  v_brand  text   := p_product ->> 'brand';
  v_cur    text   := p_product ->> 'currency';
  v_list   bigint := (p_product ->> 'selling_price')::bigint;
  o        public.offers%rowtype;
  v_best   public.offers%rowtype;
  v_found  boolean := false;
  v_price  bigint;
  v_bprice bigint;
  v_left   bigint;
begin
  for o in select * from public.offers x
            where x.active and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
              and x.kind in ('pct', 'off', 'price')
            order by x.id loop
    if not web.offer_covers(o.scope, o.targets, v_id, v_type, v_brand) then continue; end if;
    if o.max_units is not null and web.offer_sold(o.id) >= o.max_units then continue; end if;
    if o.kind = 'pct' then
      v_price := greatest(0, (v_list * (100 - o.pct) + 50) / 100);
    else
      if coalesce(v_cur, 'USD') <> 'USD' then continue; end if;
      v_price := case o.kind when 'off' then greatest(0, v_list - o.amount)
                             else least(v_list, o.amount) end;
    end if;
    if v_price >= v_list then continue; end if;
    if not v_found or v_price < v_bprice then
      v_best := o; v_bprice := v_price; v_found := true;
    end if;
  end loop;

  if not v_found then
    for o in select * from public.offers x
              where x.active and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now())
                and x.kind = 'bxgy'
              order by x.id loop
      if not web.offer_covers(o.scope, o.targets, v_id, v_type, v_brand) then continue; end if;
      if o.max_units is not null and web.offer_sold(o.id) >= o.max_units then continue; end if;
      v_best := o; v_bprice := null; v_found := true;
      exit;
    end loop;
  end if;
  if not v_found then return null; end if;

  if v_best.max_units is not null then
    v_left := greatest(0, v_best.max_units - web.offer_sold(v_best.id));
  end if;

  return jsonb_build_object(
    'id', v_best.id,
    'kind', v_best.kind,
    'name', jsonb_build_object('en', v_best.name_en, 'ar', v_best.name_ar),
    'pct', case when v_best.kind in ('pct', 'bxgy') then v_best.pct end,
    'buy', case when v_best.kind = 'bxgy' then v_best.buy_qty end,
    'get', case when v_best.kind = 'bxgy' then v_best.get_qty end,
    'prices', case when v_bprice is null then null
                   else web.product_prices(v_cur, v_bprice, (p_rate ->> 'rate')::double precision) end,
    'off', case when v_bprice is null or v_list = 0 then null
                else round(((v_list - v_bprice) * 100)::numeric / v_list)::integer end,
    'endsAt', to_char(v_best.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'left', v_left,
    'stackCoupons', v_best.stack_coupons);
end;
$$;

-- -----------------------------------------------------------------------------
--  web.product_row — THE SAME TEXT AS IN 037, 040 AND 041.
-- -----------------------------------------------------------------------------
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
  v_print   jsonb;
  v_offer   jsonb;
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

  -- v1.6 (041): how a name and number are printed on it, or null. Called by
  -- name only when 041 has made web.print_of, so this text runs the same in
  -- a project that stopped at 037 or 040.
  if to_regprocedure('web.print_of(jsonb, jsonb)') is not null then
    execute 'select web.print_of($1, $2)' into v_print using v_more, p_rate;
  end if;

  -- v1.9 (043): the sale it is on right now, or null — by name only when 043
  -- has made web.offer_of, like the print above.
  if to_regprocedure('web.offer_of(jsonb, jsonb)') is not null then
    execute 'select web.offer_of($1, $2)' into v_offer using v_more, p_rate;
  end if;

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
    -- v1.6: null when it takes no print (041).
    'print', v_print,
    -- v1.9: null when it is on no offer (043).
    'offer', v_offer,
    'updatedAt', to_char(v_p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_offers — the website's offers page: live, coming and sold-out
--  offers, each with the published products it covers. Codes: bad_key.
--  (lib/offers.js webList)
-- -----------------------------------------------------------------------------
create or replace function public.web_offers(p_key text)
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

  with pub as (
    select p.id, p.type, p.brand
      from public.products p
     where not p.hidden and p.on_web and not p.demo
       and web.product_row(p.id, v_rate) is not null
  ),
  o as (
    select x.*, web.offer_sold(x.id) as sold
      from public.offers x
     where x.active and (x.ends_at is null or x.ends_at > now())
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'kind', o.kind,
           'name', jsonb_build_object('en', o.name_en, 'ar', o.name_ar),
           'pct', o.pct, 'amount', o.amount, 'buy', o.buy_qty, 'get', o.get_qty,
           'status', case when o.starts_at > now() then 'scheduled'
                          when o.max_units is not null and o.sold >= o.max_units then 'soldout'
                          else 'live' end,
           'startsAt', to_char(o.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'endsAt', to_char(o.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'maxUnits', o.max_units,
           'left', case when o.max_units is not null then greatest(0, o.max_units - o.sold) end,
           'stackCoupons', o.stack_coupons,
           'coverUrl', o.cover_url,
           'productIds', coalesce((select jsonb_agg(pub.id order by pub.id) from pub
                                    where web.offer_covers(o.scope, o.targets, pub.id, pub.type, pub.brand)), '[]'::jsonb))
         order by o.starts_at, o.id), '[]'::jsonb)
    into v_list
    from o;

  v_answer := jsonb_build_object('ok', true, 'offers', v_list);
  return v_answer || jsonb_build_object(
    'version', md5(v_answer::text),
    'generatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end;
$$;

-- The website calls it with the publishable key; the shop's checks with the
-- service key. The helpers are reached only through it and web_products.
REVOKE ALL ON FUNCTION public.web_offers(text) FROM public;
REVOKE ALL ON FUNCTION web.offer_sold(bigint) FROM public;
REVOKE ALL ON FUNCTION web.offer_hit(jsonb, bigint, text, text) FROM public;
REVOKE ALL ON FUNCTION web.offer_covers(text, text, bigint, text, text) FROM public;
REVOKE ALL ON FUNCTION web.offer_of(jsonb, jsonb) FROM public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.web_offers(text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.web_offers(text) TO anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.web_offers(text) TO service_role';
  END IF;
END $$;
