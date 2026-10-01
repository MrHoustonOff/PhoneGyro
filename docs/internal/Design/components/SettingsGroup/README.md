A settings group is an overline title over one bordered list of rows; every row is label on the left, one control on the right.

```html
<div class="pg-group">
  <div class="pg-overline"><span class="pg-ring"></span>Network &amp; server ports</div>
  <div class="pg-group__list">
    <div class="pg-row">
      <div class="pg-row__label">DSU Port<button class="pg-info" aria-label="Info">i</button></div>
      <div class="pg-row__control"><input class="pg-input pg-input--num" value="26760"></div>
    </div>
  </div>
</div>
```

**Rules**
- Row min-height 52px, padding `12px 20px`, divider `line-subtle`; the last row has none.
- `is-modified` adds a 5px `accent` dot at the left edge for values changed from default.
- `pg-row__sub` (12px, `ink-2`) can sit under the label for a one-line hint; longer text goes in the info tip.
- Control order: `pg-input--num` (mono, right-aligned), `pg-select`, `pg-slider` + `pg-value`, `pg-toggle`, or a `pg-btn-icon`. One control per row.
- The overline is uppercase (`overline` style) and starts with the `pg-ring` motif.

**Replaces:** `settings-section-header` → `pg-overline`, `settings-grouped-card` → `pg-group__list`, `setting-row` → `pg-row`, `setting-label-row` → `pg-row__label`, `setting-info` → `pg-info`, `setting-control` → `pg-row__control`, `setting-value-badge` → `pg-value`.
