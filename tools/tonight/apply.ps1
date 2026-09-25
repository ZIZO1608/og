# =============================================================================
#  tools/tonight/apply.ps1 - put server\.env.next live, prove it, or roll back
#  (day shift 06). Windows PowerShell 5.1, ASCII only. The work is done by
#  apply.mjs beside it (Node is what the server runs on, so the checks are the
#  server's own language); this wrapper finds Node and passes the switches.
#
#  AFTER CLOSING: close the shop in the OG System window first, then
#
#    cd "D:\DESKTOP\OG System"
#    powershell -ExecutionPolicy Bypass -File tools\tonight\apply.ps1 -Now
#
#  Without -Now it runs only between 00:30 and 07:00 Damascus time.
#  Exit 0 PASS (press "Open the shop" in the window), 2 rolled back and the
#  old .env works, 3 refused (nothing changed), 4 rolled back and the old .env
#  ALSO fails - do not open the shop, read the output.
#
#  Sandbox (tests only):  -EnvFile <file> -DataDir <dir> -User <name> -Accounts <file>
# =============================================================================
param(
  [switch]$Now,
  [string]$EnvFile = '',
  [string]$DataDir = '',
  [string]$User = '',
  [string]$Accounts = ''
)
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host 'Node is not on PATH.' -ForegroundColor Red; exit 3 }
$a = @((Join-Path $PSScriptRoot 'apply.mjs'))
if ($Now) { $a += '--now' }
if ($EnvFile) { $a += @('--env-file', $EnvFile) }
if ($DataDir) { $a += @('--data-dir', $DataDir) }
if ($User) { $a += @('--user', $User) }
if ($Accounts) { $a += @('--accounts', $Accounts) }
& $node.Source @a
exit $LASTEXITCODE
