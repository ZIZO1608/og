@echo off
title OG System
REM ===========================================================================
REM  Double-click this to run the real system.
REM
REM  It starts the server in server\, which serves BOTH the app and the API
REM  from one address. That is what makes logins work and sales get saved.
REM
REM  This used to launch serve.ps1, which only serves the files - no accounts,
REM  no saving, the DEMO bar across the top. serve.ps1 is still there for
REM  showing the app to someone with no server, but it is not this.
REM
REM  Leave this window open. Closing it stops the shop.
REM ===========================================================================

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node is not installed, or not on the PATH.
  echo   Get it from https://nodejs.org  - the LTS version.
  echo.
  pause
  exit /b 1
)

REM  node:sqlite arrived in 22.5. On anything older the server dies with an
REM  import error that reads like a broken install, so say the real reason.
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
  echo.
  echo   Node %NODEMAJOR% is too old. This needs Node 22.5 or newer,
  echo   because the database is built into Node itself from that version.
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0server"

REM  A readiness report before the shop opens: can anyone sign in, is there
REM  anything to sell, is the Supabase mirror wired up, and is the port free.
REM
REM  It only PRINTS - a broken mirror must never stop the till taking cash.
REM  The one exception is the port, where the server genuinely cannot start;
REM  that exits 2 and is handled below.
REM
REM  An empty users table used to show up only as "Wrong username or
REM  password" on every attempt, which reads as a broken login rather than
REM  an empty table. That afternoon is what this saves.
node scripts\preflight.js

REM  IMPORTANT: `if errorlevel N` means "N or more", so these must be tested
REM  highest first. Written the other way round, exit 3 would match the
REM  errorlevel 2 branch and the "already open" case would be reported as a
REM  failure - which is the exact bug this replaced.

REM  Exit 3: the port is held by THIS server, already running and already
REM  serving the shop. That is not a failure, it is a double-click. Open the
REM  app rather than telling somebody their shop is down when it is not.
if errorlevel 3 (
  echo.
  echo   The shop is already open. Opening it in your browser...
  echo.
  start "" "http://localhost:8090"
  timeout /t 3 >nul
  exit /b 0
)

REM  Exit 2: something ELSE holds the port and the server genuinely cannot
REM  start. Node answers that with a stack trace that never names the window
REM  you need to close, so stop here with the message preflight just printed
REM  rather than letting it throw.
if errorlevel 2 (
  echo.
  echo   Not starting - see above.
  echo.
  pause
  exit /b 1
)

REM ===========================================================================
REM  THE TILL'S HARDWARE: the receipt printer, the label printer, the scanner.
REM
REM  The scanner has no driver - it announces itself as a keyboard and Windows
REM  fits its own in seconds. The two printers do, and it is NOT the driver on
REM  the box: they are sent bytes they already understand (ESC/POS, TSPL) and
REM  the manufacturer's driver reformats those into pages of gibberish. What
REM  they need is the "Generic / Text Only" driver built into Windows, behind
REM  a shared queue. server\scripts\hardware.js explains the whole thing.
REM
REM  This runs AFTER the port check on purpose: on a double-click while the
REM  shop is already open, nothing here should run at all.
REM ===========================================================================
node scripts\hardware.js

REM  Same rule as above - `if errorlevel N` means "N or more", so highest
REM  first. Exit 4: something is missing that can be installed from here. Do
REM  it, then ASK AGAIN rather than assuming it worked.
if errorlevel 4 (
  echo.
  echo   Setting up the printers. This may ask for permission.
  echo.
  node scripts\hardware.js --install
  echo.
  echo   Checking again...
  node scripts\hardware.js
)

REM  Anything still wrong needs a person: a printer to plug in, switch on, or
REM  a choice this must not make on somebody's behalf.
REM
REM  It does NOT stop here. A shop that cannot print a receipt can still sell
REM  shoes, and a launcher that refuses to open the till over a printer that
REM  is merely switched off has taken the day's takings hostage over a piece
REM  of paper. So: say it, leave it on screen long enough to be read, and open
REM  the shop. `timeout` rather than `pause` because nobody may be standing
REM  there, and an unattended morning must still end with a working till.
if errorlevel 1 (
  echo.
  echo   The shop still opens and still takes money - it is the PRINTING that
  echo   will not work until the above is sorted out.
  echo.
  echo   Press a key to carry on, or wait.
  timeout /t 15
)

REM  The server serves the app and the API, and - when server\.env has
REM  Supabase credentials - pushes the mirror on a timer while it runs. See
REM  server\lib\sync-worker.js. Nothing else has to be started or remembered.
node index.js

REM  Only reached if the server stopped. Hold the window so the error above
REM  can actually be read instead of vanishing with the console.
echo.
echo   The server has stopped.
pause
