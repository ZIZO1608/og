/* ==========================================================================
   SETTINGS → THE PEOPLE                                              [Staff]
   --------------------------------------------------------------------------
   Night shift 03. The shop hired people through two different screens with
   different fields and different behaviour: Settings → Access asked for a
   name, a username and a ROLE off a dropdown of seven; the Safeers screen
   asked for a name, a PHONE and a username with the role implied. One had
   Copy on the password shown once, the other had only Done — a password to
   be retyped off a phone screen. Switching somebody off asked nothing at
   all in one of them, and named the open work in the other.

   This is the one hiring screen. People are cards; adding one is a dialog
   with five big job choices; resetting a password and switching somebody
   off are under the card's "…".

   THE JOB DESCRIPTIONS ARE DERIVED FROM THE PERMISSIONS THAT ARE ACTUALLY
   STORED, never from the role's name and never from the seed file — this
   shop's `role_permissions` differs from `003_role_permissions.sql` in at
   least two rows, and a screen that reads the seed would describe a job
   nobody here has. "Close the day" was shown to a cashier who can only
   count the drawer; that mistake is not repeatable from here.

   Events: data-st (click), and the module's own state — which card's "…" is
   open — is held in S.menu, because this card is repainted whenever a load
   lands and a class put on a node by a click does not survive that.
   ========================================================================== */

