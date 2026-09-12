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

/* The bare digits of a phone number, with the local forms promoted to the
   international one. The +, the spaces and the dashes are presentation; the
   identity is the digits.

     0933 111 222        → 963933111222   Syria
     0791 234 567        → 962791234567   Jordan: no Syrian area code starts
                                           with 7, and a Jordanian mobile does
     0532 123 45 67      → 905321234567   Turkey: eleven digits, 05…
     00963…, +963 0933…  → 963933111222   the long prefix, and a trunk zero
                                           kept after the country code

   The shop ships to Jordan and Turkey (the delivery office, 045), and the
   Syria-only rule turned a Jordanian number into a Syrian one — a WhatsApp
   link that opened a stranger's chat, and a customer who could never be
   found by the number they gave. Anything else comes back as its digits,
   untouched. The parity table in CUSTOMERS.md is the test for this pair. */
export function normPhone(s) {
  var d = String(s == null ? '' : s).replace(/\D/g, '');
  if (d.indexOf('00') === 0) d = d.slice(2);
  d = d.replace(/^(963|962|90)0(?=\d)/, '$1');
  if (d.length === 10 && d.charAt(0) === '0') {
    d = (d.charAt(1) === '7' ? '962' : '963') + d.slice(1);
  } else if (d.length === 11 && d.slice(0, 2) === '05') {
    d = '90' + d.slice(1);
  }
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
