# OG System — publishing to GitHub Pages

Live site: **https://zizo1608.github.io/og/** · Repo: `ZIZO1608/og` · Passcode: `OG2026`

---

## One-time setup (about 5 minutes)

### 1. Install GitHub Desktop

Download from **https://desktop.github.com** and sign in with your GitHub account.

### 2. Clone the repo

In GitHub Desktop: **File → Clone repository → GitHub.com**, pick **`ZIZO1608/og`**, click
**Clone**. It will suggest a folder like `C:\Users\ZIZO\Documents\GitHub\og`.

### 3. Tell the build script where that folder is

Open **`make-push.bat`** in Notepad. The fourth-from-top line reads:

```
set CLONE=C:\Users\ZIZO\Documents\GitHub\og
```

If GitHub Desktop cloned somewhere else, change that path. To find it:
**Repository → Show in Explorer**, then copy the path from the address bar.

Save and close. That is the setup done — you never touch it again.

---

## Every update after that (about 30 seconds)

1. **Double-click `make-push.bat`.** It rebuilds the app straight into your clone and opens
   GitHub Desktop.
2. GitHub Desktop lists **every file that changed** down the left. You do not have to know
   which ones — that is the whole point of using it.
3. Type a short summary in the bottom-left box, e.g. `mobile tab bar`.
4. Click **Commit to main**.
5. Click **Push origin** at the top.
6. Wait about a minute, then open the site and press **Ctrl+Shift+R** to hard-refresh.

---

## The two things that actually go wrong

### The site looks unchanged after pushing

Almost always the **service worker cache**. The app is cache-first so it can work offline, which
means a phone or browser that has visited before keeps serving the files it already has —
regardless of what you upload.

The fix is to change `CACHE` in `sw.js` (`og-system-v5` → `v6`). **I bump this automatically**
whenever the shipped files change, so normally you do not have to think about it. `make-push.bat`
prints the current cache name after every build so you can see it went up.

To force a refresh on a device that is already stuck: Ctrl+Shift+R on desktop, or on a phone
close the tab completely and reopen it.

### Half the app is missing

This happened twice with the old drag-and-drop method: the `assets`, `css` and `js` folders went
up but the loose root files — `index.html`, `sw.js`, `manifest.webmanifest` — did not. The site
then runs at about half strength with no errors, because the new code is all behind safety
checks. GitHub Desktop makes this impossible, since it diffs the whole folder for you.

If you ever suspect it, ask me — I can read the live files straight from GitHub and tell you
exactly which ones are stale.

---

## What the build does

`make-push.bat` runs `make-deploy.ps1`, which copies only the real application:

```
index.html  manifest.webmanifest  sw.js  robots.txt  .nojekyll
css\  js\  assets\
```

Anything whose name starts with `_` is stripped, so the test harnesses
(`_selftest.html`, `_mobile.html`, `_shot.html`, `_connect.html`, `_stagea.html`) can never
reach the live site.

**It will never delete your `.git` folder.** The script only removes the specific files it
publishes, and refuses to run at all if the target folder contains anything it does not
recognise — because deleting the wrong directory is not recoverable.

`.nojekyll` matters: without it GitHub runs Jekyll, which silently deletes files beginning with
an underscore. Windows hides dotfiles in Explorer, but GitHub Desktop shows them.

---

## Building without pushing

`.\make-deploy.ps1` on its own still builds into `dist\` exactly as before, if you want to
inspect the output or upload by hand.

Double-clicking `index.html` also still works for a quick look. You lose only the camera,
install-to-phone and offline mode — everything else is identical.

---

## Changing the passcode

`js/gate.js`:

```js
var PASSCODE = 'OG2026';
```

Then rebuild and push.

**Be clear-eyed about what this is.** Everything runs in the browser, so the passcode is
readable by anyone who opens developer tools, and on a free account the repo is public anyway.
It keeps casual visitors and search engines out of an unreleased demo. It is not security, and it
must not be treated as such once real customer data is involved — that needs a real backend with
a real login, and this gate deleted.
