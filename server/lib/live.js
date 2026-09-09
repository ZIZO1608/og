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

let clients = new Set();     // { res, side, userId, name, since }
let timer = null;
let sent = 0;

export function subscribe(res, side, userId = null, name = null) {
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

  const c = { res, side, userId, name, since: Date.now() };
  clients.add(c);
  res.write(`event: hello\ndata: ${JSON.stringify({ side, presence: presence() })}\n\n`);
  /* Everyone else learns somebody arrived — "Yalla Wear is online" is worth
     a line on the shop's screen — and the same when they leave. */
  notify('all', { presence: presence(), who: side });
  const drop = () => {
    if (!clients.delete(c)) return;
    notify('all', { presence: presence(), who: side });
  };
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

/* Who is on the line right now — PEOPLE, not tabs.

   Yalla Wear is two partners, so "Yalla Wear · online" was the wrong
   sentence: the shop wants to know whether it is Zaven or Zohrab reading
   this. Each side carries the names, deduplicated by account, because one
   person with the portal open on a phone and a laptop is one person online
   and counting the tabs said two. The tab count is kept beside it for
   /api/live's own status line, where "how many streams are open" is the
   actual question.

   An account with no id (there is no such caller today) counts as its own
   anonymous person rather than collapsing every one of them into one. */
export function presence() {
  const people = { og: [], yalla: [] };
  const tabs = { og: 0, yalla: 0 };
  const seen = { og: new Set(), yalla: new Set() };

  for (const c of clients) {
    const side = c.side === 'yalla' ? 'yalla' : 'og';
    tabs[side]++;
    const key = c.userId == null ? 'anon:' + [...seen[side]].length : String(c.userId);
    if (seen[side].has(key)) continue;
    seen[side].add(key);
    people[side].push({ id: c.userId, name: c.name || null });
  }

  return { og: people.og.length, yalla: people.yalla.length, people, tabs };
}

/* `sides` — 'og', 'yalla', or 'all'. The payload is a hint only; presence
   rides on every event so a tab always knows who else is there. */
export function notify(sides = 'all', payload = {}) {
  const body = `event: change\ndata: ${JSON.stringify({ at: new Date().toISOString(), presence: presence(), ...payload })}\n\n`;
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
