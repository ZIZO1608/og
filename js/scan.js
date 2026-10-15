/* ==========================================================================
   SCANNING — point the camera at a label                          [data-sc]
   --------------------------------------------------------------------------
   The system already prints genuinely scannable EAN-13 and QR. This reads
   them back, closing the loop: the app prints its own labels and then reads
   its own labels.

   THREE TIERS, in order of preference:

     1. BarcodeDetector — native, hardware-accelerated, reads EAN-13 and QR
        together. Present in Chrome on Android and on Windows, which covers
        the phone this will actually be demoed on.

     2. Own EAN-13 line scanner — threshold one row of pixels, measure the bar
        runs, normalise to modules, match against the SAME L/G/R tables that
        printed the label (Codes._ean). Used where BarcodeDetector is missing,
        e.g. Safari and Firefox.

     3. Photo capture — <input capture="environment"> opens the phone's camera
        app and hands back a still. This is the only tier that works from
        file://, where getUserMedia is blocked outright.

   THE SECURE-CONTEXT RULE: getUserMedia needs https or localhost. Opened by
   double-clicking index.html there is no live video at all, and the UI says
   so plainly and offers tier 3 instead of failing silently.

   NOT BUILT YET: a hand-rolled QR decoder for tier 2. Where BarcodeDetector
   is unavailable, EAN-13 works and QR does not. Every label the app prints
   carries both, so nothing is unscannable — but this is a real gap and the
   UI names it rather than pretending.
   ========================================================================== */

