/* ==========================================================================
   OG SYSTEM — orders placed on the website                  [weborders.js]
   --------------------------------------------------------------------------
   The website never talks to this laptop to place an order. It leaves the
   order in Supabase (server/supabase/030_web_orders.sql, web.orders), and
   this file collects it every minute while the mirror is live
   (lib/sync-worker.js), the way lib/inbox.js collects og-track's reviews.
   The contract the website builds to is docs/website/PROMPT-FOR-AHMAD.md;
   that file is the one copy of the order's shape.

   What the owner decided (23 Sep 2026), and where each one lives:

   1. A WEBSITE ORDER WAITS FOR A PERSON. Collecting one moves no stock and
      no money: it becomes a row in web_orders (migration 061), the bell says
      so, and somebody calls the customer. Accept opens the order desk filled
      in, and the desk's own Save writes the order through Orders.create with
      opId weborder:<ref> — so two people accepting at once make ONE order.
      Only then does the row say 'accepted' (accepted() below).
   2. PRINT JOBS GO STRAIGHT TO YALLA WEAR, the moment the order is
      collected, through Partner.create exactly as the till raises one
      (source 'web', autoSend). A test order (ref TEST-…) sends nothing.
   3. THE WEBSITE HEARS BACK. Every pass tells the cloud what happened —
      received, accepted (with the sale and its tracking token) or rejected
      (with a code the website shows the customer) — and cloud_state records
      what has been said, so a report lost to a dropped line goes again.

   Nothing the website sent is trusted because the cloud checked it: the
   desk prices every line from the product table, the print price is the
   shop's own (Partner.webPrices), and a SKU the shop does not know is shown
   as unknown rather than guessed at.
   ========================================================================== */

import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { get, tx, nowIso } from './db.js';
import { dataDir } from './env.js';
import * as SB from './supabase.js';
import * as Partner from './partner.js';
import * as Customers from './customers.js';
import * as Orders from './orders.js';
import * as Live from './live.js';
import * as PrintKits from './printkits.js';

const TAKE = 10;
const REF = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;

/* The reasons a person may give for saying no, and the only ones the website
   has words for (docs/website/PROMPT-FOR-AHMAD.md §7). */
export const REJECT_CODES = ['no_answer', 'out_of_stock', 'customer_cancelled', 'unpaid', 'duplicate', 'test', 'other',
  /* 071 — a printed shirt the shop cannot print as asked (a name that breaks
     the rules, no number, a product that takes no print). */
  'bad_print'];

/* The key Orders.create replays on. Not `web:` — POST /api/ext/print-jobs
   already writes applied_ops rows under that prefix. */
export const opIdFor = (ref) => 'weborder:' + ref;
export const isTest = (ref) => /^TEST-/i.test(String(ref || ''));

const fail = (message, code, status = 409) => Object.assign(new Error(message), { code, status });

function parse(text, fallback) {
  try { const v = JSON.parse(text); return v == null ? fallback : v; } catch { return fallback; }
}

function baseCurrency(d = get()) {
  const r = d.prepare("SELECT value FROM config WHERE key = 'shop.base_currency'").get();
  return (r && String(r.value).trim()) || 'SYP';
}

/* ------------------------------------------------------- the transfer photo */

/* Kept on this laptop, beside the database and moved with it (OG_DATA_DIR):
   the cloud keeps its own copy until the order is decided, so a laptop that
   takes the shop over is handed it again. */
function proofDir() { return join(dataDir(), 'web-proofs'); }

function proofName(ref, revision, ext) {
  /* A short hash beside the ref, because Windows does not tell W-1 from w-1. */
  const h = createHash('sha1').update(ref).digest('hex').slice(0, 6);
  return `${ref}-${h}-r${revision}.${ext}`;
}

function saveProof(ref, revision, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  mkdirSync(proofDir(), { recursive: true });
  const name = proofName(ref, revision, ext);
  writeFileSync(join(proofDir(), name), Buffer.from(m[2], 'base64'));
  return name;
}

