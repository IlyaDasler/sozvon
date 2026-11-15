# Desktop UI audit — 2026-11-13

## Current desktop + mobile security recheck — 2026-11-15

- Rechecked the separate desktop `main` and mobile `mobile-stage3` source trees on 2026-11-15. Desktop client tests pass 100/100; mobile client tests pass 126/126. `npm audit --audit-level=info` reports zero advisories across both dependency trees.
- Both Go backend trees pass `go test ./...`, `go vet ./...`, and `govulncheck ./...` with no known vulnerabilities (latest rerun: 2026-11-15).
- The desktop Electron review covers sandbox/context isolation, navigation and popup restrictions, sender-scoped PiP IPC, permission origin and main-frame validation, HTTPS-only remote API transport, protected session persistence, and CSP. The Android review covers the Capacitor-only native bridge, disabled cleartext/backup, debug-only WebView inspection, and PKCE-bound OAuth code exchange.
- This source and automated-test review does not include a dynamic penetration test, live VPS/proxy/TLS inspection, real provider login, Firebase cloud configuration, or an unlocked-device permission test. See the mobile `SECURITY-AUDIT.md` for the combined findings and remaining risks.

## Phone identity status contract — 2026-11-15

- Desktop previously treated an omitted `/me.hasPhone` field as `false` and offered a new phone link. It now distinguishes confirmed linked, confirmed unlinked, and status unavailable; the unavailable state disables linking until the server reports a reliable value. Legacy phone fields remain recognized without displaying the number.
- Re-run against the current 3.6.7 checkout: `e2e-phone-link` and `e2e-layout` pass against a disposable local Go API; desktop `npm test` 100/100, `npm audit` 0 advisories, `go test ./...`, and `go vet ./...` pass. The local API used a new temporary SQLite directory and has been stopped. No production profile or Telegram contact was used.
- The installed desktop binary remains 3.6.6 while the current source package is 3.6.7; multiple 3.6.6 processes were already running, so no process was stopped or upgraded in this audit. Unsigned installer 3.6.7 was built locally and `app.asar` was checked for the new status contract; the installer was not run or published.

Ветка: `main` в отдельном worktree `sozvon-desktop`. Ветка `mobile-stage3` не изменялась.

## Security follow-up — 2026-11-15

- Gitleaks 8.30.1 scanned all local Git refs/history: findings were the standard Firebase client API key and a historical E2E password literal in shared client files. The test now generates a random password per run and uses localhost by default. The Firebase key is public project identification by Firebase design; cloud-side API restrictions, Rules, and App Check were not verifiable without Firebase project access. The old test value remains in Git history and was not rewritten.
- Shared E2E harness now blocks remote API targets unless `SOZVON_ALLOW_REMOTE_E2E=1`; tests cover localhost, IPv4/IPv6 loopback, malformed/remote targets, and opt-in.
- Mitigated six moderate `minimatch` DoS advisories in the Electron packaging tree with an override to `minimatch@11.0.6`, keeping `electron-builder@26.18.0`. Clean install, full `npm audit` (0 advisories), desktop `npm test` (91/91), and Windows `electron-builder --win --x64 --dir` packaging all pass.
- Desktop main-window navigation previously trusted every `file:` URL. It now permits only the packaged `renderer/index.html`; attempts to navigate to other local files are cancelled. External HTTP(S)/mailto handling remains through the existing explicit allowlist.
- Added unit coverage for the trusted page with query/fragment, other local files, traversal targets, remote/unsupported schemes, and malformed URLs. Desktop `npm test`: 87/87.
- Presence data from the selected server is now normalized against a fixed enum before it is used in profile markup/classes or realtime updates; payload-like unknown values fall back safely. Desktop `npm test`: 88/88.
- Desktop runtime dependency audit (`npm audit --omit=dev`): 0 advisories. The prior full-audit result of six moderate build-time advisories is resolved by the tested override recorded above.
- No packaged desktop build or live OAuth/session flow was exercised in this follow-up; this was a source-level navigation policy fix with unit tests.

## Что проверено

- Auth/landing: 1020×700.
- Основной экран «Друзья»: 1020×700, 900×620, 820×600 (минимальный размер окна).
- Настройки: профиль, оформление, звук/видео; темы light/dark/glass.
- Модалка «Свой цвет»: 1020×700 и 820×600.
- `scripts/e2e-layout.js`: 17/17 проверок геометрии прошли.
- `scripts/e2e-buttons.js`: друзья, личный чат, каналы/комнаты — 0 проблем; настройки упираются в тестовый обход, который сам открывает color-modal и не закрывает его. Вручную проверено: кнопки «Отмена»/«Готово» кликабельны, модалка закрывается.
- `npm test`: 78/78.

