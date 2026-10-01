The brand is three pieces: the wordmark, a UI glyph, and the app/tray icons. The full-colour logo you supplied is kept for splash, installer and README use; the UI uses the vector glyph so it follows the theme.

**Wordmark.** `PhoneGyr` + a ring-shaped "o" (a dot in a ring: the texture motif and a gyro in one). Set in `display` 800.
- **A · pill (default):** `pg-island pg-brand` with the glyph on the left; the "o" is `accent-text`; add `is-live` to `pg-wordmark__o` while streaming and a small amber dot orbits inside it (stops under reduced motion).
- **B · engraved plate:** `pg-island pg-brand pg-brand--plate`: uppercase, tracked 0.16em, on an inset well like a nameplate.
Choose one for the release; do not ship both.

**Glyph.** `pg-mark` is an inline SVG (`class="o"` orbit and arrows in `accent`, `class="p"` phone in `ink`), 28px in the header, 24px in the tray popup, 16px minimum. Files: `assets/Brand/mark-light.svg`, `mark-dark.svg` (fixed colours for places that cannot use CSS). Drawn for this system; it is not a copy of the supplied logo.

**App icon.** Three sketches, all built from the palette and the ring texture: `icon-slate` (near-black, leaf phone, amber orbit), `icon-paper` (near-white, ink phone, green orbit) and `icon-orb` (concentric rings with an orbiting dot). 512px PNG and SVG are in `assets/Brand/`; the download package also has 1024px PNGs and multi-size `.ico` files (16 to 256). Wails: put the 1024px PNG at `build/appicon.png` and the `.ico` at `build/windows/icon.ico`.

**Tray icons.** Ring + dot, no detail below 16px: `tray-online` (leaf green), `tray-offline` (grey ring, coral dot), `tray-paused` (grey ring, amber dot). They read on both dark and light taskbars. `.ico` files (16/20/24/32/48) are in the package for `gui/icons/`.

**Your logo.** `assets/Brand/logo-mark.png` is the supplied artwork with stray specks removed (transparent, 512px). Its gold/blue colours are not part of the UI palette; keep it for large placements until it is redrawn as SVG. Note that the eye symbol inside it is a Zelda motif: fine for a personal build, worth a second thought before a wide public release.

**Rules**
- Clear space around the wordmark: one "o" width. Never stretch, outline or add shadows.
- The wordmark and glyph never sit on the ring texture without an island or plate behind them.
