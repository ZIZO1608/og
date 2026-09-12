/* ==========================================================================
   OG SYSTEM — the Telegram line                                  [telegram.js]
   --------------------------------------------------------------------------
   Two bots, one per company. The shop's bot talks to a chat the manager
   linked (a person or a staff group); Yalla Wear's bot talks to a chat they
   linked from their portal. Neither side ever sees the other's token, and a
   message for the printer is built from an event that lib/partner.js has
   ALREADY stripped of the customer's name, number and price.

   Nothing here is on the request path. lib/partner.js writes a row to
   partner_events inside the same transaction as the change; this file drains
   that queue on a timer. A dead Telegram leaves rows queued with a retry
   time, and the shop keeps selling — the same rule the Supabase mirror lives
   by. Zero dependencies: Node 22's global fetch is the whole HTTP client.

   LINKING. A token names a bot, not a chat. To learn WHERE to send, each
   side asks for a six-character code (Settings for the shop, the partner
   portal for Yalla Wear), opens the bot, and sends the code. The bot is
   long-polling getUpdates; when the code arrives it remembers that chat and
   answers "linked". Codes live in memory for ten minutes — never in the
   config table, which GET /api/config hands to every login.

   Env:  OG_TELEGRAM_TOKEN_OG      the shop's bot, from @BotFather
         OG_TELEGRAM_TOKEN_YALLA   Yalla Wear's bot
   Config (written here, read by Settings):
         telegram.og_chat_id / telegram.og_chat_title
         telegram.yalla_chat_id / telegram.yalla_chat_title
   ========================================================================== */

import { randomBytes } from 'node:crypto';
import { maybe } from './env.js';
import * as DB from './db.js';
import * as Auth from './auth.js';
import * as Commands from './telegram-commands.js';

const SIDES = ['og', 'yalla'];
/* Telegram messages are two lines, Arabic then English. Named so the string
   literals around them stay free of escapes. */
const BR = String.fromCharCode(10);
const TOKEN_KEY = { og: 'OG_TELEGRAM_TOKEN_OG', yalla: 'OG_TELEGRAM_TOKEN_YALLA' };

const TICK_MS = 5 * 1000;
const BATCH = 20;
const MAX_ATTEMPTS = 12;
const CODE_TTL_MS = 10 * 60 * 1000;
const SEND_TIMEOUT_MS = 8000;
const POLL_TIMEOUT_S = 25;

const nowIso = () => new Date().toISOString();

let timer = null;
let sending = false;
const bots = {};            // side -> { username, polling, offset, lastError, lastOkAt }
const codes = {};           // side -> { code, expires }
const last = { error: null, okAt: null, sent: 0 };

/* ------------------------------------------------------------------ config */

function token(side) {
  const v = maybe(TOKEN_KEY[side]);
  return v && String(v).trim() ? String(v).trim() : null;
}

function cfg(key) {
  const row = DB.get().prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setCfg(pairs) {
  DB.tx((d) => {
    const up = d.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    for (const [k, v] of Object.entries(pairs)) {
      if (v === null) d.prepare('DELETE FROM config WHERE key = ?').run(k);
      else up.run(k, String(v), nowIso());
    }
  });
}

/* WHERE EACH SIDE'S MESSAGES GO — a list, not a single chat.

   It was one chat per side, in telegram.<side>_chat_id. That is one phone:
   the manager linked his own, and the person on the till or the second owner
   heard nothing. A shop is more than one person and a printer is more than
   one phone, so each side now holds a LIST and every message goes to all of
   them.

   Kept in `config` as JSON under one key rather than in a table of its own,
   deliberately: config is already mirrored whole, so a laptop restored from
   the cloud comes back with its links intact, and a new table would need a
   hand-run schema file in the Supabase dashboard before the first sync could
   land. The list is a handful of rows of a few dozen bytes.

   Each entry carries what somebody needs to recognise it months later and
   decide whether to cut it off: { id, title, type, at, by }. `by` is the
   account that pressed Connect, because "who added this group" is the first
   question asked about a chat nobody recognises. */
/* ---- WHAT EACH CHAT ASKED FOR ---------------------------------------------
   Every message goes to every linked chat, which was right when a side had
   one phone on it and wrong the moment it had three. The person in the back
   room wants to hear that a size hit zero; he has no business being told the
   day's takings, and the owner does not want a notification every time a
   shirt gets a name.

   So a chat carries `rules`: the list of kinds it accepts. NULL or absent
   means EVERYTHING — that is what every chat linked before this existed is,
   so nothing already working changed.

   The groups are what the screen offers, because seventeen tick boxes per
   phone is not a setting anybody will use. The individual kinds are still
   the stored unit, so "stock, but not the purchase orders" is expressible.

   `test` is deliberately absent from all of them: the Test button means "does
   this chat work", and a test message that silently went nowhere because the
   chat had unticked something would be the worst possible answer. */
const KIND_GROUPS = {
  day:   ['rem_og_digest', 'rem_day_close', 'rem_shift_open', 'rem_cash_variance'],
  stock: ['rem_stock_out', 'rem_stock_critical', 'rem_floor_empty', 'rem_reorder_due',
          'rem_size_run_broken', 'rem_dead_stock', 'rem_po_late', 'rem_wants_back'],
  print: ['rem_order_no_answer', 'rem_job_late', 'rem_partner_unread',
          'rem_job_stuck', 'rem_pay_wait'],
  runs:  ['rem_run_out_long', 'rem_driver_cash'],
  people: ['rem_customer_quiet'],
  yl:    ['rem_yl_order_waiting', 'rem_yl_due', 'rem_yl_due_tomorrow', 'rem_yl_blocked',
          'rem_yl_digest', 'rem_yl_week', 'rem_yl_pay_wait'],
  live:  ['order_new', 'order_accepted', 'order_declined', 'stage', 'names_ready',
          'message', 'invoice_new', 'payment_recorded', 'payment_confirmed', 'review']
};
export const ALL_KINDS = Object.keys(KIND_GROUPS).reduce((a, g) => a.concat(KIND_GROUPS[g]), []);

/* THE MONEY ONES, OFF ON A NEW CHAT. Somebody in the warehouse links their
   phone to hear about stock and must not be handed the day's takings because
   nobody remembered to untick it. Turning them on is a deliberate act by
   whoever owns the shop, on a screen that names the chat it is doing it to. */
const MONEY_KINDS = ['rem_day_close', 'rem_cash_variance', 'rem_og_digest',
                     'rem_dead_stock', 'rem_driver_cash'];
export const DEFAULT_RULES = ALL_KINDS.filter((k) => MONEY_KINDS.indexOf(k) < 0);

export function kindGroups() { return KIND_GROUPS; }

/* ---- A KIND INVENTED LATER, AND A LIST WRITTEN EARLIER ---------------------
   A chat's `rules` is an explicit array frozen at the moment somebody chose
   it, so it can never contain a kind that did not exist yet. Without this,
   every rule added from now on would be queued, find no subscriber, and be
   swallowed with a message blaming the picker.

   So a saved list carries the version it was written against, and a kind
   newer than that is ACCEPTED until the person next chooses — the reading
   being that they said no to the things they were shown, not to things nobody
   could have shown them.

   THE ONE EXCEPTION IS MONEY. A kind that carries takings is never granted by
   a default, an upgrade, or anything but somebody ticking it deliberately on a
   screen that names the chat. Same instinct as DEFAULT_RULES, same reason. */
const RULES_VERSION = 3;
/* kind -> the version that introduced it. A chat whose saved list predates a
   kind accepts it; a chat saved since then said no to it deliberately. */
const KIND_SINCE = {
  rem_og_digest: 2, rem_floor_empty: 2, rem_reorder_due: 2, rem_size_run_broken: 2,
  rem_dead_stock: 2, rem_run_out_long: 2, rem_driver_cash: 2, rem_customer_quiet: 2,
  rem_yl_due_tomorrow: 3, rem_yl_week: 3
};

function newerThanChoice(chat, kind) {
  const since = KIND_SINCE[kind] || 0;
  return since > (Number(chat && chat.rulesV) || 0);
}

/* ---- WHOSE PHONE IS THIS ---------------------------------------------------
   `userId` is PROVENANCE — who pressed Connect — and it is not identity. A
   manager who links the warehouse GROUP stamps that group with his own id, so
   reading `userId` as "whose phone this is" would hand the shop floor the
   manager's preset and every message addressed to any person.

   `person` is identity, and it is set only for a PRIVATE chat, at link time,
   and never derived from anything. A group has no person. A chat carried
   forward from before this existed has `type: 'unknown'`, which is not a
   person either — the honest answer when nobody recorded one. */
const PERSON_MS = 60 * 1000;
let personCache = { at: 0, by: {} };

function personOf(chat) {
  const id = chat && chat.person;
  if (id == null) return null;
  if (Date.now() - personCache.at > PERSON_MS) personCache = { at: Date.now(), by: {} };
  if (personCache.by[id] !== undefined) return personCache.by[id];
  let u = null;
  try { u = DB.get().prepare('SELECT * FROM users WHERE id = ?').get(Number(id)) || null; }
  catch { u = null; }
  personCache.by[id] = u;
  return u;
}

/* Does the account behind this chat still hold the run of the shop? Asked
   through Auth.can and not `role === 'manager'` for three reasons: the
   permission table is the authority and is cache-invalidated on every write
   path; PINNED guarantees a manager can never lose config.write; and Auth.can
   returns false for an INACTIVE account, which closes the departed-employee
   hole in the same line that answers the question. */
function chatRunsTheShop(chat) {
  const u = personOf(chat);
  return !!u && Auth.can(u, 'config.write');
}

/* What this chat actually accepts, once its preset is resolved.

   A chat whose account is gone, disabled, or whose preset key is unreadable
   resolves to NOTHING — explicitly, and never by falling through to the
   `rules`-is-not-an-array convention, which means EVERYTHING. Getting that
   backwards would make a departed employee's phone receive more, not less. */
function effectiveRules(chat) {
  if (!chat || chat.preset !== 'role') return chat ? chat.rules : null;
  const u = personOf(chat);
  if (!u || !u.active) return [];
  const raw = cfg('reminders.preset.' + u.role);
  if (raw == null) return [];
  if (raw === 'null') return null;                     /* the manager's: everything */
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/* One question, asked in one place — see drain(). */
function wants(chat, kind) {
  if (kind === 'test') return true;
  const rules = effectiveRules(chat);
  if (!Array.isArray(rules)) return true;                /* null = everything */
  if (rules.indexOf(kind) > -1) return true;
  return MONEY_KINDS.indexOf(kind) < 0 && newerThanChoice(chat, kind);
}

/* IS THIS ROW FOR THIS CHAT. `to_user` null is every row that exists today:
   the whole side, unchanged. An addressed row reaches the person it names —
   and whoever runs the shop, which is the owner's decision and is also what
   makes a person with no phone linked yet still get told about, rather than
   the message vanishing. */
function addressed(chat, toUser) {
  if (toUser == null) return true;
  if (chat && chat.person != null && Number(chat.person) === Number(toUser)) return true;
  return chatRunsTheShop(chat);
}

/* A MUTE BELONGS TO ONE CHAT, and it silences the nagging, not the news.
   /mute says in as many words that real events still arrive as usual, so the
   filter tests the rem_ prefix — the same test keyboardFor uses to decide
   which messages carry a Mute button in the first place. */
function mutedNow(chat, kind, nowMs) {
  if (String(kind).indexOf('rem_') !== 0) return false;
  const until = chat && chat.mutedUntil ? Date.parse(chat.mutedUntil) : 0;
  return !!until && until > (nowMs || Date.now());
}

/* ---- WHAT A KIND IMPLIES ---------------------------------------------------
   The handful of kinds that carry money or a customer's name, and the
   permission somebody would need to see the same thing on a screen. Nothing
   here BLOCKS — the linked chats are the owner's, and that decision stands —
   but the picker can say "Ahmad's account cannot see takings in the app"
   beside the box, so it can never happen by accident and can be seen later. */
/* The five role presets as the browser needs them, read from config so the
   screen and the router can never hold two different answers. */
export const PRESET_ROLES = ['manager', 'cashier', 'warehouse', 'delivery', 'partner'];
export function presetMap() {
  const out = {};
  for (const r of PRESET_ROLES) {
    const raw = cfg('reminders.preset.' + r);
    if (raw == null) { out[r] = []; continue; }
    if (raw === 'null') { out[r] = null; continue; }
    try { const v = JSON.parse(raw); out[r] = Array.isArray(v) ? v : []; }
    catch { out[r] = []; }
  }
  return out;
}

export const KIND_PERM = {
  rem_day_close: 'money.read',
  rem_cash_variance: 'money.read',
  rem_og_digest: 'money.read',
  rem_driver_cash: 'money.read',
  rem_pay_wait: 'money.read',
  /* Capital tied up in stock is a cost figure, not a takings figure. */
  rem_dead_stock: 'cost.read',
  /* Names regulars by name — and `partner.js` already keeps the customer out
     of the shop's own chat because a staff group is wider than customer.read. */
  rem_customer_quiet: 'customer.read',
  invoice_new: 'money.read',
  payment_recorded: 'money.read',
  payment_confirmed: 'money.read'
};

/* A PRIVATE CHAT LINKED BEFORE `person` EXISTED IS STILL SOMEBODY'S PHONE.
   Without this every chat already connected would answer no command at all
   the moment this shipped, because the router now asks what the owning
   account may do and there would be no owning account to ask.

   The inference is allowed for a PRIVATE chat only, and it is the same one the
   card has always made out loud ("added by Hussam Fattal"): the code was
   minted by that account and sent from that person's own chat. A GROUP is
   never inferred — that is the whole of finding 1, and a group having no owner
   is the honest answer rather than a gap. */
function inferPerson(c) {
  if (c.person != null || c.type !== 'private' || c.userId == null) return c;
  return { ...c, person: Number(c.userId) };
}

function chats(side) {
  const raw = cfg(`telegram.${side}_chats`);
  if (raw) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((c) => c && c.id).map(inferPerson);
    } catch { /* unreadable: fall through to the old single key */ }
  }
  /* The single chat this used to hold, read forward so an upgrade keeps
     sending to the phone it was already sending to. Written back into the
     list the first time anything changes it. */
  const one = cfg(`telegram.${side}_chat_id`);
  if (!one) return [];
  return [{ id: String(one), title: cfg(`telegram.${side}_chat_title`) || String(one),
            type: 'unknown', at: null, by: null }];
}

