/* ==========================================================================
   OG SYSTEM — the warehouse room, in three dimensions          [shelfroom.js]
   --------------------------------------------------------------------------
   The WebGL half of the shelf map. js/shelfmap.js decides WHAT is on screen
   and stays the only file that talks to DB, t() and the server; this module
   is handed a plain model — a room, the racks on its walls, their levels and
   bays, one selected id — and draws it. It knows nothing about products
   beyond the strings it is given, so it can never disagree with the flat
   panel about what exists.

   A RACK IS A UNIT OF SHELVING FIXED TO A WALL. Its row letters are LEVELS,
   A at the top, and its columns are BAYS left to right as you stand facing
   the wall. A room is the thing with four walls that several racks hang
   inside; it has a name and, if somebody has measured it, a size. Unmeasured,
   the room is exactly as big as its racks need, and the map says so.

   EVERY NUMBER COMES FROM THE SERVER. How wide a bay is, how tall a level,
   how deep a rack — the standard rack arrives with the layout (setGeometry)
   and each rack carries its own size in metres. This file used to own those
   as constants, which meant the server was refusing overlaps in bays without
   knowing what a bay was. Now the browser draws what it is told and the
   arithmetic it runs before a drop (blockerOn, freeSlot) is a courtesy that
   mirrors server/lib/shelves.js; the server still decides.

   THE CANVAS OUTLIVES THE DOM, and that is the whole architecture. Every
   scan on the map is a repaint, and a repaint is root.innerHTML = body() —
   wholesale. A <canvas> written into that string would lose its WebGL
   context on every barcode of a put-away run. So the canvas is created ONCE,
   inside a wrapper it shares with the tag layer and the overlay, held in a
   module variable, pulled out of the tree before the innerHTML that would
   destroy it (ShelfRoom.detach) and put back after (ShelfRoom.attach).
   Moving a canvas between parents keeps its context; letting innerHTML eat
   it does not.

   FULLSCREEN IS THE SAME WRAPPER, RE-PARENTED TO <body>. Entering it moves
   the wrapper out of the map's stage and onto the body FIRST, then asks the
   browser for real fullscreen; refused or absent (an iPad, the harness), it
   stays as a fixed full-viewport box and nothing else is different. While
   it is out there a repaint must not pull it back — detach() and attach()
   are no-ops — and the nodes that live on <body> (the toasts, the modal
   root, the drag readout, the peek card) are brought inside for the
   duration, because the top layer hides everything outside it.

   THE SCENE IS A DIFF, NEVER A REBUILD. sync() compares the incoming model
   with the one on screen: same room, same racks, same bays, same sizes —
   touch fills and tag text only. Anything structural tears down and
   rebuilds. Forty meshes per scan would be the tilt-slider lesson ("a slider
   that re-renders forty tiles per tick stutters on exactly the hardware
   this has to run on") an order of magnitude worse.

   RENDER ON DEMAND, NEVER A LOOP. Every mutation sets `dirty` and asks for
   exactly one animation frame; a still camera schedules nothing at all. The
   two exceptions have a fixed end: the arrival tween, and the walk loop,
   which runs only while a key or a pad is held down. A 60fps idle loop is
   heat and battery on a fanless tablet in a warehouse.

   SHADOWS ARE BAKED. Nothing in the room moves except the camera, so the
   shadow map is rendered once per structural change (shadowMap.autoUpdate
   is off; needsUpdate is set at the end of rebuild and update) and costs
   nothing per frame after that. A machine that cannot afford even that
   drops to the low tier — no shadows, no antialias, one device pixel per
   CSS pixel — after timing its first three frames, and says so.

   THREE.JS IS FETCHED LAZILY, the first time somebody opens the map — never
   at boot. It is ~600KB (js/vendor/three.min.js, r147, the last release with
   a UMD build and a THREE global). The till must not parse 600KB every
   morning for a screen a cashier never opens.

   COLOUR — THE FLASH IS A RING, THE TYPE IS A FACE. The three scan colours
   exist here only as a ring around a bay. A product type is a fill on a
   crate and a tint on the board under it, never a line. The one other
   colour is the brand lime on the floor, as aisle marking — which is where
   real warehouses put it, and where it can never be mistaken for a scan.

   Labels are DOM, not textures — Arabic shaping and bidi belong to the
   browser's text engine. The two exceptions are SIGNS: the room's name on
   its back wall and the letter plaque on each rack. Those are world-anchored
   signage a person reads from across the room, drawn once into a canvas
   texture (the 2D canvas shapes Arabic correctly), and they are never the
   only carrier of anything — the DOM tags name every bay and run.
   ========================================================================== */

/* global THREE */

