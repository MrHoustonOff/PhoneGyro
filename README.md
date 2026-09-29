**English** | [Русский](docs/README_RU.md)

<!-- TODO: logo -->

# PhoneGyro

> [!IMPORTANT]
> **Formerly GyroBridge.** Since v2.0.0 the project is called PhoneGyro. All GyroBridge v1.x releases are deprecated and considered highly unstable — use v2.0.0 or newer. There is no migration from v1.x: reinstall the certificate on iPhone/iPad and recalibrate. See the [v2.0.0 release notes](docs/RELEASE_NOTES.md).

> 📖 **Comprehensive User Guide**: [English User Guide](docs/guide.en.md) | [Русскоязычное руководство](docs/guide.ru.md)

PhoneGyro turns your smartphone (iOS or Android) or a USB motion controller (Arduino Nano + MPU-6050) into a motion controller for PC games and emulators using the Cemuhook DSU protocol.

<!-- TODO: video or animated demo gif -->

![PhoneGyro Core Interface](docs/imgs/core%20screen.jpg)

Compatible with Cemu, RPCS3, Ryujinx, Yuzu, Dolphin, PCSX2, and any game or tool supporting Cemuhook DSU.

---

## Quick Start

### 1. Download
Download `PhoneGyro.exe` (or `PhoneGyro-windows-arm64.exe` for ARM-based Windows devices) from the latest [GitHub Releases](https://github.com/MrHoustonOff/PhoneGyro/releases).

### 2. Launch
Make sure your PC and smartphone are connected to the **same Wi-Fi network**. Launch `PhoneGyro.exe`.

### 3. Connect a Device
Pick the source at the top of the window: **Smartphone** or **USB Controller**.
- **iOS (iPhone / iPad)**: Click **Initial Setup** in the app and follow the step-by-step guide to install the local profile certificate required by Safari to access motion sensors over HTTPS.
- **Android**: Scan the QR code on the main screen with your camera and open the controller web app in Google Chrome.
- **USB controller** (Arduino Nano + MPU-6050): flash the [reference firmware](https://github.com/MrHoustonOff/PhoneGyro_hardware_protocol) (protocol 1.1+) and plug it in — PhoneGyro finds it on any COM port by itself.

### 4. Calibrate — mandatory step
Click **Calibrate** and follow the wizard (rest, nod, bank, axis alignment — about a minute). Calibration tells PhoneGyro where "forward" and "right" are for your grip; **without it the in-game aim turns along the wrong axis or backwards.** Perform this once per device and grip; phone and USB profiles are stored separately.

### 4½. Pick the profile and recenter
On first connection PhoneGyro opens the recenter window: hold the device as you will hold it in game, pick your calibration profile, and press **Recenter**.

### 5. Configure Emulator
In your emulator's input/controller settings, configure the motion server:
- **Server IP**: `127.0.0.1`
- **Server Port**: `26760`
- **Protocol**: Cemuhook DSU

> Aim jitters slightly while you hold still? Raise the **tremor threshold** in Settings (separate for phone and USB). Details in the [User Guide](docs/guide.en.md).

---

## Live 3D Telemetry & Diagnostics

Click **Stats & 3D View** in the header to open the dedicated real-time 3D telemetry and diagnostics window to verify sensor response, orientation stability, and DSU packet delivery rate:

![3D Telemetry & Diagnostics](docs/imgs/3d%20view%20screen.jpg)

---

## Advanced Settings & Customization

Click the **Settings** button in the header to access advanced options:
- **Interactive Test Bench**: Live multi-axis oscilloscope, 3D target viewfinder, and apparatus tilt mini-bench to test response and filters before gaming.
- **Custom Ports**: Modify Cemuhook DSU (`26760`), HTTP pairing (`8080`), and HTTPS controller (`8443`) ports with real-time collision checks.
- **Gyro Deadband & Sensitivity**: Silence resting sensor micro-jitter with a soft deadband and scale gyro response. Motion itself is sent unsmoothed and drift-corrected (see [Motion Pipeline](docs/motion-pipeline.md)).
- **Global UI Scaling**: Scale the interface and fonts (`0.80x` - `1.40x`) with desktop shortcuts (`Ctrl +`, `Ctrl -`, `Ctrl 0`).
- **Audio Feedback**: Choose between synthesized chimes, classic Windows system sounds, or silent mode.
- **Appearance**: Switch between Apple-inspired dark and light interfaces.

---

## Security, Antivirus & Transparency

PhoneGyro is 100% open-source software under the MIT license. It contains zero trackers, no telemetry, and makes no external internet connections whatsoever — all communication is strictly between your phone and your PC over your local home Wi-Fi.

### Antivirus False Positives Notice
Independent open-source developers rarely purchase proprietary EV (Extended Validation) code signing certificates due to exorbitant recurring costs ($400+/year). Because of this, automated machine-learning heuristics in certain antivirus software (e.g., Microsoft Defender generic `!ml` tags) might flag freshly compiled binaries as unfamiliar.

We regularly scan release binaries against VirusTotal (69+ engines clean). If you have any security reservations:
- **Inspect the Source**: Review the entire codebase yourself or pass it to any AI agent (Claude, ChatGPT, Gemini, etc.) to perform an independent security review.
- **Build from Source**: Follow the instructions below to compile the binary directly on your own machine using Go and Wails.

---

## Building from Source

Prerequisites:
- [Go](https://go.dev/) 1.25+
- [Node.js](https://nodejs.org/) 18+
- [Wails CLI v2](https://wails.io) (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

```bash
# Clone the repository
git clone https://github.com/MrHoustonOff/PhoneGyro.git
cd PhoneGyro/gui

# Build Windows x86_64
wails build -tags native_webview2loader -o PhoneGyro.exe

# Build Windows ARM64
wails build -tags native_webview2loader -platform windows/arm64 -o PhoneGyro-arm64.exe
```

The compiled binaries will be placed in `gui/build/bin/`.

### Project Layout

```
gui/                    Windows app (Wails); main.go only embeds the UI and starts it
  internal/app/         the App API the UI calls, settings, profiles, calibration,
                        the frame pipeline, USB host
  internal/motion/      motion math: calibration matrices, axis alignment, AHRS,
                        iOS attitude anchor, gyro bias, deadband, mount tilt
  internal/hwproto/     USB hardware protocol wire format (frame, CRC, decoder)
  internal/link/        link-loss statistics and the data-loss alarm
  internal/resmon/      CPU / RAM monitor
  internal/dsuclients/  names local DSU clients after their program, focuses its window
  internal/tray/        tray icon, its menu and the global recenter hotkey
  internal/version/     build identity (release tag, build number, channel)
  frontend/src/         UI: index.html + js/ + css/, Live Debug window
pkg/server/             phone HTTPS/WebSocket server, USB frame injection
pkg/dsu/                Cemuhook DSU server
pkg/ca/, pkg/pairing/   local certificate authority, QR codes
pkg/i18n/               RU/EN translations
web/                    the phone page
docs/                   user guides, motion pipeline notes
```

---

## License

This project is open-source and licensed under the [MIT License](LICENSE).
