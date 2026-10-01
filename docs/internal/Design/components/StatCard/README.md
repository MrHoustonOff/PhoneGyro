A stat card shows one live metric: name and verdict badge on top, the number in `mono-xl`, a sparkline well below.

```html
<div class="pg-stat">
  <div class="pg-stat__head">Latency (ms)<span class="pg-badge pg-badge--ok">&lt; 20ms</span></div>
  <div class="pg-stat__value">6.6<span class="pg-stat__unit">ms</span></div>
  <div class="pg-spark"><svg viewBox="0 0 200 56" preserveAspectRatio="none"><path d="M0 40 …" style="stroke:var(--info)"/></svg></div>
</div>
```
`PhoneGyro.spark(el, values, '--info')` builds the path from an array.

**Rules**
- Number is `mono-xl` (JetBrains Mono 600, tabular), unit `mono-sm` in `ink-3`. Only the value updates each frame; do not animate layout.
- Line colours: frequency `accent`, latency `info`, jitter `warn`, loss `danger`. One stroke, 1.6px, no fill under the line.
- The well is `surface-inset` with `shadow-inset`; it holds the only decoration. The card padding is 12px (denser than `pg-card`).
- Verdict badge follows `Badge` rules; if a value has no verdict, omit the badge.
- Cards are clickable to reveal a description in the app: use `cursor:pointer` and a `pg-notice` in-place, not a tooltip.
