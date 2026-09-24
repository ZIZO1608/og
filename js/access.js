/* ==========================================================================
   SETTINGS → ACCESS                                                [AccessUI]
   --------------------------------------------------------------------------
   Migration 059. The owner (and a developer) open or close any permission
   for one person in a tap, add a person, switch one off, give one a new
   password. access.write only — on the server, and here.

   - Each switch saves the moment it moves, with a toast, and says whether the
     answer is the role's or this person's own. A switch that cannot move says
     why (pinned to the owner, or forbidden to Yalla Wear).
   - A password is shown ONCE — when a person is added or reset — with a copy
     button, and never again here. Reading an existing password is the
     developer panel's job, over its own pipe.
   - "Former staff" is never listed (the server leaves it out).

   Events are delegated: data-ac (click), data-ac-sw (a switch's change).
   ========================================================================== */

var AccessUI = (function () {

  var S = { people: null, open: null, detail: null, loading: false, shown: null, sw: null };

  function permLabel(p) {
    var k = 'perm_' + String(p.perm).replace(/\./g, '_');
    var s = t(k);
    return s === k ? p.label : s;
  }

  function load(force) {
    if (S.loading || (S.people && !force)) return;
    S.loading = true;
    API.get('/api/access').then(function (r) {
      S.people = r.people;
      S.loading = false;
      if (OG.view === 'settings') keep();
    }, function () { S.loading = false; });
  }

  /* Redraws this card alone (24 Sep 2026): a switch used to redraw the whole
     of Settings twice a tap — once when it saved, once when the list came
     back — thousands of elements for one card. The switch being saved is
     disabled meanwhile, which takes the focus off it, so it is named in
     S.sw and given the focus back once the card is new. */
  function keep() {
    if (OG.view !== 'settings') return;
    if (!setFoldRepaint('access', card())) render();
    if (S.sw) {
      var el = document.querySelector('[data-ac-sw="' + S.sw.perm + '"][data-id="' + S.sw.id + '"]');
      if (el && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
      S.sw = null;
    }
  }

  function card() {
    if (!allow('access.write')) return '';
    if (!S.people) load();
    var list = S.people || [];
    var on = list.filter(function (p) { return p.active; }).length;
    var meta = '<span dir="ltr">' + on + '</span> ' + t('ac_can_sign_in');
    var h = setFoldStart('access', t('ac_title'), meta) + '<div class="card-body">' +
      '<p class="muted small ac-note">' + t('ac_note') + '</p>';

    if (S.shown) {
      h += '<div class="ac-once" role="status"><b>' + esc(t('ac_pw_once').replace('{name}', S.shown.name)) + '</b>' +
        '<div class="ac-once-row"><code dir="ltr" id="acOncePw">' + esc(S.shown.password) + '</code>' +
        '<button class="btn btn-sm" data-ac="copy">' + t('ac_copy') + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-ac="hide-once">' + t('ac_done') + '</button></div>' +
        '<small class="muted">' + t('ac_pw_once_sub') + '</small></div>';
    }

    if (!S.people) { h += '<div class="muted small">…</div>'; return h + '</div>' + setFoldEnd(); }

    h += '<div class="ac-list">';
    list.forEach(function (p) {
      var open = S.open === p.id;
      h += '<div class="ac-person' + (open ? ' open' : '') + (p.active ? '' : ' is-off') + '">' +
        '<button class="ac-head" data-ac="open" data-id="' + p.id + '" aria-expanded="' + open + '">' +
          '<span class="ac-face">' + esc(initialsOf(p.name)) + '</span>' +
          '<span class="ac-who"><b>' + esc(p.name) + '</b><small><bdi dir="ltr">' + esc(p.username) + '</bdi> · ' +
            esc(roleLabel(p.role)) + (p.changed ? ' · <span class="ac-changed">' + t('ac_n_changed').replace('{n}', p.changed) + '</span>' : '') +
          '</small></span>' +
          '<span class="badge ' + (p.active ? 'healthy' : 'neutral') + '">' + t(p.active ? 'ac_active' : 'ac_off') + '</span>' +
        '</button>';
      if (open) h += detailHtml(p);
      h += '</div>';
    });
    h += '</div>';

    h += '<div class="ac-add"><b>' + t('ac_add') + '</b><div class="ac-add-row">' +
      '<label class="field"><span>' + t('ac_name') + '</span><input class="inp" id="acName" maxlength="60"></label>' +
      '<label class="field"><span>' + t('ac_username') + '</span><input class="inp" id="acUser" dir="ltr" maxlength="32" autocomplete="off" spellcheck="false"></label>' +
      '<label class="field"><span>' + t('role') + '</span><select class="inp" id="acRole">' +
        ['owner', 'developer', 'manager', 'cashier', 'warehouse', 'delivery', 'partner'].map(function (r) {
          return '<option value="' + r + '"' + (r === 'cashier' ? ' selected' : '') + '>' + esc(roleLabel(r)) + '</option>';
        }).join('') + '</select></label>' +
      '<button class="btn btn-primary" data-ac="add">' + t('ac_add_btn') + '</button></div></div>';

    return h + '</div>' + setFoldEnd();
  }

  function detailHtml(p) {
    var d = S.detail && S.detail.user.id === p.id ? S.detail : null;
    if (!d) return '<div class="ac-detail muted small">…</div>';
    var self = acct() && acct().id === p.id;
    var h = '<div class="ac-detail"><div class="ac-actions">' +
      (p.changed ? '<button class="btn btn-sm" data-ac="reset" data-id="' + p.id + '">' + t('ac_reset_role') + '</button>' : '') +
      '<button class="btn btn-sm" data-ac="password" data-id="' + p.id + '">' + t('ac_new_pw') + '</button>' +
      (self ? '' : '<button class="btn btn-sm ' + (p.active ? 'btn-ghost' : 'btn-primary') + '" data-ac="active" data-id="' + p.id +
        '" data-on="' + (p.active ? '0' : '1') + '">' + t(p.active ? 'ac_switch_off' : 'ac_switch_on') + '</button>') +
      '</div>';
    var group = null;
    d.permissions.forEach(function (x) {
      if (x.group !== group) {
        if (group !== null) h += '</div>';
        group = x.group;
        h += '<div class="ac-group"><div class="ac-gh">' + esc(t('pg_' + x.group)) + '</div>';
      }
      var why = x.locked === 'pinned' ? t('ac_why_pinned') : x.locked === 'forbidden' ? t('ac_why_forbidden') : '';
      h += '<label class="ac-row' + (x.changed ? ' is-changed' : '') + '"' + (why ? ' title="' + esc(why) + '"' : '') + '>' +
        '<span class="ac-label">' + esc(permLabel(x)) +
          '<small>' + (x.locked ? esc(why) : x.changed ? t('ac_for_person') : t('ac_from_role')) + '</small></span>' +
        '<span class="switch"><input type="checkbox" data-ac-sw="' + esc(x.perm) + '" data-id="' + p.id + '"' +
          (x.allowed ? ' checked' : '') + (x.locked ? ' disabled' : '') + '><i></i></span>' +
      '</label>';
    });
    if (group !== null) h += '</div>';
    return h + '</div>';
  }

  function openPerson(id) {
    if (S.open === id) { S.open = null; S.detail = null; keep(); return; }
    S.open = id;
    S.detail = null;
    keep();
    API.get('/api/access/' + id).then(function (r) { S.detail = r; if (OG.view === 'settings') keep(); },
      function (e) { toast(t('ac_title'), API.friendly(e), 'err'); });
  }

  function after(r, msg) {
    if (r && r.permissions) S.detail = r;
    load(true);
    if (msg) toast(t('ac_title'), msg, 'ok', 2200);
  }

  document.addEventListener('change', function (e) {
    var el = e.target;
    var perm = el.getAttribute && el.getAttribute('data-ac-sw');
    if (!perm) return;
    var id = +el.getAttribute('data-id');
    var on = el.checked;
    S.sw = { perm: perm, id: id };
    el.disabled = true;
    API.put('/api/access/' + id + '/perm', { perm: perm, allowed: on }).then(function (r) {
      var row = (r.permissions || []).filter(function (x) { return x.perm === perm; })[0];
      after(r, (on ? t('ac_opened') : t('ac_closed')).replace('{what}', row ? permLabel(row) : perm));
      /* my own switch: the menu follows on my next request */
      if (acct() && acct().id === id && Auth.refresh) Auth.refresh();
    }, function (err) {
      el.checked = !on;
      el.disabled = false;
      toast(t('ac_title'), API.friendly(err), 'err', 5000);
    });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-ac]') : null;
    if (!b) return;
    var a = b.getAttribute('data-ac');
    var id = +b.getAttribute('data-id');
    if (a === 'open') { openPerson(id); return; }
    if (a === 'reset') {
      API.post('/api/access/' + id + '/reset', {}).then(function (r) { after(r, t('ac_reset_done')); },
        function (err) { toast(t('ac_title'), API.friendly(err), 'err'); });
      return;
    }
    if (a === 'active') {
      var on = b.getAttribute('data-on') === '1';
      API.post('/api/access/' + id + '/active', { active: on }).then(function () {
        after(null, t(on ? 'ac_now_on' : 'ac_now_off'));
      }, function (err) { toast(t('ac_title'), API.friendly(err), 'err', 5000); });
      return;
    }
    if (a === 'password') {
      var who = (S.people || []).filter(function (p) { return p.id === id; })[0];
      API.post('/api/access/' + id + '/password', {}).then(function (r) {
        S.shown = { name: who ? who.name : '', password: r.password };
        after(null, t('ac_pw_new'));
        keep();
      }, function (err) { toast(t('ac_title'), API.friendly(err), 'err'); });
      return;
    }
    if (a === 'add') {
      var name = (document.getElementById('acName') || {}).value || '';
      var user = (document.getElementById('acUser') || {}).value || '';
      var role = (document.getElementById('acRole') || {}).value || 'cashier';
      if (!name.trim() || !user.trim()) { toast(t('ac_add'), t('ac_need_both'), 'warn'); return; }
      b.disabled = true;
      API.post('/api/access/people', { name: name.trim(), username: user.trim(), role: role }).then(function (r) {
        S.shown = { name: r.user.name, password: r.password };
        after(null, t('ac_added').replace('{name}', r.user.name));
        keep();
      }, function (err) { b.disabled = false; toast(t('ac_add'), API.friendly(err), 'err', 5000); });
      return;
    }
    if (a === 'copy') {
      var txt = S.shown ? S.shown.password : '';
      try { navigator.clipboard.writeText(txt).then(function () { toast(t('ac_title'), t('ac_copied'), 'ok', 1500); }); }
      catch (err) { /* the code is on screen to read */ }
      return;
    }
    if (a === 'hide-once') { S.shown = null; keep(); }
  });

  return {
    card: card, permLabel: permLabel,
    /* “Change what they can do” on a person's staff card lands here: the same
       switches, opened on that person, rather than a second copy of them. */
    openFor: function (id) {
      if (typeof setFoldRemember === 'function') setFoldRemember('access', true);
      load();
      openPerson(id);
      var tries = 0;
      (function find() {
        var f = document.querySelector('[data-fold="access"]');
        if (f) f.scrollIntoView({ block: 'start' });
        if (++tries < 12) setTimeout(find, 140);
      })();
    },
    reset: function () { S.people = null; S.detail = null; S.open = null; S.shown = null; }
  };
})();
