-- =============================================================================
--  041 — JERSEY PRINT KITS, AND WEBSITE PRINT ORDERS TO YALLA WEAR
--        (local 071, contract v1.6)
-- -----------------------------------------------------------------------------
--  Paste the whole file into the Supabase SQL editor and run it once, AFTER
--  037_web_products.sql and 040_product_web_extras.sql (it calls
--  web.product_prices from 037). Safe to run again. Then:
--    1. run verify_041_print_kits.sql — every row should say ✅;
--    2. run 030_erp_access.sql AGAIN, so og_vps can read the two new tables
--       (it grants SELECT table by table, and these did not exist when it ran);
--    3. `npm run supabase:reconcile` from server/ — products, print jobs, their
--       lines and deliveries pushed before this went up without the new
--       columns (lib/mirror-lag.js) and stay NULL until it is run.
--
--  RUN IT BEFORE THE SHOP RUNS LOCAL 071. That migration sets the website's
--  print price to '500' with print.unit_currency 'USD' ($5.00). web_checkout
--  as 031 left it reads print.unit_price as whole BASE-currency units, so until
--  this file replaces it the website would be told a print costs 500 lira.
--
--  WHAT IT ADDS
--    print_fonts, print_kits   pushed whole by the laptop (mirror shape, like
--                              clubs). RLS on, no policy; service_role only.
--                              No foreign keys and no unique index here: the
--                              laptop is the one that enforces them, and a
--                              whole-table push that swaps two kits' slots
--                              would be refused half way by a unique index.
--    products.printable, products.print_kit_id
--    print_jobs.web_ref        the website order a job prints
--    print_job_lines.print_kit_snapshot  (jsonb) the kit as the customer saw it
--    deliveries.print_override an owner's "send it before the print is done"
--    web.orders.auth_uid       the signed-in website customer who placed it
--                              (a trigger stamps auth.uid() on insert), for
--                              web_print_tracking's "only your own order"
--
--    web_products / web_product   each product gains `print` (null when it
--                                 takes no print) — web.product_row, THE SAME
--                                 TEXT AS IN 037 AND 040 (all three updated).
--    web_checkout                 `print` gains `prices` (both currencies),
--                                 `unit`, `maxLetters` and `turnaround`;
--                                 `unitPrice` stays in the base currency. THE
--                                 SAME TEXT AS IN 031 (updated with it).
--    web_print_styles(key)        the featured kits a customer chooses from.
--    web_print_tracking(key, ref) where a signed-in customer's print is.
--
--  KEEP IN STEP: server/lib/printkits.js (printObject, rules, styles) and
--  webRow()/webPrint() in server/lib/catalogue.js are the laptop's copy.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  The tables
-- -----------------------------------------------------------------------------
create table if not exists public.print_fonts (
  id            bigint primary key,
  name          text        not null,
  file_url      text,
  source_url    text,
  license_note  text,
  weight        integer     not null default 400,
  archived      boolean     not null default false,
  created_at    timestamptz not null,
  updated_at    timestamptz not null
);
alter table public.print_fonts enable row level security;

create table if not exists public.print_kits (
  id             bigint primary key,
  label          text        not null,
  club_code      text,
  season         text,
  kit_type       text,
  font_id        bigint      not null,
  text_color     text        not null,
  outline_color  text,
  outline_width  integer     not null default 0,
  shadow_color   text,
  shadow_dx      integer     not null default 0,
  shadow_dy      integer     not null default 0,
  name_size      integer     not null default 34,
  name_y         integer     not null default 165,
  name_arc       integer     not null default 30,
  number_size    integer     not null default 160,
  number_y       integer     not null default 345,
  is_default     boolean     not null default false,
  featured       boolean     not null default false,
  archived       boolean     not null default false,
  created_at     timestamptz not null,
  updated_at     timestamptz not null
);
alter table public.print_kits enable row level security;

