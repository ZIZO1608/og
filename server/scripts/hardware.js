/* ==========================================================================
   OG SYSTEM — the till's hardware, before the shop opens
   --------------------------------------------------------------------------
   Run:  cd server && npm run hardware            (checks, changes nothing)
         cd server && npm run hardware:install    (installs what is missing)

   start-og-system.bat runs the first, and runs the second for you when the
   first finds something it can fix.

   Three pieces of hardware, and only two of them have a driver at all:

     1. THE RECEIPT PRINTER  (80mm ESC/POS, e.g. the XP-T80A)
     2. THE LABEL PRINTER    (Xprinter XP-235B, TSPL)
     3. THE BARCODE SCANNER

   What "the driver" means here is not what it says on the box, and getting
   that wrong is the whole reason this file exists.

   * Both printers are sent bytes they already know how to read — ESC/POS for
     the receipt, TSPL for the label. Windows must NOT reformat them. So the
     driver these two queues need is the one built into Windows called
     "Generic / Text Only", NOT the manufacturer's driver from the CD.
     Installing the real one is worse than installing nothing: the queue
     accepts the job, the driver reads command bytes as a page of text, and
     one receipt comes out split across three pages. A printer that looks
     installed and prints rubbish is harder to diagnose than one that is
     plainly missing — see the header of server/lib/printer.js, where that
     was found the hard way.

   * The scanner HAS no driver, by design. A USB scanner, a 2.4GHz dongle one
     and a Bluetooth one all announce themselves as a KEYBOARD; Windows fits
     its own HID driver in seconds and js/wedge.js reads the keystrokes.
     There is nothing to install and nothing to configure. So this checks the
     only thing that can actually be wrong — that Windows finished fitting
     that driver and has not left a device sitting on an error — and says the
     rest out loud rather than inventing an install step to look thorough.

   IT DOES NOT STOP THE SHOP OPENING. Same rule as scripts/preflight.js: a
   shop that cannot print a receipt can still sell shoes, and a launcher that
   refuses to start the till over a printer that is merely switched off has
   taken a day's takings hostage over a piece of paper.

   Exit codes, read by start-og-system.bat. `if errorlevel N` in batch means
   "N or more", so they are tested there highest first:

     0  everything that is set up is ready.
     4  something is missing AND this script knows how to install it. The
        launcher runs the install and then checks again.
     1  something is missing that needs a person — a printer to be plugged in
        and switched on, or a choice this script refuses to guess at.
   ========================================================================== */

import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, env, platform, execPath } from 'node:process';

import * as DB from '../lib/db.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/* Spelled exactly as Windows spells it, spaces and all: Add-PrinterDriver
   matches on this string and fails on a near miss. */
const RAW_DRIVER = 'Generic / Text Only';

const INSTALL = argv.includes('--install');
const LOG = (() => { const i = argv.indexOf('--log'); return i > -1 ? argv[i + 1] : null; })();

/* ------------------------------------------------------------------ output */

const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m';

/* The install pass works out what to do by running the same check again, and
   nobody wants to read the report twice, so that second pass is silenced. */
let QUIET = false;

/* When this runs elevated it runs in a hidden window, so everything it says
   also goes to a file the un-elevated parent prints afterwards. The colour
   codes are stripped on the way in — in a text file they are noise. */
