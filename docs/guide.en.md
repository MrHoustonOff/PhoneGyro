# PhoneGyro User Guide

> **Important:** This guide should not be taken as dry or boring documentation. I strongly recommend reading it completely to avoid issues and save tons of time in the future. **It takes literally 5 minutes!**

---

## In Short: the Way to Playing

No time to read everything? Here is the minimum without which nothing will work right:

1. **Download and launch** `PhoneGyro.exe` ([Releases](https://github.com/MrHoustonOff/PhoneGyro/releases/latest)). Your antivirus may complain — see [below](#security--antivirus-warnings).
2. **Pick the source** at the top of the window: <kbd>Smartphone</kbd> (over Wi-Fi) or <kbd>USB Controller</kbd> (over a cable).
3. **Connect the device:**
   - phone — go through <kbd>Initial Setup</kbd> once, then scan the QR code on the main screen (PC and phone **on the same Wi-Fi network**);
   - USB controller — just plug it in, PhoneGyro finds it by itself ([details](#usb-controller-arduino-nano--mpu-6050)).
4. **CALIBRATE THE DEVICE** — the <kbd>Calibrate</kbd> button on the main screen. **This is not a formality:** without calibration PhoneGyro does not know where your device's "forward" and "right" are, and the in-game aim turns the wrong way or backwards. Done once per device and grip.
5. **Recenter:** on the first connection the app opens a window by itself — pick your calibration profile there and press <kbd>Recenter</kbd>.
6. **Set up the emulator:** server `127.0.0.1`, port `26760`, protocol Cemuhook DSU ([Cemu example](#emulator-setup-cemu-example)).
7. **Play.** If the aim jitters slightly while you hold still, raise the [tremor threshold](#aim-tremor-threshold) in Settings.

> [!IMPORTANT]
> If something "turns the wrong way", "drifts" or is "inverted", 9 times out of 10 it is **an uncalibrated or wrong profile**. Check which profile is selected on the main screen, and recalibrate when in doubt.

---

## Contents

1. [Step 1. Download & Initial Setup](#step-1-download--initial-setup)
   - [Security & Antivirus Warnings](#security--antivirus-warnings)
   - [Smartphone Setup: Android](#smartphone-setup-android)
   - [Smartphone Setup: iOS (iPhone)](#smartphone-setup-ios-iphone)
   - [Why all this hassle with certificates?](#why-all-this-hassle-with-certificates)
2. [Step 2. Smartphone Connection & Mobile Interface](#step-2-smartphone-connection--mobile-interface)
   - [Mobile Interface Breakdown](#mobile-interface-breakdown)
   - [Disconnect & SafeScreen Buttons](#disconnect--safescreen-buttons)
   - [Install as Web App (PWA) & Static IP](#install-as-web-app-pwa--static-ip)
3. [Step 3. Profiles, Calibration & Centering](#step-3-profiles-calibration--centering)
   - [Why do profiles matter?](#why-do-profiles-matter)
   - [Why calibration is mandatory](#why-calibration-is-mandatory)
   - [Step-by-Step Calibration](#step-by-step-calibration)
   - [When to recalibrate](#when-to-recalibrate)
   - [First connection: pick the profile and recenter](#first-connection-pick-the-profile-and-recenter)
   - [Calibration vs Centering (Recenter): Key Difference](#calibration-vs-centering-recenter-key-difference)
4. [USB Controller (Arduino Nano + MPU-6050)](#usb-controller-arduino-nano--mpu-6050)
5. [PC Telemetry & Settings](#pc-telemetry--settings)
   - [Aim tremor threshold](#aim-tremor-threshold)
6. [Emulator Setup (Cemu Example)](#emulator-setup-cemu-example)
7. [Known Issues & Solutions](#known-issues--solutions)
   - [Cemu Launch Order Quirk](#cemu-launch-order-quirk)
   - [The aim jitters slightly](#the-aim-jitters-slightly)
   - [In game everything drifted or turns by itself](#in-game-everything-drifted-or-turns-by-itself)
   - [The USB controller moves very slowly](#the-usb-controller-moves-very-slowly)
8. [Where your data lives and how to remove PhoneGyro](#where-your-data-lives-and-how-to-remove-phonegyro)

---

## Step 1. Download & Initial Setup

Download the latest version of PhoneGyro from GitHub Releases:  
**[Download PhoneGyro (GitHub Releases)](https://github.com/MrHoustonOff/PhoneGyro/releases/latest)**

### Security & Antivirus Warnings

Most likely, your antivirus or built-in <span style="color: #007aff">**Windows Defender (SmartScreen)**</span> will complain about the downloaded `.exe` file or silently block it.

> [!NOTE]
> I have emphasized the security of my code many times. **PhoneGyro is a 100% transparent open-source project (<span style="color: #34c759">Open Source</span>).** If you have even the slightest doubt:
> 
> 1. You can inspect every single line of code directly in this repository.
> 2. Build the executable yourself from scratch using Go and Wails.
> 
> If you trust me — simply restore the file from your antivirus quarantine and/or click in Windows SmartScreen: <kbd>More info</kbd> → <kbd>Run anyway</kbd>.

On the first launch on your PC, click the <kbd>Initial Setup</kbd> button. A QR code will open to establish a secure local communication channel between your phone and PC.

---

### Smartphone Setup: Android

On Android, everything is remarkably simple and requires zero digging into system settings:

1. Scan the Step 1 QR code with your camera and open the local `https://...` link.
2. Chrome will display a standard self-signed certificate warning: <span style="color: #ff9500">*«Your connection is not private»*</span>.
3. Tap at the bottom: <kbd>Advanced</kbd> → <kbd>Proceed to ... (unsafe)</kbd>.
4. **Done!** The browser will permanently remember this exception for your home IP, and the page will open instantly with a single tap in the future.

![Android SSL Setup](imgs/setup-android-ssl.png)

---

### Smartphone Setup: iOS (iPhone)

iOS setup is explained in step-by-step detail **directly inside the app** on PC — under the <kbd>Initial Setup</kbd> tab or in <kbd>Help</kbd> → *Initial Setup* (complete with visual screenshots for each step in iOS Settings).

---

### Why all this hassle with certificates?

> **Technical Fact:**  
> Modern mobile web browsers (especially Safari on iOS and Chrome on Android) strictly **block gyroscope and accelerometer sensor APIs over insecure plain `http://` connections** for security reasons.
> 
> Buying an official public TLS certificate for a private home LAN makes no technical or financial sense. This application is **completely local and runs 100% offline**.
> 
> You generate a local root certificate (for iPhone) or explicitly trust **YOUR OWN LOCAL IP ADDRESS** (for Android). This is completely safe, keeps everything local without third-party servers, and grants sensor access. **Thanks to this solution, you can turn literally any smartphone into a motion controller!**

---

## Step 2. Smartphone Connection & Mobile Interface

Now that your smartphone trusts your PC, scan the **main QR code** on the PhoneGyro home screen.

The mobile web app will open in your mobile browser.

![Mobile Interface](imgs/mobile-ui-overview.png)

### Mobile Interface Breakdown

* **Top Bar:** Quick toggle between light and dark theme, and interface language switcher (<kbd>RU</kbd> / <kbd>EN</kbd>).
* **Sensor Permission (Motion Permission):**  
  If you are visiting for the first time or *«iOS decides to pull its classic Apple quirks»* (clearing permissions in a Safari tab) — a motion prompt will appear. Just tap the large <kbd>Grant Permission</kbd> button.
* **Digital 2D Level (Level Indicator):**  
  Provides an instant visual test: tilt the phone in your hands — the bubble should glide smoothly across the screen. If it reacts, sensors are transmitting live data at 60–120 Hz.
* **Interactive Status Pill:**  
  Displays current real-time network state:
  - <span style="color: #ff9500">🟡 **Connecting...**</span> — performing handshake and opening secure WSS channel.
  - <span style="color: #34c759">🟢 **Streaming (XX Hz, X ms)**</span> — sensors online, telemetry streaming to PC with zero lag.
  - <span style="color: #ff3b30">🔴 **Disconnected**</span> — lost connection to server (ensure phone and PC are connected to the same Wi-Fi network).

---

### Disconnect & SafeScreen Buttons

At the bottom of the mobile screen are two critical action buttons:

1. **Disconnect:**  
   Gracefully terminates the current transmission session and frees the network stream.
2. **SafeScreen (Display Protection):**  
   > **I STRONGLY RECOMMEND ENABLING THIS FIRST THING EVERY SESSION!**
   
   > [!IMPORTANT]
   > **Crucial feature for long gaming sessions:**
   > - **Burn-in Protection & Battery Saver:** Switches the screen into a pitch-black minimalist mode (on OLED/AMOLED displays, black pixels are physically powered off, saving battery and preventing burn-in).
   > - **Sleep Prevention (<span style="color: #007aff">WakeLock</span>):** SafeScreen **guarantees your phone screen will never turn off or go to sleep** during gameplay. The phone will continuously stream gyro data for as many hours as your session lasts.

---

### Install as Web App (PWA) & Static IP

You don't need to scan the QR code with your camera every time — you can save the site as a home screen web app:

* **On iOS (Safari):** Tap the *Share* button (square with arrow pointing up) → select <kbd>Add to Home Screen</kbd>.
* **On Android (Chrome):** Tap the three dots in the top-right corner → select <kbd>Add to Home screen</kbd> (or *«Install app»*).

> [!TIP]
> **Will the IP address change?**  
> In most home Wi-Fi networks, the router assigns a stable local IP to your PC for weeks at a time (DHCP Lease). Therefore, the saved icon on your phone will reconnect seamlessly. You only need to rescan the QR code if your router assigns a new local IP to your computer.

---

## Step 3. Profiles, Calibration & Centering

After connecting a device for the first time, you need to create a profile and calibrate the device. **Do not skip this step.**

### Why do profiles matter?

Every player holds their controller differently: some mount their phone horizontally on a gamepad clip on top, some keep it vertical beside them, and some hold the phone directly in two hands as a standalone steering wheel.

**The profile memorizes geometry:** how your device's physical axes align with the way you hold it. You can create different profiles for different setups (e.g. *«Zelda (Gamepad Clip)»*, *«Racing (Horizontal Wheel)»*).

* Each mode has **6 slots**: the smartphone and the USB controller have **their own, separate** profiles.
* Pick a profile in the dropdown on the main screen.
* Delete a profile — hover it in that dropdown and click the cross that appears on the right; the slot is freed.

![Calibration Window](imgs/calibration-step.png)

### Why calibration is mandatory

> [!IMPORTANT]
> The sensor inside a phone or controller knows nothing about **how you hold it**. The same sensor axis is "up-down" aim in one grip and "left-right" in another. Calibration is exactly what maps the sensor axes onto the gamepad axes.
>
> **Without calibration** (or with a profile from a different grip) the aim moves along the wrong axis, backwards or "diagonally". No sensitivity setting fixes that — only calibration does.

### Step-by-Step Calibration

Click <kbd>Calibrate</kbd> on the main screen. The wizard guides you through four steps, each with a 3D animation of the movement on the right:

1. **Rest ("Stillness")** — put the device down, completely still, **in the same grip and orientation you will play in**, and click <kbd>Record Stillness</kbd>. PhoneGyro measures the gyro's zero offset (the cause of *unwanted crosshair crawling*).
2. **Tilt forward ("Nod")** — click <kbd>Start Capture</kbd> and smoothly tilt the top edge away from you. This tells the program which axis drives vertical aim.
3. **Tilt sideways ("Airplane")** — bank the device to the right, like a plane's wing in a turn.
4. **Axis alignment** — turn the device in your hand in different directions, **combining tilt and twist at the same time** and pausing for a second between moves. This is how the gyroscope and the accelerometer agree with each other.

Then — **the check**: move the device around, the 3D model should follow it exactly. If it does, name the profile, pick a slot and save.

> [!TIP]
> For a USB controller the wizard also measures whether **the sensor board sits tilted inside the case** and corrects for it. You can switch the correction off with the "Sensor mount-tilt compensation" toggle under the profile on the main screen.

### When to recalibrate

* A new device (another phone or controller).
* You changed the grip or the mount (e.g. flipped the phone on the clip).
* A red <span style="color: #ff3b30">**«Outdated»**</span> badge appears next to the profile — its data was recorded by an older app version.
* The in-game aim moves along the wrong axis or backwards.

A calibration does not wear out with time. The date under a profile ("Device: iPhone • 26 Sept") is only there to tell profiles apart.

### First connection: pick the profile and recenter

The first time a device starts streaming after the app launches, PhoneGyro opens the **«First connection»** window by itself:

1. Pick the calibration profile for this device and grip in the list.
2. Hold the device the way you will hold it in game.
3. Press <kbd>Recenter</kbd> and stay still for a second.

There is no other way to close this window — on purpose, so you cannot start playing with the wrong profile. It appears once per launch for each mode (smartphone and USB separately); a Wi-Fi reconnect or a replugged cable does not bring it back.

---

### Calibration vs Centering (Recenter): Key Difference

It is vital to pause here and understand the fundamental physical difference:

> [!NOTE]
> **Emulators (Cemu, Dolphin, Ryujinx) do not care about the device's absolute tilt angle relative to the horizon!**
> Games care strictly about **angular velocity** (how fast and in which direction your hands are turning right now).
>
> - **Calibration** is performed once: it teaches PhoneGyro your personal coordinate system (where *«forward»* and *«right»* are relative to your grip). **It is what decides how the aim behaves in game.**
> - **Centering (<span style="color: #007aff">Recenter / Recenter 3D View</span>)** exists **exclusively for your visual convenience INSIDE THIS APP** — the 3D model and the level. It does not affect the game: "straight ahead" in game is decided by the game or the emulator. If the 3D model in the PC preview gets out of sync with the physical device — simply hold it comfortably and click Recenter.

---

## USB Controller (Arduino Nano + MPU-6050)

Besides a smartphone, PhoneGyro works with a DIY wired controller: an Arduino Nano board and an MPU-6050 sensor (GY-521 module). No Wi-Fi, no certificates, no network delay — a direct 200 Hz link.

1. **Build and flash the controller.** Wiring, firmware and the protocol description are in the [PhoneGyro_hardware_protocol](https://github.com/MrHoustonOff/PhoneGyro_hardware_protocol) repository. The firmware is flashed with the regular Arduino IDE.
   > [!WARNING]
   > You need firmware for **protocol version 1.1 or newer**. With the old firmware (1.0) the app sometimes does not learn the sensor range, and **every rotation becomes 8x slower**. If you flashed your controller earlier — reflash it.
2. **Switch the mode** at the top of the window to <kbd>USB Controller</kbd> and plug in the cable. PhoneGyro finds the device on any COM port by itself — no need to pick a port.
3. **Calibrate** it the same way as a phone (see [Step 3](#step-3-profiles-calibration--centering)). USB controller profiles are stored separately from phone profiles.
4. **Check that all is well** in the <kbd>Stats & 3D View</kbd> window: in USB mode it gains a **«USB Protocol»** section. The **L3 · Metadata** row should show a `±2000 °/s` range and a green «every 1.0 s» badge. A red «none» there means the app did not learn the sensor range: reflash the controller or replug the cable.

---

## PC Telemetry & Settings

* **«Statistics» Tab (Telemetry):**  
  Enables real-time monitoring of connection quality: polling rate (FPS), bitrate, network ping (typically a solid <span style="color: #34c759">**1–3 ms**</span> over local Wi-Fi), and the live list of connected emulator clients with their exact IP and port.
* **«Settings» Tab:**  
  Configure DSU port (`26760`), select network interfaces, customize close-button behavior (minimize to system tray with ultra-low RAM usage), switch UI language, and customize the **global Windows hotkey that recenters the 3D view** (default: `Ctrl+Shift+R`) with an Apple-style interactive shortcut recorder.

![Statistics and Settings](imgs/pc-stats-and-settings.png)

### Aim tremor threshold

Every sensor is a little "noisy", and hands shake slightly. The tremor threshold silences the slowest movements around zero and passes everything faster than twice the threshold unchanged — normal aiming loses no speed.

<kbd>Settings</kbd> has two thresholds — **one for the smartphone and one for the USB controller**, because their sensors are noisy in different ways. The app uses the right one depending on which device is connected. Each option in the list says when to pick it. In short:

| Threshold | When to pick it |
|---|---|
| **0.10°/s** | Smartphones (iPhone and most Android). The phone default. |
| 0.20–0.35°/s | The aim jitters slightly while you hold still. |
| **0.50°/s** | A USB controller with an MPU-6050. The USB default. |
| 0.75–1.00°/s | Strong hand tremor. Fine aim adjustment gets "sticky". |

**Rule of thumb:** pick the lowest threshold at which the aim stays still while you hold still.

---

## Emulator Setup (Cemu Example)

PhoneGyro runs on the industry-standard **Cemuhook DSU (UDP)** protocol. To any emulator, your smartphone behaves identically to a genuine 6-axis motion controller (DualShock 4 / DualSense / Nintendo Switch Pro Controller).

### Step-by-Step Configuration in Cemu 2.0+

1. Open Cemu → navigate to <kbd>Options</kbd> → <kbd>Input Settings</kbd>.
2. Select the **Controller 1** tab (or the player slot you are playing on).
3. **Emulated Controller:** strictly select <span style="color: #007aff">**Wii U GamePad**</span>.
   > [!WARNING]
   > **DO NOT select Wii U Pro Controller!** On the original Wii U console, the Pro Controller physically **did not have a gyroscope**. In games like *The Legend of Zelda: Breath of the Wild*, motion aiming and apparatus shrines read motion data **exclusively from the Wii U GamePad**!
4. **Controller (Input Source):**
   - Click the **`+`** button next to the controller list.
   - In the **API** dropdown, select **`DSUClient`** (or `DSUController`).
   - Ensure the IP is set to `127.0.0.1` and port is `26760`.
   - In the discovered device list, choose `Controller 1` and click <kbd>Add</kbd>.
5. Select the added `Controller 1 [DSUController]`, click the <kbd>Settings</kbd> button below it, and verify that <span style="color: #34c759">**«Use motion»**</span> is checked.
6. Click <kbd>Save</kbd> profile.

![Cemu Input Settings](imgs/cemu-input-settings.png)

---

## Known Issues & Solutions

### Cemu Launch Order Quirk

If you launch Cemu **BEFORE** launching PhoneGyro:

- Cemu sends an initial UDP probe packet to `127.0.0.1:26760` upon startup.
- Because PhoneGyro was **not running yet**, the Windows network stack responds with an ICMP *port unreachable* error.
- Due to the absence of a background retry timer in Cemu's UDP client, the socket worker thread **falls asleep**. In Cemu's UI, the controller plug icon may still appear connected, but motion in-game stays frozen and PhoneGyro displays: <span style="color: #ff9500">*«Waiting for emulators»*</span>.

### Solutions:

* **Method 1 (Recommended & Easiest):**  
  Always launch **PhoneGyro BEFORE launching Cemu** (or enable PhoneGyro autostart to system tray on Windows boot — it consumes less than 20 MB of RAM and 0% CPU).
* **Method 2 (On the fly without closing the game):**  
  If your game is already running and you don't want to close it:
  1. In Cemu, open <kbd>Options</kbd> → <kbd>Input Settings</kbd>.
  2. On your controller line, click **`-`** (remove DSUController) and immediately click **`+`** (re-add: `DSUClient` → `Controller 1`).
  3. This forcefully reinitializes Cemu's UDP socket, and motion data connects instantly without restarting the game!

---

### The aim jitters slightly

The aim trembles even while you hold the device still. That is sensor noise or hand tremor — raise the [tremor threshold](#aim-tremor-threshold) for your device by a step or two. For a USB controller start from 0.50°/s.

### In game everything drifted or turns by itself

* **The aim turns by itself although you do nothing:** open <kbd>Stats & 3D View</kbd>. If the cube there stays still, PhoneGyro is not the cause — the emulator got stuck. Restart the game or the emulator.
* **Movement goes along the wrong axis or backwards:** the wrong profile is selected or the device is not calibrated — see [Step 3](#step-3-profiles-calibration--centering).
* **After a long session "straight ahead" shifted a bit:** normal for any gyroscope — recenter the aim with the game's or the emulator's own means.

### The USB controller moves very slowly

Turns in game and on the 3D model look like "slow motion" — about 8x slower than your hand. The app did not get the sensor range from the controller and runs on the ±250°/s fallback.

1. Look at the «USB Protocol» section in the stats window: the **L3** row shows a red «none».
2. **Reflash the controller** with protocol 1.1 firmware or newer — it reports the range every second, and the problem is gone for good.
3. A quick temporary fix — unplug the USB cable and plug it back in.

---

## Where your data lives and how to remove PhoneGyro

Everything PhoneGyro saves is in one folder, `%APPDATA%\PhoneGyro`:

* settings (`settings.json`) and calibration profiles (`profiles.json`; USB controller profiles are in the `usb` subfolder);
* the iPhone certificate (`ca`);
* logs (`logs`) — useful when reporting a problem;
* the app window's own data (`WebView2_*`).

The path and an "Open folder" button are in **Settings → Behavior & notifications → Data folder**. The folder cannot be changed.

**To remove PhoneGyro completely** (there is no installer, the app is a single file):

1. Close PhoneGyro (including from the tray).
2. Delete `PhoneGyro.exe`.
3. Delete the `%APPDATA%\PhoneGyro` folder.
4. On iPhone/iPad: **Settings → General → VPN & Device Management**, remove the **PhoneGyro Root CA** profile.

To only reset settings and profiles, close the app and delete the folder from step 3: PhoneGyro starts fresh next time (the iPhone certificate then has to be installed again).
