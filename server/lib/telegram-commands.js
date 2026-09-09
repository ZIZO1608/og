/* ==========================================================================
   THE BOT'S EAR — commands and buttons              [telegram-commands.js]
   --------------------------------------------------------------------------
   The bots could only ever talk. This is the half that listens: a person
   holding a phone in the shop can ask what is waiting, instead of walking to
   the till and opening a screen.

   TWO RULES, AND THEY ARE THE WHOLE SECURITY MODEL
   ------------------------------------------------
   1. ONLY A LINKED CHAT IS ANSWERED. A Telegram chat carries no session and
      no account — there is nothing to check a request against except whether
      somebody deliberately linked this chat to this bot. `linked` is computed
      by telegram.js and handed in. An unlinked chat gets the ordinary "send
      your link code" line and never a hint that any of this exists.

      The two DOORWAY commands are the exception, and only just: /start and
      /help answer an unlinked chat with the joining instructions, because a
      Start button that does nothing reads as a broken bot and the person
      pressing it is nearly always the owner with the code on his other
      screen. That answer names no job, no number and no other command — it
      says the bot belongs to a shop, which its name and picture already say.
      The command MENU is scoped per linked chat (telegram.js, syncCommands),
      so a stranger is not even offered the list.

   2. THE SIDE COMES FROM THE BOT, NEVER FROM THE MESSAGE. Which token
      received the update decides the audience, exactly as tgSide() decides it
      from the account's role on the HTTP side. A chat on Yalla Wear's bot
      asking for the shop's takings is answered as Yalla Wear — which is to
      say, not at all.

   READS, AND EXACTLY ONE WRITE
   ----------------------------
   Everything here is a read except accepting or declining an order, which is
   the one thing where the answer is one tap and the alternative is opening a
   portal on a phone. It is a decision the partner side is entitled to make,
   it is recorded in the job's own history with the Telegram name that pressed
   it, and it is refused unless the order is actually pending.

   Nothing else writes. No stage moves, no money, no voids — a chat is a room
   whose membership nobody in this system controls, and the blast radius of a
   wrong tap has to stay at "an order was answered a bit early".

   All replies go out through Telegram.send / sendPlain, so they inherit the
   plain-text, Arabic-then-English rule. No Markdown, ever: a job id like
   P_1043 breaks the parse and the message silently never arrives.
   ========================================================================== */

import * as DB from './db.js';
import * as Telegram from './telegram.js';
import * as Partner from './partner.js';
import * as Reminders from './reminders.js';
import * as Alerts from './alerts.js';
import * as Dashboard from './dashboard.js';
import * as Money from './money.js';

const BR = String.fromCharCode(10);
const cfg = (k) => {
  const r = DB.get().prepare('SELECT value FROM config WHERE key = ?').get(k);
  return r ? r.value : null;
};
/* Nothing here writes config any more: /mute moved to the chat entry, which
   telegram.js owns. This file reads the shop's clock and the side-wide mute,
   and that is all. */

const tz = () => {
  const v = Number(cfg('shop.tz_minutes'));
  return Number.isInteger(v) && Math.abs(v) <= 840 ? v : 180;
};

/* The shop's own day as two UTC instants — the same arithmetic reminders.js
   does, and for the same reason: the server is UTC and Aleppo is not. */
function today() {
  const t = tz();
  const key = new Date(Date.now() + t * 60000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(key + 'T00:00:00Z') - t * 60000).toISOString();
  const to = new Date(Date.parse(key + 'T00:00:00Z') + 86400000 - t * 60000).toISOString();
  return { key, from, to };
}

const money = (n, cur) => {
  const v = Number(n) || 0;
  const s = cur === 'USD' ? (v / 100).toFixed(2) : Math.round(v).toLocaleString('en-US');
  return s + ' ' + (cur || 'SYP');
};

/* Two lines, Arabic then English, exactly like TEMPLATES. Written here rather
   than as template entries because a command's answer is assembled from live
   numbers and has no fixed shape to name. */
const pair = (ar, en) => ar + BR + en;

/* ------------------------------------------------------------------ replies */

async function reply(side, chatId, text) {
  return Telegram.sendPlain(side, chatId, text);
}

/* --------------------------------------------------------------- the answers */

