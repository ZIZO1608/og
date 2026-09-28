/* ==========================================================================
   Telling the website the catalogue changed (contract v1.5, 29 Sep 2026)
   --------------------------------------------------------------------------
   The OG Sports website keeps its own copy of the products and refreshes it
   every five minutes, so a product the owner had just added could take that
   long to appear. The website asked for a nudge instead:

     POST <web.site_url>/api/og/catalog-changed
     Authorization: Bearer <OG_WEB_API_KEY>
     { "reason": "product_saved", "productIds": [57] }

   and fetches the whole list again on its next page. The body is for its
   logs only.

   WHAT COUNTS AS A CHANGE is decided by the answer the website reads, not by
   which table was written. Every commit touching the catalogue's tables
   (WATCH) re-arms a five-second quiet timer; when it fires, the published
   catalogue (Cat.webList — the same rows web_products serves from the cloud)
   is fingerprinted, and the website is told only when that fingerprint moved.
   So a sale that leaves a size in stock says nothing, the sale that sells the
   last pair says so, and a new rate — which moves every lira price — does.
   Several saves in a row are one call.

   IT WAITS FOR THE CLOUD COPY. The website reads web_products from Supabase
   (037/040), which the mirror's fast lane fills a couple of seconds after a
   commit. A call that beat the push would send the website to fetch what it
   already had, so the call waits — at most a minute — until no watched table
   has rows the mirror has not got. A mirror that is off, refused or offline
   will not catch up by waiting, and the call goes at once.

   A FAILED CALL IS TRIED AGAIN a few times over the next minutes (30 s,
   2 min, 5 min), then left: the website's own five-minute refresh catches
   up anyway. A newer change starts a fresh round. 401/403 (wrong key), 404
   (the website has not built the door yet) and a redirect are not retried —
   waiting will not change them — and a redirect is never followed, because
   it would carry the key somewhere nobody chose. Nothing here can hold up a
   save: it runs after the commit, off the request, and every error is kept
   for the Settings card and one log line.

   ONE MAIN SERVER RUNS IT (started beside the reminders in index.js). A
   standby copy runs none of the workers, and a copy that told the website
   about its own copy would be telling it about a shop that is not the shop.
   ========================================================================== */

import { createHash } from 'node:crypto';
import * as DB from './db.js';
import * as Cat from './catalogue.js';
import * as SyncWorker from './sync-worker.js';
import * as Mirror from './mirror.js';
import { maybe } from './env.js';
import { siteUrlProblem } from './config-writable.js';

export const PATH = '/api/og/catalog-changed';

/* The tables the published catalogue is made of. categories and the photos'
   derived columns ride on these; config does not affect the answer. */
const WATCH = new Set(['products', 'variants', 'stock', 'product_colours', 'product_photos', 'categories', 'fx_rates']);

const QUIET_MS = 5 * 1000;            // "one call about 5 seconds after the last change"
const RETRY_MS = [30 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];
const CLOUD_WAIT_MS = 60 * 1000;
const CLOUD_POLL_MS = 1000;
const BASELINE_MS = 10 * 1000;
const TIMEOUT_MS = 10 * 1000;
const MAX_IDS = 100;

let log = () => {};
let started = false;
let unhook = null;
let timer = null;
let baseTimer = null;
let running = null;
let again = false;
/* What the website was last told about — or, before the first call, what the
   catalogue was when this server started, which is what the website's own
   refresh will have fetched. null until either is known. */
let told = null;

const state = {
  lastTryAt: null,
  lastOkAt: null,
  lastStatus: null,
  lastError: null,
  lastReason: null,
  lastIds: 0,
  refreshedAt: null,
  attempts: 0,
  nextTryAt: null,
  gaveUpAt: null,
  cloud: null,
  sent: 0,
  lastCheckAt: null
};

/* ------------------------------------------------------------ settings */

function cfg(key) {
  try {
    const r = DB.get().prepare('SELECT value FROM config WHERE key = ?').get(key);
    return r ? r.value : null;
  } catch { return null; }
}

/* The website's address, or null when there is none or it would not do. */
export function site() {
  const v = String(cfg('web.site_url') || '').trim();
  if (!v || siteUrlProblem(v)) return null;
  return v.replace(/\/$/, '');
}

