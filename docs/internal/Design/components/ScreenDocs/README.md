Docs replace the small "Help & Guide" modal. The header tab "Help" becomes "Docs" ("Документация"), and the page shows the whole user guide inside the app in the current language; both `guide.en.md` and `guide.ru.md` are rendered with `pg-prose`.

**Layout:** three columns under the header, all on the ring window. Left: a `pg-card` with the search field and the guide's sections (`pg-docnav`): numbered items, groups as small overlines, the active item is accent-tinted, "Source code · GitHub" pinned at the bottom. Centre: one `pg-card` holding the article (`pg-prose`, max 720px, scrolls inside). Right: "On this page" (`pg-toc`), the current heading has an `accent` rule.

**What became of the old modal**
- Initial Setup [Start] → a `pg-btn` inside the article ("Open the setup wizard") and the wizard stays reachable from the connect screen.
- Axis Calibration → docs section 3, plus a link in the calibration modal.
- Source code → the pinned nav item.

**Rules**
- Section list, headings and TOC are generated from the markdown headings; do not maintain them by hand. Language switches re-render the article without changing the scroll section.
- `>` [!NOTE]/[!TIP]/[!IMPORTANT] blocks become `pg-callout` (see Prose). Inline colours from the markdown are dropped.
- Search filters the nav and highlights matches in the article with `accent-soft`; empty state is a `pg-notice`.
- Narrow windows (under 1000px): hide the "On this page" column first, then collapse the nav into a `pg-select`.
