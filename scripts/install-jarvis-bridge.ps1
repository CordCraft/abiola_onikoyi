# Installs the Jarvis bridge on this Windows computer as a logon task.
#   powershell -ExecutionPolicy Bypass -File install-jarvis-bridge.ps1
#   powershell -ExecutionPolicy Bypass -File install-jarvis-bridge.ps1 -Uninstall
# Pair first:  node "$HOME\.claude\jarvis-bridge.mjs" pair <CODE> --name "My PC"
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$taskName = "Jarvis Bridge"
$claudeDir = Join-Path $env:USERPROFILE ".claude"
$target = Join-Path $claudeDir "jarvis-bridge.mjs"

if ($Uninstall) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $claudeDir "jarvis-bridge.lock") -ErrorAction SilentlyContinue
  Write-Host "Removed the '$taskName' task. Left in place: $target and jarvis-bridge.json (delete them by hand if you want)."
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js 20+ is required but 'node' was not found on PATH." }

$source = Join-Path $PSScriptRoot "jarvis-bridge.mjs"
if (-not (Test-Path $source)) { throw "jarvis-bridge.mjs not found next to this script." }
New-Item -ItemType Directory -Force $claudeDir | Out-Null
Copy-Item $source $target -Force
Write-Host "Copied bridge to $target"

# Hidden launch through a tiny VBScript-free approach: powershell -WindowStyle Hidden.
$log = Join-Path $claudeDir "jarvis-bridge.log"
$cmd = "& '$node' '$target' run *>> '$log'"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Registered scheduled task '$taskName' (starts at logon, hidden, restarts on failure)."
Write-Host "Start it now with:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Log file: $log"
