/* ==========================================================================
   OG SYSTEM — the line back to the control panel
   --------------------------------------------------------------------------
   `OG System.exe` runs this server as a child process with an IPC channel
   open, and this is the whole of that conversation. When the server was
   started any other way — `npm start`, a terminal, a scheduled task — there
   is no channel, every call here is a no-op, and nothing behaves differently.
   That is the point: the panel is a convenience, never a dependency.

   Why a channel at all, when the server already has an HTTP API:

   - STOPPING. Windows has no SIGINT to send a child. `child.kill()` there is
     TerminateProcess — uncatchable, so the shutdown handler below never runs,
     the listeners never close and DB.close() never happens. A message the
     server chooses to act on is the only graceful stop this platform has.
   - ASKING WITHOUT SIGNING IN. GET /api/sync/status is gated on config.write,
     rightly — it is the shop's data. But the panel is not a browser on the
     network, it is the process that STARTED this one, and making somebody log
     into their own launcher to see whether the mirror is stuck is a worse
     answer than a pipe that no network can reach.
   - IT IS NOT A DOOR. There is no port here, no origin, no cookie. A message
     can only arrive from the parent that spawned this process, so this adds
     no attack surface to a server that may be on a shop wifi.
   ========================================================================== */

/* Captured once. `process.send` exists only when the parent asked for an
   'ipc' entry in stdio, so this doubles as "am I under the panel". */
const up = typeof process.send === 'function' ? process.send.bind(process) : null;

export function attached() { return !!up; }

/* Never throws and never reports. A panel that has been closed mid-sentence
   is an EPIPE on the next write, and a shop must not fall over because its
   launcher window went away. */
export function tell(type, data = {}) {
  if (!up) return false;
  try { up({ type, ...data }); return true; } catch { return false; }
}

/* One handler for the whole conversation, called as (type, message). */
export function onAsk(handler) {
  if (!up) return;
  process.on('message', (m) => {
    if (!m || typeof m !== 'object' || !m.type) return;
    try { handler(m.type, m); } catch (e) { tell('log', { line: 'panel: ' + e.message }); }
  });
}
