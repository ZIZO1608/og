/* ==========================================================================
   OG SYSTEM — application shell  ·  5/17: SHELL (roles/NAV/sidebar/topbar/
   account/search)
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 1723-2164). Loads after
   app-export.js.
   ========================================================================== */

/* -------------------------------------------------------------- 5. SHELL */

/* ------------------------------------------------------------- 5a. WHO, WHAT

   The app always runs against the server, so every permission question has
   one answer: the server's, which Auth cached at sign-in. With nobody signed
   in roleOf() is null and allow() says no, so a signed-out browser draws
   nothing. */

function roleOf() {
  var u = Auth.user();
  return u ? u.role : null;
}

function allow(perm) {
  return Auth.can(perm);
}

/* What things cost us, and what we make on them. Two separate permissions
   because they are two separate secrets: a manager may reasonably want a
   senior person to see margin without seeing supplier prices.

   These exist as named functions rather than `allow('cost.read')` sprinkled
   through the file because the failure mode is missing ONE call site, and a
   named thing is greppable. */
function seesCost()   { return allow('cost.read'); }
function seesProfit() { return allow('profit.read'); }

/* Yalla Wear does not get the shop. They get their portal and nothing else —
   no sidebar, no search, no dashboard, no way to type their way out. Checked
   against the role rather than a permission, because this is not a thing a
   manager should be able to switch on by ticking a box. */
function isPartnerAccount() { return roleOf() === 'partner'; }

