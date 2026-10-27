; Перед установкой и удалением освобождаем папку Созвона сами (build/free-files.ps1): закрываем всё,
; что запущено из неё, ждём, пока антивирус отпустит файлы, а запущенный от администратора Созвон
; закрываем с подтверждением Windows. Иначе старый деинсталлятор не может перенести занятые файлы,
; и установщик показывает «Не удалось закрыть Sozvon».
!macro customCheckAppRunning
  DetailPrint "Закрываем Созвон…"
  InitPluginsDir
  File /oname=$PLUGINSDIR\free-files.ps1 "${BUILD_RESOURCES_DIR}\free-files.ps1"

  freeFiles:
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\free-files.ps1" -Dir "$INSTDIR" -Exe "${APP_EXECUTABLE_FILENAME}" -Report "$PLUGINSDIR\lockers.txt"`
  Pop $0
  ${if} $0 == 3
    StrCpy $2 ""
    ClearErrors
    FileOpen $1 "$PLUGINSDIR\lockers.txt" r
    ${ifNot} ${Errors}
      FileReadUTF16LE $1 $2
      FileClose $1
    ${endIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Файлы Созвона сейчас заняты программой: $2.$\r$\n$\r$\nЗакройте её (или перезагрузите компьютер) и нажмите «Повтор»." /SD IDCANCEL IDRETRY freeFiles
    Quit
  ${elseIf} $0 != 0
    ; PowerShell недоступен — закрываем по имени, как раньше
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}"`
    Pop $0
    Sleep 1500
  ${endIf}
!macroend

; Удаление старых файлов без «всё или ничего»: файл, который не удалось удалить, просто перезапишется новой версией.
; Стандартный способ переносит все файлы и при одном занятом прерывает обновление
!macro customRemoveFiles
  SetOutPath $TEMP
  RMDir /r $INSTDIR
!macroend

; Обновление всегда идёт с видимым окошком «Установка…», даже если старая версия приложения попросила
; ставить молча: иначе кажется, что Созвон просто пропал, и люди жмут ярлык посреди установки
!macro customInit
  ${if} ${isUpdated}
    SetSilent normal
  ${endIf}

  ; Старая копия могла стоять в папке, куда без прав администратора не записать (например, Program Files —
  ; её когда-то выбирали в установщике «с вопросами»). Тогда старый деинсталлятор не может убрать файлы,
  ; и установщик показывает «Не удалось закрыть Sozvon». Ставим в обычную папку пользователя, а старую копию
  ; не трогаем: приложение потом предложит её удалить (путь сохраняем в Software\Sozvon\OldInstallLocation)
  ; (папку может быть нельзя даже просмотреть, поэтому проверяем попыткой создать файл)
  ${if} $INSTDIR != "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    ClearErrors
    FileOpen $0 "$INSTDIR\.sozvon-write-test" w
    ${if} ${Errors}
      WriteRegStr HKCU "Software\Sozvon" "OldInstallLocation" "$INSTDIR"
      DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
      !endif
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    ${else}
      FileClose $0
      Delete "$INSTDIR\.sozvon-write-test"
    ${endIf}
  ${endIf}
!macroend

; После установки Созвон запускаем прямо по пути к exe, а не через ярлык в меню «Пуск»:
; ярлыки в обновлении не участвуют, и Windows ничего не ищет
!macro customInstall
  StrCpy $launchLink "$appExe"
!macroend
