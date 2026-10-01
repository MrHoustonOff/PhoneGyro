A modal is a raised sheet over a scrim for multi-step flows such as axis calibration; it has a title, an optional stepper, a body and a footer with Back / Manual / Next.

```html
<div class="pg-overlay"><div class="pg-modal">
  <div class="pg-modal__head"><div><div class="pg-modal__title">Axis Calibration</div><div class="pg-modal__sub">Axis mapping configuration · iPhone</div></div><button class="pg-btn-icon">×</button></div>
  <div class="pg-modal__body">…<div class="pg-stepper">…</div>…</div>
  <div class="pg-modal__foot" style="margin-top:8px">…</div>
</div></div>
```

**Rules**
- Sheet is `surface-raised` + grain, `radius-xl`, `shadow-pop`; scrim `overlay`. Max width 820px; body is two columns at ≥760px (instructions left, 3D stage right).
- Stepper: `pg-step` pills joined by `pg-step__link`. States: `is-active` (accent tint, filled number), `is-done` (soft number), default. Number is `mono`.
- Footer: Back = secondary, "Manual Setup" = `pg-link`, Next = primary, `disabled` until the step's capture succeeds.
- Capture panel: an `ok` notice with a status badge and ONE `pg-btn--primary pg-btn--lg pg-btn--block` action.
- Trap focus, close on Esc, focus returns to the trigger. The close button is `pg-btn-icon`.

**Replaces:** `cal-screen` modal → `pg-modal`; `cal-step-pill` / `step-num` / `cal-step-connector` → `pg-step` / `pg-step__num` / `pg-step__link`; `btn-sound-detail-play` etc. keep their layout with the same tokens.
