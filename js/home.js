/* ==========================================================================
   HOME — the jobs, as buttons                        [Home]        [data-hm]
   --------------------------------------------------------------------------
   Night shift 03. Every account opens here, and what it sees is a grid of
   four to six big buttons: the things that person DOES, in the order they do
   them, each landing on the job itself rather than on a screen with tabs.

   WHY THIS EXISTS. The shop's people are not computer people. Before this,
   a cashier opened on a wall of her own figures, a warehouse hand on four
   stats and two tables, and neither screen had a verb on it — the work was
   behind a menu of eleven entries that had to be read and understood first.
   The audit counted it: every job was reachable, and none of them was
   findable.

   THREE RULES, and the first is the one that keeps this honest:

   1. IT IS BUILT FROM PERMISSIONS, NOT FROM ROLE NAMES. A job is offered
      only when the account can open the screen (`navAllowed`) AND holds the
      permission that does the work. The role only decides the ORDER. A
      custom account — somebody given four extra ticks in Access — gets the
      buttons its own permissions allow, which is the whole point of having
      per-person permissions at all.

   2. IT IS DISPLAY, NEVER A BOUNDARY. Every button lands on a route the
      server already allows that account. Hiding one protects nothing and is
      not meant to: `requirePerm` refuses a hand-sent request exactly as it
      did before, and the suite asserts that for every job a role does not
      have.

   3. A FIGURE THAT WAS NOT SENT IS ABSENT, NOT ZERO. The little numbers
      under the buttons come from blocks of `DB.dash` that the server leaves
      out for an account that may not read them. "0 sold today" to somebody
      who is not allowed to know is a lie; they get a dash.

   The owner's and the developers' dashboards are UNTOUCHED and are drawn
   underneath their buttons — they are the two people who read a dashboard on
   purpose, and the client meetings are run off it.
   ========================================================================== */

