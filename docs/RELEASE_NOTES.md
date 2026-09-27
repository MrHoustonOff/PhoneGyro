# PhoneGyro v2.0.0

> [!CAUTION]
> ## ⚠️ The project has been renamed: GyroBridge → PhoneGyro
>
> **Every release before v2.0.0 (all GyroBridge v1.x builds) is now considered deprecated and highly unstable. Do not use them.** They are left on this page only for history and will get no fixes.
>
> The rename is a hard cut with **no migration and no backward compatibility**:
> - The executable is now `PhoneGyro.exe`. Delete the old `GyroBridge.exe`.
> - Settings, profiles and calibrations now live in `%APPDATA%\PhoneGyro`. Nothing is imported from `%APPDATA%\GyroBridge` — **recalibrate every device**. The old folder can be deleted.
> - The local certificate authority is regenerated as **PhoneGyro Root CA**. On iPhone/iPad install the new profile again (Initial Setup) and remove the old *GyroBridge Root CA* profile.
> - The phone page, the Live Debug window and the DSU output changed their internal formats in this release; mixing a v2.0.0 PC app with anything from v1.x is not supported.
>
> v2.0.0 itself is a large rework of the motion pipeline and a first release of USB controller support. It has been tested on the author's setup; please report anything odd.

> [!CAUTION]
> ## ⚠️ Проект переименован: GyroBridge → PhoneGyro
>
> **Все релизы до v2.0.0 (все сборки GyroBridge v1.x) теперь считаются устаревшими и крайне нестабильными. Не используйте их.** Они оставлены здесь только для истории, исправлений для них не будет.
>
> Переезд сделан жёстко, **без переноса данных и без обратной совместимости**:
> - Программа теперь называется `PhoneGyro.exe`. Старый `GyroBridge.exe` удалите.
> - Настройки, профили и калибровки теперь хранятся в `%APPDATA%\PhoneGyro`. Из `%APPDATA%\GyroBridge` ничего не переносится — **откалибруйте каждое устройство заново**. Старую папку можно удалить.
> - Локальный сертификат создаётся заново как **PhoneGyro Root CA**. На iPhone/iPad установите новый профиль ещё раз («Начальная настройка») и удалите старый профиль *GyroBridge Root CA*.
> - В этом релизе изменились внутренние форматы страницы телефона, окна Live Debug и DSU-выхода; сочетать ПК-приложение v2.0.0 с чем-либо из v1.x нельзя.
>
> Сама v2.0.0 — большая переработка обработки движения и первый релиз с поддержкой USB-контроллеров. Проверена на установке автора; если что-то ведёт себя странно — сообщите.

PhoneGyro turns your smartphone (iOS or Android) — or a DIY USB motion controller — into a high-precision, low-latency motion controller for PC games and emulators via the Cemuhook DSU protocol.

---

## What's New in v2.0.0

