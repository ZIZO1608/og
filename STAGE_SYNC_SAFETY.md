# Stage: Sync safety — one key per machine (8 Oct 2026)

Branch `feature/sync-safety`, off `main` at `d496b03`. **Not merged. Nothing live was changed:**
- no deploy;
- no Supabase write;
- the live `server/.env` and the VPS are untouched.

The one file deleted is the stray backup in item 4.

Why this stage exists: `SYNC_WRITERS.md` in the main folder. On 8 Oct a reconcile deleted 13 sales,
4 print jobs and more from the mirror. A **copy** of the shop's database had written them, using
the live key. The lineage guard cannot tell a copy from the original.

---

## 1. New Supabase keys (`sb_secret_…`)

- `server/lib/supabase.js` reads **`SUPABASE_SECRET_KEY` first**, then the old
  `SUPABASE_SERVICE_ROLE_KEY`. So a new key put in `SUPABASE_SECRET_KEY` wins over an old one
  still in the file.
- **`keyHeaders(key)` is the one rule** for every request this server makes to Supabase:
  - **`sb_secret_…` / `sb_publishable_…`** → the `apikey` header **only**.
  - **an old service_role JWT** → `apikey` **and** `Authorization: Bearer`, as before.
- Every caller goes through it:
  - PostgREST via `call()`: the sync worker, the mirror, the reconcile, the restore, the check,
    `users:mirror`, `inbox`, website orders and requests;
  - Storage via `authHeaders()`: product photos and print fonts.
  Nothing else in the repo sends the Supabase key. Grepped: the other Bearer headers are the
  website key, the copy key and og-bridge.
- `supabase:check` names the variable `SUPABASE_SECRET_KEY` and says which kind of key it found.
  It never prints the key.
- `npm run vps -- env` **no longer needs the key on the laptop**:
  - If the laptop has none, it checks that `/data/og-shop/extra.env` on the VPS has one, and
    refuses if neither does.
  - `extra.env` comes after `og-shop.env` in the compose file, so a key there wins.
  - `vps env` never writes `extra.env`.

**Measured on the way:** the key the shop uses today is **already** an `sb_secret_` key
(41 characters). It has been sent with both headers until now, and Supabase has accepted that.
With this change it is sent the way Supabase documents, which keeps working whenever the
platform stops accepting the old way.

## 2. The writer check — only the VPS can push

The lineage is the identity of a **database**, so any copy of `og.db` passed the guard. Now the
**machine** is named too:

- **`mirror-writer.id`** is a random id in a file in the data folder, beside `og.db` and never
  inside it. On the VPS that is `/app/server/data` (the volume).
- It is recorded in the mirror as the `sync_state` row **`writer`** (`<id> <hostname>`).
- Every push compares both rows, which are read in **one** request: the live worker (before every
  run and at boot), `supabase:sync`, `supabase:reconcile` and `users:mirror`.
- **A copy of the database has the lineage and not the file, so it is refused:**

  > ! This computer isn't the machine that writes to the cloud copy. It holds a copy of the shop's
  > database, but the cloud copy is written only by &lt;host&gt; (writer xxxxxxxx…), since … UTC.
  > Nothing was pushed.

  It is followed by what to do: a development or standby copy sets `OG_SYNC_MINUTES=0` and keeps
  the keys out; a real move of the shop runs `--claim --replace`.
- **Nothing stops until a writer is recorded.** Until then the guard behaves exactly as before
  (`writerUnset`): the worker logs one line saying so, and `supabase:check` warns. So this code
  can be deployed first and the writer recorded afterwards.
- **Recording it:**
  - `npm run supabase:writer` shows the status (read-only). `-- --claim` records this machine.
  - It refuses unless this database owns the lineage (`not_owner`).
  - It refuses to take over from another recorded writer without `--replace` (`writer_elsewhere`).
  - It writes one file and one row, nothing else.
- **The disaster restore** (`npm run supabase:restore -- --wipe`), the one deliberate move of the
  shop, now records its machine as the writer, after it claims the new lineage.
- **Caveat 1:** a copy of the whole data **folder** carries the file. A standby only ever receives
  `og.db` (`/api/copy/db`), so it is refused. Do not copy `/data/og-shop/data` to another machine
  that has the key.
- **Caveat 2:** the Settings Mirror fold and the panel still draw their usual "refused" card for
  this case, with the old "isn't the shop" wording. The exact reason, the new sentence, is in the
  sync status's `lastError` and in the log.

## 3. The reconcile asks before it deletes

`supabase:reconcile` no longer deletes straight away. Before it writes **anything**, even the
upserts:

