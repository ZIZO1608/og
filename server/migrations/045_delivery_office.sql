-- =============================================================================
--  045 — the delivery office
-- -----------------------------------------------------------------------------
--  The shop takes orders by phone, Instagram and WhatsApp and sends them five
--  ways: its own driver, a transport office, a courier company, abroad to
--  Jordan or Turkey, or the customer collects. Until now a delivery could only
--  begin as a till sale and knew one of those — a driver in Aleppo.
--
--  AN ORDER IS A SALE, A DELIVERY AND ITS PAYMENTS. The sale is written with
--  payment = 'order' in the same transaction that takes the stock, because the
--  shoes are in the bag the moment the slip prints. The money is NOT assumed:
--  it arrives in pieces — a deposit by Sham Cash, the rest at the door — and
--  each piece is a row in order_payments. What is still owed is derived from
--  those rows, never stored (see Money.openDebts for why a stored balance is a
--  second source of truth that the first part-payment makes wrong).
--
--  WHY NOT debt_payments. That table feeds every "who owes the shop" figure —
--  the dashboard, Reports, the customer badge and the credit limit — so a
--  parcel in a van would read as a customer in debt, and a customer marked
--  no-credit could not order at all. It also takes one currency only and has
--  nowhere for a transfer reference.
--
--  THE LISTS THE OWNER EDITS LIVE IN config: payment methods, courier
--  companies, the price list, the shop's transfer details. config is mirrored
--  whole, so none of them needs a Supabase schema file or a restore order. Ids
--  are never deleted — only switched off — so an old slip that says "Fuad"
--  keeps saying it.
-- =============================================================================

-- ------------------------------------------------------ how an order travels
--  All nullable or defaulted: the four delivery rows that already exist came
--  from the till and are driver runs, which is what a NULL method means.

--  driver  our own driver         office  a transport office to another city
--  courier a courier company      abroad  Jordan, Turkey
--  pickup  the customer collects from the shop
ALTER TABLE deliveries ADD COLUMN method TEXT
  CHECK (method IS NULL OR method IN ('driver','office','courier','abroad','pickup'));

--  The company is an id into config `delivery.companies`, and its NAME is
--  frozen here the way sales.customer_name is: renaming a company next year
--  must not rewrite who carried last March's parcels.
ALTER TABLE deliveries ADD COLUMN company_id   TEXT;
ALTER TABLE deliveries ADD COLUMN company_name TEXT;

--  ISO-2 (SY, JO, TR) from config `delivery.countries`; the city as it was
--  chosen or typed. `recipient` is set only when somebody other than the
--  customer receives it — a gift, a relative.
ALTER TABLE deliveries ADD COLUMN country   TEXT;
ALTER TABLE deliveries ADD COLUMN city      TEXT;
ALTER TABLE deliveries ADD COLUMN recipient TEXT;

--  The shipping fee, in the SALE's currency and minor units.
--    invoice  the shop charges it — it is part of what the customer owes
--    courier  the customer pays the courier directly; recorded, never owed
--    none     no fee
--  `fee_source` says whether it came from the price list or was typed, so a
--  fee somebody overrode can be told apart from one the list produced.
ALTER TABLE deliveries ADD COLUMN fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0);
ALTER TABLE deliveries ADD COLUMN fee_mode TEXT NOT NULL DEFAULT 'none'
  CHECK (fee_mode IN ('invoice','courier','none'));
ALTER TABLE deliveries ADD COLUMN fee_source TEXT;

--  How the customer said they would pay. A statement of intent — what was
--  actually paid is order_payments. `receipt` (on delivery / at pickup) is
--  refused by the server for the three company methods: other cities and
--  abroad are paid before the parcel leaves.
ALTER TABLE deliveries ADD COLUMN plan TEXT
  CHECK (plan IS NULL OR plan IN ('full','deposit','receipt'));

--  Where the order came from — phone, instagram, whatsapp, web. No CHECK: the
--  list will grow and a CHECK would make each new one a table rebuild.
ALTER TABLE deliveries ADD COLUMN channel     TEXT;
--  The courier's own waybill number, when there is one.
ALTER TABLE deliveries ADD COLUMN tracking_no TEXT;

