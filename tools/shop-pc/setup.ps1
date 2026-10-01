# =============================================================================
#  OG System - set up the SHOP PC.  Windows PowerShell 5.1, ASCII only.
# -----------------------------------------------------------------------------
#  This file lives in the kit made by tools/shop-pc/make-kit.mjs on the
#  development laptop. The shop PC is the till's hardware hub and the VPS's
#  offline standby: the shop runs on the VPS (shop.ogsports1.com), and this PC
#  keeps a copy every five minutes and takes the till when the internet drops.
#  It holds NO cloud keys, NO bot tokens and NO vault key - the VPS does those.
#
#    1-Install.cmd   setup.ps1            everything, in order (safe to run again)
#    2-Update.cmd    setup.ps1 -Update    new code from a newer kit; keeps the
#                                         settings, the database and the logs
#    3-Check.cmd     setup.ps1 -Check     changes nothing; says what is wrong
#
#  Other switches: -Target <folder> (default C:\OG System), -AllowPia (build the
#  tunnel through PIA anyway), -ReplaceConfig (overwrite server\.env and the
#  agent's config with the kit's), -SkipPrinters.
#
#  Every step checks its own work and the summary at the end lists them.
#  A step that fails does not stop the ones after it unless they need it.
# =============================================================================
param(
  [string]$Target = 'C:\OG System',
  [switch]$Update,
  [switch]$Check,
  [switch]$AllowPia,
  [switch]$ReplaceConfig,
  [switch]$SkipPrinters
)

$ErrorActionPreference = 'Stop'
# ABSOLUTE, always: robocopy matches /XD and /XF against the normalised path,
# and a target given as "..\x" made it ignore the exclusions and /MIR deleted
# server\.env and the database (measured on a scratch copy, 1 Oct 2026).
$Target = [IO.Path]::GetFullPath($Target).TrimEnd('\')
$Kit = $PSScriptRoot
$App = Join-Path $Kit 'app'
$Inst = Join-Path $Kit 'installers'
$Sec = Join-Path $Kit 'secrets'
$TunnelAddr = '10.8.0.3'
$VpsAddr = '10.8.0.1'
$Results = New-Object System.Collections.ArrayList

function Say([string]$t, [string]$c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Head([string]$t) { Write-Host ''; Write-Host ('== ' + $t) -ForegroundColor Cyan }
function Note([string]$step, [string]$state, [string]$detail) {
  [void]$Results.Add([pscustomobject]@{ Step = $step; State = $state; Detail = $detail })
  $col = @{ OK = 'Green'; SKIP = 'DarkGray'; WARN = 'Yellow'; FAIL = 'Red' }[$state]
  Say ('   ' + $state + '  ' + $detail) $col
}

# ---- 0. Administrator (asks once, then everything runs from here) -----------
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $Check) {
  Say 'Asking Windows for administrator - press Yes.' Yellow
  $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-Target', ('"' + $Target + '"'))
  if ($Update) { $argv += '-Update' }
  if ($AllowPia) { $argv += '-AllowPia' }
  if ($ReplaceConfig) { $argv += '-ReplaceConfig' }
  if ($SkipPrinters) { $argv += '-SkipPrinters' }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $argv
  exit 0
}

$logName = 'setup-log-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.txt'
try { Start-Transcript -Path (Join-Path $Kit $logName) -Force | Out-Null } catch { }

$mode = if ($Check) { 'CHECK (changes nothing)' } elseif ($Update) { 'UPDATE' } else { 'INSTALL' }
Say ''
Say '  OG SYSTEM - shop PC setup' Green
Say ('    mode   : ' + $mode)
Say ('    kit    : ' + $Kit)
Say ('    target : ' + $Target)
$verFile = Join-Path $Kit 'VERSION.txt'
if (Test-Path $verFile) { Say ('    code   : ' + ((Get-Content $verFile | Select-Object -First 1))) }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Node-Exe {
  Refresh-Path
  $c = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $p) { return $p }
  return $null
}
function Node-Ok([string]$exe) {
  if (-not $exe) { return $false }
  $v = (& $exe -p 'process.versions.node' 2>$null | Out-String).Trim()
  if (-not $v) { return $false }
  $parts = $v.Split('.')
  $maj = [int]$parts[0]; $min = [int]$parts[1]
  return ($maj -gt 22 -or ($maj -eq 22 -and $min -ge 5))
}
function Run-Node([string]$dir, [string[]]$nodeArgs) {
  $exe = Node-Exe
  Push-Location $dir
  try {
    $ErrorActionPreference = 'Continue'
    & $exe @nodeArgs 2>&1 | ForEach-Object { Say ('      ' + $_) }
    return $LASTEXITCODE
  } finally { Pop-Location; $ErrorActionPreference = 'Stop' }
}
function Msi([string]$pattern, [string]$extra) {
  $f = Get-ChildItem $Inst -Filter $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $f) { return 'missing' }
  $sig = Get-AuthenticodeSignature $f.FullName
  if ($sig.Status -ne 'Valid') { return ('unsigned: ' + $sig.Status) }
  $argv = '/i "' + $f.FullName + '" /qn /norestart ' + $extra
  $p = Start-Process msiexec.exe -ArgumentList $argv -Wait -PassThru
  if ($p.ExitCode -eq 0 -or $p.ExitCode -eq 3010) { return 'ok' }
  return ('msiexec exit ' + $p.ExitCode)
}
$Server = Join-Path $Target 'server'