function setChats(side, list) {
  const clean = list.filter((c) => c && c.id).map((c) => ({
    id: String(c.id), title: c.title || String(c.id), type: c.type || 'unknown',
    at: c.at || null, by: c.by || null,
    /* Who pressed Connect, as an ACCOUNT and not just a name — "whose phone
       is this" is the first question asked about a chat months later, and a
       display name does not survive somebody being renamed. */
    userId: c.userId == null ? null : Number(c.userId),
    /* WHOSE phone, as opposed to who pressed Connect. Only ever set for a
       private chat, and never inferred here — see personOf(). */
    person: c.person == null ? null : Number(c.person),
    /* 'role' = follow the preset for this person's role; null = the explicit
       list below, which is every chat that existed before presets. */
    preset: c.preset === 'role' ? 'role' : null,
    mutedUntil: c.mutedUntil || null,
    /* Unknown stays unknown: undefined means "never chosen" and is read as
       everything, which is not the same as an empty list meaning "nothing". */
    rules: Array.isArray(c.rules) ? c.rules.filter((k) => ALL_KINDS.indexOf(k) > -1) : null,
    /* Which generation of the kind list those choices were made against. A
       chat from before this field answers 0, so every later kind reaches it. */
    rulesV: Number(c.rulesV) || 0
  }));
  setCfg({
    [`telegram.${side}_chats`]: JSON.stringify(clean),
    /* The old keys are kept in step so anything still reading them — an older
       copy of the app on a phone that has not refreshed — sees the first
       chat rather than nothing at all. */
    [`telegram.${side}_chat_id`]: clean.length ? clean[0].id : null,
    [`telegram.${side}_chat_title`]: clean.length ? clean[0].title : null
  });
  return clean;
}

function addChat(side, chat, by, userId) {
  const list = chats(side);
  const id = String(chat.id);
  /* A PRIVATE chat is somebody's own phone, so it belongs to the account that
     linked it and follows that person's role. A GROUP belongs to nobody —
     whoever pressed Connect does not own the room — so it gets an explicit
     list and is configured by hand, which is the only honest answer for a
     chat whose membership nobody in this system controls. */
  const isPrivate = chat.type === 'private';
  const entry = { id, title: chatTitle(chat), type: chat.type || 'unknown', at: nowIso(),
                  by: by || null, userId: userId == null ? null : Number(userId),
                  person: isPrivate && userId != null ? Number(userId) : null,
                  preset: isPrivate && userId != null ? 'role' : null,
                  mutedUntil: null,
                  /* A new group hears everything but the money — see
                     DEFAULT_RULES — EXCEPT on the partner side, where a group
                     is the normal case rather than the awkward one. Yalla Wear
                     is two people and their bot talks to one shared room, so a
                     group there starts on the partner preset instead of being
                     handed a generic list and left for somebody to tick. There
                     is nothing to withhold: their audience carries no takings.
                     A group on the SHOP side keeps the cautious default. */
                  rules: isPrivate && userId != null ? null
                       : (side === 'yalla' ? (presetMap().partner || DEFAULT_RULES).slice()
                                           : DEFAULT_RULES.slice()),
                  rulesV: RULES_VERSION };
  const at = list.findIndex((c) => String(c.id) === id);
  /* Sending the code again from a chat that is already on the list is a
     person checking it still works, not a request for a second copy of every
     message. Refreshed in place, never appended twice — and it keeps the
     rules it already had, or re-linking would silently reset somebody's
     choices to the default. */
  if (at >= 0) { list[at] = { ...list[at], title: entry.title, type: entry.type }; return { list: setChats(side, list), already: true }; }
  list.push(entry);
  return { list: setChats(side, list), already: false };
}

/* What one chat accepts. `null` puts it back to everything. Refuses an id
   that is not linked rather than inventing a row, so a stale screen cannot
   create a chat nobody connected. */
export function setChatRules(side, chatId, rules) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  const list = chats(side);
  const at = list.findIndex((c) => String(c.id) === String(chatId));
  if (at < 0) throw Object.assign(new Error('that chat is not linked'), { code: 'not_found' });
  /* CHOOSING BY HAND ENDS THE PRESET. "The manager can override, and the
     override sticks" is the whole decision; a chat that went on following its
     role would put the boxes back the next time the role's preset changed.
     `rules: undefined` is the way back — see the branch below. */
  if (rules === undefined) {
    list[at] = { ...list[at], preset: 'role', rules: null, rulesV: RULES_VERSION };
  } else {
    list[at] = { ...list[at], preset: null,
                 rules: rules === null ? null : (rules || []),
                 rulesV: RULES_VERSION };
  }
  return { chats: setChats(side, list) };
}

/* The Mute 2h button and /mute, per chat. Silent about a chat it does not
   know rather than throwing: the press comes from a room, and a room that was
   disconnected a moment ago is a race, not an error. */
export function muteChat(side, chatId, untilIso) {
  if (!SIDES.includes(side)) return null;
  const list = chats(side);
  const at = list.findIndex((c) => String(c.id) === String(chatId));
  if (at < 0) return null;
  list[at] = { ...list[at], mutedUntil: untilIso || null };
  setChats(side, list);
  return untilIso || null;
}

function removeChat(side, id) {
  const before = chats(side);
  const after = before.filter((c) => String(c.id) !== String(id));
  setChats(side, after);
  return { removed: before.length - after.length, chats: after };
}

/* ------------------------------------------------------------------- api */

