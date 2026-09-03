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

/* Just the addresses a browser might be pointed at, for the certificate. */
export function certNames() {
  const ips = lanAddresses().map((n) => n.address);
  const host = String(hostname() || '').split('.')[0];
  return {
    dns: ['localhost'].concat(host && host.toLowerCase() !== 'localhost' ? [host, host + '.local'] : []),
    ip: ['127.0.0.1'].concat(ips)
  };
}
