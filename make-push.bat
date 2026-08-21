@echo off
title OG System - build for GitHub
REM ===========================================================================
REM  Builds the app straight into your local clone of the GitHub repo, so
REM  GitHub Desktop can see the changes and you can commit + push.
REM
REM  ---------------------------------------------------------------------
REM  SET THIS ONE LINE to wherever GitHub Desktop cloned the repo.
REM  In GitHub Desktop:  Repository menu  >  Show in Explorer
REM  Then copy the folder path from the address bar and paste it below.
REM  ---------------------------------------------------------------------
set CLONE=C:\Users\ZIZO\Documents\GitHub\og
REM ===========================================================================

if not exist "%CLONE%" (
  echo.
  echo   Cannot find the clone folder:
  echo     %CLONE%
  echo.
  echo   Open make-push.bat in Notepad and fix the CLONE line at the top.
  echo   In GitHub Desktop: Repository ^> Show in Explorer, then copy the path.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-deploy.ps1" -Out "%CLONE%"
if errorlevel 1 (
  echo.
  echo   Build stopped. Nothing was changed in the clone.
  pause
  exit /b 1
)

REM Open GitHub Desktop on that repo if it is installed; harmless if not.
start "" "github-windows://openRepo/https://github.com/ZIZO1608/og" 2>nul

echo.
echo   Now switch to GitHub Desktop, write a short summary,
echo   click "Commit to main", then "Push origin".
echo.
pause
