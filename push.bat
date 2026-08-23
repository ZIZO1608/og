@echo off
setlocal enabledelayedexpansion
title OG System - send my work to GitHub
color 0A

REM ===========================================================================
REM  OG SYSTEM - one double-click to publish
REM ---------------------------------------------------------------------------
REM  Does four things, in this order, and stops at the first one that fails:
REM
REM    1. add     - notice every file you changed
REM    2. commit  - save them together under a short description
REM    3. pull    - bring in whatever your partner pushed while you worked
REM    4. push    - send yours up
REM
REM  Step 3 is the one that matters with two people. Without it, `push` is
REM  rejected the moment the other person has pushed anything, and the usual
REM  reaction to that rejection is to force it - which deletes their work.
REM  Pulling with --rebase replays your commit on top of theirs instead, so
REM  both survive.
REM
REM  Once this finishes, GitHub runs the tests and updates the live site by
REM  itself. There is nothing else to click.
REM ===========================================================================

cd /d "%~dp0"

REM --- find git ---------------------------------------------------------------
set GIT=git
where git >nul 2>nul || set GIT="C:\Program Files\Git\cmd\git.exe"
%GIT% --version >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Git is not installed, or Windows cannot find it.
  echo   Install it from https://git-scm.com/download/win and try again.
  echo.
  pause & exit /b 1
)

if not exist ".git" (
  echo.
  echo   This folder is not connected to GitHub yet.
  echo   You are probably in the wrong folder.
  echo.
  pause & exit /b 1
)

echo.
echo   ============================================
echo     OG SYSTEM  -  publishing to GitHub
echo   ============================================
echo.

REM --- what changed -----------------------------------------------------------
%GIT% add -A
%GIT% diff --cached --quiet
if not errorlevel 1 (
  echo   No changes to save.
  echo   Checking whether anything needs pushing anyway...
  echo.
  goto :sync
)

echo   Files you changed:
echo.
for /f "tokens=*" %%f in ('%GIT% diff --cached --name-status') do echo      %%f
echo.

REM --- describe it ------------------------------------------------------------
set "MSG="
set /p MSG="  Describe what you did (or press Enter): "
if "!MSG!"=="" set "MSG=Update"

%GIT% commit -m "!MSG!" >nul
if errorlevel 1 (
  echo.
  echo   Could not save the changes. The message above says why.
  echo.
  pause & exit /b 1
)
echo.
echo   [1/2] Saved locally.

REM --- bring in your partner's work, then send yours --------------------------
:sync
echo   [2/2] Syncing with GitHub...
echo.

%GIT% pull --rebase --autostash
if errorlevel 1 (
  echo.
  echo   ------------------------------------------------------------
  echo    STOPPED - you and your partner changed the same lines.
  echo   ------------------------------------------------------------
  echo.
  echo    Your work is NOT lost. It is saved on this computer.
  echo    Nothing has been sent to GitHub and nothing was overwritten.
  echo.
  echo    Undoing the half-finished merge so the folder is usable again...
  %GIT% rebase --abort >nul 2>nul
  echo    Done.
  echo.
  echo    Ask before running anything else - especially anything
  echo    with the word "force" in it. That is what deletes work.
  echo.
  pause & exit /b 1
)

%GIT% push
if errorlevel 1 (
  echo.
  echo   Could not reach GitHub. Usually this is either:
  echo     - no internet, or
  echo     - you have not signed in to git on this computer yet.
  echo.
  echo   Your work is saved locally either way. Run this again once
  echo   you are back online.
  echo.
  pause & exit /b 1
)

REM --- report ------------------------------------------------------------------
for /f "tokens=*" %%c in ('%GIT% log -1 --pretty^=format:%%h') do set SHA=%%c

echo.
echo   ============================================
echo     Sent.  commit !SHA!
echo   ============================================
echo.
echo   Sent. GitHub is rebuilding:
echo.
echo     https://github.com/ZIZO1608/og/actions
echo.
echo   Nothing tests your change before it goes out - the automated
echo   checks were removed, so please try it yourself first.
echo.
echo   The repository is private, so the old github.io demo link no
echo   longer publishes. Run the app yourself instead:
echo.
echo     cd server
echo     npm start          then open http://localhost:8090
echo.
pause
