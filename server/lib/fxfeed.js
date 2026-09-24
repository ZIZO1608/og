/* ==========================================================================
   OG SYSTEM — the exchange-rate feed                              [fxfeed.js]
   --------------------------------------------------------------------------
   The dollar rate used to be a number somebody typed into Settings when they
   remembered. This asks a live feed (the Supabase edge function in OG_FX_URL,
   keyed by OG_FX_KEY) on a timer and writes the shop's rate from it, so every
   dollar price at the till, on the receipt and on the WEBSITE moves with the
   market without anybody remembering.

   ONE WAY THE RATE IS SET, STILL. A rate from the feed is `Cat.setRate` — a
   new `fx_rates` row, logged, mirrored on the fast lane a couple of seconds
   later — exactly what the Settings box writes. The website's checkout
   (`web_checkout`, server/supabase/030) reads the newest `fx_rates` row from
   the mirror, so it follows within seconds of the laptop, and its `version`
   moves so an open checkout redraws. There is no second path to the website:
   the feed's key stays in server/.env and never reaches a browser or the
   cloud.

   WHAT THE FEED SAYS, AND WHAT THE SHOP HEARS.

     - The feed answers in OLD lira (13,750 to the dollar on 24 Sep 2026);
       the shop has been on the redenominated lira since migration 005 (135).
       `fx.feed_scale` (100) is the divisor. It is a setting rather than a
       constant because the day the feed switches scale is not a day the
       server should reprice every dollar shoe a hundredfold.
     - It gives two numbers. `buy` is what the exchanger pays for a dollar,
       `sell` what it charges for one. The shop takes lira for dollar-priced
       goods and buys dollars with them, so `sell` — what the shop actually
       pays — is the default (`fx.feed_side`); `buy` and `mid` are the owner's
       to choose.
     - Whole lira: SYP has no minor unit, and the rate the owner has always
       typed is a whole number.

   THE FEED IS NEVER TRUSTED BLINDLY. A row is written only when the rounded
   rate differs from the shop's (an idle market writes nothing), and a jump
   past `fx.feed_max_jump_pct` (20 %) of the current rate is HELD, not
   applied: a feed glitch answering 1,375 for 13,750 would otherwise reprice
   the shop tenfold at four in the morning. A held rate is shown in Settings
   with "Use it anyway", which is a person's decision and goes through
   `check({ force: true })` with that person's id on the row.

   `fx.feed_on` = '0' watches without writing: the card still shows what the
   feed says and offers the button. Default on the moment a key is set,
   because that is what the owner asked for.

   `fx.feed_last` (JSON, written by this file only, never by PUT /api/config)
   remembers the last rate the feed set — it is in `config`, which is
   mirrored whole, so a laptop that takes the shop knows too.

   THE TILL NEVER WAITS FOR THIS. One fetch at a time, ten-second deadline,
   every failure caught and remembered as a code for the card; a feed still
   "loading" (its own first minute) is asked again in a minute rather than
   being read as broken.
   ========================================================================== */

import * as DB from './db.js';
import * as Cat from './catalogue.js';
import * as Live from './live.js';
import * as PanelLink from './panel-link.js';
import { maybe } from './env.js';

export const DEFAULT_URL = 'https://aumzkcizwfnvnncggfpq.supabase.co/functions/v1/exchange-rates';
export const SIDES = ['sell', 'buy', 'mid'];
const DEFAULTS = { minutes: 10, scale: 100, jump: 20, side: 'sell' };
const FIRST_MS = 15 * 1000;
const LOADING_RETRY_MS = 60 * 1000;
const FAIL_RETRY_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 10 * 1000;

let timer = null;
let running = null;      // the in-flight check, so two callers share one fetch
let log = () => {};

const state = {
  configured: false,
  url: null,
  lastCheckAt: null,   // when the feed was last asked
  lastOkAt: null,      // when it last answered with a rate
  feedAt: null,        // the feed's own "last_updated"
  error: null,         // a code: not_configured · unreachable · refused · bad_answer · loading · write_failed
  detail: null,        // one line for the log, never shown as-is to a shopkeeper
  raw: null,           // { buy, sell } as the feed said them (old lira)
  candidate: null,     // the whole-lira rate the settings would make of that
  current: null,       // the shop's rate at the last check
  held: null,          // { rate, current, pct } when the jump guard stopped it
  applied: null,       // { rate, at, from, byUser } the last row this file wrote
  nextAt: null
};