# ---- 1. Node.js ------------------------------------------------------------
Head '1. Node.js (22.5 or newer)'
$node = Node-Exe
if (Node-Ok $node) {
  Note 'Node.js' 'OK' ('already here: ' + (& $node -v))
} elseif ($Check) {
  Note 'Node.js' 'FAIL' 'not installed (or older than 22.5)'
} else {
  $r = Msi 'node-*.msi' ''
  $node = Node-Exe
  if ($r -eq 'ok' -and (Node-Ok $node)) { Note 'Node.js' 'OK' ('installed: ' + (& $node -v)) }
  else { Note 'Node.js' 'FAIL' ('could not install from the kit (' + $r + ')') }
}

# ---- 2. WireGuard ----------------------------------------------------------
Head '2. WireGuard (the private line to the VPS)'
$wgExe = Join-Path $env:ProgramFiles 'WireGuard\wireguard.exe'
if (Test-Path $wgExe) { Note 'WireGuard' 'OK' 'already installed' }
elseif ($Check) { Note 'WireGuard' 'FAIL' 'not installed' }
else {
  $r = Msi 'wireguard-*.msi' 'DO_NOT_LAUNCH=1'
  if ((Test-Path $wgExe)) { Note 'WireGuard' 'OK' 'installed' } else { Note 'WireGuard' 'FAIL' ('could not install from the kit (' + $r + ')') }
}