alter table public.products        add column if not exists printable    boolean not null default false;
alter table public.products        add column if not exists print_kit_id bigint;
alter table public.print_jobs      add column if not exists web_ref text;
create unique index if not exists print_jobs_web_ref on public.print_jobs (web_ref) where web_ref is not null;
alter table public.print_job_lines add column if not exists print_kit_snapshot jsonb;
alter table public.deliveries      add column if not exists print_override text;

comment on table public.print_fonts is 'The print kits'' fonts (local 071). Pushed whole by the shop; the files are in the print-fonts bucket.';
comment on table public.print_kits  is 'How a name and number are printed on a jersey''s back (local 071). Pushed whole by the shop.';

-- ---- grants (the 038 block: service_role only, anon and authenticated out) ----
do $$
declare
  t text;
  s record;
begin
  foreach t in array array['print_fonts', 'print_kits'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant select, insert, update, delete on public.%I to service_role', t);
      for s in
        select seq.relname
          from pg_class seq
          join pg_depend dep on dep.objid = seq.oid and dep.deptype in ('a', 'i')
          join pg_class tab on tab.oid = dep.refobjid
         where seq.relkind = 'S' and tab.oid = ('public.' || t)::regclass
      loop
        execute format('grant usage, select on sequence public.%I to service_role', s.relname);
      end loop;
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on public.%I from authenticated', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
--  Who placed a website order. Stamped by a trigger, so web_order_submit (030,
--  031) did not have to be written out again: the website calls it as the
--  signed-in customer, and auth.uid() inside it is that customer. An order
--  placed without signing in has none, and no tracking through this door.
-- -----------------------------------------------------------------------------
alter table web.orders add column if not exists auth_uid uuid;
create index if not exists orders_auth_uid on web.orders (auth_uid) where auth_uid is not null;

create or replace function web.stamp_auth_uid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if to_regprocedure('auth.uid()') is not null then
    begin
      execute 'select auth.uid()' into v;
    exception when others then
      v := null;
    end;
  end if;
  new.auth_uid := v;
  return new;
end;
$$;

drop trigger if exists orders_stamp_auth_uid on web.orders;
create trigger orders_stamp_auth_uid before insert on web.orders
  for each row execute function web.stamp_auth_uid();

-- -----------------------------------------------------------------------------
--  The print rules, the price, and one kit as the website sees it.
--  KEEP IN STEP with rules(), printObject() in server/lib/printkits.js and
--  Partner.webPrices() in server/lib/partner.js.
-- -----------------------------------------------------------------------------
create or replace function web.print_whole(p_key text, p_default integer, p_lo integer, p_hi integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when btrim(c.value) ~ '^[0-9]{1,4}$'
                                and btrim(c.value)::integer between p_lo and p_hi
                               then btrim(c.value)::integer end
                     from public.config c where c.key = p_key), p_default);
$$;

create or replace function web.print_rules()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'maxLetters', web.print_whole('print.max_letters', 12, 1, 30),
    'turnaround', jsonb_build_object(
      'min', web.print_whole('print.turnaround_min', 5, 1, 90),
      'max', greatest(web.print_whole('print.turnaround_min', 5, 1, 90),
                      web.print_whole('print.turnaround_max', 7, 1, 90))));
$$;

-- The price as the owner wrote it: {amount, currency}, or null when unset.
-- Minor units of print.unit_currency (missing: the base currency).
create or replace function web.print_unit()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when btrim(p.value) ~ '^[0-9]{1,13}$' and btrim(p.value)::bigint > 0
              then jsonb_build_object(
                     'amount', btrim(p.value)::bigint,
                     'currency', coalesce(
                        nullif(btrim((select c.value from public.config c where c.key = 'print.unit_currency')), ''),
                        nullif(btrim((select c.value from public.config c where c.key = 'shop.base_currency')), ''),
                        'SYP'))
         end
    from public.config p where p.key = 'print.unit_price';
$$;

