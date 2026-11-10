# Android APK

## Что уже собрано

Debug APK: `client/android/app/build/outputs/apk/debug/app-debug.apk`.

- package `ru.ilyadasler.sozvon.mobile`;
- minSdk 24, targetSdk/compileSdk 36;
- Capacitor WebView, локальные веб-ассеты;
- разрешения INTERNET, RECORD_AUDIO, CAMERA, MODIFY_AUDIO_SETTINGS, POST_NOTIFICATIONS;
- подпись debug-ключом из `android/debug.keystore`;
- CORS на Go-сервере разрешает `https://localhost`.

## Что нужно для настоящего APK

1. **Firebase**: создать Android-приложение `ru.ilyadasler.sozvon.mobile`, приложить `google-services.json` и серверный ключ FCM. Без этого не будет push и фоновых звонков.
2. **Release keystore**: `.jks`, alias и пароли. Debug-ключ не годится для публикации.
3. **Проверка на эмуляторе/устройстве**: эмулятор Pixel 7 (Android 35) установлен, но загрузка зависла на offline; нужен рабочий WHPX/гипервизор или физическое устройство.
4. **Переключить native API** с `http://10.0.2.2:3001` на `https://135-106-226-12.sslip.io` после проверки и убрать `usesCleartextTraffic` для release.
5. **Проверить WebRTC-разрешения** WebView на устройстве: микрофон, камера, аудиофокус.

## Команды

```powershell
# assets
cd client
npx cap sync android

# debug APK
$env:JAVA_HOME=...jdk21
$env:ANDROID_HOME=...sdk
cd android
..\gradle\bin\gradle.bat assembleDebug --no-daemon
```

## Статус

APK **собирается**, но это debug-сборка с локальным API. Публичный APK не выпускается.


## Внутренний release-ключ

Ключ создан:

```text
_secrets/sozvon-internal-release.jks
_secrets/keystore.properties
```

SHA-256:

```text
92:5F:88:D1:4E:F4:E3:84:57:91:54:FF:8B:03:E0:91:61:BC:1A:8B:DC:D0:01:AD:77:91:22:DB:BD:76:EB:1B
```

Release APK с прод-API и FCM:

```text
client/android/app/build/outputs/apk/release/app-release.apk
```

**Ключ нельзя терять.** Бэкап `_secrets` обязателен. Для Google Play лучше
использовать Play App Signing и отдельный upload key.
