# Фронтенд PhoneGyro: аудит и план оптимизации перед restyle

Состояние на 2026-09-29, ветка `dev` (`5853b9a`). Объём: `gui/frontend/src` — `index.html` (2520 строк, 171 КБ),
`livedebug.html`, 33 файла `js/`, 15 файлов `css/`, всего ~28,5 тыс. строк своего кода + `three.min.js` (600 КБ),
`GLTFLoader.js` (97 КБ), модель `gamepad.glb` (104 КБ).

Цель документа: полный список того, что мешает (сломано, тратит ресурсы, путает архитектуру), в каком порядке это
чинить и как проверять каждый шаг. Сам restyle — отдельная работа после; здесь только то, что нужно сделать до него
или что он сделает проще.

Обозначения: **P0** — видно пользователю / сломано; **P1** — производительность; **P2** — гигиена и архитектура,
подготовка к restyle. У каждого пункта: где, что не так, почему, как чинить, как проверить.

---

## 0. Уже исправлено по ходу аудита

- **Шапка** (`11450fe`): центральные кнопки были абсолютно отцентрованы и наезжали на тему/язык/статус при длинном статусе или масштабе шрифта 1.4. Теперь сетка из трёх колонок + сворачивание по замеру (`header.js`).
- **Пилюли пинга** (`930c4c7`): фиксированные ширины; график пинга 0..≥60 мс, одна точка в секунду.
- **Версия** (`908ab9c`): `git describe` только по тегам `v[0-9]*` (был `pre-gemini.076`).

- **`window.go?.main?.App` → `window.go?.app?.App`** (`5853b9a`). При переезде приложения в `internal/app`
  (`a173406`) замена не поймала вызовы через `?.`: 53 места в 14 файлах. Молча не работали мастер калибровки,
  уведомление Cemu, диалог закрытия, отключение/возврат клиентов DSU, удаление профиля, recenter, звуки, монитор
  ресурсов, кнопка Live Debug (падала в браузер). Проверка на будущее:
  `grep -rnE "go\?\.main|go\.main|\['main'\]" gui/frontend/src --include=*.js --include=*.html | grep -v wailsjs` —
  должно быть пусто.

---

## 1. Как фронтенд устроен сейчас

### 1.1 Загрузка

- `index.html`: 14 `<link>` CSS, затем **синхронно в `<head>`** `three.min.js` + `GLTFLoader.js`, затем в конце
  `<body>` 31 `<script>` в строгом порядке. Модулей нет: каждый файл объявляет глобальный объект (`AppState`,
  `Scene3D`, `CalibrationWizard`, `SettingsManager`, …), связи — через глобальные имена и проверки
  `typeof X !== 'undefined'`.
- `livedebug.html` — отдельное окно (второй процесс `--livedebug`): `main.css` (**файла нет**, см. F1),
  `css/livedebug.css`, three.js, `js/livedebug.js` (106 КБ, свой словарь i18n внутри).

### 1.2 Потоки данных из Go

| Событие | Частота | Кто слушает | Когда идёт |
|---|---|---|---|
| `state:change` (весь `AppState`, ~3 КБ) | 15 Гц (`loops.go heartbeat`) | `app-state.js render` | пока источник подключён, **в т.ч. когда окно скрыто в трей** |
| `ahrs:quat` (4 числа) | до 60 Гц (`loops.go streamQuat`) | `recenter.js` → `Scene3D` | пока подключён, только при изменении |
| `tuning:frame` | до 60 Гц | `tuning-bench.js` | только при открытом стенде (`SetTuningActive`) |
| `dsu:status` | по событию | `app-state.js updateDSU` | подключение/отключение клиента |
| `resource-stats` | 1,5 с | `resource-monitor.js` | всегда |
| Live Debug WS | до 250 Гц | `livedebug.js` | пока открыто окно Live Debug |

### 1.3 Постоянные циклы отрисовки

| Цикл | Где | Когда крутится | Стоимость |
|---|---|---|---|
| Инклинометр (пузырёк/компас) | `app-state.js:31 startInclinometerLoop` | **всегда**, с запуска и до выхода | rAF + 2–3 `setAttribute` на кадр даже без движения |
| `Scene3D` (до 3 сцен) | `scene3d.js:273 animate` | с `mount` до `destroy` (закрытие мастера) | WebGL render 60 к/с на сцену, **в т.ч. скрытых** |
| Платформер стенда | `platform-game.js` + `tuning-bench.js` | пока открыт стенд | WebGL |
| Recenter / AimGame | `recenter.js`, `aim-game.js` | только во время измерения / fullscreen | ок |
| Live Debug | `livedebug.js:870 renderFrame` | окно видно (есть эко-режим и `visibilitychange`) | WebGL с тенями, в quad-режиме 4 прохода |

WebGL-контексты в главном окне: до 3 (мастер) + 1 (платформер). `renderer.dispose()` без `forceContextLoss()`.

---

## 2. Находки

### P0 — видно пользователю

#### F1. Live Debug грузит все стили главного окна цепочкой `@import` — ✅ сделано
- **Поправка к первой версии аудита:** Live Debug не был сломан. `main.css` не удалён, а стал агрегатором из 13
  `@import` (`5316a5f`), и Live Debug получал через него токены — вместе со всеми стилями главного окна.
