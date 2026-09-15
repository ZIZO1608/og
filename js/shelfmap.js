/* ==========================================================================
   OG SYSTEM — the warehouse map                                [shelfmap.js]
   --------------------------------------------------------------------------
   The warehouse, drawn — as TWO VIEWS OF ONE PLACE. The 2D view is the
   default and the working surface: the room from above (the plan strip,
   every rack a bar on the wall it hangs on) and under it the rack in focus
   seen straight on, levels down the side and bays across. The 3D room
   (js/shelfroom.js) is the same data with the walls put back, one press
   away, for planning and for showing somebody. Both carry the same
   colours, the same names, the same scan feedback and the same designer;
   switching changes how it is drawn and nothing about what it says.

   TWO SURFACES, ONE RULE. The 3D room is for LOOKING — which shelf, how
   full, where the gap is. The flat panel underneath is for WORKING — what is
   on the shelf, what belongs on it, and every edit. Nothing readable ever
   goes in the tilted plane: a table at 18° is a table nobody can read, and a
   name painted on a shelf at 60° is worse. The room's labels are DOM —
   upright, floating over the canvas, facing the camera whatever it does.

   The room costs 600KB of library — three times chart.js, the largest file
   in the repo — and the paragraph that used to sit here said that was too
   much to pay for forty rectangles. It was right on the facts and has been
   overruled on the goal: the map is shown to people, and a room reads as a
   room. What survives of the argument is that the library loads the FIRST
   TIME somebody opens the map, never at boot, so the till pays nothing for
   it on the mornings nobody looks at the warehouse.

   COLOUR DISCIPLINE — THE FLASH IS A RING, THE TYPE IS A FILL. Green, amber
   and red exist ONLY as scan feedback — accepted, look-here, refused — and
   only ever as a RING: a closed line all the way round a bay, for 1.4
   seconds and then gone. On the elevation that is the tile's border plus a
   box-shadow; in the room it is an outline.

   A PRODUCT TYPE IS A FILL, ON BOTH SURFACES. This paragraph used to say the
   flat rack "stays greys and pure white" and that colour-by-type belonged to
   the room alone. That was written when the flat rack was the failure path —
   a screen nobody chose — and it is wrong now that it is what opens by
   default: it would mean the surface most people look at is the one that
   cannot answer "where are the jackets".

   The fill has two carriers, matching the room's two. What is ON a bay
   colours its fill area — the crate in the room, the capacity bar on the
   elevation, or the whole face where there is no capacity to be a fraction
   of. What a bay is FOR tints the board under it: the shelf board in the
   room, a 3px board across the foot of the tile. Neither is ever a border,
   an outline, a glow or a tag, and that is mechanical rather than tasteful:
   .sm-flash-* sets border-color !important on all four sides, so a type
   colour parked on any edge blinks green every time somebody scans, and a
   colour that blinks is a colour nobody can read.

   DB.typeColour is the only source, so the legend, the elevation, the room
   and the panel's stripe cannot disagree. Its eight colours are muted, dark
   and deliberately nowhere near the three feedback hues or the lime the app
   acts in. The legend is mandatory whenever the colours are on — eight dark
   colours are not all telling apart at bay size, and a colour without a key
   is decoration — and it is drawn on a flat surface under whichever view is
   up, never inside the room.

   `grid_origin` IS ABOUT THE ROOM, NOT THE LANGUAGE. Column 1 draws on
   whichever side that room's door puts it, and stays there when the app
   switches to Arabic — a room does not turn around because a menu changed
   language. The grid element is pinned dir="ltr" and every tile is placed by
   explicit grid coordinates, because letting an RTL document mirror the grid
   automatically is exactly the bug this paragraph exists to prevent.

   Reading is `stock.read` (the warehouse screen's own gate). Scanning stock
   onto shelves is `stock.move`. The layout editor is drawn only for
   `config.write` — the manager. The server holds the real boundary; these
   gates decide what is worth drawing.
   ========================================================================== */

