-- =============================================================================
--  Show the receipt before committing it to paper
-- -----------------------------------------------------------------------------
--  The receipt is the one artefact of a sale that leaves the shop and cannot be
--  edited afterwards -- a wrong customer or a wrong total on it is somebody
--  standing at the counter holding proof. So the default is now to render the
--  slip, show it, and print when a person approves it.
--
--  What is approved is the SAME canvas that gets packed into ESC/POS bytes, not
--  an HTML lookalike. An approval step that shows a different rendering than
--  the one that prints is worse than none, because it teaches people the check
--  is meaningful when it is not.
--
--  Off restores the old straight-to-printer behaviour, which is the right
--  choice at a busy counter: a dialog between every sale and its paper is
--  friction with no upside when the cashier is watching that screen anyway.
--
--  It only has meaning when receipt.auto_print is on. That setting decides
--  whether a finished sale reaches the printer at all; this one decides whether
--  it asks first.
--
--  WHY A SEPARATE FILE FROM 020. Because 020 had already run. Each migration is
--  recorded in schema_migrations once and never runs again, so a key added to
--  an applied file is a key that is never inserted on any database that already
--  has it -- silently, since nothing re-reads the file to check. A new key
--  means a new file, always.
-- =============================================================================

INSERT OR IGNORE INTO config (key, value, updated_at) VALUES
  ('receipt.confirm_print', '1', '1970-01-01T00:00:00.000Z');
