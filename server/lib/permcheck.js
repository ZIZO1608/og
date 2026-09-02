/* ==========================================================================
   OG SYSTEM — every permission name, checked at boot
   --------------------------------------------------------------------------
   A permission name that does not exist FAILS SILENTLY, and that is the whole
   reason this file exists.

   `Auth.can(user, 'sale.void')` returns false for every user forever, because
   no role has a permission by that name — the real one is `void`. It does not
   throw, it does not warn, and the feature behind it simply is not there. That
   shipped: Stage E gated a manager's override on `sale.void`, and the manager
   had no way past the rule at all. It was found by a test that happened to
   check the manager path, not by anything in the code.

   The failure is worse in the other direction than it looks. A misspelling in
   `requirePerm` closes a route to everybody — loud, somebody complains within
   an hour. A misspelling in `Auth.can` usually gates something OPEN or SHUT in
   a way nobody notices, and a security check written as
   `Auth.can(user, 'cost.raed')` denies nothing while looking exactly like a
   guard.

   SO THIS READS THE SOURCE rather than waiting for the line to run. A runtime
   assertion inside can() would only fire on a code path somebody exercised,
   which is precisely the path that already gets tested. The names are
   literals in the source; checking them is a scan, and a scan at boot costs
   about a millisecond.

   Run from server/index.js at startup, and from `npm run preflight`.
   ========================================================================== */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PERMISSIONS } from './auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, '..');

/* Every call site that names a permission. Deliberately literal-only: a
   variable (`requirePerm(needed, …)`) cannot be checked here and is not
   pretended to be — those are counted and reported separately, so the number
   this file cannot vouch for is visible rather than assumed to be zero. */
const PATTERNS = [
  /requirePerm\(\s*'([a-z][a-z.]*)'/g,
  /requirePerm\(\s*\[([^\]]+)\]/g,
  /\bcan\(\s*(?:ctx\.user|user|u)\s*,\s*'([a-z][a-z.]*)'/g,
  /Auth\.can\(\s*[^,]+,\s*'([a-z][a-z.]*)'/g
];

/* requirePerm(perm, …) and can(user, perm) with a NON-literal first argument.
   Counted, never silently ignored. */
const DYNAMIC = [
  /requirePerm\(\s*(?!'|\[)[A-Za-z_$]/g,
  /\bcan\(\s*(?:ctx\.user|user|u)\s*,\s*(?!')[A-Za-z_$]/g
];

function jsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'data') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/* Returns { bad, checked, dynamic } — `bad` is the list of offences. */
export function scan() {
  const known = new Set(ALL_PERMISSIONS.map((p) => p.perm));
  const bad = [];
  /* Two patterns can match the same call — `can(ctx.user, 'x')` is found by
     both the bare and the Auth-qualified one — so offences are deduped on
     file:line:name. Reporting one mistake twice makes a list of four look
     like a list of eight. */
  const seen = new Set();
  let checked = 0;
  let dynamic = 0;

  for (const file of jsFiles(SERVER)) {
    /* This file names permissions in its own comments and would report
       itself. So would the table that defines them. */
    if (file.endsWith('permcheck.js') || file.endsWith('lib' + '\\auth.js') ||
        file.endsWith('lib/auth.js')) continue;

    const src = readFileSync(file, 'utf8');
    const rel = file.slice(SERVER.length + 1).replace(/\\/g, '/');

    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        /* The array form: requirePerm(['print.read', 'partner.jobs'], …) */
        const names = m[1].indexOf("'") > -1 || m[1].indexOf(',') > -1
          ? [...m[1].matchAll(/'([a-z][a-z.]*)'/g)].map((x) => x[1])
          : [m[1]];
        for (const name of names) {
          const line = src.slice(0, m.index).split('\n').length;
          const key = rel + ':' + line + ':' + name;
          if (seen.has(key)) continue;
          seen.add(key);
          checked++;
          if (!known.has(name)) bad.push({ file: rel, line, name });
        }
      }
    }

    for (const re of DYNAMIC) {
      re.lastIndex = 0;
      while (re.exec(src)) dynamic++;
    }
  }

  return { bad, checked, dynamic };
}

/* Called at boot. Throws — loudly, with every offence named — rather than
   letting a shop run with a guard that guards nothing. */
export function assertPermissionNames() {
  const { bad, checked, dynamic } = scan();
  if (!bad.length) return { checked, dynamic };

  const lines = bad.map((b) => `  ${b.file}:${b.line}  '${b.name}'`).join('\n');
  const err = new Error(
    `${bad.length} permission name(s) that do not exist:\n${lines}\n\n` +
    'A permission name that does not exist fails SILENTLY — Auth.can returns\n' +
    'false for everybody and the guard guards nothing. Fix the name, or add it\n' +
    'to ALL_PERMISSIONS in server/lib/auth.js.');
  err.code = 'bad_permission_name';
  err.offences = bad;
  throw err;
}
