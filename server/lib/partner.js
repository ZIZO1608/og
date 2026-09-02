/* ============================================================================
   THE PARTNER HALF                                              [partner.js]
   ----------------------------------------------------------------------------
   Print jobs, the two-way line to Yalla Wear, the invoices between the two
   companies, and the two shop-side lists that never had tables: suppliers and
   employees.

   All of this used to be generated in the browser on every page load, which
   meant the partner portal recorded nothing — a job moved to "printing" and
   moved back on refresh.

   THE RULES THAT LIVE HERE, NOT IN THE BROWSER
   --------------------------------------------
   The frontend enforces the same three, so nobody is made to look wrong in
   front of a customer. But the browser deciding is a courtesy; this is the
   boundary, and Yalla Wear is a different company on the other side of it.

     1. Stages only go forward, one of design → sent → printing → delivery
        → done, and never sideways into a stage that does not exist.

     2. Nothing passes 'sent' while a shirt still has no name on it. A blank
        name is a real state — an order is taken before the squad is settled
        — and a shirt with no name cannot be printed.

     3. 'sent' means THE PRINTER TOOK THE JOB. The shop cannot assert that
        about another company, so the stage cannot reach 'sent' until the
        order is accepted.

   Money is integer minor units plus a currency code, like everywhere else.
   A kit job's qty and cost are derived from its lines and never stored, so a
   line and its job total cannot disagree.
   ========================================================================== */

import * as DB from './db.js';

export const STAGES = ['design', 'sent', 'printing', 'delivery', 'done'];
const STAGE_LABEL = {
  design: 'Design', sent: 'Sent to print', printing: 'Printing',
  delivery: 'Delivery', done: 'Done'
};
/* Moving a job is news the other side needs, so some steps post themselves. */
const STAGE_MESSAGE = { sent: 'stage', printing: 'in-print', delivery: 'shipped', done: 'shipped' };

const nowIso = () => new Date().toISOString();
const other = (side) => (side === 'og' ? 'yalla' : 'og');

/* ---- the outbox -----------------------------------------------------------
   Every change the other company needs to HEAR about — not just see on the
   next reload — is written to partner_events in the same transaction as the
   change itself, and lib/telegram.js drains it. Written inside the tx so a
   rolled-back write tells nobody; read by a worker so a dead Telegram cannot
   fail a sale.

   THE STRIP LIST LIVES HERE, keyed on who is listening. A message to Yalla
   Wear's bot goes to another company's phone, and it must carry exactly what
   GET /api/partner would give them: never the customer's name or number, never
   what the shop charges. Done once at the door rather than remembered at
   every call site, because the call site that forgets is the leak. */
const PARTNER_STRIP = ['customer', 'phone', 'customer_id', 'customerId', 'price'];

function emitEvent(d, { kind, refType, refId, audience, args = {} }) {
  const a = { ...args };
  if (audience === 'yalla') for (const k of PARTNER_STRIP) delete a[k];
  d.prepare(
    `INSERT INTO partner_events (at, kind, ref_type, ref_id, audience, args_json)
     VALUES (?,?,?,?,?,?)`
  ).run(nowIso(), kind, refType, String(refId), audience, JSON.stringify(a));
}

/* Pieces on a job — summed from the lines for a kit, stored for a bulk run. */
function jobQty(d, row) {
  return row.kind === 'kit'
    ? d.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM print_job_lines WHERE job_id = ?').get(row.id).n
    : row.qty;
}

/* What an event about a job carries. The customer's side of it is stripped
   again by emitEvent for the partner; for the shop's own chat it is left
   out here on purpose — a shared staff group is wider than customer.read. */
function jobBrief(d, row) {
  return {
    id: row.id, design: row.design, kind: row.kind, qty: jobQty(d, row),
    priority: row.priority, deadline: row.deadline, stage: row.stage
  };
}

/* --------------------------------------------------------------- reading */

/* One read for the whole portal. Both sides draw every screen from the same
   payload, so a partial fetch cannot leave the board and the finance page
   disagreeing about the same job. */
export function all({ includeArchived = false } = {}) {
  const d = DB.get();
  const live = includeArchived ? '' : 'WHERE archived = 0';

  const jobs = d.prepare('SELECT * FROM print_jobs ORDER BY created_at DESC').all();
  const lines = d.prepare('SELECT * FROM print_job_lines ORDER BY id').all();
  const stages = d.prepare('SELECT * FROM print_job_stages ORDER BY at').all();
  const invoices = d.prepare('SELECT * FROM partner_invoices ORDER BY issued DESC').all();
  const refs = d.prepare('SELECT * FROM partner_invoice_refs').all();
  const payments = d.prepare('SELECT * FROM partner_invoice_payments ORDER BY at').all();
  const messages = d.prepare('SELECT * FROM job_messages ORDER BY at').all();

  const byJob = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.job_id)) m.set(r.job_id, []);
      m.get(r.job_id).push(r);
    }
    return m;
  };
  const lineMap = byJob(lines);
  const stageMap = byJob(stages);

  return {
    jobs: jobs.map((j) => shapeJob(j, lineMap.get(j.id) || [], stageMap.get(j.id) || [])),
    invoices: invoices.map((v) => ({
      ...v,
      refs: refs.filter((r) => r.invoice_id === v.id).map((r) => r.job_id),
      payments: payments.filter((p) => p.invoice_id === v.id)
    })),
    messages,
    /* What the shop said about each finished job. Yalla Wear sees these —
       they are about their work — so the route passes them to both sides. */
    reviews: d.prepare('SELECT * FROM job_reviews ORDER BY at DESC').all(),
    clubs: d.prepare('SELECT * FROM clubs WHERE archived = 0 ORDER BY name').all(),
    suppliers: suppliers({ includeArchived }),
    employees: employees({ includeArchived }),
    waMessages: d.prepare('SELECT * FROM wa_messages ORDER BY at DESC LIMIT 200').all()
  };
}

