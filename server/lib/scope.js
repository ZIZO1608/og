/* ==========================================================================
   OG SYSTEM — what ONE request is allowed to say about itself    [scope.js]
   --------------------------------------------------------------------------
   Selling offline (online first, phase 3) needs three facts to reach the
   middle of a sale that the route in front of it knows nothing about:

     at           the real time of a sale made offline, replayed later. The
                  sale, its stock movements, its money move and its applied
                  op are all dated then, not at the moment the line came back
                  (nowIso() in lib/db.js reads it).
     lentInvoice  the invoice number the laptop printed, which the replayed
                  sale must keep (lib/sales.js nextInvoiceId checks it was
                  really lent to this holder).
     holder       which laptop is replaying, or — on the laptop itself, while
                  offline — which laptop's lent numbers to sell on.
     allowShort   a replayed sale stands even when the main server has fewer
                  pairs than the laptop thought (the owner's rule): stock
                  stops at 0 and the difference is its own movement.
     shiftId      the drawer the till saw.

   AsyncLocalStorage, from Node itself: the scope follows the request through
   its awaits and belongs to nobody else. A request from the browser never has
   one — only the pipeline sets it, for a replay (the copy key) or for the
   laptop's own offline sale — so a visitor can never name his own invoice
   number, time or shift.

   A scope is CLOSED the moment its request is finished (`done`). A timer the
   request started (a debounced push, a Telegram kick) still inherits the
   store, and without this it would go on dating things in the past.
   ========================================================================== */
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

/* Run `fn` inside `scope`, then close the scope whatever happens. */
export async function run(scope, fn) {
  const s = { ...scope, done: false };
  try {
    return await store.run(s, fn);
  } finally {
    s.done = true;
  }
}

export function current() {
  const s = store.getStore();
  return s && !s.done ? s : null;
}

/* Run `fn` with no scope at all — for work that must not inherit one (the
   commit listeners, which schedule the mirror's push). */
export function exit(fn) {
  return store.exit(fn);
}