/* THE MENU IS ONE LIST, AND IT IS THIS ONE. It is what /help prints and what
   telegram.js publishes to Telegram with setMyCommands, so the blue Menu
   button and the typed answer can never drift apart. Telegram's own rules:
   the name is lowercase, the description is one line under 256 characters —
   which is why the argument goes in the description ("/job P-1043") rather
   than in the name. Arabic then English, like everything else the bots say. */
export const COMMAND_MENU = {
  og: [
    ['queue',  '',        'الطلبات عند المطبعة',      'what the printer has'],
    ['today',  '',        'مبيعات اليوم والصندوق',    'today\'s takings and the drawer'],
    ['late',   '',        'ما تأخر عن موعده',         'what is overdue'],
    ['job',    'P-1043',  'تفاصيل طلب واحد',          'one job'],
    ['status', '',        'حالة البوت والتذكيرات',    'the bot and the reminders'],
    ['mute',   '2h',      'كتم التذكيرات مؤقتاً',     'pause the reminders'],
    ['unmute', '',        'إعادة التذكيرات',          'turn the reminders back on'],
    ['help',   '',        'ماذا يفعل هذا البوت',      'what this bot can do']
  ],
  yalla: [
    ['queue',  '',        'العمل في اليد',            'work in hand'],
    ['today',  '',        'تسليمات اليوم',            'what is due today'],
    ['late',   '',        'ما تأخر عن موعده',         'what is overdue'],
    ['job',    'P-1043',  'تفاصيل طلب واحد',          'one job'],
    ['status', '',        'حالة البوت',               'the bot'],
    ['mute',   '2h',      'كتم التذكيرات مؤقتاً',     'pause the reminders'],
    ['unmute', '',        'إعادة التذكيرات',          'turn the reminders back on'],
    ['help',   '',        'ماذا يفعل هذا البوت',      'what this bot can do']
  ]
};

/* ==========================================================================
   WHAT THE BOT SAYS ABOUT ITSELF — the empty-chat screen, before Start
   --------------------------------------------------------------------------
   BotFather's /setdescription and /setabouttext write these by hand, in one
   language, and drift from the app the day anything changes. The Bot API can
   set both — with a language_code — so they live here beside the command
   table and go out with `npm run botfather`. One source of truth, and an
   Arabic phone gets Arabic.

   Telegram's own limits, and they are hard: description 512, short 120.
   ========================================================================== */
export const BOT_IDENTITY = {
  og: {
    description: {
      en: 'The OG System shop bot.\n\nIt tells you what is happening — a new print order, Yalla Wear\'s answer, an invoice, a payment — and reminds you what is waiting: the day\'s close, a drawer left open, a size at zero, a job past its deadline.\n\nIt speaks only to chats the shop has linked. Press Start to see how.',
      ar: 'بوت نظام OG.\n\nيخبرك بما يجري — طلب طباعة جديد، ردّ يلا وير، فاتورة، دفعة — ويذكّرك بما ينتظر: إغلاق اليوم، درج بقي مفتوحاً، مقاس نفد، طلب تأخر عن موعده.\n\nلا يتحدث إلا إلى المحادثات التي ربطها المحل. اضغط «ابدأ» لترى كيف.'
    },
    short: {
      en: 'Live notifications and reminders for the people who run the shop.',
      ar: 'تنبيهات فورية وتذكيرات لمن يدير المحل.'
    }
  },
  yalla: {
    description: {
      en: 'Yalla Wear\'s line to OG System.\n\nNew print orders arrive here with an Accept and a Decline button, and it reminds you what is waiting: an order with no answer, a deadline coming, a job stuck with no names on the shirts, and the morning digest.\n\nIt speaks only to chats Yalla Wear has linked. Press Start to see how.',
      ar: 'خط يلا وير مع نظام OG.\n\nتصل الطلبات الجديدة هنا ومعها زرّا «قبول» و«رفض»، ويذكّركم بما ينتظر: طلب بلا ردّ، موعد تسليم يقترب، طلب متوقف بلا أسماء على القمصان، وملخّص الصباح.\n\nلا يتحدث إلا إلى المحادثات التي ربطتموها. اضغطوا «ابدأ» لترَوا كيف.'
    },
    short: {
      en: 'New orders from OG System, and reminders of what is waiting on you.',
      ar: 'طلبات جديدة من نظام OG، وتذكيرات بما ينتظركم.'
    }
  }
};

