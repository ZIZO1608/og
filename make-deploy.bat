@echo off
REM  Double-click this. It builds dist\ with only the real app inside,
REM  then opens the folder ready to drag onto GitHub.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-deploy.ps1"
if exist "%~dp0dist" start "" "%~dp0dist"
pause
