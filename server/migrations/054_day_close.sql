-- =============================================================================
--  054 — closing the day
-- -----------------------------------------------------------------------------
--  The owner's night, as he described it: the CASHIER counts the drawer — lira
--  and dollars — without being shown what the book expects; the OWNER then
--  sees the difference, takes the cash home, and leaves a float. The cash he
--  takes still pays shop costs, so it moves to the `owner` place (053) rather
--  than leaving the books.
--
--  WHY NOT THE SHIFT CLOSE. A shift has one float typed fresh each morning,
--  one currency and one count, and this shop has never opened one — the live
--  database had twenty sales, every one with shift_id NULL. The drawer in the
--  cash book is continuous: tomorrow's float is simply what was left tonight,
--  so nobody types a float again. Shifts stay (sales carry shift_id, the table
--  is mirrored, and a shop that uses them keeps them).
--
--  EXPECTED IS FROZEN AT THE COUNT, not at the confirmation. A sale rung up
--  between the cashier counting and the owner confirming is in the drawer's
--  balance and not in the count; measured against the balance at confirmation
--  it would read as a shortage nobody caused.
--
--  ONE ROW PER CURRENCY in day_close_lines, riding on its close the way
--  sale_items ride on a sale: a recount replaces them whole.
-- =============================================================================

CREATE TABLE IF NOT EXISTS day_closes (
  id           TEXT PRIMARY KEY,                     -- DC-0001
  --  The shop-local day it was counted (shop.tz_minutes), for the reminders
  --  and the list. Informational: a shop may count twice in a day.
  day          TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'counted'
               CHECK (status IN ('counted', 'closed', 'cancelled')),
  counted_by   INTEGER REFERENCES users(id),
  counted_name TEXT,
  counted_at   TEXT NOT NULL,
  note         TEXT,
  confirmed_by   INTEGER REFERENCES users(id),
  confirmed_name TEXT,
  confirmed_at   TEXT,
  owner_note     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS day_close_lines (
  close_id  TEXT    NOT NULL REFERENCES day_closes(id) ON DELETE CASCADE,
  currency  TEXT    NOT NULL REFERENCES currencies(code),
  counted   INTEGER NOT NULL CHECK (counted >= 0),
  --  The drawer's balance in the cash book at the moment of the count.
  expected  INTEGER NOT NULL,
  --  What the owner took home. Written at confirmation.
  taken     INTEGER NOT NULL DEFAULT 0 CHECK (taken >= 0),
  PRIMARY KEY (close_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_day_closes_status ON day_closes (status, counted_at);
CREATE INDEX IF NOT EXISTS idx_day_closes_day    ON day_closes (day);

--  Counting the drawer: the cashier's, and the manager's. Confirming is
--  money.move (053). The partner can never be given it — FORBIDDEN refuses
--  anything starting with 'money.'.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('manager',   'money.count', 1, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'money.count', 1, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'money.count', 0, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'money.count', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'money.count', 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT DO NOTHING;

--  THE NIGHTLY NUDGE: the drawer took money today and nobody has counted it.
--  ON, because counting every night is the process the owner described. Named
--  explicitly — a missing key reads as ON anyway (reminders.js), but 043's
--  rule is that every rule ships with its row. The dollar threshold for a
--  variance sits beside the lira one: 1000 is ten lira-cents of nothing and
--  ten dollars of something, so one number cannot serve both.
INSERT INTO config (key, value, updated_at) VALUES
  ('reminders.day_uncounted',    '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.day_count_hour',   '22',  '1970-01-01T00:00:00.000Z'),
  ('reminders.variance_min_usd', '100', '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

--  The cashier is the one who counts, so her phone hears the nudge. Appended
--  to a preset that is a list; a preset somebody set to everything (null) or
--  already holding it is left alone.
UPDATE config
   SET value = json_insert(value, '$[#]', 'rem_day_uncounted'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE key = 'reminders.preset.cashier'
   AND json_valid(value) AND json_type(value) = 'array'
   AND NOT EXISTS (SELECT 1 FROM json_each(config.value) j WHERE j.value = 'rem_day_uncounted');
