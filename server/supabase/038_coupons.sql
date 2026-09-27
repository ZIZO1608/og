-- =============================================================================
--  038 — coupon codes in the mirror, and the website's check   (local 068)
-- -----------------------------------------------------------------------------
--  Run by hand in the Supabase SQL editor, AFTER 030_web_orders.sql (it uses
--  that file's web.key_ok and web.no). Standalone like 030, 031 and 037 — not
--  part of CATCH-UP.sql. Every statement is IF NOT EXISTS / CREATE OR REPLACE
--  / a GRANT or a REVOKE, so running it twice changes nothing.
--  Then run verify_038_coupons.sql.
--
--  Until it is run the shop's sync skips coupons and coupon_uses BY NAME and
--  pushes everything else (lib/mirror.js); their rows wait on the shop's
--  server and go up on the first run after. The till and the order desk do
--  not need this file at all. The WEBSITE does: public.web_coupon below is how
--  its checkout asks whether a code is good before the customer places the
--  order. The shop checks the code again, for real, when a person accepts the
--  order in the desk — a code used up in between is refused there.
--
--  TWO TABLES, both pushed by the shop:
--    coupons      — the codes (cursor shape: a code is switched off, edited)
--    coupon_uses  — one row per sale a code went on (append-only). A use
--                   counts while its SALE is not voided: the join, never a
--                   stored number, exactly as on the shop's server.
--  No foreign keys: the sync pushes a use after its sale and its coupon, and a
--  missing parent must never stop a push (001's rule for the history tables).
--  RLS on, no policies — the service key still works and nothing else can
--  (001's model). Run 030_erp_access.sql again afterwards if og_vps should
--  read them.
-- =============================================================================

CREATE TABLE IF NOT EXISTS coupons (
  id                 BIGINT PRIMARY KEY,
  code               TEXT    NOT NULL,
  note               TEXT,
  kind               TEXT    NOT NULL CHECK (kind IN ('percent', 'amount')),
  percent            INTEGER,
  amount             BIGINT,
  currency           TEXT    NOT NULL DEFAULT 'USD',
  min_basket         BIGINT,
  max_uses           INTEGER,
  once_per_customer  BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at          TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL,
  created_by         BIGINT,
  updated_at         TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code ON coupons (code);
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS coupon_uses (
  id           BIGINT PRIMARY KEY,
  coupon_id    BIGINT  NOT NULL,
  code         TEXT    NOT NULL,
  sale_id      TEXT    NOT NULL,
  customer_id  BIGINT,
  currency     TEXT    NOT NULL,
  discount     BIGINT  NOT NULL,
  channel      TEXT    NOT NULL DEFAULT 'till',
  at           TIMESTAMPTZ NOT NULL,
  user_id      BIGINT
);
CREATE INDEX IF NOT EXISTS coupon_uses_coupon ON coupon_uses (coupon_id);
CREATE INDEX IF NOT EXISTS coupon_uses_sale ON coupon_uses (sale_id);
ALTER TABLE coupon_uses ENABLE ROW LEVEL SECURITY;

-- ---- grants ----
--  A table made in the SQL editor has NO privileges for the service_role on
--  this project (found 17 Sep 2026). The shop's key reads and writes them;
--  anon and authenticated are kept out.
DO $$
DECLARE
  t TEXT;
  s RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['coupons', 'coupon_uses'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
      FOR s IN
        SELECT seq.relname
          FROM pg_class seq
          JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
          JOIN pg_class tab ON tab.oid = dep.refobjid
         WHERE seq.relkind = 'S' AND tab.oid = ('public.' || t)::regclass
      LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', s.relname);
      END LOOP;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
--  public.web_coupon — the website's checkout asks whether a code is good.
--
--  p_key       the website key (web.key_ok, 030)
--  p_code      what the customer typed; case and spaces do not matter
--  p_subtotal  the goods in the basket, in USD CENTS (optional). With it the
--              minimum basket is checked and `discount` is worked out.
--  p_phone     the customer's phone (optional). With it a once-per-customer
--              code is checked against the customer with that number.
--
--  { ok: true,  code, kind, percent, amount, currency: 'USD', minBasket,
--               oncePerCustomer, discount }            discount in USD cents
--  { ok: false, code: 'bad_key' | 'coupon_unknown' | 'coupon_off' |
--               'coupon_not_yet' | 'coupon_expired' | 'coupon_used_up' |
--               'coupon_min_basket' | 'coupon_used_by_customer', ... }
--
--  THE RULE IS THE SHOP'S (server/lib/coupons.js evaluate()); KEEP IN STEP.
--  A percent is floor(subtotal × percent / 100 + 0.5), which is what
--  Math.round gives there for a positive amount; an amount is capped at the
--  basket. The shop works the real cut out again in the SALE's currency when
--  the order is accepted — this answer is what the customer is shown.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.web_coupon(p_key text, p_code text, p_subtotal bigint DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code  text;
  c       public.coupons%ROWTYPE;
  v_used  integer;
  v_cut   bigint;
  v_digits text;
BEGIN
  IF NOT web.key_ok(p_key) THEN RETURN web.no('bad_key'); END IF;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[[:space:]]+', '', 'g'));
  IF v_code = '' OR char_length(v_code) > 24 THEN RETURN web.no('coupon_unknown', 'code'); END IF;

  SELECT * INTO c FROM public.coupons WHERE code = v_code;
  IF NOT FOUND THEN RETURN web.no('coupon_unknown', 'code'); END IF;
  IF NOT c.active THEN RETURN web.no('coupon_off', 'code'); END IF;
  IF c.starts_at IS NOT NULL AND now() < c.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'coupon_not_yet', 'startsAt', c.starts_at);
  END IF;
  IF c.expires_at IS NOT NULL AND now() > c.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'coupon_expired', 'expiresAt', c.expires_at);
  END IF;

  IF c.max_uses IS NOT NULL THEN
    SELECT count(*) INTO v_used
      FROM public.coupon_uses u JOIN public.sales s ON s.id = u.sale_id
     WHERE u.coupon_id = c.id AND NOT s.voided;
    IF v_used >= c.max_uses THEN RETURN web.no('coupon_used_up', 'code'); END IF;
  END IF;

  IF c.once_per_customer AND p_phone IS NOT NULL THEN
    v_digits := right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 9);
    IF char_length(v_digits) = 9 AND EXISTS (
      SELECT 1
        FROM public.coupon_uses u
        JOIN public.sales s ON s.id = u.sale_id AND NOT s.voided
        JOIN public.customers cu ON cu.id = u.customer_id
       WHERE u.coupon_id = c.id
         AND right(regexp_replace(coalesce(cu.phone, ''), '[^0-9]', '', 'g'), 9) = v_digits
    ) THEN
      RETURN web.no('coupon_used_by_customer', 'phone');
    END IF;
  END IF;

  IF p_subtotal IS NOT NULL AND c.min_basket IS NOT NULL AND p_subtotal < c.min_basket THEN
    RETURN jsonb_build_object('ok', false, 'code', 'coupon_min_basket', 'minBasket', c.min_basket);
  END IF;

  IF p_subtotal IS NOT NULL AND p_subtotal > 0 THEN
    IF c.kind = 'percent' THEN
      v_cut := floor(p_subtotal::numeric * c.percent / 100 + 0.5);
    ELSE
      v_cut := c.amount;
    END IF;
    v_cut := greatest(0, least(p_subtotal, v_cut));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'code', c.code, 'kind', c.kind, 'percent', c.percent, 'amount', c.amount,
    'currency', 'USD', 'minBasket', c.min_basket, 'oncePerCustomer', c.once_per_customer,
    'expiresAt', c.expires_at, 'discount', v_cut);
END;
$$;

REVOKE ALL ON FUNCTION public.web_coupon(text, text, bigint, text) FROM public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.web_coupon(text, text, bigint, text) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.web_coupon(text, text, bigint, text) TO anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.web_coupon(text, text, bigint, text) TO service_role';
  END IF;
END $$;

COMMENT ON FUNCTION public.web_coupon(text, text, bigint, text) IS
  'The website asks whether a coupon code is good (038). Website key only. The shop checks it again when the order is accepted.';