var ShelfRoom = (function () {
  'use strict';

  /* ------------------------------------------------------------ geometry
     The standard rack, in METRES, as the server sends it (GEOMETRY in
     server/lib/shelves.js, centimetres, ÷100 in setGeometry). These are the
     values a rack with no size of its own is drawn at; a rack that carries
     bay/level/depth uses those instead. The starting numbers here are only
     what the room draws before the first layout arrives. */
  var G = {
    bay: 1.14,        /* one bay, upright to upright — the pitch */
    level: 0.46,      /* one level of shelving — a shoe box and air */
    depth: 0.95,      /* how far a rack stands out from its wall */
    upright: 0.14,    /* the post between two bays, inside the pitch */
    base: 0.08,       /* the plinth the bottom level sits on */
    top: 0.05,        /* the top board */
    board: 0.04       /* a shelf board */
  };

  function setGeometry(g) {
    if (!g) return;
    var cm = function (k, was) { var v = Number(g[k]); return v > 0 ? v / 100 : was; };
    G.bay = cm('bay_cm', G.bay);
    G.level = cm('level_cm', G.level);
    G.depth = cm('depth_cm', G.depth);
    G.upright = cm('upright_cm', G.upright);
    G.base = cm('base_cm', G.base);
    G.top = cm('top_cm', G.top);
    G.board = cm('board_cm', G.board);
  }

  var AISLE = 0.55;     /* how far in front of a rack its floor line runs */
  var MIN_ROOM = 5.0;   /* a room is never drawn smaller than this, unmeasured */
  var DEF_H = 3.4;      /* an unmeasured room's wall height */
  var SNAP = 0.05;      /* 5 cm: a tape reads to the centimetre, a hand does not */
  var ROOM_MIN = 1.0, ROOM_MAX = 100.0;   /* MAX_ROOM_CM on the server, in metres */

  var EYE = 1.6;        /* eye height when walking */
  var SPEED = 2.2;      /* m/s — a brisk walk down an aisle */
  var WALL_PAD = 0.35;  /* how close the eye may get to a wall or a rack */
  var PITCH_MAX = 1.2;

  var C = {
    bg:     0x0d0d0d,
    floor:  0xffffff,   /* white: the concrete texture alone sets the tone, unmultiplied */
    wall:   0x17171b,
    skirt:  0x0b0b0d,
    grid:   0x26262b,   /* the metre grid on the floor, barely there */
    frame:  0x2d2d34,
    back:   0x121215,
    crate:  0x43434c,
    edge:   0x4a4a53,   /* a bay outline has to read against the frame, or an
                           empty bay is invisible and the room looks half built */
    sel:    0xffffff,
    lime:   0xc6ff00,   /* --brand: floor marking only */
    ok:     0x4ade80,   /* --success   — rings only, never fills */
    warn:   0xfbbf24,   /* --warning */
    bad:    0xf87171    /* --destructive */
  };

  var TAG_CAP = 12;     /* hard ceiling on live tags, whatever later phases add */

  /* ---------------------------------------------------------------- state */

  var cv = null;            /* the one canvas, for the life of the tab */
  var tagHost = null;       /* the one tag layer, same lifetime */
  var overlay = null;       /* the one overlay, for controls the map draws over the room */
  var wrap = null;          /* holds the three; this is what moves between parents */
  var renderer = null, scene = null, cam = null, sun = null;
  var root = null;          /* everything rebuilt per room hangs off this */
  var built = false;
  var dead = false;
  var host = null;

  var bays = {};            /* shelf id → { x,y,z (world), theta, crate, board, … } */
  var hitList = [];
  var rackBoxes = [];       /* one world-space box per rack: occlusion and collision */
  var racks = {};           /* rack id -> { g, cols, rows, key, wall, at, bay, level, depth } */
  var wallList = [];        /* the four wall planes, each tagged with its letter */
  var overflow = [];        /* racks drawn running past their wall, for the foot */
  var disposables = [];
  var sig = '';
  var cur = null;
  var pending = null;

  var selMesh = null, hoverMesh = null;
  var hoverId = null;
  var matFrame = null, matCrate = null, matBoard = null;
  var mats = {};            /* one material per colour, shared by every bay of that type */

  var hooks = { pick: null, lost: null, peek: null, fit: null, drag: null, move: null, room: null,
                fs: null, fsNodes: null, keys: null, mode: null, quality: null, qualityAuto: null };

  var az = 0.38, pol = 1.02, dist = 12;
  var target = null;
  var homeAz = 0.38, homePol = 1.02, homeDist = 12;
  var POL_MIN = 0.15;
  var POL_MAX = 1.42;
  var distMin = 3, distMax = 60;
  var panBound = 20;

  var dirty = false, raf = 0;
  var W = 0, H = 0;

  var ndc = null, ray = null, V = null, OCCP = null, LOOK = null;

  var tags = [];
  var logoTex = null;       /* assets/logo.svg, loaded once for the life of the tab */
  var floorTex = null;      /* the concrete, drawn once */

  var quality = 'high';     /* 'high' | 'low' — see setQuality */
  var autoTier = false;     /* time the first frames and drop if they are slow */
  var timed = [];

  /* ------------------------------------------------------------ capability */

  var probed = null;

  function supported() {
    if (dead) return false;
    if (/[?&]gl=off\b/.test(location.search)) return false;
    if (probed === null) {
      probed = false;
      try {
        var c = document.createElement('canvas');
        var opts = /[?&]gl=force\b/.test(location.search)
          ? {} : { failIfMajorPerformanceCaveat: true };
        probed = !!(c.getContext('webgl2', opts) || c.getContext('webgl', opts));
      } catch (e) { probed = false; }
    }
    return probed;
  }

  function ready() { return built && !dead; }

  /* -------------------------------------------------------- loading THREE */

  var loading = false, waiting = [];

  function flush(ok) {
    loading = false;
    var w = waiting; waiting = [];
    for (var i = 0; i < w.length; i++) w[i](ok);
  }

  function ensure(cb) {
    if (dead || !supported()) { cb(false); return; }
    if (built) { cb(true); return; }
    waiting.push(cb);
    if (loading) return;
    loading = true;

    if (window.THREE) { flush(boot()); return; }

    var s = document.createElement('script');
    s.src = 'js/vendor/three.min.js';
    s.onload = function () { flush(!!window.THREE && boot()); };
    /* A failed download is permanent for the page. Injecting the tag again
       on the next paint would fire the same 404 on every scan of the run. */
    s.onerror = function () { dead = true; flush(false); };
    document.head.appendChild(s);
  }

  function boot() {
    try {
      var want = hooks.quality ? hooks.quality() : 'auto';
      autoTier = want !== 'high' && want !== 'low';
      quality = want === 'low' ? 'low' : 'high';

      wrap = document.createElement('div');
      wrap.className = 'sm-gl';

      cv = document.createElement('canvas');
      cv.className = 'sm-room-gl';
      /* The canvas must NEVER take focus: the scan box owns the caret for
         the whole put-away run. No tabindex, ever. */
      wrap.appendChild(cv);

      renderer = new THREE.WebGLRenderer({
        canvas: cv, antialias: quality === 'high',
        failIfMajorPerformanceCaveat: !/[?&]gl=force\b/.test(location.search)
      });
      renderer.setClearColor(C.bg, 1);
      renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
      /* Baked: rendered once per structural change, never per frame. */
      renderer.shadowMap.enabled = quality === 'high';
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;

      scene = new THREE.Scene();
      cam = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
      target = new THREE.Vector3(0, 0.9, 0);
      ndc = new THREE.Vector2();
      ray = new THREE.Raycaster();
      V = new THREE.Vector3();
      OCCP = new THREE.Vector3();
      LOOK = new THREE.Vector3();

      /* A sky/ground pair so nothing is ever pure black, one sun from the
         front-left so every crate has a lit face and a shaded face and a
         shadow on the floor, and a dim fill from the right so the side walls
         are not one flat tone. Depth on a dark screen comes from those
         differences. The sun's shadow frustum is fitted to the room in
         rebuild(), because a frustum wide enough for a hangar is a blur on a
         cupboard. */
      scene.add(new THREE.HemisphereLight(0x9a9aa4, 0x0a0a0b, 1.0));
      sun = new THREE.DirectionalLight(0xffffff, 1.15);
      sun.position.set(-6, 11, 9);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0008;
      sun.shadow.normalBias = 0.02;
      scene.add(sun);
      scene.add(sun.target);
      var fill = new THREE.DirectionalLight(0xffffff, 0.3);
      fill.position.set(8, 6, -4);
      scene.add(fill);

      tagHost = document.createElement('div');
      tagHost.className = 'sm-room-tags';
      wrap.appendChild(tagHost);

      overlay = document.createElement('div');
      overlay.className = 'sm-gl-overlay';
      wrap.appendChild(overlay);

      bindPointer();
      bindKeys();

      cv.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        dead = true;
        stopTween();
        stopWalk();
        if (fs) leaveFs();
        teardown();
        if (hooks.lost) hooks.lost();
      });

      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(function () { measure(); }).observe(wrap);
      } else {
        window.addEventListener('resize', function () { measure(); });
      }

      built = true;
      if (pending) { var m = pending; pending = null; sync(m); }
      return true;
    } catch (e) {
      dead = true;
      return false;
    }
  }

  /* Everything the GPU was holding, released. Called on context loss so the
     page does not keep a dead renderer's buffers alive for its lifetime. */
  function teardown() {
    try {
      for (var i = 0; i < disposables.length; i++) disposables[i].dispose();
      disposables = [];
      Object.keys(mats).forEach(function (k) { mats[k].dispose(); });
      mats = {};
      for (var j = 0; j < flashPool.length; j++) {
        flashPool[j].seg.geometry.dispose();
        flashPool[j].seg.material.dispose();
      }
      flashPool = [];
      if (floorTex) { floorTex.dispose(); floorTex = null; }
      if (logoTex) { logoTex.dispose(); logoTex = null; }
      if (renderer) renderer.dispose();
    } catch (e) { /* a dead context may refuse; nothing else to do */ }
  }

  /* --------------------------------------------------------- attach/detach */

  function detach() {
    /* The wrapper is leaving the tree. frame() bails on !cv.isConnected so
       nothing would draw — but the tween would go on asking for frames
       against a scene nobody can see, for as long as it had left to run. */
    if (fs) return;   /* out on <body>: the repaint must not pull it back */
    stopTween();
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }

  function attach(mount) {
    if (!wrap || !mount) return;
    var wait = mount.querySelector('.sm-room-wait');
    if (wait) wait.style.display = 'none';
    if (fs) return;
    if (wrap.parentNode !== mount) mount.appendChild(wrap);
    host = mount;
    measure();
  }

  function measure() {
    if (!renderer || !wrap) return;
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    W = w; H = h;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    invalidate();
  }

  /* ----------------------------------------------------------- the frame */

  function frame() {
    raf = 0;
    if (!dirty || !renderer || dead || !cv.isConnected) return;
    dirty = false;
    var t0 = autoTier && timed.length < 3 ? now() : 0;
    renderer.render(scene, cam);
    if (t0) {
      timed.push(now() - t0);
      /* Three slow frames in a row on a freshly built room is the hardware
         talking, not a hiccup: drop to the low tier and remember it. */
      if (timed.length === 3) {
        autoTier = false;
        var mean = (timed[0] + timed[1] + timed[2]) / 3;
        if (mean > 40 && quality === 'high') {
          setQuality('low');
          if (hooks.qualityAuto) hooks.qualityAuto('low');
        }
      }
    }
    place();
  }

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function invalidate() {
    dirty = true;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /* One of two tiers, switchable while the room is up. Shadows and the
     pixel ratio change on the spot; antialiasing is fixed when the renderer
     is created and follows on the next open of the map, which the quality
     control's note says. */
  function setQuality(q) {
    q = q === 'low' ? 'low' : 'high';
    if (q === quality) return;
    quality = q;
    autoTier = false;
    if (!renderer) return;
    renderer.shadowMap.enabled = q === 'high';
    renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    /* Materials compile their shadow code in; a tier change needs them
       compiled again or the old shader keeps sampling a map that is gone. */
    if (root) root.traverse(function (o) { if (o.material) o.material.needsUpdate = true; });
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
    W = H = 0; measure();
    invalidate();
  }

  /* ------------------------------------------------------------ textures
     Drawn once and kept. The floor is procedural — a sheet of noise tinted
     to the room's grey — because a concrete photo would be another file to
     ship and would tile visibly across a big floor. */

  function concrete() {
    if (floorTex) return floorTex;
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#1c1c21';
    g.fillRect(0, 0, 256, 256);
    var img = g.getImageData(0, 0, 256, 256), px = img.data;
    var seed = 7;
    for (var i = 0; i < px.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      var n = ((seed >>> 16) & 0xff) / 255;             /* 0..1 */
      var v = 40 + n * 24;                                 /* 40..64 — concrete, not coal */
      px[i] = v; px[i + 1] = v; px[i + 2] = v + 4; px[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    /* a few darker scuffs, so it is a floor and not static */
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (var k = 0; k < 40; k++) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      var x = (seed >>> 8) % 256;
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      var y = (seed >>> 8) % 256;
      g.beginPath(); g.arc(x, y, 6 + (seed % 9), 0, Math.PI * 2); g.fill();
    }
    floorTex = new THREE.CanvasTexture(c);
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.anisotropy = 4;
    return floorTex;
  }

  /* A sign. Text through the 2D canvas, which shapes Arabic and lays out
     bidi like any other text in the page. Sized so the largest name still
     fits — fillText's maxWidth squeezes rather than clips. */
  function signTexture(text, w, h, px, bg) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.fillStyle = '#FFFFFF';
    g.font = '800 ' + px + 'px Montserrat, "Segoe UI", Tahoma, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.direction = /[؀-ۿ]/.test(text) ? 'rtl' : 'ltr';
    g.fillText(text, w / 2, h / 2 + px * 0.04, w * 0.9);
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  /* The mark, drawn through a canvas rather than handed to TextureLoader:
     an SVG has no pixels until something rasterises it, and the loader's
     crossOrigin default refuses a same-origin file under file:// — which is
     where the harness lives. A canvas of a same-origin image is clean under
     the real server, and if anything about it fails the plate simply stays
     black, which is the mark's own ground colour. */
  function logo(cb) {
    if (logoTex) { cb(logoTex); return; }
    var img = new Image();
    img.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = c.height = 512;
        var g = c.getContext('2d');
        g.fillStyle = '#000000';
        g.fillRect(0, 0, 512, 512);
        g.drawImage(img, 0, 0, 512, 512);
        logoTex = new THREE.CanvasTexture(c);
        logoTex.anisotropy = 4;
        cb(logoTex);
      } catch (e) { /* tainted or unreadable: keep the black plate */ }
    };
    img.src = 'assets/logo.svg';
  }

  /* ------------------------------------------------------------ the model */

  /* A rack's size in metres, its own numbers or the standard ones. */
  function dims(r) {
    return {
      bay: r.bay > 0 ? r.bay : G.bay,
      level: r.level > 0 ? r.level : G.level,
      depth: r.depth > 0 ? r.depth : G.depth
    };
  }
  function widthOf(r) { return r.cols * dims(r).bay; }
  function heightOf(rows, level) { return G.base + rows * level + G.top; }

  function sameSig(model) {
    /* model.name is in here because the room's name is PAINTED on the back
       wall: left out, renaming a room left the old name hanging up there
       until something structural forced a rebuild. `origin` likewise — the
       columns are mirrored into the bay models, so a flipped rack is a
       different set of positions, and without it the flip drew nothing. */
    var parts = [model.roomId, model.name, model.w, model.d, model.h];
    for (var i = 0; i < model.racks.length; i++) {
      var r = model.racks[i];
      var ids = [];
      for (var j = 0; j < r.bays.length; j++) ids.push(r.bays[j].id);
      parts.push(r.id + ':' + r.wall + ':' + r.at + ':' + r.cols + ':' + r.rows + ':' + r.key + ':' +
                 r.origin + ':' + r.bay + ':' + r.level + ':' + r.depth + ':' + ids.join(','));
    }
    return parts.join('|');
  }

  function sync(model) {
    if (!built) { pending = model; return; }
    var s = sameSig(model);
    var newRoom = !cur || cur.roomId !== model.roomId ||
                  (model.roomId == null && (!cur.racks[0] || !model.racks[0] || cur.racks[0].id !== model.racks[0].id));
    cur = model;
    if (s !== sig) { sig = s; rebuild(model, newRoom); }
    else update(model);
    invalidate();
  }

  function keep(g) { disposables.push(g); return g; }

  /* THE TYPE IS A FACE. A colour reaches the scene only as a fill — the
     crate for what is on the bay, the board under it (tinted toward the
     frame) for what the bay is assigned to. Never a line material. */
  function matFor(hex, tint) {
    var key = (tint ? 't:' : 'f:') + hex;
    if (!mats[key]) {
      var col = new THREE.Color(hex);
      if (tint) col = new THREE.Color(C.frame).lerp(col, 0.55);
      mats[key] = new THREE.MeshStandardMaterial({ color: col, roughness: tint ? 0.85 : 0.9, metalness: 0.0 });
    }
    return mats[key];
  }

  /* Where a rack on a wall sits, and which way it faces. `at` is metres from
     the LEFT end of the wall as you stand inside facing it — so "left" means
     a different world axis on every wall, and this table is the whole of
     that arithmetic in one place. THE CM TWIN IS footprint() IN
     server/lib/shelves.js; change one and you must change the other. */
  function placeOnWall(wall, at, width, depth, w, d) {
    var along = at + width / 2;
    switch (wall) {
      case 'n': return { x: -w / 2 + along, z: -d / 2 + depth / 2, theta: 0 };
      case 's': return { x:  w / 2 - along, z:  d / 2 - depth / 2, theta: Math.PI };
      case 'e': return { x:  w / 2 - depth / 2, z: -d / 2 + along, theta: -Math.PI / 2 };
      default:  return { x: -w / 2 + depth / 2, z:  d / 2 - along, theta: Math.PI / 2 };
    }
  }

  /* The floor a rack covers, in metres from the room's north-west corner —
     x east, z south — for the overlap test. The same four cases as the
     server's footprint(), in the same order. */
  function footprint(wall, at, width, depth, w, d) {
    switch (wall) {
      case 'n': return { x0: at, x1: at + width, z0: 0, z1: depth };
      case 's': return { x0: w - at - width, x1: w - at, z0: d - depth, z1: d };
      case 'e': return { x0: w - depth, x1: w, z0: at, z1: at + width };
      default:  return { x0: 0, x1: depth, z0: d - at - width, z1: d - at };
    }
  }

  function overlaps(a, b) {
    return a.x0 < b.x1 - 0.001 && b.x0 < a.x1 - 0.001 && a.z0 < b.z1 - 0.001 && b.z0 < a.z1 - 0.001;
  }

  function rebuild(model, newRoom) {
    if (root) {
      scene.remove(root);
      for (var dd = 0; dd < disposables.length; dd++) disposables[dd].dispose();
    }
    disposables = [];
    bays = {};
    hitList = [];
    rackBoxes = [];
    racks = {};
    wallList = [];
    hoverId = null;
    Object.keys(mats).forEach(function (k) { mats[k].dispose(); });
    mats = {};

    root = new THREE.Group();
    scene.add(root);

    var unitBox = keep(new THREE.BoxGeometry(1, 1, 1));
    var unitEdges = keep(new THREE.EdgesGeometry(unitBox));
    /* Every material this rebuild makes goes through keep(), so the next
       rebuild releases it. They used to be made fresh each time and never
       disposed — a leak the size of a room on every layout change. */
    matFrame = keep(new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.85, metalness: 0.15 }));
    matBoard = matFrame;
    matCrate = keep(new THREE.MeshStandardMaterial({ color: C.crate, roughness: 0.9, metalness: 0.0 }));
    var matEdge = keep(new THREE.LineBasicMaterial({ color: C.edge }));
    var matHit = keep(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    var matBack = keep(new THREE.MeshStandardMaterial({ color: C.back, roughness: 0.95, metalness: 0.0 }));
    var matLime = keep(new THREE.MeshBasicMaterial({ color: C.lime }));

    var inRoom = model.roomId != null;

    /* ---- how big is the room ----------------------------------------
       Measured: the tape decides, alone. Unmeasured: the racks decide, with
       the aisle in front of them and room to walk. */
    var need = { n: 0, s: 0, e: 0, w: 0 }, tallest = 0, deepest = 0;
    model.racks.forEach(function (r) {
      if (!r.bays.length) return;
      var dm = dims(r);
      tallest = Math.max(tallest, heightOf(r.rows, dm.level));
      deepest = Math.max(deepest, dm.depth);
      if (r.wall) need[r.wall] = Math.max(need[r.wall], (r.at || 0) + widthOf(r) + 0.6);
    });
    /* MEASURED MEANS MEASURED. A room somebody put a tape on is drawn at the
       size the tape says. This used to be a Math.max of the tape AND what the
       racks wanted, so one rack sitting past the end of a wall quietly
       stretched the whole room — and the badge went on saying "to scale"
       while the walls moved. A rack that does not fit is now DRAWN not
       fitting and named underneath, because a wall you can SEE is too short
       is a wall somebody will fix. */
    var measured = !!(model.w && model.d);
    var roomW, roomD;
    if (measured) {
      roomW = model.w;
      roomD = model.d;
    } else {
      roomW = Math.max(need.n, need.s, inRoom ? MIN_ROOM : 0);
      roomD = Math.max(need.e, need.w, inRoom ? MIN_ROOM : 0);
      /* racks on the side walls need depth behind the racks on the end walls */
      roomW = Math.max(roomW, (need.e || need.w) ? deepest * 2 + 3 : 0);
      roomD = Math.max(roomD, (need.n || need.s) ? deepest * 2 + 3 : 0);
    }
    var roomH = model.h ? model.h : Math.max(DEF_H, tallest + 1.4);
    roomBox = { w: roomW, d: roomD, h: roomH, inRoom: inRoom, measured: measured };

    overflow = [];
    if (measured) {
      model.racks.forEach(function (r) {
        if (!r.bays.length || !r.wall) return;
        var lenM = (r.wall === 'n' || r.wall === 's') ? roomW : roomD;
        var over = (r.at || 0) + widthOf(r) - lenM;
        if (over > 0.02) overflow.push({ key: r.key, wall: r.wall, over: over });
      });
    }

    /* ---- the racks -------------------------------------------------- */
    var loose = 0, looseTotal = 0;
    model.racks.forEach(function (r) { if (r.bays.length && (!inRoom || !r.wall)) looseTotal++; });

    /* A rack with no wall yet stands on the floor so it can still be seen and
       still be placed. Inside a room it has to stay INSIDE it: the old layout
       was one straight row down the middle and it marched out through the end
       wall the moment the row grew longer than the room. Now it wraps. */
    var looseAt = {};
    (function () {
      var list = [];
      model.racks.forEach(function (o) { if (o.bays.length && (!inRoom || !o.wall)) list.push(o); });
      if (!list.length) return;
      var GAP = 1.2, lane = inRoom ? Math.max(2.0, roomW - 1.4) : Infinity;
      var lanes = [], line = [], lineW = 0;
      list.forEach(function (o) {
        var wd = widthOf(o);
        if (line.length && lineW + GAP + wd > lane) { lanes.push({ items: line, w: lineW }); line = []; lineW = 0; }
        lineW += (line.length ? GAP : 0) + wd;
        line.push(o);
      });
      lanes.push({ items: line, w: lineW });
      var depth = deepest + 1.1, z0 = -((lanes.length - 1) * depth) / 2;
      lanes.forEach(function (ln, li) {
        var x = -ln.w / 2;
        ln.items.forEach(function (o) {
          var wd = widthOf(o);
          looseAt[o.id] = { x: x + wd / 2, z: z0 + li * depth, theta: 0 };
          x += wd + GAP;
        });
      });
    })();

    model.racks.forEach(function (r) {
      if (!r.bays.length) return;
      var dm = dims(r);
      var BAY = dm.bay, LEVEL = dm.level, DEPTH = dm.depth;
      var width = r.cols * BAY, height = heightOf(r.rows, LEVEL);
      var at;
      if (inRoom && r.wall) {
        at = placeOnWall(r.wall, r.at || 0, width, DEPTH, roomW, roomD);
      } else {
        at = looseAt[r.id] || { x: 0, z: 0, theta: 0 };
        loose++;
      }

      var g = new THREE.Group();
      g.position.set(at.x, 0, at.z);
      g.rotation.y = at.theta;
      root.add(g);

      /* the frame: uprights at every bay boundary, a back panel, a top board */
      for (var i = 0; i <= r.cols; i++) {
        var up = new THREE.Mesh(unitBox, matFrame);
        up.scale.set(G.upright, height, DEPTH * 0.94);
        up.position.set((i - r.cols / 2) * BAY, height / 2, 0);
        up.castShadow = true; up.receiveShadow = true;
        g.add(up);
      }
      /* A back panel only when the rack stands free. Against a wall the
         wall IS its back — and since the walls are culled from outside, an
         open back is what lets somebody orbiting behind the front wall see
         what is on the front rack instead of a slab. */
      if (!(inRoom && r.wall)) {
        var back = new THREE.Mesh(unitBox, matBack);
        back.scale.set(width, height, 0.03);
        back.position.set(0, height / 2, -DEPTH / 2 + 0.015);
        back.castShadow = true; back.receiveShadow = true;
        g.add(back);
      }
      var top = new THREE.Mesh(unitBox, matFrame);
      top.scale.set(width, G.top, DEPTH);
      top.position.set(0, height - G.top / 2, 0);
      top.castShadow = true; top.receiveShadow = true;
      g.add(top);

      /* the letter, as a plaque above the rack */
      var plaque = new THREE.Mesh(
        keep(new THREE.PlaneGeometry(0.44, 0.44)),
        keep(new THREE.MeshBasicMaterial({ map: keep(signTexture(r.key, 128, 128, 84, '#0a0a0b')) }))
      );
      plaque.position.set(0, height + 0.34, 0.06);
      g.add(plaque);

      /* the aisle line: brand lime, on the floor, in front */
      var line = new THREE.Mesh(keep(new THREE.PlaneGeometry(width, 0.05)), matLime);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.004, DEPTH / 2 + AISLE);
      g.add(line);

      g.updateMatrixWorld(true);

      var hw = new THREE.Vector3(width / 2, height / 2, DEPTH / 2);
      var bx = new THREE.Box3(hw.clone().multiplyScalar(-1), hw.clone());
      bx.applyMatrix4(g.matrixWorld);
      rackBoxes.push({ id: r.id, box: bx });
      racks[r.id] = { g: g, cols: r.cols, rows: r.rows, key: r.key, wall: r.wall, at: r.at || 0,
                      bay: BAY, level: LEVEL, depth: DEPTH, width: width };

      /* the bays, level by level — A at the top */
      r.bays.forEach(function (b) {
        var xl = (b.col - (r.cols + 1) / 2) * BAY;
        var yFloor = G.base + (r.rows - 1 - b.row) * LEVEL;

        var board = new THREE.Mesh(unitBox, matBoard);
        board.scale.set(BAY, G.board, DEPTH);
        board.position.set(xl, yFloor - G.board / 2, 0);
        board.castShadow = true; board.receiveShadow = true;
        g.add(board);

        var edge = new THREE.LineSegments(unitEdges, matEdge);
        edge.scale.set(BAY - G.upright, LEVEL - G.board - 0.04, DEPTH * 0.9);
        edge.position.set(xl, yFloor + (LEVEL - G.board) / 2, 0);
        g.add(edge);

        var crate = new THREE.Mesh(unitBox, matCrate);
        crate.castShadow = true; crate.receiveShadow = true;
        g.add(crate);

        var hit = new THREE.Mesh(unitBox, matHit);
        hit.scale.set(BAY, LEVEL, DEPTH);
        hit.position.set(xl, yFloor + LEVEL / 2, 0);
        hit.userData.id = b.id;
        g.add(hit);
        hitList.push(hit);

        var wp = g.localToWorld(new THREE.Vector3(xl, yFloor + LEVEL / 2, 0));
        bays[b.id] = {
          x: wp.x, y: wp.y, z: wp.z, theta: at.theta, yFloor: yFloor,
          xl: xl, crate: crate, board: board,
          bay: BAY, level: LEVEL, depth: DEPTH,
          full: b.full, name: b.name, pid: b.pid, row: b.row, col: b.col, rack: r.id
        };
        setCrate(bays[b.id], b);
      });
    });

    /* ---- the room around them --------------------------------------- */
    var floorW = inRoom ? roomW : Math.max(8, roomW + 6);
    var floorD = inRoom ? roomD : Math.max(8, roomD + 6);
    var tex = concrete();
    var floorMat = keep(new THREE.MeshStandardMaterial({ color: C.floor, map: tex, roughness: 0.95, metalness: 0.0 }));
    var floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(floorW, floorD)), floorMat);
    tex.repeat.set(floorW / 2.2, floorD / 2.2);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    root.add(floor);

    if (inRoom) {
      /* A metre grid on the floor, faint. It is what makes "8 by 3" a size a
         person can see rather than a caption, and what makes a pulled wall
         read as a distance rather than a slide. */
      (function () {
        var pts = [], x, z;
        for (x = Math.ceil(-roomW / 2); x <= Math.floor(roomW / 2); x++) pts.push(x, 0, -roomD / 2, x, 0, roomD / 2);
        for (z = Math.ceil(-roomD / 2); z <= Math.floor(roomD / 2); z++) pts.push(-roomW / 2, 0, z, roomW / 2, 0, z);
        if (!pts.length) return;
        var gg = keep(new THREE.BufferGeometry());
        gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        var grid = new THREE.LineSegments(gg, keep(new THREE.LineBasicMaterial({ color: C.grid })));
        grid.position.y = 0.002;
        root.add(grid);
      })();

      /* four walls that face INWARD only — from outside the near wall is
         backface-culled, so orbiting behind the room looks into it. */
      var wallMat = keep(new THREE.MeshStandardMaterial({ color: C.wall, roughness: 0.95, metalness: 0.0 }));
      var skirtMat = keep(new THREE.MeshStandardMaterial({ color: C.skirt, roughness: 0.9, metalness: 0.0 }));
      /* Each wall knows which one it is, because in the editor a wall is not
         only scenery: it is the handle you pull to say how big the room
         really is. They face inward and are backface-culled, so this also
         means only a wall you can actually see can be grabbed. */
      var mkWall = function (len, x, z, ry, which) {
        var m = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, roomH)), wallMat);
        m.position.set(x, roomH / 2, z);
        m.rotation.y = ry;
        m.userData.wall = which;
        m.receiveShadow = true;
        wallList.push(m);
        root.add(m);
        /* a skirt at the foot and a cornice at the head, pushed a hair into
           the room so they do not z-fight the wall */
        var sk = new THREE.Mesh(unitBox, skirtMat);
        sk.scale.set(len, 0.12, 0.04);
        sk.position.set(x, 0.06, z);
        sk.rotation.y = ry;
        sk.translateZ(0.02);
        root.add(sk);
        var co = new THREE.Mesh(unitBox, skirtMat);
        co.scale.set(len, 0.10, 0.06);
        co.position.set(x, roomH - 0.05, z);
        co.rotation.y = ry;
        co.translateZ(0.03);
        root.add(co);
      };
      mkWall(roomW, 0, -roomD / 2, 0, 'n');
      mkWall(roomW, 0, roomD / 2, Math.PI, 's');
      mkWall(roomD, -roomW / 2, 0, Math.PI / 2, 'w');
      mkWall(roomD, roomW / 2, 0, -Math.PI / 2, 'e');

      /* the brand on the back wall, above the racks: the mark, and the
         room's name beside it — stacked when the room is narrow */
      var topOf = tallest + 0.55;
      var signY = Math.min(roomH - 0.75, topOf + 0.7);
      var wide = roomW >= 5.6;
      var logoSize = 1.0;
      /* NO MARK IS BETTER THAN A BLACK SQUARE. The plate starts hidden and
         appears only once the artwork is actually in hand: the loader is
         asynchronous and can fail outright — a missing file, a canvas the
         browser refuses to read from — and a black rectangle hanging on the
         wall of the shop's own warehouse reads as a broken screen, not as a
         logo that did not arrive. */
      var logoPlane = new THREE.Mesh(keep(new THREE.PlaneGeometry(logoSize, logoSize)),
                                     keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true })));
      logoPlane.position.set(wide ? -1.65 : 0, wide ? signY : signY + 0.65, -roomD / 2 + 0.02);
      logoPlane.visible = false;
      root.add(logoPlane);
      logo(function (t) {
        if (!t || logoPlane.parent !== root) return;
        logoPlane.material.map = t;
        logoPlane.material.needsUpdate = true;
        logoPlane.visible = true;
        invalidate();
      });
      if (model.name) {
        var sign = new THREE.Mesh(
          keep(new THREE.PlaneGeometry(3.0, 0.72)),
          keep(new THREE.MeshBasicMaterial({ map: keep(signTexture(model.name, 1024, 246, 118, '#0a0a0b')) }))
        );
        sign.position.set(wide ? 0.55 : 0, wide ? signY : signY - 0.45, -roomD / 2 + 0.02);
        root.add(sign);
      }
    }

    /* the two floating outlines: one selection, one hover, moved not remade */
    selMesh = new THREE.LineSegments(unitEdges, keep(new THREE.LineBasicMaterial({ color: C.sel })));
    selMesh.visible = false;
    root.add(selMesh);

    hoverMesh = new THREE.LineSegments(unitEdges, keep(new THREE.LineBasicMaterial({ color: 0x8a8a92 })));
    hoverMesh.visible = false;
    root.add(hoverMesh);

    ghost = new THREE.LineSegments(unitEdges, keep(new THREE.LineBasicMaterial({ color: C.sel })));
    ghost.visible = false;
    root.add(ghost);
    ghostFloor = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)),
                                keep(new THREE.MeshBasicMaterial({ color: C.lime, transparent: true, opacity: 0.35 })));
    ghostFloor.rotation.x = -Math.PI / 2;
    ghostFloor.visible = false;
    root.add(ghostFloor);

    roomGhost = new THREE.LineSegments(unitEdges, keep(new THREE.LineBasicMaterial({ color: C.sel })));
    roomGhost.visible = false;
    root.add(roomGhost);

    /* the sun's shadow frustum, fitted to this room and no bigger */
    var R = Math.max(roomW, roomD) / 2 + 1;
    (function () {
      var sc = sun.shadow.camera;
      sun.position.set(-6, 11, 9).normalize().multiplyScalar(Math.max(14, R * 2.2));
      sun.target.position.set(0, 0, 0);
      sc.left = -R * 1.2; sc.right = R * 1.2; sc.top = R * 1.2; sc.bottom = -R * 1.2;
      sc.near = 1; sc.far = Math.max(40, R * 5);
      sc.updateProjectionMatrix();
    })();

    /* home the camera to the room — from the entrance side, three-quarter,
       high enough to see over the front rack into the room */
    homeDist = Math.max(6, R / Math.tan((cam.fov * Math.PI / 360)) * 0.95);
    distMin = 2.2; distMax = homeDist * 3; panBound = R + 4;
    /* Higher over a room than over a single rack: from eye height the front
       wall's rack hides the floor, and from above every wall's rack shows
       its face. Reset view is one click away either way. */
    homeAz = inRoom ? 0.42 : 0.3;
    homePol = inRoom ? 0.88 : 1.05;
    scene.fog = new THREE.Fog(C.bg, homeDist * 1.6, homeDist * 4.8);
    if (newRoom) {
      target.set(0, inRoom ? 0.9 : 0.7, 0);
      if (mode === 'walk') startWalk(); else resetView();
    } else if (mode === 'walk') {
      /* the room may have changed size under the feet; stay inside it */
      var c = collide(wk.x, wk.z);
      wk.x = c.x; wk.z = c.z;
      updateCam();
    }
    timed = [];
    /* World matrices, now, not at the next render: castWall() and castAt()
       walk this scene, and a press that arrives before the first frame
       after a rebuild would otherwise test walls still standing at the
       origin. */
    root.updateMatrixWorld(true);
    applySel(model.sel);
    if (hooks.fit) hooks.fit(overflow);
    renderer.shadowMap.needsUpdate = true;
  }

  function setCrate(rec, b) {
    var c = rec.crate;
    rec.board.material = b.mark ? matFor(b.mark, true) : matBoard;
    c.material = b.fill ? matFor(b.fill, false) : matCrate;
    if (!b.qty) { c.visible = false; return; }
    var frac = (b.capacity && b.capacity > 0)
      ? Math.max(0.16, Math.min(1, b.qty / b.capacity))
      : 0.55;
    var h = (rec.level - G.board - 0.08) * frac;
    c.visible = true;
    c.scale.set((rec.bay - G.upright) * 0.9, h, rec.depth * 0.78);
    c.position.set(rec.xl, rec.yFloor + 0.005 + h / 2, 0);
  }

  function update(model) {
    for (var i = 0; i < model.racks.length; i++) {
      var r = model.racks[i];
      for (var j = 0; j < r.bays.length; j++) {
        var b = r.bays[j], rec = bays[b.id];
        if (!rec) continue;
        rec.name = b.name;
        rec.pid = b.pid;
        setCrate(rec, b);
      }
    }
    applySel(model.sel);
    /* crates grew or shrank: their shadows did too */
    if (renderer) renderer.shadowMap.needsUpdate = true;
  }

  function outlineAt(mesh, rec) {
    mesh.scale.set(rec.bay - G.upright + 0.06, rec.level - G.board + 0.02, rec.depth * 0.96);
    mesh.position.set(rec.x, rec.y - G.board / 2, rec.z);
    mesh.rotation.y = rec.theta;
  }

  function applySel(id) {
    var rec = id != null ? bays[id] : null;
    selMesh.visible = !!rec;
    if (rec) outlineAt(selMesh, rec);
    retag();
  }

  /* -------------------------------------------------------------- camera
     Two ways of looking. ORBIT is the planner's: the room turns under the
     hand, the wheel dollies, the middle button pans. WALK is the person's:
     eye height, keys or pads to move, drag to look round, and the walls and
     racks are solid. Both drive the same camera; `mode` says which set of
     numbers is in charge. */

  var mode = 'orbit';
  var wk = { x: 0, z: 0, yaw: 0, pitch: -0.05 };

  function updateCam() {
    if (mode === 'walk') {
      cam.position.set(wk.x, EYE, wk.z);
      var cp = Math.cos(wk.pitch);
      LOOK.set(wk.x + Math.sin(wk.yaw) * cp, EYE + Math.sin(wk.pitch), wk.z - Math.cos(wk.yaw) * cp);
      cam.lookAt(LOOK);
    } else {
      var sp = Math.sin(pol);
      cam.position.set(target.x + dist * sp * Math.sin(az),
                       target.y + dist * Math.cos(pol),
                       target.z + dist * sp * Math.cos(az));
      cam.lookAt(target);
    }
    /* The same reason: a ray cast between this move and the next frame
       has to start where the camera now is, not where it was drawn. */
    cam.updateMatrixWorld();
    invalidate();
  }

  function resetView() {
    stopTween();
    az = homeAz; pol = homePol; dist = homeDist;
    if (target) target.set(0, cur && cur.roomId != null ? 0.9 : 0.7, 0);
    if (cam) updateCam();
  }

  /* The four canned views, each a bounded tween from wherever the camera is.
     From the walk they first hand over to the orbit — a tween between an eye
     on the floor and a seat in the sky would swing through the walls. */
  function view(kind) {
    if (!built) return;
    if (mode === 'walk') setMode('orbit');
    var ty = cur && cur.roomId != null ? 0.9 : 0.7;
    var to;
    if (kind === 'top') to = { az: 0, pol: POL_MIN + 0.02, dist: homeDist * 1.05, tx: 0, ty: 0, tz: 0 };
    else if (kind === 'front') to = { az: 0, pol: 1.22, dist: homeDist * 0.9, tx: 0, ty: ty, tz: 0 };
    else to = { az: homeAz, pol: homePol, dist: homeDist, tx: 0, ty: ty, tz: 0 };
    tween(to, 520);
  }

  function setMode(m) {
    m = m === 'walk' ? 'walk' : 'orbit';
    if (m === mode) return;
    stopTween();
    stopWalk();
    mode = m;
    if (mode === 'walk') startWalk(); else { if (cam) updateCam(); }
    if (cv) cv.style.cursor = mode === 'walk' ? 'crosshair' : 'grab';
    /* Told every time it changes — including when a canned view hands the
       walk back to the orbit — so the switch on screen never lies. */
    if (hooks.mode) hooks.mode(mode);
  }

  /* In at the door: the middle of the front wall, a step inside, facing the
     back wall. A rack standing there pushes the eye out of itself. */
  function startWalk() {
    wk.yaw = 0; wk.pitch = -0.05;
    wk.x = 0; wk.z = (roomBox.inRoom ? roomBox.d / 2 : Math.max(4, roomBox.d / 2 + 2)) - 1.0;
    var c = collide(wk.x, wk.z);
    wk.x = c.x; wk.z = c.z;
    if (cam) updateCam();
  }

  /* ---- the walk loop: runs only while something is pressed --------- */
  var heldKeys = {};        /* 'fwd' | 'back' | 'left' | 'right' -> true */
  var walkRaf = 0, walkLast = 0;
  var walkFocus = false;    /* the hand last touched the canvas or a pad */

  function anyHeld() {
    return !!(heldKeys.fwd || heldKeys.back || heldKeys.left || heldKeys.right);
  }

  function walkLoop() {
    walkRaf = 0;
    if (mode !== 'walk' || !anyHeld() || dead) { walkLast = 0; return; }
    var t = now();
    var dt = walkLast ? Math.min(0.05, (t - walkLast) / 1000) : 1 / 60;
    walkLast = t;
    var fwd = (heldKeys.fwd ? 1 : 0) - (heldKeys.back ? 1 : 0);
    var side = (heldKeys.right ? 1 : 0) - (heldKeys.left ? 1 : 0);
    if (fwd || side) {
      var n = Math.hypot(fwd, side);
      var fx = Math.sin(wk.yaw), fz = -Math.cos(wk.yaw);
      var rx = Math.cos(wk.yaw), rz = Math.sin(wk.yaw);
      var s = SPEED * dt / n;
      var c = collide(wk.x + (fx * fwd + rx * side) * s, wk.z + (fz * fwd + rz * side) * s);
      wk.x = c.x; wk.z = c.z;
      updateCam();
    }
    walkRaf = requestAnimationFrame(walkLoop);
  }

  function kick() {
    if (walkRaf || mode !== 'walk' || !anyHeld()) return;
    walkLast = 0;
    walkRaf = requestAnimationFrame(walkLoop);
  }

  function stopWalk() {
    heldKeys = {};
    if (walkRaf) cancelAnimationFrame(walkRaf);
    walkRaf = 0; walkLast = 0;
  }

  /* Pads and keys arrive here. `null` releases everything — a pad that is
     repainted under a finger never sends its pointerup. */
  function walkKey(which, on) {
    if (which == null) { stopWalk(); return; }
    if (on) { heldKeys[which] = true; walkFocus = true; kick(); }
    else delete heldKeys[which];
  }

  function step(dir) {
    if (mode !== 'walk') return;
    var fx = Math.sin(wk.yaw), fz = -Math.cos(wk.yaw);
    var c = collide(wk.x + fx * 0.45 * dir, wk.z + fz * 0.45 * dir);
    wk.x = c.x; wk.z = c.z;
    updateCam();
  }

  /* Turn the head. Pixels of drag, or a pad's nudge in the same units. */
  function look(dx, dy) {
    if (mode !== 'walk') return;
    wk.yaw += dx * 0.0042;
    wk.pitch = clamp(wk.pitch - dy * 0.0042, -PITCH_MAX, PITCH_MAX);
    updateCam();
  }

  /* The walls are solid and so are the racks. Clamp to the room, then push
     out of any rack box the eye has wandered into, along whichever side is
     nearest — which is what makes sliding along a rack feel like a wall and
     not like glue. */
  function collide(x, z) {
    var pad = WALL_PAD;
    if (roomBox.inRoom && roomBox.w > pad * 2 && roomBox.d > pad * 2) {
      x = clamp(x, -roomBox.w / 2 + pad, roomBox.w / 2 - pad);
      z = clamp(z, -roomBox.d / 2 + pad, roomBox.d / 2 - pad);
    }
    for (var i = 0; i < rackBoxes.length; i++) {
      var b = rackBoxes[i].box;
      if (racks[rackBoxes[i].id] && !racks[rackBoxes[i].id].g.visible) continue;
      var x0 = b.min.x - pad, x1 = b.max.x + pad, z0 = b.min.z - pad, z1 = b.max.z + pad;
      if (x <= x0 || x >= x1 || z <= z0 || z >= z1) continue;
      var dl = x - x0, dr = x1 - x, dn = z - z0, ds = z1 - z;
      var m = Math.min(dl, dr, dn, ds);
      if (m === dl) x = x0; else if (m === dr) x = x1; else if (m === dn) z = z0; else z = z1;
    }
    return { x: x, z: z };
  }

  /* WASD and the arrows, at the document, and ONLY while the hand's last
     press was on the canvas or a pad: a person typing a code into the scan
     box is not walking, and a person who just clicked the room is not
     typing. The wedge listens at the capture phase and buffers every key
     itself, so a scanner gun is never in this conversation — its letters
     reach here too, are consumed, and the scan still lands. */
  var KEYMAP = { w: 'fwd', W: 'fwd', ArrowUp: 'fwd', s: 'back', S: 'back', ArrowDown: 'back',
                 a: 'left', A: 'left', ArrowLeft: 'left', d: 'right', D: 'right', ArrowRight: 'right' };

  function keysAllowed(e) {
    if (mode !== 'walk' || !walkFocus || dead || !cv.isConnected) return false;
    if (hooks.keys && !hooks.keys()) return false;
    var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    if ((tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) &&
        t.id !== 'smScan' && t.id !== 'smScanFs') return false;
    return true;
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && fs === 'fake') { leaveFs(); return; }
      var k = KEYMAP[e.key];
      if (!k || !keysAllowed(e)) return;
      e.preventDefault();
      if (e.repeat) return;
      heldKeys[k] = true;
      kick();
    });
    document.addEventListener('keyup', function (e) {
      var k = KEYMAP[e.key];
      if (!k) return;
      if (heldKeys[k]) { delete heldKeys[k]; e.preventDefault(); }
    });
    /* A key held across a tab switch would walk forever. */
    window.addEventListener('blur', function () { stopWalk(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopWalk(); });
    /* A press anywhere but the room takes the keys back. Capture phase, so
       it runs before the press does whatever else it does. */
    document.addEventListener('pointerdown', function (e) {
      walkFocus = !!(wrap && e.target && wrap.contains(e.target) &&
                     !(e.target.closest && e.target.closest('input,select,textarea,button:not([data-walk])')));
      if (!walkFocus) stopWalk();
    }, true);
  }

  /* ------------------------------------------------------- the hand-off
     A BOUNDED TWEEN, NOT A LOOP. The module's rule is that a still camera
     schedules no frames; this is the one thing that asks for frames on its
     own, and it stops asking the moment it lands. Nothing else here starts
     an animation, and this one has a fixed end.

     It exists so the two views visibly share a subject: coming INTO the
     room you arrive looking straight at the rack the plan was showing and
     ease back to see the whole place; going OUT you turn to face that rack
     first, so the elevation does not appear out of a view pointing at the
     opposite wall. */
  var tw = null;

  function stopTween() {
    if (tw && tw.raf) cancelAnimationFrame(tw.raf);
    tw = null;
  }

  /* Where the camera stands to look square at one rack, from inside. */
  function faceOf(secId) {
    var rec = null;
    Object.keys(bays).some(function (id) {
      if (bays[id].rack === secId) { rec = bays[id]; return true; }
      return false;
    });
    if (!rec) return null;
    /* A rack's meshes are rotated by its wall; the camera wants to stand
       off its FRONT, which is +Z in the rack's own space. */
    return {
      az: rec.theta,
      pol: 1.16,
      dist: Math.max(3.2, homeDist * 0.42),
      tx: rec.x, ty: rec.y, tz: rec.z
    };
  }

  function tween(to, ms, done) {
    stopTween();
    if (!built || !cam) { if (done) done(); return; }
    if (mode === 'walk') setMode('orbit');
    if (typeof Motion !== 'undefined' && Motion.reduced && Motion.reduced()) {
      apply(to); if (done) done(); return;
    }
    var from = { az: az, pol: pol, dist: dist, tx: target.x, ty: target.y, tz: target.z };
    /* Shortest way round: without this, turning from -170° to +170° goes
       the long way and the room spins through three walls to move two. */
    var dAz = to.az - from.az;
    while (dAz > Math.PI) dAz -= Math.PI * 2;
    while (dAz < -Math.PI) dAz += Math.PI * 2;

    var t0 = now();
    tw = { raf: 0 };
    var step = function () {
      var k = Math.min(1, (now() - t0) / ms);
      /* the app's own --e-out curve, near enough: fast away, soft arrival */
      var e = 1 - Math.pow(1 - k, 3);
      apply({
        az: from.az + dAz * e,
        pol: from.pol + (to.pol - from.pol) * e,
        dist: from.dist + (to.dist - from.dist) * e,
        tx: from.tx + (to.tx - from.tx) * e,
        ty: from.ty + (to.ty - from.ty) * e,
        tz: from.tz + (to.tz - from.tz) * e
      });
      if (k < 1) { tw.raf = requestAnimationFrame(step); return; }
      tw = null;
      if (done) done();
    };
    tw.raf = requestAnimationFrame(step);
  }

  function apply(v) {
    az = v.az; pol = v.pol; dist = v.dist;
    target.set(v.tx, v.ty, v.tz);
    updateCam();
  }

  /* Arrive facing the rack, then ease back to the whole room. */
  function intro(secId) {
    if (!built) return;
    if (mode === 'walk') { startWalk(); return; }
    var f = faceOf(secId);
    if (!f) { resetView(); return; }
    apply(f);
    tween({ az: homeAz, pol: homePol, dist: homeDist,
            tx: 0, ty: cur && cur.roomId != null ? 0.9 : 0.7, tz: 0 }, 620);
  }

  /* Turn to face the rack, then hand over to the 2D view. `done` runs even
     when there is nothing to face or the tween is cut short — the caller is
     mid-view-switch and must never be left waiting on a frame. */
  function outro(secId, done) {
    if (!built) { if (done) done(); return; }
    var f = faceOf(secId);
    if (!f || mode === 'walk') { if (done) done(); return; }
    tween(f, 340, done);
  }

  /* -------------------------------------------------------------- pointer */

  function bindPointer() {
    var ptrs = {}, drag = null, pinch = null;

    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    cv.addEventListener('pointerdown', function (e) {
      /* preventDefault so the canvas never steals focus: the caret stays in
         #smScan and the next barcode of the run still lands somewhere. */
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      walkFocus = true;
      var n = Object.keys(ptrs).length;
      if (n === 2) {
        var ks = Object.keys(ptrs), a = ptrs[ks[0]], b = ptrs[ks[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        drag = null;
      } else if (n === 1) {
        /* Tracked positions, not e.movementX: some touch pointers and every
           synthetic event report movement as zero, and a drag that measures
           nothing never passes the six-pixel test. */
        drag = { pan: e.button === 1 || e.button === 2, x: e.clientX, y: e.clientY,
                 lx: e.clientX, ly: e.clientY, moved: 0, rack: null, wall: null, lifting: false };
        /* WHAT IS UNDER THE HAND IS NOTED, NOT ACTED ON. In the editor a
           press on a rack could still turn out to be a click that selects a
           bay, so the drag is not committed until the hand has actually
           moved - the same six pixels the click test already uses. */
        if (edit && !drag.pan && roomBox.inRoom) {
          var bid = castAt(e);
          var brec = bid != null ? bays[bid] : null;
          if (brec && racks[brec.rack]) drag.rack = brec.rack;
          /* Only when the hand is on bare wall — a rack in front of it wins,
             because moving the rack is the commoner job by far. */
          else drag.wall = castWall(e.clientX, e.clientY);
        }
        /* Inside real fullscreen a mouse can be captured, and then the look
           is the mouse itself rather than a drag of it. Asked for on every
           press; refused silently where it is not allowed. */
        if (mode === 'walk' && fs === 'native' && e.pointerType === 'mouse' && !drag.pan) pointerLock(true);
      }
    });

    cv.addEventListener('pointermove', function (e) {
      var p = ptrs[e.pointerId];
      if (p) { p.x = e.clientX; p.y = e.clientY; }

      /* Under pointer lock the pointer does not move; only movementX does. */
      if (locked && mode === 'walk') {
        look(e.movementX || 0, e.movementY || 0);
        return;
      }

      var ks = Object.keys(ptrs);
      if (pinch && ks.length === 2) {
        var a = ptrs[ks[0]], b = ptrs[ks[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (d > 0 && pinch.d > 0) {
          if (mode === 'walk') step(d > pinch.d ? 1 : -1);
          else dolly(pinch.d / d);
        }
        if (mode !== 'walk') panBy(cx - pinch.cx, cy - pinch.cy);
        pinch.d = d; pinch.cx = cx; pinch.cy = cy;
        return;
      }

      if (drag && p) {
        var dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
        drag.lx = e.clientX; drag.ly = e.clientY;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.wall && drag.moved >= 6) {
          if (!drag.lifting) {
            drag.lifting = grabWall(drag.wall);
            if (!drag.lifting) drag.wall = null;
          }
          if (drag.lifting) {
            var winfo = dragWall(e.clientX, e.clientY);
            if (hooks.drag) hooks.drag(winfo, e.clientX, e.clientY);
            return;
          }
        }
        if (drag.rack != null && drag.moved >= 6) {
          if (!drag.lifting) {
            var rk = racks[drag.rack];
            drag.lifting = grab(drag.rack, rk, false);
            if (!drag.lifting) drag.rack = null;
          }
          if (drag.lifting) {
            var info = dragTo(e.clientX, e.clientY);
            if (hooks.drag) hooks.drag(info, e.clientX, e.clientY);
            return;
          }
        }
        if (mode === 'walk') { look(dx, dy); return; }
        if (drag.pan) panBy(dx, dy);
        else {
          stopTween();
          az -= dx * 0.0058;
          pol = Math.max(POL_MIN, Math.min(POL_MAX, pol - dy * 0.0058));
          updateCam();
        }
        return;
      }

      if (!ks.length && !held) hover(castAt(e), e);
    });

    /* Leaving the canvas takes the card with it. */
    cv.addEventListener('pointerleave', function () { hover(null, null); });

    var lift = function (e) {
      var was = drag;
      delete ptrs[e.pointerId];
      if (Object.keys(ptrs).length < 2) pinch = null;
      if (was && !Object.keys(ptrs).length) {
        drag = null;
        if (was.lifting && was.wall) {
          var size = dropWall(e.clientX, e.clientY);
          if (hooks.drag) hooks.drag(null, 0, 0);
          if (size && hooks.room) hooks.room(size.w, size.d, size.shrink);
          return;
        }
        if (was.lifting) {
          var put = drop(e.clientX, e.clientY);
          if (hooks.drag) hooks.drag(null, 0, 0);
          if (put && hooks.move) hooks.move(put.id, put.wall, put.at);
          return;
        }
        if (was.moved < 6 && !was.pan) {
          var id = castAt(e);
          if (id != null && hooks.pick) hooks.pick(id);
        }
      }
    };
    cv.addEventListener('pointerup', lift);
    cv.addEventListener('pointercancel', lift);

    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (mode === 'walk') step(e.deltaY > 0 ? -1 : 1);
      else dolly(e.deltaY > 0 ? 1.1 : 0.9);
    }, { passive: false });
  }

  /* ---- pointer lock: only ever inside real fullscreen ---------------- */
  var locked = false;

  function pointerLock(on) {
    if (!cv) return false;
    try {
      if (on) {
        if (fs !== 'native' || mode !== 'walk') return false;
        var req = cv.requestPointerLock || cv.webkitRequestPointerLock;
        if (!req) return false;
        var p = req.call(cv);
        if (p && p.catch) p.catch(function () {});
        return true;
      }
      var ex = document.exitPointerLock || document.webkitExitPointerLock;
      if (ex && (document.pointerLockElement === cv || document.webkitPointerLockElement === cv)) ex.call(document);
    } catch (e) { return false; }
    return true;
  }

  document.addEventListener('pointerlockchange', function () {
    locked = !!cv && document.pointerLockElement === cv;
  });
  document.addEventListener('webkitpointerlockchange', function () {
    locked = !!cv && document.webkitPointerLockElement === cv;
  });

  /* A TWEEN FIGHTING A HAND ON THE MOUSE is the worst camera bug there is,
     and the hand always wins. Every path that moves the camera by hand
     cancels the arrival first; without this, the 620ms after switching into
     the room silently overwrote a drag, a wheel or a pinch every frame. */
  function dolly(f) {
    stopTween();
    dist = Math.max(distMin, Math.min(distMax, dist * f));
    updateCam();
  }

  function panBy(dx, dy) {
    stopTween();
    var k = dist * 0.0016;
    var rx = Math.cos(az), rz = -Math.sin(az);
    var fx = -Math.sin(az), fz = -Math.cos(az);
    target.x = clamp(target.x - (dx * rx - dy * fx) * k, -panBound, panBound);
    target.z = clamp(target.z - (dx * rz - dy * fz) * k, -panBound, panBound);
    updateCam();
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* IS THERE A RACK IN THE WAY? One box per rack, tested against the straight
     line from the camera to a point. Twelve names against eight boxes is
     ninety-six ray-box tests in a frame, which is nothing — and it is the
     difference between a name that means the bay it sits over and a name from
     the far wall floating across the near rack, and between a click landing
     on the bay you can see and one landing on a bay hidden behind it.

     A rack never occludes its own bay, and a camera standing inside a rack
     is not blocked by it, or every tag in a close-up would vanish. */
  var occRay = null, occHit = null;
  function blocked(pt, ownRack, slack) {
    if (!rackBoxes.length || !cam) return false;
    if (!occRay) { occRay = new THREE.Ray(); occHit = new THREE.Vector3(); }
    occRay.origin.copy(cam.position);
    occRay.direction.copy(pt).sub(cam.position);
    var span = occRay.direction.length();
    if (span < 0.001) return false;
    occRay.direction.multiplyScalar(1 / span);
    for (var i = 0; i < rackBoxes.length; i++) {
      var rb = rackBoxes[i];
      if (rb.id === ownRack || rb.box.containsPoint(cam.position)) continue;
      if (!occRay.intersectBox(rb.box, occHit)) continue;
      if (occHit.distanceTo(cam.position) < span - (slack == null ? 0.15 : slack)) return true;
    }
    return false;
  }

  function castAt(e) {
    if (!built || !hitList.length) return null;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, cam);
    var hits = ray.intersectObjects(hitList, false);
    /* Nearest is not the same as visible: the hit boxes write no depth, so
       the ray goes straight through a rack and used to pick the bay behind
       it. Walk outward to the first one nothing is standing in front of. */
    for (var i = 0; i < hits.length; i++) {
      var id = hits[i].object.userData.id;
      var rec = bays[id];
      if (!blocked(hits[i].point, rec ? rec.rack : null, 0.05)) return id;
    }
    return null;
  }

  function hover(id, e) {
    /* The card follows the pointer even when the bay under it has not
       changed, so it is placed on every move; only the scene work is
       guarded on the id actually changing. */
    if (hooks.peek) hooks.peek(id, e ? e.clientX : 0, e ? e.clientY : 0);
    if (id === hoverId) return;
    hoverId = id;
    var rec = id != null ? bays[id] : null;
    hoverMesh.visible = !!rec && (!cur || cur.sel !== id);
    if (rec) outlineAt(hoverMesh, rec);
    cv.style.cursor = rec ? 'pointer' : (mode === 'walk' ? 'crosshair' : 'grab');
    retag();
    invalidate();
  }

  /* ==================================================================
     MOVING A RACK BY HAND

     The room is a plan you rearrange, not a picture of one. With the layout
     editor open a rack can be picked up and put against a wall, and THE DROP
     IS WHAT SAVES IT. There is no Save button to forget, because a layout
     held in the browser is a layout that dies on a refresh.

     THE GHOST ONLY EVER SHOWS A PLACE THE RACK CAN GO. It snaps to 5 cm,
     stops at the end of a measured wall, and will not overlap a rack
     already standing there — side by side, across a corner, or nose to
     nose: it slides to the nearest free place instead. So the answer
     arrives while the rack is still in the air, rather than as a refusal
     after the fact. The server runs the same arithmetic again and has the
     last word; this is the courtesy, not the boundary.

     Green and red are deliberately not used. On this screen those two
     colours already mean a scan was accepted or refused, and a ghost
     borrowing them would be a second language for the same two words. The
     ghost is white where it can land, hidden where it cannot, and the
     readout beside the hand says which wall, how far along, and what is in
     the way. ================================================================== */

  var edit = false;
  var roomBox = { w: 0, d: 0, h: 0, inRoom: false, measured: false };
  var ghost = null, ghostFloor = null;
  var held = null;
  var floorPlane = null, floorPt = null;

  function setEdit(on) {
    on = !!on;
    if (on === edit) return;
    edit = on;
    if (!on) { cancelDrag(); cancelWall(); }
    if (cv) cv.style.cursor = mode === 'walk' ? 'crosshair' : 'grab';
  }

  /* Where the hand is on the floor of the room, in metres. */
  function floorAt(x, y) {
    if (!built) return null;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (!floorPlane) {
      floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      floorPt = new THREE.Vector3();
    }
    ndc.x = ((x - r.left) / r.width) * 2 - 1;
    ndc.y = -((y - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, cam);
    return ray.ray.intersectPlane(floorPlane, floorPt) ? floorPt : null;
  }

  /* How long a wall is, in metres. Only a measured room can answer; an
     unmeasured wall is as long as it needs to be, which is the same
     admitted gap the schema keeps by letting the measurements be NULL. */
  function wallLen(wall) {
    if (!roomBox.measured) return Infinity;
    return (wall === 'n' || wall === 's') ? roomBox.w : roomBox.d;
  }

  function snap(v) { return Math.round(v / SNAP) * SNAP; }
  /* A neighbour's edge snapped to the nearest 5 cm can land INSIDE the
     neighbour — 4.56 rounds to 4.55 — so an edge to sit after is rounded
     up and an edge to sit before is rounded down. The 1e-9 keeps 4.60 from
     becoming 4.65 through floating point. */
  function snapUp(v) { return Math.ceil(v / SNAP - 1e-9) * SNAP; }
  function snapDown(v) { return Math.floor(v / SNAP + 1e-9) * SNAP; }

  /* THE INVERSE OF placeOnWall. A point on the floor becomes the wall it is
     nearest and how far along that wall it sits in metres, counted from the
     left as you stand inside facing it, snapped to 5 cm and kept inside the
     wall. This table and that one have to stay in step, which is why they
     are written next to each other. */
  function wallAt(p, width) {
    var w = roomBox.w, d = roomBox.d;
    var cand = [
      { wall: 'n', gap: p.z + d / 2, along: p.x + w / 2 },
      { wall: 's', gap: d / 2 - p.z, along: w / 2 - p.x },
      { wall: 'e', gap: w / 2 - p.x, along: p.z + d / 2 },
      { wall: 'w', gap: p.x + w / 2, along: d / 2 - p.z }
    ];
    var best = cand[0], i;
    for (i = 1; i < cand.length; i++) if (cand[i].gap < best.gap) best = cand[i];
    var at = snap(best.along - width / 2);
    var len = wallLen(best.wall);
    if (len !== Infinity) at = Math.min(at, snapDown(len - width));
    return { wall: best.wall, at: Math.max(0, at), gap: best.gap };
  }

  /* Every other rack standing on a wall of this room, as the drag sees it. */
  function placed(exceptId) {
    var out = [];
    if (!cur) return out;
    for (var i = 0; i < cur.racks.length; i++) {
      var o = cur.racks[i];
      if (o.id === exceptId || !o.wall || !o.bays.length) continue;
      var dm = dims(o);
      out.push({ id: o.id, key: o.key, wall: o.wall, at: o.at || 0, cols: o.cols,
                 width: o.cols * dm.bay, depth: dm.depth });
    }
    return out;
  }

  /* The same overlap arithmetic server/lib/shelves.js runs (checkFit),
     against the live model, so the answer needs no round trip. A measured
     room tests floor rectangles, which is what catches a corner; an
     unmeasured one can only test the racks on the same wall. */
  function blockerOn(wall, at, width, depth, exceptId) {
    var others = placed(exceptId);
    if (roomBox.measured) {
      var mine = footprint(wall, at, width, depth, roomBox.w, roomBox.d);
      for (var i = 0; i < others.length; i++) {
        var o = others[i];
        if (overlaps(mine, footprint(o.wall, o.at, o.width, o.depth, roomBox.w, roomBox.d))) return o;
      }
      return null;
    }
    for (var j = 0; j < others.length; j++) {
      var q = others[j];
      if (q.wall !== wall) continue;
      if (at < q.at + q.width - 0.001 && q.at < at + width - 0.001) return q;
    }
    return null;
  }

  /* Nearest free place to where the hand is, so a rack dragged into a taken
     run slides into the gap beside it instead of stopping dead against it.
     The candidates are the edges of everything already there — each
     neighbour's far end, each neighbour's near end less this width, and for
     a rack round the corner the line its depth draws on this wall — and the
     nearest legal one wins. No search, no step cap. */
  function freeSlot(wall, at, width, depth, exceptId) {
    var len = wallLen(wall);
    var top = len === Infinity ? Infinity : snapDown(len - width);
    if (top < 0) return null;
    var cands = [at], others = placed(exceptId), i;
    if (top !== Infinity) cands.push(0, top);
    for (i = 0; i < others.length; i++) {
      var o = others[i];
      if (o.wall === wall) cands.push(snapUp(o.at + o.width), snapDown(o.at - width));
      else if (roomBox.measured) cands.push(snapUp(o.depth), snapDown(len - o.depth - width));
    }
    cands = cands.filter(function (c) { return c >= 0 && c <= top; })
                 .sort(function (a, b) { return Math.abs(a - at) - Math.abs(b - at); });
    for (i = 0; i < cands.length; i++) {
      if (!blockerOn(wall, cands[i], width, depth, exceptId)) return cands[i];
    }
    return null;
  }

  /* rackId may name a rack that is NOT in the scene: the unplaced list beside
     the room drags into it, and those racks have no group to pick up. `shape`
     carries what the ghost needs — cols, rows and the rack's own size. */
  function grab(rackId, shape, external) {
    if (!built || !roomBox.inRoom) return false;
    stopTween();
    var dm = dims(shape || {});
    /* "External" means not in the scene. The designer's list has a row for
       every rack in the room too, and one of those dragged in from its row
       is still the rack standing on the wall — it must not block itself. */
    held = {
      id: rackId, cols: Math.max(1, (shape && shape.cols) || 1), rows: Math.max(1, (shape && shape.rows) || 1),
      bay: dm.bay, level: dm.level, depth: dm.depth,
      ext: !!external && !racks[rackId], wall: null, at: null, ok: false
    };
    held.width = held.cols * held.bay;
    held.height = heightOf(held.rows, held.level);
    if (ghost) {
      ghost.scale.set(held.width, held.height, held.depth);
      ghost.visible = false;
    }
    if (ghostFloor) {
      ghostFloor.scale.set(held.width, held.depth, 1);
      ghostFloor.visible = false;
    }
    if (cv) cv.style.cursor = 'grabbing';
    if (racks[rackId] && racks[rackId].g) racks[rackId].g.visible = false;
    invalidate();
    return true;
  }

  function dragTo(x, y) {
    if (!held) return null;
    var p = floorAt(x, y);
    if (!p) return null;
    var margin = 1.2;
    var inside = Math.abs(p.x) <= roomBox.w / 2 + margin && Math.abs(p.z) <= roomBox.d / 2 + margin;
    var res;
    if (!inside) {
      res = { wall: null, at: null, ok: false, why: 'out' };
    } else {
      var hit = wallAt(p, held.width);
      if (hit.gap > 2.4) {
        /* well clear of every wall: in the room, on no wall. That is a real
           state, not a failure. A rack waiting to be placed stands about. */
        res = { wall: null, at: null, ok: true, why: 'floor' };
      } else if (wallLen(hit.wall) < held.width - 0.001) {
        res = { wall: hit.wall, at: null, ok: false, why: 'short', have: wallLen(hit.wall) };
      } else {
        var except = held.ext ? -1 : held.id;
        var slot = freeSlot(hit.wall, hit.at, held.width, held.depth, except);
        var b = blockerOn(hit.wall, hit.at, held.width, held.depth, except);
        if (slot == null) res = { wall: hit.wall, at: null, ok: false, why: 'full', by: b ? b.key : '' };
        else res = { wall: hit.wall, at: slot, ok: true, why: b ? 'slid' : '', by: b ? b.key : '',
                     corner: !!(b && b.wall !== hit.wall) };
      }
    }
    held.wall = res.wall; held.at = res.at; held.ok = res.ok;
    res.width = held.width;
    res.cols = held.cols;

    if (ghost && ghostFloor) {
      if (res.ok && res.wall) {
        var at = placeOnWall(res.wall, res.at, held.width, held.depth, roomBox.w, roomBox.d);
        ghost.position.set(at.x, held.height / 2, at.z);
        ghost.rotation.y = at.theta;
        ghostFloor.position.set(at.x, 0.012, at.z);
        ghostFloor.rotation.z = -at.theta;
        ghost.visible = ghostFloor.visible = true;
      } else if (res.ok) {
        ghost.position.set(p.x, held.height / 2, p.z);
        ghost.rotation.y = 0;
        ghostFloor.position.set(p.x, 0.012, p.z);
        ghostFloor.rotation.z = 0;
        ghost.visible = ghostFloor.visible = true;
      } else {
        ghost.visible = ghostFloor.visible = false;
      }
    }
    invalidate();
    return res;
  }

  function drop(x, y) {
    if (!held) return null;
    if (x != null) dragTo(x, y);
    var out = held.ok ? { id: held.id, wall: held.wall, at: held.at } : null;
    cancelDrag();
    return out;
  }

  function cancelDrag() {
    if (held && racks[held.id] && racks[held.id].g) racks[held.id].g.visible = true;
    held = null;
    if (ghost) ghost.visible = false;
    if (ghostFloor) ghostFloor.visible = false;
    if (cv) cv.style.cursor = mode === 'walk' ? 'crosshair' : 'grab';
    invalidate();
  }

  function dragging() { return !!held || !!wallHeld; }

  /* ==================================================================
     PULLING A WALL

     How big is this room? Until somebody says, the walls stand where the
     racks need them and the screen admits as much. Pulling one is how the
     answer gets in — and because width and depth are stored as a PAIR, a
     pull commits both, so both are on the readout the whole time it is
     moving. Nothing is measured behind anyone's back.

     The walls do NOT move while the hand moves. A room is rebuilt from
     scratch when its size changes — every rack re-placed, every bay
     re-boxed — and doing that per mouse-move is the one thing this module
     exists to avoid. So the pull draws a white outline of the room it would
     become, exactly as the rack drag draws the bay it would land on, and the
     real walls move once, on release, from the server's answer.

     WHAT THE PULL WOULD DO TO THE RACKS IS ON THE READOUT TOO. The server
     narrows the bays of any rack that no longer fits (fitRoom in
     server/lib/shelves.js), floored at its minimum, and refuses below that;
     the same sums run here against the room in the outline, so "M → 92 cm
     bays" is on the hand before it lets go, and a pull that would be refused
     says so instead of finding out from a toast.

     Height is not pulled. It has no floor to be measured against on screen
     and no handle that is not a hairline, so it stays a number typed into
     Room settings, next to the other two. ================================ */

  var wallHeld = null;
  var roomGhost = null;
  var BAY_MIN = 0.60;         /* BAY_MIN on the server, in metres */

  function castWall(x, y) {
    if (!built || !wallList.length) return null;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.x = ((x - r.left) / r.width) * 2 - 1;
    ndc.y = -((y - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, cam);
    var hits = ray.intersectObjects(wallList, false);
    return hits.length ? hits[0].object.userData.wall : null;
  }

  function grabWall(which) {
    if (!built || !roomBox.inRoom || !which) return false;
    stopTween();
    wallHeld = { wall: which, w: roomBox.w, d: roomBox.d, shrink: null };
    if (cv) cv.style.cursor = 'grabbing';
    return true;
  }

  /* What the server's fitRoom would do to the racks in a room this size:
     which would be narrowed and to what, and which could not fit at all. */
  function shrinkPreview(w, d) {
    var out = { shrunk: [], stuck: [] };
    placed(-1).forEach(function (o) {
      var len = (o.wall === 'n' || o.wall === 's') ? w : d;
      if (o.at + o.width <= len + 0.001) return;
      /* whole centimetres, the way the server floors it */
      var fit = Math.floor(((len - o.at) / o.cols) * 100 + 0.0001) / 100;
      if (fit >= BAY_MIN - 0.001) out.shrunk.push({ key: o.key, from: o.width / o.cols, to: fit });
      else out.stuck.push({ key: o.key, need: o.at + o.cols * BAY_MIN });
    });
    return out;
  }

  function dragWall(x, y) {
    if (!wallHeld) return null;
    var p = floorAt(x, y);
    if (!p) return null;
    var w = wallHeld.w, d = wallHeld.d;
    /* A wall is at +-half the dimension, so the dimension is twice the
       distance from the middle of the room to where the hand is. */
    if (wallHeld.wall === 'e' || wallHeld.wall === 'w') w = Math.abs(p.x) * 2;
    else d = Math.abs(p.z) * 2;
    w = clamp(snap(w), ROOM_MIN, ROOM_MAX);
    d = clamp(snap(d), ROOM_MIN, ROOM_MAX);
    wallHeld.w = w; wallHeld.d = d;
    var pv = shrinkPreview(w, d);
    wallHeld.shrink = pv;

    if (roomGhost) {
      var h = Math.max(0.4, roomBox.h || 2.6);
      roomGhost.scale.set(w, h, d);
      roomGhost.position.set(0, h / 2, 0);
      roomGhost.visible = true;
    }
    invalidate();
    return { kind: 'room', w: w, d: d, ok: !pv.stuck.length, shrunk: pv.shrunk, stuck: pv.stuck };
  }

  function dropWall(x, y) {
    if (!wallHeld) return null;
    if (x != null) dragWall(x, y);
    var out = { w: wallHeld.w, d: wallHeld.d, shrink: wallHeld.shrink };
    cancelWall();
    return out;
  }

  function cancelWall() {
    wallHeld = null;
    if (roomGhost) roomGhost.visible = false;
    if (cv) cv.style.cursor = mode === 'walk' ? 'crosshair' : 'grab';
    invalidate();
  }

  /* ==================================================================
     FULLSCREEN

     One code path for both kinds. The wrapper goes onto <body> and gets
     .sm-fs — that alone is a full-viewport room, and it is all an iPad or
     the test harness ever gets. Then the real API is asked, and if it says
     yes the same wrapper is what it shows. Leaving undoes it in the same
     order, and the map is told either way so it can put the stage back.

     The nodes the map keeps on <body> — the toasts, the modal root, the drag
     readout, the peek card — come INSIDE the wrapper for the duration. The
     fullscreen top layer draws over everything outside the element, so a
     toast left on the body would go on firing into a place nobody could
     see. ================================================================ */

  var fs = null;              /* null | 'fake' | 'native' */
  var fsMoved = [];           /* the body nodes brought inside, to put back */

  function moveNodes(inward) {
    if (inward) {
      fsMoved = [];
      var list = hooks.fsNodes ? (hooks.fsNodes() || []) : [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (!n || !n.parentNode || n === wrap || wrap.contains(n)) continue;
        fsMoved.push({ node: n, parent: n.parentNode, next: n.nextSibling });
        wrap.appendChild(n);
      }
      return;
    }
    for (var j = fsMoved.length - 1; j >= 0; j--) {
      var m = fsMoved[j];
      if (!m.node.parentNode || m.node.parentNode !== wrap) continue;
      if (m.parent && m.parent.isConnected) m.parent.insertBefore(m.node, m.next && m.next.parentNode === m.parent ? m.next : null);
      else document.body.appendChild(m.node);
    }
    fsMoved = [];
  }

  function fullscreen(on, opts) {
    if (!built || dead) return false;
    on = on !== false;
    if (!on) { leaveFs(); return false; }
    if (fs) return true;

    stopTween();
    document.body.appendChild(wrap);
    wrap.classList.add('sm-fs');
    document.body.classList.add('sm-fs-on');
    moveNodes(true);
    fs = 'fake';
    W = H = 0; measure();
    if (hooks.fs) hooks.fs(true, fs);

    var wantNative = !(opts && opts.native === false);
    var req = wantNative && (wrap.requestFullscreen || wrap.webkitRequestFullscreen);
    if (req) {
      try {
        var p = req.call(wrap);
        /* A promise that rejects, or no promise at all and no
           fullscreenchange: either way we are already fullscreen the
           other way and nothing has to happen. */
        if (p && p.then) p.then(null, function () {});
      } catch (e) { /* stay fake */ }
    }
    return true;
  }

  function leaveFs() {
    if (!fs) return;
    var wasNative = fs === 'native';
    fs = null;
    pointerLock(false);
    wrap.classList.remove('sm-fs');
    document.body.classList.remove('sm-fs-on');
    moveNodes(false);
    if (wasNative) {
      try {
        var el = document.fullscreenElement || document.webkitFullscreenElement;
        if (el === wrap) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } catch (e) {}
    }
    /* Out of the body and back into whatever mount the map paints next;
       the fs hook's repaint calls attach() with it. */
    if (wrap.parentNode === document.body) document.body.removeChild(wrap);
    W = H = 0;
    if (hooks.fs) hooks.fs(false, null);
  }

  function onFsChange() {
    var el = document.fullscreenElement || document.webkitFullscreenElement;
    if (el === wrap) {
      if (fs === 'fake') { fs = 'native'; W = H = 0; measure(); if (hooks.fs) hooks.fs(true, fs); }
      return;
    }
    /* Esc, or the browser's own control: the API side ended without us. */
    if (fs === 'native') leaveFs();
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  function isFullscreen() { return !!fs; }
  function fsKind() { return fs; }
  function overlayHost() { return overlay; }

  /* ------------------------------------------------------------ the tags */

  function tag(i) {
    while (tags.length <= i) {
      var el = document.createElement('div');
      el.className = 'sm-tag';
      var b = document.createElement('b');
      b.dir = 'ltr';
      var s = document.createElement('small');
      el.appendChild(b); el.appendChild(s);
      tagHost.appendChild(el);
      tags.push({ el: el, b: b, s: s, x: 0, y: 0, z: 0, on: false, pri: 0, w: 0, h: 0, rack: null });
    }
    return tags[i];
  }

  var want = [];
  var tagCamX = 0, tagCamY = 0, tagCamZ = 0, tagOver = false;

  /* ONE TAG PER RUN, NEVER ONE PER SHELF. Consecutive bays along a LEVEL of
     one rack that hold the same product are one thing to a person standing
     in front of them — "the Sambas are along there" — and get one name over
     the middle of the run. A run the selected or hovered bay sits in yields
     to that bay's own tag, which carries the code as well. */
  function runs() {
    var byLine = {}, out = [], skip = {};
    if (cur && cur.sel != null) skip[cur.sel] = 1;
    if (hoverId != null) skip[hoverId] = 1;
    Object.keys(bays).forEach(function (id) {
      var r = bays[id];
      if (r.pid == null || !r.name) return;
      var k = r.rack + ':' + r.row;
      (byLine[k] = byLine[k] || []).push({ id: +id, r: r });
    });
    Object.keys(byLine).forEach(function (k) {
      var list = byLine[k].sort(function (a, b) { return a.r.col - b.r.col; });
      var run = null;
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (run && it.r.pid === run.pid && it.r.col === run.lastCol + 1) {
          run.lastCol = it.r.col; run.b1 = it.r; run.ids.push(it.id);
        } else {
          if (run) out.push(run);
          run = { pid: it.r.pid, name: it.r.name, b0: it.r, b1: it.r, lastCol: it.r.col, ids: [it.id] };
        }
      }
      if (run) out.push(run);
    });
    return out.filter(function (run) {
      for (var i = 0; i < run.ids.length; i++) if (skip[run.ids[i]]) return false;
      return true;
    });
  }

  function retag(inFrame) {
    want = [];
    var selId = cur ? cur.sel : null;
    if (selId != null && bays[selId]) want.push({ id: selId, primary: true });
    if (hoverId != null && hoverId !== selId && bays[hoverId]) want.push({ id: hoverId });
    /* NEAREST FIRST. More runs than the cap means some go unnamed, and the
       ones to drop are the ones across the room, not the ones the camera is
       standing in front of. Re-sorted when the camera has moved far enough
       for that to change — see place(). */
    var rr = runs();
    if (cam && rr.length > TAG_CAP) {
      rr.forEach(function (run) {
        var mx = (run.b0.x + run.b1.x) / 2, mz = (run.b0.z + run.b1.z) / 2;
        run.dist = Math.hypot(mx - cam.position.x, mz - cam.position.z);
      });
      rr.sort(function (a, b) { return a.dist - b.dist; });
    }
    tagOver = rr.length + want.length > TAG_CAP;
    if (cam) { tagCamX = cam.position.x; tagCamY = cam.position.y; tagCamZ = cam.position.z; }
    rr.forEach(function (run) { want.push({ run: run }); });

    var i, tgt, w;
    for (i = 0; i < want.length && i < TAG_CAP; i++) {
      tgt = tag(i); w = want[i];
      if (w.run) {
        tgt.b.textContent = w.run.name;
        tgt.s.textContent = '';
        tgt.s.style.display = 'none';
        tgt.el.className = 'sm-tag run';
        tgt.b.dir = 'auto';
        tgt.x = (w.run.b0.x + w.run.b1.x) / 2;
        tgt.y = w.run.b0.y + w.run.b0.level / 2 - 0.06;
        tgt.z = (w.run.b0.z + w.run.b1.z) / 2;
        tgt.rack = w.run.b0.rack;
        tgt.pri = 0;
      } else {
        var rec = bays[w.id];
        tgt.b.textContent = rec.full;
        tgt.s.textContent = rec.name || '';
        tgt.s.style.display = rec.name ? '' : 'none';
        tgt.el.className = 'sm-tag' + (w.primary ? ' on' : '');
        tgt.b.dir = 'ltr';
        tgt.x = rec.x; tgt.y = rec.y + rec.level / 2; tgt.z = rec.z;
        tgt.rack = rec.rack;
        tgt.pri = w.primary ? 2 : 1;
      }
      tgt.w = tgt.el.offsetWidth || 120;
      tgt.h = tgt.el.offsetHeight || 24;
      tgt.on = true;
    }
    for (; i < tags.length; i++) { tags[i].on = false; tags[i].el.className = 'sm-tag'; }
    /* From inside a frame the picture is already being drawn; asking for
       another would be one wasted callback per metre walked. */
    if (!inFrame) invalidate();
  }

  /* SIGNAGE, NOT SUBTITLES. Levels stack and rows converge, so names would
     land on top of one another: the selected bay's tag first, then the
     hovered one, then everything else nearest-first — and a name that would
     sit on one already placed hides. Nothing is nudged sideways. */
  function place() {
    /* Over the cap and the camera has walked somewhere else: the nearest
       twelve are different ones now. Lazily, and never more than once per
       metre, so a still camera costs nothing. */
    if (tagOver && cam &&
        Math.hypot(cam.position.x - tagCamX, cam.position.y - tagCamY, cam.position.z - tagCamZ) > 1.0) {
      retag(true);
    }
    var live = [], i, j, tg;
    for (i = 0; i < tags.length; i++) {
      tg = tags[i];
      if (!tg.on) { tg.el.style.visibility = 'hidden'; continue; }
      OCCP.set(tg.x, tg.y, tg.z);
      if (blocked(OCCP, tg.rack, 0.25)) { tg.el.style.visibility = 'hidden'; continue; }
      V.set(tg.x, tg.y, tg.z).project(cam);
      if (V.z > 1) { tg.el.style.visibility = 'hidden'; continue; }
      tg.sx = (V.x * 0.5 + 0.5) * W;
      tg.sy = (-V.y * 0.5 + 0.5) * H;
      tg.d = V.z;
      live.push(tg);
    }
    live.sort(function (a, b) { return (b.pri - a.pri) || (a.d - b.d); });

    var placed = [];
    for (i = 0; i < live.length; i++) {
      tg = live[i];
      var x0 = tg.sx - tg.w / 2, x1 = tg.sx + tg.w / 2, y0 = tg.sy - tg.h, y1 = tg.sy;
      var covered = false;
      for (j = 0; j < placed.length; j++) {
        var p = placed[j];
        if (x0 < p[2] && x1 > p[0] && y0 < p[3] && y1 > p[1]) { covered = true; break; }
      }
      if (covered) { tg.el.style.visibility = 'hidden'; continue; }
      placed.push([x0, y0, x1, y1]);
      tg.el.style.visibility = 'visible';
      tg.el.style.zIndex = String(200 - i);
      tg.el.style.transform =
        'translate3d(' + tg.sx.toFixed(1) + 'px,' + tg.sy.toFixed(1) + 'px,0) translate(-50%,-100%)';
    }
  }

  /* ---------------------------------------------------------- scan flash */

  var flashPool = [];

  function flash(id, kind) {
    if (!ready() || !bays[id]) return;
    var rec = bays[id];
    var m = null;
    for (var i = 0; i < flashPool.length; i++) {
      if (!flashPool[i].busy) { m = flashPool[i]; break; }
    }
    if (!m) {
      if (flashPool.length >= 6) return;
      m = { seg: new THREE.LineSegments(
              new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
              new THREE.LineBasicMaterial({ color: C.ok })),
            busy: false };
      m.seg.visible = false;
      flashPool.push(m);
    }
    if (m.seg.parent !== root) root.add(m.seg);
    m.busy = true;
    m.seg.material.color.setHex(kind === 'warn' ? C.warn : kind === 'bad' ? C.bad : C.ok);
    outlineAt(m.seg, rec);
    m.seg.scale.set(rec.bay - G.upright + 0.14, rec.level - G.board + 0.1, rec.depth * 1.02);
    m.seg.visible = true;
    invalidate();
    setTimeout(function () { m.seg.visible = false; m.busy = false; invalidate(); }, 1400);
  }

  /* ------------------------------------------------------------ figures */

  /* Where a point of the room is on the page right now, in client pixels —
     so a test can press on the back wall rather than on a guess. null when
     it is behind the camera. */
  function project(x, y, z) {
    if (!built || !cv) return null;
    V.set(x, y, z).project(cam);
    if (V.z > 1) return null;
    var r = cv.getBoundingClientRect();
    return { x: r.left + (V.x * 0.5 + 0.5) * r.width, y: r.top + (-V.y * 0.5 + 0.5) * r.height };
  }

  function stats() {
    var inf = renderer ? renderer.info.render : { calls: 0, triangles: 0 };
    return { calls: inf.calls, triangles: inf.triangles, quality: quality, mode: mode,
             fs: fs, racks: rackBoxes.length, bays: hitList.length,
             eye: { x: wk.x, z: wk.z }, room: { w: roomBox.w, d: roomBox.d } };
  }

  /* ---------------------------------------------------------------- wire */

  function hook(h) {
    if (!h) return;
    ['fit', 'drag', 'move', 'room', 'pick', 'lost', 'peek', 'fs', 'fsNodes', 'keys', 'mode', 'quality', 'qualityAuto']
      .forEach(function (k) { if (h[k]) hooks[k] = h[k]; });
  }

  return {
    supported: supported,
    ready: ready,
    ensure: ensure,
    detach: detach,
    attach: attach,
    sync: sync,
    setGeometry: setGeometry,
    flash: flash,
    resetView: resetView,
    view: view,
    intro: intro,
    outro: outro,
    hook: hook,
    setEdit: setEdit,
    grab: grab,
    dragTo: dragTo,
    drop: drop,
    cancelDrag: cancelDrag,
    dragging: dragging,
    grabWall: grabWall,
    dragWall: dragWall,
    dropWall: dropWall,
    cancelWall: cancelWall,
    setMode: setMode,
    mode: function () { return mode; },
    walkKey: walkKey,
    look: look,
    step: step,
    fullscreen: fullscreen,
    isFullscreen: isFullscreen,
    fsKind: fsKind,
    overlayHost: overlayHost,
    pointerLock: pointerLock,
    setQuality: setQuality,
    quality: function () { return quality; },
    project: project,
    stats: stats
  };
})();
