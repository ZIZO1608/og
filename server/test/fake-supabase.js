/* A stand-in for Supabase, for test/sync-safety.test.js only (not a test
   itself: npm test runs test/*.test.js). Answers PostgREST GET / POST / PATCH
   / DELETE on in-memory tables, the API root, and Storage uploads, and
   records every request's method, path and the two key headers.

   It refuses the way Supabase does: a new-format key (sb_secret_…) sent as
   "Authorization: Bearer" as well is 401 — that header must carry a JWT. */
import { createServer } from 'node:http';

export async function startFake() {
  const tables = new Map();       /* name -> array of rows */
  const seen = [];
  const rows = (t) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t); };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const apikey = req.headers.apikey || null;
      const auth = req.headers.authorization || null;
      seen.push({ method: req.method, path: u.pathname, apikey, auth });
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(obj === undefined ? '' : JSON.stringify(obj));
      };
      if (!apikey) return send(401, { message: 'No API key found in request' });
      if (/^sb_/.test(apikey) && auth) return send(401, { message: 'Invalid JWT' });

      if (u.pathname.startsWith('/storage/v1/')) return send(200, { Key: u.pathname });
      if (u.pathname === '/rest/v1/' || u.pathname === '/rest/v1') return send(200, { definitions: {} });

      const t = decodeURIComponent(u.pathname.replace('/rest/v1/', ''));
      const eq = [...u.searchParams].filter(([k, v]) => !['select', 'order', 'limit', 'offset'].includes(k) && v.startsWith('eq.'))
        .map(([k, v]) => [k, v.slice(3)]);
      const inn = [...u.searchParams].filter(([k, v]) => !['select', 'order', 'limit', 'offset'].includes(k) && v.startsWith('in.('))
        .map(([k, v]) => [k, v.slice(4, -1).split(',')]);
      const match = (r) => eq.every(([k, v]) => String(r[k]) === v) && inn.every(([k, vs]) => vs.includes(String(r[k])));
      if (req.method === 'GET') {
        const off = Number(u.searchParams.get('offset') || 0);
        const lim = Number(u.searchParams.get('limit') || 1e9);
        return send(200, rows(t).filter(match).slice(off, off + lim));
      }
      if (req.method === 'POST') {
        const list = JSON.parse(body || '[]');
        for (const r of (Array.isArray(list) ? list : [list])) {
          const i = rows(t).findIndex((x) => x.id !== undefined && String(x.id) === String(r.id));
          if (i >= 0) rows(t)[i] = { ...rows(t)[i], ...r }; else rows(t).push(r);
        }
        return send(201, []);
      }
      if (req.method === 'PATCH') {
        const patch = JSON.parse(body || '{}');
        const hit = rows(t).filter(match);
        for (const r of hit) Object.assign(r, patch);
        return send(200, hit);
      }
      if (req.method === 'DELETE') {
        const gone = rows(t).filter(match);
        tables.set(t, rows(t).filter((r) => !match(r)));
        return send(200, gone);
      }
      send(405, { message: 'no' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, tables, rows, seen, close: () => new Promise((r) => server.close(r)) };
}
