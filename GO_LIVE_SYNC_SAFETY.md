# Go-live: print kits + sync safety — 13 Oct 2026

The plan was `STAGE_SYNC_SAFETY.md`. **Result: done.** The shop's cloud copy (Supabase project
`wsuqoippcxcwoszcgagc`) can now be written by **one key, on one machine**. The key that copies
of the shop's database held is revoked.

## What was done

| Part | What | Evidence |
|---|---|---|
| 1 | Tests, merge, deploy, push, fonts | `dd62fa6` on main, on GitHub and running on the VPS. The four print fonts answered as WOFF2 (OG Block 65,080 B, OG Classic 23,236 B, OG Modern 94,888 B, Syria 181,588 B). |
| 2 | New secret key | `og-shop-vps-2`, a new `sb_secret_` key (41 characters). |
| 3 | The key on the VPS only | `SUPABASE_SECRET_KEY` in `/data/og-shop/extra.env` (mode 600), the container recreated. `supabase-check`: *new sb_secret_ key, sent on apikey only · The secret key was accepted · 63 table(s) match row for row*. Log: `[mirror] full run completed (3.0s)`, no 401. |
| 4 | The VPS is the writer | `supabase:writer --claim`: *recorded writer : 5104c8c7b4f7 (308c6782…) ← this machine*. The identity is `data/mirror-writer.id` on the shop's data volume, not the container name. |
| 5 | Old key revoked | The secret key every earlier install held was revoked in the dashboard, after the new one was proven. Railway (og-track) is cancelled, so nothing there used it. |
| 6 | The laptop cleaned | The parked `#vps# SUPABASE_SECRET_KEY=` line removed from this laptop's `server/.env`. No Supabase secret key is left on it. `supabase-check` on the VPS **after the revoke**: all green, *this machine is the recorded writer*, *Connected, and the mirror matches the shop.* |

The "a copy on the laptop is refused" demonstration (Part 4) was not run by hand, because the laptop has
no key to try with. `server/test/sync-safety.test.js` proves that refusal (11 tests, each seen red
on the old code).

## Shipped the same day (on GitHub, NOT yet on the VPS)

- `0c6b946`: **a print font from the internet**. Type a Google Fonts name in the kit form or on
  the Fonts tab, and it is downloaded, converted and chosen.
- `3f6efd6`: **a print font from a picture**. A photo or ChatGPT sheet of a shirt's letters
  becomes a real font, with each letter checked on screen before it is saved.

The VPS still runs `dd62fa6`. These two go live the next time OG System is opened on a computer
that reaches the VPS: the launcher deploys every commit on main by itself. The current
development computer (DESKTOP-9PB05CR) cannot reach the VPS over SSH.

## Still open

1. **The new key was seen.** Two of the keys made today showed up in screenshots, so they are in
   the chat history and in image files on the development computer. The first was deleted. The
   second (`og-shop-vps-2`, the one in use) was kept: **the owner's decision, 13 Oct**.
   Recommended when there is a quiet moment:
   - make `og-shop-vps-3`;
   - put it in `extra.env`, recreate the container and run the check;
   - revoke `og-shop-vps-2`.

   The same steps as Part 3, about 5 minutes.
2. **The database password.** `SUPABASE_DB_URL` (the Postgres password) is still parked on the
   laptop. Copies of the shop may have had it too, and revoking an API key does not cover it.
   Change it in the dashboard (Settings → Database), then update `SUPABASE_DB_URL` wherever the VPS
   uses it.
3. **Ahmad.** `_handover/PROMPT-FOR-AHMAD-SYNC-SAFETY.md` goes to him. Waiting on his three
   answers: keys removed, nothing of his on the secret key, the old 7–13 Sep database. He must
   never be given `og-shop-vps-2`. If he needs a secret key, he gets his own (`ahmad`), revocable
   alone.
4. **The tracking links.** `receipt.public_url` points to og-track on Railway, which is now
   cancelled, so the order links on receipts and in WhatsApp messages do not open. Moving them to
   `shop.ogsports1.com` is a separate job.
5. **The VPS's `og-shop.env`** still holds the old, now dead, key line. `extra.env` wins over it, so
   it changes nothing. The next `npm run vps -- env` rewrites that file anyway.
6. **Windows Defender** reported "threats found" on the development computer during the session.
   Not yet looked at. Protection history names the file.
7. **A rebuilt VPS** must claim the writer again (`npm run supabase:writer -- --claim`), unless the
   data folder with `mirror-writer.id` came with it. Until then its pushes are refused, which is
   the guard working.
