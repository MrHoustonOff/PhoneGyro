# Reporting a problem

A good report cuts the path to a fix many times over. Open an issue here: [github.com/MrHoustonOff/PhoneGyro/issues](https://github.com/MrHoustonOff/PhoneGyro/issues). First glance through [Troubleshooting](troubleshooting.en.md): the answer may be there.

## What to include

* ***PhoneGyro version.*** It is in the window footer, for example `2.0.2.017`, along with the channel (`release` or `dev`).
* ***Windows version*** and architecture (x64 or ARM64).
* ***Source:*** a smartphone (model, iOS or Android, browser) or a USB controller (board, sensor, firmware version).
* ***The emulator or game*** where the problem happens.
* ***What you did, what you expected and what happened.*** The steps to reproduce.
* When it started and whether it worked before.

## The log

A log is needed almost every time.

1. Open [Settings](settings.en.md) and turn on **Write the debug log**.
2. Reproduce the problem.
3. Open the data folder (**Settings → Data folder → Open folder**) and take the `logs/debug.log` file.
4. Attach it to the issue.

The log records a session header, the startup stages, a summary line every second, warnings and errors. A file over 5 MB is rotated, so take it right after the problem. Open it before sending and make sure you are fine with its contents.

For hard cases there is the **Debug window** (also in settings): a separate window with frame rate, load, ping and warnings. A screenshot of it helps too.

## Screenshots

Attach a screenshot of the main screen and, if the problem is with motion, a screenshot of the **Stats & 3D View** window.

## If it is a security problem

Do not post it in a public issue. Contact the author through their GitHub profile.