export function proofPath(ref) {
  const row = get().prepare('SELECT proof_file FROM web_orders WHERE ref = ?').get(String(ref));
  if (!row || !row.proof_file) return null;
  const p = join(proofDir(), row.proof_file);
  return existsSync(p) ? p : null;
}

/* ------------------------------------------------------------- print jobs */

/* Every print in the order becomes a job, sent to Yalla Wear in the same
   transaction when every shirt has a name. job_ids is written after EACH job,
   so a pass that dies half way resumes at the next print instead of raising
   the first one twice. Only ever LINKED to a customer who already exists —
   a website order nobody has confirmed does not make a customer. */
function sendPrints(ref) {
  const d = get();
  const row = d.prepare('SELECT payload, job_ids FROM web_orders WHERE ref = ?').get(ref);
  if (!row) return { sent: 0 };
  const o = parse(row.payload, {});
  const prints = Array.isArray(o.prints) ? o.prints : [];
  const jobs = parse(row.job_ids, []);
  if (jobs.length >= prints.length) return { sent: 0 };

  const who = o.customer || {};
  const holder = Customers.findByPhone(who.phone);
  const px = Partner.webPrices();
  const currency = baseCurrency(d);
  let sent = 0;

  for (let i = jobs.length; i < prints.length; i++) {
    const p = prints[i] || {};
    const club = Partner.clubCodeFor(p.clubCode, d);
    const lines = Array.isArray(p.lines) && p.lines.length
      ? p.lines.map((l) => ({
          clubCode: club,
          printName: (l && l.printName) || null,
          number: l && l.number != null ? String(l.number) : null,
          size: (l && l.size) || null,
          qty: Math.max(1, Math.floor(Number(l && l.qty) || 1)),
          unitCost: px.cost
        }))
      : [];
    const kind = lines.length ? 'kit' : 'bulk';
    const qty = kind === 'kit' ? lines.reduce((a, l) => a + l.qty, 0) : Math.max(1, Math.floor(Number(p.qty) || 1));
    const job = Partner.create({
      customer: String(who.name || ref).slice(0, 80),
      phone: who.phone ? String(who.phone).slice(0, 40) : null,
      design: String(p.design || ref).slice(0, 120),
      kind, qty, priority: 'normal', deadline: null,
      price: px.price == null ? 0 : qty * px.price,   // no website print price set: agreed on the call
      cost: kind === 'bulk' ? qty * px.cost : null,
      currency, lines, customerId: holder ? holder.id : null,
      source: 'web', autoSend: true, userId: null
    });
    jobs.push(job.id);
    d.prepare('UPDATE web_orders SET job_ids = ?, updated_at = ? WHERE ref = ?')
      .run(JSON.stringify(jobs), nowIso(), ref);
    sent++;
  }
  return { sent };
}

/* ------------------------------------------------ printed shirts (071)
   Contract v1.6: a line the customer wants printed carries
       "print": { "name": "MESSI", "number": 10, "kitId": 12 }
   beside its sku and qty. Unlike the old `prints[]` (above, kept working:
   one job per print, sent the moment the order is collected), these become
   ONE job for the whole order, raised when a person ACCEPTS it — a shirt is
   only printed for an order somebody has called and confirmed. */

function variantFor(d, sku) {
  return sku ? d.prepare(
    `SELECT v.sku, v.size, p.id AS product_id, p.name, p.printable, p.print_kit_id
       FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ?`
  ).get(String(sku)) : null;
}

/* Every line of the order that asks for a print, checked against the rules
   as the SHOP has them now. `problem` is a code (PrintKits.checkLine). */
export function printedLines(d, o) {
  const out = [];
  const items = Array.isArray(o && o.items) ? o.items : [];
  items.forEach((it, i) => {
    if (!it || it.print == null) return;
    const v = variantFor(d, it.sku);
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
    const c = PrintKits.checkLine(it.print, v, d);
    out.push({ index: i, sku: String(it.sku || ''), qty, variant: v, ...c });
  });
  return out;
}

