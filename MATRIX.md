# Матрица мобильного слоя

| Экран | Элемент/жест | Состояние | Ожидание | Факт | Статус | Скриншот |
|---|---|---|---|---|---|---|
| Старый слой: друзья | открытие | сложен 411dp | список друзей, старое меню | работает после восстановления | pass (device) | screenshots/phase0/02-old-friends-restored-device.png |
| Новый слой: чаты | включение флага | Electron 411x960 | один #m-app, старый слой скрыт | #m-app=1, oldMain/oldNav hidden | pass (Electron) | screenshots/phase0/01-m-contacts-folded-electron.png |
| Новый слой: вход | форма | устройство | форма входа | не проверено | not checked | — |
| Новый слой: переписка | открытие/чтение | устройство | текст читается | не проверено | blocked (ключ) | — |
| Новый слой: настройки | открытие | устройство | разделы | не проверено | not checked | — |
| Проверка камеры | переключение | устройство | подпись активной камеры | не проверено | not checked | — |
| Нижнее меню | прокрутка каналов | сложен | не дёргается | не проверено | not checked | — |
| Fold | разложен | устройство | одна оболочка | не проверено (inner display OFF) | blocked | — |
| Fold | Flex Mode | — | сохраняется | adb не воспроизводит | blocked | — |
| Поворот | смена display | устройство | без второго #m-app | не проверено | not checked | — |

## Новый слой: геометрия (Electron, не устройство)

| Ширина | #m-app | Старый слой | Горизонтальный overflow | Меню | Статус | Скриншот |
|---|---|---|---|---|---|---|
| 320×640 | 1 | скрыт | нет | внутри экрана | pass Electron | screenshots/phase2/320x640.png |
| 360×740 | 1 | скрыт | нет | внутри экрана | pass Electron | — |
| 411×960 | 1 | скрыт | нет | внутри экрана | pass Electron | screenshots/phase2/411x960.png |
| 480×900 | 1 | скрыт | нет | внутри экрана | pass Electron | — |
| 600×900 | 1 | скрыт | нет | внутри экрана | pass Electron | — |
| 840×900 | 1 | скрыт | нет | внутри экрана | pass Electron | — |
| 900×400 альбом | 1 | скрыт | нет | внутри экрана | pass Electron | screenshots/phase2/landscape-900x400.png |
| зум 200% | 1 | скрыт | нет | внутри экрана | pass Electron | screenshots/phase2/zoom-200.png |
| экран входа | 1 | скрыт | нет | — | pass Electron | screenshots/phase2/auth-411.png |

Проверка: `e2e-m-layer-matrix`, `e2e-m-layer-stress`.

## Темы и контраст (Electron)

| Тема | Контраст текста | Статус | Скриншот |
|---|---|---|---|
| midnight | 18.91:1 | pass | screenshots/phase2/theme-midnight.png |
| light | 15.17:1 | pass | screenshots/phase2/theme-light.png |
| frost | 11.13:1 | pass | screenshots/phase2/theme-frost.png |
| glass | 17.99:1 | pass | screenshots/phase2/theme-glass.png |
| sozvon | 17.14:1 | pass | — |

Требование дизайн-системы ≥4.5:1 выполнено во всех проверенных темах (`e2e-m-layer-themes`).