/* THE PUBLIC MENU — what a stranger who finds the bot is offered, and it is
   deliberately two entries. The full list is published per linked chat
   (telegram.js, syncCommands) and overrides this one for those chats, so the
   people who need the commands get them and nobody else is handed a map of
   the shop. Written into the DEFAULT scope, which is the only scope BotFather
   can reach. */
export const PUBLIC_MENU = {
  en: [{ command: 'start', description: 'what this bot is, and how to link this chat' },
       { command: 'help',  description: 'what this bot can do' }],
  ar: [{ command: 'start', description: 'ما هذا البوت، وكيف تربط هذه المحادثة' },
       { command: 'help',  description: 'ماذا يفعل هذا البوت' }]
};

/* The list as Telegram wants it, in one language. `language_code: 'ar'` is a
   real feature of setMyCommands and a phone set to Arabic is the common case
   in this shop, so both sets are published rather than one bilingual line
   squeezed into a menu row. The example argument rides in the description
   because the command NAME may only be [a-z0-9_]. */
export function menuFor(side, lang) {
  const rows = COMMAND_MENU[side] || COMMAND_MENU.og;
  const ar = lang === 'ar';
  return rows.map((r) => ({
    command: r[0],
    description: (ar ? r[2] : r[3]) + (r[1] ? '  —  /' + r[0] + ' ' + r[1] : '')
  }));
}

/* The same list as a person reads it, in one language, with the argument
   shown where they will type it. */
const menuLines = (side, ar) => (COMMAND_MENU[side] || COMMAND_MENU.og)
  .map((r) => '/' + r[0] + (r[1] ? ' ' + r[1] : '') + ' — ' + (ar ? r[2] : r[3]))
  .join(BR);

/* WHAT ARRIVES HERE WITHOUT BEING ASKED — the half of the bot nobody types.
   A person who only ever sees the command list assumes the bot is a search
   box and mutes it the first time it speaks on its own. */
const ARRIVES = {
  og: {
    ar: ['• الأخبار فور وقوعها — ردّ يلا وير على طلب، مرحلة تحرّكت، فاتورة، دفعة',
         '• التذكيرات — إغلاق اليوم، الدرج ما زال مفتوحاً، مقاس نفد، طلب تأخر'],
    en: ['- News as it happens - Yalla Wear answered an order, a stage moved, an invoice, a payment',
         '- Reminders - the day\'s close, the drawer still open, a size at zero, a job overdue']
  },
  yalla: {
    ar: ['• الطلبات الجديدة من OG، ومعها زرّا «قبول» و«رفض»',
         '• التذكيرات — طلب ينتظر ردّكم، موعد تسليم يقترب، طلب متوقف بلا أسماء، ملخّص الصباح'],
    en: ['- New orders from OG, each with an Accept and a Decline button',
         '- Reminders - an order waiting on your answer, a deadline coming, a job stuck with no names, the morning digest']
  }
};

/* The tutorial. Sent on /start and on /help, and pushed once by telegram.js
   the moment a chat links — which is the only moment somebody is certainly
   holding the phone and reading it. */
function tutorialText(side) {
  const a = ARRIVES[side] || ARRIVES.og;
  const chose = side === 'og'
    ? ['ماذا تستقبل هذه المحادثة بالضبط؟ يختاره المدير من:',
       'نظام OG ← الإعدادات ← تيليغرام ← «اختر»']
    : ['ماذا تستقبل هذه المحادثة بالضبط؟ تختارونه من:',
       'بوابة يلا وير ← بطاقة تيليغرام ← «اختر»'];
  const choseEn = side === 'og'
    ? ['What this chat gets is chosen in:', 'OG System - Settings - Telegram - Choose']
    : ['What this chat gets is chosen in:', 'Your Yalla Wear portal - the Telegram card - Choose'];

  const ar = [
    side === 'og' ? '🟢 بوت نظام OG' : '🟢 بوت يلا وير',
    'هذه المحادثة مرتبطة. يصلك هنا:',
    a.ar.join(BR),
    'الأوامر:' + BR + menuLines(side, true),
    'الأزرار: تحت كل تذكير زر «كتم ساعتين»' +
      (side === 'yalla' ? '، وتحت كل طلب جديد «قبول» و«رفض».' : '.'),
    chose.join(BR),
    'اكتب / لترى قائمة الأوامر في تيليغرام.'
  ].join(BR + BR);

  const en = [
    side === 'og' ? 'OG System bot' : 'Yalla Wear bot',
    'This chat is linked. What arrives here:',
    a.en.join(BR),
    'Commands:' + BR + menuLines(side, false),
    'Buttons: every reminder carries Mute 2h' +
      (side === 'yalla' ? ', and every new order carries Accept and Decline.' : '.'),
    choseEn.join(BR),
    'Type / to see the command menu in Telegram.'
  ].join(BR + BR);

  return ar + BR + BR + '———' + BR + BR + en;
}

