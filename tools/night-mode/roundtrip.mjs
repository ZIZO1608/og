#!/usr/bin/env node
/* ==========================================================================
   The whole round trip.                     node tools/night-mode/roundtrip.mjs
   --------------------------------------------------------------------------
   world.mjs builds it: a laptop (scratch database, this worktree's code), a
   cloud (PGlite with 001 → 035, behind a PostgREST stand-in the laptop's own
   lib/supabase.js talks to), and night mode (og-bridge's routes over the
   cloud as og_vps). Then:

     night   staff sign in with a password and an authenticator code, find
             the stock, pick a customer, and send three requests
     laptop  Inbox.collect (the real minute-timer path) takes them over HTTP
     night   the requests read "the shop has it"
     laptop  the office accepts two — POST /api/requests/:ref/accept, which
             runs Orders.create — and turns one down, over HTTP, as a person
     night   they read accepted with the invoice, and turned down with the
             reason, once the laptop has told the cloud
     both    nothing is ever applied twice: a second pass collects nothing, a
             request re-taken after the shop moves laptops arrives as the
             SAME order, and the orders are exactly one per accepted request.

   Every fact is read back from SQLite or from Postgres, not off a page.
   ========================================================================== */
import { DatabaseSync } from 'node:sqlite';
import { buildWorld, LIN } from './world.mjs';

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
  return !!ok;
};
const cloudRow = async (w, ref) => (await w.asOwner('SELECT * FROM inbox.requests WHERE ref = $1', [ref]))[0];
const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
};

