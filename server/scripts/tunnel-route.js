/* ==========================================================================
   OG SYSTEM — send the shop's domain through the tunnel     [tunnel-route.js]
   --------------------------------------------------------------------------
   `npm run tunnel-route`. On the shop's PC (a STANDBY: OG_ROLE=standby,
   OG_UPSTREAM=http://10.8.0.1:8090, OG_STANDBY_HOME=https://shop.ogsports1.com)
   it puts ONE line in the Windows hosts file:

       10.8.0.1 shop.ogsports1.com

   so the browser, the print agent and everything else on the PC reach the
   real domain — its own certificate, its own cookies — over the WireGuard
   tunnel instead of the public route. Why, at length: lib/hostsroute.js.

     --check    read-only, no prompt. Exit 0 = in place (or not needed on
                this machine), 4 = missing or out of date and fixable from
                here, 1 = something a person must look at (another line in
                the hosts file already names the domain).
     --probe    with --check: also ask the domain through the tunnel, with
                certificate checking on. Costs one request.
     --json     one line `OG_ROUTE_JSON {...}` for the launcher.
     (default)  put the line in. Asks the domain through the tunnel FIRST and
                refuses if it does not answer with a valid certificate — a
                hosts line to a door that is shut would take the domain away
                from this PC. One Windows permission prompt, then it checks
                its own work.
     --undo     take the line out again (one prompt).

   OG_HOSTS_FILE points it at another file and skips the permission prompt —
   for the tests only; never set on a shop.
   ========================================================================== */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import https from 'node:https';
import { execPath, env, platform, argv } from 'node:process';
import { maybe } from '../lib/env.js';
import * as Route from '../lib/hostsroute.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = new Set(argv.slice(2));
const MODE = args.has('--check') ? 'check' : args.has('--undo') ? 'undo' : 'apply';
const JSON_OUT = args.has('--json');
const LOG = (() => { const i = argv.indexOf('--log'); return i > -1 ? argv[i + 1] : null; })();
const TEST_FILE = env.OG_HOSTS_FILE || '';
const HOSTS = TEST_FILE || resolve(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');

/* Run elevated it has no window, so what it says also goes to a file the
   un-elevated parent prints afterwards — trust-cert.js's trick. */
function say(s = '') { if (!JSON_OUT) console.log(s); if (LOG) { try { appendFileSync(LOG, s + '\n'); } catch { /* the exit code still tells */ } } }
const dim  = (s) => `\x1b[2m${s}\x1b[0m`;
const tick = (s) => `  \x1b[32mOK\x1b[0m    ${s}`;
const warn = (s) => `  \x1b[33mNOTE\x1b[0m  ${s}`;
const bad  = (s) => `  \x1b[31mNO\x1b[0m    ${s}`;
const hint = (s) => `        ${dim(s)}`;

function report(obj, code) {
  if (JSON_OUT) console.log('OG_ROUTE_JSON ' + JSON.stringify(obj));
  process.exit(code);
}

/* Does the domain answer through the tunnel, with certificate checking ON?
   node:https straight to the tunnel address with the domain as the SNI name
   and the Host header — `curl --resolve`, without curl. */
function probe(ip, host) {
  return new Promise((done) => {
    const t0 = Date.now();
    const req = https.request({
      host: ip, port: 443, path: '/api/health', method: 'GET', servername: host,
      headers: { Host: host, Accept: 'application/json' }, timeout: 8000
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 4096) body += c; });
      res.on('end', () => {
        let ok = false;
        try { ok = res.statusCode === 200 && JSON.parse(body).ok === true; } catch { ok = false; }
        done({ ok, status: res.statusCode, ms: Date.now() - t0, code: ok ? null : 'bad_answer' });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })));
    req.on('error', (e) => done({ ok: false, ms: Date.now() - t0, code: e.code || 'error', message: e.message }));
    req.end();
  });
}

function readHosts() {
  /* latin1 keeps every byte as it was: the file is ASCII by convention, and
     whatever else somebody put in it must come back out unchanged. */
  try { return existsSync(HOSTS) ? readFileSync(HOSTS, 'latin1') : ''; }
  catch (e) { return null; }
}

