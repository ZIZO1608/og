-- =============================================================================
--  044 — the Yalla Wear bot: moving jobs from the chat, and the design photo
-- -----------------------------------------------------------------------------
--  Yalla Wear work remotely, on a phone, with ink on their hands. The bot could
--  tell them about an order and take Accept or Decline; everything after that
--  meant opening a portal. This is the rest of the job queue, plus the one
--  thing they actually want to see before they accept: the design.
--
--  design_image_url, not the bytes. Same shape as products.image_url (040):
--  the picture lives in a public Supabase Storage bucket and the row holds the
--  address, so a phone on the shop wifi and Telegram's own servers can both
--  fetch it without a signed URL that expires on Tuesday.
--
--  print_jobs IS MIRRORED (cursor shape), so this opens a window where
--  PostgREST rejects the whole row until server/supabase/016_job_design_image
--  is pasted in the dashboard. lib/mirror-lag.js declares the column so the
--  sync drops it and names the file on every run rather than losing the day's
--  jobs, and `npm run supabase:reconcile` is what refills it afterwards.
-- =============================================================================

ALTER TABLE print_jobs ADD COLUMN design_image_url TEXT;

INSERT INTO config (key, value, updated_at) VALUES
  -- The way to shut the chat's write door again without a deploy. It IS a
  -- write on a channel with no session behind it, and a switch that exists
  -- before it is needed is worth more than one added after something went
  -- wrong in a group nobody in this system controls the membership of.
  ('reminders.chat_stage_moves', '1',  '1970-01-01T00:00:00.000Z'),

  -- Tonight, what is due tomorrow. Their digest is a morning list of work
  -- already late; a printer plans the next day the evening before, and that
  -- is a different message at a different hour.
  ('reminders.yl_due_tomorrow',  '1',  '1970-01-01T00:00:00.000Z'),
  ('reminders.yl_evening_hour',  '19', '1970-01-01T00:00:00.000Z'),

  -- Monday morning: what they printed last week and what it earned them.
  ('reminders.yl_week',          '1',  '1970-01-01T00:00:00.000Z'),
  ('reminders.yl_week_day',      '1',  '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

-- The partner preset gains the two new kinds. Guarded on the exact value 043
-- left, so a preset somebody has since edited by hand is untouched.
UPDATE config
   SET value = '["rem_yl_order_waiting","rem_yl_due","rem_yl_due_tomorrow","rem_yl_blocked","rem_yl_digest","rem_yl_week","rem_yl_pay_wait","order_new","order_accepted","order_declined","stage","names_ready","message","invoice_new","payment_recorded","payment_confirmed","review"]',
       updated_at = '1970-01-01T00:00:00.000Z'
 WHERE key = 'reminders.preset.partner'
   AND value = '["rem_yl_order_waiting","rem_yl_due","rem_yl_blocked","rem_yl_digest","rem_yl_pay_wait","order_new","order_accepted","order_declined","stage","names_ready","message","invoice_new","payment_recorded","payment_confirmed","review"]';
