/* ==========================================================================
   A whole night-mode world, on this machine only.        [tools/night-mode]
   --------------------------------------------------------------------------
   Used by roundtrip.mjs (the test) and preview.mjs (the screenshots):

     THE LAPTOP   a scratch database built by this worktree's migrations and
                  seeded through the server's own libraries — a small shop
                  with real-looking products, customers and orders.
     THE MIRROR   PGlite (OG_PGLITE) holding the mirror's schema 001 → 035,
                  filled FROM the laptop's rows, the way the sync would.
     THE CLOUD    a PostgREST stand-in on 127.0.0.1 answering the calls the
                  laptop's own lib/supabase.js makes — requests_take and
                  requests_mark (035, run as service_role), and og-track's
                  inbox_take / inbox_done (nothing waiting there).
     NIGHT MODE   og-bridge's own night routes over the mirror as og_vps.

   Nothing here reaches Supabase, the VPS, Telegram or the real shop. The
   laptop's env is set BEFORE a server module is imported, with no Telegram
   tokens at all (no bot starts) and OG_ENV_FILE pointing at a scratch file
   so no real server/.env is ever read.
   ========================================================================== */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mirrorDb, ogVpsPool, makeSerial } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
const SERVER = join(REPO, 'server');
export const LIN = 'lin-night-world-0001';
export const PW = 'night-world-test-pass';
export const SERVICE_KEY = 'sb-night-world-service-key';

const readBody = (req) => new Promise((ok) => { let b = ''; req.setEncoding('utf8'); req.on('data', (c) => { b += c; }); req.on('end', () => ok(b)); });

/* A port nothing is listening on right now. Other sessions run their own
   sandboxes on this machine (8190, 8192 …), so a fixed number is a guess. */