## Найдено и исправлено

### P2: контраст подписи в окне «Свой цвет»

Для средних тонов (например `#12A594`) подпись была белой: контраст ≈3.1:1 при требовании 4.5:1.
Исправлено: `readableText()` считает относительную яркость WCAG и выбирает тёмный/светлый текст по контрасту.
Проверка на живом окне:

```text
фон rgb(18, 165, 148)
текст rgb(17, 19, 26)
```

## Наблюдения без правок

- На ширине 820 заголовок «Друзья» переносится на две строки; переполнения и обрезки нет. Это адаптивное поведение, не дефект.
- На 1020 ширина вкладок на 4 px больше контейнера; текст не обрезан, доступна горизонтальная прокрутка. P3.
- e2e-buttons показывает 369 «blocked» после открытия color-modal — это артефакт обхода (он не закрывает вложенную модалку), а не блокировка интерфейса.

## Не проверено

- Звонки/трансляция с реальными устройствами (E2E использует fake media).
- Все 17 разделов настроек вручную, кроме профиля/оформления/звука.
- Полный прогон e2e-наборов, кроме layout и buttons.

Закрытых P0/P1 в проверенной области нет.
# Security follow-up — 2026-11-15

- Renderer `innerHTML`/`insertAdjacentHTML` sinks reviewed: dynamic status markup is driven by the validated status whitelist; popup and call-control SVGs come from fixed local definitions. No untrusted text interpolation was found in the desktop executable renderer templates during this pass.
- Desktop client tests pass 91/91; full and runtime `npm audit` report zero vulnerabilities. The mobile renderer sink finding and fix are documented in the mobile repository's `SECURITY-AUDIT.md`.
- Static review only; no live server, cloud project, or penetration testing was performed.

## Packaged artifact verification — 2026-11-15

- Ran the repository's `npm run dist` Windows x64 release packaging path (`electron-builder --win --x64 --publish never`) after the navigation/permission/presence security changes. The unsigned installer `client/dist/Sozvon-Setup-3.6.5.exe` was built locally; the package integrity gate passed and found all 100 required files, including `app-update.yml` and unpacked native modules.
- No install, publication, or release upload was performed. The standalone `--dir` check is not a valid updater-metadata gate because that target omits installer update metadata; the supported `dist` target is the verified release packaging path.

## Telegram phone-auth hardening in desktop main — 2026-11-15

- Compared the desktop `main` server implementation with the mobile server checkout. Found missing private-chat checks for Telegram `/start` and contact updates, no per-account limit on starting phone-link attempts, and password mutation before Telegram confirmation for OAuth-only accounts.
- Added private-chat and sender/chat identity validation, a 3-per-minute phone-link limit, an IP limit for phone-reset completion, deferred password application until Telegram confirms the link, periodic cleanup of expired/used phone-signup rows, and mutex-protected bot username access.
- Added regressions for group-chat claim attempts, pending password behavior, account rate limit, and phone-reset IP rate limit. The focused regressions pass; full `go test ./...`, `go vet ./...`, and `govulncheck ./...` pass. `git diff --check` is clean (only Git LF/CRLF normalization notices).
- The desktop Windows installer was built with the normal `npm run dist` path and its integrity check found all 100 required files. It was not installed, uploaded, signed, or published. These server-source changes have not been deployed to the VPS.
- Mobile source was not changed in this follow-up. The production unauthenticated health endpoint reports phone authentication enabled, but the authenticated owner profile's phone binding remains unverified; no production account data was accessed or changed.

## API boundary follow-up — 2026-11-15

- Added desktop server regression coverage for its 16 KiB JSON body cap and security response headers (`nosniff`, frame denial, referrer policy, HSTS). Both focused tests pass. The mobile server checkout separately tests the same body cap and additionally rejects arbitrary foreign CORS origins while allowing the Capacitor origin.
- Source review confirmed authenticated upload handling and a 25 MiB cap, HMAC-signed expiring file URLs, and WebSocket frame/rate limits. Current desktop and mobile clients request a one-time `/ws-ticket` and connect with that ticket.
- Both current desktop and mobile clients use `/api/ws-ticket`. The Go WebSocket handlers now reject JWTs passed in the query and accept only short-lived, single-use tickets. Proxy access-log retention still needs deployment-side review.
- These source-level checks do not substitute for a live VPS/proxy configuration review or dynamic penetration test.