async function call(side, method, body, timeoutMs = SEND_TIMEOUT_MS) {
  const tk = token(side);
  if (!tk) throw new Error(`no token for ${side}`);
  const res = await fetch(`https://api.telegram.org/bot${tk}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const err = new Error(json.description || `Telegram ${res.status} on ${method}`);
    err.status = res.status;
    err.retryAfter = json.parameters && json.parameters.retry_after;
    throw err;
  }
  return json.result;
}

/* ------------------------------------------------------------- templates
   Arabic first, English under it, plain text. No Markdown: a job id like
   P_1043 or a name with an underscore would break the parse and the message
   would silently never arrive. */

const fmtMoney = (n, cur) => `${Number(n || 0).toLocaleString('en-US')} ${cur || ''}`.trim();
const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
/* Money on the shop's side is a PAIR — the shop genuinely prices some goods
   in dollars — and the two are never added. Dollars appear only when there
   were any, so an ordinary lira day reads as one number. */
const fmtPair = (syp, usd) =>
  fmtMoney(syp || 0, 'SYP') + (Number(usd) ? ' + ' + fmtMoney(usd, 'USD') : '');
const STAGE_AR = { design: 'التصميم', sent: 'استلمتها المطبعة', printing: 'قيد الطباعة', delivery: 'في الطريق', done: 'مكتمل' };
const STAGE_EN = { design: 'Design', sent: 'Taken by the printer', printing: 'Printing', delivery: 'On its way', done: 'Done' };
const KIND_AR = { note: 'ملاحظة', nudge: 'تذكير', delay: 'تأخير', 'name-request': 'طلب أسماء', reply: 'رد', reminder: 'تذكير', invoice: 'فاتورة' };

const TEMPLATES = {
  order_new: (a) => ({
    ar: `🧵 طلب طباعة جديد ${a.id} — ${a.qty} قطعة` + (a.deadline ? `، التسليم ${fmtDate(a.deadline)}` : '') +
        (a.priority === 'urgent' ? ' — مستعجل' : '') + `\n${a.design || ''}\nافتح البوابة للقبول أو الرفض.`,
    en: `New print order ${a.id} — ${a.qty} pcs` + (a.deadline ? `, due ${fmtDate(a.deadline)}` : '') +
        (a.priority === 'urgent' ? ' — URGENT' : '') + `\n${a.design || ''}\nOpen the portal to accept or decline.`
  }),
  order_accepted: (a) => ({
    ar: `✅ ${a.actor ? a.actor + ' من يلا وير قبل الطلب' : 'يلا وير قبلت الطلب'} ${a.id}` + (a.promisedAt ? ` — الوعد بالتسليم ${fmtDate(a.promisedAt)}` : '') + (a.note ? `\n${a.note}` : ''),
    en: `${a.actor ? a.actor + ' at Yalla Wear accepted order' : 'Yalla Wear accepted order'} ${a.id}` + (a.promisedAt ? ` — promised for ${fmtDate(a.promisedAt)}` : '') + (a.note ? `\n${a.note}` : '')
  }),
  order_declined: (a) => ({
    ar: `❌ ${a.actor ? a.actor + ' من يلا وير رفض الطلب' : 'يلا وير رفضت الطلب'} ${a.id}` + (a.note ? `\nالسبب: ${a.note}` : ''),
    en: `${a.actor ? a.actor + ' at Yalla Wear declined order' : 'Yalla Wear declined order'} ${a.id}` + (a.note ? `\nReason: ${a.note}` : '')
  }),
  stage: (a) => ({
    ar: `📦 ${a.id} — ${STAGE_AR[a.stage] || a.stage} · ${a.qty} قطعة`,
    en: `${a.id} — ${STAGE_EN[a.stage] || a.stage} · ${a.qty} pcs`
  }),
  names_ready: (a) => ({
    ar: `✍️ اكتملت الأسماء على ${a.id} — ${a.qty} قطعة جاهزة للطباعة`,
    en: `All names are in on ${a.id} — ${a.qty} pcs ready to print`
  }),
  message: (a) => ({
    ar: `💬 رسالة على ${a.id || a.invoiceId}` + (KIND_AR[a.kind] ? ` (${KIND_AR[a.kind]})` : '') + `\n${a.text || ''}`,
    en: `Message on ${a.id || a.invoiceId}` + (a.kind && a.kind !== 'note' ? ` (${a.kind})` : '') + `\n${a.text || ''}`
  }),
  invoice_new: (a) => ({
    ar: `🧾 فاتورة جديدة من يلا وير ${a.invoiceId} — ${fmtMoney(a.total, a.currency)}` + (a.due ? `، الاستحقاق ${fmtDate(a.due)}` : ''),
    en: `New invoice from Yalla Wear ${a.invoiceId} — ${fmtMoney(a.total, a.currency)}` + (a.due ? `, due ${fmtDate(a.due)}` : '')
  }),
  payment_recorded: (a) => ({
    ar: `💵 ${a.by === 'og' ? 'OG سجّل دفعة' : 'يلا وير سجّلت استلام دفعة'} ${fmtMoney(a.amount, a.currency)} على ${a.invoiceId}\nبانتظار تأكيدك.`,
    en: `${a.by === 'og' ? 'OG recorded a payment of' : 'Yalla Wear recorded receiving'} ${fmtMoney(a.amount, a.currency)} on ${a.invoiceId}\nWaiting for your confirmation.`
  }),
  payment_confirmed: (a) => ({
    ar: `✅ تم تأكيد دفعة ${fmtMoney(a.amount, a.currency)} على ${a.invoiceId}`,
    en: `Payment of ${fmtMoney(a.amount, a.currency)} on ${a.invoiceId} confirmed`
  }),
  review: (a) => ({
    ar: `⭐ تقييم OG للطلب ${a.id}: ${'★'.repeat(a.rating)}${'☆'.repeat(5 - a.rating)}` + (a.feedback ? `\n${a.feedback}` : ''),
    en: `OG rated ${a.id}: ${'★'.repeat(a.rating)}${'☆'.repeat(5 - a.rating)}` + (a.feedback ? `\n${a.feedback}` : '')
  }),
  test: () => ({
    ar: '🔔 رسالة تجريبية من نظام OG — التنبيهات تعمل.',
    en: 'Test message from OG System — notifications are working.'
  }),

  /* ---- the reminders ------------------------------------------------------
     Everything above is NEWS: something happened, here it is. Everything
     below is a STANDING CONDITION that lib/reminders.js found still true —
     an order nobody answered, a shift nobody closed, a size nobody reordered.
     Same table, same drain, same plain text; only the producer is different.

     Each one says the thing and, where there is one, the action. A reminder
     that only states a fact is a reminder people stop reading. */

  rem_day_close: (a) => ({
    ar: `📊 إغلاق اليوم ${a.day}` +
        `${BR}المبيعات: ${fmtPair(a.syp, a.usd)}` +
        `${BR}${a.invoices} فاتورة` +
        (a.expected == null ? '' : `${BR}المتوقع في الدرج: ${fmtMoney(a.expected, a.currency)}`) +
        (a.shiftOpen ? `${BR}الوردية ${a.shift} ما زالت مفتوحة.` : ''),
    en: `Day close ${a.day}` +
        `${BR}Sales: ${fmtPair(a.syp, a.usd)}` +
        `${BR}${a.invoices} invoice(s)` +
        (a.expected == null ? '' : `${BR}Expected in the drawer: ${fmtMoney(a.expected, a.currency)}`) +
        (a.shiftOpen ? `${BR}Shift ${a.shift} is still open.` : '')
  }),
  /* THE NAME LEADS. These two are addressed to the person they are about, and
     the same rendered text goes to them and to whoever runs the shop — so it
     has to read correctly as both "you left this open" and "she left this
     open". A name at the FRONT does that; a name trailing after a dash reads
     as a signature, which is what args.actor means and the opposite of this. */
  rem_shift_open: (a) => ({
    ar: (a.person ? `${a.person} — ` : '') +
        `🕙 الوردية ${a.id} ما زالت مفتوحة منذ ${a.hours} ساعة.` +
        `${BR}عُدّ الصندوق وأغلقها.`,
    en: (a.person ? `${a.person} — ` : '') +
        `shift ${a.id} has been open for ${a.hours}h.` +
        `${BR}Count the drawer and close it.`
  }),
  rem_cash_variance: (a) => ({
    ar: (a.person ? `${a.person} — ` : '') +
        `⚠️ فرق في الصندوق على الوردية ${a.id}: ${a.diff > 0 ? '+' : ''}${fmtMoney(a.diff, a.currency)}` +
        `${BR}عُدّ ${fmtMoney(a.counted, a.currency)}، والمتوقع ${fmtMoney(a.expected, a.currency)}.`,
    en: (a.person ? `${a.person} — ` : '') +
        `drawer difference on shift ${a.id}: ${a.diff > 0 ? '+' : ''}${fmtMoney(a.diff, a.currency)}` +
        `${BR}Counted ${fmtMoney(a.counted, a.currency)}, expected ${fmtMoney(a.expected, a.currency)}.`
  }),
  /* ---- the shelves ------------------------------------------------------ */
  /* The one with a sale attached to it. Says the size, how many are in the
     back, and how fast it sells — the three things that decide whether it is
     worth the walk. */
  rem_floor_empty: (a) => ({
    ar: `👟 نفد من الرفّ: ${a.name} — مقاس ${a.size}` + BR +
        `في المستودع ${a.back} — انقلها إلى المحل.` +
        (a.n > 1 ? `${BR}و${a.n - 1} مقاس آخر بنفس الحال.` : ''),
    en: `Empty on the floor: ${a.name} — size ${a.size}` + BR +
        `${a.back} in the back — carry them out.` +
        (a.n > 1 ? `${BR}and ${a.n - 1} other size(s) the same.` : '')
  }),
  rem_reorder_due: (a) => ({
    ar: `📦 يستحق إعادة الطلب: ${a.name} — مقاس ${a.size}` + BR +
        `بقي ${a.have} — تكفي نحو ${a.cover} أسبوع بمعدّل البيع الحالي.` +
        (a.n > 1 ? `${BR}و${a.n - 1} مقاس آخر تحت الحد.` : ''),
    en: `Worth reordering: ${a.name} — size ${a.size}` + BR +
        `${a.have} left — about ${a.cover} week(s) of cover at the current rate.` +
        (a.n > 1 ? `${BR}and ${a.n - 1} other size(s) below the line.` : '')
  }),
  /* Names the sizes both ways round, because "which are gone" and "which are
     left" are two different decisions — reorder, or move it off the shelf. */
  rem_size_run_broken: (a) => ({
    ar: `📐 مقاسات مكسورة: ${a.name}` + BR +
        `نفد ما يُباع فعلاً (${(a.gone || []).join('، ')})، وبقي ${(a.left || []).join('، ')}` +
        ` — ${a.pieces} قطعة على الرفّ لا تُباع.`,
    en: `Broken size run: ${a.name}` + BR +
        `The sizes that sell are gone (${(a.gone || []).join(', ')}), and ${(a.left || []).join(', ')} are left` +
        ` — ${a.pieces} piece(s) on the shelf that will not sell.`
  }),
  rem_dead_stock: (a) => ({
    ar: `🪦 بضاعة راكدة: ${a.name}` + BR +
        `${a.pieces} قطعة لم تتحرّك منذ ${a.days} يوماً` +
        (a.capital ? ` — ${fmtMoney(a.capital, a.currency)} بالكلفة` : '') + '.' +
        (a.n > 1 ? `${BR}و${a.n - 1} صنف آخر راكد (${a.allPieces} قطعة).` : ''),
    en: `Dead stock: ${a.name}` + BR +
        `${a.pieces} piece(s), nothing sold in ${a.days} days` +
        (a.capital ? ` — ${fmtMoney(a.capital, a.currency)} at cost` : '') + '.' +
        (a.n > 1 ? `${BR}and ${a.n - 1} other line(s) standing still (${a.allPieces} pieces).` : '')
  }),

  /* ---- the runs --------------------------------------------------------- */
  /* One row, two clocks: a run is counted in hours and a shipment in days —
     "out for 137h" is a true sentence nobody reads as five days. */
  rem_run_out_long: (a) => ({
    ar: a.ship
      ? `📦 الشحنة ${a.id} على الطريق منذ ${a.days} يوم ولم تُعلَّم بعد` +
        (a.where ? ` — ${a.where}` : '') + '.' +
        (a.n > 1 ? `${BR}و${a.n - 1} شحنة أخرى بنفس الحال.` : '')
      : `🛵 التوصيلة ${a.id} خارجة منذ ${a.hours} ساعة ولم تُعلَّم بعد` +
        (a.driver ? ` — ${a.driver}` : '') + '.' +
        (a.n > 1 ? `${BR}و${a.n - 1} توصيلة أخرى بنفس الحال.` : ''),
    en: a.ship
      ? `Parcel ${a.id} has been on the road ${a.days} day(s) and is still not marked` +
        (a.where ? ` — ${a.where}` : '') + '.' +
        (a.n > 1 ? `${BR}and ${a.n - 1} other parcel(s) the same.` : '')
      : `Delivery ${a.id} has been out for ${a.hours}h and is still not marked` +
        (a.driver ? ` — ${a.driver}` : '') + '.' +
        (a.n > 1 ? `${BR}and ${a.n - 1} other run(s) the same.` : '')
  }),
  /* Addressed to the driver, so the name leads — see rem_shift_open. It no
     longer says "today": 046 knows what has actually been handed in, so this
     is money still in somebody's pocket whichever day it was collected, and
     that is a stronger sentence than a daily total. */
  rem_driver_cash: (a) => ({
    ar: (a.person ? `${a.person} — ` : '') +
        `💵 معك ${fmtMoney(a.amount, a.currency)} من ${a.n} توصيلة لم تُسلَّم بعد.` + BR +
        'سلّمها قبل إغلاق الصندوق.',
    en: (a.person ? `${a.person} — ` : '') +
        `you are still holding ${fmtMoney(a.amount, a.currency)} from ${a.n} delivery(ies).` + BR +
        'Hand it in before the drawer is counted.'
  }),

  /* ---- the regulars ----------------------------------------------------- */
  /* Their OWN usual gap, not a fixed number of days — the shop already
     computes quiet per customer and this asks the same question. */
  rem_customer_quiet: (a) => ({
    ar: `👋 زبائن غابوا أكثر من عادتهم:` + BR + (a.names || []).join('، ') +
        (a.n > (a.names || []).length ? `${BR}و${a.n - (a.names || []).length} غيرهم.` : ''),
    en: `Regulars who have gone quiet for longer than usual:` + BR + (a.names || []).join(', ') +
        (a.n > (a.names || []).length ? `${BR}and ${a.n - (a.names || []).length} more.` : '')
  }),

  /* ---- the morning ------------------------------------------------------ */
  /* FOUR SECTIONS, EACH DROPPED WHEN EMPTY. A digest of four zeroes every
     morning is how a daily message stops being read — the same rule
     yl_digest already follows. */
  rem_og_digest: (a) => {
    const arBits = [`☀️ صباح الخير — ${a.day}`];
    const enBits = [`Good morning — ${a.day}`];
    if (a.money) {
      arBits.push(`أمس: ${a.money.text} · ${a.money.count} فاتورة` +
        (a.money.drawer ? BR + `في الدرج الآن: ${a.money.drawer}` : ''));
      enBits.push(`Yesterday: ${a.money.text} · ${a.money.count} invoice(s)` +
        (a.money.drawer ? BR + `In the drawer now: ${a.money.drawer}` : ''));
    }
    /* A ZERO INSIDE A SECTION IS NOISE. "0 worth reordering" is true and tells
       nobody anything, and three of them in a row is how the eye learns to
       skip the line. Each part appears only when it has something to say —
       the same rule that keeps the whole message silent on an empty morning,
       applied one level down. */
    const part = (ar, en, pairs) => {
      const a2 = pairs.filter((p) => p[0]).map((p) => p[1]);
      const e2 = pairs.filter((p) => p[0]).map((p) => p[2]);
      if (!a2.length) return;
      arBits.push(ar + ': ' + a2.join(' · '));
      enBits.push(en + ': ' + e2.join(' · '));
    };
    if (a.work) part('العمل', 'Work', [
      [a.work.due, `${a.work.due} يُسلَّم اليوم`, `${a.work.due} due today`],
      [a.work.late, `${a.work.late} متأخر`, `${a.work.late} overdue`],
      [a.work.pending, `${a.work.pending} بانتظار ردّ يلا وير`, `${a.work.pending} waiting on Yalla Wear`]
    ]);
    if (a.shelves) part('الرفوف', 'Shelves', [
      [a.shelves.out, `${a.shelves.out} نفد`, `${a.shelves.out} at zero`],
      [a.shelves.floor, `${a.shelves.floor} بحاجة نقل من المستودع`,
        `${a.shelves.floor} to carry out from the back`],
      [a.shelves.reorder, `${a.shelves.reorder} يستحق الطلب`,
        `${a.shelves.reorder} worth reordering`]
    ]);
    if (a.people) part('الزبائن', 'Customers', [
      [a.people.quiet, `${a.people.quiet} غابوا`, `${a.people.quiet} gone quiet`],
      [a.people.wants, `${a.people.wants} مقاس مطلوب وصل`, `${a.people.wants} wanted size(s) landed`]
    ]);
    return { ar: arBits.join(BR + BR), en: enBits.join(BR + BR) };
  },

  rem_stock_out: (a) => ({
    ar: `🚫 نفد المخزون: ${a.name} — مقاس ${a.size}` +
        (a.n > 1 ? `${BR}و${a.n - 1} مقاس آخر نفد أيضاً.` : ''),
    en: `Out of stock: ${a.name} — size ${a.size}` +
        (a.n > 1 ? `${BR}and ${a.n - 1} other size(s) with none left.` : '')
  }),
  rem_stock_critical: (a) => ({
    ar: `🔻 ${a.n} مقاس على وشك النفاد (${a.low} قطعة أو أقل).`,
    en: `${a.n} size(s) nearly out (${a.low} pieces or fewer).`
  }),
  rem_po_late: (a) => ({
    ar: `📦 طلب الشراء ${a.id}` + (a.name ? ` — ${a.name}` : '') +
        ` مُرسل منذ ${a.days} يوماً ولم يصل شيء.`,
    en: `Purchase order ${a.id}` + (a.name ? ` — ${a.name}` : '') +
        ` was sent ${a.days} days ago and nothing has arrived.`
  }),
  rem_wants_back: (a) => ({
    ar: `↺ عاد للمخزون: ${a.name} — مقاس ${a.size}` +
        `${BR}${a.n} زبون كان يسأل عنه.`,
    en: `Back in stock: ${a.name} — size ${a.size}` +
        `${BR}${a.n} customer(s) asked for it.`
  }),
  rem_order_no_answer: (a) => ({
    ar: `⏳ الطلب ${a.id} عند يلا وير منذ ${a.hours} ساعة بلا رد — ${a.qty} قطعة.`,
    en: `Order ${a.id} has been with Yalla Wear ${a.hours}h with no answer — ${a.qty} pcs.`
  }),
  rem_job_late: (a) => ({
    ar: `🔴 الطلب ${a.id} تجاوز موعد التسليم بـ ${a.days} يوم — ${STAGE_AR[a.stage] || a.stage}.`,
    en: `Job ${a.id} is ${a.days} day(s) past its deadline — ${STAGE_EN[a.stage] || a.stage}.`
  }),
  rem_partner_unread: (a) => ({
    ar: `✉️ ${a.n} رسالة من يلا وير بلا قراءة، أقدمها منذ ${a.hours} ساعة.` +
        (a.text ? `${BR}«${a.text}»` : ''),
    en: `${a.n} unread message(s) from Yalla Wear, the oldest ${a.hours}h old.` +
        (a.text ? `${BR}"${a.text}"` : '')
  }),
  rem_job_stuck: (a) => ({
    ar: `🚚 الطلب ${a.id} في مرحلة «في الطريق» منذ ${a.hours} ساعة ولم يُسلَّم.`,
    en: `Job ${a.id} has been "on its way" for ${a.hours}h and is not delivered.`
  }),
  rem_pay_wait: (a) => ({
    ar: `💵 دفعة ${fmtMoney(a.amount, a.currency)} على ${a.invoiceId} سجّلتها يلا وير منذ ${a.hours} ساعة.` +
        `${BR}بانتظار تأكيدك.`,
    en: `A payment of ${fmtMoney(a.amount, a.currency)} on ${a.invoiceId} was recorded by Yalla Wear ${a.hours}h ago.` +
        `${BR}Waiting for your confirmation.`
  }),

  /* --- Yalla Wear's own bot. Never a customer, never a price: emitEvent
         strips those at the door, and these templates never name them. --- */

  rem_yl_order_waiting: (a) => ({
    ar: `⏳ الطلب ${a.id} بانتظار ردكم منذ ${a.hours} ساعة — ${a.qty} قطعة` +
        (a.deadline ? `، التسليم ${fmtDate(a.deadline)}` : '') +
        (a.priority === 'urgent' ? ' — مستعجل' : '') + '.' +
        `${BR}افتحوا البوابة للقبول أو الرفض.`,
    en: `Order ${a.id} has been waiting ${a.hours}h for your answer — ${a.qty} pcs` +
        (a.deadline ? `, due ${fmtDate(a.deadline)}` : '') +
        (a.priority === 'urgent' ? ' — URGENT' : '') + '.' +
        `${BR}Open the portal to accept or decline.`
  }),
  rem_yl_due: (a) => ({
    ar: a.days < 0
      ? `🔴 الطلب ${a.id} — ${a.qty} قطعة — متأخر ${-a.days} يوم (كان ${fmtDate(a.due)}).`
      : a.days === 0
        ? `📅 الطلب ${a.id} — ${a.qty} قطعة — التسليم اليوم.`
        : `📅 الطلب ${a.id} — ${a.qty} قطعة — التسليم بعد ${a.days} يوم (${fmtDate(a.due)}).`,
    en: a.days < 0
      ? `Job ${a.id} — ${a.qty} pcs — ${-a.days} day(s) overdue (was ${fmtDate(a.due)}).`
      : a.days === 0
        ? `Job ${a.id} — ${a.qty} pcs — due today.`
        : `Job ${a.id} — ${a.qty} pcs — due in ${a.days} day(s) (${fmtDate(a.due)}).`
  }),
  rem_yl_blocked: (a) => ({
    ar: `✍️ الطلب ${a.id} متوقف: ${a.tbc} قميص بلا اسم من أصل ${a.qty}.` +
        `${BR}لا تحجزوا وقت المكبس — سنرسل الأسماء فور اكتمالها.`,
    en: `Job ${a.id} is blocked: ${a.tbc} of ${a.qty} shirts still have no name.` +
        `${BR}Don't hold press time — the names follow as soon as they are in.`
  }),
  rem_yl_digest: (a) => ({
    ar: `☀️ صباح الخير — عمل اليوم ${a.day}` +
        `${BR}طلبات في اليد: ${a.jobs} (${a.pieces} قطعة)` +
        `${BR}تسليم اليوم: ${a.dueToday}` +
        `${BR}متأخر: ${a.overdue}` +
        (a.pending ? `${BR}بانتظار ردكم: ${a.pending}` : ''),
    en: `Good morning — today's work ${a.day}` +
        `${BR}Jobs in hand: ${a.jobs} (${a.pieces} pcs)` +
        `${BR}Due today: ${a.dueToday}` +
        `${BR}Overdue: ${a.overdue}` +
        (a.pending ? `${BR}Waiting on your answer: ${a.pending}` : '')
  }),
  /* Tonight, for tomorrow. Names up to five and counts the rest, the same
     shape every list-bearing reminder uses. */
  rem_yl_due_tomorrow: (a) => ({
    ar: `📅 غداً (${a.day}): ${a.jobs} طلب · ${a.pieces} قطعة` +
        ((a.ids || []).length ? `${BR}${(a.ids || []).join('، ')}` : '') +
        ((a.jobs || 0) > (a.ids || []).length ? `${BR}و${a.jobs - (a.ids || []).length} غيرها.` : ''),
    en: `Due tomorrow (${a.day}): ${a.jobs} job(s) · ${a.pieces} pcs` +
        ((a.ids || []).length ? `${BR}${(a.ids || []).join(', ')}` : '') +
        ((a.jobs || 0) > (a.ids || []).length ? `${BR}and ${a.jobs - (a.ids || []).length} more.` : '')
  }),
  /* The only message in the table that is not about something wrong. */
  rem_yl_week: (a) => ({
    ar: `📊 أسبوعكم: ${a.jobs} طلب · ${a.pieces} قطعة` +
        (a.onTime != null ? `${BR}في الموعد: ${a.onTime}%` : '') +
        `${BR}المستحق: ${a.money}`,
    en: `Your week: ${a.jobs} job(s) · ${a.pieces} pcs` +
        (a.onTime != null ? `${BR}On time: ${a.onTime}%` : '') +
        `${BR}Earned: ${a.money}`
  }),
  rem_yl_pay_wait: (a) => ({
    ar: `💵 دفعة ${fmtMoney(a.amount, a.currency)} على ${a.invoiceId} سجّلها OG منذ ${a.hours} ساعة.` +
        `${BR}بانتظار تأكيدكم.`,
    en: `A payment of ${fmtMoney(a.amount, a.currency)} on ${a.invoiceId} was recorded by OG ${a.hours}h ago.` +
        `${BR}Waiting for your confirmation.`
  })
};

