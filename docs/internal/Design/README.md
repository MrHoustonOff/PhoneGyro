PhoneGyro is a desktop and phone-web control surface that feels like a precise instrument: near-white or near-black neutral surfaces, a fine ring texture from Hyrule, and a small set of muted palette accents. Build every screen from the tokens and `pg-` classes in this system; do not invent colours, sizes or components.

## Content fundamentals

- Tone: calm, exact, second person ("Place your phone still on the desk"). Say what happens, then what to do. No exclamation marks except the bench warning that already has one.
- Casing: Sentence case for buttons, labels and titles ("Start Recording" is the one legacy exception, keep as is). `overline` section headers are uppercase via CSS only. Status words are lowercase mono (`online`, `offline`).
- Two languages, RU and EN, always translated in full. Text expands about 20% in Russian: never fix a label width, let rows wrap.
- Numbers and units: value in mono, unit in `mono-sm` `ink-3`, explicit sign for axes (`+0.01`, `-0.99`), decimals fixed per metric (`56.8 Hz`, `6.6 ms`).
- No emoji, no exclamation decoration, no marketing copy. Real strings from the app: "Scan with phone camera to connect", "Waiting for emulators", "No clients or emulators listening for motion", "Instantly resets virtual orientation to neutral baseline".

## Visual foundations

**Colour.** Two themes, `light` (first, default) and `dark`, set with `<html data-theme="light|dark">`. Surfaces are pure neutral greys (R=G=B) as close to white and black as depth allows: `bg` `#f1f1f1` / `#0b0b0b`, `surface` `#ffffff` / `#151515`. Never tint a surface warm, cool or green; hue comes only from accents. Text: `ink`, `ink-2`, `ink-3` on `bg`, `surface`, `surface-inset`. Every text token holds at least 4.5:1 on the grounds named in its note in both themes.

- `accent` (leaf green) is the single brand hue: toggle-on, slider fill, active tab and step, focus ring, online. Use `accent-text` for green text, `accent-soft` + `accent-line` for tinted panels.
- `info` (teal-slate), `warn` (amber), `danger` (coral) are verdict hues for states only, each with `-text`, `-soft`, `-line` (danger also `on-danger`). Every state also has a word or an icon; colour never works alone.
- `axis-x` = `danger`, `axis-y` = `accent`, `axis-z` = `info`: always paired with the letter X, Y, Z.
- `viz-*` is the eight-colour reference palette (leaf, moss, teal, slate, dusk, coral, amber, cream). Use it only for illustration: cube faces, chart series, cover blocks. Never as a text ground or a button fill.
- The primary button is a solid `ink` slab with `on-ink` text. Do not fill buttons with `accent`.

**Type.** Three families. `display` (Alegreya Sans 700/800) for the wordmark, screen and card titles: styles `display-xl` … `display-sm`. `sans` (Onest 400–700) for everything else: `body`, `body-sm`, `label`, `label-sm`, `overline`. `mono` (JetBrains Mono 400/600) for numbers, URLs, ports, statuses: `mono-xl`, `mono`, `mono-sm`. All three ship Latin and Cyrillic as woff2 in `fonts/`. Load them from files (the desktop app must work offline); never from a CDN.

**Space and shape.** Spacing scale `space-1…10` (4–40px). Radii: `radius-sm` 6 (segments, kbd), `radius-md` 10 (buttons, inputs), `radius-lg` 14 (cards, banners), `radius-xl` 22 (hero card, modal), `radius-pill` (capsules, toggle, chips). Card padding 16 (`space-4`), row padding `12px 20px`, min row height 52.

**Depth.** Cards float on `shadow-card` with a 1px `line` border; modals use `shadow-pop`; inputs and tracks are engraved with `shadow-inset`; pressed keys have a 1px hard lip (`shadow-key`). Borders are hairlines, `line` for edges, `line-subtle` for inner dividers, `line-control` for control outlines (3:1). No coloured left borders, no gradients except the tint layer under notices and callouts. Never a coloured stripe or rainbow line where two areas meet.

**Texture.** The identity. The window (`pg-app`) carries the ring-and-wave tile (`--tex-rings`, 600px), cards carry faint grain (`--tex-grain`), the viewport floor and the hero corner draw rings as geometry, section headers start with the `pg-ring` mark, the status dot is a dot inside a thin ring, the wordmark's "o" is a dot in a ring. Rings never sit behind text on cards and never exceed the tile's contrast. Read `Textures`.