/* An UNLINKED chat gets this and nothing else. It says what the bot is and
   how to join it, and deliberately does not list the commands or say what
   they answer: the linked list is the whole authorisation, so a stranger who
   found the bot learns only that it belongs to a shop, which its name and
   picture already say. */
function joinText(side) {
  const steps = side === 'og'
    ? { ar: ['١) افتح نظام OG ← الإعدادات ← تيليغرام',
             '٢) اضغط «ربط» — يظهر رمز من ٦ خانات، صالح ١٠ دقائق',
             '٣) أرسل الرمز هنا'],
        en: ['1) Open OG System - Settings - Telegram',
             '2) Press Connect - a six-letter code appears, good for 10 minutes',
             '3) Send that code here'] }
    : { ar: ['١) افتح بوابة يلا وير ← بطاقة تيليغرام',
             '٢) اضغط «ربط» — يظهر رمز من ٦ خانات، صالح ١٠ دقائق',
             '٣) أرسل الرمز هنا'],
        en: ['1) Open your Yalla Wear portal - the Telegram card',
             '2) Press Connect - a six-letter code appears, good for 10 minutes',
             '3) Send that code here'] };
  return [
    '👋 ' + (side === 'og' ? 'أهلاً بك في بوت نظام OG.' : 'أهلاً بكم في بوت يلا وير.'),
    'هذه المحادثة غير مرتبطة بعد، ولن يصلها شيء.',
    'للربط:' + BR + steps.ar.join(BR),
    'في مجموعة: أرسل /start ثم الرمز — مع الشرطة المائلة.',
    'بعد الربط ستصلك رسالة تشرح كل شيء.'
  ].join(BR + BR) + BR + BR + '———' + BR + BR + [
    side === 'og' ? 'Welcome to the OG System bot.' : 'Welcome to the Yalla Wear bot.',
    'This chat is not linked yet, so nothing will arrive here.',
    'To link it:' + BR + steps.en.join(BR),
    /* Said here as well as on the card, because this is the message the
       person is looking at when they are standing in the group. */
    'In a group: send /start followed by the code - with the slash.',
    'Once it is linked you will get a message explaining the rest.'
  ].join(BR + BR);
}

/* Exported so telegram.js can push the tutorial the instant a chat links. */
export function welcomeText(side, linked) {
  return linked ? tutorialText(side) : joinText(side);
}

/* Work in hand. Partner.stats is the same figure the production report and
   the morning digest use, so the three can never disagree. */
function queueText(side) {
  const s = Partner.stats(tz(), { money: false });
  const pending = DB.get().prepare(
    "SELECT COUNT(*) AS n FROM print_jobs WHERE order_state = 'pending'"
  ).get().n;
  const late = Alerts.jobsLateCount({ basis: side === 'yalla' ? 'promise' : 'deadline',
                                      acceptedOnly: side === 'yalla' });
  return pair(
    `📋 في اليد: ${s.open.jobs} طلب (${s.open.pieces} قطعة)` + BR +
      `بانتظار الرد: ${pending}` + BR + `متأخر: ${late}`,
    `In hand: ${s.open.jobs} job(s), ${s.open.pieces} pcs` + BR +
      `Waiting on an answer: ${pending}` + BR + `Overdue: ${late}`
  );
}

/* The shop's day for OG; the press's day for Yalla Wear. The two sides are
   asking genuinely different questions with the same word. */
