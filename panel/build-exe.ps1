# =============================================================================
#  OG SYSTEM - build "OG System.exe"
# -----------------------------------------------------------------------------
#  Run this once, and again whenever panel\launcher\OGSystem.cs changes:
#
#      powershell -ExecutionPolicy Bypass -File panel\build-exe.ps1
#
#  It needs NOTHING installed. csc.exe is part of the .NET Framework that ships
#  with Windows itself - it has been in C:\Windows\Microsoft.NET\Framework64\
#  since Windows 8 - which is the same reason the server has no dependencies
#  and the frontend has no build step. No SDK, no npm, no Visual Studio.
#
#  Editing the panel (panel\panel.js, panel\ui\*) does NOT need this. Only the
#  launcher is compiled; everything else is read off disk at run time, which is
#  what lets Hard refresh work on the panel's own window too.
#
#  PowerShell here is 5.1 - no &&, no ternary, no heredocs. See CLAUDE.md.
# =============================================================================

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$out  = Join-Path $root 'OG System.exe'

Write-Host ''
Write-Host '  OG SYSTEM - building the launcher' -ForegroundColor Cyan
Write-Host ''

# --- the compiler Windows already has ----------------------------------------
$csc = $null
foreach ($v in @('v4.0.30319')) {
  foreach ($arch in @('Framework64', 'Framework')) {
    $p = "$env:WINDIR\Microsoft.NET\$arch\$v\csc.exe"
    if (Test-Path $p) { $csc = $p; break }
  }
  if ($csc) { break }
}

if (-not $csc) {
  Write-Host '  Could not find csc.exe.' -ForegroundColor Red
  Write-Host '  It is part of the .NET Framework, which is normally already installed.'
  Write-Host '  Turn it on under: Windows Features -> .NET Framework 4.x'
  Write-Host ''
  exit 1
}
Write-Host "  compiler : $csc" -ForegroundColor DarkGray

# --- the icon, drawn by panel\make-icon.js -----------------------------------
# The O, in the shop's lime. Generated rather than committed as artwork: it is
# arithmetic, it has to exist at six sizes, and a picture somebody exports by
# hand is a picture that drifts. It also writes panel\ui\icon.png, which is the
# panel window's favicon and therefore its taskbar button.
$ico = Join-Path $here 'og.ico'
$node = (Get-Command node -ErrorAction SilentlyContinue)
if ($node) {
  & $node.Source (Join-Path $here 'make-icon.js')
} elseif (-not (Test-Path $ico)) {
  Write-Host '  No node and no panel\og.ico - the window will use the default icon.' -ForegroundColor Yellow
}

# --- the shop is running out of this file, so it cannot be overwritten -------
if (Test-Path $out) {
  try {
    Remove-Item $out -Force
  } catch {
    Write-Host ''
    Write-Host '  "OG System.exe" is open. Quit it from the tray, then run this again.' -ForegroundColor Red
    Write-Host ''
    exit 1
  }
}

# --- compile ------------------------------------------------------------------
# /target:winexe rather than exe: this is a tray application and must not open a
# console window behind it every time somebody double-clicks the icon.
$src = Join-Path $here 'launcher\OGSystem.cs'
$args = @(
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  "/out:$out",
  '/reference:System.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  '/reference:System.Management.dll'
)
if (Test-Path $ico) { $args += "/win32icon:$ico" }
$args += $src

& $csc $args
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '  The launcher did not compile - see the errors above.' -ForegroundColor Red
  Write-Host ''
  exit 1
}

$kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host ''
Write-Host "  Built:  $out  ($kb KB)" -ForegroundColor Green
Write-Host ''
Write-Host '  Double-click it. It starts the shop, opens the panel, and sits'
Write-Host '  next to the clock while the shop is open.'
Write-Host ''
