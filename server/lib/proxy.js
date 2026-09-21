/* ==========================================================================
   OG SYSTEM — who is really on the other end of a request       [proxy.js]
   --------------------------------------------------------------------------
   Night shift 04. Behind shop.ogsports1.com every remote visitor arrives
   from ONE address: the VPS's end of the WireGuard tunnel. The login
   throttle needs the person, not the proxy, so the proxy says who it is
   carrying — and the whole question is when to believe it.

   The rule is one sentence: A FORWARDED ADDRESS IS BELIEVED ONLY FROM THE
   PROXY'S OWN SOCKET. `OG_PROXY_ADDR` names the address the proxy's
   requests arrive FROM (the VPS's tunnel address, 10.8.0.1). From that peer,
   and only that peer, the address in `X-OG-Client-IP` is the visitor. From
   every other peer — the till, a phone on the wifi, a script — the socket
   is the answer, whatever headers it sent.

   Why one header of our own and not X-Forwarded-For: nginx APPENDS to
   X-Forwarded-For, so its first entry is whatever the visitor typed. The
   proxy in deploy/shop-proxy/ OVERWRITES X-OG-Client-IP with the address
   it worked out itself, so a visitor cannot pre-fill it.

   This replaced OG_TRUST_PROXY=1, which believed the FIRST X-Forwarded-For
   entry from ANY connection: anyone on the shop wifi could write their own
   address into the login record with one header.
   ========================================================================== */

import { isIP } from 'node:net';

export const CLIENT_HEADER = 'x-og-client-ip';

/* "::ffff:10.8.0.1" and "10.8.0.1" are one machine; node reports the first
   when the server listens on the dual-stack "::". */
export function normAddr(a) {
  let s = String(a || '').trim().toLowerCase();
  if (s.startsWith('::ffff:') && isIP(s.slice(7)) === 4) s = s.slice(7);
  return s;
}

/* Read on every call, not at import: the value is a setting, and a test (or
   a later edit to .env picked up by a restart) must not be fighting a copy. */
export function proxyAddr() { return normAddr(process.env.OG_PROXY_ADDR || ''); }
export function tunnelAddr() { return normAddr(process.env.OG_TUNNEL_ADDR || ''); }

export function peerAddr(req) { return normAddr(req && req.socket && req.socket.remoteAddress); }

/* The socket is the proxy. Nothing about the request's headers matters. */
export function viaProxy(req) {
  const p = proxyAddr();
  return !!p && peerAddr(req) === p;
}

/* Did this request come in through the PUBLIC door — the proxy, carrying a
   visitor? og-bridge also talks from the proxy's address (it runs on the
   same VPS) but carries no visitor, so it sends no client header. */
export function forwardedVisitor(req) {
  return viaProxy(req) && !!(req.headers[CLIENT_HEADER] || req.headers['x-forwarded-for']);
}

/* A proxy that nobody told the till about. The VPS proxy going live before
   OG_PROXY_ADDR is set means every visitor from outside shares the proxy's
   address — and one twenty-failure limit between all of them. That is
   invisible until the owner is locked out from home, so the first time a
   peer we do not trust sends the proxy's header, say so once. A phone
   forging the header gets the same one line; the set is capped. */
const strays = new Set();
function stray(req) {
  if (!req.headers[CLIENT_HEADER]) return;
  const p = peerAddr(req);
  if (strays.has(p) || strays.size >= 32) return;
  strays.add(p);
  console.log(`  [proxy] ${p} sent ${CLIENT_HEADER} and is not OG_PROXY_ADDR` +
    (proxyAddr() ? ` (${proxyAddr()})` : ' (unset)') +
    ' — ignored. If that is the VPS proxy, set OG_PROXY_ADDR to it.');
}

export function clientIp(req) {
  if (viaProxy(req)) {
    const h = normAddr(String(req.headers[CLIENT_HEADER] || '').split(',')[0]);
    if (h && isIP(h)) return h;
  } else stray(req);
  return peerAddr(req) || null;
}
