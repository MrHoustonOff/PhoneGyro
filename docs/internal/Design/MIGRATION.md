# Migrating the PhoneGyro app

Goal: replace the Apple-style `gui/frontend/src/main.css` look with this system without touching behaviour (JS, Wails calls, i18n keys, element ids). Work screen by screen and keep the app runnable after each step.

## 1. Install

1. Copy `fonts/*.woff2` to `gui/frontend/src/assets/fonts/` (delete the old Nunito file when nothing references it).
2. Add `tokens.css` (from this system's `tokens.css`, generated) and `components/bundle.css` to the frontend and import both before `main.css` (Wails/Vite: `import './tokens.css'; import './bundle.css';`). Font URLs inside `tokens.css` are relative to the fonts folder: adjust them to `assets/fonts/`.
3. Root element: `<html data-theme="light">` (the existing theme toggle keeps switching `data-theme`; default stays whatever the app stores). Add `class="pg-app"` to `<body>`.
4. Three.js code that hard-codes face colours must read the `--viz-*` tokens (see Viewport).

## 2. Variables: old → new

| old (`main.css`) | new |
| --- | --- |
| `--bg` | `--bg` |
| `--surface`, `--surface-modal` | `--surface`, `--surface-raised` (modal) |
| `--surface-hover` | `--surface-hover` |
| `--surface-elevated`, `--segmented-bg`, inputs | `--surface-inset` for wells; `--surface` for cards |
| `--border`, `--border-subtle` | `--line`, `--line-subtle` (controls: `--line-control`) |
| `--text`, `--text-secondary`, `--text-tertiary` | `--ink`, `--ink-2`, `--ink-3` |
| `--btn-primary-bg`, `--btn-primary-text` | `--ink`, `--on-ink` |
| `--btn-secondary-*` | `--surface` with `--line` |
| `--apple-blue` (links, info, USB waiting) | links: `--accent-text`; info / USB: `--info`, `--info-text`, `--info-soft` |
| `--apple-green`, `--dot-online` | `--accent` (text: `--accent-text`) |
| `--apple-red`, `--dot-offline` | `--danger` (text: `--danger-text`) |
| `--dot-paused`, orange | `--warn` (text: `--warn-text`) |
| `--card-shadow` | `--shadow-card` (modal: `--shadow-pop`) |
| `--radius-xl/lg/md/sm` 24/16/12/8 | `--radius-xl/lg/md/sm` 22/14/10/6 |
| `--font-sans` (SF/Segoe stack) | `--font-sans` (Onest); display titles use `--font-display` |

## 3. Classes: old → new

| old | new |
| --- | --- |
| `app-header`, `header-left`, `header-controls` | `pg-header` with `pg-island`s (see AppShell); `brand-title` → `pg-island pg-brand` |
| header nav buttons | `pg-tab` inside `nav.pg-island` (+ `is-active`) |
| footer bar, RAM chip | `pg-footer` with `pg-island pg-island--sm` (CPU, RAM, repo link) |
| Help button + `help-*` modal | `Docs` tab + `ScreenDocs`; text via `pg-prose` |
| setup wizard classes (`setup-*`, `ios-step-*`, `wizard-dot`) | `ScreenSetup` layout, `pg-dots`, `pg-disclosure`, `pg-devshot` |
| `btn-icon` | `pg-btn-icon` |
| `btn-apple-primary` | `pg-btn pg-btn--primary pg-btn--lg` |
| `btn-apple-secondary` | `pg-btn` |
| `segmented-control`, `segmented-btn.active`, `settings-seg-btn` | `pg-seg`, `pg-seg__btn.is-active` |
| `status-capsule.online/.offline/.paused/.waiting-usb`, `status-dot` | `pg-status--online/…/--usb`, `pg-status__dot` |
| `apple-toggle`, `apple-toggle-slider` | `pg-toggle`, `pg-toggle__track` |
| `settings-section-header` | `pg-overline` with `<span class="pg-ring">` |
| `settings-grouped-card` | `pg-group__list` (inside `pg-group`) |
| `setting-row`, `setting-label-row`, `setting-label`, `setting-control` | `pg-row`, `pg-row__label`, (label text), `pg-row__control` |
| `setting-info`, `setting-infotip` | `pg-info` (tooltip text keeps its own popover) |
| `setting-value-badge` | `pg-value` |
| `setting-input-num`, `setting-select`, `setting-slider` | `pg-input pg-input--num`, `pg-select`, `pg-slider` |
| `url-chip`, `url-text`, `copy-badge`, `qr-image` | `pg-url`, `pg-url__text`, `pg-btn--sm`, `pg-qr` |
| `cal-step-pill`, `step-num`, `cal-step-connector`, `cal-screen` | `pg-step`, `pg-step__num`, `pg-step__link`, `pg-modal` |
| `md-code`, `md-link` | `pg-code`, `pg-link` |

Classes not listed keep their layout rules but must replace every colour, radius, font and shadow with tokens; delete rules that only existed to fake Apple (translucent blurs, SF-specific letter-spacing, blue focus).

## 4. Per screen

- **Connect** (`ScreenConnect`): wrap the pairing block in `pg-card pg-card--hero pg-rings-corner`; QR in `pg-qr` (always white); DSU status as `pg-notice pg-notice--warn`; add `pg-drift` to the body wrapper.
- **Stats & 3D** (`ScreenTelemetry`): split is 40/60 (`grid-template-columns:2fr 3fr`); statistics tiles in 3 columns with short badges (`ok`/`warn`), the three settings rows share one card; stat tiles become `pg-stat` with `pg-spark`; axis tiles `pg-axis`; viewports `pg-viewport`; recording block `pg-rec`. No `pg-drift` here.
- **Settings** (`ScreenSettings`): three `pg-group`s; bench in `pg-card` with `pg-bench`.
- **Calibration** (`Modal`): replace the sheet and stepper; keep the wizard state machine untouched.
- **Phone web (`web/index.html`)**: same tokens and `bundle.css`. Top bar → `pg-mbar` (chip `pg-mchip`, round buttons `pg-btn-icon pg-btn-icon--round`), level dial → `pg-dial` (set `--bx/--by` from tilt), status/pause block → `pg-pause` (`pg-pause--paused` when paused), Disconnect / Touch Shield → `pg-btn` in `pg-mrow`, footer → `pg-mfoot`. Touch Shield overlay → `ScreenMobileLock`: `pg-lock` + `pg-lockbtn` + `PhoneGyro.holdToUnlock(btn, {ms: 4000, onDone})`; keep the existing shield state logic and call it from `onDone`. Add `pg-drift pg-drift--fast` to the overlay root.

## 5. Check before finishing

1. Both themes: no pure `#fff`/`#000` fills except the QR plate; no leftover `--apple-*`.
2. Tab through every screen: each control shows the green focus ring.
3. Russian strings do not clip in rows, tabs or the stepper.
4. `prefers-reduced-motion` stops the ping and the drift.
5. Idle CPU is unchanged: the ring layer is a static background or one `transform` animation.

## 6. Shell, brand, docs, wizard, tray

1. **Header and footer.** Replace the solid bars with `AppShell` markup. Pick ONE header variant (three islands or two). Add the footer with CPU (mini graph fed by the existing resource monitor in `gui/resmon`) and RAM; add two Settings toggles "Show CPU load in footer" and "Show RAM in footer" (persist them with the other settings; when RAM is off render an empty `<span></span>` in the centre column). Remove any stripe or gradient line at the header/footer joins.
2. **Wordmark and icons.** Use `pg-island pg-brand` (or the plate variant) with the inline `pg-mark` glyph; toggle `is-live` on `pg-wordmark__o` while a phone streams. App icon: choose from `assets/Brand` (`icon-slate`, `icon-paper`, `icon-orb`): 1024px PNG to `build/appicon.png`, `.ico` to `build/windows/icon.ico`. Tray icons: replace `gui/icons/tray_online.ico` and `tray_offline.ico`, add `tray_paused.ico` (files are in the download package).
3. **Docs.** Turn the Help tab into Docs (`nav.help` → "Docs" / "Документация"). Render `docs/guide.en.md` or `docs/guide.ru.md` for the current language into `pg-prose` (embed them with `go:embed` or ship them next to the exe); convert `> [!NOTE]`-style blocks into `pg-callout` and strip inline `style="color:…"`. Sidebar and "On this page" are generated from headings.
4. **Wizard.** Rebuild the six steps on the `ScreenSetup` layout, all strings from `pkg/i18n` (`setup.*`); images `assets/Wizard/step-N.webp` are the existing iOS screenshots.
5. **Tray.** Implement the popup window described in `Tray` (frameless second window) or, as a fallback, an owner-drawn menu with the same colours.
6. **Languages.** Every new string needs both `en.json` and `ru.json` keys (`nav.docs`, `footer.cpu`, `footer.show_ram`, `footer.show_cpu`, `tray.*`). Check both languages in both themes before finishing.

## 7. 3D scenes and loading screen

1. **Scenes.** Replace the WebGL scene setup in `gui/frontend/src/index.html` (scene, lights, floor, platform, ball, sheikah runes, cyan lights) with `PhoneGyro.createScene(host, {glb:'assets/models/gamepad.glb', model, step})`. Keep the existing sensor pipeline: feed orientation with `scene.setQuaternion([x,y,z,w])` (or `setTilt(x,z)` for the platform), calibration steps with `setStep('rest'|'pitch'|'roll'|'axes')`, capture progress with `setRecording(p)`, Resource Saving with `setPaused(true)`. Host elements get the `pg-stage` class. Delete the old cyan/gold/bronze materials and any point lights. three.js stays at r128; `GLTFLoader.js` is no longer needed for the gamepad (`PhoneGyro.loadGLB` reads the file), keep it only if other models need it.
2. **Splash.** Add the `Splash` markup as the first thing the main window renders, call `PhoneGyro.playSplash(root, {ready, onDone})` with a promise resolved when the Go backend is up, and make the window frameless/transparent until `onDone` (see the Splash README for the Wails settings and the fallback).

## 8. Shell overlay and optional title bar

1. **Header and footer float over the content.** Do not give `main` a flex row between header and footer. Structure: `.pg-app.pg-shell` (relative, window-sized) containing `.pg-shell__body` (absolute, full size, scrolls, with 56px top and 44px bottom padding), then `<header class="pg-header">` and `<footer class="pg-footer">`, which are absolutely positioned and pass pointer events through everywhere except the bubbles. The old `flex: column` layout that clipped content above the footer must go. Screens that want content edge to edge under the bubbles (telemetry viewports) set `padding: var(--pg-tb) 0 0` on `pg-shell__body` and pad their own scrolling columns.
2. **Footer order.** CPU and RAM islands are the left group (`pg-footer__group`), version and repository link on the right. A disabled island is not rendered.
3. **Optional title bar (`TitleBar`).** Only if you want custom window buttons: set `Frameless: true`, add the `pg-titlebar` element as the first child of `pg-shell` and the class `has-titlebar` on the shell. It pushes everything down by 32px and can be removed by deleting both. Wire minimise, maximise and close as described in the TitleBar README; close must go through the existing "action on window close" flow.
4. **Tray.** The popup shows CPU and RAM of the process (from `gui/resmon`) in two tiles, independent of the footer toggles.

## 9. Density and USB screen (v9)
1. **Tighter rhythm.** Button 36px (`lg` 46px), row min-height 44px with 8/16 padding, tab 32px, island 38px, hero card padding 24px, preview windows are 1280×720 (was 800). Prefer merging small cards into one card with divided rows over stacking many cards.
2. **Tabs and islands never wrap** (`white-space:nowrap; flex:none`).
3. **USB Controller** (`ScreenUsb`, `ScreenUsbRU`): two columns (`pg-usb`, 1040px). Left hero card: `pg-dev` header (chip tile + name + badges), level dial on rings floor (`pg-usbstage`), `Direct USB connection` badge + `pg-timer`, `pg-btn--info` Recenter. Right: DSU notice, Pause, Control Profiles card (`pg-profile`, toggle row, `pg-mono-note`, Calibrate).

## 10. Responsive layout and zoom (v10)
1. **The window is the container.** Every screen root is `.pg-app.pg-shell.pg-window` (`container: pgwin / size`); all breakpoints are `@container pgwin (...)`, never `@media`. Window width in CSS px: wide ≥ 860 (columns, panels scroll, `pg-fit` on the shell), compact < 860 (one column, body scrolls), sm < 560, xs < 400; short windows < 620 px high drop decorative panels.
2. **No pixel widths on cards.** Use `width:100%; max-width:N`, `minmax(0, …)` columns, and the helper classes `pg-page`, `pg-conn`, `pg-tel`, `pg-set`, `pg-usb`, `pg-wiz`, `pg-docs`. Wide mode scrolls the panel, compact mode scrolls the shell body.
3. **Header/footer degrade in steps:** status text (< 760), wordmark (< 660), tab labels (< 560, active label until then), brand (< 400); footer graphs (< 860), repo name (< 560), RAM (< 400).
4. **Zoom.** Load `bundle.js`, wrap the window in `#pg-root` by calling `PhoneGyro.mount(windowEl)`; see the `Zoom` card for keys, Wails options and pitfalls (no `vh`/`vw`).
5. See the `Responsive*` cards for every screen at 340, 400, 820, 1280 and 1920 px.

## 11. Level dial in 3D (v12)
1. The bubble level on the phone page and on the USB screen is `PhoneGyro.createLevel` (Three.js), not the CSS `pg-dial`. Keep the CSS dial only as the `pg-level3d__fb` fallback inside the wrapper. See the `Level3D` card.
2. Feed it the accelerometer in device axes; do not convert to pitch/roll first. It handles tilt, standing on edge and face down (plate flips, reverse side shown).
3. The app must ship `three.min.js` r128 locally (no CDN). One canvas per dial, it idles when nothing moves or the window is hidden.
