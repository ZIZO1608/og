@echo off
title OG System
REM  Double-click this instead of index.html.
REM  It serves the folder on 127.0.0.1 so the browser treats it as a secure
REM  context - which is what makes the camera, offline mode and
REM  install-to-phone work. Add -Lan to also reach it from your phone.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Lan
pause