function todayText(side) {
  const d = today();
  if (side === 'yalla') {
    const s = Partner.stats(tz(), { money: false });
    return pair(
      `📅 اليوم ${d.key}` + BR + `طلبات في اليد: ${s.open.jobs} (${s.open.pieces} قطعة)` + BR +
        `أُنجز اليوم: ${s.today.jobs} (${s.today.pieces} قطعة)`,
      `Today ${d.key}` + BR + `In hand: ${s.open.jobs} (${s.open.pieces} pcs)` + BR +
        `Finished today: ${s.today.jobs} (${s.today.pieces} pcs)`
    );
  }
  const t = Dashboard.takingsIn(d.from, d.to);
  const open = Money.currentShift();
  const sh = open ? Money.shift(open.id) : null;
  const sales = money(t.takings.syp, 'SYP') + (t.takings.usd ? ' + ' + money(t.takings.usd, 'USD') : '');
  return pair(
    `📊 اليوم ${d.key}` + BR + `المبيعات: ${sales}` + BR + `${t.count} فاتورة` +
      (sh ? BR + `المتوقع في الدرج: ${money(sh.expected, sh.currency)}` : ''),
    `Today ${d.key}` + BR + `Sales: ${sales}` + BR + `${t.count} invoice(s)` +
      (sh ? BR + `Expected in the drawer: ${money(sh.expected, sh.currency)}` : '')
  );
}

/* Overdue, on the basis the side is judged by — the shop's own deadline for
   the shop, the printer's own promise for the printer. The same split
   Alerts.jobsLate takes an option for, and the same reason. */
function lateText(side) {
  const basis = side === 'yalla' ? 'promise' : 'deadline';
  const rows = Alerts.jobsLate({ limit: 8, basis, acceptedOnly: side === 'yalla' });
  if (!rows.length) return pair('✅ لا شيء متأخر.', 'Nothing is overdue.');
  const t = tz();
  const dayNum = (iso) => {
    const s = String(iso);
    return s.length === 10 ? Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000)
                           : Math.floor((Date.parse(s) + t * 60000) / 86400000);
  };
  const nowDay = Math.floor((Date.now() + t * 60000) / 86400000);
  const lines = rows.map((r) => `${r.id} — ${Math.max(0, nowDay - dayNum(r.due))}d — ${r.stage}`);
  return pair('🔴 متأخر:', 'Overdue:') + BR + lines.join(BR);
}

/* One job. The partner never receives the customer or the price — the same
   strip list GET /api/partner applies, restated here rather than assumed,
   because this is a different door into the same row. */
function jobText(side, id, maySeeCustomer) {
  const j = Partner.job(id);
  if (!j) return pair(`لا يوجد طلب ${id}.`, `No job ${id}.`);
  const bits = [
    `${j.id} — ${j.design}`,
    `${j.qty} قطعة · ${j.stage} · ${j.order_state}`,
    j.deadline ? `التسليم: ${String(j.deadline).slice(0, 10)}` : null,
    j.order_promised_at ? `وُعد به: ${String(j.order_promised_at).slice(0, 10)}` : null,
    j.tbc ? `${j.tbc} قميص بلا اسم` : null
  ];
  const en = [
    `${j.id} — ${j.design}`,
    `${j.qty} pcs · ${j.stage} · ${j.order_state}`,
    j.deadline ? `Due: ${String(j.deadline).slice(0, 10)}` : null,
    j.order_promised_at ? `Promised: ${String(j.order_promised_at).slice(0, 10)}` : null,
    j.tbc ? `${j.tbc} shirt(s) with no name` : null
  ];
  /* TWO GATES, not one. The side decides whether the customer may cross to
     another company at all; the owning account decides whether this
     particular phone may see it — a warehouse phone holds no customer.read,
     and a staff group is wider than customer.read whoever linked it. */
  if (side !== 'yalla' && maySeeCustomer) {
    if (j.customer) { bits.push(`الزبون: ${j.customer}`); en.push(`Customer: ${j.customer}`); }
  }
  return bits.filter(Boolean).join(BR) + BR + BR + en.filter(Boolean).join(BR);
}