- **Где:** `livedebug.html:7`; `gui/internal/app/livedebug_http.go` (маршрут `/main.css`).
- **Что:** последовательная цепочка из 14 CSS-файлов (`@import` грузятся по очереди), из которых окну нужны два:
  `base.css` (токены, сброс) и `header.css` (`status-capsule`, `status-dot`, `btn-icon`). Проверено: другие классы,
  `id` и селекторы по тегам главного окна Live Debug не использует (включая классы из шаблонов `livedebug.js`).
- **Сделано:** подключены `css/base.css` + `css/header.css`, маршрут `/main.css` убран. Скриншоты headless Chrome
  до/после совпадают. `main.css` теперь не используется никем — удалить (с подтверждения владельца, см. F16).

#### F2. `--text-primary` не определён нигде
- **Где:** `css/dashboard.css:749`, `:902`; `css/livedebug.css:1223`.
- **Что:** переменной нет ни в `base.css`, ни где-либо ещё → `color` падает в унаследованный, в светлой теме
  может оказаться не тем цветом.
- **Фикс:** заменить на `var(--text)` (или завести `--text-primary` как алиас в токенах — решить при F21).
- ✅ сделано (`eaef57c`), заменено на `var(--text)`.

#### F2b. Шесть токенов используются, но не определены — ✅ сделано
- **Что:** `--accent`, `--accent-rgb`, `--shadow-sm`, `--shadow-lg`, `--surface-card`, `--surface-translucent` —
  ~30 мест без запасного значения → объявление становится «ничем»: нет рамки фокуса у полей/селектов
  (`apple-select.css`, `help-welcome.css`, `settings-tuning.css`), нет фона у `.recenter-modal`,
  `.btn-hud-quick-cal`, `.btn-cal-retry`, `.axis-meter-capsule`, нет тени у карточек настроек.
- **Сделано:** определены в `base.css` как алиасы существующих (`--accent` → `--apple-blue`, `--surface-card` →
  `--surface`, `--shadow-lg` → `--card-shadow`), свои значения для светлой темы.
- **Проверка владельцем:** модалка центрирования, фокус в полях настроек, кнопка быстрой калибровки на HUD,
  шкалы осей и «Повторить» в мастере, кнопки стенда — в обеих темах.

#### F3. Список DSU-клиентов пересобирается 15 раз в секунду — ✅ сделано
- **Итог:** `dbf5418`. Поправка: DOM и раньше не пересобирался (сравнение HTML внутри `render`); лишними были сборка трёх HTML-строк и запись тех же значений каждый тик. Теперь сравниваются только видимые поля, живое смещение Cemu обновляет только подсказку.
- **Где:** `js/app-state.js:281 updateDSU` (вызывается из `render` на каждый `state:change`), `js/dsu-clients.js:19 render`.
- **Что:** защита «не перерисовывать без изменений» сравнивает `JSON.stringify([clients, kicked])`, а в
  `ClientInfo` есть постоянно меняющиеся поля (`lastSeenMs`, `cemuBias`, `cemuSamples`). Пока подключён эмулятор,
  JSON отличается каждый тик → три списка (`offline/online/usb`) пересобираются через `innerHTML` 15 раз/с.
  Последствия: лишняя работа; элементы под курсором пересоздаются — клик по имени/крестику может попасть в
  удалённый узел, hover-подсказка мигает; также каждый раз пересчитывается текст баннера и стиль точки.
- **Фикс:** ключ сравнения — только поля, которые показывает UI: `address, process, active, cemuGuard` + список
  `kicked` (адреса). Внутри `DsuClientList.render` — обновлять строки по `data-addr` (добавить/удалить/поменять
  класс), а не `innerHTML` целиком. Обновлять только видимый баннер, а не все три.
- **Проверка:** DevTools → Performance, 5 с с подключённым Cemu: `updateDSU`/`render` не должны появляться между
  изменениями; вручную: навести на имя клиента — подсказка стоит; быстрые клики по крестику/«Подключить снова»
  срабатывают с первого раза.

### P1 — производительность

#### F4. Инклинометр крутит rAF всегда — ✅ сделано
- **Итог:** `f92be9b`. Стенд, телефон в покое: 57 → 20 мс работы главного потока в секунду, 64 → 20 раскладок/с.
- **Где:** `js/app-state.js:31–82`.
- **Что:** цикл стартует в `init` и не останавливается никогда. Когда устройство офлайн или открыты настройки, он
  просто перезапускает себя каждый кадр; в онлайне пишет `cx`, `cy`, `transform` и `classList.toggle` каждый кадр,
  даже когда значения сошлись (телефон лежит).
- **Фикс:** «спящий» цикл: запускать rAF только когда `|target − current| > ε` (например 0.01°), после сходимости
  останавливаться; `render` при новом target будит цикл. Не писать атрибут, если строка не изменилась.
  Пропускать при `document.hidden`.
- **Проверка:** Performance при лежащем телефоне — нет rAF-кадров от инклинометра; при движении — плавно, как
  было (сравнить на глаз с текущей сборкой).

