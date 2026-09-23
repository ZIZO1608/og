/* ==========================================================================
   What both enrolment scripts share.                             [enrol.js]
   --------------------------------------------------------------------------
   snapshot-user.js (the owner's snapshot) and night-user.js (night mode)
   ask the same questions the same way and draw the same QR code; one copy of
   each, so the two doors cannot drift apart.
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));

/* Input without an echo on a TTY; plain lines when piped (for a test). */
export async function ask(q, { hidden = false } = {}) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    if (!ask.lines) {
      const chunks = [];
      for await (const c of stdin) chunks.push(c);
      ask.lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
    }
    stdout.write(q + '\n');
    return (ask.lines.shift() || '').trim();
  }
  stdout.write(q);
  return new Promise((ok) => {
    let buf = '';
    stdin.setRawMode(hidden);
    stdin.resume();
    stdin.setEncoding('utf8');
    const on = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); stdout.write('\n'); return ok(buf.trim()); }
        if (c === '\u0003') { stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
      if (!hidden) { /* echoed by the terminal itself */ }
    };
    stdin.on('data', on);
  });
}

export function qrText(text) {
  const file = resolve(HERE, '../../../js/codes.js');
  if (!existsSync(file)) return null;
  const ctx = { console };
  runInNewContext(readFileSync(file, 'utf8') + '\n;this.Codes = Codes;', ctx);
  const qr = ctx.Codes.qrMatrix(text, { ecc: 'M' });
  const q = 2, n = qr.size;
  const dark = (x, y) => x >= 0 && y >= 0 && x < n && y < n && !!qr.modules[y][x];
  const lines = [];
  /* Two rows per character with the half blocks, light on dark terminals:
     a module that is DARK is drawn as a space, so the code reads as black on
     white the way a camera expects. */
  for (let y = -q; y < n + q; y += 2) {
    let s = '';
    for (let x = -q; x < n + q; x++) {
      const top = dark(x, y), bottom = dark(x, y + 1);
      s += top && bottom ? ' ' : top ? '▄' : bottom ? '▀' : '█';
    }
    lines.push(s);
  }
  return lines.join('\n');
}

/* ---------------------------------------------------------- night mode's line

   One OG_NIGHT_USERS entry, and the list with it merged in (the same username
   replaced, the others kept). Pure, so a test can check the shape without
   anybody typing a password into a terminal. */
export const NIGHT_ROLES = ['owner', 'manager', 'staff'];

export function nightProblem({ user, role, password }) {
  if (!/^[a-z0-9._-]{2,32}$/.test(String(user || ''))) return 'A username is 2–32 lowercase letters, digits, dots, dashes or underscores.';
  if (!NIGHT_ROLES.includes(role)) return 'The role is owner, manager or staff.';
  const pw = String(password || '');
  if (pw.length < 12 || /^\d+$/.test(pw)) return 'Use at least 12 characters, and not only digits.';
  return null;
}

export function mergeNightUsers(existingJson, entry) {
  let list = [];
  try { list = JSON.parse(existingJson || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  const kept = list.filter((u) => u && typeof u.user === 'string' && u.user.toLowerCase() !== entry.user);
  return [...kept, entry];
}

export function otpUri(issuer, user, secret) {
  const label = encodeURIComponent(issuer + ':' + user);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
