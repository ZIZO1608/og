/* ==========================================================================
   OG SYSTEM — the backup that nobody has to remember       [backup-schedule.js]
   --------------------------------------------------------------------------
   Until audit 06 there was NO scheduled backup. `npm run backup` and the
   panel's "Back up now" were the only two ways a copy got made, the panel went
   amber after 48 hours, and that was all — for a shop whose owner keeps his
   records on paper and was never going to press a button every night. The only
   copy anybody could count on was the cloud one, and that has its own bad days
   (a refused table, a laptop with no internet for a week).

   So, while the shop is open:

     - every half hour it looks at the newest og-*.db in the backup folder
     - older than OG_BACKUP_HOURS (24; 0 switches this off) → a new one is made
       with the same three steps the script uses: VACUUM INTO (a consistent,
       compacted copy of a live WAL database — a plain file copy is not),
       verify (reopen it: integrity_check, foreign_key_check, row counts), and
       prune to the newest 30, so the folder can never fill the disk
     - OG_BACKUP_COPY_DIR, when set, gets the same file as well — a USB stick,
       a OneDrive or Drive folder, another disk. A BACKUP ON THE SAME DISK AS
       THE DATABASE protects against a mistake, not against a dead drive or a
       stolen laptop; this is the line that makes it more than that. It is
       pruned to the same number.

   It never throws into the server and never blocks a sale: VACUUM INTO reads
   under its own snapshot. What happened is written to backup-status.json in
   the backup folder, which is what the panel's Connections row reads — so a
   backup that FAILED is red there with its reason, instead of a folder quietly
   getting older.
   ========================================================================== */

import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

import { maybe, dbFile, backupDir } from './env.js';
import * as Backup from './backup.js';

const CHECK_MS = 30 * 60 * 1000;
const FIRST_MS = 3 * 60 * 1000;      /* not in the first minutes of the morning: the boot has enough to do */
const KEEP = 30;

let timer = null, first = null, busy = false;

export function hours() {
  const raw = maybe('OG_BACKUP_HOURS');
  if (raw === null || raw === '') return 24;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 24;
}

export function copyDir() {
  const raw = maybe('OG_BACKUP_COPY_DIR');
  if (!raw) return null;
  return isAbsolute(raw) ? raw : resolve(raw);
}

export function newestAgeMs(dir = backupDir()) {
  let newest = 0;
  try {
    for (const n of readdirSync(dir)) {
      if (!/^og-.*\.db$/.test(n) || /before-pull/.test(n)) continue;
      const m = statSync(join(dir, n)).mtimeMs;
      if (m > newest) newest = m;
    }
  } catch { return Infinity; }
  return newest ? Date.now() - newest : Infinity;
}

function note(status) {
  try {
    mkdirSync(backupDir(), { recursive: true });
    writeFileSync(join(backupDir(), 'backup-status.json'), JSON.stringify({ ...status, at: new Date().toISOString() }, null, 1));
  } catch { /* the folder itself is the problem, and the next line of the log says so */ }
}

/* One backup, now. Returns { ok, file, copied, reason }. Exported so a test
   can ask for one without waiting half an hour. */
export function runOnce({ log = console.log } = {}) {
  if (busy) return { ok: false, reason: 'busy' };
  busy = true;
  try {
    const src = dbFile();
    if (!existsSync(src)) { const r = { ok: false, reason: 'no database at ' + src }; note(r); return r; }
    const dir = backupDir();
    mkdirSync(dir, { recursive: true });
    const name = `og-${Backup.stamp()}.db`;
    const target = join(dir, name);
    Backup.snapshot(src, target);
    const v = Backup.verify(target);
    if (!v.ok) {
      const r = { ok: false, reason: 'the copy failed verification: ' + v.reason, file: target };
      log(`  [backup] FAILED — ${r.reason}. The file was left at ${target} for a look.`);
      note(r); return r;
    }
    Backup.prune(dir, KEEP);

    let copied = null, copyError = null;
    const extra = copyDir();
    if (extra) {
      try {
        mkdirSync(extra, { recursive: true });
        copyFileSync(target, join(extra, name));
        const cv = Backup.verify(join(extra, name));
        if (!cv.ok) throw new Error('the second copy failed verification: ' + cv.reason);
        Backup.prune(extra, KEEP);
        copied = join(extra, name);
      } catch (e) { copyError = e.message; }
    }
    const r = { ok: !copyError, file: target, copied, elsewhere: !!extra, reason: copyError ? 'made here, but NOT copied to ' + extra + ' — ' + copyError : null };
    log(copyError
      ? `  [backup] made ${name}, but the second copy failed — ${copyError}`
      : `  [backup] made ${name}` + (copied ? ` and copied it to ${extra}` : ''));
    note(r);
    return r;
  } catch (e) {
    const r = { ok: false, reason: e.message };
    log(`  [backup] FAILED — ${e.message}`);
    note(r); return r;
  } finally { busy = false; }
}

function tick() {
  const h = hours();
  if (!h) return;
  if (newestAgeMs() < h * 3600 * 1000) return;
  runOnce();
}

export function start() {
  if (timer || !hours()) {
    if (!hours()) console.log('  Backups: the daily backup is OFF (OG_BACKUP_HOURS=0) — only by hand.');
    return;
  }
  const extra = copyDir();
  console.log(`  Backups: one every ${hours()} h while the shop is open, newest ${KEEP} kept` +
    (extra ? `, and a second copy in ${extra}` : ' — ON THIS DISK ONLY (set OG_BACKUP_COPY_DIR for a copy somewhere else)'));
  first = setTimeout(tick, FIRST_MS); first.unref();
  timer = setInterval(tick, CHECK_MS); timer.unref();
}

export function stop() {
  if (first) { clearTimeout(first); first = null; }
  if (timer) { clearInterval(timer); timer = null; }
}