/* The shape the screens already draw. Derived values are computed here rather
   than stored, so they cannot go stale. */
function shapeJob(j, lines, history) {
  const kit = j.kind === 'kit';
  return {
    ...j,
    qty: kit ? lines.reduce((a, l) => a + l.qty, 0) : j.qty,
    cost: kit ? lines.reduce((a, l) => a + l.qty * l.unit_cost, 0) : j.cost,
    lines: kit ? lines : null,
    history,
    tbc: lines.filter((l) => !l.print_name).length
  };
}

/* Their own readers, so /api/suppliers and /api/employees share one query
   with the bundle rather than growing a second copy that drifts. */
export function suppliers({ includeArchived = false } = {}) {
  return DB.get().prepare(
    `SELECT * FROM suppliers ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name`
  ).all();
}

export function employees({ includeArchived = false } = {}) {
  return DB.get().prepare(
    `SELECT * FROM employees ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name`
  ).all();
}

export function job(id) {
  const d = DB.get();
  const row = d.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
  if (!row) return null;
  return shapeJob(
    row,
    d.prepare('SELECT * FROM print_job_lines WHERE job_id = ? ORDER BY id').all(id),
    d.prepare('SELECT * FROM print_job_stages WHERE job_id = ? ORDER BY at').all(id)
  );
}

/* How many shirts on this job still have no name. */
function tbcCount(d, jobId) {
  return d.prepare(
    'SELECT COUNT(*) AS n FROM print_job_lines WHERE job_id = ? AND print_name IS NULL'
  ).get(jobId).n;
}

/* ------------------------------------------------------------- job number
   Derived from the highest that exists rather than a stored counter. A
   counter can fall behind its own data — the label sequence did exactly that
   after a restore wrote rows in underneath it — and then hands out a number
   somebody is already using. MAX cannot drift. */
export function nextJobId(d = DB.get()) {
  const top = d.prepare(
    `SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) AS m
       FROM print_jobs WHERE id GLOB 'P-[0-9]*'`
  ).get().m;
  return 'P-' + ((top || 1029) + 1);
}

/* --------------------------------------------------------------- writing */