/* Kinds whose sentence already names the person, so a signature under it
   would say it twice. */
const ACTOR_INLINE = new Set(['order_accepted', 'order_declined']);

/* WHERE TO TAP. A message that names a job and gives no way to open it makes
   somebody find it by hand on a phone, which is most of the reason the portal
   went unused. #open/job/<id> already exists and already knows which side of
   the line the reader is on, so this only has to build the address.

   The base is shop.public_url, and FALLS BACK TO THE TUNNEL HOSTNAME in
   server/.env — there is no sense in having a public address configured and a
   config row somebody has to remember to fill in with the same string. A LAN
   IP is deliberately never used: Yalla Wear are in a different building. */
/* Where a design picture is worth more than its name. Deliberately short:
   every stage move carrying the artwork again would be the same image four
   times down one chat. */
const PHOTO_KINDS = ['order_new', 'rem_yl_order_waiting'];

const JOB_LINK_KINDS = [
  'order_new', 'order_accepted', 'order_declined', 'stage', 'names_ready',
  'message', 'review', 'rem_yl_order_waiting', 'rem_yl_due', 'rem_yl_due_tomorrow',
  'rem_yl_blocked', 'rem_order_no_answer', 'rem_job_late', 'rem_job_stuck'];

function publicBase() {
  const set = cfg('shop.public_url');
  if (set) {
    let b = String(set).trim();
    while (b.length && (b[b.length - 1] === '/' || b[b.length - 1] === '#')) b = b.slice(0, -1);
    return b;
  }
  const host = maybe('OG_CF_HOSTNAME');
  if (!host) return null;
  let h = String(host).trim();
  if (h.indexOf('://') > -1) h = h.slice(h.indexOf('://') + 3);
  while (h.length && h[h.length - 1] === '/') h = h.slice(0, -1);
  return h ? 'https://' + h : null;
}

