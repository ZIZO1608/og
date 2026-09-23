/* ==========================================================================
   ROAD-WATCH — looks at the road to the till, keeps the mode, and says
   "collect now" the moment the road comes back.
   --------------------------------------------------------------------------
   Every probeMs it asks the till /api/vps/health; every statusMs it re-reads
   erp.till_status() from the mirror. Both answers go through decideMode()
   (mode.js), and nothing else in og-bridge decides what state the shop is in.

   WHEN THE ROAD COMES BACK (any mode → live) it POSTs /api/vps/collect once:
   reviews and "Notify me" taps customers left on og-track while the laptop
   could not be reached are applied now rather than on the till's next minute.
   The till's own inboxBusy flag makes that single-flight with its timer.

   The witnesses are injected, so the test drives this with stubs and a fake
   clock: nothing here opens a socket by itself.
   ========================================================================== */
import { decideMode } from './mode.js';

export function roadWatch({ till, mirror, staleMs, probeMs = 15000, statusMs = 60000, now = () => Date.now(), log = () => {} }) {
  const state = {
    mode: 'unknown', reason: 'starting', since: new Date(now()).toISOString(),
    beatAt: null, ageMs: null, till: { ok: false, lineage: null }, status: null,
    statusAt: 0, collects: 0, lastCollect: null
  };
  let timer = null;
  let busy = false;

  async function tick() {
    if (busy) return state;
    busy = true;
    try {
      const t = await till.health();
      state.till = { ok: !!t.ok, lineage: t.lineage || null, error: t.ok ? null : t.error };
      if (!state.status || now() - state.statusAt >= statusMs) {
        state.status = await mirror.tillStatus().catch((e) => ({ ok: false, error: e.message }));
        state.statusAt = now();
      }
      const d = decideMode({ till: state.till, status: state.status, now: now(), staleMs });
      const was = state.mode;
      state.beatAt = d.beatAt;
      state.ageMs = d.ageMs;
      state.reason = d.reason;
      if (d.mode !== was) {
        state.mode = d.mode;
        state.since = new Date(now()).toISOString();
        log(`[road] ${was} → ${d.mode} (${d.reason})`);
        if (d.mode === 'live' && was !== 'live') {
          const c = await till.collect();
          state.collects++;
          state.lastCollect = { at: new Date(now()).toISOString(), ok: !!c.ok, result: c.collect || c.error || null };
        }
      }
      return state;
    } finally {
      busy = false;
    }
  }

  return {
    state,
    tick,
    start() {
      if (timer) return;
      tick().catch((e) => log('[road] ' + e.message));
      timer = setInterval(() => tick().catch((e) => log('[road] ' + e.message)), probeMs);
      if (timer.unref) timer.unref();
    },
    stop() { if (timer) clearInterval(timer); timer = null; }
  };
}
