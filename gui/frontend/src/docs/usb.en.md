# USB controller

PhoneGyro accepts data from ***any 6-axis USB device*** (gyroscope and accelerometer) that sends it using the PhoneGyro protocol. We tested it on a homemade controller: an Arduino Nano board and an MPU-6050 sensor (GY-521 module). Other devices were not tested but should work as long as they follow the protocol.

> [!NOTE]
> Only **6-axis sensors** and only **connection over USB** are supported for now.

1. Build and flash the controller. The schematic, the reference firmware and the protocol description: [PhoneGyro_hardware_protocol](https://github.com/MrHoustonOff/PhoneGyro_hardware_protocol).
2. Pick **USB Controller** as the source at the top of the window and plug in the cable. PhoneGyro finds the device on any COM port, no need to choose one.
3. Calibrate the controller the same way as a phone (see the [Quick start](quickstart.en.md#calibration)). USB controller profiles are stored separately from phone profiles.

> [!WARNING]
> You need firmware with protocol **1.1 or newer**. On older firmware rotations can become 8 times slower. Details: [Troubleshooting](troubleshooting.en.md).
