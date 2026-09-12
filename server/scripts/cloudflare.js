/* ==========================================================================
   OG SYSTEM — the Cloudflare connector, and the door it opens
   --------------------------------------------------------------------------
   Run:  cd server && npm run cloudflare            (checks, changes nothing)
         cd server && npm run cloudflare:connect    (installs it and connects)

   The panel's "Check Cloudflare" button runs the second one.

   WHAT IT IS FOR. The shop's server listens on this laptop and nowhere else.
   A phone on the shop wifi can reach it by IP; the owner at home and Yalla
   Wear across town cannot, because there is no public address to type and
   nothing here is going to open a port on a router in Aleppo.

   cloudflared solves that from the inside out. It is a small program that
   makes an OUTBOUND connection to Cloudflare and holds it open. Cloudflare
   then answers for the hostname below on the public internet and passes each
   request back down that connection to http://localhost:8090. No inbound
   port, no firewall rule, no fixed IP — and the padlock a phone sees is
   Cloudflare's own real certificate rather than the self-signed one
   lib/tls.js has to apologise for.

   IT DOES NOT STOP THE SHOP OPENING, and it is not on the path of a sale.
   Same rule as preflight.js and hardware.js: a till that cannot be reached
   from outside is still a till, and the cashier standing at it neither knows
   nor cares. Everything here reports and returns; nothing throws upward.

   THE THING THAT WILL BREAK IT, and it is not obvious. index.js swaps the
   handler on the plain HTTP port the moment a local certificate exists:

       const server = createServer(SECURE_SERVER ? httpHandler : handle);

   and httpHandler sends any browser asking for a page to
   `https://<host>:8443`. Through the tunnel that becomes a redirect to
   shop.ogsports1.com:8443, a port Cloudflare does not carry, and the site
   dies with no error anybody could read. So the check below LOOKS for that
   certificate and says so, because "it worked yesterday and today it does
   not" after somebody pressed Make certificate is a bad afternoon.

   Exit codes, the same three hardware.js uses and for the same reasons:

     0  the connector is installed, running, and the public address answers.
     4  something is missing that this script knows how to put right. The
        panel button runs the connect pass and then checks again.
     1  something is missing that needs a person — most often the tunnel
        token, which is a secret and cannot be invented from here.
   ========================================================================== */

import { spawnSync } from 'node:child_process';
import { existsSync, appendFileSync, mkdirSync, writeFileSync, statSync,
         readFileSync, rmSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, env, platform, execPath } from 'node:process';

import * as Env from '../lib/env.js';

Env.load();

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, '..');

/* ------------------------------------------------------------ what we are

   The tunnel was created once, by a person, in the Cloudflare dashboard, and
   its id is a public identifier rather than a secret — it names the tunnel,
   it does not authorise anything. The TOKEN is the secret, and it lives in
   server/.env, which is gitignored. Both are overridable so a second shop
   never has to edit this file. */

const TUNNEL_ID = Env.maybe('OG_CF_TUNNEL_ID', '4f576ce0-5467-4739-9840-0a4cef56b18e');
const HOSTNAME  = Env.maybe('OG_CF_HOSTNAME', 'shop.ogsports1.com');
const PORT      = Number(Env.maybe('OG_PORT', '8090'));

/* The official build, straight from Cloudflare's own releases. `latest`
   redirects to whatever the current version is, so this line does not rot. */
const DOWNLOAD = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

/* Where we put it when we install it ourselves. Program Files rather than a
   folder under the user, because the Windows service runs as LocalSystem and
   a service pointing into somebody's profile breaks the day that account is
   renamed. */
const INSTALL_DIR = join(env.ProgramFiles || 'C:\\Program Files', 'cloudflared');
const INSTALL_EXE = join(INSTALL_DIR, 'cloudflared.exe');

const SERVICE = 'cloudflared';

/* Where `cloudflared service install <token>` puts the token once it has it.
   Windows keeps this file administrator-only, which is why nothing here ever
   tries to read it — its EXISTENCE is the only fact this script needs, and
   the only one it can have without raising a permission prompt to look at a
   credential it does not need to see. */
const TOKEN_FILE = join(env.ProgramData || 'C:\\ProgramData', 'cloudflared', 'token');

const CONNECT = argv.includes('--connect');
const LOG = (() => { const i = argv.indexOf('--log'); return i > -1 ? argv[i + 1] : null; })();
const TOKEN_ARG = (() => { const i = argv.indexOf('--token'); return i > -1 ? argv[i + 1] : null; })();

