The dial shows how level the phone is: a fixed target with tick marks and a bubble that moves with tilt.

```html
<div class="pg-dial" style="--bx:10px;--by:6px">
  <svg viewBox="0 0 264 264">…guides, ticks, level arrow…</svg>
  <div class="pg-dial__well"></div><div class="pg-dial__bubble"></div>
</div>
<span class="pg-dial__label">LEVEL</span>
```

**Rules**
- 264px disc, `surface` + grain, `shadow-card`. Drawing colours: ticks `ink-3` (major `ink`), guide rings `line`, dashed ring `line-control` at 50%, crosshair `line-subtle`. The rings are the same motif as the texture.
- The level arrow at 12 o'clock is `accent` and never moves.
- Move the bubble by setting `--bx` / `--by` (px offsets from centre, clamp to ±58px). The bubble is `ink`; when tilt is under 1° add `is-level` so it turns `accent`.
- Label under the dial: `LEVEL` when level, otherwise the axis and angle in mono. Letter-spaced pill, `ink-2`.
- Update at the sensor rate but let the 120ms CSS transition smooth it. Do not add shadows or glow that move with the bubble.
