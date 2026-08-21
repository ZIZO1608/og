# =============================================================================
#  OG SYSTEM — build the publishable copy of the app
# -----------------------------------------------------------------------------
#  Copies only the real application, leaving behind the test harnesses
#  (_selftest.html, _mobile.html, _shot.html) and anything else starting with
#  an underscore.
#
#  Usage:
#    .\make-deploy.ps1                      build into .\dist   (default)
#    .\make-deploy.ps1 -Out "D:\repos\og"   build into a git clone, ready to
#                                           commit with GitHub Desktop
#
#  Nothing to install — this uses only what ships with Windows.
#
#  SAFETY, and why this script looks more careful than it needs to:
#  the previous version began with `Remove-Item $dist -Recurse -Force`. Aimed
#  at a git clone that deletes the .git folder, which destroys the repository
#  link, the history and everything GitHub Desktop needs — with no undo. So
#  the clean step below removes only the specific files this script itself
#  publishes, and refuses to run at all if the target holds anything it does
#  not recognise.
# =============================================================================

param(
  [string]$Out = 'dist'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- what actually ships -----------------------------------------------------
$files   = @('index.html', 'manifest.webmanifest', 'sw.js', 'robots.txt', '.nojekyll')
$folders = @('css', 'js', 'assets')

# Things that are allowed to already exist in the target and must be left
# strictly alone. .git is the critical one.
$keep = @('.git', '.github', '.gitignore', 'README.md', 'LICENSE', 'CNAME')

# --- resolve the target ------------------------------------------------------
$dest = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $root $Out }
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
$dest = (Resolve-Path $dest).Path

Write-Host ''
Write-Host '  OG SYSTEM - building' -ForegroundColor Green
Write-Host ("    into : {0}" -f $dest)
Write-Host ''

if ($dest -eq $root) {
  Write-Host '  Refusing to build into the source folder itself.' -ForegroundColor Red
  exit 1
}

# --- refuse to touch a folder we do not recognise ----------------------------
# If the target has top-level entries that are neither ours nor on the keep
# list, it is probably not the folder the user meant. Stop rather than delete.
$known = $files + $folders + $keep
$strangers = Get-ChildItem $dest -Force | Where-Object { $known -notcontains $_.Name }
if ($strangers) {
  Write-Host '  That folder contains files this script does not recognise:' -ForegroundColor Red
  $strangers | ForEach-Object { Write-Host ("    ? {0}" -f $_.Name) -ForegroundColor Red }
  Write-Host ''
  Write-Host '  Refusing to clean it, in case it is the wrong folder.' -ForegroundColor Red
  Write-Host '  Point -Out at your clone of the repo, or at an empty folder.' -ForegroundColor Red
  exit 1
}

# --- clean only what we publish ---------------------------------------------
# Deleting the folders first means a file removed from the source is also
# removed from the target, so a rename cannot leave an orphan behind on the
# live site. .git is never in this list and so is never touched.
foreach ($d in $folders) {
  $p = Join-Path $dest $d
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
}
foreach ($f in $files) {
  $p = Join-Path $dest $f
  if (Test-Path $p) { Remove-Item $p -Force }
}

# --- copy ---------------------------------------------------------------------
foreach ($f in $files) {
  $src = Join-Path $root $f
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $dest $f) -Force
    Write-Host ("    + {0}" -f $f)
  } else {
    Write-Host ("    ! missing {0}" -f $f) -ForegroundColor Yellow
  }
}

foreach ($d in $folders) {
  $src = Join-Path $root $d
  if (-not (Test-Path $src)) { continue }
  Copy-Item $src (Join-Path $dest $d) -Recurse -Force
  $n = (Get-ChildItem (Join-Path $dest $d) -Recurse -File).Count
  Write-Host ("    + {0}\  ({1} files)" -f $d, $n)
}

# --- safety net: nothing underscore-prefixed may ever ship -------------------
$leaked = Get-ChildItem $dest -Recurse -File -Force |
          Where-Object { $_.Name -like '_*' -and $_.FullName -notlike '*\.git\*' }
foreach ($l in $leaked) {
  Remove-Item $l.FullName -Force
  Write-Host ("    - removed harness {0}" -f $l.Name) -ForegroundColor Yellow
}

# --- report ------------------------------------------------------------------
$shipped = Get-ChildItem $dest -Recurse -File -Force |
           Where-Object { $_.FullName -notlike '*\.git\*' }
$count = $shipped.Count
$size  = ($shipped | Measure-Object Length -Sum).Sum / 1KB

# Surface the cache name, because a forgotten bump is the single most common
# reason an update appears not to have worked on a phone.
$cache = ''
$swFile = Join-Path $dest 'sw.js'
if (Test-Path $swFile) {
  $m = [regex]::Match((Get-Content $swFile -Raw), "CACHE\s*=\s*'([^']+)'")
  if ($m.Success) { $cache = $m.Groups[1].Value }
}

Write-Host ''
Write-Host ('  Done: {0} files, {1:N0} KB' -f $count, $size) -ForegroundColor Green
if ($cache) { Write-Host ('  Service worker cache: {0}' -f $cache) -ForegroundColor Cyan }
Write-Host ''

if ((Test-Path (Join-Path $dest '.git')) -or (Test-Path (Join-Path $dest '.github'))) {
  Write-Host '  This is a git clone. Next:'
  Write-Host '    1. Open GitHub Desktop - it lists every changed file'
  Write-Host '    2. Type a short summary, click "Commit to main"'
  Write-Host '    3. Click "Push origin"'
  Write-Host '    4. Wait ~1 minute, then hard-refresh the page (Ctrl+Shift+R)'
} else {
  Write-Host '  Next:'
  Write-Host ('    Drag EVERYTHING INSIDE this folder to GitHub:  {0}' -f $dest)
  Write-Host '    Root files are easy to miss - index.html, sw.js, manifest.webmanifest'
}
Write-Host ''
Write-Host '  Passcode is OG2026 - change it in js\gate.js before sharing.' -ForegroundColor Cyan
Write-Host ''