/* Stage 1b — WHAT THE SALE CHARGES FOR PRINTING: one service line, as many
   shirts as the order has printed, whichever shape they came in (each
   printed item's qty, and the older prints[]: a job's lines' qty, or its
   plain qty). Nothing when the print price is not set — the website then
   told the customer "price by phone", and the price is agreed on the call
   and put on the job, as before. */
export function printServices(ref) {
  const d = get();
  const row = d.prepare('SELECT payload FROM web_orders WHERE ref = ?').get(String(ref));
  if (!row || isTest(ref)) return [];
  if (!Partner.webPrices(d).unit) return [];
  const o = parse(row.payload, {});
  let n = printedLines(d, o).filter((l) => !l.problem).reduce((a, l) => a + l.qty, 0);
  for (const p of Array.isArray(o.prints) ? o.prints : []) {
    const lines = Array.isArray(p && p.lines) ? p.lines : [];
    n += lines.length
      ? lines.reduce((a, l) => a + Math.max(1, Math.floor(Number(l && l.qty) || 1)), 0)
      : Math.max(1, Math.floor(Number(p && p.qty) || 1));
  }
  return n > 0 ? [{ code: 'print', qty: n }] : [];
}

/* The one print job for an accepted order. Idempotent per ref: the job
   carries web_ref (unique), so a second Save, a retry after a lost answer,
   or two people pressing Accept find the first job and raise none. Its own
   transaction (Partner.create), after the order's — DB.tx() does not nest,
   and a job that failed to raise must not unwind a sale already written; it
   is retried on the next Save and named on the card meanwhile (print_error). */
export function raisePrintJob(ref, saleId, userId) {
  const d = get();
  const row = d.prepare('SELECT payload FROM web_orders WHERE ref = ?').get(String(ref));
  if (!row || isTest(ref)) return null;
  const had = d.prepare('SELECT id FROM print_jobs WHERE web_ref = ?').get(String(ref));
  if (had) return { jobId: had.id, created: false };
  const o = parse(row.payload, {});
  const lines = printedLines(d, o);
  if (!lines.length) return null;
  const bad = lines.find((l) => l.problem);
  if (bad) throw fail(`line ${bad.index + 1} cannot be printed (${bad.problem})`, 'bad_print');

  const sale = saleId ? d.prepare('SELECT customer_id, customer_name FROM sales WHERE id = ?').get(saleId) : null;
  const cust = sale && sale.customer_id
    ? d.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(sale.customer_id) : null;
  const who = o.customer || {};
  const px = Partner.webPrices(d);
  const rules = PrintKits.rules(d);
  const qty = lines.reduce((a, l) => a + l.qty, 0);
  try {
    const job = Partner.create({
      customer: String((cust && cust.name) || who.name || (sale && sale.customer_name) || ref).slice(0, 80),
      phone: String((cust && cust.phone) || who.phone || '').slice(0, 40) || null,
      design: `Website ${ref} · name & number`,
      kind: 'kit', qty, priority: 'normal',
      deadline: PrintKits.deadlineFrom(rules.turnaround.max, d),
      /* What the customer pays, in the base currency at the rate of the
         moment (Partner.webPrices). The printer's cost is the existing web
         rule: per shirt, on the line, never on the job. */
      price: px.price == null ? 0 : qty * px.price,
      cost: null,
      currency: px.currency,
      saleId: saleId || null,
      customerId: cust ? cust.id : null,
      webRef: String(ref),
      lines: lines.map((l) => ({
        /* The kit's club when it has one — clubCodeFor drops a club the shop
           no longer prints (the foreign key) rather than fail the job. */
        clubCode: Partner.clubCodeFor(l.kit.clubCode, d),
        printName: l.name,
        number: l.number,
        size: l.variant.size,
        qty: l.qty,
        unitCost: px.cost,
        item: l.variant.name,
        kitSnapshot: PrintKits.snapshot(l.kit)
      })),
      source: 'web', autoSend: true, userId: userId ?? null
    });
    d.prepare('UPDATE web_orders SET print_error = NULL WHERE ref = ?').run(String(ref));
    return { jobId: job.id, created: true };
  } catch (e) {
    /* Two Saves at once: the other one raised it. */
    const now = d.prepare('SELECT id FROM print_jobs WHERE web_ref = ?').get(String(ref));
    if (now) return { jobId: now.id, created: false };
    d.prepare('UPDATE web_orders SET print_error = ? WHERE ref = ?')
      .run(String((e && (e.message || e.code)) || e).slice(0, 200), String(ref));
    throw e;
  }
}