var Home = (function () {

  /* ------------------------------------------------------------- the jobs

     One table. `perm` is what the job needs to be DONE (a list means any of
     them, the meaning requirePerm gives one); `view` + `tab` is where it
     lands, through navTo, which is the same door the dashboard shortcuts and
     the deep links use — so a job button cannot drift from the screen it
     names. `icon` is a 24-grid path, like NAV's. */
  var JOBS = [
    { id: 'sell', view: 'pos', perm: 'sell', key: 'hm_sell',
      icon: 'M3 4h3l2 10h9l2-7H7M9 19a1 1 0 1 0 2 0 1 1 0 1 0-2 0m7 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0' },
    { id: 'order', view: 'desk', perm: 'delivery.desk', key: 'hm_order',
      icon: 'M3 7h18v4H3zM5 11v9h14v-9M9 7V4h6v3M10 15h4' },
    { id: 'arrived', view: 'warehouse', tab: 'arrived', perm: 'stock.move', key: 'rc_tab',
      icon: 'M3 7h18v4H3zM5 11v9h14v-9M9 15h6' },
    { id: 'move', view: 'warehouse', tab: 'move', perm: 'stock.move', key: 'wh_job_move',
      icon: 'M4 8h12M12 4l4 4-4 4M20 16H8M12 12l-4 4 4 4' },
    { id: 'find', view: 'warehouse', tab: 'stock', perm: 'stock.read', key: 'wh_job_find',
      icon: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4' },
    { id: 'deliveries', view: 'deliveries', perm: 'delivery.read', key: 'nav_deliveries',
      icon: 'M3 16V6h11v10M14 9h4l3 3v4h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3' },
    { id: 'money', view: 'money', perm: 'money.read', key: 'nav_money',
      icon: 'M3 8h18v11H3zM3 8l2-4h14l2 4M12 11a2 2 0 1 0 0 4 2 2 0 0 0 0-4' },
    { id: 'closeday', view: 'money', tab: 'close', perm: ['money.count', 'money.move'], key: 'dc_tab',
      icon: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3' },
    { id: 'expense', view: 'money', tab: 'expenses', perm: 'money.write', key: 'cb_go_expense',
      icon: 'M12 5v14M5 12h14' },
    { id: 'products', view: 'products', perm: 'product.read', key: 'nav_products',
      icon: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10' },
    { id: 'addprod', view: 'warehouse', tab: 'add', perm: 'product.write', key: 'tab_add',
      icon: 'M12 5v14M5 12h14' },
    { id: 'count', view: 'warehouse', tab: 'count', perm: 'stock.count', key: 'st_count',
      icon: 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3' },
    { id: 'labels', view: 'labels', perm: 'label.print', key: 'nav_labels',
      icon: 'M4 5v14M8 5v14M11 5v9M14 5v14M17 5v9M20 5v14' },
    { id: 'customers', view: 'customers', perm: 'customer.read', key: 'nav_customers',
      icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 20v-2a3 3 0 0 0-2-2.8' },
    { id: 'reports', view: 'reports', perm: 'report.read', key: 'nav_reports',
      icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
    { id: 'safeers', view: 'safeers', perm: 'safeer.read', key: 'nav_safeers',
      icon: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20v-1a5 5 0 0 1 10 0v1M12 20v-1a5 5 0 0 1 10 0v1' },
    /* Staff lives inside Settings, so it needs BOTH: the permission to manage
       people and the permission to open the screen it is on. */
    { id: 'staff', view: 'settings', perm: 'staff.write', key: 'hm_staff',
      icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6' }
  ];

  /* The ORDER each role sees. Only the order — every one of these is still
     filtered by what the account may actually do, so a manager who has been
     given money.read gets the Money button in the manager's position. */
  var ORDER = {
    cashier:   ['sell', 'find', 'customers', 'closeday', 'expense'],
    warehouse: ['arrived', 'move', 'find', 'addprod', 'count', 'labels'],
    manager:   ['order', 'deliveries', 'arrived', 'money', 'products', 'closeday'],
    owner:     ['money', 'deliveries', 'products', 'reports', 'staff', 'order'],
    developer: ['money', 'deliveries', 'products', 'reports', 'staff', 'order']
  };

  /* An account whose role is not in the table — or one given permissions its
     role does not normally carry — is read down this list instead. Selling
     and receiving first, because they are the two jobs somebody is standing
     up to do. */
  var FALLBACK = ['sell', 'order', 'arrived', 'move', 'find', 'deliveries', 'money',
                  'closeday', 'products', 'customers', 'labels', 'count', 'addprod',
                  'reports', 'safeers', 'staff', 'expense'];

  var MAX = 6;

  function job(id) {
    for (var i = 0; i < JOBS.length; i++) if (JOBS[i].id === id) return JOBS[i];
    return null;
  }

  function may(j) {
    if (!j) return false;
    if (!navAllowed(j.view)) return false;
    var p = j.perm;
    return Array.isArray(p) ? p.some(allow) : allow(p);
  }

  /* The buttons this account gets, in its role's order, cut at six. */
  function jobsFor() {
    var order = ORDER[roleOf()] || FALLBACK;
    var out = [], seen = {};
    order.concat(FALLBACK).forEach(function (id) {
      if (seen[id] || out.length >= MAX) return;
      var j = job(id);
      if (!may(j)) return;
      seen[id] = 1;
      out.push(j);
    });
    return out;
  }

  /* ------------------------------------------------------- the live counts

     Only from what is already in memory. This screen must not add a request
     to the boot — it is the first thing drawn, every morning, on a till. A
     count that cannot be known without asking the server is simply not
     drawn, which is why several jobs have none. */
  function countFor(id) {
    try {
      if (id === 'arrived') {
        var open = DB.purchaseOrders.filter(function (p) {
          return p.status !== 'received' && p.status !== 'cancelled';
        }).length;
        return open ? { n: open, key: 'hm_c_orders' } : null;
      }
      /* On "Move stock" only. It was on "Where is it?" too, and the same
         number twice on one screen reads as two different facts. This one
         belongs to the job that DOES something about it. */
      if (id === 'move') {
        var low = DB.floorOuts().length;
        return low ? { n: low, key: 'hm_c_low', tone: 'warn' } : null;
      }
      if (id === 'products') {
        var n = DB.products.filter(function (p) { return !p.archived; }).length;
        return n ? { n: n, key: 'hm_c_products' } : null;
      }
      if (id === 'deliveries') {
        /* The board's own summary is behind a request this screen does not
           make. `DB.dash.todo` is already here and carries the parcels that
           need somebody — near enough, and honest about being a to-do. */
        var todo = (DB.dash && DB.dash.todo) ? DB.dash.todo.rows || [] : null;
        if (!todo) return null;
        var d = todo.filter(function (a) { return String(a.kind || '').indexOf('run_') === 0 || a.kind === 'delivery_late'; }).length;
        return d ? { n: d, key: 'hm_c_todo', tone: 'warn' } : null;
      }
    } catch (e) { /* a screen must never fail to draw over a count */ }
    return null;
  }

  /* --------------------------------------------------------- the figures

     At most three, and only the ones this account was actually sent. A block
     the server left out draws a dash: absent is not zero. */
  function figures() {
    var r = roleOf(), out = [];
    var me = (DB.dash && DB.dash.me !== undefined) ? DB.dash.me : null;
    var sales = (DB.dash && DB.dash.sales !== undefined) ? DB.dash.sales : null;

    if (r === 'cashier') {
      out.push({ k: 'my_sales_today', v: me ? moneyPair(me.takings.syp, me.takings.usd, true) : null });
      out.push({ k: 'my_invoices', v: me ? '<bdi dir="ltr">' + nf(me.count) + '</bdi>' : null });
      var shift = (DB.dash && DB.dash.shift !== undefined) ? DB.dash.shift : null;
      if (shift) {
        out.push({ k: 'my_shift', v: shift.open
          ? '<bdi dir="ltr">' + hhmm(shift.openedAt) + '</bdi>'
          : '<span class="warn">' + t('shift_none') + '</span>' });
      }
    } else if (r === 'warehouse') {
      var arrivals = (DB.dash && DB.dash.arrivals !== undefined) ? DB.dash.arrivals : null;
      out.push({ k: 'arrived_today', v: arrivals ? '<bdi dir="ltr">' + nf(arrivals.pieces || arrivals.count || 0) + '</bdi>' : null });
      out.push({ k: 'to_move_out', v: '<bdi dir="ltr">' + nf(DB.floorOuts().length) + '</bdi>' });
      out.push({ k: 'open_orders', v: '<bdi dir="ltr">' + nf(DB.purchaseOrders.filter(function (p) {
        return p.status !== 'received' && p.status !== 'cancelled'; }).length) + '</bdi>' });
    } else if (r === 'manager') {
      out.push({ k: 'dash_takings', v: sales ? moneyPair(sales.takings.syp, sales.takings.usd, true) : null });
      out.push({ k: 'invoices', v: sales ? '<bdi dir="ltr">' + nf(sales.count) + '</bdi>' : null });
      out.push({ k: 'to_move_out', v: '<bdi dir="ltr">' + nf(DB.floorOuts().length) + '</bdi>' });
    }
    return out.slice(0, 3);
  }

  /* ------------------------------------------------------------- drawing */

  function greeting() {
    var who = (typeof firstName === 'function') ? firstName() : '';
    var hour = new Date().getHours();
    var word = t(hour < 12 ? 'hi_morning' : hour < 18 ? 'hi_afternoon' : 'hi_evening');
    return who ? word + ', ' + esc(who) : t('hm_title');
  }

  function view() {
    var list = jobsFor();
    var h = '<div class="page-head"><div><h1>' + greeting() + '</h1>' +
      '<div class="sub">' + t('hm_sub') + ' · ' + fmtDate(new Date()) + '</div></div></div>';

    if (!list.length) {
      /* Nobody should reach this — every role has at least one job — but an
         account stripped of everything must not land on a blank page. */
      return h + '<div class="card"><div class="cart-empty"><b>' + t('hm_none') + '</b>' +
        t('hm_none_sub') + '</div></div>';
    }

    h += '<div class="hm-grid">';
    list.forEach(function (j) {
      var c = countFor(j.id);
      h += '<button class="hm-job" data-hm="go" data-id="' + j.id + '">' +
        '<span class="hm-ico"><svg viewBox="0 0 24 24" stroke-linecap="square" stroke-linejoin="miter">' +
          '<path d="' + j.icon + '"/></svg></span>' +
        '<span class="hm-t">' + t(j.key) + '</span>' +
        (c ? '<span class="hm-c' + (c.tone ? ' ' + c.tone : '') + '">' +
               t(c.key).replace('{n}', '<bdi dir="ltr">' + nf(c.n) + '</bdi>') + '</span>' : '') +
      '</button>';
    });
    h += '</div>';

    var figs = figures();
    if (figs.length) {
      h += '<div class="hm-figs">';
      figs.forEach(function (f) {
        h += '<div class="hm-fig"><span class="eyebrow">' + t(f.k) + '</span>' +
          '<b>' + (f.v === null ? '<span class="muted">—</span>' : f.v) + '</b></div>';
      });
      h += '</div>';
    }

    /* THE OWNER'S AND THE DEVELOPERS' DASHBOARD IS UNTOUCHED, underneath.
       They are the two people who read one on purpose, and the client
       meetings are run off it. Everybody else's dashboard IS this screen. */
    if (roleOf() === 'owner' || roleOf() === 'developer') {
      h += '<hr class="dash-tear">' + viewDashboard();
    }
    return h;
  }

  /* The after-hook the owner's dashboard still needs. */
  function after() {
    if (roleOf() === 'owner' || roleOf() === 'developer') {
      if (typeof afterDashboard === 'function') afterDashboard();
    }
  }

  function register() {
    if (typeof ACTIONS === 'undefined') return;
    ACTIONS['hm-go'] = function (el) { open(el.getAttribute('data-id')); };
  }

  /* Landing on the JOB, not on a screen with tabs. navTo is the same door
     every other shortcut uses, so a button here cannot drift from the screen
     it names. */
  function open(id) {
    var j = job(id);
    if (!j || !may(j)) return;

    if (j.id === 'arrived' && typeof Receive !== 'undefined') Receive.reset();

    if (j.id === 'expense') {
      /* The expense is a dialog, not a screen: land on the tab and open it,
         because the list behind it is history and there is nothing to read
         there first. */
      navTo('money', 'expenses');
      if (typeof Money !== 'undefined' && Money.addExpense) Money.addExpense();
      return;
    }
    if (j.id === 'staff') {
      navTo('settings');
      if (typeof openStaffPanel === 'function') openStaffPanel();
      return;
    }
    if (j.id === 'move') {
      navTo('warehouse', 'move');
      if (typeof openMoveScan === 'function') openMoveScan();
      return;
    }
    navTo(j.view, j.tab);
  }

  return { view: view, after: after, register: register, jobs: jobsFor, open: open, _table: JOBS };
})();