var NAV = [
  { id: 'dashboard',  key: 'nav_dashboard', icon: 'M3 12h4l2 6 4-13 2 7h6' },
  { id: 'pos',        key: 'nav_pos',       icon: 'M3 4h3l2 10h9l2-7H7M9 19a1 1 0 1 0 2 0 1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0' },
  { id: 'customers',  key: 'nav_customers', icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a3 3 0 0 0-2-2.8' },
  { id: 'coupons',    key: 'nav_coupons',   icon: 'M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM9 15l6-6' },
  { id: 'products',   key: 'nav_products',  icon: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10' },
  { id: 'warehouse',  key: 'nav_warehouse', icon: 'M3 20V9l9-5 9 5v11M7 20v-7h10v7' },
  { id: 'shelfmap',   key: 'nav_shelfmap', icon: 'M3 5h18v6H3zM3 13h18v6H3zM9 5v6M15 5v6M9 13v6M15 13v6' },
  { id: 'labels',     key: 'nav_labels',    icon: 'M4 5v14M8 5v14M11 5v9M14 5v14M17 5v9M20 5v14' },
  { id: 'money',      key: 'nav_money',     icon: 'M3 8h18v11H3zM3 8l2-4h14l2 4M12 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4' },
  { id: 'payments',   key: 'nav_payments',  icon: 'M3 6h18v12H3zM3 10h18M7 15h4M15 15h2' },
  { id: 'reports',    key: 'nav_reports',   icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'desk',       key: 'nav_desk',      icon: 'M3 7h18v4H3zM5 11v9h14v-9M9 7V4h6v3M10 15h4' },
  { id: 'deliveries', key: 'nav_deliveries',icon: 'M3 16V6h11v10M14 9h4l3 3v4h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3' },
  { id: 'safeers',    key: 'nav_safeers',   icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20v-1a5 5 0 0 1 10 0v1M12 20v-1a5 5 0 0 1 10 0v1' },
  { id: 'reviews',    key: 'nav_reviews',   icon: 'M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6L12 17l-5.38 2.85 1.03-6L3.3 9.6l6-.9z' },
  { id: 'weborders',  key: 'nav_weborders', icon: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9' },
  { id: 'requests',   key: 'nav_requests',  icon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z' },
  { id: 'print',      key: 'nav_print',     icon: 'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z' },
  /* 071 — the print kits and their fonts: how a name and number look on a
     jersey the website sells. */
  { id: 'printkits',  key: 'nav_printkits', icon: 'M8 3l4 2 4-2 5 3-2 5-2-1v11H7V10l-2 1-2-5zM10 12h4M12 12v5' },
  { id: 'settings',   key: 'nav_settings',  icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z' }
];

/* THE SIDEBAR'S SECTIONS — one list, read by the sidebar AND the phone's More
   sheet, so the two can never disagree about where a screen lives. Home sits
   above every heading and Settings below them all; everything else belongs
   to exactly one section. NAV above is in the same order, because that order
   is the depth axis the page transition animates against.

   A section the account can open nothing in is not drawn at all, and a
   section can be folded shut (per machine, og.nav.shut) — except the one
   holding the screen on show, which always opens. */
var NAV_TOP = ['dashboard'];
var NAV_BOTTOM = ['settings'];
/* Each section has its own colour (the SIDEBAR COLOURS block in og-skin.css,
   keyed on data-sec) and its own mark. Lime stays the shop's; Yalla Wear's
   is their own mint, the colour of their portal. */
var SECTIONS = [
  { id: 'shop',     key: 'nav_s_shop',     ids: ['pos', 'customers', 'coupons'],
    icon: 'M3 9l1.5-5h15L21 9M3 9h18M4 9v11h16V9M9 20v-6h6v6' },
  { id: 'stock',    key: 'nav_s_stock',    ids: ['products', 'warehouse', 'shelfmap', 'labels'],
    icon: 'M3 13h8v8H3zM13 13h8v8h-8zM8 3h8v8H8z' },
  { id: 'money',    key: 'nav_s_money',    ids: ['money', 'payments', 'reports'],
    icon: 'M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5' },
  { id: 'delivery', key: 'nav_s_delivery', ids: ['desk', 'deliveries', 'safeers', 'reviews'],
    icon: 'M3 16V6h11v10M14 9h4l3 3v4h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3' },
  { id: 'web',      key: 'nav_s_web',      ids: ['weborders', 'requests'],
    icon: 'M3 5h18v14H3zM3 9h18M6 7h.01M9 7h.01M9 14l2 2 4-4' },
  { id: 'yalla',    key: 'nav_s_yalla',    ids: ['print', 'printkits'],
    icon: 'M8 3l4 2 4-2 5 3-2 5-2-1v11H7V10l-2 1-2-5z' }
];

/* Which section the screen on show belongs to — the travelling indicator
   takes that section's colour. Home and Settings are the brand's own. */
function navHere() {
  for (var i = 0; i < SECTIONS.length; i++) {
    if (SECTIONS[i].ids.indexOf(OG.view) >= 0) return SECTIONS[i].id;
  }
  return 'home';
}
function secIcon(path) {
  return '<span class="nav-sec-ico"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></svg></span>';
}

/* Which permission each screen needs.

   A screen missing from this map is open to anyone signed in — `dashboard` is
   the only one, deliberately, so no role can ever end up with an empty shell
   and nowhere to land.

   This hides menu items; it is not the security boundary. The server refuses
   the data regardless. What this fixes is a cashier staring at a Money screen
   that loads empty and looks broken, when the real answer is "not your job". */
var NAV_PERM = {
  pos:        'sell',
  products:   'product.read',
  warehouse:  'stock.read',
  /* The same gate the warehouse screen has: a cashier answering "have you
     got it in a 42" is exactly who the map is for. Putting stock away from
     it needs stock.move, and the layout editor config.write — both checked
     inside the module, and both again on the server. */
  shelfmap:   'stock.read',
  /* Any of these (054): the cashier counts the drawer here at night and sees
     nothing else on this screen — money.js draws only the tabs each account
     may have. */
  money:      ['money.read', 'money.count', 'staff.read', 'profit.read'],
  /* The office writes orders — a sale with a destination and a payment plan
     — which is a different job from reading the board. */
  desk:       'delivery.desk',
  /* What staff left at /night while the shop was shut (js/requests.js):
     the office decides, so the office's permission. */
  requests:   'delivery.desk',
  deliveries: 'delivery.read',
  /* The office's: a driver holds delivery.read and has no business reading
     what every customer said, and the partner never reaches any of this. */
  reviews: 'delivery.desk',
  weborders: 'delivery.web',
  /* The shop's payment methods, their accounts and what the website offers:
     the same gate as every route behind the page (PUT /api/delivery/settings,
     /api/web-checkout). */
  payments: 'config.write',
  /* 068 — coupon codes: the owner and the developers ("only for the admin"),
     the same gate as every route behind the page. */
  coupons: 'coupon.write',
  /* 060 — the delivery team: owner, developer, manager. A safeer's own
     tasks reach him on his home screen instead. */
  safeers: 'safeer.read',
  customers:  'customer.read',
  labels:     'label.print',
  print:      'print.read',
  /* 071 — the same gate as every write behind the page. */
  printkits:  'print_kits.manage',
  reports:    'report.read',
  settings:   'config.write'
};

/* Whether this account may open a screen: NAV_PERM, plus the per-role rules
   below that a permission cannot express. */
function navAllowed(id) {
  /* The partner has no shop nav at all, including the dashboard that is
     otherwise open to everyone. Their whole app is the portal. */
  if (isPartnerAccount()) return false;

  /* A driver's home screen already IS his runs, so a second menu entry to the
     same list is just a way of making him wonder which one is the real one. */
  if (id === 'deliveries' && roleOf() === 'delivery') return false;

  /* And he has no reason to browse the customer list at all. He holds
     customer.read — he has to, it is what feeds the names and phone numbers
     onto his board — but the people he needs are the ones on his run, and
     those reach him through the delivery board already.

     A per-role nav rule rather than taking customer.read away: the permission
     is what makes GET /api/customers answer him at all, and the server scopes
     that response to his own run (driverScope, server/lib/customers.js). Remove
     the permission and his board loses the addresses with it. */
  if (id === 'customers' && roleOf() === 'delivery') return false;

  var need = NAV_PERM[id];
  if (!need) return true;
  /* A list means any of them, the same meaning requirePerm gives one. */
  return Array.isArray(need) ? need.some(allow) : allow(need);
}

function allowedNav() {
  return NAV.filter(function (n) { return navAllowed(n.id); });
}

/* Wrap any in-page shortcut to another screen — a "View all" on a dashboard
   card, a "+ Add" that jumps to the warehouse. Hiding the sidebar entry is not
   enough on its own: these buttons live inside screens the role CAN see, and
   go() would quietly bounce them somewhere else. A button that visibly does
   the wrong thing is worse than one that is not there. */
function ifNav(view, html) {
  return navAllowed(view) ? html : '';
}

/* The sidebar order IS the depth axis: moving down the list reads as going
   deeper, so that is what the page transition animates against. */
if (typeof Motion !== 'undefined') {
  Motion.setOrder(NAV.map(function (n) { return n.id; }));
}

function navBadge(id) {
  if (id === 'print') { var n = DB.printJobs.filter(function (j) { return DB.isOverdue(j); }).length; return n ? n : 0; }
  /* Night requests waiting for somebody to accept or turn them down. */
  if (id === 'requests') return typeof Requests !== 'undefined' ? Requests.count() : 0;
  /* How many products the shop sells. Archived lines are left out so this
     agrees with the list on the screen — viewProducts() filters on the same
     !p.archived, and a badge saying 4 above a table showing 3 rows is read as
     a missing row rather than as a different question being answered.

     This used to be DB.criticalVariants().length — sizes at or below
     STOCK_CRITICAL, not products. It was a fair thing to count and a bad
     thing to put here unlabelled: one shoe with five thin sizes read as 5,
     which looks like a quantity of products and is not one. The low-stock
     figure is still on the screen itself, per row, where the word next to it
     says what it means. */
  if (id === 'products') {
    return DB.products.filter(function (p) { return !p.archived; }).length;
  }
  return 0;
}

/* ---- the icon rail -------------------------------------------------------
   Collapsing is a per-machine preference, not a per-user one: the till in the
   corner with the small screen wants the rail whoever is signed into it, and
   the office machine wants the labels. So it lives in localStorage next to
   the other things this browser remembers, not on the account. */

var SIDEBAR_KEY = 'og.sidebar';

function setSidebarMini(on) {
  if (on) document.body.setAttribute('data-sidebar', 'mini');
  else document.body.removeAttribute('data-sidebar');
  try {
    if (on) localStorage.setItem(SIDEBAR_KEY, 'mini');
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch (e) { /* private mode — the choice just does not outlive the tab */ }
}

/* Called by boot() BEFORE the first renderSidebar, so the rail is never drawn
   wide and then snapped narrow in front of someone. */
function applySidebarMode() {
  var v = null;
  try { v = localStorage.getItem(SIDEBAR_KEY); } catch (e) {}
  if (v === 'mini') document.body.setAttribute('data-sidebar', 'mini');
}

function navItemHtml(id) {
  if (!navAllowed(id)) return '';
  var n = NAV.filter(function (x) { return x.id === id; })[0];
  if (!n) return '';
  var b = navBadge(n.id);
  /* The title carries the label for the collapsed rail, where the text
     beside the icon is gone and hovering is the only way to be sure. */
  return '<button class="nav-item' + (OG.view === n.id ? ' active' : '') + '" data-act="nav" data-view="' + n.id + '"' +
      ' title="' + esc(t(n.key)) + '">' +
      '<span class="nav-icon"><svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter"><path d="' + n.icon + '"/></svg></span>' +
      '<span class="nav-txt">' + t(n.key) + '</span>' +
      (b ? '<span class="nav-badge">' + b + '</span>' : '') +
    '</button>';
}

/* Which sections this machine has folded shut. Per machine like the rail:
   the till wants the shop open, the office wants delivery. Only shut ones
   are stored, so a section added later starts open. */
var NAV_SHUT_KEY = 'og.nav.shut';
function navShut() {
  try { var v = JSON.parse(localStorage.getItem(NAV_SHUT_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function navSaveShut(shut) {
  try {
    if (shut.length) localStorage.setItem(NAV_SHUT_KEY, JSON.stringify(shut));
    else localStorage.removeItem(NAV_SHUT_KEY);
  } catch (e) { /* private mode — the fold just does not outlive the tab */ }
}
function navForget(id) {
  navSaveShut(navShut().filter(function (x) { return x !== id; }));
}

/* Folding never re-renders the sidebar: one class moves, the height eases,
   and the travelling indicator is measured again once it has settled. */
function toggleNavSection(id) {
  var el = document.querySelector('.sidebar .nav-sec[data-sec="' + id + '"]');
  if (!el) return;
  var shut = navShut();
  var close = !el.classList.contains('shut');
  if (close && el.classList.contains('here')) {
    /* The section holding the screen on show stays open — folding it would
       hide the one item that says where you are. It nods instead. */
    el.classList.remove('nudge'); void el.offsetWidth; el.classList.add('nudge');
    return;
  }
  el.classList.toggle('shut', close);
  var head = el.querySelector('.nav-sec-head');
  if (head) head.setAttribute('aria-expanded', String(!close));
  shut = shut.filter(function (x) { return x !== id; });
  if (close) shut.push(id);
  navSaveShut(shut);
  if (typeof Motion !== 'undefined') {
    setTimeout(function () { try { Motion.navIndicator(); } catch (e) {} }, 280);
  }
}

function renderSidebar() {
  /* Partner mode takes over the whole shell — its own nav, its own brand. */
  if (OG.print.partner) {
    document.getElementById('sidebar').innerHTML = YALLA.sidebar();
    /* The phone tab bar is drawn at the end of this function for the shop;
       returning early here left the partner with an EMPTY bar — a strip of
       navy with no icons in it — on every phone. */
    renderTabbar();
    return;
  }

  /* The logo is white-on-black, so on the black sidebar the wordmark sits bare. */
  var html =
    '<div class="brand">' +
      '<div class="brand-mark brand-mark-inverse"><img src="assets/logo.svg" alt="OG"></div>' +
      /* Reads CONFIG rather than a hardcoded string — otherwise renaming the
         shop in Settings changes the invoices and the labels but leaves the
         sidebar still saying OG SYSTEM. */
      '<div class="brand-text"><b>' + esc(CONFIG.SHOP_NAME.toUpperCase()) + '</b>' +
        '<span>' + t('tagline') + '</span></div>' +
      /* The collapse control lives in the brand row rather than floating over
         the edge, so it cannot land on top of a nav item. Below 900px the
         sidebar is already a rail and there is nothing to collapse, so CSS
         hides this there rather than offering a button that does nothing. */
      '<button class="sb-toggle" data-act="sidebar-toggle" ' +
        'title="' + esc(t('sb_collapse')) + '" aria-label="' + esc(t('sb_collapse')) + '">' +
        '<svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter">' +
          '<path d="M4 5h16v14H4zM10 5v14"/></svg></button>' +
    '</div>' +
    /* The shop's colours in one line under the name: lime for the shop, then
       one band per section, in the order they are listed below. */
    '<div class="sb-spectrum" aria-hidden="true">' +
      SECTIONS.map(function (x) { return '<i data-sec="' + x.id + '"></i>'; }).join('') +
    '</div><nav class="nav" data-here="' + navHere() + '">';

  NAV_TOP.forEach(function (id) { html += navItemHtml(id); });
  var shut = navShut();
  SECTIONS.forEach(function (sec) {
    var items = sec.ids.filter(navAllowed);
    /* A role with nothing in a section must not get a bare heading floating
       above no buttons. */
    if (!items.length) return;
    var here = items.indexOf(OG.view) >= 0;
    /* Going to a screen in a folded section opens that section for good —
       leaving it again must not fold it back behind the person's back. */
    if (here && shut.indexOf(sec.id) >= 0) navForget(sec.id);
    var closed = !here && shut.indexOf(sec.id) >= 0;
    /* What a shut section is hiding that needs somebody: overdue print jobs,
       night requests. The products count is a size, not an alert, so it is
       never summed into a heading. */
    var waiting = items.reduce(function (n, id) {
      return id === 'products' ? n : n + (navBadge(id) || 0);
    }, 0);
    html += '<div class="nav-sec' + (closed ? ' shut' : '') + (here ? ' here' : '') + '" data-sec="' + sec.id + '">' +
      '<button class="nav-sec-head" data-act="nav-sec" data-sec="' + sec.id + '" aria-expanded="' + (!closed) + '">' +
        secIcon(sec.icon) +
        '<span class="nav-sec-txt">' + t(sec.key) + '</span>' +
        /* Folded, the heading still shows what it holds: each screen's icon in
           small, so a shut Warehouse reads as boxes and a shelf, not a word. */
        '<span class="nav-sec-peek" aria-hidden="true">' + items.map(function (id) {
          var n = NAV.filter(function (x) { return x.id === id; })[0];
          return '<svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg>';
        }).join('') + '</span>' +
        '<span class="nav-sec-n">' + (waiting ? '<i>' + waiting + '</i>' : '<bdi>' + items.length + '</bdi>') + '</span>' +
        '<svg class="nav-sec-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="nav-sec-body"><div class="nav-sec-in">' +
        items.map(navItemHtml).join('') +
      '</div></div></div>';
  });
  html += '<div class="nav-bottom">' + NAV_BOTTOM.map(navItemHtml).join('') + '</div>';

  /* There is deliberately no door into the Yalla Wear portal from here.
     They are a different company: which side of the line an account is on
     is decided by its role at login, and nothing in either shell flips it.
     What OG needs to know about a job — the thread, the stage, the invoice
     — is on the Print screen, on OG's own side. */
  /* The foot used to read "Live demo data · v1.0" — a line written for the
     seeded demo that outlived it, on a till holding real money. It now carries
     the product's own mark: the shop's name is at the top of the rail, the
     system's is at the bottom. */
  html += '</nav><div class="sidebar-foot">' +
    '<span class="sf-mark"><img src="assets/logo.svg" alt=""></span>' +
    '<span class="sf-txt"><b>' + t('live') + '</b><small>v1.0</small></span></div>';
  document.getElementById('sidebar').innerHTML = html;
  /* The sliding indicator is positioned from the active item's own offset, so
     it has to be placed after the nav exists in the DOM. */
  if (typeof Motion !== 'undefined') {
    try { Motion.navIndicator(); Motion.dock(); } catch (e) {}
  }
  renderTabbar();
}

/* ------------------------------------------------------------ BOTTOM TABS
   The phone navigation. Rendered into a permanent #tabbar element and hidden
   by CSS above 720px, so there is no JS breakpoint to keep in sync and a
   resize needs no re-render.

   Five is the ceiling — a sixth tab makes each one too narrow for a thumb, so
   the rest live behind More. */
/* NIGHT SHIFT 03 — Home, the role's two or three most-used screens, and
   More. The tabs were the same four for everybody (dashboard, pos, products,
   print), which put Print Jobs — a screen most of the shop never opens — a
   thumb away from the till, and buried the warehouse and the money behind
   More for the people whose whole job they are.

   ROLE_TABS names only the ORDER; every entry is still filtered by
   navAllowed, so a cashier who cannot open the warehouse simply does not get
   that tab and the next one moves up. Anything not in the role's list is
   still reachable — it is in More, which now lists every screen the account
   may open rather than a hand-written subset. */
var TABS = ['dashboard', 'pos', 'products', 'print'];
var ROLE_TABS = {
  cashier:   ['dashboard', 'pos', 'customers'],
  warehouse: ['dashboard', 'warehouse', 'products'],
  manager:   ['dashboard', 'desk', 'deliveries'],
  owner:     ['dashboard', 'money', 'deliveries'],
  developer: ['dashboard', 'money', 'deliveries'],
  delivery:  ['dashboard', 'products']
};

/* MORE IS EVERY OTHER SCREEN, not a list somebody has to remember to add to.
   It is built from NAV itself minus whatever is already a tab, so a screen
   added to NAV next year appears in More without a second edit — the bug
   that hid the Money screen from every phone until 054 went looking for it. */
var MORE_GROUPS = SECTIONS.map(function (sec) { return { key: sec.key, ids: sec.ids, sec: sec.id, icon: sec.icon }; })
  .concat([{ key: 'nav_s_system', ids: NAV_TOP.concat(NAV_BOTTOM), sec: 'home',
             icon: 'M3 11l9-7 9 7v9H3zM9 20v-6h6v6' }]);

function tabsFor() {
  var want = ROLE_TABS[roleOf()] || TABS;
  return want.filter(navAllowed).slice(0, 4);
}

function renderTabbar() {
  var host = document.getElementById('tabbar');
  if (!host) return;

  /* The partner portal brings its own four screens; it has no More. */
  if (OG.print.partner) {
    host.innerHTML = YALLA.tabs ? YALLA.tabs() : '';
    return;
  }

  var items = [];
  tabsFor().forEach(function (id) {
    var n = NAV.filter(function (x) { return x.id === id; })[0];
    if (!n || !navAllowed(id)) return;
    var b = navBadge(id);
    items.push('<button class="tabbtn' + (OG.view === id ? ' on' : '') + '" data-act="nav" data-view="' + id + '">' +
      '<span class="tb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg>' +
        (b ? '<i class="tb-dot"></i>' : '') + '</span>' +
      '<span class="tb-txt">' + t(n.key) + '</span></button>');
  });

  /* More always shows: even a role with no extra screens reaches sign out
     through it, and on a phone there is nowhere else to put that. */
  var inMore = tabsFor().indexOf(OG.view) < 0;
  items.push('<button class="tabbtn' + (inMore ? ' on' : '') + '" data-act="more-sheet">' +
    '<span class="tb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
      '<path d="M4 7h16M4 12h16M4 17h16"/></svg></span>' +
    '<span class="tb-txt">' + t('nav_more') + '</span></button>');

  /* THE CAMERA, IN THE MIDDLE, RAISED (15 Oct 2026). The phone is the one
     device with a camera on its back, and the camera scanner (js/scan.js)
     had no button anywhere: its comment said "the topbar, the tab bar" and
     neither carried one. At the till a hit lands in the basket; anywhere
     else it opens what was scanned (handleScan). */
  items.splice(Math.floor(items.length / 2), 0,
    '<button class="tabbtn tb-scan" data-act="scan-open" aria-label="' + esc(t('tb_scan')) + '">' +
      '<span class="tb-scan-ring"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 8v8M11 8v8M14 8v8M17 8v8"/>' +
      '</svg></span>' +
      '<span class="tb-txt">' + t('tb_scan') + '</span></button>');

  host.innerHTML = items.join('');
}

/* Everything that did not fit in five tabs, plus the two shell switches that
   were dropped from the collapsed topbar. */
function openMoreSheet() {
  /* Grouped under plain headings, and built from MORE_GROUPS — which covers
     every screen in NAV — so nothing this account may open is missing from
     here, whichever tabs its role happens to have. A group with nothing in
     it draws no heading. */
  var h = '';
  var tabs = tabsFor();
  MORE_GROUPS.forEach(function (g) {
    var items = g.ids.filter(function (id) {
      return navAllowed(id) && tabs.indexOf(id) < 0 &&
             NAV.some(function (x) { return x.id === id; });
    });
    if (!items.length) return;
    h += '<div class="more-group" data-sec="' + g.sec + '">' + secIcon(g.icon) + '<span>' + t(g.key) + '</span></div>' +
      '<div class="more-grid" data-sec="' + g.sec + '">';
    items.forEach(function (id) {
      var n = NAV.filter(function (x) { return x.id === id; })[0];
      var b = navBadge(id);
      h += '<button class="more-item' + (OG.view === id ? ' on' : '') + '" data-act="more-go" data-view="' + id + '">' +
        '<span class="mi-ico"><svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg></span>' +
        '<span>' + t(n.key) + '</span>' +
        (b ? '<span class="nav-badge">' + b + '</span>' : '') + '</button>';
    });
    h += '</div>';
  });

  h += '<div class="more-rows">' +
    '<div class="more-row"><span>' + t('language') + '</span><div class="seg">' +
      '<button data-act="lang" data-val="en" class="' + (OG.lang === 'en' ? 'on' : '') + '">EN</button>' +
      '<button data-act="lang" data-val="ar" class="' + (OG.lang === 'ar' ? 'on' : '') + '">ع</button>' +
    '</div></div>' +
    '<div class="more-row"><span>' + t('currency') + '</span><div class="seg">' +
      '<button data-act="curr" data-val="SYP" class="' + (OG.currency === 'SYP' ? 'on' : '') + '">SYP</button>' +
      '<button data-act="curr" data-val="USD" class="' + (OG.currency === 'USD' ? 'on' : '') + '">USD</button>' +
    '</div></div>' +
  '</div>';

  /* The account block lives here too, and this is not a duplicate for
     convenience. `.user-chip` is display:none below 900px, so on the phones
     used on the shop floor this sheet is the ONLY way to reach sign out. */
  var u = acct();
  if (u) {
    h += '<div class="more-acct">' +
      '<div class="ma-who">' +
        '<span class="user-avatar">' + esc(initialsOf(u.name)) + '</span>' +
        '<div><b>' + esc(u.name) + '</b>' +
          '<span class="acct-role">' + esc(roleLabel(u.role)) + '</span></div>' +
      '</div>' +
      '<div class="ma-btns">' +
        '<button class="btn btn-sm" data-act="acct-pw">' + t('change_pw') + '</button>' +
        /* THE PHONE'S COPY OF THE ACCOUNT MENU. Leaving My Telegram out of it
           would put linking a phone on the desktop popover only — and the
           people this is for (a cashier, the warehouse, a driver) are the ones
           who work from a phone. */
        (typeof YALLA !== 'undefined' && YALLA.telegramLoad
          ? '<button class="btn btn-sm" data-act="acct-tg">' + t('acct_telegram') + '</button>' : '') +
        '<button class="btn btn-sm btn-danger" data-act="acct-out">' + t('sign_out') + '</button>' +
      '</div>' +
    '</div>';
  }

  openModal({ title: t('nav_more'), size: 'narrow', body: h, sheet: true });
}

function renderTopbar() {
  if (OG.print.partner) { document.getElementById('topbar').innerHTML = YALLA.topbar(); return; }

  document.getElementById('topbar').innerHTML =
    '<div class="search">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '<input id="globalSearch" type="text" placeholder="' + t('search_top') + '" autocomplete="off">' +
      '<div id="searchResults"></div>' +
    '</div>' +
    '<div class="spacer"></div>' +

    /* Push to Supabase on demand. The mirror already runs on a timer, but
       somebody who has just finished a stock count wants it up NOW rather
       than within ten minutes.

       Hidden for anyone without config.write, because pressing it could
       only ever produce an error. */
    (allow('config.write')
      ? '<button class="icon-btn sync-btn" data-act="sync-now" ' +
          'title="' + esc(t('sync_now')) + '" aria-label="' + esc(t('sync_now')) + '">' +
          '<svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter">' +
            '<path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.7-4.4M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.7 4.4"/>' +
            '<path d="M21 4v5h-5M3 20v-5h5"/></svg></button>'
      : '') +

    /* What this device is holding for the till (night shift 04): shown only
       while something waits (amber) or was refused (red). Its own slot, so
       the queue repaints it without a render. */
    '<span id="wqSlot">' + wqButton() + '</span>' +

    '<div class="seg">' +
      '<button data-act="lang" data-val="en" class="' + (OG.lang === 'en' ? 'on' : '') + '">EN</button>' +
      '<button data-act="lang" data-val="ar" class="' + (OG.lang === 'ar' ? 'on' : '') + '">ع</button>' +
    '</div>' +
    '<div class="seg">' +
      '<button data-act="curr" data-val="SYP" class="' + (OG.currency === 'SYP' ? 'on' : '') + '">SYP</button>' +
      '<button data-act="curr" data-val="USD" class="' + (OG.currency === 'USD' ? 'on' : '') + '">USD</button>' +
    '</div>' +
    /* Partner messages sit beside the alert bell, not inside it. One is the
       shop talking to itself; the other is another company talking to us. */
    (typeof Notify !== 'undefined' ? Notify.bell() : '') +
    /* Green while the live line to the server is open; grey while it is
       reconnecting and the poll carries on. Pulse paints it. */
    (Auth.can('print.read') ? livePill() : '') +
    '<button class="icon-btn" data-act="bell" title="' + t('notifications') + '">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square"><path d="M18 16V10a6 6 0 1 0-12 0v6l-2 3h16zM10 21h4"/></svg>' +
      /* Unread, not total — a badge that never moves is one people stop
         looking at. Hidden entirely at zero rather than showing a 0. */
      (DB.unreadNotifications().length
        ? '<span class="bell-badge">' + DB.unreadNotifications().length + '</span>'
        : '') +
    '</button>' +
    accountChip();
}

/* ------------------------------------------------------------- 5b. ACCOUNT */

/* Who is signed in, or null. */
function acct() {
  return Auth.user();
}

function roleLabel(role) {
  var k = { owner: 'role_owner', developer: 'role_developer',
            manager: 'role_manager', cashier: 'role_cashier', warehouse: 'role_warehouse',
            delivery: 'role_delivery', partner: 'role_partner' }[role];
  return k ? t(k) : role;
}

/* The live pill: the lamp, who from the other company is reading, and their
   faces. A BUTTON, because it now has something to say when pressed — the
   two partners at Yalla Wear are not interchangeable, and "which of them is
   on" is a question worth one tap. */
function livePill() {
  var on = typeof Pulse !== 'undefined' && Pulse.isLive();
  return '<button class="live-who" data-act="who" aria-haspopup="dialog" title="' + esc(t('who_title')) + '">' +
      '<span class="live-dot' + (on ? ' on' : '') + '"></span>' +
      '<span class="live-faces">' + (typeof Pulse !== 'undefined' ? Pulse.facesHtml() : '') + '</span>' +
      '<span class="live-txt">' + (typeof Pulse !== 'undefined' ? Pulse.presenceText() : '') + '</span>' +
    '</button>';
}

function accountChip() {
  var u = Auth.user();
  if (!u) return '';

  return '<button class="user-chip is-btn' + (u.mustChange ? ' needs-pw' : '') + '" ' +
      'data-act="acct" aria-haspopup="menu" title="' + esc(t('my_account')) + '">' +
    '<span class="user-avatar">' + esc(initialsOf(u.name)) + '</span>' +
    '<span class="uc-name">' + esc(u.name) + '</span>' +
    '<svg class="uc-caret" viewBox="0 0 24 24" stroke-linecap="square"><path d="M6 9l6 6 6-6"/></svg>' +
  '</button>';
}

/* The popover. Same pattern as the notifications bell: appended to the topbar,
   closed by the global click handler. */
function accountPopHtml(u) {
  return '<div class="acct-head">' +
      '<span class="user-avatar lg">' + esc(initialsOf(u.name)) + '</span>' +
      '<div><b>' + esc(u.name) + '</b>' +
        '<span class="acct-role">' + esc(roleLabel(u.role)) + '</span></div>' +
    '</div>' +
    (u.mustChange
      ? '<div class="acct-warn">' + t('pw_must_change') + '</div>' : '') +
    '<div class="acct-sep"></div>' +
    '<button class="acct-item" data-act="acct-pw">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>' +
      t('change_pw') + '</button>' +
    /* Your own phone on the shop's bot — account self-service, like the
       password. Every account, because linking is not what grants anything:
       a chat hears only what its account may see. */
    (typeof YALLA !== 'undefined' && YALLA.telegramLoad
      ? '<button class="acct-item" data-act="acct-tg">' +
          '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
            '<path d="M21 4L3 11l6 2 2 6 3-4 5 4 2-15zM9 13l8-6"/></svg>' +
          t('acct_telegram') + '</button>'
      : '') +
    '<button class="acct-item danger" data-act="acct-out">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M15 17l5-5-5-5M20 12H9M12 3H5v18h7"/></svg>' +
      t('sign_out') + '</button>';
}

/* The change-password dialog.

   The server drops every session on success — including this one — so the
   message says "sign in again" rather than letting it look like a fault. */
function openChangePassword() {
  openModal({
    title: t('change_pw'),
    size: 'narrow',
    body:
      '<div class="pw-form">' +
        '<label class="field"><span>' + t('pw_current') + '</span>' +
          '<input class="inp" id="pwCur" type="password" autocomplete="current-password"></label>' +
        '<label class="field"><span>' + t('pw_new') + '</span>' +
          '<input class="inp" id="pwNew" type="password" autocomplete="new-password"></label>' +
        '<label class="field"><span>' + t('pw_again') + '</span>' +
          '<input class="inp" id="pwNew2" type="password" autocomplete="new-password"></label>' +
        '<div class="pw-err" id="pwErr"></div>' +
      '</div>',
    foot: '<button class="btn" data-act="modal-close">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" data-act="acct-pw-save">' + t('change_pw') + '</button>',
    onOpen: function (root) {
      var f = root.querySelector('#pwCur');
      if (f) setTimeout(function () { f.focus(); }, 60);
    }
  });
}

/* MY TELEGRAM — the same card the Settings fold draws, for one's own phone.

   Every signed-in account, not only a manager: linking is account self-service
   like the password above (POST /api/telegram/link is ungated for exactly that
   reason), and the server hands a non-manager only their OWN row. Before this
   the card lived on a manager-only screen, so a cashier, a warehouse hand or a
   driver had no way to press Connect at all — their phone could follow their
   role's preset and never be linked to follow it with.

   What it sends is still not theirs to choose: PUT /api/telegram/chat stays on
   config.write, so the picker's Choose button is drawn for a manager only. */
function openMyTelegram() {
  openModal({
    title: t('acct_telegram'),
    size: 'narrow',
    sheet: window.innerWidth <= 720,
    body: '<p class="muted small">' + t('acct_tg_sub') + '</p>' +
          '<div class="tg-host">' + t('tg_loading') + '</div>',
    foot: '<button class="btn" data-act="modal-close">' + t('close') + '</button>',
    /* The card paints itself into every .tg-host on the page, so this one
       fills whether or not Settings is open behind it. */
    onOpen: function () {
      if (typeof YALLA !== 'undefined' && YALLA.telegramLoad) YALLA.telegramLoad();
    }
  });
}

/* --------------------------------------------------------- 6. GLOBAL SEARCH */

function runSearch(q) {
  var box = document.getElementById('searchResults');
  if (!box) return;
  q = (q || '').trim().toLowerCase();
  if (q.length < 2) { box.innerHTML = ''; return; }

  /* One search box that reaches three tables, so it needs all three
     permissions asked separately. This is the easiest place in the app to
     leak a customer's phone number to someone who cannot open the Customers
     screen — the box is on every page and it does not look like a screen. */
  var prods = !allow('product.read') ? [] : DB.products.filter(function (p) {
    return p.name.toLowerCase().indexOf(q) > -1 || p.brand.toLowerCase().indexOf(q) > -1;
  }).slice(0, 5);

  /* custSearch is the one "which customer does this text mean" rule: it
     leaves out archived and merged-away people, folds Arabic spellings and
     reads a phone in any form. This box filtered DB.customers by hand and
     offered all of those back. */
  var custs = !allow('customer.read') ? [] : custSearch(q).slice(0, 4);

  /* `sell` and not `report.read`: a cashier has to be able to pull up the
     invoice she wrote ten minutes ago to take a refund against it. Gating
     this on Reports would break the refund she is allowed to give. */
  var invs = !(allow('sell') || allow('report.read')) ? [] : DB.sales.filter(function (s) {
    return s.id.toLowerCase().indexOf(q) > -1;
  }).slice(0, 3);

  var h = '';
  if (prods.length) {
    h += '<div class="sr-group">' + t('nav_products') + '</div>';
    prods.forEach(function (p) {
      h += '<div class="sr-item" data-act="search-prod" data-id="' + p.id + '">' + thumb(p) +
           '<span>' + esc(p.name) + '</span><small class="num">' + DB.totalQty(p.id) + ' ' + t('u_pcs') + '</small></div>';
    });
  }
  if (custs.length) {
    h += '<div class="sr-group">' + t('nav_customers') + '</div>';
    custs.forEach(function (c) {
      h += '<div class="sr-item" data-act="search-cust" data-id="' + c.id + '">' +
           '<span class="cc-av" style="width:24px;height:24px;font-size:10px">' + esc((c.name || '?').charAt(0)) + '</span>' +
           '<span>' + esc(c.name) + '</span><small class="num">' + tel(c.phone) + '</small></div>';
    });
  }
  if (invs.length) {
    h += '<div class="sr-group">' + t('invoices') + '</div>';
    invs.forEach(function (s) {
      h += '<div class="sr-item" data-act="search-inv" data-id="' + s.id + '">' +
           /* In the sale's own currency: money() takes lira, and a dollar
              sale's total is cents. */
           '<span>' + s.id + '</span><small class="num">' + moneyIn(s.currency, s.total) + '</small></div>';
    });
  }
  if (!h) h = '<div class="sr-item muted">' + t('no_results') + '</div>';
  box.innerHTML = '<div class="search-results">' + h + '</div>';
}


/* ---- the write queue's button (night shift 04, js/writequeue.js) ----------
   The Sync button's dot, for the one list only this device holds: amber while
   a write waits for the shop's wifi, red when the shop refused one. Nothing at
   all while the list is empty. */
function wqButton() {
  if (typeof WriteQueue === 'undefined') return '';
  var list = WriteQueue.list();
  if (!list.length) return '';
  var refused = list.some(function (x) { return x.state === 'refused'; });
  var label = t('wq_title') + ' · ' + list.length;
  return '<button class="icon-btn wq-btn" data-act="wq-open" data-mode="' + (refused ? 'bad' : 'warn') + '"' +
    ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
    '<svg viewBox="0 0 24 24" stroke-linecap="square"><path d="M4 7h16M4 12h10M4 17h7"/><path d="M17 14v6M14 17h6"/></svg>' +
    '<span class="wq-count"><bdi dir="ltr">' + list.length + '</bdi></span></button>';
}
function wqPaint() {
  var slot = document.getElementById('wqSlot');
  if (slot) slot.innerHTML = wqButton();
  if (document.getElementById('wqList')) document.getElementById('wqList').innerHTML = wqListHtml();
}
function wqListHtml() {
  var list = typeof WriteQueue !== 'undefined' ? WriteQueue.list() : [];
  if (!list.length) return '<div class="cart-empty"><b>' + esc(t('wq_empty')) + '</b></div>';
  var head = WriteQueue.paused() ? '<p class="wq-note wq-bad">' + esc(t('wq_paused')) + '</p>' : '';
  return head + list.map(function (x) {
    var what = x.kind === 'hand'
      ? t('wq_kind_hand').replace('{id}', decodeURIComponent((x.path.split('/')[3]) || ''))
      : x.method + ' ' + x.path;
    var state = x.state === 'refused'
      ? '<span class="wq-state wq-bad">' + esc(t('wq_state_refused')) + (x.message ? ' — ' + esc(x.message) : '') + '</span>'
      : '<span class="wq-state wq-warn">' + esc(t('wq_state_wait')) + '</span>';
    return '<div class="wq-row"><div class="wq-what"><b>' + esc(what) + '</b>' +
      '<small><bdi dir="ltr">' + esc(fmtDateTime(new Date(x.at))) + '</bdi></small>' + state + '</div>' +
      '<div class="wq-acts"><button class="btn" data-act="wq-retry" data-id="' + esc(x.id) + '">' + esc(t('wq_retry')) + '</button>' +
      (x.state === 'refused' ? '<button class="btn btn-ghost" data-act="wq-dismiss" data-id="' + esc(x.id) + '">' + esc(t('wq_dismiss')) + '</button>' : '') +
      '</div></div>';
  }).join('');
}
if (typeof WriteQueue !== 'undefined') WriteQueue.on(function () { wqPaint(); });
