/* ==========================================================================
   OG SYSTEM — talking to the till printer
   --------------------------------------------------------------------------
   Two transports, chosen by server/lib/printing.js from receipt.transport:

     send()     a raw TCP write to port 9100 — the entire protocol an 80mm
                ESC/POS printer speaks over LAN. No driver, no spooler.

     sendUsb()  for a printer plugged into THIS machine with no network
                interface (e.g. the XP-T80A). Same trick already proven for
                the USB label printer (agent/print-agent.js's printJob()):
                write the bytes to a temp file and hand them to the spooler
                with a raw binary `copy /b`, targeting a printer queue
                installed under the Generic / Text Only driver rather than
                the printer's real driver — the real driver is what was
                reinterpreting these ESC/POS bytes as a page of text and
                pagination-splitting a single receipt into several. Both
                node:net and node:child_process are built into Node, so this
                stays inside the server's zero-dependency rule.

   The one thing this module must never do is make a sale wait on a printer.
   The money is already in the drawer by the time anything here runs; a
   printer that is off, out of paper, or unplugged fails this call and lets
   the caller decide what "the receipt didn't print" means to the till — it
   must never look like the sale itself failed.
   ========================================================================== */

import { connect } from 'node:net';
import { execFile } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const CONNECT_TIMEOUT_MS = 4000;

/* Opens a socket, writes the bytes, waits for them to actually leave the
   process (not just enter the OS buffer), then closes. Rejects rather than
   hanging on any of: refused connection, DNS failure, or a printer that
   accepts the connection and then never drains — the timeout covers all
   three the same way. */
export function send(bytes, { host, port = 9100 } = {}) {
  return new Promise((resolve, reject) => {
    if (!host) {
      reject(Object.assign(new Error('no printer configured'), { code: 'no_printer' }));
      return;
    }

    const sock = connect({ host, port, timeout: CONNECT_TIMEOUT_MS });
    let settled = false;

    function done(err) {
      if (settled) return;
      settled = true;
      sock.destroy();
      if (err) reject(err);
      else resolve();
    }

    sock.on('timeout', () => {
      done(Object.assign(new Error(`timed out reaching ${host}:${port}`), { code: 'printer_timeout' }));
    });

    sock.on('error', (e) => {
      done(Object.assign(new Error(`could not reach the printer: ${e.message}`), { code: 'printer_unreachable' }));
    });

    sock.on('connect', () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return done(Object.assign(new Error(err.message), { code: 'printer_write_failed' }));
        done(null);
      });
    });
  });
}

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}

/* Decode is already done by the caller — this receives raw bytes, same as
   send() above. Writes to a per-call temp file (random suffix, since two
   receipts can print seconds apart and must never collide) and deletes it
   in the finally regardless of outcome. Does not distinguish "share
   missing" from "printer off" from "access denied" in the error code —
   neither does the label agent this mirrors, and a single retryable
   printer_write_failed is enough for the caller (server/lib/printing.js)
   to log the attempt and let the cashier know without treating it as
   fatal to the sale. */
export async function sendUsb(bytes, { printerShare } = {}) {
  if (!printerShare) {
    throw Object.assign(new Error('no printer share configured'), { code: 'no_printer' });
  }

  const tmp = join(tmpdir(), `ogreceipt-${Date.now()}-${randomBytes(4).toString('hex')}.prn`);
  try {
    writeFileSync(tmp, Buffer.from(bytes));
    await execFileP('cmd.exe', ['/c', 'copy', '/b', tmp, printerShare]);
  } catch (e) {
    throw Object.assign(
      new Error(`could not reach ${printerShare}: ${e.stderr || e.message}`),
      { code: 'printer_write_failed' }
    );
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone, or never written */ }
  }
}
