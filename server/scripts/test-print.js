/* ==========================================================================
   OG SYSTEM — does paper actually come out?
   --------------------------------------------------------------------------
   Run:  cd server && npm run test-print            (both printers)
         cd server && npm run test-print -- --receipt
         cd server && npm run test-print -- --label

   scripts/hardware.js answers a different question, and the difference is the
   whole reason this file exists. It checks that a QUEUE exists, is shared
   under the right name, and sits on the Generic / Text Only driver. All three
   can be true of a printer that is switched off, out of paper, or plugged
   into a different port than the one Windows thinks.

   This sends the real bytes and lets a person look at the result. It is also
   the only test that catches THE failure printer.js was written about: the
   manufacturer's driver accepts the job and reinterprets ESC/POS command
   bytes as a page of text. When that is what is installed, this slip comes
   out as a column of gibberish with the escape codes printed in it — so a
   readable slip is not decoration, it IS the pass condition. A person can
   tell those two apart across a room; no exit code can.

   It reads the shop's own configuration and uses the shop's own transports
   (lib/printer.js, lib/label-transport-tcp.js), because a test that reaches
   the printer by a route the till does not use has tested the wrong thing.

   The database is opened READ-ONLY: the till is usually running while
   somebody is standing at the printer wondering why it is quiet, and
   DB.open() would apply pending migrations underneath a live shop.

   Exit 0 everything asked for printed · 1 something did not · 2 nothing was
   configured to print to.
   ========================================================================== */

import { argv, exit } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as DB from '../lib/db.js';
import * as Printer from '../lib/printer.js';
import * as LabelTcp from '../lib/label-transport-tcp.js';
import { load, maybe } from '../lib/env.js';

load();

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DB_FILE = maybe('OG_DB') || resolve(HERE, '..', 'data', 'og.db');

const WANT_RECEIPT = argv.includes('--receipt') || !argv.includes('--label');
const WANT_LABEL = argv.includes('--label') || !argv.includes('--receipt');

/* Says where it WOULD send and what it would send, and sends nothing. The
   till prints two copies of every sale, so somebody checking whether the
   queue name is right should not have to spend paper to find out — and a
   shop full of customers should not get a mystery slip at the counter
   because a developer was testing the settings. */
const DRY = argv.includes('--dry');

const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const D = (s) => `\x1b[2m${s}\x1b[0m`;

const say = (s = '') => console.log(s);
const ok = (s) => say(`  ${G('OK')}    ${s}`);
const bad = (s) => say(`  ${R('NO')}    ${s}`);
const warn = (s) => say(`  ${Y('NOTE')}  ${s}`);
const hint = (s) => say(`        ${D(s)}`);

/* ------------------------------------------------------------- the config */

function config() {
  if (!existsSync(DB_FILE)) return null;
  const d = DB.openReadOnly(DB_FILE);
  const rows = d.prepare(
    `SELECT key, value FROM config WHERE key IN
       ('receipt.transport','receipt.printer_share','receipt.printer_host','receipt.printer_port',
        'receipt.cut_mode','label.transport','label.printer_host','label.printer_port',
        'label.density','label.speed','label.default_preset','label.gap_mm','shop.name')`
  ).all();
  const at = (k) => rows.find((r) => r.key === k)?.value ?? '';

  /* The label roll's size comes from the template the shop actually prints
     on, not from a number invented here — a test label at the wrong size
     feeds through the gap sensor wrong and wastes the next one too. */
  let size = { w: 30, h: 30, gap: Number(at('label.gap_mm')) || 2 };
  try {
    const preset = at('label.default_preset');
    const row = preset
      ? d.prepare('SELECT width_mm, height_mm, gap_mm FROM label_templates WHERE key = ? AND archived = 0').get(preset)
      : null;
    const any = row || d.prepare('SELECT width_mm, height_mm, gap_mm FROM label_templates WHERE archived = 0 ORDER BY id LIMIT 1').get();
    if (any) size = { w: any.width_mm, h: any.height_mm, gap: any.gap_mm ?? size.gap };
  } catch { /* no templates table yet; the default above is a real roll size */ }

  return {
    shop: at('shop.name') || 'OG SYSTEM',
    receipt: {
      transport: at('receipt.transport') || 'tcp',
      share: at('receipt.printer_share'),
      host: at('receipt.printer_host'),
      port: Number(at('receipt.printer_port')) || 9100,
      cut: at('receipt.cut_mode') || 'partial'
    },
    label: {
      transport: at('label.transport') || 'tcp',
      host: at('label.printer_host'),
      port: Number(at('label.printer_port')) || 9100,
      density: Number(at('label.density')) || 8,
      speed: Number(at('label.speed')) || 4,
      size
    }
  };
}