/* ------------------------------------------------------------- collecting */

/* One item from the cloud into web_orders. Answers the mark to send back, or
   null when it could not be stored (it stays in the cloud for the next pass). */
function absorb(item, count) {
  const d = get();
  const ref = String((item && item.ref) || '');
  const revision = Number(item && item.revision);
  const payload = item && item.payload;
  if (!REF.test(ref) || !Number.isSafeInteger(revision) || !payload || typeof payload !== 'object') {
    count.bad++;
    return null;
  }

  const row = d.prepare('SELECT * FROM web_orders WHERE ref = ?').get(ref);

  /* Decided here already: the cloud missed the answer, so say it again. */
  if (row && row.state !== 'new') return null;

  let proof = null;
  if (item.proof && (!row || row.revision !== revision || !row.proof_file)) {
    try { proof = saveProof(ref, revision, item.proof); }
    catch (e) { console.error(`[${nowIso()}] web order ${ref}: the transfer photo was not saved — ${e.message}`); }
  }
  const at = nowIso();

  if (!row) {
    /* An order another laptop collected and never decided comes back with
       the print jobs it already raised — those arrived here with the mirror,
       and are never raised twice. */
    const jobs = Array.isArray(item.jobIds) ? item.jobIds.map(String) : [];
    d.prepare(
      `INSERT INTO web_orders
         (ref, revision, state, payload, placed_at, received_at, updated_at, proof_file, proof_ref, job_ids)
       VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)`
    ).run(ref, revision, JSON.stringify(payload), String(item.createdAt || at), at, at,
          proof, item.proofRef ? String(item.proofRef).slice(0, 80) : null, JSON.stringify(jobs));
    count.fresh++;
  } else if (row.revision !== revision || proof) {
    if (proof && row.proof_file && row.proof_file !== proof) {
      try { unlinkSync(join(proofDir(), row.proof_file)); } catch { /* housekeeping */ }
    }
    d.prepare(
      `UPDATE web_orders
          SET revision = ?, proof_file = COALESCE(?, proof_file),
              proof_ref = COALESCE(?, proof_ref), updated_at = ?
        WHERE ref = ?`
    ).run(revision, proof, item.proofRef ? String(item.proofRef).slice(0, 80) : null, at, ref);
    count.updated++;
  }

  if (!isTest(ref)) {
    try {
      count.prints += sendPrints(ref).sent;
      d.prepare('UPDATE web_orders SET print_error = NULL WHERE ref = ?').run(ref);
    } catch (e) {
      const why = String((e && (e.message || e.code)) || e).slice(0, 200);
      d.prepare('UPDATE web_orders SET print_error = ? WHERE ref = ?').run(why, ref);
      console.error(`[${nowIso()}] web order ${ref}: a print job was not sent — ${why}`);
    }
  }
  return true;
}

/* What the cloud should be told about a row, and whether it already has been. */
function wanted(row) {
  return row.state === 'new' ? 'received:' + row.revision : row.state;
}

