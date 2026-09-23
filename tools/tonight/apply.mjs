/* =============================================================================
   tools/tonight/apply.mjs — put server/.env.next live, prove it, or put the
   old one back (day shift 06). Run through apply.ps1.

   THE SHOP MUST BE CLOSED FIRST, in the OG System window ("Close the shop").
   The panel holds the running server; a script cannot restart it for the
   panel, and a server this script started would stop the moment the script
   does (that is how night shift 05's check ended its server ungracefully).
   So: close the shop, run this, and when it says PASS press Open in the window.

   Refuses (exit 3, nothing touched) unless ALL of these hold:
     1. Asia/Damascus 00:30-07:00, or --now (Ahmad standing there after closing)
     2. nothing answers on the shop's port (the shop is closed)
     3. no sale, order payment, stock movement or money move in 30 minutes
     4. .env.next is the current .env plus ONLY the staged keys (OG_PROXY_ADDR,
        OG_VPS_API_KEY, OG_ORIGINS, a comment) — so an .env edited since the
        staging is noticed, not overwritten
     5. a fresh backup (scripts/backup.js, the repository's own) succeeds, its
        integrity_check is ok and its sales and variants counts equal live
   Then: .env -> .env.bak-day06, .env.next -> .env, start the server exactly as
   the panel does (node index.js with an IPC channel), check:
     health on http (and https unless OG_HTTPS=0), a real sign-in, a forged
     X-Forwarded-For / X-OG-Client-IP ignored (read back from login_attempts),
     the mirror in the state this .env asks for (live with Supabase keys),
   stop it gracefully ({type:'stop'}). Any failure: the old .env back, start,
   the same checks, stop. Exit 0 PASS, 2 rolled back (old .env checks pass),
   4 rolled back and the old .env ALSO fails its checks — call for help.

     node tools/tonight/apply.mjs [--now] [--root <repo>] [--env-file <f>]
          [--data-dir <d>] [--user zizo] [--accounts <ACCOUNTS.private.md>]
   ============================================================================= */
import { spawn, spawnSync } from 'node:child_process';
import { request as httpReq } from 'node:http';
import { request as httpsReq } from 'node:https';
import { readFileSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const NOW = argv.includes('--now');
const ROOT = resolve(opt('--root', resolve(HERE, '../..')));
const SRV = resolve(ROOT, 'server');
const SANDBOX = argv.includes('--env-file');
const ENV = resolve(opt('--env-file', resolve(SRV, '.env')));
const NEXT = ENV + '.next';
const ENV_NEXT = ENV.endsWith('.env') ? resolve(dirname(ENV), '.env.next') : NEXT;
const DATA = resolve(opt('--data-dir', resolve(SRV, 'data')));
const DB_FILE = resolve(DATA, 'og.db');
const USER = opt('--user', 'zizo');
const ACCOUNTS = resolve(opt('--accounts', resolve(DATA, 'ACCOUNTS.private.md')));
const STAGED = ['OG_PROXY_ADDR', 'OG_VPS_API_KEY', 'OG_ORIGINS'];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; log((ok ? 'ok    ' : 'FAIL  ') + name + (detail ? '  - ' + detail : '')); return ok; };
const refuse = (why) => { log('REFUSED - ' + why); log('Nothing was changed.'); process.exit(3); };

