# Tonight — after day shifts 06, 06b and 07 (22 Sep 2026)

For Ahmad. It replaces `MORNING.md`. Every item is marked:
- **DONE TODAY**;
- **YOURS**, with why;
- **BLOCKED**, with why.

Branch `night/online-offline`, pushed, **not merged**. The live folder stays on `main` until
item 14. Secrets live in `D:\DESKTOP\OG System\_secrets\` (git-ignored); this page names
files, never values.

## Day shift 07 — what changed

- **DONE: `shop.ogsports1.com` is live.** A phone on mobile data reaches the till through the
  VPS nginx, then WireGuard. The proxy is the Coolify resource built from **`main`**
  (`deploy/shop-proxy`, 52dc392), not from this branch. The owner verified it, and the day
  shift checked it again from the VPS:
  - `/api/health` returns the till's own answer;
  - `/api/vps/health` answers 404 from outside;
  - Let's Encrypt `YR2`, valid to 21 Dec 2026;
  - the pinned certificate shows `DNS:og-till` and `IP Address:10.8.0.2`;
  - no errors in the proxy's log.
  **A push to `main` redeploys that proxy.**
- **DONE: the tunnel works on the shop's own line, PIA off.** Owner: `ping 10.8.0.1` 11/11, about
  53 ms. That settles E.
- **DONE: Supabase works on the shop's own line, PIA off.** `supabase:check` matched 57 tables row
  for row. It was 58 after the next item.
- **DONE: the 8 ghost accounts are gone from the mirror.** Owner:
  `npm --prefix server run users:mirror -- --apply`. It removed exactly 8 and moved 0 references.
  There are 13 accounts on both sides. That settles item 8 and `032`.
- **DONE: the checker fix is on `main`** (06d893a, from 096a66b). `supabase:check` on main is fully
  green: 58 tables, 13 accounts.
- **DONE, NOT IN EFFECT: `OG_PROXY_ADDR=10.8.0.1` is in the live `server/.env`.** It is the only
  line added. The old file is `server/.env.bak-proxy`.
  - It takes effect at the next **Stop → Start** in the panel. Until then, every outside visitor is
    10.8.0.1 to the till, sharing one 20-failure sign-in limit.
  - It was proved first on a sandbox from the VPS through the tunnel (details in `main`'s
    CLAUDE.md, Day shift 07).
  - `.env.next` still passes `apply.ps1`'s staging check: it now adds only `OG_VPS_API_KEY`.
- **DONE: `DRILL-TONIGHT.md` on `main`** is the outage drill for main as it is. The full drill below
  (item 15) waits for this branch.

## Only you can do these (consoles the day shift cannot reach)

**C. YOURS (Supabase dashboard → SQL Editor): four pastes, in this order, each on its own.**
1. `server/supabase/029_second_lock.sql`. It only revokes, so it is safe to run twice.
2. `server/supabase/030_erp_access.sql`.
3. Then, **alone**, with the value copied from **`_secrets/og_vps.txt`**:
   `ALTER ROLE og_vps PASSWORD '<paste>';`. Clear the editor afterwards.
4. `server/supabase/031_till_status.sql`. Its last line prints `lineage_id` and `beat_at`.

~~Then `server/supabase/032_extra_accounts.sql`~~ **Not needed: the 8 accounts were removed (day shift 07).** ~~**step 1 only** (a `SELECT`) to see the 8 accounts,
and optionally step 2 (switch the three active ones off).~~ Download the SSL certificate: Project
Settings → Database → **SSL**. It goes to the VPS in D.

**D. YOURS (Coolify), after C:** `DAY06-COOLIFY.md`, **og-bridge only**, which is built from
`night/online-offline`. The shop-proxy half is DONE (day shift 07); it is built from `main`, which
now carries the same `deploy/shop-proxy`. Do not switch the proxy to the branch.

**E. DONE (day shift 07, the owner): the tunnel answers on the shop line with PIA off** (ping
10.8.0.1 11/11). The verdict script below is no longer needed; it is kept for a new line or ISP.

~~The one test that decides the route.~~ No install and no admin
needed:

```powershell
cd "D:\DESKTOP\OG System"
powershell -ExecutionPolicy Bypass -File tools\wg-test\shop-verdict.ps1
```

Run it after item 14 (it is branch code), or now from any checkout of the branch.
- **WORKS:** go on.
- **UDP BLOCKED:** read `tools/wg-test/FALLBACK.md`; do not deploy the proxy yet.
- **VPS UNREACHABLE:** the VPS answered through PIA today, so look at the VPS in hPanel.

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
4. **DONE (06b): WireGuard for Windows and the tunnel service.**
   - WireGuard 1.1.1 from winget: winget checked the installer's hash, and the Authenticode
     signature (`WireGuard LLC`) is valid.
   - Tunnel `og-shop`: `10.8.0.2/24`, `AllowedIPs 10.8.0.1/32` only, `PersistentKeepalive 25`,
     with the key from `_secrets/wg-till.key`.
   - Service `WireGuardTunnel$og-shop`: running, starts automatically at boot.
   - `till-side.ps1 -AllowPia` said `WORKS - 10.8.0.1 answers in 55 ms (4/4)`.
   - Two script bugs were fixed on the way (CLAUDE.md, Day shift 06b).
   - To remove the tunnel: `till-side.ps1 -Remove` (administrator).
5. **DONE (06b): the tunnel proved from the VPS end, the certificate copied, the `dig` done.**
   - `curl -sk https://10.8.0.2:8443/api/health` on the VPS returns the till's own answer
     (`"shop":"OG Sports"`).
   - `/data/og/till.pem` on the VPS: the sha256 is `9dd18412…5fe0` on both sides, and
     `openssl x509 -checkhost og-till` matches.
   - A curl that trusts only that certificate
     (`--cacert /data/og/till.pem --resolve og-till:8443:10.8.0.2`) gets the same answer. That is
     what nginx will do.
   - `dig +short shop.ogsports1.com A` gives `152.239.114.129`, from the VPS and from 1.1.1.1.
   - All of this went through PIA. The shop's bare line is still E.
6. **DONE (06b): left ZeroTier network `76fc96e49897c3c8`** ("og vps", was 10.132.90.237), after
   item 5 passed.
   - ZeroTier stays installed and its service keeps running, with no networks.
   - To rejoin (administrator): `zerotier-one_x64.exe -q join 76fc96e49897c3c8`, or from ZeroTier
     Central.
7. **DONE TODAY, and on `main` since day shift 07 (06d893a): `supabase:check`'s two red columns were the check's own mistake.** `pw_box` and
   `last_login_at` are local-only by design (see the commit), and the check on the branch now
   knows it. No column is added to Supabase: a `pw_box` there would be one careless query away
   from a password list.
8. **DONE (day shift 07, the owner): the 8 accounts in the mirror.** `users:mirror -- --apply`
   removed exactly 8 (0 references moved); 13 accounts on both sides. What it was:
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
10. **DONE TODAY: `server/.env.next` staged.** **Since day shift 07 the live `.env` already has `OG_PROXY_ADDR=10.8.0.1`, so `.env.next` now adds only `OG_VPS_API_KEY`; the staging check was re-run and still passes (0 lines lost).** It is the live `.env` plus `OG_PROXY_ADDR=10.8.0.1`
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
       cd "D:\DESKTOP\OG System"
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
16. **YOURS, now (the proxy works):** Settings → `shop.public_url` = `https://shop.ogsports1.com`.
