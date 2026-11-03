/* ==========================================================================
   OG SYSTEM — number boxes that read an Arabic keypad             [NumBox]
   --------------------------------------------------------------------------
   A browser's type="number" throws away ٣ without a word: the box stays empty
   and the save carries nothing. The money boxes were moved to text long ago;
   this covers the other fifty-odd, and any written next year, with no call to
   remember: a MutationObserver turns each one into a text box as it appears
   (DatePick's rule), and a capture-phase listener rewrites what was typed to
   plain digits BEFORE any handler reads it. So every reader's Number(el.value)
   and Desk.toCount(el.value) works as it always did.

   min, max and step stay on the element for whoever reads them. A box with no
   min may be negative, so it keeps its minus and a keyboard that has one.
   ========================================================================== */

var NumBox = (function () {

  function decimals(el) {
    var s = el.getAttribute('step');
    return s && s.indexOf('.') > -1 ? s.split('.')[1].length : 0;
  }

  function signed(el) {
    var m = el.getAttribute('min');
    return m === null || Number(m) < 0;
  }

  function clean(raw, el) {
    var out = '';
    var dot = false;
    var keepsDecimal = decimals(el) > 0;
    String(raw).split('').forEach(function (ch) {
      var c = ch.charCodeAt(0);
      if (c >= 0x0660 && c <= 0x0669) ch = String(c - 0x0660);
      else if (c >= 0x06F0 && c <= 0x06F9) ch = String(c - 0x06F0);
      else if (ch === '٫' || (ch === ',' && keepsDecimal)) ch = '.';
      if (ch >= '0' && ch <= '9') out += ch;
      else if (ch === '.' && !dot) { out += '.'; dot = true; }
      else if (ch === '-' && !out && signed(el)) out = '-';
    });
    return out;
  }

  function dress(el) {
    if (el.getAttribute('type') !== 'number') return;
    el.setAttribute('type', 'text');
    el.setAttribute('data-numbox', '');
    el.setAttribute('autocomplete', 'off');
    if (signed(el)) {
      el.setAttribute('inputmode', 'text');
      if (!el.getAttribute('dir')) el.setAttribute('dir', 'ltr');
    } else if (!el.getAttribute('inputmode')) {
      el.setAttribute('inputmode', 'decimal');
    }
  }

  function dressAll(root) {
    if (root.matches && root.matches('input[type="number"]')) dress(root);
    if (root.querySelectorAll) [].forEach.call(root.querySelectorAll('input[type="number"]'), dress);
  }

  /* A text box has no arrows of its own, and a number box did. */
  function stepBy(el, dir) {
    var places = decimals(el);
    var step = Number(el.getAttribute('step')) || 1;
    var next = (Number(el.value) || 0) + dir * step;
    var min = el.getAttribute('min');
    var max = el.getAttribute('max');
    if (min !== null && next < Number(min)) next = Number(min);
    if (max !== null && next > Number(max)) next = Number(max);
    el.value = next.toFixed(places);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function bind() {
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var added = list[i].addedNodes;
        for (var k = 0; k < added.length; k++) if (added[k].nodeType === 1) dressAll(added[k]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    dressAll(document.documentElement);

    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el || !el.hasAttribute || !el.hasAttribute('data-numbox')) return;
      var was = el.value;
      var now = clean(was, el);
      if (now === was) return;
      var caret = clean(was.slice(0, el.selectionStart), el).length;
      el.value = now;
      el.setSelectionRange(caret, caret);
    }, true);

    document.addEventListener('keydown', function (e) {
      var el = e.target;
      if (!el || !el.hasAttribute || !el.hasAttribute('data-numbox') || el.readOnly || el.disabled) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      stepBy(el, e.key === 'ArrowUp' ? 1 : -1);
    });
  }

  if (typeof document !== 'undefined') bind();

  return { clean: clean };
})();