function linkFor(kind, a) {
  const base = publicBase();
  if (!base) return null;
  if (a && a.id && JOB_LINK_KINDS.indexOf(kind) > -1) {
    return base + '/#open/job/' + encodeURIComponent(a.id);
  }
  return base;
}

function render(kind, args) {
  const a = args || {};
  const fn = TEMPLATES[kind];
  const t = fn ? fn(a) : { ar: kind, en: JSON.stringify(a) };
  const link = linkFor(kind, a);

  /* Who did it, on its own line. Both companies are more than one person —
     Yalla Wear is Zaven and Zohrab, the shop is whoever is at the till — and
     a chat that only ever says "Yalla Wear" cannot be replied to. Absent for
     anything the server did by itself: the reminders have no actor, and a
     name invented for them would be a lie in somebody's pocket. */
  const sig = a.actor && !ACTOR_INLINE.has(kind) ? `\n— ${a.actor}` : '';

  return t.ar + '\n' + t.en + sig + (link ? `\n${link}` : '');
}

/* ---- THE BUTTONS UNDER A MESSAGE ------------------------------------------
   Only where the answer is one tap and the alternative is opening a portal on
   a phone: accepting the order somebody is being nagged about, and silencing
   the nagging. Nothing else, and deliberately:

   A LINKED CHAT CARRIES NO SESSION. Whoever is in that Telegram group can
   press whatever is drawn there, and there is no per-user permission behind
   it to appeal to — the chat's SIDE is the whole authorisation. That is
   defensible for accept/decline, which is a decision the partner side is
   entitled to make and which is recorded with the name of the Telegram
   account that pressed it. It is not defensible for money, a stage move or a
   void, so none of those get a button.

   callback_data is capped at 64 bytes by Telegram, so it is a verb and an id
   and nothing else. */
/* THE JOB QUEUE, WALKED FROM THE CHAT.

   The stage a job is on decides the button, so this reads the job LIVE rather
   than trusting args — a row queued an hour ago knows the stage it had then,
   and offering "start printing" on a job already out for delivery is worse
   than offering nothing. One indexed read per row.

   Only ONE button, always: the next step. A row of four stages is a row of
   three ways to get it wrong with a thumb, and going backwards is a decision
   that belongs on a screen where you can see the history you are about to
   drop. setStage refuses the rest anyway.

   reminders.chat_stage_moves is the way to close this door again without a
   deploy, because it IS a write door on a channel with no session behind it. */
const STAGE_FLOW = { sent: 'printing', printing: 'delivery', delivery: 'done' };
const STAGE_BTN = {
  printing: '🖨 ابدأ الطباعة · Start printing',
  delivery: '🚚 خرج للتسليم · Out for delivery',
  done:     '✅ تم · Done'
};
const JOB_KINDS = [
  'order_new', 'rem_yl_order_waiting', 'rem_yl_due', 'rem_yl_blocked',
  'stage', 'names_ready', 'message'];

