# GyroBridge: Work-In-Progress Technical Specification & Emulator Integration

> **Document Status:** Internal Work-in-Progress (WIP) Draft.  
> **Location:** `docs/internal/WIP docs.md` (Ignored by Git).  
> **Scope:** Deep-dive into emulator interconnectivity, Cemuhook DSU protocol engineering, persistent device identification, and hardware IMU expansion.

---

## 1. Emulator Interconnectivity & Cemuhook DSU Integration

### 1.1 Architecture & Role Definition
GyroBridge functions as an ultra-low-latency **DSU Server** (UDP default port `26760`), implementing the canonical Cemuhook protocol created by *rajkosto*. 

Client applications (emulators such as **Cemu, Yuzu, Ryujinx, Dolphin, RPCS3, PCSX2**) act as DSU Clients. They poll the DSU server to detect available motion-capable controllers and subscribe to continuous 6-DOF motion telemetry (3-axis angular velocity and 3-axis accelerometer).

```
+-------------------------------------------------------------+
|                      DATA SOURCES                           |
|  - iOS Safari (devicemotion over WSS Binary Framing)        |
|  - Microcontroller Serial IMU (Arduino / ESP32 Binary Frame)|
+------------------------------+------------------------------+
                               | Internal MotionFrame Pipeline
                               v
+-------------------------------------------------------------+
|                   GYROBRIDGE CORE PIPELINE                  |
|  - Zero Bias Subtraction (w_unbiased = w_raw - gyroBias)    |
|  - 3x3 Signed Permutation Alignment Matrix                  |
|  - Table Lock Gravity Guard [0, -1g, 0]                     |
|  - 1-Euro Adaptive Filter & Hermite Deadband                |
+------------------------------+------------------------------+
                               | Normalized [rad/s] & [g]
                               v
+-------------------------------------------------------------+
|               CEMUHOOK DSU SERVER (pkg/dsu)                 |
|  - UDP Socket: 0.0.0.0:26760 (or configurable user port)    |
|  - Persistent IEEE 802 LAA MAC Address (Slot-based)         |
|  - Instant PadData Handshake Ack (MsgType 0x100002)         |
|  - Smart Idle Heartbeat (60 Hz Zero-CPU / Zero-Traffic)     |
+------------------------------+------------------------------+
                               | 100-Byte DSU Binary Frames
                               v
+-------------------------------------------------------------+
|                 EMULATOR CLIENTS (UDP)                      |
|  - Cemu (Wii U: Zelda BotW, Splatoon, Mario Kart 8)         |
|  - Yuzu / Ryujinx (Nintendo Switch: TotK, Odyssey)          |
|  - Dolphin (Wii / GameCube Motion)                          |
|  - RPCS3 / Steam Input (PS3 Sixaxis / Virtual Gyro)         |
+-------------------------------------------------------------+
```

---

### 1.2 Handshake & Discovery Protocol Flow

All packets utilize little-endian byte ordering, preceded by the 4-byte ASCII magic headers `DSUC` (Client to Server) and `DSUS` (Server to Client), protected by standard IEEE 802.3 CRC-32 checksums.

#### Step 1: Version Negotiation (`0x100000`)
* **Client Request:** Emits `MsgTypeVersion` (`0x100000`) to test protocol support.
* **Server Response:** Returns `0x100000` with payload `uint16(1001)` (Protocol Version 1001).

#### Step 2: Port & Slot Enumeration (`0x100001`)
* **Client Request:** Emits `MsgTypeListPorts` (`0x100001`) querying active slots (typically Slots 0..3).
* **Server Response:** Sends a 36-byte packet:
  - `Slot 0`: `SlotStateConnected` (`2`)
  - `Device Model`: `ModelFullGamepad` (`2`)
  - `Connection Type`: `ConnTypeBluetooth` (`2`)
  - `MAC Address`: 6 bytes of the persistent virtual controller MAC
  - `Battery`: `BatteryFull` (`5`)

#### Step 3: Pad Data Subscription & Streaming (`0x100002`)
* **Client Request:** Emits `MsgTypePadData` (`0x100002`) specifying slot number or target MAC address.
* **Server Response:** 
  1. Registers client remote address in active subscribers registry (`touchClient`).
  2. **Immediately** returns an initial 100-byte `PadData` state frame to complete the subscription handshake without latency.
  3. Begins continuous streaming of 100-byte telemetry packets at the sensor sampling rate (60–250 Hz).

---

### 1.3 Analysis of Emulator Desynchronization & Hot-Plug Solutions

In native gamepads, hardware transmitters never go silent. Prior to this design, connecting an iPhone to Cemu mid-game frequently required restarting the emulator. Three root causes were diagnosed and systematically resolved:

