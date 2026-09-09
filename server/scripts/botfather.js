/* ==========================================================================
   OG SYSTEM — the bot's own face                        [scripts/botfather.js]
   --------------------------------------------------------------------------
   Everything @BotFather can set, set from here instead — and the two things
   it cannot.

   WHY NOT JUST TYPE IT INTO BOTFATHER. Three reasons, and the third is the
   one that matters:

     1. BotFather writes one language. This shop is Arabic first and the
        Bot API takes a language_code, so an Arabic phone sees Arabic and
        everybody else sees English. /setdescription cannot do that.
     2. The command list would be a second copy of COMMAND_MENU in
        telegram-commands.js, kept in step by somebody remembering. This
        reads that list, so the two cannot drift.
     3. The command list a person actually needs is published PER LINKED
        CHAT by telegram.js (syncCommands), and a per-chat list overrides the
        default. So BotFather's list is only ever what a STRANGER sees —
        which is why the default written here is /start and /help and nothing
        else. Typing all eight into BotFather would hand the shop's menu to
        anyone who found the bot.

   WHAT IS LEFT FOR BOTFATHER: the profile photo, and the bot's name. Both
   are branding decisions, both are one gesture in the app, and neither is
   worth a flag here. They are printed at the end.

   Usage:
     npm run botfather            both bots, from the tokens in server/.env
     npm run botfather -- --dry   print every call, send nothing
     npm run botfather -- --og    one side only ( or --yalla )
   ========================================================================== */

import { maybe } from '../lib/env.js';
import { BOT_IDENTITY, PUBLIC_MENU } from '../lib/telegram-commands.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY = args.includes('--og') ? 'og' : args.includes('--yalla') ? 'yalla' : null;

const SIDES = ['og', 'yalla'];
const token = (side) => maybe('OG_TELEGRAM_TOKEN_' + side.toUpperCase());

/* Telegram's own limits. Checked BEFORE sending, because the API refuses the
   whole call with a description that names no number, and a text edited to
   fit on the fifth attempt is a text nobody reads afterwards. */
const LIMITS = { description: 512, short_description: 120 };

let failed = 0;

async function call(side, method, body) {
  if (DRY) {
    console.log('    would ' + method + '  ' + JSON.stringify(body).slice(0, 120));
    return { ok: true };
  }
  const res = await fetch(`https://api.telegram.org/bot${token(side)}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.description || `${res.status} on ${method}`);
  return json;
}

async function step(side, label, method, body) {
  try {
    await call(side, method, body);
    console.log('    ✓ ' + label);
  } catch (e) {
    failed++;
    console.log('    ✗ ' + label + ' — ' + e.message);
  }
}

async function doSide(side) {
  const tk = token(side);
  console.log('');
  if (!tk) {
    console.log(`  ${side}: OG_TELEGRAM_TOKEN_${side.toUpperCase()} is not set in server/.env — skipped.`);
    return;
  }

  let me = { username: '(unknown)' };
  if (!DRY) {
    try { me = (await call(side, 'getMe')).result; }
    catch (e) {
      failed++;
      console.log(`  ${side}: could not reach the bot — ${e.message}`);
      return;
    }
  }
  console.log(`  ${side} · @${me.username}`);

  const id = BOT_IDENTITY[side];

  /* The description is what fills the empty chat BEFORE anybody presses
     Start — the first thing a new person reads, and until now it was blank. */
  for (const lang of ['en', 'ar']) {
    const text = id.description[lang];
    if (text.length > LIMITS.description) {
      failed++;
      console.log(`    ✗ description (${lang}) is ${text.length} chars, limit ${LIMITS.description}`);
      continue;
    }
    await step(side, `description (${lang})`, 'setMyDescription',
      lang === 'ar' ? { description: text, language_code: 'ar' } : { description: text });
  }

  /* The About line, in the bot's profile and in a forwarded-message header. */
  for (const lang of ['en', 'ar']) {
    const text = id.short[lang];
    if (text.length > LIMITS.short_description) {
      failed++;
      console.log(`    ✗ about (${lang}) is ${text.length} chars, limit ${LIMITS.short_description}`);
      continue;
    }
    await step(side, `about (${lang})`, 'setMyShortDescription',
      lang === 'ar' ? { short_description: text, language_code: 'ar' } : { short_description: text });
  }

  /* THE PUBLIC LIST — two entries, default scope. A linked chat is given the
     full list by the server itself and that per-chat list wins, so this is
     only ever what somebody who is not connected to the shop is offered. */
  await step(side, 'public menu (en)', 'setMyCommands', { commands: PUBLIC_MENU.en });
  await step(side, 'public menu (ar)', 'setMyCommands',
    { commands: PUBLIC_MENU.ar, language_code: 'ar' });

  /* The blue button beside the message box opens the command list rather
     than a web app. It is the default, set explicitly so a bot that was once
     pointed at something else comes back. */
  await step(side, 'menu button', 'setChatMenuButton', { menu_button: { type: 'commands' } });
}

console.log('');
console.log('  The bots\' own face — description, About, and the public command list.');
console.log('  The FULL command list is published per linked chat by the server itself,');
console.log('  every boot and on every new link. Nothing here needs to repeat it.');
if (DRY) console.log('  --dry: nothing will be sent.');

for (const side of SIDES) {
  if (ONLY && side !== ONLY) continue;
  await doSide(side);
}

console.log('');
console.log('  Left for @BotFather, because both are pictures rather than text:');
console.log('    /setuserpic   — the shop mark. assets/icon-512.png for the OG bot.');
console.log('    /setname      — only if the bot should be called something else.');
console.log('  And check once, on each bot:');
console.log('    /setprivacy   — ENABLED is right. A bot in a group is then handed only');
console.log('                    messages beginning with "/", which is every command it has;');
console.log('                    it is also why a link code must be sent as "/start CODE"');
console.log('                    in a group and not on its own.');
console.log('    /setjoingroups — must be ENABLED to link a staff group at all.');
console.log('');
console.log(failed ? `  ${failed} call(s) failed.` : '  Done.');
process.exit(failed ? 1 : 0);
