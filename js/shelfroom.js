/* ==========================================================================
   OG SYSTEM — the warehouse room, in three dimensions          [shelfroom.js]
   --------------------------------------------------------------------------
   The WebGL half of the shelf map. js/shelfmap.js decides WHAT is on screen
   and stays the only file that talks to DB, t() and the server; this module
   is handed a plain model — a room, the racks on its walls, their levels and
   bays, one selected id — and draws it. It knows nothing about products
   beyond the strings it is given, so it can never disagree with the flat
   panel about what exists.

   A RACK IS A UNIT OF SHELVING, hung on a wall or — since 051 — standing
   free on the floor, turned a quarter at a time. Its row letters are LEVELS,
   A at the top, and its columns are BAYS left to right as you stand facing
   it. A free rack is single depth like any other: one bay, one location. A room is the thing with four walls that several racks hang
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
   exist here only as a ring around a bay. A product type is a sticker on
   the end of each box and a tint on the board under it, never a line. The
   one other colour is the brand lime on the floor, as worn aisle paint —
   which is where real warehouses put it, and where it can never be mistaken
   for a scan. Everything else is the back room itself: warm near-black
   plaster and steel, cold concrete, kraft boxes, and one warm light, which
   is the only bright thing in it. Selection is that light's white, never a
   scan colour.

   ONE BOX PER PAIR, ONE InstancedMesh FOR THE ROOM. A full bay looks full
   from the doorway and an empty one looks empty, which is what makes the
   room readable before anybody points at anything. A bay draws at most what
   physically fits on it (slotsFor) and the peek says the true number: the
   drawing is a picture, the card is the truth.

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
    bg:     0x0b0a08,
    floor:  0x6a6a69,   /* polished concrete, neutral — the room's warmth is the light's, not the floor's */
    wall:   0x16130f,   /* warm near-black, plaster over block */
    wallOut:0x1c1a17,   /* the block face outside */
    cap:    0x3a3631,   /* the top of the walls: what draws the room's outline from above */
    ceiling:0x0e0c0a,   /* darker than the walls so the strips read */
    skirt:  0x0f0d0a,
    grid:   0x55514c,   /* the metre grid on the floor, barely there */
    frame:  0x1c1a17,   /* rack steel: matte, a hair warmer than the wall */
    back:   0x14120f,
    edge:   0x3b362f,   /* a bay outline has to read against the frame, or an
                           empty bay is invisible and the room looks half built */
    box:    0xc08a4e,   /* kraft */
    band:   0x7a4e26,   /* the darker stripe across the lid */
    light:  0xffd9a0,   /* ~3000 K — the one bright thing in the room */
    key:    0xfff0dc,   /* the light as it lands: the strips' warmth, less of it, so the concrete stays grey */
    sel:    0xfff2dc,   /* the light's own white: selection and hover. Never green, never red */
    lime:   0xc6ff00,   /* --brand: floor paint only */
    ok:     0x4ade80,   /* --success   — rings only, never fills */
    warn:   0xfbbf24,   /* --warning */
    bad:    0xf87171    /* --destructive */
  };

  /* A PAIR'S BOX, not the rack's geometry: what a shoe box measures, end on
     to the aisle. The rack's numbers still all come from the server; these
     only decide how many boxes a bay of that size can physically hold. */
  var BOX = { w: 0.22, h: 0.125, d: 0.34, gapX: 0.02, gapZ: 0.03, gapY: 0.004 };

  var FLY_MS = 500;
  var WALL_T = 0.2;     /* how thick the walls are drawn, outward of the measured room */     /* pressing a bay: long enough to keep your bearings, short enough not to wait */

  /* The tier budget. A light the scene holds but does not draw is not a
     light the GPU pays for, so these count VISIBLE lights. */
  var LIGHTS_HIGH = 6, LIGHTS_LOW = 2;

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

  var bays = {};            /* shelf id → { x,y,z (world), theta, board, qty, slots, … } */
  var hitList = [];
  var rackBoxes = [];       /* one world-space box per rack: occlusion and collision */
  var racks = {};           /* rack id -> { g, cols, rows, key, wall, at, bay, level, depth } */
  var wallList = [];        /* the four wall planes, each tagged with its letter */
  var overflow = [];        /* racks drawn running past their wall, for the foot */
  var disposables = [];
  var sig = '';
  var cur = null;
  var pending = null;

  var selMesh = null, selRim = null, hoverMesh = null;
  var hoverId = null;
  var matFrame = null, matBoard = null;
  /* The steel and the boards of every rack: two InstancedMeshes for the room,
     so a room twice the size is not twice the draw calls. rackPieces holds each
     rack's instances and their matrices, so a rack in the hand can be hidden. */
  var frameMesh = null, boardMesh = null, rackPieces = {};
  var ZERO_M = null, BOARD_C = null, MARK_C = null;
  var mats = {};            /* one material per colour, shared by every bay of that type */

  /* The boxes: one InstancedMesh for every pair in the room, one more for
     the type stickers on their ends. Allocated per rebuild at the most the
     room's bays could ever hold, drawn at .count. */
  var boxMesh = null, stickerMesh = null;
  var bayOrder = [];        /* bay ids in a fixed order, so a repaint never reshuffles a shelf */
  var boxTexHi = null, boxTexLo = null, boxTexMarked = false;
  var envTex = null;        /* what the polished floor reflects: the strips, at infinity */

  /* THE PRODUCT ON THE BOX (Stage C) — one atlas per build, one slot per
     product with a picture, sampled by the same instanced mesh. See
     startPictures(). */
  var pic = null;           /* this build's atlas; null with no picture in the room, or on the low tier */
  var picGen = 0;           /* bumped per build: an image landing for a room that is gone is dropped */
  var picMax = 2048;        /* the largest the atlas is drawn; the harness lowers it to fill one */
  var picImgs = {};         /* url -> { img, ok, waiters }, for the tab's life: a second open fetches nothing */
  var picUniforms = null;   /* the box material's, shared with its shader */
  var picBlank = null;      /* what the shader samples while there is no atlas */
  var boxPid = null;        /* per box instance: whose box it is, -1 for none */
  var rebuilds = 0;         /* structural rebuilds this page has done — the harness counts them */
  var handles = null;       /* the two grips on the rack in focus, while the layout editor is open */
  var grow = null;          /* a rack being made longer or taller by hand */
  var pointersDown = 0;     /* a hand on the canvas right now */

  /* The light. Built once in boot, placed per room in rebuild. */
  var hemi = null, pointLights = [];
  var ceilingGrp = null;    /* ceiling, strips and their halos: hidden above wall height */
  var floorMat = null;
  var signs = {};           /* rack id -> the plaque's canvas and how it was drawn, for the harness */
  var editOnly = [];        /* drawn only while the layout is being edited: the metre grid, bay outlines */
  var billboards = [];      /* the plate on a free-standing rack, which turns to the eye */
  var BBP = null;
  var shellWalls = [];      /* each wall's outside face, and which way it looks — see shellByCamera */
  var doorBox = null;       /* the door's opening along x, for the floor paint and the harness */
  var paintInfo = null;     /* what the floor paint drew, for the harness */
  var markTex = null, markCan = null;   /* the mark as white ink, for the wall and the door */

  /* Pressing a bay flies to it; where the camera was before the FIRST press
     is kept so Escape can go back there, not to a default. */
  var flyHome = null;
  var modeInternal = false;

  var hooks = { pick: null, lost: null, peek: null, fit: null, drag: null, move: null, room: null,
                fs: null, fsNodes: null, keys: null, mode: null, quality: null, qualityAuto: null,
                unfocus: null, grow: null };

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

      /* THE LIGHT IS COUNTED. A warm sky/ground pair so nothing is ever pure
         black; one warm key from overhead — the ceiling strips taken as a
         whole — which is the only thing that casts a shadow; and on the high
         tier four warm points hung under the strips so the aisles are lit
         and the rack faces are not in shadow. Six on high, two on low. The
         strips themselves are emissive geometry, which is free: one real
         light per strip would halve the frame rate. The key's shadow
         frustum is fitted to the room in rebuild(), because a frustum wide
         enough for a hangar is a blur on a cupboard. */
      hemi = new THREE.HemisphereLight(0x5c5752, 0x0c0a08, 0.55);
      scene.add(hemi);
      sun = new THREE.DirectionalLight(C.key, 0.8);
      sun.position.set(-2, 11, 4);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0008;
      sun.shadow.normalBias = 0.02;
      scene.add(sun);
      scene.add(sun.target);
      pointLights = [];
      for (var pl = 0; pl < LIGHTS_HIGH - 2; pl++) {
        var p = new THREE.PointLight(C.light, 0.5, 9, 1.4);
        p.castShadow = false;
        scene.add(p);
        pointLights.push(p);
      }
      applyTier();

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
      if (boxTexHi) { boxTexHi.dispose(); boxTexHi = null; }
      if (boxTexLo) { boxTexLo.dispose(); boxTexLo = null; }
      if (envTex) { envTex.dispose(); envTex = null; }
      if (markTex) { markTex.dispose(); markTex = null; }
      if (pic && pic.tex) { pic.tex.dispose(); pic = null; }
      if (picBlank) { picBlank.dispose(); picBlank = null; }
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
    applyTier();
    /* Materials compile their shadow code in; a tier change needs them
       compiled again or the old shader keeps sampling a map that is gone.
       The light count is compiled in too, and it just changed. */
    if (root) root.traverse(function (o) {
      if (!o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.needsUpdate = true; });
    });
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
    W = H = 0; measure();
    invalidate();
  }

  /* What a tier is, in one place: the lights it draws, whether the floor
     reflects, whether a box end carries the mark, and how many boxes a bay
     may draw. The renderer-level half (shadows, pixel ratio) is setQuality's. */
  function applyTier() {
    var hi = quality === 'high';
    for (var i = 0; i < pointLights.length; i++) pointLights[i].visible = hi;
    if (floorMat) {
      floorMat.envMap = hi ? envTex : null;
      floorMat.roughness = hi ? 0.38 : 0.92;
      floorMat.needsUpdate = true;
    }
    if (boxMesh) {
      boxMesh.material.map = hi ? boxTexHi : boxTexLo;
      boxMesh.material.needsUpdate = true;
      /* the pictures are the high tier's: off and unfetched on low, made on
         the way back up */
      if (!hi && picUniforms) picUniforms.picOn.value = 0;
      if (hi) { if (!pic) startPictures(); else if (picUniforms) picUniforms.picOn.value = 1; }
      layoutBoxes();
    }
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
    var img = g.getImageData(0, 0, 256, 256), px = img.data;
    var seed = 7;
    /* Near-white noise: the material's colour is the concrete, this only
       mottles it. Cold on purpose — the room's warmth is the light's. */
    for (var i = 0; i < px.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      var n = ((seed >>> 16) & 0xff) / 255;             /* 0..1 */
      var v = 222 + n * 33;
      /* a touch blue, against a light that is a touch orange */
      px[i] = v - 8; px[i + 1] = v - 2; px[i + 2] = Math.min(255, v + 6); px[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    /* a few faint scuffs, so it is a floor and not static — faint, or a
       tiled floor turns into a pattern of dots */
    g.fillStyle = 'rgba(0,0,0,0.016)';
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

  /* The mark as INK: white, its coverage taken from the artwork's own
     brightness. assets/logo.svg is a white mark on a black square, and drawn
     as it is the square comes with it — a black patch on the wall and on the
     door. A canvas the browser will not let us read (tainted) gives no mark
     at all, never the square. */
  function markCanvas() {
    if (markCan) return markCan;
    if (!logoTex || !logoTex.image) return null;
    try {
      var c = document.createElement('canvas');
      c.width = c.height = 512;
      var g = c.getContext('2d');
      g.drawImage(logoTex.image, 0, 0, 512, 512);
      var img = g.getImageData(0, 0, 512, 512), px = img.data;
      for (var i = 0; i < px.length; i += 4) {
        var lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
        px[i] = px[i + 1] = px[i + 2] = 255;
        px[i + 3] = lum;
      }
      g.putImageData(img, 0, 0);
      markCan = c;
    } catch (e) { return null; }
    return markCan;
  }

  /* ------------------------------------------------------------ the boxes
     A BOX IS ONE MATERIAL AND ONE TEXTURE, and this is the only place
     either is made. The texture is an atlas of three faces — a side with
     the lid's edge along its top, the lid with its darker band across it,
     and the end that faces the aisle — mapped onto a unit cube by boxGeometry.
     A photograph of a real OG box, if one ever arrives, replaces what
     boxAtlas() draws and nothing else. Two versions are kept: with the mark
     on the end (high tier) and without (low). The kraft colour itself is
     in the texture; the per-box variation is the instance colour on top. */

  var ATLAS = 512;
  /* face regions in atlas pixels: [x0, y0, x1, y1] */
  var R_SIDE = [0, 0, 256, 256], R_LID = [256, 0, 512, 256], R_END = [0, 256, 256, 512];
  /* the end face, as fractions of its height from the top */
  var END_BAND = 0.22, END_TAG0 = 0.78, END_TAG1 = 0.95;

  function hex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }

  function kraft(g, r, seed) {
    var w = r[2] - r[0], h = r[3] - r[1];
    g.fillStyle = hex(C.box);
    g.fillRect(r[0], r[1], w, h);
    /* card fibre: short, faint, mostly along one direction */
    for (var i = 0; i < 260; i++) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      var x = r[0] + (seed >>> 8) % w;
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      var y = r[1] + (seed >>> 8) % h;
      g.fillStyle = (seed & 1) ? 'rgba(255,236,200,0.07)' : 'rgba(60,34,12,0.08)';
      g.fillRect(x, y, 6 + (seed % 14), 1);
    }
    return seed;
  }

  function boxAtlas(withMark) {
    var c = document.createElement('canvas');
    c.width = c.height = ATLAS;
    var g = c.getContext('2d');
    var s = kraft(g, R_SIDE, 11);
    s = kraft(g, R_LID, s);
    kraft(g, R_END, s);
    var band = hex(C.band);
    /* the side: the lid's overhang along the top */
    g.fillStyle = band;
    g.fillRect(R_SIDE[0], R_SIDE[1], 256, Math.round(256 * END_BAND));
    /* the lid: a band across the middle, along the box's short side */
    g.fillRect(R_LID[0], R_LID[1] + 256 * 0.40, 256, 256 * 0.20);
    /* the end: the lid's edge, and a soft shadow line under it */
    g.fillRect(R_END[0], R_END[1], 256, Math.round(256 * END_BAND));
    g.fillStyle = 'rgba(40,22,8,0.25)';
    g.fillRect(R_END[0], R_END[1] + Math.round(256 * END_BAND), 256, 3);
    if (withMark) {
      /* Reading the mark's pixels is refused on a tainted canvas; a box
         without its mark is still a box, and a thrown rebuild is no room. */
      if (!logoTex || !logoTex.image) return null;
      try { stampMark(g, logoTex.image); } catch (e) { return null; }
    }
    return c;
  }

  /* The mark on the end of the box, printed in dark ink. assets/logo.svg is
     a white mark on a black square, so its brightness becomes the ink's
     coverage: stamped straight on, the black square would be a black patch
     on every box. The end face is 0.22 wide by 0.125 tall and the region is
     square, so the mark is drawn squashed here in order to land square. */
  function stampMark(g, src) {
    var side = 0.072;                                     /* metres, on the box */
    var pw = Math.round(side / BOX.w * 256), ph = Math.round(side / BOX.h * 256);
    var t = document.createElement('canvas');
    t.width = pw; t.height = ph;
    var tg = t.getContext('2d');
    tg.drawImage(src, 0, 0, pw, ph);
    var img = tg.getImageData(0, 0, pw, ph), px = img.data;
    for (var i = 0; i < px.length; i += 4) {
      var lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
      px[i] = 52; px[i + 1] = 30; px[i + 2] = 14;
      px[i + 3] = Math.round(lum * 0.82);
    }
    tg.putImageData(img, 0, 0);
    var mid = (END_BAND + END_TAG0) / 2;
    g.drawImage(t, R_END[0] + (256 - pw) / 2, R_END[1] + 256 * mid - ph / 2);
  }

  function boxTextures() {
    if (boxTexHi) return;
    boxTexLo = new THREE.CanvasTexture(boxAtlas(false));
    boxTexHi = new THREE.CanvasTexture(boxAtlas(false));
    [boxTexLo, boxTexHi].forEach(function (t) { t.anisotropy = 4; });
    /* The mark arrives when the artwork does. Until then — or for ever, if
       it never loads — the high-tier box is simply a plain box. */
    logo(function () {
      if (!boxTexHi || boxTexMarked) return;
      var marked = boxAtlas(true);
      if (!marked) return;
      boxTexHi.image = marked;
      boxTexHi.needsUpdate = true;
      boxTexMarked = true;
      invalidate();
    });
  }

  /* A unit cube whose six faces sample the atlas regions. BoxGeometry lays
     its faces out +x, -x, +y, -y, +z, -z, four vertices each; +z is the end
     that faces the aisle once the box is placed. */
  function boxGeometry() {
    var geo = new THREE.BoxGeometry(1, 1, 1);
    var uv = geo.attributes.uv;
    /* Both ends, each as its own face-local 0..1, taken BEFORE the atlas
       remap below: the shader places the product's picture on them. +z is
       the end facing the aisle; on a free-standing rack -z faces the other
       aisle, and BoxGeometry lays both out unmirrored as seen from outside. */
    var endMask = new Float32Array(24), endUv = new Float32Array(48);
    for (var e = 0; e < 24; e++) {
      var face = Math.floor(e / 4);
      endMask[e] = face === 4 || face === 5 ? 1 : 0;
      endUv[e * 2] = uv.getX(e);
      endUv[e * 2 + 1] = uv.getY(e);
    }
    geo.setAttribute('aEnd', new THREE.BufferAttribute(endMask, 1));
    geo.setAttribute('aEndUv', new THREE.BufferAttribute(endUv, 2));
    var faces = [R_SIDE, R_SIDE, R_LID, R_SIDE, R_END, R_SIDE];
    for (var f = 0; f < 6; f++) {
      var r = faces[f];
      var u0 = r[0] / ATLAS, u1 = r[2] / ATLAS, v0 = 1 - r[3] / ATLAS, v1 = 1 - r[1] / ATLAS;
      for (var k = 0; k < 4; k++) {
        var i = f * 4 + k;
        uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      }
    }
    uv.needsUpdate = true;
    return geo;
  }

  /* ======================================================================
     THE PRODUCT ON THE BOX (Stage C)

     Every box in the room is ONE InstancedMesh, and one mesh has one
     material and one texture — so a texture per product would be a mesh per
     product, and the instancing and the frame rate would go with it.
     Instead: ONE ATLAS, a grid of slots, one slot per product with a
     picture. Each box carries its slot as a per-instance attribute (aSlot),
     and the box material's shader — onBeforeCompile on the standard
     material, the lighting untouched — samples that patch on BOTH end faces
     and leaves the other four kraft. On a wall rack one end faces the aisle;
     on the middle rack each end faces one. One mesh, one texture, one call.

     A SLOT HAS THE PICTURE'S SHAPE, NOT A SQUARE. The picture sits on the
     end face below the lid's edge and above the sticker (which shrinks to
     make room): a letterbox of about 2.5 : 1. A photo of another shape is
     fitted inside it on kraft, centred, never stretched. The slot size comes
     from how many products the room holds — twelve get twelve large ones.

     THE EMPTY ROOM IS THE NORMAL ROOM. The shop has no product photographs
     yet. With none: no atlas, nothing fetched, nothing logged, and the boxes
     are exactly the kraft boxes they were. The pictures come by themselves on
     the day the photos do.

     NOTHING WAITS ON THE NETWORK. The room draws kraft and a box takes its
     picture when the picture is in hand. No URL, a dead one, a timeout, an
     image that would taint the canvas: that box is kraft, and only that box.
     More products than slots: the most held get them and the rest stay kraft
     — never another product's picture. The low tier draws none and fetches
     none. ================================================================ */
  var PIC_SLOT_MAX = 420;   /* never wider than the photo the product screen stores (≤ 420 px) */
  var PIC_SLOT_MIN = 96;    /* narrower than this a picture is a smudge — the rest stay kraft */
  var PIC_GUT = 3;          /* kraft round every slot, so filtering bleeds kraft into kraft */
  var PIC_LOADS = 4;        /* images fetched at once, on a connection in Aleppo */
  var PIC_TIMEOUT = 20000;
  /* where the picture sits on an end face, face-local and bottom-up — under
     the lid's edge (END_BAND) — and the sticker under a picture, thinner */
  var PIC_U0 = 0.05, PIC_U1 = 0.95, PIC_V0 = 0.12, PIC_V1 = 0.75;
  var PIC_TAG0 = 0.90, PIC_TAG1 = 0.97;

  function picAspect() { return ((PIC_U1 - PIC_U0) * BOX.w) / ((PIC_V1 - PIC_V0) * BOX.h); }
  function pow2(v) { var p = 1; while (p < v) p *= 2; return p; }

  /* The slots for n products in an atlas at most `limit` pixels a side: as
     large as they can be, never wider than a stored photo, with a quarter
     again of headroom so a product put away later takes its picture without
     a rebuild. When that many will not fit at a readable size, the grid is
     the readable one and `cap` is how many get a slot. */
  function atlasGrid(n, limit) {
    var A = picAspect(), want = n + Math.ceil(n / 4), best = null;
    for (var c = 1; c <= want; c++) {
      var r = Math.ceil(want / c);
      var sw = Math.min(PIC_SLOT_MAX, Math.floor(limit / c), Math.floor(limit * A / r));
      if (!best || sw > best.sw) best = { cols: c, rows: r, sw: sw };
    }
    if (best.sw < PIC_SLOT_MIN) {
      best = { cols: Math.max(1, Math.floor(limit / PIC_SLOT_MIN)), sw: PIC_SLOT_MIN,
               rows: Math.max(1, Math.floor(limit / Math.ceil(PIC_SLOT_MIN / A))) };
    }
    best.sh = Math.max(8, Math.floor(best.sw / A));
    best.cap = best.cols * best.rows;
    best.cw = pow2(best.cols * best.sw);
    best.ch = pow2(best.rows * best.sh);
    return best;
  }

  /* The products this room shows a picture for, most held first — the order
     slots are handed out in when there are not enough to go round. */
  function picturesWanted() {
    var held = {}, url = {};
    for (var i = 0; i < bayOrder.length; i++) {
      var rec = bays[bayOrder[i]];
      if (!rec || !rec.items) continue;
      for (var j = 0; j < rec.items.length; j++) {
        var it = rec.items[j];
        if (it.pid == null || !it.img) continue;
        held[it.pid] = (held[it.pid] || 0) + (it.qty || 0);
        url[it.pid] = it.img;
      }
    }
    return Object.keys(held).map(Number)
      .sort(function (a, b) { return held[b] - held[a] || a - b; })
      .map(function (p) { return { pid: p, url: url[p] }; });
  }

  /* The box material: the kraft atlas as before, plus the picture on the
     ends. The uniforms are shared with the compiled shader, so turning the
     pictures on or pointing at a new atlas is a value, not a recompile. */
  function boxMaterial() {
    var m = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: quality === 'high' ? boxTexHi : boxTexLo, roughness: 0.9, metalness: 0.0
    });
    if (!picBlank) {
      picBlank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      picBlank.needsUpdate = true;
    }
    var U = picUniforms = {
      picMap: { value: picBlank },
      picOn: { value: 0 },
      picSlot: { value: new THREE.Vector4(1, 1, 0, 0) },     /* a slot's size, and its kraft margin, in uv */
      picGrid: { value: new THREE.Vector2(1, 1) },
      picRegion: { value: new THREE.Vector4(PIC_U0, PIC_V0, PIC_U1, PIC_V1) }
    };
    m.onBeforeCompile = function (sh) {
      for (var k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = 'attribute float aEnd;\nattribute vec2 aEndUv;\nattribute float aSlot;\n' +
        'varying vec2 vEndUv;\nvarying float vPicSlot;\n' +
        sh.vertexShader.replace('#include <uv_vertex>',
          '#include <uv_vertex>\n\tvEndUv = aEndUv;\n\tvPicSlot = aEnd > 0.5 ? aSlot : -1.0;');
      sh.fragmentShader = 'uniform sampler2D picMap;\nuniform float picOn;\nuniform vec4 picSlot;\n' +
        'uniform vec2 picGrid;\nuniform vec4 picRegion;\nvarying vec2 vEndUv;\nvarying float vPicSlot;\n' +
        sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + [
          '\tif (picOn > 0.5 && vPicSlot > -0.5) {',
          '\t\tvec2 pf = (vEndUv - picRegion.xy) / (picRegion.zw - picRegion.xy);',
          '\t\tif (pf.x >= 0.0 && pf.x <= 1.0 && pf.y >= 0.0 && pf.y <= 1.0) {',
          '\t\t\tfloat ps = floor(vPicSlot + 0.5);',
          '\t\t\tfloat pc = mod(ps, picGrid.x);',
          '\t\t\tfloat pr = floor(ps / picGrid.x);',
          '\t\t\tvec2 puv = vec2(pc * picSlot.x + picSlot.z + pf.x * (picSlot.x - 2.0 * picSlot.z),',
          '\t\t\t\t1.0 - (pr * picSlot.y + picSlot.w + (1.0 - pf.y) * (picSlot.y - 2.0 * picSlot.w)));',
          '\t\t\tvec4 pt = texture2D(picMap, puv);',
          '\t\t\tdiffuseColor.rgb = mix(diffuseColor.rgb, pt.rgb, pt.a);',
          '\t\t}',
          '\t}'
        ].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'og-box-picture'; };
    return m;
  }

  /* A new atlas for a new build. What the last one knew is dropped: its
     slots belonged to a room that is gone, and an image still on its way for
     it is ignored when it lands. */
  function startPictures() {
    picGen++;
    if (pic && pic.tex) pic.tex.dispose();
    pic = null;
    if (!picUniforms) return;
    picUniforms.picOn.value = 0;
    picUniforms.picMap.value = picBlank;
    if (quality !== 'high' || !boxMesh || !renderer) return;
    var want = picturesWanted();
    if (!want.length) return;
    var limit = Math.min(picMax, (renderer.capabilities && renderer.capabilities.maxTextureSize) || 2048);
    var gr = atlasGrid(want.length, limit);
    var c = document.createElement('canvas');
    c.width = gr.cw; c.height = gr.ch;
    var g = c.getContext('2d');
    g.fillStyle = hex(C.box);
    g.fillRect(0, 0, gr.cw, gr.ch);
    var tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    pic = { gen: picGen, canvas: c, g: g, tex: tex, grid: gr, slotOf: {}, pidOf: [], state: {},
            url: {}, queue: [], active: 0, fit: {}, nospace: 0, sync: true };
    picUniforms.picMap.value = tex;
    picUniforms.picGrid.value.set(gr.cols, gr.rows);
    picUniforms.picSlot.value.set(gr.sw / gr.cw, gr.sh / gr.ch, PIC_GUT / gr.cw, PIC_GUT / gr.ch);
    picUniforms.picOn.value = 1;
    for (var i = 0; i < want.length; i++) addPicture(want[i].pid, want[i].url);
    if (pic) pic.sync = false;
  }

  /* One product into the atlas: a slot while there is one, or kraft until
     the next build — never a slot that was somebody else's. */
  function addPicture(pid, url) {
    if (!pic || pic.state[pid]) return;
    if (pic.pidOf.length >= pic.grid.cap) { pic.state[pid] = 'nospace'; pic.nospace++; return; }
    pic.slotOf[pid] = pic.pidOf.length;
    pic.pidOf.push(pid);
    pic.url[pid] = url;
    pic.state[pid] = 'wait';
    pic.queue.push(pid);
    pumpPictures();
  }

  function pumpPictures() {
    while (pic && pic.active < PIC_LOADS && pic.queue.length) {
      var pid = pic.queue.shift();
      pic.active++;
      loadImage(pic.url[pid], arrived(pic.gen, pid));
    }
  }

  function arrived(gen, pid) {
    return function (img) {
      if (!pic || pic.gen !== gen) return;
      pic.active--;
      pic.state[pid] = img && drawSlot(pid, img) ? 'ready' : 'failed';
      /* The boxes that show it are all that changes: no rebuild, no shadow
         bake, one frame. Inside a build the caller lays the boxes out once. */
      if (pic.state[pid] === 'ready' && !pic.sync) layoutBoxes(true);
      pumpPictures();
    };
  }

  /* Fetched once per page, however many rooms and rebuilds ask; the
     browser's own cache (the bucket sends a year's max-age) makes the next
     visit free too. A failure is remembered, so a dead link is not asked for
     again on every rebuild. */
  function loadImage(url, done) {
    var c = picImgs[url];
    if (c) {
      if (c.ok === null) c.waiters.push(done);
      else done(c.ok ? c.img : null);
      return;
    }
    c = picImgs[url] = { img: new Image(), ok: null, waiters: [done] };
    var timer = setTimeout(function () { settle(false); }, PIC_TIMEOUT);
    function settle(ok) {
      if (c.ok !== null) return;
      c.ok = ok;
      clearTimeout(timer);
      var w = c.waiters;
      c.waiters = [];
      for (var i = 0; i < w.length; i++) w[i](ok ? c.img : null);
    }
    c.img.crossOrigin = 'anonymous';
    c.img.decoding = 'async';
    c.img.onload = function () { settle(c.img.naturalWidth > 0 && c.img.naturalHeight > 0); };
    c.img.onerror = function () { settle(false); };
    try { c.img.src = url; } catch (e) { settle(false); }
  }

  /* Fitted inside its slot on kraft, centred, at its own proportions. Drawn
     through a scratch canvas that is read back FIRST: an image that would
     taint a canvas is refused there, because a tainted atlas stops the
     texture uploading for every box in the room. */
  function drawSlot(pid, img) {
    var gr = pic.grid, slot = pic.slotOf[pid];
    var x = (slot % gr.cols) * gr.sw, y = Math.floor(slot / gr.cols) * gr.sh;
    var iw = gr.sw - 2 * PIC_GUT, ih = gr.sh - 2 * PIC_GUT;
    var k = Math.min(iw / img.naturalWidth, ih / img.naturalHeight);
    var w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    try {
      var t = document.createElement('canvas');
      t.width = w; t.height = h;
      var tg = t.getContext('2d');
      tg.drawImage(img, 0, 0, w, h);
      tg.getImageData(0, 0, 1, 1);
      pic.g.fillStyle = hex(C.box);
      pic.g.fillRect(x, y, gr.sw, gr.sh);
      pic.g.drawImage(t, x + PIC_GUT + Math.floor((iw - w) / 2), y + PIC_GUT + Math.floor((ih - h) / 2));
    } catch (e) { return false; }
    pic.fit[pid] = { w: w, h: h, imgW: img.naturalWidth, imgH: img.naturalHeight, slotW: iw, slotH: ih };
    pic.tex.needsUpdate = true;
    return true;
  }

  function picStats() {
    var out = { on: !!(pic && picUniforms && picUniforms.picOn.value > 0), atlas: null, slots: 0, cap: 0,
                ready: 0, failed: 0, waiting: 0, nospace: 0, slotW: 0, slotH: 0, fit: {} };
    if (!pic) return out;
    out.atlas = { w: pic.grid.cw, h: pic.grid.ch, cols: pic.grid.cols, rows: pic.grid.rows };
    out.slotW = pic.grid.sw; out.slotH = pic.grid.sh; out.cap = pic.grid.cap;
    out.slots = pic.pidOf.length; out.nospace = pic.nospace; out.fit = pic.fit;
    Object.keys(pic.state).forEach(function (p) {
      var s = pic.state[p];
      if (s === 'ready') out.ready++; else if (s === 'failed') out.failed++; else if (s === 'wait') out.waiting++;
    });
    return out;
  }

  /* How many boxes fit on one bay, and where: across the opening, rows
     deep, layers high. The bay's own size decides — a wide bay holds more —
     so the cap is a fact about the shelf, not a number picked to look full. */
  function slotsFor(rec) {
    var innerW = rec.bay - G.upright - 0.04;
    var innerD = rec.depth * 0.9;
    var clearH = rec.level - G.board - 0.03;
    var across = Math.max(1, Math.floor((innerW + BOX.gapX) / (BOX.w + BOX.gapX)));
    var deep = Math.max(1, Math.floor((innerD + BOX.gapZ) / (BOX.d + BOX.gapZ)));
    var high = Math.max(1, Math.floor((clearH + BOX.gapY) / (BOX.h + BOX.gapY)));
    /* a bay narrower or shallower than one box still shows one, squeezed */
    var bw = Math.min(BOX.w, innerW), bd = Math.min(BOX.d, innerD), bh = Math.min(BOX.h, clearH);
    return { across: across, deep: deep, high: high, cap: across * deep * high,
             w: bw, d: bd, h: bh,
             pitchX: innerW / across, pitchZ: Math.min(innerD / deep, bd + BOX.gapZ),
             innerD: innerD };
  }

  function tierCap(sl) { return quality === 'high' ? sl.cap : Math.max(1, Math.floor(sl.cap / 2)); }

  /* Small, repeatable disorder: the same box on the same shelf is always
     turned the same way, so a scan does not reshuffle the room. */
  function jit(a, b) {
    var h = (a * 374761393 + b * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;         /* 0..1 */
  }

  var BM = null, SM = null, BP = null, BQ = null, BS = null, BE = null, BC = null, BO = null;

  /* Every box, placed. Called after a rebuild, after an update that changed
     a quantity or a colour, and on a tier change. A few thousand matrix
     writes — nothing, next to rebuilding a room. */
  function layoutBoxes(noShadow) {
    if (!boxMesh) return;
    if (!BM) {
      BM = new THREE.Matrix4(); SM = new THREE.Matrix4(); BP = new THREE.Vector3();
      BQ = new THREE.Quaternion(); BS = new THREE.Vector3(); BE = new THREE.Euler();
      BC = new THREE.Color(); BO = new THREE.Vector3();
    }
    var n = 0, s = 0, up = new THREE.Vector3(0, 1, 0);
    var max = boxMesh.instanceMatrix.count;
    var slotAttr = boxMesh.geometry.getAttribute('aSlot'), slotArr = slotAttr ? slotAttr.array : null;
    var picsOn = !!(pic && quality === 'high');
    for (var bi = 0; bi < bayOrder.length; bi++) {
      var id = bayOrder[bi], rec = bays[id];
      if (!rec) continue;
      var sl = rec.slots, cap = tierCap(sl);
      var want = Math.max(0, Math.floor(rec.qty || 0));
      var draw = Math.min(want, cap);
      rec.drawn = draw;
      var gm = racks[rec.rack] && racks[rec.rack].g ? racks[rec.rack].g.matrixWorld : null;
      if (!gm) { rec.drawn = 0; continue; }
      var x0 = rec.xl - sl.pitchX * sl.across / 2;
      var zFront = sl.innerD / 2;
      /* whose each box is: the bay's contents in order, a box a pair */
      rec.firstBox = n;
      var items = rec.items, ii = 0, left = items && items.length ? items[0].qty : 0;
      for (var k = 0; k < draw && n < max; k++) {
        var layer = Math.floor(k / (sl.across * sl.deep));
        var inLayer = k % (sl.across * sl.deep);
        var row = Math.floor(inLayer / sl.across);        /* front row first */
        var col = inLayer % sl.across;
        var j1 = jit(id, k * 3 + 1), j2 = jit(id, k * 3 + 2), j3 = jit(id, k * 3 + 3);
        var turn = (j1 - 0.5) * 0.07;                        /* about ±2° */
        var slackX = Math.max(0, (sl.pitchX - sl.w) / 2 - Math.abs(turn) * sl.d * 0.5);
        BP.set(x0 + sl.pitchX * (col + 0.5) + (j2 - 0.5) * slackX,
               rec.yFloor + 0.004 + sl.h / 2 + layer * (sl.h + BOX.gapY),
               zFront - sl.pitchZ * (row + 0.5) + (j3 - 0.5) * 0.01);
        BQ.setFromAxisAngle(up, turn);
        BS.set(sl.w, sl.h, sl.d);
        BM.compose(BP, BQ, BS).premultiply(gm);
        boxMesh.setMatrixAt(n, BM);
        var shade = 0.86 + j2 * 0.16;
        BC.setRGB(shade * (1.0 + (j3 - 0.5) * 0.04), shade, shade * (1.0 - (j3 - 0.5) * 0.06));
        boxMesh.setColorAt(n, BC);
        var pid = -1;
        if (items && items.length) {
          while (ii < items.length - 1 && left <= 0) { ii++; left = items[ii].qty; }
          pid = items[ii].pid == null ? -1 : items[ii].pid;
          left--;
        }
        if (boxPid) boxPid[n] = pid;
        /* only while the photo drawn in its slot is still the product's photo:
           one taken away or replaced is kraft until the next build draws the
           new one — never the old picture on a box */
        var shows = picsOn && pid >= 0 && pic.state[pid] === 'ready' &&
                    !!items[ii].img && items[ii].img === pic.url[pid];
        if (slotArr) slotArr[n] = shows ? pic.slotOf[pid] : -1;
        n++;
        /* the type sticker: a strip along the bottom of the end face — thinner
           under a picture, which it shares the face with. It is the legend's
           key, not the subject. */
        if (rec.fill && stickerMesh) {
          var tg0 = shows ? PIC_TAG0 : END_TAG0, tg1 = shows ? PIC_TAG1 : END_TAG1;
          var mid = (tg0 + tg1) / 2;
          BO.set(0, sl.h * (0.5 - mid), sl.d / 2 + 0.0015).applyQuaternion(BQ);
          BO.add(BP);
          BS.set(sl.w * 0.66, sl.h * (tg1 - tg0), 1);
          SM.compose(BO, BQ, BS).premultiply(gm);
          stickerMesh.setMatrixAt(s, SM);
          stickerMesh.setColorAt(s, BC.set(rec.fill));
          s++;
        }
      }
    }
    boxMesh.count = n;
    boxMesh.instanceMatrix.needsUpdate = true;
    if (boxMesh.instanceColor) boxMesh.instanceColor.needsUpdate = true;
    if (slotAttr) slotAttr.needsUpdate = true;
    if (stickerMesh) {
      stickerMesh.count = s;
      stickerMesh.instanceMatrix.needsUpdate = true;
      if (stickerMesh.instanceColor) stickerMesh.instanceColor.needsUpdate = true;
    }
    /* a picture arriving changes a face, not a shadow: no bake for that */
    if (renderer && !noShadow) renderer.shadowMap.needsUpdate = true;
    invalidate();
  }

  /* ------------------------------------------------ what the floor reflects
     A polished floor sells the room by showing the strips in it. A true
     mirror is a second render of the scene every frame; this is the ceiling
     painted into an environment map once — each strip is a straight line
     overhead, which in an equirectangular map is a curve — and the floor's
     roughness blurs it into the soft streak concrete actually gives. Only
     the high tier samples it. */
  function envStrips(xs, h) {
    if (envTex) { envTex.dispose(); envTex = null; }
    var W2 = 512, H2 = 256;
    var c = document.createElement('canvas');
    c.width = W2; c.height = H2;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, H2);
    grad.addColorStop(0, '#0e0c0a');
    grad.addColorStop(0.45, '#1a1611');
    grad.addColorStop(0.55, '#15120e');
    grad.addColorStop(1, '#0b0a08');
    g.fillStyle = grad;
    g.fillRect(0, 0, W2, H2);
    g.lineCap = 'round';
    var eye = Math.max(1, h - 0.3);
    xs.forEach(function (sx) {
      var k = sx / eye;
      [[9, 'rgba(255,217,160,0.16)'], [4, 'rgba(255,217,160,0.5)'], [2, 'rgba(255,238,210,0.95)']].forEach(function (pass) {
        g.lineWidth = pass[0];
        g.strokeStyle = pass[1];
        g.beginPath();
        var first = true, lastU = null;
        for (var t = -6; t <= 6; t += 0.05) {
          var len = Math.sqrt(k * k + 1 + t * t);
          var u = (Math.atan2(t / len, k / len) / (Math.PI * 2) + 0.5) * W2;
          var v = (1 - (Math.asin(1 / len) / Math.PI + 0.5)) * H2;
          if (!first && Math.abs(u - lastU) > W2 / 2) first = true;   /* wrapped round */
          if (first) g.moveTo(u, v); else g.lineTo(u, v);
          first = false; lastU = u;
        }
        g.stroke();
      });
    });
    envTex = new THREE.CanvasTexture(c);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    return envTex;
  }

  /* ------------------------------------------------ light on the walls
     The wash a slim light bar throws on the plaster round it, painted into
     the wall's emissive map: free per frame, where a real light per bar
     would blow the budget many times over. `at` is metres from the wall's
     left end as you stand inside facing it, which is also the texture's u on
     every wall; `y` is the bar's centre, metres up. */
  function wallWash(len, h, bars) {
    var ppm = Math.min(96, 1536 / Math.max(len, h));
    var cw = Math.max(16, Math.round(len * ppm)), ch = Math.max(16, Math.round(h * ppm));
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, cw, ch);
    var glow = function (x, y, rx, ry, a) {
      g.save();
      g.translate(x, y);
      g.scale(rx, ry);
      var rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      rg.addColorStop(0, 'rgba(255,217,160,' + a + ')');
      rg.addColorStop(0.35, 'rgba(255,217,160,' + (a * 0.38) + ')');
      rg.addColorStop(1, 'rgba(255,217,160,0)');
      g.fillStyle = rg;
      g.fillRect(-1, -1, 2, 2);
      g.restore();
    };
    bars.forEach(function (b) {
      var x = b.at * ppm, y = (h - b.y) * ppm, L = b.len * ppm;
      if (b.vert) {
        glow(x, y, 0.2 * ppm, L * 0.9, 0.85);
        glow(x, y + L * 0.6, 0.45 * ppm, L * 1.2, 0.3);     /* thrown down over the rack */
      } else {
        glow(x, y, L * 0.75, 0.22 * ppm, 0.85);
        glow(x, y + 0.2 * ppm, L * 1.1, 0.55 * ppm, 0.25);
      }
    });
    return new THREE.CanvasTexture(c);
  }

  /* A soft round glow, white on transparent, for anything additive: the
     brighter middle of the floor, the lamp's wash on the wall outside. */
  function glowTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  /* The outside of the walls: block courses, 40 × 20 cm, as mortar lines on
     white — the material's colour is the block. One tile is 1.2 × 0.8 m and
     the outside faces carry their UVs in metres, so it repeats on its own. */
  function blockTexture() {
    var c = document.createElement('canvas');
    c.width = 192; c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 192, 128);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (var row = 0; row < 4; row++) {
      var y = row * 32;
      g.fillRect(0, y, 192, 2);
      for (var x = row % 2 ? 32 : 0; x < 192; x += 64) g.fillRect(x, y, 2, 32);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  /* The ground round the building: the room's black, with light spilling
     out along the foot of the front wall and a pool under the door lamp.
     Unlit — it is a picture of light, not a surface lights fall on. */
  function groundTexture(W, D, T, M, doorX) {
    var ppm = 48, ww = W + 2 * T + 2 * M, dd = D + 2 * T + 2 * M;
    var c = document.createElement('canvas');
    c.width = Math.round(ww * ppm); c.height = Math.round(dd * ppm);
    var g = c.getContext('2d');
    g.fillStyle = hex(C.bg);
    g.fillRect(0, 0, c.width, c.height);
    var X = function (x) { return (x + ww / 2) * ppm; };
    var Z = function (z) { return (z + dd / 2) * ppm; };
    var pool = function (x, z, rx, rz, a) {
      g.save();
      g.translate(X(x), Z(z));
      g.scale(rx * ppm, rz * ppm);
      var rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      rg.addColorStop(0, 'rgba(255,217,160,' + a + ')');
      rg.addColorStop(0.45, 'rgba(255,217,160,' + (a * 0.4) + ')');
      rg.addColorStop(1, 'rgba(255,217,160,0)');
      g.fillStyle = rg;
      g.fillRect(-1, -1, 2, 2);
      g.restore();
    };
    var fz = D / 2 + T, run = W + 2 * T;
    for (var i = -2; i <= 2; i++) pool(i * run / 5, fz + 0.12, run / 4.2, 0.7, 0.22);
    pool(0, -fz - 0.1, run / 1.8, 0.45, 0.06);
    pool(-(W / 2 + T) - 0.1, 0, 0.45, D / 1.8, 0.06);
    pool(W / 2 + T + 0.1, 0, 0.45, D / 1.8, 0.06);
    if (doorX != null) pool(doorX, fz + 0.55, 0.9, 0.9, 0.34);
    return new THREE.CanvasTexture(c);
  }

  /* The door's face: dark steel slats, and — once the artwork is in hand —
     the mark on the outside. Called again with the mark to draw it in. The
     canvas is the leaf's own proportion, so the mark lands square. */
  function doorLeafCanvas(c, mark) {
    if (!c) { c = document.createElement('canvas'); c.width = 256; c.height = 576; }
    var g = c.getContext('2d');
    g.fillStyle = '#1d1a17';
    g.fillRect(0, 0, c.width, c.height);
    for (var x = 10; x < c.width - 8; x += 14) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x, 14, 4, c.height - 28);
      g.fillStyle = 'rgba(255,240,220,0.05)';
      g.fillRect(x + 4, 14, 2, c.height - 28);
    }
    g.strokeStyle = 'rgba(255,240,220,0.08)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, c.width - 6, c.height - 6);
    if (mark) {
      var s = c.width * 0.62;
      g.globalAlpha = 0.92;
      g.drawImage(mark, (c.width - s) / 2, c.height * 0.36 - s / 2, s, s);
      g.globalAlpha = 1;
    }
    return c;
  }

  /* ------------------------------------------------ paint on the floor
     Painted onto one sheet laid over the concrete: thin arrows looping up the
     right aisle from the door, across the back and down the left, and the
     front area inside the door where deliveries land, as a dashed edge.
     DECORATION ONLY in this stage — the arrows carry no route, so nothing
     reads them. THE INK IS THE LIGHT'S WHITE, faint: lime is not used on this
     floor, because on this screen green means a scan was accepted. The
     canvas maps straight onto the floor: x east, y south, so a word reads
     correctly to somebody walking in through the door. */
  function floorPaint(w, d, fa, loop, at, words) {
    var ppm = Math.min(140, 2048 / Math.max(w, d));
    var cw = Math.round(w * ppm), ch = Math.round(d * ppm);
    var c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    var X = function (x) { return (x + w / 2) * ppm; };
    var Z = function (z) { return (z + d / 2) * ppm; };
    var ink = function (a) { return 'rgba(255,242,220,' + a + ')'; };
    var box = null;

    /* the front area: a thin dashed edge, nothing filled in */
    g.save();
    g.lineWidth = 0.02 * ppm;
    g.setLineDash([0.16 * ppm, 0.11 * ppm]);
    g.strokeStyle = ink(0.24);
    g.strokeRect(X(fa.x0), Z(fa.z0), (fa.x1 - fa.x0) * ppm, (fa.z1 - fa.z0) * ppm);
    g.restore();
    if (words && words.front) {
      var px = Math.round(0.2 * ppm);
      g.font = '800 ' + px + 'px Montserrat, "Segoe UI", Tahoma, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.direction = /[؀-ۿ]/.test(words.front) ? 'rtl' : 'ltr';
      g.font = '700 ' + Math.round(0.15 * ppm) + 'px Montserrat, "Segoe UI", Tahoma, system-ui, sans-serif';
      g.fillStyle = ink(0.42);
      var maxW = at.max * ppm;
      var tw = Math.min(maxW, g.measureText(words.front).width);
      g.fillText(words.front, X(at.x), Z(at.z), maxW);
      box = { x0: at.x - tw / ppm / 2, x1: at.x + tw / ppm / 2, z: at.z };
    }

    /* the loop: a line with an open arrowhead at its end, three of them */
    if (loop) {
      g.strokeStyle = ink(0.38);
      g.lineWidth = 0.022 * ppm;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      var run = function (x0, z0, x1, z1) {
        g.beginPath();
        g.moveTo(X(x0), Z(z0));
        g.lineTo(X(x1), Z(z1));
        g.stroke();
        var a = Math.atan2(Z(z1) - Z(z0), X(x1) - X(x0)), hl = 0.15 * ppm, sp = 0.5;
        g.beginPath();
        g.moveTo(X(x1) - hl * Math.cos(a - sp), Z(z1) - hl * Math.sin(a - sp));
        g.lineTo(X(x1), Z(z1));
        g.lineTo(X(x1) - hl * Math.cos(a + sp), Z(z1) - hl * Math.sin(a + sp));
        g.stroke();
      };
      run(loop.xR, loop.zFront, loop.xR, loop.zTurn + 0.16);
      run(loop.xR - 0.16, loop.zTurn, loop.xL + 0.16, loop.zTurn);
      run(loop.xL, loop.zTurn + 0.16, loop.xL, loop.zFront);
    }

    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return { tex: t, canvas: c, words: box };
  }

  /* THE RACK'S PLATE: its letter, and its name beside it, on a quiet plate
     of its own — so it reads against a lit wall and a dark one alike and
     never borrows contrast from whatever is behind it. Text through the 2D
     canvas, which shapes Arabic and runs it right to left like the page
     does. Kept dimmer than the strips: a sign is read, a light is seen. */
  function plaque(key, name) {
    var H2 = 128, pad = 22, keyBox = 84;
    var font = '700 50px Montserrat, "Segoe UI", Tahoma, system-ui, sans-serif';
    var probe = document.createElement('canvas').getContext('2d');
    probe.font = font;
    var nameW = name ? Math.min(760, Math.ceil(probe.measureText(name).width)) : 0;
    var cw = pad + keyBox + (name ? pad + nameW + pad : pad);
    var c = document.createElement('canvas');
    c.width = cw; c.height = H2;
    var g = c.getContext('2d');
    g.fillStyle = '#110f0c';
    g.fillRect(0, 0, cw, H2);
    g.strokeStyle = 'rgba(255,242,220,0.16)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, cw - 3, H2 - 3);
    g.fillStyle = '#e9dfcf';
    g.fillRect(pad, (H2 - keyBox) / 2, keyBox, keyBox);
    g.fillStyle = '#110f0c';
    g.font = '800 64px Montserrat, "Segoe UI", Tahoma, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.direction = 'ltr';
    g.fillText(key, pad + keyBox / 2, H2 / 2 + 3, keyBox - 8);
    var dir = 'ltr';
    if (name) {
      dir = /[֐-ࣿ]/.test(name) ? 'rtl' : 'ltr';
      g.font = font;
      g.fillStyle = '#cfc4b3';
      g.direction = dir;
      g.textAlign = 'center';
      g.fillText(name, pad + keyBox + pad + nameW / 2, H2 / 2 + 2, nameW);
    }
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return { tex: t, canvas: c, aspect: cw / H2, dir: dir, font: font, text: name || '' };
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

  /* Where a free-standing rack stands, as placeOnWall and footprint take it —
     { x, y, rot }, metres from the left and front walls — or null. */
  function freeOf(r) {
    return r && r.placement === 'free' && r.fx != null && r.fy != null
      ? { x: r.fx, y: r.fy, rot: r.rot || 0 } : null;
  }
  function heightOf(rows, level) { return G.base + rows * level + G.top; }

  function sameSig(model) {
    /* model.name is in here because it used to be PAINTED on the back wall,
       and left out, a rename stayed hanging up there until something
       structural forced a rebuild. The wall carries only the mark now; the
       name stays in, harmlessly, for the next thing that draws it.
       `origin` likewise — the
       columns are mirrored into the bay models, so a flipped rack is a
       different set of positions, and without it the flip drew nothing. */
    /* The words painted on the floor likewise: a change of language is a
       different floor, not a different number of boxes. */
    var parts = [model.roomId, model.name, model.w, model.d, model.h,
                 model.words ? model.words.front : ''];
    for (var i = 0; i < model.racks.length; i++) {
      var r = model.racks[i];
      var ids = [];
      for (var j = 0; j < r.bays.length; j++) ids.push(r.bays[j].id);
      /* where it stands on the floor, and which way it turns (051); and the
         name, which is painted on its plate */
      parts.push(r.id + ':' + r.wall + ':' + r.at + ':' + r.cols + ':' + r.rows + ':' + r.key + ':' +
                 r.origin + ':' + r.bay + ':' + r.level + ':' + r.depth + ':' +
                 (r.placement || '') + ':' + r.fx + ':' + r.fy + ':' + r.rot + ':' + r.name + ':' + ids.join(','));
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
     boxes' stickers for what is on the bay, the board under it (tinted toward the
     frame) for what the bay is assigned to. Never a line material. */

  /* Where a rack on a wall sits, and which way it faces. `at` is metres from
     the LEFT end of the wall as you stand inside facing it — so "left" means
     a different world axis on every wall, and this table is the whole of
     that arithmetic in one place. THE CM TWIN IS footprint() IN
     server/lib/shelves.js; change one and you must change the other. */
  function placeOnWall(wall, at, width, depth, w, d) {
    var along = wall === 'free' ? 0 : at + width / 2;
    switch (wall) {
      case 'n': return { x: -w / 2 + along, z: -d / 2 + depth / 2, theta: 0 };
      case 's': return { x:  w / 2 - along, z:  d / 2 - depth / 2, theta: Math.PI };
      case 'e': return { x:  w / 2 - depth / 2, z: -d / 2 + along, theta: -Math.PI / 2 };
      /* On the floor (051): `at` is { x, y, rot } — its centre, metres from
         the left wall and from the FRONT wall — and a quarter turn, clockwise
         seen from above. At 0° its bays face the front wall, like a rack on
         the back wall; at 270° they face the right wall. */
      case 'free': return { x: -w / 2 + at.x, z: d / 2 - at.y, theta: -at.rot * Math.PI / 180 };
      default:  return { x: -w / 2 + depth / 2, z:  d / 2 - along, theta: Math.PI / 2 };
    }
  }

  /* The floor a rack covers, in metres from the room's north-west corner —
     x east, z south — for the overlap test. The same FIVE cases as the
     server's footprint(), in the same order: a free-standing rack at 0° or
     180° lies across the room, at 90° or 270° it runs front to back, and it
     is still one axis-aligned rectangle either way. */
  function footprint(wall, at, width, depth, w, d) {
    switch (wall) {
      case 'n': return { x0: at, x1: at + width, z0: 0, z1: depth };
      case 's': return { x0: w - at - width, x1: w - at, z0: d - depth, z1: d };
      case 'e': return { x0: w - depth, x1: w, z0: at, z1: at + width };
      case 'free': {
        var along = at.rot === 90 || at.rot === 270;
        var hx = (along ? depth : width) / 2, hz = (along ? width : depth) / 2, cz = d - at.y;
        return { x0: at.x - hx, x1: at.x + hx, z0: cz - hz, z1: cz + hz };
      }
      default:  return { x0: 0, x1: depth, z0: d - at - width, z1: d - at };
    }
  }

  function overlaps(a, b) {
    return a.x0 < b.x1 - 0.001 && b.x0 < a.x1 - 0.001 && a.z0 < b.z1 - 0.001 && b.z0 < a.z1 - 0.001;
  }

  /* The clear floor between two footprints, metres — the twin of the
     server's gapBetween: straight across, or corner to corner. */
  function gapBetween(a, b) {
    var dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
    var dz = Math.max(0, b.z0 - a.z1, a.z0 - b.z1);
    return Math.hypot(dx, dz);
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
    matFrame = keep(new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.82, metalness: 0.2 }));
    var matEdge = keep(new THREE.LineBasicMaterial({ color: C.edge }));
    var matHit = keep(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    var matBack = keep(new THREE.MeshStandardMaterial({ color: C.back, roughness: 0.95, metalness: 0.0 }));
    var matAisle = keep(new THREE.MeshBasicMaterial({ color: C.sel, transparent: true, opacity: 0.28, depthWrite: false }));
    signs = {};
    bayOrder = [];
    editOnly = [];
    billboards = [];
    rackPieces = {};
    frameMesh = boardMesh = null;
    var frameParts = [], boardParts = [];
    var PV = new THREE.Vector3(), PQ = new THREE.Quaternion(), PS = new THREE.Vector3();
    shellWalls = [];
    doorBox = null;
    paintInfo = null;
    boxMesh = null; stickerMesh = null; ceilingGrp = null; floorMat = null;

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
    model.racks.forEach(function (r) { if (r.bays.length && (!inRoom || (!r.wall && !freeOf(r)))) looseTotal++; });

    /* A rack with no wall yet stands on the floor so it can still be seen and
       still be placed. Inside a room it has to stay INSIDE it: the old layout
       was one straight row down the middle and it marched out through the end
       wall the moment the row grew longer than the room. Now it wraps. */
    var looseAt = {};
    (function () {
      var list = [];
      model.racks.forEach(function (o) { if (o.bays.length && (!inRoom || (!o.wall && !freeOf(o)))) list.push(o); });
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
      } else if (inRoom && freeOf(r)) {
        at = placeOnWall('free', freeOf(r), width, DEPTH, roomW, roomD);
      } else {
        at = looseAt[r.id] || { x: 0, z: 0, theta: 0 };
        loose++;
      }

      var g = new THREE.Group();
      g.position.set(at.x, 0, at.z);
      g.rotation.y = at.theta;
      root.add(g);
      g.updateMatrixWorld(true);
      /* A post, a rail or a board is an INSTANCE, placed in world space from
         the rack's own frame: one draw call for all the steel in the room and
         one for all the boards, however many racks and bays there are. They
         were a mesh each — 130 of the 176 calls in the shop's room. */
      var piece = function (list, sx, sy, sz, x, y, z) {
        list.push({ rack: r.id, m: new THREE.Matrix4().compose(PV.set(x, y, z), PQ, PS.set(sx, sy, sz)).premultiply(g.matrixWorld) });
        return list.length - 1;
      };

      /* the frame: OPEN STEEL, as the shop's racks are — a slim post front and
         back at every bay boundary, the shelf boards, a top board, and air
         between. The server's upright is how much of the pitch the frame
         takes; the post is drawn slimmer, inside it, so a bay's clear width
         is exactly what it was. */
      var POST = Math.min(G.upright, 0.045);
      for (var i = 0; i <= r.cols; i++) {
        for (var ps = -1; ps <= 1; ps += 2) {
          piece(frameParts, POST, height, POST, (i - r.cols / 2) * BAY, height / 2, ps * (DEPTH / 2 - POST / 2));
        }
      }
      /* A back panel only on a rack placed nowhere yet, standing about in
         the middle of nothing. Against a wall the wall IS its back — and
         since the walls are culled from outside, an open back is what lets
         somebody orbiting behind the front wall see what is on the front
         rack instead of a slab. A free-standing rack is open all round, like
         the island in the reference: you walk round it and see through it. */
      if (!(inRoom && (r.wall || freeOf(r)))) {
        var back = new THREE.Mesh(unitBox, matBack);
        back.scale.set(width, height, 0.03);
        back.position.set(0, height / 2, -DEPTH / 2 + 0.015);
        back.castShadow = true; back.receiveShadow = true;
        g.add(back);
      }
      /* The top is two rails, front and back, not a board: the racks are
         open, and from above the top level's boxes are what a person looks
         down on. The occlusion box still runs to the top of the rails. */
      for (var tr = -1; tr <= 1; tr += 2) {
        piece(frameParts, width + POST, G.top, POST, 0, height - G.top / 2, tr * (DEPTH / 2 - POST / 2));
      }

      /* the letter and the name, on a plate above the rack — or on the
         front of its top board, when the ceiling leaves no room above */
      var pq = plaque(r.key, r.name);
      keep(pq.tex);
      var plW = Math.min(width * 0.96, 0.18 * pq.aspect), plH = plW / pq.aspect;
      var plate = new THREE.Mesh(keep(new THREE.PlaneGeometry(plW, plH)),
                                 keep(new THREE.MeshBasicMaterial({ map: pq.tex, color: 0xf2ece2 })));
      var standsFree = inRoom && !r.wall && !!freeOf(r);
      var plY = height + 0.06 + plH / 2, plZ = standsFree ? 0 : DEPTH / 2 - 0.1;
      if (inRoom && plY > roomH - 0.1 - plH / 2) {
        plY = Math.max(height - plH / 2 - 0.01, roomH - 0.1 - plH / 2);
        if (plY < height + plH / 2 && !standsFree) plZ = DEPTH / 2 + 0.012;
      }
      plate.position.set(0, plY, plZ);
      g.add(plate);
      /* ON THE FLOOR THE PLATE TURNS TO THE EYE. There is no wall behind a
         free-standing rack to say which side is its front, and a plate seen
         edge-on names nothing. It turns about its own upright, set in
         ceilingByCamera with the other camera-driven switches; it is depth
         tested like every mesh, so a rack in front of it hides it, and it
         casts no shadow, so turning it never touches the baked map. */
      if (standsFree) billboards.push({ rack: r.id, mesh: plate, theta: at.theta });
      signs[r.id] = { canvas: pq.canvas, dir: pq.dir, font: pq.font, text: pq.text, key: r.key };

      /* the aisle line, for a rack standing on its own: the light's white,
         faint. Inside a room the floor carries its own arrows instead. */
      if (!(inRoom && (r.wall || freeOf(r)))) {
        var line = new THREE.Mesh(keep(new THREE.PlaneGeometry(width, 0.03)), matAisle);
        line.rotation.x = -Math.PI / 2;
        line.position.set(0, 0.004, DEPTH / 2 + AISLE);
        g.add(line);
      }

      g.updateMatrixWorld(true);

      /* Floor to top board. The group's origin is ON THE FLOOR, so a box
         centred on it ran from -height/2 to +height/2 — half underground —
         and everything above half height went unoccluded: a click passed
         through the upper levels of a near rack to a bay behind it. */
      var bx = new THREE.Box3(new THREE.Vector3(-width / 2, 0, -DEPTH / 2),
                              new THREE.Vector3(width / 2, height, DEPTH / 2));
      bx.applyMatrix4(g.matrixWorld);
      rackBoxes.push({ id: r.id, box: bx });
      racks[r.id] = { g: g, cols: r.cols, rows: r.rows, key: r.key, name: r.name, wall: r.wall, at: r.at || 0,
                      placement: standsFree ? 'free' : 'wall', free: standsFree ? freeOf(r) : null, rot: r.rot || 0,
                      bay: BAY, level: LEVEL, depth: DEPTH, width: width };

      /* the bays, level by level — A at the top */
      r.bays.forEach(function (b) {
        var xl = (b.col - (r.cols + 1) / 2) * BAY;
        var yFloor = G.base + (r.rows - 1 - b.row) * LEVEL;

        var board = piece(boardParts, BAY, G.board, DEPTH, xl, yFloor - G.board / 2, 0);

        /* The bay's outline, only while the layout is being edited: the open
           frame shows where a bay is on its own now, and a wireframe over
           every shelf is what made the room read as a drawing. */
        var edge = new THREE.LineSegments(unitEdges, matEdge);
        edge.scale.set(BAY - G.upright, LEVEL - G.board - 0.04, DEPTH * 0.9);
        edge.position.set(xl, yFloor + (LEVEL - G.board) / 2, 0);
        edge.visible = edit;
        editOnly.push(edge);
        g.add(edge);

        var hit = new THREE.Mesh(unitBox, matHit);
        /* ONLY EVER RAYCAST. r147's raycaster does not ask whether a mesh is
           visible, and a visible mesh that writes neither colour nor depth was
           still a draw call — one per bay, for nothing. */
        hit.visible = false;
        hit.scale.set(BAY, LEVEL, DEPTH);
        hit.position.set(xl, yFloor + LEVEL / 2, 0);
        hit.userData.id = b.id;
        g.add(hit);
        hitList.push(hit);

        var wp = g.localToWorld(new THREE.Vector3(xl, yFloor + LEVEL / 2, 0));
        var rec = bays[b.id] = {
          x: wp.x, y: wp.y, z: wp.z, theta: at.theta, yFloor: yFloor,
          xl: xl, board: board,
          bay: BAY, level: LEVEL, depth: DEPTH,
          full: b.full, name: b.name, pid: b.pid, row: b.row, col: b.col, rack: r.id,
          qty: b.qty || 0, fill: b.fill || null, drawn: 0, slots: null,
          /* what is on it, product by product, with each one's picture if it
             has one; and its column and level as the server numbers them */
          items: b.items || null, ci: b.ci, rl: b.rl, firstBox: -1, mark: b.mark || null
        };
        rec.slots = slotsFor(rec);
        bayOrder.push(b.id);
      });
    });

    /* ---- the steel and the boards: two instanced meshes, all racks ---- */
    var instanced = function (parts, mat, key) {
      if (!parts.length) return null;
      var mesh = keep(new THREE.InstancedMesh(unitBox, mat, parts.length));
      for (var pi = 0; pi < parts.length; pi++) {
        mesh.setMatrixAt(pi, parts[pi].m);
        var rp = rackPieces[parts[pi].rack] || (rackPieces[parts[pi].rack] = { frame: [], board: [] });
        rp[key].push({ i: pi, m: parts[pi].m });
      }
      mesh.castShadow = true; mesh.receiveShadow = true;
      /* the unit cube at the origin is not where the pieces are */
      mesh.frustumCulled = false;
      root.add(mesh);
      return mesh;
    };
    frameMesh = instanced(frameParts, matFrame, 'frame');
    /* white, so each board's instance colour IS its colour: the frame's, or
       tinted toward the type its bay is assigned to */
    matBoard = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.2 }));
    boardMesh = instanced(boardParts, matBoard, 'board');
    bayOrder.forEach(function (id) { setBoard(bays[id], bays[id]); });

    /* ---- the boxes ----------------------------------------------------
       One InstancedMesh for every pair in the room, allocated at the most
       these bays could ever hold so a scan never has to reallocate it. */
    boxTextures();
    var capTotal = 0;
    bayOrder.forEach(function (id) { capTotal += bays[id].slots.cap; });
    if (capTotal > 0) {
      var boxGeo = keep(boxGeometry());
      /* which slot of the product atlas each box shows; -1 is kraft */
      boxGeo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(new Float32Array(capTotal).fill(-1), 1));
      boxMesh = keep(new THREE.InstancedMesh(boxGeo, keep(boxMaterial()), capTotal));
      boxPid = new Int32Array(capTotal).fill(-1);
      boxMesh.userData.boxes = true;
      boxMesh.castShadow = true; boxMesh.receiveShadow = true;
      /* the unit cube at the origin is not where the boxes are */
      boxMesh.frustumCulled = false;
      boxMesh.setColorAt(0, new THREE.Color(1, 1, 1));
      boxMesh.count = 0;
      root.add(boxMesh);
      stickerMesh = keep(new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(1, 1)),
        keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0 })), capTotal));
      stickerMesh.frustumCulled = false;
      stickerMesh.receiveShadow = true;
      stickerMesh.setColorAt(0, new THREE.Color(1, 1, 1));
      stickerMesh.count = 0;
      root.add(stickerMesh);
    }

    /* ---- the room around them --------------------------------------- */
    var floorW = inRoom ? roomW : Math.max(8, roomW + 6);
    var floorD = inRoom ? roomD : Math.max(8, roomD + 6);
    /* The strips run front to back, spread across the width so the aisles
       are lit; the reflection and the hanging lights both follow them. */
    var stripXs = [];
    var nStrips = inRoom ? Math.max(2, Math.round(roomW / 1.6)) : 2;
    for (var si = 0; si < nStrips; si++) {
      stripXs.push(inRoom ? -roomW / 2 + roomW * (si + 0.5) / nStrips : (si ? 1.4 : -1.4));
    }
    envStrips(stripXs, roomH);
    var tex = concrete();
    floorMat = keep(new THREE.MeshStandardMaterial({
      color: C.floor, map: tex, metalness: 0.0, envMapIntensity: 0.7,
      roughness: quality === 'high' ? 0.38 : 0.92, envMap: quality === 'high' ? envTex : null
    }));
    var floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(floorW, floorD)), floorMat);
    tex.repeat.set(floorW / 2.2, floorD / 2.2);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    root.add(floor);

    (function () {
      var cols = stripXs.length >= 2 ? [stripXs[0], stripXs[stripXs.length - 1]] : [0, 0];
      var span = Math.max(2, roomD);
      var ly = inRoom ? roomH - 0.4 : 3.2;
      var spots = [[cols[0], -span / 4], [cols[1], -span / 4], [cols[0], span / 4], [cols[1], span / 4]];
      var reach = Math.max(6, Math.hypot(roomW, roomD, roomH) * 1.15);
      pointLights.forEach(function (p, i) {
        p.position.set(spots[i % 4][0], ly, spots[i % 4][1]);
        p.distance = reach;
      });
    })();

    if (inRoom) {
      /* A metre grid on the floor, faint, WHILE EDITING. It is what makes
         "8 by 3" a size a person can see rather than a caption, and what
         makes a pulled wall read as a distance rather than a slide — and it
         is no part of the room itself, so looking at the room it is gone. */
      (function () {
        var pts = [], x, z;
        for (x = Math.ceil(-roomW / 2); x <= Math.floor(roomW / 2); x++) pts.push(x, 0, -roomD / 2, x, 0, roomD / 2);
        for (z = Math.ceil(-roomD / 2); z <= Math.floor(roomD / 2); z++) pts.push(-roomW / 2, 0, z, roomW / 2, 0, z);
        if (!pts.length) return;
        var gg = keep(new THREE.BufferGeometry());
        gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        var grid = new THREE.LineSegments(gg, keep(new THREE.LineBasicMaterial({ color: C.grid })));
        grid.position.y = 0.002;
        grid.visible = edit;
        editOnly.push(grid);
        root.add(grid);
      })();

      /* ---- the shell ---------------------------------------------------
         Walls with a THICKNESS, the way the room is built: plaster inside,
         block outside, and a lighter cap along the top that draws the room's
         outline from above. NOTHING RUNS ACROSS THE TOP OF THE ROOM — the old
         inside cornice was a dark band over the floor in the overhead view.

         THE INSIDE FACE IS STILL THE HANDLE, and still the only thing a pull
         grabs; it faces inward and is backface-culled from outside as before.
         Each wall knows which one it is, because in the editor a wall is the
         handle you pull to say how big the room really is. The OUTSIDE face
         steps aside for a camera outside that wall and below its top
         (shellByCamera), or orbiting low past the front of the room would
         look at blank block instead of into the room. */
      var T = WALL_T;
      var dw = Math.min(0.95, roomW - 0.6), dh = Math.min(2.1, roomH - 0.35);
      var dx = roomW >= 2.4 ? roomW / 2 - 0.3 - dw / 2 : 0;
      var hasDoor = dw > 0.4 && dh > 1;
      doorBox = hasDoor ? { x0: dx - dw / 2, x1: dx + dw / 2 } : null;

      var topOn = { n: 0, s: 0, e: 0, w: 0 };
      model.racks.forEach(function (r) {
        if (r.bays.length && r.wall) topOn[r.wall] = Math.max(topOn[r.wall], heightOf(r.rows, dims(r).level));
      });
      /* the mark on the back wall: centred over the back rack, as big as the
         gap under the ceiling lets it be */
      var backTop = Math.max(topOn.n, 1.6);
      var markSize = Math.min(0.9, (roomH - backTop - 0.55) * 0.95);
      var markY = backTop + 0.48 + markSize / 2;

      /* The lights on the walls: slim bars of lit geometry, and the wash they
         throw painted onto the plaster — none of them a real light. Upright
         over the racks on the side walls, level either side of the mark on
         the back wall. */
      var barsOn = { n: [], s: [], e: [], w: [] };
      model.racks.forEach(function (r) {
        if (!r.bays.length || !r.wall || r.wall === 'n') return;
        var above = roomH - topOn[r.wall];
        if (above < 0.7) return;
        var wd = widthOf(r), k = Math.max(1, Math.round(wd / 1.25));
        var L = Math.min(0.5, above - 0.45), y = topOn[r.wall] + 0.3 + L / 2;
        for (var i = 0; i < k; i++) barsOn[r.wall].push({ at: (r.at || 0) + wd * (i + 0.5) / k, y: y, len: L, vert: true });
      });
      if (markSize >= 0.35) {
        [-1, 1].forEach(function (s) {
          var along = roomW / 2 + s * (markSize / 2 + 0.85);
          if (along - 0.45 > 0.1 && along + 0.45 < roomW - 0.1) {
            barsOn.n.push({ at: along, y: markY + markSize * 0.12, len: 0.9, vert: false });
          }
        });
      }

      var outerMat = keep(new THREE.MeshStandardMaterial({ color: C.wallOut, map: keep(blockTexture()), roughness: 0.92, metalness: 0.0 }));
      var capMat = keep(new THREE.MeshStandardMaterial({ color: C.cap, roughness: 0.8, metalness: 0.05 }));
      var barMat = keep(new THREE.MeshBasicMaterial({ color: C.light }));

      /* One flat piece of a wall, in its wall's own frame: x along the wall,
         y up, z out of the room. The inside's UVs are fractions of the whole
         wall, so a wall cut round the door still lines up with its wash; the
         outside's are metres, so the block courses run on across the cut. */
      var piece = function (grp, len, x0, x1, y0, y1, z, outward, mat) {
        var geo = keep(new THREE.PlaneGeometry(x1 - x0, y1 - y0));
        var uv = geo.attributes.uv, pos = geo.attributes.position;
        var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        for (var i = 0; i < uv.count; i++) {
          var gx = outward ? cx - pos.getX(i) : cx + pos.getX(i), gy = cy + pos.getY(i);
          if (outward) uv.setXY(i, -gx / 1.2, gy / 0.8);
          else uv.setXY(i, (gx + len / 2) / len, gy / roomH);
        }
        uv.needsUpdate = true;
        var m = new THREE.Mesh(geo, mat);
        m.position.set(cx, cy, z);
        if (outward) m.rotation.y = Math.PI;
        grp.add(m);
        return m;
      };

      var mkWall = function (len, x, z, ry, which) {
        var grp = new THREE.Group();
        grp.position.set(x, 0, z);
        grp.rotation.y = ry;
        root.add(grp);
        var bars = barsOn[which];
        var wash = bars.length ? keep(wallWash(len, roomH, bars)) : null;
        var innerMat = keep(new THREE.MeshStandardMaterial({
          color: C.wall, roughness: 0.95, metalness: 0.0,
          emissive: wash ? C.light : 0x000000, emissiveMap: wash, emissiveIntensity: 0.34
        }));
        /* The front wall is cut round the door. Its frame is turned half a
           circle, so the opening's x in it is the world's, negated. */
        var hole = which === 's' && hasDoor ? { x0: -dx - dw / 2, x1: -dx + dw / 2 } : null;
        var cut = function (a, b, onto) {
          if (!hole) { onto(a, b, 0, roomH); return; }
          onto(a, hole.x0, 0, roomH);
          onto(hole.x1, b, 0, roomH);
          onto(hole.x0, hole.x1, dh, roomH);
        };
        cut(-len / 2, len / 2, function (x0, x1, y0, y1) {
          if (x1 - x0 < 0.001 || y1 - y0 < 0.001) return;
          var m = piece(grp, len, x0, x1, y0, y1, 0, false, innerMat);
          m.userData.wall = which;
          m.receiveShadow = true;
          wallList.push(m);
        });
        var outer = new THREE.Group();
        grp.add(outer);
        cut(-len / 2 - T, len / 2 + T, function (x0, x1, y0, y1) {
          if (x1 - x0 < 0.001 || y1 - y0 < 0.001) return;
          piece(outer, len, x0, x1, y0, y1, -T, true, outerMat);
        });
        /* the cap: the long walls run over the corners, the short ones stop at them */
        var cap = new THREE.Mesh(unitBox, capMat);
        cap.scale.set(which === 'n' || which === 's' ? len + 2 * T : len, 0.03, T);
        cap.position.set(0, roomH + 0.015, -T / 2);
        grp.add(cap);
        bars.forEach(function (b) {
          var bar = new THREE.Mesh(unitBox, barMat);
          if (b.vert) bar.scale.set(0.03, b.len, 0.025); else bar.scale.set(b.len, 0.03, 0.025);
          bar.position.set(-len / 2 + b.at, b.y, 0.013);
          grp.add(bar);
        });
        /* the wall's solid, in world space, for occlusion — see blocked() */
        var nx = -Math.sin(ry), nz = -Math.cos(ry);
        var wb = new THREE.Box3();
        if (which === 'n' || which === 's') {
          wb.min.set(-len / 2 - T, 0, Math.min(z, z + nz * T));
          wb.max.set(len / 2 + T, roomH, Math.max(z, z + nz * T));
        } else {
          wb.min.set(Math.min(x, x + nx * T), 0, -len / 2 - T);
          wb.max.set(Math.max(x, x + nx * T), roomH, len / 2 + T);
        }
        shellWalls.push({ which: which, outer: outer, cx: x, cz: z, nx: nx, nz: nz, box: wb });
      };
      mkWall(roomW, 0, -roomD / 2, 0, 'n');
      mkWall(roomW, 0, roomD / 2, Math.PI, 's');
      mkWall(roomD, -roomW / 2, 0, Math.PI / 2, 'w');
      mkWall(roomD, roomW / 2, 0, -Math.PI / 2, 'e');

      /* THE MARK ON THE BACK WALL, and nothing else there — the room's name
         is on the room selector. White on the plaster, drawn from the
         artwork's brightness (markCanvas) so the black square it ships on
         never reaches the wall. NO MARK IS BETTER THAN A BLACK SQUARE: the
         plane starts hidden and appears only once the artwork is in hand,
         because the loader is asynchronous and can fail outright. */
      if (markSize >= 0.35) {
        var markPlane = new THREE.Mesh(keep(new THREE.PlaneGeometry(markSize, markSize)),
          keep(new THREE.MeshBasicMaterial({ color: 0xf2ede6, transparent: true, depthWrite: false })));
        markPlane.position.set(0, markY, -roomD / 2 + 0.015);
        markPlane.visible = false;
        root.add(markPlane);
        logo(function () {
          var mc = markCanvas();
          if (!mc || markPlane.parent !== root) return;
          if (!markTex) { markTex = new THREE.CanvasTexture(mc); markTex.anisotropy = 4; }
          markPlane.material.map = markTex;
          markPlane.material.needsUpdate = true;
          markPlane.visible = true;
          invalidate();
        });
      }

      /* ---- the ceiling, and the light in it ----------------------------
         A real ceiling once the camera is inside, gone when it is above the
         walls — one boolean on the camera's height, set in updateCam(). The
         strips are unlit geometry in the light's colour: the brightest thing
         in the room, and free. Nothing up here casts a shadow. */
      ceilingGrp = new THREE.Group();
      var ceil = new THREE.Mesh(keep(new THREE.PlaneGeometry(roomW, roomD)),
                                keep(new THREE.MeshStandardMaterial({ color: C.ceiling, roughness: 1.0, metalness: 0.0 })));
      ceil.rotation.x = Math.PI / 2;           /* faces down */
      ceil.position.y = roomH;
      ceilingGrp.add(ceil);
      var stripMat = keep(new THREE.MeshBasicMaterial({ color: C.light }));
      var haloMat = keep(new THREE.MeshBasicMaterial({ map: keep(haloTexture()), color: C.light, transparent: true,
                                                        opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      var stripLen = Math.max(0.6, roomD - 0.8);
      /* in lengths, as the fittings come, with a gap between */
      var segL = Math.min(1.1, stripLen), segGap = 0.45;
      var segN = Math.max(1, Math.floor((stripLen + segGap) / (segL + segGap)));
      var segZ0 = -(segN * segL + (segN - 1) * segGap) / 2 + segL / 2;
      stripXs.forEach(function (sx) {
        for (var sk = 0; sk < segN; sk++) {
          var st = new THREE.Mesh(unitBox, stripMat);
          st.scale.set(0.07, 0.03, segL);
          st.position.set(sx, roomH - 0.02, segZ0 + sk * (segL + segGap));
          ceilingGrp.add(st);
        }
        var ha = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.1, stripLen + 0.7)), haloMat);
        ha.rotation.x = Math.PI / 2;
        ha.position.set(sx, roomH - 0.006, 0);
        ceilingGrp.add(ha);
      });
      root.add(ceilingGrp);

      /* ---- the door: front wall, right-hand side --------------------------
         Where the shop's is, hung the way the reference draws it: on the jamb
         nearer the middle of the room, standing open OUT of the room, so
         nothing inside is under its swing. A real hole in the wall, a slatted
         leaf with the mark on its outside face, a lamp over it. Scenery:
         nothing collides with it and nothing reads it. */
      if (hasDoor) {
        var doorG = new THREE.Group();
        doorG.position.set(dx, 0, roomD / 2);
        root.add(doorG);
        var jambMat = keep(new THREE.MeshStandardMaterial({ color: 0x24211d, roughness: 0.7, metalness: 0.25 }));
        var jt = 0.06, jd = T + 0.05;
        [-1, 1].forEach(function (sgn) {
          var jb = new THREE.Mesh(unitBox, jambMat);
          jb.scale.set(jt, dh + jt, jd);
          jb.position.set(sgn * (dw / 2 + jt / 2), (dh + jt) / 2, T / 2);
          jb.castShadow = true;
          doorG.add(jb);
        });
        var hd = new THREE.Mesh(unitBox, jambMat);
        hd.scale.set(dw + jt * 2, jt, jd);
        hd.position.set(0, dh + jt / 2, T / 2);
        doorG.add(hd);
        var sill = new THREE.Mesh(unitBox, jambMat);
        sill.scale.set(dw, 0.012, T);
        sill.position.set(0, 0.006, T / 2);
        sill.receiveShadow = true;
        doorG.add(sill);

        var leafCan = doorLeafCanvas(null, null);
        var leafTex = keep(new THREE.CanvasTexture(leafCan));
        leafTex.anisotropy = 4;
        var edgeMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a1815, roughness: 0.7, metalness: 0.2 }));
        var faceMat = keep(new THREE.MeshStandardMaterial({ map: leafTex, roughness: 0.62, metalness: 0.15 }));
        var hinge = new THREE.Group();
        hinge.position.set(-dw / 2, 0, T + 0.03);
        hinge.rotation.y = -0.95;              /* stands open, out of the room */
        doorG.add(hinge);
        /* +z is the face that looked out of the room when shut: that one
           carries the mark; the inside face is plain steel */
        var leaf = new THREE.Mesh(unitBox, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, edgeMat]);
        leaf.scale.set(dw - 0.02, dh - 0.02, 0.045);
        leaf.position.set((dw - 0.02) / 2, dh / 2, 0);
        leaf.castShadow = true; leaf.receiveShadow = true;
        hinge.add(leaf);
        var handle = new THREE.Mesh(unitBox, jambMat);
        handle.scale.set(0.03, 0.22, 0.04);
        handle.position.set(dw - 0.12, 1.0, 0.045);
        hinge.add(handle);
        logo(function () {
          var mc = markCanvas();
          if (!mc || doorG.parent !== root) return;
          doorLeafCanvas(leafCan, mc);
          leafTex.needsUpdate = true;
          invalidate();
        });

        /* the lamp over the door, outside, and the wash it throws on the
           block — on the front wall's OUTSIDE face, so it steps aside with it */
        var sWall = null;
        shellWalls.forEach(function (s) { if (s.which === 's') sWall = s; });
        if (sWall) {
          var lampY = Math.min(roomH - 0.12, dh + jt + 0.3);
          var housing = new THREE.Mesh(unitBox, jambMat);
          housing.scale.set(0.24, 0.05, 0.11);
          housing.position.set(-dx, lampY, -T - 0.055);
          sWall.outer.add(housing);
          var lens = new THREE.Mesh(unitBox, keep(new THREE.MeshBasicMaterial({ color: C.light })));
          lens.scale.set(0.19, 0.012, 0.08);
          lens.position.set(-dx, lampY - 0.03, -T - 0.055);
          sWall.outer.add(lens);
          var lampWash = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.3, 1.0)), keep(new THREE.MeshBasicMaterial({
            map: keep(glowTexture()), color: C.light, transparent: true, opacity: 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false })));
          lampWash.position.set(-dx, lampY - 0.3, -T - 0.006);
          lampWash.rotation.y = Math.PI;
          sWall.outer.add(lampWash);
        }
      }

      /* ---- the ground outside, lit along the front ------------------------ */
      (function () {
        var M = 4;
        var ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(roomW + 2 * T + 2 * M, roomD + 2 * T + 2 * M)),
          keep(new THREE.MeshBasicMaterial({ map: keep(groundTexture(roomW, roomD, T, M, hasDoor ? dx : null)) })));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.02;
        root.add(ground);
      })();

      /* ---- paint on the floor: the front area, and the arrows ------------
         The front area is the strip between the ends of the side racks and
         the front wall, at most 1.4 m deep. Its words sit BESIDE the door,
         never in front of it; the arrows run the aisle either side of the
         middle of the floor. */
      (function () {
        var sideW = 0, sideE = 0, backDepth = 0, sideFront = null;
        model.racks.forEach(function (r) {
          if (!r.bays.length || !r.wall) return;
          var dp = dims(r).depth;
          if (r.wall === 'w') sideW = Math.max(sideW, dp);
          if (r.wall === 'e') sideE = Math.max(sideE, dp);
          if (r.wall === 'n') backDepth = Math.max(backDepth, dp);
        });
        var island = null;
        rackBoxes.forEach(function (rb) {
          var rk = racks[rb.id];
          if (rk && (rk.wall === 'w' || rk.wall === 'e' || rk.placement === 'free')) {
            sideFront = sideFront == null ? rb.box.max.z : Math.max(sideFront, rb.box.max.z);
          }
          if (rk && rk.placement === 'free' && (!island || rb.box.max.z - rb.box.min.z > island.max.z - island.min.z)) island = rb.box;
        });
        var edge = 0.12;
        var z0 = Math.max(sideFront == null ? -Infinity : sideFront + 0.18, roomD / 2 - 1.4);
        z0 = clamp(z0, -roomD / 2 + 0.8, roomD / 2 - 0.55);
        var area = { x0: -roomW / 2 + edge, x1: roomW / 2 - edge, z0: z0, z1: roomD / 2 - edge };
        var innerL = -roomW / 2 + sideW, span = roomW - sideW - sideE;
        var zTurn = -roomD / 2 + backDepth + 0.5, zFront = z0 - 0.22;
        var xL = innerL + span * 0.27, xR = innerL + span * 0.73;
        /* An island down the middle makes two aisles: each arrow runs down
           the middle of its own, and the turn is across the clear floor
           behind the island rather than through it. */
        if (island && island.min.x > innerL + 0.4 && island.max.x < innerL + span - 0.4) {
          xL = (innerL + island.min.x) / 2;
          xR = (island.max.x + innerL + span) / 2;
          var backFront = -roomD / 2 + backDepth;
          zTurn = island.min.z - backFront > 0.6 ? (backFront + island.min.z) / 2 : backFront + 0.3;
        }
        var loop = span >= 1.4 && zFront - zTurn >= 1.0
          ? { xL: xL, xR: xR, zTurn: zTurn, zFront: zFront } : null;
        var beside = (hasDoor ? dx - dw / 2 : area.x1) - 0.15;
        var at = beside - area.x0 >= 1.0
          ? { x: (area.x0 + beside) / 2, max: (beside - area.x0) * 0.85 }
          : { x: (area.x0 + area.x1) / 2, max: (area.x1 - area.x0) * 0.8 };
        at.z = (area.z0 + area.z1) / 2;
        var painted = floorPaint(roomW, roomD, area, loop, at, model.words);
        paintInfo = { canvas: painted.canvas, words: painted.words, door: doorBox, area: area, loop: loop };
        var decal = new THREE.Mesh(keep(new THREE.PlaneGeometry(roomW, roomD)), keep(new THREE.MeshStandardMaterial({
          map: keep(painted.tex), transparent: true, roughness: 0.75, metalness: 0.0, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
        })));
        decal.rotation.x = -Math.PI / 2;
        decal.position.y = 0.003;
        decal.receiveShadow = true;
        root.add(decal);

        /* a room lit from the ceiling is brightest in the middle */
        var glow = new THREE.Mesh(keep(new THREE.PlaneGeometry(roomW * 0.95, roomD * 0.95)), keep(new THREE.MeshBasicMaterial({
          map: keep(glowTexture()), color: C.sel, transparent: true, opacity: 0.07,
          blending: THREE.AdditiveBlending, depthWrite: false })));
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.002;
        root.add(glow);
      })();
    }

    /* the floating outlines: one selection, one hover, moved not remade.
       Selection is a RIM — four solid bars round the bay's opening, because
       a one-pixel line is a hairline at any distance — in the light's own
       white. Hover is the same white, quieter. Neither is green or red. */
    selMesh = new THREE.LineSegments(unitEdges, keep(new THREE.LineBasicMaterial({ color: C.sel })));
    selMesh.visible = false;
    root.add(selMesh);

    selRim = new THREE.Group();
    var rimMat = keep(new THREE.MeshBasicMaterial({ color: C.sel }));
    for (var rb = 0; rb < 4; rb++) selRim.add(new THREE.Mesh(unitBox, rimMat));
    selRim.visible = false;
    root.add(selRim);

    hoverMesh = new THREE.LineSegments(unitEdges, keep(new THREE.LineBasicMaterial({ color: C.sel, transparent: true, opacity: 0.45 })));
    hoverMesh.visible = false;
    root.add(hoverMesh);

    ghost = new THREE.LineSegments(unitEdges, keep(new THREE.LineBasicMaterial({ color: C.sel })));
    ghost.visible = false;
    root.add(ghost);
    ghostFloor = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)),
                                keep(new THREE.MeshBasicMaterial({ color: C.sel, transparent: true, opacity: 0.3 })));
    ghostFloor.rotation.x = -Math.PI / 2;
    ghostFloor.visible = false;
    root.add(ghostFloor);

    roomGhost = new THREE.LineSegments(unitEdges, keep(new THREE.LineBasicMaterial({ color: C.sel })));
    roomGhost.visible = false;
    root.add(roomGhost);

    /* THE GRIPS on the rack in focus while the layout editor is open: one at
       the end a rack grows from, for bays; one over its top, for levels. The
       light's white, like the ghost — never green or red. Moved, not remade,
       and only hit-tested while they are showing. */
    var gripMat = keep(new THREE.MeshBasicMaterial({ color: C.sel }));
    handles = { rack: null, bays: new THREE.Mesh(unitBox, gripMat), levels: new THREE.Mesh(unitBox, gripMat) };
    handles.bays.scale.set(0.12, 0.42, 0.12);
    handles.levels.scale.set(0.42, 0.12, 0.12);
    handles.bays.userData.grip = 'bays';
    handles.levels.userData.grip = 'levels';
    handles.bays.visible = handles.levels.visible = false;
    root.add(handles.bays);
    root.add(handles.levels);

    /* the key's shadow frustum, fitted to this room and no bigger. From
       overhead, tipped a little, so a rack throws a short shadow onto the
       aisle the way a ceiling light makes it. */
    var R = Math.max(roomW, roomD) / 2 + 1;
    (function () {
      var sc = sun.shadow.camera;
      sun.position.set(-0.35, 1, 0.45).normalize().multiplyScalar(Math.max(14, R * 2.2));
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
    /* Over a room with walls, the reference render's seat: nearly from the
       front and steep enough to look over the front wall into the room.
       From the old three-quarter seat the front wall's block face covered
       half the floor. */
    homeAz = inRoom ? 0.18 : 0.3;
    homePol = inRoom ? 0.6 : 1.05;
    scene.fog = new THREE.Fog(C.bg, homeDist * 1.6, homeDist * 4.8);
    if (newRoom) {
      flyHome = null;
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
    rebuilds++;
    grow = null;
    startPictures();
    layoutBoxes();
    ceilingByCamera();
    applySel(model.sel);
    placeHandles();
    if (hooks.fit) hooks.fit(overflow);
    renderer.shadowMap.needsUpdate = true;
  }

  /* What a bay is FOR tints the board under it. What is ON it is the boxes,
     placed by layoutBoxes from rec.qty and rec.fill. */
  function setBoard(rec, b) {
    if (!boardMesh || rec.board == null) return;
    if (!BOARD_C) { BOARD_C = new THREE.Color(); MARK_C = new THREE.Color(); }
    /* the same arithmetic matFor(mark, true) did for a board of its own */
    BOARD_C.setHex(C.frame);
    if (b.mark) BOARD_C.lerp(MARK_C.set(b.mark), 0.55);
    boardMesh.setColorAt(rec.board, BOARD_C);
    boardMesh.instanceColor.needsUpdate = true;
    rec.mark = b.mark || null;
    invalidate();
  }

  /* A rack in the hand is hidden where it stood: its group (plate, outlines,
     hit boxes) and its instances in the two shared meshes, collapsed to
     nothing and put back from the matrices kept at build. The shadow is baked
     again either way, or the floor keeps the shadow of a rack that has gone. */
  function showRack(id, on) {
    var k = racks[id];
    if (!k) return;
    if (k.g) k.g.visible = on;
    var p = rackPieces[id];
    if (!p) return;
    if (!ZERO_M) ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
    [[frameMesh, p.frame], [boardMesh, p.board]].forEach(function (pair) {
      if (!pair[0]) return;
      pair[1].forEach(function (e) { pair[0].setMatrixAt(e.i, on ? e.m : ZERO_M); });
      pair[0].instanceMatrix.needsUpdate = true;
    });
    if (renderer) renderer.shadowMap.needsUpdate = true;
    invalidate();
  }

  function update(model) {
    for (var i = 0; i < model.racks.length; i++) {
      var r = model.racks[i];
      for (var j = 0; j < r.bays.length; j++) {
        var b = r.bays[j], rec = bays[b.id];
        if (!rec) continue;
        rec.name = b.name;
        rec.pid = b.pid;
        rec.qty = b.qty || 0;
        rec.fill = b.fill || null;
        rec.items = b.items || null;
        setBoard(rec, b);
      }
    }
    /* A product put away here for the first time takes a free slot in the
       atlas — or stays kraft until the next build when there is none, which
       stats().pictures.nospace says out loud. The room is not rebuilt for it. */
    if (quality === 'high' && boxMesh) {
      var wantNow = picturesWanted();
      /* the last photo gone: the atlas goes with it, and the room is the
         kraft room again */
      if (!pic || !wantNow.length) { if (pic || wantNow.length) startPictures(); }
      else {
        pic.sync = true;
        wantNow.forEach(function (w) { addPicture(w.pid, w.url); });
        pic.sync = false;
      }
    }
    /* boxes came or went, and their shadows with them */
    layoutBoxes();
    applySel(model.sel);
    placeHandles();
    if (renderer) renderer.shadowMap.needsUpdate = true;
  }

  function outlineAt(mesh, rec) {
    mesh.scale.set(rec.bay - G.upright + 0.06, rec.level - G.board + 0.02, rec.depth * 0.96);
    mesh.position.set(rec.x, rec.y - G.board / 2, rec.z);
    mesh.rotation.y = rec.theta;
  }

  /* Four bars round the bay's opening, on the aisle face of the rack. */
  function rimAt(grp, rec) {
    var t = 0.012;
    var ow = rec.bay - G.upright + t, oh = rec.level - G.board + t;
    var nx = Math.sin(rec.theta), nz = Math.cos(rec.theta);
    grp.position.set(rec.x + nx * (rec.depth / 2 + 0.012), rec.y - G.board / 2, rec.z + nz * (rec.depth / 2 + 0.012));
    grp.rotation.y = rec.theta;
    var k = grp.children;
    k[0].scale.set(ow, t, t); k[0].position.set(0, oh / 2, 0);
    k[1].scale.set(ow, t, t); k[1].position.set(0, -oh / 2, 0);
    k[2].scale.set(t, oh, t); k[2].position.set(-ow / 2, 0, 0);
    k[3].scale.set(t, oh, t); k[3].position.set(ow / 2, 0, 0);
  }

  function applySel(id) {
    var rec = id != null ? bays[id] : null;
    selMesh.visible = !!rec;
    if (selRim) selRim.visible = !!rec;
    if (rec) { outlineAt(selMesh, rec); if (selRim) { rimAt(selRim, rec); selRim.updateMatrixWorld(true); } }
    retag();
  }

  /* THE CEILING IS ONE BOOLEAN ON THE CAMERA'S HEIGHT. From above the walls
     it would black out the whole room; from inside, a room without one is a
     set with the lid off. */
  function ceilingByCamera() {
    if (!cam) return;
    var p = cam.position;
    if (ceilingGrp) {
      var inside = p.y < roomBox.h;
      if (ceilingGrp.visible !== inside) ceilingGrp.visible = inside;
    }
    /* THE SHELL, BY THE SAME RULE: a wall's outside face steps aside for a
       camera that is outside that wall and below its top, so a low orbit past
       the front of the room looks into it rather than at block. From above,
       every wall shows its thickness. Outside faces cast no shadow, so this
       costs the baked shadow map nothing. */
    for (var i = 0; i < shellWalls.length; i++) {
      var s = shellWalls[i];
      var show = p.y > roomBox.h + 0.02 || (p.x - s.cx) * s.nx + (p.z - s.cz) * s.nz <= 0;
      if (s.outer.visible !== show) s.outer.visible = show;
    }
    /* the free-standing racks' plates, turned to face the eye */
    if (billboards.length && !BBP) BBP = new THREE.Vector3();
    for (var j = 0; j < billboards.length; j++) {
      var bb = billboards[j];
      if (!bb.mesh.parent) continue;
      bb.mesh.parent.updateMatrixWorld();
      bb.mesh.getWorldPosition(BBP);
      bb.mesh.rotation.y = Math.atan2(p.x - BBP.x, p.z - BBP.z) - bb.theta;
      bb.mesh.updateMatrixWorld();
    }
  }

  /* The soft glow round a strip, across its width and fading at its ends. */
  function haloTexture() {
    var c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    var g = c.getContext('2d');
    var img = g.createImageData(64, 128), px = img.data;
    for (var y = 0; y < 128; y++) {
      var ends = Math.min(1, Math.min(y, 127 - y) / 22);
      for (var x = 0; x < 64; x++) {
        var a = 1 - Math.abs(x - 31.5) / 32;
        var v = Math.round(255 * a * a * a * ends);
        var i = (y * 64 + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
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
    ceilingByCamera();
    invalidate();
  }

  function resetView() {
    stopTween();
    flyHome = null;
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
    /* a canned view is a new place to stand: Escape no longer means "back" */
    flyHome = null;
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
    /* The person switched cameras. A flight's own hand-over does not count. */
    if (!modeInternal) flyHome = null;
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
    /* ESCAPE AND THE FLIGHT. At the capture phase, so it runs before the
       app's own Escape closes a dialog — and then it sees the dialog still
       open and leaves the key alone, rather than one press closing a dialog
       AND flying the camera. Mid-flight it stops the camera where it is;
       landed, it flies back. Not in fullscreen's own Escape, below: that
       one is only reached when there is no flight to undo. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || dead || !cv || !cv.isConnected) return;
      if (hooks.keys && !hooks.keys()) return;
      var t = e.target, tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if ((tag === 'input' || tag === 'textarea' || tag === 'select') && t.id !== 'smScan' && t.id !== 'smScanFs') return;
      if (holdStill()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (flyHome) {
        e.preventDefault();
        e.stopImmediatePropagation();
        back();
        if (hooks.unfocus) hooks.unfocus();
      }
    }, true);
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
    /* A free-standing rack in the air turns a quarter with R. A touch screen
       has no R: the same turn is the ⟳ button on the rack's row. */
    document.addEventListener('keydown', function (e) {
      if (dead || !held || !held.free || e.repeat || (e.key !== 'r' && e.key !== 'R')) return;
      e.preventDefault();
      rotateHeld();
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

  function tween(to, ms, done, kind) {
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
    var mine = tw = { raf: 0, kind: kind || 'view' };
    var step = function () {
      if (tw !== mine) return;
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

  /* ==================================================================
     PRESSING A BAY

     The camera flies to it: square on to the rack face, far enough back to
     see the bay and one bay either side, so a person keeps their bearings.
     Short and eased, and it hands control straight back to a second press,
     a drag, a wheel or Escape — a camera nobody can stop feels broken.

     WHERE IT CAME FROM IS KEPT, and Escape flies back there. Somebody who
     walked to the back of the room and pressed a bay is returned to the back
     of the room, walking, not to a default seat by the door. A second bay
     pressed after the first keeps the ORIGINAL place, because that is where
     the person was before they started looking. A canned view or a switch of
     camera forgets it: that is the person choosing somewhere new.

     A bounded tween like every other: it stops asking for frames when it
     lands. ================================================================ */

  function camNow() { return { az: az, pol: pol, dist: dist, tx: target.x, ty: target.y, tz: target.z }; }

  /* The walking eye, said as an orbit around a point in front of it — the
     same camera, so handing the walk to the orbit does not move the picture. */
  function walkAsOrbit() {
    var D = 2.5, cp = Math.cos(wk.pitch);
    return { az: -wk.yaw, pol: Math.PI / 2 + wk.pitch, dist: D,
             tx: wk.x + Math.sin(wk.yaw) * cp * D, ty: EYE + Math.sin(wk.pitch) * D,
             tz: wk.z - Math.cos(wk.yaw) * cp * D };
  }

  /* How much clear floor there is straight out from a rack face before a
     wall or another rack gets in the way. The camera must not stand inside
     the rack opposite, or all it frames is that rack's uprights. */
  var aheadRay = null, aheadHit = null;
  function clearAhead(x, y, z, nx, nz, ownRack) {
    var best = 60;
    if (roomBox.inRoom) {
      if (nx > 1e-6) best = Math.min(best, (roomBox.w / 2 - WALL_PAD - x) / nx);
      if (nx < -1e-6) best = Math.min(best, (-roomBox.w / 2 + WALL_PAD - x) / nx);
      if (nz > 1e-6) best = Math.min(best, (roomBox.d / 2 - WALL_PAD - z) / nz);
      if (nz < -1e-6) best = Math.min(best, (-roomBox.d / 2 + WALL_PAD - z) / nz);
    }
    if (!aheadRay) { aheadRay = new THREE.Ray(); aheadHit = new THREE.Vector3(); }
    aheadRay.origin.set(x, y, z);
    aheadRay.direction.set(nx, 0, nz).normalize();
    for (var i = 0; i < rackBoxes.length; i++) {
      if (rackBoxes[i].id === ownRack) continue;
      if (aheadRay.intersectBox(rackBoxes[i].box, aheadHit)) {
        best = Math.min(best, aheadHit.distanceTo(aheadRay.origin) - WALL_PAD);
      }
    }
    return Math.max(0, best);
  }

  function framing(rec) {
    var nx = Math.sin(rec.theta), nz = Math.cos(rec.theta);
    var fx = rec.x + nx * rec.depth / 2, fz = rec.z + nz * rec.depth / 2;
    var tanV = Math.tan(cam.fov * Math.PI / 360);
    var tanH = tanV * Math.max(0.3, cam.aspect || 1);
    var halfW = rec.bay * 1.5 + 0.08;                 /* the bay and one either side */
    var halfH = rec.level / 2 + 0.22;
    var want = Math.max(halfW / tanH, halfH / tanV) * 1.04;
    var room = clearAhead(fx, rec.y, fz, nx, nz, rec.rack);
    var off = Math.max(0.8, Math.min(want, room));
    return { az: rec.theta, pol: Math.min(POL_MAX, Math.PI / 2), dist: off + rec.depth / 2,
             tx: rec.x, ty: rec.y, tz: rec.z };
  }

  function focus(id) {
    if (!built || dead || edit || !bays[id]) return false;
    if (!flyHome) {
      flyHome = mode === 'walk'
        ? { walk: true, wk: { x: wk.x, z: wk.z, yaw: wk.yaw, pitch: wk.pitch }, orbit: walkAsOrbit() }
        : { walk: false, orbit: camNow() };
    }
    if (mode === 'walk') {
      apply0(flyHome.orbit);
      modeInternal = true;
      try { setMode('orbit'); } finally { modeInternal = false; }
    }
    tween(framing(bays[id]), FLY_MS, null, 'fly');
    return true;
  }

  /* Back to where the first press was made from. */
  function back() {
    if (!built || !flyHome) return false;
    var home = flyHome;
    tween(home.orbit, FLY_MS, function () {
      flyHome = null;
      if (home.walk) {
        modeInternal = true;
        try { setMode('walk'); } finally { modeInternal = false; }
        wk.x = home.wk.x; wk.z = home.wk.z; wk.yaw = home.wk.yaw; wk.pitch = home.wk.pitch;
        updateCam();
      }
    }, 'back');
    return true;
  }

  /* apply(), without asking for a frame — the tween that follows will. */
  function apply0(v) {
    az = v.az; pol = v.pol; dist = v.dist;
    target.set(v.tx, v.ty, v.tz);
  }

  function flying() { return !!(tw && (tw.kind === 'fly' || tw.kind === 'back')); }

  /* A flight stopped where it is: control goes straight back to the hand. */
  function holdStill() {
    if (!flying()) return false;
    stopTween();
    return true;
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
      pointersDown = Object.keys(ptrs).length;
      walkFocus = true;
      /* A press takes the camera back from a flight, there and then. */
      holdStill();
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
                 lx: e.clientX, ly: e.clientY, moved: 0, rack: null, wall: null, lifting: false,
                 touch: e.pointerType === 'touch' || e.pointerType === 'pen', liftMoved: false };
        /* WHAT IS UNDER THE HAND IS NOTED, NOT ACTED ON. In the editor a
           press on a rack could still turn out to be a click that selects a
           bay, so the drag is not committed until the hand has actually
           moved - the same six pixels the click test already uses. */
        /* A GRIP WINS: it is the smallest target on screen and nobody lands
           on one by accident. Picked up once the hand moves, like a rack. */
        var grip0 = edit && !drag.pan && roomBox.inRoom ? gripAt(e) : null;
        if (grip0) drag.grip = grip0;
        else if (edit && !drag.pan && roomBox.inRoom) {
          var bid = castAt(e);
          var brec = bid != null ? bays[bid] : null;
          var armRack = brec && racks[brec.rack] ? brec.rack : null;
          /* Only when the hand is on bare wall — a rack in front of it wins,
             because moving the rack is the commoner job by far. */
          var armWall = armRack == null ? castWall(e.clientX, e.clientY) : null;
          if (!drag.touch) { drag.rack = armRack; drag.wall = armWall; }
          else if (armRack != null || armWall) {
            /* A FINGER HOLDS BEFORE IT GRABS. On a touch screen a drag is
               how the camera turns, so a rack under the finger is only
               picked up after it has been held still for a moment — move
               first and it is an orbit, as it would be anywhere else. */
            var held0 = drag;
            held0.timer = setTimeout(function () {
              if (drag !== held0 || held0.moved >= 6) return;
              if (armRack != null) {
                held0.rack = armRack;
                held0.lifting = grab(armRack, racks[armRack], false);
                if (held0.lifting && hooks.drag) hooks.drag(dragTo(held0.lx, held0.ly), held0.lx, held0.ly);
              } else {
                held0.wall = armWall;
                held0.lifting = grabWall(armWall);
              }
              if (held0.lifting) {
                /* something to feel: the finger cannot see under itself */
                try { if (navigator.vibrate) navigator.vibrate(12); } catch (x) {}
              }
            }, 450);
          }
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
        if (drag.lifting) drag.liftMoved = true;
        /* a touch that grabbed by holding is carried from wherever it is */
        if (drag.touch && drag.lifting && drag.moved < 6) drag.moved = 6;
        if (drag.grip && drag.moved >= 6) {
          if (!drag.lifting) {
            drag.lifting = growStart(drag.grip);
            if (!drag.lifting) drag.grip = null;
          }
          if (drag.lifting) {
            var ginfo = growTo(e.clientX, e.clientY);
            if (hooks.drag) hooks.drag(ginfo, e.clientX, e.clientY);
            return;
          }
        }
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
      pointersDown = Object.keys(ptrs).length;
      if (Object.keys(ptrs).length < 2) pinch = null;
      if (was && was.timer) clearTimeout(was.timer);
      if (was && !Object.keys(ptrs).length) {
        drag = null;
        /* Held, lifted, never moved: put back where it was, not re-saved at
           wherever the floor under the finger happens to be. */
        if (was.touch && was.lifting && !was.liftMoved) {
          if (was.wall) cancelWall(); else if (was.grip) cancelGrow(); else cancelDrag();
          if (hooks.drag) hooks.drag(null, 0, 0);
          return;
        }
        if (was.lifting && was.grip) {
          var grown = growDrop();
          if (hooks.drag) hooks.drag(null, 0, 0);
          if (grown && hooks.grow) hooks.grow(grown);
          return;
        }
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
    /* A flight may have landed closer than the wheel would go; the wheel
       must not jump the camera back out to its own limit. */
    dist = Math.max(Math.min(distMin, dist), Math.min(distMax, dist * f));
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
    if ((!rackBoxes.length && !shellWalls.length) || !cam) return false;
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
    /* A WALL THE CAMERA CAN SEE IS SOLID TOO. Once walls had a block face
       outside, the right rack's names floated over the front wall from the
       seat above the room. Only a wall whose outside face is showing counts:
       one that has stepped aside for a low camera is, by design, see-through,
       and walls stand outside the room, so from inside they never get in the
       way of a bay. */
    for (var j = 0; j < shellWalls.length; j++) {
      var sw = shellWalls[j];
      if (!sw.outer.visible || !sw.box || sw.box.containsPoint(cam.position)) continue;
      if (occRay.intersectBox(sw.box, occHit) && occHit.distanceTo(cam.position) < span - 0.05) return true;
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
    for (var i = 0; i < editOnly.length; i++) editOnly[i].visible = on;
    invalidate();
    if (!on) { cancelDrag(); cancelWall(); cancelGrow(); }
    placeHandles();
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
      if (o.id === exceptId || !o.bays.length) continue;
      var dm = dims(o), fr = freeOf(o);
      /* a free-standing rack is placed too, and can collide with anything */
      if (!o.wall && !fr) continue;
      out.push({ id: o.id, key: o.key, name: o.name, wall: o.wall || 'free', at: o.wall ? (o.at || 0) : fr,
                 cols: o.cols, width: o.cols * dm.bay, depth: dm.depth });
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
      else if (roomBox.measured && o.wall !== 'free') cands.push(snapUp(o.depth), snapDown(len - o.depth - width));
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
      ext: !!external && !racks[rackId], wall: null, at: null, ok: false,
      /* A free-standing rack drags on the floor and stays free: pushed
         against a wall it does not become a wall rack. */
      free: !!(shape && shape.placement === 'free'), rot: (shape && shape.rot) || 0
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
    showRack(rackId, false);
    invalidate();
    return true;
  }

  function dragTo(x, y) {
    if (!held) return null;
    var p = floorAt(x, y);
    if (!p) return null;
    held.px = x; held.py = y;
    if (held.free) return dragFree(p);
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

  /* ==================================================================
     A FREE-STANDING RACK IN THE AIR

     It drags on the floor plane, snapped to 5 cm, at the turn it has — R
     turns it a quarter while it is held. NOTHING IS WRITTEN UNTIL RELEASE:
     the ghost shows the place and the readout says what is nearest and how
     far, so the aisle rule is visible coming; a place the server would
     refuse — through a wall, into a rack, or closer than the aisle to
     anything — hides the ghost and says why, and letting go there writes
     nothing. The aisle is the server's number, sent with the layout; with
     none this checks only walls and overlaps, and the server still decides. */
  function dragFree(p) {
    var at = { x: snap(p.x + roomBox.w / 2), y: snap(roomBox.d / 2 - p.z), rot: held.rot };
    var res = { kind: 'free', wall: 'free', at: at, rot: held.rot, ok: false, width: held.width, cols: held.cols };
    var aisle = cur && cur.aisle > 0 ? cur.aisle : 0;
    if (!roomBox.inRoom || !roomBox.measured) {
      res.why = 'unmeasured';
    } else {
      var mine = footprint('free', at, held.width, held.depth, roomBox.w, roomBox.d);
      var near = nearest(mine, held.ext ? -1 : held.id);
      var e = 0.001;
      res.gap = near.gap; res.near = near;
      var through = mine.x0 < -e ? 'w' : mine.x1 > roomBox.w + e ? 'e'
                  : mine.z0 < -e ? 'n' : mine.z1 > roomBox.d + e ? 's' : null;
      if (through) { res.why = 'through'; res.through = through; }
      else if (near.overlap) res.why = 'overlap';
      else if (aisle > 0 && near.gap < aisle - e) { res.why = 'aisle'; res.need = aisle; }
      else res.ok = true;
    }
    held.wall = 'free'; held.at = at; held.ok = res.ok;
    if (ghost && ghostFloor) {
      if (res.ok) {
        var g = placeOnWall('free', at, held.width, held.depth, roomBox.w, roomBox.d);
        ghost.position.set(g.x, held.height / 2, g.z);
        ghost.rotation.y = g.theta;
        ghostFloor.position.set(g.x, 0.012, g.z);
        ghostFloor.rotation.z = -g.theta;
        ghost.visible = ghostFloor.visible = true;
      } else {
        ghost.visible = ghostFloor.visible = false;
      }
    }
    invalidate();
    return res;
  }

  /* The nearest thing to a footprint on the floor — a wall or a rack — and
     how far, metres; a rack it overlaps wins outright. */
  function nearest(rect, exceptId) {
    var best = { gap: Infinity, overlap: false, key: null, name: null, wall: null };
    var see = function (gap, what) {
      if (best.overlap || gap >= best.gap) return;
      best.gap = gap; best.key = what.key || null; best.name = what.name || null; best.wall = what.wall || null;
    };
    see(rect.x0, { wall: 'w' });
    see(roomBox.w - rect.x1, { wall: 'e' });
    see(rect.z0, { wall: 'n' });
    see(roomBox.d - rect.z1, { wall: 's' });
    placed(exceptId).forEach(function (o) {
      if (best.overlap) return;
      var fr = footprint(o.wall, o.at, o.width, o.depth, roomBox.w, roomBox.d);
      if (overlaps(rect, fr)) {
        best = { gap: 0, overlap: true, key: o.key, name: o.name || null, wall: null };
        return;
      }
      see(gapBetween(rect, fr), { key: o.key, name: o.name });
    });
    return best;
  }

  /* A quarter turn for the rack in the air — R, or anything else that asks —
     and the readout told again at the same place. */
  function rotateHeld() {
    if (!held || !held.free) return null;
    held.rot = (held.rot + 90) % 360;
    var res = held.px != null ? dragTo(held.px, held.py) : null;
    if (res && hooks.drag) hooks.drag(res, held.px, held.py);
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
    if (held) showRack(held.id, true);
    held = null;
    if (ghost) ghost.visible = false;
    if (ghostFloor) ghostFloor.visible = false;
    if (cv) cv.style.cursor = mode === 'walk' ? 'crosshair' : 'grab';
    invalidate();
  }

  function dragging() { return !!held || !!wallHeld || !!grow; }

  /* ==================================================================
     GROWING A RACK BY HAND (Stage C)

     Two grips on the rack in focus: drag the one at its end to add or take
     away bays, the one over its top for levels. The same bargain as moving a
     rack: NOTHING IS WRITTEN UNTIL RELEASE, the ghost shows the shape it
     would take, and the readout says how many and how near the nearest thing
     is — so a refusal is seen coming. A shape the server would refuse hides
     the ghost and says why: past the end of its wall, into a rack, under the
     aisle, through the ceiling, or — taking away — a bay or level with stock
     on it, named with its count. The server still decides.

     A rack on a wall grows from the end its position is measured from; one
     on the floor grows both ways from its middle, as the server has it. A
     new level is added at the bottom and the rack stands taller; taking
     levels away takes the lowest. ==================================== */

  /* The grips follow the rack in focus — the model's `focus`, sent only while
     the editor is open — and hide while anything is being carried. */
  function placeHandles() {
    if (!handles || !handles.bays) return;
    var id = cur && edit ? cur.focus : null;
    var k = id != null ? racks[id] : null;
    var on = !!(k && k.g && k.g.visible && roomBox.inRoom && (k.wall || k.free) && !held && !grow && !wallHeld);
    handles.bays.visible = handles.levels.visible = on;
    handles.rack = on ? id : null;
    if (on) {
      var height = heightOf(k.rows, k.level);
      handles.bays.position.copy(k.g.localToWorld(new THREE.Vector3(k.width / 2 + 0.12, height / 2, 0)));
      handles.levels.position.copy(k.g.localToWorld(new THREE.Vector3(0, height + 0.16, 0)));
      handles.bays.rotation.y = handles.levels.rotation.y = k.g.rotation.y;
      handles.bays.updateMatrixWorld();
      handles.levels.updateMatrixWorld();
    }
    invalidate();
  }

  /* Which grip is under the hand, if they are showing. */
  function gripAt(e) {
    if (!handles || !handles.bays || !handles.bays.visible || !cv) return null;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, cam);
    var hits = ray.intersectObjects([handles.bays, handles.levels], false);
    return hits.length ? hits[0].object.userData.grip : null;
  }

  function growStart(kind, rackId) {
    var id = rackId != null ? rackId : (handles ? handles.rack : null);
    var k = id != null ? racks[id] : null;
    if (!k || !roomBox.inRoom || held || wallHeld || (kind !== 'bays' && kind !== 'levels')) return false;
    stopTween();
    grow = { id: id, kind: kind, cols0: k.cols, rows0: k.rows, cols: k.cols, rows: k.rows, ok: true };
    placeHandles();
    return true;
  }

  function growTo(x, y) {
    if (!grow) return null;
    var k = racks[grow.id];
    if (!k) return null;
    var g = k.g, r = cv.getBoundingClientRect();
    if (grow.kind === 'bays') {
      var p = floorAt(x, y);
      if (!p) return null;
      var lp = g.worldToLocal(p.clone());
      var span = k.free ? Math.max(0, lp.x) * 2 : lp.x + k.width / 2;
      grow.cols = clamp(Math.round(span / k.bay), 1, 99);
    } else {
      /* up and down: the height the hand points at, on the upright plane
         through the rack that faces the camera */
      var gp = g.localToWorld(new THREE.Vector3(0, 0, 0));
      var nrm = new THREE.Vector3(cam.position.x - gp.x, 0, cam.position.z - gp.z);
      if (nrm.lengthSq() < 1e-6) nrm.set(0, 0, 1);
      var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm.normalize(), gp);
      ndc.x = ((x - r.left) / r.width) * 2 - 1;
      ndc.y = -((y - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(ndc, cam);
      var hp = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, hp)) return null;
      grow.rows = clamp(Math.round((hp.y - G.base - G.top) / k.level), 1, 26);
    }
    var bays2 = grow.kind === 'bays';
    var info = { kind: 'grow', grow: grow.kind, rack: k.key, ok: true,
                 n: bays2 ? grow.cols : grow.rows, from: bays2 ? grow.cols0 : grow.rows0 };
    var width = grow.cols * k.bay, height = heightOf(grow.rows, k.level);
    var W2 = roomBox.w, D2 = roomBox.d, e = 0.001;
    var aisle = cur && cur.aisle > 0 ? cur.aisle : 0;

    if (info.n < info.from) {
      /* taking away: only empty ones go, the last bays or the lowest levels */
      var key = bays2 ? 'ci' : 'rl', order = [], held2 = {};
      Object.keys(bays).forEach(function (bid) {
        var b = bays[bid];
        if (b.rack === grow.id && b[key] != null && order.indexOf(b[key]) < 0) order.push(b[key]);
      });
      order.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
      var doomed = order.slice(Math.max(0, order.length - (info.from - info.n)));
      Object.keys(bays).forEach(function (bid) {
        var b = bays[bid];
        if (b.rack === grow.id && doomed.indexOf(b[key]) >= 0 && b.qty > 0) held2[b[key]] = (held2[b[key]] || 0) + b.qty;
      });
      var occ = Object.keys(held2).map(function (q) { return { at: bays2 ? Number(q) : q, n: held2[q] }; });
      if (occ.length) { info.ok = false; info.why = 'occupied'; info.occupied = occ; }
    } else if (bays2 && info.n > info.from) {
      var mine = k.free ? footprint('free', k.free, width, k.depth, W2, D2)
                        : footprint(k.wall, k.at, width, k.depth, W2, D2);
      if (k.free) {
        var near = nearest(mine, grow.id);
        info.gap = near.gap; info.near = near;
        var through = mine.x0 < -e ? 'w' : mine.x1 > W2 + e ? 'e' : mine.z0 < -e ? 'n' : mine.z1 > D2 + e ? 's' : null;
        if (!roomBox.measured) { info.ok = false; info.why = 'unmeasured'; }
        else if (through) { info.ok = false; info.why = 'through'; info.through = through; }
        else if (near.overlap) { info.ok = false; info.why = 'overlap'; }
        else if (aisle > 0 && near.gap < aisle - e) { info.ok = false; info.why = 'aisle'; info.need = aisle; }
      } else if (k.at + width > wallLen(k.wall) + e) {
        info.ok = false; info.why = 'wall'; info.wall = k.wall;
      } else {
        /* a rack on a wall: its nearest neighbour, and a free-standing
           rack's aisle, whichever of the two is growing */
        var best = null;
        placed(grow.id).forEach(function (o) {
          var theirs = footprint(o.wall, o.at, o.width, o.depth, W2, D2);
          var hit = roomBox.measured ? overlaps(mine, theirs)
                  : (o.wall === k.wall && k.at < o.at + o.width - e && o.at < k.at + width - e);
          var gap = roomBox.measured ? gapBetween(mine, theirs) : Infinity;
          if (hit) gap = 0;
          if (!best || gap < best.gap) best = { gap: gap, key: o.key, name: o.name, free: o.wall === 'free', hit: hit };
        });
        if (best && best.gap !== Infinity) { info.gap = best.gap; info.near = { key: best.key, name: best.name }; }
        if (best && best.hit) { info.ok = false; info.why = 'overlap'; }
        else if (best && best.free && aisle > 0 && best.gap < aisle - e) { info.ok = false; info.why = 'aisle'; info.need = aisle; }
      }
    } else if (!bays2 && info.n > info.from && cur && cur.h && height > cur.h + e) {
      info.ok = false; info.why = 'ceiling'; info.h = height; info.r = cur.h;
    }

    grow.ok = info.ok;
    if (ghost) {
      if (info.ok) {
        var at2 = k.free ? placeOnWall('free', k.free, width, k.depth, W2, D2)
                         : placeOnWall(k.wall, k.at, width, k.depth, W2, D2);
        ghost.scale.set(width, height, k.depth);
        ghost.position.set(at2.x, height / 2, at2.z);
        ghost.rotation.y = at2.theta;
        ghost.visible = true;
      } else {
        ghost.visible = false;
      }
    }
    invalidate();
    return info;
  }

  /* Let go: { id, kind, from, to } when there is something to save, or null. */
  function growDrop() {
    if (!grow) return null;
    var g = grow;
    var to = g.kind === 'bays' ? g.cols : g.rows, from = g.kind === 'bays' ? g.cols0 : g.rows0;
    cancelGrow();
    return g.ok && to !== from ? { id: g.id, kind: g.kind, from: from, to: to } : null;
  }

  function cancelGrow() {
    if (!grow) return;
    grow = null;
    if (ghost) ghost.visible = false;
    placeHandles();
    invalidate();
  }

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
      if (o.wall === 'free') return;   /* the server tests those itself (fitRoom); nothing here narrows */
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

  function overlayHost() { return overlay; }

  /* ------------------------------------------------------------ the tags */

  function tag(i) {
    while (tags.length <= i) {
      var el = document.createElement('div');
      el.className = 'sm-tag';
      var b = document.createElement('b');
      b.dir = 'ltr';
      var s = document.createElement('small');
      /* the name line takes its direction from its own text: an Arabic
         product name under a Latin bay code, in either UI language */
      s.dir = 'auto';
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
    var lights = 0, instanced = 0, drawn = {}, capOf = {};
    if (scene) scene.traverseVisible(function (o) {
      if (o.isLight) lights++;
      if (o.isInstancedMesh && o.userData.boxes) instanced++;
    });
    bayOrder.forEach(function (id) {
      if (!bays[id]) return;
      drawn[id] = bays[id].drawn;
      capOf[id] = tierCap(bays[id].slots);
    });
    return { calls: inf.calls, triangles: inf.triangles, quality: quality, mode: mode,
             fs: fs, racks: rackBoxes.length, bays: hitList.length,
             eye: { x: wk.x, z: wk.z }, room: { w: roomBox.w, d: roomBox.d, h: roomBox.h },
             lights: lights, lightBudget: quality === 'high' ? LIGHTS_HIGH : LIGHTS_LOW,
             ceiling: !!(ceilingGrp && ceilingGrp.visible), camY: cam ? cam.position.y : null,
             boxes: { meshes: instanced, count: boxMesh ? boxMesh.count : 0, drawn: drawn, cap: capOf,
                      stickers: stickerMesh ? stickerMesh.count : 0 },
             flying: flying(), focused: !!flyHome,
             shell: (function () { var o = {}; shellWalls.forEach(function (s) { o[s.which] = s.outer.visible; }); return o; })(),
             editOnly: editOnly.filter(function (o) { return o.visible; }).length,
             free: Object.keys(racks).filter(function (k) { return racks[k].placement === 'free'; }).length,
             rebuilds: rebuilds,
             handles: !!(handles && handles.bays && handles.bays.visible),
             growing: grow ? { kind: grow.kind, cols: grow.cols, rows: grow.rows, ok: grow.ok } : null,
             pictures: picStats(),
             selColour: C.sel, hoverColour: hoverMesh ? hoverMesh.material.color.getHex() : null };
  }

  /* ------------------------------------------------ figures, for the harness
     Read-only answers, plus a camera setter, so a test can aim at a real
     point of the room instead of a guess. None of them schedules a frame
     except camera(), which moves the camera and so must. */
  function bayCentre(id) {
    var r = bays[id];
    if (!r) return null;
    var nx = Math.sin(r.theta), nz = Math.cos(r.theta);
    return { x: r.x + nx * r.depth / 2, y: r.y, z: r.z + nz * r.depth / 2 };
  }

  function pickAt(x, y) { return castAt({ clientX: x, clientY: y }); }

  function camera(v) {
    if (!built) return null;
    if (v) { stopTween(); if (mode === 'walk') setMode('orbit'); apply(v); }
    return camNow();
  }

  function sign(rackId) { return signs[rackId] || null; }

  /* Frame time, measured honestly: n draws of the scene as it stands, each
     one waited on by reading a pixel back, since render() returns before
     the GPU is done and Chrome does not block on gl.finish(). Synchronous
     and test-only — nothing here is a loop. */
  function bench(n) {
    if (!built || !renderer) return null;
    var gl = renderer.getContext(), times = [], px = new Uint8Array(4);
    var sync = function () { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, cam); sync();               /* warm: shaders, the baked shadow */
    for (var i = 0; i < (n || 20); i++) {
      var t0 = now();
      renderer.render(scene, cam);
      sync();
      times.push(now() - t0);
    }
    times.sort(function (a, b) { return a - b; });
    var sum = times.reduce(function (a, b) { return a + b; }, 0);
    dirty = true;
    return { mean: sum / times.length, median: times[Math.floor(times.length / 2)], max: times[times.length - 1],
             quality: quality, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  }

  /* Where the middle of the picture on box k of a bay is, in the world — the
     front end (side 1) or the back (side -1) — so a test can look at it. */
  function boxEnd(bayId, k, side) {
    var rec = bays[bayId];
    if (!rec || !boxMesh || rec.firstBox < 0 || k >= rec.drawn) return null;
    var M = new THREE.Matrix4();
    boxMesh.getMatrixAt(rec.firstBox + k, M);
    return new THREE.Vector3(0, (PIC_V0 + PIC_V1) / 2 - 0.5, side < 0 ? -0.5 : 0.5).applyMatrix4(M);
  }

  /* One pixel of the room as drawn right now, at a client point. Renders
     and reads back synchronously; test-only, like bench(). */
  function pixel(x, y) {
    if (!built || !renderer || !cv) return null;
    var r = cv.getBoundingClientRect(), gl = renderer.getContext(), px = new Uint8Array(4);
    var pr = renderer.getPixelRatio();
    renderer.render(scene, cam);
    gl.readPixels(Math.round((x - r.left) * pr), Math.round((r.bottom - y) * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    dirty = true;
    return [px[0], px[1], px[2]];
  }

  /* Every box showing a picture, checked against whose box it is. */
  function pictureAudit() {
    var a = { boxes: boxMesh ? boxMesh.count : 0, showing: 0, wrong: 0, byPid: {} };
    if (!boxMesh || !boxPid) return a;
    var arr = boxMesh.geometry.getAttribute('aSlot').array;
    for (var n = 0; n < boxMesh.count; n++) {
      if (arr[n] < 0) continue;
      a.showing++;
      a.byPid[boxPid[n]] = (a.byPid[boxPid[n]] || 0) + 1;
      if (!pic || pic.pidOf[arr[n]] !== boxPid[n]) a.wrong++;
    }
    return a;
  }

  /* ---------------------------------------------------------------- wire */

  function hook(h) {
    if (!h) return;
    ['fit', 'drag', 'move', 'room', 'pick', 'lost', 'peek', 'fs', 'fsNodes', 'keys', 'mode', 'quality', 'qualityAuto',
     'unfocus', 'grow']
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
    overlayHost: overlayHost,
    pointerLock: pointerLock,
    setQuality: setQuality,
    quality: function () { return quality; },
    paint: function () { return paintInfo; },
    rotateHeld: rotateHeld,
    heldRot: function () { return held ? held.rot : null; },
    /* the footprint twin, for a harness: metres from the north-west corner */
    rect: function (wall, at, width, depth, w, d) { return footprint(wall, at, width, depth, w, d); },
    /* where a rack in the scene stands on the floor, the same way */
    rackRect: function (id) {
      var k = racks[id];
      if (!k) return null;
      return footprint(k.free ? 'free' : k.wall, k.free || k.at, k.width, k.depth, roomBox.w, roomBox.d);
    },
    /* how squarely a free-standing rack's plate faces the camera: 1 is head on */
    plateFacing: function (id) {
      for (var i = 0; i < billboards.length; i++) {
        if (billboards[i].rack !== id) continue;
        var m = billboards[i].mesh, q = new THREE.Quaternion(), wp = new THREE.Vector3();
        m.getWorldQuaternion(q); m.getWorldPosition(wp);
        var n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        var to = cam.position.clone().sub(wp); to.y = 0; n.y = 0;
        return n.normalize().dot(to.normalize());
      }
      return null;
    },
    focus: focus,
    back: back,
    flying: flying,
    project: project,
    stats: stats,
    bayCentre: bayCentre,
    pickAt: pickAt,
    camera: camera,
    sign: sign,
    bench: bench,
    /* Stage C */
    growStart: growStart,
    growTo: growTo,
    growDrop: growDrop,
    cancelGrow: cancelGrow,
    /* a hand on the canvas right now — the map holds a live update for it */
    handBusy: function () { return pointersDown > 0; },
    /* where a grip is on the page, for a harness */
    gripPoint: function (kind) {
      if (!handles || !handles[kind] || !handles[kind].visible) return null;
      var p = handles[kind].position;
      return project(p.x, p.y, p.z);
    },
    boxEnd: boxEnd,
    pixel: pixel,
    pictureAudit: pictureAudit,
    /* the harness fills an atlas by making it small */
    pictureLimit: function (px) {
      picMax = px > 0 ? px : 2048;
      startPictures();
      layoutBoxes(true);
      return picStats();
    }
  };
})();