function markFor(d, row) {
  const jobIds = parse(row.job_ids, []);
  if (row.state === 'new') return { ref: row.ref, state: 'received', revision: row.revision, jobIds };
  if (row.state === 'accepted') {
    const s = row.sale_id ? d.prepare('SELECT public_token FROM sales WHERE id = ?').get(row.sale_id) : null;
    return { ref: row.ref, state: 'accepted', saleId: row.sale_id, token: (s && s.public_token) || null, jobIds };
  }
  return { ref: row.ref, state: 'rejected', code: row.reject_code || 'other' };
}

async function pass(lineage) {
  const d = get();
  const took = await SB.rpc('web_orders_take', { p_lineage: lineage, p_limit: TAKE });
  if (!took || took.ok !== true) {
    const code = (took && took.code) || 'bad_answer';
    return code === 'not_owner' ? { skipped: 'not_owner' } : { error: code };
  }
  const items = Array.isArray(took.items) ? took.items : [];
  const count = { taken: items.length, fresh: 0, updated: 0, prints: 0, bad: 0, reported: 0, unreported: null };

  const taken = [];
  for (const item of items) {
    try {
      absorb(item, count);
      const ref = String((item && item.ref) || '');
      if (REF.test(ref)) taken.push(ref);
    } catch (e) {
      count.bad++;
      console.error(`[${nowIso()}] web order ${item && item.ref} left in the cloud — ${e.message}`);
    }
  }

  /* Everything the cloud has not heard yet: any decision made since the last
     pass (or whose report was lost) — AND EVERY ORDER JUST TAKEN, whether or
     not anything changed here. The cloud hands an order over again for as
     long as it thinks another laptop holds it; one this laptop already had
     (the shop moved away and back) changed nothing locally, so without this
     it was taken every minute for ever, and twenty of them would have kept
     every new website order out of the take's LIMIT. Found by running the
     end-to-end test twice against one cloud. */
  const due = d.prepare(
    `SELECT * FROM web_orders
      WHERE cloud_state IS NULL
         OR cloud_state <> CASE state WHEN 'new' THEN 'received:' || revision ELSE state END
      ORDER BY placed_at LIMIT 50`
  ).all();
  const one = d.prepare('SELECT * FROM web_orders WHERE ref = ?');
  for (const ref of taken) {
    if (due.length >= 50) break;
    if (due.some((r) => r.ref === ref)) continue;
    const r = one.get(ref);
    if (r) due.push(r);
  }
  if (due.length) {
    try {
      const done = await SB.rpc('web_orders_mark', { p_lineage: lineage, p_items: due.map((r) => markFor(d, r)) });
      if (done && done.ok === true) {
        const at = nowIso();
        const set = d.prepare('UPDATE web_orders SET cloud_state = ?, cloud_at = ? WHERE ref = ?');
        for (const r of due) set.run(wanted(r), at, r.ref);
        count.reported = due.length;
      } else {
        count.unreported = (done && done.code) || 'bad_answer';
      }
    } catch (e) {
      count.unreported = e.message;
    }
  }

  if (count.fresh || count.updated || count.prints) {
    try { Live.notify('all', { web: true }); } catch { /* the screen catches up on load */ }
  }
  return count;
}

/* One pass: { taken, fresh, updated, prints, bad, reported, unreported },
   { skipped } (no lineage, no Supabase, not the mirror's owner) or { error }. */
export async function collect({ lineage } = {}) {
  if (!lineage) return { skipped: 'no_lineage' };
  if (!SB.isConfigured()) return { skipped: 'not_configured' };
  try {
    return await pass(lineage);
  } catch (e) {
    return { error: String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 300) };
  }
}

/* ------------------------------------------------------ what a person does */

function rowOf(ref) {
  const row = get().prepare('SELECT * FROM web_orders WHERE ref = ?').get(String(ref || ''));
  if (!row) throw fail('no such website order', 'not_found', 404);
  return row;
}

