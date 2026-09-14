# Streamer dashboard: register _service_guard.vbs as a scheduled task.
# ASCII only. Must be run from the folder that contains _service_guard.vbs.
param([switch]$NoStart)

$taskName = 'StreamerDashboardGuard'
$dir  = (Get-Location).Path
$vbs  = Join-Path $dir '_service_guard.vbs'
$root = Join-Path $dir 'streamer-dashboard'
$log  = Join-Path $dir '_task_register.log'
$lines = New-Object System.Collections.ArrayList

function Say($m) { [void]$lines.Add($m); Write-Host $m }

try {
  $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $isAdmin = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { Say 'ERROR: not elevated. Right click the bat and choose Run as administrator.'; throw 'noadmin' }
  if (-not (Test-Path $vbs)) { Say "ERROR: guard script not found: $vbs"; throw 'novbs' }
  if (-not (Test-Path (Join-Path $root 'server\index.js'))) { Say "ERROR: server\index.js not found under: $root"; throw 'noindex' }

  $user    = $id.Name
  $action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '" //nologo') -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  try { $trigger.Delay = 'PT30S' } catch { }
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                -StartWhenAvailable -DontStopOnIdleEnd -RestartCount 3 `
                -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

  $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
  $task.Settings.ExecutionTimeLimit = 'PT0S'
  $task.Settings.DisallowStartIfOnBatteries = $false

  $null = Register-ScheduledTask -TaskName $taskName -InputObject $task -Force
  Say "OK registered: $taskName"
  Say ('   trigger   : at logon of ' + $user + ', delay 30s')
  Say ('   command   : wscript.exe "' + $vbs + '" //nologo')
  Say ('   workdir   : ' + $root)
  Say '   runtime   : unlimited (PT0S), restart on failure x3, ignore new instance'

  if (-not $NoStart) {
    Start-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 6
    $t = Get-ScheduledTask -TaskName $taskName
    Say ('   state     : ' + $t.State)
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    Say ('   last run  : ' + $info.LastRunTime + '  result=' + $info.LastTaskResult)
    Say '   service   : http://localhost:8787'
  }
  Say 'DONE'
} catch {
  if ($_.Exception.Message -ne 'noadmin' -and $_.Exception.Message -ne 'novbs' -and $_.Exception.Message -ne 'noindex') {
    Say ('ERROR: ' + $_.Exception.Message)
  }
}

Set-Content -Path $log -Value ($lines -join "`r`n") -Encoding UTF8
