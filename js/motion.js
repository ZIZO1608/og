/* ==========================================================================
   MOTION — entrance, counting, direction, micro-interaction     [data-mo]
   --------------------------------------------------------------------------
   Everything here is presentation. If this file failed to load the app would
   look flatter and behave identically — no state lives here.

   THE ONE RULE THAT MATTERS
   render() replaces #view.innerHTML on every repaint, and a repaint happens
   on every keystroke in the product search, every filter chip, every sort
   click. Attaching entrance animation to render() would re-animate 24 cards
   per character typed: unusable, and it reads as a bug rather than polish.

   So entrance runs only when the VIEW CHANGED. Motion.mark() is called by
   go(), by the portal switch and by the language switch; render() asks
   Motion.claim(), which returns true exactly once per change and then goes
   back to false. Everything else repaints silently.
   ========================================================================== */

var Motion = (function () {

  /* Containers whose children are worth staggering. Anything not listed here
     simply appears — a stagger on every div would be noise. */
  /* These must be CONTAINERS whose direct children are the things to stagger.
     `.alert-row` was in this list at first, which is a row, not a container —
     it would have animated the icon and the label inside each row instead of
     the rows themselves. Filter chip rows are deliberately absent: staggering
     a toolbar reads as jitter, not polish. */
  var STAGGER_IN = [
    '.stat-row', '.pcard-grid', '.cust-grid', '.kanban', '.yl-board',
    '.yl-grid', '.tbl tbody', '#alertPanel', '.yl-feed'
  ];

  /* Past ~14 the delay is longer than the animation and the last rows arrive
     visibly late. A 40-row table would take a full second to finish. */
  var STAGGER_CAP = 14;

  var pending = false;          // a view change is waiting to be claimed

  function reduced() {
    if (document.body.getAttribute('data-motion') === 'off') return true;
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------------------------------------------------------- view change */

  function mark() { pending = true; }

  function claim() {
    var was = pending;
    pending = false;
    return was;
  }

  /* Direction of travel, from the sidebar's own ordering. Going deeper slides
     forward, going back slides back, so the app has a sense of place instead
     of every screen being a hard cut. */
  var order = [];
  function setOrder(list) { order = list.slice(); }

  function direction(from, to) {
    var a = order.indexOf(from), b = order.indexOf(to);
    if (a < 0 || b < 0 || a === b) return null;
    return b > a ? 'fwd' : 'back';
  }

  /* --------------------------------------------------------------- enter */

  /* Stamp --i on the children of each known container. CSS turns that into a
     delay; doing it in CSS rather than JS means the browser can run the whole
     thing off the main thread. */
  function enter(root, dir) {
    root = root || document.getElementById('view');
    if (!root) return;

    root.removeAttribute('data-dir');
    root.classList.remove('mo-view');

    if (reduced()) return;

    if (dir) root.setAttribute('data-dir', dir);
    /* Force a reflow so re-adding the class restarts the animation even when
       the same view is re-entered. */
    void root.offsetWidth;
    root.classList.add('mo-view');

    STAGGER_IN.forEach(function (sel) {
      root.querySelectorAll(sel).forEach(function (box) {
        var kids = box.children, n = Math.min(kids.length, STAGGER_CAP);
        if (kids.length < 2) return;
        box.classList.add('mo-in');
        for (var i = 0; i < n; i++) kids[i].style.setProperty('--i', i);
        /* Everything past the cap shares the last delay rather than getting
           no delay — otherwise row 15 would arrive before row 14. */
        for (var j = n; j < kids.length; j++) kids[j].style.setProperty('--i', n - 1);
      });
    });
  }

  /* -------------------------------------------------------------- counting

     Reads the string that is ALREADY on screen and animates up to it. This
     module never formats a number itself — the value and its separators come
     from nf() / money() / moneyStat() and are handed back untouched at the
     end, so a rounding artefact can never survive as the final display. */

  function count(el) {
    if (!el || reduced()) return;

    /* Re-entrancy guard, and it is not theoretical: countAll() runs on every
       view entry, so a second count can start on an element that is still
       mid-flight. Without this the new run would capture a HALF-COUNTED value
       as its "original" and restore to that at the end — leaving a wrong
       number on screen permanently. The pristine markup is parked on the
       element so the truth survives however many runs overlap. */
    var prev = el.__moCount;
    if (prev) {
      cancelAnimationFrame(prev.raf);
      el.innerHTML = prev.html;
    }
    var html = prev ? prev.html : el.innerHTML;
    var text = el.textContent || '';

    /* The three shapes in use: "4,196,000" + a <span class="cur">SYP</span>,
       "$322", and a bare "112". Anything else is left alone. */
    var m = text.replace(/ /g, ' ').match(/-?[\d,]*\d/);
    if (!m) return;

    var raw = m[0];
    var target = parseInt(raw.replace(/,/g, ''), 10);
    if (!isFinite(target) || target === 0) return;
    /* Small numbers look silly counting; they just appear. */
    if (Math.abs(target) < 10) return;

    var grouped = raw.indexOf(',') > -1;
    var start = performance.now();
    var DUR = 560;
    var state = { html: html, raf: 0 };
    el.__moCount = state;

    el.classList.add('mo-counting');

    function frame(now) {
      var p = Math.min(1, (now - start) / DUR);
      /* easeOutQuart — fast off the mark, long settle. Matches --e-out. */
      var e = 1 - Math.pow(1 - p, 4);
      var v = Math.round(target * e);
      var s = grouped ? v.toLocaleString('en-US') : String(v);
      el.innerHTML = html.replace(raw, s);
      if (p < 1) { state.raf = requestAnimationFrame(frame); return; }
      /* Byte-identical restore. This line is the whole safety guarantee. */
      el.innerHTML = html;
      el.__moCount = null;
      el.classList.remove('mo-counting');
    }
    state.raf = requestAnimationFrame(frame);
  }

  function countAll(root) {
    root = root || document.getElementById('view');
    if (!root || reduced()) return;
    root.querySelectorAll('.stat .val, .pdf-kpi b').forEach(count);
  }

  /* ------------------------------------------------- sliding nav indicator

     One bar that moves between items, instead of the active fill jumping.
     Positioned from the item's own offsetTop so it survives the sidebar
     being re-rendered, group headings appearing, and RTL. */
  /* `instant` suppresses the CSS transition. The dock re-measures this every
     frame while magnifying, and a 260ms transition chasing a 60fps update is
     a mushy double-easing that visibly lags the row it is marking. During a
     dock pass the bar must track exactly; between navigations it glides. */
  function navIndicator(instant) {
    var nav = document.querySelector('.sidebar .nav');
    if (!nav) return;
    var active = nav.querySelector('.nav-item.active');
    var bar = nav.querySelector('.nav-ind');

    if (!active) { if (bar) bar.style.opacity = '0'; return; }

    if (!bar) {
      bar = document.createElement('span');
      bar.className = 'nav-ind';
      nav.appendChild(bar);
      /* First paint must not slide in from y=0 across the whole sidebar. */
      bar.style.transition = 'none';
      requestAnimationFrame(function () { bar.style.transition = ''; });
    }
    bar.style.transition = instant ? 'none' : '';
    bar.style.opacity = '1';
    bar.style.height = active.offsetHeight + 'px';
    bar.style.transform = 'translateY(' + active.offsetTop + 'px)';
  }

  /* ============================================ SIDEBAR DOCK MAGNIFICATION

     The macOS dock effect, applied down the sidebar. Same behaviour as the
     framer-motion version — cursor distance drives a target, a spring chases
     it — written directly because this app has no React and no bundler.

     THE MATHS, so it is not a magic number soup:
       target = interpolate(|cursorY - itemCentreY|) across `DISTANCE`
       spring: a = (-k·(x - target) - c·v) / m,  v += a·dt,  x += v·dt

     k/c/m are framer's defaults. Their damping ratio is
       c / (2·sqrt(k·m)) = 12 / (2·sqrt(150 × 0.1)) = 1.55
     which is over 1, so the motion is overdamped: it never overshoots and can
     never oscillate. That is deliberate — a bouncing navigation reads as a
     toy, and this is a till.

     SUBSTEPPING IS NOT OPTIONAL. With m = 0.1 the equation is very stiff:
     c/m = 120, so a single 16ms Euler step applies a damping change of
     120 × 0.016 = 1.92 against a stability limit of 2. That is close enough
     to the edge that the spring term tips it over and the value diverges —
     measured at 1e19 within 400 frames, which on screen is every icon
     detonating on first hover. Integrating in fixed ~4ms slices puts the
     damping term at 0.48 and makes it unconditionally stable, while
     preserving exactly the same physical response.

     WHAT SCALES: the icon, plus a little row height and inline drift. The
     LABEL never scales — scaling text resamples the glyphs and it goes
     blurry, which is exactly what makes a cheap dock look cheap. */

  var DOCK = {
    MAX: 1.62,        /* icon scale directly under the cursor */
    DIST: 108,        /* px of influence either side */
    PAD: 7,           /* extra vertical padding at full magnification */
    SHIFT: 5,         /* inline drift toward the content */
    k: 150, c: 12, m: 0.1,
    STEP: 0.004       /* fixed integration slice — see the note above */
  };

  /* One spring, advanced by `dt` seconds in stable fixed slices.
     Shared so the loop and the suite integrate identical maths. */
  function springStep(s, target, dt) {
    var n = Math.max(1, Math.ceil(dt / DOCK.STEP));
    var h = dt / n;
    for (var i = 0; i < n; i++) {
      var a = (-DOCK.k * (s.x - target) - DOCK.c * s.v) / DOCK.m;
      s.v += a * h;
      s.x += s.v * h;          /* new v — semi-implicit, the stable ordering */
    }
    return s;
  }

  var dockItems = null, dockNav = null, dockY = null, dockRaf = 0, dockLast = 0;

  function dockStop() {
    if (dockRaf) cancelAnimationFrame(dockRaf);
    dockRaf = 0; dockLast = 0;
  }

  function dockFrame(now) {
    dockRaf = 0;
    if (!dockItems || !dockItems.length) return;

    /* Clamped so a background tab returning after ten seconds does not
       integrate one enormous step and fling everything off screen. */
    var dt = dockLast ? Math.min(0.032, (now - dockLast) / 1000) : 0.016;
    dockLast = now;

    var navTop = dockNav.getBoundingClientRect().top;
    var moving = false;

    for (var i = 0; i < dockItems.length; i++) {
      var it = dockItems[i];
      var target = 0;

      if (dockY !== null) {
        var centre = navTop + it.el.offsetTop + it.el.offsetHeight / 2;
        var d = Math.abs(dockY - centre);
        if (d < DOCK.DIST) {
          /* Cosine falloff rather than linear: linear produces a visible
             kink as the cursor crosses the edge of a neighbour's influence. */
          target = (Math.cos(d / DOCK.DIST * Math.PI) + 1) / 2;
        }
      }

      springStep(it, target, dt);

      if (Math.abs(it.x - target) > 0.0005 || Math.abs(it.v) > 0.0005) moving = true;
      else { it.x = target; it.v = 0; }

      var s = 1 + (DOCK.MAX - 1) * it.x;
      it.icon.style.transform = 'scale(' + s.toFixed(3) + ')';
      it.el.style.paddingBlock = (10 + DOCK.PAD * it.x).toFixed(2) + 'px';
      /* Logical property, so it drifts the correct way in Arabic. */
      it.el.style.marginInlineStart = (DOCK.SHIFT * it.x).toFixed(2) + 'px';
    }

    /* Row heights are changing every frame, so the active indicator has to be
       re-measured every frame too — otherwise it detaches from the item it is
       supposed to be marking the moment the cursor enters the sidebar. */
    navIndicator(true);

    if (moving || dockY !== null) { dockRaf = requestAnimationFrame(dockFrame); return; }
    /* Fully settled: hand the indicator back its transition so the next
       navigation glides instead of snapping. */
    navIndicator(false);
    dockStop();
  }

  function dockKick() {
    if (!dockRaf) { dockLast = 0; dockRaf = requestAnimationFrame(dockFrame); }
  }

  /* Re-bound after every renderSidebar(), because the nav is rebuilt from
     scratch each time and the old element references are dead. */
  /* Undo everything the loop wrote. Without this, turning motion off mid-hover
     leaves the icons frozen at whatever scale they had reached and the rows
     stuck at their magnified padding — the effect does not stop, it seizes. */
  function dockReset(nav) {
    if (!nav) return;
    nav.querySelectorAll('.nav-item.dockable').forEach(function (el) {
      el.classList.remove('dockable');
      el.style.paddingBlock = '';
      el.style.marginInlineStart = '';
      var ic = el.querySelector('.nav-icon');
      if (ic) ic.style.transform = '';
    });
  }

  function dock() {
    dockStop();
    dockItems = null; dockY = null;

    dockNav = document.querySelector('.sidebar .nav');
    dockReset(dockNav);

    if (!dockNav || !fine() || reduced()) return;
    /* Below 900px the sidebar is an icon rail or gone entirely; magnifying a
       70px strip is fussy rather than delightful. */
    if (window.innerWidth <= 900) return;

    var els = dockNav.querySelectorAll('.nav-item');
    if (!els.length) return;

    dockItems = [];
    els.forEach(function (el) {
      var icon = el.querySelector('.nav-icon');
      if (!icon) return;
      el.classList.add('dockable');
      dockItems.push({ el: el, icon: icon, x: 0, v: 0 });
    });

    dockNav.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      dockY = e.clientY;
      dockKick();
    }, { passive: true });

    dockNav.addEventListener('pointerleave', function () {
      dockY = null;      /* springs relax back to rest on their own */
      dockKick();
    });
  }

  /* ------------------------------------------------------------- ripple */

  function ripple(e, el) {
    if (reduced()) return;
    var r = el.getBoundingClientRect();
    var d = Math.max(r.width, r.height);
    var span = document.createElement('span');
    span.className = 'mo-ripple';
    span.style.width = span.style.height = d + 'px';
    span.style.left = (e.clientX - r.left - d / 2) + 'px';
    span.style.top = (e.clientY - r.top - d / 2) + 'px';
    el.appendChild(span);
    setTimeout(function () { if (span.parentNode) span.parentNode.removeChild(span); }, 520);
  }

  /* ------------------------------------------------------- pointer glow

     A soft brand halo trailing the cursor. Cheap on purpose: one fixed div,
     moved with a transform inside a single rAF, so the browser can keep it on
     its own compositor layer and never reflow the page.

     Skipped entirely on touch (there is no cursor to follow) and under
     reduced motion. */
  var glow = null, gx = 0, gy = 0, gRaf = 0;

  function fine() {
    return window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  }

  function moveGlow() {
    gRaf = 0;
    if (glow) glow.style.transform = 'translate3d(' + gx + 'px,' + gy + 'px,0)';
  }

  function initGlow() {
    if (glow || !fine() || reduced()) return;
    glow = document.createElement('div');
    glow.className = 'mo-glow';
    document.body.appendChild(glow);

    document.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      gx = e.clientX; gy = e.clientY;
      if (!glow.classList.contains('on')) glow.classList.add('on');
      if (!gRaf) gRaf = requestAnimationFrame(moveGlow);
    }, { passive: true });

    /* Fade out when the pointer leaves the window, so it does not sit frozen
       in a corner while the user is in another app. */
    document.addEventListener('pointerleave', function () { glow.classList.remove('on'); });
    window.addEventListener('blur', function () { glow.classList.remove('on'); });
  }

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    if (document.body) initGlow();
    else document.addEventListener('DOMContentLoaded', initGlow);

    document.addEventListener('pointerdown', function (e) {
      var el = e.target.closest ? e.target.closest('.btn, .nav-item, .chip, .tab') : null;
      if (!el || el.disabled) return;
      /* position:relative + overflow:hidden are needed for the ripple to be
         clipped to the control; set here so no component has to remember. */
      var cs = getComputedStyle(el);
      if (cs.position === 'static') el.style.position = 'relative';
      el.style.overflow = 'hidden';
      ripple(e, el);
    }, true);
  }
  bind();

  return {
    mark: mark, claim: claim,
    setOrder: setOrder, direction: direction,
    enter: enter, count: count, countAll: countAll,
    navIndicator: navIndicator, dock: dock, springStep: springStep,
    reduced: reduced,
    /* exposed for the suite */
    _cap: STAGGER_CAP
  };
})();