export function stageKeyboardFor(jobId) {
  if (cfg('reminders.chat_stage_moves') === '0') return null;
  let row = null;
  try {
    row = DB.get().prepare(
      'SELECT id, stage, order_state FROM print_jobs WHERE id = ?').get(String(jobId));
  } catch { return null; }
  if (!row) return null;

  /* Still unanswered: that is Accept/Decline’s job, not a stage move. */
  if (row.order_state === 'pending') {
    return { inline_keyboard: [[
      { text: '✅ قبول · Accept', callback_data: 'ok:' + row.id },
      { text: '✖ رفض · Decline', callback_data: 'no:' + row.id }
    ]] };
  }
  if (row.order_state !== 'accepted') return null;
  const next = STAGE_FLOW[row.stage];
  if (!next) return null;
  return { inline_keyboard: [[
    { text: STAGE_BTN[next], callback_data: 'st:' + row.id + ':' + next }
  ]] };
}

function keyboardFor(side, kind, args) {
  const a = args || {};
  if (side === 'yalla' && a.id && JOB_KINDS.indexOf(kind) > -1) {
    const k = stageKeyboardFor(a.id);
    if (k) return k;
  }
  if (kind.indexOf('rem_') === 0) {
    return { inline_keyboard: [[{ text: '🔕 ساعتين · Mute 2h', callback_data: 'mute:2' }]] };
  }
  return null;
}

/* ---------------------------------------------------------------- sending */

async function drain() {
  if (sending) return;
  sending = true;
  try {
    const d = DB.get();
    const rows = d.prepare(
      `SELECT * FROM partner_events
        WHERE channel = 'telegram' AND sent_at IS NULL AND attempts < ?
          AND (next_try_at IS NULL OR next_try_at <= ?)
        ORDER BY id LIMIT ?`
    ).all(MAX_ATTEMPTS, nowIso(), BATCH);

    /* Read once per pass, not once per row: it is a config read plus a
       JSON.parse, and a batch of twenty rows was doing twenty of them. Kept
       per side, and re-read below when a 403 drops a chat out from under it. */
    const lists = {};
    const listFor = (side) => (lists[side] || (lists[side] = chats(side)));
    const stalled = {};

    for (const row of rows) {
      const side = row.audience;
      if (stalled[side]) continue;
      const list = listFor(side);
      /* Not configured is not a failure: the row waits, unbumped, for the
         day somebody links a chat. */
      if (!token(side) || !list.length) continue;

      /* WHO ON THIS SIDE ASKED FOR THIS KIND, and is this row for them. The
         one place both the reminders and the real-time events pass through,
         so there is exactly one copy of the rule. */
      const nowMs = Date.now();
      const wanted = list.filter((c) => wants(c, row.kind) && addressed(c, row.to_user));
      const targets = wanted.filter((c) => !mutedNow(c, row.kind, nowMs));

      /* THREE WAYS TO HAVE NO TARGET, AND THEY ARE NOT THE SAME THING.

         MUTED is temporary, so the row PARKS: next_try_at set to when the
         quietest of them wakes up, sent_at untouched, attempts NOT bumped.
         Marking it sent would spend the occasion for ever — the row IS the
         ledger — so a two-hour mute at five past nine would permanently eat
         that evening's close. Bumping attempts would burn the twelve-attempt
         wall in about three hours against a mute that may run for seventy-two,
         and the row would then show as failed. */
      if (wanted.length && !targets.length) {
        const wake = Math.min(...wanted.map((c) => Date.parse(c.mutedUntil) || 0));
        DB.tx((db) => {
          db.prepare('UPDATE partner_events SET next_try_at = ?, error = ? WHERE id = ?')
            .run(new Date(wake).toISOString(), 'every subscribed chat is muted', row.id);
        });
        continue;
      }

      /* NOBODY WANTED IT, and that is not a failure to retry. Left to the
         branch below, `landed === 0` would back this row off and try again
         every few seconds until the twelfth attempt — a request a second for
         a message no chat has asked for. Marked sent, with the reason, so the
         Telegram card can say so rather than showing a mysterious backlog.
         The scheduler now asks canReach() BEFORE queueing a reminder, so a
         row reaching here is a real-time event or a subscription that changed
         under it — not the ordinary case it used to be. */
      if (!targets.length) {
        DB.tx((db) => {
          db.prepare('UPDATE partner_events SET sent_at = ?, error = ? WHERE id = ?')
            .run(nowIso(), row.to_user != null
                   ? 'nobody on this side is addressed by this row'
                   : 'no chat on this side is subscribed to ' + row.kind, row.id);
        });
        continue;
      }

      let args = {};
      try { args = JSON.parse(row.args_json); } catch { /* an unreadable row still gets a line */ }
      const text = render(row.kind, args);
      const markup = keyboardFor(side, row.kind, args);
      /* A PICTURE WHERE THERE IS ONE. Telegram fetches the URL itself, which
         is why the bucket is public — and why this is a photo with a caption
         rather than a link the reader has to decide to open. Only where the
         picture is the point: an order being placed, and the nudge that it is
         still unanswered. A caption is capped at 1024 characters, comfortably
         above anything TEMPLATES writes.

         If sendPhoto fails the row falls back to the words on the next
         attempt, because a design that will not load must not cost them the
         order. */
      const photo = (args && args.image && PHOTO_KINDS.indexOf(row.kind) > -1)
        ? String(args.image) : null;

      /* EVERY linked chat gets it, and one refusing does not rob the others.
         The row is marked sent when at least one landed: retrying the whole
         row to reach the one that failed would send a SECOND copy to every
         chat that already has it, and a duplicate "order accepted" is worse
         than a missing one on a phone that has blocked the bot. */
      let landed = 0;
      const failures = [];
      for (const c of targets) {
        try {
          if (photo && row.attempts === 0) {
            await call(side, 'sendPhoto', Object.assign(
              { chat_id: c.id, photo, caption: text },
              markup ? { reply_markup: markup } : null));
          } else {
            await call(side, 'sendMessage', Object.assign(
              { chat_id: c.id, text, disable_web_page_preview: true },
              markup ? { reply_markup: markup } : null));
          }
          landed++;
        } catch (e) {
          failures.push(`${c.title}: ${e.message}`);
          /* 403 is Telegram being definite — the bot was blocked, or kicked
             from the group. That chat will never accept another message, so
             it comes off the list rather than failing for ever and burning a
             request per event. Anything else is left to retry. */
          if (e.status === 403) {
            removeChat(side, c.id);
            /* The hoisted list is now stale for this side, and its command
               menu outlives the link unless it is taken away with it. */
            delete lists[side];
            dropCommands(side, c.id).catch(() => {});
            console.log(`  Telegram: ${side} dropped ${c.title} — the bot was blocked or removed there`);
          }
          if (e.retryAfter) await new Promise((r) => setTimeout(r, (Number(e.retryAfter) + 1) * 1000).unref());
        }
      }

      if (landed) {
        DB.tx((db) => {
          db.prepare('UPDATE partner_events SET sent_at = ?, error = ? WHERE id = ?')
            .run(nowIso(), failures.length ? failures.join('; ').slice(0, 300) : null, row.id);
        });
        last.okAt = nowIso(); last.sent += landed;
        last.error = failures.length ? `${side}: ${failures[0]}` : null;
        if (bots[side]) { bots[side].lastOkAt = last.okAt; bots[side].lastError = failures[0] || null; }
      } else {
        const attempts = row.attempts + 1;
        const waitS = Math.min(3600, 5 * 2 ** attempts);
        const next = new Date(Date.now() + waitS * 1000).toISOString();
        DB.tx((db) => {
          db.prepare(
            'UPDATE partner_events SET attempts = ?, next_try_at = ?, error = ? WHERE id = ?'
          ).run(attempts, next, (failures.join('; ') || 'no chat accepted it').slice(0, 300), row.id);
        });
        last.error = `${side}: ${failures[0] || 'not delivered'}`;
        if (bots[side]) bots[side].lastError = failures[0] || null;
        /* Nothing landed, so the next row FOR THIS SIDE would fail the same
           way — but only for this side. The batch is ordered by id across both
           audiences, so breaking outright let one unreachable OG chat stall
           Yalla Wear's queue behind it. */
        stalled[side] = true;
      }
    }
  } catch (e) {
    last.error = e.message;
  } finally {
    sending = false;
  }
}

/* ---------------------------------------------------------------- linking */

function newCode() {
  /* No 0/O/1/I — this is read off one screen and typed into another. */
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}

/* ONE CODE PER PERSON, NOT PER SIDE, and that was a real bug rather than a
   refinement. `codes[side]` was a single record, so a second person pressing
   Connect inside the ten minutes was handed THE FIRST PERSON'S CODE — and
   addChat then stamped their chat with the first person's name and id. While a
   chat's owner was only a subtitle that was merely confusing. Now that the
   owner decides what the phone receives and which messages are addressed to
   it, it would hand somebody else's preset to the wrong phone, and the first
   person's own attempt would fail as "already linked" — reading as a bug
   rather than as the theft it was.

   Keyed on (side, userId): two people can be linking at once, each sees their
   own code, and each chat is stamped with the person who actually sent it. */
const codeKey = (side, byId) => side + ':' + (byId == null ? 'anon' : Number(byId));

export function linkCode(side, byName, byId) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  if (!token(side)) throw Object.assign(new Error('no bot token is set for this side'), { code: 'not_configured' });
  const key = codeKey(side, byId);
  const live = codes[key];
  if (live && live.expires > Date.now()) {
    return { code: live.code, expires: new Date(live.expires).toISOString(), bot: bots[side] && bots[side].username };
  }
  codes[key] = { code: newCode(), expires: Date.now() + CODE_TTL_MS, side,
                 by: byName || null, byId: byId == null ? null : Number(byId) };
  return { code: codes[key].code, expires: new Date(codes[key].expires).toISOString(),
           bot: bots[side] && bots[side].username };
}

