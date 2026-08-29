/* ==========================================================================
   OG SYSTEM — the shop's real data
   --------------------------------------------------------------------------
   Everything that used to be seeded and is now the server's: the catalogue,
   what is on the shelves, who the customers are, what has been sold.

   THE BUG THIS EXISTS TO FIX. The till drew its products from js/data.js while
   the server priced and recorded sales from its own tables. Nothing connected
   them, so nothing kept them in step. A cashier scanning a shoe the browser
   knew about got `unknown item` — and the one SKU that happened to exist on
   both sides sold at the wrong price, under the wrong name, on a receipt that
   looked entirely normal. The loud failure was the lucky one.

   TWO RULES.

   1. Reads happen ONCE, at sign-in, into memory. Every DB.* accessor in the
      app is synchronous and called from inside render functions; making them
      async would mean rewriting every screen. A shop's catalogue is a few
      hundred KB, so one load is cheaper than the round trips it replaces.

   2. Writes go to the server FIRST, and only touch memory once it has agreed.
      Applying locally and posting afterwards is how a stock move looks like it
      worked, survives until the next refresh, and then silently reverts. If
      the server refuses, the screen must keep showing what the server thinks
      is true — the shop's stock figure is not a matter of local opinion.

   There is no fallback to demo data. A server that is down must stop the app,
   not quietly hand a cashier a working-looking till whose sales evaporate.
   That is the exact failure the DEMO banner exists to prevent, and it is worse
   here because nothing on screen would say so.
   ========================================================================== */