**3D scene.** Three.js scenes (calibration, models, platform) sit in a `pg-stage` well and follow the theme: a floor of accent rings, the gamepad painted per part from the `viz-*` palette (A leaf, B coral, X teal, Y amber), axis triad in `axis-*` colours, guide arcs with an orbiting amber dot for each calibration step. No navy vignette, cyan grid or gold/bronze materials. See `GyroScene`.

**Loading screen.** A small window appears, eight rings unroll around the mark, the name writes itself, the ring "o" starts orbiting, then the window grows into the app while the rings dissolve into the window texture (about 3.6s, played once per launch). See `Splash`.

**Motion.** Small and functional: 150ms colour/fill changes, 100ms press, the online dot pings every 2.2s, the ring tile may drift over 120s on idle screens (`pg-drift`). Everything stops under `prefers-reduced-motion`. No bounces, no page transitions.

**States.** Hover: fill moves one step (`surface` → `surface-hover`, `ink` → `ink-hover`). Press: 1px down, lip removed. Focus: solid 2px `accent` outline, 2px offset, never removed (3:1 on every surface). Disabled: 45% opacity, no lip. Selected: `accent-soft` fill + `accent-line` border + `accent-text` (tabs, steps); segmented selection is the raised `surface` thumb.

**Phone page.** Same tokens on a 390px column: floating pill bars (`pg-mbar`, `pg-mfoot`), 44px minimum touch targets, one big action (`pg-pause`) above a two-button row. The Touch Shield screen is a single `pg-lockbtn` in the centre: press and hold 4 seconds while a `accent` ring fills; the ring texture drifts faster (`pg-drift pg-drift--fast`, 36s) and three sonar rings expand from the lock (`pg-sonar`) to show the screen is alive. Unlocking opens the shackle and turns the ring and icon `accent`.

**Shell.** No solid bars. The header (56px) and footer (44px) are rows of floating islands (`pg-island`, pill bubbles with grain and shadow) on the ring window, so the texture shows between them. Header: brand, tabs, controls (two variants in `AppShell`, choose one). Footer: CPU with mini graph, RAM (optional, a setting) and the repository link.

**Brand.** Wordmark `PhoneGyr` + ring "o" in `display` 800, next to the `pg-mark` glyph (phone in an orbit). Two wordmark variants (pill or engraved plate) and three app-icon sketches live in `Brand`; the tray popup is `Tray`.

**Documents.** Long text (the user guide, wizard explanations) is rendered with `pg-prose` in a card; "Help" is now "Docs" (`ScreenDocs`). RU and EN are both designed and previewed (`ScreenSetupRU`, `ScreenDocsRU`, `Tray`).

**Layout.** Desktop window is a flex column: header, body, footer. Body content is centred with 24px gutters. Connect screen: one 600px hero card. USB Controller: two columns 1040px. Stats & 3D: 40/60 split. All screens are responsive by window width (wide / compact / sm / xs, see `ResponsiveDocs` and MIGRATION section 10) and the interface zooms 50 to 300% (see `Zoom`). Settings: 600px + 460px columns with a 24px gap. Telemetry: 400px sidebar and a 2×2 viewport grid. The window body scrolls, never the page; native scrollbars are replaced by the thin `pg-app` scrollbar.

## Iconography

Inline SVG, 24px viewBox, stroke `currentColor`, width 1.8, round caps and joins, no fill, drawn at 16px in buttons and tabs and 18px in icon buttons (Feather-style set: gear, bar chart, help circle, phone, gamepad, moon, link, x, arrows, refresh, expand, info). Play triangles are the one filled glyph. No emoji, no icon fonts, no multi-colour icons. The brand mark is the `pg-ring` (concentric dot and ring in `accent`) before the wordmark.

## Using the system

Load `tokens.css`, then `components/bundle.css`; add `class="pg-app"` to the window root. `components/bundle.js` (`window.PhoneGyro`) offers `setTheme`, `spark`, `segmented` and `slider` helpers and is optional. Class names and markup for every component are in its README; screen mockups are `ScreenConnect`, `ScreenTelemetry`, `ScreenSettings`, `ScreenSetup` / `ScreenSetupRU` (wizard), `ScreenDocs` / `ScreenDocsRU` (desktop) and `ScreenMobile`, `ScreenMobileLock` (phone). Font licenses: `Font licenses`. For porting the existing app read `Migrating the PhoneGyro app`.
