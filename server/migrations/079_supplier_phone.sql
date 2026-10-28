-- =============================================================================
--  079 — a supplier's phone and notes (night shift 28 Oct 2026)
-- -----------------------------------------------------------------------------
--  The supplier form had one free-text "Contact" box. The owner calls and
--  WhatsApps suppliers, so the phone is its own field (the WhatsApp button
--  reads it), and anything else about them is a note. `contact` stays for what
--  is already written there.
--
--  suppliers is mirrored (cursor shape, inside the partner block): the two
--  columns are in server/lib/mirror-lag.js until server/supabase/046 is run.
-- =============================================================================

ALTER TABLE suppliers ADD COLUMN phone TEXT;
ALTER TABLE suppliers ADD COLUMN notes TEXT;
