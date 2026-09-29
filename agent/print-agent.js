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

   RECEIPTS TOO (online first, 24 Sep 2026). When the shop's server is not
   this laptop — the VPS, after the switch — it cannot reach the USB receipt
   printer either, so with receipt.transport = 'agent' the till's receipts
   wait on the server (receipt_jobs, 064) and this agent prints them. Two
   more keys, both optional; without "receiptShare" nothing about receipts
   runs and the agent is exactly what it was:
       "receiptShare":   "\\\\localhost\\OGRECEIPT",
       "receiptStation": "shop"          (the server's receipt.station)
   The account needs sale.reprint for receipts, as well as label.print for
   labels. OG_AGENT_CONFIG names another config file (a test's).
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
  CFG = JSON.parse(readFileSync(process.env.OG_AGENT_CONFIG || join(HERE, 'agent-config.json'), 'utf8'));
} catch (e) {
  console.error('[agent] could not read agent-config.json next to this file:', e.message);
  console.error('[agent] copy agent-config.example.json to agent-config.json and fill it in.');
  process.exit(1);
}

/* ONE SIGN-IN PER LOGIN THE AGENT USES (27 Sep 2026). The label queue needs
   label.print and the receipt queue sale.reprint, and on this shop no role
   below the manager holds both: the owner switched label printing off for
   cashiers on 24 Sep, and the warehouse does not reprint receipts. Rather
   than widen a role for a background program, the label queue may sign in
   as its own login — "labelUsername" / "labelPassword" in the config, a
   warehouse account say. Without them both queues share the one login, as
   they always did. Each login keeps its own cookie, in memory only. */
function makeSession(userKey, passKey) {
  return { userKey, passKey, username: CFG[userKey], cookie: null, signingIn: null, refusedUntil: 0 };
}
const MAIN = makeSession('username', 'password');
const LABELS = CFG.labelUsername ? makeSession('labelUsername', 'labelPassword') : MAIN;
const MAX_BACKOFF_MS = 30000;

/* EVERY LINE SAYS WHEN (29 Sep 2026). agent.log is read after the fact, and
   three hundred "poll failed" lines with no clock could not say whether the
   printer was cut off at nine in the morning or at one at night. Local time,
   because that is the clock on the wall of the shop. */
for (const k of ['log', 'error']) {
  const plain = console[k].bind(console);
  console[k] = (...a) => plain(new Date().toTimeString().slice(0, 8), ...a);
}

/* A REQUEST THAT NEVER ANSWERS IS A FAILURE (29 Sep 2026). There was no limit
   at all: a route that accepted the connection and then said nothing (a
   carrier swallowing HTTPS did exactly that) could hold a queue's loop for as
   long as the proxy's hour-long read timeout. The server holds a long-poll
   for 25 s, so 45 s with no answer is not a slow server, it is no server. */
const REQUEST_TIMEOUT_MS = 45000;

/* ------------------------------------------------------------- http client
   No Origin header is ever sent from a plain node:http request, and the
   server's CSRF check (server/lib/http.js's originAllowed) explicitly
   passes any request that arrives with none — a browser-only protection,
   not something this agent needs to work around. */
function api(method, path, body, s = MAIN) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CFG.serverUrl);
    const isHttps = url.protocol === 'https:';
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;

    const headers = { Accept: 'application/json' };
    if (payload) headers['Content-Type'] = 'application/json';
    if (payload) headers['Content-Length'] = payload.length;
    if (s.cookie) headers.Cookie = s.cookie;

    const req = (isHttps ? httpsRequest : httpRequest)(
      { hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname + url.search, method, headers },
      (res) => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie && setCookie[0]) s.cookie = setCookie[0].split(';')[0];

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

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error(`no answer in ${REQUEST_TIMEOUT_MS / 1000} s`), { status: 0 }));
    });
    req.on('error', (e) => { if (e.status === undefined) e.status = 0; reject(e); });
    if (payload) req.write(payload);
    req.end();
  });
}

/* A REFUSED SIGN-IN IS NOT A DROPPED LINE (27 Sep 2026). Both queues used to
   sign in on their own and retry a refusal after 1 s, 2 s, 4 s … — so a wrong
   password in agent-config.json spent the shop's 8 failures for that username
   in about fifteen seconds, and the PERSON who uses the account (the cashier)
   was locked out of the till for fifteen minutes by a background program.
   Now one sign-in is shared by both loops, and after the shop refuses one
   (wrong password, account switched off, too many attempts) nothing is tried
   again for longer than the shop's lock lasts. The password is read from the
   file again for every try, so correcting it needs no restart. */
const LOGIN_REFUSED_WAIT_MS = 16 * 60 * 1000;

function freshPassword(s) {
  try {
    const c = JSON.parse(readFileSync(process.env.OG_AGENT_CONFIG || join(HERE, 'agent-config.json'), 'utf8'));
    return c[s.passKey];
  } catch { return CFG[s.passKey]; }
}

async function login(s) {
  const res = await api('POST', '/api/auth/login', { username: s.username, password: freshPassword(s) }, s);
  console.log('[agent] signed in as', res.user.username, `(${res.user.role})`);
}

