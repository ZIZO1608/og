# =============================================================================
#  tools/wg-test/till-side.ps1 - the shop laptop's half of the WireGuard test
#  (night shift 05). Windows PowerShell 5.1, ASCII only. RUN AS ADMINISTRATOR,
#  on the SHOP'S OWN internet connection.
# -----------------------------------------------------------------------------
#  It answers ONE question: can this laptop, on the shop's line, hold a
#  WireGuard tunnel to the VPS? Three verdicts, in plain words:
#    WORKS            handshake done and a ping over the tunnel answers
#    UDP BLOCKED      no handshake in 60 s, but the VPS answers on TCP 22/443:
#                     the ISP drops UDP -> tools/wg-test/FALLBACK.md
#    VPS UNREACHABLE  nothing answers at all
#
#  REFUSES TO RUN WHILE PIA (the VPN) IS CONNECTED: through PIA the test says
#  nothing about the shop's own line, which is the whole point.
#
#    First:   .\till-side.ps1                      (prints this laptop's key)
#    Then:    .\till-side.ps1 -ServerPublicKey <the VPS key from vps-side.sh>
#    Check only (no admin, changes nothing):  .\till-side.ps1 -CheckOnly
#    Remove the tunnel:                        .\till-side.ps1 -Remove
#    Reuse the key the VPS already trusts:     -KeyFile <path>  (day shift 06: _secrets\wg-till.key)
#    Install through PIA anyway (at home):     -AllowPia  (the verdict is then about PIA's line)
# =============================================================================
param(
  [string]$ServerPublicKey = '',
  [string]$Endpoint = '152.239.114.129:51820',
  [string]$Address = '10.8.0.2/24',
  [string]$Vps = '10.8.0.1',
  [string]$Name = 'og-shop',
  [switch]$CheckOnly,
  [switch]$Remove,
  [string]$KeyFile = '',
  [switch]$AllowPia
)

$ErrorActionPreference = 'Stop'
$WgDir = Join-Path $env:ProgramFiles 'WireGuard'
$WgExe = Join-Path $WgDir 'wireguard.exe'
$Wg = Join-Path $WgDir 'wg.exe'
$ConfDir = Join-Path $env:ProgramData 'OGSystem\wg'
$Conf = Join-Path $ConfDir ($Name + '.conf')
if (-not $KeyFile) { $KeyFile = Join-Path $ConfDir ($Name + '.key') }
$VpsHost = $Endpoint.Split(':')[0]

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

# ---- 1. WireGuard for Windows present? ------------------------------------
if (-not (Test-Path $WgExe) -or -not (Test-Path $Wg)) {
  Say 'WireGuard for Windows is not installed.' Red
  Say 'Download and run:  https://download.wireguard.com/windows-client/wireguard-installer.exe'
  Say 'Then run this script again.'
  exit 1
}
Say 'WireGuard for Windows: installed.' Green

# ---- 2. PIA must be OFF -----------------------------------------------------
$piaState = $null
$piactl = Join-Path $env:ProgramFiles 'Private Internet Access\piactl.exe'
if (Test-Path $piactl) {
  try { $piaState = (& $piactl get connectionstate 2>$null | Out-String).Trim() } catch { $piaState = $null }
}
$piaAdapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
  $_.Status -eq 'Up' -and ($_.InterfaceDescription -match 'PIA|Private Internet Access' -or $_.Name -match 'PIA')
})
$piaOn = (($piaState -and $piaState -ne 'Disconnected') -or $piaAdapters.Count -gt 0)
if ($piaOn -and -not $AllowPia) {
  Say ('PIA is connected (' + ($(if ($piaState) { 'piactl: ' + $piaState } else { 'adapter up: ' + $piaAdapters[0].Name })) + ').') Red
  Say 'Disconnect PIA first. Through PIA this test says nothing about the shop''s own line.'
  Say '(-AllowPia installs the tunnel anyway; the verdict is then about PIA''s line, not the shop''s.)'
  exit 3
}
if ($piaOn) { Say 'PIA: connected, and -AllowPia was given. This verdict is about PIA''s line, NOT the shop''s.' Yellow }
else { Say 'PIA: not connected.' Green }

