// og-bridge's own tests: `npm test` in vps/og-bridge (node --test, no
// dependency — pg is never loaded here). The till and the mirror are stubs;
// the clock is a number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideMode } from '../src/mode.js';
import { roadWatch } from '../src/road-watch.js';

const NOW = Date.parse('2026-09-21T12:00:00Z');
const MIN = 60 * 1000;
const status = (beatAgoMin, lineageId = 'L1') => ({
  ok: true, lineageId, beatAt: beatAgoMin === null ? null : new Date(NOW - beatAgoMin * MIN).toISOString()
});

test('live: the till answers and it owns the mirror', () => {
  const d = decideMode({ till: { ok: true, lineage: 'L1' }, status: status(1), now: NOW });
  assert.equal(d.mode, 'live');
  assert.equal(d.ageMs, MIN);
});

test('live even when the mirror cannot be read — the till is the truth', () => {
  assert.equal(decideMode({ till: { ok: true, lineage: 'L1' }, status: { ok: false }, now: NOW }).mode, 'live');
});

test('split: the till is silent here but beat 3 minutes ago — the tunnel is what is down', () => {
  const d = decideMode({ till: { ok: false }, status: status(3), now: NOW });
  assert.equal(d.mode, 'split');
  assert.equal(d.reason, 'tunnel_down_shop_online');
});

test('mirror: silent till, and the last beat is past ten minutes', () => {
  assert.equal(decideMode({ till: { ok: false }, status: status(10), now: NOW }).mode, 'mirror');
  assert.equal(decideMode({ till: { ok: false }, status: status(47), now: NOW }).mode, 'mirror');
});

test('the line between split and mirror is the staleMs setting', () => {
  assert.equal(decideMode({ till: { ok: false }, status: status(9.9), now: NOW }).mode, 'split');
  assert.equal(decideMode({ till: { ok: false }, status: status(4), now: NOW, staleMs: 3 * MIN }).mode, 'mirror');
});

test('unknown: the machine on the tunnel is not the mirror\'s owner (a dev copy)', () => {
  const d = decideMode({ till: { ok: true, lineage: 'DEV' }, status: status(1, 'L1'), now: NOW });
  assert.equal(d.mode, 'unknown');
  assert.equal(d.reason, 'lineage_mismatch');
});

test('unknown: silent till and an unreadable mirror', () => {
  assert.equal(decideMode({ till: { ok: false }, status: { ok: false, error: 'x' }, now: NOW }).mode, 'unknown');
});

test('unknown: silent till and a mirror that has never been beaten into', () => {
  assert.equal(decideMode({ till: { ok: false }, status: status(null), now: NOW }).mode, 'unknown');
});

test('road-watch: collects exactly once when the road comes back, and not while it stays up', async () => {
  let up = false, collects = 0, clock = NOW;
  const till = {
    health: async () => (up ? { ok: true, lineage: 'L1' } : { ok: false, error: 'ETIMEDOUT' }),
    collect: async () => { collects++; return { ok: true, collect: { applied: 1 } }; }
  };
  const mirror = { tillStatus: async () => status(2) };
  const w = roadWatch({ till, mirror, staleMs: 10 * MIN, statusMs: 0, now: () => clock });
  await w.tick();
  assert.equal(w.state.mode, 'split');
  assert.equal(collects, 0);
  up = true; clock += MIN;
  await w.tick();
  assert.equal(w.state.mode, 'live');
  assert.equal(collects, 1);
  await w.tick(); await w.tick();
  assert.equal(collects, 1, 'staying live asks nothing more');
  up = false; await w.tick(); up = true; await w.tick();
  assert.equal(collects, 2, 'a second return is a second collect');
  assert.equal(w.state.lastCollect.ok, true);
});

test('road-watch: the mirror\'s status is re-read only every statusMs', async () => {
  let reads = 0, clock = NOW;
  const w = roadWatch({
    till: { health: async () => ({ ok: false }), collect: async () => ({ ok: true }) },
    mirror: { tillStatus: async () => { reads++; return status(20); } },
    staleMs: 10 * MIN, statusMs: MIN, now: () => clock
  });
  await w.tick(); await w.tick();
  assert.equal(reads, 1);
  clock += MIN; await w.tick();
  assert.equal(reads, 2);
  assert.equal(w.state.mode, 'mirror');
});