function key() { return maybe('OG_WEB_API_KEY') || null; }

export function configured() { return !!(site() && key()); }

/* --------------------------------------------------------- the answer */

const hash = (s) => createHash('sha1').update(s).digest('hex');

/* One fingerprint per published product, and one for the rate. A product's
   own price moves its hash; the rate moves every lira price at once and is
   kept apart, so the call can say which it was. */
export function snapshot() {
  const rows = new Map();
  for (const p of Cat.webList()) {
    const { rate: _rate, prices: _prices, ...rest } = p;
    rows.set(p.id, hash(JSON.stringify(rest)));
  }
  const rateSig = JSON.stringify(Cat.webRate());
  const all = [...rows].map(([id, h]) => id + ':' + h).join(',');
  return { rows, rateSig, sig: hash(rateSig + '|' + all) };
}

/* Which products moved, and a word for why — for the website's log. */
export function diff(prev, next) {
  if (!prev) return { reason: 'catalog_changed', productIds: [] };
  const ids = [];
  for (const [id, h] of next.rows) if (prev.rows.get(id) !== h) ids.push(id);
  for (const id of prev.rows.keys()) if (!next.rows.has(id)) ids.push(id);
  const rateMoved = prev.rateSig !== next.rateSig;
  return {
    reason: ids.length ? 'product_saved' : rateMoved ? 'rate_changed' : 'catalog_changed',
    productIds: ids.slice(0, MAX_IDS)
  };
}

/* ---------------------------------------------------------- the cloud */

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

/* 'ok' once no watched table is waiting for the mirror; the mirror's own
   mode when it is not live (waiting would not help); 'timeout' after a
   minute — a table the cloud refuses stays waiting for good, and the website
   is better told late than never. */
async function cloudCaughtUp(limitMs = CLOUD_WAIT_MS) {
  const until = Date.now() + limitMs;
  for (;;) {
    let s;
    try { s = SyncWorker.status(); } catch { return 'unknown'; }
    if (s.mode !== 'live') return 'mirror_' + s.mode;
    let waiting = null;
    try { waiting = Mirror.changedTables(); } catch { waiting = null; }
    const busy = s.running || (waiting && waiting.some((t) => WATCH.has(t)));
    if (!busy) return 'ok';
    if (Date.now() >= until) return 'timeout';
    await sleep(CLOUD_POLL_MS);
  }
}

/* ------------------------------------------------------------ the call */

export async function post(base, secret, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(base + PATH, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json', 'user-agent': 'OG-System' },
      body: JSON.stringify(body),
      signal: ctl.signal,
      redirect: 'manual'
    });
    let j = null;
    try { j = await res.json(); } catch { /* not JSON — the status says enough */ }
    const status = res.status;
    if (status >= 200 && status < 300) return { ok: true, status, refreshedAt: (j && j.refreshedAt) || null };
    if (status === 401 || status === 403) return { ok: false, status, code: 'bad_key', retry: false };
    if (status === 404) return { ok: false, status, code: 'not_found', retry: false };
    if (status >= 300 && status < 400) return { ok: false, status, code: 'redirect', retry: false };
    if (status === 429 || status >= 500) return { ok: false, status, code: 'site_error', retry: true };
    return { ok: false, status, code: 'refused', retry: false };
  } catch (e) {
    return { ok: false, status: null, code: e && e.name === 'AbortError' ? 'timeout' : 'unreachable', retry: true };
  } finally {
    clearTimeout(t);
  }
}

/* --------------------------------------------------------- the round */

function arm(ms) {
  if (timer) clearTimeout(timer);
  state.nextTryAt = new Date(Date.now() + ms).toISOString();
  timer = setTimeout(() => { timer = null; state.nextTryAt = null; run(); }, ms);
  if (timer.unref) timer.unref();
}

/* One at a time: a change arriving while a call is out is looked at once it
   is back, from a fresh fingerprint. */
function run(opts = {}) {
  if (running) { if (!opts.force) again = true; return running; }
  running = (async () => {
    try { return await attempt(opts); }
    catch (e) {
      state.lastError = 'failed';
      log('  [website] could not tell the website: ' + (e && e.message));
      return { ok: false, code: 'failed' };
    } finally {
      running = null;
      if (again) { again = false; arm(QUIET_MS); }
    }
  })();
  return running;
}

