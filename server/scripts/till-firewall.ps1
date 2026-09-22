# =============================================================================
#  till-firewall.ps1 - who may reach the shop's server on this laptop
#  (night shift 04; day shift 06: dry run by default, the tunnel on 8443 only,
#  the LAN named instead of LocalSubnet). Windows PowerShell 5.1, ASCII only.
# -----------------------------------------------------------------------------
#  FOUND 21 Sep 2026: four inbound rules named "Node.js JavaScript Runtime"
#  (Windows made them the first time node asked) allow node.exe in on EVERY
#  port from ANY address on Public and Private networks. That includes the
#  ZeroTier network this laptop joined, and any cafe wifi it is ever carried to.
#
#  With -Apply this:
#    1. adds  "OG System - shop wifi"          TCP 8090,8443 from the shop LAN
#             "OG System - VPS over WireGuard" TCP 8443      from 10.8.0.1 only
#       (first, so there is never a moment with no way in);
#    2. switches the blanket Node.js rules OFF - disabled, never deleted, so
#       -Undo puts them back exactly as they were.
#  Everything else addressed to node.exe is then refused. The panel (8099)
#  listens on 127.0.0.1 only, which no firewall rule touches.
#
#  WHY THE LAN IS NAMED, NOT "LocalSubnet": Windows computes LocalSubnet over
#  EVERY interface, so ZeroTier's 10.132.x, PIA's 10.x and the WireGuard
#  10.8.0.0/24 would all count as "the shop wifi". The shop's LAN is
#  10.10.99.0/24 (go-live 2.2); pass -Lan if it is ever different.
#
#  AFTER CLOSING, with a phone on the shop wifi in your hand:
#    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1           (dry run: prints, changes nothing)
#    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1 -Apply    (Administrator)
#  then open https://10.10.99.9:8443 on the phone at once.
#  THE ONE-LINE UNDO (Administrator; acts immediately):
#    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1 -Undo
# =============================================================================
param(
  [string]$Vps = '10.8.0.1',
  [string[]]$Lan = @('10.10.99.0/24'),
  [int[]]$LanPorts = @(8090, 8443),
  [int[]]$TunnelPorts = @(8443),
  [switch]$Apply,
  [switch]$Undo
)

$ErrorActionPreference = 'Stop'
$Group = 'OG System (till firewall)'
$OldGroup = 'OG System (night shift 04)'
$Act = $Apply -or $Undo
function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if ($Act -and -not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say 'Run this in an Administrator PowerShell (right-click > Run as administrator).' Red
  exit 1
}
if (-not $Act) { Say 'DRY RUN - nothing is changed. Add -Apply to do it.' Yellow }

$nodeRules = @(Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq 'Node.js JavaScript Runtime' })

if ($Undo) {
  foreach ($g in @($Group, $OldGroup)) {
    Get-NetFirewallRule -Group $g -ErrorAction SilentlyContinue | ForEach-Object {
      Say ('  remove  ' + $_.DisplayName)
      Remove-NetFirewallRule -Name $_.Name
    }
  }
  foreach ($r in $nodeRules) {
    Say ('  enable  ' + $r.DisplayName + ' (' + $r.Profile + ')')
    Enable-NetFirewallRule -Name $r.Name
  }
  Say 'Back as it was.' Green
  exit 0
}

# Will the phones still get in? Say so before anything happens.
function InSubnet([string]$ip, [string]$cidr) {
  $p = $cidr.Split('/'); $bits = [int]$p[1]
  $a = [BitConverter]::ToUInt32(([Net.IPAddress]::Parse($ip)).GetAddressBytes()[3..0], 0)
  $b = [BitConverter]::ToUInt32(([Net.IPAddress]::Parse($p[0])).GetAddressBytes()[3..0], 0)
  # 0xFFFFFFFF is the Int32 -1 in PowerShell 5.1, so the mask is arithmetic.
  $mask = [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - $bits))
  return (($a -band $mask) -eq ($b -band $mask))
}
$here = @(Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway -and $_.NetAdapter.InterfaceDescription -notmatch 'PIA|ZeroTier|WireGuard' } |
  ForEach-Object { ($_.IPv4Address | Select-Object -First 1).IPAddress })
foreach ($ip in $here) {
  $covered = @($Lan | Where-Object { InSubnet $ip $_ }).Count -gt 0
  if ($covered) { Say ('  this laptop is on ' + $ip + ' - inside ' + ($Lan -join ', ') + ': phones on this network keep working') Green }
  else { Say ('  WARNING: this laptop is on ' + $ip + ', OUTSIDE ' + ($Lan -join ', ') + '. Phones on THIS network would be locked out. Run it at the shop, or pass -Lan.') Red }
}

# 1. The narrow rules first.
$wanted = @(
  @{ Name = 'OG System - shop wifi';          Remote = $Lan;  Ports = $LanPorts },
  @{ Name = 'OG System - VPS over WireGuard'; Remote = @($Vps); Ports = $TunnelPorts }
)
foreach ($w in $wanted) {
  $existing = Get-NetFirewallRule -DisplayName $w.Name -ErrorAction SilentlyContinue
  if ($existing) { Say ('  keep    ' + $w.Name + ' (already there; -Undo first to rebuild it)'); continue }
  Say ('  add     ' + $w.Name + '  TCP ' + ($w.Ports -join ',') + '  from ' + ($w.Remote -join ','))
  if ($Apply) {
    New-NetFirewallRule -DisplayName $w.Name -Group $Group -Direction Inbound -Action Allow `
      -Protocol TCP -LocalPort $w.Ports -RemoteAddress $w.Remote -Profile Any | Out-Null
  }
}

# 2. Then the blanket ones off.
foreach ($r in $nodeRules) {
  if ($r.Enabled -eq 'True') {
    Say ('  disable ' + $r.DisplayName + ' (' + $r.Profile + ', ' + $r.Action + ')')
    if ($Apply) { Disable-NetFirewallRule -Name $r.Name }
  } else { Say ('  already off: ' + $r.DisplayName + ' (' + $r.Profile + ')') }
}

Say ''
if ($Apply) {
  Say 'Done. NOW, from a phone on the shop wifi: https://10.10.99.9:8443 must still open.' Green
  Say 'If it does not:  ...till-firewall.ps1 -Undo'
} else { Say 'Dry run finished. Nothing was changed.' Yellow }