CREATE INDEX IF NOT EXISTS deliveries_method ON deliveries (method, status);


-- ----------------------------------------------------------- order payments
CREATE TABLE IF NOT EXISTS order_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  --  A real FK, like debt_payments: a payment against a sale that does not
  --  exist is not a payment, and every restore path puts sales first.
  sale_id      TEXT    NOT NULL REFERENCES sales(id),
  --  Money back is its own row with a positive amount, never a negative one —
  --  a table that mixes sign conventions makes SUM() meaningless.
  kind         TEXT    NOT NULL DEFAULT 'in' CHECK (kind IN ('in','refund')),
  at           TEXT    NOT NULL,

  --  WHAT ARRIVED, in the currency it arrived in. A $ order may take a lira
  --  deposit: this is the lira.
  amount       INTEGER NOT NULL CHECK (amount > 0),
  currency     TEXT    NOT NULL REFERENCES currencies(code),
  --  USD -> this payment's currency at that moment — the meaning
  --  sales.fx_rate has — frozen for the same reason: what a lira deposit paid
  --  off in March must not change when the rate moves.
  fx_rate      REAL    NOT NULL,
  --  The same money in the ORDER's currency and minor units, rounded once
  --  here. What is still owed is the order's due minus the sum of these.
  amount_order INTEGER NOT NULL CHECK (amount_order > 0),

  --  An id into config `pay.methods`, and whether that method counted into
  --  the drawer AT THE TIME — frozen, so switching a method's flag later does
  --  not rewrite a closed shift.
  method       TEXT    NOT NULL,
  drawer       INTEGER NOT NULL DEFAULT 0 CHECK (drawer IN (0,1)),
  --  The transfer reference for Sham Cash, Fuad and the rest.
  txn_ref      TEXT,
  --  deposit | rest | full | door | pickup. No CHECK, for the reason channel
  --  has none.
  stage        TEXT,

  --  CASH IN SOMEBODY'S HAND. Money the driver collected at a door is not in
  --  any drawer until he hands it in: received_by is who holds it,
  --  handed_in_at is when it reached the shop, and shift_id is the drawer it
  --  went into. Cash taken at the office is handed in the moment it is taken.
  --  No FK on shift_id, following sales.shift_id (017).
  received_by  INTEGER REFERENCES users(id),
  shift_id     TEXT,
  handed_in_at TEXT,
  handed_in_by INTEGER REFERENCES users(id),

  note         TEXT,
  user_id      INTEGER REFERENCES users(id),
  created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_pay_sale  ON order_payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_order_pay_shift ON order_payments (shift_id);
CREATE INDEX IF NOT EXISTS idx_order_pay_at    ON order_payments (at);
--  "What is each driver still holding" is the question the end of the day
--  asks, and it is asked of very few rows.
CREATE INDEX IF NOT EXISTS idx_order_pay_pending ON order_payments (received_by)
  WHERE drawer = 1 AND handed_in_at IS NULL;