function say(line) {
  if (QUIET) return;
  console.log(line);
  if (LOG) {
    try { appendFileSync(LOG, line.replace(/\x1b\[[0-9;]*m/g, '') + '\r\n'); }
    catch { /* a lost log line must not take the check down with it */ }
  }
}
const ok    = (m) => say(`  ${GREEN}OK${OFF}    ${m}`);
const warn  = (m) => say(`  ${YELLOW}NOTE${OFF}  ${m}`);
const hint  = (m) => say(`        ${DIM}${m}${OFF}`);
const blank = () => say('');

/* --------------------------------------------------------------- PowerShell
   Everything Windows knows about printers and devices sits behind PowerShell
   cmdlets, so this shells out — but ONCE for the whole probe, because
   PowerShell takes the best part of a second to start and five calls would
   be five of those every morning.

   -EncodedCommand takes UTF-16 base64. It is used instead of -Command to
   sidestep quoting entirely (the script below is full of quotes, $ and
   backslashes) and instead of a .ps1 file to sidestep execution policy,
   which on a locked-down shop machine refuses to run a script off disk. */
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

/* PowerShell 5.1 turns a one-element array into a bare object on its way
   through ConvertTo-Json, so a shop with exactly one printer would arrive
   here as something with no .filter on it. */
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/* Every question asked of Windows in one go. Each is wrapped on its own
   because a machine missing one cmdlet must still answer the other four. */
const PROBE = `
$ErrorActionPreference = 'SilentlyContinue'
$out = [ordered]@{ admin = $false; computer = $env:COMPUTERNAME; printers = @(); drivers = @(); ports = @(); keyboards = @(); broken = @(); errors = @() }
try {
  $me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  $out.admin = $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { $out.errors += "administrator: $($_.Exception.Message)" }
try {
  $out.printers = @(Get-Printer | ForEach-Object {
    [ordered]@{ name = [string]$_.Name; share = [string]$_.ShareName; shared = [bool]$_.Shared; driver = [string]$_.DriverName; port = [string]$_.PortName; status = [string]$_.PrinterStatus }
  })
} catch { $out.errors += "printers: $($_.Exception.Message)" }
try { $out.drivers = @(Get-PrinterDriver | ForEach-Object { [string]$_.Name }) } catch { $out.errors += "drivers: $($_.Exception.Message)" }
try { $out.ports   = @(Get-PrinterPort   | ForEach-Object { [string]$_.Name }) } catch { $out.errors += "ports: $($_.Exception.Message)" }
try {
  $out.keyboards = @(Get-PnpDevice -Class Keyboard -PresentOnly | ForEach-Object {
    [ordered]@{ name = [string]$_.FriendlyName; id = [string]$_.InstanceId; status = [string]$_.Status }
  })
} catch { $out.errors += "keyboards: $($_.Exception.Message)" }
try {
  $out.broken = @(Get-PnpDevice -PresentOnly | Where-Object { $_.Status -eq 'Error' } | ForEach-Object {
    [ordered]@{ name = [string]$_.FriendlyName; id = [string]$_.InstanceId; class = [string]$_.Class; status = [string]$_.Status }
  })
} catch { $out.errors += "unfinished devices: $($_.Exception.Message)" }
$out | ConvertTo-Json -Depth 4 -Compress
`;

function probe() {
  const r = powershell(PROBE);
  if (!r.ok || !r.out) return { failed: r.err || 'PowerShell returned nothing.' };
  try {
    const f = JSON.parse(r.out);
    return {
      admin: !!f.admin,
      computer: String(f.computer || '').toLowerCase(),
      printers: list(f.printers),
      drivers: list(f.drivers).map(String),
      ports: list(f.ports).map(String),
      keyboards: list(f.keyboards),
      broken: list(f.broken),
      errors: list(f.errors).map(String),
    };
  } catch (e) {
    return { failed: `could not read the reply from PowerShell — ${e.message}` };
  }
}

/* --------------------------------------------------------------- the config
   What hardware this shop HAS is a question only the database answers:
   receipt.transport says whether the receipt printer is on the network or on
   a USB cable, and receipt.printer_share names the queue. Checking for a
   queue nobody asked for would be inventing a requirement. */
function readConfig() {
  const file = env.OG_DB || resolve(HERE, '..', 'data', 'og.db');
  if (!existsSync(file)) return null;
  try {
    const db = DB.open(file);
    const rows = db.prepare(
      `SELECT key, value FROM config WHERE key IN
         ('receipt.transport','receipt.printer_share','receipt.printer_host','receipt.printer_port',
          'label.transport','label.printer_host','label.printer_port')`
    ).all();
    const at = (k) => rows.find(r => r.key === k)?.value ?? '';
    return {
      receipt: {
        transport: at('receipt.transport') || 'tcp',
        share: at('receipt.printer_share'),
        host: at('receipt.printer_host'),
        port: Number(at('receipt.printer_port')) || 9100,
      },
      label: {
        transport: at('label.transport') || 'agent',
        host: at('label.printer_host'),
        port: Number(at('label.printer_port')) || 9100,
      },
    };
  } catch {
    /* A database that will not open is preflight.js's story to tell, one
       line earlier in the same window. Saying it twice helps nobody. */
    return null;
  }
}

/* The label printer is reached through the agent on whichever machine it is
   plugged into (agent/README.md), and that agent's own config is the only
   place its queue name is written down. No config file means this machine is
   not the label station, and there is nothing here to check. */
function readAgent() {
  const file = resolve(ROOT, 'agent', 'agent-config.json');
  if (!existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    return { share: String(c.printerShare || ''), station: String(c.station || '') };
  } catch {
    return null;
  }
}

/* \\localhost\OGRECEIPT  ->  { host: 'localhost', share: 'OGRECEIPT' } */
function unc(path) {
  const m = /^\\\\([^\\]+)\\([^\\]+)\\?$/.exec(String(path || '').trim());
  return m ? { host: m[1], share: m[2] } : null;
}

const isHere = (host, computer) =>
  ['localhost', '127.0.0.1', '.', computer].includes(String(host).toLowerCase());

/* PowerShell single-quoted strings escape a quote by doubling it, and
   printer names are typed by people, who do use apostrophes. */
const psq = (s) => String(s).replace(/'/g, "''");

/* ------------------------------------------------------------ the TCP case
   A printer with a network socket has no driver at all — the server writes
   ESC/POS or TSPL straight at port 9100 (server/lib/printer.js). So the only
   question worth asking is whether it answers, which is the same question
   the server itself will ask in a minute. */
function reachable(host, port, ms = 2500) {
  return new Promise((done) => {
    const sock = connect({ host, port, timeout: ms });
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; sock.destroy(); done(v); };
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error',   () => finish(false));
  });
}

/* ------------------------------------------------------------- the planning
   Everything here decides WHAT is wrong and changes nothing. The install pass
   works from this same list, so the check and the install can never disagree
   about what needs doing. */

function planQueue({ label, share, facts, hints }) {
  const actions = [];
  const notes = [];

  /* Found by its SHARE name first — that is the name server/lib/printer.js
     writes to — and by its own name second, which catches a queue somebody
     created but never shared. */
  const byShare = facts.printers.find(p => (p.share || '').toLowerCase() === share.toLowerCase() && p.shared);
  const byName  = facts.printers.find(p => (p.name  || '').toLowerCase() === share.toLowerCase());
  const found = byShare || byName;

  if (found) {
    if (!byShare) {
      actions.push({
        why: `the ${label} queue "${found.name}" exists but is not shared as ${share}`,
        ps: `Set-Printer -Name '${psq(found.name)}' -Shared $true -ShareName '${psq(share)}'`,
      });
    }
    if ((found.driver || '').toLowerCase() !== RAW_DRIVER.toLowerCase()) {
      actions.push({
        why: `the ${label} queue is on the "${found.driver}" driver, which reformats the bytes it is sent`,
        ps: `Set-Printer -Name '${psq(found.name)}' -DriverName '${psq(RAW_DRIVER)}'`,
        needsRawDriver: true,
      });
      notes.push(`Until that is swapped, one ${label} job prints as several pages of gibberish.`);
    }
    /* Windows calls a queue Normal even when the printer behind it is
       unplugged, so this catches the states it does notice and claims no
       more than that. */
    if (found.status && !/^normal$/i.test(found.status)) {
      notes.push(`Windows reports the ${label} as "${found.status}".`);
    }
    return { ready: actions.length === 0, actions, notes };
  }

  /* No queue at all. One can be created — but only onto a port, and a port
     is what appears when the printer is plugged in and switched on. */
  const port = pickPort(facts, hints);
  if (!port.name) return { ready: false, actions: [], notes, human: port.why };

  actions.push({
    why: `there is no ${label} queue called ${share}`,
    detail: `${share} on ${port.name} (${port.because})`,
    ps: `Add-Printer -Name '${psq(share)}' -DriverName '${psq(RAW_DRIVER)}' -PortName '${psq(port.name)}'` +
        `\nSet-Printer -Name '${psq(share)}' -Shared $true -ShareName '${psq(share)}'`,
    needsRawDriver: true,
  });
  return { ready: false, actions, notes };
}

/* Which physical port to hang a new queue on.

   This will guess, but only ever from ONE candidate. Picking the receipt
   printer out of two USB ports by its name is exactly the kind of confident
   wrong answer that has labels coming out of the receipt printer all
   morning, so where there is real doubt it stops and prints the list. */
function pickPort(facts, hints) {
  const usb = facts.ports.filter(p => /^USB\d+$/i.test(p));

  /* The vendor's own queue is usually already there from when somebody
     plugged the printer in, and it is on the right port. The DRIVER name is
     what identifies it — "Xprinter XP-80" against "Xprinter XP-235B" — and
     that beats the queue's own name, which is whatever the person who set it
     up felt like typing ("invoices printer"). The name is matched too, for a
     queue that was made on a generic driver. */
  const named = facts.printers.filter(p =>
    /^USB\d+$/i.test(p.port || '') &&
    hints.some(h => `${p.name || ''} ${p.driver || ''}`.toLowerCase().includes(h)));

  /* Two queues onto one port is the normal way round — a raw one alongside
     the vendor's. Two queues onto two different ports is the ambiguity this
     refuses to resolve. */
  const ports = [...new Set(named.map(p => p.port.toUpperCase()))];
  if (ports.length === 1) {
    return { name: ports[0], because: `where "${named[0].driver || named[0].name}" is plugged in` };
  }

  if (usb.length === 1) return { name: usb[0], because: 'the only USB printer port on this computer' };

  if (usb.length === 0) {
    return { name: null, why: 'it is not plugged in, or not switched on — Windows has no USB printer port at all yet.' };
  }
  return {
    name: null,
    why: `this computer has ${usb.length} USB printer ports (${usb.join(', ')}) and guessing between them could ` +
         'send labels to the receipt printer. Add the queue by hand — the steps are in agent\\README.md.',
  };
}

/* ------------------------------------------------------------------ the run
   Returns rather than exits, because the install pass runs it too. */

async function check() {
  blank();
  say(`${BOLD}  Checking the till hardware${OFF}`);
  blank();

  if (platform !== 'win32') {
    warn('Not Windows, so there are no printer queues here to check.');
    blank();
    return { code: 0, actions: [], facts: null };
  }

  const facts = probe();
  if (facts.failed) {
    warn(`Could not ask Windows about the printers — ${facts.failed}`);
    hint('The server still starts, and printing reports its own errors.');
    blank();
    return { code: 0, actions: [], facts: null };
  }
  for (const e of facts.errors) hint(`Windows would not answer one question — ${e}`);

  const cfg = readConfig();
  const agent = readAgent();

  const actions = [];   /* things this script can do itself */
  const humans = [];    /* things only a person standing there can do */

  /* ---- 1: the receipt printer ------------------------------------------ */

  if (!cfg) {
    warn('No database yet, so there is no printer setup to check against.');
    hint('The server creates it on this run — start again afterwards.');
  } else if (cfg.receipt.transport === 'usb') {
    const at = unc(cfg.receipt.share);
    if (!at) {
      humans.push(`The receipt printer is set to USB, but receipt.printer_share ("${cfg.receipt.share}") is not a share name like \\\\localhost\\OGRECEIPT. Fix it in Settings.`);
    } else if (!isHere(at.host, facts.computer)) {
      warn(`The receipt printer is shared from ${at.host}, not from this computer.`);
      hint(`Nothing to install here — check the queue "${at.share}" on ${at.host}.`);
    } else {
      const p = planQueue({ label: 'receipt printer', share: at.share, facts, hints: ['xp-t', 'xp-8', 'xp8', 'pos', 'receipt', '80'] });
      if (p.ready) ok(`The receipt printer queue ${at.share} is installed, shared, and on the ${RAW_DRIVER} driver.`);
      if (p.human) humans.push(`The receipt printer queue ${at.share} does not exist, and ${p.human}`);
      for (const n of p.notes) warn(n);
      actions.push(...p.actions);
    }
  } else if (cfg.receipt.host) {
    const up = await reachable(cfg.receipt.host, cfg.receipt.port);
    if (up) ok(`The receipt printer answers at ${cfg.receipt.host}:${cfg.receipt.port} — no driver needed on this computer.`);
    else humans.push(`The receipt printer at ${cfg.receipt.host}:${cfg.receipt.port} does not answer. Switch it on, or check the cable and the address in Settings.`);
  } else {
    warn('No receipt printer is set up at all — receipt.printer_host is empty.');
    hint('Settings > Receipt. The till still sells; it just cannot print.');
  }

  /* ---- 2: the label printer -------------------------------------------- */

  if (cfg && cfg.label.transport === 'tcp') {
    if (cfg.label.host) {
      const up = await reachable(cfg.label.host, cfg.label.port);
      if (up) ok(`The label printer answers at ${cfg.label.host}:${cfg.label.port} — no driver needed on this computer.`);
      else humans.push(`The label printer at ${cfg.label.host}:${cfg.label.port} does not answer. Switch it on, or check the address in Settings.`);
    } else {
      warn('label.transport is "tcp" but no label printer address is set, so label printing fails on every attempt.');
      if (agent) hint(`This computer is set up as the label station "${agent.station}" — set the transport back to "agent" in Settings.`);
      else hint('Settings > Labels: give it an address, or set the transport to "agent".');
    }
  }

  /* The agent's config is checked whenever it exists, whatever the transport
     says, because it is the thing that proves a label printer is plugged in
     HERE and names the queue it is expected to be behind. */
  if (agent) {
    const at = unc(agent.share);
    if (!at) {
      humans.push(`agent\\agent-config.json has printerShare "${agent.share}", which is not a share name like \\\\localhost\\OGLABEL.`);
    } else if (!isHere(at.host, facts.computer)) {
      warn(`The label printer is shared from ${at.host}, not from this computer.`);
      hint(`Nothing to install here — check the queue "${at.share}" on ${at.host}.`);
    } else {
      const p = planQueue({ label: 'label printer', share: at.share, facts, hints: ['xp-2', 'xp2', '235', 'label', 'tspl'] });
      if (p.ready) ok(`The label printer queue ${at.share} is installed, shared, and on the ${RAW_DRIVER} driver.`);
      if (p.human) humans.push(`The label printer queue ${at.share} does not exist, and ${p.human}`);
      for (const n of p.notes) warn(n);
      actions.push(...p.actions);
    }

    /* Having the queue is half of it — the agent is what puts jobs into it. */
    const task = spawnSync('schtasks.exe', ['/query', '/tn', 'OGLabelAgent'], { encoding: 'utf8', windowsHide: true });
    if (task.status === 0) ok('The label print agent is registered to start with this computer.');
    else {
      warn('The label print agent is not registered to start with this computer.');
      hint('Double-click agent\\install-agent.bat once. Until then label jobs just queue up.');
    }
  } else if (cfg && cfg.label.transport !== 'tcp') {
    warn('Label jobs wait for a print agent, and this computer is not one.');
    hint('If the label printer is plugged in HERE, see agent\\README.md.');
  }

  /* ---- 3: the scanner --------------------------------------------------- */

  /* There is no scanner driver to look for, so this reports what is true:
     how many keyboard-type devices Windows has, and whether any device is
     sitting on a driver it could not fit. A scanner in its normal mode is
     indistinguishable from a keyboard — that is the whole trick — so this
     cannot say "the scanner is here", and does not pretend to. */
  const plugIn = facts.keyboards.filter(k => /^HID\\/i.test(k.id || ''));
  const stuck = facts.broken.filter(d =>
    !d.class || ['keyboard', 'hidclass', 'usb', 'unknown'].includes(String(d.class).toLowerCase()));

  if (stuck.length) {
    for (const d of stuck) warn(`Windows has not finished installing "${d.name || d.id}".`);
    actions.push({
      why: `${stuck.length} plugged-in device${stuck.length === 1 ? ' is' : 's are'} still waiting for Windows to fit a driver`,
      ps: 'pnputil /scan-devices | Out-Null',
    });
  } else if (plugIn.length) {
    ok(`${plugIn.length} plug-in keyboard-type device${plugIn.length === 1 ? '' : 's'} ready — a scanner is one of these.`);
    hint('Scanners need no driver: they type the barcode and press Enter.');
  } else {
    warn('No plug-in keyboard-type device is connected, so no scanner is either.');
    hint('Plug it in — Windows fits its own driver in seconds. There is nothing to install.');
  }

  /* ---- what happens next ------------------------------------------------ */

  /* The raw driver is never installed on its own account, only because a
     queue below needs it. Adding it to a machine with no printer would be a
     change nobody asked for. */
  if (actions.some(a => a.needsRawDriver) &&
      !facts.drivers.some(d => d.toLowerCase() === RAW_DRIVER.toLowerCase())) {
    actions.unshift({
      why: `the "${RAW_DRIVER}" driver is not installed, and both printers are printed through it`,
      ps: `Add-PrinterDriver -Name '${psq(RAW_DRIVER)}'`,
    });
  }

  if (humans.length) {
    blank();
    for (const h of humans) warn(h);
  }

  if (actions.length) {
    blank();
    say(`  ${BOLD}This can be put right from here:${OFF}`);
    for (const a of actions) hint(`- ${a.why}${a.detail ? `\n          installing ${a.detail}` : ''}`);
    blank();
    return { code: 4, actions, facts };
  }

  blank();
  return { code: humans.length ? 1 : 0, actions, facts };
}

/* ------------------------------------------------------------- the install */

/* Installing a printer driver and sharing a queue both need administrator.
   Rather than starting every morning with a UAC prompt, the launcher runs
   the CHECK unelevated and only comes here when there is something to do —
   so the prompt appears on the day the printer is new, and then never
   again. */
function elevate() {
  const log = resolve(env.TEMP || env.TMP || ROOT, `og-hardware-${Date.now()}.log`);
  const script =
    'try {\n' +
    `  $p = Start-Process -FilePath '${psq(execPath)}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
    `-ArgumentList '"${psq(resolve(HERE, 'hardware.js'))}"','--install','--log','"${psq(log)}"'\n` +
    '  exit $p.ExitCode\n' +
    '} catch { exit 99 }';

  say('  Windows will ask permission — installing a printer driver needs an administrator.');
  blank();

  const r = powershell(script, { timeout: 300000 });

  /* The elevated copy runs in a hidden window, so its report comes back
     through the log file. Without this the person sees a UAC prompt, a
     pause, and nothing at all about what happened. */
  if (existsSync(log)) {
    try { say(readFileSync(log, 'utf8').replace(/\r?\n$/, '')); } catch { /* the exit code still tells the truth */ }
  }

  /* 99 is the catch in the script above, and it means Start-Process itself
     threw — which is what a refused UAC prompt looks like from here. Any
     other non-zero code came from the elevated copy, which got as far as
     trying and has already said what went wrong in the log printed above.
     Reporting that as "refused" would send somebody to click a prompt they
     already clicked. */
  if (r.status === 99) {
    blank();
    warn('Nothing was installed — the permission prompt was refused or closed.');
    hint('Right-click start-og-system.bat and choose "Run as administrator" to try again.');
    blank();
    return 1;
  }
  return r.ok ? 0 : 1;
}

async function install() {
  /* The list is worked out from the machine as it is NOW rather than handed
     over from the check a moment ago: a printer switched on in between makes
     this run better, not stale. */
  QUIET = true;
  let plan;
  try { plan = await check(); } finally { QUIET = false; }

  blank();
  say(`${BOLD}  Setting up the till hardware${OFF}`);
  blank();

  if (!plan.facts) { warn('Nothing to install on this computer.'); blank(); return 0; }
  if (!plan.actions.length) { ok('Nothing left to install.'); blank(); return 0; }
  if (!plan.facts.admin) return elevate();

  let failed = 0;
  for (const a of plan.actions) {
    /* Stop, not Continue: a cmdlet that half-worked must be reported as the
       failure it is, not passed over into a "done" that nobody can trust. */
    const r = powershell(`$ErrorActionPreference = 'Stop'\ntry {\n${a.ps}\n} catch { Write-Output $_.Exception.Message; exit 1 }`,
      { timeout: 180000 });

    if (r.ok) ok(`Done — ${a.detail || a.why}`);
    else {
      failed++;
      warn(`Could not do it — ${a.why}`);
      hint((r.out || r.err || 'Windows gave no reason.').split(/\r?\n/)[0]);
    }
  }

  blank();
  return failed ? 1 : 0;
}

/* ---------------------------------------------------------------- dispatch */

if (INSTALL) {
  if (platform !== 'win32') { blank(); warn('Not Windows — nothing to install.'); blank(); exit(0); }
  exit(await install());
} else {
  const { code } = await check();
  exit(code);
}
