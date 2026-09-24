/* ==========================================================================
   OG SYSTEM — control panel  ·  the five status lights
   --------------------------------------------------------------------------
   Five questions the shop floor can act on, answered every fifteen seconds
   while the panel's window is open:

     server  — does the shop answer, on 8090 and on the secure 8443
     wifi    — which address phones use, and does the certificate name it
     tunnel  — does the VPS answer across WireGuard (10.8.0.1)
     cloud   — the cloud copy, in the words of the server's own sync state
     public  — does https://shop.ogsports1.com reach THIS till

   EVERY CHECK HERE ONLY READS. A GET, a single ping, a look at state the
   panel already holds. Nothing in this file starts, stops, writes or makes
   anything — not a certificate, not a config row, not a Telegram message —
   and panel/test/lights.test.js greps it to keep it that way. When a light
   is amber or red it SAYS what to do; a person does it.

   A light is { id, state, code, args }, never a sentence: state is ok · warn ·
   bad · off (off = not checked, which is not the same as fine), and the
   window writes the words from panel/ui/i18n.js in the language it is set to
   — the rule server/lib/alerts.js follows, for the same reason.

   The rules are pure functions of what the probes found, so every one of
   them is a test with fakes; the probes take their fetch/spawn as arguments
   for the same reason.
   ========================================================================== */

import { spawn } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { join } from 'node:path';

export const LIGHT_IDS = ['server', 'wifi', 'tunnel', 'cloud', 'public'];
export const EVERY_MS = 15000;
/* The VPS's end of the WireGuard tunnel (day shift 06b). OG_PROXY_ADDR says
   the same thing on the shop laptop; this is the answer when it does not. */
export const DEFAULT_PEER = '10.8.0.1';
export const TUNNEL_NAME = 'og-shop';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function light(id, state, code, args) {
  return { id, state, code, args: args || {} };
}

/* ================================================================ probes */

/* Why a request failed, in one word the window can explain. */
export function classify(e) {
  const c = String((e && e.cause && (e.cause.code || e.cause.name)) || (e && (e.code || e.name)) || '');
  if (/Timeout|Abort|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/i.test(c)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN/i.test(c)) return 'dns';
  if (/ECONNREFUSED/i.test(c)) return 'refused';
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(c)) return 'tls';
  return 'net';
}

/* GET <url> and read /api/health's answer. `ok` is the shop's own word —
   200 AND { ok: true } — never just "something answered": the VPS proxy
   answers 503 { ok:false, code:'shop_unreachable' } for a till it cannot
   reach, and that is the one answer this check exists to tell apart. */
export async function httpHealth(url, { fetchFn = globalThis.fetch, timeoutMs = 5000, now = Date.now } = {}) {
  const t0 = now();
  try {
    const r = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
      redirect: 'manual'
    });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return {
      status: r.status,
      ok: r.status === 200 && !!(body && body.ok === true),
      code: body && typeof body.code === 'string' ? body.code : null,
      /* WHICH till answered: /api/health lists the answering machine's own
         Wi-Fi addresses, which is how the public light tells THIS laptop
         from another one answering the same domain. */
      lan: body && Array.isArray(body.lan) ? body.lan.map(ipOf).filter(Boolean) : null,
      ms: now() - t0,
      error: null
    };
  } catch (e) {
    return { status: null, ok: false, code: null, ms: now() - t0, error: classify(e) };
  }
}

/* The secure port, on this machine. Node's fetch has no switch for a
   self-signed certificate, so this is node:https with verification off —
   on the loopback address only, sending nothing but a GET for the health
   line. The question is "does 8443 answer", not "is the certificate right":
   the wifi light asks that, from the certificate's own list of names. */
