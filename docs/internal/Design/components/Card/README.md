A card is the one container: `surface` with the paper-fine grain, a 1px `line` border, `radius-lg`, `shadow-card`.

```html
<section class="pg-card">
  <div class="pg-card__title">Recenter</div>
  <div class="pg-card__desc">Instantly resets virtual orientation</div>
</section>
```

**Variants:** `--hero` (`radius-xl`, 32px padding, `overflow:hidden`) for the single focal card on a screen; `--flush` (no padding) for lists; add `pg-rings-corner` to a hero card for the quarter-circle of rings in `accent-soft`.

**Rules**
- Texture lives on the window (`pg-app`: rings) and, faintly, on cards (`--tex-grain`). Do not put rings behind text inside a card.
- Cards never nest cards. Inside a card use dividers (`line-subtle`) or wells (`surface-inset`).
- Card titles use `display-sm` (Alegreya Sans 700); descriptions `body-sm` in `ink-2`.
- No coloured left borders and no gradients.
