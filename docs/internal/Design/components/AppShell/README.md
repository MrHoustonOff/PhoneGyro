The app shell is a floating header, the textured window body and a floating footer. Header and footer have no bar of their own: they are rows of small "islands" (pills) laid OVER the scrolling content. The body fills the whole window and scrolls underneath them, so content is visible in the gaps between the bubbles and is only covered where a bubble actually sits. At rest the body keeps 56px / 44px of padding so the first and last rows are never hidden.

```html
<div class="pg-app pg-shell" style="height:100vh">           <!-- add "has-titlebar" for the optional custom title bar -->
  <div class="pg-shell__body">…screen content, scrolls under the bubbles…</div>
  <header class="pg-header">                       <!-- variant 1: three islands -->
    <div class="pg-island pg-brand">…mark + wordmark…</div>
    <nav class="pg-island"><button class="pg-tab is-active">…</button>…</nav>
    <div class="pg-island">…theme, RU/EN, status…</div>
  </header>
  <footer class="pg-footer">
    <div class="pg-footer__group">
      <div class="pg-island pg-island--sm">CPU + mini graph</div>
      <div class="pg-island pg-island--sm">RAM</div>   <!-- optional: just omit it when the setting is off -->
    </div>
    <a class="pg-island pg-island--sm">version + repo link</a>
  </footer>
</div>
```

**Two header variants (pick one at the end, do not mix)**
1. `pg-header`: three islands: brand (left), navigation tabs (centre), controls (right). Most air, brand is a bubble of its own.
2. `pg-header pg-header--two`: two islands: brand + tabs together (left), controls (right). Calmer, fewer shapes.
Both are 56px tall (40px islands, 8px padding). Tabs inside an island are flat (`pg-tab`), the active one is an accent-tinted pill.

**Footer**
- Left group: CPU load with a 44×16 mini area graph (`pg-mini`, `accent` line) and the percentage in `mono`, then RAM with `pg-meter` (34px bar in `info`) right next to it. RAM and CPU are user settings ("Show RAM in footer", "Show CPU load in footer" are toggle rows in Settings); a hidden island is simply not rendered and the rest slides left. Right: version, `DEV` badge (only in dev builds), a hairline separator, GitHub mark and `MrHoustonOff/PhoneGyro` as a link (`a.pg-island`).
- Islands are 32px high, text `mono` 12px, labels `ink-3`, values `ink` 600.

**Rules**
- Never add a solid bar behind islands, and never a coloured stripe or gradient line at a join.
- Islands use the same recipe as cards: `surface` + grain, `line` border, `shadow-card`, `radius-pill`.
- The window body scrolls inside `main`; islands stay fixed. Keep 16px side padding.
- Optional idle motion: `pg-drift` on the `pg-app` root (not on `main`, or the tile will seam under the header). Off on the telemetry screen.

**Replaces:** `app-header` / `header-left` / `header-controls` → `pg-header` + `pg-island`s; footer bar → `pg-footer`.
