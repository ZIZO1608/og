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
  var disposables = [];
  var sig = '';
  var cur = null;
  var pending = null;

  var selMesh = null, hoverMesh = null;
  var hoverId = null;
  var matFrame = null, matCrate = null, matBoard = null;
  var mats = {};            /* one material per colour, shared by every bay of that type */

  var hooks = { pick: null, lost: null };

  var az = 0.38, pol = 1.02, dist = 12;
  var target = null;
  var homeAz = 0.38, homePol = 1.02, homeDist = 12;
  var POL_MIN = 0.15;
  var POL_MAX = 1.42;
  var distMin = 3, distMax = 60;
  var panBound = 20;

  var dirty = false, raf = 0;
  var W = 0, H = 0;

  var ndc = null, ray = null, V = null;

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
    var parts = [model.roomId, model.w, model.d, model.h];
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
       Measured: the tape wins, and a rack that would not fit still pushes
       the wall out rather than being drawn through it. Unmeasured: the
       racks decide, with the aisle in front of them and room to walk. */
    var need = { n: 0, s: 0, e: 0, w: 0 }, tallest = 0;
    model.racks.forEach(function (r) {
      if (!r.bays.length) return;
      tallest = Math.max(tallest, rackHeight(r.rows));
      if (r.wall) need[r.wall] = Math.max(need[r.wall], (r.pos + r.cols) * BAY_P + 0.6);
    });
    var roomW = Math.max(model.w || 0, need.n, need.s, inRoom ? MIN_ROOM : 0);
    var roomD = Math.max(model.d || 0, need.e, need.w, inRoom ? MIN_ROOM : 0);
    /* racks on the side walls need depth behind the racks on the end walls */
    roomW = Math.max(roomW, (need.e || need.w) ? RACK_D * 2 + 3 : 0);
    roomD = Math.max(roomD, (need.n || need.s) ? RACK_D * 2 + 3 : 0);
    var roomH = Math.max(model.h || DEF_H, tallest + 1.4);

    /* ---- the racks -------------------------------------------------- */
    var loose = 0, looseTotal = 0;
    model.racks.forEach(function (r) { if (r.bays.length && (!inRoom || !r.wall)) looseTotal++; });

    model.racks.forEach(function (r) {
      if (!r.bays.length) return;
      var width = r.cols * BAY_P, height = rackHeight(r.rows);
      var at;
      if (inRoom && r.wall) {
        at = placeOnWall(r.wall, r.pos, r.cols, roomW, roomD);
      } else {
        /* no wall yet: side by side down the middle, facing the entrance —
           so a rack the designer has not placed is still on screen to be
           placed, and still has every bay on it */
        var span = 0;
        model.racks.forEach(function (o) { if (o.bays.length && (!inRoom || !o.wall)) span += o.cols * BAY_P + 1.2; });
        var start = -span / 2;
        var before = 0;
        for (var q = 0; q < model.racks.indexOf(r); q++) {
          var o2 = model.racks[q];
          if (o2.bays.length && (!inRoom || !o2.wall)) before += o2.cols * BAY_P + 1.2;
        }
        at = { x: start + before + width / 2 + 0.6, z: 0, theta: 0 };
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
      var mkWall = function (len, x, z, ry) {
        var m = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, roomH)), wallMat);
        m.position.set(x, roomH / 2, z);
        m.rotation.y = ry;
        root.add(m);
        var sk = new THREE.Mesh(unitBox, skirtMat);
        sk.scale.set(len, 0.12, 0.04);
        sk.position.set(x, 0.06, z);
        sk.rotation.y = ry;
        /* pushed a hair into the room so it does not z-fight the wall */
        sk.translateZ(0.02);
        root.add(sk);
      };
      mkWall(roomW, 0, -roomD / 2, 0);
      mkWall(roomW, 0, roomD / 2, Math.PI);
      mkWall(roomD, -roomW / 2, 0, Math.PI / 2);
      mkWall(roomD, roomW / 2, 0, -Math.PI / 2);

      /* the brand on the back wall, above the racks: the mark, and the
         room's name beside it — stacked when the room is narrow */
      var topOf = tallest + 0.55;
      var signY = Math.min(roomH - 0.75, topOf + 0.7);
      var wide = roomW >= 5.6;
      var logoSize = 1.0;
      var logoPlane = new THREE.Mesh(keep(new THREE.PlaneGeometry(logoSize, logoSize)),
                                     new THREE.MeshBasicMaterial({ color: 0x000000 }));
      logoPlane.position.set(wide ? -1.65 : 0, wide ? signY : signY + 0.65, -roomD / 2 + 0.02);
      root.add(logoPlane);
      logo(function (t) {
        logoPlane.material.map = t;
        logoPlane.material.color.setHex(0xffffff);
        logoPlane.material.needsUpdate = true;
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
    az = homeAz; pol = homePol; dist = homeDist;
    if (target) target.set(0, cur && cur.roomId != null ? 0.9 : 0.7, 0);
    if (cam) updateCam();
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
        drag = { pan: e.button === 1 || e.button === 2, x: e.clientX, y: e.clientY, moved: 0 };
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
        if (drag.pan) panBy(dx, dy);
        else {
          az -= dx * 0.0058;
          pol = Math.max(POL_MIN, Math.min(POL_MAX, pol - dy * 0.0058));
          updateCam();
        }
        return;
      }

      if (!ks.length) hover(castAt(e));
    });

    var lift = function (e) {
      var was = drag;
      delete ptrs[e.pointerId];
      if (Object.keys(ptrs).length < 2) pinch = null;
      if (was && !Object.keys(ptrs).length) {
        drag = null;
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

  function dolly(f) {
    dist = Math.max(distMin, Math.min(distMax, dist * f));
    updateCam();
  }

  function panBy(dx, dy) {
    var k = dist * 0.0016;
    var rx = Math.cos(az), rz = -Math.sin(az);
    var fx = -Math.sin(az), fz = -Math.cos(az);
    target.x = clamp(target.x - (dx * rx - dy * fx) * k, -panBound, panBound);
    target.z = clamp(target.z - (dx * rz - dy * fz) * k, -panBound, panBound);
    updateCam();
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function castAt(e) {
    if (!built || !hitList.length) return null;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, cam);
    var hits = ray.intersectObjects(hitList, false);
    return hits.length ? hits[0].object.userData.id : null;
  }

  function hover(id) {
    if (id === hoverId) return;
    hoverId = id;
    var rec = id != null ? bays[id] : null;
    hoverMesh.visible = !!rec && (!cur || cur.sel !== id);
    if (rec) outlineAt(hoverMesh, rec);
    cv.style.cursor = rec ? 'pointer' : 'grab';
    retag();
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
      tags.push({ el: el, b: b, s: s, x: 0, y: 0, z: 0, on: false, pri: 0, w: 0, h: 0 });
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
        tgt.pri = 0;
      } else {
        var rec = bays[w.id];
        tgt.b.textContent = rec.full;
        tgt.s.textContent = rec.name || '';
        tgt.s.style.display = rec.name ? '' : 'none';
        tgt.el.className = 'sm-tag' + (w.primary ? ' on' : '');
        tgt.b.dir = 'ltr';
        tgt.x = rec.x; tgt.y = rec.y + LEVEL_H / 2; tgt.z = rec.z;
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
    if (h && h.pick) hooks.pick = h.pick;
    if (h && h.lost) hooks.lost = h.lost;
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
    hook: hook
  };
})();