async function attempt({ force = false, reason = null, cloudWaitMs = CLOUD_WAIT_MS } = {}) {
  const base = site();
  const secret = key();
  if (!base || !secret) {
    state.lastError = !secret ? 'no_key' : 'no_site';
    return { ok: false, code: state.lastError };
  }
  const next = snapshot();
  state.lastCheckAt = new Date().toISOString();
  if (!force && told && next.sig === told.sig) return { ok: true, unchanged: true };

  const d = diff(told, next);
  state.cloud = force ? null : await cloudCaughtUp(cloudWaitMs);
  const body = { reason: reason || d.reason, productIds: d.productIds };

  const r = await post(base, secret, body);
  state.lastTryAt = new Date().toISOString();
  state.lastStatus = r.status;
  state.lastReason = body.reason;
  state.lastIds = body.productIds.length;
  if (r.ok) {
    told = next;
    state.lastOkAt = state.lastTryAt;
    state.lastError = null;
    state.attempts = 0;
    state.gaveUpAt = null;
    state.refreshedAt = r.refreshedAt;
    state.sent++;
    log(`  [website] told the website the catalogue changed (${body.reason}` +
        (body.productIds.length ? `, ${body.productIds.length} product(s)` : '') + ')');
    return { ...r, reason: body.reason, productIds: body.productIds };
  }

  state.lastError = r.code;
  if (!force && r.retry && state.attempts < RETRY_MS.length) {
    const wait = RETRY_MS[state.attempts];
    state.attempts++;
    arm(wait);
    log(`  [website] the website did not take the news (${r.code}${r.status ? ' ' + r.status : ''}) — trying again in ${Math.round(wait / 1000)} s`);
  } else if (!force && r.retry) {
    state.gaveUpAt = state.lastTryAt;
    log('  [website] gave up telling the website this time — its own 5-minute refresh will catch up');
  } else if (!force) {
    log(`  [website] the website refused the news (${r.code}${r.status ? ' ' + r.status : ''}) — not retried`);
  }
  return r;
}

/* ------------------------------------------------------------- public */

/* A change landed: tell the website once things are quiet. Resets the round
   of retries — a newer change is a new piece of news. */
export function soon(ms = QUIET_MS) {
  if (!started) return;
  state.attempts = 0;
  state.gaveUpAt = null;
  arm(ms);
}

/* "Tell the website now" in Settings: sent whatever the fingerprint says,
   without waiting for the cloud, and never retried by itself — the person
   pressing it is reading the answer. */
export function sendNow() {
  return run({ force: true, reason: 'test' });
}

/* For a test: one round as the timer would run it, with a short cloud wait. */
export function _runOnce(opts = {}) { return run(opts); }
export function _reset() {
  if (timer) { clearTimeout(timer); timer = null; }
  told = null; running = null; again = false;
  Object.assign(state, { lastTryAt: null, lastOkAt: null, lastStatus: null, lastError: null, lastReason: null,
    lastIds: 0, refreshedAt: null, attempts: 0, nextTryAt: null, gaveUpAt: null, cloud: null, sent: 0, lastCheckAt: null });
}
export function _told() { return told; }

export function start(logger = console.log) {
  if (started) return;
  started = true;
  log = logger;
  unhook = DB.onCommit((tables) => {
    if (tables.some((t) => WATCH.has(t))) soon();
  });
  /* What the website will have fetched by itself: the catalogue as this
     server found it. Without it the first change after every restart would
     be announced whatever it was. */
  baseTimer = setTimeout(() => {
    baseTimer = null;
    try { if (!told) told = snapshot(); } catch { /* the first change will say so */ }
  }, BASELINE_MS);
  if (baseTimer.unref) baseTimer.unref();
}

export function stop() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (baseTimer) { clearTimeout(baseTimer); baseTimer = null; }
  if (unhook) { unhook(); unhook = null; }
  started = false;
}

export function status() {
  const raw = String(cfg('web.site_url') || '').trim();
  return {
    started,
    site: raw || null,
    siteProblem: raw ? siteUrlProblem(raw) : null,
    keySet: !!key(),
    configured: configured(),
    pending: !!timer,
    running: !!running,
    ...state
  };
}