# ---- 3. The app -------------------------------------------------------------
Head ('3. The app, in ' + $Target)
$exe = Join-Path $Target 'OG System.exe'
if ($Check) {
  if (Test-Path $exe) {
    $have = Join-Path $Target 'VERSION.txt'
    $v = if (Test-Path $have) { (Get-Content $have | Select-Object -First 1) } else { '(no VERSION.txt)' }
    Note 'App' 'OK' ('installed - ' + $v)
  } else { Note 'App' 'FAIL' 'not installed' }
} elseif (-not (Test-Path (Join-Path $App 'panel\panel.js'))) {
  Note 'App' 'FAIL' ('the kit has no app folder: ' + $App)
} else {
  $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like ($Target + '\*') })
  if ($running.Count -gt 0) {
    Say '   OG System is running from this folder. Right-click the OG icon by the clock -> Quit,' Yellow
    Say '   answer Yes, wait until it is gone, then press Enter here.' Yellow
    [void](Read-Host '   Press Enter when it is closed')
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like ($Target + '\*') -and $_.ProcessName -ne 'node' })
  }
  if ($running.Count -gt 0) {
    Note 'App' 'FAIL' 'OG System is still running - nothing was copied'
  } else {
    New-Item -ItemType Directory -Force $Target | Out-Null
    # /MIR makes the folder match the kit, EXCEPT what belongs to this PC:
    # its settings, its database, its backups and the logs. Excluded files are
    # never deleted by /MIR either. Named twice - by full path AND by bare
    # name (no folder or file in the app shares these names) - so a path
    # robocopy reads differently can never cost the shop its database.
    $xd = @((Join-Path $Server 'data'), (Join-Path $Server 'backups'), 'data', 'backups')
    $xf = @((Join-Path $Server '.env'), (Join-Path $Target 'agent\agent-config.json'), (Join-Path $Target 'agent\agent.log'), '.env', 'agent-config.json', 'agent.log', 'agent.log.old')
    $argv = @($App, $Target, '/MIR', '/R:2', '/W:2', '/NFL', '/NDL', '/NP', '/NJH', '/XD') + $xd + @('/XF') + $xf
    $ErrorActionPreference = 'Continue'
    & robocopy.exe @argv | Out-Null
    $rc = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($rc -lt 8) {
      Copy-Item $verFile (Join-Path $Target 'VERSION.txt') -Force -ErrorAction SilentlyContinue
      Note 'App' 'OK' ('copied (robocopy ' + $rc + ')')
    } else { Note 'App' 'FAIL' ('robocopy failed with ' + $rc) }
  }
}

# ---- 4. This PC's settings ---------------------------------------------------
Head '4. Settings (server\.env and the print agent)'
$pairs = @(
  @{ name = 'server\.env'; src = (Join-Path $Sec 'shop-pc.env'); dst = (Join-Path $Server '.env') },
  @{ name = 'agent-config.json'; src = (Join-Path $Sec 'agent-config.json'); dst = (Join-Path $Target 'agent\agent-config.json') }
)
foreach ($p in $pairs) {
  $has = Test-Path $p.dst
  if ($Check -or $Update) {
    if ($has) { Note $p.name 'OK' 'present (kept)' } else { Note $p.name 'FAIL' 'missing - run 1-Install.cmd' }
    continue
  }
  if (-not (Test-Path $p.src)) { if ($has) { Note $p.name 'WARN' 'kept the one already here; the kit has none' } else { Note $p.name 'FAIL' 'the kit has none (secrets folder)' }; continue }
  if ($has -and -not $ReplaceConfig) {
    $same = ((Get-FileHash $p.src).Hash -eq (Get-FileHash $p.dst).Hash)
    if ($same) { Note $p.name 'OK' 'already the kit''s' } else { Note $p.name 'WARN' 'a different one is already here - KEPT (-ReplaceConfig to overwrite)' }
    continue
  }
  if (Test-Path (Split-Path $p.dst)) { Copy-Item $p.src $p.dst -Force; Note $p.name 'OK' 'written' }
  else { Note $p.name 'FAIL' 'the app is not installed yet' }
}
$envFile = Join-Path $Server '.env'
if (Test-Path $envFile) {
  $envText = Get-Content $envFile -Raw
  if ($envText -notmatch '(?m)^OG_ROLE=standby') { Note 'Role' 'FAIL' 'server\.env does not say OG_ROLE=standby' }
  elseif ($envText -match '(?m)^(SUPABASE_SERVICE_KEY|OG_TELEGRAM_TOKEN_OG|OG_VAULT_KEY)=') { Note 'Role' 'WARN' 'standby, but server\.env holds cloud keys it should not' }
  else { Note 'Role' 'OK' 'standby of the VPS, no cloud keys' }
}