var Scan = (function () {

  var S = {
    open: false, stream: null, raf: 0, detector: null,
    onHit: null, continuous: false, lastCode: '', lastAt: 0
  };

  var DUPE_MS = 1600;      /* ignore the same code re-read within this window */

  function secure() {
    return window.isSecureContext ||
           location.protocol === 'https:' ||
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
  }

  function hasDetector() { return typeof window.BarcodeDetector !== 'undefined'; }
  function canLiveScan() { return secure() && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  /* ===================================================== EAN-13 line reader

     Reads one horizontal strip of the image. A barcode is a run-length
     pattern: 95 modules across, starting 101, ending 101, with 01010 in the
     middle. Measure the runs, divide by the module width, and each group of
     seven bits becomes a digit through the printing tables.

     Scanning several rows matters — one row can cross a glare spot or a fold
     in the label and produce nothing, while the row 20px below reads fine. */

  function decodeEan13(imgData, w, h) {
    var rows = 11;
    for (var r = 1; r < rows; r++) {
      var y = Math.floor(h * r / rows);
      var hit = decodeRow(imgData, w, y);
      if (hit) return hit;
    }
    return null;
  }

  function decodeRow(data, w, y) {
    /* Greyscale the row, then threshold at the midpoint between its own
       darkest and lightest pixel. A fixed threshold fails the moment the
       lighting is not perfect, which in a shop it never is. */
    var lum = new Uint8Array(w), min = 255, max = 0, i, o;
    for (i = 0; i < w; i++) {
      o = (y * w + i) * 4;
      var v = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000 | 0;
      lum[i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < 40) return null;                 /* flat: no barcode here */
    var mid = (min + max) / 2;

    /* Run-length encode the row into alternating bar/space widths. */
    var runs = [], startsDark = lum[0] < mid, cur = startsDark, len = 0;
    for (i = 0; i < w; i++) {
      var dark = lum[i] < mid;
      if (dark === cur) { len++; }
      else { runs.push(len); cur = dark; len = 1; }
    }
    runs.push(len);
    if (runs.length < 59) return null;               /* 95 modules => >=59 runs */

    /* Try every plausible start: the first run may be quiet zone or a bar. */
    for (var s = startsDark ? 0 : 1; s + 59 <= runs.length; s += 2) {
      var got = readFrom(runs, s);
      if (got) return got;
    }
    return null;
  }

  function readFrom(runs, s) {
    /* The three guard bars at the start are one module each, so their mean
       gives the module width for this particular read. */
    var unit = (runs[s] + runs[s + 1] + runs[s + 2]) / 3;
    if (unit < 0.8) return null;

    /* 59 runs: 3 guard + 24 left + 5 centre + 24 right + 3 guard. */
    var mods = [], total = 0, k;
    for (k = 0; k < 59; k++) {
      var m = Math.round(runs[s + k] / unit);
      if (m < 1 || m > 4) return null;               /* no EAN element is >4 */
      mods.push(m);
      total += m;
    }
    if (total !== 95) return null;

    /* Rebuild the bit string, then slice it the way ean13() built it. */
    var bits = '', dark = true;
    for (k = 0; k < 59; k++) {
      bits += (dark ? '1' : '0').repeat(mods[k]);
      dark = !dark;
    }
    if (bits.slice(0, 3) !== '101') return null;
    if (bits.slice(45, 50) !== '01010') return null;
    if (bits.slice(92, 95) !== '101') return null;

    var T = Codes._ean;
    var parity = '', digits = '';
    for (k = 0; k < 6; k++) {
      var chunk = bits.substr(3 + k * 7, 7);
      var li = T.L.indexOf(chunk), gi = T.G.indexOf(chunk);
      if (li > -1) { digits += li; parity += 'L'; }
      else if (gi > -1) { digits += gi; parity += 'G'; }
      else return null;
    }
    var first = T.PARITY.indexOf(parity);
    if (first < 0) return null;

    for (k = 0; k < 6; k++) {
      var rc = bits.substr(50 + k * 7, 7);
      var ri = T.R.indexOf(rc);
      if (ri < 0) return null;
      digits += ri;
    }

    var code = String(first) + digits;
    /* The check digit is the whole point — without it a misread is silently
       accepted as a different, valid-looking product. */
    return Codes.ean13Valid(code) ? code : null;
  }

  /* Reversed labels are common: people scan upside down. Retrying the mirror
     costs one array reverse and saves a confused user. */
  function decodeEan13Both(data, w, h) {
    var hit = decodeEan13(data, w, h);
    if (hit) return hit;
    var flipped = new Uint8ClampedArray(data.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var a = (y * w + x) * 4, b = (y * w + (w - 1 - x)) * 4;
        flipped[b] = data[a]; flipped[b + 1] = data[a + 1];
        flipped[b + 2] = data[a + 2]; flipped[b + 3] = data[a + 3];
      }
    }
    return decodeEan13(flipped, w, h);
  }

  /* ============================================================ the modal */

  /* A PHONE GETS THE WHOLE SCREEN. A camera in a bottom sheet is a letterbox
     under somebody's thumb; on a phone the camera is the screen, with a window
     to aim through, a laser, and three big buttons at the bottom. Same open()
     contract, so every caller (the tab bar, the desk, move-by-scan, the stock
     count) gets it. Its own layer on <body>, the colour picker's rule, so it
     never closes a dialog it was opened from. */
  function phone() { return !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches); }

  var ICO = {
    x: 'M6 6l12 12M18 6L6 18',
    torch: 'M9 2h6l-1 6h-4zM10 8h4v12a2 2 0 0 1-4 0z',
    type: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10',
    photo: 'M3 7h4l2-2h6l2 2h4v12H3zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7'
  };
  function svg(d) { return '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>'; }

  function openFull(o, live) {
    var old = document.getElementById('scRoot');
    if (old) old.remove();
    var root = document.createElement('div');
    root.id = 'scRoot';
    root.className = 'scx' + (live ? '' : ' no-cam');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', o.title || t('sc_title'));
    root.innerHTML =
      (live ? '<video id="scVideo" playsinline muted autoplay></video>' : '') +
      '<div class="scx-shade"><div class="scx-win" id="scWin"><i></i><i></i><i></i><i></i>' +
        (live ? '<span class="scx-laser"></span>' : '') + '</div>' +
        '<div class="sc-status" id="scStatus">' + t(live ? 'sc_aim' : 'sc_use_photo') + '</div></div>' +
      '<div class="scx-top">' +
        '<button type="button" class="scx-x" data-sc="close" aria-label="' + esc(t('close')) + '">' + svg(ICO.x) + '</button>' +
        '<b>' + esc(o.title || t('sc_title')) + '</b>' +
        '<span class="scx-count" id="scCount" hidden></span>' +
      '</div>' +
      (live ? '' :
        '<div class="scx-nocam"><b>' + t('sc_no_camera') + '</b><span>' + t('sc_no_camera_sub') + '</span></div>') +
      '<div class="scx-type" id="scType" hidden>' +
        '<input class="inp num" id="scManual" type="text" inputmode="numeric" enterkeyhint="go" autocomplete="off" ' +
          'placeholder="' + esc(t('sc_type_code')) + '">' +
        '<button type="button" class="btn btn-primary" data-sc="manual">' + t('sc_go') + '</button>' +
      '</div>' +
      '<div class="scx-bar">' +
        (live ? '<button type="button" class="scx-b scx-torch" data-sc="torch">' + svg(ICO.torch) + '<span>' + t('sc_torch') + '</span></button>' : '') +
        '<button type="button" class="scx-b" data-sc="type">' + svg(ICO.type) + '<span>' + t('sc_type_btn') + '</span></button>' +
        '<button type="button" class="scx-b" data-sc="photo">' + svg(ICO.photo) + '<span>' + t('sc_photo_btn') + '</span></button>' +
      '</div>' +
      '<input type="file" id="scFile" accept="image/*" capture="environment" hidden>';
    document.body.appendChild(root);
    S.full = true;
    S.count = 0;
    if (typeof Layers !== 'undefined') Layers.mark();
  }

  function open(o) {
    o = o || {};
    S.onHit = o.onHit || null;
    S.continuous = !!o.continuous;
    S.lastCode = ''; S.lastAt = 0; S.torchOn = false;

    var live = canLiveScan();

    if (phone()) {
      openFull(o, live);
      S.open = true;
      bindFile();
      if (live) start();
      return;
    }

    var body =
      '<div class="sc-stage' + (live ? '' : ' no-cam') + '">' +
        (live
          ? '<video id="scVideo" playsinline muted autoplay></video>' +
            '<div class="sc-frame"><i></i><i></i><i></i><i></i></div>' +
            '<div class="sc-laser"></div>'
          : '<div class="sc-nocam">' +
              '<svg viewBox="0 0 24 24" stroke-linecap="square">' +
                '<path d="M3 7h4l2-2h6l2 2h4v12H3zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"/></svg>' +
              '<b>' + t('sc_no_camera') + '</b>' +
              '<span>' + t('sc_no_camera_sub') + '</span></div>') +
      '</div>' +
      '<div class="sc-status" id="scStatus">' + t(live ? 'sc_looking' : 'sc_use_photo') + '</div>' +
      '<input type="file" id="scFile" accept="image/*" capture="environment" hidden>' +
      '<div class="sc-manual">' +
        '<input class="inp num" id="scManual" type="text" inputmode="numeric" ' +
          'placeholder="' + esc(t('sc_type_code')) + '">' +
        '<button class="btn" data-sc="manual">' + t('sc_go') + '</button>' +
      '</div>';

    openModal({
      title: o.title || t('sc_title'),
      size: 'narrow',
      body: body,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('close') + '</button>' +
            '<button class="btn" data-sc="photo">' + t('sc_photo') + '</button>' +
            (live ? '<button class="btn btn-primary" data-sc="torch">' + t('sc_torch') + '</button>' : '')
    });

    S.open = true;
    bindFile();
    if (live) start();
  }

  function close() {
    S.open = false;
    stop();
    if (S.full) {
      S.full = false;
      var r = document.getElementById('scRoot');
      if (r) r.remove();
      if (typeof Layers !== 'undefined') Layers.afterClose();
    }
  }

  /* A short two-note beep on a good read: a till is loud, and a buzz alone
     is missed in a hand holding a box. WebAudio, so no file to fetch. */
  var actx = null;
  function beep() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var t0 = actx.currentTime;
      [[1320, 0], [1760, 0.07]].forEach(function (n) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t0 + n[1]);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + n[1] + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.09);
        o.connect(g); g.connect(actx.destination);
        o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.1);
      });
    } catch (e) { /* no audio is not a failed scan */ }
  }

  function flash() {
    var w = document.getElementById('scWin');
    if (!w) return;
    w.classList.remove('is-hit');
    void w.offsetWidth;
    w.classList.add('is-hit');
  }

  function stop() {
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
    if (S.stream) {
      S.stream.getTracks().forEach(function (tr) { tr.stop(); });
      S.stream = null;
    }
  }

  function status(msg, kind) {
    var el = document.getElementById('scStatus');
    if (!el) return;
    el.textContent = msg;
    el.className = 'sc-status' + (kind ? ' ' + kind : '');
  }

  function start() {
    var video = document.getElementById('scVideo');
    if (!video) return;

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      if (!S.open) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      S.stream = stream;
      video.srcObject = stream;
      return video.play();
    }).then(function () {
      if (!S.open) return;
      if (hasDetector()) {
        try {
          S.detector = new window.BarcodeDetector({
            formats: ['ean_13', 'qr_code', 'code_128', 'ean_8']
          });
        } catch (e) { S.detector = null; }
      }
      /* The light button is drawn only where the camera has one. */
      if (S.full && S.stream) {
        try {
          var tr = S.stream.getVideoTracks()[0];
          var caps = tr.getCapabilities ? tr.getCapabilities() : {};
          var rt = document.getElementById('scRoot');
          if (rt && caps.torch) rt.classList.add('has-torch');
        } catch (e) { /* no capabilities API: no light button */ }
      }
      loop();
    })['catch'](function (err) {
      /* Distinguish "you said no" from "there is no camera" — they need
         different things from the user. */
      var msg = (err && err.name === 'NotAllowedError') ? t('sc_denied')
              : (err && err.name === 'NotFoundError') ? t('sc_nodevice')
              : t('sc_failed');
      status(msg, 'bad');
      var stage = document.querySelector('.sc-stage') || document.getElementById('scRoot');
      if (stage) stage.classList.add('no-cam');
    });
  }

  var cv = null, cx = null;

  function loop() {
    if (!S.open) return;

    var video = document.getElementById('scVideo');
    /* THE CAMERA STOPS WHEN ITS VIDEO IS GONE, however it went. A sheet can
       be shut by the back gesture or a pull-down (fix 05), neither of which
       is the Close button this used to listen for, and the lens and its light
       stayed on behind the shop until the page was closed. */
    if (!video) { close(); return; }
    S.raf = requestAnimationFrame(loop);
    if (video.readyState < 2) return;

    if (S.detector) {
      /* Native path. detect() is async; guard against overlapping calls or
         the queue grows faster than it drains on a slow phone. */
      if (S.busy) return;
      S.busy = true;
      S.detector.detect(video).then(function (codes) {
        S.busy = false;
        if (codes && codes.length) hit(codes[0].rawValue);
      })['catch'](function () { S.busy = false; });
      return;
    }

    /* Fallback path: sample the middle band, where the frame guides aim. */
    if (!cv) { cv = document.createElement('canvas'); cx = cv.getContext('2d', { willReadFrequently: true }); }
    var w = 640;
    var h = Math.max(1, Math.round(video.videoHeight / video.videoWidth * w));
    cv.width = w; cv.height = h;
    cx.drawImage(video, 0, 0, w, h);

    var bandH = Math.max(24, Math.round(h * 0.35));
    var bandY = Math.round((h - bandH) / 2);
    var img = cx.getImageData(0, bandY, w, bandH);
    var code = decodeEan13Both(img.data, w, bandH);
    if (code) hit(code);
  }

  /* One place every tier funnels through, so duplicate suppression and the
     callback contract are written once. */
  function hit(raw) {
    var now = Date.now();
    if (raw === S.lastCode && now - S.lastAt < DUPE_MS) return;
    S.lastCode = raw; S.lastAt = now;

    status(t('sc_found') + ' ' + raw, 'good');
    /* Chrome refuses (and logs) a buzz before the first real tap. */
    if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(35); } catch (e) {} }

    var keep = S.continuous;
    if (S.full) {
      flash();
      beep();
      if (keep) {
        S.count = (S.count || 0) + 1;
        var c = document.getElementById('scCount');
        if (c) { c.hidden = false; c.textContent = t('sc_scanned').replace('{n}', S.count); }
        if (S.onHit) S.onHit(raw);
        setTimeout(function () { if (S.open) status(t('sc_aim')); }, 900);
        return;
      }
      /* the green frame shows for a moment before the camera goes */
      var cb = S.onHit;
      S.onHit = null;
      stop();
      setTimeout(function () { close(); if (cb) cb(raw); }, 260);
      return;
    }
    if (!keep) { close(); closeModal(); }
    if (S.onHit) S.onHit(raw);
    if (keep) setTimeout(function () { if (S.open) status(t('sc_looking')); }, 900);
  }

  /* ------------------------------------------------------- photo fallback */

  function bindFile() {
    var input = document.getElementById('scFile');
    if (!input) return;
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.value = '';
      if (!f) return;
      status(t('sc_reading'));
      readPhoto(f, function (code) {
        if (code) hit(code);
        else status(t('sc_nothing'), 'bad');
      });
    });
  }

  function readPhoto(file, done) {
    var fr = new FileReader();
    fr.onload = function () {
      var im = new Image();
      im.onload = function () {
        var w = Math.min(1400, im.width);
        var h = Math.round(im.height / im.width * w);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(im, 0, 0, w, h);

        if (hasDetector()) {
          try {
            new window.BarcodeDetector({ formats: ['ean_13', 'qr_code', 'code_128', 'ean_8'] })
              .detect(c)
              .then(function (codes) {
                if (codes && codes.length) { done(codes[0].rawValue); return; }
                done(decodeEan13Both(g.getImageData(0, 0, w, h).data, w, h));
              })['catch'](function () {
                done(decodeEan13Both(g.getImageData(0, 0, w, h).data, w, h));
              });
            return;
          } catch (e) { /* fall through */ }
        }
        done(decodeEan13Both(g.getImageData(0, 0, w, h).data, w, h));
      };
      im.onerror = function () { done(null); };
      im.src = fr.result;
    };
    fr.onerror = function () { done(null); };
    fr.readAsDataURL(file);
  }

  /* ---------------------------------------------------------------- acts */

  var ACT = {
    close: function () { close(); },
    type: function () {
      var box = document.getElementById('scType');
      if (!box) return;
      box.hidden = !box.hidden;
      if (!box.hidden) { var i = document.getElementById('scManual'); if (i) i.focus(); }
    },
    photo: function () {
      var i = document.getElementById('scFile');
      if (i) i.click();
    },
    manual: function () {
      var el = document.getElementById('scManual');
      var v = (el && el.value || '').trim();
      if (v) hit(v);
    },
    /* Torch is only exposed by some Android cameras; failing silently would
       look broken, so it reports when the hardware will not do it. */
    torch: function () {
      if (!S.stream) return;
      var track = S.stream.getVideoTracks()[0];
      var caps = track.getCapabilities ? track.getCapabilities() : {};
      if (!caps.torch) { toast(t('sc_title'), t('sc_no_torch'), 'warn'); return; }
      S.torchOn = !S.torchOn;
      var tb = document.querySelector('.scx-torch');
      if (tb) tb.classList.toggle('on', S.torchOn);
      track.applyConstraints({ advanced: [{ torch: S.torchOn }] })['catch'](function () {});
    }
  };

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-sc]') : null;
      if (el) {
        var fn = ACT[el.getAttribute('data-sc')];
        if (fn) { e.preventDefault(); fn(el, e); }
        return;
      }
      /* Closing the modal by any route must release the camera — a live
         stream left running keeps the phone's torch and lens busy and drains
         the battery long after the user has moved on. */
      if (S.open && el === null && e.target.closest &&
          (e.target.closest('[data-act="modal-close"]') || e.target.closest('[data-act="modal-backdrop"]'))) {
        close();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.open) close();
      if (e.key === 'Enter' && S.open && document.activeElement &&
          document.activeElement.id === 'scManual') { ACT.manual(); }
    });
  }
  bind();

  /* The top layer: Back closes the camera before anything under it. */
  if (typeof Layers !== 'undefined') {
    Layers.register('scanner', function () { return !!(S.open && S.full); }, function () { close(); }, 5);
  }

  return {
    open: open, close: close,
    decodeEan13: decodeEan13Both,
    supported: function () {
      return { secure: secure(), live: canLiveScan(), native: hasDetector() };
    }
  };
})();
