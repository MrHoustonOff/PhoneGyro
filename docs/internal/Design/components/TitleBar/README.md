The custom title bar is OPTIONAL. It replaces the native Windows caption buttons with minimize, maximize/restore and close in the app's style. It is a thin 32px strip at the very top that pushes the whole window (header, body, footer) down by its height; remove it by dropping the `has-titlebar` class and the element, and the layout returns to normal.

```html
<div class="pg-app pg-shell has-titlebar">           <!-- has-titlebar sets --pg-tb: 32px, everything below shifts -->
  <div class="pg-titlebar">                           <!-- draggable -->
    <div class="pg-titlebar__title"><svg class="pg-mark">…</svg><span>PhoneGyro</span><span class="pg-titlebar__ver">2.0.0.116</span></div>
    <div class="pg-titlebar__ctl">                    <!-- not draggable -->
      <button class="pg-wc" aria-label="Minimize">…</button>
      <button class="pg-wc" aria-label="Maximize">…</button>
      <button class="pg-wc pg-wc--close" aria-label="Close">…</button>
    </div>
  </div>
  <div class="pg-shell__body">…</div>
  <header class="pg-header">…</header><footer class="pg-footer">…</footer>
</div>
```

**Look:** transparent bar over the ring texture (no solid band). Left: the glyph, "PhoneGyro" and the version in mono. Right: one pill island with three 34 × 20 buttons: minimize (line), maximize / restore (square / two squares) and close. Hover fills with `surface-hover`; close hover fills `danger` with `on-danger` text. An unfocused window dims the title and buttons to 55%. Icons are 12px strokes at 1.6, like the rest of the icon set.

**Wiring (Wails v2)**
1. Create the main window with `Frameless: true`. The bar's drag area uses `--wails-draggable: drag` (already in the CSS; `-webkit-app-region: drag` is set too) and the button group is `no-drag`.
2. Buttons call `runtime.WindowMinimise()`, `runtime.WindowToggleMaximise()` and either `runtime.Quit()` or the app's existing close flow (the "Action on Window Close: ask / tray" setting must still run: call your close handler, not `Quit` directly). Track maximized state with a window event and toggle the restore icon and the `is-maximized` state. Toggle `is-blur` on the bar from the window focus and blur events.
3. Double-click on the title area toggles maximize. Keep the native resize border (Wails frameless windows still resize from the edges).
4. Not available with a custom bar: the Windows 11 snap-layout flyout on the maximize button. If that matters, keep the native caption and skip this component.
5. Turn it on or off from one place (a build flag or a setting) by adding or removing `has-titlebar`; nothing else in the layout depends on it. `--pg-tb` is the only variable that changes: the header top offset and the body top padding both read it.

**Rules**
- Never make the strip solid or add a bottom border; it must look like part of the window texture.
- Keep the buttons 34px wide for easy targets; the pill is 26px high so the bar stays thin.
