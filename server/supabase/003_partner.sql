-- =============================================================================
--  Mirror schema for the partner half — run this in the Supabase SQL editor.
-- -----------------------------------------------------------------------------
--  Matches server/migrations/015_partner.sql column for column. SQLite stores
--  a boolean as 0/1 and a timestamp as text; Postgres gets the real types and
--  the sync converts on the way out, exactly as it already does for
--  products.hidden and role_permissions.allowed.
--
--  Until this has been run, supabase-sync.js says so by name and carries on
--  with the tables that do exist rather than failing the whole run.
--
--  Nothing reads from here in normal operation. This is the copy for the day
--  the shop's machine dies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS clubs (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  name_ar    TEXT,
  archived   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id              BIGINT PRIMARY KEY,
  name            TEXT NOT NULL,
  contact         TEXT,
  category        TEXT,
  currency        TEXT NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  outstanding     BIGINT NOT NULL DEFAULT 0,
  total_purchased BIGINT NOT NULL DEFAULT 0,
  due_date        TEXT,
  last_payment    TEXT,
  archived        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id           BIGINT PRIMARY KEY,
  user_id      BIGINT,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  salary       BIGINT NOT NULL DEFAULT 0,
  next_payment TEXT,
  since        TEXT,
  phone        TEXT,
  archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id         TEXT PRIMARY KEY,
  customer   TEXT NOT NULL,
  phone      TEXT,
  design     TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'bulk'   CHECK (kind IN ('bulk','kit')),
  priority   TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  stage      TEXT NOT NULL DEFAULT 'design'
             CHECK (stage IN ('design','sent','printing','delivery','done')),
  qty        INTEGER NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  price      BIGINT NOT NULL DEFAULT 0,
  cost       BIGINT,
  deadline   TEXT,
  sale_id    TEXT,
  order_state        TEXT NOT NULL DEFAULT 'draft'
                     CHECK (order_state IN ('draft','pending','accepted','declined')),
  order_sent_at      TEXT,
  order_responded_at TEXT,
  order_promised_at  TEXT,
  order_note         TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by BIGINT
);

CREATE TABLE IF NOT EXISTS print_job_lines (
  id         BIGINT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  club_code  TEXT REFERENCES clubs(code),
  print_name TEXT,
  number     INTEGER,
  size       TEXT,
  qty        INTEGER NOT NULL DEFAULT 1,
  unit_cost  BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS print_job_stages (
  id      BIGINT PRIMARY KEY,
  job_id  TEXT NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  stage   TEXT NOT NULL,
  at      TIMESTAMPTZ NOT NULL,
  by_side TEXT,
  user_id BIGINT
);

CREATE TABLE IF NOT EXISTS partner_invoices (
  id         TEXT PRIMARY KEY,
  issued     TEXT NOT NULL,
  due        TEXT NOT NULL,
  note       TEXT,
  currency   TEXT NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS partner_invoice_refs (
  invoice_id TEXT NOT NULL REFERENCES partner_invoices(id) ON DELETE CASCADE,
  job_id     TEXT NOT NULL REFERENCES print_jobs(id),
  PRIMARY KEY (invoice_id, job_id)
);

CREATE TABLE IF NOT EXISTS partner_invoice_payments (
  id         BIGINT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES partner_invoices(id) ON DELETE CASCADE,
  at         TIMESTAMPTZ NOT NULL,
  amount     BIGINT NOT NULL,
  method     TEXT NOT NULL,
  user_id    BIGINT
);

CREATE TABLE IF NOT EXISTS job_messages (
  id         BIGINT PRIMARY KEY,
  job_id     TEXT REFERENCES print_jobs(id)       ON DELETE CASCADE,
  invoice_id TEXT REFERENCES partner_invoices(id) ON DELETE CASCADE,
  from_side  TEXT NOT NULL CHECK (from_side IN ('og','yalla')),
  kind       TEXT NOT NULL,
  reason     TEXT,
  body       TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL,
  read_og    BOOLEAN NOT NULL DEFAULT FALSE,
  read_yl    BOOLEAN NOT NULL DEFAULT FALSE,
  user_id    BIGINT
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id       BIGINT PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL,
  phone    TEXT NOT NULL,
  body     TEXT NOT NULL,
  kind     TEXT,
  ref_type TEXT,
  ref_id   TEXT,
  user_id  BIGINT
);

CREATE INDEX IF NOT EXISTS idx_job_lines_job   ON print_job_lines(job_id);
CREATE INDEX IF NOT EXISTS idx_job_stages_job  ON print_job_stages(job_id);
CREATE INDEX IF NOT EXISTS idx_msg_job         ON job_messages(job_id);
CREATE INDEX IF NOT EXISTS idx_msg_invoice     ON job_messages(invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_refs_job    ON partner_invoice_refs(job_id);
CREATE INDEX IF NOT EXISTS idx_inv_pay_invoice ON partner_invoice_payments(invoice_id);

--  Same posture as the rest of the mirror: the service key writes, nobody
--  else reads. Row level security ON with no policy means no anon access at
--  all, which is the intent — this database holds a shop's whole trading
--  history and another company's prices.
ALTER TABLE clubs                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees                ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_jobs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_job_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_job_stages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_invoice_refs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_messages              ENABLE ROW LEVEL SECURITY;
