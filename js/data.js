/* ==========================================================================
   OG SYSTEM — THE MODEL
   --------------------------------------------------------------------------
   Every collection the screens read, and the lookups over them. All of it
   starts EMPTY and is filled by DB.hydrate() from the server.

   This file used to generate a shop: 24 products, 40 customers, 120 invoices
   across six months, a print queue, a movement log — all from one seeded
   generator, so every launch told an identical story. That was how the system
   got shown to people before it had a server.

   It is gone. A number on this screen is a number in the shop's database or
   it is not there at all. The failure it prevents is specific and was real:
   generated data looks exactly like the truth, and a till that falls back to
   it takes money into memory nobody keeps.

   What remains is the shape:
     1. CONFIG      — exchange rate, loyalty rules, thresholds (server overrides)
     2. CATALOGUE   — the empty collections, size sets, warehouses
     3. PEOPLE      — customers, employees, suppliers
     4. SALES       — invoices
     5. PRINT JOBS  — the Yalla Wear queue, its stages and kit lines
     6. MOVEMENTS   — the stock movement log
     7. MISC        — the derived notification bell
     8. PARTNER     — invoices between the two companies, and the message line
     9. HELPERS     — the lookups every screen uses, and hydrate()
   ========================================================================== */

/* ---------------------------------------------------------------- 1. CONFIG */

/* MONEY IN THIS FILE IS THE NEW SYRIAN POUND.
   The redenomination took two zeros off: 1 new pound = 100 old lira. Every
   amount below, and every price the shop had, was divided by 100 when the
   shop moved over. A pair of Air Force 1s is 12,500 — if you ever find a
   four-digit shoe reading 1,250,000, something has been pasted in from the
   old currency and the whole report it lands in is wrong by 100x. */
var CONFIG = {
  EXCHANGE_RATE: 130,        // 1 USD = 130 new pounds   <-- edit this live
  BASE_CURRENCY: 'SYP',

  /* Loyalty is deliberately expressed so the redenomination did NOT change
     what a customer earns or what a point is worth. Before: 1 point per 1,000
     old lira, each point worth 50 old lira. Now: 100 points per 1,000 new
     pounds, each worth 0.5 — the same 5% back on the same real spend, and the
     tiers below did not have to move. Change one of these two and you have
     quietly repriced the loyalty scheme. */
  LOYALTY_POINTS_PER_1000: 100,  // 100 points per 1,000 new pounds spent
  LOYALTY_POINT_VALUE: 0.5,      // 1 point redeems for 0.5 (500 pts = 250)

  /* Tier cut-offs, in POINTS, not money — which is why they survived the
     redenomination untouched. Lifetime spend runs 20k–200k new pounds, and at
     the rate above that is 2,000–20,000 points, so the thresholds still sit
     in the right band. */
  TIER_SILVER: 6000,
  TIER_GOLD: 12000,

  STOCK_CRITICAL: 3,           // <= this many pieces = Critical
  STOCK_LOW: 10,               // <= this many pieces = Low

  /* The most a cashier may take off without a manager. Lives here rather than
     in pos.js so that DB.hydrate can overwrite it from the server's
     `sale.max_discount_pct` — two copies of a limit is one copy that is wrong,
     and the one the cashier sees would be the wrong one. The server enforces
     it regardless; this only decides whether she is warned before the customer
     is standing there. */
  MAX_DISCOUNT_PCT: 10,

  /* Valid EAN-13: 622103301284 checksums to 4. The old ...845 looked fine but
     would not scan. */
  DEMO_BARCODE: '6221033012844',
  COUPON: { code: 'OG20', percent: 20 },

  /* QR payloads. 'text' prints human-readable info that resolves with no
     internet; 'url' switches to a deep link. Edit live in Settings. */
  QR_MODE: 'text',
  QR_BASE_URL: 'https://ogsystem.sy/s/',

  /* The live address of the deployed app. When set, every QR that carries a
     deep link points HERE rather than at whatever path the app happens to be
     open from — so a receipt printed on the shop laptop still resolves when
     scanned by a customer's phone on mobile data. Empty falls back to the
     current location, which is right for a laptop-only demo. */
  PUBLIC_URL: 'https://zizo1608.github.io/og/',

  /* What OG pays Yalla Wear to print one football kit — name, number, badges.
     Bulk jobs (school shirts, cafe staff) are priced per job instead, because
     those include the garment. Change this one number and every kit line,
     every job payout and every partner invoice re-prices instantly. */
  KIT_PRINT_PRICE: 180,

  /* How long Yalla Wear gives OG to settle an invoice. Drives the ageing
     buckets on the partner finance page. */
  INVOICE_TERMS_DAYS: 30,

  /* What gets printed on a receipt a customer walks out with, so it has to be
     the name on the door — "Og Sports" on the Google listing — not the name of
     the software. SHOP_SYSTEM stays for the app's own chrome. */
  SHOP_NAME: 'OG Sports',
  SHOP_SYSTEM: 'OG System',
  SHOP_TAGLINE: 'Sneakers & Streetwear',

  /* PLACEHOLDER — the shop is in Aleppo (36.2119287, 37.1550757), but the
     street line below has not been confirmed by the owner yet. Do not print
     receipts for customers until this is the real address. */
  /* Address and phone are SEPARATE fields. They used to be one string with an
     em dash in the middle, and the WhatsApp code pulled the number back out
     with a regex on that dash — which breaks the first time somebody types an
     address containing one. The receipt needs them on their own lines anyway. */
  SHOP_ADDRESS: 'Aleppo, Syria',
  /* Prefilled when adding a customer at the till. Most people who walk in are
     from the city the shop is in, and a field that is right nine times out of
     ten is one less thing to type with someone waiting. */
  SHOP_CITY: 'Aleppo',
  SHOP_ADDRESS_AR: 'حلب، سوريا',
  SHOP_PHONE: '0956 442 118',
  SHOP_MAP: 'https://maps.app.goo.gl/vjYnWGFQFWXBm7r7A',
  PRINT_PARTNER: 'Yalla Wear',

  /* Which branch printed this — blank until a manager names the till in
     Settings. A single-branch shop leaves it blank and the receipt header
     just shows the shop name, no code change either way. */
  SHOP_BRANCH: '',

  /* The 80mm thermal receipt. Demo-mode defaults only — a real server
     overwrites every one of these from config.receipt.* in DB.hydrate, and
     the printer host is deliberately blank here: there is no LAN to reach
     from a laptop in a meeting. */
  RECEIPT_PRINTER_HOST: '',
  RECEIPT_PRINTER_PORT: 9100,
  RECEIPT_WIDTH_DOTS: 576,
  /* 'tcp' (network, the original default) or 'usb' (a printer on the same
     machine as the server, reached via a shared Generic/Text-Only printer
     queue — see server/lib/printer.js's sendUsb()). */
  RECEIPT_TRANSPORT: 'tcp',
  RECEIPT_PRINTER_SHARE: '\\\\localhost\\OGRECEIPT',
  /* Show the rendered receipt and print it when somebody approves, rather
     than firing the printer the moment a sale closes. */
  RECEIPT_CONFIRM_PRINT: true,
  RECEIPT_INSTAGRAM: 'https://www.instagram.com/og_sports_1',
  RECEIPT_TELEGRAM: 'https://t.me/ogsports1',
  RECEIPT_MAPS_URL: 'https://maps.app.goo.gl/i5VcMRV8sg4c7E639',
  RECEIPT_FOOTER_AR: 'شكراً لتسوقكم معنا',
  RECEIPT_FOOTER_EN: 'Thank you for shopping with us',
  RECEIPT_POLICY_AR: 'يمكن استبدال القطعة خلال 48 ساعة من تاريخ الفاتورة بشرط إبراز هذه الفاتورة وعدم استخدام المنتج.',
  RECEIPT_POLICY_EN: 'Exchange within 48 hours of purchase with this receipt. Item must be unworn.',
  RECEIPT_SHOW_BARCODE: true,
  RECEIPT_SHOW_LOYALTY: true,
  RECEIPT_AUTO_PRINT: true,
  RECEIPT_COPIES: 2,
  RECEIPT_CUT_MODE: 'partial',
  /* 'normal' | 'dark' | 'darker' — how black a pixel must be before the
     thermal head burns a dot for it. See 025_receipt_ink.sql: 'dark' is the
     default because 'normal' (the neutral 128) was printing every small line
     on the receipt as a grey ghost. */
  RECEIPT_INK: 'dark',

  /* Thermal product labels (Xprinter XP-235B, TSPL) — a separate printer
     from the receipt, a separate config namespace. Demo-mode defaults only;
     a real server overwrites these from config.label.* in DB.hydrate. */
  LABEL_DEFAULT_PRESET: '30x30',
  LABEL_STATIONS: 'warehouse-laptop,till-1',
  LABEL_TRANSPORT: 'agent',
  LABEL_PRINTER_HOST: '',
  LABEL_PRINTER_PORT: 9100,
  LABEL_DENSITY: 8,
  LABEL_GAP_MM: 2,
  LABEL_MAX_BATCH: 500,
  LABEL_PRESETS: [
    { key: '30x30', widthMm: 30, heightMm: 30, gapMm: 2, logo: 'small-top', nameLines: 2, barcodeHeightMm: 12, allowEan: false },
    { key: '30x20', widthMm: 30, heightMm: 20, gapMm: 2, logo: 'omit', nameLines: 1, barcodeHeightMm: 9, allowEan: false },
    { key: '40x30', widthMm: 40, heightMm: 30, gapMm: 2, logo: 'small-top-left', nameLines: 2, barcodeHeightMm: 13, allowEan: true },
    { key: '50x30', widthMm: 50, heightMm: 30, gapMm: 2, logo: 'left-of-text', nameLines: 2, barcodeHeightMm: 13, allowEan: true },
    { key: '60x40', widthMm: 60, heightMm: 40, gapMm: 2, logo: 'small-top-left', nameLines: 2, barcodeHeightMm: 14, allowEan: true }
  ]
};

