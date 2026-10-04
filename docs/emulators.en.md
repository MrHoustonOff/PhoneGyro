# Emulator setup

PhoneGyro works as a **Cemuhook DSU** server (UDP). To an emulator your device looks like a gamepad with a gyroscope and accelerometer. Any emulator or program with a DSU client connects the same way:

| Parameter | Value |
|---|---|
| Server address | `127.0.0.1` |
| Port | `26760` |
| Protocol | Cemuhook DSU |

You can change the port in [Settings](settings.en.md). Connected emulators are listed on the main screen in the DSU server card.

> [!TIP]
> Start PhoneGyro first, then the emulator. Why is explained [below](#cemu-startup-order).

## Cemu

1. In Cemu open **Options → Input settings**.
2. Pick the **Controller 1** tab (or the slot you play on).
3. In **Emulated controller** choose **Wii U GamePad**.

   > [!WARNING]
   > Do not choose **Wii U Pro Controller**: it has no gyroscope, and games such as Breath of the Wild will not accept motion.
4. Click **+** next to the controller list, pick **DSUController** as the **API**, make sure `127.0.0.1` and `26760` are set, select the controller that was found and click **Add**.
5. Open the added controller's settings (**Settings**) and turn on **Use motion**.
6. Save the profile.

![Input settings in Cemu](imgs/cemu-input-settings.webp)

### Cemu startup order

If Cemu starts before PhoneGyro, it gets no answer from port `26760` and stops polling it. In the Cemu UI the controller looks connected, but the gyro is silent.

* **Best:** start PhoneGyro before Cemu.
* **If the game is already running:** in Cemu open **Options → Input settings**, click **−** on the DSU controller and **+** right away to add it again. No need to restart the game.

### Drift guard

Cemu mistakes slow movements for gyroscope offset, and the aim "drifts" even while you hold the device still. PhoneGyro works around this bug: **Cemu Drift Guard** is turned on in [Settings](settings.en.md). It only works for Cemu and changes nothing for other emulators. When Cemu is detected, the app tells you whether the guard is on.

## Other emulators

Yuzu, Ryujinx, Dolphin, RPCS3, PCSX2 and other programs with DSU support are set up the same way: add a DSU client and point it at `127.0.0.1:26760`. Where that option lives depends on the emulator and its version, see its documentation.

## If the emulator does not see the server

Check in order:

1. PhoneGyro is running and the DSU card on the main screen shows port `26760`.
2. The emulator uses the same address and port.
3. For Cemu: PhoneGyro was started before the emulator (see above).

For everything else: [Troubleshooting](troubleshooting.en.md).
