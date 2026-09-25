#!/usr/bin/env node
/* ==========================================================================
   OG SYSTEM — the shop's main server on the VPS                 [npm run vps]
   --------------------------------------------------------------------------
   https://shop.ogsports1.com used to be this laptop, carried to the internet
   down a WireGuard tunnel: the domain was up exactly while OG System was open
   AND the laptop's own line held — and on a phone hotspot in Aleppo it did
   not (Supabase, both bots, the rate feed and the tunnel timing out in turn,
   25 Sep 2026). Online first, phase 4: the VPS runs the shop 24/7, the laptop
   becomes its STANDBY — a copy every five minutes, the till if the internet
   drops (server/lib/standby.js), the printers through the agent.

   This is the one tool for that, run from the laptop over SSH (the tunnel
   address first, which holds when port 22 on the public one does not):

     status            where things are. Changes nothing. (the default)
     setup             the folder on the VPS, and Docker made to start after
                       WireGuard (the port is published on the tunnel address)
     deploy            the COMMITTED code to the VPS: build, then swap the
                       container. --no-start builds only. --ref <commit>.
     env               the VPS's settings, secrets copied from this laptop's
                       server/.env (never printed). Adds OG_COPY_KEY here too.
     db                this laptop's database to the VPS, as a verified
                       snapshot. Only while the shop here is closed, only
                       onto a VPS that is not running the shop.
     laptop-standby    this laptop's server/.env becomes the standby's: the
                       cloud keys, bots and website key are PARKED ("#vps# "),
                       not deleted, so it can never be a second writer.
     switch --go       all of the above in the safe order, then starts the
                       VPS and checks it answers as the main server.
     start | stop | restart | logs [n]
     take-back --go    THE WAY BACK: stops the VPS shop, brings its database
                       home, un-parks the laptop's .env. Nothing is lost.

   ONE WRITER, ALWAYS. The VPS starts from a byte copy of this laptop's
   database — the accounts, the sessions, the cloud mirror's lineage id and
   bookmarks — so it carries on where the laptop stopped: no takeover, no
   restore. That same copy is why two of them must never run as main servers
   at once: same lineage, both pushing, is the 30 Aug incident with the guard
   switched off. Hence the order in `switch` (the laptop is made a standby
   BEFORE the database leaves) and the refusals in `db` and `take-back`.
   ========================================================================== */

import { spawn } from 'node:child_process';
import {
  readFileSync, writeFileSync, existsSync, statSync, unlinkSync, mkdirSync,
  createReadStream, createWriteStream, renameSync, copyFileSync
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as Env from '../lib/env.js';
import * as Backup from '../lib/backup.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..');
const ROOT = resolve(SERVER, '..');

/* ---------------------------------------------------------------- settings */

const HOSTS = process.env.OG_VPS_HOST ? [process.env.OG_VPS_HOST] : ['10.8.0.1', '152.239.114.129'];
const USER = process.env.OG_VPS_USER || 'root';
/* known_hosts holds the VPS's key under its public address; the tunnel
   address is the same machine, so it is checked against that entry. */
const HOSTKEY = process.env.OG_VPS_HOSTKEY_ALIAS || '152.239.114.129';
const DIR = process.env.OG_VPS_DIR || '/data/og-shop';
const DOMAIN = process.env.OG_VPS_DOMAIN || 'shop.ogsports1.com';
const TUNNEL_VPS = '10.8.0.1';
const VPS_URL = `http://${TUNNEL_VPS}:8090`;
if (!/^\/[A-Za-z0-9._/-]+$/.test(DIR)) fail(`OG_VPS_DIR must be a plain absolute path, not ${JSON.stringify(DIR)}.`);

/* What the image needs. The Dockerfile's own allow-list copies from these
   and nothing else, so nothing more crosses a slow line. */
const SHIP = ['Dockerfile', 'package.json', 'index.html', 'manifest.webmanifest', 'sw.js',
  'robots.txt', 'css', 'js', 'assets', 'server', 'deploy/og-shop'];

/* Copied from this laptop's .env to the VPS, exactly. */
const COPY = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'OG_VAULT_KEY', 'OG_TELEGRAM_TOKEN_OG', 'OG_TELEGRAM_TOKEN_YALLA', 'OG_WEB_API_KEY',
  'OG_FX_KEY', 'OG_FX_URL', 'OG_SYNC_MINUTES', 'OG_PULL_AT_BOOT', 'OG_COPY_KEY'];
/* Parked on a standby laptop: the means to be a writer, or to fight the
   main server over a bot. OG_VAULT_KEY stays — the panel's password reveal
   uses it and it writes nothing. */
