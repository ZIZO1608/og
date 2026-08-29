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
const STAGE_MESSAGE = { printing: 'in-print', delivery: 'shipped', done: 'shipped' };

const nowIso = () => new Date().toISOString();

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
  lines = [], userId = null
}) {
  if (!customer) throw Object.assign(new Error('customer is required'), { code: 'bad_request' });
  if (!design) throw Object.assign(new Error('design is required'), { code: 'bad_request' });
  if (kind === 'kit' && !lines.length) {
    throw Object.assign(new Error('a kit job needs at least one line'), { code: 'bad_request' });
  }

  return DB.tx(() => {
    const d = DB.get();
    const id = nextJobId(d);
    const at = nowIso();

    d.prepare(
      `INSERT INTO print_jobs
         (id, customer, phone, design, kind, priority, stage, qty, currency,
          price, cost, deadline, sale_id, created_at, updated_at, created_by)
       VALUES (?,?,?,?,?,?,'design',?,?,?,?,?,?,?,?,?)`
    ).run(id, customer, phone ?? null, design, kind, priority,
          kind === 'kit' ? 0 : qty, currency, price, cost, deadline ?? null,
          saleId, at, at, userId);

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

    if (side && STAGE_MESSAGE[stage]) {
      const qty = row.kind === 'kit'
        ? d.prepare('SELECT COALESCE(SUM(qty),0) AS n FROM print_job_lines WHERE job_id = ?').get(id).n
        : row.qty;
      insertMessage(d, {
        jobId: id, from: side, kind: STAGE_MESSAGE[stage],
        body: `${STAGE_LABEL[stage]} — ${id} · ${qty} pcs`, userId
      });
    }

    DB.logChange('print_jobs', id, 'update', userId, null);
    return job(id);
  });
}

/* ---- the order envelope ------------------------------------------------- */

export function sendOrder(id, userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const row = d.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
    if (!row) throw Object.assign(new Error('no such job'), { code: 'not_found' });
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
export function setLines(id, lines = [], userId = null) {
  return DB.tx(() => {
    const d = DB.get();
    const jobRow = d.prepare('SELECT id FROM print_jobs WHERE id = ?').get(id);
    if (!jobRow) throw Object.assign(new Error('no such job'), { code: 'not_found' });

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
    const id = insertMessage(d, { jobId, invoiceId, from, kind, reason, body: String(text).trim(), userId });
    DB.logChange('job_messages', id, 'insert', userId, null);
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

    DB.logChange('partner_invoices', id, 'insert', userId, null);
    return invoice(id);
  });
}

export function recordPayment({ invoiceId, amount, method, at = null, userId = null }) {
  if (!(amount > 0)) {
    throw Object.assign(new Error('a payment has to be more than nothing'), { code: 'bad_request' });
  }
  return DB.tx(() => {
    const d = DB.get();
    const inv = d.prepare('SELECT id FROM partner_invoices WHERE id = ?').get(invoiceId);
    if (!inv) throw Object.assign(new Error('no such invoice'), { code: 'not_found' });

    d.prepare(
      'INSERT INTO partner_invoice_payments (invoice_id, at, amount, method, user_id) VALUES (?,?,?,?,?)'
    ).run(invoiceId, at || nowIso(), amount, method, userId);
    d.prepare('UPDATE partner_invoices SET updated_at = ? WHERE id = ?').run(nowIso(), invoiceId);

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