var Staff = (function () {

  var S = { people: null, roles: null, loading: false, menu: null, shown: null };

  /* WHAT EACH JOB CAN DO, in one line, from the stored matrix. The order is
     the order a shopkeeper would say them in, and a permission that is not
     held simply does not appear. */
  var SAYS = [
    { perm: 'sell', key: 'st_d_sell' },
    { perm: 'delivery.desk', key: 'st_d_desk' },
    { perm: 'stock.move', key: 'st_d_stock' },
    { perm: 'product.write', key: 'st_d_products' },
    { perm: 'delivery.write', key: 'st_d_carry' },
    { perm: 'money.count', key: 'st_d_count' },
    { perm: 'money.move', key: 'st_d_money' },
    { perm: 'report.read', key: 'st_d_reports' },
    { perm: 'staff.write', key: 'st_d_people' }
  ];

  /* The jobs somebody is hired into. `partner` is deliberately absent: Yalla
     Wear is another company, their two logins exist, and nobody should be
     able to make a third from the shop's staff screen. */
  var JOBS = ['cashier', 'warehouse', 'delivery', 'manager', 'owner'];

  function load(force) {
    if (S.loading || (S.people && !force)) return;
    S.loading = true;
    var want = [API.get('/api/access'), API.get('/api/roles')];
    Promise.all(want).then(function (r) {
      S.people = r[0].people;
      S.roles = r[1];
      S.loading = false;
      if (OG.view === 'settings') keep();
    }, function () { S.loading = false; });
  }

  function keep() {
    var v = document.querySelector('.view');
    var y = v ? v.scrollTop : 0;
    render();
    v = document.querySelector('.view');
    if (v) v.scrollTop = y;
  }

  /* The matrix arrives as whatever `Auth.permissionMatrix()` returns; this
     asks it one question and does not care about its shape beyond that. */
  function roleHas(role, perm) {
    var rows = S.roles && S.roles.permissions;
    if (!rows) return false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].perm !== perm) continue;
      var cell = (rows[i].roles || {})[role];
      return !!(cell && cell.allowed);
    }
    return false;
  }

  /* "Sells, and counts the drawer at night" — assembled from what the role
     really holds, capped at three so it stays a line and not a list. */
  function jobLine(role) {
    var said = [];
    SAYS.forEach(function (x) {
      if (said.length < 3 && roleHas(role, x.perm)) said.push(t(x.key));
    });
    if (!said.length) return t('st_d_nothing');
    return said.join(' · ');
  }

  function roleName(role) {
    var k = 'st_j_' + role;
    var s = t(k);
    return s === k ? roleLabel(role) : s;
  }

  /* ------------------------------------------------------------- the card */

  function card() {
    /* access.write, not staff.write: every route behind this card — add,
       reset a password, switch somebody off, change what they can do — is
       access.write on the server, and a card that draws and then gets 403 on
       every button is worse than no card. */
    if (!allow('access.write')) return '';
    if (!S.people) load();
    var list = S.people || [];
    var on = list.filter(function (p) { return p.active; }).length;
    var meta = '<span dir="ltr">' + on + '</span> ' + t('st_working').toLowerCase();

    var h = setFoldStart('staff', t('st_people'), meta, t('st_people_sub')) + '<div class="card-body">';

    if (S.shown) h += onceHtml();

    if (!S.people) return h + '<div class="muted small">…</div></div>' + setFoldEnd();

    h += '<div class="st-grid">';
    list.forEach(function (p) { h += personCard(p); });
    h += '</div>';

    h += '<button class="btn btn-primary mt" data-st="add">' + t('st_add_person') + '</button>';
    return h + '</div>' + setFoldEnd();
  }

  function personCard(p) {
    var me = acct() && acct().id === p.id;
    var open = S.menu === p.id;
    return '<div class="st-card' + (p.active ? '' : ' is-off') + (open ? ' is-menu' : '') + '">' +
      '<span class="st-face" style="background:' + personTint(p.id) + '">' + esc(personFace(p.name)) + '</span>' +
      '<div class="st-who"><b>' + esc(p.name) + '</b>' +
        '<small>' + esc(roleName(p.role)) + ' · <bdi dir="ltr">' + esc(p.username) + '</bdi></small>' +
        (p.phone ? '<small><bdi dir="ltr">' + esc(p.phone) + '</bdi></small>' : '') +
      '</div>' +
      '<span class="badge ' + (p.active ? 'healthy' : 'neutral') + '">' +
        t(p.active ? 'st_working' : 'st_switched_off') + '</span>' +
      '<div class="st-acts">' +
        (allow('access.write')
          ? '<button class="btn btn-sm" data-st="perms" data-id="' + p.id + '">' + t('st_change_perms') + '</button>'
          : '') +
        '<div class="st-more">' +
          '<button class="btn btn-sm btn-ghost st-dots" data-st="menu" data-id="' + p.id + '" ' +
            'aria-label="' + esc(t('cb_more')) + '">…</button>' +
          '<div class="st-menu">' +
            '<button class="st-mitem" data-st="pw" data-id="' + p.id + '">' + t('ac_new_pw') + '</button>' +
            (me ? '' :
              '<button class="st-mitem" data-st="active" data-id="' + p.id + '" data-on="' + (p.active ? '0' : '1') + '">' +
                t(p.active ? 'ac_switch_off' : 'ac_switch_on') + '</button>') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* A password is shown ONCE, with Copy — both screens must do that, and one
     of them used to offer only "Done". */
  function onceHtml() {
    return '<div class="ac-once" role="status"><b>' + esc(t('ac_pw_once').replace('{name}', S.shown.name)) + '</b>' +
      '<div class="ac-once-row"><code dir="ltr" id="stOncePw">' + esc(S.shown.password) + '</code>' +
      '<button class="btn btn-sm" data-st="copy">' + t('st_copy') + '</button>' +
      '<button class="btn btn-sm btn-ghost" data-st="hide-once">' + t('ac_done') + '</button></div>' +
      '<small class="muted">' + t('st_pw_once') + '</small></div>';
  }

  /* ------------------------------------------------------ adding a person */

  var ADD = null;   /* { name, phone, username, role, userTouched } */

  function openAdd() {
    if (!S.roles) load();
    ADD = { name: '', phone: '', username: '', role: 'cashier', userTouched: false };
    openModal({
      title: t('st_add_person'), size: 'narrow',
      body: '<div id="stAddBody">' + addBody() + '</div>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        '<button class="btn btn-primary" data-st="add-go">' + t('st_add_person') + '</button>'
    });
  }

  function addBody() {
    return '<label class="field"><span>' + t('name') + '</span>' +
        '<input class="inp" id="stName" maxlength="60" value="' + esc(ADD.name) + '" data-stc="name"></label>' +
      '<label class="field mt"><span>' + t('phone') + '</span>' +
        '<input class="inp" id="stPhone" dir="ltr" maxlength="30" value="' + esc(ADD.phone) + '" data-stc="phone"></label>' +
      '<div class="lbl mt">' + t('st_their_job') + '</div>' +
      '<div class="st-jobs">' + JOBS.map(function (r) {
        return '<button type="button" class="st-job' + (ADD.role === r ? ' on' : '') + '" data-st="job" data-r="' + r + '">' +
          '<b>' + esc(roleName(r)) + '</b><small>' + esc(jobLine(r)) + '</small></button>';
      }).join('') + '</div>' +
      /* Suggested from the name, and still editable — the server refuses a
         username that is taken, and somebody called Ahmad is the third one. */
      '<label class="field mt"><span>' + t('ac_username') + '</span>' +
        '<input class="inp" id="stUser" dir="ltr" maxlength="32" autocomplete="off" spellcheck="false" ' +
          'value="' + esc(ADD.username || suggest(ADD.name)) + '" data-stc="user"></label>' +
      '<div class="muted small">' + t('st_pw_made') + '</div>';
  }

  function repaintAdd() {
    var host = document.getElementById('stAddBody');
    if (!host) return;
    /* The name and the phone hold a caret, so only the job row and the
       suggested username are redrawn. */
    var jobs = host.querySelector('.st-jobs');
    if (jobs) {
      Array.prototype.forEach.call(jobs.children, function (b) {
        b.classList.toggle('on', b.getAttribute('data-r') === ADD.role);
      });
    }
    var u = document.getElementById('stUser');
    if (u && !ADD.userTouched) u.value = suggest(ADD.name);
  }

  /* Latin letters and digits only — a username is typed at a login box on a
     machine whose keyboard layout nobody controls. An Arabic name gives
     nothing, and the box is then filled by hand. */
  function suggest(name) {
    var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    return s.slice(0, 20);
  }

  /* ------------------------------------- switching somebody off, carefully */

  /* WHAT THIS PERSON IS STILL HOLDING. Read from what the browser already
     has — the board's parcels, the safeers' errands, the open shift and the
     cash a driver has not handed in — and said in ONE sentence before
     anything happens. Switching an account off re-points its waiting work to
     "Former staff", and that must never happen silently on live work. */
  function openWork(p) {
    var out = { parcels: [], errands: 0, shift: false, cash: null };
    (DB.deliveries || []).forEach(function (d) {
      if (String(d.driverId || d.driver_id || '') !== String(p.id)) return;
      var st = d.status;
      if (st === 'waiting' || st === 'out') out.parcels.push(d);
    });
    /* The errands the Safeers screen last loaded. It is not always loaded,
       and that is said rather than counted as zero. */
    var sf = ((typeof Safeers !== 'undefined' && Safeers.errands && Safeers.errands()) || []).filter(function (e) {
      return String(e.userId || e.user_id || '') === String(p.id) &&
             (e.status === 'waiting' || e.status === 'out');
    });
    out.errands = sf.length;
    var sh = DB.currentShift && DB.currentShift();
    if (sh && String(sh.userId || sh.user_id || '') === String(p.id)) out.shift = true;
    var cash = (DB.cash && DB.cash.places) || [];
    cash.forEach(function (pl) {
      if (pl.id === 'driver:' + p.id) {
        var any = Object.keys(pl.balances || {}).some(function (c) { return pl.balances[c] !== 0; });
        if (any) out.cash = pl.balances;
      }
    });
    return out;
  }

  function openSwitchOff(p) {
    var w = openWork(p);
    var n = w.parcels.length + w.errands + (w.shift ? 1 : 0) + (w.cash ? 1 : 0);
    var bits = [];
    if (w.parcels.length) bits.push(t('st_off_parcels').replace('{n}', w.parcels.length));
    if (w.errands) bits.push(t('st_off_errands').replace('{n}', w.errands));
    if (w.shift) bits.push(t('st_off_shift'));
    if (w.cash) {
      bits.push(t('st_off_cash').replace('{x}', Object.keys(w.cash).map(function (c) {
        return Cashbook.money(w.cash[c], c);
      }).join(' + ')));
    }

    openModal({
      title: t('ac_switch_off') + ' · ' + esc(p.name), size: 'narrow',
      body: (n
        ? '<div class="cb-why">' + t('st_off_holds').replace('{name}', esc(p.name)).replace('{n}', n) + '</div>' +
          '<ul class="pr-stop-list">' + bits.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul>' +
          (w.parcels.length ? '<p class="muted small mt">' + t('st_off_reassign_hint') + '</p>' : '')
        : '<p>' + t('st_off_clean').replace('{name}', esc(p.name)) + '</p>') +
        '<p class="muted small mt">' + t('st_off_what') + '</p>',
      foot: '<button class="btn btn-ghost" data-act="modal-close">' + t('cancel') + '</button>' +
        (w.parcels.length
          ? '<button class="btn" data-st="off-reassign" data-id="' + p.id + '">' + t('dl_reassign') + '</button>'
          : '') +
        '<button class="btn btn-primary" data-st="off-go" data-id="' + p.id + '">' + t('ac_switch_off') + '</button>'
    });
  }

  /* ----------------------------------------------------------- the wiring */

  function person(id) {
    return (S.people || []).filter(function (p) { return String(p.id) === String(id); })[0] || null;
  }

  function closeMenus() {
    if (S.menu === null) return;
    S.menu = null;
    document.querySelectorAll('.st-card.is-menu').forEach(function (c) { c.classList.remove('is-menu'); });
  }

  var ACT = {
    menu: function (el) {
      var id = +el.getAttribute('data-id');
      var was = S.menu === id;
      closeMenus();
      if (!was) {
        S.menu = id;
        var card = el.closest('.st-card');
        if (card) card.classList.add('is-menu');
      }
    },

    perms: function (el) {
      /* The fine-grained switches are AccessUI's, and they are the owner's
         and the developer's — access.write, on the server too. */
      var id = +el.getAttribute('data-id');
      closeMenus();
      if (typeof AccessUI !== 'undefined') AccessUI.openFor(id);
    },

    add: function () { closeMenus(); openAdd(); },

    job: function (el) { ADD.role = el.getAttribute('data-r'); repaintAdd(); },

    'add-go': function (el) {
      var name = String((document.getElementById('stName') || {}).value || '').trim();
      var user = String((document.getElementById('stUser') || {}).value || '').trim();
      var phone = String((document.getElementById('stPhone') || {}).value || '').trim();
      if (!name || !user) { toast(t('st_add_person'), t('ac_need_both'), 'warn'); return; }
      el.disabled = true;
      API.post('/api/access/people', { name: name, username: user, role: ADD.role, phone: phone })
        .then(function (r) {
          S.shown = { name: r.user.name, password: r.password };
          closeModal();
          load(true);
          keep();
          toast(t('st_add_person'), t('ac_added').replace('{name}', r.user.name), 'ok', 3000);
        }, function (err) { el.disabled = false; toast(t('st_add_person'), API.friendly(err), 'err', 5000); });
    },

    pw: function (el) {
      var id = +el.getAttribute('data-id');
      var who = person(id);
      closeMenus();
      API.post('/api/access/' + id + '/password', {}).then(function (r) {
        S.shown = { name: who ? who.name : '', password: r.password };
        keep();
      }, function (err) { toast(t('st_people'), API.friendly(err), 'err'); });
    },

    active: function (el) {
      var id = +el.getAttribute('data-id');
      var on = el.getAttribute('data-on') === '1';
      var who = person(id);
      closeMenus();
      /* Switching somebody ON asks nothing — it takes nothing away. */
      if (on) { setActive(id, true); return; }
      if (who) openSwitchOff(who);
    },

    'off-go': function (el) { closeModal(); setActive(+el.getAttribute('data-id'), false); },

    'off-reassign': function (el) {
      /* The board is where a parcel changes hands, and it is the one screen
         that knows what else is going out today. Nothing is reassigned from
         here by itself. */
      var id = +el.getAttribute('data-id');
      closeModal();
      OG.dl = OG.dl || {};
      OG.dl.driver = String(id);
      if (typeof go === 'function') go('deliveries');
    },

    copy: function () {
      var txt = S.shown ? S.shown.password : '';
      try { navigator.clipboard.writeText(txt).then(function () { toast(t('st_people'), t('st_copied'), 'ok', 1500); }); }
      catch (e) { /* it is on screen to read */ }
    },

    'hide-once': function () { S.shown = null; keep(); }
  };

  function setActive(id, on) {
    API.post('/api/access/' + id + '/active', { active: on }).then(function () {
      load(true);
      toast(t('st_people'), t(on ? 'ac_now_on' : 'ac_now_off'), 'ok', 2500);
    }, function (err) { toast(t('st_people'), API.friendly(err), 'err', 5000); });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-st]') : null;
    if (!b) {
      /* A press anywhere else shuts an open "…". Capture phase, so it runs
         before the delegated dispatcher decides what the press meant. */
      if (!(e.target.closest && e.target.closest('.st-more'))) closeMenus();
      return;
    }
    var fn = ACT[b.getAttribute('data-st')];
    if (fn) { e.preventDefault(); fn(b, e); }
  }, true);

  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-stc');
    if (!k || !ADD) return;
    if (k === 'name') { ADD.name = e.target.value; repaintAdd(); }
    if (k === 'phone') ADD.phone = e.target.value;
    if (k === 'user') { ADD.username = e.target.value; ADD.userTouched = true; }
  });

  return {
    card: card,
    jobLine: jobLine,
    reset: function () { S.people = null; S.roles = null; S.menu = null; S.shown = null; },
    /* FIX 05 — the card's "…" menu, for the one route-change cleanup. */
    menuOpen: function () { return S.menu !== null && S.menu !== undefined; },
    closeMenu: closeMenus
  };
})();
