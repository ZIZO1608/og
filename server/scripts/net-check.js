/* ==========================================================================
   OG SYSTEM — what can this machine actually reach?
   --------------------------------------------------------------------------
   Run:  cd server && npm run net-check

   RUN THIS WITH EVERY VPN TURNED OFF, on the shop's own connection.

   The whole cloud-mirror plan rests on one assumption: that the shop can
   reach Supabase. Testing that through a VPN answers a different question —
   it tells you the VPN works, which was never in doubt. Syria sits behind
   enough sanctions-driven geo-blocking that "it worked on my laptop" and "it
   works at the shop" are genuinely different facts, and finding out after
   the sync is built is the expensive order to find out in.

   Nothing here needs credentials. It only asks whether the hosts answer.
   ========================================================================== */

import { lookup } from 'node:dns/promises';
import { load, maybe } from '../lib/env.js';

load();

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;

/* The project's own host is the one that actually matters — Supabase's
   marketing site being up says nothing about whether your project's API
   endpoint resolves and answers. Read from .env when it is filled in. */
const projectHost = (() => {
  const url = maybe('SUPABASE_URL');
  if (!url) return null;
  try { return new URL(url).host; } catch { return null; }
})();

const TARGETS = [
  { host: 'github.com',    why: 'baseline — known to work here' },
  { host: 'supabase.com',  why: 'Supabase dashboard' },
  { host: 'supabase.co',   why: 'Supabase project domain' },
  projectHost
    ? { host: projectHost, why: 'YOUR project — the one that matters' }
    : null
].filter(Boolean);

async function check({ host, why }) {
  const out = { host, why, dns: null, http: null, ms: null, err: null };

  try {
    const { address } = await lookup(host);
    out.dns = address;
  } catch (err) {
    out.err = `DNS failed (${err.code || err.message})`;
    return out;
  }

  const t0 = Date.now();
  try {
    const ctl = AbortSignal.timeout(12000);
    const res = await fetch(`https://${host}`, { signal: ctl, redirect: 'manual' });
    out.http = res.status;
    out.ms = Date.now() - t0;
  } catch (err) {
    out.ms = Date.now() - t0;
    /* Node hides the real reason on `cause`; without unwrapping it every
       failure reads as the useless string "fetch failed". */
    out.err = err.cause?.code || err.cause?.message || err.name || err.message;
  }
  return out;
}

console.log('');
console.log('\x1b[1m  Reachability — run this with every VPN OFF\x1b[0m');
console.log('');

const results = [];
for (const t of TARGETS) {
  const r = await check(t);
  results.push(r);

  const label = r.host.padEnd(34);
  if (r.err) {
    console.log(`  ${R('✗')} ${label} ${R(r.err)}`);
  } else {
    /* Any HTTP answer at all means the host is reachable. A 404 or a 307 is
       still a conversation; only silence is a block. */
    console.log(`  ${G('✓')} ${label} HTTP ${r.http}  ${r.ms}ms`);
  }
  console.log(`    ${'\x1b[2m'}${r.why}\x1b[0m`);
}

const base = results.find(r => r.host === 'github.com');
const sb = results.filter(r => r.host.includes('supabase'));
const sbOk = sb.some(r => !r.err);

console.log('');
console.log('\x1b[1m  Verdict\x1b[0m');

if (base?.err) {
  console.log(`  ${Y('!')} Even github.com failed. This machine has no working`);
  console.log('    internet right now, so nothing below means anything.');
} else if (sbOk) {
  console.log(`  ${G('Supabase is reachable from this connection.')}`);
  console.log('    The cloud-mirror plan works. If a VPN was on, turn it off');
  console.log('    and run this again — that is the answer that counts.');
} else {
  console.log(`  ${R('Supabase is NOT reachable from this connection.')}`);
  console.log('    GitHub answered, so the internet itself is fine — Supabase');
  console.log('    specifically is being blocked or geo-refused.');
  console.log('');
  console.log('    This does not sink the project. The shop keeps working on');
  console.log('    SQLite exactly as it does now; only the cloud copy is off.');
  console.log('    Tell Claude and we will pick a host that answers from here.');
}
console.log('');
