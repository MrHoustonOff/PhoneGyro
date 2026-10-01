The tray popup replaces the plain Windows menu with a small themed panel that slides up from the tray: a hero with brand and link state, three status rows, and the actions.

```html
<div class="pg-tray">
  <div class="pg-tray__hero" style="--nb:var(--accent-soft)">           <!-- tint only when online -->
    <div class="pg-tray__head"><span class="pg-brand">…</span><span class="pg-status pg-status--online">online</span></div>
    <div class="pg-tray__state"><div><div class="pg-tray__title">Connected</div><div class="pg-tray__sub">62 Hz · 6.6 ms · LAN</div></div>…mini graph…</div>
  </div>
  <div class="pg-tray__list">
    <div class="pg-tray__row"><span class="pg-tray__ico">…</span><div class="pg-tray__txt"><div class="pg-tray__label">Phone</div><div class="pg-tray__value">iPhone</div></div><span class="pg-status__dot"></span></div>
    …Emulators… <div class="pg-tray__row is-link">…Profile… <span class="pg-tray__chev"></span></div>
  </div>
  <div class="pg-tray__actions">
    <button class="pg-btn pg-btn--primary pg-btn--block">Open PhoneGyro →</button>
    <div class="pg-tray__pair"><button class="pg-btn pg-btn--block">Recenter <span class="pg-kbd">Ctrl+Shift+R</span></button><button class="pg-btn-icon" aria-label="Quit">…</button></div>
  </div>
  <div class="pg-tray__foot">v2.0.0.116 · DSU :26760</div>
</div>
```

**What changed from the first sketch**
- A hero that says the state in words ("Waiting for your phone" / "Connected", with rate and latency and a live mini graph when online), tinted green only when linked, with the ring motif in its corner.
- Resource use is always shown: CPU of the PhoneGyro process with a mini graph and RAM (working set and share of total) with a bar, in two engraved tiles under the status list (independent of the footer toggles).
- The three status lines sit in one engraved list; Profile is a link row (chevron) that opens a profile switcher.
- Real actions: a primary "Open PhoneGyro", "Recenter" showing the existing global hotkey (disabled while no phone is connected), and Quit as an icon button.
- Entrance: slides up 12px and fades in, 200ms; no exit animation (hide on blur).

**How to build it (Windows tray menus cannot be styled with CSS)**
1. **Recommended: a popup window.** On tray click, show a second frameless, always-on-top, non-resizable Wails window (about 336 × 470, `SkipTaskbar`) positioned above the icon (use the tray icon rectangle, clamp to the work area, 8px margin) that loads this markup with `bundle.css`; hide it on blur or Esc. Keep the existing Win32 icon and message loop; only replace `TrackPopupMenu`. Push state (link, emulators, profile, rate, language) into it through the events the main window already receives. Keep the plain menu as the right-click fallback.
2. **Fallback: owner-drawn native menu** (`MF_OWNERDRAW`, `WM_MEASUREITEM`, `WM_DRAWITEM`) with the token colours: `surface-raised` (`#1a1a1a` / `#ffffff`), hover `surface-hover`, 40px rows. No grain, rings or mini graph.

**Rules**
- Follows the app theme and language. Status rows are informational; Profile, Open, Recenter and Quit are the only targets.
- Dot colours: Phone `accent` linked / `danger` offline; Emulators `accent` connected / `warn` none. Words always accompany colour.
- Recenter uses the user's configured hotkey text; hide the kbd hint if none is set. Tray icon states are in `Brand`.
