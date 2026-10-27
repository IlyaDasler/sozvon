# Отключает автозапуск и останавливает сервер «Созвон». База и настройки остаются в папке сервера.
#   powershell -ExecutionPolicy Bypass -File deploy\windows\uninstall-server.ps1

param([string]$InstallDir = "$env:LOCALAPPDATA\SozvonServer")

$taskName = 'Sozvon Server'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
# Сначала цикл перезапуска (cmd), потом сам сервер (node)
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($InstallDir) } |
  Sort-Object { $_.Name -ne 'cmd.exe' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Сервер остановлен, автозапуск отключён. Данные остались в $InstallDir"
