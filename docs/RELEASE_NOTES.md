Changelog:

**Fixed: very slow, steady movements no longer stick to one axis.** The gyroscope "auto-zero" took a slow, smooth turn for sensor drift and subtracted it, so after a few seconds the movement vanished from the output and the aim felt pulled onto the other axis. Most noticeable with the USB controller. The auto-zero is removed, together with its strip on the device card: the gyroscope zero now comes only from calibration.

- If the aim creeps by itself while a USB controller lies still, calibrate again about 5 minutes after connecting: the MPU-6050's zero shifts a little while the board warms up, and the rest step measures it anew. Profiles saved by older versions may also hold a zero the auto-zero had shifted; one calibration fixes it.

**New: a one-time "star on GitHub" window.** After a few long play sessions (with any DSU client), when the game disconnects, PhoneGyro asks once to star the project. "Remind me later" brings it back at most once, a week later; "Give a star" or "Don't show again" end it for good. It never appears during a game, calibration or while the window is in the tray.