const PARK = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL', 'OG_SYNC_MINUTES', 'OG_PULL_AT_BOOT', 'OG_SYNC_TAKEOVER',
  'OG_TELEGRAM_TOKEN_OG', 'OG_TELEGRAM_TOKEN_YALLA', 'OG_WEB_API_KEY', 'OG_FX_KEY', 'OG_FX_URL'];
const PARKED = '#vps# ';
const BLOCK_START = '# >>> og-standby';
const BLOCK_END = '# <<< og-standby';

/* ------------------------------------------------------------------ output */

const say = (s = '') => console.log(s);
const ok = (s) => console.log('  ✓ ' + s);
const warn = (s) => console.log('  ! ' + s);
function fail(s, code = 1) {
  console.error('\n  ✗ ' + s + '\n');
  process.exit(code);
}

/* ------------------------------------------------------------------- ssh */

function sh(cmd, args, { input = null, pipeFrom = null, echo = false, timeoutMs = 10 * 60000 } = {}) {
  return new Promise((done) => {
    let p;
    try { p = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return done({ code: null, out: '', err: e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, timeoutMs);
    p.stdout.on('data', (b) => { out += b; if (echo) process.stdout.write(b); });
    p.stderr.on('data', (b) => { err += b; if (echo) process.stderr.write(b); });
    p.on('error', (e) => { err += e.message; });
    p.on('close', (code) => { clearTimeout(timer); done({ code, out, err }); });
    p.stdin.on('error', () => { /* the far end closed early; its exit code says why */ });
    if (pipeFrom) pipeFrom(p.stdin);
    else { if (input != null) p.stdin.write(input); p.stdin.end(); }
  });
}

const sshOpts = (host) => ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
  '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
  '-o', `HostKeyAlias=${HOSTKEY}`, `${USER}@${host}`];

let HOST = null;
async function pickHost() {
  if (HOST) return HOST;
  for (const h of HOSTS) {
    for (let i = 0; i < 2; i++) {
      const r = await sh('ssh', [...sshOpts(h), 'true'], { timeoutMs: 45000 });
      if (r.code === 0) { HOST = h; return h; }
    }
  }
  fail(`Cannot reach the VPS over SSH (tried ${HOSTS.join(', ')}). Check this laptop's internet and WireGuard ("og-shop").`);
}

/* A script for the VPS's shell. It travels base64-encoded as one argument —
   no quoting survives Windows -> ssh -> bash intact otherwise — which also
   leaves ssh's stdin free to carry a file into it. Retried when the LINE
   fails (exit 255), never when the script does. */
async function remote(script, { input = null, pipeFrom = null, echo = false, timeoutMs, retry = true } = {}) {
  const host = await pickHost();
  const b64 = Buffer.from('set -e\n' + script, 'utf8').toString('base64');
  const arg = `bash -c "$(echo ${b64} | base64 -d)"`;
  const tries = retry && !pipeFrom ? 3 : 1;
  let r;
  for (let i = 0; i < tries; i++) {
    r = await sh('ssh', [...sshOpts(host), arg], { input, pipeFrom, echo, timeoutMs });
    if (r.code !== 255) return r;
    await new Promise((z) => setTimeout(z, 3000));
  }
  return r;
}

/* ------------------------------------------------------------ this laptop */

const ENV_FILE = Env.envFilePath();
const readEnvText = () => (existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').replace(/^﻿/, '') : '');
const eol = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const keyOf = (line) => {
  const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(line);
  return m ? m[1] : null;
};

/* Every KEY=value in the file, the parked ones included — a standby laptop
   still holds the secrets, parked, which is what lets `env` be run again. */
function envValues(text) {
  const active = Env.parse(text);
  const parked = Env.parse(text.split(/\r?\n/).filter((l) => l.startsWith(PARKED)).map((l) => l.slice(PARKED.length)).join('\n'));
  return { ...parked, ...active };
}

const isStandbyHere = (text) => String(Env.parse(text).OG_ROLE || '').toLowerCase() === 'standby';

function backupEnv(text, why) {
  const to = `${ENV_FILE}.before-${why}-${Backup.stamp()}`;
  writeFileSync(to, text);
  return to;
}

async function localShopRunning() {
  const port = Number(Env.parse(readEnvText()).OG_PORT || process.env.OG_PORT || 8090);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
    return r.status > 0;
  } catch { return false; }
}

async function needLocalShopClosed() {
  if (await localShopRunning()) {
    fail('The shop is open on THIS laptop. Close it in OG System (Close the shop), then run this again.');
  }
}

async function health(url, ms = 8000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { Accept: 'application/json' } });
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  } catch (e) {
    return { status: null, error: (e.cause && e.cause.code) || e.name || 'net' };
  }
}

/* ----------------------------------------------------------- the VPS side */

