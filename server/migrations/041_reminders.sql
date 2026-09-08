-- =============================================================================
--  041 — REMINDERS: the outbox learns to carry a standing condition
-- -----------------------------------------------------------------------------
--  The two bots only ever speak when something CHANGES: an order is placed, a
--  stage moves, a payment is recorded. Nothing chases anybody, because the
--  absence of a response is not an event. An order can sit `pending` at Yalla
--  Wear for three days and neither side hears a word.
--
--  lib/reminders.js is the other half: it evaluates standing conditions on a
--  timer and queues them into THIS table, which lib/telegram.js already drains
--  with retries, backoff, multi-chat fan-out and 403-drops-the-chat. Reusing
--  that beats a second outbox — the second copy is the one that gets the 403
--  handling wrong.
--
--  TWO CHANGES, AND SQLITE CANNOT MAKE EITHER IN PLACE
--  ---------------------------------------------------
--  1. ref_type was CHECK (ref_type IN ('job','invoice')). A stock or shift
--     reminder is neither. The CHECK GOES rather than growing a longer list,
--     for the same reason `kind` never had one: it is a routing label, not a
--     foreign key, and nothing joins on it. Widening it to eight values just
--     moves the next rebuild to the next family of reminders. NOT NULL stays
--     on both ref_type and ref_id — every row must say what it is about, which
--     is what makes the dedupe key derivable and `/job P-1043` one index away.
--
--     A synthetic ref (ref_type='job', ref_id='shift:SH-0042') was considered
--     and rejected: it lies in a column a bot command will query.
--
--  2. `dedupe` — THE NO-NAG LEDGER, and the reason this is a table change and
--     not a variable. A reminder is a standing condition, so a naive tick
--     re-sends it every minute forever. The key is
--
--         rem:<ruleId>:<ref>:<occasion>
--
--     where the occasion is a shop-local day key (a daily digest), a step
--     derived from an instant the row already carries (`4h` since
--     order_sent_at), or a calendar bucket for a state with no start instant
--     (stock has no "went to zero at" column). The partial UNIQUE index is the
--     enforcement, so the DATABASE is the ledger: a restart, a laptop taking
--     the baton, or two servers on one file cannot double-send. The row that
--     was sent IS the record that it was said, which is why nothing needs to
--     remember anything in memory.
--
--     NULL for every event partner.js writes — those are real-time news and
--     must never be deduped.
--
--  SQLite cannot DROP a CHECK, so the table is rebuilt. That costs nothing
--  here: partner_events is deliberately NOT mirrored (035 says why), so there
--  is no server/supabase/ file to paste in the dashboard, no mirror-lag.js
--  entry and no drift window. Ids are copied explicitly so `ORDER BY id LIMIT`
--  in drain() keeps its meaning and sqlite_sequence lands on the right mark.
-- =============================================================================

ALTER TABLE partner_events RENAME TO partner_events_old;

CREATE TABLE partner_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL,
  ref_type    TEXT NOT NULL,          -- no CHECK, for the reason `kind` has none
  ref_id      TEXT NOT NULL,
  audience    TEXT NOT NULL CHECK (audience IN ('og', 'yalla')),
  args_json   TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'telegram',
  sent_at     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT,
  error       TEXT,
  dedupe      TEXT                    -- NULL for the real-time events
);

INSERT INTO partner_events
  (id, at, kind, ref_type, ref_id, audience, args_json,
   channel, sent_at, attempts, next_try_at, error)
  SELECT id, at, kind, ref_type, ref_id, audience, args_json,
         channel, sent_at, attempts, next_try_at, error
    FROM partner_events_old;

-- Dropping the old table takes its indexes with it, which frees the name.
DROP TABLE partner_events_old;

CREATE INDEX partner_events_queue ON partner_events (channel, sent_at, next_try_at);
-- What a phase-2 `/job P-1043` will read, and how a rule finds its own history.
CREATE INDEX partner_events_ref ON partner_events (audience, kind, ref_id);
-- The ledger. Partial, so the thousands of NULLs on real-time events cost nothing.
CREATE UNIQUE INDEX partner_events_dedupe ON partner_events (dedupe) WHERE dedupe IS NOT NULL;

