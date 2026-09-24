/* ==========================================================================
   OG SYSTEM — what the website's checkout shows, read back from the cloud
   --------------------------------------------------------------------------
   The owner changes a payment method in Settings; the website (Ahmad's, on
   the same Supabase) offers what public.web_checkout answers. Between the two
   sit the mirror (config is pushed whole, within seconds of the Save), the
   031 SQL (which must have been run), and the website key (whose SHA-256 the
   cloud holds). Any one of them can quietly stop the change arriving, and
   "I changed it and the website did not" is the report nobody can act on.

   So the laptop asks the cloud the SAME question the website asks — the same
   function, with the same key — and compares the answer with what this
   database says it should be:

     expected()  what the website SHOULD offer, from this database. The JS
                 twin of web.transfer_methods() in 031 (through Orders.onWeb).
     cloud()     what it DOES offer, or the reason nobody can tell: no
                 Supabase, no website key, a key the cloud does not know, the
                 SQL not run, no internet.
     report()    both, compared, with the mirror's own state — optionally
                 after pushing first, which is what Save asks for.

   Read-only in the cloud: web_checkout is `stable` and writes nothing.
   ========================================================================== */

import { get, nowIso } from './db.js';
import { maybe } from './env.js';
import * as SB from './supabase.js';
import * as Orders from './orders.js';
import * as SyncWorker from './sync-worker.js';

const HEX = /^#[0-9a-f]{6}$/;
const trimOrNull = (v) => { const s = String(v == null ? '' : v).trim(); return s || null; };

/* What the website should offer, from this database. */
export function expected(d = get()) {
  const s = Orders.settings(d);
  const transfer = s.methods
    .filter((m) => Orders.onWeb(m, s.accounts))
    .map((m) => {
      const a = (s.accounts && s.accounts[m.id]) || {};
      return {
        id: m.id,
        en: m.en,
        ar: m.ar,
        color: typeof m.color === 'string' && HEX.test(m.color) ? m.color : null,
        details: { en: trimOrNull(a.en), ar: trimOrNull(a.ar) }
      };
    });
  return { transfer, cod: s.webCod !== false };
}

/* What the cloud answers the website right now, or why it cannot be asked. */
export async function cloud() {
  if (!SB.isConfigured()) return { reason: 'not_configured' };
  const key = maybe('OG_WEB_API_KEY');
  if (!key) return { reason: 'no_key' };
  try {
    const body = await SB.rpc('web_checkout', { p_key: key }, { timeoutMs: CLOUD_MS });
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { reason: 'unreadable' };
    if (body.ok === false) return { reason: body.code === 'bad_key' ? 'bad_key' : 'refused', code: body.code || null };
    /* 030 answers without these, and does not know the owner's switch. */
    if (!('version' in body) || !('cod' in body)) return { reason: 'old_sql' };
    return { reason: null, view: body };
  } catch (e) {
    const m = String((e && e.message) || e);
    /* No such function: 030 was never run on this project. */
    if (/PGRST202|Could not find the function/i.test(m)) return { reason: 'not_installed' };
    /* 030 is there but 031 is not: the laptop's key was only granted the
       checkout by 031. */
    if (/permission denied|42501/i.test(m)) return { reason: 'old_sql' };
    if (/^Cannot reach Supabase/.test(m)) return { reason: 'unreachable' };
    return { reason: 'error', message: m.slice(0, 240) };
  }
}

/* Every way the two can differ, each a kind and a method id — the browser
   writes the words. Order counts: the website lists them as the owner does. */
export function compare(exp, view) {
  const diffs = [];
  const got = Array.isArray(view && view.transfer) ? view.transfer : [];
  const byId = new Map(got.map((m) => [m && m.id, m]));
  const want = new Set(exp.transfer.map((m) => m.id));
  for (const m of exp.transfer) {
    const c = byId.get(m.id);
    if (!c) { diffs.push({ kind: 'missing', id: m.id }); continue; }
    const cd = c.details || {};
    if (trimOrNull(cd.en) !== m.details.en || trimOrNull(cd.ar) !== m.details.ar) diffs.push({ kind: 'details', id: m.id });
    if ((c.en || '') !== (m.en || '') || (c.ar || '') !== (m.ar || '')) diffs.push({ kind: 'names', id: m.id });
    if ((c.color || null) !== m.color) diffs.push({ kind: 'color', id: m.id });
  }
  for (const c of got) if (c && !want.has(c.id)) diffs.push({ kind: 'extra', id: c.id });
  if (!diffs.length) {
    const a = exp.transfer.map((m) => m.id).join(',');
    const b = got.map((m) => m && m.id).join(',');
    if (a !== b) diffs.push({ kind: 'order', id: null });
  }
  if (!!(view && view.cod) !== exp.cod) diffs.push({ kind: 'cod', id: null });
  return { inStep: diffs.length === 0, diffs };
}

/* The mirror, in the one word that explains why a change has not arrived. */
export function mirror() {
  const st = SyncWorker.status();
  const deniedConfig = Array.isArray(st.denied) && st.denied.some((x) => x && x.table === 'config');
  const mode = !st.configured ? 'not_configured' : deniedConfig ? 'denied' : st.mode;
  return { mode, lastOkAt: st.lastOkAt || null, lastPushAt: st.lastPushAt || null, running: !!st.running };
}

const pause = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

/* THE BROWSER GIVES UP AT 15 s (js/api.js), and a slow line must come back
   as a reason the owner can read — "no internet" — never as a request that
   timed out with no answer. So the whole report fits a budget: at most 2 s
   waiting for a push already running, 5 s for our own push (it goes on in
   the background if it is slower; the mirror retries by itself), 6 s for the
   cloud's answer. */
const WAIT_MS = 2000;
const PUSH_MS = 5000;
const CLOUD_MS = 6000;

/* The whole answer. `push` sends what is waiting first — the fast lane the
   topbar's Sync button uses — so the check straight after a Save reads the
   cloud AFTER the change is in it, not before. A push already running is
   waited for briefly (it is almost always the one the Save's own commit
   started, and carries the change). */
export async function report({ push = false } = {}) {
  let pushed = null;
  if (push) {
    const until = Date.now() + WAIT_MS;
    while (SyncWorker.status().running && Date.now() < until) await pause(200);
    const r = await Promise.race([
      SyncWorker.runNow().catch((e) => ({ ok: false, reason: 'failed', message: String(e && e.message) })),
      pause(PUSH_MS).then(() => ({ ok: false, reason: 'slow' }))
    ]);
    pushed = { ok: !!r.ok, reason: r.reason || null };
  }
  const exp = expected();
  const c = await cloud();
  const cmp = c.view ? compare(exp, c.view) : { inStep: false, diffs: [] };
  return {
    expected: exp,
    cloud: c.view ? {
      transfer: Array.isArray(c.view.transfer) ? c.view.transfer : [],
      cod: !!c.view.cod,
      codAllowed: Array.isArray(c.view.codAllowed) ? c.view.codAllowed : [],
      version: c.view.version || null,
      updatedAt: c.view.updatedAt || null
    } : null,
    reason: c.reason,
    message: c.message || null,
    inStep: cmp.inStep,
    diffs: cmp.diffs,
    mirror: mirror(),
    pushed,
    checkedAt: nowIso()
  };
}
