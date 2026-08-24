/* ==========================================================================
   OG SYSTEM — talking to the till printer
   --------------------------------------------------------------------------
   A raw TCP write to port 9100. That is the entire protocol an 80mm ESC/POS
   printer speaks over LAN — no driver, no spooler, no library. node:net is
   built into Node, so this stays inside the server's zero-dependency rule.

   The one thing this module must never do is make a sale wait on a printer.
   The money is already in the drawer by the time anything here runs; a
   printer that is off, out of paper, or unplugged fails this call and lets
   the caller decide what "the receipt didn't print" means to the till — it
   must never look like the sale itself failed.
   ========================================================================== */

import { connect } from 'node:net';

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
