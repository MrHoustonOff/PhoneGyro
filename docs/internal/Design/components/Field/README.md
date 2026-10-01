Fields are engraved wells: `surface-inset` fill with `shadow-inset` and a `line-control` border, so they read as "type here" in both themes.

```html
<input class="pg-input pg-input--num" value="8443">
<select class="pg-select"><option>Ask every time</option></select>
<input class="pg-slider" type="range" min="0.2" max="3" step="0.05" value="1"><span class="pg-value">1,00x</span>
```

**Rules**
- Height 36px, `radius-md`. Numbers, ports, MACs and versions use the mono variants (`--num` right-aligned, 104px wide).
- Focus: 2px `accent` outline with 1px offset and an `accent` border. Do not remove it.
- Slider: call `PhoneGyro.slider(input)` (or set `--fill` yourself) so the accent fill follows the thumb. The live number sits in `pg-value`.
- Validation errors: swap the border to `danger` and add a `pg-notice--danger` below; never rely on red alone.

**Replaces:** `setting-input-num` → `pg-input pg-input--num`, `setting-select` → `pg-select`, `setting-slider` → `pg-slider`.
