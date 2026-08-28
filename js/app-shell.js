/* ==========================================================================
   OG SYSTEM — application shell  ·  5/17: SHELL (roles/NAV/sidebar/topbar/
   account/search)
   --------------------------------------------------------------------------
   Split from the original js/app.js (lines 1723-2164). Loads after
   app-export.js.
   ========================================================================== */

/* -------------------------------------------------------------- 5. SHELL */

/* ------------------------------------------------------------- 5a. WHO, WHAT

   Three ways this app runs, and every permission question has to answer for
   all of them:

     signed in   — a real account with a real role. Ask the server's answer,
                   which Auth cached at sign-in.
     demo mode   — file://, GitHub Pages, serve.ps1. Nobody is signed in and
                   nothing is saved. The demo exists to SHOW the whole system,
                   so everything is permitted and no screen is trimmed.
     no Auth     — _shot.html, which loads neither api.js nor auth.js and
                   drives the Arabic proposal screenshots. Same answer as demo.

   Getting this backwards is how the proposal PDF ends up full of empty
   screens, so both fallbacks say yes rather than no. That is safe precisely
   because neither case has any real data behind it. */

function roleOf() {
  if (typeof Auth === 'undefined' || Auth.demoMode()) return null;
  var u = Auth.user();
  return u ? u.role : null;
}

