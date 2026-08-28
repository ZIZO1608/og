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
REM  anything to sell, and is the Supabase mirror wired up. It only ever
REM  PRINTS - it never blocks the start - because a broken mirror must not be
REM  able to stop the till taking cash. An empty users table used to show up
REM  only as "Wrong username or password" on every attempt, which reads as a
REM  broken login rather than an empty table; this is that afternoon, saved.
node scripts\preflight.js

REM  The server serves the app and the API, and - when server\.env has
REM  Supabase credentials - pushes the mirror on a timer while it runs. See
REM  server\lib\sync-worker.js. Nothing else has to be started or remembered.
node index.js

REM  Only reached if the server stopped. Hold the window so the error above
REM  can actually be read instead of vanishing with the console.
echo.
echo   The server has stopped.
pause