-- One kit, in the shape of the `print` object. p_price: the price object to
-- carry, or the JSON null 'null' to leave the key out (the styles list).
create or replace function web.kit_object(p_kit_id bigint, p_price jsonb, p_with_price boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'kitId', k.id, 'label', k.label,
           'font', jsonb_build_object('name', f.name, 'url', f.file_url, 'weight', f.weight),
           'textColor', k.text_color, 'outlineColor', k.outline_color, 'outlineWidth', k.outline_width,
           'shadowColor', k.shadow_color, 'shadowDx', k.shadow_dx, 'shadowDy', k.shadow_dy,
           'nameSize', k.name_size, 'nameY', k.name_y, 'nameArc', k.name_arc,
           'numberSize', k.number_size, 'numberY', k.number_y)
         || web.print_rules()
    into v
    from public.print_kits k join public.print_fonts f on f.id = k.font_id
   where k.id = p_kit_id;
  if v is null then return null; end if;
  if p_with_price then v := v || jsonb_build_object('price', p_price); end if;
  return v;
end;
$$;

-- A product's `print`: its own kit while live, else the default; null when
-- the product takes no print or there is no kit. p_product is to_jsonb(row),
-- so a product row from before this file reads as not printable.
create or replace function web.print_of(p_product jsonb, p_rate jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kit  bigint;
  v_unit jsonb;
begin
  if coalesce((p_product ->> 'printable')::boolean, false) is not true then return null; end if;
  select k.id into v_kit from public.print_kits k
   where k.id = (p_product ->> 'print_kit_id')::bigint and not k.archived;
  if v_kit is null then
    select k.id into v_kit from public.print_kits k where k.is_default and not k.archived
     order by k.id limit 1;
  end if;
  if v_kit is null then return null; end if;
  v_unit := web.print_unit();
  return web.kit_object(v_kit,
    case when v_unit is null then 'null'::jsonb
         else web.product_prices(v_unit ->> 'currency', (v_unit ->> 'amount')::bigint,
                                 (p_rate ->> 'rate')::double precision) end,
    true);
end;
$$;

-- One published product as the website sees it, or null when no colour of it
-- has both photos. KEEP IN STEP with webRow() in server/lib/catalogue.js.
-- THE SAME TEXT IS IN 037, 040 AND 041 (v1.5 added description and pairsWith,
-- v1.6 added print), so running any of them again leaves the same function.
-- The newer columns are read through to_jsonb(row) and the print through
-- web.print_of only when it exists: before 040 / 041 the fields read null / []
-- rather than the call failing.
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
    'updatedAt', to_char(v_p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_checkout — as 031, with the print price in dollars (THE SAME TEXT
--  AS IN 031, which was updated with it). Codes: bad_key.
-- -----------------------------------------------------------------------------
create or replace function public.web_checkout(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base   text;
  v_rate   jsonb;
  v_cod    boolean;
  v_answer jsonb;
  v_unit   jsonb;
  v_ubase  bigint;
  v_rules  jsonb;
  v_prices jsonb;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;

  v_base := coalesce(nullif(btrim((select c.value from public.config c where c.key = 'shop.base_currency')), ''), 'SYP');
  v_cod := web.cod_on();

  select jsonb_build_object('base', r.base, 'quote', r.quote, 'rate', r.rate, 'at', r.set_at)
    into v_rate
    from public.fx_rates r
   where r.base = 'USD' and r.quote = v_base
   order by r.set_at desc, r.id desc
   limit 1;

  -- The print price (041): as the owner wrote it ({amount, currency}, e.g.
  -- 500 USD = $5.00), and in the base currency for `unitPrice` — whole lira
  -- at the newest rate, the arithmetic Partner.webPrices() uses. Before 041
  -- there is no web.print_unit and it reads as before: whole base units.
  if to_regprocedure('web.print_unit()') is not null then
    execute 'select web.print_unit()' into v_unit;
  else
    select case when btrim(c.value) ~ '^[0-9]{1,13}$' then jsonb_build_object('amount', btrim(c.value)::bigint, 'currency', v_base) end
      into v_unit from public.config c where c.key = 'print.unit_price';
  end if;
  v_ubase := case
    when v_unit is null then null
    when v_unit ->> 'currency' = v_base then (v_unit ->> 'amount')::bigint
    when v_rate is null then null
    when v_unit ->> 'currency' = 'USD' and v_base = 'SYP'
      then floor((v_unit ->> 'amount')::double precision / 100 * (v_rate ->> 'rate')::double precision + 0.5)::bigint
    when v_unit ->> 'currency' = 'SYP' and v_base = 'USD'
      then floor((v_unit ->> 'amount')::double precision / (v_rate ->> 'rate')::double precision * 100 + 0.5)::bigint
  end;

  -- Both by name only when they exist (041, 037): plpgsql resolves a function
  -- named in an expression even on a branch that never runs.
  if to_regprocedure('web.print_rules()') is not null then
    execute 'select web.print_rules()' into v_rules;
  end if;
  if v_unit is not null and to_regprocedure('web.product_prices(text, bigint, double precision)') is not null then
    execute 'select web.product_prices($1, $2, $3)' into v_prices
      using v_unit ->> 'currency', (v_unit ->> 'amount')::bigint, (v_rate ->> 'rate')::double precision;
  end if;

  v_answer := jsonb_build_object(
    'ok', true,
    'baseCurrency', v_base,
    'currencies', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'minorExp', c.minor_exp)
                                             order by c.code), '[]'::jsonb)
                     from public.currencies c),
    'rate', v_rate,
    'travel', jsonb_build_array('driver', 'office', 'courier', 'abroad', 'pickup'),
    -- Cash at the door: our own driver or a pickup, and only while the owner
    -- has it on. Empty means transfer only.
    'cod', v_cod,
    'codAllowed', case when v_cod then jsonb_build_array('driver', 'pickup') else '[]'::jsonb end,
    'countries', (select coalesce(jsonb_agg(jsonb_build_object(
                           'id', x ->> 'id', 'en', x ->> 'en', 'ar', x ->> 'ar',
                           'currency', x ->> 'currency', 'dial', x ->> 'dial')), '[]'::jsonb)
                    from jsonb_array_elements(
                           case when jsonb_typeof(web.cfg_json('delivery.countries', '[]'::jsonb)) = 'array'
                                then web.cfg_json('delivery.countries', '[]'::jsonb) else '[]'::jsonb end) x
                   where jsonb_typeof(x) = 'object' and coalesce(x ->> 'active', 'true') <> 'false'),
    'shipping', (select coalesce(jsonb_agg(jsonb_build_object(
                          'country', p ->> 'country', 'cityEn', nullif(p ->> 'city_en', ''),
                          'cityAr', nullif(p ->> 'city_ar', ''), 'method', nullif(p ->> 'method', ''),
                          'fee', (p ->> 'fee')::numeric, 'currency', p ->> 'currency',
                          'customerPaysCourier', (p ->> 'fee_mode') = 'courier')), '[]'::jsonb)
                   from jsonb_array_elements(
                          case when jsonb_typeof(web.cfg_json('delivery.prices', '[]'::jsonb)) = 'array'
                               then web.cfg_json('delivery.prices', '[]'::jsonb) else '[]'::jsonb end) p
                  where jsonb_typeof(p) = 'object' and coalesce(p ->> 'active', 'true') <> 'false'
                    and (p ->> 'fee') ~ '^[0-9]{1,13}$'),
    'transfer', web.transfer_methods(),
    'print', jsonb_build_object(
      -- One printed jersey, in the base currency (`currency`), as before.
      'unitPrice', v_ubase,
      'currency', v_base,
      -- v1.6 (041): the price as written, and in both currencies like a product.
      'unit', v_unit,
      'prices', v_prices,
      'maxLetters', v_rules -> 'maxLetters',
      'turnaround', v_rules -> 'turnaround',
      'clubs', (select coalesce(jsonb_agg(jsonb_build_object('code', k.code, 'en', k.name, 'ar', coalesce(k.name_ar, k.name))
                                          order by k.name), '[]'::jsonb)
                  from public.clubs k where not k.archived))
  );

  -- `version` is the answer's own fingerprint, taken BEFORE updatedAt is
  -- added, so it moves when what the customer sees moves and never
  -- otherwise. The website compares it; it never has to diff the lists.
  return v_answer || jsonb_build_object(
    'version', md5(v_answer::text),
    'updatedAt', (select max(c.updated_at) from public.config c
                   where c.key in ('pay.methods', 'pay.accounts', 'web.cod', 'shop.base_currency',
                                   'delivery.countries', 'delivery.prices', 'print.unit_price',
                                   'print.unit_currency', 'print.max_letters',
                                   'print.turnaround_min', 'print.turnaround_max'))
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_print_styles — the featured kits a customer chooses between, in
--  the `print` shape without a price. Codes: bad_key.
-- -----------------------------------------------------------------------------
create or replace function public.web_print_styles(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_list   jsonb;
  v_answer jsonb;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;
  select coalesce(jsonb_agg(web.kit_object(k.id, null, false)
                            order by k.is_default desc, lower(k.label), k.id), '[]'::jsonb)
    into v_list
    from public.print_kits k where k.featured and not k.archived;
  v_answer := jsonb_build_object('ok', true, 'styles', v_list);
  return v_answer || jsonb_build_object('version', md5(v_answer::text));
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_print_tracking — where a signed-in customer's printed shirts
--  are. The website key AND the signed-in customer who placed the order
--  (web.orders.auth_uid = auth.uid()); anything else — no such order, someone
--  else's, an order placed without signing in — is the same not_found, so the
--  answer never says whether a ref exists. Only: order_state, stage, deadline,
--  and the stage stamps. No price, no cost, no names. Codes: bad_key,
--  not_found, no_print.
-- -----------------------------------------------------------------------------
create or replace function public.web_print_tracking(p_key text, p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_job record;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;
  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;
  if v_uid is null or p_ref is null
     or not exists (select 1 from web.orders o where o.ref = p_ref and o.auth_uid = v_uid) then
    return web.no('not_found');
  end if;
  select j.id, j.order_state, j.stage, j.deadline into v_job
    from public.print_jobs j where j.web_ref = p_ref;
  if not found then return web.no('no_print'); end if;
  return jsonb_build_object(
    'ok', true,
    'order_state', v_job.order_state,
    'stage', v_job.stage,
    'deadline', v_job.deadline,
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', s.stage, 'at', s.at) order by s.at, s.id)
                          from public.print_job_stages s where s.job_id = v_job.id), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
--  Who may call what. The helpers are nobody's. Styles: the website (anon)
--  and the laptop. Tracking: a signed-in customer (authenticated) and the
--  laptop. The trigger function runs as the table's trigger, for nobody else.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'web.print_whole(text, integer, integer, integer)', 'web.print_rules()', 'web.print_unit()',
    'web.kit_object(bigint, jsonb, boolean)', 'web.print_of(jsonb, jsonb)', 'web.stamp_auth_uid()',
    'web.product_row(bigint, jsonb)',
    'public.web_print_styles(text)', 'public.web_print_tracking(text, text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', v_fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', v_fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on function %s from service_role', v_fn);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.web_print_styles(text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.web_print_tracking(text, text) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.web_print_styles(text) to service_role';
    execute 'grant execute on function public.web_print_tracking(text, text) to service_role';
  end if;
end $$;

comment on function public.web_print_styles(text) is
  'The featured print kits for the website (041), in the print-object shape without a price. Website key required. Laptop twin: server/lib/printkits.js styles().';
comment on function public.web_print_tracking(text, text) is
  'Where a signed-in customer''s printed shirts are (041): order_state, stage, deadline, stages. Website key and the order''s own auth.uid() required.';
