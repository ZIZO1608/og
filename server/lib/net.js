/* ==========================================================================
   OG SYSTEM — which addresses this machine answers on              [net.js]
   --------------------------------------------------------------------------
   One list, because two copies of it drift. The server prints these at
   startup, /api/health hands them to the login screen so a second laptop is
   told exactly what to type, and the certificate script puts every one of
   them inside the certificate — a certificate that does not name the address
   somebody actually types is a warning page, not a padlock.
   ========================================================================== */

import { networkInterfaces, hostname } from 'node:os';
import { isIP } from 'node:net';
import { maybe } from './env.js';

/* Real network cards first, then the ones that are probably a VPN. Kept in
   that order rather than filtered, because "probably" is not "certainly" and
   the shop's wifi has been the second entry before now. */
export function lanAddresses() {
  const VIRTUAL = /vpn|virtual|vethernet|hyper-v|wsl|tap|tun|loopback|docker/i;
  const real = [];
  const other = [];

  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      /* 169.254.x is what Windows invents when DHCP failed. Nothing can
         reach it, so offering it would only waste someone's time. */
      if (a.address.startsWith('169.254.')) continue;
      if (VIRTUAL.test(name)) other.push({ address: a.address, note: `${name} — probably not this one` });
      else real.push({ address: a.address, note: '' });
    }
  }
  return real.concat(other);
}

/* OG_CERT_EXTRA_SANS (night shift 05): names the certificate must carry that
   this machine cannot see from its own network cards at the moment the
   certificate is made — the WireGuard end that is not up yet, the shop
   wifi's address while the laptop is somewhere else. Comma-separated; an IP
   goes in as an IP, anything else as a DNS name. Made ONCE with every name
   it will ever need, because every regeneration is one more "not a known
   authority" warning on every phone in the shop. */
export function extraSans() {
  const out = { ip: [], dns: [] };
  for (const raw of String(maybe('OG_CERT_EXTRA_SANS', '') || '').split(',')) {
    const v = raw.trim();
    if (!v) continue;
    if (isIP(v)) { if (out.ip.indexOf(v) < 0) out.ip.push(v); }
    else if (/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(v)) { if (out.dns.indexOf(v) < 0) out.dns.push(v); }
  }
  return out;
}

/* Just the addresses a browser might be pointed at, for the certificate. */
export function certNames() {
  const ips = lanAddresses().map((n) => n.address);
  /* The WireGuard end the VPS proxy connects to (night shift 04). Named even
     when the tunnel is down at the moment the certificate is made, because
     the proxy pins THIS certificate and a name missing from it is a front
     door that never opens. */
  const tunnel = String(maybe('OG_TUNNEL_ADDR', '') || '').trim();
  if (tunnel && ips.indexOf(tunnel) < 0) ips.push(tunnel);
  const extra = extraSans();
  for (const ip of extra.ip) if (ips.indexOf(ip) < 0 && ip !== '127.0.0.1') ips.push(ip);
  const host = String(hostname() || '').split('.')[0];
  return {
    dns: ['localhost'].concat(host && host.toLowerCase() !== 'localhost' ? [host, host + '.local'] : [])
      /* og-till: the fixed NAME the proxy verifies (proxy_ssl_name). nginx
         checks an upstream certificate's DNS names only — never its IP
         addresses — so pinning needs a name that does not change with the
         laptop's hostname. */
      .concat(['og-till'])
      .concat(extra.dns.filter((d) => d !== 'og-till' && d.toLowerCase() !== 'localhost' && d !== host && d !== host + '.local')),
    ip: ['127.0.0.1'].concat(ips)
  };
}
