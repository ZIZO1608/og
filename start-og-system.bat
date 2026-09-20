@echo off
REM ===========================================================================
REM  Starts the OG System control panel on this machine.
REM
REM  It used to start "OG System.exe", which lived beside this file. That .exe
REM  is no longer committed: the repository is deployed from GitHub as a
REM  container now, and a 66 KB Windows binary in the image (and in every
REM  clone) is weight nothing on a server can run. panel/build-exe.ps1 still
REM  builds it from panel/launcher/OGSystem.cs if the shop wants the tray icon
REM  back on its own laptop:
REM
REM      powershell -ExecutionPolicy Bypass -File panel/build-exe.ps1
REM
REM  This file is kept for one reason: the shop laptop has a desktop icon and a
REM  pinned taskbar entry pointing HERE, and deleting it would end with
REM  somebody standing in front of a till on a Monday morning with nothing to
REM  double-click. It starts the panel directly, which is what the .exe did.
REM ===========================================================================
cd /d "%~dp0"
start "OG System" node panel/panel.js
