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
function chats(side) {
  const raw = cfg(`telegram.${side}_chats`);
  if (raw) {
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((c) => c && c.id);
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
    at: c.at || null, by: c.by || null
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

function addChat(side, chat, by) {
  const list = chats(side);
  const id = String(chat.id);
  const entry = { id, title: chatTitle(chat), type: chat.type || 'unknown', at: nowIso(), by: by || null };
  const at = list.findIndex((c) => String(c.id) === id);
  /* Sending the code again from a chat that is already on the list is a
     person checking it still works, not a request for a second copy of every
     message. Refreshed in place, never appended twice. */
  if (at >= 0) { list[at] = { ...list[at], title: entry.title, type: entry.type }; return { list: setChats(side, list), already: true }; }
  list.push(entry);
  return { list: setChats(side, list), already: false };
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
  rem_shift_open: (a) => ({
    ar: `🕙 الوردية ${a.id} ما زالت مفتوحة منذ ${a.hours} ساعة` + (a.by ? ` — ${a.by}` : '') + '.' +
        `${BR}عُدّ الصندوق وأغلقها.`,
    en: `Shift ${a.id} has been open for ${a.hours}h` + (a.by ? ` — ${a.by}` : '') + '.' +
        `${BR}Count the drawer and close it.`
  }),
  rem_cash_variance: (a) => ({
    ar: `⚠️ فرق في الصندوق على الوردية ${a.id}: ${a.diff > 0 ? '+' : ''}${fmtMoney(a.diff, a.currency)}` +
        `${BR}عُدّ ${fmtMoney(a.counted, a.currency)}، والمتوقع ${fmtMoney(a.expected, a.currency)}.`,
    en: `Drawer difference on shift ${a.id}: ${a.diff > 0 ? '+' : ''}${fmtMoney(a.diff, a.currency)}` +
        `${BR}Counted ${fmtMoney(a.counted, a.currency)}, expected ${fmtMoney(a.expected, a.currency)}.`
  }),
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

function render(kind, args) {
  const a = args || {};
  const fn = TEMPLATES[kind];
  const t = fn ? fn(a) : { ar: kind, en: JSON.stringify(a) };
  const link = cfg('shop.public_url');

  /* Who did it, on its own line. Both companies are more than one person —
     Yalla Wear is Zaven and Zohrab, the shop is whoever is at the till — and
     a chat that only ever says "Yalla Wear" cannot be replied to. Absent for
     anything the server did by itself: the reminders have no actor, and a
     name invented for them would be a lie in somebody's pocket. */
  const sig = a.actor && !ACTOR_INLINE.has(kind) ? `\n— ${a.actor}` : '';

  return t.ar + '\n' + t.en + sig + (link ? `\n${link}` : '');
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

    for (const row of rows) {
      const side = row.audience;
      const list = chats(side);
      /* Not configured is not a failure: the row waits, unbumped, for the
         day somebody links a chat. */
      if (!token(side) || !list.length) continue;

      let args = {};
      try { args = JSON.parse(row.args_json); } catch { /* an unreadable row still gets a line */ }
      const text = render(row.kind, args);

      /* EVERY linked chat gets it, and one refusing does not rob the others.
         The row is marked sent when at least one landed: retrying the whole
         row to reach the one that failed would send a SECOND copy to every
         chat that already has it, and a duplicate "order accepted" is worse
         than a missing one on a phone that has blocked the bot. */
      let landed = 0;
      const failures = [];
      for (const c of list) {
        try {
          await call(side, 'sendMessage', { chat_id: c.id, text, disable_web_page_preview: true });
          landed++;
        } catch (e) {
          failures.push(`${c.title}: ${e.message}`);
          /* 403 is Telegram being definite — the bot was blocked, or kicked
             from the group. That chat will never accept another message, so
             it comes off the list rather than failing for ever and burning a
             request per event. Anything else is left to retry. */
          if (e.status === 403) {
            removeChat(side, c.id);
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
        /* Nothing landed anywhere: the next row would fail the same way. */
        break;
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

export function linkCode(side, byName) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  if (!token(side)) throw Object.assign(new Error('no bot token is set for this side'), { code: 'not_configured' });
  const live = codes[side];
  if (live && live.expires > Date.now()) {
    return { code: live.code, expires: new Date(live.expires).toISOString(), bot: bots[side] && bots[side].username };
  }
  codes[side] = { code: newCode(), expires: Date.now() + CODE_TTL_MS, by: byName || null };
  return { code: codes[side].code, expires: new Date(codes[side].expires).toISOString(),
           bot: bots[side] && bots[side].username };
}

/* One chat off the list, or - with no id - every one of them. The id is
   asked for so "disconnect" on a card with four chats on it cannot mean all
   four by accident; the no-id form stays for a real "stop sending anywhere". */
export function unlink(side, chatIdToDrop) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  if (chatIdToDrop) {
    const r = removeChat(side, chatIdToDrop);
    if (!r.removed) throw Object.assign(new Error('That chat is not linked.'), { code: 'not_found' });
  } else {
    setChats(side, []);
  }
  return status()[side];
}

function chatTitle(chat) {
  if (!chat) return '';
  if (chat.title) return chat.title;
  return [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
}

async function handleUpdate(side, u) {
  const msg = u.message || u.channel_post;
  if (!msg || !msg.chat) return;
  const text = String(msg.text || '').trim();
  const chat = msg.chat;

  /* "/start ABC123" from a deep link, or the bare code typed in. */
  const m = text.match(/^\/start(?:@\w+)?\s+([A-Z0-9]{6})$/i) || text.match(/^([A-Z0-9]{6})$/i);
  const live = codes[side];
  if (m && live && live.expires > Date.now() && m[1].toUpperCase() === live.code) {
    /* ADDED to the list, not put in place of it - this is how a second phone
       or a second group joins. The code is spent either way, so two people
       cannot ride one code; each asks for their own. */
    const r = addChat(side, chat, live.by);
    delete codes[side];
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
    return;
  }

  /* PHASE 2's DOOR. The router is a stub that returns false, so nothing
     changes today; what is settled now is where it is called from and what it
     is handed — including `linked`, because the linked-chat list is the whole
     authorisation story for a channel that carries no session. */
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

/* One rendered message to one chat, for a reply rather than a broadcast.
   Goes through render() so a phase-2 command inherits the plain-text,
   Arabic-first rule instead of growing a second formatter. */
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
export function canReach(side) {
  return !!token(side) && chats(side).length > 0;
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
export async function sendTest(side) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  if (!token(side)) throw Object.assign(new Error('no bot token is set for this side'), { code: 'not_configured' });
  const list = chats(side);
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
  const out = { running: !!timer, lastOkAt: last.okAt, lastError: last.error, sent: last.sent };
  for (const s of SIDES) {
    out[s] = {
      configured: !!token(s),
      bot: bots[s] ? bots[s].username : null,
      /* `linked` and `chatTitle` are the first chat, kept for anything still
         reading the old shape; `chats` is the truth. */
      linked: chats(s).length > 0,
      chatTitle: (chats(s)[0] || {}).title || null,
      chats: chats(s),
      queued: (byAud[s] && byAud[s].queued) || 0,
      failed: (byAud[s] && byAud[s].failed) || 0,
      lastError: bots[s] ? bots[s].lastError : null,
      codeLive: !!(codes[s] && codes[s].expires > Date.now())
    };
  }
  return out;
}
