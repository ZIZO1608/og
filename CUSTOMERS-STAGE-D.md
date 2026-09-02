# CUSTOMERS-STAGE-D.md — loyalty

Stage D: the loyalty module, derived stamp cards, the full-card state and its bell alert, and the
points questions Stage C left open. Plus the two small items asked for before this stage.

**76 checks pass** — 41 server-side, 35 browser-side. `CACHE` is **`og-system-v89`**.
Stage E has not been started.

**Preconditions.** The working tree was **not** clean at the start: it carried the Stage C
follow-ups (nine files, uncommitted, my own — reported and approved before this stage). `:8090` was
not running, so no shop server was serving during any of this. Migrations **030** and **031** are
applied to the live database through the server's own `DB.open()`; it now reads 31 migrations,
customers 2, sales 13, redemptions 0, and `loyalty.mode` still `points`.

**Verified** the same way as C: a throwaway copy via `node:sqlite`'s online `backup()`, `createApp()`
on 8099 with `OG_SYNC_MINUTES=0`, real HTTP with real cookies, and headless Chrome 152 against the
repo's real `js/`.

---

## The two items asked for first

**`sales_customer` is dropped** — migration **030**. `001_init.sql` created
`sales_customer (customer_id)`; Stage C's `sales_customer_at (customer_id, at)` is a strict superset,
because SQLite walks the same b-tree and ignores the trailing column. So the old index answered no
question the new one cannot and was paid for on every INSERT into the shop's hottest table. The
migration's comment records the asymmetry that could invite the same move wrongly later: `sales_at`
**cannot** be dropped in favour of the composite, because `at` is not its leading column.

```
PASS 030. the redundant sales_customer index is gone
PASS 030. …and the composite that replaced it is still there
```

**The Customers screen is out of the delivery role's navigation** — one rule in `navAllowed()`,
beside the existing one that hides the deliveries board from a driver:

```js
if (id === 'customers' && roleOf() === 'delivery') return false;
```

A per-role nav rule, not a permission change, exactly as asked: `customer.read` is what makes
`GET /api/customers` answer him at all, and the server scopes that response to his own run. Take the
permission away and his board loses the names and addresses with it.

```
PASS NAV: the customers screen is out of a driver's navigation
PASS NAV: …his own home is untouched
PASS NAV: …and the old driver rule still holds
   driver still receives 0 customer row(s) for his board — the permission is untouched
```

Tested against the **real** `navAllowed` pulled out of `js/app-shell.js`, not a copy.

---

## D1. The module, and the fold that finally saves

`server/lib/loyalty.js` is new. `rules()` reads every `loyalty.*` key fresh on each call — not
cached, because these change from Settings and a cached copy keeps a shop stamping to a rule the
owner has already changed.

**`loyalty.*` is open in `CONFIG_WRITABLE`**, and only now. It stayed shut for two stages for a
stated reason: the loyalty fold wrote to `CONFIG` in memory and nothing else, so opening the keys
first would have let *half* a change persist. The fold saves now, so the keys opened with it.

Every control in the fold goes through one shared debounced writer, `saveConfig(key, value, label,
wait)` in `js/app-changes.js` — **keyed per config key**, because a single shared timer would let two
fields edited in the same breath cancel each other. Selects pass `wait = 0`; number inputs get 600ms,
so "180" typed as 1, 18, 180 is one round trip.

```
PASS D1. loyalty.* is writable through PUT /api/config  → 200
PASS D1. …and it is still there on a re-read  → {"per1000":"7","block":"400"}
PASS D1. a cashier cannot change the loyalty rules  → 403
PASS D1: one shared debounced config writer
PASS D1: the loyalty fold SAVES — it wrote to memory only for two stages  → 9
```

The fold also gained the **mode selector**, so the shop can run stamps alone and turn points on later
with no deploy, and it only draws the controls the current mode actually uses.

## D2. Stamps are derived — and the first derivation was wrong

The count is **everything ever earned, minus everything ever cashed in**:

```sql
SUM(sale_items.qty) over non-voided sales   −   SUM(loyalty_redemptions.stamps_used)
```

**I wrote it as "items since the last redemption" first, and the verification caught it.** That
version cannot express carry-over at all: redeeming stamps a timestamp on the record, so every
earlier purchase falls outside the window and the count drops to zero. Worse, it was *silently*
inconsistent — `redeem()` returned `have − used` arithmetically (4) while `cardFor()` immediately
afterwards derived 0 from the same data. Two answers to one question, one of them on screen.

