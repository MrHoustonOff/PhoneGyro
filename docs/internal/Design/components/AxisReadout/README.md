The axis readout lists X, Y and Z values, each prefixed by a letter key tinted with the axis colour.

```html
<div class="pg-axis"><div class="pg-axis__row"><span class="pg-axis__key pg-axis__key--x">X</span>-0.04</div>…</div>
```

**Rules**
- Axis colours are fixed across the app: X = `danger` (coral), Y = `accent` (leaf), Z = `info` (teal): tokens `axis-x`, `axis-y`, `axis-z`. Charts, keys and the calibration tiles all use them.
- The letter is always printed, so the axes stay distinguishable without colour.
- Values are `mono` 12px with an explicit sign (`+0.01`, `-0.99`), fixed two decimals.
