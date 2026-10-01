# Brief for the coding agent (PhoneGyro UI redesign)

Goal: restyle the existing Go + Wails app (`gui/frontend`, `web/`) to this design system. Do not change behaviour, IPC, or Go code except where stated.

## Read in this order
1. `README.md` (language of the system, tokens, layout rules).
2. `MIGRATION.md` (sections 1 to 10: file-by-file mapping, header/footer overlay, title bar, tray, responsive and zoom). This is the task list.
3. `components/<Name>/README.md` before touching a component; `components/<Name>/preview.html` is the reference markup (copy the classes, do not reinvent).
4. `tokens.json`, `tokens.css`, `components/bundle.css`, `components/bundle.js`, `fonts/`, `assets/` are the code you drop into the app.

## Non-negotiables
- Only tokens (`var(--…)`); no hard-coded colours, no warm/paper tints: near-white and near-black themes only.
- Every screen is a `.pg-app.pg-shell.pg-window` inside `#pg-root`, call `PhoneGyro.mount(windowEl)` once. Breakpoints are `@container pgwin`, never `@media`. Never use `vh`/`vw` inside the app (breaks zoom).
- No pixel widths on cards; wide mode scrolls panels, compact mode scrolls the shell body.
- Header tabs (Settings, Stats & 3D View, Docs) are on every desktop screen. No fps island.
- RU and EN are equal: every string comes from the i18n files, layouts must survive RU text (about 20 to 30 % longer).
- Fonts: Alegreya Sans (display), Onest (text), JetBrains Mono (numbers, code); local woff2, no CDN.
- Wails: `IsZoomControlEnabled=false`, frameless only if the optional `TitleBar` is used.

## Suggested order of work (one PR each)
1. Drop in tokens, fonts, `bundle.css/js`; wrap the window in `#pg-root`; header + footer (`AppShell`), theme + zoom.
2. Connect and USB Controller screens (`ScreenConnect`, `ScreenUsb`).
3. Stats and 3D (`ScreenTelemetry`, `GyroScene`; port `createScene/loadGLB/tintGamepad` to the existing Three.js scene).
4. Settings, then Docs (replaces the Help modal), then the Setup wizard.
5. Splash, tray popup, app icons, phone web page (`ScreenMobile`, `ScreenMobileLock`).

## Definition of done per screen
Matches its `preview.html` in light and dark; passes at window widths 340, 400, 820, 1280, 1920 (see the `Responsive*` cards) with no horizontal scroll; usable at zoom 50 % and 300 %; RU and EN checked.
