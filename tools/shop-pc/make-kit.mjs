#!/usr/bin/env node
/* =============================================================================
   tools/shop-pc/make-kit.mjs - build the folder that goes on the USB stick and
   sets up the SHOP PC (the till's hardware hub and the VPS's offline standby).

     node tools/shop-pc/make-kit.mjs                 build into ..\OG-Shop-PC
     node tools/shop-pc/make-kit.mjs --out E:\OG     straight onto the stick
     node tools/shop-pc/make-kit.mjs --no-download   reuse the installers already there

   What it makes:
     app/            the COMMITTED code (git archive), never the working tree -
                     the shop PC must run what the VPS runs, and an uncommitted
                     edit is not on the VPS
     installers/     Node.js, WireGuard (both signature-checked by setup.ps1),
                     Sysinternals Autologon
     secrets/        server/.env for a standby, the agent's logins, the shop PC's
                     own WireGuard key. KEEP ON THE STICK; never chat or email it
     for-the-vps/    the one script that adds the shop PC to the tunnel
     setup.ps1 + 1-Install.cmd / 2-Update.cmd / 3-Check.cmd, START-HERE.txt

   Updating the shop PC later is the same command after a deploy: copy the
   new folder over, run 2-Update.cmd. The tunnel key is made ONCE and kept in
   _secrets/wg-shop-pc.key, so a rebuilt kit never invalidates the VPS peer.
   ============================================================================= */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseEnv } from '../../server/lib/env.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const OUT = resolve(opt('--out', join(ROOT, '..', 'OG-Shop-PC')));
const DOWNLOAD = !argv.includes('--no-download');

const PEER_ADDR = '10.8.0.3';
const STANDBY_ID = 'shop-pc';
const WG = join(process.env.ProgramFiles || 'C:\\Program Files', 'WireGuard', 'wg.exe');
const TAR = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

/* The allow-list of what the shop PC runs. A new top-level folder does not
   reach the shop by being forgotten about; it reaches it by being named. */
const SHIP = ['index.html', 'manifest.webmanifest', 'sw.js', 'robots.txt', 'package.json',
  'css', 'js', 'assets', 'server', 'panel', 'agent', 'OG System.exe', 'start-og-system.bat',
  'tools/wg-test/till-side.ps1', 'tools/wg-test/FALLBACK.md'];

const say = (s = '') => process.stdout.write(s + '\n');
const ok = (s) => say('  \u2713 ' + s);
const warn = (s) => say('  ! ' + s);
const die = (s) => { say('  \u2717 ' + s); process.exit(1); };
const git = (...a) => {
  const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) die('git ' + a.join(' ') + ': ' + (r.stderr || '').trim());
  return r.stdout.trim();
};
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

say('');
say('  OG SYSTEM - the shop PC kit');
say('    into : ' + OUT);
if (OUT === ROOT || OUT.startsWith(ROOT + '\\') || OUT.startsWith(ROOT + '/')) die('Refusing to build inside the repository.');

/* ---- 1. Which code ---------------------------------------------------------- */
say('');
say('1. The code');
const sha = git('rev-parse', 'HEAD');
const short = sha.slice(0, 12);
const subject = git('log', '-1', '--format=%s');
const dirty = git('status', '--porcelain', '--', ...SHIP);
if (dirty) warn('uncommitted changes in shipped files are NOT in the kit (only the commit is):\n' + dirty.split('\n').map((l) => '      ' + l).join('\n'));
ok('commit ' + short + ' - ' + subject);

let vps = 'unknown';
const v = spawnSync(process.execPath, ['server/scripts/vps.js', 'built'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 40000 });
const built = (v.stdout || '').trim().split(/\s+/).pop() || '';
if (v.status === 0 && /^[0-9a-f]{7,40}$/.test(built)) {
  vps = built.slice(0, 12);
  if (sha.startsWith(vps) || vps.startsWith(short)) ok('the VPS runs this same commit');
  else warn('THE VPS RUNS ' + vps + ', NOT ' + short + '. The standby should run what the VPS runs:\n' +
    '      wait for auto-publish to deploy, or check out ' + vps + ' and build the kit from that.');
} else warn('could not ask the VPS which commit it runs (tunnel/SSH) - check by hand: npm run vps -- status');

