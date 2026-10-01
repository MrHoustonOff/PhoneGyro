The bubble level (LEVEL) rendered with Three.js instead of CSS. Same object as the CSS `Dial`: a plate with three guide rings, a cross, ticks, a green arrow at 12 o'clock, a recessed well and a bubble, but it is driven by the real gravity vector, so it stays correct at any orientation. The CSS dial cannot: it only knows two small tilt offsets and breaks when the phone is turned over or stood on its edge.

Style (Sheikah-slate, matching the rings of the app): stone bezel with a thin glowing accent line, engraved band with 72 dashes and a diamond every 30 degrees, concentric ripples fading outward, four focus-reticle brackets around the well, chevrons pointing in. The bubble's colour says the state: leaf green level (halo, glowing bezel line and one ripple pulse when it locks), teal tilted, amber steep, grey face down. Colours come from `--accent`, `--info`, `--warn`; the renderer uses sRGB output so they match the CSS exactly.

Behaviour:

- Input is the accelerometer reading in device axes (x right, y up the screen, z out of the screen; a phone lying face up reads 0, 0, 1): `level.setAccel(ax, ay, az)`, or a device quaternion: `level.setQuaternion({x,y,z,w})`. No Euler angles, so no gimbal jumps.
- The bubble sits on a shallow glass dome and moves toward the uphill side; full travel at 20 degrees. Level (within 1.5 degrees) turns it leaf green and lights the arrow.
- The plate leans toward the uphill side (up to about 25 degrees), a cheap depth cue that makes the flat dial read as an object.
- Face down (z below -0.2, hysteresis up to +0.2): the plate flips over with a 0.4 s spring and shows its reverse side. Standing on an edge is the `STEEP` state, the bubble rests at the rim.
- States are exposed as `el.dataset.state` (`level`, `tilt`, `steep`, `down`) and a `pglevel` event with `{state, tilt}`; the label pill under the dial (`pg-dial__label`) follows automatically, with `data-labels` for RU.
- Cost: one small transparent canvas (about 252 px), rendering only while something moves. It pauses when scrolled out of view or when the window is hidden or minimised. Antialiasing on, pixel ratio capped at 2.
- Theming: colours are read from tokens at creation and again when `data-theme` changes; nothing is hard-coded.

Markup (declarative, auto-mounted by `bundle.js`):

```html
<div class="pg-level3d" data-ax="0.09" data-ay="0.05" data-az="0.99" data-labels='{"level":"РОВНО","tilt":"НАКЛОН","steep":"КРУТО","down":"ЭКРАНОМ ВНИЗ"}'>
  <div class="pg-dial pg-level3d__fb">…CSS dial…</div>   <!-- shown only if WebGL or Three is missing -->
</div>
<span class="pg-dial__label">LEVEL</span>
```

Code: `const lv = PhoneGyro.createLevel(el, {labels}); lv.setAccel(ax, ay, az); lv.dispose();`. `THREE` (r128) must be global; in the app bundle it locally, the previews lazy-load it from cdnjs. Feed it from the phone's `devicemotion` (`accelerationIncludingGravity`, negate on iOS) or from the DSU accelerometer sample on the desktop.
