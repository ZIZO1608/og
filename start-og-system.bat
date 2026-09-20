@echo off
REM ===========================================================================
REM  The shop laptop has a desktop icon and a pinned taskbar entry pointing
REM  HERE, so this file stays whatever the launcher is called. It does no work
REM  of its own: "OG System.exe" starts the shop, opens the panel and sits in
REM  the tray, and everything the old .bat used to do -- the port check, the
REM  certificate check, the printer check, opening the browser -- is in the
REM  panel now, with a Stop button and a log you can scroll.
REM
REM  The fallback is for a fresh clone: the .exe is committed, but if it is
REM  ever missing, panel\panel.js IS the panel and runs on plain node.
REM  Rebuild the launcher with:
REM      powershell -ExecutionPolicy Bypass -File panel\build-exe.ps1
REM ===========================================================================
cd /d "%~dp0"
if exist "OG System.exe" (
  start "" "OG System.exe"
) else (
  echo   "OG System.exe" is not here - starting the panel with node instead.
  echo   Rebuild it with: powershell -ExecutionPolicy Bypass -File panel\build-exe.ps1
  start "OG System" node panel/panel.js
)
