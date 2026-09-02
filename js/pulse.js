/* ==========================================================================
   PULSE — has anything moved on the line to Yalla Wear?               [Pulse]
   --------------------------------------------------------------------------
   Nothing in this app pushed. A new order, an acceptance, a stage move, an
   invoice — each was only ever seen on the next full reload, which on a
   partner's phone means "when they think to look". This asks the server a
   tiny question every half minute while the tab is visible, and only when
   the answer has changed does it refetch the one bundle that changed.

   Two rules:

   1. NEVER a blind render(). Half the screens hold typed-but-unsaved
      values — the receipt footer, a name being written onto a kit line, a
      cart. A repaint takes them back to what the server last said, mid
      sentence. The screen is redrawn only when it is one of the two that
      show this data AND nothing is open on top of it. Otherwise the bells
      update and a toast says what arrived; the person taps when ready.

   2. Only while visible. A tab in the background asks nothing; coming back
      to it asks straight away, so the first thing seen is current.
   ========================================================================== */

var Pulse = (function () {

  var EVERY_MS = 30 * 1000;
  var timer = null;
  var last = null;          // the stamp we last acted on
  var inflight = false;

  function side() { return (typeof OG !== 'undefined' && OG.print.partner) ? 'yalla' : 'og'; }

  function canAsk() {
    return typeof Shop !== 'undefined' && Shop.live() &&
           document.visibilityState === 'visible' &&
           (typeof Auth === 'undefined' || (Auth.can('print.read') || Auth.can('partner.jobs')));
  }

  /* Whether a repaint would step on somebody. A modal or a drawer open is
     a person in the middle of something; the Print screen and the whole
     partner portal are the screens this data draws. */
  function safeToRedraw() {
    if (typeof modalOpen === 'function' && modalOpen()) return false;
    var drawer = document.getElementById('drawer-root');
    if (drawer && drawer.firstChild) return false;
    return OG.print.partner || OG.view === 'print';
  }

  function newestUnread() {
    var me = side() === 'og' ? 'readOg' : 'readYl';
    var list = DB.jobMessages.filter(function (m) { return !m[me]; });
    list.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    return list[0] || null;
  }

  function announce(before) {
    var m = newestUnread();
    if (!m || (before && before.id === m.id)) return;
    var who = m.from === 'og' ? CONFIG.SHOP_NAME.toUpperCase() : 'YALLA WEAR';
    var kind = t('yl_msg_' + String(m.kind).replace(/-/g, '_'));
    toast(who + ' · ' + (m.jobId || m.invoiceId), kind + ' — ' + String(m.text).slice(0, 90), 'ok', 5000);
  }

  function apply(p) {
    var before = newestUnread();
    /* Alerts ride along for the shop side: the bell badge is per account
       and just as stale between reloads. */
    var alerts = (side() === 'og' && typeof Auth !== 'undefined')
      ? API.get('/api/notifications').catch(function () { return null; })
      : Promise.resolve(null);

    return Promise.all([Shop.partnerBundle(), alerts]).then(function (r) {
      /* Only the two things that changed. DB.hydrate is the whole-shop
         load — handed a payload with no catalogue in it, it would empty the
         catalogue — so the partner bundle goes through its own hydrator and
         the alert list is refilled in place (both arrays are shared by
         reference with everything that reads them). */
      if (r[0] && typeof hydratePartner === 'function') hydratePartner(r[0]);
      if (r[1] && r[1].notifications) {
        DB.notifications.length = 0;
        r[1].notifications.forEach(function (n) { DB.notifications.push(n); });
        DB.fullCards.length = 0;
        (r[1].fullCards || []).forEach(function (id) { DB.fullCards.push(Number(id)); });
      }

      if (typeof Notify !== 'undefined') Notify.refresh();
      if (safeToRedraw()) {
        if (typeof renderSidebar === 'function') renderSidebar();
        if (typeof render === 'function') render();
      } else if (typeof renderTopbar === 'function' && !OG.print.partner) {
        /* The alert badge lives in the topbar; the search box holds no
           unsaved state, so this one is safe anywhere. */
        renderTopbar();
      }
      announce(before);
    });
  }

  function tick() {
    if (inflight || !canAsk()) return;
    inflight = true;
    Shop.pulse().then(function (p) {
      var stamp = p.stamp + '|' + p.unread + '|' + p.pending;
      if (last === null) { last = stamp; return null; }
      if (stamp === last) return null;
      last = stamp;
      return apply(p);
    }).catch(function () {
      /* A missed beat is not news. The next one is thirty seconds away. */
    }).then(function () { inflight = false; });
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, EVERY_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick();
    });
    /* Seed the stamp now, so the first real tick compares against what was
       just loaded rather than against nothing. */
    tick();
  }

  /* After a write of our own the server's stamp has moved, and the next
     tick would otherwise re-download what the write's reload just fetched. */
  function settle() { last = null; }

  return { start: start, tick: tick, settle: settle };
})();