1. It lists **every** row it would delete: the table, the count, and every id, ten to a line.
   It used to stop at 25.
2. It saves the **full rows** to `<data>/backups/reconcile-delete-<time>.json`. If that save fails,
   it stops.
3. It asks for the word **`DELETE`**. Anything else stops it with nothing written (exit 3).
   **With no terminal to ask on, it stops** and says to run again with **`--yes`** (exit 3).
4. With nothing to delete it runs as before, without asking. `--dry-run` is unchanged.

The panel had one **Reconcile** job. It now has two:
- **Reconcile** (typed word `RECONCILE`) runs it without `--yes`, so with rows to delete it lists
  them in the log and stops;
- **Reconcile and delete** (typed word `DELETE`) runs it with `--yes`.

## 4. The stray key file, and every other copy of the key

**Deleted:** `D:\DESKTOP\OG System\server\.env.before-standby-2026-09-25T07-14-07-591`. It was
git-ignored (`server/.gitignore`: `.env.*`) and never committed.

How I searched: the key was read from that file before deleting it and compared as bytes. It was
never printed. I searched 127,020 files under `D:\DESKTOP`, `%LOCALAPPDATA%\OGSystem` and
`C:\Users\ZIZO\.claude`, including every backup, the `.db` files and `_secrets`, plus the git
history of every repository on the desktop.

| Where | What | Risk |
|---|---|---|
| `D:\DESKTOP\OG System\server\.env` (the live laptop file) | the key, **parked** as a `#vps# SUPABASE_SECRET_KEY=` line | not used while parked. **Left alone**: live file. `vps env` reads it; with the new key in `extra.env` the line can be deleted by hand (step 8 below) |
| `C:\Users\ZIZO\.claude\file-history\7cf24ec2-…\f940f14c08b5fd29@v1` and `@v2` | Claude Code's local edit history of a `.env`, from a September session in the old `OG System Demo` folder | local only; dead once the key is revoked; can be deleted |
| `C:\Users\ZIZO\.claude\projects\d--DESKTOP-OG-System-Demo\7cf24ec2-…jsonl` | the same session's transcript | same |
| **git history** of `OG System` (every branch, tag and stash) and of `zaven-portfolio` | **not there**: no commit ever held it | none |
| `server/backups/`, `_secrets/`, `_handover/`, the old worktree folders, the print-kits folder | **not there** (the two test env files point at `127.0.0.1`) | none |
| **Not searched, outside this laptop:** the VPS (`/data/og-shop/og-shop.env`, written by `vps env`), **Ahmad's laptop** (CLAUDE.md says his install ran the same `.env`), and og-track's Railway variables | probably there | revoking the key (step 7) closes all three |

`D:\DESKTOP\og-track` (named in the memory notes) no longer exists on this laptop, so its history
was not searched.

## 5. By hand — the new key on the VPS only

**Order matters.** Put the new key in and check it works **before** revoking the old one, so the
shop never loses its mirror. Every command here runs on this laptop in Git Bash, from
`D:\DESKTOP\OG System`, unless it says otherwise. The VPS address is the tunnel's.

**1. Merge and deploy this branch** (your decision; I have not):

```bash
git merge --no-ff feature/sync-safety
cd server && npm run vps -- deploy
```

- Local `main` is still **5 commits ahead of GitHub**: the print kits, already on the VPS. The
  launcher's auto-publish pushes them with this once it runs.
- After the deploy, `docker logs og-shop --since 5m` on the VPS should show the mirror working,
  plus one line: "no writer is recorded…". That is expected.

**2. Create the new key.** In the Supabase dashboard: project `wsuqoippcxcwoszcgagc` →
**Project Settings → API Keys → Secret keys → + New secret key**.
- Name it **`og-shop-vps`**.
- Copy it **once**. Paste it nowhere but step 3: not into chat, not into a file on the laptop.

**3. Put it on the VPS only:**

```bash
ssh -o HostKeyAlias=152.239.114.129 root@10.8.0.1
nano /data/og-shop/extra.env        # add one line:  SUPABASE_SECRET_KEY=sb_secret_…
chmod 600 /data/og-shop/extra.env
cd /data/og-shop && docker compose up -d --force-recreate og-shop   # re-reads the env files
exit
```

(`npm run vps -- restart` from the laptop also does it, if it recreates the container. To be sure,
use the line above.)

**4. Check it is the new key and that the sync works:**

```bash
ssh -o HostKeyAlias=152.239.114.129 root@10.8.0.1 'docker exec -w /app/server og-shop node scripts/supabase-check.js'
```

