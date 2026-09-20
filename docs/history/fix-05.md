# Fix 05 — the morning report

Branch `fix-05`, off `fix-04`. Eight commits, one per part. Nothing pushed, nothing merged.
Sandbox only (`OG_ENV_FILE=server/.env.sandbox OG_DATA_DIR=server/data-sandbox OG_PORT=8190`).
**No migration, no schema change, no `server/supabase/` file, no `mirror-lag.js` entry, and no
server permission weakened.** `server/.env` and `server/data/og.db` were never opened.

---

## 1. What you have to do by hand

**Nothing.**

There is no migration, no configuration and no command. Open the shop and it is there.

One thing is worth knowing rather than doing: **the app now updates itself.** When new files reach
a machine that already has the shop open, the tab says "OG System was updated · reloading to the
new version" and reloads itself once — never while somebody is mid-sale. That is the answer to the
half of your report that was not a bug, and it means you will not have to tell anybody to press
anything after a deploy again.

---

## 2. Why the buttons did nothing for you, and why 1131 checks said otherwise

There were **two** causes, and only one of them was the cache. That is why it looked like one big
mysterious fault.

### The job tiles carried no listener at all

`js/home.js` drew every tile as:

```html
<button class="hm-job" data-hm="go" data-id="money">
```

and registered its handler as `ACTIONS['hm-go']`. **`ACTIONS` is the table behind `data-act`.**
Nothing in this app has ever listened for a `data-hm` attribute — there is no such dispatcher, and
`app-boot.js`'s one listener reads `closest('[data-act]')`.

So every tile, on every role's home, did nothing when pressed. Not slowly, not sometimes: nothing.
For the whole of night shift 03.

Measured before the fix, with a real mouse on the middle of each tile, as the owner:

```
  tile money       (Money)        : dashboard -> dashboard   DID NOTHING
  tile deliveries  (Deliveries)   : dashboard -> dashboard   DID NOTHING
  tile products    (Products)     : dashboard -> dashboard   DID NOTHING
  tile reports     (Reports)      : dashboard -> dashboard   DID NOTHING
  tile staff       (The people)   : dashboard -> dashboard   DID NOTHING
  tile order       (Take an order): dashboard -> dashboard   DID NOTHING
```

and after:

```
  tile money       : dashboard -> money        ok
  tile deliveries  : dashboard -> deliveries   ok
  tile products    : dashboard -> products     ok
  tile reports     : dashboard -> reports      ok
  tile staff       : dashboard -> settings     ok
  tile order       : dashboard -> desk         ok
```

**Why 53 checks went green over it.** `ns03/p1-home` measured the tiles: that they exist, that
there are four to six, that each is at least 88px tall, that the first one hit-tests to itself. It
never pressed one. A measured button and a working button are different claims, and only one of
them was being made.

It also read the list of tiles with `document.querySelectorAll('[data-hm="go"]')` — the attribute
the tiles CARRIED — so the loop that checked "every button is a job this account really holds" was
walking a list of dead buttons and saying they were fine.

### And a browser could be running two builds at once

`sw.js` called `self.skipWaiting()` on install. A new worker therefore took over a page that had
already parsed the OLD files, and served it the NEW ones for anything fetched later — a lazily
injected Chart.js, three.js, an icon, a font. New markup, old handlers, and no reload to settle
it. The same symptom with none of the cause, and it is what the Safeers half of your report was:
**every control on that screen was pressed one at a time with a real pointer and all of them
work, and did before this branch.**

Both are closed:

- `js/home.js` uses `data-act="hm-go"`, which is the table its handler is in.
- `sw.js` no longer calls `skipWaiting` on install. The new worker **waits**; `js/update.js`
  notices it, waits until nobody is mid-sale, toasts, and reloads the tab **once**. One page, one
  build, from the first byte to the reload.
- `fix05/p0-namespaces` reads the source in about a second and reports **any** button in the app
  wired to a namespace nothing dispatches on, and any registered handler no markup can reach. It
  is verified to go red on the tile exactly as it was written.
