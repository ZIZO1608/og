/*! OG Jersey 1.0 — the live name-and-number preview for OG Sports print kits.
 *
 * One file, no dependencies, no build step. Give it the `print` object a
 * product carries (contract v1.6, §3b) and the customer's name and number,
 * and it draws the back of the shirt EXACTLY as OG System draws it — the same
 * shirt, the same curve for the name, the same sizes, outline and shadow, the
 * kit's own font — so what the customer sees is what Yalla Wear prints.
 *
 *   <div id="jersey"></div>
 *   <input id="pName"> <input id="pNumber"> <p id="pMsg"></p>
 *   <script src="og-jersey.js"></script>
 *   <script>
 *     var jersey = OGJersey.mount(document.getElementById('jersey'), {
 *       print: product.print,                 // from web_products / web_product
 *       lang: 'ar',                           // 'en' | 'ar' — the messages
 *       nameInput: document.getElementById('pName'),
 *       numberInput: document.getElementById('pNumber'),
 *       messageEl: document.getElementById('pMsg'),
 *       onChange: function (s) { addToCart.disabled = !s.ok; }
 *     });
 *     // at Add to cart:  var r = jersey.check();  if (r.ok) line.print = { name: r.name, number: r.number, kitId: product.print.kitId };
 *   </script>
 *
 * The rules are the shop's (server/lib/printkits.js checkLine) — KEEP IN STEP:
 * a name AND a number, always together; the name A–Z, space, . ' - only, at
 * least one letter, upper case, at most print.maxLetters characters; the
 * number a whole number 0–99. A name typed in lower case is made upper case;
 * anything else is left out as it is typed, and the customer is told why.
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OGJersey = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var VERSION = '1.0.0';
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* The shirt, the collar and the name's curve — the SAME as js/printkits.js
     in OG System (a test there compares them). 400 × 440, the back. */
  var SHIRT = 'M128 18 Q200 52 272 18 L352 46 L398 148 L344 172 L328 142 L328 428 Q200 442 72 428 L72 142 ' +
              'L56 172 L2 148 L48 46 Z';
  var COLLAR = 'M128 18 Q200 52 272 18 Q200 34 128 18 Z';
  function namePath(y, arc) { return 'M70 ' + y + ' Q200 ' + (y - 2 * arc) + ' 330 ' + y; }

  var NAME_RE = /^[A-Z .'\-]+$/;
  var ALLOWED = /[A-Z .'\-]/;

  var WORDS = {
    en: {
      print_name_and_number: 'Write a name and a number — the print always has both.',
      print_bad_name: 'The name can only have English letters A–Z, a space, and . \' -',
      print_name_too_long: 'The name can have at most {n} letters.',
      print_bad_number: 'The number must be from 0 to 99.',
      dropped: 'Only English letters A–Z, a space, and . \' - can be printed.',
      cut: 'At most {n} letters — the rest was left out.',
      digits: 'Only numbers from 0 to 99.',
      name_ph: 'YOUR NAME', aria: 'Shirt back: {name} {number}'
    },
    ar: {
      print_name_and_number: 'اكتب اسم ورقم — الطباعة دايماً فيها الاتنين.',
      /* ⁦…⁩ keep A–Z and the three marks left to right inside the
         Arabic sentence; without them the marks are drawn backwards. */
      print_bad_name: 'الاسم لازم يكون بالأحرف الإنكليزية ⁦A–Z⁩، مع مسافة و ⁦. \' -⁩ بس.',
      print_name_too_long: 'الاسم أكتر شي {n} حرف.',
      print_bad_number: 'الرقم لازم يكون من 0 لـ 99.',
      dropped: 'منطبع بس الأحرف الإنكليزية ⁦A–Z⁩، والمسافة و ⁦. \' -⁩',
      cut: 'أكتر شي {n} حرف — الباقي ما انكتب.',
      digits: 'بس أرقام من 0 لـ 99.',
      name_ph: 'YOUR NAME', aria: 'ضهر القميص: {name} {number}'
    }
  };
  function words(lang) { return WORDS[lang === 'ar' ? 'ar' : 'en']; }
  function say(lang, key, n) { return String(words(lang)[key] || '').replace('{n}', n); }

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function maxOf(print) { var m = Math.floor(num(print && print.maxLetters, 12)); return m > 0 ? m : 12; }

  /* ------------------------------------------------------------- the rules */

  /* What the customer typed, made into what can be printed, as they type:
     upper case, curly apostrophes made straight, anything else left out,
     at most `max` characters. Says what it had to do. */
  function cleanTyping(raw, max) {
    var s = String(raw == null ? '' : raw).replace(/[‘’ʼ]/g, "'").toUpperCase();
    var out = '', dropped = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (ALLOWED.test(c)) {
        if (c === ' ' && (out === '' || out.charAt(out.length - 1) === ' ')) continue;   // no leading or double space
        out += c;
      } else if (!/\s/.test(c)) dropped = true;
    }
    var cut = out.length > max;
    if (cut) out = out.slice(0, max);
    return { value: out, dropped: dropped, cut: cut };
  }

  function cleanNumber(raw) {
    var s = String(raw == null ? '' : raw);
    var digits = s.replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
                  .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
                  .replace(/\D/g, '');
    var dropped = digits.length !== s.replace(/\s/g, '').length;
    var v = digits.replace(/^0+(?=\d)/, '').slice(0, 2);
    return { value: v, dropped: dropped || digits.replace(/^0+(?=\d)/, '').length > 2 };
  }

  /* The final word, at Add to cart — the shop's checkLine, in the browser.
     ok, the cleaned name and number, and every problem with its code (the
     same codes the shop uses) and a sentence in the page's language. */
  function check(print, name, number, lang) {
    var max = maxOf(print);
    var n = String(name == null ? '' : name).replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toUpperCase();
    var rawNum = number == null ? '' : String(number).trim();
    var problems = [];
    function bad(field, code) { problems.push({ field: field, code: code, message: say(lang, code, max) }); }
    if (!n || rawNum === '') bad(!n ? 'name' : 'number', 'print_name_and_number');
    else {
      if (!NAME_RE.test(n) || !/[A-Z]/.test(n)) bad('name', 'print_bad_name');
      else if (Array.from(n).length > max) bad('name', 'print_name_too_long');
      if (!/^\d{1,2}$/.test(rawNum) || Number(rawNum) > 99) bad('number', 'print_bad_number');
    }
    return { ok: !problems.length, name: n, number: problems.length ? null : Number(rawNum), problems: problems };
  }

  /* --------------------------------------------------------------- the look */

  var styled = false;
  function style() {
    if (styled || typeof document === 'undefined') return;
    styled = true;
    var css =
      '.ogj{position:relative;width:100%;max-width:520px;margin:0 auto;perspective:900px;-webkit-tap-highlight-color:transparent}' +
      '.ogj-card{transform-style:preserve-3d;transition:transform .25s ease-out;will-change:transform}' +
      '.ogj svg{display:block;width:100%;height:auto;overflow:visible}' +
      '.ogj text{direction:ltr;unicode-bidi:plaintext}' +
      '.ogj-name,.ogj-num{transform-box:fill-box;transform-origin:center}' +
      '.ogj-ghost{opacity:.28}' +
      '.ogj.is-loading .ogj-ink{opacity:.35;transition:opacity .3s}' +
      '.ogj-ink{transition:opacity .3s}' +
      '.ogj-press{animation:ogj-press .42s cubic-bezier(.2,.9,.3,1.25)}' +
      '.ogj-flash{opacity:0;pointer-events:none}' +
      '.ogj-flash.go{animation:ogj-flash .55s ease-out}' +
      '.ogj-sheen{pointer-events:none;mix-blend-mode:soft-light;opacity:.0;transition:opacity .3s}' +
      '.ogj:hover .ogj-sheen{opacity:.55}' +
      '.ogj-sweep{opacity:0;pointer-events:none}' +
      '.ogj-sweep.go{animation:ogj-sweep 1.1s ease-in-out}' +
      '@keyframes ogj-press{0%{transform:scale(1.07);opacity:.55}60%{transform:scale(.985);opacity:1}100%{transform:scale(1)}}' +
      '@keyframes ogj-flash{0%{opacity:.5}100%{opacity:0}}' +
      '@keyframes ogj-sweep{0%{opacity:0;transform:translateX(-420px)}20%{opacity:.6}100%{opacity:0;transform:translateX(420px)}}' +
      '@media (prefers-reduced-motion:reduce){.ogj-card{transition:none}.ogj-press,.ogj-flash.go,.ogj-sweep.go{animation:none}}';
    var el = document.createElement('style');
    el.setAttribute('data-og-jersey', VERSION);
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  function lum(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return 1;
    return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
  }
  function shade(hex, amt) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return hex;
    var f = function (h) { var v = Math.round(parseInt(h, 16) + amt * 255); return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2); };
    return '#' + f(m[1]) + f(m[2]) + f(m[3]);
  }
  var HEX = /^#[0-9a-f]{6}$/i;
  function colour(v, d) { return HEX.test(String(v || '')) ? String(v) : d; }

  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /* One FontFace per font address, shared by every jersey on the page. */
  var faces = {};
  function fontFamily(print) {
    var url = print && print.font && print.font.url;
    if (!url) return null;
    if (faces[url]) return faces[url];
    var fam = 'ogj-' + (Object.keys(faces).length + 1);
    var rec = { family: fam, state: 'loading', waiting: [] };
    faces[url] = rec;
    function done(state) {
      rec.state = state;
      var w = rec.waiting; rec.waiting = [];
      for (var i = 0; i < w.length; i++) { try { w[i](state); } catch (e) { /* one jersey must not stop the others */ } }
    }
    try {
      if (typeof FontFace === 'undefined' || !document.fonts) throw new Error('no FontFace');
      var face = new FontFace(fam, 'url(' + JSON.stringify(url) + ')', { weight: '1 1000' });
      document.fonts.add(face);
      face.load().then(function () { done('ready'); }, function () { done('failed'); });
    } catch (e) {
      var s = document.createElement('style');
      s.textContent = '@font-face{font-family:"' + fam + '";src:url(' + JSON.stringify(url) + ');font-weight:1 1000;font-display:swap}';
      (document.head || document.documentElement).appendChild(s);
      setTimeout(function () { done('ready'); }, 600);
    }
    return rec;
  }

  var seq = 0;
  var reduce = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: true };

  /* ---------------------------------------------------------------- mount */

  function mount(target, opts) {
    if (!target || typeof document === 'undefined') throw new Error('OGJersey.mount needs an element');
    opts = opts || {};
    style();
    var id = 'ogj' + (++seq);
    var lang = opts.lang === 'ar' ? 'ar' : 'en';
    var print = opts.print || null;
    var state = { name: '', number: '' };
    var gone = false;

    var wrap = document.createElement('div');
    wrap.className = 'ogj';
    wrap.setAttribute('dir', 'ltr');
    var card = document.createElement('div');
    card.className = 'ogj-card';
    wrap.appendChild(card);
    var svg = el('svg', { viewBox: '0 0 400 440', role: 'img', xmlns: SVGNS });
    card.appendChild(svg);
    target.innerHTML = '';
    target.appendChild(wrap);

    var defs = el('defs', {}, svg);
    var arc = el('path', { id: id + 'arc', fill: 'none' }, defs);
    var fabric = el('linearGradient', { id: id + 'fab', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    var fab0 = el('stop', { offset: '0' }, fabric), fab1 = el('stop', { offset: '.55' }, fabric), fab2 = el('stop', { offset: '1' }, fabric);
    var sideG = el('linearGradient', { id: id + 'side', x1: '0', y1: '0', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0', 'stop-color': '#000', 'stop-opacity': '.28' }, sideG);
    el('stop', { offset: '.18', 'stop-color': '#000', 'stop-opacity': '0' }, sideG);
    el('stop', { offset: '.82', 'stop-color': '#000', 'stop-opacity': '0' }, sideG);
    el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '.28' }, sideG);
    var sheenG = el('radialGradient', { id: id + 'sheen', cx: '.5', cy: '.3', r: '.6' }, defs);
    var sheenStop = el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.9' }, sheenG);
    el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }, sheenG);
    var sweepG = el('linearGradient', { id: id + 'sweep', x1: '0', y1: '0', x2: '1', y2: '0' }, defs);
    el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0' }, sweepG);
    el('stop', { offset: '.5', 'stop-color': '#fff', 'stop-opacity': '.55' }, sweepG);
    el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }, sweepG);
    var clip = el('clipPath', { id: id + 'clip' }, defs);
    el('path', { d: SHIRT }, clip);

    var body = el('path', { d: SHIRT, 'stroke-width': '3' }, svg);
    var cloth = el('g', { 'clip-path': 'url(#' + id + 'clip)' }, svg);
    el('rect', { x: '0', y: '0', width: '400', height: '440', fill: 'url(#' + id + 'side)' }, cloth);
    var folds = el('g', { fill: 'none', 'stroke-width': '2', 'stroke-linecap': 'round', opacity: '.10' }, cloth);
    el('path', { d: 'M110 300 Q130 360 112 420' }, folds);
    el('path', { d: 'M292 290 Q272 350 290 420' }, folds);
    el('path', { d: 'M72 142 L72 428' }, folds);
    el('path', { d: 'M328 142 L328 428' }, folds);
    var collar = el('path', { d: COLLAR }, svg);
    var ink = el('g', { 'class': 'ogj-ink' }, svg);
    var flash = el('ellipse', { 'class': 'ogj-flash', cx: '200', cy: '200', rx: '170', ry: '150', fill: '#fff' }, cloth);
    var sheen = el('rect', { 'class': 'ogj-sheen', x: '0', y: '0', width: '400', height: '440', fill: 'url(#' + id + 'sheen)' }, cloth);
    var sweep = el('rect', { 'class': 'ogj-sweep', x: '0', y: '0', width: '160', height: '440', fill: 'url(#' + id + 'sweep)' }, cloth);

    var nameG, numG;   // the ink groups, rebuilt when the print changes

    function textAttrs(p, fam, size) {
      return {
        'font-family': (fam ? '"' + fam + '", ' : '') + '"Arial Narrow", Impact, sans-serif',
        'font-weight': String(num(p.font && p.font.weight, 400)), 'font-size': String(size), 'text-anchor': 'middle'
      };
    }

    function build() {
      while (ink.firstChild) ink.removeChild(ink.firstChild);
      if (!print) { wrap.style.display = 'none'; return; }
      wrap.style.display = '';
      var p = print;
      var textC = colour(p.textColor, '#ffffff');
      var dark = lum(textC) < 0.45;
      var base = colour(opts.shirtColor, dark ? '#e8e6df' : '#1b1b1f');
      var edge = shade(base, lum(base) > 0.5 ? -0.12 : 0.08);
      fab0.setAttribute('stop-color', shade(base, 0.06));
      fab1.setAttribute('stop-color', base);
      fab2.setAttribute('stop-color', shade(base, -0.07));
      body.setAttribute('fill', 'url(#' + id + 'fab)');
      body.setAttribute('stroke', edge);
      collar.setAttribute('fill', edge);
      folds.setAttribute('stroke', lum(base) > 0.5 ? '#000' : '#fff');
      sheenStop.setAttribute('stop-opacity', lum(base) > 0.5 ? '.5' : '.9');

      var y = num(p.nameY, 130), a = num(p.nameArc, 0);
      arc.setAttribute('d', namePath(y, a));
      var rec = fontFamily(p);
      var fam = rec ? rec.family : null;
      var ow = num(p.outlineWidth, 0);
      var oc = ow > 0 && HEX.test(String(p.outlineColor || '')) ? p.outlineColor : null;
      var sc = HEX.test(String(p.shadowColor || '')) && (num(p.shadowDx, 0) || num(p.shadowDy, 0)) ? p.shadowColor : null;

      function layer(fill, strokeC, dx, dy, cls) {
        var g = el('g', { 'class': cls, transform: dx || dy ? 'translate(' + dx + ' ' + dy + ')' : null }, ink);
        var stroke = strokeC ? { stroke: strokeC, 'stroke-width': String(ow * 2), 'stroke-linejoin': 'round', 'paint-order': 'stroke' } : {};
        var t = el('text', Object.assign(textAttrs(p, fam, num(p.nameSize, 46)), { fill: fill }, stroke), g);
        t.setAttribute('class', 'ogj-name');
        var tp = el('textPath', { href: '#' + id + 'arc', startOffset: '50%' }, t);
        tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + id + 'arc');
        var n = el('text', Object.assign(textAttrs(p, fam, num(p.numberSize, 170)), { x: '200', y: String(num(p.numberY, 330)), fill: fill }, stroke), g);
        n.setAttribute('class', 'ogj-num');
        return { name: tp, nameText: t, num: n };
      }
      var layers = [];
      if (sc) layers.push(layer(sc, oc ? sc : null, num(p.shadowDx, 0), num(p.shadowDy, 0), 'ogj-shadow'));
      layers.push(layer(textC, oc, 0, 0, 'ogj-face'));
      nameG = layers; numG = layers;
      if (rec && rec.state === 'loading') {
        wrap.classList.add('is-loading');
        rec.waiting.push(function (st) {
          if (gone) return;
          wrap.classList.remove('is-loading');
          if (st === 'ready') shine();
          if (st === 'failed' && opts.onFontError) opts.onFontError(p.font);
        });
      } else wrap.classList.remove('is-loading');
      paint(false, false);
    }

    function restart(node, cls) {
      if (!node || reduce.matches) return;
      node.classList.remove(cls);
      void node.getBoundingClientRect();
      node.classList.add(cls);
    }
    function shine() { restart(sweep, 'go'); }

    function paint(nameMoved, numMoved) {
      if (!print || !nameG) return;
      var w = words(lang);
      var showName = state.name || w.name_ph;
      var showNum = state.number !== '' ? state.number : '10';
      for (var i = 0; i < nameG.length; i++) {
        nameG[i].name.textContent = showName;
        nameG[i].num.textContent = showNum;
        nameG[i].nameText.classList.toggle('ogj-ghost', !state.name);
        nameG[i].num.classList.toggle('ogj-ghost', state.number === '');
        if (nameMoved) restart(nameG[i].nameText, 'ogj-press');
        if (numMoved) restart(nameG[i].num, 'ogj-press');
      }
      if (nameMoved || numMoved) restart(flash, 'go');
      svg.setAttribute('aria-label', w.aria.replace('{name}', state.name || '').replace('{number}', state.number || ''));
    }

    /* ---- the two boxes, when the page hands them over ---- */
    var msgTimer = null;
    function tell(text) {
      if (!opts.messageEl) return;
      opts.messageEl.textContent = text || '';
      clearTimeout(msgTimer);
      if (text) msgTimer = setTimeout(function () { if (!gone) opts.messageEl.textContent = ''; }, 4000);
    }
    function onName() {
      var box = opts.nameInput;
      var before = box.value, caret = box.selectionStart == null ? before.length : box.selectionStart;
      var r = cleanTyping(before, maxOf(print));
      if (r.value !== before) {
        var left = cleanTyping(before.slice(0, caret), Infinity).value.length;
        box.value = r.value;
        try { var c = Math.min(left, r.value.length); box.setSelectionRange(c, c); } catch (e) { /* not a text box */ }
      }
      /* A message stays its four seconds: the next good key must not wipe
         the reason the last one vanished before anybody has read it. */
      if (r.dropped || r.cut) tell(r.dropped ? say(lang, 'dropped') : say(lang, 'cut', maxOf(print)));
      set({ name: r.value });
    }
    function onNumber() {
      var box = opts.numberInput;
      var r = cleanNumber(box.value);
      if (r.value !== box.value) box.value = r.value;
      if (r.dropped) tell(say(lang, 'digits'));
      set({ number: r.value });
    }
    if (opts.nameInput) {
      opts.nameInput.setAttribute('maxlength', String(maxOf(print) + 4));
      opts.nameInput.setAttribute('autocapitalize', 'characters');
      opts.nameInput.setAttribute('autocomplete', 'off');
      opts.nameInput.setAttribute('spellcheck', 'false');
      opts.nameInput.setAttribute('dir', 'ltr');
      opts.nameInput.addEventListener('input', onName);
      if (opts.nameInput.value) state.name = cleanTyping(opts.nameInput.value, maxOf(print)).value;
    }
    if (opts.numberInput) {
      opts.numberInput.setAttribute('inputmode', 'numeric');
      opts.numberInput.setAttribute('maxlength', '2');
      opts.numberInput.setAttribute('autocomplete', 'off');
      opts.numberInput.setAttribute('dir', 'ltr');
      opts.numberInput.addEventListener('input', onNumber);
      if (opts.numberInput.value) state.number = cleanNumber(opts.numberInput.value).value;
    }
    if (opts.name != null) state.name = cleanTyping(opts.name, maxOf(print)).value;
    if (opts.number != null) state.number = cleanNumber(opts.number).value;

    /* ---- the tilt: the shirt leans towards a mouse; never on touch ---- */
    function onMove(e) {
      if (reduce.matches || e.pointerType === 'touch') return;
      var r = wrap.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = 'rotateY(' + (x * 12).toFixed(2) + 'deg) rotateX(' + (-y * 9).toFixed(2) + 'deg)';
      sheen.setAttribute('x', String(Math.round(x * 160)));
      sheen.setAttribute('y', String(Math.round(y * 120)));
    }
    function onLeave() { card.style.transform = ''; }
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerleave', onLeave);

    function snapshot() {
      var r = check(print, state.name, state.number, lang);
      return { name: state.name, number: state.number, ok: r.ok, problems: r.problems };
    }
    function set(v) {
      if (gone) return;
      v = v || {};
      var nm = state.name, nb = state.number;
      if (v.name != null) state.name = cleanTyping(v.name, maxOf(print)).value;
      if (v.number != null) state.number = cleanNumber(v.number).value;
      if (opts.nameInput && v.name != null && opts.nameInput.value !== state.name && document.activeElement !== opts.nameInput) opts.nameInput.value = state.name;
      if (opts.numberInput && v.number != null && opts.numberInput.value !== state.number && document.activeElement !== opts.numberInput) opts.numberInput.value = state.number;
      paint(state.name !== nm, state.number !== nb);
      if (opts.onChange && (state.name !== nm || state.number !== nb)) opts.onChange(snapshot());
    }

    build();

    return {
      version: VERSION,
      set: set,
      setPrint: function (p) { if (gone) return; print = p || null; state.name = cleanTyping(state.name, maxOf(print)).value; build(); },
      setLang: function (l) { lang = l === 'ar' ? 'ar' : 'en'; paint(false, false); },
      state: snapshot,
      /* At Add to cart. Says the first problem in the message box too. */
      check: function () {
        var r = check(print, state.name, state.number, lang);
        if (!r.ok) tell(r.problems[0].message);
        return r;
      },
      svg: function () { return svg; },
      destroy: function () {
        gone = true;
        clearTimeout(msgTimer);
        if (opts.nameInput) opts.nameInput.removeEventListener('input', onName);
        if (opts.numberInput) opts.numberInput.removeEventListener('input', onNumber);
        wrap.removeEventListener('pointermove', onMove);
        wrap.removeEventListener('pointerleave', onLeave);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
  }

  return { version: VERSION, mount: mount, check: check, cleanName: cleanTyping, cleanNumber: cleanNumber,
           SHIRT: SHIRT, COLLAR: COLLAR, namePath: namePath, NAME_RE: NAME_RE };
});
