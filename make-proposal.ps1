# =============================================================================
#  OG SYSTEM x TRINODE - client proposal PDF
# -----------------------------------------------------------------------------
#  Regenerates the Arabic screenshots from the live app, then renders
#  docs\proposal-ar.html to a print-ready PDF.
#
#  Run it whenever the app's UI changes - the screenshots are captured from the
#  real thing, so the document can never drift into describing a version that
#  no longer exists.
#
#  Usage:  .\make-proposal.ps1
#          .\make-proposal.ps1 -SkipShots     reuse the existing screenshots
# =============================================================================

param(
  [switch]$SkipShots,
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Say($m, $c = 'White') { Write-Host $m -ForegroundColor $c }

# Chrome writes ordinary status ("N bytes written to file ...") to stderr. Under
# PowerShell 5.1 a native command's stderr becomes an ErrorRecord, which with
# ErrorActionPreference='Stop' aborts the script on a run that actually
# succeeded. Every Chrome call goes through here so that cannot happen.
function Invoke-Chrome {
  param([string[]]$ChromeArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try   { & $script:chrome @ChromeArgs 2>&1 | Out-Null }
  finally { $ErrorActionPreference = $prev }
}

# --- find chrome -------------------------------------------------------------
$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { Say "  No Chrome or Edge found." 'Red'; exit 1 }
$script:chrome = $chrome

# --- the local server has to be up, because the shots come from it -----------
$serverWasDown = $false
if (-not $SkipShots) {
  $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) {
    Say "  Starting the local server on port $Port ..."
    Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-File',"$root\serve.ps1",'-Port',"$Port",'-NoBrowser' -WindowStyle Hidden
    $serverWasDown = $true
    Start-Sleep -Seconds 3
  }
  try { $null = Invoke-WebRequest "http://127.0.0.1:$Port/index.html" -UseBasicParsing -TimeoutSec 8 }
  catch { Say "  Server did not answer on port $Port." 'Red'; exit 1 }
}

New-Item -ItemType Directory -Force -Path "$root\docs\img", "$root\docs\fonts" | Out-Null

# --- 1. the Arabic screenshots ----------------------------------------------
# 2x device scale so they stay sharp at print resolution. `clean=1` drops the
# demo-tour button, which is app furniture rather than product.
if (-not $SkipShots) {
  Say ""
  Say "=== 1/3  Screenshots ===" 'Cyan'

  # Narrower viewports than the test suites use. A 1440px screen scaled down to
  # a 174mm column renders the UI text too small to read on paper; at 1180 the
  # same screen carries fewer pixels into the same width, so everything lands
  # noticeably larger. The two-up pair on the print page is narrower again,
  # because each one only gets half the column.
  $shots = @(
    @{ n = 'dashboard'; u = '_shot.html?v=dashboard&lang=ar&clean=1';               s = '1180,860' },
    @{ n = 'pos';       u = '_shot.html?v=pos&lang=ar&clean=1';                     s = '1180,860' },
    @{ n = 'warehouse'; u = '_shot.html?whtab=stock&whplace=floor&lang=ar&clean=1'; s = '1180,900' },
    @{ n = 'money';     u = '_shot.html?v=money&lang=ar&clean=1';                   s = '1180,820' },
    @{ n = 'reports';   u = '_shot.html?v=reports&lang=ar&clean=1';                 s = '1180,860' },
    @{ n = 'print';     u = '_shot.html?v=print&lang=ar&clean=1';                   s = '900,760'  },
    @{ n = 'yalla';     u = '_shot.html?portal=1&yv=queue&lang=ar&clean=1';         s = '900,760'  },
    # 560 not 390: headless clamps the viewport near 500px, so a narrower
    # window renders a 500px layout and crops the right edge off the image.
    @{ n = 'phone';     u = '_shot.html?v=dashboard&lang=ar&clean=1';               s = '560,1120' }
  )

  foreach ($x in $shots) {
    $out = "$root\docs\img\$($x.n).png"
    Invoke-Chrome @(
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--force-device-scale-factor=2', "--window-size=$($x.s)",
      '--virtual-time-budget=14000', "--screenshot=$out",
      "http://127.0.0.1:$Port/$($x.u)"
    )
    if (Test-Path $out) {
      "    {0,-11} {1,6} KB" -f $x.n, [math]::Round((Get-Item $out).Length / 1KB, 0)
    } else {
      Say "    $($x.n)  FAILED" 'Red'
    }
  }
}

# --- 2. fonts ----------------------------------------------------------------
# Cairo carries Arabic; the app's vendored Montserrat does not. Without this
# the PDF falls back to Tahoma, which reads cheap on paper.
Say ""
Say "=== 2/3  Arabic font ===" 'Cyan'

$fonts = @{
  'Cairo-400.ttf' = 'https://fonts.gstatic.com/s/cairo/v31/SLXgc1nY6HkvangtZmpQdkhzfH5lkSs2SgRjCAGMQ1z0hAc5W1Q.ttf'
  'Cairo-600.ttf' = 'https://fonts.gstatic.com/s/cairo/v31/SLXgc1nY6HkvangtZmpQdkhzfH5lkSs2SgRjCAGMQ1z0hD45W1Q.ttf'
  'Cairo-700.ttf' = 'https://fonts.gstatic.com/s/cairo/v31/SLXgc1nY6HkvangtZmpQdkhzfH5lkSs2SgRjCAGMQ1z0hOA-W1Q.ttf'
}
foreach ($f in $fonts.Keys) {
  $p = "$root\docs\fonts\$f"
  if (Test-Path $p) { "    $f  already here" ; continue }
  try {
    (New-Object System.Net.WebClient).DownloadFile($fonts[$f], $p)
    "    $f  downloaded"
  } catch {
    Say "    $f  FAILED - the PDF will fall back to Sakkal Majalla / Segoe UI" 'Yellow'
  }
}

# --- overflow check ----------------------------------------------------------
# .page is a fixed 297mm box with overflow:hidden, so content that runs past the
# bottom is silently CLIPPED - and the running footer ends up printed on top of
# it. That is invisible in the HTML and only shows up on paper, so it gets
# measured rather than eyeballed.
Say ""
Say "=== 2.5/3  Page overflow ===" 'Cyan'

# The probe is written INTO docs\ and loaded over http rather than file://.
# Chrome's --dump-dom returns nothing for a file:// URL, and serving it from
# the folder it belongs to means the relative css/img/font paths just work.
# The leading underscore keeps it out of any published build.
$probe = "$root\docs\_overflow-probe.html"
$srcHtml = [IO.File]::ReadAllText("$root\docs\proposal-ar.html", [Text.Encoding]::UTF8)
$inject = @'
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var bad = [];
    document.querySelectorAll('.page').forEach(function (pg) {
      var foot = pg.querySelector('.pg-foot');
      /* The usable floor is the top of the footer rule, not the page edge. */
      var floor = foot ? foot.getBoundingClientRect().top : pg.getBoundingClientRect().bottom;
      var over = 0;
      pg.querySelectorAll(':scope > *:not(.pg-foot), .closing-inner > *:not(.pg-foot)').forEach(function (el) {
        var b = el.getBoundingClientRect().bottom;
        if (b > floor) { over = Math.max(over, Math.round(b - floor)); }
      });
      if (over > 2) { bad.push(pg.id + ':' + over); }
    });
    document.title = 'OVERFLOW=' + (bad.length ? bad.join(',') : 'none');
  }, 400);
});
</script>
</head>
'@
[IO.File]::WriteAllText($probe, ($srcHtml -replace '</head>', $inject), (New-Object Text.UTF8Encoding $false))