- Every new suite presses the middle of what is PAINTED, with `Input.dispatchMouseEvent` and
  `Input.dispatchTouchEvent`, and refuses a point that belongs to something else.

### Which build am I looking at

`GET /api/health` carries `build: { branch, started }` — **only to a signed-in caller**; a stranger
on the wifi gets nothing — and Settings draws a quiet line at the bottom for the **developer role
only**: `og-system-v280 · fix-05`. The cache name is read back out of the worker itself over a
MessageChannel, so it is what is actually being served rather than what anybody thinks is.

---

## 3. Every bug: what it looked like, what it was, what was done

| # | What it looked like | What it actually was | What was done |
|---|---|---|---|
| 1 | Every job tile on every role's home did nothing | `data-hm="go"` on the button, handler in `ACTIONS` (the `data-act` table); no `data-hm` dispatcher exists | `data-act="hm-go"`, plus a source-level check for the general shape |
| 2 | A screen could show new markup with old behaviour | `sw.js` called `skipWaiting()` on install, so one page could hold two builds | the worker waits; `js/update.js` reloads the tab once, never mid-sale |
| 3 | Six tiles came out five across and one alone underneath | `repeat(auto-fit, minmax(210px,1fr))` fills the row and leaves the remainder | the count is written as `data-n` and the columns are chosen from it (3×2, 3+2, 2×2; two across on a phone) |
| 4 | A press on a tile showed almost nothing | one pixel of travel, and a finger has no hover | lime edge, a tint, no grey tap flash, and a real `:focus-visible` ring for Tab |
| 5 | Tab reached a tile and Enter did nothing **in the harness** | `keyDown` alone delivers the event and NO default action, so no click is synthesised | the harness sends rawKeyDown → char → keyUp. **The app was never broken here** — the check was |
| 6 | A popup about a shelf stayed on screen over the next page | `.sm-peek` is appended to `<body>`; `render()` only rewrites `#view` | `js/layers.js`: one list of every floating layer, one cleanup on every route change, Escape, outside press and the back gesture |
| 7 | A card menu came back open after leaving and returning | the open one is module state (rightly — the page repaints on every push) and nothing cleared it | each closer takes the state with the node |
| 8 | `go()` with a dialog open landed on the screen BEHIND | closing the dialog ran `history.back()` on the back-gesture marker, undoing the navigation that asked for the cleanup | the marker is dropped before anything closes; and it is never popped unless the top of the stack is really ours |
| 9 | The money screen walked itself backwards after a save | a dialog replacing a dialog unmarked and remarked in one beat, and `history.back()` is async — the pop removed the NEW marker | marks and unmarks are coalesced |
| 10 | Two rows of small buttons over the figures they act on | seven controls of three different weights | the jobs are the same tiles as the job home, one grid, one lime primary |
| 11 | "What happened today" meant reading six columns of minor units | the cash book is an audit trail, not an answer | a "Today" card: five to ten plain sentences |
| 12 | A 120000 in a box, and no idea what had been typed | no grouping, no symbol | grouped as you type with the caret held, the currency symbol inside the field |
| 13 | "12,50" could have become 1,250 | a formatter that regroups what somebody typed changes the meaning of a figure mid-write | the grouping stops dead the moment a separator is typed, and starts again if it is deleted |
| 14 | A save looked exactly like a save that had not been pressed | no busy state at all | spinner, disabled, in the button's own width; one click out of two presses; `opId` behind it |
| 15 | After a transfer the only change was one number among a dozen | nothing said where | the card whose figure moved lights up once |
| 16 | A dialog's Save was behind the phone keyboard | a `position: fixed` element is fixed to the LAYOUT viewport, which the keyboard does not change | `visualViewport` → `--vvh` / `--kb`; the sheet stands on the keyboard |
| 17 | Phone dialogs sat in the middle of the screen | three callers passed `sheet:`, about forty did not | `openModal` decides: a phone gets a sheet, with a grab handle and a pull-down |
| 18 | Every field in the shop was 13.5px | under 16px an iPhone zooms the page in on focus | 16px and 44px tall on a phone, with `inputmode` and `enterkeyhint` derived from the field |
| 19 | The bell, sync, presence and avatar were 34–38px | never measured under a thumb | 44px, and three more: the Records fold head, the board's Lanes/List, Settings' fold chevron |
| 20 | The shell was always a little too tall on a phone | `100vh` is the viewport with the toolbars HIDDEN | `100dvh` — **on phone widths only**; on a desk it re-aliased the till and fix 04's golden caught it |
| 21 | "-500" in a money box moved five hundred | the minus was stripped with the punctuation | a leading minus is now the same answer as an empty box: nothing |
| 22 | "0.005" in dollars read as **five dollars** | the three-digits rule made 005 a thousands group behind a bare zero | a thousands group cannot follow a zero |
| 23 | Arabic words came apart into their letters | −0.07px on body text and −0.98px on every heading, app-wide | zero letter-spacing under `body.rtl`, said once, with Latin runs exempt |
| 24 | A heading and its paragraph could be two Arabic faces | two font stacks — `body.rtl` names Tahoma, `--font-head` names system-ui | `body.rtl` redefines both tokens |
| 25 | Figures walked to the wrong end of an Arabic sentence | a digit run beside Arabic is reordered unless isolated | `unicode-bidi: isolate` on the figure slots, and `statBox` isolates a bare figure |
| 26 | `ns03/p5` reported "there is no parcel to test with" | it SPENT its own fixture: 5d sends a waiting parcel out on every run and nothing sends one back | `fix05/fixtures.mjs` makes them through the shop's own routes |
| 27 | Every screen read as "264px under the bar" in landscape | the sweep read the floor off a `display:none` tab bar, whose rectangle is all zeros | a hidden bar is not a bar |
| 28 | Fix 04's desktop golden went red with nothing changed | an md5 cannot tell a rule that moved something from the harness browser rasterising a shade differently | `comparePng` asks whether anything MOVED; the golden was retaken under this harness |
| 29 | Two full passes went red on four suites each — and a DIFFERENT four | the console-artefact filter was kept in 39 copies and they had all drifted | one list, `quietErrors(T, extra)` in `cdp.mjs`, used by all 34 run suites |
| 30 | A third pass went red on 23 checks across eleven suites | **this laptop's wifi dropped mid-run**: 21 of the 23 were `ERR_INTERNET_DISCONNECTED` fetching a product photograph from the public Supabase bucket, and the other two were the same outage slowing a save past its wait | the filter drops a NETWORK failure reaching that bucket and nothing else — a 404 or a 403 from it is a row pointing at a picture that is not there and stays red, as does a dead line to the shop's own server. Measured both ways before it was kept |