/* The label queue's name lives in the print agent's config, which is the one
   place it is written down — the same file scripts/hardware.js reads. */
function agentShare() {
  const file = resolve(ROOT, 'agent', 'agent-config.json');
  if (!existsSync(file)) return '';
  try { return JSON.parse(readFileSync(file, 'utf8')).printerShare || ''; } catch { return ''; }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------ the receipt */

/* Plain ESC/POS text mode, deliberately. The till's real receipt is drawn as
   a canvas in the browser and packed into a bitmap by js/escpos.js, because
   Arabic needs shaping that no thermal printer's own font can do. None of
   that is available here and none of it is what is being tested: what is
   being tested is whether command bytes reach the head and are obeyed.
   ASCII only, for the same reason. */
function receiptBytes(cfg) {
  const ESC = 0x1b, GS = 0x1d;
  const out = [];
  const push = (...b) => out.push(...b);
  const text = (s) => { for (const ch of s) push(ch.charCodeAt(0) & 0xff); };
  const line = (s = '') => { text(s); push(0x0a); };

  push(ESC, 0x40);                       // ESC @   initialise
  push(ESC, 0x61, 0x01);                 // ESC a 1 centre
  push(ESC, 0x21, 0x30);                 // ESC ! n double height + width
  line('OG SYSTEM');
  push(ESC, 0x21, 0x00);                 // back to the normal face
  line('TEST PRINT');
  line();
  push(ESC, 0x61, 0x00);                 // ESC a 0 left
  line('--------------------------------');
  line(`Shop  : ${cfg.shop.replace(/[^\x20-\x7e]/g, '')}`);
  line(`When  : ${stamp()}`);
  line(`Sent  : ${cfg.receipt.transport === 'usb' ? cfg.receipt.share : `${cfg.receipt.host}:${cfg.receipt.port}`}`);
  line('--------------------------------');
  line();
  line('If you can READ this slip, the');
  line('receipt printer is working.');
  line();
  line('If it came out as strange codes,');
  line('the wrong Windows driver is on');
  line('the queue. Run: Set up printers.');
  line();

  push(ESC, 0x64, 0x04);                 // ESC d 4  feed clear of the cutter
  /* GS V 65 = full cut, 66 = partial. The pair js/escpos.js already uses, so
     a shop that set cut_mode gets the cut it asked for here too. */
  push(GS, 0x56, cfg.receipt.cut === 'full' ? 0x41 : 0x42, 0x00);

  return Buffer.from(out);
}

/* -------------------------------------------------------------- the label */

/* TSPL, in the same dialect and the same order as lib/labels.js builds it —
   SIZE and GAP before CLS, DIRECTION/DENSITY/SPEED from the shop's config,
   PRINT last. 203 dpi is 8 dots to the millimetre. */
function labelBytes(cfg) {
  const { w, h, gap } = cfg.label.size;
  const dots = (mm) => Math.round(mm * 8);
  const x = 16;
  const rows = [
    `SIZE ${w} mm,${h} mm`,
    `GAP ${gap} mm,0 mm`,
    'DIRECTION 1',
    `DENSITY ${cfg.label.density}`,
    `SPEED ${cfg.label.speed}`,
    'CLS',
    `TEXT ${x},${Math.round(dots(h) * 0.18)},"3",0,1,1,"OG SYSTEM"`,
    `TEXT ${x},${Math.round(dots(h) * 0.42)},"2",0,1,1,"TEST LABEL"`,
    `TEXT ${x},${Math.round(dots(h) * 0.62)},"1",0,1,1,"${stamp()}"`,
    `TEXT ${x},${Math.round(dots(h) * 0.78)},"1",0,1,1,"${w} x ${h} mm"`,
    'PRINT 1,1'
  ];
  return Buffer.from(rows.join('\r\n') + '\r\n', 'ascii');
}

/* ---------------------------------------------------------------- sending */

async function sendReceipt(cfg) {
  const r = cfg.receipt;
  if (r.transport === 'usb') {
    if (!r.share) {
      warn('The receipt printer is set to USB but no queue name is saved.');
      hint('Settings -> Receipt printer, or run: Check printers.');
      return null;
    }
    if (!DRY) await Printer.sendUsb(receiptBytes(cfg), { printerShare: r.share });
    return r.share;
  }
  if (!r.host) {
    warn('The receipt printer is set to network but no address is saved.');
    hint('Settings -> Receipt printer, or run: Check printers.');
    return null;
  }
  if (!DRY) await Printer.send(receiptBytes(cfg), { host: r.host, port: r.port });
  return `${r.host}:${r.port}`;
}

async function sendLabel(cfg) {
  const l = cfg.label;
  /* A host beats the agent: that is the order lib/labels.js dispatches in. */
  if (l.transport === 'tcp' && l.host) {
    if (!DRY) await LabelTcp.send(labelBytes(cfg), { host: l.host, port: l.port });
    return `${l.host}:${l.port}`;
  }
  const share = agentShare();
  if (!share) {
    warn('There is no label printer configured on this computer.');
    hint('Either set label.transport = tcp with an address, or install the');
    hint('print agent so agent/agent-config.json names its queue.');
    return null;
  }
  if (!DRY) await Printer.sendUsb(labelBytes(cfg), { printerShare: share });
  return share;
}

/* ------------------------------------------------------------------- main */

say('');
say(DRY ? '  Test print — dry run, nothing will be sent' : '  Sending a test print');
say('');

const cfg = config();
if (!cfg) {
  bad(`No database at ${DB_FILE}, so there is no printer configuration to read.`);
  say('');
  exit(2);
}

let tried = 0;
let failed = 0;

if (WANT_RECEIPT) {
  try {
    const where = await sendReceipt(cfg);
    if (where) {
      tried++;
      ok(`Receipt ${DRY ? 'would go to' : 'sent to'} ${where}  ${D(`(${cfg.receipt.transport}, ${receiptBytes(cfg).length} bytes, ${cfg.receipt.cut} cut)`)}`);
    }
  } catch (e) {
    tried++; failed++;
    bad(`The receipt printer refused it — ${e.message}`);
    hint('Switched on, paper in, and the cable in the same port as last time?');
  }
}

if (WANT_LABEL) {
  try {
    const where = await sendLabel(cfg);
    if (where) {
      tried++;
      ok(`Label ${DRY ? 'would go to' : 'sent to'} ${where}  ${D(`(${cfg.label.size.w} x ${cfg.label.size.h} mm, ${labelBytes(cfg).length} bytes)`)}`);
    }
  } catch (e) {
    tried++; failed++;
    bad(`The label printer refused it — ${e.message}`);
    hint('Switched on, labels in, and the roll fed past the gap sensor?');
  }
}

say('');
if (!tried) {
  warn('Nothing was configured to print to, so nothing was sent.');
  say('');
  exit(2);
}
if (failed) {
  say('');
  exit(1);
}

/* The exit code can only say the bytes left this machine. Whether they became
   words on paper is a thing only a person standing at the printer can tell,
   and saying so is more use than a green tick that means less than it looks. */
if (DRY) {
  say('  Nothing was sent. Run it without --dry to put paper through.');
} else {
  say('  Now go and look at the paper.');
  hint('Readable words = working. Strange codes = the wrong driver is installed.');
}
say('');
exit(0);