/* Before the desk writes the order: it must be one somebody may still say
   yes to. Accepted already is answered, not refused — the desk's Save
   replays on the same opId and gets the same order back. */
export function forAccept(ref) {
  const row = rowOf(ref);
  if (isTest(row.ref)) throw fail('a test order cannot become a real order — reject it', 'test_order');
  if (row.state === 'rejected') throw fail('this website order was rejected', 'web_rejected');
  /* 071 — a printed shirt the shop cannot print is refused BEFORE the order
     is written: the customer paid for a print, and an order accepted without
     one is the wrong order. The card says which line and why; the person
     calls, or rejects with bad_print. An order already accepted is let
     through so its Save replays. */
  if (row.state === 'new') {
    const bad = printedLines(get(), parse(row.payload, {})).filter((l) => l.problem);
    if (bad.length) {
      throw Object.assign(fail(`${bad.length} printed shirt(s) cannot be printed as asked: ` +
        bad.map((l) => `line ${l.index + 1} (${l.problem})`).join(', '), 'bad_print'),
        { lines: bad.map((l) => ({ index: l.index, sku: l.sku, problem: l.problem, maxLetters: l.maxLetters })) });
    }
  }
  return row;
}

export function accepted(ref, saleId, userId) {
  const at = nowIso();
  return tx((d) => {
    const row = d.prepare('SELECT state, sale_id FROM web_orders WHERE ref = ?').get(ref);
    if (!row) return false;
    if (row.state === 'accepted') return true;
    d.prepare(
      `UPDATE web_orders
          SET state = 'accepted', sale_id = ?, decided_at = ?, decided_by = ?, updated_at = ?
        WHERE ref = ? AND state = 'new'`
    ).run(saleId, at, userId ?? null, at, ref);
    return true;
  });
}

export function reject(ref, { code, note, userId }) {
  if (!REJECT_CODES.includes(code)) throw fail('say why it is being rejected', 'bad_code', 400);
  const at = nowIso();
  return tx((d) => {
    const row = d.prepare('SELECT state FROM web_orders WHERE ref = ?').get(String(ref || ''));
    if (!row) throw fail('no such website order', 'not_found', 404);
    if (row.state === 'accepted') throw fail('this website order is already a real order', 'web_accepted');
    if (row.state === 'rejected') return { ref, state: 'rejected' };
    d.prepare(
      `UPDATE web_orders
          SET state = 'rejected', reject_code = ?, reject_note = ?, decided_at = ?, decided_by = ?, updated_at = ?
        WHERE ref = ? AND state = 'new'`
    ).run(code, note ? String(note).trim().slice(0, 300) || null : null, at, userId ?? null, at, ref);
    return { ref, state: 'rejected' };
  });
}

/* The customer to put on the order: whoever already has this number, or a
   new record made from what the website sent — only now, when a person has
   decided the order is real. */
export function customerFor(ref, userId) {
  const row = rowOf(ref);
  const o = parse(row.payload, {});
  const who = o.customer || {};
  const holder = Customers.findByPhone(who.phone);
  if (holder) return { customerId: holder.id, created: false, name: holder.name };
  const dlv = o.delivery || {};
  const made = Customers.create({
    name: String(who.name || '').slice(0, 80),
    phone: who.phone ? String(who.phone).slice(0, 40) : null,
    city: dlv.method !== 'pickup' && dlv.city ? String(dlv.city).slice(0, 80) : null,
    address: dlv.method !== 'pickup' && dlv.address ? String(dlv.address).slice(0, 500) : null,
    source: 'online'
  }, userId);
  const c = made && (made.customer || made);
  return { customerId: c.id, created: true, name: c.name };
}

/* ------------------------------------------------------------- the screen */

const STATES = ['new', 'accepted', 'rejected'];

/* Every line as the SHOP sees it — its own name, price and stock beside what
   the customer was shown — never a cost. */
