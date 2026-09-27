@echo off
rem The OGLabelAgent task starts this with no window at all
rem (conhost.exe --headless), so closing a console cannot stop the printing:
rem on 27 Sep 2026 the agent's own black window was closed a moment after it
rem opened, and nothing printed. What the agent says goes to agent.log beside
rem this file, started fresh at every start the way the launcher's panel.log is.
cd /d "%~dp0"
node "%~dp0print-agent.js" > "%~dp0agent.log" 2>&1