#### F5. Сцены `Scene3D` рендерят скрытыми и не отдают контекст — ✅ сделано
- **Итог:** `879e6da`. Живёт одна сцена текущего экрана, live-превью рисуется только при изменении. `forceContextLoss()` **не** применять: мастер монтирует сцену повторно на тот же canvas, а потерянный контекст у canvas не восстанавливается (проверено на стенде — `precision of null`); повторный `getContext` на том же canvas возвращает тот же контекст, так что контексты не копятся. Экран подтверждения в покое: 69 → 22 мс/с.
- **Где:** `js/scene3d.js:273 animate`, `:417 destroy`; `js/calibration.js:183 close`, `:197 showScreen`.
- **Что:** (а) сцена `cal-3d-canvas` (демо шага) не уничтожается при переходе на «Подтверждение»/«Ручную» — до
  трёх WebGL-сцен рендерят 60 к/с, две из них скрыты; (б) `animate` рендерит каждый кадр, даже когда в live-режиме
  кватернион не менялся; (в) `new THREE.Euler` на каждый кадр в демо (мусор для GC); (г) `destroy` вызывает
  `renderer.dispose()` без `renderer.forceContextLoss()` — контексты освобождаются только сборщиком, при частом
  открытии мастера можно упереться в лимит Chromium (16) с предупреждением и потерей старого контекста;
  (д) текстура сетки 1024² пересоздаётся на каждую смену темы для каждой сцены.
- **Фикс:** в `showScreen` уничтожать сцены экранов, которые уходят; в `animate` для live — рендерить только если
  кватернион/камера изменились (dirty-флаг), демо — как есть; переиспользовать один `Euler`; в `destroy` —
  `forceContextLoss()` и `dispose` геометрий/материалов клона модели; кэшировать текстуру сетки на тему в
  `Scene3D` (одна на все сцены).
- **Проверка:** пройти мастер 5 раз подряд — в консоли нет «Too many active WebGL contexts»; в DevTools → Memory
  число `WebGLRenderingContext` не растёт; на экране подтверждения GPU-нагрузка (диспетчер задач → GPU) ниже, чем
  сейчас; превью движется так же.

#### F6. Главное окно обрабатывает 15 + 60 Гц, когда скрыто в трей — ✅ сделано
- **Итог:** `94e6ab9`. Go сам знает, когда прячет окно (`hideWindow`: крестик с «сворачивать» и диалог закрытия): пока окно в трее, не шлются `state:change` и `ahrs:quat`, при показе сразу уходит свежее состояние. Сторож тишины, DSU, трей, хоткей, звук потерь не затронуты. Сворачивание в панель задач не отслеживается (редкий случай, можно добавить через `visibilitychange`).
- **Где:** Go `gui/internal/app/loops.go heartbeat`, `streamQuat`; JS `app-state.js render`, `recenter.js:375`.
- **Что:** события идут, пока подключён источник, независимо от того, видно ли окно. rAF при скрытом окне
  WebView2 обычно тормозит, но обработчики событий (`render`: ~30 обращений к DOM, `updateDSU`, `ProfileManager.sync`)
  выполняются.
- **Фикс:** сначала **проверить**, меняется ли `document.visibilityState` при `WindowHide` в Wails/WebView2. Если да —
  фронт по `visibilitychange` вызывает новый метод `App.SetUIVisible(bool)`; Go пропускает `emitStateChange` и
  `ahrs:quat`, пока окно скрыто, и шлёт одно состояние при показе. **Сторож тишины в `heartbeat` не трогать** — он
  должен работать и при скрытом окне; пропускать только emit. Если `visibilityState` не меняется — ставить флаг
  из Go в `ShowWindow`/`OnBeforeClose(minimize)`/`WindowHide`.
- **Проверка:** свернуть в трей с подключённым телефоном → CPU процесса (монитор ресурсов/диспетчер) заметно ниже;
  развернуть — состояние актуально сразу; отключение по тишине в трее по-прежнему срабатывает; DSU работает.

#### F7. `render()` на каждом тике заново ищет и пишет DOM — ✅ сделано
- **Итог:** `065798c`. Записи через `_setText`/`_setDisplay` (только при изменении). Стенд, покой: 20 → 11 мс/с, 20 → 0,7 раскладки/с. Кэш элементов не делал — `getElementById` дешёвый, выигрыш был от записей.
- **Где:** `js/app-state.js:478–851`.
- **Что:** ~30 `getElementById` за тик; безусловные записи: `cardModeHeader.style.display`, три подписи автора
  (`display` ×3 в двух ветках), `device-hz`, `device-time`, `device-name`, ping; проверка «открыт ли мастер»
  собрана трижды разными выражениями (`isWizardOpen`, `wizardBlocksView`, строка 684).
- **Фикс:** кэш элементов в `init` (`this.el = {…}`); хелпер `setText(el, v)` / `setDisplay(el, v)`, пишущий только при
  изменении; подпись автора — только при смене `hideAuthor`; одна функция `UI.isOverlayOpen()`.
- **Проверка:** Performance 5 с онлайн — время `render` на тик; поведение экранов (офлайн ↔ онлайн ↔ USB, пауза,
  мастер открыт) не изменилось.

#### F8. 700 КБ three.js блокируют первую отрисовку — ❎ измерено, не делаем
- **Итог:** замер на стенде (3 прогона): без three.js `DOMContentLoaded` раньше на 10–25 мс, первая отрисовка — в пределах шума. Ленивая загрузка потребовала бы асинхронный `Scene3D.mount` ради незаметного выигрыша.
- **Где:** `index.html:26–27` — синхронные `<script>` в `<head>`.
- **Что:** парсинг и выполнение three.js + GLTFLoader до первого кадра, хотя 3D нужно только в мастере калибровки,
  в recenter-превью и в платформере стенда.
- **Фикс:** минимум — перенести в конец `<body>` с `defer`; лучше — ленивая загрузка `ensureThree()` (Promise,
  вставляет `<script>` один раз) и вызывать её в `Scene3D.mount`/`PlatformGame.init`; модель — `preload` после
  первого кадра, когда приложение простаивает (`requestIdleCallback`).