async function vpsFacts() {
  const r = await remote(`
    echo "state=$(docker ps -a --filter 'name=^og-shop$' --format '{{.State}}' 2>/dev/null | head -1)"
    echo "health=$(docker inspect og-shop --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)"
    echo "started=$(docker inspect og-shop --format '{{.State.StartedAt}}' 2>/dev/null || true)"
    echo "image=$(docker inspect og-shop --format '{{.Config.Image}}' 2>/dev/null || true)"
    echo "db=$(stat -c %s ${DIR}/data/og.db 2>/dev/null || echo none)"
    echo "env=$([ -s ${DIR}/og-shop.env ] && echo yes || echo no)"
    echo "build=$(sed -n 's/^OG_BUILD=//p' ${DIR}/.env 2>/dev/null || true)"
    echo "next=$(sed -n 's/^OG_BUILD=//p' ${DIR}/.env.next 2>/dev/null || true)"
    echo "backup=$(ls -1t ${DIR}/data/backups 2>/dev/null | head -1)"
    echo "wg=$(ip -4 addr show wg0 2>/dev/null | grep -q 'inet ${TUNNEL_VPS}/' && echo up || echo down)"
    echo "afterwg=$([ -f /etc/systemd/system/docker.service.d/og-after-wireguard.conf ] && echo yes || echo no)"
    echo "gateway=$(docker network inspect coolify --format '{{range .IPAM.Config}}{{if .Gateway}}{{.Gateway}} {{end}}{{end}}' 2>/dev/null | tr ' ' '\\n' | grep -m1 '\\.' || true)"
  `);
  if (r.code !== 0) fail('Could not read the VPS: ' + (r.err || r.out).trim().slice(0, 400));
  const f = {};
  for (const line of r.out.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) f[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  /* 'true' | 'false' | 'none' — no container at all is its own answer. */
  f.running = !f.state ? 'none' : (f.state === 'running' ? 'true' : 'false');
  return f;
}

async function waitHealthy(limitMs = 240000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < limitMs) {
    const r = await remote(`docker inspect og-shop --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || echo gone`);
    const s = r.out.trim();
    if (s !== last) { say('    ' + s); last = s; }
    if (/running healthy/.test(s)) return true;
    if (/exited|dead|gone/.test(s)) return false;
    await new Promise((z) => setTimeout(z, 4000));
  }
  return false;
}

async function showServerLines(n = 60) {
  const r = await remote(`docker logs --tail ${n} og-shop 2>&1 || true`);
  const keep = r.out.split(/\r?\n/).filter((l) =>
    /listening|mirror|Supabase|Telegram|standby|refused|lineage|error|Error|warn|FAIL|reminder|feed|notice|pull/i.test(l));
  for (const l of keep.slice(-25)) say('    ' + l.slice(0, 200));
}

/* ================================================================ commands */

async function cmdStatus() {
  say('\n  OG SYSTEM on the VPS\n');
  const f = await vpsFacts();
  say(`  VPS (via ${HOST})`);
  say(`    container : ${f.running === 'none' ? 'not created' : (f.running === 'true' ? 'running' : 'stopped')}${f.health ? ' · ' + f.health : ''}${f.started && f.running === 'true' ? ' · since ' + f.started.slice(0, 19).replace('T', ' ') + ' UTC' : ''}`);
  say(`    code      : ${f.build || '(never deployed)'}${f.image ? '  [' + f.image + ']' : ''}`);
  say(`    database  : ${f.db === 'none' ? 'none yet' : Math.round(Number(f.db) / 1024) + ' KB'}${f.backup ? ' · newest backup ' + f.backup : ''}`);
  say(`    settings  : ${f.env === 'yes' ? 'og-shop.env present' : 'none yet (npm run vps -- env)'}`);
  say(`    WireGuard : ${f.wg}${f.afterwg === 'yes' ? '' : ' · Docker does not wait for it yet (npm run vps -- setup)'}`);
  const direct = await health(`${VPS_URL}/api/health`);
  say(`    answers   : ${direct.status ? direct.status + (direct.body ? ' · role ' + (direct.body.role || '?') : '') : 'no (' + direct.error + ')'} on ${VPS_URL}`);
  const pub = await health(`https://${DOMAIN}/api/health`, 15000);
  const lan = pub.body && Array.isArray(pub.body.lan) ? pub.body.lan.join(' ') : '';
  let who = '';
  if (pub.body && pub.body.ok) who = /10\.8\.0\.2/.test(lan) ? ' · answered by THIS LAPTOP (through the tunnel)' : ' · answered by the VPS';
  say(`\n  ${DOMAIN}`);
  say(`    ${pub.status ? pub.status + (pub.body && pub.body.code ? ' ' + pub.body.code : '') + (pub.body && pub.body.role ? ' · role ' + pub.body.role : '') + who : 'no answer (' + pub.error + ')'}`);
  const text = readEnvText();
  const running = await localShopRunning();
  say('\n  This laptop');
  say(`    role      : ${isStandbyHere(text) ? 'STANDBY (follows ' + (Env.parse(text).OG_UPSTREAM || '?') + ')' : 'main server (primary)'}`);
  say(`    shop here : ${running ? 'open' : 'closed'}`);
  say('');
}