Subtracting `stamps_used` says the same thing directly and depends on no timestamps at all, so a
backdated sale or two redemptions in the same second cannot corrupt it.

```
PASS D2. required 10, per item, any amount
PASS D2. 3+3+3+3+2 = 14 stamps  → 14
PASS D2. the card is full
PASS D2. one reward owed (14 ÷ 10), not two  → 1
PASS D2. ten stamps used  → 10
PASS D2. the rule is frozen onto the row  → 10
PASS D2. FOUR carry over (14 − 10), nobody loses a stamp  → 4
PASS D2. six to go on the new card
PASS D2. the same opId replays the original — no second redemption  → 1
PASS D2. exactly one redemption row exists
```

**The worked example asked for**, and then the void:

| | |
|---|---|
| Five sales, 3 + 3 + 3 + 3 + 2 items | **14 stamps**, card full, 1 reward owed |
| Redeem at ten, note "a free pair" | `stamps_used` 10, `required_then` 10 |
| After | **4 carried over**, 6 to go |
| Void the 2-item sale | **4 → 2** |

```
PASS D2. voiding a 2-item sale takes 2 stamps back, with no second write  → 4 → 2
```

That is the whole argument for deriving it: `Sales.voidSale` contains **no stamp code at all**. It
sets `voided = 1`, and the count follows because it was never a stored number.

## D3. A full card is a state, not an automatic reward

Nothing fires at ten. The card reaches "full — reward owed" and the button appears; the person at the
counter records what was actually handed over, in free text. No zero-priced line fights the 10%
discount cap, and nobody banks ten cheap items into a 450,000 pair.

**The rule is frozen onto the row**, the same reasoning as `sales.fx_rate`:

```
PASS D3. changing the rule to 8 does NOT rewrite last month's redemption  → 10
PASS D3. …while new cards use the new rule  → 8
```

**The bell**, keyed on what the alert is about:

```
[ { "key": "stamps:83", "icon": "★", "tone": "amber", "view": "customers",
    "text": "Stage D Card has a full card — 12 of 10" } ]

PASS D3. a full card raises a bell alert  → 1
PASS D3. keyed on WHAT it is about, not on its text  → "stamps:83"
PASS D3. it points at the customers screen
PASS D3. a driver is never told who is owed a reward
```

The Customers screen's **full-card filter** reads those keys rather than counting anything:
`DB.fullCardIds()` parses `stamps:<id>` out of the notifications the server already computed. A
second implementation in the browser would be a second answer to the same question, computed from the
200 sales that machine happens to hold.

On screen, drawn as the paper it is — ten boxes, filled ones lit:

```
   card reads: ★★★★★★★★★★Card full — reward owed · 12 / 10
   toast: Card cashed in · 10 stamps · 2 carried over
   after redeeming: ★★3456789108 more to go · 2 / 10
                    Cashed in before 2 Sep 2026 · 10 of 10 stamps · a free pair · Stage D Manager
```

```
PASS D2: one box per stamp the rule asks for  → 10
PASS D2: the earned ones are filled in  → 10 of 10
PASS D3: the redeem button appears exactly when the card is full  → full=true button=true
PASS D3: it asks WHAT was given rather than deciding for the shop
PASS D3: what was actually handed over is recorded and shown back
PASS D3: the redemption is its own row in the timeline, not a note on a sale
```

Redeeming carries an **`opId` through `applied_ops`**, the count is recomputed **inside** the
transaction rather than trusted from the browser, and the refusals carry their numbers in the body:

```
PASS D3. redeeming is refused when the shop does not run stamps  → "stamps_off"
PASS D3. refused, and the real count is in the body  → 2
PASS D3. a driver cannot read a stamp card (404, not 403)  → 404
```

## D4. Points

**Voiding a sale now reverses its points**, inside the void's own transaction: take back what it
earned, give back what it spent.

```
PASS D4. earned points clawed back, spent points given back  → 1000 → 1050
   (earned 250, used 300 → 1000 − 250 + 300)
PASS D4. a clawback bigger than the balance clamps at 0, it does not go negative
PASS D4. loyalty.void_reverses_points=0 leaves them alone
```

**Clamped rather than refused**, deliberately: a customer may have spent the points on a later sale,
and a void that could fail because of what happened afterwards would leave the shop unable to correct
a mistake at all — while the goods are back on the shelf either way. It is a **config key** because
it is a policy a shop could reasonably disagree with; it defaults to on.