- **Проверка:** время до первого кадра (Performance → FCP) до/после; мастер и стенд открываются и рисуют модель;
  первое открытие мастера без заметной задержки (модель подгружена заранее).

#### F9. Скриншоты iOS грузятся при старте — ✅ сделано
- **Итог:** `loading="lazy" decoding="async"`; при открытии инструкции iOS все шесть переключаются на `eager` (листание без задержки). При старте грузилось 6, теперь 0.
- **Где:** `index.html:670–760`, 6 × `webp`, ~415 КБ.
- **Что:** нужны только на шагах мастера установки сертификата, декодируются при старте.
- **Фикс:** `loading="lazy" decoding="async"` + явные `width/height` (без скачка раскладки).
- **Проверка:** Network при старте — картинок нет; в мастере настройки появляются без прыжка вёрстки.

#### F10. Бесконечные анимации `box-shadow` — 🟡 частично
- **Итог:** `157c2d9`: плашка «нет телефона» в Live Debug (висит всё время без телефона) — пульс через `opacity` слоя. Остальные показываются временно (подсказки 10–20 с, запись хоткея) — оставлены до restyle. Пульс кнопки для устаревшего профиля не трогать: пометка «устарел» — отклонённая идея владельца.
- **Где:** `@keyframes profileOutdatedPulse` (`profiles.css:423`), `calibrateBtnPulse` (`calibration.css:1427`),
  `cardAuraPulseRed` (`calibration.css:1242`), `appleHotkeyPulse` (`responsive-overrides.css:61`),
  `alertPulse` (`livedebug.css:521`).
- **Что:** `box-shadow`/`border-color` не композитятся — перерисовка слоя каждый кадр всё время, пока класс висит
  (например, есть устаревший профиль).
- **Фикс:** тень на `::after` со статичным `box-shadow`, анимировать его `opacity`/`transform`.
- **Проверка:** DevTools → Rendering → Paint flashing: пульсирующий элемент не мигает зелёным; визуально так же.

#### F11. `backdrop-filter: blur` на 54 поверхностях — ⏭ в restyle
- **Итог:** решается вместе с новым стилем поверхностей.
- **Где:** больше всего `livedebug.css` (14), `settings-tuning.css` (12), `calibration.css` (8), `dialogs.css` (6).
- **Что:** размытие фона пересчитывается при каждом изменении под ним — особенно дорого поверх WebGL-canvas
  (мастер, стенд, Live Debug), где фон меняется 60 раз/с.
- **Фикс:** оставить только на модальных оверлеях и шапке; для карточек поверх 3D — непрозрачный/полупрозрачный фон
  без blur. Окончательно решается в restyle, но список мест — здесь.
- **Проверка:** GPU в диспетчере задач на экране подтверждения мастера и в Live Debug до/после.

#### F12. `transition: all` — 49 мест — ⏭ в restyle
- **Итог:** правила всё равно переписываются при restyle; замена вслепую рискует потерять задуманные переходы.
- **Где:** больше всего `dashboard.css` (14), `calibration.css` (10), `livedebug.css` (7).
- **Что:** анимируются любые изменённые свойства, включая раскладочные (`width`, `height`, `padding`) при смене
  класса/темы — лишние reflow и «плавающие» размеры.
- **Фикс:** перечислить свойства явно (`background-color, color, border-color, opacity, transform`).
- **Проверка:** смена темы, наведения, раскрытие карточек — выглядят как раньше.

#### F13. Live Debug: тени в quad-режиме и мелочи горячего пути — 🟡 частично
- **Итог:** `a648e16`: карта теней обновляется раз в кадр (в quad было 4 раза). Кэш элементов, кольцевые буферы, dirty-рендер — выигрыш мал (кватернион меняется почти каждый кадр), не делались.
- **Где:** `js/livedebug.js:445–528` (тени), `:870 renderFrame`, `:1626 flushUIText`, истории графиков.
- **Что:** `PCFSoftShadowMap` 1024² пересчитывается на каждый `renderer.render` — в quad-режиме 4 раза за кадр;
  рендер идёт и когда кватернион не менялся; `flushUIText` ищет ~20 элементов через `getElementById` на каждом
  сбросе; истории — `push` + `shift` (O(n) на сэмпл при 250 Гц × 13 массивов).
- **Фикс:** `renderer.shadowMap.autoUpdate = false` + `needsUpdate = true` один раз в начале кадра; dirty-флаг
  (кватернион/камера/размер) — иначе пропуск рендера; кэш элементов; кольцевые буферы фиксированной длины.
- **Проверка:** счётчик fps в окне и GPU-нагрузка в quad; графики и цифры те же; запись CSV не изменилась.

#### F14. Каждые 66 мс уходят QR-коды и профили — ❎ оценено, не делаем
- **Итог:** разбор ~3 КБ JSON 15 раз/с — сотые доли мс; правка затронула бы много потребителей. После F6 в трее состояние вообще не шлётся.
- **Где:** Go `state.go GetState` → `AppState.QRCode`, `SetupQRCode`, `Profiles`; JS `ProfileManager.sync`
  (`JSON.stringify(profiles)` на тик).
- **Что:** из ~3 КБ состояния ~1,2 КБ — два base64 PNG QR и ~1,3 КБ — 6 профилей; меняются крайне редко.
- **Фикс:** вынести в отдельные события (`qr:changed`, `profiles:changed`), шлющиеся при изменении и при старте;
  из `state:change` убрать. Требует правки Go (`emitStateChange` + места изменения профилей/IP) — делать вместе с F6.