async function cmdSetup() {
  say('\n  Preparing the VPS\n');
  const r = await remote(`
    mkdir -p ${DIR}/data/backups ${DIR}/releases
    chown 1000:1000 ${DIR}/data ${DIR}/data/backups
    chmod 700 ${DIR}
    docker network inspect coolify >/dev/null
    ip -4 addr show wg0 | grep -q 'inet ${TUNNEL_VPS}/'
    mkdir -p /etc/systemd/system/docker.service.d
    F=/etc/systemd/system/docker.service.d/og-after-wireguard.conf
    printf '%s\\n' \\
      '# og-shop publishes its port on the WireGuard address (${TUNNEL_VPS}), which' \\
      '# exists only once wg0 is up. Without this a reboot can start Docker first,' \\
      '# and the shop container cannot bind its port. Written by npm run vps -- setup.' \\
      '[Unit]' 'Wants=wg-quick@wg0.service' 'After=wg-quick@wg0.service' > "$F.new"
    if ! cmp -s "$F.new" "$F"; then mv "$F.new" "$F"; systemctl daemon-reload; echo changed; else rm -f "$F.new"; echo same; fi
  `);
  if (r.code !== 0) fail('Setup failed on the VPS:\n' + (r.err || r.out).trim().slice(0, 800));
  ok(`${DIR}/ with data/ owned by the container's user`);
  ok('the coolify network is there, and wg0 holds ' + TUNNEL_VPS);
  ok('Docker starts after WireGuard from the next boot on' + (/changed/.test(r.out) ? ' (just written)' : ''));
  say('');
}

async function cmdDeploy({ start = true, ref = 'HEAD' } = {}) {
  const rev = await sh('git', ['-C', ROOT, 'rev-parse', '--short=12', ref]);
  const sha = rev.out.trim();
  if (rev.code !== 0 || !/^[0-9a-f]{7,40}$/.test(sha)) fail(`Not a commit here: ${ref}`);
  const subject = (await sh('git', ['-C', ROOT, 'log', '-1', '--format=%s', sha])).out.trim();
  say(`\n  Sending ${sha} — ${subject}\n`);
  if (ref === 'HEAD') {
    const dirty = (await sh('git', ['-C', ROOT, 'status', '--porcelain', '--', ...SHIP])).out.trim();
    if (dirty) {
      warn('these changes are NOT committed and do not go (only the commit does):');
      for (const l of dirty.split(/\r?\n/).slice(0, 12)) say('      ' + l);
    }
  }
  const f = await vpsFacts();
  if (f.wg !== 'up') fail('WireGuard is not up on the VPS (wg0 has no ' + TUNNEL_VPS + ').');
  /* Compose reads og-shop.env even to BUILD (it is `required`), so the
     settings go first — `switch` runs them in that order. */
  if (f.env !== 'yes') fail('The VPS has no settings yet — run: npm run vps -- env');

  /* The code, straight out of git into the release folder. */
  const up = await remote(`
    R=${DIR}/releases/${sha}
    rm -rf "$R.part" && mkdir -p "$R.part"
    tar -x -C "$R.part"
    rm -rf "$R" && mv "$R.part" "$R"
    cp "$R/deploy/og-shop/docker-compose.yml" ${DIR}/docker-compose.yml
    cd ${DIR}/releases && ls -1t | tail -n +6 | xargs -r rm -rf
    echo sent
  `, {
    pipeFrom: (stdin) => {
      const g = spawn('git', ['-C', ROOT, 'archive', '--format=tar', sha, ...SHIP], { windowsHide: true });
      g.stdout.pipe(stdin);
      g.stderr.on('data', (b) => process.stderr.write(b));
    },
    timeoutMs: 15 * 60000
  });
  if (up.code !== 0 || !/sent/.test(up.out)) fail('The code did not arrive:\n' + (up.err || up.out).trim().slice(0, 800));
  ok('code on the VPS');

  say('  building (the tests run first) ...');
  const b = await remote(`cd ${DIR} && OG_BUILD=${sha} docker compose build 2>&1 | tail -n 25`, { timeoutMs: 20 * 60000 });
  for (const l of b.out.trim().split(/\r?\n/).slice(-8)) say('    ' + l);
  const img = await remote(`docker image inspect og-shop:${sha} >/dev/null 2>&1 && echo yes || echo no`);
  if (img.out.trim() !== 'yes') fail('The build did not produce og-shop:' + sha + '. Nothing was changed on the VPS.');
  ok(`built og-shop:${sha}`);

  if (!start) {
    await remote(`echo OG_BUILD=${sha} > ${DIR}/.env.next`);
    say('  (not started: --no-start)\n');
    return sha;
  }
  if (f.db === 'none') fail('The VPS has no database yet — run: npm run vps -- db (or the whole switch).');
  await startOn(sha);
  return sha;
}