---

## 4. The devil pass: what broke, and what held

**Broke — and is fixed:**

1. `-500` in a money box read as **+500**, and `-4` as a quantity of **4**. A slipped finger moved
   money the way the figure plainly said it should not. Now: nothing, and the dialog refuses it.
2. `0.005` in dollars read as **$5.00**. Now: nothing.
3. `ns03/p2-digits` **asserted the first of those** ("a minus is not a quantity", expecting 4). A
   suite that asserts a bug protects it; it says the opposite now, with the reason written in.

**Held, under everything that was thrown at it:**

- Twenty-seven readings of the two parsers: Arabic and Persian keypads, `٬` and `٫`, a no-break
  space (which is what a phone inserts), spaces inside and around, letters before and after
  digits, an emoji, a pasted line break, an empty box, 999,999,999,999.
- Rubbish typed into a real dialog with a real keyboard writes nothing at all and leaves the
  dialog open.
- A 300-character name carrying an emoji, Arabic and English at once: stored as sent, and it does
  not push the products list sideways at 390 or at 1280.
- Three presses on Save make one move. The same `opId` sent twice by hand is one move.
- Leaving the screen while the request is still out still lands the move, and leaves no dialog.
- Hand-typed `#customers/999999`, `#nonsense`, `#open/product/999999`, `#settings` — all land on a
  real screen. Back and forward through four screens keeps drawing one. A reload with a dialog
  open comes back on the screen, clean.
- A cashier typing `#reports` is put somewhere she may be, **and the server refuses her the data
  anyway** (403).
