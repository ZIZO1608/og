-- =============================================================================
--  031 — HOW THE WEBSITE IS PAID: the owner decides, the cloud says it in seconds
-- -----------------------------------------------------------------------------
--  Paste the whole file into the Supabase SQL editor and run it once, AFTER
--  030_web_orders.sql. Safe to run again: every statement replaces what is
--  there. No local migration goes with it and no table is created or changed,
--  so mirror-lag.js, drift, reconcile and restore do not change. Then run
--  verify_031_web_payments.sql.
--
--  WHAT THE OWNER NOW DECIDES (OG System → the Payment methods page)
--    * Which transfer methods the website offers — a switch per method
--      ("On the website", pay.methods[].web). A method is offered only when
--      that switch is on, the method is switched on in the shop, the order
--      desk can take it (a website order is accepted there), it is not one of
--      the till's own (cash, cod, credit, order, store_credit), and its
--      account ("where customers send the money", pay.accounts) is written in
--      BOTH Arabic and English. A method saved before the switch existed (no
--      `web` key at all) keeps 030's rule — any account text puts it on — so
--      running this file does not take the live site's methods away; the
--      shop writes the switch for every other method on its next Save.
--    * A colour per method (pay.methods[].color, #rrggbb) for the buttons.
--    * Whether cash on delivery is offered on the website at all (config
--      web.cod = '0' switches it off).
--
--  WHAT CHANGES FOR THE WEBSITE
--    web_checkout      gains `cod`, `version` and `updatedAt`, and each transfer
--                      method its `color`. `version` changes exactly when
--                      something the checkout shows changed. The website now
--                      reads it every time a checkout opens (the contract used
--                      to say cache it ten minutes).
--    web_order_submit  refuses a transfer method the website no longer offers
--                      (`method_gone`) and cash on delivery while it is off
--                      (`cod_off`), so a page left open across a change can
--                      never place an order on a method the owner took away.
--  Both answer from the ONE rule below (web.transfer_methods), so what the
--  checkout lists and what an order may use cannot disagree.
--
--  WHAT CHANGES FOR THE SHOP'S LAPTOP
--    web_checkout may also be called with the service key (it still needs the
--    website key): the laptop reads back EXACTLY what the website reads and
--    shows the owner "Live on the website ✓" — or what is in the way.
--
--  The laptop's half of the rule is webProblem/onWeb in server/lib/orders.js
--  and expected() in server/lib/webcheckout.js. Change all three together.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  THE ONE RULE: the transfer methods the website may offer, in the owner's
--  order. Each {id, en, ar, color, details:{en, ar}}.
-- -----------------------------------------------------------------------------
create or replace function web.transfer_methods()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_system constant text[] := array['cash', 'cod', 'credit', 'order', 'store_credit'];
  v_methods  jsonb;
  v_accounts jsonb;
  v_out      jsonb;
begin
  v_accounts := web.cfg_json('pay.accounts', '{}'::jsonb);
  if jsonb_typeof(v_accounts) <> 'object' then v_accounts := '{}'::jsonb; end if;
  v_methods := web.cfg_json('pay.methods', '[]'::jsonb);
  if jsonb_typeof(v_methods) <> 'array' then v_methods := '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.m ->> 'id',
           'en', e.m ->> 'en',
           'ar', e.m ->> 'ar',
           'color', case when (e.m ->> 'color') ~ '^#[0-9a-f]{6}$' then e.m ->> 'color' end,
           'details', jsonb_build_object('en', x.den, 'ar', x.dar))
           order by e.ord), '[]'::jsonb)
    into v_out
    from jsonb_array_elements(v_methods) with ordinality as e(m, ord)
    cross join lateral (
      select nullif(btrim(coalesce(v_accounts -> (e.m ->> 'id') ->> 'en', '')), '') as den,
             nullif(btrim(coalesce(v_accounts -> (e.m ->> 'id') ->> 'ar', '')), '') as dar,
             jsonb_typeof(v_accounts -> (e.m ->> 'id')) = 'object'                  as has
    ) x
   where jsonb_typeof(e.m) = 'object'
     and coalesce(e.m ->> 'id', '') <> ''
     and not ((e.m ->> 'id') = any (c_system))
     and coalesce(e.m ->> 'system', 'false') <> 'true'
     and coalesce(e.m ->> 'active', 'true') <> 'false'
     -- a website order is accepted at the order desk, which must be able to
     -- record the transfer on this method (Card is seeded desk:false)
     and coalesce(e.m ->> 'desk', 'false') = 'true'
     and x.has
     and case
           -- the owner's switch (031): on, and the account in both languages
           when jsonb_typeof(e.m -> 'web') = 'boolean'
             then (e.m ->> 'web') = 'true' and x.den is not null and x.dar is not null
           -- a list saved before the switch existed: 030's rule
           else x.den is not null or x.dar is not null
         end;

  return v_out;