async function startOn(sha) {
  say(`  starting ${sha} ...`);
  const r = await remote(`cd ${DIR} && echo OG_BUILD=${sha} > .env && rm -f .env.next && docker compose up -d --force-recreate 2>&1 | tail -n 5`);
  if (r.code !== 0) fail('docker compose up failed:\n' + (r.err || r.out).trim().slice(0, 800));
  if (!(await waitHealthy())) {
    say('\n  The container is not healthy. Its last lines:');
    await showServerLines(80);
    fail('The shop did not come up on the VPS. Nothing on this laptop was changed by this step.');
  }
  ok('the container is running and healthy');
  const h = await health(`${VPS_URL}/api/health`);
  if (!(h.body && h.body.ok)) fail(`${VPS_URL}/api/health did not answer ok (${h.status || h.error}).`);
  ok(`${VPS_URL} answers · role ${h.body.role || '?'} · shop "${h.body.shop || '?'}"`);
}

async function cmdEnv() {
  say('\n  The VPS\'s settings\n');
  let text = readEnvText();
  if (!text) fail(`No ${ENV_FILE} here to copy from.`);
  let v = envValues(text);
  if (!v.OG_COPY_KEY) {
    /* One key, two ends: the VPS hands its copy out to it, the standby here
       asks with it. Written here first, so both ends always agree. */
    const key = randomBytes(32).toString('hex');
    const e = eol(text);
    text = text.replace(/\s*$/, '') + e + e +
      '# The key a standby copy asks the main server with (npm run vps -- env).' + e +
      'OG_COPY_KEY=' + key + e;
    writeFileSync(ENV_FILE, text);
    v = envValues(text);
    ok('made OG_COPY_KEY and wrote it to this laptop\'s server/.env');
  }
  const missing = ['SUPABASE_URL', 'OG_VAULT_KEY'].filter((k) => !v[k]);
  if (!v.SUPABASE_SECRET_KEY && !v.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SECRET_KEY');
  if (missing.length) fail('This laptop\'s .env has no ' + missing.join(', ') + ' — the VPS cannot be the main server without it.');

  const f = await vpsFacts();
  const gateway = f.gateway;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(gateway || '')) fail('Could not read the coolify network\'s gateway on the VPS.');

  const lines = [
    `# og-shop on the VPS — written by npm run vps -- env on ${hostname()} at ${new Date().toISOString()}.`,
    '# Overwritten by the next run of that command. Anything VPS-only goes in extra.env beside it.',
    `OG_ORIGINS='https://${DOMAIN},https://www.${DOMAIN}'`,
    `# The shop-proxy's requests arrive from the coolify network's gateway (measured): its X-OG-Client-IP is believed from there only.`,
    `OG_PROXY_ADDR='${gateway}'`,
    "OG_SECURE='1'",
    "TZ='Asia/Damascus'"
  ];
  const sent = [];
  for (const k of COPY) {
    let val = v[k];
    if (k === 'OG_SYNC_MINUTES' && !val) val = '60';
    if (k === 'OG_PULL_AT_BOOT' && !val) val = '1';
    if (!val) continue;
    if (/['\r\n]/.test(val)) fail(`${k} holds a quote or a line break, which the VPS settings file cannot carry. Nothing was sent.`);
    lines.push(`${k}='${val}'`);
    sent.push(k);
  }
  const body = lines.join('\n') + '\n';
  const r = await remote(`umask 077; mkdir -p ${DIR}; cat > ${DIR}/og-shop.env.part; mv ${DIR}/og-shop.env.part ${DIR}/og-shop.env; chmod 600 ${DIR}/og-shop.env; echo written`, { input: body });
  if (r.code !== 0 || !/written/.test(r.out)) fail('Could not write the settings on the VPS:\n' + (r.err || r.out).trim().slice(0, 400));
  ok(`${DIR}/og-shop.env (600) — ${sent.length} copied, values not shown:`);
  say('      ' + sent.join(', '));
  ok(`OG_ORIGINS https://${DOMAIN} · OG_PROXY_ADDR ${gateway}`);
  if (!v.OG_TELEGRAM_TOKEN_OG) warn('no OG_TELEGRAM_TOKEN_OG here: the shop\'s bot will be silent on the VPS');
  if (f.running === 'true') say('\n  The shop is running on the VPS — apply with: npm run vps -- restart');
  say('');
}

async function cmdDb({ replace = false, force = false } = {}) {
  say('\n  This laptop\'s database to the VPS\n');
  await needLocalShopClosed();
  const text = readEnvText();
  if (isStandbyHere(text) && !force) {
    fail('This laptop is a STANDBY: its database is a copy OF the VPS. Sending it back would throw away what the VPS did since. (--force if you really mean it.)');
  }
  const f = await vpsFacts();
  if (f.running === 'true') fail('The shop is RUNNING on the VPS: its database is the live one. Stop it first (npm run vps -- stop) if you really mean to replace it.');
  if (f.db !== 'none' && !replace) fail(`The VPS already has a database (${Math.round(Number(f.db) / 1024)} KB). Add --replace to set it aside and send this one.`);

  const src = Env.dbFile();
  const tmp = join(tmpdir(), `og-vps-${Backup.stamp()}.db`);
  Backup.snapshot(src, tmp);
  const v = Backup.verify(tmp);
  if (!v.ok) { try { unlinkSync(tmp); } catch { /* */ } fail('The snapshot did not verify: ' + v.reason); }
  const d = new DatabaseSync(tmp, { readOnly: true });
  const last = d.prepare('SELECT id, at FROM sales ORDER BY at DESC LIMIT 1').get();
  const users = d.prepare('SELECT COUNT(*) n FROM users WHERE active = 1').get().n;
  d.close();
  const sum = createHash('sha256').update(readFileSync(tmp)).digest('hex');
  ok(`snapshot verified — ${Math.round(statSync(tmp).size / 1024)} KB, ${users} working accounts, last sale ${last ? last.id + ' at ' + last.at : 'none'}`);

  let sentOk = false;
  for (let i = 0; i < 3 && !sentOk; i++) {
    const r = await remote(`umask 077; mkdir -p ${DIR}/incoming; cat > ${DIR}/incoming/og.db.part; sha256sum ${DIR}/incoming/og.db.part | cut -c1-64`, {
      pipeFrom: (stdin) => createReadStream(tmp).pipe(stdin), timeoutMs: 10 * 60000
    });
    sentOk = r.code === 0 && r.out.trim() === sum;
    if (!sentOk) warn('upload ' + (i + 1) + ' did not arrive whole' + (i < 2 ? ', again ...' : ''));
  }
  unlinkSync(tmp);
  if (!sentOk) fail('The database did not arrive whole after three tries. Nothing on the VPS was replaced.');
  const stamp = Backup.stamp();
  const mv = await remote(`
    cd ${DIR}/data
    if [ -e og.db ]; then mkdir -p replaced-${stamp}; mv og.db* replaced-${stamp}/; echo "set aside: replaced-${stamp}"; fi
    mv ${DIR}/incoming/og.db.part og.db
    chown 1000:1000 og.db
    echo placed
  `);
  if (!/placed/.test(mv.out)) fail('Could not put the database in place:\n' + (mv.err || mv.out).trim().slice(0, 400));
  if (/set aside/.test(mv.out)) ok(mv.out.split('\n').find((l) => /set aside/.test(l)).trim());
  ok(`${DIR}/data/og.db — sha256 ${sum.slice(0, 16)}… matches`);
  say('');
}

function standbyText(text) {
  const e = eol(text);
  const kept = [];
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(BLOCK_START)) { inBlock = true; continue; }
    if (line.startsWith(BLOCK_END)) { inBlock = false; continue; }
    if (inBlock) continue;
    const k = keyOf(line);
    if (k && ['OG_ROLE', 'OG_UPSTREAM', 'OG_STANDBY_ID', 'OG_STANDBY_HOME'].includes(k)) continue;
    kept.push(k && PARK.includes(k) ? PARKED + line : line);
  }
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  return kept.join(e) + e + e + [
    `${BLOCK_START} (npm run vps -- laptop-standby, ${new Date().toISOString()})`,
    `# The shop's main server is the VPS: https://${DOMAIN}. This laptop keeps a`,
    '# copy every five minutes and takes the till if the internet drops. The lines',
    `# starting "${PARKED.trim()}" are parked, not deleted: npm run vps -- take-back restores them.`,
    'OG_ROLE=standby',
    `OG_UPSTREAM=${VPS_URL}`,
    'OG_STANDBY_ID=shop-laptop',
    `OG_STANDBY_HOME=https://${DOMAIN}`,
    BLOCK_END
  ].join(e) + e;
}

