# Contributing

Thank you for wanting to help. Here is all you need to build the project and propose a change.

## Building

You need [Go](https://go.dev/) 1.25+, [Node.js](https://nodejs.org/) 18+ and [Wails CLI v2](https://wails.io).

```bash
git clone https://github.com/MrHoustonOff/PhoneGyro.git
cd PhoneGyro/gui

# Windows x86_64
wails build -tags native_webview2loader -o PhoneGyro.exe

# Windows ARM64
wails build -tags native_webview2loader -platform windows/arm64 -o PhoneGyro-arm64.exe
```

The binaries land in `gui/build/bin/`. The app is built for ***Windows***: the interface runs on WebView2.

## Checks before a change

```bash
go vet ./...
go test ./...
go test ./pkg/i18n/    # after editing translations
```

The documentation is checked separately:

```bash
python tools/docs/build.py          # check links and RU/EN pairs, refresh gui/frontend/src/docs
python tools/docs/build.py --check  # check only
```

## Repository layout

```
gui/                    the Windows app (Wails); main.go only embeds the UI
  internal/app/         the API for the UI: frame pipeline, calibration wizard, phone and USB
  internal/motion/      motion math: matrices, axis alignment, AHRS, bias, tremor threshold
  internal/settings/    settings.json
  internal/profiles/    profiles.json: six calibration slots
  internal/usbdev/      USB host: device discovery, frame reading
  internal/hwproto/     USB protocol wire format
  internal/tray/        tray icon and menu
  frontend/src/         the UI: index.html, js/, css/
pkg/server/             HTTPS/WebSocket server for the phone
pkg/dsu/                the Cemuhook DSU server
pkg/ca/, pkg/pairing/   local certificate authority and QR codes
pkg/i18n/               RU/EN translations
web/                    the phone page
docs/                   documentation (source: docs/SUMMARY.md)
```

How sensor data becomes DSU packets: [Motion pipeline](motion-pipeline.en.md).

## Code rules

* ***All UI strings*** come from `pkg/i18n/locales/ru.json` and `en.json`. We do not write strings in JS or HTML.
* ***CSS sizes use only `rem` and `em`.***
* `gui/frontend/src/css/pg.css` is generated from the design system (`tools/design-css/build.py`) and is never edited by hand. Write your own rules in `css/app.css`.
* The ***Zero rAF Idle*** rule: when idle, with the window minimized or on inactive screens there must be no idle animation loops (`requestAnimationFrame`). WebGL and listeners are released when leaving a screen.
* The `--tex-grain` grain texture goes only on large backgrounds; small cards and tiles are smooth.
* Status colors (green for online, red for no connection) are not recolored to the user's accent.
* Commits: `type(scope): short description`, for example `fix(gui): ...`, `feat(dsu): ...`, `docs: ...`.

## What is not accepted

These ideas were considered and rejected, please do not propose them again:

* 6-position accelerometer calibration;
* a temperature model of the gyro bias;
* gyro scale calibration;
* firmware read synchronization on data-ready;
* a "teleport" on pause (an abrupt return of orientation after a pause or reconnect);
* the DTR reset of an Arduino Nano board when the port opens;
* a 3D level.

## Testing the UI and performance

All tools work without Windows and without a built `PhoneGyro.exe`; the interface runs in headless Chrome with a stub in place of the backend:

| Tool | What for |
|---|---|
| `node tools/screenshot/shot.mjs` | Screenshots of the screens ([description](https://github.com/MrHoustonOff/PhoneGyro/blob/dev/tools/screenshot/README.md)). |
| `tools/frontend-bench/` | Compare the UI before and after changes, per-frame cost, a snapshot of the phone page. |
| `bench.cmd` / `tools/bench-daemon/` | Performance measurement of the ***real*** `PhoneGyro.exe` (Windows only). The goal is 60 fps on a weak test machine. |

## How to propose a change

1. The main development branch is ***`dev`***. Open pull requests against it. Merging into `main` and releases are done by the project owner.
2. One pull request, one topic. Describe what changed and why.
3. Make sure `go vet`, `go test ./...` and the documentation check pass.
4. If you change behavior, update the docs in `docs/`: each page needs both language versions (`name.ru.md` and `name.en.md`).