-- ------------------------------------------------------------ the owner's lists
--  pay.methods — every way money reaches the shop.
--    ref     a transfer reference is required
--    drawer  it is paper in the box under the counter
--    till / desk / debt   where it can be chosen
--    system  its id and flags cannot be changed (cash, cod, credit, order)
--  The four till methods keep their ids and labels exactly (js/data.js), so
--  every existing sale and slip still reads the same. `cod` is switched off
--  for NEW sales: it counted money into the drawer the moment the sale was
--  rung up, before any cash existed. `order` is never chosen — it is what the
--  delivery office writes. The Arabic spellings of the new transfer companies
--  are a first guess for the owner to correct in Settings.
INSERT INTO config (key, value, updated_at) VALUES
  ('pay.methods', '[
    {"id":"cash","en":"Cash","ar":"نقداً","ref":false,"drawer":true,"till":true,"desk":true,"debt":true,"active":true,"system":true},
    {"id":"sham","en":"Sham Cash","ar":"شام كاش","ref":true,"drawer":false,"till":true,"desk":true,"debt":true,"active":true},
    {"id":"fuad","en":"Fuad","ar":"فؤاد","ref":true,"drawer":false,"till":true,"desk":true,"debt":true,"active":true},
    {"id":"haram","en":"Haram","ar":"الهرم","ref":true,"drawer":false,"till":true,"desk":true,"debt":true,"active":true},
    {"id":"tarabut","en":"Tarabut","ar":"ترابط","ref":true,"drawer":false,"till":false,"desk":true,"debt":true,"active":true},
    {"id":"gold_master","en":"Gold Master","ar":"غولد ماستر","ref":true,"drawer":false,"till":false,"desk":true,"debt":true,"active":true},
    {"id":"andalus","en":"Andalus","ar":"الأندلس","ref":true,"drawer":false,"till":false,"desk":true,"debt":true,"active":true},
    {"id":"yaqut","en":"Yaqut","ar":"ياقوت","ref":true,"drawer":false,"till":false,"desk":true,"debt":true,"active":true},
    {"id":"tima","en":"Tima","ar":"تيما","ref":true,"drawer":false,"till":false,"desk":true,"debt":true,"active":true},
    {"id":"zamzam","en":"Zam Zam","ar":"زمزم","ref":true,"drawer":false,"till":false,"desk":true,"debt":true,"active":true},
    {"id":"card","en":"Card","ar":"بطاقة","ref":true,"drawer":false,"till":true,"desk":false,"debt":true,"active":true},
    {"id":"cod","en":"Cash on delivery","ar":"الدفع عند الاستلام","ref":false,"drawer":true,"till":false,"desk":false,"debt":false,"active":false,"system":true},
    {"id":"credit","en":"On credit","ar":"على الحساب","ref":false,"drawer":false,"till":true,"desk":false,"debt":false,"active":true,"system":true},
    {"id":"order","en":"Delivery order","ar":"طلب توصيل","ref":false,"drawer":false,"till":false,"desk":false,"debt":false,"active":true,"system":true}
  ]', '1970-01-01T00:00:00.000Z'),

  --  { "<method id>": { "en": "...", "ar": "..." } } — the shop's own account
  --  for each transfer method, quoted in the payment message to a customer.
  --  Stripped from GET /api/config for anyone without config.write.
  ('pay.accounts', '{}', '1970-01-01T00:00:00.000Z'),

  --  [{ id, en, ar, kind: office|courier|abroad, phone, active }]
  ('delivery.companies', '[]', '1970-01-01T00:00:00.000Z'),

  --  The countries an order can go to, and the currency each one is priced
  --  in by default. Jordan and Turkey default to dollars because the shop
  --  holds no dinar or Turkish lira; the office can still choose per order.
  ('delivery.countries', '[
    {"id":"SY","en":"Syria","ar":"سوريا","currency":"SYP","dial":"963","active":true},
    {"id":"JO","en":"Jordan","ar":"الأردن","currency":"USD","dial":"962","active":true},
    {"id":"TR","en":"Turkey","ar":"تركيا","currency":"USD","dial":"90","active":true}
  ]', '1970-01-01T00:00:00.000Z'),

  --  [{ id, country, city_en, city_ar, method, fee, currency, fee_mode, active }]
  ('delivery.prices', '[]', '1970-01-01T00:00:00.000Z'),

  --  Where remote orders are picked from. The office is a room, not the
  --  counter, so Back storage; the desk lets them choose per order.
  ('delivery.wh', 'store', '1970-01-01T00:00:00.000Z'),

  --  What Save & print prints by default on a machine that has not chosen.
  ('delivery.print', 'slip', '1970-01-01T00:00:00.000Z')
ON CONFLICT (key) DO NOTHING;


-- ------------------------------------------------------------- the permission
--  Manager only. The partner can never be given it: FORBIDDEN in
--  server/lib/auth.js refuses anything starting with 'delivery.'.
INSERT INTO role_permissions (role, perm, allowed, updated_at) VALUES
  ('manager',   'delivery.desk', 1, '1970-01-01T00:00:00.000Z'),
  ('cashier',   'delivery.desk', 0, '1970-01-01T00:00:00.000Z'),
  ('warehouse', 'delivery.desk', 0, '1970-01-01T00:00:00.000Z'),
  ('delivery',  'delivery.desk', 0, '1970-01-01T00:00:00.000Z'),
  ('partner',   'delivery.desk', 0, '1970-01-01T00:00:00.000Z');
