param(
  [Parameter(Mandatory)][string]$AccountSid,
  [Parameter(Mandatory)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$LanHost,
  [Parameter(Mandatory)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}/\d{1,2}$')][string]$LanCidr
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = 'C:\Program Files\nodejs\node.exe'
$systemPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$principal = New-ScheduledTaskPrincipal -UserId $AccountSid -LogonType S4U -RunLevel Limited
$startupArguments = '-NoProfile -NonInteractive -Command "$env:AJLY_LAN_TRIAL=''1''; $env:AJLY_LAN_HOST=''{0}''; $env:AJLY_LAN_CIDR=''{1}''; $env:AJLY_DEV_PORT=''3012''; & ''C:\Program Files\nodejs\node.exe'' ''.\server\dev.js''; exit $LASTEXITCODE"' -f $LanHost, $LanCidr
$startupAction = New-ScheduledTaskAction -Execute $systemPowerShell -WorkingDirectory $project -Argument $startupArguments
$backupAction = New-ScheduledTaskAction -Execute $node -WorkingDirectory $project -Argument 'server/dev.js backup'
$startupSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$startupTrigger.Delay = 'PT45S'
Register-ScheduledTask -TaskName 'AJLY-WZ LAN Startup' -Action $startupAction -Trigger $startupTrigger -Principal $principal -Settings $startupSettings -Force | Out-Null
$backupTrigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.AddHours(2))
Register-ScheduledTask -TaskName 'AJLY-WZ SQLite Backup' -Action $backupAction -Trigger $backupTrigger -Principal $principal -Settings $backupSettings -Force | Out-Null
Start-ScheduledTask -TaskName 'AJLY-WZ SQLite Backup'