$overflow = 'unknown'
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  # stderr to $null and stdout to a FILE. Capturing with 2>&1 into a variable
  # collapses the whole stream under PS 5.1 and returns nothing at all, which
  # is what made this check quietly report "could not measure".
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $dumpFile = "$env:TEMP\og-probe-dump.html"
  & $chrome --headless=new --disable-gpu --no-sandbox --window-size=794,1123 `
            --virtual-time-budget=9000 --dump-dom `
            "http://127.0.0.1:$Port/docs/_overflow-probe.html" 2>$null |
    Out-File $dumpFile -Encoding utf8
  $ErrorActionPreference = $prevEAP

  if (Test-Path $dumpFile) {
    $dumped = [IO.File]::ReadAllText($dumpFile, [Text.Encoding]::UTF8)
    if ($dumped -match 'OVERFLOW=([^<"]*)') { $overflow = $matches[1].Trim() }
    Remove-Item $dumpFile -Force -ErrorAction SilentlyContinue
  }
} else {
  Say "    server not running - skipping (run without -SkipShots to measure)" 'DarkGray'
}
Remove-Item $probe -Force -ErrorAction SilentlyContinue

if ($overflow -eq 'none') {
  "    every page fits its box"
} elseif ($overflow -eq 'unknown') {
  Say "    could not measure - check the pages by hand" 'Yellow'
} else {
  Say "    PAGES OVERFLOWING (id:px past the footer): $overflow" 'Red'
  $script:overflowBad = $true
}

