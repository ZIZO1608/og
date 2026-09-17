# OG System — server

The backend: accounts, permissions, and the database the shop runs on. One
process serves the app **and** the API.

**Zero npm dependencies.** Node 22.5 or newer (that is when `node:sqlite`
arrived) and nothing else — there is no `npm install`, and no build step.

- `http://localhost:8090` (`OG_PORT`) — the app and the API.
- `https://localhost:8443` (`OG_HTTPS_PORT`) as well, once `npm run cert` has
  made a certificate and the server has restarted. Browsers asking for a page on
  the plain port are then sent to the secure one; the API still answers there.

---

## Run it

In the shop: double-click **OG System.exe** in the repository root. It opens the
control panel (`../panel/panel.js`), which starts the server and holds it.

By hand:

```
cd server
npm run createuser      # first manager — there is no default account
npm start               # node index.js
```

## The one test

```
npm test
```

`test/config-keys.test.js` checks every config key the browser sends through
`PUT /api/config` against the server's allow-list (`lib/config-writable.js`).
It starts no server and opens no database. Nothing else is tested.

## Commands

| Command | What it does |
|---|---|
| `npm start` | the server |
| `npm run dev` | the same, restarting when a file changes |
| `npm test` | the one test above |
| `npm run createuser` | make an account (interactive, or piped stdin) |
| `npm run backup` | `VACUUM INTO` a snapshot, then verify it |
| `npm run preflight` | accounts, catalogue, Supabase, port |
| `npm run cert` | make the self-signed HTTPS certificate |
| `npm run cert:trust` / `cert:untrust` | add / remove it in Windows' trusted list (asks for administrator) |
| `npm run hardware` / `hardware:install` | check / install the printers' queues |
| `npm run test-print` / `test-print:dry` | send a real test slip and label / only say where they would go |
| `npm run botfather` | write both Telegram bots' descriptions and menus |
| `npm run warehouse:one-room` | rebuild the warehouse as the one real room |
| `npm run supabase:check` | is the mirror a faithful copy of the data |
| `npm run supabase:drift` | does the mirror have every column this database has |
| `npm run supabase:sync` | one full push to the mirror |
| `npm run supabase:restore` | pull the whole shop back from the mirror |
| `npm run supabase:reconcile` | repair rows the mirror is missing |

`scripts/purge-demo.js` has no npm name: `node scripts/purge-demo.js` (a dry run
unless told otherwise).

## Settings

In `server/.env`, which is gitignored. Every setting is listed, with what it
does, in `.env.example` — copy it to `.env` and fill in what you need. Nothing
there is required to run the shop on this machine.

---

## Security

- **Passwords**: scrypt (`N=32768, r=8`), from Node's standard library.
- **Sessions**: 256-bit random tokens in `HttpOnly` `SameSite=Lax` cookies,
  14-day sliding expiry. The cookies get the `Secure` flag when the server is
  serving HTTPS, or when `OG_SECURE=1`. Changing a password ends every session
  of that account. A disabled account is refused on its **next request**.
- **Login throttle**: 8 failures per username in 15 minutes.
- **Unknown usernames**: answered like a wrong password, and the password is
  hashed either way so the timing matches.
- **Permissions**: the `role_permissions` table, deny by default, checked on
  the server (`requirePerm`). What the browser hides is a courtesy.
- **`OG_ORIGINS`**: left blank, every origin may change data. Set it the moment
  the shop is reachable from anywhere but its own network.
- **`OG_TRUST_PROXY=1`** only behind a reverse proxy you control — otherwise
  anyone can forge `X-Forwarded-For` and walk past the login throttle.

**Never commit** `.env`, `data/` or `backups/` (all gitignored): the repository
is public, and the database holds real customers and takings. Git keeps history,
so a later delete does not remove anything.

---

## Backups

```
npm run backup                              # ./backups, keeps 30
node scripts/backup.js --out D:\backups --keep 60
```

`VACUUM INTO`, not a file copy, so it is safe while the shop is trading. Every
backup is reopened and checked (`integrity_check`, `foreign_key_check`).

**To restore:** stop the server, put the chosen backup at `data/og.db`, delete
any `og.db-wal` and `og.db-shm` beside it, start the server.

---

Everything else — the mirror, the partner portal, Telegram, the money — is in
[`../CLAUDE.md`](../CLAUDE.md).
