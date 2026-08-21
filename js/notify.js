/* ==========================================================================
   NOTIFICATIONS — the line between OG System and Yalla Wear      [data-nt]
   --------------------------------------------------------------------------
   Shared on purpose. Both portals render from the SAME DB.jobMessages array,
   which is the entire mechanism: there is no sync, no copy, no second source
   of truth. A message posted on one side is simply already there on the other
   because they are looking at the same objects.

   `readOg` / `readYl` are tracked separately. Reading a thread as Yalla Wear
   must never clear OG's badge — that bug would be invisible in testing and
   would quietly break the one thing this feature is for.
   ========================================================================== */

var Notify = (function () {

  var open = false;

  function side() { return (typeof OG !== 'undefined' && OG.print.partner) ? 'yalla' : 'og'; }
  function other() { return side() === 'og' ? 'yalla' : 'og'; }

  var ICON = {
    nudge:          'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 20h4',
    delay:          'M12 8v5M12 16h.01M10.3 3.9L2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0z',
    note:           'M6 2h9l5 5v15H6zM15 2v5h5',
    'name-request': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h1M17 15v6M14 18h6',
    invoice:        'M6 2h9l5 5v15H6zM9 13h7M9 17h5',
    reminder:       'M12 7v5l3 2M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    reply:          'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
    /* The handshake. An order going out is a paper plane; the answer is a tick
       or a cross; then the press, then the van. Four glyphs the shop owner can
       read down the panel without stopping to read the words. */
    order:          'M22 2L11 13M22 2l-7 20-4-9-9-4z',
    accepted:       'M20 6L9 17l-5-5',
    declined:       'M18 6L6 18M6 6l12 12',
    'in-print':     'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z',
    shipped:        'M1 3h13v13H1zM14 8h4l3 3v5h-7M5.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3'
  };

  function ico(k) {
    return '<svg viewBox="0 0 24 24" stroke-linecap="square"><path d="' + (ICON[k] || ICON.note) + '"/></svg>';
  }

  function unread() { return DB.unreadFor(side()); }

  /* The bell itself. Dropped into both topbars by their own render functions,
     so neither portal has to know how the other one draws its header. */
  /* A speech bubble, not a bell. OG's topbar already carries a bell for stock
     and payment alerts; this is a conversation with another company, and the
     two must not look like the same thing. */
  function bell() {
    var n = unread().length;
    return '<button class="nt-bell' + (n ? ' has' : '') + '" data-nt="toggle" ' +
      'title="' + esc(t('nt_title')) + '" aria-label="' + esc(t('nt_title')) + '">' +
      '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
        '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.4-4.2A8 8 0 1 1 21 12z"/>' +
        '<path d="M8.5 11h7M8.5 14.5h4"/></svg>' +
      (n ? '<span class="nt-count">' + (n > 9 ? '9+' : n) + '</span>' : '') +
    '</button>';
  }

  function agoShort(d) {
    var mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (mins < 2) return t('yl_just_now');
    if (mins < 60) return mins + t('yl_m');
    if (mins < 60 * 20) return Math.round(mins / 60) + t('yl_h');
    return relDate(d);
  }

  function who(m) {
    return m.from === 'og' ? CONFIG.SHOP_NAME.toUpperCase() : 'YALLA WEAR';
  }

  /* Everything addressed to whoever is looking, newest first. Messages you
     sent yourself are included — they are the record of what you asked for —
     but they can never be unread, so they never raise the badge. */
  function inbox() {
    return DB.jobMessages.slice().sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    }).slice(0, 14);
  }

  function panel() {
    var me = side();
    var f = me === 'og' ? 'readOg' : 'readYl';
    var list = inbox();
    var n = unread().length;

    var h = '<div class="nt-panel" id="ntPanel">' +
      '<div class="nt-head"><b>' + t('nt_title') + '</b>' +
        (n ? '<span class="nt-pill">' + n + ' ' + t('nt_new') + '</span>' : '') +
        (n ? '<button class="nt-read" data-nt="read-all">' + t('nt_read_all') + '</button>' : '') +
      '</div>';

    if (!list.length) {
      return h + '<div class="nt-empty"><b>' + t('nt_empty') + '</b><span>' + t('nt_empty_sub') + '</span></div></div>';
    }

    h += '<div class="nt-list">';
    list.forEach(function (m) {
      var mine = m.from === me;
      var ref = m.jobId || m.invoiceId;
      h += '<button class="nt-item' + (m[f] ? '' : ' unread') + (mine ? ' mine' : '') + ' k-' + m.kind + '" ' +
        'data-nt="go" data-id="' + esc(ref) + '" data-kind="' + (m.jobId ? 'job' : 'invoice') + '">' +
        '<span class="nt-ico">' + ico(m.kind) + '</span>' +
        '<span class="nt-body">' +
          '<span class="nt-top"><b>' + esc(ref) + '</b>' +
            '<span class="nt-from">' + (mine ? t('nt_you') : esc(who(m))) + '</span>' +
            '<span class="nt-ago">' + agoShort(m.at) + '</span></span>' +
          (m.reason ? '<span class="nt-reason">' + t('yl_reason_' + m.reason.replace(/-/g, '_')) + '</span>' : '') +
          '<span class="nt-txt">' + esc(m.text) + '</span>' +
        '</span></button>';
    });
    return h + '</div></div>';
  }

  function close() {
    open = false;
    var p = document.getElementById('ntPanel');
    if (p && p.parentNode) p.parentNode.removeChild(p);
    document.querySelectorAll('.nt-bell').forEach(function (b) { b.classList.remove('on'); });
  }

  function toggle(el) {
    if (open) { close(); return; }
    close();
    open = true;
    el.classList.add('on');
    el.insertAdjacentHTML('afterend', panel());
  }

  /* Jump to whatever the message is about. Crossing portals is allowed and is
     the point — OG clicking a Yalla note lands on the job in OG's own drawer,
     not in the partner portal. */
  function go(id, kind) {
    close();
    if (kind === 'invoice') {
      if (side() === 'og') {
        /* OG sees partner invoices on its own Print screen, not inside the
           partner portal — it is OG's bill to pay, so it belongs in OG. */
        OG.pr = OG.pr || {};
        OG.pr.tab = 'invoices';
        go2('print');
        setTimeout(function () { if (typeof openPartnerInvoice === 'function') openPartnerInvoice(id); }, 0);
      } else {
        YALLA.go('invoices', id);
      }
      return;
    }
    if (side() === 'og') { go2('print', function () { openJobDrawer(id); }); }
    else { YALLA.go('queue', id); }
  }

  /* `go` is taken by app.js's router; alias it so this module can use both. */
  function go2(view, cb) {
    if (typeof window.go === 'function') window.go(view, cb);
  }

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-nt]') : null;
      if (el) {
        e.preventDefault();
        var a = el.getAttribute('data-nt');
        if (a === 'toggle') return toggle(el);
        if (a === 'read-all') {
          DB.markRead(side());
          close();
          refreshBells();
          return;
        }
        if (a === 'go') return go(el.getAttribute('data-id'), el.getAttribute('data-kind'));
        return;
      }
      /* Click anywhere else closes it. */
      if (open && !(e.target.closest && e.target.closest('.nt-panel'))) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) { close(); e.stopPropagation(); }
    }, true);
  }

  /* Repaint just the bells, so a badge can update without redrawing a screen
     the user is in the middle of reading. */
  function refreshBells() {
    document.querySelectorAll('.nt-slot').forEach(function (slot) {
      slot.innerHTML = bell();
    });
  }

  bind();

  return {
    bell: function () { return '<span class="nt-slot">' + bell() + '</span>'; },
    refresh: refreshBells,
    close: close,
    unread: unread,
    side: side,
    other: other,
    isOpen: function () { return open; }
  };
})();