export function localHttps(port, { request = httpsRequest, timeoutMs = 2500, now = Date.now } = {}) {
  return new Promise((done) => {
    const t0 = now();
    let finished = false;
    const end = (r) => { if (!finished) { finished = true; done(r); } };
    let req;
    try {
      req = request({
        host: '127.0.0.1', port, path: '/api/health', method: 'GET',
        rejectUnauthorized: false, timeout: timeoutMs, headers: { Accept: 'application/json' }
      }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (text.length < 65536) text += c; });
        res.on('end', () => {
          let body = null;
          try { body = JSON.parse(text); } catch { body = null; }
          end({ status: res.statusCode, ok: res.statusCode === 200 && !!(body && body.ok === true), ms: now() - t0, error: null });
        });
        res.on('error', (e) => end({ status: res.statusCode, ok: false, ms: now() - t0, error: classify(e) }));
      });
    } catch (e) { return end({ status: null, ok: false, ms: now() - t0, error: classify(e) }); }
    req.on('timeout', () => { req.destroy(); end({ status: null, ok: false, ms: now() - t0, error: 'timeout' }); });
    req.on('error', (e) => end({ status: null, ok: false, ms: now() - t0, error: classify(e) }));
    req.end();
  });
}

/* One echo request. The exit code is NOT the answer: Windows' ping exits 0
   for "Destination host unreachable", which is a reply from a router, not
   from the VPS. A real reply carries a TTL in every language Windows ships
   in, so that is what is looked for. */
export function parsePing(out) {
  const text = String(out || '');
  if (!/\bTTL\s*[=:]\s*\d+/i.test(text)) return { ok: false, ms: null };
  const m = /[=<]\s*([\d.,]+)\s*ms\b/i.exec(text);
  return { ok: true, ms: m ? Math.round(Number(m[1].replace(',', '.'))) : null };
}

export function runPing(host, timeoutMs = 1500) {
  return new Promise((done) => {
    const win = process.platform === 'win32';
    /* By full path: spawn() does not search PATHEXT, and a ping.bat in the
       working folder is not what anybody means. */
    const exe = win ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE') : 'ping';
    const args = win ? ['-n', '1', '-w', String(timeoutMs), host]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), host];
    let out = '';
    let finished = false;
    const end = (code) => { if (!finished) { finished = true; clearTimeout(timer); done({ code, out }); } };
    let p;
    try { p = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { return done({ code: null, out: '' }); }
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } end(null); }, timeoutMs + 2500);
    p.stdout.on('data', (b) => { out += b.toString('latin1'); });
    p.on('error', () => end(null));
    p.on('exit', (code) => end(code));
  });
}

export async function ping(host, { run = runPing, timeoutMs = 1500 } = {}) {
  /* An address, never a word: this becomes a command-line argument. */
  if (!host || !isIP(host)) return { ok: false, ms: null };
  const r = await run(host, timeoutMs);
  return parsePing(r && r.out);
}

/* Whether this laptop holds an address at all — the tunnel's own end. */
export function hasAddress(ifaces, address) {
  if (!address) return false;
  for (const list of Object.values(ifaces || {})) {
    for (const a of list || []) if (a && a.address === address) return true;
  }
  return false;
}

/* ================================================================= rules */

/* The shop server. The probe is the truth, not the panel's own idea of the
   state: a shop started from a terminal answers, and a child process that
   has stopped answering does not, whatever the button says. */
export function serverLight({ server, http, https, httpsExpected, httpPort = 8090, httpsPort = 8443 }) {
  if (server === 'starting') return light('server', 'off', 'srv_opening');
  if (server === 'stopping') return light('server', 'off', 'srv_closing');
  if (!http || !http.ok) return light('server', 'bad', server === 'running' ? 'srv_silent' : 'srv_closed');
  if (httpsExpected && !(https && https.ok)) return light('server', 'warn', 'srv_no_https', { port: httpsPort });
  return light('server', 'ok', 'srv_ok', { ports: httpsExpected ? [httpPort, httpsPort] : [httpPort] });
}

/* The address phones use, and whether the certificate names it — the
   question the server's cert_address notice asks once at startup, asked
   again every tick, because the router can hand out a new address at any
   time and the shop would otherwise not hear of it until tomorrow. */
export function wifiLight({ lan, secure, certExists }) {
  if (!lan || !lan.address) return light('wifi', 'bad', 'wifi_none');
  const a = { address: lan.address };
  if (!secure) return light('wifi', 'warn', certExists ? 'wifi_plain' : 'wifi_no_cert', a);
  if (lan.covered === false) return light('wifi', 'warn', 'wifi_uncovered', a);
  if (lan.covered !== true) return light('wifi', 'warn', 'wifi_unknown', a);
  return light('wifi', 'ok', lan.shop ? 'wifi_ok' : 'wifi_other', a);
}