## Link-preview SSRF follow-up — 2026-11-15

- Added a per-user limit of 30 link-preview requests/minute to constrain outbound fetch volume. A regression test reproduced the missing limit (31st request was still handled as invalid input) and now passes after the guard.
- The URL validator rejects embedded userinfo to prevent forwarding URL-provided credentials to preview targets. Tests cover userinfo and malformed/unsupported/overlong URLs, local/reserved IPv4 and IPv6 classification, and refusing loopback connections before dialing.
- `linkpreview` tests, full desktop Go tests, and `go vet ./...` pass; desktop `govulncheck` reports no known vulnerabilities. The matching mobile checkout implementation and tests also pass.

## Security scanner recheck — 2026-11-15

- Full `npm audit --json`: 0 vulnerabilities (19 production dependencies; 286 total resolved dependency entries).
- `govulncheck ./...`: no known vulnerabilities found in the desktop Go server source tree.
- The same checks passed in the separate mobile checkout. No VPS or production account was accessed or modified.

## `/me` private cache policy — 2026-11-15

- `/api/me` now sends `Cache-Control: private, no-store`, protecting profile/account-state fields and avoiding stale account status. Regression coverage and full Go tests pass.
- This checkout change is not deployed to production; no VPS or account was accessed.

## Electron navigation parity recheck — 2026-11-15

- Compared the two checkouts. The desktop `main` checkout already rejects all top-level navigation except its exact packaged `renderer/index.html`; the mobile-stage3 checkout had retained a broader `file:` exception. The same exact-file policy is now present in mobile-stage3's Electron host, with 3 regression tests passing and a successful Windows `win-unpacked` package containing the helper module.
- The Android build does not use Electron `main.js`; Android's native/WebView boundary remains separately restricted to the narrow Capacitor `NativeUi` plugin.

## PiP least-privilege bridge — 2026-11-15

- Replaced the shared full preload in the floating PiP window with `preload-pip.js`, limited to close/frame/title subscriptions. PiP can no longer invoke OAuth, clipboard, vault, screen-capture, updater, or main-window methods.
- Main process now verifies IPC sender identity: only the app window opens PiP/sends frames; app and PiP windows may close it. PiP popup/navigation is restricted to the trusted `renderer/pip.html` document.
- Policy tests pass 5/5 and full desktop `npm test` passes 93/93. Windows x64 `win-unpacked` package built successfully; `app.asar` contains the narrow preload and policy module. Package was not installed or published.

## WebSocket origin restriction — 2026-11-15

- Removed unconditional `CheckOrigin: true`. Server now accepts Electron's opaque/absent/`file://` origin, the app's Capacitor localhost origins, or exact same-origin browser requests. Foreign origins and scheme/port mismatches are rejected; authenticated one-use WebSocket tickets remain unchanged. A local Electron E2E caught a 403 for the file origin before that exception was added; the connection and settings confirmation flow now pass.
- Policy regression table and full `go test ./...` pass. `govulncheck ./...` reports no known vulnerabilities. Full desktop Electron client suite passes 93/93 and `npm audit` reports zero vulnerabilities.
- No live VPS/reverse-proxy test, dynamic penetration test, installer install, or deployment was performed.

## Server transport policy — 2026-11-15

- Remote `http://` server URLs are rejected centrally before REST or upload requests; addresses without a scheme now mean HTTPS. Desktop/browser HTTP is allowed only for loopback development. Saved sessions are validated before `/me`, preventing a stale remote-HTTP token from being sent in cleartext.
- Added policy tests for URL parsing and a credential-bearing API request. Desktop client tests pass 97/97; full `npm audit` reports zero vulnerabilities; `go test ./...` and `govulncheck ./...` pass for the server checkout. The self-hosting guide documents the HTTPS requirement. Windows `win-unpacked` rebuilt successfully and `app.asar` contains `renderer/server-url.js`; no installer was released and no production server changed.

## Electron permission origin recheck — 2026-11-15

