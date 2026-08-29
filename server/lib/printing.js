/* ==========================================================================
   OG SYSTEM — the 80mm thermal receipt: data + the print job itself
   --------------------------------------------------------------------------
   Two things live here, kept together because they share the "print" name
   but do very different jobs:

     data(saleId)   assembles everything js/receipt.js needs to DRAW the
                     receipt, in one call — a half-loaded receipt prints
                     anyway, so the frontend must never have to make four
                     requests and hope they land in order.

     send(...)      takes the bytes the browser already rendered and packed
                     and puts them on the wire to the printer, logging the
                     attempt either way.

   This is not server/lib/receipt.js — that module renders the PUBLIC page a
   stranger reaches by scanning the QR on their paper receipt, server-side,
   with no login and no cost data anywhere near it. This module is the
   opposite audience: a signed-in till fetching everything (short of cost)
   to paint 576 dots of canvas and mail it to a printer on the LAN.
   ========================================================================== */

import { get, nowIso } from './db.js';
import * as Printer from './printer.js';

/* ------------------------------------------------------------------ data */

function configBlock() {
  const rows = get().prepare(
    `SELECT key, value FROM config WHERE key LIKE 'shop.%' OR key LIKE 'receipt.%'`
  ).all();
  const shop = {}, receipt = {};
  for (const r of rows) {
    if (r.key.startsWith('shop.')) shop[r.key.slice(5)] = r.value;
    else receipt[r.key.slice(8)] = r.value;
  }
  return { shop, receipt };
}

/* Everything js/receipt.js needs to draw the slip, minus anything cost- or
   margin-related — the route still runs the result through scrubCost as a
   second layer, but the query itself never selects unit_cost/cost_price so
   there is nothing to forget to strip. */
export function data(saleId) {
  const sale = get().prepare(
    `SELECT s.id, s.at, s.customer_id, s.customer_name, s.wh_id, s.payment,
            s.currency, s.subtotal, s.discount, s.total, s.fx_rate, s.fx_base,
            s.voided, s.points_used, s.points_earned, s.txn_ref,
            u.name AS cashier_name
       FROM sales s LEFT JOIN users u ON u.id = s.cashier_id
      WHERE s.id = ?`
  ).get(saleId);
  if (!sale) return null;

  sale.items = get().prepare(
    `SELECT sku, name, size, qty, unit_price FROM sale_items
      WHERE sale_id = ? ORDER BY id`
  ).all(saleId);

  /* Walk-in: the whole customer block is omitted client-side, not sent as a
     row of nulls — a receipt with an empty "Customer:" line reads as a bug,
     not as "no customer". */
  sale.customer = sale.customer_id
    ? get().prepare(
        'SELECT name, phone, loyalty_points FROM customers WHERE id = ?'
      ).get(sale.customer_id)
    : null;

  /* A COD delivery's amount to collect is what the driver and the customer
     argue about, so it rides along whenever this sale has one. */
  sale.delivery = get().prepare(
    `SELECT status, to_collect, collected FROM deliveries WHERE sale_id = ?`
  ).get(saleId) || null;

  Object.assign(sale, configBlock());
  return sale;
}

/* ------------------------------------------------------------------- send */

/* Printing bytes that are already fully rendered, so this module knows
   nothing about ESC/POS, Arabic shaping, or canvases — that all happened in
   the browser. Its only jobs are: send it, log it, and never let a printer
   problem look like a problem with the sale. */
export function send({ saleId, userId, bytes, copies, opId }) {
  if (opId) {
    const seen = get().prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(opId);
    if (seen) return { ...JSON.parse(seen.result), replayed: true };
  }

  const cfg = get().prepare(
    `SELECT key, value FROM config WHERE key IN
       ('receipt.printer_host', 'receipt.printer_port', 'receipt.transport', 'receipt.printer_share')`
  ).all();
  const at = (k) => cfg.find(r => r.key === k)?.value;
  const transport = at('receipt.transport') || 'tcp';

  /* USB: a printer plugged into this same machine, no network interface —
     reached with a raw `copy /b` to a Generic/Text-Only printer share (see
     server/lib/printer.js's header). TCP stays the default so an existing
     network-connected receipt printer keeps working with no config change
     at all. */
  const sendPromise = transport === 'usb'
    ? Printer.sendUsb(bytes, { printerShare: at('receipt.printer_share') || '' })
    : Printer.send(bytes, { host: at('receipt.printer_host') || '', port: Number(at('receipt.printer_port')) || 9100 });

  return sendPromise.then(
    () => {
      logAttempt({ saleId, userId, copies, status: 'sent', error: null });
      const result = { ok: true };
      /* Recorded on success only. A failed attempt must stay retryable under
         the same opId — recording it here would make a retry replay the
         failure forever instead of trying the printer again. */
      if (opId) {
        get().prepare(
          `INSERT INTO applied_ops (op_id, at, user_id, kind, result)
           VALUES (?, ?, ?, 'print', ?)`
        ).run(opId, nowIso(), userId ?? null, JSON.stringify(result));
      }
      return result;
    },
    (err) => {
      logAttempt({ saleId, userId, copies, status: 'failed', error: err.message });
      throw err;
    }
  );
}

function logAttempt({ saleId, userId, copies, status, error }) {
  get().prepare(
    `INSERT INTO print_log (sale_id, user_id, copies, status, error, at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(saleId, userId ?? null, copies || 1, status, error ?? null, nowIso());
}

export function log(saleId, limit = 20) {
  return get().prepare(
    `SELECT id, user_id, copies, status, error, at FROM print_log
      WHERE sale_id = ? ORDER BY at DESC LIMIT ?`
  ).all(saleId, limit);
}