- **Проверка:** смена сети (IP) обновляет QR; сохранение/удаление/переключение профиля мгновенно отражаются;
  размер `state:change` ~700 байт.

### P2 — гигиена и архитектура

#### F15. Мёртвый код и висячие ссылки — ✅ сделано (кроме запасного URL)
- **Итог:** `2282d7c`.
- `app-state.js:494` — `window._liveDebugWin.updateFromState`: `_liveDebugWin` нигде не присваивается (Live Debug —
  отдельный процесс). Удалить.
- JS слушает ID, которых нет в разметке: `btn-bench-recenter` (`tuning-bench.js:94`), `cal-confirm-back`
  (`calibration.js:1359`), `link-live-debug` (`app-state.js:507, 943`). Выяснить, убраны ли кнопки намеренно —
  удалить обработчики либо вернуть кнопки.
- `app-state.js:939` — запасной путь `window.open('http://127.0.0.1:8080/livedebug')` с жёстко заданным портом
  (порт HTTP настраивается). Либо убрать запасной путь, либо брать порт из настроек.
- `index.html:6–10` — редирект на `livedebug.html` по `pathname`/`search`: проверить, нужен ли ещё (маршрут
  `/livedebug` Go отдаёт `livedebug.html` сам).

#### F16. Неиспользуемые ассеты (удалять только с подтверждения владельца)
- `assets/fonts/nunito-v16-latin-regular.woff2` + `OFL.txt` — нет ни одного `@font-face`, шрифт не подключён.
- `assets/images/logo-universal.png` (140 КБ) — нигде не упоминается.
- `main.css` — агрегатор `@import`, после F1 не подключается нигде.
- Для restyle: решить, нужен ли свой шрифт; если да — подключить через `@font-face` с `font-display: swap`.

#### F17. Дубли и разбросанность CSS — ✅ сделано
- **Итог:** `960070d`: `.gyro-hud-bezel` — одно правило (было в двух файлах с перекрытием); `responsive-overrides.css` → `settings-controls.css`.
- **Примечание:** после F1 конфликт `pulseDot` исчез (Live Debug больше не грузит `calibration.css`); остальное — в restyle.
- `@keyframes pulseDot` объявлен в `calibration.css` и `livedebug.css` по-разному, а `dashboard.css:473` пользуется
  им, полагаясь на то, что `calibration.css` загружен: ключевые кадры глобальны, выигрывает последний.
  Переименовать по файлам (`dashPulseDot`, …) или вынести общие в `animations.css`.
- `.gyro-hud-bezel` (+ `:hover`) определён и в `dashboard.css`, и в `recenter.css`.
- `responsive-overrides.css` на деле содержит рекордер хоткея и прочие компоненты — переименовать/разнести по
  компонентам.

#### F18. `!important` — 139 штук — 🟡 63 снято (`6a9a9de`), 75 осталось
- **Как снимали:** CSSOM-анализ в работающем UI (5 состояний, оба окна, состояния `.open`/`.copied`/`.fullscreen`
  вызваны принудительно): флаг снят, только если без него объявление всё равно выигрывает у каждого правила с тем же
  свойством на тех же элементах (специфичность/порядок), а `!important`-соперники снимаются вместе с ним.
  Снимки вычисленных стилей до/после совпадают. Инструмент: `scratchpad/bench/important.mjs` + `strip.js` + `apply_strip.py`.
- **Остаток по причинам** (76 = 75 + `[hidden]{display:none!important}` из F22): 58 — свойство пишет JS (`display`, `background`, `width`…; снимать вместе с F22),
  5 — действительно нужен против конкретного правила, 6 — возможный соперник в состоянии, которое не удалось вызвать,
  5 — правило не найдено в CSSOM (`:is`/`:not`/вложенные медиа), 1 — конфликт с inline-стилем. Список — Приложение A.
- `settings-tuning.css` 76, `calibration.css` 31, `apple-select.css` 13. Признак войны специфичности; restyle
  упрётся в них первым. Разобрать по одному: поднять специфичность селектора или убрать конфликтующее правило.

#### F19. Цвета не из токенов — ✅ сделано
- **Итог:** `6560194` (CSS) и `a82dc50` (JS). Палитра `--palette-*` (100 значений, с `-rgb` для `rgba()`) + семантические токены на палитре + группа `--scene-*` для 3D. В CSS ни одного цветового литерала вне `tokens.css`; JS читает цвета через `CssVars` (`js/css-vars.js`). Литералами остались только альфа-маски затухания сетки 3D.
- CSS: ~370 hex-литералов и ~600 `rgba(...)`, при этом `var(--…)` ~1000. JS тоже красит напрямую:
  `app-state.js:319` (`#34C759`/`#FF9F0A`), графики `livedebug.js` (`#34C759`, `#0A84FF`, …), `scene3d.js`
  (цвета освещения), `net-sparkline.js`.
- Для restyle это главный блокер: сделать палитру токенов (`--color-success`, `--color-warning`, `--color-accent`,
  прозрачности через `color-mix()` или `--x-rgb`), JS читать цвета через `getComputedStyle` один раз при смене темы.