end;
$$;

-- Cash on delivery on the website: on unless the owner switched it off.
create or replace function web.cod_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select btrim(c.value) from public.config c where c.key = 'web.cod'), '1') <> '0';
$$;

-- -----------------------------------------------------------------------------
--  public.web_checkout — as 030, plus `cod`, `version`, `updatedAt` and a
--  colour on each transfer method, all from the rule above.
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
  v_base   text;
  v_rate   jsonb;
  v_cod    boolean;
  v_answer jsonb;
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
      'unitPrice', (select case when btrim(c.value) ~ '^[0-9]{1,13}$' then btrim(c.value)::bigint end
                      from public.config c where c.key = 'print.unit_price'),
      'currency', v_base,
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
                                   'delivery.countries', 'delivery.prices', 'print.unit_price'))
  );
end;
$$;

-- -----------------------------------------------------------------------------
--  public.web_order_submit — as 030, with two refusals added where the payment
--  is checked:
--    cod_off      cash on delivery while the owner has it off on the website
--    method_gone  a transfer method the website does not offer (any more)
--  A page left open while the owner changed the methods gets one of these; the
--  website reads web_checkout again and asks the customer to choose.
--  Codes: bad_key, unsupported, too_big, bad_ref, bad_name, bad_phone,
--  bad_items, bad_prints, empty, bad_delivery, bad_address, bad_city,
--  bad_country, bad_payment, cod_off, cod_not_here, method_gone, bad_proof,
--  ref_taken, too_many, full.
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
  -- Checked BEFORE the payment rules: an order that landed before the owner
  -- changed a method is still that order, and its retry must say so.
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

  v_pay := p_order -> 'payment';
  if jsonb_typeof(v_pay) is distinct from 'object' then return web.no('bad_payment', 'payment'); end if;
  v_type := web.txt(v_pay, 'type');
  if v_type is null or v_type not in ('cod', 'transfer') then return web.no('bad_payment', 'payment.type'); end if;
  -- 031: the owner can take cash on delivery off the website altogether.
  if v_type = 'cod' and not web.cod_on() then return web.no('cod_off', 'payment.type'); end if;
  if v_type = 'cod' and v_method not in ('driver', 'pickup') then return web.no('cod_not_here', 'payment.type'); end if;
  if v_type = 'transfer' and coalesce(web.txt(v_pay, 'method'), '') !~ '^[a-z0-9_]{1,32}$' then
    return web.no('bad_payment', 'payment.method');
  end if;
  -- 031: only a method the checkout offers RIGHT NOW. The same rule the
  -- checkout lists from, so the two can never disagree.
  if v_type = 'transfer' and not exists (
       select 1 from jsonb_array_elements(web.transfer_methods()) t
        where t ->> 'id' = web.txt(v_pay, 'method')) then
    return web.no('method_gone', 'payment.method');
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
  select * into v_row from web.orders o where o.ref = v_ref;
  if found and v_row.payload = p_order then
    return jsonb_build_object('ok', true, 'ref', v_row.ref, 'state', v_row.state,
                              'placedAt', v_row.created_at, 'replayed', true);
  end if;
  return web.no('ref_taken', 'ref');
end;
$$;

-- -----------------------------------------------------------------------------
--  Who may call what. The two helpers are nobody's; the checkout is the
--  website's (anon, with the website key) AND the laptop's (service_role, with
--  the same key) so the shop can read back exactly what the website reads.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'web.transfer_methods()', 'web.cod_on()',
    'public.web_checkout(text)', 'public.web_order_submit(text, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated, service_role', v_fn);
  end loop;
end $$;

grant execute on function public.web_checkout(text)                  to anon, service_role;
grant execute on function public.web_order_submit(text, jsonb, text) to anon;

comment on function public.web_checkout(text) is
  'What the website checkout offers (030, 031): shipping, transfer methods with colour, cash on delivery, print price, and a version that moves when any of it does. Website key required; callable by anon (the website) and service_role (the shop reading it back).';
comment on function web.transfer_methods() is
  'THE rule for which transfer methods the website offers (031). Used by web_checkout and web_order_submit. Laptop twin: server/lib/orders.js onWeb/webProblem.';
