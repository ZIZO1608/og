/* ==========================================================================
   THE SNAPSHOT'S FIGURES — rows in, figures out. PURE: no database, no
   clock except the `now` it is handed, no network.
   --------------------------------------------------------------------------
   Every rule here is the TILL'S rule, ported rather than re-derived, and
   each block names the function it came from. The parity test
   (_nightshift/ns04/p4-parity.mjs) runs this on rows read from a copy of the
   till's SQLite and compares every figure, to the unit, with what the till's
   own /api/dashboard, /api/money, /api/deliveries and /api/statement answer
   on that same copy. A mismatch is a bug here, never there.

   THE TWO RULES THAT MATTER:
     - money is minor units plus a currency code, and two currencies are two
       numbers. Nothing here converts, and nothing adds lira to dollars.
     - "today" is the shop's day in Asia/Damascus, computed from `now`, as two
       UTC instants — the window the till's own dashboard is asked for.
   ========================================================================== */

const num = (x) => (x === null || x === undefined || x === '' ? 0 : Number(x) || 0);
const iso = (x) => (x instanceof Date ? x.toISOString() : x ? new Date(x).toISOString() : null);
const truthy = (x) => x === true || x === 1 || x === '1' || x === 't' || x === 'true';

/* ------------------------------------------------------------ the shop's day */

/* Minutes east of UTC that `tz` is at the instant `ms`. */
export function offsetMinutes(ms, tz) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/* The shop's calendar day containing `nowMs`, as [from, to) in UTC. Midnight
   is found twice so a day that starts or ends on a clock change is right. */
export function dayWindow(nowMs, tz = 'Asia/Damascus') {
  const off = offsetMinutes(nowMs, tz);
  const local = new Date(nowMs + off * 60000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  const midnight = (Y, M, D) => {
    let t = Date.UTC(Y, M, D) - offsetMinutes(Date.UTC(Y, M, D), tz) * 60000;
    t = Date.UTC(Y, M, D) - offsetMinutes(t, tz) * 60000;
    return t;
  };
  const from = midnight(y, m, d), to = midnight(y, m, d + 1);
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    day: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  };
}

/* ------------------------------------------------------------------ helpers */

