# Connecting a phone

This page is about what you see on the phone and what to do about it. If you have not yet installed the certificate (iPhone) or confirmed the Chrome warning (Android), start with the [Quick start](quickstart.en.md).

## How to connect

1. Pick **Smartphone** as the source at the top of the PhoneGyro window.
2. The phone and the PC must be **on the same Wi-Fi network**.
3. Scan the QR code on the main screen with the camera. It opens the controller page in Safari or Chrome.

Once connected, the main screen shows the device card and the phone page says "Connected • Streaming".

> [!NOTE]
> If the PC is in **USB Controller** mode, the phone cannot connect. The page says "PC in USB Mode". Switch the source back to **Smartphone**.

## The phone page

### What is on the screen

* **Device chip and status dot** at the top. The dot shows whether the link to the PC is up.
* **Header buttons:** Touch Shield, theme and language (RU / EN). They only change the phone page, not the PC app.
* **Dial with a bubble** (labelled "Level"). Tilt the phone: if the bubble moves smoothly, the sensors work.
* **Connection block:** status, rate (Hz) and a **Disconnect** / **Reconnect** button.

### Sensor access

If the browser does not give out gyro data, a "Sensor Access Required" card with an **Enable sensors** button appears. Tap it. If you refused on iPhone before, Safari will not ask again, and you have to turn it on by hand: **Settings → Safari → Motion & Orientation Access**.

### Statuses

| Status | Meaning |
|---|---|
| Connecting... | The page is opening a secure channel to the PC. |
| Connected • Streaming | Data is flowing to the PC. |
| Disconnected | The link is lost. Tap **Reconnect** and check both devices are on the same network. |
| PC in USB Mode | PhoneGyro's source is set to "USB Controller". |

## Touch Shield

A button in the phone page header. Turn it on **every time** you play.

* The phone screen **does not turn off** while the shield is on. If the screen does turn off, the phone stops sending data.
* Stray touches press nothing: one big button is left on the screen.
* To exit, **hold** that button for 4 seconds.

## Home screen icon

To avoid scanning the QR every time, add the controller page to the phone's home screen:

* **iPhone (Safari):** Share → **Add to Home Screen**.
* **Android (Chrome):** menu ⋮ → **Add to Home screen** (or "Install app").

The icon opens the same address. If the PC's IP address changed (another network, tethering from the phone), the old icon stops opening: scan the QR again and add the icon once more.

> [!NOTE]
> After an IP change the browser may show the certificate warning again. When exactly is described in [Certificates and TLS](tls.en.md).

## If the link drops

PhoneGyro notices a lost link or a phone screen turning off on its own:

* It shows a "Device Disconnected" warning (turned on in [Settings](settings.en.md)).
* After 2 seconds without sensor data it drops the connection, if **Disconnect on Sensor Silence** is on.
* It plays a sound, unless sounds are off.

If the phone does not connect at all, see [Troubleshooting](troubleshooting.en.md).
