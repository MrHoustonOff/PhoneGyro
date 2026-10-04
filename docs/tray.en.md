# Tray and memory

> [!IMPORTANT]
> ***Keep PhoneGyro in the tray while you play.*** The gyro keeps working as usual, and your computer gets noticeably less load.

## How to hide to the tray

The **minimize** button in the window title bar ***always asks*** what to do: minimize the window or put it in the tray.

![Minimize dialog](imgs/minimize-dialog.webp)

* **Minimize window** is the usual minimize to the taskbar. The UI stays in memory.
* **Hide to tray** hides the window, the PhoneGyro icon stays in the notification area.

The close button (the cross) works the same way. The **Action on Window Close** item in [Settings](settings.en.md) decides what it does: ask every time, minimize to the tray, or quit the app completely. The dialog has a **Remember my choice** checkbox.

## What happens in the tray

* ***The gyro keeps working.*** The DSU server, the phone and USB controller links and the link-loss watch run exactly as with the window open.
* **The UI is unloaded.** A couple of seconds after the window is hidden the page is replaced by an empty one: no interface or 3D stays in memory.
* **WebView2 goes into efficiency mode.** That is the green leaf in Task Manager: low priority and power saving.
* **Memory drops sharply.** PhoneGyro hands back to Windows everything it can do without.

DSU and the phone link are not slowed down: efficiency mode only applies to the window processes.

> [!WARNING]
> Do not hide the app to the tray in the middle of calibration: the interface is unloaded and an unfinished recording is discarded.

## Bring the window back

Double-click the PhoneGyro tray icon or pick **Open PhoneGyro** from its menu. The interface loads again and the launch animation is skipped.

## Tray menu

Right-click the icon:

| Item | What it shows or does |
|---|---|
| **Open PhoneGyro** | Brings the window back. |
| Device | The device name and status: online, paused or waiting for connection. |
| **Emulators** | Names of the programs currently connected to the DSU server. |
| Profile | The active control profile. |
| **Pause / Resume** | Pauses and resumes motion output. Visible while the device is online. |
| **Quit** | Closes PhoneGyro completely. |

## Memory in the window footer

The bottom of the window shows **RAM** as two numbers:

* ***CORE*** is PhoneGyro itself (the Go program): the server, motion processing, DSU.
* ***WEB*** is the interface window, the **WebView2** engine built into Windows.

Nearly all the memory goes to WEB: it is an ordinary browser engine with 3D and charts. That is why the window is best kept in the tray while you play: WEB disappears and CORE remains.
