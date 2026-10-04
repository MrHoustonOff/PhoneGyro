# Troubleshooting

> [!TIP]
> ***Something odd with the aim or the device? Calibrate again first.*** It fixes most cases: [Quick start](quickstart.en.md#calibration).

## The phone does not connect

Check in order:

1. The source at the top of the PhoneGyro window is **Smartphone**. In USB mode a phone cannot connect.
2. The phone and the PC are on the ***same Wi-Fi network***. If you changed networks or the computer's IP, scan the QR code again.
3. ***Windows Firewall*** lets PhoneGyro through (see below).
4. The certificate: on iPhone it is installed and trusted, on Android you confirmed the Chrome warning ([Quick start](quickstart.en.md#preparing-the-phone)).
5. The browser: Safari on iPhone, Chrome on Android.
6. If sensor access was refused, tap **Enable sensors** on the phone page ([Connecting a phone](phone.en.md#sensor-access)).

### The phone cannot connect: Windows Firewall

The phone connects to the PC over Wi-Fi, and Windows Firewall has to let these connections in. On first launch Windows asks for permission itself. If you closed that window or clicked "Cancel", the phone will not connect and Windows will not ask again.

The state is shown in **Settings → Network & Server Ports → Windows Firewall**. If it says "Blocked" or "Not allowed", click **Allow** and confirm the administrator prompt. In phone mode PhoneGyro reminds you at every launch until the permission is given.

> [!IMPORTANT]
> The permission is tied to the ***file path***. If you moved `PhoneGyro.exe` to another folder, Windows asks again, and if you clicked "Cancel" then, the phone stops connecting. The certificate has nothing to do with it.

A USB controller does not need the permission. If you have a third-party antivirus with its own firewall, allow PhoneGyro there too.

## The emulator does not see the server

Address `127.0.0.1`, port `26760`, and PhoneGyro must be running ***before the emulator***. Details, including the Cemu workaround: [Emulator setup](emulators.en.md#cemu-startup-order).

## The aim jitters

Any sensor is a little noisy and hands tremble slightly. The ***tremor threshold*** flattens the slowest movements to zero and passes everything faster than twice the threshold unchanged, so ordinary aiming loses no speed.

[Settings](settings.en.md) has two thresholds, one for the ***smartphone*** and one for the ***USB controller***, tuned independently. The app uses the one for the connected device.

| Threshold | When to pick it |
|---|---|
| 0.10 °/s | Phones. The default for a phone. |
| 0.20–0.35 °/s | The aim jitters while you hold still. |
| 0.50 °/s | A USB controller with an MPU-6050. The default for USB. |
| 0.75–1.00 °/s | Strong hand tremor. Fine aiming gets "sticky". |

***Rule:*** take the lowest threshold at which the aim stays put when you hold still.

## The aim drifts, motion goes the wrong way

* **It spins by itself although you do not move.** If this is Cemu, turn on **Cemu Drift Guard** in settings ([details](emulators.en.md#drift-guard)). If not, restart the game or the emulator: it may have "stuck".
* **Motion goes along the wrong axis, backwards or too fast.** The wrong profile is selected or the device is not calibrated: ***calibrate again*** in the grip you play in.
* **After a long session "straight ahead" drifted a bit.** Normal for any gyroscope. Recenter the aim with the game's or the emulator's own means. The **Recenter 3D View** button in PhoneGyro does not affect the game.

## The USB controller moves very slowly

Turns look like slow motion, roughly 8 times slower than your hand: the app did not receive the sensor range from the controller and uses a fallback of ±250 °/s.

1. Open the stats window: in USB mode it has a protocol section. Row **L3** is red when this happens.
2. ***Reflash the controller*** with protocol 1.1 or newer firmware: it reports the range every second.
3. A quick temporary fix: unplug the USB cable and plug it in again.

## A port will not change

DSU, HTTP and HTTPS ports must be between 1024 and 65535 and ***must not match*** each other. Otherwise the settings are not saved.

## Nothing helped

Describe the problem and attach the log: [Reporting a problem](issues.en.md).