#### F20. `z-index` без шкалы — ✅ сделано
- **Итог:** `6ca58b2`: слои приложения — токены `--z-*` (header, dropdown, tooltip, wizard, dialog, sheet, select, toast; отдельно Live Debug). Внутри компонентов — локальные числа до 100. Заодно исправлено: тост был под мастером калибровки и шторкой центрирования (не виден), теперь верхний слой.
- 21 разное значение: 1, 2, 4, 5, 10, 20, 25, 30, 50, 60, 100, 500, 999, 1000, 3000, 9000, 9999, 10000, 99999, 100000.
- Завести шкалу токенов (`--z-base`, `--z-dropdown`, `--z-overlay`, `--z-modal`, `--z-toast`) и привести все к ней.

#### F21. Токены: один источник на оба окна — ✅ сделано
- **Итог:** `9962e17`: `css/tokens.css` подключается первым в обоих окнах.
- Сейчас токены в `base.css` вместе с базовыми стилями главного окна; Live Debug их не получает (F1).
- Вынести в `css/tokens.css` (цвета, радиусы, тени, шрифты, длительности, z-index) и подключать первым в обоих
  HTML. Это фундамент restyle.

#### F22. Видимость через inline-стили — ✅ сделано
- **Итог:** `24c18be`: видимость — атрибут `hidden` через `setShown(el, bool)` (`js/visibility.js`) + `[hidden]{display:none!important}`; раскладка показанного элемента — только в CSS. 154 записи `style.display` и 47 `style="display:none"` убраны. Проверка: снимки стилей совпадают; 79 шагов сценариев — те же видимые элементы на каждом шаге, ошибок нет. `.cal-timer-container` — `display: block` (JS всегда показывал его так; объявленные `flex-direction`/`gap` не действуют — решить при restyle).
- `index.html`: 57 `style="…"`, из них 47 `display:none`; JS повсюду пишет `el.style.display = 'none'|'flex'|'block'`.
- Перейти на атрибут `hidden` (+ `[hidden]{display:none!important}` в базе) или классы состояния
  (`.is-hidden`, `data-state`). Упрощает restyle (раскладка — только в CSS) и убирает «какой display вернуть».

#### F23. Глобальная связность JS — ⏭ после restyle
- **Итог:** для restyle не нужно; переписывание связей 33 скриптов — отдельный проект. Первый шаг, когда дойдёт: `bridge.js` — единая обёртка `window.go.app.App` и подписок `EventsOn`.
- 33 файла общаются через глобальные объекты, порядок `<script>` — единственный граф зависимостей; повсюду
  `typeof X !== 'undefined'` и `X?.isOpen`.
- Предложение без сборщика (Wails отдаёт файлы как есть): ES-модули (`<script type="module">`) с явными `import`;
  один `store` (последнее состояние + подписка `on('state', fn)`) вместо того, чтобы `AppState.render` вручную
  вызывал `ProfileManager.sync`, `FirstCenterGate`, `CalibrationWizard`, `Scene3D`; один `ui.js` с `isOverlayOpen`,
  `setText`, `setVisible`. Делать постепенно, файл за файлом, начиная с листьев (`formatters`, `toast`, `confirm`).
- `window.runtime.EventsOn` без отписки — нормально для синглтонов, но при переходе на модули держать подписки в
  одном месте (`bridge.js`), там же обёртка над `window.go.app.App` (одна точка — меньше шансов повторить
  ошибку из §0).

#### F24. `index.html` — 2520 строк — ⏭ по месту при restyle
- **Итог:** SVG-спрайт через `<use>` ломает CSS, который красит `path` внутри иконок (содержимое `<use>` недоступно селекторам) — делать только вместе с перерисовкой иконок.
- Все экраны, мастера и модалки в одном файле; 98 inline-SVG (повторов мало: GitHub-иконка ×4, иконки ссылок ×3).
- Для restyle удобнее: SVG-спрайт (`<symbol>` + `<use>`), шаблоны модалок через `<template>`, крупные блоки
  (мастер калибровки, настройки, мастер установки) — отдельными фрагментами, подгружаемыми при первом открытии.
  Это необязательно, но сильно облегчает правку вёрстки.

---

## 1a. Карта для restyle (состояние после подготовки)

- **Где значения:** `css/tokens.css` — палитра (`--palette-*`), семантические токены (`--bg`, `--surface*`, `--text*`,
  `--border*`, `--accent`, `--btn-*`, `--dot-*`, `--radius-*`, `--font-*`, `--transition-*`, тени; свои значения для
  `[data-theme="light"]`), слои `--z-*`, 3D `--scene-*`. Компоненты ссылаются только на токены; сменить палитру или
  тему — правка одного файла.
- **Где компоненты:** `base.css` (сброс, `[hidden]`, скроллбары, markdown), `header.css` + `navigation.css` (шапка,
  сетка из 3 колонок), `dashboard.css` (главный экран, HUD, пилюли, DSU, подвал, тост), `profiles.css`,
  `calibration.css` + `calibration-alerts.css`, `settings-tuning.css` (настройки, стенд) + `settings-controls.css`
  (хоткей, звуки), `apple-select.css` (селекты, подсказки), `dialogs.css`, `recenter.css`, `help-welcome.css`,
  `cemu-notice.css` (временный), `livedebug.css` (окно Live Debug; грузит ещё `tokens/base/header`).
- **Canvas и 3D:** цвета — через `CssVars.get/rgba/hex` из токенов; тема переключается атрибутом `data-theme`.
- **Показ/скрытие:** только `setShown(el, bool)`; `display` в JS не пишется — раскладку менять в CSS свободно.
- **Что ещё мешает:** 76 `!important` (Приложение A: 58 — на свойствах, которые пишет JS inline: `width`, `left/top`,
  `transition`, фон двух точек статуса…), `transition: all` (F12), `backdrop-filter` (F11).