# ---- 5. The tunnel -----------------------------------------------------------
Head ('5. The tunnel (this PC = ' + $TunnelAddr + ', the VPS = ' + $VpsAddr + ')')
$svc = Get-Service -Name 'WireGuardTunnel$og-shop' -ErrorAction SilentlyContinue
if ($Update) {
  if ($svc -and $svc.Status -eq 'Running') { Note 'Tunnel' 'OK' 'running (not touched by an update)' } else { Note 'Tunnel' 'WARN' 'not running - run 1-Install.cmd' }
} elseif ($Check) {
  if ($svc -and $svc.Status -eq 'Running') { Note 'Tunnel' 'OK' 'service running' } else { Note 'Tunnel' 'FAIL' 'service not running' }
} elseif (-not (Test-Path $wgExe)) {
  Note 'Tunnel' 'FAIL' 'WireGuard is not installed'
} else {
  $keySrc = Join-Path $Sec 'wg-shop-pc.key'
  $vpsPub = Join-Path $Sec 'wg-vps.pub'
  $confDir = Join-Path $env:ProgramData 'OGSystem\wg'
  $keyDst = Join-Path $confDir 'og-shop.key'
  if (-not (Test-Path $keySrc) -or -not (Test-Path $vpsPub)) {
    Note 'Tunnel' 'FAIL' 'the kit has no tunnel keys (secrets\wg-shop-pc.key, wg-vps.pub)'
  } else {
    New-Item -ItemType Directory -Force $confDir | Out-Null
    Copy-Item $keySrc $keyDst -Force
    $tillSide = Join-Path $Target 'tools\wg-test\till-side.ps1'
    $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tillSide, '-ServerPublicKey', ((Get-Content $vpsPub -Raw).Trim()), '-Address', ($TunnelAddr + '/24'), '-KeyFile', $keyDst)
    if ($AllowPia) { $argv += '-AllowPia' }
    $ErrorActionPreference = 'Continue'
    & powershell.exe @argv
    $rc = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    switch ($rc) {
      0 { Note 'Tunnel' 'OK' 'up - the VPS answers over it' }
      3 { Note 'Tunnel' 'FAIL' 'PIA is connected - disconnect it, or run again with -AllowPia' }
      4 { Note 'Tunnel' 'FAIL' 'UDP BLOCKED by the shop''s line - see tools\wg-test\FALLBACK.md' }
      5 { Note 'Tunnel' 'FAIL' 'VPS UNREACHABLE from this line (the Arelion route?) - try with PIA Netherlands + -AllowPia' }
      default { Note 'Tunnel' 'FAIL' ('till-side.ps1 exit ' + $rc) }
    }
  }
}
try {
  $h = Invoke-RestMethod -Uri ('http://' + $VpsAddr + ':8090/api/health') -TimeoutSec 8
  Note 'Main server' 'OK' ('answers over the tunnel (role ' + $h.role + ')')
} catch { Note 'Main server' 'FAIL' ('no answer from http://' + $VpsAddr + ':8090 - the copy cannot be fetched') }

# ---- 6. Firewall --------------------------------------------------------------
Head '6. Firewall (phones on the shop wifi may reach this PC)'
$ruleName = 'OG System - shop server (node)'
$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
$node = Node-Exe
if ($rule) { Note 'Firewall' 'OK' 'rule present' }
elseif ($Check -or $Update) { Note 'Firewall' 'WARN' 'no rule - run 1-Install.cmd' }
elseif (-not $node) { Note 'Firewall' 'FAIL' 'no node.exe to name in the rule' }
else {
  # Named for node.exe, so Windows never shows its "allow access?" box - a box
  # somebody closes with the X makes a BLOCK rule that beats any allow.
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Program $node -Protocol TCP -LocalPort 8090, 8443 -RemoteAddress LocalSubnet, $VpsAddr -Profile Any | Out-Null
  Note 'Firewall' 'OK' 'node.exe allowed on 8090/8443 from the shop wifi and the VPS only'
}

# ---- 7. Certificate -------------------------------------------------------------
Head '7. The padlock (https certificate, trusted by Windows)'
if (-not (Test-Path $Server)) { Note 'Certificate' 'FAIL' 'the app is not installed' }
else {
  $certPem = Join-Path $Server 'data\certs\cert.pem'
  $hasCert = (Test-Path $certPem) -or (@(Get-ChildItem (Join-Path $Server 'data\certs') -Filter *.pem -ErrorAction SilentlyContinue).Count -gt 0)
  if (-not $hasCert -and -not $Check -and -not $Update) {
    $rc = Run-Node $Server @('scripts/make-cert.js')
    if ($rc -ne 0) { Note 'Certificate' 'FAIL' ('make-cert exit ' + $rc) }
  }
  if ($Check) { $rc = Run-Node $Server @('scripts/trust-cert.js', '--check') } else { $rc = Run-Node $Server @('scripts/trust-cert.js') }
  if ($rc -eq 0) { Note 'Certificate' 'OK' 'made and trusted' } else { Note 'Certificate' 'WARN' ('trust-cert exit ' + $rc + ' - the launcher asks again on first Start') }
}

