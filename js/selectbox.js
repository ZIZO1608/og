/* ==========================================================================
   BRANDED SELECT                                                [SelectBox]
   --------------------------------------------------------------------------
   The one control the theme could never reach. A <select>'s closed box is
   ours to style; the list it drops is drawn by Windows, and no amount of CSS
   changes that — the app's own dropdowns (the customer picker, the command
   palette) sit beside a grey system menu with a blue highlight.

   WHAT THIS DOES NOT DO
   ---------------------
   It does not replace the selects. All twenty-one of them stay exactly where
   they are, holding their own value, keeping their options, firing their own
   change events. Nothing that reads `el.value`, nothing bound to
   `data-change`, nothing in CHANGES or ACTIONS is touched — which is the
   whole reason this is safe to add to a working till.

   What it does is intercept the press that would open the system menu, draw
   the app's own list instead, and write the answer back into the real select
   with a change event. The select remains the single source of truth; this is
   a skin over the moment it opens.

   Consequences worth knowing:

     - A select that arrives later — in a modal, a drawer, a screen written
       next year — is covered automatically. There is no enhancement pass to
       remember to call, because nothing is enhanced.
     - Turn this file off and every dropdown still works, in system grey.

   Keyboard is deliberate, not decorative: a till is used by people who do not
   reach for the mouse. Enter, Space or the arrows open it; the arrows move;
   Enter or Tab commit; Escape cancels and puts the old value back.
   ========================================================================== */

