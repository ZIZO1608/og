-- =============================================================================
--  060 — Safeers (السفراء): the delivery team's errands, pay and areas
-- -----------------------------------------------------------------------------
--  Night shift 01, E2. The delivery office, the board and the road already
--  move PARCELS. This is the team layer on top: the people (users with the
--  `delivery` role), their tasks, their pay, the cash they carry.
--
--  AN ERRAND is a task that is not a parcel — bring stock from the
--  warehouse, collect from a supplier. It moves one way, like a delivery:
--  waiting → out → done | failed (failed carries a reason). It NEVER moves
--  stock or money by itself: goods that leave go through an order or a stock
--  move, and an errand may point at the order (sale_id).
--
--  A safeer is scoped to his own errands in the SQL (lib/safeers.js), and
--  somebody else's answers 404, as a delivery does.
--
--  PAY IS PER DELIVERY: every parcel delivered and every errand done counts
--  as one; earned = count × config safeer.rate. Derived, never stored.
--
--  Cursor shape (an errand is updated as it moves), logChange in the same
--  transaction. Mirror twin: server/supabase/028_safeers.sql.
-- =============================================================================

CREATE TABLE errands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'other'
              CHECK (kind IN ('stock_run','supplier_pickup','bank','other')),
  from_place  TEXT,
  --  An id from config safeer.areas, or free text when the owner's list does
  --  not have it.
  to_area     TEXT,
  notes       TEXT,
  due_date    TEXT,                    -- YYYY-MM-DD, the shop's day
  sale_id     TEXT    REFERENCES sales(id),
  safeer_id   INTEGER REFERENCES users(id),
  assigned_by INTEGER REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'waiting'
              CHECK (status IN ('waiting','out','done','failed')),
  fail_reason TEXT,
  created_at  TEXT    NOT NULL,
  out_at      TEXT,
  closed_at   TEXT,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX errands_safeer ON errands (safeer_id, status);
CREATE INDEX errands_status ON errands (status, created_at);

-- The permissions: the owner, the developer and the manager.
INSERT OR IGNORE INTO role_permissions (role, perm, allowed, updated_at)
SELECT r.role, p.perm,
       CASE WHEN r.role IN ('owner','developer','manager') THEN 1 ELSE 0 END,
       '1970-01-01T00:00:00.000Z'
  FROM (SELECT DISTINCT role FROM role_permissions) r
  CROSS JOIN (SELECT 'safeer.read' AS perm UNION ALL SELECT 'safeer.write') p;

-- The rate (none until the owner sets one) and the areas a task can go to —
-- real Aleppo districts, as a start the owner edits in Settings.
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('safeer.rate', 'null', '1970-01-01T00:00:00.000Z'),
  ('safeer.areas', '[
    {"id":"new-aleppo","en":"New Aleppo","ar":"حلب الجديدة","active":true},
    {"id":"furqan","en":"Al-Furqan","ar":"الفرقان","active":true},
    {"id":"mogambo","en":"Mogambo","ar":"الموكامبو","active":true},
    {"id":"sabil","en":"Al-Sabil","ar":"السبيل","active":true},
    {"id":"aziziyah","en":"Al-Aziziyah","ar":"العزيزية","active":true},
    {"id":"shahba","en":"Al-Shahba","ar":"الشهباء","active":true},
    {"id":"jamiliyah","en":"Al-Jamiliyah","ar":"الجميلية","active":true},
    {"id":"muhafaza","en":"Al-Muhafaza","ar":"المحافظة","active":true}
  ]', '1970-01-01T00:00:00.000Z');
