/* ==========================================================================
   OG SYSTEM — .env loader
   --------------------------------------------------------------------------
   Reads server/.env into process.env. Twenty lines rather than a package,
   for the same reason as everything else here: `npm install` is a thing that
   can fail on a shop's connection, and this is not worth a dependency.

   Node 20.6+ has `--env-file`, which does the same job. It is not used
   because the shop starts the server by double-clicking start-og-system.bat,
   which runs `node index.js` with no flags. A loader that lives in the code
   works however the process is launched — batch file, npm script, or by hand.

   Real environment variables always win over the file. That is what every
   other .env loader does, and it is what makes `OG_PORT=9000 npm start`
   behave the way anyone would expect.
   ========================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = resolve(HERE, '..', '.env');

let loaded = false;

/* Parse KEY=VALUE lines. Deliberately small: comments, blank lines, optional
   quotes, and an optional `export` prefix so a file copied from a shell
   script still works. No multi-line values and no variable interpolation —
   nothing here needs them, and both are where hand-rolled parsers go wrong. */
export function parse(text) {
  const out = {};

  /* PowerShell writes a UTF-8 BOM when it pipes to a file. Without this the
     first key in the file becomes "﻿SUPABASE_URL", which is a different
     name, so it reads as simply missing — and the error is baffling because
     the line is plainly there in the editor. This has bitten this project
     before, with a password that would not match its own confirmation. */
  text = text.replace(/^﻿/, '');

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    if (!key) continue;

    let val = line.slice(eq + 1).trim();

    /* Quotes are stripped only when they wrap the whole value. A trailing
       `# comment` is NOT stripped from an unquoted value: a Postgres
       password may legitimately contain '#', and silently truncating a
       password produces a login failure nobody can explain. */
    const quoted = (val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
                   (val.startsWith("'") && val.endsWith("'") && val.length > 1);
    if (quoted) val = val.slice(1, -1);

    out[key] = val;
  }

  return out;
}

/* Safe to call more than once; only the first call reads the disk. */
export function load() {
  if (loaded) return;
  loaded = true;
  if (!existsSync(ENV_FILE)) return;

  const vars = parse(readFileSync(ENV_FILE, 'utf8'));
  for (const [k, v] of Object.entries(vars)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export function envFilePath() { return ENV_FILE; }
export function envFileExists() { return existsSync(ENV_FILE); }

/* Read a variable that must be present. Throwing at startup with the name of
   the missing key beats a null spreading through the app and surfacing three
   layers away as "cannot read property of undefined". */
export function need(key) {
  load();
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `Missing ${key}. Add it to server/.env — copy server/.env.example if you have not yet.`
    );
  }
  return v;
}

export function maybe(key, fallback = null) {
  load();
  return process.env[key] || fallback;
}

/* Never print a credential in full. Enough characters to tell two keys apart
   in a support conversation, never enough to use one. */
export function mask(secret) {
  if (!secret) return '(not set)';
  const s = String(secret);
  if (s.length <= 12) return '*'.repeat(s.length);
  return `${s.slice(0, 6)}…${s.slice(-4)}  (${s.length} chars)`;
}
