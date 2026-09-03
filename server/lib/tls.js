/* ==========================================================================
   OG SYSTEM — the certificate                                      [tls.js]
   --------------------------------------------------------------------------
   The till serves the shop over plain HTTP on localhost quite happily. Every
   OTHER device cannot: a browser treats http://10.10.99.9:8090 as insecure,
   and silently refuses three things this app needs —

     · Notification — the phone in a pocket never buzzes for a new order
     · getUserMedia — the camera barcode scanner cannot open the camera
     · serviceWorker — the app cannot be installed and has no offline shell

   None of them report an error a shopkeeper would recognise; they simply do
   not happen. So the server also listens on HTTPS with a certificate it
   makes itself (`npm run cert`).

   IT IS SELF-SIGNED, and that is the whole trade-off. No authority vouches
   for it, so each device shows one warning the first time and somebody has
   to press "continue". After that the browser treats the address as secure
   and all three of the above start working. The alternative — a certificate
   the world trusts — needs a public domain name, which means exposing a till
   full of real money to the internet. One warning per device is the cheaper
   half of that bargain.

   The private key never leaves server/data/certs/ and is not in the repo.
   ========================================================================== */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DIR  = resolve(HERE, '..', 'data', 'certs');
export const KEY  = resolve(DIR, 'og-key.pem');
export const CERT = resolve(DIR, 'og-cert.pem');
export const META = resolve(DIR, 'og-cert.json');

export function ensureDir() { mkdirSync(DIR, { recursive: true }); }

export function have() { return existsSync(KEY) && existsSync(CERT); }

export function load() {
  if (!have()) return null;
  return { key: readFileSync(KEY), cert: readFileSync(CERT) };
}

/* What the certificate was made to cover, written beside it at the time.
   Read back rather than parsed out of the PEM: this is a note to a person,
   not a security decision, and an ASN.1 parser here would be a liability
   for no gain. */
export function meta() {
  if (!existsSync(META)) return null;
  try { return JSON.parse(readFileSync(META, 'utf8')); } catch { return null; }
}

/* Addresses this machine now answers on that the certificate does NOT name.
   A shop's IP moves when the router restarts, and the first anybody hears of
   it is a browser refusing to connect at all — Chrome will not let you click
   past a name mismatch as readily as an unknown issuer. Said plainly at
   startup instead. */
export function uncovered(ips) {
  const m = meta();
  if (!m || !Array.isArray(m.ip)) return [];
  return ips.filter((ip) => m.ip.indexOf(ip) < 0);
}

/* Days left, so an expiry is noticed before it stops the shop. */
export function daysLeft() {
  const m = meta();
  if (!m || !m.expires) return null;
  return Math.round((new Date(m.expires) - Date.now()) / 86400000);
}