const parseEnv = (text) => {
  const m = {};
  for (const l of text.split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.trimStart().startsWith('#')) m[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return m;
};

/* ------------------------------------------------------------- refusals */
function preconditions() {
  log('root ' + ROOT + (SANDBOX ? '   (SANDBOX: ' + ENV + ')' : ''));
  // 4 first: without the staged file there is nothing to apply at all.
  if (!existsSync(ENV)) refuse('no .env at ' + ENV);
  if (!existsSync(ENV_NEXT)) refuse('no staged file at ' + ENV_NEXT);
  const cur = readFileSync(ENV, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const next = readFileSync(ENV_NEXT, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const lost = cur.filter((l) => !next.includes(l) && !STAGED.some((k) => l.startsWith(k + '=')));
  if (lost.length) refuse('.env has changed since .env.next was staged (' + lost.length + ' line(s) of .env are not in .env.next). Stage again.');
  const added = next.filter((l) => !cur.includes(l));
  const odd = added.filter((l) => !l.startsWith('#') && !STAGED.some((k) => l.startsWith(k + '=')));
  if (odd.length) refuse('.env.next adds keys outside ' + STAGED.join(', ') + ': ' + odd.map((l) => l.split('=')[0]).join(', '));
  log('ok    .env.next = .env + ' + added.filter((l) => !l.startsWith('#')).map((l) => l.split('=')[0]).join(', '));

  // 1
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Damascus', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const [h, m] = hm.split(':').map(Number);
  const inWindow = h * 60 + m >= 30 && h * 60 + m < 7 * 60;
  if (!inWindow && !NOW) refuse('Damascus time is ' + hm + ', outside 00:30-07:00. After closing, with the shop closed, run it with -Now.');
  log('ok    time ' + hm + ' Damascus' + (inWindow ? '' : ' (-Now given)'));

  // 3
  const d = new DatabaseSync(DB_FILE, { readOnly: true });
  const since = new Date(Date.now() - 30 * 60000).toISOString();
  const n = d.prepare(`SELECT
      (SELECT COUNT(*) FROM sales WHERE at > ?) + (SELECT COUNT(*) FROM order_payments WHERE at > ?) +
      (SELECT COUNT(*) FROM stock_movements WHERE at > ?) + (SELECT COUNT(*) FROM money_moves WHERE at > ?) AS n`)
    .get(since, since, since, since).n;
  const live = { sales: d.prepare('SELECT COUNT(*) n FROM sales').get().n, variants: d.prepare('SELECT COUNT(*) n FROM variants').get().n };
  d.close();
  if (n) refuse(n + ' sale / payment / stock / money write(s) in the last 30 minutes. Wait until the shop has been quiet for half an hour.');
  log('ok    no writes in the last 30 minutes');
  return live;
}
function portOpen(port) {
  return new Promise((ok) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); ok(true); });
    s.on('error', () => ok(false)); s.setTimeout(2000, () => { s.destroy(); ok(false); });
  });
}
function backup(live) {
  const before = Date.now();
  const r = spawnSync(process.execPath, ['scripts/backup.js'], { cwd: SRV, env: childEnv(), encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) {
    const lines = String((r.stderr || '') + (r.stdout || '')).trim().split(/\r?\n/);
    refuse('npm run backup failed (exit ' + r.status + '): ' + (lines.find((l) => /Error|error|refus/.test(l)) || lines.pop() || '').trim());
  }
  const dir = resolve(DATA, 'backups');
  const f = existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.db')).map((x) => resolve(dir, x)).filter((x) => statSync(x).mtimeMs >= before - 2000).sort().pop() : null;
  if (!f) refuse('the backup ran but no new .db appeared in ' + dir);
  const b = new DatabaseSync(f, { readOnly: true });
  const got = { integrity: b.prepare('PRAGMA integrity_check').get().integrity_check,
    sales: b.prepare('SELECT COUNT(*) n FROM sales').get().n, variants: b.prepare('SELECT COUNT(*) n FROM variants').get().n };
  b.close();
  if (got.integrity !== 'ok' || got.sales !== live.sales || got.variants !== live.variants)
    refuse('the backup does not match: ' + JSON.stringify({ live, backup: got }));
  log('ok    backup ' + f.split(/[\\/]/).pop() + ' - integrity ok, sales ' + got.sales + ', variants ' + got.variants);
}

/* ------------------------------------------------------------ the server */
function childEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^OG_|^SUPABASE_/.test(k)) delete env[k];   // it reads its .env, as under the panel
  if (SANDBOX) { env.OG_ENV_FILE = ENV; env.OG_DATA_DIR = DATA; }
  return env;
}
let child = null;
function startShop() {
  child = spawn(process.execPath, ['index.js'], { cwd: SRV, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let out = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { out += b; });
  return new Promise((ok, bad) => {
    const t = setTimeout(() => bad(new Error('no ready line within 5 minutes (the boot pull may be slow):\n' + out.slice(-1500))), 300000);
    child.on('message', (msg) => { if (msg && msg.type === 'ready') { clearTimeout(t); ok(msg); } });
    child.on('exit', (c) => { clearTimeout(t); bad(new Error('the server exited (' + c + '):\n' + out.slice(-1500))); });
  });
}
function stopShop() {
  if (!child) return Promise.resolve();
  const c = child; child = null;
  return new Promise((ok) => {
    const t = setTimeout(() => { log('the graceful stop took over 15 s; killing'); c.kill(); }, 15000);
    c.on('exit', (code) => { clearTimeout(t); log('the server stopped (exit ' + code + ')'); ok(); });
    try { c.send({ type: 'stop' }); } catch { c.kill(); }
  });
}
function req(conf, method, path, { https = false, headers = {}, body } = {}) {
  return new Promise((ok) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const port = https ? conf.httpsPort : conf.port;
    const h = { Host: '127.0.0.1:' + port, Connection: 'close', ...headers };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length; }
    if (method !== 'GET' && !h.Origin) h.Origin = (https ? 'https' : 'http') + '://127.0.0.1:' + port;
    const o = { host: '127.0.0.1', port, method, path, headers: h, agent: false };   // no keep-alive: ns05's ECONNRESET
    if (https) o.rejectUnauthorized = false;
    const r = (https ? httpsReq : httpReq)(o, (res) => {
      const chunks = []; res.on('data', (x) => chunks.push(x));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch { /* */ } ok({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    r.on('error', (e) => ok({ status: 0, text: e.message })); r.setTimeout(20000, () => r.destroy(new Error('timeout')));
    if (data) r.write(data); r.end();
  });
}
function password() {
  if (!existsSync(ACCOUNTS)) return null;
  const row = readFileSync(ACCOUNTS, 'utf8').split(/\r?\n/).filter((l) => l.includes('| ' + USER + ' |')).pop();
  return row ? row.split('|').map((s) => s.trim().replace(/`/g, ''))[2] : null;
}
const lastIp = (u) => { const d = new DatabaseSync(DB_FILE, { readOnly: true }); const r = d.prepare('SELECT ip FROM login_attempts WHERE username = ? ORDER BY id DESC LIMIT 1').get(u); d.close(); return r && r.ip; };

async function checks(label) {
  const e = parseEnv(readFileSync(ENV, 'utf8'));
  const conf = { port: Number(e.OG_PORT || 8090), httpsPort: Number(e.OG_HTTPS_PORT || 8443), https: e.OG_HTTPS !== '0', mirror: !!(e.SUPABASE_URL && (e.SUPABASE_SECRET_KEY || e.SUPABASE_SERVICE_ROLE_KEY)) && e.OG_SYNC_MINUTES !== '0' };
  log('--- checks (' + label + ')');
  const before = failed;
  const h = await req(conf, 'GET', '/api/health');
  check('health on http ' + conf.port, h.status === 200 && h.json && h.json.ok, String(h.status));
  if (conf.https) { const hs = await req(conf, 'GET', '/api/health', { https: true }); check('health on https ' + conf.httpsPort, hs.status === 200, String(hs.status)); }
  else log('skip  https: OG_HTTPS=0 in this .env');
  const pw = password();
  const via = conf.https ? { https: true } : {};
  let cookie = '';
  if (!pw) check('a real sign-in', false, 'no row for ' + USER + ' in ' + ACCOUNTS);
  else {
    const li = await req(conf, 'POST', '/api/auth/login', { ...via, body: { username: USER, password: pw } });
    cookie = String((li.headers && li.headers['set-cookie'] || [])[0] || '').split(';')[0];
    check('a real sign-in (' + USER + ')', li.status === 200 && /og_session=/.test(cookie), String(li.status));
  }
  const probe = 'day06-probe-' + Date.now().toString(36);
  await req(conf, 'POST', '/api/auth/login', { body: { username: probe, password: 'x' }, headers: { 'X-Forwarded-For': '9.9.9.9', 'X-OG-Client-IP': '8.8.8.8' } });
  const ip = lastIp(probe);
  check('a forged X-Forwarded-For / X-OG-Client-IP is ignored', ip === '127.0.0.1', 'recorded ' + ip);
  if (conf.mirror) {
    let st = null;
    for (let i = 0; i < 60 && cookie; i++) {
      const r = await req(conf, 'GET', '/api/sync/status', { ...via, headers: { Cookie: cookie } });
      st = r.json && (r.json.status || r.json);
      if (st && st.mode === 'live' && st.lastOkAt) break;
      await sleep(3000);
    }
    check('the mirror is live and has pushed', !!(st && st.mode === 'live' && st.lastOkAt), JSON.stringify(st && { mode: st.mode, lastError: st.lastError }));
  } else log('skip  mirror: this .env has no Supabase keys or OG_SYNC_MINUTES=0');
  if (cookie) await req(conf, 'POST', '/api/auth/logout', { ...via, headers: { Cookie: cookie } });
  return failed === before;
}

/* -------------------------------------------------------------------- run */
const live = preconditions();
{
  const e = parseEnv(readFileSync(ENV, 'utf8'));
  if (await portOpen(Number(e.OG_PORT || 8090))) refuse('something answers on port ' + (e.OG_PORT || 8090) + ': the shop is open. Close it in the OG System window first.');
  log('ok    the shop is closed (nothing on port ' + (e.OG_PORT || 8090) + ')');
}
backup(live);

let bak = ENV.replace(/\.env$/, '.env.bak-day06');
if (!bak.endsWith('.env.bak-day06')) bak = ENV + '.bak-day06';
if (existsSync(bak)) bak = bak + '-' + Date.now();
copyFileSync(ENV, bak);
log('ok    the old .env saved as ' + bak.split(/[\\/]/).pop());
copyFileSync(ENV_NEXT, ENV);
log('ok    .env.next is now .env');

let good = false;
try {
  const ready = await startShop();
  log('the server is up; notices: ' + ((ready.notices || []).map((x) => x.code).join(', ') || 'none'));
  good = await checks('the new .env');
} catch (err) { check('the server started', false, err.message.split('\n')[0]); }
await stopShop();

if (good) {
  log('PASS - the new .env works. The server is stopped again.');
  log('Now open OG System and press "Open the shop". The old .env stays as ' + bak.split(/[\\/]/).pop() + '.');
  process.exit(0);
}
log('ROLLBACK - putting the old .env back');
copyFileSync(bak, ENV);
log('ok    .env restored from ' + bak.split(/[\\/]/).pop());
failed = 0;
let oldOk = false;
try { await startShop(); oldOk = await checks('the old .env, after rollback'); }
catch (err) { check('the server started on the old .env', false, err.message.split('\n')[0]); }
await stopShop();
log(oldOk ? 'ROLLED BACK - the old .env passes its checks. Open the shop as usual; tell the next session what failed above.'
          : 'ROLLED BACK, BUT THE OLD .env ALSO FAILS ITS CHECKS - do not leave the shop like this; read the lines above.');
process.exit(oldOk ? 2 : 4);