/* ------------------------------------------------------------------ output */

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

/* When this runs elevated it runs in a hidden window, so everything it says
   also goes to a file the un-elevated parent prints afterwards. Colour codes
   are stripped on the way in — in a text file they are noise. */
function say(line) {
  console.log(line);
  if (LOG) {
    try { appendFileSync(LOG, String(line).replace(/\x1b\[[0-9;]*m/g, '') + '\r\n'); }
    catch { /* a lost log line must not take the check down with it */ }
  }
}
const ok    = (m) => say(`  ${GREEN}OK${OFF}    ${m}`);
const warn  = (m) => say(`  ${YELLOW}NOTE${OFF}  ${m}`);
const hint  = (m) => say(`        ${DIM}${m}${OFF}`);
const blank = () => say('');

const psq = (s) => String(s).replace(/'/g, "''");

/* --------------------------------------------------------------- PowerShell
   Same shape as hardware.js and for the same reason: -EncodedCommand takes
   UTF-16 base64, which sidesteps quoting entirely and sidesteps execution
   policy, which on a locked-down shop machine refuses a .ps1 off disk. */
function powershell(script, { timeout = 60000 } = {}) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
  ], { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });

  return {
    ok:  !r.error && r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim() || (r.error ? r.error.message : ''),
  };
}

/* Everything Windows knows about this, asked once. PowerShell costs the best
   part of a second to start and four calls would be four of those. Each
   question is wrapped on its own so a machine that cannot answer one still
   answers the rest.

   A TRY/CATCH DOES NOT PROTECT AGAINST A CALL THAT NEVER RETURNS, which is
   how the comment above came to be false on the shop's own laptop. The
   service's command line used to be read with `Get-CimInstance
   Win32_Service`, and WMI there does not answer at all: measured at over a
   minute, so the whole probe hit its timeout, every one of these four
   answers was lost with it, and the check told the owner his running service
   was "not installed" — and then, following from that, that his tunnel token
   was missing. One slow call, four wrong sentences, sixty seconds each time
   the panel's button was pressed.

   The registry holds the same string and answers in milliseconds. Nothing
   here may use WMI for a fact that can be read another way. */
const PROBE = `
$ErrorActionPreference = 'SilentlyContinue'
$out = [ordered]@{ admin = $false; exe = ''; service = ''; serviceState = ''; servicePath = '' }
try {
  $me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  $out.admin = $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { }
try {
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { $out.exe = [string]$c.Source }
} catch { }
try {
  $s = Get-Service -Name '${SERVICE}' -ErrorAction SilentlyContinue
  if ($s) { $out.service = [string]$s.Name; $out.serviceState = [string]$s.Status }
} catch { }
try {
  /* THE BACKSLASHES ARE DOUBLED BECAUSE THIS IS A TEMPLATE LITERAL. Written
     once each, JavaScript eats them as escape sequences before PowerShell
     ever sees the string — HKLM:\SYSTEM\... arrives as HKLM:SYSTEM... , the
     read fails under SilentlyContinue, and the line below simply never
     prints. Nothing reports it, which is what made it worth a comment. */
  $k = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\${SERVICE}' -Name ImagePath -ErrorAction SilentlyContinue
  if ($k) { $out.servicePath = [string]$k.ImagePath }
} catch { }
$out | ConvertTo-Json -Compress -Depth 4
`;

const NOTHING = { admin: false, exe: '', service: '', serviceState: '', servicePath: '', asked: false };

/* Fifteen seconds rather than the default sixty. These are four cheap
   questions, and a machine that cannot answer them in fifteen has something
   wrong that this check is not going to put right by waiting another
   forty-five with the panel's button spinning.

   `asked` is the distinction the old version could not draw: "Windows says
   there is no service" and "Windows did not say" arrived here as the same
   empty string, and reporting the second as the first is precisely how this
   check came to tell the shop its running connector was missing. */
function probe() {
  if (platform !== 'win32') return { ...NOTHING };
  const r = powershell(PROBE, { timeout: 15000 });
  try { return { ...NOTHING, ...JSON.parse(r.out), asked: true }; }
  catch { return { ...NOTHING }; }
}

