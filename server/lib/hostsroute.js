/* ==========================================================================
   OG SYSTEM — the shop's domain, through the tunnel             [hostsroute.js]
   --------------------------------------------------------------------------
   On 29 Sep 2026 the shop's PC could not open shop.ogsports1.com while the
   rest of the world could. Its route to the VPS's public address went
   through a carrier that swallowed every HTTPS connection (curl "connected",
   then nothing; the VPS saw zero packets) — the same fault as 27 and 28 Sep,
   each time on a different VPN exit. The WireGuard tunnel to the same VPS
   worked the whole time, and the VPS's front door answers on the tunnel's
   address too, with the real certificate.

   So on the shop's PC the domain is sent THROUGH THE TUNNEL: one line in the
   Windows hosts file, `10.8.0.1 shop.ogsports1.com`. Same origin, same
   cookies, same service worker, the real Let's Encrypt certificate — the
   browser, the print agent and everything else on the PC simply stop
   depending on the public route. And it removes the split that left nobody
   able to sell: the standby judges the main server by the tunnel, and now
   the PC's browser reaches it by the tunnel too, so "the main server is
   there" means the same thing to both. When the tunnel drops, both lose it
   together and the standby takes the till (lib/standby.js).

   This file is the PURE half — what the line is, where it goes in the file,
   and whether it is there — so it can be tested without touching Windows.
   scripts/tunnel-route.js does the reading, the one permission prompt and
   the writing.
   ========================================================================== */

import { isIP } from 'node:net';

export const BEGIN = '# >>> og-shop tunnel (npm run tunnel-route) - the shop domain goes through WireGuard';
export const END = '# <<< og-shop tunnel';
const BEGIN_RX = /^#\s*>>>\s*og-shop tunnel\b/i;
const END_RX = /^#\s*<<<\s*og-shop tunnel\b/i;

/* Which line this machine needs, from its .env — or why it needs none.
   Only a STANDBY needs it (the machine whose main server is on the other end
   of the tunnel), and only when OG_UPSTREAM is the tunnel's IP and
   OG_STANDBY_HOME is the domain the browsers open. */
export function wanted(env) {
  const e = env || {};
  if (String(e.OG_ROLE || '').trim().toLowerCase() !== 'standby') return { need: false, why: 'not_standby' };
  let up, home;
  try { up = new URL(String(e.OG_UPSTREAM || '')); } catch { return { need: false, why: 'no_upstream' }; }
  try { home = new URL(String(e.OG_STANDBY_HOME || '')); } catch { return { need: false, why: 'no_home' }; }
  const ip = up.hostname;
  if (isIP(ip) !== 4) return { need: false, why: 'upstream_not_ip' };
  const host = home.hostname.toLowerCase();
  if (isIP(host) || host === 'localhost' || host.indexOf('.') < 0 || !/^[a-z0-9.-]+$/.test(host)) {
    return { need: false, why: 'home_not_name' };
  }
  return { need: true, ip, host };
}

function lines(text) { return String(text == null ? '' : text).split(/\r?\n/); }

/* A hosts line: an address, then one or more names, then maybe a comment. */
function parseLine(l) {
  const body = l.replace(/#.*$/, '').trim();
  if (!body) return null;
  const parts = body.split(/\s+/);
  return { ip: parts[0], names: parts.slice(1).map((n) => n.toLowerCase()) };
}

/* Where the file stands for this host:
     on     our block is there and says ip → host
     stale  our block is there with another address (the tunnel moved)
     other  a line OUTSIDE our block already names the host — somebody's own;
            Windows takes the first match, so ours would be ignored. Not
            touched, only reported.
     off    nothing names the host */
export function state(text, ip, host) {
  const h = String(host || '').toLowerCase();
  let inBlock = false, ours = null, other = null;
  for (const l of lines(text)) {
    const s = l.trim();
    if (BEGIN_RX.test(s)) { inBlock = true; continue; }
    if (END_RX.test(s)) { inBlock = false; continue; }
    const p = parseLine(s);
    if (!p || p.names.indexOf(h) < 0) continue;
    if (inBlock) { if (!ours) ours = p.ip; }
    else if (!other) other = { ip: p.ip, line: s };
  }
  if (other) return { state: 'other', line: other.line, ip: other.ip };
  if (ours === ip) return { state: 'on' };
  if (ours) return { state: 'stale', ip: ours };
  return { state: 'off' };
}

/* The file with our block taken out, and nothing else touched. A BEGIN with
   no END (a file somebody cut in half) loses only the lines that are ours in
   shape: the marker and entries naming nothing but addresses and names. */
export function without(text) {
  const src = lines(text);
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const s = src[i].trim();
    if (!BEGIN_RX.test(s)) { if (!END_RX.test(s)) out.push(src[i]); continue; }
    let j = i + 1;
    while (j < src.length && !END_RX.test(src[j].trim()) && !BEGIN_RX.test(src[j].trim())) j++;
    if (j < src.length && END_RX.test(src[j].trim())) { i = j; continue; }
    /* No end marker: drop the begin line and the one entry right after it. */
    if (i + 1 < src.length && parseLine(src[i + 1].trim())) i++;
  }
  while (out.length > 1 && out[out.length - 1] === '' && out[out.length - 2] === '') out.pop();
  return out.join('\r\n');
}

/* The file with our block at the end, saying ip → host. Windows expects CRLF;
   everything else in the file is kept, line for line. */
export function withRoute(text, ip, host) {
  let base = without(text);
  if (base && !/\r?\n$/.test(base)) base += '\r\n';
  return base + BEGIN + '\r\n' + ip + ' ' + String(host).toLowerCase() + '\r\n' + END + '\r\n';
}
