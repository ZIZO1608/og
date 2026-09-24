# Deploying OG System — Coolify, from GitHub

Written for whoever puts this on the server: the one container, what has to be
true before it starts, and the things a VPS cannot do that the shop's laptop
can.

---

## 1. One container, and it is not a static site

`Dockerfile` at the repo root builds the shop's own system — till, stock,
customers, money, the delivery office, the partner portal. It is for staff, on
a hostname nobody advertises (`pos.ogsports1.com` is the suggestion), and it is
**not indexed**: `robots.txt` says `Disallow: /` and `index.html` carries
`noindex`.

> **Why it is not nginx serving a folder.** There is no static build of this app
> and there never was. `index.html` on its own draws the "server is not
> answering" screen: every screen is filled by `DB.hydrate()` from the API, and
> the server serves the API *and* the files from one origin. A folder of files
> behind nginx would load and then say the shop is unreachable.

---

## 2. Before the first deploy — COOLIFY BUILDS A CLONE, NOT THIS FOLDER

Nothing on the laptop's disk reaches the server. What gets built is what has
been **committed and pushed**, so anything still sitting in the working tree is
simply not in the image — and the failure is quiet: the shop comes up, on older
code, and behaves like the laptop did a week ago.

```bash
git status --short          # must be empty of app changes before a deploy
git push
```

The two ways this bites, both of which have already happened here:

- **A file imported but never committed** is a crash, and a loud one:
  `ERR_MODULE_NOT_FOUND` at startup, before the port is bound.
  `server/lib/backup-schedule.js` was in exactly that state until it was
  committed; check for others with `git status --short` and look for `??`.
- **A file committed but its caller not** is silent, and it is the one to watch
  for. `server/lib/backup-schedule.js` was committed a few minutes before the
  `import` and the `BackupSchedule.start()` in `server/index.js` were, and in
  between, a clone carried the nightly backup on disk and never ran it: the
  laptop printed a "Backups:" line at startup and the container printed
  nothing. Both halves are in now. Nothing warns about this — only booting a
  clone does.

A clone is easy to check before trusting it:

```bash
git archive HEAD | tar -x -C /tmp/clone && cd /tmp/clone
node --test "server/test/*.test.js"
node server/index.js        # a fresh database, migrations, /api/health
```

---

## 3. The shop's system on Coolify

**New Resource → Private Repository (GitHub App) → this repo → Dockerfile.**

| setting | value |
|---|---|
| Build Pack | `Dockerfile` |
| Dockerfile location | `/Dockerfile` |
| Base directory | `/` |
| Port | `8090` |
| Domain | `https://pos.ogsports1.com` |
| Health check | `/api/health` (the image declares its own too) |

### Environment variables

The two that must be right, because the container is behind Coolify's proxy:

| name | value | what happens without it |
|---|---|---|
| `OG_ORIGINS` | `https://pos.ogsports1.com` | left blank, a write is accepted only when the browser says it came from the address it was sent to (Origin host == Host, audit 06). That is safe, but it is a fallback: naming the hostname is the check that still holds if anything ever sits in front of this one. |
| `OG_PROXY_ADDR` | the proxy container's **fixed** address | every visitor shares the proxy's address for login throttling (20 failures per address per 15 minutes), so strangers mistyping add up and lock everybody out. The proxy must also OVERWRITE `X-OG-Client-IP` with the visitor's address — Coolify's own proxy does not, so this route needs `deploy/shop-proxy/` in front as well. `OG_TRUST_PROXY` is retired (night shift 04) and ignored. |