async function ensureLoggedIn(s) {
  if (s.cookie) return;
  if (Date.now() < s.refusedUntil) await sleep(s.refusedUntil - Date.now());
  if (s.cookie) return;
  if (!s.signingIn) {
    s.signingIn = login(s).catch((e) => {
      /* The SHOP's refusal only. A 429 with no code is nginx's own rate limit
         in front of it (a busy minute), not a verdict on the password, and it
         used to stop the printing for sixteen minutes. That one goes round
         the ordinary backoff like any other dropped request. */
      if (e.status === 401 || (e.status === 429 && e.code === 'too_many_attempts')) {
        s.refusedUntil = Date.now() + LOGIN_REFUSED_WAIT_MS;
        console.error(`[agent] the shop refused the sign-in as "${s.username}" (${e.code || e.status}): ${e.message}`);
        console.error('[agent] not trying again for 16 minutes — every wrong try counts against that account, and 8 lock its person out.');
        console.error(`[agent] fix "${s.passKey}" in agent-config.json; it is read again on the next try.`);
        e.quiet = true;
      }
      throw e;
    }).finally(() => { s.signingIn = null; });
  }
  await s.signingIn;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* `copy` says WHY it failed on stdout, not stderr ("Access is denied.", "The
   network name cannot be found."), so the reason is added to the error's
   message. Without it, five receipts in a row were logged as a bare "Command
   failed" and the cause had to be guessed at (27 Sep 2026). */
function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) {
        const said = String(stdout || '').trim() + ' ' + String(stderr || '').trim();
        if (said.trim()) err.message = err.message.trim() + ' — ' + said.trim();
        reject(Object.assign(err, { stderr }));
      } else resolve(stdout);
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
    await api('POST', `/api/labels/${job.id}/done`, { claimToken: job.claimToken }, LABELS);
    console.log(`[agent] printed job ${job.id} (${job.labelCount} label${job.labelCount === 1 ? '' : 's'})`);
  } catch (e) {
    console.error(`[agent] job ${job.id} failed:`, e.message);
    try {
      await api('POST', `/api/labels/${job.id}/failed`, { claimToken: job.claimToken, error: String(e.message || e) }, LABELS);
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

/* A receipt's bytes are already every copy, cut and all (js/receipt.js packs
   both copies into one job), so they go to the spooler ONCE. */
async function printReceipt(job) {
  const tmp = join(tmpdir(), `ogreceipt-${job.id}.prn`);
  try {
    writeFileSync(tmp, Buffer.from(job.bytesB64, 'base64'));
    await execFileP('cmd.exe', ['/c', 'copy', '/b', tmp, CFG.receiptShare]);
    await api('POST', `/api/receipts/${job.id}/done`, { claimToken: job.claimToken });
    console.log(`[agent] printed receipt ${job.saleId || job.id}`);
  } catch (e) {
    console.error(`[agent] receipt ${job.id} failed:`, e.message);
    try {
      await api('POST', `/api/receipts/${job.id}/failed`, { claimToken: job.claimToken, error: String(e.message || e) });
    } catch (e2) {
      console.error('[agent] could not even report the failure:', e2.message);
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone, or never written */ }
  }
}

/* One long-poll loop per queue, each with its own backoff: a label station
   the server refuses must not slow the receipts down, or the other way. */
async function pollLoop(name, path, print, s) {
  let wait = 1000;
  let failing = 0;
  for (;;) {
    try {
      await ensureLoggedIn(s);
      const res = await api('GET', path, undefined, s);
      wait = 1000; // a clean round trip, however it answered, resets the backoff
      /* Said once, so the log shows when the line came back, not only that
         it went. */
      if (failing) { console.log(`[agent] ${name}: reached the server again after ${failing} failed tries`); failing = 0; }
      if (res && res.job) await print(res.job);
      // else: nothing pending. The server already held the connection for
      // ~25s, so looping straight back around here is not a busy-loop.
    } catch (e) {
      if (e.status === 401) s.cookie = null; // force a fresh login next time round
      failing++;
      if (!e.quiet) console.error(`[agent] ${name} poll failed:`, e.message);
      await sleep(wait);
      wait = Math.min(MAX_BACKOFF_MS, wait * 2);
    }
  }
}

/* Reconnect forever really means forever — nothing below this point should
   ever be allowed to end the process. */
process.on('uncaughtException', (e) => console.error('[agent] uncaught exception, continuing:', e));
process.on('unhandledRejection', (e) => console.error('[agent] unhandled rejection, continuing:', e));

if (CFG.printerShare && CFG.station) {
  console.log(`[agent] labels — station "${CFG.station}", server ${CFG.serverUrl}`);
  pollLoop('labels', `/api/labels/next?station=${encodeURIComponent(CFG.station)}`, printJob, LABELS);
}
if (CFG.receiptShare) {
  const st = CFG.receiptStation || 'shop';
  console.log(`[agent] receipts — station "${st}", server ${CFG.serverUrl}`);
  pollLoop('receipts', `/api/receipts/next?station=${encodeURIComponent(st)}`, printReceipt, MAIN);
}
