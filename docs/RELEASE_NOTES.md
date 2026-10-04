Changelog:

**A complete redesign of the graphical interface**: a new phone page and Touch Shield, startup animation, header, footer, main screen, calibration wizard, statistics and 3D view.

**Important for iPhone and iPad:** the certificate is now limited to local networks, so it has to be installed once more (Initial Setup tab). Android only shows the Chrome warning again.

- Security and network: the root certificate is valid only for local addresses; the server certificate is stored and reissued only when the PC gets a new address. A new PC address is picked up without a restart. Port changes apply at once. State files are written atomically. Phone WebSocket checks the origin and limits message size; at most 16 DSU subscribers. The old Live Debug window and its network routes are removed.
- Firewall: on first launch the app waits for the answer to the Windows prompt.
- Tray and memory: the tray menu lists the connected emulators, the minimize button asks "window or tray", and in the tray the interface is unloaded and WebView2 goes into efficiency mode while the gyro keeps working. The footer shows RAM as CORE (the app) and WEB (the interface).
- Updates: the footer shows the update check status (the check is optional and off by default).
- Gyroscope: better rest detection and bias refinement with a progress strip on the device card. Centering and the profile pick return when a known device connects.
- USB: a SEQ jump is no longer counted as packet loss.
- Statistics: loss counters start from the moment you open the page.
- Performance: lighter 3D view and fewer interface updates. A benchmark tool (bench.cmd) measures the real app.
- Documentation: rewritten in Russian and English, built into the app and available offline (Docs tab), with contributor and bug-report guides.
