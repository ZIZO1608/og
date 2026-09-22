# Tonight — after day shift 06 (22 Sep 2026)

For Ahmad. It replaces `MORNING.md`. Every item is marked:
- **DONE TODAY**;
- **YOURS**, with why;
- **BLOCKED**, with why.

Branch `night/online-offline`, pushed, **not merged**. The live folder stays on `main` until
item 14. Secrets live in `D:\DESKTOP\OG System Demo\_secrets\` (git-ignored); this page names
files, never values.

## Only you can do these (consoles the day shift cannot reach)

**A. YOURS: change `abode`'s password FIRST.** Night shift 05 printed it into a session transcript.
The account row has not changed since 17 Sep, so the leaked password still works. Sign in as a
developer → Settings → Access → `abode` → **New password**, and give it to him.

**B. YOURS (hPanel): the VPS stopped answering SSH and WireGuard at about 09:14 UTC.** The web
ports still answer. It looks like a reboot followed by something dropping TCP 22 and UDP 51820.
`DAY06-VPS-STEPS.md` step 1 has the hPanel browser-terminal commands and the firewall check.
Everything that needs the VPS waits for this.

**C. YOURS (Supabase dashboard → SQL Editor): four pastes, in this order, each on its own.**
1. `server/supabase/029_second_lock.sql`. It only revokes, so it is safe to run twice.
2. `server/supabase/030_erp_access.sql`.
3. Then, **alone**, with the value copied from **`_secrets/og_vps.txt`**:
   `ALTER ROLE og_vps PASSWORD '<paste>';`. Clear the editor afterwards.
4. `server/supabase/031_till_status.sql`. Its last line prints `lineage_id` and `beat_at`.

Then `server/supabase/032_extra_accounts.sql` **step 1 only** (a `SELECT`) to see the 8 accounts,
and optionally step 2 (switch the three active ones off). Download the SSL certificate: Project
Settings → Database → **SSL**. It goes to the VPS in D.

**D. YOURS (Coolify), after B, C and item 6:** `DAY06-COOLIFY.md`. Both resources are built from
`night/online-offline`.

**E. YOURS (at the shop, PIA OFF): the one test that decides the route.** No install and no admin
needed:

```powershell
cd "D:\DESKTOP\OG System Demo"
powershell -ExecutionPolicy Bypass -File tools\wg-test\shop-verdict.ps1
```

Run it after item 14 (it is branch code), or now from any checkout of the branch.
- **WORKS:** go on.
- **UDP BLOCKED:** read `tools/wg-test/FALLBACK.md`; do not deploy the proxy yet.
- **VPS UNREACHABLE:** do B first.

It refuses while PIA is connected, on purpose.

---

## The list

1. **DONE TODAY: `_secrets/` and `_handover/` are ignored by git.** `_handover/` was already in
   `.gitignore`. `_secrets/` was not; it is now in the branch's `.gitignore` and in
   `.git/info/exclude`, which covers the live folder on `main` too.
2. **DONE TODAY: the VPS end of WireGuard.** `10.8.0.1`, UDP 51820, enabled at boot, the till's key
   as its one peer. See `DAY06-VPS-STEPS.md`.
3. **DONE TODAY: the handshake, proved through PIA.** `tools/wg-test/handshake.mjs`, a real
   WireGuard handshake from Node. The VPS's tcpdump showed the packets arriving before the peer
   existed and a 148 → 92 byte answer after. This proves PIA's path, **not** the shop's bare line;
   that is E.
4. **YOURS (administrator): WireGuard for Windows and the tunnel service.** This shell was not
   elevated. `net session` said so, although the brief said otherwise. In an **Administrator**
   PowerShell:

   ```powershell
   winget install --id WireGuard.WireGuard -e
   cd "D:\DESKTOP\OG System Demo"
   powershell -ExecutionPolicy Bypass -File tools\wg-test\till-side.ps1 -KeyFile "D:\DESKTOP\OG System Demo\_secrets\wg-till.key" -ServerPublicKey p3m2Hr3XweLmuD6qXhfs97NQ5o1HZvcqpNu0wx0NThc=
   ```

   - `-KeyFile` reuses the key the VPS already trusts. Without it the script would make a new key,
     and the VPS would not know it.
   - At home with PIA on, add `-AllowPia`.
   - The tunnel is split: `AllowedIPs 10.8.0.1/32` only, `PersistentKeepalive 25`, a service
     that starts at boot.
   - **Pass:** `WORKS - … answers in N ms`.
5. **BLOCKED (VPS dark, B): the till's certificate on the VPS, the `dig`, and the `curl` through
   the tunnel.** Commands and pass values are in `DAY06-VPS-STEPS.md` step 2.
6. **YOURS: leave ZeroTier**, network **`76fc96e49897c3c8`**, once item 4 says WORKS. It needs
   administrator:
   `& "C:\ProgramData\ZeroTier\One\zerotier-one_x64.exe" -q leave 76fc96e49897c3c8`.
   Rejoin from ZeroTier Central if ever wanted. Do not uninstall it.
7. **DONE TODAY: `supabase:check`'s two red columns were the check's own mistake.** `pw_box` and
   `last_login_at` are local-only by design (see the commit), and the check on the branch now
   knows it. No column is added to Supabase: a `pw_box` there would be one careless query away
   from a password list.
8. **YOURS: the 8 accounts in the mirror.**
   - Ids 1–5: `hussam`, `lubna`, `maher`, `talal`, `yalla`.
   - Id 6: `mirrortest`, **active**.
   - Id 7: `owner`, **active**.
   - Id 10: `zaren`, **active**.

   A restore would bring the three active ones back as working manager logins. The dry run
   re-points all eight to Former staff (#21). It writes to Supabase, which is your decision. From
   the shop laptop:

   ```bash
   cd server && npm run users:mirror                # dry run: it must list the same 8
   cd server && npm run users:mirror -- --apply
   cd server && npm run supabase:check              # with the branch's check: green
   ```

   Nothing was deleted today.
9. **DONE TODAY: two secrets generated.** `_secrets/og_vps.txt` is the `og_vps` database password
   (C.3, and the `OG_MIRROR_URL` in D). `_secrets/og_vps_api_key.txt` is og-bridge's key to the
   till (D, and `server/.env.next`).
10. **DONE TODAY: `server/.env.next` staged.** It is the live `.env` plus `OG_PROXY_ADDR=10.8.0.1`
    and `OG_VPS_API_KEY`. `OG_ORIGINS` already listed `https://shop.ogsports1.com`. The live
    `.env` was **not** touched.
