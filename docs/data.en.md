# Data and uninstall

Everything PhoneGyro saves lives in ***one folder***: `%APPDATA%\PhoneGyro`. The path and an **Open folder** button are in [Settings](settings.en.md), the **Data folder** item. The folder cannot be changed.

![Settings: data folder](imgs/settings.webp)

## What is inside

| What | Where |
|---|---|
| Settings | `settings.json` |
| Calibration profiles | `profiles.json`; USB controller profiles in the `usb` subfolder |
| iPhone certificate | the `ca` folder |
| Logs | the `logs` folder (handy when you [report a problem](issues.en.md)) |
| Window engine data | `WebView2_*` folders |

PhoneGyro has no installer, the program is a single `PhoneGyro.exe`. You can move it anywhere and the settings stay.

## Reset settings

Close PhoneGyro (including the tray) and delete the data folder. On the next launch the program starts from a clean slate.

> [!WARNING]
> The folder holds your calibration profiles and the certificate. On iPhone you will have to install the certificate again ([Certificates and TLS](tls.en.md)).

## Remove PhoneGyro completely

1. Close PhoneGyro, including the tray.
2. Delete `PhoneGyro.exe`.
3. Delete the `%APPDATA%\PhoneGyro` folder.
4. On iPhone or iPad: **Settings → General → VPN & Device Management**, delete the **PhoneGyro Root CA (PC name)** profile. In older versions it was called **PhoneGyro Controller Profile**.
5. If Windows Firewall still has allow rules for PhoneGyro, you can delete them in the firewall settings.
