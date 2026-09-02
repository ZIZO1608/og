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

const SIDES = ['og', 'yalla'];
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

function chatId(side) { return cfg(`telegram.${side}_chat_id`); }

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
    ar: `✅ يلا وير قبلت الطلب ${a.id}` + (a.promisedAt ? ` — الوعد بالتسليم ${fmtDate(a.promisedAt)}` : '') + (a.note ? `\n${a.note}` : ''),
    en: `Yalla Wear accepted order ${a.id}` + (a.promisedAt ? ` — promised for ${fmtDate(a.promisedAt)}` : '') + (a.note ? `\n${a.note}` : '')
  }),
  order_declined: (a) => ({
    ar: `❌ يلا وير رفضت الطلب ${a.id}` + (a.note ? `\nالسبب: ${a.note}` : ''),
    en: `Yalla Wear declined order ${a.id}` + (a.note ? `\nReason: ${a.note}` : '')
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
  })
};

function render(kind, args) {
  const fn = TEMPLATES[kind];
  const t = fn ? fn(args || {}) : { ar: kind, en: JSON.stringify(args || {}) };
  const link = cfg('shop.public_url');
  return t.ar + '\n' + t.en + (link ? `\n${link}` : '');
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
      const chat = chatId(side);
      /* Not configured is not a failure: the row waits, unbumped, for the
         day somebody links a chat. */
      if (!token(side) || !chat) continue;

      let args = {};
      try { args = JSON.parse(row.args_json); } catch { /* an unreadable row still gets a line */ }

      try {
        await call(side, 'sendMessage', {
          chat_id: chat, text: render(row.kind, args), disable_web_page_preview: true
        });
        DB.tx((db) => {
          db.prepare('UPDATE partner_events SET sent_at = ?, error = NULL WHERE id = ?')
            .run(nowIso(), row.id);
        });
        last.okAt = nowIso(); last.sent++; last.error = null;
        if (bots[side]) { bots[side].lastOkAt = last.okAt; bots[side].lastError = null; }
      } catch (e) {
        const attempts = row.attempts + 1;
        const waitS = e.retryAfter ? Number(e.retryAfter) + 1 : Math.min(3600, 5 * 2 ** attempts);
        const next = new Date(Date.now() + waitS * 1000).toISOString();
        DB.tx((db) => {
          db.prepare(
            'UPDATE partner_events SET attempts = ?, next_try_at = ?, error = ? WHERE id = ?'
          ).run(attempts, next, String(e.message).slice(0, 300), row.id);
        });
        last.error = `${side}: ${e.message}`;
        if (bots[side]) bots[side].lastError = e.message;
        /* A chat that refuses the bot (blocked, kicked from the group) means
           every later row would fail the same way — stop this batch here. */
        if (e.status === 403 || e.status === 400) break;
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

export function linkCode(side) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  if (!token(side)) throw Object.assign(new Error('no bot token is set for this side'), { code: 'not_configured' });
  const live = codes[side];
  if (live && live.expires > Date.now()) {
    return { code: live.code, expires: new Date(live.expires).toISOString(), bot: bots[side] && bots[side].username };
  }
  codes[side] = { code: newCode(), expires: Date.now() + CODE_TTL_MS };
  return { code: codes[side].code, expires: new Date(codes[side].expires).toISOString(),
           bot: bots[side] && bots[side].username };
}

export function unlink(side) {
  if (!SIDES.includes(side)) throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  setCfg({ [`telegram.${side}_chat_id`]: null, [`telegram.${side}_chat_title`]: null });
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
    setCfg({ [`telegram.${side}_chat_id`]: String(chat.id), [`telegram.${side}_chat_title`]: chatTitle(chat) });
    delete codes[side];
    await call(side, 'sendMessage', {
      chat_id: chat.id,
      text: side === 'og'
        ? '✅ تم الربط — ستصل تنبيهات نظام OG إلى هنا.\nLinked — OG System notifications will arrive here.'
        : '✅ تم الربط — ستصل طلبات OG وتحديثاتها إلى هنا.\nLinked — orders and updates from OG will arrive here.'
    }).catch(() => {});
    return;
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
        { offset: b.offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'channel_post'] },
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
      console.log(`  Telegram: ${side} bot @${me.username} ` +
                  (chatId(side) ? `→ ${cfg(`telegram.${side}_chat_title`) || chatId(side)}` : '(no chat linked yet)'));
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
  const chat = chatId(side);
  if (!chat) throw Object.assign(new Error('no chat is linked yet'), { code: 'not_linked' });
  await call(side, 'sendMessage', { chat_id: chat, text: render('test', {}) });
  return { ok: true };
}

/* Kick the queue now rather than on the next tick — called after a request
   that just queued something, so a phone buzzes within a second of the tap. */
export function nudge() { if (timer) drain().catch(() => {}); }

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
      linked: !!chatId(s),
      chatTitle: cfg(`telegram.${s}_chat_title`),
      queued: (byAud[s] && byAud[s].queued) || 0,
      failed: (byAud[s] && byAud[s].failed) || 0,
      lastError: bots[s] ? bots[s].lastError : null,
      codeLive: !!(codes[s] && codes[s].expires > Date.now())
    };
  }
  return out;
}
