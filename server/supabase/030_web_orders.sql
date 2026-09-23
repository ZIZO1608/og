-- =============================================================================
--  030 — THE WEBSITE'S ORDERS: a door the website can reach while the shop is shut
-- -----------------------------------------------------------------------------
--  Paste the whole file into the Supabase SQL editor and run it once. It is
--  safe to run again: every statement replaces or skips what is already there.
--  No local migration goes with it and nothing here is a mirrored table, so
--  server/lib/mirror-lag.js, drift, reconcile and restore do not change.
--
--  WHY THE CLOUD AND NOT THE LAPTOP
--    The shop's database is on a laptop that is shut every night, and people
--    shop at night. So the website never talks to the laptop to place an
--    order: it writes the order HERE, and the laptop collects it the next
--    time it is on (every minute while it is), exactly the way og-track's
--    inbox hands the shop a customer's review. Nothing the website sends is
--    trusted because it arrived here — the shop's own code checks every line
--    again when it collects, and a person says yes or no before any stock
--    moves (the owner's decision, 23 Sep 2026).
--
--  WHAT IT CREATES
--    1. Schema `web`, NOT exposed through the Data API: web.orders (one row
--       per website order, keyed on the website's own order number) and
--       web.settings (the SHA-256 of the website's key — never the key).
--    2. Four doors for the WEBSITE, callable with the project's publishable
--       key, each refusing everything unless the caller also sends the
--       website's key (the same value as OG_WEB_API_KEY in server/.env):
--         public.web_order_submit(key, order, proof)   place an order
--         public.web_order_proof(key, ref, proof, txn) add the transfer photo
--         public.web_order_status(key, ref)            where it is now
--         public.web_checkout(key)                     how to pay, where we ship
--    3. Two doors for the SHOP'S LAPTOP, callable only with the service key,
--       refusing any database but the one that owns the mirror (the lineage
--       check og-track's inbox uses):
--         public.web_orders_take(lineage, limit)       what is waiting
--         public.web_orders_mark(lineage, items)       received / accepted / rejected
--
--  THE LIFE OF AN ORDER, as the website sees it (web_order_status)
--    waiting   placed on the website; the shop has not collected it yet
--    received  the shop has it and somebody will call to confirm it
--    accepted  it is a real order now — saleId, and trackUrl to follow it
--    rejected  the shop said no — `code` says why
--  A print job inside an order is sent to Yalla Wear the moment the shop
--  collects it (the owner's decision); its own progress is in `prints`.
--
--  LIMITS (the key lives on the website's server, but a leaked key must not
--  be able to bury the shop):
--    order  16 KB of JSON, 40 product lines, 10 print jobs, 5 waiting per phone,
--           2,000 waiting in all
--    proof  a data: URL of a JPEG, PNG or WebP image, at most 900 KB; replaced
--           at most 20 times per order, and only before the shop decides
--
--  AFTER RUNNING IT
--    Do NOT add `web` to Exposed schemas. Then run the one line that
--    `npm run web:key` prints (it holds only the SHA-256 of the key), and give
--    the website the key itself, the project URL and the publishable key.
-- =============================================================================

create schema if not exists web;
revoke all on schema web from public;
revoke all on schema web from anon, authenticated, service_role;

create table if not exists web.settings (
  key        text        primary key,
  value      text        not null,
  updated_at timestamptz not null default now(),
  constraint settings_key_check  check (key in ('key_sha256')),
  constraint settings_hash_shape check (key <> 'key_sha256' or value ~ '^[0-9a-f]{64}$')
);

comment on table web.settings is
  'The website door: the SHA-256 (hex) of the website key (OG_WEB_API_KEY). Never the key itself.';

create table if not exists web.orders (
  id             bigint      generated always as identity primary key,
  ref            text        not null,
  payload        jsonb       not null,
  phone_digits   text        not null,
  proof          text,
  proof_ref      text,
  revision       integer     not null default 1,
  state          text        not null default 'waiting',
  state_code     text,
  sale_id        text,
  track_token    text,
  job_ids        jsonb,
  taken_by       text,
  taken_revision integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  decided_at     timestamptz,
  constraint orders_ref_unique   unique (ref),
  constraint orders_ref_shape    check (ref ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$'),
  constraint orders_state_check  check (state in ('waiting', 'received', 'accepted', 'rejected')),
  constraint orders_code_shape   check (state_code is null or state_code ~ '^[a-z_]{1,40}$'),
  constraint orders_payload_size check (octet_length(payload::text) <= 16384),
  constraint orders_proof_size   check (proof is null or octet_length(proof) <= 900000),
  constraint orders_proof_ref    check (proof_ref is null or char_length(proof_ref) <= 80),
  constraint orders_token_shape  check (track_token is null or track_token ~ '^[0-9a-f]{32}$')
);

comment on table web.orders is
  'Orders placed on the website, waiting for the shop laptop to collect them (public.web_orders_take). Not a mirrored table; never add it to the POS sync, reconcile or restore lists.';

alter table web.settings enable row level security;
alter table web.orders   enable row level security;
revoke all on table web.settings, web.orders from public;
revoke all on table web.settings, web.orders from anon, authenticated, service_role;
revoke all on all sequences in schema web from public;
revoke all on all sequences in schema web from anon, authenticated, service_role;

create index if not exists orders_open_idx  on web.orders (id) where state in ('waiting', 'received');
create index if not exists orders_phone_idx on web.orders (phone_digits) where state = 'waiting';

-- -----------------------------------------------------------------------------
--  Helpers. Not reachable from outside: schema `web` is not exposed and no
--  role but the owner may use it.
-- -----------------------------------------------------------------------------
create or replace function web.key_ok(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_key is not null
      and char_length(p_key) between 24 and 256
      and encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
          = (select s.value from web.settings s where s.key = 'key_sha256'),
    false
  );
$$;

-- The same question og-track's inbox.is_owner asks: is this the database that
-- owns the mirror? False when nobody has claimed it.
create or replace function web.is_owner(p_lineage text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_lineage <> '' and p_lineage = (
      select nullif(split_part(st.note, ' ', 1), '')
        from public.sync_state st
       where st.id = 'lineage'
    ),
    false
  );
$$;

create or replace function web.no(p_code text, p_field text default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_field is null
              then jsonb_build_object('ok', false, 'code', p_code)
              else jsonb_build_object('ok', false, 'code', p_code, 'field', p_field) end;
$$;

-- A string field of an object, trimmed; null when absent or not a string.
create or replace function web.txt(p_obj jsonb, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_obj -> p_key) = 'string'
              then nullif(btrim(p_obj ->> p_key), '') end;
$$;

-- A whole number field, or null.
create or replace function web.int(p_obj jsonb, p_key text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_obj -> p_key) = 'number'
               and (p_obj ->> p_key) ~ '^-?[0-9]{1,15}$'
              then (p_obj ->> p_key)::bigint end;
$$;

create or replace function web.proof_ok(p_proof text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_proof is not null
     and octet_length(p_proof) <= 900000
     and p_proof ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$';
$$;

-- A config value from the mirror as JSON, or the fallback when it is missing
-- or will not parse. One broken key must not take the checkout down.
create or replace function web.cfg_json(p_key text, p_fallback jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select c.value into v from public.config c where c.key = p_key;
  if v is null then return p_fallback; end if;
  return coalesce(v::jsonb, p_fallback);
exception when others then
  return p_fallback;
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_order_submit — the website places an order.
--  Returns {ok:true, ref, state, placedAt[, replayed]} or {ok:false, code[, field]}.
--  Codes: bad_key, unsupported, too_big, bad_ref, bad_name, bad_phone,
--  bad_items, bad_prints, empty, bad_delivery, bad_address, bad_city,
--  bad_country, bad_payment, cod_not_here, bad_proof, ref_taken, too_many, full.
--  Sending the SAME order again with the same ref is safe: it answers the
--  first one (replayed:true). A different order under a used ref is refused.
-- -----------------------------------------------------------------------------
create or replace function public.web_order_submit(p_key text, p_order jsonb, p_proof text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_travel constant text[] := array['driver', 'office', 'courier', 'abroad', 'pickup'];
  v_ref    text;
  v_cust   jsonb;
  v_dlv    jsonb;
  v_pay    jsonb;
  v_items  jsonb;
  v_prints jsonb;
  v_e      jsonb;
  v_l      jsonb;
  v_method text;
  v_type   text;
  v_digits text;
  v_qty    bigint;
  v_row    web.orders%rowtype;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' then return web.no('unsupported'); end if;
  if web.int(p_order, 'v') is distinct from 1 then return web.no('unsupported', 'v'); end if;
  if octet_length(p_order::text) > 16384 then return web.no('too_big'); end if;

  v_ref := web.txt(p_order, 'ref');
  if v_ref is null or v_ref !~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$' then return web.no('bad_ref', 'ref'); end if;

  -- The same order sent twice (a retry after a dropped line) is one order.
  select * into v_row from web.orders o where o.ref = v_ref;
  if found then
    if v_row.payload = p_order then
      return jsonb_build_object('ok', true, 'ref', v_row.ref, 'state', v_row.state,
                                'placedAt', v_row.created_at, 'replayed', true);
    end if;
    return web.no('ref_taken', 'ref');
  end if;

  v_cust := p_order -> 'customer';
  if jsonb_typeof(v_cust) is distinct from 'object' then return web.no('bad_name', 'customer'); end if;
  if web.txt(v_cust, 'name') is null or char_length(web.txt(v_cust, 'name')) > 80 then
    return web.no('bad_name', 'customer.name');
  end if;
  v_digits := regexp_replace(coalesce(web.txt(v_cust, 'phone'), ''), '[^0-9]', '', 'g');
  if char_length(v_digits) not between 7 and 15 or char_length(web.txt(v_cust, 'phone')) > 40 then
    return web.no('bad_phone', 'customer.phone');
  end if;

  -- Products: a size is named by the SKU the catalogue gave it. The price is
  -- what the customer SAW and is never used — the shop prices every line from
  -- its own table.
  v_items := coalesce(p_order -> 'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 40 then return web.no('bad_items', 'items'); end if;
  for v_e in select * from jsonb_array_elements(v_items) loop
    v_qty := web.int(v_e, 'qty');
    if jsonb_typeof(v_e) <> 'object'
       or web.txt(v_e, 'sku') is null or char_length(web.txt(v_e, 'sku')) > 64
       or v_qty is null or v_qty not between 1 and 20 then
      return web.no('bad_items', 'items');
    end if;
  end loop;

  -- Print jobs: a design, and either named shirts (lines) or a plain quantity.
  v_prints := coalesce(p_order -> 'prints', '[]'::jsonb);
  if jsonb_typeof(v_prints) <> 'array' or jsonb_array_length(v_prints) > 10 then return web.no('bad_prints', 'prints'); end if;
  for v_e in select * from jsonb_array_elements(v_prints) loop
    if jsonb_typeof(v_e) <> 'object' or web.txt(v_e, 'design') is null or char_length(web.txt(v_e, 'design')) > 120 then
      return web.no('bad_prints', 'prints');
    end if;
    if jsonb_typeof(v_e -> 'lines') = 'array' and jsonb_array_length(v_e -> 'lines') > 0 then
      if jsonb_array_length(v_e -> 'lines') > 40 then return web.no('bad_prints', 'prints'); end if;
      for v_l in select * from jsonb_array_elements(v_e -> 'lines') loop
        v_qty := coalesce(web.int(v_l, 'qty'), 1);
        if jsonb_typeof(v_l) <> 'object' or v_qty not between 1 and 50
           or char_length(coalesce(web.txt(v_l, 'printName'), '')) > 40 then
          return web.no('bad_prints', 'prints');
        end if;
      end loop;
    else
      v_qty := web.int(v_e, 'qty');
      if v_qty is null or v_qty not between 1 and 500 then return web.no('bad_prints', 'prints'); end if;
    end if;
  end loop;

  if jsonb_array_length(v_items) = 0 and jsonb_array_length(v_prints) = 0 then return web.no('empty'); end if;

  v_dlv := p_order -> 'delivery';
  if jsonb_typeof(v_dlv) is distinct from 'object' then return web.no('bad_delivery', 'delivery'); end if;
  v_method := web.txt(v_dlv, 'method');
  if v_method is null or not (v_method = any (c_travel)) then return web.no('bad_delivery', 'delivery.method'); end if;
  if v_method <> 'pickup' then
    if web.txt(v_dlv, 'address') is null or char_length(web.txt(v_dlv, 'address')) not between 3 and 500 then
      return web.no('bad_address', 'delivery.address');
    end if;
    if web.txt(v_dlv, 'city') is null or char_length(web.txt(v_dlv, 'city')) > 80 then
      return web.no('bad_city', 'delivery.city');
    end if;
    if coalesce(web.txt(v_dlv, 'country'), '') !~ '^[A-Z]{2}$' then
      return web.no('bad_country', 'delivery.country');
    end if;
  end if;

  -- Cash on delivery only where money can change hands at the door: our own
  -- driver, or a pickup at the shop. Everywhere else is paid before sending —
  -- the rule the shop's order desk already enforces (receipt_not_allowed).
  v_pay := p_order -> 'payment';
  if jsonb_typeof(v_pay) is distinct from 'object' then return web.no('bad_payment', 'payment'); end if;
  v_type := web.txt(v_pay, 'type');
  if v_type is null or v_type not in ('cod', 'transfer') then return web.no('bad_payment', 'payment.type'); end if;
  if v_type = 'cod' and v_method not in ('driver', 'pickup') then return web.no('cod_not_here', 'payment.type'); end if;
  if v_type = 'transfer' and coalesce(web.txt(v_pay, 'method'), '') !~ '^[a-z0-9_]{1,32}$' then
    return web.no('bad_payment', 'payment.method');
  end if;

  if p_proof is not null and not web.proof_ok(p_proof) then return web.no('bad_proof', 'proof'); end if;

  if (select count(*) from web.orders o where o.phone_digits = v_digits and o.state = 'waiting') >= 5 then
    return web.no('too_many');
  end if;
  if (select count(*) from web.orders o where o.state = 'waiting') >= 2000 then
    return web.no('full');
  end if;

  insert into web.orders (ref, payload, phone_digits, proof, proof_ref)
  values (v_ref, p_order, v_digits, p_proof,
          case when p_proof is not null then left(web.txt(v_pay, 'reference'), 80) end)
  returning * into v_row;

  return jsonb_build_object('ok', true, 'ref', v_row.ref, 'state', v_row.state, 'placedAt', v_row.created_at);
exception when unique_violation then
  -- Two submits of one ref at the same instant: the second reads the first.
  select * into v_row from web.orders o where o.ref = v_ref;
  if found and v_row.payload = p_order then
    return jsonb_build_object('ok', true, 'ref', v_row.ref, 'state', v_row.state,
                              'placedAt', v_row.created_at, 'replayed', true);
  end if;
  return web.no('ref_taken', 'ref');
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_order_proof — the photo of the transfer, sent after the order
--  (the customer pays, then comes back with the screenshot). Replaces any
--  earlier photo. Only before the shop has decided.
--  Codes: bad_key, not_found, decided, bad_proof, too_many.
-- -----------------------------------------------------------------------------
create or replace function public.web_order_proof(p_key text, p_ref text, p_proof text, p_txn_ref text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row web.orders%rowtype;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;
  select * into v_row from web.orders o where o.ref = p_ref for update;
  if not found then return web.no('not_found'); end if;
  if v_row.state in ('accepted', 'rejected') then return web.no('decided'); end if;
  if not web.proof_ok(p_proof) then return web.no('bad_proof', 'proof'); end if;
  if v_row.revision >= 21 then return web.no('too_many'); end if;

  update web.orders o
     set proof = p_proof,
         proof_ref = left(nullif(btrim(coalesce(p_txn_ref, '')), ''), 80),
         revision = o.revision + 1,
         updated_at = now()
   where o.id = v_row.id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'ref', v_row.ref, 'state', v_row.state, 'hasProof', true);
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_order_status — where an order is now. The print jobs' progress
--  is read from the mirror (public.print_jobs), which is how og-track shows a
--  parcel while the laptop is shut. trackUrl is the same link the shop sends
--  on WhatsApp.
--  Codes: bad_key, not_found.
-- -----------------------------------------------------------------------------
create or replace function public.web_order_status(p_key text, p_ref text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row    web.orders%rowtype;
  v_base   text;
  v_prints jsonb;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;
  select * into v_row from web.orders o where o.ref = p_ref;
  if not found then return web.no('not_found'); end if;

  select coalesce(
           nullif(btrim((select c.value from public.config c where c.key = 'receipt.public_url')), ''),
           nullif(btrim((select c.value from public.config c where c.key = 'shop.public_url')), ''))
    into v_base;
  if v_base is not null and v_base !~* '^https?://' then v_base := 'https://' || v_base; end if;
  v_base := rtrim(v_base, '/');

  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'stage', j.stage, 'orderState', j.order_state)
                            order by j.id), '[]'::jsonb)
    into v_prints
    from public.print_jobs j
   where jsonb_typeof(v_row.job_ids) = 'array'
     and v_row.job_ids ? j.id;

  return jsonb_build_object(
    'ok', true,
    'ref', v_row.ref,
    'state', v_row.state,
    'code', v_row.state_code,
    'placedAt', v_row.created_at,
    'decidedAt', v_row.decided_at,
    'saleId', v_row.sale_id,
    'trackUrl', case when v_row.state = 'accepted' and v_row.track_token is not null and v_base is not null
                     then v_base || '/i/' || v_row.track_token end,
    'hasProof', v_row.proof is not null,
    'prints', v_prints
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_checkout — what the checkout page needs, from the shop's own
--  Settings (config is mirrored whole, so this works with the laptop shut):
--  where the shop sends parcels and what it charges, how a transfer is paid
--  and to whom, and today's dollar rate. Only the transfer methods the owner
--  has written details for are offered.
--  Codes: bad_key.
-- -----------------------------------------------------------------------------
create or replace function public.web_checkout(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_system constant text[] := array['cash', 'cod', 'credit', 'order', 'store_credit'];
  v_base     text;
  v_methods  jsonb;
  v_accounts jsonb;
  v_rate     jsonb;
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;

  v_base := coalesce(nullif(btrim((select c.value from public.config c where c.key = 'shop.base_currency')), ''), 'SYP');
  v_accounts := web.cfg_json('pay.accounts', '{}'::jsonb);
  if jsonb_typeof(v_accounts) <> 'object' then v_accounts := '{}'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m ->> 'id', 'en', m ->> 'en', 'ar', m ->> 'ar',
           'details', jsonb_build_object('en', v_accounts -> (m ->> 'id') ->> 'en',
                                         'ar', v_accounts -> (m ->> 'id') ->> 'ar'))), '[]'::jsonb)
    into v_methods
    from jsonb_array_elements(
           case when jsonb_typeof(web.cfg_json('pay.methods', '[]'::jsonb)) = 'array'
                then web.cfg_json('pay.methods', '[]'::jsonb) else '[]'::jsonb end) m
   where jsonb_typeof(m) = 'object'
     and coalesce(m ->> 'active', 'true') <> 'false'
     and not ((m ->> 'id') = any (c_system))
     and jsonb_typeof(v_accounts -> (m ->> 'id')) = 'object';

  select jsonb_build_object('base', r.base, 'quote', r.quote, 'rate', r.rate, 'at', r.set_at)
    into v_rate
    from public.fx_rates r
   where r.base = 'USD' and r.quote = v_base
   order by r.set_at desc, r.id desc
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'baseCurrency', v_base,
    'currencies', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'minorExp', c.minor_exp)
                                             order by c.code), '[]'::jsonb)
                     from public.currencies c),
    'rate', v_rate,
    'travel', jsonb_build_array('driver', 'office', 'courier', 'abroad', 'pickup'),
    'codAllowed', jsonb_build_array('driver', 'pickup'),
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
    'transfer', v_methods,
    -- What one printed piece costs the customer, in the base currency: the
    -- number the shop prices a website print job at. Null until the owner
    -- sets print.unit_price, and a page must then not invent one.
    'print', jsonb_build_object(
      'unitPrice', (select case when btrim(c.value) ~ '^[0-9]{1,13}$' then btrim(c.value)::bigint end
                      from public.config c where c.key = 'print.unit_price'),
      'currency', v_base)
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_orders_take — the laptop collects what is waiting, oldest first:
--  anything it has not seen at its latest revision (a transfer photo sent
--  later bumps the revision), and anything another laptop took and never
--  decided — so an order still waiting for a yes follows the shop when it
--  moves laptops. Decided orders never come back.
--  Codes: not_owner.
-- -----------------------------------------------------------------------------
create or replace function public.web_orders_take(p_lineage text, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  if not web.is_owner(p_lineage) then return web.no('not_owner'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', o.ref, 'revision', o.revision, 'state', o.state, 'payload', o.payload,
           'proof', o.proof, 'proofRef', o.proof_ref, 'jobIds', o.job_ids,
           'createdAt', o.created_at, 'updatedAt', o.updated_at) order by o.id), '[]'::jsonb)
    into v_items
    from (select *
            from web.orders w
           where w.state in ('waiting', 'received')
             and (w.taken_by is distinct from p_lineage or w.taken_revision is distinct from w.revision)
           order by w.id
           limit least(greatest(coalesce(p_limit, 10), 1), 20)) o;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_orders_mark — the laptop says what it did with each one:
--    {ref, state:'received', revision, jobIds?}         stored; prints sent to Yalla Wear
--    {ref, state:'accepted', saleId, token, jobIds?}    a real order now
--    {ref, state:'rejected', code}                      the shop said no
--  A decision is final: nothing moves an accepted or rejected order again, and
--  'received' never undoes one. Unknown refs are skipped, not errors.
--  Codes: not_owner, bad_items.
-- -----------------------------------------------------------------------------
create or replace function public.web_orders_mark(p_lineage text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e       jsonb;
  v_state   text;
  v_ref     text;
  v_rev     bigint;
  v_token   text;
  v_code    text;
  v_jobs    jsonb;
  v_n       integer;
  v_marked  integer := 0;
  v_skipped integer := 0;
begin
  if not web.is_owner(p_lineage) then return web.no('not_owner'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    return web.no('bad_items');
  end if;

  for v_e in select * from jsonb_array_elements(p_items) loop
    v_ref := web.txt(v_e, 'ref');
    v_state := web.txt(v_e, 'state');
    v_jobs := case when jsonb_typeof(v_e -> 'jobIds') = 'array' then v_e -> 'jobIds' end;
    v_n := 0;

    if v_ref is null or v_state is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_state = 'received' then
      v_rev := web.int(v_e, 'revision');
      update web.orders o
         set state = 'received',
             taken_by = p_lineage,
             taken_revision = case when v_rev is not null and v_rev <= o.revision then v_rev::integer
                                   else o.taken_revision end,
             job_ids = coalesce(v_jobs, o.job_ids),
             updated_at = now()
       where o.ref = v_ref and o.state in ('waiting', 'received');
      get diagnostics v_n = row_count;

    elsif v_state = 'accepted' then
      v_token := web.txt(v_e, 'token');
      if v_token is not null and v_token !~ '^[0-9a-f]{32}$' then v_token := null; end if;
      update web.orders o
         set state = 'accepted',
             state_code = null,
             sale_id = coalesce(left(web.txt(v_e, 'saleId'), 40), o.sale_id),
             track_token = coalesce(v_token, o.track_token),
             job_ids = coalesce(v_jobs, o.job_ids),
             taken_by = p_lineage,
             decided_at = coalesce(o.decided_at, now()),
             updated_at = now()
       where o.ref = v_ref and o.state in ('waiting', 'received', 'accepted');
      get diagnostics v_n = row_count;

    elsif v_state = 'rejected' then
      v_code := coalesce(web.txt(v_e, 'code'), 'other');
      if v_code !~ '^[a-z_]{1,40}$' then v_code := 'other'; end if;
      update web.orders o
         set state = 'rejected',
             state_code = v_code,
             taken_by = p_lineage,
             decided_at = coalesce(o.decided_at, now()),
             updated_at = now()
       where o.ref = v_ref and o.state in ('waiting', 'received', 'rejected');
      get diagnostics v_n = row_count;
    end if;

    if v_n > 0 then v_marked := v_marked + 1; else v_skipped := v_skipped + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'marked', v_marked, 'skipped', v_skipped);
end;
$$;

-- -----------------------------------------------------------------------------
--  Who may call what. Postgres lets PUBLIC execute a new function by default,
--  so every one is shut first and then opened to exactly one role: the
--  website's four to anon (the publishable key — the website key is the real
--  lock), the laptop's two to service_role.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'web.key_ok(text)', 'web.is_owner(text)', 'web.no(text, text)', 'web.txt(jsonb, text)',
    'web.int(jsonb, text)', 'web.proof_ok(text)', 'web.cfg_json(text, jsonb)',
    'public.web_order_submit(text, jsonb, text)', 'public.web_order_proof(text, text, text, text)',
    'public.web_order_status(text, text)', 'public.web_checkout(text)',
    'public.web_orders_take(text, integer)', 'public.web_orders_mark(text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated, service_role', v_fn);
  end loop;
end $$;

grant execute on function public.web_order_submit(text, jsonb, text)        to anon;
grant execute on function public.web_order_proof(text, text, text, text)    to anon;
grant execute on function public.web_order_status(text, text)               to anon;
grant execute on function public.web_checkout(text)                         to anon;
grant execute on function public.web_orders_take(text, integer)             to service_role;
grant execute on function public.web_orders_mark(text, jsonb)               to service_role;

comment on function public.web_order_submit(text, jsonb, text) is
  'The website places an order (030). Refuses everything without the website key. Returns {ok, ref, state} or {ok:false, code}.';
comment on function public.web_orders_take(text, integer) is
  'The shop laptop collects website orders (030). Service key and the mirror''s lineage id only.';
