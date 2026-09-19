/* ==========================================================================
   LAYERS — everything that floats, shut in one place          [Layers]
   --------------------------------------------------------------------------
   THE BUG THIS EXISTS FOR. The shelf map's bay card (`.sm-peek`) is appended
   to `<body>`, not to `#view` — it has to be, because the map repaints itself
   under it and a card inside the view would be wiped mid-press. So when
   somebody pressed a bay and then went to another screen, `render()` rewrote
   `#view` underneath and the card STAYED: a popup about a shelf, floating
   over the till, with nothing on screen to close it.

   It is not one popup. Fourteen things in this app float outside `#view` —
   modals, bottom sheets, the drawer, the three topbar popovers, the search
   results, the colour chooser, SelectBox's panel, the date picker, the
   command palette, the shelf map's peek and its HUD, the order desk's two
   drop lists, and the row menus on three different cards. Every one of them
   could outlive the screen it belongs to, and fixing them one at a time is
   how the fifteenth gets forgotten.

   SO THERE IS ONE LIST AND ONE CLEANUP.

   - `Layers.route()` is called by `go()` before it renders. Every layer
     closes, and every module's own state goes with it — a class taken off a
     node is not enough, because these screens repaint themselves and put it
     straight back (the quick-fix log has that lesson from the Safeers card).
   - `Layers.closeTop()` shuts the topmost one only: Escape, and the phone's
     back gesture.
   - `Layers.anyOpen()` / `Layers.open()` answer what is floating right now,
     which is what a suite has to be able to ask.

   THE BACK GESTURE. A sheet is a place, to the person holding the phone, and
   the back swipe should shut it rather than leave the screen. While anything
   is open a marker entry is pushed with the SAME url (so no hashchange, so no
   route change), and the back press pops it: `popstate` finds the marker
   gone, sees a layer open, and closes it instead of navigating. Closing the
   layer any other way takes the marker back out with `history.back()`, and a
   route change REUSES the marker entry (`go()` replaces it rather than
   pushing) so no dead back press is left behind. Everything is wrapped: a
   browser that refuses pushState simply has no back gesture here, and
   nothing else changes.

   ADDING A LAYER: register it. `Layers.register(name, isOpen, close, rank)`,
   a low rank being the topmost. The generic ones below are registered by this
   file; a module with real state of its own registers at the bottom of its
   own IIFE.
   ========================================================================== */

