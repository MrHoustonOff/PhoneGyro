The loading screen is a short (about 3.6 s) sequence: a small window appears, rings unroll around the mark, the name writes itself letter by letter, the "o" draws as a ring and starts orbiting, a progress line fills, then the window grows into the app and its header and footer islands slide into place while the rings dissolve into the window texture.

```html
<div class="pg-splash" id="sp">
  <div class="pg-splash__win">
    <div class="pg-splash__tex"></div>
    <svg class="pg-splash__rings" viewBox="-300 -300 600 600"><circle r="46" style="--i:0;--c:289px;--o:.55"/>…8 rings…</svg>
    <div class="pg-splash__center">…mark, word (letters in spans with --k), status…</div>
    <div class="pg-splash__app">…the real header, main, footer of the first screen…</div>
  </div>
</div>
```
```js
PhoneGyro.playSplash(document.getElementById('sp'), { ready: backendReadyPromise, status: [...], onDone });
```

**Timeline** (seconds from start)
| t | what |
| --- | --- |
| 0.0 to 0.5 | window fades and scales in (460 × 320, `radius-xl`, grain, `shadow-pop`) |
| 0.15 to 1.7 | eight rings unroll: each spins from a hairline arc to a full circle, 90ms apart, `accent` at 55% fading outward |
| 0.3 | mark scales and spins in |
| 0.85 to 1.3 | `PhoneGyr` letters rise out of blur, 55ms apart |
| 1.3 to 2.1 | the ring "o" is drawn by a conic sweep, then the amber dot starts orbiting |
| 1.0 to 2.1 | progress line fills; status text steps: Starting… / Loading profiles / Starting DSU server / Ready |
| 2.25 or when ready (later) | window grows to full size (0.85s ease), centre content fades, rings scale up and fade, the ring texture fades in |
| 2.7 | header islands drop in, footer islands rise, first card pops up (60 to 340ms stagger) |
| 3.6 | `onDone`: handed over to the app |

**Building it in Wails**
- Create the main window at its normal size with `Frameless` and a transparent webview background while the splash runs (`WindowIsTranslucent`/`BackgroundColour` alpha 0 and `WebviewIsTransparent`); the card is drawn in the middle of the transparent window and the growth happens in CSS, so no native window resize is needed. When `onDone` fires, switch to the normal window chrome (or keep the custom frame). If transparency is unavailable, fall back to a solid `bg` window: skip the growth and only do the last two rows.
- `ready` is the backend-started promise (server up, settings loaded); the splash never grows before 2.25s, and never waits more than about 6s (then shows an error notice).
- Localise the four status strings (`splash.starting`, `splash.profiles`, `splash.server`, `splash.ready`) in `en.json` and `ru.json`.
- The desk background in the preview only simulates the user's desktop; do not ship `pg-splash__desk`.

**Rules**
- Only transforms, opacity and stroke offsets are animated, so it stays smooth on integrated GPUs. Under `prefers-reduced-motion` the screen shows the final state at once.
- Play it once per launch. Do not replay when the window is restored from the tray.
- The final frame is the real first screen: keep the same markup so nothing jumps at the hand-over.
