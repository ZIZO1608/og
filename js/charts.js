/* ==========================================================================
   OG SYSTEM — charts
   Thin wrapper over Chart.js. If the CDN is unreachable (offline meeting
   room, blocked wifi) every function silently falls back to a CSS-bar
   rendering so no screen ever breaks or shows an empty box.
   ========================================================================== */

var Charts = (function () {

  /* The accent is read off the page, not baked in: the shop's lime and the
     partner portal's mint are the same token, --brand, on two bodies. */
  function brandColor() {
    try {
      var v = getComputedStyle(document.body).getPropertyValue('--brand').trim();
      if (v) return v;
    } catch (e) { /* no DOM */ }
    return '#C6FF00';
  }

  var registry = {};   // canvasId -> Chart instance
  /* What the chart was ASKED for, kept beside the instance it produced.

     printSnapshot() below has to rebuild the same chart in paper colours, and
     the two things it cannot recover from a live Chart.js instance are the
     value formatter (a closure, normalised away into the options tree) and
     which bar was highlighted. Reading them back out of `chart.options` worked
     until it did not — Chart.js is free to move where a callback lives between
     versions, and the failure is a printed axis reading "1250000" where the
     screen said "1.3M". Stored at the call, where they are facts. */
  var asked = {};      // canvasId -> { fmt, highlight, horizontal }

  function has() { return typeof window.Chart !== 'undefined'; }

  function compact(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }

  function destroy(id) {
    if (registry[id]) { try { registry[id].destroy(); } catch (e) {} delete registry[id]; }
    delete asked[id];
  }

  function destroyAll() { Object.keys(registry).forEach(destroy); }

  /* Dark theme: lime leads, then a light-to-dark zinc ramp so slices stay
     separable against the near-black card. */
  var RAMP = [brandColor(), '#FAFAFA', '#A1A1AA', '#7E8B99', '#5B5B66', '#3F3F46', '#8A6E3A', '#3A5478'];
  var INK = brandColor();        /* series colour */
  var LINE = '#27272A';       /* gridlines */
  var MUTED = '#A1A1AA';      /* tick labels */
  var SURFACE = '#141417';    /* card background, used for donut segment gaps */

  /* Charts draw themselves in rather than appearing finished: bars grow in
     sequence, lines sweep left to right. The per-point delay is what makes it
     read as drawing rather than fading.

     Honoured only when motion is allowed — under prefers-reduced-motion the
     chart snaps to its final state like everything else. */
  function anim(perPoint) {
    if (typeof Motion !== 'undefined' && Motion.reduced()) return { duration: 0 };
    return {
      duration: 620,
      easing: 'easeOutQuart',
      delay: function (ctx) {
        /* `active` fires on hover; delaying those would make tooltips feel
           broken, so the stagger applies to the initial draw only. */
        if (ctx.type !== 'data' || ctx.mode !== 'default') return 0;
        return ctx.dataIndex * (perPoint || 18);
      }
    };
  }

  function baseOpts(extra) {
    var o = {
      responsive: true,
      maintainAspectRatio: false,
      animation: anim(18),
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1B1B1F',
          titleFont: { family: 'Montserrat, sans-serif', size: 12.5, weight: '700' },
          bodyFont: { family: 'Montserrat, sans-serif', size: 12.5, weight: '500' },
          titleColor: '#FAFAFA',
          bodyColor: '#FAFAFA',
          borderColor: '#4A6600',
          borderWidth: 1,
          cornerRadius: 10,
          padding: 12,
          displayColors: false
        }
      }
    };
    return Object.assign(o, extra || {});
  }

  /* Category axis keeps its labels; only the value axis gets the money formatter.
     With horizontal bars those two axes swap, so build them as a pair. */
  function axisPair(fmt, horizontal) {
    var category = {
      grid: { display: false },
      border: { color: LINE },
      ticks: { color: MUTED, font: { family: 'Montserrat, sans-serif', size: 11.5, weight: '500' }, autoSkip: false }
    };
    var value = {
      beginAtZero: true,
      grid: { color: LINE, drawTicks: false },
      border: { display: false },
      ticks: {
        color: MUTED, font: { family: 'Montserrat, sans-serif', size: 11.5, weight: '500' }, padding: 10,
        callback: function (v) { return fmt ? fmt(v) : compact(v); }
      }
    };
    return horizontal ? { x: value, y: category } : { x: category, y: value };
  }

  function gridScales(fmt) { return axisPair(fmt, false); }

  /* ------------------------------------------------------------- fallbacks */

  /* The bar lives inside a fixed track, so the widest value can never push its
     own label out of the container. */
  function fallbackBars(canvas, labels, values, fmt) {
    var host = canvas.parentNode;
    var max = Math.max.apply(null, values.concat([1]));
    var html = '<div class="chart-fallback">';
    /* Peak in lime, the rest uniform — a ramp here reads as arbitrary on a
       time series, and the labels already carry the categories. */
    labels.forEach(function (l, i) {
      var pct = Math.max(2, Math.round(values[i] / max * 100));
      var col = values[i] === max ? brandColor() : '#3F3F46';
      html += '<div class="fb-row"><span class="fb-label">' + l + '</span>' +
              '<span class="fb-track"><i class="fb-bar" style="width:' + pct + '%;background:' + col + '"></i></span>' +
              '<span class="fb-val">' + (fmt ? fmt(values[i]) : compact(values[i])) + '</span></div>';
    });
    html += '</div>';
    host.innerHTML = html;
  }

  /* ------------------------------------------------------------- public API */

  function line(canvas, labels, values, opts) {
    opts = opts || {};
    if (!canvas) return;
    if (!has()) return fallbackBars(canvas, labels, values, opts.fmt);
    destroy(canvas.id);
    asked[canvas.id] = { kind: 'line', fmt: opts.fmt, highlight: opts.highlight, horizontal: !!opts.horizontal };
    try {
      var ctx = canvas.getContext('2d');
      var fill = ctx.createLinearGradient(0, 0, 0, canvas.parentNode.clientHeight || 220);
      fill.addColorStop(0, 'rgba(198,255,0,.30)');
      fill.addColorStop(1, 'rgba(198,255,0,0)');

      registry[canvas.id] = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            borderColor: INK,
            borderWidth: 2.5,
            backgroundColor: fill,
            fill: true,
            tension: .35,
            pointBackgroundColor: '#0A0A0B',
            pointBorderColor: INK,
            pointBorderWidth: 2.5,
            pointRadius: 4.5,
            pointHoverRadius: 7
          }]
        },
        options: baseOpts({
          scales: gridScales(opts.fmt),
          plugins: Object.assign(baseOpts().plugins, {
            tooltip: Object.assign(baseOpts().plugins.tooltip, {
              callbacks: { label: function (c) { return opts.fmt ? opts.fmt(c.parsed.y) : compact(c.parsed.y); } }
            })
          })
        })
      });
    } catch (e) { fallbackBars(canvas, labels, values, opts.fmt); }
  }

  function bars(canvas, labels, values, opts) {
    opts = opts || {};
    if (!canvas) return;
    if (!has()) return fallbackBars(canvas, labels, values, opts.fmt);
    destroy(canvas.id);
    asked[canvas.id] = { kind: 'bars', fmt: opts.fmt, highlight: opts.highlight, horizontal: !!opts.horizontal };
    try {
      registry[canvas.id] = new window.Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            backgroundColor: values.map(function (_, i) { return i === opts.highlight ? brandColor() : '#52525B'; }),
            hoverBackgroundColor: brandColor(),
            borderWidth: 0,
            borderRadius: 4,
            barPercentage: .68,
            categoryPercentage: .78
          }]
        },
        options: baseOpts({
          indexAxis: opts.horizontal ? 'y' : 'x',
          scales: axisPair(opts.fmt, opts.horizontal),
          plugins: Object.assign(baseOpts().plugins, {
            tooltip: Object.assign(baseOpts().plugins.tooltip, {
              callbacks: {
                label: function (c) {
                  var v = opts.horizontal ? c.parsed.x : c.parsed.y;
                  return opts.fmt ? opts.fmt(v) : compact(v);
                }
              }
            })
          })
        })
      });
    } catch (e) { fallbackBars(canvas, labels, values, opts.fmt); }
  }

  function donut(canvas, labels, values, opts) {
    opts = opts || {};
    if (!canvas) return;
    if (!has()) return fallbackBars(canvas, labels, values, opts.fmt);
    destroy(canvas.id);
    asked[canvas.id] = { kind: 'donut', fmt: opts.fmt, highlight: opts.highlight, horizontal: !!opts.horizontal };
    try {
      registry[canvas.id] = new window.Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            backgroundColor: labels.map(function (_, i) { return RAMP[i % RAMP.length]; }),
            borderColor: SURFACE,
            borderWidth: 3,
            hoverOffset: 7
          }]
        },
        options: baseOpts({
          cutout: '64%',
          plugins: Object.assign(baseOpts().plugins, {
            legend: {
              display: true,
              position: 'right',
              labels: {
                boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', padding: 13,
                color: '#FAFAFA', font: { family: 'Montserrat, sans-serif', size: 12, weight: '500' }
              }
            },
            tooltip: Object.assign(baseOpts().plugins.tooltip, {
              callbacks: {
                label: function (c) {
                  var tot = c.dataset.data.reduce(function (a, b) { return a + b; }, 0) || 1;
                  var v = opts.fmt ? opts.fmt(c.parsed) : compact(c.parsed);
                  return ' ' + c.label + ' — ' + v + ' (' + Math.round(c.parsed / tot * 100) + '%)';
                }
              }
            })
          })
        })
      });
    } catch (e) { fallbackBars(canvas, labels, values, opts.fmt); }
  }

  /* ------------------------------------------------------- THE PAPER COPY

     The same chart, redrawn for a white page, as a PNG data URL.

     The exported PDF used to lift the live canvas straight out with
     toDataURL(). That canvas is painted for a near-black card: a lime series,
     #27272A gridlines and #A1A1AA tick labels, on a transparent ground. Put on
     white paper the gridlines vanish, the axis numbers go to pale grey on
     white, and the lime line — which reads as a highlight against black —
     turns into the faintest thing on the sheet. It printed as an empty box
     with a yellow squiggle in it.

     So this rebuilds the chart rather than recolouring the picture: same type,
     same numbers, same formatter, ink-on-paper colours, animation off, drawn
     into a detached canvas at 2x so it is still sharp at 96dpi on A4. It never
     touches the live instance.

     Returns null if anything at all is not available — no Chart.js, no live
     chart under that id, no canvas support — and the caller falls back to the
     CSS-bar markup. An export must not fail because a picture would not
     render. */
  var PAPER = {
    ink: '#0A0A0B',        /* the series, and the heaviest slice */
    grid: '#E4E4E7',       /* gridlines, which have to be visible but quiet */
    axis: '#3F3F46',       /* tick labels: near-black, not the screen's grey */
    edge: '#D4D4D8',
    /* A ramp that survives being photocopied: it steps in LIGHTNESS, not in
       hue, so the slices stay distinguishable in black and white. The screen's
       ramp leads with lime, which prints as the palest thing on the page. */
    ramp: ['#0A0A0B', '#52525B', '#8A8A93', '#B8B8BE', '#6B7F3A', '#3A5478', '#8A6E3A', '#5B4A6B']
  };

  function printSnapshot(id, opts) {
    opts = opts || {};
    if (!has()) return null;
    var live = registry[id], meta = asked[id];
    if (!live || !meta) return null;

    var host, c, ctx, clone = null;
    try {
      var src = live.canvas;
      var w = Math.max(360, Math.round(src.clientWidth || src.width || 640));
      var h = Math.max(200, Math.round(src.clientHeight || src.height || 250));
      var scale = opts.scale || 2;

      c = document.createElement('canvas');
      c.width = w * scale; c.height = h * scale;
      c.style.width = w + 'px'; c.style.height = h + 'px';

      /* Chart.js measures its canvas through the DOM even with responsive
         off, so the clone has to be attached — off-screen, never visible, and
         removed in the finally below whatever happens. */
      host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + w + 'px;height:' + h + 'px;pointer-events:none';
      host.appendChild(c);
      document.body.appendChild(host);

      ctx = c.getContext('2d');
      ctx.scale(scale, scale);
      /* Paper first. A transparent PNG dropped into the print sheet picks up
         whatever is behind it, which on some drivers is nothing at all. */
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);

      /* Only the numbers cross over. Copying the datasets whole would bring
         the line chart's CanvasGradient with them, and a gradient belongs to
         the context that made it — on this one it paints as transparent. */
      var labels = (live.data.labels || []).slice();
      var values = ((live.data.datasets || [])[0] || {}).data || [];
      values = values.slice();

      var fmt = meta.fmt;
      var tickFont = { family: 'Montserrat, Arial, sans-serif', size: 11, weight: '600' };

      var paperScales = function (horizontal) {
        var category = {
          grid: { display: false },
          border: { color: PAPER.edge },
          ticks: { color: PAPER.axis, font: tickFont, autoSkip: labels.length > 20, maxRotation: 0 }
        };
        var value = {
          beginAtZero: true,
          grid: { color: PAPER.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: PAPER.axis, font: tickFont, padding: 8,
            callback: function (v) { return fmt ? fmt(v) : compact(v); }
          }
        };
        return horizontal ? { x: value, y: category } : { x: category, y: value };
      };

      var common = {
        responsive: false, maintainAspectRatio: false,
        animation: false,
        devicePixelRatio: 1,          /* we scaled the context ourselves */
        plugins: { legend: { display: false }, tooltip: { enabled: false } }
      };

      var cfg;
      if (meta.kind === 'line') {
        var fill = ctx.createLinearGradient(0, 0, 0, h);
        fill.addColorStop(0, 'rgba(10,10,11,.13)');
        fill.addColorStop(1, 'rgba(10,10,11,0)');
        cfg = {
          type: 'line',
          data: { labels: labels, datasets: [{
            data: values, borderColor: PAPER.ink, borderWidth: 2, backgroundColor: fill,
            fill: true, tension: .35,
            pointBackgroundColor: '#FFFFFF', pointBorderColor: PAPER.ink,
            pointBorderWidth: 2, pointRadius: labels.length > 40 ? 0 : 3
          }] },
          options: Object.assign({}, common, { scales: paperScales(false) })
        };

      } else if (meta.kind === 'donut') {
        cfg = {
          type: 'doughnut',
          data: { labels: labels, datasets: [{
            data: values,
            backgroundColor: labels.map(function (_, i) { return PAPER.ramp[i % PAPER.ramp.length]; }),
            borderColor: '#FFFFFF', borderWidth: 2
          }] },
          options: Object.assign({}, common, {
            cutout: '62%',
            plugins: {
              tooltip: { enabled: false },
              legend: {
                display: true, position: 'right',
                labels: {
                  boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', padding: 11,
                  color: PAPER.ink, font: { family: 'Montserrat, Arial, sans-serif', size: 11, weight: '600' }
                }
              }
            }
          })
        };

      } else {
        cfg = {
          type: 'bar',
          data: { labels: labels, datasets: [{
            data: values,
            /* The highlighted bar goes to ink and the rest to a mid grey —
               the same "one of these is the answer" the lime carries on
               screen, said in a way paper can print. */
            backgroundColor: values.map(function (_, i) {
              return i === meta.highlight ? PAPER.ink : '#A1A1AA';
            }),
            borderWidth: 0, borderRadius: 3, barPercentage: .7, categoryPercentage: .8
          }] },
          options: Object.assign({}, common, {
            indexAxis: meta.horizontal ? 'y' : 'x',
            scales: paperScales(meta.horizontal)
          })
        };
      }

      clone = new window.Chart(ctx, cfg);
      var url = c.toDataURL('image/png');
      return (url && url.length > 200) ? url : null;

    } catch (e) {
      return null;
    } finally {
      if (clone) { try { clone.destroy(); } catch (e2) {} }
      if (host && host.parentNode) host.parentNode.removeChild(host);
    }
  }

  /* Draw a QR-looking block pattern. Deterministic from the seed string so the
     same invoice always renders the same code. Decorative, not scannable. */
  function qr(canvas, seed, size) {
    if (!canvas || !canvas.getContext) return;
    size = size || 96;
    var cells = 25, cell = size / cells;
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';

    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = (h * 16777619) >>> 0; }
    function next() { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }

    function finder(cx, cy) {
      ctx.fillRect(cx * cell, cy * cell, cell * 7, cell * 7);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect((cx + 1) * cell, (cy + 1) * cell, cell * 5, cell * 5);
      ctx.fillStyle = '#000000';
      ctx.fillRect((cx + 2) * cell, (cy + 2) * cell, cell * 3, cell * 3);
    }

    for (var y = 0; y < cells; y++) {
      for (var x = 0; x < cells; x++) {
        var inFinder = (x < 8 && y < 8) || (x > cells - 9 && y < 8) || (x < 8 && y > cells - 9);
        if (inFinder) continue;
        if (next() > .52) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    finder(0, 0); finder(cells - 7, 0); finder(0, cells - 7);
  }

  return { line: line, bars: bars, donut: donut, qr: qr, destroy: destroy, destroyAll: destroyAll,
           has: has, compact: compact, printSnapshot: printSnapshot };
})();