# ---- 8. Printers ------------------------------------------------------------------
Head '8. Printers (receipt + label) - plug them in and switch them on first'
if ($SkipPrinters) { Note 'Printers' 'SKIP' '-SkipPrinters' }
elseif (-not (Test-Path $Server)) { Note 'Printers' 'FAIL' 'the app is not installed' }
else {
  $rc = Run-Node $Server @('scripts/hardware.js')
  if ($rc -eq 4 -and -not $Check) {
    Say '   Something is missing that can be installed - installing.' Yellow
    [void](Run-Node $Server @('scripts/hardware.js', '--install'))
    $rc = Run-Node $Server @('scripts/hardware.js')
  }
  switch ($rc) {
    0 { Note 'Printers' 'OK' 'queues found and shared' }
    4 { Note 'Printers' 'WARN' 'something installable is still missing - see the lines above' }
    default { Note 'Printers' 'WARN' 'needs a person - see the lines above (the shop still opens)' }
  }
}

# ---- 9. Print agent ---------------------------------------------------------------
Head '9. The print agent (prints the receipts and labels the VPS sends)'
$task = 'OGLabelAgent'
$runCmd = Join-Path $Target 'agent\run-agent.cmd'
$have = $false
$ErrorActionPreference = 'Continue'
schtasks /query /tn $task 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $have = $true }
$ErrorActionPreference = 'Stop'
if ($Check -or $Update) {
  if ($have) { Note 'Print agent' 'OK' 'task registered' } else { Note 'Print agent' 'FAIL' 'task not registered' }
  if ($Update -and $have) { $ErrorActionPreference = 'Continue'; schtasks /end /tn $task 2>$null | Out-Null; schtasks /run /tn $task 2>$null | Out-Null; $ErrorActionPreference = 'Stop'; Note 'Print agent' 'OK' 'restarted on the new code' }
} elseif (-not (Test-Path (Join-Path $Target 'agent\agent-config.json'))) {
  Note 'Print agent' 'FAIL' 'no agent-config.json'
} else {
  # As agent\install-agent.bat does it: no window (a console somebody closes
  # stops every receipt), starts at logon, LIMITED - it needs nothing more.
  # No /ru: the task belongs to whoever runs this, exactly as the .bat does -
  # on the shop PC that is the one account that signs in by itself.
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $tr = 'conhost.exe --headless cmd.exe /c "' + $runCmd + '"'
  $ErrorActionPreference = 'Continue'
  schtasks /create /tn $task /tr $tr /sc ONLOGON /rl LIMITED /f | Out-Null
  $ok = ($LASTEXITCODE -eq 0)
  schtasks /run /tn $task 2>$null | Out-Null
  $ErrorActionPreference = 'Stop'
  if ($ok) { Note 'Print agent' 'OK' ('registered for ' + $user + ' and started') } else { Note 'Print agent' 'FAIL' 'schtasks refused' }
}

# ---- 10. Stays on by itself -----------------------------------------------------------
Head '10. Always on (starts with Windows, never sleeps on mains)'
if (-not (Test-Path $Server)) { Note 'Always on' 'FAIL' 'the app is not installed' }
else {
  if ($Check -or $Update) { $rc = Run-Node $Server @('scripts/always-on.js') } else { $rc = Run-Node $Server @('scripts/always-on.js', '--apply') }
  if ($rc -eq 0) { Note 'Always on' 'OK' 'see the lines above' } else { Note 'Always on' 'WARN' ('always-on exit ' + $rc + ' - see the lines above (sign-in by itself is a person''s step)') }
}