export function create({
  customer, phone, design, kind = 'bulk', qty = 0, priority = 'normal',
  deadline, price = 0, cost = null, currency = 'SYP', saleId = null,
  /* Stage E. The free-text `customer` stays — it is what was written on the
     job at the time, and a job for somebody not on the customer list still
     has to say who it is for. customerId is the LINK, and it is only ever
     set by a caller that actually knows, never matched on a name. */
  customerId = null,
  /* Where it came from: the till, a person on the Print screen, or one day
     the website. `autoSend` places the order in the same transaction when
     every shirt already has a name — the till used to create the job and
     then fire a second request at an id it had guessed, racing its own
     create. One request, one answer: the returned job says whether it went. */
  source = 'manual', autoSend = false,
  lines = [], userId = null
}) {
  if (!customer) throw Object.assign(new Error('customer is required'), { code: 'bad_request' });
  if (!design) throw Object.assign(new Error('design is required'), { code: 'bad_request' });
  if (kind === 'kit' && !lines.length) {
    throw Object.assign(new Error('a kit job needs at least one line'), { code: 'bad_request' });
  }
  if (!['till', 'manual', 'web'].includes(source)) source = 'manual';

  return DB.tx(() => {
    const d = DB.get();
    const id = nextJobId(d);
    const at = nowIso();

    d.prepare(
      `INSERT INTO print_jobs
         (id, customer, phone, design, kind, priority, stage, qty, currency,
          price, cost, deadline, sale_id, customer_id, source, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,'design',?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, customer, phone ?? null, design, kind, priority,
          kind === 'kit' ? 0 : qty, currency, price, cost, deadline ?? null,
          saleId, customerId ?? null, source, at, at, userId);

    const ins = d.prepare(
      `INSERT INTO print_job_lines (job_id, club_code, print_name, number, size, qty, unit_cost)
       VALUES (?,?,?,?,?,?,?)`
    );
    for (const l of lines) {
      ins.run(id, l.clubCode ?? null, l.printName || null, l.number ?? null,
              l.size ?? null, l.qty || 1, l.unitCost || 0);
    }

    d.prepare(
      'INSERT INTO print_job_stages (job_id, stage, at, by_side, user_id) VALUES (?,?,?,?,?)'
    ).run(id, 'design', at, 'og', userId);

    /* A blank name keeps it a draft — the same rule sendOrder enforces at
       the door — and the caller reads order_state off the answer. */
    if (autoSend && tbcCount(d, id) === 0) {
      placeOrder(d, d.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id), userId);
    }

    DB.logChange('print_jobs', id, 'insert', userId, null);
    return job(id);
  });
}

/* Returns the job. Refuses with a reason rather than a boolean, because
   "false" told the browser nothing it could show a person. */
export function setStage(id, stage, side, userId = null) {
  const to = STAGES.indexOf(stage);
  if (to < 0) throw Object.assign(new Error(`no such stage: ${stage}`), { code: 'bad_stage' });

  return DB.tx(() => {
    const d = DB.get();
    const row = d.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('no such job'), { code: 'not_found' });
    if (row.stage === stage) return job(id);

    if (to > STAGES.indexOf('sent') && tbcCount(d, id) > 0) {
      throw Object.assign(
        new Error('some shirts still have no name on them'), { code: 'names_missing' });
    }
    /* At or PAST 'sent', not just exactly 'sent'. Checking only the one stage
       left the gate open to anything that stepped over it: design straight to
       printing skipped the acceptance entirely, and a board where you can
       drag a card two columns is not an unusual way to do that. */
    if (to >= STAGES.indexOf('sent') && row.order_state !== 'accepted') {
      throw Object.assign(
        new Error('the printer has not accepted this order yet'), { code: 'not_accepted' });
    }

    const at = nowIso();
    /* Going back drops the stamps for everything at or beyond where we land,
       so the history never claims a step happened after the one that undid
       it. */
    d.prepare(
      `DELETE FROM print_job_stages WHERE job_id = ? AND stage IN (${
        STAGES.slice(to).map(() => '?').join(',')})`
    ).run(id, ...STAGES.slice(to));
    d.prepare(
      'INSERT INTO print_job_stages (job_id, stage, at, by_side, user_id) VALUES (?,?,?,?,?)'
    ).run(id, stage, at, side ?? null, userId);
    d.prepare('UPDATE print_jobs SET stage = ?, updated_at = ? WHERE id = ?').run(stage, at, id);

    const qty = jobQty(d, row);
    if (side && STAGE_MESSAGE[stage]) {
      insertMessage(d, {
        jobId: id, from: side, kind: STAGE_MESSAGE[stage],
        body: `${STAGE_LABEL[stage]} — ${id} · ${qty} pcs`, userId
      });
    }
    /* Whichever side moved it, the other one hears. */
    emitEvent(d, {
      kind: 'stage', refType: 'job', refId: id, audience: other(side || 'og'),
      args: { ...jobBrief(d, row), stage, qty, by: side || 'og' }
    });

    DB.logChange('print_jobs', id, 'update', userId, null);
    return job(id);
  });
}

/* ---- the order envelope ------------------------------------------------- */

/* The order itself, inside somebody else's transaction — create() places one
   on the way out and DB.tx() refuses to nest. Posts the shop's copy of the
   message and queues the partner's notification, so an order placed from the
   till and one placed by hand leave the same trail. */
function placeOrder(d, row, userId = null) {
  const id = row.id;
  if (row.order_state === 'pending') {
    throw Object.assign(new Error('already sent'), { code: 'already_sent' });
  }
  if (row.order_state === 'accepted') {
    throw Object.assign(new Error('already accepted'), { code: 'already_accepted' });
  }
  /* A shirt with no name cannot be printed, so an order carrying one cannot
     honestly be placed. The stage gate says the same further down the line;
     said here it stops the bad order at the door. */
  if (tbcCount(d, id) > 0) {
    throw Object.assign(
      new Error('some shirts still have no name on them'), { code: 'names_missing' });
  }

  const at = nowIso();
  d.prepare(
    `UPDATE print_jobs SET order_state = 'pending', order_sent_at = ?, updated_at = ?
      WHERE id = ?`
  ).run(at, at, id);

  const qty = jobQty(d, row);
  insertMessage(d, {
    jobId: id, from: 'og', kind: 'order',
    body: `Order sent — ${id} · ${qty} pcs`, userId
  });
  emitEvent(d, {
    kind: 'order_new', refType: 'job', refId: id, audience: 'yalla',
    args: { ...jobBrief(d, row), qty }
  });
}

export function sendOrder(id, userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const row = d.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('no such job'), { code: 'not_found' });
    placeOrder(d, row, userId);
    DB.logChange('print_jobs', id, 'update', userId, null);
    return job(id);
  });
}

export function respondToOrder(id, accept, { promisedAt = null, note = null, userId = null } = {}) {
  return DB.tx(() => {
    const d = DB.get();
    const row = d.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('no such job'), { code: 'not_found' });
    if (row.order_state !== 'pending') {
      throw Object.assign(new Error('no order is waiting on a reply'), { code: 'not_pending' });
    }

    const at = nowIso();
    d.prepare(
      `UPDATE print_jobs
          SET order_state = ?, order_responded_at = ?, order_promised_at = ?,
              order_note = ?, updated_at = ?
        WHERE id = ?`
    ).run(accept ? 'accepted' : 'declined', at, accept ? promisedAt : null, note, at, id);

    /* Accepting IS handing the job over, so the stage moves here rather than
       in a second call from the browser. Two round trips could leave the
       order accepted and the job still sitting in Design if the second one
       failed, and 'sent' is precisely the stage that means "the printer took
       it" — the same fact the acceptance just recorded.

       Declining leaves the stage alone on purpose: it was never handed over,
       so nothing about where it sits should suggest that it was. */
    if (accept && row.stage === 'design') {
      d.prepare('UPDATE print_jobs SET stage = ? WHERE id = ?').run('sent', id);
      d.prepare(
        'INSERT INTO print_job_stages (job_id, stage, at, by_side, user_id) VALUES (?,?,?,?,?)'
      ).run(id, 'sent', at, 'yalla', userId);
    }

    insertMessage(d, {
      jobId: id, from: 'yalla', kind: accept ? 'accepted' : 'declined',
      body: note || (accept ? `Order accepted — ${id}` : `Order declined — ${id}`),
      userId
    });
    emitEvent(d, {
      kind: accept ? 'order_accepted' : 'order_declined', refType: 'job', refId: id, audience: 'og',
      args: { ...jobBrief(d, row), promisedAt: accept ? promisedAt : null, note }
    });

    DB.logChange('print_jobs', id, 'update', userId, null);
    return job(id);
  });
}

/* Fill in the names and numbers on a kit sheet.

   An order is taken before the squad is settled, so a line starts with no
   name and the shop rings round to collect them. That is the single most
   common edit anyone makes to a job, and until this existed it was the one
   edit that could not be saved: the browser wrote the names onto its own
   copy, the next reload replaced the copy, and every shirt went back to TBC.

   Only the two fields worth changing. Quantity, size and cost are what was
   ordered and agreed; changing those is a different act than writing a name
   on a shirt, and letting one form do both is how a price gets edited by
   somebody correcting a spelling. */
export function setLines(id, lines = [], userId = null, side = 'og') {
  return DB.tx(() => {
    const d = DB.get();
    const jobRow = d.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
    if (!jobRow) throw Object.assign(new Error('no such job'), { code: 'not_found' });
    const tbcBefore = tbcCount(d, id);

    const own = d.prepare('SELECT id FROM print_job_lines WHERE job_id = ?').all(id)
      .map((r) => r.id);
    const set = d.prepare(
      'UPDATE print_job_lines SET print_name = ?, number = ? WHERE id = ? AND job_id = ?'
    );

    let changed = 0;
    for (const l of lines) {
      const lineId = Number(l.id);
      /* A line id from another job would let one customer's sheet be edited
         through another's. Checked rather than trusted. */
      if (!own.includes(lineId)) continue;
      const name = l.printName == null || l.printName === ''
        ? null : String(l.printName).toUpperCase().trim() || null;
      const number = l.number == null || l.number === '' ? null : Number(l.number);
      changed += set.run(name, number, lineId, id).changes;
    }

    if (changed) {
      d.prepare('UPDATE print_jobs SET updated_at = ? WHERE id = ?').run(nowIso(), id);
      /* The last blank name filled in is the moment the printer has been
         waiting for — the one edit that unblocks the press. Said out loud,
         once, when the count reaches zero, not on every keystroke before it. */
      if (tbcBefore > 0 && tbcCount(d, id) === 0) {
        insertMessage(d, {
          jobId: id, from: side, kind: 'names-ready',
          body: `All names in — ${id}`, userId
        });
        emitEvent(d, {
          kind: 'names_ready', refType: 'job', refId: id, audience: other(side),
          args: jobBrief(d, jobRow)
        });
      }
      /* Logged against the JOB, not the lines: the lines have no cursor of
         their own and reach Supabase on the job's afterUpsert hook. */
      DB.logChange('print_jobs', id, 'update', userId, null);
    }
    return job(id);
  });
}

/* ---- the message line --------------------------------------------------- */

function insertMessage(d, { jobId = null, invoiceId = null, from, kind, reason = null, body, userId = null }) {
  /* A sender has by definition already read their own message. */
  const info = d.prepare(
    `INSERT INTO job_messages
       (job_id, invoice_id, from_side, kind, reason, body, at, read_og, read_yl, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(jobId, invoiceId, from, kind, reason, body, nowIso(),
        from === 'og' ? 1 : 0, from === 'yalla' ? 1 : 0, userId);

  /* Logged HERE, not at the call sites. job_messages is cursor-shape and no
     parent carries it — print_jobs has no afterUpsert for messages the way
     sales has for its items — so an unlogged message is one the mirror never
     sees. Of the three callers only postMessage used to log, which meant every
     automatic notification (a stage moving, an order accepted or declined) was
     invisible to Supabase for good. One log inside the insert cannot be missed
     by a fourth caller added later. */
  DB.logChange('job_messages', info.lastInsertRowid, 'insert', userId, null);

  return info.lastInsertRowid;
}

export function postMessage({ jobId = null, invoiceId = null, from, kind = 'note', reason = null, text, userId = null }) {
  if (!text || !String(text).trim()) {
    throw Object.assign(new Error('a message needs some text'), { code: 'bad_request' });
  }
  if (!!jobId === !!invoiceId) {
    throw Object.assign(
      new Error('a message belongs to a job or an invoice, not both'), { code: 'bad_request' });
  }
  if (from !== 'og' && from !== 'yalla') {
    throw Object.assign(new Error('from must be og or yalla'), { code: 'bad_request' });
  }

  return DB.tx(() => {
    const d = DB.get();
    const body = String(text).trim();
    const id = insertMessage(d, { jobId, invoiceId, from, kind, reason, body, userId });
    emitEvent(d, {
      kind: 'message', refType: jobId ? 'job' : 'invoice', refId: jobId || invoiceId,
      audience: other(from),
      args: { id: jobId, invoiceId, kind, reason, text: body.slice(0, 200) }
    });
    return d.prepare('SELECT * FROM job_messages WHERE id = ?').get(id);
  });
}

/* Reading a thread on one side must never clear the other side's badge. */
export function markRead({ side, jobId = null, invoiceId = null, userId = null }) {
  if (side !== 'og' && side !== 'yalla') {
    throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  }
  const col = side === 'og' ? 'read_og' : 'read_yl';
  return DB.tx(() => {
    const d = DB.get();
    const where = jobId ? 'job_id = ?' : invoiceId ? 'invoice_id = ?' : null;
    if (!where) throw Object.assign(new Error('nothing named'), { code: 'bad_request' });

    /* Which rows are about to change, before changing them. The mirror is
       keyed on a message id, so logging the JOB id here would have written a
       change entry pointing at a message that does not exist — the sync
       would look it up, find nothing, and quietly skip the read flags
       forever. A thread is a handful of messages; naming each is cheap. */
    const ids = d.prepare(`SELECT id FROM job_messages WHERE ${where} AND ${col} = 0`)
      .all(jobId || invoiceId).map((r) => r.id);
    if (!ids.length) return { marked: 0 };

    d.prepare(`UPDATE job_messages SET ${col} = 1 WHERE id IN (${ids.map(() => '?').join(',')})`)
      .run(...ids);
    for (const id of ids) DB.logChange('job_messages', id, 'update', userId, null);
    return { marked: ids.length };
  });
}

/* ---- invoices ----------------------------------------------------------- */

export function createInvoice({ id, issued, due, note = null, currency = 'SYP', jobIds = [], userId = null }) {
  if (!id) throw Object.assign(new Error('an invoice needs a number'), { code: 'bad_request' });
  if (!jobIds.length) {
    throw Object.assign(new Error('an invoice needs at least one job'), { code: 'bad_request' });
  }
  return DB.tx(() => {
    const d = DB.get();
    const at = nowIso();
    d.prepare(
      `INSERT INTO partner_invoices (id, issued, due, note, currency, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    ).run(id, issued || at, due, note, currency, at, at);

    const ins = d.prepare('INSERT INTO partner_invoice_refs (invoice_id, job_id) VALUES (?,?)');
    for (const j of jobIds) ins.run(id, j);

    /* The bill lands in the shop's thread and on its phone. The total is
       what the printer charges for the jobs named — the browser used to post
       its own copy of this line, and a copy that lives in one browser is one
       the shop's other machines never see. */
    const total = invoiceTotal(d, id);
    insertMessage(d, {
      invoiceId: id, from: 'yalla', kind: 'invoice',
      body: `Invoice ${id} — ${total} ${currency}`, userId
    });
    emitEvent(d, {
      kind: 'invoice_new', refType: 'invoice', refId: id, audience: 'og',
      args: { invoiceId: id, total, currency, due, jobs: jobIds.length }
    });

    DB.logChange('partner_invoices', id, 'insert', userId, null);
    return invoice(id);
  });
}

/* What the printer charges for everything on an invoice — kit lines summed,
   bulk cost as agreed. Derived, never stored, like a kit job's own cost. */
function invoiceTotal(d, invoiceId) {
  return d.prepare(
    `SELECT COALESCE(SUM(
       CASE WHEN j.kind = 'kit'
            THEN (SELECT COALESCE(SUM(l.qty * l.unit_cost), 0) FROM print_job_lines l WHERE l.job_id = j.id)
            ELSE COALESCE(j.cost, 0) END), 0) AS total
       FROM partner_invoice_refs r JOIN print_jobs j ON j.id = r.job_id
      WHERE r.invoice_id = ?`
  ).get(invoiceId).total;
}

/* A PAYMENT IS A HANDSHAKE. One side records that money moved; the other
   confirms it arrived. Only confirmed money counts against the invoice —
   until then the row is "waiting", visible to both. Either side may record:
   the shop when it hands over cash, the printer when cash reaches it.

   Money in is the one direction that cannot be corrected by doing it again,
   so this carries an opId through applied_ops like a debt payment does — a
   manager taps Pay, the wifi stalls, they tap again, and the printer must not
   be told twice that they were paid. */
export function recordPayment({ invoiceId, amount, method, at = null, side = 'og', userId = null, opId = null }) {
  if (!(amount > 0)) {
    throw Object.assign(new Error('a payment has to be more than nothing'), { code: 'bad_request' });
  }
  if (side !== 'og' && side !== 'yalla') {
    throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  }
  return DB.tx(() => {
    const d = DB.get();
    if (opId) {
      const seen = d.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
      if (seen) return JSON.parse(seen.result);
    }
    const inv = d.prepare('SELECT * FROM partner_invoices WHERE id = ?').get(invoiceId);
    if (!inv) throw Object.assign(new Error('no such invoice'), { code: 'not_found' });

    const amt = Math.round(amount);
    const when = at || nowIso();
    const info = d.prepare(
      `INSERT INTO partner_invoice_payments (invoice_id, at, amount, method, user_id, recorded_by_side)
       VALUES (?,?,?,?,?,?)`
    ).run(invoiceId, when, amt, method || 'cash', userId, side);
    d.prepare('UPDATE partner_invoices SET updated_at = ? WHERE id = ?').run(nowIso(), invoiceId);

    insertMessage(d, {
      invoiceId, from: side, kind: 'payment',
      body: `Payment recorded — ${amt} ${inv.currency} · ${invoiceId}`, userId
    });
    emitEvent(d, {
      kind: 'payment_recorded', refType: 'invoice', refId: invoiceId, audience: other(side),
      args: { invoiceId, paymentId: info.lastInsertRowid, amount: amt, currency: inv.currency,
              method: method || 'cash', by: side }
    });

    DB.logChange('partner_invoices', invoiceId, 'update', userId, null);
    const out = invoice(invoiceId);
    if (opId) {
      d.prepare('INSERT INTO applied_ops (op_id, at, user_id, kind, result) VALUES (?,?,?,?,?)')
        .run(opId, nowIso(), userId, 'partner_payment', JSON.stringify(out));
    }
    return out;
  });
}

/* The other half of the handshake. The side that recorded a payment cannot
   also confirm it — that would be one company vouching for both ends of a
   transfer — so the route derives `side` from the account and this refuses
   its own. Confirming twice is a no-op, not an error: two people on the same
   side pressing the same button is not a dispute. */
export function confirmPayment({ invoiceId, paymentId, side, userId = null }) {
  if (side !== 'og' && side !== 'yalla') {
    throw Object.assign(new Error('side must be og or yalla'), { code: 'bad_request' });
  }
  return DB.tx(() => {
    const d = DB.get();
    const inv = d.prepare('SELECT * FROM partner_invoices WHERE id = ?').get(invoiceId);
    if (!inv) throw Object.assign(new Error('no such invoice'), { code: 'not_found' });
    const p = d.prepare(
      'SELECT * FROM partner_invoice_payments WHERE id = ? AND invoice_id = ?'
    ).get(Number(paymentId), invoiceId);
    if (!p) throw Object.assign(new Error('no such payment'), { code: 'not_found' });
    if (p.confirmed_at) return invoice(invoiceId);
    if (p.recorded_by_side === side) {
      throw Object.assign(
        new Error('the side that recorded a payment cannot confirm it'), { code: 'own_side' });
    }

    const at = nowIso();
    d.prepare(
      'UPDATE partner_invoice_payments SET confirmed_at = ?, confirmed_by = ? WHERE id = ?'
    ).run(at, userId, p.id);
    d.prepare('UPDATE partner_invoices SET updated_at = ? WHERE id = ?').run(at, invoiceId);

    insertMessage(d, {
      invoiceId, from: side, kind: 'payment-confirmed',
      body: `Payment confirmed — ${p.amount} ${inv.currency} · ${invoiceId}`, userId
    });
    emitEvent(d, {
      kind: 'payment_confirmed', refType: 'invoice', refId: invoiceId, audience: other(side),
      args: { invoiceId, paymentId: p.id, amount: p.amount, currency: inv.currency, by: side }
    });

    DB.logChange('partner_invoices', invoiceId, 'update', userId, null);
    return invoice(invoiceId);
  });
}

export function invoice(id) {
  const d = DB.get();
  const row = d.prepare('SELECT * FROM partner_invoices WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    refs: d.prepare('SELECT job_id FROM partner_invoice_refs WHERE invoice_id = ?')
      .all(id).map((r) => r.job_id),
    payments: d.prepare('SELECT * FROM partner_invoice_payments WHERE invoice_id = ? ORDER BY at')
      .all(id)
  };
}

/* ---- what was sent out -------------------------------------------------- */

export function logWhatsApp({ phone, body, kind = null, refType = null, refId = null, userId = null }) {
  const d = DB.get();
  d.prepare(
    'INSERT INTO wa_messages (at, phone, body, kind, ref_type, ref_id, user_id) VALUES (?,?,?,?,?,?,?)'
  ).run(nowIso(), phone, body, kind, refType, refId, userId);
}

/* ---- the two shop-side lists -------------------------------------------- */

export function saveSupplier(fields, userId = null) { return upsert('suppliers', fields, userId); }
export function saveEmployee(fields, userId = null) { return upsert('employees', fields, userId); }

const WRITABLE = {
  suppliers: ['name', 'contact', 'category', 'currency', 'outstanding',
              'total_purchased', 'due_date', 'last_payment', 'archived'],
  employees: ['user_id', 'name', 'role', 'currency', 'salary', 'next_payment',
              'since', 'phone', 'archived']
};

function upsert(table, fields, userId) {
  const cols = WRITABLE[table].filter((c) => c in fields);
  if (!cols.length) throw Object.assign(new Error('nothing to save'), { code: 'bad_request' });

  return DB.tx(() => {
    const d = DB.get();
    const at = nowIso();

    if (fields.id) {
      d.prepare(
        `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
      ).run(...cols.map((c) => fields[c]), at, fields.id);
      DB.logChange(table, fields.id, 'update', userId, null);
      return d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(fields.id);
    }

    const info = d.prepare(
      `INSERT INTO ${table} (${cols.join(',')}, created_at, updated_at)
       VALUES (${cols.map(() => '?').join(',')}, ?, ?)`
    ).run(...cols.map((c) => fields[c]), at, at);
    DB.logChange(table, info.lastInsertRowid, 'insert', userId, null);
    return d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
  });
}

/* Print jobs a customer_id actually proves. Never a name match: in Aleppo
   the same person is written in Arabic on Tuesday and in Latin on Thursday,
   and a confident wrong answer here attaches somebody else's order to a
   profile. A job with no customer_id simply does not appear. */
export function jobsForCustomer(customerId, limit = 50) {
  const n = Math.max(1, Math.min(200, Math.floor(Number(limit)) || 50));
  return DB.get().prepare(
    `SELECT id, design, kind, stage, priority, qty, deadline, order_state,
            created_at, updated_at
       FROM print_jobs
      WHERE customer_id = ?
      ORDER BY created_at DESC
      LIMIT ?`
  ).all(customerId, n);
}

/* Linking an old job to a customer BY HAND.

   Migration 032 deliberately backfilled only where a sale_id proved it and
   left everything else null — for a person to link. This is the route that
   person needs; without it the migration was an instruction to nobody.

   Setting it to null is allowed and is not an accident: somebody who links
   the wrong person has to be able to say so. */
export function setJobCustomer(id, customerId, userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const j = d.prepare("SELECT id FROM print_jobs WHERE id = ?").get(id);
    if (!j) throw Object.assign(new Error("no such job"), { code: "not_found" });
    if (customerId !== null) {
      const c = d.prepare("SELECT id FROM customers WHERE id = ?").get(customerId);
      if (!c) throw Object.assign(new Error("no such customer"), { code: "not_found" });
    }
    d.prepare("UPDATE print_jobs SET customer_id = ?, updated_at = ? WHERE id = ?")
     .run(customerId, nowIso(), id);
    DB.logChange("print_jobs", id, "update", userId, "customer linked by hand");
    return job(id);
  });
}

/* ---- what the shop thought of the work ---------------------------------- */

/* One review per job, written by the shop once the shirts are in hand. A job
   that is not done has nothing to review yet, so that is refused rather than
   stored early and read as a verdict on work that has not happened. Editable:
   a second look at the print after the customer complained is exactly the
   moment the rating should be allowed to change. */
export function reviewJob(id, { rating, feedback = null, userId = null } = {}) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    throw Object.assign(new Error('a rating is 1 to 5'), { code: 'bad_request' });
  }
  return DB.tx(() => {
    const d = DB.get();
    const row = d.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('no such job'), { code: 'not_found' });
    if (row.stage !== 'done') {
      throw Object.assign(new Error('the job is not finished yet'), { code: 'not_done' });
    }

    const text = feedback == null ? null : (String(feedback).trim() || null);
    const at = nowIso();
    const existing = d.prepare('SELECT job_id FROM job_reviews WHERE job_id = ?').get(id);
    d.prepare(
      `INSERT INTO job_reviews (job_id, rating, feedback, user_id, at, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(job_id) DO UPDATE SET
         rating = excluded.rating, feedback = excluded.feedback,
         user_id = excluded.user_id, updated_at = excluded.updated_at`
    ).run(id, r, text, userId, at, at);
    DB.logChange('job_reviews', id, existing ? 'update' : 'insert', userId, null);

    const stars = '★'.repeat(r) + '☆'.repeat(5 - r);
    insertMessage(d, {
      jobId: id, from: 'og', kind: 'review',
      body: stars + (text ? ' — ' + text : ''), userId
    });
    emitEvent(d, {
      kind: 'review', refType: 'job', refId: id, audience: 'yalla',
      args: { ...jobBrief(d, row), rating: r, feedback: text ? text.slice(0, 200) : null }
    });
    return job(id);
  });
}