- Moving more stock than exists is refused and moves nothing.
- A session killed under a tab does not leave a half-drawn screen.
- Slow 3G: the button says it is working, and the move lands. The plug pulled mid-save: "Not saved
  — check the connection and try again", the dialog open, every box still holding what was typed,
  and nothing written.
- **A full shop**: 500 products in 7s, 200 parcels in 4s, 300 money events in 4s, through the
  shop's own routes — run three times over, so the screens were measured at 1,532 products, 626
  deliveries and 1,922 money moves. Every heavy screen still draws, in under 2.9 seconds, at 1280
  and at 390, with no sideways scroll and no console errors. The database was copied aside first
  and put back afterwards; the sandbox is at 32 products, 26 deliveries and 122 moves again.
- Zero console errors and zero unhandled rejections across the whole pass.

---

## 4b. iOS Safari — what is addressed, and what is untested

**WebKit was not driven, and could not be.** There is no Safari on Windows, and the only way to a
WebKit build on this machine is an npm install — which this repo does not have, has never had, and
will not grow for a test. So the honest thing is to say which iOS-specific behaviours were
answered on purpose, and which remain untested rather than pretend otherwise.

**Answered:**

1. **A field under 16px makes Safari zoom the whole page in on focus**, with no way back but a
   pinch. Every field in the shop was 13.5px; they are 16px on a phone. This is the single
   commonest iOS complaint about a web app.
2. **`100vh` is the viewport with Safari's toolbars hidden**, which is taller than the screen ever
   is while they show. `100dvh` at phone widths.
3. **The keyboard does not resize the layout viewport on iOS** — unlike Chrome on Android — so a
   fixed bottom sheet sits behind the keys. `visualViewport` is the only thing that knows, and it
   is what `--vvh` / `--kb` come from. This matters *more* on iOS than anywhere else.
4. **The notch and the home indicator**: `env(safe-area-inset-*)` on the tab bar (already), on the
   sheet's bottom padding, and now on the view's left and right, which is what a landscape iPhone
   needs.
5. **Safari's grey tap flash**: `-webkit-tap-highlight-color` is answered, and every pressable
   thing has a state of its own.
6. **`:has()` is avoided** — Safari 15 has none, and the job-home grid uses a `data-n` attribute
   written by the renderer instead.
7. **`overscroll-behavior: contain`** on the sheet's body (Safari 16+), with the page behind
   ALSO held still by `overflow: hidden`, so an older Safari that ignores the first still cannot
   rubber-band the shop underneath the sheet.
8. **`inputmode` and `enterkeyhint`** — Safari has honoured both since 12.2 and 13.
9. **Pointer Events** for the sheet's pull-down (Safari 13+). An older one simply has no pull, and
   the ✕ and the backdrop still close it.
10. **The edge-swipe back gesture is a history back**, which the layer marker answers exactly as it
    answers a back button.
11. **Every figure isolated** — bidi is bidi, but Safari's handling of a bare digit run beside
    Arabic is the same trap and the same fix.

