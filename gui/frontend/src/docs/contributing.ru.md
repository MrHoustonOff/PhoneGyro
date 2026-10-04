# Участие в разработке

Спасибо, что хотите помочь. Здесь всё, что нужно, чтобы собрать проект и предложить изменение.

## Сборка

Нужны [Go](https://go.dev/) 1.25+, [Node.js](https://nodejs.org/) 18+ и [Wails CLI v2](https://wails.io).

```bash
git clone https://github.com/MrHoustonOff/PhoneGyro.git
cd PhoneGyro/gui

# Windows x86_64
wails build -tags native_webview2loader -o PhoneGyro.exe

# Windows ARM64
wails build -tags native_webview2loader -platform windows/arm64 -o PhoneGyro-arm64.exe
```

Готовые файлы появляются в `gui/build/bin/`. Приложение собирается под ***Windows***: интерфейс работает на WebView2.

## Проверки перед изменением

```bash
go vet ./...
go test ./...
go test ./pkg/i18n/    # после правок переводов
```

Документация проверяется отдельно:

```bash
python tools/docs/build.py          # проверить ссылки и пары RU/EN, обновить gui/frontend/src/docs
python tools/docs/build.py --check  # только проверка
```

## Структура репозитория

```
gui/                    приложение Windows (Wails); main.go только встраивает интерфейс
  internal/app/         API для интерфейса: конвейер кадров, мастер калибровки, телефон и USB
  internal/motion/      математика движения: матрицы, выравнивание осей, AHRS, bias, порог дрожи
  internal/settings/    settings.json
  internal/profiles/    profiles.json: шесть слотов калибровки
  internal/usbdev/      USB-хост: поиск устройства, чтение кадров
  internal/hwproto/     формат USB-протокола
  internal/tray/        значок и меню трея
  frontend/src/         интерфейс: index.html, js/, css/
pkg/server/             HTTPS/WebSocket-сервер для телефона
pkg/dsu/                сервер Cemuhook DSU
pkg/ca/, pkg/pairing/   локальный центр сертификации и QR-коды
pkg/i18n/               переводы RU/EN
web/                    страница телефона
docs/                   документация (источник: docs/SUMMARY.md)
```

Как данные датчика превращаются в пакеты DSU: [Пайплайн движения](motion-pipeline.ru.md).

## Правила кода

* ***Все строки интерфейса*** берутся из `pkg/i18n/locales/ru.json` и `en.json`. Строки в JS и HTML не пишем.
* ***Размеры в CSS — только в `rem` и `em`.***
* Файл `gui/frontend/src/css/pg.css` создаётся из дизайн-системы автоматически (`tools/design-css/build.py`), его не правят руками. Свои правила пишите в `css/app.css`.
* Правило ***Zero rAF Idle***: в простое, при свёрнутом окне и на неактивных экранах не должно быть холостых циклов анимации (`requestAnimationFrame`). WebGL и слушатели освобождаются при уходе с экрана.
* Зернистая текстура `--tex-grain` только на больших фонах, мелкие карточки и плитки гладкие.
* Цвета статусов (зелёный — онлайн, красный — нет подключения) не перекрашиваются под акцент пользователя.
* Коммиты: `тип(область): краткое описание`, например `fix(gui): ...`, `feat(dsu): ...`, `docs: ...`.

## Что не принимается

Эти идеи рассматривались и отклонены, не предлагайте их повторно:

* 6-позиционная калибровка акселерометра;
* температурная модель смещения гироскопа;
* калибровка масштаба гироскопа;
* синхронизация чтения прошивки по data-ready;
* «телепорт» паузы (резкий возврат ориентации после паузы или переподключения);
* DTR-сброс платы Arduino Nano при открытии порта;
* 3D-уровень.

## Проверка интерфейса и производительности

Все инструменты работают без Windows и без собранного `PhoneGyro.exe`, интерфейс запускается в headless Chrome с заглушкой вместо бэкенда:

| Инструмент | Для чего |
|---|---|
| `node tools/screenshot/shot.mjs` | Скриншоты экранов ([описание](https://github.com/MrHoustonOff/PhoneGyro/blob/dev/tools/screenshot/README.md)). |
| `tools/frontend-bench/` | Сравнение интерфейса до и после правок, стоимость кадра, снимок страницы телефона. |
| `bench.cmd` / `tools/bench-daemon/` | Замер производительности ***настоящего*** `PhoneGyro.exe` (только Windows). Цель: 60 fps на слабом стенде. |

## Как предложить изменение

1. Основная ветка разработки — ***`dev`***. Открывайте pull request в неё. Слияние в `main` и релизы делает владелец проекта.
2. Один pull request — одна тема. Опишите, что изменилось и зачем.
3. Убедитесь, что `go vet`, `go test ./...` и проверка документации проходят.
4. Если меняете поведение, обновите документацию в `docs/`: к каждой странице нужны версии на двух языках (`name.ru.md` и `name.en.md`).
