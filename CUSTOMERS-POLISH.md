# CUSTOMERS-POLISH.md — the finish pass, and what I would build next

A polish pass over the customers tab, done by **rendering it and looking at it** rather than by
re-reading my own code. Nine defects found, all fixed, all visible in the screenshots. Then a list
of what I would build next, with what each is worth.

`CACHE` **`og-system-v94`**. I18N equal at **1,414 keys**, every `t()` key resolves. Stage G's suite
re-run after the changes: **26/26, no failures**. Live database untouched (34 migrations,
customers 2, sales 13).

---

## What was actually wrong

Every one of these was invisible in the code and obvious in a screenshot.

### 1. Phone numbers broke mid-number

`+963 955 990 111` wrapped after the third group and finished `111` on its own line. It reads as two
numbers, and a half-read phone number is the one thing that field exists to get right.

**The cause was not the phone.** The card's top row was `avatar | name/phone/city | tier badge`, and
between the badge and the bulk tick box the text column had about 110px of a 272px card. My first
attempt — `nowrap` + ellipsis — made it worse: `+963 955 99…` cannot be dialled at all.

**The fix was to move the tier badge down to the chip row**, which is where it belonged anyway: tier
and sizes are both labels *about* a person, where the top row is *who they are*. The top row now has
the full card width, and the ellipsis rule stays only as a last resort for a genuinely enormous
number.

### 2. `Aleppo · In-store` wrapped to `Aleppo · In-` / `store`

Same cause, fixed by the same change.

### 3. A customer with no city rendered `· In-store`

A separator with nothing on one side reads as a field that failed to load, not one nobody filled in.
Fixed on the card **and** in the drawer head, which had the same line.

### 4. Initials were lower-case

`coda Tools2` produced **`cT`** in the avatar circle, which looks like a rendering fault. Now
uppercased — and because Arabic has no case, this only ever touches Latin names.

### 5. Cards in a row had different heights

A card with size chips was taller than one without; one with a debt chip taller again. A row of them
read as a broken grid. The stats now sit on the bottom of every card (`margin-top:auto` — the card
was already a column flex).

### 6. The timeline rendered every single row

**This is the cap family again, in the screen I wrote the rule for.** A customer with 230 invoices
drew **204 timeline rows in one go** — a wall nobody scrolls, and a lot of DOM for a question the
first dozen rows already answer.

Now capped at 40 with a **Show 164 older events** button. It is a *render* cap, not a fetch: the rows
are already in memory, so the button redraws. 40 rather than the grid's 60 because a timeline row is
two lines tall where a card is a tile.

```
timeline <li> rendered: 40
show-more button: Show 164 older events
event count badge: 204+ events
```

### 7. The want rows led with a bare `?`

`Asked for Test Shoe · 42` was prefixed with `?`, which reads as a glyph that failed to render.
Replaced with `•`, and all the timeline leads now share a fixed-width `.tl-lead` so a column of them
lines up instead of shuffling the dates beside them.

### 8. The count badge said `4 / 3` in Arabic

The worst of the nine, because it was **wrong rather than ugly**: unisolated, the RTL layout
reordered the whole run, so the badge claimed the shop had three customers while showing four. Now
`<bdi dir="ltr">`, same trap the Settings folds were written around.

### 9. Dead state

`OG.tlAll` was written in two places and read in none. Removed.

---

## What I would build next

Ordered by what it is worth against what it costs. Nothing here is started.

### Worth doing before the shop grows

**1. A lint for the cap family.** I have now made this mistake — or found it — five times: lira
added to dollars, select-all past the render cap, the bell's cut summary, the seven readers fixed
last round, and the timeline above. The pattern is mechanical enough to catch mechanically: *any
file that reads `DB.sales` and calls `.reduce`, or badges `.length` of a windowed array, must also
call `cappedNote`*. Same shape as the permission-name sweep that already runs at boot. **This is the
one I would do first** — it stops a class of bug rather than an instance.

**2. Wire `loyalty_redemptions` and `wants` into the mirror for real.** The schema file and the sync
entries exist and are tested against the local schema, but `server/supabase/010_loyalty_and_wants.sql`
has never been run in the dashboard. Until it is, those two tables live only on this machine — and a
redemption row is recoverable from nothing. It needs someone with the Supabase login and five
minutes.

**3. A customer's own page for the shop to hand over.** The profile is internal. A read-only public
page at `/c/<token>` — same shape as the existing `/i/` receipt token — showing their points, stamp
card and what they are waiting for, would replace "how many stamps do I have?" phone calls entirely.
The token machinery already exists.

### Worth doing when somebody asks

**4. A wants filter: "only what has landed."** The wants tab already highlights a row green when the
size is back in stock, but at forty rows you scan for green. One chip — *Arrived (3)* — turns the
screen from a list into a to-do. Small, and it is the exact moment the screen is opened.

**5. Merge suggestions.** The merge picker opens on likely duplicates *of the customer you are
looking at*. Nothing surfaces "these two records are probably one person" without somebody already
suspecting it. A nightly pass over `foldName` + `normPhone` collisions, shown as a bell alert, would
find them. Mixed-script names guarantee duplicates and nobody goes looking.

**6. A note history instead of one note field.** `customers.note` is a single overwritable string, so
the last person to edit it silently erases what the previous one wrote. Dated append-only notes are
one small table, and the customer timeline already knows how to draw a new row kind.

**7. WhatsApp templates for the shop's real moments.** The winback message exists. "Your size is in",
"your card is full", and "you owe X" are three messages the shop sends by hand today, and every one
of them already has a screen that knows exactly who and what.

### Worth thinking about, not obviously right

**8. A per-customer "do not contact" flag.** The wants list and the quiet list both produce reasons to
message somebody, and there is no way to say *this person does not want that*. It is one column and
two checks — but it is also a promise the shop has to keep, so it needs the owner's decision first.

**9. Merging more than two records.** The merge is strictly pairwise. Three spellings of one name is
two merges, which works but reads as a chore.

**10. The credit limit in two currencies.** Flagged in the Stage F report and still true: the limit is
USD and compared correctly at each sale's frozen rate, but a shop that thinks in lira has to convert
in their head to set it.

---

## What I did not touch, and why

- **`customers.note` visibility.** You decided it stays readable by anyone with `customer.read`, and
  the edit form says so on its face. Unchanged.
- **`sales.customer_name` frozen on old invoices.** Decided, implemented, and the documents now read
  the frozen column. Unchanged.
- **The card layout for the loyalty card.** Still held on the ruler test — I need the printed sheet
  measured before that layout is worth writing. That is the one outstanding thing I cannot do from
  here.
