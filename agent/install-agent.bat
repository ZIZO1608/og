@echo off
setlocal

set TASK_NAME=OGLabelAgent
set SCRIPT_DIR=%~dp0

echo.
echo   OG SYSTEM -- label print agent setup
echo   ------------------------------------
echo.

if not exist "%SCRIPT_DIR%agent-config.json" (
  echo No agent-config.json found next to this file.
  echo Copy agent-config.example.json to agent-config.json and fill in the
  echo station name, server address, and login before running this again.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer. Install Node 22.5 or newer
  echo from nodejs.org, then run this file again.
  echo.
  pause
  exit /b 1
)

echo Registering the agent to start automatically when you log in...
schtasks /create /tn "%TASK_NAME%" /tr "\"node\" \"%SCRIPT_DIR%print-agent.js\"" /sc ONLOGON /rl LIMITED /f

if errorlevel 1 (
  echo.
  echo Could not register the task. Try right-clicking this file and
  echo choosing "Run as administrator".
  echo.
  pause
  exit /b 1
)

echo Starting it now, so you don't have to log out and back in...
schtasks /run /tn "%TASK_NAME%"

echo.
echo Done. The agent is running and will start every time this computer
echo logs in, even after a restart. To check on it or stop it, open Task
echo Scheduler (search for "Task Scheduler" in the Start menu) and look
echo for "%TASK_NAME%".
echo.
pause
