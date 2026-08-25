/* ==========================================================================
   OG SYSTEM — label printer, direct TCP
   --------------------------------------------------------------------------
   Mirrors server/lib/printer.js (the 80mm receipt's TCP sender) almost
   exactly on purpose — same shape, different printer. Used only when
   config.label.transport = 'tcp': a USB→LAN adapter is on the label
   printer, so the server writes TSPL straight to it instead of a job
   sitting in the agent's poll queue. Same TSPL bytes either way; only the
   delivery mechanism differs.
   ========================================================================== */

import { connect } from 'node:net';

const CONNECT_TIMEOUT_MS = 4000;

export function send(bytes, { host, port = 9100 } = {}) {
  return new Promise((resolve, reject) => {
    if (!host) {
      reject(Object.assign(new Error('no label printer configured'), { code: 'no_printer' }));
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
      done(Object.assign(new Error(`could not reach the label printer: ${e.message}`), { code: 'printer_unreachable' }));
    });

    sock.on('connect', () => {
      sock.write(Buffer.from(bytes), (err) => {
        if (err) return done(Object.assign(new Error(err.message), { code: 'printer_write_failed' }));
        done(null);
      });
    });
  });
}
