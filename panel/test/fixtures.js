/* Shared by panel/test/lights.test.js and the screenshot harness
   (_tools/panel-preview.mjs): the states the Shop screen is shown in, built by
   the REAL rules in panel/lib/lights.js from made-up probe answers, so a
   picture can never show a light the rules would not produce. */
import * as L from '../lib/lights.js';

export const MIN = 60 * 1000;
export const NOW = Date.parse('2026-09-24T12:00:00Z');
export const iso = (ms) => new Date(ms).toISOString();

export const liveMirror = (o) => ({
  configured: true, mode: 'live', behind: 0,
  lastOkAt: iso(NOW - 10000), lastPushAt: iso(NOW - 3 * MIN), denied: [], ...o
});

/* 'green' — everything answers.
   'tunnel' — WireGuard is up on this laptop but the VPS does not answer, so
              the public address gets the proxy's "shop_unreachable".
   'cert'   — the router handed the laptop a new address the certificate does
              not name. */
export function board(kind, { now = NOW } = {}) {
  const ok = { ok: true, ms: 3 };
  const lan = { address: kind === 'cert' ? '10.10.99.14' : '10.10.99.9', shop: true, covered: kind !== 'cert' };
  return [
    L.serverLight({ server: 'running', http: ok, https: ok, httpsExpected: true }),
    L.wifiLight({ lan, secure: true, certExists: true }),
    L.tunnelLight({ peer: '10.8.0.1', configured: true, localAddr: '10.8.0.2', localUp: true,
      reply: kind === 'tunnel' ? { ok: false, ms: null } : { ok: true, ms: 41 } }),
    L.cloudLight(liveMirror({ lastOkAt: iso(now - 10000), lastPushAt: iso(now - 3 * MIN) }), { running: true, now }),
    L.publicLight({ url: 'https://shop.ogsports1.com', shopUp: true,
      res: kind === 'tunnel' ? { status: 503, ok: false, code: 'shop_unreachable' } : { status: 200, ok: true, ms: 180 } })
  ];
}
