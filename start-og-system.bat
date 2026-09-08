@echo off
REM ===========================================================================
REM  There is one launcher now, and it is "OG System.exe" in this folder.
REM
REM  This file is kept as a shortcut to it, and for one reason only: the shop's
REM  laptop has a desktop icon and a pinned taskbar entry pointing HERE, and
REM  deleting it would end with somebody standing in front of a till on a
REM  Monday morning with nothing to double-click. It does no work of its own.
REM
REM  What used to be in this file - the port check, the certificate trust
REM  check, the printer check, opening the browser, and then holding a console
REM  window open for as long as the shop was open - is all in the panel now,
REM  with a Stop button, a terminal you can scroll, and the addresses as links.
REM
REM  push.bat, claim-mirror.bat and make-deploy.bat are gone: they are the
REM  Publish, Claim the mirror and Build dist buttons. They are still in git
REM  history if one is ever wanted back.
REM ===========================================================================
start "" "%~dp0OG System.exe"