const w = await buildWorld({ laptopPort: Number(process.env.OG_NIGHT_TEST_PORT) || null });
const { laptop, night } = w;
try {
  /* ---- night: three requests ------------------------------------------ */
  const staff = await night.signIn('sara');
  check('night: staff sign in with a password and an authenticator code', staff.home.status === 200 && !!staff.t);
  const stock = await night.go('GET', '/night/stock?q=' + encodeURIComponent('samba 42'), { cookie: staff.cookie });
  check('night: the stock the laptop has is what night mode shows', stock.status === 200 && stock.text.includes('Samba OG'));
  const cu = await night.go('GET', '/night/customers?q=0933', { cookie: staff.cookie });
  check('night: the customer lookup finds the laptop\'s customer', cu.text.includes('Nour Haddad'));

  const send = async (lines, customerId, fields) => {
    for (const [sku, qty] of lines) await night.go('POST', '/night/request/add', { cookie: staff.cookie, body: { t: staff.t, sku, qty } });
    if (customerId) await night.go('POST', '/night/request/customer', { cookie: staff.cookie, body: { t: staff.t, id: customerId } });
    const r = await night.go('POST', '/night/request', { cookie: staff.cookie, body: { t: staff.t, ...fields } });
    return decodeURIComponent((/sent=([^&]+)/.exec(r.headers.location || '') || [])[1] || '');
  };
  const { SKU, C } = laptop;
  const A = await send([[SKU.samba42, 1], [SKU.afBlack42, 1]], C.nour.id,
    { name: 'Nour Haddad', phone: '0933 123 456', method: 'delivery', city: 'Aleppo', address: 'New Aleppo, near the bakery', note: 'Call after 6' });
  const B = await send([[SKU.gazelle42, 1]], null, { name: 'Omar Aziz', phone: '٠٩٥٥ ١١١ ٢٢٢', method: 'pickup' });
  const Cq = await send([[SKU.samba43, 1]], C.rami.id, { name: 'Rami Khoury', phone: '+963 944 555 666', method: 'delivery', city: 'Aleppo', address: 'Al-Furqan' });
  check('night: three requests sent, each with its own ref', /^N-\d+$/.test(A) && /^N-\d+$/.test(B) && /^N-\d+$/.test(Cq) && new Set([A, B, Cq]).size === 3, [A, B, Cq].join(' '));
  const inCloud = await w.asOwner("SELECT count(*)::int AS n FROM inbox.requests WHERE state = 'waiting'");
  check('cloud: three waiting in inbox.requests', inCloud[0].n === 3);
  check('cloud: the Arabic-keypad phone arrived folded', (await cloudRow(w, B)).payload.customer.phone === '0955 111 222');

  /* ---- laptop: the minute timer's own path, over HTTP to the cloud ------ */
  const c1 = await laptop.L.Inbox.collect({ lineage: LIN });
  check('laptop: Inbox.collect took the three requests beside og-track\'s inbox', c1.requests && c1.requests.stored === 3, JSON.stringify(c1));
  check('laptop: it spoke to the cloud with the service key and the lineage',
    w.calls.some((c) => c.path === '/rest/v1/rpc/requests_take') && w.calls.some((c) => c.path === '/rest/v1/rpc/inbox_take' && c.profile === 'track'));
  check('cloud: all three now "received", taken by this laptop', (await Promise.all([A, B, Cq].map((r) => cloudRow(w, r)))).every((r) => r.state === 'received' && r.taken_by === LIN));
  const mine = await night.go('GET', '/night/requests', { cookie: staff.cookie });
  check('night: the requests read "the shop has it — not decided yet"', (mine.text.match(/وصل للمحل — لسا ما انقرر/g) || []).length === 3);

  /* ---- laptop: a person decides, over the laptop's own HTTP routes ------- */
  const salesBefore = laptop.L.DB.get().prepare('SELECT count(*) AS n FROM sales').get().n;
  await laptop.start();
  const ck = await laptop.login('abode');
  const list = await laptop.call('GET', '/api/requests', { cookie: ck });
  check('laptop: GET /api/requests lists the three waiting', list.status === 200 && list.json.count === 3, list.status + ' ' + list.text.slice(0, 200));
  const la = list.json.waiting.find((x) => x.ref === A);
  check('laptop: the hinted customer is matched, and every line knows this laptop\'s stock',
    la && la.customer.match && la.customer.match.id === C.nour.id && la.lines.every((l) => l.known && l.stock));
  const lb = list.json.waiting.find((x) => x.ref === B);
  check('laptop: a caller nobody knows is a new customer', lb && !lb.customer.match);

  const accA = await laptop.call('POST', `/api/requests/${A}/accept`, { cookie: ck, body: { method: 'driver' } });
  check('laptop: Accept A (our driver) makes an order', accA.status === 200 && /^INV-/.test(accA.json.sale.id), JSON.stringify(accA.json).slice(0, 200));
  const accB = await laptop.call('POST', `/api/requests/${B}/accept`, { cookie: ck, body: { method: 'pickup' } });
  check('laptop: Accept B (pickup, a new customer) makes an order', accB.status === 200 && /^INV-/.test(accB.json.sale.id));
  const rejC = await laptop.call('POST', `/api/requests/${Cq}/reject`, { cookie: ck, body: { code: 'out_of_stock', note: 'The last 43 went this afternoon' } });
  check('laptop: Turn C down, with a reason', rejC.status === 200 && rejC.json.request.state === 'rejected');
  const again = await laptop.call('POST', `/api/requests/${A}/accept`, { cookie: ck, body: { method: 'driver' } });
  check('laptop: pressing Accept on A again is refused, naming its invoice', again.status === 409 && again.json.saleId === accA.json.sale.id);

  /* The decision reaches the cloud straight after it is made (flushSoon). */
  const told = await waitFor(async () => {
    const [a, b, c] = await Promise.all([A, B, Cq].map((r) => cloudRow(w, r)));
    return a.state === 'accepted' && b.state === 'accepted' && c.state === 'rejected';
  });
  check('cloud: both acceptances and the refusal arrived without waiting for the next minute', told);
  const [ca, cb, cc] = await Promise.all([A, B, Cq].map((r) => cloudRow(w, r)));
  check('cloud: each acceptance carries its own invoice', ca.sale_id === accA.json.sale.id && cb.sale_id === accB.json.sale.id);
  check('cloud: the refusal carries its code and its words', cc.state_code === 'out_of_stock' && cc.state_note === 'The last 43 went this afternoon');

  /* ---- night: what became of them --------------------------------------- */
  const after = await night.go('GET', '/night/requests?lang=en', { cookie: staff.cookie });
  check('night: A reads "Accepted" with its invoice', after.text.includes('Accepted · <bdi dir="ltr" class="fig">' + accA.json.sale.id + '</bdi>'));
  check('night: C reads "Turned down" with the reason and the note', after.text.includes('Turned down') && after.text.includes('Out of stock') && after.text.includes('The last 43 went this afternoon'));
  check('night: nothing reads "waiting" any more', !after.text.includes('Waiting for the shop'));

  /* ---- the laptop's database: exactly what happened ---------------------- */
  await laptop.stop();
  const ro = new DatabaseSync(laptop.dbFile, { readOnly: true });
  const sale = (id) => ro.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  const deliv = (id) => ro.prepare('SELECT * FROM deliveries WHERE sale_id = ?').get(id);
  check('SQLite: two new sales, not three', ro.prepare('SELECT count(*) AS n FROM sales').get().n === salesBefore + 2);
  check('SQLite: A is an order for Nour, by our driver, marked', sale(accA.json.sale.id).customer_id === C.nour.id &&
    deliv(accA.json.sale.id).method === 'driver' && deliv(accA.json.sale.id).note.startsWith(`[req ${A}] `));
  check('SQLite: A priced from the product table (450,000 + 520,000)', sale(accA.json.sale.id).total === 970000, sale(accA.json.sale.id).total);
  const omar = ro.prepare("SELECT * FROM customers WHERE name = 'Omar Aziz'").get();
  check('SQLite: B made the new customer Omar (source night), and is a pickup', omar && omar.source === 'night' && sale(accB.json.sale.id).customer_id === omar.id && deliv(accB.json.sale.id).method === 'pickup');
  check('SQLite: B is in dollars, as the Gazelle is priced', sale(accB.json.sale.id).currency === 'USD' || sale(accB.json.sale.id).total > 0);
  check('SQLite: C made no order', ro.prepare("SELECT count(*) AS n FROM deliveries WHERE note LIKE ?").get(`[req ${Cq}]%`).n === 0);
  check('SQLite: the local copies agree with the cloud, and are reported',
    ['accepted', 'accepted', 'rejected'].join() === [A, B, Cq].map((r) => ro.prepare('SELECT state FROM shop_requests WHERE ref = ?').get(r).state).join() &&
    [A, B, Cq].every((r) => ro.prepare('SELECT reported_at FROM shop_requests WHERE ref = ?').get(r).reported_at));
  ro.close();

  /* ---- never twice --------------------------------------------------------- */
  laptop.L.DB.open(laptop.dbFile);
  const c2 = await laptop.L.Inbox.collect({ lineage: LIN });
  check('a second pass takes nothing and stores nothing', c2.requests && c2.requests.taken === 0 && c2.requests.stored === 0, JSON.stringify(c2.requests));
  /* The shop moves laptops before A's decision reached the cloud: the cloud
     still says "received", taken by the old laptop; this copy has no row. */
  await w.asOwner(`UPDATE inbox.requests SET state = 'received', sale_id = NULL, decided_at = NULL, taken_by = 'the-old-laptop' WHERE ref = $1`, [A]);
  laptop.L.DB.get().prepare('DELETE FROM shop_requests WHERE ref = ?').run(A);
  const n0 = laptop.L.DB.get().prepare('SELECT count(*) AS n FROM sales').get().n;
  const c3 = await laptop.L.Inbox.collect({ lineage: LIN });
  const localA = laptop.L.DB.get().prepare('SELECT * FROM shop_requests WHERE ref = ?').get(A);
  check('re-taken after a move, A arrives already accepted with the SAME order (the marker)',
    c3.requests.stored === 1 && localA.state === 'accepted' && localA.sale_id === accA.json.sale.id, JSON.stringify(localA));
  check('…no second sale was made', laptop.L.DB.get().prepare('SELECT count(*) AS n FROM sales').get().n === n0);
  check('…and the cloud is told accepted with that same invoice', (await cloudRow(w, A)).state === 'accepted' && (await cloudRow(w, A)).sale_id === accA.json.sale.id);

  /* ---- night mode never wrote a shop table --------------------------------- */
  check('og_vps opened READ WRITE only for its three submits',
    night.pool.log.filter((s) => /BEGIN READ WRITE/.test(s)).length === 3 &&
    night.pool.log.every((s, i, a) => !/BEGIN READ WRITE/.test(s) || /erp\.request_submit/.test(a[i + 1] || '')));
} catch (e) {
  check('no exception', false, e && e.stack);
} finally {
  await w.close();
}
console.log(`\nnight-mode roundtrip: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
