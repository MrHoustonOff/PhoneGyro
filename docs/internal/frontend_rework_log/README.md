# PhoneGyro — Журнал переписывания интерфейса (frontend-rework)

Хроника разработки нового интерфейса с нуля (ветка `frontend-rework`, начата 2026-09-30).  
Дизайн-система: `docs/internal/Design/`  
Легаси-интерфейс (трафарет): `LEGACY/frontend/`

---

## Записи по этапам

### 2026-09-30 — Этап 1: Старт с нуля, брендинг и кастомное управление окном

#### Коммит 1: `dcb75ac` — `feat(gui): start the UI from scratch with an empty branded window`
- **Что сделано:**
  - Вся старая кодовая база фронтенда (88 файлов, 28k строк, Three.js, стили, скрипты) перемещена в `LEGACY/frontend` как трафарет.
  - `gui/frontend/src/index.html` начат с чистого листа.
  - На стартовой странице размещена бренд-пилюля (дизайн: wordmark A, Alegreya Sans ExtraBold, вырезка глифов «PhoneGyr» 920 байт inlined data-URI, ring-точка).
  - Иконка приложения переведена на `icon-orb` (`build/appicon.png`, `build/windows/icon.ico`).
  - Фон окна Wails настроен на цвет токена `--bg` (`#f1f1f1`) без белых/черных вспышек при запуске.
  - Отключен встроенный зум WebView2 (`IsZoomControlEnabled = false`) для передачи управления зумом интерфейсу.

#### Коммит 2: `7743df9` — `feat(gui): use the PhoneGyro logo in the brand pill`
- **Что сделано:**
  - В бренд-пилюлю добавлен логотип PhoneGyro (WebP data-URI).

#### Коммит 3: `7ae0950` — `feat(gui): custom title bar with window controls`
- **Что сделано:**
  - Реализован кастомный frameless title bar по дизайн-системе (`docs/internal/Design/components/TitleBar/`):
    - Высота 32px, прозрачная полоса над фоном окна, drag-зона `--wails-draggable: drag`.
    - Слева: мини-логотип, надпись «PhoneGyro», моноширинный номер версии (получаемый из Go `GetAppVersion()`).
    - Справа: пилюля элементов управления окном (`no-drag`, кнопки 34×20px):
      - Свернуть (`WindowMinimise()`);
      - Развернуть / Восстановить (`WindowToggleMaximise()`), динамическая смена иконки (квадрат / два квадрата);
      - Закрыть (вызов `App.CloseWindow()`);
    - Двойной клик по полосе переключает максимизацию окна.
    - Окно при потере фокуса (`blur` / `focus`) переключает класс `is-blur` (затенение до 55% непрозрачности).
  - Бэкенд Go (`gui/internal/app/`):
    - `run.go`: включен `Frameless: true`.
    - `state.go`: добавлен метод `CloseWindow()`, соблюдающий настройку действия при закрытии (`minimize` сворачивает в трей, `quit` / `ask` завершает работу).
    - `window_test.go`: добавлен юнит-тест `TestCloseWindow`, проверяющий сценарии `minimize`, `quit` и `ask`.
    - Сгенерированы актуальные привязки Wails (`App.d.ts`, `App.js`).
  - Проверка и сборка:
    - `wails build` собирает бинарник `gui/build/bin/PhoneGyro.exe` за 2.7 секунды.
    - Все Go-тесты проходят (падение `TestLiveDebug_AssetsAndBroadcast` штатное из-за переноса легаси-файлов).