function statusText(side, chatId) {
  const s = Telegram.status();
  const mine = s[side] || {};
  const r = Reminders.status();
  const chats = (mine.chats || []).length;
  const on = (r.rules || []).filter((x) => x.on && (side === 'yalla' ? x.audience === 'yalla'
                                                                     : x.audience === 'og')).length;
  /* BOTH MUTES, because they are different facts with the same symptom. A chat
     that silenced itself and a chat that is quiet because the whole side is
     muted look identical from inside the room, and only one of them is
     something the person holding the phone can undo. */
  const sideMute = cfg('reminders.muted_until_' + side);
  const sideLive = sideMute && Date.parse(sideMute) > Date.now();
  const mine9 = Telegram.chatMutedUntil(side, chatId);
  const me = Telegram.chatOwner(side, chatId);
  const whose = me ? me.name : null;
  return pair(
    `🤖 @${mine.bot || '?'} · ${chats} محادثة مرتبطة` + BR +
      (whose ? `هذه المحادثة: ${whose}` + BR : '') +
      `التذكيرات: ${r.enabled ? on + ' مفعّلة' : 'مغلقة'}` +
      (mine9 ? BR + `هذه المحادثة مكتومة حتى ${mine9.slice(11, 16)}` : '') +
      (sideLive ? BR + `كل التذكيرات مكتومة حتى ${sideMute.slice(11, 16)}` : '') + BR +
      `ساعة المحل: ${r.shopNow.slice(11)} (UTC+${r.tz / 60})` +
      (mine.queued ? BR + `في الطابور: ${mine.queued}` : ''),
    `@${mine.bot || '?'} · ${chats} linked chat(s)` + BR +
      (whose ? `This chat: ${whose}` + BR : '') +
      `Reminders: ${r.enabled ? on + ' on' : 'off'}` +
      (mine9 ? BR + `This chat is muted until ${mine9.slice(11, 16)}` : '') +
      (sideLive ? BR + `Everything is muted until ${sideMute.slice(11, 16)}` : '') + BR +
      `Shop clock: ${r.shopNow.slice(11)} (UTC+${r.tz / 60})` +
      (mine.queued ? BR + `Queued: ${mine.queued}` : '')
  );
}

/* Silence, and how long — FOR THIS CHAT AND NOBODY ELSE.

   It used to write `reminders.muted_until_<side>`, one key for the whole
   company. That was harmless while a side had one phone on it; with a phone
   per person it means the warehouse tapping "Mute 2h" silences the owner's
   reminders too, from a button neither of them thinks of as shared.

   The side-wide key stays as the manager's master switch, written from the
   Settings fold. /status reports both, so a chat that is quiet because the
   whole side is muted does not look like a chat that muted itself. */
function muteText(side, chatId, hoursRaw) {
  const h = Math.max(0.25, Math.min(72, Number(hoursRaw) || 2));
  const until = new Date(Date.now() + h * 3600000).toISOString();
  Telegram.muteChat(side, chatId, until);
  return pair(
    `🔕 تذكيرات هذه المحادثة مكتومة ${h} ساعة (حتى ${until.slice(11, 16)}).` + BR +
      'الأخبار الحقيقية تصل كالعادة، وبقية المحادثات لم تتغير.',
    `Reminders muted here for ${h}h (until ${until.slice(11, 16)}).` + BR +
      'Real events still arrive as usual, and no other chat is affected.'
  );
}

function unmuteText(side, chatId) {
  Telegram.muteChat(side, chatId, null);
  return pair('🔔 عادت تذكيرات هذه المحادثة.', 'Reminders are back on here.');
}

/* ------------------------------------------------------------------ the router */