**The 500-point block is config** (`loyalty.redeem_block`), read through `DB.redeemBlock()`. It was a
literal in three places in `js/pos.js` while the point value beside it was already config.

```
PASS D4: the block is config, default 500  → 500
PASS D4: …and moves when the shop changes it  → 250
PASS D4: no literal 500 left in the POS redeem path
```

**The timeline gained two kinds** — a stamp redemption row (its own kind, because no sale caused it)
and the points rows Stage C already added. Adding a kind is one mapper in `timelineRows`, which is
what that shape was built for.

## The four modes, on screen

Each mode changes what every screen draws, independently:

```
   mode=points tierOnCard=true  stampPanel=false pointsOn=true  stampsOn=false
   mode=stamps tierOnCard=false stampPanel=true  pointsOn=false stampsOn=true
   mode=both   tierOnCard=true  stampPanel=true  pointsOn=true  stampsOn=true
   mode=off    tierOnCard=false stampPanel=false pointsOn=false stampsOn=false
```

Server-side, the same matrix over the bell and the history payload:

```
   mode=points stampAlerts=0 redemptionsInHistory=0
   mode=stamps stampAlerts=1 redemptionsInHistory=0
   mode=both   stampAlerts=1 redemptionsInHistory=0
   mode=off    stampAlerts=0 redemptionsInHistory=0
```

**The shop is on `points` today**, so all of this is groundwork that is switched off — and the code
says so honestly rather than half-working: reading a count is always allowed (it is arithmetic over
sales), but redeeming is refused with `stamps_off`.

```
PASS D1. with mode=points, redeeming is refused — stamps are groundwork until switched on
PASS D1. …but the count is still readable, because it is only arithmetic over sales
```

## I18N

`I18N.en` and `I18N.ar` are equal at **1,349 keys**, no drift.

While adding this stage's strings I wrote a sweep over every `t('key')` in `js/` and found **nine
keys that were used but never defined** — each rendering its own key name (`by`, `messages`,
`currency`, `warehouse`, `undo`…) inside an Arabic RTL layout, which is precisely what the en/ar
discipline exists to prevent. Three were in files this stage touched; six were not. All nine are
fixed. **Every `t()` key in `js/` now resolves**, and the sweep is worth re-running each stage:

```js
// for every js/*.js, every t('...') must exist in I18N.en
```

## §10 — what this prompt got wrong, and what the code does not settle

**Where the prompt's design had to change:**

1. **"A customer's stamp count is the number of qualifying items bought since their last
   redemption."** Implemented literally, this is wrong — see D2. "Since the last redemption" and
   "carry the spare stamps over", both stated in the same section, cannot both be true, because
   redeeming *is* the boundary. Total-minus-used satisfies both and is simpler.
2. **"`opId` through `applied_ops`, as every money-adjacent write in this codebase does."** Right,
   and it exposed something: `applied_ops` has no unique constraint per *kind*, so an opId reused
   across two different operations would replay the wrong result. Every caller generates a prefixed
   random id (`redeem-<cid>-<ts>-<rand>`), so it cannot collide in practice — but nothing enforces it.
3. **The bell emits one row per person with a full card.** At six customers that is right; at sixty
   it floods the bell and buries the stock warnings. There is no cap, and there should be one before
   the shop has real volume — probably "five, then a summary row".

**What the code does not settle:**

- **`loyalty_redemptions` is not in the Supabase mirror.** It is a new table, so `supabase-sync.js`
  does not know it, and `CLAUDE.md`'s rule stands: a new table that needs mirroring needs a hand-run
  schema file in the dashboard **and** a named entry in the sync. Until then, redemptions live only
  on this machine — and unlike a derived count, a redemption row is not recoverable from anything
  else. **This is the one thing in Stage D I would fix before switching stamps on.**
- **`stamps_used` can exceed what a customer had**, if a manager passes an explicit `stamps` larger
  than the rule — the check is against what they *have*, not against the rule, which is deliberate
  (honouring a short card) but means a redemption can consume a whole future card's worth.
- **Nothing tells a customer their stamp count on paper.** The receipt prints a points balance; the
  card is only on screen. If the shop runs stamps, the receipt is where a customer would look.
- **`min_minor` is tested against the sale total, not the line.** Stated in the code, but it means a
  30,000-lira minimum lets a customer add a pair of socks to a shoe and earn two stamps.
- **The mode selector can be set to `off` while people hold full cards.** Nothing warns; the alerts
  and panels simply vanish. The redemptions survive, so turning it back on restores everything — but
  a warning would be kinder than silence.