**Untested, and named as untested:** real Safari rasterisation and font fallback for Arabic (this
shop's Arabic is the machine's own face, and an iPhone's is not Segoe UI); Safari's momentum
scrolling inside a sheet; the Home-Screen install path and its notification banner (which has only
ever been seen through the local push receiver, never through Apple's service); and whether
`visualViewport.offsetTop` behaves on an iPhone the way it does in this emulation when the page is
scrolled with the keyboard up.

---

## 5. Suggestions, not built

1. **Cairo for the app's own Arabic.** Montserrat has no Arabic glyphs, so every Arabic screen in
   the shop is really set in the machine's own Segoe UI or Tahoma. Cairo IS vendored — but at
   weight 700 only, for the thermal label. Adopting it would set every Arabic screen in one bold
   weight; doing it properly needs the 400/600/700 woff2 files, which means a converter and a
   build step this repo does not have. **It is a decision about how the whole thing looks, and it
   is yours.** Cost: a day, mostly looking at it.
2. **Tell the first tab it was overwritten.** Two tabs saving the same product both answer 200 and
   the last one wins, silently. A row version compared on write would make the second save say
   "somebody else changed this — look again" instead. It is a schema change, so it was not made.
3. **The job tiles could carry the count that matters.** Three of the six already do ("2 on the
   way", "5 running low"); Money, Reports and Staff carry none because the figure is behind a
   request the home screen deliberately does not make. A single small endpoint would give all six
   a number.
4. **A "what changed today" line on the home screen**, the way Money now has one. The same
   sentences, the shop's whole day, five lines.
5. **The sheet's pull-down could take the drawer too.** The product drawer is still a side panel
   on a phone, and a pull-down is what a thumb expects of anything that rose from an edge.
6. **`scroll-padding-bottom` is per-scroller and is set on three of them.** A fourth scroller
   added next year will not have it. A single rule keyed on "anything that scrolls inside the
   shell" would not need remembering.
7. **The camera scanner's permission sentence is right and its recovery is not.** It says the
   camera was refused; it does not say how to give it back, which on a phone is three taps in a
   menu most people have never opened.

---

## 6. Questions

1. **Cairo — yes or no?** Suggestion 1. It changes how every Arabic screen looks, so it is not a
   thing to do quietly on a branch about broken buttons.
2. **Should a second tab be told it overwrote somebody?** Suggestion 2. It needs a column, which
   means a migration, which this fix may not make.
3. **Should `.fade-in` say `backwards` app-wide?** Fix 04 asked this and it is still open. A
   filling animation that ends in `transform: none` leaves an identity transform, which makes its
   element a containing block for anything `position: fixed` inside it. It has bitten the till and
   the order desk. Scoping it to the two screens that carry something fixed is what is there now;
   making it app-wide would close the whole family and is a one-line change with a wide blast
   radius.
4. **`out` → `waiting` for a parcel whose carrier was switched off.** Fix 04's question 1, still
   open, still yours: it is a new server rule against that module's stated invariant. INV-2121 in
   the sandbox is still the case.
5. **Is "one lime primary per card or row" the rule you want?** The brief said one per screen; the
   shop's own board draws one per ROW on purpose (night shift 02), and enforcing one per screen
   would undo that. The rule written into CLAUDE.md is one per head, card or row.

---

## 7. The commits

```
334152c  fix-05 (0): the buttons did nothing, and here is why
efba6ac  fix-05 (1): the job tiles — one press, one shape, one word
0dfd08e  fix-05 (2): the shelf popup that would not go — and every other floating layer
2c0040a  fix-05 (3): Safeers — every control pressed, and the screen finished
a58db4e  fix-05 (4): Money — the screen, every dialog, and a keyboard that stops covering Save
fb06376  fix-05 (5): phone quality — six widths, measured, as every role
2933536  fix-05 (6): the devil pass — a minus used to mean its opposite
7000244  fix-05 (7): the style rules, enforced rather than written down
```

New files: `js/update.js`, `js/layers.js`. New suites (gitignored, in `_nightshift/fix05/`):
`p0-namespaces`, `sw-update`, `p1-tiles`, `p2-layers`, `p3-safeers`, `p4-money`, `p5-phone`,
`p6-devil`, `p6-load`, `p7-style`, plus `fixtures.mjs`, `shots.mjs` and `run-all.sh`.

**The before/after pictures are on disk and NOT in the commit**, at `docs/img/fix-05/before/`
and `docs/img/fix-05/after/` — eight each: the job home, Money, Safeers and the shelf map, in
English at 1100 and Arabic at 390. `docs/img/*` is gitignored on purpose (only
`docs/img/warehouse-*` is excepted, as the 3D room’s design reference), and committing a
screenshot set is how `dist/` drifted. They are one command to remake and the command is at the
end of `PROGRESS.md`.

Repaired suites: `ns03/p1-home` (measured the tiles, never pressed one), `ns03/p2-digits`
(asserted the minus bug), `ns03/p5-safeers-board` (spent its own fixture), `ns03/sweep` (six
viewports now, and a hidden tab bar is not a bar), `fix04/till` (a tolerant picture comparison),
`ns03/p1-tabbar` and `ns03/p2-money` (the documented artefact set).