# ---- 11. Signs in by itself -----------------------------------------------------------
if (-not $Check -and -not $Update) {
  Head '11. Windows signs in by itself after a power cut'
  $al = Join-Path $Inst 'Autologon64.exe'
  $wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue
  if ($wl -and $wl.AutoAdminLogon -eq '1') { Note 'Auto sign-in' 'OK' ('already on for ' + $wl.DefaultUserName) }
  elseif (-not (Test-Path $al)) { Note 'Auto sign-in' 'WARN' 'Autologon64.exe is not in the kit - do it by hand' }
  else {
    Say '   Autologon opens now. Type this Windows account''s password, press Enable, close it.' Yellow
    Say '   (It keeps the password encrypted - never in a plain registry value.)'
    Start-Process $al -ArgumentList '/accepteula' -Wait
    $wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue
    if ($wl -and $wl.AutoAdminLogon -eq '1') { Note 'Auto sign-in' 'OK' 'on' } else { Note 'Auto sign-in' 'WARN' 'not enabled' }
  }
}

# ---- 12. Desktop icon, and open it -----------------------------------------------------
if (-not $Check) {
  Head '12. The desktop icon, and opening OG System'
  if (Test-Path $exe) {
    try {
      $desk = [Environment]::GetFolderPath('Desktop')
      $ws = New-Object -ComObject WScript.Shell
      $lnk = $ws.CreateShortcut((Join-Path $desk 'OG System.lnk'))
      $lnk.TargetPath = $exe
      $lnk.WorkingDirectory = $Target
      $lnk.IconLocation = $exe + ',0'
      $lnk.Save()
      Note 'Desktop icon' 'OK' 'OG System on the desktop'
    } catch { Note 'Desktop icon' 'WARN' $_.Exception.Message }
    # Through explorer.exe, so OG System runs as the ordinary user and NOT
    # with this window's administrator rights.
    Start-Process explorer.exe -ArgumentList ('"' + $exe + '"')
    Note 'Open' 'OK' 'started - the first Start asks Windows once for the domain route (press Yes)'
  } else { Note 'Open' 'FAIL' 'OG System.exe is not there' }
}

# ---- 13. The shop copy here (only meaningful once it has run a few minutes) ------------
if ($Check) {
  Head '13. This PC''s standby'
  try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8090/api/health' -TimeoutSec 5
    $c = $h.standby
    $d = if ($c -and $c.copyAt) { 'copy as of ' + $c.copyAt } else { 'no copy yet' }
    if ($h.role -eq 'standby') { Note 'Standby' 'OK' $d } else { Note 'Standby' 'WARN' ('answers as ' + $h.role) }
  } catch { Note 'Standby' 'WARN' 'OG System is not open on this PC' }
  if (Test-Path $Server) {
    $rc = Run-Node $Server @('scripts/tunnel-route.js', '--check', '--probe')
    if ($rc -eq 0) { Note 'Domain route' 'OK' 'shop.ogsports1.com goes through the tunnel' } else { Note 'Domain route' 'WARN' ('tunnel-route exit ' + $rc + ' - the launcher fixes it after Start') }
  }
}

# ---- Summary -------------------------------------------------------------------------
Head 'Summary'
$Results | Format-Table -AutoSize | Out-String | Write-Host
$fails = @($Results | Where-Object { $_.State -eq 'FAIL' }).Count
$warns = @($Results | Where-Object { $_.State -eq 'WARN' }).Count
if ($fails -eq 0 -and $warns -eq 0) { Say 'Everything is ready.' Green }
elseif ($fails -eq 0) { Say ('Ready, with ' + $warns + ' thing(s) to look at.') Yellow }
else { Say ($fails.ToString() + ' step(s) failed - fix them and run this again (it is safe to repeat).') Red }
Say ('The full log: ' + (Join-Path $Kit $logName))
try { Stop-Transcript | Out-Null } catch { }
if (-not $Check) { [void](Read-Host 'Press Enter to close') }
if ($fails -gt 0) { exit 1 } else { exit 0 }
