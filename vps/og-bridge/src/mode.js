/* ==========================================================================
   Which world is the shop in — a PURE decision, nothing here does I/O.
   --------------------------------------------------------------------------
   Two witnesses, and they can disagree:

     THE ROAD   — does the till answer /api/vps/health over the tunnel?
     THE MIRROR — how long ago did the till's worker last beat into Supabase
                  (erp.till_status(), the `shop` row of sync_state)?

   live     the till answers, and it is the database that owns the mirror.
            The live shop is the truth; the snapshot sends people to it.
   split    the till does not answer here, but it beat recently: the shop's
            internet is up and the TUNNEL is what is down (WireGuard, the
            VPS firewall). The shop is working; only the front door is shut.
   mirror   neither: the till is silent and so is the mirror. The shop's
            internet (or the laptop) is down. The snapshot is exact up to the
            last beat and blind after it — which is exactly what it says.
   unknown  a witness contradicts itself: the machine answering on the tunnel
            is NOT the mirror's owner (a dev copy wired up by mistake), the
            mirror cannot be read and the till is silent, or the mirror has
            never been beaten into. Nothing is claimed.
   ========================================================================== */

export const MODES = ['live', 'split', 'mirror', 'unknown'];

/* till:   { ok: boolean, lineage: string|null }
   status: { ok: boolean, lineageId: string|null, beatAt: string|Date|null }
   now:    ms since the epoch */
export function decideMode({ till, status, now, staleMs = 10 * 60 * 1000 }) {
  const beat = status && status.ok && status.beatAt ? new Date(status.beatAt).getTime() : null;
  const ageMs = beat !== null && Number.isFinite(beat) ? Math.max(0, now - beat) : null;
  const base = { beatAt: beat !== null ? new Date(beat).toISOString() : null, ageMs };

  if (till && till.ok) {
    if (status && status.ok && status.lineageId && till.lineage && till.lineage !== status.lineageId) {
      return { mode: 'unknown', reason: 'lineage_mismatch', ...base };
    }
    return { mode: 'live', reason: 'till_answers', ...base };
  }
  if (!status || !status.ok) return { mode: 'unknown', reason: 'mirror_unreadable', ...base };
  if (ageMs === null) return { mode: 'unknown', reason: 'never_beaten', ...base };
  if (ageMs < staleMs) return { mode: 'split', reason: 'tunnel_down_shop_online', ...base };
  return { mode: 'mirror', reason: 'shop_offline', ...base };
}