export async function handle({ side, chat, text, msg, linked } = {}) {
  const raw = String(text || '').trim();
  if (raw.charAt(0) !== '/') return false;

  /* "/queue@ogsports1bot" in a group is the same command. */
  const m = raw.match(/^\/([a-z_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return false;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] || '').trim();

  /* "/start ABC123" with a LIVE code never reaches here — telegram.js spends
     it first. So a /start arriving in this file is either a bare press of the
     Start button or a code that was wrong or had expired, and both want the
     same answer: what this bot is and how to join it. */
  const known = ['start', 'help', 'queue', 'today', 'late', 'job', 'status', 'mute', 'unmute'];
  if (known.indexOf(cmd) < 0) return false;

  /* AN UNLINKED CHAT IS TOLD NOTHING ABOUT THE SHOP — but pressing Start and
     getting silence is how a bot reads as broken, and the person pressing it
     is nearly always the owner with the code already on his other screen. So
     the two doorway commands answer with the joining instructions, which name
     no job, no number and no other command; everything else keeps the plain
     line it always had, with no hint that it was a command at all. */
  if (!linked) {
    await reply(side, chat.id, (cmd === 'start' || cmd === 'help')
      ? welcomeText(side, false)
      : (side === 'og'
          ? pair('أرسل رمز الربط الظاهر في الإعدادات ← تيليغرام.',
                 'Send the link code shown in Settings → Telegram.')
          : pair('أرسل رمز الربط الظاهر في بوابة يلا وير.',
                 'Send the link code shown in your Yalla Wear portal.')));
    return true;
  }

  /* ---- A PHONE IS EXACTLY AS POWERFUL AS THE LOGIN THAT LINKED IT ----------
     This is what makes it safe for anybody to link their own phone. Being on
     the linked list is still the whole authentication — a chat carries no
     session — but it is no longer the whole AUTHORISATION: /today hands over
     the day's takings and the expected drawer, and /job names the customer.
     Handing those to whoever holds a linked chat would turn Connect into a
     way past `requirePerm` for a cashier whose own screens are not allowed to
     draw either number.

     So the chat's owning account is resolved and each command is asked of
     THAT account, through the same Auth.can the HTTP routes use. A chat with
     no resolvable, active account — a group, a legacy row, somebody who has
     left — answers nothing but the doorway commands. */
  const auth = Telegram.chatAuth(side, chat.id);
  const may = (perm) => (auth.legacy ? true : Telegram.ownerCan(auth.owner, perm));
  const refuse = () => pair(
    'هذه المحادثة غير مخوّلة بهذا. اسأل المدير.',
    'This chat is not allowed that. Ask the manager.');

  let out;
  switch (cmd) {
    case 'start':
    case 'help':   out = tutorialText(side); break;
    case 'status': out = statusText(side, chat.id); break;
    case 'unmute': out = unmuteText(side, chat.id); break;
    case 'mute':   out = muteText(side, chat.id, (arg.match(/([\d.]+)/) || [])[1]); break;
    case 'queue':  out = may('print.read') ? queueText(side) : refuse(); break;
    case 'late':   out = may('print.read') ? lateText(side) : refuse(); break;
    /* The one that carries the drawer. */
    case 'today':  out = may('money.read') ? todayText(side) : refuse(); break;
    case 'job':
      if (!may('print.read')) { out = refuse(); break; }
      out = arg ? jobText(side, arg.toUpperCase(), may('customer.read'))
                : pair('اكتب رقم الطلب: /job P-1043', 'Give a job id: /job P-1043');
      break;
    default: return false;
  }
  await reply(side, chat.id, out);
  return true;
}

/* ------------------------------------------------------------------ the buttons

   Telegram spins the button until the callback id is answered, so this
   returns a SHORT line for the toast and telegram.js answers with it either
   way — including when this throws. */
export async function press({ side, chat, data, from, linked } = {}) {
  if (!linked) return 'This chat is not linked.';
  const [verb, rest] = String(data || '').split(':');

  if (verb === 'mute') {
    /* The chat that pressed it, and only that chat. */
    const out = muteText(side, chat.id, rest);
    await reply(side, chat.id, out);
    return 'Muted';
  }

  if (verb === 'ok' || verb === 'no') {
    /* THE ONE WRITE. Only the printer's side answers an order — the shop
       sending it is the shop, and a shop chat pressing Accept would be the
       shop accepting its own order. */
    if (side !== 'yalla') return 'Only Yalla Wear can answer an order.';
    const id = String(rest || '').toUpperCase();
    const who = [from && from.first_name, from && from.last_name].filter(Boolean).join(' ') ||
                (from && from.username) || 'Telegram';
    try {
      /* No userId: nobody signed in. The name of the Telegram account that
         pressed it goes into the note, so the job history says who — which is
         the whole reason this is allowed to be a button at all. */
      Partner.respondToOrder(id, verb === 'ok', {
        note: (verb === 'ok' ? 'Accepted' : 'Declined') + ' from Telegram by ' + who,
        userId: null
      });
    } catch (e) {
      /* The reason is on `.code`; `.message` is the sentence. Checking the
         message would have matched nothing and shown the raw text as a toast. */
      if (e.code === 'not_pending') return 'That order has already been answered.';
      if (e.code === 'not_found') return 'No such order.';
      return e.message;
    }
    await reply(side, chat.id, verb === 'ok'
      ? pair(`✅ قُبل الطلب ${id} — ${who}`, `Order ${id} accepted — ${who}`)
      : pair(`✖ رُفض الطلب ${id} — ${who}`, `Order ${id} declined — ${who}`));
    return verb === 'ok' ? 'Accepted' : 'Declined';
  }

  return '';
}
