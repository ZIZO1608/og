/* ==========================================================================
   THE DATE PICKER                                                 [DatePick]
   --------------------------------------------------------------------------
   Every `<input type="date">` in the app opens this instead of the browser's
   own calendar. The browser's was two problems on this skin: its calendar
   glyph is dark on a dark field (the invert filter left it at 60%, which on
   a shop laptop's screen is nothing), and on a phone the tiny glyph was the
   only thing that opened it.

   SelectBox's rule, kept: THE INPUT STAYS THE SOURCE OF TRUTH. Nothing is
   replaced. The field keeps its id, its value (ISO YYYY-MM-DD, so no server
   route changes), its min and max, its `data-change` and `onchange`. This
   file makes the input read-only (so the system picker never opens), paints
   the date over it in the app's own words (`fmtDate`), and writes a pick
   back with `input` and `change` events, so every existing handler runs as
   it always did. A date field written next year is covered with no call to
   remember: a MutationObserver dresses any that appears.

   The whole field opens it. Keyboard: Enter / Space / ↓ on the field opens;
   the arrows walk days (mirrored in Arabic), Page Up / Down walk months
   (Shift for years), Home is today, Enter picks, Escape closes and hands the
   focus back. Under 480px it is a bottom sheet with thumb-sized days.

   The week starts on SATURDAY, in both languages: the shop's week ends on
   Friday, and a calendar that disagrees with the shop's week is read wrong.
   ========================================================================== */