/* Which live code, if any, this text is — searched across everybody currently
   linking on this side, because the code no longer belongs to the side.
   Expired entries are dropped on the way past rather than on a timer. */
function spendCode(side, text) {
  const now = Date.now();
  for (const key of Object.keys(codes)) {
    const c = codes[key];
    if (!c || c.expires <= now) { delete codes[key]; continue; }
    if (c.side !== side) continue;
    if (c.code === text) { delete codes[key]; return c; }
  }
  return null;
}

/* One chat off the list, or - with no id - every one of them. The id is
   asked for so "disconnect" on a card with four chats on it cannot mean all
   four by accident; the no-id form stays for a real "stop sending anywhere". */
export function unlink(side, chatIdToDrop) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  /* Captured before the removal, because the all-form has nothing left to
     read afterwards and the menu still has to be taken off those chats. */
  const had = chats(side).map((c) => c.id);
  if (chatIdToDrop) {
    const r = removeChat(side, chatIdToDrop);
    if (!r.removed) throw Object.assign(new Error('That chat is not linked.'), { code: 'not_found' });
    dropCommands(side, chatIdToDrop).catch(() => {});
  } else {
    setChats(side, []);
    for (const id of had) dropCommands(side, id).catch(() => {});
  }
  return status()[side];
}

function chatTitle(chat) {
  if (!chat) return '';
  if (chat.title) return chat.title;
  return [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
}

async function handleUpdate(side, u) {
  /* A BUTTON PRESS IS NOT A MESSAGE. It arrives as a callback_query with its
     own id, and Telegram spins that button until the id is answered — so the
     answer goes out whatever happens, including on the way out of a failure.
     Routed to the same file as the commands, because it is the same question:
     is this chat linked, and what is this side allowed to do. */
  if (u.callback_query) {
    const q = u.callback_query;
    const chat = q.message && q.message.chat;
    if (!chat) return;
    let note = null;
    try {
      note = await Commands.press({
        side, chat, data: String(q.data || ''), from: q.from,
        linked: isLinked(side, chat.id),
        /* So a stage move can advance the button it was pressed on, rather
           than leaving "Start printing" sitting under a job that is now
           printing — a stale button is an invitation to press it again. */
        msgId: q.message && q.message.message_id
      });
    } catch (e) {
      note = e.message;
      if (bots[side]) bots[side].lastError = e.message;
    }
    await call(side, 'answerCallbackQuery',
      { callback_query_id: q.id, text: note || '' }).catch(() => {});
    return;
  }

  const msg = u.message || u.channel_post;
  if (!msg || !msg.chat) return;
  const text = String(msg.text || '').trim();
  const chat = msg.chat;

  /* "/start ABC123" from a deep link, or the bare code typed in. */
  const m = text.match(/^\/start(?:@\w+)?\s+([A-Z0-9]{6})$/i) || text.match(/^([A-Z0-9]{6})$/i);
  /* Spent as it is found, so two people cannot ride one code — each asks for
     their own, and each chat is stamped with the person who actually sent it. */
  const live = m ? spendCode(side, m[1].toUpperCase()) : null;
  if (live) {
    /* ADDED to the list, not put in place of it - this is how a second phone
       or a second group joins. */
    const r = addChat(side, chat, live.by, live.byId);
    const n = r.list.length;
    await call(side, 'sendMessage', {
      chat_id: chat.id,
      text: r.already
        ? '✅ هذه المحادثة مرتبطة أصلاً.' + BR + 'This chat is already linked.'
        : (side === 'og'
            ? '✅ تم الربط — ستصل تنبيهات نظام OG إلى هنا. (' + n + ')' + BR +
              'Linked - OG System notifications will arrive here. (' + n + ' linked)'
            : '✅ تم الربط — ستصل طلبات OG وتحديثاتها إلى هنا. (' + n + ')' + BR +
              'Linked - orders and updates from OG will arrive here. (' + n + ' linked)')
    }).catch(() => {});
    /* THE TUTORIAL GOES OUT HERE, not only when somebody thinks to type
       /help. This is the one moment the person is certainly holding the phone
       and looking at it; a bot that explains itself a week later, to somebody
       who has already decided it only buzzes, explains itself to nobody.
       Second message rather than a longer first one, so the "it worked" line
       stays a glance and the lesson is scrollable underneath it.
       And the command menu is published to this chat now that it exists. */
    syncCommands(side).catch(() => {});
    if (!r.already) {
      await call(side, 'sendMessage', {
        chat_id: chat.id, text: Commands.welcomeText(side, true), disable_web_page_preview: true
      }).catch(() => {});
    }
    return;
  }

  /* THE COMMANDS. `linked` is handed over rather than looked up there,
     because the linked-chat list is the whole authorisation story for a
     channel that carries no session — see telegram-commands.js. */
  try {
    if (await Commands.handle({ side, chat, text, msg, linked: isLinked(side, chat.id) })) return;
  } catch (e) {
    if (bots[side]) bots[side].lastError = e.message;
  }

  if (/^\/start/i.test(text)) {
    await call(side, 'sendMessage', {
      chat_id: chat.id,
      text: side === 'og'
        ? 'أرسل رمز الربط الظاهر في الإعدادات ← تيليغرام.\nSend the link code shown in Settings → Telegram.'
        : 'أرسل رمز الربط الظاهر في بوابة يلا وير.\nSend the link code shown in your Yalla Wear portal.'
    }).catch(() => {});
  }
}

async function pollLoop(side) {
  const b = bots[side];
  while (b.polling) {
    try {
      const updates = await call(side, 'getUpdates',
        /* callback_query is asked for now and used by nothing: a button in a
           phase-2 reply is otherwise silently undelivered, and the bug looks
           like the button rather than the poll. */
        { offset: b.offset, timeout: POLL_TIMEOUT_S,
          allowed_updates: ['message', 'channel_post', 'callback_query'] },
        (POLL_TIMEOUT_S + 10) * 1000);
      for (const u of updates) {
        b.offset = u.update_id + 1;
        try { await handleUpdate(side, u); } catch (e) { b.lastError = e.message; }
      }
      b.lastError = null;
    } catch (e) {
      b.lastError = e.message;
      /* A conflict (409) means another process is polling this token — a
         second copy of the server, or a webhook left set. Back off hard. */
      await new Promise((r) => setTimeout(r, e.status === 409 ? 60000 : 5000).unref());
    }
  }
}

/* --------------------------------------------------------------- lifecycle */

export function isConfigured() { return SIDES.some((s) => !!token(s)); }

/* Is this chat one of the ones this side sends to? THE LINKED LIST IS THE
   AUTHORISATION — a Telegram chat carries no session, so there is nothing
   else to check a command against. Exported for lib/telegram-commands.js. */
export function isLinked(side, chatId) {
  return chats(side).some((c) => String(c.id) === String(chatId));
}

/* THE BLUE MENU BUTTON — Telegram's own way of teaching a bot, and the only
   one a person finds without being told. setMyCommands fills the "/" list
   and the typeahead.
   SCOPED PER CHAT, never the default scope. The default publishes the list to
   everyone who ever opens the bot, and the linked-chat list being the whole
   authorisation is worth rather more than the convenience: a stranger sees an
   empty menu, and the people who linked see the commands appear the moment
   they do. It also means the list is right per side without a second call.
   Every failure is swallowed: a menu is a courtesy, and a bot that refuses to
   start because Telegram would not take a list of eight words is worse than
   one with no menu. */
async function syncCommands(side) {
  if (!token(side) || typeof Commands.menuFor !== 'function') return;
  /* Two sets, because setMyCommands takes a language_code and a phone set to
     Arabic is the common case in this shop. The default set is the English
     one — Telegram falls back to it for every other language. */
  const sets = [{ commands: Commands.menuFor(side, 'en') },
                { commands: Commands.menuFor(side, 'ar'), language_code: 'ar' }];
  for (const c of chats(side)) {
    for (const s of sets) {
      await call(side, 'setMyCommands',
        Object.assign({ scope: { type: 'chat', chat_id: c.id } }, s)).catch(() => {});
    }
  }
}

/* Taking the menu away with the messages. A chat that was disconnected but
   kept a list of commands that all answer "send your link code" is a bot
   that looks like it is ignoring you. */
async function dropCommands(side, chatId) {
  if (!token(side)) return;
  const scope = { type: 'chat', chat_id: String(chatId) };
  /* Both sets: a language_code set is a separate record, and deleting only
     the default leaves an Arabic phone with a menu for a chat that no longer
     answers. */
  await call(side, 'deleteMyCommands', { scope }).catch(() => {});
  await call(side, 'deleteMyCommands', { scope, language_code: 'ar' }).catch(() => {});
}

/* One rendered message to one chat, for a reply rather than a broadcast.
   Goes through render() so a phase-2 command inherits the plain-text,
   Arabic-first rule instead of growing a second formatter. */
/* A command's answer is assembled from live numbers and has no fixed shape to
   name, so it arrives already written. Still goes through here rather than a
   fetch of its own, so there is one place that knows about parse_mode (there
   is none, deliberately) and the link preview. */
export function sendPlain(side, chatId, text) {
  return call(side, 'sendMessage',
    { chat_id: chatId, text: String(text), disable_web_page_preview: true });
}

/* Replace the buttons under a message already sent. Telegram takes a missing
   reply_markup as "clear them", which is exactly what a finished job wants.
   Failure is swallowed by the caller: the move already happened, and a chat
   that cannot be edited (too old, deleted) must not turn a successful write
   into an error message. */
export function editKeyboard(side, chatId, messageId, markup) {
  return call(side, 'editMessageReplyMarkup', {
    chat_id: chatId, message_id: messageId,
    reply_markup: markup || { inline_keyboard: [] }
  });
}

export function send(side, chatId, kind, args) {
  return call(side, 'sendMessage', {
    chat_id: chatId, text: render(kind, args), disable_web_page_preview: true
  });
}

/* The words a queued row would turn into, without queueing it. What the
   reminder preview draws — a list of rule names is not something anybody can
   judge, and the whole point of the preview is reading the message before the
   shop does. */
export function renderFor(kind, args) { return render(kind, args); }

/* Whether anything queued for this side could actually leave the building.
   The scheduler asks before it does a night's work computing rows that would
   sit unread in a table — and says so, rather than looking healthy. */
export function canReach(side, opts) {
  if (!token(side)) return false;
  const list = chats(side);
  if (!list.length) return false;
  if (!opts || !opts.kind) return true;

  /* ASKED ABOUT THE KIND, not just about the side. Without this a rule that
     no chat subscribes to was queued anyway, then swallowed by drain() and
     marked sent — and the row IS the dedupe ledger, so the occasion was spent.
     Subscribe tomorrow and that evening never came back. Asking here instead
     means the key survives and lands the day somebody ticks the box. */
  const wanted = list.filter((c) => wants(c, opts.kind));
  if (!wanted.length) return false;

  /* ADDRESSED TO SOMEBODY WITH NO PHONE. Reported rather than refused, so the
     caller can queue it UNADDRESSED and let whoever runs the shop hear it: a
     standing fact about the shop must not vanish because one person has not
     linked a phone yet. */
  if (opts.toUser != null && !wanted.some((c) => addressed(c, opts.toUser))) return false;
  return true;
}

/* ---- THE ACCOUNT BEHIND A CHAT, FOR THE COMMAND ROUTER --------------------
   A Telegram chat carries no session, so being on the linked list is the whole
   AUTHENTICATION. It is not the whole authorisation: the commands hand over
   the day's takings and the customer's name, and anybody may now link a phone.
   So a command is asked of the account that owns the chat, through the same
   Auth.can the HTTP routes use.

   A GROUP HAS NO OWNER, deliberately — whoever pressed Connect does not own
   the room, and a staff group is wider than any one person's permissions.
   Groups therefore answer only the doorway commands, which is the honest
   reading of a chat whose membership nobody in this system controls. */
export function chatOwner(side, chatId) {
  if (!SIDES.includes(side)) return null;
  const c = chats(side).find((x) => String(x.id) === String(chatId));
  return c ? personOf(c) : null;
}

export function ownerCan(owner, perm) {
  return !!owner && !!owner.active && Auth.can(owner, perm);
}

/* WHAT THIS CHAT MAY ASK FOR — with one grandfather clause, scoped as tightly
   as it can be.

   A PRIVATE chat linked before any of this recorded an account has no owner to
   ask, and the shop's only linked chat is exactly that. Refusing it would take
   every command away from the one phone the bot actually talks to, on the day
   this shipped. It is safe to allow because of WHEN it was linked: until this
   change the routes were gated on config.write, so a chat that already exists
   could only have been put there by somebody who runs the shop.

   The clause is `type === 'private'` and nothing else. A GROUP with no owner
   is refused — a room whose membership nobody in this system controls is the
   case the owner check exists for, and there is no era in which a group was
   safe by default. `status()` reports `ownerless` so the card can say
   "reconnect this chat to give it an owner" rather than leaving it a mystery. */
export function chatAuth(side, chatId) {
  if (!SIDES.includes(side)) return { owner: null, legacy: false, partner: false };
  const c = chats(side).find((x) => String(x.id) === String(chatId));
  if (!c) return { owner: null, legacy: false, partner: false };
  const owner = personOf(c);
  /* ON THE PARTNER'S SIDE THE SIDE IS THE AUTHORISATION, and it always was.
     Every partner account holds exactly the same three permissions, and
     FORBIDDEN in auth.js guarantees none of them can ever be granted money,
     cost, customer or staff; the audience split has already taken the price
     and the customer out of anything queued for them. So there is no gradient
     left for an owning account to narrow — and asking for one broke two things
     at once: a partner holds no print.read, so /queue and /late were refused
     on their own bot, and a GROUP has no person at all, so the shared Yalla
     Wear room could not run a single command.

     The shop's own side keeps the owner check, because there the gradient is
     real — a cashier’s phone must not be told the day’s takings — and an OG
     group is a room that could hold anybody. */
  return { owner, legacy: !owner && c.type === 'private', partner: side === 'yalla' };
}

/* Whether this chat has silenced itself, and until when — for /status, which
   must tell a chat that muted itself from a chat that is quiet because the
   whole side is muted. */
export function chatMutedUntil(side, chatId) {
  if (!SIDES.includes(side)) return null;
  const c = chats(side).find((x) => String(x.id) === String(chatId));
  if (!c || !c.mutedUntil) return null;
  return Date.parse(c.mutedUntil) > Date.now() ? c.mutedUntil : null;
}

/* Is there anybody at all this row could name? Used by the scheduler to
   decide between addressing a reminder and letting it go to the side. */
export function canAddress(side, toUser) {
  if (toUser == null) return false;
  return chats(side).some((c) => c.person != null && Number(c.person) === Number(toUser));
}

export function start() {
  if (timer) return;
  const on = SIDES.filter((s) => token(s));
  if (!on.length) {
    console.log('  Telegram: no bot token set — notifications stay in the app only.');
    return;
  }

  for (const side of on) {
    bots[side] = { username: null, polling: true, offset: 0, lastError: null, lastOkAt: null };
    call(side, 'getMe').then((me) => {
      bots[side].username = me.username;
      const cs = chats(side);
      console.log(`  Telegram: ${side} bot @${me.username} ` +
                  (cs.length
                    ? `→ ${cs.map((c) => c.title).join(', ')}`
                    : '(no chat linked yet)'));
      /* Republished on every boot rather than only at link time: the list
         changes when this file does, and a chat linked before a command
         existed would otherwise never be offered it. Idempotent. */
      syncCommands(side).catch(() => {});
    }).catch((e) => {
      bots[side].lastError = e.message;
      console.log(`  Telegram: ${side} bot could not be reached — ${e.message}`);
    });
    pollLoop(side);
  }

  timer = setInterval(() => { drain().catch(() => {}); }, TICK_MS);
  timer.unref();
}

export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  for (const s of SIDES) if (bots[s]) bots[s].polling = false;
}