var SelectBox = (function () {

  var state = null;        /* { sel, panel, index } while a list is open */

  function isTarget(el) {
    return el && el.tagName === 'SELECT' && el.classList.contains('inp') && !el.disabled;
  }

  function optionsOf(sel) {
    return Array.prototype.slice.call(sel.options);
  }

  /* ------------------------------------------------------------ rendering */

  function build(sel) {
    var opts = optionsOf(sel);
    var h = '';
    opts.forEach(function (o, i) {
      /* A disabled option is usually a "choose one…" placeholder. It is shown,
         because hiding it would make the list disagree with the closed box,
         but it cannot be picked. */
      h += '<div class="sbx-opt' + (i === sel.selectedIndex ? ' on' : '') +
             (o.disabled ? ' off' : '') + '" data-i="' + i + '">' +
        '<span class="sbx-txt">' + (o.textContent || '') + '</span>' +
        '<span class="sbx-tick">✓</span>' +
      '</div>';
    });

    var panel = document.createElement('div');
    panel.className = 'sbx-panel';
    panel.setAttribute('role', 'listbox');
    panel.innerHTML = h || '<div class="sbx-empty">—</div>';
    return panel;
  }

  /* Placed against the viewport rather than inside the field, so a list can
     hang out of a scrolling card or a modal without being clipped by it. The
     trade is that it must not be left behind when something scrolls, which is
     what the scroll handler below is for. */
  function place(panel, sel) {
    var r = sel.getBoundingClientRect();
    var vh = window.innerHeight;
    var below = vh - r.bottom;

    panel.style.minWidth = r.width + 'px';
    panel.style.left = r.left + 'px';

    /* Flip above when there is more room there — otherwise a field near the
       bottom of the screen opens a list nobody can read. */
    if (below < 220 && r.top > below) {
      panel.style.top = 'auto';
      panel.style.bottom = (vh - r.top + 6) + 'px';
      panel.style.maxHeight = Math.max(120, r.top - 16) + 'px';
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = (r.bottom + 6) + 'px';
      panel.style.maxHeight = Math.max(120, below - 16) + 'px';
    }
  }

  function paintActive() {
    if (!state) return;
    var rows = state.panel.querySelectorAll('.sbx-opt');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('at', i === state.index);
    }
    var at = rows[state.index];
    if (at && at.scrollIntoView) at.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------------------------------------------------- open / close */

  function open(sel) {
    close();
    var panel = build(sel);
    document.body.appendChild(panel);
    state = { sel: sel, panel: panel, index: sel.selectedIndex, was: sel.value };
    place(panel, sel);
    sel.classList.add('sbx-open');
    paintActive();
  }

  function close() {
    if (!state) return;
    if (state.panel.parentNode) state.panel.parentNode.removeChild(state.panel);
    state.sel.classList.remove('sbx-open');
    state = null;
  }

  /* Writes the answer back the way the browser would have: set the value,
     then fire `change` so every existing handler runs untouched. `input` goes
     first because a few places listen for that instead. */
  function commit(i) {
    if (!state) return;
    var sel = state.sel;
    var o = sel.options[i];
    if (!o || o.disabled) return;

    var changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    close();

    if (changed) {
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function move(step) {
    if (!state) return;
    var n = state.sel.options.length;
    if (!n) return;
    var i = state.index;
    /* Step over disabled rows rather than landing on one and appearing stuck. */
    for (var guard = 0; guard < n; guard++) {
      i = (i + step + n) % n;
      if (!state.sel.options[i].disabled) break;
    }
    state.index = i;
    paintActive();
  }

  /* ------------------------------------------------------------- listeners
     One of each, on the document, exactly like every other namespace in this
     app — so a select rendered after this file ran is still covered. */

  function bind() {
    if (typeof document === 'undefined') return;

    /* mousedown, not click: the system menu opens on press, so this is the
       last moment it can be stopped. */
    document.addEventListener('mousedown', function (e) {
      var sel = e.target;
      if (isTarget(sel)) {
        e.preventDefault();                 /* no system menu */
        var same = state && state.sel === sel;
        if (same) { close(); return; }
        /* preventDefault also cancels the focus that press would have given
           it, and a field that never takes focus cannot be tabbed out of. */
        sel.focus();
        open(sel);
        return;
      }
      if (state && !e.target.closest('.sbx-panel')) close();
    });

    document.addEventListener('click', function (e) {
      if (!state) return;
      var row = e.target.closest ? e.target.closest('.sbx-opt') : null;
      if (row && state.panel.contains(row)) commit(+row.getAttribute('data-i'));
    });

    document.addEventListener('keydown', function (e) {
      var el = document.activeElement;

      /* Closed, but focused: the keys that would have opened the system menu. */
      if (!state && isTarget(el)) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          open(el);
        }
        return;
      }
      if (!state) return;

      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); move(-1); return; }
      if (e.key === 'Home')      { e.preventDefault(); state.index = 0; paintActive(); return; }
      if (e.key === 'End')       { e.preventDefault(); state.index = state.sel.options.length - 1; paintActive(); return; }
      if (e.key === 'Enter')     { e.preventDefault(); commit(state.index); return; }
      if (e.key === 'Tab')       { commit(state.index); return; }   /* let Tab move on */
      if (e.key === 'Escape') {
        /* Cancel means cancel: the value goes back to what it was. */
        e.preventDefault();
        e.stopPropagation();
        var sel = state.sel, was = state.was;
        close();
        if (sel.value !== was) sel.value = was;
        sel.focus();
        return;
      }

      /* Type-ahead. Somebody looking for "Jerseys" presses J. */
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        var q = e.key.toLowerCase();
        var opts = optionsOf(state.sel);
        for (var k = 1; k <= opts.length; k++) {
          var i = (state.index + k) % opts.length;
          if (!opts[i].disabled && (opts[i].textContent || '').trim().toLowerCase().indexOf(q) === 0) {
            state.index = i; paintActive(); break;
          }
        }
      }
    }, true);   /* capture: Escape must reach here before a modal closes on it */

    /* An open list is positioned against the viewport, so anything that moves
       the field underneath it leaves it stranded. Closing is honest and
       cheaper than chasing the field around. */
    window.addEventListener('scroll', function () { if (state) close(); }, true);
    window.addEventListener('resize', function () { if (state) close(); });
  }

  bind();

  return { open: open, close: close, isOpen: function () { return !!state; } };
})();