var DatePick = (function () {

  var S = null;   /* { inp, pop, back, y, m, at (ISO under the keyboard), was } */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function today() { var d = new Date(); return iso(d.getFullYear(), d.getMonth(), d.getDate()); }
  function parse(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }
  function shift(s, days) {
    var d = parse(s) || new Date();
    d.setDate(d.getDate() + days);
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function shiftMonths(s, n) {
    var d = parse(s) || new Date();
    var day = d.getDate();
    var t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    var last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    return iso(t.getFullYear(), t.getMonth(), Math.min(day, last));
  }
  function ar() { return typeof OG !== 'undefined' && OG.lang === 'ar'; }
  function tr(k, fb) { return typeof t === 'function' ? t(k) : fb; }
  function months() { return ar() ? MONTHS_AR : MONTHS_EN; }
  function allowed(inp, s) {
    if (inp.min && s < inp.min) return false;
    if (inp.max && s > inp.max) return false;
    return true;
  }
  function clamp(inp, s) {
    if (inp.min && s < inp.min) return inp.min;
    if (inp.max && s > inp.max) return inp.max;
    return s;
  }

  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/>' +
             '<path d="M3.5 9.5h17M8 3v4M16 3v4"/><path class="dp-dot" d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01"/></svg>';
  var CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  var CHEV2 = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5l-7 7 7 7M19 5l-7 7 7 7"/></svg>';

  /* --------------------------------------------------------- the field */

  function isTarget(el) {
    return el && el.tagName === 'INPUT' && el.type === 'date';
  }

  /* The face is a sibling painted over the input, inside a wrapper this file
     makes. Moving the input into the wrapper keeps every reference to it:
     code finds it by id or by attribute, never by position. */
  function dress(inp) {
    if (inp.getAttribute('data-dp')) return;
    inp.setAttribute('data-dp', '1');
    inp.readOnly = true;
    inp.classList.add('dp-inp');
    if (!inp.hasAttribute('dir')) inp.setAttribute('dir', 'ltr');

    var wrap = document.createElement('div');   /* not a span: .field > span is the label's style */
    wrap.className = 'dp-wrap' + (inp.classList.contains('inp') ? ' dp-block' : '');
    var face = document.createElement('span');
    face.className = 'dp-face';
    face.setAttribute('aria-hidden', 'true');
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    wrap.appendChild(face);

    /* A value written by code fires no event; the face must still follow it. */
    var proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    try {
      Object.defineProperty(inp, 'value', {
        configurable: true,
        get: function () { return proto.get.call(this); },
        set: function (v) { proto.set.call(this, v); paintFace(this); }
      });
    } catch (e) { /* the face then follows events only */ }
    paintFace(inp);
  }

  function paintFace(inp) {
    var wrap = inp.parentNode;
    var face = wrap && wrap.querySelector ? wrap.querySelector('.dp-face') : null;
    if (!face) return;
    var d = parse(inp.value);
    var say = typeof fmtDate === 'function' ? fmtDate : function (x) { return iso(x.getFullYear(), x.getMonth(), x.getDate()); };
    var q = typeof esc === 'function' ? esc : function (x) { return String(x); };
    face.innerHTML = '<span class="dp-txt' + (d ? '' : ' dp-ph') + '">' +
      (d ? q(say(d)) : q(inp.getAttribute('placeholder') || tr('dp_pick', 'Pick a date'))) +
      '</span><span class="dp-ico">' + ICON + '</span>';
  }

  function dressAll(root) {
    if (!root || !root.querySelectorAll) return;
    if (isTarget(root)) dress(root);
    var list = root.querySelectorAll('input[type="date"]');
    for (var i = 0; i < list.length; i++) dress(list[i]);
  }

  /* ------------------------------------------------------------- the popup */

  function render() {
    if (!S) return;
    var inp = S.inp, y = S.y, m = S.m;
    var first = new Date(y, m, 1);
    /* Saturday first: getDay() 6 → column 0. */
    var lead = (first.getDay() + 1) % 7;
    var days = new Date(y, m + 1, 0).getDate();
    var sel = inp.value, now = today();
    var wd = String(tr('dp_days', 'Sat,Sun,Mon,Tue,Wed,Thu,Fri')).split(',');

    var h = '<div class="dp-head">' +
      '<button type="button" class="dp-nav" data-dp="y-1" aria-label="' + esc(tr('dp_prev_year', 'Previous year')) + '">' + CHEV2 + '</button>' +
      '<button type="button" class="dp-nav" data-dp="m-1" aria-label="' + esc(tr('dp_prev_month', 'Previous month')) + '">' + CHEV + '</button>' +
      '<div class="dp-title" aria-live="polite"><b>' + esc(months()[m]) + '</b> <span dir="ltr">' + y + '</span></div>' +
      '<button type="button" class="dp-nav dp-fwd" data-dp="m+1" aria-label="' + esc(tr('dp_next_month', 'Next month')) + '">' + CHEV + '</button>' +
      '<button type="button" class="dp-nav dp-fwd" data-dp="y+1" aria-label="' + esc(tr('dp_next_year', 'Next year')) + '">' + CHEV2 + '</button>' +
    '</div><div class="dp-grid" role="grid">';
    wd.forEach(function (w) { h += '<span class="dp-wd">' + esc(w) + '</span>'; });
    for (var i = 0; i < lead; i++) h += '<span class="dp-blank"></span>';
    for (var d = 1; d <= days; d++) {
      var s = iso(y, m, d);
      var ok = allowed(inp, s);
      h += '<button type="button" role="gridcell" class="dp-day' +
        (s === sel ? ' on' : '') + (s === now ? ' now' : '') + (s === S.at ? ' at' : '') + '"' +
        (ok ? '' : ' disabled') + ' data-dp="pick" data-d="' + s + '"' +
        (s === sel ? ' aria-selected="true"' : '') + '><span dir="ltr">' + d + '</span></button>';
    }
    h += '</div><div class="dp-foot">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-dp="clear">' + esc(tr('dp_clear', 'Clear')) + '</button>' +
      '<button type="button" class="btn btn-sm dp-today" data-dp="today"' + (allowed(inp, now) ? '' : ' disabled') + '>' +
        esc(tr('dp_today', 'Today')) + '</button>' +
    '</div>';
    S.pop.innerHTML = h;
    S.pop.setAttribute('dir', ar() ? 'rtl' : 'ltr');
    var at = S.pop.querySelector('.dp-day.at');
    if (at && document.activeElement !== at) { try { at.focus({ preventScroll: true }); } catch (e) { at.focus(); } }
  }

  function sheet() { return window.innerWidth <= 480; }

  function place() {
    if (!S) return;
    var pop = S.pop;
    if (sheet()) {
      pop.classList.add('dp-sheet');
      pop.style.left = pop.style.top = pop.style.bottom = '';
      return;
    }
    pop.classList.remove('dp-sheet');
    var r = S.inp.parentNode.getBoundingClientRect();
    var w = pop.offsetWidth, hgt = pop.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = ar() ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    var top = r.bottom + 6;
    if (top + hgt > vh - 8 && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
    top = Math.max(8, Math.min(top, vh - hgt - 8));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function open(inp) {
    close(true);
    var d = parse(inp.value) || parse(clamp(inp, today())) || new Date();
    var pop = document.createElement('div');
    pop.className = 'dp-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', inp.getAttribute('aria-label') || tr('dp_pick', 'Pick a date'));
    var back = null;
    if (sheet()) {
      back = document.createElement('div');
      back.className = 'dp-back';
      document.body.appendChild(back);
    }
    document.body.appendChild(pop);
    S = { inp: inp, pop: pop, back: back, y: d.getFullYear(), m: d.getMonth(),
          at: iso(d.getFullYear(), d.getMonth(), d.getDate()), was: inp.value, opened: Date.now() };
    inp.parentNode.classList.add('dp-open');
    render();
    place();
  }

  function close(silent) {
    if (!S) return;
    var inp = S.inp;
    if (S.pop.parentNode) S.pop.parentNode.removeChild(S.pop);
    if (S.back && S.back.parentNode) S.back.parentNode.removeChild(S.back);
    if (inp.parentNode) inp.parentNode.classList.remove('dp-open');
    S = null;
    if (!silent) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } }
  }

  function commit(v) {
    if (!S) return;
    var inp = S.inp;
    if (v && !allowed(inp, v)) return;
    var changed = inp.value !== v;
    inp.value = v;
    close();
    if (changed) {
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function go(s) {
    if (!S) return;
    s = clamp(S.inp, s);
    var d = parse(s);
    S.at = s; S.y = d.getFullYear(); S.m = d.getMonth();
    render();
  }

  /* ------------------------------------------------------------ listeners */

  function bind() {
    if (typeof document === 'undefined') return;

    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var added = list[i].addedNodes;
        for (var k = 0; k < added.length; k++) if (added[k].nodeType === 1) dressAll(added[k]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.body) dressAll(document.body);
    else document.addEventListener('DOMContentLoaded', function () { dressAll(document.body); });

    /* mousedown, not click — the same last moment SelectBox uses. A touch
       produces one as well, after the finger lifts. */
    document.addEventListener('mousedown', function (e) {
      var tgt = e.target;
      var wrap = tgt.closest ? tgt.closest('.dp-wrap') : null;
      var inp = wrap ? wrap.querySelector('input[type="date"]') : null;
      if (inp && !inp.disabled) {
        e.preventDefault();
        if (S && S.inp === inp) { close(); return; }
        try { inp.focus({ preventScroll: true }); } catch (err) { inp.focus(); }
        open(inp);
        return;
      }
      if (S && !(tgt.closest && tgt.closest('.dp-pop'))) close(true);
    });

    document.addEventListener('click', function (e) {
      if (!S) return;
      var b = e.target.closest ? e.target.closest('[data-dp]') : null;
      if (!b || !S.pop.contains(b)) return;
      var a = b.getAttribute('data-dp');
      if (a === 'pick') { commit(b.getAttribute('data-d')); return; }
      if (a === 'today') { commit(clamp(S.inp, today())); return; }
      if (a === 'clear') { commit(''); return; }
      var d = S.at;
      if (a === 'm-1') d = shiftMonths(d, -1);
      if (a === 'm+1') d = shiftMonths(d, 1);
      if (a === 'y-1') d = shiftMonths(d, -12);
      if (a === 'y+1') d = shiftMonths(d, 12);
      S.at = d; var p = parse(d); S.y = p.getFullYear(); S.m = p.getMonth();
      render();
      /* keep the focus on the arrow that was pressed, not on a day */
      var same = S.pop.querySelector('[data-dp="' + a + '"]');
      if (same) same.focus();
    });

    /* A tap on the sheet's shade closes it. */
    document.addEventListener('click', function (e) {
      if (S && S.back && e.target === S.back) close();
    });

    document.addEventListener('keydown', function (e) {
      var el = document.activeElement;
      if (!S) {
        if (isTarget(el) && el.getAttribute('data-dp') && !el.disabled &&
            (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
          e.preventDefault();
          open(el);
        }
        return;
      }
      var rtl = ar();
      var k = e.key;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (k === 'Tab') { close(true); return; }
      /* Enter on a navigation button presses it; Enter anywhere else picks. */
      if (k === 'Enter' || k === ' ') {
        if (el && el.getAttribute && /^(m|y)[+-]1$|^clear$|^today$/.test(el.getAttribute('data-dp') || '')) return;
        e.preventDefault(); commit(S.at); return;
      }
      var step = null;
      if (k === 'ArrowLeft')  step = rtl ? 1 : -1;
      if (k === 'ArrowRight') step = rtl ? -1 : 1;
      if (k === 'ArrowUp')    step = -7;
      if (k === 'ArrowDown')  step = 7;
      if (step !== null) { e.preventDefault(); go(shift(S.at, step)); return; }
      if (k === 'PageUp')   { e.preventDefault(); go(shiftMonths(S.at, e.shiftKey ? -12 : -1)); return; }
      if (k === 'PageDown') { e.preventDefault(); go(shiftMonths(S.at, e.shiftKey ? 12 : 1)); return; }
      if (k === 'Home')     { e.preventDefault(); go(today()); return; }
    }, true);   /* capture: Escape must reach here before a modal closes on it */

    window.addEventListener('scroll', function (e) {
      if (!S || Date.now() - S.opened < 200) return;
      if (e.target && e.target.nodeType === 1 && S.pop.contains(e.target)) return;
      if (sheet()) return;
      close(true);
    }, true);
    window.addEventListener('resize', function () { if (S) place(); });
  }

  bind();

  return {
    open: open,
    close: function () { close(true); },
    isOpen: function () { return !!S; },
    /* A screen that changes language repaints its fields itself; this is for
       the few that are not redrawn. */
    refresh: function () {
      var list = document.querySelectorAll('input[data-dp]');
      for (var i = 0; i < list.length; i++) paintFace(list[i]);
    }
  };
})();
