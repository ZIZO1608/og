/* Auto-publish (panel/lib/autoship.js): what counts as new, and what is done
   about it. facts() runs against a REAL git repository in a temp folder whose
   "GitHub" is a local bare repository, so nothing here can reach the real
   remote or the VPS; decide() is pure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { facts, decide, RETRIES, RETRY_MS } from '../lib/autoship.js';

const SHIP = ['server', 'js', 'index.html'];

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function commit(dir, file, text, msg) {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), text);
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg);
  return sh(dir, 'rev-parse', 'HEAD').out.trim();
}
function rig() {
  const root = mkdtempSync(join(tmpdir(), 'autoship-'));
  const origin = join(root, 'origin.git'); const here = join(root, 'here'); const other = join(root, 'other');
  sh(root, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '-q', origin, here);
  for (const d of [here]) { sh(d, 'config', 'user.email', 't@t'); sh(d, 'config', 'user.name', 't'); sh(d, 'checkout', '-q', '-b', 'main'); }
  commit(here, 'server/a.js', '1', 'first');
  commit(here, 'README.md', 'x', 'readme');
  sh(here, 'push', '-q', 'origin', 'main');
  sh(root, 'clone', '-q', origin, other);
  sh(other, 'config', 'user.email', 'o@o'); sh(other, 'config', 'user.name', 'o');
  const git = (args) => Promise.resolve(sh(here, ...args));
  return { root, here, other, git, head: () => sh(here, 'rev-parse', 'HEAD').out.trim() };
}

test('nothing new: the shop already runs what GitHub has', async () => {
  const r = rig();
  const sha = r.head();
  const f = await facts({ git: r.git, ship: SHIP, shipped: sha.slice(0, 12) });
  assert.equal(f.ahead, 0); assert.equal(f.behind, 0);
  const d = decide(f, { shipped: sha.slice(0, 12), vpsKnown: true });
  assert.equal(d.act, 'none'); assert.equal(d.why, 'live');
  rmSync(r.root, { recursive: true, force: true });
});

test('a commit here that touches the shop: push it, then deploy it', async () => {
  const r = rig();
  const was = r.head().slice(0, 12);
  const sha = commit(r.here, 'server/a.js', '2', 'change the server');
  const f = await facts({ git: r.git, ship: SHIP, shipped: was });
  assert.equal(f.ahead, 1); assert.equal(f.target, sha); assert.equal(f.shopChanged, true);
  const d = decide(f, { shipped: was, vpsKnown: true });
  assert.deepEqual([d.act, d.push, d.deploy, d.sha], ['ship', true, true, sha]);
  rmSync(r.root, { recursive: true, force: true });
});

test('a commit that touches nothing the shop runs is pushed, not deployed', async () => {
  const r = rig();
  const was = r.head().slice(0, 12);
  commit(r.here, 'README.md', 'y', 'words only');
  const f = await facts({ git: r.git, ship: SHIP, shipped: was });
  assert.equal(f.shopChanged, false);
  const d = decide(f, { shipped: was, vpsKnown: true });
  assert.deepEqual([d.act, d.push, d.deploy], ['ship', true, false]);
  /* ...and once GitHub has it, the next minute is quiet — not a deploy loop. */
  sh(r.here, 'push', '-q', 'origin', 'main');
  const f2 = await facts({ git: r.git, ship: SHIP, shipped: was });
  const d2 = decide(f2, { shipped: was, vpsKnown: true });
  assert.deepEqual([d2.act, d2.why], ['none', 'nothing_for_the_shop']);
  rmSync(r.root, { recursive: true, force: true });
});

test('a commit pushed from ANOTHER machine is deployed from GitHub', async () => {
  const r = rig();
  const was = r.head().slice(0, 12);
  const theirs = commit(r.other, 'js/b.js', 'z', 'Ahmad');
  sh(r.other, 'push', '-q', 'origin', 'main');
  const f = await facts({ git: r.git, ship: SHIP, shipped: was });
  assert.equal(f.behind, 1); assert.equal(f.ahead, 0); assert.equal(f.target, theirs);
  const d = decide(f, { shipped: was, vpsKnown: true });
  assert.deepEqual([d.act, d.push, d.deploy, d.sha], ['ship', false, true, theirs]);
  rmSync(r.root, { recursive: true, force: true });
});

