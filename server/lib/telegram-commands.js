/* ==========================================================================
   THE BOT'S EAR — reserved                             [telegram-commands.js]
   --------------------------------------------------------------------------
   PHASE 2. Today this returns false for every message and the bot behaves
   exactly as it did: it understands a six-character link code and nothing
   else. What is here now is the CALL SITE and its argument shape, which are
   the expensive half to retrofit — lib/telegram.js already calls this from
   handleUpdate(), and already asks Telegram for `callback_query` updates, so
   a router and its buttons drop in without touching the poll loop.

   WHAT WILL LIVE HERE
     /help                  what this bot answers
     /queue                 jobs in hand, pieces, what is due today
     /today                 the shop's day so far (og), the press's day (yalla)
     /job P-1043            one job: stage, pieces, promise, who is waiting
     /status                bot, chats linked, queue depth, reminders on/off
     /mute 2h               writes reminders.muted_until_<side>, which the
                            scheduler already honours — no new state needed

   THE TWO RULES IT MUST KEEP
   --------------------------
   1. ONLY A LINKED CHAT IS ANSWERED. `linked` is passed in, computed by
      Telegram.isLinked(side, chat.id) against config telegram.<side>_chats.
      That list IS the authorisation: a Telegram chat carries no session, so
      there is nothing else to check it against. An unlinked chat gets the
      same "send the link code" line it gets today — never a hint that the
      command exists.

   2. THE SIDE COMES FROM THE BOT, NEVER FROM THE MESSAGE. Which token
      received the update decides the audience, exactly as tgSide() decides it
      from the account's role on the HTTP side. A chat on Yalla Wear's bot
      asking for the shop's takings is answered as Yalla Wear, which is to say
      not at all.

   AND ONE THAT IS A DECISION, NOT AN OVERSIGHT: every command listed above is
   a READ. A command that changes shop state from a chat is a second write
   door past requirePerm, with no session behind it and no per-user
   authorisation to appeal to. That needs its own decision, not a follow-on
   commit.

   Replies go through Telegram.send(side, chatId, kind, args) so they render
   from the same TEMPLATES and inherit the plain-text, Arabic-first rule —
   rather than growing a second formatter that forgets why there is no
   Markdown (a job id like P_1043 breaks the parse and the message silently
   never arrives).
   ========================================================================== */

/* eslint-disable no-unused-vars */

/* Return true when the message was handled and telegram.js should stop.
   False means "not mine" — the link-code and /start branches carry on. */
export async function handle({ side, chat, text, msg, linked } = {}) {
  return false;
}
