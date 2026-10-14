@echo off
rem  ship "what changed"  -  commit, push to GitHub, and wait until the shop runs it.
rem  ship status          -  where things are.        (tools\ship.mjs says how)
node "%~dp0tools\ship.mjs" %*
