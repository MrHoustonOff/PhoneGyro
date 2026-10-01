Interface zoom, 50% to 300%, default 100%. It is the app's own scale, not the browser's.

- Keys: `Ctrl +` / `Ctrl −` step through 50 60 70 80 90 100 110 125 150 175 200 250 300; `Ctrl 0` resets; `Ctrl + wheel` (and touchpad pinch, which arrives as a ctrl-wheel) changes by 10%. A mono toast with the value and a Reset button appears bottom centre for 1.6 s. The scale is also a slider in Settings (Behavior group, "Interface scale").
- Implementation: `PhoneGyro.mount(windowEl)` puts the window into `#pg-root` and starts `PhoneGyro.zoom`. Zoom writes `--pg-zoom` on `<html>`; `#pg-root` is `position:fixed`, `width/height: calc(100vw / var(--pg-zoom))`, `zoom: var(--pg-zoom)`. Because the root is divided by the zoom, the window keeps filling the screen, and every container query in the app sees the *zoomed* width: 300% on a 1280 px window is a 427 px window and switches to the compact layout by itself.
- Persistence: `localStorage['pg-zoom']`. In Wails also mirror it to `settings.json` through `PhoneGyro.zoom.onChange(fn)` so the value survives a WebView cache wipe.
- Wails: set `options.Windows.IsZoomControlEnabled = false` (and `ZoomFactor: 1.0`) so WebView2's own Ctrl+wheel zoom does not fight this one. Keep `DisableWebViewDrop` as it is.
- Do not use `100vh` or `100vw` inside the app; use `height:100%` inside `#pg-root`. Fixed elements must also be inside `#pg-root` (the toast is created outside on purpose and divides its offsets by `--pg-zoom`).
- API: `PhoneGyro.zoom.init() / set(v) / get() / step(±1) / reset() / onChange(fn)`, limits `MIN = 0.5`, `MAX = 3`.