### USB motion controllers (PhoneGyro Hardware Protocol)
- **New input mode**: switch between Phone and USB. Any board speaking the open [PhoneGyro Hardware Protocol](https://github.com/MrHoustonOff/PhoneGyro_hardware_protocol) (e.g. Arduino Nano + MPU-6050) is found automatically on any serial port.
- **Separate state per source**: phone and USB keep their own profiles, calibration and axis alignment.
- **Device name frame**: a controller can introduce itself; the name shows in the UI and in profiles.
- **Sensor mount-tilt correction (USB)**: if the IMU board sits tilted inside the case, calibration measures it from the rest pose, verifies it against the gyroscope (so an accelerometer offset is never mistaken for a tilt) and rotates gyro and accelerometer together. Shown on the calibration confirm screen with a toggle.
- **Gyro zero tracking that works on USB**: the resting bias refinement now detects rest by the gyro's spread instead of its raw magnitude, so temperature drift of the MPU-6050 is actually tracked.

### Orientation (AHRS) rewrite
- The 3D view now uses a complementary filter whose gyro mapping has the correct handedness. The old "PadTest Madgwick" clone was mirror-handed: multi-axis motion never returned to its starting pose (38–40° left over on real logs, now 2–5°).
- Tilt correction fades to zero at rest — no more constant drift kick.
- The filter is fed exactly what goes out over DSU, so the cube matches PadTest and games.
- LEVEL indicator keeps its familiar directions (forward = bubble up, clockwise = needle right).

### Rotation is no longer lost on Wi-Fi hiccups
- DSU packets are timestamped with the device's own clock. Previously, after any Wi-Fi stall most of the rotation made during the stall was lost in the game (the client integrated it over ~16 ms instead of the real interval).
- The phone page sends a 64-bit integration clock; keep-alive frames no longer re-send a stale rotation rate.
- Heartbeat filler frames only after 250 ms of silence; a reply to a client's data request no longer adds phantom rotation.

### Calibration
- New explicit accelerometer axis-alignment step; rest gravity and axis mapping stored per profile; outdated profiles are flagged.
- Calibration wizard layout no longer jumps while values update.

### Honest diagnostics
- **Latency / ping** are now measured (server PING/PONG round-trip over the same WebSocket as the telemetry) instead of fixed or random placeholder numbers. Connection quality follows the measured ping.
- **Loss card** in Live Debug now measures the real link: lost frames by sequence number for USB; merged and lost sensor samples for the phone.
- The app shows its exact build version.

---

## Downloads

| File | Architecture | Description |
|---|---|---|
| `PhoneGyro.exe` | x86_64 (`amd64`) | Standard Windows 64-bit standalone executable |
| `PhoneGyro-windows-amd64.exe` | x86_64 (`amd64`) | Same binary with explicit architecture label |
| `PhoneGyro-windows-arm64.exe` | ARM64 (`arm64`) | Native executable for Windows on ARM devices |

No installation required. Download, run, and connect.

---

## Getting Started

1. **Coming from GyroBridge v1.x?** Read the warning at the top: delete the old app, reinstall the certificate on iPhone/iPad, recalibrate.
2. **Local Network** (phone): Ensure your PC and smartphone are on the same Wi-Fi network.
3. **Launch**: Run `PhoneGyro.exe`.
4. **Connect a device**:
   - **iOS**: Click **Initial Setup** in the app and follow the step-by-step guide to install the local certificate (required by Safari for motion sensor access over HTTPS).
   - **Android**: Scan the QR code on the main screen with your camera and open the link in Google Chrome.
   - **USB controller**: Switch the input mode to USB and plug the board in — it is detected automatically.
5. **Calibrate**: Place the device flat on your desk and click **Calibrate**. Calibration is stored per profile.
6. **Configure Emulator**: Set your emulator's Cemuhook DSU motion server to `127.0.0.1:26760` (or your custom configured DSU port).

---

## Key Features

- **Native Multi-Architecture Support**: Official release builds for both Windows x86_64 and ARM64.
- **Pure GUI Application**: Clean startup with zero console pop-up (`PhoneGyro.exe`).
- **System Tray Integration**: Background operation with tray menu, show/hide shortcuts, and quit confirmation.
- **Interactive Test Bench**: Real-time oscilloscope, 3D target viewfinder, and apparatus tilt mini-bench.
- **Advanced Settings Hub**: Custom network ports, gyro noise filtering, and theme customization.
- **Global UI Scaling**: Dynamic zoom (`0.80x` - `1.40x`) with `Ctrl +/-/0` shortcut support.
- **Audio Feedback**: Melodic chimes or native Windows sounds on connect and disconnect.
- **3D Gesture Calibration**: Guided motion wizard with resting gravity capture, accelerometer axis alignment and (USB) sensor mount-tilt correction.
- **USB Motion Controllers**: Any board speaking the open PhoneGyro Hardware Protocol, auto-detected.
- **Honest Diagnostics**: Measured ping/latency and real link-loss statistics in Live Debug.

---

## Previous releases (GyroBridge v1.x — deprecated, see the warning above)

### What was new in v1.1.3

### Sound Effects Mixer & New Audio Cues
- **Detailed Sound Mixer**: Expandable drawer with individual volume sliders (0x to 3x) and play-test buttons for every event:
  - Phone Connection (`connect`)
  - Phone Disconnection (`disconnect`)
  - Emulator Client Subscription (`dsu`)
  - Orientation Recenter (`recenter`)
  - Test Bench Goal / Target Hit (`goal`)
  - Test Bench Ball Abyss Fall (`defeat`)
- **New Audio Cues**: Distinct chime synthesized on Cemuhook DSU client connection and Recenter reset.
- **Synthesizer Tuning**: Overhauled ball fall defeat sound synthesis with unblocked playback.

### Action-Driven Settings & UX
- **Instant Auto-Save**: Action-driven settings engine with immediate live persistence on change.
- **Modified Field Indicators**: Subtle indicator dot next to any setting modified from its default value.
- **CSS Zoom Normalization**: Floating tooltips and custom select dropdowns properly compensate for display zoom (0.8x - 1.4x).
- **Clean Audio Controls**: Streamlined audio test buttons without intrusive tooltips.

---

### What was new in v1.1.2

### System Tray & Background Operation
- **Minimize to System Tray**: PhoneGyro can now run unobtrusively in the Windows notification area with near-zero resource consumption (~15 MB RAM, 0% CPU).
- **Tray Context Menu**: Right-click the tray icon to quickly show/hide the main window, pause/resume motion streaming, or exit the application cleanly.
- **Dynamic Tray Status**: The tray icon reflects connection state, indicating whether a streaming session is active or idle.

### Cemuhook DSU Protocol Compliance & Multi-Slot Fixes
- **Strict Packet Sizing**: Fixed Cemuhook `PortInfo` response packet length strictly to 32 bytes (eliminating 4 extra trailing bytes) and `VersionResponse` to 24 bytes, resolving CRC32 checksum rejections (`PortInfo is invalid!`) in Cemu 2.x and other emulators.
- **Multi-Slot Port Querying**: Full support for multi-slot `ListPorts` requests (slots 0..3) with instantaneous responses for each requested index, eliminating 3-second connection timeouts in Cemu.

### UI & Telemetry Refinements
- **Dual-State DSU Connection Banner**:
  - Waiting state: subtle amber notification (`Waiting for emulators`) when listening on port 26760 with zero connected clients.
  - Active state: green indicator (`Emulator Connected`) displaying live client IP, ephemeral port, and real-time pulse indicator once subscribed.
- **Zero Layout Shifts**: Main interface card height locked strictly at 68px across all connection state transitions.
- **Live Connected Client Monitoring**: Real-time connected emulator diagnostics in both the main window and LiveDebug window with instant connect/disconnect callbacks.

### Comprehensive User Documentation
- **New Guides**: Published complete, visual guides in Russian ([`docs/guide.ru.md`](guide.ru.md)) and English ([`docs/guide.en.md`](guide.en.md)).
- **Cemu Socket Lifecycle Documentation**: Detailed breakdown of Cemu's UDP socket lifecycle when starting before or after PhoneGyro, with both instant in-game and startup solutions.
