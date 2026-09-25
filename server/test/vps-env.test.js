/* The laptop's server/.env is rewritten twice in the life of the switch
   (npm run vps): once to make it the standby — the cloud keys and the bots
   PARKED, so it can never be a second writer — and once on the way back.
   Both rewrites are pure; these hold them to it. No server, no network. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../lib/env.js';
import { standbyText, primaryText, envValues, PARK, PARKED } from '../scripts/vps.js';

const LAPTOP = [
  'SUPABASE_URL=https://example.supabase.co',
  'SUPABASE_SECRET_KEY=sb_secret_abc',
  'OG_PORT=8090',
  '# a comment the owner wrote',
  'OG_VAULT_KEY=vault-123',
  'OG_TELEGRAM_TOKEN_OG=1:AAA',
  'OG_TELEGRAM_TOKEN_YALLA=2:BBB',
  'OG_SYNC_MINUTES=60',
  'OG_PULL_AT_BOOT=1',
  'OG_WEB_API_KEY=web-key',
  'OG_FX_KEY=fx-key',
  'OG_COPY_KEY=copy-key',
  ''
].join('\r\n');

test('the standby parks every writer key and keeps the rest', () => {
  const s = standbyText(LAPTOP);
  const active = parse(s);
  for (const k of PARK) assert.equal(active[k], undefined, k + ' must not be active on a standby');
  assert.equal(active.OG_ROLE, 'standby');
  assert.equal(active.OG_UPSTREAM, 'http://10.8.0.1:8090');
  assert.equal(active.OG_STANDBY_HOME, 'https://shop.ogsports1.com');
  assert.equal(active.OG_VAULT_KEY, 'vault-123', 'the vault key stays: the panel reveal uses it');
  assert.equal(active.OG_COPY_KEY, 'copy-key');
  assert.equal(active.OG_PORT, '8090');
  assert.ok(s.includes('# a comment the owner wrote'));
  assert.ok(s.includes('\r\n'), 'the file keeps its own line endings');
});

test('the secrets are still readable, parked, so `env` can run again', () => {
  const v = envValues(standbyText(LAPTOP));
  assert.equal(v.SUPABASE_SECRET_KEY, 'sb_secret_abc');
  assert.equal(v.OG_TELEGRAM_TOKEN_OG, '1:AAA');
  assert.equal(v.OG_VAULT_KEY, 'vault-123');
});

test('standby twice is standby once', () => {
  const once = standbyText(LAPTOP);
  const twice = standbyText(once);
  assert.equal(parse(twice).OG_ROLE, 'standby');
  assert.equal((twice.match(/OG_ROLE=/g) || []).length, 1);
  assert.equal((twice.match(new RegExp('^' + PARKED + 'SUPABASE_URL=', 'm')) || []).length, 1, 'nothing parked twice');
});

test('the way back gives the laptop exactly what it had', () => {
  const back = primaryText(standbyText(LAPTOP));
  assert.deepEqual(parse(back), parse(LAPTOP));
  assert.equal(parse(back).OG_ROLE, undefined);
});

test('an OG_ROLE already in the file is replaced, not doubled', () => {
  const s = standbyText(LAPTOP + 'OG_ROLE=primary\r\nOG_UPSTREAM=http://old:1\r\n');
  assert.equal((s.match(/^OG_ROLE=/gm) || []).length, 1);
  assert.equal(parse(s).OG_UPSTREAM, 'http://10.8.0.1:8090');
});