/* The WireGuard tunnel. Only the public address depends on it — the till
   sells on the Wi-Fi with the tunnel down — and the words say so. */
export function tunnelLight({ peer = DEFAULT_PEER, configured, localAddr, localUp, reply }) {
  if (reply && reply.ok) return light('tunnel', 'ok', 'tun_ok', { peer, ms: reply.ms });
  if (!configured) return light('tunnel', 'off', 'tun_not_set', { peer });
  if (localAddr && localUp === false) return light('tunnel', 'bad', 'tun_down_here', { addr: localAddr, name: TUNNEL_NAME });
  return light('tunnel', 'bad', 'tun_no_reply', { peer });
}

/* The cloud copy, from SyncWorker.status() as the server sends it up the
   pipe. lastPushAt is when rows last went up — an idle shop has nothing to
   send, so its age alone is not a fault. What IS a fault is rows waiting
   with no contact for fifteen minutes (the bell's rule, server/lib/alerts.js)
   or no contact at all for an hour. */
export function cloudLight(m, { running, foreign = false, now = Date.now() } = {}) {
  if (foreign) return light('cloud', 'off', 'cloud_foreign');
  if (!running) return light('cloud', 'off', 'cloud_closed');
  if (!m) return light('cloud', 'off', 'cloud_silent');
  if (!m.configured) return light('cloud', 'warn', 'cloud_none');
  if (m.mode === 'off') return light('cloud', 'warn', 'cloud_manual');
  if (m.mode === 'refused') return light('cloud', 'bad', 'cloud_refused', { by: m.refusedBy || '?' });
  if (m.denied && m.denied.length) return light('cloud', 'bad', 'cloud_denied', { tables: m.denied.map((d) => d.table) });
  if (m.mode === 'starting') return light('cloud', 'warn', 'cloud_starting');
  const n = m.behind || 0;
  const okAt = m.lastOkAt ? Date.parse(m.lastOkAt) : NaN;
  const silentFor = isNaN(okAt) ? Infinity : now - okAt;
  if (m.mode === 'offline') {
    return silentFor > HOUR
      ? light('cloud', 'bad', 'cloud_offline_long', { n, at: m.lastOkAt || null })
      : light('cloud', 'warn', 'cloud_offline', { n, at: m.lastOkAt || null });
  }
  if (n && silentFor > 15 * MIN) return light('cloud', 'warn', 'cloud_behind', { n, at: m.lastOkAt || null });
  if (n) return light('cloud', 'ok', 'cloud_sending', { n });
  return m.lastPushAt ? light('cloud', 'ok', 'cloud_ok', { at: m.lastPushAt }) : light('cloud', 'ok', 'cloud_quiet');
}

export function hostOf(url) {
  try { return new URL(url).host; } catch { return String(url || ''); }
}

export function ipOf(url) {
  try { return new URL(String(url)).hostname; } catch { return null; }
}

/* The public address, asked from the outside in: out through this laptop's
   internet, into the VPS, back down the tunnel to this till. `shopUp` is
   whether the till answers locally, which is what tells "the VPS cannot
   reach the shop" (a fault) from "the shop is closed" (the truth). `ours`
   is this laptop's own addresses: an answer naming none of them came from
   a different till — a developer's laptop checking the real shop's domain —
   and green would be a claim about a machine this panel is not holding. */
export function publicLight({ url, res, shopUp, ours = null }) {
  const host = hostOf(url);
  if (!res) return light('public', 'off', 'pub_unchecked', { host });
  if (res.ok && Array.isArray(res.lan) && res.lan.length && Array.isArray(ours) && ours.length &&
      !res.lan.some((ip) => ours.indexOf(ip) > -1)) {
    return light('public', 'warn', 'pub_other', { host });
  }
  if (res.ok) return light('public', 'ok', 'pub_ok', { host, ms: res.ms });
  if (res.status === 503 && res.code === 'shop_unreachable') {
    return shopUp ? light('public', 'bad', 'pub_no_till', { host }) : light('public', 'warn', 'pub_closed', { host });
  }
  if (res.status) return light('public', 'warn', 'pub_odd', { host, status: res.status });
  if (res.error === 'dns') return light('public', 'bad', 'pub_dns', { host });
  return light('public', 'bad', 'pub_silent', { host, why: res.error || 'net' });
}
