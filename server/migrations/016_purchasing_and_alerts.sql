-- =============================================================================
--  Purchase orders, and the notification bell's read state.
-- -----------------------------------------------------------------------------
--  The warehouse's Purchase Orders tab was the last screen writing to nothing:
--  purchaseOrders was an array in the browser, so an order raised on Sunday
--  was gone on Monday, and the supplier balance it was supposed to move never
--  moved.
--
--  A PO line points at a variant by sku rather than by product+size, because
--  sku is what the shop reads off the box when the delivery arrives. The cost
--  is frozen onto the line at order time: with the lira moving, what a pair
--  cost when it was ordered is not what it costs when it lands, and the
--  invoice has to agree with the order rather than with today.
--
--  received_qty is separate from qty because a supplier sending eight of the
--  ten you ordered is normal, and calling that "received" loses the two.
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            TEXT PRIMARY KEY,             -- 'PO-0042'
  supplier_id   INTEGER REFERENCES suppliers(id),
  --  Frozen at order time. A supplier renamed next year must not rewrite what
  --  last year's paperwork said.
  supplier_name TEXT,
  status        TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','received','cancelled')),
  currency      TEXT    NOT NULL DEFAULT 'SYP' REFERENCES currencies(code),
  wh_id         TEXT    REFERENCES warehouses(id),
  note          TEXT,
  created_at    TEXT    NOT NULL,
  sent_at       TEXT,
  received_at   TEXT,
  updated_at    TEXT    NOT NULL,
  created_by    INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id        TEXT    NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku          TEXT    NOT NULL REFERENCES variants(sku),
  qty          INTEGER NOT NULL CHECK (qty > 0),
  unit_cost    INTEGER NOT NULL DEFAULT 0,
  received_qty INTEGER NOT NULL DEFAULT 0 CHECK (received_qty >= 0)
);

-- ---------------------------------------------------- the bell's read state
--  Keyed on what the alert is ABOUT, never on the words it uses.
--
--  The first version keyed on the text and kept it in localStorage. Both were
--  wrong. The text changes on its own — "due in 3 days" becomes "due in 2
--  days" tomorrow — so an alert somebody had read quietly came back unread
--  every morning. And localStorage is per machine, so reading it on the till
--  left it bold on the office computer.
--
--  A key is stable for as long as the thing it names is: 'stock:OG-001-42',
--  'job:P-1043', 'supplier:1', 'critical', 'payroll'.
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT    NOT NULL,
  read_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_po_lines_po    ON purchase_order_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_sku   ON purchase_order_lines(sku);
CREATE INDEX IF NOT EXISTS idx_po_status      ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_notif_reads_by ON notification_reads(user_id);
