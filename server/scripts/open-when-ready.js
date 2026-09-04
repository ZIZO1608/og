/* ==========================================================================
   OG SYSTEM — open the shop in the browser once it is up  [open-when-ready.js]
   --------------------------------------------------------------------------
   The launcher starts the server and the server blocks its window, so
   nothing after `node index.js` in the batch file ever runs. Opening the
   browser BEFORE it would land on "this site can't be reached". This runs
   detached alongside the server instead: it polls /api/health until the
   server answers, then opens the address that answered.

   HTTPS when a certificate exists (that is the address that gets
   notifications and the camera), plain HTTP otherwise. It gives up quietly
   after a minute — if the server never came up, index.js has already said
   why in the launcher window, and a second message here would only bury it.
   ========================================================================== */

import { spawn } from 'node:child_process';
import { env, platform } from 'node:process';

const HTTP  = Number(env.OG_PORT || 8090);
const HTTPS = Number(env.OG_HTTPS_PORT || 8443);

/* The certificate is our own, so Node's fetch would refuse it. The check
   only needs to know that SOMETHING answered /api/health with ok:true, and
   the plain port answers the API without redirecting (see httpHandler in
   index.js), so ask there. The answer also says whether HTTPS actually
   came up — not whether a certificate file exists. A certificate on disk
   with the secure port held by something else is a page that will not
   open, and the health line is the one thing that knows. */
async function up() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${HTTP}/api/health`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const b = await r.json();
    return b && b.ok === true ? b : null;
  } catch { return null; }
}

function open(u) {
  if (platform === 'win32') spawn('cmd', ['/c', 'start', '', u], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(platform === 'darwin' ? 'open' : 'xdg-open', [u], { detached: true, stdio: 'ignore' }).unref();
}

const deadline = Date.now() + 60000;
(async function loop() {
  const h = await up();
  if (h) return open(h.https ? `https://localhost:${HTTPS}` : `http://localhost:${HTTP}`);
  if (Date.now() > deadline) return;
  setTimeout(loop, 1000);
})();
