# The outage drill: the shop sells with its internet down, and the world is told the truth

About 45 minutes, **after closing**, at the shop. You need:
- somebody at the till;
- a phone on **mobile data** (not the shop Wi-Fi: from the Wi-Fi you reach the laptop directly
  and prove nothing);
- **PIA OFF** on the laptop. The shop does not run PIA; the drill tests the shop's own line. With
  PIA on, pulling the cable kills PIA too and the result is about PIA.

Before it: docs/vps/TONIGHT.md's steps up to the drill are done:
- the WireGuard verdict says WORKS;
- the tunnel service is installed;
- Supabase 029–031 are run;
- og-bridge and shop-proxy are deployed from `night/online-offline`;
- the owner is enrolled;
- `npm run users:mirror -- --apply` has run, otherwise step 8 cannot go green.

## 0. Put the till on the branch (it needs the branch's code)

The amber "internet is down" screen, the VPS's door and the write queue are branch code; `main`
has none of them.

1. In the OG System window, press **Close the shop**.
2. In the repository:

   ```powershell
   cd "D:\DESKTOP\OG System"
   git status --short          # must print nothing (Publish anything first)
   git fetch
   git switch night/online-offline
   git log --oneline -1        # the branch's newest commit
   ```

3. If `tools\tonight\apply.ps1` has not run yet tonight, run it now (docs/vps/TONIGHT.md explains it):

   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\tonight\apply.ps1 -Now
   ```

   **Pass:** it ends with `PASS`.
4. Press **Open the shop** in the window.

**Pass for step 0:** the Shop screen goes green and names the Wi-Fi address. On the phone (mobile
data), `https://shop.ogsports1.com` shows the sign-in with a padlock.

## The eight steps

1. **Before.** On the phone, sign in at `https://shop.ogsports1.com` and open
   `https://shop.ogsports1.com/snapshot`. Note today's takings. On the laptop, run
   `cd server; npm run supabase:check`.
   **Pass:** the check exits 0. Only if the 8 accounts are already gone; see docs/vps/TONIGHT.md.
2. **Pull the cable.** Unplug the shop router's **internet** (WAN) cable, not its power: the Wi-Fi
   must stay up. Start a 15-minute timer.
3. **The till keeps selling.** Ring up one real small sale in cash, or a test product you void
   afterwards.
   **Pass:** the receipt prints, the sale is in Invoices, and nothing on the till says it is
   offline.
4. **Outside says the internet is down.** On the phone (mobile data), reload
   `https://shop.ogsports1.com`.
   **Pass:** the amber **"The shop's internet is down"** screen with a link to the snapshot. On a
   phone with nothing cached, the proxy's bilingual page with the same words. Not "the server is
   not answering", and not a browser error.
5. **The snapshot shows the right numbers, with their age.** Open `/snapshot` on the phone.
   **Pass:** step 1's figures, without step 3's sale, and a line that keeps growing, e.g. "Last
   synced 14:02 — 6 min ago". It must not claim to be live.
6. **Reconnect** after 15 minutes: plug the WAN cable back in.
7. **The mirror catches up** within about a minute.
   **Pass:**
   - the window's Connections card shows the cloud copy green, and Settings → Mirror shows no
     rows waiting;
   - `/snapshot` says **"The shop is online"** with Open the shop, and its figures include step
     3's sale, synced "just now";
   - `https://shop.ogsports1.com` shows the app again after a reload.
8. **The check is green.** Run `cd server; npm run supabase:check`.
   **Pass:** exit 0, and every table matches by primary key.

## Afterwards

**All eight pass:**
1. Merge `night/online-offline` into `main` on GitHub.
2. On the laptop: Close the shop, then run `git switch main; git pull`, then Open the shop.
3. In Coolify, set **Branch** to `main` on og-bridge and shop-proxy, and redeploy both.

**Any step fails:** write down the step and exactly what the screen said, then switch back.
**The shop must be back on `main` before it opens tomorrow:**

1. In the OG System window, press **Close the shop**.
2. Switch the code back:

   ```powershell
   cd "D:\DESKTOP\OG System"
   git switch main
   ```

3. Press **Open the shop**.

The `.env` from `apply.ps1` is harmless on `main`:
- main does not read `OG_VPS_API_KEY`;
- `OG_PROXY_ADDR=10.8.0.1` only means "believe the visitor header from the tunnel's end", which
  main honours correctly.

To take the `.env` back as well:

```powershell
copy server\.env.bak-day06 server\.env
```