/* ---- 2. The app -------------------------------------------------------------- */
say('');
say('2. The app (git archive of ' + short + ')');
mkdirSync(OUT, { recursive: true });
const APP = join(OUT, 'app');
rmSync(APP, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });
const arch = spawnSync('git', ['archive', '--format=tar', sha, '--', ...SHIP], { cwd: ROOT, maxBuffer: 1 << 30, windowsHide: true });
if (arch.status !== 0) die('git archive: ' + String(arch.stderr));
const untar = spawnSync(existsSync(TAR) ? TAR : 'tar', ['-xf', '-'], { cwd: APP, input: arch.stdout, windowsHide: true });
if (untar.status !== 0) die('tar: ' + String(untar.stderr));
/* `_`-files are harnesses: the server refuses to serve them anyway. */
let files = 0, bytes = 0;
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (n.startsWith('_')) unlinkSync(p);
    else { files++; bytes += st.size; }
  }
})(APP);
if (!existsSync(join(APP, 'OG System.exe')) || !existsSync(join(APP, 'panel', 'panel.js'))) die('the archive is missing OG System.exe or panel/panel.js');
const version = `${short} - ${new Date().toISOString().slice(0, 10)} - ${subject}`;
writeFileSync(join(OUT, 'VERSION.txt'), crlf(version + '\nVPS runs: ' + vps + '\n'));
ok(`${files} files, ${(bytes / 1048576).toFixed(1)} MB`);

/* ---- 3. Installers ------------------------------------------------------------ */
say('');
say('3. Installers');
const INST = join(OUT, 'installers');
mkdirSync(INST, { recursive: true });
const have = (re) => readdirSync(INST).find((n) => re.test(n));
async function get(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
async function installers() {
  if (!have(/^node-v.*-x64\.msi$/)) {
    const base = 'https://nodejs.org/dist/latest-v24.x/';
    const sums = (await get(base + 'SHASUMS256.txt')).toString();
    const line = sums.split('\n').find((l) => /node-v[\d.]+-x64\.msi$/.test(l.trim()));
    if (!line) throw new Error('no x64 msi in ' + base);
    const [hash, name] = line.trim().split(/\s+/);
    const buf = await get(base + name);
    if (createHash('sha256').update(buf).digest('hex') !== hash) throw new Error(name + ': sha256 does not match nodejs.org');
    writeFileSync(join(INST, name), buf);
    ok(name + ' (sha256 checked)');
  } else ok(have(/^node-v.*-x64\.msi$/) + ' (kept)');

  if (!have(/^wireguard-amd64-.*\.msi$/)) {
    const base = 'https://download.wireguard.com/windows-client/';
    const list = (await get(base)).toString();
    const names = [...list.matchAll(/wireguard-amd64-([\d.]+)\.msi/g)].map((m) => m[0]);
    const verOf = (n) => n.match(/([\d.]+)\.msi/)[1].split('.').map(Number);
    names.sort((a, b) => { const x = verOf(a), y = verOf(b); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; });
    const name = names.pop();
    if (!name) throw new Error('no amd64 msi listed at ' + base);
    writeFileSync(join(INST, name), await get(base + name));
    ok(name + ' (its signature is checked on the shop PC)');
  } else ok(have(/^wireguard-amd64-.*\.msi$/) + ' (kept)');

  if (!have(/^Autologon64\.exe$/)) {
    const zip = join(INST, 'AutoLogon.zip');
    writeFileSync(zip, await get('https://download.sysinternals.com/files/AutoLogon.zip'));
    const x = spawnSync(existsSync(TAR) ? TAR : 'tar', ['-xf', zip, 'Autologon64.exe'], { cwd: INST, windowsHide: true });
    rmSync(zip, { force: true });
    if (x.status !== 0 || !have(/^Autologon64\.exe$/)) throw new Error('could not unpack Autologon64.exe');
    ok('Autologon64.exe (Sysinternals)');
  } else ok('Autologon64.exe (kept)');
}
if (DOWNLOAD) {
  try { await installers(); }
  catch (e) { warn('download failed: ' + e.message + '\n      setup.ps1 says which one is missing; run again, or --no-download.'); }
} else ok('--no-download: ' + (readdirSync(INST).join(', ') || 'nothing there'));

/* ---- 4. Secrets ----------------------------------------------------------------- */
say('');
say('4. Secrets (for the stick only)');
const SEC = join(OUT, 'secrets');
mkdirSync(SEC, { recursive: true });

const keyFile = join(ROOT, '_secrets', 'wg-shop-pc.key');
if (!existsSync(WG)) die('WireGuard is not installed on this laptop (' + WG + ') - its wg.exe makes the key.');
if (!existsSync(keyFile)) {
  const k = spawnSync(WG, ['genkey'], { encoding: 'utf8', windowsHide: true });
  if (k.status !== 0) die('wg genkey failed');
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, k.stdout.trim());
  ok('made the shop PC\'s tunnel key (kept in _secrets/wg-shop-pc.key, reused on every rebuild)');
} else ok('tunnel key: the one already in _secrets/wg-shop-pc.key');
const priv = readFileSync(keyFile, 'utf8').trim();
const pub = spawnSync(WG, ['pubkey'], { input: priv, encoding: 'utf8', windowsHide: true }).stdout.trim();
if (!/^[A-Za-z0-9+/]{43}=$/.test(pub)) die('could not derive the public key');
writeFileSync(join(ROOT, '_secrets', 'wg-shop-pc.pub'), pub + '\n');
copyFileSync(keyFile, join(SEC, 'wg-shop-pc.key'));
const vpsPub = join(ROOT, '_secrets', 'wg-vps.pub');
if (!existsSync(vpsPub)) die('_secrets/wg-vps.pub is missing (the VPS\'s public key)');
copyFileSync(vpsPub, join(SEC, 'wg-vps.pub'));