if ($CheckOnly) { Say 'Check only: nothing changed.'; exit 0 }

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say 'Run this in an Administrator PowerShell.' Red
  exit 1
}

if ($Remove) {
  & $WgExe /uninstalltunnelservice $Name 2>$null
  Say ('Tunnel ' + $Name + ' removed (keys kept in ' + $ConfDir + ').') Green
  exit 0
}

# ---- 3. This laptop's key (made once, kept) ---------------------------------
New-Item -ItemType Directory -Force $ConfDir | Out-Null
if (-not (Test-Path $KeyFile)) {
  (& $Wg genkey) | Out-File -Encoding ascii -NoNewline $KeyFile
  Say 'Made this laptop''s key pair.'
}
$icaclsOut = icacls $ConfDir /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' 2>&1
$priv = (Get-Content $KeyFile -Raw).Trim()
$pub = ($priv | & $Wg pubkey).Trim()
Say ''
Say ('THIS LAPTOP''S PUBLIC KEY:  ' + $pub) Cyan
Say '(on the VPS:  bash vps-side.sh ' + $pub + ')'

if (-not $ServerPublicKey) {
  Say ''
  Say 'Now run vps-side.sh on the VPS, then this again with -ServerPublicKey <the VPS key>.'
  exit 0
}

# ---- 4. The tunnel config, and the service ----------------------------------
$lines = @(
  '[Interface]',
  ('PrivateKey = ' + $priv),
  ('Address    = ' + $Address),
  '',
  '[Peer]',
  ('PublicKey           = ' + $ServerPublicKey),
  ('Endpoint            = ' + $Endpoint),
  ('AllowedIPs          = ' + $Vps + '/32'),
  'PersistentKeepalive = 25'
)
[IO.File]::WriteAllLines($Conf, $lines)
& $WgExe /uninstalltunnelservice $Name 2>$null | Out-Null
Start-Sleep -Seconds 2
& $WgExe /installtunnelservice $Conf
Say ('Tunnel ' + $Name + ' installed (AllowedIPs ' + $Vps + '/32 only - nothing else goes through it).') Green

# ---- 5. Up to 60 s for a handshake ------------------------------------------
$hand = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  $hs = & $Wg show $Name latest-handshakes 2>$null
  if ($hs) {
    $epoch = [int64](($hs -split '\s+')[-1])
    if ($epoch -gt 0) { $hand = $true; break }
  }
}

Say ''
if ($hand) {
  $pings = @(Test-Connection -ComputerName $Vps -Count 4 -ErrorAction SilentlyContinue)
  if ($pings.Count -gt 0) {
    $avg = [math]::Round(($pings | Measure-Object -Property ResponseTime -Average).Average, 0)
    Say ('WORKS - the tunnel is up and ' + $Vps + ' answers in ' + $avg + ' ms (' + $pings.Count + '/4 pings).') Green
    Say 'Leave the tunnel installed. Next: MORNING.md, the proxy step.'
    exit 0
  }
  Say 'HANDSHAKE BUT NO PING - the tunnel formed, but 10.8.0.1 does not answer ICMP.' Yellow
  Say 'Check the VPS: ufw may be dropping ICMP on wg0 (ufw allow in on wg0). The tunnel itself works.'
  exit 0
}

$tcp = $false
foreach ($p in 443, 22) {
  $t = Test-NetConnection -ComputerName $VpsHost -Port $p -WarningAction SilentlyContinue
  if ($t.TcpTestSucceeded) { $tcp = $true; Say ('  the VPS answers on TCP ' + $p) }
}
& $WgExe /uninstalltunnelservice $Name 2>$null | Out-Null
if ($tcp) {
  Say 'UDP BLOCKED - no handshake in 60 s while the VPS answers on TCP. The shop''s ISP drops UDP.' Red
  Say 'The tunnel was removed again. Read tools/wg-test/FALLBACK.md.'
  exit 4
}
Say 'VPS UNREACHABLE - nothing answers at all (no handshake, no TCP 22/443).' Red
Say 'Check the VPS is up and its firewall (hPanel) allows UDP 51820. The tunnel was removed again.'
exit 5
