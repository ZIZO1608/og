# =============================================================================
#  OG SYSTEM — tiny local web server
# -----------------------------------------------------------------------------
#  Serves this folder over http on 127.0.0.1 so the browser treats it as a
#  SECURE CONTEXT. That is what unlocks:
#     * the camera (getUserMedia is blocked on file://)
#     * install-to-home-screen
#     * the service worker / offline mode
#
#  Built on TcpListener rather than HttpListener on purpose: HttpListener needs
#  an admin URL reservation on Windows, this needs nothing at all.
#
#  Usage:  .\serve.ps1                 serve this folder on port 8080
#          .\serve.ps1 -Path dist      serve the built folder instead
#          .\serve.ps1 -Port 9000      different port
#          .\serve.ps1 -Lan            also listen on the network IP, so a
#                                      phone on the same wifi can open it
# =============================================================================

param(
  [string]$Path = '.',
  [int]$Port = 8080,
  [switch]$Lan,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$rootDir = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) $Path)).Path

$MIME = @{
  '.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8'
  '.css'='text/css; charset=utf-8';   '.js'='application/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'
  '.webmanifest'='application/manifest+json; charset=utf-8'
  '.svg'='image/svg+xml';  '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'
  '.ico'='image/x-icon';   '.woff2'='font/woff2'; '.woff'='font/woff'
  '.txt'='text/plain; charset=utf-8'; '.xml'='application/xml; charset=utf-8'
  '.pdf'='application/pdf'
}

$bind = if ($Lan) { [System.Net.IPAddress]::Any } else { [System.Net.IPAddress]::Loopback }
$listener = New-Object System.Net.Sockets.TcpListener($bind, $Port)
try { $listener.Start() }
catch { Write-Host "  Port $Port is busy. Try:  .\serve.ps1 -Port 8081" -ForegroundColor Red; exit 1 }

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
          Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
          Select-Object -First 1).IPAddress

Write-Host ''
Write-Host '  OG SYSTEM is running' -ForegroundColor Green
Write-Host ''
Write-Host ("    serving : {0}" -f $rootDir)
Write-Host ("    local   : http://127.0.0.1:{0}/" -f $Port) -ForegroundColor Cyan
if ($Lan -and $lanIp) {
  Write-Host ("    phone   : http://{0}:{1}/   <- same wifi" -f $lanIp, $Port) -ForegroundColor Cyan
}
Write-Host ''
Write-Host '    Camera, install-to-phone and offline mode all work here.'
Write-Host '    Close this window to stop.' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoBrowser) { Start-Process ("http://127.0.0.1:{0}/" -f $Port) }

function Send-Response {
  param($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body, [string]$extra = '')
  $head = "HTTP/1.1 $code $status`r`n" +
          "Content-Type: $type`r`n" +
          "Content-Length: $($body.Length)`r`n" +
          "Cache-Control: no-cache`r`n" +
          $extra +
          "Connection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $stream = $client.GetStream()

    # --- read the request line (headers we mostly ignore) --------------------
    $sb = New-Object Text.StringBuilder
    $buf = New-Object byte[] 1
    $seen = 0
    while ($seen -lt 4 -and $sb.Length -lt 8192) {
      if ($stream.Read($buf, 0, 1) -le 0) { break }
      $ch = [char]$buf[0]
      [void]$sb.Append($ch)
      if ($ch -eq "`r" -or $ch -eq "`n") { $seen++ } else { $seen = 0 }
    }
    $reqLine = ($sb.ToString() -split "`r?`n")[0]
    $parts = $reqLine -split ' '
    if ($parts.Count -lt 2) { $client.Close(); continue }

    $url = $parts[1].Split('?')[0].Split('#')[0]
    $rel = [Uri]::UnescapeDataString($url).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $rel = $rel -replace '/', '\'

    # --- refuse to escape the served folder ----------------------------------
    $full = [IO.Path]::GetFullPath((Join-Path $rootDir $rel))
    if (-not $full.StartsWith($rootDir, [StringComparison]::OrdinalIgnoreCase)) {
      Send-Response $stream 403 'Forbidden' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Forbidden'))
      $client.Close(); continue
    }

    if (Test-Path $full -PathType Container) { $full = Join-Path $full 'index.html' }

    if (Test-Path $full -PathType Leaf) {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = if ($MIME.ContainsKey($ext)) { $MIME[$ext] } else { 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($full)
      Send-Response $stream 200 'OK' $type $bytes
      Write-Host ("    200  {0}" -f $url) -ForegroundColor DarkGray
    } else {
      $msg = [Text.Encoding]::UTF8.GetBytes('Not found')
      Send-Response $stream 404 'Not Found' 'text/plain' $msg
      Write-Host ("    404  {0}" -f $url) -ForegroundColor DarkYellow
    }
  } catch {
    # a browser hanging up mid-request is normal; keep serving
  } finally {
    try { $client.Close() } catch {}
  }
}
