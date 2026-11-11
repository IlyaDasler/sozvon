# Android migration — source prompt digest

## Приоритет платформы

Только Android. iOS не проектируется. Оболочка: Chrome Android / Android WebView / Capacitor / PWA.

- minSdk 24, targetSdk 36; при targetSdk ≥35 edge-to-edge принудительный.
- Средний Android 3–4 лет, 60 fps.
- Телефоны 320–480 dp, фолды 600–900, планшеты 768–1366, split screen.
- Классы окна: compact <600, medium 600–839, expanded 840–1199, large 1200+.

## Дополнительные Android-запреты

- верхняя панель/шторка/дропдаун/тост без `safe-area-inset-top` — блокирующий дефект;
- блокировка ориентации/resizability как уход от адаптива;
- перехват системного back и свайпов от края;
- шторка без системного back;
- сегментированный контрол вместо Material-табов;
- отсутствие ripple на интерактиве;
- ripple на неинтерактивных блоках;
- Snackbar поверх нижней навигации/FAB;
- карусель, перехватывающая свайп от края.

## Material-соответствие

Ripple на интерактиве, Snackbar для транзиентных сообщений, bottom sheet с ручкой, FAB для главного действия, Dialog для подтверждений. Отступление — обосновать.

## Android: safe-area и трей

- `viewport-fit=cover`, `env(safe-area-inset-*)` + фолбэк `--safe-area-inset-*`.
- `WindowCompat.setDecorFitsSystemWindows(false)`.
- Прозрачные status/navigation bar, `shortEdges` для cutout.
- Контент не под часами, cutout, gesture bar.
- Нижний бар/composer учитывают IME и safe-area.

## IME и клавиатура

- `font-size ≥16px`, `inputmode`, `enterkeyhint`, `autocomplete`, правильный `type`.
- VisualViewport; липкие панели прячутся; поле не перекрывается.
- Не фиксировать футер поверх клавиатуры.
- Скролл body не блокировать без фиксации позиции; при закрытии модалки восстанавливать.

## Системный back

Прогрессивный стек:

```text
sheet → modal → section → settings root → room → channel list → exit
```

Нельзя выкидывать из приложения, если открыт слой. Не перехватывать свайп от края 20–24 px. Не делать «двойной back для выхода».

## Складные

- свёрнуто: 21:9–22:9, нижние действия достижимы;
- развёрнуто: короткая сторона 600–900, две колонки;
- flex mode: контент не на петле;
- spanning: `(horizontal-viewport-segments: 2)`, `(vertical-viewport-segments: 2)`, `env(viewport-segment-*)`, обязательный фолбэк;
- Device Posture API — прогрессивное улучшение;
- ориентация/складывание — ресайз без reload; состояние/скролл/ввод/модалки/медиа сохраняются.

## Ландшафт

Высота 330–430: нижний бар компактный, тулбары схлопываются, контент — собственный скролл, модалки ≤90dvh.

## QA Android

Ширины 320–1366; высоты 640×360, 844×390, 915×412, 932×430; фолды; обе ориентации; split screen; клавиатура; back; safe-area; reduced-motion.

## DoD Android

- нет контента под треем/вырезом/gesture bar;
- системный back не выкидывает;
- IME не перекрывает;
- фичи сохранены;
- 60 fps на среднем Android;
- нет анти-слопа;
- все состояния и фолды.
