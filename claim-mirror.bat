@echo off
setlocal
title OG System - make THIS computer the one Supabase copies
color 0A

REM ===========================================================================
REM  OG SYSTEM - claim the Supabase mirror for this computer
REM ---------------------------------------------------------------------------
REM  One Supabase project can only be the copy of ONE database. Two computers
REM  running the same .env against it do not share it - they fight over it,
REM  and each one's run deletes the other's sales (2026-08-30, 2026-09-03).
REM  So the sync now REFUSES to run until one computer claims the project.
REM
REM  This file makes that claim for THIS computer, then does the three things
REM  that put the whole shop back into the mirror:
REM
REM    1. sync      - with OG_SYNC_TAKEOVER=1, which writes this database's id
REM                   into the mirror. From now on the other computer is the
REM                   one refused, not this one.
REM    2. reconcile - pushes every row the sync's bookmarks are already past.
REM                   The ordinary sync will never look at those again.
REM    3. check     - proves it: every table row for row, or a red line
REM                   that names what is still wrong.
REM
REM  Run it ONCE, on the computer that is the shop. After that the server's
REM  own live push does the job by itself; you never need this again.
REM
REM  If the OTHER computer is the shop, do not run this here. Put
REM  OG_SYNC_MINUTES=0 in this computer's server\.env instead.
REM ===========================================================================

cd /d "%~dp0server"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node is not installed, or not on the PATH.
  echo   Get it from https://nodejs.org  - the LTS version.
  echo.
  pause & exit /b 1
)

if not exist ".env" (
  echo.
  echo   server\.env is missing - there are no Supabase keys to use.
  echo   You are probably in the wrong folder.
  echo.
  pause & exit /b 1
)

echo.
echo   ============================================
echo     OG SYSTEM  -  claiming the mirror
echo   ============================================
echo.
echo   This makes THIS computer the one Supabase copies.
echo   Any other computer using the same keys will be refused
echo   from its next run.
echo.
echo   Press any key to go. Close this window to stop.
echo.
pause >nul

REM --- 1. claim + sync ----------------------------------------------------------
echo.
echo   [1/3] Claiming the mirror and syncing...
echo.
set OG_SYNC_TAKEOVER=1
call npm run --silent supabase:sync
if errorlevel 1 (
  echo.
  echo   ------------------------------------------------------------
  echo    STOPPED - the sync did not finish. The lines above say why.
  echo   ------------------------------------------------------------
  echo.
  echo    Usually it is no internet, or a wrong key in server\.env.
  echo    Nothing on this computer was changed. Run this again once
  echo    the reason above is fixed.
  echo.
  pause & exit /b 1
)
set OG_SYNC_TAKEOVER=

REM --- 2. reconcile ---------------------------------------------------------------
echo.
echo   [2/3] Pushing the rows the bookmarks had already passed...
echo.
call npm run --silent supabase:reconcile
if errorlevel 1 (
  echo.
  echo   ------------------------------------------------------------
  echo    STOPPED - reconcile did not finish. The lines above say why.
  echo   ------------------------------------------------------------
  echo.
  echo    The claim in step 1 DID land, so the live sync will
  echo    now run. Run this file again to retry the reconcile.
  echo.
  pause & exit /b 1
)

REM --- 3. check ---------------------------------------------------------------------
echo.
echo   [3/3] Checking the mirror against this database...
echo.
call npm run --silent supabase:check
if errorlevel 1 (
  echo.
  echo   ------------------------------------------------------------
  echo    The mirror is not a faithful copy yet - see the red lines.
  echo   ------------------------------------------------------------
  echo.
  echo    Two accounts pushed by the other computer (Ahmad,
  echo    httptest-cash) are the usual leftover. No script deletes
  echo    an account: remove them in Supabase, Table Editor, users.
  echo.
  pause & exit /b 1
)

echo.
echo   ============================================
echo     Done. The mirror is a faithful copy.
echo   ============================================
echo.
echo   From now on the server pushes every change within seconds
echo   on its own. You do not need to run this again.
echo.
echo   If the server is open in another window, restart it once so
echo   it stops printing "update failed (exit 2)".
echo.
pause