- **Страховка при restyle:** стенд `scratchpad/bench` (`snap.mjs` + `snapdiff.mjs` — вычисленные стили; `flowvis.mjs`
  — видимость по 79 шагам сценариев; `bench.mjs` — производительность). При переносе в репозиторий — `tools/frontend-bench/`.

## 2a. Стенд замеров

`scratchpad/bench/bench.mjs` (вне репозитория; при необходимости перенести в `tools/frontend-bench/`): headless Chrome
через DevTools Protocol, заглушки `window.runtime`/`window.go.app.App`, реальное состояние из Go (15 Гц) и
кватернион (60 Гц), метрики `Performance.getMetrics`, ошибки JS, скриншот, произвольная проба.
Не видит работу GPU и Wails-специфику (скрытие окна).

Базовые цифры (главное окно, мс работы главного потока в секунду / раскладок в секунду):

| Сценарий | Исходно (`5853b9a`) | После F4+F7 |
|---|---|---|
| Офлайн | 7 / 0,6 | 0,6 / 0,6 |
| Онлайн, покой | 57 / 64 | 11 / 0,7 |
| Онлайн, движение | 60 / 64 | 58 / 60 (честная анимация) |
| Мастер, экран подтверждения, покой | 69 / 64 | 22 / 0,7 |

## 3. Порядок работ

Каждый шаг — отдельный коммит в `dev`, после каждого: `go test ./...` (если трогался Go), `wails build`,
ручная проверка из пункта. Скорость меряем до/после одним и тем же сценарием (§4).

1. **P0, мелко и сразу:** F1 (Live Debug стили), F2 (`--text-primary`), F3 (список DSU). Проверка по пунктам.
2. **Замеры «до»:** снять базовые цифры по §4 на текущей сборке и записать в этот документ.
3. **Горячие циклы главного окна:** F4 (инклинометр), F7 (render), F5 (Scene3D). Замер после.
4. **Загрузка:** F8 (three.js), F9 (картинки). Замер времени запуска.
5. **Скрытое окно и объём событий (Go + JS вместе):** F6, F14. Проверка трея и сторожа тишины.
6. **Live Debug:** F13.
7. **CSS-производительность:** F10, F12, затем F11 (частично, остальное — restyle).
8. **Уборка:** F15, F16 (с подтверждения), F17.
9. **Подготовка к restyle:** F21 (tokens.css) → F19 (цвета в токены) → F20 (z-index) → F18 (`!important`) → F22
   (видимость). После этого — сам restyle.
10. **Архитектура (можно параллельно restyle, по файлу):** F23, F24.

---

## 4. Как мерить и проверять

**Сценарии замера** (одни и те же до и после):
- A. Запуск → главное окно, телефон не подключён, 10 с простоя.
- B. Телефон подключён, лежит на столе, эмулятор (Cemu/PadTest) подключён, 10 с.
- C. То же, телефон в движении.
- D. Мастер калибровки: экран подтверждения, 10 с.
- E. Стенд настройки, платформер, 10 с.
- F. Окно свёрнуто в трей, телефон подключён, 30 с.
- G. Live Debug: orbit и quad, 10 с.

**Что снимать:** CPU и RAM процесса (встроенный монитор ресурсов + диспетчер задач, в т.ч. процессы
`msedgewebview2`), GPU (диспетчер задач), DevTools → Performance (время скриптов/раскладки/отрисовки на кадр,
частота rAF), Rendering → Paint flashing / FPS meter. DevTools в Wails: собрать с `-debug` или `wails dev`.

**Автоматические проверки, которые стоит завести** (скриптом в `tools/` или ручной командой):
- «переменная используется, но не определена»: собрать все `var(--x)` из CSS/JS/HTML и все объявления `--x:`;
  разница должна быть пустой (сейчас: `--text-primary`, и всё из F1 для Live Debug).
- «ID из JS нет в HTML»: все `getElementById('…')` против `id="…"` (сейчас: F15).
- «нет обращений к `window.go.main`» (§0).
- Нет 404 при открытии обоих окон (DevTools → Network).

**Ручная регрессия после каждого этапа** — краткий прогон: офлайн → подключение телефона → пауза → профиль
переключить → мастер калибровки до конца → стенд → Live Debug → USB-режим → трей → выход. Полный чеклист
приложения — в сообщении по итогам рефакторинга Go (27 пунктов), его прогнать перед restyle.

---

## Приложение A. Оставшиеся `!important` (файл | селектор | свойство | почему оставлен)

