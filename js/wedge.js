/* ==========================================================================
   KEYBOARD WEDGE — hardware barcode scanners                      [Wedge]
   --------------------------------------------------------------------------
   A USB-cable scanner, a 2.4GHz dongle scanner and a Bluetooth HID scanner all
   enumerate as a KEYBOARD. They type the code and press Enter. So one listener
   covers every scanner the shop might buy, on any browser, with no drivers, no
   pairing code and no permission prompt.

   Until now a scan only registered when the POS search box happened to be
   focused. A real scanner fires wherever the cursor is — or nowhere.

   TWO WAYS TO RECOGNISE A SCAN
   ----------------------------
   1. PREFIX (exact). Almost every scanner can be programmed to send a
      character before the code. When one is configured, recognition is
      certain — no guessing, no threshold. This is the mode to use once the
      hardware is in hand.

   2. SPEED (works out of the box). A scanner emits characters far faster than
      hands can type. Buffer the keys with timestamps and, on Enter, decide
      from how fast they arrived.

   THE RULE THIS MODULE MUST NEVER BREAK
   -------------------------------------
   It must not eat real typing. Keys are OBSERVED and passed straight through;
   nothing is cancelled until a burst has already been classified as a scan.
   Getting this wrong would make every search box in the app feel broken, and
   it would be blamed on anything but the scanner.
   ========================================================================== */

var Wedge = (function () {

  var CFG = {
    enabled:   true,
    prefix:    '',     /* set this once the scanner is programmed  */
    suffix:    'Enter',
    minLength: 4,      /* shorter than this is a person, not a scan */
    maxGapMs:  35      /* median ms between keys to still count as a scan */
  };

  var S = {
    buf:   [],         /* { ch, t } */
    armed: false,      /* prefix seen, collecting */
    last:  null        /* diagnostics for the Settings page */
  };

  var handlers = [];
  var probes = [];     /* live listeners for the Settings test box */

  function on(fn)    { if (typeof fn === 'function') handlers.push(fn); }
  function probe(fn) { if (typeof fn === 'function') probes.push(fn); }
  function offProbe(fn) { probes = probes.filter(function (p) { return p !== fn; }); }

  function config(patch) {
    if (patch) {
      Object.keys(patch).forEach(function (k) {
        if (k in CFG) CFG[k] = patch[k];
      });
    }
    return JSON.parse(JSON.stringify(CFG));
  }

  /* Median, not mean. One scheduling hiccup — a garbage collection, a repaint —
     can stretch a single gap to 200ms in an otherwise perfect burst. A mean
     lets that one outlier disqualify the whole scan; a median shrugs it off. */
  function medianGap(buf) {
    if (buf.length < 2) return Infinity;
    var gaps = [];
    for (var i = 1; i < buf.length; i++) gaps.push(buf[i].t - buf[i - 1].t);
    gaps.sort(function (a, b) { return a - b; });
    var m = Math.floor(gaps.length / 2);
    return gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2;
  }

  function isEditable(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function reset() { S.buf = []; S.armed = false; }

  /* Decide, report, and hand the code on. */
  function finish(target) {
    var text = S.buf.map(function (b) { return b.ch; }).join('');
    var gap  = medianGap(S.buf);
    var fast = gap <= CFG.maxGapMs;
    var longEnough = text.length >= CFG.minLength;
    /* A configured prefix is proof on its own; without one, speed decides. */
    var isScan = CFG.enabled && longEnough && (S.armed || fast);

    S.last = {
      text: text,
      length: text.length,
      medianGap: gap === Infinity ? null : Math.round(gap),
      viaPrefix: S.armed,
      accepted: isScan,
      at: new Date()
    };
    probes.slice().forEach(function (p) { try { p(S.last); } catch (e) {} });

    reset();
    if (!isScan) return false;

    /* The characters have already landed in whatever box had focus. Clearing
       it is the difference between a clean scan and a barcode wedged into the
       middle of a search term. */
    if (isEditable(target) && typeof target.value === 'string' &&
        target.value.indexOf(text) > -1) {
      target.value = target.value.split(text).join('');
      try { target.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    }

    handlers.slice().forEach(function (fn) { try { fn(text, S.last); } catch (e) {} });
    return true;
  }

  function onKeyDown(e) {
    if (!CFG.enabled) return;
    if (e.ctrlKey || e.altKey || e.metaKey) { reset(); return; }

    var now = (e.timeStamp && e.timeStamp > 0) ? e.timeStamp : Date.now();

    /* The programmed prefix opens a capture window. */
    if (CFG.prefix && e.key === CFG.prefix && !S.armed) {
      S.armed = true;
      S.buf = [];
      e.preventDefault();          /* the prefix itself must not reach the page */
      return;
    }

    if (e.key === CFG.suffix) {
      if (!S.buf.length) return;
      /* Only swallow the Enter if this really was a scan — otherwise a person
         pressing Enter in a form would find the form never submits. Once it
         IS a scan, the Enter is the scanner's terminator, not a keypress, and
         no other listener may treat it as one: POS reads Enter-on-an-empty-
         search-box as the demo's random-sale shortcut, and the palette runs
         whatever row is highlighted. Hence stopImmediatePropagation, not just
         preventDefault. */
      if (finish(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }

    /* Single printable characters only. Shift, arrows and the rest reset the
       buffer: a scanner never sends them mid-code. */
    if (e.key && e.key.length === 1) {
      /* A long pause means the previous keys were a person typing something
         else. Start fresh rather than gluing two inputs together. */
      if (S.buf.length && (now - S.buf[S.buf.length - 1].t) > 500) S.buf = [];
      S.buf.push({ ch: e.key, t: now });
      if (S.buf.length > 128) S.buf.shift();
      return;
    }

    if (e.key === 'Tab' || e.key === 'Escape') reset();
  }

  var bound = false;
  function bind() {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    /* Capture phase: the code has to be seen before a screen's own key
       handler acts on it. */
    document.addEventListener('keydown', onKeyDown, true);
  }

  /* Replay a burst with no hardware attached, so the behaviour is testable and
     the Settings page can demonstrate itself. Times are simulated, so this
     runs instantly rather than in real time. */
  function feed(text, gapMs, opts) {
    opts = opts || {};
    var t0 = (opts.startAt || 0);
    reset();
    if (CFG.prefix && opts.withPrefix) { S.armed = true; }
    for (var i = 0; i < text.length; i++) {
      S.buf.push({ ch: text.charAt(i), t: t0 + i * gapMs });
    }
    return finish(opts.target || null);
  }

  bind();

  return {
    onScan: on,
    probe: probe,
    offProbe: offProbe,
    config: config,
    feed: feed,
    last: function () { return S.last; },
    _reset: reset
  };
})();
