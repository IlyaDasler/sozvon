; Перед установкой и удалением закрываем запущенный Созвон сами, без окна «Не удалось закрыть Sozvon»:
; сначала просим закрыться (как крестик окна), через полторы секунды — принудительно.
; Только процессы текущего пользователя.
!macro customCheckAppRunning
  DetailPrint "Закрываем Созвон…"
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  Pop $0
  Sleep 1500
  nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /FI "USERNAME eq %USERNAME%"`
  Pop $0
  Sleep 700
!macroend

; Обновление всегда идёт с видимым окошком «Установка…», даже если старая версия приложения попросила
; ставить молча: иначе кажется, что Созвон просто пропал, и люди жмут ярлык посреди установки
!macro customInit
  ${if} ${isUpdated}
    SetSilent normal
  ${endIf}
!macroend

; После установки Созвон запускаем прямо по пути к exe, а не через ярлык в меню «Пуск»:
; ярлыки в обновлении не участвуют, и Windows ничего не ищет
!macro customInstall
  StrCpy $launchLink "$appExe"
!macroend