function allow(perm) {
  if (typeof Auth === 'undefined' || Auth.demoMode()) return true;
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
  { id: 'dashboard',  key: 'nav_dashboard', group: 'main', icon: 'M3 12h4l2 6 4-13 2 7h6' },
  { id: 'pos',        key: 'nav_pos',       group: 'main', icon: 'M3 4h3l2 10h9l2-7H7M9 19a1 1 0 1 0 2 0 1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0' },
  { id: 'products',   key: 'nav_products',  group: 'main', icon: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10' },
  { id: 'warehouse',  key: 'nav_warehouse', group: 'main', icon: 'M3 20V9l9-5 9 5v11M7 20v-7h10v7' },
  { id: 'money',      key: 'nav_money',     group: 'main', icon: 'M3 8h18v11H3zM3 8l2-4h14l2 4M12 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4' },
  { id: 'deliveries', key: 'nav_deliveries',group: 'ops',  icon: 'M3 16V6h11v10M14 9h4l3 3v4h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3' },
  { id: 'customers',  key: 'nav_customers', group: 'ops',  icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a3 3 0 0 0-2-2.8' },
  { id: 'labels',     key: 'nav_labels',    group: 'ops',  icon: 'M4 5v14M8 5v14M11 5v9M14 5v14M17 5v9M20 5v14' },
  { id: 'print',      key: 'nav_print',     group: 'ops',  icon: 'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z' },
  { id: 'reports',    key: 'nav_reports',   group: 'ops',  icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'storefront', key: 'nav_storefront',group: 'ops',  icon: 'M4 8h16l-1 12H5zM9 8V6a3 3 0 0 1 6 0v2' },
  { id: 'settings',   key: 'nav_settings',  group: 'ops',  icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z' }
];

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
  money:      'money.read',
  deliveries: 'delivery.read',
  customers:  'customer.read',
  labels:     'label.print',
  print:      'print.read',
  reports:    'report.read',
  storefront: 'product.read',
  settings:   'config.write'
};

/* In demo mode every screen shows — the demo is meant to display the whole
   system — and with no Auth at all (_shot.html) nothing is filtered either. */
function navAllowed(id) {
  /* The partner has no shop nav at all, including the dashboard that is
     otherwise open to everyone. Their whole app is the portal. */
  if (isPartnerAccount()) return false;

  /* A driver's home screen already IS his runs, so a second menu entry to the
     same list is just a way of making him wonder which one is the real one. */
  if (id === 'deliveries' && roleOf() === 'delivery') return false;

  var need = NAV_PERM[id];
  return !need || allow(need);
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
  if (id === 'products') { return DB.criticalVariants().length; }
  if (id === 'storefront') { return DB.storeOrders.filter(function (o) { return o.status === 'pending'; }).length; }
  return 0;
}

function renderSidebar() {
  /* Partner mode takes over the whole shell — its own nav, its own brand. */
  if (OG.print.partner) { document.getElementById('sidebar').innerHTML = YALLA.sidebar(); return; }

  /* The logo is white-on-black, so on the black sidebar the wordmark sits bare. */
  var html =
    '<div class="brand">' +
      '<div class="brand-mark brand-mark-inverse"><img src="assets/logo.svg" alt="OG"></div>' +
      /* Reads CONFIG rather than a hardcoded string — otherwise renaming the
         shop in Settings changes the invoices and the labels but leaves the
         sidebar still saying OG SYSTEM. */
      '<div class="brand-text"><b>' + esc(CONFIG.SHOP_NAME.toUpperCase()) + '</b>' +
        '<span>' + t('tagline') + '</span></div>' +
    '</div><nav class="nav">';

  ['main', 'ops'].forEach(function (g) {
    var items = NAV.filter(function (n) { return n.group === g && navAllowed(n.id); });
    /* A role with nothing in a group must not get a bare heading floating
       above no buttons — delivery has an empty "Operations" otherwise. */
    if (!items.length) return;
    html += '<div class="nav-label">' + t(g === 'main' ? 'nav_main' : 'nav_ops') + '</div>';
    items.forEach(function (n) {
      var b = navBadge(n.id);
      html +=
        '<button class="nav-item' + (OG.view === n.id ? ' active' : '') + '" data-act="nav" data-view="' + n.id + '">' +
          '<span class="nav-icon"><svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter"><path d="' + n.icon + '"/></svg></span>' +
          '<span class="nav-txt">' + t(n.key) + '</span>' +
          (b ? '<span class="nav-badge">' + b + '</span>' : '') +
        '</button>';
    });
  });

  html += '</nav><div class="sidebar-foot">' + t('live') + ' · <b>v1.0</b></div>';
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
var TABS = ['dashboard', 'pos', 'products', 'print'];
var MORE_ITEMS = ['warehouse', 'deliveries', 'customers', 'labels', 'reports', 'storefront', 'settings'];

function renderTabbar() {
  var host = document.getElementById('tabbar');
  if (!host) return;

  /* The partner portal brings its own four screens; it has no More. */
  if (OG.print.partner) {
    host.innerHTML = YALLA.tabs ? YALLA.tabs() : '';
    return;
  }

  var h = '';
  TABS.forEach(function (id) {
    var n = NAV.filter(function (x) { return x.id === id; })[0];
    if (!n || !navAllowed(id)) return;
    var b = navBadge(id);
    h += '<button class="tabbtn' + (OG.view === id ? ' on' : '') + '" data-act="nav" data-view="' + id + '">' +
      '<span class="tb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg>' +
        (b ? '<i class="tb-dot"></i>' : '') + '</span>' +
      '<span class="tb-txt">' + t(n.key) + '</span></button>';
  });

  /* More always shows: even a role with no extra screens reaches sign out
     through it, and on a phone there is nowhere else to put that. */
  var inMore = MORE_ITEMS.indexOf(OG.view) > -1;
  h += '<button class="tabbtn' + (inMore ? ' on' : '') + '" data-act="more-sheet">' +
    '<span class="tb-ico"><svg viewBox="0 0 24 24" stroke-linecap="square">' +
      '<path d="M4 7h16M4 12h16M4 17h16"/></svg></span>' +
    '<span class="tb-txt">' + t('nav_more') + '</span></button>';

  host.innerHTML = h;
}

/* Everything that did not fit in five tabs, plus the two shell switches that
   were dropped from the collapsed topbar. */
function openMoreSheet() {
  var h = '<div class="more-grid">';
  MORE_ITEMS.forEach(function (id) {
    var n = NAV.filter(function (x) { return x.id === id; })[0];
    if (!n || !navAllowed(id)) return;
    var b = navBadge(id);
    h += '<button class="more-item' + (OG.view === id ? ' on' : '') + '" data-act="more-go" data-view="' + id + '">' +
      '<span class="mi-ico"><svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + n.icon + '"/></svg></span>' +
      '<span>' + t(n.key) + '</span>' +
      (b ? '<span class="nav-badge">' + b + '</span>' : '') + '</button>';
  });
  h += '</div>';

  h += '<div class="more-rows">' +
    '<div class="more-row"><span>' + t('language') + '</span><div class="seg">' +
      '<button data-act="lang" data-val="en" class="' + (OG.lang === 'en' ? 'on' : '') + '">EN</button>' +
      '<button data-act="lang" data-val="ar" class="' + (OG.lang === 'ar' ? 'on' : '') + '">ع</button>' +
    '</div></div>' +
    '<div class="more-row"><span>' + t('currency') + '</span><div class="seg">' +
      '<button data-act="curr" data-val="SYP" class="' + (OG.currency === 'SYP' ? 'on' : '') + '">SYP</button>' +
      '<button data-act="curr" data-val="USD" class="' + (OG.currency === 'USD' ? 'on' : '') + '">USD</button>' +
    '</div></div>' +
    /* Previewing the partner's portal is a manager's tool for checking what
       the other company can see. Anyone without partner.read has no business
       in there, and Yalla Wear are already in it. */
    (allow('partner.read')
      ? '<div class="more-row"><span>' + t('partner_view') + '</span>' +
        '<button class="btn btn-sm btn-dark" data-act="partner-view">' + CONFIG.PRINT_PARTNER + ' →</button></div>'
      : '') +
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
      '<input id="globalSearch" type="text" placeholder="' + t('search_ph') + '" autocomplete="off">' +
      '<div id="searchResults"></div>' +
    '</div>' +
    '<div class="spacer"></div>' +
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
    '<button class="icon-btn" data-act="bell" title="' + t('notifications') + '">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square"><path d="M18 16V10a6 6 0 1 0-12 0v6l-2 3h16zM10 21h4"/></svg>' +
      '<span class="bell-badge">' + DB.notifications.length + '</span>' +
    '</button>' +
    accountChip();
}

/* ------------------------------------------------------------- 5b. ACCOUNT */

/* Who is signed in. Three shapes, because there are three ways to be here:

     no Auth at all  — _shot.html, which loads neither api.js nor auth.js.
                       Falls back to the old static chip so the Arabic
                       proposal screenshots keep looking like a real app.
     demo mode       — file:// or a static host. Nobody to sign out.
     signed in       — the real thing.  */
function acct() {
  return (typeof Auth !== 'undefined' && !Auth.demoMode()) ? Auth.user() : null;
}

function initialsOf(name) {
  var w = String(name || '').trim().split(/\s+/);
  return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase();
}

function roleLabel(role) {
  var k = { manager: 'role_manager', cashier: 'role_cashier', warehouse: 'role_warehouse',
            delivery: 'role_delivery', partner: 'role_partner' }[role];
  return k ? t(k) : role;
}

function accountChip() {
  if (typeof Auth === 'undefined') {
    return '<div class="user-chip"><span class="user-avatar">A</span>' +
           '<span>' + t('admin') + '</span></div>';
  }

  if (Auth.demoMode()) {
    return '<div class="user-chip is-demo" title="' + esc(t('demo_no_account')) + '">' +
      '<span class="user-avatar demo">D</span><span>' + t('demo_account') + '</span></div>';
  }

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

  var custs = !allow('customer.read') ? [] : DB.customers.filter(function (c) {
    return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q) > -1;
  }).slice(0, 4);

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
           '<span>' + esc(p.name) + '</span><small class="num">' + DB.totalQty(p.id) + ' pcs</small></div>';
    });
  }
  if (custs.length) {
    h += '<div class="sr-group">' + t('nav_customers') + '</div>';
    custs.forEach(function (c) {
      h += '<div class="sr-item" data-act="search-cust" data-id="' + c.id + '">' +
           '<span class="cc-av" style="width:24px;height:24px;font-size:10px">' + c.name[0] + '</span>' +
           '<span>' + esc(c.name) + '</span><small class="num">' + tel(c.phone) + '</small></div>';
    });
  }
  if (invs.length) {
    h += '<div class="sr-group">' + t('invoices') + '</div>';
    invs.forEach(function (s) {
      h += '<div class="sr-item" data-act="search-inv" data-id="' + s.id + '">' +
           '<span>' + s.id + '</span><small class="num">' + money(s.total) + '</small></div>';
    });
  }
  if (!h) h = '<div class="sr-item muted">' + t('no_results') + '</div>';
  box.innerHTML = '<div class="search-results">' + h + '</div>';
}