const env = parseEnv(readFileSync(join(ROOT, 'server', '.env'), 'utf8'));
if (!env.OG_COPY_KEY) die('server/.env has no OG_COPY_KEY - the standby could not fetch its copy.');
writeFileSync(join(SEC, 'shop-pc.env'), crlf([
  `# OG System - the SHOP PC (tools/shop-pc/make-kit.mjs, ${new Date().toISOString().slice(0, 10)}, code ${short})`,
  '# The shop runs on the VPS (shop.ogsports1.com). This PC keeps a copy every',
  '# five minutes and takes the till if the internet drops. It deliberately holds',
  '# no Supabase keys, no bot tokens and no vault key: the VPS does all of that.',
  'OG_ROLE=standby',
  'OG_UPSTREAM=http://10.8.0.1:8090',
  `OG_STANDBY_ID=${STANDBY_ID}`,
  'OG_STANDBY_HOME=https://shop.ogsports1.com',
  `OG_COPY_KEY=${env.OG_COPY_KEY}`,
  `OG_TUNNEL_ADDR=${PEER_ADDR}`,
  '# Not a repository: never publish or deploy from here.',
  'OG_PANEL_AUTOSHIP=0',
  ''
].join('\n')));
ok('shop-pc.env (standby, OG_STANDBY_ID=' + STANDBY_ID + ', no cloud keys)');

const agentCfg = join(ROOT, 'agent', 'agent-config.json');
if (existsSync(agentCfg)) {
  const a = JSON.parse(readFileSync(agentCfg, 'utf8'));
  for (const k of ['username', 'password', 'labelUsername', 'labelPassword']) if (!a[k]) warn('agent-config.json has no ' + k);
  if (!/^https:\/\/shop\.ogsports1\.com/.test(a.serverUrl || '')) warn('agent serverUrl is ' + a.serverUrl + ', not the domain');
  writeFileSync(join(SEC, 'agent-config.json'), JSON.stringify(a, null, 2) + '\n');
  ok('agent-config.json (' + a.username + ' for receipts, ' + (a.labelUsername || a.username) + ' for labels)');
} else warn('agent/agent-config.json not found - the print agent will have no logins');

/* ---- 5. The VPS's half, and the scripts -------------------------------------------- */
say('');
say('5. Scripts');
const FV = join(OUT, 'for-the-vps');
mkdirSync(FV, { recursive: true });
const peer = readFileSync(join(HERE, 'vps-add-peer.sh'), 'utf8')
  .replace('__PEER_KEY__', pub).replace('__PEER_ADDR__', PEER_ADDR).replace('__PEER_NAME__', 'the shop PC');
writeFileSync(join(FV, 'add-shop-pc-peer.sh'), peer.replace(/\r\n/g, '\n'));
copyFileSync(join(HERE, 'setup.ps1'), join(OUT, 'setup.ps1'));
const cmd = (args, what) => crlf(`@echo off\r\nrem ${what}\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" ${args}\r\nif errorlevel 1 pause\r\n`);
writeFileSync(join(OUT, '1-Install.cmd'), cmd('', 'Set up the shop PC (safe to run again).'));
writeFileSync(join(OUT, '2-Update.cmd'), cmd('-Update', 'New code from this kit; keeps settings, database and logs.'));
writeFileSync(join(OUT, '3-Check.cmd'), cmd('-Check', 'Changes nothing; says what is wrong.'));
copyFileSync(join(HERE, 'START-HERE.txt'), join(OUT, 'START-HERE.txt'));
ok('setup.ps1, 1-Install.cmd, 2-Update.cmd, 3-Check.cmd, START-HERE.txt, for-the-vps/');

say('');
say('  Done: ' + version);
say('');
say('  BEFORE THE VISIT, from this laptop (adds the shop PC to the tunnel, keeps this laptop\'s):');
say('    ssh -o HostKeyAlias=152.239.114.129 root@10.8.0.1 "bash -s" < "' + join(FV, 'add-shop-pc-peer.sh') + '"');
say('  The shop PC\'s tunnel public key: ' + pub + '  (address ' + PEER_ADDR + ')');
say('');