function itemsOf(d, o, whId) {
  const q = d.prepare(
    `SELECT v.sku, v.size, p.id AS product_id, p.name, p.brand, p.selling_price, p.currency,
            p.hidden, p.on_web, c.name_en AS colour_en, c.name_ar AS colour_ar,
            (SELECT COUNT(*) FROM product_colours pc WHERE pc.product_id = p.id) AS colours,
            COALESCE((SELECT s.qty FROM stock s WHERE s.sku = v.sku AND s.wh_id = ?), 0) AS here,
            COALESCE((SELECT SUM(s.qty) FROM stock s WHERE s.sku = v.sku), 0) AS total,
            (SELECT minor_exp FROM currencies cu WHERE cu.code = p.currency) AS minor_exp
       FROM variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_colours c ON c.id = v.colour_id
      WHERE v.sku = ?`
  );
  /* 071 — each printed line as the shop reads it: the cleaned name and
     number, the kit it will be printed in, or why it cannot be. */
  const printed = new Map(printedLines(d, o).map((l) => [l.index, l]));
  const printOf = (i, it) => {
    const l = printed.get(i);
    if (!l) return null;
    const p = it.print && typeof it.print === 'object' ? it.print : {};
    return l.problem
      ? { problem: l.problem, maxLetters: l.maxLetters ?? null,
          asked: { name: typeof p.name === 'string' ? p.name.slice(0, 40) : null,
                   number: p.number == null ? null : String(p.number).slice(0, 8) } }
      : { name: l.name, number: l.number, kitId: l.kit.id, kitLabel: l.kit.label, substituted: !!l.substituted };
  };
  return (Array.isArray(o.items) ? o.items : []).map((it, i) => {
    const sku = String((it && it.sku) || '');
    const qty = Math.max(1, Math.floor(Number(it && it.qty) || 1));
    const v = sku ? q.get(whId, sku) : null;
    const print = it ? printOf(i, it) : null;
    const shown = { name: it && it.name ? String(it.name).slice(0, 120) : null,
                    size: it && it.size != null ? String(it.size).slice(0, 20) : null,
                    price: Number.isFinite(Number(it && it.price)) ? Number(it.price) : null,
                    currency: it && it.currency ? String(it.currency).slice(0, 3) : null };
  /* What the customer saw is drawn in ITS currency's own decimals, from the
     currencies table — the screen used to guess (USD 2, anything else 0). */
  if (shown.currency) {
    const cu = d.prepare('SELECT minor_exp FROM currencies WHERE code = ?').get(shown.currency);
    shown.minorExp = cu ? cu.minor_exp : null;
  }
    if (!v) return { sku, qty, known: false, shown, print };
    return {
      sku, qty, known: true, shown, print,
      productId: v.product_id, name: v.name, brand: v.brand, size: v.size,
      colour: v.colours > 1 && (v.colour_en || v.colour_ar) ? { en: v.colour_en, ar: v.colour_ar } : null,
      price: v.selling_price, currency: v.currency, minorExp: v.minor_exp ?? 0,
      archived: !!v.hidden, here: v.here, total: v.total
    };
  });
}

function printsOf(d, o, jobIds) {
  const prints = Array.isArray(o.prints) ? o.prints : [];
  const q = d.prepare('SELECT id, stage, order_state FROM print_jobs WHERE id = ?');
  return prints.map((p, i) => {
    const id = jobIds[i] || null;
    const j = id ? q.get(id) : null;
    const lines = Array.isArray(p && p.lines) ? p.lines.slice(0, 40).map((l) => ({
      printName: l && l.printName ? String(l.printName).slice(0, 40) : null,
      number: l && l.number != null ? String(l.number).slice(0, 8) : null,
      size: l && l.size ? String(l.size).slice(0, 12) : null,
      qty: Math.max(1, Math.floor(Number(l && l.qty) || 1))
    })) : [];
    return {
      design: String((p && p.design) || '').slice(0, 120),
      clubCode: p && p.clubCode ? String(p.clubCode).slice(0, 20) : null,
      qty: lines.length ? lines.reduce((a, l) => a + l.qty, 0) : Math.max(1, Math.floor(Number(p && p.qty) || 1)),
      lines, note: p && p.note ? String(p.note).slice(0, 300) : null,
      jobId: id, stage: j ? j.stage : null, orderState: j ? j.order_state : null
    };
  });
}

