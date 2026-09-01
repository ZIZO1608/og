/* ==========================================================================
   OG SYSTEM — text: one phone normaliser, one Arabic folder
   --------------------------------------------------------------------------
   THIS FILE HAS A TWIN. js/data.js carries the same two functions as
   DB.normPhone and DB.foldName, with identical bodies. The server is ESM,
   the browser is <script> tags with no build step, and nothing bridges the
   two — so the pair exists twice, and the copies MUST be kept in step.
   Change one, change the other, and re-run the parity table in the Stage A
   report. Duplication is the lesser evil here; a build step is a hard
   constraint violation.

   Why they exist at all: the app had five independent digit-strippers and no
   Arabic normalisation. `أحمد` and `احمد` were two different customers to
   every search box, and `0933 111 222` never matched `+963933111222`.
   ========================================================================== */

/* The bare digits of a Syrian number, with the local form promoted to the
   international one: 0933 111 222 → 963933111222. The rule is lifted from
   js/whatsapp.js, where it already worked: the +, the spaces and the dashes
   are presentation, and the identity is the digits. Anything that is not
   ten digits starting with 0 is returned as its digits, untouched. */
export function normPhone(s) {
  var d = String(s == null ? '' : s).replace(/\D/g, '');
  if (d.length === 10 && d.charAt(0) === '0') d = '963' + d.slice(1);
  return d;
}

/* Lowercase, then fold the Arabic letter forms that vary by typist but not
   by meaning: the hamza-alef variants to bare alef, ta marbuta to ha, alef
   maqsura to ya, hamza-on-waw and hamza-on-ya to their base letter, tatweel
   and the short vowels dropped, whitespace collapsed. Latin is only
   lowercased. NO transliteration between scripts — "Ahmad" and "أحمد" are
   honestly different here, and the phone is the identity. */
export function foldName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')   /* أ إ آ ٱ → ا */
    .replace(/ة/g, 'ه')                       /* ة → ه */
    .replace(/ى/g, 'ي')                       /* ى → ي */
    .replace(/ؤ/g, 'و')                       /* ؤ → و */
    .replace(/ئ/g, 'ي')                       /* ئ → ي */
    .replace(/ـ/g, '')                             /* tatweel */
    .replace(/[ً-ْ]/g, '')                    /* fathatan … sukun */
    .replace(/\s+/g, ' ')
    .trim();
}