export function freePort() {
  return new Promise((ok, bad) => {
    const s = createServer();
    s.on('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

export async function buildWorld({ laptopPort = null, log = () => {} } = {}) {
  if (!laptopPort) laptopPort = await freePort();
  const SCR = join(tmpdir(), 'og-night-world-' + process.pid);
  rmSync(SCR, { recursive: true, force: true });
  mkdirSync(join(SCR, 'data'), { recursive: true });

  /* ---- the cloud: PGlite + a PostgREST stand-in ------------------------- */
  const db = await mirrorDb();
  const lock = makeSerial();
  const calls = [];
  const asService = (sql, params) => lock(async () => {
    await db.exec('SET ROLE service_role');
    try { return (await db.query(sql, params)).rows; } finally { await db.exec('RESET ROLE'); }
  });
  const asOwner = (sql, params) => lock(async () => (await db.query(sql, params || [])).rows);
  const standin = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = await readBody(req);
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const auth = req.headers.authorization === 'Bearer ' + SERVICE_KEY && req.headers.apikey === SERVICE_KEY;
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    calls.push({ method: req.method, path: url.pathname, profile: req.headers['content-profile'] || null, body });
    if (!auth) return send(401, { code: '42501', message: 'no key' });
    if (!m || req.method !== 'POST') return send(404, { code: 'PGRST125', message: 'not in this stand-in' });
    const args = body ? JSON.parse(body) : {};
    const profile = req.headers['content-profile'] || 'public';
    try {
      if (profile === 'track' && m[1] === 'inbox_take') return send(200, { ok: true, items: [], purged: 0 });
      if (profile === 'track' && m[1] === 'inbox_done') return send(200, { ok: true, marked: 0, skipped: 0 });
      if (profile === 'public' && m[1] === 'requests_take') {
        const [r] = await asService('SELECT public.requests_take($1, $2) AS r', [args.p_lineage, args.p_limit]);
        return send(200, r.r);
      }
      if (profile === 'public' && m[1] === 'requests_mark') {
        const [r] = await asService('SELECT public.requests_mark($1, $2::jsonb) AS r', [args.p_lineage, JSON.stringify(args.p_items)]);
        return send(200, r.r);
      }
      return send(404, { code: 'PGRST202', message: 'no such function in this stand-in' });
    } catch (e) {
      return send(400, { code: 'P0001', message: e.message });
    }
  });
  await new Promise((ok) => standin.listen(0, '127.0.0.1', ok));
  const supabaseUrl = 'http://127.0.0.1:' + standin.address().port;

  /* ---- the laptop's env, BEFORE any server module is imported ------------ */
  const ENV = join(SCR, '.env');
  const envs = {
    OG_PORT: String(laptopPort), OG_HTTPS: '0', OG_SECURE: '0', OG_ORIGINS: '', OG_SYNC_MINUTES: '0',
    OG_PULL_AT_BOOT: '0', OG_PUSH: '0', SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY
  };
  writeFileSync(ENV, Object.entries(envs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  Object.assign(process.env, envs, { OG_ENV_FILE: ENV, OG_DATA_DIR: join(SCR, 'data') });
  delete process.env.OG_TELEGRAM_TOKEN_OG;
  delete process.env.OG_TELEGRAM_TOKEN_YALLA;

  const src = (p) => import(pathToFileURL(join(SERVER, p)).href);
  const DB = await src('lib/db.js');
  const dbFile = join(SCR, 'data', 'og.db');
  DB.open(dbFile);
  const L = {
    DB, Auth: await src('lib/auth.js'), Cat: await src('lib/catalogue.js'), Customers: await src('lib/customers.js'),
    Orders: await src('lib/orders.js'), Inbox: await src('lib/inbox.js'), Requests: await src('lib/requests.js')
  };
  const d = DB.get();

  /* ---- the laptop's shop ------------------------------------------------- */
  const now = new Date().toISOString();
  d.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('sync.lineage', ?, ?)").run(LIN, now);
  d.prepare("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('shop.name', 'OG Sports', ?)").run(now);
  await L.Auth.createUser({ username: 'abode', name: 'Abode', role: 'owner', password: PW });
  await L.Auth.createUser({ username: 'wael', name: 'Wael', role: 'manager', password: PW });
  const owner = L.Auth.findByUsername('abode');
  const type = d.prepare("SELECT id FROM categories WHERE active = 1 ORDER BY sort, id LIMIT 1").get().id;
  L.Cat.createWithVariants({ name: 'Samba OG', type, brand: 'Adidas', colorway: 'Cloud White / Core Black', currency: 'SYP',
    costPrice: 300000, sellingPrice: 450000, sizes: [{ size: '41', qty: 2 }, { size: '42', qty: 5 }, { size: '43', qty: 1 }, { size: '44', qty: 0 }],
    whId: 'store', userId: owner.id });
  L.Cat.createWithVariants({ name: 'Air Force 1 \'07', type, brand: 'Nike', currency: 'SYP', costPrice: 350000, sellingPrice: 520000,
    colours: [{ nameEn: 'White', nameAr: 'أبيض', hex: '#FFFFFF', sizes: [{ size: '41', qty: 3 }, { size: '42', qty: 2 }] },
              { nameEn: 'Black', nameAr: 'أسود', hex: '#000000', sizes: [{ size: '42', qty: 1 }, { size: '43', qty: 0 }] }],
    whId: 'store', userId: owner.id });
  L.Cat.createWithVariants({ name: 'Gazelle Indoor', type, brand: 'Adidas', colorway: 'Blue Fusion', currency: 'USD',
    costPrice: 5500, sellingPrice: 8500, sizes: [{ size: '40', qty: 1 }, { size: '42', qty: 2 }], whId: 'store', userId: owner.id });
  const skuOf = (name, size, colour) => d.prepare(
    `SELECT v.sku FROM variants v JOIN products p ON p.id = v.product_id LEFT JOIN product_colours c ON c.id = v.colour_id
      WHERE p.name = ? AND v.size = ? AND (? IS NULL OR c.name_en = ?)`).get(name, size, colour || null, colour || null).sku;
  const SKU = {
    samba41: skuOf('Samba OG', '41'), samba42: skuOf('Samba OG', '42'), samba43: skuOf('Samba OG', '43'),
    afWhite42: skuOf('Air Force 1 \'07', '42', 'White'), afBlack42: skuOf('Air Force 1 \'07', '42', 'Black'),
    gazelle42: skuOf('Gazelle Indoor', '42')
  };
  /* A few pairs out on the shop floor, as a real morning has. */
  const move = d.prepare('UPDATE stock SET qty = qty - ? WHERE sku = ? AND wh_id = ?');
  const put = d.prepare("INSERT INTO stock (sku, wh_id, qty) VALUES (?, 'floor', ?) ON CONFLICT (sku, wh_id) DO UPDATE SET qty = qty + excluded.qty");
  for (const [sku, n] of [[SKU.samba42, 2], [SKU.afWhite42, 1]]) { move.run(n, sku, 'store'); put.run(sku, n); }

  const cust = (name, phone, city, address) => L.Customers.create({ name, phone, city, address }, owner.id).customer;
  const C = {
    nour: cust('Nour Haddad', '0933 123 456', 'Aleppo', 'New Aleppo, near the bakery'),
    rami: cust('Rami Khoury', '+963 944 555 666', 'Aleppo', 'Al-Furqan'),
    lina: cust('Lina Saleh', '0911 222 333', 'Aleppo', null)
  };
  /* Orders already made, so night mode's Orders page has something true. */
  const order = (c, lines, method, over = {}) => L.Orders.create({
    lines, customerId: c.id, method, plan: 'receipt', payments: [], userId: owner.id,
    dest: method === 'pickup' ? {} : { country: 'SY', city: c.city || 'Aleppo', address: c.address || 'Aleppo', phone: c.phone }, ...over
  }).sale.id;
  const o1 = order(C.rami, [{ sku: SKU.afWhite42, qty: 1 }], 'driver');
  const o2 = order(C.lina, [{ sku: SKU.samba41, qty: 1 }], 'driver');
  const o3 = order(C.nour, [{ sku: SKU.samba43, qty: 1 }], 'pickup');
  d.prepare("UPDATE deliveries SET status = 'out', out_at = ? WHERE sale_id = ?").run(now, o1);
  d.prepare("UPDATE deliveries SET status = 'delivered', out_at = ?, closed_at = ? WHERE sale_id = ?").run(now, now, o2);

  /* ---- the mirror, filled from the laptop the way the sync fills it ------- */
  await copyToMirror(d, db, lock);
  await asOwner(`INSERT INTO sync_state (id, note, last_push_at) VALUES ('lineage', '${LIN} NIGHT-WORLD', now() - interval '3 days'),
                                                                     ('shop', 'alive: nothing waiting', now() - interval '14 minutes')
                   ON CONFLICT (id) DO UPDATE SET note = EXCLUDED.note, last_push_at = EXCLUDED.last_push_at`);

  /* ---- night mode ------------------------------------------------------------ */
  const B = (f) => import(pathToFileURL(join(REPO, 'vps', 'og-bridge', 'src', f)).href);
  const { makeMirror } = await B('mirror.js');
  const { nightRoutes, ROLES } = await B('night.js');
  const A = await B('snapshot-auth.js');
  const SECRET = A.base32Encode(Buffer.from('night-world-totp-secret'));
  const pool = ogVpsPool(db, { serial: lock });
  const mirror = makeMirror({ pool });
  const status = await mirror.tillStatus();
  const road = { state: { mode: 'mirror', beatAt: status.beatAt ? new Date(status.beatAt).toISOString() : null } };
  const clock = { t: Date.now() };
  const hash = await A.hashPassword(PW);
  const nightUsers = A.parseUsers(JSON.stringify([
    { user: 'sara', role: 'staff', scrypt: hash, totpSecret: SECRET },
    { user: 'abode', role: 'owner', scrypt: hash, totpSecret: SECRET }
  ]), { roles: ROLES });
  const nightAuth = A.makeAuth({ users: nightUsers, now: () => clock.t, cookieName: 'og_night', path: '/night' });
  const routes = nightRoutes({ config: { shopTz: 'Asia/Damascus', proxyNets: '', nightSubmit: 'on', nightMaxPerHour: 20 },
                               mirror, road, auth: nightAuth, now: () => clock.t, log });
  const nightSrv = createServer((req, res) => routes.handle(req, res, new URL(req.url, 'http://x')));
  await new Promise((ok) => nightSrv.listen(0, '127.0.0.1', ok));
  const nightPort = nightSrv.address().port;
  let step = 0;
  const night = {
    port: nightPort, road, clock, pool,
    go: (method, path, opts) => http(nightPort, method, path, { form: true, ...opts }),
    async signIn(user) {
      clock.t = Date.now() + (step++) * 30000;
      const code = A.hotp(A.base32Decode(SECRET), Math.floor(clock.t / 30000));
      const r = await http(nightPort, 'POST', '/night/login', { form: true, body: { user, password: PW, code } });
      const cookie = [].concat(r.headers['set-cookie'] || []).find((c) => c.startsWith('og_night=')).split(';')[0];
      const home = await http(nightPort, 'GET', '/night', { cookie });
      return { cookie, t: (/name="t" value="([0-9a-f]+)"/.exec(home.text) || [])[1], home };
    },
    code: () => A.hotp(A.base32Decode(SECRET), Math.floor(clock.t / 30000))
  };

  /* ---- the laptop's own server, as a child ----------------------------------- */
  let child = null;
  const laptop = {
    port: laptopPort, dir: SCR, dbFile, L, SKU, C, orders: { o1, o2, o3 },
    closeDb: () => DB.close(),
    call: (method, path, opts) => http(laptopPort, method, path, opts),
    async start() {
      DB.close();
      child = spawn(process.execPath, ['index.js'], { cwd: SERVER, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { out += c; });
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try { if ((await http(laptopPort, 'GET', '/api/health')).status === 200) return { output: () => out }; } catch { /* not yet */ }
        if (child.exitCode !== null) throw new Error('laptop server exited:\n' + out);
      }
      throw new Error('laptop server never answered:\n' + out);
    },
    async stop() {
      if (!child) return;
      const c = child; child = null;
      c.kill();
      await new Promise((r) => (c.exitCode !== null ? r() : c.on('exit', r)));
    },
    async login(username) {
      const r = await http(laptopPort, 'POST', '/api/auth/login', { body: { username, password: PW } });
      return [].concat(r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    }
  };

  return {
    db, lock, asOwner, calls, supabaseUrl, laptop, night,
    async close() {
      await laptop.stop();
      try { DB.close(); } catch { /* closed */ }
      await new Promise((ok) => nightSrv.close(ok));
      await new Promise((ok) => standin.close(ok));
      try { rmSync(SCR, { recursive: true, force: true }); } catch { /* Windows may hold a file a moment */ }
    }
  };
}

/* Every column the two schemas share, table by table, in foreign-key order.
   Flags are 0/1 here and BOOLEAN there. */
async function copyToMirror(sqlite, pg, lock) {
  const TABLES = ['users', 'currencies', 'warehouses', 'categories', 'products', 'product_colours', 'variants', 'stock',
                  'customers', 'sales', 'sale_items', 'deliveries'];
  await lock(async () => {
    for (const t of TABLES) {
      const pgCols = (await pg.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t])).rows;
      if (!pgCols.length) continue;
      const types = new Map(pgCols.map((c) => [c.column_name, c.data_type]));
      const localCols = sqlite.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
      const cols = localCols.filter((c) => types.has(c));
      const rows = sqlite.prepare(`SELECT ${cols.map((c) => '"' + c + '"').join(', ')} FROM "${t}"`).all();
      for (const r of rows) {
        const vals = cols.map((c) => (types.get(c) === 'boolean' && r[c] !== null ? !!r[c] : r[c]));
        await pg.query(
          `INSERT INTO public."${t}" (${cols.map((c) => '"' + c + '"').join(', ')})
           VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) ON CONFLICT DO NOTHING`, vals);
      }
    }
  });
}

/* One request: JSON for the laptop, a form for night mode. */
export function http(port, method, path, { body, cookie, form = false } = {}) {
  return new Promise((ok, bad) => {
    let data = null;
    const headers = { Origin: `http://127.0.0.1:${port}` };
    if (body !== undefined) {
      data = Buffer.from(form
        ? Object.entries(body).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')
        : JSON.stringify(body));
      headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
      headers['Content-Length'] = data.length;
    }
    if (cookie) headers.Cookie = cookie;
    const r = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* html */ }
        ok({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', bad);
    if (data) r.write(data);
    r.end();
  });
}
