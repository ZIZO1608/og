/* ==========================================================================
   OG SYSTEM — the live channel                                      [live.js]
   --------------------------------------------------------------------------
   Server-sent events, so a change on one side reaches the other side's
   screen the moment it lands rather than on the next poll. One long GET per
   open tab; the server writes a one-line event whenever anything on the
   Yalla Wear line moves, and the browser's Pulse refetches what changed.

   Deliberately dumb: the event carries no data, only "something moved for
   your side". The tab then asks the real routes, which apply the real
   permission gates — a push that carried the row would be a second door
   past scrubCost and the partner strip list.

   Zero dependencies: it is a Node http response that never ends, with a
   heartbeat so a proxy or a phone's radio does not decide it is dead.
   ========================================================================== */

const HEARTBEAT_MS = 25 * 1000;

let clients = new Set();     // { res, side, userId, since }
let timer = null;
let sent = 0;

export function subscribe(res, side, userId = null) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff'
  });
  /* Tell the browser to reconnect quickly if the line drops, then say hello
     so the first byte arrives and the client knows it is on. */
  res.write('retry: 3000\n\n');
  res.write(`event: hello\ndata: {"side":"${side}"}\n\n`);

  const c = { res, side, userId, since: Date.now() };
  clients.add(c);
  const drop = () => { clients.delete(c); };
  res.on('close', drop);
  res.on('error', drop);

  if (!timer) {
    timer = setInterval(() => {
      for (const k of clients) {
        try { k.res.write(': ping\n\n'); } catch { clients.delete(k); }
      }
    }, HEARTBEAT_MS);
    timer.unref();
  }
}

/* `sides` — 'og', 'yalla', or 'all'. The payload is a hint only. */
export function notify(sides = 'all', payload = {}) {
  const body = `event: change\ndata: ${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n\n`;
  for (const c of clients) {
    if (sides !== 'all' && c.side !== sides) continue;
    try { c.res.write(body); sent++; } catch { clients.delete(c); }
  }
}

export function status() {
  const bySide = { og: 0, yalla: 0 };
  for (const c of clients) bySide[c.side] = (bySide[c.side] || 0) + 1;
  return { open: clients.size, bySide, sent };
}
