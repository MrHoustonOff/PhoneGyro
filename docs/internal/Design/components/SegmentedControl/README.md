A segmented control switches between two to four mutually exclusive views or modes with the choice always visible.

```html
<div class="pg-seg"><button class="pg-seg__btn is-active">Cube</button><button class="pg-seg__btn">Gamepad</button></div>
```

**Rules**
- Track is `surface-inset` with `shadow-inset` (engraved); the active segment is `surface` with `shadow-key` and `ink` text; inactive text is `ink-2`.
- Mark the current segment with `is-active` (or `aria-pressed="true"`). `PhoneGyro.segmented(el)` toggles it.
- Use for language (RU / EN), device type (Smartphone / USB Controller), model (Gamepad / Cube), camera layout, Aim / Platform, chart axis (Pitch / Yaw / Roll / All). More than four options: use `pg-select`.
- Labels are one or two words; an optional 14px icon precedes the label.

**Replaces:** `segmented-control` / `segmented-btn.active` / `settings-seg-btn` → `pg-seg` / `pg-seg__btn.is-active`.