- **2. Credentials:** the masked key's last four characters must match the new key in the
  dashboard, and it must say `new sb_secret_ key, sent on apikey only`.
- **The whole check is green** (tables row for row).
- Then watch a push land: `docker logs og-shop --since 3m | grep mirror`. The idle beat stamps
  `sync_state.shop` every two minutes. Or ring up anything small and see it pushed within seconds.

**5. Record the VPS as the writer:**

```bash
ssh -o HostKeyAlias=152.239.114.129 root@10.8.0.1 'docker exec -w /app/server og-shop node scripts/supabase-writer.js --claim'
```

- It should say `Recorded: <container host> (xxxxxxxx…) is the writer.`
- Run it again without `--claim`: "recorded writer … ← this machine".
- Run the check from step 4 again: "this machine is the recorded writer".

**6. Before revoking, find anything else that uses the old key.** Look in:
- og-track's Railway variables, for `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`;
- og-bridge / night mode: it uses the `og_vps` database password, not this key;
- anything Ahmad runs.

Anything that legitimately needs a key gets **its own** new secret key, named for it. The website
uses the **publishable** key and its own website key, not this one.

**7. Revoke the old key.** Dashboard → API Keys → the old secret key → **Delete / Revoke**. Then:
- run step 4's check again (still green);
- open the website's checkout once (it still loads);
- open a tracking link once (og-track still answers).

From here, every other copy of the old key is dead: Ahmad's laptop, the laptop's parked line,
the Claude history files, old checkouts.

**8. Tidy the laptop** (optional, by hand): delete the `#vps# SUPABASE_SECRET_KEY=` line from
`server/.env`. It is now a dead key. `npm run vps -- env` keeps working because the key is in
`extra.env`.

**If step 4 fails:** remove the line from `extra.env` and recreate the container again. The old
key (not yet revoked) is used again, exactly as before.

---

## Files

- `server/lib/supabase.js`: the key order, `isNewKey` / `keyHeaders` / `keyKind`.
- `server/lib/lineage.js`: the writer, `claimWriter`, `remoteWriter`, the one-request read,
  `NOT_THE_WRITER`, `refusal(other, lin)`.
- `server/lib/sync-worker.js`: the refusal for `notWriter`, and the one warning when no writer is
  recorded.
- `server/lib/restore.js`: the disaster restore claims the writer.
- `server/scripts/supabase-writer.js` (new) and `npm run supabase:writer`.
- `server/scripts/supabase-reconcile.js`: the full list, the saved rows, the question, `--yes`.
- `server/scripts/supabase-sync.js`, `users-mirror.js`, `supabase-check.js`: the new refusal, the
  writer state, the key kind.
- `server/scripts/vps.js`: `env` takes the key from `extra.env`.
- `panel/jobs.js`: Reconcile lists; Reconcile and delete deletes.
- `CLAUDE.md`: a "Sync safety" section under the Supabase heading.

## Tests

| Suite | Result | |
|---|---|---|
| `server` `npm test` | **73 / 73** | 62 before, plus the 11 below |
| `server/test/sync-safety.test.js` (new) | **11 / 11** | **All 11 red on the old code.** See below |
| `panel` `npm test` | 50 / 50 | |
| `tools/night-mode/laptop.mjs` | 68 / 68 | |
| `tools/night-mode/roundtrip.mjs` | 35 / 35 | |
| `_nightshift/audit06/p2-sync`, `p1-one-laptop` | **not usable** | They fail the **same way on unchanged `main`** (25 pass / 12 fail, and p2 stops on `print_kit_id`): their stand-in schema predates migration 071. A stale harness; it says nothing about this change. Their stand-in (git-ignored) was taught `in.(…)` filters so it will not trip on the guard's one-request read once its schema is brought up to date |

`sync-safety.test.js` uses a stand-in Supabase (`server/test/fake-supabase.js`). The stand-in
refuses an `sb_` key sent as Bearer, the way Supabase does. The tests cover:

- **the key:**
  - which headers each kind sends, through a real select, ping and photo upload;
  - an old JWT on either variable name;
  - the new key winning over the old one;
- **the writer:**
  - nothing stops before a writer is recorded;
  - `--claim` makes the file and the row;
  - a `VACUUM INTO` copy is refused with the new sentence while its lineage still matches;
  - it cannot take over without `--replace`, and after `--replace` the original is refused;
  - another database can never be recorded;
- **the reconcile:**
  - with 30 stray rows and no terminal: every id listed (not cut at 25), the full rows saved,
    exit 3, and **not one write** reached the stand-in;
  - `--yes` deletes them;
  - a copy that is not the writer is refused (exit 2) before it reads anything to delete.