export function review(id) {
  return DB.get().prepare('SELECT * FROM job_reviews WHERE job_id = ?').get(id) || null;
}

/* ---- the production report ------------------------------------------------
   How many shirts came off the press, by day and by month, computed here in
   SQL over every finished job rather than summed in the browser from
   whatever it happened to be holding — the same reason the dashboard moved.
   The day belongs to the caller: the server is UTC and Aleppo is not, so the
   browser sends its offset in minutes and every date is cut in that zone.

   `money` decides whether the payout column is included — the partner's own
   earnings are theirs to see; a member of staff without cost.read gets the
   piece counts and nothing priced. */
export function stats(tzMinutes = 0, { money = true } = {}) {
  const d = DB.get();
  const tz = Number.isInteger(tzMinutes) && Math.abs(tzMinutes) <= 840 ? tzMinutes : 0;
  const mod = (tz >= 0 ? '+' : '-') + Math.abs(tz) + ' minutes';

  const PIECES = `CASE WHEN j.kind = 'kit'
      THEN (SELECT COALESCE(SUM(l.qty), 0) FROM print_job_lines l WHERE l.job_id = j.id)
      ELSE j.qty END`;
  const COST = `CASE WHEN j.kind = 'kit'
      THEN (SELECT COALESCE(SUM(l.qty * l.unit_cost), 0) FROM print_job_lines l WHERE l.job_id = j.id)
      ELSE COALESCE(j.cost, 0) END`;
  const DONE = `FROM print_job_stages s
                JOIN print_jobs j ON j.id = s.job_id AND j.stage = 'done'
               WHERE s.stage = 'done'`;

  /* Local midnight 29 days back and the first of the month 11 months back,
     both as UTC instants, so the SQL compares text against text. */
  const localNow = new Date(Date.now() + tz * 60000);
  const y = localNow.getUTCFullYear(), m = localNow.getUTCMonth(), day = localNow.getUTCDate();
  const dayFrom = new Date(Date.UTC(y, m, day - 29) - tz * 60000).toISOString();
  const monthFrom = new Date(Date.UTC(y, m - 11, 1) - tz * 60000).toISOString();
  const todayKey = localNow.toISOString().slice(0, 10);
  const monthKey = todayKey.slice(0, 7);

  const perDay = d.prepare(
    `SELECT SUBSTR(datetime(s.at, ?), 1, 10) AS day, COUNT(*) AS jobs, SUM(${PIECES}) AS pieces
       ${DONE} AND s.at >= ?
      GROUP BY day ORDER BY day`
  ).all(mod, dayFrom);

  const perMonth = d.prepare(
    `SELECT SUBSTR(datetime(s.at, ?), 1, 7) AS month, COUNT(*) AS jobs,
            SUM(${PIECES}) AS pieces, SUM(${COST}) AS payout
       ${DONE} AND s.at >= ?
      GROUP BY month ORDER BY month`
  ).all(mod, monthFrom);

  const totals = d.prepare(
    `SELECT COUNT(*) AS jobs, COALESCE(SUM(${PIECES}), 0) AS pieces,
            SUM(CASE WHEN COALESCE(j.order_promised_at, j.deadline) IS NULL
                       OR SUBSTR(s.at, 1, 10) <= SUBSTR(COALESCE(j.order_promised_at, j.deadline), 1, 10)
                     THEN 1 ELSE 0 END) AS on_time,
            AVG(julianday(s.at) - julianday(
              (SELECT MIN(t.at) FROM print_job_stages t WHERE t.job_id = j.id AND t.stage = 'sent')
            )) AS turnaround
       ${DONE}`
  ).get();

  const open = d.prepare(
    `SELECT COUNT(*) AS jobs, COALESCE(SUM(${PIECES}), 0) AS pieces
       FROM print_jobs j WHERE j.stage <> 'done' AND j.order_state = 'accepted'`
  ).get();

  const rated = d.prepare('SELECT AVG(rating) AS avg, COUNT(*) AS n FROM job_reviews').get();

  const today = perDay.find((r) => r.day === todayKey) || { jobs: 0, pieces: 0 };
  const month = perMonth.find((r) => r.month === monthKey) || { jobs: 0, pieces: 0, payout: 0 };

  const out = {
    tz, todayKey, monthKey,
    perDay: perDay.map((r) => ({ day: r.day, jobs: r.jobs, pieces: r.pieces })),
    perMonth: perMonth.map((r) => ({ month: r.month, jobs: r.jobs, pieces: r.pieces, payout: r.payout })),
    today: { jobs: today.jobs, pieces: today.pieces },
    month: { jobs: month.jobs, pieces: month.pieces, payout: month.payout || 0 },
    open: { jobs: open.jobs, pieces: open.pieces },
    jobsDone: totals.jobs, piecesDone: totals.pieces,
    onTimePct: totals.jobs ? Math.round((totals.on_time / totals.jobs) * 100) : null,
    avgTurnaroundDays: totals.turnaround == null ? null : Math.round(totals.turnaround * 10) / 10,
    avgRating: rated.n ? Math.round(rated.avg * 10) / 10 : null,
    reviews: rated.n
  };
  if (!money) {
    delete out.month.payout;
    out.perMonth.forEach((r) => { delete r.payout; });
  }
  return out;
}

/* ---- the pulse --------------------------------------------------------------
   The small answer a browser asks for every half minute: has anything moved
   since I last looked? Two counts and a stamp, scoped to the side asking, so
   the poll costs nothing like the bundle it decides whether to refetch. */
export function pulse(side) {
  const d = DB.get();
  const col = side === 'yalla' ? 'read_yl' : 'read_og';
  const msgs = d.prepare(
    `SELECT COUNT(*) AS unread FROM job_messages WHERE ${col} = 0`
  ).get();
  const lastMsg = d.prepare('SELECT MAX(id) AS id FROM job_messages').get().id || 0;
  const jobs = d.prepare(
    `SELECT MAX(updated_at) AS mx, SUM(CASE WHEN order_state = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM print_jobs`
  ).get();
  const inv = d.prepare('SELECT MAX(updated_at) AS mx FROM partner_invoices').get();
  return {
    unread: msgs.unread, pending: jobs.pending || 0, lastMessageId: lastMsg,
    stamp: [jobs.mx || '', inv.mx || '', lastMsg].join('|')
  };
}