/* THE SERVICE'S COMMAND LINE CAN CARRY THE TOKEN ITSELF.
   `cloudflared service install <token>` writes it straight into ImagePath, so
   on a machine registered that way the whole secret sits in the string
   printed below — to the terminal, and when this runs elevated into a log
   file on disk that the parent then prints again. The shop's own laptop uses
   --token-file and so never showed it, which is exactly why this went
   unnoticed. Anything long enough to be a credential does not get printed. */
function redact(line) {
  return String(line)
    .replace(/(--token[= ]+)\S+/gi, '$1(hidden)')
    .replace(/\beyJ[A-Za-z0-9_\-=+/.]{16,}/g, '(token hidden)');
}

/* Where is the program. PATH first because that is what a person who
   installed it by hand will have; then the two places an installer puts it;
   then our own. */
function findExe(fromProbe) {
  if (fromProbe && fromProbe.exe && existsSync(fromProbe.exe)) return fromProbe.exe;
  const candidates = [
    INSTALL_EXE,
    join(env.ProgramFiles || 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
    join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
  ];
  for (const c of candidates) { if (existsSync(c)) return c; }
  return null;
}

/* --------------------------------------------------------------- the token

   Three ways in, deliberately. The flag is for a person at a terminal, the
   env var is how the shop machine holds it, and neither being present is a
   fact this script reports rather than a thing it can guess. The token is
   the whole authorisation for the tunnel: it is not derivable from the id. */
function token() {
  return TOKEN_ARG || Env.maybe('OG_CF_TUNNEL_TOKEN', null);
}

function tokenHelp() {
  hint('Cloudflare dashboard → Zero Trust → Networks → Tunnels → your tunnel');
  hint(`→ Configure. The install command it shows ends in a long token starting "eyJ".`);
  hint('Copy that token and put it in server/.env as:');
  hint('    OG_CF_TUNNEL_TOKEN=eyJhIjoi...');
  hint(`The tunnel this shop expects is ${TUNNEL_ID}`);
}

/* ------------------------------------------------------------- can we reach

   Two different questions, and the pair of answers is what makes the report
   worth reading. The local one says the shop is up at all; the public one
   says the tunnel is carrying it. Local up and public down is the connector.
   Local down and public down is the shop, and pressing anything here is the
   wrong move. */
async function ask(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'manual',
      headers: { Accept: 'application/json' } });
    const body = await res.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(body); } catch { /* not JSON, which is itself an answer */ }
    return { reached: true, status: res.status, json, body: body.slice(0, 400) };
  } catch (e) {
    return { reached: false, error: e.name === 'AbortError' ? 'timed out' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------- what the connector is carrying

   THE ONE THING THIS CHECK USED TO GUESS AT, and it guessed wrong on the day
   it mattered. Everything else can be right — the program installed, the
   service running, the shop answering on its port — and the public address
   can still fail, because what decides where a request goes is the tunnel's
   own configuration, and for a token-based tunnel that is written in the
   dashboard and never on this machine. So a 502 was reported as "the tunnel
   is pointed somewhere else", which sends somebody to change a setting that
   may already be correct. On 12 Sep 2026 it was correct, and the fault was
   somewhere this script had never looked.

   It does not have to guess. cloudflared runs a small metrics server bound
   to localhost, and it will simply say: `/diag/tunnel` names the tunnel it
   actually joined and how many live connections it holds, and `/config`
   carries the ingress rules the dashboard handed it. Both are read-only,
   localhost-only, and carry no credential — the administrator-only token
   file is still never read, and nothing here needs it.

   A build too old to answer returns null and the section is not printed at
   all, which is the honest report for "this cannot be told from here".

   THE PORT IS FOUND BY ASKING, NOT BY LOOKING IT UP. cloudflared takes the
   first free port from 20241 upwards unless it is told otherwise, so the
   range is tried in order and an explicit --metrics on the service's command
   line goes first. Windows can of course say which port a process holds, but
   `Get-NetTCPConnection` inside -NoProfile -NonInteractive does not return —
   the first draft of this used it and hung the whole check on its 60-second
   timeout, which reported the running service as "not installed". A refused
   connection on localhost comes back instantly, so five of them cost nothing
   and cannot hang. */

const METRICS_FALLBACK = [20241, 20242, 20243, 20244, 20245];

/* `ask` slices the body at 400 characters, which is right for a health line
   and useless for a metrics page, so this one keeps the whole text. */
async function localGet(url, ms = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    return { ok: res.status === 200, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

function metricsPorts(fromProbe) {
  const out = [];
  /* An explicit --metrics on the service's command line is the one certain
     answer, and it is free: the command line is already in hand. */
  const m = String((fromProbe && fromProbe.servicePath) || '').match(/--metrics\s+"?([^\s"]+)/i);
  if (m) {
    const n = Number(String(m[1]).split(':').pop());
    if (n > 0) out.push(n);
  }
  for (const p of METRICS_FALLBACK) { if (!out.includes(p)) out.push(p); }
  return out;
}

async function connector(fromProbe) {
  for (const port of metricsPorts(fromProbe)) {
    const diag = await localGet(`http://127.0.0.1:${port}/diag/tunnel`);
    if (!diag.ok) continue;

    let d = null;
    try { d = JSON.parse(diag.text); } catch { continue; }
    if (!d || !d.tunnelID) continue;       /* something else is on that port */

    let ingress = null;
    const cfg = await localGet(`http://127.0.0.1:${port}/config`);
    if (cfg.ok) {
      try {
        const c = JSON.parse(cfg.text);
        if (c && c.config && Array.isArray(c.config.ingress)) ingress = c.config.ingress;
      } catch { /* no rules readable, which the caller reports as such */ }
    }

    const live = Array.isArray(d.connections) ? d.connections.filter(c => c && c.isConnected).length : 0;
    return { port, tunnelId: String(d.tunnelID), live, ingress };
  }
  return null;
}

/* The rule that would match this hostname. The last entry of an ingress list
   is the catch-all with an empty hostname — it matches everything and tells
   us nothing, so a blank one is never a match. */
function ruleFor(ingress, host) {
  if (!Array.isArray(ingress)) return null;
  const want = String(host).toLowerCase();
  for (const r of ingress) {
    const h = String((r && r.hostname) || '').toLowerCase();
    if (h && h === want) return r;
  }
  return null;
}

/* HOW MANY REQUESTS THIS CONNECTOR HAS BEEN GIVEN since it started. The
   number is meaningless on its own; the DIFFERENCE across one public request
   is the whole point, because it answers the question no amount of reading
   configuration can — did that request come through this computer at all. */
async function served(port) {
  const r = await localGet(`http://127.0.0.1:${port}/metrics`, 2500);
  if (!r.ok || !r.text) return null;
  const m = r.text.match(/^cloudflared_tunnel_total_requests\s+([0-9]+)/m);
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------- check */

async function check({ quiet = false } = {}) {
  const p = probe();
  const exe = findExe(p);
  const tok = token();
  const actions = [];   /* things this script can do itself */
  const humans  = [];   /* things only a person can do */

  if (!quiet) {
    blank();
    say(`  ${BOLD}Cloudflare connector${OFF}`);
    hint(`the public address for this shop is https://${HOSTNAME}`);
    blank();
  }

  if (platform !== 'win32') {
    if (!quiet) { warn('Not Windows — this check only knows how to install the Windows build.'); blank(); }
    return { code: 0, actions, humans, facts: p, exe };
  }

  /* 1. the program */
  if (exe) ok(`cloudflared is installed — ${exe}`);
  else {
    warn('cloudflared is not installed on this computer.');
    actions.push({ what: 'download', why: 'the connector program is not here yet' });
  }

  /* 2. the service. Running it in a window would mean the tunnel dies with
        the window, which on a shop laptop means it dies when somebody tidies
        up. A service starts with Windows and outlives every login. */
  if (!p.asked) {
    /* NOT "there is no service". Windows was asked and did not answer, and
       the two must never print the same sentence — the second one sends
       somebody to reinstall a service that is sitting there running. */
    warn('Windows did not answer in time, so the service cannot be reported either way.');
    hint('Nothing below depends on it: those answers come from cloudflared and from the network.');
  } else if (p.service) {
    if (String(p.serviceState).toLowerCase() === 'running') ok('The Windows service is installed and running.');
    else {
      warn(`The Windows service is installed but ${p.serviceState || 'not running'}.`);
      actions.push({ what: 'start', why: 'the service is installed but stopped' });
    }

    /* WHICH tunnel it is bound to, said out loud. The credential itself is a
       file this script deliberately cannot read — Windows keeps it
       administrator-only, which is right — so the command line is the only
       honest evidence available without a permission prompt, and it is
       enough to tell "connected to something" from "connected to ours". */
    if (p.servicePath) hint(`runs: ${redact(String(p.servicePath).replace(/^"[^"]*"\s*/, ''))}`);
  } else {
    warn('The Windows service is not installed, so nothing reconnects after a reboot.');
    actions.push({ what: 'install-service', why: 'the connector is not registered as a service' });
  }

  /* 3. WHICH TUNNEL, AND WHERE IT SENDS THIS HOSTNAME — asked of cloudflared
        itself rather than assumed. See the block above for why this is worth
        two localhost requests. */
  const conn = await connector(p);
  let ruleOk = false;          /* read again by the end-to-end step below */

  if (conn) {
    if (conn.tunnelId === TUNNEL_ID) {
      ok(`Joined the shop’s tunnel, with ${conn.live} live connection(s) to Cloudflare.`);
    } else {
      warn('This computer is connected to a DIFFERENT tunnel than the shop expects.');
      hint(`joined:   ${conn.tunnelId}`);
      hint(`expected: ${TUNNEL_ID}`);
      hint(`Requests for ${HOSTNAME} go to the expected one, so nothing here will ever carry them.`);
      humans.push('The connector on this computer is joined to the wrong tunnel.');
    }

    const rule = ruleFor(conn.ingress, HOSTNAME);
    const want = `http://localhost:${PORT}`;

    if (!conn.ingress) {
      hint('This build does not report its rules, so where it sends traffic cannot be read here.');
    } else if (!rule) {
      warn(`The tunnel carries no rule for ${HOSTNAME}, so it answers 502 without trying.`);
      hint(`Add a public hostname for ${HOSTNAME} pointing at ${want}.`);
      humans.push(`The tunnel has no public hostname for ${HOSTNAME}.`);
    } else {
      const svc = String(rule.service || '');
      const rightPort = new RegExp(`:${PORT}(?:/|$)`).test(svc);
      if (rightPort && /^http:\/\//i.test(svc)) {
        ruleOk = true;
        ok(`${HOSTNAME} → ${svc}`);
      } else {
        warn(`${HOSTNAME} → ${svc}, which is not where this shop is listening.`);
        hint(`It should be ${want}, unless it has deliberately been pointed at the HTTPS`);
        hint('port — in which case see the certificate note below.');
        humans.push(`The tunnel sends ${HOSTNAME} to ${svc} instead of ${want}.`);
      }
    }
  }

  /* 4. the token, but only when there is something it would be needed for */
  if (actions.some(a => a.what === 'install-service')) {
    if (tok) ok(`A tunnel token is set — ${Env.mask(tok)}`);
    else {
      warn('No tunnel token is set, and the service cannot be registered without one.');
      if (existsSync(TOKEN_FILE)) {
        hint(`A token file is already on this machine at ${TOKEN_FILE},`);
        hint('left by an earlier install. Registering the service again still needs the');
        hint('token itself, because that file is administrator-only and is not read here.');
      }
      humans.push('The tunnel token is missing from server/.env.');
    }
  }

  /* 5. the shop itself */
  const local = await ask(`http://127.0.0.1:${PORT}/api/health`, 4000);
  if (local.reached) ok(`The shop is answering on this machine — port ${PORT}.`);
  else {
    warn(`The shop is not answering on port ${PORT} (${local.error}).`);
    hint('The tunnel carries whatever is on that port, so start the shop before judging the result below.');
  }

  /* 6. THE CERTIFICATE TRAP. See the header. A local certificate turns port
        8090 into a redirector aimed at a port the tunnel does not carry. */
  const certDir = join(SERVER, 'data', 'certs');
  let hasCert = false;
  try { hasCert = existsSync(certDir) && statSync(certDir).isDirectory() &&
        (existsSync(join(certDir, 'cert.pem')) || existsSync(join(certDir, 'server.crt')) ||
         existsSync(join(certDir, 'cert.crt'))); } catch { hasCert = false; }

  if (hasCert) {
    warn('A local HTTPS certificate exists, and that breaks the tunnel as configured.');
    hint(`With a certificate present the shop sends browsers from port ${PORT} to port 8443,`);
    hint('and the tunnel does not carry 8443, so the public address will fail to load.');
    hint('Either delete server/data/certs, or change the tunnel to https://localhost:8443');
    hint('with "No TLS Verify" switched on in the tunnel\u2019s application settings.');
    humans.push('A local certificate is present and conflicts with the tunnel.');
  }

  /* 7. the whole thing, end to end. Last, because it is the only question
        whose answer depends on all the others being right.

        THE COUNTER IS READ EITHER SIDE OF THE REQUEST, and that bracket is
        what turns a guess into a measurement: if the connector on this
        computer was handed the request we just made, its total goes up by
        one. If the public address fails and that number did NOT move, the
        request was answered by something else entirely, and no amount of
        looking at this machine would ever have found it. */
  const before = conn ? await served(conn.port) : null;
  const pub = await ask(`https://${HOSTNAME}/api/health`, 10000);
  const after = conn ? await served(conn.port) : null;
  const cameHere = (before !== null && after !== null) ? after > before : null;

  /* CLOUDFLARE'S OWN ERROR PAGE IS JSON, and that is how the first version of
     this check went permanently green. Its body carries `status: 502`, the
     first draft accepted any object with a `status` field as proof of life,
     and so a gateway error read as "the shop is answering". Measured, not
     reasoned about: the page came back with content-type application/json and
     parsed cleanly.

     `cloudflare_error: true` is Cloudflare saying the page is its own rather
     than the origin's, and it is checked FIRST so nothing below can mistake
     one for the other. The shop's own health line is then required to be a
     200 carrying `ok` and the `lan` array — fields Cloudflare has no reason
     to invent — rather than merely being JSON. */
  const cfPage = pub.reached && pub.json && pub.json.cloudflare_error === true;
  const shopLine = pub.reached && pub.status === 200 && pub.json &&
                   pub.json.ok === true && Array.isArray(pub.json.lan);

  if (!pub.reached) {
    warn(`https://${HOSTNAME} did not answer (${pub.error}).`);
    if (!local.reached) hint('Expected while the shop is closed — the tunnel has nothing to carry.');
  } else if (cfPage) {
    warn(`https://${HOSTNAME} did not reach the shop — Cloudflare answered ${pub.status} itself.`);
    if (pub.json.error_name) hint(`Cloudflare calls it: ${pub.json.error_name}`);

    if (pub.status === 530) {
      hint('Nothing is attached to this tunnel at all — no connector is connected.');
      humans.push('No connector is attached to the tunnel.');
    } else if (local.reached) {
      /* THE SHOP IS UP HERE AND THE TUNNEL STILL CANNOT SEE IT. There are two
         quite different faults behind that and they need opposite answers, so
         this used to name the likelier one and hope. The bracket around the
         request above tells them apart outright.

         Measured on 12 Sep 2026: the connector here was on the right tunnel,
         its rule already read http://localhost:8090, the shop answered that
         port — and across nineteen public requests its counter never moved
         once. Every one of them was being answered by a second machine
         running cloudflared on the same token, which had no shop on its own
         port. Following this script's old advice would have meant editing a
         setting that was already correct. */
      if (cameHere === false && conn && conn.tunnelId === TUNNEL_ID) {
        hint('That request never arrived here — this computer’s connector was not given it.');
        /* Only claimed when it was actually checked and passed. Saying "its
           rule is right" under a NOTE above saying the rule is wrong is two
           sentences that disagree, which is worse than the shorter one. */
        if (ruleOk) hint('It is joined to the right tunnel and its rule for this hostname is correct.');
        else hint('It is joined to the right tunnel and holds live connections to Cloudflare.');
        blank();
        hint('So ANOTHER computer is connected to this same tunnel and is answering');
        hint('instead — Cloudflare treats two connectors as a pair and hands each request');
        hint('to whichever it likes. That one has no shop on its own port, so everything');
        hint('it takes comes back 502, and this machine never sees any of it.');
        blank();
        hint('The tunnel’s page in the dashboard lists its connectors and will show two.');
        hint('On the other computer:  cloudflared service uninstall');
        hint('If that page shows only this one, then the hostname has been handed to a');
        hint('different tunnel instead — check which tunnel its DNS record points at.');
        humans.push('A second computer is connected to this tunnel and is answering instead of this one.');
      } else if (cameHere === true) {
        hint(`The request DID arrive here, and the connector could not pass it to port ${PORT}.`);
        hint('That is a fault on this machine rather than at Cloudflare — the certificate');
        hint('note above is the usual cause.');
        humans.push('The connector here received the request and could not reach the shop.');
      } else {
        hint(`The shop is running here on port ${PORT}, so the tunnel is pointed somewhere else.`);
        hint('Check the tunnel’s public hostname sends traffic to http://localhost:' + PORT);
        humans.push('The tunnel is up but is not reaching the shop on this machine.');
      }
    } else {
      /* Expected. The connector is fine, there is simply nothing behind it. */
      hint('The connector is up and the shop behind it is closed. Start the shop and try again.');
    }
  } else if (shopLine) {

    /* ANSWERING IS NOT THE SAME AS ANSWERING FROM HERE, and the difference
       is the whole reason this branch exists.

       A second machine that copies server/.env inherits this hostname, so
       its check would ask the tunnel, get a perfectly healthy shop back, and
       report success — while the shop it reached is somebody else's laptop.
       Two connectors on one tunnel do the same thing intermittently:
       Cloudflare treats them as a high-availability pair and hands each
       request to whichever it likes, so the answer changes between runs.

       `lan` is what tells them apart. It is the list of addresses the
       answering server found on ITS OWN network cards, so two machines
       cannot produce the same one. Comparing the shop NAME would not do —
       both copies are called OG Sports, which is exactly how this hides. */
    const mine = local.reached && local.json ? JSON.stringify(local.json.lan || []) : null;
    const theirs = JSON.stringify(pub.json.lan || []);

    if (mine !== null && mine !== theirs) {
      warn(`https://${HOSTNAME} is answering, but NOT from this computer.`);
      hint(`it reaches a shop on ${(pub.json.lan || []).join(', ') || 'an unknown machine'}`);
      hint(`this computer is ${(local.json.lan || []).join(', ') || 'not on a network'}`);
      hint('Either the tunnel points at another laptop, or two machines are running');
      hint('the same tunnel token and Cloudflare is splitting requests between them.');
      humans.push('The public address reaches a different computer than this one.');
    } else if (mine === null) {
      ok(`https://${HOSTNAME} is answering.`);
      hint('The shop is closed here, so there is no way to tell whether it is THIS computer answering.');
    } else {
      ok(`https://${HOSTNAME} is answering, and it is this computer.`);
    }

  } else if (pub.status >= 300 && pub.status < 400) {
    warn(`https://${HOSTNAME} answered ${pub.status} and sent us somewhere else.`);
    hint('That is what Cloudflare Access looks like from a script. A browser would be asked to sign in.');
  } else {
    warn(`https://${HOSTNAME} answered ${pub.status}, but not with the shop\u2019s health line.`);
    hint('Something is on that hostname. It is not this server, or something sits in front of it.');
  }

  /* ------------------------------------------------------------- the verdict */

  if (humans.length) {
    blank();
    for (const h of humans) warn(h);
    if (!tok && actions.some(a => a.what === 'install-service')) { blank(); tokenHelp(); }
  }

  const fixable = actions.filter(a => a.what !== 'install-service' || tok);

  if (fixable.length) {
    blank();
    say(`  ${BOLD}This can be put right from here:${OFF}`);
    for (const a of fixable) hint(`- ${a.why}`);
    blank();
    return { code: 4, actions: fixable, humans, facts: p, exe };
  }

  blank();
  return { code: humans.length ? 1 : 0, actions: [], humans, facts: p, exe };
}

/* ----------------------------------------------------------------- install */

/* Registering a Windows service needs administrator, and so does writing
   into Program Files. Rather than opening every morning with a UAC prompt,
   the check runs unelevated and only this pass comes here — so the prompt
   appears on the day the connector is new, and then never again. */
function elevate() {
  const log = resolve(env.TEMP || env.TMP || SERVER, `og-cloudflare-${Date.now()}.log`);
  const script =
    'try {\n' +
    `  $p = Start-Process -FilePath '${psq(execPath)}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '"${psq(resolve(HERE, 'cloudflare.js'))}"','--connect','--log','"${psq(log)}"'\n` +
    '  exit $p.ExitCode\n' +
    '} catch { exit 99 }';

  say('  Windows will ask permission — installing a service needs an administrator.');
  blank();

  const r = powershell(script, { timeout: 600000 });

  if (existsSync(log)) {
    try { say(readFileSync(log, 'utf8').replace(/\r?\n$/, '')); }
    catch { /* the exit code still tells the truth */ }
  }

  if (r.status === 99 || (!r.ok && !existsSync(log))) {
    blank();
    warn('Nothing was installed — the permission prompt was refused or closed.');
    blank();
    return 1;
  }
  return r.ok ? 0 : 1;
}

/* Straight from Cloudflare's releases. Written to a temporary name and moved
   into place only once it is complete, so an interrupted download can never
   leave a half a program behind that the service then points at. */
async function download() {
  say(`  Downloading cloudflared from Cloudflare\u2019s releases…`);
  const res = await fetch(DOWNLOAD, { redirect: 'follow' });
  if (!res.ok) { warn(`The download failed — ${res.status} ${res.statusText}`); return null; }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024 * 1024) { warn(`The download came back too small (${buf.length} bytes) to be the program.`); return null; }

  mkdirSync(INSTALL_DIR, { recursive: true });
  const tmp = INSTALL_EXE + '.part';
  writeFileSync(tmp, buf);
  try { rmSync(INSTALL_EXE, { force: true }); } catch { /* first install */ }
  renameSync(tmp, INSTALL_EXE);

  ok(`Installed — ${INSTALL_EXE} (${(buf.length / 1048576).toFixed(1)} MB)`);
  return INSTALL_EXE;
}

async function connect() {
  if (platform !== 'win32') { blank(); warn('Not Windows — nothing to install.'); blank(); return 0; }

  const first = await check({ quiet: false });
  if (first.code === 0) return 0;

  /* A missing token is the one thing no amount of administrator fixes. Say
     so before raising a prompt somebody would click for nothing. */
  const tok = token();
  const needsService = first.actions.some(a => a.what === 'install-service') ||
                       !first.facts.service;
  if (needsService && !tok) {
    blank();
    warn('Cannot connect: the tunnel token is not set.');
    tokenHelp();
    blank();
    return 1;
  }

  if (!first.facts.admin) return elevate();

  blank();
  say(`  ${BOLD}Connecting this computer to the tunnel${OFF}`);
  blank();

  let exe = first.exe;

  if (!exe) {
    try { exe = await download(); }
    catch (e) { warn(`The download failed — ${e.message}`); return 1; }
    if (!exe) return 1;
  }

  if (!first.facts.service) {
    /* The token carries the account, the tunnel and its secret, so this one
       call both registers the service and tells it which tunnel it is. The
       hostname mapping lives in the dashboard, not on this machine, which is
       why there is no config file to write here. */
    const r = powershell(
      `$ErrorActionPreference='Stop'\ntry {\n  & '${psq(exe)}' service install '${psq(tok)}'\n  exit $LASTEXITCODE\n} catch { Write-Output $_.Exception.Message; exit 1 }`,
      { timeout: 180000 });

    if (r.ok) ok('The Windows service is registered and connected to the tunnel.');
    else {
      warn('Could not register the service.');
      hint((r.out || r.err || 'Windows gave no reason.').split(/\r?\n/)[0]);
      return 1;
    }
  }

  /* Registered but stopped, or just registered and not yet up. */
  const r2 = powershell(`Start-Service -Name '${SERVICE}' -ErrorAction SilentlyContinue; (Get-Service -Name '${SERVICE}').Status`);
  if (r2.ok && /running/i.test(r2.out)) ok('The service is running.');
  else hint('The service did not report Running yet — it usually settles within a few seconds.');

  /* Cloudflare needs a moment to notice the connector before the public
     address answers, so the confirming check is worth the wait rather than
     reporting a failure that is only earliness. */
  blank();
  say('  Giving Cloudflare a few seconds to pick up the connection…');
  await new Promise(r => setTimeout(r, 8000));

  const again = await check({ quiet: false });
  return again.code === 0 ? 0 : (again.humans.length ? 1 : 4);
}

/* ---------------------------------------------------------------- dispatch */

/* CALLING exit() STRAIGHT AFTER A fetch() CRASHES NODE ON WINDOWS.

       Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
       file src\win\async.c, line 76

   and the process leaves with 127 instead of the code this script decided
   on. Which matters more than it looks: 127 is not one of the three codes
   the panel understands, so a check that had just printed a clean report
   would be drawn as a job that failed.

   The cause is the keep-alive sockets behind the global fetch. They are
   still open when exit() tears the loop down mid-close. So: close them
   first, then set the code and RETURN, and let Node leave on its own with
   an empty loop. That is a real exit rather than a forced one, and it
   cannot race anything.

   The timer is the safety net for the day something else holds the loop
   open. It is unref'd, so its own existence never delays the exit. */
async function leave(code) {
  try {
    const d = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (d && typeof d.close === 'function') await d.close();
  } catch { /* best effort — a socket that will not close must not change the verdict */ }

  process.exitCode = code;
  setTimeout(() => exit(code), 2000).unref();
}

if (CONNECT) await leave(await connect());
else await leave((await check()).code);
