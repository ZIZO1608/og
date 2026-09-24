#!/usr/bin/env node
/* ==========================================================================
   always-on.js, checked for real — on THIS Windows machine, without touching
   its real settings.                        node tools/always-on/check.mjs

   - The sign-in entry is written under a TEST name (OG_AUTOSTART_NAME) and
     deleted at the end, whatever happens.
   - The power plan is a throwaway COPY of the active one (OG_POWER_SCHEME),
     set to sleep after 30 minutes first, and deleted at the end. The active
     plan is compared before and after.
   - The real "OGSystem" entry must not exist before or after.
   ========================================================================== */
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'server', 'scripts', 'always-on.js');
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const NAME = 'OGSystem-test-' + process.pid;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
};
const run = (cmd, argv) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const activePlan = () => (/[0-9a-f]{8}-[0-9a-f-]{27}/.exec(run('powercfg', ['-getactivescheme']).out) || [''])[0];
const realEntry = () => run('reg', ['query', RUN_KEY, '/v', 'OGSystem']).code === 0;

if (process.platform !== 'win32') { console.log('always-on check: Windows only'); process.exit(0); }

const plan0 = activePlan();
const real0 = realEntry();
const copy = (/[0-9a-f]{8}-[0-9a-f-]{27}/.exec(run('powercfg', ['-duplicatescheme', 'SCHEME_CURRENT']).out) || [''])[0];
const env = { ...process.env, OG_AUTOSTART_NAME: NAME, OG_POWER_SCHEME: copy };
const ask = (...a) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8', env, windowsHide: true });
  const m = /OG_ALWAYS_JSON (\{.*\})/.exec(r.stdout || '');
  return { code: r.status, facts: m ? JSON.parse(m[1]) : null, out: r.stdout || '' };
};

try {
  check('a throwaway copy of the power plan was made', !!copy);
  run('powercfg', ['-setacvalueindex', copy, 'SUB_SLEEP', 'STANDBYIDLE', '1800']);
  run('powercfg', ['-setacvalueindex', copy, 'SUB_SLEEP', 'HIBERNATEIDLE', '7200']);

  let a = ask('--json');
  check('before: not in the sign-in list', a.facts.startup.state === 'missing', JSON.stringify(a.facts.startup));
  check('before: the plan sleeps after 30 minutes', a.facts.power.sleep === 'on' && a.facts.power.sleepMinutes === 30, JSON.stringify(a.facts.power));
  check('before: the plan hibernates', a.facts.power.hibernate === 'on');
  check('before: exit 4, something this script can turn on', a.code === 4, 'exit ' + a.code);

  const ap = ask('--apply');
  check('--apply says what it turned on, and nothing failed', /Turned on:/.test(ap.out) && !/could not/.test(ap.out), ap.out.trim().split('\n')[0]);

  let b = ask('--json');
  check('after --apply: starts with Windows', b.facts.startup.state === 'ok', JSON.stringify(b.facts.startup));
  check('after --apply: never sleeps on mains', b.facts.power.sleep === 'ok');
  check('after --apply: never hibernates on mains', b.facts.power.hibernate === 'ok');
  check('the lid: "ok", or "none" on a plan that hides the setting', ['ok', 'none'].includes(b.facts.power.lid), b.facts.power.lid);
  check('after --apply the exit is 0, or 1 only for what a person must do',
    b.code === 0 || (b.code === 1 && b.facts.signIn.state !== 'ok'), 'exit ' + b.code);

  const v = /REG_SZ\s+(.*)$/m.exec(run('reg', ['query', RUN_KEY, '/v', NAME]).out);
  check('the entry is the QUOTED path to this folder\'s OG System.exe',
    v && v[1].trim() === '"' + join(ROOT, 'OG System.exe') + '"', v && v[1]);

  run('reg', ['add', APPROVED, '/v', NAME, '/t', 'REG_BINARY', '/d', '030000000000000000000000', '/f']);
  check('switched off in Task Manager\'s Startup tab is seen', ask('--json').facts.startup.state === 'switched_off');
  ask('--apply');
  check('--apply switches it back on', ask('--json').facts.startup.state === 'ok');

  run('reg', ['add', RUN_KEY, '/v', NAME, '/t', 'REG_SZ', '/d', '"C:\\elsewhere\\OG System.exe"', '/f']);
  const e = ask('--json').facts.startup;
  check('an entry for ANOTHER folder is not taken for this one', e.state === 'elsewhere' && /elsewhere/.test(e.target), JSON.stringify(e));

  ask('--undo');
  const f = ask('--json');
  check('--undo takes it away', f.facts.startup.state === 'missing');
  check('--undo leaves the power plan alone', f.facts.power.sleep === 'ok');

  const p = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env, windowsHide: true }).stdout || '';
  check('the printed check names the BIOS and the UPS, which no program can see', /BIOS/.test(p) && /UPS/.test(p));
  check('the printed check never prints a password', !/DefaultPassword\s+REG_SZ/i.test(p));
} finally {
  run('reg', ['delete', RUN_KEY, '/v', NAME, '/f']);
  run('reg', ['delete', APPROVED, '/v', NAME, '/f']);
  if (copy) run('powercfg', ['-delete', copy]);
}

check('the test entry is gone', run('reg', ['query', RUN_KEY, '/v', NAME]).code !== 0);
check('the throwaway plan is gone', !copy || !run('powercfg', ['-list']).out.includes(copy));
check('the active power plan never changed', activePlan() === plan0, plan0 + ' → ' + activePlan());
check('the real OGSystem entry is exactly as it was', realEntry() === real0);
console.log(`\nalways-on check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
