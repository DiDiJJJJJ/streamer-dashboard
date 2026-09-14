# Streamer dashboard: unregister the guard scheduled task.
# ASCII only.
param([switch]$KeepProcess)

$taskName = 'StreamerDashboardGuard'
$dir  = (Get-Location).Path
$log  = Join-Path $dir '_task_unregister.log'
$lines = New-Object System.Collections.ArrayList
function Say($m) { [void]$lines.Add($m); Write-Host $m }

try {
  $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Say 'ERROR: not elevated. Right click the bat and choose Run as administrator.'
    throw 'noadmin'
  }
  $t = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $t) { Say "Task not found: $taskName (nothing to do)" } else {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Say "OK unregistered: $taskName"
  }

  if (-not $KeepProcess) {
    Start-Sleep -Seconds 1
    $w = Get-Process wscript -ErrorAction SilentlyContinue
    if ($w) { Stop-Process -Name wscript -Force -ErrorAction SilentlyContinue; Say ('stopped wscript x' + $w.Count) }
    $n = Get-Process node -ErrorAction SilentlyContinue
    if ($n) { Stop-Process -Name node -Force -ErrorAction SilentlyContinue; Say ('stopped node x' + $n.Count) }
    Say 'guard + server processes stopped'
  } else {
    Say 'processes left running (KeepProcess)'
  }
  Say 'DONE'
} catch {
  if ($_.Exception.Message -ne 'noadmin') { Say ('ERROR: ' + $_.Exception.Message) }
}

Set-Content -Path $log -Value ($lines -join "`r`n") -Encoding UTF8