/* ------------------------------------------------------------------ config */
function cfg(key) {
  const row = DB.get().prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function num(key, fallback, min, max) {
  const v = Number(cfg(key));
  if (!isFinite(v) || cfg(key) === null) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function settings() {
  const side = String(cfg('fx.feed_side') || DEFAULTS.side);
  return {
    on: cfg('fx.feed_on') !== '0',
    side: SIDES.includes(side) ? side : DEFAULTS.side,
    minutes: num('fx.feed_minutes', DEFAULTS.minutes, 1, 24 * 60),
    scale: num('fx.feed_scale', DEFAULTS.scale, 1, 1000000),
    jumpPct: num('fx.feed_max_jump_pct', DEFAULTS.jump, 0, 1000)
  };
}

function key() {
  const v = maybe('OG_FX_KEY');
  return v && String(v).trim() ? String(v).trim() : null;
}

function url() {
  const v = maybe('OG_FX_URL');
  return v && String(v).trim() ? String(v).trim() : DEFAULT_URL;
}

export function configured() { return !!key(); }

function currentRate() {
  try { return Cat.currentRate('USD', 'SYP'); } catch { return null; }
}

function lastApplied() {
  try { return JSON.parse(cfg('fx.feed_last') || 'null'); } catch { return null; }
}

/* ------------------------------------------------------------------ reading
   Two shapes, because the feed's own example and its live answer differ:
     { currency: 'USD', buy, sell }                       (the documented one)
     { status: 'success', data: { USD: { buy, sell } } }  (the live one)
   A `status: 'loading'` answer carries no rate and is not a fault. */
export function readAnswer(j) {
  if (!j || typeof j !== 'object') return { error: 'bad_answer' };
  if (j.status === 'loading') return { error: 'loading' };
  if (j.error || j.success === false) return { error: 'refused', detail: j.error_en || j.error || 'refused' };
  let usd = null;
  if (j.data && j.data.USD) usd = j.data.USD;
  else if (j.currency === 'USD' || (j.buy !== undefined && j.sell !== undefined)) usd = j;
  if (!usd) return { error: 'bad_answer', detail: 'no USD in the answer' };
  const buy = Number(usd.buy), sell = Number(usd.sell);
  if (!(buy > 0) || !(sell > 0)) return { error: 'bad_answer', detail: 'buy/sell not numbers' };
  const at = j.last_updated || j.timestamp || null;
  return { buy, sell, feedAt: at ? String(at) : null };
}

/* The whole-lira rate the shop would use for what the feed said. */
export function rateFor(raw, s = settings()) {
  const v = s.side === 'buy' ? raw.buy : s.side === 'mid' ? (raw.buy + raw.sell) / 2 : raw.sell;
  const r = Math.round(v / s.scale);
  return r > 0 ? r : null;
}

async function fetchFeed() {
  const k = key();
  if (!k) return { error: 'not_configured' };
  let res;
  try {
    res = await fetch(url(), {
      headers: { 'x-api-key': k, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    return { error: 'unreachable', detail: e && e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : (e && e.message) || 'fetch failed' };
  }
  let j = null;
  try { j = await res.json(); } catch { j = null; }
  if (res.status === 401 || res.status === 403) return { error: 'refused', detail: (j && (j.error_en || j.error)) || `HTTP ${res.status}` };
  if (!res.ok) return { error: 'unreachable', detail: `HTTP ${res.status}` };
  return readAnswer(j);
}

/* ------------------------------------------------------------------ writing */
function writeRate(rate, from, userId) {
  const r = Cat.setRate({ base: 'USD', quote: 'SYP', rate, userId: userId ?? null });
  const last = { at: r.at, rate, from, buy: from.buy, sell: from.sell, byUser: userId ?? null };
  DB.tx((d) => {
    d.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES ('fx.feed_last', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(JSON.stringify(last), r.at);
  });
  return last;
}

function tell() {
  const s = status();
  try { PanelLink.tell('fx', { fx: s }); } catch { /* no panel */ }
  return s;
}

/* One check: ask, decide, maybe write. `force` applies a held rate (a person
   pressed the button); `userId` goes on the row only for that press. Returns
   the status. Concurrent callers share the in-flight check. */
export function check(opts = {}) {
  if (running && !opts.force) return running;
  running = doCheck(opts).finally(() => { running = null; });
  return running;
}

async function doCheck({ force = false, userId = null } = {}) {
  const s = settings();
  state.configured = configured();
  state.url = url();
  state.lastCheckAt = new Date().toISOString();
  const a = await fetchFeed();
  if (a.error) {
    if (state.error !== a.error) {
      log(`  [fx] ${a.error === 'loading' ? 'feed still loading' : 'feed ' + a.error}${a.detail ? ' — ' + a.detail : ''}`);
    }
    state.error = a.error;
    state.detail = a.detail || null;
    return tell();
  }
  state.error = null;
  state.detail = null;
  state.lastOkAt = state.lastCheckAt;
  state.feedAt = a.feedAt;
  state.raw = { buy: a.buy, sell: a.sell };
  const rate = rateFor(state.raw, s);
  const current = currentRate();
  state.candidate = rate;
  state.current = current;
  state.held = null;
  if (!rate) { state.error = 'bad_answer'; state.detail = 'rate rounds to nothing'; return tell(); }

  if (current !== null && rate === current) return tell();

  const pct = current ? Math.abs(rate - current) / current * 100 : 0;
  if (!force && current && pct > s.jumpPct) {
    if (!state.held || state.held.rate !== rate) {
      log(`  [fx] HELD: the feed says 1 USD = ${rate} SYP, the shop is at ${current} — a ${pct.toFixed(0)} % jump needs a person (Settings → Exchange rate)`);
    }
    state.held = { rate, current, pct: Math.round(pct * 10) / 10 };
    return tell();
  }
  if (!force && !s.on) return tell();   // watching only

  try {
    const from = { side: s.side, scale: s.scale, buy: a.buy, sell: a.sell, feedAt: a.feedAt };
    state.applied = writeRate(rate, from, force ? userId : null);
    state.current = rate;
    log(`  [fx] 1 USD = ${rate} SYP (feed ${s.side} ${a[s.side === 'mid' ? 'sell' : s.side]} ÷ ${s.scale}; was ${current ?? 'unset'})${force ? ' — applied by hand' : ''}`);
    /* Every open tab: the number every dollar price converts through moved. */
    Live.notify('og', { fx: { rate, at: state.applied.at, from: force ? 'hand' : 'feed' } });
  } catch (e) {
    state.error = 'write_failed';
    state.detail = e && e.message;
    log(`  [fx] could not write the rate: ${state.detail}`);
  }
  return tell();
}

/* ------------------------------------------------------------------ timer */
function schedule(ms) {
  if (timer) clearTimeout(timer);
  state.nextAt = new Date(Date.now() + ms).toISOString();
  timer = setTimeout(tick, ms);
  timer.unref();
}

async function tick() {
  timer = null;
  try { await check(); } catch (e) { log(`  [fx] ${e && e.message}`); }
  if (!started) return;
  const s = settings();
  const ms = state.error === 'loading' ? LOADING_RETRY_MS
    : state.error && state.error !== 'not_configured' ? Math.min(FAIL_RETRY_MS, s.minutes * 60 * 1000)
    : s.minutes * 60 * 1000;
  schedule(ms);
}

let started = false;

export function start(logger = console.log) {
  log = logger;
  started = true;
  state.configured = configured();
  state.applied = lastApplied();
  if (!state.configured) {
    state.error = 'not_configured';
    log('  exchange-rate feed: off — no OG_FX_KEY in server/.env');
    tell();
    return;
  }
  const s = settings();
  log(`  exchange-rate feed: ${s.on ? 'on' : 'watching only'}, every ${s.minutes} min, ${s.side} ÷ ${s.scale}`);
  schedule(FIRST_MS);
}

export function stop() {
  started = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

/* A settings change from the card: ask again soon so the card answers. */
export function soon() {
  if (!started || !state.configured) return;
  schedule(1500);
}

export function status() {
  const s = settings();
  return {
    configured: state.configured,
    url: state.url,
    on: s.on, side: s.side, minutes: s.minutes, scale: s.scale, jumpPct: s.jumpPct,
    lastCheckAt: state.lastCheckAt,
    lastOkAt: state.lastOkAt,
    feedAt: state.feedAt,
    error: state.error,
    detail: state.detail,
    raw: state.raw,
    candidate: state.candidate,
    current: currentRate(),
    held: state.held,
    applied: state.applied || lastApplied(),
    nextAt: state.nextAt
  };
}

/* For tests: forget everything between cases. */
export function _reset() {
  stop();
  Object.assign(state, {
    configured: false, url: null, lastCheckAt: null, lastOkAt: null, feedAt: null, error: null,
    detail: null, raw: null, candidate: null, current: null, held: null, applied: null, nextAt: null
  });
}
