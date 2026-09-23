/* The road to the till: /api/vps/ over the WireGuard tunnel, https, with the
   till's own certificate as the ONLY trusted one. Node checks an IP address
   against the certificate's IP names (unlike nginx), so OG_TILL_URL may be
   https://10.8.0.2:8443 as long as the certificate names 10.8.0.2 —
   `npm run cert` with OG_TUNNEL_ADDR set does.

   NEVER sends X-OG-Client-IP or X-Forwarded-For: the till answers 404 to a
   request that looks like it came through the public door. */
import { request } from 'node:https';
import { readFileSync } from 'node:fs';

export function makeTill({ url, caFile, key, timeoutMs = 4000, requestImpl = request }) {
  let ca = null;
  const loadCa = () => {
    if (ca) return ca;
    try { ca = readFileSync(caFile); } catch { ca = null; }
    return ca;
  };

  function call(method, path) {
    return new Promise((resolve) => {
      const trust = loadCa();
      if (!trust) return resolve({ ok: false, error: 'no_certificate' });
      if (!key) return resolve({ ok: false, error: 'no_key' });
      let u;
      try { u = new URL(path, url); } catch { return resolve({ ok: false, error: 'bad_url' }); }
      const req = requestImpl({
        method, hostname: u.hostname, port: u.port || 443, path: u.pathname,
        ca: trust, rejectUnauthorized: true,
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
        timeout: timeoutMs
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch { /* not json */ }
          if (res.statusCode !== 200 || !json || json.ok !== true) {
            return resolve({ ok: false, error: 'status_' + res.statusCode, json });
          }
          resolve({ ok: true, json });
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
      req.end();
    });
  }

  return {
    async health() {
      const r = await call('GET', '/api/vps/health');
      return r.ok ? { ok: true, lineage: r.json.lineage || null, build: r.json.build || null }
                  : { ok: false, lineage: null, error: r.error };
    },
    async collect() {
      const r = await call('POST', '/api/vps/collect');
      return r.ok ? { ok: true, collect: r.json.collect } : { ok: false, error: r.error };
    }
  };
}
