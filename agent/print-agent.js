/* ==========================================================================
   OG SYSTEM — the label print agent
   --------------------------------------------------------------------------
   Runs on whichever laptop has the Xprinter XP-235B plugged in over USB —
   the browser cannot write to a USB device, and this printer is not on the
   network. Plain Node, node:http/https + node:child_process only. No npm,
   nothing to install beyond Node itself.

   Loop: log in once, hold a long-poll open against GET /api/labels/next,
   and whenever a job arrives, write its TSPL bytes to the shared printer
   queue and report back. Never exits on error — every failure path here
   logs and retries, because a queued job sitting untouched for a while is
   a completely normal, harmless state; a crashed agent process is not.

   Config lives in agent-config.json, next to this file:
     {
       "serverUrl": "http://192.168.1.10:8090",
       "station": "warehouse-laptop",
       "username": "label-agent",
       "password": "...",
       "printerShare": "\\\\localhost\\OGLABEL"
     }

   printerShare is a Windows RAW print queue (Devices & Printers -> add the
   XP-235B as a Generic / Text Only printer -> share it as OGLABEL) so a
   `copy /b` at the spooler delivers TSPL bytes untouched, with no driver
   reinterpreting them.
   ========================================================================== */

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

let CFG;
try {
  CFG = JSON.parse(readFileSync(join(HERE, 'agent-config.json'), 'utf8'));
} catch (e) {
  console.error('[agent] could not read agent-config.json next to this file:', e.message);
  console.error('[agent] copy agent-config.example.json to agent-config.json and fill it in.');
  process.exit(1);
}

let cookie = null;          // session cookie, in memory only — never written to disk
let backoffMs = 1000;
const MAX_BACKOFF_MS = 30000;

/* ------------------------------------------------------------- http client
   No Origin header is ever sent from a plain node:http request, and the
   server's CSRF check (server/lib/http.js's originAllowed) explicitly
   passes any request that arrives with none — a browser-only protection,
   not something this agent needs to work around. */
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CFG.serverUrl);
    const isHttps = url.protocol === 'https:';
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;

    const headers = { Accept: 'application/json' };
    if (payload) headers['Content-Type'] = 'application/json';
    if (payload) headers['Content-Length'] = payload.length;
    if (cookie) headers.Cookie = cookie;

    const req = (isHttps ? httpsRequest : httpRequest)(
      { hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname + url.search, method, headers },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie && setCookie[0]) cookie = setCookie[0].split(';')[0];

        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            const err = new Error((json && json.error) || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            err.code = json && json.code;
            reject(err);
          }
        });
      }
    );

    req.on('error', (e) => { e.status = 0; reject(e); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function login() {
  const res = await api('POST', '/api/auth/login', { username: CFG.username, password: CFG.password });
  console.log('[agent] signed in as', res.user.username, `(${res.user.role})`);
}

async function ensureLoggedIn() {
  if (!cookie) await login();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
  });
}

/* Decode, write to a temp file, and hand it to the spooler with a raw
   binary copy — this is what keeps TSPL bytes from being reinterpreted by
   a driver. Reported back to the server either way, so a job never sits
   silently unresolved because of a printer that's off or out of paper. */
async function printJob(job) {
  const bytes = Buffer.from(job.tsplB64, 'base64');
  const tmp = join(tmpdir(), `oglabel-${job.id}.prn`);
  try {
    writeFileSync(tmp, bytes);
    await execFileP('cmd.exe', ['/c', 'copy', '/b', tmp, CFG.printerShare]);
    await api('POST', `/api/labels/${job.id}/done`, { claimToken: job.claimToken });
    console.log(`[agent] printed job ${job.id} (${job.labelCount} label${job.labelCount === 1 ? '' : 's'})`);
  } catch (e) {
    console.error(`[agent] job ${job.id} failed:`, e.message);
    try {
      await api('POST', `/api/labels/${job.id}/failed`, { claimToken: job.claimToken, error: String(e.message || e) });
    } catch (e2) {
      /* Server unreachable too — the job just stays 'claimed' until its
         lease expires and becomes claimable again. Not this process's job
         to fix; see the lease-timeout tradeoff in server/lib/labels.js. */
      console.error('[agent] could not even report the failure:', e2.message);
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone, or never written */ }
  }
}

async function pollLoop() {
  for (;;) {
    try {
      await ensureLoggedIn();
      const res = await api('GET', `/api/labels/next?station=${encodeURIComponent(CFG.station)}`);
      backoffMs = 1000; // a clean round trip, however it answered, resets the backoff
      if (res && res.job) await printJob(res.job);
      // else: nothing pending. The server already held the connection for
      // ~25s, so looping straight back around here is not a busy-loop.
    } catch (e) {
      if (e.status === 401) cookie = null; // force a fresh login next time round
      console.error('[agent] poll failed:', e.message);
      await sleep(backoffMs);
      backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
    }
  }
}

/* Reconnect forever really means forever — nothing below this point should
   ever be allowed to end the process. */
process.on('uncaughtException', (e) => console.error('[agent] uncaught exception, continuing:', e));
process.on('unhandledRejection', (e) => console.error('[agent] unhandled rejection, continuing:', e));

console.log(`[agent] starting — station "${CFG.station}", server ${CFG.serverUrl}`);
pollLoop();