- `apple-select.css` | `.apple-select-native-hidden` | `position` | property written by JS
- `apple-select.css` | `.apple-select-native-hidden` | `width` | property written by JS
- `apple-select.css` | `.apple-select-native-hidden` | `height` | property written by JS
- `apple-select.css` | `.apple-select-native-hidden` | `padding` | needed against apple-select.css||.setting-select|padding-top
- `apple-select.css` | `.apple-select-native-hidden` | `margin` | property written by JS
- `apple-select.css` | `.apple-select-native-hidden` | `border` | needed against apple-select.css||.setting-select|border-top-width
- `apple-select.css` | `.apple-select-native-hidden` | `opacity` | property written by JS
- `apple-select.css` | `.apple-select-option:hover, .apple-select-option.highlighted` | `color` | possible rival in an unchecked state
- `apple-select.css` | `.apple-select-option:hover .apple-select-check, .apple-select-option.highlighted .apple-select-check` | `color` | possible rival in an unchecked state
- `calibration-alerts.css` | `.cal-modal.cal-modal-disconnected` | `box-shadow` | property written by JS
- `calibration.css` | `.btn-capture-action.counting-down` | `background` | property written by JS
- `calibration.css` | `.btn-capture-action.counting-down` | `box-shadow` | property written by JS
- `calibration.css` | `.btn-capture-action.listening, .btn-capture-action.listening:disabled` | `background` | property written by JS
- `calibration.css` | `.btn-capture-action.listening, .btn-capture-action.listening:disabled` | `box-shadow` | property written by JS
- `calibration.css` | `.btn-capture-action.listening, .btn-capture-action.listening:disabled` | `cursor` | property written by JS
- `calibration.css` | `.btn-capture-action.listening, .btn-capture-action.listening:disabled` | `opacity` | property written by JS
- `calibration.css` | `.btn-capture-action.recording` | `background` | property written by JS
- `calibration.css` | `.btn-capture-action.recording` | `box-shadow` | property written by JS
- `calibration.css` | `.btn-cal-next` | `background` | property written by JS
- `calibration.css` | `.btn-cal-next:hover` | `background` | property written by JS
- `calibration.css` | `.cal-3d-canvas` | `width` | property written by JS
- `calibration.css` | `.cal-3d-canvas` | `height` | property written by JS
- `calibration.css` | `.btn-wizard-forward:disabled` | `background` | property written by JS
- `calibration.css` | `.btn-wizard-forward:disabled` | `box-shadow` | property written by JS
- `calibration.css` | `.btn-calibrate-trigger.highlight-pulse` | `background` | property written by JS
- `calibration.css` | `.btn-calibrate-trigger.highlight-pulse` | `box-shadow` | property written by JS
- `calibration.css` | `.btn-calibrate-trigger.highlight-pulse` | `transition` | property written by JS
- `dashboard.css` | `.main-mode-btn` | `background` | possible rival in an unchecked state
- `dashboard.css` | `.main-mode-btn.active` | `background` | possible rival in an unchecked state
- `dashboard.css` | `.main-mode-btn.active` | `box-shadow` | possible rival in an unchecked state
- `dashboard.css` | `.copy-badge.copied` | `color` | needed against dashboard.css||.url-chip:hover .copy-badge|color
- `dashboard.css` | `.copy-badge.copied` | `border-color` | needed against dashboard.css||.url-chip:hover .copy-badge|border-top-color
- `dashboard.css` | `.copy-badge.copied` | `background` | property written by JS
- `help-welcome.css` | `.help-action-btn` | `font-size` | property written by JS
- `help-welcome.css` | `.setting-input-num.error` | `box-shadow` | property written by JS
- `livedebug.css` | `.stat-card.is-active-tip` | `border-color` | needed against livedebug.css||[data-theme="light"] .stat-card:hover|border-top-color
- `settings-tuning.css` | `.bench-platform-hud .bench-hud-score, .bench-platform-hud .bench-hud-record` | `display` | possible rival in an unchecked state
- `settings-tuning.css` | `.fullscreen .bench-platform-hud .bench-hud-score, .fullscreen .bench-platform-hud .bench-hud-record` | `display` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen` | `position` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen` | `top` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen` | `left` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen` | `width` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen` | `height` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen` | `margin` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen` | `background-color` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen` | `background` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen .bench-viewport-action-btn` | `top` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen .bench-viewport-action-btn` | `width` | property written by JS
- `settings-tuning.css` | `.bench-platform-viewport.fullscreen .bench-viewport-action-btn` | `height` | property written by JS
- `settings-tuning.css` | `[data-theme="light"] .bench-platform-viewport.fullscreen` | `background-color` | property written by JS
- `settings-tuning.css` | `[data-theme="light"] .bench-platform-viewport.fullscreen` | `background` | property written by JS
- `settings-tuning.css` | `20%` | `color` | no CSSOM match
- `settings-tuning.css` | `40%` | `color` | no CSSOM match
- `settings-tuning.css` | `60%` | `color` | no CSSOM match
- `settings-tuning.css` | `80%` | `color` | no CSSOM match
- `settings-tuning.css` | `50%` | `color` | no CSSOM match
- `settings-tuning.css` | `.bench-target-viewport.fullscreen` | `position` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen` | `top` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen` | `left` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen` | `width` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen` | `height` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen` | `margin` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen` | `background-color` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen` | `background` | property written by JS
- `settings-tuning.css` | `[data-theme="light"] .bench-target-viewport.fullscreen` | `background-color` | property written by JS
- `settings-tuning.css` | `[data-theme="light"] .bench-target-viewport.fullscreen` | `background` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen .bench-viewport-action-btn` | `top` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen .bench-viewport-action-btn` | `width` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen .bench-viewport-action-btn` | `height` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen .bench-target-hud` | `font-size` | property written by JS
- `settings-tuning.css` | `.bench-target-viewport.fullscreen #bench-aim-fs-hud` | `display` | inline style on the element
- `settings-tuning.css` | `#bench-aim-time-pill.urgent` | `background` | property written by JS
- `settings-tuning.css` | `.bench-reticle-dot.shot-flash .bench-reticle-circle` | `box-shadow` | property written by JS
- `settings-tuning.css` | `.bench-reticle-dot.shot-flash .bench-reticle-sight` | `background` | property written by JS
- `settings-tuning.css` | `.bench-reticle-dot.shot-flash .bench-reticle-sight` | `box-shadow` | property written by JS
