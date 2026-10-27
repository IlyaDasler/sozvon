# Установка сервера «Созвон» на домашний ПК с Windows.
# Копирует сервер в постоянную папку, включает встроенный TURN и автозапуск в фоне при входе в Windows.
# Повторный запуск обновляет сервер, сохраняя базу и код приглашения.
#
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-server.ps1 [-PublicIp 1.2.3.4] [-InviteCode код]

param(
  [string]$PublicIp = '',
  [string]$InviteCode = '',
  [int]$Port = 3000,
  [string]$InstallDir = "$env:LOCALAPPDATA\SozvonServer"
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$taskName = 'Sozvon Server'
$configFile = Join-Path $InstallDir 'config.cmd'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Не найден Node.js. Установите его: winget install OpenJS.NodeJS.LTS' }

# Берём прежние настройки, если сервер уже ставился
$previous = @{}
if (Test-Path $configFile) {
  foreach ($line in Get-Content $configFile) {
    if ($line -match '^set "?([A-Z_]+)=([^"]*)"?$') { $previous[$Matches[1]] = $Matches[2] }
  }
}
if (-not $InviteCode) { $InviteCode = $previous['INVITE_CODE'] }
if (-not $InviteCode) {
  $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'.ToCharArray()
  $InviteCode = -join (1..8 | ForEach-Object { $alphabet | Get-Random })
}
if (-not $PublicIp) { $PublicIp = $previous['PUBLIC_IP'] }
if (-not $PublicIp) {
  Write-Host 'Определяю внешний IP...'
  $PublicIp = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 15).Trim()
}

# Останавливаем уже запущенный сервер
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($InstallDir) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Копирую сервер в $InstallDir ..."
$app = Join-Path $InstallDir 'app'
if (Test-Path $app) { Remove-Item -Recurse -Force $app }
New-Item -ItemType Directory -Force -Path $app, "$InstallDir\data", "$InstallDir\logs" | Out-Null
Copy-Item -Recurse "$repo\server\src" "$app\src"
Copy-Item "$repo\server\package.json", "$repo\server\package-lock.json" $app
Copy-Item -Recurse "$repo\client\renderer" "$app\web"

Write-Host 'Устанавливаю зависимости...'
Push-Location $app
try {
  npm ci --omit=dev --no-audit --no-fund | Out-Null
  if ($LASTEXITCODE) { throw 'npm ci завершился с ошибкой' }
} finally { Pop-Location }

# .cmd-файлы пишем в ASCII: cmd.exe плохо читает UTF-8
Set-Content -Encoding ascii -Path $configFile -Value @(
  '@echo off'
  "set `"PORT=$Port`""
  "set `"PUBLIC_IP=$PublicIp`""
  "set `"INVITE_CODE=$InviteCode`""
  'set "TURN_EMBEDDED=1"'
  'set "DATA_DIR=%~dp0data"'
  'set "WEB_DIR=%~dp0app\web"'
)

# Ключи входа через Google / Яндекс / VK. Файл создаётся один раз и дальше не перезаписывается
$oauthFile = Join-Path $InstallDir 'oauth.cmd'
if (-not (Test-Path $oauthFile)) {
  Set-Content -Encoding ascii -Path $oauthFile -Value @(
    '@echo off'
    'rem Keys for sign-in with Google / Yandex / VK (see README). Fill in, then rerun install-server.ps1'
    'set "GOOGLE_CLIENT_ID="'
    'set "GOOGLE_CLIENT_SECRET="'
    'set "YANDEX_CLIENT_ID="'
    'set "YANDEX_CLIENT_SECRET="'
    'set "VK_CLIENT_ID="'
  )
}

# Перезапуск при падении: сервер поднимется снова через 5 секунд
Set-Content -Encoding ascii -Path "$InstallDir\run.cmd" -Value @(
  '@echo off'
  'cd /d "%~dp0app"'
  'call "%~dp0config.cmd"'
  'call "%~dp0oauth.cmd"'
  ':loop'
  "`"$node`" src\index.js >> `"%~dp0logs\server.log`" 2>&1"
  'timeout /t 5 /nobreak >nul'
  'goto loop'
)

# Запуск без окна
Set-Content -Encoding ascii -Path "$InstallDir\start-hidden.vbs" -Value @(
  'Set shell = CreateObject("WScript.Shell")'
  "shell.Run `"cmd /c `"`"$InstallDir\run.cmd`"`"`", 0, False"
)

Write-Host 'Настраиваю автозапуск при входе в Windows...'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$InstallDir\start-hidden.vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Сервер голосовых звонков «Созвон»' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$ok = $false
foreach ($i in 1..20) {
  Start-Sleep -Milliseconds 500
  try { $ok = (Invoke-RestMethod "http://localhost:$Port/api/health" -TimeoutSec 2).ok; if ($ok) { break } } catch {}
}
if (-not $ok) { throw "Сервер не ответил. Смотрите журнал: $InstallDir\logs\server.log" }

$localIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
Write-Host ''
Write-Host 'Сервер «Созвон» запущен и будет стартовать сам при входе в Windows.' -ForegroundColor Green
Write-Host "  Адрес для друзей:   http://${PublicIp}:$Port"
Write-Host "  Адрес в домашней сети: http://${localIp}:$Port"
Write-Host "  Код приглашения:    $InviteCode"
Write-Host "  Папка сервера:      $InstallDir"
Write-Host ''
Write-Host "Проброс портов в роутере на ${localIp}: $Port/TCP, 3478/UDP, 49160-49200/UDP"
Write-Host "Ключи для входа через Google / Яндекс / VK: $oauthFile (после правки запустите этот скрипт ещё раз)"
