-- =============================================================================
--  The 80mm thermal receipt
-- -----------------------------------------------------------------------------
--  Everything a manager can tune from Settings without a code change: which
--  printer to talk to, what the paper says top and bottom, and which of the
--  optional blocks (QR, barcode, loyalty line) are switched on.
--
--  Shop name and address already live under shop.* (008_shop_identity.sql) and
--  are reused rather than duplicated here — the second branch changes
--  shop.branch_name and shop.phone, not code. Everything else that is specific
--  to the printed slip, and nothing else in this system needs, lives under
--  receipt.*.
--
--  `print_log` is the audit trail the manager reads when a customer disputes a
--  refund: who printed invoice #1042, how many copies, and whether it actually
--  reached the printer. A reprinted receipt is how that kind of fraud starts,
--  so every attempt is recorded here — success or failure — never only the
--  successful ones.
-- =============================================================================

-- `pointsEarned` was computed by Sales.record and handed back once in the
-- response, never written down -- fine until a receipt has to be reprinted
-- weeks later and there is nowhere left to read it from. Frozen the same way
-- fx_rate is: written once, at the sale, never recomputed from today's
-- loyalty.points_per_1000, which may have changed since.
ALTER TABLE sales ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0;

INSERT INTO config (key, value, updated_at) VALUES
  ('shop.branch_name',   'Main Branch',                       '1970-01-01T00:00:00.000Z'),
  ('shop.phone',         '',                                  '1970-01-01T00:00:00.000Z'),
  ('receipt.printer_host', '',                                '1970-01-01T00:00:00.000Z'),
  ('receipt.printer_port', '9100',                             '1970-01-01T00:00:00.000Z'),
  ('receipt.width_dots',   '576',                              '1970-01-01T00:00:00.000Z'),
  ('receipt.footer_ar',    'شكراً لتسوقكم معنا',                '1970-01-01T00:00:00.000Z'),
  ('receipt.footer_en',    'Thank you for shopping with us',   '1970-01-01T00:00:00.000Z'),
  ('receipt.policy_ar',    'يمكن استبدال القطعة خلال 7 أيام من تاريخ الفاتورة بشرط إبراز هذه الفاتورة وعدم استخدام المنتج.', '1970-01-01T00:00:00.000Z'),
  ('receipt.policy_en',    'Exchange within 7 days of purchase with this receipt. Item must be unworn.', '1970-01-01T00:00:00.000Z'),
  ('receipt.show_qr',      '1',                                '1970-01-01T00:00:00.000Z'),
  ('receipt.show_barcode', '1',                                '1970-01-01T00:00:00.000Z'),
  ('receipt.show_loyalty', '1',                                '1970-01-01T00:00:00.000Z'),
  ('receipt.auto_print',   '1',                                '1970-01-01T00:00:00.000Z'),
  ('receipt.copies',       '2',                                '1970-01-01T00:00:00.000Z'),
  ('receipt.cut_mode',     'partial',                          '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------- print log
CREATE TABLE print_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    TEXT NOT NULL REFERENCES sales(id),
  user_id    INTEGER REFERENCES users(id),
  copies     INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error      TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX print_log_sale ON print_log (sale_id, at DESC);

-- --------------------------------------------------------- sale.reprint perm
--  Printing the receipt for the sale you are actively completing only ever
--  needed `sell`. Reprinting one later — the fraud-relevant case — is gated
--  separately so a manager can allow selling without allowing reprints, the
--  same shape as `discount.unlimited` sitting apart from `sell`. Both the new
--  route and the existing GET /api/sales/:id/receipt require it.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('manager',   'sale.reprint', 1, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'sale.reprint', 1, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'sale.reprint', 0, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'sale.reprint', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'sale.reprint', 0, '1970-01-01T00:00:00.000Z')
ON CONFLICT (role, perm) DO NOTHING;