# --- 3. render ---------------------------------------------------------------
Say ""
Say "=== 3/3  Rendering the PDF ===" 'Cyan'

$pdf  = "$root\docs\OG-System-Trinode.pdf"
$html = "$root\docs\proposal-ar.html"

if (-not (Test-Path $html)) { Say "  $html is missing." 'Red'; exit 1 }
if (Test-Path $pdf) { Remove-Item $pdf -Force }

# file:// rather than through the server: the PDF embeds local fonts and the
# logo from ..\assets, and a file URL resolves those without another round trip.
$url = 'file:///' + ($html -replace '\\', '/')

Invoke-Chrome @(
  '--headless=new', '--disable-gpu', '--no-sandbox',
  "--print-to-pdf=$pdf", '--no-pdf-header-footer',
  '--virtual-time-budget=20000',
  $url
)

if (-not (Test-Path $pdf)) { Say "  Chrome did not produce a PDF." 'Red'; exit 1 }

# --- checks ------------------------------------------------------------------
# Page count read straight out of the PDF, so "under 15 pages" is asserted
# rather than assumed.
$bytes = [IO.File]::ReadAllBytes($pdf)
$text  = [Text.Encoding]::GetEncoding('latin1').GetString($bytes)
$pages = ([regex]::Matches($text, '/Type\s*/Page[^s]')).Count
$kb    = [math]::Round((Get-Item $pdf).Length / 1KB, 0)

Say ""
Say "  ==========================================================" 'Green'
"    PDF     : docs\OG-System-Trinode.pdf"
"    Size    : $kb KB"
"    Pages   : $pages"

$ok = $true
if ($script:overflowBad) { Say "    A page is clipping its own content - see above" 'Red'; $ok = $false }
if ($pages -gt 15) { Say "    OVER THE 15 PAGE LIMIT" 'Red'; $ok = $false }
if ($pages -lt 5)  { Say "    Suspiciously few pages - check the render" 'Red'; $ok = $false }
if ($kb -lt 200)   { Say "    Suspiciously small - screenshots may be missing" 'Yellow' }

$missing = @('dashboard','pos','warehouse','money','print','yalla','reports','phone') |
           Where-Object { -not (Test-Path "$root\docs\img\$_.png") }
if ($missing) { Say "    Missing screenshots: $($missing -join ', ')" 'Red'; $ok = $false }

if (-not (Test-Path "$root\assets\trinode.svg") -and -not (Test-Path "$root\assets\trinode.png")) {
  Say "    NOTE: using the drawn Trinode mark. Drop the real file at" 'Yellow'
  Say "          assets\trinode.svg to use your own artwork." 'Yellow'
}

if ($ok) { Say "    All checks passed." 'Green' }
Say "  ==========================================================" 'Green'
Say ""

if ($serverWasDown) {
  Say "  (a local server was started for the screenshots and is still running)" 'DarkGray'
}
