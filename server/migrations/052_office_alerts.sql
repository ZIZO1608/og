-- =============================================================================
--  052 — the office's order alerts move from Web Push to Telegram
-- -----------------------------------------------------------------------------
--  The staff half of Web Push (048) is gone. It bound an alert to the origin a
--  browser subscribed on, and a browser will not register a service worker on a
--  self-signed certificate — so once the shop is LAN-only (Phase C) the office
--  bell could only ever work on the till itself, where it adds nothing. It was
--  already silent: the one staff subscription belonged to an account disabled
--  on 13 Sep, and both staff paths skip an inactive account. The same news now
--  goes through the shop's Telegram bot (lib/office-alerts.js), which is
--  outbound-only and works on a LAN-only server.
--
--  THE CUSTOMER'S PUSH IS UNTOUCHED. push_keys is not written, push_seen keeps
--  its shape (it still decides what counts as news, for both), and only the
--  rows with audience = 'staff' are deleted — never 'track'. The CHECK on
--  push_subscriptions.audience still admits 'staff'; rebuilding a table that
--  real customers' subscriptions live in to drop one word is risk for nothing.
--
--  partner_events.skip_users — who must NOT hear this row: the people whose own
--  action it reports, as a JSON array of user ids. NULL is nobody. A column and
--  not a key inside args_json, for the reason to_user (042) is one: routing is
--  not part of the message, and render() prints args.actor as a signature.
--  The table is deliberately unmirrored, so this needs no server/supabase file,
--  no mirror-lag.js entry, and supabase:drift stays green.
--
--  alerts.* — the shop's own hours for these alerts, on shop.tz_minutes. The
--  shop is open 13:00 to 23:00, so everything not listed in alerts.urgent is
--  held until 13:00 rather than buzzing a phone at three in the morning about
--  something nobody can act on until the door opens. Only a cancelled order is
--  urgent: it may be packed and about to leave. Kept apart from
--  reminders.quiet_*, which is 00-08 so the 21:00 close still goes out.
-- =============================================================================

ALTER TABLE partner_events ADD COLUMN skip_users TEXT;

DELETE FROM push_subscriptions WHERE audience = 'staff';

INSERT INTO config (key, value, updated_at) VALUES
  ('alerts.quiet_from', '23',               '1970-01-01T00:00:00.000Z'),
  ('alerts.quiet_to',   '13',               '1970-01-01T00:00:00.000Z'),
  ('alerts.urgent',     '["dl_cancelled"]', '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
--  WHAT EACH ROLE HEARS — the nine new kinds against the presets (042)
-- -----------------------------------------------------------------------------
--  THE MANAGER'S PRESET IS THE STRING 'null', WHICH MEANS EVERYTHING, and the
--  right thing to do with it is nothing: lib/telegram.js reads 'null' as "no
--  list", so the manager already hears every kind that exists and every kind
--  added later. Rewriting it as an explicit list of today's kinds is the exact
--  mistake the picker avoids by storing null — it would freeze the manager on
--  this September's list and silently exclude whatever 053 invents. So the
--  UPDATE below touches the manager's key ONLY on a shop where somebody has
--  replaced it with an explicit array; on this database it changes no row.
--
--  EVERY OTHER ROLE STARTS WITH NONE, which is what they already are: their
--  presets are explicit arrays and none of them names a dl_ kind. The second
--  UPDATE is the guard rather than the change — it strips a dl_ kind from any
--  role but the manager, and on this database it matches nothing. Both are
--  written so that a shop restored from another laptop lands on the same rule.
--
--  This is only the DEFAULT for a phone that follows its role. The hard gate is
--  in lib/telegram.js officeWants(): no chat hears an order alert unless the
--  account behind it can actually work the delivery office, whatever is ticked
--  here — and today only the manager role holds delivery.desk.
-- -----------------------------------------------------------------------------

-- Strip first, then append all nine: an array that already named ONE of them
-- (a half-configured shop, a hand edit) would otherwise keep that one and get
-- none of the other eight, and testing `instr(value, '"dl_') = 0` is what would
-- have hidden it. Written this way the statement is idempotent.
UPDATE config
   SET value = json_insert(
         (SELECT json_group_array(j.value) FROM json_each(config.value) AS j
           WHERE j.value NOT LIKE 'dl@_%' ESCAPE '@'),
         '$[#]', 'dl_new',       '$[#]', 'dl_paid',      '$[#]', 'dl_out',
         '$[#]', 'dl_back',      '$[#]', 'dl_delivered', '$[#]', 'dl_failed',
         '$[#]', 'dl_cancelled', '$[#]', 'dl_review',    '$[#]', 'dl_handin'),
       updated_at = '1970-01-01T00:00:00.000Z'
 WHERE key = 'reminders.preset.manager'
   AND json_valid(value) AND json_type(value) = 'array';

UPDATE config
   SET value = (SELECT json_group_array(j.value) FROM json_each(config.value) AS j
                 WHERE j.value NOT LIKE 'dl@_%' ESCAPE '@'),
       updated_at = '1970-01-01T00:00:00.000Z'
 WHERE key IN ('reminders.preset.cashier', 'reminders.preset.warehouse',
               'reminders.preset.delivery', 'reminders.preset.partner')
   AND json_valid(value) AND json_type(value) = 'array'
   AND instr(value, '"dl_') > 0;