#### Коммит 4: `6268b8b` — `feat(gui): scale title bar controls 1.5x and add webkit drag support`
- **Что сделано:**
  - Масштабирование элементов управления окна примерно в 1.5 раза для удобства клика (соответствие нативным размерам Windows):
    - Высота титлбара `--pg-tb`: 32px → 42px.
    - Пилюля кнопок `.pg-titlebar__ctl`: высота 26px → 36px, padding 2px → 3px.
    - Кнопки `.pg-wc`: 34×20px → 48×30px (близко к нативным 46px Windows).
    - Иконки SVG: 11px → 15px, толщина линий `stroke-width` 1.6 → 1.8.
    - Иконка логотипа в титлбаре: 16px → 18px, текст заголовка 12px → 13px.
  - Приведение классов к дизайн-системе: `.titlebar` → `.pg-titlebar`, `.wc` → `.pg-wc`, `--tb` → `--pg-tb`.
  - Добавлен аппаратный drag Chromium: `-webkit-app-region: drag` на титлбаре и `-webkit-app-region: no-drag` на пилюле кнопок.
  - Мгновенный отклик иконки максимизации по клику (`setTimeout(syncMax, 30)` вместо ожидания дебаунса resize в 120мс).

#### Коммит 5: `refactor(gui): parametric scaling for title bar controls`
- **Что сделано:**
  - Полный отказ от захардкоженных статических пикселей в размерах элементов управления окна.
  - Введён единый масштабный коэффициент `--tb-scale: 1.3`.
  - Все размеры и отступы контролов переведены на параметрические формулы `calc(base * var(--tb-scale))`:
    - `--pg-tb: calc(32px * var(--tb-scale))`
    - `.pg-titlebar__ctl`: высота `calc(26px * var(--tb-scale))`, отступы `calc(2px * var(--tb-scale))`, зазор `calc(2px * var(--tb-scale))`
    - `.pg-wc`: ширина `calc(34px * var(--tb-scale))`, высота `calc(20px * var(--tb-scale))`
    - Иконки SVG: размер `calc(11px * var(--tb-scale))`, обводка `calc(1.6 * var(--tb-scale))`
    - Текст и логотип: шрифт `calc(12px * var(--tb-scale))`, логотип `calc(16px * var(--tb-scale))`
  - Границы (`1px solid var(--line)`) строго сохранены как `1px` во избежание субпиксельного размытия.

---

## Архитектурные стандарты системы (Non-Negotiable)

### 1. Стандарт единиц измерения и масштабирования (Unit & Scaling Standard)
- **Запрет на статический хардкод пикселей:** Никаких случайных разрозненных значений `width: 48px; height: 30px` в правилах компонентов.
- **Иерархия единиц:**
  1. **Глобальный макет и сетка:** токены отступов (`--space-1...10`), типографика (`display-xl`, `body`, `mono` на базе Onest/Alegreya/JetBrains).
  2. **Изолированные компоненты (Controls, TitleBar, Islands, Badges):** параметрические размеры через масштабный токен `--[component]-scale` и формулы `calc(base * var(--scale))`, либо относительные единицы `em` от локального `font-size`.
  3. **Бритвенно-чёткие границы (Hairlines):** строго `1px solid var(--line)` (или `line-subtle`). Не переводить в относительные единицы, чтобы избежать размытия и мерцания при субпиксельном рендеринге в Chromium/WebView2 на экранах 100% DPI.
  4. **Запрет `vh`/`vw` внутри тела окна:** ломает зум интерфейса Wails (`PhoneGyro.zoom`); высота задаётся через `100%`, flex/grid и `@container pgwin`.

### 2. Вопрос шрифтов (пункт 3)
- В `docs/internal/Design/fonts/` лежат 8 готовых WOFF2 файлов общим весом ~210 КБ:
  - `Onest` (Regular, Medium, SemiBold, Bold) — для основного интерфейса;
  - `Alegreya Sans` (Bold, ExtraBold) — для акцентных заголовков и брендинга;
  - `JetBrains Mono` (Regular, SemiBold) — для чисел, телеметрии, таймеров и версий.
- Эти файлы в `Design/fonts/` **уже являются оптимизированными сабсетами** (содержат только Latin + Cyrillic без лишних редких символов).
- Текущие микровырезки шрифтов (base64 по ~920 байт) в `index.html` создавались исключительно для пустого окна-заглушки (чтобы отрисовать только «PhoneGyr» и цифры релиза без внешних запросов).
- При переходе к полноценным экранам и русскоязычному интерфейсу шрифты из `Design/fonts/` будут подключаться локально как полноценная типографика системы (без внешних CDN).