-- -----------------------------------------------------------------------------
--  The switches, the hours, and the shop's time zone.
--
--  All of these are hours, day counts and booleans — nothing secret — which
--  matters because GET /api/config hands this table to every login including
--  the partner. That is also what lets Yalla Wear's portal read the state of
--  its own bot. A bot TOKEN stays in server/.env for exactly the same reason.
--
--  shop.tz_minutes is new and is the first server-side notion of the shop's
--  day. Everywhere else "the day belongs to the browser" — the dashboard and
--  the reports are handed two instants and a zone. A scheduler has no browser
--  to ask, so it needs its own source of truth. Syria is UTC+3 with no DST
--  since 2022, hence 180; the Settings fold shows the resulting clock and
--  offers the device's own offset when the two disagree, because a silently
--  wrong offset is a digest arriving at the wrong hour every day with nothing
--  on screen saying why.
--
--  reminders.yalla_paused is OG's master override on the partner's bot. Each
--  reminders.yl_* switch stays ONE key with two writers (the partner through
--  PUT /api/reminders/config, OG's manager through PUT /api/config) rather
--  than two keys that could disagree about one switch; the pause is ANDed with
--  it, so a paused bot is silent whatever the partner has ticked.
-- -----------------------------------------------------------------------------

INSERT INTO config (key, value, updated_at) VALUES
  ('shop.tz_minutes',                '180', '1970-01-01T00:00:00.000Z'),

  ('reminders.enabled',              '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.yalla_paused',         '0',   '1970-01-01T00:00:00.000Z'),
  -- Midnight to eight, not eleven to eight. An Aleppo shop is open in the
  -- evening: with quiet starting at 23 the nightly close (21) and the
  -- still-open-drawer nudge (22) shared a single hour, and a night the server
  -- was busy at ten past ten swallowed both — the day key had rolled by the
  -- time quiet lifted, so they were never said at all.
  ('reminders.quiet_from',           '0',   '1970-01-01T00:00:00.000Z'),
  ('reminders.quiet_to',             '8',   '1970-01-01T00:00:00.000Z'),
  ('reminders.day_close_hour',       '21',  '1970-01-01T00:00:00.000Z'),
  ('reminders.shift_open_hour',      '22',  '1970-01-01T00:00:00.000Z'),
  ('reminders.yl_digest_hour',       '9',   '1970-01-01T00:00:00.000Z'),
  ('reminders.order_wait_hours',     '4',   '1970-01-01T00:00:00.000Z'),
  ('reminders.unread_hours',         '3',   '1970-01-01T00:00:00.000Z'),
  ('reminders.delivery_stuck_hours', '48',  '1970-01-01T00:00:00.000Z'),
  ('reminders.pay_confirm_hours',    '24',  '1970-01-01T00:00:00.000Z'),
  ('reminders.stock_repeat_days',    '7',   '1970-01-01T00:00:00.000Z'),
  -- Minor units of the base currency. SYP has minor_exp 0, so this is 1000
  -- lira — roughly $8 on the redenominated lira. Below it a drawer difference
  -- is counting, not a problem worth a message at ten at night.
  ('reminders.variance_min',         '1000', '1970-01-01T00:00:00.000Z'),
  -- Written by the phase-2 /mute command. Honoured from today so the command
  -- needs no new state when it arrives.
  ('reminders.muted_until_og',       '',    '1970-01-01T00:00:00.000Z'),
  ('reminders.muted_until_yalla',    '',    '1970-01-01T00:00:00.000Z'),

  -- One switch per rule, named exactly after the rule id in lib/reminders.js.
  -- The Settings fold reads the same ids, so a rule added on the server needs
  -- one row there and two i18n keys, and nothing else.
  ('reminders.day_close',            '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.shift_open',           '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.cash_variance',        '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.stock_out',            '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.stock_critical',       '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.po_late',              '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.wants_back',           '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.order_no_answer',      '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.job_late',             '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.partner_unread',       '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.job_stuck',            '1',   '1970-01-01T00:00:00.000Z'),
  -- Off by default: the shop confirms Yalla Wear's payments at the counter
  -- often enough that a nightly nudge about it reads as noise. On when asked.
  ('reminders.pay_wait',             '0',   '1970-01-01T00:00:00.000Z'),

  ('reminders.yl_order_waiting',     '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.yl_due',               '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.yl_blocked',           '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.yl_digest',            '1',   '1970-01-01T00:00:00.000Z'),
  ('reminders.yl_pay_wait',          '1',   '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;
