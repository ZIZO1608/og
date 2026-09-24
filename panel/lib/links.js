/* ==========================================================================
   OG SYSTEM — control panel  ·  the two addresses a phone is given
   --------------------------------------------------------------------------
   The Shop screen shows two QR codes, and this file decides what goes in
   them. It has no side effects and reads nothing by itself, so every rule
   below is a test in panel/test/links.test.js:

     · IN THE SHOP (Wi-Fi) — https://<this laptop's LAN address>:8443. Works
       with the internet down, because the phone talks to the laptop across
       the room. The laptop often has several addresses — the shop Wi-Fi, a
       phone hotspot, ZeroTier, a VPN, the WireGuard tunnel — and exactly one
       of them is the one a phone on the shop's Wi-Fi can reach.
     · FROM ANYWHERE — shop.public_url (https://shop.ogsports1.com), through
       the VPS and the tunnel. Needs the internet at both ends.

   THE LIST OF ADDRESSES IS NOT MADE HERE. server/lib/net.js is the one list
   of this machine's addresses (the certificate, /api/health and the startup
   banner all read it) and this file only RANKS it. It is given the interface
   names as a hint, because lanAddresses() flags a virtual adapter only when
   its name says so — and ZeroTier, PIA and a phone hotspot all have names
   that do not.
   ========================================================================== */

import { publicUrlProblem } from '../../server/lib/config-writable.js';

/* The shop's own Wi-Fi. The router hands the till 10.10.99.9; any address in
   this block is the shop network by definition. */
export const SHOP_NET = '10.10.99.';

/* What the "from anywhere" code says when nobody has set shop.public_url.
   The domain has answered since day shift 07; a blank code would be worse. */
export const DEFAULT_PUBLIC = 'https://shop.ogsports1.com';

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
/* Adapters a phone on the shop Wi-Fi can never reach, by the names Windows
   gives them. lanAddresses() already notes the generic ones (vpn, virtual,
   tap, tun, hyper-v, wsl, docker); these are the ones this laptop actually
   has, whose names give nothing away. */
const OVERLAY = /zerotier|wireguard|wintun|\bwg|\bpia\b|private internet|tailscale|nord|openvpn|proton|hamachi|og-shop/i;

/* Every candidate, best first. A candidate is { address, note, name, shop,
   virtual, covered, tier }; `covered` is whether the certificate names it,
   null when there is no certificate to ask.

   The order, and why:
     0  the shop Wi-Fi (10.10.99.x)              — the answer whenever it is there
     1  a real card with a private address        — home Wi-Fi, a phone hotspot
     2  any other real card                       — unusual; still better than an overlay
     3  an overlay or a virtual adapter           — ZeroTier, a VPN, Hyper-V: phones cannot reach it
   Inside one tier an address the certificate names comes first, then the
   order Windows listed them in. The tunnel's own end (10.8.0.2) and loopback
   are never candidates: a phone cannot use either. */
export function rankAddresses(list, { names = {}, tunnel = '', certIps = null } = {}) {
  const seen = new Set();
  const out = [];
  (list || []).forEach((n, i) => {
    const address = typeof n === 'string' ? n : n && n.address;
    if (!address || seen.has(address)) return;
    if (address === tunnel || address.startsWith('127.') || address.startsWith('169.254.')) return;
    seen.add(address);
    const note = (n && n.note) || '';
    const name = names[address] || '';
    const shop = address.startsWith(SHOP_NET);
    const overlay = !!note || OVERLAY.test(name);
    const tier = shop ? 0 : overlay ? 3 : PRIVATE.test(address) ? 1 : 2;
    out.push({
      address, note, name, shop, virtual: overlay,
      covered: Array.isArray(certIps) ? certIps.indexOf(address) > -1 : null,
      tier, i
    });
  });
  out.sort((a, b) => a.tier - b.tier || (b.covered === true) - (a.covered === true) || a.i - b.i);
  return out.map(({ i, ...r }) => r);
}

/* The address on the code: the one somebody chose in the panel if the
   laptop still has it, otherwise the best-ranked. A choice for an address
   the laptop no longer has is not an error — it moved networks — and it is
   honoured again the moment the address comes back. */
export function pickAddress(ranked, chosen) {
  if (!ranked || !ranked.length) return null;
  if (chosen && ranked.some((r) => r.address === chosen)) return chosen;
  return ranked[0].address;
}

/* The URL a phone opens. Secure whenever the shop serves HTTPS: the plain
   address works too, but a browser silently refuses the camera scanner,
   notifications and installing the app on it (server/lib/tls.js says why). */
export function shopUrl(address, { secure = true, httpsPort = 8443, httpPort = 8090 } = {}) {
  if (!address) return null;
  return secure ? `https://${address}:${httpsPort}` : `http://${address}:${httpPort}`;
}

/* The "from anywhere" address: shop.public_url when it holds something the
   server itself would accept, the usual domain otherwise. `problem` is the
   server's own sentence when the stored value is unusable — the same
   function PUT /api/config refuses with, so the two cannot disagree. */
export function publicLink(stored) {
  const v = String(stored == null ? '' : stored).trim();
  if (v && !publicUrlProblem(v)) {
    return { url: new URL(v).origin, source: 'config', problem: null };
  }
  return { url: DEFAULT_PUBLIC, source: 'default', problem: v ? publicUrlProblem(v) : null };
}

/* What the QR codes hold. Exactly the address printed under each one — a
   code that opens something other than the words beside it is a code
   nobody can check by eye. Never localhost: a phone pointed at a code for
   localhost opens the phone itself and finds nothing, which reads as the
   shop being broken. */
export function qrPayloads(links) {
  const out = {};
  if (links && links.lan && links.lan.url && !/\/\/(localhost|127\.)/i.test(links.lan.url)) out.wifi = links.lan.url;
  if (links && links.public && links.public.url) out.public = links.public.url;
  return out;
}