#### 1. Volatile MAC Addresses vs. Persistent Emulator Profiles
* **Problem:** Older server versions generated a random MAC address (`00:13:37:XX:XX:XX`) via `rand()` on every application launch. When Cemu saves controller bindings (e.g., `controller0.xml`), it permanently ties the profile to the specific MAC address. A new launch produced a different MAC, causing Cemu to treat the controller as missing.
* **Solution:**
  - GyroBridge now generates a permanent **Locally Administered Unicast MAC (LAA)** upon initial launch and persists it in `settings.json` (`dsuMac`).
  - Standard prefix `00:13:37` is preserved for universal Cemuhook compatibility.
  - The Settings GUI provides an explicit field with a **Regenerate** button for troubleshooting, accompanied by an explicit warning dialog.

#### 2. Handshake Stalling (`MsgTypePadData` Dead-Air)
* **Problem:** Upon receiving `MsgTypePadData` (`0x100002`), the server previously sent no immediate reply, waiting instead for the mobile browser to push the next frame. If Safari was still connecting or paused, the emulator timed out the handshake socket and dropped the motion provider.
* **Solution:**
  - The server immediately responds to `MsgTypePadData` with the latest motion frame or an initial calibrated neutral rest frame (`AccY = -1.0g, Gyro = 0°/s`).

#### 3. The 3-Second Watchdog & Smart Idle Heartbeat
* **Problem:** Emulators employ a background watchdog timer. If zero UDP packets are received for 3–5 seconds (e.g., while the user sets the phone down or the screen locks), Cemu marks the motion device as *Disconnected* and de-initializes its polling thread.
* **Solution: Smart Idle Heartbeat (`heartbeatLoop`):**
  - **Zero-CPU & Zero-Traffic Guard:** If no emulators are actively subscribed (`len(clients) == 0`), the heartbeat ticker sleeps, transmitting zero packets and consuming 0.00% CPU.
  - **Seamless Live Transition:** When emulators are subscribed, if active motion frames arrive within 35 ms, the heartbeat yields. If active frames pause, the heartbeat emits a stable 60 Hz resting telemetry frame (`RotX,Y,Z = 0.0`, `AccY = -1.0g`).
  - **Result:** Cemu maintains a permanent green connection status; the moment the user resumes motion on mobile or hardware, live tracking engages instantaneously with zero emulator restart.

#### 4. Windows Winsock `WSAECONNRESET` (Error 10054)
* **Problem:** When Cemu starts *before* GyroBridge, Cemu's initial UDP probe to `127.0.0.1:26760` triggers an ICMP *Port Unreachable* from Windows kernel. In Winsock, unhandled ICMP packets put UDP sockets into `WSAECONNRESET` state, causing the listening thread in older Cemu/SDL builds to crash.
* **Operational Rule:** GyroBridge should be kept running as a background tray application or started before launching games. The persistent MAC address ensures that once bound, Cemu hooks into it automatically on startup.

---

### 1.4 Sensor Fusion, Monotonic Timestamps & Eliminating Yaw Integration Drift

#### The Physics of Gyro Integration in Emulators (Cemu Mahony Filter)
Emulators like Cemu calculate controller orientation using an internal sensor fusion algorithm (e.g. `MahonySensorFusion::updateIMU(deltaTime, gx, gy, gz, ax, ay, az)`).
In Cemu (`src/gui/input/MotionHandler.h`, `Mahony.h`):
```cpp
double deltaTime = (double)(timestamp - last_timestamp) / 1000000.0;
if (deltaTime < 0.2) {
    mahony.updateIMU(deltaTime, gx, gy, gz, ax, ay, az);
}
```
1. **Pitch & Roll (Self-Correcting):** The gravity vector ($\vec{g} \approx [0, -1g, 0]$) acts as an absolute physical reference. Any small integration errors in Pitch or Roll are continuously corrected by the accelerometer cross product $\vec{a} \times \vec{g}$.
2. **Yaw (Zero Reference Drift):** Gravity has zero component along the vertical axis ($\vec{g} \times \vec{z} = 0$). Without an active magnetometer (compass), **Yaw is calculated purely by open-loop numerical integration**:
   $$\Delta \theta_{\text{Yaw}} = \int \omega_z(t) \, dt \approx \sum \omega_z[k] \cdot \Delta t[k]$$

#### Why Network / Host Arrival Timestamps Cause Severe Drift
Previously, the DSU packet timestamp was populated on the host PC using `time.Now().UnixNano() / 1000`.
Over Wi-Fi or buffered serial connections, packet arrival is subject to **network jitter** (e.g. 10 ms, then 45 ms, then 2 ms burst).
When rotating the controller quickly:
- If a burst of high angular velocity ($\omega_z = 300^\circ/\text{s}$) arrives after a 45 ms jitter delay, Cemu calculates $\Delta t = 0.045\text{ s}$ and integrates an artificially inflated angle: $300^\circ/\text{s} \times 0.045\text{ s} = 13.5^\circ$.
- When the next packet arrives 2 ms later, even if the user slowed down, the integrated overshoot is permanent because gravity cannot correct Yaw.
- In Zelda: BotW (Apparatus Shrines), this manifested as 25°–30° of apparent orientation tilt when returning the phone to the neutral table position.