function primaryText(text) {
  const e = eol(text);
  const kept = [];
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(BLOCK_START)) { inBlock = true; continue; }
    if (line.startsWith(BLOCK_END)) { inBlock = false; continue; }
    if (inBlock) continue;
    kept.push(line.startsWith(PARKED) ? line.slice(PARKED.length) : line);
  }
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  return kept.join(e) + e;
}

async function cmdLaptopStandby() {
  say('\n  This laptop becomes the standby\n');
  await needLocalShopClosed();
  const text = readEnvText();
  if (!envValues(text).OG_COPY_KEY) fail('No OG_COPY_KEY yet — run npm run vps -- env first (it makes one for both ends).');
  if (isStandbyHere(text)) { ok('already the standby'); say(''); return; }
  const saved = backupEnv(text, 'standby');
  writeFileSync(ENV_FILE, standbyText(text));
  const parked = Object.keys(Env.parse(text)).filter((k) => PARK.includes(k));
  ok(`server/.env — the old one kept as ${shortPath(saved)}`);
  ok(`OG_ROLE=standby, following ${VPS_URL}`);
  ok('parked (not deleted): ' + (parked.join(', ') || 'nothing to park'));
  say('\n  OG System follows the new file the next time it opens the shop here. (A window open since');
  say('  before this update: quit it from the tray and open it again.)\n');
}

