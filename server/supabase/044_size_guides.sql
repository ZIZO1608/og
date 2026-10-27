-- =============================================================================
--  044 — the size guide (local migration 077, night shift 28 Oct 2026)
-- -----------------------------------------------------------------------------
--  Run in the Supabase SQL editor, after 043. Safe to run twice.
--  Then run verify_044_size_guides.sql, then 030_erp_access.sql again (it
--  grants og_vps the new tables), then `npm run supabase:reconcile` on the
--  VPS to send the guides already made.
--
--  Two mirrored tables (cursor shape, pushed by lib/mirror.js behind a guard
--  of their own), and the website's door:
--
--    public.web_size_guide(p_key, p_id) → { ok, sizeGuide } | not_found
--
--  A product's guide row already holds its rows RESOLVED — its own sizes, in
--  size order, with the numbers (even when it follows a chart) — so nothing
--  here sorts sizes or reads a chart. The published check is
--  web.product_row's own (037…043): a product the website cannot show has no
--  size guide either.
--
--  KEEP IN STEP: web.size_guide_of() with webShape() in
--  server/lib/sizeguide.js, and web.size_measure() with MEASURES there.
--  Every new mirrored table: RLS on with no policies, and the grant block.
-- =============================================================================

CREATE TABLE IF NOT EXISTS size_charts (
  id          BIGINT PRIMARY KEY,
  name_en     TEXT    NOT NULL,
  name_ar     TEXT    NOT NULL,
  type        TEXT,
  measures    TEXT    NOT NULL DEFAULT '[]',
  rows        TEXT    NOT NULL DEFAULT '[]',
  fit         TEXT,
  note_en     TEXT,
  note_ar     TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL,
  created_by  BIGINT,
  updated_at  TIMESTAMPTZ NOT NULL
);
ALTER TABLE size_charts ENABLE ROW LEVEL SECURITY;

-- No foreign keys in the mirror, on purpose: rows arrive one table at a time.
CREATE TABLE IF NOT EXISTS product_size_guides (
  product_id  BIGINT PRIMARY KEY,
  chart_id    BIGINT,
  follows     BOOLEAN NOT NULL DEFAULT FALSE,
  measures    TEXT    NOT NULL DEFAULT '[]',
  rows        TEXT    NOT NULL DEFAULT '[]',
  fit         TEXT,
  note_en     TEXT,
  note_ar     TEXT,
  updated_at  TIMESTAMPTZ NOT NULL,
  updated_by  BIGINT
);
ALTER TABLE product_size_guides ENABLE ROW LEVEL SECURITY;

-- A table made in the SQL editor is not readable by the shop's key on this
-- project until it is granted (17 Sep 2026). service_role in; anon and
-- authenticated out (001's second lock). A table that does not exist is skipped.
DO $$
DECLARE
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['size_charts', 'product_size_guides'] LOOP
    IF to_regclass('public.' || v_t) IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', v_t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_t);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', v_t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- One measurement's names and unit. KEEP IN STEP with MEASURES.
create or replace function web.size_measure(p_id text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', m.id, 'unit', m.unit, 'en', m.en, 'ar', m.ar)
    from (values
      ('chest',    'cm', 'Chest width', 'عرض الصدر'),
      ('length',   'cm', 'Length',      'الطول'),
      ('shoulder', 'cm', 'Shoulder',    'عرض الكتف'),
      ('sleeve',   'cm', 'Sleeve',      'طول الكم'),
      ('waist',    'cm', 'Waist',       'الخصر'),
      ('hip',      'cm', 'Hip',         'الورك'),
      ('inseam',   'cm', 'Inseam',      'الطول الداخلي'),
      ('foot',     'cm', 'Foot length', 'طول القدم'),
      ('eu',       '',   'EU',          'EU'),
      ('us',       '',   'US',          'US'),
      ('uk',       '',   'UK',          'UK')
    ) as m(id, unit, en, ar)
   where m.id = p_id
$$;

-- A product's guide in the website's shape, or null when it has none or it
-- is not complete. KEEP IN STEP with webShape() in server/lib/sizeguide.js.
create or replace function web.size_guide_of(p_product bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  g        public.product_size_guides%rowtype;
  v_ms     jsonb;
  v_rows   jsonb;
  v_r      jsonb;
  v_m      text;
  v_out    jsonb := '[]'::jsonb;
  v_vals   jsonb;
begin
  select * into g from public.product_size_guides where product_id = p_product;
  if not found then return null; end if;
  v_ms := coalesce(nullif(g.measures, '')::jsonb, '[]'::jsonb);
  v_rows := coalesce(nullif(g.rows, '')::jsonb, '[]'::jsonb);
  if jsonb_array_length(v_ms) = 0 or jsonb_array_length(v_rows) = 0 then return null; end if;
  for v_r in select value from jsonb_array_elements(v_rows) loop
    v_vals := '{}'::jsonb;
    for v_m in select value from jsonb_array_elements_text(v_ms) loop
      if jsonb_typeof(v_r -> 'values' -> v_m) is distinct from 'number' then return null; end if;
      v_vals := v_vals || jsonb_build_object(v_m, v_r -> 'values' -> v_m);
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object('size', v_r ->> 'size', 'values', v_vals));
  end loop;
  return jsonb_build_object(
    'unit', 'cm',
    'measures', (select jsonb_agg(web.size_measure(x.value) order by x.ord)
                   from jsonb_array_elements_text(v_ms) with ordinality as x(value, ord)),
    'rows', v_out,
    'fit', g.fit,
    'note', case when coalesce(g.note_en, '') = '' and coalesce(g.note_ar, '') = '' then null
                 else jsonb_build_object('en', coalesce(nullif(g.note_en, ''), g.note_ar),
                                         'ar', coalesce(nullif(g.note_ar, ''), g.note_en)) end
  );
end;
$$;

-- The website's door. Laptop twin: GET /api/ext/products/:id/size-guide.
create or replace function public.web_size_guide(p_key text, p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not web.key_ok(p_key) then return web.no('bad_key'); end if;
  if web.product_row(p_id, web.rate_now()) is null then return web.no('not_found'); end if;
  return jsonb_build_object('ok', true, 'sizeGuide', web.size_guide_of(p_id));
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'web.size_measure(text)', 'web.size_guide_of(bigint)', 'public.web_size_guide(text, bigint)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated, service_role', v_fn);
  end loop;
end $$;

grant execute on function public.web_size_guide(text, bigint) to anon, service_role;

comment on function public.web_size_guide(text, bigint) is
  'A published product''s size guide for the website (044): measures in both languages, rows in size order, fit, note; sizeGuide null when it has none. Website key required. Laptop twin: GET /api/ext/products/:id/size-guide.';