#### The Monotonic Timestamp Solution & Avoiding Emulator Shaking
In Cemuhook DSU, emulators poll `MsgTypePadData` and receive asynchronous push packets from `SendMotion`.
- **The Pitfall of Asynchronous Delta Tracking:** If a synthetic delta tracker resets or mixes polling replies (`sendLatestPadDataTo`) with live sensor push frames, Cemu receives packets with alternating $1\text{ ms}$ and $150\text{ ms}$ `deltaTime` values. This causes violent oscillation/shaking ("тряска") during active rotation because $\omega \cdot \Delta t$ wildly jumps between zero and massive steps.
- **The Solution (`pkg/dsu/dsu.go: nextTimestampUs`):** The DSU server utilizes a strictly monotonic microsecond clock anchored to host wall clock:
  ```go
  nowUs := uint64(time.Now().UnixNano() / 1000)
  if nowUs <= s.currentDsuTsUs {
      s.currentDsuTsUs++
  } else {
      s.currentDsuTsUs = nowUs
  }
  ```
  This ensures:
  1. Strict monotonicity: $ts_k > ts_{k-1}$ guaranteed (Cemu never drops a packet).
  2. Smooth real-world `deltaTime` reflecting actual packet transmission rate (~16.6 ms at 60 Hz).
  3. Absolute zero shaking/jitter in Cemu.

#### Note for Future AI Agents & USB IMU Firmware:
- **Game Mechanics Note (Zelda: BotW):** In Zelda BotW, MEMS gyroscopes naturally accumulate Yaw drift during prolonged movement because gravity cannot correct the vertical axis. Nintendo accounted for this: pressing `Отмена (B/A)` on the apparatus pedestal and re-examining it instantly recalibrates the puzzle orientation to $0^\circ$.
- **For USB Microcontrollers (MPU-6050 / ICM-42688P):**
  - Populate `Timestamp_us` in bytes 4..7 using `micros()`.
  - In dedicated USB serial ingestion (unlike asynchronous Wi-Fi + UDP polling), packets arrive synchronously on the serial bus. The Go worker computes:
    ```go
    deltaUs := uint32(currentMcuMicros - lastMcuMicros) // standard uint32 modular arithmetic handles 71.5-minute rollover automatically
    sourceTsUs += uint64(deltaUs)
    frame.TimestampUs = sourceTsUs
    ```

---

## 2. Hardware IMU Ingestion Architecture (Arduino / ESP32)

### 2.1 Pragmatic Golden Standard Framing (Fixed 24 Bytes @ 200 Hz)

To support microcontrollers lacking floating-point units (such as the 8-bit **Arduino Nano ATmega328P** with 2 KB SRAM) alongside 32-bit platforms (**ESP32, RP2040, STM32**), the hardware protocol utilizes a fixed-size zero-allocation binary layout.

```
Offset  Size  Type       Field          Description
-------------------------------------------------------------------------
0..1     2    uint16     Magic          0xAA 0x55 (Little-Endian Sync Header)
2        1    uint8      Type           0x01 = Raw 6-DOF IMU Frame
3        1    uint8      Seq            Rolling packet counter (0..255)
4..7     4    uint32     Timestamp_us   Hardware micros() timer from MCU
8..13    6    int16[3]   Accel X,Y,Z    Raw MPU-6050 accelerometer registers (±4g)
14..19   6    int16[3]   Gyro X,Y,Z     Raw MPU-6050 gyroscope registers (±2000°/s)
20..21   2    int16      Raw Temp       On-chip temperature register
22       1    uint8      Buttons        Bit 0: Center/Recalibrate, Bits 1..7: Triggers
23       1    uint8      Checksum       XOR sum of bytes [2..22]
-------------------------------------------------------------------------
Total: 24 bytes fixed frame.
```

### 2.2 Functional Separation: Firmware vs. Go Backend

1. **Microcontroller Firmware Responsibility:**
   - Initialize I2C in Fast Mode (`400 kHz`).
   - Read 14 raw IMU data registers into an aligned 24-byte RAM buffer.
   - Transmit over USB UART at `115200` or `250000` baud.
   - **MCU CPU utilization is < 3%** with zero dynamic memory allocation.

2. **GyroBridge Go Backend Responsibility:**
   - Background worker processes the selected virtual COM port.
   - Validates sync header `0xAA 0x55` and byte-level checksum.
   - Converts raw integer units:
     $$\omega_{\text{rad/s}} = \text{rawGyro} \times \left(\frac{2000}{32768}\right) \times \left(\frac{\pi}{180}\right)$$
     $$a_{g} = \text{rawAccel} \times \left(\frac{4.0}{32768}\right)$$
   - Injects normalized values directly into the unified `MotionFrame` channel, automatically inheriting the existing calibration matrix, Table Lock filter, and Cemuhook DSU server.