function isAdmin() {
  if (TEST_FILE) return true;
  const r = spawnSync('net', ['session'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

function psq(s) { return String(s).replace(/'/g, "''"); }

function elevate(verb) {
  const log = resolve(env.TEMP || env.TMP || HERE, `og-tunnel-route-${Date.now()}.log`);
  try { writeFileSync(log, ''); } catch { /* printed later if it exists */ }
  const script =
    'try {\n' +
    `  $p = Start-Process -FilePath '${psq(execPath)}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '"${psq(resolve(HERE, 'tunnel-route.js'))}"','${verb}','--log','"${psq(log)}"'\n` +
    '  exit $p.ExitCode\n' +
    '} catch { exit 99 }';
  say('  Windows will ask permission — the hosts file belongs to the whole computer.');
  say('');
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 300000 });
  if (existsSync(log)) {
    try { const t = readFileSync(log, 'utf8').replace(/\r?\n$/, ''); if (t && !JSON_OUT) console.log(t); } catch { /* exit code below */ }
  }
  if (r.status === 99) {
    say('');
    say(warn('Nothing changed — the permission prompt was refused or closed.'));
    say(hint('Run it again when somebody can press Yes:  npm run tunnel-route'));
    return 1;
  }
  return r.status === 0 ? 0 : 1;
}

function write(text) {
  writeFileSync(HOSTS, text, 'latin1');
  if (!TEST_FILE && platform === 'win32') {
    /* Windows' DNS client caches answers, including "not found"; the file is
       re-read by itself, the cache is not. */
    spawnSync('ipconfig', ['/flushdns'], { encoding: 'utf8', windowsHide: true });
  }
}

/* ------------------------------------------------------------------ main */

const w = Route.wanted({
  OG_ROLE: maybe('OG_ROLE', ''), OG_UPSTREAM: maybe('OG_UPSTREAM', ''), OG_STANDBY_HOME: maybe('OG_STANDBY_HOME', '')
});

if (platform !== 'win32' && !TEST_FILE) {
  say(warn('The hosts-file route is a Windows step. On this OS add the line by hand:'));
  if (w.need) say(hint(`${w.ip} ${w.host}   in /etc/hosts`));
  report({ state: 'na', why: 'not_windows' }, 0);
}

const text = readHosts();
if (text === null) {
  say(bad(`The hosts file could not be read: ${HOSTS}`));
  report({ state: 'unreadable' }, 1);
}

if (!w.need) {
  /* Not a standby, or its .env names no tunnel address: nothing to do — but a
     block left over from when it WAS one is taken out on --undo. */
  const leftover = /og-shop tunnel/i.test(text);
  if (MODE === 'undo' && leftover) {
    if (!isAdmin()) process.exit(elevate('--undo'));
    write(Route.without(text));
    say(tick('Removed the old tunnel line from the hosts file.'));
    report({ state: 'off', why: w.why }, 0);
  }
  say(tick('This computer does not need the tunnel line — it is not the shop\'s standby'));
  say(hint(`(${w.why}). Nothing to do.`));
  report({ state: 'na', why: w.why, leftover }, 0);
}

const st = Route.state(text, w.ip, w.host);

if (MODE === 'check') {
  let p = null;
  if (args.has('--probe')) p = await probe(w.ip, w.host);
  const base = { state: st.state, ip: w.ip, host: w.host, probe: p, line: st.line || null };
  if (st.state === 'on') {
    say(tick(`${w.host} goes through the tunnel (${w.ip}) on this computer.`));
    if (p && !p.ok) say(warn(`…but it does not answer there right now (${p.code || p.status}). The tunnel may be down.`));
    report(base, 0);
  }
  if (st.state === 'other') {
    say(bad(`The hosts file already sends ${w.host} somewhere else:`));
    say(hint(st.line));
    say(hint('Windows uses the first line it finds, so the tunnel line would be ignored. Remove that line by hand.'));
    report(base, 1);
  }
  say(warn(st.state === 'stale'
    ? `The tunnel line points ${w.host} at ${st.ip}, but the tunnel's address is ${w.ip}.`
    : `${w.host} still goes over the public route on this computer, not through the tunnel.`));
  say(hint('Fixable from here, once:  npm run tunnel-route'));
  report(base, 4);
}

if (MODE === 'undo') {
  if (st.state !== 'on' && st.state !== 'stale' && !/og-shop tunnel/i.test(text)) {
    say(tick('The tunnel line was not in the hosts file; nothing to remove.'));
    report({ state: 'off' }, 0);
  }
  if (!isAdmin()) process.exit(elevate('--undo'));
  write(Route.without(text));
  const after = Route.state(readHosts(), w.ip, w.host);
  if (after.state === 'off' || after.state === 'other') {
    say(tick(`Removed. ${w.host} goes over the public route again on this computer.`));
    report({ state: 'off' }, 0);
  }
  say(bad('The line is still there after writing — something else holds the file.'));
  report({ state: after.state }, 1);
}

/* apply */
if (st.state === 'on') {
  say(tick(`Already in place: ${w.host} goes through the tunnel (${w.ip}).`));
  report({ state: 'on', ip: w.ip, host: w.host }, 0);
}
if (st.state === 'other') {
  say(bad(`The hosts file already sends ${w.host} somewhere else, so nothing was changed:`));
  say(hint(st.line));
  say(hint('Remove that line by hand (it is not ours), then run this again.'));
  report({ state: 'other', line: st.line }, 1);
}

/* The door has to be open before we send the domain to it. Asked by the
   un-elevated half, and again by the elevated one — cheap, and the elevated
   run may be started on its own. */
const p = await probe(w.ip, w.host);
if (!p.ok) {
  say(bad(`${w.host} does not answer through the tunnel right now (${p.code || ('HTTP ' + p.status)}), so nothing was changed.`));
  say(hint('The line would take the domain away from this computer. Check the tunnel (the WireGuard'));
  say(hint('og-shop service), then run this again:  npm run tunnel-route'));
  report({ state: st.state, probe: p }, 1);
}

if (!isAdmin()) process.exit(elevate('--apply'));

write(Route.withRoute(text, w.ip, w.host));
const after = Route.state(readHosts(), w.ip, w.host);
if (after.state !== 'on') {
  say(bad('The line did not stay in the hosts file — something else holds it (an antivirus?).'));
  report({ state: after.state }, 1);
}
say(tick(`${w.host} now goes through the tunnel (${w.ip}) on this computer — ${p.ms} ms, real certificate.`));
say(hint('Browsers already open may need closing and reopening once. Other computers are not affected.'));
report({ state: 'on', ip: w.ip, host: w.host, probe: p }, 0);