function cfg(rows, key, fallback) {
  const r = (rows.config || []).find((x) => x.key === key);
  return r ? r.value : fallback;
}
function cfgJson(rows, key, fallback) {
  try {
    const v = JSON.parse(cfg(rows, key, 'null'));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}
/* { currency: amount } from GROUP BY-style rows. */
function perCurrency(list, field) {
  const out = {};
  for (const r of list) out[r.currency] = (out[r.currency] || 0) + num(r[field]);
  return out;
}

/* cashbook.js NO_MONEY: methods that never hold money in any place. */
const NO_MONEY = new Set(['credit', 'order', 'store_credit']);

/* -------------------------------------------------------------- the figures */

export function figures(rows, { window, now, tz = 'Asia/Damascus' }) {
  const exps = {};
  for (const c of rows.currencies || []) exps[c.code] = num(c.minor_exp);
  const base = cfg(rows, 'shop.base_currency', 'SYP');

  /* ---- today: dashboard.js takingsIn() -------------------------------- */
  const sales = rows.sales || [];
  const takings = perCurrency(sales, 'total');
  const countBy = {};
  for (const s of sales) countBy[s.currency] = (countBy[s.currency] || 0) + 1;

  /* ---- what came back: statement.js "what came back" ------------------- */
  const returns = { count: (rows.returns || []).length, amounts: perCurrency(rows.returns || [], 'due_minor') };

  /* ---- money per place: cashbook.js places() + snapshot() -------------- */
  const names = new Map((rows.users || []).map((u) => [num(u.id), u.name]));
  const listed = [
    { id: 'drawer', kind: 'drawer', active: true },
    { id: 'owner', kind: 'owner', active: true }
  ];
  const methods = cfgJson(rows, 'pay.methods', []);
  for (const m of Array.isArray(methods) ? methods : []) {
    if (!m || typeof m.id !== 'string' || m.drawer || NO_MONEY.has(m.id)) continue;
    listed.push({ id: 'm:' + m.id, kind: 'wallet', en: m.en || m.id, ar: m.ar || m.en || m.id, active: m.active !== false });
  }
  const extras = cfgJson(rows, 'money.places', []);
  for (const x of Array.isArray(extras) ? extras : []) {
    if (!x || typeof x.id !== 'string') continue;
    listed.push({ id: 'x:' + x.id, kind: 'extra', en: x.en || x.ar || x.id, ar: x.ar || x.en || x.id, active: x.active !== false });
  }
  const byId = new Map(listed.map((p) => [p.id, { ...p, balances: {}, lastMove: null, lastCheck: null, opened: false }]));
  for (const r of rows.balances || []) {
    if (!byId.has(r.place)) {
      const driverId = r.place.startsWith('driver:') ? num(r.place.slice(7)) : null;
      const who = driverId !== null && names.has(driverId) ? names.get(driverId) : null;
      byId.set(r.place, who !== null
        ? { id: r.place, kind: 'driver', en: who, ar: who, balances: {}, lastMove: null, lastCheck: null, opened: false }
        : { id: r.place, kind: 'unknown', en: r.place, ar: r.place, balances: {}, lastMove: null, lastCheck: null, opened: false });
    }
    const p = byId.get(r.place);
    p.balances[r.currency] = num(r.amount);
    const last = iso(r.last);
    if (!p.lastMove || last > p.lastMove) p.lastMove = last;
  }
  for (const r of rows.checks || []) {
    const p = byId.get(r.place);
    if (!p) continue;
    p.lastCheck = iso(r.last);
    p.opened = num(r.openings) > 0;
  }
  const places = [];
  const placeTotals = {};
  for (const p of byId.values()) {
    const has = Object.values(p.balances).some((v) => v !== 0);
    if (p.kind === 'driver' && !has && !p.lastMove) continue;
    if (p.kind === 'unknown' && !has) continue;
    for (const [c, v] of Object.entries(p.balances)) placeTotals[c] = (placeTotals[c] || 0) + v;
    places.push(p);
  }

  /* ---- owed to suppliers: dashboard.js out.suppliers ------------------- */
  const sup = rows.suppliers || [];
  const suppliers = { amounts: perCurrency(sup, 'total'), count: sup.reduce((a, r) => a + num(r.n), 0) };

  /* ---- the road: deliveries.js summary() ------------------------------- */
  const road = { waiting: 0, out: 0 };
  for (const r of rows.road || []) road[r.status] = num(r.n);
  const cash = (rows.driverCash || []).map((r) => ({ currency: r.currency || 'SYP', amount: num(r.amount), drivers: num(r.drivers) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  /* ---- stock: alerts.js stockOut / criticalLevel / criticalCount -------- */
  const low = num(cfg(rows, 'stock.critical', 2)) || 2;
  const byName = (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.size).localeCompare(String(b.size));
  const stock = rows.stock || [];
  const outList = stock.filter((v) => num(v.qty) === 0).sort(byName);
  const critList = stock.filter((v) => num(v.qty) >= 1 && num(v.qty) <= low).sort((a, b) => num(a.qty) - num(b.qty) || byName(a, b));
  const stockFig = {
    low,
    out: outList.length,
    critical: critList.length,
    outTop: outList.slice(0, 5).map((v) => ({ sku: v.sku, name: v.name, size: v.size })),
    criticalTop: critList.slice(0, 5).map((v) => ({ sku: v.sku, name: v.name, size: v.size, qty: num(v.qty) }))
  };

  /* ---- the last twenty sales ------------------------------------------ */
  const items = new Map();
  for (const i of rows.lastItems || []) {
    if (!items.has(i.sale_id)) items.set(i.sale_id, []);
    items.get(i.sale_id).push({ name: i.name, size: i.size, qty: num(i.qty) });
  }
  const lastSales = (rows.lastSales || []).map((s) => ({
    id: s.id, at: iso(s.at), currency: s.currency, total: num(s.total),
    voided: truthy(s.voided), payment: s.payment,
    cashier: s.cashier_id === null || s.cashier_id === undefined ? null : (names.get(num(s.cashier_id)) || null),
    items: items.get(s.id) || []
  })).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : (a.id < b.id ? 1 : -1)));

  return {
    shop: cfg(rows, 'shop.name', null),
    base,
    exps,
    window: { from: window.from, to: window.to, day: window.day || null, tz },
    at: new Date(now).toISOString(),
    today: { takings, count: sales.length, countBy, returns },
    places, placeTotals,
    suppliers,
    road: { ...road, cash },
    stock: stockFig,
    lastSales
  };
}