- The earlier permission policy validated renderer/requester URLs but did not require Electron's `details.isMainFrame`; a trusted page could therefore delegate an allowlisted permission request to an embedded frame. Permission request and permission check handlers now both require trusted packaged renderer pages, a trusted requester, and an explicit main-frame flag. Missing source/frame metadata and unknown capabilities are denied.
- Regression tests cover trusted main-frame access, iframe requests, absent metadata, foreign origins, untrusted top-level pages and unknown permissions. Desktop `npm test` passes 97/97, `npm audit` reports 0 advisories, `go test ./...` passes and `govulncheck ./...` reports no known vulnerabilities. Rebuilt unsigned Windows x64 `win-unpacked` to `dist-permissions-audit` and inspected `app.asar`; its packaged `permissions.js` contains the main-frame checks. It was not installed or published.
- This audit covers desktop source/configuration and automated boundaries. It does not include a live VPS/proxy test, dynamic penetration test, production account action, or a physical microphone/camera/display-capture permission prompt.

## OAuth callback query encoding — 2026-11-15

- Replaced the hand-written callback query escaping in both Go backends with Go's `net/url.QueryEscape`. This ensures provider error text containing percent escapes, plus signs, Unicode, separators, and fragments round-trips as one query value.
- Added a regression test for the callback error query in both server checkouts. `go test ./...` passes in each backend. This is a correctness hardening; it does not alter OAuth state/PKCE checks or deploy either server.

## Main-process EPIPE dialog regression — 2026-11-15

- `console.warn/error` could throw synchronously when Electron outlived the parent shell whose stdout/stderr pipe had closed. The previous stream error listener only covered asynchronous `error` events.
- `main-log.js` now guards synchronous `Writable.write()` and async error events, swallowing only `EPIPE`; other failures continue through the existing main log/error path. A Node `Console.warn` regression test and full client suite pass (desktop 100/100).
- Built a separate unsigned Windows x64 `win-unpacked` package and inspected `app.asar`; it includes `main.js` and `main-log.js` with the guard. Extracted files pass `node --check`.
- After the user approved replacing the running 3.6.4 copy, built and installed unsigned NSIS 3.6.6. The installed `C:/Program Files/Sozvon/resources/app.asar` was extracted and verified to contain the stdout/stderr guards; both files pass `node --check`, and the focused EPIPE suite passes 3/3. Current recheck confirms the installed package version is still 3.6.6 and has the guard; four Sozvon processes are running and were left untouched.
- Dynamic pipe probes: a Node child loaded `main-log.js` extracted read-only from the installed `app.asar`, emitted repeated `console.log`/`console.warn` writes, and its parent deliberately closed stdout and stderr in separate runs. Both children completed 100 write cycles with exit code 0 and no uncaught EPIPE. A separate headless launch of the installed Electron executable used an isolated temporary user-data directory; its parent closed stdout/stderr after startup, and the process remained alive until the harness explicitly stopped it. The focused EPIPE tests pass 3/3. This strengthens the packaged-process check, but does not visually verify a normal interactive error dialog. The isolated run's updater offered 3.6.8 and reached 79% download in the temporary profile; the profile was removed before installation, and no updater was installed. The four existing Sozvon processes and installed app files remain unchanged.

## WebSocket token query removal — 2026-11-15

- Electron and Android clients currently obtain one-time WebSocket tickets. Removed the Go backend's legacy `?token=<session JWT>` acceptance path in both server checkouts; `/ws` now requires a short-lived single-use ticket.
- Regression test reproduced the old behavior with a valid session JWT, then verified 401 after the change; another test proves ticket redemption is one-use. Full `go test ./...` passes in both mobile and desktop server trees.
- Not deployed to the VPS. Any older third-party client using query JWTs must update to the ticket flow; current Sozvon clients already do.

## Production API CORS recheck — 2026-11-15

- Read-only requests to the configured production host returned `/api/health` 200 but no `Access-Control-Allow-Origin` for `https://localhost`; `OPTIONS /api/me` returned 405. Public OAuth providers list Yandex, and `/api/oauth/yandex/web` responds 302 with a state cookie. No callback/account login was attempted.
- The mobile backend already had an exact localhost-origin CORS wrapper; ported the same middleware to this `main` checkout and added regression coverage for health, preflight (including chi's otherwise-405 path), and foreign-origin denial. `go test ./...` passes. Production remains unchanged; the server update still needs an authorized deployment and live recheck.

## Account recovery deadline — 2026-11-15

- The UI timer enforced the 30-day restore window, but the server endpoint did not. Added the same cutoff check used by permanent purge; expired recovery requests return 410 and leave the profile soft-deleted. `go test ./...` passes. The matching mobile server fix is in the separate `mobile-stage3` checkout; neither backend was deployed.
