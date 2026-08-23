# OG System — server

The backend: accounts, permissions, and the database the shop actually runs on.

**Zero npm dependencies.** Not "few" — none. It uses SQLite and password
hashing from Node's own standard library, so deployment is *copy the folder and
run node*. There is no `npm install` to fail on a server with bad connectivity,
no native module to compile, and nothing in the trust path but Node itself.

---

## Run it

Needs **Node 22.5 or newer** (that is when `node:sqlite` arrived). Check with
`node --version`.

```
cd server
npm run createuser      # first manager — there is no default account
npm start               # http://localhost:8090
```

`npm start` serves the API *and* the app, so one process is the whole system.
Open http://localhost:8090 and sign in.

```
npm run dev             # same as start, restarts when you edit a file
npm run backup          # snapshot the database, and verify it
```

> **There are no tests.** 128 server checks were removed on request — they
> covered the schema, password hashing, sessions, the permission boundaries,
> and proved with five real processes that two tills cannot both sell the last
> pair. Nothing verifies any of that now. They are recoverable:
> `git checkout d76950a -- server/test`

### Settings

All optional; the defaults are right for working on your own machine.

| Variable | Default | What it does |
|---|---|---|
| `OG_PORT` | `8090` | Port to listen on |
| `OG_DB` | `./data/og.db` | Where the database file lives |
| `OG_STATIC` | `../` | The app folder to serve |
| `OG_ORIGINS` | *(unset)* | Comma-separated origins allowed to change data. **Set this in production.** |
| `OG_SECURE` | *(unset)* | `1` behind HTTPS, so cookies get the `Secure` flag |
| `OG_TRUST_PROXY` | *(unset)* | `1` only when a reverse proxy sets `X-Forwarded-For` |

`OG_TRUST_PROXY` matters more than it looks. With it on and no real proxy in
front, anyone can spoof their IP address and walk straight past the login
throttle.

---

## How it is built

```
index.js              the server: routes, and the app's static files
lib/db.js             open SQLite, run migrations, transactions
lib/auth.js           passwords, sessions, the permission table
lib/http.js           bodies, cookies, security headers, routing, static files
migrations/*.sql      schema, applied in order, each exactly once
scripts/createuser.js create an account from the command line
scripts/backup.js     snapshot + verify + prune
test/                 56 tests
```

### Two conventions that explain most of the code

**Money is never a float.** Every amount is an integer in *minor units* beside
the currency it was priced in — USD in cents, SYP in whole lira. Floats are
wrong for money at any scale, and worse here, where a basket can mix two
currencies five orders of magnitude apart.

Every sale also stores **the exchange rate that applied when it happened**.
Without that, re-running last month's profit after the rate moves gives a
different answer and nobody can tell which one is real.

**Stock is derived, not asserted.** `stock_movements` is append-only and is the
truth; the `stock` table is a running total written in the *same transaction*
as the movement that changed it, with `CHECK (qty >= 0)`. So two tills racing
for the last pair cannot both win — the database refuses, whatever the two
browsers believe. Corrections are a new row with the opposite delta, never an
edit, so the trail stays honest.

---

## Security

Real, this time. `js/gate.js` was a passcode inside a file the browser
downloads; it said so in its own comment. It has been deleted, replaced by
`js/auth.js` talking to the endpoints below. Checking now happens somewhere the
browser cannot edit.

- **Passwords**: scrypt (`N=32768, r=8`) — memory-hard, ~100ms per attempt.
  Argon2id is the textbook pick but means a native module compiled on the
  server; scrypt is in the standard library and removes that whole failure mode.
- **Sessions**: 256-bit random tokens in `HttpOnly` `SameSite=Lax` cookies,
  14-day sliding expiry. Changing a password kills every other session.
  Deactivating someone takes effect on their **next request**, not in two weeks.
- **Login throttle**: 8 failures per username in 15 minutes. Counted per
  username, so rotating IP addresses does not help.
- **Account enumeration**: an unknown username and a wrong password return
  byte-identical responses, and the server hashes even when the user does not
  exist so the timing matches too.
- **Permissions**: one table in `lib/auth.js`, deny-by-default. A new endpoint
  is locked until someone opens it deliberately.

### What each role can see

The commercially important line: **a cashier cannot see cost or profit.** They
handle customers and cash; margin is not theirs to know.

**`partner`** is Yalla Wear — a separate company, logging in remotely. They see
their own jobs and nothing else: never a customer name, never a phone number,
never what OG charged. `DB.partnerView` in the browser is a convenience; this
is the boundary.

### Never commit

`server/.gitignore` covers it, but know why: the repo is public, and the
database holds real customer names, phone numbers and takings. Git keeps
history, so deleting a file in a later commit does not remove it — the only
real fix is rewriting history and rotating everything involved.

> **Before real customer data goes in, make the repository private.**

---

## Backups

```
npm run backup                              # ./backups, keeps 30
node scripts/backup.js --out /mnt/usb --keep 60
```

Uses SQLite's `VACUUM INTO`, not a file copy — copying a live database mid-sale
can capture a torn file. It is safe to run while the shop is trading.

**Every backup is reopened and checked**: `integrity_check`, `foreign_key_check`,
and a row count per table. An untested backup is a file, and the day you find
out is the day you needed it.

**To restore:** stop the server, put the chosen backup at `data/og.db`, delete
any leftover `og.db-wal` and `og.db-shm` beside it, start the server. Rehearse
this before you need it.

> A backup on the same disk as the database protects you from a mistake, not
> from a dead drive or a stolen machine. Copy them somewhere else too.

Nightly, on a Linux server — `crontab -e`:

```
0 2 * * * cd /opt/og/server && /usr/bin/node scripts/backup.js --keep 30
```