function shape(d, row, { seesCustomers, whId }) {
  const o = parse(row.payload, {});
  const who = o.customer || {};
  const dlv = o.delivery || {};
  const pay = o.payment || {};
  const jobIds = parse(row.job_ids, []);
  const holder = seesCustomers ? Customers.findByPhone(who.phone) : null;
  const by = row.decided_by ? d.prepare('SELECT name FROM users WHERE id = ?').get(row.decided_by) : null;
  const txt = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
  return {
    ref: row.ref, state: row.state, test: isTest(row.ref),
    placedAt: row.placed_at, receivedAt: row.received_at, decidedAt: row.decided_at,
    decidedBy: by ? by.name : null, saleId: row.sale_id,
    rejectCode: row.reject_code, rejectNote: row.reject_note,
    lang: o.lang === 'en' ? 'en' : 'ar',
    customer: { name: txt(who.name, 80), phone: txt(who.phone, 40), email: txt(who.email, 120) },
    match: holder ? { id: holder.id, name: holder.name } : null,
    delivery: {
      method: txt(dlv.method, 12), country: txt(dlv.country, 2), city: txt(dlv.city, 80),
      address: txt(dlv.address, 500), recipient: txt(dlv.recipient, 80), phone: txt(dlv.phone, 40),
      note: txt(dlv.note, 300)
    },
    payment: { type: pay.type === 'transfer' ? 'transfer' : 'cod', method: txt(pay.method, 32),
               reference: txt(row.proof_ref || pay.reference, 80) },
    hasProof: !!row.proof_file,
    items: itemsOf(d, o, whId),
    prints: printsOf(d, o, jobIds),
    printError: row.print_error || null,
    /* 071 — the one job the order's printed shirts became when it was
       accepted, and where it is. */
    printJob: (() => {
      const j = d.prepare('SELECT id, stage, order_state, deadline FROM print_jobs WHERE web_ref = ?').get(row.ref);
      return j ? { id: j.id, stage: j.stage, orderState: j.order_state, deadline: j.deadline } : null;
    })(),
    shown: o.shown && typeof o.shown === 'object' ? o.shown : null,
    /* 068 / contract v1.4 — the code the customer gave; the desk checks it
       again, for real, when the order is accepted. */
    coupon: typeof o.coupon === 'string' && o.coupon.trim()
      ? o.coupon.replace(/\s+/g, '').toUpperCase().slice(0, 24) : null,
    note: txt(o.note, 500)
  };
}

export function list({ state = 'new', limit = 60, seesCustomers = false } = {}) {
  const d = get();
  const st = STATES.includes(state) ? state : 'new';
  const n = Math.min(Math.max(Number(limit) || 60, 1), 200);
  const whId = Orders.settings(d).wh;
  const rows = d.prepare(
    `SELECT * FROM web_orders WHERE state = ?
      ORDER BY ${st === 'new' ? 'placed_at ASC' : 'decided_at DESC'} LIMIT ?`
  ).all(st, n);
  const counts = { new: 0, accepted: 0, rejected: 0 };
  for (const r of d.prepare('SELECT state, COUNT(*) AS n FROM web_orders GROUP BY state').all()) counts[r.state] = r.n;
  return {
    orders: rows.map((r) => shape(d, r, { seesCustomers, whId })),
    counts, shown: rows.length, total: counts[st], capped: counts[st] > rows.length,
    whId
  };
}

export function waiting() {
  const r = get().prepare("SELECT COUNT(*) AS n FROM web_orders WHERE state = 'new'").get();
  return r ? r.n : 0;
}
