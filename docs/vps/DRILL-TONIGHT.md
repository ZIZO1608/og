# The outage drill — tonight, on `main`

What it proves: when the shop's internet goes, the till keeps selling. The public address says
so honestly instead of breaking. When the line comes back, everything catches up with no hands on
the keyboard.

Written for `main` as it is on 22 Sep 2026 (day shift 07). The till runs `main`, and the VPS proxy
is built from `main` (Coolify redeploys it on every push to `main`).

About 35 minutes. You need the till, one phone on the shop Wi-Fi, and one phone on **mobile
data**. Pick a quiet moment: the sales you make are real.

## Before you start (5 min)

1. **PIA OFF on the till.** The shop runs without it, and the drill must test the shop's own line.
   - Pass: the PIA icon says Disconnected.
2. **The till is open**: the OG System window's Shop screen shows the lime ring.
   - Pass: on the till, `https://localhost:8443` shows the sign-in.
3. **The tunnel is up.** In PowerShell on the till: `ping 10.8.0.1`.
   - Pass: 4 replies.
4. **The mirror is clean before you begin.** In PowerShell:

   ```powershell
   cd "D:\DESKTOP\OG System\server"
   npm.cmd run supabase:check
   ```

   - Pass: it ends in `Connected, and the mirror matches the shop.`
   - If it is red now, stop. The drill would prove nothing.
5. **The public address works.** On the phone on mobile data, open `https://shop.ogsports1.com`.
   - Pass: the OG sign-in screen, with no certificate warning.
6. **Write down the time** and the number of the last invoice (Reports → Sales, or the till's
   last receipt).

## The outage (15 min)

7. **Pull the internet cable out of the router: the WAN/internet port, not the power.** The
   router stays ON, so the shop Wi-Fi keeps working with no internet behind it. Write down the
   time.
   - Do **not** unplug the till or turn off its Wi-Fi.
8. **Sell on the till.** Ring up one real sale in cash, and print the receipt.
   - Pass: the sale completes and the receipt prints, exactly as on a normal day.
9. **Sell on the phone on the shop Wi-Fi.** Open `https://10.10.99.9:8443`, sign in, and ring up
   a second sale.
   - Pass: the sale completes.
   - Write down both invoice numbers.
10. **Look at the sync dot** (the cloud icon in the till's top bar).
    - Pass: amber or red with rows waiting. That is correct: it cannot reach Supabase and says so.
    - After 15 minutes of this, the bell may also add a "mirror" line. That is correct too.
11. **The phone on mobile data**: reload `https://shop.ogsports1.com`.
    - Pass, within about 5 seconds: the dark page reading **"The shop's internet is down"**, in
      Arabic above English.
    - Fail: a white error page, a certificate warning, or spinning for more than 30 seconds.
12. **Wait until 15 minutes have passed since step 7.** Nothing else to do. The till keeps selling
    the whole time.

## Plug back in (10 min)

13. **Plug the cable back into the router.** Write down the time.
14. **The tunnel comes back by itself.** On the till: `ping 10.8.0.1`.
    - Pass: replies within 2 minutes of plugging in. WireGuard retries every 25 seconds.
15. **The sync dot turns green** without anyone pressing anything.
    - Pass: green within **5 minutes** of step 13. After an outage the mirror retries at most every
      5 minutes.
    - If it is still amber at 6 minutes, press the sync icon once, and write down that you had to.
16. **The domain works again.** On the phone on mobile data, reload `https://shop.ogsports1.com`.
    - Pass: the sign-in screen, not the down page.
17. **The mirror is a faithful copy again:**

    ```powershell
    cd "D:\DESKTOP\OG System\server"
    npm.cmd run supabase:check
    ```

    - Pass: `Connected, and the mirror matches the shop.` It compares every table row by row,
      `sales` included, so a missing outage sale would turn it red and name the table.
18. **See the two outage sales in Supabase with your own eyes.** Supabase dashboard → Table
    Editor → `sales` → sort by `at`, newest first.
    - Pass: both invoice numbers from step 9 are there, with the right totals.

**The drill passes if every step from 8 to 18 passed.** Write down each time and any step that
needed a hand.

## Not in tonight's drill: these need the branch `night/online-offline`

These are built but not on `main`, so tonight they either do not exist or do not answer. Do not
test them tonight:
- the owner's `/snapshot` page, which is served by og-bridge when the shop is down;
- the till's heartbeat to Supabase, which lets the VPS tell "shop closed" from "shop's line down";
- og-bridge and the VPS's own `/api/vps/` door (on `main` that path answers 404 from outside, on
  purpose);
- `tools/tonight/apply.ps1` and the firewall script.

The full drill with those is `tools/tonight/drill.md` on the branch, after it is merged.

## If something fails

- **The till could not sell during the outage.** That is the serious one. Plug the cable back in,
  keep selling, and write down exactly what the screen said.
- **The down page did not appear (step 11).** In Coolify, open the proxy resource → Logs, and copy
  the last 50 lines.
- **Sync stayed amber (step 15) or the check is red (step 17).** Run
  `npm.cmd run supabase:check` again after 5 minutes. If it is still red, keep the output. Nothing
  is lost: the rows wait on the till, and `npm.cmd run supabase:reconcile` is the repair.
