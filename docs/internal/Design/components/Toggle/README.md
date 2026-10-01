A toggle switches one setting on or off immediately, with no confirm step.

```html
<label class="pg-toggle"><input type="checkbox" checked aria-label="Resource Saving"><span class="pg-toggle__track"></span></label>
```

**Rules**
- On: track `accent`, knob `on-accent`. Off: track `surface-inset` bordered with `line-control`, knob `ink-3`.
- The native checkbox stays in the DOM (opacity 0, full size) so keyboard and screen readers work; always give it `aria-label` or wrap it in a labelled row.
- Sits at the right end of a `pg-row__control`. Never place a toggle next to a "Save" button; changes apply instantly.

**Replaces:** `apple-toggle` + `apple-toggle-slider` → `pg-toggle` + `pg-toggle__track`. The old green was `#28A745`; the new on-state is the leaf `accent`.
