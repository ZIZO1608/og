-- =============================================================================
--  A USB transport for the receipt printer, alongside the existing TCP one
-- -----------------------------------------------------------------------------
--  The receipt printer (an Xprinter XP-T80A) turned out to be USB, not
--  network-attached like server/lib/printer.js's original send() assumed —
--  so Receipt.autoPrint() (js/pos.js) was silently failing after every sale,
--  and the cashier fell back to the browser's window.print() path, which
--  goes through Windows' own driver for the printer. That driver was
--  reinterpreting the receipt as a page of text and pagination-splitting a
--  single continuous receipt into several — the "many pages, many sections"
--  the owner reported, not a sizing problem (576px/72mm-printable was
--  already correct for this 80mm printer).
--
--  Fixed the same way the USB label printer already was: a Generic / Text
--  Only Windows printer queue, shared, and reached with a raw `copy /b` —
--  see server/lib/printer.js's sendUsb() and its header comment. Since the
--  receipt printer sits on the same machine as the server (confirmed with
--  the owner), the server does the copy itself; no separate polling agent
--  like the label printer needed, since that one could be on a different
--  device on the shop's network.
--
--  receipt.transport defaults to 'tcp' so an existing network-connected
--  receipt printer, if anyone ever has one, keeps working with zero config
--  change. Both keys already fall under CONFIG_WRITABLE's existing
--  ^receipt\. prefix in server/index.js — no route change needed.
-- =============================================================================

INSERT INTO config (key, value, updated_at) VALUES
  ('receipt.transport',     'tcp',                    '1970-01-01T00:00:00.000Z'),
  ('receipt.printer_share', '\\localhost\OGRECEIPT',  '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;