Already set in the image, override only if you know why: `OG_PORT=8090`,
`OG_HTTPS=0` (Coolify terminates TLS; a second self-signed certificate inside
would redirect browsers to `:8443`, a port the proxy does not carry),
`OG_SECURE=1`, `NODE_ENV=production`, `OG_DATA_DIR=/app/server/data` (the
database, the certificates **and the backups** in the one folder on the
volume) and `TZ=Asia/Damascus` (receipts, the bell and Telegram print times in
the process's own zone, and a VPS runs in UTC; the image carries `tzdata`).

Optional, all of them off by default:

| name | what it turns on |
|---|---|
| `OG_VAULT_KEY` | the sealed passwords. **See the warning below.** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OG_SYNC_MINUTES` | the cloud copy. **See §6 first** — one project, one writer. The code takes `SUPABASE_SECRET_KEY` as another name for the same key, which is what the laptop's `.env` happens to use. |
| `OG_TELEGRAM_TOKEN_OG`, `OG_TELEGRAM_TOKEN_YALLA` | the two bots. Only ever one container per token: two long-polls on one token fight over `getUpdates`. |
| `OG_WEB_API_KEY` | `/api/ext/*` for a website. No key and every route under that prefix answers 503, which is the right answer for a shop with no website. |
| `OG_BACKUP_COPY_DIR` | a second copy of each nightly backup, on another mount. |

> ### ⚠ `OG_VAULT_KEY` MUST BE THE LAPTOP'S EXISTING VALUE
>
> It is already set on the shop's laptop (`server/.env`), which means the
> passwords in `og.db` are **already sealed with it**. It is a passphrase, not
> a generated key: a different value here does not fail loudly at startup — it
> simply cannot open the boxes that are there, and you find out the day you
> need to restore accounts. Copy the line across unchanged.
>
> Generate a new one **only** for a brand-new shop with a brand-new database:
> `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
>
> Either way, keep a copy somewhere that is not this server and not this
> repository. There is no recovery path, by design.

### Ready to paste into Coolify

Coolify takes a whole `.env` at once (Environment Variables → Developer view).
Fill in the four values from the laptop's `server/.env` — never from git.

```dotenv
# --- required behind the proxy ---------------------------------------------
OG_ORIGINS=https://pos.ogsports1.com
# the fixed address the proxy's requests arrive FROM (see the table above)
OG_PROXY_ADDR=

# --- the same value as the laptop's, or the sealed passwords stay shut ------
OG_VAULT_KEY=

# --- the cloud copy: leave BLANK while the laptop still owns the mirror -----
SUPABASE_URL=
SUPABASE_SECRET_KEY=
OG_SYNC_MINUTES=0

# --- the bots: only ONE machine may hold a token at a time ------------------
OG_TELEGRAM_TOKEN_OG=
OG_TELEGRAM_TOKEN_YALLA=

# --- optional --------------------------------------------------------------
OG_WEB_API_KEY=
OG_BACKUP_COPY_DIR=
```

`OG_PORT`, `OG_HTTPS`, `OG_SECURE`, `NODE_ENV`, `OG_DATA_DIR` and `TZ` are
already right in the image — leave them out unless you are changing one on
purpose. **Do not copy `OG_TRUST_PROXY` across**: it is retired, the server
ignores it and prints a notice while it is set.

**Four keys in the laptop's `.env` are dead and should not be copied across**
(nothing reads them any more — the tunnel was retired and the boot pull was
removed in audit 06): `OG_CF_TUNNEL_ID`, `OG_CF_HOSTNAME`, `OG_CF_TUNNEL_TOKEN`,
`OG_PULL_AT_BOOT`. `SUPABASE_DB_URL` is unread too. They can be deleted from
the laptop's file at the same time.

### The volume — this is the shop

```
/app/server/data
```

`og.db`, its WAL, `backups/` and `certs/` all live there. **The image holds no
copy.** Add it as a persistent volume in Coolify *before* the first start; a
container recreated without one comes up as an empty shop.

`backups/` is there because the image sets `OG_DATA_DIR` to this folder. Until
24 Sep 2026 it did not, and the nightly backups went to `/app/server/backups`,
inside the container, where every redeploy threw them away — while this
paragraph said they were on the volume.

### The first start

The first boot creates `og.db`, applies every migration and comes up with
**zero accounts** — the login screen will say so. Two ways on from there:

```bash
# a) a new shop
docker exec -it <container> node server/scripts/createuser.js

# b) move the existing shop onto the server: take a clean copy on the laptop,
#    stop the container, drop the file in, start it again
cd server && npm run backup                   # VACUUM INTO + integrity check
docker cp server/backups/og-<stamp>.db <container>:/app/server/data/og.db
```

Copying a live `og.db` while the shop is open is the one way to get a
half-written file — take the backup, copy the backup.

---

## 4. What this container cannot do, and it is not a fault in the image

- **It cannot print.** The receipt printer is a Windows share and the label
  printer is that or a box on the shop's LAN at `:9100`. Neither is reachable
  from a VPS. Selling, stock, customers, money, the delivery office, the
  partner portal, Telegram and the mirror all work; paper wants a machine in
  the shop.
- **No control panel.** `panel/` is a Windows tray application and is excluded
  from the image. Restart the container from Coolify instead; `npm run backup`,
  `createuser` and the Supabase scripts all run through `docker exec`.
- **No certificate machinery.** `npm run cert` exists for a laptop on a wifi
  with no public name. Here Coolify has a real Let's Encrypt certificate, which
  is better in every way — and it is what finally makes notifications, the
  camera scanner and installing the app work without a warning page.
- **It does not know which branch it is.** `.git/` is excluded from the image,
  so Settings shows the cache name without a branch beside it.

---

## 5. Before it is reachable from the internet

This app was built for a laptop on a shop's own network. Four things change
when it has a public address:

1. **`OG_ORIGINS` and `OG_PROXY_ADDR`** — §3. Neither is optional here.
2. **The five old test accounts.** `hussam`, `lubna`, `maher`, `talal`, `yalla`
   were all created on one password **that is still in this repository's git
   history and cannot be taken out of it**. On this laptop's database three of
   them were found switched back on. Check the database you are about to put
   online, not any document:
   ```sql
   SELECT id, username, role, active, pw_hint FROM users;
   ```
   `npm run users:rebuild -- --apply` is what makes the accounts match the
   shop's real list; the server also names any of the five that is active in
   its startup notices, and so does `npm run preflight`.
3. **`OG_VAULT_KEY` off the server as well.** It opens every sealed password.
4. **Backups off the box.** The nightly backup lands on the same volume by
   default, which is no protection against losing the volume. Set
   `OG_BACKUP_COPY_DIR` to another mount, or pull them down on a schedule.

---

## 6. The cloud copy — one project, one writer

`server/lib/lineage.js` lets exactly one database own a Supabase project. If
the shop's laptop still syncs to it, **leave the Supabase variables blank on
the server**: the container will be refused on every push, which is the guard
working, not a fault.

Moving the shop to the server means the laptop stops being the shop — copy
`og.db` across as in §3, take the Supabase keys off the laptop, and put them on
the container. Two live installs pointed at one project delete each other's
sales; it has happened twice in this project's history.

---

## 7. Running it locally, without Coolify

```bash
docker compose up --build      # the shop, at http://localhost:8090
```

The shop's data lives in the `og-data` volume. `docker compose down` keeps it;
`docker compose down -v` deletes the shop.
