`pg-prose` styles rendered markdown (the user guide, wizard explanations, release notes) so long text matches the rest of the app. Wrap the rendered HTML in `<div class="pg-prose">`, usually inside a `pg-card`.

**Element map**
- `#` → `display` 800, 34px. `##` → 24px with a ring bullet in `accent`. `###` → 18px `display` 700.
- Body 15/25px `ink`; max width 720px. Links `accent-text`, underlined. Ordered/unordered markers `accent-text`.
- `` `code` `` → `pg-code`; `<kbd>` → key cap (`shadow-key`). Images: `radius-lg`, 1px `line`, `shadow-card`.
- `---` → a hairline with a ring in the middle. Tables: inset header row, `line-subtle` row dividers.
- GitHub alerts → callouts: `> [!NOTE]` = `pg-callout` (info), `[!TIP]` = `--tip`, `[!IMPORTANT]` and `[!WARNING]` = `--warn`, `[!CAUTION]` = `--danger`. Put a `pg-callout__title` first (localised: Note / Заметка, Tip / Совет, Important / Важно).

**Rules**
- Strip inline colour styles from the guide (`<span style="color:…">`); emphasise with `strong`, `kbd` or `code`, never with raw hex.
- Emoji in guide text (status dots) are replaced by `pg-badge` variants in the app; keep the words.
- The docs and the wizard use the same classes, so the RU and EN texts flow through one renderer.
