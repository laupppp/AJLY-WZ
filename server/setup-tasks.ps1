# 注册两个 Windows 计划任务：开机自动启动服务（无需登录）、每天凌晨 2 点备份数据库
# 用法（管理员 PowerShell）：
#   powershell -ExecutionPolicy Bypass -File .\server\setup-tasks.ps1
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$startBat = Join-Path $PSScriptRoot 'start-windows.bat'
$node = (Get-Command node -ErrorAction Stop).Source

$systemPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$startAction = New-ScheduledTaskAction -Execute $startBat -WorkingDirectory $project
$startTrigger = New-ScheduledTaskTrigger -AtStartup
$startTrigger.Delay = 'PT30S'
$startSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'AJLY 共享采购服务' -Action $startAction -Trigger $startTrigger `
  -Principal $systemPrincipal -Settings $startSettings `
  -Description '安居乐寓采购 H5 共享试用服务端（开机自动启动，不依赖登录）' -Force | Out-Null

$backupAction = New-ScheduledTaskAction -Execute $node -WorkingDirectory $project -Argument 'server/app.js backup'
$backupTrigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.AddHours(2))
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'AJLY 每日数据库备份' -Action $backupAction -Trigger $backupTrigger `
  -Principal $systemPrincipal -Settings $backupSettings `
  -Description '在线备份 shared.sqlite 到数据目录' -Force | Out-Null

Write-Host '已注册：'
Write-Host '  AJLY 共享采购服务     → 开机 30 秒后自动启动（无需登录）'
Write-Host '  AJLY 每日数据库备份   → 每天 02:00'
Write-Host ''
Write-Host '数据目录：' (Join-Path (Split-Path $project -Parent) 'ajly-shared-data')
Write-Host '现在可先手动启动：' $startBat