var Shop = (function () {

  /* Everything the app needs before it can draw anything, in parallel. Five
     sequential round trips on shop wifi is a visible pause on a screen that
     should already be up. */
  /* Ask only for what this account is allowed to have.

     Not an optimisation — or not only. Requesting a list the role cannot read
     gets a correct 403, and the browser logs every one of them as a failed
     request. Four of those on every single load is console noise that hides
     the errors somebody actually needs to see. The warehouse man has no
     business with the customer list; the honest thing is not to ask.

     `soft` stays underneath as the backstop. Auth.can() is the browser's
     opinion and the server's answer is the real one, so a disagreement must
     end in an empty list rather than a dead app. */
  function may(perm) {
    return typeof Auth === 'undefined' || Auth.can(perm);
  }

  function want(perm, path, empty) {
    return may(perm) ? soft(API.get(path), empty) : Promise.resolve(empty);
  }

  /* Named, not positional.

     This was a Promise.all over a plain array read back as r[0]..r[11], and
     inserting one request in the middle silently shifted every index after
     it — the kind of mistake that hands the notification bundle to the
     payroll and shows nothing wrong until somebody opens the screen. The
     names cost one Object.keys and remove the whole class. */
  var REQUESTS = {
    config:   function () { return API.get('/api/config'); },
    catalogue: function () { return API.get('/api/catalogue'); },
    customers: function () { return want('customer.read', '/api/customers', { customers: [] }); },
    sales:    function () { return want('sell', '/api/sales?limit=200', { sales: [] }); },
    movements: function () { return want('stock.read', '/api/movements?limit=400', { movements: [] }); },

    /* The print jobs, the line to Yalla Wear and the money between the two
       companies. null rather than an empty bundle when the account cannot
       read it: hydrate leaves those screens alone on null, where an empty
       bundle would blank them. */
    partner:  function () { return want('print.read', '/api/partner', null); },
    purchase: function () { return want('stock.read', '/api/purchase-orders', { purchaseOrders: [] }); },

    /* The drawer, on the same null reasoning. */
    money:    function () { return want('money.read', '/api/money', null); },
    counts:   function () { return want('stock.read', '/api/stock-counts', { stockCounts: [] }); },

    /* Their own requests on their own gates. Bundled inside /api/partner they
       were hostage to print.read, so revoking that from a manager silently
       emptied the payroll and the supplier balances with no error. */
    suppliers: function () { return want('money.read', '/api/suppliers', { suppliers: [] }); },
    employees: function () { return want('staff.read', '/api/employees', { employees: [] }); },

    /* Computed per account, so it arrives already filtered to what this
       person may see and already marked read or not. */
    alerts:   function () { return soft(API.get('/api/notifications'), { notifications: [] }); }
  };

  function load() {
    var names = Object.keys(REQUESTS);
    return Promise.all(names.map(function (n) { return REQUESTS[n](); })).then(function (list) {
      var r = {};
      names.forEach(function (n, i) { r[n] = list[i]; });

      DB.hydrate({
        config: r.config.config,
        rate: r.config.rate,
        warehouses: r.config.warehouses,
        products: r.catalogue.products,
        customers: r.customers.customers,
        sales: r.sales.sales,
        movements: r.movements.movements,
        partner: r.partner,
        purchaseOrders: r.purchase.purchaseOrders,
        money: r.money,
        stockCounts: r.counts.stockCounts,
        suppliers: r.suppliers.suppliers,
        employees: r.employees.employees,
        notifications: r.alerts.notifications
      });
      return DB;
    });
  }

  /* Only 403 is swallowed. A timeout or a dead server must still reject, or a
     cashier on broken wifi gets an app that boots looking empty rather than
     one that says the server is unreachable. */
  function soft(p, fallback) {
    return p.catch(function (err) {
      if (err && err.code === 'forbidden') return fallback;
      throw err;
    });
  }

  /* Reload after a write the server accepted, so the screen shows what was
     actually recorded rather than what we predicted. Cheap, and it is the only
     thing that keeps two tills honest with each other. */
  function reload() {
    return load().then(function () {
      if (typeof refreshAll === 'function') refreshAll();
    });
  }

  /* ------------------------------------------------------------- failing */

  /* No app, no cart, no demo data. Just the reason and how to fix it.

     Deliberately not a toast over a working-looking till: the dangerous case
     is not the server being unreachable, it is a cashier carrying on for an
     hour into memory that is thrown away when she reloads. */
  function fail(err) {
    var ar = (typeof OG !== 'undefined' && OG.lang === 'ar');
    var msg = (typeof API !== 'undefined' && API.friendly)
      ? API.friendly(err) : (err && err.message) || '';

    document.body.innerHTML =
      '<div class="boot-fail" dir="' + (ar ? 'rtl' : 'ltr') + '">' +
        '<div class="boot-fail-card">' +
          '<h1>' + (ar ? 'تعذّر تحميل بيانات المحل' : 'Could not load the shop') + '</h1>' +
          '<p class="boot-fail-why">' + esc(msg) + '</p>' +
          '<p>' + (ar
            ? 'التطبيق لن يعمل بدون الخادم. البيع الآن يعني بيعاً لا يُحفَظ في أي مكان.'
            : 'The app will not run without the server. Selling now would mean ' +
              'selling into nothing.') + '</p>' +
          '<ol>' +
            '<li>' + (ar ? 'تأكد أن خادم المحل يعمل.' : 'Check the shop server is running.') + '</li>' +
            '<li>' + (ar ? 'تأكد من الواي فاي.' : 'Check the wifi.') + '</li>' +
            '<li>' + (ar ? 'ثم أعد تحميل الصفحة.' : 'Then reload this page.') + '</li>' +
          '</ol>' +
          '<button class="btn btn-primary" onclick="location.reload()">' +
            (ar ? 'إعادة المحاولة' : 'Try again') + '</button>' +
        '</div>' +
      '</div>';

    if (typeof console !== 'undefined') console.error('[shop] load failed', err);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ------------------------------------------------------------- writing */

  function live() {
    return typeof Auth !== 'undefined' && DB.live;
  }

  /* One write at a time.

     Not a nicety. "Bring it out to the floor" is a single tap that moves real
     stock, and the round trip is long enough to fit a second impatient tap
     inside it. Two taps would be two transfers, and unlike a sale there is no
     opId to make the repeat harmless. */
  var busy = false;

  /* Every write in the app goes through here.

     `send` returns the promise from the server call. `mirror` applies the same
     change to memory and runs ONLY in demo mode, where there is no server to
     ask. `done` runs after the change is real — after the server agreed and
     the data has been re-read — so a toast built inside it can quote the
     numbers the shop actually has rather than the ones we hoped for.

     Re-reading everything rather than patching memory from the response is
     deliberate. A transfer moves two rows; a stock count writes the difference
     rather than the number sent; hiding a product changes what the catalogue
     even contains. Reproducing all of that here would be a second copy of the
     server's rules, and two copies of a rule is one copy that is wrong.

     On failure: the message, and nothing else. Memory is left exactly as it
     was, because the screen must keep showing what the server thinks is true.
     A stock figure is not a matter of local opinion. */
  function write(send, mirror, done) {
    if (!live()) {
      /* `mirror` returns whatever the local write produced — a new product,
         say — so `done` receives the same shape in both modes and the call
         site does not have to branch on which one it is in. */
      var local = mirror ? mirror() : null;
      if (done) done(local);
      return;
    }

    if (busy) return;
    busy = true;

    var reply = null;
    send()
      .then(function (res) { reply = res; return load(); })
      .then(function () {
        busy = false;
        if (typeof refreshAll === 'function') refreshAll();
        if (done) done(reply);
      })
      .catch(function (err) {
        busy = false;
        if (typeof toast === 'function') {
          toast(typeof t === 'function' ? t('warehouse_title') : 'Stock',
                API.friendly(err), 'err', 6000);
        }
        if (typeof console !== 'undefined') console.error('[shop] write failed', err);
      });
  }

  return {
    load: load,
    reload: reload,
    fail: fail,
    write: write,

    /* True when the app is running against a real server AND has loaded from
       it. Both halves matter: a signed-in session is already true in the
       moment between the login and the data arriving, and a write sent then
       would be built on a catalogue that is not there yet. */
    live: live,

    /* ---- stock ---- */
    receive: function (sku, whId, qty, note) {
      return API.post('/api/stock/receive', { sku: sku, whId: whId, qty: qty, note: note });
    },
    transfer: function (sku, from, to, qty, note) {
      return API.post('/api/stock/transfer', { sku: sku, from: from, to: to, qty: qty, note: note });
    },
    writeOff: function (sku, whId, qty, note) {
      return API.post('/api/stock/writeoff', { sku: sku, whId: whId, qty: qty, note: note });
    },
    count: function (sku, whId, counted, note) {
      return API.post('/api/stock/count', { sku: sku, whId: whId, counted: counted, note: note });
    },

    /* ---- catalogue ---- */
    newProduct: function (body) { return API.post('/api/products', body); },
    updateProduct: function (id, fields) { return API.patch('/api/products/' + id, fields); },
    addVariant: function (productId, size, shelf) {
      return API.post('/api/products/' + productId + '/variants', { size: size, shelf: shelf });
    },
    hideProduct: function (id, hidden) {
      return API.patch('/api/products/' + id, { hidden: hidden ? 1 : 0 });
    },

    /* ---- customers ---- */
    /* ---- the partner half ---------------------------------------------
       Thin on purpose: every rule that matters — the stage order, the names
       gate, the acceptance gate — is enforced on the server, because Yalla
       Wear is a different company and the browser is not a boundary. */
    newPrintJob:   function (body)        { return API.post('/api/print-jobs', body); },
    setJobStage:   function (id, stage)   { return API.patch('/api/print-jobs/' + id + '/stage', { stage: stage }); },
    setJobLines:   function (id, lines)   { return API.patch('/api/print-jobs/' + id + '/lines', { lines: lines }); },
    sendOrder:     function (id)          { return API.post('/api/print-jobs/' + id + '/order', {}); },
    respondOrder:  function (id, ok, o)   { return API.post('/api/print-jobs/' + id + '/respond', { accept: !!ok, promisedAt: (o||{}).promisedAt || null, note: (o||{}).note || null }); },
    postMessage:   function (body)        { return API.post('/api/messages', body); },
    markMsgRead:   function (body)        { return API.post('/api/messages/read', body); },
    newInvoice:    function (body)        { return API.post('/api/partner-invoices', body); },
    payInvoice:    function (id, body)    { return API.post('/api/partner-invoices/' + id + '/payments', body); },
    saveSupplier:  function (body)        { return API.post('/api/suppliers', body); },
    saveEmployee:  function (body)        { return API.post('/api/employees', body); },

    /* ---- purchase orders ---- */
    newPO:      function (body)     { return API.post('/api/purchase-orders', body); },
    sendPO:     function (id)       { return API.post('/api/purchase-orders/' + id + '/send', {}); },
    receivePO:  function (id, got)  { return API.post('/api/purchase-orders/' + id + '/receive', { received: got || null }); },
    cancelPO:   function (id)       { return API.post('/api/purchase-orders/' + id + '/cancel', {}); },

    /* One alert by key, or all of them. */
    markAlertRead: function (key)   { return API.post('/api/notifications/read', { key: key || null }); },

    /* ---- the drawer ----
       All server-first through Shop.write rather than optimistic. Money is
       the one place where applying locally and posting afterwards is exactly
       wrong: a payment that looks recorded and is not is worse than a
       payment that takes a moment to appear. */
    openShift:   function (body)      { return API.post('/api/shifts', body); },
    closeShift:  function (id, count) { return API.post('/api/shifts/' + id + '/close', { counted: count }); },
    addExpense:  function (body)      { return API.post('/api/expenses', body); },
    payDebt:     function (body)      { return API.post('/api/debt-payments', body); },

    /* ---- the count sheet ---- */
    startCount:     function (body)      { return API.post('/api/stock-counts', body); },
    saveCountLines: function (id, lines) { return API.put('/api/stock-counts/' + id + '/lines', { lines: lines }); },
    postCount:      function (id)        { return API.post('/api/stock-counts/' + id + '/post', {}); },
    cancelCount:    function (id)        { return API.post('/api/stock-counts/' + id + '/cancel', {}); },

    newCustomer: function (body) { return API.post('/api/customers', body); },
    updateCustomer: function (id, fields) { return API.patch('/api/customers/' + id, fields); },
    adjustPoints: function (id, delta, reason) {
      return API.post('/api/customers/' + id + '/points', { delta: delta, reason: reason });
    }
  };
})();