test('commits on both sides: nothing is published, a person is asked', async () => {
  const r = rig();
  const was = r.head().slice(0, 12);
  commit(r.other, 'js/b.js', 'z', 'Ahmad'); sh(r.other, 'push', '-q', 'origin', 'main');
  commit(r.here, 'server/a.js', '3', 'mine');
  const f = await facts({ git: r.git, ship: SHIP, shipped: was });
  const d = decide(f, { shipped: was, vpsKnown: true });
  assert.deepEqual([d.act, d.why, d.ahead, d.behind], ['stuck', 'diverged', 1, 1]);
  rmSync(r.root, { recursive: true, force: true });
});

test('GitHub unreachable: wait, never guess', async () => {
  const r = rig();
  sh(r.here, 'remote', 'set-url', 'origin', join(r.root, 'nowhere.git'));
  const f = await facts({ git: r.git, ship: SHIP, shipped: null });
  assert.equal(f.error, 'fetch_failed');
  assert.deepEqual([decide(f, {}).act, decide(f, {}).why], ['wait', 'fetch_failed']);
  rmSync(r.root, { recursive: true, force: true });
});

test('not on main: this laptop is mid-branch, nothing goes', async () => {
  const r = rig();
  sh(r.here, 'checkout', '-q', '-b', 'try-something');
  const f = await facts({ git: r.git, ship: SHIP, shipped: null });
  assert.deepEqual([decide(f, { vpsKnown: true }).act, decide(f, { vpsKnown: true }).why], ['none', 'not_main']);
  rmSync(r.root, { recursive: true, force: true });
});

/* decide() alone: the memory of failures and of the VPS */
const F = (o = {}) => ({ branch: 'main', ahead: 0, behind: 1, head: 'a'.repeat(40), remote: 'b'.repeat(40), target: 'b'.repeat(40), shopChanged: true, ...o });

test('a failed deploy is not retried every minute, but is retried', () => {
  const now = 1_000_000_000;
  const sha = 'b'.repeat(40);
  const recent = decide(F(), { shipped: 'c'.repeat(12), vpsKnown: true, now, failed: { sha, at: now - 60_000, n: 1 } });
  assert.deepEqual([recent.act, recent.why], ['none', 'failed_before']);
  const later = decide(F(), { shipped: 'c'.repeat(12), vpsKnown: true, now, failed: { sha, at: now - RETRY_MS - 1, n: 1 } });
  assert.deepEqual([later.act, later.deploy], ['ship', true]);
  const given = decide(F(), { shipped: 'c'.repeat(12), vpsKnown: true, now, failed: { sha, at: now - RETRY_MS * 5, n: RETRIES } });
  assert.equal(given.why, 'failed_before');
  /* a NEWER commit goes at once */
  const newer = decide(F({ target: 'd'.repeat(40), remote: 'd'.repeat(40) }), { shipped: 'c'.repeat(12), vpsKnown: true, now, failed: { sha, at: now, n: RETRIES } });
  assert.deepEqual([newer.act, newer.deploy], ['ship', true]);
});

test('the VPS cannot be asked: GitHub still gets the push, the shop waits', () => {
  const pushOnly = decide(F({ ahead: 1, behind: 0, target: 'a'.repeat(40) }), { shipped: null, vpsKnown: false });
  assert.deepEqual([pushOnly.act, pushOnly.push, pushOnly.deploy], ['ship', true, false]);
  const waits = decide(F(), { shipped: null, vpsKnown: false });
  assert.deepEqual([waits.act, waits.why], ['wait', 'vps_unreachable']);
});

test('switched off or busy: nothing', () => {
  assert.equal(decide(F(), { off: true }).act, 'none');
  assert.equal(decide(F(), { busy: true }).act, 'wait');
});