const shortPath = (p) => (p.startsWith(SERVER) ? 'server' + p.slice(SERVER.length).replace(/\\/g, '/') : p);

async function cmdSwitch({ go = false } = {}) {
  say('\n  THE SWITCH: the VPS becomes the shop\'s main server, this laptop its standby\n');
  const text = readEnvText();
  const f = await vpsFacts();
  const running = await localShopRunning();
  say('  now:');
  say(`    this laptop : ${isStandbyHere(text) ? 'already a standby' : 'main server'} · shop here ${running ? 'OPEN' : 'closed'}`);
  say(`    VPS         : container ${f.running === 'none' ? 'not created' : f.running === 'true' ? 'running' : 'stopped'} · database ${f.db === 'none' ? 'none' : 'present'} · WireGuard ${f.wg}`);
  say('\n  the order:');
  say('    1  setup           the folder, Docker after WireGuard');
  say('    2  env             the VPS\'s settings from this laptop\'s .env');
  say('    3  deploy          build this commit on the VPS (nothing starts)');
  say('    4  laptop-standby  THIS laptop can no longer write to the cloud or the bots');
  say('    5  db              this laptop\'s database, verified, to the VPS');
  say('    6  start           the VPS shop, checked: healthy, role primary');
  if (!go) { say('\n  Nothing done. Run it with --go.\n'); return; }
  if (running) fail('Close the shop on this laptop first (OG System -> Close the shop).');
  if (isStandbyHere(text)) fail('This laptop is already a standby — the switch has been made. See: npm run vps -- status');
  if (f.running === 'true') fail('A shop is already running on the VPS. See: npm run vps -- status');

  await cmdSetup();
  await cmdEnv();
  const sha = await cmdDeploy({ start: false });
  await cmdLaptopStandby();
  await cmdDb({ replace: f.db !== 'none', force: true });
  say('\n  Starting the shop on the VPS\n');
  await startOn(sha);
  say('\n  Its first words:');
  await showServerLines(80);
  say(`
  DONE ON BOTH MACHINES. One step is left, and it is Coolify's:

    Coolify -> og-system -> the shop-proxy app (${DOMAIN})
      -> Environment Variables -> SHOP_UPSTREAM = ${VPS_URL}
      -> Save -> Redeploy

  Until then ${DOMAIN} still goes to this laptop. On this laptop, OG System
  opens the BACKUP COPY from now on (from its Tools button it does so by itself;
  from a terminal, press "Open the backup copy").
  Check any time with: npm run vps -- status
`);
}