/* Deterministic pseudo-random so the demo looks identical every time it opens. */
var _seed = 987654321;
function rnd() { _seed = (_seed * 1664525 + 1013904223) % 4294967296; return _seed / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function chance(p) { return rnd() < p; }
function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

var TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
function daysAgo(n) { var d = new Date(TODAY); d.setDate(d.getDate() - n); return d; }
function daysAhead(n) { return daysAgo(-n); }

/* A date for message text. app.js has a richer fmtDate, but message bodies are
   built inside DB and this file must not depend on the UI layer loading first. */
var _MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDateSeed(d) {
  var x = new Date(d);
  return x.getDate() + ' ' + _MON[x.getMonth()];
}

/* ------------------------------------------------------------ 2. CATALOGUE */

var SIZE_SETS = {
  sneakers: ['39', '40', '41', '42', '43', '44', '45'],
  crocs:    ['39', '40', '41', '42', '43', '44', '45'],
  boots:    ['40', '41', '42', '43', '44', '45'],
  tshirts:  ['S', 'M', 'L', 'XL', 'XXL'],
  jerseys:  ['S', 'M', 'L', 'XL', 'XXL'],
  shirts:   ['S', 'M', 'L', 'XL', 'XXL'],
  jackets:  ['S', 'M', 'L', 'XL', 'XXL'],
  jeans:    ['28', '30', '32', '34', '36', '38']
};

var TYPE_LABELS = {
  sneakers: 'Sneakers', boots: 'Boots', tshirts: 'T-Shirts', jeans: 'Jeans',
  jerseys: 'Jerseys', crocs: 'Crocs', shirts: 'Shirts', jackets: 'Jackets'
};

/* name, type, brand, madeIn, colour block, colourway, cost, price, shelf zone, hidden */

/* Filled by DB.hydrate from the server. Empty until then, and empty is
   honest: an empty shop is a shop whose catalogue has not loaded, and the
   screens say so. Invented stock on a real till is how somebody sells a
   product that does not exist. */
var products = [];

/* Products that carry a "size gap": healthy total stock, zero in the sizes
   customers actually ask for. This is one of the headline insights in the pitch. */
var SIZE_GAP = {
  1:  ['42', '43'],      // Air Force 1 — the two sizes everyone wants
  11: ['M', 'L'],        // OG Heavyweight Tee
  16: ['32', '34']       // Levi's 501
};

/* ---- where stock physically is -------------------------------------------
   Until now the shop had one implied warehouse: `qty` was a single number and
   `shelf` only said where inside that one place. So a size with nothing on the
   wall and eight pairs in the back read as "Healthy", and the customer standing
   in the shop was told it was in stock while nobody could find it.

   `qty` stays, and stays the grand total, because ~170 read sites across the
   app depend on it. `v.wh` holds the split, and DB.moveStock is the only thing
   allowed to change either — it keeps the invariant qty === floor + store. */
var WAREHOUSES = [
  { id: 'floor', name: 'Shop floor',   nameAr: 'المحل',     kind: 'shop'    },
  { id: 'store', name: 'Back storage', nameAr: 'المستودع',  kind: 'storage' }
];
var DEFAULT_WH = 'floor';   /* what the till sells from unless told otherwise */
var INTAKE_WH  = 'store';   /* deliveries arrive at the back door, not the wall */

var variants = [];

/* The dead-stock alert on the dashboard points at a real row. */
(function pinDeadStock() {
  variants.filter(function (v) { return v.productId === 24; }).forEach(function (v, i) {
    v.shelf = 'B-07';
    v.qty = [2, 4, 5, 4, 3][i] || 3;   // 18 pieces total, none moving
  });
})();

/* Split every size between the shop floor and the back storage.
   ---------------------------------------------------------------------------
   This uses a generator of its OWN, deliberately not the shared rnd(). The
   seed sequence is global and positional: drawing from it here would shift
   every value created afterwards — customer phone numbers, sale totals, which
   variants the movement log picked — and the test suite asserts against those.
   A private seed keeps the split reproducible while leaving everything already
   seeded byte-for-byte identical.

   Runs after the two pins above, so it splits the final quantities. */
var _whSeed = 20250819;
function whRnd() {
  _whSeed = (_whSeed * 1664525 + 1013904223) % 4294967296;
  return _whSeed / 4294967296;
}

(function splitAcrossWarehouses() {
  variants.forEach(function (v) {
    var floor;
    if (v.qty === 0) {
      floor = 0;                       // out everywhere, including the gap sizes
    } else if (v.qty >= 4 && whRnd() < 0.20) {
      /* THE INSIGHT: nothing on the wall, plenty in the back. This is the
         case the paper ledger cannot see, and the reason transfers exist. */
      floor = 0;
    } else {
      /* A wall holds a display, not the whole stock. Roughly a third. */
      floor = Math.round(v.qty * (0.28 + whRnd() * 0.22));
      if (floor > v.qty) floor = v.qty;
      if (floor < 1) floor = 1;
    }
    v.wh = { floor: floor, store: v.qty - floor };
  });

  /* The pair the presenter scans on stage has to be sellable from the floor,
     or the very first thing demonstrated is a refusal. */
  var demo = variants.filter(function (x) { return x.barcode === CONFIG.DEMO_BARCODE; })[0];
  if (demo && demo.wh.floor < 4) {
    var need = 4 - demo.wh.floor;
    if (need > demo.wh.store) need = demo.wh.store;
    demo.wh.floor += need;
    demo.wh.store -= need;
  }
})();

/* --------------------------------------------------------------- 3. PEOPLE */

var CITIES = ['Damascus', 'Aleppo', 'Homs', 'Latakia', 'Hama', 'Tartus', 'Deir ez-Zor'];

var customers = [];

var suppliers = [];

var employees = [];

/* `credit` is الدين — sold now, paid later. It is a payment METHOD because
   that is how it is recorded at the till, but it is the only one that creates
   a receivable instead of money. */
var PAYMENT_METHODS = ['cash', 'sham', 'fuad', 'haram', 'card', 'cod', 'credit'];
var PAYMENT_LABELS = {
  cash: 'Cash', sham: 'Sham Cash', fuad: 'Fuad', haram: 'Haram', card: 'Card',
  cod: 'Cash on delivery', credit: 'On credit'
};

/* These print on the customer's receipt, so they cannot stay English-only:
   an Arabic receipt reading "طريقة الدفع … Cash" is the one word on the page
   that says nobody finished the job. The transfer services keep their own
   names — Sham Cash and Al-Haram are brands, and that is what the sign in
   their window says. */
var PAYMENT_LABELS_AR = {
  cash: 'نقداً', sham: 'شام كاش', fuad: 'فؤاد', haram: 'الهرم', card: 'بطاقة',
  cod: 'الدفع عند الاستلام', credit: 'على الحساب'
};

/* WHICH METHODS PUT PAPER IN THE DRAWER.
   This single list is the reason a shift close is worth anything. Sham Cash,
   Fuad and card all settle into an account, not the box under the counter —
   counting them would make the drawer look right while it was short. */
var DRAWER_METHODS = ['cash', 'cod'];

/* ---------------------------------------------------------------- 4. SALES */

var sales = [];

/* Roll the sales up into customer stats, employee stats and per-product recency. */

/* ----------------------------------------------------------- 5. PRINT JOBS */

var PRINT_STAGES = ['design', 'sent', 'printing', 'delivery', 'done'];
var PRINT_STAGE_LABELS = {
  design: 'Design', sent: 'Sent to print', printing: 'Printing', delivery: 'Delivery', done: 'Done'
};

/* ---- football kits ---------------------------------------------------------
   Yalla Wear's real trade. A kit job is billed per shirt, not per job: club,
   the name printed on the back, the squad number, the size.

   A line with no `print` is a kit the customer ordered before deciding on a
   name. It shows as TO BE CONFIRMED and it is the reason the whole
   confirmation loop exists — Yalla cannot print it, and only OG can resolve
   it, because only OG is talking to the customer. There is deliberately NO
   separate `tbc` flag: an empty name IS the state, so the two can never
   drift apart. */

/* The jersey catalogue, filled from the server by DB.hydrate. */
var CLUBS = {};

var _lineSeq = 0;
function kl(clubKey, print, number, size, qty) {
  var c = CLUBS[clubKey];
  return {
    id: 'L' + pad(++_lineSeq, 3),
    club: c[0], clubAr: c[1],
    print: print || null,                  // null === TO BE CONFIRMED
    number: number || null,
    size: size, qty: qty || 1,
    price: CONFIG.KIT_PRINT_PRICE
  };
}

/* P-1043 is one whole team — eighteen Syria shirts, numbers 1 to 18. Five
   squad places were still open when the order was taken, so five lines have
   no name. That is why this job sits at "Sent to print" while overdue: it
   physically cannot advance. It is the best single story in the demo. */


/* `qty`, `sizes` and `cost` are DERIVED for kit jobs in buildJobDetail below,
   so a line can never disagree with its job's totals. Only `price` — what OG
   charges the customer — is authored here, because that is OG's margin call. */
var printJobs = [];

/* Split an order across tee sizes on a realistic curve. Shared by the seed
   data and by DB.newPrintJob, so a job created live at the till carries the
   same detail as one that shipped with the demo. */
var TEE_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
var TEE_CURVE = [0.14, 0.26, 0.30, 0.20, 0.10];

function splitSizes(qty) {
  var out = {}, left = qty, i, n;
  for (i = 0; i < TEE_SIZES.length; i++) {
    n = (i === TEE_SIZES.length - 1) ? left : Math.round(qty * TEE_CURVE[i]);
    n = Math.max(0, Math.min(n, left));
    if (n) out[TEE_SIZES[i]] = n;
    left -= n;
  }
  if (left > 0) out.L = (out.L || 0) + left;
  return out;
}

/* Each job carries a size breakdown and a stamped stage history, so the
   delivery tracker can show *when* every step happened rather than just
   where the job sits now. Kit jobs additionally derive qty, cost and the
   size breakdown FROM their lines — never the other way round, so a line
   and its job total can never disagree. */

/* Two of the three jobs still in Design are pushed off draft, so BOTH sides
   have something to do the moment the demo opens: OG can send one, Yalla can
   accept another, and the third refuses to send because two of its shirts
   still have no name on them. */

/* ------------------------------------------------------------ 6. MOVEMENTS */

var MOVEMENT_TYPES = {
  received: { label: '+ Received',  sign: 1  },
  sold:     { label: '- Sold',      sign: -1 },
  damaged:  { label: '- Damaged',   sign: -1 },
  returned: { label: '+ Return',    sign: 1  },
  transfer: { label: '- Transfer',  sign: -1 }
};

var stockMovements = [];

/* Highest movement number issued so far. A counter rather than
   `stockMovements.length` because hydration replaces the whole log with the
   server's, whose ids start wherever that database happens to be — carrying on
   from the length would hand out numbers that already exist. */
var mvSeq = 0;


/* ----------------------------------------------------------------- 7. MISC */

/* Every WhatsApp message the shop has sent, newest first. wa.me hands off to
   the WhatsApp app and tells us nothing back, so this is a record of what was
   composed and opened — not a delivery receipt, and the UI never calls it one. */
var waMessages = [];

/* ---- purchase orders ------------------------------------------------------
   The Reorder button used to raise a toast and create nothing. A reorder is
   now a real document: a supplier, dated lines per size, and a status that
   moves draft → sent → received. Receiving raises stock through the same
   movement log everything else uses, so an arrival is auditable rather than
   a number that changed on its own. */
var PO_STATUS = ['draft', 'sent', 'received'];
var purchaseOrders = [];

/* Finished stock counts, newest first. A count is a record in its own right,
   kept after posting so the adjustments it made can be explained later. */
var stockCounts = [];

/* ---- money ----------------------------------------------------------------
   Three things the shop keeps on paper today, and the reason the Reports
   "profit" number is currently a fiction:

     shifts   — open with a float, sell all day, count the box at midnight
     expenses — rent, fuel, transport. Gross revenue minus these is the number
                he actually lives on, and until now the system had no idea
                they existed
     debts    — الدين. Sold, not yet paid for.                               */

var EXPENSE_CATEGORIES = ['rent', 'generator', 'salaries', 'transport', 'packaging', 'supplier', 'other'];

var shifts = [];
var expenses = [];
/* Payments against credit sales. The debt itself is derived from the sale, so
   there is no separate "debt" record to fall out of step with it. */
var debtPayments = [];


/* Computed by the server, per account, and replaced on every hydrate.
   Nothing is hardcoded: an alert naming a product is naming one that is
   really out of stock. */
var notifications = [];

/* ----------------------------------------------------- 8. PARTNER FINANCE */

/* Yalla Wear bills OG. Money flows one way here, which is why the language is
   "outstanding" rather than "debt" — this is the partner's receivable.

   An invoice references KIT LINES, not whole jobs:
       refs: [ { jobId: 'P-1030', lineId: 'L001' }, ... ]
   because one bill covers shirts drawn from several different customer
   orders — exactly what the paper invoice shows. A bulk job cannot be split,
   so it is referenced as a whole with `lineId: null`.

   `status` is DERIVED from the payments (see DB.invoiceStatus). Nothing sets
   it by hand, so a part-paid invoice can never be sitting there labelled
   "paid" because two screens disagreed. */

var INVOICE_TERMS = CONFIG.INVOICE_TERMS_DAYS;


var partnerInvoices = [];

/* ---- the two-way line between OG and Yalla Wear ---------------------------
   One array, read from both portals. That is the whole mechanism: there is no
   syncing, no copy, no second source — OG and Yalla are looking at the same
   objects, which is why a message posted on one side is simply *there* on the
   other. `readOg` / `readYl` are tracked separately so reading a thread in one
   portal never silently clears the other side's badge. A sender has, by
   definition, already read their own message. */

var MSG_REASONS = {
  'fabric-late':     'Fabric delivery late',
  'printer-down':    'Printer / heat press down',
  'awaiting-names':  'Waiting on name confirmation',
  'quality-recheck': 'Quality re-check',
  'other':           'Other'
};

function hoursAgo(n) { return new Date(Date.now() - n * 3600000); }

var _msgSeq = 0;
var jobMessages = [];

/* -------------------------------------------------------------- 9. HELPERS */

var DB = {
  config: CONFIG,
  products: products,
  variants: variants,
  customers: customers,
  sales: sales,
  printJobs: printJobs,
  suppliers: suppliers,
  employees: employees,
  stockMovements: stockMovements,
  notifications: notifications,

  /* ---- which alerts have been seen ------------------------------------
     The server decides. It knows who is asking, so supplier debt and
     payroll only reach the people allowed to see them, and it keys the
     read state on WHAT the alert is about rather than on its words.

     Both of those were wrong in the first version. It kept the read set in
     localStorage, so reading an alert on the till left it bold in the
     office; and it keyed on the text, so "due in 3 days" becoming "due in
     2 days" overnight quietly made a read alert unread again. */
  isNotifRead: function (n) { return !!n.read; },

  unreadNotifications: function () {
    return notifications.filter(function (n) { return !n.read; });
  },

  /* Optimistic, like every other partner write: the badge falls now and the
     server is told, rather than the person watching a round trip finish
     before the number moves. */
  markNotifRead: function (n) {
    var hit = n ? [n] : notifications;
    hit.forEach(function (x) { x.read = true; });
    if (DB.live && typeof Shop !== 'undefined' && Shop.live()) {
      Shop.markAlertRead(n ? n.key : null).catch(function () {});
    }
    return notifications.filter(function (x) { return x.read; }).length;
  },
  sizeSets: SIZE_SETS,
  typeLabels: TYPE_LABELS,
  paymentLabels: PAYMENT_LABELS,
  paymentLabelsAr: PAYMENT_LABELS_AR,
  /* One call site instead of every screen remembering to check the language. */
  payLabel: function (k) {
    return (OG.lang === 'ar' ? PAYMENT_LABELS_AR[k] : null) || PAYMENT_LABELS[k] || k;
  },
  paymentMethods: PAYMENT_METHODS,
  printStages: PRINT_STAGES,
  printStageLabels: PRINT_STAGE_LABELS,
  movementTypes: MOVEMENT_TYPES,
  warehouses: WAREHOUSES,
  defaultWh: DEFAULT_WH,
  intakeWh: INTAKE_WH,
  partnerInvoices: partnerInvoices,
  jobMessages: jobMessages,
  waMessages: waMessages,
  msgReasons: MSG_REASONS,
  clubs: CLUBS,

  product: function (id) { return products.filter(function (p) { return p.id === id; })[0]; },
  customer: function (id) { return customers.filter(function (c) { return c.id === id; })[0]; },
  sale: function (id) { return sales.filter(function (s) { return s.id === id; })[0]; },
  variantsOf: function (pid) { return variants.filter(function (v) { return v.productId === pid; }); },

  /* Variants whose product is still on sale.

     Archiving a product does NOT remove it — a discontinued line still has to
     resolve on every invoice that named it — so its variants stay in this
     array with whatever stock they had. Everything that answers "how much
     stock does the shop have" therefore has to skip them, or the answer
     includes goods nobody can sell.

     The five demo products were carrying 293 pieces this way, and they were
     in the warehouse totals, the dashboard's stock value and the count sheet.
     The Products screen was the only one that filtered, which is why they
     looked fine there and wrong everywhere else. */
  liveVariants: function () {
    return variants.filter(function (v) {
      var p = DB.product(v.productId);
      return p && !p.archived;
    });
  },
  variantBySku: function (sku) { return variants.filter(function (v) { return v.sku === sku; })[0]; },
  variantByBarcode: function (b) { return variants.filter(function (v) { return v.barcode === b; })[0]; },
  variantByLabelCode: function (c) { return variants.filter(function (v) { return v.labelCode === c; })[0]; },

  totalQty: function (pid) {
    return DB.variantsOf(pid).reduce(function (s, v) { return s + v.qty; }, 0);
  },

  health: function (qty) {
    if (qty <= 0) return 'out';
    if (qty <= CONFIG.STOCK_CRITICAL) return 'critical';
    if (qty <= CONFIG.STOCK_LOW) return 'low';
    return 'healthy';
  },

  /* A product is "gapped" when it has stock overall but zero in a middle size. */
  sizeGaps: function (pid) {
    var vs = DB.variantsOf(pid);
    if (!vs.length) return [];
    var mid = vs.slice(1, vs.length - 1);
    return mid.filter(function (v) { return v.qty === 0; }).map(function (v) { return v.size; });
  },

  criticalVariants: function () {
    return DB.liveVariants().filter(function (v) { return v.qty <= CONFIG.STOCK_CRITICAL; });
  },

  /* ---- warehouses --------------------------------------------------------
     Everything below reads or writes v.wh. The three writers are the ONLY
     places allowed to touch stock, and each one re-derives v.qty from the
     buckets so the total can never drift from the split. */

  warehouse: function (id) {
    return WAREHOUSES.filter(function (w) { return w.id === id; })[0];
  },

  whName: function (id, ar) {
    var w = DB.warehouse(id);
    if (!w) return id || '—';
    return ar ? w.nameAr : w.name;
  },

  stockAt: function (v, whId) {
    if (!v || !v.wh) return 0;
    return v.wh[whId] || 0;
  },

  /* Somewhere other than `whId` that still has this size. Drives the
     "it's in the back" prompt at the till. */
  stockElsewhere: function (v, whId) {
    var n = 0;
    WAREHOUSES.forEach(function (w) {
      if (w.id !== whId) n += DB.stockAt(v, w.id);
    });
    return n;
  },

  /* Relative change in one location. Returns the number actually moved, which
     is clamped so a bucket can never go negative — a location cannot hold
     minus three pairs, and silently allowing it would make the totals lie. */
  moveStock: function (v, whId, delta, meta) {
    if (!v || !v.wh || !DB.warehouse(whId)) return 0;
    var have = DB.stockAt(v, whId);
    var applied = delta;
    if (have + applied < 0) applied = -have;
    if (applied === 0) return 0;

    v.wh[whId] = have + applied;
    v.qty = WAREHOUSES.reduce(function (s, w) { return s + (v.wh[w.id] || 0); }, 0);

    if (meta) {
      DB.logMovement({
        date: meta.date || new Date(),
        sku: v.sku, productId: v.productId, size: v.size,
        wh: whId,
        type: meta.type || (applied > 0 ? 'received' : 'sold'),
        delta: applied,
        balance: v.wh[whId],
        note: meta.note || '',
        user: meta.user || 'Maher Odeh'
      });
    }
    return applied;
  },

  /* Absolute set for one location, used by the stock count. */
  setStockAt: function (v, whId, n, meta) {
    return DB.moveStock(v, whId, (n || 0) - DB.stockAt(v, whId), meta);
  },

  /* Two logged legs, out of one place and into the other, so the trail
     balances and nothing appears from nowhere. `transfer` has existed in
     MOVEMENT_TYPES since the beginning and was never used until now. */
  transfer: function (v, fromWh, toWh, n, user) {
    if (!v || fromWh === toWh) return 0;
    var have = DB.stockAt(v, fromWh);
    var qty = Math.min(Math.max(0, n || 0), have);
    if (qty <= 0) return 0;

    var now = new Date();
    var label = DB.whName(fromWh) + ' -> ' + DB.whName(toWh);
    /* Both legs carry type 'transfer'. The movements table badges by type and
       colours by the sign of delta, so one type reads correctly as a matched
       pair — an out and an in — rather than as a write-off and a return. */
    DB.moveStock(v, fromWh, -qty, {
      date: now, type: 'transfer', note: label, user: user || 'Maher Odeh'
    });
    DB.moveStock(v, toWh, qty, {
      date: now, type: 'transfer', note: label, user: user || 'Maher Odeh'
    });
    return qty;
  },

  whTotals: function (whId) {
    var skus = 0, pieces = 0, value = 0, low = 0;
    DB.liveVariants().forEach(function (v) {
      var n = whId === 'all' ? v.qty : DB.stockAt(v, whId);
      if (n > 0) skus++;
      pieces += n;
      var p = DB.product(v.productId);
      if (p) value += n * p.costPrice;
      if (n > 0 && n <= CONFIG.STOCK_LOW) low++;
    });
    return { skus: skus, pieces: pieces, value: value, low: low };
  },

  /* THE HEADLINE: nothing on the shop floor, but stock sitting in the back.
     Ranked by how fast it sells, so the busiest gap is the first one fixed. */
  floorOuts: function () {
    var out = [];
    DB.liveVariants().forEach(function (v) {
      var here = DB.stockAt(v, DEFAULT_WH);
      var back = DB.stockElsewhere(v, DEFAULT_WH);
      if (here > 0 || back <= 0) return;
      out.push({
        sku: v.sku, productId: v.productId, size: v.size,
        here: here, back: back,
        rate: DB.weeklyRate(v.productId, v.size)
      });
    });
    out.sort(function (a, b) { return b.rate - a.rate || b.back - a.back; });
    return out;
  },

  /* What to carry from the back to the wall, and how many. Same row shape as
     DB.reorderSuggestions so whPoTab's table markup can be reused. */
  replenishSuggestions: function () {
    return DB.floorOuts().map(function (r) {
      /* How many to carry out. Sales rate alone is useless here — most single
         sizes sell well under one a week, so a rate-based figure rounds to the
         same small number for every row and the column stops saying anything.
         So: a minimum worth displaying, or two weeks of cover, or a third of
         what is in the back, whichever is largest — capped by the back, which
         also means storage is never emptied for one size. */
      var want = Math.max(3,
                          Math.ceil((r.rate || 0) * 2),
                          Math.ceil(r.back * 0.3));
      return {
        sku: r.sku, productId: r.productId, size: r.size,
        here: r.here, back: r.back, rate: r.rate,
        qty: Math.min(want, r.back)
      };
    });
  },

  daysBetween: function (a, b) {
    return Math.round((b - a) / 86400000);
  },

  daysSince: function (d) { return Math.round((TODAY - new Date(d).setHours(0, 0, 0, 0)) / 86400000); },

  isOverdue: function (job) { return job.stage !== 'done' && DB.daysSince(job.deadline) > 0; },


  stageIndex: function (job) { return PRINT_STAGES.indexOf(job.stage); },

  /* Single place a job's stage can change, so the history always stays in
     step with the tracker — used by the OG kanban and the Yalla portal.

     The TBC gate lives here rather than in the two UIs that call it. A shirt
     with no name on it cannot be printed, so no screen — partner board, OG
     kanban, bulk stage-advance — should be able to push the job past
     "Sent to print". Enforcing it at the data layer means that is true by
     construction instead of by three separate people remembering. */
  /* `by` is optional and is the side making the move ('og' | 'yalla'). When
     given, the meaningful stages announce themselves to the other portal.
     Omitting it moves the stage silently, which is what every pre-existing
     call site wants — a restore inside a test should not post a notification. */
  setStage: function (job, stage, by) {
    var to = PRINT_STAGES.indexOf(stage);
    if (to < 0 || job.stage === stage) return false;
    if (to > PRINT_STAGES.indexOf('sent') && DB.tbcCount(job) > 0) return false;
    /* THE GATE. "Sent to print" is not something OG can assert on its own —
       it means the printer took the job. The only way through is acceptOrder,
       which flips the order to accepted before calling this. */
    if (stage === 'sent' && job.order && job.order.state !== 'accepted') return false;

    job.stage = stage;
    job.history = (job.history || []).filter(function (h) {
      return PRINT_STAGES.indexOf(h.stage) < to;
    });
    job.history.push({ stage: stage, at: new Date() });

    if (by) {
      var KIND = { printing: 'in-print', delivery: 'shipped', done: 'shipped' };
      if (KIND[stage]) {
        DB.postMessage({
          jobId: job.id, from: by, kind: KIND[stage],
          text: PRINT_STAGE_LABELS[stage] + ' — ' + job.id + ' · ' + job.qty + ' pcs'
        }, true);
      }
    }

    pushPartner(function () { return Shop.setJobStage(job.id, stage); },
                typeof t === 'function' ? t('print_title') : 'Print jobs');
    return true;
  },

  /* ---- the order handshake -----------------------------------------------
     Between "OG made a job" and "the printer is working on it" there is a
     handover, and until now the app had no representation of it. The envelope
     below is that handover: OG sends, Yalla accepts or declines, and only an
     acceptance can put the job on the press.

     Every one of these posts a message, and because both portals render from
     the same DB.jobMessages array there is nothing to sync — the notification
     is simply already on the other side. */

  order: function (job) {
    /* Jobs created before this feature, and any built by hand in a test, may
       have no envelope. Treat them as draft rather than crashing. */
    if (job && !job.order) {
      job.order = { state: 'draft', sentAt: null, respondedAt: null, promisedAt: null, note: '' };
    }
    return job ? job.order : null;
  },

  orderState: function (job) { return DB.order(job) ? job.order.state : 'draft'; },

  /* null when it can be sent, otherwise why not. */
  canSendOrder: function (job) {
    if (!job) return 'no-job';
    var st = DB.orderState(job);
    if (st === 'pending')  return 'already-sent';
    if (st === 'accepted') return 'already-accepted';
    /* A shirt with no name cannot be printed, so an order carrying one cannot
       honestly be placed. Same rule the stage gate already enforces further
       down the line — applied here, it stops the bad order at the door. */
    if (DB.tbcCount(job) > 0) return 'tbc';
    return null;
  },

  /* ---- the order handshake --------------------------------------------
     All three push. They used to move the envelope in memory only, which
     broke the whole board: accepting set order.state = 'accepted' here and
     then asked the server for stage 'sent', but the server's own
     order_state was still 'draft', so it refused with not_accepted and the
     reload threw the acceptance away. Nothing could leave Design. */

  sendOrder: function (job) {
    if (DB.canSendOrder(job)) return false;
    var o = DB.order(job);
    o.state = 'pending';
    o.sentAt = new Date();
    o.respondedAt = null;
    o.note = '';
    pushPartner(function () { return Shop.sendOrder(job.id); },
                typeof t === 'function' ? t('print_title') : 'Print jobs');
    /* The server posts no message for this one, so this is the only copy. */
    DB.postMessage({
      jobId: job.id, from: 'og', kind: 'order',
      text: job.design + ' — ' + job.qty + ' pcs, wanted by ' + fmtDateSeed(job.deadline)
    });
    return true;
  },

  acceptOrder: function (job, promisedAt) {
    if (DB.orderState(job) !== 'pending') return false;
    var o = job.order;
    o.state = 'accepted';
    o.respondedAt = new Date();
    o.promisedAt = promisedAt ? new Date(promisedAt) : new Date(job.deadline);

    /* No DB.setStage here any more. The server moves the stage inside the
       same transaction that records the acceptance, because they are one
       fact — and doing it in a second call could leave an accepted order on
       a job still sitting in Design. */
    if (job.stage === 'design') job.stage = 'sent';

    pushPartner(function () {
      return Shop.respondOrder(job.id, true, { promisedAt: o.promisedAt.toISOString() });
    }, typeof t === 'function' ? t('print_title') : 'Print jobs');

    /* quiet: the server writes its own copy of this line. */
    DB.postMessage({
      jobId: job.id, from: 'yalla', kind: 'accepted',
      text: 'Accepted — ready by ' + fmtDateSeed(o.promisedAt)
    }, true);
    return true;
  },

  declineOrder: function (job, note) {
    if (DB.orderState(job) !== 'pending') return false;
    var o = job.order;
    o.state = 'declined';
    o.respondedAt = new Date();
    o.promisedAt = null;
    o.note = String(note || '').trim();

    pushPartner(function () {
      return Shop.respondOrder(job.id, false, { note: o.note });
    }, typeof t === 'function' ? t('print_title') : 'Print jobs');

    /* The job stays in Design. It was never handed over, so nothing about its
       stage should suggest that it was. */
    DB.postMessage({
      jobId: job.id, from: 'yalla', kind: 'declined',
      text: o.note || 'Cannot take this one right now.'
    }, true);
    return true;
  },

  pendingOrders: function () {
    return printJobs.filter(function (j) { return DB.orderState(j) === 'pending'; });
  },

  /* Orders Yalla has not answered within `hours`. A silent order is the one
     failure mode this whole feature could otherwise introduce. */
  awaitingResponse: function (hours) {
    var limit = (hours == null ? 4 : hours) * 3600000;
    var now = Date.now();
    return DB.pendingOrders().filter(function (j) {
      return j.order.sentAt && (now - new Date(j.order.sentAt).getTime()) >= limit;
    });
  },

  /* The date the job is actually judged against: what Yalla promised, falling
     back to what OG asked for when there is no promise on record. */
  promisedDate: function (job) {
    var o = DB.order(job);
    return (o && o.promisedAt) ? o.promisedAt : job.deadline;
  },

  stageAt: function (job, stage) {
    var hit = (job.history || []).filter(function (h) { return h.stage === stage; })[0];
    return hit ? hit.at : null;
  },

  /* ---- kits --------------------------------------------------------------
     A "TBC" line is simply one with no printed name. There is no flag to keep
     in sync, so the two can never disagree. */

  job: function (id) { return printJobs.filter(function (j) { return j.id === id; })[0]; },

  kitLines: function (job) { return (job && job.lines) || []; },

  line: function (jobId, lineId) {
    return DB.kitLines(DB.job(jobId)).filter(function (l) { return l.id === lineId; })[0];
  },

  tbcLines: function (job) {
    return DB.kitLines(job).filter(function (l) { return !l.print; });
  },

  /* Counted in PIECES, not lines — a TBC line for two shirts is two shirts
     nobody can print. */
  tbcCount: function (job) {
    return DB.tbcLines(job).reduce(function (a, l) { return a + l.qty; }, 0);
  },

  jobKitTotal: function (job) {
    return DB.kitLines(job).reduce(function (a, l) { return a + l.qty * l.price; }, 0);
  },

  /* What a stage change would do, without doing it — so a UI can grey out a
     drop target instead of letting the user try and get a toast. */
  blockedBy: function (job, stage) {
    if (PRINT_STAGES.indexOf(stage) > PRINT_STAGES.indexOf('sent') && DB.tbcCount(job) > 0) return 'tbc';
    return null;
  },

  confirmName: function (jobId, lineId, name, number) {
    var l = DB.line(jobId, lineId);
    if (!l) return false;
    l.print = (name || '').toUpperCase().trim() || null;
    if (number !== undefined) l.number = number || null;
    DB.saveLines(DB.job(jobId));
    return !!l.print;
  },

  /* Send a kit sheet's names and numbers to the server.

     Line ids are prefixed 'L' on the way in from hydrate — the screens have
     always wanted a string id — so the prefix comes off again here. Sending
     'L12' would match nothing and the save would look like it worked. */
  saveLines: function (job) {
    if (!job || !job.lines) return;
    pushPartner(function () {
      return Shop.setJobLines(job.id, job.lines.map(function (l) {
        return {
          id: String(l.id).replace(/^L/, ''),
          printName: l.print,
          number: l.number
        };
      }));
    }, typeof t === 'function' ? t('print_title') : 'Print jobs');
  },

  /* ---- partner invoices --------------------------------------------------
     Everything below derives from `refs` and `payments`. Nothing stores a
     total or a status, so nothing can go stale. */

  invoice: function (id) { return partnerInvoices.filter(function (i) { return i.id === id; })[0]; },

  /* Resolve one ref to { label, sub, qty, amount }. lineId null = whole bulk
     job; otherwise a single kit line. Returns null if the ref has gone stale,
     so a deleted job cannot take the finance page down with it. */
  refDetail: function (ref) {
    var j = DB.job(ref.jobId);
    if (!j) return null;
    if (!ref.lineId) {
      return { jobId: j.id, lineId: null, label: j.design, sub: '', number: null,
               size: null, qty: j.qty, price: j.cost, amount: j.cost };
    }
    var l = DB.line(ref.jobId, ref.lineId);
    if (!l) return null;
    return { jobId: j.id, lineId: l.id, label: l.club, sub: l.clubAr, print: l.print,
             number: l.number, size: l.size, qty: l.qty, price: l.price,
             amount: l.qty * l.price };
  },

  /* Two kinds of line on one invoice:
       refs[]  — pulled from delivered work, so billing stays tied to jobs
       lines[] — typed by hand on a blank invoice, tied to nothing
     Both resolve to the same shape, so every total, export and print path
     below treats them identically and neither is a special case. */
  invoiceLines: function (inv) {
    var fromJobs = (inv.refs || []).map(DB.refDetail).filter(Boolean);
    var freehand = (inv.lines || []).map(function (l) {
      return { jobId: null, lineId: l.id, label: l.club, sub: l.clubAr, print: l.print,
               number: l.number, size: l.size, qty: l.qty, price: l.price,
               amount: l.qty * l.price };
    });
    return fromJobs.concat(freehand);
  },

  invoiceTotal: function (inv) {
    return DB.invoiceLines(inv).reduce(function (a, d) { return a + d.amount; }, 0);
  },

  invoicePieces: function (inv) {
    return DB.invoiceLines(inv).reduce(function (a, d) { return a + d.qty; }, 0);
  },

  invoicePaid: function (inv) {
    return (inv.payments || []).reduce(function (a, p) { return a + p.amount; }, 0);
  },

  invoiceBalance: function (inv) {
    return Math.max(0, DB.invoiceTotal(inv) - DB.invoicePaid(inv));
  },

  /* draft (never issued) · paid · part · sent. Overdue is a separate question
     from status, because an invoice can be part-paid AND late. */
  invoiceStatus: function (inv) {
    if (!inv.issued) return 'draft';
    var paid = DB.invoicePaid(inv), total = DB.invoiceTotal(inv);
    if (total > 0 && paid >= total) return 'paid';
    if (paid > 0) return 'part';
    return 'sent';
  },

  invoiceOverdue: function (inv) {
    return DB.invoiceStatus(inv) !== 'paid' && !!inv.issued && !!inv.due && DB.daysSince(inv.due) > 0;
  },

  /* Delivered work that is not on any invoice yet — the pool the builder
     opens onto, and the "unbilled" figure on the dashboard. */
  billedRefKeys: function (exceptId) {
    var seen = {};
    partnerInvoices.forEach(function (inv) {
      if (exceptId && inv.id === exceptId) return;
      (inv.refs || []).forEach(function (r) { seen[r.jobId + '|' + (r.lineId || '')] = true; });
    });
    return seen;
  },

  unbilledRefs: function (exceptId) {
    var seen = DB.billedRefKeys(exceptId), out = [];
    printJobs.forEach(function (j) {
      if (j.stage !== 'done') return;              // only delivered work is billable
      var refs = j.kind === 'kit'
        ? j.lines.map(function (l) { return { jobId: j.id, lineId: l.id }; })
        : [{ jobId: j.id, lineId: null }];
      refs.forEach(function (r) {
        if (!seen[r.jobId + '|' + (r.lineId || '')]) out.push(r);
      });
    });
    return out;
  },

  unbilledTotal: function () {
    return DB.unbilledRefs().reduce(function (a, r) {
      var d = DB.refDetail(r); return a + (d ? d.amount : 0);
    }, 0);
  },

  /* Deliberately NOT nextInvoiceId — that name is already taken further down
     by the sales-invoice counter (INV-2224). Two keys with the same name in
     one object literal is legal JavaScript and the second silently wins, so
     this would have quietly handed out INV- numbers to partner invoices. */
  nextPartnerInvoiceId: function () {
    var year = TODAY.getFullYear(), max = 0;
    partnerInvoices.forEach(function (i) {
      var p = i.id.split('-');
      if (+p[1] === year) { var n = parseInt(p[2], 10); if (n > max) max = n; }
    });
    return 'YW-' + year + '-' + pad(max + 1, 3);
  },

  newInvoice: function (refs, note, lines) {
    var inv = { id: DB.nextPartnerInvoiceId(), issued: null, due: null,
                refs: (refs || []).slice(), lines: (lines || []).slice(),
                note: note || '', payments: [] };
    partnerInvoices.unshift(inv);
    return inv;
  },

  /* Drop an invoice that was never issued. A sent invoice is a document that
     exists in the world and someone may be holding a copy — that one gets
     voided in the UI, never deleted here. */
  deleteDraft: function (inv) {
    if (inv.issued) return false;
    var i = partnerInvoices.indexOf(inv);
    if (i < 0) return false;
    partnerInvoices.splice(i, 1);
    return true;
  },

  issueInvoice: function (inv, when) {
    if (inv.issued) return false;
    inv.issued = when || new Date();
    inv.due = new Date(inv.issued.getTime() + INVOICE_TERMS * 86400000);
    return true;
  },

  /* Refuses overpayment rather than quietly recording a negative balance —
     if the number is wrong the user needs to see that, not have it absorbed. */
  payInvoice: function (inv, amount, method, when) {
    var bal = DB.invoiceBalance(inv);
    if (!(amount > 0) || amount > bal) return false;
    inv.payments.push({ at: when || new Date(), amount: amount, method: method || 'cash' });
    return true;
  },

  outstandingTotal: function () {
    return partnerInvoices.reduce(function (a, i) {
      return i.issued ? a + DB.invoiceBalance(i) : a;
    }, 0);
  },

  paidInMonth: function (monthsBack) {
    var d = new Date(TODAY.getFullYear(), TODAY.getMonth() - (monthsBack || 0), 1);
    var e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return partnerInvoices.reduce(function (a, i) {
      return a + (i.payments || []).reduce(function (b, p) {
        return (p.at >= d && p.at < e) ? b + p.amount : b;
      }, 0);
    }, 0);
  },

  /* Averaged over invoices that actually settled, in days from issue to the
     final payment. An unpaid invoice has no answer yet and is excluded — the
     alternative silently flatters the number. */
  avgDaysToPay: function () {
    var spans = [];
    partnerInvoices.forEach(function (i) {
      if (!i.issued || DB.invoiceStatus(i) !== 'paid') return;
      var last = i.payments.reduce(function (m, p) { return p.at > m ? p.at : m; }, i.issued);
      spans.push(DB.daysBetween(i.issued, last));
    });
    if (!spans.length) return null;
    return Math.round(spans.reduce(function (a, b) { return a + b; }, 0) / spans.length);
  },

  /* Buckets are by AGE SINCE ISSUE, and they sum exactly to outstandingTotal. */
  invoiceAgeing: function () {
    var b = [{ key: '0-7', max: 7, value: 0 }, { key: '8-30', max: 30, value: 0 },
             { key: '31-60', max: 60, value: 0 }, { key: '60+', max: Infinity, value: 0 }];
    partnerInvoices.forEach(function (i) {
      if (!i.issued) return;
      var bal = DB.invoiceBalance(i);
      if (bal <= 0) return;
      var age = DB.daysSince(i.issued);
      for (var k = 0; k < b.length; k++) { if (age <= b[k].max) { b[k].value += bal; return; } }
    });
    return b;
  },

  /* ---- messages ----------------------------------------------------------
     One array, both portals. `from` is the author; a sender has by definition
     already read their own message. */

  messagesFor: function (opts) {
    return jobMessages.filter(function (m) {
      if (opts.jobId) return m.jobId === opts.jobId;
      if (opts.invoiceId) return m.invoiceId === opts.invoiceId;
      return true;
    }).sort(function (a, b) { return a.at - b.at; });
  },

  postMessage: function (m, quiet) {
    var msg = {
      id: 'M' + (++_msgSeq),
      jobId: m.jobId || null, invoiceId: m.invoiceId || null,
      from: m.from, kind: m.kind || 'note', reason: m.reason || null,
      text: m.text || '', at: new Date(),
      readOg: m.from === 'og', readYl: m.from === 'yalla'
    };
    jobMessages.push(msg);
    /* `quiet` is for the message a stage change posts by itself: the
       server writes its own copy when the stage moves, and sending this
       one too would put the same line in the thread twice. */
    if (!quiet) {
      pushPartner(function () {
        return Shop.postMessage({
          jobId: msg.jobId, invoiceId: msg.invoiceId,
          kind: msg.kind, reason: msg.reason, text: msg.text
        });
      }, typeof t === 'function' ? t('messages') : 'Messages');
    }
    return msg;
  },

  unreadFor: function (side) {
    var f = side === 'og' ? 'readOg' : 'readYl';
    return jobMessages.filter(function (m) { return !m[f]; });
  },

  /* Reading a thread on one side never clears the other side's badge — the
     two flags are tracked apart on purpose.

     This is optimistic rather than server-first: a badge that waits for a
     round trip before it clears makes opening a thread feel broken, and the
     worst case if the push fails is a badge that comes back. It did not push
     at all before, so the badge came back on every single reload. */
  markRead: function (side, filter) {
    var f = side === 'og' ? 'readOg' : 'readYl', n = 0;
    jobMessages.forEach(function (m) {
      if (m[f]) return;
      if (filter && filter.jobId && m.jobId !== filter.jobId) return;
      if (filter && filter.invoiceId && m.invoiceId !== filter.invoiceId) return;
      m[f] = true; n++;
    });

    /* Only when a thread was named. The server marks a job or an invoice, not
       "everything", so a blanket call would have nothing to address. */
    if (n && filter && (filter.jobId || filter.invoiceId)) {
      pushPartner(function () {
        return Shop.markMsgRead({ jobId: filter.jobId || null,
                                  invoiceId: filter.invoiceId || null });
      }, typeof t === 'function' ? t('messages') : 'Messages', true);
    }
    return n;
  },

  unreadOnJob: function (side, jobId) {
    var f = side === 'og' ? 'readOg' : 'readYl';
    return jobMessages.filter(function (m) { return m.jobId === jobId && !m[f]; }).length;
  },

  /* ---- partner scorecard -------------------------------------------------
     Both computed from the stamped stage history, so they cost nothing to
     keep and cannot be fudged. */

  onTimeRate: function () {
    var done = printJobs.filter(function (j) { return j.stage === 'done'; });
    if (!done.length) return null;
    var hit = done.filter(function (j) {
      var at = DB.stageAt(j, 'done');
      /* Measured against the date Yalla PROMISED, not the one OG wished for.
         A printer can only fairly be scored on what they agreed to. Seeded
         jobs promise their original deadline, so this figure is unchanged for
         existing data — only a future job with a renegotiated date moves it. */
      var due = DB.promisedDate(j);
      return at && new Date(at).setHours(0, 0, 0, 0) <= new Date(due).setHours(0, 0, 0, 0);
    }).length;
    return Math.round(hit / done.length * 100);
  },

  avgTurnaround: function () {
    var spans = [];
    printJobs.forEach(function (j) {
      var at = DB.stageAt(j, 'done');
      if (at) spans.push(Math.max(0, DB.daysBetween(j.created, new Date(at))));
    });
    if (!spans.length) return null;
    return Math.round(spans.reduce(function (a, b) { return a + b; }, 0) / spans.length);
  },

  /* ---- partner access control -------------------------------------------
     Yalla Wear renders ONLY from this object. The customer's name, phone and
     the price OG charges them are not omitted from a template — they never
     leave this function. That makes the guarantee structural, not cosmetic. */
  partnerView: function (job) {
    return {
      id: job.id,
      design: job.design,
      kind: job.kind,
      /* Kit lines DO cross the boundary — the name is going on the shirt, so
         the person printing it has to know. What still never crosses is who
         ordered it, their phone number, and what OG charged them. */
      lines: job.lines || null,
      tbc: DB.tbcCount(job),
      qty: job.qty,
      sizes: job.sizes,
      priority: job.priority,
      created: job.created,
      deadline: job.deadline,
      stage: job.stage,
      history: job.history,
      /* The envelope crosses whole. Deliberately checked: it carries only
         states and timestamps — no customer name, no phone, no OG price — so
         there is nothing in it the printer should not see. */
      order: job.order,
      payout: job.cost,            // what OG pays Yalla Wear — their own money
      overdue: DB.isOverdue(job)
    };
  },

  /* The partner's board holds work that has actually been handed to them.
     A draft is OG thinking out loud, and a pending order is an offer they
     have not answered yet — neither is theirs, and showing either as a job on
     the board would mean the printer is looking at work nobody asked them to
     do. Pending orders surface separately, through partnerInbox. */
  partnerJobs: function (includeDone) {
    return printJobs
      .filter(function (j) { return includeDone || j.stage !== 'done'; })
      /* Accepted only. A declined job has gone back to OG — the printer said
         no, so it is not their work in hand, and leaving it on their board
         would read as something still to do. The refusal itself lives in the
         message thread, which is where the record belongs. */
      .filter(function (j) { return DB.orderState(j) === 'accepted'; })
      .map(DB.partnerView)
      .sort(function (a, b) { return a.deadline - b.deadline; });
  },

  /* Offers awaiting an answer, oldest first — the ones kept waiting longest
     are the ones that need answering first. */
  partnerInbox: function () {
    return DB.pendingOrders()
      .map(DB.partnerView)
      .sort(function (a, b) {
        return new Date(a.order.sentAt) - new Date(b.order.sentAt);
      });
  },

  inactiveCustomers: function (days) {
    return customers.filter(function (c) { return DB.daysSince(c.lastPurchaseDate) >= (days || 90); });
  },

  tier: function (points) {
    if (points >= CONFIG.TIER_GOLD) return 'gold';
    if (points >= CONFIG.TIER_SILVER) return 'silver';
    return 'bronze';
  },

  /* Sales aggregated by month for the dashboard line chart. */
  monthlySales: function (months) {
    months = months || 6;
    var out = [];
    for (var i = months - 1; i >= 0; i--) {
      var d = new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1);
      var end = new Date(TODAY.getFullYear(), TODAY.getMonth() - i + 1, 1);
      var total = sales.reduce(function (s, x) { return (x.date >= d && x.date < end) ? s + x.total : s; }, 0);
      var count = sales.filter(function (x) { return x.date >= d && x.date < end; }).length;
      out.push({ date: d, label: d.toLocaleDateString('en-GB', { month: 'short' }), total: total, count: count });
    }
    return out;
  },

  salesByType: function () {
    var map = {};
    sales.forEach(function (s) {
      s.items.forEach(function (it) {
        map[it.type] = (map[it.type] || 0) + it.qty * it.unitPrice;
      });
    });
    return Object.keys(map).map(function (k) {
      return { type: k, label: TYPE_LABELS[k] || k, total: map[k] };
    }).sort(function (a, b) { return b.total - a.total; });
  },

  profitByType: function () {
    var map = {};
    sales.forEach(function (s) {
      s.items.forEach(function (it) {
        if (!map[it.type]) map[it.type] = { revenue: 0, cost: 0, units: 0 };
        map[it.type].revenue += it.qty * it.unitPrice;
        map[it.type].cost += it.qty * it.unitCost;
        map[it.type].units += it.qty;
      });
    });
    return Object.keys(map).map(function (k) {
      var m = map[k];
      return {
        type: k, label: TYPE_LABELS[k] || k, revenue: m.revenue, cost: m.cost,
        units: m.units, profit: m.revenue - m.cost,
        margin: m.revenue ? (m.revenue - m.cost) / m.revenue * 100 : 0
      };
    }).sort(function (a, b) { return b.profit - a.profit; });
  },

  inventoryValue: function () {
    var map = {};
    products.forEach(function (p) {
      var q = DB.totalQty(p.id);
      if (!map[p.type]) map[p.type] = { units: 0, cost: 0, retail: 0 };
      map[p.type].units += q;
      map[p.type].cost += q * p.costPrice;
      map[p.type].retail += q * p.sellingPrice;
    });
    return Object.keys(map).map(function (k) {
      return {
        type: k, label: TYPE_LABELS[k] || k, units: map[k].units,
        cost: map[k].cost, retail: map[k].retail, locked: map[k].cost
      };
    }).sort(function (a, b) { return b.cost - a.cost; });
  },

  /* Tiny 12-point series used for the sparkline in the product drawer. */
  productTrend: function (pid) {
    var out = [];
    for (var i = 11; i >= 0; i--) {
      var from = daysAgo((i + 1) * 15), to = daysAgo(i * 15), n = 0;
      sales.forEach(function (s) {
        if (s.date >= from && s.date < to) {
          s.items.forEach(function (it) { if (it.productId === pid) n += it.qty; });
        }
      });
      out.push(n);
    }
    return out;
  },

  nextInvoiceId: function () {
    var max = 2100;
    sales.forEach(function (s) { var n = parseInt(s.id.split('-')[1], 10); if (n > max) max = n; });
    return 'INV-' + (max + 1);
  },

  /* The one way a product is created at the till, so a live-entered item is
     indistinguishable from a seeded one: real variants, real EAN-13 check
     digits, a real shelf, and a movement logged for the opening stock.

     `imgSrc` is a data URL the shop photographed itself. When it is absent
     the product falls back to the colour block the rest of the catalogue
     uses, so a product is never left without a visual. */
  newProduct: function (f) {
    var id = products.reduce(function (m, p) { return Math.max(m, p.id); }, 0) + 1;
    var words = String(f.name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
    var initials = ((words[0] || 'O')[0] + ((words[1] || words[0] || 'G')[1] || 'G')).toUpperCase();
    var palette = ['#4A4A52', '#3E5C8A', '#8E3B3B', '#B5822F', '#6B5B45', '#6455A0'];

    var p = {
      id: id,
      name: f.name,
      type: f.type || 'tshirts',
      brand: f.brand || 'OG',
      madeIn: f.madeIn || 'Syria',
      image: { bg: f.bg || palette[id % palette.length], initials: initials, src: f.imgSrc || null },
      colorway: f.colorway || 'Custom',
      costPrice: f.cost || 0,
      sellingPrice: f.price || 0,
      shelfZone: f.shelf || 'D',
      hidden: false,
      lastSoldDaysAgo: 0
    };
    products.push(p);

    var now = new Date();
    Object.keys(f.sizes || {}).forEach(function (size, idx) {
      var qty = Number(f.sizes[size]) || 0;
      if (!qty) return;
      var body = '621' + pad(id, 3) + pad(idx, 2) + pad(ri(0, 9999), 4);
      var v = {
        productId: id, size: size, qty: qty,
        sku: 'OG-' + pad(id, 3) + '-' + size,
        barcode: body + Codes.ean13Check(body),
        shelf: p.shelfZone + '-' + pad(ri(1, 24), 2),
        /* Opening stock arrives in the back like any other delivery. Starting
           at zero in both buckets lets moveStock below do the write, so a
           live-created product goes through exactly the same path as a PO. */
        wh: { floor: 0, store: 0 }
      };
      v.qty = 0;
      variants.push(v);
      /* Field names must match the seeded movements exactly or the warehouse
         log renders blank cells for anything created live. */
      DB.moveStock(v, INTAKE_WH, qty, {
        date: now, type: 'received',
        note: 'Opening stock — new product', user: 'Maher Odeh'
      });
    });

    return p;
  },

  /* ======================================================= MONEY ==========

     ---- shifts -------------------------------------------------------------
     A shift is the box under the counter between opening and closing. */

  currentShift: function () {
    return shifts.filter(function (s) { return !s.closed; })[0] || null;
  },

  openShift: function (user, float_) {
    if (DB.currentShift()) return null;                /* only one at a time */
    var s = {
      id: 'SH-' + pad(shifts.length + 1, 4),
      user: user || 'Lubna Kayali',
      openedAt: new Date(), closedAt: null,
      float: float_ || 0, counted: null, expected: null, diff: null, closed: false
    };
    shifts.push(s);
    return s;
  },

  /* Everything that happened inside the open shift. Sales are matched by the
     stamp they carry, not by time, so a sale rung up before the shift opened
     can never drift into it. */
  shiftSales: function (s) {
    if (!s) return [];
    return sales.filter(function (x) { return x.shiftId === s.id; });
  },

  shiftExpenses: function (s) {
    if (!s) return [];
    return expenses.filter(function (x) { return x.shiftId === s.id; });
  },

  /* THE NUMBER THE WHOLE SCREEN EXISTS FOR.
     Only drawer methods count toward cash on hand. Sham Cash and card are
     revenue but they are not in the box, and mixing them is exactly how a
     till appears to balance while money is missing. */
  shiftSummary: function (s) {
    if (!s) return null;
    var byMethod = {}, revenue = 0, drawerSales = 0;

    DB.shiftSales(s).forEach(function (x) {
      byMethod[x.payment] = (byMethod[x.payment] || 0) + x.total;
      revenue += x.total;
      if (DRAWER_METHODS.indexOf(x.payment) > -1) drawerSales += x.total;
    });

    /* Debt settled in cash during this shift is money that arrived in the
       box, even though the sale itself happened days ago. */
    var settled = debtPayments.reduce(function (a, p) {
      if (p.shiftId !== s.id) return a;
      return DRAWER_METHODS.indexOf(p.method) > -1 ? a + p.amount : a;
    }, 0);

    var cashOut = DB.shiftExpenses(s).reduce(function (a, e) {
      return DRAWER_METHODS.indexOf(e.method) > -1 ? a + e.amount : a;
    }, 0);

    var expected = s.float + drawerSales + settled - cashOut;

    return {
      byMethod: byMethod, revenue: revenue, drawerSales: drawerSales,
      settled: settled, cashOut: cashOut, expected: expected,
      count: DB.shiftSales(s).length,
      /* Anything that is revenue but is NOT in the drawer, listed so the
         cashier can see why expected is lower than the day's takings. */
      offDrawer: Object.keys(byMethod).filter(function (m) {
        return DRAWER_METHODS.indexOf(m) === -1 && m !== 'credit';
      }).reduce(function (a, m) { return a + byMethod[m]; }, 0),
      credit: byMethod.credit || 0
    };
  },

  closeShift: function (s, counted) {
    if (!s || s.closed) return null;
    var sum = DB.shiftSummary(s);
    s.counted = counted;
    s.expected = sum.expected;
    s.diff = counted - sum.expected;
    s.closedAt = new Date();
    s.closed = true;
    return s;
  },

  /* ---- expenses ---------------------------------------------------------- */

  newExpense: function (f) {
    var e = {
      id: 'EX-' + pad(expenses.length + 1, 4),
      at: f.at || new Date(),
      category: f.category || 'other',
      amount: Math.round(f.amount) || 0,
      method: f.method || 'cash',
      note: f.note || '',
      /* Stamped with the open shift so a cash expense comes straight out of
         the drawer it was actually paid from. */
      shiftId: (DB.currentShift() || {}).id || null
    };
    expenses.unshift(e);
    return e;
  },

  expensesBetween: function (from, to) {
    return expenses.filter(function (e) { return e.at >= from && e.at < to; });
  },

  expensesInMonth: function (monthsBack) {
    var d = new Date(TODAY.getFullYear(), TODAY.getMonth() - (monthsBack || 0), 1);
    var e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return DB.expensesBetween(d, e).reduce(function (a, x) { return a + x.amount; }, 0);
  },

  /* Gross minus what it actually cost to keep the doors open. This is the
     number Reports has been missing — revenue was being shown as if it were
     profit. */
  netProfit: function (monthsBack) {
    var d = new Date(TODAY.getFullYear(), TODAY.getMonth() - (monthsBack || 0), 1);
    var e = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    var gross = 0, cogs = 0;
    sales.forEach(function (s) {
      if (s.date < d || s.date >= e) return;
      gross += s.total;
      s.items.forEach(function (i) {
        var p = DB.product(i.productId);
        if (p) cogs += p.costPrice * i.qty;
      });
    });
    var exp = DB.expensesInMonth(monthsBack);
    return { gross: gross, cogs: cogs, grossProfit: gross - cogs, expenses: exp,
             net: gross - cogs - exp };
  },

  /* ---- the debt book, الدين ----------------------------------------------
     Derived from credit sales rather than stored separately, so a debt can
     never disagree with the sale that created it. */

  debtPaid: function (saleId) {
    return debtPayments.reduce(function (a, p) {
      return p.saleId === saleId ? a + p.amount : a;
    }, 0);
  },

  debtBalance: function (sale) {
    return Math.max(0, sale.total - DB.debtPaid(sale.id));
  },

  debts: function () {
    return sales
      .filter(function (s) { return s.payment === 'credit' && DB.debtBalance(s) > 0; })
      .map(function (s) {
        return {
          sale: s,
          customer: s.customerId ? DB.customer(s.customerId) : null,
          name: s.customerName,
          total: s.total,
          paid: DB.debtPaid(s.id),
          balance: DB.debtBalance(s),
          age: DB.daysSince(s.date)
        };
      })
      .sort(function (a, b) { return b.age - a.age; });
  },

  debtTotal: function () {
    return DB.debts().reduce(function (a, d) { return a + d.balance; }, 0);
  },

  /* Buckets sum exactly to debtTotal, same contract as the partner ageing. */
  debtAgeing: function () {
    var b = [{ key: '0-7', max: 7, value: 0 }, { key: '8-30', max: 30, value: 0 },
             { key: '31-60', max: 60, value: 0 }, { key: '60+', max: Infinity, value: 0 }];
    DB.debts().forEach(function (d) {
      for (var k = 0; k < b.length; k++) {
        if (d.age <= b[k].max) { b[k].value += d.balance; return; }
      }
    });
    return b;
  },

  payDebt: function (saleId, amount, method) {
    var s = DB.sale(saleId);
    if (!s) return false;
    var bal = DB.debtBalance(s);
    if (!(amount > 0) || amount > bal) return false;
    debtPayments.push({
      id: 'DP-' + pad(debtPayments.length + 1, 4),
      saleId: saleId, at: new Date(), amount: Math.round(amount),
      method: method || 'cash',
      shiftId: (DB.currentShift() || {}).id || null
    });
    return true;
  },

  /* ---- sales velocity, and what to reorder ------------------------------
     How many of this exact size actually sold per week, measured over a real
     window rather than guessed. This is what turns "size 42 is low" into
     "you sell 4 a week and have 3 left". */
  weeklyRate: function (productId, size, weeks) {
    weeks = weeks || 8;
    var since = daysAgo(weeks * 7);
    var sold = 0;
    sales.forEach(function (s) {
      if (s.date < since) return;
      s.items.forEach(function (i) {
        if (i.productId === productId && i.size === size) sold += i.qty;
      });
    });
    return sold / weeks;
  },

  /* When this exact SIZE last sold — null if it never has.
     ------------------------------------------------------------------
     Per size, deliberately. `product.lastSoldDaysAgo` is product-wide and
     would tell the wrong story on a scan: a shoe moving briskly in 41 says
     nothing about the 45 that has not left the shelf since March, and the 45
     is the one being held. Walks `sales` the same way weeklyRate does. */
  lastSoldFor: function (productId, size) {
    var when = null;
    sales.forEach(function (s) {
      for (var i = 0; i < s.items.length; i++) {
        var it = s.items[i];
        if (it.productId === productId && it.size === size) {
          if (!when || s.date > when) when = s.date;
          return;
        }
      }
    });
    return when;
  },

  /* The newest delivery of ANY size of this product: when, how many, where.
     Product-wide on purpose — stock arrives in a mixed box, so "when did this
     shoe last come in" is the question, not "when did size 41 come in". */
  lastDelivery: function (productId) {
    for (var i = 0; i < stockMovements.length; i++) {
      var m = stockMovements[i];
      if (m.productId === productId && m.type === 'received') return m;
    }
    return null;
  },

  /* The most recent movements for one size, newest first. stockMovements is
     already kept newest-first, so this is a filter and a slice. */
  movementsFor: function (sku, limit) {
    var out = [];
    for (var i = 0; i < stockMovements.length && out.length < (limit || 4); i++) {
      if (stockMovements[i].sku === sku) out.push(stockMovements[i]);
    }
    return out;
  },

  /* Days of stock left at the current rate. Infinity when nothing is selling —
     which is a different problem, and the UI says so rather than showing a
     misleading huge number. */
  daysOfCover: function (v) {
    var rate = DB.weeklyRate(v.productId, v.size);
    if (rate <= 0) return Infinity;
    return Math.round(v.qty / (rate / 7));
  },

  /* Every size worth ordering, with a quantity that covers `coverWeeks` of
     real demand and a reason the UI can show. Sorted most urgent first so the
     top of the list is genuinely the thing to do next. */
  reorderSuggestions: function (coverWeeks) {
    coverWeeks = coverWeeks || 4;
    var out = [];
    /* Never suggest reordering something the shop has stopped selling. */
    DB.liveVariants().forEach(function (v) {
      var rate = DB.weeklyRate(v.productId, v.size);
      var cover = DB.daysOfCover(v);
      var dead = rate <= 0;

      /* Two ways onto the list: running out fast, or already critical. A
         product nobody buys is deliberately excluded — reordering dead stock
         is how a stockroom fills up with things that never leave. */
      if (dead || (cover > coverWeeks * 7 && v.qty > CONFIG.STOCK_CRITICAL)) return;

      var target = Math.ceil(rate * coverWeeks);
      var qty = Math.max(CONFIG.STOCK_LOW, target) - v.qty;
      if (qty <= 0) return;

      out.push({
        productId: v.productId, size: v.size, sku: v.sku,
        have: v.qty, rate: Math.round(rate * 10) / 10,
        cover: cover, qty: qty,
        urgency: v.qty === 0 ? 0 : cover
      });
    });
    return out.sort(function (a, b) { return a.urgency - b.urgency; });
  },

  /* ---- purchase orders --------------------------------------------------- */

  purchaseOrders: purchaseOrders,
  poStatus: PO_STATUS,
  stockCounts: stockCounts,
  shifts: shifts,
  expenses: expenses,
  debtPayments: debtPayments,
  expenseCategories: EXPENSE_CATEGORIES,
  drawerMethods: DRAWER_METHODS,

  po: function (id) { return purchaseOrders.filter(function (p) { return p.id === id; })[0]; },

  nextPoId: function () {
    var max = 0;
    purchaseOrders.forEach(function (p) {
      var n = parseInt(String(p.id).split('-')[1], 10); if (n > max) max = n;
    });
    return 'PO-' + pad(max + 1, 4);
  },

  newPO: function (supplierId, lines, note) {
    var po = {
      id: DB.nextPoId(),
      supplierId: supplierId,
      created: new Date(),
      status: 'draft',
      note: note || '',
      /* { productId, size, qty, cost } — cost captured at order time, because
         with the lira moving it will not be the same next month. */
      lines: (lines || []).slice(),
      receivedAt: null
    };
    purchaseOrders.unshift(po);
    return po;
  },

  poTotal: function (po) {
    return (po.lines || []).reduce(function (a, l) { return a + l.qty * l.cost; }, 0);
  },

  poPieces: function (po) {
    return (po.lines || []).reduce(function (a, l) { return a + l.qty; }, 0);
  },

  sendPO: function (po) {
    if (po.status !== 'draft') return false;
    po.status = 'sent';
    return true;
  },

  /* Receiving is the only way a PO raises stock, and it goes through
     logMovement so the arrival shows up in the warehouse trail like every
     other change. The supplier's balance grows by what was actually received,
     not by what was ordered. */
  /* `stockAlreadyBooked` is set by the caller in live mode, where the pieces
     went to the server through the same receive endpoint a scan uses and have
     already been read back. Raising them again here would double the arrival:
     the boxes counted once on the shelf and twice in the system. */
  receivePO: function (po, stockAlreadyBooked) {
    if (po.status === 'received') return false;
    var now = new Date();
    if (!stockAlreadyBooked) po.lines.forEach(function (l) {
      var v = variants.filter(function (x) {
        return x.productId === l.productId && x.size === l.size;
      })[0];
      if (!v) return;
      /* Lands in the back, not on the wall. A delivery arrives at the door in
         boxes; somebody still has to carry it out front, and that carry is a
         transfer the system should see. */
      DB.moveStock(v, INTAKE_WH, l.qty, {
        date: now, type: 'received',
        note: 'Received on ' + po.id, user: 'Maher Odeh'
      });
    });
    var sup = DB.supplier(po.supplierId);
    if (sup) sup.outstanding += DB.poTotal(po);
    po.status = 'received';
    po.receivedAt = now;
    po.warehouseId = INTAKE_WH;
    return true;
  },

  supplier: function (id) { return suppliers.filter(function (s) { return s.id === id; })[0]; },

  /* Best guess at who supplies a product, from the supplier category. Falls
     back to the largest supplier rather than nothing, so Reorder always has
     somewhere to send the order. */
  supplierFor: function (product) {
    if (!product) return suppliers[0];
    var byType = {
      sneakers: 'Sneakers import', tshirts: 'T-shirts & blanks', jeans: 'Jeans',
      jerseys: 'Jerseys', boots: 'Boots', jackets: 'T-shirts & blanks',
      shirts: 'T-shirts & blanks', crocs: 'Sneakers import'
    };
    var want = byType[product.type];
    return suppliers.filter(function (s) { return s.category === want; })[0] || suppliers[0];
  },

  /* ---- duplicate guard ---------------------------------------------------
     Catches a second SKU being created for a shoe that is already in the
     catalogue. That is how a tidy system quietly becomes a mess again: "Nike
     Air Force 1", "Nike AirForce 1 '07", "nike air force one" as three
     separate products, each with its own stock, none of them right.

     Token overlap rather than string distance, because the real duplicates
     differ by word order, punctuation and a stray year — not by typos. */
  normaliseName: function (s) {
    return String(s || '')
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
      .trim();
  },

  nameTokens: function (s) {
    /* Words that carry no identity — dropping them stops "OG Tee" matching
       every tee in the shop on the strength of the word "tee". */
    var noise = { the: 1, and: 1, with: 1, og: 1, edition: 1, ed: 1, new: 1 };
    return DB.normaliseName(s).split(' ').filter(function (w) {
      return w.length > 1 && !noise[w];
    });
  },

  /* Jaccard overlap, 0..1. Symmetric, so adding A when B exists scores the
     same as the reverse. */
  nameSimilarity: function (a, b) {
    var ta = DB.nameTokens(a), tb = DB.nameTokens(b);
    if (!ta.length || !tb.length) return 0;
    var setB = {}, shared = 0;
    tb.forEach(function (w) { setB[w] = 1; });
    ta.forEach(function (w) { if (setB[w]) { shared++; setB[w] = 0; } });
    return shared / (ta.length + tb.length - shared);
  },

  /* Anything worth warning about, best match first. 0.5 is deliberately
     forgiving: a false warning costs one click, a missed duplicate costs a
     split stock count that nobody notices for months. */
  similarProducts: function (name, threshold) {
    threshold = threshold || 0.5;
    return products.map(function (p) {
      return { product: p, score: DB.nameSimilarity(name, p.name) };
    }).filter(function (x) { return x.score >= threshold; })
      .sort(function (a, b) { return b.score - a.score; });
  },

  /* A blank kit line, for the OG-side line editor. Shares the same counter as
     the seed data so no two lines can ever collide on id. */
  newKitLine: function (f) {
    f = f || {};
    return { id: 'L' + pad(++_lineSeq, 3),
             club: f.club || '', clubAr: f.clubAr || '',
             print: f.print || null, number: f.number || null,
             size: f.size || 'L', qty: f.qty || 1,
             price: f.price || CONFIG.KIT_PRINT_PRICE };
  },

  /* The one way a print job is created, so every job — seeded or made live
     at the till — has a size breakdown and a stamped history. Pass `lines`
     and it becomes a kit job whose qty, cost and sizes derive from them,
     exactly like the seeded kit jobs. */
  newPrintJob: function (f) {
    var now = new Date();
    var lines = f.lines && f.lines.length ? f.lines : null;
    var job = {
      id: DB.nextPrintId(),
      customer: f.customer,
      phone: f.phone,
      design: f.design,
      kind: lines ? 'kit' : 'bulk',
      lines: lines,
      qty: f.qty,
      priority: f.priority || 'normal',
      deadline: f.deadline,
      stage: 'design',
      price: f.price,
      cost: f.cost,
      created: now,
      sizes: f.sizes || splitSizes(f.qty),
      history: [{ stage: 'design', at: now }],
      /* Born unsent — an order the printer has not yet agreed to. Callers
         that want it on Yalla's desk immediately call DB.sendOrder right
         after (the till does, once every picked piece has its name). */
      order: { state: 'draft', sentAt: null, respondedAt: null, promisedAt: null, note: '' }
    };
    if (lines) DB.resyncKit(job);
    printJobs.push(job);

    /* The server hands out its own job number from the highest that
       exists, so the id above is a local guess. The reload after the write
       replaces this whole array with what was actually recorded, which is
       the only copy anybody quotes down the phone. */
    pushPartner(function () {
      return Shop.newPrintJob({
        customer: job.customer, phone: job.phone, design: job.design,
        kind: job.kind, qty: job.qty, priority: job.priority,
        deadline: job.deadline ? new Date(job.deadline).toISOString() : null,
        price: job.price, cost: job.cost,
        lines: (job.lines || []).map(function (l) {
          return {
            clubCode: clubCodeFor(l.club), printName: l.print,
            number: l.number, size: l.size, qty: l.qty, unitCost: l.price
          };
        })
      });
    }, typeof t === 'function' ? t('print_title') : 'Print jobs');
    return job;
  },

  /* Re-derive a kit job's totals from its lines. Called after any line edit,
     so the job header can never drift away from the lines beneath it. */
  resyncKit: function (job) {
    if (job.kind !== 'kit' || !job.lines) return;
    job.qty = job.lines.reduce(function (a, l) { return a + l.qty; }, 0);
    job.cost = job.lines.reduce(function (a, l) { return a + l.qty * l.price; }, 0);
    job.sizes = {};
    TEE_SIZES.forEach(function (sz) {
      var n = job.lines.reduce(function (a, l) { return a + (l.size === sz ? l.qty : 0); }, 0);
      if (n) job.sizes[sz] = n;
    });
  },

  nextPrintId: function () {
    var max = 1035;
    printJobs.forEach(function (j) { var n = parseInt(j.id.split('-')[1], 10); if (n > max) max = n; });
    return 'P-' + (max + 1);
  },

  logMovement: function (m) {
    m.id = 'MV-' + pad(++mvSeq, 4);
    stockMovements.unshift(m);
  },

  /* ==================================================== HYDRATION ==========

     Replace the seeded story with what the server actually holds.

     THE PROBLEM THIS SOLVES. The till used to draw its catalogue from the
     generator above while the server priced and recorded sales from its own
     `products` table. Nothing kept the two in step, because nothing connected
     them. Charging a basket died on `unknown item`, and the one SKU that
     happened to exist on both sides sold at the wrong price under the wrong
     name and printed an ordinary-looking receipt. Two catalogues is one
     catalogue that is wrong, and you cannot tell which.

     So: in live mode the app shows the server's data, in demo mode it shows
     the seeded story, and never a mix. A mix is what caused the bug.

     WHY IT MUTATES THE ARRAYS RATHER THAN REASSIGNING THEM. `products`,
     `variants`, `customers`, `sales` and `stockMovements` are closed over by
     roughly a hundred and seventy read sites, and handed out by reference as
     DB.products and friends. Assigning a new array here would leave every one
     of them pointing at the old one. Emptying and refilling keeps every
     existing caller correct without touching any of them.

     Anything the server has no table for — print jobs, suppliers, employees,
     shifts, expenses, debts, the Yalla Wear side — is deliberately left alone.
     Those subsystems have no server half yet, and silently blanking them would
     replace working screens with empty ones. */
  live: false,

  hydrate: function (payload) {
    var rate = Number(payload.rate) || CONFIG.EXCHANGE_RATE;
    var cfg = payload.config || {};

    /* ---- settings ------------------------------------------------------
       The server's config table wins over the constants at the top of this
       file. Two copies of the stock threshold is one copy that is wrong, and
       the wrong one is always the one on screen. */
    function num(key, fallback) {
      var v = Number(cfg[key]);
      return isFinite(v) && cfg[key] !== undefined && cfg[key] !== null ? v : fallback;
    }

    CONFIG.EXCHANGE_RATE           = rate;
    CONFIG.STOCK_LOW               = num('stock.low', CONFIG.STOCK_LOW);
    CONFIG.STOCK_CRITICAL          = num('stock.critical', CONFIG.STOCK_CRITICAL);
    CONFIG.LOYALTY_POINTS_PER_1000 = num('loyalty.points_per_1000', CONFIG.LOYALTY_POINTS_PER_1000);
    CONFIG.LOYALTY_POINT_VALUE     = num('loyalty.point_value', CONFIG.LOYALTY_POINT_VALUE);
    CONFIG.TIER_SILVER             = num('loyalty.tier_silver', CONFIG.TIER_SILVER);
    CONFIG.TIER_GOLD               = num('loyalty.tier_gold', CONFIG.TIER_GOLD);
    CONFIG.MAX_DISCOUNT_PCT        = num('sale.max_discount_pct', CONFIG.MAX_DISCOUNT_PCT);
    if (cfg['shop.name']) CONFIG.SHOP_NAME = cfg['shop.name'];
    if (cfg['shop.address']) CONFIG.SHOP_ADDRESS = cfg['shop.address'];
    if (cfg['shop.city']) CONFIG.SHOP_CITY = cfg['shop.city'];
    if (cfg['shop.branch_name']) CONFIG.SHOP_BRANCH = cfg['shop.branch_name'];
    if (cfg['shop.phone']) CONFIG.SHOP_PHONE = cfg['shop.phone'];

    /* ---- the 80mm receipt ------------------------------------------------ */
    function bool(key, fallback) {
      return cfg[key] === undefined ? fallback : cfg[key] === '1';
    }
    if (cfg['receipt.printer_host'] !== undefined) CONFIG.RECEIPT_PRINTER_HOST = cfg['receipt.printer_host'];
    CONFIG.RECEIPT_PRINTER_PORT = num('receipt.printer_port', CONFIG.RECEIPT_PRINTER_PORT);
    CONFIG.RECEIPT_WIDTH_DOTS   = num('receipt.width_dots', CONFIG.RECEIPT_WIDTH_DOTS);
    if (cfg['receipt.transport'] !== undefined) CONFIG.RECEIPT_TRANSPORT = cfg['receipt.transport'];
    if (cfg['receipt.printer_share'] !== undefined) CONFIG.RECEIPT_PRINTER_SHARE = cfg['receipt.printer_share'];
    if (cfg['receipt.instagram'] !== undefined) CONFIG.RECEIPT_INSTAGRAM = cfg['receipt.instagram'];
    if (cfg['receipt.telegram'] !== undefined) CONFIG.RECEIPT_TELEGRAM = cfg['receipt.telegram'];
    if (cfg['receipt.maps_url'] !== undefined) CONFIG.RECEIPT_MAPS_URL = cfg['receipt.maps_url'];
    if (cfg['receipt.footer_ar'] !== undefined) CONFIG.RECEIPT_FOOTER_AR = cfg['receipt.footer_ar'];
    if (cfg['receipt.footer_en'] !== undefined) CONFIG.RECEIPT_FOOTER_EN = cfg['receipt.footer_en'];
    if (cfg['receipt.policy_ar'] !== undefined) CONFIG.RECEIPT_POLICY_AR = cfg['receipt.policy_ar'];
    if (cfg['receipt.policy_en'] !== undefined) CONFIG.RECEIPT_POLICY_EN = cfg['receipt.policy_en'];
    CONFIG.RECEIPT_SHOW_BARCODE = bool('receipt.show_barcode', CONFIG.RECEIPT_SHOW_BARCODE);
    CONFIG.RECEIPT_SHOW_LOYALTY = bool('receipt.show_loyalty', CONFIG.RECEIPT_SHOW_LOYALTY);
    CONFIG.RECEIPT_AUTO_PRINT   = bool('receipt.auto_print', CONFIG.RECEIPT_AUTO_PRINT);
    CONFIG.RECEIPT_CONFIRM_PRINT = bool('receipt.confirm_print', CONFIG.RECEIPT_CONFIRM_PRINT);
    CONFIG.RECEIPT_COPIES       = num('receipt.copies', CONFIG.RECEIPT_COPIES);
    if (cfg['receipt.cut_mode'] !== undefined) CONFIG.RECEIPT_CUT_MODE = cfg['receipt.cut_mode'];
    if (cfg['receipt.ink'] !== undefined) CONFIG.RECEIPT_INK = cfg['receipt.ink'];

    /* ---- thermal product labels ------------------------------------------- */
    if (cfg['label.default_preset'] !== undefined) CONFIG.LABEL_DEFAULT_PRESET = cfg['label.default_preset'];
    if (cfg['label.stations'] !== undefined) CONFIG.LABEL_STATIONS = cfg['label.stations'];
    if (cfg['label.transport'] !== undefined) CONFIG.LABEL_TRANSPORT = cfg['label.transport'];
    if (cfg['label.printer_host'] !== undefined) CONFIG.LABEL_PRINTER_HOST = cfg['label.printer_host'];
    CONFIG.LABEL_PRINTER_PORT = num('label.printer_port', CONFIG.LABEL_PRINTER_PORT);
    CONFIG.LABEL_DENSITY = num('label.density', CONFIG.LABEL_DENSITY);
    CONFIG.LABEL_GAP_MM = num('label.gap_mm', CONFIG.LABEL_GAP_MM);
    CONFIG.LABEL_MAX_BATCH = num('label.max_batch', CONFIG.LABEL_MAX_BATCH);
    if (cfg['label.presets'] !== undefined) {
      try { CONFIG.LABEL_PRESETS = JSON.parse(cfg['label.presets']); } catch (e) { /* keep the demo defaults */ }
    }

    /* ---- the two places -------------------------------------------------- */
    if (payload.warehouses && payload.warehouses.length) {
      WAREHOUSES.length = 0;
      payload.warehouses.forEach(function (w) {
        WAREHOUSES.push({ id: w.id, name: w.name, nameAr: w.name_ar, kind: w.kind });
      });
      /* Both the var and the property: DB.defaultWh was copied by value when
         this object was built, so moving the var alone would leave every
         caller reading the old one. */
      if (cfg['shop.default_wh']) DEFAULT_WH = DB.defaultWh = cfg['shop.default_wh'];
      if (cfg['shop.intake_wh'])  INTAKE_WH  = DB.intakeWh  = cfg['shop.intake_wh'];
    }

    /* Prices are stored in the currency the goods are actually priced in —
       the shop genuinely buys some things in dollars — but every screen here
       reads one number in the base currency. Converted at the SAME rate the
       server would use, so the figure on the shelf edge and the figure on the
       receipt cannot drift apart. The source is kept so the price editor can
       hand back what it was given rather than a round-tripped approximation. */
    function toBase(minor, cur) {
      if (!cur || cur === CONFIG.BASE_CURRENCY) return minor;
      if (cur === 'USD') return Math.round(minor / 100 * rate);
      return minor;
    }

    /* ---- products and their sizes ---------------------------------------- */
    products.length = 0;
    variants.length = 0;

    (payload.products || []).forEach(function (p) {
      products.push({
        id: p.id,
        name: p.name,
        type: p.type,
        brand: p.brand || '',
        madeIn: p.made_in || '',
        image: { bg: p.image_bg || '#4A4A52', initials: p.image_initials || '??', src: null },
        colorway: p.colorway || '',
        costPrice: toBase(p.cost_price, p.currency),
        sellingPrice: toBase(p.selling_price, p.currency),
        /* Kept beside the converted figures rather than instead of them: a
           dollar-priced shoe edited in Settings must save back as dollars, or
           one round trip through the editor silently repegs it to today's
           rate. */
        srcCurrency: p.currency,
        srcCostPrice: p.cost_price,
        srcSellingPrice: p.selling_price,
        shelfZone: p.shelf_zone || '',
        hidden: !!p.hidden,
        /* One flag, not two. The app grew `hidden` and `archived` meaning the
           same thing in different screens; the server has one column, and it
           is right. Mapped to both so the products screen's "Archived" filter
           shows exactly what the shop has taken off sale — leaving `archived`
           false would put discontinued goods back in the main list. */
        archived: !!p.hidden,
        demo: !!p.demo,
        /* Never sold falls back to how long the shop has had it, which is the
           honest reading of "nothing has moved" and keeps the dead-stock
           alert pointing at a real row instead of at nothing. */
        lastSoldDaysAgo: DB.daysSince(p.last_sold_at || p.created_at)
      });

      (p.variants || []).forEach(function (v) {
        var wh = {};
        WAREHOUSES.forEach(function (w) {
          /* Every location gets a key even when it holds nothing. moveStock
             sums across all of them, and one missing key makes the total
             NaN — which renders as an empty cell rather than an error. */
          wh[w.id] = Number((v.wh || {})[w.id]) || 0;
        });

        variants.push({
          sku: v.sku,
          productId: v.product_id,
          size: v.size,
          color: v.color || '',
          barcode: v.barcode || '',
          /* The numeric-only code migration 010 created for the label printer,
             because the sku ('OG-036-XXL') is expensive in Code 128 — 54.4mm
             of bars at three dots a module, which does not fit a 60mm label
             once the quiet zone and the safe margin are honoured. Six digits
             pack into Code Set C at 25.5mm.

             It was already in the API payload and simply never mapped, which
             is why DB.variantByLabelCode could not match anything it was
             given unless the attach-code action had set it by hand. */
          labelCode: v.label_code || '',
          qty: Number(v.total) || 0,
          shelf: v.shelf || '',
          wh: wh
        });
      });
    });

    /* ---- customers -------------------------------------------------------
       totalSpent and lastPurchaseDate come from the server, where they are
       derived from the sales table rather than stored. A stored total is a
       second source of truth for money, and the first void makes it wrong. */
    customers.length = 0;
    (payload.customers || []).forEach(function (c) {
      customers.push({
        id: c.id,
        name: c.name,
        phone: c.phone || '',
        city: c.city || '',
        source: c.source || 'in-store',
        address: c.address || '',
        note: c.note || '',
        loyaltyPoints: Number(c.loyalty_points) || 0,
        totalSpent: Number(c.total_spent) || 0,
        lastPurchaseDate: c.last_purchase_at ? new Date(c.last_purchase_at) : null,
        archived: !!c.archived,
        demo: !!c.demo,
        history: []
      });
    });

    var custById = {};
    customers.forEach(function (c) { custById[c.id] = c; });

    /* ---- sales ------------------------------------------------------------
       Hydrated even though the reported bug was about the catalogue, because
       leaving them seeded is not an option: every seeded invoice references
       product ids and SKUs that now mean something else entirely. The
       dashboard would show invented revenue itemised against real goods. */
    sales.length = 0;
    /* Every credit sale still carrying a balance, however old, folded in
       before the mapping so it gets exactly the same shape.

       The debt book is derived from this array, and this array is the last
       200 sales — so an unpaid debt older than that quietly stopped being
       owed, which is the worst thing this screen could do. The server sends
       them unbounded; deduped on id because a recent one is in both. */
    var srcSales = (payload.sales || []).slice();
    if (payload.money && payload.money.creditSales) {
      var have = {};
      srcSales.forEach(function (s) { have[s.id] = true; });
      payload.money.creditSales.forEach(function (s) { if (!have[s.id]) srcSales.push(s); });
    }

    srcSales.forEach(function (s) {
      var sale = {
        id: s.id,
        date: new Date(s.at),
        customerId: s.customer_id,
        customerName: s.customer_name || t('walk_in'),
        items: (s.items || []).map(function (it) {
          return {
            sku: it.sku, productId: it.product_id, name: it.name,
            type: (DB.product(it.product_id) || {}).type || '',
            size: it.size, qty: it.qty,
            unitPrice: it.unit_price,
            /* Absent for anyone without cost.read — the server strips it from
               the nested items, not just the header. Left undefined rather
               than zeroed, so a profit figure computed from it comes out
               obviously broken instead of quietly flattering. */
            unitCost: it.unit_cost
          };
        }),
        subtotal: s.subtotal,
        discount: s.discount,
        pointsUsed: Number(s.points_used) || 0,
        couponCode: null,
        total: s.total,
        payment: s.payment,
        txnRef: s.txn_ref || null,
        warehouseId: s.wh_id,
        cashier: s.cashier_name || '',
        /* Which drawer it belongs to. This was hardcoded null, so the stamp
           the till puts on every sale died on arrival and the shift summary
           had nothing to count — one line, and the whole till reconciliation
           rested on it. */
        shiftId: s.shift_id || null,
        publicToken: s.public_token || null,
        fxRate: s.fx_rate || rate
      };
      sales.push(sale);
      if (custById[sale.customerId]) custById[sale.customerId].history.push(sale.id);
    });

    /* ---- the movement log -------------------------------------------------
       Same reasoning as sales: the seeded log is a trail for SKUs that no
       longer exist. */
    stockMovements.length = 0;
    mvSeq = 0;
    (payload.movements || []).forEach(function (m) {
      if (m.id > mvSeq) mvSeq = m.id;
      stockMovements.push({
        id: 'MV-' + pad(m.id, 4),
        date: new Date(m.at),
        sku: m.sku,
        productId: m.product_id,
        size: m.size || '',
        wh: m.wh_id,
        type: m.type,
        delta: m.delta,
        balance: m.balance,
        note: m.note || '',
        user: m.user_name || t('admin')
      });
    });

    /* Who sold what. Recomputed rather than left at the seeded figures, which
       were rolled up from invoices that no longer exist. */
    employees.forEach(function (e) { e.sales = 0; });
    sales.forEach(function (s) {
      var e = employees.filter(function (x) { return x.name === s.cashier; })[0];
      if (e) e.sales += s.total;
    });

    /* ---- the partner half ------------------------------------------------
       Only when the server sent it. A payload without a partner key means
       the caller could not read it — a cashier with no print.read, say — and
       replacing the arrays with nothing would empty screens she is allowed to
       see rather than leaving them as they were.

       The server speaks snake_case and stores dates as text; these screens
       were written against camelCase and real Dates. Translating here, once,
       is what lets sixteen call sites stay exactly as they are. */
    if (payload.partner) hydratePartner(payload.partner);
    if (payload.money) hydrateMoney(payload.money);

    /* Their own lists on their own gates. An empty array here really does
       mean none — `want` already resolved a refusal to an empty list. */
    if (payload.suppliers) {
      suppliers.length = 0;
      payload.suppliers.forEach(function (x) {
        suppliers.push({
          id: x.id, name: x.name, contact: x.contact, category: x.category,
          outstanding: x.outstanding, totalPurchased: x.total_purchased,
          dueDate: x.due_date ? new Date(x.due_date) : null,
          lastPayment: x.last_payment ? new Date(x.last_payment) : null
        });
      });
    }

    if (payload.employees) {
      employees.length = 0;
      payload.employees.forEach(function (x) {
        employees.push({
          id: x.id, name: x.name, role: x.role, salary: x.salary,
          nextPayment: x.next_payment ? new Date(x.next_payment) : null,
          since: x.since, phone: x.phone, sales: 0
        });
      });
    }

    if (payload.stockCounts) {
      stockCounts.length = 0;
      payload.stockCounts.forEach(function (c) {
        stockCounts.push({
          id: c.id, whId: c.wh_id, scope: c.scope, status: c.status,
          posted: c.status === 'posted',
          started: c.started_at ? new Date(c.started_at) : null,
          finished: c.posted_at ? new Date(c.posted_at) : null,
          by: c.user_name || '',
          pieces: c.pieces, applied: c.variance, lines: c.lines || []
        });
      });
    }

    /* The bell is computed on the server now — per account, so supplier debt
       and payroll only reach the people allowed to see them, and the read
       state follows the person rather than the machine. */
    if (payload.notifications) {
      notifications.length = 0;
      payload.notifications.forEach(function (n) { notifications.push(n); });
    }

    purchaseOrders.length = 0;
    (payload.purchaseOrders || []).forEach(function (o) {
      purchaseOrders.push({
        id: o.id,
        supplierId: o.supplier_id,
        supplierName: o.supplier_name,
        status: o.status,
        note: o.note || '',
        whId: o.wh_id,
        created: o.created_at ? new Date(o.created_at) : null,
        sentAt: o.sent_at ? new Date(o.sent_at) : null,
        receivedAt: o.received_at ? new Date(o.received_at) : null,
        lines: (o.lines || []).map(function (l) {
          return {
            sku: l.sku, productId: l.product_id, size: l.size,
            name: l.product_name, qty: l.qty,
            /* absent for anyone without cost.read — the server strips it */
            cost: l.unit_cost, received: l.received_qty
          };
        })
      });
    });

    DB.live = true;
    return DB;
  }
};

/* Push a partner change the server has not heard about yet.

   The local model has already moved, so the board does not sit still for a
   round trip while somebody drags a card. The server enforces the same
   rules, so a refusal means the local guess was wrong rather than that
   something broke — reloading puts the truth back on screen and the toast
   says which rule it was. Both paths reload: after a refusal because the
   screen is now lying, after a success because the server may have added
   something of its own, like the message a stage change posts. */
/* A kit line carries the club's NAME because that is what the sheet shows;
   the server keys on its code. One lookup rather than storing both. */
function clubCodeFor(name) {
  var keys = Object.keys(CLUBS);
  for (var i = 0; i < keys.length; i++) {
    if (CLUBS[keys[i]][0] === name || CLUBS[keys[i]][1] === name) return keys[i];
  }
  return null;
}

/* `quiet` skips the reload on success, for a write whose only effect is one
   the browser has already applied identically — marking a thread read being
   the case. Opening a thread should not cost a full refetch of the shop, and
   there is nothing the server would send back that is not already on screen.
   A failure still reloads: then the screen really is lying. */
function pushPartner(send, title, quiet) {
  if (!DB.live || typeof Shop === 'undefined' || !Shop.live()) return;
  send()
    .then(function () { return quiet ? null : Shop.reload(); })
    .catch(function (err) {
      if (typeof toast === 'function') {
        toast(title, (typeof API !== 'undefined' && API.friendly) ? API.friendly(err)
                                                                  : String(err.message || err),
              'err', 6000);
      }
      Shop.reload();
    });
}

/* ---- the drawer ------------------------------------------------------
   Shifts, expenses, and what customers have paid against what they owe.
   Guarded because a payload without `money` means the account could not
   read it, not that the shop has no takings — blanking the screens on a
   permission would read as a shop with an empty till. */
function hydrateMoney(m) {
  var date = function (v) { return v ? new Date(v) : null; };

  shifts.length = 0;
  (m.shifts || []).forEach(function (s) {
    shifts.push({
      id: s.id, user: s.user_name, userId: s.user_id, whId: s.wh_id,
      float: s.float_amount,
      openedAt: date(s.opened_at), closedAt: date(s.closed_at),
      /* One fact, one field: closed is derived from closedAt rather than
         stored beside it, so the two can never disagree. */
      closed: !!s.closed_at,
      counted: s.counted, expected: s.expected, diff: s.diff,
      sales: s.sales, collected: s.collected, paidOut: s.paidOut,
      note: s.note || ''
    });
  });

  expenses.length = 0;
  (m.expenses || []).forEach(function (e) {
    expenses.push({
      id: e.id, at: date(e.at), category: e.category, amount: e.amount,
      method: e.method, note: e.note || '', shiftId: e.shift_id
    });
  });

  debtPayments.length = 0;
  (m.debtPayments || []).forEach(function (p) {
    debtPayments.push({
      id: p.id, saleId: p.sale_id, at: date(p.at), amount: p.amount,
      method: p.method, shiftId: p.shift_id
    });
  });


  if (m.categories && m.categories.length) {
    EXPENSE_CATEGORIES.length = 0;
    m.categories.forEach(function (c) { EXPENSE_CATEGORIES.push(c); });
  }
}

function hydratePartner(p) {
  var date = function (v) { return v ? new Date(v) : null; };

  /* ---- clubs ----------------------------------------------------------
     Shaped as a lookup, not a list, because every kit line reaches for one
     by code. */
  if (p.clubs) {
    Object.keys(CLUBS).forEach(function (k) { delete CLUBS[k]; });
    p.clubs.forEach(function (c) { CLUBS[c.code] = [c.name, c.name_ar || c.name]; });
  }

  if (p.jobs) {
    printJobs.length = 0;
    p.jobs.forEach(function (j) {
      var lines = (j.lines || []).map(function (l) {
        var club = CLUBS[l.club_code] || [l.club_code || '', l.club_code || ''];
        return {
          id: 'L' + l.id, club: club[0], clubAr: club[1],
          print: l.print_name,          /* null still means TO BE CONFIRMED */
          number: l.number, size: l.size, qty: l.qty,
          /* Absent for anyone without cost.read — the server strips it from
             the response rather than trusting us not to draw it. */
          price: l.unit_cost
        };
      });

      var job = {
        id: j.id, customer: j.customer, phone: j.phone, design: j.design,
        kind: j.kind, qty: j.qty, priority: j.priority, stage: j.stage,
        price: j.price, cost: j.cost,
        deadline: date(j.deadline), created: date(j.created_at),
        saleId: j.sale_id || null,
        lines: j.kind === 'kit' ? lines : null,
        history: (j.history || []).map(function (h) {
          return { stage: h.stage, at: date(h.at), by: h.by_side };
        }),
        order: {
          state: j.order_state || 'draft',
          sentAt: date(j.order_sent_at),
          respondedAt: date(j.order_responded_at),
          promisedAt: date(j.order_promised_at),
          note: j.order_note || ''
        }
      };

      /* The size chips, in S · M · L · XL order however the order was taken.
         Derived from the lines for a kit and from the curve for a bulk run,
         exactly as the seed builder did. */
      if (job.kind === 'kit') {
        job.sizes = {};
        TEE_SIZES.forEach(function (sz) {
          var n = lines.reduce(function (a, l) { return a + (l.size === sz ? l.qty : 0); }, 0);
          if (n) job.sizes[sz] = n;
        });
      } else {
        job.sizes = splitSizes(job.qty);
      }

      printJobs.push(job);
    });
  }

  if (p.invoices) {
    partnerInvoices.length = 0;
    p.invoices.forEach(function (v) {
      partnerInvoices.push({
        id: v.id, issued: date(v.issued), due: date(v.due),
        note: v.note || '', refs: v.refs || [],
        payments: (v.payments || []).map(function (x) {
          return { at: date(x.at), amount: x.amount, method: x.method };
        })
      });
    });
  }

  if (p.messages) {
    jobMessages.length = 0;
    p.messages.forEach(function (m) {
      jobMessages.push({
        id: 'M' + m.id, jobId: m.job_id, invoiceId: m.invoice_id,
        from: m.from_side, kind: m.kind, reason: m.reason,
        text: m.body, at: date(m.at),
        readOg: !!m.read_og, readYl: !!m.read_yl
      });
    });
  }

  /* suppliers and employees are NOT here any more — they have their own
     requests on their own permissions. Inside this bundle they were gated
     on print.read, so a manager without it saw an empty payroll and empty
     supplier balances with nothing to say why. */

  if (p.waMessages) {
    waMessages.length = 0;
    p.waMessages.forEach(function (m) {
      waMessages.push({
        id: m.id, at: date(m.at), phone: m.phone, text: m.body,
        kind: m.kind, refType: m.ref_type, refId: m.ref_id
      });
    });
  }
}
