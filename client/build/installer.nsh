; Перед установкой и удалением закрываем запущенный Созвон сами, без окна «Не удалось закрыть Sozvon»:
; сначала просим закрыться (как крестик окна), через полторы секунды — принудительно.
; Только процессы текущего пользователя.
!macro customCheckAppRunning
  DetailPrint "Закрываем Созвон…"
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  Pop $0
  Sleep 1500
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  Pop $0
  Sleep 700
!macroend