/* Send a row straight away — for the Test button, which has a person waiting. */
export async function sendTest(side, chatId) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  if (!token(side)) throw Object.assign(new Error('no bot token is set for this side'), { code: 'not_configured' });
  /* ONE CHAT WHEN ONE IS NAMED. It used to message every chat on the side,
     which was right while only a manager could press Test and wrong the
     moment anybody can: a cashier checking her own phone would buzz the owner
     and every staff group with it. */
  const all = chats(side);
  const list = chatId ? all.filter((c) => String(c.id) === String(chatId)) : all;
  if (!list.length) throw Object.assign(new Error('no chat is linked yet'), { code: 'not_linked' });
  /* Every linked chat, because "does this work" means all of them - and the
     one that fails is named, since that is the one to fix. */
  const bad = [];
  for (const c of list) {
    try { await call(side, 'sendMessage', { chat_id: c.id, text: render('test', {}) }); }
    catch (e) { bad.push(`${c.title}: ${e.message}`); }
  }
  if (bad.length === list.length) throw Object.assign(new Error(bad.join('; ')), { code: 'send_failed' });
  return { ok: true, sent: list.length - bad.length, failed: bad };
}

/* Kick the queue now rather than on the next tick — called after a request
   that just queued something, so a phone buzzes within a second of the tap. */
export function nudge() { if (timer) drain().catch(() => {}); }

/* Drain once and WAIT for it — nudge() is fire-and-forget and only runs when
   the timer is up, which a test harness has no reason to start. */
export function drainNow() { return drain(); }

export function status() {
  const d = DB.get();
  const q = d.prepare(
    `SELECT audience,
            SUM(CASE WHEN sent_at IS NULL AND attempts < ? THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN sent_at IS NULL AND attempts >= ? THEN 1 ELSE 0 END) AS failed
       FROM partner_events WHERE channel = 'telegram' GROUP BY audience`
  ).all(MAX_ATTEMPTS, MAX_ATTEMPTS);
  const byAud = Object.fromEntries(q.map((r) => [r.audience, r]));
  /* The group map rides with the status so the browser draws the tick boxes
     from THIS list and not a second copy of it — the same discipline the
     reminder rule ids follow. A kind added here appears on the screen with
     two i18n strings and no other edit. */
  const out = { running: !!timer, lastOkAt: last.okAt, lastError: last.error, sent: last.sent,
                groups: KIND_GROUPS, allKinds: ALL_KINDS, defaultRules: DEFAULT_RULES,
                kindPerm: KIND_PERM, presets: presetMap() };
  const anyCode = (s) => Object.keys(codes)
    .some((k) => codes[k] && codes[k].side === s && codes[k].expires > Date.now());
  for (const s of SIDES) {
    /* Each row is told what it RESOLVES to, so the browser never has to
       re-run the preset lookup and the two cannot disagree about what a phone
       is actually receiving. */
    const list = chats(s).map((c) => {
      const u = personOf(c);
      return { ...c,
               personName: u ? u.name : null,
               personRole: u ? u.role : null,
               personActive: u ? !!u.active : null,
               /* No account behind it. A private chat from before this was
                  recorded still answers commands (see chatAuth) but the card
                  should say so — re-linking it is what gives it an owner. */
               ownerless: !u,
               /* What that ROLE may do, so the picker can warn beside a box
                  that carries money the account could not open on a screen.
                  No leak: GET /api/roles hands the same matrix to everybody. */
               personPerms: u ? Auth.permissionsFor(u.role) : null,
               effective: effectiveRules(c) };
    });
    out[s] = {
      configured: !!token(s),
      bot: bots[s] ? bots[s].username : null,
      /* `linked` and `chatTitle` are the first chat, kept for anything still
         reading the old shape; `chats` is the truth. */
      linked: list.length > 0,
      chatTitle: (list[0] || {}).title || null,
      chats: list,
      queued: (byAud[s] && byAud[s].queued) || 0,
      failed: (byAud[s] && byAud[s].failed) || 0,
      lastError: bots[s] ? bots[s].lastError : null,
      codeLive: anyCode(s)
    };
  }
  return out;
}
