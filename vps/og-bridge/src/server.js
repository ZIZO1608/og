/* ==========================================================================
   og-bridge — the VPS half of OG System.                          [server.js]
   --------------------------------------------------------------------------
   Three jobs, and none of them writes a single row of shop data:

   1. ROAD-WATCH. Keeps asking the till over the WireGuard tunnel whether it
      is there, and the mirror when it last heard from it (mode.js). The
      moment the road comes back it asks the till to collect og-track's
      inbox. /healthz says which world the shop is in.

   2. THE OWNER'S SNAPSHOT (/snapshot, snapshot.js). When the shop's internet
      is down and the owner is away, the last figures the cloud copy received
      — read-only, behind its own login, with their age at the top.

   3. NIGHT MODE (/night, night.js). Stock, customers and recent orders read
      from the cloud copy, for the staff while the shop is shut, and ONE
      thing they may write: a request, which waits in the cloud (035) until a
      person on the laptop accepts it. The laptop stays the only writer.

   It is reached ONLY through the nginx proxy on the coolify docker network
   (deploy/shop-proxy/), which routes /snapshot and /night here and nothing
   else. It is never given a public domain of its own in Coolify.
   ========================================================================== */
import { createServer } from 'node:http';
import { config } from './config.js';
import { makeTill } from './till.js';
import { makeMirror } from './mirror.js';
import { roadWatch } from './road-watch.js';
import { snapshotRoutes } from './snapshot.js';
import { nightRoutes } from './night.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

const till = makeTill({ url: config.tillUrl, caFile: config.tillCa, key: config.tillKey });
const mirror = makeMirror({ url: config.mirrorUrl, caFile: config.mirrorCa, tlsInsecure: config.mirrorTlsInsecure });
const road = roadWatch({ till, mirror, staleMs: config.staleMs, probeMs: config.probeMs, statusMs: config.statusMs, log });
const snapshot = snapshotRoutes({ config, mirror, road, log });
const night = nightRoutes({ config, mirror, road, log });

function send(res, status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(text);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://og-bridge');
    /* The container's own pulse and the mode — no figures, no secrets. */
    if (url.pathname === '/healthz' && req.method === 'GET') {
      const s = road.state;
      return send(res, 200, {
        ok: true, mode: s.mode, reason: s.reason, since: s.since,
        beatAt: s.beatAt, ageMs: s.ageMs, till: { ok: s.till.ok },
        collects: s.collects, lastCollect: s.lastCollect
      });
    }
    if (url.pathname === '/snapshot' || url.pathname.startsWith('/snapshot/')) {
      return await snapshot.handle(req, res, url);
    }
    if (url.pathname === '/night' || url.pathname.startsWith('/night/')) {
      return await night.handle(req, res, url);
    }
    send(res, 404, 'Not found.\n');
  } catch (e) {
    log('[http]', e && e.stack || e);
    if (!res.headersSent) send(res, 500, 'Something went wrong.\n');
    else res.end();
  }
});

server.listen(config.port, () => {
  log(`og-bridge on :${config.port} — till ${config.tillUrl}, stale after ${config.staleMs / 60000} min`);
  road.start();
});

const quit = () => { road.stop(); server.close(() => mirror.close().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