var ShelfMap = (function () {

  var S = {
    data: null,        /* sections, straight from GET /api/sections */
    secId: null,       /* which RACK is in focus — the scan target's rack, the panel's rack */
    rooms: [],         /* the rooms the racks hang in, straight from the same GET */
    roomId: null,      /* which room is on screen; null = one rack drawn on its own */
    edit: false,       /* layout editor on (manager only) */
    sel: null,         /* selected shelf id — also the put-away target */
    loading: false,
    err: null,
    /* The room could not be drawn on THIS machine — no WebGL, the library
       failed to load, or the context was lost mid-run. Permanent for the
       page: the flat rack takes over and nothing flickers back. */
    glDead: false,
    /* Colour by product type, on both surfaces. Per machine, like sound —
       and like sound, never the only signal: the code is on every bay and
       the name is on every run. */
    colour: true,
    /* Which surface: '2d' (the plan and the rack, straight on) or 'room'
       (the WebGL room). 2D is the default, and that is a decision about the
       job rather than about taste — the flat view is where a put-away run
       happens, and defaulting to it means a warehouse tablet never downloads
       600KB of Three.js unless somebody asks to look at the room. */
    view: '2d',

    /* The put-away run. `chips` is newest-first and is the undo strip: there
       are no confirm dialogs anywhere in this flow, because a dialog needs a
       mouse and a scanner has none — the person is holding a shoe. */
    chips: [],
    seq: 0,
    sound: true,

    /* The standard rack in centimetres and the limits, straight from GET
       /api/sections. The room draws from these; nothing here invents one. */
    geometry: null,
    limits: null,
    /* The room's camera: 'orbit' (the planner's) or 'walk' (eye height,
       keys and pads). Per machine, like the view. */
    cam: 'orbit',
    /* 'auto' | 'high' | 'low'. Auto starts high and drops itself after a
       slow first room; the drop is remembered as 'low'. */
    quality: 'auto',
    /* Touch pads over the room while walking. On by default on a coarse
       pointer, switchable either way. */
    pads: null,
    /* The room is fullscreen: the canvas wrapper is out on <body> and the
       stage holds a placeholder. Set by ShelfRoom's fs hook, never here. */
    fs: false,
    fsKind: null
  };

  var CHIPS_SHOWN = 8;
  var SOUND_KEY = 'og_sm_sound';
  var COLOUR_KEY = 'og_sm_colour';
  var VIEW_KEY = 'og_sm_view';
  var CAM_KEY = 'og_sm_cam';
  var QUALITY_KEY = 'og_sm_quality';
  var PADS_KEY = 'og_sm_pads';
  try { S.colour = localStorage.getItem(COLOUR_KEY) !== '0'; } catch (e) { S.colour = true; }
  /* Per machine, not per account: the office computer can sit on the room
     and the warehouse tablet on the plan, and neither has to keep choosing. */
  try { if (localStorage.getItem(VIEW_KEY) === 'room') S.view = 'room'; } catch (e) { S.view = '2d'; }
  try { if (localStorage.getItem(CAM_KEY) === 'walk') S.cam = 'walk'; } catch (e) { S.cam = 'orbit'; }
  try {
    var q0 = localStorage.getItem(QUALITY_KEY);
    if (q0 === 'high' || q0 === 'low') S.quality = q0;
  } catch (e) { S.quality = 'auto'; }
  try {
    var p0 = localStorage.getItem(PADS_KEY);
    if (p0 === '1' || p0 === '0') S.pads = p0 === '1';
  } catch (e) { S.pads = null; }

  try {
    S.sound = localStorage.getItem(SOUND_KEY) !== '0';
  } catch (e) { /* private window, cleared storage — sound simply stays on */ }

  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /* The same payload shape js/labels60.js scans and prints:
     SH + two-digit warehouse + room letter + shelf code. */
  var SHELF_SCAN_RE = /^SH(\d{2})([A-Z])([A-Z]\d{1,3})$/;

  /* ---------------------------------------------------------------- data */

  function load(keepSel) {
    S.loading = true; S.err = null;
    return Shop.sections().then(function (res) {
      S.data = res.sections || [];
      S.rooms = res.rooms || [];
      if (res.geometry) S.geometry = res.geometry;
      if (res.limits) S.limits = res.limits;
      S.loading = false;
      if (!keepSel) S.sel = null;
      /* Keep the chosen room if it still exists; otherwise the first. */
      settle();
      /* A load IS the freshest answer: whatever a live update was holding is
         older, and taking it afterwards would put back what this replaced. */
      liveFresh = null;
      liveLine(false);
      repaint();
      if (liveAgain) { liveAgain = false; liveFetch(); }
    }).catch(function (err) {
      S.loading = false; S.err = API.friendly(err);
      repaint();
      if (liveAgain) { liveAgain = false; liveFetch(); }
    });
  }

  function reload() { return load(true); }

  /* ================================================================ LIVE
     (Stage C) Stock put away on one screen used to reach this one on the
     next reload. Now the server says so on /api/live — a flag, no data —
     js/pulse.js hands it here, and the map asks GET /api/sections again,
     through the same gated route it always reads.

     WHAT A LIVE UPDATE MAY DO. The answer is compared before anything is
     drawn. Same layout, different stock: the ordinary repaint every scan
     already is — the room sees the same signature (sameSig in shelfroom.js
     has no quantities in it), keeps its scene, moves only the instanced
     boxes and draws one frame. A different layout is a rebuild, as it would
     be for a change made here.

     NEVER UNDER SOMEBODY'S HANDS. While the person is busy — a rack, a wall
     or a grip in the air, a hand on the canvas, a camera flight, a new rack
     being placed, a dialog or drawer open, or the layout editor open —
     nothing is applied: it is held and taken the moment they are free. A
     layout changed ELSEWHERE while this person is laying the room out is
     never taken for them: a quiet line says so, with a button to take it,
     and their arrangement stays on screen until they choose. */
  var liveFresh = null;       /* a newer answer, waiting */
  var liveBusy = false, liveAgain = false, liveHold = null, livePollT = null;
  var LIVE_POLL_MS = 45 * 1000;

  function live() {
    if (!S.data) return;                       /* never opened: nothing on screen to keep true */
    invalidate();                              /* the Settings list's cache is stale either way */
    if (OG.view !== 'shelfmap') { S.stale = true; return; }
    liveFetch();
  }

  function liveFetch() {
    if (S.loading || liveBusy) { liveAgain = true; return; }
    liveBusy = true;
    Shop.sections().then(function (res) {
      liveBusy = false;
      liveFresh = res;
      liveApply();
      if (liveAgain) { liveAgain = false; liveFetch(); }
    }, function () {
      /* a missed beat is not news: the next change, or the poll, carries it */
      liveBusy = false;
      if (liveAgain) { liveAgain = false; liveFetch(); }
    });
  }

  /* What makes a change structural — rooms, racks, where they stand, their
     sizes, which shelves exist — and, apart from it, what is ON the shelves. */
  function layoutSig(sections, rooms) {
    return JSON.stringify([
      (rooms || []).map(function (r) { return [r.id, r.name, r.width_cm, r.depth_cm, r.height_cm]; }),
      (sections || []).map(function (s) {
        return [s.id, s.key, s.name, s.room_id, s.placement, s.wall, s.wall_cm, s.x_cm, s.y_cm, s.rot_deg,
                s.bay_cm, s.level_cm, s.depth_cm, s.grid_origin,
                (s.shelves || []).map(function (sh) { return sh.id + ':' + sh.code; }).join(',')];
      })
    ]);
  }
  function stockSig(sections) {
    return JSON.stringify((sections || []).map(function (s) {
      return (s.shelves || []).map(function (sh) {
        return [sh.id, sh.qty, sh.product_id, sh.size_from, sh.size_to, sh.capacity,
                (sh.contents || []).map(function (c) { return c.sku + ':' + c.qty; }).join(',')];
      });
    }));
  }

  function busy() {
    if (typeof modalOpen === 'function' && modalOpen()) return true;
    var dr = document.getElementById('drawer-root');
    if (dr && dr.firstChild) return true;
    if (S.edit && canEdit()) return true;
    if (placing) return true;
    if (typeof ShelfRoom !== 'undefined' && ShelfRoom.ready() &&
        (ShelfRoom.dragging() || ShelfRoom.flying() || (ShelfRoom.handBusy && ShelfRoom.handBusy()))) return true;
    return false;
  }

  function liveApply() {
    var res = liveFresh;
    if (!res || !S.data) return;
    var sameLayout = layoutSig(res.sections, res.rooms) === layoutSig(S.data, S.rooms);
    if (sameLayout && stockSig(res.sections) === stockSig(S.data)) { liveFresh = null; return; }
    if (busy()) {
      /* the one change never taken for somebody laying the room out */
      if (!sameLayout && S.edit && canEdit()) liveLine(true);
      holdLive();
      return;
    }
    takeLive();
  }

  function takeLive() {
    var res = liveFresh;
    stopHold();
    liveLine(false);
    if (!res) return;
    liveFresh = null;
    S.data = res.sections || [];
    S.rooms = res.rooms || [];
    if (res.geometry) S.geometry = res.geometry;
    if (res.limits) S.limits = res.limits;
    settle();
    repaint();
  }

  /* Held, and looked at again while it waits — a check every 400 ms, never a
     frame. A layout change the person was told about waits for the button,
     or for the editor to close. */
  function holdLive() {
    if (liveHold) return;
    liveHold = setInterval(function () {
      if (!liveFresh) { stopHold(); return; }
      if (!busy()) takeLive();
    }, 400);
  }
  function stopHold() { if (liveHold) { clearInterval(liveHold); liveHold = null; } }

  function liveLineInner() {
    return '<span>' + esc(t('sm_live_changed')) + '</span>' +
      '<button class="btn btn-sm btn-ghost" data-sm="live-take">' + esc(t('sm_live_take')) + '</button>';
  }
  function liveLineHtml(id) {
    return '<div class="sm-liveline" id="' + id + '" role="status"' + (S.liveLine ? '' : ' hidden') + '>' +
      (S.liveLine ? liveLineInner() : '') + '</div>';
  }
  /* Written straight into its host, never through a repaint: it appears while
     somebody is laying the room out, and a repaint then is the thing it exists
     not to do. */
  function liveLine(on) {
    S.liveLine = !!on;
    ['smLive', 'smLiveFs'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.hidden = !on;
      el.innerHTML = on ? liveLineInner() : '';
    });
  }

  /* THE BACKSTOP. With the live line down — a browser without EventSource,
     a dropped connection — the map asks for itself every 45 s while it is on
     screen and the tab is visible. With the line up, it asks nothing. */
  function livePoll() {
    if (livePollT) return;
    livePollT = setInterval(function () {
      if (OG.view !== 'shelfmap' || !S.data || document.visibilityState === 'hidden') return;
      if (typeof Pulse !== 'undefined' && Pulse.isLive && Pulse.isLive()) return;
      liveFetch();
    }, LIVE_POLL_MS);
  }

  function current() {
    if (!S.data) return null;
    for (var i = 0; i < S.data.length; i++) {
      if (S.data[i].id === S.secId) return S.data[i];
    }
    return null;
  }

  function shelfById(id) {
    if (!S.data) return null;
    for (var i = 0; i < S.data.length; i++) {
      var list = S.data[i].shelves;
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === id) return { sec: S.data[i], sh: list[j] };
      }
    }
    return null;
  }

  function sectionById(id) {
    return (S.data || []).filter(function (s) { return s.id === id; })[0] || null;
  }
  function roomById(id) {
    return (S.rooms || []).filter(function (r) { return r.id === id; })[0] || null;
  }
  function racksIn(roomId) {
    return (S.data || []).filter(function (s) { return s.room_id === roomId; });
  }
  /* Racks not placed in any room — in one warehouse when a room is on
     screen (a rack cannot go into a room in the other building), otherwise
     everywhere. */
  function unplaced(whId) {
    return (S.data || []).filter(function (s) {
      return s.room_id == null && (!whId || s.wh_id === whId);
    });
  }

  /* Put a rack in focus and show the room it hangs in. The two are one
     decision: a scan that lands on a shelf in rack N must draw N's room,
     and a rack with no room is drawn on its own. */
  function focus(secId) {
    S.secId = secId;
    var s = sectionById(secId);
    S.roomId = s && s.room_id != null ? s.room_id : null;
  }

  /* After a load: keep the rack in focus if it still exists; otherwise the
     room being looked at; otherwise the first room, or the first rack when
     there are no rooms yet. Never invents a focus a person did not choose
     when a sensible one already exists. */
  function settle() {
    var sec = current();
    if (sec) { S.roomId = sec.room_id != null ? sec.room_id : null; return; }
    S.secId = null;
    if (S.roomId != null && !roomById(S.roomId)) S.roomId = null;
    if (S.roomId == null) S.roomId = S.rooms.length ? S.rooms[0].id : null;
    if (S.roomId != null) {
      var rs = racksIn(S.roomId);
      S.secId = rs.length ? rs[0].id : null;
    } else {
      S.secId = S.data.length ? S.data[0].id : null;
    }
  }

  function canEdit() { return allow('config.write'); }
  function canMove() { return allow('stock.move'); }

  /* -------------------------------------------------------------- sound
     Warehouse staff look at the shoe, not at the screen, so the answer has to
     arrive in the ear. Three tones, one oscillator each, no audio file and no
     library: a short high beep for accepted, a low buzz for refused, and a
     rising two-note chirp — deliberately unlike either — for the target
     changing, which is the one event that silently changes what the NEXT scan
     will do.

     SOUND IS NEVER THE ONLY SIGNAL. Every tone has a chip in the same colour
     landing in the strip at the bottom, because the shop is noisy, the tablet
     may be muted, and a person can be deaf. */
  var actx = null;

  function tone(freq, ms, type, delay, peak) {
    var t0 = actx.currentTime + (delay || 0);
    var osc = actx.createOscillator();
    var gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    /* Ramped, not switched: a square wave started and stopped at full gain
       clicks through a cheap tablet speaker louder than the tone itself. */
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak || 0.14, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    osc.connect(gain); gain.connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }

  function beep(kind) {
    if (!S.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!actx) actx = new Ctx();
      /* Browsers start the context suspended until a gesture. A scan through
         the keyboard wedge counts as one, but the resume is asynchronous, so
         this is attempted every time rather than once at startup. */
      if (actx.state === 'suspended' && actx.resume) actx.resume();

      if (kind === 'ok')        tone(880, 70, 'sine', 0, 0.15);
      else if (kind === 'bad')  tone(150, 260, 'square', 0, 0.11);
      else if (kind === 'shelf') { tone(620, 60, 'sine', 0, 0.13); tone(930, 70, 'sine', 0.07, 0.13); }
    } catch (e) { /* no audio on this machine; the chips still say everything */ }
  }

  /* Whether the map owns scans right now. The wedge dispatcher in
     js/app-boot.js checks this and stands aside, the same arrangement the
     label batch modal has — and a modal on top takes the scanner back,
     because a scan mid-dialog must not silently file stock. */
  function owns() {
    return OG.view === 'shelfmap' && !!S.data && !modalOpen();
  }

  /* ---------------------------------------------------------------- view */

  function view() {
    return '<div id="smRoot" class="sm-root">' + body() + '</div>';
  }

  function body() {
    if (S.err) {
      return '<div class="card"><div class="card-body"><div class="partner-note note-danger">' +
             esc(S.err) + '</div></div></div>';
    }
    if (!S.data) return '<div class="sm-empty muted">…</div>';
    if (!S.data.length && !S.rooms.length) {
      return '<div class="card"><div class="card-body">' +
        '<b>' + t('sm_no_rooms') + '</b>' +
        (canEdit()
          ? '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
            '<button class="btn btn-primary" data-sm="room-new">' + t('sm_new_room') + '</button>' +
            '<button class="btn" data-sm="rack-new">' + t('sm_new_rack') + '</button></div>'
          : '') +
        '</div></div>';
    }

    var sec = current();
    var room = S.roomId != null ? roomById(S.roomId) : null;
    var h = scanStrip() + topBar(sec) + liveLineHtml('smLive');
    if (!sec && !room) return h + chipStrip();

    /* ONE LAYOUT, TWO SURFACES. The designer sits beside whichever surface
       is drawn — never over it — so the room keeps its camera and the plan
       keeps its place while a rack is added. It used to be emitted only in
       the 3D arm, which meant the default view had no way to reach a second
       rack, add one, or place one: every one of those controls lived in a
       panel you could only open by first switching to the room. */
    var on = S.edit && canEdit();
    h += '<div class="sm-split' + (on ? ' with-designer' : '') + '">' +
         (use3d() ? roomStage() : flatStage(sec)) +
         (on ? designer() : '') +
         '</div>';

    if (sec) h += panel(sec);
    h += chipStrip();
    return h;
  }

  /* ---------------------------------------------------------- the 2D view
     The room from above, and under it the rack in focus seen straight on.
     Two drawings of one place: the plan says WHERE the rack is, the
     elevation says what is ON it. Neither is tilted — this is the surface
     somebody reads while holding a shoe. */
  function flatStage(sec) {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    var h = '<div class="sm-flat">';

    if (room) h += planStrip(room);

    if (!sec) {
      h += '<div class="sm-stage sm-flatstage"><div class="sm-empty muted">' +
           t('sm_no_racks') + '</div></div>';
    } else if (!sec.shelves.length) {
      h += emptyRack(sec);
    } else {
      h += stage(sec);
    }

    h += '<div class="sm-room-foot">' +
      roomLegend(racksOnScreen()) +
      (room && !room.width_cm
        ? '<span class="muted sm-dz-note">' + t('sm_not_to_scale') + '</span>' : '') +
      '<div class="sm-room-hint muted">' +
        (S.edit ? t('sm_no_renumber') : t('sm_flat_hint')) + '</div>' +
    '</div></div>';
    return h;
  }

  /* THE ROOM, FROM ABOVE. Every rack in the room as a bar on the wall it is
     actually on, the one in focus picked out — and clicking one is how a
     person moves between racks without opening the designer. Drawn as a
     grid rather than absolutely positioned: a wall is a row or a column of
     the plan, and a rack's place along it is a flex order. That keeps it
     honest at any width and needs no measured room to work.

     Not to scale, and it does not pretend to be: bars are sized by how many
     bays a rack has, relative to the other racks on the same wall. */
  function planStrip(room) {
    var racks = racksIn(room.id);
    var byWall = { n: [], e: [], s: [], w: [] }, loose = [], island = [];
    racks.forEach(function (r) {
      if (isFree(r)) island.push(r);
      else if (r.wall && byWall[r.wall]) byWall[r.wall].push(r); else loose.push(r);
    });
    var order = function (list) {
      return list.sort(function (a, b) { return (a.wall_cm || 0) - (b.wall_cm || 0); });
    };

    var bar = function (r, vertical) {
      var g = geometry(r);
      var bays = Math.max(1, g.maxCol);
      return '<button class="sm-pl-rack' + (sec3dFocus(r) ? ' on' : '') +
        (isFree(r) && vertical ? ' sm-pl-upright' : '') + '" ' +
        'data-sm="rack-focus" data-id="' + r.id + '" ' +
        'style="flex:' + bays + ' 1 0" ' +
        'title="' + esc(r.key + ' · ' + r.name + ' · ' + placeText(r) + ' · ' +
                        nf(bays) + ' ' + t('sm_bays')) + '">' +
        '<b>' + esc(r.key) + '</b>' +
        (vertical ? '' : '<small>' + esc(r.name) + '</small>') + '</button>';
    };

    var side = function (w, vertical) {
      var list = order(byWall[w]);
      return '<div class="sm-pl-wall sm-pl-' + w + '">' +
             list.map(function (r) { return bar(r, vertical); }).join('') + '</div>';
    };

    var h = '<div class="sm-plan" aria-label="' + esc(room.name) + '">' +
      '<div class="sm-pl-grid">' +
        side('n', false) +
        '<div class="sm-pl-mid">' + side('w', true) +
          /* a rack standing free is drawn on the floor of the plan, upright
             when it runs front to back */
          '<div class="sm-pl-floor">' +
            (island.length
              ? '<div class="sm-pl-island">' + island.map(function (r) {
                  return bar(r, r.rot_deg === 90 || r.rot_deg === 270);
                }).join('') + '</div>'
              : '<span>' + esc(room.name) + '</span>') +
          '</div>' +
          side('e', true) + '</div>' +
        side('s', false) +
      '</div>';

    /* A rack in the room but on no wall yet is still in the room — listed
       under the plan rather than dropped, because a rack nobody can see is
       a rack nobody will place. */
    if (loose.length) {
      h += '<div class="sm-pl-loose"><span class="muted">' + t('sm_not_placed') + '</span>' +
           loose.map(function (r) { return bar(r, false); }).join('') + '</div>';
    }
    return h + '</div>';
  }

  function sec3dFocus(r) { return S.secId === r.id; }

  /* ------------------------------------------------------------ the scan box
     One box, and it takes the focus back after every repaint. It is not what
     captures a scan — js/wedge.js does that at the document, whatever has
     focus — it is what makes the mode visible, and what lets somebody TYPE a
     code off a label whose barcode has been scuffed off a box. */
  function scanStrip() {
    var hit = S.sel == null ? null : shelfById(S.sel);
    var arm = hit && canMove();

    return '<div class="sm-scan no-print">' +
      '<div class="sm-scanbox' + (arm ? ' armed' : '') + '">' +
        '<input class="inp sm-scanin" id="smScan" type="text" autocomplete="off"' +
          ' spellcheck="false" dir="ltr"' +
          ' placeholder="' + esc(t('sm_scan_ph')) + '" data-smv="scan-enter">' +
      '</div>' +
      '<div class="sm-scanwhat">' +
        (arm
          ? '<b>' + esc(t('sm_target').replace('{code}', hit.sec.key + '-' + hit.sh.code)) + '</b>' +
            '<small class="muted">' + esc(t('sm_scan_hint')) + '</small>'
          : '<b class="muted">' + esc(t('sm_no_target')) + '</b>' +
            '<small class="muted">' + esc(t('sm_no_target_hint')) + '</small>') +
      '</div>' +
      '<button class="btn btn-ghost sm-sound' + (S.sound ? ' on' : '') + '" data-sm="sound"' +
        ' aria-pressed="' + (S.sound ? 'true' : 'false') + '"' +
        ' title="' + esc(t(S.sound ? 'sm_sound_on' : 'sm_sound_off')) + '">' +
        (S.sound ? soundIcon(true) : soundIcon(false)) +
        '<span>' + esc(t(S.sound ? 'sm_sound_on' : 'sm_sound_off')) + '</span>' +
      '</button>' +
    '</div>';
  }

  function soundIcon(on) {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M11 5 6 9H3v6h3l5 4z"/>' +
      (on ? '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
          : '<path d="M17 9l4 6M21 9l-4 6"/>') +
      '</svg>';
  }

  /* --------------------------------------------------------- the undo strip
     The last eight scans, newest first, each one removable by tapping it.
     This is what replaces the confirm dialog: instead of asking before every
     scan — which would halve the speed and need a mouse — it lets the run go
     at scanner pace and makes the last few reversible.

     The colour is the sound, written down: the same three states, so a muted
     tablet or a noisy room loses nothing. */
  function chipStrip() {
    if (!S.chips.length) return '';
    var shown = S.chips.slice(0, CHIPS_SHOWN);
    var h = '<div class="sm-chipstrip no-print"><span class="sm-chiplabel muted">' +
            esc(t('sm_last_scans')) + '</span>';
    shown.forEach(function (c) {
      h += '<button class="sm-undo ' + c.kind + '" data-sm="undo" data-id="' + c.id + '"' +
        ' title="' + esc(t('sm_undo_hint')) + '">' +
        '<b>' + esc(c.label) + '</b>' +
        (c.sub ? '<small>' + esc(c.sub) + '</small>' : '') +
        '<span class="sm-undo-x" aria-hidden="true">&times;</span>' +
        '</button>';
    });
    if (S.chips.length > CHIPS_SHOWN) {
      h += '<span class="sm-chipmore muted">+' + nf(S.chips.length - CHIPS_SHOWN) + '</span>';
    }
    h += '<button class="btn btn-ghost sm-chipclear" data-sm="chips-clear">' +
         esc(t('sm_clear_strip')) + '</button>';
    return h + '</div>';
  }

  function addChip(c) {
    c.id = ++S.seq;
    S.chips.unshift(c);
    /* The strip shows eight; the list keeps more so a tally survives a long
       run, but not without bound. */
    if (S.chips.length > 80) S.chips.length = 80;
  }

  function topBar(sec) {
    /* The room list (roomSelect, shared with the fullscreen strip), then
       the switches. */
    var h = '<div class="sm-top no-print">';
    h += roomSelect();

    h += '<div class="sm-topbtns">';

    /* THE SWITCH, ALWAYS DRAWN. Two views of one place, so one control with
       two states rather than two buttons — and the Room half is REFUSED
       rather than removed where the room cannot be shown, with the reason
       on it. The first version drew it only when the room was available, on
       the reasoning that a button that cannot work is a button that lies.
       That is right about the button and wrong about the screen: somebody
       who chose the room on the office computer and then opens the map on
       the warehouse tablet would get the plan, no toggle and no sentence,
       which reads as the app having forgotten them. An absence carries no
       explanation; a disabled button carries one. */
    var why = whyNoRoom();
    h += '<div class="sm-viewsw" role="group" aria-label="' + esc(t('sm_view')) + '">' +
      '<button class="sm-vw' + (use3d() ? '' : ' on') + '" data-sm="view-2d"' +
        ' aria-pressed="' + (use3d() ? 'false' : 'true') + '">' + t('sm_view_2d') + '</button>' +
      '<button class="sm-vw' + (use3d() ? ' on' : '') + '" data-sm="view-room"' +
        (why ? ' disabled title="' + esc(t(why)) + '"' : '') +
        ' aria-pressed="' + (use3d() ? 'true' : 'false') + '">' + t('sm_view_room') + '</button>' +
    '</div>';

    /* Colour belongs to both surfaces now — it is the same product, and the
       legend under either one is what makes it information. */
    h += '<button class="btn btn-ghost sm-colourbtn' + (S.colour ? ' on' : '') +
         '" data-sm="room-colour" aria-pressed="' + (S.colour ? 'true' : 'false') + '">' +
         t('sm_colour_by_type') + '</button>';

    /* Only the room has a camera to lose, or a screen to fill. */
    if (use3d()) h += camControls() + fullBtn();

    if (canEdit()) {
      h += '<button class="btn ' + (S.edit ? 'btn-primary' : '') + '" data-sm="edit">' +
           (S.edit ? t('sm_done') : t('sm_edit')) + '</button>';
    }
    h += '</div>';
    h += '</div>';

    /* No put-away line here: the scan box above the room selector already
       says what the next scan will do, and saying it twice on one screen
       makes a person read neither. */
    return h;
  }

  /* ---------------------------------------------------- which surface
     TWO VIEWS OF ONE PLACE, and the split below is between what a person
     ASKED for and what this machine can actually do.

     The 2D view — a plan of the room, and under it the rack in focus seen
     straight on — is the default and the working surface: it is where a
     put-away run happens, it needs no GPU, and it costs nothing to open.
     The room is the same data with the walls put back, for planning and for
     showing somebody.

     Everything else about the screen is common to both: the same colours,
     the same names, the same scan feedback, the same designer, the same
     panel. Switching views changes how it is drawn and nothing about what
     it says. */
  /* WHY the room cannot be drawn here — an i18n key, or '' when it can.
     Three reasons and three sentences, because "this machine has no WebGL"
     and "you asked for less motion" call for very different next actions,
     and one of them is a setting the person can change. */
  function whyNoRoom() {
    if (S.glDead) return 'sm_gl_lost';
    if (typeof ShelfRoom === 'undefined' || !ShelfRoom.supported()) return 'sm_no_webgl';
    if (typeof Motion !== 'undefined' && Motion.reduced && Motion.reduced()) return 'sm_room_off_motion';
    return '';
  }

  function can3d() { return !whyNoRoom(); }

  function use3d() { return S.view === 'room' && can3d(); }

  /* THE CANVAS IS NOT IN THIS STRING, AND THAT IS THE WHOLE POINT. Every
     scan is a repaint and a repaint is root.innerHTML = body(); a <canvas>
     written here would lose its WebGL context on every barcode of the run.
     ShelfRoom owns the canvas and puts it into this mount after each paint
     (mount3d, below) — the same reason the tilt slider writes --sm-tilt
     straight to the DOM instead of repainting. */
  /* The racks the room draws: every rack hanging in the room on screen, or
     the one rack in focus when it hangs nowhere yet. */
  function racksOnScreen() {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    if (room) return racksIn(room.id);
    var sec = current();
    return sec ? [sec] : [];
  }

  function roomStage() {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    /* WHILE FULLSCREEN THE STAGE IS A PLACEHOLDER. The canvas wrapper is out
       on <body>; this mount exists so the layout keeps its shape and so
       leaving fullscreen has somewhere to come back to. mount3d() attaches
       nothing into it while S.fs is set. */
    return '<div class="sm-stage sm-stage3d no-print">' +
      '<div class="sm-room' + (S.fs ? ' sm-room-away' : '') + '" id="smRoom">' +
        (S.fs
          ? '<div class="sm-room-wait muted">' + t('sm_room_is_full') + '</div>'
          : '<div class="sm-room-wait muted">' + t('sm_room_loading') + '</div>') +
      '</div>' +
      '<div class="sm-room-foot">' +
        roomLegend(racksOnScreen()) +
        /* Said on the flat surface, not in the room: a wall that is where the
           racks need it rather than where a tape measure put it is a fact a
           person planning a delivery should have. */
        (room && !room.width_cm
          ? '<span class="muted sm-dz-note">' + t('sm_not_to_scale') + '</span>' : '') +
        /* What is drawn running past its wall. Filled in by ShelfRoom's fit
           hook rather than by this string, because the answer is only known
           once the room has been built. */
        '<div class="sm-fit" id="smFit" hidden></div>' +
        qualityPick() +
        '<div class="sm-room-hint muted">' + roomHint() + '</div>' +
      '</div>' +
    '</div>';
  }

  function roomHint() {
    if (S.edit && canEdit()) return t('sm_room_edit_hint');
    if (S.cam === 'walk') return t(showPads() ? 'sm_walk_hint_touch' : 'sm_walk_hint');
    return t('sm_room_hint');
  }

  /* The two tiers, and auto. A machine that dropped itself shows 'low'
     with the reason beside it. */
  function qualityPick() {
    return '<label class="field sm-quality"><span>' + t('sm_quality') + '</span>' +
      '<select class="inp" data-smv="quality">' +
      ['auto', 'high', 'low'].map(function (q) {
        return '<option value="' + q + '"' + (S.quality === q ? ' selected' : '') + '>' +
               esc(t('sm_quality_' + q)) + '</option>';
      }).join('') + '</select></label>';
  }

  /* Pads are for fingers. Shown on a coarse pointer unless switched off,
     and on any pointer when switched on. */
  function showPads() {
    if (S.cam !== 'walk') return false;
    if (S.pads != null) return S.pads;
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
    catch (e) { return false; }
  }

  /* The camera group: orbit or walk, and the four canned views. Drawn in
     the top bar and again in the fullscreen strip, from one function so
     the two can never disagree about which button does what. */
  function camControls() {
    var walk = S.cam === 'walk';
    return '<div class="sm-camsw" role="group" aria-label="' + esc(t('sm_cam')) + '">' +
        '<button class="sm-vw' + (walk ? '' : ' on') + '" data-sm="cam-orbit" aria-pressed="' + (walk ? 'false' : 'true') + '">' +
          t('sm_cam_orbit') + '</button>' +
        '<button class="sm-vw' + (walk ? ' on' : '') + '" data-sm="cam-walk" aria-pressed="' + (walk ? 'true' : 'false') + '">' +
          t('sm_cam_walk') + '</button>' +
      '</div>' +
      '<div class="sm-views" role="group">' +
        '<button class="btn btn-ghost btn-sm" data-sm="room-fit" title="' + esc(t('sm_fit_view')) + '">' + t('sm_fit_view') + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-sm="room-top" title="' + esc(t('sm_top_view')) + '">' + t('sm_top_view') + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-sm="room-front" title="' + esc(t('sm_front_view')) + '">' + t('sm_front_view') + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-sm="room-reset" title="' + esc(t('sm_reset_view')) + '">' + t('sm_reset_view') + '</button>' +
      '</div>' +
      (walk
        ? '<button class="btn btn-ghost btn-sm sm-padbtn' + (showPads() ? ' on' : '') + '" data-sm="pad-toggle"' +
          ' aria-pressed="' + (showPads() ? 'true' : 'false') + '">' + t('sm_pad_toggle') + '</button>'
        : '');
  }

  function fullBtn() {
    return '<button class="btn btn-ghost btn-sm sm-fullbtn" data-sm="room-full" aria-pressed="' +
      (S.fs ? 'true' : 'false') + '">' + fullIcon() + '<span>' +
      t(S.fs ? 'sm_exit_fullscreen' : 'sm_fullscreen') + '</span></button>';
  }

  function fullIcon() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (S.fs
        ? '<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>'
        : '<path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"/>') +
      '</svg>';
  }

  /* The key to the colours, on the flat surface under the room — mandatory
     whenever the colours are on, because eight dark colours are not all
     telling apart at crate size and a colour without a key is decoration.
     Only the types actually on screen, in the order they first appear, so
     a room of sneakers does not carry a legend about jackets. */
  function roomLegend(racks) {
    if (!S.colour) return '';
    var seen = {}, order = [];
    racks.forEach(function (sec) {
      sec.shelves.forEach(function (sh) {
        var ids = [];
        if (sh.product_id != null) ids.push(sh.product_id);
        (sh.contents || []).forEach(function (c) { ids.push(c.product_id); });
        ids.forEach(function (pid) {
          var p = DB.product(pid);
          if (p && !seen[p.type]) { seen[p.type] = 1; order.push(p.type); }
        });
      });
    });
    if (!order.length) return '';
    return '<div class="sm-legend">' + order.map(function (ty) {
      return '<span class="sm-lg"><i style="background:' + esc(DB.typeColour(ty)) + '"></i>' +
             esc(typeLabel(ty)) + '</span>';
    }).join('') + '</div>';
  }

  /* A type's name in the current language. The catalogue's own labels are
     English only; the Arabic ones live in I18N as ty_*, and a type the shop
     invents later falls back to its English label rather than to a key. */
  function typeLabel(ty) {
    var k = 'ty_' + ty, s = t(k);
    return s === k ? ((DB.typeLabels && DB.typeLabels[ty]) || ty) : s;
  }

  /* The plain model the room is drawn from. No DB, no t(), no esc() cross
     this line — text goes in as strings and comes out through textContent,
     so the room can never disagree with the flat panel about what exists.
     Columns are mirrored for grid_origin HERE, so the room, the flat rack
     and the label printer agree on which side column 1 is. */
  function roomModel() {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    return {
      roomId: room ? room.id : null,
      name: room ? room.name : '',
      /* centimetres on the tape, metres in the room — one bay is about a
         metre, and NULL stays NULL: an unmeasured room is sized to its racks */
      w: room && room.width_cm ? room.width_cm / 100 : null,
      d: room && room.depth_cm ? room.depth_cm / 100 : null,
      h: room && room.height_cm ? room.height_cm / 100 : null,
      sel: S.sel,
      /* the rack whose grips show — only while the layout editor is open, and
         not part of the room's signature: moving the focus moves two grips */
      focus: S.edit && canEdit() ? S.secId : null,
      /* Words the room paints onto its own floor. Strings in, like names —
         and part of the room's signature, so a change of language repaints
         the floor rather than leaving English under an Arabic screen. */
      words: { front: t('sm_front_area') },
      /* the narrowest aisle a free-standing rack may leave, the server's
         number in metres — the drag previews it; the server still decides */
      aisle: S.limits && S.limits.aisle_min_cm != null ? S.limits.aisle_min_cm / 100 : null,
      racks: racksOnScreen().map(function (sec) {
        var g = geometry(sec);
        var sz = rackSize(sec);
        return {
          id: sec.id, key: sec.key, name: sec.name,
          /* on a wall, or standing free on the floor (051) — never both */
          placement: room && isFree(sec) ? 'free' : 'wall',
          wall: room && !isFree(sec) ? (sec.wall || null) : null,
          /* centimetres along the wall on the server, metres in the room */
          at: room && sec.wall && !isFree(sec) ? (sec.wall_cm || 0) / 100 : 0,
          /* on the floor: its middle from the left and front walls, metres,
             and its quarter turn */
          fx: room && isFree(sec) ? sec.x_cm / 100 : null,
          fy: room && isFree(sec) ? sec.y_cm / 100 : null,
          rot: room && isFree(sec) ? sec.rot_deg : 0,
          bay: sz.bay / 100, level: sz.level / 100, depth: sz.depth / 100,
          cols: Math.max(1, g.maxCol), rows: Math.max(1, g.rows), origin: sec.grid_origin,
          bays: sec.shelves.map(function (sh) { return bayModel(sec, g, sh); })
        };
      })
    };
  }

  /* A rack's size in centimetres, defaults applied: what the server sends
     as `size`, or worked out here from the geometry for a rack the list
     has not been refetched for yet. */
  function rackSize(sec) {
    if (sec.size) return sec.size;
    var g = S.geometry || { bay_cm: 114, level_cm: 46, depth_cm: 95 };
    var cols = Math.max(1, geometry(sec).maxCol);
    var bay = sec.bay_cm || g.bay_cm;
    return { bay: bay, level: sec.level_cm || g.level_cm, depth: sec.depth_cm || g.depth_cm,
             cols: cols, width: cols * bay };
  }

  function bayModel(sec, g, sh) {
    /* Two products can matter to one bay: the one it is ASSIGNED to
       (shelves.product_id) and the one actually sitting on it (contents,
       which an unassigned bay can carry — foreign stock). The crate is
       coloured by what is on it; the board is tinted by what it is for;
       the name is whichever exists, owner first. */
    var owner = sh.product_id != null ? DB.product(sh.product_id) : null;
    var held = sh.contents && sh.contents.length ? DB.product(sh.contents[0].product_id) : null;
    var p = owner || held;
    var onIt = held || (sh.qty > 0 ? owner : null);
    return {
      id: sh.id,
      code: sh.code,
      full: sec.key + '-' + sh.code,
      row: Math.max(0, g.levels.indexOf(sh.row_label)),
      col: sec.grid_origin === 'right' ? (g.maxCol - sh.col_index + 1) : sh.col_index,
      qty: sh.qty,
      capacity: sh.capacity,
      pid: p ? p.id : null,
      name: sh.product_name || (p ? p.name : ''),
      fill: S.colour && onIt ? DB.typeColour(onIt.type) : null,
      mark: S.colour && owner ? DB.typeColour(owner.type) : null,
      /* its column and level as the server numbers them, for a rack grown or
         shrunk by its grips */
      ci: sh.col_index, rl: sh.row_label,
      /* What is on it, product by product, most first, each with the
         product's own photograph when the shop has taken one — the room puts
         it on the boxes (Stage C). None taken: no picture, a kraft box. */
      items: itemsOf(sh)
    };
  }

  function itemsOf(sh) {
    var by = {}, order = [];
    (sh.contents || []).forEach(function (c) {
      if (!by[c.product_id]) { by[c.product_id] = { pid: c.product_id, qty: 0, img: null }; order.push(by[c.product_id]); }
      by[c.product_id].qty += c.qty || 0;
    });
    order.forEach(function (it) {
      var p = DB.product(it.pid);
      it.img = p && p.image && p.image.src ? p.image.src : null;
    });
    return order.sort(function (a, b) { return b.qty - a.qty || a.pid - b.pid; });
  }

  /* Put the canvas into the mount the last paint emitted, and hand the room
     the current model. Called after every repaint and from after(). Safe to
     call when there is no mount (flat mode) and safe to call twice. */
  function mount3d() {
    if (!use3d()) return;
    if (!document.getElementById('smRoom')) return;
    ShelfRoom.ensure(function (ok) {
      if (!ok) { glFail(t('sm_no_webgl')); return; }
      /* the screen may have moved on while the library was downloading */
      var m = document.getElementById('smRoom');
      if (!m) return;
      ShelfRoom.attach(m);
      /* The standard rack, before anything is drawn from it. */
      if (S.geometry) ShelfRoom.setGeometry(S.geometry);
      if (S.quality !== 'auto') ShelfRoom.setQuality(S.quality);
      /* Racks can only be picked up while the layout editor is open, and
         only by somebody allowed to change the layout. The server checks it
         again on the way in; this decides whether the hand does anything. */
      ShelfRoom.setEdit(S.edit && canEdit());
      /* an empty room is still a room — its walls are what the designer is
         about to hang racks on */
      var sec = current();
      if (S.roomId != null || (sec && sec.shelves.length)) ShelfRoom.sync(roomModel());
      ShelfRoom.setMode(S.cam);
      if (wantIntro) { wantIntro = false; ShelfRoom.intro(S.secId); }
      paintOverlay();
    });
  }

  /* ---------------------------------------------------------- the overlay
     THE ONLY DOM THIS FILE WRITES INSIDE THE CANVAS WRAPPER. Normally it
     holds the walk pads and nothing else; fullscreen puts the controls a
     person needs while the rest of the screen is gone into it — the room
     selector, the camera group, the exit button along the top, and the
     scan target, the undo strip, the sound toggle, the legend and the
     overflow note along the bottom. Every id here that mirrors one on the
     page is suffixed Fs so the two never collide; the handlers read
     whichever exists. */
  function paintOverlay() {
    if (typeof ShelfRoom === 'undefined' || !ShelfRoom.ready()) return;
    var host = ShelfRoom.overlayHost();
    if (!host) return;
    var h = '';
    if (S.fs) {
      var room = S.roomId != null ? roomById(S.roomId) : null;
      var hit = S.sel == null ? null : shelfById(S.sel);
      var arm = hit && canMove();
      h += '<div class="sm-ov-top">' +
        roomSelect() +
        '<div class="sm-topbtns">' + camControls() +
          (canEdit() ? '<button class="btn btn-sm ' + (S.edit ? 'btn-primary' : '') + '" data-sm="edit">' +
                       (S.edit ? t('sm_done') : t('sm_edit')) + '</button>' : '') +
          fullBtn() +
        '</div>' + liveLineHtml('smLiveFs') + '</div>';
      h += '<div class="sm-ov-bottom">' +
        '<div class="sm-scanbox' + (arm ? ' armed' : '') + '">' +
          '<input class="inp sm-scanin" id="smScanFs" type="text" autocomplete="off"' +
            ' spellcheck="false" dir="ltr" placeholder="' + esc(t('sm_scan_ph')) + '"></div>' +
        '<div class="sm-scanwhat">' +
          (arm
            ? '<b>' + esc(t('sm_target').replace('{code}', hit.sec.key + '-' + hit.sh.code)) + '</b>'
            : '<b class="muted">' + esc(t('sm_no_target')) + '</b>') +
          '<div class="sm-fit" id="smFitFs" hidden></div>' +
        '</div>' +
        '<button class="btn btn-ghost btn-sm sm-sound' + (S.sound ? ' on' : '') + '" data-sm="sound"' +
          ' aria-pressed="' + (S.sound ? 'true' : 'false') + '">' + soundIcon(S.sound) + '</button>' +
        roomLegend(racksOnScreen()) +
        (room && !room.width_cm ? '<span class="muted sm-dz-note">' + t('sm_not_to_scale') + '</span>' : '') +
        chipStrip() +
      '</div>';
    }
    if (showPads()) {
      h += '<div class="sm-pads" dir="ltr">' +
        '<div class="sm-pad-move">' +
          '<button class="sm-pad" data-walk="fwd" aria-label="' + esc(t('sm_pad_fwd')) + '">▲</button>' +
          '<div class="sm-pad-row">' +
            '<button class="sm-pad" data-walk="left" aria-label="' + esc(t('sm_pad_left')) + '">◀</button>' +
            '<button class="sm-pad" data-walk="back" aria-label="' + esc(t('sm_pad_back')) + '">▼</button>' +
            '<button class="sm-pad" data-walk="right" aria-label="' + esc(t('sm_pad_right')) + '">▶</button>' +
          '</div></div>' +
        '<div class="sm-look" data-look="1" aria-label="' + esc(t('sm_pad_look')) + '"><span>' + esc(t('sm_pad_look')) + '</span></div>' +
      '</div>';
    }
    host.innerHTML = h;
    if (S.fs) { paintFit(lastFit); keepFocus(); }
  }

  /* The room selector, shared by the top bar and the fullscreen strip. One
     list, two kinds of entry: the rooms, then any rack not yet in a room —
     drawn on its own until somebody places it. A rack IN a room is reached
     through the room, never listed twice. The warehouse is named only when
     more than one actually has rooms — "M · المستودع" is noise while there
     is one building. */
  function roomSelect() {
    /* ONE CHOICE, NO SWITCHER. A select with a single option is clutter that
       teaches nobody anything. It comes back the moment there is a second
       room — or a rack standing in none, which this same list is how anybody
       reaches. Counted at render: rooms stay fully supported, and opening a
       second warehouse needs no change here. */
    if (S.rooms.length + unplaced(null).length <= 1) return '';
    var whs = {};
    S.data.forEach(function (s) { whs[s.wh_id] = 1; });
    S.rooms.forEach(function (r) { whs[r.wh_id] = 1; });
    var manyWh = Object.keys(whs).length > 1;
    var whOf = function (id) { return manyWh ? ' — ' + DB.whName(id, OG.lang === 'ar') : ''; };
    var h = '<label class="field sm-roomsel"><span>' + t('sm_room') + '</span>' +
            '<select class="inp" data-smv="room">';
    S.rooms.forEach(function (r) {
      var on = S.roomId === r.id;
      h += '<option value="r:' + r.id + '"' + (on ? ' selected' : '') + '>' +
           esc(r.name + whOf(r.wh_id)) + '</option>';
    });
    unplaced(null).forEach(function (s) {
      var on = S.roomId == null && S.secId === s.id;
      h += '<option value="s:' + s.id + '"' + (on ? ' selected' : '') + '>' +
           esc(s.key + ' · ' + s.name + ' — ' + t('sm_not_placed') + whOf(s.wh_id)) + '</option>';
    });
    return h + '</select></label>';
  }

  var lastFit = null;

  /* Set when somebody asks for the room, spent by mount3d once it is there. */
  var wantIntro = false;

  /* ---------------------------------------------------------- the readout
     A rack in the air needs a caption: which wall it will land on, which
     bays it will take, and — where it cannot go — why not. It rides on
     <body> for the same reason the peek card does: the room repaints under
     it, and a node inside #smRoot would be destroyed mid-drag. */

  var hudEl = null;

  function hudNode() {
    if (!hudEl || !hudEl.isConnected) {
      hudEl = document.createElement('div');
      hudEl.className = 'sm-hud';
      hudEl.hidden = true;
      document.body.appendChild(hudEl);
    }
    return hudEl;
  }

  function hideHud() { if (hudEl) hudEl.hidden = true; }

  var cmOf = function (m) { return nf(Math.round(m * 100)); };

  /* A grip in the air: how many, and how near the nearest thing is — or why
     not, before the hand lets go. */
  function nearWords(n) { return !n ? '' : n.wall ? t('sm_the_wall_' + n.wall) : (n.name || n.key || ''); }
  function growWords(info) {
    var s = t(info.grow === 'bays' ? 'sm_grow_bays' : 'sm_grow_levels').replace('{n}', ltrN(nf(info.n)));
    var why = '';
    if (info.why === 'occupied') {
      why = info.occupied.map(function (o) {
        return info.grow === 'bays'
          ? t('sm_err_bay_occupied').replace('{b}', ltrN(nf(o.at))).replace('{n}', ltrN(nf(o.n)))
          : t('sm_err_level_occupied').replace('{l}', ltrN(o.at)).replace('{n}', ltrN(nf(o.n)));
      }).join(' ');
    } else if (info.why === 'ceiling') {
      why = t('sm_grow_ceiling').replace('{h}', ltrN(cmOf(info.h))).replace('{r}', ltrN(cmOf(info.r)));
    } else if (info.why === 'wall') {
      why = t('sm_grow_wall').replace('{w}', t('sm_the_wall_' + info.wall));
    } else if (info.why === 'through') {
      why = t('sm_drag_through').replace('{w}', t('sm_the_wall_' + info.through));
    } else if (info.why === 'unmeasured') {
      why = t('sm_err_free_unmeasured');
    } else if (info.why === 'overlap') {
      why = t('sm_drag_overlap').replace('{n}', nearWords(info.near));
    } else if (info.why === 'aisle') {
      why = t('sm_err_aisle').replace('{g}', ltrN(cmOf(info.gap))).replace('{n}', nearWords(info.near))
        .replace('{m}', ltrN(cmOf(info.need)));
    } else if (info.gap != null && isFinite(info.gap) && info.near) {
      why = t('sm_grow_near').replace('{g}', ltrN(cmOf(info.gap))).replace('{n}', nearWords(info.near));
    }
    return why ? s + ' · ' + why : s;
  }

  function dragWords(info) {
    if (info.kind === 'grow') return growWords(info);
    /* A wall being pulled reports BOTH measurements, always. They are stored
       as a pair and saved as a pair, so showing only the one under the hand
       would hide half of what is about to be written down. And what the pull
       would do to the racks — narrowed to what, or refused — is said before
       the hand lets go, not after. */
    if (info.kind === 'room') {
      var s = t('sm_room_size')
        .replace('{w}', nf(info.w.toFixed(2)))
        .replace('{d}', nf(info.d.toFixed(2)));
      (info.shrunk || []).forEach(function (x) {
        s += ' · ' + t('sm_shrink_preview').replace('{k}', x.key).replace('{n}', cmOf(x.to));
      });
      (info.stuck || []).forEach(function (x) {
        s += ' · ' + t('sm_err_room_too_small_short').replace('{k}', x.key).replace('{n}', cmOf(x.need));
      });
      return s;
    }
    /* A free-standing rack in the air says what is nearest and how far, so
       the aisle rule is visible coming; where it cannot go, why. */
    if (info.kind === 'free') {
      var nearName = !info.near ? '' : info.near.wall ? t('sm_the_wall_' + info.near.wall)
                                 : (info.near.name || info.near.key || '');
      if (info.why === 'unmeasured') return t('sm_err_free_unmeasured');
      if (info.why === 'through') return t('sm_drag_through').replace('{w}', t('sm_the_wall_' + info.through));
      if (info.why === 'overlap') return t('sm_drag_overlap').replace('{n}', nearName);
      if (info.why === 'aisle') {
        return t('sm_err_aisle').replace('{g}', ltrN(cmOf(info.gap))).replace('{n}', nearName)
          .replace('{m}', ltrN(cmOf(info.need)));
      }
      return t('sm_drag_free').replace('{r}', ltrN(info.rot)).replace('{g}', ltrN(cmOf(info.gap)))
        .replace('{n}', nearName) + ' · ' + t('sm_drag_rotate');
    }
    if (info.ok && info.wall) {
      var span = t('sm_drag_span_cm')
        .replace('{a}', cmOf(info.at)).replace('{b}', cmOf(info.at + info.width));
      return t('sm_wall_' + info.wall) + ' · ' + span +
             (info.why === 'slid' ? ' · ' + t(info.corner ? 'sm_drag_corner' : 'sm_drag_slid') : '');
    }
    if (info.ok) return t('sm_drag_floor');
    if (info.why === 'short') {
      return t('sm_drag_short_cm').replace('{n}', cmOf(info.have)).replace('{w}', cmOf(info.width));
    }
    if (info.why === 'full') {
      return info.by ? t('sm_drag_full').replace('{k}', info.by) : t('sm_drag_nofit');
    }
    return t('sm_drag_out');
  }

  function showHud(info, x, y) {
    if (!info) { hideHud(); return; }
    var el = hudNode();
    el.className = 'sm-hud' + (info.ok ? '' : ' no');
    el.textContent = dragWords(info);
    el.hidden = false;
    var w = el.offsetWidth, ht = el.offsetHeight;
    var lx = x + 16, ly = y + 18;
    if (lx + w > window.innerWidth - 8) lx = x - w - 16;
    if (ly + ht > window.innerHeight - 8) ly = y - ht - 16;
    el.style.transform = 'translate3d(' + Math.max(8, lx) + 'px,' + Math.max(8, ly) + 'px,0)';
  }

  /* What the room could not fit, written straight into the foot. NOT a
     repaint: this fires from inside ShelfRoom.sync, which is itself called
     from inside repaint, and a repaint here would eat its own tail. */
  function paintFit(list) {
    lastFit = list;
    ['smFit', 'smFitFs'].forEach(function (id) {
      var host = document.getElementById(id);
      if (!host) return;
      if (!list || !list.length) { host.innerHTML = ''; host.hidden = true; return; }
      host.hidden = false;
      host.innerHTML = list.map(function (o) {
        return esc(t('sm_overflow'))
          .replace('{k}', '<b dir="ltr">' + esc(o.key) + '</b>')
          .replace('{w}', esc(t('sm_wall_' + o.wall)))
          .replace('{m}', '<span dir="ltr">' + nf(Math.round(o.over * 100)) + '</span>');
      }).join(' · ');
    });
  }

  /* A refusal from the layout routes, in the person's language. The server's
     sentence is English; its `code` and the numbers riding on it are what
     the Arabic is built from. Anything unmapped falls back to the sentence. */
  function layoutError(err, kind) {
    var d = err && err.detail ? err.detail : (err || {});
    var code = d.code || err.code;
    /* Stage C: a level through the ceiling, a ceiling lowered onto a rack,
       and a bay or a level with stock on it — named, with the count, so the
       person knows what to go and empty. Never emptied for them. */
    if (code === 'rack_too_tall') {
      return t('sm_err_too_tall').replace('{k}', d.rack || '?').replace('{h}', ltrN(nf(d.height_cm || 0)))
        .replace('{r}', ltrN(nf(d.room_height_cm || 0))).replace('{m}', ltrN(nf(d.max_levels || 0)));
    }
    if (code === 'room_too_low') {
      var tall = (d.racks || []).map(function (r) { return r.key; }).join(', ');
      return t('sm_err_room_too_low').replace('{k}', tall || '?').replace('{h}', ltrN(nf(d.min_height_cm || 0)));
    }
    if (code === 'shelf_occupied' && (d.bays || d.levels)) {
      var byLevel = kind === 'rows' || (kind !== 'cols' && !d.bays);
      return (byLevel ? d.levels : d.bays).map(function (o) {
        return byLevel
          ? t('sm_err_level_occupied').replace('{l}', ltrN(o.row)).replace('{n}', ltrN(nf(o.pieces)))
          : t('sm_err_bay_occupied').replace('{b}', ltrN(nf(o.col))).replace('{n}', ltrN(nf(o.pieces)));
      }).join(' ');
    }
    if (code === 'wall_overlap') {
      return t(d.corner ? 'sm_err_wall_corner' : 'sm_err_wall_overlap')
        .replace('{k}', d.rack || '?')
        .replace('{a}', nf(d.from || 0)).replace('{b}', nf(d.to || 0));
    }
    if (code === 'wall_short') {
      return t('sm_err_wall_short').replace('{k}', d.rack || '?')
        .replace('{w}', nf(d.need || 0)).replace('{n}', nf(d.have || 0));
    }
    if (code === 'room_too_small') {
      var names = (d.racks || []).map(function (r) { return r.key; })
        .filter(function (k, i, a) { return a.indexOf(k) === i; }).join(', ');
      return t('sm_err_room_too_small').replace('{k}', names || '?')
        .replace('{w}', nf(d.min_width_cm || 0)).replace('{d}', nf(d.min_depth_cm || 0));
    }
    /* 051 — the free-standing rack's refusals, each naming what is in the
       way and, for the aisle, the gap and what it needs */
    if (code === 'rack_overlap') {
      return t('sm_err_overlap').replace('{k}', d.of || '?').replace('{n}', d.name || d.rack || '?');
    }
    if (code === 'aisle_narrow') {
      return t('sm_err_aisle').replace('{g}', ltrN(nf(d.gap || 0))).replace('{m}', ltrN(nf(d.need || 0)))
        .replace('{n}', d.to === 'wall' ? t('sm_the_wall_' + d.wall) : (d.name || d.rack || '?'));
    }
    if (code === 'outside_room') {
      return t('sm_err_through').replace('{k}', d.rack || '?').replace('{w}', t('sm_the_wall_' + d.wall));
    }
    if (code === 'free_unmeasured') return t('sm_err_free_unmeasured');
    if (code === 'bad_rotation') return t('sm_err_rotation');
    if (code === 'bad_placement') return t('sm_err_placement');
    return API.friendly(err);
  }

  /* THE DROP IS THE SAVE. Placement is patched as a unit — room, wall and
     position in one body — because the server reads an omitted one as
     "clear it", and a rack keeping the wall position of the room it just
     left is a rack standing inside a wall. A refusal is not corrected here:
     the reload puts the server's truth back and the toast says which rule
     it was. `at` arrives in metres from the room and leaves in centimetres. */
  function placeRack(id, wall, at) {
    /* A free-standing rack lets go of a place on the floor — { x, y, rot },
       metres from the left and front walls — and is saved as one: it stays
       free, whatever wall it was dropped near. */
    var body = wall === 'free'
      ? { roomId: S.roomId, placement: 'free', xCm: Math.round(at.x * 100), yCm: Math.round(at.y * 100), rotDeg: at.rot }
      : { roomId: S.roomId, placement: 'wall', wall: wall || null, wallCm: wall ? Math.round(at * 100) : null };
    API.patch('/api/sections/' + id, body).then(function () {
      focus(id);
      reload();
    }).catch(function (err) {
      toast(layoutError(err), '', 'warn', 6000);
      reload();
    });
  }

  /* A wall was let go. Width and depth go together because the server
     refuses one without the other — a room is measured across and deep, or
     it is not measured. Height is left exactly as it was; it is typed in
     Room settings and a pull along the floor says nothing about it.

     The answer may carry `shrunk`: the racks the server narrowed to keep
     them on their walls. Said out loud, because a bay that quietly got 20 cm
     narrower is a bay somebody will measure a box against. */
  function sizeRoom(w, d) {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    if (!room) return;
    API.patch('/api/rooms/' + room.id, {
      widthCm: Math.round(w * 100),
      depthCm: Math.round(d * 100)
    }).then(function (res) {
      sayShrunk(res && res.room ? res.room.shrunk : null);
      reload();
    }).catch(function (err) {
      toast(layoutError(err), '', 'warn', 7000);
      reload();
    });
  }

  function sayShrunk(list) {
    if (!list || !list.length) return;
    toast(t('sm_shrunk'), list.map(function (s) {
      return t('sm_shrink_preview').replace('{k}', s.key).replace('{n}', nf(s.to));
    }).join(' · '), '', 7000);
  }

  /* ------------------------------------------------------------ designer
     Beside the room, never over it. Every button here hits the same route
     the flat editor hit, and the room redraws from the answer — the camera
     stays where it was and the scan box keeps the caret. */
  function designer() {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    var sec = current();
    var h = '<aside class="card sm-designer no-print"><div class="card-head"><h3>' +
            t('sm_design') + '</h3></div><div class="card-body">';

    /* the room */
    h += '<div class="sm-dz"><span class="lbl">' + t('sm_room') + '</span>';
    if (room) {
      h += '<div class="sm-dz-row"><span class="sm-dz-pick" style="cursor:default"><b>' + esc(room.name) + '</b>' +
           (room.width_cm ? '' : '<small class="muted">' + t('sm_not_to_scale') + '</small>') + '</span>' +
           '<button class="btn btn-sm btn-ghost" data-sm="room-cfg" data-id="' + room.id + '">' +
           t('sm_room_settings') + '</button></div>';
    } else {
      h += '<div class="muted sm-dz-note">' + t(S.rooms.length ? 'sm_not_placed' : 'sm_racks_first') + '</div>';
    }
    h += '<div class="sm-dz-row"><button class="btn btn-sm btn-ghost" data-sm="room-new">+ ' +
         t('sm_new_room') + '</button>' +
         /* PLACE MY RACKS: every rack in this building with shelves and no
            room, along two facing walls of this one. Offered, never done on
            its own — 026 says why a location nobody chose is worse than an
            admitted gap — and shown as a plan before a single PATCH goes. */
         (room && fillable(room).length
           ? '<button class="btn btn-sm" data-sm="room-fill">' + t('sm_fill_racks') + '</button>'
           : '') +
         '</div></div>';

    /* the racks hanging in it */
    if (room) {
      var rs = racksIn(room.id);
      h += '<div class="sm-dz"><span class="lbl">' + t('sm_racks_here') + '</span>';
      if (!rs.length) h += '<div class="muted sm-dz-note">' + t('sm_no_racks') + '</div>';
      rs.forEach(function (r) {
        h += '<div class="sm-dz-row' + (sec && sec.id === r.id ? ' on' : '') + '">' +
          '<button class="sm-dz-pick" data-sm="rack-focus" data-id="' + r.id + '"' + dragAttrs(r) +
          '><b>' + esc(r.key) + '</b> · ' +
          esc(r.name) + '<small class="muted">' + placeHtml(r) + '</small></button>' +
          /* THE ON-SCREEN TURN. R turns a rack in the air; a touch screen has
             no R, so a free-standing rack's row carries the same quarter
             turn as a button, saved on the press. */
          (isFree(r)
            ? '<button class="btn btn-sm btn-ghost" data-sm="rack-rot" data-id="' + r.id + '" title="' +
              esc(t('sm_rotate')) + '" aria-label="' + esc(t('sm_rotate')) + '">⟳</button>'
            : '') +
          '<button class="btn btn-sm btn-ghost" data-sm="rack-cfg" data-id="' + r.id + '">' +
          t('sm_rack_cfg') + '</button></div>';
      });
      h += '</div>';
    }

    /* racks nowhere yet — placing one is the whole reason this panel exists */
    var un = unplaced(room ? room.wh_id : null);
    if (un.length) {
      h += '<div class="sm-dz"><span class="lbl">' + t('sm_not_placed') + '</span>';
      un.forEach(function (r) {
        h += '<div class="sm-dz-row' + (sec && sec.id === r.id ? ' on' : '') + '">' +
          '<button class="sm-dz-pick" data-sm="rack-focus" data-id="' + r.id + '"' + dragAttrs(r) +
          '><b>' + esc(r.key) + '</b> · ' +
          esc(r.name) + '</button>' +
          '<button class="btn btn-sm" data-sm="rack-cfg" data-id="' + r.id + '">' + t('sm_place') + '</button></div>';
      });
      h += '</div>';
    }
    /* racks in the warehouse's other rooms — draggable in, so a rack that
       physically moved between rooms can be said to have moved */
    var els = elsewhere(room);
    if (els.length) {
      h += '<div class="sm-dz"><span class="lbl">' + t('sm_other_rooms') + '</span>';
      els.forEach(function (r) {
        var rm = roomById(r.room_id);
        h += '<div class="sm-dz-row sm-dz-far">' +
          '<button class="sm-dz-pick" data-sm="rack-focus" data-id="' + r.id + '"' + dragAttrs(r) +
          '><b>' + esc(r.key) + '</b> · ' + esc(r.name) +
          '<small class="muted">' + esc(rm ? rm.name : '') + '</small></button>' +
          '<button class="btn btn-sm btn-ghost" data-sm="rack-cfg" data-id="' + r.id + '">' +
          t('sm_rack_cfg') + '</button></div>';
      });
      h += '</div>';
    }

    /* from inside the room, a rack is placed where it will stand */
    if (room && use3d()) h += addRackForm(room);
    h += '<div class="sm-dz"><div class="sm-dz-row"><button class="btn btn-sm btn-ghost" data-sm="rack-new">+ ' +
         t('sm_new_rack') + '</button></div></div>';

    /* the rack in focus: its levels and its bays */
    if (sec) {
      h += '<div class="sm-dz"><span class="lbl">' + esc(sec.key + ' · ' + sec.name) + '</span>';
      /* The 2D view draws this form too when a rack is empty; one function
         so the two can never drift into different words or different
         defaults for the same two ids. */
      if (!sec.shelves.length) {
        h += seedForm(sec);
      } else {
        var levels = {}, cols = {};
        sec.shelves.forEach(function (sh) { levels[sh.row_label] = 1; cols[sh.col_index] = 1; });
        h += '<span class="muted sm-dz-note">' + t('sm_levels') + '</span><div class="sm-dz-chips">';
        Object.keys(levels).sort().forEach(function (L) {
          h += '<span class="sm-dz-chip">' + L + '<button class="sm-rc-x" data-sm="row-rm" data-row="' + L +
               '" title="' + esc(t('sm_remove_level').replace('{x}', L)) + '">&times;</button></span>';
        });
        h += '<button class="btn btn-sm btn-ghost" data-sm="row-add">+ ' + t('sm_add_level') + '</button></div>';
        h += '<span class="muted sm-dz-note">' + t('sm_bays') + '</span><div class="sm-dz-chips">';
        Object.keys(cols).map(Number).sort(function (a, b) { return a - b; }).forEach(function (c) {
          h += '<span class="sm-dz-chip">' + c + '<button class="sm-rc-x" data-sm="col-rm" data-col="' + c +
               '" title="' + esc(t('sm_remove_bay').replace('{x}', c)) + '">&times;</button></span>';
        });
        h += '<button class="btn btn-sm btn-ghost" data-sm="col-add">+ ' + t('sm_add_bay') + '</button></div>';
        h += '<div class="muted sm-dz-note">' + t('sm_level_hint') + ' ' + t('sm_no_renumber') + '</div>';
      }
      h += '</div>';
    }
    return h + '</div></aside>';
  }

  /* Racks standing in the warehouse's OTHER rooms. A rack moves between
     rooms by being dragged into this one, and it cannot be dragged from a
     list it is not in — so the racks next door are listed here, dimmed,
     with the room they are in named on the row. The letter they carry into
     every printed barcode does not change by moving them; only where they
     stand does. */
  function elsewhere(room) {
    if (!room) return [];
    return S.data.filter(function (s) {
      return s.room_id != null && s.room_id !== room.id &&
             s.wh_id === room.wh_id && s.shelves.length;
    });
  }

  /* A rack in either list can be dragged straight into the room, so both
     carry the shape the ghost needs. A rack with no bays yet has nothing to
     draw and nothing to place — it gets no handle. */
  function dragAttrs(r) {
    if (!use3d() || !S.edit || !canEdit() || !r.shelves.length) return '';
    if (S.roomId == null) return '';   /* nowhere to drop it: no room is open */
    var g = geometry(r), sz = rackSize(r);
    return ' data-drag="' + r.id + '" data-cols="' + Math.max(1, g.maxCol) +
           '" data-rows="' + Math.max(1, g.rows) + '" data-bay="' + sz.bay +
           '" data-level="' + sz.level + '" data-depth="' + sz.depth + '"' +
           (isFree(r) ? ' data-placement="free" data-rot="' + r.rot_deg + '"' : '');
  }

  /* Racks that "Place my racks" would hang: in this room's building, with
     shelves, in no room. */
  function fillable(room) {
    return unplaced(room.wh_id).filter(function (s) { return s.shelves.length > 0; })
      .sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  }

  /* The plan: racks by letter, alternating between the back wall and the
     front, each wall filled from its left with a hand's width between
     racks; when both are full, the two side walls; anything left stays
     unplaced and is named. All in the browser, against the same footprint
     arithmetic the room's drag uses, and nothing is sent until the person
     has read it and pressed Go. */
  function fillPlan(room) {
    var list = fillable(room);
    var W = room.width_cm || null, D = room.depth_cm || null;
    var measured = W && D;
    var GAP = 10;
    var cursor = { n: 0, s: 0, e: 0, w: 0 };
    var taken = [];   /* footprints in cm, for the corner test */
    racksIn(room.id).forEach(function (r) {
      /* a rack standing on the floor is floor the plan must not hang anything on */
      if (isFree(r)) {
        if (measured) taken.push(fpCm('free', { x: r.x_cm, y: r.y_cm, rot: r.rot_deg }, rackSize(r), W, D));
        return;
      }
      if (!r.wall || !measured) { if (r.wall) cursor[r.wall] = Math.max(cursor[r.wall], (r.wall_cm || 0) + rackSize(r).width + GAP); return; }
      var sz = rackSize(r);
      taken.push(fpCm(r.wall, r.wall_cm || 0, sz, W, D));
      cursor[r.wall] = Math.max(cursor[r.wall], (r.wall_cm || 0) + sz.width + GAP);
    });
    var out = [], left = [];
    var order = ['n', 's', 'n', 's'];
    list.forEach(function (sec, i) {
      var sz = rackSize(sec);
      var walls = [order[i % 2], order[(i + 1) % 2], 'e', 'w'];
      var put = null;
      for (var k = 0; k < walls.length && !put; k++) {
        var wl = walls[k];
        var len = !measured ? Infinity : (wl === 'n' || wl === 's' ? W : D);
        var at = cursor[wl];
        if (at + sz.width > len) continue;
        if (measured) {
          var fp = fpCm(wl, at, sz, W, D), hit = false;
          for (var j = 0; j < taken.length; j++) {
            var o = taken[j];
            if (fp.x0 < o.x1 && o.x0 < fp.x1 && fp.z0 < o.z1 && o.z0 < fp.z1) { hit = true; break; }
          }
          if (hit) {
            /* a corner is in the way: step past the deepest rack on the
               adjacent walls and try once more */
            at = Math.max(at, sz.depth + GAP);
            if (at + sz.width > len) continue;
            fp = fpCm(wl, at, sz, W, D);
            hit = taken.some(function (o) { return fp.x0 < o.x1 && o.x0 < fp.x1 && fp.z0 < o.z1 && o.z0 < fp.z1; });
            if (hit) continue;
          }
          taken.push(fp);
        }
        put = { sec: sec, wall: wl, at: at };
        cursor[wl] = at + sz.width + GAP;
      }
      if (put) out.push(put); else left.push(sec);
    });
    return { place: out, left: left };
  }

  /* footprint() from server/lib/shelves.js, in centimetres */
  function fpCm(wall, at, sz, W, D) {
    var w = sz.width, dp = sz.depth;
    switch (wall) {
      case 'n': return { x0: at, x1: at + w, z0: 0, z1: dp };
      case 's': return { x0: W - at - w, x1: W - at, z0: D - dp, z1: D };
      case 'e': return { x0: W - dp, x1: W, z0: at, z1: at + w };
      case 'free': {
        var along = at.rot === 90 || at.rot === 270;
        var hx = (along ? dp : w) / 2, hz = (along ? w : dp) / 2, cz = D - at.y;
        return { x0: at.x - hx, x1: at.x + hx, z0: cz - hz, z1: cz + hz };
      }
      default:  return { x0: 0, x1: dp, z0: D - at - w, z1: D - at };
    }
  }

  var fillPending = null;

  function fillModal(room) {
    var plan = fillPlan(room);
    var b = '';
    if (!plan.place.length) {
      b += '<p class="muted">' + t('sm_fill_none_left') + '</p>';
    } else {
      b += '<ul class="sm-fill-list">' + plan.place.map(function (p) {
        return '<li><b dir="ltr">' + esc(p.sec.key) + '</b> · ' + esc(p.sec.name) + ' → ' +
          esc(t('sm_fill_line').replace('{w}', t('sm_wall_' + p.wall)).replace('{n}', nf(p.at))) + '</li>';
      }).join('') + '</ul>';
    }
    if (plan.left.length) {
      b += '<p class="muted">' + esc(t('sm_fill_partial').replace('{k}', plan.left.map(function (s) { return s.key; }).join(', '))) + '</p>';
    }
    fillPending = plan.place;
    openModal({
      title: t('sm_fill_title'),
      size: 'narrow',
      body: b,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        (plan.place.length
          ? '<button class="btn btn-primary" data-sm="room-fill-go">' + t('sm_fill_go') + '</button>'
          : ''),
      onClose: function () { fillPending = null; }
    });
  }

  /* One PATCH after another, in plan order, stopping at the first refusal
     so a rack the server would not take does not leave the ones after it
     placed around a hole. The reload puts the truth back either way. */
  function fillGo() {
    var plan = fillPending || [];
    fillPending = null;
    closeModal();
    var room = S.roomId != null ? roomById(S.roomId) : null;
    if (!room || !plan.length) return;
    var i = 0;
    var next = function () {
      if (i >= plan.length) { reload(); return; }
      var p = plan[i++];
      API.patch('/api/sections/' + p.sec.id, { roomId: room.id, wall: p.wall, wallCm: p.at })
        .then(next)
        .catch(function (err) {
          toast(layoutError(err), p.sec.key, 'warn', 7000);
          reload();
        });
    };
    next();
  }

  function wallLabel(w) { return w ? t('sm_wall_' + w) : t('sm_nowhere'); }

  /* A rack standing free on the floor (051): the kind, and all three of
     where it is — a half-placed row reads as not placed, never as free. */
  function isFree(sec) {
    return !!sec && sec.placement === 'free' && sec.x_cm != null && sec.y_cm != null && sec.rot_deg != null;
  }

  function placeText(r) { return isFree(r) ? t('sm_free') : wallLabel(r.wall); }

  function placeHtml(r) {
    if (isFree(r)) {
      return esc(t('sm_free')) + ' · <span dir="ltr">' + nf(r.x_cm) + ' × ' + nf(r.y_cm) + ' ' +
             esc(t('sm_cm')) + ' · ' + r.rot_deg + '°</span>';
    }
    return esc(wallLabel(r.wall)) +
      (r.wall ? ' · <span dir="ltr">' + nf(r.wall_cm || 0) + ' ' + esc(t('sm_cm')) + '</span>' : '');
  }

  /* A number inside a sentence that may be Arabic, isolated left to right —
     for text set through textContent, where a <span dir> cannot go. */
  function ltrN(s) { return '⁦' + s + '⁩'; }

  function glFail(msg) {
    if (S.glDead) return;
    S.glDead = true;
    leaveFullscreen();
    toast(msg, '', 'warn', 7000);
    repaint();
  }

  function setView(v) {
    S.view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    if (v !== 'room') leaveFullscreen();
    peekPin = null;
    hidePeek();
    repaint();
  }

  /* Out of fullscreen, if in it. The room's fs hook does the repaint. */
  function leaveFullscreen() {
    if (S.fs && typeof ShelfRoom !== 'undefined') ShelfRoom.fullscreen(false);
  }

  /* ------------------------------------------------------------- the peek
     Point at a bay, in either view, and get the one card that answers "what
     is on this and what is missing" without opening the panel or losing
     your place.

     It carries the SAME size run the panel does, by the same rule: a chip
     is binary — filled means that size is here, dim means a hole — and no
     per-size quantity is printed. The holes are the information, and a card
     that disagreed with the panel underneath it would be worse than no card.

     One node for the life of the page, moved and refilled: a card built per
     hover is a card that is built forty times a minute during a put-away. */
  var peekEl = null, peekId = null;
  /* The bay pressed in the room, whose card is pinned. Separate from peekId
     on purpose: a repaint hides the card (hidePeek) and must not forget that
     one was pinned, or every scan would put it away. */
  var peekPin = null;

  function peekNode() {
    if (peekEl && peekEl.isConnected) return peekEl;
    peekEl = document.createElement('div');
    peekEl.className = 'sm-peek';
    peekEl.hidden = true;
    document.body.appendChild(peekEl);
    return peekEl;
  }

  function hidePeek() {
    peekId = null;
    if (peekEl) peekEl.hidden = true;
  }

  function showPeek(id, x, y) {
    var hit = shelfById(id);
    if (!hit) { hidePeek(); return; }
    var el = peekNode();
    var sh = hit.sh;

    if (peekId !== id) {
      peekId = id;
      el.classList.remove('sm-peek-pinned');
      var owner = sh.product_id != null ? DB.product(sh.product_id) : null;
      var held = sh.contents && sh.contents.length ? DB.product(sh.contents[0].product_id) : null;
      var p = owner || held;

      var h = '<div class="sm-peek-top"><b dir="ltr">' + esc(hit.sec.key + '-' + sh.code) + '</b>' +
        (sh.capacity != null && sh.capacity > 0
          ? '<span class="sm-peek-cap">' + nf(sh.qty) + '/' + nf(sh.capacity) + '</span>'
          : (sh.qty > 0 ? '<span class="sm-peek-cap">' + nf(sh.qty) + '</span>' : '')) + '</div>';

      if (p && !p.archived) {
        h += '<div class="sm-peek-name" dir="auto">' +
          (S.colour ? '<i style="background:' + esc(DB.typeColour(p.type)) + '"></i>' : '') +
          esc(p.name) + '</div>';
        var have = {};
        (sh.contents || []).forEach(function (row) { if (row.product_id === p.id) have[row.sku] = row.qty; });
        var chips = '';
        sizesOf(p).forEach(function (v) {
          chips += '<span class="sm-chip' + ((have[v.sku] || 0) > 0 ? ' in' : '') + '">' + esc(v.size) + '</span>';
        });
        h += '<div class="sm-chips" dir="ltr">' + chips + '</div>';
        if (sh.range) h += '<div class="muted sm-peek-range">' + esc(sh.range) + '</div>';
      } else {
        h += '<div class="muted sm-peek-name">' + t('sm_unassigned') + '</div>';
      }
      el.innerHTML = h;
    }

    el.hidden = false;
    /* Placed against the viewport after it has a size, and flipped rather
       than clipped near an edge. */
    var w = el.offsetWidth, ht = el.offsetHeight;
    var left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + ht > window.innerHeight - 8) top = y - ht - 14;
    el.style.transform = 'translate3d(' + Math.max(8, left) + 'px,' + Math.max(8, top) + 'px,0)';
  }

  /* THE PINNED CARD: a bay pressed in the room. It says what is actually
     sitting there — product, colourway, and the count of every size, most
     held first — and the true total at the top, whatever number of boxes
     the room could fit on the shelf. The total is the server's `qty`, which
     is derived from the same rows listed under it. No cost appears: the
     contents carry none, and a warehouse account has no business with it.
     An empty bay says so and offers nothing; empty is a fact. */
  var PIN_ROWS = 14;

  function showPinned(id) {
    var hit = shelfById(id);
    if (!hit) { peekPin = null; hidePeek(); return; }
    var el = peekNode(), sh = hit.sh, sec = hit.sec;
    var ltr = function (s) { return '<span dir="ltr">' + esc(s) + '</span>'; };
    peekId = id;

    var h = '<div class="sm-peek-top"><b dir="ltr">' + esc(sec.key + '-' + sh.code) + '</b>' +
      '<span class="sm-peek-cap">' + esc(t('sm_bay_total')).replace('{n}', ltr(nf(sh.qty || 0))) + '</span></div>' +
      '<div class="sm-peek-where">' + esc(t('sm_bay_where'))
        .replace('{r}', ltr(sec.key)).replace('{l}', ltr(sh.row_label)).replace('{b}', ltr(sh.col_index)) + '</div>';

    var groups = {}, order = [];
    (sh.contents || []).forEach(function (row) {
      if (!(row.qty > 0)) return;
      var g = groups[row.product_id];
      if (!g) {
        g = groups[row.product_id] = { pid: row.product_id, name: row.product_name, total: 0, rows: [] };
        order.push(g);
      }
      g.total += row.qty;
      g.rows.push(row);
    });
    order.sort(function (a, b) { return b.total - a.total; });

    if (!order.length) {
      h += '<div class="sm-peek-empty">' +
        esc(t('sm_bay_empty')).replace('{code}', '<b dir="ltr">' + esc(sec.key + '-' + sh.code) + '</b>') + '</div>';
    } else {
      var shown = 0, hidden = 0;
      order.forEach(function (g) {
        var p = DB.product(g.pid);
        g.rows.sort(function (a, b) {
          return (b.qty - a.qty) || String(a.size).localeCompare(String(b.size), undefined, { numeric: true });
        });
        h += '<div class="sm-peek-group"><div class="sm-peek-name" dir="auto">' +
          (S.colour && p ? '<i style="background:' + esc(DB.typeColour(p.type)) + '"></i>' : '') +
          esc(g.name || (p ? p.name : '')) + '</div>';
        if (p && p.colorway) h += '<div class="sm-peek-cw" dir="auto">' + esc(p.colorway) + '</div>';
        var rows = '';
        g.rows.forEach(function (row) {
          if (shown >= PIN_ROWS) { hidden++; return; }
          shown++;
          rows += '<span>' + esc(row.size) + '</span><span>' + nf(row.qty) + '</span>';
        });
        if (rows) h += '<div class="sm-peek-rows" dir="ltr">' + rows + '</div>';
        h += '</div>';
      });
      if (hidden) h += '<div class="sm-peek-hint">' + esc(t('sm_bay_more')).replace('{n}', ltr(nf(hidden))) + '</div>';
    }
    h += '<div class="sm-peek-hint">' + esc(t('sm_bay_back')) + '</div>';

    el.innerHTML = h;
    el.classList.add('sm-peek-pinned');
    el.hidden = false;
    dockPeek();
  }

  /* In the room's top corner — the reading side's corner — and below the
     fullscreen strip when there is one. Placed against the viewport like the
     hover card, so it is moved again when the page scrolls or resizes. */
  function dockPeek() {
    if (peekPin == null || !peekEl || peekEl.hidden) return;
    var wrap = document.querySelector('.sm-gl');
    if (!wrap || !wrap.isConnected) return;
    var r = wrap.getBoundingClientRect();
    var top = r.top + 12;
    var ov = wrap.querySelector('.sm-ov-top');
    if (ov) top += ov.offsetHeight;
    var w = peekEl.offsetWidth, ht = peekEl.offsetHeight;
    var left = OG.lang === 'ar' ? r.right - 12 - w : r.left + 12;
    top = Math.min(top, window.innerHeight - ht - 8);
    peekEl.style.transform = 'translate3d(' + Math.max(8, left) + 'px,' + Math.max(8, top) + 'px,0)';
  }

  /* A rack with no shelves on it yet. ONE seed form, used here and by the
     designer — same ids, same action, and now the same words. It said
     "rows" and "columns" here and "levels" and "bays" three hundred lines
     away, for the same two number boxes writing the same two ids. */
  function seedForm(sec) {
    return '<div class="sm-seed">' +
      '<label class="field"><span>' + t('sm_levels') + '</span>' +
        '<input class="inp num" id="smSeedR" type="number" min="1" max="26" value="4"></label>' +
      '<label class="field"><span>' + t('sm_bays') + '</span>' +
        '<input class="inp num" id="smSeedC" type="number" min="1" max="99" value="6"></label>' +
      '<label class="field"><span>' + t('sm_capacity') + '</span>' +
        '<input class="inp num" id="smSeedCap" type="number" min="1" placeholder="' + t('sm_cap_hint') + '"></label>' +
      '<button class="btn btn-primary" data-sm="seed" data-id="' + sec.id + '">' +
        t('sm_grid_setup') + '</button>' +
    '</div>';
  }

  function emptyRack(sec) {
    var h = '<div class="card"><div class="card-body">' +
            '<b>' + t('sm_rack_empty') + '</b>';
    /* The designer carries this same form while it is open, and two
       <input id="smSeedR"> on one page means ACT['seed'] reads one box while
       the person is typing in the other. One or the other, never both. */
    if (canEdit() && !S.edit) {
      h += seedForm(sec) + '<div class="muted sm-dz-note">' + t('sm_level_hint') + '</div>';
    }
    h += '</div></div>';
    return h;
  }

  /* ----------------------------------------------------------- the rack */

  /* The rack's shape, from the shelves that exist. `levels` is the letters
     actually in use, top-down — NOT A..maxLetter. This used to return
     ALPHA.indexOf(max)+1, so a rack whose levels start at C drew two phantom
     rows of A and B: empty floor in view mode, and in edit mode "+ add a
     shelf here" cells offering to grow the rack ABOVE its top — a direction
     the server never grows it (a new level is appended past the highest
     letter, at the bottom). The same off-by-everything reached the room,
     which drew that rack floating two empty levels off the floor. */
  function geometry(sec) {
    var maxCol = 0, seen = {}, byPos = {};
    sec.shelves.forEach(function (sh) {
      if (sh.col_index > maxCol) maxCol = sh.col_index;
      seen[sh.row_label] = 1;
      byPos[sh.row_label + ':' + sh.col_index] = sh;
    });
    var levels = Object.keys(seen).sort();
    return { maxCol: maxCol, levels: levels, rows: levels.length, byPos: byPos };
  }

  /* Which grid column a physical column number lands in. +2 because grid
     column 1 is the row-letter gutter. THE ROOM DECIDES, NEVER THE LANGUAGE:
     with origin 'right', column 1 draws on the right, in English and in
     Arabic alike. */
  function visCol(sec, c, maxCol) {
    return (sec.grid_origin === 'right' ? (maxCol - c + 1) : c) + 1;
  }

  function stage(sec) {
    var g = geometry(sec);
    var addable = S.edit && canEdit();

    /* THE RACK, STRAIGHT ON. No tilt: this is the surface a person reads
       while holding a shoe, and a grid at 18° is a grid nobody can read.
       The tilt was what made the old rack "3D-ish"; the room does that job
       properly now, so this one is honest about being a drawing.

       dir="ltr" pinned on the grid: an RTL document mirrors grid tracks on
       its own, which would flip every rack the moment the app speaks Arabic.
       Placement is explicit coordinates, so what you see is what was said. */
    var h = '<div class="sm-stage sm-flatstage no-print">' + rackHead(sec) +
            '<div class="sm-rack">' +
            '<div class="sm-grid" dir="ltr" style="grid-template-columns:38px repeat(' +
            g.maxCol + ', minmax(72px, 1fr))">';

    /* Column numbers across the top, at their VISUAL positions. */
    for (var c = 1; c <= g.maxCol; c++) {
      h += '<div class="sm-colhead" style="grid-row:1;grid-column:' + visCol(sec, c, g.maxCol) + '">' +
           c +
           (addable ? '<button class="sm-rc-x" data-sm="col-rm" data-col="' + c + '" title="' +
                      esc(t('sm_remove_bay').replace('{x}', String(c))) + '">&times;</button>' : '') +
           '</div>';
    }

    for (var r = 0; r < g.rows; r++) {
      var letter = g.levels[r];
      var gr = r + 2;

      h += '<div class="sm-rowhead" style="grid-row:' + gr + ';grid-column:1">' + letter +
           (addable ? '<button class="sm-rc-x" data-sm="row-rm" data-row="' + letter + '" title="' +
                      esc(t('sm_remove_level').replace('{x}', letter)) + '">&times;</button>' : '') +
           '</div>';

      for (var c2 = 1; c2 <= g.maxCol; c2++) {
        var sh = g.byPos[letter + ':' + c2];
        var pos = 'grid-row:' + gr + ';grid-column:' + visCol(sec, c2, g.maxCol);
        if (sh) {
          h += tile(sec, sh, pos);
        } else if (addable) {
          /* A door, a pillar — or the place a rack goes next. */
          h += '<button class="sm-cell-add" style="' + pos + '" data-sm="add-here" ' +
               'data-row="' + letter + '" data-col="' + c2 + '">+<span>' +
               esc(letter + c2) + '</span></button>';
        } else {
          h += '<div class="sm-cell-gap" style="' + pos + '"></div>';
        }
      }
    }

    h += '</div></div>';

    /* Whole-level and whole-bay growth lives in a labelled toolbar under
       the rack rather than as bare + cells in the grid. A new bay's position
       depends on which end the rack is read from, and a labelled button
       never needs the reader to work out which side it will land on — the
       rack grows at its far end either way, and a level goes on the bottom. */
    if (addable) {
      h += '<div class="sm-growbar no-print">' +
        '<button class="btn btn-ghost" data-sm="row-add">+ ' + t('sm_add_level') + '</button>' +
        '<button class="btn btn-ghost" data-sm="col-add">+ ' + t('sm_add_bay') + '</button>' +
        '</div>';
    }
    return h + '</div>';
  }

  /* Which rack this is, and where it hangs — the elevation on its own is a
     grid of letters that could belong to anything. */
  function rackHead(sec) {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    var where = room
      ? (isFree(sec) ? t('sm_free') : sec.wall ? wallLabel(sec.wall) : t('sm_not_placed'))
      : t('sm_not_placed');
    return '<div class="sm-rackhead"><b>' + esc(sec.key) + '</b>' +
      '<span>' + esc(sec.name) + '</span>' +
      '<small class="muted">' + esc(where) + '</small></div>';
  }

  function tile(sec, sh, pos) {
    var cls = 'sm-tile' + (sh.id === S.sel ? ' on' : '');
    var inner = '<span class="sm-code">' + esc(sh.code) + '</span>';

    /* THE SAME TWO PRODUCTS THE ROOM DRAWS: the one the bay is ASSIGNED to,
       and the one actually on it (which an unassigned bay can carry). Same
       resolution as bayModel(), so the two surfaces cannot disagree — the
       fill is what is on it, the tint is what it is for. */
    var owner = sh.product_id != null ? DB.product(sh.product_id) : null;
    var held = sh.contents && sh.contents.length ? DB.product(sh.contents[0].product_id) : null;
    var p = owner || held;
    var onIt = held || (sh.qty > 0 ? owner : null);
    var style = pos;

    /* Fill against capacity when a capacity is known; a plain count when it
       is not. NEVER a bar against a guessed number — an invented capacity is
       a fill level that lies, and a first pass at this drew a fixed 55% band
       for unmeasured bays, which is a picture of exactly that. Where there
       is no capacity the colour still lands, as a wash over the whole face:
       it says WHAT is on the bay without claiming HOW FULL. */
    if (sh.capacity != null && sh.capacity > 0) {
      var pct = Math.max(0, Math.min(100, Math.round(sh.qty / sh.capacity * 100)));
      inner += '<span class="sm-fill" style="height:' + pct + '%' +
               (S.colour && onIt ? ';background:' + esc(DB.typeColour(onIt.type)) : '') + '"></span>' +
               '<span class="sm-load">' + nf(sh.qty) + '/' + nf(sh.capacity) + '</span>';
    } else if (sh.qty > 0) {
      if (S.colour && onIt) style += ';background:' + DB.typeColour(onIt.type);
      inner += '<span class="sm-load">' + nf(sh.qty) + '</span>';
    }

    /* What the bay is FOR, on the board across its foot — a child, never an
       edge: .sm-flash-* sets border-color !important on all four sides. */
    if (S.colour && owner) {
      inner += '<span class="sm-board" style="background:' + esc(DB.typeColour(owner.type)) + '"></span>';
    }

    /* The name, on the face. The room puts one tag over a whole run of bays
       because forty names over forty crates is unreadable; a flat grid has
       room for the name in every bay, and a person scanning the wall for a
       product should not have to hover to find it. */
    if (p) inner += '<span class="sm-pname" dir="auto">' + esc(p.name) + '</span>';

    /* In the editor, a shelf with stock says so before anyone tries to
       delete it — the lock is the same fact the server will enforce. */
    if (S.edit && sh.qty > 0) {
      inner += '<svg class="sm-lock" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
               '<path fill="currentColor" d="M17 9V7A5 5 0 0 0 7 7v2H5v13h14V9h-2zM9 7a3 3 0 0 1 6 0v2H9V7z"/></svg>';
    }

    /* No title=. The peek card says all of this and more, immediately and in
       the app's own type; a native tooltip arriving half a second later
       underneath it is two tooltips disagreeing about which is the answer. */
    return '<button class="' + cls + '" id="smT' + sh.id + '" style="' + style +
           '" data-sm="tile" data-id="' + sh.id + '" data-peek="' + sh.id + '">' +
           inner + '</button>';
  }

  /* ----------------------------------------------------------- the panel */

  function panel(sec) {
    if (S.sel == null) return '';
    var hit = shelfById(S.sel);
    if (!hit) return '';
    var sh = hit.sh;

    var h = '<div class="card sm-panel"><div class="card-head"><h3>' +
      esc(hit.sec.key + '-' + sh.code) +
      ' <small class="muted">' + esc(hit.sec.name) + '</small></h3>' +
      '<div class="head-actions">' +
        (allow('label.print')
          ? '<button class="btn btn-ghost" data-sm="print-shelf" data-id="' + sh.id + '">' +
            t('sm_print_label') + '</button>'
          : '') +
      '</div></div><div class="card-body">';

    /* What the shelf is FOR — assignment, which is what the label says. */
    h += '<div class="sm-assign-line">' +
      (sh.product_id
        ? '<b>' + esc(sh.product_name || '') + '</b>' +
          '<span class="muted"> · ' + (sh.range ? esc(sh.range) : t('sm_whole_model')) + '</span>'
        : '<span class="muted">' + t('sm_unassigned') + '</span>') +
      (sh.capacity != null
        ? '<span class="muted"> · ' + t('sm_capacity_n').replace('{n}', nf(sh.capacity)) + '</span>'
        : '') +
      '</div>';

    h += contentsRows(sh);

    if (S.edit && canEdit()) h += editForm(hit.sec, sh);

    h += '</div></div>';
    return h;
  }

  /* One row per product with a presence on this shelf — physically on it,
     or assigned to it and run out. The chips are the whole message: a
     filled chip is a size in stock ON THIS SHELF, a dim one is a hole in
     the run. No numbers to read; the holes are the information. */
  function contentsRows(sh) {
    var byProduct = {};
    (sh.contents || []).forEach(function (row) {
      (byProduct[row.product_id] = byProduct[row.product_id] || {})[row.sku] = row.qty;
    });
    /* The assigned model always gets a row, even sold out — "this belongs
       here and it has run out" is exactly what an empty shelf with a purpose
       looks like, and it is the difference between assignment and contents. */
    if (sh.product_id && !byProduct[sh.product_id]) byProduct[sh.product_id] = {};

    var pids = Object.keys(byProduct);
    if (!pids.length) {
      return '<div class="sm-emptyrow muted">' + t('sm_shelf_empty') + '</div>';
    }

    var h = '<div class="sm-rows">';
    pids.forEach(function (pidStr) {
      var pid = +pidStr;
      var p = DB.product(pid);
      if (!p || p.archived) return;   /* archived is not stock, here either */
      var have = byProduct[pid];

      var chips = '';
      sizesOf(p).forEach(function (v) {
        var onHere = (have[v.sku] || 0) > 0;
        chips += '<span class="sm-chip' + (onHere ? ' in' : '') + '">' + esc(v.size) + '</span>';
      });

      h += '<div class="sm-row">' +
        /* DB.typeColour, not p.image.bg: a product with a hand-picked block
           colour would otherwise make this one stripe disagree with the
           legend, the tile board and the room's crate for the same product.
           One source, four surfaces, no argument between them. */
        '<span class="sm-stripe" style="background:' + esc(DB.typeColour(p.type)) + '"></span>' +
        '<div class="sm-row-name"><b>' + esc(p.name) + '</b>' +
          (p.colorway ? '<small class="muted">' + esc(p.colorway) + '</small>' : '') +
        '</div>' +
        '<div class="sm-chips" dir="ltr">' + chips + '</div>' +
      '</div>';
    });
    h += '</div>';
    return h;
  }

  /* A product's sizes in the order a person reads a run — the house
     SIZE_SETS order when the type has one, numeric-aware otherwise, so 9
     never sorts after 42. */
  function sizesOf(p) {
    var vs = DB.variantsOf(p.id).slice();
    var order = DB.sizeSets[p.type];
    vs.sort(function (a, b) {
      if (order) {
        var ia = order.indexOf(a.size), ib = order.indexOf(b.size);
        if (ia > -1 && ib > -1) return ia - ib;
        if (ia > -1) return -1;
        if (ib > -1) return 1;
      }
      var na = parseFloat(a.size), nb = parseFloat(b.size);
      if (isFinite(na) && isFinite(nb)) return na - nb;
      return String(a.size).localeCompare(String(b.size));
    });
    return vs;
  }

  function editForm(sec, sh) {
    var products = DB.products.filter(function (p) { return !p.archived; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    var h = '<div class="sm-edit">';
    h += '<div class="sm-editrow">' +
      '<label class="field"><span>' + t('sm_code') + '</span>' +
        '<input class="inp" id="smCode" type="text" value="' + esc(sh.code) + '" dir="ltr" maxlength="4"></label>' +
      '<label class="field"><span>' + t('sm_capacity') + '</span>' +
        '<input class="inp num" id="smCap" type="number" min="1" value="' + (sh.capacity == null ? '' : sh.capacity) + '" placeholder="' + t('sm_cap_hint') + '"></label>' +
      '</div>';

    h += '<div class="sm-editrow">' +
      '<label class="field grow"><span>' + t('product') + '</span>' +
        '<select class="inp" id="smProd" data-smv="prod-pick" data-id="' + sh.id + '">' +
        '<option value="">' + t('sm_unassigned_opt') + '</option>';
    products.forEach(function (p) {
      h += '<option value="' + p.id + '"' + (p.id === sh.product_id ? ' selected' : '') + '>' +
           esc(p.name) + '</option>';
    });
    h += '</select></label>' + rangeSelects(sh.product_id, sh.size_from, sh.size_to) + '</div>';

    h += '<div class="sm-editrow sm-editbtns">' +
      '<button class="btn btn-primary" data-sm="save" data-id="' + sh.id + '">' + t('save') + '</button>' +
      '<button class="btn btn-ghost danger" data-sm="del" data-id="' + sh.id + '"' +
        (sh.qty > 0 ? ' disabled title="' + esc(t('sm_locked').replace('{n}', nf(sh.qty))) + '"' : '') + '>' +
        t('sm_delete') + '</button>' +
      (sh.qty > 0 ? '<span class="muted sm-lockednote">' + t('sm_locked').replace('{n}', nf(sh.qty)) + '</span>' : '') +
      '</div>';

    h += '</div>';
    return h;
  }

  /* The from/to size pickers, rebuilt whenever the product changes. Options
     come from the product's real size run — a free-text range box would
     invite '41 ' and 'XL' onto the same shelf, which the server refuses
     anyway; better not to offer it. */
  function rangeSelects(pid, from, to) {
    var sizes = [];
    if (pid) {
      var p = DB.product(pid);
      if (p) sizes = sizesOf(p).map(function (v) { return v.size; });
    }
    /* Built with an explicit selected flag per option  marking the choice
       by string-replacing value="39" would also hit the front of
       value="39.5", and a size run is exactly where both exist. */
    function sel(id, val) {
      var o = '<select class="inp" id="' + id + '">' +
              '<option value="">' + t('sm_whole_model') + '</option>';
      sizes.forEach(function (s) {
        o += '<option value="' + esc(s) + '"' + (s === val ? ' selected' : '') + '>' +
             esc(s) + '</option>';
      });
      return o + '</select>';
    }
    return '<span id="smRange" class="sm-range">' +
      '<label class="field"><span>' + t('l60_from') + '</span>' + sel('smFrom', from) + '</label>' +
      '<label class="field"><span>' + t('l60_to') + '</span>' + sel('smTo', to) + '</label>' +
      '</span>';
  }

  /* -------------------------------------------------------------- repaint */

  function repaint() {
    var root = document.getElementById('smRoot');
    if (!root) return;

    /* The peek points at a tile this innerHTML is about to destroy. It lives
       on <body> so the paint cannot eat it — which is exactly why it would
       otherwise be left floating over nothing after a scan. The drag
       readout is the same kind of node and goes the same way. */
    hidePeek();
    hideHud();

    /* WHO HAD THE CARET, read BEFORE the innerHTML that destroys them.
       Checking afterwards cannot work: replacing the markup detaches the
       focused node, the browser falls back to <body>, and a guard reading
       activeElement at that point sees "nobody" and takes the focus — pulling
       the caret out of the code field a manager is halfway through typing.
       This is the focusBack() idiom the filter inputs already use. */
    var a = document.activeElement;
    var hadId = a && a.id && root.contains(a) ? a.id : null;
    var caret = null;
    if (hadId) { try { caret = a.selectionStart; } catch (e) {} }

    /* THE CANVAS COMES OUT BEFORE THE innerHTML AND GOES BACK AFTER. Read
       activeElement first (above), detach second, replace third: the room's
       WebGL context lives in a canvas that innerHTML would destroy, and a
       destroyed context on every barcode is the failure js/shelfroom.js
       exists to prevent. The canvas is never focusable, so it can never be
       what `a` is — but the order still has to hold if that ever changes. */
    if (typeof ShelfRoom !== 'undefined') ShelfRoom.detach();

    root.innerHTML = body();

    mount3d();

    /* A pinned card survives the repaint that hid it — as long as its bay is
       still the one selected and the room is still what is on screen. A
       scan that selects another bay, or a switch to 2D, lets it go. */
    if (peekPin != null) {
      if (use3d() && S.sel === peekPin && typeof ShelfRoom !== 'undefined' && ShelfRoom.ready()) showPinned(peekPin);
      else peekPin = null;
    }

    if (hadId && hadId !== 'smScan' && hadId !== 'smScanFs') {
      var back = document.getElementById(hadId);
      if (back) {
        back.focus();
        if (caret != null) { try { back.setSelectionRange(caret, caret); } catch (e) {} }
        return;
      }
    }
    keepFocus();
  }

  /* The box takes the focus back after every repaint — and every scan is a
     repaint, so without this the caret is gone by the second box of the run. */
  function keepFocus() {
    /* Fullscreen has its own box inside the wrapper; the page's is behind
       the top layer and a caret there is a caret nobody can see. */
    var box = (S.fs && document.getElementById('smScanFs')) || document.getElementById('smScan');
    if (!box || modalOpen()) return;
    var a = document.activeElement;
    if (a && a !== box && a !== document.body) {
      var tag = (a.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || a.isContentEditable) return;
    }
    try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
  }

  function after() {
    livePoll();
    if (!S.data && !S.loading) { load(); return; }
    /* news arrived while another screen was up: coming back, ask again
       rather than show what was known when the map was left */
    if (S.stale && !S.loading) { S.stale = false; load(true); return; }
    /* render() has just rebuilt #view from view(), which emits the room's
       empty mount — the canvas has to be put back into it, exactly as after
       a repaint. Idempotent, so calling it here AND there costs nothing. */
    mount3d();
    keepFocus();
  }

  /* ------------------------------------------------------------ scanning */

  var lastScan = null, lastScanAt = 0;

  function onScan(code) {
    if (!owns()) return;
    var c = String(code || '').trim();
    if (!c) return;

    /* A scanner left in presentation mode re-reads the label it is sitting
       over, several times a second. That is the ONLY repeat this collapses.

       A person scanning the same shoe six times because six boxes are going
       onto the shelf is doing something different and deliberate, and 700ms
       is far longer than the gap between two re-reads and far shorter than
       the gap between two boxes. */
    var now = Date.now();
    if (c === lastScan && now - lastScanAt < 700) { lastScanAt = now; return; }
    lastScan = c; lastScanAt = now;

    var m = SHELF_SCAN_RE.exec(c.toUpperCase());
    if (m) return shelfScan(+m[1], m[2], m[3]);

    var v = DB.variantByBarcode(c) || DB.variantBySku(c) ||
            (DB.variantByLabelCode && DB.variantByLabelCode(c));
    if (v) return productScan(v);

    beep('bad');
    addChip({ kind: 'bad', label: c.slice(0, 14), sub: t('sm_unknown_code') });
    repaint();
    toast(t('sm_unknown_code'), c.slice(0, 40), 'warn');
  }

  function shelfScan(whCode, key, code) {
    var found = null;
    (S.data || []).forEach(function (s) {
      if (s.wh_code === whCode && s.key === key) {
        s.shelves.forEach(function (sh) { if (sh.code === code) found = { sec: s, sh: sh }; });
      }
    });
    if (!found) {
      beep('bad');
      addChip({ kind: 'bad', label: key + '-' + code, sub: t('sm_shelf_gone') });
      repaint();
      toast(t('sm_shelf_gone'), 'SH' + (whCode < 10 ? '0' : '') + whCode + key + code, 'warn');
      return;
    }
    focus(found.sec.id);
    S.sel = found.sh.id;
    /* Its own tone. Nothing on the shelf changed, but what the NEXT scan will
       do just did — the one event that is otherwise silent. */
    beep('shelf');
    addChip({ kind: 'shelf', label: found.sec.key + '-' + found.sh.code, sub: t('sm_target_set') });
    repaint();
    flash(found.sh.id, 'sm-flash-ok');
  }

  function productScan(v) {
    /* A shelf is selected and this person can move stock: the scan IS the
       put-away. The server is the judge — its refusal already names where
       the pair belongs, and the map's job is to point at it. */
    if (S.sel != null && canMove()) {
      var hit = shelfById(S.sel);
      if (!hit) return;
      var shelfId = S.sel;
      var p = DB.product(v.productId);

      /* Where this size is RIGHT NOW, read before the write, so undoing this
         scan can put it back rather than merely clearing it. `contents` only
         carries rows with stock on them, so a size that had sold out of its
         old shelf reads as nowhere — and undo then clears, which is the safe
         direction: it declines to invent a location. */
      var prev = shelfHolding(v.sku, hit.sec.wh_id);

      /* Only the FIRST scan of this size onto this shelf in this run actually
         moved anything. Six boxes of the same 42 is six scans and six chips —
         the tally the person is counting on — but the row already points here
         after the first, so the rest are the server confirming, not changing.
         The chip that owns the change is the one whose undo has to reverse it. */
      var owner = !S.chips.some(function (c) {
        return c.kind === 'ok' && c.sku === v.sku && c.shelfId === shelfId;
      });

      API.post('/api/stock/assign-shelf', {
        sku: v.sku, whId: hit.sec.wh_id, shelfId: shelfId
      }).then(function () {
        beep('ok');
        addChip({
          kind: 'ok', label: (p ? p.name : v.sku), sub: v.size + ' → ' + hit.sec.key + '-' + hit.sh.code,
          sku: v.sku, size: v.size, whId: hit.sec.wh_id,
          shelfId: shelfId, prevShelfId: prev, owner: owner
        });
        reload().then(function () { flash(shelfId, 'sm-flash-ok'); });
      }).catch(function (err) {
        beep('bad');
        var d = err && err.detail;
        var where = d && d.belongsOn && d.belongsOn.matching && d.belongsOn.matching.length
          ? d.belongsOn.matching.map(function (s) { return s.full_code; }).join(' / ')
          : '';
        addChip({
          kind: 'bad', label: (p ? p.name : v.sku),
          sub: v.size + (where ? ' → ' + where : ' · ' + t('sm_refused'))
        });
        repaint();
        flash(shelfId, 'sm-flash-bad');
        if (d && d.belongsOn && d.belongsOn.matching) {
          d.belongsOn.matching.forEach(function (s) { flash(s.id, 'sm-flash-warn'); });
        }
        toast(API.friendly(err), v.sku, 'warn', 5000);
      });
      return;
    }

    /* No target: light up where this model lives. Membership only — whether
       THIS size fits a range is the server's call, given on a real assign. */
    var homes = [];
    (S.data || []).forEach(function (s) {
      s.shelves.forEach(function (sh) {
        if (sh.product_id === v.productId) homes.push({ sec: s, sh: sh });
      });
    });
    var pl = DB.product(v.productId);
    if (!homes.length) {
      beep('bad');
      addChip({ kind: 'bad', label: (pl ? pl.name : v.sku), sub: v.size + ' · ' + t('sm_no_home') });
      repaint();
      toast(t('sm_no_home'), v.sku, 'warn');
      return;
    }
    var here = homes.filter(function (x) { return x.sec.id === S.secId; });
    if (!here.length) { focus(homes[0].sec.id); here = [homes[0]]; }
    var codes = homes.map(function (x) { return x.sec.key + '-' + x.sh.code; }).join(' · ');
    /* Located, not moved: the amber tone would claim a put-away happened. */
    beep('shelf');
    addChip({ kind: 'shelf', label: (pl ? pl.name : v.sku), sub: v.size + ' · ' + codes });
    repaint();
    here.forEach(function (x) { flash(x.sh.id, 'sm-flash-warn'); });
    toast(codes, v.sku, '');
  }

  /* Which shelf currently holds this size in this warehouse, from the last
     read of the map. */
  function shelfHolding(sku, whId) {
    var found = null;
    (S.data || []).forEach(function (s) {
      if (s.wh_id !== whId) return;
      s.shelves.forEach(function (sh) {
        (sh.contents || []).forEach(function (c) { if (c.sku === sku) found = sh.id; });
      });
    });
    return found;
  }

  /* ------------------------------------------------------------------ undo
     Tapping a chip takes that scan back. A refusal changed nothing, so its
     chip only leaves the strip. An accepted scan is reversed only when it was
     the one that MOVED the row and no other scan of the same size onto the
     same shelf is still standing — take one box off a stack of six and the
     other five are still on the shelf, which is what the remaining chips say.
     When it was the owner and others remain, the ownership passes to the
     oldest of them instead. */
  function undoChip(id) {
    var i = -1;
    for (var k = 0; k < S.chips.length; k++) if (S.chips[k].id === id) { i = k; break; }
    if (i < 0) return;
    var c = S.chips[i];
    S.chips.splice(i, 1);

    if (c.kind !== 'ok' || !c.owner) { repaint(); return; }

    var siblings = S.chips.filter(function (x) {
      return x.kind === 'ok' && x.sku === c.sku && x.shelfId === c.shelfId;
    });
    if (siblings.length) {
      siblings[siblings.length - 1].owner = true;   /* oldest remaining */
      repaint();
      return;
    }

    API.post('/api/stock/assign-shelf', {
      sku: c.sku, whId: c.whId, shelfId: c.prevShelfId == null ? null : c.prevShelfId
    }).then(function () {
      beep('shelf');
      reload();
    }).catch(function (err) {
      beep('bad');
      /* The scan is off the strip either way — putting it back would say the
         shoe is on a shelf the server has just refused to agree about. */
      toast(API.friendly(err), c.sku, 'warn', 5000);
      reload();
    });
    repaint();
  }

  function flash(shelfId, cls) {
    /* In the room the ring is drawn by ShelfRoom — same three colours, same
       1.4 seconds, same rule: colour is the answer to a scan and nothing else. */
    if (use3d() && typeof ShelfRoom !== 'undefined' && ShelfRoom.ready()) {
      ShelfRoom.flash(shelfId, cls === 'sm-flash-warn' ? 'warn' : cls === 'sm-flash-bad' ? 'bad' : 'ok');
      return;
    }
    var el = document.getElementById('smT' + shelfId);
    if (el) {
      el.classList.add(cls);
      setTimeout(function () { el.classList.remove(cls); }, 1400);
      return;
    }
    /* THE BAY IS NOT ON SCREEN. In the 2D view the elevation draws one rack,
       so the amber "it belongs over there" rings — which are very often on a
       DIFFERENT rack in the same room — used to be a silent no-op. Say it in
       the plan instead: the rack that holds it lights up, which is the same
       instruction one level out. Green and red always land on the target,
       which is by definition the rack on screen, so this is the amber path. */
    var hit = shelfById(shelfId);
    if (!hit) return;
    var bar = document.querySelector('.sm-pl-rack[data-id="' + hit.sec.id + '"]');
    if (!bar) return;
    bar.classList.add(cls);
    setTimeout(function () { bar.classList.remove(cls); }, 1400);
  }

  /* ---------------------------------------------------- the shared write
     One flow for every shelf change, from the panel AND from the Settings
     list — both hit PATCH /api/shelves/:id. The server answers
     `confirm_required` with the real numbers (pairs on the shelf, whose
     they are, how many printed labels go stale), and this turns that into
     the modal with the reprint button. Force is only ever sent after the
     numbers have been on screen. */
  function assignFlow(shelfId, patch, done) {
    API.patch('/api/shelves/' + shelfId, patch).then(function (res) {
      if (res.reprint && res.labels && res.labels.stale > 0 && res.shelf && res.shelf.product_id) {
        toast(t('sm_stale').replace('{n}', nf(res.labels.stale)), '', 'warn', 6000,
              { attrs: 'data-act="quick-label-per-pair" data-id="' + res.shelf.product_id + '"',
                label: t('sm_reprint') });
      }
      reload();
      if (done) done(res);
    }).catch(function (err) {
      if (err && err.code === 'confirm_required' && err.detail) {
        confirmModal(err.detail, function () {
          var forced = {};
          Object.keys(patch).forEach(function (k) { forced[k] = patch[k]; });
          forced.force = true;
          assignFlow(shelfId, forced, done);
        });
        return;
      }
      toast(API.friendly(err), '', 'warn', 5000);
    });
  }

  function confirmModal(d, apply) {
    var b = '';
    if (d.onShelf && d.onShelf.pieces > 0) {
      var names = (d.onShelf.products || []).map(function (p) { return p.name; }).join(', ');
      b += '<p><b>' + t('sm_confirm_stock')
             .replace('{n}', nf(d.onShelf.pieces)).replace('{p}', esc(names)) + '</b></p>';
    }
    if (d.reasons && d.reasons.indexOf('code') > -1) {
      b += '<p>' + t('sm_confirm_code') + '</p>';
    }
    var stale = d.labels ? d.labels.stale : 0;
    b += '<p class="' + (stale > 0 ? '' : 'muted') + '">' +
         t('sm_stale').replace('{n}', nf(stale)) + '</p>';

    var staleProduct = d.onShelf && d.onShelf.products && d.onShelf.products[0];
    openModal({
      title: t('sm_confirm_title'),
      size: 'narrow',
      body: b,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        (stale > 0 && staleProduct
          ? '<button class="btn" data-sm="confirm-reprint" data-id="' + staleProduct.id + '">' +
            t('sm_reprint') + '</button>'
          : '') +
        '<button class="btn btn-primary" data-sm="confirm-apply">' + t('sm_apply') + '</button>'
    });
    pendingApply = apply;
  }

  var pendingApply = null;

  /* --------------------------------------------------------------- wiring */

  /* This module's own dispatch tables, the shape js/stock.js (data-st),
     js/money.js (data-mn) and js/pos.js (data-pos) already use: `data-sm` for
     a click, `data-smv` for a change. Two listeners on the document, for the
     whole screen — a forty-tile rack that bound a handler per tile would
     rebuild forty listeners on every repaint, and every scan is a repaint. */
  var ACT = {}, CHG = {};

  var bound = false;
  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-sm]') : null;
      if (!el) return;
      var fn = ACT[el.getAttribute('data-sm')];
      if (fn) { e.preventDefault(); fn(el, e); }
    });

    document.addEventListener('change', function (e) {
      var el = e.target.closest ? e.target.closest('[data-smv]') : null;
      if (!el) return;
      var fn = CHG[el.getAttribute('data-smv')];
      if (fn) fn(el, e);
    });

    /* MANUAL ENTRY, and only manual entry.
       js/wedge.js already listens on the document and, when the keystrokes
       really were a scan, calls stopImmediatePropagation() on the terminating
       Enter — so this never sees one. It is registered from register(), which
       boot() calls long after wedge.js bound at load, which is what puts it
       second in line and makes that work. What reaches here is somebody
       typing a code off a scuffed box, slowly, by hand. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var box = e.target;
      if (!box || (box.id !== 'smScan' && box.id !== 'smScanFs')) return;
      var code = String(box.value || '').trim();
      box.value = '';
      if (!code) return;
      e.preventDefault();
      /* Past the wedge's own de-duplication window, which guards against a
         scanner re-reading a label it is resting on — not against a person
         deliberately typing the same code twice. */
      lastScan = null;
      onScan(code);
    });

    /* The peek, in the 2D view. Delegated at the document like everything
       else here, because the tiles are rebuilt on every scan and forty
       per-tile listeners would be rebuilt with them. */
    document.addEventListener('pointermove', function (e) {
      if (OG.view !== 'shelfmap' || use3d()) return;
      var el = e.target.closest ? e.target.closest('[data-peek]') : null;
      if (!el) { if (peekId != null) hidePeek(); return; }
      showPeek(+el.getAttribute('data-peek'), e.clientX, e.clientY);
    });
    /* A touch has no hover, and a card that survives the finger leaving is
       a card stuck to the screen. */
    /* …unless it is pinned: orbiting round the pressed bay is a press too. */
    document.addEventListener('pointerdown', function () { if (peekPin == null) hidePeek(); });
    window.addEventListener('scroll', function () {
      if (peekPin != null) dockPeek(); else if (peekId != null) hidePeek();
    }, true);
    window.addEventListener('resize', function () { if (peekPin != null) dockPeek(); });

    /* THE PADS. A press on a movement pad is a key held; the release, or a
       release anywhere at all, lets it go — a pad repainted under a finger
       never sends its own pointerup, so every pointerup on the document
       releases everything. Capture phase, so the room's own listeners and
       the drag tray cannot get in first. The look pad turns the head by
       how far the finger has moved since the last event. */
    var lookPtr = null, padDown = false;
    document.addEventListener('pointerdown', function (e) {
      if (typeof ShelfRoom === 'undefined' || !ShelfRoom.ready()) return;
      var pad = e.target.closest ? e.target.closest('[data-walk]') : null;
      if (pad) {
        e.preventDefault();
        try { pad.setPointerCapture(e.pointerId); } catch (x) {}
        pad.classList.add('down');
        padDown = true;
        ShelfRoom.walkKey(pad.getAttribute('data-walk'), true);
        return;
      }
      var lk = e.target.closest ? e.target.closest('[data-look]') : null;
      if (lk) {
        e.preventDefault();
        try { lk.setPointerCapture(e.pointerId); } catch (x) {}
        lookPtr = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!lookPtr || e.pointerId !== lookPtr.id) return;
      ShelfRoom.look((e.clientX - lookPtr.x) * 1.6, (e.clientY - lookPtr.y) * 1.6);
      lookPtr.x = e.clientX; lookPtr.y = e.clientY;
    }, true);
    var padUp = function () {
      lookPtr = null;
      if (!padDown) return;
      padDown = false;
      if (typeof ShelfRoom !== 'undefined' && ShelfRoom.ready()) ShelfRoom.walkKey(null, false);
      var down = document.querySelectorAll('.sm-pad.down');
      for (var i = 0; i < down.length; i++) down[i].classList.remove('down');
    };
    document.addEventListener('pointerup', padUp, true);
    document.addEventListener('pointercancel', padUp, true);
  }

  function register() {
    bind();
    /* -- looking ---------------------------------------------------- */
    ACT['tile'] = function (el) {
      var id = +el.getAttribute('data-id');
      S.sel = (S.sel === id) ? null : id;
      repaint();
    };

    CHG['room'] = function (el) {
      /* 'r:<id>' is a room; 's:<id>' is a rack not in one */
      var v = String(el.value);
      S.sel = null;
      if (v.charAt(0) === 'r') {
        S.roomId = +v.slice(2);
        var rs = racksIn(S.roomId);
        S.secId = rs.length ? rs[0].id : null;
      } else {
        S.secId = +v.slice(2);
        S.roomId = null;
      }
      repaint();
    };

    /* -- the two views ----------------------------------------------
       Switching is one state change and a repaint; the ANIMATION is the
       hand-off around it. Going to the room, the room opens looking
       straight at the rack the plan was showing and then eases back to
       where it can see the whole place, so the two drawings visibly share
       a subject. Coming back, the room turns to face that rack first and
       the surfaces cross-fade — otherwise the elevation appears out of a
       view that was pointing somewhere else entirely.

       Under reduced motion, or on a machine that never loaded the library,
       both paths are a plain repaint. */
    ACT['view-room'] = function () {
      if (S.view === 'room' || !can3d()) return;
      /* ASKED FOR, NOT FIRED. The first switch of a session is also the
         first time Three.js is fetched, so the room does not exist yet when
         this handler returns — calling intro() here would no-op exactly
         once, on the one switch a person is most likely to be watching.
         mount3d() spends the flag after the scene is attached and synced. */
      wantIntro = true;
      setView('room');
    };

    ACT['view-2d'] = function () {
      if (S.view === '2d') return;
      if (!can3d() || typeof ShelfRoom === 'undefined' || !ShelfRoom.ready()) { setView('2d'); return; }
      /* Turn to face the rack, THEN swap. The fade is on the stage, not on
         the canvas: fading a canvas fades the tag layer with it and the
         labels smear across the room on the way out. */
      var stage = document.querySelector('.sm-stage3d');
      if (stage) stage.classList.add('sm-leaving');
      ShelfRoom.outro(S.secId, function () { setView('2d'); });
    };

    ACT['room-reset'] = function () {
      if (typeof ShelfRoom !== 'undefined') ShelfRoom.view('reset');
      keepFocus();
    };
    ACT['room-fit'] = function () { if (typeof ShelfRoom !== 'undefined') ShelfRoom.view('fit'); keepFocus(); };
    ACT['room-top'] = function () { if (typeof ShelfRoom !== 'undefined') ShelfRoom.view('top'); keepFocus(); };
    ACT['room-front'] = function () { if (typeof ShelfRoom !== 'undefined') ShelfRoom.view('front'); keepFocus(); };

    /* -- the camera --------------------------------------------------
       The switch persists per machine and the room is told; the room's
       mode hook writes the same state back when a canned view hands the
       walk over to the orbit, so the buttons never disagree with the eye. */
    var setCam = function (m) {
      if (S.cam === m) return;
      S.cam = m;
      try { localStorage.setItem(CAM_KEY, m); } catch (e) {}
      if (typeof ShelfRoom !== 'undefined' && ShelfRoom.ready()) ShelfRoom.setMode(m);
      repaint();
    };
    ACT['cam-orbit'] = function () { setCam('orbit'); };
    ACT['cam-walk'] = function () { setCam('walk'); };
    ACT['pad-toggle'] = function () {
      S.pads = !showPads();
      try { localStorage.setItem(PADS_KEY, S.pads ? '1' : '0'); } catch (e) {}
      repaint();
    };

    /* -- fullscreen ---------------------------------------------------
       The room does the moving; the fs hook below does the painting. */
    ACT['room-full'] = function () {
      if (typeof ShelfRoom === 'undefined' || !ShelfRoom.ready()) return;
      ShelfRoom.fullscreen(!S.fs);
    };

    CHG['quality'] = function (el) {
      var q = el.value === 'high' || el.value === 'low' ? el.value : 'auto';
      S.quality = q;
      try {
        if (q === 'auto') localStorage.removeItem(QUALITY_KEY);
        else localStorage.setItem(QUALITY_KEY, q);
      } catch (e) {}
      if (typeof ShelfRoom !== 'undefined' && ShelfRoom.ready() && q !== 'auto') ShelfRoom.setQuality(q);
      toast(t('sm_quality_note'), '', '', 5000);
      keepFocus();
    };

    /* -- place my racks ----------------------------------------------- */
    ACT['room-fill'] = function () {
      var room = S.roomId != null ? roomById(S.roomId) : null;
      if (room) fillModal(room);
    };
    ACT['room-fill-go'] = function () { fillGo(); };
    /* fills the room's size boxes with the minimum the last refusal named */
    ACT['room-min'] = function (el) {
      var w = document.getElementById('smRmW'), d = document.getElementById('smRmD');
      if (w) w.value = el.getAttribute('data-w');
      if (d) d.value = el.getAttribute('data-d');
    };

    /* Persisted per machine, like sound. A repaint re-sends the model with
       the colours on or off and redraws the legend with it. */
    ACT['room-colour'] = function () {
      S.colour = !S.colour;
      try { localStorage.setItem(COLOUR_KEY, S.colour ? '1' : '0'); } catch (e) {}
      repaint();
    };

    /* The room reports a click, a hover and a death; the map decides what
       they mean. A pick is exactly a tile click — same toggle, same repaint
       — so the flat panel opens the same way from either surface, and a
       hover raises the same card the 2D view raises. */
    if (typeof ShelfRoom !== 'undefined') {
      ShelfRoom.hook({
        /* A press selects, and the room flies to the bay and the card pins
           beside it with what is on it. Pressing the selected bay again lets
           it go and flies back to where the first press was made. The flight
           starts after the repaint, because a repaint detaches the canvas
           and that stops any tween that is running. */
        pick: function (id) {
          var off = S.sel === id;
          S.sel = off ? null : id;
          peekPin = null;
          repaint();
          if (off) { ShelfRoom.back(); return; }
          if (ShelfRoom.focus(id)) { peekPin = id; showPinned(id); }
        },
        peek: function (id, x, y) {
          /* a pinned card stays put: the hover outline still follows the hand */
          if (peekPin != null) return;
          if (id == null) hidePeek(); else showPeek(id, x, y);
        },
        /* Escape flew the camera back out: the card goes with it. The bay
           stays selected — the flat panel still says what it is. */
        unfocus: function () { peekPin = null; hidePeek(); },
        lost: function () { glFail(t('sm_gl_lost')); },
        /* A rack was let go somewhere legal; `at` is metres along the wall. */
        move: function (id, wall, at) { placeRack(id, wall, at); },
        /* A rack is in the air; info is null when it lands. */
        drag: function (info, x, y) { showHud(info, x, y); },
        /* What would not fit, once the room knows its own size. */
        fit: function (list) { paintFit(list); },
        /* A wall was pulled to a new size. */
        room: function (w, d) { sizeRoom(w, d); },
        /* A grip was let go with a different number of bays or levels. */
        grow: function (g) { growSave(g); },
        /* In or out of fullscreen. The stage becomes a placeholder while
           the wrapper is out on <body>, and the overlay carries the
           controls; both are painted from here and nowhere else. */
        fs: function (on, kind) {
          var was = S.fs;
          S.fs = !!on; S.fsKind = kind || null;
          if (was !== S.fs) { hidePeek(); repaint(); } else paintOverlay();
        },
        /* The body-level nodes to bring inside the wrapper for fullscreen. */
        fsNodes: function () {
          return [hudNode(), peekNode(), document.getElementById('toasts'), document.getElementById('modal-root')];
        },
        /* May the room have the arrow keys right now? Not over a dialog. */
        keys: function () { return OG.view === 'shelfmap' && !modalOpen(); },
        /* The room changed its own mode (a canned view ends the walk). */
        mode: function (m) {
          if (S.cam === m) return;
          S.cam = m;
          try { localStorage.setItem(CAM_KEY, m); } catch (e) {}
          repaint();
        },
        quality: function () { return S.quality; },
        /* The room timed its first frames and gave up on the high tier. */
        qualityAuto: function (q) {
          S.quality = q;
          try { localStorage.setItem(QUALITY_KEY, q); } catch (e) {}
          toast(t('sm_quality_dropped'), '', '', 6000);
          var sel = document.querySelector('[data-smv="quality"]');
          if (sel) sel.value = q;
        }
      });
    }

    /* -- the editor -------------------------------------------------- */
    ACT['edit'] = function () { S.edit = !S.edit; if (!S.edit) stopPlacing(); repaint(); };
    ACT['rack-add-go'] = function () { startPlacing(); };
    /* the layout changed on another screen, and this person says take it */
    ACT['live-take'] = function () { takeLive(); };

    ACT['seed'] = function (el) {
      var id = +el.getAttribute('data-id');
      var rows = +document.getElementById('smSeedR').value;
      var cols = +document.getElementById('smSeedC').value;
      var cap = document.getElementById('smSeedCap').value;
      API.post('/api/sections/' + id + '/grid', {
        rows: rows, cols: cols, capacity: cap === '' ? null : +cap
      }).then(function () { reload(); })
        .catch(function (err) { toast(API.friendly(err), '', 'warn'); });
    };

    ACT['add-here'] = function (el) {
      var sec = current();
      if (!sec) return;
      API.post('/api/shelves', {
        sectionId: sec.id,
        rowLabel: el.getAttribute('data-row'),
        colIndex: +el.getAttribute('data-col')
      }).then(function (res) {
        reload().then(function () {
          if (res.shelf) { S.sel = res.shelf.id; repaint(); }
        });
      }).catch(function (err) { toast(API.friendly(err), '', 'warn'); });
    };

    ACT['row-add'] = function () {
      var sec = current();
      if (sec) rowsCols('rows', { action: 'add' });
    };
    ACT['col-add'] = function () {
      var sec = current();
      if (sec) rowsCols('cols', { action: 'add' });
    };
    ACT['row-rm'] = function (el) {
      removeRC('rows', { action: 'remove', row: el.getAttribute('data-row') },
               t('sm_remove_level').replace('{x}', el.getAttribute('data-row')));
    };
    ACT['col-rm'] = function (el) {
      removeRC('cols', { action: 'remove', col: +el.getAttribute('data-col') },
               t('sm_remove_bay').replace('{x}', el.getAttribute('data-col')));
    };

    ACT['save'] = function (el) {
      var id = +el.getAttribute('data-id');
      var code = document.getElementById('smCode').value.trim().toUpperCase();
      var cap = document.getElementById('smCap').value;
      var pid = document.getElementById('smProd').value;
      var from = document.getElementById('smFrom').value;
      var to = document.getElementById('smTo').value;
      assignFlow(id, {
        code: code,
        capacity: cap === '' ? null : +cap,
        productId: pid === '' ? null : +pid,
        sizeFrom: from === '' ? null : from,
        sizeTo: to === '' ? null : to
      });
    };

    ACT['del'] = function (el) {
      var id = +el.getAttribute('data-id');
      API.del('/api/shelves/' + id).then(function () {
        S.sel = null; reload();
      }).catch(function (err) {
        /* The server's refusal carries the count: "M-A3 has 5". */
        toast(API.friendly(err), '', 'warn', 5000);
      });
    };

    /* The product pick rebuilds the from/to selects for that product's own
       run — patching just that span, not the whole map, so the two inputs
       beside it keep their values. */
    CHG['prod-pick'] = function (el) {
      var span = document.getElementById('smRange');
      if (span) span.outerHTML = rangeSelects(el.value === '' ? null : +el.value, null, null);
    };

    /* -- rooms -------------------------------------------------------- */
    /* -- racks -------------------------------------------------------- */
    /* LOOKING IS NOT TARGETING. This cleared S.sel, which was harmless while
       the only way here was the designer — but the plan strip is something a
       person taps mid-run, and losing the put-away target because you glanced
       at the next rack is how a box ends up on the floor. The scan strip goes
       on saying, in words, which bay the next barcode files onto. */
    ACT['rack-focus'] = function (el) { focus(+el.getAttribute('data-id')); repaint(); };
    ACT['rack-new'] = function () { rackModal(null); };
    ACT['rack-cfg'] = function (el) { rackModal(sectionById(+el.getAttribute('data-id'))); };
    /* A quarter turn for a free-standing rack where it stands: the touch
       screen's R. Saved on the press; a refusal (an aisle it would narrow)
       says so and the reload puts the truth back. */
    ACT['rack-rot'] = function (el) {
      var s = sectionById(+el.getAttribute('data-id'));
      if (!s || !isFree(s)) return;
      API.patch('/api/sections/' + s.id, {
        roomId: s.room_id, placement: 'free', xCm: s.x_cm, yCm: s.y_cm, rotDeg: (s.rot_deg + 90) % 360
      }).then(function () { reload(); })
        .catch(function (err) { toast(layoutError(err), s.key, 'warn', 7000); reload(); });
    };
    /* The rack dialog: a wall shows its position box, the floor its three. */
    CHG['rk-place'] = function (el) {
      var f = el.value === 'free';
      var pos = document.getElementById('smRkPosField'), fr = document.getElementById('smRkFree');
      if (pos) pos.style.display = f ? 'none' : '';
      if (fr) fr.style.display = f ? '' : 'none';
    };
    ACT['rack-save'] = function (el) {
      var id = el.getAttribute('data-id');
      var val = function (i) { var e = document.getElementById(i); return e ? e.value : ''; };
      var sel = val('smRkWall');
      var free = sel === 'free';
      var wall = free ? null : (sel || null);
      var cmOrNull = function (i) { return val(i) === '' ? null : +val(i); };
      var body = {
        name: val('smRkName').trim(),
        gridOrigin: (document.querySelector('input[name="smRkOrigin"]:checked') || {}).value || 'left',
        roomId: val('smRkRoom') ? +val('smRkRoom') : null,
        placement: free ? 'free' : 'wall',
        wall: wall,
        wallCm: wall ? (val('smRkPos') === '' ? 0 : +val('smRkPos')) : null,
        /* blank means the standard rack; the server stores NULL */
        bayCm: cmOrNull('smRkBay'), levelCm: cmOrNull('smRkLevel'), depthCm: cmOrNull('smRkDepth')
      };
      if (free) {
        body.xCm = cmOrNull('smRkX');
        body.yCm = cmOrNull('smRkY');
        body.rotDeg = +val('smRkRot');
      }
      if (id) {
        API.patch('/api/sections/' + id, body)
          .then(function () { closeModal(); focus(+id); reload(); })
          .catch(function (err) { toast(layoutError(err), '', 'warn', 6000); });
      } else {
        body.whId = val('smRkWh');
        body.key = val('smRkKey').trim().toUpperCase();
        API.post('/api/sections', body).then(function (res) {
          closeModal();
          focus(res.section.id);
          reload();
        }).catch(function (err) { toast(layoutError(err), '', 'warn', 6000); });
      }
    };
    ACT['rack-del'] = function (el) {
      API.del('/api/sections/' + el.getAttribute('data-id'))
        .then(function () { closeModal(); S.secId = null; load(); })
        .catch(function (err) { toast(API.friendly(err), '', 'warn', 5000); });
    };

    /* -- rooms -------------------------------------------------------- */
    ACT['room-new'] = function () { roomModal(null); };
    /* No data-id means "the room on screen". Without the fallback this fell
       through to roomById(NaN) → null, which roomModal reads as "make a new
       one" — a Room settings button that opened the New room dialog. */
    ACT['room-cfg'] = function (el) {
      var id = el.getAttribute('data-id');
      roomModal(id ? roomById(+id) : (S.roomId != null ? roomById(S.roomId) : null));
    };
    ACT['room-save'] = function (el) {
      var id = el.getAttribute('data-id');
      var val = function (i) { var e = document.getElementById(i); return e ? e.value : ''; };
      var cm = function (i) { return val(i) === '' ? null : +val(i); };
      var body = { name: val('smRmName').trim(), widthCm: cm('smRmW'), depthCm: cm('smRmD'), heightCm: cm('smRmH') };
      /* A refusal for size stays IN the dialog, with the minimum the
         server named and a button that fills it in — a toast over a
         closed dialog leaves the person retyping three numbers from
         memory. */
      var refused = function (err) {
        var d = err && err.detail;
        var fit = document.getElementById('smRmFit');
        if (fit && d && d.code === 'room_too_small') {
          fit.hidden = false;
          fit.innerHTML = esc(layoutError(err)) +
            ' <button class="btn btn-sm btn-ghost" data-sm="room-min" data-w="' + (+d.min_width_cm || '') +
            '" data-d="' + (+d.min_depth_cm || '') + '">' + t('sm_use_min') + '</button>';
          return;
        }
        toast(layoutError(err), '', 'warn', 6000);
      };
      if (id) {
        API.patch('/api/rooms/' + id, body)
          .then(function (res) {
            closeModal();
            sayShrunk(res && res.room ? res.room.shrunk : null);
            reload();
          })
          .catch(refused);
      } else {
        body.whId = val('smRmWh');
        API.post('/api/rooms', body).then(function (res) {
          closeModal();
          /* the new room, empty, with the designer open on it — the next
             thing anybody does is hang a rack in it. And if this building
             has racks waiting, the offer to hang them is one press away. */
          S.roomId = res.room.id; S.secId = null; S.sel = null; S.edit = true;
          reload().then(function () {
            var room = roomById(res.room.id);
            if (room && fillable(room).length) fillModal(room);
          });
        }).catch(refused);
      }
    };
    ACT['room-del'] = function (el) {
      API.del('/api/rooms/' + el.getAttribute('data-id'))
        .then(function () { closeModal(); S.roomId = null; S.secId = null; load(); })
        .catch(function (err) { toast(API.friendly(err), '', 'warn', 6000); });
    };

    /* -- confirm + reprint ------------------------------------------- */
    ACT['confirm-apply'] = function () {
      closeModal();
      if (pendingApply) { var f = pendingApply; pendingApply = null; f(); }
    };
    /* Same mechanics, its own name: the row/column removal confirm. */
    ACT['remove-go'] = ACT['confirm-apply'];
    ACT['confirm-reprint'] = function (el) {
      /* The label picker opens its own modal on top; the confirm's pending
         apply is dropped on purpose — reprinting first, then re-doing the
         change, keeps every step deliberate. One sticker per pair on hand,
         through the same preview every other label goes through; the 60x40
         template carries the shelf code. */
      pendingApply = null;
      openQuickLabelPicker(+el.getAttribute('data-id'), { perPair: true });
    };

    ACT['print-shelf'] = function (el) {
      var hit = shelfById(+el.getAttribute('data-id'));
      if (hit) Labels60.openShelfLabels(hit.sec.wh_id, { sectionId: hit.sec.id, code: hit.sh.code });
    };

    /* -- the scan run ------------------------------------------------- */
    ACT['sound'] = function () {
      S.sound = !S.sound;
      try { localStorage.setItem(SOUND_KEY, S.sound ? '1' : '0'); } catch (e) {}
      /* Play the change so the toggle proves itself — turning sound ON in
         silence tells you nothing about whether this tablet has a speaker. */
      if (S.sound) beep('shelf');
      repaint();
    };
    ACT['undo'] = function (el) { undoChip(+el.getAttribute('data-id')); };
    ACT['chips-clear'] = function () { S.chips = []; repaint(); };

    /* -- the Settings list (same route, same flow) -------------------- */
    CHG['set-assign'] = function (el) {
      var id = +el.getAttribute('data-id');
      var pid = el.value;
      assignFlow(id, { productId: pid === '' ? null : +pid }, function () {
        var host = document.getElementById('setShelves');
        if (host) settingsList(host, true);
      });
    };

    /* DRAGGING A RACK OUT OF THE LIST AND INTO THE ROOM.
       The unplaced list is where a rack with nowhere to be waits, so it is
       also where placing one ought to start. A press does not become a drag
       until the hand has moved, or the row stops being a button — the same
       bargain the room itself strikes between picking a bay and moving a
       rack. */
    var tray = null;

    var trayEnd = function (e) {
      if (!tray) return;
      var was = tray;
      tray = null;
      document.body.classList.remove('sm-dragging');
      hideHud();
      if (!was.live) return;
      var put = ShelfRoom.drop(e.clientX, e.clientY);
      if (put) placeRack(put.id, put.wall, put.at);
      else ShelfRoom.cancelDrag();
    };

    document.addEventListener('pointerdown', function (e) {
      tray = null;
      if (OG.view !== 'shelfmap' || !use3d() || !S.edit || !canEdit()) return;
      if (typeof ShelfRoom === 'undefined' || !ShelfRoom.ready()) return;
      var el = e.target.closest ? e.target.closest('[data-drag]') : null;
      if (!el) return;
      tray = {
        id: +el.getAttribute('data-drag'),
        shape: {
          cols: +el.getAttribute('data-cols') || 1,
          rows: +el.getAttribute('data-rows') || 1,
          /* centimetres on the row, metres in the room */
          bay: (+el.getAttribute('data-bay') || 0) / 100,
          level: (+el.getAttribute('data-level') || 0) / 100,
          depth: (+el.getAttribute('data-depth') || 0) / 100,
          /* a free-standing rack stays one in the air */
          placement: el.getAttribute('data-placement') || 'wall',
          rot: +el.getAttribute('data-rot') || 0
        },
        x: e.clientX, y: e.clientY, live: false
      };
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
    });

    document.addEventListener('pointermove', function (e) {
      if (!tray) return;
      if (!tray.live) {
        if (Math.abs(e.clientX - tray.x) + Math.abs(e.clientY - tray.y) < 8) return;
        tray.live = ShelfRoom.grab(tray.id, tray.shape, true);
        if (!tray.live) { tray = null; return; }
        document.body.classList.add('sm-dragging');
      }
      showHud(ShelfRoom.dragTo(e.clientX, e.clientY), e.clientX, e.clientY);
    });

    document.addEventListener('pointerup', trayEnd);
    document.addEventListener('pointercancel', trayEnd);

    /* PLACING A NEW RACK. It follows the hand over the room from the moment
       Place it is pressed; a press on the room puts it down where the ghost
       stands — a wall rack only on a wall — and Escape, or a press anywhere
       else, puts it back. Capture phase, so the room's own press (an orbit,
       a pick) never sees the press that places it. */
    document.addEventListener('pointermove', function (e) {
      if (!placing || typeof ShelfRoom === 'undefined' || !ShelfRoom.ready()) return;
      var info = ShelfRoom.dragTo(e.clientX, e.clientY);
      if (info) showHud(info, e.clientX, e.clientY);
    });
    document.addEventListener('pointerdown', function (e) {
      if (!placing) return;
      var onRoom = e.target && e.target.closest ? e.target.closest('.sm-gl') : null;
      if (!onRoom) {
        if (!(e.target && e.target.closest && e.target.closest('[data-sm="rack-add-go"]'))) stopPlacing();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      var p = placing;
      var info = ShelfRoom.dragTo(e.clientX, e.clientY);
      if (!info || !info.ok || (p.shape.placement !== 'free' && !info.wall)) {
        if (info) showHud(info, e.clientX, e.clientY);
        return;
      }
      var put = ShelfRoom.drop(e.clientX, e.clientY);
      placing = null;
      document.body.classList.remove('sm-dragging');
      hideHud();
      if (put) createRackAt(p, put);
    }, true);
    document.addEventListener('keydown', function (e) {
      if (!placing || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      stopPlacing();
    }, true);

    if (typeof Wedge !== 'undefined' && Wedge.onScan) Wedge.onScan(onScan);
  }

  function rowsCols(kind, body) {
    var sec = current();
    API.post('/api/sections/' + sec.id + '/' + kind, body)
      .then(function () { reload(); })
      .catch(function (err) { toast(layoutError(err, kind), '', 'warn', 7000); });
  }

  /* A grip let go in the room: that many bays or levels more, or fewer — one
     request, one transaction on the server, which still decides. */
  function growSave(g) {
    var kind = g.kind === 'bays' ? 'cols' : 'rows';
    var body = g.to > g.from ? { action: 'add', count: g.to - g.from } : { action: 'remove', last: g.from - g.to };
    API.post('/api/sections/' + g.id + '/' + kind, body)
      .then(function () { focus(g.id); reload(); })
      .catch(function (err) { toast(layoutError(err, kind), '', 'warn', 7000); reload(); });
  }

  /* ---------------------------------------------------- adding a rack
     (Stage C) From inside the room: on a wall or standing free, how many
     bays and levels, then carried into place like any rack and written ON
     RELEASE. Its letter is the next free one; its size is the room's — the
     server gives a new rack the bay, level and depth the racks already there
     share, and the ghost is drawn at the same numbers (roomShape, the twin). */
  var placing = null;          /* a new rack in the air: { shape, whId, key, roomId } */

  function roomShape(roomId) {
    var all = racksIn(roomId), built = all.filter(function (s) { return s.shelves.length; });
    var commonest = function (vals, dflt) {
      if (!vals.length) return dflt;
      var seen = {};
      vals.forEach(function (v) { seen[v] = (seen[v] || 0) + 1; });
      return Object.keys(seen).map(Number).sort(function (a, b) { return seen[b] - seen[a] || a - b; })[0];
    };
    var g = S.geometry || { bay_cm: 114, level_cm: 46, depth_cm: 95 };
    return {
      bay: commonest(all.map(function (s) { return rackSize(s).bay; }), g.bay_cm),
      level: commonest(all.map(function (s) { return rackSize(s).level; }), g.level_cm),
      depth: commonest(all.map(function (s) { return rackSize(s).depth; }), g.depth_cm),
      cols: commonest(built.map(function (s) { return Math.max(1, geometry(s).maxCol); }), 6),
      rows: commonest(built.map(function (s) { return Math.max(1, geometry(s).rows); }), 4)
    };
  }

  function nextKey(whId) {
    var used = {};
    (S.data || []).forEach(function (s) { if (s.wh_id === whId) used[s.key] = 1; });
    for (var i = 0; i < ALPHA.length; i++) if (!used[ALPHA.charAt(i)]) return ALPHA.charAt(i);
    return null;
  }

  function addRackForm(room) {
    var sh = roomShape(room.id);
    var measured = !!(room.width_cm && room.depth_cm);
    return '<div class="sm-dz sm-addrk"><span class="lbl">' + t('sm_add_rack') + '</span>' +
      '<div class="sm-dz-row sm-addrk-kind">' +
        '<label><input type="radio" name="smAddKind" value="wall" checked> ' + t('sm_add_wall') + '</label>' +
        '<label' + (measured ? '' : ' class="muted" title="' + esc(t('sm_err_free_unmeasured')) + '"') + '>' +
          '<input type="radio" name="smAddKind" value="free"' + (measured ? '' : ' disabled') + '> ' + t('sm_free') + '</label>' +
      '</div>' +
      '<div class="sm-dz-row">' +
        '<label class="field"><span>' + t('sm_bays') + '</span>' +
          '<input class="inp num" id="smAddCols" type="number" min="1" max="99" value="' + sh.cols + '"></label>' +
        '<label class="field"><span>' + t('sm_levels') + '</span>' +
          '<input class="inp num" id="smAddRows" type="number" min="1" max="26" value="' + sh.rows + '"></label>' +
      '</div>' +
      '<div class="sm-dz-row"><button class="btn btn-sm btn-primary" data-sm="rack-add-go">' + t('sm_add_place') + '</button></div>' +
      '<div class="muted sm-dz-note">' + t('sm_add_hint') + '</div>' +
    '</div>';
  }

  function startPlacing() {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    if (!room || typeof ShelfRoom === 'undefined' || !ShelfRoom.ready()) return false;
    var key = nextKey(room.wh_id);
    if (!key) { toast(t('sm_add_no_letter'), '', 'warn', 6000); return false; }
    var kindEl = document.querySelector('input[name="smAddKind"]:checked');
    var num = function (id, lo, hi, d) {
      var el = document.getElementById(id), v = el ? Math.round(+el.value) : d;
      return v >= lo && v <= hi ? v : d;
    };
    var sh = roomShape(room.id);
    var shape = { cols: num('smAddCols', 1, 99, sh.cols), rows: num('smAddRows', 1, 26, sh.rows),
                  bay: sh.bay / 100, level: sh.level / 100, depth: sh.depth / 100,
                  placement: kindEl && kindEl.value === 'free' ? 'free' : 'wall', rot: 0 };
    if (!ShelfRoom.grab('new', shape, true)) return false;
    placing = { shape: shape, whId: room.wh_id, key: key, roomId: room.id };
    document.body.classList.add('sm-dragging');
    return true;
  }

  function stopPlacing() {
    if (!placing) return;
    placing = null;
    document.body.classList.remove('sm-dragging');
    hideHud();
    if (typeof ShelfRoom !== 'undefined' && ShelfRoom.ready()) ShelfRoom.cancelDrag();
  }

  /* No size is sent: the server takes the room's, which is what the ghost
     was drawn at. The grid comes in the same request, so a refusal leaves
     nothing behind. */
  function createRackAt(p, put) {
    var body = { whId: p.whId, key: p.key, name: t('sm_add_name').replace('{k}', p.key), roomId: p.roomId,
                 rows: p.shape.rows, cols: p.shape.cols };
    if (put.wall === 'free') {
      body.placement = 'free';
      body.xCm = Math.round(put.at.x * 100); body.yCm = Math.round(put.at.y * 100); body.rotDeg = put.at.rot;
    } else {
      body.placement = 'wall'; body.wall = put.wall; body.wallCm = Math.round(put.at * 100);
    }
    return API.post('/api/sections', body).then(function (res) {
      if (res && res.section) focus(res.section.id);
      return reload();
    }).catch(function (err) { toast(layoutError(err), '', 'warn', 7000); reload(); });
  }

  /* Removing a row of empty shelves is one click from erasing a row of
     assignments, so it asks first — with the standing rule restated, because
     "the rows stay A, C, D" looks like a bug until you know that renumbering
     would invalidate every printed label in the room. */
  function removeRC(kind, body, title) {
    var sec = current();
    var doomed = sec.shelves.filter(function (sh) {
      return kind === 'rows' ? sh.row_label === body.row : sh.col_index === body.col;
    });
    var assigned = doomed.filter(function (sh) { return sh.product_id != null; }).length;
    openModal({
      title: title,
      size: 'narrow',
      body: '<p>' + t('sm_remove_n').replace('{n}', nf(doomed.length))
              .replace('{a}', nf(assigned)) + '</p>' +
            '<p class="muted">' + t('sm_no_renumber') + '</p>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
            '<button class="btn btn-primary" data-sm="remove-go">' + t('sm_remove_go') + '</button>'
    });
    pendingApply = function () { rowsCols(kind, body); };
  }

  /* The warehouse chooser both modals share: a select when there is a
     choice, a hidden field when there is not. */
  function whField(id, whId) {
    if (DB.warehouses.length > 1) {
      var h = '<label class="field"><span>' + t('warehouse') + '</span><select class="inp" id="' + id + '">';
      DB.warehouses.forEach(function (w) {
        h += '<option value="' + esc(w.id) + '"' + (w.id === whId ? ' selected' : '') + '>' +
             esc(OG.lang === 'ar' ? w.nameAr : w.name) + '</option>';
      });
      return h + '</select></label>';
    }
    return '<input type="hidden" id="' + id + '" value="' + esc(DB.warehouses[0].id) + '">';
  }

  /* A rack: its letter (once), its name, which end its columns start from,
     and where it hangs. The letters left are shown because they can run
     out now that every rack in every room draws from the same 26. */
  function rackModal(sec) {
    var room = S.roomId != null ? roomById(S.roomId) : null;
    var whId = sec ? sec.wh_id : (room ? room.wh_id : DB.warehouses[0].id);
    var b = '';
    if (!sec) {
      var used = {};
      (S.data || []).forEach(function (s) { if (s.wh_id === whId) used[s.key] = 1; });
      var free = ALPHA.split('').filter(function (L) { return !used[L]; });
      b += '<label class="field"><span>' + t('sm_rack_key') + '</span>' +
           '<input class="inp" id="smRkKey" type="text" maxlength="1" dir="ltr" value="' + (free[0] || '') + '" ' +
           'style="width:70px;text-transform:uppercase"></label>' +
           whField('smRkWh', whId);
    }
    b += '<label class="field"><span>' + t('sm_rack_name') + '</span>' +
         '<input class="inp" id="smRkName" type="text" value="' + esc(sec ? sec.name : '') + '"></label>';

    var origin = sec ? sec.grid_origin : 'left';
    b += '<div class="field"><span>' + t('sm_origin') + '</span>' +
      '<label class="check"><input type="radio" name="smRkOrigin" value="left"' +
        (origin === 'left' ? ' checked' : '') + '><span>' + t('sm_origin_left') + '</span></label>' +
      '<label class="check"><input type="radio" name="smRkOrigin" value="right"' +
        (origin === 'right' ? ' checked' : '') + '><span>' + t('sm_origin_right') + '</span></label>' +
      '<small class="muted">' + t('sm_origin_hint') + '</small></div>';

    /* where it hangs: a room in the same building, a wall of it, a place
       along that wall */
    var rid = sec && sec.room_id != null ? sec.room_id : (room ? room.id : null);
    b += '<label class="field"><span>' + t('sm_room') + '</span><select class="inp" id="smRkRoom">' +
         '<option value="">' + t('sm_nowhere') + '</option>';
    (S.rooms || []).filter(function (r) { return r.wh_id === whId; }).forEach(function (r) {
      b += '<option value="' + r.id + '"' + (r.id === rid ? ' selected' : '') + '>' + esc(r.name) + '</option>';
    });
    b += '</select></label>';
    /* ON A WALL OR ON THE FLOOR (051) — one choice in one list, because a
       rack is one or the other and never both; the fields for the other kind
       step out of the way rather than sitting there empty. */
    var wall = sec ? sec.wall : null;
    var standsFree = !!(sec && isFree(sec));
    var rots = (S.limits && S.limits.rotations) || [0, 90, 180, 270];
    var aisleCm = S.limits && S.limits.aisle_min_cm != null ? S.limits.aisle_min_cm : null;
    b += '<div class="row2">' +
      '<label class="field"><span>' + t('sm_wall') + '</span><select class="inp" id="smRkWall" data-smv="rk-place">' +
        '<option value="">' + t('sm_nowhere') + '</option>' +
        ['n', 'e', 's', 'w'].map(function (w) {
          return '<option value="' + w + '"' + (!standsFree && w === wall ? ' selected' : '') + '>' + esc(t('sm_wall_' + w)) + '</option>';
        }).join('') +
        '<option value="free"' + (standsFree ? ' selected' : '') + '>' + esc(t('sm_free')) + '</option>' +
        '</select></label>' +
      '<label class="field" id="smRkPosField"' + (standsFree ? ' style="display:none"' : '') + '><span>' + t('sm_wall_cm') + '</span>' +
        '<input class="inp num" id="smRkPos" type="number" min="0" step="5" value="' +
          (sec && sec.wall_cm != null ? sec.wall_cm : 0) + '"></label>' +
    '</div>' +
    '<div id="smRkFree"' + (standsFree ? '' : ' style="display:none"') + '><div class="row3">' +
      '<label class="field"><span>' + t('sm_free_x') + '</span>' +
        '<input class="inp num" id="smRkX" type="number" min="0" step="5" dir="ltr" value="' + (standsFree ? sec.x_cm : '') + '"></label>' +
      '<label class="field"><span>' + t('sm_free_y') + '</span>' +
        '<input class="inp num" id="smRkY" type="number" min="0" step="5" dir="ltr" value="' + (standsFree ? sec.y_cm : '') + '"></label>' +
      '<label class="field"><span>' + t('sm_rot') + '</span><select class="inp" id="smRkRot" dir="ltr">' +
        rots.map(function (d) {
          return '<option value="' + d + '"' + (standsFree && d === sec.rot_deg ? ' selected' : '') + '>' + d + '°</option>';
        }).join('') + '</select></label>' +
    '</div>' +
    (aisleCm ? '<small class="muted">' + esc(t('sm_free_hint')).replace('{n}', '<span dir="ltr">' + nf(aisleCm) + '</span>') + '</small>' : '') +
    '</div>';

    /* HOW BIG IT IS. Blank is the shop's standard rack — the placeholder
       says what that is — and a number is this rack's own. The limits are
       the server's (RACK_LIMITS), sent with the layout. */
    var g = S.geometry || { bay_cm: 114, level_cm: 46, depth_cm: 95 };
    /* A NEW rack in a room that already has racks is given THAT room's size
       by the server (createSection, Stage C), not the standard — so the
       placeholder and the sentence say the room's. An existing rack left blank
       is still the standard, which is what a blank column means. */
    var roomSized = !sec && rid != null && racksIn(rid).length > 0;
    if (roomSized) {
      var rs = roomShape(rid);
      g = { bay_cm: rs.bay, level_cm: rs.level, depth_cm: rs.depth };
    }
    var lim = (S.limits && S.limits.rack) || { bay: [60, 300], level: [10, 200], depth: [20, 200] };
    var sizeBox = function (id, key, v, def, l) {
      return '<label class="field"><span>' + t(key) + '</span>' +
        '<input class="inp num" id="' + id + '" type="number" min="' + l[0] + '" max="' + l[1] + '" ' +
          'placeholder="' + def + '" value="' + (v == null ? '' : v) + '"></label>';
    };
    b += '<div class="field"><span>' + t('sm_rack_size') + '</span></div>' +
      '<div class="row3">' +
        sizeBox('smRkBay', 'sm_rack_bay', sec ? sec.bay_cm : null, g.bay_cm, lim.bay) +
        sizeBox('smRkLevel', 'sm_rack_level', sec ? sec.level_cm : null, g.level_cm, lim.level) +
        sizeBox('smRkDepth', 'sm_rack_depth', sec ? sec.depth_cm : null, g.depth_cm, lim.depth) +
      '</div><small class="muted">' +
        esc(t(roomSized ? 'sm_rack_size_hint_room' : 'sm_rack_size_hint')
          .replace('{b}', nf(g.bay_cm)).replace('{l}', nf(g.level_cm)).replace('{d}', nf(g.depth_cm))) +
      '</small>';

    openModal({
      title: sec ? (sec.key + ' · ' + sec.name) : t('sm_new_rack'),
      size: 'narrow',
      body: b,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        (sec && !sec.shelves.length
          ? '<button class="btn btn-ghost danger" data-sm="rack-del" data-id="' + sec.id + '">' +
            t('sm_delete_rack') + '</button>'
          : '') +
        '<button class="btn btn-primary" data-sm="rack-save"' +
          (sec ? ' data-id="' + sec.id + '"' : '') + '>' + t('save') + '</button>'
    });
  }

  /* A room: a name, a building, and — if somebody has measured it — a size.
     Left empty, the walls go where the racks need them. */
  function roomModal(room) {
    var b = '';
    if (!room) b += whField('smRmWh', DB.warehouses[0].id);
    b += '<label class="field"><span>' + t('sm_room_name') + '</span>' +
         '<input class="inp" id="smRmName" type="text" value="' + esc(room ? room.name : '') + '"></label>';
    var max = (S.limits && S.limits.room_max_cm) || 10000;
    var cm = function (id, key, v) {
      return '<label class="field"><span>' + t(key) + '</span>' +
             '<input class="inp num" id="' + id + '" type="number" min="1" max="' + max + '" value="' + (v == null ? '' : v) + '"></label>';
    };
    b += '<div class="row3">' +
      cm('smRmW', 'sm_room_w', room ? room.width_cm : null) +
      cm('smRmD', 'sm_room_d', room ? room.depth_cm : null) +
      cm('smRmH', 'sm_room_h', room ? room.height_cm : null) +
    '</div><small class="muted">' + t('sm_measure_hint') + ' ' +
      esc(t('sm_room_max').replace('{n}', nf(max / 100))) + '</small>' +
    /* filled in by room-save when the server says the racks would not fit */
    '<div class="sm-fit" id="smRmFit" hidden></div>';

    openModal({
      title: room ? room.name : t('sm_new_room'),
      size: 'narrow',
      body: b,
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        (room && !racksIn(room.id).length
          ? '<button class="btn btn-ghost danger" data-sm="room-del" data-id="' + room.id + '">' +
            t('sm_delete_room') + '</button>'
          : '') +
        '<button class="btn btn-primary" data-sm="room-save"' +
          (room ? ' data-id="' + room.id + '"' : '') + '>' + t('save') + '</button>'
    });
  }

  /* ---------------------------------------------------- the Settings list */

  /* The coarse list: every room, every shelf, the assignment select — the
     same control the map's panel has, hitting the same route.

     afterSettings() runs after EVERY render of that screen, so this caches
     for a short window the way loadStaffPresence() does — refetching on
     every keystroke elsewhere in Settings would repaint the list under the
     user's pointer for no news. A write through smset-assign passes `force`,
     because its whole point is that something changed. */
  var setFreshAt = 0, setCache = null, setPending = null;
  var SET_FRESH_MS = 30 * 1000;

  /* The room list as a promise, for every screen that needs to NAME a shelf
     without drawing the map — the Settings list below, and the shelf picker
     on the Add product form.

     Always every room in every warehouse, never `?wh=`: a caller that wants
     one warehouse filters on wh_id itself, and fetching per warehouse would
     go back to the server the moment somebody flipped that select.

     `setPending` is not belt and braces. bindWarehouse() runs after EVERY
     render of the warehouse screen, and a render lands on the same tick as
     the first fetch often enough — without it, two requests go out and the
     slower answer paints over the newer one. */
  function cachedSections(force) {
    if (!force && setCache && Date.now() - setFreshAt < SET_FRESH_MS) {
      return Promise.resolve(setCache);
    }
    if (!force && setPending) return setPending;
    setPending = Shop.sections().then(function (res) {
      setCache = res.sections || [];
      setFreshAt = Date.now();
      setPending = null;
      return setCache;
    }, function (err) {
      /* Left null rather than cached, so the next paint retries instead of
         showing the same failure for thirty seconds. */
      setPending = null;
      throw err;
    });
    return setPending;
  }

  /* Called after anything that moves stock onto a shelf, so the next reader
     asks the server instead of drawing a shelf as empty when something was
     just put on it. */
  function invalidate() { setCache = null; setFreshAt = 0; }

  function settingsList(host, force) {
    if (!force && setCache && Date.now() - setFreshAt < SET_FRESH_MS &&
        host.getAttribute('data-painted')) {
      return;
    }
    cachedSections(force).then(function (secs) {
      host.setAttribute('data-painted', '1');
      if (!secs.length) {
        host.innerHTML = '<div class="muted">' + t('sm_no_rooms') + '</div>';
        return;
      }
      var products = DB.products.filter(function (p) { return !p.archived; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });

      var h = '';
      secs.forEach(function (s) {
        h += '<div class="sm-set-sec"><b>' + esc(s.key) + '</b> · ' + esc(s.name) + '</div>';
        if (!s.shelves.length) {
          h += '<div class="muted sm-set-none">' + t('sm_rack_empty') + '</div>';
          return;
        }
        h += '<table class="tbl sm-set-tbl"><tbody>';
        s.shelves.forEach(function (sh) {
          h += '<tr><td class="mono">' + esc(sh.full_code) + '</td><td>' +
            '<select class="inp" data-smv="set-assign" data-id="' + sh.id + '">' +
            '<option value="">' + t('sm_unassigned_opt') + '</option>';
          products.forEach(function (p) {
            h += '<option value="' + p.id + '"' + (p.id === sh.product_id ? ' selected' : '') + '>' +
                 esc(p.name) + '</option>';
          });
          h += '</select></td>' +
            '<td class="muted">' + (sh.range ? esc(sh.range) : '') + '</td>' +
            '<td class="num">' + nf(sh.qty) + '</td></tr>';
        });
        h += '</tbody></table>';
      });
      host.innerHTML = h;
    }).catch(function (err) {
      host.innerHTML = '<div class="partner-note note-danger">' + esc(API.friendly(err)) + '</div>';
    });
  }

  return {
    view: view,
    after: after,
    owns: owns,
    register: register,
    reload: reload,
    assignFlow: assignFlow,
    settingsList: settingsList,
    /* The rooms themselves, for screens that name a shelf without drawing
       one. `S.data` stays private — this is a separate, short-lived cache. */
    cachedSections: cachedSections,
    invalidate: invalidate,
    /* Stage C: js/pulse.js calls this on a `shelves` event */
    live: live,
    /* for a harness */
    liveState: function () {
      return { fresh: !!liveFresh, line: !!S.liveLine, held: !!liveHold, busy: busy(), placing: !!placing };
    },
    livePollMs: function (ms) {
      LIVE_POLL_MS = ms;
      if (livePollT) { clearInterval(livePollT); livePollT = null; }
      livePoll();
    },
    placing: function () { return placing ? { key: placing.key, shape: placing.shape } : null; }
  };
})();