async function cmdTakeBack({ go = false } = {}) {
  say('\n  THE WAY BACK: this laptop becomes the main server again\n');
  say('  1 stop the VPS shop · 2 bring its database here (this one is kept aside)');
  say('  3 un-park this laptop\'s .env · then Coolify: SHOP_UPSTREAM back to https://10.8.0.2:8443');
  if (!go) { say('\n  Nothing done. Run it with --go.\n'); return; }
  await needLocalShopClosed();
  const outbox = join(Env.dataDir(), 'outbox.db');
  if (existsSync(outbox)) {
    /* The same question Outbox.counts() asks: work taken offline that the
       VPS has not had yet. Going home without it would lose those sales. */
    let n = 0;
    try {
      const o = new DatabaseSync(outbox, { readOnly: true });
      n = o.prepare("SELECT COUNT(*) AS n FROM entries WHERE state IN ('open','ready')").get().n;
      o.close();
    } catch (e) { warn('could not read the outbox: ' + e.message); }
    if (n) fail(`This laptop's outbox holds ${n} change(s) taken while offline and not yet sent to the VPS. Open the shop here as the standby until they are sent, then run this again.`);
  }
  say('\n  stopping the VPS shop ...');
  const st = await remote(`cd ${DIR} && docker compose stop 2>&1 | tail -n 3; docker inspect og-shop --format '{{.State.Running}}'`);
  if (!/false/.test(st.out)) fail('The VPS shop did not stop:\n' + (st.err || st.out).trim().slice(0, 400));
  ok('stopped (it stays stopped, reboots included, until npm run vps -- start)');
  const sum = (await remote(`cd ${DIR}/data && ls og.db-wal >/dev/null 2>&1 && echo WAL || true; sha256sum og.db | cut -c1-64`)).out.trim().split(/\r?\n/);
  if (sum[0] === 'WAL') fail('The VPS database still has a WAL file after stopping — not bringing a half-written file home. Start and stop it once more.');
  const want = sum[sum.length - 1];
  const tmp = join(tmpdir(), `og-from-vps-${Backup.stamp()}.db`);
  const host = await pickHost();
  const dl = await new Promise((done) => {
    const out = createWriteStream(tmp);
    const p = spawn('ssh', [...sshOpts(host), `cat ${DIR}/data/og.db`], { windowsHide: true });
    let code, written = false;
    const end = () => { if (written && code !== undefined) done(code); };
    out.on('finish', () => { written = true; end(); });
    p.on('error', () => { code = null; out.end(); });
    p.on('close', (c) => { code = c; end(); });
    p.stdout.pipe(out);
  });
  const got = existsSync(tmp) ? createHash('sha256').update(readFileSync(tmp)).digest('hex') : '';
  if (dl !== 0 || got !== want) fail('The VPS database did not arrive whole. Nothing here was changed; the VPS shop is stopped (npm run vps -- start to undo).');
  const v = Backup.verify(tmp);
  if (!v.ok) fail('The VPS database did not verify: ' + v.reason);
  ok('the VPS database is here and verified');
  const db = Env.dbFile();
  const aside = join(Env.backupDir(), `before-take-back-${Backup.stamp()}`);
  mkdirSync(aside, { recursive: true });
  for (const sfx of ['', '-wal', '-shm']) if (existsSync(db + sfx)) renameSync(db + sfx, join(aside, 'og.db' + sfx));
  copyFileSync(tmp, db);
  unlinkSync(tmp);
  ok(`installed; this laptop's old copy is in ${aside}`);
  const text = readEnvText();
  const saved = backupEnv(text, 'take-back');
  writeFileSync(ENV_FILE, primaryText(text));
  ok(`server/.env un-parked (the standby one kept as ${shortPath(saved)})`);
  say(`
  Now: Coolify -> the shop-proxy app -> SHOP_UPSTREAM = https://10.8.0.2:8443 -> Redeploy.
  OG System opens this laptop as the shop the next time it opens the shop here.
`);
}

/* ------------------------------------------------------------------- main */

/* The two .env rewrites are pure, and server/test/vps-env.test.js holds them
   to a round trip; importing this file for them must not run a command. */
export { standbyText, primaryText, envValues, PARK, PARKED };

async function main() {
  const [cmd = 'status', ...rest] = process.argv.slice(2);
  const flag = (f) => rest.includes(f);
  const refAt = rest.indexOf('--ref');
  Env.load();
  switch (cmd) {
    case 'status': await cmdStatus(); break;
    case 'setup': await cmdSetup(); break;
    case 'deploy': await cmdDeploy({ start: !flag('--no-start'), ref: refAt > -1 ? rest[refAt + 1] : 'HEAD' }); say(''); break;
    case 'env': await cmdEnv(); break;
    case 'db': await cmdDb({ replace: flag('--replace'), force: flag('--force') }); break;
    case 'laptop-standby': await cmdLaptopStandby(); break;
    case 'switch': await cmdSwitch({ go: flag('--go') }); break;
    case 'take-back': await cmdTakeBack({ go: flag('--go') }); break;
    case 'start':
    case 'restart': {
      /* Start takes a build made with --no-start; restart keeps what runs. */
      const f = await vpsFacts();
      const sha = (cmd === 'start' && f.next) || f.build;
      if (!sha) fail('Nothing deployed yet: npm run vps -- deploy');
      if (f.env !== 'yes' || f.db === 'none') fail('The VPS has no ' + (f.env !== 'yes' ? 'settings' : 'database') + ' yet — see npm run vps -- switch');
      await startOn(sha); say(''); break;
    }
    case 'stop': {
      const r = await remote(`cd ${DIR} && docker compose stop 2>&1 | tail -n 3`);
      say(r.out.trim()); ok('stopped — it stays stopped, reboots included, until npm run vps -- start'); break;
    }
    case 'logs': {
      const n = Math.min(2000, Math.max(1, Number(rest[0]) || 120));
      const r = await remote(`docker logs --tail ${n} og-shop 2>&1`);
      process.stdout.write(r.out); break;
    }
    default:
      fail(`Unknown: ${cmd}. One of: status setup deploy env db laptop-standby switch take-back start stop restart logs`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
}
