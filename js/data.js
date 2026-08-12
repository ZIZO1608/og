/* ==========================================================================
   OG SYSTEM — MOCK DATA
   --------------------------------------------------------------------------
   Everything the demo displays comes from this file. It is safe to edit any
   value here live during a meeting; the whole app re-renders from it.
   Sections, in order:
     1. CONFIG          — exchange rate, loyalty rules, thresholds
     2. CATALOGUE       — 24 products + their per-size variants (stock lives here)
     3. PEOPLE          — 40 customers, 7 employees, 6 suppliers
     4. SALES           — 120 invoices across the last 6 months
     5. PRINT JOBS      — 12 t-shirt printing jobs with Yalla Wear
     6. MOVEMENTS       — warehouse stock movement log
     7. MISC            — storefront orders, notifications
     8. HELPERS         — lookup functions used by the rest of the app
   ========================================================================== */

/* ---------------------------------------------------------------- 1. CONFIG */

var CONFIG = {
  EXCHANGE_RATE: 13000,        // 1 USD = 13,000 SYP   <-- edit this live
  BASE_CURRENCY: 'SYP',

  LOYALTY_POINTS_PER_1000: 1,  // 1 point for every 1,000 SYP spent
  LOYALTY_POINT_VALUE: 50,     // 1 point redeems for 50 SYP (500 pts = 25,000)

  /* Tier cut-offs, in points. Lifetime spend here runs 2M–20M SYP, which is
     2,000–20,000 points, so the thresholds have to sit in that range or every
     customer ends up Gold. */
  TIER_SILVER: 6000,
  TIER_GOLD: 12000,

  STOCK_CRITICAL: 3,           // <= this many pieces = Critical
  STOCK_LOW: 10,               // <= this many pieces = Low

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

  SHOP_NAME: 'OG System',
  SHOP_TAGLINE: 'Sneakers & Streetwear',
  SHOP_ADDRESS: 'Al-Hamra St, Damascus — 0956 442 118',
  PRINT_PARTNER: 'Yalla Wear'
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
var PRODUCT_SEED = [
  ["Nike Air Force 1 '07",      'sneakers', 'Nike',        'Vietnam',   '#5B5B66', 'Triple White',   780000,  1250000, 'A', false],
  ['Nike Air Max 90',           'sneakers', 'Nike',        'Vietnam',   '#3E5C8A', 'Infrared',       860000,  1390000, 'A', false],
  ['Nike Dunk Low Panda',       'sneakers', 'Nike',        'China',     '#4A4A52', 'Black / White',  910000,  1490000, 'A', false],
  ['Adidas Samba OG',           'sneakers', 'Adidas',      'Indonesia', '#6B5B45', 'Core Black',     720000,  1180000, 'A', false],
  ['Adidas Campus 00s',         'sneakers', 'Adidas',      'Indonesia', '#6455A0', 'Dark Green',     690000,  1120000, 'A', false],
  ['New Balance 550',           'sneakers', 'New Balance', 'Vietnam',   '#7E8B99', 'White / Green',  830000,  1340000, 'B', false],
  ['Converse Chuck 70 Hi',      'sneakers', 'Converse',    'Vietnam',   '#8E3B3B', 'Egret',          540000,   890000, 'B', false],
  ['Timberland 6" Premium',     'boots',    'Timberland',  'Dominican', '#B5822F', 'Wheat Nubuck',  1320000,  2050000, 'C', false],
  ['Dr. Martens 1460',          'boots',    'Dr. Martens', 'Thailand',  '#7A2B28', 'Cherry Red',    1180000,  1850000, 'C', false],
  ['CAT Colorado Boot',         'boots',    'Caterpillar', 'Vietnam',   '#8A6E3A', 'Honey Reset',    940000,  1480000, 'C', false],
  ['OG Heavyweight Tee',        'tshirts',  'OG',          'Syria',     '#4A4A52', 'Washed Black',   105000,   225000, 'D', false],
  ['OG Box Logo Tee',           'tshirts',  'OG',          'Syria',     '#A8946E', 'Sand',           112000,   245000, 'D', false],
  ['Stussy Basic Tee',          'tshirts',  'Stussy',      'Turkey',    '#3A5478', 'Navy',           148000,   295000, 'D', false],
  ['Carhartt WIP Pocket Tee',   'tshirts',  'Carhartt',    'Turkey',    '#8A7658', 'Hamilton Brown', 160000,   320000, 'D', false],
  ['Nike Sportswear Club Tee',  'tshirts',  'Nike',        'Egypt',     '#A33636', 'University Red',  95000,   198000, 'D', true ],
  ["Levi's 501 Original",       'jeans',    "Levi's",      'Egypt',     '#4A6A8F', 'Mid Stone',      340000,   620000, 'E', false],
  ["Levi's 511 Slim",           'jeans',    "Levi's",      'Egypt',     '#35496B', 'Rinse Dark',     325000,   595000, 'E', false],
  ['OG Baggy Denim',            'jeans',    'OG',          'Syria',     '#6E8299', 'Light Wash',     235000,   445000, 'E', false],
  ['Real Madrid Home 24/25',    'jerseys',  'Adidas',      'Thailand',  '#9CA3AF', 'White / Gold',   215000,   420000, 'F', false],
  ['Barcelona Away 24/25',      'jerseys',  'Nike',        'Thailand',  '#C9A227', 'Yellow',         205000,   405000, 'F', false],
  ['Al-Ittihad Home 24/25',     'jerseys',  'Nike',        'Thailand',  '#2F5744', 'Black / Yellow', 168000,   345000, 'F', true ],
  ['Crocs Classic Clog',        'crocs',    'Crocs',       'China',     '#3E7A9E', 'Bijou Blue',     245000,   430000, 'G', false],
  ['OG Oxford Shirt',           'shirts',   'OG',          'Syria',     '#7E92A3', 'Powder Blue',    186000,   349000, 'H', true ],
  ['OG Denim Jacket',           'jackets',  'OG',          'Syria',     '#5A748C', 'Stone Wash',     418000,   785000, 'B', false]
];

var products = PRODUCT_SEED.map(function (p, i) {
  var words = p[0].replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
  var initials = (words[0][0] + (words[1] ? words[1][0] : words[0][1] || '')).toUpperCase();
  return {
    id: i + 1,
    name: p[0],
    type: p[1],
    brand: p[2],
    madeIn: p[3],
    image: { bg: p[4], initials: initials },   // solid colour placeholder block
    colorway: p[5],
    costPrice: p[6],
    sellingPrice: p[7],
    shelfZone: p[8],
    hidden: p[9],
    lastSoldDaysAgo: 0                          // filled in after sales are built
  };
});

/* Products that carry a "size gap": healthy total stock, zero in the sizes
   customers actually ask for. This is one of the headline insights in the pitch. */
var SIZE_GAP = {
  1:  ['42', '43'],      // Air Force 1 — the two sizes everyone wants
  11: ['M', 'L'],        // OG Heavyweight Tee
  16: ['32', '34']       // Levi's 501
};

var variants = [];
products.forEach(function (p) {
  var sizes = SIZE_SETS[p.type];
  var gap = SIZE_GAP[p.id] || [];
  sizes.forEach(function (size, idx) {
    var qty;
    if (gap.indexOf(size) > -1) {
      qty = 0;                               // the gap
    } else if (gap.length) {
      qty = ri(9, 22);                       // deliberately healthy around the gap
    } else {
      var roll = rnd();
      if (roll < 0.10)      qty = 0;         // out
      else if (roll < 0.24) qty = ri(1, 3);  // critical
      else if (roll < 0.42) qty = ri(4, 9);  // low
      else                  qty = ri(10, 34);// healthy
    }
    variants.push({
      sku: 'OG-' + pad(p.id, 3) + '-' + size,
      productId: p.id,
      size: size,
      color: p.colorway,
      /* 12-digit body + a real mod-10 check digit, so it scans. */
      barcode: (function (body) { return body + Codes.ean13Check(body); })(
        '621' + pad(p.id, 3) + pad(idx, 2) + pad(ri(0, 9999), 4)),
      qty: qty,
      shelf: p.shelfZone + '-' + pad(ri(1, 18), 2)
    });
  });
});

/* The barcode the presenter types on stage. Pinned to Air Force 1 / size 41. */
(function pinDemoBarcode() {
  var v = variants.filter(function (x) { return x.productId === 1 && x.size === '41'; })[0];
  if (v) { v.barcode = CONFIG.DEMO_BARCODE; if (v.qty < 4) v.qty = 12; }
})();

/* The dead-stock alert on the dashboard points at a real row. */
(function pinDeadStock() {
  variants.filter(function (v) { return v.productId === 24; }).forEach(function (v, i) {
    v.shelf = 'B-07';
    v.qty = [2, 4, 5, 4, 3][i] || 3;   // 18 pieces total, none moving
  });
})();

/* --------------------------------------------------------------- 3. PEOPLE */

var CITIES = ['Damascus', 'Aleppo', 'Homs', 'Latakia', 'Hama', 'Tartus', 'Deir ez-Zor'];
var CUSTOMER_SEED = [
  ['Ahmad Al-Khatib', 'm'], ['Layla Haddad', 'f'], ['Omar Sayegh', 'm'], ['Rana Mansour', 'f'],
  ['Bashar Nassar', 'm'], ['Nour Al-Ali', 'f'], ['Karim Deeb', 'm'], ['Hala Zaher', 'f'],
  ['Yousef Kanaan', 'm'], ['Maya Shaheen', 'f'], ['Tarek Jaber', 'm'], ['Salma Rifai', 'f'],
  ['Fadi Barakat', 'm'], ['Dina Halabi', 'f'], ['Samer Aswad', 'm'], ['Lina Tarabishi', 'f'],
  ['Hassan Murad', 'm'], ['Reem Qassab', 'f'], ['Ziad Sabbagh', 'm'], ['Joud Attar', 'f'],
  ['Malek Hamwi', 'm'], ['Sara Kurdi', 'f'], ['Anas Shami', 'm'], ['Yara Malki', 'f'],
  ['Rami Daoud', 'm'], ['Tala Ibrahim', 'f'], ['Wael Khoury', 'm'], ['Nada Sultan', 'f'],
  ['Bilal Ammar', 'm'], ['Rita Azzam', 'f'], ['Majd Rustom', 'm'], ['Aya Fares', 'f'],
  ['Ibrahim Saleh', 'm'], ['Ghina Aboud', 'f'], ['Nabil Homsi', 'm'], ['Rasha Debs', 'f'],
  ['Kinan Trad', 'm'], ['Farah Zeitoun', 'f'], ['Adel Baroudi', 'm'], ['Lama Sharif', 'f']
];

var customers = CUSTOMER_SEED.map(function (c, i) {
  return {
    id: i + 1,
    name: c[0],
    gender: c[1] === 'm' ? 'male' : 'female',
    phone: '+963 9' + pad(ri(30, 99), 2) + ' ' + pad(ri(0, 999), 3) + ' ' + pad(ri(0, 999), 3),
    city: pick(CITIES),
    source: chance(0.42) ? 'online' : 'in-store',
    loyaltyPoints: 0,
    totalSpent: 0,
    lastPurchaseDate: null,
    history: []               // invoice ids, newest first
  };
});

var suppliers = [
  { id: 1, name: 'Karam Trading',      contact: '+963 944 210 337', category: 'Sneakers import', outstanding: 41500000, dueDate: daysAhead(3),  lastPayment: daysAgo(26), totalPurchased: 318000000 },
  { id: 2, name: 'Yalla Wear',         contact: '+963 932 887 190', category: 'Printing partner', outstanding:  6250000, dueDate: daysAhead(11), lastPayment: daysAgo(9),  totalPurchased:  38400000 },
  { id: 3, name: 'Al-Sham Textiles',   contact: '+963 955 104 662', category: 'T-shirts & blanks', outstanding: 12800000, dueDate: daysAhead(18), lastPayment: daysAgo(14), totalPurchased:  96700000 },
  { id: 4, name: 'Damascus Denim Co.', contact: '+963 988 512 043', category: 'Jeans',            outstanding:        0, dueDate: daysAhead(30), lastPayment: daysAgo(4),  totalPurchased:  74200000 },
  { id: 5, name: 'Sport Line Import',  contact: '+963 941 663 528', category: 'Jerseys',          outstanding:  9400000, dueDate: daysAgo(2),   lastPayment: daysAgo(41), totalPurchased:  52900000 },
  { id: 6, name: 'Nour Leather',       contact: '+963 966 337 815', category: 'Boots',            outstanding: 23100000, dueDate: daysAhead(7),  lastPayment: daysAgo(19), totalPurchased: 141500000 }
];

var employees = [
  { id: 1, name: 'Hussam Fattal',  role: 'Manager',        salary: 9500000, nextPayment: daysAhead(6),  since: '2021-03-01', sales: 0, phone: '+963 933 118 204' },
  { id: 2, name: 'Lubna Kayali',   role: 'Cashier',        salary: 5200000, nextPayment: daysAhead(6),  since: '2022-08-15', sales: 0, phone: '+963 991 447 610' },
  { id: 3, name: 'Rawad Sheikh',   role: 'Cashier',        salary: 4900000, nextPayment: daysAhead(6),  since: '2023-01-09', sales: 0, phone: '+963 944 902 155' },
  { id: 4, name: 'Maher Odeh',     role: 'Warehouse',      salary: 5600000, nextPayment: daysAhead(6),  since: '2020-11-20', sales: 0, phone: '+963 955 613 728' },
  { id: 5, name: 'Sirine Bakri',   role: 'Warehouse',      salary: 5100000, nextPayment: daysAhead(6),  since: '2023-06-02', sales: 0, phone: '+963 932 550 461' },
  { id: 6, name: 'Talal Mroue',    role: 'Delivery',       salary: 4400000, nextPayment: daysAhead(13), since: '2024-02-11', sales: 0, phone: '+963 987 226 903' },
  { id: 7, name: 'Ghaith Sallum',  role: 'Social / Online', salary: 6100000, nextPayment: daysAhead(6), since: '2022-04-27', sales: 0, phone: '+963 941 809 372' }
];

var CASHIERS = ['Lubna Kayali', 'Rawad Sheikh', 'Hussam Fattal'];
var PAYMENT_METHODS = ['cash', 'sham', 'fuad', 'haram', 'card', 'cod'];
var PAYMENT_LABELS = {
  cash: 'Cash', sham: 'Sham Cash', fuad: 'Fuad', haram: 'Haram', card: 'Card', cod: 'Cash on delivery'
};

/* ---------------------------------------------------------------- 4. SALES */

var sales = [];
(function buildSales() {
  /* Weight every day of the last 6 months: weekends busier, business trending up. */
  var pool = [];
  for (var d = 179; d >= 0; d--) {
    var date = daysAgo(d);
    var dow = date.getDay();                       // 5 = Friday, 6 = Saturday
    var trend = 1 + ((179 - d) / 179) * 1.05;      // steady growth over 6 months
    var season = (dow === 5 || dow === 6) ? 1.75 : (dow === 0 ? 0.65 : 1);
    var w = Math.round(trend * season * 10);
    for (var k = 0; k < w; k++) pool.push(d);
  }

  var days = [];
  for (var i = 0; i < 116; i++) days.push(pick(pool));
  days.push(0, 0, 0, 0, 1, 1, 1);                   // guarantee sales today and yesterday
  days.sort(function (a, b) { return b - a; });     // oldest first

  var inStock = variants.filter(function (v) { return v.qty > 0; });
  var counter = 2101;

  days.forEach(function (dOffset) {
    var date = daysAgo(dOffset);
    date.setHours(ri(10, 21), ri(0, 59), 0, 0);
    var cust = pick(customers);
    var lines = ri(1, 3);
    var items = [], subtotal = 0;

    for (var i = 0; i < lines; i++) {
      var v = pick(inStock);
      var p = products[v.productId - 1];
      var qty = chance(0.78) ? 1 : 2;
      items.push({
        sku: v.sku, productId: p.id, name: p.name, type: p.type, size: v.size,
        qty: qty, unitPrice: p.sellingPrice, unitCost: p.costPrice
      });
      subtotal += qty * p.sellingPrice;
    }

    var discount = chance(0.22) ? Math.round(subtotal * pick([0.05, 0.1, 0.15])) : 0;
    var total = subtotal - discount;

    sales.push({
      id: 'INV-' + (counter++),
      date: date,
      customerId: cust.id,
      customerName: cust.name,
      items: items,
      subtotal: subtotal,
      discount: discount,
      total: total,
      payment: pick(PAYMENT_METHODS),
      cashier: pick(CASHIERS)
    });
  });

  sales.sort(function (a, b) { return b.date - a.date; });   // newest first
})();

/* Roll the sales up into customer stats, employee stats and per-product recency. */
(function rollUp() {
  var lastSold = {};
  sales.forEach(function (s) {
    var c = customers[s.customerId - 1];
    c.totalSpent += s.total;
    c.history.push(s.id);
    if (!c.lastPurchaseDate || s.date > c.lastPurchaseDate) c.lastPurchaseDate = s.date;

    var e = employees.filter(function (x) { return x.name === s.cashier; })[0];
    if (e) e.sales += s.total;

    s.items.forEach(function (it) {
      if (!lastSold[it.productId] || s.date > lastSold[it.productId]) lastSold[it.productId] = s.date;
    });
  });

  customers.forEach(function (c) {
    c.loyaltyPoints = Math.round(c.totalSpent / 1000 * CONFIG.LOYALTY_POINTS_PER_1000);
    if (!c.lastPurchaseDate) c.lastPurchaseDate = daysAgo(ri(95, 160));
  });

  /* Five customers parked deliberately far in the past so "At risk" is never empty. */
  [3, 9, 17, 26, 34].forEach(function (idx, i) {
    customers[idx].lastPurchaseDate = daysAgo([104, 121, 96, 148, 133][i]);
  });

  products.forEach(function (p) {
    var d = lastSold[p.id];
    p.lastSoldDaysAgo = d ? Math.round((TODAY - d) / 86400000) : ri(60, 90);
  });
  products[23].lastSoldDaysAgo = 74;   // OG Denim Jacket — the dead-stock alert
})();

/* ----------------------------------------------------------- 5. PRINT JOBS */

var PRINT_STAGES = ['design', 'sent', 'printing', 'delivery', 'done'];
var PRINT_STAGE_LABELS = {
  design: 'Design', sent: 'Sent to print', printing: 'Printing', delivery: 'Delivery', done: 'Done'
};

var printJobs = [
  { id: 'P-1036', customer: 'Rana Mansour',   phone: '+963 933 447 210', design: 'Back print — "TEAM RANA" + est. 2019', qty: 12, priority: 'normal', deadline: daysAgo(6),  stage: 'done',     price: 1080000, cost: 540000, created: daysAgo(20) },
  { id: 'P-1037', customer: 'Al-Nour School', phone: '+963 944 118 663', design: 'Graduation shirts, white on navy',      qty: 45, priority: 'normal', deadline: daysAgo(3),  stage: 'done',     price: 3825000, cost: 1912500, created: daysAgo(24) },
  { id: 'P-1038', customer: 'Karim Deeb',     phone: '+963 991 220 574', design: 'Front chest logo, single colour',       qty:  6, priority: 'normal', deadline: daysAgo(1),  stage: 'done',     price:  540000, cost: 264000, created: daysAgo(15) },
  { id: 'P-1039', customer: 'Fadi Barakat',   phone: '+963 955 761 038', design: 'Full back — Damascus skyline, 3 colour', qty: 20, priority: 'normal', deadline: daysAhead(4), stage: 'delivery', price: 2100000, cost: 1050000, created: daysAgo(12) },
  { id: 'P-1040', customer: 'Sara Kurdi',     phone: '+963 932 604 917', design: 'Small left-chest "SK" monogram',        qty:  4, priority: 'normal', deadline: daysAhead(6), stage: 'printing', price:  380000, cost: 176000, created: daysAgo(9)  },
  { id: 'P-1041', customer: 'Bilal Ammar',    phone: '+963 987 335 402', design: 'Sleeve print both arms, gold foil',     qty: 15, priority: 'urgent', deadline: daysAhead(2), stage: 'printing', price: 1875000, cost:  900000, created: daysAgo(7)  },
  { id: 'P-1042', customer: 'Maya Shaheen',   phone: '+963 941 552 286', design: 'Oversized front — "NO SLEEP" arabic',   qty:  8, priority: 'normal', deadline: daysAhead(9), stage: 'sent',     price:  760000, cost:  368000, created: daysAgo(5)  },
  { id: 'P-1043', customer: 'Ahmad Al-Khatib',phone: '+963 933 118 204', design: 'Team kit numbers 1–18, back print',     qty: 18, priority: 'urgent', deadline: daysAgo(2),  stage: 'printing', price: 1980000, cost:  918000, created: daysAgo(16) },
  { id: 'P-1044', customer: 'Ziad Sabbagh',   phone: '+963 966 810 447', design: 'Cafe staff shirts, embroidered',        qty: 10, priority: 'normal', deadline: daysAgo(1),  stage: 'sent',     price: 1250000, cost:  620000, created: daysAgo(13) },
  { id: 'P-1045', customer: 'Yara Malki',     phone: '+963 944 273 159', design: 'Couple set, front text arabic script',  qty:  2, priority: 'normal', deadline: daysAhead(5), stage: 'design',   price:  210000, cost:   96000, created: daysAgo(2)  },
  { id: 'P-1046', customer: 'Tarek Jaber',    phone: '+963 955 336 720', design: 'Gym brand — 2 designs, 3 sizes',        qty: 30, priority: 'urgent', deadline: daysAhead(3), stage: 'design',   price: 3300000, cost: 1620000, created: daysAgo(1)  },
  { id: 'P-1047', customer: 'Nada Sultan',    phone: '+963 932 447 881', design: 'Birthday shirts, photo transfer',       qty:  5, priority: 'normal', deadline: daysAhead(8), stage: 'design',   price:  575000, cost:  270000, created: TODAY       }
];

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
   where the job sits now. */
(function buildJobDetail() {
  printJobs.forEach(function (j) {
    j.sizes = splitSizes(j.qty);

    /* Spread the completed stages evenly between created and today. */
    var idx = PRINT_STAGES.indexOf(j.stage);
    var span = Math.max(1, Math.round((TODAY - j.created) / 86400000));
    j.history = [];
    for (var i = 0; i <= idx; i++) {
      var back = idx === 0 ? span : Math.round(span - (span * i / idx));
      j.history.push({ stage: PRINT_STAGES[i], at: daysAgo(Math.max(0, back)) });
    }
  });
})();

/* ------------------------------------------------------------ 6. MOVEMENTS */

var MOVEMENT_TYPES = {
  received: { label: '+ Received',  sign: 1  },
  sold:     { label: '- Sold',      sign: -1 },
  damaged:  { label: '- Damaged',   sign: -1 },
  returned: { label: '+ Return',    sign: 1  },
  transfer: { label: '- Transfer',  sign: -1 }
};

var stockMovements = [];
(function buildMovements() {
  var users = ['Maher Odeh', 'Sirine Bakri', 'Lubna Kayali', 'Rawad Sheikh', 'Hussam Fattal'];
  var picked = [];
  for (var i = 0; i < 22; i++) picked.push(pick(variants));

  picked.forEach(function (v) {
    var chain = [], n = ri(2, 4), bal = v.qty;
    for (var i = 0; i < n; i++) {
      var roll = rnd(), type, delta, note;
      if (roll < 0.42)      { type = 'received'; delta = ri(8, 40);  note = 'Received from ' + pick(suppliers).name; }
      else if (roll < 0.78) { type = 'sold';     delta = -ri(1, 2);  note = 'Sold, invoice #' + pick(sales).id; }
      else if (roll < 0.90) { type = 'damaged';  delta = -ri(1, 2);  note = 'Damaged on arrival — written off'; }
      else                  { type = 'returned'; delta = 1;          note = 'Customer return, restocked'; }

      chain.push({
        id: 'MV-' + pad(stockMovements.length + chain.length + 1, 4),
        date: daysAgo(ri(0, 150)),
        sku: v.sku, productId: v.productId, size: v.size,
        type: type, delta: delta, note: note,
        user: pick(users),
        balance: 0
      });
    }
    chain.sort(function (a, b) { return a.date - b.date; });
    /* Walk backwards from today's real quantity so the running balance ties out. */
    for (var j = chain.length - 1; j >= 0; j--) { chain[j].balance = bal; bal -= chain[j].delta; }
    stockMovements = stockMovements.concat(chain);
  });

  stockMovements.sort(function (a, b) { return b.date - a.date; });
})();

/* ----------------------------------------------------------------- 7. MISC */

var storeOrders = [
  { id: 'ORD-4412', name: 'Joud Attar',   phone: '+963 933 662 108', city: 'Damascus', items: 'OG Heavyweight Tee — L ×1', total: 225000,  payment: 'cod',  status: 'pending', date: daysAgo(0) },
  { id: 'ORD-4411', name: 'Rami Daoud',   phone: '+963 944 771 355', city: 'Aleppo',   items: 'Adidas Samba OG — 43 ×1',   total: 1180000, payment: 'sham', status: 'confirmed', date: daysAgo(1) }
];

var notifications = [
  { icon: '!', tone: 'red',   text: 'Nike Air Force 1 — size 42 out of stock',        view: 'products' },
  { icon: '!', tone: 'red',   text: 'Print job #P-1043 is 2 days overdue',            view: 'print' },
  { icon: '$', tone: 'amber', text: 'Karam Trading — 41,500,000 SYP due in 3 days',   view: 'reports' },
  { icon: '~', tone: 'amber', text: '5 SKUs dropped into critical stock this week',   view: 'warehouse' },
  { icon: 'C', tone: 'grey',  text: '2 storefront orders waiting for confirmation',   view: 'storefront' },
  { icon: 'P', tone: 'grey',  text: 'Payroll for 6 employees runs in 6 days',         view: 'reports' }
];

/* -------------------------------------------------------------- 8. HELPERS */

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
  storeOrders: storeOrders,
  notifications: notifications,
  sizeSets: SIZE_SETS,
  typeLabels: TYPE_LABELS,
  paymentLabels: PAYMENT_LABELS,
  paymentMethods: PAYMENT_METHODS,
  printStages: PRINT_STAGES,
  printStageLabels: PRINT_STAGE_LABELS,
  movementTypes: MOVEMENT_TYPES,

  product: function (id) { return products.filter(function (p) { return p.id === id; })[0]; },
  customer: function (id) { return customers.filter(function (c) { return c.id === id; })[0]; },
  sale: function (id) { return sales.filter(function (s) { return s.id === id; })[0]; },
  variantsOf: function (pid) { return variants.filter(function (v) { return v.productId === pid; }); },
  variantBySku: function (sku) { return variants.filter(function (v) { return v.sku === sku; })[0]; },
  variantByBarcode: function (b) { return variants.filter(function (v) { return v.barcode === b; })[0]; },

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
    return variants.filter(function (v) { return v.qty <= CONFIG.STOCK_CRITICAL; });
  },

  daysBetween: function (a, b) {
    return Math.round((b - a) / 86400000);
  },

  daysSince: function (d) { return Math.round((TODAY - new Date(d).setHours(0, 0, 0, 0)) / 86400000); },

  isOverdue: function (job) { return job.stage !== 'done' && DB.daysSince(job.deadline) > 0; },

  stageIndex: function (job) { return PRINT_STAGES.indexOf(job.stage); },

  /* Single place a job's stage can change, so the history always stays in
     step with the tracker — used by the OG kanban and the Yalla portal. */
  setStage: function (job, stage) {
    var to = PRINT_STAGES.indexOf(stage);
    if (to < 0 || job.stage === stage) return false;
    job.stage = stage;
    job.history = (job.history || []).filter(function (h) {
      return PRINT_STAGES.indexOf(h.stage) < to;
    });
    job.history.push({ stage: stage, at: new Date() });
    return true;
  },

  stageAt: function (job, stage) {
    var hit = (job.history || []).filter(function (h) { return h.stage === stage; })[0];
    return hit ? hit.at : null;
  },

  /* ---- partner access control -------------------------------------------
     Yalla Wear renders ONLY from this object. The customer's name, phone and
     the price OG charges them are not omitted from a template — they never
     leave this function. That makes the guarantee structural, not cosmetic. */
  partnerView: function (job) {
    return {
      id: job.id,
      design: job.design,
      qty: job.qty,
      sizes: job.sizes,
      priority: job.priority,
      created: job.created,
      deadline: job.deadline,
      stage: job.stage,
      history: job.history,
      payout: job.cost,            // what OG pays Yalla Wear — their own money
      overdue: DB.isOverdue(job)
    };
  },

  partnerJobs: function (includeDone) {
    return printJobs
      .filter(function (j) { return includeDone || j.stage !== 'done'; })
      .map(DB.partnerView)
      .sort(function (a, b) { return a.deadline - b.deadline; });
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

  /* The one way a print job is created, so every job — seeded or made live
     at the till — has a size breakdown and a stamped history. */
  newPrintJob: function (f) {
    var now = new Date();
    var job = {
      id: DB.nextPrintId(),
      customer: f.customer,
      phone: f.phone,
      design: f.design,
      qty: f.qty,
      priority: f.priority || 'normal',
      deadline: f.deadline,
      stage: 'design',
      price: f.price,
      cost: f.cost,
      created: now,
      sizes: f.sizes || splitSizes(f.qty),
      history: [{ stage: 'design', at: now }]
    };
    printJobs.push(job);
    return job;
  },

  nextPrintId: function () {
    var max = 1035;
    printJobs.forEach(function (j) { var n = parseInt(j.id.split('-')[1], 10); if (n > max) max = n; });
    return 'P-' + (max + 1);
  },

  nextOrderId: function () {
    var max = 4411;
    storeOrders.forEach(function (o) { var n = parseInt(o.id.split('-')[1], 10); if (n > max) max = n; });
    return 'ORD-' + (max + 1);
  },

  logMovement: function (m) {
    m.id = 'MV-' + pad(stockMovements.length + 1, 4);
    stockMovements.unshift(m);
  }
};
