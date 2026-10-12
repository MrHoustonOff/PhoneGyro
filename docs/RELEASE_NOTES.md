Changelog:

**Fixed: slow, steady movements no longer stick to one axis.** The gyro auto-zero mistook them for drift and has been removed; the gyro zero now comes only from calibration.

- If the aim creeps by itself while a USB controller lies still, calibrate again about 5 minutes after connecting: the IMU's zero shifts a little while the board warms up, and the rest step measures it anew. Profiles saved by older versions may also hold a zero the auto-zero had shifted; one calibration fixes it.

**New: a one-time "star on GitHub" window** that shows up after a few long play sessions, never during a game.

### Which file to download
| File | For |
|---|---|
| `PhoneGyro.exe` | **Most users.** Any regular PC or laptop with an Intel or AMD CPU |
| `PhoneGyro-windows-amd64.exe` | **The same app as `PhoneGyro.exe`**, just named after its architecture. You don't need both |
| `PhoneGyro-windows-arm64.exe` | Windows on ARM only (Snapdragon: Surface Pro X / Pro 11, Copilot+ laptops) |

> "amd64" is the name of the x86-64 architecture, not a CPU brand: it runs on both Intel and AMD.

### Antivirus warning?
It's a false positive. PhoneGyro is a small open-source exe without a paid code-signing certificate, and it runs a local network server, which some antivirus heuristics and SmartScreen flag. Every release is built by GitHub Actions straight from this repository. Check the VirusTotal reports and SHA-256 hashes below. In SmartScreen, click "More info" → "Run anyway".
