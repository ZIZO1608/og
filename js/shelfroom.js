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

   THE CANVAS OUTLIVES THE DOM, and that is the whole architecture. Every
   scan on the map is a repaint, and a repaint is root.innerHTML = body() —
   wholesale. A <canvas> written into that string would lose its WebGL
   context on every barcode of a put-away run. So the canvas is created ONCE,
   held in a module variable, pulled out of the tree before the innerHTML
   that would destroy it (ShelfRoom.detach) and put back after
   (ShelfRoom.attach). Moving a canvas between parents keeps its context;
   letting innerHTML eat it does not.

   THE SCENE IS A DIFF, NEVER A REBUILD. sync() compares the incoming model
   with the one on screen: same room, same racks, same bays — touch fills and
   tag text only. Anything structural tears down and rebuilds. Forty meshes
   per scan would be the tilt-slider lesson ("a slider that re-renders forty
   tiles per tick stutters on exactly the hardware this has to run on") an
   order of magnitude worse.

   RENDER ON DEMAND, NEVER A LOOP. Every mutation sets `dirty` and asks for
   exactly one animation frame; a still camera schedules nothing at all. A
   60fps idle loop is heat and battery on a fanless tablet in a warehouse.

   THREE.JS IS FETCHED LAZILY, the first time somebody opens the map — never
   at boot. It is ~600KB (js/vendor/three.min.js, r147, the last release with
   a UMD build and a THREE global). The till must not parse 600KB every
   morning for a screen a cashier never opens.

   COLOUR — THE FLASH IS A RING, THE TYPE IS A FACE. The three scan colours
   exist here only as a ring around a bay. A product type is a Lambert fill
   on a crate and a tint on the board under it, never a line. The one other
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

  /* ------------------------------------------------------------ constants */

  var BAY_W = 1.0;      /* bay slot width */
  var BAY_P = 1.14;     /* bay pitch along the rack (slot + upright) */
  var LEVEL_H = 0.46;   /* one level of shelving — a shoe box and air */
  var RACK_D = 0.95;    /* rack depth */
  var BASE_H = 0.08;    /* the plinth the bottom level sits on */
  var BOARD_T = 0.04;   /* a shelf board */
  var TOP_T = 0.05;     /* the top board */
  var AISLE = 0.55;     /* how far in front of a rack its floor line runs */
  var MIN_ROOM = 5.0;   /* a room is never drawn smaller than this, unmeasured */
  var DEF_H = 3.4;      /* an unmeasured room's wall height */

  var C = {
    bg:     0x0d0d0d,
    floor:  0xffffff,   /* white: the concrete texture alone sets the tone, unmultiplied */
    wall:   0x17171b,
    skirt:  0x0b0b0d,
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
  var renderer = null, scene = null, cam = null;
  var root = null;          /* everything rebuilt per room hangs off this */
  var built = false;
  var dead = false;
  var host = null;

  var bays = {};            /* shelf id → { x,y,z (world), theta, crate, board, … } */
  var hitList = [];
  var rackBoxes = [];       /* one world-space box per rack: the occlusion test */
  var racks = {};           /* rack id -> { g, cols, rows, key, wall, pos } */
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

  var hooks = { pick: null, lost: null, peek: null, fit: null, drag: null, move: null, room: null };

  var az = 0.38, pol = 1.02, dist = 12;
  var target = null;
  var homeAz = 0.38, homePol = 1.02, homeDist = 12;
  var POL_MIN = 0.15;
  var POL_MAX = 1.42;
  var distMin = 3, distMax = 60;
  var panBound = 20;

  var dirty = false, raf = 0;
  var W = 0, H = 0;

  var ndc = null, ray = null, V = null, OCCP = null;

  var tags = [];
  var logoTex = null;       /* assets/logo.svg, loaded once for the life of the tab */
  var floorTex = null;      /* the concrete, drawn once */

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
    s.onerror = function () { flush(false); };
    document.head.appendChild(s);
  }

  function boot() {
    try {
      cv = document.createElement('canvas');
      cv.className = 'sm-room-gl';
      /* The canvas must NEVER take focus: the scan box owns the caret for
         the whole put-away run. No tabindex, ever. */

      renderer = new THREE.WebGLRenderer({
        canvas: cv, antialias: true,
        failIfMajorPerformanceCaveat: !/[?&]gl=force\b/.test(location.search)
      });
      renderer.setClearColor(C.bg, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      scene = new THREE.Scene();
      cam = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
      target = new THREE.Vector3(0, 0.9, 0);
      ndc = new THREE.Vector2();
      ray = new THREE.Raycaster();
      V = new THREE.Vector3();
      OCCP = new THREE.Vector3();

      /* A sky/ground pair so nothing is ever pure black, one sun from the
         front-left so every crate has a lit face and a shaded face, and a
         dim fill from the right so the side walls are not one flat tone.
         Depth on a dark screen comes from those differences — shadows do
         not read on black. */
      scene.add(new THREE.HemisphereLight(0x9a9aa4, 0x0a0a0b, 1.1));
      var sun = new THREE.DirectionalLight(0xffffff, 0.75);
      sun.position.set(-6, 11, 9);
      scene.add(sun);
      var fill = new THREE.DirectionalLight(0xffffff, 0.22);
      fill.position.set(8, 6, -4);
      scene.add(fill);

      tagHost = document.createElement('div');
      tagHost.className = 'sm-room-tags';

      bindPointer();

      cv.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        dead = true;
        if (hooks.lost) hooks.lost();
      });

      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(function () { measure(); }).observe(cv);
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

  /* --------------------------------------------------------- attach/detach */

  function detach() {
    /* The canvas is leaving the tree. frame() bails on !cv.isConnected so
       nothing would draw — but the tween would go on asking for frames
       against a scene nobody can see, for as long as it had left to run. */
    stopTween();
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
    if (tagHost && tagHost.parentNode) tagHost.parentNode.removeChild(tagHost);
  }

  function attach(mount) {
    if (!cv || !mount) return;
    var wait = mount.querySelector('.sm-room-wait');
    if (wait) wait.style.display = 'none';
    if (cv.parentNode !== mount) mount.insertBefore(cv, mount.firstChild);
    if (tagHost.parentNode !== mount) mount.appendChild(tagHost);
    host = mount;
    measure();
  }

  function measure() {
    if (!renderer || !host) return;
    var w = host.clientWidth, h = host.clientHeight;
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
    renderer.render(scene, cam);
    place();
  }

  function invalidate() {
    dirty = true;
    if (!raf) raf = requestAnimationFrame(frame);
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

  function sameSig(model) {
    /* model.name is in here because the room's name is PAINTED on the back
       wall: left out, renaming a room left the old name hanging up there
       until something structural forced a rebuild. */
    var parts = [model.roomId, model.name, model.w, model.d, model.h];
    for (var i = 0; i < model.racks.length; i++) {
      var r = model.racks[i];
      var ids = [];
      for (var j = 0; j < r.bays.length; j++) ids.push(r.bays[j].id);
      parts.push(r.id + ':' + r.wall + ':' + r.pos + ':' + r.cols + ':' + r.rows + ':' + r.key + ':' + ids.join(','));
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

  /* THE TYPE IS A FACE. A colour reaches the scene only as a Lambert fill —
     the crate for what is on the bay, the board under it (tinted toward the
     frame) for what the bay is assigned to. Never a line material. */
  function matFor(hex, tint) {
    var key = (tint ? 't:' : 'f:') + hex;
    if (!mats[key]) {
      var col = new THREE.Color(hex);
      if (tint) col = new THREE.Color(C.frame).lerp(col, 0.55);
      mats[key] = new THREE.MeshLambertMaterial({ color: col });
    }
    return mats[key];
  }

  /* Where a rack on a wall sits, and which way it faces. Positions are bays
     from the LEFT end of the wall as you stand inside facing it — so "left"
     means a different world axis on every wall, and this table is the whole
     of that arithmetic in one place. */
  function placeOnWall(wall, pos, cols, w, d) {
    var half = cols * BAY_P / 2, along = pos * BAY_P + half;
    switch (wall) {
      case 'n': return { x: -w / 2 + along, z: -d / 2 + RACK_D / 2, theta: 0 };
      case 's': return { x:  w / 2 - along, z:  d / 2 - RACK_D / 2, theta: Math.PI };
      case 'e': return { x:  w / 2 - RACK_D / 2, z: -d / 2 + along, theta: -Math.PI / 2 };
      default:  return { x: -w / 2 + RACK_D / 2, z:  d / 2 - along, theta: Math.PI / 2 };
    }
  }

  function rackHeight(rows) { return BASE_H + rows * LEVEL_H + TOP_T; }

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
    matFrame = new THREE.MeshLambertMaterial({ color: C.frame });
    matBoard = matFrame;
    matCrate = new THREE.MeshLambertMaterial({ color: C.crate });
    var matEdge = new THREE.LineBasicMaterial({ color: C.edge });
    var matHit = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    var matBack = new THREE.MeshLambertMaterial({ color: C.back });
    var matLime = new THREE.MeshBasicMaterial({ color: C.lime });

    var inRoom = model.roomId != null;

    /* ---- how big is the room ----------------------------------------
       Measured: the tape decides, alone. Unmeasured: the racks decide, with
       the aisle in front of them and room to walk. */
    var need = { n: 0, s: 0, e: 0, w: 0 }, tallest = 0;
    model.racks.forEach(function (r) {
      if (!r.bays.length) return;
      tallest = Math.max(tallest, rackHeight(r.rows));
      if (r.wall) need[r.wall] = Math.max(need[r.wall], (r.pos + r.cols) * BAY_P + 0.6);
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
      roomW = Math.max(roomW, (need.e || need.w) ? RACK_D * 2 + 3 : 0);
      roomD = Math.max(roomD, (need.n || need.s) ? RACK_D * 2 + 3 : 0);
    }
    var roomH = model.h ? model.h : Math.max(DEF_H, tallest + 1.4);
    roomBox = { w: roomW, d: roomD, h: roomH, inRoom: inRoom, measured: measured };

    overflow = [];
    if (measured) {
      model.racks.forEach(function (r) {
        if (!r.bays.length || !r.wall) return;
        var lenM = (r.wall === 'n' || r.wall === 's') ? roomW : roomD;
        var over = (r.pos + r.cols) * BAY_P - lenM;
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
        var wd = o.cols * BAY_P;
        if (line.length && lineW + GAP + wd > lane) { lanes.push({ items: line, w: lineW }); line = []; lineW = 0; }
        lineW += (line.length ? GAP : 0) + wd;
        line.push(o);
      });
      lanes.push({ items: line, w: lineW });
      var depth = RACK_D + 1.1, z0 = -((lanes.length - 1) * depth) / 2;
      lanes.forEach(function (ln, li) {
        var x = -ln.w / 2;
        ln.items.forEach(function (o) {
          var wd = o.cols * BAY_P;
          looseAt[o.id] = { x: x + wd / 2, z: z0 + li * depth, theta: 0 };
          x += wd + GAP;
        });
      });
    })();

    model.racks.forEach(function (r) {
      if (!r.bays.length) return;
      var width = r.cols * BAY_P, height = rackHeight(r.rows);
      var at;
      if (inRoom && r.wall) {
        at = placeOnWall(r.wall, r.pos, r.cols, roomW, roomD);
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
        up.scale.set(BAY_P - BAY_W, height, RACK_D * 0.94);
        up.position.set((i - r.cols / 2) * BAY_P, height / 2, 0);
        g.add(up);
      }
      /* A back panel only when the rack stands free. Against a wall the
         wall IS its back — and since the walls are culled from outside, an
         open back is what lets somebody orbiting behind the front wall see
         what is on the front rack instead of a slab. */
      if (!(inRoom && r.wall)) {
        var back = new THREE.Mesh(unitBox, matBack);
        back.scale.set(width, height, 0.03);
        back.position.set(0, height / 2, -RACK_D / 2 + 0.015);
        g.add(back);
      }
      var top = new THREE.Mesh(unitBox, matFrame);
      top.scale.set(width, TOP_T, RACK_D);
      top.position.set(0, height - TOP_T / 2, 0);
      g.add(top);

      /* the letter, as a plaque above the rack */
      var plaque = new THREE.Mesh(
        keep(new THREE.PlaneGeometry(0.44, 0.44)),
        new THREE.MeshBasicMaterial({ map: keep(signTexture(r.key, 128, 128, 84, '#0a0a0b')) })
      );
      plaque.position.set(0, height + 0.34, 0.06);
      g.add(plaque);

      /* the aisle line: brand lime, on the floor, in front */
      var line = new THREE.Mesh(keep(new THREE.PlaneGeometry(width, 0.05)), matLime);
      line.rotation.x = -Math.PI / 2;
      line.position.set(0, 0.004, RACK_D / 2 + AISLE);
      g.add(line);

      g.updateMatrixWorld(true);

      var hw = new THREE.Vector3(width / 2, height / 2, RACK_D / 2);
      var bx = new THREE.Box3(hw.clone().multiplyScalar(-1), hw.clone());
      bx.applyMatrix4(g.matrixWorld);
      rackBoxes.push({ id: r.id, box: bx });
      racks[r.id] = { g: g, cols: r.cols, rows: r.rows, key: r.key, wall: r.wall, pos: r.pos };

      /* the bays, level by level — A at the top */
      r.bays.forEach(function (b) {
        var xl = (b.col - (r.cols + 1) / 2) * BAY_P;
        var yFloor = BASE_H + (r.rows - 1 - b.row) * LEVEL_H;

        var board = new THREE.Mesh(unitBox, matBoard);
        board.scale.set(BAY_P, BOARD_T, RACK_D);
        board.position.set(xl, yFloor - BOARD_T / 2, 0);
        g.add(board);

        var edge = new THREE.LineSegments(unitEdges, matEdge);
        edge.scale.set(BAY_W, LEVEL_H - BOARD_T - 0.04, RACK_D * 0.9);
        edge.position.set(xl, yFloor + (LEVEL_H - BOARD_T) / 2, 0);
        g.add(edge);

        var crate = new THREE.Mesh(unitBox, matCrate);
        g.add(crate);

        var hit = new THREE.Mesh(unitBox, matHit);
        hit.scale.set(BAY_P, LEVEL_H, RACK_D);
        hit.position.set(xl, yFloor + LEVEL_H / 2, 0);
        hit.userData.id = b.id;
        g.add(hit);
        hitList.push(hit);

        var wp = g.localToWorld(new THREE.Vector3(xl, yFloor + LEVEL_H / 2, 0));
        bays[b.id] = {
          x: wp.x, y: wp.y, z: wp.z, theta: at.theta, yFloor: yFloor,
          xl: xl, crate: crate, board: board,
          full: b.full, name: b.name, pid: b.pid, row: b.row, col: b.col, rack: r.id
        };
        setCrate(bays[b.id], b);
      });
    });

    /* ---- the room around them --------------------------------------- */
    var floorW = inRoom ? roomW : Math.max(8, roomW + 6);
    var floorD = inRoom ? roomD : Math.max(8, roomD + 6);
    var tex = concrete();
    var floorMat = new THREE.MeshLambertMaterial({ color: C.floor, map: tex });
    var floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(floorW, floorD)), floorMat);
    tex.repeat.set(floorW / 2.2, floorD / 2.2);
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);

    if (inRoom) {
      /* four walls that face INWARD only — from outside the near wall is
         backface-culled, so orbiting behind the room looks into it. */
      var wallMat = new THREE.MeshLambertMaterial({ color: C.wall });
      var skirtMat = new THREE.MeshLambertMaterial({ color: C.skirt });
      /* Each wall knows which one it is, because in the editor a wall is not
         only scenery: it is the handle you pull to say how big the room
         really is. They face inward and are backface-culled, so this also
         means only a wall you can actually see can be grabbed. */
      var mkWall = function (len, x, z, ry, which) {
        var m = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, roomH)), wallMat);
        m.position.set(x, roomH / 2, z);
        m.rotation.y = ry;
        m.userData.wall = which;
        wallList.push(m);
        root.add(m);
        var sk = new THREE.Mesh(unitBox, skirtMat);
        sk.scale.set(len, 0.12, 0.04);
        sk.position.set(x, 0.06, z);
        sk.rotation.y = ry;
        /* pushed a hair into the room so it does not z-fight the wall */
        sk.translateZ(0.02);
        root.add(sk);
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
                                     new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      logoPlane.position.set(wide ? -1.65 : 0, wide ? signY : signY + 0.65, -roomD / 2 + 0.02);
      logoPlane.visible = false;
      root.add(logoPlane);
      logo(function (t) {
        if (!t) return;
        logoPlane.material.map = t;
        logoPlane.material.needsUpdate = true;
        logoPlane.visible = true;
        invalidate();
      });
      if (model.name) {
        var sign = new THREE.Mesh(
          keep(new THREE.PlaneGeometry(3.0, 0.72)),
          new THREE.MeshBasicMaterial({ map: keep(signTexture(model.name, 1024, 246, 118, '#0a0a0b')) })
        );
        sign.position.set(wide ? 0.55 : 0, wide ? signY : signY - 0.45, -roomD / 2 + 0.02);
        root.add(sign);
      }
    }

    /* the two floating outlines: one selection, one hover, moved not remade */
    selMesh = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: C.sel }));
    selMesh.scale.set(BAY_W + 0.06, LEVEL_H - BOARD_T + 0.02, RACK_D * 0.96);
    selMesh.visible = false;
    root.add(selMesh);

    hoverMesh = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: 0x8a8a92 }));
    hoverMesh.scale.copy(selMesh.scale);
    hoverMesh.visible = false;
    root.add(hoverMesh);

    ghost = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: C.sel }));
    ghost.visible = false;
    root.add(ghost);
    ghostFloor = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)),
                                new THREE.MeshBasicMaterial({ color: C.lime, transparent: true, opacity: 0.35 }));
    ghostFloor.rotation.x = -Math.PI / 2;
    ghostFloor.visible = false;
    root.add(ghostFloor);

    roomGhost = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: C.sel }));
    roomGhost.visible = false;
    root.add(roomGhost);

    /* home the camera to the room — from the entrance side, three-quarter,
       high enough to see over the front rack into the room */
    var R = Math.max(roomW, roomD) / 2 + 1;
    homeDist = Math.max(6, R / Math.tan((cam.fov * Math.PI / 360)) * 0.95);
    distMin = 2.2; distMax = homeDist * 3; panBound = R + 4;
    /* Higher over a room than over a single rack: from eye height the front
       wall's rack hides the floor, and from above every wall's rack shows
       its face. Reset view is one click away either way. */
    homeAz = inRoom ? 0.42 : 0.3;
    homePol = inRoom ? 0.88 : 1.05;
    scene.fog = new THREE.Fog(C.bg, homeDist * 1.6, homeDist * 4.8);
    if (newRoom) { target.set(0, inRoom ? 0.9 : 0.7, 0); resetView(); }
    applySel(model.sel);
    if (hooks.fit) hooks.fit(overflow);
  }

  function setCrate(rec, b) {
    var c = rec.crate;
    rec.board.material = b.mark ? matFor(b.mark, true) : matBoard;
    c.material = b.fill ? matFor(b.fill, false) : matCrate;
    if (!b.qty) { c.visible = false; return; }
    var frac = (b.capacity && b.capacity > 0)
      ? Math.max(0.16, Math.min(1, b.qty / b.capacity))
      : 0.55;
    var h = (LEVEL_H - BOARD_T - 0.08) * frac;
    c.visible = true;
    c.scale.set(BAY_W * 0.9, h, RACK_D * 0.78);
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
  }

  function outlineAt(mesh, rec) {
    mesh.position.set(rec.x, rec.y - BOARD_T / 2, rec.z);
    mesh.rotation.y = rec.theta;
  }

  function applySel(id) {
    var rec = id != null ? bays[id] : null;
    selMesh.visible = !!rec;
    if (rec) outlineAt(selMesh, rec);
    retag();
  }

  /* -------------------------------------------------------------- camera */

  function updateCam() {
    var sp = Math.sin(pol);
    cam.position.set(target.x + dist * sp * Math.sin(az),
                     target.y + dist * Math.cos(pol),
                     target.z + dist * sp * Math.cos(az));
    cam.lookAt(target);
    invalidate();
  }

  function resetView() {
    stopTween();
    az = homeAz; pol = homePol; dist = homeDist;
    if (target) target.set(0, cur && cur.roomId != null ? 0.9 : 0.7, 0);
    if (cam) updateCam();
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
    if (typeof Motion !== 'undefined' && Motion.reduced && Motion.reduced()) {
      apply(to); if (done) done(); return;
    }
    var from = { az: az, pol: pol, dist: dist, tx: target.x, ty: target.y, tz: target.z };
    /* Shortest way round: without this, turning from -170° to +170° goes
       the long way and the room spins through three walls to move two. */
    var dAz = to.az - from.az;
    while (dAz > Math.PI) dAz -= Math.PI * 2;
    while (dAz < -Math.PI) dAz += Math.PI * 2;

    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    tw = { raf: 0 };
    var step = function () {
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var k = Math.min(1, (now - t0) / ms);
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
    if (!f) { if (done) done(); return; }
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
      var n = Object.keys(ptrs).length;
      if (n === 2) {
        var ks = Object.keys(ptrs), a = ptrs[ks[0]], b = ptrs[ks[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        drag = null;
      } else if (n === 1) {
        drag = { pan: e.button === 1 || e.button === 2, x: e.clientX, y: e.clientY, moved: 0, rack: null, wall: null, lifting: false };
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
      }
    });

    cv.addEventListener('pointermove', function (e) {
      var p = ptrs[e.pointerId];
      if (p) { p.x = e.clientX; p.y = e.clientY; }

      var ks = Object.keys(ptrs);
      if (pinch && ks.length === 2) {
        var a = ptrs[ks[0]], b = ptrs[ks[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        if (d > 0 && pinch.d > 0) dolly(pinch.d / d);
        panBy(cx - pinch.cx, cy - pinch.cy);
        pinch.d = d; pinch.cx = cx; pinch.cy = cy;
        return;
      }

      if (drag && p) {
        var dx = e.movementX != null ? e.movementX : 0;
        var dy = e.movementY != null ? e.movementY : 0;
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
            drag.lifting = grab(drag.rack, rk.cols, rk.rows, false);
            if (!drag.lifting) drag.rack = null;
          }
          if (drag.lifting) {
            var info = dragTo(e.clientX, e.clientY);
            if (hooks.drag) hooks.drag(info, e.clientX, e.clientY);
            return;
          }
        }
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
          if (size && hooks.room) hooks.room(size.w, size.d);
          return;
        }
        if (was.lifting) {
          var put = drop(e.clientX, e.clientY);
          if (hooks.drag) hooks.drag(null, 0, 0);
          if (put && hooks.move) hooks.move(put.id, put.wall, put.pos);
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
      dolly(e.deltaY > 0 ? 1.1 : 0.9);
    }, { passive: false });
  }

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
    cv.style.cursor = rec ? 'pointer' : 'grab';
    retag();
    invalidate();
  }

  /* ==================================================================
     MOVING A RACK BY HAND

     The room is a plan you rearrange, not a picture of one. With the layout
     editor open a rack can be picked up and put against a wall, and THE DROP
     IS WHAT SAVES IT. There is no Save button to forget, because a layout
     held in the browser is a layout that dies on a refresh.

     THE GHOST ONLY EVER SHOWS A PLACE THE RACK CAN GO. It snaps to whole
     bays, stops at the end of a measured wall, and will not overlap a rack
     already standing there: it slides to the nearest free slot instead. So
     the answer arrives while the rack is still in the air, rather than as a
     refusal after the fact. The server runs the same arithmetic again and
     has the last word; this is the courtesy, not the boundary.

     Green and red are deliberately not used. On this screen those two
     colours already mean a scan was accepted or refused, and a ghost
     borrowing them would be a second language for the same two words. The
     ghost is white where it can land, hidden where it cannot, and the
     readout beside the hand says which wall, which bay, and what is in the
     way. ================================================================== */

  var edit = false;
  var roomBox = { w: 0, d: 0, inRoom: false, measured: false };
  var ghost = null, ghostFloor = null;
  var held = null;
  var floorPlane = null, floorPt = null;

  function setEdit(on) {
    on = !!on;
    if (on === edit) return;
    edit = on;
    if (!on) { cancelDrag(); cancelWall(); }
    if (cv) cv.style.cursor = 'grab';
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

  /* How many whole bays fit along a wall. Only a measured room can answer;
     an unmeasured wall is as long as it needs to be, which is the same
     admitted gap the schema keeps by letting the measurements be NULL. */
  function wallBays(wall) {
    if (!roomBox.measured) return Infinity;
    var len = (wall === 'n' || wall === 's') ? roomBox.w : roomBox.d;
    return Math.max(1, Math.floor((len + 0.02) / BAY_P));
  }

  /* THE INVERSE OF placeOnWall. A point on the floor becomes the wall it is
     nearest and how far along that wall it sits in bays, counted from the
     left as you stand inside facing it. This table and that one have to stay
     in step, which is why they are written next to each other. */
  function wallAt(p, cols) {
    var w = roomBox.w, d = roomBox.d;
    var cand = [
      { wall: 'n', gap: p.z + d / 2, along: p.x + w / 2 },
      { wall: 's', gap: d / 2 - p.z, along: w / 2 - p.x },
      { wall: 'e', gap: w / 2 - p.x, along: p.z + d / 2 },
      { wall: 'w', gap: p.x + w / 2, along: d / 2 - p.z }
    ];
    var best = cand[0], i;
    for (i = 1; i < cand.length; i++) if (cand[i].gap < best.gap) best = cand[i];
    var pos = Math.round((best.along - cols * BAY_P / 2) / BAY_P);
    var cap = wallBays(best.wall) - cols;
    if (cap !== Infinity) pos = Math.min(pos, Math.max(0, cap));
    return { wall: best.wall, pos: Math.max(0, pos), gap: best.gap };
  }

  /* The same overlap arithmetic server/lib/shelves.js runs, against the live
     model, so the answer needs no round trip. */
  function blockerOn(wall, pos, cols, exceptId) {
    if (!cur) return null;
    for (var i = 0; i < cur.racks.length; i++) {
      var o = cur.racks[i];
      if (o.id === exceptId || o.wall !== wall || !o.bays.length) continue;
      if (pos < o.pos + o.cols && o.pos < pos + cols) return o;
    }
    return null;
  }

  /* Nearest free slot to the one the hand is over, searched outward, so a
     rack dragged into a taken run slides into the gap beside it instead of
     stopping dead against it. */
  function freeSlot(wall, pos, cols, exceptId) {
    var cap = wallBays(wall) - cols;
    if (cap !== Infinity && cap < 0) return null;
    var top = cap === Infinity ? pos + 24 : cap;
    for (var step = 0; step <= 26; step++) {
      var down = pos - step, up = pos + step;
      if (down >= 0 && !blockerOn(wall, down, cols, exceptId)) return down;
      if (up <= top && !blockerOn(wall, up, cols, exceptId)) return up;
      if (down < 0 && up > top) break;
    }
    return null;
  }

  /* rackId may name a rack that is NOT in the scene: the unplaced list beside
     the room drags into it, and those racks have no group to pick up. */
  function grab(rackId, cols, rows, external) {
    if (!built || !roomBox.inRoom) return false;
    stopTween();
    held = {
      id: rackId, cols: Math.max(1, cols || 1), rows: Math.max(1, rows || 1),
      ext: !!external, wall: null, pos: null, ok: false
    };
    if (ghost) {
      ghost.scale.set(held.cols * BAY_P, rackHeight(held.rows), RACK_D);
      ghost.visible = false;
    }
    if (ghostFloor) {
      ghostFloor.scale.set(held.cols * BAY_P, RACK_D, 1);
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
      res = { wall: null, pos: null, ok: false, why: 'out' };
    } else {
      var hit = wallAt(p, held.cols);
      if (hit.gap > 2.4) {
        /* well clear of every wall: in the room, on no wall. That is a real
           state, not a failure. A rack waiting to be placed stands about. */
        res = { wall: null, pos: null, ok: true, why: 'floor' };
      } else if (wallBays(hit.wall) < held.cols) {
        res = { wall: hit.wall, pos: null, ok: false, why: 'short', bays: wallBays(hit.wall) };
      } else {
        var except = held.ext ? -1 : held.id;
        var slot = freeSlot(hit.wall, hit.pos, held.cols, except);
        var b = blockerOn(hit.wall, hit.pos, held.cols, except);
        if (slot == null) res = { wall: hit.wall, pos: null, ok: false, why: 'full', by: b ? b.key : '' };
        else res = { wall: hit.wall, pos: slot, ok: true, why: b ? 'slid' : '', by: b ? b.key : '' };
      }
    }
    held.wall = res.wall; held.pos = res.pos; held.ok = res.ok;
    res.cols = held.cols;

    if (ghost && ghostFloor) {
      if (res.ok && res.wall) {
        var at = placeOnWall(res.wall, res.pos, held.cols, roomBox.w, roomBox.d);
        ghost.position.set(at.x, rackHeight(held.rows) / 2, at.z);
        ghost.rotation.y = at.theta;
        ghostFloor.position.set(at.x, 0.012, at.z);
        ghostFloor.rotation.z = -at.theta;
        ghost.visible = ghostFloor.visible = true;
      } else if (res.ok) {
        ghost.position.set(p.x, rackHeight(held.rows) / 2, p.z);
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
    var out = held.ok ? { id: held.id, wall: held.wall, pos: held.pos } : null;
    cancelDrag();
    return out;
  }

  function cancelDrag() {
    if (held && racks[held.id] && racks[held.id].g) racks[held.id].g.visible = true;
    held = null;
    if (ghost) ghost.visible = false;
    if (ghostFloor) ghostFloor.visible = false;
    if (cv) cv.style.cursor = 'grab';
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

     Height is not pulled. It has no floor to be measured against on screen
     and no handle that is not a hairline, so it stays a number typed into
     Room settings, next to the other two. ================================ */

  var wallHeld = null;
  var roomGhost = null;
  var SNAP = 0.05;            /* 5 cm: a tape reads to the centimetre, a hand does not */
  var ROOM_MIN = 1.0, ROOM_MAX = 60.0;

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
    wallHeld = { wall: which, w: roomBox.w, d: roomBox.d };
    if (cv) cv.style.cursor = 'grabbing';
    return true;
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
    w = clamp(Math.round(w / SNAP) * SNAP, ROOM_MIN, ROOM_MAX);
    d = clamp(Math.round(d / SNAP) * SNAP, ROOM_MIN, ROOM_MAX);
    wallHeld.w = w; wallHeld.d = d;

    if (roomGhost) {
      var h = Math.max(0.4, roomBox.h || 2.6);
      roomGhost.scale.set(w, h, d);
      roomGhost.position.set(0, h / 2, 0);
      roomGhost.visible = true;
    }
    invalidate();
    return { kind: 'room', w: w, d: d, ok: true };
  }

  function dropWall(x, y) {
    if (!wallHeld) return null;
    if (x != null) dragWall(x, y);
    var out = { w: wallHeld.w, d: wallHeld.d };
    cancelWall();
    return out;
  }

  function cancelWall() {
    wallHeld = null;
    if (roomGhost) roomGhost.visible = false;
    if (cv) cv.style.cursor = 'grab';
    invalidate();
  }

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

  function retag() {
    want = [];
    var selId = cur ? cur.sel : null;
    if (selId != null && bays[selId]) want.push({ id: selId, primary: true });
    if (hoverId != null && hoverId !== selId && bays[hoverId]) want.push({ id: hoverId });
    runs().forEach(function (run) { want.push({ run: run }); });

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
        tgt.y = w.run.b0.y + LEVEL_H / 2 - 0.06;
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
        tgt.x = rec.x; tgt.y = rec.y + LEVEL_H / 2; tgt.z = rec.z;
        tgt.rack = rec.rack;
        tgt.pri = w.primary ? 2 : 1;
      }
      tgt.w = tgt.el.offsetWidth || 120;
      tgt.h = tgt.el.offsetHeight || 24;
      tgt.on = true;
    }
    for (; i < tags.length; i++) { tags[i].on = false; tags[i].el.className = 'sm-tag'; }
    invalidate();
  }

  /* SIGNAGE, NOT SUBTITLES. Levels stack and rows converge, so names would
     land on top of one another: the selected bay's tag first, then the
     hovered one, then everything else nearest-first — and a name that would
     sit on one already placed hides. Nothing is nudged sideways. */
  function place() {
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
    m.seg.scale.set(BAY_W + 0.14, LEVEL_H - BOARD_T + 0.1, RACK_D * 1.02);
    outlineAt(m.seg, rec);
    m.seg.visible = true;
    invalidate();
    setTimeout(function () { m.seg.visible = false; m.busy = false; invalidate(); }, 1400);
  }

  /* ---------------------------------------------------------------- wire */

  function hook(h) {
    if (h && h.fit) hooks.fit = h.fit;
    if (h && h.drag) hooks.drag = h.drag;
    if (h && h.move) hooks.move = h.move;
    if (h && h.room) hooks.room = h.room;
    if (h && h.pick) hooks.pick = h.pick;
    if (h && h.lost) hooks.lost = h.lost;
    if (h && h.peek) hooks.peek = h.peek;
  }

  return {
    supported: supported,
    ready: ready,
    ensure: ensure,
    detach: detach,
    attach: attach,
    sync: sync,
    flash: flash,
    resetView: resetView,
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
    cancelWall: cancelWall
  };
})();