11. **YOURS: enrol the owner for `/snapshot`.** No account was created today. Either:
    - **On the laptop (draws the QR)**, after item 14, from the repository root:
      `node vps/og-bridge/src/snapshot-user.js`.
    - **Or in the og-bridge container (no QR; the setup key is printed as text, and authenticator
      apps accept it typed in):**
      `docker exec -it $(docker ps -qf name=bridge) node src/snapshot-user.js`.

    Then:
    1. Pick the owner's snapshot username and a password of 12+ characters. It asks twice and does
       not echo.
    2. The owner scans the QR (or types the key) into Google Authenticator, Microsoft
       Authenticator or 2FAS on his phone.
    3. Paste the printed `OG_SNAPSHOT_USERS=[…]` line into og-bridge's environment in Coolify and
       redeploy.
    4. Clear the terminal (`cls` or `clear`): the secret is on it.
    5. **Pass:** `https://shop.ogsports1.com/snapshot` accepts the password plus the 6-digit code.
12. **YOURS (after closing, with a phone in hand): the laptop's firewall.** It was dry-run only
    today: 8443 from `10.8.0.1` on the tunnel, 8090 and 8443 from `10.10.99.0/24`, and the four
    blanket Node.js rules switched off (disabled, never deleted).

    ```powershell
    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1            # dry run
    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1 -Apply     # Administrator
    # at once, from a phone on the shop Wi-Fi: https://10.10.99.9:8443 must open. If not:
    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1 -Undo      # the one-line undo
    ```

    The dry run says whether this laptop's own Wi-Fi address is covered; it was, at 10.10.99.9.
13. **YOURS: trust the certificate on the till.** The panel's first Start asks for administrator
    once (night shift 05's new certificate). Or run `cd server; npm run cert:trust` yourself.
14. **YOURS (after closing): the new `.env`, on the branch.**
    1. In the window, press **Close the shop**.
    2. In the repository:

       ```powershell
       cd "D:\DESKTOP\OG System Demo"
       git status --short                 # must be empty
       git fetch; git switch night/online-offline
       powershell -ExecutionPolicy Bypass -File tools\tonight\apply.ps1 -Now
       ```

    3. **Pass:** it ends in `PASS`; then press **Open the shop**.

    `apply.ps1` refuses (exit 3, nothing changed):
    - outside 00:30–07:00 without `-Now`;
    - while the shop answers on its port;
    - after any sale, payment or stock write in 30 minutes;
    - if `.env` changed since `.env.next` was staged;
    - if the backup fails or does not match.

    On any failed check it puts the old `.env` back (exit 2). It saves the old file as
    `server\.env.bak-day06`.
15. **YOURS: the drill.** `tools/tonight/drill.md`, with PIA **off**. It includes the switch back
    to `main` if anything fails. The shop must open tomorrow on `main` unless all eight steps
    passed.
16. **YOURS, after the proxy works:** Settings → `shop.public_url` = `https://shop.ogsports1.com`.
