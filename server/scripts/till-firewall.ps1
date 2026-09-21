# =============================================================================
#  till-firewall.ps1 - who may reach the shop's server on this laptop
#  (night shift 04). Windows PowerShell 5.1, ASCII only. RUN AS ADMINISTRATOR.
# -----------------------------------------------------------------------------
#  FOUND 21 Sep 2026: four inbound rules named "Node.js JavaScript Runtime"
#  (Windows made them the first time node asked) allow node.exe in on EVERY
#  port from ANY address on Public and Private networks. That includes the
#  ZeroTier network this laptop joined, and any cafe wifi the laptop is ever
#  carried to.
#
#  This script:
#    1. switches those blanket Node.js rules OFF (disabled, not deleted, so
#       -Undo can put them back exactly as they were);
#    2. allows the shop's two ports (8090 http, 8443 https) in from the shop's
#       own wifi only (LocalSubnet) and from the VPS's end of the WireGuard
#       tunnel (10.8.0.1) only.
#  Everything else addressed to node.exe is refused.
#
#    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1
#    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1 -WhatIf
#    powershell -ExecutionPolicy Bypass -File server\scripts\till-firewall.ps1 -Undo
# =============================================================================
param(
  [string]$Vps = '10.8.0.1',
  [int[]]$Ports = @(8090, 8443),
  [switch]$Undo,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$Group = 'OG System (night shift 04)'

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $WhatIf -and -not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run this in an Administrator PowerShell (right-click > Run as administrator).' -ForegroundColor Red
  exit 1
}

$nodeRules = @(Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -eq 'Node.js JavaScript Runtime' })

if ($Undo) {
  Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ('  remove  ' + $_.DisplayName)
    if (-not $WhatIf) { Remove-NetFirewallRule -Name $_.Name }
  }
  foreach ($r in $nodeRules) {
    Write-Host ('  enable  ' + $r.DisplayName + ' (' + $r.Profile + ')')
    if (-not $WhatIf) { Enable-NetFirewallRule -Name $r.Name }
  }
  Write-Host 'Back as it was.' -ForegroundColor Green
  exit 0
}

# 1. The two narrow rules first, so there is never a moment with no way in.
$wanted = @(
  @{ Name = 'OG System - shop wifi';         Remote = 'LocalSubnet' },
  @{ Name = 'OG System - VPS over WireGuard'; Remote = $Vps }
)
foreach ($w in $wanted) {
  $existing = Get-NetFirewallRule -DisplayName $w.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host ('  keep    ' + $w.Name)
    continue
  }
  Write-Host ('  add     ' + $w.Name + '  TCP ' + ($Ports -join ',') + '  from ' + $w.Remote)
  if (-not $WhatIf) {
    New-NetFirewallRule -DisplayName $w.Name -Group $Group -Direction Inbound -Action Allow `
      -Protocol TCP -LocalPort $Ports -RemoteAddress $w.Remote -Profile Any | Out-Null
  }
}

# 2. Then the blanket ones off.
foreach ($r in $nodeRules) {
  if ($r.Enabled -eq 'True') {
    Write-Host ('  disable ' + $r.DisplayName + ' (' + $r.Profile + ', ' + $r.Action + ')')
    if (-not $WhatIf) { Disable-NetFirewallRule -Name $r.Name }
  }
}

Write-Host ''
Write-Host 'Done. Check from a phone on the shop wifi that https://<wifi address>:8443 still opens.' -ForegroundColor Green
Write-Host 'To put everything back:  ...till-firewall.ps1 -Undo'
