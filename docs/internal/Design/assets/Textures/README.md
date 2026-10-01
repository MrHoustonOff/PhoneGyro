Tileable neutral textures for the window and for cards. Load them through the `--tex-rings` and `--tex-grain` variables defined in `components/bundle.css` (they already switch with `data-theme`); use the SVG files directly only when a page cannot load bundle.css.

- `rings-light.svg`, `rings-dark.svg`: 1000×1000 viewBox seamless tile of nested circles and wavy lines from `tools/zelda-rings.js`. Two inks each: ground `#f1f1f1` with lines `#e7e7e7` (light); ground `#0b0b0b` with lines `#191919` (dark). Show at `background-size: 600px 600px`. The ground colour equals `bg`, so the tile replaces the window background colour.
- `grain-light.svg`, `grain-dark.svg`: the first-generation grain (200×200 feTurbulence). Kept for reference only: `bundle.css` now embeds a 128px pre-rendered PNG tile of the same look (`--tex-grain`), which is faster and renders evenly. Use `var(--tex-grain)`, not these files.

Regenerate the rings with `node tools/build-textures.js` (same seed 7 keeps the pattern). SVG pictures show only through `<img>` or CSS `background-image`.
