# =============================================================================
#  tools/wg-test/shop-verdict.ps1 - the one test that decides the route
#  (day shift 06). Windows PowerShell 5.1, ASCII only. NO administrator,
#  NO WireGuard install: it runs a real WireGuard handshake from Node
#  (handshake.mjs) with the till key the VPS already trusts.
#
#  RUN IT AT THE SHOP, ON THE SHOP'S OWN LINE, WITH PIA OFF. It refuses
#  while PIA is connected: through PIA the answer is about PIA's line.
#
#    cd "D:\DESKTOP\OG System"
#    powershell -ExecutionPolicy Bypass -File tools\wg-test\shop-verdict.ps1
#
#  One verdict line:
#    WORKS            the VPS answered a WireGuard handshake over the shop's line
#    UDP BLOCKED      no answer on UDP 51820, but the VPS answers on TCP 443/22
#                     -> tools/wg-test/FALLBACK.md
#    VPS UNREACHABLE  nothing answers at all
#  Exit 0 / 4 / 5, and 3 when it refused because PIA is on.
# =============================================================================
param(
  [string]$KeyFile = '',
  [string]$ServerPublicKeyFile = '',
  [string]$Endpoint = '152.239.114.129:51820'
)
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
if (-not $KeyFile) { $KeyFile = Join-Path $Root '_secrets\wg-till.key' }
if (-not $ServerPublicKeyFile) { $ServerPublicKeyFile = Join-Path $Root '_secrets\wg-vps.pub' }
$VpsHost = $Endpoint.Split(':')[0]
function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

# ---- PIA must be off --------------------------------------------------------
$piaState = $null
$piactl = Join-Path $env:ProgramFiles 'Private Internet Access\piactl.exe'
if (Test-Path $piactl) { try { $piaState = (& $piactl get connectionstate 2>$null | Out-String).Trim() } catch { $piaState = $null } }
$piaUp = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
  $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'PIA|Private Internet Access' -or $_.Name -match 'PIA') })
if (($piaState -and $piaState -ne 'Disconnected') -or $piaUp.Count -gt 0) {
  Say 'PIA is connected. Disconnect it first: through PIA this says nothing about the shop''s line.' Red
  exit 3
}

# ---- what line is this? (said, never decided on) ----------------------------
$wifi = Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway } | Select-Object -First 1
if ($wifi) {
  $ip = ($wifi.IPv4Address | Select-Object -First 1).IPAddress
  $where = 'another network'
  if ($ip -like '10.10.99.*') { $where = 'the SHOP LAN' } elseif ($ip -like '172.20.10.*') { $where = 'a PHONE HOTSPOT' } elseif ($ip -like '192.168.1.*') { $where = 'a home network?' }
  Say ('This laptop: ' + $ip + ' via ' + $wifi.InterfaceAlias + ' (' + $where + ')')
}

foreach ($f in @($KeyFile, $ServerPublicKeyFile)) { if (-not (Test-Path $f)) { Say ('Missing ' + $f) Red; exit 2 } }
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Say 'Node is not on PATH.' Red; exit 2 }

# ---- the handshake ----------------------------------------------------------
$pub = (Get-Content $ServerPublicKeyFile -Raw).Trim()
$out = & $node.Source (Join-Path $PSScriptRoot 'handshake.mjs') test $KeyFile $pub $Endpoint
$code = $LASTEXITCODE
Say ('  ' + $out)
if ($code -eq 0) { Say 'WORKS - WireGuard gets through this line. Next: docs/vps/TONIGHT.md, the tunnel service.' Green; exit 0 }

$tcp = $false
foreach ($p in 443, 22) {
  $t = Test-NetConnection -ComputerName $VpsHost -Port $p -WarningAction SilentlyContinue
  if ($t.TcpTestSucceeded) { $tcp = $true; Say ('  the VPS answers on TCP ' + $p) }
}
if ($tcp) { Say 'UDP BLOCKED - no WireGuard answer, but the VPS answers on TCP. Read tools/wg-test/FALLBACK.md.' Red; exit 4 }
Say 'VPS UNREACHABLE - nothing answers at all (no handshake, no TCP 443/22).' Red
exit 5