var Layers = (function () {

  var list = [];

  function register(name, isOpen, close, rank) {
    /* Registering the same name twice replaces it, so a module reloaded in a
       console session does not end up with two closers. */
    list = list.filter(function (l) { return l.name !== name; });
    list.push({ name: name, isOpen: isOpen, close: close, rank: rank == null ? 50 : rank });
    list.sort(function (a, b) { return a.rank - b.rank; });
  }

  function safe(fn) { try { return fn(); } catch (e) { return false; } }

  /* Which layers are open, topmost first. */
  function open() {
    var out = [];
    list.forEach(function (l) { if (safe(l.isOpen)) out.push(l.name); });
    return out;
  }
  function anyOpen() { return open().length > 0; }

  function closeTop() {
    for (var i = 0; i < list.length; i++) {
      if (safe(list[i].isOpen)) { safe(list[i].close); afterClose(); return list[i].name; }
    }
    return null;
  }

  function closeAll() {
    /* Every one of them, whatever the others throw — a layer that will not
       close must not leave the twelve after it on the screen. */
    for (var i = 0; i < list.length; i++) safe(list[i].close);
    return open();
  }

  /* ------------------------------------------------------- the back gesture */

  var marked = false;      /* a marker entry is on the history stack */
  var popSelf = false;     /* the next popstate is our own history.back() */
  var pending = 0;         /* an unmark waiting to see whether a layer reopens */

  function mark() {
    /* A DIALOG REPLACING A DIALOG IS NOT A CLOSE. openModal() closes the old
       one before it draws the new one, so without this the marker was taken
       off and put back in the same beat — and because history.back() is
       ASYNC, the pop landed after the new push and removed the new marker
       instead. The stack then had no marker while this module believed it
       did, and the next close popped a real route entry: the money screen
       walked back to whatever was open before it, on its own, after a save.
       Found by a suite that went flaky rather than red. */
    if (pending) { clearTimeout(pending); pending = 0; }
    if (marked) return;
    try { history.pushState({ ogLayer: 1 }, '', location.href); marked = true; }
    catch (e) { /* file://, or a browser refusing: no back gesture, nothing else */ }
  }

  /* A layer closed by the ✕, the backdrop or Escape: take the marker back
     off the stack, or Back would do nothing once for every dialog opened. */
  function unmark() {
    if (!marked) return;
    marked = false;
    /* AND ONLY IF THE TOP OF THE STACK IS REALLY OURS. Anything else and the
       back press belongs to the person, not to this module — a dialog must
       never be able to navigate the shop backwards by closing itself. */
    var st = null;
    try { st = history.state; } catch (e) {}
    if (!st || !st.ogLayer) return;
    popSelf = true;
    try { history.back(); } catch (e) { popSelf = false; }
    setTimeout(function () { popSelf = false; }, 500);
  }

  /* Called after any close that did not come from a back press. The wait is
     one turn of the loop: long enough for openModal to draw the dialog it is
     replacing the old one with, short enough that nobody could press Back in
     between. */
  function afterClose() {
    if (anyOpen()) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () { pending = 0; unmark(); }, 0);
  }

  /* Called by go() BEFORE it writes the hash. Everything shuts, and the
     answer says whether the marker entry is free to be reused for the new
     route — `history.replaceState` rather than a push, so the stack does not
     keep a dead entry pointing at the screen we have just left. */
  function route() {
    /* THE MARKER IS DROPPED FIRST, and the order is the whole of it. Closing
       the dialog runs syncOverlay, which calls afterClose(), which would
       take the marker off with `history.back()` — and the navigation that
       asked for this cleanup would then be undone by it. Measured: `go()`
       with a dialog open landed on the screen behind, not the one asked
       for. Clear the flag, THEN close. */
    if (pending) { clearTimeout(pending); pending = 0; }
    var reuse = marked;
    marked = false;
    closeAll();
    return reuse;
  }

  function onPop() {
    if (popSelf) { popSelf = false; return; }
    if (!marked) return;
    marked = false;
    if (anyOpen()) closeTop();
  }

  /* ------------------------------------------------------- the generic list */

  function el(id) { return document.getElementById(id); }
  function gone(id) { var e = el(id); if (e && e.parentNode) e.parentNode.removeChild(e); }
  function emptied(id) { var e = el(id); if (e) e.innerHTML = ''; }

  var started = false;

  function start() {
    /* boot() can run more than once in a session (a re-login, the panel's
       reload), and a second set of document listeners would answer every
       Escape twice. */
    if (started) return;
    started = true;

    /* Rank is paint order, top first. The colour chooser draws on its own
       layer at z 970 above everything, then dialogs, then the furniture. */
    register('colourpick',
      function () { return typeof ColourPick !== 'undefined' && ColourPick.isOpen(); },
      function () { if (typeof ColourPick !== 'undefined' && ColourPick.cancel) ColourPick.cancel(); }, 10);

    register('modal', function () { return !!(el('modal-root') && el('modal-root').firstChild); },
      function () { closeModal(); }, 20);

    register('drawer', function () { return !!(el('drawer-root') && el('drawer-root').firstChild); },
      function () { closeDrawer(); }, 25);

    register('selectbox', function () { return typeof SelectBox !== 'undefined' && SelectBox.isOpen(); },
      function () { SelectBox.close(); }, 30);

    register('datepick', function () { return typeof DatePick !== 'undefined' && DatePick.isOpen(); },
      function () { DatePick.close(); }, 30);

    register('palette', function () { return typeof Palette !== 'undefined' && Palette.isOpen(); },
      function () { Palette.close(); }, 30);

    /* The three topbar popovers and the search results. They are built into
       the topbar's own markup, so they are emptied, not removed. */
    register('popovers',
      function () {
        return !!el('notifPop') || !!el('acctPop') || !!el('whoPop') ||
               !!(el('searchResults') && el('searchResults').innerHTML);
      },
      function () { gone('notifPop'); gone('acctPop'); gone('whoPop'); emptied('searchResults'); }, 40);

    /* The one this was written for. */
    register('shelfmap',
      function () { return typeof ShelfMap !== 'undefined' && !!ShelfMap.layersOpen && ShelfMap.layersOpen(); },
      function () { if (typeof ShelfMap !== 'undefined' && ShelfMap.closeLayers) ShelfMap.closeLayers(); }, 50);

    register('desk-drops',
      function () { return typeof Desk !== 'undefined' && !!Desk.dropsOpen && Desk.dropsOpen(); },
      function () { if (typeof Desk !== 'undefined' && Desk.closeDrops) Desk.closeDrops(); }, 55);

    register('row-menus',
      function () {
        if (document.querySelector('.dlb-menu.on')) return true;
        if (typeof Safeers !== 'undefined' && Safeers.menuOpen && Safeers.menuOpen()) return true;
        if (typeof Staff !== 'undefined' && Staff.menuOpen && Staff.menuOpen()) return true;
        return false;
      },
      function () {
        [].forEach.call(document.querySelectorAll('.dlb-menu.on'),
          function (m) { m.classList.remove('on'); });
        if (typeof Safeers !== 'undefined' && Safeers.closeMenu) Safeers.closeMenu();
        if (typeof Staff !== 'undefined' && Staff.closeMenu) Staff.closeMenu();
      }, 60);

    /* Escape. app-boot already answers it for the modal and the drawer, and
       ColourPick for its own, both before this one — so this is the rest:
       a popover, a drop list, a bay card, a row menu. It does not
       preventDefault, because nothing here is the only meaning of Escape. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (el('modal-root') && el('modal-root').firstChild) return;
      if (el('drawer-root') && el('drawer-root').firstChild) return;
      if (anyOpen()) closeTop();
    });

    /* Outside press. Capture, so it runs before the delegated dispatcher
       removes the node that was pressed. Only the layers nothing else is
       already watching: app-boot closes the topbar popovers, deliveries its
       row menus, safeers its own, desk its drop lists. */
    document.addEventListener('pointerdown', function (e) {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('.sm-peek, .sm-hud, #smRoom, .sm-plan, .sm-canvas')) return;
      if (typeof ShelfMap !== 'undefined' && ShelfMap.closeLayers && ShelfMap.layersOpen &&
          ShelfMap.layersOpen()) { ShelfMap.closeLayers(); }
    }, true);

    window.addEventListener('popstate', onPop);
    watchViewport();
  }

  /* ---------------------------------------------------- the phone keyboard

     A FIXED ELEMENT IS FIXED TO THE LAYOUT VIEWPORT, NOT TO WHAT YOU CAN
     SEE. When the phone keyboard comes up the layout viewport does not
     change at all, so a bottom sheet goes on sitting at the bottom of a page
     that is now half covered — and the Save button, which is the only reason
     the sheet was opened, is behind the keys. There is no CSS for this:
     `100dvh` answers the browser chrome, not the keyboard.

     `visualViewport` is what knows. Two variables come out of it and the
     stylesheet does the rest: `--vvh`, how tall the visible part is, and
     `--kb`, how much of the bottom the keyboard has taken. Both are plain
     pixels, both have sane fallbacks in the CSS, and a browser without
     visualViewport (none the shop owns) simply keeps those fallbacks. */
  function watchViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    var root = document.documentElement;
    var raf = 0;
    function sync() {
      raf = 0;
      var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      root.style.setProperty('--kb', kb + 'px');
      /* 120px, because a browser's own toolbar shrinking as the page scrolls
         is not a keyboard and must not move a sheet. */
      document.body.classList.toggle('kb-open', kb > 120);
    }
    function queue() { if (!raf) raf = requestAnimationFrame(sync); }
    vv.addEventListener('resize', queue);
    vv.addEventListener('scroll', queue);
    window.addEventListener('orientationchange', queue);
    sync();
  }

  return {
    register: register, open: open, anyOpen: anyOpen,
    closeTop: function () { var n = closeTop(); return n; },
    closeAll: function () { var left = closeAll(); afterClose(); return left; },
    route: route, mark: mark, unmark: unmark, afterClose: afterClose,
    start: start,
    /* for a harness */
    marked: function () { return marked; },
    _list: function () { return list.map(function (l) { return l.name; }); }
  };
})();
